// The five senses and the aggro volume they produce.
//
// Every creature perceives through sight, hearing, touch, magnetism and scent.
// Each sense has a range; the ranges differ by orders of magnitude (sight reaches
// far further than hearing), and gear and race modify them — a helmet muffles
// hearing, a race with keen ears hears further.
//
// The volume a creature watches is NOT a sphere. It is a LENS: flat and wide near
// the ground, tapering with elevation, and stretched forward in proportion to how
// agitated the fight is. The radius is a function of direction using cosine, sine
// and tangent, so the shape can be sampled continuously rather than tested as a
// simple distance.
//
// Pure module: no Three.js, no DOM.

export type SenseName = "sight" | "hearing" | "touch" | "magnetism" | "scent";

export const SENSE_NAMES: SenseName[] = ["sight", "hearing", "touch", "magnetism", "scent"];

/** Base range in metres for each sense, before modifiers. */
export const SENSE_BASE: Record<SenseName, number> = {
  sight: 42,      // the eye reaches furthest
  hearing: 26,    // sound carries less far than light
  touch: 1.1,     // only what is in contact
  magnetism: 30,  // the compass sense: direction, not detail
  scent: 18,      // a trail, weaker than sound
};

/** How sharply each sense falls off with distance (higher = sharper). */
export const SENSE_FALLOFF: Record<SenseName, number> = {
  // Magnetism falls off gradually by nature, but it must not outrank sight at close
  // range: it tells you a direction, not what the thing is.
  sight: 1.0, hearing: 1.35, touch: 3.0, magnetism: 1.2, scent: 1.6,
};

/**
 * Per-sense multipliers. A closed helm narrows sight and muffles hearing; bare
 * skin sharpens touch; a race born underground is at home with magnetism.
 */
export interface SenseGear {
  /** 0 = bare head, 1 = full helm. */
  helmet: number;
  /** 0 = light armour, 1 = plate. */
  armour: number;
  /** Race trait multipliers, per sense. */
  race: Partial<Record<SenseName, number>>;
}

export const NO_GEAR: SenseGear = { helmet: 0, armour: 0, race: {} };

/** Effective range of one sense in metres, after gear and race. */
export function senseRange(sense: SenseName, gear: SenseGear = NO_GEAR): number {
  let m = 1;
  if (sense === "sight") m *= 1 - 0.30 * gear.helmet - 0.08 * gear.armour;
  if (sense === "hearing") m *= 1 - 0.45 * gear.helmet - 0.12 * gear.armour;
  if (sense === "touch") m *= 1 - 0.25 * gear.armour;
  if (sense === "magnetism") m *= 1 - 0.15 * gear.helmet;
  if (sense === "scent") m *= 1 - 0.35 * gear.helmet;
  m *= gear.race[sense] ?? 1;
  return Math.max(0.2, SENSE_BASE[sense] * m);
}

export interface SenseRanges {
  sight: number; hearing: number; touch: number; magnetism: number; scent: number;
}

export function senseRanges(gear: SenseGear = NO_GEAR): SenseRanges {
  return {
    sight: senseRange("sight", gear),
    hearing: senseRange("hearing", gear),
    touch: senseRange("touch", gear),
    magnetism: senseRange("magnetism", gear),
    scent: senseRange("scent", gear),
  };
}

/**
 * The lens factor in [0,1] for a direction, given the observer's agitation.
 *
 * `elevation` is the angle above the ground plane (radians): at 0 the creature
 * looks along the ground, at PI/2 straight up. `azimuth` is the angle from the
 * facing direction (0 = dead ahead, PI = directly behind).
 *
 * The shape:
 *   - `1 - flatten * |sin(elevation)|` tapers the lens with height, so it is a
 *     flat disc on the ground rather than a ball.
 *   - `1 + forward * cos(azimuth) * agitation` stretches it toward whatever the
 *     creature is fighting, so a calm creature watches all round and an enraged
 *     one stares forward.
 *   - `1 + flare * tan(min(elevation, cap)) * agitation` lifts the near-field edge
 *     when agitated, the way a fighter's attention rises to the threat's head.
 */
export function lensFactor(
  elevation: number,
  azimuth: number,
  agitation: number,
  flatten = 0.72,
  forward = 0.55,
  flare = 0.35,
): number {
  const a = Math.max(0, Math.min(1, agitation));
  const e = Math.max(0, Math.min(Math.PI / 2, elevation));
  const base = 1 - flatten * Math.abs(Math.sin(e));
  const fwd = 1 + forward * Math.cos(azimuth) * a;
  // tan is capped before PI/2, where it diverges.
  const cap = Math.min(e, 1.35);
  const fl = 1 + flare * Math.tan(cap) * a * 0.5;
  return Math.max(0, base * fwd * fl);
}

/** Does a sense reach a point at this offset? Offsets are in metres. */
export function senseReaches(
  sense: SenseName,
  dx: number,
  dy: number,
  dz: number,
  facing: { x: number; z: number },
  agitation: number,
  gear: SenseGear = NO_GEAR,
): boolean {
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return sense === "touch";
  const range = senseRange(sense, gear);
  if (sense === "touch") return dist <= range;
  // Magnetism and scent ignore facing; they are not directional.
  if (sense === "magnetism" || sense === "scent") return dist <= range;
  const elevation = Math.asin(Math.max(-1, Math.min(1, dy / dist)));
  const f = Math.hypot(facing.x, facing.z) || 1;
  const fx = facing.x / f, fz = facing.z / f;
  const horiz = Math.hypot(dx, dz) || 1e-6;
  const azimuth = Math.acos(Math.max(-1, Math.min(1, (dx / horiz) * fx + (dz / horiz) * fz)));
  return dist <= range * lensFactor(elevation, azimuth, agitation);
}

/** Which senses register a point, strongest first (most range headroom first). */
export function sensesTouching(
  dx: number,
  dy: number,
  dz: number,
  facing: { x: number; z: number },
  agitation: number,
  gear: SenseGear = NO_GEAR,
): SenseName[] {
  const dist = Math.hypot(dx, dy, dz);
  return SENSE_NAMES
    .filter((s) => senseReaches(s, dx, dy, dz, facing, agitation, gear))
    .sort((a, b) => stimulusStrength(b, dist, gear) - stimulusStrength(a, dist, gear));
}

/**
 * The compass bearing of a point, in degrees clockwise from north (-z), for the
 * magnetism sense. Returns 0..360.
 */
export function bearing(dx: number, dz: number): number {
  const deg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function compassPoint(deg: number): "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

/** How hard a stimulus is, 0..1, from distance relative to the sense's range. */
export function stimulusStrength(sense: SenseName, dist: number, gear: SenseGear = NO_GEAR): number {
  const range = senseRange(sense, gear);
  const t = Math.max(0, Math.min(1, dist / range));
  return Math.pow(1 - t, SENSE_FALLOFF[sense]);
}

// ---------------------------------------------------------------------------
// Adaptation: senses mutate with the world and with the fighter's own state.
// ---------------------------------------------------------------------------

export interface SenseEnvironment {
  /** World hour, 0..24. */
  hour: number;
  /** Cloud cover 0..1. */
  cloud: number;
  /** Sun elevation in degrees; negative is night. */
  sunElevationDeg: number;
  /** 0 clear, 1 heavy (rain/snow/fog). */
  weather: number;
  /** The fighter's own state. */
  fatigue: number;      // 0 fresh .. 1 exhausted
  agitation: number;    // 0 calm .. 1 enraged
  /** Ambient light 0..1, from the sky model. */
  luminosity: number;
}

export const NEUTRAL_ENV: SenseEnvironment = {
  hour: 12, cloud: 0.3, sunElevationDeg: 45, weather: 0, fatigue: 0, agitation: 0, luminosity: 0.8,
};

/**
 * Per-sense multipliers from the environment and the fighter's state.
 *
 * The rules, and why:
 *   - Sight collapses without light, and heavy weather scatters it.
 *   - Hearing is the night sense: it does not need light, and rain masks it.
 *   - Scent carries further in damp air but is washed out by heavy rain.
 *   - Magnetism is unaffected by weather, but a tired fighter misreads it.
 *   - Touch sharpens with agitation (adrenaline) and dulls with fatigue.
 */
export function senseAdaptation(env: SenseEnvironment): Record<SenseName, number> {
  const light = Math.max(0, Math.min(1, env.luminosity));
  const cloud = Math.max(0, Math.min(1, env.cloud));
  const weather = Math.max(0, Math.min(1, env.weather));
  const fatigue = Math.max(0, Math.min(1, env.fatigue));
  const agitation = Math.max(0, Math.min(1, env.agitation));
  return {
    // Never zero: a fighter in the dark is blind, not senseless.
    sight: Math.max(0.12, 0.25 + 0.9 * light) * (1 - 0.35 * weather) * (1 - 0.2 * fatigue),
    hearing: (0.85 + 0.35 * (1 - light)) * (1 - 0.5 * weather),
    scent: (1 + 0.25 * (1 - light)) * (1 - 0.45 * weather),
    magnetism: 0.95 + 0.1 * (1 - cloud),
    touch: (1 - 0.3 * fatigue) * (1 + 0.25 * agitation),
  };
}

/** Sense ranges with the environment applied. */
export function adaptedRanges(gear: SenseGear, env: SenseEnvironment): SenseRanges {
  const base = senseRanges(gear);
  const a = senseAdaptation(env);
  return {
    sight: Math.max(0.2, base.sight * a.sight),
    hearing: Math.max(0.2, base.hearing * a.hearing),
    touch: Math.max(0.2, base.touch * a.touch),
    magnetism: Math.max(0.2, base.magnetism * a.magnetism),
    scent: Math.max(0.2, base.scent * a.scent),
  };
}
