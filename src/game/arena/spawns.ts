// Start zones and spawns (wave J, lane J-T). Each fighter seat gets a start AREA (a disc) on
// its own side of the arena and a spawn point inside it, facing the other fighter(s).
//
//   seat-0 bearing θ0: none → cfg.spawnAngle; mirror/mirror2 → α + 90° (the seats sit across the
//     mirror line); point/rotational → α.
//   distance d = min(cfg.spawnDistance, 0.4·r_min), zone radius = min(cfg.spawnZone, 0.25·r_min,
//     0.45·(closest seat separation)), r_min = the smallest ring radius over 64 bearings — so a zone
//     never leaves the ring (d + r ≤ 0.65·r_min) and two zones never overlap.
//   seat k: on a symmetric map the IMAGE of seat 0 under a group element g_k (fair = true):
//     2 seats — mirror: M_α; mirror2 / point: −I; rotational m: Rot(2π·⌊m/2⌋/m) (opposite for even m,
//     the widest split for odd m); more seats — the rotations Rot(2π·round(k·m/n)/m) when n ≤ m,
//     the 4 images of a seat at α + 45° for mirror2 when n ≤ 4.
//     Otherwise (asymmetric map, or more seats than the group has images) seat k is seat 0 rotated by
//     2πk/n and fair = false.
//   ground: with a field, the spawn is searched inside seat 0's zone (centre first, then rings at
//     ⅓ and ⅔ of the radius, 8 bearings each) and carried to the other seats by g_k; a candidate is
//     accepted when every seat's footprint slope ≤ SPAWN_MAX_SLOPE, the seats' heights differ by
//     ≤ SPAWN_MAX_RISE (nobody starts above the other) and no seat is inside a solid prop.
//     When none qualifies, the lowest-cost candidate is used (slope + 2·rise + 10·prop overlap).
//   yaw: rig convention rotation.y = atan2(dx, dz); two seats face each other, more face the centre.
// Pure module: no Three.js, no DOM, no Math.random.
import { heightAt, slopeAt, type Heightfield } from "../../world/Heightfield.ts";
import { objectSize, ringRadiusAt, type ArenaConfig, type ArenaObject } from "../ArenaConfig.ts";
import { NO_SYMMETRY, type Spawn, type SpawnPlan, type SymmetrySpec } from "./contracts.ts";
import { applyOp, symmetryOps, type SymOp } from "./symmetry.ts";

/** Steepest footprint slope a spawn accepts, rise/run. */
export const SPAWN_MAX_SLOPE = 0.2;
/** Largest height difference between seats, m (fairness: neither fighter starts above the other). */
export const SPAWN_MAX_RISE = 0.1;
/** Footprint radius sampled for the slope check, m. */
export const SPAWN_FOOTPRINT = 0.5;
/** Clearance kept from a solid prop's footprint, m. */
export const SPAWN_PROP_CLEARANCE = 0.6;

const DEG = Math.PI / 180;
const fin = (v: number, d: number) => (Number.isFinite(v) ? v : d);

/** Bearing (rad, CCW from +x) of seat 0's start zone. */
export function seatBearing(cfg: ArenaConfig, sym: SymmetrySpec): number {
  switch (sym.kind) {
    case "none": return fin(cfg.spawnAngle, 180) * DEG;
    case "mirror":
    case "mirror2": return (sym.axisDeg + 90) * DEG;
    case "point":
    case "rotational": return sym.axisDeg * DEG;
  }
}

/** Smallest ring radius over 64 bearings, m. */
export function minRingRadius(cfg: ArenaConfig): number {
  let r = Infinity;
  for (let k = 0; k < 64; k++) r = Math.min(r, ringRadiusAt(cfg, (k / 64) * Math.PI * 2));
  return r;
}

const rotOp = (t: number): SymOp => ({ a: Math.cos(t), b: -Math.sin(t), c: Math.sin(t), d: Math.cos(t), reflect: false, angle: t });

/** The transform carrying seat 0 to each seat, the seat-0 bearing, and whether every seat is a group image. */
export function seatOps(cfg: ArenaConfig, sym: SymmetrySpec, fighters = 2): { ops: SymOp[]; bearing: number; fair: boolean } {
  const n = Math.max(1, Math.round(fighters));
  const g = symmetryOps(sym);
  let bearing = seatBearing(cfg, sym);
  let ops: SymOp[] | null = null;
  if (n === 1) ops = [g[0]];
  else if (sym.kind === "mirror" && n === 2) ops = [g[0], g[1]];
  else if ((sym.kind === "mirror2" || sym.kind === "point") && n === 2) ops = [g[0], g[g.length - 1]]; // −I is last
  else if (sym.kind === "mirror2" && n <= 4) { bearing = (sym.axisDeg + 45) * DEG; ops = [g[0], g[3], g[1], g[2]].slice(0, n); }
  else if (sym.kind === "rotational") {
    const m = g.length;
    if (n === 2) ops = [g[0], g[Math.floor(m / 2)]];
    else if (n <= m) ops = Array.from({ length: n }, (_, k) => g[Math.round((k * m) / n) % m]);
  }
  if (ops) return { ops, bearing, fair: sym.kind !== "none" || n === 1 };
  return { ops: Array.from({ length: n }, (_, k) => rotOp((2 * Math.PI * k) / n)), bearing, fair: false };
}

function footprintSlope(field: Heightfield, x: number, z: number): number {
  let s = slopeAt(field, x, z);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    s = Math.max(s, slopeAt(field, x + SPAWN_FOOTPRINT * Math.cos(a), z + SPAWN_FOOTPRINT * Math.sin(a)));
  }
  return s;
}

/** Depth (m) by which a spawn footprint intrudes into the nearest solid prop's clearance (0 = clear). */
export function propIntrusion(props: readonly ArenaObject[], x: number, z: number): number {
  let worst = 0;
  for (const p of props) {
    if (!p.solid) continue;
    const need = objectSize(p.kind).r * p.scale + SPAWN_PROP_CLEARANCE;
    worst = Math.max(worst, need - Math.hypot(p.x - x, p.z - z));
  }
  return worst;
}

function yawToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}

/**
 * The start zones and spawns of an arena (see the header for every rule). `field` null = flat
 * ground (the nominal zone centres are the spawns). `props` (optional) are avoided too; the engine
 * places props AFTER the plan and keeps them out of the zones (symmetrizeObjects), so this is a
 * belt-and-braces check.
 */
export function spawnPlan(cfg: ArenaConfig, sym: SymmetrySpec = NO_SYMMETRY, field: Heightfield | null = null, fighters = 2, props: readonly ArenaObject[] = []): SpawnPlan {
  const { ops, bearing, fair } = seatOps(cfg, sym, fighters);
  const rMin = minRingRadius(cfg);
  const d = Math.max(0, Math.min(fin(cfg.spawnDistance, 2.5), 0.4 * rMin));
  const c0 = { x: d * Math.cos(bearing), z: d * Math.sin(bearing) };
  const centres = ops.map((op) => applyOp(op, c0.x, c0.z));
  let sep = Infinity;
  for (let i = 0; i < centres.length; i++) for (let j = i + 1; j < centres.length; j++) sep = Math.min(sep, Math.hypot(centres[i].x - centres[j].x, centres[i].z - centres[j].z));
  const r = Math.max(0, Math.min(fin(cfg.spawnZone, 1.5), 0.25 * rMin, Number.isFinite(sep) ? 0.45 * sep : Infinity));
  const zones = centres.map((c) => ({ x: c.x, z: c.z, r }));

  // Candidates for seat 0 inside its zone: the centre first, then two rings.
  const cands: { x: number; z: number }[] = [c0];
  for (const f of [1 / 3, 2 / 3]) for (let k = 0; k < 8; k++) {
    const a = bearing + (k * Math.PI) / 4;
    cands.push({ x: c0.x + f * r * Math.cos(a), z: c0.z + f * r * Math.sin(a) });
  }
  let best: { x: number; z: number }[] = centres, bestCost = Infinity;
  for (const c of cands) {
    const seats = ops.map((op) => applyOp(op, c.x, c.z));
    let slope = 0, lo = Infinity, hi = -Infinity, intrude = 0;
    for (const s of seats) {
      if (field) {
        slope = Math.max(slope, footprintSlope(field, s.x, s.z));
        const h = heightAt(field, s.x, s.z);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      intrude = Math.max(intrude, propIntrusion(props, s.x, s.z));
    }
    const rise = field ? hi - lo : 0;
    if (slope <= SPAWN_MAX_SLOPE && rise <= SPAWN_MAX_RISE && intrude <= 0) { best = seats; break; }
    const cost = slope + 2 * rise + 10 * intrude;
    if (cost < bestCost) { bestCost = cost; best = seats; }
  }
  const n = best.length;
  const spawns: Spawn[] = best.map((p, k) => {
    if (n === 2) { const o = best[1 - k]; return { x: p.x, z: p.z, yaw: yawToward(p.x, p.z, o.x, o.z) }; }
    return { x: p.x, z: p.z, yaw: Math.hypot(p.x, p.z) > 1e-9 ? yawToward(p.x, p.z, 0, 0) : 0 };
  });
  return { spawns, zones, fair };
}
