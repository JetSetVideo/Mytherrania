// Map symmetry (wave J, lane J-T): one SymmetrySpec drives the terrain heightfield, the props,
// the wall plan and the spawns, so a mirrored map is mirrored everywhere and a rotational map
// is rotational everywhere.
//
// Frame: world metres, x/z horizontal, the ring centred on the origin; bearings are CCW from +x
// in (x, z), i.e. angle = atan2(z, x) — the same convention as ArenaConfig.ringRadiusAt.
//
// The group G of a spec (every element an isometry fixing the origin):
//   none        {I}
//   mirror      {I, M_α}                         M_α = reflection across the line at bearing α
//   mirror2     {I, M_α, M_α+90, −I}
//   point       {I, −I}                          (= rotational order 2)
//   rotational  {Rot(2πk/m) : k = 0..m−1}, m = 3..6
// with M_α(x, z) = (x cos 2α + z sin 2α, x sin 2α − z cos 2α) and a bearing φ ↦ 2α − φ.
// `order` is the ROTATIONAL order of the group: 1 none/mirror, 2 mirror2/point, m rotational.
//
// THE RING MUST AGREE (enforced by symmetryFor): the map group must be a subgroup of the outline's
// own group (ArenaConfig.ringSymmetry). A mirror axis must be one of the outline's axes (vertex or
// edge-midpoint bearings of a polygon, the principal axes of an oval/diamond, anything for a circle);
// point symmetry needs an even rotation order (no triangle/pentagon); rotational order m must
// divide the polygon's sides (a triangle admits 3, a hexagon 2/3/6, an oval only 2). symmetryFor
// degrades a spec that does not fit (rotational m → gcd order → point → mirror on the nearest axis)
// and randomArena never rolls one that does not (it changes the shape instead).
// Pure module: no Three.js, no DOM, no Math.random.
import { summarize } from "../../core/MathCore.ts";
import { heightAt, nearestNode, type Heightfield } from "../../world/Heightfield.ts";
import { insideRing, objectSize, ringRadiusAt, ringSymmetry, type ArenaConfig, type ArenaObject, type RingSymmetry } from "../ArenaConfig.ts";
import { NO_SYMMETRY, WALL_SEGMENTS, type SymmetryKind, type SymmetrySpec } from "./contracts.ts";

/** Index order of the `symmetry` parameter. */
export const SYMMETRY_KINDS: readonly SymmetryKind[] = ["none", "mirror", "mirror2", "point", "rotational"];
/** Mirror axes are snapped to half a wall segment (3.75°) so reflections map wall segments onto segments. */
export const AXIS_STEP_DEG = 360 / WALL_SEGMENTS / 2;

const DEG = Math.PI / 180;
const norm180 = (d: number) => ((d % 180) + 180) % 180;
const axisDistance = (a: number, b: number) => { const d = Math.abs(norm180(a) - norm180(b)); return Math.min(d, 180 - d); };
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Does the ring's own group contain the map group of `sym`? */
export function symmetryFitsRing(ring: RingSymmetry, sym: SymmetrySpec): boolean {
  if (sym.kind === "none" || ring.continuous) return true;
  const hasAxis = (a: number) => ring.axesDeg.some((x) => axisDistance(x, a) < 1e-6);
  switch (sym.kind) {
    case "mirror": return hasAxis(sym.axisDeg);
    case "mirror2": return hasAxis(sym.axisDeg) && hasAxis(sym.axisDeg + 90);
    case "point": return ring.rotOrder % 2 === 0;
    case "rotational": return ring.rotOrder % sym.order === 0;
  }
}

/** The ring axis nearest to `deg` (optionally one whose perpendicular is also an axis). */
function nearestAxis(ring: RingSymmetry, deg: number, needPerp: boolean): number | null {
  let best: number | null = null, bd = Infinity;
  // Prefer the outline's axes that lie on the wall-segment lattice (the walls can only mirror
  // exactly about those); fall back to any axis when none does.
  const onLattice = (a: number) => { const m = ((a % AXIS_STEP_DEG) + AXIS_STEP_DEG) % AXIS_STEP_DEG; return m < 1e-6 || AXIS_STEP_DEG - m < 1e-6; };
  const pool = ring.axesDeg.some(onLattice) ? ring.axesDeg.filter(onLattice) : ring.axesDeg;
  for (const a of pool) {
    if (needPerp && !ring.axesDeg.some((x) => axisDistance(x, a + 90) < 1e-6)) continue;
    const d = axisDistance(a, deg);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

/**
 * The symmetry actually used for an arena, from cfg.symmetry / symmetryOrder / symmetryAxis,
 * made compatible with the outline:
 *   axis    a circle snaps it to the AXIS_STEP_DEG lattice; a polygon/oval/diamond snaps it to
 *           its nearest own axis (randomArena already rotates the outline so that is on-lattice).
 *   kind    an incompatible kind degrades: rotational m → rotational gcd(m, n) (≥ 3) → point
 *           (gcd 2) → mirror on the nearest axis; mirror2 without perpendicular axes → mirror;
 *           point on an odd polygon → mirror.
 */
export function symmetryFor(cfg: ArenaConfig): SymmetrySpec {
  const idx = Number.isFinite(cfg.symmetry) ? Math.max(0, Math.min(4, Math.round(cfg.symmetry))) : 0;
  const kind = SYMMETRY_KINDS[idx];
  if (kind === "none") return { ...NO_SYMMETRY };
  const ring = ringSymmetry(cfg);
  const rawAxis = Number.isFinite(cfg.symmetryAxis) ? norm180(cfg.symmetryAxis) : 0;
  const lattice = norm180(Math.round(rawAxis / AXIS_STEP_DEG) * AXIS_STEP_DEG);
  const axisFor = (needPerp: boolean): number | null => (ring.continuous ? lattice : nearestAxis(ring, rawAxis, needPerp));
  const mirror = (): SymmetrySpec => ({ kind: "mirror", order: 1, axisDeg: axisFor(false) ?? lattice });
  switch (kind) {
    case "mirror": return mirror();
    case "mirror2": {
      const a = axisFor(true);
      return a === null ? mirror() : { kind: "mirror2", order: 2, axisDeg: a };
    }
    case "point": {
      if (!ring.continuous && ring.rotOrder % 2 !== 0) return mirror();
      return { kind: "point", order: 2, axisDeg: axisFor(false) ?? lattice };
    }
    case "rotational": {
      const m = Math.max(3, Math.min(6, Math.round(Number.isFinite(cfg.symmetryOrder) ? cfg.symmetryOrder : 3)));
      const g = ring.continuous ? m : gcd(m, ring.rotOrder);
      const axis = axisFor(false) ?? lattice;
      if (g >= 3) return { kind: "rotational", order: g, axisDeg: axis };
      if (g === 2) return { kind: "point", order: 2, axisDeg: axis };
      return mirror();
    }
  }
}

/** One group element as a 2x2 linear map (x, z) ↦ (a·x + b·z, c·x + d·z), plus how it acts on a yaw/bearing. */
export interface SymOp { a: number; b: number; c: number; d: number; /** true for a reflection (det −1). */ reflect: boolean; /** Rotation angle (rad) or, for a reflection, 2α. */ angle: number }

/** Every element of the group, identity first. Length = group size (1, 2, 4, 2, m). */
export function symmetryOps(sym: SymmetrySpec): SymOp[] {
  const rot = (t: number): SymOp => ({ a: Math.cos(t), b: -Math.sin(t), c: Math.sin(t), d: Math.cos(t), reflect: false, angle: t });
  const mir = (alphaDeg: number): SymOp => {
    const t = 2 * alphaDeg * DEG;
    return { a: Math.cos(t), b: Math.sin(t), c: Math.sin(t), d: -Math.cos(t), reflect: true, angle: t };
  };
  switch (sym.kind) {
    case "none": return [rot(0)];
    case "mirror": return [rot(0), mir(sym.axisDeg)];
    case "mirror2": return [rot(0), mir(sym.axisDeg), mir(sym.axisDeg + 90), rot(Math.PI)];
    case "point": return [rot(0), rot(Math.PI)];
    case "rotational": {
      const m = Math.max(1, Math.round(sym.order));
      return Array.from({ length: m }, (_, k) => rot((2 * Math.PI * k) / m));
    }
  }
}

/** Apply a group element to a point. */
export function applyOp(op: SymOp, x: number, z: number): { x: number; z: number } {
  return { x: op.a * x + op.b * z, z: op.c * x + op.d * z };
}

/** Apply a group element to a bearing (rad, CCW from +x): φ ↦ φ + θ (rotation) or 2α − φ (reflection). */
export function applyOpBearing(op: SymOp, phi: number): number {
  return op.reflect ? op.angle - phi : phi + op.angle;
}

/**
 * Apply a group element to a rig yaw (rotation.y = atan2(dx, dz), facing = (sin y, cos y)): the
 * facing vector is transformed like a point and the yaw re-read from it.
 */
export function applyOpYaw(op: SymOp, yaw: number): number {
  const f = applyOp(op, Math.sin(yaw), Math.cos(yaw));
  return Math.atan2(f.x, f.z);
}

/** All images of a point under the group (identity first; duplicates kept — see uniqueImages). */
export function symmetryImages(sym: SymmetrySpec, x: number, z: number): { x: number; z: number }[] {
  return symmetryOps(sym).map((op) => applyOp(op, x, z));
}

/** The distinct images of a point (a point on a mirror axis, or the centre, is its own image). */
export function uniqueImages(sym: SymmetrySpec, x: number, z: number, eps = 1e-6): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (const p of symmetryImages(sym, x, z)) if (!out.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < eps)) out.push(p);
  return out;
}

/** A start zone props must keep clear of (spawns.ts SpawnPlan.zones). */
export interface ClearDisc { x: number; z: number; r: number }

/** Clearance factor between two prop footprints (the same 1.15 placeObjects uses). */
const PROP_CLASH = 1.15;
/** Extra clearance between a prop and a start zone, m. */
export const ZONE_PROP_CLEARANCE = 0.3;

/**
 * Props placed in one fundamental domain, replicated through the group. Walks `objects` in
 * order (typically placeObjects' output); each object becomes an ORBIT of images:
 *   - an object within its clash distance of a mirror axis is first projected ONTO the axis
 *     (it is then its own image: one prop on the axis instead of two overlapping);
 *   - images closer than 1e-3 m are merged (dedupe); images that still overlap each other reject the orbit;
 *   - every image must be inside the ring, clear of the accepted props (1.15 × summed radii) and
 *     clear of every start zone by its radius + the prop's + ZONE_PROP_CLEARANCE;
 *   - an image's yaw (`rotation`, a rig-style rotation.y) is transformed with the point (applyOpYaw);
 * Orbits are accepted until the output holds at least `objects.length` props (the last orbit may
 * overshoot by up to |G| − 1). Pure: the input is not mutated.
 */
export function symmetrizeObjects(objects: readonly ArenaObject[], sym: SymmetrySpec, cfg: ArenaConfig, zones: readonly ClearDisc[] = []): ArenaObject[] {
  const ops = symmetryOps(sym);
  const out: ArenaObject[] = [];
  const target = objects.length;
  const axes = sym.kind === "mirror" ? [sym.axisDeg] : sym.kind === "mirror2" ? [sym.axisDeg, sym.axisDeg + 90] : [];
  for (const src of objects) {
    if (out.length >= target) break;
    const size = objectSize(src.kind);
    const r = size.r * src.scale;
    let x = src.x, z = src.z;
    // Snap onto a mirror axis when the object would clash with its own reflection.
    for (const ad of axes) {
      const ux = Math.cos(ad * DEG), uz = Math.sin(ad * DEG);
      const along = x * ux + z * uz, off = -x * uz + z * ux;
      if (Math.abs(off) < r * PROP_CLASH) { x = along * ux; z = along * uz; }
    }
    const orbit: ArenaObject[] = [];
    let ok = true;
    for (const op of ops) {
      const p = applyOp(op, x, z);
      if (orbit.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 1e-3)) continue;
      if (orbit.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 2 * r * PROP_CLASH)) { ok = false; break; }
      orbit.push({ ...src, x: p.x, z: p.z, rotation: applyOpYaw(op, src.rotation) });
    }
    if (!ok) continue;
    for (const o of orbit) {
      if (!insideRing(cfg, o.x, o.z)) { ok = false; break; }
      if (out.some((q) => Math.hypot(q.x - o.x, q.z - o.z) < (r + objectSize(q.kind).r * q.scale) * PROP_CLASH)) { ok = false; break; }
      if (zones.some((zn) => Math.hypot(zn.x - o.x, zn.z - o.z) < zn.r + r + ZONE_PROP_CLEARANCE)) { ok = false; break; }
    }
    if (ok) out.push(...orbit);
  }
  return out;
}

/**
 * A NEW heightfield whose every node is the mean of the source sampled (bilinear heightAt) at
 * that node's images: h'(p) = (1/|G|) Σ_g h(g·p), applied `passes` times (default 2). The result
 * is exactly G-invariant on the nodes when G maps nodes to nodes (point, rotational 4, mirrors on
 * 0/45/90/135°: the grid is centred on the origin), and invariant up to bilinear re-sampling
 * otherwise: measured on a 34 m ring (tests/arena_symmetry_test.ts) one pass leaves an RMS error of
 * ~1 cm with up to ~0.25 m on a cliff edge (a step inside one cell); a second pass halves the max.
 * Averaging isometric images never steepens a slope (a mean of L-Lipschitz functions is
 * L-Lipschitz), so the walkable limit survives. featureMask is the OR of the image nodes' masks
 * (a hole flagged on one side is flagged on every side); zone/ringNorm are copied (the ring is
 * symmetric when symmetryFor accepted the spec). `features` is kept from the source (it lists the
 * SOURCE stamps, not their images) and stats.heights is recomputed; the other stats describe the source.
 */
export function symmetrizeHeightfield(field: Heightfield, sym: SymmetrySpec, passes = 2): Heightfield {
  let out = symmetrizeOnce(field, sym);
  for (let k = 1; k < Math.max(1, Math.round(passes)); k++) out = symmetrizeOnce(out, sym);
  return out;
}

function symmetrizeOnce(field: Heightfield, sym: SymmetrySpec): Heightfield {
  const ops = symmetryOps(sym);
  const n = field.cols * field.rows;
  const heights = new Float32Array(n);
  const mask = new Uint8Array(n);
  for (let j = 0; j < field.rows; j++) {
    for (let i = 0; i < field.cols; i++) {
      const k = j * field.cols + i;
      const x = field.originX + i * field.cell, z = field.originZ + j * field.cell;
      let sum = 0, m = 0;
      for (const op of ops) {
        const p = applyOp(op, x, z);
        sum += heightAt(field, p.x, p.z);
        m |= field.featureMask[nearestNode(field, p.x, p.z)];
      }
      heights[k] = sum / ops.length;
      mask[k] = m;
    }
  }
  return {
    ...field, heights, featureMask: mask, zone: field.zone.slice(), ringNorm: field.ringNorm.slice(), features: [...field.features],
    stats: { ...field.stats, heights: summarize(heights) },
  };
}

/**
 * How far a field is from symmetric: |h(g·p) − h(p)| over every node p inside the ring
 * (ringNorm < 1) and every group element g, m — the max, the 99th percentile and the RMS.
 */
export function heightfieldAsymmetry(field: Heightfield, sym: SymmetrySpec): { max: number; p99: number; rms: number } {
  const ops = symmetryOps(sym);
  const errs: number[] = [];
  for (let j = 0; j < field.rows; j++) {
    for (let i = 0; i < field.cols; i++) {
      const k = j * field.cols + i;
      if (!(field.ringNorm[k] < 1)) continue;
      const x = field.originX + i * field.cell, z = field.originZ + j * field.cell;
      const h = field.heights[k];
      for (const op of ops) { const p = applyOp(op, x, z); errs.push(Math.abs(heightAt(field, p.x, p.z) - h)); }
    }
  }
  if (!errs.length) return { max: 0, p99: 0, rms: 0 };
  errs.sort((a, b) => a - b);
  let sq = 0;
  for (const e of errs) sq += e * e;
  return { max: errs[errs.length - 1], p99: errs[Math.min(errs.length - 1, Math.floor(errs.length * 0.99))], rms: Math.sqrt(sq / errs.length) };
}

/** Largest |r(g·φ) − r(φ)| of the ring outline over `samples` bearings, m (0 when the outline fits the spec). */
export function ringAsymmetry(cfg: ArenaConfig, sym: SymmetrySpec, samples = 360): number {
  const ops = symmetryOps(sym);
  let worst = 0;
  for (let k = 0; k < samples; k++) {
    const phi = ((k + 0.5) / samples) * Math.PI * 2, r = ringRadiusAt(cfg, phi);
    for (const op of ops) worst = Math.max(worst, Math.abs(ringRadiusAt(cfg, applyOpBearing(op, phi)) - r));
  }
  return worst;
}

/**
 * Fold a bearing into the group's fundamental domain, in units of half wall segments
 * (96 per turn, AXIS_STEP_DEG each), so integer inputs stay exact (the wall plan relies on it):
 *   none [0, 96) · mirror [A, A+48] · mirror2 [A, A+24] · point [A, A+48) · rotational [A, A+96/m)
 * where A = axisDeg / AXIS_STEP_DEG. Returns the folded value and the domain width.
 */
export function foldHalfSteps(sym: SymmetrySpec, u: number): { u: number; width: number } {
  const T = 2 * WALL_SEGMENTS;
  const A = sym.axisDeg / AXIS_STEP_DEG;
  const mod = (v: number, p: number) => ((v % p) + p) % p;
  const wrap = (v: number) => { const w = mod(v, T); return w > T / 2 ? w - T : w; };
  switch (sym.kind) {
    case "none": return { u: mod(u - A, T) + A, width: T };
    case "mirror": return { u: A + Math.abs(wrap(u - A)), width: T / 2 };
    case "mirror2": { const a = Math.abs(wrap(u - A)); return { u: A + (a > T / 4 ? T / 2 - a : a), width: T / 4 }; }
    case "point": return { u: A + mod(u - A, T / 2), width: T / 2 };
    case "rotational": { const w = T / Math.max(1, sym.order); return { u: A + mod(u - A, w), width: w }; }
  }
}
