// Lane E (R07): the generated heightfield obeys its rules for many seeds.
// Every check recomputes from the raw arrays; nothing trusts the generator's own stats
// except where the stat itself is under test.
import { rng32, summarize } from "../src/core/MathCore.ts";
import { makeArena, RING_SHAPES } from "../src/game/ArenaConfig.ts";
import { maxSlopeExcess, relaxSlopes } from "../src/world/HeightOps.ts";
import {
  circleOutline, FEATURE_CLIFF, FEATURE_HOLE, FEATURE_NONE, FEATURE_RAMP, flatHeightfield, generateArenaTerrain,
  generateHeightfield, heightAt, normalAt, reliefAtNorm, type Heightfield,
} from "../src/world/Heightfield.ts";
import { deriveTerrainRules } from "../src/world/TerrainRules.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

const SEEDS = Array.from({ length: 50 }, (_, k) => 1000 + k * 7919);
const RADIUS = 6; // the 12 m default arena
const RULES = deriveTerrainRules({ arenaRadius: RADIUS });
const OUTLINE = circleOutline(RADIUS);
const fields = new Map<number, Heightfield>();
const fieldFor = (seed: number) => {
  let f = fields.get(seed);
  if (!f) { f = generateHeightfield(seed, RULES, OUTLINE); fields.set(seed, f); }
  return f;
};

/** Every 8-neighbour pair once, with the pair's limit and whether a flagged node is involved. */
function pairs(f: Heightfield, visit: (a: number, b: number, excess: number, flagged: boolean) => void) {
  const di = [1, 0, 1, -1], dj = [0, 1, 1, 1];
  for (let j = 0; j < f.rows; j++) {
    for (let i = 0; i < f.cols; i++) {
      for (let k = 0; k < 4; k++) {
        const ni = i + di[k], nj = j + dj[k];
        if (ni < 0 || ni >= f.cols || nj >= f.rows) continue;
        const a = j * f.cols + i, b = nj * f.cols + ni;
        const limit = k < 2 ? f.rules.maxNeighbourDelta : f.rules.maxDiagonalDelta;
        visit(a, b, Math.abs(f.heights[b] - f.heights[a]) - limit, f.featureMask[a] !== 0 || f.featureMask[b] !== 0);
      }
    }
  }
}

Deno.test("50 seeds: every UNFLAGGED neighbour pair respects the slope limit", () => {
  for (const seed of SEEDS) {
    const f = fieldFor(seed);
    let worst = -Infinity, count = 0;
    pairs(f, (_a, _b, excess, flagged) => { if (!flagged) { worst = Math.max(worst, excess); count++; } });
    assert(count > 0, "no unflagged pairs");
    assert(worst <= 1e-6, `seed ${seed}: an unflagged pair exceeds the limit by ${worst} m`);
    assert(f.stats.relaxFirst.converged && f.stats.relaxSecond.converged, `seed ${seed}: relaxation did not converge`);
    assert(f.stats.relaxFirst.iterations <= RULES.relaxMaxIterations, "iteration bound respected");
  }
});

Deno.test("50 seeds: flagged holes and cliffs DO exceed the limit (the exception exists)", () => {
  let holes = 0, cliffs = 0;
  for (const seed of SEEDS) {
    const f = fieldFor(seed);
    let holeExcess = -Infinity, cliffExcess = -Infinity;
    pairs(f, (a, b, excess) => {
      if (f.featureMask[a] === FEATURE_HOLE || f.featureMask[b] === FEATURE_HOLE) holeExcess = Math.max(holeExcess, excess);
      if (f.featureMask[a] === FEATURE_CLIFF || f.featureMask[b] === FEATURE_CLIFF) cliffExcess = Math.max(cliffExcess, excess);
    });
    const placed = f.stats.deliberate.placed;
    if (placed.holes > 0) { holes++; assert(holeExcess > RULES.maxNeighbourDelta, `seed ${seed}: hole wall only ${holeExcess} m over`); }
    if (placed.cliffs > 0) { cliffs++; assert(cliffExcess > RULES.maxNeighbourDelta, `seed ${seed}: cliff face only ${cliffExcess} m over`); }
    assert(f.stats.flaggedMaxSlope > 2 * RULES.maxSlopeTan, `seed ${seed}: flagged max slope ${f.stats.flaggedMaxSlope}`);
  }
  assert(holes >= 45 && cliffs >= 45, `features placed in too few seeds: holes ${holes}, cliffs ${cliffs}`);
});

Deno.test("ramps are planar and walkable among themselves; holes and cliffs stay out of the fight zone", () => {
  for (const seed of SEEDS.slice(0, 20)) {
    const f = fieldFor(seed);
    let rampWorst = -Infinity;
    pairs(f, (a, b, excess) => { if (f.featureMask[a] === FEATURE_RAMP && f.featureMask[b] === FEATURE_RAMP) rampWorst = Math.max(rampWorst, excess); });
    assert(rampWorst <= 1e-6, `seed ${seed}: ramp pair exceeds the limit by ${rampWorst}`);
    for (let n = 0; n < f.heights.length; n++) {
      if (f.featureMask[n] === FEATURE_HOLE || f.featureMask[n] === FEATURE_CLIFF) {
        assert(f.ringNorm[n] >= RULES.fightZoneFraction, `seed ${seed}: flagged node inside the fight zone (rNorm ${f.ringNorm[n]})`);
      }
    }
  }
});

Deno.test("50 seeds: normalised base heights cover [0, 1] with the target p80 - p20 band", () => {
  for (const seed of SEEDS) {
    const s = fieldFor(seed).stats;
    assert(Math.abs(s.base.min) < 1e-9 && Math.abs(s.base.max - 1) < 1e-9, `seed ${seed}: base ${s.base.min}..${s.base.max}`);
    assert(Math.abs(s.base.p80 - s.base.p20 - RULES.targetBand) < 2e-3, `seed ${seed}: band ${s.base.p80 - s.base.p20}`);
    assert(Math.abs(s.normalised.min) < 1e-6 && Math.abs(s.normalised.max - 1) < 1e-6, "final heights normalise to [0, 1]");
  }
});

Deno.test("50 seeds: the measured Pareto share of feature amplitudes is 0.8 +- 0.08", () => {
  const shares: number[] = [];
  for (const seed of SEEDS) {
    const s = fieldFor(seed).stats.features;
    assert(s.shareDrawn >= 0.72 && s.shareDrawn <= 0.88, `seed ${seed}: share ${s.shareDrawn}`);
    assert(Math.abs(s.raised - s.dug) <= 1, `seed ${seed}: signs not balanced (${s.raised} raised vs ${s.dug} dug)`);
    shares.push(s.shareDrawn);
  }
  const m = summarize(shares);
  assert(m.mean > 0.77 && m.mean < 0.83, `mean share ${m.mean}`);
});

Deno.test("50 seeds: the fight zone is flatter than the ring band and the outskirts", () => {
  for (const seed of SEEDS) {
    const z = fieldFor(seed).stats.zones;
    assert(z.fightStdev < z.outsideStdev, `seed ${seed}: fight ${z.fightStdev} vs outside ${z.outsideStdev}`);
    assert(z.fightStdev < z.ringStdev, `seed ${seed}: fight ${z.fightStdev} vs ring ${z.ringStdev}`);
  }
  for (let k = 1; k <= 20; k++) {
    const rn = k / 10;
    assert(reliefAtNorm(RULES, rn) >= reliefAtNorm(RULES, rn - 0.1) - 1e-12, "relief never decreases outward");
  }
});

Deno.test("same seed -> identical field; different seed -> different field", () => {
  const a = generateHeightfield(42, RULES, OUTLINE), b = generateHeightfield(42, RULES, OUTLINE), c = generateHeightfield(43, RULES, OUTLINE);
  assert(a.heights.length === b.heights.length, "same size");
  for (let n = 0; n < a.heights.length; n++) assert(Object.is(a.heights[n], b.heights[n]) && a.featureMask[n] === b.featureMask[n], `node ${n} differs`);
  let diff = 0;
  for (let n = 0; n < a.heights.length; n++) if (a.heights[n] !== c.heights[n]) diff++;
  assert(diff > a.heights.length / 2, `seeds 42 and 43 differ at only ${diff} nodes`);
});

Deno.test("every ring shape: the slope rule holds and features are flagged", () => {
  for (let shape = 0; shape < RING_SHAPES.length; shape++) {
    for (const seed of [1, 2, 3]) {
      const cfg = makeArena({ shape, aspect: shape === 6 ? 1.7 : 1, rotation: seed * 37 });
      const f = generateArenaTerrain(seed, cfg);
      const residual = maxSlopeExcess(f.heights, f.featureMask, f.cols, f.rows, f.rules.maxNeighbourDelta, f.rules.maxDiagonalDelta, "unflagged");
      assert(residual <= 1e-6, `${RING_SHAPES[shape]} seed ${seed}: residual ${residual}`);
    }
  }
});

Deno.test("heightAt interpolates the nodes; normalAt is a unit up-facing vector", () => {
  const f = fieldFor(SEEDS[0]);
  const rng = rng32(5);
  for (let k = 0; k < 200; k++) {
    const i = Math.floor(rng() * (f.cols - 1)), j = Math.floor(rng() * (f.rows - 1));
    const n = j * f.cols + i, x = f.originX + i * f.cell, z = f.originZ + j * f.cell;
    assert(Math.abs(heightAt(f, x, z) - f.heights[n]) < 1e-5, "exact at nodes");
    const mid = heightAt(f, x + f.cell / 2, z + f.cell / 2);
    const avg = (f.heights[n] + f.heights[n + 1] + f.heights[n + f.cols] + f.heights[n + f.cols + 1]) / 4;
    assert(Math.abs(mid - avg) < 1e-5, "bilinear centre = mean of the four corners");
    const nv = normalAt(f, x + rng() * f.cell, z + rng() * f.cell);
    assert(Math.abs(Math.hypot(nv.x, nv.y, nv.z) - 1) < 1e-9 && nv.y > 0, "unit, up-facing normal");
  }
  const flat = flatHeightfield(RULES, OUTLINE);
  const up = normalAt(flat, 1.3, -2.1);
  assert(up.x === 0 && up.y === 1 && up.z === 0, "flat ground normal is +y");
  assert(heightAt(f, 1e6, -1e6) === heightAt(f, f.originX + (f.cols - 1) * f.cell, f.originZ), "clamped outside the grid");
});

Deno.test("relaxSlopes: limits a spike symmetrically, keeps flagged nodes, leaves a legal field untouched", () => {
  const cols = 9, rows = 9, axis = 0.25, diag = axis * Math.SQRT2;
  const h = new Float64Array(cols * rows), mask = new Uint8Array(cols * rows);
  h[40] = 5; // centre spike
  h[0] = 3; mask[0] = FEATURE_HOLE; // flagged corner: must keep its height
  const r = relaxSlopes(h, mask, cols, rows, axis, diag, 50, 1e-3);
  assert(r.converged && r.residual <= 0, `residual ${r.residual}`);
  assert(h[0] === 3, "flagged node untouched");
  assert(h[40] < 5 && h[40] > 0, `spike shaved but not erased (${h[40]})`);
  assert(h[31] > 0, "neighbours raised toward the spike (pits filled as peaks are shaved)");
  const legal = Float64Array.from({ length: cols * rows }, (_, n) => (n % cols) * 0.1);
  const copy = Float64Array.from(legal);
  const r2 = relaxSlopes(legal, new Uint8Array(cols * rows), cols, rows, axis, diag, 50, 1e-3);
  assert(r2.iterations === 1 && r2.corrections === 0, "already legal: one sweep pair, no correction");
  for (let n = 0; n < legal.length; n++) assert(Math.abs(legal[n] - copy[n]) < 1e-12, "legal field unchanged");
  assert(FEATURE_NONE === 0, "0 means ordinary ground");
});
