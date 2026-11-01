// ComboTable: which power sets up which (Wave S, lane S-A).
//
// The user asked for combos that "can be beneficial but not all the classes should have
// everything". Two tables answer that:
//
//   1. COMBOS — a power cast AFTER another earns a bonus. A combo only ever reads two powers that
//      actually exist (the test asserts every id in the table is in Skills.POWERS), so a renamed
//      power cannot leave a dangling bonus.
//   2. EXCLUSIONS — a (class, shape) pair a class must NOT have. Each class repeats its signature
//      shape and therefore LACKS one of the five: "not all classes have everything" is a tested
//      property, not a claim.
//
// Pure module: no DOM, no THREE, no Math.random. The multipliers are unitless shares.

import type { ClassName } from "./Stats.ts";
import type { PowerShape } from "./PowerCost.ts";

/** One beneficial pairing: `from` then `then` pays off. */
export interface Combo {
  /** The power that must be cast FIRST — an id in Skills.POWERS. */
  from: string;
  /** The power cast NEXT, which collects the bonus — an id in Skills.POWERS. */
  then: string;
  /** Damage multiplier the follow-up gains (>= 1 = a bonus). Unitless. */
  damageMul: number;
  /** Cast-time multiplier for the follow-up (< 1 = a faster channel out of the combo). Unitless. */
  castMul: number;
  /** Why the pairing reads — the archetype story, no units (it is prose). */
  why: string;
}

/**
 * The stated combos. A control effect (a cone that knocks them together, a stomp that roots them,
 * a vanish that hides the wound-up blow) sets up the heavier strike. Every entry names two real
 * power ids; the coverage test fails if one does not exist.
 */
export const COMBOS: readonly Combo[] = [
  { from: "mage-force-cone",       then: "mage-fireball",          damageMul: 1.30, castMul: 0.85, why: "the force cone gathers them into the fireball's path" },
  { from: "mage-mana-ward",        then: "mage-frostbolt",         damageMul: 1.15, castMul: 0.90, why: "casting from behind the ward, the bolt channels faster" },
  { from: "assassin-vanish",       then: "assassin-mark-and-execute", damageMul: 1.45, castMul: 0.85, why: "the strike lands from concealment on a marked throat" },
  { from: "assassin-sprint",       then: "assassin-killing-spree",  damageMul: 1.20, castMul: 0.90, why: "the sprint closes the ring before the spree opens" },
  { from: "rogue-sprint",          then: "rogue-backstab",          damageMul: 1.30, castMul: 0.90, why: "the sprint turns into the flank the backstab needs" },
  { from: "rogue-throw-knife",     then: "rogue-eviscerate",        damageMul: 1.25, castMul: 0.90, why: "the thrown knife staggers them into dagger range" },
  { from: "warrior-shield-bash",   then: "warrior-whirlwind",       damageMul: 1.25, castMul: 0.90, why: "the bash stuns the guard open for the whirlwind" },
  { from: "barbarian-war-stomp",   then: "barbarian-skull-crush",   damageMul: 1.35, castMul: 0.85, why: "the stomp roots them for the overhead crush" },
  { from: "barbarian-blood-roar",  then: "barbarian-reaver-gore",   damageMul: 1.20, castMul: 0.90, why: "the roar winds the reaver into the gore" },
  { from: "necro-plague-cloud",    then: "necro-death-pulse",       damageMul: 1.30, castMul: 0.90, why: "the plague softens them for the pulse" },
  { from: "archer-snare-arrow",    then: "archer-piercing-shot",    damageMul: 1.35, castMul: 0.85, why: "the snare pins them for the drawn shot" },
  { from: "priest-sanctuary",      then: "priest-holy-nova",        damageMul: 1.20, castMul: 0.90, why: "the consecrated ground feeds the nova" },
];

/** One forbidden (class, shape) pair — a shape this class must NOT own. */
export interface Exclusion {
  className: ClassName;
  shape: PowerShape;
  /** Why the class is denied the shape — archetype prose. */
  why: string;
}

/**
 * The stated exclusions: each class repeats one signature shape and so lacks another. Read as
 * "not all classes have everything".
 */
export const EXCLUSIONS: readonly Exclusion[] = [
  { className: "Barbarian",   shape: "projectile", why: "a barbarian closes the gap with his body, never a throwing arm" },
  { className: "Warrior",     shape: "projectile", why: "a warrior's shield is the answer at range, not a missile" },
  { className: "Rogue",       shape: "aura",       why: "a rogue wards no ground; he only wards himself" },
  { className: "Assassin",    shape: "aura",       why: "an assassin holds no ground — he is gone before it matters" },
  { className: "Mage",        shape: "instant",    why: "a mage never strikes with the body; every blow is a channel" },
  { className: "Necromancer", shape: "instant",    why: "a necromancer reaches through the dead, never the fist" },
  { className: "Archer",      shape: "aura",       why: "an archer owns the lane, not a circle" },
  { className: "Priest",      shape: "instant",    why: "a priest's power is a channel of light, never a melee lunge" },
];

/** Is `shape` allowed for `className`? (False only for a stated exclusion.) */
export function shapeAllowedFor(className: ClassName, shape: PowerShape): boolean {
  return !EXCLUSIONS.some((e) => e.className === className && e.shape === shape);
}

/** The combo bonus a power collects when cast after `from`, or null when the pair is not stated. */
export function comboBonus(from: string, then: string): Combo | null {
  return COMBOS.find((c) => c.from === from && c.then === then) ?? null;
}
