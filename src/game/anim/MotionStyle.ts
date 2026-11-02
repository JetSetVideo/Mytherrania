// Lane M: a fighter's MOTION STYLE — how this body, with this weapon, at these statistics, right
// now, moves. Pure module (no Three.js, no DOM). One style per fighter; the Animator (gait, guard,
// trunk, breathing, skill curves) and the SwingDriver (four-phase weapon swings) read it.
//
//   motionStyleFor(input)  -> MotionStyle        built once per fighter (race, subrace, seed, body,
//                                                weapon, combat stats): the BASE coefficients
//   style.setLive(live)                           every frame (hp / stamina / mana / exhaustion):
//   style.step(dt)                                the live state is smoothed (no pops when hp drops
//                                                on a hit) and MODULATES the base into `eff`, in
//                                                place (no allocation)
//
// Every coefficient is a named constant below with the reason it has that value. Inputs map
// through tanh / smoothstep (continuous, saturating), outputs are clamped into SAFE (the motion
// the rig, the joint limits and the speed limiter accept), so random or extreme inputs give a
// finite, in-range style, and a live sweep has no jumps.
//
// Vocabulary
//   multiplier   a dimensionless factor on a default duration / amplitude (1 = today's motion)
//   L            leg length (thigh + shin), m — crouch and leg drive are fractions of it
//   chain depth  kinetic chain order feet 0 -> pelvis 1 -> chest 2 -> shoulder 3 -> elbow 4 ->
//                wrist/weapon 5; a joint at depth d LEADS the weapon by (5 - d) · chainLag s

import { clamp, rng32, smoothstep } from "../../core/MathCore.ts";
import type { CombatStats } from "../Stats.ts";
import type { WeaponSpec } from "../../combat/contracts.ts";
import type { Weapon } from "../Weapon.ts";
import { JOINT_COUNT, JOINT_INDEX, type LegGeometry, legLength } from "./Rig.ts";
import type { SwingKind } from "./Swing.ts";

// ─── Neutral style (a human-average fighter with a longsword, fresh) ─────────────────────────

/** The motion coefficients (units in each comment). */
export interface StyleCoeffs {
  /** Multipliers on the swing phase durations (Swing.swingTiming). */
  windupTime: number;
  strikeTime: number;
  recoverTime: number;
  /** Hit hold after the strike (s): the blow stops and READS before the recovery. */
  holdTime: number;
  /** Settle hold at guard before the swing hands back to idle (s). */
  settleTime: number;
  /** Multiplier of the cocked key's distance from the contact pose (anticipation depth). */
  windupDepth: number;
  /** Multiplier of the follow-through's distance past the contact pose. */
  followThrough: number;
  /** Recovery overshoot past guard, share of the recovery travel (damped: then −0.3×, then rest). */
  overshoot: number;
  /** Kinetic-chain delay per chain depth, s. */
  chainLag: number;
  /** Pelvis sink into the planted feet at a strike, / L (the legs lead). */
  legDrive: number;
  /** Ride-height offset of the stance, / L (− = lower, dwarf). */
  crouch: number;
  /** Chest forward hunch, rad (+ = hunched). */
  hunch: number;
  /** Guard shoulders lowered, rad (+ = lower guard). */
  guardDrop: number;
  /** Guard elbows tucked (extra flexion), rad (protective). */
  guardTuck: number;
  /** Stride length multiplier (Gait strideAtRest / strideGain). */
  strideScale: number;
  /** Walking arm-swing multiplier. */
  armSwing: number;
  /** Gait weight-shift sway (root roll) multiplier: swagger. */
  sway: number;
  /** Idle breathing rate (Hz) and amplitude (rad). */
  breathRate: number;
  breathAmp: number;
  /** Neck drop, rad (fatigue / low mana). */
  headDrop: number;
  /** Skill-curve counter-move depth, share of a track's strike amplitude. */
  anticipation: number;
}

/** Today's motion: every multiplier 1, every offset 0 (what an unstyled fighter does). */
export const NEUTRAL: Readonly<StyleCoeffs> = Object.freeze({
  windupTime: 1, strikeTime: 1, recoverTime: 1,
  // 70 ms: ~4 frames at 60 Hz — the shortest hold the eye registers as a stop, not a hitch.
  holdTime: 0.07,
  // 120 ms at guard before idle: long enough to read "done", short against a 0.85-1.3 s cooldown.
  settleTime: 0.12,
  windupDepth: 1, followThrough: 1,
  // 6 % of the recovery travel past guard: visible weight, small enough that a 1.45 rad
  // follow-through overshoots guard by < 0.09 rad (inside every joint window).
  overshoot: 0.06,
  // 14 ms per chain level: feet lead the weapon by 70 ms, ~1/3 of a 0.2 s strike (whip timing
  // of human throwing/striking, pelvis -> hand ~50-80 ms).
  chainLag: 0.014,
  // 3.5 % of L (~3 cm for a 0.85 m leg): a sink the planted IK absorbs with the knees.
  legDrive: 0.035,
  crouch: 0, hunch: 0, guardDrop: 0, guardTuck: 0,
  strideScale: 1, armSwing: 1, sway: 1,
  // Animator defaults (DEFAULT_ANIMATOR.breathRate / breathAmplitude).
  breathRate: 0.22, breathAmp: 0.025, // wave V lane P: 4.5 s fresh (was 4.0), panting ~2 s exhausted
  headDrop: 0,
  // 14 %: a counter-move that reads (a 1.6 rad arm pulls 0.22 rad back) without doubling the speed.
  anticipation: 0.14,
});

/** Safe ranges every output is clamped into [min, max]. */
export const SAFE: Readonly<Record<keyof StyleCoeffs, readonly [number, number]>> = Object.freeze({
  windupTime: [0.75, 1.5], strikeTime: [0.88, 1.25], recoverTime: [0.75, 1.7],
  holdTime: [0.03, 0.16], settleTime: [0.04, 0.32],
  // Deeper than 1.3 pins the shoulder at its −2.4 limit for the chop (per-joint clamp lesson).
  windupDepth: [0.85, 1.3], followThrough: [0.85, 1.25], overshoot: [0, 0.16],
  chainLag: [0.006, 0.028], legDrive: [0, 0.07],
  // −4 % L .. +1.5 % L: the stand ride (0.955) must stay under the exact-IK ratio 0.96.
  crouch: [-0.04, 0.004], hunch: [-0.05, 0.2],
  guardDrop: [-0.15, 0.35], guardTuck: [0, 0.35],
    // Sway slides the planted ball laterally in proportion (ork walk: 3.5 mm at 1.0, 4.9 mm at
  // 1.41, 6.3 mm at 1.75), so it is capped where the slide stays near 4 mm.
  strideScale: [0.82, 1.12], armSwing: [0.6, 1.5], sway: [0.6, 1.25],
  breathRate: [0.18, 0.6], breathAmp: [0.012, 0.07], headDrop: [0, 0.12], anticipation: [0.05, 0.25],
});

/** The coefficient names, in a fixed order (style vectors, loops). */
export const COEFF_KEYS = Object.keys(NEUTRAL) as (keyof StyleCoeffs)[];

// ─── Race temperament and subrace twists ─────────────────────────────────────────────────────

/** A sparse change: `mul` multiplies, `add` adds (applied to the neutral base in that order). */
export interface Temperament { mul?: Partial<Record<keyof StyleCoeffs, number>>; add?: Partial<Record<keyof StyleCoeffs, number>> }

/**
 * Race temperaments. Human balanced (identity). Dwarf LOW, SHORT, HEAVY: a lower stance, 8 %
 * shorter stride, slower weighted recovery and settle, less arm swing; the stocky build absorbs
 * the overshoot. Elf LIGHT, LONG, QUICK: a taller ride, 7 % longer stride, snappier phases, a
 * shorter chain delay, little overshoot. Ork BIG wind-up, overshoot and SWAGGER: deeper cock,
 * longer follow-through, 50 % more overshoot, 20 % more sway (+ 25 % arm swing), a forward hunch.
 */
export const RACE_TEMPERAMENT: Readonly<Record<string, Temperament>> = {
  // (ork sway 1.2, not more: the safe range caps it at 1.25, see SAFE.sway)
  human: {},
  dwarf: {
    mul: { strideScale: 0.92, windupTime: 1.08, recoverTime: 1.15, windupDepth: 0.95, overshoot: 0.8, holdTime: 1.1, settleTime: 1.15, chainLag: 1.1, armSwing: 0.85, sway: 0.85, legDrive: 1.15 },
    add: { crouch: -0.02, hunch: 0.03 },
  },
  elf: {
    mul: { strideScale: 1.07, windupTime: 0.9, strikeTime: 0.94, recoverTime: 0.88, windupDepth: 0.92, overshoot: 0.75, holdTime: 0.85, settleTime: 0.85, chainLag: 0.85, armSwing: 0.95, sway: 0.9, legDrive: 0.85 },
    add: { crouch: 0.003, hunch: -0.02 },
  },
  ork: {
    mul: { windupDepth: 1.2, windupTime: 1.12, recoverTime: 1.1, overshoot: 1.5, followThrough: 1.12, chainLag: 1.05, holdTime: 1.15, armSwing: 1.25, sway: 1.2, legDrive: 1.2 },
    add: { crouch: -0.01, hunch: 0.05 },
  },
};

/** Subrace twists: a few percent on top of the race (a family resemblance, not a new race). */
export const SUBRACE_TWIST: Readonly<Record<string, Temperament>> = {
  // Humans
  imperial: { mul: { chainLag: 0.95, overshoot: 0.9 } },              // drilled: tight, controlled
  nomad: { mul: { strikeTime: 0.97, recoverTime: 0.95, strideScale: 1.03 } }, // fast and lean
  islander: { mul: { sway: 1.2, overshoot: 1.06 } },                  // sea legs: a rolling gait
  // Elves
  high: { mul: { windupDepth: 0.96 }, add: { hunch: -0.015 } },        // poised, upright
  wood: { mul: { strikeTime: 0.96, strideScale: 1.03 } },               // quick, ranging
  dark: { mul: { windupTime: 1.04, chainLag: 0.95, holdTime: 1.1 } },   // coiled, deliberate
  // Dwarves
  mountain: { mul: { recoverTime: 1.05 }, add: { crouch: -0.006 } },    // rooted
  forge: { mul: { windupDepth: 1.06, overshoot: 1.1 } },                // a smith's hammer arc
  deep: { mul: { armSwing: 0.9 }, add: { hunch: 0.02 } },               // compact, tunnel-bent
  // Orks
  greenhide: { mul: { overshoot: 1.1, sway: 1.05, armSwing: 1.05 } },   // wild
  ironhide: { mul: { recoverTime: 1.06, windupTime: 1.04 } },           // heavy
  bloodfang: { mul: { strikeTime: 0.95, windupTime: 0.96 } },           // snappy
};

// ─── Statistics, body and weapon couplings ───────────────────────────────────────────────────

/**
 * Stat normalisation: n(x) = tanh((x − STAT_CENTRE) / STAT_SPREAD) in (−1, 1). Primary stats run
 * ~1 (mage strength) .. ~14 (ork barbarian strength); 7 is the class-preset mean, 5 maps the
 * observed range to ±0.9 without saturating hard.
 */
export const STAT_CENTRE = 7, STAT_SPREAD = 5;
/** Per unit of normalised stat (see motionStyleFor for which coefficient each moves). */
export const STAT_GAIN = {
  /** Strength: a deeper cock, a longer follow-through, more overshoot (more mass thrown). */
  strengthWindup: 0.08, strengthFollow: 0.1, strengthOvershoot: 0.15, strengthHold: 0.05,
  /** Reflex: a snappier strike and wind-up, a tighter chain, a shorter settle. */
  reflexStrike: 0.06, reflexWindup: 0.06, reflexChain: 0.15, reflexSettle: 0.1,
  /** Vitality: fitter lungs (less breathing amplitude), a slightly quicker recovery. */
  vitalityBreath: 0.15, vitalityRecover: 0.04,
  /** Resilience: a sturdier, lower stance and less sway. */
  resilienceCrouch: 0.006, resilienceSway: 0.1,
  /** Focus: steadier — less seeded jitter and less overshoot. */
  focusJitter: 0.3, focusOvershoot: 0.08,
  /** Intelligence: economical — telegraphs less (smaller skill counter-move). */
  intelligenceAnticipation: 0.1,
} as const;

/**
 * Weapon heft: w = tanh(ln(I / WEAPON_I_REF) / WEAPON_I_SPREAD) in (−1, 1), I = moment of inertia
 * about the main grip (kg·m²). Longsword ~0.34 (w ≈ 0.1), war hammer / spear ~1.0 (≈ 0.75),
 * dagger ~0.01 (≈ −1). The inertia is what the arm must accelerate, so it — not the mass alone —
 * sets how long the wind-up and the recovery take.
 */
export const WEAPON_I_REF = 0.3, WEAPON_I_SPREAD = 1.2;
export const WEAPON_GAIN = {
  windupTime: 0.18, windupDepth: 0.1, followThrough: 0.12, overshoot: 0.35, recoverTime: 0.15, holdTime: 0.15,
  /**
   * J-C: the COUNTER-MOVE (StyleCoeffs.anticipation) grows with the weapon's heft — a heavy weapon
   * is cocked back further before it commits, a light one telegraphs less. With a war hammer
   * (w ≈ 0.75, anticipation 0.14 → 0.18) the shoulder counter-moves ~30 % deeper than a dagger's
   * (w ≈ −1, 0.14 → 0.08); both stay inside SAFE.anticipation [0.05, 0.25].
   */
  anticipation: 0.4,
  chainLag: 0.12, legDrive: 0.4,
  /** Two hands: the trunk drives the blow (more leg drive, a slightly longer chain). */
  twoHandLegDrive: 0.15, twoHandChain: 0.05,
  /** Handle (distance between the hands / grip length, m): a long handle gives leverage and control. */
  handleRef: 0.2, handleSpread: 0.3, handleOvershoot: 0.15, handleStrike: 0.03,
  /** Balance point from the grip (m): a tip-heavy weapon runs on after the hit. */
  balanceRef: 0.3, balanceSpread: 0.3, balanceOvershoot: 0.2, balanceFollow: 0.08,
} as const;
/** Swing-kind character: thrusts retract cleanly, chops drive from the legs and hold. */
export const KIND_TWEAK: Readonly<Record<SwingKind, Temperament>> = {
  slash: {},
  chop: { mul: { legDrive: 1.25, holdTime: 1.15 } },
  thrust: { mul: { overshoot: 0.6, followThrough: 0.92, legDrive: 0.9 } },
};

/**
 * Body: bulk b = (weight / height²) / BULK_REF (BMI over 23); a heavier body recovers and chains
 * slower. Height h: pendulum timing — durations scale (h / HEIGHT_REF)^HEIGHT_EXP (a quarter of
 * the √h of a free pendulum: limbs are driven, not falling).
 */
export const BULK_REF = 23, BULK_RECOVER = 0.08, BULK_CHAIN = 0.1, BULK_SWAY = 0.15;
export const HEIGHT_REF = 1.75, HEIGHT_EXP = 0.12;

// ─── Live modulation ─────────────────────────────────────────────────────────────────────────

/** The live state the engine feeds each frame. */
export interface LiveState {
  hpFrac: number;
  staminaFrac: number;
  manaFrac: number;
  exhausted: boolean;
  /** Smash-style accumulated damage percent (0..~300): a battered fighter is shaken. */
  damagePercent?: number;
}

/**
 * Live smoothing rate, 1/s: ln 20 / 1 s — a live change reaches 95 % in one second, so a hit that
 * takes 30 % of the health hunches the fighter over ~half a second instead of in one frame.
 */
export const LIVE_LAMBDA = Math.log(20) / 1;
/**
 * Fatigue F in [0, 1]: (1 − smoothstep(0, FATIGUE_STAMINA, stamina))·(1 − FATIGUE_EXHAUST) +
 * exhausted·FATIGUE_EXHAUST. Below 60 % stamina the body starts to tire; exhaustion adds the rest.
 */
export const FATIGUE_STAMINA = 0.6, FATIGUE_EXHAUST = 0.35;
/** Injury I in [0, 1]: 1 − smoothstep(INJURY_LOW, INJURY_HIGH, hp): healthy above 70 %, maxed at 10 %. */
export const INJURY_LOW = 0.1, INJURY_HIGH = 0.7;
/** Low mana M in [0, 1]: 1 − smoothstep(0, MANA_LOW, mana). */
export const MANA_LOW = 0.5;
/** Damage percent at which a fighter is fully shaken. */
export const SHAKEN_PERCENT = 150;
/** Per unit of fatigue F / injury I / low mana M / shaken S (see LiveGain users in #modulate). */
export const LIVE_GAIN = {
  fatigueRecover: 0.35, injuryRecover: 0.1, fatigueWindup: 0.15, fatigueStrike: 0.06, fatigueHold: 0.3,
  fatigueSettle: 0.6, injurySettle: 0.3, fatigueDepth: 0.1, fatigueOvershoot: 0.3, shakenOvershoot: 0.4,
  fatigueGuardDrop: 0.25, injuryGuardRaise: 0.1, injuryTuck: 0.25, injuryHunch: 0.14, fatigueHunch: 0.06,
  injuryCrouch: 0.012, fatigueStride: 0.1, injuryStride: 0.06, fatigueBreathAmp: 1.6, manaBreathAmp: 0.3,
  fatigueBreathRate: 1.2, fatigueHead: 0.06, manaHead: 0.05, fatigueChain: 0.25, fatigueArm: 0.25,
  fatigueLegDrive: 0.25,
} as const;
/**
 * GAMEPLAY COUPLING (the one place motion touches the attack rate): a tired / hurt fighter's
 * swing may outlast COOLDOWN_SHARE of its cooldown by OVERRUN_FATIGUE·F + OVERRUN_INJURY·I, so
 * its wind-up and heavy recovery really are slower — the engine waits for the swing before the
 * next press (Engine gates the attack on SwingDriver.active). A fresh fighter's swing always fits
 * the cooldown (unchanged attack rate). Set both to 0 to keep the attack rate independent of the
 * live state (the four phases then share the cooldown and fatigue only redistributes them).
 */
export const OVERRUN_FATIGUE = 0.35, OVERRUN_INJURY = 0.12;

// ─── Seeded per-joint variation ──────────────────────────────────────────────────────────────

/** Per-joint amplitude jitter, ± share (3 %: two fighters differ, neither looks wrong). */
export const JITTER_AMP = 0.03;
/** Per-joint timing jitter, ± s (4 ms: a quarter frame at 60 Hz, under a chain level). */
export const JITTER_LAG = 0.004;
/** Whole-style timing jitter on the phase multipliers, ± share. */
export const JITTER_TIMING = 0.02;

/** Chain depth of every joint (module comment): legs 0 … elbow 4 (the weapon/wrist is 5). */
export const CHAIN_DEPTH: Readonly<Float64Array> = (() => {
  const d = new Float64Array(JOINT_COUNT);
  const set = (names: string[], v: number) => { for (const n of names) d[JOINT_INDEX[n as keyof typeof JOINT_INDEX]] = v; };
  set(["hipL", "hipR", "kneeL", "kneeR", "ankleL", "ankleR", "toeL", "toeR"], 0);
  set(["abdomen"], 1);
  set(["spine"], 2);
  set(["neck", "head"], 2.5);
  set(["shoulderL", "shoulderR"], 3);
  set(["elbowL", "elbowR"], 4);
  return d;
})();

// ─── Inputs ──────────────────────────────────────────────────────────────────────────────────

/** Body measurements: leg geometry (or a leg length) plus optional height (m) and weight (kg). */
export interface BodyMotionInput { geometry?: LegGeometry; legLength?: number; height?: number; weight?: number }

/** The weapon as motion sees it. */
export interface WeaponMotion {
  /** Mass (kg), overall length (m), handle (distance between the hands or grip length, m). */
  mass: number;
  length: number;
  grip: number;
  hands: number;
  kind: SwingKind;
  /** Balance point from the main grip (m) and inertia about it (kg·m²), when known. */
  balance?: number;
  inertia?: number;
}

/** Map a generated weapon (lane W WeaponSpec) to its motion parameters. */
export function weaponMotionFromSpec(spec: WeaponSpec, kind: SwingKind): WeaponMotion {
  const off = spec.grips.find((g) => g.id === "off");
  const handle = off ? Math.abs(off.y) : Math.min(0.25, 0.18 * spec.length);
  return { mass: spec.mass, length: spec.length, grip: handle, hands: spec.hands, kind, balance: spec.balance, inertia: spec.inertia };
}

/**
 * Fallback for the classic Weapon (weight 1..10, balance 0..1 hilt -> tip): mass ≈ 0.3·weight kg,
 * length by type, balance = balance·0.6·length, inertia of a rod with that centre of mass.
 */
export function weaponMotionFromLegacy(w: Weapon, kind: SwingKind): WeaponMotion {
  const LEN: Record<string, number> = { sword: 1.1, axe: 1.0, dagger: 0.38, staff: 1.7, scythe: 1.8, bow: 1.4, mace: 0.85 };
  const length = LEN[w.type] ?? 1.0, mass = 0.3 * Math.max(1, w.weight);
  const balance = clamp(w.balance, 0, 1) * 0.6 * length;
  const twoHanded = w.type === "staff" || w.type === "scythe" || w.weight >= 8;
  return { mass, length, grip: twoHanded ? 0.3 : 0.12, hands: twoHanded ? 2 : 1, kind, balance, inertia: mass * (length * length / 12 + balance * balance) };
}

/** Everything a style is built from. Missing parts fall back to neutral. */
export interface MotionStyleInput {
  race: string;
  subrace?: string | null;
  seed: number;
  body?: BodyMotionInput;
  weapon?: WeaponMotion;
  stats?: Partial<Pick<CombatStats, "vitality" | "resilience" | "focus" | "reflex" | "strength" | "intelligence">>;
}

const statN = (v: number | undefined) => Math.tanh(((Number.isFinite(v) ? v! : STAT_CENTRE) - STAT_CENTRE) / STAT_SPREAD);
const fin = (v: number, d: number) => (Number.isFinite(v) ? v : d);

function applyTemperament(c: StyleCoeffs, t: Temperament | undefined): void {
  if (!t) return;
  if (t.mul) for (const k of Object.keys(t.mul) as (keyof StyleCoeffs)[]) c[k] *= t.mul[k]!;
  if (t.add) for (const k of Object.keys(t.add) as (keyof StyleCoeffs)[]) c[k] += t.add[k]!;
}

function clampAll(c: StyleCoeffs): void {
  for (const k of COEFF_KEYS) { const [lo, hi] = SAFE[k]; c[k] = clamp(fin(c[k], NEUTRAL[k]), lo, hi); }
}

// ─── The style ───────────────────────────────────────────────────────────────────────────────

/** A fighter's motion style: static base + smoothed live modulation (module comment). */
export class MotionStyle {
  /** Coefficients from race, subrace, body, weapon and stats (fixed). */
  readonly base: StyleCoeffs;
  /** Effective coefficients this frame (base × live), clamped into SAFE. Mutated in place. */
  readonly eff: StyleCoeffs;
  /** Per-joint amplitude multiplier (seeded, 1 ± JITTER_AMP·jitter scale), JOINT_ORDER. */
  readonly jointAmp: Float64Array;
  /** Per-joint timing jitter, s (seeded, ± JITTER_LAG·jitter scale), JOINT_ORDER. */
  readonly jointJitter: Float64Array;
  /** Swing-DOF amplitude multipliers [shoulder, elbow, blade, roll, lean, twist] (seeded). */
  readonly swingAmp: Float64Array;
  /** Breathing phase offset, rad (seeded: two fighters do not breathe in step). */
  readonly breathPhase: number;
  readonly kind: SwingKind;
  readonly race: string;
  readonly subrace: string | null;
  /** The smoothed live state the style currently shows. */
  readonly live = { hp: 1, stamina: 1, mana: 1, exhausted: 0, shaken: 0 };
  readonly #target = { hp: 1, stamina: 1, mana: 1, exhausted: 0, shaken: 0 };
  #owner: unknown = null;

  constructor(base: StyleCoeffs, seed: number, jitterScale: number, kind: SwingKind, race: string, subrace: string | null) {
    this.base = base;
    this.kind = kind;
    this.race = race;
    this.subrace = subrace;
    const rnd = rng32((Number.isFinite(seed) ? Math.trunc(seed) : 0) ^ 0x9e3779b9);
    const js = clamp(fin(jitterScale, 1), 0, 1.5);
    this.jointAmp = new Float64Array(JOINT_COUNT);
    this.jointJitter = new Float64Array(JOINT_COUNT);
    for (let j = 0; j < JOINT_COUNT; j++) {
      this.jointAmp[j] = 1 + JITTER_AMP * js * (2 * rnd() - 1);
      this.jointJitter[j] = JITTER_LAG * js * (2 * rnd() - 1);
    }
    this.swingAmp = new Float64Array(6);
    for (let k = 0; k < 6; k++) this.swingAmp[k] = 1 + JITTER_AMP * js * (2 * rnd() - 1);
    for (const k of ["windupTime", "strikeTime", "recoverTime", "holdTime", "settleTime"] as const) base[k] *= 1 + JITTER_TIMING * js * (2 * rnd() - 1);
    clampAll(base);
    this.breathPhase = 2 * Math.PI * rnd();
    this.eff = { ...base };
    this.#modulate();
  }

  /**
   * The first caller becomes the one that steps the live smoothing (the Animator, when the engine
   * hands one style to both the Animator and the SwingDriver), so a shared style is stepped once
   * per frame. Returns true when `owner` steps it.
   */
  claim(owner: unknown): boolean {
    if (this.#owner === null) this.#owner = owner;
    return this.#owner === owner;
  }

  /** Set the live target (smoothed by step). Non-finite values are ignored (keep the last). */
  setLive(l: Readonly<LiveState>): void {
    const t = this.#target;
    if (Number.isFinite(l.hpFrac)) t.hp = clamp(l.hpFrac, 0, 1);
    if (Number.isFinite(l.staminaFrac)) t.stamina = clamp(l.staminaFrac, 0, 1);
    if (Number.isFinite(l.manaFrac)) t.mana = clamp(l.manaFrac, 0, 1);
    t.exhausted = l.exhausted ? 1 : 0;
    const d = l.damagePercent;
    t.shaken = Number.isFinite(d) ? clamp(d! / SHAKEN_PERCENT, 0, 1) : 0;
  }

  /** Jump straight to a live state (spawn, tests, the report). */
  setLiveImmediate(l: Readonly<LiveState>): void {
    this.setLive(l);
    Object.assign(this.live, this.#target);
    this.#modulate();
  }

  /** Advance the live smoothing by dt seconds and refresh `eff` (no allocation). */
  step(dt: number): void {
    const h = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
    const k = 1 - Math.exp(-LIVE_LAMBDA * h), l = this.live, t = this.#target;
    l.hp += (t.hp - l.hp) * k;
    l.stamina += (t.stamina - l.stamina) * k;
    l.mana += (t.mana - l.mana) * k;
    l.exhausted += (t.exhausted - l.exhausted) * k;
    l.shaken += (t.shaken - l.shaken) * k;
    this.#modulate();
  }

  /** Fatigue, injury, low mana, shaken (each 0..1) of the smoothed live state. */
  factors(): { fatigue: number; injury: number; lowMana: number; shaken: number } {
    const l = this.live;
    return {
      fatigue: (1 - smoothstep(0, FATIGUE_STAMINA, l.stamina)) * (1 - FATIGUE_EXHAUST) + l.exhausted * FATIGUE_EXHAUST,
      injury: 1 - smoothstep(INJURY_LOW, INJURY_HIGH, l.hp),
      lowMana: 1 - smoothstep(0, MANA_LOW, l.mana),
      shaken: l.shaken,
    };
  }

  /** eff = base modulated by the smoothed live state, clamped. */
  #modulate(): void {
    const b = this.base, e = this.eff, G = LIVE_GAIN, l = this.live;
    const F = (1 - smoothstep(0, FATIGUE_STAMINA, l.stamina)) * (1 - FATIGUE_EXHAUST) + l.exhausted * FATIGUE_EXHAUST;
    const I = 1 - smoothstep(INJURY_LOW, INJURY_HIGH, l.hp);
    const M = 1 - smoothstep(0, MANA_LOW, l.mana);
    const S = l.shaken;
    e.windupTime = b.windupTime * (1 + G.fatigueWindup * F);
    e.strikeTime = b.strikeTime * (1 + G.fatigueStrike * F);
    e.recoverTime = b.recoverTime * (1 + G.fatigueRecover * F + G.injuryRecover * I);
    e.holdTime = b.holdTime * (1 + G.fatigueHold * F);
    e.settleTime = b.settleTime * (1 + G.fatigueSettle * F + G.injurySettle * I);
    e.windupDepth = b.windupDepth * (1 - G.fatigueDepth * F);
    e.followThrough = b.followThrough;
    e.overshoot = b.overshoot * (1 + G.fatigueOvershoot * F + G.shakenOvershoot * S);
    e.chainLag = b.chainLag * (1 + G.fatigueChain * F);
    e.legDrive = b.legDrive * (1 - G.fatigueLegDrive * F);
    e.crouch = b.crouch - G.injuryCrouch * I;
    e.hunch = b.hunch + G.injuryHunch * I + G.fatigueHunch * F;
    e.guardDrop = b.guardDrop + G.fatigueGuardDrop * F - G.injuryGuardRaise * I;
    e.guardTuck = b.guardTuck + G.injuryTuck * I;
    e.strideScale = b.strideScale * (1 - G.fatigueStride * F - G.injuryStride * I);
    e.armSwing = b.armSwing * (1 - G.fatigueArm * F);
    e.sway = b.sway;
    e.breathRate = b.breathRate * (1 + G.fatigueBreathRate * F);
    e.breathAmp = b.breathAmp * (1 + G.fatigueBreathAmp * F + G.manaBreathAmp * M);
    e.headDrop = b.headDrop + G.fatigueHead * F + G.manaHead * M;
    e.anticipation = b.anticipation;
    clampAll(e);
  }

  /** Share a swing may outlast its cooldown share this frame (OVERRUN_FATIGUE / OVERRUN_INJURY). */
  swingOverrun(): number {
    const f = this.factors();
    return OVERRUN_FATIGUE * f.fatigue + OVERRUN_INJURY * f.injury;
  }

  /** Lead (s) of a joint ahead of the weapon: (5 − chain depth)·chainLag + its seeded jitter. */
  jointLead(j: number): number {
    return (5 - CHAIN_DEPTH[j]) * this.eff.chainLag + this.jointJitter[j];
  }
}

/** Build a fighter's style (module comment). Total: any input gives a finite, in-range style. */
export function motionStyleFor(input: MotionStyleInput): MotionStyle {
  const c: StyleCoeffs = { ...NEUTRAL };
  const race = String(input.race ?? "human"), subrace = input.subrace ?? null;
  applyTemperament(c, RACE_TEMPERAMENT[race]);
  if (subrace) applyTemperament(c, SUBRACE_TWIST[subrace]);
  // Stats.
  const st = input.stats ?? {}, SG = STAT_GAIN;
  const S = statN(st.strength), R = statN(st.reflex), V = statN(st.vitality), Re = statN(st.resilience), W = statN(st.focus), In = statN(st.intelligence);
  c.windupDepth *= 1 + SG.strengthWindup * S;
  c.followThrough *= 1 + SG.strengthFollow * S;
  c.overshoot *= (1 + SG.strengthOvershoot * S) * (1 - SG.focusOvershoot * W);
  c.holdTime *= 1 + SG.strengthHold * S;
  c.strikeTime *= 1 - SG.reflexStrike * R;
  c.windupTime *= 1 - SG.reflexWindup * R;
  c.chainLag *= 1 - SG.reflexChain * R;
  c.settleTime *= 1 - SG.reflexSettle * R;
  c.breathAmp *= 1 - SG.vitalityBreath * V;
  c.recoverTime *= 1 - SG.vitalityRecover * V;
  c.crouch -= SG.resilienceCrouch * Re;
  c.sway *= 1 - SG.resilienceSway * Re;
  c.anticipation *= 1 - SG.intelligenceAnticipation * In;
  // Body.
  const body = input.body ?? {};
  const L = body.geometry ? legLength(body.geometry) : fin(body.legLength ?? Number.NaN, 0.85);
  const height = fin(body.height ?? Number.NaN, L > 0 ? L / 0.49 : HEIGHT_REF);
  const h = clamp(height, 0.8, 3);
  const bulk = clamp(fin(body.weight ?? Number.NaN, BULK_REF * h * h) / (h * h) / BULK_REF, 0.5, 2.5);
  const tScale = Math.pow(h / HEIGHT_REF, HEIGHT_EXP);
  c.windupTime *= tScale; c.recoverTime *= tScale * (1 + BULK_RECOVER * (bulk - 1));
  c.chainLag *= 1 + BULK_CHAIN * (bulk - 1);
  c.sway *= 1 + BULK_SWAY * (bulk - 1);
  // Weapon.
  const wpn = input.weapon;
  const kind: SwingKind = wpn?.kind === "chop" || wpn?.kind === "thrust" ? wpn.kind : "slash";
  if (wpn) {
    const WG = WEAPON_GAIN;
    const mass = clamp(fin(wpn.mass, 1.2), 0.05, 20), len = clamp(fin(wpn.length, 1), 0.1, 4);
    const bal = clamp(fin(wpn.balance ?? Number.NaN, 0.4 * len), -len, len);
    const inertia = clamp(fin(wpn.inertia ?? Number.NaN, mass * (len * len / 12 + bal * bal)), 1e-4, 50);
    const w = Math.tanh(Math.log(inertia / WEAPON_I_REF) / WEAPON_I_SPREAD);
    c.windupTime *= 1 + WG.windupTime * w;
    c.windupDepth *= 1 + WG.windupDepth * w;
    c.followThrough *= 1 + WG.followThrough * w;
    c.overshoot *= 1 + WG.overshoot * w;
    c.recoverTime *= 1 + WG.recoverTime * w;
    c.holdTime *= 1 + WG.holdTime * w;
    c.chainLag *= 1 + WG.chainLag * w;
    c.legDrive *= 1 + WG.legDrive * w;
    // J-C: the counter-move deepens with the weapon's heft (the wind-up is cocked further back,
    // and longer through windupTime), so a heavy archetype telegraphs more than a light one.
    c.anticipation *= 1 + WG.anticipation * w;
    if (fin(wpn.hands, 1) >= 1.5) { c.legDrive *= 1 + WG.twoHandLegDrive; c.chainLag *= 1 + WG.twoHandChain; }
    const hn = Math.tanh((clamp(fin(wpn.grip, 0.15), 0, 2) - WG.handleRef) / WG.handleSpread);
    c.overshoot *= 1 - WG.handleOvershoot * hn;
    c.strikeTime *= 1 + WG.handleStrike * hn;
    const bn = Math.tanh((bal - WG.balanceRef) / WG.balanceSpread);
    c.overshoot *= 1 + WG.balanceOvershoot * bn;
    c.followThrough *= 1 + WG.balanceFollow * bn;
  }
  applyTemperament(c, KIND_TWEAK[kind]);
  clampAll(c);
  return new MotionStyle(c, input.seed, 1 - STAT_GAIN.focusJitter * W, kind, race, subrace);
}

// ─── Measuring how different styles are ──────────────────────────────────────────────────────

/** Scale of each coefficient in a style vector (a 1-scale difference = 1.0 in the vector). */
const VECTOR_SCALE: Readonly<Record<keyof StyleCoeffs, number>> = {
  windupTime: 1, strikeTime: 1, recoverTime: 1, holdTime: NEUTRAL.holdTime, settleTime: NEUTRAL.settleTime,
  windupDepth: 1, followThrough: 1, overshoot: NEUTRAL.overshoot, chainLag: NEUTRAL.chainLag, legDrive: NEUTRAL.legDrive,
  // Offsets: scaled by a "clearly visible" amount (2 % L, 0.1 rad).
  crouch: 0.02, hunch: 0.1, guardDrop: 0.1, guardTuck: 0.1,
  strideScale: 1, armSwing: 1, sway: 1, breathRate: NEUTRAL.breathRate, breathAmp: NEUTRAL.breathAmp, headDrop: 0.1,
  anticipation: NEUTRAL.anticipation,
};

/**
 * The style's effective coefficients as a dimensionless vector (COEFF_KEYS order): each
 * coefficient divided by its scale (multipliers by 1, durations by the neutral value, offsets by
 * a visible amount), so a 5 % change of any one reads as 0.05.
 */
export function styleVector(s: MotionStyle): number[] {
  return COEFF_KEYS.map((k) => s.eff[k] / VECTOR_SCALE[k]);
}
styleVector.fields = COEFF_KEYS as readonly string[];

/** RMS difference of two style vectors (0 = identical; 0.05 ≈ 5 % average difference per coefficient). */
export function styleDistance(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s / Math.max(1, n));
}
