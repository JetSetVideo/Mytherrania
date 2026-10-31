// The arena digest (wave J, lane J-T): everything the generator decided that changes a fight,
// as plain JSON-safe numbers the AI (live tree, headless sim, neural policy) can read — where the
// edge is, how high the wall stands there, which directions are open ring-out lanes, how far a
// ringed-out body falls, the obstacles, the ground, the symmetry and the start zones.
//
// Sampling: DIGEST_DIRS = 32 rays from the centre at k·2π/32 (CCW from +x).
//   rim[k]         ringRadiusAt(cfg, θk)
//   wallHeight[k]  the plan's segment height at θk (0 when cfg.walls = 0) — a RAY sample: gates and
//                  crenels are ≥ 15° wide (two segments) so they always hold a ray; a ruin gap or a
//                  tower narrower than 11.25° can fall between rays (documented gap).
//   open[k]        1 when wallHeight[k] < WALL_BLOCK_HEIGHT (a knocked-back body trips over it)
//   outsideDrop    solid outside ground: max(0, −outsideHeight); a void: pitDepth
//   ringOutFatal   no solid outside ground (void), or a drop ≥ RING_OUT_FATAL_DROP. NB: under
//                  RingOut V03 EVERY ring-out ends the match; "fatal" says the body is lost rather
//                  than landing on outside ground (it changes how the ragdoll ends, not who wins).
//   terrain        over the field's nodes inside the ring: min/max/mean height and the mean slope
//                  angle atan(slopeAt), rad (zeros when no field).
// Pure module: no Three.js, no DOM, no Math.random.
import { slopeAt, type Heightfield } from "../../world/Heightfield.ts";
import { objectSize, ringRadiusAt, shapeOf, type ArenaConfig, type ArenaObject } from "../ArenaConfig.ts";
import { DIGEST_DIRS, WALL_BLOCK_HEIGHT, type ArenaDigest, type PropDigest, type SpawnPlan, type SymmetrySpec, type WallPlan } from "./contracts.ts";
import { wallHeightAt } from "./walls.ts";

/** A drop at least this deep beyond the rim counts as fatal, m (well past any fall the ragdoll survives). */
export const RING_OUT_FATAL_DROP = 8;
/** A solid prop at least this tall blocks a line of sight / a swing for `cover`, m. */
export const COVER_MIN_HEIGHT = 0.9;

const TAU = Math.PI * 2;
const fin = (v: number, d = 0) => (Number.isFinite(v) ? v : d);
const round = (v: number, p = 1e4) => Math.round(fin(v) * p) / p;

/** The digest of one arena (see the header). JSON-serialisable: every number finite. */
export function arenaDigest(
  cfg: ArenaConfig, plan: WallPlan, field: Heightfield | null, objects: readonly ArenaObject[], sym: SymmetrySpec, spawns: SpawnPlan,
): ArenaDigest {
  const rim: number[] = [], wallHeight: number[] = [], open: number[] = [];
  const walled = cfg.walls >= 1;
  for (let k = 0; k < DIGEST_DIRS; k++) {
    const a = (k / DIGEST_DIRS) * TAU;
    rim.push(round(ringRadiusAt(cfg, a)));
    const h = walled ? fin(wallHeightAt(plan, a)) : 0;
    wallHeight.push(round(h));
    open.push(h < WALL_BLOCK_HEIGHT ? 1 : 0);
  }
  const solidOutside = cfg.outsideGround >= 1 && cfg.outsideCollision >= 1;
  const outsideDrop = solidOutside ? Math.max(0, -fin(cfg.outsideHeight)) : Math.max(0, fin(cfg.pitDepth));
  const props: PropDigest[] = objects.map((o) => {
    const s = objectSize(o.kind);
    return { x: round(o.x), z: round(o.z), r: round(s.r * fin(o.scale, 1)), h: round(s.h * fin(o.scale, 1)), solid: !!o.solid };
  });
  let terrain = { min: 0, max: 0, mean: 0, slope: 0 };
  if (field) {
    let lo = Infinity, hi = -Infinity, sum = 0, slope = 0, n = 0;
    for (let j = 0; j < field.rows; j++) {
      for (let i = 0; i < field.cols; i++) {
        const k = j * field.cols + i;
        if (!(field.ringNorm[k] < 1)) continue;
        const h = field.heights[k];
        lo = Math.min(lo, h); hi = Math.max(hi, h); sum += h; n++;
        slope += Math.atan(slopeAt(field, field.originX + i * field.cell, field.originZ + j * field.cell));
      }
    }
    if (n > 0) terrain = { min: round(lo), max: round(hi), mean: round(sum / n), slope: round(slope / n) };
  }
  return {
    size: fin(cfg.size), shape: shapeOf(cfg), rim, wallHeight, open,
    openFraction: round(open.reduce((a, b) => a + b, 0) / DIGEST_DIRS),
    outsideDrop: round(outsideDrop), ringOutFatal: !solidOutside || outsideDrop >= RING_OUT_FATAL_DROP,
    ceiling: fin(cfg.ceiling), props, terrain,
    ground: fin(cfg.ground), friction: fin(cfg.friction, 1), wind: fin(cfg.wind),
    symmetry: { kind: sym.kind, order: fin(sym.order, 1), axisDeg: round(fin(sym.axisDeg)) },
    spawns: {
      spawns: spawns.spawns.map((s) => ({ x: round(s.x), z: round(s.z), yaw: round(s.yaw) })),
      zones: spawns.zones.map((z) => ({ x: round(z.x), z: round(z.z), r: round(z.r) })),
      fair: spawns.fair,
    },
  };
}

/** Per-frame numbers the AI reads at a fighter's position (all finite). */
export interface DigestFeatures {
  /** Distance to the rim along the KNOCKBACK direction (from `toward` through the fighter), m. */
  edgeAway: number;
  /** Wall height where that ray meets the rim, m, and 1 when it is an open ring-out edge there. */
  wallAway: number;
  openAway: number;
  /** The same along the direction of travel (from the fighter toward `toward`), m. */
  edgeToward: number;
  wallToward: number;
  openToward: number;
  /** Nearest open rim point from the fighter (a ring-out lane): its bearing FROM the fighter (rad), its distance (m). */
  openAngle: number;
  openDist: number;
  /** 1 when any open direction exists, else 0 (then openAngle = 0, openDist = −1). */
  hasOpen: number;
  /** Fraction (0..1) of 5 parallel lines fighter → `toward` (lateral offsets 0, ±0.25, ±0.5 m) blocked by a solid prop ≥ COVER_MIN_HEIGHT. */
  cover: number;
}

/** Rim point of digest direction k. */
function rimPoint(d: ArenaDigest, k: number): { x: number; z: number } {
  const a = (k / DIGEST_DIRS) * TAU;
  return { x: d.rim[k] * Math.cos(a), z: d.rim[k] * Math.sin(a) };
}

/**
 * Cast a ray from (x, z) along unit (ux, uz) to the digest's rim polygon (the 32 rim points):
 * the distance to the first crossing (0 when the start is outside and the ray never crosses) and
 * the digest direction nearest to the crossing's bearing from the centre.
 */
export function rimRay(d: ArenaDigest, x: number, z: number, ux: number, uz: number): { dist: number; dir: number } {
  let best = Infinity, hitX = x, hitZ = z;
  for (let k = 0; k < DIGEST_DIRS; k++) {
    const a = rimPoint(d, k), b = rimPoint(d, (k + 1) % DIGEST_DIRS);
    const ex = b.x - a.x, ez = b.z - a.z;
    const den = ux * ez - uz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const wx = a.x - x, wz = a.z - z;
    const t = (wx * ez - wz * ex) / den, s = (wx * uz - wz * ux) / den;
    if (t >= 0 && s >= -1e-9 && s <= 1 + 1e-9 && t < best) { best = t; hitX = x + ux * t; hitZ = z + uz * t; }
  }
  const dist = Number.isFinite(best) ? best : 0;
  const bearing = Math.atan2(hitZ, hitX);
  const dir = ((Math.round((bearing / TAU) * DIGEST_DIRS) % DIGEST_DIRS) + DIGEST_DIRS) % DIGEST_DIRS;
  return { dist, dir };
}

/** Does the segment p→q pass within r of c? */
function segmentHitsDisc(px: number, pz: number, qx: number, qz: number, cx: number, cz: number, r: number): boolean {
  const dx = qx - px, dz = qz - pz, L2 = dx * dx + dz * dz;
  let t = L2 > 1e-12 ? ((cx - px) * dx + (cz - pz) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px + dx * t - cx, pz + dz * t - cz) < r;
}

/**
 * The per-frame features at a fighter standing at (x, z) with `toward` = the other body (the
 * attacker for a knockback, the target for travel). A zero-length direction falls back to the
 * radial direction from the centre (or +x at the centre).
 */
export function digestFeatures(d: ArenaDigest, x: number, z: number, towardX: number, towardZ: number): DigestFeatures {
  let ux = towardX - x, uz = towardZ - z, L = Math.hypot(ux, uz);
  if (!(L > 1e-9)) {
    const R = Math.hypot(x, z);
    // Fall back to the radial direction: "toward" points at the centre, so "away" points out.
    if (R > 1e-9) { ux = -x / R; uz = -z / R; } else { ux = -1; uz = 0; }
    L = 1;
  } else { ux /= L; uz /= L; }
  const away = rimRay(d, x, z, -ux, -uz), ahead = rimRay(d, x, z, ux, uz);
  let openAngle = 0, openDist = -1, hasOpen = 0, bestD = Infinity;
  for (let k = 0; k < DIGEST_DIRS; k++) {
    if (!d.open[k]) continue;
    const p = rimPoint(d, k), dist = Math.hypot(p.x - x, p.z - z);
    if (dist < bestD) { bestD = dist; openDist = dist; openAngle = Math.atan2(p.z - z, p.x - x); hasOpen = 1; }
  }
  let blocked = 0;
  if (Math.hypot(towardX - x, towardZ - z) > 1e-9) {
    const nx = -uz, nz = ux;
    for (const off of [0, -0.25, 0.25, -0.5, 0.5]) {
      const px = x + nx * off, pz = z + nz * off, qx = towardX + nx * off, qz = towardZ + nz * off;
      if (d.props.some((p) => p.solid && p.h >= COVER_MIN_HEIGHT && segmentHitsDisc(px, pz, qx, qz, p.x, p.z, p.r))) blocked++;
    }
  }
  return {
    edgeAway: fin(away.dist), wallAway: fin(d.wallHeight[away.dir]), openAway: d.open[away.dir] ? 1 : 0,
    edgeToward: fin(ahead.dist), wallToward: fin(d.wallHeight[ahead.dir]), openToward: d.open[ahead.dir] ? 1 : 0,
    openAngle: fin(openAngle), openDist: fin(openDist, -1), hasOpen, cover: blocked / 5,
  };
}
