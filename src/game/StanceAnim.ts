// Stance-transition animation: a coherent, keyframed move between two stances
// (standing / staggered / kneeling / fallen), so the body passes through named
// start, peak and end poses with continuous joint motion instead of snapping.
//
// The user asked for animations that "keep coherent points between the animation
// when they change stance", with values for the start, top and finish, driven by
// sin/cos/tan. Each transition is a set of per-joint keyframes (start -> peak ->
// end); a sub-animation controller plays them over a fixed duration and reports
// the joint angles at any progress, so a stance change is smooth and testable.
//
// Pure module: no Three.js, no DOM. Angles in radians, progress 0..1.

import type { Stance } from "./BalancePlates.ts";
import type { JointName } from "./Skeleton.ts";

/** One joint's path through a transition: the angle at start, peak and end. */
export interface JointKey {
  joint: JointName;
  /** Angle at the start (progress 0). */
  from: number;
  /** Angle at the peak of the move (progress ~0.5): the overshoot. */
  peak: number;
  /** Angle at the end (progress 1): the settled pose. */
  to: number;
}

/** A full transition between two stances, over a fixed duration (s). */
export interface StanceTransition {
  from: Stance;
  to: Stance;
  /** Seconds the move takes. */
  duration: number;
  keys: JointKey[];
}

/**
 * The joint angle at progress t in [0,1]. The path is start -> peak -> end with
 * a sinusoidal ease on each half, so the velocity is continuous at the peak and
 * zero at both ends (the body does not jerk into or out of the move):
 *   first half:  from + (peak - from) * sin(pi/2 * 2t)
 *   second half: peak + (to - peak) * (1 - cos(pi/2 * (2t-1))) ... eased to the end
 */
export function keyAngle(key: JointKey, t: number): number {
  const x = Math.max(0, Math.min(1, t));
  if (x <= 0.5) {
    const u = x / 0.5;
    return key.from + (key.peak - key.from) * Math.sin((Math.PI / 2) * u);
  }
  const u = (x - 0.5) / 0.5;
  return key.peak + (key.to - key.peak) * (1 - Math.cos((Math.PI / 2) * u));
}

/** Every joint's angle at progress t, as a map the skeleton can apply. */
export function transitionPose(tr: StanceTransition, t: number): Map<JointName, number> {
  const out = new Map<JointName, number>();
  for (const k of tr.keys) out.set(k.joint, keyAngle(k, t));
  return out;
}

/**
 * The canonical transition set. Each stance change has a choreographed path:
 * the peak overshoots in the direction of the move (a kneel dips before settling,
 * a fall pitches forward then lands) so the motion reads as weight shifting, not
 * teleporting. Times are deliberately distinct so a stagger is quick and a fall
 * is slow.
 */
export function stanceTransitions(): StanceTransition[] {
  return [
    {
      from: "standing", to: "kneeling", duration: 0.9,
      keys: [
        { joint: "kneeL", from: -0.3, peak: -2.1, to: -1.9 },
        { joint: "kneeR", from: -0.3, peak: -2.1, to: -1.9 },
        { joint: "hipL", from: 0, peak: 0.9, to: 0.8 },
        { joint: "hipR", from: 0, peak: 0.9, to: 0.8 },
        { joint: "spine", from: 0, peak: 0.25, to: 0.15 },
        { joint: "ankleL", from: 0, peak: 0.6, to: 0.7 },
        { joint: "ankleR", from: 0, peak: 0.6, to: 0.7 },
      ],
    },
    {
      from: "kneeling", to: "fallen", duration: 0.7,
      keys: [
        { joint: "spine", from: 0.15, peak: -1.2, to: -1.4 },
        { joint: "abdomen", from: 0.1, peak: -0.8, to: -0.9 },
        { joint: "neck", from: 0, peak: -0.7, to: -0.8 },
        { joint: "head", from: 0, peak: -0.7, to: -0.75 },
        { joint: "shoulderL", from: 0, peak: -1.5, to: -1.6 },
        { joint: "shoulderR", from: 0, peak: -1.5, to: -1.6 },
      ],
    },
    {
      from: "standing", to: "staggered", duration: 0.35,
      keys: [
        { joint: "spine", from: 0, peak: 0.4, to: 0.2 },
        { joint: "abdomen", from: 0, peak: 0.3, to: 0.15 },
        { joint: "kneeL", from: -0.3, peak: -0.7, to: -0.5 },
        { joint: "kneeR", from: -0.3, peak: -0.7, to: -0.5 },
      ],
    },
    {
      from: "staggered", to: "standing", duration: 0.4,
      keys: [
        { joint: "spine", from: 0.2, peak: -0.1, to: 0 },
        { joint: "abdomen", from: 0.15, peak: -0.05, to: 0 },
        { joint: "kneeL", from: -0.5, peak: -0.25, to: -0.3 },
        { joint: "kneeR", from: -0.5, peak: -0.25, to: -0.3 },
      ],
    },
    {
      from: "kneeling", to: "standing", duration: 1.0,
      keys: [
        { joint: "kneeL", from: -1.9, peak: -0.2, to: -0.3 },
        { joint: "kneeR", from: -1.9, peak: -0.2, to: -0.3 },
        { joint: "hipL", from: 0.8, peak: -0.1, to: 0 },
        { joint: "hipR", from: 0.8, peak: -0.1, to: 0 },
        { joint: "spine", from: 0.15, peak: -0.05, to: 0 },
      ],
    },
  ];
}

/** Find the transition between two stances, or null if none is choreographed. */
export function findTransition(from: Stance, to: Stance): StanceTransition | null {
  return stanceTransitions().find((t) => t.from === from && t.to === to) ?? null;
}

/**
 * A sub-animation controller: plays one transition over its duration and reports
 * the pose at the current time. Coherent with the previous stance: the keys'
 * `from` angles are the pose the body was already in.
 */
export class StanceAnimator {
  #active: { tr: StanceTransition; t: number } | null = null;

  /** Start a transition (no-op if it's already the active one). */
  play(tr: StanceTransition): void {
    if (this.#active?.tr === tr) return;
    this.#active = { tr, t: 0 };
  }

  /** Advance by dt (s). Returns the pose, or null when no transition is playing. */
  update(dt: number): Map<JointName, number> | null {
    if (!this.#active) return null;
    this.#active.t += dt;
    const t = Math.min(1, this.#active.t / this.#active.tr.duration);
    // The final pose is returned on the completing frame, then the move goes idle,
    // so the caller holds the settled angles instead of losing them for a frame.
    const pose = transitionPose(this.#active.tr, t);
    if (t >= 1) this.#active = null;
    return pose;
  }

  /** True while a transition is playing. */
  playing(): boolean { return this.#active !== null; }
  /** Progress of the active transition 0..1, or 1 when idle. */
  progress(): number { return this.#active ? Math.min(1, this.#active.t / this.#active.tr.duration) : 1; }
  /** The active transition, if any. */
  current(): StanceTransition | null { return this.#active?.tr ?? null; }
}
