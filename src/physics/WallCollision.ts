// Perimeter wall collision (V02): the wall is the ring OUTLINE as a closed convex polygon
// with a THICKNESS, and a body is a vertical cylinder of radius r (its footprint).
//
// Frame: world metres, x/z horizontal, the ring centred on the origin. Every arena outline
// (circle, regular polygons, oval, diamond) is convex and contains the origin, so:
//   s_i(p) = n_i · (p − a_i)            signed distance of p from segment i's CENTRE LINE,
//                                        n_i its unit INWARD normal (toward the origin)
//   inside the outline  ⇔  s_i(p) ≥ 0 for every i
//   inner wall face     :  s_i = +h      (h = half the wall thickness)
//   a centre may sit at :  s_i ≥ h + r   (the free region is the outline ERODED by h + r,
//                                        exactly the intersection of the shifted half-planes)
//   from OUTSIDE the wall is the polygon DILATED by h: every segment a capsule of radius h,
//   so a body outside meets flat faces AND rounded corners (capsule endpoints).
//
// Continuous: a body moving p0 → p1 during a frame is swept, and the EARLIEST time of impact
// t ∈ [0, 1] along the path is found, so no speed tunnels through a face or a corner.
// Pure module: no Three.js, no DOM, no allocation in the per-frame functions.
import { ringRadiusAt, shapeOf, halfSize, type ArenaConfig } from "../game/ArenaConfig.ts";

/** Thickness of the drawn wall, m (Engine #buildArena draws BoxGeometry(len, h, 0.35) on the outline). */
export const WALL_THICKNESS = 0.35;
/** Gap left between a resolved body and the face, m: keeps the next sweep starting outside (1 mm). */
export const WALL_SKIN = 0.001;
/** A start within this of the face counts as ALREADY touching (sustained contact, not a new blow), m. */
export const WALL_CONTACT_SLOP = 0.004;
/** Largest gap between a curved outline and its chord polygon, m (the sagitta bound for circle/oval). */
export const CURVE_TOLERANCE = 0.01;
/** Bounds on the vertex count of a curved outline (24 keeps tiny rings round; 512 caps 320 m fields). */
export const CURVE_SAMPLES_MIN = 24, CURVE_SAMPLES_MAX = 512;

/** The wall as a convex polygon of its centre line plus a half thickness. Arrays are per segment. */
export interface WallPolygon {
  /** Segment count (= vertex count; segment i runs from vertex i to vertex i+1, wrapping). */
  n: number;
  /** Vertex i (segment start) x / z, m. */
  ax: Float64Array; az: Float64Array;
  /** Edge vector of segment i (vertex i+1 − vertex i), m. */
  ex: Float64Array; ez: Float64Array;
  /** Squared edge length, m². */
  len2: Float64Array;
  /** Unit inward normal of segment i. */
  nx: Float64Array; nz: Float64Array;
  /** Half the wall thickness, m. */
  halfThickness: number;
}

/**
 * Vertex count for a curved outline of radius R so the chord's sagitta R·(1 − cos(π/N))
 * stays under CURVE_TOLERANCE:  N = ⌈π / acos(1 − tol/R)⌉, clamped to [MIN, MAX].
 */
export function curveSamples(radius: number, tol = CURVE_TOLERANCE): number {
  if (!(radius > tol)) return CURVE_SAMPLES_MIN;
  const n = Math.ceil(Math.PI / Math.acos(1 - tol / radius));
  return Math.max(CURVE_SAMPLES_MIN, Math.min(CURVE_SAMPLES_MAX, n));
}

/**
 * The wall polygon of an arena: EXACT corners for the regular polygons (corners at
 * θ = k·2π/n − rotation, circumradius min(half, half·aspect)) and the diamond (half on x,
 * half·aspect on z), a chord polygon within CURVE_TOLERANCE for circle and oval. Vertices run
 * counter-clockwise in (x, z). Allocates (call once per arena; see wallPolygonOf).
 */
export function wallPolygon(cfg: ArenaConfig, thickness = WALL_THICKNESS): WallPolygon {
  const shape = shapeOf(cfg);
  const half = halfSize(cfg), az = half * cfg.aspect;
  const rot = (cfg.rotation * Math.PI) / 180;
  const xs: number[] = [], zs: number[] = [];
  const sides: Record<string, number> = { triangle: 3, square: 4, pentagon: 5, hexagon: 6, octagon: 8 };
  if (shape in sides) {
    const n = sides[shape], seg = (Math.PI * 2) / n, R = Math.min(half, az);
    for (let k = 0; k < n; k++) { xs.push(R * Math.cos(k * seg - rot)); zs.push(R * Math.sin(k * seg - rot)); }
  } else if (shape === "diamond") {
    const radii = [half, az, half, az];
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 - rot; xs.push(radii[k] * Math.cos(a)); zs.push(radii[k] * Math.sin(a)); }
  } else {
    // Polar sampling at step 2π/N puts chords of length ≈ big·2π/N where the outline curves
    // hardest (radius of curvature small²/big at the major axis ends), so the sagitta
    // L²/(8·R_c) stays under tol when N is chosen for the equivalent radius big³/small²
    // (= R for a circle).
    const big = Math.max(half, az), small = Math.min(half, az);
    const n = curveSamples((big * big * big) / Math.max(1e-9, small * small));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, r = ringRadiusAt(cfg, a);
      xs.push(r * Math.cos(a)); zs.push(r * Math.sin(a));
    }
  }
  return polygonFrom(xs, zs, thickness / 2);
}

/** Build the per-segment tables from vertices (any winding; normals are oriented toward the origin). */
export function polygonFrom(xs: ArrayLike<number>, zs: ArrayLike<number>, halfThickness: number): WallPolygon {
  const n = xs.length;
  const poly: WallPolygon = {
    n, ax: new Float64Array(n), az: new Float64Array(n), ex: new Float64Array(n), ez: new Float64Array(n),
    len2: new Float64Array(n), nx: new Float64Array(n), nz: new Float64Array(n), halfThickness,
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = xs[j] - xs[i], ez = zs[j] - zs[i], L = Math.hypot(ex, ez) || 1e-12;
    let nx = -ez / L, nz = ex / L;
    if (nx * -xs[i] + nz * -zs[i] < 0) { nx = -nx; nz = -nz; } // point toward the origin
    poly.ax[i] = xs[i]; poly.az[i] = zs[i]; poly.ex[i] = ex; poly.ez[i] = ez; poly.len2[i] = ex * ex + ez * ez;
    poly.nx[i] = nx; poly.nz[i] = nz;
  }
  return poly;
}

/** Cache per arena config, rebuilt when the outline parameters change (no per-frame building). */
const POLY_CACHE = new WeakMap<ArenaConfig, { poly: WallPolygon; key: [number, number, number, number] }>();

/** The cached wall polygon of `cfg` (rebuilt only when size/shape/aspect/rotation change). */
export function wallPolygonOf(cfg: ArenaConfig): WallPolygon {
  const c = POLY_CACHE.get(cfg);
  if (c && c.key[0] === cfg.size && c.key[1] === cfg.shape && c.key[2] === cfg.aspect && c.key[3] === cfg.rotation) return c.poly;
  const poly = wallPolygon(cfg);
  POLY_CACHE.set(cfg, { poly, key: [cfg.size, cfg.shape, cfg.aspect, cfg.rotation] });
  return poly;
}

/** s_i(p): signed distance from segment i's centre line, inward positive, m. */
export function segmentDistance(poly: WallPolygon, i: number, x: number, z: number): number {
  return poly.nx[i] * (x - poly.ax[i]) + poly.nz[i] * (z - poly.az[i]);
}

/** min_i s_i(p): ≥ 0 inside the outline (and then the distance to the nearest centre line), m. */
export function insideDistance(poly: WallPolygon, x: number, z: number): number {
  let m = Infinity;
  for (let i = 0; i < poly.n; i++) { const s = segmentDistance(poly, i, x, z); if (s < m) m = s; }
  return m;
}

/** Scratch for closest-point queries (module-level so queries allocate nothing). */
const CLOSEST = { d: 0, x: 0, z: 0, i: 0 };

/** Euclidean distance from p to the outline polyline; writes the closest point and segment into CLOSEST. */
function closestOnOutline(poly: WallPolygon, x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < poly.n; i++) {
    const ax = poly.ax[i], az = poly.az[i];
    let u = ((x - ax) * poly.ex[i] + (z - az) * poly.ez[i]) / poly.len2[i];
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const cx = ax + poly.ex[i] * u, cz = az + poly.ez[i] * u;
    const d = Math.hypot(x - cx, z - cz);
    if (d < best) { best = d; CLOSEST.x = cx; CLOSEST.z = cz; CLOSEST.i = i; }
  }
  CLOSEST.d = best;
  return best;
}

/** Result of a swept query; reused by the caller. */
export interface WallSweep {
  /** Fraction of the path p0 → p1 at first contact, 0..1. */
  t: number;
  /** Body centre at contact, m. */
  x: number; z: number;
  /** Unit contact normal pointing from the wall toward the body's free side. */
  nx: number; nz: number;
  /** Segment index hit (for a corner: the segment that starts at that vertex). */
  segment: number;
  /** True when a rounded outer corner (capsule endpoint) was hit. */
  corner: boolean;
  /** "inner" = the body is inside the ring; "outer" = it comes from outside. */
  side: "inner" | "outer";
  /** Free distance to the face at the START of the path, m (≤ WALL_CONTACT_SLOP = already touching). */
  startGap: number;
}

/** A fresh sweep record (allocate once per caller). */
export function createSweep(): WallSweep {
  return { t: 0, x: 0, z: 0, nx: 0, nz: 0, segment: -1, corner: false, side: "inner", startGap: 0 };
}

/**
 * Earliest contact of a circle of radius `r` moving p0 → p1 with the wall, or false.
 * Inner side (p0 inside the outline): the first half-plane s_i ≥ h + r the path leaves;
 * a start already inside the band reports t = 0 with the deepest segment.
 * Outer side: the first of the dilated faces (s_i = −(h + r) within the segment's extent)
 * and the corner circles |p − v_i| = h + r. Writes `out`; allocates nothing.
 */
export function sweepCircleWall(poly: WallPolygon, r: number, x0: number, z0: number, x1: number, z1: number, out: WallSweep): boolean {
  const reach = poly.halfThickness + r;
  const dx = x1 - x0, dz = z1 - z0;
  if (insideDistance(poly, x0, z0) >= 0) {
    let bestT = Infinity, bestI = -1, startGap = Infinity, deepI = -1;
    for (let i = 0; i < poly.n; i++) {
      const s0 = segmentDistance(poly, i, x0, z0) - reach;
      if (s0 < startGap) { startGap = s0; deepI = i; }
      if (s0 < 0) continue;
      const s1 = segmentDistance(poly, i, x1, z1) - reach;
      if (s1 >= 0) continue;
      const t = s0 / (s0 - s1);
      if (t < bestT) { bestT = t; bestI = i; }
    }
    // A start already inside the band is a contact NOW, on the most penetrated face.
    if (startGap < 0) { bestT = 0; bestI = deepI; }
    if (bestI < 0) return false;
    // Contact centre: on the face at the time of impact; a penetrating start is lifted out to it.
    const lift = startGap < 0 ? -startGap : 0;
    out.t = bestT; out.x = x0 + dx * bestT + poly.nx[bestI] * lift; out.z = z0 + dz * bestT + poly.nz[bestI] * lift;
    out.nx = poly.nx[bestI]; out.nz = poly.nz[bestI];
    out.segment = bestI; out.corner = false; out.side = "inner"; out.startGap = startGap;
    return true;
  }
  // Outer side: obstacle = outline dilated by `reach` (capsules).
  const gap0 = closestOnOutline(poly, x0, z0) - reach;
  if (gap0 < 0) {
    const d = CLOSEST.d;
    // On the centre line itself the direction is undefined: use the face's outward normal.
    out.nx = d > 1e-9 ? (x0 - CLOSEST.x) / d : -poly.nx[CLOSEST.i];
    out.nz = d > 1e-9 ? (z0 - CLOSEST.z) / d : -poly.nz[CLOSEST.i];
    out.t = 0; out.x = x0 - out.nx * gap0; out.z = z0 - out.nz * gap0; // lifted out to the dilated face
    out.segment = CLOSEST.i; out.corner = false; out.side = "outer"; out.startGap = gap0;
    return true;
  }
  let bestT = Infinity, bestI = -1, corner = false;
  for (let i = 0; i < poly.n; i++) {
    // Flat face: outward distance beyond the dilated face.
    const u0 = -segmentDistance(poly, i, x0, z0) - reach;
    const u1 = -segmentDistance(poly, i, x1, z1) - reach;
    if (u0 >= 0 && u1 < 0) {
      const t = u0 / (u0 - u1);
      if (t < bestT) {
        const cx = x0 + dx * t, cz = z0 + dz * t;
        const lam = ((cx - poly.ax[i]) * poly.ex[i] + (cz - poly.az[i]) * poly.ez[i]) / poly.len2[i];
        if (lam >= 0 && lam <= 1) { bestT = t; bestI = i; corner = false; }
      }
    }
    // Corner circle at vertex i: |p0 + t·d − v|² = reach².
    const fx = x0 - poly.ax[i], fz = z0 - poly.az[i];
    const A = dx * dx + dz * dz;
    if (A < 1e-18) continue;
    const B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - reach * reach;
    const disc = B * B - 4 * A * C;
    if (disc < 0 || B >= 0) continue; // no root, or moving away from the vertex
    const t = (-B - Math.sqrt(disc)) / (2 * A);
    if (t >= 0 && t <= 1 && t < bestT) { bestT = t; bestI = i; corner = true; }
  }
  if (bestI < 0) return false;
  out.t = bestT; out.x = x0 + dx * bestT; out.z = z0 + dz * bestT;
  if (corner) {
    const cx = out.x - poly.ax[bestI], cz = out.z - poly.az[bestI], d = Math.hypot(cx, cz) || 1e-12;
    out.nx = cx / d; out.nz = cz / d;
  } else { out.nx = -poly.nx[bestI]; out.nz = -poly.nz[bestI]; }
  out.segment = bestI; out.corner = corner; out.side = "outer"; out.startGap = gap0;
  return true;
}

/** Result of a static overlap query (penetration depth along a normal). */
export interface WallOverlap { depth: number; nx: number; nz: number }

/**
 * Static overlap of a circle (centre x/z, radius r) with the wall band: the depth to push
 * along (nx, nz) to clear it, or false. A centre inside the outline is pushed inward off the
 * deepest face; a centre outside is pushed outward from the closest outline point (rounded
 * corners). Used for depenetration and by the ragdoll. Allocates nothing.
 */
export function wallOverlap(poly: WallPolygon, r: number, x: number, z: number, out: WallOverlap): boolean {
  const reach = poly.halfThickness + r;
  const inside = insideDistance(poly, x, z);
  if (inside >= 0) {
    let deepest = Infinity, idx = -1;
    for (let i = 0; i < poly.n; i++) { const s = segmentDistance(poly, i, x, z) - reach; if (s < deepest) { deepest = s; idx = i; } }
    if (deepest >= 0) return false;
    out.depth = -deepest; out.nx = poly.nx[idx]; out.nz = poly.nz[idx];
    return true;
  }
  const d = closestOnOutline(poly, x, z);
  if (d >= reach) return false;
  const k = d > 1e-12 ? 1 / d : 0;
  out.depth = reach - d;
  out.nx = d > 1e-12 ? (x - CLOSEST.x) * k : -poly.nx[CLOSEST.i];
  out.nz = d > 1e-12 ? (z - CLOSEST.z) * k : -poly.nz[CLOSEST.i];
  return true;
}

/**
 * Velocity response at a wall contact with unit normal n (toward the body):
 *   v_n = v·n;  if v_n < 0 (approaching):
 *     normal:      v_n' = −e·v_n                                 (restitution e)
 *     tangential:  |v_t'| = max(0, |v_t| − μ·(1 + e)·|v_n|)      (Coulomb impulse friction)
 * Returns the approach speed −v_n (0 when separating). Writes into `v` ([vx, vz] holder).
 */
export function reflectVelocity(v: { vx: number; vz: number }, nx: number, nz: number, restitution: number, friction: number): number {
  const vn = v.vx * nx + v.vz * nz;
  if (vn >= 0) return 0;
  const tx = v.vx - vn * nx, tz = v.vz - vn * nz;
  const vt = Math.hypot(tx, tz);
  const keep = vt > 1e-9 ? Math.max(0, vt - friction * (1 + restitution) * -vn) / vt : 0;
  v.vx = tx * keep - restitution * vn * nx;
  v.vz = tz * keep - restitution * vn * nz;
  return -vn;
}
