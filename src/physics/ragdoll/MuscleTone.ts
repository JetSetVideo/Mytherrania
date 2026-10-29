// "Controlled" ragdoll muscle tone (V03): how much a falling fighter can still protect itself,
// and the protective pose its muscles pull toward. Pure: no Three.js, no DOM.
//
// Tone T ∈ [0, 1] scales the joint drives' STIFFNESS (k = T·k_max, so the natural frequency
// is ω = √T·ω_max); the torque CAPACITY scales with T and with strength. A knocked-out or
// hypnotised body is limp (T = 0); a fresh one braces (T = 1).
//
//   T = consciousness · vigour · energy · meter
//     consciousness: 0 when KO'd (hp ≤ 0), else the product of STATUS_TONE over statuses
//     vigour       = √hpFraction                (tone holds up, then collapses near 0 HP)
//     energy       = EXHAUSTED_TONE_FLOOR + (1 − floor)·staminaFraction
//     meter        = 1 / (1 + damagePercent / TONE_KNOCKBACK_PERCENT)
//                    — the SAME law as the knockback a body takes (Fighter: 1 + dp/60): a
//                    body whose knockback has doubled has half its tone
//   torque scale = T · clamp(strength / STRENGTH_REFERENCE, STRENGTH_MIN, STRENGTH_MAX)

/** Damage percent at which the knockback taken doubles (Fighter.knockbackFor: 1 + dp/60). */
export const TONE_KNOCKBACK_PERCENT = 60;
/** Tone left in an exhausted (0 stamina) but conscious body. */
export const EXHAUSTED_TONE_FLOOR = 0.3;
/** Mean primary strength over the eight classes (9+7+5+4+2+2+5+3)/8 (Stats.ts PRIMARY). */
export const STRENGTH_REFERENCE = 37 / 8;
/** Bounds of the strength factor (a 2-strength mage still holds ~43% of the reference torque). */
export const STRENGTH_MIN = 0.4, STRENGTH_MAX = 2;

/** Consciousness factor per status (Status.ts names); unknown statuses count as 1. */
export const STATUS_TONE: Record<string, number> = {
  hypnotised: 0,   // entranced: no protective reflex at all
  stunned: 0.2,    // dazed: a feeble reflex
  controlled: 0.5, // a puppet: the controller does not protect the body
  chilled: 0.7, slowed: 0.8, poisoned: 0.85, burning: 0.9,
  blessed: 1, hasted: 1,
};

/** Everything about a fighter that shapes its fall ("all current variables and conditions"). */
export interface FighterCondition {
  /** hp / maxHealth, 0..1 (≤ 0 = knocked out). */
  hpFraction: number;
  /** stamina.current / stamina.max, 0..1. */
  staminaFraction: number;
  /** Smash-style damage meter, %. */
  damagePercent: number;
  /** Primary strength attribute (Stats.CombatStats.strength). */
  strength: number;
  /** Active status names. */
  statuses: readonly string[];
}

/** Muscle tone and torque scale (module comment). */
export interface Tone { tone: number; torqueScale: number }

/** Tone of a fighter's muscles from its condition (module comment). Writes `out`. */
export function muscleTone(c: FighterCondition, out: Tone = { tone: 0, torqueScale: 0 }): Tone {
  let consciousness = c.hpFraction > 0 ? 1 : 0;
  for (const s of c.statuses) consciousness *= STATUS_TONE[s] ?? 1;
  const vigour = Math.sqrt(Math.max(0, Math.min(1, c.hpFraction)));
  const energy = EXHAUSTED_TONE_FLOOR + (1 - EXHAUSTED_TONE_FLOOR) * Math.max(0, Math.min(1, c.staminaFraction));
  const meter = 1 / (1 + Math.max(0, c.damagePercent) / TONE_KNOCKBACK_PERCENT);
  out.tone = Math.max(0, Math.min(1, consciousness * vigour * energy * meter));
  out.torqueScale = out.tone * Math.max(STRENGTH_MIN, Math.min(STRENGTH_MAX, c.strength / STRENGTH_REFERENCE));
  return out;
}

/** One joint's target: Skeleton flex angle (rad, Skeleton sign), abduction (+ = outward), twist. */
export type JointTarget = [flex: number, abduct: number, twist: number];

/**
 * Joints NOT listed in the pose tables (the toes) carry no muscle drive: they only follow
 * their limits and damping (a 0.35 kg toe segment driven against the ground just chatters).
 *
 * COVER: falling backward, sideways or tumbling — chin tucked, the forearms folded in front of
 * the face, the knees pulled up (a fetal guard). Skeleton signs: shoulder < 0 lifts the arm
 * forward, elbow < 0 folds the forearm, hip > 0 lifts the thigh, knee < 0 folds the shin,
 * neck/abdomen > 0 curl forward.
 */
export const COVER_POSE: Record<string, JointTarget> = {
  abdomen: [0.4, 0, 0], neck: [0.4, 0, 0], head: [0.3, 0, 0],
  shoulderL: [-1.9, 0.1, 0], shoulderR: [-1.9, 0.1, 0], elbowL: [-2.3, 0, 0], elbowR: [-2.3, 0, 0],
  hipL: [1.0, 0.05, 0], hipR: [1.0, 0.05, 0], kneeL: [-1.8, 0, 0], kneeR: [-1.8, 0, 0],
  ankleL: [0.2, 0, 0], ankleR: [0.2, 0, 0],
};

/**
 * BRACE: falling face-first — arms reach forward to catch the ground with the elbows soft,
 * the head lifts away from the ground, the legs stay long behind.
 */
export const BRACE_POSE: Record<string, JointTarget> = {
  abdomen: [-0.1, 0, 0], neck: [-0.35, 0, 0], head: [-0.25, 0, 0],
  shoulderL: [-1.35, 0.3, 0], shoulderR: [-1.35, 0.3, 0], elbowL: [-0.45, 0, 0], elbowR: [-0.45, 0, 0],
  hipL: [0.25, 0.1, 0], hipR: [0.25, 0.1, 0], kneeL: [-0.5, 0, 0], kneeR: [-0.5, 0, 0],
  ankleL: [0, 0, 0], ankleR: [0, 0, 0],
};

/**
 * Weight of BRACE over COVER from where the chest faces relative to the fall:
 *   w = smoothstep(BRACE_COS_LO, BRACE_COS_HI, f̂ · d̂)
 * with f̂ the chest's forward axis and d̂ the fall direction (the velocity, or straight down
 * when slower than FALL_SPEED_MIN). Facing the fall (cos → 1) braces; facing away covers.
 */
export const BRACE_COS_LO = -0.1, BRACE_COS_HI = 0.5;
/** Below this speed the fall direction is "down", m/s. */
export const FALL_SPEED_MIN = 1;

/** w_brace (see BRACE_COS_LO) from the chest forward axis (unit) and the body velocity. */
export function braceWeight(fx: number, fy: number, fz: number, vx: number, vy: number, vz: number): number {
  const sp = Math.hypot(vx, vy, vz);
  const dx = sp > FALL_SPEED_MIN ? vx / sp : 0, dy = sp > FALL_SPEED_MIN ? vy / sp : -1, dz = sp > FALL_SPEED_MIN ? vz / sp : 0;
  const c = fx * dx + fy * dy + fz * dz;
  const t = Math.max(0, Math.min(1, (c - BRACE_COS_LO) / (BRACE_COS_HI - BRACE_COS_LO)));
  return t * t * (3 - 2 * t);
}
