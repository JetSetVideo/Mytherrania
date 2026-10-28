// Relevance: the colour bounds that keep generated paint believable ("relevant") under
// the cel shader, the tool that pulls a colour inside them, and the report the tests
// use to prove every recipe stays inside them. Pure module.
//
// Measures (both on the sRGB-encoded colour, channels 0..1):
//   chroma     C = max(r, g, b) - min(r, g, b). 0 = grey; ~1 = pure neon (#00ff00).
//              HSL saturation is NOT used as the bound: it inflates near white/black
//              (#f0d0a8, a pale skin, has HSL S = 0.71 but C = 0.28).
//   luminance  Y, Rec. 709 relative luminance of the LINEAR colour (0 black .. 1 white).
// Why the bounds are what they are:
//   - The game's own SKIN_TONES and race/subrace tints span C 0.09..0.44 and Y 0.25..0.67.
//     The BASE tone is held ~10% inside that top (C <= 0.40, Y <= 0.62) so the layers
//     above it have headroom; the composite skin may then go ~5% beyond the palette
//     (C <= 0.46, Y <= 0.70) and down to Y 0.12 for darker individuals.
//   - The cel shader multiplies colour by up to ~1.06 (ambient 0.437 + light band 0.62)
//     plus rim, so Y > 0.80 blows out to white in the lit band, and C > 0.55 reads as
//     a dyed / neon surface rather than skin or paint.
//   - Y < 0.008 (below #171717) turns into the ink-outline colour and loses the form.

import type { MeshData } from "../body/contracts.ts";
import { contrastRatio, hexToHsl, hslToRgb, relativeLuminance, rgbToHex, srgbToLinear } from "./Blend.ts";
import { REGION_INDEX } from "./Patterns.ts";

/** A box in (chroma, luminance) space. */
export interface ColourBounds { chroma: [number, number]; luminance: [number, number] }

/** Base skin tone of any recipe (C, Y): the coat every other layer modulates. */
export const SKIN_BOUNDS: ColourBounds = { chroma: [0.08, 0.40], luminance: [0.14, 0.62] };
/** Pigments, inks and garments: may be dark, never neon nor blown-out. */
export const INK_BOUNDS: ColourBounds = { chroma: [0, 0.45], luminance: [0.012, 0.62] };
/** Hair: from near-black to ash blond, never neon. */
export const HAIR_BOUNDS: ColourBounds = { chroma: [0, 0.45], luminance: [0.012, 0.70] };
/** Every painted vertex, after compositing. */
export const VERTEX_BOUNDS: ColourBounds = { chroma: [0, 0.55], luminance: [0.008, 0.80] };
/** The area-weighted median skin colour (not hair/nail): the colour the body reads as. */
export const SKIN_MEDIAN_BOUNDS: ColourBounds = { chroma: [0.08, 0.46], luminance: [0.12, 0.70] };
/**
 * Tonal spread of the skin: WCAG contrast between its 10th and 90th luminance
 * percentiles (by surface AREA, so a densely tessellated part does not dominate). >= MIN: the layers are visible at all; <= MAX: 3:1 is WCAG's threshold
 * for legible graphics, so the bulk of the skin stays one tonal family and only small
 * marks (< 10% of vertices) may contrast harder.
 */
export const SKIN_SPREAD = { min: 1.02, max: 3.0 } as const;

/** sRGB chroma: max - min of the channels. */
export function chromaOf(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** Relative luminance of an sRGB-encoded colour (decoded to linear first). */
export function luminanceOfSrgb(r: number, g: number, b: number): number {
  return relativeLuminance(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
}

/** (chroma, luminance) of "#rrggbb". */
export function measureHex(hex: string): { chroma: number; luminance: number } {
  const c = hexToHsl(hex), rgb = hslToRgb(c.h, c.s, c.l);
  return { chroma: chromaOf(rgb[0], rgb[1], rgb[2]), luminance: luminanceOfSrgb(rgb[0], rgb[1], rgb[2]) };
}

/** Luminance of an HSL colour. */
function lumHsl(h: number, s: number, l: number): number {
  const rgb = hslToRgb(h, s, l);
  return luminanceOfSrgb(rgb[0], rgb[1], rgb[2]);
}

/**
 * Pull a colour inside `bounds`, keeping its hue: luminance is fixed by bisection on
 * HSL lightness (Y is monotonic in L at fixed H, S), chroma by rescaling HSL saturation
 * (C = S (1 - |2L - 1|)). Alternates both corrections a few times; a colour already
 * inside is returned unchanged.
 */
export function boundColour(hex: string, bounds: ColourBounds): string {
  const c = hexToHsl(hex);
  let { h, s, l } = c;
  const [cLo, cHi] = bounds.chroma, [yLo, yHi] = bounds.luminance;
  let changed = false;
  for (let pass = 0; pass < 4; pass++) {
    const y = lumHsl(h, s, l);
    if (y < yLo || y > yHi) {
      const target = y < yLo ? yLo : yHi;
      let lo = 0, hi = 1;
      for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (lumHsl(h, s, mid) < target) lo = mid; else hi = mid; }
      l = y < yLo ? hi : lo; changed = true;
    }
    const span = 1 - Math.abs(2 * l - 1);
    const chroma = s * span;
    if (span > 1e-6 && chroma > cHi) { s = cHi / span; changed = true; }
    else if (span > 1e-6 && chroma < cLo) { s = Math.min(1, cLo / span); changed = true; }
  }
  if (!changed) return hex.toLowerCase();
  const rgb = hslToRgb(h, s, l);
  return rgbToHex(rgb[0], rgb[1], rgb[2]);
}

/** Is "#rrggbb" inside `bounds` (with a tolerance for 8-bit rounding)? */
export function insideBounds(hex: string, bounds: ColourBounds, tolerance = 0.004): boolean {
  const m = measureHex(hex);
  return m.chroma >= bounds.chroma[0] - tolerance && m.chroma <= bounds.chroma[1] + tolerance &&
    m.luminance >= bounds.luminance[0] - tolerance && m.luminance <= bounds.luminance[1] + tolerance;
}

/** What a painted mesh measures, and which bounds (if any) it breaks. */
export interface RelevanceReport {
  vertices: number;
  maxChroma: number;
  minLuminance: number;
  maxLuminance: number;
  skinMedianChroma: number;
  skinMedianLuminance: number;
  /** WCAG contrast between the 10th and 90th percentile skin luminance. */
  skinSpread: number;
  /** Human-readable broken bounds; empty when the paint is "relevant". */
  violations: string[];
}

/**
 * Surface area owned by each vertex: a third of every incident triangle's area (m^2).
 * Percentiles weighted by it measure "how much of the body", independent of tessellation.
 */
export function vertexAreas(mesh: MeshData): Float64Array {
  const P = mesh.positions, I = mesh.indices, w = new Float64Array(P.length / 3);
  for (let t = 0; t + 2 < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 3;
    w[I[t]] += area; w[I[t + 1]] += area; w[I[t + 2]] += area;
  }
  return w;
}

/** Weighted quantile q (0..1) of `values` over the vertex list `ids`, weights `w`. */
function weightedQuantile(values: Float64Array, w: Float64Array, ids: number[], q: number): number {
  if (ids.length === 0) return NaN;
  const order = [...ids].sort((a, b) => values[a] - values[b]);
  let total = 0;
  for (const i of order) total += w[i];
  if (total <= 0) return values[order[Math.floor(q * (order.length - 1))]];
  let acc = 0;
  for (const i of order) { acc += w[i]; if (acc >= q * total) return values[i]; }
  return values[order[order.length - 1]];
}

/**
 * Measure painted vertex colours against VERTEX_BOUNDS, SKIN_MEDIAN_BOUNDS and
 * SKIN_SPREAD. `space` is the space of `colours` ("linear" = paintVertices' default).
 * Skin = every region except hair and nail, minus `excludeRegions` (e.g. a garment).
 * Medians and percentiles are weighted by vertex area (see vertexAreas).
 */
export function relevanceReport(
  mesh: MeshData, colours: Float32Array, space: "linear" | "srgb" = "linear", excludeRegions: number[] = [],
): RelevanceReport {
  const n = mesh.positions.length / 3;
  const skip = new Set([REGION_INDEX.hair, REGION_INDEX.nail, ...excludeRegions]);
  const area = vertexAreas(mesh);
  const C = new Float64Array(n), Y = new Float64Array(n), skin: number[] = [];
  let maxC = 0, minY = Infinity, maxY = -Infinity;
  const enc = (v: number) => space === "linear" ? (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) : v;
  for (let i = 0; i < n; i++) {
    const r = enc(colours[i * 3]), g = enc(colours[i * 3 + 1]), b = enc(colours[i * 3 + 2]);
    C[i] = chromaOf(r, g, b); Y[i] = luminanceOfSrgb(r, g, b);
    maxC = Math.max(maxC, C[i]); minY = Math.min(minY, Y[i]); maxY = Math.max(maxY, Y[i]);
    if (!skip.has(mesh.region[i])) skin.push(i);
  }
  const medC = weightedQuantile(C, area, skin, 0.5), medY = weightedQuantile(Y, area, skin, 0.5);
  const spread = contrastRatio(weightedQuantile(Y, area, skin, 0.1), weightedQuantile(Y, area, skin, 0.9));
  const v: string[] = [];
  if (maxC > VERTEX_BOUNDS.chroma[1]) v.push(`vertex chroma ${maxC.toFixed(3)} > ${VERTEX_BOUNDS.chroma[1]} (neon)`);
  if (minY < VERTEX_BOUNDS.luminance[0]) v.push(`vertex luminance ${minY.toFixed(4)} < ${VERTEX_BOUNDS.luminance[0]} (crushed black)`);
  if (maxY > VERTEX_BOUNDS.luminance[1]) v.push(`vertex luminance ${maxY.toFixed(3)} > ${VERTEX_BOUNDS.luminance[1]} (blown out)`);
  const sb = SKIN_MEDIAN_BOUNDS;
  if (medC < sb.chroma[0]) v.push(`skin median chroma ${medC.toFixed(3)} < ${sb.chroma[0]} (muddy grey)`);
  if (medC > sb.chroma[1]) v.push(`skin median chroma ${medC.toFixed(3)} > ${sb.chroma[1]} (dyed)`);
  if (medY < sb.luminance[0]) v.push(`skin median luminance ${medY.toFixed(3)} < ${sb.luminance[0]} (muddy dark)`);
  if (medY > sb.luminance[1]) v.push(`skin median luminance ${medY.toFixed(3)} > ${sb.luminance[1]} (washed out)`);
  if (spread < SKIN_SPREAD.min) v.push(`skin spread ${spread.toFixed(3)} < ${SKIN_SPREAD.min} (flat, layers invisible)`);
  if (spread > SKIN_SPREAD.max) v.push(`skin spread ${spread.toFixed(3)} > ${SKIN_SPREAD.max} (patterns overpower)`);
  return {
    vertices: n, maxChroma: maxC, minLuminance: minY, maxLuminance: maxY,
    skinMedianChroma: medC, skinMedianLuminance: medY, skinSpread: spread, violations: v,
  };
}
