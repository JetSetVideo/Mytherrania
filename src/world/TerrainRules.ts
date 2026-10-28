// TerrainRules: the terrain generator's rules, as DATA (R07, R08).
//
// A handful of NAMED BASE PARAMETERS (grid spacing, arena radius, walkable slope,
// fighter step height, fBm persistence, outside margin, grid cap) and EVERY other
// number the generator, the slope relaxation and the path finder use is DERIVED from
// them, with its equation written next to it. `describeTerrainRules` lists every
// derived value with its equation, so docs, the report script and a debug overlay
// can show the working instead of a wall of magic numbers.
//
// Pure module: no Three.js, no DOM.
//
// Vocabulary (used the same way in Heightfield.ts and PathFinder.ts):
//   node      one height sample of the grid. Heights live on nodes.
//   cell      the spacing between two adjacent nodes, metres.
//   slope     rise over run, dimensionless (tan of the incline angle).
//   relief    the peak-to-peak height budget of a zone, metres.
//   rNorm     distance from the arena centre divided by the ring radius in that
//             direction: 0 at the centre, 1 on the outline, > 1 outside the ring.
//   d, g      the Pareto split: d = 0.2 is the "vital few" fraction, g = 0.8 is the
//             share they hold. 80% of features are gentle, 20% are dramatic, and the
//             dramatic 20% carry ~80% of the total feature amplitude.
//   sign      +1 RAISES the ground (bump, plateau, cliff top); -1 DIGS it (dip, hole).
import { clamp, PARETO_80_20_ALPHA } from "../core/MathCore.ts";

/** Pareto "vital few" fraction d: the top 20% of a population. */
export const PARETO_TOP_FRACTION = 0.2;
/**
 * Share g held by the vital few. The 80/20 rule is the complementary case g = 1 - d;
 * for a Pareto law the top fraction d holds d^(1 - 1/alpha), and with
 * alpha = PARETO_80_20_ALPHA that is exactly 0.8.
 */
export const PARETO_TOP_SHARE = 1 - PARETO_TOP_FRACTION;

/**
 * Peak slope of the smoothstep falloff used by every stamped feature, per unit of
 * amplitude over unit radius: d/dt [t^2 (3 - 2t)] = 6 t (1 - t), maximal at t = 1/2,
 * where it equals 1.5. A feature of amplitude A and radius r is therefore at most
 * 1.5 A / r steep.
 */
export const PROFILE_PEAK_SLOPE = 1.5;

/** The named base parameters every derived rule comes from. Units in each doc line. */
export interface TerrainBase {
  /** Requested spacing between adjacent height samples, metres (may be widened by `maxGridAxis`). */
  cellSize: number;
  /** Ring radius at its widest point, metres. */
  arenaRadius: number;
  /** Steepest incline a fighter can walk up, degrees. */
  maxSlopeDeg: number;
  /** Tallest ledge a fighter steps onto without jumping, metres. */
  stepHeight: number;
  /** fBm persistence in (0, 1): each octave's gain relative to the previous one. */
  persistence: number;
  /** How far the field extends beyond the ring, as a fraction of `arenaRadius`. */
  outsideMarginFraction: number;
  /** Most nodes along one axis: bounds the cost of relaxation, A* and the minimap. */
  maxGridAxis: number;
}

/** Range and meaning of one base parameter, for UI sliders and the docs. */
export interface BaseParamSpec {
  min: number;
  max: number;
  def: number;
  unit: string;
  note: string;
}

/** The base parameters as data: default, range, unit and reason. */
export const TERRAIN_BASE_SPECS: Record<keyof TerrainBase, BaseParamSpec> = {
  cellSize: { min: 0.1, max: 4, def: 0.5, unit: "m", note: "one fighter radius: a body never straddles more than 2 cells" },
  arenaRadius: { min: 1, max: 160, def: 6, unit: "m", note: "half the ArenaConfig `size` (12 m default)" },
  maxSlopeDeg: { min: 5, max: 60, def: 30, unit: "deg", note: "a brisk walk-up incline; steeper ground is a wall for pathing" },
  stepHeight: { min: 0.05, max: 1.5, def: 0.35, unit: "m", note: "roughly knee height for the 0.5 m-radius fighter body" },
  persistence: { min: 0.1, max: 0.9, def: 0.5, unit: "0..1", note: "0.5 is classic fBm: each octave half as loud as the previous" },
  outsideMarginFraction: { min: 0, max: 2, def: 0.5, unit: "x radius", note: "room outside the ring for the skirt, the minimap and the freer ground" },
  maxGridAxis: { min: 16, max: 512, def: 128, unit: "nodes", note: "128^2 = 16k nodes keeps relaxation and A* well under a frame" },
};

/** Default base parameters (the `def` column of TERRAIN_BASE_SPECS). */
export const TERRAIN_BASE_DEFAULTS: TerrainBase = Object.fromEntries(
  Object.entries(TERRAIN_BASE_SPECS).map(([k, s]) => [k, s.def]),
) as unknown as TerrainBase;

/** Counts of deliberate (flagged) features. Every hole gets one ramp exit, so ramps >= holes. */
export interface DeliberateCounts {
  holes: number;
  cliffs: number;
  ramps: number;
}

/** Every derived rule. Each field's doc gives its equation in terms of the base parameters. */
export interface TerrainRules {
  base: TerrainBase;
  // ---- grid ---------------------------------------------------------------
  /** Half-width of the square domain, m: arenaRadius * (1 + outsideMarginFraction). */
  domainHalf: number;
  /** Node spacing actually used, m: max(cellSize, 2 domainHalf / (maxGridAxis - 1)). */
  cell: number;
  /** Nodes per axis: ceil(2 domainHalf / cell) + 1. */
  gridAxis: number;
  // ---- slope --------------------------------------------------------------
  /** tan(maxSlopeDeg). */
  maxSlopeTan: number;
  /** Largest height difference between two AXIS neighbours, m: cell * tan(maxSlope). */
  maxNeighbourDelta: number;
  /** Largest height difference between two DIAGONAL neighbours, m: cell * sqrt2 * tan(maxSlope). */
  maxDiagonalDelta: number;
  /** Steepest floor a BODY may walk into (TerrainGround.settleOnFloor), tan: tan(maxSlope) / g -> 25% head-room over the grid rule for the triangulated mesh; only holes, cliffs and ramp side walls exceed it. */
  maxClimbTan: number;
  // ---- zones (in rNorm) ---------------------------------------------------
  /** Fight-zone radius, rNorm: sqrt(d) -> the central d = 20% of the ring's AREA is the fair zone. */
  fightZoneFraction: number;
  /** Width of the blend from ring relief to outside relief, rNorm: outsideMarginFraction * g. */
  outsideBlendWidth: number;
  // ---- relief (peak-to-peak, m) ---------------------------------------------
  /** Fight-zone relief, m: stepHeight -> two fighters in the centre are never more than one step apart (before slope relaxation). */
  fightRelief: number;
  /** Outside relief, m: max(fightRelief, margin * tan(maxSlope) * g) with margin = arenaRadius * outsideMarginFraction. */
  outsideRelief: number;
  /** Ring-band relief, m: sqrt(fightRelief * outsideRelief), the geometric mean (half-way on a log scale). */
  ringRelief: number;
  // ---- normalisation -------------------------------------------------------
  /** Target p80 - p20 of the normalised base heights: 1 - g = 0.2. The middle 60% of nodes live in 20% of the relief; the dug 20% and raised 20% tails share the other 80%. */
  targetBand: number;
  // ---- fBm ------------------------------------------------------------------
  /** Wavelength of the first octave, m: arenaRadius (the largest hill is as wide as the ring is deep). */
  baseWavelength: number;
  /** Octave count: floor(log2(baseWavelength / (2 cell))) + 1, stopping at the grid's Nyquist limit (2 cells). */
  octaves: number;
  /** Octave gains: persistence^k / sum_j persistence^j, so they sum to 1. */
  octaveGains: number[];
  // ---- Pareto features --------------------------------------------------------
  /** Smallest feature radius, m: 2 cell (the smallest shape the grid can represent). */
  featureMinRadius: number;
  /** Largest feature radius, m: arenaRadius. */
  featureMaxRadius: number;
  /** Feature count: max(ceil(2 / d), round(domainArea * d / (pi featureMinRadius^2))). */
  featureCount: number;
  /** Share of the slope budget a feature may use: g. The other d is head-room for the base noise. */
  featureSlopeUse: number;
  /** Largest/smallest relative amplitude: smallest power of two whose capped Pareto can still reach g + d(1 - g). */
  featureCapRatio: number;
  /** Pareto shape re-solved under the cap so the expected top-d share is g (PARETO_80_20_ALPHA if uncapped). */
  featureAlpha: number;
  /** Expected top-d share at featureAlpha (should equal g). */
  featureExpectedShare: number;
  // ---- deliberate (flagged) features ---------------------------------------------
  /** Hole depth, m: max(stepHeight, maxNeighbourDelta) / d -> neither one step nor one cell of walkable rise covers more than 20% of the climb out (on coarse grids a cell can rise more than a step). */
  holeDepth: number;
  /** Cliff height, m: the same dramatic rise, max(stepHeight, maxNeighbourDelta) / d. */
  cliffHeight: number;
  /** Hole radius range, m: [featureMinRadius, max(featureMinRadius, arenaRadius * d)]. */
  holeRadiusMin: number;
  holeRadiusMax: number;
  /** Ramp slope: tan(maxSlope) * g -> walkable with 20% head-room. */
  rampSlopeTan: number;
  /** Ramp half-width, m: cell (1 + sqrt2). A node is walkable only if its whole 8-neighbourhood is on the ramp (|l| <= w - cell sqrt2); w - cell sqrt2 >= cell keeps that corridor >= 2 nodes wide at ANY heading, so diagonal moves never need to cut a corner. */
  rampHalfWidth: number;
  /** Horizontal half-width of a cliff's raised (and dug) side, m: 1.5 (cliffHeight / 2) / (tan(maxSlope) g) -> each side's falloff is walkable. */
  cliffSlopeWidth: number;
  /** Horizontal run of a hole's exit ramp, m: holeDepth / rampSlopeTan. */
  holeExitRun: number;
  /** Area of the placement band between the fight zone and the outskirts, m^2: pi R^2 ((1 + outsideMarginFraction g)^2 - fightZoneFraction^2). */
  deliberateBandArea: number;
  /** Default deliberate counts: holes = cliffs = max(1, floor(d * bandArea / (pi (cliffFootprint^2 + holeFootprint^2)))) -> the dramatic stamps cover at most d = 20% of the band; cliffFootprint = hypot(1.5 W, W) (mean half-length 1.5 W), holeFootprint = mean hole radius + holeExitRun. ramps = holes + cliffs (one exit per hole, one ascent per cliff). */
  deliberate: DeliberateCounts;
  // ---- relaxation -------------------------------------------------------------
  /** Chamfer sweep-pair cap: gridAxis. One pair suffices without flagged nodes; each extra pair lets a constraint turn one more corner around a flagged obstacle. */
  relaxMaxIterations: number;
  /** Relaxation target as a fraction of the limit: 1 - slack, slack = 1e-3, so float32 storage never re-crosses it. */
  relaxSlack: number;
  // ---- path finding ---------------------------------------------------------
  /** Uphill cost coefficient: 1 / tan(maxSlope) -> walking at the limit costs double. */
  slopePenalty: number;
  /** Downhill share of that penalty: d / g = 0.25 (braking costs, but less than climbing). The sign of dh picks the coefficient. */
  downhillFactor: number;
}

/** One derived value with its equation, for docs and debug overlays. */
export interface RuleEquation {
  key: string;
  value: number;
  unit: string;
  equation: string;
}

/** Mean of min(cap, u^(-1/alpha)) for u uniform on [a, b] (a Pareto with xm = 1, capped). */
export function cappedParetoStratumMean(a: number, b: number, alpha: number, cap: number): number {
  const beta = 1 / alpha;
  const uCap = Math.pow(cap, -alpha); // below uCap the draw is clipped to `cap`
  let integral = 0;
  if (a < uCap) integral += cap * (Math.min(b, uCap) - a);
  const lo = Math.max(a, uCap);
  if (b > lo) {
    integral += Math.abs(beta - 1) < 1e-9
      ? Math.log(b / lo)
      : (Math.pow(b, 1 - beta) - Math.pow(lo, 1 - beta)) / (1 - beta);
  }
  return integral / Math.max(1e-12, b - a);
}

/**
 * Expected share held by the top `topFraction` of an n-point STRATIFIED sample of a
 * capped Pareto(1, alpha): stratum i covers u in [i/n, (i+1)/n] and contributes its mean.
 */
export function expectedCappedTopShare(alpha: number, capRatio: number, n: number, topFraction = PARETO_TOP_FRACTION): number {
  const k = Math.max(1, Math.round(n * topFraction));
  let top = 0, all = 0;
  for (let i = 0; i < n; i++) {
    const m = cappedParetoStratumMean(i / n, (i + 1) / n, alpha, capRatio);
    all += m;
    if (i < k) top += m; // small u -> large draw, so the first k strata are the top
  }
  return all > 0 ? top / all : 0;
}

/** Result of solving the Pareto shape under a cap. */
export interface AlphaSolution {
  alpha: number;
  share: number;
  /** Largest share any alpha can reach under this cap, and where. */
  peakShare: number;
  peakAlpha: number;
  /** False when even the peak falls short of the target (alpha = peakAlpha then). */
  reachable: boolean;
}

/**
 * Find the Pareto shape alpha whose capped, stratified sample gives the top `topFraction`
 * exactly `targetShare`. The share is 1-peaked in alpha (alpha -> 0 clips everything to
 * the cap, alpha -> inf collapses everything to xm, both give a flat share = topFraction),
 * so we scan for the peak then bisect the light-tailed side, which contains
 * PARETO_80_20_ALPHA as cap -> infinity.
 */
export function solveParetoAlpha(targetShare: number, capRatio: number, n: number, topFraction = PARETO_TOP_FRACTION): AlphaSolution {
  const hiAlpha = 4 * PARETO_80_20_ALPHA; // far beyond the 80/20 shape: share there is near-flat
  let peakAlpha = hiAlpha, peakShare = -1;
  const scanSteps = 200;
  for (let s = 1; s <= scanSteps; s++) {
    const a = (hiAlpha * s) / scanSteps;
    const sh = expectedCappedTopShare(a, capRatio, n, topFraction);
    if (sh > peakShare) { peakShare = sh; peakAlpha = a; }
  }
  if (peakShare < targetShare) return { alpha: peakAlpha, share: peakShare, peakShare, peakAlpha, reachable: false };
  let lo = peakAlpha, hi = hiAlpha;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (expectedCappedTopShare(mid, capRatio, n, topFraction) > targetShare) lo = mid; else hi = mid;
  }
  const alpha = (lo + hi) / 2;
  return { alpha, share: expectedCappedTopShare(alpha, capRatio, n, topFraction), peakShare, peakAlpha, reachable: true };
}

/**
 * Smallest power-of-two cap ratio (largest / smallest draw) whose capped Pareto can
 * still reach `targetShare + topFraction * (1 - targetShare)` (head-room so the solved
 * alpha is not balanced on the peak). Without a cap no finite ratio exists, which is
 * the point: the 80/20 law needs a wide dynamic range.
 */
export function solveCapRatio(targetShare: number, n: number, topFraction = PARETO_TOP_FRACTION): number {
  const wanted = targetShare + topFraction * (1 - targetShare);
  // The perfect split (top at the cap, rest at xm) needs c >= share/(1-share) * (1-top)/top.
  let c = Math.pow(2, Math.ceil(Math.log2((targetShare / (1 - targetShare)) * ((1 - topFraction) / topFraction))));
  for (let guard = 0; guard < 16; guard++, c *= 2) {
    if (solveParetoAlpha(wanted, c, n, topFraction).reachable) return c;
  }
  return c;
}

/**
 * Stratified, shuffled Pareto sample. The unit interval of probabilities is cut into n
 * equal strata; draw i is the EXPECTED capped Pareto value of stratum i (its exact mean,
 * so the heavy tail's mass is kept even though no single uniform draw reaches it),
 * multiplied by a jitter in [1 - jitter/2, 1 + jitter/2]. A small sample therefore still
 * has the population's top share (+- the jitter) instead of the wild swings of i.i.d.
 * draws from an infinite-variance law. Values are clamped to [xm, xm * capRatio].
 * Default jitter d = 0.2 (+-10%).
 */
export function stratifiedParetoSample(rng: () => number, n: number, xm: number, alpha: number, capRatio: number, jitter = PARETO_TOP_FRACTION): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const mean = cappedParetoStratumMean(i / n, (i + 1) / n, alpha, capRatio);
    out[i] = xm * clamp(mean * (1 + (rng() - 0.5) * jitter), 1, capRatio);
  }
  for (let i = n - 1; i > 0; i--) { // Fisher-Yates: strata order must not leak into placement
    const j = Math.floor(rng() * (i + 1));
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

/** Clamp every base parameter into its declared range; unknown/NaN fall back to the default. */
export function clampTerrainBase(over: Partial<TerrainBase> = {}): TerrainBase {
  const base = { ...TERRAIN_BASE_DEFAULTS };
  for (const key of Object.keys(TERRAIN_BASE_SPECS) as (keyof TerrainBase)[]) {
    const v = over[key];
    if (v === undefined || !Number.isFinite(v)) continue;
    const s = TERRAIN_BASE_SPECS[key];
    base[key] = clamp(v, s.min, s.max);
  }
  return base;
}

/**
 * Derive every rule from the base parameters (top-down, R08). Pure and cheap
 * (~0.1 ms): call it once per arena.
 */
export function deriveTerrainRules(over: Partial<TerrainBase> = {}): TerrainRules {
  const base = clampTerrainBase(over);
  const d = PARETO_TOP_FRACTION, g = PARETO_TOP_SHARE;
  const domainHalf = base.arenaRadius * (1 + base.outsideMarginFraction);
  const cell = Math.max(base.cellSize, (2 * domainHalf) / (base.maxGridAxis - 1));
  const gridAxis = Math.ceil((2 * domainHalf) / cell) + 1;
  const maxSlopeTan = Math.tan((base.maxSlopeDeg * Math.PI) / 180);
  const margin = base.arenaRadius * base.outsideMarginFraction;
  const fightRelief = base.stepHeight;
  const outsideRelief = Math.max(fightRelief, margin * maxSlopeTan * g);
  const ringRelief = Math.sqrt(fightRelief * outsideRelief);
  const baseWavelength = base.arenaRadius;
  const octaves = Math.max(1, Math.floor(Math.log2(baseWavelength / (2 * cell))) + 1);
  const raw = Array.from({ length: octaves }, (_, k) => Math.pow(base.persistence, k));
  const rawSum = raw.reduce((a, b) => a + b, 0);
  const featureMinRadius = 2 * cell;
  const domainArea = (2 * domainHalf) ** 2;
  const featureCount = Math.max(Math.ceil(2 / d), Math.round((domainArea * d) / (Math.PI * featureMinRadius ** 2)));
  const featureCapRatio = solveCapRatio(g, featureCount, d);
  const solved = solveParetoAlpha(g, featureCapRatio, featureCount, d);
  const dramaticRise = Math.max(base.stepHeight, cell * maxSlopeTan) / d;
  const rampSlopeTan = maxSlopeTan * g;
  const cliffSlopeWidth = (PROFILE_PEAK_SLOPE * dramaticRise / 2) / (maxSlopeTan * g);
  const holeRadiusMax = Math.max(featureMinRadius, base.arenaRadius * d);
  const holeExitRun = dramaticRise / rampSlopeTan;
  const bandOuter = 1 + base.outsideMarginFraction * g;
  const deliberateBandArea = Math.PI * base.arenaRadius ** 2 * (bandOuter ** 2 - d);
  const cliffFootprint = Math.hypot(1.5 * cliffSlopeWidth, cliffSlopeWidth);
  const holeFootprint = (featureMinRadius + holeRadiusMax) / 2 + holeExitRun;
  const each = Math.max(1, Math.floor((d * deliberateBandArea) / (Math.PI * (cliffFootprint ** 2 + holeFootprint ** 2))));
  return {
    base,
    domainHalf, cell, gridAxis,
    maxSlopeTan,
    maxNeighbourDelta: cell * maxSlopeTan,
    maxDiagonalDelta: cell * Math.SQRT2 * maxSlopeTan,
    maxClimbTan: maxSlopeTan / g,
    fightZoneFraction: Math.sqrt(d),
    outsideBlendWidth: Math.max(1e-3, base.outsideMarginFraction * g),
    fightRelief, outsideRelief, ringRelief,
    targetBand: 1 - g,
    baseWavelength, octaves,
    octaveGains: raw.map((v) => v / rawSum),
    featureMinRadius,
    featureMaxRadius: Math.max(featureMinRadius, base.arenaRadius),
    featureCount,
    featureSlopeUse: g,
    featureCapRatio,
    featureAlpha: solved.alpha,
    featureExpectedShare: solved.share,
    holeDepth: dramaticRise,
    cliffHeight: dramaticRise,
    holeRadiusMin: featureMinRadius,
    holeRadiusMax,
    rampSlopeTan,
    rampHalfWidth: cell * (1 + Math.SQRT2),
    cliffSlopeWidth, holeExitRun, deliberateBandArea,
    deliberate: { holes: each, cliffs: each, ramps: 2 * each },
    relaxMaxIterations: gridAxis,
    relaxSlack: 1e-3,
    slopePenalty: 1 / maxSlopeTan,
    downhillFactor: d / g,
  };
}

/** Every derived rule with its value, unit and equation (R08 transparency). */
export function describeTerrainRules(r: TerrainRules): RuleEquation[] {
  const e = (key: string, value: number, unit: string, equation: string): RuleEquation => ({ key, value, unit, equation });
  return [
    e("domainHalf", r.domainHalf, "m", "arenaRadius * (1 + outsideMarginFraction)"),
    e("cell", r.cell, "m", "max(cellSize, 2 domainHalf / (maxGridAxis - 1))"),
    e("gridAxis", r.gridAxis, "nodes", "ceil(2 domainHalf / cell) + 1"),
    e("maxSlopeTan", r.maxSlopeTan, "", "tan(maxSlopeDeg)"),
    e("maxNeighbourDelta", r.maxNeighbourDelta, "m", "cell * tan(maxSlope)"),
    e("maxDiagonalDelta", r.maxDiagonalDelta, "m", "cell * sqrt2 * tan(maxSlope)"),
    e("maxClimbTan", r.maxClimbTan, "", "tan(maxSlope) / g: body climb limit on the mesh"),
    e("fightZoneFraction", r.fightZoneFraction, "rNorm", "sqrt(d): central 20% of the ring area"),
    e("outsideBlendWidth", r.outsideBlendWidth, "rNorm", "outsideMarginFraction * g"),
    e("fightRelief", r.fightRelief, "m", "stepHeight"),
    e("outsideRelief", r.outsideRelief, "m", "max(fightRelief, arenaRadius * outsideMarginFraction * tan(maxSlope) * g)"),
    e("ringRelief", r.ringRelief, "m", "sqrt(fightRelief * outsideRelief)"),
    e("targetBand", r.targetBand, "0..1", "1 - g: target p80 - p20 of normalised base heights"),
    e("baseWavelength", r.baseWavelength, "m", "arenaRadius"),
    e("octaves", r.octaves, "", "floor(log2(baseWavelength / (2 cell))) + 1"),
    e("featureMinRadius", r.featureMinRadius, "m", "2 cell"),
    e("featureMaxRadius", r.featureMaxRadius, "m", "arenaRadius"),
    e("featureCount", r.featureCount, "", "max(ceil(2/d), round(domainArea * d / (pi featureMinRadius^2)))"),
    e("featureSlopeUse", r.featureSlopeUse, "", "g"),
    e("featureCapRatio", r.featureCapRatio, "x", "smallest 2^k whose capped Pareto reaches g + d(1-g)"),
    e("featureAlpha", r.featureAlpha, "", "solve E[topShare_d] = g under the cap (-> 1.161 uncapped)"),
    e("featureExpectedShare", r.featureExpectedShare, "", "E[topShare_d] at featureAlpha"),
    e("holeDepth", r.holeDepth, "m", "max(stepHeight, maxNeighbourDelta) / d"),
    e("cliffHeight", r.cliffHeight, "m", "max(stepHeight, maxNeighbourDelta) / d"),
    e("holeRadiusMax", r.holeRadiusMax, "m", "max(featureMinRadius, arenaRadius * d)"),
    e("rampSlopeTan", r.rampSlopeTan, "", "tan(maxSlope) * g"),
    e("rampHalfWidth", r.rampHalfWidth, "m", "cell (1 + sqrt2): walkable corridor >= 2 nodes at any heading"),
    e("cliffSlopeWidth", r.cliffSlopeWidth, "m", "1.5 (cliffHeight / 2) / (tan(maxSlope) g)"),
    e("holeExitRun", r.holeExitRun, "m", "holeDepth / rampSlopeTan"),
    e("deliberateBandArea", r.deliberateBandArea, "m^2", "pi R^2 ((1 + outsideMarginFraction g)^2 - fightZoneFraction^2)"),
    e("holes = cliffs", r.deliberate.holes, "", "max(1, floor(d bandArea / (pi (cliffFootprint^2 + holeFootprint^2))))"),
    e("ramps", r.deliberate.ramps, "", "holes + cliffs"),
    e("relaxMaxIterations", r.relaxMaxIterations, "sweep pairs", "gridAxis"),
    e("slopePenalty", r.slopePenalty, "", "1 / tan(maxSlope)"),
    e("downhillFactor", r.downhillFactor, "", "d / g"),
  ];
}
