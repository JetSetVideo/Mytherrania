// Wave J (lane J-B): FighterSpec -> the numbers a fighter fights with, following the live
// pipeline step for step so the headless simulator measures the game that is played:
//
//   createStats(class)                                   Stats.ts (class primaries -> combat)
//   applyRaceBonus(race, sub-race, birthsign)            Races.ts (Fighter.createFighter)
//   applySecondary(sub-race, birthsign)                  SecondaryStats.ts (Fighter.createFighter)
//   + statDelta(allocated), clamped to the window        Engine.#applySpend (Wave H)
//   applyLevel(level)               [rules.levelGrowth]  Stats.ts (Wave J fix)
//   gear quality: armour + weapon damage/accuracy        MatchRules.GEAR (proposal, no engine twin)
//   weapon: resolveWeapon(class, type, seed) -> combatProfile    weapons/Loadout + Profile
//   resources: createResources(stats, {race, sub-race, gear})    Resources.ts (Wave J)
//
// Pure module: no THREE, no DOM, no Math.random.

import type { FighterSpec } from "../game/arena/contracts.ts";
import { applyLevel, createStats, DAMAGE_SCALE, HEALTH_SCALE, type ClassName, type CombatStats } from "../game/Stats.ts";
import { applyRaceBonus, raceAffinity, RACES, statDelta, type StatName } from "../game/Races.ts";
import { applySecondary } from "../game/SecondaryStats.ts";
import { budgetForLevel, MAX_LEVEL, MIN_LEVEL, spendBudget } from "../game/SpectateGen.ts";
import { resolveWeapon } from "../game/weapons/Loadout.ts";
import { combatProfile } from "../game/weapons/Profile.ts";
import { LEGACY_RANGED_REACH } from "../game/weapons/Adapter.ts";
import type { CombatProfile } from "../combat/contracts.ts";
import { bodyFromStats, totalMass, type Body } from "../game/Physics.ts";
import { skillsForClass, type Skill } from "../game/Skills.ts";
import { createResources, type ResourceContext, type ResourceState } from "../game/Resources.ts";
import { gearAccuracy, gearArmour, gearDamageMul, type MatchRules } from "./MatchRules.ts";
import { randomSource } from "./ArenaHarness.ts";

/** Engine: SmashPhysics body radius (the engage distance adds it to the weapon reach). */
export const BODY_RADIUS = 0.6;

export interface BuiltFighter {
  spec: FighterSpec;
  level: number;
  stats: CombatStats;
  /** The weapon's combat profile with the gear tier folded in (damage range, accuracy). */
  profile: CombatProfile;
  ranged: boolean;
  /** Engage distance centre to centre, m (Engine.#engageDistance without the swing rig). */
  reach: number;
  /** Seconds between plain swings (Engine.#swingCooldown: interval · profile.cooldown / 1.0). */
  swingCooldown: number;
  body: Body;
  mass: number;
  /** Wave FALL: the weapon's mass, kg (WeaponSpec.mass) — part of the body's collision mass. */
  weaponMass: number;
  skills: Skill[];
  resources: ResourceState;
  resourceCtx: ResourceContext;
}

const STAT_ORDER: readonly StatName[] = ["vitality", "resilience", "focus", "reflex", "strength", "intelligence", "agility"];

/**
 * A deterministic allocation of `fraction` (0..1) of the level's point budget, spent along the
 * class's lean exactly as the spectator generator does (SpectateGen.spendBudget), from a stream
 * seeded by the class — so "max stats" for a class is one fixed sheet, and 0 is "no statistics".
 */
export function leanAllocation(className: ClassName, level: number, fraction: number, seed = 0): Record<StatName, number> {
  const f = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  const budget = Math.floor(f * budgetForLevel(level));
  let h = seed >>> 0;
  for (const ch of className) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return spendBudget(budget, className, randomSource(h));
}

/**
 * The window for a spent budget (Engine.#applySpend: 30–60 k HP, 500–1 400 power, armour 1–8,
 * interval 0.5–1.5) with ONE Wave J change: the health bounds scale with the race's constitution
 * (raceAffinity.health). A fully spent budget hits the ceiling, and a shared 60 k ceiling erased
 * the race's health identity at the top (every max-VIT build read 60 000).
 */
export function clampWindow(s: CombatStats, health = 1): CombatStats {
  const k = Number.isFinite(health) && health > 0 ? health : 1;
  return {
    ...s,
    maxHealth: Math.max(30 * HEALTH_SCALE * k, Math.min(60 * HEALTH_SCALE * k, s.maxHealth)),
    attackPower: Math.max(5 * DAMAGE_SCALE, Math.min(14 * DAMAGE_SCALE, s.attackPower)),
    armor: Math.max(1, Math.min(8, s.armor)),
    attackInterval: Math.max(0.5, Math.min(1.5, s.attackInterval)),
  };
}

/** The combat stats a spec fights with (the contract's FighterSpec.stats). */
export function fighterStats(spec: FighterSpec, rules: MatchRules): CombatStats {
  const raced = applyRaceBonus(createStats(spec.className), spec.race, spec.subrace, spec.birthsign);
  let s = applySecondary(raced, spec.subrace, spec.birthsign);
  const alloc: Partial<Record<StatName, number>> = {};
  for (const k of STAT_ORDER) {
    const v = spec.allocated[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) alloc[k] = v;
  }
  if (Object.keys(alloc).length > 0) {
    const d = statDelta(alloc);
    const out = { ...s };
    for (const [k, v] of Object.entries(d)) {
      if (typeof v !== "number") continue;
      const key = k as keyof CombatStats;
      out[key] = (out[key] ?? 0) + v;
    }
    s = clampWindow(out, raceAffinity(spec.race, spec.subrace).health);
  }
  if (rules.levelGrowth) s = applyLevel(s, spec.level);
  return { ...s, armor: s.armor + gearArmour(spec.weapon.quality) };
}

/** Build everything the simulator needs from a spec. Total for every spec the contract allows. */
export function buildFighter(spec: FighterSpec, rules: MatchRules): BuiltFighter {
  const level = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(Number.isFinite(spec.level) ? spec.level : 1)));
  const stats = fighterStats({ ...spec, level }, rules);
  const weapon = resolveWeapon(spec.className, spec.weapon.type, spec.weapon.seed >>> 0);
  const raw = combatProfile(weapon);
  const dm = gearDamageMul(spec.weapon.quality);
  const profile: CombatProfile = {
    ...raw,
    minDamage: raw.minDamage * dm,
    maxDamage: raw.maxDamage * dm,
    accuracy: gearAccuracy(raw.accuracy, spec.weapon.quality),
  };
  const ranged = !!weapon.ranged;
  const reach = (ranged ? Math.min(raw.reach, LEGACY_RANGED_REACH) : raw.reach) + BODY_RADIUS;
  const body = bodyFromStats(stats);
  const resourceCtx: ResourceContext = { race: spec.race, subrace: spec.subrace, gear: spec.weapon.quality };
  return {
    spec: { ...spec, level, stats },
    level,
    stats,
    profile,
    ranged,
    reach,
    swingCooldown: stats.attackInterval * raw.cooldown,
    body,
    mass: totalMass(body),
    weaponMass: Number.isFinite(weapon.mass) ? weapon.mass : 1,
    skills: skillsForClass(spec.className),
    resources: createResources(stats, resourceCtx),
    resourceCtx,
  };
}

/** Every (race, sub-race) pair, in definition order (the batch's categorical axis). */
export const ANCESTRIES: readonly { race: string; subrace: string }[] = RACES.flatMap((r) =>
  r.subspecies.map((s) => ({ race: r.id, subrace: s.id }))
);
