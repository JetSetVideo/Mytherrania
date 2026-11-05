// Wave TEX lane L: the operator algebra (src/graphics/paint/Operators.ts). Property tests, >= 2000 fuzzed
// cases each, seeded (rng32): identities, commutativity where it holds (and a counterexample where it does
// not), associativity of normal-over (and of the associative modes), range closure on [0, 1] with
// out-of-range / NaN / infinite inputs, the v1 codes bit-identical to Blend.ts, W3C reference values for
// the non-separable modes, scalar-op laws incl. heightBlend.
import { rng32 } from "../src/core/MathCore.ts";
import { BLEND_MODES, blendChannelCode } from "../src/graphics/paint/Blend.ts";
import {
  blendRgb, blendRgbLinear, blendSeparable, COLOR_BLEND_MODES, colorModeCode, compositeOpaque, compositeOver,
  FIRST_NON_SEPARABLE, lum, OPERATOR_DOCS, overAlpha, SCALAR_OP_DEFAULTS, SCALAR_OPS, scalarComposite, scalarOpCode,
  SEPARABLE_MODES,
} from "../src/graphics/paint/Operators.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

export const FUZZ = 4000;
const EDGE = [0, 1, 0.5, 0.25, 0.75, 1e-12, 1 - 1e-12, -0, -1, 2, -1e9, 1e9, NaN, Infinity, -Infinity, 0.04045, 0.0031308];
/** Seeded fuzz values: 1/4 edge cases, 3/4 uniform in [-0.25, 1.25]. */
function fuzzer(seed: number) {
  const r = rng32(seed);
  return () => (r() < 0.25 ? EDGE[Math.floor(r() * EDGE.length)] : -0.25 + 1.5 * r());
}
function unitFuzzer(seed: number) {
  const r = rng32(seed);
  const E = [0, 1, 0.5, 0.25, 0.75, 1e-12, 1 - 1e-12];
  return () => (r() < 0.2 ? E[Math.floor(r() * E.length)] : r());
}
const SEP = SEPARABLE_MODES.map((m) => colorModeCode(m));
const ALL = COLOR_BLEND_MODES.map((m) => colorModeCode(m));
const out3 = new Float64Array(3);
const rgb = (code: number, b: number[], s: number[]) => { blendRgb(code, b[0], b[1], b[2], s[0], s[1], s[2], out3, 0); return [out3[0], out3[1], out3[2]]; };
const docOf = (id: string, kind: "color" | "scalar") => OPERATOR_DOCS.find((d) => d.id === id && (kind === "scalar" ? d.kind === "scalar" : d.kind !== "scalar"))!;

Deno.test("TX1 operators: 25 colour modes (21 separable incl. softLightW3C, 4 non-separable) + linearDodge alias; 19 scalar ops; every op documented", () => {
  const brief = ["normal", "multiply", "screen", "overlay", "softLight", "hardLight", "vividLight", "linearLight", "pinLight", "hardMix",
    "colorDodge", "colorBurn", "linearDodge", "linearBurn", "darken", "lighten", "difference", "exclusion", "subtract", "divide",
    "hue", "saturation", "color", "luminosity"];
  for (const m of brief) assert(m === "linearDodge" || (COLOR_BLEND_MODES as readonly string[]).includes(m), `missing ${m}`);
  assert(colorModeCode("linearDodge") === colorModeCode("add"), "linearDodge = add");
  const scalarBrief = ["replace", "add", "subtract", "multiply", "divide", "min", "max", "average", "lerp", "screen", "overlay",
    "difference", "power", "clamp", "remap", "smoothstep", "threshold", "invert", "heightBlend"];
  for (const s of scalarBrief) assert((SCALAR_OPS as readonly string[]).includes(s), `missing scalar ${s}`);
  for (const m of COLOR_BLEND_MODES) assert(docOf(m, "color"), `undocumented ${m}`);
  for (const s of SCALAR_OPS) assert(docOf(s, "scalar"), `undocumented scalar ${s}`);
  // The six v1 modes keep their v1 codes.
  BLEND_MODES.forEach((m, i) => assert(colorModeCode(m) === i, `v1 code ${m}`));
  assert(colorModeCode("nope") === 0 && scalarOpCode("nope") === 0, "unknown names are total");
});

Deno.test(`TX2 operators: v1 codes 0..5 bit-identical to Blend.blendChannelCode on [0,1] (${FUZZ * 6} cases)`, () => {
  const f = unitFuzzer(11);
  let n = 0;
  for (let k = 0; k < FUZZ; k++) {
    const b = f(), s = f();
    for (let c = 0; c < 6; c++) { assert(Object.is(blendSeparable(c, b, s), blendChannelCode(c, b, s)), `code ${c} b=${b} s=${s}`); n++; }
  }
  assert(n === FUZZ * 6);
});

Deno.test(`TX3 operators: range closure + no NaN for every colour mode on out-of-range/NaN/Inf inputs (${FUZZ} x 25 triples)`, () => {
  const f = fuzzer(12);
  for (let k = 0; k < FUZZ; k++) {
    const b = [f(), f(), f()], s = [f(), f(), f()];
    for (const c of ALL) {
      for (const lin of [false, true]) {
        if (lin) blendRgbLinear(c, b[0], b[1], b[2], s[0], s[1], s[2], out3, 0); else blendRgb(c, b[0], b[1], b[2], s[0], s[1], s[2], out3, 0);
        for (let j = 0; j < 3; j++) assert(out3[j] >= 0 && out3[j] <= 1, `${COLOR_BLEND_MODES[c]} lin=${lin} b=${b} s=${s} -> ${out3[j]}`);
      }
    }
  }
  // The 0/0 corners named in the brief.
  assert(blendSeparable(colorModeCode("divide"), 0, 0) === 0 && blendSeparable(colorModeCode("divide"), 0.3, 0) === 1, "divide 0/0 := 0, b/0 := 1");
  assert(blendSeparable(colorModeCode("colorDodge"), 0, 1) === 0 && blendSeparable(colorModeCode("colorBurn"), 1, 0) === 1, "dodge/burn corners");
  for (const c of ALL) { const r = rgb(c, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]); assert(r.every((v) => v >= 0 && v <= 1), "grey"); }
});

Deno.test(`TX4 operators: identities (normal at alpha 0, multiply by white, screen by black, add 0, ... ) on ${FUZZ} bases`, () => {
  const f = unitFuzzer(13);
  const ids: [string, number][] = [["multiply", 1], ["screen", 0], ["add", 0], ["overlay", 0.5], ["softLight", 0.5], ["hardLight", 0.5],
    ["linearLight", 0.5], ["pinLight", 0.5], ["vividLight", 0.5], ["colorDodge", 0], ["colorBurn", 1], ["linearBurn", 1], ["darken", 1],
    ["lighten", 0], ["difference", 0], ["exclusion", 0], ["subtract", 0], ["divide", 1], ["softLightW3C", 0.5]];
  let worst = 0;
  for (let k = 0; k < FUZZ; k++) {
    const b = f();
    for (const [m, s] of ids) worst = Math.max(worst, Math.abs(blendSeparable(colorModeCode(m), b, s) - b));
    for (const c of ALL) {
      const B = [b, f(), f()], S = [f(), f(), f()];
      blendRgb(c, B[0], B[1], B[2], S[0], S[1], S[2], out3, 0);
      for (let j = 0; j < 3; j++) assert(Object.is(compositeOpaque(B[j], out3[j], 0), B[j]), "alpha 0 is the identity, bit for bit");
    }
    // Non-separable: blending a colour with itself returns it.
    const C = [f(), f(), f()];
    for (const m of ["hue", "saturation", "color", "luminosity"]) {
      const r = rgb(colorModeCode(m), C, C);
      for (let j = 0; j < 3; j++) worst = Math.max(worst, Math.abs(r[j] - C[j]));
    }
  }
  assert(worst < 1e-12, `identity error ${worst}`);
});

Deno.test(`TX5 operators: commutativity where documented, a counterexample where not (${FUZZ} pairs)`, () => {
  const f = unitFuzzer(14);
  for (const d of OPERATOR_DOCS.filter((x) => x.kind !== "scalar")) {
    const c = colorModeCode(d.id);
    let maxDiff = 0;
    for (let k = 0; k < FUZZ; k++) {
      const b = [f(), f(), f()], s = [f(), f(), f()];
      const x = rgb(c, b, s), y = rgb(c, s, b);
      for (let j = 0; j < 3; j++) maxDiff = Math.max(maxDiff, Math.abs(x[j] - y[j]));
    }
    if (d.commutative) assert(maxDiff < 1e-12, `${d.id} should commute: ${maxDiff}`);
    else assert(maxDiff > 1e-3, `${d.id} documented non-commutative but no counterexample (${maxDiff})`);
  }
  for (const d of OPERATOR_DOCS.filter((x) => x.kind === "scalar")) {
    const c = scalarOpCode(d.id), p = d.id === "lerp" ? [0.3, 0, 0, 0] : SCALAR_OP_DEFAULTS[d.id as keyof typeof SCALAR_OP_DEFAULTS];
    let maxDiff = 0;
    for (let k = 0; k < FUZZ; k++) {
      const b = f(), s = f();
      const x = scalarComposite(c, b, s, 1, p[0], p[1], p[2], p[3], 0, 1), y = scalarComposite(c, s, b, 1, p[0], p[1], p[2], p[3], 0, 1);
      maxDiff = Math.max(maxDiff, Math.abs(x - y));
    }
    if (d.commutative) assert(maxDiff < 1e-12, `scalar ${d.id} should commute: ${maxDiff}`);
    else assert(maxDiff > 1e-3, `scalar ${d.id} documented non-commutative but no counterexample`);
  }
});

Deno.test(`TX6 operators: normal-over is associative; multiply/screen/add/darken/lighten/linearBurn are associative (${FUZZ} triples)`, () => {
  const f = unitFuzzer(15);
  let worst = 0;
  for (let k = 0; k < FUZZ; k++) {
    const b = f(), s1 = f(), a1 = f(), s2 = f(), a2 = f();
    // Sequential: b <- (s1, a1) <- (s2, a2) on an opaque canvas.
    const seq = compositeOpaque(compositeOpaque(b, s1, a1), s2, a2);
    // Grouped: (s1, a1) over-composited with (s2, a2) on a transparent canvas first, then onto b.
    const ga = overAlpha(a2, a1);
    const gc = compositeOver(s1, a1, s2, s2, a2);
    const grouped = compositeOpaque(b, gc, ga);
    worst = Math.max(worst, Math.abs(seq - grouped));
    const c = f();
    for (const m of ["multiply", "screen", "add", "darken", "lighten", "linearBurn"]) {
      const code = colorModeCode(m);
      const l = blendSeparable(code, blendSeparable(code, b, s1), c), r = blendSeparable(code, b, blendSeparable(code, s1, c));
      worst = Math.max(worst, Math.abs(l - r));
    }
  }
  assert(worst < 1e-12, `associativity error ${worst}`);
  // linearBurn is the Łukasiewicz t-norm (associative); overlay is NOT associative: a counterexample.
  const ov = colorModeCode("overlay");
  assert(Math.abs(blendSeparable(ov, blendSeparable(ov, 0.2, 0.7), 0.3) - blendSeparable(ov, 0.2, blendSeparable(ov, 0.7, 0.3))) > 0.01, "overlay counterexample");
});

Deno.test("TX7 operators: W3C non-separable reference values (Lum preserved, hue/sat transferred)", () => {
  const grey = [0.5, 0.5, 0.5], red = [1, 0, 0], teal = [0.2, 0.6, 0.6];
  // color: hue+sat of the source at the base's luminosity.
  const c = rgb(colorModeCode("color"), grey, red);
  assert(Math.abs(lum(c[0], c[1], c[2]) - 0.5) < 1e-12 && c[0] > c[1] && Math.abs(c[1] - c[2]) < 1e-12, `color ${c}`);
  // luminosity: base hue/sat at the source luminosity.
  const l = rgb(colorModeCode("luminosity"), teal, grey);
  assert(Math.abs(lum(l[0], l[1], l[2]) - 0.5) < 1e-12 && Math.abs(l[1] - l[2]) < 1e-12 && l[1] > l[0], `luminosity ${l}`);
  // saturation of a grey source: removes saturation, keeps luminosity.
  const s = rgb(colorModeCode("saturation"), teal, grey);
  assert(Math.abs(s[0] - s[1]) < 1e-12 && Math.abs(s[1] - s[2]) < 1e-12 && Math.abs(s[0] - lum(0.2, 0.6, 0.6)) < 1e-12, `saturation ${s}`);
  // hue of a grey base: the base has no saturation -> grey at the base luminosity.
  const h = rgb(colorModeCode("hue"), grey, red);
  assert(h.every((v) => Math.abs(v - 0.5) < 1e-12), `hue ${h}`);
  // A worked W3C value: hue(teal base, red source): SetSat(red, 0.4) = (0.4, 0, 0) then SetLum to Lum(teal)=0.438
  const h2 = rgb(colorModeCode("hue"), teal, red);
  const L = lum(0.2, 0.6, 0.6), d = L - 0.3 * 0.4;
  assert(Math.abs(h2[0] - (0.4 + d)) < 1e-12 && Math.abs(h2[1] - d) < 1e-12 && Math.abs(h2[2] - d) < 1e-12, `hue2 ${h2}`);
  // Separable reference values (W3C / Photoshop).
  const V: [string, number, number, number][] = [["hardLight", 0.3, 0.8, 1 - 2 * 0.7 * 0.2], ["vividLight", 0.5, 0.25, 0], ["vividLight", 0.5, 0.75, 1],
    ["linearLight", 0.3, 0.6, 0.5], ["pinLight", 0.7, 0.2, 0.4], ["pinLight", 0.2, 0.8, 0.6], ["hardMix", 0.4, 0.6, 1], ["hardMix", 0.4, 0.5, 0],
    ["colorDodge", 0.25, 0.5, 0.5], ["colorBurn", 0.75, 0.5, 0.5], ["exclusion", 0.5, 0.5, 0.5], ["divide", 0.25, 0.5, 0.5], ["subtract", 0.3, 0.5, 0]];
  for (const [m, b, sv, want] of V) { const got = blendSeparable(colorModeCode(m), b, sv); assert(Math.abs(got - want) < 1e-12, `${m}(${b},${sv}) = ${got}, want ${want}`); }
});

Deno.test(`TX8 operators: scalar ops total and closed on every channel range, alpha 0 identity, documented identities (${FUZZ} x 19 x 3 ranges)`, () => {
  const f = fuzzer(16);
  const ranges: [number, number][] = [[0, 1], [-0.008, 0.008], [0.2, 0.2]];
  for (let k = 0; k < FUZZ; k++) {
    const b = f(), s = f(), a = f(), p = [f(), f(), f(), f()];
    for (const op of SCALAR_OPS) {
      const c = scalarOpCode(op);
      for (const [lo, hi] of ranges) {
        const r = scalarComposite(c, b, s, a, p[0], p[1], p[2], p[3], lo, hi);
        assert(r >= lo && r <= hi && r === r, `${op} [${lo},${hi}] b=${b} s=${s} a=${a} p=${p} -> ${r}`);
        if (b >= lo && b <= hi) {
          const r0 = scalarComposite(c, b, s, 0, p[0], p[1], p[2], p[3], lo, hi);
          assert(Object.is(r0, b) || (r0 === 0 && b === 0), `${op} alpha 0 identity b=${b} -> ${r0}`);
        }
      }
    }
  }
  const u = unitFuzzer(17);
  let worst = 0;
  for (let k = 0; k < FUZZ; k++) {
    const b = u();
    const id = (op: string, s: number, p: number[] = [0, 0, 0, 0]) => scalarComposite(scalarOpCode(op), b, s, 1, p[0], p[1], p[2], p[3], 0, 1);
    worst = Math.max(worst, Math.abs(id("add", 0) - b), Math.abs(id("subtract", 0) - b), Math.abs(id("multiply", 1) - b), Math.abs(id("divide", 1) - b),
      Math.abs(id("min", 1) - b), Math.abs(id("max", 0) - b), Math.abs(id("lerp", u(), [0]) - b), Math.abs(id("screen", 0) - b),
      Math.abs(id("overlay", 0.5) - b), Math.abs(id("power", 1) - b), Math.abs(id("clamp", 0, [0, 1]) - b), Math.abs(id("remap", 0, [0, 1, 0, 1]) - b));
    // invert is an involution; replace returns s; heightBlend at a = 1, w = 0 is max.
    const inv = scalarOpCode("invert");
    worst = Math.max(worst, Math.abs(scalarComposite(inv, scalarComposite(inv, b, 0, 1, 0, 0, 0, 0, 0, 1), 0, 1, 0, 0, 0, 0, 0, 1) - b));
    const s = u();
    worst = Math.max(worst, Math.abs(scalarComposite(scalarOpCode("heightBlend"), b, s, 1, 0, 0, 0, 0, 0, 1) - (s >= b ? s : b)));
  }
  assert(worst < 1e-12, `scalar identity error ${worst}`);
  assert(scalarComposite(scalarOpCode("divide"), 0, 0, 1, 0, 0, 0, 0, -1, 1) === 0, "0/0 = 0");
});

Deno.test(`TX9 operators: heightBlend — smooth "taller wins": monotone in s, b and a (QC OPS-12), identity at a = 0, exact max outside the transition, overshoot <= w/4 (${FUZZ} cases)`, () => {
  const r = rng32(18);
  const hb = scalarOpCode("heightBlend"), H = 0.008;
  let worstOver = 0, drops = 0;
  for (let k = 0; k < FUZZ; k++) {
    const b = (r() * 2 - 1) * 0.004, s = (r() * 2 - 1) * 0.004, a = r(), w = r() * 0.002;
    const v = scalarComposite(hb, b, s, a, w, 0, 0, 0, -H, H);
    assert(v >= b - 1e-15 && v <= Math.max(b, s) + w / 4 + 1e-15, "b <= r <= max + w/4");
    worstOver = Math.max(worstOver, (v - Math.max(b, s)) / Math.max(w, 1e-12));
    const ds = r() * 0.001;
    if (scalarComposite(hb, b, s + ds, a, w, 0, 0, 0, -H, H) < v - 1e-15) drops++;
    if (scalarComposite(hb, b + ds, s, a, w, 0, 0, 0, -H, H) < v - 1e-15) drops++;
    if (scalarComposite(hb, b, s, Math.min(1, a + 0.1), w, 0, 0, 0, -H, H) < v - 1e-15) drops++;
    if (Math.abs(s - b) >= w) assert(Math.abs(scalarComposite(hb, b, s, 1, w, 0, 0, 0, -H, H) - Math.max(b, s)) < 1e-15, "exact max outside the transition");
  }
  assert(drops === 0, `monotonicity violations ${drops}`);
  assert(worstOver <= 0.25 + 1e-9, `overshoot ${worstOver} w`);
  // A 1 mm scar ridge over 0.3 mm pores with a 0.2 mm transition: the ridge wins; a 0.1 mm paint film does not.
  assert(Math.abs(scalarComposite(hb, 0.0003, 0.001, 1, 0.0002, 0, 0, 0, -H, H) - 0.001) < 1e-15, "ridge wins");
  assert(scalarComposite(hb, 0.0003, 0.0001, 1, 0.0002, 0, 0, 0, -H, H) === 0.0003, "film under the pores loses");
  // The lift p1 raises the layer: a 0.2 mm film lifted 0.5 mm stands at 0.7 mm.
  assert(Math.abs(scalarComposite(hb, 0.0003, 0.0002, 1, 0, 0.0005, 0, 0, -H, H) - 0.0007) < 1e-15, "lift");
});

Deno.test(`TX10 operators: deterministic (same inputs -> same bits across ${FUZZ} replays)`, () => {
  const a = fuzzer(19), b = fuzzer(19);
  for (let k = 0; k < FUZZ; k++) {
    const x = [a(), a(), a(), a(), a(), a()], y = [b(), b(), b(), b(), b(), b()];
    const c = ALL[k % ALL.length];
    const o1 = new Float64Array(3), o2 = new Float64Array(3);
    blendRgb(c, x[0], x[1], x[2], x[3], x[4], x[5], o1, 0);
    blendRgb(c, y[0], y[1], y[2], y[3], y[4], y[5], o2, 0);
    for (let j = 0; j < 3; j++) assert(Object.is(o1[j], o2[j]), "deterministic");
  }
  assert(FIRST_NON_SEPARABLE === SEP.length, "layout");
});
