// Casts: the channel a strong power needs before its strike lands (Wave N, lane N-D).
// A cast has a DURATION (from the power, its element and the caster's statistics), a cast bar,
// and two ways it ends early: an INTERRUPT (a special power cancels it outright) and PUSHBACK
// (being hit by a weapon DELAYS it, scaled by the hit's own variables). Pure module: no DOM, no
// THREE, no Math.random. Times are seconds, angles are degrees, stamina is a raw pool value.
//
// Why a cast is NOT a stun (contrast with src/game/Status.ts): the `stunned` status DISABLES its
// victim — STATUS_DEFS.stunned.disables is true, canAct() returns false, and the fighter cannot
// move, attack or cast while it lasts. An interrupt does none of that: it only cancels the ONE
// cast that is in flight (interruptedBy records who did it); the caster keeps full control — it
// may immediately move, swing, or begin another cast. A stun is a condition ON the fighter; an
// interrupt is a verdict on a cast.

import { clamp, clamp01 } from "../core/MathCore.ts";

/** Shortest and longest a power may take to cast, s. Anything the inputs produce is clamped in. */
export const CAST_MIN_S = 0.35, CAST_MAX_S = 3.2;

/**
 * The element's weight on the channel, s-per-s. A heavier SCHOOL (arcane, necrotic, holy) reads a
 * longer, more deliberate channel than a fast one (fury, wind, poison). Unknown elements are
 * neutral (1.0), so a new element never crashes a cast. This is the "element" the user named.
 */
export const CAST_ELEMENT_MUL: Record<string, number> = {
  fire: 1.0, fury: 0.85, poison: 0.9, shadow: 0.95,
  arcane: 1.15, necrotic: 1.1, wind: 0.9, holy: 1.05,
};
/** Neutral element weight when the id is not in CAST_ELEMENT_MUL. */
export const CAST_ELEMENT_DEFAULT = 1.0;

/**
 * Willpower shortens the channel as 1 / (1 + willpower · gain): 0 Willpower is the identity, and
 * the term is strictly decreasing and always positive, so a high-Willpower caster (a Mage is 8,
 * a Necromancer 9) is reliably faster to cast while no amount of Willpower can reach zero. Units:
 * 1/point.
 */
export const CAST_WILL_GAIN = 0.03;

/**
 * Haste shortens the channel as 1 / (1 + hastePct / 100) — the standard haste convention, so 100%
 * haste halves the cast and the term stays positive for any finite haste. Units: 1/percent.
 */
export const CAST_HASTE_DIVISOR = 100;

/** A HEAVY power (a mage's big spell) channels this much longer than a light one. Unitless. */
export const CAST_HEAVY_MUL = 1.35;

/** The default channel base, s, per skill kind — the parent's starting point per skill. A power
 *  channels far longer than a dash; the caller may override with the power's own tuning. */
export const CAST_BASE_BY_KIND: Record<"dash" | "power" | "defense", number> = {
  dash: 0.9, power: 2.1, defense: 1.4,
};

const nonNeg = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);

/**
 * How long a power takes to cast, s. MULTIPLICATIVE and monotone:
 *   seconds = base · elementMul · (heavy ? CAST_HEAVY_MUL : 1) · 1/(1+will·g) · 1/(1+haste/100)
 * so it RISES with the power's `base`, FALLS with the caster's willpower and haste, and is
 * clamped into [CAST_MIN_S, CAST_MAX_S]. A non-finite or non-positive `base` falls back to the
 * floor rather than producing a negative or NaN channel.
 */
export function castSeconds(o: { base: number; willpower: number; hastePct: number; element: string; heavy: boolean }): number {
  const base = Number.isFinite(o.base) && o.base > 0 ? o.base : 0;
  const elem = CAST_ELEMENT_MUL[o.element] ?? CAST_ELEMENT_DEFAULT;
  const heavy = o.heavy ? CAST_HEAVY_MUL : 1;
  const will = 1 / (1 + nonNeg(o.willpower) * CAST_WILL_GAIN);
  const haste = 1 / (1 + nonNeg(o.hastePct) / CAST_HASTE_DIVISOR);
  return clamp(base * elem * heavy * will * haste, CAST_MIN_S, CAST_MAX_S);
}

/** A power's cast: what it is, how long, and whether it can be cancelled. */
export interface CastSpec {
  skillId: string;
  seconds: number;
  interruptible: boolean;
  breakOnMove: boolean;
}

/** Build a CastSpec: the duration from castSeconds, the flags defaulting to interruptible, no
 *  break-on-move. This is the call the parent makes to describe one power's cast. */
export function castSpec(o: {
  skillId: string;
  base: number;
  willpower: number;
  hastePct: number;
  element: string;
  heavy: boolean;
  interruptible?: boolean;
  breakOnMove?: boolean;
}): CastSpec {
  return {
    skillId: o.skillId,
    seconds: castSeconds(o),
    interruptible: o.interruptible ?? true,
    breakOnMove: o.breakOnMove ?? false,
  };
}

/**
 * A cast in flight. `elapsedS` is WALL-CLOCK seconds since it began (pushback does not rewind it);
 * `pushbackS` is the accumulated DELAY from hits taken, so the cast finishes when
 * elapsedS >= spec.seconds + pushbackS. `done` marks natural completion, `interruptedBy` names
 * whoever cancelled it (null = none). The two are mutually exclusive: an interrupt is not a done.
 */
export interface CastState {
  spec: CastSpec;
  elapsedS: number;
  pushbackS: number;
  done: boolean;
  interruptedBy: string | null;
}

/** Start a cast at t=0, with no pushback, un-ended. */
export function beginCast(spec: CastSpec): CastState {
  return { spec, elapsedS: 0, pushbackS: 0, done: false, interruptedBy: null };
}

/** Total wall-clock a cast needs at the current pushback, s: spec.seconds + pushbackS. */
export function totalCastSeconds(s: CastState): number {
  return nonNeg(s.spec.seconds) + Math.max(0, Number.isFinite(s.pushbackS) ? s.pushbackS : 0);
}

/**
 * Advance the cast by `dt` seconds (pure). A non-finite or negative `dt` is REFUSED: the state is
 * returned untouched, so a NaN frame can never complete or corrupt a cast. An already-ended cast
 * (done or interrupted) does not advance either. Completion is clamped at the total: once
 * elapsedS reaches spec.seconds + pushbackS, `done` is true and elapsedS keeps the wall clock.
 */
export function tickCast(s: CastState, dt: number): CastState {
  if (!Number.isFinite(dt) || dt < 0) return s;
  if (s.done || s.interruptedBy !== null) return s;
  const elapsedS = s.elapsedS + dt;
  const done = elapsedS >= totalCastSeconds(s);
  return { ...s, elapsedS, done };
}

/**
 * End the cast at once because `why` cancelled it (a special power, a move under breakOnMove, a
 * stun). Idempotent: an already-ended cast is returned as is. The cast is NOT done — it failed.
 */
export function interrupt(s: CastState, why: string): CastState {
  if (s.done || s.interruptedBy !== null) return s;
  return { ...s, interruptedBy: why, done: false };
}

// ─── Pushback: being hit delays the channel ───────────────────────────────────────────────────

/** Seconds of delay a FULL-health-share hit from dead ahead (0°) adds at unit stamina, light. */
export const PUSH_BASE_S = 0.4;
/** Hard ceiling of ONE hit's pushback, s (a single blow can never stall a cast beyond this). */
export const PUSH_MAX_S = 0.9;
/** Ceiling of the ACCUMULATED pushback on one cast, s: hits may delay a channel by at most this
 *  in total, so a stream of blows can never hold a cast open forever — it either finishes or is
 *  interrupted, never pinned past spec.seconds + PUSH_CAP_S. */
export const PUSH_CAP_S = 1.5;
/** Angle-weight at a hit square from the FRONT (0°): a frontal blow barely disrupts the aim. */
export const PUSH_ANGLE_MIN = 0.5;
/** Angle-weight at a hit square from BEHIND (180°): a backstab breaks the channel hardest. */
export const PUSH_ANGLE_MAX = 1.0;
/** Stamina-weight at zero stamina. */
export const PUSH_STAM_MIN = 0.85;
/** Stamina-weight once stamina is at (or above) PUSH_STAM_FULL. */
export const PUSH_STAM_MAX = 1.25;
/** The stamina value counted as "full" for the weight (the roster's pools sit in single digits). */
export const PUSH_STAM_FULL = 12;
/** A heavy weapon's hit adds this much more pushback than a light one. Unitless. */
export const PUSH_HEAVY_MUL = 1.4;

/**
 * Pushback one hit adds to a cast, s. Bounded and monotone in the hit's own variables:
 *   pushback = PUSH_BASE_S · damageShare · angleWeight(angleDeg) · staminaWeight(stamina)
 *              · (heavy ? PUSH_HEAVY_MUL : 1)   clamped to [0, PUSH_MAX_S]
 * `damageFracOfMax` is the hit's damage as a 0..1 share of the victim's max health (monotone up);
 * `angleDeg` is where the blow came from relative to the caster's facing, 0 = dead ahead and 180 =
 * directly behind, so a hit FROM BEHIND pushes back more (monotone up with the angle);
 * `stamina` is the STRIKER's pool — a fresh striker lands a harder shove. All inputs are clamped,
 * so no shape of nonsense produces a negative or unbounded delay.
 */
export function pushbackSeconds(o: { damageFracOfMax: number; angleDeg: number; stamina: number; heavy: boolean }): number {
  const dmg = clamp01(Number.isFinite(o.damageFracOfMax) ? o.damageFracOfMax : 0);
  const ang = clamp(Number.isFinite(o.angleDeg) ? o.angleDeg : 0, 0, 180);
  const angleWeight = PUSH_ANGLE_MIN + (PUSH_ANGLE_MAX - PUSH_ANGLE_MIN) * (ang / 180);
  const stamWeight = PUSH_STAM_MIN + (PUSH_STAM_MAX - PUSH_STAM_MIN) * clamp01(nonNeg(o.stamina) / PUSH_STAM_FULL);
  const heavyWeight = o.heavy ? PUSH_HEAVY_MUL : 1;
  return clamp(PUSH_BASE_S * dmg * angleWeight * stamWeight * heavyWeight, 0, PUSH_MAX_S);
}

/** Add `addS` seconds of pushback to a cast (pure). Bounded by PUSH_CAP_S in total; a non-finite
 *  or non-positive amount is ignored; an ended cast does not change. */
export function addPushback(s: CastState, addS: number): CastState {
  if (s.done || s.interruptedBy !== null) return s;
  const add = Number.isFinite(addS) && addS > 0 ? addS : 0;
  const pushbackS = Math.min(PUSH_CAP_S, s.pushbackS + add);
  return { ...s, pushbackS };
}

/** The whole answer to a landed hit: compute the pushback and apply it to the cast (pure). */
export function pushbackHit(s: CastState, o: { damageFracOfMax: number; angleDeg: number; stamina: number; heavy: boolean }): CastState {
  return addPushback(s, pushbackSeconds(o));
}

// ─── The cast bar's pure view model ───────────────────────────────────────────────────────────

/** What the cast bar draws: a label, the progress fraction, the pushback's share, and the state. */
export interface CastBarView {
  label: string;
  fraction: number;
  pushbackFraction: number;
  state: "cast" | "interrupted" | "done";
}

/**
 * The cast bar's numbers, a PURE function of the state — no DOM. `fraction` is the fill of the
 * whole track (elapsed / total, clamped to [0, 1]); `pushbackFraction` is the share of the track
 * that is delay (pushbackS / total); `state` is interrupted (takes precedence), done, or casting.
 * Total over any state: a NaN or negative spec.seconds falls back to CAST_MIN_S so the denominator
 * is never zero, and elapsed/pushback are clamped into range. `label` names the power and its
 * nominal channel length, e.g. "mage-arcane-nova · 2.6s".
 */
export function castBarView(s: CastState): CastBarView {
  const total = (Number.isFinite(s.spec.seconds) && s.spec.seconds > 0 ? s.spec.seconds : CAST_MIN_S) +
    Math.max(0, Number.isFinite(s.pushbackS) ? s.pushbackS : 0);
  const elapsed = clamp(Number.isFinite(s.elapsedS) ? s.elapsedS : 0, 0, total);
  const pushback = Math.max(0, Number.isFinite(s.pushbackS) ? s.pushbackS : 0);
  const state: CastBarView["state"] = s.interruptedBy !== null ? "interrupted" : s.done ? "done" : "cast";
  const secs = Number.isFinite(s.spec.seconds) && s.spec.seconds > 0 ? s.spec.seconds : CAST_MIN_S;
  return {
    label: `${s.spec.skillId} · ${secs.toFixed(1)}s`,
    fraction: clamp01(elapsed / total),
    pushbackFraction: clamp01(pushback / total),
    state,
  };
}
