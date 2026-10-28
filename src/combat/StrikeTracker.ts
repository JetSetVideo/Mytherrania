// Lane X (W05): per-fighter strike bookkeeping the engine calls every frame. Pure module.
//
//   • keeps the weapon's previous and current local->world matrices (the sweep's two instants),
//   • numbers swings, so ONE damage event lands per swing per target,
//   • opens the hit test only inside the swing's STRIKE WINDOW (the fast part of the animation),
//     never on key press: the blade must actually travel through the target.
//
// Strike window of a skill curve: AnimationCurve.impulse rises on a sine to the curve's peak at
// `hitAt` (the arm's furthest reach, where its speed is ZERO) and falls on a cosine back to rest.
// The blade moves fastest at the two ends of each half, so the window spans the late rise and
// the whole fall: [hitAt − WINDOW_LEAD·hitAt, 1] — the wind-down after the peak IS the cut for an
// overhead curve. The plain attack (the Animator's attack layer for ATTACK_HOLD seconds) strikes
// on the way back down: [ATTACK_HOLD − ATTACK_LEAD, ATTACK_HOLD + ATTACK_TRAIL] seconds.

import type { Contact, HitboxSet, StrikeSample, WeaponSpec } from "./contracts.ts";
import { sweepStrike, type SweepOptions } from "./Sweep.ts";

/** Share of the rise before the peak that already counts as striking (the rise's fast start is wind-up). */
export const WINDOW_LEAD = 0.35;
/** The engine's plain-attack hold (Engine: anim.attack = 0.25 s) and its strike span around the release, s. */
export const ATTACK_HOLD = 0.25, ATTACK_LEAD = 0.1, ATTACK_TRAIL = 0.3;

/** A strike window in normalised animation progress (0..1) or seconds — the caller decides the unit. */
export interface StrikeWindow { start: number; end: number }

/** The strike window of a skill animation (module comment), in normalised progress. */
export function skillStrikeWindow(anim: { hitAt: number }): StrikeWindow {
  const p = Math.min(0.95, Math.max(0.05, anim.hitAt));
  return { start: p * (1 - WINDOW_LEAD), end: 1 };
}

/** The plain attack's strike window, in seconds since the attack started. */
export function attackStrikeWindow(): StrikeWindow {
  return { start: ATTACK_HOLD - ATTACK_LEAD, end: ATTACK_HOLD + ATTACK_TRAIL };
}

/** Per-fighter tracker (module comment). Allocates nothing per frame. */
export class StrikeTracker {
  /** Weapon matrices at the previous and the current frame. */
  readonly prev: StrikeSample = { matrix: new Float32Array(16), time: 0 };
  readonly curr: StrikeSample = { matrix: new Float32Array(16), time: 0 };
  /** Current swing number (0 = none yet). */
  swingId = 0;
  /** Hands on the weapon for this swing (impact: a second hand adds arm mass). */
  handsUsed: 1 | 2 = 1;
  /** True while the swing is in its strike window. */
  active = false;
  #samples = 0;
  readonly #struck = new Set<number>();

  /** Start a new swing (attack press, skill start): clears the struck set. Returns its id. */
  beginSwing(handsUsed: 1 | 2 = 1): number {
    this.swingId++;
    this.handsUsed = handsUsed;
    this.#struck.clear();
    this.active = false;
    return this.swingId;
  }

  /** The swing is over (animation finished or cancelled). */
  endSwing(): void { this.active = false; }

  /** Open/close the hit test from the swing's progress (null = no swing running). */
  updateWindow(progress: number | null, window: StrikeWindow): void {
    this.active = progress !== null && progress >= window.start && progress <= window.end;
  }

  /**
   * Record this frame's weapon matrix (THREE: weaponNode.matrixWorld.elements) and time (s).
   * Call EVERY frame, swinging or not, so the previous matrix is valid when the window opens.
   */
  sample(matrix: ArrayLike<number>, time: number): void {
    const p = this.prev.matrix as Float32Array, c = this.curr.matrix as Float32Array;
    p.set(c); this.prev.time = this.curr.time;
    for (let i = 0; i < 16; i++) c[i] = matrix[i];
    this.curr.time = time;
    this.#samples++;
  }

  /** Forget the motion history (teleport, respawn): the next frame has no previous sample. */
  reset(): void { this.#samples = 0; this.active = false; }

  /** True when target `id` may be tested now: in the window, two samples, not yet hit this swing. */
  canStrike(id: number): boolean {
    return this.active && this.#samples >= 2 && !this.#struck.has(id);
  }

  /** Record that target `id` took this swing's damage event. */
  markStruck(id: number): void { this.#struck.add(id); }

  /** Whether target `id` was already struck in the current swing. */
  struck(id: number): boolean { return this.#struck.has(id); }

  /**
   * Sweep this frame's motion against target `id`'s hitboxes; on contact, mark it struck and
   * return the contact (the caller resolves the impact). Null when not allowed or no contact.
   */
  sweep(id: number, target: HitboxSet, weapon: WeaponSpec, opts?: SweepOptions): Contact | null {
    if (!this.canStrike(id)) return null;
    const hit = sweepStrike(this.prev, this.curr, target, weapon, opts);
    if (hit) this.markStruck(id);
    return hit;
  }
}
