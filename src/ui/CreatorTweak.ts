// CreatorTweak (Wave X, lane U): the LEGAL LIMITS of every number the Creator lets the user tweak.
//
// The user rolls a fighter, rerolls one part, or tweaks a single number — and the model must refresh
// "within limits". This module is the limits, as pure data and arithmetic, read from the game's own
// sources (never a private copy):
//
//   attributes  base = Leveling.startingStats(class, race, sub-race)  (the rolled starting sheet)
//               floor = max(STAT_MIN, base - ATTR_GIVE_BACK)  — a stat may be lowered a little to
//                       free points (Races.computeRaceStats' own band reaches 3 below the median);
//               ceiling = base + SpectateGen.PER_STAT_CAP, and the SUM of the changes is capped by
//                       the level budget SpectateGen.budgetForLevel(level): `pointsLeft` >= 0 always.
//   age         Age.ageBounds(race)   (majority .. 1.1 x lifespan)
//   height/weight  CreatorSync.heightBand / weightBand (the race's own build band)
//   silhouette  BodyProfile.raceSilhouette(race, sub-race) x (1 ± SILHOUETTE_SPREAD), never above
//               BodyProfile.SILHOUETTE_TOP — the band `randomSilhouette` itself rolls inside.
//
// Pure module: no DOM, no THREE, no Math.random.

import type { CharacterProfile } from "../game/Characters.ts";
import type { StatName } from "../game/Races.ts";
import { startingStats } from "../game/Leveling.ts";
import { budgetForLevel, PER_STAT_CAP } from "../game/SpectateGen.ts";
import { ageBounds } from "../game/Age.ts";
import { raceSilhouette, SILHOUETTE_TOP, type RaceSilhouette } from "../game/BodyProfile.ts";
import { heightBand, STAT_MIN, weightBand } from "./CreatorSync.ts";

/** The seven attributes, in the sheet's order (Agility is the seventh, Wave X). */
export const ATTRS: readonly StatName[] = ["vitality", "resilience", "focus", "reflex", "strength", "intelligence", "agility"];
/** How far below its rolled base an attribute may be lowered (points it gives back to the pool). */
export const ATTR_GIVE_BACK = 3;
/** The relative band a silhouette parameter may be tweaked in around its race's own value. */
export const SILHOUETTE_SPREAD = 0.09;
/** The silhouette parameters the Creator exposes (limbLength stays the race's: it carries the race order). */
export const SILHOUETTE_KEYS: readonly (keyof RaceSilhouette)[] = ["width", "depth", "muscle", "shoulder", "hip", "waist", "head"];
export const SILHOUETTE_LABEL: Readonly<Record<string, string>> = {
  width: "Width", depth: "Depth", muscle: "Muscle", shoulder: "Shoulders", hip: "Hips", waist: "Waist", head: "Head",
};

/** The rolled base of every attribute (class + race + sub-race). */
export function attrBase(p: CharacterProfile): Record<StatName, number> {
  return startingStats(p.className, p.race, p.subrace).allocated;
}

/** The current value of an attribute (the base when the profile carries none). */
export function attrValue(p: CharacterProfile, s: StatName): number {
  const v = p.allocated?.[s];
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : attrBase(p)[s];
}

/** The level's point budget. */
export function pointBudget(p: CharacterProfile): number {
  return budgetForLevel(p.level ?? 1);
}

/** Points spent on top of the rolled base (a lowered stat gives points back). */
export function pointsSpent(p: CharacterProfile): number {
  const base = attrBase(p);
  return ATTRS.reduce((sum, s) => sum + (attrValue(p, s) - base[s]), 0);
}

/** Points still free (never negative for a profile that went through `clampAttr`). */
export function pointsLeft(p: CharacterProfile): number {
  return pointBudget(p) - pointsSpent(p);
}

/** The legal band of ONE attribute given the others: the floor, and the ceiling the free points allow. */
export function attrBounds(p: CharacterProfile, s: StatName): { min: number; max: number; base: number } {
  const base = attrBase(p)[s];
  const min = Math.max(STAT_MIN, base - ATTR_GIVE_BACK);
  const cur = attrValue(p, s);
  const max = Math.max(min, Math.min(base + PER_STAT_CAP, cur + Math.max(0, pointsLeft(p))));
  return { min, max, base };
}

/** Clamp a wanted value of one attribute into its legal band (integers). */
export function clampAttr(p: CharacterProfile, s: StatName, wanted: number): number {
  const { min, max } = attrBounds(p, s);
  const v = Number.isFinite(wanted) ? Math.round(wanted) : attrValue(p, s);
  return Math.max(min, Math.min(max, v));
}

/** The attributes re-based on a new class/race: the CHANGES (value - old base) carry over, clamped. */
export function rebaseAttrs(prev: CharacterProfile, next: CharacterProfile): Record<StatName, number> {
  const oldBase = attrBase(prev), newBase = attrBase(next);
  const out = { ...newBase };
  let left = pointBudget(next);
  for (const s of ATTRS) {
    const d = attrValue(prev, s) - oldBase[s];
    const lo = Math.max(STAT_MIN, newBase[s] - ATTR_GIVE_BACK) - newBase[s];
    const take = Math.max(lo, Math.min(d, left));
    out[s] = newBase[s] + take;
    left -= take;
  }
  return out;
}

/** The Creator's age band for the profile's race. */
export function ageBand(p: CharacterProfile): { min: number; max: number } {
  return ageBounds(p.race);
}

/** The height / weight bands (race build). */
export function bodyBands(p: CharacterProfile): { height: [number, number]; weight: [number, number] } {
  return { height: heightBand(p.race, p.subrace), weight: weightBand(p.race, p.subrace) };
}

/** The tweak band of one silhouette parameter. */
export function silhouetteBand(p: CharacterProfile, key: keyof RaceSilhouette): { min: number; max: number; base: number } {
  const base = raceSilhouette(p.race, p.subrace)[key] as number;
  const top = SILHOUETTE_TOP[key] as number;
  const lo = base * (1 - SILHOUETTE_SPREAD);
  const hi = Math.min(top, base * (1 + SILHOUETTE_SPREAD));
  return { min: Math.min(lo, hi), max: hi, base };
}

/** The profile's silhouette (the race's own when the profile carries none). */
export function silhouetteOf(p: CharacterProfile): RaceSilhouette {
  return p.appearance.silhouette ?? raceSilhouette(p.race, p.subrace);
}

/** Clamp a silhouette parameter into its band; non-finite keeps the current value. */
export function clampSilhouette(p: CharacterProfile, key: keyof RaceSilhouette, wanted: number): number {
  const { min, max } = silhouetteBand(p, key);
  const cur = silhouetteOf(p)[key] as number;
  const v = Number.isFinite(wanted) ? wanted : cur;
  return Math.max(min, Math.min(max, v));
}
