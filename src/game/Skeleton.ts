export type PoseName = "idle" | "walk" | "attack" | "hit" | "ko" | "skill";

import { TOE_OUT_RAD } from "./anim/FootTurnout.ts";
import { KNEE_OUT_SHARE } from "./anim/KneeOut.ts";
import { poseAt } from "./AnimationCurve.ts";
import type { SkillAnimation } from "./Skills.ts";
import { BalancePlate } from "./Balance.ts";
import { GripSolver, type GripPose, type GripStance } from "./GripStance.ts";
import { BalanceRig, type Stance } from "./BalancePlates.ts";
import { findTransition, StanceAnimator } from "./StanceAnim.ts";
import { armChainPose, solveElbow } from "./PalmWeapon.ts";
import { FaceMorph, type FaceState } from "./FaceMorph.ts";

import { effectiveLimits } from "./PartHierarchy.ts";
import type { JointId } from "./BodyGraph.ts";
import { boundsFor, raceScaled } from "./AxisEnvelope.ts";
import { RACE_SILHOUETTE } from "./BodyProfile.ts";
import { JOINT_ORDER } from "./anim/Rig.ts"; // Rig imports only TYPES from here: no runtime cycle
import { WIDE_JOINT_LIMITS } from "./anim/FallMotion.ts"; // pure; imports Rig + MathCore only
import { AGILITY_REFERENCE, agilityLimits } from "./anim/AgilityLimits.ts"; // pure; type-only import back

/**
 * Which side-independent constraint joint each bone answers to. Left and right share one
 * constraint: the coupling chain is about how far a joint may travel, not which side it is
 * on. Toes and the head have no body joint of their own and keep their own static limits.
 */
const BONE_JOINT: Record<JointName, JointId | null> = {
  spine: "ribcage", abdomen: "waist", neck: "neckJoint", head: null,
  shoulderL: "shoulder", shoulderR: "shoulder",
  elbowL: "elbow", elbowR: "elbow",
  hipL: "hip", hipR: "hip",
  kneeL: "knee", kneeR: "knee",
  ankleL: "ankle", ankleR: "ankle",
  toeL: null, toeR: null,
};

export type JointName =
  | "spine" | "abdomen" | "neck" | "head"
  | "shoulderL" | "shoulderR" | "elbowL" | "elbowR"
  | "hipL" | "hipR" | "kneeL" | "kneeR"
  | "ankleL" | "ankleR" | "toeL" | "toeR";

export interface Joint {
  name: JointName;
  axis: "x" | "y" | "z";
  min: number;
  max: number;
  rest: number;
  angle: number;
  target: number;
}

export interface Pose {
  targets: Partial<Record<JointName, number>>;
  limits?: Partial<Record<JointName, { min: number; max: number }>>;
}

export class Skeleton {
  #joints: Map<JointName, Joint>;
  #base: Map<JointName, { min: number; max: number; rest: number }>;
  #poses: Record<PoseName, Pose>;
  pose: PoseName = "idle";
  /** Animator output (JOINT_ORDER) taken as-is each update; null = classic pose easing. */
  #driven: Float64Array | null = null;
  /**
   * Hip abduction / ankle counter-roll per leg [L, R], rad — written by drive(), read by the rig.
   * Wave X: `toeOut` = each foot's turn-out magnitude (rad, + = toes outward, applied about the
   * vertical through the ankle, toward the foot's own side: FootTurnout.ts). It rests at TOE_OUT_RAD, so an undriven
   * skeleton (a preview, a pinned pose) stands with the feet turned out too.
   * Wave Y: `kneeOut` = each knee's outward offset from its hip-ankle line as a share of the leg (KneeOut.ts),
   * rendered as a swivel of the leg about that line with the foot turned back (no sole point moves).
   */
  readonly legRoll = {
    hip: new Float64Array(2), ankle: new Float64Array(2), toeOut: Float64Array.of(TOE_OUT_RAD, TOE_OUT_RAD),
    kneeOut: Float64Array.of(KNEE_OUT_SHARE, KNEE_OUT_SHARE),
  };
  /**
   * Drive the joints from the procedural Animator (src/game/anim). The Animator already
   * smoothed and clamped everything, so the Skeleton's own 14/s easing must not run on
   * top: its ~70 ms lag would slide a planted foot ~18 cm at walking speed. The skill
   * clock (hit timing), kick spring, balance, grip, face and stance transitions keep
   * working. Pass null to return to pose easing.
   */
  drive(
    angles: Float64Array | null, hipRoll?: ArrayLike<number>, ankleRoll?: ArrayLike<number>, toeOut?: ArrayLike<number>,
    kneeOut?: ArrayLike<number>, wide?: boolean,
  ): void {
    this.#driven = angles;
    this.#wide = wide === true;
    if (kneeOut) { this.legRoll.kneeOut[0] = kneeOut[0]; this.legRoll.kneeOut[1] = kneeOut[1]; }
    if (hipRoll) { this.legRoll.hip[0] = hipRoll[0]; this.legRoll.hip[1] = hipRoll[1]; }
    if (ankleRoll) { this.legRoll.ankle[0] = ankleRoll[0]; this.legRoll.ankle[1] = ankleRoll[1]; }
    if (toeOut) { this.legRoll.toeOut[0] = toeOut[0]; this.legRoll.toeOut[1] = toeOut[1]; }
  }
  /** True while the Animator owns the joints. */
  isDriven(): boolean { return this.#driven !== null; }
  /**
   * Wave FALL: the driven angles come from a fall / lying / get-up pose (AnimatorOutput.wideLimits):
   * clamp them to the widened windows (FallMotion.WIDE_JOINT_LIMITS: the KO trunk/knee window, hip
   * flexion 1.9) instead of the standing base limits. Only ever set through drive(..., wide).
   */
  #wide = false;
  /** True while the driven pose uses the widened fall windows. */
  get wideLimits(): boolean { return this.#wide; }
  /**
   * Active skill animation, if any: normalised progress runs 0 -> 1. `stopIn` (s, null = none):
   * the clock is frozen and the skill ends when it runs out (stopSkillAfter: a weapon contact).
   */
  #skill: { anim: SkillAnimation; t: number; fired: boolean; holdAt: number | null; stopIn: number | null } | null = null;
  /** Physics offset per joint (rad), its rate, and how much it moved this frame. */
  #kick = new Map<JointName, { off: number; vel: number; offDelta: number }>();
  /** Centre-of-mass balance: the damped sway that brings the body back upright. */
  readonly balance = new BalancePlate();
  /** Weapon grip: the pitch/roll/fist the blade eases toward per stance. */
  readonly grip = new GripSolver();
  /** Three-level balance plates (feet/pelvis/shoulder) -> stance. */
  readonly plates = new BalanceRig();
  /** Stance-transition sub-animator: plays kneel/fall/recover moves. */
  readonly stanceAnim = new StanceAnimator();
  /** Facial morph: eyebrows/eyelids/mouth loop with the combat state. */
  readonly face = new FaceMorph();
  /** The stance the body is currently in, from the balance plates. */
  stance: Stance = "standing";

  constructor(joints: Joint[], poses: Record<PoseName, Pose>) {
    this.#joints = new Map(joints.map((j) => [j.name, j]));
    this.#base = new Map(joints.map((j) => [j.name, { min: j.min, max: j.max, rest: j.rest }]));
    this.#canon = new Map([...this.#base].map(([n, l]) => [n, { ...l }]));
    this.#poses = poses;
    this.setPose("idle");
  }

  /** The reference (agility 500) limit table; #base is it scaled by the body's agility. */
  readonly #canon: Map<JointName, { min: number; max: number; rest: number }>;
  #agility = AGILITY_REFERENCE;
  /** Wave GEN (C-AGI): the body's agility on the generator's 0..1000 scale (500 = reference). */
  get agility(): number { return this.#agility; }
  /**
   * Wave GEN (C-AGI): widen (agile) or narrow (stiff) every joint's window (AgilityLimits.agilityLimits,
   * identity at 500). Call BEFORE the Animator / SwingDriver are built from limits(): they copy the table.
   * The current pose's windows and angles are re-clamped to the new table.
   */
  setAgility(agility: number | null | undefined): void {
    this.#agility = agility === null || agility === undefined || !Number.isFinite(agility) ? AGILITY_REFERENCE : Math.max(0, Math.min(1000, agility));
    const next = agilityLimits(this.#canon, this.#agility);
    for (const [name, l] of next) {
      const b = this.#base.get(name)!;
      b.min = l.min; b.max = l.max; b.rest = l.rest;
    }
    if (this.#skill) return; // the skill owns the joints; setPose would only relabel
    this.setPose(this.pose);
    for (const j of this.#joints.values()) j.angle = clamp(j.angle, j.min, j.max);
  }

  joint(name: JointName): Joint {
    const j = this.#joints.get(name);
    if (!j) throw new Error(`Unknown joint ${name}`);
    return j;
  }

  jointNames(): JointName[] { return [...this.#joints.keys()]; }

  /**
   * Clamp every joint into its COUPLED range for the pose that is currently written.
   *
   * The limits are not static. `effectiveLimits` walks the chain upward and narrows a joint
   * as its parent travels — shoulder -> elbow -> wrist, hip -> knee -> ankle, waist ->
   * ribcage -> neckJoint — so a deeply flexed shoulder genuinely reduces how far the elbow
   * may close. That coupling is what stops a pose from reaching a shape the body could not
   * make, and it is why a limb cannot be driven to an impossible angle by an animation.
   *
   * Each joint is clamped to the INTERSECTION of its own static limits and the coupled
   * range, so coupling can only ever tighten a joint, never loosen it past its own stop.
   * When a `race` is named, the race's trig envelope (AxisEnvelope) tightens the window
   * further; an absent or unknown race leaves the behaviour exactly as it was.
   * Call after the pose is written and before the world matrices are built.
   */
  applyCoupledLimits(race?: string): void {
    const chain: Partial<Record<JointId, number>> = {};
    for (const [name, j] of this.#joints) {
      const id = BONE_JOINT[name];
      if (id && chain[id] === undefined) chain[id] = j.angle;
    }
    for (const [name, j] of this.#joints) {
      const id = BONE_JOINT[name];
      if (!id) continue;
      const coupled = effectiveLimits(id, chain);
      let lo = Math.max(coupled.min, j.min);
      let hi = Math.min(coupled.max, j.max);
      // Race trig envelope (AxisEnvelope): the joint's exact reachable sin range over its
      // whole coupled chain tightens the admissible window. Only for a KNOWN race — a
      // missing or unknown race leaves today's behaviour untouched (no throw, no NaN).
      const env = envelopeWindow(id, j, race);
      if (env) {
        lo = Math.max(lo, env.min);
        hi = Math.min(hi, env.max);
      }
      if (lo <= hi) j.angle = Math.max(lo, Math.min(hi, j.angle));
    }
  }

  /** Joint rest/limit table, the input the animation curves are clamped against. */
  limits(): Map<JointName, { rest: number; min: number; max: number }> {
    return this.#base;
  }

  /** Start a skill animation, replacing any that is running. */
  /** Start a skill animation. `holdAt` pins the progress (QA captures). */
  playSkill(anim: SkillAnimation, holdAt: number | null = null): void {
    this.#skill = { anim, t: holdAt ?? 0, fired: false, holdAt, stopIn: null };
    // The skill owns the joints, so the reported pose is "skill" — otherwise the
    // diagnostics claim "idle" while a swing is on screen.
    this.pose = "skill";
  }

  /** Cancel the running skill (e.g. the fighter was knocked out mid-swing). */
  cancelSkill(): void { this.#skill = null; if (this.pose === "skill") this.pose = "idle"; }

  /**
   * Freeze the running skill's clock NOW and end the skill after `seconds` (lane X2: the blade met
   * a body — the swing stops there instead of passing through, then the arm returns to guard).
   */
  stopSkillAfter(seconds: number): void {
    if (this.#skill && this.#skill.stopIn === null) this.#skill.stopIn = Math.max(0, seconds);
  }

  skillProgress(): number | null { return this.#skill ? this.#skill.t : null; }
  /** True while a skill owns the joints. */
  skillHeld(): boolean { return this.#skill !== null; }
  skillAnimation(): SkillAnimation | null { return this.#skill ? this.#skill.anim : null; }

  /**
   * True exactly once per skill, on the frame the animation crosses its hit
   * frame — the moment the strike resolves.
   */
  consumeSkillHit(): boolean {
    if (!this.#skill || this.#skill.fired) return false;
    if (this.#skill.t < this.#skill.anim.hitAt) return false;
    this.#skill.fired = true;
    return true;
  }

  setPose(pose: PoseName): void {
    // A skill owns the joints until it finishes. Return BEFORE touching this.pose,
    // or the reported pose flips back to "idle" mid-swing.
    if (this.#skill) { this.pose = "skill"; return; }
    this.pose = pose;
    const def = this.#poses[pose];
    for (const [name, joint] of this.#joints) {
      const base = this.#base.get(name)!;
      const lim = def.limits?.[name] ?? { min: base.min, max: base.max };
      const target = def.targets[name] ?? base.rest;
      joint.min = lim.min;
      joint.max = lim.max;
      joint.target = clamp(target, lim.min, lim.max);
    }
  }

  update(dt: number): void {
    this.#stepKick(dt);
    this.balance.update(dt);
    this.grip.update(dt);
    this.face.update(dt);
    if (this.#driven) {
      for (let i = 0; i < JOINT_ORDER.length; i++) {
        const name = JOINT_ORDER[i], j = this.#joints.get(name)!, b = this.#base.get(name)!;
        j.target = this.#driven[i];
        const wl = this.#wide ? WIDE_JOINT_LIMITS[name] : undefined;
        j.angle = wl
          ? clamp(j.target + (this.#kick.get(name)?.off ?? 0), Math.min(b.min, wl.min), Math.max(b.max, wl.max))
          : clamp(j.target + (this.#kick.get(name)?.off ?? 0), b.min, b.max);
      }
    }
    // Balance plates -> stance: when the composite tips past a threshold the body
    // changes stance, and a choreographed transition plays it there coherently.
    {
      const sway = this.balance.state();
      // Feed the plates from the body's live tilt (the damped sway) and stance width.
      this.plates.setPlates({ pelvisTilt: sway.offset, shoulderTilt: sway.offset * 0.7 });
      const next = this.plates.update(dt).stance;
      if (next !== this.stance) {
        const tr = findTransition(this.stance, next) ?? findTransition("standing", next) ?? null;
        if (tr) this.stanceAnim.play(tr);
        this.stance = next;
      }
      // Apply the transition's joint targets on top of the pose (sub-animation).
      const pose = this.stanceAnim.update(dt);
      if (pose) {
        for (const [name, angle] of pose) {
          const j = this.#joints.get(name);
          if (j) { j.target = angle; j.angle += (angle - j.angle) * Math.min(1, 10 * dt); }
        }
      }
    }
    if (this.#skill && this.#skill.stopIn !== null) {
      // Contact hold: the curve stays where the blade met the body, then the skill ends.
      this.#skill.stopIn -= dt;
      if (this.#skill.stopIn <= 0) { this.#skill = null; this.pose = "idle"; }
      if (this.#driven) return;
    }
    if (this.#skill) {
      if (this.#driven) {
        // The Animator blends the skill curve itself; keep only the clock here
        // (consumeSkillHit and skillProgress read it).
        if (this.#skill.holdAt === null) this.#skill.t += dt / this.#skill.anim.duration;
        if (this.#skill.t >= 1) { this.#skill = null; this.pose = "idle"; }
        return;
      }
      const { anim } = this.#skill;
      if (this.#skill.holdAt === null && this.#skill.stopIn === null) this.#skill.t += dt / anim.duration;
      const t = Math.min(1, this.#skill.t);
      // The curve drives every animated joint directly, clamped to its limits.
      for (const [joint, angle] of poseAt(anim, t, this.#base)) {
        const j = this.#joints.get(joint)!;
        const lim = this.#base.get(joint)!;
        j.target = angle;
        j.angle = clamp(angle + (this.#kick.get(joint)?.off ?? 0), lim.min, lim.max);
      }
      if (t >= 1) { this.#skill = null; this.pose = "idle"; }
      return;
    }
    if (this.#driven) return;
    const k = 1 - Math.exp(-14 * dt);
    for (const joint of this.#joints.values()) {
      joint.angle += (joint.target - joint.angle) * k;
      joint.angle = clamp(joint.angle + (this.#kick.get(joint.name)?.offDelta ?? 0), joint.min, joint.max);
    }
  }

  /**
   * Physics on the body points. A blow delivers an angular impulse to the upper body
   * that each joint answers as a damped spring on top of whatever pose or skill curve
   * is playing:
   *
   *   θ_j = clamp( θ_pose + φ_j , min_j, max_j )
   *   φ_j'' = −k·φ_j − c·φ_j'          k = 120 s⁻², c = 2ζ√k, ζ = 0.35
   *   impulse:  φ_j' += ω · w_j,       ω = J / (m_d · L)   (rad/s)
   *
   * J is the hit's impulse (N·s, Physics.resolveImpact), m_d the defender's mass and
   * L = 0.5 m the lever from hips to chest. So a heavier, faster attacker throws the
   * defender's spine, neck and arms further, and a heavy defender barely rocks.
   * `side` (−1..1) biases the twist toward the struck side.
   */
  applyImpulse(omega: number, side = 0): void {
    for (const [name, w, twist] of KICK_WEIGHTS) {
      const s = this.#kick.get(name) ?? { off: 0, vel: 0, offDelta: 0 };
      s.vel += omega * (w + twist * side);
      this.#kick.set(name, s);
    }
  }

  /** Current physics offset of a joint, radians (0 when at rest). */
  kickOffset(name: JointName): number {
    return this.#kick.get(name)?.off ?? 0;
  }

  /** Set the weapon stance the grip should ease toward (rest/thrust/guard/swing). */
  setGripStance(stance: GripStance): void {
    this.grip.setStance(stance);
    // The arm chain follows the weapon: a thrust extends the arm toward the target,
    // a guard tucks it, and the elbow bend comes from the two-point-IK chain model
    // (armChainPose) so the fist, palm, elbow and shoulder stay coherent.
    const reach = stance === "thrust" ? { x: 0.1, y: 1.3, z: 0.85 } // arm extended forward
      : stance === "guard" ? { x: 0.15, y: 1.5, z: 0.35 }            // arm raised, tucked
      : { x: 0.1, y: 1.2, z: 0.4 };                                  // rest / swing
    const pose = armChainPose(reach);
    const elbow = this.#joints.get("elbowR");
    if (elbow) elbow.target = clamp(elbow.rest - pose.elbowBend * 0.6, elbow.min, elbow.max);
    // Two-point IK: solve the elbow position for the palm target. When the palm is
    // out of reach the arm must straighten (bend toward 0); when it's reachable the
    // elbow holds the bend from armChainPose. solveElbow returns null on out-of-reach.
    const shoulderAt = { x: -0.44, y: 1.74, z: 0 }; // right-shoulder root (rig local)
    const solved = solveElbow(shoulderAt, reach, { x: 0, y: -1, z: 0 });
    if (solved === null && elbow) elbow.target = clamp(elbow.rest - 0.05, elbow.min, elbow.max);
  }
  /** Set the combat face state (idle/attack/hit/ko/block) the morph follows. */
  setFaceState(state: FaceState): void { this.face.setState(state); }
  /** The current grip pose (pitch/roll/fist) for the rig to apply. */
  gripPose(): GripPose { return this.grip.pose(); }

  #stepKick(dt: number): void {
    const k = KICK_STIFFNESS, c = 2 * KICK_DAMPING * Math.sqrt(KICK_STIFFNESS);
    // Sub-step so a long frame cannot make the stiff spring explode.
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (const [name, s] of this.#kick) {
      const before = s.off;
      for (let i = 0; i < n; i++) {
        s.vel += (-k * s.off - c * s.vel) * h;
        s.off += s.vel * h;
      }
      s.offDelta = s.off - before;
      if (Math.abs(s.off) < 1e-4 && Math.abs(s.vel) < 1e-3) this.#kick.delete(name);
    }
  }
}

/** Spring constants of the hit response (see applyImpulse). */
export const KICK_STIFFNESS = 120;
export const KICK_DAMPING = 0.35;
/** [joint, weight, twist-with-side]: the spine takes most, the arms flail. */
const KICK_WEIGHTS: [JointName, number, number][] = [
  ["spine", 0.55, 0], ["abdomen", 0.3, 0], ["neck", 0.45, 0], ["head", 0.35, 0],
  ["shoulderL", 0.4, -0.25], ["shoulderR", 0.4, 0.25], ["elbowL", 0.2, 0], ["elbowR", 0.2, 0],
];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Cache of the race+joint asin window, so the (expensive) envelope tree is built once. */
const SIN_WINDOW_CACHE = new Map<string, { min: number; max: number } | null>();

/**
 * The angular window a joint's RACE trig envelope allows, or null when there is nothing
 * to apply. Two independent bounds, INTERSECTED so the result can only ever TIGHTEN:
 *   - the reachable sin range over the joint's whole coupled chain (AxisEnvelope.boundsFor),
 *     mapped back to an angle by asin on [-π/2, π/2]; an out-of-range sin bound is clamped,
 *     so an over-scaled envelope can never yield NaN;
 *   - the joint's own limits scaled by the race's reach (AxisEnvelope.raceScaled) — a wider,
 *     longer-limbed body widens the interval, a thin one narrows it; intersecting a widened
 *     interval is a no-op because the static stop already dominates it.
 * Returns null for an absent or unknown race, so the caller keeps its static behaviour.
 */
function envelopeWindow(id: JointId, j: Joint, race: string | undefined): { min: number; max: number } | null {
  if (!race || !(race in RACE_SILHOUETTE)) return null;
  const key = `${race}|${id}`;
  let win = SIN_WINDOW_CACHE.get(key);
  if (win === undefined) {
    const sin = boundsFor(id, "x", race);
    const lo = Math.asin(Math.max(-1, Math.min(1, sin.min)));
    const hi = Math.asin(Math.max(-1, Math.min(1, sin.max)));
    win = Number.isFinite(lo) && Number.isFinite(hi) ? { min: lo, max: hi } : null;
    SIN_WINDOW_CACHE.set(key, win);
  }
  if (!win) return null;
  const reach = raceScaled({ min: j.min, max: j.max }, race);
  const min = Math.max(win.min, reach.min);
  const max = Math.min(win.max, reach.max);
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

function j(name: JointName, axis: "x" | "y" | "z", min: number, max: number, rest: number): Joint {
  return { name, axis, min, max, rest, angle: rest, target: rest };
}

export function defaultHumanoid(agility?: number | null): Skeleton {
  const joints: Joint[] = [
    j("spine", "x", -0.6, 0.6, 0),
    j("abdomen", "x", -0.5, 0.5, 0),
    j("neck", "x", -0.5, 0.5, 0),
    j("head", "x", -0.5, 0.5, 0),
    j("shoulderL", "x", -2.4, 0.6, 0),
    j("shoulderR", "x", -2.4, 0.6, 0),
    j("elbowL", "x", -2.6, 0.0, -0.25),
    j("elbowR", "x", -2.6, 0.0, -0.25),
    j("hipL", "x", -1.2, 1.2, 0),
    j("hipR", "x", -1.2, 1.2, 0),
    j("kneeL", "x", -2.4, 0.0, -0.3),
    j("kneeR", "x", -2.4, 0.0, -0.3),
    j("ankleL", "x", -0.8, 0.6, 0),
    j("ankleR", "x", -0.8, 0.6, 0),
    j("toeL", "x", -0.7, 0.4, 0),
    j("toeR", "x", -0.7, 0.4, 0),
  ];
  const poses: Record<PoseName, Pose> = {
    idle: { targets: {} },
    // "skill" is never read: a skill animation drives the joints directly, and the
    // pose name only exists so diagnostics report the truth.
    skill: { targets: {} },
    walk: {
      targets: {
        hipL: 0.55, hipR: -0.55, kneeL: -0.5, kneeR: -0.5,
        ankleL: -0.2, ankleR: -0.2, toeL: 0.15, toeR: 0.15,
        shoulderL: -0.45, shoulderR: 0.45,
      },
    },
    attack: { targets: { shoulderR: -1.7, elbowR: -0.3, spine: -0.2, abdomen: -0.15, neck: 0.15, hipL: -0.2, hipR: 0.2 } },
    hit: { targets: { spine: 0.5, abdomen: 0.35, neck: 0.25, head: 0.3, shoulderL: -1.0, shoulderR: -1.0, hipL: -0.15, hipR: -0.15 } },
    ko: {
      targets: {
        spine: -0.8, abdomen: -0.6, neck: -0.5, head: -0.55,
        shoulderL: -1.6, shoulderR: -1.6, hipL: -0.4, hipR: -0.4, kneeL: -0.6, kneeR: -0.6,
        ankleL: -0.5, ankleR: -0.5,
      },
      limits: { spine: { min: -1.5, max: 0.8 }, abdomen: { min: -1.3, max: 0.6 }, neck: { min: -1.2, max: 0.5 }, kneeL: { min: -2.6, max: 0.0 }, kneeR: { min: -2.6, max: 0.0 } },
    },
  };
  const sk = new Skeleton(joints, poses);
  // Wave GEN (C-AGI): an absent agility (or the reference 500) leaves every limit exactly as above.
  if (agility !== undefined && agility !== null && agility !== AGILITY_REFERENCE) sk.setAgility(agility);
  return sk;
}
