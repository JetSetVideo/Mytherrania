// Biome tables and constants (lane S, V04): which surroundings fit which arena + place, and
// what each medium does to a body. Pure data + tiny helpers; no Three.js, no DOM.
import type { BiomeKind, Medium } from "./contracts.ts";

/** Game gravity bodies fall with, m/s^2 (Engine ring-out: impact speed sqrt(2 * 24 * drop)). */
export const BODY_GRAVITY = 24;
/** A body that has free-fallen this long below the surface is lost (void/cloud fall-through), s. */
export const FALL_LOST_SECONDS = 2;
/** Depth below a no-support surface where a falling body is lost, m: 0.5 g T^2 = 0.5 * 24 * 2^2 = 48. */
export const FALL_LOST_DEPTH = 0.5 * BODY_GRAVITY * FALL_LOST_SECONDS * FALL_LOST_SECONDS;
/** Depth below the water surface where a sinking body is lost (drowned), m. */
export const WATER_LOST_DEPTH = 8;
/** Depth below the magma surface where a body is lost (consumed), m. */
export const MAGMA_LOST_DEPTH = 4;
/** Depth below the lowest solid ground where anything is lost (numerical safety), m. */
export const GROUND_LOST_MARGIN = 20;
/** ArenaConfig.wind that makes a storm: the largest wind randomArena rolls (open arenas pick(0, 0.6)). */
export const WIND_FOR_STORM = 0.6;
/** Fog far distance of Engine.#aerialFog, m: past it everything is the horizon colour. */
export const FOG_FAR = 700;
/** Surroundings extent, m: the fog far plus a margin so no edge is ever visible. */
export const SURROUNDINGS_EXTENT = FOG_FAR + 200;
/**
 * Steepest scenery slope beyond the playable field, rad (35 deg): hill wavelengths and blends derive
 * from it so the worst case never exceeds it. (Outside the field nobody walks; bodies only land.)
 */
export const MAX_HILL_SLOPE = (35 * Math.PI) / 180;
/** Bearings of every polar surroundings mesh (and of the wave fade derivation). */
export const SURROUND_SEGMENTS = 128;
/**
 * Heading the sky's clouds drift toward, rad. Environment.cloudDensity samples the noise at
 * dir + t * wind * (1, 0.6), so features move toward -(1, 0.6): atan2(-0.6, -1).
 */
export const CLOUD_DRIFT_ANGLE = Math.atan2(-0.6, -1);

/** What a medium does to a body inside it (the contract's drag / buoyancy / hazardDps). */
export interface MediumEffect {
  /** Linear drag, 1/s: dv/dt = -drag v. */
  drag: number;
  /** Lift as a fraction of gravity while immersed (1 = neutral). */
  buoyancy: number;
  /** Damage per second while immersed, in class-attack-power units. */
  hazardDps: number;
  /** Why these numbers. */
  why: string;
}

/**
 * The media table. Terminal sink speed in a liquid = (1 - buoyancy) g / drag.
 *   water   drag 2   (entry speed halves in ln2 / 2 = 0.35 s), buoyancy 0.9 = 1000 / 1110 kg/m^3
 *           (water over a fighter with gear) -> sinks at 0.1 * 24 / 2 = 1.2 m/s: slow drowning.
 *   magma   drag 4   (viscous: halves in 0.17 s), buoyancy 1.1 (a dense melt holds the body at its
 *           crust; the contract's ~1.1), hazard 2 attack powers / s (lethal in seconds).
 *   canopy  drag 1.5 (branches brake the fall: halves in 0.46 s), hazard 0.25 (scrapes).
 *   cloud   drag 0.15 (moist air: terminal 24 / 0.15 = 160 m/s, no real support).
 *   ground / void: no drag, no lift, no hazard (landing damage is the fall's, lane R).
 */
export const MEDIA: Readonly<Record<Medium, MediumEffect>> = {
  ground: { drag: 0, buoyancy: 0, hazardDps: 0, why: "solid: land and stop; the fall itself deals the damage" },
  water: { drag: 2, buoyancy: 0.9, hazardDps: 0, why: "splash, strong drag, sink at 1.2 m/s (drowning is lane R's timer)" },
  magma: { drag: 4, buoyancy: 1.1, hazardDps: 2, why: "viscous burning melt: brakes hard, holds the body at the crust, burns" },
  canopy: { drag: 1.5, buoyancy: 0, hazardDps: 0.25, why: "branches break the fall step by step; ground far below" },
  cloud: { drag: 0.15, buoyancy: 0, hazardDps: 0, why: "moist air: no support, fall forever" },
  void: { drag: 0, buoyancy: 0, hazardDps: 0, why: "nothing: fall forever" },
};

/** Every medium, in contract order (for tests and debug tables). */
export const MEDIUMS: readonly Medium[] = ["ground", "water", "magma", "canopy", "cloud", "void"];

/** A weighted biome option. */
export interface BiomeOption {
  kind: BiomeKind;
  weight: number;
  variant: string;
}

/**
 * Coherent choices per place. `fall` = ArenaConfig.outsideGround 0 (something to fall INTO);
 * `solid` = outsideGround 1 (ground beyond the ring, scenery beyond that).
 *   sunspire  (dry steppe, 12 deg N)   magma pits or the void / dry hills and steppe
 *   greywall  (keep, 48 deg N)         a water moat or a cloud sea / heath hills and meadow
 *   verdant   (green hills, 34 deg N)  a lake or tree tops / meadow, hills, forest canopy
 *   frostford (63 deg N, cold)         icy water or a cloud sea / snowy hills and fields
 */
export const BIOME_CHOICES: Readonly<Record<string, { fall: readonly BiomeOption[]; solid: readonly BiomeOption[] }>> = {
  sunspire: {
    fall: [{ kind: "magma", weight: 0.75, variant: "basalt" }, { kind: "void", weight: 0.25, variant: "abyss" }],
    solid: [{ kind: "hills", weight: 0.65, variant: "dry" }, { kind: "meadow", weight: 0.35, variant: "dry" }],
  },
  greywall: {
    fall: [{ kind: "water", weight: 0.6, variant: "moat" }, { kind: "clouds", weight: 0.4, variant: "grey" }],
    solid: [{ kind: "hills", weight: 0.6, variant: "heath" }, { kind: "meadow", weight: 0.4, variant: "heath" }],
  },
  verdant: {
    fall: [{ kind: "water", weight: 0.45, variant: "lake" }, { kind: "canopy", weight: 0.55, variant: "lush" }],
    solid: [{ kind: "meadow", weight: 0.4, variant: "lush" }, { kind: "hills", weight: 0.3, variant: "lush" }, { kind: "canopy", weight: 0.3, variant: "lush" }],
  },
  frostford: {
    fall: [{ kind: "water", weight: 0.5, variant: "icy" }, { kind: "clouds", weight: 0.5, variant: "cold" }],
    solid: [{ kind: "hills", weight: 0.6, variant: "snow" }, { kind: "meadow", weight: 0.4, variant: "snow" }],
  },
};

/** Fallback for an unknown place. */
export const DEFAULT_CHOICES = {
  fall: [{ kind: "clouds", weight: 0.5, variant: "fair" }, { kind: "void", weight: 0.5, variant: "abyss" }] as readonly BiomeOption[],
  solid: [{ kind: "meadow", weight: 1, variant: "lush" }] as readonly BiomeOption[],
};

/** Pick from weighted options with one uniform draw u in [0, 1). */
export function pickWeighted(options: readonly BiomeOption[], u: number): BiomeOption {
  let total = 0;
  for (const o of options) total += Math.max(0, o.weight);
  let acc = 0;
  for (const o of options) {
    acc += Math.max(0, o.weight) / (total || 1);
    if (u < acc) return o;
  }
  return options[options.length - 1];
}

/** The medium the surface of a biome is made of (canopy gaps and outside annuli are "ground"). */
export const BIOME_MEDIUM: Readonly<Record<BiomeKind, Medium>> = {
  water: "water", meadow: "ground", hills: "ground", magma: "magma", clouds: "cloud", canopy: "canopy", void: "void",
};

// ---------------------------------------------------------------------------------------------
// Value noise for the far relief (CPU only: physics and the mesh both sample it through
// Surroundings.surfaceAt, so there is exactly one implementation).
// ---------------------------------------------------------------------------------------------

/** Integer-lattice hash -> [0, 1). */
export function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1] at (x, z) in lattice units. */
export function valueNoise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** Octaves of the far-relief fBm (lacunarity 2, gain 0.5). */
export const RELIEF_OCTAVES = 3;
/** Largest |grad valueNoise2| per lattice unit: the smoothstep fade's peak derivative 1.5 per axis, times sqrt 2 for the 2D magnitude. */
export const VALUE_NOISE_MAX_GRADIENT = 1.5 * Math.SQRT2;

/**
 * Upper bound of |d fbmSigned / du| per lattice unit: fbmSigned = 2 sum(a_o n(2^o u)) / sum(a_o) - 1 with
 * a_o = 0.5^o, and a_o 2^o = 1 for every octave, so the bound is (2 / sum a_o) * octaves * 1.5.
 */
export function fbmMaxGradient(octaves = RELIEF_OCTAVES): number {
  let sum = 0;
  for (let o = 0; o < octaves; o++) sum += Math.pow(0.5, o);
  return (2 / sum) * octaves * VALUE_NOISE_MAX_GRADIENT;
}

/** Margin over the measured gradient maximum (unsampled points may be a little steeper). */
export const GRADIENT_SAFETY = 1.25;
/** Lattice samples per axis and seeds of the gradient measurement. */
const GRADIENT_GRID = 64, GRADIENT_SEEDS = 4, GRADIENT_STEP = 1 / 8;
let measuredGradient = 0;

/**
 * The fBm's REAL steepest gradient, per lattice unit: max |grad fbmSigned| measured by central
 * differences on a GRADIENT_GRID^2 grid (spacing GRADIENT_STEP) for GRADIENT_SEEDS seeds, times
 * GRADIENT_SAFETY, capped by the analytic bound fbmMaxGradient (which octave maxima never reach
 * together: it is ~3x pessimistic). Measured once, then cached. Deterministic.
 */
export function fbmGradientEstimate(): number {
  if (measuredGradient > 0) return measuredGradient;
  let worst = 0;
  const h = 1e-3;
  for (let s = 0; s < GRADIENT_SEEDS; s++) {
    for (let i = 0; i < GRADIENT_GRID; i++) {
      for (let j = 0; j < GRADIENT_GRID; j++) {
        const u = i * GRADIENT_STEP + 0.37, v = j * GRADIENT_STEP + 0.61;
        const gx = (fbmSigned(u + h, v, s * 7919) - fbmSigned(u - h, v, s * 7919)) / (2 * h);
        const gz = (fbmSigned(u, v + h, s * 7919) - fbmSigned(u, v - h, s * 7919)) / (2 * h);
        worst = Math.max(worst, Math.hypot(gx, gz));
      }
    }
  }
  measuredGradient = Math.min(fbmMaxGradient(), worst * GRADIENT_SAFETY);
  return measuredGradient;
}

/** fBm normalised to [-1, 1] (divided by the amplitude sum so octaves never overshoot). */
export function fbmSigned(x: number, z: number, seed: number, octaves = RELIEF_OCTAVES): number {
  let v = 0, amp = 1, sum = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    v += amp * valueNoise2(x * f, z * f, seed + o * 101);
    sum += amp;
    amp *= 0.5;
    f *= 2;
  }
  return (v / sum) * 2 - 1;
}
