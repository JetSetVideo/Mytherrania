// Wave J (lane J-B): a MINIMAL wall plan + arena digest built from the frozen contract's fields,
// for the batch while lane J-T's generator (src/game/arena/{walls,digest,spawns}.ts) is not in the
// tree. It fills every ArenaDigest / WallPlan field honestly from the ArenaConfig and one wall rule;
// it does NOT reproduce J-T's rule combination, symmetry or terrain relief (terrain is flat here).
// Batch.ts takes an ArenaProvider, so the parent swaps J-T's builder in without touching the sim.
//
// Pure module: no THREE, no DOM, no Math.random.

import {
  DIGEST_DIRS, NO_SYMMETRY, WALL_BLOCK_HEIGHT, WALL_SEGMENTS,
  type ArenaDigest, type PropDigest, type SpawnPlan, type SymmetrySpec, type WallPlan, type WallRuleKind, type WallSegment,
} from "../game/arena/contracts.ts";
import { objectSize, placeObjects, ringRadiusAt, shapeOf, type ArenaConfig } from "../game/ArenaConfig.ts";
import { randomSource } from "./ArenaHarness.ts";

const TAU = Math.PI * 2;

/** One built arena: what MatchConditions carries besides the config. */
export interface BuiltArena { walls: WallPlan; digest: ArenaDigest; symmetry: SymmetrySpec }

/** How the batch asks for an arena (Batch.ts default = buildFallbackArena). */
export type ArenaProvider = (cfg: ArenaConfig, wall: WallRuleKind, baseHeight: number, seed: number) => BuiltArena;

/** Height factor of a single rule at segment i (of n), 0..2 (× baseHeight). */
function ruleHeight(kind: WallRuleKind, i: number, n: number, noise: () => number): number {
  const a = ((i + 0.5) / n) * TAU;
  switch (kind) {
    case "none": return 0;
    case "low": return 0.45; // a curb: below WALL_BLOCK_HEIGHT for any base ≤ 1.3 m
    case "full": return 1;
    case "half": return Math.cos(a) > 0 ? 1 : 0; // the +x half is walled
    case "gates": {
      // Openings two segments wide centred on the spawn axis (angles 0 and π).
      const d = Math.min(Math.abs(a), Math.abs(a - Math.PI), Math.abs(a - TAU)) / (TAU / n);
      return d < 1 ? 0 : 1;
    }
    case "ruin": { const h = noise(); return h < 0.35 ? 0 : h * 1.2; }
    case "battlement": return Math.floor(i / 2) % 2 === 0 ? 1 : 0.4;
    case "towers": return i % 8 === 0 ? 2 : 0.4;
  }
}

/** A one-rule wall plan (weight 1, combine "max"), WALL_SEGMENTS segments, contract-complete. */
export function fallbackWallPlan(cfg: ArenaConfig, kind: WallRuleKind, baseHeight: number, seed: number): WallPlan {
  const n = WALL_SEGMENTS;
  const rng = randomSource((seed ^ 0x51ed270b) >>> 0);
  const base = Number.isFinite(baseHeight) ? Math.max(0, baseHeight) : 0;
  const segments: WallSegment[] = [];
  for (let i = 0; i < n; i++) {
    const h = Math.max(0, ruleHeight(kind, i, n, rng) * base);
    segments.push({ a0: (i / n) * TAU, a1: ((i + 1) / n) * TAU, height: h, resistance: cfg.wallResistance, bounce: cfg.wallBounce });
  }
  const blocked = segments.filter((s) => s.height >= WALL_BLOCK_HEIGHT).length;
  return {
    rules: [{ kind, weight: 1, params: {} }],
    combine: "max",
    baseHeight: base,
    segments,
    coverage: blocked / n,
    meanHeight: segments.reduce((t, s) => t + s.height, 0) / n,
    maxHeight: segments.reduce((m, s) => Math.max(m, s.height), 0),
  };
}

/** Wall segment covering an angle (rad, CCW from +x). */
export function segmentAt(plan: WallPlan, angle: number): WallSegment | null {
  const n = plan.segments.length;
  if (n === 0) return null;
  const a = ((angle % TAU) + TAU) % TAU;
  const i = Math.min(n - 1, Math.floor((a / TAU) * n));
  return plan.segments[i];
}

/** The fair symmetric spawn pair the engine uses (±min(2.5, 0.4 · rim) on the x axis). */
export function fallbackSpawns(cfg: ArenaConfig): SpawnPlan {
  const rimX = Math.min(ringRadiusAt(cfg, 0), ringRadiusAt(cfg, Math.PI));
  const s = Math.min(2.5, rimX * 0.4);
  return {
    spawns: [{ x: -s, z: 0, yaw: 0 }, { x: s, z: 0, yaw: Math.PI }],
    zones: [{ x: -s, z: 0, r: Math.max(0.2, s * 0.5) }, { x: s, z: 0, r: Math.max(0.2, s * 0.5) }],
    fair: true,
  };
}

/** The digest for a config + plan + props (flat terrain). */
export function fallbackDigest(cfg: ArenaConfig, walls: WallPlan, props: PropDigest[], spawns: SpawnPlan): ArenaDigest {
  const rim: number[] = [], wallHeight: number[] = [], open: number[] = [];
  for (let k = 0; k < DIGEST_DIRS; k++) {
    const a = (k / DIGEST_DIRS) * TAU;
    rim.push(ringRadiusAt(cfg, a));
    const h = segmentAt(walls, a)?.height ?? 0;
    wallHeight.push(h);
    open.push(h >= WALL_BLOCK_HEIGHT ? 0 : 1);
  }
  const outsideSolid = cfg.outsideGround >= 1 && cfg.outsideCollision >= 1;
  return {
    size: cfg.size,
    shape: shapeOf(cfg),
    rim, wallHeight, open,
    openFraction: open.reduce((t, v) => t + v, 0) / DIGEST_DIRS,
    outsideDrop: outsideSolid ? Math.max(0, -cfg.outsideHeight) : cfg.pitDepth,
    ringOutFatal: !outsideSolid,
    ceiling: cfg.ceiling,
    props,
    terrain: { min: 0, max: 0, mean: 0, slope: 0 },
    ground: cfg.ground,
    friction: cfg.friction,
    wind: cfg.wind,
    symmetry: NO_SYMMETRY,
    spawns,
  };
}

/** Props as the digest carries them (circles), from the config's own placer. */
export function propDigests(cfg: ArenaConfig, seed: number): PropDigest[] {
  return placeObjects(cfg, randomSource((seed ^ 0x2c1b3c6d) >>> 0)).map((p) => {
    const sz = objectSize(p.kind);
    return { x: p.x, z: p.z, r: sz.r * p.scale, h: sz.h * p.scale, solid: p.solid };
  });
}

/** The default ArenaProvider. */
export const buildFallbackArena: ArenaProvider = (cfg, wall, baseHeight, seed) => {
  const walls = fallbackWallPlan(cfg, wall, baseHeight, seed);
  const digest = fallbackDigest(cfg, walls, propDigests(cfg, seed), fallbackSpawns(cfg));
  return { walls, digest, symmetry: NO_SYMMETRY };
};
