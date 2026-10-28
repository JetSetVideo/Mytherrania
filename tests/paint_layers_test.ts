// Lane B paint: paintVertices composites a stack per vertex, deterministically, inside
// region masks, in the documented colour space, for every pattern kind.
// @deno-types="@types/three"
import * as THREE from "three";
import { type MeshData, type PaintLayer, type PaintStack, REGIONS, type Region } from "../src/graphics/body/contracts.ts";
import { srgbToLinear } from "../src/graphics/paint/Blend.ts";
import { paintVertices } from "../src/graphics/paint/Layers.ts";
import { mannequinMesh } from "../src/graphics/paint/Mannequin.ts";
import { buildPatternEnv, PATTERN_KINDS, REGION_INDEX } from "../src/graphics/paint/Patterns.ts";
import { TATTOO_SYMBOLS } from "../src/graphics/paint/Symbols.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

/**
 * A UV sphere of radius r centred at y = r (so it sits on y = 0), its vertices given a
 * region by height band: the 15 REGIONS stacked from the sole (bottom) to hair (top).
 */
function bandedSphere(r = 0.9, lon = 48, lat = 32): MeshData {
  const n = (lon + 1) * (lat + 1);
  const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3), region = new Uint8Array(n);
  const order: Region[] = ["sole", "foot", "shin", "thigh", "pelvis", "hand", "nail", "foreArm", "upperArm", "torso", "neck", "ear", "face", "head", "hair"];
  let v = 0;
  for (let j = 0; j <= lat; j++) {
    const theta = Math.PI * j / lat;
    for (let i = 0; i <= lon; i++) {
      const phi = 2 * Math.PI * i / lon;
      const nx = Math.sin(theta) * Math.sin(phi), ny = Math.cos(theta), nz = Math.sin(theta) * Math.cos(phi);
      positions.set([r * nx, r + r * ny, r * nz], v * 3);
      normals.set([nx, ny, nz], v * 3);
      const h = (ny + 1) / 2; // 0 bottom .. 1 top
      region[v] = REGION_INDEX[order[Math.min(order.length - 1, Math.floor(h * order.length))]];
      v++;
    }
  }
  const indices = new Uint32Array(lon * lat * 6);
  let t = 0;
  for (let j = 0; j < lat; j++) for (let i = 0; i < lon; i++) {
    const a = j * (lon + 1) + i, b = a + lon + 1;
    indices.set([a, b, a + 1, a + 1, b, b + 1], t); t += 6;
  }
  return { positions, normals, indices, region };
}

/** A flat 1 x 1 m terrain grid, every vertex region 0 (paint reuse outside bodies). */
function grid(cells = 20): MeshData {
  const n = (cells + 1) ** 2;
  const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3);
  for (let j = 0, v = 0; j <= cells; j++) for (let i = 0; i <= cells; i++, v++) {
    positions.set([i / cells, 0, j / cells], v * 3); normals.set([0, 1, 0], v * 3);
  }
  return { positions, normals, indices: new Uint32Array(0), region: new Uint8Array(n) };
}

const base: PaintLayer = { name: "base", pattern: "solid", colour: "#808080", opacity: 1, blend: "normal", scale: 1 };

/** A layer of `kind` with params that make it land on the given meshes. */
function probeLayer(kind: typeof PATTERN_KINDS[number]): PaintLayer {
  const regions: Region[] | undefined = kind === "tattoo" ? ["torso"] : kind === "warpaint" ? ["face", "foreArm"] : undefined;
  const params: Record<string, number> = kind === "tattoo" ? { symbol: TATTOO_SYMBOLS.indexOf("sun"), project: 0 }
    : kind === "freckles" ? { density: 1, size: 0.45 } : {};
  return {
    name: kind, pattern: kind, colour: "#202020", colour2: "#e0e0e0", opacity: 1, blend: "normal",
    scale: kind === "tattoo" ? 0.08 : 0.06, seed: 7, params, regions,
  };
}

/** Count vertices whose colour differs from `ref` by more than eps in any channel. */
function changed(a: Float32Array, ref: Float32Array, eps = 1e-6): number {
  let c = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (Math.abs(a[i] - ref[i]) > eps || Math.abs(a[i + 1] - ref[i + 1]) > eps || Math.abs(a[i + 2] - ref[i + 2]) > eps) c++;
  }
  return c;
}

Deno.test("layers: output is 3 floats per vertex, finite, inside 0..1", () => {
  for (const mesh of [bandedSphere(), mannequinMesh(1.8, 24), grid()]) {
    const stack: PaintStack = { layers: [base, ...PATTERN_KINDS.map(probeLayer)] };
    const out = paintVertices(mesh, stack);
    assert(out.length === 3 * (mesh.positions.length / 3), `length ${out.length} = 3 x ${mesh.positions.length / 3}`);
    for (const v of out) assert(Number.isFinite(v) && v >= 0 && v <= 1, `channel ${v} in 0..1`);
  }
});

Deno.test("layers: deterministic per seed; a different layer seed changes a noise layer", () => {
  const mesh = bandedSphere();
  const mk = (seed: number): PaintStack => ({ layers: [base, { ...probeLayer("noise"), seed }] });
  const a = paintVertices(mesh, mk(3)), b = paintVertices(mesh, mk(3)), c = paintVertices(mesh, mk(4));
  assert(changed(a, b, 0) === 0, "same stack -> bit-identical output");
  assert(changed(a, c) > 100, "another seed -> another pattern");
});

Deno.test("layers: a region-masked layer leaves every other region untouched", () => {
  const mesh = bandedSphere();
  const without = paintVertices(mesh, { layers: [base, probeLayer("noise")] });
  const masked: PaintLayer = { name: "face-red", pattern: "solid", colour: "#c03020", opacity: 1, blend: "normal", scale: 1, regions: ["face"] };
  const withMask = paintVertices(mesh, { layers: [base, probeLayer("noise"), masked] });
  const face = REGION_INDEX.face;
  let faceHits = 0;
  for (let i = 0; i < mesh.region.length; i++) {
    const same = withMask[i * 3] === without[i * 3] && withMask[i * 3 + 1] === without[i * 3 + 1] && withMask[i * 3 + 2] === without[i * 3 + 2];
    if (mesh.region[i] === face) { assert(!same, "face vertex repainted"); faceHits++; }
    else assert(same, `non-face vertex ${i} (${REGIONS[mesh.region[i]]}) untouched`);
  }
  assert(faceHits > 0, "the sphere has face vertices");
});

Deno.test("layers: every PatternKind changes some vertices on the mannequin", () => {
  const mesh = mannequinMesh(1.8, 32);
  const ref = paintVertices(mesh, { layers: [base] });
  const total = mesh.region.length;
  const fills = new Set(["solid", "noise", "scales", "gradient"]); // these cover everything by design
  for (const kind of PATTERN_KINDS) {
    const n = changed(paintVertices(mesh, { layers: [base, probeLayer(kind)] }), ref);
    assert(n > 0, `${kind} changed ${n} vertices`);
    if (!fills.has(kind)) assert(n < total, `${kind} is a sparse pattern, not a fill (${n}/${total})`);
  }
});

Deno.test("layers: opacity 0 is a no-op; multiply by white and soft light by mid-grey are identities", () => {
  const mesh = bandedSphere(0.9, 16, 12);
  const ref = paintVertices(mesh, { layers: [base, probeLayer("noise")] });
  const noop = (l: Partial<PaintLayer>): PaintLayer => ({ ...base, name: "noop", ...l });
  for (const extra of [noop({ opacity: 0, colour: "#ff0000" }), noop({ blend: "multiply", colour: "#ffffff" }), noop({ blend: "screen", colour: "#000000" })]) {
    const out = paintVertices(mesh, { layers: [base, probeLayer("noise"), extra] });
    assert(changed(out, ref, 1e-6) === 0, `${extra.blend} ${extra.colour} @${extra.opacity} is an identity`);
  }
  const soft = paintVertices(mesh, { layers: [base, probeLayer("noise"), noop({ blend: "softLight", colour: "#808080" })] });
  assert(changed(soft, ref, 0.004) === 0, "soft light by #808080 (0.502) is an identity within 8-bit rounding");
});

Deno.test("layers: linear output = sRGB output decoded, and matches THREE.Color for a solid coat", () => {
  const mesh = bandedSphere(0.9, 8, 6);
  const stack: PaintStack = { layers: [{ ...base, colour: "#e0a884" }, probeLayer("stripes")] };
  const lin = paintVertices(mesh, stack), srgb = paintVertices(mesh, stack, { space: "srgb" });
  for (let i = 0; i < lin.length; i++) assert(Math.abs(lin[i] - srgbToLinear(srgb[i])) < 1e-6, "linear = decode(srgb)");
  const solid = paintVertices(mesh, { layers: [{ ...base, colour: "#e0a884" }] });
  const three = new THREE.Color("#e0a884");
  assert(Math.abs(solid[0] - three.r) < 1e-6 && Math.abs(solid[1] - three.g) < 1e-6 && Math.abs(solid[2] - three.b) < 1e-6,
    "a solid coat lands exactly where THREE.Color(hex) would (linear working space)");
});

Deno.test("layers: options.out is reused and options.env gives the same result", () => {
  const mesh = mannequinMesh(1.8, 16);
  const stack: PaintStack = { layers: [base, probeLayer("warpaint"), probeLayer("tattoo")] };
  const buf = new Float32Array(mesh.positions.length);
  const out = paintVertices(mesh, stack, { out: buf });
  assert(out === buf, "the caller's buffer is returned");
  const again = paintVertices(mesh, stack, { env: buildPatternEnv(mesh) });
  assert(changed(out, again, 0) === 0, "a precomputed env changes nothing");
});

Deno.test("layers: paint works on a region-less terrain grid (reuse beyond bodies)", () => {
  const mesh = grid();
  const out = paintVertices(mesh, { layers: [{ ...base, colour: "#6a7a4a" }, { ...probeLayer("spots"), regions: undefined }] });
  const ref = paintVertices(mesh, { layers: [{ ...base, colour: "#6a7a4a" }] });
  assert(changed(out, ref) > 0, "spots land on the terrain");
});
