// Wave GEN (C-AGI, lane K): the "balance disk" — is the body's centre of mass over its feet?
// Pure (no THREE). The caller supplies the body as mass capsules (the fitted combat hitboxes in world
// space: Hitboxes.updateHitboxes) and the sole points of the loaded feet; this module returns the
// ground projection of the centre of mass, the support polygon (convex hull of the soles) and the
// MARGIN: the signed distance (m) from the projected centre of mass to the polygon's edge, positive
// inside. A disk of radius r around the projection fits inside the support iff margin >= r.
//
// For a moving body the static margin is not the stability criterion: walking is a controlled fall
// (single support has the centre of mass ahead of / beside the stance foot by design). `xcomMargin`
// uses Hof's extrapolated centre of mass XCoM = CoM + v / ω0, ω0 = sqrt(g / l) (Hof et al. 2005,
// J. Biomech. 38:1-8) — the "margin of stability" a gait study reports.

export type V2 = [number, number];
export interface MassCapsule { wa: ArrayLike<number>; wb: ArrayLike<number>; radius: number }

/** Volume-weighted centre of mass of capsules (overlaps double-counted: a smooth approximation). */
export function capsuleCentreOfMass(boxes: readonly MassCapsule[]): [number, number, number] {
  let m = 0, x = 0, y = 0, z = 0;
  for (const b of boxes) {
    const L = Math.hypot(b.wb[0] - b.wa[0], b.wb[1] - b.wa[1], b.wb[2] - b.wa[2]);
    const v = Math.PI * b.radius * b.radius * L + (4 / 3) * Math.PI * b.radius ** 3;
    m += v;
    x += v * 0.5 * (b.wa[0] + b.wb[0]); y += v * 0.5 * (b.wa[1] + b.wb[1]); z += v * 0.5 * (b.wa[2] + b.wb[2]);
  }
  return m > 0 ? [x / m, y / m, z / m] : [0, 0, 0];
}

/** Convex hull (Andrew's monotone chain), counter-clockwise, no repeated last point. */
export function convexHull(points: readonly V2[]): V2[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: V2[] = [], hi: V2[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  lo.pop(); hi.pop();
  return lo.concat(hi);
}

/** Signed distance from q to the convex polygon's boundary: + inside, − outside (m). */
export function polygonMargin(q: V2, hull: readonly V2[]): number {
  if (hull.length === 0) return -Infinity;
  if (hull.length === 1) return -Math.hypot(q[0] - hull[0][0], q[1] - hull[0][1]);
  let inside = hull.length >= 3, best = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ex = b[0] - a[0], ez = b[1] - a[1], L2 = ex * ex + ez * ez || 1e-12;
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * ex + (q[1] - a[1]) * ez) / L2));
    best = Math.min(best, Math.hypot(q[0] - a[0] - ex * t, q[1] - a[1] - ez * t));
    if (ex * (q[1] - a[1]) - ez * (q[0] - a[0]) < 0) inside = false; // right of a CCW edge
  }
  return inside ? best : -best;
}

/** The balance disk of one frame. */
export interface BalanceDisk { com: [number, number, number]; support: V2[]; margin: number }

/** Centre of mass of `boxes` against the soles of the loaded feet (world xz). */
export function balanceDisk(boxes: readonly MassCapsule[], soles: readonly V2[]): BalanceDisk {
  const com = capsuleCentreOfMass(boxes), support = convexHull(soles);
  return { com, support, margin: polygonMargin([com[0], com[2]], support) };
}

/** Hof's margin of stability: the extrapolated CoM (CoM + v/ω0, ω0 = √(g/l), l = CoM height). */
export function xcomMargin(com: readonly number[], vel: V2, support: readonly V2[], g = 9.81): number {
  const w0 = Math.sqrt(g / Math.max(0.05, com[1]));
  return polygonMargin([com[0] + vel[0] / w0, com[2] + vel[1] / w0], support);
}

/**
 * Hof's MEDIOLATERAL margin of stability in single support (m, + = the XCoM inside the stance foot's
 * lateral edge): the quantity a gait study reports as stable walking (~2-5 cm healthy adults). `yaw` is
 * the heading (lateral axis = (cos yaw, −sin yaw)); `side` 0 = left foot (lateral edge is +lateral), 1 = right.
 */
export function lateralXcomMargin(com: readonly number[], vel: V2, stance: readonly V2[], yaw: number, side: 0 | 1, g = 9.81): number {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), lat = (x: number, z: number) => x * cy - z * sy;
  const w0 = Math.sqrt(g / Math.max(0.05, com[1]));
  const xl = lat(com[0] + vel[0] / w0, com[2] + vel[1] / w0);
  const ls = stance.map((q) => lat(q[0], q[1]));
  return side === 0 ? Math.max(...ls) - xl : xl - Math.min(...ls);
}
