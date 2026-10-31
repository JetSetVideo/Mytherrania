// Match terms and playback rate: the two knobs a player turns before a fight
// (how long the bout runs, how fast it plays back) plus the arithmetic that
// turns them into health pools and per-frame simulated time.
//
// The engine calls stepTime(dt, speedId) once per frame to advance the fight by
// a scaled, tunnel-safe amount of simulated time, and scaledMaxHealth(base,
// lengthId) when it spawns a fighter's health bar. Pure module: no Three.js, no DOM.

export type MatchLengthId = "standard" | "short" | "blitz";

export interface MatchLength {
  id: MatchLengthId;
  /** Human-readable label for the pre-match menu and history page. */
  label: string;
  /** Multiplier applied to a fighter's base max health. */
  healthScale: number;
}

export type SpeedId = "half" | "normal" | "double" | "quad" | "eight";

export interface Speed {
  id: SpeedId;
  /** Human-readable label for the speed control. */
  label: string;
  /** Simulated seconds advanced per real second (and per unit of dt). */
  timeScale: number;
}

/** Every selectable match length, in menu order. */
export const MATCH_LENGTHS: readonly MatchLength[] = [
  { id: "standard", label: "Standard", healthScale: 1 },
  { id: "short", label: "Short", healthScale: 0.5 },
  { id: "blitz", label: "Blitz", healthScale: 0.25 },
];

/** Every selectable playback speed, in menu order. */
export const SPEEDS: readonly Speed[] = [
  { id: "half", label: "Half", timeScale: 0.5 },
  { id: "normal", label: "Normal", timeScale: 1 },
  { id: "double", label: "Double", timeScale: 2 },
  { id: "quad", label: "Quad", timeScale: 4 },
  { id: "eight", label: "Eight", timeScale: 8 },
];

const DEFAULT_LENGTH_ID: MatchLengthId = "standard";
const DEFAULT_SPEED_ID: SpeedId = "normal";

/**
 * Largest amount of simulated time a single step may advance, in seconds. A
 * larger dt (a stalled frame, a tab waking from sleep) would let a fast body
 * move further than its own thickness in one step and tunnel through a wall.
 */
export const MAX_STEP_SECONDS = 0.25;

const clampStep = (v: number) => (v < 0 ? 0 : v > MAX_STEP_SECONDS ? MAX_STEP_SECONDS : v);

/** The length row for an id, falling back to standard for an unknown id. */
export function resolveLength(id: string): MatchLength {
  return MATCH_LENGTHS.find((l) => l.id === id) ?? MATCH_LENGTHS.find((l) => l.id === DEFAULT_LENGTH_ID)!;
}

/** The speed row for an id, falling back to normal for an unknown id. */
export function resolveSpeed(id: string): Speed {
  return SPEEDS.find((s) => s.id === id) ?? SPEEDS.find((s) => s.id === DEFAULT_SPEED_ID)!;
}

/**
 * A fighter's max health for the chosen match length. Floored at 1 so a tiny
 * base can never scale to 0 and spawn a fighter already dead.
 */
export function scaledMaxHealth(base: number, lengthId: string): number {
  return Math.max(1, Math.floor(base * resolveLength(lengthId).healthScale));
}

/**
 * The simulated time one step advances for a real-time dt at the chosen speed,
 * clamped to MAX_STEP_SECONDS so a huge dt can never tunnel a body through a wall.
 */
export function stepTime(dt: number, speedId: string): number {
  return clampStep(dt * resolveSpeed(speedId).timeScale);
}

/**
 * How many real seconds a match of the given simulated length takes to watch at
 * the chosen speed. Double speed halves the wall-clock time, and so on.
 */
export function effectiveDuration(durationS: number, speedId: string): number {
  return durationS / resolveSpeed(speedId).timeScale;
}

/**
 * The brief's match time limit: a fight that runs to the cap with nobody KO'd
 * is a TIE, not a win. 180 s is the spoken "3 minutes maximum a match".
 */
export const MATCH_TIME_LIMIT_S = 180;

/** Hard ceiling for a configured limit (the brief's "4 minutes maximum"). */
export const MATCH_TIME_LIMIT_MAX_S = 240;

/** Floor for a configured limit: below this a bout cannot resolve. */
export const MATCH_TIME_LIMIT_MIN_S = 30;

/**
 * The seconds a match may run before the clock calls it a tie.
 *
 * A non-finite or absent input falls back to MATCH_TIME_LIMIT_S: a NaN config
 * from storage or a bad menu value must never reach the history as a NaN limit.
 * Anything else is clamped into [MATCH_TIME_LIMIT_MIN_S, MATCH_TIME_LIMIT_MAX_S].
 */
export function resolveTimeLimit(configured?: number): number {
  if (configured === undefined || !Number.isFinite(configured)) return MATCH_TIME_LIMIT_S;
  return Math.max(MATCH_TIME_LIMIT_MIN_S, Math.min(MATCH_TIME_LIMIT_MAX_S, configured));
}
