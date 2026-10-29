// Biomes (lane S, V04): what lies around and below the arena, chosen from the arena + place,
// and the live Surroundings physics queries (contracts.ts).
//
//   chooseBiome(cfg, place, rng)                  -> BiomeSpec (pure, deterministic per rng)
//   createSurroundings(spec, field, ringRadius)   -> BiomeSurroundings (implements Surroundings)
//
// Frame: world metres, +y up, the ring centred on the origin, the ring floor ~ y 0 at the rim.
// Pure module: no Three.js, no DOM.
import { clamp, clamp01, lerp, rng32, smoothstep } from "../../core/MathCore.ts";
import type { ArenaConfig } from "../../game/ArenaConfig.ts";
import { heightAt, type Heightfield } from "../Heightfield.ts";
import {
  BIOME_CHOICES, BIOME_MEDIUM, CLOUD_DRIFT_ANGLE, DEFAULT_CHOICES, FALL_LOST_DEPTH, fbmGradientEstimate, fbmSigned, GROUND_LOST_MARGIN, MAGMA_LOST_DEPTH,
  MAX_HILL_SLOPE, MEDIA, pickWeighted, SURROUND_SEGMENTS, SURROUNDINGS_EXTENT, WATER_LOST_DEPTH, WIND_FOR_STORM,
} from "./BiomeTables.ts";
import type { BiomeSpec, Medium, Surroundings } from "./contracts.ts";
import { deriveWaves, minResolvableWavelength, reshapeWaves, waveHeightAt, type SeaShape, type WaveTrain } from "./Waves.ts";

export type { BiomeKind, BiomeSpec, Medium, Surroundings } from "./contracts.ts";

/** Clamp range of ArenaConfig.pitDepth used to size drops, m (a 0 m pit still needs a visible gap). */
export const PIT_RANGE: readonly [number, number] = [4, 40];
/** Liquid surface below the rim, as a fraction of the pit [lo, hi] and clamped to [min, max] m. */
export const WATER_DROP = { fraction: [0.35, 0.6], metres: [2.5, 12] } as const;
export const MAGMA_DROP = { fraction: [0.45, 0.7], metres: [3.5, 14] } as const;
/** Cloud-sea top below the rim. */
export const CLOUD_DROP = { fraction: [0.8, 1.2], metres: [6, 30] } as const;
/** Canopy crown tops below the rim (fall arenas) and the forest floor under them. */
export const CANOPY_DROP = { fraction: [0.25, 0.45], metres: [2, 10] } as const;
export const CANOPY_GROUND = { pitFactor: 1.6, metres: [14, 48] } as const;
/** Forest-floor depth under the crowns when the arena has solid outside ground, m. */
export const FOREST_DEPTH_SOLID: readonly [number, number] = [12, 24];
/** Hills relief as a fraction of the arena radius, clamped, m. */
export const HILLS_RELIEF = { fraction: [0.25, 0.5], metres: [6, 30] } as const;
export const MEADOW_RELIEF = { fraction: [0.05, 0.12], metres: [1, 6] } as const;
/** Canopy density from cloud cover (humid skies grow denser crowns), plus a +-jitter. */
export const CANOPY_DENSITY = { clear: 0.55, overcast: 0.85, jitter: 0.05 } as const;
/** Magma's convection never stops: agitation = MAGMA_BASE + MAGMA_WIND_GAIN * windNorm. */
export const MAGMA_BASE = 0.25;
export const MAGMA_WIND_GAIN = 0.5;
/** Far relief shape spans [SHAPE_LOW, SHAPE_LOW + SHAPE_RANGE] x relief: mostly rising, with a few dips. */
export const SHAPE_LOW = -0.35;
export const SHAPE_RANGE = 1.35;
/** Share of the slope budget the shape may use (the rest is the rise from the edge). */
export const SHAPE_SLOPE_SHARE = 0.6;
/** Waves are drawn at full amplitude out to (1 - fade) of this many ring radii (Waves.ts resolution fade). */
export const WAVE_RESOLVED_RADII = 2.5;
/** Magma waves: viscous melt moves at this fraction of the water dispersion speed, with this fraction of the steepness. */
export const MAGMA_SPEED_SCALE = 0.25;
export const MAGMA_STEEPNESS_SCALE = 0.35;

/** Linear-in-u draw inside [lo, hi] then clamped to [min, max]: the drop rules above. */
function dropFrom(pit: number, rule: { fraction: readonly number[]; metres: readonly number[] }, u: number): number {
  return clamp(pit * lerp(rule.fraction[0], rule.fraction[1], u), rule.metres[0], rule.metres[1]);
}

/**
 * Choose the surroundings for an arena (V04). Coherent with the place (BIOME_CHOICES) and with
 * ArenaConfig.outsideGround: 0 -> something to fall INTO (water, magma, clouds, canopy, void),
 * 1 -> solid ground with meadow / hills / canopy scenery beyond it. Derived parameters:
 *   windNorm   = clamp01(cfg.wind / WIND_FOR_STORM)
 *   agitation  water: clamp01(windNorm * lerp(0.8, 1.2, cfg.cloud))   (0 wind = still water)
 *              magma: clamp01(MAGMA_BASE + MAGMA_WIND_GAIN * windNorm)
 *              others: windNorm (grass and crowns sway with it)
 *   relief     hills/meadow: clamp(arenaRadius * lerp(fraction), metres)
 *   density    canopy: lerp(clear, overcast, cfg.cloud) +- jitter
 *   surfaceDrop  outsideGround 1: min(0, cfg.outsideHeight); else -clamp(pit * fraction, metres)
 * `place` is an Environment place id ("sunspire" | "greywall" | "verdant" | "frostford"); unknown
 * ids fall back to DEFAULT_CHOICES. The rng is consumed in a fixed order (deterministic).
 */
export function chooseBiome(cfg: ArenaConfig, place: string, rng: () => number): BiomeSpec {
  const placeId = place.toLowerCase();
  const choices = BIOME_CHOICES[placeId] ?? DEFAULT_CHOICES;
  const solid = cfg.outsideGround >= 1;
  const option = pickWeighted(solid ? choices.solid : choices.fall, rng());
  const seed = Math.floor(rng() * 0x7fffffff);
  const u = rng();
  const jitter = rng();
  const pit = clamp(Number.isFinite(cfg.pitDepth) ? cfg.pitDepth : 10, PIT_RANGE[0], PIT_RANGE[1]);
  const arenaRadius = Math.max(1, cfg.size / 2);
  const windNorm = clamp01((cfg.wind ?? 0) / WIND_FOR_STORM);
  const cloud = clamp01(cfg.cloud ?? 0.35);
  const spec: BiomeSpec = {
    kind: option.kind, seed, surfaceDrop: 0, extent: SURROUNDINGS_EXTENT,
    place: placeId, variant: option.variant, windAngle: CLOUD_DRIFT_ANGLE, outsideGround: solid,
  };
  const solidDrop = Math.min(0, Number.isFinite(cfg.outsideHeight) ? cfg.outsideHeight : -1);
  switch (option.kind) {
    case "water":
      spec.surfaceDrop = -dropFrom(pit, WATER_DROP, u);
      spec.agitation = clamp01(windNorm * lerp(0.8, 1.2, cloud));
      break;
    case "magma":
      spec.surfaceDrop = -dropFrom(pit, MAGMA_DROP, u);
      spec.agitation = clamp01(MAGMA_BASE + MAGMA_WIND_GAIN * windNorm);
      break;
    case "clouds":
      spec.surfaceDrop = -dropFrom(pit, CLOUD_DROP, u);
      spec.variant = cloud > 0.6 ? "storm" : option.variant;
      break;
    case "canopy":
      spec.density = clamp01(lerp(CANOPY_DENSITY.clear, CANOPY_DENSITY.overcast, cloud) + CANOPY_DENSITY.jitter * (2 * jitter - 1));
      if (solid) {
        spec.surfaceDrop = solidDrop;
        spec.groundDepth = lerp(FOREST_DEPTH_SOLID[0], FOREST_DEPTH_SOLID[1], u);
      } else {
        spec.surfaceDrop = -dropFrom(pit, CANOPY_DROP, u);
        spec.groundDepth = clamp(pit * CANOPY_GROUND.pitFactor, CANOPY_GROUND.metres[0], CANOPY_GROUND.metres[1]);
      }
      break;
    case "hills":
    case "meadow": {
      const rule = option.kind === "hills" ? HILLS_RELIEF : MEADOW_RELIEF;
      spec.relief = clamp(arenaRadius * lerp(rule.fraction[0], rule.fraction[1], u), rule.metres[0], rule.metres[1]);
      spec.surfaceDrop = solid ? solidDrop : -dropFrom(pit, WATER_DROP, u);
      break;
    }
    case "void":
      spec.surfaceDrop = -pit;
      break;
  }
  // Land, canopy, clouds and void keep the plain wind as their agitation: grass and crowns sway with it.
  if (spec.agitation === undefined) spec.agitation = windNorm;
  return spec;
}

// ---------------------------------------------------------------------------------------------
// Live surroundings
// ---------------------------------------------------------------------------------------------

/** Where the arena's own solid outside ground (lane E2's TerrainOutside) ends and the biome begins. */
export interface NearGround {
  /** Radius of the last field-following row, m (OutsideLayout.outerRadius). */
  radius: number;
  /** Height of the drawn outside at (x, z), m (Engine: the terrain mesh's floorHeightAt). */
  floorAt: (x: number, z: number) => number;
  /** Height of the flat apron where the biome joins, m (OutsideSurface.farY). */
  edgeY: number;
}

/** Optional inputs beyond the contract's three. */
export interface SurroundingsOptions {
  /** Exact solid-outside data from the built terrain (defaults are derived from the field). */
  near?: Partial<NearGround>;
}

/** Canopy crown layout: per crown x, z, radius (m), top y (m); CROWN_STRIDE floats each. */
export const CROWN_STRIDE = 4;
/** Crown vertical semi-axis / horizontal radius (a squashed dome). */
export const CROWN_SQUASH = 0.7;
/** Most crowns instanced near the ring (the rest of the forest is the canopy carpet). */
export const MAX_CROWNS = 200;
/** Crowns fill the annulus out to this many ring radii (min CROWN_ZONE_MIN m); the carpet continues beyond. */
export const CROWN_ZONE_RADII = 3;
export const CROWN_ZONE_MIN = 90;
/** The carpet of distant crowns sits this far below the near crowns' mean top, m. */
export const CARPET_DROP = 1.5;

/** The live surroundings plus what the mesh needs to draw them (all derived from the spec). */
export interface BiomeSurroundings extends Surroundings {
  /** Largest rim radius, m. */
  ringRadius: number;
  /** Water/magma wave train (null otherwise). */
  waves: WaveTrain | null;
  /** Canopy crowns (CROWN_STRIDE floats each) and their count. */
  crowns: Float32Array;
  crownCount: number;
  /** Inner and outer radius of the instanced crown zone, m. */
  crownZone: readonly [number, number];
  /** Canopy carpet level beyond the crown zone, m. */
  carpetY: number;
  /** Forest floor (canopy), m. */
  groundY: number;
  /** Solid outside ground radius (0 = none) and the height where the biome joins it, m. */
  nearRadius: number;
  edgeY: number;
  /** Cloud layer heights, top first, m (clouds only). */
  cloudLayers: number[];
  /** Polar mesh bearings the wave fade was derived for. */
  segments: number;
  /**
   * G15: reshape the live wave train in place from the storm-cycle sea state (Waves.reshapeWaves on
   * a full-agitation base train: wavelengths, frequencies and phases never change, so nothing pops).
   * Physics (surfaceAt) and the shader (SurroundingsMesh.update repacks) read the same train. No-op
   * for kinds without waves.
   */
  retune(shape: SeaShape, windAngle: number): void;
}

/**
 * Radius where a field's drawn outside ground ends, m: OutsideSurface's outerRadius rule
 * max(ringRadius + cell, halfExtent - cell) (the last field-following row; normals stay on the grid).
 */
export function fieldNearRadius(field: Heightfield, ringRadius: number): number {
  const half = Math.min((field.cols - 1) * field.cell, (field.rows - 1) * field.cell) / 2;
  return Math.max(ringRadius + field.cell, half - field.cell);
}

/** Field-derived defaults for the solid outside (OutsideSurface layout: half extent - one cell). */
function nearDefaults(spec: BiomeSpec, field: Heightfield | null, ringRadius: number): NearGround {
  if (!spec.outsideGround || !field) {
    return { radius: 0, floorAt: () => spec.surfaceDrop, edgeY: spec.surfaceDrop };
  }
  const radius = fieldNearRadius(field, ringRadius);
  const floorAt = (x: number, z: number) => spec.surfaceDrop + heightAt(field, x, z);
  const ys: number[] = [];
  for (let j = 0; j < 96; j++) {
    const a = (2 * Math.PI * j) / 96;
    ys.push(floorAt(Math.cos(a) * radius, Math.sin(a) * radius));
  }
  ys.sort((p, q) => p - q);
  return { radius, floorAt, edgeY: ys[ys.length >> 1] };
}

/** Crown placement (deterministic per seed): jittered polar cells accepted with p = density. */
function placeCrowns(spec: BiomeSpec, inner: number, outer: number, topY: number): { crowns: Float32Array; count: number } {
  const density = clamp01(spec.density ?? 0.7);
  const rng = rng32((spec.seed ^ 0x51ed270b) >>> 0);
  const area = Math.PI * (outer * outer - inner * inner);
  // Cells so that density * cells ~ MAX_CROWNS: cell side = sqrt(area density / MAX_CROWNS).
  const cell = Math.sqrt((area * Math.max(0.05, density)) / MAX_CROWNS);
  const crowns = new Float32Array(MAX_CROWNS * CROWN_STRIDE);
  let count = 0;
  for (let r = inner + cell * 0.5; r < outer && count < MAX_CROWNS; r += cell) {
    const around = Math.max(6, Math.floor((2 * Math.PI * r) / cell));
    const offset = rng() * 2 * Math.PI;
    for (let i = 0; i < around && count < MAX_CROWNS; i++) {
      const keep = rng() < density;
      const ja = rng(), jr = rng(), js = rng(), jh = rng();
      if (!keep) continue;
      const a = offset + ((i + 0.5 * (ja - 0.5)) / around) * 2 * Math.PI;
      const rr = r + (jr - 0.5) * cell * 0.4;
      const radius = cell * lerp(0.5, 0.78, js);
      crowns.set([Math.cos(a) * rr, Math.sin(a) * rr, radius, topY + (jh - 0.5) * cell * 0.5], count * CROWN_STRIDE);
      count++;
    }
  }
  return { crowns, count };
}

/**
 * Build the live surroundings for a chosen spec. `ringRadius` = the LARGEST rim radius, m.
 * surfaceAt / mediumAt by kind:
 *   water, magma   spec.surfaceDrop + waveHeightAt(train, x, z, t)          (Waves.ts, = the shader)
 *   meadow, hills  inside the solid outside: near.floorAt; beyond: edgeY + relief ramp(r) shape(x, z)
 *                  (shape = fBm in [SHAPE_LOW, SHAPE_LOW + SHAPE_RANGE]; wavelength and ramp width derived so the
 *                  worst-case slope stays <= tan(MAX_HILL_SLOPE))
 *   canopy         crown dome top where a crown covers (x, z) (medium canopy), the carpet beyond the
 *                  crown zone (canopy), else the forest floor (ground)
 *   clouds, void   NaN (no support), medium cloud / void
 * killPlaneY: water surface - WATER_LOST_DEPTH, magma - MAGMA_LOST_DEPTH, clouds/void surface -
 * FALL_LOST_DEPTH, ground (lowest relief) - GROUND_LOST_MARGIN, canopy forest floor - GROUND_LOST_MARGIN.
 */
export function createSurroundings(spec: BiomeSpec, field: Heightfield | null, ringRadius: number, options: SurroundingsOptions = {}): BiomeSurroundings {
  const R = Math.max(1, ringRadius);
  const base = nearDefaults(spec, field, R);
  const near: NearGround = { ...base, ...options.near } as NearGround;
  const nearRadius = spec.outsideGround ? Math.max(near.radius, R) : 0;
  const edgeY = spec.outsideGround ? near.edgeY : spec.surfaceDrop;
  const segments = SURROUND_SEGMENTS;
  const windAngle = spec.windAngle ?? CLOUD_DRIFT_ANGLE;
  let waves: WaveTrain | null = null;
  let wavesBase: WaveTrain | null = null;
  const magmaKind = spec.kind === "magma";
  if (spec.kind === "water" || spec.kind === "magma") {
    const options = {
      minWavelength: minResolvableWavelength(WAVE_RESOLVED_RADII * R, segments), segments,
      speedScale: magmaKind ? MAGMA_SPEED_SCALE : 1, steepnessScale: magmaKind ? MAGMA_STEEPNESS_SCALE : 1,
    };
    waves = deriveWaves(spec.agitation ?? 0, windAngle, spec.seed, options);
    // The storm-cycle base: the same seed at full agitation (its wavelengths are the ones a storm needs).
    wavesBase = deriveWaves(1, windAngle, spec.seed, options);
  }
  // Hills / meadow far relief: y = edgeY + relief * ramp(r) * shape(x, z). The slope budget tan(MAX_HILL_SLOPE)
  // is split SHAPE_SLOPE_SHARE / (1 - share) between the shape and the ramp, worst case:
  //   |relief * shape'| <= relief * (SHAPE_RANGE / 2) * fbmGradientEstimate / wavelength  -> wavelength
  //   |relief * ramp' * shape| <= relief * 1.5 / blendWidth                           -> blendWidth
  const relief = spec.relief ?? 0;
  const tanSlope = Math.tan(MAX_HILL_SLOPE);
  const hillWavelength = Math.max(30, (relief * (SHAPE_RANGE / 2) * fbmGradientEstimate()) / (SHAPE_SLOPE_SHARE * tanSlope));
  const blendWidth = Math.max(10, (1.5 * relief) / ((1 - SHAPE_SLOPE_SHARE) * tanSlope));
  const reliefStart = Math.max(nearRadius, R);
  // Beyond the solid outside the land starts at the drawn outside's last row (nearEdge, same bearing),
  // so the seam has no step, then eases to edgeY + relief * shape over blendWidth.
  const farTerrain = (x: number, z: number): number => {
    const r = Math.hypot(x, z);
    const ramp = smoothstep(reliefStart, reliefStart + blendWidth, r);
    const shape = lerp(SHAPE_LOW, SHAPE_LOW + SHAPE_RANGE, 0.5 + 0.5 * fbmSigned(x / hillWavelength, z / hillWavelength, spec.seed));
    const k = nearRadius > 0 && r > 1e-9 ? nearRadius / r : 0;
    const nearEdge = nearRadius > 0 ? near.floorAt(x * k, z * k) : edgeY;
    return nearEdge + (edgeY - nearEdge) * ramp + relief * ramp * shape;
  };
  // Canopy.
  const crownZoneInner = (spec.outsideGround ? nearRadius : R) + 2;
  const crownZoneOuter = Math.max(CROWN_ZONE_MIN, CROWN_ZONE_RADII * R, crownZoneInner + 30);
  const crownTop = spec.outsideGround ? edgeY : spec.surfaceDrop;
  const groundY = crownTop - (spec.groundDepth ?? 0);
  let crowns: Float32Array = new Float32Array(0), crownCount = 0, maxCrownRadius = 1;
  const bins = new Map<number, number[]>();
  let binSize = 1;
  if (spec.kind === "canopy") {
    const placed = placeCrowns(spec, crownZoneInner, crownZoneOuter, crownTop);
    crowns = placed.crowns;
    crownCount = placed.count;
    for (let i = 0; i < crownCount; i++) maxCrownRadius = Math.max(maxCrownRadius, crowns[i * CROWN_STRIDE + 2]);
    binSize = 2 * maxCrownRadius;
    for (let i = 0; i < crownCount; i++) {
      const bx = Math.floor(crowns[i * CROWN_STRIDE] / binSize), bz = Math.floor(crowns[i * CROWN_STRIDE + 1] / binSize);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = (bx + dx) * 73856093 ^ (bz + dz) * 19349663;
          let list = bins.get(key);
          if (!list) bins.set(key, list = []);
          list.push(i);
        }
      }
    }
  }
  const carpetY = crownTop - CARPET_DROP;
  /** Highest crown dome over (x, z), or NaN. */
  const crownAt = (x: number, z: number): number => {
    const list = bins.get(Math.floor(x / binSize) * 73856093 ^ Math.floor(z / binSize) * 19349663);
    if (!list) return NaN;
    let best = NaN;
    for (const i of list) {
      const o = i * CROWN_STRIDE, cr = crowns[o + 2];
      const d2 = ((x - crowns[o]) ** 2 + (z - crowns[o + 1]) ** 2) / (cr * cr);
      if (d2 >= 1) continue;
      const vs = cr * CROWN_SQUASH;
      const y = crowns[o + 3] - vs + vs * Math.sqrt(1 - d2);
      if (!(y <= best)) best = y;
    }
    return best;
  };
  const insideNear = (x: number, z: number) => nearRadius > 0 && Math.hypot(x, z) <= nearRadius;
  const surfaceDrop = spec.surfaceDrop;
  const surfaceAt = (x: number, z: number, t: number): number => {
    switch (spec.kind) {
      case "water":
      case "magma":
        return surfaceDrop + waveHeightAt(waves as WaveTrain, x, z, t);
      case "meadow":
      case "hills":
        return insideNear(x, z) ? near.floorAt(x, z) : farTerrain(x, z);
      case "canopy": {
        if (insideNear(x, z)) return near.floorAt(x, z);
        if (Math.hypot(x, z) > crownZoneOuter) return carpetY;
        const c = crownAt(x, z);
        return Number.isNaN(c) ? groundY : c;
      }
      default:
        return NaN;
    }
  };
  const mediumAt = (x: number, z: number): Medium => {
    if (spec.kind === "canopy") {
      if (insideNear(x, z)) return "ground";
      if (Math.hypot(x, z) > crownZoneOuter) return "canopy";
      return Number.isNaN(crownAt(x, z)) ? "ground" : "canopy";
    }
    return BIOME_MEDIUM[spec.kind];
  };
  let killPlaneY: number;
  switch (spec.kind) {
    case "water": killPlaneY = surfaceDrop - (waves?.maxElevation ?? 0) - WATER_LOST_DEPTH; break;
    case "magma": killPlaneY = surfaceDrop - (waves?.maxElevation ?? 0) - MAGMA_LOST_DEPTH; break;
    case "clouds": case "void": killPlaneY = surfaceDrop - FALL_LOST_DEPTH; break;
    case "canopy": killPlaneY = groundY - GROUND_LOST_MARGIN; break;
    default: killPlaneY = edgeY - 0.35 * relief - GROUND_LOST_MARGIN;
  }
  const cloudLayers = spec.kind === "clouds" ? [surfaceDrop, surfaceDrop - 3.5, surfaceDrop - 8] : [];
  return {
    spec, surfaceAt, mediumAt,
    drag: (m: Medium) => MEDIA[m].drag,
    buoyancy: (m: Medium) => MEDIA[m].buoyancy,
    hazardDps: (m: Medium) => MEDIA[m].hazardDps,
    killPlaneY,
    ringRadius: R, waves, crowns, crownCount, crownZone: [crownZoneInner, crownZoneOuter], carpetY, groundY,
    nearRadius, edgeY, cloudLayers, segments,
    retune(shape: SeaShape, angle: number) {
      if (!waves || !wavesBase) return;
      reshapeWaves(wavesBase, shape, angle, waves, magmaKind ? MAGMA_STEEPNESS_SCALE : 1);
    },
  };
}

/** True when `s` came from createSurroundings (carries the mesh data). */
export function isBiomeSurroundings(s: Surroundings): s is BiomeSurroundings {
  return "segments" in s && "crownZone" in s;
}
