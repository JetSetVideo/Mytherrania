// Operators (wave TEX, contract C-MAT): every colour blend mode and every scalar op a v2 layer can
// apply, as pure, total functions (any finite or non-finite input gives a finite result inside the
// channel's range; no NaN). Pure module: no THREE, no DOM, no allocation in the per-sample paths.
//
// Vocabulary (W3C Compositing and Blending Level 1, §9-10; Photoshop):
//   b     the backdrop / base value already on the canvas (layers below).
//   s     the source value of the layer being applied.
//   a     the layer's alpha at this sample: opacity x coverage x mask, in 0..1.
//   B     the blend function; the composite on an OPAQUE canvas is  r = b + (B(b, s) - b) a
//         (the v1 Layers.ts formula, kept bit for bit).
//
// Colour modes are defined on sRGB channels 0..1 (the reference space). `blendRgbLinear` is the
// optional linear-light variant (decode, blend, encode). Codes 0..5 are the v1 BlendMode codes
// (Blend.ts BLEND_MODES order) so a v1 mode maps 1:1 and the v1 arithmetic is reproduced exactly.

import type { BlendMode } from "../body/contracts.ts";
import { linearToSrgb, srgbToLinear } from "./Blend.ts";

// ---------------------------------------------------------------------------------------
// Colour blend modes.

/** Separable colour modes (per channel). Codes 0..5 equal the v1 Blend.ts codes. */
export const SEPARABLE_MODES = [
  "normal", "multiply", "screen", "overlay", "softLight", "add",
  "hardLight", "vividLight", "linearLight", "pinLight", "hardMix", "colorDodge", "colorBurn",
  "linearBurn", "darken", "lighten", "difference", "exclusion", "subtract", "divide", "softLightW3C",
] as const;
/** Non-separable colour modes (whole RGB triple; W3C §10.2 with Lum weights 0.3/0.59/0.11). */
export const NON_SEPARABLE_MODES = ["hue", "saturation", "color", "luminosity"] as const;
/** Every colour mode name accepted (incl. the alias linearDodge = add). Index = code, except the alias. */
export const COLOR_BLEND_MODES = [...SEPARABLE_MODES, ...NON_SEPARABLE_MODES] as const;
export type SeparableMode = typeof SEPARABLE_MODES[number];
export type NonSeparableMode = typeof NON_SEPARABLE_MODES[number];
/** A colour blend mode id ("linearDodge" is an alias of "add"). */
export type ColorBlendMode = typeof COLOR_BLEND_MODES[number] | "linearDodge";
/** First non-separable code. */
export const FIRST_NON_SEPARABLE = SEPARABLE_MODES.length;

/** Numeric code of a colour mode (unknown names read as normal = 0, total). */
export function colorModeCode(mode: ColorBlendMode | string): number {
  if (mode === "linearDodge") return 5;
  const i = (COLOR_BLEND_MODES as readonly string[]).indexOf(mode);
  return i < 0 ? 0 : i;
}

/** v1 BlendMode -> v2 colour mode (identity on names: the six v1 modes keep their names and codes). */
export function colorModeFromV1(mode: BlendMode): ColorBlendMode {
  return mode;
}

/** Saturate a colour input: NaN -> 0, else clamp to [0, 1]. Identity (same bits) on [0, 1]. */
export function sat01(x: number): number {
  return x !== x ? 0 : x < 0 ? 0 : x > 1 ? 1 : x;
}

/** colorDodge (W3C): b = 0 -> 0; s = 1 -> 1; else min(1, b / (1 - s)). */
export function colorDodge(b: number, s: number): number {
  if (b <= 0) return 0;
  if (s >= 1) return 1;
  return Math.min(1, b / (1 - s));
}

/** colorBurn (W3C): b = 1 -> 1; s = 0 -> 0; else 1 - min(1, (1 - b) / s). */
export function colorBurn(b: number, s: number): number {
  if (b >= 1) return 1;
  if (s <= 0) return 0;
  return 1 - Math.min(1, (1 - b) / s);
}

/**
 * One separable channel by code, inputs saturated first (sat01; identity on [0, 1]).
 * Formulas (b base, s source; every result is then clamped to [0, 1]):
 *   0 normal       s
 *   1 multiply     b s
 *   2 screen       1 - (1 - b)(1 - s)
 *   3 overlay      b < 0.5 ? 2bs : 1 - 2(1 - b)(1 - s)                 (= hardLight(s, b))
 *   4 softLight    s < 0.5 ? 2bs + b^2(1 - 2s) : 2b(1 - s) + sqrt(b)(2s - 1)   (Photoshop; v1)
 *   5 add          min(1, b + s)                                         (linearDodge)
 *   6 hardLight    s < 0.5 ? 2bs : 1 - 2(1 - b)(1 - s)
 *   7 vividLight   s < 0.5 ? colorBurn(b, 2s) : colorDodge(b, 2s - 1)
 *   8 linearLight  clamp(b + 2s - 1)
 *   9 pinLight     s < 0.5 ? min(b, 2s) : max(b, 2s - 1)
 *  10 hardMix      b + s >= 1 ? 1 : 0                                   (Photoshop at 100 % fill)
 *  11 colorDodge   b = 0 ? 0 : s = 1 ? 1 : min(1, b / (1 - s))
 *  12 colorBurn    b = 1 ? 1 : s = 0 ? 0 : 1 - min(1, (1 - b) / s)
 *  13 linearBurn   max(0, b + s - 1)
 *  14 darken       min(b, s)
 *  15 lighten      max(b, s)
 *  16 difference   |b - s|
 *  17 exclusion    b + s - 2bs
 *  18 subtract     max(0, b - s)
 *  19 divide       s = 0 ? (b = 0 ? 0 : 1) : min(1, b / s)              (0/0 := 0)
 *  20 softLightW3C s <= 0.5 ? b - (1 - 2s) b (1 - b) : b + (2s - 1)(D(b) - b),
 *                  D(b) = b <= 0.25 ? ((16b - 12) b + 4) b : sqrt(b)
 * Non-separable codes (>= 21) are not handled here; they fall back to normal (use blendRgb).
 */
export function blendSeparable(code: number, b0: number, s0: number): number {
  const b = sat01(b0), s = sat01(s0);
  let r: number;
  switch (code) {
    case 1: r = b * s; break;
    case 2: r = 1 - (1 - b) * (1 - s); break;
    case 3: r = b < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s); break;
    case 4: r = s < 0.5 ? 2 * b * s + b * b * (1 - 2 * s) : 2 * b * (1 - s) + Math.sqrt(b) * (2 * s - 1); break;
    case 5: r = Math.min(1, b + s); break;
    case 6: r = s < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s); break;
    case 7: r = s < 0.5 ? colorBurn(b, 2 * s) : colorDodge(b, 2 * s - 1); break;
    case 8: r = b + 2 * s - 1; break;
    case 9: r = s < 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1); break;
    case 10: r = b + s >= 1 ? 1 : 0; break;
    case 11: r = colorDodge(b, s); break;
    case 12: r = colorBurn(b, s); break;
    case 13: r = b + s - 1; break;
    case 14: r = b < s ? b : s; break;
    case 15: r = b > s ? b : s; break;
    case 16: r = Math.abs(b - s); break;
    case 17: r = b + s - 2 * b * s; break;
    case 18: r = b - s; break;
    case 19: r = s <= 0 ? (b <= 0 ? 0 : 1) : Math.min(1, b / s); break;
    case 20: {
      if (s <= 0.5) r = b - (1 - 2 * s) * b * (1 - b);
      else {
        const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
        r = b + (2 * s - 1) * (d - b);
      }
      break;
    }
    default: r = s;
  }
  return r < 0 ? 0 : r > 1 ? 1 : r;
}

/** W3C Lum: 0.3 r + 0.59 g + 0.11 b. */
export function lum(r: number, g: number, b: number): number {
  return 0.3 * r + 0.59 * g + 0.11 * b;
}

// Scratch for the non-separable modes (module-level: no allocation per sample).
const T = new Float64Array(3);

/** W3C ClipColor on T in place (guards the 0/0 cases: a grey triple is returned as is). */
function clipColor(): void {
  const l = lum(T[0], T[1], T[2]);
  const n = Math.min(T[0], T[1], T[2]), x = Math.max(T[0], T[1], T[2]);
  if (n < 0 && l - n > 1e-12) {
    const k = l / (l - n);
    for (let i = 0; i < 3; i++) T[i] = l + (T[i] - l) * k;
  }
  if (x > 1 && x - l > 1e-12) {
    const k = (1 - l) / (x - l);
    for (let i = 0; i < 3; i++) T[i] = l + (T[i] - l) * k;
  }
}

/** W3C SetLum(T, l): shift T so Lum(T) = l, then ClipColor. */
function setLum(l: number): void {
  const d = l - lum(T[0], T[1], T[2]);
  T[0] += d; T[1] += d; T[2] += d;
  clipColor();
}

/** W3C SetSat(T, s): Cmax -> s, Cmid scaled, Cmin -> 0 (grey: all 0). */
function setSat(s: number): void {
  let iMax = 0, iMin = 0;
  for (let i = 1; i < 3; i++) { if (T[i] > T[iMax]) iMax = i; if (T[i] < T[iMin]) iMin = i; }
  if (iMax === iMin) { T[0] = 0; T[1] = 0; T[2] = 0; return; }
  const iMid = 3 - iMax - iMin;
  const span = T[iMax] - T[iMin];
  T[iMid] = span > 0 ? ((T[iMid] - T[iMin]) * s) / span : 0;
  T[iMax] = s;
  T[iMin] = 0;
}

/**
 * Blend a whole RGB triple by code into out[o..o+2] (sRGB, inputs saturated). Separable codes
 * call blendSeparable per channel; non-separable (W3C §10.2):
 *   hue         SetLum(SetSat(Cs, Sat(Cb)), Lum(Cb))
 *   saturation  SetLum(SetSat(Cb, Sat(Cs)), Lum(Cb))
 *   color       SetLum(Cs, Lum(Cb))
 *   luminosity  SetLum(Cb, Lum(Cs))
 * Sat(C) = max - min. Results clamped to [0, 1].
 */
export function blendRgb(
  code: number, br: number, bg: number, bb: number, sr: number, sg: number, sb: number,
  out: Float32Array | Float64Array | number[], o: number,
): void {
  if (code < FIRST_NON_SEPARABLE || code >= COLOR_BLEND_MODES.length) {
    out[o] = blendSeparable(code, br, sr); out[o + 1] = blendSeparable(code, bg, sg); out[o + 2] = blendSeparable(code, bb, sb);
    return;
  }
  const r0 = sat01(br), g0 = sat01(bg), b0 = sat01(bb), r1 = sat01(sr), g1 = sat01(sg), b1 = sat01(sb);
  switch (code - FIRST_NON_SEPARABLE) {
    case 0: { // hue
      const satB = Math.max(r0, g0, b0) - Math.min(r0, g0, b0);
      T[0] = r1; T[1] = g1; T[2] = b1; setSat(satB); setLum(lum(r0, g0, b0));
      break;
    }
    case 1: { // saturation
      const satS = Math.max(r1, g1, b1) - Math.min(r1, g1, b1);
      T[0] = r0; T[1] = g0; T[2] = b0; setSat(satS); setLum(lum(r0, g0, b0));
      break;
    }
    case 2: // color
      T[0] = r1; T[1] = g1; T[2] = b1; setLum(lum(r0, g0, b0));
      break;
    default: // luminosity
      T[0] = r0; T[1] = g0; T[2] = b0; setLum(lum(r1, g1, b1));
  }
  out[o] = sat01(T[0]); out[o + 1] = sat01(T[1]); out[o + 2] = sat01(T[2]);
}

const L = new Float64Array(3);
/** Linear-light variant: decode both triples, blend, encode back to sRGB into out[o..o+2]. */
export function blendRgbLinear(
  code: number, br: number, bg: number, bb: number, sr: number, sg: number, sb: number,
  out: Float32Array | Float64Array | number[], o: number,
): void {
  blendRgb(code, srgbToLinear(sat01(br)), srgbToLinear(sat01(bg)), srgbToLinear(sat01(bb)),
    srgbToLinear(sat01(sr)), srgbToLinear(sat01(sg)), srgbToLinear(sat01(sb)), L, 0);
  out[o] = sat01(linearToSrgb(L[0])); out[o + 1] = sat01(linearToSrgb(L[1])); out[o + 2] = sat01(linearToSrgb(L[2]));
}

/** Composite on an opaque canvas, one channel: b + (B - b) a (the v1 expression, a NOT re-clamped). */
export function compositeOpaque(b: number, blended: number, a: number): number {
  return b + (blended - b) * a;
}

/**
 * W3C source-over with a non-opaque backdrop (used inside isolated groups), one channel,
 * non-premultiplied:  m = (1 - ab) s + ab B(cb, s);  ao = as + ab (1 - as);
 *                     co = (as m + ab (1 - as) cb) / ao   (ao = 0 -> co = cb).
 * Returns co; alpha is `overAlpha(as, ab)`.
 */
export function compositeOver(cb: number, ab: number, s: number, blended: number, as: number): number {
  const ao = as + ab * (1 - as);
  if (ao <= 1e-12) return cb;
  const m = (1 - ab) * s + ab * blended;
  return (as * m + ab * (1 - as) * cb) / ao;
}

/** Porter-Duff over alpha: as + ab (1 - as). */
export function overAlpha(as: number, ab: number): number {
  return as + ab * (1 - as);
}

// ---------------------------------------------------------------------------------------
// Scalar ops (roughness, height, ao, subsurface, masks).

export const SCALAR_OPS = [
  "replace", "add", "subtract", "multiply", "divide", "min", "max", "average", "lerp", "screen", "overlay",
  "difference", "power", "clamp", "remap", "smoothstep", "threshold", "invert", "heightBlend",
] as const;
export type ScalarOp = typeof SCALAR_OPS[number];

/** Numeric code of a scalar op (unknown names read as replace = 0, total). */
export function scalarOpCode(op: ScalarOp | string): number {
  const i = (SCALAR_OPS as readonly string[]).indexOf(op);
  return i < 0 ? 0 : i;
}

/** Default op parameters p0..p3 per op (see scalarOp). */
export const SCALAR_OP_DEFAULTS: Readonly<Record<ScalarOp, readonly [number, number, number, number]>> = {
  replace: [0, 0, 0, 0], add: [0, 0, 0, 0], subtract: [0, 0, 0, 0], multiply: [0, 0, 0, 0], divide: [0, 0, 0, 0],
  min: [0, 0, 0, 0], max: [0, 0, 0, 0], average: [0, 0, 0, 0], lerp: [0.5, 0, 0, 0], screen: [0, 0, 0, 0],
  overlay: [0, 0, 0, 0], difference: [0, 0, 0, 0], power: [0, 0, 0, 0], clamp: [0, 1, 0, 0], remap: [0, 1, 0, 1],
  smoothstep: [0, 1, 0, 0], threshold: [0.5, 0, 0, 0], invert: [0, 0, 0, 0], heightBlend: [0.0005, 0, 0, 0],
};

/** Finite-ise a scalar input: NaN -> 0, +-Infinity -> +-1e9. */
export function fin(x: number): number {
  return x !== x ? 0 : x > 1e9 ? 1e9 : x < -1e9 ? -1e9 : x;
}

/** Safe division: |d| < 1e-6 divides by +-1e-6 (sign kept; 0 / 0 = 0). Same law as NoiseAlgebra.safeDiv. */
export function safeDivide(n: number, d: number): number {
  const dd = Math.abs(d) < 1e-6 ? (d < 0 ? -1e-6 : 1e-6) : d;
  return n / dd;
}

/** Hermite smoothstep with e0 = e1 handled as a hard step at e0. */
export function smoothstepSafe(e0: number, e1: number, x: number): number {
  if (e1 === e0) return x >= e0 ? 1 : 0;
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/**
 * The blend function of a scalar op (before alpha). b base, s source, p0..p3 params,
 * [lo, hi] the channel range; u = (b - lo)/(hi - lo), v = (s - lo)/(hi - lo) the normalised values.
 *   replace     s                         add       b + s            subtract  b - s
 *   multiply    b s                       divide    safeDivide(b, s) min/max   min(b,s) / max(b,s)
 *   average     (b + s) / 2               lerp      b + (s - b) p0   (p0 default 0.5)
 *   screen      lo + (hi-lo)(1 - (1-u)(1-v))         overlay   lo + (hi-lo) overlay(u, v)
 *   difference  |b - s|                   power     sign(b) |b|^clamp(s, 0, 64)
 *   clamp       clamp(b, min(p0,p1), max(p0,p1))        (s unused: a filter of the canvas)
 *   remap       p2 + (p3 - p2) clamp01((b - p0)/(p1 - p0))  (p0 = p1: step at p0)
 *   smoothstep  lo + (hi-lo) S(p0, p1, u)                threshold lo + (hi-lo) S(p0-p1, p0+p1, u)
 *   invert      lo + hi - b
 *   heightBlend see scalarComposite (alpha enters the law; quadratic smooth max)
 * Every input is finite-ised (fin) first. The composite clamps to [lo, hi].
 */
export function scalarOp(code: number, b0: number, s0: number, p0: number, p1: number, p2: number, p3: number, lo: number, hi: number): number {
  const b = fin(b0), s = fin(s0);
  const span = hi - lo;
  const inv = span > 0 ? 1 / span : 0;
  switch (code) {
    case 1: return b + s;
    case 2: return b - s;
    case 3: return b * s;
    case 4: return safeDivide(b, s);
    case 5: return b < s ? b : s;
    case 6: return b > s ? b : s;
    case 7: return (b + s) * 0.5;
    case 8: return b + (s - b) * fin(p0);
    case 9: {
      const u = sat01((b - lo) * inv), v = sat01((s - lo) * inv);
      return lo + span * (1 - (1 - u) * (1 - v));
    }
    case 10: {
      const u = sat01((b - lo) * inv), v = sat01((s - lo) * inv);
      return lo + span * (u < 0.5 ? 2 * u * v : 1 - 2 * (1 - u) * (1 - v));
    }
    case 11: return Math.abs(b - s);
    case 12: {
      const e = s < 0 ? 0 : s > 64 ? 64 : s;
      const m = Math.pow(Math.abs(b), e);
      return b < 0 ? -m : m;
    }
    case 13: {
      const a = fin(p0), c = fin(p1), l = a < c ? a : c, h = a < c ? c : a;
      return b < l ? l : b > h ? h : b;
    }
    case 14: {
      const a = fin(p0), c = fin(p1);
      const t = c === a ? (b >= a ? 1 : 0) : sat01((b - a) / (c - a));
      return fin(p2) + (fin(p3) - fin(p2)) * t;
    }
    case 15: return lo + span * smoothstepSafe(fin(p0), fin(p1), sat01((b - lo) * inv));
    case 16: {
      const w = Math.abs(fin(p1)), c = fin(p0);
      return lo + span * smoothstepSafe(c - w, c + w, sat01((b - lo) * inv));
    }
    case 17: return lo + hi - b;
    case 18: return s;
    default: return s;
  }
}

/** Quadratic smooth maximum (C¹): x + w·g((y − x)/w) with g as in scalarComposite; w = 0 -> max. */
export function smoothMaxQ(x: number, y: number, w: number): number {
  if (!(w > 0)) return x > y ? x : y;
  const d = (y - x) / w;
  if (d <= -1) return x;
  if (d >= 1) return y;
  return x + (w * (d + 1) * (d + 1)) / 4;
}

/**
 * Composite a scalar op onto a canvas value: r = clamp(b + (op(b, s) - b) a, lo, hi), a clamped to 0..1.
 * heightBlend ("the taller layer wins, softly"): a C¹ quadratic smooth maximum
 *   smax_w(b, s') = b + w·g((s' − b)/w),  g(x) = 0 (x ≤ −1), (x + 1)²/4 (|x| < 1), x (x ≥ 1),
 *   r = b + a (smax_w(b, s + p1) − b),   w = |p0| the transition width (m), p1 a lift added to the layer.
 * a = 0 is the identity; w = 0 is max(b, s + p1); r is monotone non-decreasing in s, b and a, and
 * commutative in (b, s) at a = 1, p1 = 0 (g(−x) = g(x) − x); outside the transition it is exactly the
 * taller value; inside it exceeds max(b, s) by at most w/4 (at the crossing) — the price of being
 * smooth AND monotone (a lerp-by-smoothstep dips below the taller value: QC OPS-12).
 */
export function scalarComposite(code: number, b0: number, s0: number, a0: number, p0: number, p1: number, p2: number, p3: number, lo: number, hi: number): number {
  const b = fin(b0), a = sat01(a0);
  let r: number;
  if (code === 18) {
    const s = fin(s0) + fin(p1), w = Math.abs(fin(p0));
    r = b + a * (smoothMaxQ(b, s, w) - b);
  } else {
    r = b + (scalarOp(code, b, s0, p0, p1, p2, p3, lo, hi) - b) * a;
  }
  r = fin(r);
  return r < lo ? lo : r > hi ? hi : r;
}

// ---------------------------------------------------------------------------------------
// Documentation tables (generated into docs/wave-tex/LAYERS.md by the test suite).

/** One row of the operator table. */
export interface OperatorDoc {
  id: string;
  kind: "color-separable" | "color-non-separable" | "scalar";
  formula: string;
  /** Commutative in (b, s) for alpha = 1 (checked by the property tests). */
  commutative: boolean;
  /** Neutral source value(s): B(b, n) = b for every b (when one exists). */
  identity?: string;
}

export const OPERATOR_DOCS: readonly OperatorDoc[] = [
  { id: "normal", kind: "color-separable", formula: "s", commutative: false, identity: "alpha = 0" },
  { id: "multiply", kind: "color-separable", formula: "b·s", commutative: true, identity: "s = 1 (white)" },
  { id: "screen", kind: "color-separable", formula: "1 − (1−b)(1−s)", commutative: true, identity: "s = 0 (black)" },
  { id: "overlay", kind: "color-separable", formula: "b<½ ? 2bs : 1−2(1−b)(1−s)", commutative: false, identity: "s = ½" },
  { id: "softLight", kind: "color-separable", formula: "s<½ ? 2bs+b²(1−2s) : 2b(1−s)+√b(2s−1) (Photoshop, v1)", commutative: false, identity: "s = ½" },
  { id: "add", kind: "color-separable", formula: "min(1, b+s) (= linearDodge)", commutative: true, identity: "s = 0" },
  { id: "hardLight", kind: "color-separable", formula: "s<½ ? 2bs : 1−2(1−b)(1−s)", commutative: false, identity: "s = ½" },
  { id: "vividLight", kind: "color-separable", formula: "s<½ ? colorBurn(b,2s) : colorDodge(b,2s−1)", commutative: false, identity: "s = ½" },
  { id: "linearLight", kind: "color-separable", formula: "clamp(b + 2s − 1)", commutative: false, identity: "s = ½" },
  { id: "pinLight", kind: "color-separable", formula: "s<½ ? min(b,2s) : max(b,2s−1)", commutative: false, identity: "s = ½" },
  { id: "hardMix", kind: "color-separable", formula: "b+s ≥ 1 ? 1 : 0", commutative: true },
  { id: "colorDodge", kind: "color-separable", formula: "b=0 ? 0 : s=1 ? 1 : min(1, b/(1−s))", commutative: false, identity: "s = 0" },
  { id: "colorBurn", kind: "color-separable", formula: "b=1 ? 1 : s=0 ? 0 : 1 − min(1,(1−b)/s)", commutative: false, identity: "s = 1" },
  { id: "linearBurn", kind: "color-separable", formula: "max(0, b+s−1)", commutative: true, identity: "s = 1" },
  { id: "darken", kind: "color-separable", formula: "min(b, s)", commutative: true, identity: "s = 1" },
  { id: "lighten", kind: "color-separable", formula: "max(b, s)", commutative: true, identity: "s = 0" },
  { id: "difference", kind: "color-separable", formula: "|b − s|", commutative: true, identity: "s = 0" },
  { id: "exclusion", kind: "color-separable", formula: "b + s − 2bs", commutative: true, identity: "s = 0" },
  { id: "subtract", kind: "color-separable", formula: "max(0, b − s)", commutative: false, identity: "s = 0" },
  { id: "divide", kind: "color-separable", formula: "s=0 ? (b=0 ? 0 : 1) : min(1, b/s)", commutative: false, identity: "s = 1" },
  { id: "softLightW3C", kind: "color-separable", formula: "W3C soft light (D(b) = b≤¼ ? ((16b−12)b+4)b : √b)", commutative: false, identity: "s = ½" },
  { id: "hue", kind: "color-non-separable", formula: "SetLum(SetSat(Cs, Sat(Cb)), Lum(Cb))", commutative: false },
  { id: "saturation", kind: "color-non-separable", formula: "SetLum(SetSat(Cb, Sat(Cs)), Lum(Cb))", commutative: false },
  { id: "color", kind: "color-non-separable", formula: "SetLum(Cs, Lum(Cb))", commutative: false },
  { id: "luminosity", kind: "color-non-separable", formula: "SetLum(Cb, Lum(Cs))", commutative: false },
  { id: "replace", kind: "scalar", formula: "s", commutative: false, identity: "alpha = 0" },
  { id: "add", kind: "scalar", formula: "b + s", commutative: true, identity: "s = 0" },
  { id: "subtract", kind: "scalar", formula: "b − s", commutative: false, identity: "s = 0" },
  { id: "multiply", kind: "scalar", formula: "b·s", commutative: true, identity: "s = 1" },
  { id: "divide", kind: "scalar", formula: "b / (|s|<1e−6 ? ±1e−6 : s)", commutative: false, identity: "s = 1" },
  { id: "min", kind: "scalar", formula: "min(b, s)", commutative: true, identity: "s = hi" },
  { id: "max", kind: "scalar", formula: "max(b, s)", commutative: true, identity: "s = lo" },
  { id: "average", kind: "scalar", formula: "(b + s)/2", commutative: true },
  { id: "lerp", kind: "scalar", formula: "b + (s − b)·p0 (commutes only at p0 = ½)", commutative: false, identity: "p0 = 0" },
  { id: "screen", kind: "scalar", formula: "lo + (hi−lo)(1 − (1−u)(1−v))", commutative: true, identity: "s = lo" },
  { id: "overlay", kind: "scalar", formula: "lo + (hi−lo)·overlay(u, v)", commutative: false, identity: "v = ½" },
  { id: "difference", kind: "scalar", formula: "|b − s|", commutative: true },
  { id: "power", kind: "scalar", formula: "sign(b)|b|^clamp(s,0,64)", commutative: false, identity: "s = 1" },
  { id: "clamp", kind: "scalar", formula: "clamp(b, min(p0,p1), max(p0,p1))", commutative: false },
  { id: "remap", kind: "scalar", formula: "p2 + (p3−p2)·clamp01((b−p0)/(p1−p0))", commutative: false },
  { id: "smoothstep", kind: "scalar", formula: "lo + (hi−lo)·S(p0, p1, u)", commutative: false },
  { id: "threshold", kind: "scalar", formula: "lo + (hi−lo)·S(p0−p1, p0+p1, u)", commutative: false },
  { id: "invert", kind: "scalar", formula: "lo + hi − b", commutative: false },
  { id: "heightBlend", kind: "scalar", formula: "b + a·(smax_w(b, s + p1) − b), smax_w(x,y) = x + w·g((y−x)/w), g = 0 (x ≤ −1), (x+1)²/4 (|x| < 1), x (x ≥ 1), w = |p0|", commutative: true, identity: "alpha = 0" },
];

/** Every operator id (colour + scalar). */
export type OperatorId = ColorBlendMode | ScalarOp;
