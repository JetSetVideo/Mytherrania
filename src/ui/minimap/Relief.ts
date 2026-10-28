// Minimap relief: the terrain contract the minimap reads, adapters for a height
// grid and a flat floor, and the one-off relief bake (hillshade × hypsometric tint
// + contour lines + flagged features) into an RGBA byte buffer. Pure — no DOM.
//
// The minimap never imports lane E's Heightfield: it codes against TerrainSampler,
// and `samplerFromGrid` adapts any grid shaped like { cols, rows, cell, originX,
// originZ, heights, featureMask? } — so it works with, without, or before lane E.
import { clamp } from "../../core/MathCore.ts";
import {
  contourInterval as deriveContourInterval,
  contourLevelCount,
  DEFAULT_AMBIENT,
  DEFAULT_LIGHT_ALTITUDE,
  DEFAULT_LIGHT_AZIMUTH,
  hillshade,
  hypsometricTint,
  lightDirection,
  normalFromHeights,
  type RGB,
  type Vec3,
} from "./MapMath.ts";

/** An axis-aligned world rectangle on the ground plane, metres (x east, z south). */
export interface TerrainBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Feature flag: no deliberate feature. */
export const FEATURE_NONE = 0;
/** Feature flag bit: a deliberate hole / pit. Same value as lane E's Heightfield FEATURE_HOLE. */
export const FEATURE_HOLE = 1;
/** Feature flag bit: a deliberate cliff (R07 — an allowed slope-limit exception). Same value as lane E's FEATURE_CLIFF. */
export const FEATURE_CLIFF = 2;

/**
 * What the minimap needs from a terrain. Heights in metres above the ring floor.
 *   heightAt(x, z)          ground height at a world point (must accept points
 *                           outside `bounds`: clamp or extrapolate, never throw)
 *   normalAt?(x, z, out)    unit surface normal (x east, y up, z south); when absent
 *                           the baker derives it by central differences
 *   featureAt?(x, z)        bitmask of FEATURE_CLIFF | FEATURE_HOLE, 0 = none
 *   bounds                  the rectangle the terrain is defined over
 */
export interface TerrainSampler {
  heightAt(x: number, z: number): number;
  normalAt?(x: number, z: number, out: Vec3): Vec3;
  featureAt?(x: number, z: number): number;
  bounds: TerrainBounds;
}

/**
 * The shape of a regular height grid (lane E's Heightfield satisfies it).
 * Sample (i, j) sits at world (originX + i·cell, originZ + j·cell); heights are
 * row-major: heights[j·cols + i]. `featureMask` uses the same indexing.
 */
export interface HeightGridLike {
  cols: number;
  rows: number;
  /** Grid spacing, metres. */
  cell: number;
  /** World x of sample column 0, metres. */
  originX: number;
  /** World z of sample row 0, metres. */
  originZ: number;
  heights: Float32Array;
  featureMask?: Uint8Array;
}

/** Which bits of a grid's featureMask mean "cliff" and "hole". Defaults match lane E's Heightfield: hole 1, cliff 2 (ramp 4 is ignored). */
export interface FeatureBits {
  cliff: number;
  hole: number;
}

/**
 * Adapt a height grid to a TerrainSampler: bilinear heights (clamped at the grid
 * edge) and nearest-sample features translated into FEATURE_CLIFF / FEATURE_HOLE.
 */
export function samplerFromGrid(grid: HeightGridLike, bits: FeatureBits = { cliff: FEATURE_CLIFF, hole: FEATURE_HOLE }): TerrainSampler {
  const { cols, rows, cell, originX, originZ, heights, featureMask } = grid;
  const maxI = cols - 1, maxJ = rows - 1;
  const sampler: TerrainSampler = {
    bounds: { minX: originX, minZ: originZ, maxX: originX + maxI * cell, maxZ: originZ + maxJ * cell },
    heightAt(x: number, z: number): number {
      const u = clamp((x - originX) / cell, 0, maxI), v = clamp((z - originZ) / cell, 0, maxJ);
      const i0 = Math.min(maxI - 1, Math.floor(u)), j0 = Math.min(maxJ - 1, Math.floor(v));
      if (maxI < 1 || maxJ < 1) return heights[0] ?? 0;
      const fu = u - i0, fv = v - j0;
      const a = heights[j0 * cols + i0], b = heights[j0 * cols + i0 + 1];
      const c = heights[(j0 + 1) * cols + i0], d = heights[(j0 + 1) * cols + i0 + 1];
      return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
    },
  };
  if (featureMask) {
    sampler.featureAt = (x: number, z: number): number => {
      const i = clamp(Math.round((x - originX) / cell), 0, maxI), j = clamp(Math.round((z - originZ) / cell), 0, maxJ);
      const m = featureMask[j * cols + i];
      return ((m & bits.cliff) ? FEATURE_CLIFF : 0) | ((m & bits.hole) ? FEATURE_HOLE : 0);
    };
  }
  return sampler;
}

/** A flat floor at `height` metres over `bounds`: the fallback when no heightfield exists (today's arena). */
export function flatTerrain(bounds: TerrainBounds, height = 0): TerrainSampler {
  return { bounds, heightAt: () => height };
}

/** Knobs for the relief bake. Angles in radians, heights in metres. */
export interface ReliefOptions {
  /** Light azimuth, clockwise from north. Default 315° (NW). */
  lightAzimuth: number;
  /** Light altitude above the horizon. Default 45°. */
  lightAltitude: number;
  /** Hillshade ambient term 0..1 (brightness of a slope facing away from the light). */
  ambient: number;
  /** Cartographic z-factor: slopes are steepened by this factor for shading only. */
  verticalExaggeration: number;
  /** Gain on the shade deviation from flat: relief = 1 + gain·(shade/shadeFlat − 1). > 1 = punchier relief on a small map. */
  reliefContrast: number;
  /** Contour interval in metres; 0 = derive from the height range (contourInterval). */
  contourInterval: number;
  /** Every n-th contour is an "index" contour, drawn darker. */
  indexContourEvery: number;
  /** Darkening of an ordinary contour pixel, 0..1. */
  contourDarken: number;
  /** Darkening of an index contour pixel, 0..1. */
  indexContourDarken: number;
  /** Normalised height used to tint a perfectly flat terrain (no range to normalise by). */
  flatTint: number;
}

/**
 * Defaults: NW sun at 45°, ambient 0.35, z-factor 3 and contrast gain 1.8 (arena
 * relief is a few metres over tens of metres: unexaggerated it reads as flat on a
 * 200 px map), 1-in-5 index contours drawn 2 px wide.
 */
export const DEFAULT_RELIEF: ReliefOptions = {
  lightAzimuth: DEFAULT_LIGHT_AZIMUTH,
  lightAltitude: DEFAULT_LIGHT_ALTITUDE,
  ambient: DEFAULT_AMBIENT,
  verticalExaggeration: 3,
  reliefContrast: 1.8,
  contourInterval: 0,
  indexContourEvery: 5,
  contourDarken: 0.3,
  indexContourDarken: 0.5,
  flatTint: 0.42,
};

/** Relief factor bounds: deepest shadow keeps 30 % of the tint, brightest lit slope 140 %. */
const RELIEF_MIN = 0.3;
const RELIEF_MAX = 1.4;
/** Hole fill (near-black blue: reads as "a drop", unlike a shadow) and its blend weight. */
const HOLE_RGB = [14, 18, 26] as const;
const HOLE_BLEND = 0.82;
/** Cliff tint (dark rust: reads as "a wall of rock", distinct from holes) and its blend weight. */
const CLIFF_RGB = [70, 34, 26] as const;
const CLIFF_BLEND = 0.7;

/** What a bake measured: the height range, the contour interval used and how many lines it produced. */
export interface ReliefSummary {
  minHeight: number;
  maxHeight: number;
  /** Metres between contour lines; 0 when the terrain is flat. */
  contourInterval: number;
  /** contourLevelCount(minHeight, maxHeight, contourInterval). */
  contourLines: number;
  /** Pixels flagged as a cliff or hole. */
  featurePixels: number;
}

/**
 * Bake shaded relief for the world rectangle whose top-left (north-west) corner is
 * (originX, originZ), `widthPx × heightPx` pixels, `metresPerPixel` metres per pixel.
 * Pixel (i, j) samples the world at its centre: (originX + (i + ½)·mpp, originZ + (j + ½)·mpp).
 *
 *   colour = tint(t) · clamp(1 + gain·(shade / shadeFlat − 1), 0.3, 1.4)   t = (h − min) / (max − min)
 *   shadeFlat = hillshade(up) so a flat floor keeps its true tint colour
 *   contour pixel: ⌊h / I⌋ differs from the east or south neighbour → darken;
 *   index contours (level a multiple of indexContourEvery·I) also mark the
 *   west/north side, so they are 2 px wide
 *   cliff → blend 70 % toward dark rust; hole → blend 82 % toward near-black blue
 *
 * `rgba` must hold widthPx·heightPx·4 bytes; `heights` is scratch of widthPx·heightPx
 * floats (passed in so the caller owns and can reuse the memory). Runs once per
 * match, never per frame.
 */
export function bakeRelief(
  terrain: TerrainSampler,
  originX: number,
  originZ: number,
  metresPerPixel: number,
  widthPx: number,
  heightPx: number,
  rgba: Uint8ClampedArray,
  heights: Float32Array,
  options: Partial<ReliefOptions> = {},
): ReliefSummary {
  const o: ReliefOptions = { ...DEFAULT_RELIEF, ...options };
  const w = widthPx, h = heightPx, mpp = metresPerPixel;
  let minH = Infinity, maxH = -Infinity;
  for (let j = 0; j < h; j++) {
    const z = originZ + (j + 0.5) * mpp;
    for (let i = 0; i < w; i++) {
      const v = terrain.heightAt(originX + (i + 0.5) * mpp, z);
      heights[j * w + i] = v;
      if (v < minH) minH = v;
      if (v > maxH) maxH = v;
    }
  }
  const range = maxH - minH;
  const interval = o.contourInterval > 0 ? o.contourInterval : deriveContourInterval(minH, maxH);
  const light = lightDirection(o.lightAzimuth, o.lightAltitude);
  const shadeFlat = hillshade(0, 1, 0, light, o.ambient);
  const n: Vec3 = { x: 0, y: 1, z: 0 };
  const tint: RGB = { r: 0, g: 0, b: 0 };
  let featurePixels = 0;
  for (let j = 0; j < h; j++) {
    const z = originZ + (j + 0.5) * mpp;
    const jN = j > 0 ? j - 1 : j, jS = j < h - 1 ? j + 1 : j;
    for (let i = 0; i < w; i++) {
      const k = j * w + i, hv = heights[k];
      const x = originX + (i + 0.5) * mpp;
      if (terrain.normalAt) terrain.normalAt(x, z, n);
      else {
        const iW = i > 0 ? i - 1 : i, iE = i < w - 1 ? i + 1 : i;
        // Edge pixels use one-sided differences; spacing follows the taps actually used.
        normalFromHeights(heights[j * w + iW], heights[j * w + iE], heights[jN * w + i], heights[jS * w + i],
          (mpp * ((iE - iW) + (jS - jN))) / 4 || mpp, o.verticalExaggeration, n);
      }
      const relief = clamp(1 + o.reliefContrast * (hillshade(n.x, n.y, n.z, light, o.ambient) / shadeFlat - 1), RELIEF_MIN, RELIEF_MAX);
      hypsometricTint(range > 1e-6 ? (hv - minH) / range : o.flatTint, tint);
      let r = tint.r * relief, g = tint.g * relief, b = tint.b * relief;
      if (interval > 0) {
        const band = Math.floor(hv / interval);
        const east = i < w - 1 ? Math.floor(heights[k + 1] / interval) : band;
        const south = j < h - 1 ? Math.floor(heights[k + w] / interval) : band;
        const west = i > 0 ? Math.floor(heights[k - 1] / interval) : band;
        const north = j > 0 ? Math.floor(heights[k - w] / interval) : band;
        // A line sits at the upper band's base height: level = max(band, neighbour)·I.
        const every = o.indexContourEvery;
        const indexE = east !== band && Math.max(band, east) % every === 0;
        const indexS = south !== band && Math.max(band, south) % every === 0;
        const indexW = west !== band && Math.max(band, west) % every === 0;
        const indexN = north !== band && Math.max(band, north) % every === 0;
        let darken = 0;
        if (east !== band || south !== band) darken = indexE || indexS ? o.indexContourDarken : o.contourDarken;
        else if (indexW || indexN) darken = o.indexContourDarken; // second pixel of a 2-px index line
        r *= 1 - darken;
        g *= 1 - darken;
        b *= 1 - darken;
      }
      const feature = terrain.featureAt ? terrain.featureAt(x, z) : FEATURE_NONE;
      if (feature & FEATURE_HOLE) {
        r = r * (1 - HOLE_BLEND) + HOLE_RGB[0] * HOLE_BLEND;
        g = g * (1 - HOLE_BLEND) + HOLE_RGB[1] * HOLE_BLEND;
        b = b * (1 - HOLE_BLEND) + HOLE_RGB[2] * HOLE_BLEND;
        featurePixels++;
      } else if (feature & FEATURE_CLIFF) {
        r = r * (1 - CLIFF_BLEND) + CLIFF_RGB[0] * CLIFF_BLEND;
        g = g * (1 - CLIFF_BLEND) + CLIFF_RGB[1] * CLIFF_BLEND;
        b = b * (1 - CLIFF_BLEND) + CLIFF_RGB[2] * CLIFF_BLEND;
        featurePixels++;
      }
      const p = k * 4;
      rgba[p] = r;
      rgba[p + 1] = g;
      rgba[p + 2] = b;
      rgba[p + 3] = 255;
    }
  }
  return {
    minHeight: minH,
    maxHeight: maxH,
    contourInterval: interval,
    contourLines: contourLevelCount(minH, maxH, interval),
    featurePixels,
  };
}
