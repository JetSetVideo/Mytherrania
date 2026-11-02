// Wave X (lane L): the feet's natural turn-out ("feet point a bit more outward by default").
//
// A standing human's feet are not parallel: each foot points ~7-12 degrees outward of the line of
// travel (the "foot progression angle"). Every leg joint of the Skeleton is single-axis (pitch) plus
// the hip/ankle roll channels (Skeleton.legRoll), so before this wave nothing could yaw a foot and
// the measured toe-out was 0 degrees in every pose. This module owns the angle; the Skeleton carries
// it in `legRoll.toeOut` (written by the Animator every frame, at rest for an undriven skeleton) and
// the rig applies it at the ankle about the VERTICAL through the ankle (Rig.legFK3's `toeOut`: the
// sole points' horizontal offsets turn, their heights stay — so sole pitch, ground contact and the
// IK are exactly the pre-wave-X ones); the skinned renderer must apply the same world-vertical yaw —
// see artifacts/messages-wave-x-L.md for the render-side hookup.
//
// Convention: `toeOut` is a MAGNITUDE per foot, rad, positive = toes outward. The signed yaw a leg
// applies is toeOutYaw(lateral, toeOut) = sign(lateral) · toeOut, where `lateral` is that hip's
// signed local x (LegGeometry.hipLateral): each foot turns its toes toward its OWN side, so the
// two feet are mirrored by construction whichever side a rig puts its left hip on.
//
// Constant across idle, guard, stance and gait: a CHANGING yaw while a foot is planted would slide
// its ball about the ankle (Δx ≈ ballForward · Δyaw), and the planted-foot tests forbid that.
//
// Pure module: no THREE, no DOM.

/**
 * Default toe-out of each foot, degrees (inside the brief's 8-12 band). 9, not 10: at 10 the
 * existing ±15° cross-fall pin failed by a hair (a planted sole 10.2 mm off the slope vs its 10 mm
 * band — a turned-out foot's heel and toe stand on different heights of a cross slope); at 9 every
 * planted-foot band holds.
 */
export const TOE_OUT_DEG = 9;
/** The same, rad. */
export const TOE_OUT_RAD = TOE_OUT_DEG * Math.PI / 180;
/** Lowest / highest toe-out any caller may ask for, rad (2..20 deg). */
export const TOE_OUT_MIN = 2 * Math.PI / 180, TOE_OUT_MAX = 20 * Math.PI / 180;
/** +1 for a hip on the +x side, −1 on the −x side (0 counts as +x). */
export function outwardSign(lateral: number): 1 | -1 {
  return lateral < 0 ? -1 : 1;
}

/** A toe-out magnitude clamped into the safe band (non-finite = the default). */
export function toeOutOf(deg?: number): number {
  const r = Number.isFinite(deg) ? (deg as number) * Math.PI / 180 : TOE_OUT_RAD;
  return Math.max(TOE_OUT_MIN, Math.min(TOE_OUT_MAX, r));
}

/** The signed yaw (rad, about the vertical, +y) a leg at hip lateral `lateral` applies. */
export function toeOutYaw(lateral: number, toeOut: number): number {
  return outwardSign(lateral) * (Number.isFinite(toeOut) ? toeOut : 0);
}

/**
 * The measured toe-out of a foot, rad, from its heel and toe points (rig-local x lateral, z
 * forward): the angle of heel->toe away from straight ahead, positive = outward for that side.
 */
export function measuredToeOut(lateral: number, heel: ArrayLike<number>, toe: ArrayLike<number>): number {
  return outwardSign(lateral) * Math.atan2(toe[0] - heel[0], toe[2] - heel[2]);
}
