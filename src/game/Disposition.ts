// Disposition: how a fighter feels about the others, and when it may attack.
//
// A match opens with everyone FRIENDLY. After `friendlySeconds` they turn NEUTRAL,
// and `neutralSeconds` later they turn ENEMY and may fight. Nobody may attack
// during the friendly or neutral phases, which is what gives the opening its
// "everyone is discovering the place" character.
//
// The disposition is visible on the ground: green, amber, red.
//
// Pure module: no Three.js, no DOM.

export type Disposition = "friendly" | "neutral" | "enemy";

export interface PhaseTiming {
  /** Seconds everyone stays friendly. */
  friendlySeconds: number;
  /** Seconds everyone stays neutral after that. */
  neutralSeconds: number;
}

/** The brief: friendly, then neutral 3 s later, then hostile 3 s after that. */
export const DEFAULT_TIMING: PhaseTiming = { friendlySeconds: 3, neutralSeconds: 3 };

/** Seconds before anyone may attack (6 s with the default timing). */
export function truceSeconds(t: PhaseTiming = DEFAULT_TIMING): number {
  return t.friendlySeconds + t.neutralSeconds;
}

export function dispositionAt(elapsed: number, t: PhaseTiming = DEFAULT_TIMING): Disposition {
  if (elapsed < t.friendlySeconds) return "friendly";
  if (elapsed < truceSeconds(t)) return "neutral";
  return "enemy";
}

/** May this fighter attack at this point in the match? */
export function canAttack(elapsed: number, t: PhaseTiming = DEFAULT_TIMING): boolean {
  return dispositionAt(elapsed, t) === "enemy";
}

/** Ground-aura colour per disposition: green, amber, red. */
export function dispositionColour(d: Disposition): string {
  switch (d) {
    case "friendly": return "#82b970";
    case "neutral": return "#dfaa55";
    default: return "#ef7455";
  }
}

/** 0..1 across the whole opening, for a HUD countdown. */
export function truceProgress(elapsed: number, t: PhaseTiming = DEFAULT_TIMING): number {
  const total = truceSeconds(t);
  if (total <= 0) return 1;
  return Math.max(0, Math.min(1, elapsed / total));
}

/** Seconds until the truce lifts; 0 once it has. */
export function truceRemaining(elapsed: number, t: PhaseTiming = DEFAULT_TIMING): number {
  return Math.max(0, truceSeconds(t) - elapsed);
}

/**
 * Should this fighter be hostile toward that one? During the truce nobody is.
 * After it, hostility is per-pair so a future team mode can keep some of them
 * friendly to each other.
 */
export function isHostile(
  elapsed: number,
  attacker: number,
  target: number,
  allies: Record<number, number[]> = {},
  t: PhaseTiming = DEFAULT_TIMING,
): boolean {
  if (!canAttack(elapsed, t)) return false;
  if (attacker === target) return false;
  return !(allies[attacker] ?? []).includes(target);
}

/** A short HUD label, e.g. "NEUTRAL 2.4s". */
export function dispositionLabel(elapsed: number, t: PhaseTiming = DEFAULT_TIMING): string {
  const d = dispositionAt(elapsed, t);
  if (d === "enemy") return "HOSTILE";
  return `${d.toUpperCase()} ${truceRemaining(elapsed, t).toFixed(1)}s`;
}

/**
 * The roam behaviour during the truce: wander, look around, and turn to face
 * whatever the senses just found. Returned as a target yaw so the engine stays
 * free of the policy.
 */
export interface RoamInput {
  x: number; z: number;
  /** Arena half-size, to keep the wander inside the ring. */
  bound: number;
  /** Deterministic roll 0..1. */
  roll: number;
  /** Seconds since the match began, so the heading drifts over time. */
  elapsed: number;
  /** Seed, so two bots do not wander in lockstep. */
  seed: number;
}

export interface RoamIntent {
  /** Point to walk toward. */
  tx: number; tz: number;
  /** True when the bot should stand still and look around instead. */
  idle: boolean;
}

export function roamIntent(i: RoamInput): RoamIntent {
  // A slow Lissajous wander: two incommensurate frequencies, so the path never
  // repeats exactly and each bot has its own phase from its seed.
  const ph = (i.seed % 1000) / 1000 * Math.PI * 2;
  const t = i.elapsed;
  const r = Math.max(0.2, i.bound - 1.2);
  const tx = Math.sin(t * 0.37 + ph) * r * 0.6 + (i.roll - 0.5) * 0.8;
  const tz = Math.cos(t * 0.29 + ph * 1.7) * r * 0.6 + (i.roll - 0.5) * 0.8;
  // One bot in five simply stands and looks around for a spell.
  const idle = ((i.seed + Math.floor(t / 2)) % 5) === 0;
  return { tx, tz, idle };
}
