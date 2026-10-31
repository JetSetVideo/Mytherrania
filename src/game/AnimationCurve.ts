// Procedural animation curves. Every animated joint is driven by two terms:
//
//   angle(t) = rest + amplitude * impulse(t, peak)          <- the strike
//            + wobbleAmp * dampedSin(t, freq, phase, k)    <- secondary motion
//
// `impulse` rises on a sine from 0 to 1 at the animation's peak, then falls back
// on a cosine to 0 — so the pose leaves the rest state, reaches its maximum tip
// exactly at the hit frame, and returns to the central state. Pure maths, no
// Three.js, so the shapes can be asserted in tests.

import type { JointName } from "./Skeleton.ts";
import type { JointTrack, SkillAnimation } from "./Skills.ts";

/** Smooth 0->1->0 envelope. Sine on the way up, cosine on the way down. */
export function impulse(t: number, peak: number): number {
  if (t <= 0 || t >= 1) return 0;
  const p = Math.min(0.95, Math.max(0.05, peak));
  if (t < p) return Math.sin((Math.PI / 2) * (t / p));
  return Math.cos((Math.PI / 2) * ((t - p) / (1 - p)));
}

/** Secondary oscillation that decays over the animation. */
export function dampedSin(t: number, freq: number, phase: number, damping = 6): number {
  if (t <= 0 || t >= 1) return 0;
  return Math.sin(2 * Math.PI * freq * t + phase) * Math.exp(-damping * t);
}

/** Raw (unclamped) offset contributed by one track at normalised time t. */
export function trackOffset(track: JointTrack, t: number): number {
  const main = track.amplitude * impulse(t, track.peak);
  const wob = track.wobbleAmp
    ? track.wobbleAmp * dampedSin(t, track.wobbleFreq ?? 3, track.wobblePhase ?? 0)
    : 0;
  return main + wob;
}

/** Joint angle at time t, clamped into the joint's own [min, max]. */
export function jointAngle(track: JointTrack, t: number, rest: number, min: number, max: number): number {
  const v = rest + trackOffset(track, t);
  return Math.max(min, Math.min(max, v));
}

/** Every animated joint's angle at normalised time t. */
export function poseAt(anim: SkillAnimation, t: number, limits: Map<JointName, { rest: number; min: number; max: number }>): Map<JointName, number> {
  const out = new Map<JointName, number>();
  for (const tr of anim.tracks) {
    const lim = limits.get(tr.joint);
    if (!lim) continue;
    out.set(tr.joint, jointAngle(tr, t, lim.rest, lim.min, lim.max));
  }
  return out;
}

/**
 * Forward travel along the facing direction. Eased so the body accelerates out
 * of the lunge and settles, instead of snapping.
 */
export function lungeAt(anim: SkillAnimation, t: number): number {
  if (anim.lunge === 0) return 0;
  const u = Math.max(0, Math.min(1, t));
  // Smoothstep over the first 70% of the animation, then hold the gained ground.
  const s = Math.min(1, u / 0.7);
  return anim.lunge * (s * s * (3 - 2 * s));
}

/** Vertical hop: a single sine arc that leaves and returns to the ground. */
export function hopAt(anim: SkillAnimation, t: number): number {
  if (anim.hop === 0) return 0;
  const u = Math.max(0, Math.min(1, t));
  return anim.hop * Math.sin(Math.PI * u);
}

/**
 * Weapon effect strength. `damageFraction` is the share of the target's maximum
 * health the hit removed (0..1): a bigger hit flares harder and lasts longer.
 */
export function effectStrength(anim: SkillAnimation, t: number, damageFraction: number): number {
  const base = anim.effectIntensity;
  const scaled = base * (0.35 + 1.15 * Math.max(0, Math.min(1, damageFraction)));
  return Math.max(0, Math.min(1.6, scaled * impulse(t, anim.hitAt)));
}

// ─── Lane M: four-phase motion (wind-up -> sharp hit -> hold -> heavy recovery -> settle) ────────

/** Cubic ease-in-out (local copy: this module stays dependency-free). */
function easeIO(t: number): number {
  const u = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

/**
 * Strike progress with the PEAK SPEED AT `contact` (0..1 of the strike time): the velocity is
 * 1 - cos(π τ / c) before the contact (zero at the cocked key, accelerating INTO the hit) and
 * 1 + cos(π (τ - c) / (1 - c)) after it (braking to zero at the follow-through):
 *   p(τ) = τ - (c/π) sin(π τ / c)                              τ <= c
 *   p(τ) = c + (τ - c) + ((1 - c)/π) sin(π (τ - c) / (1 - c))   τ >  c
 * p(0) = 0, p(1) = 1, p(c) = c (the contact pose is reached exactly at the contact time), peak
 * dp/dτ = 2 at τ = c (mean 1), velocity C1 everywhere.
 */
export function strikeProgress(tau: number, contact: number): number {
  const c = Math.min(0.9, Math.max(0.1, contact));
  const t = tau <= 0 ? 0 : tau >= 1 ? 1 : tau;
  if (t <= c) return t - (c / Math.PI) * Math.sin(Math.PI * t / c);
  return c + (t - c) + ((1 - c) / Math.PI) * Math.sin(Math.PI * (t - c) / (1 - c));
}

/** dp/dτ of strikeProgress (peak 2 at the contact). */
export function strikeSpeed(tau: number, contact: number): number {
  const c = Math.min(0.9, Math.max(0.1, contact));
  if (tau <= 0 || tau >= 1) return 0;
  return tau <= c ? 1 - Math.cos(Math.PI * tau / c) : 1 + Math.cos(Math.PI * (tau - c) / (1 - c));
}

/** Shares of the recovery spent on the overshoot swing, the damped rebound and the settle-in. */
export const RECOVERY_SPLIT: readonly [number, number] = [0.75, 0.9];
/** Each rebound of the damped recovery is this share of the previous one (0.3: settles in one bounce). */
export const RECOVERY_DAMPING = 0.3;

/**
 * Heavy recovery 0 -> 1 with a damped overshoot of `A` (share of the travel): ease to 1 + A over
 * the first 75 % (Hermite eases: peak rate 2·(1 + A), under the strike's 2 per its own travel
 * once the recovery is longer than the strike), back to 1 - 0.3·A by 90 %, settle on 1. Each piece eases in and out, so the
 * velocity is zero at every turn (C1) and the motion reads weighted, not springy.
 */
export function recoveryCurve(v: number, A: number): number {
  const a = Math.max(0, Math.min(0.5, Number.isFinite(A) ? A : 0));
  const t = v <= 0 ? 0 : v >= 1 ? 1 : v;
  const [s1, s2] = RECOVERY_SPLIT, b = 1 - RECOVERY_DAMPING * a;
  if (t < s1) return (1 + a) * hermite(t / s1);
  if (t < s2) return 1 + a + (b - 1 - a) * hermite((t - s1) / (s2 - s1));
  return b + (1 - b) * hermite((t - s2) / (1 - s2));
}

/** Cubic Hermite ease u²(3 − 2u): zero speed at both ends, peak rate 1.5 (half easeInOutCubic's 3). */
export function hermite(u: number): number {
  const t = u <= 0 ? 0 : u >= 1 ? 1 : u;
  return t * t * (3 - 2 * t);
}
/** Peak rate of recoveryCurve's main segment per unit travel: 1.5·(1 + A) / RECOVERY_SPLIT[0]. */
export function recoveryPeakRate(A: number): number { return 1.5 * (1 + Math.max(0, A)) / RECOVERY_SPLIT[0]; }

/** Shape of a styled skill track (shares of the animation's duration unless stated). */
export interface FourPhaseProfile {
  /** Counter-move depth, share of the strike amplitude (pulls opposite to it first). */
  anticipation: number;
  /** Share of the time before the peak the counter-move takes (the strike gets the rest). */
  anticipationShare: number;
  /** Hit hold after the peak, share of the duration. */
  hold: number;
  /** Recovery overshoot past rest, share of the amplitude. */
  overshoot: number;
  /** Settle hold at rest before the end, share of the duration. */
  settle: number;
}

/**
 * The four-phase envelope that replaces `impulse` for a styled skill track (0 at both ends, 1 at
 * the peak = the hit frame, so `hitAt` still lands when the strike reads):
 *   [0, a·p)        anticipation: ease to -anticipation (opposite to the strike)
 *   [a·p, p)        strike: -anticipation -> 1 on 1 - cos(π/2 x): it ACCELERATES into the hit
 *                   (peak speed at the contact frame)
 *   [p, p + hold)   hit hold at 1
 *   [.., 1 - settle) heavy recovery 1 -> 0 with the damped overshoot (recoveryCurve)
 *   [1 - settle, 1] settle at rest
 * The hold and settle are capped so the recovery keeps at least 45 % of the time after the peak.
 */
export function fourPhaseImpulse(t: number, peak: number, pr: FourPhaseProfile): number {
  if (!(t > 0) || t >= 1) return 0;
  const p = Math.min(0.95, Math.max(0.05, peak));
  const after = 1 - p;
  const hold = Math.min(Math.max(0, pr.hold), 0.3 * after), settle = Math.min(Math.max(0, pr.settle), 0.25 * after);
  const a = Math.min(0.6, Math.max(0, pr.anticipationShare)) * p, ant = Math.max(0, pr.anticipation);
  if (t < a) return -ant * easeIO(t / a);
  if (t < p) {
    const x = (t - a) / (p - a);
    return -ant + (1 + ant) * (1 - Math.cos((Math.PI / 2) * x));
  }
  const h = p + hold, r = 1 - settle;
  if (t < h) return 1;
  if (t < r) return 1 - recoveryCurve((t - h) / (r - h), pr.overshoot);
  return 0;
}

/** Peak rate (1 / normalised time) of fourPhaseImpulse's strike segment: (1 + ant)·(π/2) / (p - a·p). */
export function fourPhasePeakRate(peak: number, pr: FourPhaseProfile): number {
  const p = Math.min(0.95, Math.max(0.05, peak));
  const a = Math.min(0.6, Math.max(0, pr.anticipationShare)) * p;
  return (1 + Math.max(0, pr.anticipation)) * (Math.PI / 2) / Math.max(1e-6, p - a);
}

/** A styled track's raw offset at normalised time t (amplitude × fourPhaseImpulse + the same wobble). */
export function styledTrackOffset(track: JointTrack, t: number, pr: FourPhaseProfile, ampMul = 1): number {
  const main = track.amplitude * ampMul * fourPhaseImpulse(t, track.peak, pr);
  const wob = track.wobbleAmp ? track.wobbleAmp * dampedSin(t, track.wobbleFreq ?? 3, track.wobblePhase ?? 0) : 0;
  return main + wob;
}
