// Wave J (lane J-B): the match rules the headless simulator plays by, as ONE knob object, so a
// "before" (the live engine's rules today) and an "after" (the lane's fixes) can be measured
// side by side on the same seeds. Every formula here is the engine's, written out pure; the
// fixes are the deltas the parent wires into Engine.ts (docs/arena/wave-J-B-engine-notes.md).
//
// Pure module: no THREE, no DOM, no Math.random.

import { levelScale } from "../game/Stats.ts";

/** How the time limit ends a bout nobody finished. */
export type TimeLimitRule = "tie" | "judge";

export interface MatchRules {
  /** Apply Stats.applyLevel (health and attack power grow 3 %/level). Engine today: off. */
  levelGrowth: boolean;
  /**
   * Knockback meter at 0 % damage: speed = base · (floor + percent / KNOCKBACK_PERCENT).
   * Engine today: 1 (a fresh fighter takes the full base push).
   */
  knockbackFloor: number;
  /** Scale knockback by levelScale(attacker) / levelScale(defender) (poise). Engine today: off. */
  levelPoise: boolean;
  /** At the limit: "tie" (engine today) or "judge" (MatchControl.judgeTimeLimit). */
  timeLimit: TimeLimitRule;
  /**
   * Every AI refuses a step (or a skill lunge) that would carry it past an OPEN rim (a wall of any
   * height already stops walking). Engine today: off — the default tree's "near the edge -> retreat"
   * walks a bot straight off an open edge when the enemy stands between it and the centre.
   */
  walkOffGuard: boolean;
  /**
   * Body-body separation shares the overlap by MASS (the lighter body gives way): Engine today
   * splits it 50/50, so a 70 kg fighter walking into a 170 kg one shoves it as far as it moves
   * itself — enough to sumo a heavy fighter out of a 2–3 m closet.
   */
  massPush: boolean;
  /**
   * The knockback meter counts the share of the defender's OWN health lost: percent += METER_FULL ·
   * damage / maxHealth (METER_FULL = 360 % at 0 HP, the engine's rate for a 45 k pool). Engine
   * today: absolute, percent += damage / DAMAGE_SCALE · 0.8 — a 94 k fighter that lost 3.7 % of its
   * health reads 28 %, as throwable as a 40 k fighter that lost 8 %.
   */
  relativeMeter: boolean;
}

/** The rules the live engine plays by at the start of Wave J (measured "before"). */
export const ENGINE_RULES: Readonly<MatchRules> = { levelGrowth: false, knockbackFloor: 1, levelPoise: false, timeLimit: "tie", walkOffGuard: false, massPush: false, relativeMeter: false };

/**
 * The lane's fixes (measured "after"). Each one closes a way a weak fighter beat a strong one;
 * docs/arena/lane-J-B.md lists the before/after numbers per fix (leave-one-out ablation). Two
 * candidates are deliberately OFF: levelPoise (neutral once the floor and the relative meter are
 * in) and walkOffGuard (on the engine's default tree it turns "near the edge -> retreat" into
 * standing at the rim: basic-vs-basic time-outs 13 -> 228 of 600; it belongs with the edge tree,
 * whose "full" brain guards its own steps).
 */
export const WAVE_J_RULES: Readonly<MatchRules> = { levelGrowth: true, knockbackFloor: 0.35, levelPoise: false, timeLimit: "judge", walkOffGuard: false, massPush: true, relativeMeter: true };

// ─── Knockback (Engine.#resolveHit, contact path) ─────────────────────────────────────────────

/** Engine: a blow's physical Δv × KNOCKBACK_GAIN lands in the old 1.2–3.6 m/s band. */
export const KNOCKBACK_GAIN = 6;
/** Engine: the push from one blow is capped here BEFORE the meter scales it, m/s. */
export const KNOCKBACK_MAX = 4;
/** Engine: the meter term, (1 + percent / 60). */
export const KNOCKBACK_PERCENT = 60;
/** Engine: each blow adds (damage / DAMAGE_SCALE) · 0.8 to the defender's damage percent. */
export const PERCENT_PER_DAMAGE_UNIT = 0.8;
/** rules.relativeMeter: the percent a fighter reads at 0 HP (= the engine's rate on a 45 k pool). */
export const METER_FULL = 360;

/** The knockback-meter increment of one blow, by the rules. */
export function meterGain(rules: MatchRules, damage: number, defenderMaxHealth: number, damageScale: number): number {
  const d = Number.isFinite(damage) ? Math.max(0, damage) : 0;
  const v = rules.relativeMeter
    ? (METER_FULL * d) / Math.max(1, defenderMaxHealth)
    : (d / Math.max(1e-9, damageScale)) * PERCENT_PER_DAMAGE_UNIT;
  return Number.isFinite(v) ? v : 0;
}

/**
 * The headless stand-in for Impact.resolveStrike's impulse: J ≈ JK · impact · MOMENTUM_REF · s(str),
 * Δv = J / m_defender. JK folds the restitution, transfer and the planted defender's footing
 * (Impact: k = guard · (1 − 0.5 · balance)); calibrated so a 1.2-impact longsword on an 80 kg body
 * pushes ~2 m/s after the gain, the middle of the engine's 1.2–3.6 band.
 */
export const IMPULSE_K = 2.5;
export const MOMENTUM_REF = 9;

/** Attacker strength's share of the swing's effective mass: saturating, 0.7 at STR 0 → 1.3. */
export function strengthFactor(strength: number): number {
  const s = Number.isFinite(strength) ? Math.max(0, strength) : 0;
  return 0.7 + 0.6 * (1 - Math.exp(-s / 12));
}

/**
 * Knockback speed of one blow, m/s, by the rules:
 *   v = min(KNOCKBACK_MAX, GAIN · J / m_def) · (floor + percent / 60) · skillMul · poise
 *   poise = levelScale(attacker) / levelScale(defender)   (only with rules.levelPoise)
 */
export function knockbackSpeed(
  rules: MatchRules,
  impact: number,
  attackerStrength: number,
  defenderMass: number,
  defenderPercent: number,
  attackerLevel: number,
  defenderLevel: number,
  skillMul = 1,
): number {
  const J = IMPULSE_K * Math.max(0, impact) * MOMENTUM_REF * strengthFactor(attackerStrength);
  const dv = Math.min(KNOCKBACK_MAX, (KNOCKBACK_GAIN * J) / Math.max(20, defenderMass));
  const meter = rules.knockbackFloor + Math.max(0, defenderPercent) / KNOCKBACK_PERCENT;
  const poise = rules.levelPoise ? levelScale(attackerLevel) / levelScale(defenderLevel) : 1;
  const v = dv * meter * Math.max(0, skillMul) * poise;
  return Number.isFinite(v) ? v : 0;
}

// ─── Gear tier (no engine equivalent yet: a proposal the parent wires with Items) ─────────────

/**
 * Gear quality q (FighterSpec.weapon.quality, 0..1) as the simulator prices it — the engine has no
 * gear tier today, so this is the rule the batch measures and proposes:
 *   weapon damage × (0.75 + 0.5 q)   (worn 0.75 … masterwork 1.25)
 *   accuracy + 0.08 (q − 0.5)          (clamped 0.05..0.98)
 *   armour + 2.5 q                     (a worn tunic adds nothing, plate adds 2.5 rating)
 * and Resources' regen × (1 + 0.1 q).
 */
export const GEAR = { damageLo: 0.75, damageSpan: 0.5, accuracySpan: 0.08, armour: 2.5 } as const;

const q01 = (q: number) => Number.isFinite(q) ? Math.max(0, Math.min(1, q)) : 0;
export function gearDamageMul(q: number): number { return GEAR.damageLo + GEAR.damageSpan * q01(q); }
export function gearAccuracy(accuracy: number, q: number): number {
  return Math.max(0.05, Math.min(0.98, accuracy + GEAR.accuracySpan * (q01(q) - 0.5)));
}
export function gearArmour(q: number): number { return GEAR.armour * q01(q); }
