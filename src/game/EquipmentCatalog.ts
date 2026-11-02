// src/game/EquipmentCatalog.ts — Wave Y (C-EQ, lane U): what each equipment slot can hold (pure data).
//
// Nine slots surround the Creator's model viewer. The WEAPON slot lists the real weapon archetypes the
// game builds (weapons/Archetypes.ts — the same ids `Characters.weaponType` stores and
// `Loadout.archetypeOfChoice` resolves), all available. Every armour slot and the off hand list FUTURE
// pieces (available: false) so the sockets already show what is coming; choosing one is refused.
//
// Class legality: the game has none for weapons — `Loadout.weaponMenuOptions()` offers every archetype
// to every calling (the calling only sets the DEFAULT, `CLASS_ARCHETYPE`). The catalogue mirrors that
// and says so (`weaponLegalFor` is total), so the day a rule lands it lands in ONE place.
//
// Pure: no DOM, no THREE, no randomness.

import type { CharacterProfile } from "./Characters.ts";
import type { ClassName } from "./Stats.ts";
import type { ArchetypeId } from "../combat/contracts.ts";
import { ARCHETYPE_IDS, ARCHETYPES, CLASS_ARCHETYPE } from "./weapons/Archetypes.ts";
import { archetypeOfChoice } from "./weapons/Loadout.ts";

/** The nine sockets, in the order the viewer lays them out (left column top-down, then right). */
export type EquipSlot = "helmet" | "armor" | "gloves" | "belt" | "legs" | "weapon" | "offhand" | "cape" | "boots";
export const EQUIP_SLOTS: readonly EquipSlot[] = ["helmet", "armor", "gloves", "belt", "legs", "weapon", "offhand", "cape", "boots"];
/** Which column of the viewer each slot sits in (left of the model / right of it). */
export const EQUIP_SIDE: Readonly<Record<EquipSlot, "left" | "right">> = {
  helmet: "left", armor: "left", gloves: "left", belt: "left", legs: "left",
  weapon: "right", offhand: "right", cape: "right", boots: "right",
};
export const EQUIP_SLOT_LABEL: Readonly<Record<EquipSlot, string>> = {
  helmet: "Helmet", armor: "Armour", gloves: "Gloves", belt: "Belt", legs: "Legs",
  weapon: "Weapon", offhand: "Off hand", cape: "Cape", boots: "Boots",
};

/** One thing a slot can hold. `icon` names a glyph in src/ui/EquipIcons.ts (an archetype or a slot). */
export interface EquipItem {
  id: string;
  name: string;
  slot: EquipSlot;
  icon: string;
  available: boolean;
  /** One line: what it is (weapons: class + hands; placeholders: "coming"). */
  note: string;
}

const HANDS: Record<number, string> = { 1: "one hand", 1.5: "hand and a half", 2: "two hands" };

/** The weapon list: every archetype the game builds, in its own menu order. */
function weaponItems(): EquipItem[] {
  return ARCHETYPE_IDS.map((id) => {
    const a = ARCHETYPES[id];
    return { id, name: a.label, slot: "weapon" as const, icon: id, available: true, note: `${a.weaponClass} · ${HANDS[a.hands] ?? `${a.hands} hands`}` };
  });
}

/** Future pieces per slot (names only — no stats exist yet, so none is available). */
const PLACEHOLDERS: Readonly<Record<Exclude<EquipSlot, "weapon">, readonly string[]>> = {
  helmet: ["Leather cap", "Iron helm", "Great helm"],
  armor: ["Padded gambeson", "Mail hauberk", "Plate cuirass"],
  gloves: ["Leather gloves", "Mail mittens", "Gauntlets"],
  belt: ["Rope belt", "Leather belt", "Sword belt"],
  legs: ["Wool hose", "Mail chausses", "Plate greaves"],
  offhand: ["Buckler", "Heater shield", "Parrying dagger"],
  cape: ["Travel cloak", "Fur mantle", "Tabard"],
  boots: ["Sandals", "Riding boots", "Sabatons"],
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Everything `slot` can hold, available first. */
export function itemsFor(slot: EquipSlot): EquipItem[] {
  if (slot === "weapon") return weaponItems();
  return PLACEHOLDERS[slot].map((name) => ({ id: `${slot}-${slug(name)}`, name, slot, icon: slot, available: false, note: "coming soon" }));
}

/** The whole catalogue, slot by slot. */
export function equipmentCatalog(): Record<EquipSlot, EquipItem[]> {
  const out = {} as Record<EquipSlot, EquipItem[]>;
  for (const s of EQUIP_SLOTS) out[s] = itemsFor(s);
  return out;
}

/** Weapons have no class restriction in the game (every calling may take every archetype). */
export function weaponLegalFor(_className: ClassName, id: string): boolean {
  return (ARCHETYPE_IDS as readonly string[]).includes(id);
}

/** The archetype a profile actually wields (its override, a legacy type, or the class default); null = "random". */
export function equippedWeapon(p: Pick<CharacterProfile, "className" | "weaponType">): ArchetypeId | null {
  return archetypeOfChoice(p.className, p.weaponType);
}

/** The class's default archetype (what "" in weaponType means). */
export function defaultWeapon(className: ClassName): ArchetypeId {
  return CLASS_ARCHETYPE[className];
}

/** A two-handed weapon (hands 2) leaves no hand for the off hand. */
export function offhandBlocked(weapon: ArchetypeId | null): boolean {
  return weapon !== null && ARCHETYPES[weapon].hands === 2;
}

/** The ids stored in `profile.equip` (Characters.EquipmentSlots + `offhand`, which the type lacks). */
export type EquipIds = Partial<Record<Exclude<EquipSlot, "weapon">, string>>;

/** The equipment id a profile holds in `slot` ("" when the socket is empty; the weapon reads weaponType). */
export function equippedId(p: Pick<CharacterProfile, "equip" | "weaponType" | "className">, slot: EquipSlot): string {
  if (slot === "weapon") return equippedWeapon(p) ?? "random";
  const ids = (p.equip ?? {}) as EquipIds;
  return ids[slot] ?? "";
}

/**
 * Put `itemId` into `slot` — a NEW profile (immutable). A weapon writes `weaponType` (the field the
 * engine reads); armour writes `equip[slot]`. An unknown or unavailable item is refused (returns the
 * profile unchanged), so a stale click on a "coming" piece can never store it.
 */
export function equip(p: CharacterProfile, slot: EquipSlot, itemId: string): CharacterProfile {
  const item = itemsFor(slot).find((i) => i.id === itemId);
  if (!item || !item.available) return p;
  if (slot === "weapon") return { ...p, weaponType: itemId };
  const ids: EquipIds = { ...((p.equip ?? {}) as EquipIds), [slot]: itemId };
  return { ...p, equip: ids as CharacterProfile["equip"] };
}
