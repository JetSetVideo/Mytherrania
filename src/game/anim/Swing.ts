// Weapon swings for the plain attack (lane X2, W05/W08): forward-reaching, weapon-shaped strikes
// with a step-in, an aim yaw, and a contact hold. Pure module (no THREE): angles in radians in the
// Skeleton convention (Rig.ts header), lengths in metres, times in seconds.
//
// Vocabulary
//   arm plane      the right arm's sagittal plane. The Skeleton's arm joints are single-axis (x),
//                  so the shoulder, the elbow and the wrist pitch (the rig's grip group rotation.x)
//                  all turn in it. A direction angle a in that plane is d(a) = (forward: sin a,
//                  up: cos a): a = 0 points up, +π/2 forward (+z), π down.
//   blade angle β  the weapon axis (+y of the weapon frame, grip -> tip) in the arm plane, measured
//                  in the WORLD's vertical plane. Pitches add up along the chain from the chest (the
//                  spine bone carries the shoulders, so its lean λ tilts the whole arm plane) and the
//                  hanging arm points down (π): the upper arm is at π + λ + θs, the forearm at
//                  π + λ + θs + θe, and the blade at β = λ + θs + θe + gp (forward grip; a reverse
//                  grip turns the weapon frame by π). The wrist pitch that holds a wanted blade
//                  angle is  gp = β − λ − θs − θe (− π reverse).
//   swing kind     slash (swords, axes, scythes, halberds: a diagonal cut from over the right
//                  shoulder down through the target), chop (hammers, maces, mauls, two-handed
//                  heavies: a straight overhead blow), thrust (spears, rapiers, reverse daggers,
//                  bows: the hand drives in a straight line, point first) — DERIVED from the
//                  weapon's damage mix (swingKindOf).
//   phases         windup (cock) -> strike (the fast part) -> recover (back to guard). Keys: guard,
//                  windup (cocked), strike (follow-through past the target line), guard again.
//   step           forward travel of the body during windup + strike, m, chosen at the press so the
//                  blade's sweet spot meets the target: D − sweet distance, in [−STEP_BACK, STEP_MAX]
//                  (a long weapon pressed too close takes a half step back).
//   aim yaw        body yaw that puts the arm plane through the target: sin ψ = armOffset / D.
//   contact hold   a contact freezes the swing at the contact instant for CONTACT_HOLD s (the blade
//                  visibly stops at the body), then the arm recovers from THAT pose to guard.

import { clamp, clamp01, easeInOutCubic, lerp, smoothstep, smootherstep } from "../../core/MathCore.ts";
import { hermite, recoveryCurve, strikeProgress } from "../AnimationCurve.ts";
import type { DamageKind, WeaponClass } from "../../combat/contracts.ts";
import type { JointName } from "../Skeleton.ts";
import { JOINT_COUNT, JOINT_INDEX, type JointLimitTable } from "./Rig.ts";
import { GUARD_POSE } from "./Poses.ts";

/** The three swing families (module comment). */
export type SwingKind = "slash" | "chop" | "thrust";

/** One key of a swing, every DOF the swing drives (radians unless noted). */
export interface SwingKey {
  /** Right shoulder pitch (−: arm raised forward/up). */
  shoulder: number;
  /** Right elbow (0 straight, − flexed). */
  elbow: number;
  /** Blade angle β in the arm plane (0 up, π/2 forward, π down). */
  blade: number;
  /** Grip roll: tilts the blade out of the arm plane (+ toward the holder's right). */
  roll: number;
  /** Chest pitch (spine; + leans forward). The abdomen takes half. */
  lean: number;
  /** Body yaw added to the facing (+ turns toward the holder's left): the trunk's twist. */
  twist: number;
}

/**
 * A swing shape: the cocked key and the follow-through key (the guard key frames both ends).
 * `hand` (thrusts): hand positions [forward, up] relative to the shoulder in the WORLD's vertical
 * plane, m, for the two keys — the strike phase then moves the hand on a STRAIGHT line and solves
 * the arm (armIK, minus the key's lean), so the point travels along the blade instead of on an
 * arc. The keys' shoulder/elbow are ignored then.
 */
export interface SwingShape {
  kind: SwingKind;
  windup: SwingKey;
  strike: SwingKey;
  hand?: { windup: [number, number]; strike: [number, number] };
  /**
   * Where on the target the blade is aimed, m sideways from its centre line (+ = the holder's
   * left): a diagonal cut goes for the shoulder/neck junction on the holder's right, a thrust for
   * the centre. Without it a vertical blade on the centre line always meets the head first.
   */
  aimLateral: number;
  /**
   * Share of the windup after which the blade may land (the strike window opens): a cut can meet a
   * close body while it cocks; a thrust's windup PULLS BACK, so it only lands once it drives forward.
   */
  windowLead: number;
}

/** Guard key = the Animator's GUARD_POSE right arm + trunk, blade up and a little forward. */
export const GUARD_KEY: SwingKey = {
  shoulder: GUARD_POSE.shoulderR ?? -1.0, elbow: GUARD_POSE.elbowR ?? -1.45,
  blade: 0.35, roll: 0, lean: GUARD_POSE.spine ?? 0.12, twist: 0,
};

/**
 * The swing shapes. Windup keys cock the weapon above/behind the strike line; strike keys are the
 * follow-through PAST the target line, so mid-strike the blade crosses the space in front of the
 * chest. Joint values stay inside defaultHumanoid's limits (shoulder −2.4..0.6, elbow −2.6..0,
 * spine −0.6..0.6). Blade arcs: slash 1.95 rad, chop 2.8 rad. The thrust's roll (−0.08) angles the
 * point a little in toward the midline and the butt of a long haft OUT, clear of the hip.
 */
export const SWING_SHAPES: Record<SwingKind, SwingShape> = {
  slash: {
    kind: "slash",
    windup: { shoulder: -2.25, elbow: -1.0, blade: 0.25, roll: 0.35, lean: -0.1, twist: -0.22 },
    strike: { shoulder: -0.8, elbow: -0.06, blade: 2.2, roll: -0.3, lean: 0.24, twist: 0.2 },
    aimLateral: -0.17,
    windowLead: 0.9,
  },
  chop: {
    kind: "chop",
    windup: { shoulder: -2.4, elbow: -1.4, blade: -0.35, roll: 0, lean: -0.18, twist: -0.1 },
    strike: { shoulder: -0.7, elbow: -0.05, blade: 2.45, roll: 0, lean: 0.3, twist: 0.08 },
    aimLateral: -0.12,
    windowLead: 0.9,
  },
  thrust: {
    kind: "thrust",
    windup: { shoulder: 0, elbow: -2, blade: Math.PI / 2, roll: -0.08, lean: -0.06, twist: -0.06 },
    strike: { shoulder: -1.4, elbow: -0.05, blade: Math.PI / 2 + 0.05, roll: -0.08, lean: 0.22, twist: 0.03 },
    hand: { windup: [0.2, -0.3], strike: [0.64, -0.2] },
    aimLateral: 0,
    windowLead: 1,
  },
};

/** Share of the damage mix that makes a weapon a thrusting weapon (spear 0.88, rapier 0.85, longsword 0.45). */
export const THRUST_SHARE_MIN = 0.6;
/** Share of blunt damage that makes a weapon a chopper (warhammer 0.65, staff 0.9, axe 0.25). */
export const BLUNT_SHARE_MIN = 0.5;

/**
 * The swing a weapon uses, derived from what it does best: a mostly-thrusting weapon thrusts
 * (mix.thrust ≥ THRUST_SHARE_MIN), a mostly-blunt one or a two-handed heavy one chops overhead
 * (mix.blunt ≥ BLUNT_SHARE_MIN, or heavy class with hands ≥ 2), everything else slashes.
 * `mix` is the damage mix for the grip in use (lane W profileTerms: a reverse dagger is 0.85 thrust).
 */
export function swingKindOf(mix: Record<DamageKind, number>, weaponClass: WeaponClass, hands: number): SwingKind {
  if (mix.thrust >= THRUST_SHARE_MIN) return "thrust";
  if (mix.blunt >= BLUNT_SHARE_MIN || (weaponClass === "heavy" && hands >= 2)) return "chop";
  return "slash";
}

/**
 * Phase durations of one swing, s. Lane M (styled swings) adds the hit `hold` after the strike
 * and the `settle` hold at guard after the recovery; absent = 0 (today's three-phase swing).
 */
export interface SwingTiming { windup: number; strike: number; recover: number; hold?: number; settle?: number }

/** Strike-phase clamp, s: fast enough to read as a blow, slow enough for the joint speed limit. */
export const STRIKE_MIN = 0.12, STRIKE_MAX = 0.5;
/** Windup = WINDUP_BASE + WINDUP_RATIO · strike (a heavier swing cocks longer); never below WINDUP_MIN. */
export const WINDUP_BASE = 0.1, WINDUP_RATIO = 0.55, WINDUP_MIN = 0.08;
/** Recover = RECOVER_BASE + RECOVER_RATIO · strike; never below RECOVER_MIN. */
export const RECOVER_BASE = 0.12, RECOVER_RATIO = 0.7, RECOVER_MIN = 0.1;
/** The whole swing fits in this share of the swing cooldown when it can (windup/recover give first). */
export const COOLDOWN_SHARE = 0.9;
/** Mean / peak angular speed of a smootherstep strike (∫ of 30u²(1−u)² is 1, its peak is 15/8). */
export const MEAN_TO_PEAK = 8 / 15;

/**
 * Strike duration of a swing, s. Swings: the blade's arc |Δβ| at the weapon's PEAK angular speed ω
 * (lane W profileTerms.omega, rad/s): strike = |Δβ| / (ω · MEAN_TO_PEAK). Thrusts: lane W's thrust
 * time (s, from force and mass). Clamped to [STRIKE_MIN, STRIKE_MAX].
 */
export function strikeDuration(shape: SwingShape, omega: number, thrustTime: number): number {
  const raw = shape.kind === "thrust" ? thrustTime : Math.abs(shape.strike.blade - shape.windup.blade) / (Math.max(1, omega) * MEAN_TO_PEAK);
  return clamp(Number.isFinite(raw) ? raw : 0.2, STRIKE_MIN, STRIKE_MAX);
}

/**
 * Phase durations from the strike duration (s) and the swing cooldown (s): windup and recover follow
 * the strike; when the total exceeds COOLDOWN_SHARE · cooldown, the windup and recover shrink first
 * (to WINDUP_MIN / RECOVER_MIN), the strike — the weapon's own speed — is never compressed.
 */
export function swingTiming(strike: number, cooldown: number): SwingTiming {
  const s = clamp(Number.isFinite(strike) ? strike : 0.2, STRIKE_MIN, STRIKE_MAX);
  let windup = WINDUP_BASE + WINDUP_RATIO * s, recover = RECOVER_BASE + RECOVER_RATIO * s;
  const cap = Number.isFinite(cooldown) && cooldown > 0 ? COOLDOWN_SHARE * cooldown : Infinity;
  const spare = cap - s, soft = windup + recover;
  if (spare < soft) {
    const k = clamp((spare - WINDUP_MIN - RECOVER_MIN) / Math.max(1e-6, soft - WINDUP_MIN - RECOVER_MIN), 0, 1);
    windup = WINDUP_MIN + k * (windup - WINDUP_MIN);
    recover = RECOVER_MIN + k * (recover - RECOVER_MIN);
  }
  return { windup, strike: s, recover };
}

/** Total length of a timing, s. */
export function swingDuration(t: SwingTiming): number { return t.windup + t.strike + t.recover + (t.hold ?? 0) + (t.settle ?? 0); }

/**
 * The strike window in SECONDS since the press: from `lead` (the shape's windowLead) of the way
 * through the windup to the strike's end plus WINDOW_TRAIL of the recover (the follow-through still
 * cuts).
 */
export const WINDOW_TRAIL = 0.25;
export function swingWindow(t: SwingTiming, lead = 0.9): { start: number; end: number } {
  // A styled swing brakes to rest at the follow-through and holds there: the blade cuts until the
  // end of the hold (it is still at the target line's far side), never during the recovery.
  if (t.hold !== undefined) return { start: lead * t.windup, end: t.windup + t.strike + t.hold };
  return { start: lead * t.windup, end: t.windup + t.strike + WINDOW_TRAIL * t.recover };
}

/** A swing sample: the DOFs at one instant (see SwingKey), plus its step share and blend weight. */
export interface SwingSample extends SwingKey {
  /** Share 0..1 of the step covered so far. */
  step: number;
  /** 0..1 blend weight of the swing (yaw, grip): rises over the windup, falls over the recover. */
  weight: number;
}

/** A fresh sample (guard). */
export function newSwingSample(): SwingSample { return { ...GUARD_KEY, step: 0, weight: 0 }; }

function mixKey(a: SwingKey, b: SwingKey, u: number, out: SwingKey): void {
  out.shoulder = lerp(a.shoulder, b.shoulder, u);
  out.elbow = lerp(a.elbow, b.elbow, u);
  out.blade = lerp(a.blade, b.blade, u);
  out.roll = lerp(a.roll, b.roll, u);
  out.lean = lerp(a.lean, b.lean, u);
  out.twist = lerp(a.twist, b.twist, u);
}

/** Planar arm geometry of a body, m (from its bind bones). */
export interface ArmGeometry {
  /** Shoulder -> elbow and elbow -> grip centre lengths. */
  upper: number;
  fore: number;
  /** Shoulder height above the soles and lateral offset from the body axis (|x|). */
  shoulderHeight: number;
  shoulderLateral: number;
}

/** Arm geometry from the anatomy's right shoulder head, elbow head and grip point (bind pose, m). */
export function armGeometry(shoulder: ArrayLike<number>, elbow: ArrayLike<number>, grip: ArrayLike<number>): ArmGeometry {
  const d = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return { upper: d(shoulder, elbow), fore: d(elbow, grip), shoulderHeight: shoulder[1], shoulderLateral: Math.abs(shoulder[0]) };
}

/** Keep a reached hand this far (m) short of the straight arm so the elbow never locks. */
export const IK_SLACK = 0.01;

/**
 * Planar two-bone IK for the right arm: shoulder and elbow pitches that put the grip at
 * (forward, up) m from the shoulder. With φ = atan2(forward, up) the target's direction angle,
 * r its distance (≤ upper + fore − IK_SLACK), α the shoulder's angle to the target and γ the
 * elbow's interior angle (law of cosines):  θs = φ + α − π,  θe = −(π − γ)  (flexion, ≤ 0).
 */
export function armIK(arm: ArmGeometry, forward: number, up: number, out: { shoulder: number; elbow: number }): { shoulder: number; elbow: number } {
  const U = arm.upper, F = arm.fore;
  const r = clamp(Math.hypot(forward, up), Math.abs(U - F) + 1e-4, U + F - IK_SLACK);
  const phi = Math.atan2(forward, up);
  const alpha = Math.acos(clamp((U * U + r * r - F * F) / (2 * U * r), -1, 1));
  const gamma = Math.acos(clamp((U * U + F * F - r * r) / (2 * U * F), -1, 1));
  out.shoulder = phi + alpha - Math.PI;
  out.elbow = -(Math.PI - gamma);
  return out;
}

const IK_OUT = { shoulder: 0, elbow: 0 };

/** The swing's windup and strike keys for an arm: hand-path shapes get their arm from armIK. */
function keysFor(shape: SwingShape, arm: ArmGeometry | null, k1: SwingKey, k2: SwingKey): void {
  Object.assign(k1, shape.windup);
  Object.assign(k2, shape.strike);
  if (!shape.hand || !arm) return;
  // armIK solves in the world's vertical plane; the shoulder joint sits in the chest frame (− lean).
  armIK(arm, shape.hand.windup[0], shape.hand.windup[1], IK_OUT); k1.shoulder = IK_OUT.shoulder - k1.lean; k1.elbow = IK_OUT.elbow;
  armIK(arm, shape.hand.strike[0], shape.hand.strike[1], IK_OUT); k2.shoulder = IK_OUT.shoulder - k2.lean; k2.elbow = IK_OUT.elbow;
}

const K1: SwingKey = { ...GUARD_KEY }, K2: SwingKey = { ...GUARD_KEY };

/**
 * The swing's DOFs at strike progress u (0..1, geometry only): keys mixed linearly, a hand-path
 * shape's hand moved on its straight line and the arm solved by armIK.
 */
export function strikeKeyAt(shape: SwingShape, arm: ArmGeometry | null, u: number, out: SwingKey): SwingKey {
  keysFor(shape, arm, K1, K2);
  mixKey(K1, K2, u, out);
  if (shape.hand && arm) {
    const h = shape.hand;
    armIK(arm, lerp(h.windup[0], h.strike[0], u), lerp(h.windup[1], h.strike[1], u), IK_OUT);
    out.shoulder = IK_OUT.shoulder - out.lean; out.elbow = IK_OUT.elbow;
  }
  return out;
}

/**
 * The swing's DOFs at `clock` seconds after the press (not frozen). Easing: the windup and recover
 * are easeInOutCubic (start and end at rest), the strike is smootherstep — zero speed at the cocked
 * key and at the follow-through, PEAK speed (15/8 of the mean) mid-strike where the blade crosses
 * the target line. The step follows smoothstep over windup + strike. `arm` drives hand-path shapes.
 */
export function sampleSwing(shape: SwingShape, t: SwingTiming, clock: number, out: SwingSample, arm: ArmGeometry | null = null): SwingSample {
  const c = Math.max(0, clock), w1 = t.windup, s1 = w1 + t.strike, end = s1 + t.recover;
  keysFor(shape, arm, K1, K2);
  if (c < w1) mixKey(GUARD_KEY, K1, easeInOutCubic(clamp01(c / Math.max(1e-6, w1))), out);
  else if (c < s1) strikeKeyAt(shape, arm, smootherstep(0, 1, (c - w1) / Math.max(1e-6, t.strike)), out);
  else mixKey(K2, GUARD_KEY, easeInOutCubic(clamp01((c - s1) / Math.max(1e-6, t.recover))), out);
  out.step = smoothstep(0, s1, c);
  out.weight = c >= end ? 0 : smoothstep(0, 0.5 * w1, c) * (1 - smoothstep(s1 + 0.5 * t.recover, end, c));
  return out;
}

/**
 * Write the swing's joints into a dense JOINT_ORDER pose for the Animator's attack layer (an
 * override over the upper body): the right arm from the sample, the left arm in guard (or mirroring
 * the right arm when the weapon is held with two hands), the chest lean split spine 1 : abdomen ½,
 * the neck and head countering the lean so the eyes stay on the target. Clamped into `lim`.
 */
export function swingPose(
  s: SwingKey, twoHanded: boolean, lim: JointLimitTable, out: Float64Array, offArm: { shoulder: number; elbow: number } | null = null,
  mirrorBias: { shoulder: number; elbow: number } | null = null,
): Float64Array {
  for (let j = 0; j < JOINT_COUNT; j++) out[j] = lim.rest[j];
  const set = (n: JointName, v: number) => { const j = JOINT_INDEX[n]; out[j] = clamp(v, lim.min[j], lim.max[j]); };
  for (const n in GUARD_POSE) set(n as JointName, GUARD_POSE[n as JointName]!);
  // Lane M: the styled guard of the free arm (lowered when tired, tucked when hurt).
  if (offArm) { set("shoulderL", (GUARD_POSE.shoulderL ?? 0) + offArm.shoulder); set("elbowL", (GUARD_POSE.elbowL ?? 0) + offArm.elbow); }
  set("shoulderR", s.shoulder);
  set("elbowR", s.elbow);
  if (twoHanded) { set("shoulderL", s.shoulder + (mirrorBias ? mirrorBias.shoulder : 0)); set("elbowL", s.elbow + (mirrorBias ? mirrorBias.elbow : 0)); }
  set("spine", s.lean);
  set("abdomen", 0.5 * s.lean);
  set("neck", -0.5 * s.lean);
  set("head", -0.25 * s.lean);
  return out;
}

/** Wrist pitch (rig grip rotation.x) that holds world blade angle β with the given chest lean and arm (module comment). */
export function gripPitchFor(blade: number, lean: number, shoulder: number, elbow: number, reverse: boolean): number {
  return blade - lean - shoulder - elbow - (reverse ? Math.PI : 0);
}

/**
 * A point `r` m along the blade at a swing key, in the world's vertical plane relative to the
 * shoulder: returns [forward, up] (m). Hand = upper·d(π + λ + θs) + fore·d(π + λ + θs + θe);
 * point = hand + r·d(β).
 */
export function bladePoint(arm: ArmGeometry, k: SwingKey, r: number, out: [number, number] = [0, 0]): [number, number] {
  const a1 = Math.PI + k.lean + k.shoulder, a2 = a1 + k.elbow;
  out[0] = arm.upper * Math.sin(a1) + arm.fore * Math.sin(a2) + r * Math.sin(k.blade);
  out[1] = arm.upper * Math.cos(a1) + arm.fore * Math.cos(a2) + r * Math.cos(k.blade);
  return out;
}

/** Torso half-depth a blade must still travel past the target's centre line to land, m. */
export const TARGET_HALF_DEPTH = 0.12;
/** Where along the blade the sweet spot sits (share of the tip distance). */
export const SWEET_SHARE = 0.72;
/** The torso band, relative to the attacker's shoulder height (m): where a blow should land. */
export const TORSO_BAND: [number, number] = [-0.5, 0.2];
/** Strike-path samples used to measure the reach. */
export const REACH_SAMPLES = 24;
/** Most the body steps in during one swing, m (lane X measured 0.6 m lets a 0.8 m strike reach 1.2 m). */
export const STEP_MAX = 0.55;
/** Most a swing steps BACK when pressed inside its sweet distance, m (a half step). */
export const STEP_BACK = 0.3;
/** Engage while the target is inside sweet distance + this share of STEP_MAX (headroom for drift). */
export const ENGAGE_STEP_SHARE = 0.75;

/**
 * Sweet distance, m (centre to centre): the farthest the target's centre line may sit for the
 * blade's sweet spot (SWEET_SHARE · tip) to cross it inside the torso band during the strike:
 *   D_sweet = max_u { forward(bladePoint(strikeKeyAt(u), SWEET_SHARE · tip)) : up ∈ TORSO_BAND }
 *             + TARGET_HALF_DEPTH.
 * `tip` is the weapon's tip distance from the grip (m). Floored at 0.4 m.
 */
export function sweetDistance(shape: SwingShape, arm: ArmGeometry, tip: number): number {
  const k: SwingKey = { ...GUARD_KEY }, p: [number, number] = [0, 0];
  let best = 0;
  for (let i = 0; i <= REACH_SAMPLES; i++) {
    strikeKeyAt(shape, arm, i / REACH_SAMPLES, k);
    bladePoint(arm, k, SWEET_SHARE * tip, p);
    if (p[1] >= TORSO_BAND[0] && p[1] <= TORSO_BAND[1]) best = Math.max(best, p[0]);
  }
  return Math.max(0.4, best + TARGET_HALF_DEPTH);
}

/** Step for a press at distance D (m): close (or open) the gap to the sweet distance. */
export function stepInFor(distance: number, sweet: number): number {
  return clamp(distance - sweet, -STEP_BACK, STEP_MAX);
}

/** Engage distance, m: the farthest centre-to-centre distance the plain attack is meant to land at. */
export function engageDistance(sweet: number): number {
  return sweet + ENGAGE_STEP_SHARE * STEP_MAX;
}

/** A blade line in the BODY frame at mid-strike: grip (x1, z1) and sweet spot (x2, z2), m (+x = holder's left). */
export type AimLine = [number, number, number, number];

/** The planar estimate of the aim line: parallel to the facing, in the right arm's plane. */
export function planarAimLine(arm: ArmGeometry, tip: number): AimLine {
  const x = -arm.shoulderLateral, z = 0.5 * (arm.upper + arm.fore);
  return [x, z, x, z + SWEET_SHARE * tip];
}

/**
 * Successive swings vary where they aim (× the shape's aimLateral): the shoulder junction, near the
 * centre line, then the other side — a fighter does not cut the same line twice, and the guard
 * arms, head and chest each get their turn.
 */
export const AIM_PATTERN = [1, 0.35, -0.5] as const;

/** Largest aim yaw a swing turns the body by, rad. */
export const AIM_MAX = 0.8;
/** Bisection steps of the aim solve (2·AIM_MAX / 2^24 ≈ 1e-7 rad). */
const AIM_ITERATIONS = 24;

/**
 * Aim yaw (rad, + toward the holder's left) that turns the body so its blade line passes through the
 * aim point: `distance` m straight ahead and `lateral` m to the side (+ = holder's left). With the
 * body yawed by ψ the aim point sits in the body frame at
 *   T(ψ) = (a cos ψ − D sin ψ, a sin ψ + D cos ψ);
 * ψ solves  cross(P2 − P1, T(ψ) − P1) = 0  by bisection on ±AIM_MAX. For a line parallel to the
 * facing at offset x and a = 0 this is ψ = asin(−x / D). Returns 0 when no root lies in range.
 */
export function aimYawForLine(line: AimLine, distance: number, lateral = 0): number {
  const [x1, z1, x2, z2] = line, D = Math.max(0.3, distance), a = lateral, ex = x2 - x1, ez = z2 - z1;
  const f = (psi: number) => {
    const c = Math.cos(psi), s = Math.sin(psi);
    return ex * (a * s + D * c - z1) - ez * (a * c - D * s - x1);
  };
  let lo = -AIM_MAX, hi = AIM_MAX, flo = f(lo);
  if (flo * f(hi) > 0) return 0;
  for (let i = 0; i < AIM_ITERATIONS; i++) {
    const mid = 0.5 * (lo + hi), fm = f(mid);
    if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Seconds a contact freezes the swing at the contact pose before the arm recovers. */
export const CONTACT_HOLD = 0.1;

// ─── Lane M: four-phase styled swings ──────────────────────────────────────────────────────────
//
//   wind-up   guard -> cocked key (Hermite ease, peak rate 1.5): the counter-move, AWAY from the strike
//   strike    cocked -> contact -> follow-through on strikeProgress: accelerating INTO the
//             contact, peak speed AT the contact, braking to rest at the follow-through
//   hold      the follow-through pose holds (`hold` s): the blow reads
//   recovery  follow-through -> guard on recoveryCurve (slow, weighted, a damped overshoot)
//   settle    guard holds (`settle` s), then the swing hands back to idle
// The strike path is piecewise linear in key space THROUGH the contact key (the unstyled path's
// pose at the contact fraction), so a deeper wind-up or a longer follow-through never moves the
// contact pose — the reach, the sweet distance and the aim line stay what lane X2 measured.
// Kinetic chain: every DOF is sampled at clock + lead·smoothstep(0, windup, clock), leads
// growing toward the body (twist > lean > shoulder > elbow > blade = 0): proximal joints get
// there first and the blade arrives last, exactly on the contact.

/** Swing DOFs in a fixed order (SwingProfile.lead). */
export const SWING_DOFS = ["shoulder", "elbow", "blade", "roll", "lean", "twist"] as const;
/** Chain depth of each swing DOF (MotionStyle vocabulary: pelvis 1 … wrist/weapon 5). */
export const SWING_DOF_DEPTH: Readonly<Record<(typeof SWING_DOFS)[number], number>> = {
  twist: 1, lean: 2, shoulder: 3, elbow: 4, blade: 5, roll: 5,
};
/** Shortest hold / settle a styled timing shrinks to when the cooldown is tight, s. */
export const HOLD_MIN = 0.03, SETTLE_MIN = 0.03;
/** Peak / mean speed of strikeProgress is 2 (a smootherstep's is 15/8): mean-to-peak 1/2. */
export const STYLED_MEAN_TO_PEAK = 0.5;

/** Phase scales of a styled swing (MotionStyle.eff satisfies it). */
export interface PhaseScales { windupTime: number; strikeTime: number; recoverTime: number; holdTime: number; settleTime: number }

/**
 * Styled phase durations, s. The strike keeps the weapon's PEAK speed under the new profile
 * (strike × MEAN_TO_PEAK / STYLED_MEAN_TO_PEAK), times the style's strike scale, floored at
 * `minStrike` (the animator's joint speed limit) and clamped to [STRIKE_MIN, STRIKE_MAX]. Wind-up
 * and recovery follow swingTiming's rules × the style; when everything exceeds COOLDOWN_SHARE of
 * the cooldown, wind-up, recovery, hold and settle shrink together toward their minima.
 */
export function styledSwingTiming(
  strike: number, cooldown: number, sc: PhaseScales, minStrike = 0, overrun = 0, minWindup = WINDUP_MIN, minRecover = RECOVER_MIN, tailFree = true,
): SwingTiming {
  const s0 = clamp(Number.isFinite(strike) ? strike : 0.2, STRIKE_MIN, STRIKE_MAX);
  const s = clamp(Math.max(s0 * (MEAN_TO_PEAK / STYLED_MEAN_TO_PEAK) * sc.strikeTime, minStrike), STRIKE_MIN, STRIKE_MAX);
  // Speed-safe floors (the caller derives them from the joint speed limit): a squeezed wind-up or
  // recovery must not outrun the animator's limiter, which would clip the curve into a lag.
  const wMin = Math.max(WINDUP_MIN, Number.isFinite(minWindup) ? minWindup : 0), rMin = Math.max(RECOVER_MIN, Number.isFinite(minRecover) ? minRecover : 0);
  let windup = Math.max(wMin, (WINDUP_BASE + WINDUP_RATIO * s0) * sc.windupTime), recover = Math.max(rMin, (RECOVER_BASE + RECOVER_RATIO * s0) * sc.recoverTime);
  let hold = Math.max(HOLD_MIN, sc.holdTime), settle = Math.max(SETTLE_MIN, sc.settleTime);
  // `overrun` (≥ 0): the share a TIRED or HURT fighter's swing may outlast the cooldown by
  // (MotionStyle.swingOverrun) — the next blow then waits for this one (Engine gates on active).
  // Only the BLOW (wind-up + strike + hold) must fit the cooldown budget: the recovery and the
  // settle are an interruptible tail (SwingPlayer.begin chains the next wind-up from wherever the
  // recovery has got to), so a heavy weapon keeps a heavy recovery without lowering the attack rate.
  const cap = Number.isFinite(cooldown) && cooldown > 0 ? COOLDOWN_SHARE * cooldown * (1 + clamp(Number.isFinite(overrun) ? overrun : 0, 0, 1)) : Infinity;
  // `tailFree` false (hand-path thrusts, whose recovery is already light): the whole swing shares
  // the budget as before — a thrust's longer pull-back draws the hand into the chest (ork −3.7 mm).
  const spare = cap - s;
  const soft = tailFree ? windup + hold : windup + recover + hold + settle;
  const mins = tailFree ? wMin + HOLD_MIN : wMin + rMin + HOLD_MIN + SETTLE_MIN;
  if (spare < soft) {
    const k = clamp((spare - mins) / Math.max(1e-6, soft - mins), 0, 1);
    windup = wMin + k * (windup - wMin);
    hold = HOLD_MIN + k * (hold - HOLD_MIN);
    if (!tailFree) {
      recover = rMin + k * (recover - rMin);
      settle = SETTLE_MIN + k * (settle - SETTLE_MIN);
    }
  }
  return { windup, strike: s, recover: Math.max(recover, rMin), hold, settle };
}

/**
 * Strike fraction u (0..1, geometry) at which the blade meets a target at the sweet distance:
 * where the sweet spot is farthest forward inside the torso band (the same search as
 * sweetDistance). 0.5 when the band is never crossed.
 */
export function contactFraction(shape: SwingShape, arm: ArmGeometry, tip: number): number {
  const k: SwingKey = { ...GUARD_KEY }, p: [number, number] = [0, 0];
  let best = -Infinity, at = 0.5;
  for (let i = 0; i <= 4 * REACH_SAMPLES; i++) {
    const u = i / (4 * REACH_SAMPLES);
    strikeKeyAt(shape, arm, u, k);
    bladePoint(arm, k, SWEET_SHARE * tip, p);
    if (p[1] >= TORSO_BAND[0] && p[1] <= TORSO_BAND[1] && p[0] > best) { best = p[0]; at = u; }
  }
  return at;
}

/** Everything a styled swing needs beyond its shape and timing (SwingDriver fills it at the press). */
export interface SwingProfile {
  /** Guard key the swing leaves from and returns to (the styled guard; live, may change per frame). */
  guard: SwingKey;
  /** Cocked key, contact key, follow-through key (styled; written at the press). */
  windup: SwingKey;
  contactKey: SwingKey;
  strike: SwingKey;
  /** Hand path points for hand-path shapes (forward, up m): windup, contact, strike; null = arc keys. */
  hand: Float64Array | null;
  /** Strike-time fraction of the contact: peak speed and the contact pose (strikeProgress). */
  contact: number;
  /** Damped recovery overshoot, share of the recovery travel. */
  overshoot: number;
  /** Seconds a contact freezes the swing (replaces CONTACT_HOLD). */
  contactHold: number;
  /** Lead of each DOF ahead of the blade, s (SWING_DOFS order). */
  lead: Float64Array;
  /** Lead of the legs ahead of the blade, s. */
  legLead: number;
  /**
   * Chained press: the swing starts from `from` (the previous swing's pose mid-recovery) instead
   * of the guard, with the previous swing's blend weight and leg drive fading out over the wind-up.
   */
  chained: boolean;
  from: SwingKey;
  fromWeight: number;
  fromLeg: number;
}

/** A fresh profile (neutral: no chain lead, no overshoot). */
export function newSwingProfile(): SwingProfile {
  return {
    guard: { ...GUARD_KEY }, windup: { ...GUARD_KEY }, contactKey: { ...GUARD_KEY }, strike: { ...GUARD_KEY },
    hand: null, contact: 0.5, overshoot: 0, contactHold: CONTACT_HOLD, lead: new Float64Array(SWING_DOFS.length), legLead: 0,
    chained: false, from: { ...GUARD_KEY }, fromWeight: 0, fromLeg: 0,
  };
}

const SK_TMP: SwingKey = { ...GUARD_KEY };

/**
 * The styled swing's key at `c` seconds after the press, for ALL DOFs at the same clock (the
 * chain lead is applied by sampleStyledSwing). Writes `out`.
 */
export function styledKeyAt(t: SwingTiming, pr: SwingProfile, c: number, out: SwingKey, arm: ArmGeometry | null = null): SwingKey {
  const w1 = t.windup, s1 = w1 + t.strike, h1 = s1 + (t.hold ?? 0), r1 = h1 + t.recover;
  if (c < w1) { mixKey(pr.chained ? pr.from : pr.guard, pr.windup, hermite(c / Math.max(1e-6, w1)), out); return out; }
  if (c < s1) {
    const cc = pr.contact, u = strikeProgress((c - w1) / Math.max(1e-6, t.strike), cc);
    const before = u < cc, v = before ? u / cc : (u - cc) / (1 - cc);
    if (before) mixKey(pr.windup, pr.contactKey, v, out); else mixKey(pr.contactKey, pr.strike, v, out);
    if (pr.hand && arm) {
      const H = pr.hand, i0 = before ? 0 : 2, i1 = before ? 2 : 4;
      armIK(arm, lerp(H[i0], H[i1], v), lerp(H[i0 + 1], H[i1 + 1], v), IK_OUT);
      out.shoulder = IK_OUT.shoulder - out.lean; out.elbow = IK_OUT.elbow;
    }
    return out;
  }
  if (c < h1) { Object.assign(out, pr.strike); return out; }
  if (c < r1) { mixKey(pr.strike, pr.guard, recoveryCurve(clamp01((c - h1) / Math.max(1e-6, t.recover)), pr.overshoot), out); return out; }
  Object.assign(out, pr.guard);
  return out;
}

/**
 * Styled swing sample at `clock` s after the press: each DOF at its own chain-led clock
 * (module section comment), the step and the weight on the blade's clock. The weight rises over
 * the first half of the wind-up and falls over the settle (over the second half of the recovery
 * when there is no settle).
 */
export function sampleStyledSwing(t: SwingTiming, pr: SwingProfile, clock: number, out: SwingSample, arm: ArmGeometry | null = null): SwingSample {
  const c = Math.max(0, clock), w1 = t.windup, s1 = w1 + t.strike, h1 = s1 + (t.hold ?? 0), r1 = h1 + t.recover, end = r1 + (t.settle ?? 0);
  const ramp = smoothstep(0, w1, c);
  for (let d = 0; d < SWING_DOFS.length; d++) {
    styledKeyAt(t, pr, c + pr.lead[d] * ramp, SK_TMP, arm);
    const k = SWING_DOFS[d];
    out[k] = SK_TMP[k];
  }
  out.step = smoothstep(0, s1, c);
  // The weight (aim yaw, grip, choke) eases out over the recovery AND the settle: the body turns
  // back with the arm instead of whipping round in a short settle (measured 131 °/s velocity
  // jumps of the rig yaw with a settle-only fade).
  const rise = smoothstep(0, 0.5 * w1, c);
  out.weight = c >= end ? 0 : (pr.chained ? pr.fromWeight + (1 - pr.fromWeight) * rise : rise) * (1 - smoothstep(h1 + 0.3 * t.recover, end, c));
  return out;
}

/**
 * Leg drive 0..1 of a styled swing at `clock` (the legs LEAD): sinks over the wind-up into the
 * strike, peaks legLead before the contact, releases over the first 85 % of the recovery.
 */
export function styledLegDrive(t: SwingTiming, pr: SwingProfile, clock: number): number {
  const c = Math.max(0, clock), w1 = t.windup, s1 = w1 + t.strike, h1 = s1 + (t.hold ?? 0);
  const cl = c + pr.legLead * smoothstep(0, w1, c);
  const drive = smoothstep(0.15 * w1, w1 + pr.contact * t.strike, cl) * (1 - smoothstep(h1, h1 + 0.85 * t.recover, cl));
  // A chained press: the previous swing's leg drive fades over the wind-up instead of dropping to 0.
  return pr.chained ? Math.max(drive, pr.fromLeg * (1 - smoothstep(0, w1, c))) : drive;
}

/**
 * One fighter's swing clock (pure state machine). begin() on the press; advance(dt) every frame;
 * freeze(u) on a contact; sample() gives the DOFs. After a freeze the swing holds CONTACT_HOLD s at
 * the contact instant, then recovers from that pose to guard over the timing's recover time.
 */
export class SwingPlayer {
  shape: SwingShape = SWING_SHAPES.slash;
  timing: SwingTiming = { windup: 0.2, strike: 0.2, recover: 0.25 };
  arm: ArmGeometry | null = null;
  /** Seconds since the press (the swing clock; it stops while frozen). */
  clock = 0;
  /** Clock at the previous advance (a sweep's contact fraction interpolates between the two). */
  prevClock = 0;
  active = false;
  /** Planned step (m, − = back) and aim yaw (rad) for this swing. */
  stepDistance = 0;
  aimYaw = 0;
  twoHanded = false;
  /** Contact: the frozen clock (null: none), seconds left in the hold, seconds into the rebound. */
  frozenAt: number | null = null;
  hold = 0;
  rebound = 0;
  /** Lane M: the styled four-phase profile of this swing (null = the three-phase swing). */
  profile: SwingProfile | null = null;
  readonly #a = newSwingSample();

  /** Start a swing (`profile`: lane M four-phase styling, see sampleStyledSwing). */
  begin(shape: SwingShape, timing: SwingTiming, stepDistance: number, aimYaw: number, twoHanded: boolean, arm: ArmGeometry | null = null, profile: SwingProfile | null = null): void {
    this.shape = shape; this.timing = timing; this.arm = arm; this.profile = profile;
    this.stepDistance = stepDistance; this.aimYaw = aimYaw; this.twoHanded = twoHanded;
    this.clock = 0; this.prevClock = 0; this.active = true;
    this.frozenAt = null; this.hold = 0; this.rebound = 0;
  }

  /** Stop at once (KO, an interrupting stagger). */
  cancel(): void { this.active = false; this.frozenAt = null; }

  /**
   * True once the blow is over (in the recovery or the settle, or a contact's hold has elapsed):
   * the next press may chain from here (begin captures the current pose).
   */
  recovering(): boolean {
    if (!this.active) return false;
    if (this.frozenAt !== null) return this.hold <= 0;
    return this.clock >= this.timing.windup + this.timing.strike + (this.profile ? this.timing.hold ?? 0 : 0);
  }

  /** Advance by dt; returns false once the swing is over. */
  advance(dt: number): boolean {
    if (!this.active) return false;
    this.prevClock = this.clock;
    if (this.frozenAt !== null) {
      if (this.hold > 0) this.hold = Math.max(0, this.hold - dt);
      else this.rebound += dt;
      if (this.hold <= 0 && this.rebound >= this.timing.recover + (this.profile ? this.timing.settle ?? 0 : 0)) this.active = false;
      return this.active;
    }
    this.clock += dt;
    if (this.clock >= swingDuration(this.timing)) this.active = false;
    return this.active;
  }

  /** True while the hit test may run (inside the strike window, not frozen). */
  striking(): boolean {
    if (!this.active || this.frozenAt !== null) return false;
    const w = swingWindow(this.timing, this.shape.windowLead);
    return this.clock >= w.start && this.clock <= w.end;
  }

  /** A contact at fraction u (0..1) of the last advance: freeze there. Returns the frozen clock. */
  freeze(u: number): number {
    const c = lerp(this.prevClock, this.clock, clamp01(u));
    this.frozenAt = c; this.clock = c; this.prevClock = c; this.hold = this.profile ? this.profile.contactHold : CONTACT_HOLD; this.rebound = 0;
    return c;
  }

  /** The swing's DOFs now. */
  sample(out: SwingSample): SwingSample {
    const pr = this.profile;
    if (this.frozenAt === null) return pr ? sampleStyledSwing(this.timing, pr, this.clock, out, this.arm) : sampleSwing(this.shape, this.timing, this.clock, out, this.arm);
    if (pr) sampleStyledSwing(this.timing, pr, this.frozenAt, this.#a, this.arm);
    else sampleSwing(this.shape, this.timing, this.frozenAt, this.#a, this.arm);
    if (this.hold > 0 || this.rebound <= 0) { Object.assign(out, this.#a); return out; }
    // Rebound: from the contact pose back to guard, eased like a normal recover (styled: the
    // heavy recovery with its damped overshoot).
    const v = clamp01(this.rebound / Math.max(1e-6, this.timing.recover));
    mixKey(this.#a, pr ? pr.guard : GUARD_KEY, pr ? recoveryCurve(v, pr.overshoot) : easeInOutCubic(v), out);
    out.step = this.#a.step;
    const settle = this.timing.settle ?? 0;
    out.weight = this.#a.weight * (pr && settle > 0.02
      ? 1 - smoothstep(this.timing.recover, this.timing.recover + settle, this.rebound)
      : 1 - smoothstep(0.5, 1, v));
    return out;
  }
}
