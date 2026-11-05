// Wave TEX lane L: the v2 layer engine (Channels, LayerStack, MaskAlgebra, Evaluate). v1 byte identity
// (stackFromV1 vs paintVertices on every recipe and on real bodies), multi-channel writes, groups
// (isolation, associativity of normal-over), order/overrides, the mask algebra laws (fuzzed >= 2000
// cases), feather/grow measured in millimetres on a grid, fragment hand-off, determinism and the
// evaluation cost of a 12-layer stack on a ~10 k-vertex body.
// WAVE_TEX_WRITE_DOC=1 regenerates the generated tables of docs/wave-tex/LAYERS.md from this run.
import { rng32 } from "../src/core/MathCore.ts";
import { BIRTHSIGNS } from "../src/game/Birthsight.ts";
import { RACES } from "../src/game/Races.ts";
import { CLASSES } from "../src/game/Stats.ts";
import { generateBody } from "../src/graphics/body/BodyMesh.ts";
import { type BodySpec, type MeshData, type PaintStack, REGIONS, type Region } from "../src/graphics/body/contracts.ts";
import { BASE_CHANNELS, CHANNEL_SPECS, channelSpec, isChannelId, MATERIAL_LAYOUT } from "../src/graphics/paint/Channels.ts";
import { evaluateStack } from "../src/graphics/paint/Evaluate.ts";
import { paintVertices } from "../src/graphics/paint/Layers.ts";
import {
  applyLayerOverrides, channelsWritten, type Layer, type LayerStackV2, sortedNodes, stackFromV1, type StackNode, validateStack,
} from "../src/graphics/paint/LayerStack.ts";
import { mannequinMesh } from "../src/graphics/paint/Mannequin.ts";
import { evaluateMask, MASK_COMBINATORS, MASK_SOURCES, type MaskExpr, MeshFields } from "../src/graphics/paint/MaskAlgebra.ts";
import { COLOR_BLEND_MODES, OPERATOR_DOCS, SCALAR_OPS } from "../src/graphics/paint/Operators.ts";
import { buildPatternEnv, PATTERN_KINDS } from "../src/graphics/paint/Patterns.ts";
import { type PaintSubject, stackFor } from "../src/graphics/paint/Recipes.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }
const FUZZ = 2000;
const sameBits = (a: Float32Array, b: Float32Array) => {
  if (a.length !== b.length) return false;
  const ua = new Uint32Array(a.buffer, a.byteOffset, a.length), ub = new Uint32Array(b.buffer, b.byteOffset, b.length);
  for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) return false;
  return true;
};

/** A flat (cells+1)^2 grid in the xz plane, spacing `h` metres, normal +y, every vertex region torso. */
function grid(cells: number, h: number): MeshData {
  const n = (cells + 1) ** 2;
  const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3), region = new Uint8Array(n);
  for (let j = 0, v = 0; j <= cells; j++) for (let i = 0; i <= cells; i++, v++) {
    positions[v * 3] = i * h; positions[v * 3 + 2] = j * h; normals[v * 3 + 1] = 1;
  }
  const indices = new Uint32Array(cells * cells * 6);
  let t = 0;
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    const a = j * (cells + 1) + i, b = a + cells + 1;
    indices.set([a, b, a + 1, a + 1, b, b + 1], t); t += 6;
  }
  return { positions, normals, indices, region };
}

const mannequin = mannequinMesh(1.8, 24);
const mannequinEnv = buildPatternEnv(mannequin);
const SPECS: BodySpec[] = [
  { race: "human", subrace: null, className: "Warrior", height: 1.76, weight: 76, seed: 7, sex: "male" },
  { race: "elf", subrace: null, className: "Mage", height: 1.84, weight: 62, seed: 11, sex: "female" },
  { race: "dwarf", subrace: null, className: "Priest", height: 1.38, weight: 80, seed: 5, sex: "male" },
  { race: "ork", subrace: null, className: "Rogue", height: 1.9, weight: 98, seed: 3, sex: "female" },
];
const bodies = SPECS.map((s) => ({ spec: s, mesh: generateBody(s).mesh }));

/** Every (race, subrace, sign) recipe, classes cycled (the paint_recipes_test matrix). */
function recipeMatrix(): PaintSubject[] {
  const out: PaintSubject[] = [];
  let n = 0;
  for (const race of RACES) for (const subrace of [null, ...race.subspecies.map((s) => s.id)]) {
    for (const birthsign of [...BIRTHSIGNS.map((b) => b.id), null]) {
      out.push({ race: race.id, subrace, birthsign, className: CLASSES[n % CLASSES.length], accent: "#9b72cf", seed: 9000 + n, garment: n % 3 === 0 ? "#4f6f8a" : undefined });
      n++;
    }
  }
  return out;
}

Deno.test("TX11 channels: every channel declares range/default/neutral/storage; aMaterial layout; mask ids", () => {
  for (const id of BASE_CHANNELS) {
    const s = CHANNEL_SPECS[id];
    assert(s.range[0] <= s.range[1] && s.attribute && (s.storage === "vertex" || s.storage.includes("fragment")), id);
    const inRange = (v: number) => v >= s.range[0] && v <= s.range[1];
    for (const v of [s.default, s.neutral].flatMap((x) => typeof x === "number" ? [x] : [...x])) assert(inRange(v), `${id} default/neutral in range`);
  }
  assert(MATERIAL_LAYOUT.join() === "roughness,height,ao,subsurface", "aMaterial layout");
  MATERIAL_LAYOUT.forEach((c, i) => assert(CHANNEL_SPECS[c].attribute === "aMaterial" && CHANNEL_SPECS[c].component === i, c));
  assert(isChannelId("mask:scar") && !isChannelId("mask:") && !isChannelId("mask:a b") && !isChannelId("gloss"), "mask ids");
  assert(channelSpec("mask:hairless").range[1] === 1, "mask spec");
});

Deno.test("TX12 v1 adapter: evaluateStack(stackFromV1(s)).albedo is BYTE-identical to paintVertices(s) for every recipe (mannequin) + 4 real bodies, linear and sRGB, custom background", () => {
  let stacks = 0, vertices = 0;
  const check = (mesh: MeshData, stack: PaintStack, env = buildPatternEnv(mesh), fields = new MeshFields(mesh, { env })) => {
    for (const space of ["linear", "srgb"] as const) {
      const ref = paintVertices(mesh, stack, { env, space });
      const v2 = evaluateStack(mesh, stackFromV1(stack), { fields, space }).albedo;
      assert(sameBits(ref, v2), `byte mismatch (${space}) on ${stack.layers.map((l) => l.name).join("/")}`);
    }
    stacks++; vertices += mesh.positions.length / 3;
  };
  const fields = new MeshFields(mannequin, { env: mannequinEnv });
  for (const subject of recipeMatrix()) check(mannequin, stackFor(subject), mannequinEnv, fields);
  for (const b of bodies) {
    const env = buildPatternEnv(b.mesh), f = new MeshFields(b.mesh, { env });
    for (let k = 0; k < 3; k++) {
      check(b.mesh, stackFor({ race: b.spec.race, subrace: null, className: b.spec.className, seed: 100 + k, birthsign: BIRTHSIGNS[k].id, garment: k === 1 ? "#4f6f8a" : undefined }), env, f);
    }
  }
  // Every v1 pattern and blend mode, a custom background, and an empty stack.
  const modes = ["normal", "multiply", "screen", "overlay", "softLight", "add"] as const;
  const all: PaintStack = { layers: PATTERN_KINDS.map((p, i) => ({ name: p, pattern: p, colour: "#a05030", colour2: "#305080", opacity: 0.3 + 0.07 * i, blend: modes[i % 6], scale: 0.05 + 0.01 * i, seed: i * 7, regions: i % 3 === 0 ? ["torso", "face"] as Region[] : undefined })) };
  check(mannequin, all, mannequinEnv, fields);
  const ref = paintVertices(mannequin, all, { env: mannequinEnv, background: "#203040" });
  assert(sameBits(ref, evaluateStack(mannequin, stackFromV1(all), { fields, background: "#203040" }).albedo), "background option");
  assert(sameBits(ref, evaluateStack(mannequin, stackFromV1(all, "#203040"), { fields }).albedo), "stack background");
  assert(sameBits(paintVertices(mannequin, { layers: [] }), evaluateStack(mannequin, stackFromV1({ layers: [] }), { fields }).albedo), "empty stack");
  console.log(`v1 byte identity: ${stacks} stacks, ${vertices} vertices x 2 spaces`);
  assert(stacks > 100, "the matrix is live");
});

Deno.test("TX13 evaluate: an albedo-only stack leaves aMaterial at R's neutral (0.5, 0, 1, 0), no emissive, no masks", () => {
  const b = bodies[0];
  const r = evaluateStack(b.mesh, stackFromV1(stackFor({ race: "human", seed: 1 })));
  const n = b.mesh.positions.length / 3;
  for (let i = 0; i < n; i++) {
    assert(r.material[i * 4] === 0.5 && r.material[i * 4 + 1] === 0 && r.material[i * 4 + 2] === 1 && r.material[i * 4 + 3] === 0, "neutral");
  }
  assert(r.emissive === undefined && Object.keys(r.masks).length === 0 && r.written.join() === "albedo" && r.fragment.length === 0, "only albedo");
});

/** A scar-like multi-channel layer: darker+pinker albedo, glossier, raised, with a hairless mask. */
function scarLayer(id = "scar", mask?: MaskExpr): Layer {
  return {
    kind: "layer", id, name: "scar", enabled: true, opacity: 1, source: { kind: "constant", value: 1 },
    mask: mask ?? { op: "distance", anchor: { region: "foreArm", side: 0 }, radius: 0.07, falloff: 0.02 },
    writes: [
      { channel: "albedo", op: "multiply", colour: "#d8b0b0" },
      { channel: "roughness", op: "replace", value: 0.2 },
      { channel: "height", op: "heightBlend", value: 0.0015, params: [0.0003] },
      { channel: "mask:hairless", op: "max", value: 1 },
    ],
  };
}

Deno.test("TX14 evaluate: one layer writes albedo + roughness + height + a named mask at once, only inside its mask", () => {
  const b = bodies[0];
  const fields = new MeshFields(b.mesh);
  const base = stackFromV1(stackFor({ race: "human", seed: 1 }));
  const plain = evaluateStack(b.mesh, base, { fields });
  const scarred = evaluateStack(b.mesh, { ...base, nodes: [...base.nodes, scarLayer()] }, { fields });
  const m = evaluateMask(scarLayer().mask!, { fields });
  let inside = 0, outsideChanged = 0;
  const n = b.mesh.positions.length / 3;
  for (let i = 0; i < n; i++) {
    const changed = [0, 1, 2].some((k) => scarred.albedo[i * 3 + k] !== plain.albedo[i * 3 + k]);
    if (m[i] === 1) {
      inside++;
      assert(scarred.material[i * 4] === Math.fround(0.2) && Math.abs(scarred.material[i * 4 + 1] - 0.0015) < 1e-9 && scarred.masks.hairless[i] === 1, "scar channels");
      assert(scarred.albedo[i * 3 + 1] < plain.albedo[i * 3 + 1], "multiply darkens");
    } else if (m[i] === 0) {
      if (changed || scarred.material[i * 4] !== 0.5 || scarred.material[i * 4 + 1] !== 0 || scarred.masks.hairless[i] !== 0) outsideChanged++;
    }
  }
  assert(inside > 3 && outsideChanged === 0, `inside ${inside}, outside changed ${outsideChanged}`);
  assert(scarred.written.join() === "albedo,roughness,height,mask:hairless", scarred.written.join());
});

Deno.test("TX15 groups: normal-over is associative (group of normal layers == flat stack), opacity 0 / disabled are no-ops, isolation changes a multiply group", () => {
  const mesh = bodies[1].mesh, fields = new MeshFields(mesh);
  const r = rng32(5);
  const layer = (i: number, op: "normal" | "multiply" = "normal"): Layer => ({
    kind: "layer", id: `l${i}`, name: `l${i}`, enabled: true, opacity: 0.2 + 0.7 * r(),
    source: { kind: "pattern", pattern: PATTERN_KINDS[i % PATTERN_KINDS.length], scale: 0.04 + 0.03 * r(), seed: i },
    writes: [{ channel: "albedo", op, colour: `#${Math.floor(r() * 0xffffff).toString(16).padStart(6, "0")}`, colour2: "#c0a080" },
      { channel: "roughness", op: "replace", value: r(), value2: r() }, { channel: "height", op: "replace", value: 0.002 * r() }],
  });
  let worst = 0;
  for (let trial = 0; trial < 6; trial++) {
    const ls = [0, 1, 2, 3, 4].map((i) => layer(trial * 5 + i));
    const flat: LayerStackV2 = { version: 2, nodes: ls };
    const grouped: LayerStackV2 = { version: 2, nodes: [ls[0], { kind: "group", id: "g", name: "g", enabled: true, opacity: 1, children: [ls[1], { kind: "group", id: "g2", name: "g2", enabled: true, opacity: 1, children: [ls[2], ls[3]] }, ls[4]] }] };
    const a = evaluateStack(mesh, flat, { fields }), b = evaluateStack(mesh, grouped, { fields });
    for (let i = 0; i < a.albedo.length; i++) worst = Math.max(worst, Math.abs(a.albedo[i] - b.albedo[i]));
    for (let i = 0; i < a.material.length; i++) worst = Math.max(worst, Math.abs(a.material[i] - b.material[i]) / (i % 4 === 1 ? 0.008 : 1));
  }
  assert(worst < 2e-6, `group vs flat ${worst}`);
  const base = { version: 2 as const, nodes: [layer(1)] };
  const ref = evaluateStack(mesh, base, { fields });
  for (const g of [{ opacity: 0, enabled: true }, { opacity: 1, enabled: false }]) {
    const s: LayerStackV2 = { version: 2, nodes: [layer(1), { kind: "group", id: "x", name: "x", ...g, children: [layer(2), layer(3)] }] };
    // Same rng stream for layer(1) is not guaranteed: rebuild the reference from the same node.
    const sref: LayerStackV2 = { version: 2, nodes: [s.nodes[0]] };
    assert(sameBits(evaluateStack(mesh, s, { fields }).albedo, evaluateStack(mesh, sref, { fields }).albedo), `no-op group ${JSON.stringify(g)}`);
  }
  assert(ref.albedo.length > 0, "live");
  // Isolation: a multiply child over a normal child inside a group differs from multiply onto the canvas.
  const n1 = layer(40), m1 = layer(41, "multiply");
  const flat2 = evaluateStack(mesh, { version: 2, nodes: [layer(42), n1, m1] }, { fields });
  const iso = evaluateStack(mesh, { version: 2, nodes: [layer(42), { kind: "group", id: "g", name: "g", enabled: true, opacity: 1, children: [n1, m1] }] }, { fields });
  let diff = 0;
  for (let i = 0; i < flat2.albedo.length; i++) diff = Math.max(diff, Math.abs(flat2.albedo[i] - iso.albedo[i]));
  assert(diff > 1e-3, `isolation is observable (${diff})`);
});

Deno.test("TX16 stack: order sort, enable/opacity, applyLayerOverrides (U's shape: id, enabled, opacity, blend per channel, order) is total and pure", () => {
  const mk = (id: string, order?: number): StackNode => ({ kind: "layer", id, name: id, enabled: true, opacity: 1, order, source: { kind: "constant", value: 1 }, writes: [{ channel: "albedo", op: "normal", colour: "#ff0000" }] });
  assert(sortedNodes([mk("a", 2), mk("b"), mk("c", 0)]).map((n) => n.id).join() === "c,b,a", "order ?? index, stable");
  const s: LayerStackV2 = { version: 2, nodes: [mk("a"), mk("b"), mk("c"), { kind: "group", id: "g", name: "g", enabled: true, opacity: 1, children: [mk("d"), mk("e")] }] };
  const before = JSON.stringify(s);
  const o = applyLayerOverrides(s, [{ id: "c", order: 0 }, { id: "b", enabled: false }, { id: "a", opacity: 7 }, { id: "e", order: 0, blend: { albedo: "luminosity" } }, { id: "zz", opacity: 0 }, { id: "g", blend: { roughness: "min" }, opacity: NaN }]);
  assert(JSON.stringify(s) === before, "input untouched");
  const ids = sortedNodes(o.nodes).map((n) => n.id).join();
  assert(ids === "c,a,b,g", ids);
  const g = o.nodes.find((n) => n.id === "g")!;
  assert(g.kind === "group" && sortedNodes(g.children).map((n) => n.id).join() === "e,d" && g.blend?.roughness === "min" && g.opacity === 1, "group overrides");
  const e = g.kind === "group" ? g.children.find((n) => n.id === "e") as Layer : null;
  assert(e?.writes[0].op === "luminosity", "blend override");
  assert(o.nodes.find((n) => n.id === "a")!.opacity === 1 && o.nodes.find((n) => n.id === "b")!.enabled === false, "clamped / disabled");
  // Move down as well.
  const down = applyLayerOverrides(s, [{ id: "a", order: 2 }]);
  assert(sortedNodes(down.nodes).map((n) => n.id).join() === "b,c,a,g", "move down");
  assert(applyLayerOverrides(s, undefined).nodes.length === 4, "no overrides");
  // The disabled layer really drops out of evaluation.
  const m = grid(4, 0.01);
  const r = evaluateStack(m, { version: 2, nodes: [mk("a"), { ...mk("b"), enabled: false, writes: [{ channel: "albedo", op: "normal", colour: "#00ff00" }] } as Layer] }, { space: "srgb" });
  assert(r.albedo[0] === 1 && r.albedo[1] === 0, "disabled layer skipped");
  assert(validateStack(s).length === 0 && validateStack({ version: 2, nodes: [mk("a"), mk("a")] }).length === 1, "validate dup");
  assert(validateStack({ version: 2, nodes: [{ ...mk("q"), writes: [{ channel: "roughness", op: "hue" }] } as Layer] }).length === 1, "validate op/channel");
  assert(channelsWritten(s).join() === "albedo", "channelsWritten");
});

/** Random mask expression trees over the sources available on any mesh. */
function randomMask(r: () => number, depth: number): MaskExpr {
  const leaves: (() => MaskExpr)[] = [
    () => ({ op: "constant", value: r() * 1.4 - 0.2 }),
    () => ({ op: "region", regions: [REGIONS[Math.floor(r() * REGIONS.length)]], side: r() < 0.3 ? "left" : undefined }),
    () => ({ op: "curvature", sign: r() < 0.5 ? "convex" : "concave" }),
    () => ({ op: "ao" }),
    () => ({ op: "height", lo: r() * 0.5, hi: 0.5 + r() * 0.5 }),
    () => ({ op: "noise", expr: { op: "fbm", scale: 0.05 + r() * 0.2, octaves: 3 }, seed: Math.floor(r() * 99) }),
    () => ({ op: "pattern", pattern: PATTERN_KINDS[Math.floor(r() * PATTERN_KINDS.length)], scale: 0.03 + r() * 0.1, seed: 3, field: (["coverage", "mix", "product"] as const)[Math.floor(r() * 3)] }),
    () => ({ op: "direction", dir: [r() - 0.5, r() - 0.5, r() - 0.5] }),
    () => ({ op: "distance", anchor: [r() * 0.4 - 0.2, r() * 1.8, r() * 0.2], radius: r() * 0.3, falloff: r() * 0.1 }),
    () => ({ op: "mark", id: r() < 0.5 ? "m" : "missing" }),
    () => ({ op: "channel", channel: "roughness" }),
  ];
  if (depth <= 0 || r() < 0.3) return leaves[Math.floor(r() * leaves.length)]();
  const a = () => randomMask(r, depth - 1);
  const k = Math.floor(r() * 12);
  switch (k) {
    case 0: return { op: "and", a: a(), b: a(), mode: r() < 0.5 ? "min" : "product" };
    case 1: return { op: "or", a: a(), b: a(), mode: r() < 0.5 ? "max" : "sum" };
    case 2: return { op: "xor", a: a(), b: a() };
    case 3: return { op: "subtract", a: a(), b: a() };
    case 4: return { op: "invert", a: a() };
    case 5: return { op: "feather", a: a(), radiusMm: r() * 60 };
    case 6: return { op: "grow", a: a(), mm: r() * 60 - 30 };
    case 7: return { op: "shrink", a: a(), mm: r() * 30 };
    case 8: return { op: "remap", a: a(), lo: r() * 0.5, hi: r() < 0.1 ? 0.25 : 0.5 + r() * 0.5 };
    case 9: return { op: "threshold", a: a(), level: r(), softness: r() * 0.2 };
    case 10: return { op: "scale", a: a(), k: r() * 3 - 0.5 };
    default: return { op: "mix", a: a(), b: a(), t: a() };
  }
}

Deno.test(`TX17 masks: every source and combinator is closed on [0,1], never NaN, deterministic (${FUZZ} random trees on a real body)`, () => {
  const mesh = bodies[2].mesh, fields = new MeshFields(mesh);
  const ctx = { fields, marks: { m: (x: number, y: number) => (y > 1 ? 1 : x * 1e9) }, channel: () => NaN };
  const r = rng32(77);
  const used = new Set<string>();
  const walk = (e: MaskExpr) => { used.add(e.op); for (const k of ["a", "b", "t"] as const) { const c = (e as Record<string, unknown>)[k]; if (c) walk(c as MaskExpr); } };
  for (let k = 0; k < FUZZ; k++) {
    const e = randomMask(r, 2);
    walk(e);
    const out = evaluateMask(e, ctx);
    for (let i = 0; i < out.length; i++) assert(out[i] >= 0 && out[i] <= 1, `${JSON.stringify(e)} -> ${out[i]}`);
    if (k % 50 === 0) assert(sameBits(out, evaluateMask(e, ctx)), "deterministic");
  }
  for (const op of [...MASK_SOURCES, ...MASK_COMBINATORS]) assert(used.has(op), `fuzz never used ${op}`);
});

Deno.test(`TX18 masks: algebra laws hold pointwise (${FUZZ} random pairs): and/or identities, De Morgan, invert involution, xor/subtract, commutativity`, () => {
  const mesh = mannequin, fields = new MeshFields(mesh, { env: mannequinEnv });
  const r = rng32(78);
  const ctx = { fields };
  const one: MaskExpr = { op: "constant", value: 1 }, zero: MaskExpr = { op: "constant", value: 0 };
  let worst = 0;
  const cmp = (x: MaskExpr, y: MaskExpr) => { const a = evaluateMask(x, ctx), b = evaluateMask(y, ctx); for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i])); };
  for (let k = 0; k < FUZZ; k++) {
    // Pointwise laws: cheap leaves only (no feather/grow) so 2000 pairs run fast.
    const leaf = (): MaskExpr => randomMask(() => Math.min(0.999, r() * (r() < 0.5 ? 1 : 0.6)), 0);
    const a = leaf(), b = leaf();
    switch (k % 10) {
      case 0: cmp({ op: "and", a, b: one }, a); break;
      case 1: cmp({ op: "or", a, b: zero }, a); break;
      case 2: cmp({ op: "invert", a: { op: "and", a, b } }, { op: "or", a: { op: "invert", a }, b: { op: "invert", a: b } }); break;
      case 3: cmp({ op: "invert", a: { op: "invert", a } }, a); break;
      case 4: cmp({ op: "and", a, b }, { op: "and", a: b, b: a }); cmp({ op: "or", a, b, mode: "sum" }, { op: "or", a: b, b: a, mode: "sum" }); break;
      case 5: cmp({ op: "xor", a, b: zero }, a); cmp({ op: "xor", a, b }, { op: "xor", a: b, b: a }); break;
      case 6: cmp({ op: "subtract", a, b: zero }, a); cmp({ op: "subtract", a, b: one }, zero); break;
      case 7: cmp({ op: "or", a, b, mode: "sum" }, { op: "invert", a: { op: "and", a: { op: "invert", a }, b: { op: "invert", a: b }, mode: "product" } }); break;
      case 8: cmp({ op: "feather", a, radiusMm: 0 }, a); cmp({ op: "grow", a, mm: 0 }, a); break;
      default: cmp({ op: "mix", a, b, t: zero }, a); cmp({ op: "mix", a, b, t: one }, b);
    }
  }
  assert(worst < 1e-6, `law error ${worst}`);
});

Deno.test("TX19 masks: feather is a Gaussian of sigma = radius/2 in mm on the surface; grow/shrink move a boundary by the asked mm (grid 1 mm)", () => {
  const cells = 120, h = 0.001, m = grid(cells, h), fields = new MeshFields(m);
  const n = (cells + 1) ** 2;
  // Step edge at x = 60 mm: feather 20 mm -> sigma 10 mm -> 10-90 % width 2.563 sigma = 25.6 mm.
  const step: MaskExpr = { op: "distance", anchor: [-1, 0, 0], radius: 1.0605, falloff: 0 }; // x < 60.5 mm -> 1
  const f = evaluateMask({ op: "feather", a: step, radiusMm: 20 }, { fields });
  const row = 60 * (cells + 1);
  const xAt = (level: number) => { for (let i = 0; i < cells; i++) { const a = f[row + i], b = f[row + i + 1]; if (a >= level && b < level) return (i + (a - level) / (a - b)) * 1000 * h; } return NaN; };
  const width = xAt(0.1) - xAt(0.9);
  assert(Math.abs(width - 25.63) < 2.0, `feather 20 mm: 10-90 % width ${width.toFixed(2)} mm (Gaussian 25.63)`);
  let mass0 = 0, mass1 = 0;
  const s0 = evaluateMask(step, { fields });
  for (let i = 0; i < n; i++) { mass0 += s0[i]; mass1 += f[i]; }
  assert(Math.abs(mass1 - mass0) / mass0 < 0.02, "feather (nearly) conserves mass");
  // Grow 15 mm: the 0.5 contour moves from 60.5 mm to ~75.5-76.5 mm along the row; shrink 15 mm -> ~45.5 mm.
  const contour = (u: Float32Array) => { for (let i = 0; i < cells; i++) if (u[row + i] >= 0.5 && u[row + i + 1] < 0.5) return (i + (u[row + i] - 0.5) / (u[row + i] - u[row + i + 1])) * 1000 * h; return NaN; };
  const c0 = contour(s0), cg = contour(evaluateMask({ op: "grow", a: step, mm: 15 }, { fields })), cs = contour(evaluateMask({ op: "shrink", a: step, mm: 15 }, { fields }));
  assert(Math.abs(cg - c0 - 15) <= 1.5 && Math.abs(c0 - cs - 15) <= 1.5, `grow ${cg - c0} / shrink ${c0 - cs} mm (want 15)`);
  // grow(-x) == shrink(x); grow is extensive, shrink anti-extensive.
  const g = evaluateMask({ op: "grow", a: step, mm: 8 }, { fields }), sh = evaluateMask({ op: "shrink", a: step, mm: 8 }, { fields });
  assert(sameBits(evaluateMask({ op: "grow", a: step, mm: -8 }, { fields }), sh), "grow(-x) = shrink(x)");
  for (let i = 0; i < n; i++) assert(g[i] >= s0[i] && sh[i] <= s0[i], "extensive / anti-extensive");
  // Continuity at 0 on a SOFT mask (QC MSK-3): grow/shrink 0.01 mm move no vertex by more than 0.01.
  const soft: MaskExpr = { op: "noise", expr: { op: "fbm", scale: 0.02, octaves: 3 }, seed: 5 };
  const s1 = evaluateMask(soft, { fields });
  for (const op of ["grow", "shrink"] as const) {
    const t = evaluateMask({ op, a: soft, mm: 0.01 }, { fields });
    let jump = 0;
    for (let i = 0; i < n; i++) jump = Math.max(jump, Math.abs(t[i] - s1[i]));
    assert(jump <= 0.01 + 1e-6, `${op} 0.01 mm on a soft mask moves a value by ${jump}`);
    // Grey dilation is monotone in the mask: a dimmer mask never grows brighter.
    const dim = evaluateMask({ op, a: { op: "scale", a: soft, k: 0.5 }, mm: 6 }, { fields }), full = evaluateMask({ op, a: soft, mm: 6 }, { fields });
    for (let i = 0; i < n; i++) assert(dim[i] <= full[i] + 1e-7, `${op} monotone in u`);
  }
  console.log(`feather 20 mm -> 10-90 % ${width.toFixed(2)} mm (Gaussian 25.63); grow 15 -> ${(cg - c0).toFixed(2)} mm; shrink 15 -> ${(c0 - cs).toFixed(2)} mm`);
});

Deno.test("TX20 masks: sources mean what they say on a real body (up-facing = +y normals, region side, mark field, distance anchor, body height)", () => {
  const mesh = bodies[0].mesh, fields = new MeshFields(mesh), N = mesh.normals, P = mesh.positions, n = mesh.positions.length / 3;
  const up = evaluateMask({ op: "direction", dir: [0, 1, 0], lo: 0.5, hi: 0.9 }, { fields });
  for (let i = 0; i < n; i++) assert((N[i * 3 + 1] < 0.5 ? up[i] === 0 : true) && (N[i * 3 + 1] > 0.9 ? up[i] === 1 : true), "direction");
  const left = evaluateMask({ op: "region", regions: ["hand"], side: "left" }, { fields }), both = evaluateMask({ op: "region", regions: ["hand"] }, { fields });
  let l = 0, b = 0;
  for (let i = 0; i < n; i++) { l += left[i]; b += both[i]; if (left[i]) assert(P[i * 3] >= fields.env.core[0], "left = +x"); }
  assert(l > 0 && l < b, "one side");
  const mk = evaluateMask({ op: "mark", id: "m" }, { fields, marks: { m: (_x, y) => (y > 1.5 ? 1 : 0) } });
  for (let i = 0; i < n; i++) assert(mk[i] === (P[i * 3 + 1] > 1.5 ? 1 : 0), "mark");
  const hb = evaluateMask({ op: "height", lo: 0.9, hi: 0.9 }, { fields });
  let top = 0; for (let i = 0; i < n; i++) top += hb[i];
  assert(top > 0 && top < n * 0.2, "top 10 % of stature");
  const cvx = evaluateMask({ op: "curvature", sign: "convex" }, { fields }), ccv = evaluateMask({ op: "curvature", sign: "concave" }, { fields });
  for (let i = 0; i < n; i++) assert(!(cvx[i] > 0 && ccv[i] > 0), "convex and concave are disjoint");
});

Deno.test("TX24 evaluate: total on hostile JSON (unknown mask channel, unknown write channel/op/source/pattern, NaN opacity, bad colours) — QC STK-2", () => {
  const m = grid(6, 0.01);
  const bad = {
    version: 2, background: "#zzzzzz",
    nodes: [
      { kind: "layer", id: "a", name: "a", enabled: true, opacity: NaN, source: { kind: "constant", value: 1 }, writes: [{ channel: "albedo", op: "normal", colour: "#ff0000" }] },
      { kind: "layer", id: "b", name: "b", enabled: true, opacity: 1, source: { kind: "nope" }, mask: { op: "channel", channel: "bogus" }, writes: [{ channel: "bogus", op: "hue" }, { channel: "roughness", op: "nope", value: NaN }] },
      { kind: "layer", id: "c", name: "c", enabled: true, opacity: 1, source: { kind: "pattern", pattern: "nope", scale: -1 }, mask: { op: "and", a: { op: "channel", channel: "mask:" }, b: { op: "height", source: "channel", lo: 0, hi: 0 } }, writes: [{ channel: "albedo", op: "multiply", colour: "garbage" }] },
    ],
  } as unknown as LayerStackV2;
  const r = evaluateStack(m, bad);
  for (const arr of [r.albedo, r.material]) for (const v of arr) assert(Number.isFinite(v), "finite");
});

Deno.test("TX21 evaluate: stage 'fragment' layers skip the vertex pass and reach the fragment list with their group opacity; mark sources read M's field", () => {
  const mesh = bodies[3].mesh;
  const tat: Layer = { kind: "layer", id: "tattoo-1", name: "tattoo", enabled: true, opacity: 0.8, stage: "fragment", source: { kind: "mark", id: "t1" }, writes: [{ channel: "albedo", op: "multiply", colour: "#202a40" }] };
  const scar: Layer = { ...scarLayer("scar-v"), source: { kind: "mark", id: "s1" }, mask: undefined };
  const s: LayerStackV2 = { version: 2, nodes: [{ kind: "group", id: "marks", name: "marks", enabled: true, opacity: 0.5, children: [tat, scar] }] };
  const marks = { s1: (_x: number, y: number) => (y > 1.2 && y < 1.3 ? 1 : 0) };
  const r = evaluateStack(mesh, s, { marks, space: "srgb" });
  assert(r.fragment.length === 1 && r.fragment[0].id === "tattoo-1" && r.fragment[0].markId === "t1" && Math.abs(r.fragment[0].opacity - 0.4) < 1e-12 && r.fragment[0].path.join() === "marks", JSON.stringify(r.fragment));
  const P = mesh.positions, n = P.length / 3;
  for (let i = 0; i < n; i++) {
    const inMark = P[i * 3 + 1] > 1.2 && P[i * 3 + 1] < 1.3;
    if (inMark) assert(Math.abs(r.material[i * 4] - (0.5 + (0.2 - 0.5) * 0.5)) < 1e-6, `scar roughness through a 50 % group: ${r.material[i * 4]}`);
    else assert(r.material[i * 4] === 0.5 && r.albedo[i * 3] === Math.fround(128 / 255), "untouched outside the mark");
  }
});

/** A 12-layer production-like stack: 9 vertex layers (patterns, noise, fields, masks with feather), a group, 2 fragment marks. */
function twelveLayerStack(base: PaintStack): LayerStackV2 {
  const v1 = stackFromV1({ layers: base.layers.slice(0, 4) }).nodes;
  const nodes: StackNode[] = [
    ...v1,
    { kind: "layer", id: "rough", name: "skin roughness", enabled: true, opacity: 1, source: { kind: "noise", expr: { op: "fbm", scale: 0.04, octaves: 4 }, seed: 3 }, writes: [{ channel: "roughness", op: "replace", value: 0.45, value2: 0.65 }] },
    { kind: "layer", id: "pores", name: "pores", enabled: true, opacity: 1, source: { kind: "noise", expr: { op: "worley", feature: "f1", scale: 0.01 }, seed: 4 }, writes: [{ channel: "height", op: "add", value: -0.0002, value2: 0.0001 }] },
    { kind: "layer", id: "wash", name: "cavity wash", enabled: true, opacity: 0.6, source: { kind: "field", field: "cavity" }, writes: [{ channel: "albedo", op: "multiply", colour: "#ffffff", colour2: "#6a5040" }, { channel: "ao", op: "multiply", value: 1, value2: 0.6 }] },
    { kind: "layer", id: "edge", name: "edge highlight", enabled: true, opacity: 0.5, source: { kind: "field", field: "convex" }, writes: [{ channel: "albedo", op: "screen", colour: "#000000", colour2: "#a09080" }] },
    { kind: "layer", id: "ears", name: "thin skin", enabled: true, opacity: 1, source: { kind: "constant", value: 1 }, regions: ["ear", "face"], writes: [{ channel: "subsurface", op: "max", value: 0.6 }] },
    { kind: "group", id: "garment", name: "garment", enabled: true, opacity: 1, mask: { op: "feather", a: { op: "region", regions: ["torso", "pelvis", "thigh"] }, radiusMm: 30 }, children: [
      { kind: "layer", id: "cloth", name: "wool", enabled: true, opacity: 1, source: { kind: "pattern", pattern: "noise", scale: 0.05, seed: 9 }, writes: [{ channel: "albedo", op: "normal", colour: "#4f6f8a", colour2: "#3a5468" }, { channel: "roughness", op: "replace", value: 0.85 }] },
      { kind: "layer", id: "wear", name: "edge wear", enabled: true, opacity: 0.7, source: { kind: "field", field: "convex" }, mask: { op: "and", a: { op: "noise", expr: { op: "fbm", scale: 0.08 }, seed: 2 }, b: { op: "direction", dir: [0, -1, 0], lo: -0.5, hi: 0.5 } }, writes: [{ channel: "albedo", op: "lighten", colour: "#7d93a6" }] },
    ] },
    scarLayer("scar"),
    { kind: "layer", id: "rune", name: "rune", enabled: true, opacity: 1, stage: "fragment", source: { kind: "mark", id: "rune" }, writes: [{ channel: "emissive", op: "add", colour: "#40a0ff" }] },
    { kind: "layer", id: "tattoo", name: "tattoo", enabled: true, opacity: 1, stage: "fragment", source: { kind: "mark", id: "tattoo" }, writes: [{ channel: "albedo", op: "multiply", colour: "#202a40" }] },
  ];
  return { version: 2, nodes };
}

Deno.test("TX22 perf: 12-layer stack on a ~10 k-vertex body (median of 5, fields cached and cold) + v1 vs v2 overhead", () => {
  const spec = SPECS[0];
  const mesh = generateBody(spec, 0.0165).mesh, n = mesh.positions.length / 3;
  const v1 = stackFor({ race: "human", seed: 4, garment: "#4f6f8a" });
  const st = twelveLayerStack(v1);
  assert(validateStack(st).length === 0, validateStack(st).join());
  const fields = new MeshFields(mesh);
  const t0 = performance.now(); evaluateStack(mesh, st, { fields }); const cold = performance.now() - t0;
  const runs: number[] = [];
  for (let k = 0; k < 5; k++) { const rec: { ms?: number } = {}; evaluateStack(mesh, st, { fields, record: rec }); runs.push(rec.ms!); }
  runs.sort((a, b) => a - b);
  const env = fields.env;
  const tv1: number[] = [], tv2: number[] = [];
  const v1s = stackFromV1(v1);
  for (let k = 0; k < 5; k++) {
    let t = performance.now(); paintVertices(mesh, v1, { env }); tv1.push(performance.now() - t);
    t = performance.now(); evaluateStack(mesh, v1s, { fields }); tv2.push(performance.now() - t);
  }
  tv1.sort((a, b) => a - b); tv2.sort((a, b) => a - b);
  const report = { vertices: n, layers: 12, vertexLayers: 10, coldMs: +cold.toFixed(2), medianMs: +runs[2].toFixed(2), v1Layers: v1.layers.length, v1PaintMs: +tv1[2].toFixed(2), v2SameStackMs: +tv2[2].toFixed(2) };
  console.log("perf", JSON.stringify(report));
  assert(n >= 9000, `~10 k vertices (${n})`);
  assert(runs[2] < 250, `12-layer evaluation ${runs[2]} ms`);
  (globalThis as Record<string, unknown>).__TX_PERF__ = report;
});

Deno.test("TX23 docs: docs/wave-tex/LAYERS.md carries the generated operator/channel/mask tables of this code (WAVE_TEX_WRITE_DOC=1 rewrites them)", async () => {
  const tables = generatedTables();
  const path = "docs/wave-tex/LAYERS.md";
  const begin = "<!-- BEGIN GENERATED (tests/wave_tex_layers_test.ts) -->", end = "<!-- END GENERATED -->";
  let doc = await Deno.readTextFile(path).catch(() => "");
  if (Deno.env.get("WAVE_TEX_WRITE_DOC") === "1") {
    const a = doc.indexOf(begin), b = doc.indexOf(end);
    doc = a >= 0 && b > a ? doc.slice(0, a) + begin + "\n" + tables + "\n" + doc.slice(b) : doc + "\n" + begin + "\n" + tables + "\n" + end + "\n";
    await Deno.writeTextFile(path, doc);
  }
  assert(doc.includes(tables), "LAYERS.md tables are stale: run WAVE_TEX_WRITE_DOC=1 deno test -A tests/wave_tex_layers_test.ts");
});

function generatedTables(): string {
  const lines: string[] = [];
  lines.push("### Channels", "", "| id | kind | range | default | neutral | space | storage | attribute[component] |", "|---|---|---|---|---|---|---|---|");
  const fmt = (v: number | readonly number[]) => typeof v === "number" ? String(+v.toFixed(4)) : `(${v.map((x) => +x.toFixed(4)).join(", ")})`;
  for (const id of BASE_CHANNELS) {
    const s = CHANNEL_SPECS[id];
    lines.push(`| ${id} | ${s.kind} | [${fmt(s.range[0])}, ${fmt(s.range[1])}] | ${fmt(s.default)} | ${fmt(s.neutral)} | ${s.space} | ${s.storage} | ${s.attribute}[${s.component}] |`);
  }
  lines.push(`| mask:<name> | scalar | [0, 1] | 0 | 0 | scalar | vertex | masks[name] |`, "");
  lines.push(`### Colour blend modes (${COLOR_BLEND_MODES.length} + alias linearDodge = add)`, "", "| mode | kind | B(b, s) | commutative | identity |", "|---|---|---|---|---|");
  for (const d of OPERATOR_DOCS.filter((x) => x.kind !== "scalar")) lines.push(`| ${d.id} | ${d.kind.replace("color-", "")} | ${d.formula.replaceAll("|", "\\|")} | ${d.commutative ? "yes" : "no"} | ${d.identity ?? "—"} |`);
  lines.push("", `### Scalar ops (${SCALAR_OPS.length})`, "", "| op | op(b, s) | commutative | identity |", "|---|---|---|---|");
  for (const d of OPERATOR_DOCS.filter((x) => x.kind === "scalar")) lines.push(`| ${d.id} | ${d.formula.replaceAll("|", "\\|")} | ${d.commutative ? "yes" : "no"} | ${d.identity ?? "—"} |`);
  lines.push("", `### Mask algebra`, "", `Sources (${MASK_SOURCES.length}): ${MASK_SOURCES.join(", ")}.`, "", `Combinators (${MASK_COMBINATORS.length}): ${MASK_COMBINATORS.join(", ")}.`);
  return lines.join("\n");
}
