// Wave X (lane L): AGILITY — body speed and evasion, bound to every technique and animation.
//
// The split with reflex (documented in docs/wave-x/LOGIC.md):
//   reflex   = REACTION: attack cadence (attackInterval), critical chance, power cooldowns, the
//              snap of the strike phase (MotionStyle reflexStrike / reflexChain).
//   agility  = BODY SPEED and EVASION: wind-up and recovery tempo of every animation, overshoot
//              control, walking speed, turn response, dash / roll distance, the grazing dodge on
//              incoming blows, the recovery of a channel that was shoved (Cast pushback), and the
//              amplitude of the mobility / evasion powers that declare `scale.attribute: "agility"`.
//
// THE SCALE. Two scales carry an attribute in this repo:
//   - the character SHEET (Leveling.ts CLASS_BASE + RACE_MODS + SUBRACE_TWEAKS): ~6..17, mean ~11;
//   - the RUNTIME CombatStats.agility (Stats.ts PRIMARY + Races.statDelta deltas + spent points):
//     class presets 3..9 (+ the race delta, + any generated spend).
//   Over the eight classes, sheet − runtime agility is 5..7 (mean 5.875), so SHEET_OFFSET = 6 maps a
//   runtime value onto the sheet. agilityFactors() takes the SHEET scale (1.0 at agility 10); every
//   caller with a CombatStats goes through effectiveAgility(), which adds the offset and the
//   body-mass drag below.
//
// THE SIDE EDGE (strength vs agility via body mass). A heavy body is a slow body: every kilogram of
// Physics.bodyFromStats mass above MASS_REF (the field-mean class body, 70 kg) costs MASS_DRAG sheet
// points of effective agility. So strength, vitality and resilience (the three mass terms) each
// pull agility DOWN — a real trade-off, perturbation-tested in tests/wave_x_influence_test.ts.
//
// Pure module: no THREE, no DOM, no Math.random. Total: any input gives finite, clamped factors.

import { bodyFromStats, totalMass } from "./Physics.ts";

/** Sheet agility at which every factor is exactly 1.0. */
export const AGILITY_NEUTRAL = 10;
/** Sheet = runtime + SHEET_OFFSET (mean class difference 5.875, rounded). */
export const SHEET_OFFSET = 6;
/** Reference body mass, kg: the eight class presets' mean Physics.bodyFromStats mass (70.6). */
export const MASS_REF = 70;
/** Sheet agility points lost per kg of body mass above MASS_REF (gained below it). */
export const MASS_DRAG = 0.05;
/**
 * Damage share a full unit of dodge factor turns into a graze: a blow on a defender with dodge d is
 * divided by 1 + DODGE_DAMAGE_K·(d − 1). Deterministic (no extra rng draw), so every caller of
 * Stats.attackDamage — the live engine, the headless MatchSim, the arena harness — sees the same law.
 */
export const DODGE_DAMAGE_K = 0.25;

/** Dimensionless multipliers, 1.0 at sheet agility 10, monotone non-decreasing, clamped. */
export interface AgilityFactors {
  /** Animation tempo: wind-up time is divided by it (MotionStyle). [0.85, 1.2] */
  animSpeed: number;
  /** Walking / running top speed multiplier (Engine #speedMul, MatchSim). [0.9, 1.12] */
  moveSpeed: number;
  /** Evasion: the graze on incoming blows (dodgeDivisor). [0.7, 1.4] */
  dodge: number;
  /** Recovery tempo: recovery / settle times and cast pushback are divided by it. [0.85, 1.25] */
  recovery: number;
  /** Turn response of the walk (the player's velocity responsiveness). [0.8, 1.3] */
  turnRate: number;
  /** Dash / roll / lunge distance multiplier (skill lunges, engine and MatchSim). [0.85, 1.2] */
  dash: number;
}

/** Per sheet point above 10, and the clamp band, of each factor. */
export const AGILITY_GAIN: Readonly<Record<keyof AgilityFactors, { perPoint: number; lo: number; hi: number }>> = {
  animSpeed: { perPoint: 0.02, lo: 0.85, hi: 1.2 },
  moveSpeed: { perPoint: 0.012, lo: 0.9, hi: 1.12 },
  dodge: { perPoint: 0.04, lo: 0.7, hi: 1.4 },
  recovery: { perPoint: 0.025, lo: 0.85, hi: 1.25 },
  turnRate: { perPoint: 0.03, lo: 0.8, hi: 1.3 },
  dash: { perPoint: 0.02, lo: 0.85, hi: 1.2 },
};

const FACTOR_KEYS = Object.keys(AGILITY_GAIN) as (keyof AgilityFactors)[];

/** The factors at a SHEET agility (1.0 at 10). Non-finite input reads as neutral. */
export function agilityFactors(agility: number): AgilityFactors {
  const d = (Number.isFinite(agility) ? agility : AGILITY_NEUTRAL) - AGILITY_NEUTRAL;
  const out = {} as AgilityFactors;
  for (const k of FACTOR_KEYS) {
    const g = AGILITY_GAIN[k];
    out[k] = Math.max(g.lo, Math.min(g.hi, 1 + g.perPoint * d));
  }
  return out;
}

/** The body parts of a stat block agility reads (all optional: a missing value is neutral). */
export interface AgilityBody {
  agility?: number;
  strength?: number;
  vitality?: number;
  resilience?: number;
}

const fin = (v: number | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** A runtime CombatStats.agility on the sheet scale (missing = the neutral 10). */
export function sheetAgility(runtimeAgility: number | undefined): number {
  return fin(runtimeAgility) ? runtimeAgility + SHEET_OFFSET : AGILITY_NEUTRAL;
}

/** Body mass, kg, from the SAME law the physics uses (null when the mass terms are not all given). */
export function bodyMassOf(s: AgilityBody): number | null {
  if (!fin(s.strength) || !fin(s.vitality) || !fin(s.resilience)) return null;
  return totalMass(bodyFromStats({ strength: s.strength, vitality: s.vitality, resilience: s.resilience, reflex: 0, armor: 0 }));
}

/**
 * Effective sheet agility of a runtime stat block: sheet agility minus the body-mass drag. A block
 * without agility AND without the mass terms is exactly neutral (10), so an unstyled caller is
 * untouched.
 */
export function effectiveAgility(s: AgilityBody | null | undefined): number {
  if (!s) return AGILITY_NEUTRAL;
  const m = bodyMassOf(s);
  const drag = m === null ? 0 : MASS_DRAG * (m - MASS_REF);
  return sheetAgility(s.agility) - drag;
}

/** The factors of a runtime stat block (effectiveAgility then agilityFactors). */
export function agilityOf(s: AgilityBody | null | undefined): AgilityFactors {
  return agilityFactors(effectiveAgility(s));
}

/** Divisor on an incoming blow's damage (Stats.attackDamage): 1 at agility 10, > 1 = a graze. */
export function dodgeDivisor(s: AgilityBody | null | undefined): number {
  return 1 + DODGE_DAMAGE_K * (agilityOf(s).dodge - 1);
}

/** Top-speed multiplier of a fighter's walk (Engine #speedMul and MatchSim's step). */
export function moveSpeedMul(s: AgilityBody | null | undefined): number {
  return agilityOf(s).moveSpeed;
}

/** Distance multiplier of a skill's lunge / dash / roll (Engine #advanceSkill, MatchSim skillMotion). */
export function dashMul(s: AgilityBody | null | undefined): number {
  return agilityOf(s).dash;
}

/** Turn-response multiplier of the walk (Engine's player stepVelocity responsiveness). */
export function turnRateMul(s: AgilityBody | null | undefined): number {
  return agilityOf(s).turnRate;
}

/**
 * Share of the attack interval agility buys (Stats.shape and Races.statDelta): the swing cadence
 * is divided by 1 + AGILITY_CADENCE·(animSpeed − 1), so agility moves the cadence a little while
 * reflex stays its main driver.
 */
export const AGILITY_CADENCE = 0.25;
