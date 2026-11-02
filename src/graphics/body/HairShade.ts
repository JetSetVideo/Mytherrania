// Wave X lane H: hair SHADING numbers (pure — no THREE). The mesh paints each card's vertices
// from these, so the tests read the same numbers the screen shows:
//   * root -> tip: the root is darker (packed hair, scalp shadow), the tip lighter (sun-bleached,
//     thinner), a multiplier rootTip(t) on the strand's colour;
//   * per-clump tone: each clump draws a lightness factor and a slight warm/cool shift around
//     the ancestry colour, so the mass reads as SHADES of the base colour, not one flat paint;
//   * grey: greyFraction(race, age) (Age.ts) of the hair is grey. A share 0.8·g of the clumps is
//     painted grey whole; inside the others the shader greys single sub-strands at the rate
//     subStrandGrey(g), so the EXPECTED grey share is exactly g (salt and pepper, not a dye job).
//     Elves silver (a cool light grey), the others whiten with g.

import { hexToLinear } from "../paint/Blend.ts";
import { hashUnit } from "./HairGrowth.ts";

export type Rgb = [number, number, number];

/** Stated shading numbers. */
export const HAIR_SHADE = {
  /** rootTip(t) = rootK + (tipK − rootK)·t^tipCurve. */
  rootK: 0.58,
  tipK: 1.12,
  tipCurve: 0.8,
  /** Per-clump lightness factor range and warm/cool shift amplitude (linear channels). */
  toneMin: 0.82,
  toneMax: 1.16,
  warmShift: 0.06,
  /** Share of g painted as whole grey clumps (the rest is sub-strand salt and pepper). */
  clumpGreyShare: 0.8,
  /** Grey tones: a dark grey at low g whitening to near white at high g; elves silver. */
  greyLow: "#8f8c87",
  greyHigh: "#e4e1da",
  silver: "#c7d0dc",
  /** The underlayer (scalp tint under the cards) is this dark a root tone. */
  underK: 0.68,
} as const;

/** Root -> tip multiplier at t in [0, 1] (0 = root). */
export function rootTip(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return HAIR_SHADE.rootK + (HAIR_SHADE.tipK - HAIR_SHADE.rootK) * u ** HAIR_SHADE.tipCurve;
}

/** One clump's tone: lightness factor and a warm(+)/cool(−) shift. */
export function clumpTone(clump: number, seed: number): { k: number; warm: number } {
  const a = hashUnit(seed ^ Math.imul(clump + 1, 0x9e3779b1)), b = hashUnit(seed ^ Math.imul(clump + 7, 0x85ebca6b));
  return { k: HAIR_SHADE.toneMin + (HAIR_SHADE.toneMax - HAIR_SHADE.toneMin) * a, warm: (b - 0.5) * 2 * HAIR_SHADE.warmShift };
}

/** Whether clump `clump` is painted grey whole, for grey fraction g. */
export function clumpIsGrey(clump: number, seed: number, g: number): boolean {
  return hashUnit(seed ^ Math.imul(clump + 3, 0x27d4eb2f)) < HAIR_SHADE.clumpGreyShare * Math.max(0, Math.min(1, g));
}

/** The sub-strand grey rate inside non-grey clumps so the expected total share is exactly g. */
export function subStrandGrey(g: number): number {
  const G = Math.max(0, Math.min(1, g)), c = HAIR_SHADE.clumpGreyShare * G;
  return c >= 1 ? 0 : (G - c) / (1 - c);
}

/** Expected grey share of the head for grey fraction g (equals g by construction). */
export function expectedGreyShare(g: number): number {
  const G = Math.max(0, Math.min(1, g)), c = HAIR_SHADE.clumpGreyShare * G;
  return c + (1 - c) * subStrandGrey(G);
}

/** The grey this race turns (linear RGB): elves silver, others dark grey -> white with g. */
export function greyRgb(race: string | null | undefined, g: number): Rgb {
  if (race === "elf") return hexToLinear(HAIR_SHADE.silver) as Rgb;
  const lo = hexToLinear(HAIR_SHADE.greyLow), hi = hexToLinear(HAIR_SHADE.greyHigh);
  const t = Math.max(0, Math.min(1, g));
  return [lo[0] + (hi[0] - lo[0]) * t, lo[1] + (hi[1] - lo[1]) * t, lo[2] + (hi[2] - lo[2]) * t];
}

/** A strand vertex colour (linear RGB): base × clump tone (+ warmth), grey if the clump is, × rootTip(t). */
export function strandColour(base: Rgb, tone: { k: number; warm: number }, grey: Rgb | null, t: number): Rgb {
  const c: Rgb = grey
    ? [grey[0], grey[1], grey[2]]
    : [base[0] * tone.k * (1 + tone.warm), base[1] * tone.k, base[2] * tone.k * (1 - tone.warm)];
  const m = grey ? 0.8 + 0.25 * t : rootTip(t); // grey hair is lighter at the root than pigment
  return [Math.min(1, c[0] * m), Math.min(1, c[1] * m), Math.min(1, c[2] * m)];
}

/** Rec.709 luminance of a linear RGB triple. */
export function luminance(c: Rgb): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
