// CorpusMath: the bounded data-science pass over the match corpus (Wave H, lane H-F).
//
// The spoken brief asked to "compress [the history] at the end to ... the most important
// variables ... spread them out with data science ... calculating the distances", inside a
// bounded runtime ("within the maximum"). This module is that compression: six key
// variables per match, z-score standardisation, distance metrics, descriptive spread,
// outlier flags (plain and robust), PCA and nearest-neighbour placement.
//
// Memory discipline (why the shapes below are the way they are): the corpus is streamed.
// Every entry point takes a plain array and reduces it in ONE pass — nothing builds an
// N x N matrix (5 000 records would be 25 000 000 cells). PCA is O(N * D^2) with D = 6,
// and keyVars/standardise/spread/flag are all O(N).
//
// NaN poisoning is dropped at the SOURCE (see artifacts/data-science.md, pass 20): keyVars
// coerces every output to a finite number, so no consumer downstream can ever see NaN.
//
// Pure module: no Three.js, no DOM, no Math.random (callers seed). Reuses MathCore for the
// distribution maths (summarize -> quantile) rather than writing a fourth copy of them.

import { summarize } from "../core/MathCore.ts";
import { CLASSES, createStats } from "../game/Stats.ts";

/** The six variables a match is compressed to. Order is fixed: it is the PCA axis order. */
export const KEY_VARS = [
  "duration",
  "gapDistance",
  "dominance",
  "damageShare",
  "pace",
  "spread",
] as const;
export type KeyVarName = typeof KEY_VARS[number];

/** One match, compressed to its most informative variables. Every field is finite. */
export interface KeyVars {
  duration: number; // hostile seconds the fight lasted
  gapDistance: number; // how far apart the two builds were (pooled-sd units)
  dominance: number; // 0 = coin flip, 1 = rout
  damageShare: number; // 0 = even damage, 1 = one-sided
  pace: number; // landed strikes per second (both sides)
  spread: number; // scale-free difference of the two builds' total primaries
}

/** A standardised row: every key variable expressed as a z-score against the corpus. */
export type StandardRow = Record<keyof KeyVars, number>;

// ---------------------------------------------------------------------------
// Structural input (why: lane H-D is extending MatchHistory.ts in parallel with statGap,
// generation, limitS and tie, and the parent wires those later). We do NOT import
// MatchHistory's types — a plain structural interface compiles whether or not H-D lands,
// and the real MatchRecord satisfies it. Only the fields keyVars actually reads are named.
// ---------------------------------------------------------------------------

/** The six primary attributes a build is described by. */
export interface MatchStatsLike {
  vitality: number;
  resilience: number;
  willpower: number;
  reflex: number;
  strength: number;
  intelligence: number;
}

export interface MatchFighterLike {
  level?: number;
  stats: MatchStatsLike;
  dealt?: number; // damage dealt
  hits?: number; // landed hits
  hpLeft?: number;
}

/** Everything keyVars needs from a match; the real MatchRecord satisfies this shape. */
export interface MatchLike {
  duration: number;
  reason: string;
  winner: 0 | 1 | null;
  fighters: MatchFighterLike[];
  /** The stat gap lane H-D records (optional so this compiles before H-D lands). */
  statGap?: { distance?: number; damageShare?: number; dominance?: number };
  /** The generation block lane H-D records (unused here, named for shape compatibility). */
  generation?: { id?: string };
}

const SIX = ["vitality", "resilience", "willpower", "reflex", "strength", "intelligence"] as const;
type SixStat = typeof SIX[number];

/** A finite number or the fallback. The single place NaN/Infinity is stopped at the source. */
function fin(v: number | undefined, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Per-stat reference standard deviation, taken from the class roster itself (population sd
 * of each primary across the eight classes). It is the scale the game's own builds actually
 * span, which is what makes a raw stat difference comparable across stats. Computed once at
 * module load so a fallback distance never guesses a hand-typed constant.
 */
const REF_SD: Record<SixStat, number> = (() => {
  const out = {} as Record<SixStat, number>;
  for (const k of SIX) {
    const vals = CLASSES.map((c) => createStats(c)[k]);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
    out[k] = sd > 1e-9 ? sd : 1; // a stat the roster does not vary cannot scale a distance
  }
  return out;
})();

/** Pooled-sd Euclidean distance between two builds' six primaries (the H-D `z` length,
 *  recomputed here when a record predates the statGap block). */
function statDistance(a: MatchFighterLike | undefined, b: MatchFighterLike | undefined): number {
  if (!a || !b) return 0;
  let sq = 0;
  for (const k of SIX) {
    const dz = (fin(a.stats[k]) - fin(b.stats[k])) / REF_SD[k];
    sq += dz * dz;
  }
  return Math.sqrt(sq);
}

/** Scale-free gap between two builds: |sumA - sumB| / mean(sum), so a bigger overall build
 *  reads as a larger spread whatever the absolute stat numbers are. */
function primarySpread(a: MatchFighterLike | undefined, b: MatchFighterLike | undefined): number {
  if (!a || !b) return 0;
  let sa = 0, sb = 0;
  for (const k of SIX) {
    sa += fin(a.stats[k]);
    sb += fin(b.stats[k]);
  }
  const mean = (sa + sb) / 2;
  return mean > 0 ? Math.abs(sa - sb) / mean : 0;
}

/**
 * Compress one match to its KeyVars. Prefers the statGap lane H-D records; when it is
 * absent (an old record, or H-D has not landed) the same quantities are recomputed from
 * the fighters, so this works on the current MatchRecord unchanged. Never returns NaN.
 */
export function keyVars(rec: MatchLike): KeyVars {
  const a = rec.fighters?.[0], b = rec.fighters?.[1];
  const dealtA = fin(a?.dealt), dealtB = fin(b?.dealt);
  const hitsA = fin(a?.hits), hitsB = fin(b?.hits);
  const duration = Math.max(0, fin(rec.duration));
  const totalDealt = Math.max(1, dealtA + dealtB);

  const gapDistance = rec.statGap?.distance ?? statDistance(a, b);
  const damageShare = rec.statGap?.damageShare ?? Math.abs(dealtA - dealtB) / totalDealt;
  // Dominance when unwritten: the winner's damage lead, 0 on a draw (0 = coin flip).
  const winnerDealt = rec.winner === 0 ? dealtA : rec.winner === 1 ? dealtB : 0;
  const dominance = rec.statGap?.dominance ?? (rec.winner === null ? 0 : winnerDealt / totalDealt);
  // Pace: landed strikes per second of hostile time. Duration 0 -> 0, never Infinity.
  const pace = duration > 0 ? (hitsA + hitsB) / duration : 0;

  return {
    duration: fin(duration),
    gapDistance: fin(gapDistance),
    dominance: fin(dominance),
    damageShare: fin(damageShare),
    pace: fin(pace),
    spread: fin(primarySpread(a, b)),
  };
}

/** z-score standardisation. A zero-variance column becomes 0 (never divided into NaN). */
export function standardise(rows: KeyVars[]): {
  rows: StandardRow[];
  mean: Record<keyof KeyVars, number>;
  sd: Record<keyof KeyVars, number>;
} {
  const mean = {} as Record<keyof KeyVars, number>;
  const sd = {} as Record<keyof KeyVars, number>;
  const n = rows.length;
  for (const k of KEY_VARS) {
    let sum = 0;
    for (const r of rows) sum += fin(r[k]);
    const m = n > 0 ? sum / n : 0;
    let sq = 0;
    for (const r of rows) sq += (fin(r[k]) - m) ** 2;
    const s = n > 0 ? Math.sqrt(sq / n) : 0;
    mean[k] = fin(m);
    // A column whose spread is below the standardisation threshold IS constant: report sd 0
    // rather than the ~1e-16 floating-point residue of summing squares.
    sd[k] = s > 1e-12 ? fin(s) : 0;
  }
  const out: StandardRow[] = rows.map((r) => {
    const row = {} as StandardRow;
    for (const k of KEY_VARS) {
      const s = sd[k];
      // Zero-variance (or non-finite) -> 0: the column carries no information to standardise.
      row[k] = s > 1e-12 ? (fin(r[k]) - mean[k]) / s : 0;
    }
    return row;
  });
  return { rows: out, mean, sd };
}

/** Euclidean distance over the keys of `a`. Missing keys on `b` count as 0. */
export function euclidean(a: Record<string, number>, b: Record<string, number>): number {
  let sq = 0;
  for (const k of Object.keys(a)) {
    const d = fin(a[k]) - fin(b[k] ?? 0);
    sq += d * d;
  }
  return Math.sqrt(sq);
}

/**
 * Mahalanobis distance with a diagonal covariance: each axis is divided by its own sd, so
 * a wide, uncertain column cannot dominate a narrow, precise one. A column with sd ~ 0 has
 * no scale to normalise by, so it contributes nothing.
 */
export function mahalanobis(
  a: Record<string, number>,
  b: Record<string, number>,
  sd: Record<string, number>,
): number {
  let sq = 0;
  for (const k of Object.keys(a)) {
    const s = fin(sd[k]);
    if (s <= 1e-12) continue;
    const d = (fin(a[k]) - fin(b[k] ?? 0)) / s;
    sq += d * d;
  }
  return Math.sqrt(sq);
}

/** Descriptive spread of every key variable. Reuses MathCore.summarize for the quantiles. */
export function spreadOf(rows: KeyVars[]): Record<keyof KeyVars, {
  n: number;
  min: number;
  p20: number;
  median: number;
  p80: number;
  max: number;
  mean: number;
  sd: number;
}> {
  const out = {} as ReturnType<typeof spreadOf>;
  for (const k of KEY_VARS) {
    if (rows.length === 0) {
      out[k] = { n: 0, min: 0, p20: 0, median: 0, p80: 0, max: 0, mean: 0, sd: 0 };
      continue;
    }
    const s = summarize(rows.map((r) => fin(r[k])));
    out[k] = {
      n: s.count,
      min: s.min,
      p20: s.p20,
      median: s.median,
      p80: s.p80,
      max: s.max,
      mean: s.mean,
      sd: s.stdev,
    };
  }
  return out;
}

/** A flagged match: which corpus index, which variable, and how far out (in its z units). */
export interface Flag {
  index: number;
  key: keyof KeyVars;
  z: number;
}

/** Keep, per index, the single variable whose |z| is largest, sorted most-extreme first. */
function strongestPerIndex(scores: { index: number; key: keyof KeyVars; z: number }[]): Flag[] {
  const best = new Map<number, Flag>();
  for (const s of scores) {
    const prev = best.get(s.index);
    if (!prev || Math.abs(s.z) > Math.abs(prev.z)) best.set(s.index, s);
  }
  return [...best.values()].sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
}

/** The outlier flag: a match far from the corpus centre on ANY key variable (default z = 3). */
export function specialGames(rows: KeyVars[], z = 3): Flag[] {
  if (rows.length === 0) return [];
  const { rows: std } = standardise(rows);
  const hits: Flag[] = [];
  std.forEach((row, index) => {
    for (const k of KEY_VARS) {
      if (Math.abs(row[k]) > z) hits.push({ index, key: k, z: row[k] });
    }
  });
  return strongestPerIndex(hits);
}

/** Per-column median and MAD (median absolute deviation, scaled to sd-units). */
export interface RobustCentre {
  median: Record<keyof KeyVars, number>;
  /** 1.4826 * MAD: the scale that matches a normal sd, so the same z threshold reads alike. */
  scale: Record<keyof KeyVars, number>;
}

export function robustCentre(rows: KeyVars[]): RobustCentre {
  const median = {} as Record<keyof KeyVars, number>;
  const scale = {} as Record<keyof KeyVars, number>;
  for (const k of KEY_VARS) {
    if (rows.length === 0) {
      median[k] = 0;
      scale[k] = 0;
      continue;
    }
    const med = summarize(rows.map((r) => fin(r[k]))).median;
    const dev = summarize(rows.map((r) => Math.abs(fin(r[k]) - med))).median;
    median[k] = fin(med);
    scale[k] = fin(1.4826 * dev);
  }
  return { median, scale };
}

/**
 * The robust outlier flag: the same test as specialGames, but against the median and MAD
 * instead of the mean and sd. A single wild value inflates the plain sd enough to MASK
 * other outliers; the median/MAD do not move, so those outliers stay visible. Both flags
 * are reported by the tool so the difference is on the record.
 */
export function robustGames(rows: KeyVars[], z = 3): Flag[] {
  if (rows.length === 0) return [];
  const { median, scale } = robustCentre(rows);
  const hits: Flag[] = [];
  rows.forEach((r, index) => {
    for (const k of KEY_VARS) {
      const s = scale[k];
      if (s <= 1e-12) continue; // no spread to judge against -> nothing is an outlier here
      const zz = (fin(r[k]) - median[k]) / s;
      if (Math.abs(zz) > z) hits.push({ index, key: k, z: zz });
    }
  });
  return strongestPerIndex(hits);
}

// ---------------------------------------------------------------------------
// PCA by power iteration on the covariance matrix: no dependency, bounded iterations,
// deterministic. The input rows are the STANDARDISED KeyVars, so the covariance matrix is
// the correlation matrix and every axis is already unit-scaled.
// ---------------------------------------------------------------------------

export interface PcaResult {
  /** Fraction of total variance each component explains, most first. Non-negative. */
  ratios: number[];
  /** One loading vector per component, over the KEY_VARS order. */
  loadings: number[][];
  /** Total variance (the covariance trace). Ratios divide by this. */
  trace: number;
}

const PCA_MAX_ITER = 300;
const PCA_EPS = 1e-10;

function matVec(m: number[][], v: number[]): number[] {
  const d = m.length;
  const out = new Array<number>(d).fill(0);
  for (let i = 0; i < d; i++) {
    let s = 0;
    for (let j = 0; j < d; j++) s += m[i][j] * v[j];
    out[i] = s;
  }
  return out;
}

/**
 * PCA over the standardised KeyVars. D = 6, so the covariance is 6x6 and the power
 * iteration is O(D^2) per step — the whole pass stays O(N * D^2). Deterministic: the start
 * vector and the sign convention are fixed, so the same corpus gives the same loadings.
 */
export function pca(rows: StandardRow[], components = KEY_VARS.length): PcaResult {
  const d = KEY_VARS.length;
  const cov: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  const n = Math.max(1, rows.length);
  for (const r of rows) {
    for (let i = 0; i < d; i++) {
      const vi = fin(r[KEY_VARS[i]]);
      for (let j = 0; j < d; j++) cov[i][j] += vi * fin(r[KEY_VARS[j]]);
    }
  }
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) cov[i][j] /= n;
  let trace = 0;
  for (let i = 0; i < d; i++) trace += cov[i][i];
  trace = fin(trace);

  // The working matrix is deflated as each component is extracted, so later iterations
  // find the NEXT eigenvector rather than re-finding the first.
  const work: number[][] = cov.map((row) => row.slice());
  const k = Math.max(1, Math.min(components, d));
  const ratios: number[] = [];
  const loadings: number[][] = [];

  for (let c = 0; c < k; c++) {
    // Deterministic start: a unit vector with its mass on axis c, which never lies exactly
    // in the null space of the leading eigenvector for a positive-semidefinite matrix.
    let v = new Array<number>(d).fill(0);
    v[c % d] = 1;

    for (let iter = 0; iter < PCA_MAX_ITER; iter++) {
      const w = matVec(work, v);
      let norm = 0;
      for (const x of w) norm += x * x;
      norm = Math.sqrt(norm);
      if (norm < PCA_EPS) {
        v = new Array<number>(d).fill(0);
        break;
      }
      let delta = 0;
      for (let i = 0; i < d; i++) {
        const nv = w[i] / norm;
        delta += Math.abs(nv - v[i]);
        v[i] = nv;
      }
      if (delta < PCA_EPS) break;
    }

    // Rayleigh quotient gives the eigenvalue for the (unit) eigenvector.
    const wv = matVec(work, v);
    let lambda = 0;
    for (let i = 0; i < d; i++) lambda += v[i] * wv[i];
    lambda = Math.max(0, fin(lambda));

    // Deterministic sign: make the largest-magnitude loading positive.
    let big = 0;
    for (let i = 1; i < d; i++) if (Math.abs(v[i]) > Math.abs(v[big])) big = i;
    if (v[big] < 0) v = v.map((x) => -x);

    ratios.push(trace > 1e-12 ? lambda / trace : 0);
    loadings.push(v.map((x) => fin(x)));

    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) work[i][j] -= lambda * v[i] * v[j];
  }

  return { ratios, loadings, trace };
}

// ---------------------------------------------------------------------------
// k-nearest-neighbour placement: place one match against the corpus without ever holding
// an N x N matrix — one pass computes the distance to every row, then the k smallest are
// averaged. O(N) memory, O(N * D) time.
// ---------------------------------------------------------------------------

export interface NearestResult {
  /** The k smallest distances, ascending. Index 0 is 0 when the query is in the corpus. */
  distances: number[];
  /** Mean distance to the k nearest neighbours: how typical the query is. */
  meanDistance: number;
  /** The corpus index of the nearest neighbour. */
  nearestIndex: number;
}

export function nearestNeighbours(rows: StandardRow[], query: StandardRow, k = 5): NearestResult {
  const scored = rows.map((r, index) => ({ index, d: euclidean(query, r) }));
  scored.sort((a, b) => a.d - b.d || a.index - b.index);
  const kk = Math.max(1, Math.min(k, scored.length));
  const taken = scored.slice(0, kk);
  const meanDistance = taken.length > 0 ? taken.reduce((s, t) => s + t.d, 0) / taken.length : 0;
  return {
    distances: taken.map((t) => t.d),
    meanDistance: fin(meanDistance),
    nearestIndex: taken.length > 0 ? taken[0].index : -1,
  };
}
