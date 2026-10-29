// Climate contract (wave G, docs/graphics/BRIEF.md): the shared types between lane C (the pure
// climate model in src/world/climate/) and the parent (sky renderer, waves, engine). Pure: no
// THREE, no DOM. Lanes import from here and never edit it; the parent owns it.
//
// Producer (lane C) — exact signatures the parent will import:
//   src/world/climate/Climate.ts
//     export function createClimate(opts: ClimateOptions): ClimateSim;
//   src/world/climate/WorldVars.ts
//     export const WORLD_VARS: readonly WorldVarDef[];      // every world variable, at the TOP of the file
//     export const WORLD_COEFFICIENTS: Readonly<Record<string, number>>;
//     export const WORLD_EQUATIONS: readonly WorldEquation[];
//     export function evaluateWorld(inputs: Readonly<Record<string, number>>): Record<string, number>;
//
// Consumer (parent): Engine steps the climate each frame, feeds clock -> sun, weather -> sky
// clouds/fog/light, moons -> sky, weather.sea -> Waves, vars["render.*"] -> post-processing.

export type Rgb = readonly [number, number, number];
export type Vec3 = readonly [number, number, number];

// ---------------------------------------------------------------- clouds (G14)

/** The four cloud layers, bottom-up by altitude class (towering = vertical-development clouds). */
export const CLOUD_LAYERS = ["low", "mid", "high", "towering"] as const;
export type CloudLayerId = typeof CLOUD_LAYERS[number];

/** The seven cloud types (WMO genera) the sky draws. */
export const CLOUD_TYPES = [
  "cirrus", "cirrocumulus", "altocumulus", "altostratus", "stratus", "cumulus", "cumulonimbus",
] as const;
export type CloudType = typeof CLOUD_TYPES[number];

/** Which layer each type lives in. The towering layer holds only cumulonimbus. */
export const CLOUD_TYPE_LAYER: Readonly<Record<CloudType, CloudLayerId>> = {
  cirrus: "high", cirrocumulus: "high",
  altocumulus: "mid", altostratus: "mid",
  stratus: "low", cumulus: "low",
  cumulonimbus: "towering",
};

/** Each layer's two types: typeMix 0 = typeA, 1 = typeB. */
export const LAYER_TYPES: Readonly<Record<CloudLayerId, readonly [CloudType, CloudType]>> = {
  low: ["cumulus", "stratus"],
  mid: ["altocumulus", "altostratus"],
  high: ["cirrus", "cirrocumulus"],
  towering: ["cumulonimbus", "cumulonimbus"],
};

/**
 * Shape of a cloud type, read by the sky shader (parent GLSL). All 0..1 unless noted.
 * scale: feature size multiplier (1 = base cell). billow: 0 flat sheet .. 1 heaped puffs.
 * streak: 0 isotropic .. 1 fibrous, stretched along the drift. cells: 0..1 cellular ripples
 * (Worley). softness: 0 crisp cel edge .. 1 diffuse. thickness: optical thickness (darkens the
 * base, dims the sun). bands: cel light bands (2..4).
 */
export interface CloudShape {
  scale: number; billow: number; streak: number; cells: number; softness: number; thickness: number; bands: number;
}

/** Contract values (the parent's shader is tuned to these; lane C reads, does not change them). */
export const CLOUD_SHAPES: Readonly<Record<CloudType, CloudShape>> = {
  cirrus: { scale: 1.6, billow: 0.0, streak: 0.9, cells: 0.0, softness: 0.7, thickness: 0.10, bands: 2 },
  cirrocumulus: { scale: 0.45, billow: 0.3, streak: 0.2, cells: 0.9, softness: 0.4, thickness: 0.15, bands: 2 },
  altocumulus: { scale: 0.8, billow: 0.6, streak: 0.1, cells: 0.7, softness: 0.3, thickness: 0.35, bands: 3 },
  altostratus: { scale: 2.4, billow: 0.1, streak: 0.3, cells: 0.0, softness: 0.8, thickness: 0.55, bands: 2 },
  stratus: { scale: 3.0, billow: 0.05, streak: 0.15, cells: 0.0, softness: 0.9, thickness: 0.6, bands: 2 },
  cumulus: { scale: 1.0, billow: 1.0, streak: 0.0, cells: 0.2, softness: 0.15, thickness: 0.5, bands: 3 },
  cumulonimbus: { scale: 1.8, billow: 0.9, streak: 0.05, cells: 0.1, softness: 0.2, thickness: 0.95, bands: 4 },
};

/** One layer's live state. */
export interface CloudLayerState {
  id: CloudLayerId;
  /** Base altitude, m (low ~1000, mid ~3500, high ~8000, towering base ~1200). */
  altitudeM: number;
  /** Sky fraction covered, 0..1. */
  coverage: number;
  /** Optical density, 0..1. */
  density: number;
  /** Blend between the layer's two types (LAYER_TYPES): 0 = [0], 1 = [1]. */
  typeMix: number;
  /** Drift velocity at the layer's altitude, m/s (wind shear: higher layers drift faster). */
  driftX: number;
  driftZ: number;
  /** Base darkening 0..1 (storm bases are dark). */
  darkness: number;
}

// ---------------------------------------------------------------- weather (G15 G17 G18)

/** Weather regimes of the storm cycle. clear/storm are iconic (long dwell); building/clearing are transitions. */
export const WEATHER_REGIMES = ["clear", "fair", "overcast", "building", "lull", "storm", "clearing"] as const;
export type WeatherRegime = typeof WEATHER_REGIMES[number];

/**
 * Sea state for Waves (G15). All 0..1. agitation: overall energy. sinusoidality: 1 = pure sine
 * swell (trochoid sharpness Q -> 0). looping: 1 = sharp trochoidal crests + crossing seas (Q -> 1,
 * wide directional spread). straightness: 1 = long-crested, wind-aligned (spread -> 0). The cycle:
 * calm -> sinusoidal -> looping -> LULL (agitation drops: the quiet before the storm) -> storm
 * (straight). windDirRad: heading the waves travel toward, rad (atan2(z, x) convention).
 */
export interface SeaState {
  agitation: number; sinusoidality: number; looping: number; straightness: number; windDirRad: number;
}

export interface WeatherState {
  regime: WeatherRegime;
  /** Regime being blended toward (== regime when settled). */
  nextRegime: WeatherRegime;
  /** 0 settled in `regime` .. 1 fully `nextRegime` (the handover). */
  transition: number;
  /** True while dwelling in an iconic regime (clear, storm, lull). */
  iconic: boolean;
  /** 0 calm .. 1 full storm: continuous position in the storm cycle. */
  storminess: number;
  temperatureC: number;
  dewPointC: number;
  /** 0..1. */
  relativeHumidity: number;
  pressureHPa: number;
  windSpeedMs: number;
  /** Direction the wind blows TOWARD, rad (atan2(z, x)). */
  windDirRad: number;
  gustMs: number;
  /** Rain intensity 0..1 (snow when temperature <= ~1 C: see `snow`). */
  rain: number;
  snow: number;
  /** Ground fog / mist 0..1. */
  fog: number;
  /** Current lightning flash brightness 0..1 (decays within ~0.3 s). */
  lightning: number;
  /** Unit sky direction of the latest strike. */
  lightningDir: Vec3;
  thunderPerMinute: number;
  visibilityKm: number;
  /** Total cloud cover 0..1 (union of the layers). */
  cloudCover: number;
  /** CLOUD_LAYERS order, length 4. */
  layers: readonly CloudLayerState[];
  sea: SeaState;
}

// ---------------------------------------------------------------- moons (G13)

export interface MoonState {
  id: "ilun" | "vesh";
  name: string;
  /** Unit direction in the world frame (+y up, same frame as Environment.solarPosition). */
  dir: Vec3;
  elevation: number;
  /** Synodic phase 0..1: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
  phase: number;
  /** Lit fraction of the disc 0..1 = (1 - cos(2 pi phase)) / 2. */
  illumination: number;
  /** Apparent angular radius, rad (grows slightly near the horizon: the moon illusion). */
  angularRadius: number;
  /** Intrinsic colour, linear RGB. */
  baseColor: Rgb;
  /** Colour after the atmospheric path, linear RGB: warmer, redder, dimmer toward the horizon. */
  skyColor: Rgb;
  /** Light the moon casts, 0..1: illumination x altitude extinction. */
  brightness: number;
}

// ---------------------------------------------------------------- time (G12 G18)

export type Season = "spring" | "summer" | "autumn" | "winter";

export interface CalendarDate {
  year: number;
  /** 0..11. */
  monthIndex: number;
  monthName: string;
  /** 1-based. */
  dayOfMonth: number;
  /** 1..365. */
  dayOfYear: number;
  /** Northern-hemisphere astronomical season. */
  season: Season;
  /** 0..1 through the season. */
  seasonProgress: number;
}

/** Named moments of the day; the iconic ones dwell longer (G18). */
export const DAY_MOMENTS = [
  "night", "blue-hour-dawn", "dawn", "golden-morning", "morning", "midday", "afternoon",
  "golden-evening", "dusk", "blue-hour-dusk",
] as const;
export type DayMoment = typeof DAY_MOMENTS[number];

export interface ClockState {
  year: number;
  dayOfYear: number;
  /** Local solar hour 0..24. */
  hour: number;
  calendar: CalendarDate;
  moment: DayMoment;
  /** Current clock rate, game hours per real second (after the dwell warp). */
  hoursPerSecond: number;
  /** Current dwell weight (> 1 = this moment is stretched). */
  dwell: number;
}

// ---------------------------------------------------------------- the simulation facade

/** Default real seconds for one game day (24 min: one game hour = 60 s). */
export const DEFAULT_DAY_LENGTH_S = 1440;

/**
 * Every derived variable the PARENT reads from `ClimateFrame.vars` (lane C must produce all of
 * them, each with a declared range). Units: exposure/saturation/multipliers dimensionless;
 * fog distances metres.
 */
export const RENDER_VARS = [
  "render.exposure",        // 0.6..1.6 scene exposure multiplier
  "render.saturation",      // 0..1.6 colour saturation multiplier
  "render.haze",            // 0..1 aerial-perspective strength
  "render.fogNear",         // m, distance where aerial fog starts
  "render.fogFar",          // m, distance where aerial fog is total
  "render.sunMul",          // 0..1.5 direct sunlight multiplier (cloud + haze extinction)
  "render.ambientMul",      // 0.3..2 sky/ambient light multiplier
  "render.wetness",         // 0..1 wet ground (screen-space reflection strength)
  "render.windSway",        // 0..1 vegetation sway amplitude
  "render.cloudShadow",     // 0..1 cloud-shadow strength on the ground
  "render.giStrength",      // 0..1.5 indirect-bounce strength
  "render.turbidity",       // 1..10 sky turbidity (Rayleigh -> Mie)
  "render.starVisibility",  // 0..1
  "render.rainStreaks",     // 0..1
  "render.lightning",       // 0..1 flash brightness this frame
] as const;
export type RenderVar = typeof RENDER_VARS[number];

/** A world variable's declaration (the table at the top of WorldVars.ts). */
export interface WorldVarDef {
  id: string;
  /** "real" = generated from real-world climate; "input" = clock/place/sky geometry; "derived" = an equation's output. */
  source: "real" | "input" | "derived";
  unit: string;
  min: number;
  max: number;
  def: number;
  note: string;
}

/** Expression operators (WorldVars equations use EVERY one at least once). */
export const EXPR_OPS = [
  "add", "sub", "mul", "div", "mod", "pow", "neg", "abs", "sign", "min", "max", "clamp",
  "sqrt", "exp", "log", "sin", "cos", "tan", "atan2", "floor", "fract", "hypot",
  "mix", "step", "smoothstep", "select",
] as const;
export type ExprOp = typeof EXPR_OPS[number];

/** A number literal, a variable reference {v}, a coefficient reference {c}, or an operator node. */
export type Expr = number | { v: string } | { c: string } | { op: ExprOp; args: readonly Expr[] };

export interface WorldEquation {
  id: string;
  /** Variable written (must be source "derived"; each derived variable has exactly one writer). */
  out: string;
  expr: Expr;
  /** Why this law — one line. */
  why: string;
}

export interface ClimateFrame {
  clock: ClockState;
  weather: WeatherState;
  moons: readonly [MoonState, MoonState];
  /** Every WORLD_VARS id -> value (RENDER_VARS included). */
  vars: Readonly<Record<string, number>>;
}

export interface ClimateOptions {
  /** One of Environment.PLACES ids: sunspire | greywall | verdant | frostford. */
  placeId: string;
  latitude: number;
  seed: number;
  year: number;
  dayOfYear: number;
  hour: number;
  /** Real seconds per game day at dwell 1 on average (DEFAULT_DAY_LENGTH_S); 0 freezes the clock. */
  dayLengthSeconds?: number;
}

export interface ClimateSim {
  /** Advance by `dt` REAL seconds: warped clock, weather regime cycle, moons, equations. */
  step(dt: number): ClimateFrame;
  /** The latest frame without advancing. */
  frame(): ClimateFrame;
  setClock(dayOfYear: number, hour: number, year?: number): void;
  setPlace(placeId: string, latitude: number): void;
  /** QA: hold a regime fully settled (null releases it back to the cycle). */
  pinRegime(regime: WeatherRegime | null): void;
  /** Real seconds per game day; 0 freezes the clock (weather keeps evolving on real time). */
  setDayLength(seconds: number): void;
}
