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
