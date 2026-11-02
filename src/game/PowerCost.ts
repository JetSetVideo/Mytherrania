// PowerCost: the ONE law behind every class power (Wave S, lane S-A).
//
// The user asked that a power's power/duration/cost be "related to the weapons the statistics of
// the characters … the most powerful spell, they can take time to cast and the duration and power
// is depending on all the factors". So there is exactly ONE place that turns (shape, element, the
// caster's own six attributes, the equipped weapon) into the five numbers a power needs:
//
//   amplitude   powerOf            — the damage multiplier the strike carries
//   cast time   castSecondsOf      — the channel before the release (delegates to Cast.castSeconds)
//   mana        manaCostOf         — what the cast spends (a smarter caster pays less)
//   cooldown    cooldownSecondsOf  — how long before another cast (quicker caster recovers sooner)
//   duration    durationSecondsOf  — how long an aura / self-buff holds
//
// No power in Skills.ts carries a hard-coded amplitude, cast time, mana cost or cooldown: each is
// `derivePower(spec, casterStats, weapon)`. A change to a single attribute or to the weapon MOVES
// every number, and the test asserts it (a hard-coded amplitude fails the derivation check).
//
// Why the element weight for the CAST is NOT redefined here: Cast.ts already owns
// CAST_ELEMENT_MUL (Wave N); this module reuses castSeconds so the channel law stays single-sourced,
// exactly the user's "it's already somewhere else". The element's own weight on the STRIKE
// (POWER_ELEMENT_MUL) is new here because nothing priced element -> amplitude before.
//
// Pure module: no DOM, no THREE, no Math.random. Units: seconds (s), the rest unitless shares.

import { castSeconds } from "./Cast.ts";
import { clamp } from "../core/MathCore.ts";
import type { CombatStats } from "./Stats.ts";
import type { Weapon } from "./Weapon.ts";

// ─── The vocabulary: what a power IS ─────────────────────────────────────────────────────────

/** How a power delivers its effect — the user's "some are like direct shots". Drives the
 *  animation and the cost row. */
export type PowerShape = "instant" | "projectile" | "cone" | "aura" | "self-buff";

/** All shapes, so a coverage test can demand each is used at least once. */
export const POWER_SHAPES: readonly PowerShape[] = ["instant", "projectile", "cone", "aura", "self-buff"];

/** The caster's own six attributes (Stats.PRIMARY). One of them is the SCALE of a power. */
export type AttributeName = "vitality" | "resilience" | "focus" | "reflex" | "strength" | "intelligence" | "agility";
export const ATTRIBUTES: readonly AttributeName[] = ["vitality", "resilience", "focus", "reflex", "strength", "intelligence", "agility"];

/** Which physical property of the equipped weapon a power reads. One per power. */
export type WeaponInput = "weight" | "balance" | "sharpness" | "damage" | "reach" | "knockback";
export const WEAPON_INPUTS: readonly WeaponInput[] = ["weight", "balance", "sharpness", "damage", "reach", "knockback"];

/** The two inputs a power declares it scales from. */
export interface PowerScale {
  attribute: AttributeName;
  weapon: WeaponInput;
}

// ─── The shape's own base row (the parent's starting point per shape) ───────────────────────────

/** Everything a shape contributes before the caster and the weapon are priced in. */
export interface ShapeBase {
  /** Amplitude at a unit attribute and a reference weapon. Unitless damage multiplier. */
  amplitude: number;
  /** Cast base handed to Cast.castSeconds, s. */
  castBase: number;
  /** Does the shape channel as a HEAVY power (Cast.CAST_HEAVY_MUL)? Aura is a slow ward. */
  heavy: boolean;
  /** Base hold length of an aura / self-buff, s (0 = a strike, holds nothing). */
  duration: number;
  /** Base mana at neutral element and zero intelligence. */
  mana: number;
  /** Base cooldown at zero reflex, s. */
  cooldown: number;
  /** Stun this shape lands on hit, s. A self-buff strikes nothing. */
  stun: number;
  /** Knockback multiplier at a unit weapon weight. */
  knockback: number;
}

/**
 * The five shape rows. A heavier shape (a cone, an aura) channels longer, costs more mana and waits
 * longer on cooldown — the user's "you have to wait longer with another cast". A light shape
 * (an instant) is cheap and fast but carries less amplitude.
 */
/**
 * The reconciled shape table (wave S). Two advocates wrote against each other in docs/systems/COST-A.md
 * (expensive and impactful) and docs/systems/COST-B.md (cheap and frequent); the parent ruled on the
 * MEASUREMENTS, not on either tone:
 *
 *   - S-D zeroed the power's mana at runtime and measured the game's own wave-Q scoreboard: the weighted
 *     score stayed flat (0.8052 -> 0.8060) while closeness rose 0.621 -> 0.717 and the median fell
 *     38.25 -> 31.83 s. So MANA is nearly inert as a lever, and S-D wins the mana question.
 *   - S-D also declared the honest negative: the grid cells cast NOTHING at any price, so no cost change
 *     can move their 33 % timeout share - that stall is a strategy/arena problem, not a cost one.
 *   - S-C won the TIME question: the cast is what actually limits casts, and its own batch shows casting
 *     more neither raises KO share (0.29 -> 0.17) nor makes fights decisive, so time must be spent on the
 *     shapes that earn it.
 *
 * Hence: mana comes DOWN to S-D's curve (a flavour tax, not the gate), cast time stays the lever and is
 * RAISED on the heavy shapes (cone/aura), and the cooldown - "you have to wait longer with another cast" -
 * keeps a shape-ordered ladder. Amplitude, stun and knockback are S-A's, unmeasured by either advocate.
 */
export const SHAPE_BASE: Record<PowerShape, ShapeBase> = {
  instant:     { amplitude: 1.15, castBase: 0.45, heavy: false, duration: 0, mana: 4,  cooldown: 4.0,  stun: 0.30, knockback: 1.4 },
  projectile:  { amplitude: 1.30, castBase: 0.75, heavy: false, duration: 0, mana: 8,  cooldown: 6.0,  stun: 0.20, knockback: 1.6 },
  cone:        { amplitude: 1.55, castBase: 1.45, heavy: false, duration: 0, mana: 12, cooldown: 8.0,  stun: 0.45, knockback: 1.3 },
  aura:        { amplitude: 0.95, castBase: 1.60, heavy: true,  duration: 6, mana: 10, cooldown: 10.0, stun: 0.15, knockback: 1.0 },
  "self-buff": { amplitude: 0.70, castBase: 0.90, heavy: false, duration: 8, mana: 8,  cooldown: 12.0, stun: 0.00, knockback: 0.6 },
};

// ─── The amplitude law: shape × attribute × weapon × element ─────────────────────────────────────

/** Amplitude at zero of the scaling attribute. Never zero — a power still lands on a weak caster. */
export const ATTR_FLOOR = 0.55;
/** How much one point of the scaling attribute adds to the amplitude. Unitless per point. */
export const ATTR_GAIN = 0.09;

/** The attribute's weight on the amplitude. Strictly rising, floored, finite for any input. */
export function attributeFactor(value: number): number {
  const v = Number.isFinite(value) ? Math.max(0, value) : 0;
  return ATTR_FLOOR + v * ATTR_GAIN;
}

/** The "average weapon" value of each input, so an input is priced against its own scale. */
export const WEAPON_REF: Record<WeaponInput, number> = {
  weight: 5, balance: 0.5, sharpness: 0.6, damage: 10, reach: 1.7, knockback: 1.0,
};

/** The weapon's weight on the amplitude, 1.0 at the reference weapon and clamped in [0.3, 2.0]. */
export function weaponFactor(input: WeaponInput, value: number): number {
  const v = Number.isFinite(value) ? Math.max(0, value) : 0;
  return clamp(0.55 + 0.45 * (v / WEAPON_REF[input]), 0.3, 2.0);
}

/** The element's weight on the STRIKE (the channel weight lives in Cast.CAST_ELEMENT_MUL). */
export const POWER_ELEMENT_MUL: Record<string, number> = {
  fire: 1.05, fury: 1.10, poison: 0.95, shadow: 1.00,
  arcane: 1.02, necrotic: 1.05, wind: 0.95, holy: 1.00,
};
/** Neutral strike weight when the element id is unknown, so a new element never crashes a power. */
export const POWER_ELEMENT_DEFAULT = 1.0;

/** The strike's damage multiplier: shape · attribute · weapon · element. Pure and finite. */
export function powerOf(o: {
  shape: PowerShape;
  element: string;
  attributeValue: number;
  weapon: WeaponInput;
  weaponValue: number;
}): number {
  const base = SHAPE_BASE[o.shape].amplitude;
  const elem = POWER_ELEMENT_MUL[o.element] ?? POWER_ELEMENT_DEFAULT;
  return base * attributeFactor(o.attributeValue) * weaponFactor(o.weapon, o.weaponValue) * elem;
}

// ─── The channel law: reuse Cast.castSeconds ─────────────────────────────────────────────────────

/** Seconds the power takes to channel before its release. Delegates to the Wave N cast law, so the
 *  focus gain, the element weight and the clamps stay single-sourced. */
export function castSecondsOf(o: { shape: PowerShape; element: string; focus: number; hastePct: number }): number {
  const row = SHAPE_BASE[o.shape];
  return castSeconds({ base: row.castBase, focus: o.focus, hastePct: o.hastePct, element: o.element, heavy: row.heavy });
}

// ─── The mana law: a smarter caster pays less ────────────────────────────────────────────────────

/** Mana discount per point of intelligence. 1/point, diminishing (1 / (1 + int·g)). */
export const MANA_INT_DISCOUNT = 0.025;

/** Mana the cast spends, at least 1 (no power is free — the user's "doing an action is already some
 *  cost"). Rises with the shape's weight and the element, falls with the caster's intelligence. */
export function manaCostOf(o: { shape: PowerShape; element: string; intelligence: number }): number {
  const base = SHAPE_BASE[o.shape].mana;
  const elem = POWER_ELEMENT_MUL[o.element] ?? POWER_ELEMENT_DEFAULT;
  const int = Number.isFinite(o.intelligence) ? Math.max(0, o.intelligence) : 0;
  const discount = 1 / (1 + int * MANA_INT_DISCOUNT);
  return Math.max(1, Math.round(base * elem * discount));
}

// ─── The cooldown law: a quicker caster recovers sooner ──────────────────────────────────────────

/** Cooldown reduction per point of reflex. 1/point, diminishing. */
export const CD_REFLEX_GAIN = 0.02;

/** Seconds before another cast of this power. Rises with the shape's weight, falls with reflex. */
export function cooldownSecondsOf(o: { shape: PowerShape; reflex: number }): number {
  const base = SHAPE_BASE[o.shape].cooldown;
  const r = Number.isFinite(o.reflex) ? Math.max(0, o.reflex) : 0;
  return Math.round(base / (1 + r * CD_REFLEX_GAIN) * 100) / 100;
}

// ─── The duration law: an aura / self-buff holds longer for a stronger will ───────────────────────

/** Duration gain per point of focus. 1/point. */
export const DURATION_WILL_GAIN = 0.02;

/** Seconds an aura / self-buff holds; 0 for a shape that holds nothing. */
export function durationSecondsOf(o: { shape: PowerShape; focus: number }): number {
  const base = SHAPE_BASE[o.shape].duration;
  if (base === 0) return 0;
  const w = Number.isFinite(o.focus) ? Math.max(0, o.focus) : 0;
  return Math.round(base * (1 + w * DURATION_WILL_GAIN) * 100) / 100;
}

// ─── The one call a power makes: the whole derivation from stats + weapon ─────────────────────────

/** The five derived numbers a power carries, plus the two payload numbers that read the shape. */
export interface PowerDerivation {
  amplitude: number;
  castSeconds: number;
  durationSeconds: number;
  manaCost: number;
  cooldownSeconds: number;
  stun: number;
  knockbackMul: number;
}

/**
 * Derive a power's every number from the caster's OWN statistics and the equipped weapon. This is
 * the single entry point Skills.ts calls; the granular `powerOf` / `castSecondsOf` / `manaCostOf` /
 * `cooldownSecondsOf` are its parts, exported so a test can recompute each one and prove the power
 * carries no hard-coded value.
 */
export function derivePower(o: {
  shape: PowerShape;
  element: string;
  scale: PowerScale;
  stats: CombatStats;
  weapon: Weapon;
  hastePct?: number;
}): PowerDerivation {
  const attributeValue = o.stats[o.scale.attribute];
  const weaponValue = o.weapon[o.scale.weapon];
  return {
    amplitude: powerOf({ shape: o.shape, element: o.element, attributeValue, weapon: o.scale.weapon, weaponValue }),
    castSeconds: castSecondsOf({ shape: o.shape, element: o.element, focus: o.stats.focus, hastePct: o.hastePct ?? 0 }),
    durationSeconds: durationSecondsOf({ shape: o.shape, focus: o.stats.focus }),
    manaCost: manaCostOf({ shape: o.shape, element: o.element, intelligence: o.stats.intelligence }),
    cooldownSeconds: cooldownSecondsOf({ shape: o.shape, reflex: o.stats.reflex }),
    stun: SHAPE_BASE[o.shape].stun,
    knockbackMul: SHAPE_BASE[o.shape].knockback * weaponFactor("weight", o.weapon.weight),
  };
}

// ─── The single resource table ────────────────────────────────────────────────────────────────────

/**
 * What each technique KIND costs to start: a dash is pure stamina, a power spends both mana and
 * stamina, a defence is mostly stamina. THE one definition: src/engine/Engine.ts re-exports this
 * (the file once carried its own copy, and src/balance/MatchSim.ts another — the user's "it's
 * already somewhere else"). Values match the Wave J pass the user asked for: a power costs 20%
 * more mana than the balance table's 20 (→ 24), a defence 5 → 6, a dash no mana at all.
 */
export const SKILL_RESOURCE_COST: Record<string, { mana: number; stamina: number }> = {
  dash: { mana: 0, stamina: 12 },
  power: { mana: 24, stamina: 8 },
  defense: { mana: 6, stamina: 12 },
};
