// Noise: seeded, deterministic 3D noise evaluated directly in model space (metres),
// so paint needs no UV unwrap. Pure module: no Three.js, no DOM, no allocation in the
// per-sample functions (callers pass reusable `out` records).
//
// Vocabulary:
//   lattice    the integer grid the noise is defined on. Callers divide model-space
//              metres by a feature size (`scale`, metres) so one lattice cell = one feature.
//   octave     one layer of fBm; octave i samples at frequency lacunarity^i and weighs
//              gain^i, so detail adds up from coarse to fine.
//   lacunarity frequency ratio between octaves (2 = each octave is twice as fine).
//   gain       amplitude ratio between octaves (0.5 = each octave half as strong).
//   F1, F2     Worley distances (lattice units) from the sample to the nearest and
//              second-nearest feature point. F2 - F1 is ~0 on a cell border.
//   jitter     0..1, how far a Worley feature point may move from its cell centre
//              (0 = a perfect cubic grid, 1 = fully random Voronoi).

import { rng32, smootherstep } from "../../core/MathCore.ts";

/** Number of lattice entries in the permutation table (one byte of hash per axis). */
export const PERM_SIZE = 256;

/**
 * A seeded noise source. `perm` is a Fisher-Yates shuffle of 0..255 (driven by
 * rng32(seed)) stored twice, so `perm[i + j]` never needs a modulo. `offsets` holds
 * three decorrelation offsets (lattice units) for the three channels of a domain warp.
 */
export interface NoiseField {
  seed: number;
  perm: Uint8Array;
  offsets: Float64Array;
}

/** Build the noise source for `seed`. Same seed -> bit-identical noise everywhere. */
export function makeNoise(seed: number): NoiseField {
  const rnd = rng32(seed);
  const base = new Uint8Array(PERM_SIZE);
  for (let i = 0; i < PERM_SIZE; i++) base[i] = i;
  for (let i = PERM_SIZE - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = base[i]; base[i] = base[j]; base[j] = t;
  }
  const perm = new Uint8Array(PERM_SIZE * 2);
  for (let i = 0; i < PERM_SIZE * 2; i++) perm[i] = base[i & (PERM_SIZE - 1)];
  // Warp-channel offsets: far apart (tens of cells) so the three channels are uncorrelated.
  const offsets = new Float64Array(9);
  for (let i = 0; i < 9; i++) offsets[i] = 17 + rnd() * 83;
  return { seed: seed >>> 0, perm, offsets };
}

/** Lattice hash of an integer cell through the permutation table, 0..255. */
function latticeHash(f: NoiseField, ix: number, iy: number, iz: number): number {
  const p = f.perm;
  return p[p[p[ix & 255] + (iy & 255)] + (iz & 255)];
}

/**
 * 32-bit integer hash of a cell and the field seed (murmur3-style finaliser), used by
 * Worley noise where one byte of hash is too coarse. Returns an unsigned 32-bit integer.
 */
export function hashCell(seed: number, ix: number, iy: number, iz: number, salt = 0): number {
  let h = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ Math.imul(ix | 0, 0x85ebca6b), 0xc2b2ae35);
  h = Math.imul(h ^ Math.imul(iy | 0, 0x27d4eb2f), 0x165667b1);
  h = Math.imul(h ^ Math.imul(iz | 0, 0x61c88647), 0x85ebca6b);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** `hashCell` mapped to [0, 1). */
export function hash01(seed: number, ix: number, iy: number, iz: number, salt = 0): number {
  return hashCell(seed, ix, iy, iz, salt) / 4294967296;
}

/** Gradient dot product for Perlin's improved noise: 12 cube-edge directions (+4 repeats). */
function grad(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/** Lerp, local to keep the inner loops monomorphic. */
function mix(a: number, b: number, t: number): number { return a + (b - a) * t; }

/**
 * Perlin's improved gradient noise (2002) at lattice point (x, y, z).
 * Equation: trilinear blend, with the quintic fade 6t^5 - 15t^4 + 10t^3, of the dot
 * products between the 8 corner gradients and the offsets to the sample.
 * Range ~[-1, 1], 0 at every integer lattice point, C2-continuous.
 */
export function gradientNoise3(f: NoiseField, x: number, y: number, z: number): number {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  const X = fx & 255, Y = fy & 255, Z = fz & 255;
  const dx = x - fx, dy = y - fy, dz = z - fz;
  const u = smootherstep(0, 1, dx), v = smootherstep(0, 1, dy), w = smootherstep(0, 1, dz);
  const p = f.perm;
  const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
  const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
  return mix(
    mix(
      mix(grad(p[AA], dx, dy, dz), grad(p[BA], dx - 1, dy, dz), u),
      mix(grad(p[AB], dx, dy - 1, dz), grad(p[BB], dx - 1, dy - 1, dz), u), v),
    mix(
      mix(grad(p[AA + 1], dx, dy, dz - 1), grad(p[BA + 1], dx - 1, dy, dz - 1), u),
      mix(grad(p[AB + 1], dx, dy - 1, dz - 1), grad(p[BB + 1], dx - 1, dy - 1, dz - 1), u), v),
    w);
}

/**
 * Value noise: a random value in [-1, 1] at each lattice corner (from the permutation
 * hash), blended trilinearly with the quintic fade. Blockier than gradient noise;
 * used for coarse mottling where a cell-scale "patchiness" is wanted.
 */
export function valueNoise3(f: NoiseField, x: number, y: number, z: number): number {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  const u = smootherstep(0, 1, x - fx), v = smootherstep(0, 1, y - fy), w = smootherstep(0, 1, z - fz);
  return mix(
    mix(mix(corner(f, fx, fy, fz), corner(f, fx + 1, fy, fz), u),
      mix(corner(f, fx, fy + 1, fz), corner(f, fx + 1, fy + 1, fz), u), v),
    mix(mix(corner(f, fx, fy, fz + 1), corner(f, fx + 1, fy, fz + 1), u),
      mix(corner(f, fx, fy + 1, fz + 1), corner(f, fx + 1, fy + 1, fz + 1), u), v),
    w);
}

/** Value-noise corner value in [-1, 1]: the 0..255 lattice hash rescaled (255 / 2 = 127.5). */
function corner(f: NoiseField, ix: number, iy: number, iz: number): number {
  return latticeHash(f, ix, iy, iz) / 127.5 - 1;
}

/**
 * Fractal Brownian motion: sum over i < octaves of gain^i * gradientNoise(p * lacunarity^i),
 * divided by the sum of the weights so the result stays in ~[-1, 1] for any octave count.
 */
export function fbm3(
  f: NoiseField, x: number, y: number, z: number,
  octaves = 4, lacunarity = 2, gain = 0.5,
): number {
  let sum = 0, weight = 0, amp = 1, freq = 1;
  const n = Math.max(1, Math.floor(octaves));
  for (let i = 0; i < n; i++) {
    sum += amp * gradientNoise3(f, x * freq + i * 31.7, y * freq, z * freq);
    weight += amp; amp *= gain; freq *= lacunarity;
  }
  return sum / weight;
}

/**
 * Ridged multifractal: sum of gain^i * (1 - |noise_i|)^2, normalised to [0, 1]. The
 * zero-crossings of gradient noise become sharp crests (value 1): thin branching lines,
 * which is what veins and cracks look like.
 */
export function ridged3(
  f: NoiseField, x: number, y: number, z: number,
  octaves = 3, lacunarity = 2, gain = 0.5,
): number {
  let sum = 0, weight = 0, amp = 1, freq = 1;
  const n = Math.max(1, Math.floor(octaves));
  for (let i = 0; i < n; i++) {
    const r = 1 - Math.abs(gradientNoise3(f, x * freq, y * freq + i * 19.3, z * freq));
    sum += amp * r * r;
    weight += amp; amp *= gain; freq *= lacunarity;
  }
  return sum / weight;
}

/** Result record of a Worley query (reused by the caller; never allocated per sample). */
export interface CellSample {
  /** Distance to the nearest feature point (lattice units). */
  f1: number;
  /** Distance to the second-nearest feature point (lattice units). */
  f2: number;
  /** 32-bit hash of the nearest cell: a stable identity for per-cell randomness. */
  cellId: number;
}

/** A fresh, zeroed CellSample to reuse across calls. */
export function makeCellSample(): CellSample { return { f1: 0, f2: 0, cellId: 0 }; }

/**
 * Worley (cellular) noise. One feature point per lattice cell, at
 *   cell + 0.5 + jitter * (hash - 0.5)   per axis,
 * and F1/F2 are the two smallest Euclidean distances over the 3x3x3 neighbourhood.
 * `stretchY` squashes the lattice vertically (1 = cubic): with jitter ~0.3 and
 * stretchY = sqrt(3)/2 the cells read as offset hexagonal rows (scales).
 */
export function worley3(
  f: NoiseField, x: number, y: number, z: number, jitter: number, out: CellSample, stretchY = 1,
): CellSample {
  const sy = y / stretchY;
  const cx = Math.floor(x), cy = Math.floor(sy), cz = Math.floor(z);
  let f1 = Infinity, f2 = Infinity, id = 0;
  const j = Math.max(0, Math.min(1, jitter));
  for (let k = -1; k <= 1; k++) {
    for (let jj = -1; jj <= 1; jj++) {
      for (let i = -1; i <= 1; i++) {
        const ix = cx + i, iy = cy + jj, iz = cz + k;
        // Offset rows by half a cell (every other row) so a low-jitter lattice is hex-like.
        const rowShift = (iy & 1) * 0.5 * (1 - j);
        const px = ix + rowShift + 0.5 + j * (hash01(f.seed, ix, iy, iz, 1) - 0.5);
        const py = iy + 0.5 + j * (hash01(f.seed, ix, iy, iz, 2) - 0.5);
        const pz = iz + 0.5 + j * (hash01(f.seed, ix, iy, iz, 3) - 0.5);
        const dx = px - x, dy = py - sy, dz = pz - z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < f1) { f2 = f1; f1 = d; id = hashCell(f.seed, ix, iy, iz, 4); }
        else if (d < f2) { f2 = d; }
      }
    }
  }
  out.f1 = f1; out.f2 = f2; out.cellId = id;
  return out;
}

/** Mutable 3-vector for warp output (reuse one per paint pass). */
export interface WarpOut { x: number; y: number; z: number }

/**
 * Domain warp: q = p + amplitude * (fbm(p + o1), fbm(p + o2), fbm(p + o3)), where the
 * o_i are the field's decorrelation offsets. Feeding q (instead of p) to another
 * pattern bends straight stripes and round spots into organic shapes. `amplitude`
 * is in lattice units (1 = displace by up to ~one feature).
 */
export function warp3(
  f: NoiseField, x: number, y: number, z: number, amplitude: number, out: WarpOut, octaves = 2,
): WarpOut {
  const o = f.offsets;
  out.x = x + amplitude * fbm3(f, x + o[0], y + o[1], z + o[2], octaves);
  out.y = y + amplitude * fbm3(f, x + o[3], y + o[4], z + o[5], octaves);
  out.z = z + amplitude * fbm3(f, x + o[6], y + o[7], z + o[8], octaves);
  return out;
}
