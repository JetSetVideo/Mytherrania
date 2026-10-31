// Recipes: turn who a character is (race, subrace, class, birth sign, hair, accent,
// seed) into a coherent PaintStack. Pure module.
//
// Top-down derivation (R08): a race gives nine named PaintTraits (0..1), a subrace adds
// deltas, the seed adds a small personal jitter; every layer's opacity, size and
// colour is then an equation of those traits, the skin tone, and the stature. Colours
// are derived from the skin tone by HSL shifts (so a palette stays harmonious) and are
// pulled inside the Relevance bounds, so no recipe can produce neon or muddy skin.
//
// Stack order (bottom first): skin coat -> mottling -> countershading -> flush ->
// freckles -> veins/sheen -> hide scales -> natural markings -> soles/nails -> hair ->
// birth-sign mark (warpaint or tattoo) -> class accent -> garment (optional).

import { HAIR_COLORS, nameSeed, raceBuild, SKIN_TONES } from "../../game/RaceAppearance.ts";
import { BUILDS, buildFor, raceSilhouette } from "../../game/BodyProfile.ts";
import { buildMuscleTerm } from "../body/Proportions.ts";
import type { CharacterProfile } from "../../game/Characters.ts";
import { clamp01, rng32 } from "../../core/MathCore.ts";
import type { PaintLayer, PaintStack, PatternKind, Region } from "../body/contracts.ts";
import { hexToHsl, hexToRgb, hslToHex, shadeHex, shiftHsl, tintHex } from "./Blend.ts";
import { definitionLayers } from "./Definition.ts";
import { hashCell } from "./Noise.ts";
import { GRADIENT_AXES, WARPAINT_MOTIFS } from "./Patterns.ts";
import { boundColour, HAIR_BOUNDS, INK_BOUNDS, SKIN_BOUNDS } from "./Relevance.ts";
import { symbolIndex, type TattooSymbol } from "./Symbols.ts";
import { CLASS_PAINT, MARKING_STYLE, RACE_TRAITS, SIGN_PAINT, SUBRACE_PAINT, type PaintTraits } from "./RecipeData.ts";

export type { PaintTraits } from "./RecipeData.ts";

/** Everything a recipe reads. Only `race` and `seed` are required. */
export interface PaintSubject {
  race: string;
  subrace?: string | null;
  className?: string;
  birthsign?: string | null;
  /** Hair colour "#rrggbb" (Appearance.hair); picked from HAIR_COLORS by seed when absent. */
  hair?: string;
  /** Appearance.accent: tints the arcane/devotional class marks. */
  accent?: string;
  /** Appearance.body (the palette colour): painted as a tunic + breeches when given. */
  garment?: string;
  /** Stature in metres (default 1.75 x the race height multiplier). Feature sizes scale with it. */
  height?: number;
  /** Mesh vertex spacing in metres (lane A's polygoniser cell; default 0.025). */
  vertexSpacing?: number;
  seed: number;
}

/** Default mesh vertex spacing (m): lane A's expected polygoniser cell. */
export const DEFAULT_VERTEX_SPACING = 0.025;
/** Nyquist: a pattern feature needs >= 2 vertices across it, or it aliases into speckle. */
export const NYQUIST = 2;
/** Reference stature (m) of the base human frame; races scale it by heightMul. */
export const BASE_STATURE = 1.75;
/** Personal variation: each trait moves by up to +-TRAIT_JITTER / 2 around its race value. */
export const TRAIT_JITTER = 0.2;
/** Below this trait value a layer would peak under ~3% opacity: invisible under cel bands, so it is skipped. */
export const VISIBLE_TRAIT = 0.08;
/** Minimum HSL-lightness gap between an ink and the skin it sits on, so a mark reads. */
export const INK_SEPARATION = 0.22;
/** Number of nearest SKIN_TONES a race tint may drift toward. */
export const TONE_NEIGHBOURS = 3;
/** Largest share of the neighbour tone mixed into the race tint. */
export const TONE_VARIATION = 0.5;

/**
 * Feature sizes as fractions of stature (so a 1.2 m dwarf and a 2.0 m ork get
 * proportionate patterns). At 1.75 m: mottle 6 cm, freckle cell 2 cm, vein 9 cm,
 * scale plate 4 cm, spot 7 cm, stripe period 10 cm, face warpaint band 5 cm, tattoo radius 5 cm.
 */
export const FEATURE_SIZE = {
  mottle: 0.034, freckle: 0.012, vein: 0.05, scale: 0.022, spot: 0.04, stripe: 0.06,
  warpaint: 0.03, tattoo: 0.03, hairStrand: 0.01, sheen: 0.02,
} as const;

/** Layer seed: the subject seed hashed with the layer's index, so layers decorrelate. */
export function layerSeed(seed: number, salt: number): number { return hashCell(seed, salt, 0, 0, 77); }

/** Squared sRGB distance between two "#rrggbb" colours. */
function dist2(a: string, b: string): number {
  const x = hexToRgb(a), y = hexToRgb(b);
  return (x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2;
}

/**
 * The base skin tone: the race (+ subrace) tint, moved by up to TONE_VARIATION toward
 * the saturation and lightness of one of its TONE_NEIGHBOURS nearest SKIN_TONES
 * (picked by seed) while KEEPING the tint's hue (mixing RGB across hues, e.g. a lavender
 * dark-elf tint with a warm tone, cancels chroma into mud), lifted by the `lift` trait,
 * then bounded by SKIN_BOUNDS.
 */
export function skinToneFor(race: string, subrace: string | null | undefined, lift: number, rnd: () => number): string {
  const tint = raceBuild(race, subrace ?? null).tint;
  const near = [...SKIN_TONES].sort((a, b) => dist2(a, tint) - dist2(b, tint)).slice(0, TONE_NEIGHBOURS);
  const pick = hexToHsl(near[Math.floor(rnd() * near.length)]), base = hexToHsl(tint);
  const k = rnd() * TONE_VARIATION;
  const tone = hslToHex(base.h, base.s + (pick.s - base.s) * k, base.l + (pick.l - base.l) * k + lift);
  return boundColour(tone, SKIN_BOUNDS);
}

/** Race traits + subrace deltas + seeded jitter, each clamped to 0..1 (lift to +-0.1). */
export function traitsFor(race: string, subrace: string | null | undefined, rnd: () => number): PaintTraits {
  const base = RACE_TRAITS[race] ?? RACE_TRAITS.human;
  const delta = (subrace && SUBRACE_PAINT[subrace]?.traits) || {};
  const out = { ...base };
  for (const k of Object.keys(out) as (keyof PaintTraits)[]) {
    const v = base[k] + (delta[k] ?? 0) + (rnd() - 0.5) * (k === "lift" ? 0.06 : TRAIT_JITTER);
    out[k] = k === "lift" ? Math.max(-0.1, Math.min(0.1, v)) : clamp01(v);
  }
  return out;
}

/**
 * An ink that reads on `skin`: the pigment's hue/saturation with its lightness pushed
 * at least INK_SEPARATION away from the skin's (toward the side it already leans to),
 * then bounded by INK_BOUNDS.
 */
export function inkOn(skin: string, hue: number, sat: number, light: number): string {
  const ls = hexToHsl(skin).l;
  let l = light;
  if (Math.abs(l - ls) < INK_SEPARATION) l = l >= ls && ls + INK_SEPARATION <= 0.9 ? ls + INK_SEPARATION : ls - INK_SEPARATION;
  return boundColour(hslToHex(hue, sat, Math.max(0.05, Math.min(0.9, l))), INK_BOUNDS);
}

/** Small builder so every layer states its name, pattern and reason in one place. */
function layer(
  name: string, pattern: PatternKind, colour: string, opacity: number, scale: number, seed: number,
  extra: Partial<PaintLayer> = {},
): PaintLayer {
  return { name, pattern, colour, opacity: clamp01(opacity), blend: "normal", scale, seed, ...extra };
}

/** The paint stack for a subject. Deterministic per (subject, seed). */
export function stackFor(subject: PaintSubject): PaintStack {
  const { race, subrace = null, seed } = subject;
  const rnd = rng32(seed);
  const t = traitsFor(race, subrace, rnd);
  const skin = skinToneFor(race, subrace, t.lift, rnd);
  const H = subject.height ?? BASE_STATURE * raceBuild(race, subrace).heightMul;
  const minFeature = NYQUIST * (subject.vertexSpacing ?? DEFAULT_VERTEX_SPACING);
  const size = (k: keyof typeof FEATURE_SIZE) => Math.max(minFeature, FEATURE_SIZE[k] * H);
  const hue = hexToHsl(skin).h;
  let salt = 0;
  const s = () => layerSeed(seed, ++salt);
  const layers: PaintLayer[] = [];

  // 1. Skin coat: the bounded base tone, everywhere.
  layers.push(layer("skin", "solid", skin, 1, 1, s()));

  // 2. Mottling: darker blotches drifting to lighter ones. opacity = 0.08 + 0.32 mottle;
  //    the blotch keeps 1 - (0.08 + 0.10 mottle) of the light (shadeHex), the pale patch
  //    moves 6% toward white (tintHex): both keep the hue and never raise chroma.
  if (t.mottle >= VISIBLE_TRAIT) {
    layers.push(layer("mottling", "noise", shadeHex(skin, 1 - (0.08 + 0.10 * t.mottle)), 0.08 + 0.32 * t.mottle,
      size("mottle"), s(), { colour2: tintHex(skin, 0.06), params: { contrast: 1 + t.mottle, octaves: 4 } }));
  }

  // 3. Countershading (soft light, neutral greys so the hue is kept): lighter undersides ->
  //    darker top surfaces; the greys' distance from 0.5 (soft light's identity) =
  //    0.25 counterShade sets the strength.
  if (t.counterShade >= VISIBLE_TRAIT) {
    const k = 0.25 * t.counterShade;
    layers.push(layer("countershade", "gradient", hslToHex(hue, 0, 0.5 + k), 0.5 + 0.5 * t.counterShade, 1, s(), {
      blend: "softLight", colour2: hslToHex(hue, 0, 0.5 - k),
      params: { axis: GRADIENT_AXES.indexOf("up"), from: 0.15, to: 0.85, fill: 1 },
    }));
  }

  // 4. Flush: ruddier (redder, more saturated) toward the extremities of face, ears, hands, feet.
  if (t.ruddiness >= VISIBLE_TRAIT) {
    layers.push(layer("flush", "gradient", boundColour(shiftHsl(skin, -0.025, 1.25, -0.05), SKIN_BOUNDS), 0.6 * t.ruddiness, 1, s(), {
      regions: ["face", "ear", "hand", "foot", "nail"],
      params: { axis: GRADIENT_AXES.indexOf("extremity"), from: 0.35, to: 1 },
    }));
  }

  // 5. Freckles: melanin absorbs light, so they MULTIPLY by a light warm-brown filter
  //    (hue of the skin, S 0.45, L 0.62): darker, browner dots. density = 0.2 + 0.6 freckling.
  if (t.freckling >= VISIBLE_TRAIT) {
    const cell = size("freckle");
    layers.push(layer("freckles", "freckles", hslToHex(hue - 0.01, 0.45, 0.62), 0.35 + 0.4 * t.freckling, cell, s(), {
      blend: "multiply", regions: ["face", "ear", "neck", "torso", "upperArm", "foreArm", "hand"],
      // Spot radius >= half a vertex spacing so a freckle touches at least one vertex.
      params: { density: 0.2 + 0.6 * t.freckling, size: Math.max(0.3, minFeature / 4 / cell) },
    }));
  }

  // 6. Translucency: veins (cool, under the skin) and a pale sheen (screen).
  if (t.translucency >= VISIBLE_TRAIT) {
    const veinHue = (subrace ? SUBRACE_PAINT[subrace]?.veinHue : undefined) ?? 0.6; // 0.6 turn = the blue of veins seen through skin
    // Veins absorb red: multiply by a pale filter of the vein hue (S 0.35, L 0.75).
    layers.push(layer("veins", "veins", hslToHex(veinHue, 0.35, 0.75), 0.5 * t.translucency, size("vein"), s(), {
      blend: "multiply", regions: ["neck", "torso", "upperArm", "foreArm", "hand", "face"],
      params: { threshold: 0.78 - 0.1 * t.translucency, sharpness: 2 },
    }));
    if (t.translucency >= 0.4) {
      // Screen only ever lightens: the sheen colour is capped at Y 0.5 so a lit band cannot blow out.
      const sheen = boundColour(tintHex(skin, 0.2), { chroma: [0, 0.3], luminance: [0, 0.5] });
      layers.push(layer("sheen", "noise", sheen, 0.25 * t.translucency, size("sheen"), s(), {
        blend: "screen", params: { contrast: 2.5, bias: -0.35, octaves: 2 },
      }));
    }
  }

  // 7. Hide: keratin scale plates; rim = darker skin; coverage grows with the trait.
  if (t.hide >= VISIBLE_TRAIT) {
    const wide = t.hide >= 0.75;
    layers.push(layer("hide", "scales", shadeHex(skin, 0.95), 0.3 + 0.5 * t.hide, size("scale"), s(), {
      colour2: shadeHex(skin, 0.7),
      regions: wide ? ["upperArm", "foreArm", "torso", "hand", "shin"] : ["upperArm", "foreArm"],
      params: { rimDepth: 0.3 + 0.4 * t.hide },
    }));
  }

  // 8. Natural markings (spots / stripes) in the subrace's (or race's) style.
  const style = (subrace && SUBRACE_PAINT[subrace]?.marking) || MARKING_STYLE[race];
  if (style && t.markings >= VISIBLE_TRAIT) {
    const ink = boundColour(shiftHsl(skin, style.hueShift, style.satMul, style.lightShift), INK_BOUNDS);
    layers.push(layer("markings", style.pattern, ink, 0.2 + 0.45 * t.markings, size(style.pattern === "spots" ? "spot" : "stripe"), s(), {
      regions: [...style.regions],
      params: style.pattern === "stripes"
        ? { angle: Math.PI / 2 * (0.7 + 0.3 * rnd()), width: 0.3 + 0.2 * t.markings, warp: 0.8 }
        : { density: 0.35 + 0.4 * t.markings, size: 0.3, warp: 0.4 },
    }));
  }

  // 9. Palms/soles and nails carry less melanin: paler and less saturated.
  layers.push(layer("soles", "solid", tintHex(skin, 0.12), 0.7, 1, s(), { regions: ["sole"] }));
  layers.push(layer("nails", "solid", tintHex(shiftHsl(skin, 0, 0.5, 0), 0.2), 0.85, 1, s(), { regions: ["nail"] }));

  // 9b. Muscle definition (lane P-C): dark creases that FOLLOW the sculpted anatomy — the
  //     abdominal segments, the linea alba and the pectoral separation, and the deltoid/quad
  //     folds — keyed on the build's muscle term (buildMuscleTerm) and softened by its fat term.
  //     Painted here (over the skin, under marks/hair/garment) so a clothed or painted fighter
  //     still reads. A build with no added muscle adds nothing.
  const build = buildFor(race, subrace);
  const sil = raceSilhouette(race, subrace);
  layers.push(...definitionLayers({
    muscle: buildMuscleTerm(sil, build), fat: BUILDS[build].fat,
    skin, minFeature, height: H, seed,
  }));

  // 10. Hair: given colour (or a seeded pick), bounded, with faint lighter strands.
  const hairBase = boundColour(subject.hair ?? HAIR_COLORS[Math.floor(rnd() * HAIR_COLORS.length)], HAIR_BOUNDS);
  layers.push(layer("hair", "solid", hairBase, 1, 1, s(), { regions: ["hair"] }));
  layers.push(layer("hair-strands", "stripes", boundColour(shiftHsl(hairBase, 0, 1, 0.1), HAIR_BOUNDS), 0.35, size("hairStrand"), s(), {
    regions: ["hair"], params: { angle: Math.PI / 2, width: 0.35, warp: 1.2 },
  }));

  // 11. Birth-sign mark: bold warpaint for warpaint-wearing cultures, else a sign tattoo.
  const sign = subject.birthsign ? SIGN_PAINT[subject.birthsign] : undefined;
  const signInk = sign ? inkOn(skin, sign.pigment[0], sign.pigment[1], sign.pigment[2]) : undefined;
  if (sign && signInk) {
    if (t.warpaint >= 0.5) {
      layers.push(layer("sign-warpaint", "warpaint", signInk, 0.55 + 0.35 * t.warpaint, size("warpaint"), s(), {
        colour2: shiftHsl(signInk, 0.03, 1, 0.08),
        // Ork arm warpaint starts at the forearm: dark bands on the upper arm sit on the
        // arm–torso junction and read as a cut there (browser QA, front view).
        regions: race === "ork" ? ["face", "foreArm"] : ["face"],
        params: { motif: WARPAINT_MOTIFS.indexOf(sign.motif), bands: 2 + Math.floor(rnd() * 2), width: 0.35 + 0.2 * rnd() },
      }));
    } else {
      layers.push(tattooLayer("sign-tattoo", sign.symbol, signInk, 0.7 + 0.2 * t.warpaint, size("tattoo"), s(), ["upperArm"], 1, 0));
    }
  }

  // 12. Class accent: one mark that says what the fighter does.
  const accent = subject.className ? CLASS_PAINT[subject.className] : undefined;
  if (accent) {
    const pig = accent.ink === "accent" && subject.accent ? hexToHsl(subject.accent) : undefined;
    const ink = accent.ink === "skinLight" ? boundColour(tintHex(skin, 0.25), INK_BOUNDS)
      : accent.ink === "sign" && signInk ? signInk
      : pig ? inkOn(skin, pig.h, Math.min(pig.s, 0.6), pig.l)
      : inkOn(skin, accent.pigment[0], accent.pigment[1], accent.pigment[2]);
    const sz = size(accent.pattern === "tattoo" ? "tattoo" : accent.pattern === "veins" ? "vein" : accent.pattern === "stripes" ? "stripe" : "warpaint");
    if (accent.pattern === "tattoo") {
      layers.push(tattooLayer(`class-${accent.symbol}`, accent.symbol ?? "star", ink, accent.opacity, sz, s(), accent.regions, accent.project ?? 0, 1));
    } else {
      layers.push(layer(`class-${accent.pattern}`, accent.pattern, ink, accent.opacity, sz, s(), {
        regions: [...accent.regions], params: { ...accent.params },
      }));
    }
  }

  // 13. Garment (optional): the palette colour as a tunic and breeches, woven by a faint noise.
  // Sleeveless on purpose: browser QA tried short sleeves (cover + upperArm) and the front view
  // scored WORSE — the upperArm region is mostly the deltoid cap, so the hem landed just below
  // the shoulder and read as a second line there (ork front 6/10 -> 3/10).
  if (subject.garment) {
    const cloth = boundColour(subject.garment, INK_BOUNDS);
    const cover: Region[] = ["torso", "pelvis", "thigh"];
    layers.push(layer("garment", "solid", cloth, 1, 1, s(), { regions: cover }));
    layers.push(layer("garment-weave", "noise", shadeHex(cloth, 0.85), 0.35, size("sheen"), s(), {
      blend: "overlay",
      regions: cover, params: { contrast: 2, octaves: 2 },
    }));
  }
  return { layers };
}

/** A tattoo layer of glyph `symbol` on `regions` (projection code, mirror 0/1). */
function tattooLayer(
  name: string, symbol: TattooSymbol, ink: string, opacity: number, radius: number, seed: number,
  regions: readonly Region[], project: number, mirror: number,
): PaintLayer {
  return layer(name, "tattoo", ink, opacity, radius, seed, {
    regions: [...regions], params: { symbol: symbolIndex(symbol), project, mirror, stroke: 0.16 },
  });
}

/** The subject for a saved character: seed = nameSeed(name). Garment only when asked. */
export function subjectFromProfile(profile: CharacterProfile, options: { garment?: boolean; vertexSpacing?: number } = {}): PaintSubject {
  const a = profile.appearance;
  return {
    race: profile.race, subrace: profile.subrace, className: profile.className, birthsign: profile.birthsign,
    hair: a.hair, accent: a.accent, garment: options.garment ? a.body : undefined, height: a.height,
    vertexSpacing: options.vertexSpacing, seed: nameSeed(profile.name),
  };
}
