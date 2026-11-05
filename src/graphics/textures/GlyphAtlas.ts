// Wave TEX (lane R): the tattoo GLYPH atlas — every paint/Symbols.ts glyph baked ONCE into a small distance
// texture so a fragment decal draws a glyph with ONE texture fetch (budget: <= 1 extra fetch per decal).
//
// Layout: GLYPH_ATLAS_COLS x GLYPH_ATLAS_COLS cells of GLYPH_CELL_PX texels, glyph i in cell (i % cols,
// floor(i / cols)), row 0 at the BOTTOM (texture v up, like the glyph frame's +v up). A cell maps the glyph
// frame [-GLYPH_EXTENT, GLYPH_EXTENT]^2 (texel centres). Each texel stores the UNSIGNED distance (glyph units,
// 1 = the glyph radius) to the nearest stroke, encoded R8: byte = round(255 * min(d, GLYPH_DIST_MAX) / GLYPH_DIST_MAX).
// The shader decodes d = texel * GLYPH_DIST_MAX and subtracts the stroke half-width (glyph units), giving a
// signed distance whose edge it anti-aliases with the pixel footprint. Bilinear filtering of a distance is
// exact along straight strokes and rounds corners by < 1 texel (0.034 glyph units).
// Pure bake (no THREE) + a cached THREE.DataTexture wrapper.

// @deno-types="@types/three"
import * as THREE from "three";
import { SYMBOL_COUNT, symbolDistance } from "../paint/Symbols.ts";

export const GLYPH_ATLAS_COLS = 4;
export const GLYPH_CELL_PX = 64;
export const GLYPH_ATLAS_PX = GLYPH_ATLAS_COLS * GLYPH_CELL_PX;
/** Half-extent of the glyph frame one cell covers (glyph units). */
export const GLYPH_EXTENT = 1.1;
/** Largest distance the texel encodes (glyph units). */
export const GLYPH_DIST_MAX = 0.5;

/** Bake the atlas: GLYPH_ATLAS_PX^2 bytes (R8). Deterministic. */
export function bakeGlyphAtlas(): Uint8Array {
  if (SYMBOL_COUNT > GLYPH_ATLAS_COLS * GLYPH_ATLAS_COLS) throw new Error("GlyphAtlas: too many glyphs for the atlas");
  const out = new Uint8Array(GLYPH_ATLAS_PX * GLYPH_ATLAS_PX);
  out.fill(255);
  for (let g = 0; g < SYMBOL_COUNT; g++) {
    const cx = (g % GLYPH_ATLAS_COLS) * GLYPH_CELL_PX, cy = Math.floor(g / GLYPH_ATLAS_COLS) * GLYPH_CELL_PX;
    for (let y = 0; y < GLYPH_CELL_PX; y++) {
      const v = ((y + 0.5) / GLYPH_CELL_PX * 2 - 1) * GLYPH_EXTENT;
      for (let x = 0; x < GLYPH_CELL_PX; x++) {
        const u = ((x + 0.5) / GLYPH_CELL_PX * 2 - 1) * GLYPH_EXTENT;
        const d = symbolDistance(g, u, v);
        out[(cy + y) * GLYPH_ATLAS_PX + cx + x] = Math.round(255 * Math.min(d, GLYPH_DIST_MAX) / GLYPH_DIST_MAX);
      }
    }
  }
  return out;
}

/** Decode the atlas distance at glyph coords (u, v) of glyph g by bilinear filtering (the shader's sample). */
export function sampleGlyphAtlas(data: Uint8Array, g: number, u: number, v: number): number {
  const cell = ((Math.floor(g) % SYMBOL_COUNT) + SYMBOL_COUNT) % SYMBOL_COUNT;
  const cx = (cell % GLYPH_ATLAS_COLS) * GLYPH_CELL_PX, cy = Math.floor(cell / GLYPH_ATLAS_COLS) * GLYPH_CELL_PX;
  const clampTo = (x: number) => Math.max(0.5, Math.min(GLYPH_CELL_PX - 0.5, x));
  const fx = clampTo((u / GLYPH_EXTENT * 0.5 + 0.5) * GLYPH_CELL_PX) - 0.5;
  const fy = clampTo((v / GLYPH_EXTENT * 0.5 + 0.5) * GLYPH_CELL_PX) - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(GLYPH_CELL_PX - 1, x0 + 1), y1 = Math.min(GLYPH_CELL_PX - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const at = (x: number, y: number) => data[(cy + y) * GLYPH_ATLAS_PX + cx + x] / 255 * GLYPH_DIST_MAX;
  return (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
}

let cached: THREE.DataTexture | null = null;

/** The shared atlas texture (baked on first use, ~5 ms; 64 KB R8, linear filter, no mipmaps). */
export function glyphAtlasTexture(): THREE.DataTexture {
  if (cached) return cached;
  const tex = new THREE.DataTexture(bakeGlyphAtlas(), GLYPH_ATLAS_PX, GLYPH_ATLAS_PX, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = false;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  tex.name = "wave-tex-glyph-atlas";
  cached = tex;
  return tex;
}
