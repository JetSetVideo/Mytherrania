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

import { TOE_OUT_RAD, toeOutYaw } from "./FootTurnout.ts";
import { clamp, damp, lerp, smoothstep, wrapAngle } from "../../core/MathCore.ts";
import { type FourPhaseProfile, fourPhasePeakRate, styledTrackOffset, trackOffset } from "../AnimationCurve.ts";
import type { SkillAnimation } from "../Skills.ts";
import {
  ankleFromBall, type GroundHeightFn, type GroundSample, type LegJointLimits, newLegSolution, pelvisDropFor, sampleGround,
  smoothMax, smoothMin, solveLegInPelvis, type TwoBoneChain,
} from "./FootIK.ts";
import { Gait, type GaitParams } from "./Gait.ts";
import {
  type AnimFallInput, type AnimShoveInput, CONTACT_COUNT, evalKeys, type FallKey, type FallSequences, fallSequences,
  newReact, qaxis, qmul, qrot, qslerp, reactTargets, type ReactTargets, wideLimits,
} from "./FallMotion.ts";
import type { LiveState, MotionStyle } from "./MotionStyle.ts";
import { makeMask, MASK_FULL, MASK_LOWER, MASK_UPPER, PoseBlender } from "./PoseBlend.ts";
import { AIR_POSE, ATTACK_POSE, BREATH_UNIT, GUARD_POSE, HIT_OFFSETS, KO_POSE, poseArray } from "./Poses.ts";
import {
  ARM_JOINTS, bodySpheres, hipPivot, hipRestRollOf, JOINT_COUNT, JOINT_INDEX, type JointLimitTable, LEG_JOINTS, legFK3,
  type LegGeometry, legLength, localToWorld, newLegFK3, type Side, SPHERE, SPHERE_COUNT, standingSoleDepth, worldToLocal,
} from "./Rig.ts";

export type { AnimFallInput, AnimFallPhase, AnimFallPose, AnimShoveInput } from "./FallMotion.ts";

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
  /**
   * Lane M ball pivot. The legs have no yaw joint, so when the body turns over a planted foot
   * (a swing's aim + trunk twist, circling a rival) the foot turns with it about its ball and the
   * heel SWEEPS the floor (measured 28-71 mm per stance in swings). A fighter pivots on the ball
   * with the heel up: the planted foot rolls onto its ball by pivotPitch (rad, toe-down) as the
   * yaw since touchdown grows from pivotStart to pivotFull (rad, smoothstep); the roll eases in at
   * pivotRise and out at pivotFall (1/s). 0.14 rad lifts a 0.2 m foot's heel ~2.8 cm.
   */
  pivotPitch: number;
  pivotStart: number;
  pivotFull: number;
  pivotRise: number;
  pivotFall: number;
  /** A root jump longer than this (m) in one frame re-plants the feet (respawn, teleport). */
  teleportDistance: number;
  /**
   * Wave V lane P — idle FACING HOLD (only when the caller honours AnimatorOutput.yawOffset,
   * AnimatorInput.honoursYawOffset). The legs have no yaw joint, so a body that keeps turning to
   * face a swaying rival must either slide its planted feet or pivot them onto the balls (heel up:
   * measured 18-27 mm, 8° sole pitch, 80 % of idle frames). Standing, the body instead HOLDS the
   * heading its feet were planted at while the rival stays inside ±facingSlack (rad); past it, it
   * re-faces: the heading eases toward the rival at facingRate (1/s) and every foot whose heading
   * is more than facingReplant (rad) off steps in place (Gait replantYaw) until it is aligned.
   * Moving / attacking / in a skill, the held heading is released toward the rival at
   * facingRelease (1/s). `facingSlack` 0 disables the hold.
   */
  facingSlack: number;
  facingRate: number;
  facingReplant: number;
  facingDone: number;
  facingRelease: number;
  /** Gait.moving below which the body counts as standing for the facing hold. */
  facingStill: number;
  /**
   * Wave V lane P — breathing. The breath layer's weight while attacking or in a skill (share of
   * the idle weight; moving fades it by (1 - moving) as before), the inhale skew k (phase warp
   * ψ = φ + k·sin φ: the inhale takes (1 - k·2/π)/2 of the cycle, the exhale the rest), and the
   * chest RISE: the pelvis rides up to breathRise·L lower on the exhale (never above the stance
   * height, so the knees never straighten past the IK's exact range; the feet stay latched).
   */
  breathActiveShare: number;
  breathSkew: number;
  breathRise: number;
  /**
   * Wave V lane P — idle weight shift: the pelvis drifts sideways over the feet by up to
   * idleSwayAmp·L (rig-local x; the IK keeps the soles latched) with a seeded period in
   * [idleSwayPeriodMin, idleSwayPeriodMax] s, faded in at idleSwayLambda (1/s) when standing.
   */
  idleSwayAmp: number;
  idleSwayPeriodMin: number;
  idleSwayPeriodMax: number;
  idleSwayLambda: number;
  /** Rate (1/s) the idle sway fades OUT at when the fighter moves / strikes / is hit (a quick release). */
  idleSwayRelease: number;
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
  breathRate: 0.22,
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
  pivotPitch: 0.14,
  pivotStart: 0.004,
  pivotFull: 0.04,
  pivotRise: 40,
  pivotFall: 12,
  facingSlack: 0.1,
  facingRate: 5,
  facingReplant: 0.006,
  facingDone: 0.004,
  facingRelease: 20,
  facingStill: 0.05,
  breathActiveShare: 0.25,
  breathSkew: 0.3,
  breathRise: 0.0022,
  idleSwayAmp: 0.011,
  idleSwayPeriodMin: 6,
  idleSwayPeriodMax: 9,
  idleSwayLambda: 1.5,
  idleSwayRelease: 6,
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
  /**
   * Optional dense JOINT_ORDER pose for the attack layer THIS frame (a weapon swing curve, lane X2
   * Swing.ts). Null/absent: the static ATTACK_POSE. A swing curve is smooth by construction, so
   * the pop guard does not delay it (trusted in proportion to the attack layer's weight).
   */
  attackPose?: Float64Array | null;
  /**
   * Lane M: 0..1 leg drive of the swing playing this frame (SwingDriver.legDrive): the legs LEAD a
   * strike — the pelvis sinks into the planted feet (knees bend, feet stay latched) ahead of the
   * arm. Scaled by the style's crouch; 0 / absent = no drive (today's behaviour).
   */
  attackDrive?: number;
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
  /**
   * Wave V lane P: true when the caller ADDS AnimatorOutput.yawOffset to the rig's yaw (and to the
   * lateral-offset direction). Only then may the animator hold an idle heading (facing hold);
   * absent/false: yawOffset stays 0 and the motion is exactly as before.
   */
  honoursYawOffset?: boolean;
  /**
   * Wave FALL (C-ANIM): the fighter's fall state (M's Fall.ts). "stagger" / "stumble" layer a
   * balance reaction on the gait; "falling" / "down" / "rising" hand the whole body to the keyed
   * fall -> lying -> get-up (FallMotion.ts), grounded on the floor and anchored on its contacts.
   * Absent / null / "stand" = today's motion exactly. While it plays, the caller must honour
   * AnimatorOutput.yawOffset, rootTilt and rootOffsetForward (docs/wave-fall/ANIMATION.md).
   */
  fall?: AnimFallInput | null;
  /** Wave FALL (C-ANIM): a shove / clash exchange (brace -> impact -> recoil) layered on the gait. */
  shove?: AnimShoveInput | null;
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
  /**
   * Wave X: each foot's turn-out [L, R], rad (+ = toes outward, FootTurnout.ts). Constant (the
   * planted-foot rule: a yaw that changed under a planted foot would slide its ball).
   */
  toeOut: Float64Array;
  footPlant: { left: boolean; right: boolean };
  /** Ball of each foot ["L", "R"], world. */
  feet: [FootOut, FootOut];
  /** Pelvis drop applied for reach this frame, m. */
  pelvisDrop: number;
  /** Gait phase in [0, 1). */
  phase: number;
  /**
   * Wave V lane P: add to the rig's yaw (rad). Non-zero only while the facing hold keeps the body
   * on its planted heading (AnimatorInput.honoursYawOffset); the IK solved the legs for
   * yaw + yawOffset, so a caller that ignores it would render the feet turned.
   */
  yawOffset: number;
  /** Wave V lane P: this frame's breathing signal in [-1, 1] × the breath layer weight (QA). */
  breath: number;
  /** Wave V lane P: this frame's idle weight shift, rig-local x, m (QA; already in rootOffsetLateral). */
  idleSway: number;
  /**
   /**
    * Wave FALL: add this to the fighter's body x/z this frame (world m). While a fall / lying /
    * get-up plays, the body (physics, hitboxes, ring-out, AI) is pulled under the PELVIS of the pose
    * (the contact anchoring moves the pose over the floor: a backward fall lands the hips ~0.5 m
    * behind the feet, a get-up stands up over a planted foot). The animator already moved its root
    * offsets by the same amount, so a caller that ignores it sees the pose drift toward the body.
    */
   bodyShift: Float64Array;
   /** Wave FALL: whole-body tilt, unit quaternion [x, y, z, w] in the HEADING frame, applied between
   * the yaw and the roll: rig rotation = Ry(yaw + yawOffset) · rootTilt · Rz(rootRoll + caller's tilt)
   * (SkinnedHumanoid.applyRootTilt). Identity unless a fall / get-up plays.
   */
  rootTilt: Float64Array;
  /** Wave FALL: shift the rig origin along its local z (m), like rootOffsetLateral along x. 0 unless falling. */
  rootOffsetForward: number;
  /** Wave FALL: share (0..1) of the keyed fall / lying / get-up pose in this frame's output (QA). */
  fallWeight: number;
  /**
   * Wave FALL: 0..1 — how much the caller should seat the WHOLE body on the floor after placing
   * the rig (SkinnedHumanoid.settleOnFloor: the lowest skin point onto the ground). The animator
   * already grounds its own body model (Rig.bodySpheres); this is the exact skin correction.
   */
  groundBody: number;
  /** Wave FALL: the pose uses the widened lying / kneeling windows (FallMotion.WIDE_JOINT_LIMITS): pass to Skeleton.drive. */
  wideLimits: boolean;
}

const SPINE = JOINT_INDEX.spine, ABD = JOINT_INDEX.abdomen, NECK = JOINT_INDEX.neck, HEAD = JOINT_INDEX.head;
const TRUNK = makeMask(["spine", "abdomen"]);
const HIP2 = new Float64Array(2);
const HIP_NB = new Float64Array(2);
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
/** Share of a styled skill track's time-to-peak the counter-move takes (the strike gets the rest). */
export const SKILL_ANTICIPATION_SHARE = 0.3;
/**
 * Styled skill curves' main strike stays under this share of the joint speed limit: the rest is
 * headroom for the wobble and the chain-lead time warp (up to ~1.3× on the leading joints).
 */
export const SKILL_SPEED_SHARE = 0.65;
const PR4: FourPhaseProfile = { anticipation: 0, anticipationShare: 0, hold: 0, overshoot: 0, settle: 0 };

/** Layer indices inside the animator's blender. */
export const LAYER = { loco: 0, air: 1, guard: 2, attack: 3, skill: 4, ko: 5, hit: 6, balance: 7, breath: 8, react: 9 } as const;

/** Wave FALL: rate (1/s) the body is pulled under the fallen pose's pelvis (AnimatorOutput.bodyShift). */
export const FALL_BODY_PULL = 10;
/**
 * Wave FALL: fastest whole-body turn (rad/s) of the fall / get-up root tilt. The keys are timed by
 * M's law (a 0.8 s get-up at the fast end), so the root's angular speed is rate-limited like every
 * joint (PoseBlender.maxJointSpeed): a short clip lags a little instead of popping.
 */
export const FALL_ROOT_SPEED = 9;
/** Wave FALL: inertialization time (s) that absorbs any pose jump at a fall phase switch / exit. */
export const FALL_BLEND_TIME = 0.22;
/** Wave FALL: values carried through the inertialization (16 joints + hipRoll[2] + ankleRoll[2]). */
const FV = JOINT_COUNT + 4;
const REACT_MASK = makeMask(["shoulderL", "shoulderR", "elbowL", "elbowR", "neck"]);

/** Wave FALL: per-fighter fall state (internal). */
interface FallState {
  mode: boolean;
  phase: string;
  pose: string;
  seq: FallSequences;
  keys: FallKey[];
  /** Heading the body falls / lies on (rad, world) and the one it started from. */
  heading: number;
  yaw0: number;
  /** Root horizontal offset from the body position, world m (the contact anchoring moves it). */
  cx: number;
  cz: number;
  latchX: Float64Array;
  latchZ: Float64Array;
  latched: Uint8Array;
  /** Inertialization: value offsets, world-rotation offset, root offsets, elapsed. */
  off: Float64Array;
  qOff: Float64Array;
  offC: Float64Array;
  offT: number;
  /** Last final output of the fall pose (for inertialization at a switch). */
  last: Float64Array;
  lastQ: Float64Array; // world rotation Ry(yaw)·tilt
  lastYaw: number;
  lastC: Float64Array; // cx, cz, rootY(world)
  handoff: boolean;
  /** Exit inertialization (normal mode after a fall), elapsed; < 0 = none. */
  exitT: number;
  contact: Float64Array;
  clearance: number;
  /** The snapshot's hip / ankle rolls (kept while its feet stay loaded in the first fall keys). */
  snapRoll: Float64Array;
  /** Heading turn (rad) the get-up makes on hands and knees to face the rival (latched at rise start). */
  turnTo: number;
}

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
  /** The static ATTACK_POSE array, restored when a legacy attack follows a swing curve. */
  readonly #attackStatic: Float64Array;
  /** True while the attack layer holds a swing curve's values (not ATTACK_POSE). */
  #attackDynamic = false;
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
  /** Lane M: the gait's own stride parameters (the style scales them), the guard pose, pivots. */
  readonly #strideA0: number;
  readonly #strideB0: number;
  readonly #guardBase: Float64Array;
  readonly #plantYaw = new Float64Array(2);
  readonly #wasPlanted = [true, true];
  readonly #pivot = new Float64Array(2);
  #breathPh = 0;
  /** Wave V lane P: facing hold, idle sway. */
  #heldYaw = 0;
  #heldInit = false;
  #refacing = false;
  #lastYawEff = 0;
  #swayPh = 0;
  #swayW = 0;
  #swayX = 0;
  /** Wave FALL: reaction (shove / stagger / stumble) state and target, the fall state, scratch. */
  readonly #react: ReactTargets = newReact();
  readonly #reactTarget: ReactTargets = newReact();
  #reactOn = false;
  readonly #wide: JointLimitTable;
  readonly #fs: FallState;
  readonly #sph = new Float64Array(4 * SPHERE_COUNT);
  readonly #normA = new Float64Array(FV);
  readonly #fallA = new Float64Array(FV);
  readonly #rawQ = new Float64Array(4);
  readonly #qw = new Float64Array(4);
  readonly #qt = new Float64Array(4);
  readonly #v3 = new Float64Array(3);

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
    this.#strideA0 = this.gait.params.strideAtRest;
    this.#strideB0 = this.gait.params.strideGain;
    this.#guardBase = poseArray(GUARD_POSE, limits, "override");
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
    // Wave FALL: shove / stagger / stumble arm + neck offsets (additive; all-zero values = no effect).
    B.addLayer({ name: "react", mode: "additive", mask: REACT_MASK, smoothTime: 0 });
    B.values(LAYER.air).set(poseArray(AIR_POSE, limits, "override"));
    B.values(LAYER.guard).set(poseArray(GUARD_POSE, limits, "override"));
    this.#attackStatic = poseArray(ATTACK_POSE, limits, "override");
    B.values(LAYER.attack).set(this.#attackStatic);
    B.values(LAYER.ko).set(poseArray(KO_POSE, limits, "override"));
    B.values(LAYER.hit).set(poseArray(HIT_OFFSETS, limits, "additive"));
    B.values(LAYER.skill).set(limits.rest);
    B.setWeightImmediate(LAYER.balance, 1);
    B.setWeightImmediate(LAYER.breath, 1);
    B.setWeightImmediate(LAYER.react, 1);
    for (let j = 0; j < JOINT_COUNT; j++) B.passThrough[j] = MASK_LOWER[j];
    let range = 0;
    for (let j = 0; j < JOINT_COUNT; j++) range = Math.max(range, limits.max[j] - limits.min[j]);
    B.maxJointSpeed = Number.isNaN(p.maxJointSpeed) ? (Math.PI / 2) * range / this.gait.params.minSwingTime : p.maxJointSpeed;
    this.#breathUnit = poseArray(BREATH_UNIT, limits, "additive");
    this.output = {
      angles: Float64Array.from(limits.rest),
      rootOffsetY: 0, rootRoll: 0, rootOffsetLateral: 0,
      hipRoll: new Float64Array(2), ankleRoll: new Float64Array(2), toeOut: Float64Array.of(TOE_OUT_RAD, TOE_OUT_RAD),
      footPlant: { left: true, right: true },
      feet: [{ x: 0, y: 0, z: 0, planted: true }, { x: 0, y: 0, z: 0, planted: true }],
      pelvisDrop: 0, phase: 0, yawOffset: 0, breath: 0, idleSway: 0,
      rootTilt: Float64Array.of(0, 0, 0, 1), rootOffsetForward: 0, fallWeight: 0, groundBody: 0, wideLimits: false,
      bodyShift: new Float64Array(2),
    };
    this.#wide = wideLimits(limits);
    const seq = fallSequences("back", 1);
    this.#fs = {
      mode: false, phase: "stand", pose: "back", seq, keys: seq.falling, heading: 0, yaw0: 0, cx: 0, cz: 0,
      latchX: new Float64Array(CONTACT_COUNT), latchZ: new Float64Array(CONTACT_COUNT), latched: new Uint8Array(CONTACT_COUNT),
      off: new Float64Array(FV), qOff: Float64Array.of(0, 0, 0, 1), offC: new Float64Array(3), offT: Infinity,
      last: new Float64Array(FV), lastQ: Float64Array.of(0, 0, 0, 1), lastYaw: 0, lastC: new Float64Array(3),
      handoff: false, exitT: -1, contact: new Float64Array(CONTACT_COUNT), clearance: 0, snapRoll: new Float64Array(4),
      turnTo: 0,
    };
  }

  /** Wave FALL (QA): the fall state's contact loads [footL, footR, kneeL, kneeR, handL, handR, pelvis] and mode. */
  get fallDebug(): { mode: boolean; phase: string; contact: Float64Array; heading: number; spheres: Float64Array } {
    const f = this.#fs;
    return { mode: f.mode, phase: f.phase, contact: f.contact, heading: f.heading, spheres: this.#sph };
  }

  /** Leg length L (m). */
  get legLength(): number { return this.#L; }

  #style: MotionStyle | null = null;
  #stepsStyle = false;
  /** Lane M: the fighter's motion style (null = today's motion). */
  get style(): MotionStyle | null { return this.#style; }
  /** Lane M: use a motion style (MotionStyle.ts); null restores the unstyled motion. */
  setStyle(style: MotionStyle | null): void {
    this.#style = style;
    this.#stepsStyle = style ? style.claim(this) : false;
  }
  /** Lane M: this frame's live state (hp / stamina / mana / exhaustion), smoothed by the style. */
  setLive(live: Readonly<LiveState>): void { this.#style?.setLive(live); }

  /** Re-plant both feet under the hips and drop the filter history (spawn, round reset, teleport). */
  reset(x: number, z: number, yaw: number): void {
    this.gait.reset(x, z, yaw, this.params.guardStagger * this.#L * this.#stance);
    this.blender.resetFilter();
    this.#plantYaw[0] = this.#plantYaw[1] = yaw;
    this.#wasPlanted[0] = this.#wasPlanted[1] = true;
    this.#pivot[0] = this.#pivot[1] = 0;
    this.#lastX = x; this.#lastZ = z; this.#hasLast = true;
    this.#primed = false;
    this.#heldYaw = yaw; this.#heldInit = true; this.#refacing = false; this.#lastYawEff = yaw;
    this.#fs.mode = false; this.#fs.exitT = -1; this.#fs.phase = "stand";
  }

  /** Wave V lane P: the idle sway period of this fighter, s (seeded by the style's breath phase). */
  get idleSwayPeriod(): number {
    const p = this.params, st = this.#style;
    const u = st ? (st.breathPhase / (2 * Math.PI) * 7.31) % 1 : 0.5;
    return p.idleSwayPeriodMin + (p.idleSwayPeriodMax - p.idleSwayPeriodMin) * u;
  }

  /** Advance by dt seconds and return the pose (the same object every frame). */
  update(dt: number, inp: AnimatorInput): AnimatorOutput {
    const p = this.params, g = this.geometry, L = this.#L, B = this.blender, lim = this.limits, out = this.output;
    const h = clamp(dt, 0, p.maxStep);
    if (this.#hasLast && Math.hypot(inp.x - this.#lastX, inp.z - this.#lastZ) > p.teleportDistance) this.reset(inp.x, inp.z, inp.yaw);
    this.#lastX = inp.x; this.#lastZ = inp.z; this.#hasLast = true;
    this.#time += h;
    // Lane M: the style's live smoothing (when this animator steps it) and its coefficients.
    const st = this.#style;
    if (st && this.#stepsStyle) st.step(h);
    const e = st ? st.eff : null;
    if (e) {
      this.gait.params.strideAtRest = this.#strideA0 * e.strideScale;
      this.gait.params.strideGain = this.#strideB0 * e.strideScale;
    }

    // Wave FALL: which motion owns the body, and the get-up hand-off (before the facing hold, so the
    // gait inherits the heading the rise ended on and the feet where it put them).
    const fin = inp.fall ?? null;
    const fallOwns = !!fin && (fin.phase === "falling" || fin.phase === "down" || fin.phase === "rising");
    {
      const fs = this.#fs;
      if (fallOwns && fs.mode && fin!.phase === "rising" && fin!.t01 >= fs.seq.guardAt && !fs.handoff) this.#handOff(inp.x, inp.z);
    }

    // 0. Facing hold (wave V lane P, AnimatorParams.facingSlack): standing, the body keeps the
    //    heading its feet were planted at while the rival sways inside the slack, and re-faces with
    //    a step past it. Every rig-frame computation below uses the EFFECTIVE yaw.
    let yaw = inp.yaw, holdIdle = false;
    if (inp.honoursYawOffset && p.facingSlack > 0) {
      if (!this.#heldInit) { this.#heldYaw = inp.yaw; this.#heldInit = true; this.#lastYawEff = inp.yaw; }
      holdIdle = inp.grounded && !inp.ko && !inp.attack && !inp.skill && !inp.attackPose && this.gait.moving < p.facingStill;
      const err = wrapAngle(inp.yaw - this.#heldYaw);
      if (fallOwns && this.#fs.mode) {
        // Wave FALL: through a fall / get-up and its hand-off the gait keeps the heading the rise
        // ends on — no re-facing step under a loaded foot; the turn toward the rival comes after.
        holdIdle = false; this.#refacing = false;
      } else if (holdIdle) {
        if (Math.abs(err) > p.facingSlack) this.#refacing = true;
        if (this.#refacing) {
          this.#heldYaw = wrapAngle(this.#heldYaw + err * (1 - Math.exp(-p.facingRate * h)));
          if (Math.abs(wrapAngle(inp.yaw - this.#heldYaw)) < p.facingDone) this.#refacing = false;
        }
      } else {
        this.#refacing = false;
        this.#heldYaw = Math.abs(err) < 1e-5 ? inp.yaw : wrapAngle(this.#heldYaw + err * (1 - Math.exp(-p.facingRelease * h)));
      }
      yaw = this.#heldYaw;
    } else {
      this.#heldYaw = inp.yaw; this.#heldInit = true; this.#refacing = false;
    }
    const yawOffset = wrapAngle(yaw - inp.yaw);
    // The travel direction relative to the EFFECTIVE facing, and the effective turn rate.
    const mdl = inp.honoursYawOffset ? wrapAngle(inp.moveDirLocal - yawOffset) : inp.moveDirLocal;
    const turnRate = inp.honoursYawOffset ? (h > 0 ? wrapAngle(yaw - this.#lastYawEff) / h : 0) : inp.turnRate;
    this.#lastYawEff = yaw;

    // Wave FALL: shove / stagger / stumble reaction targets in the rig frame, sprung (no pops).
    if (inp.shove || (fin && (fin.phase === "stagger" || fin.phase === "stumble")) || this.#reactOn) this.#stepReact(h, inp, fin, yaw);
    const rx = this.#reactOn ? this.#react : null;

    // 1. Gait.
    this.#stance = damp(this.#stance, inp.engaged || inp.block ? 1 : 0, 4, h);
    const prevSpeed = this.gait.speed;
    const md = yaw + mdl;
    sampleGround(inp.groundHeight, inp.x, inp.z, Math.sin(md), Math.cos(md), 0.5 * L, GS_BODY);
    this.gait.update(h, {
      x: inp.x, z: inp.z, yaw, speed: inp.speed, moveDirLocal: mdl,
      // The guard stagger fades out as the gait gets moving: a staggered stance is for standing
      // and shuffling; running with one foot's stance centred 0.15 L ahead demands extra reach.
      grounded: inp.grounded, stagger: p.guardStagger * L * this.#stance * (1 - this.gait.moving), turnRate,
      slopePitch: GS_BODY.slopePitch, hipShift: this.#hipShift,
      // Facing hold: a foot left on an old heading steps in place to align (the re-facing shuffle).
      replantYaw: holdIdle ? p.facingReplant : Infinity,
    });
    const sh = this.gait.shape, m = this.gait.moving, run = sh.runBlend;
    const ahead = Math.cos(mdl);
    this.#accel = damp(this.#accel, h > 0 ? (this.gait.speed - prevSpeed) / h : 0, p.accelLambda, h);

    // 2. Layer weights.
    const skill = inp.skill;
    B.setTarget(LAYER.air, inp.grounded ? 0 : 1);
    B.setTarget(LAYER.guard, inp.block ? 1 : inp.engaged ? p.guardIdleWeight : 0);
    B.setTarget(LAYER.attack, inp.attack && !skill ? 1 : 0);
    B.setTarget(LAYER.skill, skill ? 1 : 0);
    B.setTarget(LAYER.ko, inp.ko ? 1 : 0);
    B.setTarget(LAYER.hit, inp.hit && !inp.ko ? 1 : 0);
    // Breathing fades while moving (1 - m) and drops to breathActiveShare while striking / in a skill.
    B.setTarget(LAYER.breath, inp.ko ? 0 : (1 - m) * (inp.attack || skill ? p.breathActiveShare : 1));
    B.stepWeights(h);
    if (skill) this.#fillSkill(skill, inp.skillProgress, h);
    if (e) {
      // Styled guard: shoulders lowered by fatigue, elbows tucked when hurt (both arms).
      const gv = B.values(LAYER.guard), gb = this.#guardBase;
      for (let i = 0; i < 2; i++) {
        const aj = ARM_JOINTS[i];
        gv[aj.shoulder] = clamp(gb[aj.shoulder] + e.guardDrop, lim.min[aj.shoulder], lim.max[aj.shoulder]);
        gv[aj.elbow] = clamp(gb[aj.elbow] - e.guardTuck, lim.min[aj.elbow], lim.max[aj.elbow]);
      }
    }
    // A swing curve replaces the attack layer's values while it plays; the last curve values stay
    // while the layer fades out (no pop), and a later legacy attack restores ATTACK_POSE.
    if (inp.attackPose) { B.values(LAYER.attack).set(inp.attackPose); this.#attackDynamic = true; }
    else if (inp.attack && this.#attackDynamic) { B.values(LAYER.attack).set(this.#attackStatic); this.#attackDynamic = false; }
    {
      // Skill and swing curves are smooth by construction: the pop guard must not delay the strike pose.
      const ws = B.weight(LAYER.skill), sm = B.mask(LAYER.skill);
      const wa = inp.attackPose ? B.weight(LAYER.attack) : 0, am = B.mask(LAYER.attack);
      for (let j = 0; j < JOINT_COUNT; j++) B.trusted[j] = Math.max(ws * sm[j], wa * am[j]);
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
    // Lane M: the style's hunch (injury, fatigue, race) rides on the balance layer like a lean.
    const hunch = e ? e.hunch : 0;
    bal[SPINE] = accLean + hunch;
    bal[ABD] = counter * (accLean + hunch);
    if (rx) { bal[SPINE] += rx.lean; bal[ABD] += counter * rx.lean; }
    // Breathing (wave V lane P): integrated phase (a rate that changes with fatigue must not jump
    // the phase), a skewed wave — a quicker inhale, a longer exhale — and the style's amplitude.
    this.#breathPh += 2 * Math.PI * (e ? e.breathRate : p.breathRate) * h;
    if (this.#breathPh > 2 * Math.PI) this.#breathPh -= 2 * Math.PI;
    const bph = this.#breathPh + (st ? st.breathPhase : 0);
    const wave = Math.sin(bph + p.breathSkew * Math.sin(bph));
    const breathAmp = e ? e.breathAmp : p.breathAmplitude;
    const breath = breathAmp * wave;
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
    // The feet step under the hips where the trunk lean actually put them (next frame's rest spots).
    // Wave V lane P: WITHOUT the breathing — a breath is not a lean, and letting it walk the rest
    // spots (sub-mm) moved re-plant decisions across their thresholds (a frame-rate-dependent step).
    {
      const bs = B.weight(LAYER.breath) * breath;
      hipPivot(g, angles[SPINE] - bs * this.#breathUnit[SPINE], angles[ABD] - bs * this.#breathUnit[ABD], HIP_NB);
      this.#hipShift = HIP_NB[1] - this.#hipRestZ;
    }
    const pelvisR = hipPivot(g, angles[SPINE], angles[ABD], HIP2);
    const groundBody = inp.groundHeight(inp.x, inp.z);
    const baseRootY = inp.rootY ?? groundBody + this.#soleDepth;
    const exactRatio = 1 - p.reachMargin - p.softness;
    const rideMoving = Math.min(p.rideRun, exactRatio - Math.abs(sh.bobAmplitude) / L - 0.004);
    let ride = lerp(lerp(p.rideStand, rideMoving, m), p.rideGuard, B.weight(LAYER.guard));
    // Lane M: the style's stance height, and the strike's leg drive — the pelvis sinks into the
    // planted feet ahead of the arm (the IK bends the knees; the feet stay latched).
    if (e) ride = Math.min(ride + e.crouch - e.legDrive * clamp(inp.attackDrive ?? 0, 0, 1), exactRatio - Math.abs(sh.bobAmplitude) / L - 0.004);
    // Breath rise: the pelvis sits up to 2·breathRise·L lower on the exhale (inhale = the stance
    // height), so the chest and shoulders lift with each breath while the feet stay latched.
    const bw = B.weight(LAYER.breath);
    ride -= p.breathRise * (breathAmp / p.breathAmplitude) * bw * (1 - wave);
    if (rx) ride -= rx.crouch;
    out.breath = bw * wave;
    let rootY = groundBody + g.soleOffset + L * ride + this.gait.bob - HIP2[0];
    // Idle weight shift: the pelvis drifts over one foot, then the other (seeded slow period).
    {
      const swayOn = inp.grounded && !inp.ko && !inp.hit && !inp.attack && !skill ? 1 - m : 0;
      this.#swayW = damp(this.#swayW, swayOn, swayOn > this.#swayW ? p.idleSwayLambda : p.idleSwayRelease, h);
      this.#swayPh += 2 * Math.PI * h / this.idleSwayPeriod;
      if (this.#swayPh > 2 * Math.PI) this.#swayPh -= 2 * Math.PI;
      const sp = this.#swayPh + (st ? 0.5 * st.breathPhase : 0);
      this.#swayX = p.idleSwayAmp * L * this.#swayW * (0.8 * Math.sin(sp) + 0.2 * Math.sin(2.618 * sp + 1));
    }
    const auth = B.baseAuthority(LEG_JOINTS[0].hip);
    let roll = this.gait.roll * auth * (e ? e.sway : 1);
    if (rx) roll += rx.roll;
    const totalRoll = roll + (inp.externalRoll ?? 0);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const exactLimit = g.thigh + g.shin - this.#chain.reachMargin - this.#chain.softness;
    this.#setRoll(totalRoll, auth * (rootY - groundBody));
    // Reach radius of a swinging foot about its rest spot: 1.25·L·sin(θmax) (the gait's landing cap).
    const swingRadius = 1.25 * L * Math.sin(this.gait.params.maxStanceAngle) + p.swingRadiusSoftness * L;
    let drop = 0;
    // Ball pivot (AnimatorParams.pivotPitch): heel up while the body has turned over a planted foot.
    for (let i = 0; i < 2; i++) {
      const f = this.gait.feet[i];
      if (f.planted && !this.#wasPlanted[i]) this.#plantYaw[i] = yaw;
      this.#wasPlanted[i] = f.planted;
      const turned = f.planted ? Math.abs(wrapAngle(yaw - this.#plantYaw[i])) : 0;
      const want = p.pivotPitch * smoothstep(p.pivotStart, p.pivotFull, turned);
      this.#pivot[i] = damp(this.#pivot[i], want, want > this.#pivot[i] ? p.pivotRise : p.pivotFall, h);
    }
    for (let i = 0; i < 2; i++) {
      const f = this.gait.feet[i], gs = this.#ground[i];
      sampleGround(inp.groundHeight, f.x, f.z, fx, fz, 0.5 * (g.ballForward + g.heelBack), gs);
      worldToLocal(inp.x, inp.z, yaw, f.x, f.z, P2);
      if (!f.planted) {
        // A swinging foot may not wander out of reach of its rest spot: its horizontal offset r
        // is soft-clamped, r' = smoothMin(r, swingRadius, k). Exact for r <= swingRadius - k,
        // which contains every lift-off and landing spot, so the clamp only bends the mid-air
        // overshoot of a fast swing (the foot that would otherwise lock the knee straight).
        const rx0 = P2[0], rz0 = P2[1];
        worldToLocal(inp.x, inp.z, yaw, f.restX, f.restZ, P2);
        const ox = rx0 - P2[0], oz = rz0 - P2[1], rr = Math.hypot(ox, oz);
        const capped = smoothMin(rr, swingRadius, p.swingRadiusSoftness * L);
        const k = rr > 1e-9 ? capped / rr : 1;
        P2[0] += ox * k;
        P2[1] += oz * k;
      }
      this.#ballX[i] = P2[0];
      this.#ballZ[i] = P2[1];
      this.#ballY[i] = gs.height + f.lift;
      this.#pitch[i] = f.pitch - gs.slopePitch + this.#pivot[i];
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
        worldToLocal(inp.x, inp.z, yaw, f.landX - f.toGoX, f.landZ - f.toGoZ, P2);
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
    const armGain = lerp(p.armGainWalk, p.armGainRun, run) * m * (e ? e.armSwing : 1);
    const elbowBend = lerp(p.elbowBendWalk, p.elbowBendRun, run) * m;
    for (let i = 0; i < 2; i++) {
      const aj = ARM_JOINTS[i];
      const swing = this.#thigh[1 - i] - meanThigh;
      // Per body part: the style's seeded per-joint amplitude (each arm swings a little differently).
      loco[aj.shoulder] = rest[aj.shoulder] - armGain * swing * (st ? st.jointAmp[aj.shoulder] : 1);
      loco[aj.elbow] = rest[aj.elbow] - elbowBend - 0.25 * armGain * Math.abs(swing);
    }
    // Gaze stabilisation: the neck hangs off the SPINE pivot (Humanoid's tree and lane A's), so
    // the head's world pitch is spine + neck + head; cancel headStabilise of the chest (spine)
    // pitch only — the abdomen turns the pelvis, not the head.
    const chestPitch = angles[SPINE];
    loco[NECK] = rest[NECK] - 0.5 * p.headStabilise * chestPitch + (e ? e.headDrop : 0);
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
    const clearance = this.#soleClearance(inp, yaw, baseRootY + out.rootOffsetY, angles, out.hipRoll, out.ankleRoll);
    if (clearance < 0) out.rootOffsetY -= clearance;
    out.rootRoll = roll;
    out.rootOffsetLateral = this.#lateral;
    out.pelvisDrop = drop;
    out.phase = this.gait.phase;
    out.yawOffset = yawOffset;
    out.idleSway = this.#swayX;
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
    // Wave FALL: the keyed fall / lying / get-up owns (or hands back) the body; else the exit blend.
    out.rootTilt[0] = out.rootTilt[1] = out.rootTilt[2] = 0; out.rootTilt[3] = 1;
    out.rootOffsetForward = 0; out.fallWeight = 0; out.groundBody = 0; out.wideLimits = false;
    out.bodyShift[0] = out.bodyShift[1] = 0;
    if (fallOwns) this.#fallFrame(h, inp, fin!, baseRootY, yaw);
    else if (this.#fs.mode || this.#fs.exitT >= 0) this.#fallExit(h, inp, baseRootY, yaw);
    return out;
  }

  /** Wave FALL: spring the reaction toward this frame's targets; write the arm/neck layer values. */
  #stepReact(h: number, inp: AnimatorInput, fin: AnimFallInput | null, yaw: number): void {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const fd = fin ? fin.dir : null, sd = inp.shove ? inp.shove.dir : null;
    const df = fd ? fd[0] * fx + fd[1] * fz : 0, dl = fd ? fd[0] * fz - fd[1] * fx : 0;
    const sdf = sd ? sd[0] * fx + sd[1] * fz : 0, sdl = sd ? sd[0] * fz - sd[1] * fx : 0;
    const T = reactTargets(inp.shove, fin && (fin.phase === "stagger" || fin.phase === "stumble") ? fin : null, df, dl, sdf, sdl, this.#time, this.#reactTarget);
    const R = this.#react, k = 1 - Math.exp(-16 * h);
    R.lean += (T.lean - R.lean) * k; R.roll += (T.roll - R.roll) * k; R.crouch += (T.crouch - R.crouch) * k; R.neck += (T.neck - R.neck) * k;
    for (let i = 0; i < 2; i++) { R.shoulder[i] += (T.shoulder[i] - R.shoulder[i]) * k; R.elbow[i] += (T.elbow[i] - R.elbow[i]) * k; }
    const mag = Math.abs(R.lean) + Math.abs(R.roll) + Math.abs(R.crouch) + Math.abs(R.neck) +
      Math.abs(R.shoulder[0]) + Math.abs(R.shoulder[1]) + Math.abs(R.elbow[0]) + Math.abs(R.elbow[1]);
    const active = !!inp.shove || !!(fin && (fin.phase === "stagger" || fin.phase === "stumble"));
    const rv = this.blender.values(LAYER.react);
    if (!active && mag < 1e-5) {
      // Fully released: exact zeros, so the motion is byte-identical to a fighter never shoved.
      R.lean = R.roll = R.crouch = R.neck = 0; R.shoulder[0] = R.shoulder[1] = R.elbow[0] = R.elbow[1] = 0;
      rv.fill(0);
      this.#reactOn = false;
      return;
    }
    this.#reactOn = true;
    rv[JOINT_INDEX.shoulderL] = R.shoulder[0]; rv[JOINT_INDEX.shoulderR] = R.shoulder[1];
    rv[JOINT_INDEX.elbowL] = R.elbow[0]; rv[JOINT_INDEX.elbowR] = R.elbow[1]; rv[NECK] = R.neck;
  }

  /** Wave FALL: hand the get-up's feet and heading to the gait / facing hold (once per rise). */
  #handOff(bodyX: number, bodyZ: number): void {
    const fs = this.#fs;
    fs.handoff = true;
    for (let i = 0; i < 2; i++) {
      const b = SPHERE.ball[i] * 4;
      // Ball sphere centre, rig-local -> world, from the last fall frame (stored in #sph / lastC).
      qrot(fs.lastQ, this.#sph[b], this.#sph[b + 1], this.#sph[b + 2], this.#v3);
      this.gait.plantAt(i as Side, bodyX + fs.lastC[0] + this.#v3[0], bodyZ + fs.lastC[1] + this.#v3[2], fs.lastYaw);
      this.#plantYaw[i] = fs.lastYaw; this.#wasPlanted[i] = true; this.#pivot[i] = 0;
    }
    this.#heldYaw = fs.lastYaw; this.#heldInit = true; this.#refacing = false; this.#lastYawEff = fs.lastYaw;
  }

  /** Wave FALL: the heading the body falls / lies on for `pose` falling toward `dir`, and the landing side. */
  #fallHeading(pose: string, dir: readonly [number, number], yawNow: number): { heading: number; side: number } {
    const n = Math.hypot(dir[0], dir[1]);
    const dx = n > 1e-6 ? dir[0] / n : -Math.sin(yawNow), dz = n > 1e-6 ? dir[1] / n : -Math.cos(yawNow);
    if (pose === "front") return { heading: Math.atan2(dx, dz), side: 1 };
    if (pose === "back") {
      // Roll-over side for the get-up: toward the rig side the body already leans (+x when unknown).
      return { heading: Math.atan2(-dx, -dz), side: 1 };
    }
    // Side: the rig's +x side lands when dir = local +x = (cos h, -sin h); the -x side when dir = -local x.
    const h1 = Math.atan2(-dz, dx), h2 = Math.atan2(dz, -dx);
    return Math.abs(wrapAngle(h1 - yawNow)) <= Math.abs(wrapAngle(h2 - yawNow)) ? { heading: h1, side: 1 } : { heading: h2, side: -1 };
  }

  /**
   * Wave FALL: one frame of the keyed fall / lying / get-up. The normal pipeline already ran (its
   * result is in `out`); this replaces it (blending back to it after the get-up's guard key):
   *   pose     keys (FallMotion) -> joints + root tilt; any switch is inertialized (FALL_BLEND_TIME)
   *   anchor   loaded contacts (feet, knees, hands, pelvis) latch where they touch down and the root
   *            moves so they stay there (C = weighted mean of latch - current)
   *   ground   the lowest body sphere (Rig.bodySpheres) sits on the floor under it
   */
  #fallFrame(h: number, inp: AnimatorInput, fin: AnimFallInput, baseRootY: number, yawN: number): void {
    const fs = this.#fs, out = this.output, lim = this.#wide, A = this.#fallA, nA = this.#normA;
    nA.set(out.angles); nA[16] = out.hipRoll[0]; nA[17] = out.hipRoll[1]; nA[18] = out.ankleRoll[0]; nA[19] = out.ankleRoll[1];
    const yawNorm = inp.yaw + out.yawOffset;
    const nLat = out.rootOffsetLateral, ncx = nLat * Math.cos(yawNorm), ncz = -nLat * Math.sin(yawNorm);
    const nRootY = baseRootY + out.rootOffsetY;
    const qN = qmul(qaxis(1, yawNorm, this.#qt), qaxis(2, out.rootRoll, this.#rawQ), new Float64Array(4));
    void yawN;
    let switched = false;
    const t = clamp(fin.t01, 0, 1);
    if (!fs.mode || (fin.phase === "falling" && fs.phase !== "falling")) {
      // Enter (or fall again from a lying / rising body): snapshot the pose this frame shows.
      const fromFall = fs.mode;
      const yaw0 = fromFall ? fs.lastYaw : yawNorm;
      const hd = this.#fallHeading(fin.pose, fin.dir, yaw0);
      fs.pose = fin.pose; fs.heading = hd.heading; fs.yaw0 = yaw0;
      fs.seq = fallSequences(fin.pose, hd.side);
      const snapA = Float64Array.from((fromFall ? fs.last : nA).subarray(0, JOINT_COUNT));
      const snapQ = fromFall ? qmul(qaxis(1, -yaw0, this.#qt), fs.lastQ, new Float64Array(4)) : qaxis(2, out.rootRoll);
      const snapC = new Float64Array(CONTACT_COUNT);
      fs.snapRoll.set((fromFall ? fs.last : nA).subarray(JOINT_COUNT, FV));
      if (inp.grounded) { snapC[0] = snapC[1] = 1; }
      fs.keys = [{ t: 0, angles: snapA, q: snapQ, contact: snapC, yawAdd: 0 }, ...fs.seq.falling];
      // The first fall keys keep the snapshot's stance (stagger, step) on top of their own leg
      // bend, so the planted feet buckle where they stand instead of sliding together.
      const ref = fs.seq.rising[fs.seq.rising.length - 1].angles;
      for (let k = 1; k <= 2 && k < fs.keys.length - 1; k++) {
        const s = k === 1 ? 1 : 0.5;
        for (const lj of LEG_JOINTS) {
          for (const j of [lj.hip, lj.knee, lj.ankle, lj.toe]) fs.keys[k].angles[j] += (snapA[j] - ref[j]) * s;
        }
      }
      if (!fromFall) {
        fs.cx = ncx; fs.cz = ncz;
        fs.last.set(nA); fs.lastQ.set(qN); fs.lastYaw = yawNorm; fs.lastC[0] = ncx; fs.lastC[1] = ncz; fs.lastC[2] = nRootY;
      }
      fs.latched.fill(0);
      fs.handoff = false; fs.exitT = -1; fs.mode = true;
      switched = true;
    } else if (fin.phase !== fs.phase) {
      fs.latched.fill(0);
      switched = true;
    }
    if (switched && fin.phase === "rising") {
      // On hands and knees the body turns to face the rival (the roll-over may have turned it away).
      fs.turnTo = wrapAngle(inp.yaw - (fs.heading + fs.seq.yawAdd));
    }
    fs.phase = fin.phase;
    // 1. Raw pose and heading.
    const seq = fs.seq, rawQ = this.#rawQ, C = fs.contact;
    let yawOut = fs.heading;
    if (fin.phase === "falling") {
      evalKeys(fs.keys, t, A, rawQ, C);
      yawOut = fs.yaw0 + wrapAngle(fs.heading - fs.yaw0) * smoothstep(0, 0.6, t);
    } else if (fin.phase === "down") {
      A.set(seq.lie.angles); rawQ.set(seq.lie.q); C.set(seq.lie.contact);
      // Breathing on the floor: the chest rises, the belly counters, shoulders follow.
      const b = Math.sin(2 * Math.PI * 0.3 * this.#time);
      A[SPINE] += 0.035 * b; A[ABD] -= 0.015 * b; A[JOINT_INDEX.shoulderL] -= 0.03 * b; A[JOINT_INDEX.shoulderR] -= 0.03 * b;
    } else {
      const i = evalKeys(seq.rising, t, A, rawQ, C);
      const ks = seq.rising;
      if (seq.yawAdd !== 0 && ks[i].yawAdd === seq.yawAdd && ks[i + 1].yawAdd === seq.yawAdd) {
        // Rolled over: bake the heading turn into the yaw (world rotation unchanged).
        yawOut = fs.heading + seq.yawAdd;
        qmul(qaxis(1, -seq.yawAdd, this.#qt), rawQ, this.#qw); rawQ.set(this.#qw);
      }
      yawOut += fs.turnTo * smoothstep(seq.turnFrom, seq.turnUntil, t);
    }
    A[16] = A[17] = A[18] = A[19] = 0;
    if (fin.phase === "falling") {
      // Loaded feet keep the stance's abduction (the rolls go with the load: no sideways scuff).
      for (let i = 0; i < 2; i++) { A[16 + i] = fs.snapRoll[i] * C[i]; A[18 + i] = fs.snapRoll[2 + i] * C[i]; }
    } else if (fin.phase === "rising") {
      // Standing up, the legs adduct from their bind abduction to the gait's stance width (feet
      // under the hips, soles level): the stand the gait takes over is the one it would make.
      const s = smoothstep(seq.standFrom, seq.guardAt, t);
      for (let i = 0; i < 2; i++) { const r = -hipRestRollOf(this.geometry, i as Side) * s; A[16 + i] = r; A[18 + i] = -r; }
    }
    const qW = qmul(qaxis(1, yawOut, this.#qt), rawQ, this.#qw);
    // 2. Inertialization of any switch: carry the last output's difference and let it decay.
    if (switched) {
      for (let j = 0; j < FV; j++) fs.off[j] = fs.last[j] - A[j];
      const c = Float64Array.of(-qW[0], -qW[1], -qW[2], qW[3]);
      qmul(fs.lastQ, c, fs.qOff);
      fs.offT = 0;
    }
    if (fs.offT < FALL_BLEND_TIME) {
      const d = 1 - smoothstep(0, FALL_BLEND_TIME, fs.offT);
      for (let j = 0; j < FV; j++) A[j] += fs.off[j] * d;
      const qi = qslerp(Float64Array.of(0, 0, 0, 1), fs.qOff, d, new Float64Array(4));
      const tmp = qmul(qi, qW, new Float64Array(4)); qW.set(tmp);
      fs.offT += h;
    }
    for (let j = 0; j < JOINT_COUNT; j++) A[j] = clamp(A[j], lim.min[j], lim.max[j]);
    // Speed limits (continuity at any clip length): every joint at the blender's maxJointSpeed, the
    // root tilt at FALL_ROOT_SPEED — relative to the last output (a switch is inertialized first).
    {
      const dj = this.blender.maxJointSpeed * h;
      for (let j = 0; j < FV; j++) A[j] = clamp(A[j], fs.last[j] - dj, fs.last[j] + dj);
      const d = Math.abs(fs.lastQ[0] * qW[0] + fs.lastQ[1] * qW[1] + fs.lastQ[2] * qW[2] + fs.lastQ[3] * qW[3]);
      const ang = 2 * Math.acos(Math.min(1, d)), lim2 = FALL_ROOT_SPEED * h;
      if (ang > lim2) { const tmp = qslerp(fs.lastQ, qW, lim2 / ang, new Float64Array(4)); qW.set(tmp); }
    }
    // 3. Body model, contact anchoring, grounding.
    const S = bodySpheres(this.geometry, A, A.subarray(16, 18), A.subarray(18, 20), this.#sph, out.toeOut);
    const v = this.#v3;
    let sw = 0, sx = 0, sz = 0;
    // A loaded FOOT outranks the other contacts (knees, hands, pelvis): the get-up must not slide a
    // planted sole, while a knee or hand may scuff as the weight leaves it.
    const footLoad = Math.min(1, C[0] + C[1]), other = 1 - footLoad;
    for (let c = 0; c < CONTACT_COUNT; c++) {
      // A contact anchors once it is mostly loaded (it latches where it has ARRIVED, not mid-travel).
      const w = smoothstep(0.4, 0.9, c < 2 ? C[c] : C[c] * other);
      this.#contactLocal(S, c, v);
      qrot(qW, v[0], v[1], v[2], v);
      if (w < 0.02) { fs.latched[c] = 0; continue; }
      if (!fs.latched[c]) { fs.latchX[c] = fs.cx + v[0]; fs.latchZ[c] = fs.cz + v[2]; fs.latched[c] = 1; }
      sw += w; sx += w * (fs.latchX[c] - v[0]); sz += w * (fs.latchZ[c] - v[2]);
    }
    if (sw > 0) {
      const k = Math.min(1, sw);
      fs.cx += (sx / sw - fs.cx) * k; fs.cz += (sz / sw - fs.cz) * k;
    }
    // Pull the body under the pelvis (bodyShift, applied by the caller right after this update):
    // the root offset and every latch are body-relative, so they move back by the same shift and
    // the pose stays where it is in the world. Everything below is relative to the MOVED body.
    let bx = inp.x, bz = inp.z;
    {
      this.#contactLocal(S, 6, v);
      qrot(qW, v[0], v[1], v[2], v);
      // No pull in the get-up's hand-off: a moving body would set the gait walking under the stand.
      const k = fin.phase === "rising" && t >= seq.guardAt ? 0 : 1 - Math.exp(-FALL_BODY_PULL * h);
      const px = (fs.cx + v[0]) * k, pz = (fs.cz + v[2]) * k;
      out.bodyShift[0] = px; out.bodyShift[1] = pz;
      fs.cx -= px; fs.cz -= pz; bx += px; bz += pz;
      for (let c = 0; c < CONTACT_COUNT; c++) { fs.latchX[c] -= px; fs.latchZ[c] -= pz; }
    }
    // Ground: the lowest sphere on the floor under it (the body's floor when airborne: a ledge fall).
    const bodyFloor = baseRootY - this.#soleDepth;
    let rootY = -Infinity;
    for (let k = 0; k < SPHERE_COUNT; k++) {
      qrot(qW, S[k * 4], S[k * 4 + 1], S[k * 4 + 2], v);
      const floor = inp.grounded ? inp.groundHeight(bx + fs.cx + v[0], bz + fs.cz + v[2]) : bodyFloor;
      rootY = Math.max(rootY, floor - (v[1] - S[k * 4 + 3]));
    }
    // 4. Hand back to the gait after the guard key (the get-up's last stretch).
    const w = fin.phase === "rising" ? smoothstep(seq.guardAt, 1, t) : 0;
    const yawF = yawOut + wrapAngle(yawNorm - yawOut) * w;
    for (let j = 0; j < FV; j++) A[j] += (nA[j] - A[j]) * w;
    const cx = fs.cx + (ncx - fs.cx) * w, cz = fs.cz + (ncz - fs.cz) * w, ry = rootY + (nRootY - rootY) * w;
    const qF = w > 0 ? qslerp(qW, qN, w, new Float64Array(4)) : qW;
    if (w > 0) {
      // The hand-off blend obeys the same speed limits (a short rise reaches it with the pose lagging).
      const dj = this.blender.maxJointSpeed * h;
      for (let j = 0; j < FV; j++) A[j] = clamp(A[j], fs.last[j] - dj, fs.last[j] + dj);
      const dq = Math.abs(fs.lastQ[0] * qF[0] + fs.lastQ[1] * qF[1] + fs.lastQ[2] * qF[2] + fs.lastQ[3] * qF[3]);
      const ang = 2 * Math.acos(Math.min(1, dq)), lim2 = FALL_ROOT_SPEED * h;
      if (ang > lim2) qF.set(qslerp(fs.lastQ, qF, lim2 / ang, new Float64Array(4)));
    }
    // 5. Output.
    out.angles.set(A.subarray(0, JOINT_COUNT));
    out.hipRoll[0] = A[16]; out.hipRoll[1] = A[17]; out.ankleRoll[0] = A[18]; out.ankleRoll[1] = A[19];
    out.yawOffset = wrapAngle(yawF - inp.yaw);
    qmul(qaxis(1, -yawF, this.#qt), qF, out.rootTilt);
    out.rootRoll = 0;
    out.rootOffsetY = ry - baseRootY;
    out.rootOffsetLateral = cx * Math.cos(yawF) - cz * Math.sin(yawF);
    out.rootOffsetForward = cx * Math.sin(yawF) + cz * Math.cos(yawF);
    out.fallWeight = 1 - w; out.groundBody = 1 - w; out.wideLimits = true;
    if (w < 0.5) {
      for (let i = 0; i < 2; i++) {
        const b = SPHERE.ball[i] * 4, o = out.feet[i];
        qrot(qW, S[b], S[b + 1], S[b + 2], v);
        o.x = bx + fs.cx + v[0]; o.z = bz + fs.cz + v[2]; o.y = rootY + v[1];
        // "Planted" = fully anchored (the contact load is past the anchoring ramp's top, smoothstep 0.4..0.9).
        o.planted = C[i] >= 0.9;
      }
      out.footPlant.left = out.feet[0].planted; out.footPlant.right = out.feet[1].planted;
    }
    fs.last.set(A); fs.lastQ.set(qF); fs.lastYaw = yawF; fs.lastC[0] = cx; fs.lastC[1] = cz; fs.lastC[2] = ry;
    fs.clearance = 0;
  }

  /** Rig-local position of contact c (feet: the sole between heel and ball). */
  #contactLocal(S: Float64Array, c: number, v: Float64Array): void {
    const at = (k: number, w: number) => { v[0] += S[k * 4] * w; v[1] += S[k * 4 + 1] * w; v[2] += S[k * 4 + 2] * w; };
    v[0] = v[1] = v[2] = 0;
    if (c < 2) { at(SPHERE.heel[c], 0.5); at(SPHERE.ball[c], 0.5); }
    else if (c < 4) at(SPHERE.knee[c - 2], 1);
    else if (c < 6) at(SPHERE.hand[c - 4], 1);
    else at(SPHERE.pelvis, 1);
  }

  /** Wave FALL: after the fall input ends, blend the last fall output into the gait's pose (inertialization). */
  #fallExit(h: number, inp: AnimatorInput, baseRootY: number, _yaw: number): void {
    const fs = this.#fs, out = this.output, nA = this.#normA, T = 0.25;
    nA.set(out.angles); nA[16] = out.hipRoll[0]; nA[17] = out.hipRoll[1]; nA[18] = out.ankleRoll[0]; nA[19] = out.ankleRoll[1];
    const yawNorm = inp.yaw + out.yawOffset;
    const ncx = out.rootOffsetLateral * Math.cos(yawNorm), ncz = -out.rootOffsetLateral * Math.sin(yawNorm);
    const qN = qmul(qaxis(1, yawNorm, this.#qt), qaxis(2, out.rootRoll, this.#rawQ), new Float64Array(4));
    if (fs.mode) {
      fs.mode = false; fs.phase = "stand";
      for (let j = 0; j < FV; j++) fs.off[j] = fs.last[j] - nA[j];
      qmul(fs.lastQ, Float64Array.of(-qN[0], -qN[1], -qN[2], qN[3]), fs.qOff);
      fs.offC[0] = fs.lastC[0] - ncx; fs.offC[1] = fs.lastC[1] - ncz; fs.offC[2] = fs.lastC[2] - (baseRootY + out.rootOffsetY);
      fs.exitT = 0;
      if (!fs.handoff) this.gait.reset(inp.x, inp.z, yawNorm, 0);
    }
    if (fs.exitT < 0) return;
    const d = 1 - smoothstep(0, T, fs.exitT);
    fs.exitT += h;
    if (d <= 0) {
      // Done once the speed-limited output has caught up with the gait's pose (no last-frame snap).
      let gap = 0;
      for (let j = 0; j < FV; j++) gap = Math.max(gap, Math.abs(fs.last[j] - nA[j]));
      const dq = Math.abs(fs.lastQ[0] * qN[0] + fs.lastQ[1] * qN[1] + fs.lastQ[2] * qN[2] + fs.lastQ[3] * qN[3]);
      if (gap < 1e-3 && 2 * Math.acos(Math.min(1, dq)) < 1e-3) { fs.exitT = -1; return; }
    }
    // Same speed limits as the fall frames (a clip cut short must not snap back to the gait).
    const dj = this.blender.maxJointSpeed * h, A = this.#fallA;
    for (let j = 0; j < FV; j++) A[j] = clamp(nA[j] + fs.off[j] * d, fs.last[j] - dj, fs.last[j] + dj);
    for (let j = 0; j < JOINT_COUNT; j++) out.angles[j] = clamp(A[j], this.#wide.min[j], this.#wide.max[j]);
    out.hipRoll[0] = A[16]; out.hipRoll[1] = A[17]; out.ankleRoll[0] = A[18]; out.ankleRoll[1] = A[19];
    const qi = qslerp(Float64Array.of(0, 0, 0, 1), fs.qOff, d, new Float64Array(4));
    const qW = qmul(qi, qN, new Float64Array(4));
    {
      const dq = Math.abs(fs.lastQ[0] * qW[0] + fs.lastQ[1] * qW[1] + fs.lastQ[2] * qW[2] + fs.lastQ[3] * qW[3]);
      const ang = 2 * Math.acos(Math.min(1, dq)), lim2 = FALL_ROOT_SPEED * h;
      if (ang > lim2) qW.set(qslerp(fs.lastQ, qW, lim2 / ang, new Float64Array(4)));
    }
    fs.last.set(A); fs.last.set(out.angles.subarray(0, JOINT_COUNT)); fs.lastQ.set(qW);
    // Keep the normal yaw; the carried rotation (incl. any heading difference) rides in the tilt.
    qmul(qaxis(1, -yawNorm, this.#qt), qW, out.rootTilt);
    out.rootRoll = 0;
    const cx = ncx + fs.offC[0] * d, cz = ncz + fs.offC[1] * d;
    out.rootOffsetLateral = cx * Math.cos(yawNorm) - cz * Math.sin(yawNorm);
    out.rootOffsetForward = cx * Math.sin(yawNorm) + cz * Math.cos(yawNorm);
    out.rootOffsetY += fs.offC[2] * d;
    out.fallWeight = d; out.groundBody = 0; out.wideLimits = true;
  }

  /**
   * Height (m, rig-local, relative to the rig origin) of the lowest sole point — heel, ball or
   * toe tip of either foot — for the given final angles and rolls (Rig.legFK3).
   */
  #lowestSole(angles: Float64Array, hipRoll: Float64Array, ankleRoll: Float64Array): number {
    let lo = Infinity;
    for (let i = 0; i < 2; i++) {
      legFK3(this.geometry, angles, i as Side, hipRoll[i], ankleRoll[i], FK3, this.output.toeOut[i]);
      lo = Math.min(lo, FK3.ball[1], FK3.heel[1], FK3.toe[1]);
    }
    return lo;
  }

  /**
   * Smallest height (m) of any sole point (heel, ball, toe tip of both feet) above the ground
   * under it, for the rig origin at world height `rootWorldY` with this frame's roll and lateral
   * shift: world y = rootWorldY + x·sin ρ + y·cos ρ (the rig rolls about its local z).
   */
  #soleClearance(inp: AnimatorInput, yaw: number, rootWorldY: number, angles: Float64Array, hipRoll: Float64Array, ankleRoll: Float64Array): number {
    let worst = Infinity;
    const ox = inp.x + this.#lateral * Math.cos(yaw), oz = inp.z - this.#lateral * Math.sin(yaw);
    for (let i = 0; i < 2; i++) {
      legFK3(this.geometry, angles, i as Side, hipRoll[i], ankleRoll[i], FK3, this.output.toeOut[i]);
      for (let k = 0; k < 3; k++) {
        const pt = k === 0 ? FK3.ball : k === 1 ? FK3.heel : FK3.toe;
        const y = rootWorldY + pt[0] * this.#sinR + pt[1] * this.#cosR;
        localToWorld(ox, oz, yaw, pt[0] * this.#cosR - pt[1] * this.#sinR, pt[2], P2);
        worst = Math.min(worst, y - inp.groundHeight(P2[0], P2[1]));
      }
    }
    return worst;
  }

  /** Cache the root roll and the lateral shift that makes it pivot at the ground (m). */
  #setRoll(totalRoll: number, heightAboveGround: number): void {
    this.#sinR = Math.sin(totalRoll);
    this.#cosR = Math.cos(totalRoll);
    this.#lateral = -heightAboveGround * this.#sinR + this.#swayX;
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
    // Wave X: the foot is turned out by `yaw` about the vertical through the ankle (Rig.legFK3), so
    // the ankle sits `back`·(sin yaw, cos yaw) behind the contact point, not straight behind it —
    // targeting the straight-behind ankle slid a planted ball ~6 mm whenever the body turned over it.
    const yaw = toeOutYaw(g.hipLateral[i], this.output.toeOut[i]);
    ankleFromBall(cY, cZ, pitch, g.soleOffset, forward, ANK);
    const back = cZ - ANK[1];
    ANK[1] = cZ - back * Math.cos(yaw);
    const X = cX - back * Math.sin(yaw) - this.#lateral, Y = ANK[0] - rootY;
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
    const st = this.#style;
    for (let k = 0; k < skill.tracks.length; k++) {
      const tr = skill.tracks[k];
      const j = JOINT_INDEX[tr.joint];
      if (j === undefined) continue;
      vals[j] = clamp(lim.rest[j] + (st ? this.#styledTrack(st, skill, tr, j, t) : trackOffset(tr, t)), lim.min[j], lim.max[j]);
      this.#skillAnimated[j] = 1;
    }
    const follow = 1 - Math.exp(-this.params.skillMaskLambda * h);
    for (let j = 0; j < JOINT_COUNT; j++) mask[j] += (this.#skillAnimated[j] - mask[j]) * follow;
  }

  /**
   * Lane M: a skill track through the four-phase envelope (AnimationCurve.fourPhaseImpulse) at its
   * chain-led time: the weapon shoulder is the reference (it peaks ON hitAt), joints nearer the
   * feet lead by (3 − depth)·chainLag, the elbow trails; the lead ramps in over the first 35 % and
   * out over the last 30 % (t stays monotonic). Amplitude × the style's per-joint jitter. The
   * counter-move is shortened (then dropped) when the strike would outrun SKILL_SPEED_SHARE of the
   * joint speed limit.
   */
  #styledTrack(st: MotionStyle, skill: SkillAnimation, tr: SkillAnimation["tracks"][number], j: number, t: number): number {
    const e = st.eff, D = Math.max(0.05, skill.duration);
    PR4.hold = e.holdTime / D; PR4.settle = e.settleTime / D; PR4.overshoot = e.overshoot;
    PR4.anticipation = e.anticipation; PR4.anticipationShare = SKILL_ANTICIPATION_SHARE;
    const amp = st.jointAmp[j], om = SKILL_SPEED_SHARE * this.blender.maxJointSpeed;
    const A = Math.abs(tr.amplitude) * amp, p = Math.min(0.95, Math.max(0.05, tr.peak));
    if (A * fourPhasePeakRate(p, PR4) / D > om) {
      // (1 + ant)(π/2)·A / ((1 − x)·p·D) = om  ->  x; without room for a counter-move, none.
      const x = 1 - (1 + PR4.anticipation) * (Math.PI / 2) * A / (p * D * om);
      if (x >= 0.05) PR4.anticipationShare = x;
      else { PR4.anticipation = 0; PR4.anticipationShare = 0; }
    }
    const lead = st.jointLead(j) - 2 * e.chainLag;
    const ramp = smoothstep(0, 0.35, t) * (1 - smoothstep(0.7, 1, t));
    return styledTrackOffset(tr, clamp(t + (lead / D) * ramp, 0, 1), PR4, amp);
  }
}
