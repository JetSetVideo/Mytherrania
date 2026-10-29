// Situational world events (wave G2): golden hour, blue hour, rainbow, halo, the lull before the
// storm, thunderstorm, lightning strikes with thunder, fog bank, frost, heat shimmer, snowfall,
// moonrise, moon conjunction, starry night, the sun breaking through, gale.
//
// Each event is DATA: a score function over the live world (fuzzy memberships combined with the
// t-norms of core/Fuzzy.ts), a hysteresis gate (on/off thresholds, so a score hovering at the edge
// never flickers) and a fade envelope (attack / release half-lives + minimum hold, smootherstep
// shaped, so every event fades in and out with zero slope at both ends). Pure: no THREE, no DOM.
//
// The events then drive the renderer through ONE composition, `effects`:
//   multiplicative knobs (exposure, saturation, fog distance) = prod_i (1 + k_i e_i)   -> stays > 0,
//                                                                 order-independent
//   colour grade tint = (1 - W) * white + sum_i w_i e_i tint_i,   W = min(1, sum_i w_i e_i)
//   additive layers (rainbow, halo, shimmer, frost, snow, mist) = the event intensities, capped at 1
import { and, angleBetween, createEnvelope, gate, not, or, ramp, stepEnvelope, unit, window, type Envelope, type Gate } from "../../core/Fuzzy.ts";
import type { ClimateFrame, Vec3 } from "../climate/contracts.ts";

// ------------------------------------------------------------------------- inputs

/** Everything the scores read: plain numbers, so tests drive them directly. */
export interface EventInputs {
  sunElevDeg: number;
  /** Drawn cloud cover along the sun ray, 0..1 (CloudField.cloudOcclusionAt). */
  sunCloud: number;
  cloudCover: number;
  /** High layer coverage and density (cirrus/cirrostratus make halos). */
  highCover: number;
  highDensity: number;
  rain: number;
  snow: number;
  fog: number;
  storminess: number;
  /** Flash brightness 0..1 and the strike's sky direction. */
  lightning: number;
  lightningDir: Vec3;
  windMs: number;
  gustMs: number;
  temperatureC: number;
  relativeHumidity: number;
  /** 0..1 surfaces frozen; dew/frost deposition rate (WorldVars). */
  frozen: number;
  dewDeposition: number;
  cloudBaseM: number;
  /** The world equations' own heat-shimmer (hot x dry x sun x calm) and hoar-frost deposition, 0..1. */
  shimmerVar: number;
  frostDeposit: number;
  /** Membership of the weather in the lull / clearing regimes, including the handover blend. */
  lullness: number;
  clearingness: number;
  moons: readonly { dir: Vec3; elevationDeg: number; brightness: number; illumination: number }[];
}

/** Membership of `regime` in the frame's weather (1 settled in it, fading across a handover). */
function regimeMembership(f: ClimateFrame, regime: string): number {
  const w = f.weather, t = unit(w.transition);
  return (w.regime === regime ? 1 - t : 0) + (w.nextRegime === regime && w.nextRegime !== w.regime ? t : 0);
}

const DEG = 180 / Math.PI;

/** Build the inputs from a climate frame plus the renderer's sun elevation and drawn sun occlusion. */
export function inputsFromFrame(f: ClimateFrame, sunElevDeg: number, sunCloud: number, out?: EventInputs): EventInputs {
  const w = f.weather, v = f.vars;
  const hi = w.layers[2];
  const o: EventInputs = out ?? {
    sunElevDeg: 0, sunCloud: 0, cloudCover: 0, highCover: 0, highDensity: 0, rain: 0, snow: 0, fog: 0, storminess: 0,
    lightning: 0, lightningDir: [0, 1, 0], windMs: 0, gustMs: 0, temperatureC: 15, relativeHumidity: 0.5, frozen: 0,
    dewDeposition: 0, cloudBaseM: 1000, shimmerVar: 0, frostDeposit: 0, lullness: 0, clearingness: 0, moons: [],
  };
  o.sunElevDeg = sunElevDeg; o.sunCloud = sunCloud; o.cloudCover = w.cloudCover;
  o.highCover = hi?.coverage ?? 0; o.highDensity = hi?.density ?? 0;
  o.rain = w.rain; o.snow = w.snow; o.fog = w.fog; o.storminess = w.storminess;
  o.lightning = w.lightning; o.lightningDir = w.lightningDir;
  o.windMs = w.windSpeedMs; o.gustMs = w.gustMs; o.temperatureC = w.temperatureC; o.relativeHumidity = w.relativeHumidity;
  o.frozen = v["frozen"] ?? 0; o.dewDeposition = v["dewDeposition"] ?? 0; o.cloudBaseM = v["cloudBaseM"] ?? 1000;
  o.shimmerVar = v["heatShimmer"] ?? 0; o.frostDeposit = v["frostDeposit"] ?? 0;
  o.lullness = regimeMembership(f, "lull"); o.clearingness = regimeMembership(f, "clearing");
  // Reuse the moon records (this runs every frame).
  const ms = o.moons as { dir: Vec3; elevationDeg: number; brightness: number; illumination: number }[];
  ms.length = f.moons.length;
  for (let k = 0; k < f.moons.length; k++) {
    const m = f.moons[k];
    const r = ms[k] ?? (ms[k] = { dir: m.dir, elevationDeg: 0, brightness: 0, illumination: 0 });
    r.dir = m.dir; r.elevationDeg = m.elevation * DEG; r.brightness = m.brightness; r.illumination = m.illumination;
  }
  return o;
}

// ------------------------------------------------------------------------- the event table

export const EVENT_IDS = [
  "goldenHour", "blueHour", "rainbow", "halo", "lull", "thunderstorm", "lightningStrike", "fogBank", "frost",
  "heatShimmer", "snowfall", "moonrise", "moonConjunction", "starryNight", "sunBreak", "gale",
] as const;
export type EventId = typeof EVENT_IDS[number];

export interface EventDef {
  id: EventId;
  /** Player-facing label (HUD). */
  label: string;
  /** Gate thresholds on the raw score (off < on). */
  on: number;
  off: number;
  /** Envelope half-lives (s) and minimum hold (s). */
  attack: number;
  release: number;
  hold: number;
  /** HUD priority when several are active (higher first). */
  priority: number;
  score(i: EventInputs): number;
}

/** Night membership from the sun: 0 above -2 deg, 1 below -10 deg. */
const night = (i: EventInputs) => ramp(i.sunElevDeg, -2, -10);
/** The sun actually shines on the arena: above the horizon and not behind a drawn cloud. */
const sunShines = (i: EventInputs) => and(ramp(i.sunElevDeg, -0.5, 2), not(ramp(i.sunCloud, 0.35, 0.8)));

/** Strongest membership over the moons of `f`. */
function bestMoon(i: EventInputs, f: (m: EventInputs["moons"][number]) => number): number {
  let best = 0;
  for (const m of i.moons) best = Math.max(best, f(m));
  return best;
}

export const EVENTS: readonly EventDef[] = [
  {
    // Sun between -1 and 10 deg, visible, sky not closed over.
    id: "goldenHour", label: "golden hour", on: 0.35, off: 0.2, attack: 8, release: 10, hold: 20, priority: 5,
    score: (i) => and(window(i.sunElevDeg, -1, 10, 3), not(ramp(i.sunCloud, 0.4, 0.9)), not(ramp(i.cloudCover, 0.8, 0.98))),
  },
  {
    // Civil twilight (-6..-1 deg) under a mostly open sky.
    id: "blueHour", label: "blue hour", on: 0.35, off: 0.2, attack: 8, release: 10, hold: 20, priority: 4,
    score: (i) => and(window(i.sunElevDeg, -6.5, -0.5, 1.5), not(ramp(i.cloudCover, 0.7, 0.95))),
  },
  {
    // Light rain while the sun shines from 0.5..41 deg: the 42-deg bow's top stays above the horizon.
    id: "rainbow", label: "rainbow", on: 0.3, off: 0.15, attack: 6, release: 5, hold: 15, priority: 9,
    // Showery weather (a passing storm, its lull or the clearing behind it, not steady frontal rain)
    // with the sun clearly out of the cloud.
    score: (i) => and(window(i.rain, 0.03, 0.7, 0.12), window(i.sunElevDeg, 0.5, 41, 4), not(ramp(i.sunCloud, 0.15, 0.4)),
      or(i.clearingness, i.lullness, ramp(i.storminess, 0.3, 0.6)), not(ramp(i.fog, 0.3, 0.7))),
  },
  {
    // 22-deg halo: a thin high veil (cirrostratus: covering, not dense) in front of the sun or a bright moon.
    id: "halo", label: "halo", on: 0.3, off: 0.15, attack: 10, release: 10, hold: 20, priority: 6,
    // Cover ramp 0.25..0.55: the climate's high layer rarely exceeds 0.55 (p90), and real 22-deg halos
    // are common (~100 days a year in mid-latitudes).
    score: (i) => and(ramp(i.highCover, 0.25, 0.55), not(ramp(i.highDensity, 0.55, 0.85)), not(ramp(i.cloudCover - i.highCover * 0.5, 0.5, 0.8)),
      or(ramp(i.sunElevDeg, 2, 8), and(night(i), bestMoon(i, (m) => and(ramp(m.elevationDeg, 3, 10), ramp(m.brightness, 0.2, 0.5)))))),
  },
  {
    // The quiet before the storm: the lull regime with the wind dropping.
    id: "lull", label: "the calm before the storm", on: 0.35, off: 0.2, attack: 5, release: 4, hold: 10, priority: 8,
    score: (i) => and(i.lullness, not(ramp(i.windMs, 6, 12))),
  },
  {
    id: "thunderstorm", label: "thunderstorm", on: 0.35, off: 0.2, attack: 4, release: 8, hold: 15, priority: 10,
    score: (i) => and(ramp(i.storminess, 0.55, 0.85), ramp(i.rain, 0.25, 0.6)),
  },
  {
    // The flash itself: near-instant attack, quick release (the afterglow).
    id: "lightningStrike", label: "lightning", on: 0.4, off: 0.1, attack: 0.01, release: 0.12, hold: 0, priority: 11,
    score: (i) => unit(i.lightning),
  },
  {
    id: "fogBank", label: "fog bank", on: 0.35, off: 0.2, attack: 6, release: 8, hold: 15, priority: 7,
    score: (i) => ramp(i.fog, 0.25, 0.65),
  },
  {
    // Hoar frost: frozen ground with deposition (or near-saturated air), melting as the sun climbs.
    id: "frost", label: "frost", on: 0.3, off: 0.15, attack: 12, release: 20, hold: 30, priority: 5,
    // Either the world equations deposit hoar frost (frostDeposit = dew x frozen), or the scorer's own
    // fuzzy rule (frozen AND (deposition OR near-saturated air)) holds; the sun burns it off either way.
    score: (i) => and(or(ramp(i.frostDeposit, 0.02, 0.25), and(i.frozen, or(ramp(i.dewDeposition, 0.02, 0.3), 0.6 * ramp(i.relativeHumidity, 0.8, 0.95)))), not(ramp(i.sunElevDeg, 10, 28))),
  },
  {
    // Hot, high sun, open sky, calm, dry air: the ground heats the air into a shimmering layer.
    id: "heatShimmer", label: "heat shimmer", on: 0.3, off: 0.15, attack: 6, release: 6, hold: 15, priority: 6,
    // The world equation's shimmer, OR the scorer's own rule (which also needs the sun not behind a cloud).
    score: (i) => or(and(ramp(i.shimmerVar, 0.15, 0.5), not(ramp(i.sunCloud, 0.4, 0.8))),
      and(ramp(i.temperatureC, 27, 36), ramp(i.sunElevDeg, 15, 40), not(ramp(i.cloudCover, 0.4, 0.8)), not(ramp(i.windMs, 4, 8)), not(ramp(i.relativeHumidity, 0.6, 0.85)))),
  },
  {
    id: "snowfall", label: "snowfall", on: 0.3, off: 0.15, attack: 5, release: 6, hold: 10, priority: 8,
    score: (i) => ramp(i.snow, 0.05, 0.4),
  },
  {
    // A moon within a few degrees of the horizon at night: large and red (the climate reddens it).
    id: "moonrise", label: "moonrise", on: 0.3, off: 0.15, attack: 5, release: 6, hold: 15, priority: 6,
    score: (i) => and(night(i), not(ramp(i.cloudCover, 0.6, 0.9)), bestMoon(i, (m) => and(window(m.elevationDeg, -0.5, 7, 1.5), ramp(m.illumination, 0.15, 0.4)))),
  },
  {
    // Both moons above the horizon and within ~8 deg of each other.
    id: "moonConjunction", label: "the moons meet", on: 0.3, off: 0.15, attack: 6, release: 6, hold: 20, priority: 9,
    score: (i) => {
      if (i.moons.length < 2) return 0;
      const [a, b] = i.moons;
      const sepDeg = angleBetween(a.dir, b.dir) * DEG;
      return and(ramp(a.elevationDeg, 1, 6), ramp(b.elevationDeg, 1, 6), not(ramp(sepDeg, 4, 9)), not(ramp(i.cloudCover, 0.5, 0.85)), ramp(i.sunElevDeg, 0, -6));
    },
  },
  {
    // Deep night, clear, no bright moon washing the stars out.
    id: "starryNight", label: "starry night", on: 0.35, off: 0.2, attack: 10, release: 10, hold: 30, priority: 3,
    score: (i) => and(ramp(i.sunElevDeg, -10, -18), not(ramp(i.cloudCover, 0.2, 0.5)), not(bestMoon(i, (m) => and(ramp(m.elevationDeg, 0, 10), ramp(m.brightness, 0.3, 0.7))))),
  },
  {
    // The sun breaking through after a storm (the clearing regime with the sun out).
    id: "sunBreak", label: "the sun breaks through", on: 0.3, off: 0.15, attack: 4, release: 8, hold: 15, priority: 8,
    score: (i) => and(i.clearingness, sunShines(i), ramp(i.sunElevDeg, 2, 10)),
  },
  {
    // Gusts past Beaufort 7 (~14 m/s).
    id: "gale", label: "gale", on: 0.35, off: 0.2, attack: 2, release: 6, hold: 10, priority: 7,
    score: (i) => ramp(Math.max(i.gustMs, i.windMs * 1.3), 12, 20),
  },
];

// ------------------------------------------------------------------------- effects

/** How the active events modify the renderer. Neutral values: 1 for multipliers, 0 for layers. */
export interface EventEffects {
  exposure: number;
  saturation: number;
  /** Multiplies the aerial fog distances (< 1 closes the fog in). */
  fogDistance: number;
  /** Linear-RGB grade tint (white = neutral). */
  tint: [number, number, number];
  rainbow: number;
  halo: number;
  /** 0 = the sun is the halo's source, 1 = the brightest moon. */
  haloOnMoon: number;
  shimmer: number;
  frost: number;
  snow: number;
  /** Extra star brightness (starry night) and moon halo/disc boost (conjunction, moonrise). */
  stars: number;
  moonGlow: number;
  /** Wind slant of rain/snow streaks, 0..1 (gale). */
  slant: number;
}

/** A fresh lightning strike's geometry (valid when `fresh`). */
export interface Strike {
  fresh: boolean;
  /** Horizontal distance to the strike, m: cloudBase / tan(elevation of the flash), clamped 300..15000. */
  distanceM: number;
  /** Thunder arrival after the flash, s = distance / 343 m/s. */
  delayS: number;
  /** 0..1 thunder loudness ~ 1 / distance (1 at <= 600 m). */
  loudness: number;
  count: number;
}

export const SPEED_OF_SOUND = 343;
export const STRIKE_MIN_M = 300;
export const STRIKE_MAX_M = 15000;

/** Per-event effect coefficients (the k_i / w_i of the header). */
const GRADE: Partial<Record<EventId, { exposure?: number; saturation?: number; fog?: number; tint?: [number, number, number]; tintW?: number }>> = {
  goldenHour: { saturation: 0.18, tint: [1.12, 0.98, 0.82], tintW: 0.55 },
  blueHour: { saturation: -0.05, tint: [0.82, 0.92, 1.14], tintW: 0.5 },
  thunderstorm: { exposure: -0.12, saturation: -0.3, fog: -0.35, tint: [0.88, 0.94, 1.02], tintW: 0.5 },
  lull: { saturation: -0.12, tint: [0.98, 0.96, 0.88], tintW: 0.4 },
  fogBank: { saturation: -0.25, fog: -0.55 },
  sunBreak: { exposure: 0.08, saturation: 0.22, fog: 0.15 },
  heatShimmer: { saturation: -0.05, tint: [1.05, 1.0, 0.92], tintW: 0.3 },
  snowfall: { exposure: 0.05, saturation: -0.2, fog: -0.3, tint: [0.95, 0.98, 1.05], tintW: 0.35 },
  frost: { tint: [0.96, 0.99, 1.06], tintW: 0.25 },
  starryNight: { saturation: 0.05 },
  // The composite already adds the flash glow; this is the eye's brief over-exposure on top.
  lightningStrike: { exposure: 0.25 },
};

export interface EventFrame {
  intensity: Record<EventId, number>;
  /** Active events, most important first (priority x intensity). */
  active: EventId[];
  effects: EventEffects;
  strike: Strike;
}

export interface WorldEvents {
  /** Advance by dt REAL seconds. Allocation-free once warm (the returned frame is reused). */
  step(i: EventInputs, dt: number): EventFrame;
  frame(): EventFrame;
  /** The label line for the HUD: up to `n` active labels joined by " · " ("" when none). */
  labels(n?: number): string;
  /** Drop every envelope to 0 (a new place / a jump in time). */
  reset(): void;
}

export function createWorldEvents(): WorldEvents {
  const gates = new Map<EventId, Gate>(EVENT_IDS.map((id) => [id, { on: false }]));
  const envs = new Map<EventId, Envelope>(EVENT_IDS.map((id) => [id, createEnvelope()]));
  const intensity = Object.fromEntries(EVENT_IDS.map((id) => [id, 0])) as Record<EventId, number>;
  const effects: EventEffects = {
    exposure: 1, saturation: 1, fogDistance: 1, tint: [1, 1, 1], rainbow: 0, halo: 0, haloOnMoon: 0, shimmer: 0,
    frost: 0, snow: 0, stars: 0, moonGlow: 0, slant: 0,
  };
  const strike: Strike = { fresh: false, distanceM: 0, delayS: 0, loudness: 0, count: 0 };
  const frame: EventFrame = { intensity, active: [], effects, strike };
  const prio = new Map(EVENTS.map((e) => [e.id, e.priority]));
  let flashArmed = true;

  const compose = (i: EventInputs) => {
    let exposure = 1, saturation = 1, fog = 1, w = 0;
    const tint = [0, 0, 0];
    for (const e of EVENTS) {
      const k = intensity[e.id];
      const g = GRADE[e.id];
      if (!g || k <= 0) continue;
      exposure *= 1 + (g.exposure ?? 0) * k;
      saturation *= 1 + (g.saturation ?? 0) * k;
      fog *= 1 + (g.fog ?? 0) * k;
      if (g.tint && g.tintW) {
        const wi = g.tintW * k;
        tint[0] += wi * g.tint[0]; tint[1] += wi * g.tint[1]; tint[2] += wi * g.tint[2];
        w += wi;
      }
    }
    // Normalise when the tint weights sum past 1 (several tinting events at once).
    const W = Math.min(1, w), s = w > 1 ? 1 / w : 1;
    effects.tint[0] = 1 - W + tint[0] * s; effects.tint[1] = 1 - W + tint[1] * s; effects.tint[2] = 1 - W + tint[2] * s;
    effects.exposure = Math.max(0.3, Math.min(2.5, exposure));
    effects.saturation = Math.max(0, Math.min(2, saturation));
    effects.fogDistance = Math.max(0.15, Math.min(2, fog));
    effects.rainbow = intensity.rainbow;
    effects.halo = intensity.halo;
    effects.haloOnMoon = ramp(i.sunElevDeg, 2, -4);
    effects.shimmer = intensity.heatShimmer;
    effects.frost = intensity.frost;
    effects.snow = intensity.snowfall;
    effects.stars = intensity.starryNight;
    effects.moonGlow = Math.max(intensity.moonConjunction, intensity.moonrise * 0.6);
    effects.slant = intensity.gale;
  };

  const api: WorldEvents = {
    step(i, dt) {
      for (const e of EVENTS) {
        const raw = e.score(i);
        const s = Number.isFinite(raw) ? unit(raw) : 0;
        const open = gate(gates.get(e.id)!, s, e.on, e.off);
        intensity[e.id] = stepEnvelope(envs.get(e.id)!, open, s, dt, e.attack, e.release, e.hold).out;
      }
      // A NEW strike is a flash rising through 0.6 after the previous one fell below 0.25 (re-arm).
      strike.fresh = false;
      if (flashArmed && i.lightning >= 0.6) {
        flashArmed = false;
        const el = Math.max(2 / DEG, Math.asin(Math.max(-1, Math.min(1, i.lightningDir[1] / (Math.hypot(...i.lightningDir) || 1)))));
        const base = Math.max(200, Number.isFinite(i.cloudBaseM) ? i.cloudBaseM : 1000);
        strike.distanceM = Math.max(STRIKE_MIN_M, Math.min(STRIKE_MAX_M, base / Math.tan(el)));
        strike.delayS = strike.distanceM / SPEED_OF_SOUND;
        strike.loudness = Math.min(1, 600 / strike.distanceM);
        strike.fresh = true;
        strike.count++;
      } else if (i.lightning < 0.25) flashArmed = true;
      compose(i);
      frame.active.length = 0;
      for (const id of EVENT_IDS) if (intensity[id] > 0.15) frame.active.push(id);
      frame.active.sort((a, b) => prio.get(b)! * intensity[b] - prio.get(a)! * intensity[a]);
      return frame;
    },
    frame: () => frame,
    labels(n = 2) {
      const labelOf = new Map(EVENTS.map((e) => [e.id, e.label]));
      return frame.active.filter((id) => id !== "lightningStrike").slice(0, n).map((id) => labelOf.get(id)).join(" · ");
    },
    reset() {
      for (const id of EVENT_IDS) {
        gates.get(id)!.on = false;
        const e = envs.get(id)!;
        e.level = 0; e.out = 0; e.held = 0; e.active = false;
        intensity[id] = 0;
      }
      flashArmed = true;
      frame.active.length = 0;
    },
  };
  return api;
}
