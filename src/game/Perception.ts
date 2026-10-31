// Perception (Wave N, lane N-C): what ONE seat is allowed to believe about the other while
// the other is concealed.
//
// This is the "the AI must understand that the disparition of the opponent is probably an
// effect of his strategy" half of the ask. When the enemy vanishes, the viewer does not lose
// the enemy — it loses its POSITION and gains a BELIEF: where it last saw them, how stale
// that memory is, how sure it is, and the strategy the vanish most plausibly signals.
//
// THE BUG THIS MODULE EXISTS TO PREVENT: a belief that leaks the true position. The sim keeps
// the true position (Concealment.ts is authoritative); this module must NEVER place it in a
// belief while the other is concealed. That is asserted in the tests, not merely commented.
//
// Vocabulary: the belief names a behavioural `StrategyId` from lane N-B (Strategies.ts) — the
// higher vocabulary the AI, the opponent model and the report share. A vanish reads as `hide`,
// and N-B's STRATEGY_LEAVES ties `hide` down to the real decision-tree leaves it prefers
// (`retreat`), so the belief still names a decision the shipped tree can actually take.
//
// Pure module: no DOM, no THREE, no Math.random, no clock. Units: seconds (s), metres (m).

import { STRATEGY_IDS_ALL, type StrategyId, type XY } from "./Strategies.ts";

/**
 * The strategy a vanish most plausibly signals: the enemy has broken contact to reposition or
 * wait a cooldown. In N-B's vocabulary that is `hide` — "break contact entirely; a hidden body
 * does not strike". N-B's STRATEGY_LEAVES maps `hide` onto the tree's `retreat` leaf.
 */
export const CONCEALED_STRATEGY: StrategyId = "hide";

/**
 * The strategy assumed while the enemy is IN SIGHT. With no strategy telemetry at the belief
 * call site, the neutral read of a visible opponent is that they are engaging — N-B's `brawl`
 * ("close and swing: the whole point is contact"). The belief is certain (`confidence01 === 1`)
 * because the position it carries is the truth.
 */
export const VISIBLE_STRATEGY: StrategyId = "brawl";

/**
 * Confidence a FRESH vanish starts at (0..1). Below 1 on purpose: the viewer knows it saw the
 * enemy vanish, but the plan behind it is only a guess, and the guess gets weaker with time.
 */
export const CONFIDENCE_START = 0.85;

/**
 * What seat `viewer` believes about seat `other` this instant. While `other` is concealed,
 * `lastKnown` is NEVER `other`'s true position and `knowsPosition` is false.
 */
export interface Belief {
  /** The last place the viewer saw the other, or null once the memory has lapsed. */
  lastKnown: XY | null;
  /** How stale the memory is, seconds (clamped to the memory horizon). */
  ageS: number;
  /** The behaviour the other is most plausibly running right now (lane N-B vocabulary). */
  probableStrategy: StrategyId;
  /** How sure the viewer is, 0..1 — decays with age, 1 while the other is in sight. */
  confidence01: number;
  /** True only when the position is the other's ACTUAL, current position. */
  knowsPosition: boolean;
}

/** Clamp into [lo, hi]; a NaN folds to lo so no belief can carry a NaN. */
function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

/**
 * The belief seat `viewer` holds about seat `other`.
 *
 *   - other in sight (`otherConcealed` false): RE-ACQUIRE. The belief is the truth — the
 *     other's current position, age 0, confidence 1, `knowsPosition` true.
 *   - other concealed: the belief may NOT carry `o.other`. It carries the last known place
 *     (or null once `sinceLastSeenS >= memoryS` has lapsed), with `knowsPosition` false and a
 *     confidence that decays LINEARLY from `CONFIDENCE_START` to 0 across the memory horizon
 *     (`memoryS`, seconds). The `probableStrategy` is the vanish's read (`hide`).
 *
 * `viewer` positions the viewer but is not needed to withhold the truth; it is part of the
 * contract's shape for callers that later gate sight by range.
 */
export function perceive(o: {
  viewer: XY;
  other: XY;
  otherConcealed: boolean;
  lastKnown: XY | null;
  sinceLastSeenS: number;
  memoryS: number;
}): Belief {
  if (!o.otherConcealed) {
    // The only branch allowed to hold the true position.
    return {
      lastKnown: { x: o.other.x, z: o.other.z },
      ageS: 0,
      probableStrategy: VISIBLE_STRATEGY,
      confidence01: 1,
      knowsPosition: true,
    };
  }

  const memoryS = Number.isFinite(o.memoryS) && o.memoryS > 0 ? o.memoryS : 1;
  const rawAge = Number.isFinite(o.sinceLastSeenS) ? Math.max(0, o.sinceLastSeenS) : 0;
  const ageS = Math.min(rawAge, memoryS);
  const confidence01 = clamp(CONFIDENCE_START * (1 - ageS / memoryS), 0, 1);
  const lk = o.lastKnown;
  const forgotten = rawAge >= memoryS || lk === null;

  return {
    // Still never o.other: the memory, or nothing.
    lastKnown: forgotten ? null : { x: lk.x, z: lk.z },
    ageS,
    probableStrategy: CONCEALED_STRATEGY,
    confidence01,
    knowsPosition: false,
  };
}

/**
 * The point a viewer should move toward given its belief: the last known position, or null
 * when the memory has lapsed (the AI then has to search). This is the practical read of a
 * belief — it never returns the concealed seat's true position.
 */
export function beliefTarget(b: Belief): XY | null {
  return b.lastKnown ? { x: b.lastKnown.x, z: b.lastKnown.z } : null;
}

/** Is `id` one of the behavioural strategies the wave shares? Guards the belief's vocabulary. */
export function isStrategyId(id: string): id is StrategyId {
  return (STRATEGY_IDS_ALL as readonly string[]).includes(id);
}
