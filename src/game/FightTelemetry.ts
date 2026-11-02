// FightTelemetry — the live fight-telemetry accumulator (Wave M, lane M-A).
//
// One accumulator per match. The engine (parent) feeds it the pair's distance and the events
// of each simulated substep (up to ~4 substeps/frame at 8x spectator speed, so `step` must be
// allocation-free), then reads ONE FightTelemetry object at the very end. Pure: numbers in,
// numbers out — no DOM, no THREE, no Math.random, no clock.
//
// Units everywhere: seconds (s), metres (m), damage in HP (docs/SPEC glossary). Distance bands
// are band edges in metres. Vocabulary:
//   dry streak  seconds in which ONE fighter lands no hit (its own drought).
//   mutualDryS  seconds in which NEITHER fighter lands on the other (the pair's starved time).
//   quietS      seconds in which NO offensive event at all occurs (no fighter hit and no object
//               event); quietMaxS is its longest run. quietS + active time = durationS.
//   standoffMaxS the user's stall — "they move but they don't really move, they don't serve each
//               other" — the longest stretch with no hit while the pair is beyond CIRCLING_M.
//
// REFUSAL: a non-finite input (dt, distance, damage, jump height) is refused WHOLE — dropped
// before it can enter any average and counted in `refused` — so one bad step can never poison a
// mean or the quiet/active partition. This mirrors the total-function style of MatchHistory.num/
// FrameBudget.step, but rejects rather than coerces because a live NaN distance would otherwise
// corrupt the median the AI corpus is trained on.
//
// The statistics reuse the repo's vocabulary: `describe` (MatchHistory) for mean/median/min/max
// and `percentile` (FrameBudget) for p10/p90.

import { describe } from "./MatchHistory.ts";
import { percentile } from "./FrameBudget.ts";

/** Distance band edges, metres: contact <= CONTACT_M <= striking <= STRIKING_M <= circling <= CIRCLING_M <= apart. */
export const CONTACT_M = 1.2;
export const STRIKING_M = 2.6;
export const CIRCLING_M = 6;

/** Which fighter (seat 0 or seat 1). */
export type FighterIndex = 0 | 1;
/** The four object interactions the user named. */
export type ObjectKind = "taken" | "destroyed" | "defended" | "attacked";

/** Seconds spent in each distance band (metres → seconds); the four sum to durationS. */
export interface DistanceBands { contact: number; striking: number; circling: number; apart: number }
/** A run of consecutive dry seconds: how many runs, their total/mean, and the longest/shortest. */
export interface StreakStats { count: number; totalS: number; meanS: number; maxS: number; minS: number }
/** A count/aggregate of a stream of values: how many, how much, the highest, the average. */
export interface HitStat { count: number; total: number; max: number; mean: number }

/**
 * Everything the front end measured about a match, read once at the end. All fields are finite
 * for any scripted input (an empty match yields zeros, never NaN/Infinity).
 */
export interface FightTelemetry {
  durationS: number;
  /** Per fighter (index 0/1): seconds with no landed hit (a DRY STREAK) and its max/min/mean. */
  dryStreak: [StreakStats, StreakStats];
  /** Seconds neither fighter lands on the other (the pair's starved time). */
  mutualDryS: number;
  /** Seconds where no offensive event at all occurs, and the longest such stretch. */
  quietS: number;
  quietMaxS: number;
  /** The fighter-to-fighter distance statistics over the match (one sample per admitted step). */
  distance: { mean: number; median: number; min: number; max: number; p10: number; p90: number };
  bands: DistanceBands;
  /** Engagement: seconds spent closing, seconds in contact, and the longest stand-off. */
  engagement: { closingS: number; contactS: number; standoffMaxS: number };
  jumps: [HitStat, HitStat];              // count + peak height (m) per fighter
  damageDealt: [HitStat, HitStat];
  damageTaken: [HitStat, HitStat];
  damageAbsorbed: [HitStat, HitStat];     // blocked / guarded / parried
  damageByWeapon: Record<string, HitStat>; // key = weapon archetype id
  objects: { taken: number; destroyed: number; defended: number; attacked: number };
  evolution: { level: number; statDelta: number }[];   // the fighters' own evolution, per event
}

// --- Wave FALL (C-LOG): collisions, falls and rises ------------------------------------------------

/** One recorded force event. `who` is the seat (0/1) the event happened TO. */
export interface ForceEvent {
  /** Match time, s. */
  t: number;
  kind: "collision" | "fall" | "rise";
  who: FighterIndex;
  /** collision: "charge" | "clash" | "qa"; fall/rise: the fall cause (collision, hit, edge, backstep, ledge, exhaustion). */
  cause: string;
  /** The fall phase the event left the body in (stand / stagger / stumble / falling / down / rising). */
  phase: string;
  /** Collision impulse (N·s; 0 for falls) and the body's balance loss 0..1. */
  impulse: number;
  balance: number;
  /** This body's pushback, m (collision) — 0 otherwise. */
  pushback: number;
  /** collision: stagger s; fall: planned get-up s (down + rising); rise: seconds from the fall to standing. */
  duration: number;
  hp01: number;
  stamina01: number;
  /** collision: "stagger" | "stumble" | "fall" | "none"; fall: the pose; rise: "rose" | "ko". */
  outcome: string;
}

/** The match's force log, summarised. */
export interface ForceSummary {
  /** Collisions in the match (each counted once). */
  collisions: number;
  /** Falls (reaching the floor) and completed rises per seat. */
  falls: [number, number];
  rises: [number, number];
  /** Seconds spent downed (down + rising) per seat, and the mean per fall. */
  downS: [number, number];
  meanDownS: number;
  /** Damage taken while downed per seat, HP. */
  damageWhileDown: [number, number];
  /** Falls by cause. */
  causes: Record<string, number>;
  /** The events, in order, up to FORCE_EVENT_CAP; `dropped` counts the rest. */
  events: ForceEvent[];
  dropped: number;
}

/** Events kept in one match's force log (a 180 s match measured well under it). */
export const FORCE_EVENT_CAP = 64;

/**
 * Project a match's summary onto ONE seat. The match-level numbers (duration, the distance
 * statistics, the bands, the engagement and the object events) are shared; the per-fighter
 * arrays keep only this seat's entry. Wave M's report carries one of these per fighter, so the
 * payload describes each seat without duplicating the pair twice over.
 */
export function telemetryForSeat(t: FightTelemetry, seat: 0 | 1): FightTelemetry {
  const keep = <T>(pair: [T, T]): [T, T] => [pair[seat], pair[seat]];
  return {
    ...t,
    dryStreak: keep(t.dryStreak),
    jumps: keep(t.jumps),
    damageDealt: keep(t.damageDealt),
    damageTaken: keep(t.damageTaken),
    damageAbsorbed: keep(t.damageAbsorbed),
  };
}

/** A running count/total/max, folded into a HitStat at summary time. */
interface HitAcc { count: number; total: number; max: number }

function newHitAcc(): HitAcc {
  return { count: 0, total: 0, max: 0 };
}

/** Fold one value into an accumulator (no allocation). */
function foldHit(a: HitAcc, value: number): void {
  a.count++;
  a.total += value;
  if (value > a.max) a.max = value;
}

function hitStat(a: HitAcc): HitStat {
  return { count: a.count, total: a.total, max: a.max, mean: a.count > 0 ? a.total / a.count : 0 };
}

/** The distance summary, reusing `describe` (mean/median/min/max) and `percentile` (p10/p90). */
function distanceStats(samples: number[]): FightTelemetry["distance"] {
  if (samples.length === 0) return { mean: 0, median: 0, min: 0, max: 0, p10: 0, p90: 0 };
  const d = describe(samples);
  return {
    mean: d.mean,
    median: d.median,
    min: d.min,
    max: d.max,
    p10: percentile(samples, 0.1),
    p90: percentile(samples, 0.9),
  };
}

/**
 * The live accumulator. Create one per match with `createTelemetry()`; call `step` every
 * simulated substep and the event methods (`hit`, `jump`, `object`, `evolution`) as they happen
 * DURING that substep; read `telemetrySummary(acc)` once at the end.
 */
export class TelemetryAccumulator {
  /** Total admitted simulated time, seconds. */
  durationS = 0;
  /** Number of inputs refused for being non-finite/negative (never folded into a statistic). */
  refused = 0;

  // Pending event marks for the substep being closed (set by the event methods, consumed by step).
  #hit: [boolean, boolean] = [false, false];
  #objectMark = false;

  // Per-fighter open dry run and its closed-run aggregate.
  #run: [number, number] = [0, 0];
  #streakCount: [number, number] = [0, 0];
  #streakTotal: [number, number] = [0, 0];
  #streakMax: [number, number] = [0, 0];
  #streakMin: [number, number] = [Infinity, Infinity];

  // Distance samples (one per admitted step) and the previous admitted distance for the closing test.
  #distances: number[] = [];
  #prevDistance = Number.NaN; // NaN = no previous admitted step

  #bands: DistanceBands = { contact: 0, striking: 0, circling: 0, apart: 0 };
  #closingS = 0;
  #standoffRun = 0;
  #standoffMaxS = 0;

  #mutualDryS = 0;
  #quietS = 0;
  #quietRun = 0;
  #quietMaxS = 0;

  #jumps: [HitAcc, HitAcc] = [newHitAcc(), newHitAcc()];
  #dealt: [HitAcc, HitAcc] = [newHitAcc(), newHitAcc()];
  #taken: [HitAcc, HitAcc] = [newHitAcc(), newHitAcc()];
  #absorbed: [HitAcc, HitAcc] = [newHitAcc(), newHitAcc()];
  #byWeapon = new Map<string, HitAcc>();
  #objects = { taken: 0, destroyed: 0, defended: 0, attacked: 0 };
  #evolution: { level: number; statDelta: number }[] = [];
  // Wave FALL (C-LOG).
  #forceEvents: ForceEvent[] = [];
  #forceDropped = 0;
  #collisions = 0;
  #falls: [number, number] = [0, 0];
  #rises: [number, number] = [0, 0];
  #downS: [number, number] = [0, 0];
  #dmgDown: [number, number] = [0, 0];
  #causes: Record<string, number> = {};

  /** Wave FALL: record a collision / fall / rise. A non-finite number in the event refuses it whole. */
  force(e: ForceEvent): void {
    const nums = [e.t, e.impulse, e.balance, e.pushback, e.duration, e.hp01, e.stamina01];
    if (nums.some((v) => !Number.isFinite(v)) || (e.who !== 0 && e.who !== 1)) { this.refused++; return; }
    if (e.kind === "collision") { if (e.who === 0) this.#collisions++; } // one collision = two events (both bodies)
    else if (e.kind === "fall") { this.#falls[e.who]++; this.#causes[e.cause] = (this.#causes[e.cause] ?? 0) + 1; }
    else this.#rises[e.who]++;
    if (this.#forceEvents.length < FORCE_EVENT_CAP) this.#forceEvents.push({ ...e });
    else this.#forceDropped++;
  }

  /** Wave FALL: seconds `seat` spent downed this substep. */
  downed(seat: FighterIndex, dtS: number): void {
    if (!Number.isFinite(dtS) || dtS < 0) { this.refused++; return; }
    this.#downS[seat] += dtS;
  }

  /** Wave FALL: damage `seat` took while downed. */
  damageWhileDown(seat: FighterIndex, damage: number): void {
    if (!Number.isFinite(damage) || damage < 0) { this.refused++; return; }
    this.#dmgDown[seat] += damage;
  }

  /** Wave FALL: the force log summary (non-mutating). */
  forceSummary(): ForceSummary {
    const falls = this.#falls[0] + this.#falls[1];
    return {
      collisions: this.#collisions, falls: [this.#falls[0], this.#falls[1]], rises: [this.#rises[0], this.#rises[1]],
      downS: [this.#downS[0], this.#downS[1]], meanDownS: falls > 0 ? (this.#downS[0] + this.#downS[1]) / falls : 0,
      damageWhileDown: [this.#dmgDown[0], this.#dmgDown[1]], causes: { ...this.#causes },
      events: this.#forceEvents.map((e) => ({ ...e })), dropped: this.#forceDropped,
    };
  }

  /**
   * Close one simulated substep of `dtS` seconds at the pair distance `distanceM` (metres),
   * consuming the event marks set since the previous call. Allocation-free. A non-finite/negative
   * input is refused whole (see the module header).
   */
  step(dtS: number, distanceM: number): void {
    if (!Number.isFinite(dtS) || dtS < 0 || !Number.isFinite(distanceM)) {
      this.refused++;
      return;
    }
    this.durationS += dtS;
    this.#distances.push(distanceM);

    // Distance band (metres → seconds). south->north: contact, striking, circling, apart.
    if (distanceM <= CONTACT_M) this.#bands.contact += dtS;
    else if (distanceM <= STRIKING_M) this.#bands.striking += dtS;
    else if (distanceM <= CIRCLING_M) this.#bands.circling += dtS;
    else this.#bands.apart += dtS;

    // Closing: the pair approached since the previous admitted step.
    if (Number.isFinite(this.#prevDistance) && distanceM < this.#prevDistance) this.#closingS += dtS;
    this.#prevDistance = distanceM;

    const hit0 = this.#hit[0];
    const hit1 = this.#hit[1];
    const anyHit = hit0 || hit1;

    // Stand-off: no hit AND beyond the circling band.
    if (!anyHit && distanceM > CIRCLING_M) {
      this.#standoffRun += dtS;
      if (this.#standoffRun > this.#standoffMaxS) this.#standoffMaxS = this.#standoffRun;
    } else {
      this.#standoffRun = 0;
    }

    // The pair partition. `mutualDryS` counts no fighter-to-fighter hit; `quietS` additionally
    // excludes a substep with an object event, so quietS <= mutualDryS (equal with no objects).
    if (!anyHit) this.#mutualDryS += dtS;
    if (!anyHit && !this.#objectMark) {
      this.#quietS += dtS;
      this.#quietRun += dtS;
      if (this.#quietRun > this.#quietMaxS) this.#quietMaxS = this.#quietRun;
    } else {
      this.#quietRun = 0;
    }

    // Per-fighter dry streaks: a substep in which the fighter lands is a landing second, not a
    // dry second, so it closes the run but does not extend it.
    if (hit0) this.#closeRun(0);
    else this.#run[0] += dtS;
    if (hit1) this.#closeRun(1);
    else this.#run[1] += dtS;

    this.#hit[0] = false;
    this.#hit[1] = false;
    this.#objectMark = false;
  }

  /**
   * Record a landed hit by `attacker` on the other fighter: `damage` HP dealt (and taken by the
   * defender), `absorbed` HP the defender blocked/guarded (>= 0), under weapon id `weapon`
   * (empty → "default"). Also marks the substep as a landing step. Non-finite/negative refused.
   */
  hit(attacker: FighterIndex, damage: number, absorbed = 0, weapon = ""): void {
    if (!Number.isFinite(damage) || damage < 0) {
      this.refused++;
      return;
    }
    const defender: FighterIndex = attacker === 0 ? 1 : 0;
    this.#hit[attacker] = true;
    foldHit(this.#dealt[attacker], damage);
    foldHit(this.#taken[defender], damage);
    if (Number.isFinite(absorbed) && absorbed > 0) foldHit(this.#absorbed[defender], absorbed);
    const key = weapon || "default";
    let w = this.#byWeapon.get(key);
    if (!w) {
      w = newHitAcc();
      this.#byWeapon.set(key, w);
    }
    foldHit(w, damage);
  }

  /** Record a jump by `fighter` of peak height `peakM` metres (count + peak/mean height). */
  jump(fighter: FighterIndex, peakM: number): void {
    if (!Number.isFinite(peakM) || peakM < 0) {
      this.refused++;
      return;
    }
    foldHit(this.#jumps[fighter], peakM);
  }

  /** Record an object interaction and mark the substep as offensive (so it is not "quiet"). */
  object(kind: ObjectKind): void {
    this.#objects[kind] += 1;
    this.#objectMark = true;
  }

  /** Record one fighter evolution event: the new `level` and the `statDelta` it gained. */
  evolution(level: number, statDelta: number): void {
    this.#evolution.push({
      level: Number.isFinite(level) ? level : 0,
      statDelta: Number.isFinite(statDelta) ? statDelta : 0,
    });
  }

  /** Close an open dry run, recording it when it has positive length (a zero-length run is not a streak). */
  #closeRun(f: FighterIndex): void {
    const len = this.#run[f];
    if (len > 0) {
      this.#streakCount[f]++;
      this.#streakTotal[f] += len;
      if (len > this.#streakMax[f]) this.#streakMax[f] = len;
      if (len < this.#streakMin[f]) this.#streakMin[f] = len;
    }
    this.#run[f] = 0;
  }

  /** The stats of fighter `f`'s dry streaks, folding in the still-open run WITHOUT mutating state. */
  #streak(f: FighterIndex): StreakStats {
    let count = this.#streakCount[f];
    let total = this.#streakTotal[f];
    let max = this.#streakMax[f];
    let min = this.#streakMin[f];
    const open = this.#run[f];
    if (open > 0) {
      count++;
      total += open;
      if (open > max) max = open;
      if (open < min) min = open;
    }
    if (count === 0) {
      return { count: 0, totalS: 0, meanS: 0, maxS: 0, minS: 0 };
    }
    return { count, totalS: total, meanS: total / count, maxS: max, minS: min };
  }

  /** Build the FightTelemetry for this match. Non-mutating: safe to call repeatedly. */
  summary(): FightTelemetry {
    const byWeapon: Record<string, HitStat> = {};
    for (const [k, v] of this.#byWeapon) byWeapon[k] = hitStat(v);
    return {
      durationS: this.durationS,
      dryStreak: [this.#streak(0), this.#streak(1)],
      mutualDryS: this.#mutualDryS,
      quietS: this.#quietS,
      quietMaxS: this.#quietMaxS,
      distance: distanceStats(this.#distances),
      bands: {
        contact: this.#bands.contact,
        striking: this.#bands.striking,
        circling: this.#bands.circling,
        apart: this.#bands.apart,
      },
      engagement: { closingS: this.#closingS, contactS: this.#bands.contact, standoffMaxS: this.#standoffMaxS },
      jumps: [hitStat(this.#jumps[0]), hitStat(this.#jumps[1])],
      damageDealt: [hitStat(this.#dealt[0]), hitStat(this.#dealt[1])],
      damageTaken: [hitStat(this.#taken[0]), hitStat(this.#taken[1])],
      damageAbsorbed: [hitStat(this.#absorbed[0]), hitStat(this.#absorbed[1])],
      damageByWeapon: byWeapon,
      objects: { ...this.#objects },
      evolution: this.#evolution.map((e) => ({ level: e.level, statDelta: e.statDelta })),
    };
  }
}

/** A fresh accumulator, one per match. */
export function createTelemetry(): TelemetryAccumulator {
  return new TelemetryAccumulator();
}

/** Read the match's telemetry once, at the end. Delegates to `acc.summary()`. */
export function telemetrySummary(a: TelemetryAccumulator): FightTelemetry {
  return a.summary();
}
