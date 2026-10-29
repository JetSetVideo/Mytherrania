// Biome palettes (lane S): every colour the surroundings shaders use, in LINEAR rgb (what the
// shaders mix and light), keyed by biome kind + variant. Pure module: no Three.js, no DOM.
import type { BiomeSpec } from "../../world/biomes/contracts.ts";

export type Rgb3 = readonly [number, number, number];

/** sRGB hex ("#rrggbb") -> linear rgb (the IEC 61966-2-1 transfer curve). */
export function srgbHexToLinear(hex: string): Rgb3 {
  const v = parseInt(hex.replace("#", ""), 16);
  const ch = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [ch((v >> 16) & 255), ch((v >> 8) & 255), ch(v & 255)];
}

/** Liquid colours. deep = far from the shore, shallow = at the ring's foot, foam = crests/shore. */
export interface WaterPalette { deep: Rgb3; shallow: Rgb3; foam: Rgb3; ice: number }
export const WATER_PALETTES: Readonly<Record<string, WaterPalette>> = {
  lake: { deep: [0.015, 0.075, 0.11], shallow: [0.06, 0.3, 0.3], foam: [0.88, 0.93, 0.95], ice: 0 },
  moat: { deep: [0.02, 0.06, 0.06], shallow: [0.1, 0.2, 0.15], foam: [0.78, 0.82, 0.8], ice: 0 },
  icy: { deep: [0.03, 0.12, 0.2], shallow: [0.22, 0.48, 0.56], foam: [0.92, 0.96, 1.0], ice: 1 },
};

/** Magma: crust = cooled basalt plates, lava = the glowing melt, hot = the brightest veins (emissive, unlit). */
export interface MagmaPalette { crust: Rgb3; lava: Rgb3; hot: Rgb3 }
export const MAGMA_PALETTE: MagmaPalette = { crust: [0.045, 0.035, 0.032], lava: [1.0, 0.24, 0.02], hot: [1.0, 0.72, 0.2] };

/** Ground: base matches TerrainPaint.PLACE_GROUND (the outside annulus) so the seam disappears. */
export interface GroundPalette { base: Rgb3; alt: Rgb3; rock: Rgb3; grassBase: Rgb3; grassTip: Rgb3; grassDensity: number; shrub: Rgb3; shrubs: "bush" | "boulder" }
export const GROUND_PALETTES: Readonly<Record<string, GroundPalette>> = {
  lush: { base: srgbHexToLinear("#5b7b42"), alt: [0.2, 0.33, 0.05], rock: [0.24, 0.23, 0.21], grassBase: [0.03, 0.1, 0.015], grassTip: [0.26, 0.48, 0.07], grassDensity: 1, shrub: [0.05, 0.15, 0.03], shrubs: "bush" },
  dry: { base: srgbHexToLinear("#9a8256"), alt: [0.46, 0.36, 0.13], rock: [0.3, 0.25, 0.2], grassBase: [0.2, 0.14, 0.05], grassTip: [0.62, 0.5, 0.2], grassDensity: 0.6, shrub: [0.32, 0.26, 0.2], shrubs: "boulder" },
  heath: { base: srgbHexToLinear("#6b7465"), alt: [0.2, 0.11, 0.19], rock: [0.2, 0.2, 0.2], grassBase: [0.06, 0.08, 0.04], grassTip: [0.3, 0.32, 0.14], grassDensity: 0.8, shrub: [0.16, 0.08, 0.15], shrubs: "bush" },
  snow: { base: srgbHexToLinear("#b6c2c9"), alt: [0.82, 0.86, 0.92], rock: [0.17, 0.17, 0.19], grassBase: [0.2, 0.17, 0.11], grassTip: [0.5, 0.45, 0.3], grassDensity: 0.25, shrub: [0.2, 0.2, 0.22], shrubs: "boulder" },
};

/**
 * Clouds seen from ABOVE: tops are sunlit near-white in every weather (a storm is dark from below,
 * not from above), so the variants differ mostly in the shade of the billows' far sides. Shades stay
 * near-neutral: a blue shade turns the billowed sea into something that reads as water.
 */
export interface CloudPalette { lit: Rgb3; shade: Rgb3; cover: number }
export const CLOUD_PALETTES: Readonly<Record<string, CloudPalette>> = {
  fair: { lit: [1, 1, 1], shade: [0.66, 0.67, 0.72], cover: 0.55 },
  grey: { lit: [0.95, 0.95, 0.96], shade: [0.6, 0.61, 0.64], cover: 0.65 },
  cold: { lit: [0.97, 0.99, 1], shade: [0.64, 0.67, 0.74], cover: 0.6 },
  storm: { lit: [0.9, 0.91, 0.93], shade: [0.5, 0.51, 0.56], cover: 0.75 },
};

/** Canopy: leaf range, the dark forest floor, bark. */
export interface CanopyPalette { leafDark: Rgb3; leafLight: Rgb3; floor: Rgb3; bark: Rgb3 }
export const CANOPY_PALETTE: CanopyPalette = { leafDark: [0.03, 0.11, 0.02], leafLight: [0.14, 0.34, 0.05], floor: [0.025, 0.035, 0.015], bark: [0.11, 0.07, 0.04] };

/** Rock of the column / floating island under the ring. */
export interface RockPalette { light: Rgb3; dark: Rgb3 }
export const ROCK_PALETTES: Readonly<Record<string, RockPalette>> = {
  default: { light: [0.24, 0.21, 0.18], dark: [0.09, 0.08, 0.07] },
  basalt: { light: [0.09, 0.08, 0.08], dark: [0.03, 0.025, 0.025] },
  icy: { light: [0.32, 0.36, 0.4], dark: [0.12, 0.14, 0.17] },
  bark: { light: [0.2, 0.13, 0.08], dark: [0.07, 0.045, 0.03] },
};

/** The abyss under a void arena fades from the horizon colour to this at the nadir. */
export const VOID_NADIR: Rgb3 = [0.006, 0.004, 0.014];

/** Palette lookups with fallbacks (an unknown variant never throws). */
export function waterPalette(spec: BiomeSpec): WaterPalette {
  return WATER_PALETTES[spec.variant ?? ""] ?? WATER_PALETTES.lake;
}
export function groundPalette(spec: BiomeSpec): GroundPalette {
  return GROUND_PALETTES[spec.variant ?? ""] ?? GROUND_PALETTES.lush;
}
export function cloudPalette(spec: BiomeSpec): CloudPalette {
  return CLOUD_PALETTES[spec.variant ?? ""] ?? CLOUD_PALETTES.fair;
}
export function rockPalette(spec: BiomeSpec): RockPalette {
  if (spec.kind === "magma") return ROCK_PALETTES.basalt;
  if (spec.kind === "canopy" && !spec.outsideGround) return ROCK_PALETTES.bark;
  if (spec.variant === "icy" || spec.variant === "cold" || spec.variant === "snow") return ROCK_PALETTES.icy;
  return ROCK_PALETTES.default;
}
