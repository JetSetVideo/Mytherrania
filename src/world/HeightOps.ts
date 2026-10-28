// HeightOps: the pure numeric building blocks of the heightfield (R07, R08).
//
//   value noise + fBm        the base terrain shape
//   remapToTargetBand        the normalisation that gives the base a target p80 - p20 spread
//   relaxSlopes              the slope-limit pass (exact Lipschitz envelopes): no two
//                            unflagged neighbours further apart in height than the
//                            walkable slope allows
//   maxSlopeExcess / slopePairs   the verification of that rule
//
// Grid convention (shared with Heightfield.ts): node (i, j) lives at index j * cols + i;
// i runs along +x, j along +z. "Forward neighbours" are E (1,0), S (0,1), SE (1,1) and
// SW (-1,1): visiting them from every node visits each 8-neighbour pair exactly once.
// Pure module: no Three.js, no DOM.

/** Forward-neighbour offsets along i (x). The first two are axis pairs, the last two diagonal. */
export const FORWARD_DI: readonly number[] = [1, 0, 1, -1];
/** Forward-neighbour offsets along j (z). */
export const FORWARD_DJ: readonly number[] = [0, 1, 1, 1];

/**
 * Integer-lattice hash in [0, 1): a murmur3-style finaliser over (ix, iz, salt). Same
 * inputs, same output, on every platform (Math.imul is exact 32-bit).
 */
export function hash01(ix: number, iz: number, salt: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Value noise in [0, 1): hashed values on the integer lattice, blended with the
 * smoothstep weight s = t^2 (3 - 2t) so the surface is C1 (no creases at lattice lines).
 * `x`, `z` are in lattice units (one unit = one wavelength of this octave).
 */
export function valueNoise2(x: number, z: number, salt: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash01(ix, iz, salt), b = hash01(ix + 1, iz, salt);
  const c = hash01(ix, iz + 1, salt), d = hash01(ix + 1, iz + 1, salt);
  const top = a + (b - a) * sx, bottom = c + (d - c) * sx;
  return top + (bottom - top) * sz;
}

/** Per-octave parameters of an fBm sum, prepared once per field (no per-sample allocation). */
export interface FbmOctaves {
  /** Gain of octave k (sums to 1, from TerrainRules.octaveGains). */
  gains: readonly number[];
  /** Frequency of octave k, 1/m: 2^k / baseWavelength. */
  frequencies: Float64Array;
  /** Lattice offsets so octaves do not share a lattice origin (no visible seam at 0,0). */
  offsetX: Float64Array;
  offsetZ: Float64Array;
  /** Per-octave hash salt. */
  salts: Int32Array;
}

/** Prepare fBm octaves: frequencies double each octave (lacunarity 2), offsets and salts from `rng`. */
export function makeFbmOctaves(gains: readonly number[], baseWavelength: number, rng: () => number): FbmOctaves {
  const n = gains.length;
  const o: FbmOctaves = {
    gains,
    frequencies: new Float64Array(n),
    offsetX: new Float64Array(n),
    offsetZ: new Float64Array(n),
    salts: new Int32Array(n),
  };
  for (let k = 0; k < n; k++) {
    o.frequencies[k] = Math.pow(2, k) / Math.max(1e-6, baseWavelength);
    o.offsetX[k] = rng() * 1024; // any offset works; 1024 lattice units keeps it far from the origin
    o.offsetZ[k] = rng() * 1024;
    o.salts[k] = Math.floor(rng() * 0x7fffffff);
  }
  return o;
}

/** Fractal Brownian motion at world (x, z), metres -> [0, 1): sum_k gain_k * noise(f_k x, f_k z). */
export function fbm2(o: FbmOctaves, x: number, z: number): number {
  let sum = 0;
  for (let k = 0; k < o.gains.length; k++) {
    const f = o.frequencies[k];
    sum += o.gains[k] * valueNoise2(x * f + o.offsetX[k], z * f + o.offsetZ[k], o.salts[k]);
  }
  return sum;
}

/**
 * Normalisation with a TARGET SPREAD. `values` must already be min-max normalised to
 * [0, 1]; `p20`/`p80` are their 20th/80th percentiles. A monotone three-piece linear map
 * sends
 *     0 -> 0,   p20 -> 0.5 - band/2,   p80 -> 0.5 + band/2,   1 -> 1
 * so afterwards min = 0, max = 1 and p80 - p20 = `band` exactly: the middle 60% of the
 * nodes occupy `band` of the range, the low 20% tail (dug, sign -1) and the high 20%
 * tail (raised, sign +1) mirror each other around 0.5. In place.
 */
export function remapToTargetBand(values: Float64Array | Float32Array, p20: number, p80: number, band: number): void {
  const lowKnot = 0.5 - band / 2, highKnot = 0.5 + band / 2;
  const midSpan = p80 - p20;
  for (let n = 0; n < values.length; n++) {
    const v = values[n];
    let out: number;
    if (v <= p20) out = p20 > 0 ? (v / p20) * lowKnot : lowKnot;
    else if (v <= p80) out = midSpan > 0 ? lowKnot + ((v - p20) / midSpan) * band : 0.5;
    else out = p80 < 1 ? highKnot + ((v - p80) / (1 - p80)) * (1 - highKnot) : highKnot;
    values[n] = out;
  }
}

/** Outcome of a slope relaxation pass. */
export interface RelaxReport {
  /** Chamfer sweep pairs performed (forward + backward) until nothing changed, capped. */
  iterations: number;
  /** True when every unflagged pair respects the TRUE limit at the end. */
  converged: boolean;
  /** max(|dh| - limit) over unflagged pairs after the pass, m (<= 0 when converged). */
  residual: number;
  /** Unflagged nodes whose height moved by more than the slack (axisLimit * slack), i.e. were repaired. */
  corrections: number;
}

/**
 * The slope-limit rule, enforced exactly with Lipschitz envelopes.
 *
 * Let L(a, b) = limit * (1 - slack) * w(a, b), where w = 1 for axis pairs and sqrt2 for
 * diagonal pairs (axisLimit = cell * tan(maxSlope), diagLimit = sqrt2 * axisLimit). Over
 * the graph of UNFLAGGED nodes and their 8-neighbour edges:
 *   lower envelope  lo(p) = min_q [ h(q) + dist_L(p, q) ]   shaves every peak (sign -1)
 *   upper envelope  up(p) = max_q [ h(q) - dist_L(p, q) ]   fills every pit   (sign +1)
 * Each is the closest function to h, from below / above, that satisfies |dh| <= L on every
 * edge. Their mean (lo + up) / 2 satisfies it too (a mean of two L-Lipschitz functions is
 * L-Lipschitz) and treats raising and digging symmetrically. A field that already obeys
 * the rule is returned unchanged (lo = up = h).
 *
 * Both envelopes are computed by repeated chamfer sweeps (forward raster with the W, NW,
 * N, NE neighbours, then backward with E, SE, S, SW) until a sweep pair changes nothing,
 * or `maxIterations` sweep pairs. Flagged nodes (hole, cliff, ramp) neither relay nor
 * receive a constraint and keep their height: that is what lets a deliberate feature break
 * the rule. `iterations` counts sweep pairs; one pair suffices on an obstacle-free grid.
 */
export function relaxSlopes(
  h: Float64Array, mask: Uint8Array, cols: number, rows: number,
  axisLimit: number, diagLimit: number, maxIterations: number, slack: number,
): RelaxReport {
  const axis = axisLimit * (1 - slack), diag = diagLimit * (1 - slack);
  const lo = Float64Array.from(h), up = Float64Array.from(h);
  let iterations = 0;
  for (let it = 0; it < maxIterations; it++) {
    iterations++;
    const changed = chamferSweep(lo, up, mask, cols, rows, axis, diag, true) + chamferSweep(lo, up, mask, cols, rows, axis, diag, false);
    if (changed === 0) break;
  }
  let corrections = 0;
  const moved = axisLimit * slack; // a node counts as corrected when it moved by more than the slack
  for (let n = 0; n < h.length; n++) {
    if (mask[n] !== 0) continue;
    const next = (lo[n] + up[n]) * 0.5;
    if (Math.abs(next - h[n]) > moved) corrections++;
    h[n] = next;
  }
  const residual = maxSlopeExcess(h, mask, cols, rows, axisLimit, diagLimit, "unflagged");
  return { iterations, converged: residual <= 0, residual, corrections };
}

/** Backward-neighbour offsets for the forward raster sweep: W, NW, N, NE (mirrored for the backward sweep). */
const SWEEP_DI = [-1, -1, 0, 1];
const SWEEP_DJ = [0, -1, -1, -1];

/** One chamfer sweep of both envelopes; returns how many values tightened. */
function chamferSweep(
  lo: Float64Array, up: Float64Array, mask: Uint8Array, cols: number, rows: number,
  axis: number, diag: number, forward: boolean,
): number {
  const s = forward ? 1 : -1;
  let changed = 0;
  for (let jj = 0; jj < rows; jj++) {
    const j = forward ? jj : rows - 1 - jj;
    for (let ii = 0; ii < cols; ii++) {
      const i = forward ? ii : cols - 1 - ii;
      const a = j * cols + i;
      if (mask[a] !== 0) continue;
      for (let k = 0; k < 4; k++) {
        const ni = i + s * SWEEP_DI[k], nj = j + s * SWEEP_DJ[k];
        if (ni < 0 || ni >= cols || nj < 0 || nj >= rows) continue;
        const b = nj * cols + ni;
        if (mask[b] !== 0) continue;
        const w = k === 0 || k === 2 ? axis : diag;
        const loCap = lo[b] + w;
        if (loCap < lo[a] - 1e-12) { lo[a] = loCap; changed++; }
        const upFloor = up[b] - w;
        if (upFloor > up[a] + 1e-12) { up[a] = upFloor; changed++; }
      }
    }
  }
  return changed;
}

/** Which pairs a slope query looks at: both nodes unflagged, or at least one flagged. */
export type PairFilter = "unflagged" | "flagged";

/** max(|dh| - limit) over the selected 8-neighbour pairs, m. -Infinity when no pair matches. */
export function maxSlopeExcess(
  h: ArrayLike<number>, mask: Uint8Array, cols: number, rows: number,
  axisLimit: number, diagLimit: number, filter: PairFilter,
): number {
  let worst = -Infinity;
  forEachPair(h, mask, cols, rows, filter, (dh, diagonal) => {
    const e = Math.abs(dh) - (diagonal ? diagLimit : axisLimit);
    if (e > worst) worst = e;
  });
  return worst;
}

/**
 * Slopes |dh| / distance of the selected pairs, as a Float64Array (for summarize()).
 * `cell` is the node spacing in metres.
 */
export function slopePairs(h: ArrayLike<number>, mask: Uint8Array, cols: number, rows: number, cell: number, filter: PairFilter): Float64Array {
  const out: number[] = [];
  const diag = cell * Math.SQRT2;
  forEachPair(h, mask, cols, rows, filter, (dh, diagonal) => out.push(Math.abs(dh) / (diagonal ? diag : cell)));
  return Float64Array.from(out);
}

/** Visit every 8-neighbour pair once (forward neighbours), filtered by flag state. */
function forEachPair(
  h: ArrayLike<number>, mask: Uint8Array, cols: number, rows: number, filter: PairFilter,
  visit: (dh: number, diagonal: boolean) => void,
): void {
  const wantFlagged = filter === "flagged";
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * cols + i;
      for (let k = 0; k < 4; k++) {
        const ni = i + FORWARD_DI[k], nj = j + FORWARD_DJ[k];
        if (ni < 0 || ni >= cols || nj >= rows) continue;
        const b = nj * cols + ni;
        const flagged = mask[a] !== 0 || mask[b] !== 0;
        if (flagged !== wantFlagged) continue;
        visit(h[b] - h[a], k >= 2);
      }
    }
  }
}
