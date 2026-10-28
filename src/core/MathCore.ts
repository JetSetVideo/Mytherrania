// MathCore: the shared numeric vocabulary of the game.
//
// Every smoothing, blending, normalising and distribution question in the codebase
// goes through these functions, so a behaviour has ONE definition and one test.
// Pure module: no Three.js, no DOM, no allocation in the per-frame helpers.
//
// Vocabulary (used the same way everywhere):
//   t        a normalised parameter in [0, 1] (0 = start, 1 = end).
//   lambda   a convergence rate in 1/s: after 1/lambda seconds a damped value has
//            closed ~63% of its gap, after 3/lambda ~95%. Frame-rate independent.
//   halfLife seconds for a damped value to close half its gap: lambda = ln2 / halfLife.
//   spread   max - min of a sample.
//   share    fraction of a total held by a subset (the Pareto "top 20% hold 80%").

/** Clamp `v` into [lo, hi]. A NaN input returns `lo`, so a bad value cannot propagate. */
export function clamp(v: number, lo: number, hi: number): number {
  if (!(v >= lo)) return lo; // also catches NaN
  return v > hi ? hi : v;
}

/** Clamp into [0, 1]. */
export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/** Linear interpolation: a at t=0, b at t=1. `t` is NOT clamped (extrapolates). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse of lerp: where `v` sits between a and b, as t (unclamped). Returns 0 when a == b. */
export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

/** Map `v` from [inLo, inHi] onto [outLo, outHi], clamped to the output range. */
export function remap(v: number, inLo: number, inHi: number, outLo: number, outHi: number): number {
  return lerp(outLo, outHi, clamp01(invLerp(inLo, inHi, v)));
}

/** Hermite smoothstep: 0 below e0, 1 above e1, C1-continuous S-curve between. */
export function smoothstep(e0: number, e1: number, v: number): number {
  const t = clamp01(invLerp(e0, e1, v));
  return t * t * (3 - 2 * t);
}

/** Perlin's smootherstep: like smoothstep but C2 (zero acceleration at both ends). */
export function smootherstep(e0: number, e1: number, v: number): number {
  const t = clamp01(invLerp(e0, e1, v));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Cubic ease-in-out on t in [0, 1]. */
export function easeInOutCubic(t: number): number {
  const u = clamp01(t);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

/**
 * Frame-rate-independent exponential smoothing toward `target`.
 *   next = lerp(current, target, 1 - e^(-lambda * dt))
 * Two half-frames give exactly the same result as one whole frame, which a naive
 * `lerp(current, target, 0.1)` per frame does not (it runs faster on a 120 Hz screen).
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-Math.max(0, lambda) * Math.max(0, dt)));
}

/** Convergence rate (1/s) whose damped value closes half its gap in `halfLife` seconds. */
export function lambdaFromHalfLife(halfLife: number): number {
  return Math.LN2 / Math.max(1e-6, halfLife);
}

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t <= 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/** Interpolate angles along the SHORTEST arc (never spins the long way round). */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/** `damp` for angles: shortest arc, frame-rate independent. */
export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  return lerpAngle(current, target, 1 - Math.exp(-Math.max(0, lambda) * Math.max(0, dt)));
}

/** State of a critically damped spring: position and velocity. Mutated in place. */
export interface Spring {
  value: number;
  velocity: number;
}

/**
 * Advance a critically damped spring toward `target` (Game Programming Gems 4,
 * "Critically Damped Ease-In/Ease-Out Smoothing"). `smoothTime` is roughly the time
 * to reach the target; the spring never overshoots and starts/stops with zero
 * acceleration, so it is the right tool for camera follow and pose blending where
 * `damp` would start with a jerk. Mutates and returns `s`.
 */
export function springStep(s: Spring, target: number, smoothTime: number, dt: number): Spring {
  const omega = 2 / Math.max(1e-4, smoothTime);
  const x = omega * Math.max(0, dt);
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = s.value - target;
  const temp = (s.velocity + omega * change) * dt;
  s.velocity = (s.velocity - omega * temp) * decay;
  s.value = target + (change + temp) * decay;
  return s;
}

/** Descriptive statistics of a sample. Every field is finite for a non-empty sample. */
export interface Summary {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  /** 20th and 80th percentiles: the Pareto cut points. */
  p20: number;
  p80: number;
  /** Population standard deviation. */
  stdev: number;
  /** max - min. */
  spread: number;
}

/** Linear-interpolated quantile `q` in [0,1] of an ASCENDING-sorted array. */
export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const pos = clamp01(q) * (n - 1);
  const lo = Math.floor(pos), hi = Math.min(n - 1, lo + 1);
  return lerp(sorted[lo], sorted[hi], pos - lo);
}

/** Summarise a sample: min, max, mean, median, p20, p80, stdev, spread. Throws on empty input. */
export function summarize(values: ArrayLike<number>): Summary {
  const n = values.length;
  if (n === 0) throw new Error("summarize: empty sample");
  const sorted = Float64Array.from(values).sort();
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i];
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += (sorted[i] - mean) ** 2;
  const min = sorted[0], max = sorted[n - 1];
  return {
    count: n, min, max, mean,
    median: quantileSorted(sorted, 0.5),
    p20: quantileSorted(sorted, 0.2),
    p80: quantileSorted(sorted, 0.8),
    stdev: Math.sqrt(sq / n),
    spread: max - min,
  };
}

/** Rescale a sample in place onto [0, 1] by its own min and max. A flat sample becomes all 0. */
export function normalizeMinMax(values: Float32Array | Float64Array | number[]): void {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < values.length; i++) { lo = Math.min(lo, values[i]); hi = Math.max(hi, values[i]); }
  const span = hi - lo;
  for (let i = 0; i < values.length; i++) values[i] = span > 0 ? (values[i] - lo) / span : 0;
}

/**
 * Pareto shape giving the 80/20 rule: with alpha = log(5)/log(4) ~= 1.161, the top
 * 20% of a Pareto-distributed population holds 80% of its total.
 */
export const PARETO_80_20_ALPHA = Math.log(5) / Math.log(4);

/**
 * Draw from a Pareto(xm, alpha) distribution by inverse transform: xm / U^(1/alpha).
 * `cap` truncates the heavy tail (a single draw can otherwise be arbitrarily large).
 */
export function paretoSample(rng: () => number, xm: number, alpha = PARETO_80_20_ALPHA, cap = Infinity): number {
  const u = Math.max(1e-12, 1 - rng()); // (0, 1]
  return Math.min(cap, xm / Math.pow(u, 1 / alpha));
}

/** Share of the total held by the largest `topFraction` of the sample (0.2 -> "top 20%"). */
export function topShare(values: ArrayLike<number>, topFraction = 0.2): number {
  const sorted = Float64Array.from(values).sort().reverse();
  const k = Math.max(1, Math.round(sorted.length * clamp01(topFraction)));
  let top = 0, all = 0;
  for (let i = 0; i < sorted.length; i++) { all += sorted[i]; if (i < k) top += sorted[i]; }
  return all > 0 ? top / all : 0;
}

/** Mulberry32: a small, fast, seedable PRNG in [0, 1). Same seed -> same sequence. */
export function rng32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
