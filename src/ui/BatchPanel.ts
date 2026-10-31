// Wave M (lane M-C): the one-click batch, as a PURE model. The parent renders the "Run batch"
// button on the Spectate/History screen; everything behind it that is not drawing lives here, so it
// unit-tests in Deno with no DOM, no THREE, no worker and no Math.random:
//   batchPlan(size, seed, design) -> the plan: how many matches, one job per match (its own seed),
//                                    and the wall-clock the plan PROMISES (estimatedS);
//   batchProgress(done, total)    -> the bar: fraction, done, total, etaS;
//   batchSummary(records)         -> per-variable min/max/mean/median/sd/p10/p90 for a finished
//                                    batch, built on the repo's describe() from MatchHistory.ts.
//
// The module only PLANS; it never starts a worker or a process, and it never draws — the parent
// runs runBatch(BatchOptions) (src/balance/Batch.ts) with the plan's matches/seed/design.

import { describe } from "../game/MatchHistory.ts";
import type { EndReason, MatchRecord } from "../game/arena/contracts.ts";

/** The sizes the button offers: 10 / 20 / 50 / 100 matches, simulator-only (no graphics). */
export const BATCH_SIZES = [10, 20, 50, 100] as const;
export type BatchSize = typeof BATCH_SIZES[number];

/** True for a value the button may run — one of BATCH_SIZES. */
export function isBatchSize(n: number): n is BatchSize {
  return (BATCH_SIZES as readonly number[]).includes(n);
}

/**
 * Wall-clock cost of ONE headless match, ms. The plan must state the cost it promises, so this is
 * CALIBRATED by measurement, not guessed: on the dev machine (macOS 14.6.1, 2026-10-31) a runBatch
 * of 10 at design "all" / fallback arena (DEFAULT rules, dt = 1/30) took 42 ms cold, then 20 ms and
 * 17 ms warm (1.7–4.2 ms/match; a run of 100 took 465 ms = 4.65 ms/match). The promise uses the
 * warm steady-state figure (2 ms); the lane's estimate against a real runBatch(10) is then reported.
 */
export const PER_MATCH_MS = 2;

/** Integer avalanche (Murmur3 finalizer): sequential job indices must scatter their seeds. */
function mix32(x: number): number {
  let h = (Number.isFinite(x) ? Math.trunc(x) : 0) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h >>> 0;
}

/** One match of the batch: where it sits, the seed it runs with, and the design cell it plays. */
export interface JobPlan {
  /** 0-based position of the match within the batch. */
  index: number;
  /** This single match's seed, derived deterministically from the batch seed. */
  seed: number;
  /** The design cell this match plays in (a Gradient design id). */
  design: string;
}

/** What the button runs and what it promises. */
export interface BatchPlan {
  /** Number of matches (== jobs.length). */
  matches: number;
  /** One entry per match, so the parent can run or stream them one at a time. */
  jobs: JobPlan[];
  /** The wall-clock the plan PROMISES, seconds (matches × PER_MATCH_MS). */
  estimatedS: number;
}

/**
 * The plan for a batch of `size` matches. `seed` is the only source of variation (no Math.random),
 * so the same arguments always yield the same plan. A non-finite/negative `size` yields an empty
 * plan (0 matches) rather than a throw — the button is disabled, not broken.
 */
export function batchPlan(size: number, seed = 0, design = "all"): BatchPlan {
  const matches = Math.max(0, Math.floor(Number.isFinite(size) ? size : 0));
  const s = Number.isFinite(seed) ? Math.trunc(seed) : 0;
  const jobs: JobPlan[] = [];
  for (let i = 0; i < matches; i++) jobs.push({ index: i, seed: mix32(s + i + 1), design });
  return { matches, jobs, estimatedS: (matches * PER_MATCH_MS) / 1000 };
}

/** The bar behind the button while the batch runs. */
export interface BatchProgress {
  /** Completed share, 0..1 (1 once every match is done, or for an empty batch). */
  fraction: number;
  /** Matches finished, clamped to [0, total]. */
  done: number;
  /** Matches planned. */
  total: number;
  /** Seconds still to go at the plan's promise; 0 when finished. */
  etaS: number;
}

/**
 * Progress of a batch: `done` of `total` matches, the completed fraction, and the seconds left.
 * Total over any input — `done` is clamped to [0, total], a `total` of 0 reads as complete (nothing
 * left to run), and a non-finite/negative `estimatedS` reads as 0 so the ETA is never NaN. The
 * default estimate is the plan's own promise (total × PER_MATCH_MS).
 */
export function batchProgress(done: number, total: number, estimatedS = (Math.max(0, total) * PER_MATCH_MS) / 1000): BatchProgress {
  const t = Math.max(0, Math.floor(Number.isFinite(total) ? total : 0));
  const d = Math.min(Math.max(0, Math.floor(Number.isFinite(done) ? done : 0)), t);
  const fraction = t > 0 ? d / t : 1;
  const est = Number.isFinite(estimatedS) && estimatedS > 0 ? estimatedS : 0;
  return { fraction, done: d, total: t, etaS: est * (1 - fraction) };
}

/** min/max/mean/median/sd plus the p10/p90 quantiles of one numeric column. */
export interface VariableStats {
  n: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  sd: number;
  p10: number;
  p90: number;
}

/** One variable the summary reports: its key, its human label, and how to read it off a record. */
export interface BatchVariable {
  key: string;
  label: string;
  of: (r: MatchRecord) => number;
}

/** The variables a finished batch summarises — the numbers the button prints under the bar. */
export const BATCH_VARIABLES: readonly BatchVariable[] = [
  { key: "duration", label: "Match length (s)", of: (r) => r.outcome.duration },
  { key: "damageA", label: "Damage dealt — seat A", of: (r) => r.outcome.damageDealt[0] },
  { key: "damageB", label: "Damage dealt — seat B", of: (r) => r.outcome.damageDealt[1] },
  { key: "hitsA", label: "Hits landed — seat A", of: (r) => r.outcome.hits[0] },
  { key: "hitsB", label: "Hits landed — seat B", of: (r) => r.outcome.hits[1] },
  { key: "hpFracA", label: "Health left — seat A", of: (r) => r.outcome.hpFracLeft[0] },
  { key: "hpFracB", label: "Health left — seat B", of: (r) => r.outcome.hpFracLeft[1] },
];

/**
 * Linear-interpolated quantile of an already-sorted, finite array: the order statistic at
 * q·(n−1). Matches src/balance/Summary.ts's columnStats so p10/p90 read the same across the app.
 */
function quantile(sorted: readonly number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const i = q * (n - 1), lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Stats of one column: describe() for the core six, plus p10/p90 (non-finite values dropped). */
function variableStats(values: readonly number[]): VariableStats {
  const v = values.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
  const d = describe(v); // the repo's describe(): n, mean, median, sd, min, max
  return { ...d, p10: quantile(v, 0.1), p90: quantile(v, 0.9) };
}

/** The summary of a finished batch. */
export interface BatchSummary {
  /** Matches summarised. */
  matches: number;
  /** End-reason tally (ko / ringout / time / draw / error). */
  reasons: Record<string, number>;
  /** key (from BATCH_VARIABLES) -> the variable's stats. */
  variables: Record<string, VariableStats>;
}

/**
 * Summarise a finished batch: the end-reason tally plus min/max/mean/median/sd/p10/p90 for every
 * variable in BATCH_VARIABLES. A non-finite value is dropped per column (never poisons a mean) and
 * an empty batch reports zeroed stats. `describe()` is the source of the core six numbers.
 */
export function batchSummary(records: readonly MatchRecord[]): BatchSummary {
  const reasons: Partial<Record<EndReason, number>> = {};
  for (const r of records) reasons[r.outcome.reason] = (reasons[r.outcome.reason] ?? 0) + 1;
  const variables: Record<string, VariableStats> = {};
  for (const v of BATCH_VARIABLES) variables[v.key] = variableStats(records.map(v.of));
  return { matches: records.length, reasons: reasons as Record<string, number>, variables };
}
