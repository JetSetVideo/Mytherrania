// BakeTexture: evaluate a TextureRecipe over one tile into a tileable RGBA8 array, spread
// each channel to the recipe's target, and build a cel-shaded albedo preview through the
// recipe's palette ramp. Pure module: the parent wraps `data` in a THREE.DataTexture
// (RGBAFormat, UnsignedByteType, RepeatWrapping) — no Three.js or DOM here.
//
// Vocabulary:
//   tile        the baked square spans [0, P) x [0, P) of the (x, z) plane, P = recipe.tile
//               (default TILE_PERIOD units), at y = BAKE_PLANE_Y. Expressions are compiled with
//               period P, so pixel column size-1 continues into column 0 (and rows likewise).
//   pixel       pixel (i, j) samples its centre: x = x0 + (i + 0.5) P / size, z = z0 + (j + 0.5) P / size,
//               (x0, z0) = BAKE_ORIGIN * P. The origin is an irrational fraction of the tile so
//               the wrap seam falls at a generic phase of every lattice (cell counts are
//               integers), not on a cell border of each regular pattern (checker, stripes).

import { clamp01, lerp } from "../../core/MathCore.ts";
import { hexToLinear, linearToSrgb } from "../paint/Blend.ts";
import { compileNoise, quantizeLevels } from "../paint/NoiseAlgebra.ts";
import { measureSpread, type SpreadStats, spreadTo } from "../paint/Spread.ts";
import { TEXTURE_CHANNELS, type TextureChannel, type TextureRecipe } from "./TextureRecipes.ts";

/** Default coordinate units per baked tile. */
export const TILE_PERIOD = 8;
/** The y of the baked (x, z) plane: off the integer lattice planes so no source degenerates. */
export const BAKE_PLANE_Y = 0.37;
/** Tile-relative origin of the bake: (2 - golden ratio, sqrt(2) - 1), irrational on both axes. */
export const BAKE_ORIGIN: readonly [number, number] = [2 - (1 + Math.sqrt(5)) / 2, Math.SQRT2 - 1];

export interface BakeResult {
  /** RGBA8, row-major (row = z), size * size * 4 bytes. */
  data: Uint8Array;
  size: number;
  /** Per-channel spread of the FINAL bytes / 255. */
  stats: Readonly<Record<TextureChannel, SpreadStats>>;
  /** Per-channel spread of the raw expression values (before spreading). */
  rawStats: Readonly<Record<TextureChannel, SpreadStats>>;
  /** Wall-clock milliseconds of the bake. */
  ms: number;
}

const now = (): number => globalThis.performance?.now?.() ?? Date.now();

/**
 * Bake a recipe at size x size for `seed`. All four channels compile with the same seed, so
 * sub-trees with equal salts produce the same noise in different channels (correlated maps).
 */
export function bakeRecipe(recipe: TextureRecipe, size: number, seed: number): BakeResult {
  const t0 = now();
  const n = Math.max(1, Math.floor(size));
  const P = recipe.tile ?? TILE_PERIOD;
  const step = P / n, x0 = BAKE_ORIGIN[0] * P, z0 = BAKE_ORIGIN[1] * P;
  const data = new Uint8Array(n * n * 4);
  const stats = {} as Record<TextureChannel, SpreadStats>;
  const rawStats = {} as Record<TextureChannel, SpreadStats>;
  const buf = new Float32Array(n * n);
  for (let c = 0; c < 4; c++) {
    const ch = TEXTURE_CHANNELS[c];
    const fn = compileNoise(recipe.expr[ch], seed, { period: P });
    for (let j = 0; j < n; j++) {
      const z = z0 + (j + 0.5) * step;
      for (let i = 0; i < n; i++) buf[j * n + i] = fn(x0 + (i + 0.5) * step, BAKE_PLANE_Y, z);
    }
    for (let i = 0; i < buf.length; i++) if (!Number.isFinite(buf[i])) buf[i] = 0;
    rawStats[ch] = measureSpread(buf);
    const target = recipe.targetSpread[ch];
    if (target) spreadTo(buf, target, { equalize: recipe.equalize?.includes(ch) ?? false });
    for (let i = 0; i < buf.length; i++) {
      const b = Math.round(clamp01(buf[i]) * 255);
      data[i * 4 + c] = b;
      buf[i] = b / 255;
    }
    stats[ch] = measureSpread(buf);
  }
  return { data, size: n, stats, rawStats, ms: now() - t0 };
}

/**
 * A 256-entry sRGB8 ramp (RGB triples) through 2..4 "#rrggbb" stops placed evenly, interpolated
 * in LINEAR light (so a dark-to-light ramp does not dip muddy in the middle) and re-encoded.
 */
export function paletteRamp(stops: readonly string[], entries = 256): Uint8Array {
  if (stops.length < 1) throw new Error("paletteRamp: no stops");
  const lin = stops.map((h) => hexToLinear(h));
  const out = new Uint8Array(entries * 3);
  for (let e = 0; e < entries; e++) {
    const t = entries > 1 ? e / (entries - 1) : 0;
    const pos = t * (lin.length - 1), i = Math.min(lin.length - 2, Math.floor(pos));
    for (let c = 0; c < 3; c++) {
      const v = lin.length === 1 ? lin[0][c] : lerp(lin[i][c], lin[i + 1][c], pos - i);
      out[e * 3 + c] = Math.round(clamp01(linearToSrgb(v)) * 255);
    }
  }
  return out;
}

/**
 * Cel-shaded albedo preview: tone = quantize(R, celLevels) picks the palette ramp colour,
 * shaded by the quantised height B: colour *= 0.82 + 0.18 * quantize(B, celLevels).
 * Alpha = 255. Pass a previous bakeRecipe result to skip re-baking.
 */
export function bakePreview(
  recipe: TextureRecipe, size: number, seed: number, baked?: BakeResult,
): { data: Uint8Array; size: number; ms: number } {
  const t0 = now();
  const b = baked && baked.size === Math.floor(size) ? baked : bakeRecipe(recipe, size, seed);
  const lut = paletteRamp(recipe.palette);
  const L = recipe.celLevels;
  const n = b.size, out = new Uint8Array(n * n * 4);
  for (let p = 0; p < n * n; p++) {
    const tone = quantizeLevels(b.data[p * 4] / 255, L);
    const e = Math.round(tone * 255) * 3;
    const shade = 0.82 + 0.18 * quantizeLevels(b.data[p * 4 + 2] / 255, L);
    out[p * 4] = Math.round(lut[e] * shade);
    out[p * 4 + 1] = Math.round(lut[e + 1] * shade);
    out[p * 4 + 2] = Math.round(lut[e + 2] * shade);
    out[p * 4 + 3] = 255;
  }
  return { data: out, size: n, ms: now() - t0 };
}
