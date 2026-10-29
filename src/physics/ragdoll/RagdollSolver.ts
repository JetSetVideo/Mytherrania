// Articulated ragdoll SOLVER (V03): extended position-based dynamics (XPBD, Müller et al. 2020,
// "Detailed Rigid Body Simulation with Extended Position Based Dynamics") over the rigid
// segments of RagdollModel. Fixed substeps (SUBSTEP_HZ, at most MAX_SUBSTEPS per frame), each:
//   1. integrate: v += (g + buoyancy)·h, fluid drag, x += v·h, q += ½·h·[ω,0]·q
//   2. ITERATIONS × (muscle drives (soft) → self-collision → world contacts + static friction →
//      joint limits → joint anchors)
//   3. v = Δx/h, ω = 2·vec(q·q_prev⁻¹)/h
//   4. velocity pass: contact restitution + dynamic friction, joint damping (passive + muscle)
// Joint limits come from the Skeleton (flex) and LATERAL_LIMITS (abduct/twist); muscles are a
// compliant angular constraint per joint pulling toward the protective pose (MuscleTone) with
// stiffness k = tone·I_eff·ω_max² and torque capped at the joint's holding torque × strength.
// The solver allocates nothing per frame; `report.ms` measures each step.
import type { Medium } from "../../world/biomes/contracts.ts";
import type { RagdollModel } from "./RagdollModel.ts";
import { segmentSegment, targetRelative } from "./RagdollModel.ts";
import {
  clampAngle, qApplyRotation, qConjMul, qIntegrate, qFromFlexAbductTwist, qMul, qMulConj, qNormalize, qRotate, qRotateInv,
  qToFlexAbductTwist, qToRotationVector,
} from "./QuatMath.ts";
import type { FluidSample, RagdollWorld, SolidContact } from "./RagdollWorld.ts";
import { BRACE_POSE, braceWeight, COVER_POSE, muscleTone, type FighterCondition } from "./MuscleTone.ts";

/** Substep rate, Hz (h = 1/120 s), and the most substeps one frame may run (a 30 fps floor). */
export const SUBSTEP_HZ = 120, MAX_SUBSTEPS = 4;
/** Gauss–Seidel passes over the constraints per substep. */
export const ITERATIONS = 4;
/** Extra passes allowed on a substep that still violates a limit / opens a joint (impacts). */
export const MAX_EXTRA_ITERATIONS = 8;
/** Residual joint-limit error (rad) and anchor gap (m) that end the extra passes. */
export const LIMIT_TOLERANCE = 0.004, ANCHOR_TOLERANCE = 0.005;
/** Natural frequency of a fully toned joint, Hz (a braced limb snaps back in ~¼ s). */
export const MUSCLE_FREQUENCY = 4;
/** Damping ratio of the muscle drives (just under critical: firm, no overshoot). */
export const MUSCLE_DAMPING_RATIO = 0.8;
/** Muscle torque capacity in multiples of the joint's holding torque (lift the limb against g). */
export const MUSCLE_HOLD_RATIO = 2;
/** The protective reflex relaxes once the grounded body is slower than RELAX_SPEED m/s, halving every RELAX_HALF_LIFE s. */
export const RELAX_SPEED = 1.5, RELAX_HALF_LIFE = 0.35;
/** Passive joint damping of a limp body (ligaments, tissue), 1/s. */
export const PASSIVE_JOINT_DAMPING = 2;
/** Air drag on every segment, 1/s (a falling body is barely slowed by air at these speeds). */
export const AIR_DRAG = 0.02;
/** Drag coefficient of a body part in a liquid (a bluff body: C_d ≈ 1). */
export const FLUID_DRAG_COEFFICIENT = 1;
/**
 * Settled when, for SETTLE_TIME s in contact, the COM speed < SETTLE_SPEED m/s and the RMS
 * speed of the whole mass √(2·KE/M) < SETTLE_RMS m/s; then the body sleeps (pose frozen).
 */
export const SETTLE_SPEED = 0.08, SETTLE_RMS = 0.15, SETTLE_TIME = 0.5;
/**
 * Fastest a segment may spin, rad/s: 8 turns per second (50 rad/s ≈ 0.42 rad per substep). A
 * blow's moment on a light limb can compute to hundreds of rad/s; the cap keeps every substep's
 * rotation small enough for the Gauss–Seidel passes to hold the joints together.
 */
export const MAX_SPIN = 50;
/** Static friction is this multiple of the dynamic coefficient. */
export const STATIC_FRICTION_RATIO = 1.25;

/** How the ragdoll starts: the rig's bone world poses plus the body's motion. */
export interface RagdollSeed {
  /** Per model bone, 7 floats: world quaternion (x, y, z, w) then world origin (x, y, z). */
  boneWorld: Float64Array;
  /** The same one frame earlier (animation velocities), and that frame's dt, s. Optional. */
  prevBoneWorld?: Float64Array;
  prevDt?: number;
  /** Whole-body linear velocity (the knockback), m/s. */
  velocity: [number, number, number];
  /** Extra whole-body spin, rad/s (world axes). */
  spin?: [number, number, number];
  /** The last impact: impulse J (N·s) at world point P. Only its MOMENT (P − COM) × J is added
   *  (the linear part is already in `velocity`), as a spin ω = I_total⁻¹·L. */
  impact?: { point: [number, number, number]; impulse: [number, number, number] };
}

/** Per-step report (reused object). */
export interface RagdollReport {
  substeps: number;
  /** Wall-clock cost of the last step(), ms. */
  ms: number;
  /** Active world contacts after the last substep. */
  contacts: number;
  /** Fluid the body is in (deepest immersion), or null. */
  medium: Medium | null;
  /** Fraction of the body mass immersed in that fluid, 0..1. */
  immersion: number;
  settled: boolean;
  lost: boolean;
}

const SCR = new Float64Array(16);   // scratch vectors/quaternions (solver-wide, single-threaded)
const SC: SolidContact = { depth: 0, nx: 0, ny: 1, nz: 0, friction: 0, restitution: 0 };
const FL: FluidSample = { medium: "water", surfaceY: 0, drag: 0, buoyancy: 0 };
const SS = { s: 0, t: 0 };

/** A live ragdoll of one fighter. */
export class Ragdoll {
  readonly model: RagdollModel;
  /** COM position (3/seg), orientation (4/seg), velocity (3/seg), angular velocity (3/seg, world). */
  readonly x: Float64Array; readonly q: Float64Array; readonly v: Float64Array; readonly w: Float64Array;
  readonly px: Float64Array; readonly pq: Float64Array;
  /** Muscle target relative rotations (4/seg) and accumulated drive multipliers (1/seg). */
  readonly target: Float64Array; readonly lambda: Float64Array;
  /** Holding torque per joint, N·m (subtree weight × lever, rest pose). */
  readonly holdTorque: Float64Array;
  /** Contacts, one slot per contact sphere. */
  readonly cOn: Uint8Array; readonly cN: Float64Array; readonly cLam: Float64Array;
  readonly cMu: Float64Array; readonly cE: Float64Array; readonly cVn: Float64Array;
  tone = 0;
  torqueScale = 0;
  /** Protective reflex 0..1: full while the fall lasts, relaxing once the body lies still (RELAX_*). */
  reflex = 1;
  settled = false;
  lost = false;
  time = 0;
  #acc = 0;
  #still = 0;
  /** Bone world scratch for writeBones (4 + 3 per bone). */
  readonly #bq: Float64Array; readonly #bo: Float64Array;
  /** Subtree of each segment (itself first): #subList[#subStart[s] .. #subStart[s+1]). */
  readonly #subStart: Int32Array; readonly #subList: Int16Array;
  /** Joints projected back into their limits this substep (1/seg) and the inward axis (3/seg). */
  readonly #stopped: Uint8Array; readonly #stop: Float64Array;
  /** Segments with a muscle drive (listed in the COVER/BRACE tables). */
  readonly #driven: Uint8Array;
  /** Velocities before the limit projection (3/seg each). */
  readonly #vPre: Float64Array; readonly #wPre: Float64Array;
  readonly report: RagdollReport = { substeps: 0, ms: 0, contacts: 0, medium: null, immersion: 0, settled: false, lost: false };

  constructor(model: RagdollModel, gravity = 24) {
    this.model = model;
    const n = model.n, ns = model.sphereSeg.length, nb = model.boneIds.length;
    this.x = new Float64Array(n * 3); this.q = new Float64Array(n * 4); this.v = new Float64Array(n * 3); this.w = new Float64Array(n * 3);
    this.px = new Float64Array(n * 3); this.pq = new Float64Array(n * 4);
    this.target = new Float64Array(n * 4); this.lambda = new Float64Array(n);
    this.cOn = new Uint8Array(ns); this.cN = new Float64Array(ns * 3);
    this.cLam = new Float64Array(ns); this.cMu = new Float64Array(ns); this.cE = new Float64Array(ns); this.cVn = new Float64Array(ns);
    this.#bq = new Float64Array(nb * 4); this.#bo = new Float64Array(nb * 3);
    this.holdTorque = holdingTorques(model, gravity);
    for (let s = 0; s < n; s++) this.q[s * 4 + 3] = 1;
    const sub: number[] = [], start: number[] = [];
    const inSub = (t: number, s: number): boolean => { for (let u = t; u >= 0; u = model.segParent[u]) if (u === s) return true; return false; };
    for (let s = 0; s < n; s++) { start.push(sub.length); for (let t = 0; t < n; t++) if (inSub(t, s)) sub.push(t); }
    start.push(sub.length);
    this.#subStart = Int32Array.from(start); this.#subList = Int16Array.from(sub);
    this.#stopped = new Uint8Array(n); this.#stop = new Float64Array(n * 3);
    this.#vPre = new Float64Array(n * 3); this.#wPre = new Float64Array(n * 3);
    this.#driven = Uint8Array.from({ length: n }, (_, s) => (model.segParent[s] >= 0 && COVER_POSE[model.boneIds[model.segBone[s]]] && BRACE_POSE[model.boneIds[model.segBone[s]]] ? 1 : 0));
  }

  /** Set the muscle tone from the fighter's condition (MuscleTone.muscleTone). */
  setCondition(c: FighterCondition): void {
    const t = muscleTone(c);
    this.tone = t.tone; this.torqueScale = t.torqueScale;
  }

  /** Place every segment from the rig pose and give it the body's motion (see RagdollSeed). */
  seed(seed: RagdollSeed): void {
    const m = this.model, n = m.n;
    const bw = seed.boneWorld;
    for (let s = 0; s < n; s++) {
      const b = m.segBone[s];
      for (let k = 0; k < 4; k++) this.q[s * 4 + k] = bw[b * 7 + k];
      qNormalize(this.q, s * 4);
      qRotate(SCR, 0, this.q, s * 4, m.com[s * 3], m.com[s * 3 + 1], m.com[s * 3 + 2]);
      for (let k = 0; k < 3; k++) this.x[s * 3 + k] = bw[b * 7 + 4 + k] + SCR[k];
    }
    const [cx, cy, cz] = this.centreOfMass();
    let sx = seed.spin?.[0] ?? 0, sy = seed.spin?.[1] ?? 0, sz = seed.spin?.[2] ?? 0;
    if (seed.impact) {
      const P = seed.impact.point, J = seed.impact.impulse;
      const rx = P[0] - cx, ry = P[1] - cy, rz = P[2] - cz;
      const L = [ry * J[2] - rz * J[1], rz * J[0] - rx * J[2], rx * J[1] - ry * J[0]];
      const w = this.#solveTotalInertia(cx, cy, cz, L[0], L[1], L[2]);
      sx += w[0]; sy += w[1]; sz += w[2];
    }
    // Animation velocities relative to the body (the snapshot's own translation removed).
    const prev = seed.prevBoneWorld, pdt = seed.prevDt ?? 0;
    let pcx = 0, pcy = 0, pcz = 0;
    if (prev && pdt > 0) {
      for (let s = 0; s < n; s++) {
        const b = m.segBone[s];
        qRotate(SCR, 0, prev, b * 7, m.com[s * 3], m.com[s * 3 + 1], m.com[s * 3 + 2]);
        const k = m.mass[s] / m.totalMass;
        pcx += k * (prev[b * 7 + 4] + SCR[0]); pcy += k * (prev[b * 7 + 5] + SCR[1]); pcz += k * (prev[b * 7 + 6] + SCR[2]);
      }
    }
    for (let s = 0; s < n; s++) {
      const i = s * 3;
      const rx = this.x[i] - cx, ry = this.x[i + 1] - cy, rz = this.x[i + 2] - cz;
      this.v[i] = seed.velocity[0] + sy * rz - sz * ry;
      this.v[i + 1] = seed.velocity[1] + sz * rx - sx * rz;
      this.v[i + 2] = seed.velocity[2] + sx * ry - sy * rx;
      this.w[i] = sx; this.w[i + 1] = sy; this.w[i + 2] = sz;
      if (prev && pdt > 0) {
        const b = m.segBone[s];
        qRotate(SCR, 0, prev, b * 7, m.com[s * 3], m.com[s * 3 + 1], m.com[s * 3 + 2]);
        this.v[i] += ((this.x[i] - cx) - (prev[b * 7 + 4] + SCR[0] - pcx)) / pdt;
        this.v[i + 1] += ((this.x[i + 1] - cy) - (prev[b * 7 + 5] + SCR[1] - pcy)) / pdt;
        this.v[i + 2] += ((this.x[i + 2] - cz) - (prev[b * 7 + 6] + SCR[2] - pcz)) / pdt;
        qMulConj(SCR, 4, this.q, s * 4, prev, b * 7);
        qToRotationVector(SCR, 8, SCR, 4);
        this.w[i] += SCR[8] / pdt; this.w[i + 1] += SCR[9] / pdt; this.w[i + 2] += SCR[10] / pdt;
      }
    }
    this.px.set(this.x); this.pq.set(this.q);
    this.settled = false; this.lost = false; this.#acc = 0; this.#still = 0; this.time = 0; this.reflex = 1;
  }

  /** Mass-weighted centre of mass, m (returns a cached tuple; copy it to keep it). */
  centreOfMass(): [number, number, number] {
    const m = this.model;
    let cx = 0, cy = 0, cz = 0;
    for (let s = 0; s < m.n; s++) {
      const k = m.mass[s] / m.totalMass;
      cx += k * this.x[s * 3]; cy += k * this.x[s * 3 + 1]; cz += k * this.x[s * 3 + 2];
    }
    COM[0] = cx; COM[1] = cy; COM[2] = cz;
    return COM;
  }

  /** Mass-weighted mean velocity, m/s (cached tuple). */
  comVelocity(): [number, number, number] {
    const m = this.model;
    let vx = 0, vy = 0, vz = 0;
    for (let s = 0; s < m.n; s++) {
      const k = m.mass[s] / m.totalMass;
      vx += k * this.v[s * 3]; vy += k * this.v[s * 3 + 1]; vz += k * this.v[s * 3 + 2];
    }
    VEL[0] = vx; VEL[1] = vy; VEL[2] = vz;
    return VEL;
  }

  /** Total mechanical energy: Σ ½mv² + ½ωᵀIω + m·g·y, J. */
  energy(gravity: number): number {
    const m = this.model;
    let e = 0;
    for (let s = 0; s < m.n; s++) {
      const i = s * 3;
      e += 0.5 * m.mass[s] * (this.v[i] ** 2 + this.v[i + 1] ** 2 + this.v[i + 2] ** 2) + m.mass[s] * gravity * this.x[i + 1];
      qRotateInv(SCR, 0, this.q, s * 4, this.w[i], this.w[i + 1], this.w[i + 2]);
      e += 0.5 * (m.inertia[i] * SCR[0] ** 2 + m.inertia[i + 1] * SCR[1] ** 2 + m.inertia[i + 2] * SCR[2] ** 2);
    }
    return e;
  }

  /** Joint angles of segment s relative to its rest, [flex, abduct, twist] (rig axes) into out. */
  jointAngles(s: number, out: Float64Array, oi = 0): void {
    const p = this.model.segParent[s];
    if (p < 0) { out[oi] = 0; out[oi + 1] = 0; out[oi + 2] = 0; return; }
    qConjMul(SCR, 0, this.q, p * 4, this.q, s * 4);
    qConjMul(SCR, 4, this.model.restRel, s * 4, SCR, 0);
    qToFlexAbductTwist(out, oi, SCR, 4);
  }

  /** Largest gap between a joint's parent-side and child-side anchor points, m (0 = every joint joined). */
  maxAnchorGap(): number {
    const m = this.model;
    let worst = 0;
    for (let s = 0; s < m.n; s++) {
      const p = m.segParent[s];
      if (p < 0) continue;
      qRotate(SCR, 0, this.q, p * 4, m.anchorParent[s * 3], m.anchorParent[s * 3 + 1], m.anchorParent[s * 3 + 2]);
      qRotate(SCR, 3, this.q, s * 4, m.anchorChild[s * 3], m.anchorChild[s * 3 + 1], m.anchorChild[s * 3 + 2]);
      const g = Math.hypot(this.x[p * 3] + SCR[0] - this.x[s * 3] - SCR[3], this.x[p * 3 + 1] + SCR[1] - this.x[s * 3 + 1] - SCR[4], this.x[p * 3 + 2] + SCR[2] - this.x[s * 3 + 2] - SCR[5]);
      if (g > worst) worst = g;
    }
    return worst;
  }

  /** Largest excursion of any joint angle beyond its limits, rad (0 = every joint in range). */
  limitViolation(): number {
    const m = this.model;
    let worst = 0;
    for (let s = 0; s < m.n; s++) {
      if (m.segParent[s] < 0) continue;
      this.jointAngles(s, SCR, 12);
      for (let a = 0; a < 3; a++) {
        const v = SCR[12 + a], lo = m.limits[s * 6 + a * 2], hi = m.limits[s * 6 + a * 2 + 1];
        const c = clampAngle(v, lo, hi);
        const d = Math.abs(Math.atan2(Math.sin(v - c), Math.cos(v - c)));
        if (d > worst) worst = d;
      }
    }
    return worst;
  }

  /**
   * Advance by a frame of dt seconds against `world` (fixed substeps; the remainder carries).
   * Returns the reused report.
   */
  step(dt: number, world: RagdollWorld): RagdollReport {
    const t0 = performance.now();
    const r = this.report;
    r.substeps = 0;
    if (!this.settled && !this.lost) {
      const h = 1 / SUBSTEP_HZ;
      this.#acc = Math.min(this.#acc + dt, MAX_SUBSTEPS * h);
      if (this.tone > 0) this.#updateTargets();
      while (this.#acc >= h - 1e-9 && r.substeps < MAX_SUBSTEPS) {
        this.#substep(h, world);
        this.#acc -= h; r.substeps++;
        this.time += h;
      }
      this.#detectRest(dt, world);
    }
    r.settled = this.settled; r.lost = this.lost;
    r.ms = performance.now() - t0;
    return r;
  }

  /**
   * Write the rig's bone transforms, 7 floats per model bone (local quaternion x, y, z, w then
   * local position x, y, z): every bone's rotation relative to its parent, the constant local
   * offsets, and for the root its WORLD pose (the rig group must sit at the identity).
   */
  writeBones(out: Float64Array): void {
    const m = this.model, nb = m.boneIds.length, bq = this.#bq, bo = this.#bo;
    for (let b = 0; b < nb; b++) {
      const s = m.segOfBone[b];
      if (s < 0) continue;
      for (let k = 0; k < 4; k++) bq[b * 4 + k] = this.q[s * 4 + k];
      qRotate(SCR, 0, this.q, s * 4, m.com[s * 3], m.com[s * 3 + 1], m.com[s * 3 + 2]);
      for (let k = 0; k < 3; k++) bo[b * 3 + k] = this.x[s * 3 + k] - SCR[k];
    }
    // Root: the base keeps its REST local rotation, the root carries its world orientation.
    const base = m.baseSegment, bb = m.segBone[base], root = m.rootBone;
    qMulConj(bq, root * 4, this.q, base * 4, m.boneRestRot, bb * 4);
    qRotate(SCR, 0, bq, root * 4, m.boneLocalPos[bb * 3], m.boneLocalPos[bb * 3 + 1], m.boneLocalPos[bb * 3 + 2]);
    for (let k = 0; k < 3; k++) bo[root * 3 + k] = bo[bb * 3 + k] - SCR[k];
    for (let b = 0; b < nb; b++) {
      const p = m.boneParent[b];
      if (m.boneWelded[b]) {
        // Welded leaf: its rest rotation and offset, riding on the parent.
        for (let k = 0; k < 4; k++) out[b * 7 + k] = m.boneRestRot[b * 4 + k];
        for (let k = 0; k < 3; k++) out[b * 7 + 4 + k] = m.boneLocalPos[b * 3 + k];
      } else if (p < 0) {
        for (let k = 0; k < 4; k++) out[b * 7 + k] = bq[b * 4 + k];
        for (let k = 0; k < 3; k++) out[b * 7 + 4 + k] = bo[b * 3 + k];
      } else {
        qConjMul(out, b * 7, bq, p * 4, bq, b * 4);
        for (let k = 0; k < 3; k++) out[b * 7 + 4 + k] = m.boneLocalPos[b * 3 + k];
      }
    }
  }

  // ---------------------------------------------------------------------------------------

  /** Muscle targets for this frame: COVER ↔ BRACE blended by where the chest faces in the fall. */
  #updateTargets(): void {
    const m = this.model, base = m.baseSegment;
    qRotate(SCR, 0, this.q, base * 4, 0, 0, 1);
    const v = this.comVelocity();
    const wb = braceWeight(SCR[0], SCR[1], SCR[2], v[0], v[1], v[2]);
    for (let s = 0; s < m.n; s++) {
      if (m.segParent[s] < 0) continue;
      const id = m.boneIds[m.segBone[s]];
      const c = COVER_POSE[id], b = BRACE_POSE[id];
      if (!c || !b) continue; // no muscle on this joint
      targetRelative(m, s, c[0] + (b[0] - c[0]) * wb, c[1] + (b[1] - c[1]) * wb, c[2] + (b[2] - c[2]) * wb, this.target, s * 4);
    }
  }

  #substep(h: number, world: RagdollWorld): void {
    const m = this.model, n = m.n, g = world.gravity;
    // 0. Pre-stabilisation: penetration left over from the last substep (an unconverged pass, the
    // kinematic limit projection) is pushed out KINEMATICALLY before integrating — positions
    // only, the velocities are untouched — so resolving it cannot launch a spin (a resting body
    // would otherwise pump energy out of its own contact corrections).
    this.#contacts(world, true, false);
    // 1. Integrate (gravity, buoyancy, drag).
    let immersedMass = 0, medium: Medium | null = null;
    const air = Math.exp(-AIR_DRAG * h);
    for (let s = 0; s < n; s++) {
      const i = s * 3;
      let ay = -g, damp = air;
      if (world.fluidAt(this.x[i], this.x[i + 2], FL)) {
        const r = m.eqRadius[s];
        const f = Math.max(0, Math.min(1, (FL.surfaceY - (this.x[i + 1] - r)) / (2 * r)));
        if (f > 0) {
          ay += FL.buoyancy * g * f;
          damp *= Math.exp(-FL.drag * f * h);
          // Quadratic (form) drag of a bluff body, ½·ρ_f·C_d·A·v² / m, for a sphere of radius
          // r_eq with ρ_f = buoyancy·ρ_body: a = k·v², k = 3·b·C_d / (8·r_eq). Integrated
          // implicitly (v ← v / (1 + k·|v|·h)) so a fast entry (a belly flop) is stopped hard
          // but never reversed.
          const sp = Math.hypot(this.v[i], this.v[i + 1], this.v[i + 2]);
          damp /= 1 + ((3 * FL.buoyancy * FLUID_DRAG_COEFFICIENT * f) / (8 * r)) * sp * h;
          immersedMass += m.mass[s] * f; medium = FL.medium;
        }
      }
      this.v[i + 1] += ay * h;
      this.v[i] *= damp; this.v[i + 1] *= damp; this.v[i + 2] *= damp;
      this.w[i] *= damp; this.w[i + 1] *= damp; this.w[i + 2] *= damp;
      this.px[i] = this.x[i]; this.px[i + 1] = this.x[i + 1]; this.px[i + 2] = this.x[i + 2];
      for (let k = 0; k < 4; k++) this.pq[s * 4 + k] = this.q[s * 4 + k];
      this.x[i] += this.v[i] * h; this.x[i + 1] += this.v[i + 1] * h; this.x[i + 2] += this.v[i + 2] * h;
      // Spin cap (a body part cannot whirl faster than MAX_SPIN), then the exact rotation.
      const spin = Math.hypot(this.w[i], this.w[i + 1], this.w[i + 2]);
      if (spin > MAX_SPIN) { const k = MAX_SPIN / spin; this.w[i] *= k; this.w[i + 1] *= k; this.w[i + 2] *= k; }
      qIntegrate(this.q, s * 4, this.w[i] * h, this.w[i + 1] * h, this.w[i + 2] * h);
    }
    this.report.medium = medium; this.report.immersion = immersedMass / m.totalMass;
    this.lambda.fill(0);
    this.cOn.fill(0); this.cLam.fill(0);
    // 2. Constraints.
    const drive = this.tone * this.reflex;
    const omega = 2 * Math.PI * MUSCLE_FREQUENCY * Math.sqrt(drive);
    // ITERATIONS passes always; while a joint is still more than LIMIT_TOLERANCE out of its
    // limits or ANCHOR_TOLERANCE apart (an impact), up to MAX_EXTRA_ITERATIONS more — the cost
    // is paid only on impact frames, and the kinematic projection below is left a small residual.
    for (let it = 0; it < ITERATIONS + MAX_EXTRA_ITERATIONS; it++) {
      if (it >= ITERATIONS && this.limitViolation() < LIMIT_TOLERANCE && this.maxAnchorGap() < ANCHOR_TOLERANCE) break;
      if (drive > 0) for (let s = 0; s < n; s++) if (this.#driven[s]) this.#drive(s, h, omega);
      for (let k = 0; k < m.pairs.length; k += 2) this.#self(m.pairs[k], m.pairs[k + 1]);
      this.#contacts(world, it === 0);
      // Limits, then anchors LAST (the most recently projected constraints are the best kept;
      // the kinematic projection below then removes the limit residual without opening a
      // joint). Sweeps alternate root→leaves and leaves→root so corrections travel the chain.
      const fwd = (it & 1) === 0;
      for (let k = 0; k < n; k++) { const s = fwd ? n - 1 - k : k; if (m.segParent[s] >= 0) this.#limit(s); }
      for (let k = 0; k < n; k++) { const s = fwd ? k : n - 1 - k; if (m.segParent[s] >= 0) this.#anchor(s); }
    }
    // 3. Velocities from the positions, then 3b. post-stabilisation: the residual limit error
    // left by the Gauss–Seidel passes is removed KINEMATICALLY (root → leaves, each child's
    // whole subtree turned about its joint) so the pose the skin shows is always inside the
    // Skeleton's limits. The projection may feed the velocities only as far as it takes
    // energy OUT: v = v_pre + α·Δv with the α ∈ [0, 1] that minimises KE(v)
    // (it stops a limb running out through its limit, it never throws it back).
    this.#velocities(h, this.v, this.w);
    this.#stopped.fill(0);
    if (this.#projectLimits()) {
      this.#vPre.set(this.v); this.#wPre.set(this.w);
      this.#velocities(h, this.v, this.w);
      const alpha = this.#energyBoundedBlend();
      for (let k = 0; k < n * 3; k++) {
        this.v[k] = this.#vPre[k] + alpha * (this.v[k] - this.#vPre[k]);
        this.w[k] = this.#wPre[k] + alpha * (this.w[k] - this.#wPre[k]);
      }
    }
    // 4. Velocity pass. A projected joint stops dead along the projection axis (inelastic
    // limit: the projection's own displacement must not become a rebound).
    for (let s = 0; s < n; s++) if (this.#stopped[s]) this.#limitStop(s);
    let contacts = 0;
    for (let k = 0; k < m.sphereSeg.length; k++) if (this.cOn[k]) { contacts++; this.#contactVelocity(k, h, g); }
    this.report.contacts = contacts;
    const cMuscle = 2 * MUSCLE_DAMPING_RATIO * omega;
    for (let s = 0; s < n; s++) if (m.segParent[s] >= 0) this.#jointDamping(s, PASSIVE_JOINT_DAMPING + cMuscle, h);
  }

  /** Generalised inverse mass of segment s for a unit direction n applied at offset r (world). */
  #gim(s: number, rx: number, ry: number, rz: number, nx: number, ny: number, nz: number): number {
    const cx = ry * nz - rz * ny, cy = rz * nx - rx * nz, cz = rx * ny - ry * nx;
    return this.model.invMass[s] + this.#angGim(s, cx, cy, cz);
  }

  /** a · I⁻¹ a for a world axis vector a (I⁻¹ in world = R·diag·Rᵀ). */
  #angGim(s: number, ax: number, ay: number, az: number): number {
    qRotateInv(SCR, 12, this.q, s * 4, ax, ay, az);
    const ii = this.model.invInertia;
    return ii[s * 3] * SCR[12] ** 2 + ii[s * 3 + 1] * SCR[13] ** 2 + ii[s * 3 + 2] * SCR[14] ** 2;
  }

  /** Rotate segment s by I⁻¹·L (world angular impulse L = (lx, ly, lz)), scaled by `sign`. */
  #applyAngular(s: number, lx: number, ly: number, lz: number, sign: number): void {
    qRotateInv(SCR, 12, this.q, s * 4, lx, ly, lz);
    const ii = this.model.invInertia;
    SCR[12] *= ii[s * 3]; SCR[13] *= ii[s * 3 + 1]; SCR[14] *= ii[s * 3 + 2];
    qRotate(SCR, 12, this.q, s * 4, SCR[12], SCR[13], SCR[14]);
    qApplyRotation(this.q, s * 4, sign * SCR[12], sign * SCR[13], sign * SCR[14]);
  }

  /** Positional impulse P (world) at offset r on segment s, with `sign` ±1. */
  #applyPositional(s: number, rx: number, ry: number, rz: number, px: number, py: number, pz: number, sign: number): void {
    const im = this.model.invMass[s] * sign;
    this.x[s * 3] += px * im; this.x[s * 3 + 1] += py * im; this.x[s * 3 + 2] += pz * im;
    this.#applyAngular(s, ry * pz - rz * py, rz * px - rx * pz, rx * py - ry * px, sign);
  }

  /** Joint anchor: parent point and child point coincide (hard). */
  #anchor(s: number): void {
    const m = this.model, p = m.segParent[s];
    qRotate(SCR, 0, this.q, p * 4, m.anchorParent[s * 3], m.anchorParent[s * 3 + 1], m.anchorParent[s * 3 + 2]);
    qRotate(SCR, 3, this.q, s * 4, m.anchorChild[s * 3], m.anchorChild[s * 3 + 1], m.anchorChild[s * 3 + 2]);
    const ax = SCR[0], ay = SCR[1], az = SCR[2], bx = SCR[3], by = SCR[4], bz = SCR[5];
    const dx = this.x[p * 3] + ax - this.x[s * 3] - bx, dy = this.x[p * 3 + 1] + ay - this.x[s * 3 + 1] - by, dz = this.x[p * 3 + 2] + az - this.x[s * 3 + 2] - bz;
    const C = Math.hypot(dx, dy, dz);
    if (C < 1e-9) return;
    const nx = dx / C, ny = dy / C, nz = dz / C;
    const w = this.#gim(p, ax, ay, az, nx, ny, nz) + this.#gim(s, bx, by, bz, nx, ny, nz);
    const dl = -C / w;
    this.#applyPositional(p, ax, ay, az, dl * nx, dl * ny, dl * nz, 1);
    this.#applyPositional(s, bx, by, bz, dl * nx, dl * ny, dl * nz, -1);
  }

  /**
   * Rotate child s (and the parent, oppositely) by the world rotation vector (ex, ey, ez):
   * Δλ = (C − α̃λ)/(w + α̃), C = |e|, with α̃ = 0 for a hard constraint. Returns Δλ.
   */
  #angular(s: number, ex: number, ey: number, ez: number, alphaTilde: number, lam: number, lamMax: number): number {
    const p = this.model.segParent[s];
    const C = Math.hypot(ex, ey, ez);
    if (C < 1e-9) return 0;
    const nx = ex / C, ny = ey / C, nz = ez / C;
    const w = this.#angGim(s, nx, ny, nz) + this.#angGim(p, nx, ny, nz);
    let dl = (C - alphaTilde * lam) / (w + alphaTilde);
    if (lam + dl > lamMax) dl = lamMax - lam;
    if (dl <= 0) return 0;
    this.#applyAngular(s, nx * dl, ny * dl, nz * dl, 1);
    this.#applyAngular(p, nx * dl, ny * dl, nz * dl, -1);
    return dl;
  }

  /** Joint limits: project the joint angles into their box and rotate the error away (hard). */
  #limit(s: number): void {
    const m = this.model, p = m.segParent[s], L = m.limits, li = s * 6;
    qConjMul(SCR, 0, this.q, p * 4, this.q, s * 4);      // q_rel
    qConjMul(SCR, 4, m.restRel, s * 4, SCR, 0);          // q_joint
    qToFlexAbductTwist(SCR, 8, SCR, 4);
    const f = clampAngle(SCR[8], L[li], L[li + 1]), a = clampAngle(SCR[9], L[li + 2], L[li + 3]), t = clampAngle(SCR[10], L[li + 4], L[li + 5]);
    if (f === SCR[8] && a === SCR[9] && t === SCR[10]) return;
    qFromFlexAbductTwist(SCR, 4, f, a, t);               // clamped q_joint
    qMul(SCR, 0, m.restRel, s * 4, SCR, 4);              // clamped q_rel
    this.#errorTo(s, p, 0);
    this.#angular(s, SCR[8], SCR[9], SCR[10], 0, 0, Infinity);
  }

  /** SCR[8..10] = rotation vector taking the child's world orientation to q_parent·SCR[ri..ri+3]. */
  #errorTo(s: number, p: number, ri: number): void {
    qMul(SCR, 12, this.q, p * 4, SCR, ri);                // desired child world
    qMulConj(SCR, 4, SCR, 12, this.q, s * 4);            // desired · current⁻¹
    qToRotationVector(SCR, 8, SCR, 4);
  }

  /**
   * Kinematic limit projection (root → leaves): for each joint out of its box, turn the child's
   * whole subtree about the joint point by Δ = q_clamped·q_current⁻¹, so the anchors stay
   * joined and earlier joints stay satisfied. Velocities are untouched.
   */
  #projectLimits(): boolean {
    const m = this.model, L = m.limits;
    let moved = false;
    for (let s = 0; s < m.n; s++) {
      const p = m.segParent[s];
      if (p < 0) continue;
      const li = s * 6;
      qConjMul(SCR, 0, this.q, p * 4, this.q, s * 4);
      qConjMul(SCR, 4, m.restRel, s * 4, SCR, 0);
      qToFlexAbductTwist(SCR, 8, SCR, 4);
      const f = clampAngle(SCR[8], L[li], L[li + 1]), a = clampAngle(SCR[9], L[li + 2], L[li + 3]), t = clampAngle(SCR[10], L[li + 4], L[li + 5]);
      if (Math.abs(f - SCR[8]) + Math.abs(a - SCR[9]) + Math.abs(t - SCR[10]) < 1e-7) continue;
      moved = true;
      qFromFlexAbductTwist(SCR, 4, f, a, t);
      qMul(SCR, 0, m.restRel, s * 4, SCR, 4);               // clamped q_rel
      qMul(SCR, 12, this.q, p * 4, SCR, 0);                 // desired child world
      qMulConj(DQ, 0, SCR, 12, this.q, s * 4);              // Δ (world)
      qNormalize(DQ, 0);
      // Remember the inward axis: the velocity clamp stops motion further out along it.
      qToRotationVector(SCR, 8, DQ, 0);
      const ang = Math.hypot(SCR[8], SCR[9], SCR[10]);
      if (ang > 1e-9) { this.#stop[s * 3] = SCR[8] / ang; this.#stop[s * 3 + 1] = SCR[9] / ang; this.#stop[s * 3 + 2] = SCR[10] / ang; this.#stopped[s] = 1; }
      // Joint point (world), from the parent.
      qRotate(SCR, 0, this.q, p * 4, m.anchorParent[s * 3], m.anchorParent[s * 3 + 1], m.anchorParent[s * 3 + 2]);
      const jx = this.x[p * 3] + SCR[0], jy = this.x[p * 3 + 1] + SCR[1], jz = this.x[p * 3 + 2] + SCR[2];
      for (let k = this.#subStart[s]; k < this.#subStart[s + 1]; k++) {
        const u = this.#subList[k], i = u * 3;
        qRotate(SCR, 0, DQ, 0, this.x[i] - jx, this.x[i + 1] - jy, this.x[i + 2] - jz);
        this.x[i] = jx + SCR[0]; this.x[i + 1] = jy + SCR[1]; this.x[i + 2] = jz + SCR[2];
        qMul(SCR, 4, DQ, 0, this.q, u * 4);
        for (let c = 0; c < 4; c++) this.q[u * 4 + c] = SCR[4 + c];
        qNormalize(this.q, u * 4);
      }
    }
    return moved;
  }

  /** v = Δx/h and ω = 2·vec(q·q_prev⁻¹)/h for every segment, into (v, w). */
  #velocities(h: number, v: Float64Array, w: Float64Array): void {
    for (let s = 0; s < this.model.n; s++) {
      const i = s * 3;
      v[i] = (this.x[i] - this.px[i]) / h; v[i + 1] = (this.x[i + 1] - this.px[i + 1]) / h; v[i + 2] = (this.x[i + 2] - this.px[i + 2]) / h;
      qMulConj(SCR, 0, this.q, s * 4, this.pq, s * 4);
      if (SCR[3] < 0) { SCR[0] = -SCR[0]; SCR[1] = -SCR[1]; SCR[2] = -SCR[2]; SCR[3] = -SCR[3]; }
      w[i] = 2 * SCR[0] / h; w[i + 1] = 2 * SCR[1] / h; w[i + 2] = 2 * SCR[2] / h;
    }
  }

  /**
   * The α ∈ [0, 1] that MINIMISES KE(v_pre + α·Δv), Δv = (this.v, this.w) − (v_pre, w_pre):
   * KE(α) = KE_pre + α·B + α²·A, A = ½ Σ (m|Δv|² + Δωᵀ I Δω) ≥ 0, B = Σ (m v_pre·Δv + ω_preᵀ I Δω),
   * so α = clamp(−B/(2A), 0, 1) when B < 0, else 0 — an INELASTIC stop: the projection may
   * remove the motion that drove a limb past its limit but never return it as a bounce (the
   * energy-preserving root −B/A would bounce elastically, substep after substep).
   */
  #energyBoundedBlend(): number {
    const m = this.model;
    let A = 0, B = 0;
    for (let s = 0; s < m.n; s++) {
      const i = s * 3;
      const dx = this.v[i] - this.#vPre[i], dy = this.v[i + 1] - this.#vPre[i + 1], dz = this.v[i + 2] - this.#vPre[i + 2];
      A += 0.5 * m.mass[s] * (dx * dx + dy * dy + dz * dz);
      B += m.mass[s] * (this.#vPre[i] * dx + this.#vPre[i + 1] * dy + this.#vPre[i + 2] * dz);
      qRotateInv(SCR, 0, this.q, s * 4, this.w[i] - this.#wPre[i], this.w[i + 1] - this.#wPre[i + 1], this.w[i + 2] - this.#wPre[i + 2]);
      qRotateInv(SCR, 3, this.q, s * 4, this.#wPre[i], this.#wPre[i + 1], this.#wPre[i + 2]);
      for (let k = 0; k < 3; k++) {
        A += 0.5 * m.inertia[i + k] * SCR[k] * SCR[k];
        B += m.inertia[i + k] * SCR[3 + k] * SCR[k];
      }
    }
    if (B >= 0 || A < 1e-12) return 0;
    return Math.min(1, -B / (2 * A));
  }

  /**
   * Inelastic limit stop: a joint that was projected back into its range loses its relative
   * angular velocity along the projection axis n — neither the outward push nor the rebound
   * the projection's displacement would otherwise create: c = (ω_child − ω_parent)·n → 0,
   * the impulse split by the two inertias.
   */
  #limitStop(s: number): void {
    const m = this.model, p = m.segParent[s], i = s * 3, j = p * 3;
    const nx = this.#stop[i], ny = this.#stop[i + 1], nz = this.#stop[i + 2];
    const c = (this.w[i] - this.w[j]) * nx + (this.w[i + 1] - this.w[j + 1]) * ny + (this.w[i + 2] - this.w[j + 2]) * nz;
    if (c === 0) return;
    const w = this.#angGim(s, nx, ny, nz) + this.#angGim(p, nx, ny, nz);
    const L = -c / w;
    this.#angularImpulse(s, nx * L, ny * L, nz * L);
    this.#angularImpulse(p, -nx * L, -ny * L, -nz * L);
  }

  /** Muscle drive toward the target relative rotation: compliant, torque-capped. */
  #drive(s: number, h: number, omega: number): void {
    const m = this.model, p = m.segParent[s];
    for (let k = 0; k < 4; k++) SCR[k] = this.target[s * 4 + k];
    this.#errorTo(s, p, 0);
    const C = Math.hypot(SCR[8], SCR[9], SCR[10]);
    if (C < 1e-6) return;
    const nx = SCR[8] / C, ny = SCR[9] / C, nz = SCR[10] / C;
    const w = this.#angGim(s, nx, ny, nz) + this.#angGim(p, nx, ny, nz);
    // k = I_eff·ω² with I_eff = 1/w  →  α = w/ω²,  α̃ = α/h².
    const alphaTilde = w / (omega * omega * h * h);
    const lamMax = MUSCLE_HOLD_RATIO * this.holdTorque[s] * this.torqueScale * this.reflex * h * h;
    this.lambda[s] += this.#angular(s, SCR[8], SCR[9], SCR[10], alphaTilde, this.lambda[s], lamMax);
  }

  /** Self-collision between two non-adjacent segments' capsules (hard, inequality). */
  #self(i: number, j: number): void {
    const m = this.model;
    // World capsule endpoints.
    qRotate(SCR, 0, this.q, i * 4, m.selfA[i * 3], m.selfA[i * 3 + 1], m.selfA[i * 3 + 2]);
    qRotate(SCR, 3, this.q, i * 4, m.selfB[i * 3], m.selfB[i * 3 + 1], m.selfB[i * 3 + 2]);
    qRotate(SCR, 6, this.q, j * 4, m.selfA[j * 3], m.selfA[j * 3 + 1], m.selfA[j * 3 + 2]);
    qRotate(SCR, 9, this.q, j * 4, m.selfB[j * 3], m.selfB[j * 3 + 1], m.selfB[j * 3 + 2]);
    const xi = this.x[i * 3], yi = this.x[i * 3 + 1], zi = this.x[i * 3 + 2], xj = this.x[j * 3], yj = this.x[j * 3 + 1], zj = this.x[j * 3 + 2];
    const ra = m.selfR[i], rb = m.selfR[j];
    const d = segmentSegment(xi + SCR[0], yi + SCR[1], zi + SCR[2], xi + SCR[3], yi + SCR[4], zi + SCR[5],
      xj + SCR[6], yj + SCR[7], zj + SCR[8], xj + SCR[9], yj + SCR[10], zj + SCR[11], SS);
    const C = ra + rb - d;
    if (C <= 0 || d < 1e-9) return;
    // Closest points (relative to each COM).
    const aix = SCR[0] + (SCR[3] - SCR[0]) * SS.s, aiy = SCR[1] + (SCR[4] - SCR[1]) * SS.s, aiz = SCR[2] + (SCR[5] - SCR[2]) * SS.s;
    const bjx = SCR[6] + (SCR[9] - SCR[6]) * SS.t, bjy = SCR[7] + (SCR[10] - SCR[7]) * SS.t, bjz = SCR[8] + (SCR[11] - SCR[8]) * SS.t;
    const nx = (xi + aix - xj - bjx) / d, ny = (yi + aiy - yj - bjy) / d, nz = (zi + aiz - zj - bjz) / d; // j → i
    const rix = aix - nx * ra, riy = aiy - ny * ra, riz = aiz - nz * ra;
    const rjx = bjx + nx * rb, rjy = bjy + ny * rb, rjz = bjz + nz * rb;
    const w = this.#gim(i, rix, riy, riz, nx, ny, nz) + this.#gim(j, rjx, rjy, rjz, nx, ny, nz);
    const dl = C / w;
    this.#applyPositional(i, rix, riy, riz, dl * nx, dl * ny, dl * nz, 1);
    this.#applyPositional(j, rjx, rjy, rjz, dl * nx, dl * ny, dl * nz, -1);
  }

  /** World contacts for every sphere: normal push-out, then static friction (positional). */
  #contacts(world: RagdollWorld, first: boolean, record = true): void {
    const m = this.model, ns = m.sphereSeg.length;
    for (let k = 0; k < ns; k++) {
      const s = m.sphereSeg[k], i = s * 3, rad = m.sphereRadius[k];
      qRotate(SCR, 0, this.q, s * 4, m.sphereLocal[k * 3], m.sphereLocal[k * 3 + 1], m.sphereLocal[k * 3 + 2]);
      const cx = this.x[i] + SCR[0], cy = this.x[i + 1] + SCR[1], cz = this.x[i + 2] + SCR[2];
      if (!world.sphereContact(cx, cy, cz, rad, SC)) continue;
      const nx = SC.nx, ny = SC.ny, nz = SC.nz;
      const rx = SCR[0] - nx * rad, ry = SCR[1] - ny * rad, rz = SCR[2] - nz * rad;
      if (record && (first || !this.cOn[k])) {
        // Normal velocity before the solve (for restitution), from the substep-start state.
        this.cVn[k] = (this.v[i] + this.w[i + 1] * rz - this.w[i + 2] * ry) * nx
          + (this.v[i + 1] + this.w[i + 2] * rx - this.w[i] * rz) * ny
          + (this.v[i + 2] + this.w[i] * ry - this.w[i + 1] * rx) * nz;
      }
      const w = this.#gim(s, rx, ry, rz, nx, ny, nz);
      const dl = SC.depth / w;
      this.#applyPositional(s, rx, ry, rz, dl * nx, dl * ny, dl * nz, 1);
      if (!record) continue;
      this.cOn[k] = 1; this.cLam[k] += dl;
      this.cN[k * 3] = nx; this.cN[k * 3 + 1] = ny; this.cN[k * 3 + 2] = nz;
      this.cMu[k] = SC.friction; this.cE[k] = SC.restitution;
      // Static friction: undo the contact point's tangential slip this substep if the
      // normal correction can hold it (|Δp_t| < μ_s·depth).
      qRotateInv(SCR, 3, this.q, s * 4, rx, ry, rz);       // body-fixed contact offset
      qRotate(SCR, 6, this.pq, s * 4, SCR[3], SCR[4], SCR[5]);
      qRotate(SCR, 9, this.q, s * 4, SCR[3], SCR[4], SCR[5]);
      const dpx = this.x[i] + SCR[9] - this.px[i] - SCR[6], dpy = this.x[i + 1] + SCR[10] - this.px[i + 1] - SCR[7], dpz = this.x[i + 2] + SCR[11] - this.px[i + 2] - SCR[8];
      const dn = dpx * nx + dpy * ny + dpz * nz;
      const tx = dpx - dn * nx, ty = dpy - dn * ny, tz = dpz - dn * nz;
      const slip = Math.hypot(tx, ty, tz);
      if (slip > 1e-9 && slip < STATIC_FRICTION_RATIO * SC.friction * SC.depth) {
        const ux = -tx / slip, uy = -ty / slip, uz = -tz / slip;
        const rx2 = SCR[9], ry2 = SCR[10], rz2 = SCR[11];
        const wt = this.#gim(s, rx2, ry2, rz2, ux, uy, uz);
        const dt = slip / wt;
        this.#applyPositional(s, rx2, ry2, rz2, dt * ux, dt * uy, dt * uz, 1);
      }
    }
  }

  /** Contact velocity response: restitution (only for real impacts) and dynamic friction. */
  #contactVelocity(k: number, h: number, g: number): void {
    const m = this.model, s = m.sphereSeg[k], i = s * 3;
    // Contact offset rebuilt from the body-fixed sphere (the stored one is from the solve).
    qRotate(SCR, 0, this.q, s * 4, m.sphereLocal[k * 3], m.sphereLocal[k * 3 + 1], m.sphereLocal[k * 3 + 2]);
    const nx = this.cN[k * 3], ny = this.cN[k * 3 + 1], nz = this.cN[k * 3 + 2], rad = m.sphereRadius[k];
    const rx = SCR[0] - nx * rad, ry = SCR[1] - ny * rad, rz = SCR[2] - nz * rad;
    const vx = this.v[i] + this.w[i + 1] * rz - this.w[i + 2] * ry;
    const vy = this.v[i + 1] + this.w[i + 2] * rx - this.w[i] * rz;
    const vz = this.v[i + 2] + this.w[i] * ry - this.w[i + 1] * rx;
    const vn = vx * nx + vy * ny + vz * nz;
    let dvx = 0, dvy = 0, dvz = 0;
    const tx = vx - vn * nx, ty = vy - vn * ny, tz = vz - vn * nz, vt = Math.hypot(tx, ty, tz);
    if (vt > 1e-9) {
      const fn = this.cLam[k] / (h * h);                  // normal force, N
      const cut = Math.min(h * this.cMu[k] * fn * m.invMass[s], vt);
      dvx -= tx / vt * cut; dvy -= ty / vt * cut; dvz -= tz / vt * cut;
    }
    // Restitution only for a real impact (|v_n| above what one substep of gravity builds), else
    // the contact is resting and the normal velocity is cancelled (Müller et al. eq. 34).
    const pre = this.cVn[k];
    const dn = (pre < -2 * g * h ? -this.cE[k] * pre : 0) - vn;
    dvx += nx * dn; dvy += ny * dn; dvz += nz * dn;
    const dv = Math.hypot(dvx, dvy, dvz);
    if (dv < 1e-12) return;
    const ux = dvx / dv, uy = dvy / dv, uz = dvz / dv;
    const w = this.#gim(s, rx, ry, rz, ux, uy, uz);
    const p = dv / w;
    const px = ux * p, py = uy * p, pz = uz * p;
    this.v[i] += px * m.invMass[s]; this.v[i + 1] += py * m.invMass[s]; this.v[i + 2] += pz * m.invMass[s];
    // ω += I⁻¹ (r × p)
    qRotateInv(SCR, 12, this.q, s * 4, ry * pz - rz * py, rz * px - rx * pz, rx * py - ry * px);
    const ii = m.invInertia;
    qRotate(SCR, 12, this.q, s * 4, SCR[12] * ii[i], SCR[13] * ii[i + 1], SCR[14] * ii[i + 2]);
    this.w[i] += SCR[12]; this.w[i + 1] += SCR[13]; this.w[i + 2] += SCR[14];
  }

  /** Joint damping: remove a fraction min(1, c·h) of the relative angular velocity. */
  #jointDamping(s: number, c: number, h: number): void {
    const m = this.model, p = m.segParent[s], i = s * 3, j = p * 3;
    const rx = this.w[i] - this.w[j], ry = this.w[i + 1] - this.w[j + 1], rz = this.w[i + 2] - this.w[j + 2];
    const mag = Math.hypot(rx, ry, rz);
    if (mag < 1e-9) return;
    const nx = rx / mag, ny = ry / mag, nz = rz / mag;
    const w = this.#angGim(s, nx, ny, nz) + this.#angGim(p, nx, ny, nz);
    const L = (mag * Math.min(1, c * h)) / w;
    this.#angularImpulse(s, -nx * L, -ny * L, -nz * L);
    this.#angularImpulse(p, nx * L, ny * L, nz * L);
  }

  /** ω_s += I_s⁻¹·L for a world angular impulse L (velocity level). */
  #angularImpulse(s: number, lx: number, ly: number, lz: number): void {
    const ii = this.model.invInertia;
    qRotateInv(SCR, 12, this.q, s * 4, lx, ly, lz);
    qRotate(SCR, 12, this.q, s * 4, SCR[12] * ii[s * 3], SCR[13] * ii[s * 3 + 1], SCR[14] * ii[s * 3 + 2]);
    this.w[s * 3] += SCR[12]; this.w[s * 3 + 1] += SCR[13]; this.w[s * 3 + 2] += SCR[14];
  }

  /** Settle detection (SETTLE_SPEED, SETTLE_RMS, sustained SETTLE_TIME) and the kill plane. */
  #detectRest(dt: number, world: RagdollWorld): void {
    const c = this.centreOfMass();
    if (c[1] < world.killPlaneY) { this.lost = true; return; }
    const v = this.comVelocity();
    // The guard is a FALL reflex: once the body lies on something and has slowed below
    // RELAX_SPEED, the muscles let go with half-life RELAX_HALF_LIFE (they would otherwise keep
    // straining against the ground and the joint stops for ever).
    if (this.report.contacts > 0 && Math.hypot(v[0], v[1], v[2]) < RELAX_SPEED) this.reflex *= Math.pow(0.5, dt / RELAX_HALF_LIFE);
    else if (this.report.contacts === 0) this.reflex = 1;
    // RMS speed of the body's mass: √(2·KE / M), KE linear + rotational (light toes spinning
    // in place weigh nothing here; a sliding torso does).
    const ke = this.energy(0);
    const rms = Math.sqrt((2 * Math.max(0, ke)) / this.model.totalMass);
    if (Math.hypot(v[0], v[1], v[2]) < SETTLE_SPEED && rms < SETTLE_RMS && this.report.contacts > 0) {
      this.#still += dt;
      if (this.#still >= SETTLE_TIME) {
        this.settled = true;
        this.v.fill(0); this.w.fill(0);
      }
    } else this.#still = 0;
  }

  /** ω_total = I_total⁻¹·L about the COM (3×3 solve); returns a cached tuple. */
  #solveTotalInertia(cx: number, cy: number, cz: number, lx: number, ly: number, lz: number): [number, number, number] {
    const m = this.model;
    const I = TI; I.fill(0);
    for (let s = 0; s < m.n; s++) {
      // R·diag·Rᵀ via the rotated basis vectors.
      for (let a = 0; a < 3; a++) {
        qRotate(SCR, 0, this.q, s * 4, a === 0 ? 1 : 0, a === 1 ? 1 : 0, a === 2 ? 1 : 0);
        const d = m.inertia[s * 3 + a];
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) I[r * 3 + c] += d * SCR[r] * SCR[c];
      }
      const dx = this.x[s * 3] - cx, dy = this.x[s * 3 + 1] - cy, dz = this.x[s * 3 + 2] - cz, d2 = dx * dx + dy * dy + dz * dz;
      const mm = m.mass[s], dv = [dx, dy, dz];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) I[r * 3 + c] += mm * ((r === c ? d2 : 0) - dv[r] * dv[c]);
    }
    const [a, b, c, d, e, f, g2, hh, k] = I;
    const det = a * (e * k - f * hh) - b * (d * k - f * g2) + c * (d * hh - e * g2);
    if (Math.abs(det) < 1e-12) { SPIN[0] = 0; SPIN[1] = 0; SPIN[2] = 0; return SPIN; }
    SPIN[0] = ((e * k - f * hh) * lx + (c * hh - b * k) * ly + (b * f - c * e) * lz) / det;
    SPIN[1] = ((f * g2 - d * k) * lx + (a * k - c * g2) * ly + (c * d - a * f) * lz) / det;
    SPIN[2] = ((d * hh - e * g2) * lx + (b * g2 - a * hh) * ly + (a * e - b * d) * lz) / det;
    return SPIN;
  }
}

const COM: [number, number, number] = [0, 0, 0];
const VEL: [number, number, number] = [0, 0, 0];
const SPIN: [number, number, number] = [0, 0, 0];
const TI = new Float64Array(9);
/** The kinematic projection's world rotation Δ. */
const DQ = new Float64Array(4);

/**
 * Holding torque per joint, N·m: the weight of the child's whole subtree times the horizontal
 * lever of its COM from the joint when the limb is held out straight (rest-pose distance):
 *   τ_hold = m_subtree · g · |COM_subtree − joint|.
 */
export function holdingTorques(m: RagdollModel, gravity: number): Float64Array {
  const n = m.n;
  // Rest pose world frames of every bone (root at identity).
  const nb = m.boneIds.length;
  const Q = new Float64Array(nb * 4), O = new Float64Array(nb * 3);
  const done = new Uint8Array(nb);
  const visit = (b: number): void => {
    if (done[b]) return;
    const p = m.boneParent[b];
    if (p < 0) { Q[b * 4 + 3] = 1; done[b] = 1; return; }
    visit(p);
    qRotate(SCR, 0, Q, p * 4, m.boneLocalPos[b * 3], m.boneLocalPos[b * 3 + 1], m.boneLocalPos[b * 3 + 2]);
    for (let k = 0; k < 3; k++) O[b * 3 + k] = O[p * 3 + k] + SCR[k];
    qMul(Q, b * 4, Q, p * 4, m.boneRestRot, b * 4);
    done[b] = 1;
  };
  for (let b = 0; b < nb; b++) visit(b);
  const comW = new Float64Array(n * 3);
  for (let s = 0; s < n; s++) {
    const b = m.segBone[s];
    qRotate(SCR, 0, Q, b * 4, m.com[s * 3], m.com[s * 3 + 1], m.com[s * 3 + 2]);
    for (let k = 0; k < 3; k++) comW[s * 3 + k] = O[b * 3 + k] + SCR[k];
  }
  const out = new Float64Array(n);
  const isDesc = (s: number, a: number): boolean => { for (let t = s; t >= 0; t = m.segParent[t]) if (t === a) return true; return false; };
  for (let s = 0; s < n; s++) {
    if (m.segParent[s] < 0) continue;
    let mass = 0, cx = 0, cy = 0, cz = 0;
    for (let t = 0; t < n; t++) if (isDesc(t, s)) { mass += m.mass[t]; cx += m.mass[t] * comW[t * 3]; cy += m.mass[t] * comW[t * 3 + 1]; cz += m.mass[t] * comW[t * 3 + 2]; }
    const b = m.segBone[s];
    const lever = Math.hypot(cx / mass - O[b * 3], cy / mass - O[b * 3 + 1], cz / mass - O[b * 3 + 2]);
    out[s] = mass * gravity * Math.max(0.02, lever);
  }
  return out;
}
