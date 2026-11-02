// Phase-driven locomotion cycle (lane C, R04).
//
// Pure module: no Three.js, no DOM, no allocation per frame. The gait owns WHERE the feet
// are (world x/z of the ball of each foot, its lift and its roll); FootIK turns that into
// joint angles. Feet cannot skate because a planted foot's world position is LATCHED at
// touchdown and only released at lift-off: the body moves over it, the IK follows.
//
// Base parameters -> derived quantities (R08). L = thigh + shin (leg length, m), g = 9.81.
//   ŝ  = v / sqrt(g L)                    dimensionless speed (sqrt of the Froude number)
//   Fr = ŝ²                               Froude number; humans switch walk -> run near 0.5
//   run = smoothstep(Fr0, Fr1, Fr)        walk/run blend, 0 = walk, 1 = run
//   stride λ = L (a + b ŝ)                one full cycle = two steps (m). a = 0.74, b = 1.56
//                                         fitted to Alexander's λ/L = 2.3 Fr^0.3 at ŝ = 0.5, 1
//   duty β = min(lerp(βwalk, βrun, run), 2 L sin(θmax) / λ)
//                                         share of the cycle a foot is planted; capped so the
//                                         stance sweep never exceeds ±θmax about the hip
//   cadence f = v / λ                     cycles per second (phase advances by distance / λ)
//   stance length = β λ                   distance the body travels over a planted foot
//   swing apex H = L (c0 + c1 ŝ + c2 run) foot clearance at mid-swing (m), capped at 0.4 L
//   walk bob  = (1 - k) L (1 - cos θh)    θh = asin(stance / 2L): compass-gait excursion, the
//                                         knee absorbs a share k = 0.5
//   run bob   = g T_f² / 8                ballistic rise for a flight of T_f = (0.5 - β) / f
//   sway roll = atan(sway · L / L)        lateral weight shift over the stance foot (walk)
//
// Phase: one scalar in [0, 1) for the whole body. Leg i sees φ_i = frac(phase + offset_i),
// offsets 0 and 0.5. φ in [0, β) is stance, [β, 1) swing; lift-off fires when φ crosses β,
// touchdown when the swing progress u reaches 1, which is integrated so that it lands exactly
// when φ wraps: u += (1 - u) · dφ / (1 - φ_old).

import { clamp, clamp01, damp, lerp, smootherstep, smoothstep, wrapAngle } from "../../core/MathCore.ts";
import { hipPivot, type LegGeometry, legLength, localToWorld, type Side, worldToLocal } from "./Rig.ts";

/** Named base parameters of the gait. Units in each comment; see the header for the equations. */
export interface GaitParams {
  /** Gravity, m/s². */
  gravity: number;
  /** a: stride / L as speed -> 0. */
  strideAtRest: number;
  /** b: growth of stride / L per unit of dimensionless speed ŝ. */
  strideGain: number;
  /** Froude band [Fr0, Fr1] over which walk blends into run (centred on the 0.5 transition). */
  walkRunFroude: readonly [number, number];
  /** Duty factor (planted share of the cycle) when walking / running. */
  dutyWalk: number;
  dutyRun: number;
  /** θmax: half-angle (rad) the stance leg may sweep about the hip; caps the stance length. */
  maxStanceAngle: number;
  /**
   * θmax for SIDEWAYS travel (rad): the stance sweeps across the hip in the frontal plane, where
   * the trailing foot is pulled under the body by hip ADDUCTION (the animator allows 0.3 rad);
   * 0.8 × 0.3 keeps a margin. The angle for any direction lies on the ellipse
   *   1/θ(φ)² = cos²φ/θmax² + sin²φ/θlat²,   φ = travel direction relative to the facing,
   * and the stride shrinks with it, λ ×= sin θ(φ) / sin θmax: a side shuffle takes short quick
   * steps instead of a forward stride the hips cannot sweep sideways.
   */
  maxStanceAngleLateral: number;
  /**
   * θmax for BACKWARD travel (rad): a backpedal lands each foot behind the hip, so the touchdown
   * is limited by hip EXTENSION (~0.3 rad in human gait), not flexion. Enters the ellipse with
   * the backward share of the direction: 1/θ² = fwd²/θmax² + back²/θback² + side²/θlat².
   */
  maxStanceAngleBack: number;
  /** Swing apex / L = apexBase + apexGain ŝ + apexRun · run, capped at apexMax (heel recovery when running). */
  apexBase: number;
  apexGain: number;
  apexRun: number;
  apexMax: number;
  /** Convergence rate (1/s) of a swing's landing spot toward its prediction (absorbs sudden stops). */
  landLambda: number;
  /**
   * Fastest leg recovery, s: a swing never completes faster than this, whatever the phase does
   * (a sprinter's swing is ~0.3 s; 0.2 s leaves headroom). Bounds du/dt <= 1 / minSwingTime.
   */
  minSwingTime: number;
  /**
   * Shortest ground contact, s. A foot that lands late (overdue) with the phase already past its
   * duty would otherwise lift again on the very next frame: a one-frame stance, the pelvis drops
   * for the new swing in one step and the leg cannot follow. 0.05 s = 3 frames at 60 Hz, under
   * the shortest DERIVED stance (β·λ/v ≈ 0.06 s sideways at 6.5 m/s) so it never stretches a
   * regular stride, only the overdue ones.
   */
  minStanceTime: number;
  /**
   * Safety factor (≥ 1) on minSwingTime when the stride is floored so a swing always fits its
   * window (gaitShape): 1.15 absorbs the one-frame lag of lift-off detection at 60 Hz.
   */
  swingTimeMargin: number;
  /** k: share of the compass-gait vertical excursion the knee absorbs (0 = stiff legs). */
  kneeCompliance: number;
  /** Peak push-off roll onto the ball (rad, toe-down) walking / running. */
  toeOffWalk: number;
  toeOffRun: number;
  /** Last fraction of the stance spent rolling onto the ball. */
  toeOffWindow: number;
  /** Toe-up (rad) of the swinging foot at mid-swing, for clearance. */
  swingDorsiflex: number;
  /** Lateral weight shift over the stance foot / L when walking. */
  swayLateral: number;
  /** Cycle time (s) when the feet step in place to re-plant (turning, settling). */
  stepCycleTime: number;
  /** A planted foot farther than these fractions of L from its rest spot triggers a re-plant step. */
  footErrorForward: number;
  footErrorLateral: number;
  /** Stride shrinks on slopes: λ ×= 1 - strideSlopeLoss·|slope pitch| (rad); humans shorten steps on hills. */
  strideSlopeLoss: number;
  /** Speed (m/s) below which the body counts as standing still. */
  stillSpeed: number;
  /**
   * Wave V lane P — SETTLE: once the body has stood still (speed < stillSpeed, |turn rate| <
   * settleTurnRate) for settleTime s, the re-plant thresholds shrink to settleShare of
   * footErrorForward / footErrorLateral: a fighter tidies a foot a swing or a stop left near the
   * edge of its stance. Without it, a foot sitting just under the threshold stepped or not
   * depending on one frame of touchdown timing (the 30 / 60 / 144 Hz runs diverged).
   */
  settleTime: number;
  settleShare: number;
  settleTurnRate: number;
  /** Speed (m/s) above which the gait is fully "moving" (toe-off, sway, arm swing at full). */
  movingSpeed: number;
  /** Convergence rate (1/s) of the speed the gait shape follows (filters input jitter). */
  speedLambda: number;
}

/** Defaults; every number is a named base parameter of the equations in the header. */
export const DEFAULT_GAIT: GaitParams = {
  gravity: 9.81,
  strideAtRest: 0.74,
  strideGain: 1.56,
  walkRunFroude: [0.35, 0.65],
  dutyWalk: 0.62,
  dutyRun: 0.38,
  maxStanceAngle: 0.45,
  maxStanceAngleLateral: 0.24,
  maxStanceAngleBack: 0.3,
  apexBase: 0.05,
  apexGain: 0.07,
  apexRun: 0.2,
  apexMax: 0.4,
  landLambda: 15,
  minSwingTime: 0.2,
  minStanceTime: 0.05,
  swingTimeMargin: 1.15,
  kneeCompliance: 0.5,
  toeOffWalk: 0.3,
  toeOffRun: 0.5,
  toeOffWindow: 0.3,
  swingDorsiflex: 0.15,
  swayLateral: 0.035,
  stepCycleTime: 0.8,
  footErrorForward: 0.12,
  footErrorLateral: 0.045,
  strideSlopeLoss: 0.9,
  stillSpeed: 0.05,
  settleTime: 0.25,
  settleShare: 0.5,
  // 0.05: after a swing the aim yaw eases back slowly, and a tighter gate (0.01) let the 30/60/144 Hz
  // runs settle at different times again (0.0375 rad apart). In the UNPATCHED engine (no facing hold)
  // a rival swaying ±3.4° can trigger an occasional settle step; the facing hold removes it.
  settleTurnRate: 0.05,
  movingSpeed: 0.5,
  speedLambda: 5,
};

/** The derived shape of the gait at one speed (see the header equations). */
export interface GaitShape {
  /** ŝ = v / sqrt(gL). */
  speedNorm: number;
  /** Fr = ŝ². */
  froude: number;
  /** 0 = walk, 1 = run. */
  runBlend: number;
  /** λ, metres per full cycle. */
  stride: number;
  /** β, planted share of the cycle. */
  duty: number;
  /** Cycles per second at this speed (v / λ). */
  cadence: number;
  /** Distance travelled over one planted foot, m (β λ). */
  stanceLength: number;
  /** Foot clearance at mid-swing, m. */
  swingApex: number;
  /** Vertical pelvis excursion amplitude, m (signed: + walk peaks at mid-stance, - run dips). */
  bobAmplitude: number;
  /** Peak push-off roll, rad. */
  toeOffPitch: number;
  /** Sway roll amplitude, rad. */
  swayRoll: number;
}

/** A zeroed GaitShape to reuse. */
export function newGaitShape(): GaitShape {
  return {
    speedNorm: 0, froude: 0, runBlend: 0, stride: 0, duty: 0, cadence: 0, stanceLength: 0,
    swingApex: 0, bobAmplitude: 0, toeOffPitch: 0, swayRoll: 0,
  };
}

/**
 * Half-angle θ(φ) (rad) the stance leg may sweep for a travel direction with sideways share
 * `lateral` = |sin φ| and backward share `back` = max(0, -cos φ) (forward share = what is left):
 *   1/θ² = fwd²/θmax² + back²/θback² + lateral²/θlat²,  fwd² = max(0, 1 - lateral² - back²).
 */
export function stanceAngleFor(p: GaitParams, lateral: number, back = 0): number {
  const s2 = clamp01(lateral) ** 2, b2 = clamp01(back) ** 2, f2 = Math.max(0, 1 - s2 - b2);
  return 1 / Math.sqrt(f2 / (p.maxStanceAngle ** 2) + b2 / (p.maxStanceAngleBack ** 2) + s2 / (p.maxStanceAngleLateral ** 2));
}

/**
 * Evaluate the gait shape at `speed` (m/s) for a leg of length `leg` (m) on ground pitched by
 * `slopePitch` (rad, along the motion; either sign shortens), travelling at `lateral` = |sin φ|
 * and `back` = max(0, -cos φ) of the facing (sideways / backward: shorter, quicker steps). Writes `out`.
 */
export function gaitShape(
  speed: number, leg: number, p: GaitParams = DEFAULT_GAIT, out: GaitShape = newGaitShape(), slopePitch = 0, lateral = 0,
  back = 0,
): GaitShape {
  const v = Math.max(0, speed);
  const L = Math.max(1e-3, leg);
  const sNorm = v / Math.sqrt(p.gravity * L);
  const fr = sNorm * sNorm;
  const run = smoothstep(p.walkRunFroude[0], p.walkRunFroude[1], fr);
  const hill = clamp(1 - p.strideSlopeLoss * Math.abs(slopePitch), 0.5, 1);
  const theta = stanceAngleFor(p, lateral, back);
  const side = Math.sin(theta) / Math.sin(p.maxStanceAngle);
  const maxStance = 2 * L * Math.sin(theta) * hill;
  const duty0 = lerp(p.dutyWalk, p.dutyRun, run);
  // Swing-time floor: a swing lasts (1 - β)·λ / v and may not be shorter than T = minSwingTime ×
  // swingTimeMargin (the integrator caps it there; a shorter window makes EVERY step overdue).
  // With β = min(β0, S/λ), (1 - β)·λ = max((1 - β0)·λ, λ - S), so the smallest stride is
  //   λmin = min( v·T / (1 - β0),  S + v·T ).   Binds for short legs moving sideways fast.
  const swingT = p.minSwingTime * p.swingTimeMargin;
  const minStride = Math.min(v * swingT / Math.max(1e-6, 1 - duty0), maxStance + v * swingT);
  const stride = Math.max(L * (p.strideAtRest + p.strideGain * sNorm) * hill * side, minStride);
  const duty = Math.min(duty0, maxStance / stride);
  const cadence = v / stride;
  const stance = duty * stride;
  const halfAngle = Math.asin(clamp(stance / (2 * L), 0, 1));
  const walkBob = (1 - p.kneeCompliance) * L * (1 - Math.cos(halfAngle));
  const flight = cadence > 1e-6 ? Math.max(0, 0.5 - duty) / cadence : 0;
  const runBob = Math.min(0.05 * L, p.gravity * flight * flight / 8);
  out.speedNorm = sNorm;
  out.froude = fr;
  out.runBlend = run;
  out.stride = stride;
  out.duty = duty;
  out.cadence = cadence;
  out.stanceLength = stance;
  out.swingApex = L * Math.min(p.apexMax, p.apexBase + p.apexGain * sNorm + p.apexRun * run);
  out.bobAmplitude = lerp(walkBob, -runBob, run);
  out.toeOffPitch = lerp(p.toeOffWalk, p.toeOffRun, run);
  out.swayRoll = (1 - run) * Math.atan(p.swayLateral);
  return out;
}

/** State of one foot (world metres / radians). */
export interface FootState {
  /** True while the foot is latched to the ground. */
  planted: boolean;
  /** World x/z of the ball of the foot: latched while planted, interpolated while swinging. */
  x: number;
  z: number;
  /** Height of the ball above the ground, m (0 while planted). */
  lift: number;
  /** Gait roll of the foot relative to the ground, rad (toe-down > 0: push-off). */
  pitch: number;
  /** Swing progress 0..1 (1 while planted). */
  swing: number;
  /** Where the current swing started (world x/z) and the roll it left with. */
  liftX: number;
  liftZ: number;
  liftPitch: number;
  /** Landing spot the swing is heading for (world x/z), damped toward the prediction. */
  landX: number;
  landZ: number;
  /** Rest spot of this foot this frame (world x/z): under the hip, plus the guard stagger. */
  restX: number;
  restZ: number;
  /**
   * True once the phase wrapped while this foot was still in the air (its landing window passed):
   * it then finishes at the capped swing rate. Without the latch, a duty factor that shrinks
   * while the body speeds up moves φ back into the SWING window and the foot hovers a whole cycle.
   */
  overdue: boolean;
  /**
   * World x/z distance the body still travels before this swing lands (m): actual speed × time
   * left, along the travel direction (0 while planted). The landing spot MINUS this vector is
   * where the foot will sit relative to the body at touchdown — what the pelvis must anticipate.
   */
  toGoX: number;
  toGoZ: number;
  /** Seconds since this foot last touched down (grows while planted). */
  stanceTime: number;
  /**
   * Wave V lane P: the body yaw (rad) when this foot last touched down. The legs have no yaw
   * joint, so a planted foot's heading IS the body yaw at touchdown; GaitInput.replantYaw re-plants
   * a foot whose heading drifted from the body's (the idle re-facing shuffle).
   */
  plantYaw: number;
}

function newFoot(): FootState {
  return {
    planted: true, x: 0, z: 0, lift: 0, pitch: 0, swing: 1, liftX: 0, liftZ: 0, liftPitch: 0, landX: 0, landZ: 0,
    restX: 0, restZ: 0, overdue: false, toGoX: 0, toGoZ: 0, stanceTime: 1, plantYaw: 0,
  };
}

/** Per-frame inputs of the gait (world frame of the rig origin). */
export interface GaitInput {
  /** Rig origin on the ground plane, world m, and yaw (rig.group.rotation.y), rad. */
  x: number;
  z: number;
  yaw: number;
  /** Horizontal speed, m/s. */
  speed: number;
  /** Direction of travel relative to the facing, rad (0 = forward, +π/2 = local +x). */
  moveDirLocal: number;
  /** False while airborne: nothing is planted, feet hang at their rest spots. */
  grounded: boolean;
  /** Fore-aft distance between the feet at rest, m (+: "L" foot forward). 0 = square stance. */
  stagger: number;
  /** Yaw rate, rad/s: turning in place re-plants faster (rate × (1 + min(1, |ω| / π))). */
  turnRate: number;
  /** Ground pitch along the direction of travel, rad (shortens the stride). Default 0. */
  slopePitch?: number;
  /**
   * Forward shift (m, rig-local) of the hip pivots from their bind position — a trunk lean on a
   * chest-rooted tree moves the pelvis back. The rest spots follow it so mid-stance stays under
   * the hips, not under the chest. Default 0.
   */
  hipShift?: number;
  /**
   * Wave V lane P: a planted foot whose heading (FootState.plantYaw) differs from `yaw` by more
   * than this (rad) needs re-planting — standing, it steps in place to face the body's way.
   * Default Infinity (off: only position errors re-plant, today's behaviour).
   */
  replantYaw?: number;
}

const LEG_PHASE_OFFSET: readonly [number, number] = [0, 0.5];
const P2 = new Float64Array(2);

/** One fighter's locomotion cycle. */
export class Gait {
  readonly params: GaitParams;
  readonly feet: readonly [FootState, FootState] = [newFoot(), newFoot()];
  readonly shape: GaitShape = newGaitShape();
  /** Body phase in [0, 1). */
  phase = 0;
  /** Speed the shape follows (damped input), m/s. */
  speed = 0;
  /** 0 standing .. 1 moving (smoothstep of the damped speed): scales roll-off, sway, arm swing. */
  moving = 0;
  /** Cycles per second actually advanced last frame. */
  cycleRate = 0;
  /** Vertical pelvis offset of the cycle this frame, m. */
  bob = 0;
  /** Sway roll this frame, rad (rotation.z of the rig, pivoting at the ground). */
  roll = 0;
  /**
   * 0..1, set by the animator: how far past its reach a planted foot is (pelvis drop needed beyond
   * what it may give). Standing, an urgent foot re-plants up to 3× faster.
   */
  urgency = 0;
  readonly #geom: LegGeometry;
  readonly #leg: number;
  readonly #hipRestZ: number;
  #ready = false;
  #lastX = 0;
  #lastZ = 0;
  #hipShift = 0;
  #lateral = 0;
  #back = 0;
  /** Seconds the body has stood still (see GaitParams.settleTime). */
  #stillTime = 0;

  constructor(geom: LegGeometry, params: Partial<GaitParams> = {}) {
    this.params = { ...DEFAULT_GAIT, ...params };
    this.#geom = geom;
    this.#leg = legLength(geom);
    hipPivot(geom, 0, 0, P2);
    this.#hipRestZ = P2[1];
  }

  /** Leg length L this gait was built for, m. */
  get legLength(): number { return this.#leg; }

  /**
   * Plant both feet on their rest spots (spawn, teleport, round reset). The phase is put in the
   * middle of a double-support window, φ_L = 0.5 + (β_walk - 0.5) / 2, so both feet are
   * legitimately planted and the "L" foot is the one that steps first when motion starts.
   */
  reset(x: number, z: number, yaw: number, stagger = 0): void {
    for (let i = 0 as Side; i < 2; i = (i + 1) as Side) {
      const f = this.feet[i];
      this.#restSpot(i, x, z, yaw, stagger);
      f.planted = true; f.x = f.restX; f.z = f.restZ; f.lift = 0; f.pitch = 0; f.swing = 1; f.overdue = false;
      f.plantYaw = yaw;
    }
    this.phase = 0.5 + 0.5 * (this.params.dutyWalk - 0.5);
    this.speed = 0;
    this.#lastX = x;
    this.#lastZ = z;
    this.#ready = true;
  }

  /**
   * Wave FALL: latch foot i at world (x, z) with heading `yaw` (the get-up hands its planted feet to
   * the gait: the stand the rise ended in is kept, no re-plant snap). The phase goes to double support.
   */
  plantAt(i: Side, x: number, z: number, yaw: number): void {
    const f = this.feet[i];
    f.planted = true; f.x = x; f.z = z; f.lift = 0; f.pitch = 0; f.swing = 1; f.overdue = false;
    f.toGoX = 0; f.toGoZ = 0; f.plantYaw = yaw; f.stanceTime = 0;
    this.phase = 0.5 + 0.5 * (this.params.dutyWalk - 0.5);
    this.speed = 0;
  }

  #restSpot(i: Side, x: number, z: number, yaw: number, stagger: number): void {
    const f = this.feet[i];
    const lz = this.#hipRestZ + this.#hipShift + this.#geom.ballForward + (i === 0 ? 0.5 : -0.5) * stagger;
    localToWorld(x, z, yaw, this.#geom.hipLateral[i], lz, P2);
    f.restX = P2[0];
    f.restZ = P2[1];
  }

  /** Advance the cycle by dt seconds. */
  update(dt: number, inp: GaitInput): void {
    if (!this.#ready) this.reset(inp.x, inp.z, inp.yaw, inp.stagger);
    const p = this.params, L = this.#leg, h = Math.max(0, dt);
    this.#hipShift = inp.hipShift ?? 0;
    this.speed = damp(this.speed, Math.max(0, inp.speed), p.speedLambda, h);
    // Sideways share of the travel, filtered like the speed (a direction flip eases the stride).
    this.#lateral = damp(this.#lateral, Math.abs(Math.sin(inp.moveDirLocal)), p.speedLambda, h);
    this.#back = damp(this.#back, Math.max(0, -Math.cos(inp.moveDirLocal)), p.speedLambda, h);
    const sh = gaitShape(this.speed, L, p, this.shape, inp.slopePitch ?? 0, this.#lateral, this.#back);
    this.moving = smoothstep(p.stillSpeed, p.movingSpeed, this.speed);
    for (let i = 0 as Side; i < 2; i = (i + 1) as Side) this.#restSpot(i, inp.x, inp.z, inp.yaw, inp.stagger);

    // Direction of travel in the world, a unit vector (any vector when standing still).
    const md = inp.yaw + inp.moveDirLocal;
    const mdx = Math.sin(md), mdz = Math.cos(md);
    // Push-off rolls onto the ball only when the foot travels forward relative to the toes:
    // walking backward lifts the foot flat. roll = moving · max(0, cos(moveDirLocal)).
    const rollOff = this.moving * Math.max(0, Math.cos(inp.moveDirLocal));

    if (!inp.grounded) {
      // Airborne: nothing planted; feet hang at their rest spots. On landing they latch there.
      for (const f of this.feet) {
        f.planted = true; f.x = f.restX; f.z = f.restZ; f.lift = 0; f.pitch = 0; f.swing = 1; f.overdue = false;
        f.plantYaw = inp.yaw;
      }
      this.cycleRate = 0;
      this.bob = 0;
      this.roll = 0;
      return;
    }

    // Does a foot need re-planting? (turning in place, settling after a stop, shoves)
    let demand = false;
    const tol = this.#stillTime >= p.settleTime ? p.settleShare : 1;
    for (let i = 0 as Side; i < 2; i = (i + 1) as Side) {
      const f = this.feet[i];
      if (!f.planted) { demand = true; continue; }
      worldToLocal(f.restX, f.restZ, inp.yaw, f.x, f.z, P2);
      if (Math.abs(P2[0]) > tol * p.footErrorLateral * L || Math.abs(P2[1]) > tol * p.footErrorForward * L) demand = true;
      if (Math.abs(wrapAngle(inp.yaw - f.plantYaw)) > (inp.replantYaw ?? Infinity)) demand = true;
    }
    // Re-plant steps only matter as the body slows: while moving, the cycle itself re-plants,
    // and stride stays the derived λ (rate = cadence). Standing, a misplaced foot steps at
    // the in-place cadence 1 / stepCycleTime.
    // Phase advances by the distance ACTUALLY travelled / stride (not the filtered speed), so a
    // planted foot is released exactly as far behind as the body really moved.
    const travelled = Math.hypot(inp.x - this.#lastX, inp.z - this.#lastZ);
    this.#lastX = inp.x;
    this.#lastZ = inp.z;
    const actualSpeed = h > 0 ? travelled / h : 0;
    this.#stillTime = actualSpeed < p.stillSpeed && Math.abs(inp.turnRate) < p.settleTurnRate ? this.#stillTime + h : 0;
    const motionRate = actualSpeed / sh.stride;
    // Gate the re-plant rate on the ACTUAL speed: a body that stops dead still finishes its step.
    const actualMoving = smoothstep(p.stillSpeed, p.movingSpeed, actualSpeed);
    const turnBoost = 1 + Math.min(1, Math.abs(inp.turnRate) / Math.PI);
    const urgent = this.urgency * (1 - actualMoving);
    const stepRate = demand ? Math.max(1 - actualMoving, urgent) * turnBoost * (1 + 2 * urgent) / p.stepCycleTime : 0;
    const rate = Math.max(motionRate, stepRate);
    const dPhase = rate * h;
    this.cycleRate = rate;
    const duty = sh.duty;
    // Distance the body covers per unit of phase at the current rate (m): v / rate.
    const travelPerPhase = rate > 1e-6 ? actualSpeed / rate : 0;

    let resync = 0; // phase a late touchdown takes back (see the touchdown branch)
    // Comfortable reach ahead of the hip at touchdown, m: L·sin(θ(φ)) for this travel direction.
    const maxAhead = L * Math.sin(stanceAngleFor(p, this.#lateral, this.#back));
    for (let i = 0 as Side; i < 2; i = (i + 1) as Side) {
      const f = this.feet[i];
      const old = frac(this.phase + LEG_PHASE_OFFSET[i]);
      const next = old + dPhase; // may exceed 1 (wrap)
      let late = false; // swinging although φ is back in the stance window (touchdown overdue)
      if (f.planted) {
        f.stanceTime += h;
        if (next >= duty && next < 1 && f.stanceTime >= p.minStanceTime) {
          // Lift-off. On a genuine crossing the swing has already run (next - duty) of phase
          // this frame; a foot found planted inside its swing window (after a landing, or when
          // speeding up shrank β past it) starts its swing from 0.
          f.planted = false;
          f.overdue = false;
          f.liftX = f.x; f.liftZ = f.z; f.liftPitch = f.pitch;
          f.landX = Number.NaN;
          f.swing = old < duty ? clamp01((next - duty) / Math.max(1e-6, 1 - duty)) : 0;
        } else {
          const s = frac(next) / Math.max(1e-6, duty);
          f.pitch = sh.toeOffPitch * rollOff * smoothstep(1 - p.toeOffWindow, 1, s);
        }
      } else {
        // Swing progress: lands exactly as φ wraps (u += (1 - u)·dφ / (1 - φ)), but never faster
        // than 1 / minSwingTime. A swing still airborne after the wrap (φ back in the stance
        // window) finishes at that cap; its stance is simply shorter.
        const cap = h / p.minSwingTime;
        late = f.overdue || (old < duty && f.swing > 0);
        const remaining = Math.max(1e-6, 1 - old);
        const du = late ? cap : Math.min(cap, dPhase >= remaining ? 1 - f.swing : (1 - f.swing) * dPhase / remaining);
        f.swing = Math.min(1, f.swing + du);
        if (!late && dPhase >= remaining && f.swing < 1) f.overdue = late = true; // missed its landing window
      }
      if (!f.planted) {
        // Landing spot: the rest spot carried forward by the travel still to come before
        // touchdown, plus half the stance (capped at the comfortable reach) so mid-stance falls
        // under the hip. Time left = the phase still to run (0 once overdue), but never less
        // than the capped swing needs: max((1 - φ) / rate, (1 - u)·minSwingTime).
        const phaseLeft = f.swing >= 1 || late ? 0 : (1 - frac(next)) / Math.max(rate, 1e-6);
        const timeLeft = Math.max(phaseLeft, (1 - f.swing) * p.minSwingTime);
        const overshoot = f.swing >= 1 && !late ? Math.max(0, next - 1) * travelPerPhase : 0;
        const ahead = actualSpeed * timeLeft + Math.min(maxAhead, 0.5 * duty * travelPerPhase) - overshoot;
        const predX = f.restX + mdx * ahead, predZ = f.restZ + mdz * ahead;
        f.toGoX = mdx * actualSpeed * timeLeft;
        f.toGoZ = mdz * actualSpeed * timeLeft;
        if (Number.isNaN(f.landX)) { f.landX = predX; f.landZ = predZ; }
        // Damped toward the prediction, and never faster than a leg can sweep: L / minSwingTime.
        let mx = damp(f.landX, predX, p.landLambda, h) - f.landX;
        let mz = damp(f.landZ, predZ, p.landLambda, h) - f.landZ;
        const moved = Math.hypot(mx, mz), maxMove = (L / p.minSwingTime) * h;
        if (moved > maxMove) { mx *= maxMove / moved; mz *= maxMove / moved; }
        f.landX += mx;
        f.landZ += mz;
        // Never aim farther from the rest spot than the leg can reach from where the body will be
        // at touchdown: |land - rest| <= 1.25·L·sin(θmax) + v·timeLeft (a stopping body pulls it back).
        const ox = f.landX - f.restX, oz = f.landZ - f.restZ, off = Math.hypot(ox, oz);
        const reachable = 1.25 * maxAhead + actualSpeed * timeLeft;
        if (off > reachable) { f.landX = f.restX + ox * reachable / off; f.landZ = f.restZ + oz * reachable / off; }
        // Horizontal: cubic Hermite with zero WORLD velocity at both ends (= smoothstep), so the
        // foot leaves and lands at rest yet catches up with a fast body sooner than a quintic.
        // Vertical: sin²(π·u^k), C1 at both ends; k = lerp(1, 0.7, run) moves the apex from
        // mid-swing (walk) to ~37% (run: heel recovery right after toe-off).
        const u = f.swing, e = u * u * (3 - 2 * u);
        // Wave V lane P: an IN-PLACE step (standing: re-plant, re-facing) lands ON its predicted
        // spot over the last 40 % of the swing instead of the damped one. Standing, the prediction
        // is the rest spot itself; the damping's lag (sampled per frame) left the foot a frame-rate
        // dependent distance short — near the re-plant threshold, so whether ANOTHER step followed
        // depended on the frame rate. Moving (actualMoving -> 1) the damped spot is used as before.
        const pin = (1 - actualMoving) * smoothstep(0.6, 1, u);
        f.x = lerp(f.liftX, lerp(f.landX, predX, pin), e);
        f.z = lerp(f.liftZ, lerp(f.landZ, predZ, pin), e);
        const bump = Math.sin(Math.PI * Math.pow(u, lerp(1, 0.7, sh.runBlend))) ** 2;
        f.lift = sh.swingApex * bump;
        f.pitch = f.liftPitch * (1 - smootherstep(0, 0.5, u)) - p.swingDorsiflex * rollOff * bump;
        if (u >= 1) {
          f.planted = true; f.lift = 0; f.pitch = 0; f.overdue = false; f.toGoX = 0; f.toGoZ = 0; f.stanceTime = 0;
          f.plantYaw = inp.yaw;
          // Touchdown should happen at φ = 0 (the wrap). A late (overdue) landing at φ = x < 0.5
          // re-synchronises the body phase by -x: otherwise the foot gets only the minimum
          // stance, lifts with too little phase left, is late again, and the gait locks into a
          // permanently late cycle (measured: every strafe step overdue on the dwarf rig).
          // Only a LATE landing counts (overdue, or φ already back in the stance window when the
          // frame began): an on-time landing in the wrap frame overshoots by < dφ by construction.
          const phi = frac(next);
          if (late && phi < 0.5) resync = Math.max(resync, phi);
        }
      }
    }
    this.phase = frac(this.phase + dPhase - resync);

    // Pelvis bob (2 per cycle) and sway (1 per cycle), locked to the "L" leg's mid-stance.
    const phiL = frac(this.phase + LEG_PHASE_OFFSET[0]);
    const mid = phiL - 0.5 * duty;
    this.bob = sh.bobAmplitude * this.moving * Math.cos(4 * Math.PI * mid);
    // Roll toward the stance foot: a roll ρ moves points above the ground pivot by -y·sinρ
    // laterally, so leaning over the "L" hip (lateral sign sL) needs ρ = -sL·|ρ|.
    const sL = Math.sign(this.#geom.hipLateral[0]) || -1;
    this.roll = -sL * sh.swayRoll * this.moving * Math.cos(2 * Math.PI * mid);
  }
}

/** Fractional part in [0, 1). */
export function frac(v: number): number {
  return v - Math.floor(v);
}
