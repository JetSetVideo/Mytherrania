// The two moons of Mytherrania (G13): Ilun (large, pale silver-blue, synodic ~29.5 days) and Vesh
// (small, amber-rose, synodic ~11 days). Pure: no THREE, no DOM.
//
// Model (same frame as Environment.solarPosition: +y up, +x east, +z south):
//  - phase p = fract(phase0 + days / synodic): the moon's elongation from the sun along its orbit
//    is lambda = 2 pi p (0 new, 0.5 full), so illumination = (1 - cos(2 pi p)) / 2 is the lit
//    fraction seen from the ground for that sun-moon angle.
//  - the moon's ecliptic longitude is the sun's plus lambda; its declination is the obliquity
//    projection of that longitude plus its orbital inclination (node regressing slowly); its hour
//    angle LAGS the sun's by lambda (a full moon rises at sunset), so it crosses the sky with the hour.
//  - its light crosses the air mass X(h) (Kasten 1966: 1/(sin h + 0.15 (h + 3.885)^-1.253)); per
//    channel extinction tau_c = tau_R (550/lambda_c)^4 + tau_A (550/lambda_c)^1.3 removes blue
//    first, so near the horizon the moon turns amber/red and dims (skyColor), and the light it
//    casts (brightness) = illumination x extinction(green) x above-horizon x relative size.

import type { MoonState, Rgb, Vec3 } from "./contracts.ts";
import { WORLD_COEFFICIENTS as K } from "./WorldVars.ts";
import { smoothstep } from "../../core/MathCore.ts";
import { DAYS_PER_YEAR } from "./Calendar.ts";

export interface MoonDef {
  id: "ilun" | "vesh";
  name: string;
  /** Synodic period (new -> new), days. */
  synodicDays: number;
  /** Phase at absolute day 0 (year 0, day 1, 00:00). */
  phase0: number;
  /** Orbital inclination to the ecliptic, deg. */
  inclinationDeg: number;
  /** Nodal regression period, days (the node circles the ecliptic backward). */
  nodeDays: number;
  /** Apparent angular radius at the zenith, rad. */
  angularRadius: number;
  /** Intrinsic colour, linear RGB. */
  baseColor: Rgb;
  /** Light relative to a full Ilun overhead (size x albedo). */
  relativeLight: number;
}

export const MOONS: readonly [MoonDef, MoonDef] = [
  {
    id: "ilun", name: "Ilun", synodicDays: 29.53, phase0: 0.12, inclinationDeg: 5.1, nodeDays: 6798,
    angularRadius: 0.0105, baseColor: [0.80, 0.86, 0.98], relativeLight: 1,
  },
  {
    id: "vesh", name: "Vesh", synodicDays: 11.0, phase0: 0.61, inclinationDeg: 11.5, nodeDays: 1900,
    angularRadius: 0.0055, baseColor: [0.98, 0.70, 0.62], relativeLight: 0.45,
  },
];

/** Moon-illusion growth of the apparent radius at the horizon (+22 %). */
export const MOON_ILLUSION = 0.22;
/** Aerosol optical depth at 550 nm assumed when the caller passes none. */
export const DEFAULT_AEROSOL_TAU = 0.1;
/** Perceptual compression of the extinction in skyColor (the eye adapts to a dim disc). */
export const SKY_COLOR_GAMMA = 0.35;

const D = Math.PI / 180;
const LAMBDAS = [K.lambdaRedNm, (K.lambdaRefNm), K.lambdaBlueNm] as const;

/** Absolute game days since year 0, day 1, 00:00. */
export function absoluteDays(year: number, dayOfYear: number, hour: number): number {
  return year * DAYS_PER_YEAR + (dayOfYear - 1) + hour / 24;
}

/** Synodic phase 0..1 of a moon at an absolute day. */
export function moonPhase(def: MoonDef, days: number): number {
  const p = def.phase0 + days / def.synodicDays;
  return p - Math.floor(p);
}

/** Kasten (1966) relative air mass at elevation (deg), elevation clamped at the horizon. */
export function airMass(elevDeg: number): number {
  const h = Math.max(0, elevDeg);
  return 1 / (Math.sin(h * D) + K.kastenA * Math.pow(h + K.kastenB, K.kastenC));
}

/** Per-channel (R, G, B) transmittance through `mass` air masses. */
export function extinctionRgb(mass: number, aerosolTau: number, out: number[] = [0, 0, 0]): number[] {
  for (let i = 0; i < 3; i++) {
    const r = K.lambdaRefNm / LAMBDAS[i];
    const tau = K.rayleighTau550 * Math.pow(r, 4) + aerosolTau * Math.pow(r, K.angstrom);
    out[i] = Math.exp(-tau * mass);
  }
  return out;
}

function makeState(def: MoonDef): MoonState {
  return {
    id: def.id, name: def.name, dir: [0, 1, 0], elevation: 0, phase: 0, illumination: 0,
    angularRadius: def.angularRadius, baseColor: def.baseColor, skyColor: [0, 0, 0], brightness: 0,
  };
}

/** Fresh moon states (mutated in place by updateMoons). */
export function createMoonStates(): [MoonState, MoonState] {
  return [makeState(MOONS[0]), makeState(MOONS[1])];
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const trans = [0, 0, 0];

/** Update one moon in place. */
export function updateMoon(def: MoonDef, st: MoonState, year: number, dayOfYear: number, hour: number, latitude: number, aerosolTau = DEFAULT_AEROSOL_TAU): MoonState {
  const m = st as Mutable<MoonState>;
  const days = absoluteDays(year, dayOfYear, hour);
  const phase = moonPhase(def, days);
  const elong = 2 * Math.PI * phase;
  // Sun's ecliptic longitude in Environment's declination law (L = 0 at the spring equinox).
  const Ls = 2 * Math.PI * (284 + dayOfYear) / 365;
  const Lm = Ls + elong;
  const node = -2 * Math.PI * days / def.nodeDays;
  const decl = Math.asin(Math.sin(K.obliquityDeg * D) * Math.sin(Lm)) + def.inclinationDeg * D * Math.sin(Lm - node);
  const H = (hour - 12) * 15 * D - elong; // the moon lags the sun by its elongation
  const lat = latitude * D;
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat));
  const c = Math.cos(el);
  const dir = m.dir as unknown as number[];
  dir[0] = -c * Math.sin(az); dir[1] = Math.sin(el); dir[2] = c * Math.cos(az);
  m.elevation = el;
  m.phase = phase;
  m.illumination = (1 - Math.cos(elong)) / 2;
  const elDeg = el / D;
  m.angularRadius = def.angularRadius * (1 + MOON_ILLUSION * (1 - smoothstep(0, 25, elDeg)));
  extinctionRgb(airMass(elDeg), aerosolTau, trans);
  const up = smoothstep(-0.6, 0.6, elDeg); // disc fully risen ~ +0.6 deg (radius + refraction)
  const sky = m.skyColor as unknown as number[];
  for (let i = 0; i < 3; i++) sky[i] = def.baseColor[i] * Math.pow(trans[i], SKY_COLOR_GAMMA);
  m.brightness = Math.min(1, m.illumination * trans[1] * up * def.relativeLight);
  return st;
}

/** Update both moons in place (no allocation) and return them. */
export function updateMoons(states: [MoonState, MoonState], year: number, dayOfYear: number, hour: number, latitude: number, aerosolTau = DEFAULT_AEROSOL_TAU): [MoonState, MoonState] {
  updateMoon(MOONS[0], states[0], year, dayOfYear, hour, latitude, aerosolTau);
  updateMoon(MOONS[1], states[1], year, dayOfYear, hour, latitude, aerosolTau);
  return states;
}

/** Convenience: fresh moon states at a moment. */
export function moonStates(year: number, dayOfYear: number, hour: number, latitude: number, aerosolTau = DEFAULT_AEROSOL_TAU): [MoonState, MoonState] {
  return updateMoons(createMoonStates(), year, dayOfYear, hour, latitude, aerosolTau);
}

/** Angle (rad) between a moon and a direction (e.g. the sun) — the observed elongation. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, d)));
}
