// Lane S (V04): the surroundings meshes build headless within budget (<= 6 draw calls, <= 30k
// triangles) for every biome and variant, animate through uniforms only, and are deterministic.
// @deno-types="@types/three"
import * as THREE from "three";
import { rng32 } from "../src/core/MathCore.ts";
import { makeArena, ringRadiusAt } from "../src/game/ArenaConfig.ts";
import { generateArenaTerrain } from "../src/world/Heightfield.ts";
import { chooseBiome, createSurroundings } from "../src/world/biomes/Biomes.ts";
import type { BiomeKind, BiomeSpec } from "../src/world/biomes/contracts.ts";
import { WAVE_COUNT, wavePhasesAt } from "../src/world/biomes/Waves.ts";
import { buildSurroundingsMesh, SURROUNDINGS_DRAW_BUDGET, SURROUNDINGS_TRIANGLE_BUDGET } from "../src/graphics/biomes/SurroundingsMesh.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok {
  if (!ok) throw new Error(m);
}

/** Build the surroundings for a kind/variant on an arena of `size` m and `shape` index. */
function build(kind: BiomeKind, variant: string, size: number, shape: number, outsideGround: 0 | 1, agitation = 1) {
  const cfg = makeArena({ size, shape, outsideGround, outsideHeight: -3, wind: 0.6 * agitation });
  const R = Math.max(...Array.from({ length: 64 }, (_, i) => ringRadiusAt(cfg, (i / 64) * 2 * Math.PI)));
  const field = outsideGround ? generateArenaTerrain(31, cfg) : null;
  const base = chooseBiome(cfg, "verdant", rng32(8));
  const spec: BiomeSpec = {
    ...base, kind, variant, agitation, relief: kind === "hills" ? Math.min(30, size * 0.4) : 3, density: 0.75, groundDepth: 28,
    surfaceDrop: outsideGround ? -3 : -7, outsideGround: outsideGround === 1,
  };
  const s = createSurroundings(spec, field, R);
  return buildSurroundingsMesh(s, { rimRadiusAt: (a) => ringRadiusAt(cfg, a), rimBottomY: -0.9 });
}

const CASES: [BiomeKind, string, 0 | 1][] = [
  ["water", "lake", 0], ["water", "icy", 0], ["water", "moat", 0], ["magma", "basalt", 0], ["clouds", "fair", 0], ["clouds", "storm", 0],
  ["canopy", "lush", 0], ["canopy", "lush", 1], ["void", "abyss", 0], ["meadow", "lush", 1], ["meadow", "dry", 1], ["hills", "heath", 1], ["hills", "snow", 1],
];

Deno.test("every biome builds headless within <= 6 draw calls and <= 30k triangles (small + large arenas, all shapes)", () => {
  const rows: string[] = [];
  for (const [kind, variant, ground] of CASES) {
    let worstTri = 0, worstDraw = 0;
    for (const size of [34, 120]) {
      for (const shape of [0, 1, 7]) {
        const mesh = build(kind, variant, size, shape, ground);
        worstTri = Math.max(worstTri, mesh.stats.triangles);
        worstDraw = Math.max(worstDraw, mesh.stats.drawCalls);
        assert(mesh.stats.drawCalls <= SURROUNDINGS_DRAW_BUDGET, `${kind}/${variant} ${size} m shape ${shape}: ${mesh.stats.drawCalls} draws`);
        assert(mesh.stats.triangles <= SURROUNDINGS_TRIANGLE_BUDGET, `${kind}/${variant} ${size} m shape ${shape}: ${mesh.stats.triangles} triangles`);
        assert(mesh.stats.drawCalls >= 2 && mesh.stats.triangles > 500, `${kind}/${variant}: built something`);
        if (size === 34 && shape === 1) rows.push(`${kind}/${variant} (outsideGround ${ground}) 34 m triangle: ${mesh.stats.drawCalls} draws, ${mesh.stats.triangles} tris = ${mesh.stats.parts.map((p) => `${p.name.replace("surroundings-", "")} ${p.triangles}`).join(", ")}`);
        mesh.dispose();
      }
    }
    rows.push(`  worst over sizes 34/120 and shapes circle/triangle/diamond: ${worstDraw} draws, ${worstTri} tris`);
  }
  console.log(rows.join("\n"));
});

Deno.test("update() writes uniforms only: geometry untouched, wave phases = Waves.wavePhasesAt(t)", () => {
  const mesh = build("water", "lake", 40, 0, 0, 0.8);
  const water = mesh.group.children.find((o) => o.name === "surroundings-water") as THREE.Mesh;
  const positions = (water.geometry.attributes.position.array as Float32Array).slice();
  const material = water.material as THREE.ShaderMaterial;
  mesh.update(12.5, { x: 0.3, y: 0.9, z: 0.1 }, [0.9, 0.85, 0.8], { sunColor: [2, 1.9, 1.7], zenith: [0.1, 0.3, 0.8], horizon: [0.6, 0.7, 0.9] });
  const after = water.geometry.attributes.position.array as Float32Array;
  assert(positions.every((v, i) => v === after[i]), "update must not rebuild geometry");
  const phase = material.uniforms.uWavePhase.value as THREE.Vector4;
  const expect = wavePhasesAt(mesh.surroundings.waves!, 12.5, new Float64Array(WAVE_COUNT));
  assert(Math.abs(phase.x - expect[0]) < 1e-12 && Math.abs(phase.w - expect[3]) < 1e-12, "phase uniform = wavePhasesAt");
  assert(Math.abs((material.uniforms.uTime.value as number) - 12.5) < 1e-12, "time uniform");
  const sun = material.uniforms.uSunDir.value as THREE.Vector3;
  assert(Math.abs(sun.length() - 1) < 1e-9, "sun direction normalised");
  // Shared: one write reaches every material.
  const amb = new Set(mesh.group.children.map((o) => ((o as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uAmbient));
  assert(amb.size === 1, "every material shares the ambient uniform object");
  mesh.dispose();
});

Deno.test("shaders: fragment varyings are declared by their vertex shader, braces balance, fog wired", () => {
  for (const [kind, variant, ground] of CASES) {
    const mesh = build(kind, variant, 40, 0, ground);
    for (const o of mesh.group.children) {
      const mat = (o as THREE.Mesh).material as THREE.ShaderMaterial;
      assert(mat.isShaderMaterial, `${o.name}: ShaderMaterial`);
      const vary = (src: string) => new Set([...src.matchAll(/varying\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]));
      const vs = vary(mat.vertexShader), fs = vary(mat.fragmentShader);
      for (const v of fs) assert(vs.has(v), `${o.name}: varying ${v} missing in the vertex shader`);
      for (const src of [mat.vertexShader, mat.fragmentShader]) {
        assert((src.match(/{/g) ?? []).length === (src.match(/}/g) ?? []).length, `${o.name}: braces`);
        assert(src.includes("void main()"), `${o.name}: main`);
      }
      if (mat.fog) {
        assert(mat.fragmentShader.includes("#include <fog_fragment>") && mat.vertexShader.includes("#include <fog_vertex>"), `${o.name}: fog chunks`);
        assert("fogColor" in mat.uniforms && "fogNear" in mat.uniforms, `${o.name}: fog uniforms`);
      }
    }
    mesh.dispose();
  }
});

Deno.test("determinism: the same spec builds identical geometry", () => {
  for (const [kind, variant, ground] of CASES) {
    const a = build(kind, variant, 50, 4, ground), b = build(kind, variant, 50, 4, ground);
    assert(a.stats.triangles === b.stats.triangles, `${kind}: triangle counts`);
    a.group.children.forEach((o, i) => {
      const ga = (o as THREE.Mesh).geometry, gb = (b.group.children[i] as THREE.Mesh).geometry;
      for (const key of Object.keys(ga.attributes)) {
        const x = ga.attributes[key].array as ArrayLike<number>, y = gb.attributes[key].array as ArrayLike<number>;
        assert(x.length === y.length, `${kind}/${o.name}/${key}: length`);
        for (let k = 0; k < x.length; k++) if (!Object.is(x[k], y[k])) throw new Error(`${kind}/${o.name}/${key}[${k}] differs`);
      }
    });
    a.dispose();
    b.dispose();
  }
});
