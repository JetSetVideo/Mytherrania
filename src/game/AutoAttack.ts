// Autoattack (Wave N, lane N-E): the layer the AI and the player both stand on. A swing that
// happens BY ITSELF once the attack interval has elapsed, whenever the target is inside reach and
// the fighter is free to act. Pure module, no DOM, no THREE, no Math.random — the engine owns the
// clock and the target, this owns the *decision*.
//
// WHAT IT IS NOT. This does not time the swing's animation (that is src/game/anim/Swing.ts, the
// four-phase SwingPlayer the engine drives) and it does not resolve the hit (that is
// src/combat/Impact.ts). It answers one question the engine asks every frame:
//
//     may this fighter start a plain swing RIGHT NOW?
//
// The engine's own rule (Engine #swingCooldown / #playerAttack) is: a swing may start when the
// per-class attack interval has elapsed, the fighter can act (not stunned/hypnotised), no skill is
// held, and no swing is already running that cannot be chained. AutoAttack mirrors the first two of
// those exactly and takes the rest as the caller's problem, so the same numbers drive the AI seat
// and the player seat.
//
// UNITS. `nextAtS` and `atS` are absolute seconds on the fight clock (the engine's #sinceStart).
// `intervalS` is the per-class attack interval in seconds (Stats.attackInterval lands in [0.85,
// 1.35]; the engine's #swingCooldown multiplies it by stance/status/weapon tempo and floors the
// RESULT at 0.2 s). `distanceM`/`reachM` are metres, centre to centre.

/** One fighter's autoattack: when its next swing may land, and how far apart swings are. */
export interface AutoAttack {
  /** Absolute fight-clock time (s) at or after which the next swing is due. */
  nextAtS: number;
  /** Seconds between swings (the class interval, already stance/weapon-adjusted). */
  intervalS: number;
  /** The last id this fighter swung at, or null before the first swing (the engine names ids). */
  lastTargetId: string | null;
}

/**
 * Interval clamp, s. The engine floors a resolved swing cooldown at 0.2 s (Engine #swingCooldown:
 * `/ Math.max(0.2, …)`), so nothing here may schedule a blow faster than that; the ceiling is a
 * sanity cap so a nonsense interval can neither NaN the clock nor starve the fighter forever.
 */
export const AUTOATTACK_INTERVAL_MIN_S = 0.2;
export const AUTOATTACK_INTERVAL_MAX_S = 10;

const clampInterval = (v: number): number =>
  Math.min(AUTOATTACK_INTERVAL_MAX_S, Math.max(AUTOATTACK_INTERVAL_MIN_S, v));

/**
 * A fresh autoattack: due at `atS` (default 0) so the opening swing is allowed the instant the
 * truce lifts, matching the engine's `attackCooldown = 0` start. The interval is clamped into
 * [AUTOATTACK_INTERVAL_MIN_S, AUTOATTACK_INTERVAL_MAX_S]; a non-finite interval falls to the floor.
 */
export function createAutoAttack(intervalS: number, atS = 0): AutoAttack {
  return {
    nextAtS: Number.isFinite(atS) ? atS : 0,
    intervalS: clampInterval(Number.isFinite(intervalS) ? intervalS : AUTOATTACK_INTERVAL_MIN_S),
    lastTargetId: null,
  };
}

/**
 * Is a plain swing due this frame?
 *
 * Due only when ALL hold:
 *   - the fighter is neither stunned nor casting (a disabled or busy fighter cannot autoattack);
 *   - the target is in reach: distanceM <= reachM (metres, centre to centre);
 *   - the interval has elapsed: atS >= nextAtS (seconds on the fight clock).
 *
 * Anything non-finite in the clock or the reach is REFUSED (returns false): a NaN must never read
 * as "due", which would fire a swing with no timing. The reach boundary is inclusive, so standing
 * exactly at reachM is in reach.
 */
export function autoAttackDue(
  a: AutoAttack,
  o: { atS: number; distanceM: number; reachM: number; stunned: boolean; casting: boolean },
): boolean {
  if (o.stunned || o.casting) return false;
  if (!Number.isFinite(o.atS) || !Number.isFinite(a.nextAtS)) return false;
  if (!Number.isFinite(o.distanceM) || !Number.isFinite(o.reachM)) return false;
  if (o.distanceM > o.reachM) return false;
  return o.atS >= a.nextAtS;
}

/**
 * Record that a swing happened at `atS` with the given interval: the next one is due a full
 * interval later. The interval is clamped the same way as createAutoAttack; a non-finite interval
 * keeps the fighter's own last interval rather than corrupting the clock. `lastTargetId` is the
 * caller's to set on the state it passes in — it is preserved here.
 */
export function advanceAutoAttack(
  a: AutoAttack,
  o: { atS: number; intervalS: number },
): AutoAttack {
  const interval = clampInterval(
    Number.isFinite(o.intervalS) ? o.intervalS : a.intervalS,
  );
  const at = Number.isFinite(o.atS) ? o.atS : a.nextAtS;
  return { nextAtS: at + interval, intervalS: interval, lastTargetId: a.lastTargetId };
}
