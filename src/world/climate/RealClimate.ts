// Real-world climate normals per place (G17), interpolated smoothly over the year, plus a diurnal
// model. Pure: no THREE, no DOM.
//
// IMPORTANT: these are APPROXIMATE TYPICAL values read off well-known climate summaries of each
// analogue city (rounded, sometimes blended), NOT authoritative station data. They exist so the
// game's weather has the right shape: hot dry harmattan months vs a monsoon thunder season in the
// Sahel, mild grey winters in Paris, dry sunny Mediterranean summers, long snowy subarctic winters.
//
//   sunspire  (lat 12) — semi-arid Sahel steppe; analogue Niamey, Niger (13.5 N).
//   greywall  (lat 48) — temperate oceanic;       analogue Paris, France (48.8 N).
//   verdant   (lat 34) — Mediterranean;           analogue Algiers, Algeria (36.7 N) (LA-like dry summer).
//   frostford (lat 63) — subarctic;               analogue Ostersund, Sweden (63.2 N) (Trondheim-like wind).
//
// Month m's values sit at the middle of calendar month m (Calendar.MONTHS, the same 365-day year
// the sun uses); between mid-months a periodic Catmull-Rom spline interpolates (C1, cyclic).

import { MONTHS } from "./Calendar.ts";
import { magnusDewPointC, magnusSatVapourHPa } from "./WorldVars.ts";
import { clamp } from "../../core/MathCore.ts";

/** One month's typical climate. */
export interface MonthNormals {
  /** Monthly mean air temperature, degC. */
  tMeanC: number;
  /** Mean daily max - min, K. */
  diurnalRangeC: number;
  /** Mean relative humidity, 0..1. */
  relativeHumidity: number;
  /** Mean-sea-level pressure, hPa. */
  pressureHPa: number;
  /** Mean 10 m wind, m/s. */
  windMs: number;
  /** Mean cloud cover fraction, 0..1. */
  cloudFraction: number;
  /** Days with >= 1 mm precipitation (of ~30). */
  precipDays: number;
  /** Days with thunder (of ~30). */
  thunderDays: number;
  /** Share of precipitation falling as snow, 0..1. */
  snowShare: number;
  /** Background aerosol load (dust, haze), 0..1 (lane-C estimate, not a station value). */
  aerosol: number;
}

export interface PlaceClimate {
  id: string;
  analogue: string;
  latitude: number;
  /** Snow-free ground albedo of the landscape. */
  groundAlbedo: number;
  /** Prevailing wind heading (toward), rad, atan2(z, x) in the Environment frame (+x east, +z south). */
  prevailingWindDirRad: number;
  months: readonly MonthNormals[];
}

const FIELDS = [
  "tMeanC", "diurnalRangeC", "relativeHumidity", "pressureHPa", "windMs", "cloudFraction",
  "precipDays", "thunderDays", "snowShare", "aerosol",
] as const;
type Field = typeof FIELDS[number];
type Columns = Record<Field, readonly number[]>;

/** Physical bounds the spline is clamped to (Catmull-Rom can overshoot slightly). */
const FIELD_RANGE: Readonly<Record<Field, readonly [number, number]>> = {
  tMeanC: [-45, 45], diurnalRangeC: [1, 25], relativeHumidity: [0.05, 1], pressureHPa: [980, 1040],
  windMs: [0, 20], cloudFraction: [0, 1], precipDays: [0, 31], thunderDays: [0, 31], snowShare: [0, 1], aerosol: [0, 1],
};

function build(id: string, analogue: string, latitude: number, groundAlbedo: number, prevailingWindDirRad: number, cols: Columns): PlaceClimate {
  const months: MonthNormals[] = [];
  for (let m = 0; m < 12; m++) {
    const n = {} as MonthNormals;
    for (const f of FIELDS) {
      if (cols[f].length !== 12) throw new Error(`climate ${id}.${f}: need 12 months`);
      n[f] = cols[f][m];
    }
    months.push(n);
  }
  return { id, analogue, latitude, groundAlbedo, prevailingWindDirRad, months };
}

//                      Jan    Feb    Mar    Apr    May    Jun    Jul    Aug    Sep    Oct    Nov    Dec
export const PLACE_CLIMATES: Readonly<Record<string, PlaceClimate>> = {
  // Niamey: harmattan dry season (dusty NE wind, huge diurnal range) then a Jun-Sep monsoon of
  // squall-line thunderstorms; hottest in April-May before the rains.
  sunspire: build("sunspire", "Niamey, Niger (Sahel steppe)", 12, 0.32, 2.356, {
    tMeanC: [24.5, 27.5, 31.3, 34.0, 33.8, 31.4, 28.6, 27.4, 28.9, 30.8, 28.0, 25.0],
    diurnalRangeC: [16, 16, 15, 14, 13, 11, 9, 8, 9, 13, 16, 16],
    relativeHumidity: [0.21, 0.18, 0.17, 0.25, 0.38, 0.52, 0.66, 0.74, 0.68, 0.45, 0.27, 0.24],
    pressureHPa: [1013, 1012, 1010, 1008, 1008, 1009, 1010, 1010, 1010, 1010, 1011, 1013],
    windMs: [3.5, 3.6, 3.4, 3.0, 3.4, 3.8, 3.6, 3.0, 2.5, 2.4, 2.8, 3.3],
    cloudFraction: [0.12, 0.12, 0.18, 0.28, 0.38, 0.48, 0.6, 0.65, 0.5, 0.25, 0.12, 0.1],
    precipDays: [0, 0, 0.3, 1, 3, 6, 10, 12, 7, 1, 0, 0],
    thunderDays: [0, 0, 0.3, 2, 6, 9, 11, 11, 8, 2, 0, 0],
    snowShare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    aerosol: [0.75, 0.8, 0.85, 0.75, 0.6, 0.45, 0.35, 0.3, 0.35, 0.45, 0.6, 0.7],
  }),
  // Paris: mild, grey, damp winters; warm summers with occasional thunderstorms; rain all year.
  greywall: build("greywall", "Paris, France (temperate oceanic)", 48, 0.17, 0, {
    tMeanC: [5.0, 5.6, 8.8, 11.5, 15.2, 18.3, 20.5, 20.3, 16.9, 12.9, 8.3, 5.5],
    diurnalRangeC: [6, 7, 9, 10, 10, 10, 10.5, 10, 9, 7.5, 6, 5.5],
    relativeHumidity: [0.86, 0.81, 0.75, 0.7, 0.71, 0.7, 0.69, 0.72, 0.77, 0.84, 0.87, 0.88],
    pressureHPa: [1018, 1017, 1015, 1014, 1015, 1016, 1016, 1016, 1017, 1016, 1016, 1017],
    windMs: [4.4, 4.3, 4.2, 3.9, 3.6, 3.4, 3.3, 3.2, 3.4, 3.8, 4.1, 4.4],
    cloudFraction: [0.75, 0.7, 0.65, 0.6, 0.58, 0.53, 0.5, 0.5, 0.55, 0.65, 0.75, 0.78],
    precipDays: [10, 9, 10, 9, 9, 8, 7, 7, 8, 9, 10, 11],
    thunderDays: [0.2, 0.2, 0.5, 1.5, 3.5, 4, 4.5, 4, 2, 0.8, 0.2, 0.2],
    snowShare: [0.15, 0.15, 0.05, 0, 0, 0, 0, 0, 0, 0, 0.03, 0.12],
    aerosol: [0.3, 0.3, 0.32, 0.3, 0.28, 0.28, 0.28, 0.28, 0.28, 0.3, 0.3, 0.3],
  }),
  // Algiers: wet mild winters, dry hot sunny summers, autumn thunderstorms, Saharan dust in spring.
  verdant: build("verdant", "Algiers, Algeria (Mediterranean)", 34, 0.2, Math.PI / 2, {
    tMeanC: [12.2, 12.7, 14.3, 16.3, 19.2, 22.9, 25.9, 26.6, 24.0, 20.4, 16.2, 13.5],
    diurnalRangeC: [9, 9.4, 9.6, 9.6, 9.4, 9.5, 9.6, 9.4, 9, 9, 9, 9],
    relativeHumidity: [0.75, 0.73, 0.72, 0.71, 0.72, 0.7, 0.7, 0.69, 0.71, 0.72, 0.74, 0.75],
    pressureHPa: [1019, 1018, 1016, 1014, 1015, 1015, 1015, 1015, 1016, 1017, 1018, 1019],
    windMs: [3.8, 3.8, 3.6, 3.5, 3.3, 3.3, 3.4, 3.4, 3.3, 3.3, 3.6, 3.8],
    cloudFraction: [0.5, 0.48, 0.45, 0.42, 0.35, 0.2, 0.1, 0.12, 0.25, 0.38, 0.48, 0.5],
    precipDays: [11, 9, 8, 7, 5, 2, 1, 1, 4, 7, 10, 11],
    thunderDays: [1, 1, 1, 1, 1.5, 1, 0.5, 1, 2, 2.5, 2, 1.5],
    snowShare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    aerosol: [0.3, 0.32, 0.38, 0.42, 0.45, 0.45, 0.45, 0.42, 0.4, 0.35, 0.3, 0.3],
  }),
  // Ostersund: long snowy winters, short mild summers with a few thunder days, clean air.
  frostford: build("frostford", "Ostersund, Sweden (subarctic)", 63, 0.15, -Math.PI / 4, {
    tMeanC: [-7.5, -7.0, -3.4, 1.5, 7.0, 11.8, 14.6, 13.2, 8.6, 3.4, -2.0, -5.6],
    diurnalRangeC: [6, 7, 8, 9, 10, 10, 9.5, 9, 8, 6.5, 5.5, 5.5],
    relativeHumidity: [0.86, 0.83, 0.77, 0.7, 0.64, 0.67, 0.73, 0.77, 0.82, 0.85, 0.88, 0.88],
    pressureHPa: [1008, 1010, 1011, 1013, 1014, 1012, 1011, 1011, 1011, 1009, 1008, 1007],
    windMs: [3.6, 3.5, 3.4, 3.3, 3.2, 3.0, 2.8, 2.8, 3.0, 3.3, 3.4, 3.6],
    cloudFraction: [0.75, 0.7, 0.65, 0.62, 0.6, 0.6, 0.6, 0.62, 0.68, 0.74, 0.8, 0.8],
    precipDays: [9, 7, 7, 6, 7, 9, 11, 11, 10, 9, 9, 10],
    thunderDays: [0, 0, 0, 0, 0.3, 1, 1.8, 1.2, 0.2, 0, 0, 0],
    snowShare: [0.95, 0.95, 0.85, 0.55, 0.12, 0, 0, 0, 0.05, 0.35, 0.8, 0.93],
    aerosol: [0.12, 0.12, 0.13, 0.14, 0.14, 0.13, 0.13, 0.13, 0.12, 0.12, 0.12, 0.12],
  }),
};

/** A place's climate; an unknown id falls back to the place with the nearest latitude. */
export function placeClimate(placeId: string, latitude?: number): PlaceClimate {
  const p = PLACE_CLIMATES[placeId];
  if (p) return p;
  const lat = Math.abs(latitude ?? 48);
  let best = PLACE_CLIMATES.greywall;
  for (const k in PLACE_CLIMATES) {
    const q = PLACE_CLIMATES[k];
    if (Math.abs(q.latitude - lat) < Math.abs(best.latitude - lat)) best = q;
  }
  return best;
}

// ---------------------------------------------------------------- yearly interpolation

/** Day of year (fractional, 1-based) at the middle of each calendar month. */
export const MONTH_MID_DAYS: readonly number[] = (() => {
  const out: number[] = [];
  let start = 1;
  for (const m of MONTHS) { out.push(start + m.days / 2 - 0.5); start += m.days; }
  return out;
})();

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Normals at `dayOfYear` (1..365, fractional ok, wraps): periodic Catmull-Rom between mid-months. */
export function normalsAt(place: PlaceClimate, dayOfYear: number, out: MonthNormals = {} as MonthNormals): MonthNormals {
  const d = ((((dayOfYear - 1) % 365) + 365) % 365) + 1;
  // segment [i, i+1] with mid(i) <= d < mid(i+1) (cyclic)
  let i = 11;
  for (let k = 0; k < 12; k++) if (d >= MONTH_MID_DAYS[k]) i = k;
  const j = (i + 1) % 12;
  const a = MONTH_MID_DAYS[i];
  let b = MONTH_MID_DAYS[j];
  let x = d;
  if (b <= a) { b += 365; if (x < a) x += 365; }
  const t = (x - a) / (b - a);
  const m = place.months;
  const p0 = m[(i + 11) % 12], p1 = m[i], p2 = m[j], p3 = m[(j + 1) % 12];
  for (const f of FIELDS) {
    const [lo, hi] = FIELD_RANGE[f];
    out[f] = clamp(catmullRom(p0[f], p1[f], p2[f], p3[f], t), lo, hi);
  }
  return out;
}

// ---------------------------------------------------------------- diurnal model

/** Diurnal model constants. */
export const DIURNAL = {
  /** Local solar hour of the daily maximum temperature (~15:00). */
  tMaxHour: 15,
  /** Wind's diurnal amplitude: mixing peaks mid-afternoon. */
  windAmp: 0.3,
  /** Hour of the wind maximum. */
  windPeakHour: 15,
  /** Sunrise is clamped into this window (polar day/night keep a sane curve). */
  sunriseMin: 3, sunriseMax: 9,
} as const;

/** Sunrise hour from the sunrise equation, declination as Environment.solarPosition computes it. */
export function sunriseHour(dayOfYear: number, latitude: number): number {
  const D = Math.PI / 180;
  const decl = 23.44 * D * Math.sin(2 * Math.PI * (284 + dayOfYear) / 365);
  const cw = clamp(-Math.tan(latitude * D) * Math.tan(decl), -1, 1);
  return clamp(12 - Math.acos(cw) / D / 15, DIURNAL.sunriseMin, DIURNAL.sunriseMax);
}

/**
 * Diurnal temperature shape 0..1: 0 at sunrise (the minimum), 1 at 15:00 (the maximum); a half
 * cosine up and a half cosine down, so its daily mean is exactly 0.5 and T averages tMean.
 */
export function diurnalShape(hour: number, sunrise: number): number {
  const h = ((hour % 24) + 24) % 24;
  const tMax = DIURNAL.tMaxHour;
  if (h >= sunrise && h <= tMax) return 0.5 - 0.5 * Math.cos(Math.PI * (h - sunrise) / (tMax - sunrise));
  const since = h > tMax ? h - tMax : h + 24 - tMax; // hours since the maximum
  return 0.5 + 0.5 * Math.cos(Math.PI * since / (sunrise + 24 - tMax));
}

export interface DiurnalState {
  temperatureC: number;
  relativeHumidity: number;
  dewPointC: number;
  windMs: number;
}

/**
 * Typical weather at `hour` for these normals. Temperature follows diurnalShape (scaled by
 * `rangeScale`, e.g. < 1 under cloud). The vapour pressure stays at its daily value (the dew point
 * barely moves over a day), so humidity runs inversely to temperature: RH = e / e_s(T(hour)).
 */
export function diurnalAt(
  n: MonthNormals, hour: number, dayOfYear: number, latitude: number, rangeScale = 1,
  out: DiurnalState = { temperatureC: 0, relativeHumidity: 0, dewPointC: 0, windMs: 0 },
): DiurnalState {
  const s = diurnalShape(hour, sunriseHour(dayOfYear, latitude));
  const t = n.tMeanC + n.diurnalRangeC * rangeScale * (s - 0.5);
  const dew = magnusDewPointC(n.tMeanC, n.relativeHumidity);
  const e = magnusSatVapourHPa(dew);
  out.temperatureC = t;
  out.relativeHumidity = clamp(e / magnusSatVapourHPa(t), 0.05, 1);
  out.dewPointC = Math.min(dew, t);
  out.windMs = n.windMs * (1 + DIURNAL.windAmp * Math.cos(2 * Math.PI * (hour - DIURNAL.windPeakHour) / 24));
  return out;
}
