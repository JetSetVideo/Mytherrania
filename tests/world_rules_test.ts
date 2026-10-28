// Lane E (R07/R08): the terrain rules are DERIVED from a few base parameters, and the
// Pareto machinery really produces an 80/20 split.
import { PARETO_80_20_ALPHA, rng32, topShare } from "../src/core/MathCore.ts";
import {
  clampTerrainBase, deriveTerrainRules, describeTerrainRules, expectedCappedTopShare, PARETO_TOP_FRACTION,
  PARETO_TOP_SHARE, solveCapRatio, solveParetoAlpha, stratifiedParetoSample, TERRAIN_BASE_DEFAULTS, TERRAIN_BASE_SPECS,
} from "../src/world/TerrainRules.ts";
import { remapToTargetBand } from "../src/world/HeightOps.ts";
import { summarize } from "../src/core/MathCore.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

Deno.test("the 80/20 constants agree: the top 20% of a Pareto(alpha_80/20) holds 80%", () => {
  const share = Math.pow(PARETO_TOP_FRACTION, 1 - 1 / PARETO_80_20_ALPHA);
  assert(near(share, PARETO_TOP_SHARE, 1e-12), `d^(1-1/alpha) = ${share}, want ${PARETO_TOP_SHARE}`);
  // Uncapped (huge cap) stratified expectation reproduces the population share.
  const s = expectedCappedTopShare(PARETO_80_20_ALPHA, 1e15, 1000);
  assert(near(s, 0.8, 0.01), `uncapped stratified share ${s}`);
});

Deno.test("every derived rule follows its equation from the base parameters", () => {
  for (const radius of [1, 6, 20, 60, 160]) {
    for (const slopeDeg of [15, 30, 45]) {
      const r = deriveTerrainRules({ arenaRadius: radius, maxSlopeDeg: slopeDeg });
      const tan = Math.tan((slopeDeg * Math.PI) / 180);
      assert(near(r.maxSlopeTan, tan, 1e-12), "maxSlopeTan = tan(maxSlope)");
      assert(near(r.maxNeighbourDelta, r.cell * tan, 1e-12), "maxNeighbourDelta = cell tan");
      assert(near(r.maxDiagonalDelta, r.cell * Math.SQRT2 * tan, 1e-12), "diagonal = cell sqrt2 tan");
      assert(near(r.maxClimbTan, tan / PARETO_TOP_SHARE, 1e-12) && r.maxClimbTan > tan, "body climb limit = tan / g");
      assert(r.cell >= r.base.cellSize - 1e-12, "cell never finer than requested");
      assert(r.gridAxis <= r.base.maxGridAxis + 1, `grid ${r.gridAxis} within cap ${r.base.maxGridAxis}`);
      assert((r.gridAxis - 1) * r.cell >= 2 * r.domainHalf - 1e-9, "grid covers the domain");
      assert(near(r.fightZoneFraction ** 2, PARETO_TOP_FRACTION, 1e-12), "fight zone = central 20% of area");
      assert(near(r.fightRelief, r.base.stepHeight, 1e-12), "fight relief = one step");
      assert(near(r.ringRelief, Math.sqrt(r.fightRelief * r.outsideRelief), 1e-12), "ring relief = geometric mean");
      assert(r.fightRelief <= r.ringRelief && r.ringRelief <= r.outsideRelief, "relief grows outward");
      assert(near(r.targetBand, 1 - PARETO_TOP_SHARE, 1e-12), "target band = 1 - g");
      assert(near(r.octaveGains.reduce((a, b) => a + b, 0), 1, 1e-12), "octave gains sum to 1");
      for (let k = 1; k < r.octaveGains.length; k++) assert(near(r.octaveGains[k] / r.octaveGains[k - 1], r.base.persistence, 1e-12), "gain ratio = persistence");
      assert(r.baseWavelength / 2 ** (r.octaves - 1) >= 2 * r.cell - 1e-9, "finest octave above the Nyquist limit");
      assert(near(r.holeDepth, Math.max(r.base.stepHeight, r.maxNeighbourDelta) / PARETO_TOP_FRACTION, 1e-12), "hole depth = max(step, cell rise) / d");
      assert(r.holeDepth > r.base.stepHeight && r.cliffHeight > r.maxNeighbourDelta, "a hole/cliff cannot be stepped");
      assert(near(r.rampSlopeTan, tan * PARETO_TOP_SHARE, 1e-12) && r.rampSlopeTan < tan, "ramps are walkable");
      assert(r.deliberate.ramps === r.deliberate.holes + r.deliberate.cliffs, "one ramp per hole and per cliff");
      assert(near(r.slopePenalty * tan, 1, 1e-12), "climbing at the limit costs double");
      assert(r.featureCount >= Math.ceil(2 / PARETO_TOP_FRACTION), "enough features for a top 20%");
      assert(r.featureMinRadius < r.featureMaxRadius || radius <= 1, "radius range ordered");
    }
  }
});

Deno.test("signs: a steeper limit allows larger neighbour deltas, a taller step a taller fight relief", () => {
  const a = deriveTerrainRules({ maxSlopeDeg: 20 }), b = deriveTerrainRules({ maxSlopeDeg: 40 });
  assert(b.maxNeighbourDelta > a.maxNeighbourDelta, "delta grows with slope");
  assert(b.slopePenalty < a.slopePenalty, "penalty coefficient is inverse to the limit");
  const s = deriveTerrainRules({ stepHeight: 0.2 }), t = deriveTerrainRules({ stepHeight: 0.5 });
  assert(t.fightRelief > s.fightRelief && t.holeDepth > s.holeDepth, "step height drives relief and depth");
});

Deno.test("the Pareto shape is re-solved under the cap so the expected top share is exactly g", () => {
  for (const n of [10, 21, 50, 257]) {
    const cap = solveCapRatio(PARETO_TOP_SHARE, n);
    const sol = solveParetoAlpha(PARETO_TOP_SHARE, cap, n);
    assert(sol.reachable, `cap ${cap} reaches 0.8 for n=${n}`);
    assert(near(sol.share, PARETO_TOP_SHARE, 1e-6), `solved share ${sol.share}`);
    assert(sol.alpha < PARETO_80_20_ALPHA, `the cap steals tail mass, so alpha (${sol.alpha}) drops below 1.161`);
    const half = solveParetoAlpha(PARETO_TOP_SHARE + PARETO_TOP_FRACTION * (1 - PARETO_TOP_SHARE), cap / 2, n);
    assert(!half.reachable, `cap ${cap} is the SMALLEST power of two with head-room`);
  }
});

Deno.test("stratified Pareto samples hold ~80% in their top 20% for every seed and size", () => {
  const shares: number[] = [];
  for (const n of [10, 21, 50, 200]) {
    const cap = solveCapRatio(PARETO_TOP_SHARE, n);
    const alpha = solveParetoAlpha(PARETO_TOP_SHARE, cap, n).alpha;
    for (let seed = 1; seed <= 50; seed++) {
      const xm = 0.01;
      const v = stratifiedParetoSample(rng32(seed), n, xm, alpha, cap);
      for (const x of v) assert(x >= xm - 1e-15 && x <= xm * cap + 1e-12, `draw ${x} outside [xm, xm cap]`);
      const s = topShare(v, PARETO_TOP_FRACTION);
      assert(s >= 0.75 && s <= 0.85, `n=${n} seed=${seed}: share ${s} outside [0.75, 0.85]`);
      shares.push(s);
    }
  }
  const m = summarize(shares);
  assert(m.mean >= 0.78 && m.mean <= 0.82, `mean share ${m.mean}`);
});

Deno.test("base parameters are clamped to their declared ranges; NaN falls back to the default", () => {
  const b = clampTerrainBase({ cellSize: -3, maxSlopeDeg: 999, stepHeight: NaN });
  assert(b.cellSize === TERRAIN_BASE_SPECS.cellSize.min, "cellSize clamped up");
  assert(b.maxSlopeDeg === TERRAIN_BASE_SPECS.maxSlopeDeg.max, "slope clamped down");
  assert(b.stepHeight === TERRAIN_BASE_DEFAULTS.stepHeight, "NaN -> default");
});

Deno.test("describeTerrainRules lists every derived value with a finite value and an equation", () => {
  const list = describeTerrainRules(deriveTerrainRules());
  assert(list.length >= 25, `only ${list.length} equations`);
  for (const e of list) assert(Number.isFinite(e.value) && e.equation.length > 0, `bad entry ${e.key}`);
});

Deno.test("remapToTargetBand pins min, max and the p20/p80 band", () => {
  const rng = rng32(9);
  const v = Float64Array.from({ length: 5000 }, () => Math.pow(rng(), 2));
  let lo = Infinity, hi = -Infinity;
  for (const x of v) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  for (let k = 0; k < v.length; k++) v[k] = (v[k] - lo) / (hi - lo);
  const before = summarize(v);
  remapToTargetBand(v, before.p20, before.p80, 0.2);
  const after = summarize(v);
  assert(near(after.min, 0, 1e-12) && near(after.max, 1, 1e-12), `range ${after.min}..${after.max}`);
  assert(near(after.p80 - after.p20, 0.2, 1e-3), `band ${after.p80 - after.p20}`);
  assert(near(after.p20, 0.4, 1e-3) && near(after.p80, 0.6, 1e-3), "band centred on 0.5 (dug and raised tails mirror)");
});
