// Cloud field (G14): the four cloud layers as ONE function shared by the sky dome (GLSL), the
// cloud shadows on the ground (composite GLSL) and the CPU (sun occlusion, which dims the key
// light). The GLSL in CLOUD_GLSL and the TypeScript twin below run the same arithmetic, so the
// light dims exactly when a drawn cloud crosses the drawn sun.
//
// Vocabulary:
//   sky plane     each flat layer is a plane at its own altitude; a view direction d hits it at
//                 uv = d.xz / (d.y + LAYER_CURVE) * LAYER_K[layer] (LAYER_CURVE bends the plane down
//                 at the horizon so the far field never aliases into stripes).
//   shape         the layer's CloudShape blended between its two types by typeMix (contracts.ts).
//   normalised   the shaped noise n (fbm, billowed, cell-modulated) is standardised per shape:
//                z = (n - mu(b, c)) / (sigma(b, c) * so(octaves)), with mu/sigma FITTED on 30 000
//                samples of the CPU twin (tools: see tests/render_quality_test.ts):
//                  mu    = 0.4975 + 0.144 b - 0.038 c - 0.0109 b c
//                  sigma = 0.1316 - 0.045 b + 0.022 b^2 + 0.032 c^2 + 0.0306 b c
//                  so    = 1.2 (2 octaves), 1.065 (3), 1 (4), 0.97 (5)
//   coverage lo  a layer covering a fraction c of the sky thresholds z at the standard-normal
//                quantile zc = Phi^-1(1 - c) (Acklam's rational approximation, clamped to +-4), so the
//                drawn cover tracks the requested cover for EVERY type (a billowed cumulus field is
//                no longer half again as cloudy as asked).
//   towering      cumulonimbus is not a plane: it is a cylinder of heaps rising from the horizon
//                 (azimuth x elevation), thinning with height, so storm cells read as walls.
// Pure module apart from the GLSL string: no THREE, no DOM.
import { CLOUD_SHAPES, LAYER_TYPES, type CloudLayerState, type CloudShape } from "../../world/climate/contracts.ts";

/** Projection gain per layer (higher layers: more, smaller-looking features per degree). */
export const LAYER_K: Readonly<Record<string, number>> = { low: 1.5, mid: 2.4, high: 3.8, towering: 1 };
/** Horizon bend of the sky planes. */
export const LAYER_CURVE = 0.12;
/** Drift offsets wrap here (sky-plane units) so float precision never degrades. */
export const DRIFT_WRAP = 4096;
/** Floats per layer in the packed uniform block (4 vec4). */
export const FLOATS_PER_LAYER = 16;

/** Blend a layer's two type shapes: mix(shapeA, shapeB, typeMix), bands rounded. */
export function layerShape(layer: CloudLayerState): CloudShape {
  const [a, b] = LAYER_TYPES[layer.id];
  const A = CLOUD_SHAPES[a], B = CLOUD_SHAPES[b], t = Math.max(0, Math.min(1, layer.typeMix));
  const m = (x: number, y: number) => x + (y - x) * t;
  return {
    scale: m(A.scale, B.scale), billow: m(A.billow, B.billow), streak: m(A.streak, B.streak), cells: m(A.cells, B.cells),
    softness: m(A.softness, B.softness), thickness: m(A.thickness, B.thickness), bands: Math.round(m(A.bands, B.bands)),
  };
}

/** Standard-normal quantile Phi^-1(p) (Acklam; |rel err| < 1.2e-9), clamped to +-4. */
export function normalQuantile(p: number): number {
  if (!(p > 0)) return -4;
  if (!(p < 1)) return 4;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  let z: number;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    z = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - lo) {
    const q = p - 0.5, r = q * q;
    z = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    z = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  return Math.max(-4, Math.min(4, z));
}

/** Standardised-noise threshold for a sky fraction c: zc = Phi^-1(1 - c) (see the header). */
export function coverageThreshold(c: number): number {
  return normalQuantile(1 - Math.max(0, Math.min(1, c)));
}

/** Fitted mean / deviation of the shaped noise for billow b, cells c, `octaves` (header). */
export function shapedNoiseStats(b: number, c: number, octaves: number): { mu: number; sigma: number } {
  const so = octaves <= 2 ? 1.2 : octaves <= 3 ? 1.065 : octaves <= 4 ? 1 : 0.97;
  return {
    mu: 0.4975 + 0.144 * b - 0.038 * c - 0.0109 * b * c,
    sigma: (0.1316 - 0.045 * b + 0.022 * b * b + 0.032 * c * c + 0.0306 * b * c) * so,
  };
}

/**
 * Pack the layers for the shaders: per layer 4 vec4 (CLOUD_LAYERS order)
 *   [0] coverage, density, darkness, thickness
 *   [1] offsetX, offsetZ, windCos, windSin   (accumulated drift, wrapped; drift heading)
 *   [2] scale, billow, streak, cells
 *   [3] softness, bands, coverageLo, enabled(0|1)
 * `offsets` (2 per layer) is advanced by the caller with advanceDrift.
 */
export function packCloudLayers(layers: readonly CloudLayerState[], offsets: Float64Array, out: Float32Array = new Float32Array(4 * FLOATS_PER_LAYER)): Float32Array {
  for (let i = 0; i < 4; i++) {
    const l = layers[i];
    const o = i * FLOATS_PER_LAYER;
    if (!l) { out.fill(0, o, o + FLOATS_PER_LAYER); continue; }
    const s = layerShape(l);
    const sp = Math.hypot(l.driftX, l.driftZ);
    out[o] = l.coverage; out[o + 1] = l.density; out[o + 2] = l.darkness; out[o + 3] = s.thickness;
    out[o + 4] = offsets[i * 2]; out[o + 5] = offsets[i * 2 + 1];
    out[o + 6] = sp > 1e-6 ? l.driftX / sp : 1; out[o + 7] = sp > 1e-6 ? l.driftZ / sp : 0;
    out[o + 8] = s.scale; out[o + 9] = s.billow; out[o + 10] = s.streak; out[o + 11] = s.cells;
    out[o + 12] = s.softness; out[o + 13] = s.bands; out[o + 14] = coverageThreshold(l.coverage);
    out[o + 15] = l.coverage > 0.004 && l.density > 0.004 ? 1 : 0;
  }
  return out;
}

/**
 * Advance the drift offsets: a layer at altitude H moving at v m/s slides across its sky plane at
 * v / (H * DRIFT_METRES) units per second; the plane unit is ~H metres, so the angular speed falls
 * with altitude exactly as real clouds do (high cirrus crawls, low scud races). Wrapped at DRIFT_WRAP.
 */
export const DRIFT_METRES = 0.9;
export function advanceDrift(layers: readonly CloudLayerState[], offsets: Float64Array, dt: number): void {
  for (let i = 0; i < 4; i++) {
    const l = layers[i];
    if (!l) continue;
    const k = LAYER_K[l.id] ?? 1;
    const h = Math.max(300, l.altitudeM);
    const g = (dt * k * 1000) / (h * DRIFT_METRES * 1000);
    offsets[i * 2] = (offsets[i * 2] + l.driftX * g) % DRIFT_WRAP;
    offsets[i * 2 + 1] = (offsets[i * 2 + 1] + l.driftZ * g) % DRIFT_WRAP;
  }
}

// ------------------------------------------------------------------------- the shared GLSL

/**
 * GLSL: needs `uniform vec4 uClouds[16];` declared by the includer and `#define CLOUD_OCTAVES n`.
 * Provides cHash, cNoise, cFbm, cNoise3, cFbm3, cCells, cloudPlaneDensity(layer, uv),
 * cloudToweringDensity(dir), cloudSkyUv(layer, dir).
 */
export const CLOUD_GLSL = /* glsl */ `
float cHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float cHash3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float cNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  float a = cHash(i), b = cHash(i + vec2(1.0, 0.0)), c = cHash(i + vec2(0.0, 1.0)), d = cHash(i + vec2(1.0, 1.0));
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}
float cFbm(vec2 p) {
  float v = 0.0, amp = 0.5, norm = 0.0;
  for (int i = 0; i < CLOUD_OCTAVES; i++) { v += amp * cNoise(p); norm += amp; p = p * 2.03 + vec2(17.1, 9.7); amp *= 0.5; }
  return v / norm;
}
float cNoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  float n000 = cHash3(i), n100 = cHash3(i + vec3(1.0, 0.0, 0.0)), n010 = cHash3(i + vec3(0.0, 1.0, 0.0)), n110 = cHash3(i + vec3(1.0, 1.0, 0.0));
  float n001 = cHash3(i + vec3(0.0, 0.0, 1.0)), n101 = cHash3(i + vec3(1.0, 0.0, 1.0)), n011 = cHash3(i + vec3(0.0, 1.0, 1.0)), n111 = cHash3(i + vec3(1.0));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
float cFbm3(vec3 p) {
  float v = 0.0, amp = 0.5, norm = 0.0;
  for (int i = 0; i < CLOUD_OCTAVES; i++) { v += amp * cNoise3(p); norm += amp; p = p * 2.03 + vec3(17.1, 9.7, 3.3); amp *= 0.5; }
  return v / norm;
}
// Cellular ripples (cirrocumulus / altocumulus): 1 inside a cell, falling to 0 at its border.
float cCells(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float f1 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = vec2(cHash(i + g), cHash(i + g + 7.3));
    f1 = min(f1, length(g + o - f));
  }
  return 1.0 - smoothstep(0.25, 0.75, f1);
}
// Standardise shaped noise (fitted mean/sigma, see CloudField.ts header) for billow b, cells c.
float cloudZ(float n, float b, float c) {
  float oct = float(CLOUD_OCTAVES);
  float so = oct <= 2.0 ? 1.2 : oct <= 3.0 ? 1.065 : oct <= 4.0 ? 1.0 : 0.97;
  float mu = 0.4975 + 0.144 * b - 0.038 * c - 0.0109 * b * c;
  float sg = (0.1316 - 0.045 * b + 0.022 * b * b + 0.032 * c * c + 0.0306 * b * c) * so;
  return (n - mu) / sg;
}
vec2 cloudSkyUv(int layer, vec3 d) {
  float k = layer == 0 ? ${LAYER_K.low.toFixed(3)} : layer == 1 ? ${LAYER_K.mid.toFixed(3)} : ${LAYER_K.high.toFixed(3)};
  return d.xz / (max(d.y, 0.0) + ${LAYER_CURVE.toFixed(3)}) * k;
}
// Density 0..1 of planar layer (0 low, 1 mid, 2 high) at sky-plane point uv.
float cloudPlaneDensity(int layer, vec2 uv) {
  vec4 A = uClouds[layer * 4], B = uClouds[layer * 4 + 1], S = uClouds[layer * 4 + 2], T = uClouds[layer * 4 + 3];
  if (T.w < 0.5) return 0.0;
  vec2 p = uv + B.xy;
  // Wind frame: x along the drift. Streak stretches features along it (fibrous cirrus).
  vec2 q = vec2(dot(p, B.zw), dot(p, vec2(-B.w, B.z)));
  q.x *= mix(1.0, 0.22, S.z);
  q /= max(S.x, 0.05);
  float base = cFbm(q);
  float billow = 1.0 - abs(2.0 * cFbm(q * 1.7 + 3.1) - 1.0);
  float n = mix(base, base * 0.6 + billow * 0.5 - 0.05, S.y);
  n *= mix(1.0, 0.55 + 0.6 * cCells(q * 2.6), S.w);
  float z = cloudZ(n, S.y, S.w);
  float soft = mix(0.3, 2.0, T.x);
  return smoothstep(T.z - soft * 0.5, T.z + soft * 0.5, z) * A.y;
}
// Cumulonimbus: heaps on a cylinder around the arena, rising from the horizon and thinning upward,
// with a flattened anvil spreading at the top (layer 3).
float cloudToweringDensity(vec3 d) {
  vec4 A = uClouds[12], B = uClouds[13], S = uClouds[14], T = uClouds[15];
  if (T.w < 0.5 || d.y < -0.02) return 0.0;
  float az = atan(d.z, d.x);
  float h = max(d.y, 0.0);
  vec3 p = vec3(cos(az) * 3.2, h * 3.2, sin(az) * 3.2) / max(S.x, 0.05) + vec3(B.x, 0.0, B.y) * 0.15;
  float n = cFbm3(p);
  float billow = 1.0 - abs(2.0 * cFbm3(p * 1.9 + 4.7) - 1.0);
  n = mix(n, n * 0.55 + billow * 0.55 - 0.04, S.y);
  // Height profile: the tower narrows with height, the anvil flares near its top.
  // Separate cells: each tower's height varies with azimuth (a few towers around the horizon,
  // merging into a wall only near full coverage), and its body is stretched vertically.
  float tower = smoothstep(0.25, 0.75, cNoise(vec2(az * 1.9 + B.x * 0.02, 7.3)) + (A.x - 0.5) * 0.9);
  float top = mix(0.18, 0.55, A.x) * mix(0.35, 1.0, tower);
  float anvil = smoothstep(top * 0.7, top, h) * (1.0 - smoothstep(top, top + 0.08, h));
  float profile = (1.0 - smoothstep(0.0, top, h)) * 0.9 + anvil * 0.55;
  float lo = T.z + (1.0 - profile) * 2.6;
  float soft = mix(0.3, 2.0, T.x);
  return smoothstep(lo - soft * 0.5, lo + soft * 0.5, cloudZ(n, S.y, 0.0)) * A.y * step(0.0, profile - 0.02);
}
`;

// ------------------------------------------------------------------------- CPU twin

const fract = (v: number) => v - Math.floor(v);
function cHash(x: number, y: number): number {
  let a = fract(x * 0.1031), b = fract(y * 0.1031), c = fract(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return fract((a + b) * c);
}
function cNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = cHash(ix, iy), b = cHash(ix + 1, iy), c = cHash(ix, iy + 1), d = cHash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
/** CPU twin of cFbm. */
export function cloudFbm(x: number, y: number, octaves: number): number {
  let v = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < octaves; i++) { v += amp * cNoise(x, y); norm += amp; x = x * 2.03 + 17.1; y = y * 2.03 + 9.7; amp *= 0.5; }
  return v / norm;
}
function cCells(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  let f1 = 8;
  for (let gy = -1; gy <= 1; gy++) for (let gx = -1; gx <= 1; gx++) {
    const ox = cHash(ix + gx, iy + gy), oy = cHash(ix + gx + 7.3, iy + gy + 7.3);
    f1 = Math.min(f1, Math.hypot(gx + ox - fx, gy + oy - fy));
  }
  const t = Math.max(0, Math.min(1, (f1 - 0.25) / 0.5));
  return 1 - t * t * (3 - 2 * t);
}
const sstep = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** CPU twin of cloudPlaneDensity for packed layer `layer` (0..2) at sky-plane point (u, v). */
export function planeDensityAt(packed: Float32Array, layer: number, u: number, v: number, octaves: number): number {
  const o = layer * FLOATS_PER_LAYER;
  if (packed[o + 15] < 0.5) return 0;
  const px = u + packed[o + 4], pz = v + packed[o + 5];
  const wc = packed[o + 6], ws = packed[o + 7];
  let qx = px * wc + pz * ws;
  let qy = -px * ws + pz * wc;
  qx *= 1 + (0.22 - 1) * packed[o + 10];
  const sc = Math.max(packed[o + 8], 0.05);
  qx /= sc; qy /= sc;
  const base = cloudFbm(qx, qy, octaves);
  const billow = 1 - Math.abs(2 * cloudFbm(qx * 1.7 + 3.1, qy * 1.7 + 3.1, octaves) - 1);
  let n = base + (base * 0.6 + billow * 0.5 - 0.05 - base) * packed[o + 9];
  n *= 1 + (0.55 + 0.6 * cCells(qx * 2.6, qy * 2.6) - 1) * packed[o + 11];
  const st = shapedNoiseStats(packed[o + 9], packed[o + 11], octaves);
  const z = (n - st.mu) / st.sigma;
  const soft = 0.3 + (2.0 - 0.3) * packed[o + 12];
  return sstep(packed[o + 14] - soft * 0.5, packed[o + 14] + soft * 0.5, z) * packed[o + 1];
}

/** Sky-plane uv of a direction for planar layer 0..2 (CPU twin of cloudSkyUv). */
export function skyUv(layer: number, d: readonly [number, number, number]): [number, number] {
  const k = layer === 0 ? LAYER_K.low : layer === 1 ? LAYER_K.mid : LAYER_K.high;
  const s = k / (Math.max(d[1], 0) + LAYER_CURVE);
  return [d[0] * s, d[2] * s];
}

/**
 * Optical cover of the sky along `dir`, 0..1: the layers composite as 1 - prod(1 - density_i *
 * thickness_i) (planar layers; the towering layer is approximated by its coverage x density near
 * the horizon). This is what the sun light is dimmed by.
 */
export function cloudOcclusionAt(packed: Float32Array, dir: readonly [number, number, number], octaves: number): number {
  if (dir[1] <= 0.0) return 0;
  let clear = 1;
  for (let l = 0; l < 3; l++) {
    const [u, v] = skyUv(l, dir);
    const d = planeDensityAt(packed, l, u, v, octaves);
    clear *= 1 - d * Math.min(1, packed[l * FLOATS_PER_LAYER + 3] * 1.4);
  }
  const t = 3 * FLOATS_PER_LAYER;
  if (packed[t + 15] > 0.5) {
    const top = 0.18 + 0.37 * packed[t];
    const below = 1 - sstep(0, top, dir[1]);
    clear *= 1 - packed[t] * packed[t + 1] * below * 0.9;
  }
  return Math.max(0, Math.min(1, 1 - clear));
}
