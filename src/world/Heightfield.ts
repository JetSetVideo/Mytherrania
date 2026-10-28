// Heightfield: the rule-driven arena terrain (R07, R08).
//
// Pipeline of `generateHeightfield(seed, rules, outline)`:
//   1. base     fBm value noise -> normalizeMinMax -> [0, 1] -> remapToTargetBand so
//               p80 - p20 = targetBand, then centred on its median (datum 0: half the
//               ground is raised, half dug).
//   2. bumps    Pareto bumps/dips added in RELATIVE units (1 = local relief).
//   3. relief   heights_m = relief(rNorm) * relative: the fight zone is held to
//               fightRelief (one step), the ring band blends up to ringRelief, the
//               outside to outsideRelief (freer ground), all with smoothstep blends.
//   4. relax    slope-limit pass over unflagged pairs (no node flagged yet).
//   5. stamps   cliffs, holes and ramps, FLAGGED in featureMask.
//   6. relax    second pass: repairs ordinary ground around the stamps; flagged pairs skipped.
//   7. stats    summaries, slope statistics, Pareto shares, per-zone spread.
//
// PUBLIC LAYOUT (Lane F minimap and the mesh read these directly):
//   node (i, j), i in [0, cols), j in [0, rows), is at world x = originX + i * cell,
//   z = originZ + j * cell; its height is heights[j * cols + i] (metres, y up, datum 0 =
//   the ring's median ground); featureMask / zone / ringNorm use the same index.
//
// Pure module: no Three.js, no DOM.
import { lerp, normalizeMinMax, rng32, smoothstep, summarize, topShare, type Summary } from "../core/MathCore.ts";
import { ringRadiusAt, type ArenaConfig } from "../game/ArenaConfig.ts";
import { fbm2, makeFbmOctaves, maxSlopeExcess, relaxSlopes, remapToTargetBand, slopePairs, type RelaxReport } from "./HeightOps.ts";
import { rNormAt, stampDeliberate, stampParetoBumps, type ArenaOutline, type TerrainFeature, type WorkGrid } from "./TerrainFeatures.ts";
import { deriveTerrainRules, type DeliberateCounts, type TerrainBase, type TerrainRules } from "./TerrainRules.ts";

export { FEATURE_CLIFF, FEATURE_HOLE, FEATURE_NONE, FEATURE_RAMP, rNormAt } from "./TerrainFeatures.ts";
export type { ArenaOutline, TerrainFeature, TerrainFeatureKind } from "./TerrainFeatures.ts";

/** zone codes per node: where the node sits relative to the ring. */
export const ZONE_FIGHT = 0;
export const ZONE_RING = 1;
export const ZONE_OUTSIDE = 2;

/** Everything measured about a generated field. Heights in metres, slopes as rise/run. */
export interface HeightfieldStats {
  /** Normalised base noise after the target-band remap: min 0, max 1, p80 - p20 = targetBand. */
  base: Summary;
  /** p80 - p20 of the base straight after normalizeMinMax (before the remap). */
  baseBandBeforeRemap: number;
  /** Final heights, m. */
  heights: Summary;
  /** Final heights min-max normalised to [0, 1]. */
  normalised: Summary;
  /** normalised.p80 - normalised.p20, compared with targetBand (holes and cliffs stretch min/max, so it reads lower). */
  measuredBand: number;
  /** The same band over UNFLAGGED nodes only, normalised by their own min/max. */
  measuredBandOrdinary: number;
  targetBand: number;
  /** |dh| / distance over every unflagged 8-neighbour pair. */
  slope: Summary;
  /** The walkable limit, tan(maxSlope). slope.max must not exceed it. */
  slopeLimitTan: number;
  /** Steepest pair touching a flagged node (holes and cliffs push this far past the limit). */
  flaggedMaxSlope: number;
  /** max(|dh| - limit) over unflagged pairs, m: <= 0 when the rule holds everywhere. */
  slopeResidual: number;
  relaxFirst: RelaxReport;
  relaxSecond: RelaxReport;
  features: {
    count: number;
    raised: number;
    dug: number;
    /** topShare(drawn relative amplitudes, 0.2): the Pareto check, expected ~0.8. */
    shareDrawn: number;
    /** topShare(|amplitude in metres|, 0.2), after the local relief scaling. */
    shareMetres: number;
    /** topShare(volume ~ 0.3 pi r^2 |A|, 0.2): share of displaced ground. */
    shareVolume: number;
    alpha: number;
    expectedShare: number;
  };
  /** Population stdev of heights per zone, m: the fight zone must be the calmest. */
  zones: { fightStdev: number; ringStdev: number; outsideStdev: number };
  deliberate: { requested: DeliberateCounts; placed: DeliberateCounts; flaggedNodes: number };
  /** Wall-clock generation time, ms (informative only; not part of determinism). */
  millis: number;
}

/** A generated terrain. Plain data: safe to share with the minimap, the mesh and the path finder. */
export interface Heightfield {
  /** Nodes along x. */
  cols: number;
  /** Nodes along z. */
  rows: number;
  /** Node spacing, m. */
  cell: number;
  /** World position of node (0, 0), m. */
  originX: number;
  originZ: number;
  /** Height per node, m (index j * cols + i). */
  heights: Float32Array;
  /** featureMask per node: 0 none, 1 hole, 2 cliff, 4 ramp (FEATURE_* bit values, one set per flagged node). */
  featureMask: Uint8Array;
  /** zone per node: 0 fight, 1 ring band, 2 outside (ZONE_* constants). */
  zone: Uint8Array;
  /** rNorm per node: 0 centre, 1 on the ring outline, > 1 outside. */
  ringNorm: Float32Array;
  features: TerrainFeature[];
  rules: TerrainRules;
  seed: number;
  stats: HeightfieldStats;
}

/** Options beyond the rules: override the deliberate feature counts (e.g. no holes in a tutorial). */
export interface GenerateOptions {
  deliberate?: Partial<DeliberateCounts>;
}

/**
 * Local relief (peak-to-peak height budget, m) at a given rNorm:
 *   rNorm <= fz             fightRelief
 *   fz .. 1                 lerp(fightRelief, ringRelief, smoothstep(fz, 1, rNorm))
 *   1 .. 1 + blendWidth     lerp(ringRelief, outsideRelief, smoothstep(1, 1 + blendWidth, rNorm))
 */
export function reliefAtNorm(rules: TerrainRules, rNorm: number): number {
  if (rNorm <= 1) return lerp(rules.fightRelief, rules.ringRelief, smoothstep(rules.fightZoneFraction, 1, rNorm));
  return lerp(rules.ringRelief, rules.outsideRelief, smoothstep(1, 1 + rules.outsideBlendWidth, rNorm));
}

/** The ring outline of an ArenaConfig, as a polar function. */
export function outlineFromArena(cfg: ArenaConfig): ArenaOutline {
  return { radiusAt: (angle: number) => ringRadiusAt(cfg, angle) };
}

/** A circular outline of `radius` metres (tests, previews). */
export function circleOutline(radius: number): ArenaOutline {
  return { radiusAt: () => radius };
}

/** Widest radius of an outline, m, sampled at `samples` bearings. */
export function outlineMaxRadius(outline: ArenaOutline, samples = 64): number {
  let r = 0;
  for (let k = 0; k < samples; k++) r = Math.max(r, outline.radiusAt((k / samples) * Math.PI * 2));
  return r;
}

/**
 * Generate the terrain of one arena. Deterministic: the same seed, rules and outline give
 * a bit-identical `heights` array. `rules.base.arenaRadius` should be the outline's widest
 * radius (generateArenaTerrain does that for an ArenaConfig).
 */
export function generateHeightfield(seed: number, rules: TerrainRules, outline: ArenaOutline, options: GenerateOptions = {}): Heightfield {
  const started = performance.now();
  const rng = rng32(seed);
  const cols = rules.gridAxis, rows = rules.gridAxis, cell = rules.cell;
  const originX = -((cols - 1) * cell) / 2, originZ = -((rows - 1) * cell) / 2;
  const count = cols * rows;
  const ringNorm = new Float32Array(count), zone = new Uint8Array(count), relief = new Float64Array(count);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const n = j * cols + i;
      const rn = rNormAt(outline, originX + i * cell, originZ + j * cell);
      ringNorm[n] = rn;
      zone[n] = rn <= rules.fightZoneFraction ? ZONE_FIGHT : rn <= 1 ? ZONE_RING : ZONE_OUTSIDE;
      relief[n] = reliefAtNorm(rules, rn);
    }
  }

  // 1. base: fBm -> [0, 1] -> target band -> centred on the median.
  const octaves = makeFbmOctaves(rules.octaveGains, rules.baseWavelength, rng);
  const base = new Float64Array(count);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) base[j * cols + i] = fbm2(octaves, originX + i * cell, originZ + j * cell);
  normalizeMinMax(base);
  const before = summarize(base);
  remapToTargetBand(base, before.p20, before.p80, rules.targetBand);
  const baseSummary = summarize(base);
  const grid: WorkGrid = { cols, rows, cell, originX, originZ, h: new Float64Array(count), mask: new Uint8Array(count) };
  for (let n = 0; n < count; n++) grid.h[n] = base[n] - baseSummary.median;

  // 2. Pareto bumps in relative units; 3. scale by the local relief.
  const bumps = stampParetoBumps(grid, rules, (x, z) => reliefAtNorm(rules, rNormAt(outline, x, z)), rng);
  for (let n = 0; n < count; n++) grid.h[n] *= relief[n];

  // 4. relax ordinary ground; 5. stamp flagged features; 6. relax again around them.
  const relaxFirst = relaxSlopes(grid.h, grid.mask, cols, rows, rules.maxNeighbourDelta, rules.maxDiagonalDelta, rules.relaxMaxIterations, rules.relaxSlack);
  const requested: DeliberateCounts = { ...rules.deliberate, ...options.deliberate };
  const deliberate = stampDeliberate(grid, rules, outline, requested, rng);
  const relaxSecond = relaxSlopes(grid.h, grid.mask, cols, rows, rules.maxNeighbourDelta, rules.maxDiagonalDelta, rules.relaxMaxIterations, rules.relaxSlack);

  const heights = Float32Array.from(grid.h);
  const field: Heightfield = {
    cols, rows, cell, originX, originZ, heights, featureMask: grid.mask, zone, ringNorm,
    features: [...bumps, ...deliberate.features], rules, seed,
    stats: undefined as unknown as HeightfieldStats,
  };
  field.stats = measureHeightfield(field, baseSummary, before.p80 - before.p20, relaxFirst, relaxSecond, requested, deliberate.placed, started);
  return field;
}

/**
 * A perfectly flat field (every height 0, no features) on the grid `rules` derive: the
 * "terrain off" arena, and a fixture for path-finding tests (callers may then write into
 * `heights` / `featureMask`, e.g. to build a wall).
 */
export function flatHeightfield(rules: TerrainRules, outline: ArenaOutline): Heightfield {
  const started = performance.now();
  const cols = rules.gridAxis, rows = rules.gridAxis, cell = rules.cell, count = cols * rows;
  const originX = -((cols - 1) * cell) / 2, originZ = -((rows - 1) * cell) / 2;
  const ringNorm = new Float32Array(count), zone = new Uint8Array(count);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const n = j * cols + i, rn = rNormAt(outline, originX + i * cell, originZ + j * cell);
      ringNorm[n] = rn;
      zone[n] = rn <= rules.fightZoneFraction ? ZONE_FIGHT : rn <= 1 ? ZONE_RING : ZONE_OUTSIDE;
    }
  }
  const field: Heightfield = {
    cols, rows, cell, originX, originZ, heights: new Float32Array(count), featureMask: new Uint8Array(count),
    zone, ringNorm, features: [], rules, seed: 0, stats: undefined as unknown as HeightfieldStats,
  };
  const idle: RelaxReport = { iterations: 0, converged: true, residual: -rules.maxNeighbourDelta, corrections: 0 };
  const none: DeliberateCounts = { holes: 0, cliffs: 0, ramps: 0 };
  field.stats = measureHeightfield(field, summarize([0, 1]), 0, idle, idle, none, none, started);
  return field;
}

/** Convenience: derive the rules from an ArenaConfig (arenaRadius = widest ring radius) and generate. */
export function generateArenaTerrain(seed: number, cfg: ArenaConfig, over: Partial<TerrainBase> = {}, options: GenerateOptions = {}): Heightfield {
  const outline = outlineFromArena(cfg);
  const rules = deriveTerrainRules({ arenaRadius: outlineMaxRadius(outline), ...over });
  return generateHeightfield(seed, rules, outline, options);
}

function measureHeightfield(
  f: Heightfield, base: Summary, baseBandBeforeRemap: number, relaxFirst: RelaxReport, relaxSecond: RelaxReport,
  requested: DeliberateCounts, placed: DeliberateCounts, started: number,
): HeightfieldStats {
  const r = f.rules;
  const heights = summarize(f.heights);
  const norm = Float64Array.from(f.heights);
  normalizeMinMax(norm);
  const normalised = summarize(norm);
  const ordinary: number[] = [];
  for (let n = 0; n < f.heights.length; n++) if (f.featureMask[n] === 0) ordinary.push(f.heights[n]);
  normalizeMinMax(ordinary);
  const ordinarySummary = summarize(ordinary.length ? ordinary : [0]);
  const unflagged = slopePairs(f.heights, f.featureMask, f.cols, f.rows, f.cell, "unflagged");
  const flagged = slopePairs(f.heights, f.featureMask, f.cols, f.rows, f.cell, "flagged");
  let flaggedMax = 0;
  for (let k = 0; k < flagged.length; k++) flaggedMax = Math.max(flaggedMax, flagged[k]);
  const bumps = f.features.filter((x) => x.kind === "bump" || x.kind === "dip");
  const zoneValues: number[][] = [[], [], []];
  let flaggedNodes = 0;
  for (let n = 0; n < f.heights.length; n++) {
    zoneValues[f.zone[n]].push(f.heights[n]);
    if (f.featureMask[n] !== 0) flaggedNodes++;
  }
  const stdev = (v: number[]) => (v.length ? summarize(v).stdev : 0);
  return {
    base, baseBandBeforeRemap, heights, normalised,
    measuredBand: normalised.p80 - normalised.p20,
    measuredBandOrdinary: ordinarySummary.p80 - ordinarySummary.p20,
    targetBand: r.targetBand,
    slope: summarize(unflagged.length ? unflagged : [0]),
    slopeLimitTan: r.maxSlopeTan,
    flaggedMaxSlope: flaggedMax,
    slopeResidual: maxSlopeExcess(f.heights, f.featureMask, f.cols, f.rows, r.maxNeighbourDelta, r.maxDiagonalDelta, "unflagged"),
    relaxFirst, relaxSecond,
    features: {
      count: bumps.length,
      raised: bumps.filter((x) => x.amplitude > 0).length,
      dug: bumps.filter((x) => x.amplitude < 0).length,
      shareDrawn: topShare(bumps.map((x) => x.relative), 0.2),
      shareMetres: topShare(bumps.map((x) => Math.abs(x.amplitude)), 0.2),
      // Volume under 1 - smoothstep(0, r, d) is integral 2 pi d (1 - s) dd = 0.3 pi r^2.
      shareVolume: topShare(bumps.map((x) => 0.3 * Math.PI * x.radius * x.radius * Math.abs(x.amplitude)), 0.2),
      alpha: r.featureAlpha,
      expectedShare: r.featureExpectedShare,
    },
    zones: { fightStdev: stdev(zoneValues[ZONE_FIGHT]), ringStdev: stdev(zoneValues[ZONE_RING]), outsideStdev: stdev(zoneValues[ZONE_OUTSIDE]) },
    deliberate: { requested, placed, flaggedNodes },
    millis: performance.now() - started,
  };
}

// ---------------------------------------------------------------------------
// Sampling. Allocation-free: safe to call per body per frame.
// ---------------------------------------------------------------------------

/** Ground height at world (x, z), m: bilinear between the four surrounding nodes, clamped to the grid. */
export function heightAt(f: Heightfield, x: number, z: number): number {
  let fx = (x - f.originX) / f.cell, fz = (z - f.originZ) / f.cell;
  fx = fx < 0 ? 0 : fx > f.cols - 1 ? f.cols - 1 : fx;
  fz = fz < 0 ? 0 : fz > f.rows - 1 ? f.rows - 1 : fz;
  const i = Math.min(f.cols - 2, Math.floor(fx)), j = Math.min(f.rows - 2, Math.floor(fz));
  const tx = fx - i, tz = fz - j, n = j * f.cols + i, h = f.heights;
  const top = h[n] + (h[n + 1] - h[n]) * tx;
  const bottom = h[n + f.cols] + (h[n + f.cols + 1] - h[n + f.cols]) * tx;
  return top + (bottom - top) * tz;
}

/** A mutable 3-vector for allocation-free outputs. */
export interface Vec3Out {
  x: number;
  y: number;
  z: number;
}

/**
 * Unit surface normal at world (x, z) from central differences of heightAt over one cell:
 *   n = normalize(-dh/dx, 1, -dh/dz). Writes into `out` (and returns it).
 */
export function normalAt(f: Heightfield, x: number, z: number, out: Vec3Out = { x: 0, y: 1, z: 0 }): Vec3Out {
  const e = f.cell * 0.5;
  const dx = (heightAt(f, x + e, z) - heightAt(f, x - e, z)) / (2 * e);
  const dz = (heightAt(f, x, z + e) - heightAt(f, x, z - e)) / (2 * e);
  const inv = 1 / Math.hypot(dx, 1, dz);
  out.x = -dx * inv;
  out.y = inv;
  out.z = -dz * inv;
  return out;
}

/** Slope (rise/run) at world (x, z): tan of the angle between the normal and +y. */
export function slopeAt(f: Heightfield, x: number, z: number): number {
  const e = f.cell * 0.5;
  const dx = (heightAt(f, x + e, z) - heightAt(f, x - e, z)) / (2 * e);
  const dz = (heightAt(f, x, z + e) - heightAt(f, x, z - e)) / (2 * e);
  return Math.hypot(dx, dz);
}

/** Index of the node nearest to world (x, z), clamped to the grid. */
export function nearestNode(f: Heightfield, x: number, z: number): number {
  const i = Math.max(0, Math.min(f.cols - 1, Math.round((x - f.originX) / f.cell)));
  const j = Math.max(0, Math.min(f.rows - 1, Math.round((z - f.originZ) / f.cell)));
  return j * f.cols + i;
}

/** World x of node column i, m. */
export function nodeX(f: Heightfield, i: number): number {
  return f.originX + i * f.cell;
}

/** World z of node row j, m. */
export function nodeZ(f: Heightfield, j: number): number {
  return f.originZ + j * f.cell;
}
