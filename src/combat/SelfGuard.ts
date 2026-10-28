// Lane X (W05): the holder's own weapon never passes through the holder. Pure module (no THREE).
//
//   selfClearance()  signed: max over (feature, own hitbox) of (R + r_feature + margin − distance);
//                    > 0 = the weapon is inside the body by that much, < 0 = clear by that much.
//   selfPenetration() the contract form: depth = max(0, clearance) and the push-out direction.
//   solveSelfClearance() the smallest weighted joint change that clears it: Gauss–Newton on the
//                    single constraint g(θ) = −margin, i.e. Δθ = −(g + margin)·W⁻¹∇g / (∇gᵀW⁻¹∇g),
//                    central-difference gradient, joint limits respected, ≤ maxIterations steps.
//   W = per-joint stiffness: the wrist moves first, the elbow next, the shoulder last, so the fix
//   is the least visible one. Self-contact never deals damage (the engine only sweeps OTHER
//   fighters' hitboxes); this module only moves the arm.

import type { Hitbox, HitboxSet, SelfPenetration, StrikeSample, V3, WeaponSpec } from "./contracts.ts";
import { SEG_SEG, segSeg } from "./Geom.ts";

/** Clearance (m) the solver aims for beyond contact, so the blade does not graze the skin. */
export const SELF_MARGIN = 0.005;
/** Solver iteration cap (each costs 2 evaluations per joint + up to 3 line-search steps). */
export const SELF_MAX_ITERATIONS = 6;
/** Finite-difference step for the gradient, rad. */
export const SELF_FD_STEP = 0.01;
/** Largest single correction per joint per iteration, rad (keeps the linearisation honest). */
export const SELF_MAX_STEP = 0.6;

/** Which own hitboxes the weapon may touch: the gripping hand(s) and forearm(s). */
export interface SelfOptions {
  /** Side of the main (gripping) hand. Default "R" (the rig mounts the weapon on elbowR). */
  gripSide?: "L" | "R";
  /** Hands on the weapon: 2 also excludes the off hand and forearm. Default: 2 when weapon.hands === 2. */
  handsUsed?: 1 | 2;
  /** Extra clearance counted as penetration, m. Default 0 (the solver adds SELF_MARGIN itself). */
  margin?: number;
  /**
   * False when the hitbox set is NOT the holder's (lane X2: keeping a blade out of the OTHER body):
   * no hand/forearm is "holding" the weapon there, so none is excluded. Default true.
   */
  excludeGrip?: boolean;
}

/** True when the holder's weapon is allowed to touch this own hitbox (it is holding it). */
export function gripExcluded(box: Hitbox, weapon: WeaponSpec, opts: SelfOptions = {}): boolean {
  if (opts.excludeGrip === false) return false;
  const grip = opts.gripSide ?? "R";
  const hands = opts.handsUsed ?? (weapon.hands === 2 ? 2 : 1);
  if (box.zone !== "hand" && box.zone !== "foreArm") return false;
  return box.side === grip || hands === 2;
}

const W = new Float64Array(3);
/** The deepest pair found by selfClearance (scratch, read right after the call). */
const DEEP = { pen: -Infinity, box: null as Hitbox | null, fx: 0, fy: 0, fz: 0, bx: 0, by: 0, bz: 0 };

/** Signed penetration (m) of the weapon's features into the holder's own hitboxes (module comment). */
export function selfClearance(strike: StrikeSample, own: HitboxSet, weapon: WeaponSpec, opts: SelfOptions = {}): number {
  const m = strike.matrix, margin = opts.margin ?? 0;
  DEEP.pen = -Infinity; DEEP.box = null;
  for (const f of weapon.features) {
    const n = f.points.length;
    for (let k = 0; k < Math.max(1, n - 1); k++) {
      const p = f.points[k], q = f.points[Math.min(n - 1, k + 1)];
      const px = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], py = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], pz = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
      W[0] = m[0] * q[0] + m[4] * q[1] + m[8] * q[2] + m[12]; W[1] = m[1] * q[0] + m[5] * q[1] + m[9] * q[2] + m[13]; W[2] = m[2] * q[0] + m[6] * q[1] + m[10] * q[2] + m[14];
      for (const b of own.boxes) {
        if (gripExcluded(b, weapon, opts)) continue;
        const d = Math.sqrt(segSeg(px, py, pz, W[0], W[1], W[2], b.wa[0], b.wa[1], b.wa[2], b.wb[0], b.wb[1], b.wb[2]));
        const pen = b.radius + f.radius + margin - d;
        if (pen > DEEP.pen) {
          DEEP.pen = pen; DEEP.box = b;
          DEEP.fx = SEG_SEG.ax; DEEP.fy = SEG_SEG.ay; DEEP.fz = SEG_SEG.az; DEEP.bx = SEG_SEG.bx; DEEP.by = SEG_SEG.by; DEEP.bz = SEG_SEG.bz;
        }
      }
    }
  }
  return DEEP.pen;
}

/**
 * Contract entry point: the deepest penetration of the holder's weapon into its OWN hitboxes
 * (excluding the gripping hand/forearm, and both when two-handed), with the world direction
 * that pushes the weapon out (from the hitbox axis toward the weapon). depth 0 = clear.
 */
export function selfPenetration(strike: StrikeSample, own: HitboxSet, weapon: WeaponSpec, opts: SelfOptions = {}): SelfPenetration {
  const pen = selfClearance(strike, own, weapon, opts);
  if (!(pen > 0) || !DEEP.box) return { depth: 0, hitbox: null, push: [0, 0, 0] };
  const dx = DEEP.fx - DEEP.bx, dy = DEEP.fy - DEEP.by, dz = DEEP.fz - DEEP.bz, l = Math.hypot(dx, dy, dz);
  const push: V3 = l > 1e-9 ? [dx / l, dy / l, dz / l] : [0, 1, 0];
  return { depth: pen, hitbox: DEEP.box, push };
}

/** One joint the clearance solver may move. */
export interface ClearanceJoint {
  /** Skeleton JointName ("shoulderR", "elbowR") or a rig DOF ("gripPitch", "gripRoll"). */
  name: string;
  /** Current angle, rad, and its limits. */
  angle: number;
  min: number;
  max: number;
  /** Stiffness: the cost of moving this joint (higher moves less). */
  weight: number;
}

/** A clearance problem: joints plus the signed penetration as a function of their angles. */
export interface ClearanceProblem {
  joints: ClearanceJoint[];
  /** Signed penetration (m, > 0 inside) with the joints at `angles` (same order as `joints`). */
  penetration(angles: Float64Array): number;
  margin?: number;
  maxIterations?: number;
  step?: number;
}

/** Solver outcome: final angles, the corrections applied, penetration before/after (m). */
export interface ClearanceResult {
  angles: Float64Array;
  deltas: Float64Array;
  before: number;
  after: number;
  iterations: number;
  evaluations: number;
}

/** Joint stiffness defaults: wrist first, elbow next, shoulder last. */
export const SELF_JOINT_WEIGHT: Record<string, number> = { gripPitch: 1, gripRoll: 1.5, elbowR: 2, elbowL: 2, shoulderR: 4, shoulderL: 4 };

/** Minimal weighted joint change that clears the penetration (module comment). */
export function solveSelfClearance(p: ClearanceProblem): ClearanceResult {
  const n = p.joints.length, margin = p.margin ?? SELF_MARGIN, h = p.step ?? SELF_FD_STEP;
  const theta = Float64Array.from(p.joints, (j) => j.angle);
  const lo = Float64Array.from(p.joints, (j) => j.min), hi = Float64Array.from(p.joints, (j) => j.max);
  const winv = Float64Array.from(p.joints, (j) => 1 / Math.max(1e-6, j.weight));
  const probe = new Float64Array(n), grad = new Float64Array(n), next = new Float64Array(n);
  let evaluations = 0;
  const f = (a: Float64Array) => { evaluations++; const v = p.penetration(a); return Number.isFinite(v) ? v : 0; };
  const before = f(theta);
  let g = before, iterations = 0;
  for (; iterations < (p.maxIterations ?? SELF_MAX_ITERATIONS) && g > 0; iterations++) {
    // Central-difference gradient (one-sided at a limit).
    for (let j = 0; j < n; j++) {
      probe.set(theta);
      const up = Math.min(hi[j], theta[j] + h), dn = Math.max(lo[j], theta[j] - h);
      if (up - dn < 1e-9) { grad[j] = 0; continue; }
      probe[j] = up; const gu = f(probe);
      probe[j] = dn; const gd = f(probe);
      grad[j] = (gu - gd) / (up - dn);
    }
    let denom = 0;
    for (let j = 0; j < n; j++) denom += grad[j] * grad[j] * winv[j];
    if (denom < 1e-12) break;
    const scale = -(g + margin) / denom;
    // Line search: halve the step until the penetration drops.
    let alpha = 1, accepted = false;
    for (let ls = 0; ls < 4 && !accepted; ls++, alpha *= 0.5) {
      for (let j = 0; j < n; j++) {
        const d = Math.max(-SELF_MAX_STEP, Math.min(SELF_MAX_STEP, alpha * scale * winv[j] * grad[j]));
        next[j] = Math.max(lo[j], Math.min(hi[j], theta[j] + d));
      }
      const gn = f(next);
      if (gn < g) { theta.set(next); g = gn; accepted = true; }
    }
    if (!accepted) break;
  }
  const deltas = Float64Array.from(theta, (a, j) => a - p.joints[j].angle);
  return { angles: theta, deltas, before, after: g, iterations, evaluations };
}
