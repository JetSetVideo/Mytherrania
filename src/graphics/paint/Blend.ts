// Blend: the six paint blend modes (Photoshop semantics, per channel, 0..1) and the
// colour helpers paint needs (hex <-> sRGB <-> linear, HSL, luminance). Pure module.
//
// Vocabulary:
//   base      the colour already on the canvas (the layers below), per channel 0..1.
//   top       the colour of the layer being applied, per channel 0..1.
//   alpha     how much of the blended result replaces the base: opacity * coverage * mask.
//   sRGB      display-encoded channel (what "#rrggbb" stores). Photoshop blends in this
//             space, so paint composites in sRGB and converts to linear only at the end.
//   linear    light-proportional channel; what three.js expects in a vertex-colour
//             attribute and in ShaderMaterial uniforms built from THREE.Color.

import type { BlendMode } from "../body/contracts.ts";

/** Every blend mode, in a fixed order; a mode's index is its numeric code. */
export const BLEND_MODES: readonly BlendMode[] = ["normal", "multiply", "screen", "overlay", "softLight", "add"];

/** Numeric code of a mode (index in BLEND_MODES), so the per-vertex loop switches on an int. */
export function blendCode(mode: BlendMode): number {
  const i = BLEND_MODES.indexOf(mode);
  return i < 0 ? 0 : i;
}

/**
 * Blend one channel by numeric mode code (see BLEND_MODES). Formulas, with b = base and
 * s = top (Photoshop / Wikipedia "Blend modes"):
 *   normal    s
 *   multiply  b * s                                   (always darkens)
 *   screen    1 - (1 - b)(1 - s)                      (always lightens)
 *   overlay   b < 0.5 ? 2bs : 1 - 2(1 - b)(1 - s)     (contrast keyed on the BASE)
 *   softLight s < 0.5 ? 2bs + b^2(1 - 2s)
 *                     : 2b(1 - s) + sqrt(b)(2s - 1)   (Photoshop's soft light; s = 0.5 is identity)
 *   add       min(1, b + s)                           (linear dodge)
 */
export function blendChannelCode(code: number, b: number, s: number): number {
  switch (code) {
    case 1: return b * s;
    case 2: return 1 - (1 - b) * (1 - s);
    case 3: return b < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
    case 4: return s < 0.5 ? 2 * b * s + b * b * (1 - 2 * s) : 2 * b * (1 - s) + Math.sqrt(b) * (2 * s - 1);
    case 5: return Math.min(1, b + s);
    default: return s;
  }
}

/** Blend one channel by mode name. See blendChannelCode for the equations. */
export function blendChannel(mode: BlendMode, base: number, top: number): number {
  return blendChannelCode(blendCode(mode), base, top);
}

/**
 * Composite one channel: result = lerp(base, blend(base, top), alpha), alpha in 0..1.
 * alpha = 0 leaves the base untouched; alpha = 1 gives the pure blend.
 */
export function compositeChannel(mode: BlendMode, base: number, top: number, alpha: number): number {
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  return base + (blendChannel(mode, base, top) - base) * a;
}

/** IEC 61966-2-1 sRGB decode: c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055)^2.4. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** IEC 61966-2-1 sRGB encode: c <= 0.0031308 ? 12.92c : 1.055 c^(1/2.4) - 0.055. */
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** An RGB triple, 0..1 per channel (the space is stated by whoever returns it). */
export type Rgb = [number, number, number];

/** Parse "#rrggbb" (or "rrggbb") into sRGB channels 0..1. Invalid input reads as black. */
export function hexToRgb(hex: string, out: Rgb = [0, 0, 0]): Rgb {
  const v = parseInt(hex.startsWith("#") ? hex.slice(1, 7) : hex.slice(0, 6), 16);
  const n = Number.isFinite(v) ? v : 0;
  out[0] = ((n >> 16) & 255) / 255; out[1] = ((n >> 8) & 255) / 255; out[2] = (n & 255) / 255;
  return out;
}

/** sRGB channels 0..1 -> "#rrggbb" (clamped, rounded to the nearest 8-bit code). */
export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return "#" + c(r) + c(g) + c(b);
}

/** "#rrggbb" -> linear channels 0..1 (what THREE.Color(hex) holds with colour management on). */
export function hexToLinear(hex: string, out: Rgb = [0, 0, 0]): Rgb {
  hexToRgb(hex, out);
  out[0] = srgbToLinear(out[0]); out[1] = srgbToLinear(out[1]); out[2] = srgbToLinear(out[2]);
  return out;
}

/** Rec. 709 / WCAG relative luminance of LINEAR channels: Y = 0.2126R + 0.7152G + 0.0722B. */
export function relativeLuminance(rLin: number, gLin: number, bLin: number): number {
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

/** WCAG contrast ratio between two relative luminances: (Ymax + 0.05) / (Ymin + 0.05), >= 1. */
export function contrastRatio(y1: number, y2: number): number {
  const hi = Math.max(y1, y2), lo = Math.min(y1, y2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Hue (0..1 turn), saturation and lightness (0..1) of an sRGB colour. */
export interface Hsl { h: number; s: number; l: number }

/** sRGB 0..1 -> HSL. Saturation is the HSL one: chroma / (1 - |2L - 1|). */
export function rgbToHsl(r: number, g: number, b: number, out: Hsl = { h: 0, s: 0, l: 0 }): Hsl {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2, chroma = max - min;
  let h = 0, s = 0;
  if (chroma > 1e-9) {
    s = chroma / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / chroma + 6) % 6;
    else if (max === g) h = (b - r) / chroma + 2;
    else h = (r - g) / chroma + 4;
    h /= 6;
  }
  out.h = h; out.s = Math.min(1, s); out.l = l;
  return out;
}

/** HSL -> sRGB 0..1 (hue in turns, wrapped). */
export function hslToRgb(h: number, s: number, l: number, out: Rgb = [0, 0, 0]): Rgb {
  const hh = ((h % 1) + 1) % 1;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = hh * 6, x = c * (1 - Math.abs((hp % 2) - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; } else if (hp < 2) { r = x; g = c; } else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; } else if (hp < 5) { r = x; b = c; } else { r = c; b = x; }
  out[0] = r + m; out[1] = g + m; out[2] = b + m;
  return out;
}

/** "#rrggbb" -> HSL. */
export function hexToHsl(hex: string): Hsl {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHsl(r, g, b);
}

/** HSL -> "#rrggbb". */
export function hslToHex(h: number, s: number, l: number): string {
  const [r, g, b] = hslToRgb(h, s, l);
  return rgbToHex(r, g, b);
}

/**
 * Shift a colour in HSL: hue += dHue (turns), saturation *= satMul, lightness += dLight,
 * each result clamped to 0..1. The one tool recipes use to derive related tones
 * (a darker mottle, a ruddier cheek) from a base, so a palette stays harmonious.
 */
export function shiftHsl(hex: string, dHue: number, satMul: number, dLight: number): string {
  const c = hexToHsl(hex);
  const s = Math.max(0, Math.min(1, c.s * satMul));
  const l = Math.max(0, Math.min(1, c.l + dLight));
  return hslToHex(c.h + dHue, s, l);
}

/**
 * Shade: multiply every sRGB channel by k (0..1). Darkens while scaling chroma by k too,
 * the way more pigment / less light behaves. (Lowering HSL lightness instead RAISES
 * the chroma of a light colour, which turns darker skin patches orange.)
 */
export function shadeHex(hex: string, k: number): string {
  const c = hexToRgb(hex), f = Math.max(0, k);
  return rgbToHex(c[0] * f, c[1] * f, c[2] * f);
}

/** Tint: move every sRGB channel toward white by k (0..1): c + (1 - c) k. Chroma scales by 1 - k. */
export function tintHex(hex: string, k: number): string {
  const c = hexToRgb(hex), f = Math.max(0, Math.min(1, k));
  return rgbToHex(c[0] + (1 - c[0]) * f, c[1] + (1 - c[1]) * f, c[2] + (1 - c[2]) * f);
}

/** Mix two "#rrggbb" colours in sRGB: t = 0 -> a, t = 1 -> b (t clamped). */
export function mixHexSrgb(a: string, b: string, t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const ca = hexToRgb(a), cb = hexToRgb(b);
  return rgbToHex(ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k);
}
