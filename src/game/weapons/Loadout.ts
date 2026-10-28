// Loadout (W06 integration helpers): turn a menu/profile weapon choice into a WeaponSpec, and
// list the menu options. Lives here so the shared-file patches (Fighter, Engine, Menu) stay
// a few lines each.
//
// Choice strings (Characters.weaponType):
//   undefined | ""   the class default archetype (CLASS_ARCHETYPE)
//   "random"         rollWeapon over every archetype
//   an ArchetypeId   that archetype ("warhammer", "sabre", ...)
//   a legacy type    "sword" | "axe" | ... from saved profiles (LEGACY_TO_ARCHETYPE)

import type { ArchetypeId, WeaponClass } from "../../combat/contracts.ts";
import { rng32 } from "../../core/MathCore.ts";
import type { ClassName } from "../Stats.ts";
import type { WeaponType } from "../WeaponGen.ts";
import { ARCHETYPE_IDS, ARCHETYPES, CLASS_ARCHETYPE, isArchetypeId } from "./Archetypes.ts";
import { type GeneratedSpec, rollWeapon, weaponFromSeed } from "./Generate.ts";

/** The menu value that rolls a random archetype. */
export const RANDOM_WEAPON = "random";

/** Saved profiles may still hold a legacy weapon type: map it to its archetype. */
export const LEGACY_TO_ARCHETYPE: Record<WeaponType, ArchetypeId> = {
  axe: "axe", sword: "longsword", dagger: "dagger", staff: "staff", scythe: "scythe", bow: "bow", mace: "mace",
};

/** One-line trade-off per class, for the menu hint column (W07 in the player's words). */
export const CLASS_TRADEOFF: Record<WeaponClass, string> = {
  finesse: "Crits often, wide damage, misses more",
  balanced: "Reach and steady damage",
  heavy: "Hits hard, rarely misses, few crits",
  ranged: "Shoots from afar, crits often",
};

/** A row of the weapon picker. */
export interface WeaponMenuOption {
  /** Value stored in Characters.weaponType ("" = class default). */
  value: string;
  label: string;
  hint: string;
}

/** Weapon picker rows: class default, random, then every archetype in menu order. */
export function weaponMenuOptions(): WeaponMenuOption[] {
  return [
    { value: "", label: "Class default", hint: "" },
    { value: RANDOM_WEAPON, label: "Random", hint: "Any weapon, rolled each match" },
    ...ARCHETYPE_IDS.map((id) => ({ value: id, label: ARCHETYPES[id].label, hint: CLASS_TRADEOFF[ARCHETYPES[id].weaponClass] })),
  ];
}

/** The archetype a choice resolves to, or null for "random". */
export function archetypeOfChoice(className: ClassName, choice: string | undefined): ArchetypeId | null {
  if (!choice) return CLASS_ARCHETYPE[className];
  if (choice === RANDOM_WEAPON) return null;
  if (isArchetypeId(choice)) return choice;
  return LEGACY_TO_ARCHETYPE[choice as WeaponType] ?? CLASS_ARCHETYPE[className];
}

/**
 * Resolve a choice into a weapon. `seed` makes it reproducible: pass a per-character seed
 * (RaceAppearance.nameSeed(name)) to keep a fighter's weapon across matches, or a per-match
 * seed for "random" to re-roll each match.
 */
export function resolveWeapon(className: ClassName, choice: string | undefined, seed: number): GeneratedSpec {
  const id = archetypeOfChoice(className, choice);
  return id ? weaponFromSeed(id, seed) : rollWeapon(rng32(seed));
}
