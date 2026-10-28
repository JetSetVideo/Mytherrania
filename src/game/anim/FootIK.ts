// Analytic two-bone foot IK in the sagittal plane (lane C, R04 + the foot-planting half of R03).
//
// Pure module: no Three.js, no DOM, no allocation per call (results go into caller-owned
// objects). Every leg joint of the Skeleton turns about one axis (x), so a leg is a planar
// two-bone chain hip -> knee -> ankle in its own sagittal plane (z forward, y up), and the
// law of cosines solves it exactly:
//
//   d   = |target - hip|                                  hip-to-ankle distance (m)
//   α   = acos( (t² + d² - s²) / (2 t d) )                angle between thigh and hip->target
//   γ   = acos( (t² + s² - d²) / (2 t s) )                interior knee angle
//   ψ_d = atan2(dz, -dy)                                   forward pitch of hip->target
//   ψ_thigh = ψ_d + α                                      thigh rotated FORWARD of the line,
//   ψ_shin  = ψ_thigh - (π - γ)                            so the knee juts forward (human knee)
//
// ψ is a "forward pitch" (Rig.ts): a bone hanging along (z = sin ψ, y = -cos ψ). The knee
// flexion ψ_shin - ψ_thigh = -(π - γ) is <= 0, which is exactly the Skeleton's knee angle.
// Reach is clamped into [|t - s| + ε, t + s - ε]; when the target is too far the solver still
// returns the best straight-ish leg and reports `pelvisDrop`, the height the hip must lower
// for the target to become reachable (the animator lowers the pelvis by it).

import { clamp, clamp01, lerp } from "../../core/MathCore.ts";
import { RIG_ROTATION_SIGN } from "./Rig.ts";

/**
 * A planar two-bone chain. `upper` (thigh) and `lower` (shin) are bone lengths in metres.
 * `reachMargin` (m) keeps the leg off full extension: max reach = upper + lower - reachMargin.
 * `softness` (m) is the width of the smooth saturation below max reach: a target closer than
 * maxReach - softness is hit EXACTLY; beyond it the used reach bends smoothly (C1) into the
 * limit instead of snapping, so the knee never flicks straight.
 */
export interface TwoBoneChain {
  upper: number;
  lower: number;
  reachMargin: number;
  softness: number;
}

/** Default margin: ε = 0.1 mm, the "clamp reach to t+s-ε" of the spec. */
export const IK_EPSILON = 1e-4;

/** Result of solveTwoBone (caller-owned, overwritten each call). Angles in radians, lengths in m. */
export interface TwoBoneResult {
  /** Forward pitch of the upper bone (thigh). */
  upperPitch: number;
  /** Forward pitch of the lower bone (shin). */
  lowerPitch: number;
  /** lowerPitch - upperPitch, always <= 0: the Skeleton knee angle. */
  kneeFlex: number;
  /** Where the chain actually ends (the solved ankle), same frame as the inputs. */
  endY: number;
  endZ: number;
  /** Hip-to-ankle distance actually used after clamping. */
  reach: number;
  /** True when the target distance lies inside [minReach, maxReach]. */
  reachable: boolean;
  /** Metres the hip must move DOWN so the target lies in the exact zone (0 when it already does). */
  pelvisDrop: number;
}

/** A zeroed TwoBoneResult to reuse. */
export function newTwoBoneResult(): TwoBoneResult {
  return { upperPitch: 0, lowerPitch: 0, kneeFlex: 0, endY: 0, endZ: 0, reach: 0, reachable: true, pelvisDrop: 0 };
}

/**
 * Polynomial smooth minimum of a and b over a blend width k (Quilez): equals min(a, b) when
 * |a - b| >= k, and is C1 and never above either input in between. k <= 0 -> plain min.
 */
export function smoothMin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = clamp01(0.5 + 0.5 * (b - a) / k);
  return lerp(b, a, h) - k * h * (1 - h);
}

/** Smooth maximum, the mirror of smoothMin: smoothMax(a, b, k) = -smoothMin(-a, -b, k). */
export function smoothMax(a: number, b: number, k: number): number {
  return -smoothMin(-a, -b, k);
}

/**
 * Height the hip at (hipY, hipZ) must drop so a target at (targetY, targetZ) is at distance
 * `limit` or closer: hip' = targetY + sqrt(limit² - dz²). When |dz| >= limit no drop can help
 * and the drop brings the hip to the target's height (the best a vertical move can do).
 * Never negative (this function never asks the pelvis to RISE).
 */
export function pelvisDropFor(hipY: number, hipZ: number, targetY: number, targetZ: number, limit: number): number {
  const dz = targetZ - hipZ;
  const rise = limit * limit - dz * dz;
  const best = rise > 0 ? targetY + Math.sqrt(rise) : targetY;
  return Math.max(0, hipY - best);
}

/**
 * Solve the planar two-bone chain rooted at (hipY, hipZ) for an ankle target (targetY,
 * targetZ). Knee bends forward only. Writes and returns `out`.
 */
export function solveTwoBone(
  hipY: number, hipZ: number, targetY: number, targetZ: number, chain: TwoBoneChain, out: TwoBoneResult,
): TwoBoneResult {
  const t = chain.upper, s = chain.lower;
  const dz = targetZ - hipZ, dy = targetY - hipY;
  const d = Math.hypot(dz, dy);
  const maxReach = t + s - Math.max(IK_EPSILON, chain.reachMargin);
  const minReach = Math.abs(t - s) + IK_EPSILON;
  const exactLimit = maxReach - Math.max(0, chain.softness);
  // Soft saturation toward maxReach (exact below exactLimit), then the hard window.
  const used = clamp(smoothMin(d, maxReach, chain.softness), minReach, maxReach);
  const dirPitch = d > 1e-9 ? Math.atan2(dz, -dy) : 0;
  const alpha = Math.acos(clamp((t * t + used * used - s * s) / (2 * t * used), -1, 1));
  const gamma = Math.acos(clamp((t * t + s * s - used * used) / (2 * t * s), -1, 1));
  const upper = dirPitch + alpha;
  const lower = upper - (Math.PI - gamma);
  out.upperPitch = upper;
  out.lowerPitch = lower;
  out.kneeFlex = lower - upper;
  out.endZ = hipZ + t * Math.sin(upper) + s * Math.sin(lower);
  out.endY = hipY - t * Math.cos(upper) - s * Math.cos(lower);
  out.reach = used;
  out.reachable = d >= minReach && d <= maxReach;
  out.pelvisDrop = d > exactLimit ? pelvisDropFor(hipY, hipZ, targetY, targetZ, exactLimit) : 0;
  return out;
}

/** Ground under a point: its height (m) and the slope pitch along a horizontal direction. */
export interface GroundSample {
  /** Ground height at the point, world metres. */
  height: number;
  /** Rise angle of the ground along the probe direction, radians (> 0 = uphill ahead). */
  slopePitch: number;
}

/** A height-field query: world (x, z) -> ground height y, metres. Lane E's terrain plugs in here. */
export type GroundHeightFn = (x: number, z: number) => number;

/**
 * Sample the ground at (x, z) and its slope along the unit direction (dirX, dirZ) by a central
 * difference over ±halfSpan metres: slopePitch = atan2(h(+) - h(-), 2·halfSpan).
 * Only the slope ALONG the direction is measured: single-axis legs cannot bank sideways.
 */
export function sampleGround(
  ground: GroundHeightFn, x: number, z: number, dirX: number, dirZ: number, halfSpan: number, out: GroundSample,
): GroundSample {
  const h = Math.max(1e-3, halfSpan);
  out.height = ground(x, z);
  const ahead = ground(x + dirX * h, z + dirZ * h);
  const behind = ground(x - dirX * h, z - dirZ * h);
  out.slopePitch = Math.atan2(ahead - behind, 2 * h);
  return out;
}

/**
 * Ankle pivot for a foot whose BALL rests at (ballY, ballZ) with toe-down pitch `footPitch`
 * (rig rotation of the foot frame). In the foot frame the ball sits at (y = -soleOffset,
 * z = ballForward) from the ankle, so
 *   ankle = ball - Rot(footPitch)·(-soleOffset, ballForward)
 *         = (ballY + soleOffset·cosΘ + ballForward·sinΘ,  ballZ + soleOffset·sinΘ - ballForward·cosΘ).
 * A level foot (Θ = 0) puts the ankle soleOffset above and ballForward behind the ball; a
 * toe-down Θ lifts the heel about the ball (push-off). Writes [y, z] into `out`.
 */
export function ankleFromBall(
  ballY: number, ballZ: number, footPitch: number, soleOffset: number, ballForward: number, out: Float64Array,
): void {
  const c = Math.cos(footPitch), s = Math.sin(footPitch);
  out[0] = ballY + soleOffset * c + ballForward * s;
  out[1] = ballZ + soleOffset * s - ballForward * c;
}

/** Joint angles of one leg in the Skeleton convention (Rig.ts), plus diagnostics. */
export interface LegSolution {
  hip: number;
  knee: number;
  ankle: number;
  toe: number;
  /** Metres the pelvis must drop for this foot target (see TwoBoneResult.pelvisDrop). */
  pelvisDrop: number;
  reachable: boolean;
  /** Hip abduction (rad, rotation about the pelvis's forward axis, + toward local +x); 0 when sagittal. */
  roll: number;
  /** Distance (m) between the ankle the solution reaches and the target (0 = hit). */
  residual: number;
}

/** A zeroed LegSolution to reuse. */
export function newLegSolution(): LegSolution {
  return { hip: 0, knee: 0, ankle: 0, toe: 0, pelvisDrop: 0, reachable: true, roll: 0, residual: 0 };
}

const ANKLE = new Float64Array(2);
const IK = newTwoBoneResult();

/**
 * Full leg solve in the rig's sagittal frame (y up, z forward, metres, relative to any common
 * origin). Inputs: the hip pivot, the pelvis rig rotation R_pelvis (Rig.hipPivot), the CONTACT
 * point of the sole (the ball by default; pass contactForward = -heelBack to pivot on the heel),
 * the foot's toe-down pitch Θ (ABSOLUTE: -slopePitch for a sole parallel to the ground, plus any
 * roll) and the ground's own pitch for the toes.
 *   hip   = sign_hip·(R_thigh - R_pelvis),   R_thigh = -ψ_thigh
 *   knee  = sign_knee·(R_shin - R_thigh) = ψ_shin - ψ_thigh
 *   ankle = Θ - R_shin                       (R_foot = R_shin + ankle = Θ)
 *   toe   = -groundPitch - Θ                 (the toes lie flat on the ground)
 * Returns the angles UNCLAMPED (the blender clamps to the joint limits).
 */
export function solveLeg(
  hipY: number, hipZ: number, pelvisR: number,
  contactY: number, contactZ: number, footPitch: number, groundPitch: number,
  geom: { thigh: number; shin: number; soleOffset: number; ballForward: number },
  chain: TwoBoneChain, out: LegSolution, contactForward: number = geom.ballForward, ik: TwoBoneResult = IK,
): LegSolution {
  ankleFromBall(contactY, contactZ, footPitch, geom.soleOffset, contactForward, ANKLE);
  solveTwoBone(hipY, hipZ, ANKLE[0], ANKLE[1], chain, ik);
  const Rthigh = -ik.upperPitch, Rshin = -ik.lowerPitch;
  out.hip = RIG_ROTATION_SIGN.hipL * (Rthigh - pelvisR);
  out.knee = RIG_ROTATION_SIGN.kneeL * (Rshin - Rthigh);
  out.ankle = footPitch - Rshin;
  out.toe = -groundPitch - footPitch;
  out.pelvisDrop = ik.pelvisDrop;
  out.reachable = ik.reachable;
  out.roll = 0;
  out.residual = Math.hypot(ik.endY - ANKLE[0], ik.endZ - ANKLE[1]);
  return out;
}

/**
 * Three-dimensional leg solve with hip ABDUCTION: the leg plane first tilts about the pelvis's
 * forward axis by `roll` (rig Euler order ZYX on the hip: M = Rz(roll)·Rx(pitch)), then the
 * planar two-bone IK runs inside it. So a foot that is beside the hip (strafing, turning on the
 * spot) is reached instead of dragged. Input: the ankle target minus the hip pivot (dx lateral,
 * dy up, dz forward) in the rig's local frame, the pelvis rig rotation R_pelvis, the foot's
 * toe-down pitch Θ and ground pitch, and the abduction window [rollMin, rollMax] (rad).
 *   pelvis frame:  (x, y, z)_p = (dx, dy cosR + dz sinR, -dy sinR + dz cosR)
 *   roll          = clamp(atan2(x_p, -y_p), rollMin, rollMax)
 *   in-plane down = -x_p sin(roll) + y_p cos(roll)   (= -hypot(x_p, y_p) when unclamped)
 *   hip = ψ_thigh (pelvis frame),  knee = ψ_shin - ψ_thigh,  ankle = Θ - R_pelvis + ψ_shin,
 *   toe = -groundPitch - Θ.  The rig counter-rolls the ankle by -roll so the sole stays level.
 * `pelvisDrop` is left to the caller (it needs the world vertical).
 */
export function solveLegInPelvis(
  dx: number, dy: number, dz: number, pelvisR: number, footPitch: number, groundPitch: number,
  chain: TwoBoneChain, rollMin: number, rollMax: number, out: LegSolution, ik: TwoBoneResult = IK,
): LegSolution {
  const c = Math.cos(pelvisR), s = Math.sin(pelvisR);
  const xp = dx, yp = dy * c + dz * s, zp = -dy * s + dz * c;
  const roll = clamp(Math.atan2(xp, -yp), rollMin, rollMax);
  const down = -xp * Math.sin(roll) + yp * Math.cos(roll);
  solveTwoBone(0, 0, down, zp, chain, ik);
  out.hip = RIG_ROTATION_SIGN.hipL * ik.upperPitch * -1;
  out.knee = RIG_ROTATION_SIGN.kneeL * (ik.upperPitch - ik.lowerPitch);
  out.ankle = footPitch - pelvisR + ik.lowerPitch;
  out.toe = -groundPitch - footPitch;
  out.roll = roll;
  out.reachable = ik.reachable;
  out.pelvisDrop = ik.pelvisDrop;
  // In-plane miss plus the out-of-plane miss left by a clamped abduction.
  out.residual = Math.hypot(ik.endY - down, ik.endZ - zp, xp * Math.cos(roll) + yp * Math.sin(roll));
  return out;
}
