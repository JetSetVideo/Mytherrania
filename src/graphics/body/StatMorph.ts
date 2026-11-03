// StatMorph (wave GEN, lane B, contract C-MORPH): the generator's 0..1000 stats -> bounded multipliers
// and offsets the inflate and carve stages read. Pure module: no THREE, no DOM, no randomness.
//
//   strength      -> muscle-group girth (pectoralis, deltoid, latissimus, trapezius, biceps,
//                    quadriceps, calf), a bone-density term (clavicle, knee and elbow condyles) and
//                    shoulder breadth (the deltoid caps move out from the shoulder joint)
//   level         -> maturity: a small trunk-mass term and a "gravitas" chest lift (bounded);
//                    the HEIGHT term is fixed at 1 (joint heights plant the feet — not moved)
//   intelligence  -> brow recess (mm): the brow ridge sits back, the forehead reads higher
//   race/subrace  -> posture (SpineCurve.postureCurve: ork forward neck + trapezius, dwarf lumbar)
//                    and the digit distribution (elf slender/long ... ork thick knuckles, broad palm)
//
// Laws: every stat is normalised to u in [-1, 1] around STAT_REFERENCE (piecewise linear, clamped),
// every term is 1 + gainUp·u (u ≥ 0) or 1 + gainDown·u (u < 0): identity at the reference,
// monotone non-decreasing in its stat, bounded by [1 − gainDown, 1 + gainUp]. Left and right get the
// SAME number (the morph has no side), so the sculpt stays mirror-symmetric.
//
// Everything is applied to the RENDERED skin only (Physique.sculptSkin): plan.root, plan.bounds and
// plan.bones stay byte-identical, so no ragdoll mass, hitbox voxel grid, abduction solve or planted
// foot moves (the WHY is in Physique.ts and the skill's pitfall list).

import { postureCurve, type PostureCurve } from "../../game/SpineCurve.ts";
import type { GeneratorStats } from "./contracts.ts";
import { STAT_MAX, STAT_MIN, STAT_REFERENCE } from "../../game/StatScale.ts";

/** The generator's stat view (0..1000 each), BodySpec.stats (lane P's contracts.GeneratorStats). */
export type GenStats = GeneratorStats;
export { STAT_MAX, STAT_MIN, STAT_REFERENCE };

export const MUSCLE_GROUPS = ["pectoralis", "deltoid", "latissimus", "trapezius", "biceps", "quadriceps", "calf"] as const;
export type MuscleGroup = typeof MUSCLE_GROUPS[number];

/** Girth gain per muscle group at max strength (up) and the loss at min strength (down). */
export const MUSCLE_GAIN: Record<MuscleGroup, { up: number; down: number }> = {
  pectoralis: { up: 0.3, down: 0.15 },
  deltoid: { up: 0.28, down: 0.14 },
  latissimus: { up: 0.3, down: 0.1 },
  trapezius: { up: 0.3, down: 0.15 },
  biceps: { up: 0.32, down: 0.15 },
  quadriceps: { up: 0.25, down: 0.12 },
  calf: { up: 0.22, down: 0.12 },
};
/** Female bodies take this share of the hypertrophy (both directions). */
export const FEMALE_MUSCLE_SHARE = 0.8;
/** Bone density (condyle / clavicle girth) and shoulder breadth (cap offset over the joint half-span). */
export const BONE_DENSITY_GAIN = { up: 0.08, down: 0.06 } as const;
export const SHOULDER_BREADTH_GAIN = { up: 0.06, down: 0.04 } as const;
/** Level: trunk mass multiplier and the chest lift (head heights) at max level. */
export const MATURITY_MASS_GAIN = { up: 0.04, down: 0.03 } as const;
export const MATURITY_LIFT_PER_HEAD = { up: 0.025, down: 0.015 } as const;
/** Intelligence: brow recess at the extremes (mm; + = the ridge sits back). */
export const BROW_RECESS_MM = { up: 3.5, down: 3.5 } as const;

/** Digit distribution: multipliers on the rendered hand (Hands.handSize). */
export interface DigitDistribution {
  /** Phalanx lengths. */ length: number;
  /** Finger radius at the base. */ radius: number;
  /** Extra knuckle (MCP/PIP) thickness over the radius. */ knuckle: number;
  /** Palm half-width (on top of the weapon-fit cap) and thickness. */ palm: number;
}
export const DIGITS_NEUTRAL: DigitDistribution = { length: 1, radius: 1, knuckle: 1, palm: 1 };
/** Elf slender and long, then human, dwarf, ork (thickest knuckles, broadest palm). */
export const RACE_DIGITS: Record<string, DigitDistribution> = {
  elf: { length: 1.1, radius: 0.88, knuckle: 1.0, palm: 0.94 },
  human: DIGITS_NEUTRAL,
  // The dwarf's hand is already the shortest by the race's proportions (a shorter phalanx loses the
  // grip wrap: dwarf/axe 106° < the 110° pin at length 0.9, measured), so its digits only thicken.
  dwarf: { length: 1.0, radius: 1.06, knuckle: 1.1, palm: 1.03 },
  ork: { length: 0.97, radius: 1.1, knuckle: 1.16, palm: 1.06 },
};

export interface Morph {
  /** The normalised stats (−1 .. 1, 0 = reference). */
  u: GenStats;
  muscle: Record<MuscleGroup, number>;
  boneDensity: number;
  /** Multiplier on the deltoid caps' lateral offset from the shoulder joint's half-span. */
  shoulderBreadth: number;
  maturity: { height: number; mass: number; liftPerHead: number };
  browRecessMm: number;
  posture: PostureCurve;
  digits: DigitDistribution;
  /** Every stat term is exactly the identity (reference / absent stats). */
  statIdentity: boolean;
  /** Every race term is neutral (human). Both true = the sculpt leaves the skin untouched. */
  raceIdentity: boolean;
}

/** Piecewise-linear, clamped: STAT_MIN -> −1, reference -> 0, STAT_MAX -> +1. */
export function normaliseStat(v: number, ref: number): number {
  if (!Number.isFinite(v)) return 0;
  const x = Math.max(STAT_MIN, Math.min(STAT_MAX, v));
  return x >= ref ? (x - ref) / Math.max(1e-9, STAT_MAX - ref) : (x - ref) / Math.max(1e-9, ref - STAT_MIN);
}

/** 1 + up·u for u ≥ 0, 1 + down·u for u < 0 (identity at 0, monotone, bounded). */
export function gainTerm(u: number, g: { up: number; down: number }): number {
  return u >= 0 ? 1 + g.up * u : 1 + g.down * u;
}

/**
 * The morph for a body. `stats` null/undefined = the stat terms at the identity (exactly as at
 * STAT_REFERENCE). The race terms (posture, digits) come from the race whatever the stats.
 */
export function statMorph(stats: GenStats | null | undefined, race: string, subrace: string | null, sex: "male" | "female" | null | undefined, ref: Readonly<GenStats> = STAT_REFERENCE): Morph {
  const s = stats ?? ref;
  const u: GenStats = {
    strength: normaliseStat(s.strength, ref.strength), agility: normaliseStat(s.agility, ref.agility),
    intelligence: normaliseStat(s.intelligence, ref.intelligence), level: normaliseStat(s.level, ref.level),
  };
  const share = sex === "female" ? FEMALE_MUSCLE_SHARE : 1;
  const muscle = Object.fromEntries(MUSCLE_GROUPS.map((g) => [g, gainTerm(u.strength * share, MUSCLE_GAIN[g])])) as Record<MuscleGroup, number>;
  // Race terms are part of the race, not of the stats: present with or without stats.
  const posture = postureCurve(race, subrace);
  const digits = RACE_DIGITS[race] ?? DIGITS_NEUTRAL;
  const m: Morph = {
    u, muscle,
    boneDensity: gainTerm(u.strength, BONE_DENSITY_GAIN),
    shoulderBreadth: gainTerm(u.strength * share, SHOULDER_BREADTH_GAIN),
    maturity: { height: 1, mass: gainTerm(u.level, MATURITY_MASS_GAIN), liftPerHead: (gainTerm(u.level, MATURITY_LIFT_PER_HEAD) - 1) },
    browRecessMm: (gainTerm(u.intelligence, BROW_RECESS_MM) - 1),
    posture, digits, statIdentity: false, raceIdentity: false,
  };
  m.statIdentity = isStatIdentity(m);
  m.raceIdentity = isRaceIdentity(m);
  return m;
}

/** Every STAT term is the identity (true at STAT_REFERENCE and for absent stats). */
export function isStatIdentity(m: Morph): boolean {
  return MUSCLE_GROUPS.every((g) => m.muscle[g] === 1) && m.boneDensity === 1 && m.shoulderBreadth === 1 &&
    m.maturity.mass === 1 && m.maturity.liftPerHead === 0 && m.maturity.height === 1 && m.browRecessMm === 0;
}
/** Every RACE term is neutral (human: erect posture, neutral digits). */
export function isRaceIdentity(m: Morph): boolean {
  return m.posture.neckForwardPerHead === 0 && m.posture.lumbarDepthPerHead === 0 && m.posture.trapezius === 1 &&
    m.digits.length === 1 && m.digits.radius === 1 && m.digits.knuckle === 1 && m.digits.palm === 1;
}

/** The bound of every scalar term (min, max) over all stats — the tests sweep against these. */
export function morphBounds(): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const g of MUSCLE_GROUPS) out[`muscle.${g}`] = [1 - MUSCLE_GAIN[g].down, 1 + MUSCLE_GAIN[g].up];
  out.boneDensity = [1 - BONE_DENSITY_GAIN.down, 1 + BONE_DENSITY_GAIN.up];
  out.shoulderBreadth = [1 - SHOULDER_BREADTH_GAIN.down, 1 + SHOULDER_BREADTH_GAIN.up];
  out["maturity.mass"] = [1 - MATURITY_MASS_GAIN.down, 1 + MATURITY_MASS_GAIN.up];
  out["maturity.liftPerHead"] = [-MATURITY_LIFT_PER_HEAD.down, MATURITY_LIFT_PER_HEAD.up];
  out.browRecessMm = [-BROW_RECESS_MM.down, BROW_RECESS_MM.up];
  return out;
}

/** The scalar terms of a morph by the same keys as morphBounds (for sweeps and the docs). */
export function morphScalars(m: Morph): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of MUSCLE_GROUPS) out[`muscle.${g}`] = m.muscle[g];
  out.boneDensity = m.boneDensity; out.shoulderBreadth = m.shoulderBreadth;
  out["maturity.mass"] = m.maturity.mass; out["maturity.liftPerHead"] = m.maturity.liftPerHead;
  out.browRecessMm = m.browRecessMm;
  return out;
}
