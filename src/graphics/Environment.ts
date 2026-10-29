// Pure environment model (no Three.js, no DOM): where + when -> sun, moons, sky
// colours, light and cloud cover. The Sky renderer, the cel shader lighting and
// the arena generator all read the same EnvironmentState, so one parameter
// change (hour, latitude, day of year) propagates to every child consistently.

export type Rgb = readonly [number, number, number];
export type DayPhase = "night" | "dawn" | "day" | "dusk";

export interface Place {
  id: string;
  name: string;
  latitude: number;  // degrees, + north
  cloudiness: number; // 0..1 base cloud cover
  wind: number;       // cloud drift speed (sky units / s)
}

// Each arena type lives somewhere on Mytherrania; latitude shifts day length and
// sun height, cloudiness/wind shape the sky.
export const PLACES: readonly Place[] = [
  { id: "sunspire", name: "Sunspire Steppe", latitude: 12, cloudiness: 0.25, wind: 0.010 },
  { id: "greywall", name: "Greywall Keep", latitude: 48, cloudiness: 0.55, wind: 0.018 },
  { id: "verdant", name: "Verdant Hills", latitude: 34, cloudiness: 0.40, wind: 0.014 },
  { id: "frostford", name: "Frostford Crossing", latitude: 63, cloudiness: 0.65, wind: 0.024 },
];

export interface Celestial { dir: readonly [number, number, number]; elevation: number }

export interface EnvironmentState {
  hour: number;
  dayOfYear: number;
  place: Place;
  phase: DayPhase;
  sun: Celestial;
  moons: readonly [Celestial, Celestial];
  zenith: Rgb;
  horizon: Rgb;
  sunColor: Rgb;
  sunIntensity: number;   // after cloud occlusion
  moonIntensity: number;
  ambientColor: Rgb;
  starAlpha: number;
  cloudCover: number;
  sunOcclusion: number;   // 0 clear .. 1 fully covered by cloud
}

const DEG = Math.PI / 180;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Solar position from day of year, local solar hour and latitude (NOAA-style approximation). */
export function solarPosition(dayOfYear: number, hour: number, latitude: number): Celestial {
  const decl = 23.44 * DEG * Math.sin(2 * Math.PI * (284 + dayOfYear) / 365);
  const h = (hour - 12) * 15 * DEG;
  const lat = latitude * DEG;
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(h);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  // Azimuth measured from south, positive toward west.
  const azimuth = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat));
  const c = Math.cos(elevation);
  return { elevation, dir: [-c * Math.sin(azimuth), Math.sin(elevation), c * Math.cos(azimuth)] };
}

/** Two moons with different orbital periods (24.8h and 17.3h) and inclinations. */
export function moonPositions(hour: number, dayOfYear: number): [Celestial, Celestial] {
  // Inclined great circle: x = cos a, y = sin a·cos tilt, z = sin a·sin tilt.
  const orbit = (period: number, offset: number, tilt: number): Celestial => {
    const a = 2 * Math.PI * ((hour + dayOfYear * 24) / period) + offset;
    const dir: [number, number, number] = [Math.cos(a), Math.sin(a) * Math.cos(tilt), Math.sin(a) * Math.sin(tilt)];
    return { elevation: Math.asin(dir[1]), dir };
  };
  return [orbit(24.8, Math.PI, 0.35), orbit(17.3, 2.1, 0.6)];
}

// Value noise shared with the GLSL sky shader (same hash, same fbm octaves), so
// the CPU knows when a cloud drifts over the sun and can dim the light.
function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
export function fbm(x: number, y: number): number {
  let v = 0, amp = 0.5;
  for (let i = 0; i < 4; i++) { v += amp * valueNoise(x, y); x *= 2.03; y *= 2.03; amp *= 0.5; }
  return v;
}
/** Cloud density along a sky direction at time t — mirrored exactly in Sky.ts GLSL. */
export function cloudDensity(dir: readonly [number, number, number], t: number, cover: number, wind: number): number {
  if (dir[1] <= 0.02) return 0;
  const k = 1 / (dir[1] + 0.15);
  const n = fbm(dir[0] * k * 2.2 + t * wind, dir[2] * k * 2.2 + t * wind * 0.6);
  const lo = 0.62 - 0.35 * cover;
  return smoothstep(lo, lo + 0.22, n);
}

/**
 * Ambient luminosity, 0..1, from the sun's elevation (RADIANS) and cloud cover.
 *
 *   L = clamp( 0.04 + 0.96 · smoothstep(-0.105, 0.35, elev) , 0, 1 ) · (1 − 0.45·cloud)
 *
 * -0.105 rad ≈ −6° is civil twilight (the sky is dark below it); 0.35 rad ≈ 20° is
 * where daylight saturates. The 0.04 floor is starlight/moonlight: never pitch black.
 * Senses read this, so night really does shorten sight and lengthen hearing.
 */
export function luminosity(sunElevationRad: number, cloud: number): number {
  const t = Math.max(0, Math.min(1, (sunElevationRad + 0.105) / (0.35 + 0.105)));
  const s = t * t * (3 - 2 * t);
  return Math.max(0, Math.min(1, (0.04 + 0.96 * s) * (1 - 0.45 * Math.max(0, Math.min(1, cloud)))));
}

function phaseOf(elevationDeg: number, hour: number): DayPhase {
  if (elevationDeg < -6) return "night";
  if (elevationDeg < 8) return hour < 12 ? "dawn" : "dusk";
  return "day";
}

/**
 * What the live climate (src/world/climate) overrides in the sky model (wave G). Every field is
 * the climate's value for this frame:
 *   cloudCover     total cover (union of the four layers), replaces place.cloudiness
 *   sunOcclusion   cloud optical cover along the sun ray (CloudField.cloudOcclusionAt, = what is drawn)
 *   overcast       0..1 how grey the sky is (rain + storminess): zenith/horizon desaturate toward
 *                  their luminance and darken by up to 35%
 *   moons          the two moons (direction + elevation) and the light they cast (0..1 each)
 */
export interface ClimateOverrides {
  cloudCover: number;
  sunOcclusion: number;
  overcast: number;
  moons: readonly [Celestial, Celestial];
  moonLight: readonly [number, number];
}

const grey = (c: Rgb, k: number, dark: number): Rgb => {
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return [(c[0] + (l - c[0]) * k) * (1 - dark), (c[1] + (l - c[1]) * k) * (1 - dark), (c[2] + (l - c[2]) * k) * (1 - dark)];
};

/**
 * Sky colour model. d = day factor, tw = twilight Gaussian around the horizon,
 * n = night factor. Rayleigh-like reddening of the sun as it nears the horizon.
 * With `climate` the cover, the sun's cloud occlusion, the greying and the moons come from it.
 */
export function environmentAt(hour: number, dayOfYear: number, place: Place, time = 0, climate?: ClimateOverrides): EnvironmentState {
  const sun = solarPosition(dayOfYear, hour, place.latitude);
  const moons = climate ? climate.moons : moonPositions(hour, dayOfYear);
  const e = sun.elevation / DEG;
  const d = smoothstep(-4, 12, e);
  const tw = Math.exp(-(((e - 1) / 7) ** 2));
  const n = 1 - smoothstep(-16, -3, e);

  const oc = climate ? clamp01(climate.overcast) : 0;
  const zenith = grey(mix([0.015, 0.025, 0.07], [0.16, 0.40, 0.85], d), 0.75 * oc, 0.35 * oc);
  const horizonBase = mix([0.04, 0.05, 0.11], [0.62, 0.79, 0.96], d);
  const horizon: Rgb = grey([
    clamp01(horizonBase[0] + tw * 0.62), clamp01(horizonBase[1] + tw * 0.26), clamp01(horizonBase[2] + tw * 0.02),
  ], 0.6 * oc, 0.25 * oc);
  const sunColor: Rgb = [1, clamp01(0.96 - 0.45 * tw), clamp01(0.88 - 0.7 * tw)];

  const cloudCover = clamp01(climate ? climate.cloudCover : place.cloudiness);
  const sunOcclusion = climate ? clamp01(climate.sunOcclusion) : cloudDensity(sun.dir, time, cloudCover, place.wind);
  const rawSun = Math.pow(Math.max(0, Math.sin(sun.elevation)), 0.55) * 1.35;
  const sunIntensity = rawSun * (1 - 0.65 * sunOcclusion);
  const moonUp = climate
    ? climate.moonLight[0] + 0.6 * climate.moonLight[1]
    : Math.max(0, Math.sin(moons[0].elevation)) + 0.6 * Math.max(0, Math.sin(moons[1].elevation));
  const moonIntensity = n * 0.22 * Math.min(1, moonUp);
  const amb = 0.16 + 0.42 * d * (1 - 0.3 * sunOcclusion);
  const ambientColor: Rgb = mix([amb * 0.42, amb * 0.6, amb * 1.3], [amb, amb * 0.96, amb * 0.9], d);

  return {
    hour, dayOfYear, place, phase: phaseOf(e, hour), sun, moons, zenith, horizon, sunColor,
    sunIntensity, moonIntensity, ambientColor, starAlpha: n, cloudCover, sunOcclusion,
  };
}

/** Local hour (0..24) and day of year from a real Date — arenas happen "now". */
export function clockFromDate(date: Date): { hour: number; dayOfYear: number } {
  const start = Date.UTC(date.getFullYear(), 0, 0);
  const now = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return { hour: date.getHours() + date.getMinutes() / 60, dayOfYear: Math.floor((now - start) / 86400000) };
}
