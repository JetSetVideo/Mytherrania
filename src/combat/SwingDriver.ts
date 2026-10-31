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
  AIM_PATTERN, type AimLine, aimYawForLine, type ArmGeometry, armIK, CONTACT_HOLD, COOLDOWN_SHARE, swingDuration, contactFraction, engageDistance, GUARD_KEY, gripPitchFor,
  newSwingProfile, newSwingSample, planarAimLine, stepInFor, strikeDuration, strikeKeyAt, styledKeyAt, styledLegDrive, styledSwingTiming, sweetDistance,
  SWING_DOF_DEPTH, SWING_DOFS, SWING_SHAPES, type SwingKey, type SwingKind, swingKindOf, SwingPlayer, swingPose, type SwingShape, swingTiming,
  swingWindow,
} from "../game/anim/Swing.ts";
import { clamp, lerp, smoothstep } from "../core/MathCore.ts";
import { smoothMax, smoothMin } from "../game/anim/FootIK.ts";
import { DEFAULT_GAIT } from "../game/anim/Gait.ts";
import { JOINT_INDEX } from "../game/anim/Rig.ts";
import { REST_GRIP } from "../game/GripStance.ts";
import { GUARD_POSE } from "../game/anim/Poses.ts";
import { recoveryPeakRate } from "../game/AnimationCurve.ts";
import { type LiveState, type MotionStyle, NEUTRAL } from "../game/anim/MotionStyle.ts";

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

/**
 * A styled recovery's peak speed stays under this share of the strike's (heavy, not snappy), as
 * far as the cooldown allows (SwingDriver.#styledProfile).
 */
export const HEAVY_RECOVERY = 0.9;
/** Thrusts (hand-path shapes): contact share of the strike time, reach cap, chest follow-through (rad × followThrough). */
export const THRUST_CONTACT = 0.75, THRUST_REACH = 0.97, THRUST_CHEST_FOLLOW = 0.08;
/** Samples of the styled strike path used to bound its joint speed (per press). */
const STRIKE_SAMPLES = 96;
type SwingTimingLike = Parameters<typeof styledKeyAt>[0];
const IK = { shoulder: 0, elbow: 0 };

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
  /** Lane M: strike fraction of the contact (geometry), the styled profile, the off-arm guard offset. */
  readonly #contactU: number;
  readonly #profile = newSwingProfile();
  readonly #offArm = { shoulder: 0, elbow: 0 };
  readonly #offArm2 = { shoulder: 0, elbow: 0 };
  readonly #k0: SwingKey = { ...GUARD_KEY };
  readonly #k1: SwingKey = { ...GUARD_KEY };
  /** The animator's derived joint speed limit (Animator.maxJointSpeed default), rad/s. */
  readonly #omega: number;

  constructor(setup: SwingSetup, limits: JointLimitTable) {
    this.setup = setup;
    this.#limits = limits;
    this.#pose = new Float64Array(limits.rest.length);
    this.#contactU = contactFraction(setup.shape, setup.arm, setup.tip);
    let range = 0;
    for (let j = 0; j < limits.rest.length; j++) range = Math.max(range, limits.max[j] - limits.min[j]);
    this.#omega = (Math.PI / 2) * range / DEFAULT_GAIT.minSwingTime;
  }

  /** True while a swing plays (including its contact hold and rebound). */
  get active(): boolean { return this.player.active; }

  /**
   * Start a swing against a target `distance` m away; `cooldown` (s) bounds the swing's length;
   * `variant` (the swing count) picks the aim line from AIM_PATTERN.
   */
  /**
   * Wave J: `impact` (0..1) is the blow's own impact — the caller's measured closing speed
   * normalised on a 12 m/s reference. It reaches the styled profile so the wind-up cocks with the
   * weapon's heft, the hold grows with the blow and the recovery answers what was hit. 0 (the
   * default) leaves every phase exactly as the pre-Wave-J rig played them.
   */
  begin(distance: number, cooldown: number, variant = 0, impact = 0): void {
    const s = this.setup, step = stepInFor(distance, s.sweet);
    // Closer than the half step back can fix: slide the hands up the haft (choke) by the rest.
    this.#choke = Math.min(s.choke, Math.max(0, s.sweet - distance + step));
    const lateral = s.shape.aimLateral * AIM_PATTERN[Math.abs(Math.trunc(variant)) % AIM_PATTERN.length];
    const aim = aimYawForLine(s.aimLine, distance - step, lateral);
    if (this.#style) {
      // A press during the previous swing's recovery chains from its current pose (no snap to guard).
      const pr = this.#profile, chained = this.player.active && this.player.recovering();
      if (chained) {
        for (const k of SWING_DOFS) pr.from[k] = this.sample[k];
        pr.fromWeight = this.sample.weight;
        pr.fromLeg = this.legDrive();
      }
      pr.chained = chained;
      const timing = this.#styledProfile(cooldown, Math.min(1, Math.max(0, Number.isFinite(impact) ? impact : 0)));
      this.player.begin(s.shape, timing, step, aim, s.twoHanded, s.arm, this.#profile);
    } else {
      this.player.begin(s.shape, swingTiming(s.strike, cooldown), step, aim, s.twoHanded, s.arm);
    }
    this.#stepTaken = 0;
    this.player.sample(this.sample);
  }

  /** Soft clamp (C1) of a key DOF into its joint window, 0.04 rad inside, over a 0.12 rad band. */
  #soft(v: number, joint: number): number {
    const lo = this.#limits.min[joint] + 0.04, hi = this.#limits.max[joint] - 0.04;
    return smoothMax(smoothMin(v, hi, 0.12), lo, 0.12);
  }

  /** Refresh the live guard of the styled profile (and the free arm's offsets) from the style. */
  #liveGuard(): void {
    const e = this.#style!.eff, g = this.#profile.guard;
    Object.assign(g, GUARD_KEY);
    g.shoulder = GUARD_KEY.shoulder + e.guardDrop;
    g.elbow = GUARD_KEY.elbow - e.guardTuck;
    this.#offArm.shoulder = e.guardDrop;
    this.#offArm.elbow = -e.guardTuck;
  }

  /**
   * Lane M: build this press's four-phase profile from the style (Swing.ts styled section) and
   * return its timing. The keys scale about the CONTACT key, so the contact pose (reach, aim) is
   * the unstyled one; DOF leads follow the chain depth.
   */
  #styledProfile(cooldown: number, impact = 0): ReturnType<typeof styledSwingTiming> {
    const st = this.#style!, e = st.eff, s = this.setup, pr = this.#profile, u = this.#contactU;
    this.#liveGuard();
    strikeKeyAt(s.shape, s.arm, 0, this.#k0);
    strikeKeyAt(s.shape, s.arm, 1, this.#k1);
    strikeKeyAt(s.shape, s.arm, u, pr.contactKey);
    const wd = e.windupDepth, ft = e.followThrough;
    for (let d = 0; d < SWING_DOFS.length; d++) {
      const k = SWING_DOFS[d], amp = st.swingAmp[d], c = pr.contactKey[k];
      // The twist is the WHOLE-BODY yaw (the legs have no yaw joint): turning more over the planted
      // feet slides their balls (ork 4.8 -> 5.8 mm at 1.2× depth), so it never grows past the shape.
      const kw = k === "twist" ? Math.min(1, wd) : wd, kf = k === "twist" ? Math.min(1, ft) : ft;
      pr.windup[k] = c + kw * amp * (this.#k0[k] - c);
      pr.strike[k] = c + kf * amp * (this.#k1[k] - c);
    }
    const SH = JOINT_INDEX.shoulderR, EL = JOINT_INDEX.elbowR, SP = JOINT_INDEX.spine;
    for (const key of [pr.windup, pr.strike]) {
      key.shoulder = this.#soft(key.shoulder, SH);
      key.elbow = this.#soft(key.elbow, EL);
      key.lean = this.#soft(key.lean, SP);
    }
    const h = s.shape.hand;
    if (h) {
      // A thrust meets the body at its FARTHEST point (contactFraction = 1), so a follow-through
      // past it cannot come from the hand. The hand reaches the strike point at the contact
      // (THRUST_CONTACT of the strike time, peak speed there), capped at THRUST_REACH of the arm's
      // reach (a locked elbow has an unbounded extension rate), and the CHEST follows through.
      const H = pr.hand ?? (pr.hand = new Float64Array(6));
      const reach = THRUST_REACH * (s.arm.upper + s.arm.fore);
      let cx = h.strike[0], cy = h.strike[1];
      const r = Math.hypot(cx, cy);
      if (r > reach) { cx *= reach / r; cy *= reach / r; }
      // The pull-back never goes deeper than the shape's own (a deeper one draws the hand into the
      // chest: measured −11.7 mm hand-torso on the ork); a deep anticipation shows in lean + twist.
      const wh = Math.min(1, wd);
      H[0] = cx + wh * (h.windup[0] - cx); H[1] = cy + wh * (h.windup[1] - cy);
      H[2] = cx; H[3] = cy;
      H[4] = cx; H[5] = cy;
      Object.assign(pr.contactKey, this.#k1);
      for (let d = 0; d < SWING_DOFS.length; d++) {
        const k = SWING_DOFS[d];
        pr.windup[k] = this.#k1[k] + wd * st.swingAmp[d] * (this.#k0[k] - this.#k1[k]);
        pr.strike[k] = this.#k1[k];
      }
      pr.strike.lean = this.#soft(this.#k1.lean + THRUST_CHEST_FOLLOW * ft, SP);
      pr.strike.twist = this.#k1.twist + 0.5 * THRUST_CHEST_FOLLOW * ft;
      // The end keys' arm IS the arm IK of the styled hand points (else the hold pops to a key
      // the strike path never reached).
      armIK(s.arm, H[0], H[1], IK); pr.windup.shoulder = IK.shoulder - pr.windup.lean; pr.windup.elbow = IK.elbow;
      armIK(s.arm, H[4], H[5], IK); pr.strike.shoulder = IK.shoulder - pr.strike.lean; pr.strike.elbow = IK.elbow;
    } else pr.hand = null;
    pr.contact = h ? THRUST_CONTACT : clamp(wd * u / Math.max(1e-6, wd * u + ft * (1 - u)), 0.3, 0.8);
    pr.overshoot = e.overshoot;
    pr.contactHold = clamp(CONTACT_HOLD * e.holdTime / NEUTRAL.holdTime, 0.06, 0.16);
    // Chain: blade/roll are the reference (lead 0: the contact time is the blade's); the seeded
    // per-joint jitter of the joint a DOF drives rides on top.
    const jit: Record<string, number> = { shoulder: JOINT_INDEX.shoulderR, elbow: JOINT_INDEX.elbowR, lean: JOINT_INDEX.spine, twist: JOINT_INDEX.abdomen };
    for (let d = 0; d < SWING_DOFS.length; d++) {
      const k = SWING_DOFS[d], depth = SWING_DOF_DEPTH[k];
      pr.lead[d] = depth >= 5 ? 0 : Math.max(0, (5 - depth) * e.chainLag + st.jointJitter[jit[k]]);
    }
    pr.legLead = 5 * e.chainLag;
    // No phase may outrun the animator's joint speed limit (90 % of it): the strike's fastest DOF
    // peaks at 2·travel / strike (strikeProgress), the wind-up's at 1.5·travel / windup (Hermite),
    // the recovery's at recoveryPeakRate(A)·travel / recover (recoveryCurve).
    const om = 0.9 * this.#omega, g = pr.guard, rk = recoveryPeakRate(e.overshoot);
    let wTravel = 0, rTravel = 0, sMax = 0, rRatio = 0;
    for (const k of ["shoulder", "elbow", "lean"] as const) {
      wTravel = Math.max(wTravel, Math.abs(pr.windup[k] - g[k]));
      rTravel = Math.max(rTravel, Math.abs(pr.strike[k] - g[k]));
    }
    // HEAVY recovery: its peak speed stays under HEAVY_RECOVERY of the strike's, per DOF that
    // moves most (blade for arcs, the arm for hand paths): recover ≥ rk / (2·HEAVY)·(Δr/Δs)·strike.
    for (const k of (h ? ["shoulder", "elbow"] : ["blade", "shoulder"]) as ("blade" | "shoulder" | "elbow")[]) {
      sMax = Math.max(sMax, Math.abs(pr.strike[k] - pr.windup[k]));
      rRatio = Math.max(rRatio, Math.abs(pr.strike[k] - g[k]));
    }
    const heavyRatio = rRatio / Math.max(1e-6, sMax);
    // The strike's joint rate per unit of normalised strike time, sampled along the real path
    // (a hand-path thrust's elbow speeds up toward full extension): strike ≥ max rate / om.
    const unit: SwingTimingLike = { windup: 0, strike: 1, recover: 1, hold: 0, settle: 0 };
    let rate = 0;
    styledKeyAt(unit, pr, 0, this.#k0, s.arm);
    for (let i = 1; i <= STRIKE_SAMPLES; i++) {
      styledKeyAt(unit, pr, Math.min(i / STRIKE_SAMPLES, 1 - 1e-9), this.#k1, s.arm);
      // (A thrust's arm is left out: its IK rate is unbounded as the arm locks at the contact; the
      // limiter clips those last frames — measured and reported by tools/anim-report.ts.)
      for (const k of ["shoulder", "elbow", "lean"] as const) if (!h || k === "lean") rate = Math.max(rate, Math.abs(this.#k1[k] - this.#k0[k]) * STRIKE_SAMPLES);
      Object.assign(this.#k0, this.#k1);
    }
    const minStrike = rate / om, overrun = st.swingOverrun();
    // Arcs (slash/chop): the recovery is an interruptible tail. Hand-path thrusts keep one budget.
    const tailFree = !h;
    const t0 = styledSwingTiming(s.strike, cooldown, e, minStrike, overrun, 1.5 * wTravel / om, rk * rTravel / om, tailFree, impact);
    // The heavy floor is always honoured: the recovery is an interruptible tail (the next press
    // chains from it, SwingPlayer.recovering), so a long recovery never lowers the attack rate.
    const heavy = rk / (2 * HEAVY_RECOVERY) * heavyRatio * t0.strike;
    let rHeavy = Math.max(t0.recover, heavy);
    if (!tailFree) {
      const cap = Number.isFinite(cooldown) && cooldown > 0 ? COOLDOWN_SHARE * cooldown * (1 + overrun) : Infinity;
      rHeavy = Math.min(heavy, Math.max(t0.recover, cap - (swingDuration(t0) - t0.recover)));
    }
    if (rHeavy <= t0.recover + 1e-9) return t0;
    return styledSwingTiming(s.strike, cooldown, e, minStrike, overrun, 1.5 * wTravel / om, rHeavy, tailFree, impact);
  }

  /** Advance the swing clock by dt and refresh the sample. */
  advance(dt: number): void {
    if (this.#style && this.#stepsStyle) this.#style.step(dt);
    if (!this.player.active) return;
    if (this.#style && this.player.profile) this.#liveGuard();
    this.player.advance(dt);
    this.player.sample(this.sample);
  }

  /** Stop the swing now (knock-out, a skill takes over). */
  cancel(): void { this.player.cancel(); this.sample.weight = 0; }

  /** True once the blow is over: a new press may chain from the recovery. */
  recovering(): boolean { return this.player.recovering(); }

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
    const pr = this.player.profile;
    if (pr && this.setup.twoHanded) {
      // Two hands, styled: the off arm starts and ends at ITS guard (not the weapon arm's), and
      // joins the mirrored weapon arm as the swing's weight comes in.
      const k = 1 - this.sample.weight;
      this.#offArm2.shoulder = k * ((GUARD_POSE.shoulderL ?? 0) + this.#offArm.shoulder - pr.guard.shoulder);
      this.#offArm2.elbow = k * ((GUARD_POSE.elbowL ?? 0) + this.#offArm.elbow - pr.guard.elbow);
      return swingPose(this.sample, true, this.#limits, this.#pose, null, this.#offArm2);
    }
    return swingPose(this.sample, this.setup.twoHanded, this.#limits, this.#pose, pr ? this.#offArm : null);
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

  #style: MotionStyle | null = null;
  #stepsStyle = false;
  /** Lane M: the fighter's motion style (null = today's swing). */
  get style(): MotionStyle | null { return this.#style; }
  /** Lane M: use a motion style; a style shared with the Animator is stepped by the Animator. */
  setStyle(style: MotionStyle | null): void {
    this.#style = style;
    this.#stepsStyle = style ? style.claim(this) : false;
  }
  /** Lane M: this frame's live state (forwarded to the style). */
  setLive(live: Readonly<LiveState>): void { this.#style?.setLive(live); }

  /** Phase durations of the current swing, s, and the contact instant (s since the press; peak blade speed). */
  phaseTimes(): { windup: number; strike: number; hold: number; recover: number; settle: number; contactAt: number } {
    const t = this.player.timing, pr = this.player.profile;
    return {
      windup: t.windup, strike: t.strike, hold: t.hold ?? 0, recover: t.recover, settle: t.settle ?? 0,
      contactAt: t.windup + (pr ? pr.contact : 0.5) * t.strike,
    };
  }

  /**
   * Lane M: leg drive 0..1 this frame (AnimatorInput.attackDrive): the legs lead the strike —
   * the pelvis sinks into the planted feet ahead of the arm. 0 without a style or a swing.
   */
  legDrive(): number {
    const p = this.player, pr = p.profile;
    if (!p.active || !pr) return 0;
    if (p.frozenAt === null) return styledLegDrive(p.timing, pr, p.clock);
    return styledLegDrive(p.timing, pr, p.frozenAt) * (1 - smoothstep(0, 0.85 * p.timing.recover, p.rebound));
  }
}
