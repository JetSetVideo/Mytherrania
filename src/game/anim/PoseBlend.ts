// Layered pose blender (lane C, R04).
//
// Pure module: no Three.js, no DOM, no allocation per frame. A pose is a Float64Array of joint
// angles in JOINT_ORDER (Rig.ts). Layers stack bottom-up:
//
//   pose_j  = base_j                                             layer 0 (locomotion), always on
//   pose_j  = lerpAngle(pose_j, L_j, w · mask_j)                 each OVERRIDE layer, in order
//   pose_j += w · mask_j · L_j                                   each ADDITIVE layer (offsets)
//   pose_j  = clamp(pose_j, min_j, max_j)                        joint limits
//   final_j = spring_j → pose_j                                  pop guard (critically damped)
//   |final_j - final_j(prev)| <= maxJointSpeed · dt               angular speed limit (rad/s)
//
// A layer's weight w is never set directly: it is a critically damped spring (MathCore
// springStep) chasing a 0..1 target with the layer's own smooth time, so turning a layer on
// or off CROSSFADES instead of snapping. The pop guard is a second spring per joint with a
// short smooth time; joints flagged `passThrough` (the IK legs) skip it in proportion to how
// much the base layer owns them, because any lag there would make a planted foot slide.
//
// Masks: per-joint 0..1 arrays. MASK_FULL = every joint, MASK_UPPER = trunk, neck, head and
// arms, MASK_LOWER = hips, knees, ankles, toes.

import { clamp, clamp01, lerpAngle, type Spring, springStep } from "../../core/MathCore.ts";
import { JOINT_COUNT, JOINT_INDEX, type JointLimitTable } from "./Rig.ts";
import type { JointName } from "../Skeleton.ts";

/** Build a per-joint mask from the joints it covers (1) — every other joint is 0. */
export function makeMask(joints: readonly JointName[], value = 1): Float64Array {
  const m = new Float64Array(JOINT_COUNT);
  for (const j of joints) m[JOINT_INDEX[j]] = value;
  return m;
}

/** Joints driven by the legs (the foot IK). */
export const LOWER_JOINTS: readonly JointName[] = ["hipL", "hipR", "kneeL", "kneeR", "ankleL", "ankleR", "toeL", "toeR"];
/** Joints of the trunk, head and arms. */
export const UPPER_JOINTS: readonly JointName[] = [
  "spine", "abdomen", "neck", "head", "shoulderL", "shoulderR", "elbowL", "elbowR",
];
/** Every joint. */
export const MASK_FULL: Float64Array = makeMask([...UPPER_JOINTS, ...LOWER_JOINTS]);
/** Trunk, head and arms. */
export const MASK_UPPER: Float64Array = makeMask(UPPER_JOINTS);
/** Hips, knees, ankles, toes. */
export const MASK_LOWER: Float64Array = makeMask(LOWER_JOINTS);

/** How a layer combines: OVERRIDE lerps toward its angles, ADDITIVE adds its offsets. */
export type LayerMode = "override" | "additive";

/** Static description of a layer. `smoothTime` (s) is the weight spring's time to settle. */
export interface LayerSpec {
  name: string;
  mode: LayerMode;
  mask: Float64Array;
  smoothTime: number;
}

interface Layer {
  spec: LayerSpec;
  values: Float64Array;
  mask: Float64Array;
  weight: Spring;
  target: number;
}

/** The blender. Layer 0 must be the base (override, full mask): it is always fully on. */
export class PoseBlender {
  readonly limits: JointLimitTable;
  /** Smooth time (s) of the per-joint pop-guard spring. */
  popSmoothTime: number;
  /** Per joint 0..1: how much the pop guard is bypassed when the base layer owns the joint. */
  readonly passThrough = new Float64Array(JOINT_COUNT);
  /**
   * Per joint 0..1: share of the joint driven by a source that is smooth BY CONSTRUCTION (a skill
   * curve: sine/cosine impulse), which the pop guard must not delay. Bypass = max(passThrough ·
   * baseAuthority, trusted).
   */
  readonly trusted = new Float64Array(JOINT_COUNT);
  /**
   * Largest angular speed any joint may reach, rad/s (Infinity = off). The last line of defence
   * against pops: a step that would exceed it is shortened to maxJointSpeed · dt.
   */
  maxJointSpeed = Infinity;
  /** How many joint-frames the speed limit has shortened since construction (diagnostic). */
  speedLimited = 0;
  readonly #layers: Layer[] = [];
  readonly #joint: Spring[] = [];
  readonly #prev = new Float64Array(JOINT_COUNT);
  #primed = false;

  constructor(limits: JointLimitTable, popSmoothTime = 0.05) {
    this.limits = limits;
    this.popSmoothTime = popSmoothTime;
    for (let j = 0; j < JOINT_COUNT; j++) this.#joint.push({ value: limits.rest[j], velocity: 0 });
  }

  /** Add a layer; returns its index. Its values start at the rest pose (override) or 0 (additive). */
  addLayer(spec: LayerSpec): number {
    const values = spec.mode === "override" ? Float64Array.from(this.limits.rest) : new Float64Array(JOINT_COUNT);
    const base = this.#layers.length === 0;
    this.#layers.push({
      spec, values, mask: Float64Array.from(spec.mask),
      weight: { value: base ? 1 : 0, velocity: 0 }, target: base ? 1 : 0,
    });
    return this.#layers.length - 1;
  }

  /** Number of layers. */
  get layerCount(): number { return this.#layers.length; }

  /** The layer's angle (override) or offset (additive) array, to fill each frame. */
  values(layer: number): Float64Array { return this.#layers[layer].values; }

  /** The layer's live mask (writable: e.g. widen a skill layer to the legs). */
  mask(layer: number): Float64Array { return this.#layers[layer].mask; }

  /** Ask the layer's weight to move toward `w` (0..1); the spring does the rest. */
  setTarget(layer: number, w: number): void {
    if (layer === 0) return;
    this.#layers[layer].target = clamp01(w);
  }

  /** Jump the weight to `w` with zero velocity (spawn / reset only). */
  setWeightImmediate(layer: number, w: number): void {
    const l = this.#layers[layer];
    l.target = layer === 0 ? 1 : clamp01(w);
    l.weight.value = l.target;
    l.weight.velocity = 0;
  }

  /** Current weight of the layer, 0..1. */
  weight(layer: number): number { return this.#layers[layer].weight.value; }

  /** Advance every layer's weight spring by dt seconds. Call once per frame, before evaluating. */
  stepWeights(dt: number): void {
    for (let i = 1; i < this.#layers.length; i++) {
      const l = this.#layers[i];
      springStep(l.weight, l.target, l.spec.smoothTime, dt);
      if (l.weight.value <= 0 || l.weight.value >= 1) {
        l.weight.value = clamp01(l.weight.value);
        l.weight.velocity = 0;
      }
    }
  }

  /** How much the base layer still owns joint j: Π over override layers of (1 - w·mask_j). */
  baseAuthority(j: number): number {
    let a = 1;
    for (let i = 1; i < this.#layers.length; i++) {
      const l = this.#layers[i];
      if (l.spec.mode === "override") a *= 1 - l.weight.value * l.mask[j];
    }
    return a;
  }

  /** Blend joint j through every layer and clamp it (no pop guard). */
  blendJoint(j: number): number {
    const layers = this.#layers;
    let pose = layers[0].values[j];
    for (let i = 1; i < layers.length; i++) {
      const l = layers[i];
      const w = l.weight.value * l.mask[j];
      if (w <= 0) continue;
      if (l.spec.mode === "override") pose = lerpAngle(pose, l.values[j], w);
      else pose += w * l.values[j];
    }
    return clamp(pose, this.limits.min[j], this.limits.max[j]);
  }

  /**
   * Final angle of joint j this frame: blend, clamp, then the pop-guard spring (bypassed for
   * pass-through joints in proportion to the base layer's authority), clamped again because a
   * moving spring can overshoot a limit its target sits on. Writes out[j] and returns it.
   */
  evaluateJoint(j: number, dt: number, out: Float64Array): number {
    const target = this.blendJoint(j);
    const s = this.#joint[j];
    const smooth = this.popSmoothTime * (1 - Math.max(this.passThrough[j] * this.baseAuthority(j), this.trusted[j]));
    if (!this.#primed || dt <= 0) {
      s.value = target;
      s.velocity = 0;
    } else if (smooth < 1e-3) {
      s.velocity = (target - s.value) / dt;
      s.value = target;
    } else {
      springStep(s, target, smooth, dt);
    }
    const lo = this.limits.min[j], hi = this.limits.max[j];
    if (s.value < lo || s.value > hi) {
      s.value = clamp(s.value, lo, hi);
      s.velocity = 0;
    }
    if (this.#primed && dt > 0) {
      const maxStep = this.maxJointSpeed * dt, step = s.value - this.#prev[j];
      if (step > maxStep || step < -maxStep) {
        s.value = this.#prev[j] + (step > 0 ? maxStep : -maxStep);
        s.velocity = clamp(s.velocity, -this.maxJointSpeed, this.maxJointSpeed);
        this.speedLimited++;
      }
    }
    this.#prev[j] = s.value;
    out[j] = s.value;
    return s.value;
  }

  /** Evaluate every joint not listed in `skip` (a 0/1 per-joint array, or null). */
  evaluate(dt: number, out: Float64Array, skip: Float64Array | null = null): void {
    for (let j = 0; j < JOINT_COUNT; j++) if (!skip || skip[j] === 0) this.evaluateJoint(j, dt, out);
    this.#primed = true;
  }

  /** Forget the pop-guard history: the next evaluation lands exactly on the blended pose. */
  resetFilter(): void { this.#primed = false; }
}
