// One fighter's procedural animator (lane C, R04): gait + foot IK + layered blending.
//
// Pure module: no Three.js, no DOM, no allocation per frame (the output object and every
// array are owned by the animator and overwritten on each update). Call update() once per
// frame; feed `angles` to the Skeleton as the joint angles and the root offsets to the rig
// group (docs/overhaul/lane-C.md has the exact integration patch).
//
// Frame pipeline
//   1. Gait      advance the phase by distance / stride; latch / swing the feet (world x/z).
//   2. Weights   every layer's weight springs toward its target (crossfades, no snaps).
//   3. Trunk     blend spine + abdomen first: they move the hips, so the IK must see them.
//   4. Pelvis    ride height + bob; lower it by the largest pelvis drop a planted foot needs.
//   5. Legs      two-bone IK per leg (FootIK.solveLeg): soles parallel to the ground.
//   6. Upper     arms counter-swing with the opposite thigh; neck/head cancel the CHEST pitch.
//   7. Blend     every other joint through the layers, clamp to limits, pop-guard spring.
//   8. Root      gait-owned legs: IK ride height; skill/KO/air-owned legs: lowest sole on the floor.
//   9. Guard     lift the root if any heel / ball / toe tip of the final pose is below the ground.

import { clamp, damp, lerp, smoothstep } from "../../core/MathCore.ts";
import { trackOffset } from "../AnimationCurve.ts";
import type { SkillAnimation } from "../Skills.ts";
import {
  ankleFromBall, type GroundHeightFn, type GroundSample, type LegJointLimits, newLegSolution, pelvisDropFor, sampleGround,
  smoothMax, smoothMin, solveLegInPelvis, type TwoBoneChain,
} from "./FootIK.ts";
import { Gait, type GaitParams } from "./Gait.ts";
import { makeMask, MASK_FULL, MASK_LOWER, MASK_UPPER, PoseBlender } from "./PoseBlend.ts";
import { AIR_POSE, ATTACK_POSE, BREATH_UNIT, GUARD_POSE, HIT_OFFSETS, KO_POSE, poseArray } from "./Poses.ts";
import {
  ARM_JOINTS, hipPivot, hipRestRollOf, JOINT_COUNT, JOINT_INDEX, type JointLimitTable, LEG_JOINTS, legFK3, type LegGeometry,
  legLength, localToWorld, newLegFK3, type Side, standingSoleDepth, worldToLocal,
} from "./Rig.ts";

/** Named base parameters of the animator (ratios are of the leg length L unless stated). */
export interface AnimatorParams {
  gait: Partial<GaitParams>;
  /** Hip-to-ankle distance / L when standing, at full guard crouch, and the cap while running. */
  rideStand: number;
  rideGuard: number;
  rideRun: number;
  /** Planted-leg reach margin and soft-saturation width, / L (exact IK below 1 - margin - softness). */
  reachMargin: number;
  softness: number;
  /**
   * Swing-leg reach margin and softness, / L. A swinging leg keeps its knee bent (margin 0.06 ->
   * knee flex >= 2·acos(0.94) ≈ 0.7 rad for equal bones) and saturates over a wide band, so a foot
   * left behind never snaps the knee straight-then-bent; blended into the planted values by the
   * plant weight, so touchdown is continuous.
   */
  swingReachMargin: number;
  swingSoftness: number;
  /** Hip abduction (away from the body's midline) and adduction (across it) limits, rad. */
  abductionMax: number;
  adductionMax: number;
  /** Width of the swing-foot reach soft clamp, / L (see the swingRadius comment in update). */
  swingRadiusSoftness: number;
  /** Most the pelvis may drop to keep a foot reachable, / L (beyond it the foot lets go instead). */
  maxPelvisDrop: number;
  /**
   * Largest pelvis pitch (spine + abdomen, rad) the legs accept while the gait owns them. The hips
   * hang off spine -> abdomen, so a pelvis pitch R adds R to every hip flexion the legs need; with
   * the Skeleton's hip window [-1.2, 1.2] a running swing (thigh ~0.9-1.0 rad forward at touchdown)
   * leaves ~0.2 rad. Past this the abdomen counter-rotates (the chest keeps its lean).
   */
  pelvisTiltMax: number;
  /**
   * Share of a trunk lean the PELVIS takes (anterior tilt); the chest (spine) takes all of it:
   *   spine = lean,  abdomen = -(1 - pelvisLeanShare)·lean   =>  pelvis pitch = pelvisLeanShare·lean.
   * The spine pivot is the chest and the neck hangs off it, so `spine` IS the chest's world pitch.
   */
  pelvisLeanShare: number;
  /** Largest forward chest lean (rad) from locomotion + acceleration together (15°: a running lean). */
  leanMax: number;
  /** Largest backward chest lean (rad) from braking / accelerating backward. */
  leanBackMax: number;
  /**
   * Base rate (m/s) the reach drop may change at when standing. Moving, a stance leg vaults the
   * hip like an inverted pendulum, whose height changes at up to v·tan(θmax), so the limit is
   *   maxDropRate + 1.2 · v · tan(θmax)
   * — wide enough for any real gait, tight enough to turn impossible inputs into a glide.
   */
  maxDropRate: number;
  /** Fore-aft foot stagger in guard, / L ("L" foot forward). */
  guardStagger: number;
  /** Guard layer weight while merely engaged (1 while blocking). */
  guardIdleWeight: number;
  /** Trunk forward lean when walking / running, rad. */
  leanWalk: number;
  leanRun: number;
  /** Acceleration lean: lean = gain · atan(a / g); `accelLambda` (1/s) smooths a. */
  accelLeanGain: number;
  accelLambda: number;
  /** Shoulder swing per radian of opposite-thigh swing, walking / running. */
  armGainWalk: number;
  armGainRun: number;
  /** Extra elbow flexion, rad, walking / running. */
  elbowBendWalk: number;
  elbowBendRun: number;
  /** Share of the trunk pitch the neck + head cancel (gaze stabilisation). */
  headStabilise: number;
  /** Breathing rate (Hz) and amplitude (rad) of the idle layer. */
  breathRate: number;
  breathAmplitude: number;
  /** Pop-guard smooth time (s) for joints the IK does not own. */
  popSmoothTime: number;
  /** Least share (0..1) of a SWINGING leg's IK angles that bypasses the pop guard. */
  swingPassThrough: number;
  /** Weight-spring smooth times (s) per layer. */
  smoothAir: number;
  smoothGuard: number;
  smoothAttack: number;
  smoothSkill: number;
  smoothKo: number;
  smoothHit: number;
  smoothBreath: number;
  /** Rate (1/s) at which the skill layer's per-joint mask follows the skill's animated joints. */
  skillMaskLambda: number;
  /**
   * Angular speed limit of every joint, rad/s. Default (NaN) = DERIVED: the fastest legitimate
   * motion, a joint sweeping its whole range R within the fastest swing T on a half-sine
   * velocity profile, (π/2)·max(R)/T with T = gait.minSwingTime. Skill curves peak below it
   * (tests/anim_animator_test.ts checks every skill). Infinity disables it.
   */
  maxJointSpeed: number;
  /** Largest dt (s) one update integrates; longer frames are clamped (hitches, tab switches). */
  maxStep: number;
  /** A root jump longer than this (m) in one frame re-plants the feet (respawn, teleport). */
  teleportDistance: number;
}

/** Defaults (see AnimatorParams for units). */
export const DEFAULT_ANIMATOR: AnimatorParams = {
  gait: {},
  rideStand: 0.955,
  rideGuard: 0.92,
  rideRun: 0.95,
  reachMargin: 0.01,
  softness: 0.03,
  swingReachMargin: 0.06,
  swingSoftness: 0.12,
  abductionMax: 0.6,
  adductionMax: 0.3,
  swingRadiusSoftness: 0.05,
  maxPelvisDrop: 0.2,
  pelvisTiltMax: 0.2,
  pelvisLeanShare: 0.3,
  leanMax: 0.26,
  leanBackMax: 0.1,
  maxDropRate: 1.0,
  guardStagger: 0.3,
  guardIdleWeight: 0.55,
  leanWalk: 0.04,
  leanRun: 0.14,
  accelLeanGain: 0.5,
  accelLambda: 6,
  armGainWalk: 0.55,
  armGainRun: 0.9,
  elbowBendWalk: 0.25,
  elbowBendRun: 1.3,
  headStabilise: 0.9,
  breathRate: 0.25,
  breathAmplitude: 0.025,
  popSmoothTime: 0.05,
  swingPassThrough: 0.7,
  smoothAir: 0.08,
  smoothGuard: 0.15,
  smoothAttack: 0.08,
  smoothSkill: 0.04,
  smoothKo: 0.25,
  smoothHit: 0.06,
  smoothBreath: 0.4,
  skillMaskLambda: 25,
  maxJointSpeed: Number.NaN,
  maxStep: 1 / 15,
  teleportDistance: 1.5,
};

/** What the engine tells the animator each frame. World metres / radians / seconds. */
export interface AnimatorInput {
  /** Rig origin on the ground plane (f.body.x / f.body.z) and its yaw (rig.group.rotation.y). */
  x: number;
  z: number;
  yaw: number;
  /** World y the parent places the rig origin at BEFORE rootOffsetY (f.body.y). Default: ground + sole depth. */
  rootY?: number;
  /** Horizontal speed, m/s. */
  speed: number;
  /** Direction of travel relative to the facing, rad (0 forward, π backward, +π/2 local +x). */
  moveDirLocal: number;
  /** Yaw rate, rad/s (speeds up in-place re-plant steps). */
  turnRate: number;
  grounded: boolean;
  hit: boolean;
  attack: boolean;
  block: boolean;
  ko: boolean;
  /** Combat-ready guard stance (fight phase, opponent near). */
  engaged?: boolean;
  /** The running skill animation (Skeleton.skillAnimation()) and its progress 0..1. */
  skill: SkillAnimation | null;
  skillProgress: number;
  /** Ground height under any world (x, z). */
  groundHeight: GroundHeightFn;
  /** Roll (rad) the parent adds on its own (balance sway), so the IK keeps the soles down. */
  externalRoll?: number;
}

/** One foot as the animator placed it this frame (world metres). */
export interface FootOut {
  x: number;
  y: number;
  z: number;
  planted: boolean;
}

/** The animator's result. Owned by the animator: overwritten by the next update. */
export interface AnimatorOutput {
  /** Final joint angles in JOINT_ORDER, inside the joint limits, Skeleton convention. */
  angles: Float64Array;
  /** Add to the rig origin's y (m): pelvis ride, bob, and the drop that keeps soles on the ground. */
  rootOffsetY: number;
  /** Add to rig.group.rotation.z (rad): the gait's weight-shift sway. */
  rootRoll: number;
  /** Shift the rig origin along its local x (m) so the total roll pivots at the ground. */
  rootOffsetLateral: number;
  /**
   * Hip abduction per leg ["L", "R"], rad: rotation.z of the hip pivot with Euler order "ZYX"
   * (+ toward local +x). Lets a single-axis leg reach a foot beside the hip (strafe, turn).
   */
  hipRoll: Float64Array;
  /** Ankle counter-roll per leg, rad: rotation.z of the ankle pivot (Euler "XYZ"), keeps the sole level. */
  ankleRoll: Float64Array;
  footPlant: { left: boolean; right: boolean };
  /** Ball of each foot ["L", "R"], world. */
  feet: [FootOut, FootOut];
  /** Pelvis drop applied for reach this frame, m. */
  pelvisDrop: number;
  /** Gait phase in [0, 1). */
  phase: number;
}

const SPINE = JOINT_INDEX.spine, ABD = JOINT_INDEX.abdomen, NECK = JOINT_INDEX.neck, HEAD = JOINT_INDEX.head;
const TRUNK = makeMask(["spine", "abdomen"]);
const HIP2 = new Float64Array(2);
/** Keep the solved ankle this far (rad) inside its limits so the final clamp never bites. */
const ANKLE_MARGIN = 0.02;
/** Same margin for the hip and knee windows handed to the IK. */
const LEG_MARGIN = 0.02;
/** Leg-authority band (1 - a) over which the handover sole guard fades out (see step 8). */
const HANDOVER_BAND = 0.1;
const P2 = new Float64Array(2);
const ANK = new Float64Array(2);
const D3 = new Float64Array(3);
const FK3 = newLegFK3();
const GS_LAND: GroundSample = { height: 0, slopePitch: 0 };
const GS_BODY: GroundSample = { height: 0, slopePitch: 0 };

/** Layer indices inside the animator's blender. */
export const LAYER = { loco: 0, air: 1, guard: 2, attack: 3, skill: 4, ko: 5, hit: 6, balance: 7, breath: 8 } as const;

/** The per-fighter animator. */
export class Animator {
  readonly geometry: LegGeometry;
  readonly limits: JointLimitTable;
  readonly params: AnimatorParams;
  readonly gait: Gait;
  readonly blender: PoseBlender;
  readonly output: AnimatorOutput;
  readonly #L: number;
  readonly #soleDepth: number;
  readonly #chain: TwoBoneChain;
  readonly #legChain: [TwoBoneChain, TwoBoneChain];
  readonly #legLimits: LegJointLimits[];
  /** Forward shift (m) of the hip pivots from their bind position, last frame (trunk lean). */
  #hipShift = 0;
  readonly #hipRestZ: number;
  readonly #plantWeight = new Float64Array(2);
  readonly #legs = [newLegSolution(), newLegSolution()];
  readonly #ground: [GroundSample, GroundSample] = [{ height: 0, slopePitch: 0 }, { height: 0, slopePitch: 0 }];
  readonly #thigh = new Float64Array(2);
  readonly #ballY = new Float64Array(2);
  readonly #ballX = new Float64Array(2);
  readonly #legRoll = new Float64Array(2);
  readonly #ballZ = new Float64Array(2);
  readonly #pitch = new Float64Array(2);
  readonly #skillAnimated = new Float64Array(JOINT_COUNT);
  readonly #breathUnit: Float64Array;
  #time = 0;
  #accel = 0;
  #stance = 0;
  #lastX = 0;
  #lastZ = 0;
  #hasLast = false;
  #drop = 0;
  #primed = false;
  #sinR = 0;
  #cosR = 1;
  #lateral = 0;

  constructor(geometry: LegGeometry, limits: JointLimitTable, params: Partial<AnimatorParams> = {}) {
    this.geometry = geometry;
    this.limits = limits;
    this.params = { ...DEFAULT_ANIMATOR, ...params };
    const p = this.params;
    this.#L = legLength(geometry);
    this.#soleDepth = standingSoleDepth(geometry);
    this.#chain = { upper: geometry.thigh, lower: geometry.shin, reachMargin: p.reachMargin * this.#L, softness: p.softness * this.#L };
    this.#legChain = [{ ...this.#chain }, { ...this.#chain }];
    // Hip / knee windows the IK must respect (Skeleton hip = ψ_thigh because RIG_ROTATION_SIGN.hip
    // = -1, knee = ψ_shin - ψ_thigh), kept LEG_MARGIN inside so the final clamp never bends them.
    this.#legLimits = LEG_JOINTS.map((lj) => ({
      hipMin: limits.min[lj.hip] + LEG_MARGIN, hipMax: limits.max[lj.hip] - LEG_MARGIN,
      kneeMin: limits.min[lj.knee] + LEG_MARGIN, kneeMax: limits.max[lj.knee],
    }));
    this.gait = new Gait(geometry, p.gait);
    hipPivot(geometry, 0, 0, HIP2);
    this.#hipRestZ = HIP2[1];
    const B = this.blender = new PoseBlender(limits, p.popSmoothTime);
    B.addLayer({ name: "locomotion", mode: "override", mask: MASK_FULL, smoothTime: 0 });
    B.addLayer({ name: "air", mode: "override", mask: MASK_LOWER, smoothTime: p.smoothAir });
    B.addLayer({ name: "guard", mode: "override", mask: MASK_UPPER, smoothTime: p.smoothGuard });
    B.addLayer({ name: "attack", mode: "override", mask: MASK_UPPER, smoothTime: p.smoothAttack });
    B.addLayer({ name: "skill", mode: "override", mask: new Float64Array(JOINT_COUNT), smoothTime: p.smoothSkill });
    B.addLayer({ name: "ko", mode: "override", mask: MASK_FULL, smoothTime: p.smoothKo });
    B.addLayer({ name: "hit", mode: "additive", mask: MASK_UPPER, smoothTime: p.smoothHit });
    B.addLayer({ name: "balance", mode: "additive", mask: TRUNK, smoothTime: 0.1 });
    B.addLayer({ name: "breath", mode: "additive", mask: MASK_UPPER, smoothTime: p.smoothBreath });
    B.values(LAYER.air).set(poseArray(AIR_POSE, limits, "override"));
    B.values(LAYER.guard).set(poseArray(GUARD_POSE, limits, "override"));
    B.values(LAYER.attack).set(poseArray(ATTACK_POSE, limits, "override"));
    B.values(LAYER.ko).set(poseArray(KO_POSE, limits, "override"));
    B.values(LAYER.hit).set(poseArray(HIT_OFFSETS, limits, "additive"));
    B.values(LAYER.skill).set(limits.rest);
    B.setWeightImmediate(LAYER.balance, 1);
    B.setWeightImmediate(LAYER.breath, 1);
    for (let j = 0; j < JOINT_COUNT; j++) B.passThrough[j] = MASK_LOWER[j];
    let range = 0;
    for (let j = 0; j < JOINT_COUNT; j++) range = Math.max(range, limits.max[j] - limits.min[j]);
    B.maxJointSpeed = Number.isNaN(p.maxJointSpeed) ? (Math.PI / 2) * range / this.gait.params.minSwingTime : p.maxJointSpeed;
    this.#breathUnit = poseArray(BREATH_UNIT, limits, "additive");
    this.output = {
      angles: Float64Array.from(limits.rest),
      rootOffsetY: 0, rootRoll: 0, rootOffsetLateral: 0,
      hipRoll: new Float64Array(2), ankleRoll: new Float64Array(2),
      footPlant: { left: true, right: true },
      feet: [{ x: 0, y: 0, z: 0, planted: true }, { x: 0, y: 0, z: 0, planted: true }],
      pelvisDrop: 0, phase: 0,
    };
  }

  /** Leg length L (m). */
  get legLength(): number { return this.#L; }

  /** Re-plant both feet under the hips and drop the filter history (spawn, round reset, teleport). */
  reset(x: number, z: number, yaw: number): void {
    this.gait.reset(x, z, yaw, this.params.guardStagger * this.#L * this.#stance);
    this.blender.resetFilter();
    this.#lastX = x; this.#lastZ = z; this.#hasLast = true;
    this.#primed = false;
  }

  /** Advance by dt seconds and return the pose (the same object every frame). */
  update(dt: number, inp: AnimatorInput): AnimatorOutput {
    const p = this.params, g = this.geometry, L = this.#L, B = this.blender, lim = this.limits, out = this.output;
    const h = clamp(dt, 0, p.maxStep);
    if (this.#hasLast && Math.hypot(inp.x - this.#lastX, inp.z - this.#lastZ) > p.teleportDistance) this.reset(inp.x, inp.z, inp.yaw);
    this.#lastX = inp.x; this.#lastZ = inp.z; this.#hasLast = true;
    this.#time += h;

    // 1. Gait.
    this.#stance = damp(this.#stance, inp.engaged || inp.block ? 1 : 0, 4, h);
    const prevSpeed = this.gait.speed;
    const md = inp.yaw + inp.moveDirLocal;
    sampleGround(inp.groundHeight, inp.x, inp.z, Math.sin(md), Math.cos(md), 0.5 * L, GS_BODY);
    this.gait.update(h, {
      x: inp.x, z: inp.z, yaw: inp.yaw, speed: inp.speed, moveDirLocal: inp.moveDirLocal,
      // The guard stagger fades out as the gait gets moving: a staggered stance is for standing
      // and shuffling; running with one foot's stance centred 0.15 L ahead demands extra reach.
      grounded: inp.grounded, stagger: p.guardStagger * L * this.#stance * (1 - this.gait.moving), turnRate: inp.turnRate,
      slopePitch: GS_BODY.slopePitch, hipShift: this.#hipShift,
    });
    const sh = this.gait.shape, m = this.gait.moving, run = sh.runBlend;
    const ahead = Math.cos(inp.moveDirLocal);
    this.#accel = damp(this.#accel, h > 0 ? (this.gait.speed - prevSpeed) / h : 0, p.accelLambda, h);

    // 2. Layer weights.
    const skill = inp.skill;
    B.setTarget(LAYER.air, inp.grounded ? 0 : 1);
    B.setTarget(LAYER.guard, inp.block ? 1 : inp.engaged ? p.guardIdleWeight : 0);
    B.setTarget(LAYER.attack, inp.attack && !skill ? 1 : 0);
    B.setTarget(LAYER.skill, skill ? 1 : 0);
    B.setTarget(LAYER.ko, inp.ko ? 1 : 0);
    B.setTarget(LAYER.hit, inp.hit && !inp.ko ? 1 : 0);
    B.setTarget(LAYER.breath, inp.ko ? 0 : 1 - m);
    B.stepWeights(h);
    if (skill) this.#fillSkill(skill, inp.skillProgress, h);
    {
      // Skill curves are smooth by construction: the pop guard must not delay the strike pose.
      const ws = B.weight(LAYER.skill), sm = B.mask(LAYER.skill);
      for (let j = 0; j < JOINT_COUNT; j++) B.trusted[j] = ws * sm[j];
    }

    // 3. Trunk (locomotion lean + acceleration lean + breathing), evaluated first. The CHEST
    //    (spine) leans into the travel; the pelvis keeps pelvisLeanShare of it (abdomen counters
    //    the rest) so the hips keep their flexion range. Walking backward stays upright; only the
    //    acceleration may lean the chest back, by at most leanBackMax.
    const loco = B.values(LAYER.loco), rest = lim.rest, angles = out.angles;
    const lean = lerp(p.leanWalk, p.leanRun, run) * m * Math.max(0, ahead);
    const counter = -(1 - p.pelvisLeanShare);
    loco[SPINE] = rest[SPINE] + lean;
    loco[ABD] = rest[ABD] + counter * lean;
    const accLean = clamp(
      p.accelLeanGain * Math.atan(this.#accel * ahead / this.gait.params.gravity),
      -p.leanBackMax, Math.max(0, p.leanMax - lean),
    );
    const bal = B.values(LAYER.balance);
    bal[SPINE] = accLean;
    bal[ABD] = counter * accLean;
    const breath = p.breathAmplitude * Math.sin(2 * Math.PI * p.breathRate * this.#time);
    const br = B.values(LAYER.breath);
    for (let j = 0; j < JOINT_COUNT; j++) br[j] = this.#breathUnit[j] * breath;
    B.evaluateJoint(SPINE, h, angles);
    B.evaluateJoint(ABD, h, angles);
    {
      // Pelvis keeper: soft-clamp the pelvis pitch to ±pelvisTiltMax (C1 smooth min/max over a
      // 0.1 rad band) by moving the abdomen only, in proportion to the gait's hold on the legs.
      const own = B.baseAuthority(LEG_JOINTS[0].hip);
      const tilt = angles[SPINE] + angles[ABD], k = 0.1;
      const kept = smoothMax(smoothMin(tilt, p.pelvisTiltMax, k), -p.pelvisTiltMax, k);
      const abd = angles[ABD] + own * (kept - tilt);
      angles[ABD] = clamp(abd, lim.min[ABD], lim.max[ABD]);
    }

    // 4. Pelvis height: ride + bob, lowered so every (nearly) planted foot is reachable.
    const pelvisR = hipPivot(g, angles[SPINE], angles[ABD], HIP2);
    // The feet step under the hips where the trunk lean actually put them (next frame's rest spots).
    this.#hipShift = HIP2[1] - this.#hipRestZ;
    const groundBody = inp.groundHeight(inp.x, inp.z);
    const baseRootY = inp.rootY ?? groundBody + this.#soleDepth;
    const exactRatio = 1 - p.reachMargin - p.softness;
    const rideMoving = Math.min(p.rideRun, exactRatio - Math.abs(sh.bobAmplitude) / L - 0.004);
    const ride = lerp(lerp(p.rideStand, rideMoving, m), p.rideGuard, B.weight(LAYER.guard));
    let rootY = groundBody + g.soleOffset + L * ride + this.gait.bob - HIP2[0];
    const auth = B.baseAuthority(LEG_JOINTS[0].hip);
    const roll = this.gait.roll * auth;
    const totalRoll = roll + (inp.externalRoll ?? 0);
    const fx = Math.sin(inp.yaw), fz = Math.cos(inp.yaw);
    const exactLimit = g.thigh + g.shin - this.#chain.reachMargin - this.#chain.softness;
    this.#setRoll(totalRoll, auth * (rootY - groundBody));
    // Reach radius of a swinging foot about its rest spot: 1.25·L·sin(θmax) (the gait's landing cap).
    const swingRadius = 1.25 * L * Math.sin(this.gait.params.maxStanceAngle) + p.swingRadiusSoftness * L;
    let drop = 0;
    for (let i = 0; i < 2; i++) {
      const f = this.gait.feet[i], gs = this.#ground[i];
      sampleGround(inp.groundHeight, f.x, f.z, fx, fz, 0.5 * (g.ballForward + g.heelBack), gs);
      worldToLocal(inp.x, inp.z, inp.yaw, f.x, f.z, P2);
      if (!f.planted) {
        // A swinging foot may not wander out of reach of its rest spot: its horizontal offset r
        // is soft-clamped, r' = smoothMin(r, swingRadius, k). Exact for r <= swingRadius - k,
        // which contains every lift-off and landing spot, so the clamp only bends the mid-air
        // overshoot of a fast swing (the foot that would otherwise lock the knee straight).
        const rx0 = P2[0], rz0 = P2[1];
        worldToLocal(inp.x, inp.z, inp.yaw, f.restX, f.restZ, P2);
        const ox = rx0 - P2[0], oz = rz0 - P2[1], rr = Math.hypot(ox, oz);
        const capped = smoothMin(rr, swingRadius, p.swingRadiusSoftness * L);
        const k = rr > 1e-9 ? capped / rr : 1;
        P2[0] += ox * k;
        P2[1] += oz * k;
      }
      this.#ballX[i] = P2[0];
      this.#ballZ[i] = P2[1];
      this.#ballY[i] = gs.height + f.lift;
      this.#pitch[i] = f.pitch - gs.slopePitch;
      // Weight of this foot in the reach test: 1 planted; a swing fades its lift-off spot out over
      // its first quarter and fades its LANDING spot in over its last 40% (anticipation), so the
      // pelvis never jumps at lift-off or touchdown. The same weight drives the IK chain softness
      // and how much the pop guard may filter this leg.
      const early = f.planted ? 1 : 1 - smoothstep(0, 0.25, f.swing);
      const late = f.planted ? 0 : smoothstep(0.6, 1, f.swing);
      this.#plantWeight[i] = Math.max(early, late);
      this.#ankleTarget(i, this.#ballX[i], this.#ballY[i], this.#ballZ[i], this.#pitch[i], g.ballForward, rootY);
      drop = Math.max(drop, early * pelvisDropFor(0, 0, D3[1], Math.hypot(D3[0], D3[2]), exactLimit));
      if (late > 0) {
        sampleGround(inp.groundHeight, f.landX, f.landZ, fx, fz, 0.5 * (g.ballForward + g.heelBack), GS_LAND);
        // Where the landing spot will sit relative to the body AT TOUCHDOWN: the body still
        // travels toGo before the foot lands, so anticipate (land - toGo), not the spot as seen
        // from here (at 6.5 m/s that is ~0.65 m farther and would demand the full drop cap).
        worldToLocal(inp.x, inp.z, inp.yaw, f.landX - f.toGoX, f.landZ - f.toGoZ, P2);
        this.#ankleTarget(i, P2[0], GS_LAND.height, P2[1], -GS_LAND.slopePitch, g.ballForward, rootY);
        drop = Math.max(drop, late * pelvisDropFor(0, 0, D3[1], Math.hypot(D3[0], D3[2]), exactLimit));
      }
      // Pass-through share of this leg: the plant weight, but at least swingPassThrough in the air
      // — a lagging swing leg hangs from a pelvis that has already moved (and dropped) on, so the
      // foot dips (measured -1.6 cm at a 0 -> 6.5 m/s start with full pop-guard lag).
      const pass = Math.max(this.#plantWeight[i], p.swingPassThrough);
      const lj = LEG_JOINTS[i];
      // The toe passes through with the rest of the leg: it carries the push-off roll
      // (toe = -slope - Θ keeps the toes flat while the heel lifts), and any pop-guard lag there
      // pushes the toe tip into the floor (measured: -2.3 cm at a 0.46 rad roll on lane A's rig).
      B.passThrough[lj.hip] = B.passThrough[lj.knee] = B.passThrough[lj.ankle] = B.passThrough[lj.toe] = pass;
    }
    const cap = p.maxPelvisDrop * L;
    this.gait.urgency = clamp((drop - 0.6 * cap) / (0.4 * cap), 0, 1);
    drop = Math.min(drop, cap);
    const dropRate = p.maxDropRate + 1.2 * this.gait.speed * Math.tan(this.gait.params.maxStanceAngle);
    if (this.#primed) drop = clamp(drop, this.#drop - dropRate * h, this.#drop + dropRate * h);
    this.#drop = drop;
    this.#primed = true;
    rootY -= drop;
    this.#setRoll(totalRoll, auth * (rootY - groundBody));

    // 5. Legs: 3D IK (hip abduction + planar two-bone, FootIK.solveLegInPelvis) in the rig's
    //    local frame. When the ankle would leave its range, the foot ROLLS instead of breaking:
    //    past dorsiflexion the heel lifts about the ball (push-off), past plantarflexion the toes
    //    lift about the heel (downhill heel strike). Each pass moves the pitch by the overshoot.
    for (let i = 0; i < 2; i++) {
      const lj = LEG_JOINTS[i], leg = this.#legs[i], chain = this.#legChain[i], w = this.#plantWeight[i];
      chain.reachMargin = lerp(p.swingReachMargin, p.reachMargin, w) * L;
      chain.softness = lerp(p.swingSoftness, p.softness, w) * L;
      const slope = this.#ground[i].slopePitch;
      const out_ = Math.sign(g.hipLateral[i]) || (i === 0 ? -1 : 1); // abduction direction (+x for R)
      const rollMin = out_ > 0 ? -p.adductionMax : -p.abductionMax;
      const rollMax = out_ > 0 ? p.abductionMax : p.adductionMax;
      const cX = this.#ballX[i];
      let cY = this.#ballY[i], cZ = this.#ballZ[i], pitch = this.#pitch[i], onBall = true;
      this.#ankleTarget(i, cX, cY, cZ, pitch, g.ballForward, rootY);
      const legLim = this.#legLimits[i], restRoll = hipRestRollOf(g, i as Side);
      solveLegInPelvis(D3[0], D3[1], D3[2], pelvisR, pitch, slope, chain, rollMin, rollMax, leg, undefined, legLim, restRoll);
      const lo = lim.min[lj.ankle] + ANKLE_MARGIN, hi = lim.max[lj.ankle] - ANKLE_MARGIN;
      // Switching pivots goes through the sole at the CURRENT pitch, so the ankle path is continuous.
      const span = g.ballForward + g.heelBack;
      for (let pass = 0; pass < 3 && (leg.ankle < lo || leg.ankle > hi); pass++) {
        if (leg.ankle < lo) {
          if (!onBall) { cY -= span * Math.sin(pitch); cZ += span * Math.cos(pitch); onBall = true; }
          pitch += lo - leg.ankle;
        } else {
          if (onBall) { cY += span * Math.sin(pitch); cZ -= span * Math.cos(pitch); onBall = false; }
          pitch -= leg.ankle - hi;
        }
        this.#ankleTarget(i, cX, cY, cZ, pitch, onBall ? g.ballForward : -g.heelBack, rootY);
        solveLegInPelvis(D3[0], D3[1], D3[2], pelvisR, pitch, slope, chain, rollMin, rollMax, leg, undefined, legLim, restRoll);
      }
      loco[lj.hip] = leg.hip;
      loco[lj.knee] = leg.knee;
      loco[lj.ankle] = leg.ankle;
      loco[lj.toe] = leg.toe;
      this.#legRoll[i] = leg.roll;
      this.#thigh[i] = leg.hip - pelvisR; // forward pitch of the thigh in the world
    }

    // 6. Arms counter-swing with the OPPOSITE thigh; neck + head cancel the trunk pitch.
    const meanThigh = 0.5 * (this.#thigh[0] + this.#thigh[1]);
    const armGain = lerp(p.armGainWalk, p.armGainRun, run) * m;
    const elbowBend = lerp(p.elbowBendWalk, p.elbowBendRun, run) * m;
    for (let i = 0; i < 2; i++) {
      const aj = ARM_JOINTS[i];
      const swing = this.#thigh[1 - i] - meanThigh;
      loco[aj.shoulder] = rest[aj.shoulder] - armGain * swing;
      loco[aj.elbow] = rest[aj.elbow] - elbowBend - 0.25 * armGain * Math.abs(swing);
    }
    // Gaze stabilisation: the neck hangs off the SPINE pivot (Humanoid's tree and lane A's), so
    // the head's world pitch is spine + neck + head; cancel headStabilise of the chest (spine)
    // pitch only — the abdomen turns the pelvis, not the head.
    const chestPitch = angles[SPINE];
    loco[NECK] = rest[NECK] - 0.5 * p.headStabilise * chestPitch;
    loco[HEAD] = rest[HEAD] - 0.5 * p.headStabilise * chestPitch;

    // 7. Everything else through the layers.
    B.evaluate(h, angles, TRUNK);

    for (let i = 0; i < 2; i++) {
      // The rolls belong to the locomotion layer: they fade with its authority over the leg.
      const a = B.baseAuthority(LEG_JOINTS[i].hip);
      out.hipRoll[i] = a * this.#legRoll[i];
      out.ankleRoll[i] = -out.hipRoll[i];
    }
    // 8. Root height. While the gait owns the legs the IK ride height holds (planted soles on the
    //    ground). Legs it does NOT own (skill curve, KO, air) follow lane A's rule instead: the
    //    lowest sole point of the FINAL pose sits on the body's floor (baseRootY - soleDepth: the
    //    floor itself for a sole-origin rig, one body radius under the centre for the legacy one),
    //    so an authored lunge neither floats (lowest sole 15.6 cm up mid-dash with the old 0 offset) nor sinks:
    //      G = -soleDepth - lowest,   rootOffsetY = a·(ride root - baseRootY) + (1 - a)·G.
    //    During a handover (0 < a < 1) the two poses and the two root rules are mixed, and a convex
    //    mix of root heights does not keep the mixed pose's soles up (measured -4.8 cm at a = 0.5
    //    after a dash), so the root is also lifted until the lowest sole is on the floor, with a
    //    weight that is 1 below a = 1 - HANDOVER_BAND and fades to 0 at a = 1 (no pop).
    if (auth < 1) {
      const grounded = -this.#soleDepth - this.#lowestSole(angles, out.hipRoll, out.ankleRoll);
      const mixed = auth * (rootY - baseRootY) + (1 - auth) * grounded;
      out.rootOffsetY = mixed + Math.min(1, (1 - auth) / HANDOVER_BAND) * Math.max(0, grounded - mixed);
    } else {
      out.rootOffsetY = rootY - baseRootY;
    }
    // 9. Sole guard (last line, lift only): no heel, ball or toe tip of the FINAL pose may sit
    //    below the ground under it. Transients the IK cannot follow (a 0 -> 6.5 m/s keyboard start,
    //    the speed limiter, a clamp) then hover a foot for a frame instead of sinking it.
    const clearance = this.#soleClearance(inp, baseRootY + out.rootOffsetY, angles, out.hipRoll, out.ankleRoll);
    if (clearance < 0) out.rootOffsetY -= clearance;
    out.rootRoll = roll;
    out.rootOffsetLateral = this.#lateral;
    out.pelvisDrop = drop;
    out.phase = this.gait.phase;
    for (let i = 0; i < 2; i++) {
      const f = this.gait.feet[i], o = out.feet[i];
      o.x = f.x; o.z = f.z; o.y = this.#ballY[i];
      // "Planted" is a PROMISE that the sole is on the ground: the gait owns the leg, the IK hit
      // its target (< 1 cm) and the joint limits did not bend the solution (< 0.01 rad).
      const lj = LEG_JOINTS[i], loco = B.values(LAYER.loco), a = out.angles;
      const unclamped = Math.abs(a[lj.hip] - loco[lj.hip]) < 0.01 && Math.abs(a[lj.knee] - loco[lj.knee]) < 0.01 &&
        Math.abs(a[lj.ankle] - loco[lj.ankle]) < 0.01;
      o.planted = inp.grounded && f.planted && B.baseAuthority(lj.hip) > 0.98 && this.#legs[i].residual < 0.01 && unclamped &&
        !this.#legs[i].limited;
    }
    out.footPlant.left = out.feet[0].planted;
    out.footPlant.right = out.feet[1].planted;
    return out;
  }

  /**
   * Height (m, rig-local, relative to the rig origin) of the lowest sole point — heel, ball or
   * toe tip of either foot — for the given final angles and rolls (Rig.legFK3).
   */
  #lowestSole(angles: Float64Array, hipRoll: Float64Array, ankleRoll: Float64Array): number {
    let lo = Infinity;
    for (let i = 0; i < 2; i++) {
      legFK3(this.geometry, angles, i as Side, hipRoll[i], ankleRoll[i], FK3);
      lo = Math.min(lo, FK3.ball[1], FK3.heel[1], FK3.toe[1]);
    }
    return lo;
  }

  /**
   * Smallest height (m) of any sole point (heel, ball, toe tip of both feet) above the ground
   * under it, for the rig origin at world height `rootWorldY` with this frame's roll and lateral
   * shift: world y = rootWorldY + x·sin ρ + y·cos ρ (the rig rolls about its local z).
   */
  #soleClearance(inp: AnimatorInput, rootWorldY: number, angles: Float64Array, hipRoll: Float64Array, ankleRoll: Float64Array): number {
    let worst = Infinity;
    const ox = inp.x + this.#lateral * Math.cos(inp.yaw), oz = inp.z - this.#lateral * Math.sin(inp.yaw);
    for (let i = 0; i < 2; i++) {
      legFK3(this.geometry, angles, i as Side, hipRoll[i], ankleRoll[i], FK3);
      for (let k = 0; k < 3; k++) {
        const pt = k === 0 ? FK3.ball : k === 1 ? FK3.heel : FK3.toe;
        const y = rootWorldY + pt[0] * this.#sinR + pt[1] * this.#cosR;
        localToWorld(ox, oz, inp.yaw, pt[0] * this.#cosR - pt[1] * this.#sinR, pt[2], P2);
        worst = Math.min(worst, y - inp.groundHeight(P2[0], P2[1]));
      }
    }
    return worst;
  }

  /** Cache the root roll and the lateral shift that makes it pivot at the ground (m). */
  #setRoll(totalRoll: number, heightAboveGround: number): void {
    this.#sinR = Math.sin(totalRoll);
    this.#cosR = Math.cos(totalRoll);
    this.#lateral = -heightAboveGround * this.#sinR;
  }

  /**
   * Ankle target of leg i, relative to its hip pivot, in the rig's local UNROLLED frame, into D3
   * as [dx, dy, dz]. The contact point (cX lateral, cY world height, cZ forward; rig-local
   * horizontally) carries the foot at toe-down pitch Θ; `forward` is the contact's offset along
   * the sole (ballForward for the ball, -heelBack for the heel). World-relative-to-root
   * (X, Y, Z) is un-rolled: local = Rz(-ρ)·((X, Y) - (lateral, 0)).
   */
  #ankleTarget(i: number, cX: number, cY: number, cZ: number, pitch: number, forward: number, rootY: number): void {
    const g = this.geometry;
    ankleFromBall(cY, cZ, pitch, g.soleOffset, forward, ANK);
    const X = cX - this.#lateral, Y = ANK[0] - rootY;
    const xl = X * this.#cosR + Y * this.#sinR, yl = -X * this.#sinR + Y * this.#cosR;
    D3[0] = xl - g.hipLateral[i];
    D3[1] = yl - HIP2[0];
    D3[2] = ANK[1] - HIP2[1];
  }

  /** Skill curve -> skill layer values; its mask follows the joints the curve animates. */
  #fillSkill(skill: SkillAnimation, progress: number, h: number): void {
    const lim = this.limits, vals = this.blender.values(LAYER.skill), mask = this.blender.mask(LAYER.skill);
    const t = clamp(progress, 0, 1);
    this.#skillAnimated.fill(0);
    for (let k = 0; k < skill.tracks.length; k++) {
      const tr = skill.tracks[k];
      const j = JOINT_INDEX[tr.joint];
      if (j === undefined) continue;
      vals[j] = clamp(lim.rest[j] + trackOffset(tr, t), lim.min[j], lim.max[j]);
      this.#skillAnimated[j] = 1;
    }
    const follow = 1 - Math.exp(-this.params.skillMaskLambda * h);
    for (let j = 0; j < JOINT_COUNT; j++) mask[j] += (this.#skillAnimated[j] - mask[j]) * follow;
  }
}
