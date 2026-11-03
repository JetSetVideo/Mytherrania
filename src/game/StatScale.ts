// Wave GEN (lane P): the character generator's 0..1000 stat view. Pure module (no THREE, no DOM).
//
// The game's stats are NOT rescaled (BRIEF: deliberate deviation). This module maps them onto the
// generator's own scale, which is the only stat view the body generator reads (BodySpec.stats):
//
//   strength / agility / intelligence  — from the character SHEET (CharacterProfile.allocated, the
//     Leveling.startingStats numbers, ~5..19) or from a runtime CombatStats block (Stats.ts PRIMARY +
//     race/sign deltas, ~0..12). Each map is PIECEWISE LINEAR through three MEASURED anchors:
//         lo  -> 0      (lowest value any class x race x sub-race can start with, minus the tweak span)
//         ref -> 500    (the mean of the 32 reference fighters: every class x race, no sub-race, level 1)
//         hi  -> 1000   (highest starting value plus the tweak span)
//     so the reference fighter is exactly STAT_REFERENCE (the identity morph) and every map is
//     monotone and clamped to [0, 1000].
//   level — 1 -> 500 and LEVEL_CAP (20) -> 1000, linear. The game spawns every fighter at level 1, so a
//     level-1 fighter is the identity morph (its body is today's); 0..500 is reserved for the generator
//     view (youths / non-combatants) and is never produced from a game level.
//
// The anchors are computed from the game tables at module load (not typed in), so a balance change to
// Leveling or Stats moves them with it; tests/wave_gen_pipeline_test.ts pins the identity and the
// monotonicity, docs/wave-gen/PIPELINE.md prints the measured anchors.

import type { GeneratorStats } from "../graphics/body/contracts.ts";
import type { CharacterProfile } from "./Characters.ts";
import { startingStats } from "./Leveling.ts";
import { applyRaceBonus, RACES, type StatName } from "./Races.ts";
import { CLASSES, type CombatStats, createStats, LEVEL_CAP } from "./Stats.ts";

export type { GeneratorStats };

/** The generator's scale. */
export const STAT_MIN = 0, STAT_MAX = 1000;
/** The identity morph: the reference fighter maps here on every axis. */
export const STAT_REFERENCE: Readonly<GeneratorStats> = Object.freeze({ strength: 500, agility: 500, intelligence: 500, level: 500 });
/** The three sheet attributes the generator reads (level comes separately). */
export const GENERATOR_ATTRS = ["strength", "agility", "intelligence"] as const;
export type GeneratorAttr = typeof GENERATOR_ATTRS[number];
/**
 * Attribute points a creator tweak may move a sheet value (= DerivedSheet.ATTR_DELTA_SPAN; that module
 * imports Characters, which imports this one, so the number is re-stated and pinned equal in G13).
 */
export const SHEET_TWEAK_SPAN = 4;
/** Margin (attribute points) beyond the measured runtime range, for birth signs and level points. */
export const RUNTIME_MARGIN = 2;

/** Three anchors of one piecewise-linear map. */
export interface StatAnchors { lo: number; ref: number; hi: number }

/** Piecewise-linear lo->0, ref->500, hi->1000, clamped; monotone non-decreasing (strictly inside). */
export function mapAnchored(v: number, a: StatAnchors): number {
  if (!Number.isFinite(v)) return STAT_REFERENCE.strength;
  const mid = STAT_REFERENCE.strength;
  const out = v <= a.ref
    ? mid * (v - a.lo) / Math.max(1e-9, a.ref - a.lo)
    : mid + (STAT_MAX - mid) * (v - a.ref) / Math.max(1e-9, a.hi - a.ref);
  return Math.max(STAT_MIN, Math.min(STAT_MAX, out));
}

/** Level 1 -> 500, LEVEL_CAP -> 1000, linear and clamped (levels below 1 read as 1). */
export function levelToGenerator(level: number): number {
  const l = Number.isFinite(level) ? Math.max(1, Math.min(LEVEL_CAP, level)) : 1;
  return STAT_REFERENCE.level + (STAT_MAX - STAT_REFERENCE.level) * (l - 1) / (LEVEL_CAP - 1);
}

/** Every (race, sub-race | null) pair the game knows. */
function ancestries(): [string, string | null][] {
  const out: [string, string | null][] = [];
  for (const r of RACES) { out.push([r.id, null]); for (const s of r.subspecies) out.push([r.id, s.id]); }
  return out;
}

function anchorsOf(values: (a: GeneratorAttr) => { all: number[]; ref: number[] }, margin: number): Record<GeneratorAttr, StatAnchors> {
  const out = {} as Record<GeneratorAttr, StatAnchors>;
  for (const a of GENERATOR_ATTRS) {
    const { all, ref } = values(a);
    out[a] = { lo: Math.min(...all) - margin, ref: ref.reduce((s, v) => s + v, 0) / ref.length, hi: Math.max(...all) + margin };
  }
  return out;
}

/** Measured anchors of the SHEET maps (CharacterProfile.allocated). */
export const SHEET_ANCHORS: Readonly<Record<GeneratorAttr, StatAnchors>> = anchorsOf((a) => {
  const all: number[] = [], ref: number[] = [];
  for (const c of CLASSES) for (const [r, s] of ancestries()) {
    const v = startingStats(c, r, s).allocated[a as StatName];
    all.push(v);
    if (s === null) ref.push(v);
  }
  return { all, ref };
}, SHEET_TWEAK_SPAN);

/** Measured anchors of the RUNTIME maps (CombatStats primaries after the race bonus). */
export const RUNTIME_ANCHORS: Readonly<Record<GeneratorAttr, StatAnchors>> = anchorsOf((a) => {
  const all: number[] = [], ref: number[] = [];
  for (const c of CLASSES) for (const [r, s] of ancestries()) {
    const v = applyRaceBonus(createStats(c), r, s)[a];
    all.push(v);
    if (s === null) ref.push(v);
  }
  return { all, ref };
}, RUNTIME_MARGIN);

/** The generator view of a profile: its sheet (allocated, else the starting sheet) and level. */
export function generatorStats(profile: Pick<CharacterProfile, "className" | "race" | "subrace" | "allocated" | "level">): GeneratorStats {
  const base = startingStats(profile.className, profile.race, profile.subrace).allocated;
  const pick = (a: GeneratorAttr): number => {
    const v = profile.allocated?.[a];
    return typeof v === "number" && Number.isFinite(v) ? v : base[a];
  };
  return {
    strength: mapAnchored(pick("strength"), SHEET_ANCHORS.strength),
    agility: mapAnchored(pick("agility"), SHEET_ANCHORS.agility),
    intelligence: mapAnchored(pick("intelligence"), SHEET_ANCHORS.intelligence),
    level: levelToGenerator(profile.level ?? 1),
  };
}

/** The generator view of a runtime stat block (Stats.ts primaries) at a level. */
export function generatorStatsFromCombat(stats: Pick<CombatStats, GeneratorAttr>, level = 1): GeneratorStats {
  return {
    strength: mapAnchored(stats.strength, RUNTIME_ANCHORS.strength),
    agility: mapAnchored(stats.agility, RUNTIME_ANCHORS.agility),
    intelligence: mapAnchored(stats.intelligence, RUNTIME_ANCHORS.intelligence),
    level: levelToGenerator(level),
  };
}

/** True when every axis is within `eps` of STAT_REFERENCE (or the stats are absent). */
export function isReferenceStats(s: GeneratorStats | null | undefined, eps = 1e-9): boolean {
  if (!s) return true;
  return Math.abs(s.strength - STAT_REFERENCE.strength) <= eps && Math.abs(s.agility - STAT_REFERENCE.agility) <= eps &&
    Math.abs(s.intelligence - STAT_REFERENCE.intelligence) <= eps && Math.abs(s.level - STAT_REFERENCE.level) <= eps;
}

/** Signed distance from the reference on one axis, -1..+1 (0 at the reference): (v - 500) / 500, clamped. */
export function statOffset(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, (v - STAT_REFERENCE.strength) / (STAT_MAX - STAT_REFERENCE.strength)));
}
