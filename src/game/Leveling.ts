import type { ClassName } from "./Stats.ts";
import type { StatName } from "./Races.ts";

// The creator's displayed starting attributes (the character sheet's "allocated"
// numbers). These are a PRESENTATION table: combat itself uses Stats.createStats +
// Races.applyRaceBonus, which is the one balanced pipeline. A second derived-combat
// path used to live here (deriveCombatStats, levelUp, allocate,
// maximumPotentialHealth); it had no runtime caller and was removed.

export interface LeveledStats {
  level: number;
  unspent: number;     // points available to allocate
  allocated: Record<StatName, number>;
}

// Base primary stats per class at level 1 (before race mods).
// Modeled after WoW class stat distributions.
const CLASS_BASE: Record<ClassName, Record<StatName, number>> = {
  Barbarian:  { vitality: 14, resilience: 12, willpower: 8,  reflex: 10, strength: 14, intelligence: 6 },
  Warrior:    { vitality: 13, resilience: 14, willpower: 9,  reflex: 9,  strength: 13, intelligence: 7 },
  Rogue:      { vitality: 10, resilience: 8,  willpower: 9,  reflex: 15, strength: 10, intelligence: 10 },
  Assassin:   { vitality: 9,  resilience: 7,  willpower: 10, reflex: 16, strength: 9,  intelligence: 11 },
  Mage:       { vitality: 7,  resilience: 7,  willpower: 14, reflex: 11, strength: 6,  intelligence: 17 },
  Necromancer:{ vitality: 8,  resilience: 9,  willpower: 15, reflex: 9,  strength: 7,  intelligence: 15 },
  Archer:     { vitality: 10, resilience: 9,  willpower: 10, reflex: 15, strength: 10, intelligence: 9 },
  Priest:     { vitality: 9,  resilience: 10, willpower: 16, reflex: 8,  strength: 7,  intelligence: 14 },
};

// Race modifiers applied to base class stats.
const RACE_MODS: Record<string, Record<StatName, number>> = {
  human:   { vitality: 1, resilience: 1, willpower: 1, reflex: 1, strength: 1, intelligence: 1 },
  elf:     { vitality: -1,resilience: 0, willpower: 0, reflex: 2, strength: -1,intelligence: 2 },
  dwarf:   { vitality: 0, resilience: 2, willpower: -1,reflex: -1,strength: 2, intelligence: 0 },
  ork:     { vitality: 3, resilience: 1, willpower: -2,reflex: 0, strength: 3, intelligence: -2 },
};

// Subrace tweaks (additive on top of race mod).
const SUBRACE_TWEAKS: Record<string, Partial<Record<StatName, number>>> = {
  imperial: { vitality: -1, intelligence: 2 },
  nomad:    { reflex: 2, resilience: -1 },
  islander: { vitality: 2, willpower: -1 },
  high:     { intelligence: 2, vitality: -1 },
  wood:     { reflex: 2, strength: -1 },
  dark:     { willpower: 2, resilience: -1 },
  mountain: { resilience: 2, reflex: -1 },
  forge:    { strength: 2, intelligence: 1, willpower: -2 },
  deep:     { willpower: 2, reflex: -1 },
  greenhide:{ vitality: 2, intelligence: -1 },
  ironhide: { resilience: 2, strength: 1, intelligence: -2 },
  bloodfang:{ reflex: 2, vitality: 1, willpower: -2 },
};

const STAT_NAMES: StatName[] = ["vitality","resilience","willpower","reflex","strength","intelligence"];

export function startingStats(className: ClassName, race: string, subrace: string | null): LeveledStats {
  const base: Record<StatName, number> = { ...CLASS_BASE[className] };
  const rm = RACE_MODS[race] ?? {};
  const st = SUBRACE_TWEAKS[subrace ?? ""] ?? {};
  for (const s of STAT_NAMES) base[s] = (base[s] ?? 8) + (rm[s] ?? 0) + (st[s] ?? 0);
  return {
    level: 1,
    unspent: 0,
    allocated: Object.fromEntries(STAT_NAMES.map(s => [s, base[s]])) as Record<StatName, number>,
  };
}
