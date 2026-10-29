// Spread: the two kinds of "spreading" a procedural material needs (BRIEF G07).
//   VALUE spread   a noise sample is usually bunched (fbm ~ N(0.5, 0.12): p20..p80 = 0.40..0.60,
//                  which reads as muddy grey). spreadTo stretches it so its p20 and p80 land on a
//                  stated target, or equalises it through its own CDF (uniform histogram).
//   SPATIAL spread points laid out as blue noise: Bridson Poisson-disc sampling (every pair at
//                  least minDist apart, no gaps wider than ~2 minDist), and a scatter of discs
//                  whose radii follow the Pareto 80/20 law and which never overlap.
// Pure module: no Three.js, no DOM. Seeded: the caller passes an rng (rng32(seed)).
//
// Vocabulary:
//   spread   here p80 - p20 (the central 60% of the sample), the number a target is stated in.
//            (MathCore.Summary.spread is max - min; SpreadStats reports both.)
//   wrap     toroidal domain: x = width is x = 0, so a scatter tiles like a texture does.

import { clamp, clamp01, lerp, PARETO_80_20_ALPHA, paretoSample, summarize } from "../../core/MathCore.ts";
import { compileNoise, type NoiseExpr } from "./NoiseAlgebra.ts";

/** Summary of a sample with spread = p80 - p20 (and range = max - min). */
export interface SpreadStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p20: number;
  p80: number;
  /** p80 - p20. */
  spread: number;
  /** max - min. */
  range: number;
}

/** Measure a sample: min, max, mean, median, p20, p80, spread = p80 - p20. Throws on empty. */
export function measureSpread(samples: ArrayLike<number>): SpreadStats {
  const s = summarize(samples);
  return {
    count: s.count, min: s.min, max: s.max, mean: s.mean, median: s.median,
    p20: s.p20, p80: s.p80, spread: s.p80 - s.p20, range: s.max - s.min,
  };
}

/** Where a sample should land: its p20/p80 quantiles, or its min/max. */
export type SpreadTarget = { p20: number; p80: number } | { lo: number; hi: number };

export interface SpreadOptions {
  /** Histogram equalisation through the sample's own CDF before landing on the target. */
  equalize?: boolean;
  /** Output clamp (default [0, 1]). */
  clampLo?: number;
  clampHi?: number;
}

type Samples = Float32Array | Float64Array | number[];

/**
 * Spread a sample IN PLACE onto `target` and return it.
 *   {p20, p80}: linear map v' = t20 + (v - s20) (t80 - t20) / (s80 - s20) (sample quantiles s),
 *               so the result's p20/p80 equal the target exactly (clamping never moves them
 *               when the targets lie inside the clamp range).
 *   {lo, hi}:   min/max stretch v' = lo + (v - min) (hi - lo) / (max - min).
 *   equalize:   v -> u = rank / (n - 1) (ties share their mean rank), a uniform [0, 1] sample
 *               whose p20 = 0.2 and p80 = 0.8; then mapped linearly onto the target.
 * A degenerate sample (s80 == s20, e.g. a sparse binary mask) falls back to the min/max
 * stretch onto the clamp range; a constant sample becomes the target midpoint.
 */
export function spreadTo<T extends Samples>(values: T, target: SpreadTarget, opts: SpreadOptions = {}): T {
  const n = values.length;
  if (n === 0) return values;
  const lo = opts.clampLo ?? 0, hi = opts.clampHi ?? 1;
  const isQ = "p20" in target;
  const t0 = isQ ? target.p20 : target.lo, t1 = isQ ? target.p80 : target.hi;
  if (opts.equalize) {
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    idx.sort((a, b) => values[a] - values[b]);
    const u = new Float64Array(n);
    for (let i = 0; i < n;) {
      let j = i;
      while (j + 1 < n && values[idx[j + 1]] === values[idx[i]]) j++;
      const rank = n > 1 ? ((i + j) / 2) / (n - 1) : 0.5;
      for (let k = i; k <= j; k++) u[idx[k]] = rank;
      i = j + 1;
    }
    // Uniform u: p20 = 0.2, p80 = 0.8, min 0, max 1.
    const u0 = isQ ? 0.2 : 0, u1 = isQ ? 0.8 : 1;
    for (let i = 0; i < n; i++) values[i] = clamp(t0 + (u[i] - u0) * (t1 - t0) / (u1 - u0), lo, hi);
    return values;
  }
  const s = measureSpread(values);
  let s0 = isQ ? s.p20 : s.min, s1 = isQ ? s.p80 : s.max;
  let o0 = t0, o1 = t1;
  if (s1 - s0 < 1e-9) {
    if (s.range < 1e-9) {
      for (let i = 0; i < n; i++) values[i] = clamp((t0 + t1) / 2, lo, hi);
      return values;
    }
    s0 = s.min; s1 = s.max; o0 = lo; o1 = hi;
  }
  const k = (o1 - o0) / (s1 - s0);
  for (let i = 0; i < n; i++) values[i] = clamp(o0 + (values[i] - s0) * k, lo, hi);
  return values;
}

// ---------------------------------------------------------------------------------------
// Spatial spread.

export interface Point2 { x: number; y: number }

export interface PoissonOptions {
  /** Toroidal domain (tileable): distances wrap around both edges. */
  wrap?: boolean;
  /** Candidates tried around an active point before it retires (Bridson's k, default 30). */
  maxTries?: number;
}

/**
 * Bridson (2007) Poisson-disc sampling in [0, width) x [0, height): every pair of points is at
 * least `minDist` apart (toroidally when wrap), and the set is maximal up to the k-try limit.
 * Background grid: cell = side / ceil(side / (minDist / sqrt 2)), so a cell holds at most one
 * point and divides the side exactly (needed for the toroidal neighbour lookup).
 * Deterministic for a given rng.
 */
export function poissonDisc(
  rng: () => number, width: number, height: number, minDist: number, opts: PoissonOptions = {},
): Point2[] {
  const wrap = opts.wrap ?? false, tries = Math.max(1, Math.floor(opts.maxTries ?? 30));
  const r = minDist, r2 = r * r;
  const cols = Math.max(1, Math.ceil(width / (r / Math.SQRT2))), rows = Math.max(1, Math.ceil(height / (r / Math.SQRT2)));
  const cw = width / cols, ch = height / rows;
  const spanX = Math.ceil(r / cw), spanY = Math.ceil(r / ch);
  const grid = new Int32Array(cols * rows).fill(-1);
  const pts: Point2[] = [];
  const active: number[] = [];

  const far = (x: number, y: number): boolean => {
    const gx = Math.min(cols - 1, Math.floor(x / cw)), gy = Math.min(rows - 1, Math.floor(y / ch));
    for (let j = -spanY; j <= spanY; j++) {
      let yy = gy + j;
      if (wrap) yy = ((yy % rows) + rows) % rows; else if (yy < 0 || yy >= rows) continue;
      for (let i = -spanX; i <= spanX; i++) {
        let xx = gx + i;
        if (wrap) xx = ((xx % cols) + cols) % cols; else if (xx < 0 || xx >= cols) continue;
        const k = grid[yy * cols + xx];
        if (k < 0) continue;
        let dx = Math.abs(pts[k].x - x), dy = Math.abs(pts[k].y - y);
        if (wrap) { dx = Math.min(dx, width - dx); dy = Math.min(dy, height - dy); }
        if (dx * dx + dy * dy < r2) return false;
      }
    }
    return true;
  };
  const add = (x: number, y: number) => {
    const gx = Math.min(cols - 1, Math.floor(x / cw)), gy = Math.min(rows - 1, Math.floor(y / ch));
    grid[gy * cols + gx] = pts.length;
    active.push(pts.length);
    pts.push({ x, y });
  };

  add(rng() * width, rng() * height);
  while (active.length > 0) {
    const ai = Math.floor(rng() * active.length);
    const p = pts[active[ai]];
    let placed = false;
    for (let t = 0; t < tries; t++) {
      // Uniform by area in the annulus [r, 2r]: radius = r sqrt(1 + 3u).
      const ang = rng() * 2 * Math.PI, rad = r * Math.sqrt(1 + 3 * rng());
      let x = p.x + Math.cos(ang) * rad, y = p.y + Math.sin(ang) * rad;
      if (wrap) { x = ((x % width) + width) % width; y = ((y % height) + height) % height; }
      else if (x < 0 || x >= width || y < 0 || y >= height) continue;
      if (far(x, y)) { add(x, y); placed = true; break; }
    }
    if (!placed) { active[ai] = active[active.length - 1]; active.pop(); }
  }
  return pts;
}

/**
 * `count` Pareto sizes: paretoSample(rng, sizeMin, alpha, sizeMax). Uncapped with
 * alpha = PARETO_80_20_ALPHA the largest 20% hold 80% of the total; a cap lowers that share
 * (clipping at 100 sizeMin gives ~0.66 analytically).
 */
export function paretoSizes(
  rng: () => number, count: number, sizeMin: number, sizeMax = Infinity, alpha = PARETO_80_20_ALPHA,
): Float64Array {
  const out = new Float64Array(Math.max(0, Math.floor(count)));
  for (let i = 0; i < out.length; i++) out[i] = paretoSample(rng, sizeMin, alpha, sizeMax);
  return out;
}

/**
 * Expected share of the total held by the largest `top` fraction of Y = min(X, C), X ~ Pareto(1, alpha),
 * C = capRatio = sizeMax / sizeMin. With t = top^(-1/alpha) (the uncapped top-fraction threshold):
 *   E[Y]        = I(1, C) + C^(1 - alpha),   I(a, b) = alpha/(alpha-1) (a^(1-alpha) - b^(1-alpha))
 *   E[Y; X > t] = I(t, C) + C^(1 - alpha)    (t < C; else the top fraction is all C: top C / E[Y])
 * (alpha = 1 uses the limit I(a, b) = ln(b / a)). Uncapped (C = Infinity) and alpha = PARETO_80_20_ALPHA
 * this is exactly 0.8; capping at 100 lowers it to ~0.66.
 */
export function cappedParetoTopShare(alpha: number, capRatio: number, top = 0.2): number {
  const a = alpha, C = Math.max(1, capRatio);
  const I = (lo: number, hi: number) => Math.abs(a - 1) < 1e-9
    ? Math.log(hi / lo)
    : a / (a - 1) * (Math.pow(lo, 1 - a) - (Number.isFinite(hi) ? Math.pow(hi, 1 - a) : 0));
  const tail = Number.isFinite(C) ? Math.pow(C, 1 - a) : 0;
  const mean = I(1, C) + tail;
  const t = Math.pow(clamp01(top), -1 / a);
  if (t >= C) return clamp01(top * C / mean);
  return (I(t, C) + tail) / mean;
}

/**
 * The Pareto shape whose CAPPED sizes keep a top-share law (default 80/20). The capped share is
 * NOT monotone in alpha: alpha -> 0 piles every draw on the cap and alpha -> infinity on the floor,
 * both share = top. So: golden-section search for the alpha of peak share on [0.05, 8], then
 * bisect the falling branch [peak, 8] for `share`. If even the peak is below `share` (a cap too
 * tight for the law, e.g. radii capped at 20x: peak ~0.62) the peak alpha is returned; check with
 * cappedParetoTopShare. Uncapped this returns PARETO_80_20_ALPHA.
 */
export function alphaForTopShare(capRatio: number, share = 0.8, top = 0.2): number {
  const f = (a: number) => cappedParetoTopShare(a, capRatio, top);
  let a = 0.05, b = 8;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 100; i++) {
    const c = b - g * (b - a), d = a + g * (b - a);
    if (f(c) > f(d)) b = d; else a = c;
  }
  const peak = (a + b) / 2;
  if (f(peak) <= share) return peak;
  let lo = peak, hi = 8;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > share) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface ScatterPoint { x: number; y: number; r: number }

export interface ScatterOptions {
  /** Smallest radius (the Pareto xm). */
  sizeMin: number;
  /** Radius cap. */
  sizeMax: number;
  /** 0 = even blue-noise scatter, 1 = items only where the density noise is high. */
  cluster?: number;
  /**
   * Density field sampled at (x, 0, y); should span 0..1. Default: smoothstep(0.35, 0.65) of a
   * 3-octave gradient fbm with feature size width / 4 (fbm alone only spans ~0.3..0.7).
   */
  density?: NoiseExpr;
  /** Extra clearance between disc edges (default 0). */
  gap?: number;
  /** Toroidal placement (tileable). */
  wrap?: boolean;
  /** Placement attempts per item before it is dropped (default 60). */
  maxTries?: number;
  /**
   * Pareto shape of the RADII (default PARETO_80_20_ALPHA). Capping at sizeMax lowers the top share
   * (cappedParetoTopShare); for disc AREAS to keep 80/20 use 2 * alphaForTopShare((sizeMax/sizeMin)^2),
   * since area = r^2 is Pareto with alpha / 2.
   */
  alpha?: number;
}

/**
 * Scatter up to `count` non-overlapping discs in an area. Radii ~ Pareto(sizeMin, alpha) capped at
 * sizeMax, placed largest first by dart throwing; a dart at p is kept with probability
 *   1 - cluster * (1 - saturate(density(p)))
 * so cluster = 0 spreads evenly and cluster = 1 confines items to the dense patches.
 * Invariant: for every pair, distance >= r_i + r_j + gap (toroidal when wrap). Items that find
 * no room in maxTries darts are dropped (the result may hold fewer than `count`).
 */
export function scatter(
  rng: () => number, area: { width: number; height: number }, count: number, opts: ScatterOptions,
): ScatterPoint[] {
  const { width, height } = area;
  const wrap = opts.wrap ?? false, gap = Math.max(0, opts.gap ?? 0);
  const cluster = clamp01(opts.cluster ?? 0), tries = Math.max(1, Math.floor(opts.maxTries ?? 60));
  const radii = paretoSizes(rng, count, opts.sizeMin, opts.sizeMax, opts.alpha ?? PARETO_80_20_ALPHA);
  radii.sort().reverse();
  const densityExpr: NoiseExpr = opts.density ??
    { op: "smoothstep", e0: 0.35, e1: 0.65, a: { op: "fbm", base: "gradient", octaves: 3, scale: width / 4 } };
  const densitySeed = Math.floor(rng() * 4294967296);
  const density = compileNoise(densityExpr, densitySeed, wrap ? { period: [width, 0, height] } : {});
  // Grid cell >= the largest possible contact distance, so neighbours are within +-1 cell.
  const reach = 2 * (radii.length > 0 ? radii[0] : opts.sizeMin) + gap;
  const cols = Math.max(1, Math.floor(width / reach)), rows = Math.max(1, Math.floor(height / reach));
  const cw = width / cols, ch = height / rows;
  const buckets: number[][] = Array.from({ length: cols * rows }, () => []);
  const out: ScatterPoint[] = [];
  const sx = cols === 1 ? 0 : 1, sy = rows === 1 ? 0 : 1;

  const fits = (x: number, y: number, r: number): boolean => {
    const gx = Math.min(cols - 1, Math.floor(x / cw)), gy = Math.min(rows - 1, Math.floor(y / ch));
    for (let j = -sy; j <= sy; j++) {
      let yy = gy + j;
      if (wrap) yy = ((yy % rows) + rows) % rows; else if (yy < 0 || yy >= rows) continue;
      for (let i = -sx; i <= sx; i++) {
        let xx = gx + i;
        if (wrap) xx = ((xx % cols) + cols) % cols; else if (xx < 0 || xx >= cols) continue;
        // With 2 rows/cols, -1 and +1 wrap to the same bucket: check it once.
        if (wrap && ((j === 1 && rows === 2) || (i === 1 && cols === 2))) continue;
        for (const k of buckets[yy * cols + xx]) {
          const q = out[k];
          let dx = Math.abs(q.x - x), dy = Math.abs(q.y - y);
          if (wrap) { dx = Math.min(dx, width - dx); dy = Math.min(dy, height - dy); }
          const need = q.r + r + gap;
          if (dx * dx + dy * dy < need * need) return false;
        }
      }
    }
    return true;
  };

  for (let n = 0; n < radii.length; n++) {
    const r = radii[n];
    if (!wrap && (width < 2 * r || height < 2 * r)) continue;
    for (let t = 0; t < tries; t++) {
      // Without wrap the whole disc stays inside the area.
      const x = wrap ? rng() * width : lerp(r, width - r, rng());
      const y = wrap ? rng() * height : lerp(r, height - r, rng());
      if (cluster > 0) {
        const keep = 1 - cluster * (1 - clamp01(density(x, 0, y)));
        if (rng() >= keep) continue;
      }
      if (!fits(x, y, r)) continue;
      const gx = Math.min(cols - 1, Math.floor(x / cw)), gy = Math.min(rows - 1, Math.floor(y / ch));
      buckets[gy * cols + gx].push(out.length);
      out.push({ x, y, r });
      break;
    }
  }
  return out;
}
