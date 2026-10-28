// Lane X2: the per-fighter swing runtime the engine (and the QA harness) drive every frame. Pure
// module (no THREE): it turns a WeaponSpec into a swing setup (kind, timing source, grip mode,
// reach), plays a SwingPlayer and hands out what each engine stage needs:
//   before the Animator   attackPose()  — the attack layer's dense pose; yaw() — aim + twist (rad)
//   body motion           takeStep()    — this frame's step-in (m) along the line to the target
//   after rig.update      gripPitch()/gripRoll() — the wrist that holds the swing's blade angle
// See src/game/anim/Swing.ts for the vocabulary (arm plane, blade angle, phases, contact hold).

import type { WeaponSpec } from "./contracts.ts";
import { preferredGrip } from "../game/weapons/Generate.ts";
import { profileTerms } from "../game/weapons/Profile.ts";
import type { JointLimitTable } from "../game/anim/Rig.ts";
import {
  AIM_PATTERN, type AimLine, aimYawForLine, type ArmGeometry, engageDistance, GUARD_KEY, gripPitchFor, newSwingSample, planarAimLine, stepInFor,
  strikeDuration, sweetDistance,
  SWING_SHAPES, type SwingKind, swingKindOf, SwingPlayer, swingPose, type SwingShape, swingTiming, swingWindow,
} from "../game/anim/Swing.ts";
import { lerp } from "../core/MathCore.ts";
import { REST_GRIP } from "../game/GripStance.ts";

/**
 * The natural hammer grip, rad of wrist pitch: the blade leaves the fist on the thumb side at a
 * right angle to the forearm (lane X: with it the skill swings never cut their holder and land on
 * chest/head instead of thigh/hand).
 */
export const HAMMER_GRIP = 1.6;
/**
 * How much a skill's grip stance (GripStance: thrust −1.5, swing −0.5…−1.35, guard −0.12, rest
 * −0.35, authored for the legacy mesh) turns the blade from the hammer grip: a thrust stance
 * (−1.15 from rest) lays the blade along the forearm (HAMMER_GRIP + 1.15 ≈ 2.75 rad).
 */
export const SKILL_STANCE_GAIN = 1;

/** Wrist pitch during a skill: the hammer grip turned by the stance's offset from rest. */
export function skillGripPitch(stancePitch: number): number {
  return HAMMER_GRIP + SKILL_STANCE_GAIN * (REST_GRIP.pitch - stancePitch);
}

/** Everything fixed about one fighter's swing for one weapon + body. */
export interface SwingSetup {
  kind: SwingKind;
  shape: SwingShape;
  /** Strike-phase duration, s: the blade arc at the weapon's ω, or its thrust time (Swing.strikeDuration). */
  strike: number;
  /** The holder's arm (thrust IK, reach). */
  arm: ArmGeometry;
  /** Reverse ("ice-pick") grip: the weapon frame is turned π in the hand. */
  reverse: boolean;
  twoHanded: boolean;
  /** Tip distance from the main grip, m (largest feature y). */
  tip: number;
  /** Sweet distance and engage distance, m centre to centre (Swing.sweetDistance / engageDistance). */
  sweet: number;
  engage: number;
  /**
   * How far up the haft the hands may slide (the weapon's "choke" grip point, m along +y; 0 when it
   * has none): a polearm pressed closer than its sweet distance (beyond the half step back) chokes
   * up, so the point meets the body at speed instead of the haft at rest.
   */
  choke: number;
  /**
   * The blade's line at mid-strike in the body frame (Swing.AimLine), which the aim yaw turns onto
   * the target. Default: the planar estimate; the engine replaces it with the rig's measured line
   * (combat/SwingRig.measureAimLine), which includes the shoulder's display roll.
   */
  aimLine: AimLine;
}

/** Tip distance of a weapon from its main grip, m: the farthest strike-feature point along +y. */
export function weaponTip(spec: WeaponSpec): number {
  let tip = 0;
  for (const f of spec.features) for (const p of f.points) tip = Math.max(tip, p[1] + (f.kind === "head" ? f.radius : 0));
  return tip > 0 ? tip : spec.length;
}

/** The swing setup of a weapon in a body's hands (see SwingSetup). */
export function swingSetupFor(spec: WeaponSpec, arm: ArmGeometry): SwingSetup {
  const grip = preferredGrip(spec), terms = profileTerms(spec, grip);
  const kind = swingKindOf(terms.mix, spec.weaponClass, spec.hands);
  const shape = SWING_SHAPES[kind], tip = weaponTip(spec);
  const sweet = sweetDistance(shape, arm, tip);
  return {
    kind, shape, strike: strikeDuration(shape, terms.omega, terms.thrustTime), arm, reverse: grip === "reverse",
    twoHanded: terms.handsUsed === 2, tip, sweet, engage: engageDistance(sweet), aimLine: planarAimLine(arm, tip),
    choke: Math.max(0, ...spec.grips.filter((g) => g.id === "choke").map((g) => g.y)),
  };
}

/** One fighter's swing runtime (module comment). Allocates nothing per frame. */
export class SwingDriver {
  readonly setup: SwingSetup;
  readonly player = new SwingPlayer();
  readonly sample = newSwingSample();
  readonly #limits: JointLimitTable;
  readonly #pose: Float64Array;
  #stepTaken = 0;
  /** This swing's choke (m up the haft), faded in and out with the swing's weight. */
  #choke = 0;

  constructor(setup: SwingSetup, limits: JointLimitTable) {
    this.setup = setup;
    this.#limits = limits;
    this.#pose = new Float64Array(limits.rest.length);
  }

  /** True while a swing plays (including its contact hold and rebound). */
  get active(): boolean { return this.player.active; }

  /**
   * Start a swing against a target `distance` m away; `cooldown` (s) bounds the swing's length;
   * `variant` (the swing count) picks the aim line from AIM_PATTERN.
   */
  begin(distance: number, cooldown: number, variant = 0): void {
    const s = this.setup, step = stepInFor(distance, s.sweet);
    // Closer than the half step back can fix: slide the hands up the haft (choke) by the rest.
    this.#choke = Math.min(s.choke, Math.max(0, s.sweet - distance + step));
    const lateral = s.shape.aimLateral * AIM_PATTERN[Math.abs(Math.trunc(variant)) % AIM_PATTERN.length];
    this.player.begin(s.shape, swingTiming(s.strike, cooldown), step, aimYawForLine(s.aimLine, distance - step, lateral), s.twoHanded, s.arm);
    this.#stepTaken = 0;
    this.player.sample(this.sample);
  }

  /** Advance the swing clock by dt and refresh the sample. */
  advance(dt: number): void {
    if (!this.player.active) return;
    this.player.advance(dt);
    this.player.sample(this.sample);
  }

  /** Stop the swing now (knock-out, a skill takes over). */
  cancel(): void { this.player.cancel(); this.sample.weight = 0; }

  /** True while the blade may land (the strike window, not frozen by a contact). */
  striking(): boolean { return this.player.striking(); }

  /** Seconds since the press (frozen at the contact while holding). */
  get clock(): number { return this.player.clock; }

  /** The strike window in seconds since the press. */
  window(): { start: number; end: number } { return swingWindow(this.player.timing, this.setup.shape.windowLead); }

  /** Freeze at fraction u of the last frame (a contact); returns the frozen clock. */
  freeze(u: number): number { return this.player.freeze(u); }

  /** True once a contact froze this swing. */
  get struck(): boolean { return this.player.frozenAt !== null; }

  /** Dense attack-layer pose for the Animator, or null when no swing plays. */
  attackPose(): Float64Array | null {
    if (!this.player.active) return null;
    return swingPose(this.sample, this.setup.twoHanded, this.#limits, this.#pose);
  }

  /** Body yaw to add to the facing this frame, rad: (aim + twist) faded with the swing. */
  yaw(): number {
    return this.player.active ? this.sample.weight * (this.player.aimYaw + this.sample.twist) : 0;
  }

  /** Step (m) gained since the last call — move the body this much toward the target (− = back). */
  takeStep(): number {
    if (!this.player.active) return 0;
    const want = this.player.stepDistance * this.sample.step, d = want - this.#stepTaken;
    this.#stepTaken = want;
    return d;
  }

  /**
   * Wrist pitch (rig grip rotation.x) for the FINAL chest lean (spine) and right shoulder/elbow
   * angles: the carry grip (blade at GUARD_KEY.blade in the world's vertical plane; a reverse grip
   * carries it pointing down) blended toward the swing's blade angle by the swing's weight.
   */
  gripPitch(lean: number, shoulder: number, elbow: number): number {
    const rev = this.setup.reverse;
    const rest = gripPitchFor(rev ? GUARD_KEY.blade + Math.PI : GUARD_KEY.blade, lean, shoulder, elbow, rev);
    if (!this.player.active) return rest;
    return lerp(rest, gripPitchFor(this.sample.blade, lean, shoulder, elbow, rev), this.sample.weight);
  }

  /** Choke (m): slide the weapon this far DOWN through the hands (weapon node y = −choke). */
  chokeOffset(): number { return this.player.active ? this.sample.weight * this.#choke : 0; }

  /** Grip roll (rig grip rotation.z) of the swing, faded with its weight. */
  gripRoll(): number { return this.player.active ? this.sample.weight * this.sample.roll : 0; }
}
