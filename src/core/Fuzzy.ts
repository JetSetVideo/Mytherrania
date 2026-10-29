// Fuzzy logic, windows, hysteresis and fade envelopes: the maths every situational event is
// built from (src/world/events). Pure, allocation-free per call, total over edge cases (NaN, +-Inf,
// zero or negative widths, dt <= 0 or huge): every function returns a finite value in its stated
// range for ANY input.
//
// Vocabulary:
//   membership  a degree of truth in [0, 1] ("how much is it golden hour").
//   t-norm      fuzzy AND. `and` is the product (smooth: every condition keeps mattering);
//               `andMin` is Zadeh's min (the weakest condition decides alone).
//   t-conorm    fuzzy OR: the probabilistic sum a + b - ab (smooth, never exceeds 1).
//   window      a C2 bump: 0 outside [lo, hi], rising over the first `edge`, falling over the last.
//   hysteresis  a Schmitt trigger: switches ON above `on`, OFF below `off` (< on), so a score that
//               hovers near one threshold never flickers.
//   envelope    attack / hold / release fade of an event's displayed intensity: exponential
//               approach (half-lives in seconds) with a minimum hold, shaped by smootherstep so
//               the fade starts and ends with zero slope (no visible "pop" at either end).

/** NaN -> fallback, +-Infinity kept (callers clamp). */
const fin = (v: number, fallback = 0) => (Number.isNaN(v) ? fallback : v);

/** Clamp to [0, 1]; NaN -> 0. */
export function unit(v: number): number {
  return v > 0 ? (v < 1 ? v : 1) : 0;
}

/** Perlin's smootherstep (C2) from e0 to e1; e0 > e1 gives a falling ramp; e0 == e1 is a step at e0. */
export function ramp(x: number, e0: number, e1: number): number {
  x = fin(x, e0);
  if (e0 === e1) return x >= e0 ? 1 : 0;
  const t = unit((x - e0) / (e1 - e0));
  // The quintic rounds to 1 + 1e-15 just below t = 1: clamp the result, not only t.
  return unit(t * t * t * (t * (t * 6 - 15) + 10));
}

/** C2 window: 0 below lo, 1 on [lo + edge, hi - edge], 0 above hi (edge clamped to half the width). */
export function window(x: number, lo: number, hi: number, edge: number): number {
  if (!(hi > lo)) return 0;
  const e = Math.max(1e-9, Math.min(Math.abs(fin(edge, 0)), (hi - lo) / 2));
  return ramp(x, lo, lo + e) * (1 - ramp(x, hi - e, hi));
}

/** Gaussian bump exp(-((x - c) / w)^2); w <= 0 -> 0 (an empty event never fires). */
export function bump(x: number, centre: number, width: number): number {
  if (!(width > 0) || !Number.isFinite(centre)) return 0;
  const z = (x - centre) / width;
  return Number.isFinite(z) ? Math.exp(-z * z) : 0;
}

/** Fuzzy AND (product t-norm) of any number of memberships. */
export function and(...m: number[]): number {
  let r = 1;
  for (const v of m) r *= unit(v);
  return r;
}

/** Fuzzy AND (Zadeh min). */
export function andMin(...m: number[]): number {
  let r = 1;
  for (const v of m) r = Math.min(r, unit(v));
  return r;
}

/** Fuzzy OR (probabilistic sum): 1 - prod(1 - m_i). */
export function or(...m: number[]): number {
  let r = 1;
  for (const v of m) r *= 1 - unit(v);
  return 1 - r;
}

/** Fuzzy NOT. */
export function not(m: number): number {
  return 1 - unit(m);
}

/** Angle between two unit-ish vectors, rad (normalises; zero vectors -> pi/2). */
export function angleBetween(a: readonly number[], b: readonly number[]): number {
  const la = Math.hypot(a[0], a[1], a[2]), lb = Math.hypot(b[0], b[1], b[2]);
  if (!(la > 0) || !(lb > 0)) return Math.PI / 2;
  const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
  return Math.acos(c > 1 ? 1 : c < -1 ? -1 : c);
}

/** Schmitt trigger state. */
export interface Gate { on: boolean }

/** Update a hysteresis gate: on above `onAt`, off below `offAt` (offAt is forced <= onAt). Returns the state. */
export function gate(g: Gate, score: number, onAt: number, offAt: number): boolean {
  const s = fin(score, 0);
  const off = Math.min(offAt, onAt);
  if (g.on) { if (s < off) g.on = false; } else if (s >= onAt) g.on = true;
  return g.on;
}

/** Fade envelope state: `level` is the linear follower, `out` the shaped intensity actually used. */
export interface Envelope {
  level: number;
  out: number;
  /** Seconds the gate has been open in this activation (for the minimum hold). */
  held: number;
  /** True while the gate is open or the minimum hold has not elapsed. */
  active: boolean;
}

export function createEnvelope(): Envelope {
  return { level: 0, out: 0, held: 0, active: false };
}

/** Largest dt an envelope integrates in one call, s (a hidden tab returning after minutes must not snap). */
export const ENVELOPE_MAX_DT = 0.25;
/** Below this the follower snaps to its target (an exponential never reaches it). */
export const ENVELOPE_SNAP = 1e-4;

/**
 * Advance an envelope by dt seconds toward `target` (0..1, the gated score):
 *   while the gate is open or `held < minHold`: follow max(target, out-of-hold floor) with the ATTACK half-life
 *   afterwards: fall with the RELEASE half-life
 *   level += (goal - level) (1 - 2^(-dt / halfLife));  out = smootherstep(level)
 * dt is clamped to [0, ENVELOPE_MAX_DT]; NaN dt or target is treated as 0.
 */
export function stepEnvelope(e: Envelope, open: boolean, target: number, dt: number, attackHalfLife: number, releaseHalfLife: number, minHold = 0): Envelope {
  const step = Math.min(ENVELOPE_MAX_DT, Math.max(0, fin(dt, 0)));
  const tgt = unit(target);
  if (open) e.held += step;
  const holding = !open && e.active && e.held < minHold;
  if (holding) e.held += step;
  e.active = open || holding;
  if (!e.active) e.held = 0;
  const goal = e.active ? Math.max(tgt, holding ? e.level : 0) : 0;
  const rising = goal > e.level;
  const hl = Math.max(1e-3, fin(rising ? attackHalfLife : releaseHalfLife, 1));
  e.level += (goal - e.level) * (1 - Math.pow(2, -step / hl));
  if (Math.abs(goal - e.level) < ENVELOPE_SNAP) e.level = goal;
  e.level = unit(e.level);
  const t = e.level;
  e.out = unit(t * t * t * (t * (t * 6 - 15) + 10));
  return e;
}
