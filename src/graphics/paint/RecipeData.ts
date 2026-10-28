// RecipeData: the named base parameters paint recipes are derived from. Pure data,
// each entry with the reason it has its value. Recipes.ts turns these into layers.
//
// Units: traits are 0..1 strengths (0 = absent, 1 = the strongest the recipe allows);
// hues are turns (0 = red, 1/3 = green, 2/3 = blue); saturation and lightness are HSL 0..1.

import type { Region } from "../body/contracts.ts";
import type { TattooSymbol } from "./Symbols.ts";
import type { WARPAINT_MOTIFS } from "./Patterns.ts";

/** The nine base parameters every paint layer of a body is derived from. */
export interface PaintTraits {
  /** Blotchiness of the skin. */
  mottle: number;
  /** Dark top surfaces / light undersides. */
  counterShade: number;
  /** Flush at the face, ears, hands and feet. */
  ruddiness: number;
  /** Visible veins and sheen. */
  translucency: number;
  /** Freckle density. */
  freckling: number;
  /** Keratin scale plates. */
  hide: number;
  /** Warpaint culture: >= 0.5 wears bold sign warpaint, below gets a sign tattoo. */
  warpaint: number;
  /** Natural markings (spots / stripes). */
  markings: number;
  /** Signed HSL-lightness offset of the base tone (-0.1..0.1). */
  lift: number;
}

/** Race baselines. */
export const RACE_TRAITS: Record<string, PaintTraits> = {
  // Humans: the reference. Some blotching, sun flush, a few freckles, rare warpaint.
  human: { mottle: 0.3, counterShade: 0.35, ruddiness: 0.35, translucency: 0.1, freckling: 0.3, hide: 0, warpaint: 0.2, markings: 0, lift: 0 },
  // Elves: lighter, even, translucent skin (veins + sheen), almost no freckles; tattoo culture.
  elf: { mottle: 0.15, counterShade: 0.25, ruddiness: 0.1, translucency: 0.6, freckling: 0.1, hide: 0, warpaint: 0.1, markings: 0.1, lift: 0.04 },
  // Dwarves: weathered, ruddy face and hands from the forge, heavy freckling.
  dwarf: { mottle: 0.45, counterShade: 0.3, ruddiness: 0.8, translucency: 0.05, freckling: 0.65, hide: 0, warpaint: 0.3, markings: 0, lift: -0.02 },
  // Orks: mottled green hide, strong countershading, scale plates, warpaint culture.
  ork: { mottle: 0.75, counterShade: 0.55, ruddiness: 0.15, translucency: 0.05, freckling: 0, hide: 0.6, warpaint: 0.9, markings: 0.35, lift: -0.04 },
};

/** How a race/subrace draws natural markings. */
export interface MarkingStyle {
  pattern: "spots" | "stripes";
  regions: readonly Region[];
  /** HSL shift of the marking from the skin tone. */
  hueShift: number;
  satMul: number;
  lightShift: number;
  why: string;
}

/** Default marking style per race (used when the subrace defines none). */
export const MARKING_STYLE: Record<string, MarkingStyle> = {
  elf: { pattern: "spots", regions: ["torso", "upperArm", "thigh"], hueShift: 0.02, satMul: 0.9, lightShift: -0.08, why: "faint dappling, like light through leaves" },
  ork: { pattern: "stripes", regions: ["torso", "upperArm", "thigh", "shin"], hueShift: 0.01, satMul: 1.1, lightShift: -0.16, why: "darker hide banding" },
};

/** Subrace tweaks: trait deltas (added to the race), an own marking style, a vein hue. */
export const SUBRACE_PAINT: Record<string, { traits?: Partial<PaintTraits>; marking?: MarkingStyle; veinHue?: number }> = {
  imperial: { traits: { warpaint: -0.15, freckling: -0.1 } },                 // city-bred, sun-sheltered
  nomad: { traits: { ruddiness: 0.15, freckling: 0.2, counterShade: 0.1 } },   // sun- and wind-weathered
  islander: { traits: { warpaint: 0.35, ruddiness: 0.1 } },                   // tide-paint culture
  high: { traits: { translucency: 0.2, lift: 0.02 } },                         // star-touched sheen
  wood: {
    traits: { markings: 0.5 },
    marking: { pattern: "spots", regions: ["torso", "upperArm", "foreArm", "thigh", "shin"], hueShift: 0.06, satMul: 0.9, lightShift: -0.12, why: "green-brown forest dapple" },
  },
  dark: { traits: { translucency: 0.15, counterShade: 0.1 }, veinHue: 0.78 }, // violet veins of the Obsidian Halls
  mountain: { traits: { mottle: 0.2 } },                                       // stone-grey weathering
  forge: {
    traits: { ruddiness: 0.1, markings: 0.5 },
    marking: { pattern: "spots", regions: ["foreArm", "hand"], hueShift: 0, satMul: 0.4, lightShift: -0.3, why: "soot and burn marks" },
  },
  deep: { traits: { ruddiness: -0.5, translucency: 0.25, freckling: -0.3, lift: 0.02 } }, // pale delvers who never see sun
  greenhide: {
    traits: { markings: 0.4 },
    marking: { pattern: "stripes", regions: ["torso", "upperArm", "thigh", "shin"], hueShift: 0.02, satMul: 1.15, lightShift: -0.18, why: "marsh camouflage banding" },
  },
  ironhide: { traits: { hide: 0.3, mottle: 0.1 } },                            // armour-like hide covers more of the body
  bloodfang: {
    traits: { markings: 0.3, warpaint: 0.1 },
    marking: { pattern: "stripes", regions: ["torso", "upperArm", "foreArm"], hueShift: -0.2, satMul: 0.9, lightShift: -0.14, why: "red-brown steppe striping" },
  },
};

/** A birth sign's mark: tattoo glyph, warpaint motif, and pigment [hue, sat, light]. */
export interface SignPaint {
  symbol: TattooSymbol;
  motif: typeof WARPAINT_MOTIFS[number];
  pigment: [number, number, number];
  why: string;
}

/** One mark per birth sign (Birthsight.ts ids). */
export const SIGN_PAINT: Record<string, SignPaint> = {
  serpent: { symbol: "serpent", motif: "zigzag", pigment: [0.38, 0.45, 0.30], why: "green scale-zigzags of the Shedding Moon" },
  mountain: { symbol: "peaks", motif: "bars", pigment: [0.08, 0.25, 0.32], why: "earth-ochre strata bars" },
  flame: { symbol: "flame", motif: "chevron", pigment: [0.01, 0.60, 0.38], why: "red-ochre upward chevrons" },
  moon: { symbol: "crescent", motif: "rings", pigment: [0.60, 0.25, 0.80], why: "pale silver tide rings" },
  storm: { symbol: "bolt", motif: "bolt", pigment: [0.62, 0.50, 0.32], why: "woad-blue lightning" },
  void: { symbol: "ring", motif: "split", pigment: [0.75, 0.25, 0.14], why: "half-face of the space between stars" },
};

/** A class accent: one layer that says what the fighter does. */
export interface ClassPaint {
  pattern: "tattoo" | "warpaint" | "veins" | "stripes";
  regions: readonly Region[];
  symbol?: TattooSymbol;
  /** tattoo projection code (TATTOO_PROJECTIONS). */
  project?: number;
  /** Where the ink colour comes from: Appearance.accent, the birth-sign ink, lighter skin, or `pigment`. */
  ink: "accent" | "sign" | "skinLight" | "pigment";
  pigment: [number, number, number];
  opacity: number;
  params?: Record<string, number>;
  why: string;
}

/** Class accents (Stats.ts ClassName). */
export const CLASS_PAINT: Record<string, ClassPaint> = {
  Barbarian: { pattern: "warpaint", regions: ["upperArm", "foreArm"], ink: "sign", pigment: [0.0, 0.55, 0.30], opacity: 0.8, params: { motif: 0, bands: 3, width: 0.4 }, why: "war stripes down the arms" },
  Warrior: { pattern: "veins", regions: ["foreArm", "upperArm", "torso", "face"], ink: "skinLight", pigment: [0, 0, 0], opacity: 0.5, params: { threshold: 0.88, sharpness: 1, octaves: 2 }, why: "pale battle scars" },
  Rogue: { pattern: "warpaint", regions: ["face"], ink: "pigment", pigment: [0.6, 0.1, 0.12], opacity: 0.85, params: { motif: 0, bands: 1, width: 0.6, offset: -0.3 }, why: "charcoal bandit mask across the eyes" },
  Assassin: { pattern: "tattoo", regions: ["foreArm"], symbol: "fang", project: 1, ink: "pigment", pigment: [0.75, 0.2, 0.15], opacity: 0.8, why: "guild fang on the knife arm" },
  Mage: { pattern: "tattoo", regions: ["foreArm"], symbol: "star", project: 0, ink: "accent", pigment: [0.72, 0.45, 0.45], opacity: 0.75, why: "arcane pentagram on the casting arm" },
  Necromancer: { pattern: "veins", regions: ["face", "neck", "hand", "foreArm"], ink: "pigment", pigment: [0.78, 0.25, 0.2], opacity: 0.5, params: { threshold: 0.7, sharpness: 2 }, why: "darkened dead-veins" },
  Archer: { pattern: "stripes", regions: ["foreArm"], ink: "pigment", pigment: [0.07, 0.35, 0.28], opacity: 0.6, params: { angle: 0, width: 0.3, warp: 0.2 }, why: "bowstring-burn bands on the forearms" },
  Priest: { pattern: "tattoo", regions: ["torso"], symbol: "sun", project: 0, ink: "accent", pigment: [0.12, 0.5, 0.55], opacity: 0.7, why: "dawn sun over the heart" },
};
