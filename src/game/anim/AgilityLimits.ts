// Wave GEN (C-AGI, lane K): agility (the generator's 0..1000 scale) widens or narrows every joint's
// travel window within a bounded envelope. Pure (no THREE, no DOM, no randomness).
//
//   t = clamp((agility - AGILITY_REFERENCE) / AGILITY_REFERENCE, -1, 1)
//   k = 1 + AGILITY_WIDEN · t      (t >= 0: an agile body reaches further)
//   k = 1 + AGILITY_NARROW · t     (t <  0: a stiff body reaches less)
//   min' = min + (min - rest)·(k - 1),  max' = max + (max - rest)·(k - 1)
//
// Each side scales about the joint's REST angle (rest is always kept inside the window), then:
//   - a HARD STOP stays where it is: the elbow and knee hyperextension stops (max = 0) are bone on bone,
//     no amount of training moves them;
//   - every bound is capped by ANATOMICAL_CAP (the widest window any body reaches), so the widening can
//     never exceed what a joint can do, whatever the agility.
// At agility = AGILITY_REFERENCE (and for an absent / non-finite agility) the result is the input,
// bit for bit: (k - 1) = 0 adds exactly 0.
import type { JointName } from "../Skeleton.ts";

/** The generator's reference agility (StatScale.STAT_REFERENCE): zero morph. */
export const AGILITY_REFERENCE = 500;
/** Share of each side's travel GAINED at agility 1000. */
export const AGILITY_WIDEN = 0.15;
/** Share of each side's travel LOST at agility 0. */
export const AGILITY_NARROW = 0.1;

/** Bounds no agility moves (bone-on-bone hyperextension stops). */
export const HARD_STOPS: Readonly<Partial<Record<JointName, { min?: true; max?: true }>>> = {
  elbowL: { max: true }, elbowR: { max: true }, kneeL: { max: true }, kneeR: { max: true },
};

/**
 * The widest window any body reaches, rad (Skeleton convention: x-axis pitch, + = extension /
 * backward for the trunk). Wider than the reference limits by ~20 % so the 15 % widening is never cut,
 * but a hard ceiling for anything that later scales limits again.
 */
export const ANATOMICAL_CAP: Readonly<Record<JointName, { min: number; max: number }>> = {
  spine: { min: -0.75, max: 0.75 }, abdomen: { min: -0.62, max: 0.62 },
  neck: { min: -0.62, max: 0.62 }, head: { min: -0.62, max: 0.62 },
  shoulderL: { min: -2.9, max: 0.75 }, shoulderR: { min: -2.9, max: 0.75 },
  elbowL: { min: -2.7, max: 0 }, elbowR: { min: -2.7, max: 0 },
  hipL: { min: -1.45, max: 1.45 }, hipR: { min: -1.45, max: 1.45 },
  kneeL: { min: -2.6, max: 0 }, kneeR: { min: -2.6, max: 0 },
  ankleL: { min: -0.95, max: 0.72 }, ankleR: { min: -0.95, max: 0.72 },
  toeL: { min: -0.82, max: 0.48 }, toeR: { min: -0.82, max: 0.48 },
};

export type LimitMap = ReadonlyMap<JointName, { min: number; max: number; rest: number }>;

/** The window scale k for an agility (1 at the reference, 1.15 at 1000, 0.9 at 0). Monotone. */
export function agilityScale(agility: number | null | undefined): number {
  if (agility === null || agility === undefined || !Number.isFinite(agility)) return 1;
  const t = Math.max(-1, Math.min(1, (agility - AGILITY_REFERENCE) / AGILITY_REFERENCE));
  return 1 + (t >= 0 ? AGILITY_WIDEN : AGILITY_NARROW) * t;
}

/** One joint's window at window scale k (see the module comment). */
export function scaledWindow(name: JointName, l: { min: number; max: number; rest: number }, k: number): { min: number; max: number; rest: number } {
  if (k === 1) return { min: l.min, max: l.max, rest: l.rest };
  const stop = HARD_STOPS[name], cap = ANATOMICAL_CAP[name];
  let min = stop?.min ? l.min : l.min + (l.min - l.rest) * (k - 1);
  let max = stop?.max ? l.max : l.max + (l.max - l.rest) * (k - 1);
  if (cap) { min = Math.max(cap.min, min); max = Math.min(cap.max, max); }
  // A cap that sits inside the reference window never narrows it below the reference.
  if (k > 1) { min = Math.min(min, l.min); max = Math.max(max, l.max); }
  // Rest is always admissible.
  min = Math.min(min, l.rest); max = Math.max(max, l.rest);
  return { min, max, rest: l.rest };
}

/**
 * C-AGI: the joint limit table for a body of this agility (0..1000). Identity (same numbers) at
 * AGILITY_REFERENCE or for an absent agility; wider above it (bounded by ANATOMICAL_CAP), narrower
 * below it; hard stops never move; rest always stays inside.
 */
export function agilityLimits(limits: LimitMap, agility: number | null | undefined): Map<JointName, { min: number; max: number; rest: number }> {
  const k = agilityScale(agility);
  const out = new Map<JointName, { min: number; max: number; rest: number }>();
  for (const [name, l] of limits) out.set(name, scaledWindow(name, l, k));
  return out;
}

/** Total travel (sum of max - min over every joint, rad): the "reachable range" meter. */
export function totalTravel(limits: LimitMap): number {
  let s = 0;
  for (const l of limits.values()) s += l.max - l.min;
  return s;
}
