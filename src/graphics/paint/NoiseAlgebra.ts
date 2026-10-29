// NoiseAlgebra: a JSON-serialisable expression language over seeded noise, compiled once
// into a closure `(x, y, z) => number` that allocates nothing per sample. Every noise
// SOURCE can feed every OPERATOR, so a material is a small tree, not hand-written code.
// Pure module: no Three.js, no DOM.
//
// Vocabulary:
//   source     a leaf that produces a value from the coordinates (noise, pattern, constant).
//              Every noise source returns ~[0, 1] (0.5 + 0.5 n for signed lattice noise) so the
//              blend modes and CSG operators work on the same scale. Exceptions, documented on
//              the node: worley distances (f1 ~0..1.2, f2 ~0..1.5) and raw coordinates.
//   operator   an inner node: arithmetic, shaping, interpolation, trig, blend mode, CSG or a
//              DOMAIN op (which transforms the coordinates its child is sampled at).
//   scale      feature size in coordinate units: a source samples the lattice at p / scale.
//   period     tileable option, in coordinate units per axis (0 = not periodic). Every lattice
//              source rounds its cell count per period to an integer n = round(period / scale)
//              and wraps lattice indices modulo n, so f(p + period) == f(p) exactly.
//   salt       per-source seed decorrelation: seed_source = hashCell(seed, salt, 0, 0, 0x51).
//              Without an explicit `seedSalt` a source gets 1000 + its depth-first index, so two
//              channels compiled from the same tree shape with the same seed share noise.

import { clamp, clamp01, lerp, remap as remapClamped, smoothstep } from "../../core/MathCore.ts";
import { blendChannelCode } from "./Blend.ts";
import {
  type CellSample, gradientNoise3, hash01, hashCell, makeCellSample, makeNoise, type NoiseField,
  valueNoise3, warp3, type WarpOut, worley3,
} from "./Noise.ts";

// ---------------------------------------------------------------------------------------
// Vocabulary lists (tests assert every entry is exercised).

/** Every source node kind. */
export const NOISE_SOURCES = [
  "constant", "coordinate", "value", "gradient", "simplex", "worley",
  "fbm", "ridged", "billow", "turbulence", "checker", "stripes", "spots",
] as const;
export type NoiseSourceKind = typeof NOISE_SOURCES[number];

/** One-input operators `{ op, a }`. */
export const UNARY_OPS = ["neg", "abs", "oneMinus", "sqrt", "exp", "log", "saturate", "sin", "cos"] as const;
/** Two-input operators `{ op, a, b }` (arithmetic, blend modes, hard CSG). */
export const BINARY_OPS = [
  "add", "sub", "mul", "div", "mod", "pow", "min", "max",
  "screen", "overlay", "softLight", "multiply", "difference", "exclusion", "colorDodge", "colorBurn",
  "union", "intersect", "subtract",
] as const;
/** Polynomial smooth CSG `{ op, a, b, k }`. */
export const SMOOTH_CSG_OPS = ["smoothUnion", "smoothIntersect", "smoothSubtract"] as const;
/** Shaping operators with numeric parameters. */
export const SHAPING_OPS = ["clamp", "step", "smoothstep", "threshold", "quantize", "bias", "gain", "remap", "contrast"] as const;
/** Domain operators: transform the coordinates the child `a` is sampled at. */
export const DOMAIN_OPS = ["translate", "scale", "rotate", "warp", "tile"] as const;
/** Every operator node kind (46). */
export const NOISE_OPERATORS = [
  ...UNARY_OPS, ...BINARY_OPS, ...SMOOTH_CSG_OPS, ...SHAPING_OPS, "mix", ...DOMAIN_OPS,
] as const;
export type NoiseOperatorKind = typeof NOISE_OPERATORS[number];

// ---------------------------------------------------------------------------------------
// Expression type.

export type FractalBase = "value" | "gradient" | "simplex";
export type WorleyFeature = "f1" | "f2" | "f2MinusF1" | "cellId";
export type CoordAxis = "x" | "y" | "z" | "radial" | "angle";
export type Vec3Tuple = readonly [number, number, number];

/** Parameters every seeded lattice source accepts. */
export interface SourceParams {
  /** Feature size in coordinate units (default 1). */
  scale?: number;
  /** Explicit seed decorrelation (default: 1000 + depth-first source index). */
  seedSalt?: number;
}

export type NoiseExpr =
  /** A constant value. */
  | { op: "constant"; value: number }
  /**
   * A coordinate. x/y/z raw; radial = sqrt(x^2 + z^2) and angle = atan2(z, x) / 2pi + 0.5 (0..1)
   * about the y axis. With `cell` (or inside a periodic context, where cell defaults to the
   * period) the coordinate is local to a repeating cell: x/y/z become a triangle wave 0..1
   * (0 on cell borders, 1 at the centre: seamless), radial/angle are measured from the cell
   * centre. `angle` is seamed at its branch cut and on cell borders: use sin(2 pi k angle)
   * with integer k, masked to 0 before the cell border.
   */
  | { op: "coordinate"; axis: CoordAxis; cell?: number }
  /** Single-octave lattice noise, 0.5 + 0.5 n: value (blocky), gradient (Perlin), simplex. */
  | ({ op: "value" | "gradient" | "simplex" } & SourceParams)
  /** Worley/cellular: f1, f2 (lattice units), f2 - f1 (0 on cell borders), cellId in [0, 1). */
  | ({ op: "worley"; feature?: WorleyFeature; jitter?: number } & SourceParams)
  /**
   * Fractals of a lattice base: fbm 0.5 + 0.5 sum(g^i n_i)/sum(g^i); ridged sum g^i (1-|n_i|)^2 / W;
   * billow |sum g^i n_i / W| (the whole fbm folded once: puffy creases where fbm crosses 0);
   * turbulence sum g^i |n_i| / W (Perlin 1985: every octave folded).
   */
  | ({ op: "fbm" | "ridged" | "billow" | "turbulence"; base?: FractalBase; octaves?: number; lacunarity?: number; gain?: number } & SourceParams)
  /** 3D checkerboard of `scale`-sized cells: 0 or 1. */
  | { op: "checker"; scale?: number }
  /** Sine bands of period `scale` along an axis, 0..1; sharpness 0 (sine) .. 1 (near square). */
  | { op: "stripes"; axis?: "x" | "y" | "z"; scale?: number; sharpness?: number }
  /** Worley-thresholded discs: radius/softness in lattice units, density = share of cells with a spot. */
  | ({ op: "spots"; jitter?: number; radius?: number; softness?: number; density?: number } & SourceParams)
  | { op: typeof UNARY_OPS[number]; a: NoiseExpr }
  | { op: typeof BINARY_OPS[number]; a: NoiseExpr; b: NoiseExpr }
  | { op: typeof SMOOTH_CSG_OPS[number]; a: NoiseExpr; b: NoiseExpr; k: number }
  | { op: "clamp"; a: NoiseExpr; lo: number; hi: number }
  /** Hard step: a >= edge ? 1 : 0. */
  | { op: "step"; a: NoiseExpr; edge: number }
  | { op: "smoothstep"; a: NoiseExpr; e0: number; e1: number }
  /** Soft threshold: smoothstep(level - softness, level + softness, a) (hard when softness = 0). */
  | { op: "threshold"; a: NoiseExpr; level: number; softness?: number }
  /** Cel posterise of a in [0,1] into `levels` flat bands: min(L-1, floor(aL)) / (L-1). */
  | { op: "quantize"; a: NoiseExpr; levels: number }
  /** Schlick bias / gain; amount 0.5 is identity. */
  | { op: "bias" | "gain"; a: NoiseExpr; amount: number }
  /** Clamped linear remap [inLo, inHi] -> [outLo, outHi] (MathCore.remap). */
  | { op: "remap"; a: NoiseExpr; inLo: number; inHi: number; outLo: number; outHi: number }
  /** (a - pivot) * amount + pivot (pivot default 0.5). */
  | { op: "contrast"; a: NoiseExpr; amount: number; pivot?: number }
  /** lerp(a, b, saturate(t)). */
  | { op: "mix"; a: NoiseExpr; b: NoiseExpr; t: NoiseExpr }
  | { op: "translate"; a: NoiseExpr; offset: Vec3Tuple }
  /** Sample a at p / factor (factor > 1 enlarges features). */
  | { op: "scale"; a: NoiseExpr; factor: number }
  /** Rotate about y by `angle` radians (snapped to a tile-preserving angle when periodic). */
  | { op: "rotate"; a: NoiseExpr; angle: number }
  /**
   * Domain warp: p' = p + amount * 2 (w(p) - 0.5) per axis. `by` = one expr (sampled at three
   * decorrelated offsets) or one per axis; absent = Noise.ts warp3 (fbm, `octaves`), replaced by
   * an equivalent periodic gradient fbm inside a periodic context.
   */
  | { op: "warp"; a: NoiseExpr; amount: number; by?: NoiseExpr | readonly [NoiseExpr, NoiseExpr, NoiseExpr]; octaves?: number }
  /** Make `a` periodic with `period` on every axis (snapped to divide an outer period). */
  | { op: "tile"; a: NoiseExpr; period: number };

/** A compiled expression: allocation-free per sample. */
export type NoiseFn = (x: number, y: number, z: number) => number;

export interface CompileOptions {
  /**
   * Tileable period in coordinate units: a number applies to x, y and z; a tuple per axis
   * (0 = not periodic on that axis).
   */
  period?: number | Vec3Tuple;
}

// ---------------------------------------------------------------------------------------
// Lattice primitives (periodic variants hash wrapped indices with hashCell; Noise.ts's
// 256-entry permutation only repeats every 256 cells).

/** Wrap an integer lattice index into [0, n) (n <= 0: no wrap). */
function wrapIndex(i: number, n: number): number {
  if (n <= 0) return i;
  const r = i % n;
  return r < 0 ? r + n : r;
}

/** Floored modulo for reals (n > 0). */
function fmod(v: number, n: number): number { return v - n * Math.floor(v / n); }

/** Perlin's quintic fade 6t^5 - 15t^4 + 10t^3 (t already in [0, 1]). */
function fade(t: number): number { return t * t * t * (t * (t * 6 - 15) + 10); }

/** Perlin's 12 cube-edge gradients (+4 repeats) dotted with the offset (same table as Noise.ts). */
function grad(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/** Value-noise corner in [-1, 1) from a 32-bit hash: h / 2^31 - 1. */
function valueCorner(seed: number, ix: number, iy: number, iz: number): number {
  return hashCell(seed, ix, iy, iz, 21) / 2147483648 - 1;
}

/** Periodic value noise in [-1, 1]; nx/ny/nz = lattice period per axis (0 = none). */
export function valuePeriodic3(seed: number, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  const u = fade(x - fx), v = fade(y - fy), w = fade(z - fz);
  const x0 = wrapIndex(fx, nx), x1 = wrapIndex(fx + 1, nx);
  const y0 = wrapIndex(fy, ny), y1 = wrapIndex(fy + 1, ny);
  const z0 = wrapIndex(fz, nz), z1 = wrapIndex(fz + 1, nz);
  return lerp(
    lerp(lerp(valueCorner(seed, x0, y0, z0), valueCorner(seed, x1, y0, z0), u),
      lerp(valueCorner(seed, x0, y1, z0), valueCorner(seed, x1, y1, z0), u), v),
    lerp(lerp(valueCorner(seed, x0, y0, z1), valueCorner(seed, x1, y0, z1), u),
      lerp(valueCorner(seed, x0, y1, z1), valueCorner(seed, x1, y1, z1), u), v),
    w);
}

/** Periodic Perlin (improved) gradient noise in ~[-1, 1]; gradients hashed with hashCell. */
export function gradientPeriodic3(seed: number, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  const dx = x - fx, dy = y - fy, dz = z - fz;
  const u = fade(dx), v = fade(dy), w = fade(dz);
  const x0 = wrapIndex(fx, nx), x1 = wrapIndex(fx + 1, nx);
  const y0 = wrapIndex(fy, ny), y1 = wrapIndex(fy + 1, ny);
  const z0 = wrapIndex(fz, nz), z1 = wrapIndex(fz + 1, nz);
  return lerp(
    lerp(
      lerp(grad(hashCell(seed, x0, y0, z0, 22), dx, dy, dz), grad(hashCell(seed, x1, y0, z0, 22), dx - 1, dy, dz), u),
      lerp(grad(hashCell(seed, x0, y1, z0, 22), dx, dy - 1, dz), grad(hashCell(seed, x1, y1, z0, 22), dx - 1, dy - 1, dz), u), v),
    lerp(
      lerp(grad(hashCell(seed, x0, y0, z1, 22), dx, dy, dz - 1), grad(hashCell(seed, x1, y0, z1, 22), dx - 1, dy, dz - 1), u),
      lerp(grad(hashCell(seed, x0, y1, z1, 22), dx, dy - 1, dz - 1), grad(hashCell(seed, x1, y1, z1, 22), dx - 1, dy - 1, dz - 1), u), v),
    w);
}

/**
 * Simplex normalisation. Measured over 10^6 random probes the raw kernel sum peaked at
 * |n| = 0.01301 (lane-N.md), so SIMPLEX_NORM = 75 maps the peak to ~0.975 (clamped to [-1, 1]).
 */
const SIMPLEX_NORM = 75;

/**
 * One simplex corner: vertex (a, b, c) in the skewed uvw lattice sits at Mi (a, b, c) in xyz,
 * with Mi = 1/2 [[-1,1,1],[1,-1,1],[1,1,-1]] (the BCC / A3* lattice of 3D simplex noise, the
 * orientation Gustavson & McEwan's psrdnoise uses because it tiles under integer periods).
 * Kernel (0.5 - r^2)^4 * dot(gradient, offset).
 */
function simplexCorner(
  perm: Uint8Array | null, seed: number, x: number, y: number, z: number,
  a: number, b: number, c: number, nx: number, ny: number, nz: number,
): number {
  const vx = 0.5 * (-a + b + c), vy = 0.5 * (a - b + c), vz = 0.5 * (a + b - c);
  const dx = x - vx, dy = y - vy, dz = z - vz;
  let t = 0.5 - (dx * dx + dy * dy + dz * dz);
  if (t <= 0) return 0;
  let h: number;
  if (perm !== null) {
    h = perm[perm[perm[a & 255] + (b & 255)] + (c & 255)];
  } else {
    // Wrap the vertex in xyz (BCC is invariant under integer shifts), then back to uvw = M v,
    // M = [[0,1,1],[1,0,1],[1,1,0]], so images of one vertex share one hash.
    const wx = nx > 0 ? fmod(vx, nx) : vx, wy = ny > 0 ? fmod(vy, ny) : vy, wz = nz > 0 ? fmod(vz, nz) : vz;
    h = hashCell(seed, Math.round(wy + wz), Math.round(wx + wz), Math.round(wx + wy), 23);
  }
  t *= t;
  return t * t * grad(h, dx, dy, dz);
}

function simplexCore(
  perm: Uint8Array | null, seed: number, x: number, y: number, z: number, nx: number, ny: number, nz: number,
): number {
  // Skew into uvw = M p, find the unit cube, and walk its Kuhn simplex: step first along the
  // axis with the largest fractional part, then the second largest.
  const u = y + z, v = x + z, w = x + y;
  const iu = Math.floor(u), iv = Math.floor(v), iw = Math.floor(w);
  const fu = u - iu, fv = v - iv, fw = w - iw;
  let a1 = 0, b1 = 0, c1 = 0, a2 = 0, b2 = 0, c2 = 0;
  if (fu >= fv) {
    if (fv >= fw) { a1 = 1; a2 = 1; b2 = 1; }
    else if (fu >= fw) { a1 = 1; a2 = 1; c2 = 1; }
    else { c1 = 1; a2 = 1; c2 = 1; }
  } else if (fv < fw) { c1 = 1; b2 = 1; c2 = 1; }
  else if (fu < fw) { b1 = 1; b2 = 1; c2 = 1; }
  else { b1 = 1; a2 = 1; b2 = 1; }
  const n = simplexCorner(perm, seed, x, y, z, iu, iv, iw, nx, ny, nz)
    + simplexCorner(perm, seed, x, y, z, iu + a1, iv + b1, iw + c1, nx, ny, nz)
    + simplexCorner(perm, seed, x, y, z, iu + a2, iv + b2, iw + c2, nx, ny, nz)
    + simplexCorner(perm, seed, x, y, z, iu + 1, iv + 1, iw + 1, nx, ny, nz);
  return clamp(n * SIMPLEX_NORM, -1, 1);
}

/** 3D simplex noise in [-1, 1], hashed through the field's permutation. Mean ~0. */
export function simplex3(f: NoiseField, x: number, y: number, z: number): number {
  return simplexCore(f.perm, f.seed, x, y, z, 0, 0, 0);
}

/** Periodic 3D simplex noise in [-1, 1]: f(p + n_axis) == f(p) for integer periods (0 = none). */
export function simplexPeriodic3(seed: number, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
  return simplexCore(null, seed, x, y, z, nx, ny, nz);
}

/** Periodic Worley: F1/F2 over the 3x3x3 neighbourhood with feature points hashed on wrapped cells. */
export function worleyPeriodic3(
  seed: number, x: number, y: number, z: number, jitter: number, out: CellSample, nx: number, ny: number, nz: number,
): CellSample {
  const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
  const j = clamp01(jitter);
  let f1 = Infinity, f2 = Infinity, id = 0;
  for (let k = -1; k <= 1; k++) {
    const iz = cz + k, wz = wrapIndex(iz, nz);
    for (let jj = -1; jj <= 1; jj++) {
      const iy = cy + jj, wy = wrapIndex(iy, ny);
      for (let i = -1; i <= 1; i++) {
        const ix = cx + i, wx = wrapIndex(ix, nx);
        const dx = ix + 0.5 + j * (hash01(seed, wx, wy, wz, 1) - 0.5) - x;
        const dy = iy + 0.5 + j * (hash01(seed, wx, wy, wz, 2) - 0.5) - y;
        const dz = iz + 0.5 + j * (hash01(seed, wx, wy, wz, 3) - 0.5) - z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < f1) { f2 = f1; f1 = d; id = hashCell(seed, wx, wy, wz, 4); }
        else if (d < f2) f2 = d;
      }
    }
  }
  out.f1 = f1; out.f2 = f2; out.cellId = id;
  return out;
}

/**
 * Spots: max over the 3x3x3 neighbourhood of a soft disc per kept cell. A cell keeps its spot
 * when hash < density; its radius is radius * (0.6 + 0.4 hash) so spots vary in size.
 * Disc = 1 - smoothstep(r - softness, r, distance). Periodic when n > 0.
 */
function spotsSample(
  seed: number, x: number, y: number, z: number, jitter: number, radius: number, softness: number, density: number,
  nx: number, ny: number, nz: number,
): number {
  const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
  const j = clamp01(jitter);
  let v = 0;
  for (let k = -1; k <= 1; k++) {
    const iz = cz + k, wz = wrapIndex(iz, nz);
    for (let jj = -1; jj <= 1; jj++) {
      const iy = cy + jj, wy = wrapIndex(iy, ny);
      for (let i = -1; i <= 1; i++) {
        const ix = cx + i, wx = wrapIndex(ix, nx);
        if (hash01(seed, wx, wy, wz, 31) >= density) continue;
        const r = radius * (0.6 + 0.4 * hash01(seed, wx, wy, wz, 35));
        const dx = ix + 0.5 + j * (hash01(seed, wx, wy, wz, 32) - 0.5) - x;
        const dy = iy + 0.5 + j * (hash01(seed, wx, wy, wz, 33) - 0.5) - y;
        const dz = iz + 0.5 + j * (hash01(seed, wx, wy, wz, 34) - 0.5) - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r) continue;
        const s = 1 - smoothstep(r - softness, r, Math.sqrt(d2));
        if (s > v) v = s;
      }
    }
  }
  return v;
}

// ---------------------------------------------------------------------------------------
// Scalar operator math (exported so tests can check each formula on known inputs).

/** Safe division: |b| < 1e-6 divides by +-1e-6 instead (keeps the sign, never Infinity/NaN). */
export function safeDiv(a: number, b: number): number {
  const d = Math.abs(b) < 1e-6 ? (b < 0 ? -1e-6 : 1e-6) : b;
  return a / d;
}
/** Floored modulo a - b floor(a / b); b = 0 returns 0. */
export function floorMod(a: number, b: number): number { return b === 0 ? 0 : a - b * Math.floor(a / b); }
/** Schlick bias: t / ((1/b - 2)(1 - t) + 1); b = 0.5 is identity, b > 0.5 brightens. */
export function schlickBias(t: number, b: number): number {
  const bb = clamp(b, 1e-4, 1 - 1e-4), tt = clamp01(t);
  return tt / ((1 / bb - 2) * (1 - tt) + 1);
}
/** Schlick gain: S-curve built from two mirrored biases; g = 0.5 identity, g > 0.5 more contrast. */
export function schlickGain(t: number, g: number): number {
  const tt = clamp01(t);
  return tt < 0.5 ? schlickBias(2 * tt, 1 - g) / 2 : 1 - schlickBias(2 - 2 * tt, 1 - g) / 2;
}
/** Cel posterise: min(L - 1, floor(saturate(t) L)) / (L - 1), L >= 2. */
export function quantizeLevels(t: number, levels: number): number {
  const L = Math.max(2, Math.floor(levels));
  return Math.min(L - 1, Math.floor(clamp01(t) * L)) / (L - 1);
}
/** Polynomial smooth minimum (Quilez): h = sat(0.5 + 0.5 (b - a)/k); lerp(b, a, h) - k h (1 - h). */
export function smoothMin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = clamp01(0.5 + 0.5 * (b - a) / k);
  return lerp(b, a, h) - k * h * (1 - h);
}
/** Polynomial smooth maximum: -smoothMin(-a, -b, k). */
export function smoothMax(a: number, b: number, k: number): number { return -smoothMin(-a, -b, k); }

/**
 * Blend modes on saturated inputs (base a, top b). screen/overlay/softLight/multiply come from
 * Blend.ts; difference |a - b|; exclusion a + b - 2ab; colorDodge min(1, a / (1 - b));
 * colorBurn 1 - min(1, (1 - a) / b).
 */
export function blendOp(op: string, a: number, b: number): number {
  const s = clamp01(a), t = clamp01(b);
  switch (op) {
    case "multiply": return blendChannelCode(1, s, t);
    case "screen": return blendChannelCode(2, s, t);
    case "overlay": return blendChannelCode(3, s, t);
    case "softLight": return blendChannelCode(4, s, t);
    case "difference": return Math.abs(s - t);
    case "exclusion": return s + t - 2 * s * t;
    case "colorDodge": return t >= 1 ? 1 : Math.min(1, s / (1 - t));
    case "colorBurn": return t <= 0 ? 0 : 1 - Math.min(1, (1 - s) / t);
    default: throw new Error(`blendOp: unknown mode ${op}`);
  }
}

// ---------------------------------------------------------------------------------------
// Compiler.

interface Ctx {
  seed: number;
  px: number; py: number; pz: number;
  counter: { n: number };
}

/** Lattice cells per period for a feature size: n = max(1, round(period / size)); 0 if not periodic. */
function cellsPerPeriod(period: number, size: number): number {
  return period > 0 ? Math.max(1, Math.round(period / size)) : 0;
}
/** Lattice frequency: n / period when periodic (exact wrap), else 1 / size. */
function latticeFreq(period: number, size: number, n: number): number {
  return period > 0 ? n / period : 1 / size;
}
function positive(v: number | undefined, fallback: number): number {
  return v !== undefined && Number.isFinite(v) && v > 0 ? v : fallback;
}
function isPeriodic(c: Ctx): boolean { return c.px > 0 || c.py > 0 || c.pz > 0; }
function sourceSeed(c: Ctx, salt: number | undefined): number {
  const auto = c.counter.n++;
  return hashCell(c.seed, salt ?? 1000 + auto, 0, 0, 0x51);
}
function withPeriod(c: Ctx, px: number, py: number, pz: number): Ctx {
  return { seed: c.seed, px, py, pz, counter: c.counter };
}

type BaseFn = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number;

function makeBase(kind: FractalBase, seed: number, periodic: boolean): BaseFn {
  if (periodic) {
    if (kind === "value") return (x, y, z, nx, ny, nz) => valuePeriodic3(seed, x, y, z, nx, ny, nz);
    if (kind === "simplex") return (x, y, z, nx, ny, nz) => simplexPeriodic3(seed, x, y, z, nx, ny, nz);
    return (x, y, z, nx, ny, nz) => gradientPeriodic3(seed, x, y, z, nx, ny, nz);
  }
  const f = makeNoise(seed);
  if (kind === "value") return (x, y, z) => valueNoise3(f, x, y, z);
  if (kind === "simplex") return (x, y, z) => simplex3(f, x, y, z);
  return (x, y, z) => gradientNoise3(f, x, y, z);
}

/** Per-axis cell size for coordinate nodes (0 = raw coordinate on that axis). */
function coordCell(period: number, cell: number | undefined): number {
  const c = cell !== undefined && cell > 0 ? cell : 0;
  if (period > 0) return period / Math.max(1, Math.round(period / (c > 0 ? c : period)));
  return c;
}

/** Offset from the centre of the repeating cell of size cs (raw when cs = 0). */
function localOffset(v: number, cs: number): number {
  if (cs <= 0) return v;
  const t = v / cs;
  return (t - Math.floor(t) - 0.5) * cs;
}

/** Triangle wave 0 (cell border) .. 1 (cell centre): continuous, so seamless. */
function triWave(v: number, cs: number): number {
  const t = v / cs, f = t - Math.floor(t);
  return 1 - Math.abs(2 * f - 1);
}

/** Decorrelation offsets for a single `by` warp expression sampled three times (lattice units). */
const WARP_OFFSETS: readonly Vec3Tuple[] = [[0, 0, 0], [31.41, 7.77, 17.93], [-13.57, 23.11, 41.29]];

/**
 * Rotation about y that keeps a periodic context periodic. With px = pz = P the angle snaps to
 * atan2(b, a) for integers |a|,|b| <= 4: shifting x by P moves the rotated point by
 * (a, b) * P / r (r = hypot(a, b)), so a child periodic with P / r on x' and z' stays seamless.
 * Unequal periods snap to a multiple of 90 degrees (periods swap on odd quarter turns).
 */
function snapRotation(angle: number, px: number, pz: number): { c: number; s: number; cpx: number; cpz: number } {
  if (px > 0 && px === pz) {
    let best = { a: 1, b: 0 }, bestErr = Infinity;
    for (let a = -4; a <= 4; a++) {
      for (let b = -4; b <= 4; b++) {
        if (a === 0 && b === 0) continue;
        let d = Math.atan2(b, a) - angle;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const err = Math.abs(d) + 1e-6 * Math.hypot(a, b); // prefer the smallest r on ties
        if (err < bestErr) { bestErr = err; best = { a, b }; }
      }
    }
    const r = Math.hypot(best.a, best.b);
    return { c: best.a / r, s: best.b / r, cpx: px / r, cpz: pz / r };
  }
  if (px > 0 || pz > 0) {
    const k = ((Math.round(angle / (Math.PI / 2)) % 4) + 4) % 4;
    const c = [1, 0, -1, 0][k], s = [0, 1, 0, -1][k];
    return k % 2 === 0 ? { c, s, cpx: px, cpz: pz } : { c, s, cpx: pz, cpz: px };
  }
  return { c: Math.cos(angle), s: Math.sin(angle), cpx: 0, cpz: 0 };
}

function build(e: NoiseExpr, c: Ctx): NoiseFn {
  switch (e.op) {
    // ---------------- sources
    case "constant": {
      const v = e.value;
      return () => v;
    }
    case "coordinate": {
      const cx = coordCell(c.px, e.cell), cy = coordCell(c.py, e.cell), cz = coordCell(c.pz, e.cell);
      switch (e.axis) {
        case "x": return cx > 0 ? (x) => triWave(x, cx) : (x) => x;
        case "y": return cy > 0 ? (_x, y) => triWave(y, cy) : (_x, y) => y;
        case "z": return cz > 0 ? (_x, _y, z) => triWave(z, cz) : (_x, _y, z) => z;
        case "radial": return (x, _y, z) => Math.hypot(localOffset(x, cx), localOffset(z, cz));
        case "angle": return (x, _y, z) => Math.atan2(localOffset(z, cz), localOffset(x, cx)) / (2 * Math.PI) + 0.5;
      }
      throw new Error(`coordinate: unknown axis ${(e as { axis: string }).axis}`);
    }
    case "value": case "gradient": case "simplex": {
      const seed = sourceSeed(c, e.seedSalt), size = positive(e.scale, 1);
      const base = makeBase(e.op, seed, isPeriodic(c));
      const nx = cellsPerPeriod(c.px, size), ny = cellsPerPeriod(c.py, size), nz = cellsPerPeriod(c.pz, size);
      const fx = latticeFreq(c.px, size, nx), fy = latticeFreq(c.py, size, ny), fz = latticeFreq(c.pz, size, nz);
      return (x, y, z) => 0.5 + 0.5 * base(x * fx, y * fy, z * fz, nx, ny, nz);
    }
    case "worley": {
      const seed = sourceSeed(c, e.seedSalt), size = positive(e.scale, 1);
      const jitter = e.jitter ?? 1, feature = e.feature ?? "f1";
      const nx = cellsPerPeriod(c.px, size), ny = cellsPerPeriod(c.py, size), nz = cellsPerPeriod(c.pz, size);
      const fx = latticeFreq(c.px, size, nx), fy = latticeFreq(c.py, size, ny), fz = latticeFreq(c.pz, size, nz);
      const cell = makeCellSample();
      const periodic = isPeriodic(c);
      const field = periodic ? null : makeNoise(seed);
      const sample = field
        ? (x: number, y: number, z: number) => worley3(field, x * fx, y * fy, z * fz, jitter, cell)
        : (x: number, y: number, z: number) => worleyPeriodic3(seed, x * fx, y * fy, z * fz, jitter, cell, nx, ny, nz);
      switch (feature) {
        case "f1": return (x, y, z) => sample(x, y, z).f1;
        case "f2": return (x, y, z) => sample(x, y, z).f2;
        case "f2MinusF1": return (x, y, z) => { const s = sample(x, y, z); return s.f2 - s.f1; };
        case "cellId": return (x, y, z) => sample(x, y, z).cellId / 4294967296;
      }
      throw new Error(`worley: unknown feature ${feature}`);
    }
    case "fbm": case "ridged": case "billow": case "turbulence": {
      const seed = sourceSeed(c, e.seedSalt), size = positive(e.scale, 1);
      const base = makeBase(e.base ?? "gradient", seed, isPeriodic(c));
      const oct = Math.max(1, Math.min(10, Math.floor(e.octaves ?? 4)));
      const lac = positive(e.lacunarity, 2), gain = e.gain ?? 0.5;
      const FX = new Float64Array(oct), FY = new Float64Array(oct), FZ = new Float64Array(oct);
      const NX = new Int32Array(oct), NY = new Int32Array(oct), NZ = new Int32Array(oct);
      const W = new Float64Array(oct);
      let wsum = 0;
      for (let i = 0; i < oct; i++) {
        // Octave i: feature size size / lac^i, weight gain^i.
        const s = size / Math.pow(lac, i);
        NX[i] = cellsPerPeriod(c.px, s); NY[i] = cellsPerPeriod(c.py, s); NZ[i] = cellsPerPeriod(c.pz, s);
        FX[i] = latticeFreq(c.px, s, NX[i]); FY[i] = latticeFreq(c.py, s, NY[i]); FZ[i] = latticeFreq(c.pz, s, NZ[i]);
        W[i] = Math.pow(gain, i); wsum += W[i];
      }
      const kind = e.op === "fbm" ? 0 : e.op === "ridged" ? 1 : e.op === "billow" ? 2 : 3;
      return (x, y, z) => {
        let s = 0;
        for (let i = 0; i < oct; i++) {
          // i * 31.7 lattice units: decorrelates octaves (a translation keeps periodicity).
          const n = base(x * FX[i] + i * 31.7, y * FY[i], z * FZ[i], NX[i], NY[i], NZ[i]);
          if (kind === 1) { const r = 1 - Math.abs(n); s += W[i] * r * r; }
          else if (kind === 3) s += W[i] * Math.abs(n);
          else s += W[i] * n;
        }
        s /= wsum;
        return kind === 0 ? 0.5 + 0.5 * s : kind === 2 ? Math.abs(s) : s;
      };
    }
    case "checker": {
      const size = positive(e.scale, 1);
      // Parity flips every cell, so a periodic axis needs an EVEN cell count per period.
      const even = (p: number) => p > 0 ? Math.max(2, 2 * Math.round(p / (2 * size))) : 0;
      const nx = even(c.px), ny = even(c.py), nz = even(c.pz);
      const fx = latticeFreq(c.px, size, nx), fy = latticeFreq(c.py, size, ny), fz = latticeFreq(c.pz, size, nz);
      return (x, y, z) => (Math.floor(x * fx) + Math.floor(y * fy) + Math.floor(z * fz)) & 1;
    }
    case "stripes": {
      const size = positive(e.scale, 1), axis = e.axis ?? "x";
      const p = axis === "x" ? c.px : axis === "y" ? c.py : c.pz;
      const f = latticeFreq(p, size, cellsPerPeriod(p, size));
      const k = 1 - 0.95 * clamp01(e.sharpness ?? 0); // exponent: 1 = pure sine, 0.05 ~ square
      const w = 2 * Math.PI * f;
      const shape = (v: number) => { const s = Math.sin(v * w); return 0.5 + 0.5 * Math.sign(s) * Math.pow(Math.abs(s), k); };
      if (axis === "x") return (x) => shape(x);
      if (axis === "y") return (_x, y) => shape(y);
      return (_x, _y, z) => shape(z);
    }
    case "spots": {
      const seed = sourceSeed(c, e.seedSalt), size = positive(e.scale, 1);
      const jitter = e.jitter ?? 0.8, radius = e.radius ?? 0.35, soft = Math.max(0, e.softness ?? 0.08);
      const density = clamp01(e.density ?? 0.7);
      const nx = cellsPerPeriod(c.px, size), ny = cellsPerPeriod(c.py, size), nz = cellsPerPeriod(c.pz, size);
      const fx = latticeFreq(c.px, size, nx), fy = latticeFreq(c.py, size, ny), fz = latticeFreq(c.pz, size, nz);
      return (x, y, z) => spotsSample(seed, x * fx, y * fy, z * fz, jitter, radius, soft, density, nx, ny, nz);
    }
    // ---------------- unary
    case "neg": { const a = build(e.a, c); return (x, y, z) => -a(x, y, z); }
    case "abs": { const a = build(e.a, c); return (x, y, z) => Math.abs(a(x, y, z)); }
    case "oneMinus": { const a = build(e.a, c); return (x, y, z) => 1 - a(x, y, z); }
    case "sqrt": { const a = build(e.a, c); return (x, y, z) => Math.sqrt(Math.max(0, a(x, y, z))); }
    case "exp": { const a = build(e.a, c); return (x, y, z) => Math.exp(Math.min(50, a(x, y, z))); }
    case "log": { const a = build(e.a, c); return (x, y, z) => Math.log(Math.max(1e-6, a(x, y, z))); }
    case "saturate": { const a = build(e.a, c); return (x, y, z) => clamp01(a(x, y, z)); }
    case "sin": { const a = build(e.a, c); return (x, y, z) => Math.sin(a(x, y, z)); }
    case "cos": { const a = build(e.a, c); return (x, y, z) => Math.cos(a(x, y, z)); }
    // ---------------- binary
    case "add": { const a = build(e.a, c), b = build(e.b, c); return (x, y, z) => a(x, y, z) + b(x, y, z); }
    case "sub": { const a = build(e.a, c), b = build(e.b, c); return (x, y, z) => a(x, y, z) - b(x, y, z); }
    case "mul": { const a = build(e.a, c), b = build(e.b, c); return (x, y, z) => a(x, y, z) * b(x, y, z); }
    case "div": { const a = build(e.a, c), b = build(e.b, c); return (x, y, z) => safeDiv(a(x, y, z), b(x, y, z)); }
    case "mod": { const a = build(e.a, c), b = build(e.b, c); return (x, y, z) => floorMod(a(x, y, z), b(x, y, z)); }
    case "pow": {
      const a = build(e.a, c), b = build(e.b, c);
      return (x, y, z) => Math.pow(Math.max(0, a(x, y, z)), b(x, y, z));
    }
    case "min": case "intersect": { const a = build(e.a, c), b = build(e.b, c); return (x, y, z) => Math.min(a(x, y, z), b(x, y, z)); }
    case "max": case "union": { const a = build(e.a, c), b = build(e.b, c); return (x, y, z) => Math.max(a(x, y, z), b(x, y, z)); }
    case "subtract": { const a = build(e.a, c), b = build(e.b, c); return (x, y, z) => Math.min(a(x, y, z), 1 - b(x, y, z)); }
    case "screen": case "overlay": case "softLight": case "multiply":
    case "difference": case "exclusion": case "colorDodge": case "colorBurn": {
      const a = build(e.a, c), b = build(e.b, c), mode = e.op;
      return (x, y, z) => blendOp(mode, a(x, y, z), b(x, y, z));
    }
    case "smoothUnion": { const a = build(e.a, c), b = build(e.b, c), k = e.k; return (x, y, z) => smoothMax(a(x, y, z), b(x, y, z), k); }
    case "smoothIntersect": { const a = build(e.a, c), b = build(e.b, c), k = e.k; return (x, y, z) => smoothMin(a(x, y, z), b(x, y, z), k); }
    case "smoothSubtract": { const a = build(e.a, c), b = build(e.b, c), k = e.k; return (x, y, z) => smoothMin(a(x, y, z), 1 - b(x, y, z), k); }
    // ---------------- shaping
    case "clamp": { const a = build(e.a, c), lo = e.lo, hi = e.hi; return (x, y, z) => clamp(a(x, y, z), lo, hi); }
    case "step": { const a = build(e.a, c), edge = e.edge; return (x, y, z) => (a(x, y, z) >= edge ? 1 : 0); }
    case "smoothstep": { const a = build(e.a, c), e0 = e.e0, e1 = e.e1; return (x, y, z) => smoothstep(e0, e1, a(x, y, z)); }
    case "threshold": {
      const a = build(e.a, c), lv = e.level, s = Math.max(0, e.softness ?? 0);
      return s > 0 ? (x, y, z) => smoothstep(lv - s, lv + s, a(x, y, z)) : (x, y, z) => (a(x, y, z) >= lv ? 1 : 0);
    }
    case "quantize": { const a = build(e.a, c), L = e.levels; return (x, y, z) => quantizeLevels(a(x, y, z), L); }
    case "bias": { const a = build(e.a, c), k = e.amount; return (x, y, z) => schlickBias(a(x, y, z), k); }
    case "gain": { const a = build(e.a, c), k = e.amount; return (x, y, z) => schlickGain(a(x, y, z), k); }
    case "remap": {
      const a = build(e.a, c), { inLo, inHi, outLo, outHi } = e;
      return (x, y, z) => remapClamped(a(x, y, z), inLo, inHi, outLo, outHi);
    }
    case "contrast": {
      const a = build(e.a, c), k = e.amount, p = e.pivot ?? 0.5;
      return (x, y, z) => (a(x, y, z) - p) * k + p;
    }
    case "mix": {
      const a = build(e.a, c), b = build(e.b, c), t = build(e.t, c);
      return (x, y, z) => lerp(a(x, y, z), b(x, y, z), clamp01(t(x, y, z)));
    }
    // ---------------- domain
    case "translate": {
      const a = build(e.a, c), [ox, oy, oz] = e.offset;
      return (x, y, z) => a(x + ox, y + oy, z + oz);
    }
    case "scale": {
      const f = positive(e.factor, 1), inv = 1 / f;
      // The child sees p / f, so it must repeat every period / f for the parent to repeat.
      const a = build(e.a, withPeriod(c, c.px / f, c.py / f, c.pz / f));
      return (x, y, z) => a(x * inv, y * inv, z * inv);
    }
    case "rotate": {
      const r = snapRotation(e.angle, c.px, c.pz);
      const a = build(e.a, withPeriod(c, r.cpx, c.py, r.cpz));
      const co = r.c, si = r.s;
      return (x, y, z) => a(co * x - si * z, y, si * x + co * z);
    }
    case "warp": {
      const amp = e.amount * 2;
      let by = e.by;
      if (by === undefined && isPeriodic(c)) {
        const oct = e.octaves ?? 2;
        const f = { op: "fbm", base: "gradient", octaves: oct, scale: 1 } as const;
        by = [
          { op: "translate", a: f, offset: WARP_OFFSETS[0] },
          { op: "translate", a: f, offset: WARP_OFFSETS[1] },
          { op: "translate", a: f, offset: WARP_OFFSETS[2] },
        ];
      }
      if (by === undefined) {
        const field = makeNoise(sourceSeed(c, undefined)), out: WarpOut = { x: 0, y: 0, z: 0 };
        const a = build(e.a, c), oct = e.octaves ?? 2, amount = e.amount;
        return (x, y, z) => { warp3(field, x, y, z, amount, out, oct); return a(out.x, out.y, out.z); };
      }
      if (Array.isArray(by)) {
        const t = by as readonly [NoiseExpr, NoiseExpr, NoiseExpr];
        const wx = build(t[0], c), wy = build(t[1], c), wz = build(t[2], c), a = build(e.a, c);
        return (x, y, z) => a(
          x + amp * (wx(x, y, z) - 0.5), y + amp * (wy(x, y, z) - 0.5), z + amp * (wz(x, y, z) - 0.5));
      }
      const w = build(by as NoiseExpr, c), a = build(e.a, c);
      const [o0, o1, o2] = WARP_OFFSETS;
      return (x, y, z) => a(
        x + amp * (w(x + o0[0], y + o0[1], z + o0[2]) - 0.5),
        y + amp * (w(x + o1[0], y + o1[1], z + o1[2]) - 0.5),
        z + amp * (w(x + o2[0], y + o2[1], z + o2[2]) - 0.5));
    }
    case "tile": {
      const T = positive(e.period, 1);
      const snap = (p: number) => p > 0 ? p / Math.max(1, Math.round(p / T)) : T;
      return build(e.a, withPeriod(c, snap(c.px), snap(c.py), snap(c.pz)));
    }
  }
  throw new Error(`compileNoise: unknown op ${(e as { op: string }).op}`);
}

/**
 * Compile an expression into an allocation-free sampler. Same (expr, seed, opts) -> the same
 * function values bit for bit. With `opts.period` every lattice source, pattern and domain op
 * is made periodic (see the module header), so a texture baked over one period wraps.
 */
export function compileNoise(expr: NoiseExpr, seed: number, opts: CompileOptions = {}): NoiseFn {
  const p = opts.period;
  const per: Vec3Tuple = p === undefined ? [0, 0, 0] : typeof p === "number" ? [p, p, p] : p;
  const fix = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  return build(expr, { seed: seed >>> 0, px: fix(per[0]), py: fix(per[1]), pz: fix(per[2]), counter: { n: 0 } });
}

/** Every op name used in an expression tree (sources and operators), for coverage checks. */
export function noiseOpsUsed(expr: NoiseExpr, into: Set<string> = new Set()): Set<string> {
  into.add(expr.op);
  const e = expr as { a?: NoiseExpr; b?: NoiseExpr; t?: NoiseExpr; by?: NoiseExpr | readonly NoiseExpr[] };
  if (e.a) noiseOpsUsed(e.a, into);
  if (e.b) noiseOpsUsed(e.b, into);
  if (e.t) noiseOpsUsed(e.t, into);
  if (e.by) {
    if (Array.isArray(e.by)) for (const w of e.by as readonly NoiseExpr[]) noiseOpsUsed(w, into);
    else noiseOpsUsed(e.by as NoiseExpr, into);
  }
  return into;
}
