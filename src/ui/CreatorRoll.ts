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
import { applyLevel, attackDamage, CLASSES, type CombatStats, createStats } from "../game/Stats.ts";
import { applyRaceBonus, raceById, RACES, type StatName } from "../game/Races.ts";
import { applySecondary, secondaryPreview } from "../game/SecondaryStats.ts";
import { birthsignById, BIRTHSIGNS } from "../game/Birthsight.ts";
import { weaponForClass } from "../game/Weapon.ts";
import { ancestryOf } from "../game/Ancestry.ts";
import { raceBuild } from "../game/RaceAppearance.ts";
import { randomSilhouette } from "../game/BodyProfile.ts";
import { startingStats } from "../game/Leveling.ts";
import { generateName } from "../game/NameGen.ts";
import { lifeFraction, lifespanOf, rollAge } from "../game/Age.ts";
import { rng32 } from "../core/MathCore.ts";
import { ATTRS, attrBase, pointBudget, rebaseAttrs } from "./CreatorTweak.ts";
import { heightBand, weightBand } from "./CreatorSync.ts";
import { spendBudget } from "../game/SpectateGen.ts";
import { derivedSheet, type DerivedSheet, fightStats, referenceProfiles } from "../game/DerivedSheet.ts";

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

  // Wave X: the legacy name draw is consumed and DISCARDED (pitfall 11: every later per-seed value
  // survives), and the name / sex / age come from a CHILD stream seeded once from the roll's seed, so
  // a seeded roll stays a seeded roll. The name speaks the rolled race + sub-race's phonology.
  rng();
  const child = rng32(seed ^ 0x6e616d65);
  appearance.sex = child() < 0.5 ? "male" : "female";
  appearance.age = rollAge(child, race.id);
  const profile: CharacterProfile = {
    name: generateName(child, race.id, subrace.id, appearance.sex),
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
  /**
   * Wave X (C-TONE): the number this row is coloured by, and its neutral/span. Absolute stats are
   * coloured by their DEVIATION from the all-class x all-race average (`SHEET_NEUTRAL`); a signed
   * modifier by its own sign. `invert` = lower is better (the attack interval).
   */
  tone?: { value: number; neutral: number; span: number; invert?: boolean };
  /** Wave X: the change against the ROLLED base (the hand-tweak), signed text + its value. */
  delta?: { text: string; value: number; invert?: boolean };
}

export interface CreatorSheet {
  name: string;
  raceLabel: string;
  subraceLabel: string;
  className: string;
  weaponLabel: string;
  signLabel: string;
  primary: SheetRow[]; // the seven attributes (Agility is the seventh, Wave X)
  derived: SheetRow[]; // max health, attack power, attack interval, armour
  secondary: SheetRow[]; // the birthsign/sub-species deltas
  /**
   * Wave Z (C-SHEET): the COMPLETE game-computed sheet (DerivedSheet.derivedSheet) — attributes with
   * their modifier vs the class baseline and every derived number vs the field mean. The rows above
   * read the SAME `fightStats` block, so the generator and the hero card can never disagree.
   */
  full?: DerivedSheet;
}

/** The stat sheet for a profile, computed with the REAL game maths. */
export function creatorSheet(profile: CharacterProfile): CreatorSheet {
  // The ONE combat pipeline (mirrors Fighter.createFighter): class base -> race/sub-species/birthsign
  // deltas -> secondary-stat bridge -> level. Every displayed number is read off this result, so the
  // sheet can never drift from the fight. Its pool size comes from createStats/applyRaceBonus and is
  // NOT hard-coded (the health pool is HEALTH_SCALE-scaled and the race constitution rescales it).
  const rolled = rolledStats(profile);
  const stats = tweakedStats(profile, rolled);

  const race = raceById(profile.race);
  const sub = profile.subrace ? race?.subspecies.find((s) => s.id === profile.subrace) ?? null : null;
  const sign = profile.birthsign ? birthsignById(profile.birthsign) : undefined;
  const weapon = weaponForClass(profile.className);

  const neutral = sheetNeutral();
  // Wave Z: the attributes are the SHEET-scale values of DerivedSheet (class sheet + every modifier
  // the fight applies — the numbers the tweak inputs edit), not the 1-10 runtime primaries; the
  // tone stays "deviation from the class x race mean" and the delta "change vs the rolled base".
  const full = derivedSheet(profile);
  const fullRolled = derivedSheet(untweaked(profile));
  const attrOf = (sh: DerivedSheet, k: string) => sh.attributes.find((r) => r.key === k)!;
  const primary: SheetRow[] = ATTRS.map((s) => {
    const now = attrOf(full, s), was = attrOf(fullRolled, s);
    return row(ATTR_LABEL[s], now.display, now.value, was.value, sheetAttrNeutral()[s], ATTR_SPAN, false, 0);
  });

  // A representative blow against an even foe (the class baseline, no ancestry): the mid-roll,
  // non-crit hit — attackDamage with damageRoll 0.5 (variance 1) and a critRoll of 0.5, which is
  // above every criticalChance (capped at 0.15), so the shown figure is an ordinary strike.
  const evenFoe = createStats(profile.className);
  const hit = attackDamage(stats, evenFoe, 0.5, 0.5);

  const derived: SheetRow[] = [
    row("Max Health", group(stats.maxHealth), stats.maxHealth, rolled.maxHealth, neutral.maxHealth, neutral.maxHealth * 0.25),
    { ...row("Attack Power", group(stats.attackPower), stats.attackPower, rolled.attackPower, neutral.attackPower, neutral.attackPower * 0.25), hint: `≈ ${group(hit)} a blow vs. an even foe` },
    row("Attack Interval", `${stats.attackInterval.toFixed(2)} s`, stats.attackInterval, rolled.attackInterval, neutral.attackInterval, 0.2, true, 2),
    row("Armour", stats.armor.toFixed(1), stats.armor, rolled.armor, neutral.armor, 2, false, 1),
  ];

  // The sub-species + birthsign deltas, via the same formatter the creator's preview uses.
  const secondary: SheetRow[] = secondaryPreview(profile.subrace, profile.birthsign)
    .map((r) => ({ label: r.label, value: r.text, tone: { value: r.delta, neutral: 0, span: SECONDARY_SPAN } }));

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
    full,
  };
}

// ─── helpers ─────────────────────────────────────────────

const ATTR_LABEL: Record<StatName, string> = {
  vitality: "Vitality", resilience: "Resilience", focus: "Focus", reflex: "Reflex",
  strength: "Strength", intelligence: "Intelligence", agility: "Agility",
};
/** Attribute points at which a deviation from the average reads fully green/red. */
export const ATTR_SPAN = 4;
/** A secondary modifier (a fraction: 0.05 = +5 %) reads fully green/red at ±5 %. */
export const SECONDARY_SPAN = 0.05;

/** A sheet row with its tone (deviation from `neutral`) and its signed change vs the rolled base. */
function row(label: string, value: string, now: number, base: number, neutral: number, span: number, invert = false, digits = 0): SheetRow {
  const d = now - base;
  const r: SheetRow = { label, value, tone: { value: now, neutral, span, ...(invert ? { invert } : {}) } };
  if (Math.abs(d) >= 0.5 * 10 ** -digits) r.delta = { text: signedText(d, digits), value: d, ...(invert ? { invert } : {}) };
  return r;
}

function signedText(n: number, digits: number): string {
  const v = digits ? n.toFixed(digits) : group(n);
  return n > 0 ? `+${v}` : v.replace("-", "\u2212");
}

/** The profile with its hand-tweak removed (every attribute back at its rolled base). */
function untweaked(profile: CharacterProfile): CharacterProfile {
  return { ...profile, allocated: {} };
}

/**
 * The class x race x sub-race x sign x level pipeline the fight runs (the ROLLED numbers, before any
 * hand-tweak). Wave Z: delegates to DerivedSheet.fightStats, the Engine.#startFight order.
 */
export function rolledStats(profile: CharacterProfile): CombatStats {
  return fightStats(untweaked(profile));
}

/**
 * The rolled numbers plus the hand-tweak: each attribute's change against its rolled base
 * (CreatorTweak) goes through `Races.statDelta`, the same attribute -> derived law the spend path
 * (Engine.#applySpend, FighterBuild.fighterStats) adds. A fresh roll has no change: identity.
 */
export function tweakedStats(profile: CharacterProfile, _rolled?: CombatStats): CombatStats {
  // Wave Z: the engine's own order (DerivedSheet.fightStats = Engine.#startFight): the tweak is
  // added BEFORE the level growth and clamped with the race constitution, exactly as #applyTweaks.
  // Before, the sheet applied the level first and clamped differently, so a tweaked level-5 hero's
  // card could read a few hundred health away from the duel.
  return fightStats(profile);
}

let ATTR_NEUTRAL: Record<string, number> | null = null;
/** Wave Z: the neutral of a SHEET-scale attribute — its mean over the class x race reference fighters. */
export function sheetAttrNeutral(): Record<string, number> {
  if (ATTR_NEUTRAL) return ATTR_NEUTRAL;
  const refs = referenceProfiles().map((p) => derivedSheet(p).attributes);
  const acc: Record<string, number> = {};
  for (const rows of refs) for (const r of rows) acc[r.key] = (acc[r.key] ?? 0) + r.value / refs.length;
  ATTR_NEUTRAL = acc;
  return acc;
}

let NEUTRAL: CombatStats | null = null;
/** The neutral reference of every sheet number: its mean over every class x race (no sub-race, no sign). */
export function sheetNeutral(): CombatStats {
  if (NEUTRAL) return NEUTRAL;
  const acc: Record<string, number> = {};
  let n = 0;
  for (const c of CLASSES) for (const r of RACES) {
    const s = applyLevel(applySecondary(applyRaceBonus(createStats(c), r.id, null, null), null, null), 1);
    for (const [k, v] of Object.entries(s)) acc[k] = (acc[k] ?? 0) + (v as number);
    n++;
  }
  for (const k of Object.keys(acc)) acc[k] /= n;
  NEUTRAL = acc as unknown as CombatStats;
  return NEUTRAL;
}

// ─── Wave X: reroll ONE part ─────────────────────────────────────────────

/** The parts the Creator's small dice reroll on their own. */
export type RerollPart = "name" | "ancestry" | "class" | "body" | "face" | "age" | "stats" | "sign";
export const REROLL_PARTS: readonly RerollPart[] = ["name", "ancestry", "class", "body", "face", "age", "stats", "sign"];

/**
 * Reroll ONE part of a profile and keep the rest. `nameLocked` = the user typed the name: an
 * ancestry/sex reroll then keeps it; otherwise the name is regenerated in the NEW phonology.
 * The rng is the only randomness; the result is legal by construction (bands from the race).
 */
export function rerollPart(p: CharacterProfile, part: RerollPart, rng: () => number, opts: { nameLocked?: boolean } = {}): CharacterProfile {
  const next: CharacterProfile = { ...p, appearance: { ...p.appearance }, allocated: { ...p.allocated } };
  const sex = p.appearance.sex ?? "male";
  switch (part) {
    case "name":
      next.name = generateName(rng, p.race, p.subrace, sex);
      break;
    case "ancestry": {
      const race = pick(rng, RACES);
      const sub = pick(rng, race.subspecies);
      return withAncestry(p, race.id, sub.id, rng, opts);
    }
    case "class": {
      const others = CLASSES.filter((c) => c !== p.className);
      next.className = pick(rng, others.length ? others : CLASSES);
      next.weaponType = weaponForClass(next.className).type;
      next.allocated = rebaseAttrs(p, next);
      break;
    }
    case "body": {
      const [h0, h1] = heightBand(p.race, p.subrace), [w0, w1] = weightBand(p.race, p.subrace);
      // The same distribution the full roll draws (base frame x race build).
      const build = raceBuild(p.race, p.subrace);
      next.appearance.height = Math.max(h0, Math.min(h1, (1.5 + rng() * 0.6) * build.heightMul));
      next.appearance.weight = Math.max(w0, Math.min(w1, (50 + rng() * 90) * build.weightMul));
      next.appearance.silhouette = randomSilhouette(rng, p.race, p.subrace);
      break;
    }
    case "face": {
      const node = ancestryOf(p.race, p.subrace);
      const build = raceBuild(p.race, p.subrace);
      next.appearance.hair = pick(rng, node.hair.colors);
      next.appearance.eyes = pick(rng, EYES);
      next.appearance.beard = build.beard && rng() < 0.3;
      next.appearance.moustache = build.moustache && rng() < 0.25;
      break;
    }
    case "age":
      next.appearance.age = rollAge(rng, p.race);
      break;
    case "stats": {
      // Spend the level's whole budget along the class's lean (SpectateGen.spendBudget, the
      // spectator generator's own allocator) on top of the rolled base.
      const spent = spendBudget(pointBudget(p), p.className, rng) as Partial<Record<StatName, number>>;
      const base = attrBase(p);
      next.allocated = Object.fromEntries(ATTRS.map((s) => [s, base[s] + (spent[s] ?? 0)]));
      break;
    }
    case "sign":
      next.birthsign = pick(rng, BIRTHSIGNS).id;
      break;
  }
  return next;
}

/**
 * Move a profile to another race / sub-race, carrying what can be carried: the body keeps its
 * POSITION inside the band (a tall human becomes a tall dwarf), the age keeps its life fraction,
 * the face is redrawn from the new ancestry's palette, the attribute CHANGES carry over, and an
 * untyped name is regenerated in the new phonology.
 */
export function withAncestry(p: CharacterProfile, raceId: string, subraceId: string | null, rng: () => number, opts: { nameLocked?: boolean } = {}): CharacterProfile {
  const next: CharacterProfile = { ...p, race: raceId, subrace: subraceId, appearance: { ...p.appearance, race: raceId, subrace: subraceId }, allocated: { ...p.allocated } };
  const rel = (v: number, [a, b]: [number, number]) => (b > a ? Math.max(0, Math.min(1, (v - a) / (b - a))) : 0.5);
  const hb = heightBand(p.race, p.subrace), wb = weightBand(p.race, p.subrace);
  const nh = heightBand(raceId, subraceId), nw = weightBand(raceId, subraceId);
  next.appearance.height = nh[0] + rel(p.appearance.height, hb) * (nh[1] - nh[0]);
  next.appearance.weight = nw[0] + rel(p.appearance.weight, wb) * (nw[1] - nw[0]);
  if (typeof p.appearance.age === "number") {
    next.appearance.age = Math.round(lifeFraction(p.race, p.appearance.age) * lifespanOf(raceId));
  }
  const node = ancestryOf(raceId, subraceId);
  const build = raceBuild(raceId, subraceId);
  if (!node.hair.colors.includes(p.appearance.hair ?? "")) next.appearance.hair = pick(rng, node.hair.colors);
  if (!build.beard) next.appearance.beard = false;
  if (!build.moustache) next.appearance.moustache = false;
  next.appearance.silhouette = randomSilhouette(rng, raceId, subraceId);
  next.allocated = rebaseAttrs(p, next);
  if (!opts.nameLocked) next.name = generateName(rng, raceId, subraceId, p.appearance.sex ?? "male");
  return next;
}
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
