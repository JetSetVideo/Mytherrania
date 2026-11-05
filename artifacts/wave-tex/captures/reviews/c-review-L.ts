// C's independent ring review of L's READY (Z-28): W3C reference blends written from the spec text (not from L's code),
// v1 byte identity on bodies/recipes L's test does not use (default options path = no env/fields passed), mask laws.
import { blendRgb, blendSeparable, colorModeCode, scalarComposite, scalarOpCode, SEPARABLE_MODES } from "/Users/macmax/Desktop/Mytherrania/src/graphics/paint/Operators.ts";
import { evaluateStack } from "/Users/macmax/Desktop/Mytherrania/src/graphics/paint/Evaluate.ts";
import { stackFromV1 } from "/Users/macmax/Desktop/Mytherrania/src/graphics/paint/LayerStack.ts";
import { evaluateMask, MeshFields } from "/Users/macmax/Desktop/Mytherrania/src/graphics/paint/MaskAlgebra.ts";
import { paintVertices } from "/Users/macmax/Desktop/Mytherrania/src/graphics/paint/Layers.ts";
import { stackFor } from "/Users/macmax/Desktop/Mytherrania/src/graphics/paint/Recipes.ts";
import { generateBody } from "/Users/macmax/Desktop/Mytherrania/src/graphics/body/BodyMesh.ts";
import { raceBuild } from "/Users/macmax/Desktop/Mytherrania/src/game/RaceAppearance.ts";
import { PATTERN_KINDS } from "/Users/macmax/Desktop/Mytherrania/src/graphics/paint/Patterns.ts";

let s = 0x9e3779b9;
const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
const out: Record<string, unknown> = {};

// ---- 1. W3C compositing spec §10 separable modes, written fresh
const D = (b: number) => b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
const ref: Record<string, (b: number, s: number) => number> = {
  normal: (_b, s) => s, multiply: (b, s) => b * s, screen: (b, s) => b + s - b * s,
  hardLight: (b, s) => s <= 0.5 ? b * 2 * s : (b + (2 * s - 1)) - b * (2 * s - 1), // multiply(b,2s) / screen(b,2s-1)
  overlay: (b, s) => b <= 0.5 ? s * 2 * b : (s + (2 * b - 1)) - s * (2 * b - 1),
  darken: Math.min, lighten: Math.max,
  colorDodge: (b, s) => b === 0 ? 0 : s === 1 ? 1 : Math.min(1, b / (1 - s)),
  colorBurn: (b, s) => b === 1 ? 1 : s === 0 ? 0 : 1 - Math.min(1, (1 - b) / s),
  softLightW3C: (b, s) => s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * (D(b) - b),
  difference: (b, s) => Math.abs(b - s), exclusion: (b, s) => b + s - 2 * b * s,
  linearBurn: (b, s) => Math.max(0, b + s - 1), add: (b, s) => Math.min(1, b + s), subtract: (b, s) => Math.max(0, b - s),
  linearLight: (b, s) => Math.min(1, Math.max(0, b + 2 * s - 1)),
  pinLight: (b, s) => s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1),
};
const sepErr: Record<string, number> = {};
for (const [m, f] of Object.entries(ref)) {
  let worst = 0;
  const code = colorModeCode(m);
  for (let i = 0; i < 20000; i++) {
    const b = i < 4 ? [0, 1, 0, 1][i] : rnd(), sv = i < 4 ? [0, 0, 1, 1][i] : rnd();
    worst = Math.max(worst, Math.abs(blendSeparable(code, b, sv) - f(b, sv)));
  }
  sepErr[m] = worst;
}
out.separableMaxErr = sepErr;
// exact s = 0.5 boundary for hardLight / pinLight (W3C uses <= 0.5, L uses < 0.5: same value at 0.5?)
out.boundary05 = Object.fromEntries(["hardLight", "pinLight", "overlay"].map((m) => [m, [0, 0.3, 0.7, 1].map((b) => +(blendSeparable(colorModeCode(m), m === "overlay" ? 0.5 : b, m === "overlay" ? b : 0.5) - ref[m](m === "overlay" ? 0.5 : b, m === "overlay" ? b : 0.5)).toExponential(2))]));

// ---- 2. W3C non-separable, written fresh (Lum 0.3/0.59/0.11, ClipColor, SetSat)
const Lum = (c: number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const Clip = (c: number[]) => {
  const l = Lum(c), n = Math.min(...c), x = Math.max(...c);
  let r = c.slice();
  if (n < 0) r = r.map((v) => l + (v - l) * l / (l - n));
  if (x > 1) r = r.map((v) => l + (v - l) * (1 - l) / (x - l));
  return r;
};
const SetLum = (c: number[], l: number) => { const d = l - Lum(c); return Clip(c.map((v) => v + d)); };
const Sat = (c: number[]) => Math.max(...c) - Math.min(...c);
const SetSat = (c: number[], sv: number) => {
  const idx = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  const [mn, md, mx] = idx; const r = [0, 0, 0];
  if (c[mx] > c[mn]) { r[md] = (c[md] - c[mn]) * sv / (c[mx] - c[mn]); r[mx] = sv; }
  return r;
};
const nonSep: Record<string, (b: number[], s: number[]) => number[]> = {
  hue: (b, s) => SetLum(SetSat(s, Sat(b)), Lum(b)), saturation: (b, s) => SetLum(SetSat(b, Sat(s)), Lum(b)),
  color: (b, s) => SetLum(s, Lum(b)), luminosity: (b, s) => SetLum(b, Lum(s)),
};
const nsErr: Record<string, number> = {};
const o = new Float64Array(3);
for (const [m, f] of Object.entries(nonSep)) {
  let worst = 0;
  for (let i = 0; i < 20000; i++) {
    const b = [rnd(), rnd(), rnd()], sv = i % 10 === 0 ? [0.4, 0.4, 0.4] : [rnd(), rnd(), rnd()];
    blendRgb(colorModeCode(m), b[0], b[1], b[2], sv[0], sv[1], sv[2], o, 0);
    const r = f(b, sv).map((v) => Math.min(1, Math.max(0, v)));
    worst = Math.max(worst, ...r.map((v, k) => Math.abs(v - o[k])));
  }
  nsErr[m] = worst;
}
out.nonSeparableMaxErr = nsErr;
out.separableModesCount = SEPARABLE_MODES.length;

// ---- 3. heightBlend semantics: taller wins at a = 1 well outside the transition, identity at a = 0
{
  const c = scalarOpCode("heightBlend");
  let bad = 0;
  for (let i = 0; i < 20000; i++) {
    const b = (rnd() - 0.5) * 0.016, sv = (rnd() - 0.5) * 0.016, w = 0.0005;
    const r1 = scalarComposite(c, b, sv, 1, w, 0, 0, 0, -0.008, 0.008), r0 = scalarComposite(c, b, sv, 0, w, 0, 0, 0, -0.008, 0.008);
    if (r0 !== Math.min(0.008, Math.max(-0.008, b))) bad++;
    if (Math.abs(sv - b) > w && Math.abs(r1 - Math.max(b, sv)) > 1e-12) bad++;
  }
  out.heightBlendViolations = bad;
}

// ---- 4. v1 byte identity on bodies + recipes L's TX12 does not use, DEFAULT options (no env/fields passed)
const bodies: { tag: string; mesh: any; cell: number; spec: any }[] = [];
for (const [race, sex, subrace] of [["human", "female", null], ["elf", "male", "dark"], ["dwarf", "female", "mountain"], ["ork", "male", null]] as const) {
  const b = raceBuild(race, subrace);
  const spec: any = { race, subrace, className: "Rogue", height: (sex === "male" ? 1.75 : 1.65) * b.heightMul, weight: (sex === "male" ? 72 : 60) * b.weightMul, seed: 4242 + bodies.length, sex };
  const g = generateBody(spec);
  bodies.push({ tag: `${race}-${sex}-${subrace}`, mesh: g.mesh, cell: g.plan.cell, spec });
}
let stacks = 0, verts = 0, mismatches = 0, maxUlp = 0;
const cmp = (a: Float32Array, b: Float32Array) => {
  const ua = new Uint32Array(a.buffer, a.byteOffset, a.length), ub = new Uint32Array(b.buffer, b.byteOffset, b.length);
  let diff = 0; for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) { diff++; maxUlp = Math.max(maxUlp, Math.abs(ua[i] - ub[i])); }
  return diff;
};
for (const body of bodies) {
  for (let k = 0; k < 4; k++) {
    // the recipe exactly as SkinnedHumanoid.paintSkin builds it (vertexSpacing = cell, height)
    const st = stackFor({ race: body.spec.race, subrace: body.spec.subrace, className: ["Rogue", "Mage", "Warrior", "Ranger"][k] as any, birthsign: null, hair: "#3a2a1a", accent: "#c08040", garment: k % 2 ? "#4f8490" : "#803030", height: body.spec.height, vertexSpacing: body.cell, seed: 7 + 13 * k } as any);
    const a = paintVertices(body.mesh, st), b = evaluateStack(body.mesh, stackFromV1(st)).albedo;
    mismatches += cmp(a, b); stacks++; verts += a.length / 3;
  }
  // fuzzed v1 stacks: random patterns/modes/opacities (incl. 0 and 1), random region masks, random scales
  for (let k = 0; k < 6; k++) {
    const modes = ["normal", "multiply", "screen", "overlay", "softLight", "add"] as const;
    const regions = ["torso", "pelvis", "neck", "head", "face", "upperArm", "foreArm", "hand", "thigh", "shin", "foot"];
    const layers = Array.from({ length: 2 + Math.floor(rnd() * 8) }, (_, i) => ({
      name: "f" + i, pattern: PATTERN_KINDS[Math.floor(rnd() * PATTERN_KINDS.length)], colour: "#" + Math.floor(rnd() * 0xffffff).toString(16).padStart(6, "0"),
      colour2: "#" + Math.floor(rnd() * 0xffffff).toString(16).padStart(6, "0"), opacity: [0, 1, rnd()][i % 3], blend: modes[Math.floor(rnd() * 6)],
      scale: 0.01 + rnd() * 0.2, seed: Math.floor(rnd() * 1e6), regions: rnd() < 0.5 ? [regions[Math.floor(rnd() * regions.length)]] : undefined,
    }));
    const st: any = { layers };
    const a = paintVertices(body.mesh, st), b = evaluateStack(body.mesh, stackFromV1(st)).albedo;
    mismatches += cmp(a, b); stacks++; verts += a.length / 3;
  }
}
out.v1Identity = { bodies: bodies.map((b) => b.tag), stacks, verticesCompared: verts, floatMismatches: mismatches, maxUlp };

// ---- 5. mask laws on a real body: De Morgan (min/max), xor symmetry, invert involution, feather keeps [0,1]
{
  const mesh = bodies[0].mesh, f = new MeshFields(mesh);
  const ctx: any = { mesh, fields: f };
  const A: any = { op: "region", regions: ["foreArm", "hand"] }, B: any = { op: "direction", dir: [0, 1, 0], lo: 0, hi: 1 };
  const ev = (e: any) => evaluateMask(e, ctx);
  const n = mesh.positions.length / 3;
  const l1 = ev({ op: "invert", a: { op: "and", a: A, b: B } }), r1 = ev({ op: "or", a: { op: "invert", a: A }, b: { op: "invert", a: B } });
  const x1 = ev({ op: "xor", a: A, b: B }), x2 = ev({ op: "xor", a: B, b: A });
  const ii = ev({ op: "invert", a: { op: "invert", a: B } }), bb = ev(B);
  const fe = ev({ op: "feather", a: A, radiusMm: 30 });
  let dm = 0, xs = 0, inv = 0, feOut = 0, feMean = 0, aMean = 0; const am = ev(A);
  for (let i = 0; i < n; i++) {
    dm = Math.max(dm, Math.abs(l1[i] - r1[i])); xs = Math.max(xs, Math.abs(x1[i] - x2[i])); inv = Math.max(inv, Math.abs(ii[i] - bb[i]));
    if (!(fe[i] >= 0 && fe[i] <= 1)) feOut++; feMean += fe[i]; aMean += am[i];
  }
  out.maskLaws = { vertices: n, deMorganMaxErr: dm, xorSymMaxErr: xs, invertInvolutionMaxErr: inv, featherOutOfRange: feOut, featherMeanVsHardMean: [+(feMean / n).toFixed(5), +(aMean / n).toFixed(5)] };
}
console.log(JSON.stringify(out, null, 1));
