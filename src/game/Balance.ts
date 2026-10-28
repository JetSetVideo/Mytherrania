// Balance and hit-recovery physics: a damped-sinusoid centre-of-mass sway that
// drives the body back toward its balancing point after an impact.
//
// The model is the one the user specified: a lateral offset that decays as
//     Pos(t) = A · e^(−γt) · sin(ωt + φ) + Pos_balance
// where the amplitude A, decay γ and frequency ω come from a unified status
// equation over the fighter's attributes and the hit. If the offset grows past
// a threshold the fighter can no longer recover on its feet and should stagger
// or be knocked down (the Engine decides which; this module reports it).
//
// Pure module: no Three.js, no DOM.

export interface BalanceInput {
  /** Physical attributes. */
  weight: number;       // kg
  strength: number;     // primary stat
  power: number;        // primary stat (attack power)
  /** Current status, each 0..1. */
  healthRatio: number;
  staminaRatio: number;
  /** Armour mass (kg) — more armour = more inertia, slower recovery. */
  armorMass: number;
  /** The hit. */
  impactForce: number;  // N·s impulse magnitude
  impactSide: number;   // −1..1, lateral direction of the blow
  critMultiplier: number; // 1 = normal hit, >1 = critical
}

export interface BalanceState {
  /** Current lateral offset from the balance point (m). */
  offset: number;
  /** Current sway velocity (m/s). */
  velocity: number;
  /** True once the offset passed the stagger threshold. */
  staggered: boolean;
  /** True once the offset passed the (larger) knockdown threshold. */
  knockedDown: boolean;
  /** Time since the last impact (s). */
  t: number;
}

/** Thresholds in metres: offset past `stagger` staggers, past `knockdown` downs. */
export const STAGGER_OFFSET = 0.25;
export const KNOCKDOWN_OFFSET = 0.55;

/** The base spring frequency (rad/s) of a fit, unarmoured fighter. */
const OMEGA_BASE = 9;
/** How fast the sway damps out, before modifiers. */
const GAMMA_BASE = 4;

/**
 * The recovery parameters from the unified status equation. Stronger, healthier,
 * higher-stamina fighters recover faster (γ up, A down); heavier and more
 * armoured fighters sway longer and recover slower; a harder, critical hit from
 * the side displaces further.
 */
export function balanceParams(input: BalanceInput): { amplitude: number; gamma: number; omega: number } {
  const fitness = 0.4 + 0.6 * ((input.strength + input.power) / 40);       // 0.4..1.0
  const condition = 0.3 + 0.35 * input.healthRatio + 0.35 * input.staminaRatio; // 0.3..1.0
  const inertia = (input.weight + input.armorMass) / 80;                    // ~1 at 80 kg
  const hit = (input.impactForce / 600) * (0.6 + 0.4 * input.critMultiplier); // ~1 at a hard hit

  const amplitude = clamp(hit / (fitness * condition * inertia), 0, 1.2) * Math.sign(input.impactSide || 1);
  const gamma = GAMMA_BASE * fitness * condition / inertia;
  const omega = OMEGA_BASE * (0.7 + 0.3 * condition) / Math.sqrt(Math.max(0.4, inertia));
  return { amplitude, gamma, omega };
}

/** A balance plate: tracks the offset and integrates the damped oscillation. */
export class BalancePlate {
  #offset = 0;
  #velocity = 0;
  #t = 0;
  #amplitude = 0;
  #gamma = GAMMA_BASE;
  #omega = OMEGA_BASE;
  #staggered = false;
  #knockedDown = false;

  /** Deliver an impact: recompute the sway from the unified equation. */
  impact(input: BalanceInput): void {
    const p = balanceParams(input);
    // Seed the oscillator with the impact amplitude and a forward velocity.
    this.#amplitude = p.amplitude;
    this.#gamma = p.gamma;
    this.#omega = p.omega;
    this.#t = 0;
    this.#offset = 0;
    this.#velocity = p.amplitude * p.omega; // start moving away from centre
    this.#staggered = false;
    this.#knockedDown = false;
  }

  /**
   * Advance the sway by dt (s). Integrates the damped sinusoid numerically so a
   * long frame cannot blow up, then reads the stagger/knockdown flags off the
   * current offset.
   */
  update(dt: number): BalanceState {
    if (this.#amplitude !== 0) {
      const n = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        // Damped harmonic oscillator: x'' = −ω²x − 2γx'
        const accel = -this.#omega * this.#omega * this.#offset - 2 * this.#gamma * this.#velocity;
        this.#velocity += accel * h;
        this.#offset += this.#velocity * h;
        this.#t += h;
      }
      // Settle: once the envelope is negligible, rest at the balance point.
      if (Math.abs(this.#offset) < 1e-4 && Math.abs(this.#velocity) < 1e-3) {
        this.#amplitude = 0;
        this.#offset = 0;
        this.#velocity = 0;
      }
    }
    const a = Math.abs(this.#offset);
    if (a > STAGGER_OFFSET) this.#staggered = true;
    if (a > KNOCKDOWN_OFFSET) this.#knockedDown = true;
    return this.state();
  }

  /** The closed-form offset at time t (for tests and for the pose equation). */
  analyticOffset(t: number): number {
    if (this.#amplitude === 0) return 0;
    return this.#amplitude * Math.exp(-this.#gamma * t) * Math.sin(this.#omega * t);
  }

  state(): BalanceState {
    return {
      offset: this.#offset,
      velocity: this.#velocity,
      staggered: this.#staggered,
      knockedDown: this.#knockedDown,
      t: this.#t,
    };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
