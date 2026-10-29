// Seeded weather simulation (G14 model, G15 sea state, G17, G18). Pure: no THREE, no DOM.
//
//  - Synoptic anomalies (temperature, pressure, humidity, wind speed, wind heading) are
//    Ornstein-Uhlenbeck processes  dX = -theta X dt + sigma dW, advanced with the EXACT discrete
//    update X' = X e^(-theta D) + s sqrt(1 - e^(-2 theta D)) N(0,1) on a fixed game-time tick D,
//    so the sequence does not depend on the frame rate (s = stationary std).
//  - Regimes (WEATHER_REGIMES) form a Markov chain whose transition weights come from the
//    place/month climate normals: thunder days raise building -> lull -> storm, cloud fraction
//    raises overcast, precipitation days raise rain. The storm cycle runs
//    clear/fair -> building -> lull -> storm -> clearing -> fair/clear.
//  - Dwell times are in GAME hours: reality base x ICONIC multiplier (G18): clear, lull and storm
//    are stretched (>= 1.5x), building/clearing are short transitions, and the handover between
//    two regimes is brief and PAIR-SPECIFIC (handoverHours: building -> lull snaps shut, storm ->
//    clearing and clearing -> fair/clear unwind slower), blended by smootherstep (C2: no kink in the
//    target's velocity or acceleration at either end).
//  - Each regime has a profile (cloud layers, rain, fog, thunder, offsets); the live state damps
//    toward the blended profile (high cloud responds fastest: cirrus arrives first).
//  - Lightning is a Poisson process at thunderPerMinute in REAL time; a flash decays in ~0.3 s.
//  - The sea state is a smooth function of the continuous storm-cycle position (seaStateAt).
//  - Couplings (lane E): falling rain/snow evaporates toward the wet bulb (cools the air AND raises
//    its humidity, rainEvaporation); precipitation phase follows the wet bulb; radiation fog burns
//    off with the SUN's elevation (polar day/night aware), not the clock hour; the normals are read
//    at the fractional day so nothing steps at midnight.
//  - Total: NaN / negative / infinite dt or clock values are ignored (treated as 0 / last valid);
//    a jump longer than MAX_STEP_H game hours is simulated as MAX_STEP_H (weather memory is shorter).

import {
  CLOUD_LAYERS, type CloudLayerState, type SeaState, type Vec3, WEATHER_REGIMES, type WeatherRegime, type WeatherState,
} from "./contracts.ts";
import { clamp, clamp01, damp, dampAngle, lerp, lerpAngle, rng32, smootherstep, smoothstep } from "../../core/MathCore.ts";
import { diurnalAt, type DiurnalState, type MonthNormals, normalsAt, type PlaceClimate, placeClimate } from "./RealClimate.ts";
import { magnusDewPointC, magnusSatVapourHPa, stullWetBulbC, WORLD_COEFFICIENTS as K } from "./WorldVars.ts";

// ---------------------------------------------------------------- dwell (G18)

/** Typical real-world duration of each regime, game hours. */
export const REALITY_DWELL_H: Readonly<Record<WeatherRegime, number>> = {
  clear: 10, fair: 8, overcast: 10, building: 2, lull: 0.75, storm: 1.5, clearing: 2,
};
/** Iconic multipliers: clear/lull/storm linger, building/clearing hurry. */
export const ICONIC_DWELL_MUL: Readonly<Record<WeatherRegime, number>> = {
  clear: 1.6, fair: 1, overcast: 0.8, building: 0.5, lull: 2.5, storm: 2.2, clearing: 0.5,
};
/** Iconic regimes (WeatherState.iconic while settled in one). */
export const ICONIC_REGIMES: ReadonlySet<WeatherRegime> = new Set<WeatherRegime>(["clear", "lull", "storm"]);
/** Default duration of the handover between two regimes, game hours (brief). */
export const HANDOVER_H = 0.3;
/**
 * Pair-specific handover durations, game hours ("from>to"; others use HANDOVER_H). Kept short so
 * G18 holds (the transitions pass quickly) but shaped by the physics of each change: a gust front
 * arrives fast (building -> lull -> storm), an anvil drifts off and a sky dries out slowly.
 */
export const HANDOVER_PAIR_H: Readonly<Record<string, number>> = {
  "building>lull": 0.12,   // the wind drops almost at once: the quiet before the storm
  "lull>storm": 0.18,      // the gust front / first downpour
  "storm>clearing": 0.45,  // the anvil drifts off, rain eases
  "clearing>fair": 0.5,    // showers die, cumulus flattens
  "clearing>clear": 0.55,  // the sky dries out completely
  "fair>overcast": 0.5,    // a stratus deck spreads
  "overcast>fair": 0.45,   // the deck breaks up
  "clear>fair": 0.35,
  "fair>clear": 0.4,
  "fair>building": 0.25, "clear>building": 0.25, "overcast>building": 0.25,
  "building>overcast": 0.35, "overcast>clearing": 0.35, "clear>overcast": 0.5,
};
/** Handover duration from `a` to `b`, game hours. */
export function handoverHours(a: WeatherRegime, b: WeatherRegime): number {
  return HANDOVER_PAIR_H[`${a}>${b}`] ?? HANDOVER_H;
}
/** Handover blend weight for progress x in [0, 1]: smootherstep (C2; zero velocity AND acceleration at both ends). */
export function handoverBlend(x: number): number {
  return smootherstep(0, 1, x);
}
/** Longest game-time step simulated in one go (larger jumps are a time skip: weather memory ~1.5 days). */
export const MAX_STEP_H = 72;
/** Share of the gap to the wet bulb that full-intensity precipitation closes (evaporative cooling). */
export const RAIN_COOL_SHARE = 0.3;
/** Each drawn dwell is mean x U(1 - DWELL_JITTER, 1 + DWELL_JITTER). */
export const DWELL_JITTER = 0.4;

/** Mean settled dwell of a regime, game hours = reality x iconic multiplier. */
export function meanDwellHours(r: WeatherRegime): number {
  return REALITY_DWELL_H[r] * ICONIC_DWELL_MUL[r];
}

// ---------------------------------------------------------------- regime profiles

/** What a regime looks like when fully settled. Layer arrays follow CLOUD_LAYERS (low, mid, high, towering). */
export interface RegimeProfile {
  storminess: number;
  /** Position on the storm cycle circle 0..1 (drives the sea state). */
  cyclePos: number;
  cover: readonly [number, number, number, number];
  typeMix: readonly [number, number, number, number];
  density: readonly [number, number, number, number];
  darkness: number;
  /** Precipitation intensity 0..1 before the place's wetness scaling. */
  precip: number;
  fog: number;
  /** Lightning flashes per real minute at full thunderiness. */
  thunder: number;
  /** Offsets added to the climatological state. */
  dT: number; dP: number; dRH: number; dWind: number;
  /** Gust / mean wind ratio. */
  gustFactor: number;
  /** 1 = cloud amounts scale with the place's cloud fraction (fair-weather clouds). */
  climatologyCloud: number;
}

const prof = (p: RegimeProfile) => p;
export const REGIME_PROFILES: Readonly<Record<WeatherRegime, RegimeProfile>> = {
  // cumulus humilis at most, a wisp of cirrus
  clear: prof({ storminess: 0, cyclePos: 0, cover: [0.06, 0.02, 0.08, 0], typeMix: [0, 0.2, 0, 0], density: [0.4, 0.3, 0.3, 0],
    darkness: 0, precip: 0, fog: 0, thunder: 0, dT: 0.8, dP: 5, dRH: -0.08, dWind: -0.5, gustFactor: 1.3, climatologyCloud: 1 }),
  // fair-weather cumulus, a few altocumulus / cirrocumulus
  fair: prof({ storminess: 0.06, cyclePos: 0.07, cover: [0.32, 0.12, 0.18, 0], typeMix: [0.1, 0.15, 0.5, 0], density: [0.55, 0.4, 0.3, 0],
    darkness: 0.05, precip: 0, fog: 0, thunder: 0, dT: 0.3, dP: 2, dRH: -0.02, dWind: 0, gustFactor: 1.4, climatologyCloud: 1 }),
  // stratus deck under altostratus, drizzle
  overcast: prof({ storminess: 0.2, cyclePos: 0.14, cover: [0.88, 0.65, 0.25, 0], typeMix: [0.9, 0.9, 0.3, 0], density: [0.8, 0.7, 0.4, 0],
    darkness: 0.3, precip: 0.18, fog: 0.06, thunder: 0, dT: -0.8, dP: -2, dRH: 0.12, dWind: 0.5, gustFactor: 1.4, climatologyCloud: 0 }),
  // cirrus arrives first, altostratus thickens, the first towers grow; sultry
  building: prof({ storminess: 0.45, cyclePos: 0.4, cover: [0.3, 0.5, 0.6, 0.18], typeMix: [0.15, 0.7, 0.15, 0], density: [0.6, 0.6, 0.45, 0.7],
    darkness: 0.2, precip: 0.03, fog: 0, thunder: 0, dT: 1.2, dP: -3, dRH: 0.1, dWind: 1.5, gustFactor: 1.6, climatologyCloud: 0 }),
  // the quiet before the storm: heavy altostratus, towers, calm air, distant rumbles
  lull: prof({ storminess: 0.62, cyclePos: 0.62, cover: [0.42, 0.8, 0.5, 0.4], typeMix: [0.45, 0.95, 0.2, 0], density: [0.7, 0.8, 0.5, 0.85],
    darkness: 0.45, precip: 0.02, fog: 0.05, thunder: 0.4, dT: 0.5, dP: -5, dRH: 0.15, dWind: -1.5, gustFactor: 1.15, climatologyCloud: 0 }),
  // cumulonimbus, ragged low cloud, downpour, outflow gusts
  storm: prof({ storminess: 1, cyclePos: 0.8, cover: [0.72, 0.88, 0.3, 0.92], typeMix: [0.6, 1, 0.1, 0], density: [0.9, 0.9, 0.5, 1],
    darkness: 0.88, precip: 0.9, fog: 0.1, thunder: 6, dT: -3.5, dP: -8, dRH: 0.25, dWind: 7, gustFactor: 1.9, climatologyCloud: 0 }),
  // the anvil drifts off, broken cumulus, showers easing
  clearing: prof({ storminess: 0.3, cyclePos: 0.92, cover: [0.45, 0.35, 0.25, 0.12], typeMix: [0.25, 0.3, 0.4, 0], density: [0.6, 0.5, 0.35, 0.6],
    darkness: 0.2, precip: 0.15, fog: 0.05, thunder: 0.1, dT: -1.5, dP: 1, dRH: 0.08, dWind: 2.5, gustFactor: 1.6, climatologyCloud: 0 }),
};

// ---------------------------------------------------------------- transitions

/** Markov transition weights out of `from` for these normals (unnormalised; zero = impossible). */
export function transitionWeights(from: WeatherRegime, n: MonthNormals): Record<WeatherRegime, number> {
  const pT = clamp01((n.thunderDays / 30) * 3); // daily thunder odds, boosted: storms are iconic
  const pR = clamp01(n.precipDays / 30);
  const cf = n.cloudFraction;
  const w: Record<WeatherRegime, number> = { clear: 0, fair: 0, overcast: 0, building: 0, lull: 0, storm: 0, clearing: 0 };
  switch (from) {
    case "clear": w.fair = 1; w.building = 0.6 * pT; w.overcast = 0.15 * cf; break;
    case "fair": w.clear = 1.2 * (1 - cf); w.overcast = 1.2 * cf + 0.3 * pR; w.building = 1.5 * pT + 0.25 * pR; break;
    case "overcast": w.fair = 1; w.clearing = 0.8 * pR; w.building = 0.5 * pT; break;
    case "building": w.lull = 0.3 + 3 * pT + pR; w.overcast = 0.8 * (1 - pT); break;
    case "lull": w.storm = 1; break;
    case "storm": w.clearing = 1; break;
    case "clearing": w.fair = 1; w.clear = 1.2 * (1 - cf); break;
  }
  return w;
}

// ---------------------------------------------------------------- sea state (G15)

/**
 * Sea state from the storm-cycle position s (circle 0..1: clear 0, building 0.4, lull 0.62,
 * storm 0.8, clearing 0.92) and a wind factor 0..1. Calm: sinusoidal swell. Building: sharp
 * trochoidal crests + crossing seas (looping). Lull: agitation DROPS, looping stays. Storm:
 * long-crested wind-aligned seas (straightness 1) at maximum agitation. Clearing: relaxes back.
 */
export function seaStateAt(s: number, windDirRad: number, wind01 = 0.5, out?: SeaState): SeaState {
  const p = s - Math.floor(s);
  const fade = 1 - smoothstep(0.86, 1.0, p); // the post-storm relaxation toward calm
  const sinusoidality = clamp01(1 - smoothstep(0.08, 0.42, p) + smoothstep(0.86, 1.0, p));
  const looping = smoothstep(0.12, 0.4, p) * (1 - smoothstep(0.66, 0.8, p));
  const straightness = smoothstep(0.62, 0.8, p) * fade;
  const lullDip = Math.exp(-(((p - 0.62) / 0.06) ** 2));
  const agitation0 = 0.12 + 0.45 * smoothstep(0.04, 0.4, p) * fade - 0.28 * lullDip + 0.43 * smoothstep(0.68, 0.8, p) * fade;
  const agitation = clamp01(agitation0 * (0.8 + 0.2 * clamp01(wind01)));
  const o = out ?? { agitation: 0, sinusoidality: 0, looping: 0, straightness: 0, windDirRad: 0 };
  o.agitation = agitation; o.sinusoidality = sinusoidality; o.looping = looping; o.straightness = straightness; o.windDirRad = windDirRad;
  return o;
}

// ---------------------------------------------------------------- couplings (lane E)

export interface AirState { temperatureC: number; relativeHumidity: number }

/**
 * Evaporation of falling precipitation (intensity 0..1). The air moves a share
 * f = RAIN_COOL_SHARE x intensity of the way to its wet bulb Tw along the psychrometric line: the
 * temperature drops toward Tw and the dew point rises toward Tw (Tw itself is conserved), so rain
 * both COOLS the air and RAISES its humidity, RH' = e_s(Td') / e_s(T') >= RH. Continuous and
 * monotone in the intensity; intensity 0 returns the air unchanged.
 */
export function rainEvaporation(temperatureC: number, relativeHumidity: number, intensity: number, out: AirState = { temperatureC: 0, relativeHumidity: 0 }): AirState {
  const T = Number.isFinite(temperatureC) ? temperatureC : 15;
  const rh = clamp(relativeHumidity, 0.02, 1);
  const f = RAIN_COOL_SHARE * clamp01(intensity);
  const td = Math.min(T, magnusDewPointC(T, rh));
  const tw = stullWetBulbC(T, rh);
  const t2 = T + f * (tw - T), td2 = Math.min(t2, td + f * (tw - td));
  out.temperatureC = t2;
  out.relativeHumidity = f > 0 ? clamp(magnusSatVapourHPa(td2) / magnusSatVapourHPa(t2), rh, 1) : rh;
  return out;
}

/**
 * Sun elevation, deg — Environment.solarPosition's law. `dayOfYear` may be fractional (pass
 * doy + (hour - 12) / 24 for a declination that is continuous across midnight and exact at noon).
 */
export function sunElevationDeg(dayOfYear: number, hour: number, latitude: number): number {
  const D = Math.PI / 180;
  const decl = 23.44 * D * Math.sin(2 * Math.PI * (284 + dayOfYear) / 365);
  const lat = clamp(latitude, -90, 90) * D, h = (hour - 12) * 15 * D;
  const s = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(h);
  return Math.asin(clamp(s, -1, 1)) / D;
}

/** Radiation-fog burn-off 0..1: the sun must climb (3 -> 20 deg) and cloud shades it. Polar-day/night aware. */
export function fogBurnOff(sunElevDeg: number, cloudCover: number): number {
  return smoothstep(3, 20, sunElevDeg) * (1 - 0.6 * clamp01(cloudCover));
}

/** Smooth max(x, 0) = (x + hypot(x, eps)) / 2: C-infinity, within eps/2 of max(x, 0). */
export function softFloor(x: number, eps: number): number {
  return 0.5 * (x + Math.hypot(x, eps));
}
/** C1 soft upper cap (quadratic knee of half-width k): the same law as WorldVars' kneeCap. */
export function softCap(x: number, cap: number, k: number): number {
  const d = Math.max(0, k - Math.abs(x - cap));
  return Math.min(x, cap) - (d * d) / (4 * k);
}
/**
 * Rain washout of aerosols as a time process (below-cloud scavenging):
 *   dL/dt = (L_season - L) / tau_recover - k_wash * precip * L,
 * integrated exactly per step for constant precip. Instantaneous washout (load ~ exp(-k rain))
 * made a light shower BRIGHTEN the sun beam (cleaner air outweighed the rain curtain); as a state,
 * the air is crisp AFTER the rain and the haze returns over the next day.
 */
export const WASHOUT = { perHour: 1.5, recoverH: 18 } as const;

/** Wind floor smoothing, m/s (calm air reads ~0.25 m/s, never a kinked 0). */
export const WIND_FLOOR_EPS = 0.5;
/** Relative-humidity knee half-width below saturation. */
export const RH_KNEE = 0.03;

/** Cloud drift speed at altitude (m) for a 10 m wind: neutral power law v (z / 10)^(1/7) — wind speeds the clouds up. */
export function layerDriftSpeedMs(windMs: number, altitudeM: number): number {
  return Math.max(0, windMs) * Math.pow(Math.max(10, altitudeM) / 10, SHEAR_EXPONENT);
}

// ---------------------------------------------------------------- anomalies (OU)

/** OU parameters: game-hour tick, mean reversion (1/h, ~1.5-day synoptic scale), stationary std. */
export const SYNOPTIC = {
  tickH: 0.25,
  thetaPerH: 1 / 36,
  std: { temperatureC: 2.5, pressureHPa: 6, relativeHumidity: 0.07, windMs: 1.2, windDirRad: 0.5 },
} as const;
const ANOM_KEYS = ["temperatureC", "pressureHPa", "relativeHumidity", "windMs", "windDirRad"] as const;

/** Lightning: a flash decays to ~2 % in LIGHTNING_DECAY_S real seconds. */
export const LIGHTNING_DECAY_S = 0.3;
const LIGHTNING_TAU = LIGHTNING_DECAY_S / Math.log(50);

/** Cloud layer base altitudes (m) for mid/high; low/towering bases sit at the lifting condensation level. */
export const LAYER_ALTITUDE_M = { mid: 3500, high: 8000, lowMin: 300, lowMax: 2500 } as const;
/** Wind shear: v(z) = v10 (z / 10 m)^(1/7) (neutral power law); heading veers with height. */
export const SHEAR_EXPONENT = 1 / 7;
const LAYER_VEER = [0.0, 0.15, 0.3, 0.08];
/** Damping rates (1/game hour) per layer: the high layer responds first (cirrus leads a front). */
const LAYER_LAMBDA = [0.9, 1.4, 2.5, 1.1];
const SCALAR_LAMBDA = 1.5;
const ANOM_LAMBDA = 4;

// flattened profile layout
const I_STORM = 0, I_COVER = 1, I_MIX = 5, I_DENS = 9, I_DARK = 13, I_PRECIP = 14, I_FOG = 15, I_THUNDER = 16,
  I_DT = 17, I_DP = 18, I_DRH = 19, I_DWIND = 20, I_GUST = 21, I_CLIM = 22, N_FIELDS = 23;
function flatten(p: RegimeProfile): Float64Array {
  const a = new Float64Array(N_FIELDS);
  a[I_STORM] = p.storminess;
  for (let i = 0; i < 4; i++) { a[I_COVER + i] = p.cover[i]; a[I_MIX + i] = p.typeMix[i]; a[I_DENS + i] = p.density[i]; }
  a[I_DARK] = p.darkness; a[I_PRECIP] = p.precip; a[I_FOG] = p.fog; a[I_THUNDER] = p.thunder;
  a[I_DT] = p.dT; a[I_DP] = p.dP; a[I_DRH] = p.dRH; a[I_DWIND] = p.dWind; a[I_GUST] = p.gustFactor; a[I_CLIM] = p.climatologyCloud;
  return a;
}
const FLAT: Readonly<Record<WeatherRegime, Float64Array>> = Object.fromEntries(
  WEATHER_REGIMES.map((r) => [r, flatten(REGIME_PROFILES[r])]),
) as Record<WeatherRegime, Float64Array>;

function lambdaOf(i: number): number {
  if (i >= I_COVER && i < I_COVER + 4) return LAYER_LAMBDA[i - I_COVER];
  if (i >= I_MIX && i < I_MIX + 4) return LAYER_LAMBDA[i - I_MIX];
  if (i >= I_DENS && i < I_DENS + 4) return LAYER_LAMBDA[i - I_DENS];
  return SCALAR_LAMBDA;
}
const LAMBDAS = Float64Array.from({ length: N_FIELDS }, (_, i) => lambdaOf(i));

// ---------------------------------------------------------------- the simulation

export interface WeatherOptions {
  placeId: string;
  latitude: number;
  seed: number;
  dayOfYear: number;
  hour: number;
}

export interface WeatherSim {
  /** The live state (mutated in place each step). */
  readonly state: WeatherState;
  /** Smoothed storm-cycle position 0..1. */
  readonly cyclePos: number;
  /** Ground snow cover 0..1 (accumulates with snowfall, melts above 0 C). */
  readonly groundSnow: number;
  /** Aerosol load 0..1: the place/season background after rain washout (recovers over ~WASHOUT.recoverH). */
  readonly aerosol: number;
  readonly place: PlaceClimate;
  readonly normals: MonthNormals;
  /** Game hours left in the current settled regime (Infinity when pinned). */
  readonly remainingH: number;
  /** Duration of the current (or last) handover, game hours = handoverHours(regime, nextRegime). */
  readonly handoverH: number;
  /** Advance by game hours (regimes, anomalies, smoothing) and real seconds (lightning). */
  step(dtGameH: number, dtRealS: number, dayOfYear: number, hour: number): WeatherState;
  setPlace(placeId: string, latitude: number): void;
  /** Hold a regime fully settled (snaps to its profile); null releases it back to the cycle. */
  pin(regime: WeatherRegime | null): void;
}

/** Box-Muller standard normal from a uniform source. */
function gauss(rng: () => number): number {
  const u = Math.max(1e-12, rng()), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function pickWeighted(w: Record<WeatherRegime, number>, u: number): WeatherRegime {
  let total = 0;
  for (const r of WEATHER_REGIMES) total += w[r];
  let x = u * total;
  for (const r of WEATHER_REGIMES) { x -= w[r]; if (x < 0 && w[r] > 0) return r; }
  for (let i = WEATHER_REGIMES.length - 1; i >= 0; i--) if (w[WEATHER_REGIMES[i]] > 0) return WEATHER_REGIMES[i];
  return "fair";
}

type Mut<T> = { -readonly [P in keyof T]: T[P] };

/** Create the seeded weather simulation (deterministic per seed and step sequence). */
export function createWeather(opts: WeatherOptions): WeatherSim {
  // Independent streams so the draw order of each does not depend on how dt is chunked:
  // regimes/dwell, synoptic anomalies (fixed game ticks), lightning (real time).
  const rng = rng32(opts.seed ^ 0x5eed1e55);
  const anomRng = rng32((opts.seed + 0x9e3779b9) ^ 0x0a0a0a0a);
  const flashRng = rng32((opts.seed * 2654435761) ^ 0x1f1a5);
  let latitude = Number.isFinite(opts.latitude) ? clamp(opts.latitude, -90, 90) : 0;
  let place = placeClimate(opts.placeId, latitude);
  let lastDay = Number.isFinite(opts.dayOfYear) ? opts.dayOfYear : 1;
  let lastHour = Number.isFinite(opts.hour) ? opts.hour : 12;
  const normals = normalsAt(place, lastDay + lastHour / 24);
  const air: AirState = { temperatureC: 0, relativeHumidity: 0 };
  let aerosol = normals.aerosol;
  const diurnal: DiurnalState = { temperatureC: 0, relativeHumidity: 0, dewPointC: 0, windMs: 0 };

  const anomTarget = new Float64Array(5), anom1 = new Float64Array(5), anom = new Float64Array(5);
  for (let i = 0; i < 5; i++) { anomTarget[i] = SYNOPTIC.std[ANOM_KEYS[i]] * gauss(anomRng); anom1[i] = anom[i] = anomTarget[i]; }
  let tickAcc = 0;

  // initial regime from climatology (settled, partway through its dwell)
  const cf0 = normals.cloudFraction;
  let regime: WeatherRegime = pickWeighted({ clear: 1.2 * (1 - cf0), fair: 1, overcast: 1.2 * cf0, building: 0, lull: 0, storm: 0, clearing: 0 }, rng());
  let next: WeatherRegime = regime;
  let transition = 0, handingOver = false, handoverH = HANDOVER_H;
  let remaining = meanDwellHours(regime) * rng();
  let pinned: WeatherRegime | null = null;

  const tgt = new Float64Array(N_FIELDS), cur = new Float64Array(N_FIELDS);
  let cycleTarget = 0, cycle = 0;
  let groundSnow = smoothstep(0.4, 0.85, normals.snowShare);
  let lightning = 0;
  const lightningDir: [number, number, number] = [0, 1, 0];

  const layers: Mut<CloudLayerState>[] = CLOUD_LAYERS.map((id) => ({
    id, altitudeM: 1000, coverage: 0, density: 0, typeMix: 0, driftX: 0, driftZ: 0, darkness: 0,
  }));
  const sea: SeaState = { agitation: 0, sinusoidality: 1, looping: 0, straightness: 0, windDirRad: 0 };
  const state: Mut<WeatherState> = {
    regime, nextRegime: regime, transition: 0, iconic: false, storminess: 0, temperatureC: 15, dewPointC: 8,
    relativeHumidity: 0.6, pressureHPa: 1013, windSpeedMs: 3, windDirRad: 0, gustMs: 4, rain: 0, snow: 0, fog: 0,
    lightning: 0, lightningDir: lightningDir as Vec3, thunderPerMinute: 0, visibilityKm: 30, cloudCover: 0, layers, sea,
  };

  const drawDwell = (r: WeatherRegime) => meanDwellHours(r) * (1 - DWELL_JITTER + 2 * DWELL_JITTER * rng());

  function advanceRegime(dtH: number): void {
    let left = dtH;
    while (left > 0 && pinned === null) {
      if (handingOver) {
        const need = (1 - transition) * handoverH;
        if (left >= need) {
          left -= need;
          regime = next; transition = 0; handingOver = false;
          remaining = drawDwell(regime);
        } else { transition += left / handoverH; left = 0; }
      } else if (left >= remaining) {
        left -= remaining; remaining = 0;
        next = pickWeighted(transitionWeights(regime, normals), rng());
        handingOver = true; transition = 0; handoverH = handoverHours(regime, next);
      } else { remaining -= left; left = 0; }
    }
  }

  function computeTargets(): void {
    const a = FLAT[regime], b = FLAT[next];
    const t = handingOver ? handoverBlend(transition) : 0;
    for (let i = 0; i < N_FIELDS; i++) tgt[i] = lerp(a[i], b[i], t);
    // fair-weather cloud amounts follow the place's climatology
    const cfScale = lerp(1, 0.6 + 0.8 * normals.cloudFraction, tgt[I_CLIM]);
    for (let i = 0; i < 4; i++) tgt[I_COVER + i] = clamp01(tgt[I_COVER + i] * cfScale);
    const pa = REGIME_PROFILES[regime].cyclePos, pb = REGIME_PROFILES[next].cyclePos;
    const ang = lerpAngle(pa * 2 * Math.PI, pb * 2 * Math.PI, t) / (2 * Math.PI);
    cycleTarget = ang - Math.floor(ang);
  }

  function snap(): void {
    computeTargets();
    cur.set(tgt);
    cycle = cycleTarget;
    anom.set(anomTarget); anom1.set(anomTarget);
  }

  /**
   * Synoptic anomalies: the OU target is redrawn every tick (exact OU discretisation); the live
   * anomaly follows it through a CRITICALLY DAMPED two-stage filter (x1' = L (u - x1), x2' = L (x1 - x2)),
   * integrated EXACTLY segment by segment between ticks:
   *   x1(t) = u + (x1_0 - u) e^-Lt,  x2(t) = u + ((x2_0 - u) + L t (x1_0 - u)) e^-Lt.
   * One stage (the old damp) has a velocity jump at every tick (C0: the temperature visibly kinks
   * every 15 game minutes); two stages are C1, and the exact segments keep it frame-step independent.
   */
  function advanceAnomalies(dtH: number): void {
    const D = SYNOPTIC.tickH;
    const decay = Math.exp(-SYNOPTIC.thetaPerH * D), kick = Math.sqrt(1 - decay * decay);
    let left = dtH;
    while (left > 0) {
      const seg = Math.min(left, D - tickAcc);
      const e = Math.exp(-ANOM_LAMBDA * seg), Lt = ANOM_LAMBDA * seg;
      for (let i = 0; i < 5; i++) {
        const u = anomTarget[i], d1 = anom1[i] - u, d2 = anom[i] - u;
        anom1[i] = u + d1 * e;
        anom[i] = u + (d2 + Lt * d1) * e;
      }
      tickAcc += seg; left -= seg;
      if (D - tickAcc <= 1e-9) {
        tickAcc = 0;
        for (let i = 0; i < 5; i++) anomTarget[i] = anomTarget[i] * decay + SYNOPTIC.std[ANOM_KEYS[i]] * kick * gauss(anomRng);
      }
    }
  }


  function derive(dtGameH: number, dtRealS: number, dayOfYear: number, hour: number): void {
    if (Number.isFinite(dayOfYear)) lastDay = dayOfYear;
    if (Number.isFinite(hour)) lastHour = hour;
    // fractional day: the normals (and the sunrise they shape) glide instead of stepping at midnight
    const dayF = lastDay + lastHour / 24;
    normalsAt(place, dayF, normals);
    // clouds
    let clear = 1;
    for (let i = 0; i < 4; i++) {
      const L = layers[i];
      L.coverage = clamp01(cur[I_COVER + i]);
      L.typeMix = clamp01(cur[I_MIX + i]);
      L.density = clamp01(cur[I_DENS + i]);
      clear *= 1 - L.coverage;
    }
    const cloudCover = 1 - clear;
    // thermodynamics
    diurnalAt(normals, lastHour, dayF, latitude, 1 - 0.6 * cloudCover, diurnal);
    const P = normals.pressureHPa + anom[1] + cur[I_DP];
    const wind = softFloor(diurnal.windMs + anom[3] + cur[I_DWIND], WIND_FLOOR_EPS); // no kink when the air goes calm
    const windDir = place.prevailingWindDirRad + anom[4];
    const storminess = clamp01(cur[I_STORM]);
    // precipitation: drizzle/showers scale with the place's wet days, storms do not
    const wetScale = clamp(normals.precipDays / 10, 0.2, 1.2);
    const precip = clamp01(cur[I_PRECIP] * lerp(wetScale, 1, storminess));
    // falling precipitation evaporates toward the wet bulb: cooler AND more humid air
    rainEvaporation(diurnal.temperatureC + anom[0] + cur[I_DT], diurnal.relativeHumidity + anom[2] + cur[I_DRH], precip, air);
    const T = air.temperatureC;
    const RH = clamp(softCap(air.relativeHumidity, 1, RH_KNEE), 0.05, 1); // eases into saturation (no kink at RH 1)
    // phase by the wet bulb (dry air lets snow reach the ground at a few degrees above 0 C)
    const snowFrac = smoothstep(1.5, -0.5, stullWetBulbC(T, RH));
    const rain = precip * (1 - snowFrac), snow = precip * snowFrac;
    const calm = 1 - smoothstep(1.5, 5, wind);
    // radiation fog: near-saturated, calm air under a clear-ish sky; the SUN burns it off (its elevation,
    // not the clock: a polar-night fog persists all day, a midsummer-night sun at 63 N starts early)
    const burn = fogBurnOff(sunElevationDeg(lastDay + (lastHour - 12) / 24, lastHour, latitude), cloudCover);
    // (RH band 0.93..1: the old 0.96..1 band let a 0.001 RH wobble swing the fog by 4 %)
    const radiationFog = 0.6 * smoothstep(0.93, 1.0, RH) * calm * calm * (1 - 0.5 * cloudCover) * (1 - 0.85 * burn);
    const fog = clamp01(Math.max(cur[I_FOG], radiationFog));
    // aerosol washout (exact for constant precipitation over the step) and recovery toward the season's load
    {
      const a = 1 / WASHOUT.recoverH, b = WASHOUT.perHour * precip;
      const inf = (a * normals.aerosol) / (a + b);
      aerosol = clamp01(inf + (aerosol - inf) * Math.exp(-(a + b) * dtGameH));
    }
    // ground snow: accumulates with snowfall, melts above 0 C and in rain
    groundSnow = clamp01(groundSnow + dtGameH * (0.25 * snow - 0.03 * Math.max(0, T) - 0.05 * rain));
    // lightning: Poisson in real time, exponential flash decay
    const thunderiness = clamp01(0.15 + normals.thunderDays / Math.max(1, normals.precipDays));
    const thunderPerMinute = Math.max(0, cur[I_THUNDER]) * thunderiness;
    lightning *= Math.exp(-Math.max(0, dtRealS) / LIGHTNING_TAU);
    if (dtRealS > 0 && thunderPerMinute > 0 && flashRng() < 1 - Math.exp(-(thunderPerMinute / 60) * dtRealS)) {
      lightning = 0.6 + 0.4 * flashRng();
      const az = 2 * Math.PI * flashRng(), el = (10 + 30 * flashRng()) * Math.PI / 180;
      lightningDir[0] = Math.cos(el) * Math.cos(az); lightningDir[1] = Math.sin(el); lightningDir[2] = Math.cos(el) * Math.sin(az);
    }
    // layer geometry: LCL base, shear-driven drift, base darkness
    const dew = magnusDewPointC(T, RH);
    const lcl = clamp(K.lclMPerK * Math.max(0, T - dew), LAYER_ALTITUDE_M.lowMin, LAYER_ALTITUDE_M.lowMax);
    const alts = [lcl, LAYER_ALTITUDE_M.mid, LAYER_ALTITUDE_M.high, lcl];
    const darkShare = [0.85, 0.6, 0.15, 1.0];
    for (let i = 0; i < 4; i++) {
      const L = layers[i];
      L.altitudeM = alts[i];
      const speed = layerDriftSpeedMs(wind, alts[i]);
      const dir = windDir + LAYER_VEER[i];
      L.driftX = speed * Math.cos(dir); L.driftZ = speed * Math.sin(dir);
      L.darkness = clamp01(cur[I_DARK] * darkShare[i] + 0.15 * L.density * L.coverage);
    }
    // rough Koschmieder estimate (Climate overwrites it with the world equation, which adds humidity growth)
    const beta = K.betaRayleighKm + (aerosol * K.aerosolTauRef) / K.aerosolScaleKm + K.betaFogKm * Math.pow(fog, 1.5) +
      K.betaRainKm * rain + K.betaSnowKm * snow;

    state.regime = regime; state.nextRegime = next; state.transition = handingOver ? transition : 0;
    state.iconic = !handingOver && ICONIC_REGIMES.has(regime);
    state.storminess = storminess;
    state.temperatureC = T; state.dewPointC = dew; state.relativeHumidity = RH; state.pressureHPa = P;
    state.windSpeedMs = wind; state.windDirRad = windDir; state.gustMs = wind * Math.max(1, cur[I_GUST]) + 0.5 * storminess;
    state.rain = rain; state.snow = snow; state.fog = fog;
    state.lightning = lightning; state.thunderPerMinute = thunderPerMinute;
    state.visibilityKm = clamp(K.koschmieder / beta, 0.03, 80);
    state.cloudCover = cloudCover;
    seaStateAt(cycle, windDir, wind / 15, sea);
  }

  snap();
  derive(0, 0, opts.dayOfYear, opts.hour);

  return {
    get state() { return state as WeatherState; },
    get cyclePos() { return cycle; },
    get groundSnow() { return groundSnow; },
    get aerosol() { return aerosol; },
    get place() { return place; },
    get normals() { return normals; },
    get remainingH() { return pinned !== null ? Infinity : remaining; },
    get handoverH() { return handoverH; },
    step(dtGameH: number, dtRealS: number, dayOfYear: number, hour: number): WeatherState {
      // total: NaN / negative / infinite -> 0; a huge jump is simulated as MAX_STEP_H (a time skip)
      const dt = dtGameH > 0 && Number.isFinite(dtGameH) ? Math.min(dtGameH, MAX_STEP_H) : 0;
      const dtR = dtRealS > 0 && Number.isFinite(dtRealS) ? dtRealS : 0;
      advanceRegime(dt);
      advanceAnomalies(dt);
      computeTargets();
      for (let i = 0; i < N_FIELDS; i++) cur[i] = damp(cur[i], tgt[i], LAMBDAS[i], dt);
      cycle = dampAngle(cycle * 2 * Math.PI, cycleTarget * 2 * Math.PI, SCALAR_LAMBDA, dt) / (2 * Math.PI);
      cycle -= Math.floor(cycle);
      derive(dt, dtR, dayOfYear, hour);
      return state as WeatherState;
    },
    setPlace(placeId: string, lat: number) {
      if (Number.isFinite(lat)) latitude = clamp(lat, -90, 90);
      place = placeClimate(placeId, latitude);
      normalsAt(place, lastDay + lastHour / 24, normals); // a handover in flight continues with the new normals
    },
    pin(r: WeatherRegime | null) {
      if (r === null) {
        if (pinned !== null) { pinned = null; remaining = drawDwell(regime); }
        return;
      }
      pinned = r; regime = r; next = r; transition = 0; handingOver = false; handoverH = HANDOVER_H;
      snap();
      derive(0, 0, lastDay, lastHour);
    },
  };
}
