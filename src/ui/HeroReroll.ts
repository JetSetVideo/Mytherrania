// src/ui/HeroReroll.ts — Wave Y (lane U): reroll a SAVED hero in place (pure).
//
// The Fighters page has one dice button, "Reroll hero": it regenerates the selected hero globally —
// ancestry, calling, sign, palette, body, face, age, name (in the new ancestry's phonology) — with the
// same seeded roll the Creator's dice uses (`rollProfile`), and KEEPS what is the player's progress or
// gear rather than the hero's nature: the level and the equipment ids. An Undo restores the previous
// character through the same persistence path (the engine writes `heroRecordPatch(character)`), so no
// modal confirmation is needed: one click rerolls, one click undoes.
//
// Pure: no DOM, no THREE, no Math.random (the caller passes a seeded rng).

import type { CharacterProfile } from "../game/Characters.ts";
import type { Profile } from "../game/Profiles.ts";
import { rollProfile } from "./CreatorRoll.ts";

/** A whole new hero from `rng`, keeping the old hero's level and equipment. */
export function rerollHero(prev: CharacterProfile, rng: () => number): CharacterProfile {
  const { profile } = rollProfile(rng);
  const level = Number.isFinite(prev.level) && prev.level >= 1 ? Math.floor(prev.level) : 1;
  return {
    ...profile,
    level,
    ...(prev.equip ? { equip: { ...prev.equip } } : {}),
  };
}

/** The stored-record fields a hero replacement writes (Profile + the library's stored extras). */
export type HeroRecordPatch = Partial<Profile> & {
  appearance: CharacterProfile["appearance"];
  palette: string;
  level: number;
  weaponType?: string;
  allocated?: Record<string, number>;
  equip?: CharacterProfile["equip"];
};

/**
 * The repo patch that makes a stored profile describe `c`: identity, ancestry, calling, sign and the
 * library's stored fields (appearance, palette, level, weapon, equipment). The id, keybindings,
 * telemetry, creation time and seed are NOT in the patch — the hero keeps its record.
 */
export function heroRecordPatch(c: CharacterProfile): HeroRecordPatch {
  return {
    name: c.name,
    className: c.className,
    race: c.race,
    subrace: c.subrace,
    birthsign: c.birthsign,
    appearance: { ...c.appearance },
    palette: c.palette,
    level: c.level,
    weaponType: c.weaponType,
    allocated: { ...c.allocated },
    equip: c.equip ? { ...c.equip } : undefined,
  };
}
