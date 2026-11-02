// Pose tables for the animator's combat layers (lane C, R04).
//
// Pure data + one builder. Angles in radians, Skeleton convention (Rig.ts header). The upper-body
// numbers of ATTACK / HIT / KO are the ones defaultHumanoid() already uses for its discrete
// poses, so the look of a swing or a hit is preserved; what changes is that they now CROSSFADE
// as layers instead of being switched. KO is clamped into the BASE joint limits at build time
// (defaultHumanoid widens the trunk limits for KO; the ragdoll takes over the body anyway).

import type { JointName } from "../Skeleton.ts";
import { JOINT_COUNT, JOINT_ORDER, type JointLimitTable } from "./Rig.ts";

/** A sparse pose: joint -> angle (override) or offset (additive). */
export type SparsePose = Partial<Record<JointName, number>>;

/**
 * Guard: the free forearm up in front of the face, trunk slightly hunched (override, upper body). The
 * WEAPON arm (lane T, wave W): the upper arm as before (−1.0), the elbow opened from −1.45 to −0.51 so
 * the forearm runs ~10° below the horizontal (λ + θs + θe = 0.12 − 1.0 − 0.51 = −1.39 → forearm at
 * 1.75 rad from up), the fist at the lower chest ~0.58 m forward — a forearm a handle crosses at the
 * hammer grip (it was 46° from vertical: the guard blade needed the wrist's whole ulnar range and the
 * handle lay 47° to the fingers). The shoulder is unchanged so the swings' wind-up travel (and the
 * kinetic chain's peak order) keep their timing.
 */
export const GUARD_POSE: SparsePose = {
  spine: 0.12, abdomen: 0.06, neck: -0.06, head: -0.06,
  shoulderL: -0.85, shoulderR: -1.0, elbowL: -1.7, elbowR: -0.51,
};

/** Basic attack without a skill curve (defaultHumanoid "attack", upper body only). */
export const ATTACK_POSE: SparsePose = { shoulderR: -1.7, elbowR: -0.3, spine: -0.2, abdomen: -0.15, neck: 0.15 };

/**
 * Hit reaction OFFSETS (additive), 0.7 × the defaultHumanoid "hit" pose: the Skeleton's kick
 * spring (applyImpulse) still adds the impulse-scaled physics on top, so the layer is the
 * readable flinch and the spring the momentum.
 */
export const HIT_OFFSETS: SparsePose = {
  spine: 0.35, abdomen: 0.25, neck: 0.18, head: 0.2, shoulderL: -0.7, shoulderR: -0.7,
};

/** Knocked out (defaultHumanoid "ko"), full body; clamped to the base limits when built. */
export const KO_POSE: SparsePose = {
  spine: -0.8, abdomen: -0.6, neck: -0.5, head: -0.55,
  shoulderL: -1.6, shoulderR: -1.6, hipL: -0.4, hipR: -0.4, kneeL: -0.6, kneeR: -0.6,
  ankleL: -0.5, ankleR: -0.5,
};

/** Airborne tuck: the leading leg folds higher than the trailing one (override, legs). */
export const AIR_POSE: SparsePose = {
  hipL: 0.55, hipR: 0.25, kneeL: -1.1, kneeR: -0.7, ankleL: 0.25, ankleR: 0.3,
};

/**
 * Breathing unit offsets (additive): multiplied by amplitude · wave(t) (Animator: a skewed sine).
 * The chest opens (spine extends back a FRACTION of a degree on the inhale: 0.35 × the 0.025 rad
 * default amplitude = 0.5°), the abdomen counters 40 % of it so the pelvis stays put, neck + head
 * cancel the rest so the gaze stays level, and the arms lift forward a hair with the ribcage.
 * The visible "rise" is the Animator's breathRise (the pelvis, chest and shoulders lift a few mm);
 * wave V lane P cut the spine term from 1.0 (1.4° fresh, 3.9° exhausted: a rocking, not a breath).
 */
export const BREATH_UNIT: SparsePose = { spine: -0.35, abdomen: 0.14, neck: 0.26, head: 0.07, shoulderL: -0.12, shoulderR: -0.12 };

/**
 * Dense pose array in JOINT_ORDER. Override poses fill missing joints with the rest angle and
 * clamp into [min, max]; additive poses fill missing joints with 0 and are not clamped.
 */
export function poseArray(pose: SparsePose, lim: JointLimitTable, mode: "override" | "additive"): Float64Array {
  const out = new Float64Array(JOINT_COUNT);
  for (let i = 0; i < JOINT_COUNT; i++) {
    const v = pose[JOINT_ORDER[i]];
    if (mode === "additive") out[i] = v ?? 0;
    else out[i] = Math.max(lim.min[i], Math.min(lim.max[i], v ?? lim.rest[i]));
  }
  return out;
}
