// TerrainReadability: numbers that say whether the terrain READS on screen (R07, R13),
// computed headlessly from the mesh arrays, so a test can hold them and a handoff can
// compare before/after without a browser.
//
//   lambertStats      per-vertex diffuse term N.L for a sun direction: its p20..p80
//                     spread is how much the relief alone modulates the light. A flat
//                     plane has spread 0 whatever its colour.
//   zoneContrast      CIE76 colour difference (Delta E*ab) between the mean painted
//                     colours of adjacent ground-material zones: >= ~10 is "clearly a
//                     different material" at a glance, < 2.3 is the just-noticeable
//                     difference (Sharma 2003).
//   vertexAreaWeights one third of the area of every incident triangle per vertex, so a
//                     statistic over vertices measures ground AREA (what the camera
//                     sees), not vertex density (the radial ring mesh packs vertices
//                     toward the centre: 5 of its 12 rings lie inside 45% of the radius).
//
// Pure module: no Three.js, no DOM.
import { environmentAt, PLACES, type Place } from "../graphics/Environment.ts";

/** Direction TOWARD the sun (unit, y up) at local `hour` on `dayOfYear` at `place`. */
export function sunDirection(hour: number, dayOfYear: number, place: Place): [number, number, number] {
  const d = environmentAt(hour, dayOfYear, place).sun.dir;
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / len, d[1] / len, d[2] / len];
}

/** The noon sun of every PLACE on `dayOfYear` (the engine lights the arena from environmentAt). */
export function noonSuns(dayOfYear: number): { place: string; dir: [number, number, number]; elevationDeg: number }[] {
  return PLACES.map((p) => {
    const dir = sunDirection(12, dayOfYear, p);
    return { place: p.id, dir, elevationDeg: (Math.asin(dir[1]) * 180) / Math.PI };
  });
}

/**
 * Area weight per vertex, m^2: one third of the 3D area of every triangle of
 * `indices[0 .. 3 * triangleCount)` that uses it. Vertices no triangle uses weigh 0.
 */
export function vertexAreaWeights(positions: ArrayLike<number>, indices: ArrayLike<number>, triangleCount: number, vertexCount: number): Float64Array {
  const w = new Float64Array(vertexCount);
  for (let t = 0; t < triangleCount; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    const ux = positions[b * 3] - positions[a * 3], uy = positions[b * 3 + 1] - positions[a * 3 + 1], uz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const vx = positions[c * 3] - positions[a * 3], vy = positions[c * 3 + 1] - positions[a * 3 + 1], vz = positions[c * 3 + 2] - positions[a * 3 + 2];
    const third = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 6; // |u x v| / 2 / 3
    if (a < vertexCount) w[a] += third;
    if (b < vertexCount) w[b] += third;
    if (c < vertexCount) w[c] += third;
  }
  return w;
}

/** Quantiles of a weighted sample. */
export interface WeightedSpread {
  p20: number;
  p80: number;
  /** p80 - p20. */
  spread: number;
  mean: number;
}

/**
 * Weighted p20 / p80 / mean of `values[0 .. count)` (weights all 1 when `weights` is
 * omitted). The q-quantile is the first sorted value whose cumulative weight reaches
 * q * total.
 */
export function weightedSpread(values: ArrayLike<number>, count: number, weights?: ArrayLike<number>): WeightedSpread {
  const order = Array.from({ length: count }, (_, k) => k).sort((a, b) => values[a] - values[b]);
  let total = 0, mean = 0;
  for (let k = 0; k < count; k++) { const w = weights ? weights[k] : 1; total += w; mean += w * values[k]; }
  const at = (q: number) => {
    let acc = 0;
    for (const k of order) { acc += weights ? weights[k] : 1; if (acc >= q * total) return values[k]; }
    return count ? values[order[count - 1]] : 0;
  };
  const p20 = at(0.2), p80 = at(0.8);
  return { p20, p80, spread: p80 - p20, mean: total > 0 ? mean / total : 0 };
}

/** Lambert term per vertex and its spreads. */
export interface LambertStats {
  /** max(0, N.L) per vertex (first `count` vertices). */
  intensity: Float64Array;
  /** Spread over vertices, each vertex counted once. */
  perVertex: WeightedSpread;
  /** Spread over ground area (vertexAreaWeights): what the camera sees. */
  perArea: WeightedSpread;
}

/**
 * Diffuse Lambert term I = max(0, n . s) for the first `count` vertices of a mesh with
 * unit `normals`, lit from the unit direction `sun` (toward the light). The spread
 * p80 - p20 of I is the relief's own light modulation; ambient light and albedo only
 * scale it.
 */
export function lambertStats(normals: ArrayLike<number>, count: number, sun: readonly [number, number, number], areaWeights?: ArrayLike<number>): LambertStats {
  const intensity = new Float64Array(count);
  for (let v = 0; v < count; v++) {
    intensity[v] = Math.max(0, normals[v * 3] * sun[0] + normals[v * 3 + 1] * sun[1] + normals[v * 3 + 2] * sun[2]);
  }
  return {
    intensity,
    perVertex: weightedSpread(intensity, count),
    perArea: areaWeights ? weightedSpread(intensity, count, areaWeights) : weightedSpread(intensity, count),
  };
}

/** CIE L*a*b* (D65 white, L in 0..100). */
export interface Lab {
  L: number;
  a: number;
  b: number;
}

/**
 * LINEAR sRGB (0..1, the values a three.js `color` attribute holds) to CIE L*a*b*:
 * XYZ = M_sRGB(D65) rgb; f(t) = t^(1/3) above (6/29)^3, else t / (3 (6/29)^2) + 4/29;
 * L = 116 f(Y) - 16, a = 500 (f(X/Xn) - f(Y)), b = 200 (f(Y) - f(Z/Zn)).
 */
export function linearRgbToLab(r: number, g: number, b: number, out: Lab = { L: 0, a: 0, b: 0 }): Lab {
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const e = 216 / 24389, k = 24389 / 27; // (6/29)^3 and (29/3)^3
  const f = (t: number) => (t > e ? Math.cbrt(t) : (k * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  out.L = 116 * fy - 16;
  out.a = 500 * (fx - fy);
  out.b = 200 * (fy - fz);
  return out;
}

/** CIE76 colour difference: the Euclidean distance in L*a*b*. */
export function deltaE76(p: Lab, q: Lab): number {
  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
}

/** Mean colour of each zone and Delta E between listed zone pairs. */
export interface ZoneContrast {
  /** Area-weighted mean Lab per zone id (undefined when the zone has no vertex). */
  meanLab: (Lab | undefined)[];
  /** One entry per requested pair that both exist. */
  pairs: { a: number; b: number; deltaE: number }[];
  /** Smallest and mean Delta E over `pairs` (NaN when none). */
  minDeltaE: number;
  meanDeltaE: number;
}

/**
 * Area-weighted mean LINEAR colour per zone (`zoneOf[v]`, zones 0..zoneCount-1, other
 * values ignored) converted to Lab, then Delta E76 for each `pair` [a, b]. Averaging in
 * linear light before converting is the physically right mean of a patch of ground.
 */
export function zoneContrast(colors: ArrayLike<number>, zoneOf: ArrayLike<number>, count: number, zoneCount: number, pairs: readonly (readonly [number, number])[], weights?: ArrayLike<number>): ZoneContrast {
  const sum = new Float64Array(zoneCount * 4);
  for (let v = 0; v < count; v++) {
    const z = zoneOf[v];
    if (z < 0 || z >= zoneCount) continue;
    const w = weights ? weights[v] : 1;
    sum[z * 4] += w * colors[v * 3]; sum[z * 4 + 1] += w * colors[v * 3 + 1]; sum[z * 4 + 2] += w * colors[v * 3 + 2]; sum[z * 4 + 3] += w;
  }
  const meanLab: (Lab | undefined)[] = [];
  for (let z = 0; z < zoneCount; z++) {
    const w = sum[z * 4 + 3];
    meanLab.push(w > 0 ? linearRgbToLab(sum[z * 4] / w, sum[z * 4 + 1] / w, sum[z * 4 + 2] / w) : undefined);
  }
  const out: { a: number; b: number; deltaE: number }[] = [];
  for (const [a, b] of pairs) {
    const p = meanLab[a], q = meanLab[b];
    if (p && q) out.push({ a, b, deltaE: deltaE76(p, q) });
  }
  const values = out.map((x) => x.deltaE);
  return {
    meanLab, pairs: out,
    minDeltaE: values.length ? Math.min(...values) : NaN,
    meanDeltaE: values.length ? values.reduce((s, x) => s + x, 0) / values.length : NaN,
  };
}
