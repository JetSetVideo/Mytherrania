// Iconic time dilation (G18): the game clock lingers on dawn, dusk and blue-sky midday and hurries
// through the in-between climbs, while ONE FULL DAY STILL TAKES `dayLengthSeconds` of real time.
// Pure: no THREE, no DOM.
//
// Dwell weight w(h) >= 0 says how many times longer than average a game hour at solar hour h lasts.
// Real seconds spent per game hour: dt/dh = (dayLengthSeconds / 24) * w(h) / N with
// N = (1/24) * integral_0^24 w(h) dh, so integral_0^24 dt/dh dh = dayLengthSeconds exactly, and
//   dHour/dt = (24 / dayLengthSeconds) * N / w(h).
// The clock is advanced through the CUMULATIVE table C(h) = integral_0^h w (a per-day table built
// from Environment.solarPosition at that day of year + latitude), not by Euler steps: the real-time
// phase s = C(h) / C(24) advances by dt / dayLengthSeconds and is inverted back to an hour, so the
// full-day duration is exact whatever the frame rate.

import type { DayMoment } from "./contracts.ts";
import { DEFAULT_DAY_LENGTH_S } from "./contracts.ts";
import { solarPosition } from "../../graphics/Environment.ts";
import { lerp, smoothstep } from "../../core/MathCore.ts";
import { normalizeDay } from "./Calendar.ts";

/** Dwell weights per kind of moment (> 1 stretched, < 1 hurried). */
export const DWELL = {
  /** Blue hour, sun -6..-2 deg. */
  blueHour: 2.1,
  /** Golden hour / sunrise / sunset, sun -2..+10 deg. */
  golden: 2.4,
  /** Blue-sky midday (sun near its daily maximum, clear sky). */
  middayClear: 1.3,
  /** Midday under cloud: no reason to linger. */
  middayCloudy: 1.0,
  /** Morning / afternoon climbs: the transitions pass quickly. */
  climb: 0.6,
  /** Night. */
  night: 0.88,
} as const;

/** Elevation window edges (deg) of the iconic twilight band, softened by 2 deg ramps. */
export const TWILIGHT_BAND = { lo: -6, hi: 10, ramp: 2, blueToGolden: -2 } as const;

/** Midday weight factor 0..1: sun within ~6..16 deg of its daily maximum, and at least ~20 deg up. */
export function middayness(elevDeg: number, maxElevDeg: number): number {
  return smoothstep(maxElevDeg - 16, maxElevDeg - 6, elevDeg) * smoothstep(14, 22, elevDeg);
}

/** Twilight band factor 0..1 (blue + golden hours). */
export function twilightness(elevDeg: number): number {
  const b = TWILIGHT_BAND;
  return smoothstep(b.lo - b.ramp * 0.75, b.lo + b.ramp * 0.25, elevDeg) * (1 - smoothstep(b.hi - b.ramp * 0.25, b.hi + b.ramp * 0.75, elevDeg));
}

/**
 * Dwell weight at a sun elevation (deg). `maxElevDeg` is the day's highest elevation (midday is
 * relative to it); `blueSky` 0..1 is how clear the sky is (a blue-sky midday is iconic).
 */
export function dwellWeight(elevDeg: number, maxElevDeg: number, blueSky: number): number {
  let w = lerp(DWELL.night, DWELL.climb, smoothstep(-8, -5, elevDeg));
  w = lerp(w, lerp(DWELL.middayCloudy, DWELL.middayClear, blueSky), middayness(elevDeg, maxElevDeg));
  const tw = lerp(DWELL.blueHour, DWELL.golden, smoothstep(TWILIGHT_BAND.blueToGolden - 1, TWILIGHT_BAND.blueToGolden + 1, elevDeg));
  return lerp(w, tw, twilightness(elevDeg));
}

/** Named moment of the day from the sun's elevation; `hour` < 12 is the morning side (solar time). */
export function classifyMoment(elevDeg: number, hour: number, maxElevDeg: number): DayMoment {
  const am = hour < 12;
  if (elevDeg < -6) return "night";
  if (elevDeg < -2) return am ? "blue-hour-dawn" : "blue-hour-dusk";
  if (elevDeg < 2) return am ? "dawn" : "dusk";
  if (elevDeg < 10) return am ? "golden-morning" : "golden-evening";
  if (middayness(elevDeg, maxElevDeg) >= 0.5) return "midday";
  return am ? "morning" : "afternoon";
}

/** True for the twilight moments (blue hour, dawn/dusk, golden hour). */
export function isTwilightMoment(m: DayMoment): boolean {
  return m !== "night" && m !== "morning" && m !== "midday" && m !== "afternoon";
}

/** Samples per day of the dwell table (3-minute resolution). */
export const DAY_TABLE_SAMPLES = 480;

/** One day's warp table. */
export interface DayTable {
  dayOfYear: number;
  latitude: number;
  blueSky: number;
  /** Sun elevation (deg) at the middle of each sample. */
  elevDeg: Float64Array;
  /** Dwell weight per sample. */
  w: Float64Array;
  /** Cumulative integral of w over hours, length samples + 1 (cum[0] = 0). */
  cum: Float64Array;
  maxElevDeg: number;
  /** Mean dwell weight N = cum[samples] / 24. */
  meanW: number;
}

/** Build the table of a day: elevation samples from solarPosition, weights, cumulative integral. */
export function buildDayTable(dayOfYear: number, latitude: number, blueSky: number, into?: DayTable): DayTable {
  const n = DAY_TABLE_SAMPLES;
  const t: DayTable = into ?? {
    dayOfYear, latitude, blueSky, elevDeg: new Float64Array(n), w: new Float64Array(n), cum: new Float64Array(n + 1),
    maxElevDeg: -90, meanW: 1,
  };
  const dh = 24 / n;
  if (!into || into.dayOfYear !== dayOfYear || into.latitude !== latitude) {
    let mx = -90;
    for (let i = 0; i < n; i++) {
      const e = solarPosition(dayOfYear, (i + 0.5) * dh, latitude).elevation * 180 / Math.PI;
      t.elevDeg[i] = e;
      if (e > mx) mx = e;
    }
    t.maxElevDeg = mx;
  }
  t.dayOfYear = dayOfYear; t.latitude = latitude; t.blueSky = blueSky;
  t.cum[0] = 0;
  for (let i = 0; i < n; i++) {
    t.w[i] = dwellWeight(t.elevDeg[i], t.maxElevDeg, blueSky);
    t.cum[i + 1] = t.cum[i] + t.w[i] * dh;
  }
  t.meanW = t.cum[n] / 24;
  return t;
}

/** Real-time phase 0..1 of the day at `hour` (inverse of hourAtPhase). */
export function phaseAtHour(t: DayTable, hour: number): number {
  const n = DAY_TABLE_SAMPLES, dh = 24 / n;
  const h = Math.min(24, Math.max(0, hour));
  const i = Math.min(n - 1, Math.floor(h / dh));
  return (t.cum[i] + t.w[i] * (h - i * dh)) / t.cum[n];
}

/** Hour at real-time phase s (0..1) of the day: binary search in the cumulative table. */
export function hourAtPhase(t: DayTable, s: number): number {
  const n = DAY_TABLE_SAMPLES, dh = 24 / n;
  const target = Math.min(1, Math.max(0, s)) * t.cum[n];
  let lo = 0, hi = n; // cum[lo] <= target < cum[hi]
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t.cum[mid] <= target) lo = mid; else hi = mid; }
  const w = t.w[lo];
  return Math.min(24, lo * dh + (w > 0 ? (target - t.cum[lo]) / w : 0));
}

export interface WarpedClockOptions {
  year: number;
  dayOfYear: number;
  hour: number;
  latitude: number;
  dayLengthSeconds?: number;
}

/** The warped game clock. */
export interface WarpedClock {
  readonly year: number;
  readonly dayOfYear: number;
  readonly hour: number;
  readonly dayLengthSeconds: number;
  /** Game hours per real second right now (0 when frozen). */
  readonly hoursPerSecond: number;
  /** Dwell weight right now. */
  readonly dwell: number;
  readonly sunElevationDeg: number;
  readonly maxElevDeg: number;
  readonly table: DayTable;
  /** Advance by `dt` real seconds; returns the game hours advanced (0 when frozen). */
  advance(dt: number): number;
  set(dayOfYear: number, hour: number, year?: number): void;
  setLatitude(latitude: number): void;
  setDayLength(seconds: number): void;
  /** Sky clearness 0..1 (blue-sky midday dwell); quantised to 0.1 steps, rebuilds the weights on change. */
  setBlueSky(blueSky: number): void;
  moment(): DayMoment;
}

/** Create a warped clock. `dayLengthSeconds` defaults to DEFAULT_DAY_LENGTH_S; 0 freezes it. */
export function createWarpedClock(opts: WarpedClockOptions): WarpedClock {
  const start = normalizeDay(opts.dayOfYear, opts.year);
  let year = start.year, day = start.dayOfYear, latitude = opts.latitude;
  let dayLength = Math.max(0, opts.dayLengthSeconds ?? DEFAULT_DAY_LENGTH_S);
  let blueSky = 1;
  const table = buildDayTable(day, latitude, blueSky);
  let hour = Math.min(24, Math.max(0, opts.hour));
  let s = phaseAtHour(table, hour);

  const sampleIndex = () => Math.min(DAY_TABLE_SAMPLES - 1, Math.floor(hour / (24 / DAY_TABLE_SAMPLES)));

  const clock: WarpedClock = {
    get year() { return year; },
    get dayOfYear() { return day; },
    get hour() { return hour; },
    get dayLengthSeconds() { return dayLength; },
    get hoursPerSecond() { return dayLength > 0 ? table.cum[DAY_TABLE_SAMPLES] / (dayLength * table.w[sampleIndex()]) : 0; },
    get dwell() { return table.w[sampleIndex()] / table.meanW; },
    get sunElevationDeg() { return table.elevDeg[sampleIndex()]; },
    get maxElevDeg() { return table.maxElevDeg; },
    get table() { return table; },
    advance(dt: number): number {
      if (!(dayLength > 0) || !(dt > 0)) return 0;
      const before = hour;
      let days = 0;
      s += dt / dayLength;
      while (s >= 1) {
        s -= 1; days++;
        const n = normalizeDay(day + 1, year);
        day = n.dayOfYear; year = n.year;
        buildDayTable(day, latitude, blueSky, table);
      }
      hour = hourAtPhase(table, s);
      return days * 24 + hour - before;
    },
    set(d: number, h: number, y?: number) {
      const n = normalizeDay(d, y ?? year);
      day = n.dayOfYear; year = n.year;
      hour = Math.min(24, Math.max(0, h));
      if (hour >= 24) hour = 0;
      buildDayTable(day, latitude, blueSky, table);
      s = phaseAtHour(table, hour);
    },
    setLatitude(lat: number) {
      latitude = lat;
      buildDayTable(day, latitude, blueSky, table);
      s = phaseAtHour(table, hour);
    },
    setDayLength(seconds: number) { dayLength = Math.max(0, seconds); },
    setBlueSky(b: number) {
      const q = Math.round(Math.min(1, Math.max(0, b)) * 10) / 10;
      if (q === blueSky) return;
      blueSky = q;
      buildDayTable(day, latitude, blueSky, table);
      s = phaseAtHour(table, hour);
    },
    moment(): DayMoment {
      const e = solarPosition(day, hour, latitude).elevation * 180 / Math.PI;
      return classifyMoment(e, hour, table.maxElevDeg);
    },
  };
  return clock;
}
