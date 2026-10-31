// Lane H-C: hair / beard / brow SECONDARY MOTION.
//
// A displaced secondary mass — one fall of hair, a beard, a brow tip — is a small
// damped spring anchored to the head. The world's wind (the climate's wind vector)
// and the head's own motion (a swing, a lunge, an impact ride in as headVel) push
// it out; the spring pulls it home. How much it reacts follows the mass, which the
// ancestry ladder derives from hair length and curl.
//
// Per mass i, per axis, the equation of motion is
//
//     x'' = -(k/m)·x - (c/m)·x' + F/m            (docs/ancestry/BRIEF.md §1.2)
//
// with k = spec.stiffness (N/m), c = spec.damp (N·s/m), m = spec.massKg (kg), and
//
//     F = windGain · wind_body · flutter_i(s) − HEAD_DRAG · headVel_body
//
//   · wind_body is the climate's wind vector (Weather.state.windSpeedMs direction,
//     m/s) rotated into the body frame by the facing yaw, so the SAME world wind
//     catches a different local axis as the character turns. It pushes the mass
//     along the wind (a positive wind gives a positive offset).
//   · headVel_body is the head's world velocity, rotated the same way. A one-frame
//     spike displaces the mass, then the spring returns it.
//   · flutter_i(s) is a per-mass, per-substep phase (seeded) so two locks and a
//     beard do not move as one rigid plate. It is a pure function of the absolute
//     simulated time, so chunking the same time differently gives the same value.
//   · wetness raises the effective damping (wet hair is heavy) and cuts the wind
//     and head response (it sags instead of flying).
//   · mass sits in the DENOMINATOR (a = F/m): a long, heavy lock reacts less than a
//     short, light one; a curly lock carrying a higher windGain catches more.
//
// Integration is SEMI-IMPLICIT (velocity first, then position), sub-stepped to a
// fixed internal h = SUBSTEP_H. The fixed substep makes the solver frame-rate
// INDEPENDENT: the same simulated time in one big step or many small ones runs the
// same substeps over the same absolute times and agrees to well under 1 % — so the
// house bug of pass 12 (damping encoded three different ways, docs/GLOSSARY.md
// 'lambda') cannot reappear here. dt is clamped to MAX_STEP_SECONDS
// (src/game/MatchControl.ts) so a stalled frame cannot advance past stability.
//
// Total: a violent or NaN input can never NaN, explode or leave the 1 m box.
// Pure module: no Three.js, no DOM, no allocation inside step().
//
// H-A owns HairPhysicsSpec in ../Ancestry.ts (BRIEF §1.1/§1.2). Until that file
// lands this module consumes the spec STRUCTURALLY (the shape is frozen, so an
// ancestry node's `hairPhysics` passes straight in once H-A imports it) — see
// artifacts/messages-HC.md. The constructor parameter below is that structural
// type; switch it to `import type { HairPhysicsSpec } from "../Ancestry.ts"` and
// name it HairPhysicsSpec when the file exists.

import { clamp, rng32 } from "../../core/MathCore.ts";
import { MAX_STEP_SECONDS } from "../MatchControl.ts";

/** One displaced secondary mass (a hair fall, a beard, a brow tip). */
export interface SecondaryState {
  offset: [number, number, number];
  vel: [number, number, number];
}

export interface SecondaryInputs {
  /** Wind in the world's frame, m/s, from the climate's wind vector. */
  wind: readonly [number, number, number];
  /** The head's world velocity, m/s (swing and lunge impulses ride in here). */
  headVel: readonly [number, number, number];
  /** The character's facing yaw, rad, so wind is expressed in body space. */
  yaw: number;
  /** 0..1 how wet/heavy the mass is (rain makes it sag and react less). */
  wetness: number;
}

// ─── Solver constants (each with the reason it has that value) ─────────────────────────────────

/**
 * Fixed internal integration step, s. Half of the 120 Hz physics substep the
 * Skeleton already uses, so symplectic-Euler error is negligible, AND a whole step
 * of 0.1 s runs exactly the same substeps (h = 0.005) as ten of 0.01 s — the
 * frame-rate independence the BRIEF demands.
 */
export const SUBSTEP_H = 1 / 200;

/** Hard per-axis bound on a mass offset, m: the BRIEF's "1 m box". */
export const OFFSET_BOX = 1;

/**
 * Largest mass speed, m/s. Bounds a single step's displacement to < 0.1 m even at
 * a 60 Hz dt with a violent input (3/60 = 0.05 m per component, ≤ 0.087 m in the
 * magnitude), so no input can make the offset jump, and keeps a blow-up finite.
 */
export const MAX_MASS_SPEED = 3;

/** |offset| and |vel| both under this counts as at rest (1 mm / 1 mm·s⁻¹). */
export const REST_EPS = 1e-3;

/** Head-motion coupling: force per unit head velocity, N·s/m (a swing drags the hair). */
export const HEAD_DRAG = 0.5;

/** Wetness raises the damping by this factor (wet hair is heavy and sluggish). */
export const WET_DAMP = 1.5;

/** Wetness removes this share of the wind and head response (it sags, not flies). */
export const WET_RESPONSE = 0.7;

/** Per-mass flutter: amplitude (share of the wind force) and rate, Hz. */
export const FLUTTER_AMP = 0.12;
export const FLUTTER_HZ = 0.7;

/** Per-mass seeded variation (± share) on mass, stiffness, damping and wind gain. */
export const VAR_MASS = 0.2;
export const VAR_K = 0.18;
export const VAR_C = 0.18;
export const VAR_GAIN = 0.25;

// Spec sanity clamps: a nonsense spec can never make the solver explode.
const MIN_MASS = 0.005, MAX_MASS = 5;
const MIN_K = 0, MAX_K = 5000;
const MIN_C = 0, MAX_C = 500;
const MAX_GAIN = 50;

/** Finite-or-default. */
function num(v: number | undefined, d: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}

/** Component i of a vec3 input, or 0 for a missing / non-finite entry. */
function comp(v: readonly [number, number, number] | undefined, i: 0 | 1 | 2): number {
  const x = v ? v[i] : 0;
  return Number.isFinite(x) ? x : 0;
}

export class SecondaryMotion {
  readonly #count: number;
  readonly #massKg: number;
  readonly #k: number;
  readonly #c: number;
  readonly #gain: number;
  /** Per-mass offset and velocity, count·3 (x,y,z interleaved). */
  readonly #off: Float64Array;
  readonly #vel: Float64Array;
  /** Per-mass seeded multipliers (mass, stiffness, damping, wind gain) and phase. */
  readonly #massMul: Float64Array;
  readonly #kMul: Float64Array;
  readonly #cMul: Float64Array;
  readonly #gainMul: Float64Array;
  readonly #phase: Float64Array;
  /** Absolute simulated time, s (drives the flutter phase; frame-rate independent). */
  #t = 0;

  /**
   * `spec` is structurally HairPhysicsSpec (../Ancestry.ts, owned by H-A). `count`
   * is the number of masses the rig exposes; `seed` fixes the per-mass variation
   * (same seed → same trajectory).
   */
  constructor(
    spec: { massKg: number; stiffness: number; damp: number; windGain: number },
    count: number,
    seed: number,
  ) {
    const n = Math.max(0, Math.floor(num(count, 0)));
    this.#count = n;
    this.#massKg = clamp(num(spec?.massKg, 0.1), MIN_MASS, MAX_MASS);
    this.#k = clamp(num(spec?.stiffness, 120), MIN_K, MAX_K);
    this.#c = clamp(num(spec?.damp, 2), MIN_C, MAX_C);
    this.#gain = clamp(num(spec?.windGain, 1), 0, MAX_GAIN);
    this.#off = new Float64Array(n * 3);
    this.#vel = new Float64Array(n * 3);
    this.#massMul = new Float64Array(n);
    this.#kMul = new Float64Array(n);
    this.#cMul = new Float64Array(n);
    this.#gainMul = new Float64Array(n);
    this.#phase = new Float64Array(n);
    const rnd = rng32(num(seed, 0));
    for (let i = 0; i < n; i++) {
      this.#massMul[i] = 1 + VAR_MASS * (2 * rnd() - 1);
      this.#kMul[i] = 1 + VAR_K * (2 * rnd() - 1);
      this.#cMul[i] = 1 + VAR_C * (2 * rnd() - 1);
      this.#gainMul[i] = 1 + VAR_GAIN * (2 * rnd() - 1);
      this.#phase[i] = 2 * Math.PI * rnd();
    }
  }

  /** Integrate one step. dt clamped to MAX_STEP (0.25 s); never NaN, never unbounded. */
  step(dt: number, inputs: SecondaryInputs): void {
    const n = this.#count;
    if (n === 0) return;
    const dtc = Number.isFinite(dt) ? clamp(dt, 0, MAX_STEP_SECONDS) : 0;

    // Wind and head velocity, world -> body frame by the facing yaw (R_y(-yaw)).
    const wx = comp(inputs?.wind, 0), wy = comp(inputs?.wind, 1), wz = comp(inputs?.wind, 2);
    const hx = comp(inputs?.headVel, 0), hy = comp(inputs?.headVel, 1), hz = comp(inputs?.headVel, 2);
    const yaw = num(inputs?.yaw, 0);
    const wet = clamp(num(inputs?.wetness, 0), 0, 1);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const windX = wx * cy + wz * sy, windY = wy, windZ = -wx * sy + wz * cy;
    const headX = hx * cy + hz * sy, headY = hy, headZ = -hx * sy + hz * cy;

    // Fixed sub-stepping: the same h for the same total dt, whatever the chunking.
    const steps = dtc > 0 ? Math.max(1, Math.ceil(dtc / SUBSTEP_H - 1e-9)) : 0;
    const h = steps > 0 ? dtc / steps : 0;

    const wetDamp = 1 + WET_DAMP * wet;
    const wetResp = 1 - WET_RESPONSE * wet;
    const headF = HEAD_DRAG * wetResp;
    // flutter_i = 1 + FLUTTER_AMP·sin(2π·FLUTTER_HZ·(t + (s+1)·h) + phase_i): a pure
    // function of the absolute time, so chunking agrees exactly.
    const stepPhase = 2 * Math.PI * FLUTTER_HZ * h;
    const theta0 = 2 * Math.PI * FLUTTER_HZ * this.#t + stepPhase;

    for (let i = 0; i < n; i++) {
      const m = clamp(this.#massKg * this.#massMul[i], MIN_MASS, MAX_MASS);
      const invM = 1 / m;
      const k = this.#k * this.#kMul[i];
      const c = this.#c * this.#cMul[i] * wetDamp;
      const windScale = this.#gain * this.#gainMul[i] * wetResp;
      const ph = this.#phase[i];
      const base = i * 3;
      for (let s = 0; s < steps; s++) {
        const flutter = 1 + FLUTTER_AMP * Math.sin(theta0 + s * stepPhase + ph);
        const windF = windScale * flutter;
        for (let axis = 0; axis < 3; axis++) {
          const idx = base + axis;
          const wc = axis === 0 ? windX : axis === 1 ? windY : windZ;
          const hc = axis === 0 ? headX : axis === 1 ? headY : headZ;
          const F = windF * wc - headF * hc;
          let x = this.#off[idx], v = this.#vel[idx];
          // Semi-implicit: velocity first (from the current state), then position.
          v += (-k * x - c * v + F) * invM * h;
          if (v > MAX_MASS_SPEED) v = MAX_MASS_SPEED;
          else if (v < -MAX_MASS_SPEED) v = -MAX_MASS_SPEED;
          x += v * h;
          if (x > OFFSET_BOX) x = OFFSET_BOX;
          else if (x < -OFFSET_BOX) x = -OFFSET_BOX;
          this.#off[idx] = x;
          this.#vel[idx] = v;
        }
      }
    }
    this.#t += dtc;
  }

  /** The offset for mass i, in body-local metres (zeros when i is out of range). */
  offset(i: number): readonly [number, number, number] {
    const j = (i | 0) * 3;
    if (j < 0 || j + 2 >= this.#off.length) return [0, 0, 0];
    return [this.#off[j], this.#off[j + 1], this.#off[j + 2]];
  }

  /** Total displacement magnitude across masses (L2 over every offset component). */
  magnitude(): number {
    let s = 0;
    for (let k = 0; k < this.#off.length; k++) s += this.#off[k] * this.#off[k];
    return Math.sqrt(s);
  }

  /** True once every mass is inside 1 mm of rest (position and velocity). */
  resting(): boolean {
    for (let k = 0; k < this.#off.length; k++) {
      if (Math.abs(this.#off[k]) > REST_EPS) return false;
      if (Math.abs(this.#vel[k]) > REST_EPS) return false;
    }
    return true;
  }
}
