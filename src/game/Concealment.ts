// Concealment (Wave N, lane N-C): invisibility as AUTHORITATIVE simulation state.
//
// The user asked for a vanish that is "server side so the opponent cannot cheat".
// This build has no server, so the decode is: the SIMULATION is the authority. A seat's
// true position keeps living in the sim; the concealment flag is what the opponent's
// perception (Perception.ts) is graded against. The renderer hiding the model is a
// SECOND, cosmetic step — never the only thing hiding (an engine that hid the mesh but
// left the position readable would be the exact bug this lane exists to prevent).
//
// A concealment is begun by a power (the Assassin's `assassin-vanish`) and ends for exactly
// four reasons — attacking, taking damage, proximity, or expiry. Pure module: numbers in,
// numbers out. No DOM, no THREE, no Math.random, no clock — the caller passes the sim time.
// Units everywhere: seconds (s), metres (m).

/** Reasons a concealment can end; the four the contract names. */
export type BreakReason = "attack" | "damage" | "proximity" | "expired";

/**
 * How long a vanish holds before it expires on its own, seconds. A defensive cooldown is
 * meant to break a fight open, not to hide for the whole match: 6 s is long enough to
 * reposition and short enough that the opponent's memory horizon (Perception `memoryS`)
 * can be tuned around it.
 */
export const CONCEAL_MAX_S = 6.0;

/**
 * Default proximity break distance, metres. An enemy inside this radius is close enough
 * that a vanish cannot be believed: touch-range contact re-reveals the concealed seat.
 * 2.5 m sits between the telemetry `CONTACT_M` (1.2) and `STRIKING_M` (2.6) bands, so a
 * lunge into striking range is what breaks the ruse.
 */
export const CONCEAL_BREAK_M = 2.5;

export interface Concealment {
  /** False the instant any of the four reasons fires; the sim's authority bit. */
  active: boolean;
  /** Sim time the vanish began, seconds (the expiry clock's origin). */
  startedAtS: number;
  /** Does landing an attack reveal the concealed seat? (Vanish is broken by attacking.) */
  revealOnAttack: boolean;
  /** Enemy within this distance (metres) re-reveals the seat. */
  breakBelowM: number;
}

/** What the engine reports about a concealed seat each frame, to advance the state. */
export interface ConcealFrame {
  /** Current sim time, seconds. */
  atS: number;
  /** Distance to the watching enemy, metres (omitted = unknown/irrelevant this frame). */
  distanceM?: number;
  /** Did the concealed seat attack this frame? */
  attacked?: boolean;
  /** Did the concealed seat take damage this frame? */
  damaged?: boolean;
}

/** A finite number or the fallback — a NaN must never enter a clock or a threshold. */
function finiteOr(v: number | undefined, fallback: number): number {
  return v !== undefined && Number.isFinite(v) ? v : fallback;
}

/**
 * Begin a concealment at `atS` (seconds). `breakBelowM` defaults to `CONCEAL_BREAK_M`;
 * a non-finite time is refused to `0` so the expiry clock cannot start from NaN.
 */
export function beginConcealment(o: { atS: number; breakBelowM?: number }): Concealment {
  return {
    active: true,
    startedAtS: finiteOr(o.atS, 0),
    revealOnAttack: true,
    breakBelowM: finiteOr(o.breakBelowM, CONCEAL_BREAK_M),
  };
}

/**
 * End a concealment for one of the four reasons. Pure and idempotent:
 *
 *   - an already-broken concealment is returned unchanged (a second break cannot un-break it);
 *   - a break that would PREDATE the concealment's own start is refused (`atS < startedAtS`),
 *     because a causally impossible event must not be allowed to corrupt the window;
 *   - an attack only reveals when `revealOnAttack` holds — the other three reasons always break.
 *
 * The returned object carries the same window (`startedAtS`, thresholds); only `active` flips.
 */
export function breakConcealment(c: Concealment, why: BreakReason, atS: number): Concealment {
  if (!c.active) return c;
  if (Number.isFinite(atS) && atS < c.startedAtS) return c;
  if (why === "attack" && !c.revealOnAttack) return c;
  return { ...c, active: false };
}

/**
 * The reason a concealment should end THIS frame, or `null` if it still holds. Checked in
 * the contract's order: a self-reveal by attacking or taking damage outranks the geometry,
 * and expiry (started `CONCEAL_MAX_S` ago) is the floor. Every input is a fact of one frame;
 * nothing is read from a clock here.
 */
export function breakReasonFor(c: Concealment, f: ConcealFrame): BreakReason | null {
  if (!c.active) return null;
  if (c.revealOnAttack && f.attacked === true) return "attack";
  if (f.damaged === true) return "damage";
  const d = f.distanceM;
  if (typeof d === "number" && Number.isFinite(d) && d <= c.breakBelowM) return "proximity";
  const atS = finiteOr(f.atS, c.startedAtS);
  if (atS - c.startedAtS >= CONCEAL_MAX_S) return "expired";
  return null;
}

/**
 * Advance a concealment one frame and return the new state. This is the ONE call the engine
 * makes each frame for a concealed seat:
 *
 *   concealment = stepConcealment(concealment, { atS, distanceM, attacked, damaged });
 *
 * It applies `breakReasonFor` through `breakConcealment`, so all four end conditions share
 * one tested path.
 */
export function stepConcealment(c: Concealment, f: ConcealFrame): Concealment {
  const why = breakReasonFor(c, f);
  return why ? breakConcealment(c, why, f.atS) : c;
}
