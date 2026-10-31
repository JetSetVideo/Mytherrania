// Wave M (lane M-B): the ENGAGEMENT behaviour behind the user's complaint that the fighters
// "move, but they don't really move… they don't serve each other".
//
// Decode: a STAND-OFF — two fighters move about a long time without either closing or trading
// blows. This module is the missing policy: it turns the live picture (the distance, both
// fighters' readiness/cooldowns, health shares, the fighter's stance, and — the new entry the
// telemetry lane measures — the QUIET TIME since either fighter last landed a hit) into an
// ENGAGEMENT INTENT the decision tree acts on.
//
// The two invariants this module owns:
//
//   (1) A stand-off is SELF-LIMITING. The pull to close is a bounded, monotone function of the
//       quiet stretch:
//
//           pull(quietS) = clamp(quietS / QUIET_CLOSE_S, 0, 1)          [dimensionless]
//
//       quietS in seconds (time since EITHER fighter landed a hit), QUIET_CLOSE_S = 3 s, the quiet
//       stretch at which the pull saturates. pull is non-decreasing in quietS, bounded to [0, 1],
//       and pull(QUIET_CLOSE_S) = 1. At pull = 1 the intent is forced to `approach` even for a
//       fighter that was slipping away — so from any stand-off the intent is `approach` within
//       QUIET_CLOSE_S seconds (the bounded time the lane asserts).
//
//   (2) A fighter NEVER walks PAST its own striking band. The band is the fighter's reach times
//       BAND_MARGIN; `approach` is only ever returned when the enemy is OUTSIDE that band, so a
//       step toward the enemy can never overshoot it.
//
// Pure module: no Math.random, no DOM, no THREE, no `any`.

export type EngagementIntent = "approach" | "hold" | "circle" | "disengage" | "bait";

/** The fighter's current stance, shaping the intent (aggressive presses, defensive slips). */
export type Stance = "aggressive" | "neutral" | "defensive";

/** Seconds of quiet (no landed hit by either fighter) at which the pull to close saturates. */
export const QUIET_CLOSE_S = 3;
/** Contact band edge, m (inside this the pair are body to body). */
export const CONTACT_M = 1.2;
/** A typical weapon's striking band outer edge, m. */
export const STRIKING_M = 2.6;
/** Beyond this the pair is circling, not fighting, m. */
export const CIRCLING_M = 6;
/** Where `approach` stops: the band edge is the fighter's reach times this. */
export const BAND_MARGIN = 1.15;

export const ENGAGEMENT_INTENTS: readonly EngagementIntent[] = ["approach", "hold", "circle", "disengage", "bait"];

/** How "committed" each intent is, so a caller can assert monotonicity. approach > hold > bait > circle > disengage. */
const INTENT_RANK: Record<EngagementIntent, number> = { disengage: 0, circle: 1, bait: 2, hold: 3, approach: 4 };
export function intentRank(i: EngagementIntent): number { return INTENT_RANK[i]; }

/** Everything the intent is computed from. Units: metres, seconds, ratios 0..1. */
export interface EngagementInput {
  /** Fighter-to-fighter distance, m. */
  distance: number;
  /** Self's striking reach (the band outer edge before the margin), m. */
  selfReach: number;
  /** Seconds since EITHER fighter last landed a hit (the quiet stretch), s. */
  quietS: number;
  /** Self's attack is off cooldown. */
  selfReady: boolean;
  /** The enemy's blow is coming (wind-up or skill in progress). */
  enemyAttacking: boolean;
  /** Self's health share, 0..1. */
  selfHpRatio: number;
  /** Enemy's health share, 0..1. */
  enemyHpRatio: number;
  /** Self's stance. */
  stance: Stance;
}

export interface Engagement {
  intent: EngagementIntent;
  /** The pull to close, 0..1 — bounded and monotone non-decreasing in quietS. */
  pull: number;
  /** True when the enemy is inside self's striking band (approach must not be taken). */
  inBand: boolean;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/**
 * The pull to close for a given quiet stretch, dimensionless in [0, 1]:
 *   pull = clamp(quietS / QUIET_CLOSE_S, 0, 1),   quietS in seconds.
 * Non-decreasing and bounded; pull(0) = 0, pull(QUIET_CLOSE_S) = 1, pull(larger) = 1.
 */
export function pullToClose(quietS: number): number {
  if (!Number.isFinite(quietS)) return 0;
  return Math.max(0, Math.min(1, quietS / QUIET_CLOSE_S));
}

/**
 * The engagement intent for one fighter. Deterministic and total: any non-finite input is coerced
 * (a broken distance reads as "in band, hold it", a broken reach as CONTACT_M), never NaN.
 */
export function engagement(i: EngagementInput): Engagement {
  const reach = Number.isFinite(i.selfReach) && i.selfReach > 0 ? i.selfReach : CONTACT_M;
  const band = reach * BAND_MARGIN;
  const dist = Number.isFinite(i.distance) ? Math.max(0, i.distance) : band;
  const inBand = dist <= band;
  const pull = pullToClose(i.quietS);
  const hp = clamp01(i.selfHpRatio);
  const enemyHp = clamp01(i.enemyHpRatio);

  let intent: EngagementIntent;
  if (inBand) {
    // Inside the band: never step back out of it. Swing, slide off an incoming blow, or draw one.
    if (i.selfReady) intent = "hold";
    else if (i.enemyAttacking) intent = "circle";
    else intent = i.stance === "aggressive" ? "hold" : "bait";
  } else if (hp < 0.3 && enemyHp > 0.5 && i.stance === "defensive" && pull < 1) {
    // Out of band and losing: a defensive fighter slips away — but ONLY while the fight is alive.
    // Once the quiet saturates the pull to close (pull = 1) the slip is overridden below.
    intent = "disengage";
  } else {
    // Out of the striking band with a live clock: close. This is the stand-off's own cure — the
    // fighter is never content to sit outside the band it can strike from.
    intent = "approach";
  }
  return { intent, pull, inBand };
}
