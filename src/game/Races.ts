import type { ClassName } from "./Stats.ts";

export type StatName = "vitality" | "resilience" | "focus" | "reflex" | "strength" | "intelligence" | "agility";

export interface Subrace {
  id: string;
  name: string;
  desc: string;
  tweak: Partial<Record<StatName, number>>;
  /** Wave J: additive tweaks on the parent race's physiology (e.g. high elf +0.08 mana flow). */
  affinity?: Partial<RaceAffinity>;
}

/**
 * Wave J: a race's PHYSIOLOGY — the characteristics that are not a primary stat but shape the
 * pools every fighter of that ancestry draws on. Each is a dimensionless factor (human = 1) the
 * formulas multiply in; the primaries, class, level and gear still move every individual:
 *   health        x maxHealth            (Races.applyRaceBonus, before the balance clamp)
 *   manaFlow      x mana regeneration    (Resources.resourceRates)
 *   endurance     x stamina regeneration (Resources.resourceRates)
 * The user's race-level orderings are a CONSEQUENCE of these numbers plus the race's primaries,
 * and are tested averaged over the three sub-races at a fixed class/level/gear. The health factor
 * is itself ordered (ork 1.07 > dwarf 1.05 > human 1 > elf 0.97) because a fully spent budget hits
 * the balance window's ceiling, where only the factor still separates the races (the spend window
 * scales with it: FighterBuild.clampWindow / engine notes):
 *   mana regen elf > human > ork > dwarf; stamina regen dwarf > ork > human > elf;
 *   health ork > dwarf > human > elf.
 */
export interface RaceAffinity {
  health: number;
  manaFlow: number;
  endurance: number;
}

export interface RaceDef {
  id: string;
  name: string;
  mods: Partial<Record<StatName, number>>;
  subspecies: Subrace[];
  traits: string[];
  lore: string;
  defaultClass: ClassName;
  /** Wave J physiology (RaceAffinity); human = all 1. */
  affinity: RaceAffinity;
}

// Computed: the total stat bonus from race + subspecies.
export function raceBonus(race: RaceDef, subrace: Subrace | null): Partial<Record<StatName, number>> {
  const out: Partial<Record<StatName, number>> = { ...race.mods };
  if (subrace) {
    for (const k of Object.keys(subrace.tweak) as StatName[]) {
      out[k] = (out[k] || 0) + (subrace.tweak[k] || 0);
    }
  }
  return out;
}

// Statistical range for display: min, max, average (mean), median.
export interface StatRange {
  min: number;
  max: number;
  avg: number;
  median: number;
}

export interface RaceStats {
  vitality: StatRange;
  resilience: StatRange;
  focus: StatRange;
  reflex: StatRange;
  strength: StatRange;
  intelligence: StatRange;
  agility: StatRange;
}

// Compute stat distributions — assumes class base stats ± race mods with
// a spread of ~3 around the base.  These are descriptive, not sampled.
export function computeRaceStats(race: RaceDef, subrace: Subrace | null): RaceStats {
  const b = raceBonus(race, subrace);
  const base = (s: StatName): number => 8 + (b[s] || 0);
  const range = (s: StatName): StatRange => {
    const c = base(s);
    return { min: Math.max(1, c - 3), max: c + 4, avg: c + 0.5, median: c };
  };
  return {
    vitality: range("vitality"),
    resilience: range("resilience"),
    focus: range("focus"),
    reflex: range("reflex"),
    strength: range("strength"),
    intelligence: range("intelligence"),
    agility: range("agility"),
  };
}

// ─── DEFINITIONS ────────────────────────────────────────────

export const RACES: RaceDef[] = [
  {
    id: "human",
    name: "Human",
    mods: { vitality: 1, resilience: 1, focus: 1, reflex: 1, strength: 1, intelligence: 1, agility: 1 },
    subspecies: [
      { id: "imperial", name: "Imperial", desc: "Tacticians of the Golden Citadel — raised on doctrine and drill, with minds honed for command.", tweak: { intelligence: 2, vitality: -1 }, affinity: { manaFlow: 0.05 } },
      { id: "nomad",   name: "Nomad",   desc: "Wind-walkers of the Sunken Plains — fast, lean, never in one place long enough to be caught.",  tweak: { reflex: 2, resilience: -1, agility: 1 }, affinity: { endurance: 0.05 } },
      { id: "islander", name: "Islander", desc: "Tideborn from the Sapphire Archipelago — hardened by salt, sea, and storm.",  tweak: { vitality: 2, focus: -1 }, affinity: { health: 0.03 } },
    ],
    traits: ["Adaptable — humans gain +1 to all stats (balanced)."],
    lore: "The youngest race. Short-lived but prolific, humans build empires on ambition and sheer numbers.",
    defaultClass: "Warrior",
    affinity: { health: 1, manaFlow: 1, endurance: 1 },
  },
  {
    id: "elf",
    name: "Elf",
    mods: { reflex: 2, intelligence: 2, strength: -1, vitality: -1, agility: 2 },
    subspecies: [
      { id: "high",  name: "High Elf",  desc: "Star-touched scholars of Elun-Dar — their magic is old as the sky.",   tweak: { intelligence: 2, vitality: -1 }, affinity: { manaFlow: 0.08 } },
      { id: "wood",  name: "Wood Elf",  desc: "Silent guardians of the Elderwood — they speak with root and vine.",    tweak: { reflex: 2, strength: -1, agility: 1 }, affinity: { endurance: 0.04 } },
      { id: "dark",  name: "Dark Elf",  desc: "Exiles of the Obsidian Halls — shadow, steel, and cold ambition.",      tweak: { focus: 2, resilience: -1 }, affinity: { health: 0.02 } },
    ],
    traits: ["Keen Senses — elves see farther and react faster (+2 reflex, +2 intelligence)."],
    lore: "The First Children. Millennia-old souls bound to the cycles of the world. Graceful, aloof, and dangerous.",
    defaultClass: "Mage",
    affinity: { health: 0.97, manaFlow: 1.3, endurance: 0.85 },
  },
  {
    id: "dwarf",
    name: "Dwarf",
    mods: { resilience: 2, strength: 2, reflex: -1, focus: -1, agility: -1 },
    subspecies: [
      { id: "mountain", name: "Mountain", desc: "Stone-boned clans of the Iron Reach — unbreakable.",             tweak: { resilience: 2, reflex: -1 }, affinity: { health: 0.02, endurance: 0.03 } },
      { id: "forge",    name: "Forge",    desc: "Rune-smiths of Khaz-Barad — fire and steel are their prayers.",   tweak: { strength: 2, intelligence: 1, focus: -2 }, affinity: { manaFlow: 0.06 } },
      { id: "deep",     name: "Deep",     desc: "Delvers of the Rootways — they hear the stone whisper.",          tweak: { focus: 2, reflex: -1 }, affinity: { manaFlow: 0.04 } },
    ],
    traits: ["Stone Skin — natural armor (+2 resilience, +2 strength)."],
    lore: "Born of fire and mountain. Dwarves craft wonders in the deep places and hold grudges longer than human memory.",
    defaultClass: "Warrior",
    affinity: { health: 1.05, manaFlow: 0.62, endurance: 1.25 },
  },
  {
    id: "ork",
    name: "Ork",
    mods: { vitality: 3, strength: 3, intelligence: -2, focus: -2 },
    subspecies: [
      { id: "greenhide", name: "Greenhide", desc: "Born in the Blood Marshes — pure, unthinking violence.",       tweak: { vitality: 2, intelligence: -1 }, affinity: { health: 0.03 } },
      { id: "ironhide",  name: "Ironhide",  desc: "War-forged in the Slag Pits — their skin is armor.",           tweak: { resilience: 2, strength: 1, intelligence: -2 }, affinity: { endurance: 0.04 } },
      { id: "bloodfang", name: "Bloodfang", desc: "Swift killers of the Red Steppe — they strike before you blink.", tweak: { reflex: 2, vitality: 1, focus: -2, agility: 1 }, affinity: { endurance: 0.03 } },
    ],
    traits: ["Blood Rage — Orks hit harder and last longer in a fight (+3 vitality, +3 strength)."],
    lore: "Forged in the crucible of ancient wars. Orks live for the thrill of battle and measure worth in scars.",
    defaultClass: "Barbarian",
    affinity: { health: 1.07, manaFlow: 0.8, endurance: 1.12 },
  },
];

export function raceById(id: string): RaceDef | undefined { return RACES.find(r => r.id === id); }

/** Neutral physiology (an unknown race reads as human). */
export const NEUTRAL_AFFINITY: Readonly<RaceAffinity> = { health: 1, manaFlow: 1, endurance: 1 };

/**
 * Wave J: a fighter's physiology = race affinity + its sub-race's additive tweaks. Total: an
 * unknown race or sub-race contributes nothing (neutral), and every factor is floored at 0.25 so
 * no ancestry can zero a pool.
 */
export function raceAffinity(raceId: string | null | undefined, subraceId: string | null | undefined): RaceAffinity {
  const race = raceId ? raceById(raceId) : undefined;
  const base = race?.affinity ?? NEUTRAL_AFFINITY;
  const tw = race?.subspecies.find((s) => s.id === subraceId)?.affinity ?? {};
  const f = (k: keyof RaceAffinity) => Math.max(0.25, base[k] + (tw[k] ?? 0));
  return { health: f("health"), manaFlow: f("manaFlow"), endurance: f("endurance") };
}

// ─── Race-specific skeletal flexibility ──────────────────────────
// Modifies joint min/max angles: agility→wider range, bulk→narrower.


// Race bonuses are DELTAS added on top of the class base stats — never absolute
// values, or a spread-merge would replace HP 45 with the bonus itself.
import type { CombatStats } from "./Stats.ts";
import { DAMAGE_SCALE, HEALTH_SCALE } from "./Stats.ts";
import { birthsignById } from "./Birthsight.ts";

/** Wave X: attack-interval seconds one agility point buys in statDelta (reflex buys 0.02). */
export const AGILITY_INTERVAL = 0.006;

/** Additive combat deltas for a race (and optional subspecies), via statDelta. */
/**
 * Combat deltas from a set of primary-stat modifiers (a race, subrace or birthsign).
 * Primaries move one-for-one; derived stats move in the SAME scaled units as the
 * class stats:
 *   ΔmaxHealth   = (2·ΔVIT + ⌊ΔSTR/2⌋) · HEALTH_SCALE
 *   ΔattackPower = ⌊ΔSTR/2⌋ · DAMAGE_SCALE
 *   Δarmor       = ⌊ΔRES/2⌋
 *   ΔattackInterval = −0.02 · ΔREF − AGILITY_INTERVAL · ΔAGI  (faster; wave X: agility buys a
 *                     small share of the cadence, reflex stays its driver — Agility.ts)
 * Before this, the HP and damage deltas were unscaled (+2 HP on a 48 750 HP pool),
 * so race and birthsign choices changed nothing but crit.
 */
export function statDelta(b: Partial<Record<StatName, number>>): Partial<CombatStats> {
  const v = b.vitality ?? 0, rn = b.resilience ?? 0, rf = b.reflex ?? 0, s = b.strength ?? 0,
        w = b.focus ?? 0, i = b.intelligence ?? 0, ag = b.agility ?? 0;
  return {
    // Primary stats move too, so derived rolls (crit from reflex vs resilience) see them.
    vitality: v, resilience: rn, focus: w, reflex: rf, strength: s, intelligence: i, agility: ag,
    maxHealth: (v * 2 + Math.floor(s / 2)) * HEALTH_SCALE,
    attackPower: Math.floor(s / 2) * DAMAGE_SCALE,
    armor: Math.floor(rn / 2),
    attackInterval: -rf * 0.02 - ag * AGILITY_INTERVAL,
  };
}

export function raceCombatDelta(raceId: string, subrace: string | null): Partial<CombatStats> {
  const race = raceById(raceId);
  if (!race) return {};
  return statDelta(raceBonus(race, race.subspecies?.find(s => s.id === subrace) ?? null) ?? {});
}

/**
 * Class base stats + race deltas (+ birthsign deltas), clamped so no choice can leave
 * the balance window. The birthsign is the third axis of the creator.
 */
export function applyRaceBonus(base: CombatStats, raceId: string, subrace: string | null, birthsign: string | null = null): CombatStats {
  const sign = birthsign ? birthsignById(birthsign) : undefined;
  const deltas = [raceCombatDelta(raceId, subrace), sign ? statDelta(sign.mods) : {}];
  const out: CombatStats = { ...base };
  for (const d of deltas) {
    for (const [k, v] of Object.entries(d)) {
      if (typeof v !== "number") continue;
      const key = k as keyof CombatStats;
      out[key] = (out[key] ?? 0) + v;
    }
  }
  // Wave J: the race's constitution scales the pool (ork > dwarf > human > elf), INSIDE the band.
  out.maxHealth *= raceAffinity(raceId, subrace).health;
  // Clamp to the SAME bands the class stats use. These were left at the pre-scaling
  // absolutes (30..60 HP, 5..14 damage) and silently squashed the 100x health pool
  // back to 60 the moment a race bonus was applied.
  out.maxHealth = Math.max(30 * HEALTH_SCALE, Math.min(60 * HEALTH_SCALE, out.maxHealth));
  out.attackPower = Math.max(5 * DAMAGE_SCALE, Math.min(14 * DAMAGE_SCALE, out.attackPower));
  out.armor = Math.max(1, Math.min(8, out.armor));
  out.attackInterval = Math.max(0.5, Math.min(1.5, out.attackInterval));
  return out;
}
