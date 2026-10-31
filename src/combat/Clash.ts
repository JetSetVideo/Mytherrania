// Lane I-D: blade-vs-blade clash detection. PURE module (no THREE, no per-call
// allocation beyond the returned record). Reuses the segment/segment distance
// kernel already implemented in src/combat/Geom.ts (segSeg, Ericson §5.1.9)
// rather than writing a second one — the house has one closest-approach routine.
//
// Vocabulary (metres, m/s, seconds):
//   blade segment   the blade's span in world space, a → b, plus the speed of the
//                   swinging end (BladeSeg.speed).
//   clash           two MOVING blades whose spans come within `threshold` metres.
//   relative speed  the two blades' scalar speeds summed — the closing speed the
//                   burst scales with (the blades' velocity directions are not
//                   part of this interface, so only the magnitude is available).

import { clamp01 } from "../core/MathCore.ts";
import { segSeg, SEG_SEG } from "./Geom.ts";

/** A blade's swept span in world space (m) and the speed of its swinging end (m/s). */
export interface BladeSeg {
  a: readonly [number, number, number];
  b: readonly [number, number, number];
  speed: number;
}

/** A blade-on-blade contact: where it happened (m), the separation direction (unit) and how hard (0..1). */
export interface ClashEvent {
  at: [number, number, number];
  normal: [number, number, number];
  strength: number;
}

/**
 * Blade speed (m/s) below which a blade counts as at rest and can never clash.
 * A blade merely carried by a walking arm moves its tip at ~1-1.5 m/s, while any
 * real swing drives it at 8-15 m/s (see WeaponTrail.SWING_SPEED, 4 m/s). 1.5 sits
 * above a blade being carried and well under every genuine swing, so two idle
 * blades resting against each other (speed ~0) never spark.
 */
export const MIN_CLASH_SPEED = 1.5;

/**
 * Relative blade speed (m/s) at which a clash reads as full strength
 * (clashStrength → 1). Two blades crossing at ~30 m/s is the hardest blow the
 * game produces; above it the burst saturates instead of growing without bound.
 */
export const MAX_CLASH_SPEED = 30;

/**
 * Minimum seconds between two spark bursts at a contact (canClash). 0.12 s is ~7
 * frames at 60 Hz: long enough that one blade passing through another during a
 * single swing fires ONE burst rather than one every frame, yet short enough that
 * a fast flurry of distinct crossings each get their own.
 */
export const CLASH_COOLDOWN = 0.12;

/**
 * Exact closest approach between two 3-D segments. Algorithm: Ericson, Real-Time
 * Collision Detection (2005), §5.1.9 — reused here through Geom.segSeg, which is
 * the same routine (not re-derived). Returns the distance in metres and the
 * closest point lying on the FIRST segment (p1 → q1). Total: a degenerate
 * (zero-length) segment, identical endpoints, or a coincident pair all give a
 * finite distance and a finite point, never NaN.
 */
export function segSegClosest(
  p1: readonly [number, number, number],
  q1: readonly [number, number, number],
  p2: readonly [number, number, number],
  q2: readonly [number, number, number],
): { d: number; at: [number, number, number] } {
  segSeg(p1[0], p1[1], p1[2], q1[0], q1[1], q1[2], p2[0], p2[1], p2[2], q2[0], q2[1], q2[2]);
  // segSeg writes the closest-point pair into the SEG_SEG scratch record; read it
  // immediately (single-threaded, exactly as Sweep.ts does).
  const d2 = SEG_SEG.d2;
  return { d: d2 > 0 ? Math.sqrt(d2) : 0, at: [SEG_SEG.ax, SEG_SEG.ay, SEG_SEG.az] };
}

/**
 * A clash needs BOTH blades moving (each at least MIN_CLASH_SPEED, so two idle
 * blades resting together never spark) and the closest approach between the spans
 * under `threshold` metres. The returned `at` is the closest point (on the first
 * blade) and `normal` is the unit vector between the two spans (from the second
 * blade's closest point toward the first's; a coincident pair falls back to a
 * stable +y so it is never NaN). `strength` is clashStrength over the blades'
 * relative speed (a.speed + b.speed).
 */
export function detectClash(a: BladeSeg, b: BladeSeg, threshold: number): ClashEvent | null {
  // Speed gate: a blade at rest can never clash, however close it is.
  if (!(a.speed >= MIN_CLASH_SPEED) || !(b.speed >= MIN_CLASH_SPEED)) return null;
  const { d, at } = segSegClosest(a.a, a.b, b.a, b.b);
  if (!(d <= threshold)) return null;
  // SEG_SEG still holds the pair from the call above (nothing ran in between).
  const bx = SEG_SEG.bx, by = SEG_SEG.by, bz = SEG_SEG.bz;
  let nx = at[0] - bx, ny = at[1] - by, nz = at[2] - bz;
  const nl = Math.hypot(nx, ny, nz);
  if (nl > 1e-9) {
    nx /= nl;
    ny /= nl;
    nz /= nl;
  } else {
    nx = 0;
    ny = 1;
    nz = 0; // coincident spans: pick a stable up normal rather than divide by 0
  }
  return { at, normal: [nx, ny, nz], strength: clashStrength(a.speed + b.speed) };
}

/**
 * Clash strength 0..1 from the blades' relative speed (m/s), saturating at
 * `maxSpeed`. 0 at or below `minSpeed` (so clashStrength(0) === 0), monotone, and
 * exactly 1 at or above `maxSpeed`; never leaves [0, 1].
 */
export function clashStrength(relSpeed: number, minSpeed = MIN_CLASH_SPEED, maxSpeed = MAX_CLASH_SPEED): number {
  if (!(maxSpeed > minSpeed)) return relSpeed >= maxSpeed ? 1 : 0; // degenerate range
  return clamp01((relSpeed - minSpeed) / (maxSpeed - minSpeed));
}

/**
 * Repeat gate: true when a contact at time `lastAt` (s) may spark again at `now`
 * (s). `lastAt` = -Infinity (never clashed) is always true. Default cooldown is
 * CLASH_COOLDOWN (0.12 s, see its comment).
 */
export function canClash(now: number, lastAt: number, cooldown = CLASH_COOLDOWN): boolean {
  return now - lastAt >= cooldown;
}
