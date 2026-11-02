// src/game/DerivedSheet.ts — Wave Z (lane S): the COMPLETE game-computed statistics sheet (C-SHEET).
//
// The user's ask (docs/wave-z/BRIEF.md items 6-7): every attribute with its game-computed modifier in
// parentheses — `Agility 14 (+2)` — and every derived number the game really computes, each with its
// own (+/-). Every value below is the OUTPUT OF THE GAME'S OWN FUNCTION, called on the stat block the
// duel runs (`fightStats`), never a private re-derivation:
//
//   fightStats(profile)  = applyLevel( applyProfileTweaks( applySecondary( applyRaceBonus(
//                            createStats(class), race, sub-race, sign), sub-race, sign), profile), level)
//   — the exact order Engine.#startFight builds a seat in (createFighter -> #applyTweaks -> applyLevel);
//   `applyProfileTweaks` is a line-for-line copy of Engine.#applyTweaks (private there; pinned by text
//   in tests/wave_z_stats_test.ts so the two cannot drift).
//
// THE TWO REFERENCES (one per section, docs/wave-z/STATS.md):
//   attributes  value = the SHEET-scale attribute (Leveling class base + every modifier the fight
//               applies), delta = fightStats[attr] − createStats(class)[attr]: the modifier race,
//               sub-race, birthsign, the secondary crit bridge and the hand-tweak put on the CLASS
//               baseline. So `Agility 14 (+2)` = a 12-agility class sheet, +2 from the game.
//   derived     delta = value − the FIELD MEAN of the same row function over the 32 class x race
//               reference fighters (no sub-race, no sign, level 1, no tweak, the class weapon):
//               the "neutral" fighter of the game, as Wave X's SHEET_NEUTRAL tones already used.
//
// Not shown because the game does not compute it per fighter: passive health regeneration (there is
// none — only the Wave Y potential recovers), a per-fighter power mana cost (Engine pays the flat
// PowerCost.SKILL_RESOURCE_COST), per-fighter power cooldowns (Skills derive them from the class
// preset, so the row is class-level and says so).
//
// Pure module: no DOM, no THREE, no Math.random. Total: any profile gives finite rows.

import type { CharacterProfile } from "./Characters.ts";
import {
  applyLevel, attackDamage, type ClassName, CLASSES, type CombatStats, createStats, criticalChance, DAMAGE_SCALE, HEALTH_SCALE,
} from "./Stats.ts";
import { applyRaceBonus, raceAffinity, RACES, statDelta, type StatName } from "./Races.ts";
import { applySecondary } from "./SecondaryStats.ts";
import { startingStats } from "./Leveling.ts";
import { resourceRates } from "./Resources.ts";
import { agilityOf, dashMul, dodgeDivisor, effectiveAgility, moveSpeedMul, turnRateMul } from "./Agility.ts";
import { bodyFromStats, density, toughness, totalMass } from "./Physics.ts";
import { CAST_BASE_BY_KIND, castSeconds } from "./Cast.ts";
import { castFocus } from "./PowerCost.ts";
import { fatigueResist, traitsOf, woundFactor } from "./Potential.ts";
import { powerTailSeconds, skillsForClass } from "./Skills.ts";
import { weaponForClass } from "./Weapon.ts";
import { resolveWeapon } from "./weapons/Loadout.ts";
import { BASELINE_INTERVAL, combatProfile } from "./weapons/Profile.ts";
import { nameSeed } from "./RaceAppearance.ts";

export type RowGroup = "pools" | "offence" | "defence" | "mobility" | "magic" | "body";

/** One sheet row (C-SHEET). `span`/`invert` are the tone options of the delta (ValueTone). */
export interface Row {
  key: string;
  label: string;
  value: number;
  display: string;
  delta: number;
  deltaDisplay: string;
  unit?: string;
  group: RowGroup;
  /** Delta at which the tone saturates (ValueTone `data-tone-span`). */
  span?: number;
  /** Lower is better (an interval, a cast time, damage taken): the tone flips. */
  invert?: boolean;
}

export interface DerivedSheet {
  attributes: Row[];
  derived: Row[];
}

/** The seven attributes, in the sheet's order. */
export const SHEET_ATTRS: readonly StatName[] = ["vitality", "resilience", "focus", "reflex", "strength", "intelligence", "agility"];
const ATTR_LABEL: Record<StatName, string> = {
  vitality: "Vitality", resilience: "Resilience", focus: "Focus", reflex: "Reflex",
  strength: "Strength", intelligence: "Intelligence", agility: "Agility",
};
/** The group an attribute row is filed under (its main consumer). */
const ATTR_GROUP: Record<StatName, RowGroup> = {
  vitality: "pools", resilience: "defence", focus: "magic", reflex: "offence",
  strength: "offence", intelligence: "magic", agility: "mobility",
};
/** Attribute points at which a modifier reads fully green/red (CreatorRoll.ATTR_SPAN). */
export const ATTR_DELTA_SPAN = 4;

/**
 * Engine.CASTER_CLASSES (Engine.ts cannot be imported by a pure module: it pulls THREE). The heavy
 * channel flag of a power cast. Pinned against the Engine source in tests/wave_z_stats_test.ts.
 */
export const SHEET_CASTER_CLASSES: ReadonlySet<string> = new Set(["Mage", "Necromancer", "Priest"]);

// ─── the fight pipeline ─────────────────────────────────────────────────────────────────────────

/**
 * Engine.#applyTweaks, as a pure function: profile.allocated vs the class/race starting sheet,
 * converted by Races.statDelta (statDelta(now) − statDelta(base)), then clamped to the window with
 * the race constitution. No change = identity (no clamp), exactly as the engine.
 */
export function applyProfileTweaks(stats: CombatStats, prof: CharacterProfile): CombatStats {
  const base = startingStats(prof.className, prof.race, prof.subrace).allocated;
  const cur: Partial<Record<StatName, number>> = {};
  let any = false;
  for (const k of Object.keys(base) as StatName[]) {
    const v = prof.allocated?.[k];
    cur[k] = typeof v === "number" && Number.isFinite(v) ? v : base[k];
    if (cur[k] !== base[k]) any = true;
  }
  if (!any) return stats;
  const out: CombatStats = { ...stats };
  const now = statDelta(cur), was = statDelta(base);
  for (const k of Object.keys(now) as (keyof CombatStats)[]) {
    const a = now[k], b = was[k];
    if (typeof a === "number" && typeof b === "number") out[k] = (out[k] ?? 0) + (a - b);
  }
  const kh = raceAffinity(prof.race, prof.subrace).health;
  // Wave Z (parent, fixing S's Z-9): the window clamps what the TWEAK adds, never what the ancestry/sign
  // already earned. A sheet already above a bound (e.g. power 728 > the 700 ceiling from sub-race +
  // sign) keeps its value; before, a +2 strength tweak there LOWERED power to 700.
  const keep = (v: number, lo: number, hi: number, before: number) =>
    Math.max(Math.min(lo, before), Math.min(Math.max(hi, before), v));
  out.maxHealth = keep(out.maxHealth, 30 * HEALTH_SCALE * kh, 60 * HEALTH_SCALE * kh, stats.maxHealth);
  out.attackPower = keep(out.attackPower, 5 * DAMAGE_SCALE, 14 * DAMAGE_SCALE, stats.attackPower);
  out.armor = keep(out.armor, 1, 8, stats.armor);
  out.attackInterval = keep(out.attackInterval, 0.5, 1.5, stats.attackInterval);
  return out;
}

/** The stat block a live duel gives this profile's seat (Engine.#startFight, live path, no gear tier). */
export function fightStats(profile: CharacterProfile): CombatStats {
  const sub = profile.subrace ?? null, sign = profile.birthsign ?? null;
  const raced = applyRaceBonus(createStats(profile.className), profile.race ?? "human", sub, sign);
  const secondary = applySecondary(raced, sub, sign);
  return applyLevel(applyProfileTweaks(secondary, profile), profile.level ?? 1);
}

/**
 * The weapon numbers a seat swings with. No weaponType = the classic class weapon (createFighter:
 * Weapon.weaponForClass, tempo 1). A chosen weapon is forged by Loadout.resolveWeapon: the sheet
 * forges it from the profile's NAME seed (createFighter's own default seed); a live match re-forges
 * it from the match seed, so reach and tempo move by a few per cent between matches (STATS.md).
 */
export function sheetWeapon(profile: CharacterProfile): { reach: number; tempo: number } {
  if (!profile.weaponType) {
    const w = weaponForClass(profile.className);
    return { reach: w.reach, tempo: 1 };
  }
  const spec = resolveWeapon(profile.className, profile.weaponType, nameSeed(profile.name ?? ""));
  const prof = combatProfile(spec);
  return { reach: prof.reach, tempo: prof.cooldown / BASELINE_INTERVAL };
}

// ─── the derived rows ───────────────────────────────────────────────────────────────────────────

interface Ctx {
  profile: CharacterProfile;
  s: CombatStats;
  foe: CombatStats;
}

interface RowDef {
  key: string;
  label: string;
  group: RowGroup;
  unit?: string;
  digits: number;
  invert?: boolean;
  /** The game function this row reads (documentation; STATS.md prints it). */
  source: string;
  value(c: Ctx): number;
}

const pct = (x: number) => x * 100;

/** Every derived row, in display order. Each `value` is ONE call into the game's own functions. */
export const DERIVED_ROWS: readonly RowDef[] = [
  // pools
  { key: "maxHealth", label: "Max health", group: "pools", digits: 0, source: "fightStats().maxHealth (Stats.applyLevel)", value: (c) => c.s.maxHealth },
  { key: "maxMana", label: "Max mana", group: "pools", digits: 0, source: "Resources.resourceRates().manaMax", value: (c) => rates(c).manaMax },
  { key: "maxStamina", label: "Max stamina", group: "pools", digits: 0, source: "Resources.resourceRates().staminaMax", value: (c) => rates(c).staminaMax },
  { key: "manaRegen", label: "Mana regen", group: "pools", unit: "/s", digits: 2, source: "Resources.resourceRates().manaRegen", value: (c) => rates(c).manaRegen },
  { key: "staminaRegen", label: "Stamina regen", group: "pools", unit: "/s", digits: 2, source: "Resources.resourceRates().staminaRegen", value: (c) => rates(c).staminaRegen },
  // offence
  { key: "attackPower", label: "Attack power", group: "offence", digits: 0, source: "fightStats().attackPower (Stats.applyLevel)", value: (c) => c.s.attackPower },
  { key: "attackInterval", label: "Attack interval", group: "offence", unit: "s", digits: 2, invert: true, source: "fightStats().attackInterval", value: (c) => c.s.attackInterval },
  { key: "swingInterval", label: "Swing interval", group: "offence", unit: "s", digits: 2, invert: true, source: "attackInterval x combatProfile(weapon).cooldown / BASELINE_INTERVAL (Engine.#swingCooldown)", value: (c) => c.s.attackInterval * sheetWeapon(c.profile).tempo },
  { key: "attacksPerSecond", label: "Attacks", group: "offence", unit: "/s", digits: 2, source: "1 / swing interval", value: (c) => 1 / Math.max(1e-6, c.s.attackInterval * sheetWeapon(c.profile).tempo) },
  { key: "hit", label: "Hit", group: "offence", digits: 0, source: "Stats.attackDamage(you, evenFoe(), 0.5, 0.5)", value: (c) => attackDamage(c.s, c.foe, 0.5, 0.5) },
  { key: "critChance", label: "Crit chance", group: "offence", unit: "%", digits: 1, source: "Stats.criticalChance(your reflex, evenFoe().resilience)", value: (c) => pct(criticalChance(c.s.reflex, c.foe.resilience)) },
  { key: "woundDealt", label: "Wounding", group: "offence", unit: "%", digits: 0, source: "Potential.woundFactor(neutral 5/5, your strength)", value: (c) => pct(woundFactor({ vitality: 5, resilience: 5 }, c.s.strength)) },
  // defence
  { key: "armor", label: "Armour", group: "defence", digits: 1, source: "fightStats().armor", value: (c) => c.s.armor },
  { key: "hitTaken", label: "Hit taken", group: "defence", digits: 0, invert: true, source: "Stats.attackDamage(evenFoe(), you, 0.5, 0.5)", value: (c) => attackDamage(c.foe, c.s, 0.5, 0.5) },
  { key: "critTaken", label: "Crit taken", group: "defence", unit: "%", digits: 1, invert: true, source: "Stats.criticalChance(evenFoe().reflex, your resilience)", value: (c) => pct(criticalChance(c.foe.reflex, c.s.resilience)) },
  // The agility graze is a DIVISOR on every blow taken (Stats.attackDamage), not a chance: shown as the
  // share of each blow it takes off, 1 − 1/dodgeDivisor (negative = a clumsy body takes blows harder).
  { key: "dodge", label: "Graze", group: "defence", unit: "%", digits: 1, source: "1 − 1/Agility.dodgeDivisor (share of every blow taken off)", value: (c) => pct(1 - 1 / dodgeDivisor(c.s)) },
  { key: "woundTaken", label: "Wounds taken", group: "defence", unit: "%", digits: 0, invert: true, source: "Potential.woundFactor(traitsOf(you), 5)", value: (c) => pct(woundFactor(traits(c), 5)) },
  { key: "staminaFatigue", label: "Stamina fatigue res.", group: "defence", unit: "%", digits: 0, source: "Potential.fatigueResist(traitsOf(you), \"stamina\")", value: (c) => pct(fatigueResist(traits(c), "stamina")) },
  // mobility
  { key: "effectiveAgility", label: "Effective agility", group: "mobility", digits: 1, source: "Agility.effectiveAgility (sheet scale, mass drag)", value: (c) => effectiveAgility(c.s) },
  { key: "moveSpeed", label: "Move speed", group: "mobility", unit: "%", digits: 1, source: "Agility.moveSpeedMul", value: (c) => pct(moveSpeedMul(c.s)) },
  { key: "turnRate", label: "Turn rate", group: "mobility", unit: "%", digits: 1, source: "Agility.turnRateMul", value: (c) => pct(turnRateMul(c.s)) },
  { key: "dash", label: "Dash", group: "mobility", unit: "%", digits: 1, source: "Agility.dashMul", value: (c) => pct(dashMul(c.s)) },
  { key: "animSpeed", label: "Motion tempo", group: "mobility", unit: "%", digits: 1, source: "Agility.agilityOf().animSpeed", value: (c) => pct(agilityOf(c.s).animSpeed) },
  { key: "recovery", label: "Recovery", group: "mobility", unit: "%", digits: 1, source: "Agility.agilityOf().recovery", value: (c) => pct(agilityOf(c.s).recovery) },
  // magic
  { key: "castTime", label: "Power channel", group: "magic", unit: "s", digits: 2, invert: true, source: "Cast.castSeconds(CAST_BASE_BY_KIND.power, castFocus, heavy = caster class)", value: (c) => castSeconds({ base: CAST_BASE_BY_KIND.power, focus: castFocus(c.s), hastePct: 0, element: "", heavy: SHEET_CASTER_CLASSES.has(c.profile.className) }) },
  { key: "powerTail", label: "Power recovery", group: "magic", unit: "s", digits: 2, invert: true, source: "Skills.powerTailSeconds", value: (c) => powerTailSeconds(c.s) },
  { key: "manaFatigue", label: "Mana fatigue res.", group: "magic", unit: "%", digits: 0, source: "Potential.fatigueResist(traitsOf(you), \"mana\")", value: (c) => pct(fatigueResist(traits(c), "mana")) },
  { key: "cooldown", label: "Technique cooldown", group: "magic", unit: "s", digits: 2, invert: true, source: "mean Skills.skillsForClass(class).cooldown (class-level)", value: (c) => meanCooldown(c.profile.className) },
  // body
  { key: "mass", label: "Mass", group: "body", unit: "kg", digits: 1, source: "Physics.totalMass(bodyFromStats)", value: (c) => totalMass(bodyFromStats(c.s)) },
  { key: "density", label: "Density", group: "body", unit: "kg/m³", digits: 0, source: "Physics.density(bodyFromStats)", value: (c) => density(bodyFromStats(c.s)) },
  { key: "toughness", label: "Toughness", group: "body", digits: 0, source: "Physics.toughness(bodyFromStats)", value: (c) => toughness(bodyFromStats(c.s)) },
  { key: "reach", label: "Reach", group: "body", unit: "m", digits: 2, source: "weapon reach (combatProfile / Weapon.reach)", value: (c) => sheetWeapon(c.profile).reach },
];

function rates(c: Ctx) {
  return resourceRates(c.s, { race: c.profile.race, subrace: c.profile.subrace });
}
function traits(c: Ctx) {
  return traitsOf(c.s, c.profile.race, c.profile.subrace);
}
function meanCooldown(cls: ClassName): number {
  const sk = skillsForClass(cls) ?? [];
  return sk.length ? sk.reduce((a, s) => a + s.cooldown, 0) / sk.length : 0;
}

// ─── the neutral reference (field mean) ─────────────────────────────────────────────────────────

/** The 32 reference fighters: every class x race, no sub-race, no sign, level 1, the class weapon. */
export function referenceProfiles(): CharacterProfile[] {
  const out: CharacterProfile[] = [];
  for (const c of CLASSES) for (const r of RACES) {
    out.push({
      name: "Reference", race: r.id, subrace: null, className: c, palette: "", birthsign: null, level: 1, allocated: {},
      weaponType: weaponForClass(c).type,
      appearance: { body: "#000000", accent: "#000000", height: 1.8, weight: 80, race: r.id, subrace: null },
    } as CharacterProfile);
  }
  return out;
}

let FOE: CombatStats | null = null;
/**
 * The EVEN FOE every matchup row is measured against: the field-average fighter, i.e. the mean
 * fightStats block of the 32 reference fighters. One fixed opponent, so "Hit" moves with YOUR power
 * and "Hit taken" with YOUR defences only (a class-mirror foe would make them track the class).
 */
export function evenFoe(): CombatStats {
  if (FOE) return FOE;
  const blocks = referenceProfiles().map(fightStats);
  const acc: Record<string, number> = {};
  for (const b of blocks) for (const [k, v] of Object.entries(b)) acc[k] = (acc[k] ?? 0) + (v as number);
  for (const k of Object.keys(acc)) acc[k] /= blocks.length;
  FOE = acc as unknown as CombatStats;
  return FOE;
}

function rawValues(profile: CharacterProfile): number[] {
  const c: Ctx = { profile, s: fightStats(profile), foe: evenFoe() };
  return DERIVED_ROWS.map((d) => {
    const v = d.value(c);
    return Number.isFinite(v) ? v : 0;
  });
}

let REF: { mean: number[]; span: number[] } | null = null;
/** Field mean and tone span (2 standard deviations, never 0) of every derived row. */
export function derivedReference(): { mean: Record<string, number>; span: Record<string, number> } {
  if (!REF) {
    const all = referenceProfiles().map(rawValues);
    const n = all.length;
    const mean = DERIVED_ROWS.map((_, i) => all.reduce((a, v) => a + v[i], 0) / n);
    const span = DERIVED_ROWS.map((_, i) => {
      const sd = Math.sqrt(all.reduce((a, v) => a + (v[i] - mean[i]) ** 2, 0) / n);
      return sd > 1e-9 ? 2 * sd : Math.max(1e-6, Math.abs(mean[i]) * 0.1);
    });
    REF = { mean, span };
  }
  const r = REF;
  return {
    mean: Object.fromEntries(DERIVED_ROWS.map((d, i) => [d.key, r.mean[i]])),
    span: Object.fromEntries(DERIVED_ROWS.map((d, i) => [d.key, r.span[i]])),
  };
}

// ─── formatting ─────────────────────────────────────────────────────────────────────────────────

/** Digits in threes with a plain space ("47 100"), a real minus sign; `digits` decimals. */
export function formatNumber(n: number, digits = 0): string {
  const p = 10 ** digits;
  let v = Number.isFinite(n) ? Math.round(n * p) / p : 0;
  if (Object.is(v, -0) || v === 0) v = 0;
  const [int, frac] = Math.abs(v).toFixed(digits).split(".");
  let g = "";
  for (let i = 0; i < int.length; i++) {
    if (i > 0 && (int.length - i) % 3 === 0) g += " ";
    g += int[i];
  }
  return `${v < 0 ? "\u2212" : ""}${g}${frac ? `.${frac}` : ""}`;
}

/** Decimals for a number: 0 when integer-like at 2 dp, else 1 or 2. */
export function autoDigits(n: number): number {
  const r2 = Math.round(n * 100) / 100;
  if (Math.abs(r2 - Math.round(r2)) < 1e-9) return 0;
  return Math.abs(r2 * 10 - Math.round(r2 * 10)) < 1e-6 ? 1 : 2;
}

/** `(+2)`, `(−0.3)`, `(0)` — a real minus sign; 0 at the shown precision reads `(0)`. */
export function formatDelta(d: number, digits = 0): string {
  const p = 10 ** digits;
  const v = Number.isFinite(d) ? Math.round(d * p) / p : 0;
  if (v === 0) return "(0)";
  return `(${v > 0 ? "+" : ""}${formatNumber(v, digits)})`;
}

function withUnit(text: string, unit?: string): string {
  if (!unit) return text;
  return unit === "%" ? `${text}%` : unit.startsWith("/") ? `${text}${unit}` : `${text} ${unit}`;
}

// ─── the sheet ──────────────────────────────────────────────────────────────────────────────────

/** C-SHEET: the attributes (vs the class baseline) and every derived number (vs the field mean). */
export function derivedSheet(profile: CharacterProfile): DerivedSheet {
  const s = fightStats(profile);
  const cls = createStats(profile.className);
  const classSheet = startingStats(profile.className, "", null).allocated; // Leveling CLASS_BASE

  const attributes: Row[] = SHEET_ATTRS.map((k) => {
    const delta = fin(s[k]) - fin(cls[k]);
    const value = fin(classSheet[k]) + delta;
    const digits = autoDigits(value);
    const dDigits = Math.max(digits, autoDigits(delta));
    return {
      key: k, label: ATTR_LABEL[k], value, display: formatNumber(value, digits),
      delta, deltaDisplay: formatDelta(delta, dDigits), group: ATTR_GROUP[k], span: ATTR_DELTA_SPAN,
    };
  });

  const ref = derivedReference();
  const vals = rawValues(profile);
  const derived: Row[] = DERIVED_ROWS.map((d, i) => {
    const value = vals[i];
    const delta = value - ref.mean[d.key];
    const row: Row = {
      key: d.key, label: d.label, value, display: withUnit(formatNumber(value, d.digits), d.unit),
      delta, deltaDisplay: formatDelta(delta, d.digits), group: d.group, span: ref.span[d.key],
    };
    if (d.unit) row.unit = d.unit;
    if (d.invert) row.invert = true;
    return row;
  });
  return { attributes, derived };
}

const fin = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// ─── docs/wave-z/STATS.md (generated, never typed) ──────────────────────────────────────────────

/** The STATS.md tables for a sample profile: every row with its label, value, delta, function, reference. */
export function sheetMarkdown(profile: CharacterProfile): string {
  const sh = derivedSheet(profile);
  const ref = derivedReference();
  const cell = (s: string) => s.replace(/\|/g, "\\|");
  const lines: string[] = [];
  lines.push(`Sample: ${profile.name} — ${profile.race}/${profile.subrace ?? "-"} ${profile.className}, sign ${profile.birthsign ?? "-"}, level ${profile.level ?? 1}, weapon ${profile.weaponType ?? "(class)"}, allocated ${JSON.stringify(profile.allocated ?? {})}`);
  lines.push("");
  lines.push("### Attributes — reference: the CLASS baseline (createStats(class))");
  lines.push("");
  lines.push("| key | label | value | delta | function |");
  lines.push("|---|---|---|---|---|");
  for (const r of sh.attributes) {
    lines.push(`| ${r.key} | ${r.label} | ${r.display} | ${r.deltaDisplay} | Leveling class sheet + (fightStats().${r.key} − createStats(class).${r.key}) |`);
  }
  lines.push("");
  lines.push("### Derived — reference: the FIELD MEAN of the same function over the 32 class x race reference fighters");
  lines.push("");
  lines.push("| group | key | label | value | delta | field mean | tone span | lower is better | function |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const r of sh.derived) {
    const d = DERIVED_ROWS.find((x) => x.key === r.key)!;
    lines.push(`| ${r.group} | ${r.key} | ${r.label} | ${r.display} | ${r.deltaDisplay} | ${formatNumber(ref.mean[r.key], d.digits + 1)} | ${formatNumber(ref.span[r.key], d.digits + 1)} | ${r.invert ? "yes" : ""} | ${cell(d.source)} |`);
  }
  return lines.join("\n") + "\n";
}
