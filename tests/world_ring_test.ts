// Lane E2 (R07/R08): the ring band carries real relief and a visible flagged feature,
// while the fair centre and the spawn pads stay untouched and every slope rule holds.
// Every check recomputes from the raw arrays where it can.
import { summarize, topShare } from "../src/core/MathCore.ts";
import { makeArena, RING_SHAPES } from "../src/game/ArenaConfig.ts";
import { maxSlopeExcess } from "../src/world/HeightOps.ts";
import {
  circleOutline, FEATURE_CLIFF, FEATURE_HOLE, generateArenaTerrain, generateHeightfield, heightAt, outlineFromArena, type Heightfield,
} from "../src/world/Heightfield.ts";
import { duelSpawnPoints, fairDistance, minVisibleNodes } from "../src/world/RingRelief.ts";
import { deriveTerrainRules, PARETO_TOP_FRACTION, PARETO_TOP_SHARE, PROFILE_PEAK_SLOPE, TERRAIN_BASE_DEFAULTS } from "../src/world/TerrainRules.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;
const SEEDS = Array.from({ length: 50 }, (_, k) => 1000 + k * 7919);
/** The default live sizes (Engine clamps unchosen sizes to >= 8 m; 12 m is the ArenaConfig default). */
const LIVE_SIZES = [12, 16];

/** In-ring node heights (ringNorm < 1). */
function ringHeights(f: Heightfield): number[] {
  const out: number[] = [];
  for (let n = 0; n < f.heights.length; n++) if (f.ringNorm[n] < 1) out.push(f.heights[n]);
  return out;
}

Deno.test("ring rules: fair radius from reach and body, feature rise from the ring, each by its equation", () => {
  for (const radius of [2, 6, 8, 20, 60]) {
    const r = deriveTerrainRules({ arenaRadius: radius });
    const d = PARETO_TOP_FRACTION, g = PARETO_TOP_SHARE, b = r.base;
    assert(near(r.fairRadius, Math.min(b.fighterReach / 2 + b.bodyRadius, radius * Math.sqrt(d)), 1e-12), "fairRadius = min(reach/2 + body, R sqrt(d))");
    assert(r.fairRadius <= radius * r.fightZoneFraction + 1e-12, "the fair centre never exceeds the fight zone");
    assert(near(r.fairPadRadius, b.bodyRadius + r.cell, 1e-12), "pad = body + one cell");
    assert(near(r.fairBlend, (PROFILE_PEAK_SLOPE * b.stepHeight) / (r.maxSlopeTan * g), 1e-12), "fairBlend = 1.5 step / (tan g)");
    assert(near(r.rollSlope, r.maxSlopeTan / 2, 1e-12), "rollSlope = tan / 2");
    assert(near(r.ringFeatureBand, radius * (1 - Math.sqrt(d)), 1e-12), "ringFeatureBand = R (1 - sqrt d)");
    const rise = Math.min(r.holeDepth, Math.max((g * g * r.ringFeatureBand * r.maxSlopeTan) / PROFILE_PEAK_SLOPE, Math.max(b.stepHeight, r.maxNeighbourDelta) / g));
    assert(near(r.ringFeatureRise, rise, 1e-12), `ringFeatureRise ${r.ringFeatureRise} vs ${rise}`);
    assert(r.ringFeatureRise > b.stepHeight && r.ringFeatureRise > r.maxNeighbourDelta, "an in-ring terrace is never steppable");
    assert(r.ringFeatureRise <= r.holeDepth + 1e-12, "and never deeper than the outside's dramatic rise");
    assert(near(r.bandFeatureMaxAmplitude, (r.bandFeatureMaxRadius * r.maxSlopeTan * g) / PROFILE_PEAK_SLOPE, 1e-12), "mound flank = slope budget");
  }
  const small = deriveTerrainRules({ arenaRadius: 6 }), large = deriveTerrainRules({ arenaRadius: 8 });
  assert(small.ringFeatureRise < large.ringFeatureRise, "the in-ring feature grows with the ring (not a fixed 1.75 m)");
  assert(TERRAIN_BASE_DEFAULTS.fighterReach > 0 && TERRAIN_BASE_DEFAULTS.bodyRadius === 0.5, "new base parameters have defaults");
});

Deno.test("fairness: the fair centre and the spawn pads are untouched by the ring relief", () => {
  for (const size of LIVE_SIZES) {
    const cfg = makeArena({ size });
    for (const seed of SEEDS) {
      const on = generateArenaTerrain(seed, cfg), off = generateArenaTerrain(seed, cfg, {}, { ringRelief: false, ringFeature: false });
      const r = on.stats.ring;
      assert(r.fairRelief <= on.rules.fightRelief + 1e-9, `size ${size} seed ${seed}: fair centre relief ${r.fairRelief} > one step`);
      // Rolling ground and mounds never reach it; pad levelling only pulls toward the fair datum.
      assert(r.fairRelief <= off.stats.ring.fairRelief + 1e-6, `size ${size} seed ${seed}: the ring relief widened the fair centre (${r.fairRelief} vs ${off.stats.ring.fairRelief})`);
      assert(r.spots.length === 2 && r.spotSpread <= 0.02, `size ${size} seed ${seed}: spawn heights differ by ${r.spotSpread} m`);
      for (let n = 0; n < on.heights.length; n++) {
        const x = on.originX + (n % on.cols) * on.cell, z = on.originZ + Math.floor(n / on.cols) * on.cell;
        if (Math.hypot(x, z) <= on.rules.fairRadius) assert(on.featureMask[n] === 0, `size ${size} seed ${seed}: flagged node on the fair centre`);
        for (const p of r.spots) if (Math.hypot(x - p.x, z - p.z) <= on.rules.fairPadRadius) assert(on.featureMask[n] === 0, `seed ${seed}: flagged node on a spawn pad`);
      }
    }
  }
  // Spots passed by the caller win over the default duel spawns.
  const outline = circleOutline(6), rules = deriveTerrainRules({ arenaRadius: 6 });
  const spots = [{ x: 0, z: -3 }, { x: 3.5, z: 0 }];
  const f = generateHeightfield(7, rules, outline, { fairSpots: spots });
  assert(f.stats.ring.spotSpread <= 0.02 && f.stats.ring.spots[0].z === -3, "custom fair spots are levelled");
  assert(near(duelSpawnPoints(outline)[0].x, -2.4, 1e-9), "duel spawns mirror the engine: s = min(2.5, 0.4 ringHalf)");
});

Deno.test("relief: the in-ring height band is several times the lane E field's, at both live sizes", () => {
  for (const size of LIVE_SIZES) {
    const cfg = makeArena({ size });
    const after: number[] = [], before: number[] = [];
    for (const seed of SEEDS) {
      const a = summarize(ringHeights(generateArenaTerrain(seed, cfg)));
      const b = summarize(ringHeights(generateArenaTerrain(seed, cfg, {}, { ringRelief: false, ringFeature: false })));
      after.push(a.p80 - a.p20);
      before.push(b.p80 - b.p20);
    }
    const A = summarize(after), B = summarize(before);
    assert(A.median >= 3 * B.median, `size ${size}: in-ring p80 - p20 median ${A.median} vs lane E ${B.median}`);
    assert(A.min >= 0.25, `size ${size}: flattest seed still has a ${A.min} m band`);
  }
});

Deno.test("relief: the rolling ground reaches its target RMS slope; band mounds keep the 80/20 split off the fair set", () => {
  const cfg = makeArena({ size: 12 });
  const shares: number[] = [];
  for (const seed of SEEDS) {
    const f = generateArenaTerrain(seed, cfg), r = f.stats.ring;
    assert(r.roll && near(r.roll.rmsSlope, f.rules.rollSlope, 0.1 * f.rules.rollSlope), `seed ${seed}: roll RMS slope ${r.roll?.rmsSlope} vs ${f.rules.rollSlope}`);
    const mounds = f.features.filter((x) => x.kind === "mound" || x.kind === "hollow");
    assert(mounds.length === f.rules.bandFeatureCount && r.mounds === mounds.length, "every band mound is stamped and listed");
    const raised = mounds.filter((m) => m.amplitude > 0).length;
    assert(Math.abs(2 * raised - mounds.length) <= 1, `seed ${seed}: mounds ${raised} vs hollows ${mounds.length - raised}`);
    for (const m of mounds) {
      assert(Math.abs(m.amplitude) <= f.rules.bandFeatureMaxAmplitude + 1e-9, "amplitude within the band cap");
      assert(1.5 * Math.abs(m.amplitude) / m.radius <= f.rules.maxSlopeTan * PARETO_TOP_SHARE + 1e-9, "each mound flank within the feature slope budget");
    }
    const clear = mounds.filter((m) => fairDistance(f.rules, r.spots, m.x, m.z) >= m.radius + f.cell - 1e-9).length;
    assert(clear >= mounds.length - 1, `seed ${seed}: ${mounds.length - clear} mounds overlap the fair set`);
    shares.push(topShare(mounds.map((m) => m.relative), PARETO_TOP_FRACTION));
  }
  const s = summarize(shares);
  assert(s.min >= 0.72 && s.max <= 0.88 && near(s.mean, 0.8, 0.03), `band mound top-20% share ${s.min}..${s.max}, mean ${s.mean}`);
});

Deno.test("features: a hole or cliff is visible inside the ring on >= 80% of seeds at the live sizes", () => {
  for (const size of LIVE_SIZES) {
    const cfg = makeArena({ size });
    let visible = 0, stamped = 0;
    for (const seed of SEEDS) {
      const f = generateArenaTerrain(seed, cfg);
      let inside = 0;
      for (let n = 0; n < f.heights.length; n++) if (f.ringNorm[n] < 1 && (f.featureMask[n] === FEATURE_HOLE || f.featureMask[n] === FEATURE_CLIFF)) inside++;
      assert(inside === f.stats.ring.insideAfter, "insideAfter recounts the mask");
      if (inside >= minVisibleNodes(f.rules)) visible++;
      if (f.stats.ring.feature === "terrace" || f.stats.ring.feature === "hole") {
        stamped++;
        const k = f.features[f.features.length - (f.stats.ring.feature === "hole" ? 2 : 1)];
        assert(k.kind === (f.stats.ring.feature === "hole" ? "hole" : "cliff"), "the in-ring stamp is listed");
        assert(Math.abs(k.amplitude) === f.rules.ringFeatureRise, `in-ring ${k.kind} sized ${k.amplitude}, rule ${f.rules.ringFeatureRise}`);
      }
    }
    assert(visible >= 0.8 * SEEDS.length, `size ${size}: visible in-ring hole/cliff on ${visible}/${SEEDS.length} seeds`);
    assert(size > 12 || stamped > 0, "the in-ring stamp is exercised");
  }
});

Deno.test("slope rule: unflagged pairs stay legal with the ring relief, every shape and size", () => {
  for (const size of [8, 12, 16, 24, 40]) {
    for (let shape = 0; shape < RING_SHAPES.length; shape++) {
      const cfg = makeArena({ size, shape, aspect: shape === 6 ? 1.7 : 1, rotation: shape * 23 });
      for (const seed of [11, 12]) {
        const f = generateArenaTerrain(seed, cfg);
        const residual = maxSlopeExcess(f.heights, f.featureMask, f.cols, f.rows, f.rules.maxNeighbourDelta, f.rules.maxDiagonalDelta, "unflagged");
        assert(residual <= 1e-6, `size ${size} ${RING_SHAPES[shape]} seed ${seed}: residual ${residual}`);
        assert(f.stats.ring.fairRelief <= f.rules.fightRelief + 1e-9, `size ${size} ${RING_SHAPES[shape]}: fair relief ${f.stats.ring.fairRelief}`);
        assert(Number.isFinite(heightAt(f, 0, 0)), "finite field");
      }
    }
  }
  const off = generateArenaTerrain(5, makeArena({ size: 12 }), {}, { ringRelief: false, ringFeature: false });
  assert(off.stats.ring.feature === "off" && off.stats.ring.roll === null && off.stats.ring.mounds === 0, "ring relief can be switched off");
  assert(outlineFromArena(makeArena({})).radiusAt(0) === 6, "default arena radius");
});
