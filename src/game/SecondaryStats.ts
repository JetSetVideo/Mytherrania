// Secondary (derived-preference) stats: the layer beneath the primary attributes.
//
// The user's stat hierarchy: a RACE modifies the primary core stats (vitality,
// resilience, focus, reflex, strength, intelligence — the six already in
// Stats.ts). A SUB-SPECIES modifies the SECONDARY stats below — crit, haste,
// mastery, physical/magic resistance, versatility — the percentage-based
// modifiers a WoW-style sheet shows. A BIRTH SIGN nudges either layer, and the
// character-creation screen previews the combined delta before finalizing.
//
// Pure module: no Three.js, no DOM. Percentages are stored as fractions (0.05 =
// +5%) so they compose multiplicatively with damage/resist formulas.

/** The secondary stats a sub-species and birth sign modify. */
import type { CombatStats } from "./Stats.ts";

export type SecondaryStat = "crit" | "haste" | "mastery" | "physResist" | "magicResist" | "versatility";

export const SECONDARY_STATS: SecondaryStat[] = ["crit", "haste", "mastery", "physResist", "magicResist", "versatility"];

/** A set of secondary modifiers, as fractions (0.05 = +5%). */
export type SecondaryMods = Partial<Record<SecondaryStat, number>>;

/** Secondary modifiers per sub-species id (nested under the parent race). */
export const SUBRACE_SECONDARY: Record<string, SecondaryMods> = {
  // Human sub-species
  imperial: { versatility: 0.02, mastery: 0.02 },
  nomad: { haste: 0.03, physResist: 0.01 },
  islander: { magicResist: 0.03, mastery: 0.01 },
  // Elf sub-species
  high: { mastery: 0.03, magicResist: 0.02 },
  wood: { haste: 0.02, crit: 0.02 },
  dark: { crit: 0.03, versatility: -0.01 },
  // Dwarf sub-species
  mountain: { physResist: 0.04, versatility: 0.01 },
  forge: { mastery: 0.02, physResist: 0.02, haste: -0.01 },
  deep: { magicResist: 0.02, physResist: 0.02 },
  // Ork sub-species
  greenhide: { crit: 0.02, physResist: 0.02, magicResist: -0.01 },
  ironhide: { physResist: 0.03, versatility: 0.02, crit: 0.01 },
  bloodfang: { haste: 0.03, crit: 0.02, versatility: -0.02 },
};

/** Secondary modifiers per birth sign (astral alignment). */
export const BIRTHSIGN_SECONDARY: Record<string, SecondaryMods> = {
  serpent: { crit: 0.02, haste: 0.01 },
  mountain: { physResist: 0.03, magicResist: 0.01 },
  flame: { haste: 0.02, mastery: 0.01 },
  moon: { magicResist: 0.02, mastery: 0.02 },
  storm: { crit: 0.02, haste: 0.02 },
  void: { magicResist: 0.03, versatility: 0.01 },
};

/**
 * Combine the secondary modifiers from a sub-species and a birth sign. Both are
 * optional; absent layers contribute nothing. Result is a full SecondaryMods map
 * (every stat present, defaulting to 0) so the UI can show a delta per row.
 */
export function combineSecondary(subraceId: string | null, birthsignId: string | null): Record<SecondaryStat, number> {
  const out: Record<SecondaryStat, number> = { crit: 0, haste: 0, mastery: 0, physResist: 0, magicResist: 0, versatility: 0 };
  const add = (mods: SecondaryMods | undefined) => {
    if (!mods) return;
    for (const k of SECONDARY_STATS) out[k] += mods[k] ?? 0;
  };
  add(subraceId ? SUBRACE_SECONDARY[subraceId] : undefined);
  add(birthsignId ? BIRTHSIGN_SECONDARY[birthsignId] : undefined);
  return out;
}

/** Format a secondary delta for the preview: +5% / -2% / — for zero. */
export function formatDelta(frac: number): string {
  if (Math.abs(frac) < 1e-9) return "—";
  const pct = frac * 100;
  return `${pct > 0 ? "+" : ""}${Math.round(pct * 10) / 10}%`;
}

/** The per-row preview for the character-creation screen: stat, label, delta. */
export function secondaryPreview(subraceId: string | null, birthsignId: string | null): { stat: SecondaryStat; label: string; delta: number; text: string }[] {
  const combined = combineSecondary(subraceId, birthsignId);
  const LABEL: Record<SecondaryStat, string> = {
    crit: "Critical Strike", haste: "Haste", mastery: "Mastery",
    physResist: "Physical Resistance", magicResist: "Magic Resistance", versatility: "Versatility",
  };
  return SECONDARY_STATS.map((stat) => ({ stat, label: LABEL[stat], delta: combined[stat], text: formatDelta(combined[stat]) }));
}

/**
 * How a secondary stat converts into a combat rating. These are the bridge constants
 * between the character sheet and the equations the fight actually runs:
 *   - mastery / versatility multiply attack power
 *   - haste multiplies the attack interval down
 *   - physResist and magicResist add armour (one damage channel, so magic counts half)
 *   - crit converts into effective reflex, which is what `criticalChance` reads
 */
export const SECONDARY_BRIDGE = {
  /** Armour rating gained per point of physical resistance. */
  armorPerResist: 40,
  /** Magic resistance counts half, because the game has a single damage channel. */
  magicResistWeight: 0.5,
  /** Effective reflex gained per point of crit (the crit formula's 0.1 floor / 0.008). */
  reflexPerCrit: 12.5,
  /** Attack interval can never be reduced below this (s). */
  minAttackInterval: 0.25,
} as const;

/**
 * Fold a character's secondary stats into its combat stats. This is what connects the
 * creator's race/sub-species/birthsign choice to the damage, speed and crit equations:
 * without it the secondary stats were preview-only and changed nothing in a fight.
 */
export function applySecondary(
  stats: CombatStats,
  subraceId: string | null,
  birthsignId: string | null,
): CombatStats {
  const m = combineSecondary(subraceId, birthsignId);
  const power = 1 + m.mastery + m.versatility * 0.5;
  const resist = m.physResist + m.magicResist * SECONDARY_BRIDGE.magicResistWeight;
  return {
    ...stats,
    attackPower: stats.attackPower * power,
    attackInterval: Math.max(
      SECONDARY_BRIDGE.minAttackInterval,
      stats.attackInterval * (1 - Math.min(0.5, m.haste)),
    ),
    armor: stats.armor + resist * SECONDARY_BRIDGE.armorPerResist,
    reflex: stats.reflex + m.crit * SECONDARY_BRIDGE.reflexPerCrit,
  };
}
