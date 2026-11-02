// Wave X lane L: the perturbation harness behind tests/wave_x_influence_test.ts and
// tools/gen-wave-x-logic.ts — every INFLUENCES `to` node measured through the function the game
// itself calls, and every `from` perturbed the way the game perturbs it.
import { ATTRIBUTE_NODES, type Influence } from "../src/game/Influence.ts";
import { applyLevel, attackDamage, CLASSES, createStats, criticalChance, type ClassName, type CombatStats } from "../src/game/Stats.ts";
import { applyRaceBonus, statDelta, type StatName } from "../src/game/Races.ts";
import { dashMul, dodgeDivisor, effectiveAgility, moveSpeedMul, turnRateMul } from "../src/game/Agility.ts";
import { motionStyleFor, type StyleCoeffs } from "../src/game/anim/MotionStyle.ts";
import { castFocus, derivePower, manaIntelligence, type AttributeName } from "../src/game/PowerCost.ts";
import { powerTailSeconds } from "../src/game/Skills.ts";
import { CAST_BASE_BY_KIND, castSeconds, pushbackSeconds } from "../src/game/Cast.ts";
import { resourceRates } from "../src/game/Resources.ts";
import { knockbackSpeed, WAVE_J_RULES } from "../src/balance/MatchRules.ts";
import { bodyFromStats, totalMass } from "../src/game/Physics.ts";
import { weaponForClass } from "../src/game/Weapon.ts";
import { budgetForLevel, spendBudget } from "../src/game/SpectateGen.ts";


export const BASE = createStats("Warrior");
const WEAPON = weaponForClass("Warrior");
const REF = createStats("Barbarian");

function style(s: CombatStats) {
  return motionStyleFor({ race: "human", seed: 3, stats: s });
}

/** Every `to` node, measured on a stat block through the function the game itself calls. */
const PROBE: Record<string, (s: CombatStats) => number> = {
  maxHealth: (s) => s.maxHealth,
  attackPower: (s) => s.attackPower,
  armor: (s) => s.armor,
  attackInterval: (s) => s.attackInterval,
  // Crit is clamped to [0.03, 0.15]: probe it off the clamps (a tough defender / a slow attacker).
  critChance: (s) => criticalChance(s.reflex, 20),
  critTaken: (s) => criticalChance(2, s.resilience),
  damageTaken: (s) => attackDamage(REF, s, 0.99, 0.5),
  bodyMass: (s) => totalMass(bodyFromStats(s)),
  knockback: (s) => knockbackSpeed(WAVE_J_RULES, 1, s.strength, 70, 0, 1, 1),
  "agility.effective": (s) => effectiveAgility(s),
  moveSpeed: (s) => moveSpeedMul(s),
  turnRate: (s) => turnRateMul(s),
  dashDistance: (s) => dashMul(s),
  dodge: (s) => dodgeDivisor(s),
  manaMax: (s) => resourceRates(s).manaMax,
  manaRegen: (s) => resourceRates(s).manaRegen,
  staminaMax: (s) => resourceRates(s).staminaMax,
  staminaRegen: (s) => resourceRates(s).staminaRegen,
  "anim.jitter": (s) => style(s).jointJitter.reduce((a, v) => a + Math.abs(v), 0),
  "technique.castSeconds": (s) => derivePower({ shape: "cone", element: "arcane", scale: { attribute: "intelligence", weapon: "reach" }, stats: s, weapon: WEAPON }).castSeconds,
  "technique.duration": (s) => derivePower({ shape: "aura", element: "holy", scale: { attribute: "focus", weapon: "balance" }, stats: s, weapon: WEAPON }).durationSeconds,
  // Mana is rounded to whole points: a big step below (STEP_FOR) makes the change visible.
  "technique.manaCost": (s) => derivePower({ shape: "cone", element: "arcane", scale: { attribute: "intelligence", weapon: "reach" }, stats: s, weapon: WEAPON }).manaCost,
  "technique.cooldown": (s) => derivePower({ shape: "cone", element: "arcane", scale: { attribute: "intelligence", weapon: "reach" }, stats: s, weapon: WEAPON }).cooldownSeconds,
  "technique.recoveryTail": (s) => powerTailSeconds(s),
  "cast.channel": (s) => castSeconds({ base: CAST_BASE_BY_KIND.power, focus: castFocus(s), hastePct: 0, element: "arcane", heavy: true }),
  "cast.pushback": (s) => pushbackSeconds({ damageFracOfMax: 0.2, angleDeg: 90, stamina: 6, heavy: false, agility: effectiveAgility(s) }),
  "focus.cast": (s) => castFocus(s),
  "intelligence.mana": (s) => manaIntelligence(s),
};
for (const a of ATTRIBUTE_NODES) {
  PROBE[`technique.amplitude[${a}]`] = (s) =>
    derivePower({ shape: "self-buff", element: "wind", scale: { attribute: a as AttributeName, weapon: "weight" }, stats: s, weapon: WEAPON }).amplitude;
}
export function probe(to: string): (s: CombatStats) => number {
  if (to.startsWith("anim.") && to !== "anim.jitter") {
    const k = to.slice(5) as keyof StyleCoeffs;
    return (s) => style(s).base[k];
  }
  const p = PROBE[to];
  if (!p) throw new Error(`no probe for "${to}"`);
  return p;
}
const STEP_FOR: Record<string, number> = { "technique.manaCost": 16, critChance: 1 };

/** An attribute perturbation: +k primary points spent through statDelta, exactly as Engine.#applySpend does. */
export function spend(s: CombatStats, attr: string, k: number): CombatStats {
  const d = statDelta({ [attr]: k } as Partial<Record<StatName, number>>);
  const out = { ...s };
  for (const [key, v] of Object.entries(d)) if (typeof v === "number") (out as Record<string, number>)[key] += v;
  return out;
}

const mean = (f: (c: ClassName) => number) => CLASSES.reduce((a, c) => a + f(c), 0) / CLASSES.length;

/** The signed change of `to` when `from` is perturbed (a down source is compared against its baseline). */
export function delta(e: Influence): number {
  const [kind, id] = e.from.includes(":") ? e.from.split(":") : [e.from, ""];
  const attr = e.to as StatName;
  switch (kind) {
    case "class": return createStats(id as ClassName)[attr] - mean((c) => createStats(c)[attr]);
    case "race": return applyRaceBonus(BASE, id, null)[attr] - BASE[attr];
    case "subrace": {
      const [race, sub] = id.split("/");
      return applyRaceBonus(BASE, race, sub)[attr] - applyRaceBonus(BASE, race, null)[attr];
    }
    case "birthsign": return applyRaceBonus(BASE, "human", null, id)[attr] - applyRaceBonus(BASE, "human", null)[attr];
    case "level": {
      if (e.to === "maxHealth") return applyLevel(BASE, 10).maxHealth - applyLevel(BASE, 1).maxHealth;
      const rng = (seed: number) => { let a = seed >>> 0; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296); };
      return spendBudget(budgetForLevel(10), "Assassin", rng(5))[attr] - spendBudget(budgetForLevel(1), "Assassin", rng(5))[attr];
    }
    default: {
      const p = probe(e.to), k = STEP_FOR[e.to] ?? 3;
      return p(spend(BASE, e.from, k)) - p(BASE);
    }
  }
}

