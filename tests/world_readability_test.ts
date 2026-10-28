// Lane E2 (R07/R13/R15): headless READABILITY metrics of the terrain, before (the lane E
// field: ringRelief off, plain band colours) vs after (ring relief + TerrainPaint):
//   (a) Lambert N.L p20..p80 spread at noon (Environment.ts environmentAt, hour 12), per ground AREA
//   (b) CIE76 Delta E between adjacent gameplay-material zones of the painted floor
//   (c) triangle totals, ring + outside, at the default size
// plus the paint's own rules (pattern kinds, blend modes, Nyquist scales, colour bounds).
import { makeArena } from "../src/game/ArenaConfig.ts";
import { materialAt, surfaceFor } from "../src/game/Terrain.ts";
import { summarize } from "../src/core/MathCore.ts";
import { PLACES } from "../src/graphics/Environment.ts";
import { linearToSrgb } from "../src/graphics/paint/Blend.ts";
import { chromaOf, insideBounds } from "../src/graphics/paint/Relevance.ts";
import {
  MATERIAL_PAINT, paintOutsideSurface, paintTerrainSurface, ROLE_FLOOR, TERRAIN_COAT_BOUNDS, TERRAIN_VERTEX_BOUNDS, TERRAIN_ZONES, terrainPaintStack,
  terrainZoneAt,
} from "../src/graphics/TerrainPaint.ts";
import { FEATURE_NONE, generateArenaTerrain, nearestNode, outlineFromArena } from "../src/world/Heightfield.ts";
import { buildOutsideSurface, TERRAIN_TRIANGLE_BUDGET } from "../src/world/OutsideSurface.ts";
import { buildRingSurface } from "../src/world/RingSurface.ts";
import {
  deltaE76, lambertStats, linearRgbToLab, noonSuns, vertexAreaWeights, weightedSpread, zoneContrast,
} from "../src/world/TerrainReadability.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;
const SEEDS = Array.from({ length: 30 }, (_, k) => 1000 + k * 7919);
/** 2026-10-28, the day the parent's noon vision pass rated the relief 0/10. */
const DAY = 301;
const MATS = ["stone", "wood", "sand", "ice"] as const;

Deno.test("metrics: Lab, Delta E, weighted spread and area weights are right on known values", () => {
  const white = linearRgbToLab(1, 1, 1), grey = linearRgbToLab(0.214, 0.214, 0.214);
  assert(near(white.L, 100, 1e-3) && near(white.a, 0, 1e-2) && near(white.b, 0, 1e-2), `white ${JSON.stringify(white)}`);
  assert(near(grey.L, 53.4, 0.2), `sRGB 0.5 grey L* ${grey.L}`);
  assert(near(deltaE76({ L: 50, a: 0, b: 0 }, { L: 53, a: 4, b: 0 }), 5, 1e-12), "Delta E is Euclidean in Lab");
  const s = weightedSpread([1, 2, 3, 4, 5], 5);
  assert(s.p20 === 1 && s.p80 === 4 && s.mean === 3, `spread ${JSON.stringify(s)}`);
  const heavy = weightedSpread([1, 2, 3, 4, 5], 5, [0, 0, 0, 0, 1]);
  assert(heavy.p20 === 5 && heavy.mean === 5, "weights move the quantiles");
  const w = vertexAreaWeights([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1], [0, 2, 1, 1, 2, 3], 2, 4);
  assert(near(w.reduce((a, b) => a + b, 0), 1, 1e-12), "area weights sum to the mesh area (a unit square)");
  const flat = lambertStats(new Float32Array([0, 1, 0, 0, 1, 0]), 2, [0, Math.SQRT1_2, Math.SQRT1_2]);
  assert(flat.perVertex.spread === 0 && near(flat.perVertex.mean, Math.SQRT1_2, 1e-6), "a flat plane has no Lambert spread");
});

Deno.test("(a) relief reads under the noon sun: per-area N.L spread >= 0.15 (median) at every place, >= 3x lane E", () => {
  const suns = noonSuns(DAY);
  for (const size of [12, 16]) {
    const cfg = makeArena({ size }), outline = outlineFromArena(cfg);
    const after = suns.map(() => [] as number[]), before = suns.map(() => [] as number[]), vertex = suns.map(() => [] as number[]);
    for (const seed of SEEDS) {
      for (const [list, ring] of [[after, true], [before, false]] as const) {
        const f = generateArenaTerrain(seed, cfg, {}, { ringRelief: ring, ringFeature: ring });
        const s = buildRingSurface(f, outline), floor = 1 + s.layout.rings * s.layout.segments;
        const w = vertexAreaWeights(s.positions, s.indices, s.floorTriangles, floor);
        suns.forEach((sun, k) => {
          const st = lambertStats(s.normals, floor, sun.dir, w);
          list[k].push(st.perArea.spread);
          if (ring) vertex[k].push(st.perVertex.spread);
        });
      }
    }
    suns.forEach((sun, k) => {
      const a = summarize(after[k]), b = summarize(before[k]), v = summarize(vertex[k]);
      assert(a.median >= 0.15, `size ${size} ${sun.place} (sun ${sun.elevationDeg.toFixed(1)} deg): per-area N.L spread median ${a.median.toFixed(3)} < 0.15`);
      assert(a.median >= 3 * b.median, `size ${size} ${sun.place}: ${a.median.toFixed(3)} vs lane E ${b.median.toFixed(3)}`);
      assert(v.median >= 3 * summarize(before[k]).median * 0.6, `size ${size} ${sun.place}: per-vertex spread ${v.median.toFixed(3)}`);
    });
  }
});

Deno.test("(b) adjacent material zones differ by Delta E76 >= 12 on every seed; (c) ring + outside <= 6k triangles", () => {
  for (const size of [12, 16]) {
    const cfg = makeArena({ size }), outline = outlineFromArena(cfg), half = size / 2;
    for (const seed of SEEDS) {
      const f = generateArenaTerrain(seed, cfg);
      const s = buildRingSurface(f, outline), floor = 1 + s.layout.rings * s.layout.segments;
      paintTerrainSurface(f, outline, s, { ringHalf: half });
      const zone = new Int8Array(floor);
      for (let v = 0; v < floor; v++) zone[v] = MATS.indexOf(materialAt(s.positions[v * 3], s.positions[v * 3 + 2], half));
      const zc = zoneContrast(s.colors, zone, floor, 4, [[0, 1], [1, 2], [2, 3]], vertexAreaWeights(s.positions, s.indices, s.floorTriangles, floor));
      assert(zc.pairs.length === 3 && zc.minDeltaE >= 12, `size ${size} seed ${seed}: weakest adjacent pair Delta E ${zc.minDeltaE.toFixed(1)}`);
      if (size === 12) {
        const o = buildOutsideSurface(f, outline, s);
        assert(s.triangleCount + o.triangleCount <= TERRAIN_TRIANGLE_BUDGET, `seed ${seed}: ${s.triangleCount + o.triangleCount} triangles`);
      }
    }
  }
});

Deno.test("paint: >= 4 pattern kinds, >= 3 blend modes, every pattern above the vertex Nyquist scale, opacities from gameplay", () => {
  const f = generateArenaTerrain(4, makeArena({}));
  const stack = terrainPaintStack(f, "greywall");
  const kinds = new Set(stack.layers.map((l) => l.pattern)), blends = new Set(stack.layers.map((l) => l.blend));
  assert(kinds.size >= 4 && blends.size >= 3, `kinds ${[...kinds]}, blends ${[...blends]}`);
  for (const l of stack.layers) {
    // Height-banded stripes (angle 0) repeat every `scale` metres of RISE: their horizontal period is
    // scale / slope, on the slope each one is drawn for (ramps: rampSlopeTan; contours: the band's rollSlope).
    const slope = l.name === "ramp-treads" ? f.rules.rampSlopeTan : l.name === "step-contours" ? f.rules.rollSlope : 0;
    const horizontal = slope > 0 ? l.scale / slope : l.scale;
    if (l.pattern !== "solid" && l.pattern !== "gradient") assert(horizontal >= 2 * f.cell - 1e-9, `${l.name}: period ${horizontal} under 2 cells`);
    assert(l.opacity > 0 && l.opacity <= 1 && (l.regions?.length ?? 0) > 0, `${l.name}: opacity / mask`);
  }
  const by = (name: string) => stack.layers.find((l) => l.name === name)!;
  assert(near(by("ice-cracks").opacity, 1 - surfaceFor("stone").stop / surfaceFor("ice").stop, 1e-12), "ice cracks show the slip");
  assert(near(by("sand-ripples").opacity, 2 * (1 - surfaceFor("sand").speed), 1e-12), "sand ripples show the slowdown");
  const rock = by("slope-rock").params!;
  assert(near(rock.from, 0.5 + 0.5 / Math.hypot(1, f.rules.maxClimbTan), 1e-12) && rock.invert === 1, "slope rock is full at the climb limit");
  for (const m of MATS) assert(insideBounds(MATERIAL_PAINT[m].coat, TERRAIN_COAT_BOUNDS, 0.01), `${m} coat inside the coat bounds`);
});

Deno.test("paint: every vertex is relevant (no neon, no black, no white); zones follow gameplay; features are highlighted", () => {
  const cfg = makeArena({}), outline = outlineFromArena(cfg);
  const groundY: number[][] = [[], [], [], []], holeY: number[] = [], rimY: number[] = [];
  for (const place of PLACES.map((p) => p.id)) {
    for (const seed of SEEDS.slice(0, 10)) {
      const f = generateArenaTerrain(seed, cfg);
      const s = buildRingSurface(f, outline);
      const o = buildOutsideSurface(f, outline, s);
      const ring = paintTerrainSurface(f, outline, s, { place, ringHalf: 6 });
      const out = paintOutsideSurface(f, outline, o, { place, ringHalf: 6 });
      for (const [res, n] of [[ring, s.vertexCount], [out, o.vertexCount]] as const) {
        for (let v = 0; v < n; v++) {
          const r = res.colors[v * 3], g = res.colors[v * 3 + 1], b = res.colors[v * 3 + 2];
          const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, C = chromaOf(linearToSrgb(r), linearToSrgb(g), linearToSrgb(b));
          assert(C <= TERRAIN_VERTEX_BOUNDS.chroma[1] + 0.01, `${place} seed ${seed}: chroma ${C}`);
          assert(Y >= TERRAIN_VERTEX_BOUNDS.luminance[0] - 0.002 && Y <= TERRAIN_VERTEX_BOUNDS.luminance[1] + 0.002, `${place} seed ${seed}: luminance ${Y}`);
          const z = res.zones[v];
          if (res === ring && z < 4) groundY[z].push(Y);
          if (z === TERRAIN_ZONES.hole) holeY.push(Y);
          if (z === TERRAIN_ZONES.rim) rimY.push(Y);
        }
      }
      // Ordinary floor vertices carry exactly the gameplay material of their position.
      const floor = 1 + s.layout.rings * s.layout.segments;
      for (let v = 0; v < floor; v += 3) {
        const x = s.positions[v * 3], z = s.positions[v * 3 + 2];
        if (f.featureMask[nearestNode(f, x, z)] !== FEATURE_NONE || ring.zones[v] === TERRAIN_ZONES.rim) continue;
        assert(ring.zones[v] === MATS.indexOf(materialAt(x, z, 6)) && terrainZoneAt(f, x, z, ROLE_FLOOR, 6) === ring.zones[v], "zone = materialAt");
      }
    }
  }
  const median = (v: number[]) => summarize(v).median;
  assert(holeY.length > 0 && rimY.length > 0, "holes and rims were painted");
  assert(median(holeY) < median(rimY) && median(rimY) < Math.min(...groundY.map(median)), `hole ${median(holeY)} < rim ${median(rimY)} < ground`);
  // No mud: every material zone is either clearly chromatic or clearly light.
  for (const [k, ys] of groundY.entries()) assert(median(ys) >= 0.08, `${MATS[k]} median luminance ${median(ys)}`);
});
