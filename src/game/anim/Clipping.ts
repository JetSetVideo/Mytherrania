// Body-part clipping measures (lane M): capsule-to-capsule clearance between parts of ONE body
// (the weapon and the hands against the holder's own torso, knee against knee, foot against foot).
// Pure module (no Three.js): a capsule is a world segment wa -> wb with a radius, the shape the
// combat hitboxes (src/combat/Hitboxes.ts) already carry, so any rig that exposes its hitboxes
// can be measured without new data.
//
//   clearance(A, B) = dist(segment A, segment B) - rA - rB      (m; < 0 = the parts interpenetrate)
//
// The segment distance is the exact closest-point solve (Ericson, Real-Time Collision Detection
// §5.1.9) with the degenerate (point) segments handled, so a sphere is a capsule with wa = wb.

/** A capsule in world space (Hitbox-compatible). */
export interface CapsuleLike {
  wa: ArrayLike<number>;
  wb: ArrayLike<number>;
  radius: number;
}

/** Squared distance between segments p1-q1 and p2-q2 (each given as 3 scalars per point). */
export function segmentDistanceSq(
  p1x: number, p1y: number, p1z: number, q1x: number, q1y: number, q1z: number,
  p2x: number, p2y: number, p2z: number, q2x: number, q2y: number, q2z: number,
): number {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z;
  const d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  const EPS = 1e-12;
  let s: number, t: number;
  if (a <= EPS && e <= EPS) {
    s = 0; t = 0;
  } else if (a <= EPS) {
    s = 0; t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0; s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
      s = den > EPS ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  const dx = rx + d1x * s - d2x * t, dy = ry + d1y * s - d2y * t, dz = rz + d1z * s - d2z * t;
  return dx * dx + dy * dy + dz * dz;
}

/** Clearance (m) between two capsules: segment distance minus both radii (< 0 = overlap). */
export function capsuleClearance(A: CapsuleLike, B: CapsuleLike): number {
  const a = A.wa, b = A.wb, c = B.wa, d = B.wb;
  return Math.sqrt(segmentDistanceSq(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2])) - A.radius - B.radius;
}

/** Smallest clearance (m) between any capsule of `as` and any of `bs` (Infinity if either is empty). */
export function setClearance(as: readonly CapsuleLike[], bs: readonly CapsuleLike[]): number {
  let worst = Infinity;
  for (const A of as) for (const B of bs) worst = Math.min(worst, capsuleClearance(A, B));
  return worst;
}

/**
 * Clearance (m) of a polyline (e.g. a weapon feature transformed to world, `pts` flat xyz) with a
 * tube radius `r` against a capsule set: min over the polyline's segments.
 */
export function polylineClearance(pts: ArrayLike<number>, count: number, r: number, bs: readonly CapsuleLike[]): number {
  let worst = Infinity;
  const n = Math.max(1, count - 1);
  for (let k = 0; k < n; k++) {
    const i = 3 * k, j = 3 * Math.min(count - 1, k + 1);
    for (const B of bs) {
      const c = B.wa, d = B.wb;
      const dist = Math.sqrt(segmentDistanceSq(pts[i], pts[i + 1], pts[i + 2], pts[j], pts[j + 1], pts[j + 2], c[0], c[1], c[2], d[0], d[1], d[2]));
      worst = Math.min(worst, dist - r - B.radius);
    }
  }
  return worst;
}

/** Running min / sample collector for one clearance channel (m). */
export class ClearanceStat {
  min = Infinity;
  /** Frames whose clearance was below `threshold` (penetrating). */
  clipped = 0;
  frames = 0;
  constructor(readonly threshold = 0) {}
  add(v: number): void {
    if (!Number.isFinite(v)) return;
    this.frames++;
    if (v < this.min) this.min = v;
    if (v < this.threshold) this.clipped++;
  }
}
