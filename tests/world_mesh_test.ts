// Lane E (R07/R13): the terrain mesh follows the ring outline, faces up, counts its
// triangles, reuses its arrays, and its floor sampler matches the drawn triangles.
import { rng32 } from "../src/core/MathCore.ts";
import { insideRing, makeArena, RING_SHAPES } from "../src/game/ArenaConfig.ts";
import { buildTerrainMesh } from "../src/graphics/TerrainMesh.ts";
import { generateArenaTerrain, heightAt, outlineFromArena } from "../src/world/Heightfield.ts";
import { buildRingSurface, FLOOR_THICKNESS, surfaceHeightAt } from "../src/world/RingSurface.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

Deno.test("every ring shape: triangle count = S(2R + 1), floor faces up, skirt faces out", () => {
  for (let shape = 0; shape < RING_SHAPES.length; shape++) {
    const cfg = makeArena({ shape, aspect: shape === 6 ? 1.6 : 1, rotation: 25 });
    const f = generateArenaTerrain(shape + 1, cfg);
    const s = buildRingSurface(f, outlineFromArena(cfg));
    const { rings: R, segments: S } = s.layout;
    assert(S % 24 === 0, `segments ${S} not a multiple of 24`);
    assert(s.triangleCount === S * (2 * R + 1) && s.indices.length === s.triangleCount * 3, `${RING_SHAPES[shape]}: ${s.triangleCount} triangles`);
    assert(s.vertexCount === 1 + R * S + 2 * S, "vertex count");
    const p = s.positions, ix = s.indices;
    for (let t = 0; t < s.triangleCount; t++) {
      const a = ix[t * 3], b = ix[t * 3 + 1], c = ix[t * 3 + 2];
      const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
      const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
      const ny = uz * vx - ux * vz; // y of (u x v)
      if (t < s.floorTriangles) assert(ny > 0, `${RING_SHAPES[shape]}: floor triangle ${t} faces down`);
      else {
        const nx = uy * vz - uz * vy, nz = ux * vy - uy * vx;
        const cx = (p[a * 3] + p[b * 3] + p[c * 3]) / 3, cz = (p[a * 3 + 2] + p[b * 3 + 2] + p[c * 3 + 2]) / 3;
        assert(nx * cx + nz * cz > 0, `${RING_SHAPES[shape]}: skirt triangle ${t} faces inward`);
      }
    }
    for (let v = 0; v < s.vertexCount; v++) {
      const len = Math.hypot(s.normals[v * 3], s.normals[v * 3 + 1], s.normals[v * 3 + 2]);
      assert(Math.abs(len - 1) < 1e-5, `normal ${v} not unit`);
      for (let c = 0; c < 3; c++) assert(s.colors[v * 3 + c] >= 0 && s.colors[v * 3 + c] <= 1, "colour in [0,1]");
    }
    // Rim vertices sit on the outline.
    for (let j = 0; j < S; j++) {
      const v = 1 + (R - 1) * S + j, x = p[v * 3], z = p[v * 3 + 2];
      assert(Math.abs(Math.hypot(x, z) - s.rimRadius[j]) < 1e-4, "rim vertex on the outline");
    }
    assert(s.skirtBottomY < f.stats.heights.max - FLOOR_THICKNESS, "skirt reaches below the floor");
  }
});

Deno.test("the floor sampler returns the DRAWN triangles: exact at vertices, NaN outside the ring", () => {
  const cfg = makeArena({ shape: 4, rotation: 10 });
  const f = generateArenaTerrain(3, cfg);
  const s = buildRingSurface(f, outlineFromArena(cfg));
  for (let v = 0; v < 1 + s.layout.rings * s.layout.segments; v += 7) {
    const x = s.positions[v * 3], y = s.positions[v * 3 + 1], z = s.positions[v * 3 + 2];
    const h = surfaceHeightAt(s, x * 0.999999, z * 0.999999);
    assert(Math.abs(h - y) < 1e-3, `vertex ${v}: sampler ${h} vs vertex ${y}`);
    assert(Math.abs(y - heightAt(f, x, z)) < 1e-5, "vertices take the field height");
  }
  const rng = rng32(4);
  let inside = 0;
  for (let k = 0; k < 2000; k++) {
    const x = (rng() * 2 - 1) * 7, z = (rng() * 2 - 1) * 7;
    const h = surfaceHeightAt(s, x, z);
    if (!insideRing(cfg, x, z)) { assert(Number.isNaN(h), `outside the ring at (${x}, ${z}) but sampled ${h}`); continue; }
    if (Number.isNaN(h)) continue; // a sliver between a chord and the true outline
    inside++;
    assert(Number.isFinite(h), "finite inside");
  }
  assert(inside > 900, `only ${inside} interior samples resolved`);
});

Deno.test("TerrainMesh: one geometry, rebuilt in place, floorHeightAt inside and outside", () => {
  const cfg = makeArena({});
  const outline = outlineFromArena(cfg);
  const f = generateArenaTerrain(5, cfg);
  const first = buildTerrainMesh(f, outline, { outsideBaseY: cfg.outsideHeight });
  const pos = first.mesh.geometry.getAttribute("position");
  assert(pos.count === first.surface.vertexCount, "position attribute matches");
  assert(first.mesh.geometry.getIndex()!.count === first.triangleCount * 3, "index count");
  assert(first.triangleCount === 2400, `12 m ring at 0.5 m cells: ${first.triangleCount} triangles`);
  const g = generateArenaTerrain(6, cfg);
  const second = buildTerrainMesh(g, outline, { outsideBaseY: cfg.outsideHeight }, first);
  assert(second.mesh === first.mesh && second.mesh.geometry === first.mesh.geometry, "mesh and geometry reused");
  assert(second.mesh.geometry.getAttribute("position") === pos, "attribute object reused");
  assert(second.surface.positions === first.surface.positions, "typed arrays reused");
  assert(second.floorHeightAt(8, 0) === cfg.outsideHeight, "outside = the flat outside plane by default");
  const follow = buildTerrainMesh(g, outline, { outsideBaseY: cfg.outsideHeight, outsideFollowsTerrain: true });
  assert(Math.abs(follow.floorHeightAt(8, 0) - (cfg.outsideHeight + heightAt(g, 8, 0))) < 1e-9, "opt-in: outsideHeight + field");
  assert(Math.abs(second.floorHeightAt(0, 0) - surfaceHeightAt(second.surface, 0, 0)) < 1e-12, "inside = drawn floor");
});
