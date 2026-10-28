// Lane E2 (R07/R13): the outside ground is a drawn mesh that follows the heightfield,
// meets the ring skirt without a gap, stays inside the triangle budget, and the floor
// sampler returns exactly what is drawn (physics stands on the picture).
import { rng32 } from "../src/core/MathCore.ts";
import { insideRing, makeArena, RING_SHAPES } from "../src/game/ArenaConfig.ts";
import { buildTerrainMesh } from "../src/graphics/TerrainMesh.ts";
import { generateArenaTerrain, heightAt, outlineFromArena } from "../src/world/Heightfield.ts";
import { buildOutsideSurface, outsideHeightAt, TERRAIN_TRIANGLE_BUDGET } from "../src/world/OutsideSurface.ts";
import { buildRingSurface, surfaceHeightAt } from "../src/world/RingSurface.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

Deno.test("outside: triangle count = 2 S (K + 2); ring + outside within the 6k budget at the default size", () => {
  const cfg = makeArena({});
  const f = generateArenaTerrain(3, cfg), outline = outlineFromArena(cfg);
  const ring = buildRingSurface(f, outline);
  const o = buildOutsideSurface(f, outline, ring);
  const { segments: S, bands: K } = o.layout;
  assert(S === ring.layout.segments, "the outside shares the ring's segments (no T-junction at the seam)");
  assert(o.triangleCount === 2 * S * (K + 2) && o.indices.length === o.triangleCount * 3, `${o.triangleCount} triangles`);
  assert(o.vertexCount === (K + 3) * S, "vertex count");
  assert(ring.triangleCount + o.triangleCount <= TERRAIN_TRIANGLE_BUDGET, `${ring.triangleCount} + ${o.triangleCount} > budget`);
  assert(ring.triangleCount === 2400 && o.triangleCount === 1344, `default arena: ring ${ring.triangleCount}, outside ${o.triangleCount}`);
  assert(o.layout.outerRadius <= f.rules.domainHalf && o.layout.outerRadius > 6, "the field rows stay on the grid, beyond the rim");
  const tight = buildOutsideSurface(f, outline, ring, { triangleBudget: 8 * S });
  assert(tight.layout.bands === 2 && tight.triangleCount <= 8 * S, `a tight budget cuts the bands (${tight.layout.bands})`);
});

Deno.test("outside: follows the field, faces up, and meets the ring skirt exactly at every rim vertex", () => {
  for (let shape = 0; shape < RING_SHAPES.length; shape++) {
    const cfg = makeArena({ shape, aspect: shape === 6 ? 1.6 : 1, rotation: 25 });
    const f = generateArenaTerrain(shape + 11, cfg), outline = outlineFromArena(cfg);
    const build = buildTerrainMesh(f, outline, { outsideBaseY: cfg.outsideHeight, outside: true, outsideFollowsTerrain: true });
    const ring = build.surface, o = build.outside!.surface;
    const S = o.layout.segments, K = o.layout.bands, R = ring.layout.rings;
    const floorVerts = 1 + R * S;
    for (let j = 0; j < S; j++) {
      const rim = 1 + (R - 1) * S + j, out0 = j, seam = (K + 2) * S + j, skirtBottom = floorVerts + S + j;
      const rimY = ring.positions[rim * 3 + 1], outY = o.positions[out0 * 3 + 1];
      for (const c of [0, 2]) {
        assert(Math.abs(o.positions[out0 * 3 + c] - ring.positions[rim * 3 + c]) < 1e-5, `${RING_SHAPES[shape]}: outside row 0 off the rim at ${j}`);
        assert(Math.abs(ring.positions[skirtBottom * 3 + c] - ring.positions[rim * 3 + c]) < 1e-5, "skirt bottom under the rim");
      }
      assert(Math.abs(ring.positions[skirtBottom * 3 + 1] - Math.min(rimY, outY)) < 1e-5, `${RING_SHAPES[shape]}: skirt bottom ${ring.positions[skirtBottom * 3 + 1]} vs outside ${outY}`);
      assert(Math.abs(o.positions[seam * 3 + 1] - Math.min(rimY, outY)) < 1e-5, "seam wall spans the rest");
    }
    for (let k = 0; k <= K; k++) {
      for (let j = 0; j < S; j += 5) {
        const v = k * S + j, x = o.positions[v * 3], y = o.positions[v * 3 + 1], z = o.positions[v * 3 + 2];
        assert(Math.abs(y - (cfg.outsideHeight + heightAt(f, x, z))) < 1e-5, `row ${k}: vertex off the field`);
        assert(o.normals[v * 3 + 1] > 0 && Math.abs(Math.hypot(o.normals[v * 3], o.normals[v * 3 + 1], o.normals[v * 3 + 2]) - 1) < 1e-5, "unit up normal");
        if (k < K) assert(Math.abs(outsideHeightAt(o, x * 1.000001, z * 1.000001) - y) < 2e-3, `sampler at row ${k} vertex: ${outsideHeightAt(o, x, z)} vs ${y}`);
      }
    }
    // Every outside triangle faces up except the seam wall (horizontal normal, inward).
    const p = o.positions, ix = o.indices;
    for (let t = 0; t < o.fieldTriangles + o.apronTriangles; t++) {
      const a = ix[t * 3], b = ix[t * 3 + 1], c = ix[t * 3 + 2];
      const ny = (p[b * 3 + 2] - p[a * 3 + 2]) * (p[c * 3] - p[a * 3]) - (p[b * 3] - p[a * 3]) * (p[c * 3 + 2] - p[a * 3 + 2]);
      assert(ny > 0, `${RING_SHAPES[shape]}: outside triangle ${t} faces down`);
    }
  }
});

Deno.test("outside: holes beyond the rim are DRAWN (the sampler dips into them)", () => {
  let checked = 0;
  for (const size of [12, 16]) {
    const cfg = makeArena({ size });
    const outline = outlineFromArena(cfg);
    for (let s = 0; s < 40; s++) {
      const f = generateArenaTerrain(1000 + s * 7919, cfg);
      const build = buildTerrainMesh(f, outline, { outsideBaseY: cfg.outsideHeight, outside: true, outsideFollowsTerrain: true });
      const o = build.outside!.surface;
      for (const h of f.features.filter((x) => x.kind === "hole")) {
        const d = Math.hypot(h.x, h.z);
        if (d < outline.radiusAt(Math.atan2(h.z, h.x)) + f.cell || d > o.layout.outerRadius - f.cell) continue; // centre on the drawn outside
        const drawn = build.floorHeightAt(h.x, h.z), floor = cfg.outsideHeight + heightAt(f, h.x, h.z);
        assert(Math.abs(drawn - floor) < 0.1, `size ${size} seed ${s}: drawn hole floor ${drawn} vs field ${floor}`);
        let rim = 0;
        for (let k = 0; k < 8; k++) rim += heightAt(f, h.x + Math.cos(k * Math.PI / 4) * (h.radius + f.cell), h.z + Math.sin(k * Math.PI / 4) * (h.radius + f.cell)) / 8;
        assert(cfg.outsideHeight + rim - drawn > Math.abs(h.amplitude) / 2, `size ${size} seed ${s}: the drawn hole is only ${cfg.outsideHeight + rim - drawn} m deep`);
        checked++;
      }
    }
  }
  assert(checked >= 5, `only ${checked} outside holes checked`);
});

Deno.test("floor sampler: ring triangles inside, outside triangles beyond the rim, far apron beyond the field", () => {
  const cfg = makeArena({ shape: 4, rotation: 10 });
  const outline = outlineFromArena(cfg);
  const f = generateArenaTerrain(9, cfg);
  const build = buildTerrainMesh(f, outline, { outsideBaseY: cfg.outsideHeight, outside: true, outsideFollowsTerrain: true });
  const o = build.outside!.surface, rng = rng32(2);
  let inside = 0, outside = 0;
  for (let k = 0; k < 3000; k++) {
    const x = (rng() * 2 - 1) * 10, z = (rng() * 2 - 1) * 10, y = build.floorHeightAt(x, z);
    assert(Number.isFinite(y), "finite everywhere");
    const ringY = surfaceHeightAt(build.surface, x, z);
    if (!Number.isNaN(ringY)) { assert(y === ringY, "inside: the drawn ring floor"); inside++; continue; }
    const outY = outsideHeightAt(o, x, z);
    if (!insideRing(cfg, x, z) && !Number.isNaN(outY)) { assert(y === outY, "outside: the drawn outside"); outside++; }
  }
  assert(inside > 500 && outside > 500, `inside ${inside}, outside ${outside}`);
  assert(build.floorHeightAt(200, 0) === o.farY && build.floorHeightAt(60, 0) === outsideHeightAt(o, 60, 0), "the far apron");
  const flat = buildTerrainMesh(f, outline, { outsideBaseY: cfg.outsideHeight });
  assert(flat.outside === null && flat.floorHeightAt(8, 0) === cfg.outsideHeight, "default: no outside mesh, flat outside plane");
});

Deno.test("TerrainMesh + TerrainOutside: one child mesh, painted, rebuilt in place", () => {
  const cfg = makeArena({});
  const outline = outlineFromArena(cfg);
  const opts = { outsideBaseY: cfg.outsideHeight, outside: true, outsideFollowsTerrain: true, paint: { place: "verdant" } };
  const first = buildTerrainMesh(generateArenaTerrain(5, cfg), outline, opts);
  assert(first.outside && first.outside.mesh.parent === first.mesh, "the outside is a child of the floor mesh");
  assert(first.outside.mesh.name === "arena-outside" && first.mesh.name === "arena-floor", "scene names kept");
  assert(first.triangleCount === first.ringTriangles + first.outside.triangleCount && first.triangleCount <= TERRAIN_TRIANGLE_BUDGET, `${first.triangleCount} triangles`);
  for (const arr of [first.surface.colors, first.outside.surface.colors]) for (const c of arr) assert(c >= 0 && c <= 1, "colour in [0, 1]");
  const pos = first.outside.mesh.geometry.getAttribute("position");
  const second = buildTerrainMesh(generateArenaTerrain(6, cfg), outline, opts, first);
  assert(second.outside!.mesh === first.outside.mesh && second.outside!.mesh.geometry.getAttribute("position") === pos, "outside mesh and attribute reused");
  assert(second.mesh.children.filter((c) => c.name === "arena-outside").length === 1, "never added twice");
  const off = buildTerrainMesh(generateArenaTerrain(7, cfg), outline, { outsideBaseY: NaN, outside: true }, second);
  assert(off.outside === null && off.mesh.children.length === 0 && Number.isNaN(off.floorHeightAt(9, 0)), "a void outside removes the child");
});
