// src/ui/CreatorRoll.ts — the character generator's roll and its stat sheet (pure).
//
// WHY this module exists: the Creator's dice button must produce a COMPLETE, LEGAL fighter in one
// click, and the sheet it prints must be the numbers the duel actually runs. Every figure below is
// read from the same functions the fight calls, never a private copy:
//
//   createStats(class)                       Stats.ts   (class primaries -> combat block)
//   applyRaceBonus(base, race, subrace, sign) Races.ts   (+ race/sub-species/birthsign deltas)
//   applySecondary(subrace, sign)            SecondaryStats.ts (+ crit/haste/mastery/resist bridge)
//   applyLevel(level)                        Stats.ts   (level 1 is the identity)
//   attackDamage(attacker, defender, ...)    Stats.ts   (the per-blow damage the arena resolves)
//
// A past balance pass was reverted precisely because it optimised a private re-derivation of this
// maths, so the sheet is glued to the sources by construction and by test.
//
// Pure module: no DOM, no THREE, no Math.random (the caller passes the rng), no `any`.
//
// Units, named once here: heights are metres, weights are kilograms, attackInterval is seconds
// between plain swings, armour is an abstract rating, and health/power are in the scaled pool units
// of Stats.ts (HEALTH_SCALE / DAMAGE_SCALE) — never a raw absolute.

import type { Appearance, CharacterProfile } from "../game/Characters.ts";
import { PALETTES } from "../game/Characters.ts";
import { applyLevel, attackDamage, CLASSES, createStats } from "../game/Stats.ts";
import { applyRaceBonus, raceById, RACES } from "../game/Races.ts";
import { applySecondary, secondaryPreview } from "../game/SecondaryStats.ts";
import { birthsignById, BIRTHSIGNS } from "../game/Birthsight.ts";
import { weaponForClass } from "../game/Weapon.ts";
import { ancestryOf } from "../game/Ancestry.ts";
import { raceBuild } from "../game/RaceAppearance.ts";
import { randomSilhouette } from "../game/BodyProfile.ts";
import { startingStats } from "../game/Leveling.ts";

export interface RolledProfile {
  profile: CharacterProfile;
  seed: number;
}

/** A complete random fighter: race AND sub-species, class, a weapon LEGAL for that class, palette,
 *  birthsign, appearance. `rng` is the only source of randomness (seeded callers get the same profile). */
export function rollProfile(rng: () => number): RolledProfile {
  // The seed is the FIRST draw, so two callers that seed their rng the same way get the same profile
  // AND the same seed returned; rng remains the only source of randomness (no Math.random anywhere).
  const seed = Math.floor(rng() * 0x100000000) >>> 0;

  // The sub-species is drawn from ITS OWN race's list, so it can never be foreign to the race (the
  // ancestryOf/applyRaceBonus lookups reject a mismatch, but a legal roll must not create one).
  const race = pick(rng, RACES);
  const subrace = pick(rng, race.subspecies);
  const className = pick(rng, CLASSES);
  const paletteName = pick(rng, Object.keys(PALETTES));
  const palette = PALETTES[paletteName];
  const birthsign = pick(rng, BIRTHSIGNS);
  // The class's own weapon (Weapon.weaponForClass): legal for the class by construction, and its
  // legacy type round-trips through Loadout.archetypeOfChoice, so the weapon picker can select it.
  const weapon = weaponForClass(className);

  // Appearance grounded in the ancestry: hair colours come from the node's own hair spec, and the
  // build (height/weight/beard/tusk) from RaceAppearance, so two races do not roll the same look.
  const node = ancestryOf(race.id, subrace.id);
  const build = raceBuild(race.id, subrace.id);
  const appearance: Appearance = {
    body: palette.body,
    accent: palette.accent,
    // A base human frame (1.5–2.1 m tall, 50–140 kg) scaled by the race's own build multipliers.
    height: (1.5 + rng() * 0.6) * build.heightMul,
    weight: (50 + rng() * 90) * build.weightMul,
    hair: pick(rng, node.hair.colors),
    // An ancestry that never grows a beard or moustache stays bare, whatever the roll says.
    beard: build.beard && rng() < 0.3,
    moustache: build.moustache && rng() < 0.25,
    eyes: pick(rng, EYES),
    race: race.id,
    subrace: subrace.id,
    // Per-character proportions from the same seeded stream, so the preview model differs within a race.
    silhouette: randomSilhouette(rng, race.id, subrace.id),
  };

  const profile: CharacterProfile = {
    name: pick(rng, NAMES),
    race: race.id,
    subrace: subrace.id,
    className,
    palette: paletteName,
    birthsign: birthsign.id,
    level: 1,
    allocated: startingStats(className, race.id, subrace.id).allocated,
    weaponType: weapon.type,
    appearance,
  };
  return { profile, seed };
}

export interface SheetRow {
  label: string;
  value: string;
  hint?: string;
}

export interface CreatorSheet {
  name: string;
  raceLabel: string;
  subraceLabel: string;
  className: string;
  weaponLabel: string;
  signLabel: string;
  primary: SheetRow[]; // the six attributes
  derived: SheetRow[]; // max health, attack power, attack interval, armour
  secondary: SheetRow[]; // the birthsign/sub-species deltas
}

/** The stat sheet for a profile, computed with the REAL game maths. */
export function creatorSheet(profile: CharacterProfile): CreatorSheet {
  // The ONE combat pipeline (mirrors Fighter.createFighter): class base -> race/sub-species/birthsign
  // deltas -> secondary-stat bridge -> level. Every displayed number is read off this result, so the
  // sheet can never drift from the fight. Its pool size comes from createStats/applyRaceBonus and is
  // NOT hard-coded (the health pool is HEALTH_SCALE-scaled and the race constitution rescales it).
  const raced = applyRaceBonus(createStats(profile.className), profile.race, profile.subrace, profile.birthsign);
  const stats = applyLevel(applySecondary(raced, profile.subrace, profile.birthsign), profile.level ?? 1);

  const race = raceById(profile.race);
  const sub = profile.subrace ? race?.subspecies.find((s) => s.id === profile.subrace) ?? null : null;
  const sign = profile.birthsign ? birthsignById(profile.birthsign) : undefined;
  const weapon = weaponForClass(profile.className);

  const primary: SheetRow[] = [
    { label: "Vitality", value: group(stats.vitality) },
    { label: "Resilience", value: group(stats.resilience) },
    { label: "Willpower", value: group(stats.willpower) },
    { label: "Reflex", value: group(stats.reflex) },
    { label: "Strength", value: group(stats.strength) },
    { label: "Intelligence", value: group(stats.intelligence) },
  ];

  // A representative blow against an even foe (the class baseline, no ancestry): the mid-roll,
  // non-crit hit — attackDamage with damageRoll 0.5 (variance 1) and a critRoll of 0.5, which is
  // above every criticalChance (capped at 0.15), so the shown figure is an ordinary strike.
  const evenFoe = createStats(profile.className);
  const hit = attackDamage(stats, evenFoe, 0.5, 0.5);

  const derived: SheetRow[] = [
    { label: "Max Health", value: group(stats.maxHealth) },
    { label: "Attack Power", value: group(stats.attackPower), hint: `≈ ${group(hit)} a blow vs. an even foe` },
    { label: "Attack Interval", value: `${stats.attackInterval.toFixed(2)} s` },
    { label: "Armour", value: stats.armor.toFixed(1) },
  ];

  // The sub-species + birthsign deltas, via the same formatter the creator's preview uses.
  const secondary: SheetRow[] = secondaryPreview(profile.subrace, profile.birthsign)
    .map((r) => ({ label: r.label, value: r.text }));

  return {
    name: profile.name,
    raceLabel: race?.name ?? profile.race,
    subraceLabel: sub?.name ?? "—",
    className: profile.className,
    weaponLabel: weapon.name,
    signLabel: sign?.name ?? "None",
    primary,
    derived,
    secondary,
  };
}

// ─── helpers ─────────────────────────────────────────────

/** Names a rolled fighter may draw; short, neutral, and readable in a chip. */
const NAMES = ["Ash", "Bramble", "Cinder", "Dusk", "Ember", "Fenn", "Gale", "Hollow", "Iris", "Juniper", "Kestrel", "Lumen"];
/** Eye colours, drawn from the repo palette (DESIGN.md) so a rolled eye reads as one of the inks/sands. */
const EYES = ["#dfaa55", "#4f8490", "#ef7455", "#172128"];

/** Uniform pick of one element; the rng is the sole source (index clamped so a rng == 1 cannot overrun). */
function pick<T>(rng: () => number, list: readonly T[]): T {
  const i = Math.min(list.length - 1, Math.floor(rng() * list.length));
  return list[i];
}

/**
 * Group the digits in threes with a plain space ("47 100"), the same grouping the stat bars use
 * (FighterPanel.barLabel) and the brief's own example. Non-finite input reads as 0, never NaN.
 */
function group(n: number): string {
  const v = Number.isFinite(n) ? Math.round(n) : 0;
  const digits = String(Math.abs(v));
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += " ";
    out += digits[i];
  }
  return v < 0 ? `-${out}` : out;
}
