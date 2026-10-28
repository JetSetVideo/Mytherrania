// Automatic training-run planner and aggregator.
//
// A TrainingPlan is the whole of a self-play data-gathering campaign: how many
// rounds, which seed, which classes and races to sweep, and the arena-size band.
// `expandPlan` turns it into the concrete, reproducible list of matchups the
// engine replays without anyone watching; `planSize` counts them without
// expanding; `drainPlan` hands the list out in batches so a long campaign can be
// run a slice at a time; and `aggregateRuns` rolls the finished results back into
// per-class win rates and end-reason tallies.
//
// A matchup is an ordered pairing of two fighters: (classA, raceA) against
// (classB, raceB). "Ordered" means the mirror of a matchup — both fighters
// swapped — is a distinct entry, and a class or race may be paired with itself.
// Every chosen class is crossed with every chosen class, and every chosen race
// with every chosen race, then repeated once per round.
//
// Pure module: no Three.js, no DOM, no global state. Same plan -> same list.

import { CLASSES } from "./Stats.ts";
import { RACES } from "./Races.ts";

/** Every class in the game, used when `plan.classes` is empty. */
const ALL_CLASSES: readonly string[] = CLASSES;
/** Every race id in the game, used when `plan.races` is empty. */
const ALL_RACES: readonly string[] = RACES.map((r) => r.id);

export interface TrainingPlan {
  /** Repeats of the whole matchup matrix, so noisy pairs get more samples. */
  rounds: number;
  /** Campaign seed: every arena size and matchup seed is derived from it. */
  seed: number;
  /** Classes to sweep; empty means every class in the game. */
  classes: string[];
  /** Race ids to sweep; empty means every race in the game. */
  races: string[];
  /** Speed preset id handed to each match (carried through untouched). */
  speedId: string;
  /** Length preset id handed to each match (carried through untouched). */
  lengthId: string;
  /** Smallest arena size in the band. */
  arenaSizeMin: number;
  /** Largest arena size in the band. */
  arenaSizeMax: number;
}

export interface TrainingMatchup {
  /** 0-based round this entry belongs to. */
  round: number;
  classA: string;
  classB: string;
  raceA: string;
  raceB: string;
  /** Deterministic arena size inside the plan's band, in metres. */
  arenaSize: number;
  /** Deterministic per-matchup seed, derived from `plan.seed`. */
  seed: number;
  speedId: string;
  lengthId: string;
}

export interface RunResult {
  winnerClass: string;
  loserClass: string;
  /** Seconds the match lasted. */
  durationS: number;
  /** Total damage dealt across the match. */
  damage: number;
  /** How the match ended, e.g. "ko", "ring-out", "timed", "koth". */
  endReason: string;
}

export interface RunSummary {
  matches: number;
  /** Matches won by each class (0 for a class that only ever lost). */
  winsByClass: Record<string, number>;
  /**
   * Share of all matches won by each class: winsByClass[c] / matches. Across
   * every class that appeared this sums to 1 whenever every match has a winner.
   */
  winRateByClass: Record<string, number>;
  avgDurationS: number;
  avgDamage: number;
  /** Count of matches by end reason. */
  endReasons: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Deterministic hashing. No global state, so a plan always expands identically.
// ---------------------------------------------------------------------------

/** Integer avalanche mix (Murmur3-style finalizer); maps any int to a uint32. */
function mix32(x: number): number {
  let h = x >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h >>> 0;
}

/** Small, fast seeded generator (mulberry32): a uint32 seed -> a stream in [0,1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Arena-size band, tolerating a min > max by swapping the two ends. */
function band(plan: TrainingPlan): { lo: number; hi: number } {
  return { lo: Math.min(plan.arenaSizeMin, plan.arenaSizeMax), hi: Math.max(plan.arenaSizeMin, plan.arenaSizeMax) };
}

// ---------------------------------------------------------------------------
// Planning.
// ---------------------------------------------------------------------------

/**
 * Expand a plan into its concrete, reproducible list of matchups. Order is
 * stable: classes, then races, then rounds. Each entry gets an arena size drawn
 * from the band and a seed, both derived from `plan.seed`, so the same plan
 * always yields the same list.
 */
export function expandPlan(plan: TrainingPlan): TrainingMatchup[] {
  const classes = plan.classes.length ? plan.classes : ALL_CLASSES;
  const races = plan.races.length ? plan.races : ALL_RACES;
  const { lo, hi } = band(plan);
  const span = hi - lo + 1; // inclusive integer sizes in [lo, hi]
  const out: TrainingMatchup[] = [];
  let index = 0;
  for (const classA of classes) {
    for (const classB of classes) {
      for (const raceA of races) {
        for (const raceB of races) {
          for (let round = 0; round < plan.rounds; round++) {
            const seed = mix32((plan.seed >>> 0) ^ Math.imul(index + 1, 0x9e3779b1));
            const arenaSize = lo + Math.floor(mulberry32(seed)() * span);
            out.push({ round, classA, classB, raceA, raceB, arenaSize, seed, speedId: plan.speedId, lengthId: plan.lengthId });
            index++;
          }
        }
      }
    }
  }
  return out;
}

/**
 * Number of matchups a plan produces, without building the list. Cheap enough to
 * drive a progress bar or a sanity check on a plan before running it.
 */
export function planSize(plan: TrainingPlan): number {
  const nc = plan.classes.length || ALL_CLASSES.length;
  const nr = plan.races.length || ALL_RACES.length;
  return nc * nc * nr * nr * Math.max(0, plan.rounds);
}

/**
 * The expanded list cut into successive batches for running a campaign a slice
 * at a time. Every matchup appears exactly once across the batches; the last
 * batch may be shorter than `batchSize`. A batch size below 1 is treated as 1.
 */
export function drainPlan(plan: TrainingPlan, batchSize: number): TrainingMatchup[][] {
  const all = expandPlan(plan);
  const n = Math.max(1, Math.floor(batchSize));
  const out: TrainingMatchup[][] = [];
  for (let i = 0; i < all.length; i += n) out.push(all.slice(i, i + n));
  return out;
}

// ---------------------------------------------------------------------------
// Aggregation.
// ---------------------------------------------------------------------------

/**
 * Roll finished match results into per-class win counts and shares, mean
 * duration and damage, and end-reason tallies. An empty list aggregates to
 * zeros and empty maps — never NaN.
 */
export function aggregateRuns(results: RunResult[]): RunSummary {
  const winsByClass: Record<string, number> = {};
  const winRateByClass: Record<string, number> = {};
  const endReasons: Record<string, number> = {};
  const seen = new Set<string>();
  let totalDuration = 0;
  let totalDamage = 0;
  for (const r of results) {
    seen.add(r.winnerClass);
    seen.add(r.loserClass);
    winsByClass[r.winnerClass] = (winsByClass[r.winnerClass] ?? 0) + 1;
    endReasons[r.endReason] = (endReasons[r.endReason] ?? 0) + 1;
    totalDuration += r.durationS;
    totalDamage += r.damage;
  }
  const matches = results.length;
  for (const c of seen) {
    if (!(c in winsByClass)) winsByClass[c] = 0;
    winRateByClass[c] = matches ? winsByClass[c] / matches : 0;
  }
  return {
    matches,
    winsByClass,
    winRateByClass,
    avgDurationS: matches ? totalDuration / matches : 0,
    avgDamage: matches ? totalDamage / matches : 0,
    endReasons,
  };
}
