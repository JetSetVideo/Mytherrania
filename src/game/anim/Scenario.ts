// Scripted runs of the animator, for QA (lane C, R04): the tests and the numeric report drive
// the Animator through the same sequences the engine produces and measure what the rig would
// render. Pure module (no Three.js, no DOM). Allocation happens per RUN, not per frame of the
// animator itself (the result arrays are sized up front).
//
// Measures, per frame: every joint's angular speed |Δθ| / dt (rad/s), joint-limit violations,
// the contact error of each planted foot (distance of its lowest sole point from the ground,
// m), and per stance the x/z slide of the loaded contact point (DriftTracker).

import { clamp } from "../../core/MathCore.ts";
import { lungeAt } from "../AnimationCurve.ts";
import type { SkillAnimation } from "../Skills.ts";
import type { Animator, AnimatorOutput } from "./Animator.ts";
import type { GroundHeightFn } from "./FootIK.ts";
import { DriftTracker, footWorld, newFootWorld, type RigPlacement, SeamTracker } from "./Measure.ts";
import { JOINT_COUNT, LEG_JOINTS, type Side, standingSoleDepth } from "./Rig.ts";

/**
 * What a scenario needs from a weapon-swing runtime (combat/SwingDriver satisfies it): started at
 * a segment's first frame, advanced every frame BEFORE the animator, its step moves the body
 * along the facing and its yaw turns the rig (Engine.#updatePose does the same).
 */
export interface SwingLike {
  readonly active: boolean;
  begin(distance: number, cooldown: number, variant?: number): void;
  advance(dt: number): void;
  attackPose(): Float64Array | null;
  takeStep(): number;
  yaw(): number;
  /** Optional lane M leg drive 0..1 (AnimatorInput.attackDrive). */
  legDrive?(): number;
}

/** One segment of a scripted run. */
export interface ScenarioSegment {
  /** Segment length, s. */
  duration: number;
  /** Target horizontal speed, m/s, approached at the scenario's acceleration. */
  speed: number;
  /** Direction of travel relative to the facing, rad (default 0 = forward). */
  moveDirLocal?: number;
  /** Yaw rate held during the segment, rad/s (default 0). */
  turnRate?: number;
  hit?: boolean;
  attack?: boolean;
  block?: boolean;
  ko?: boolean;
  engaged?: boolean;
  /** Default true. */
  grounded?: boolean;
  /** A skill started at the segment's first frame; its lunge moves the body like the engine does. */
  skill?: SkillAnimation;
  /** A weapon swing started at the segment's first frame against a target `distance` m ahead. */
  swing?: { driver: SwingLike; distance: number; cooldown: number; variant?: number };
  label?: string;
}

/** How to run a scenario. */
export interface ScenarioOptions {
  /** Frame rate, Hz. */
  hz: number;
  /** Largest change of speed per second, m/s² (engine player walk: 6.5 / 0.12 ≈ 54). */
  accel: number;
  /** Ground height under any world (x, z). Default: flat at 0. */
  ground?: GroundHeightFn;
  /** Start position and yaw. Default origin, yaw 0 (facing +z). */
  x0?: number;
  z0?: number;
  yaw0?: number;
  /** Optional per-frame hook (time in s, the animator's output, the rig placement). */
  onFrame?: (t: number, out: AnimatorOutput, rig: RigPlacement) => void;
  /** Optional hook before each animator update (time in s): set live stats, styles, … */
  beforeFrame?: (t: number, an: Animator) => void;
  /**
   * Optional yaw offset (rad) added to the facing at time t (s) — e.g. an idle fighter whose rig
   * keeps facing a rival that sways (Engine.#updatePose aims the rig at the rival every frame).
   */
  yawOffset?: (t: number) => number;
  /**
   * Wave V lane P: drive the animator like the PATCHED engine — it honours AnimatorOutput.yawOffset
   * (the idle facing hold), so the rig is placed at yaw + yawOffset. Default false (today's engine).
   */
  holdFacing?: boolean;
}

/** What a run measured. Units: rad, rad/s, m. */
export interface ScenarioResult {
  frames: number;
  dt: number;
  /** |Δθ| / dt per frame (from the 2nd frame) and joint, row-major [frame * JOINT_COUNT + j]. */
  jointSpeed: Float64Array;
  /** Largest |Δθ| in one frame, per joint, rad. */
  maxStep: Float64Array;
  /** Frames × joints whose angle left [min, max] (should be 0). */
  limitViolations: number;
  /** Per stance, both feet: the slide of the loaded contact point(s), m. */
  drift: number[];
  /** Per stance, both feet: the slide of the ball alone (the pivot of a turn), m. */
  driftBall: number[];
  /** Per planted frame and foot: |lowest sole point - ground|, m. */
  soleError: number[];
  /** Pelvis drop per frame, m. */
  pelvisDrop: number[];
  /** Frames × feet the GAIT held planted (on the ground, gait owning the legs: grounded, no skill/KO/air). */
  gaitPlantedFrames: number;
  /** Of those, how many the animator could honestly report planted (AnimatorOutput.feet[i].planted). */
  honestPlantedFrames: number;
  /** Angles on the last frame. */
  finalAngles: Float64Array;
  /** Joint-frames the blender's angular speed limit shortened during this run. */
  speedLimited: number;
  /** Lowest sole point (heel, ball, toe tip of either foot) above the ground over the run, m (< 0 = under the floor). */
  soleMin: number;
  /** Largest |Δθ| / dt per joint over the run, rad/s. */
  peakSpeed: Float64Array;
  /** Velocity jumps, gait-cycle seams (SeamTracker over the final angles and the gait phase). */
  seams: SeamTracker;
  /** Per swing that ended: time (s) and the largest velocity jump (rad/s) in the 4 frames after its end. */
  swingEnds: { t: number; velJump: number }[];
}

const FLAT: GroundHeightFn = () => 0;

/**
 * The fastest a joint may LEGITIMATELY turn, rad/s — anything faster in one frame is a pop.
 * Two sources, the larger wins:
 *   gait:  a joint sweeping its whole range R within the fastest swing T (minSwingTime) along a
 *          half-sine velocity profile peaks at (π/2)·R/T;
 *   skill: a curve track amplitude A·impulse(t, p) over duration D rises on a quarter sine in
 *          p·D and falls on a quarter cosine in (1-p)·D, peaking at (π/2)·|A| / (min(p,1-p)·D);
 *          its wobble W·sin(2πf t)·e^(-kt) adds at most 2π·f·|W| / D.
 * `ranges` are the joints' max - min (rad).
 */
export function derivedSpeedBound(ranges: ArrayLike<number>, minSwingTime: number, skills: readonly SkillAnimation[]): number {
  let range = 0;
  for (let j = 0; j < ranges.length; j++) range = Math.max(range, ranges[j]);
  let omega = (Math.PI / 2) * range / minSwingTime;
  for (const anim of skills) {
    for (const tr of anim.tracks) {
      const p = Math.min(0.95, Math.max(0.05, tr.peak));
      const curve = (Math.PI / 2) * Math.abs(tr.amplitude) / (Math.min(p, 1 - p) * anim.duration);
      const wobble = tr.wobbleAmp ? 2 * Math.PI * (tr.wobbleFreq ?? 3) * Math.abs(tr.wobbleAmp) / anim.duration : 0;
      omega = Math.max(omega, curve + wobble);
    }
  }
  return omega;
}

/** Total duration of a scenario, s. */
export function scenarioDuration(segs: readonly ScenarioSegment[]): number {
  let t = 0;
  for (const s of segs) t += s.duration;
  return t;
}

/** Drive `an` through `segs` and measure. The animator is reset at the start position. */
export function runScenario(an: Animator, segs: readonly ScenarioSegment[], opt: ScenarioOptions): ScenarioResult {
  const dt = 1 / opt.hz;
  const ground = opt.ground ?? FLAT;
  const soleDepth = standingSoleDepth(an.geometry);
  const total = Math.round(scenarioDuration(segs) * opt.hz);
  let x = opt.x0 ?? 0, z = opt.z0 ?? 0, yaw = opt.yaw0 ?? 0, speed = 0;
  an.reset(x, z, yaw);
  const limitedBefore = an.blender.speedLimited;
  const res: ScenarioResult = {
    frames: total, dt, jointSpeed: new Float64Array(Math.max(0, total - 1) * JOINT_COUNT),
    maxStep: new Float64Array(JOINT_COUNT), limitViolations: 0, drift: [], driftBall: [], soleError: [],
    gaitPlantedFrames: 0, honestPlantedFrames: 0, speedLimited: 0, pelvisDrop: [],
    finalAngles: new Float64Array(JOINT_COUNT), soleMin: Infinity, peakSpeed: new Float64Array(JOINT_COUNT),
    seams: new SeamTracker(JOINT_COUNT), swingEnds: [],
  };
  let swingSeg = -1, swingWas = false, endWatch = -1, endT = 0, endJump = 0, lastRigYaw = yaw;
  const prev = new Float64Array(JOINT_COUNT);
  const trackers = [new DriftTracker(), new DriftTracker()];
  const fw = newFootWorld();
  const rig: RigPlacement = { x, y: 0, z, yaw, roll: 0, lateral: 0 };
  let seg = 0, segStart = 0;
  for (let f = 0; f < total; f++) {
    const t = f * dt;
    while (seg < segs.length - 1 && t >= segStart + segs[seg].duration - 1e-9) { segStart += segs[seg].duration; seg++; }
    const s = segs[seg];
    const sinceSeg = t - segStart;
    speed += clamp(s.speed - speed, -opt.accel * dt, opt.accel * dt);
    const dir = yaw + (s.moveDirLocal ?? 0);
    x += Math.sin(dir) * speed * dt;
    z += Math.cos(dir) * speed * dt;
    yaw += (s.turnRate ?? 0) * dt;
    // A weapon swing: begin on the segment's first frame, advance before the animator, step the
    // body toward the target (along the facing) and turn the rig by its aim + twist yaw.
    const drv = s.swing?.driver ?? null;
    if (s.swing && swingSeg !== seg) { swingSeg = seg; s.swing.driver.begin(s.swing.distance, s.swing.cooldown, s.swing.variant ?? 0); }
    let st = 0;
    if (drv) {
      drv.advance(dt);
      st = drv.takeStep();
      x += Math.sin(yaw) * st;
      z += Math.cos(yaw) * st;
    }
    const rigYaw = yaw + (drv ? drv.yaw() : 0) + (opt.yawOffset ? opt.yawOffset(t) : 0);
    // With a swing the engine MEASURES the speed from positions (locomotion + step-in) and the
    // travel direction relative to the rig's (aimed) yaw: Engine.#updatePose.
    let speedIn = speed, dirIn = s.moveDirLocal ?? 0;
    if (drv) {
      const vx = Math.sin(dir) * speed + Math.sin(yaw) * st / dt, vz = Math.cos(dir) * speed + Math.cos(yaw) * st / dt;
      speedIn = Math.hypot(vx, vz);
      if (speedIn > 1e-3) { const d = Math.atan2(vx, vz) - rigYaw; dirIn = Math.atan2(Math.sin(d), Math.cos(d)); } else dirIn = 0;
    }
    // A skill: progress = elapsed / duration; its lunge moves the body along the facing.
    let skill: SkillAnimation | null = null, progress = 0;
    if (s.skill && sinceSeg < s.skill.duration) {
      skill = s.skill;
      progress = sinceSeg / s.skill.duration;
      const step = lungeAt(s.skill, Math.min(1, (sinceSeg + dt) / s.skill.duration)) - lungeAt(s.skill, progress);
      x += Math.sin(yaw) * step;
      z += Math.cos(yaw) * step;
    }
    const gy = ground(x, z);
    opt.beforeFrame?.(t, an);
    const out = an.update(dt, {
      x, z, yaw: rigYaw, rootY: gy + soleDepth, speed: speedIn, moveDirLocal: dirIn,
      turnRate: f > 0 ? (rigYaw - lastRigYaw) / dt : s.turnRate ?? 0,
      grounded: s.grounded ?? true, hit: !!s.hit, attack: !!s.attack || (drv ? drv.active : false), block: !!s.block, ko: !!s.ko,
      attackPose: drv ? drv.attackPose() : null, attackDrive: drv?.legDrive ? drv.legDrive() : 0,
      engaged: !!s.engaged, skill, skillProgress: progress, groundHeight: ground,
      honoursYawOffset: !!opt.holdFacing,
    });
    lastRigYaw = rigYaw;
    rig.x = x; rig.z = z; rig.yaw = rigYaw + (opt.holdFacing ? out.yawOffset : 0); rig.y = gy + soleDepth + out.rootOffsetY;
    rig.roll = out.rootRoll; rig.lateral = out.rootOffsetLateral;
    opt.onFrame?.(t, out, rig);
    const a = out.angles, lim = an.limits;
    for (let j = 0; j < JOINT_COUNT; j++) {
      if (a[j] < lim.min[j] - 1e-9 || a[j] > lim.max[j] + 1e-9) res.limitViolations++;
      if (f > 0) {
        const d = Math.abs(a[j] - prev[j]);
        res.jointSpeed[(f - 1) * JOINT_COUNT + j] = d / dt;
        if (d > res.maxStep[j]) res.maxStep[j] = d;
        if (d / dt > res.peakSpeed[j]) res.peakSpeed[j] = d / dt;
      }
    }
    prev.set(a);
    res.seams.sample(a, dt, an.gait.moving > 0.5 && !skill && !(drv && drv.active) ? out.phase : Number.NaN);
    const swinging = drv ? drv.active : false;
    if (swingWas && !swinging) { endWatch = 4; endT = t; endJump = 0; }
    swingWas = swinging;
    if (endWatch > 0) {
      endJump = Math.max(endJump, res.seams.lastJump);
      if (--endWatch === 0) res.swingEnds.push({ t: endT, velJump: endJump });
    }
    res.pelvisDrop.push(out.pelvisDrop);
    for (let i = 0 as Side; i < 2; i = (i + 1) as Side) {
      footWorld(an.geometry, a, i, rig, fw, out.hipRoll[i], out.ankleRoll[i], out.toeOut[i]);
      const gb = ground(fw.ballX, fw.ballZ), gh = ground(fw.heelX, fw.heelZ);
      const planted = out.feet[i].planted;
      if (an.gait.feet[i].planted && (s.grounded ?? true) && !skill && !s.ko && an.blender.baseAuthority(LEG_JOINTS[i].hip) > 0.98) {
        res.gaitPlantedFrames++;
        if (planted) res.honestPlantedFrames++;
      }
      trackers[i].sample(planted, fw, gb, gh);
      res.soleMin = Math.min(res.soleMin, fw.ballY - gb, fw.heelY - gh, fw.toeY - ground(fw.toeX, fw.toeZ));
      if (planted) res.soleError.push(Math.min(Math.abs(fw.ballY - gb), Math.abs(fw.heelY - gh)));
    }
  }
  for (const tr of trackers) { tr.flush(); res.drift.push(...tr.perStep); res.driftBall.push(...tr.perStepBall); }
  res.finalAngles.set(an.output.angles);
  res.speedLimited = an.blender.speedLimited - limitedBefore;
  return res;
}
