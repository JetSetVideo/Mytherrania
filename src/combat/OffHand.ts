// Lane T (wave W): the OFF hand on the haft of a two-handed weapon.
//
// Why: the Skeleton's arm joints turn on one axis each (the arm plane), so the left arm could only
// MIRROR the weapon arm (Swing.swingPose) — its hand stayed in the left arm's own plane, 23-49 cm from a
// haft held in the right hand (measured, wave V lane G). A real off hand reaches across: the shoulder is
// a ball joint (it abducts/adducts and turns the upper arm), the elbow a hinge, the forearm twists.
//
// What: a render-side two-bone IK on the left arm's bones, run after the rig is posed and the weapon is
// placed (Engine: after rig.setGrip/choke and the placement, and again after the clearance guards moved
// the weapon arm):
//   1. the haft point: the weapon's own "off" grip (lane W's Form.resolveGrips: a sword's off hand just
//      below the main hand, a spear/staff spread POLE_HAND_SPREAD down the haft, a halberd near its butt),
//      moved with the choke; slid along the haft (GripStance.offHandPlan's range) toward the shoulder only
//      when out of reach;
//   2. the elbow HINGE closes until the fist (AnatomyParts' grip anchor) lies at the shoulder's distance
//      to that point (bisection on the hinge angle inside the elbow's Skeleton limits);
//   3. the SHOULDER turns (ball joint: swing + swivel) to put the fist on the point, the swivel taking
//      the elbow down and out (OFF_POLE);
//   4. the FOREARM twists about its own axis so the thumb axis lies along the haft toward the striking end
//      (the handle across the palm, both thumbs toward the tip), within FOREARM_TWIST;
//   5. the fist never sinks into its own torso: when the hand's capsule would enter the chest/belly/pelvis
//      capsules, the target moves out along the torso's normal (the fist rests against the haft's outside
//      instead of inside the body; the result reports how far).
// Steps 2-4 iterate (the twist moves the off-axis fist). Everything is written from the rig's bones'
// rest rotations, so the call is IDEMPOTENT (the engine may call it twice a frame).
//
// Broad bodies: an ork's shoulders are 0.67 m apart for a 0.73 m arm, so the off hand cannot reach a haft
// held in the weapon arm's own plane. applyTwoHandGrip first CONVERGES the weapon arm toward the midline
// (section below), as far as the off hand needs and the body allows.
//
// Physics: RENDER-ONLY. The Skeleton keeps its single-axis arms (the ragdoll binds to the skeleton's joints
// and reads the bones only at elimination, when this step no longer runs: a ragdolled body skips the
// whole pose stage), so no joint, mass or volume of the physical body moves — channel MSG-12..14/20's pins
// are untouched. Hit boxes are rebuilt from the bones, so what you see on the off arm is what can be hit.

// @deno-types="@types/three"
import * as THREE from "three";
import { boneDisplayRoll } from "../graphics/body/Anatomy.ts";
import { HAND_PRONATION } from "../graphics/body/AnatomyParts.ts";
import type { BoneId } from "../graphics/body/contracts.ts";
import { RIG_ROTATION_SIGN } from "../game/anim/Rig.ts";
import { segmentDistanceSq } from "../game/anim/Clipping.ts";
import { GUARD_POSE } from "../game/anim/Poses.ts";
import type { OffHandPlan } from "../game/GripStance.ts";
import type { Hitbox, HitboxSet } from "./contracts.ts";
import { hitboxesFromPlan, updateHitboxes } from "./Hitboxes.ts";
import type { CombatRig } from "./RigAdapter.ts";

export { holdsWithTwoHands, OFF_HAND_HALF_WIDTH, offHandPlan, type OffHandPlan, POLE_SLIDE } from "../game/GripStance.ts";

/** Keep the reached fist this far (m) short of the straight arm so the elbow never locks. */
export const OFF_REACH_SLACK = 0.012;
/** Elbow hinge range of the off arm, rad (defaultHumanoid elbowL: −2.6..0). */
export const OFF_ELBOW_RANGE: [number, number] = [-2.6, 0];
/**
 * Forearm twist range about its own axis, rad, from the rig's bind hand (which is already pronated
 * AnatomyParts.HAND_PRONATION 0.6): a forearm turns ~2.4 rad palm-down to palm-up in all.
 */
export const FOREARM_TWIST: [number, number] = [-1.3, 1.3];
/** Swivel goal for the off elbow: down, out to the holder's left (+x of the body) and a little back. */
export const OFF_POLE = { down: 1, out: 0.55, back: 0.15 } as const;
/** Solver passes (hinge -> shoulder -> twist); 3 brings the fist within ~1 mm. */
export const OFF_ITERATIONS = 3;
/** The off hand's capsule keeps at least this clearance from its own torso capsules, m (lane M's ClipMeter wants > 0). */
export const OFF_TORSO_MARGIN = 0.008;
/**
 * RELEASE: when the haft lies out of the off arm's reach by more than this (m), or the fist could only
 * reach it through the torso, the off arm eases back to the arm the Skeleton drew (its guard, or the
 * swing's mirrored arm) — fully released at OFF_RELEASE_SPAN past the bound, linearly in between, so the
 * hand never pops and never reaches straight through its own chest (a broad body's follow-through).
 */
export const OFF_RELEASE_SPAN = 0.08;
/** Torso zones the hands and the weapon keep out of (tools/anim-report.ts ClipMeter TORSO). */
const TORSO_ZONES = new Set(["chest", "abdomen", "pelvis"]);

// ─── Per-rig data ──────────────────────────────────────────────────────────────────────────────

interface ArmData {
  shoulder: THREE.Bone; elbow: THREE.Bone; parent: THREE.Object3D;
  restE: THREE.Quaternion; hinge: THREE.Vector3; sign: number;
  /** Forearm long axis, the fist (grip anchor) and the thumb axis in the elbow bone's LOCAL frame. */
  axis: THREE.Vector3; fist: THREE.Vector3; thumb: THREE.Vector3;
  /** The other shoulder's bone (the body's lateral reference). */
  otherShoulder: THREE.Bone;
  /** This rig's own hit boxes (torso capsules, the two hand capsules), posed from the bones on demand. */
  boxes: HitboxSet; torso: Hitbox[]; handL: Hitbox[]; handR: Hitbox[];
}
const ARMS = new WeakMap<object, ArmData>();
const Z = new THREE.Vector3(0, 0, 1), X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);

function armOf(rig: CombatRig): ArmData | null {
  let a = ARMS.get(rig);
  if (a) return a;
  const shoulder = rig.bones.get("shoulderL"), elbow = rig.bones.get("elbowL"), other = rig.bones.get("shoulderR");
  if (!shoulder || !elbow || !other || !shoulder.parent) return null;
  const inv = rig.skin.skeleton.boneInverses[rig.skin.skeleton.bones.indexOf(elbow)];
  const arm = rig.plan.arms[0], F = arm.frame;
  const ax = rig.plan.bones.find((b) => b.id === "elbowL")?.axis ?? "x";
  // The bind hand frame (RigAdapter.handFrameBind for the left arm): the thumb axis w — pronated.
  const cp = Math.cos(HAND_PRONATION), sp = Math.sin(HAND_PRONATION);
  const w = new THREE.Vector3(F.f[0] * cp - F.o[0] * sp, F.f[1] * cp - F.o[1] * sp, F.f[2] * cp - F.o[2] * sp);
  const boxes = hitboxesFromPlan(rig.plan);
  a = {
    shoulder, elbow, parent: shoulder.parent, otherShoulder: other,
    restE: new THREE.Quaternion().setFromAxisAngle(Z, boneDisplayRoll(rig.plan, "elbowL" as BoneId)),
    hinge: new THREE.Vector3(ax === "x" ? 1 : 0, ax === "y" ? 1 : 0, ax === "z" ? 1 : 0),
    sign: RIG_ROTATION_SIGN.elbowL ?? 1,
    axis: new THREE.Vector3(F.d[0], F.d[1], F.d[2]).transformDirection(inv),
    fist: new THREE.Vector3(arm.grip[0], arm.grip[1], arm.grip[2]).applyMatrix4(inv),
    thumb: w.transformDirection(inv),
    boxes,
    torso: boxes.boxes.filter((h) => TORSO_ZONES.has(h.zone)),
    handL: boxes.boxes.filter((h) => h.zone === "hand" && h.side === "L"),
    handR: boxes.boxes.filter((h) => h.zone === "hand" && h.side === "R"),
  };
  ARMS.set(rig, a);
  return a;
}

const IDENTITY = new THREE.Matrix4().elements;
/** Pose the rig's own hit boxes from its CURRENT bone matrices. */
function poseBoxes(rig: CombatRig, a: ArmData): void {
  updateHitboxes(a.boxes, (bone) => rig.bones.get(bone as BoneId)?.matrixWorld.elements ?? IDENTITY);
}

/** Clearance (m) of a world segment p-q with radius r from the torso capsules (< 0 = inside). */
function segTorso(a: ArmData, p: THREE.Vector3, q: THREE.Vector3, r: number): number {
  let m = Infinity;
  for (const b of a.torso) {
    const d = Math.sqrt(segmentDistanceSq(p.x, p.y, p.z, q.x, q.y, q.z, b.wa[0], b.wa[1], b.wa[2], b.wb[0], b.wb[1], b.wb[2])) - r - b.radius;
    if (d < m) m = d;
  }
  return m;
}

// ─── The weapon arm converges ──────────────────────────────────────────────────────────────────
//
// On a broad body the off hand cannot reach a haft held out in the weapon arm's own plane (ork: shoulders
// 0.67 m apart, arm 0.73 m, the arm displayed 0.41 rad abducted: the fist was 12-35 cm short). Hands on a
// two-handed haft meet in front of the body, so the WEAPON arm converges toward the midline: the shoulder
// turns the whole arm about an axis through it PARALLEL TO THE BLADE — the weapon keeps its world direction
// (the wrist's hold is unchanged) and only slides sideways with the hand — signed to move the hand toward
// the midline, by the SMALLEST angle that brings the haft within the off arm's reach (minus
// CONVERGE_MARGIN), at most CONVERGE_MAX, and never so far that the weapon hand or the weapon (butt to tip)
// comes closer to the torso capsules than it already was (or than CONVERGE_TORSO_CLEAR), nor the blade
// closer to the body axis than CONVERGE_BODY_CLEAR (lane G's rule: an overhead wind-up converged onto the
// midline runs the blade through the head). A human mostly needs none; the angle is stored per rig
// (weaponArmConvergenceOf) so the clearance guards (RigAdapter.ArmGuard.apply) draw and measure the same arm.
// SwingRig.measureAimLine measures the aim line WITHOUT it: converging there turned a dwarf's aim yaw from
// −0.13 to −0.34 rad (the line slid to the midline) and the planted feet slid 6-7 mm under the extra
// whole-body yaw; a converged blow lands up to the convergence's slide nearer the target's centre line.

/** Most the weapon arm converges toward the midline for a two-handed grip, rad. */
export const CONVERGE_MAX = 0.9;
/** Reach margin the off arm keeps after the convergence, m (its elbow never locks). */
export const CONVERGE_MARGIN = 0.02;
/** The converged blade keeps at least this horizontal distance from the body axis (pelvis to head top), m: lane G's 110 mm + 20. */
export const CONVERGE_BODY_CLEAR = 0.13;
/** The converged weapon hand and weapon keep at least this clearance from the torso capsules, m (or what they had). */
export const CONVERGE_TORSO_CLEAR = 0.015;
/** Tube radius of the haft for the torso test, m. */
const HAFT_RADIUS = 0.018;

const CONVERGE = new WeakMap<object, number>();
/** The weapon arm's current two-hand convergence on this rig, rad (0: none / one-handed). */
export function weaponArmConvergenceOf(rig: object): number { return CONVERGE.get(rig) ?? 0; }
/** Forget the rig's convergence (the bones were re-posed without it: a measurement, a dropped two-hander). */
export function clearWeaponArmConvergence(rig: object): void { CONVERGE.delete(rig); }

const qK = new THREE.Quaternion(), vK = new THREE.Vector3(), vK2 = new THREE.Vector3(), vL = new THREE.Vector3(), vM = new THREE.Vector3();
const mInvParent2 = new THREE.Matrix4();
/** Convergence axis (the shoulders' parent frame, unit): the blade's direction, signed to move the hand toward the midline. */
function convergeAxis(rig: CombatRig, out: THREE.Vector3): THREE.Vector3 | null {
  const sR = rig.bones.get("shoulderR"), sL = rig.bones.get("shoulderL");
  if (!sR || !sL || !sR.parent) return null;
  const inv = mInvParent2.copy(sR.parent.matrixWorld).invert();
  const hand = (rig.weaponNode.parent ?? rig.weaponNode).getWorldPosition(vM).applyMatrix4(inv).sub(sR.position);
  const lateral = vL.copy(sL.position).sub(sR.position).normalize(); // toward the midline and beyond (+x)
  out.set(0, 1, 0).transformDirection(rig.weaponNode.matrixWorld).transformDirection(inv);
  const lever = vK2.copy(out).cross(hand).dot(lateral); // hand speed toward the midline per rad
  if (Math.abs(lever) < 0.05) return null; // the blade along the arm (a thrust): turning about it moves nothing
  if (lever < 0) out.negate();
  return out;
}

/**
 * Turn the weapon arm (shoulderR, whose bone holds its base rotation and whose subtree's matrices are
 * current) toward the midline by `alpha` rad about convergeAxis; refreshes the subtree.
 */
export function convergeWeaponArm(rig: CombatRig, alpha: number): void {
  const sR = rig.bones.get("shoulderR");
  if (!sR || alpha === 0) return;
  const k = convergeAxis(rig, vK);
  if (!k) return;
  sR.quaternion.premultiply(qK.setFromAxisAngle(k, alpha));
  sR.updateMatrixWorld(true);
}

/** Result of a two-hand solve (QA): the convergence and the off hand. */
export interface TwoHandResult extends OffHandResult { converge: number }

/** Bisection: the largest x in [0, hi] with ok(x) (ok(0) assumed true). */
function largest(ok: (x: number) => boolean, hi: number): number {
  if (ok(hi)) return hi;
  let l = 0, h = hi;
  for (let i = 0; i < 22; i++) { const m = 0.5 * (l + h); if (ok(m)) l = m; else h = m; }
  return l;
}

/**
 * The whole two-handed grip, after the rig is posed, the weapon placed and the group's matrices updated
 * (engine order): re-pose the weapon shoulder from the Skeleton (`shoulderAngle`, so the call is
 * idempotent), converge it as far as the off hand needs and the body allows, then put the off hand on the
 * haft (applyOffHandGrip).
 */
export function applyTwoHandGrip(rig: CombatRig, shoulderAngle: number, plan: OffHandPlan, choke = 0, rest: OffArmRest | null = null): TwoHandResult | null {
  const sR = rig.bones.get("shoulderR"), a = armOf(rig);
  if (!sR || !a) return null;
  const ax = rig.plan.bones.find((b) => b.id === "shoulderR")?.axis ?? "x";
  sR.quaternion.setFromAxisAngle(Z, boneDisplayRoll(rig.plan, "shoulderR" as BoneId))
    .multiply(qK.setFromAxisAngle(ax === "x" ? X : ax === "y" ? Y : Z, (RIG_ROTATION_SIGN.shoulderR ?? 1) * shoulderAngle));
  a.parent.updateMatrixWorld(true);
  CONVERGE.set(rig, 0);
  let alpha = 0;
  let okAt: ((x: number) => boolean) | null = null;
  const kP = convergeAxis(rig, vK);
  if (kP) {
    // In WORLD space: the rotation about the axis through the right shoulder pivot.
    const W = a.parent.matrixWorld, SRw = sR.getWorldPosition(new THREE.Vector3()), SLw = a.shoulder.getWorldPosition(new THREE.Vector3());
    const k = kP.clone().transformDirection(W);
    const node = rig.weaponNode, local = (y: number) => node.localToWorld(new THREE.Vector3(0, y + choke, 0));
    const reach = a.elbow.position.length() + a.fist.length() - OFF_REACH_SLACK - CONVERGE_MARGIN; // the rigs are built at scale 1
    const N = 12, haft: THREE.Vector3[] = [];
    for (let i = 0; i <= N; i++) haft.push(local(plan.range[0] + (plan.range[1] - plan.range[0]) * i / N));
    // The weapon from its butt to its tip (the torso test) and the blade (the body-axis test).
    const butt = Math.min(plan.range[0] - 0.05, plan.butt), wpn: THREE.Vector3[] = [], blade: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) wpn.push(local(butt + (plan.tip - choke - butt) * i / 10));
    for (let i = 0; i <= 12; i++) blade.push(local((plan.tip - choke) * i / 12));
    poseBoxes(rig, a);
    const hr = a.handR.map((h) => [new THREE.Vector3(h.wa[0], h.wa[1], h.wa[2]), new THREE.Vector3(h.wb[0], h.wb[1], h.wb[2]), h.radius] as const);
    const q = new THREE.Quaternion(), p = new THREE.Vector3(), p2 = new THREE.Vector3();
    const rot = (v: THREE.Vector3, out: THREE.Vector3) => out.copy(v).sub(SRw).applyQuaternion(q).add(SRw);
    const at = (x: number) => q.setFromAxisAngle(k, x);
    const deficit = (x: number) => {
      at(x);
      let m = Infinity;
      for (const h of haft) m = Math.min(m, rot(h, p).distanceTo(SLw));
      return m - reach;
    };
    const pelvis = (rig.bones.get("abdomen") ?? rig.group).getWorldPosition(new THREE.Vector3());
    const chest = (rig.bones.get("spine") ?? rig.group).getWorldPosition(new THREE.Vector3());
    const lo = pelvis.y - 0.25, hi = chest.y + 0.45;
    const axisClear = (x: number) => {
      at(x);
      let m = Infinity;
      for (const b of blade) { rot(b, p); if (p.y >= lo && p.y <= hi) m = Math.min(m, Math.hypot(p.x - pelvis.x, p.z - pelvis.z)); }
      return m;
    };
    const torsoClear = (x: number) => {
      at(x);
      let m = Infinity;
      for (const [s, e, r] of hr) m = Math.min(m, segTorso(a, rot(s, p), rot(e, p2), r));
      for (let i = 0; i + 1 < wpn.length; i++) m = Math.min(m, segTorso(a, rot(wpn[i], p), rot(wpn[i + 1], p2), HAFT_RADIUS));
      return m;
    };
    if (deficit(0) > 0) {
      // The least alpha the reach needs, capped by the body (never closer than it already was).
      const need = deficit(CONVERGE_MAX) > 0 ? CONVERGE_MAX : CONVERGE_MAX - largest((x) => deficit(CONVERGE_MAX - x) <= 0, CONVERGE_MAX);
      const ax0 = Math.min(CONVERGE_BODY_CLEAR, axisClear(0)), tc0 = Math.min(CONVERGE_TORSO_CLEAR, torsoClear(0));
      alpha = largest((x) => axisClear(x) >= ax0 && torsoClear(x) >= tc0, need);
      // Continuity may keep a convergence the solve would drop, as long as nothing enters the torso.
      okAt = (x) => torsoClear(x) >= Math.min(0, tc0);
    }
  }
  // Wave GEN (lane K): the convergence is a bisection with hard constraints, so it jumps between frames
  // (audit: 0.39 -> 0.65 rad in one frame walking with a longsword); rate-limit it on the rig's clock.
  if (kP) {
    const tm = temporalOf(rig);
    if (tm) {
      // The body outranks continuity: a lagging (larger) convergence that would put the fist / blade into
      // the torso drops to the solved one (anim_measure: a thrust's hand 29 mm in the chest otherwise).
      const lim = limitTo(alpha, tm.state.a0, CONVERGE_RATE * tm.dt);
      if (lim > alpha && okAt && !okAt(lim)) {
        const ok = okAt, lo = alpha;
        alpha = lo + largest((d) => ok(lo + d), lim - lo); // the most continuity the torso allows
      } else alpha = lim;
      tm.state.a1 = alpha;
    }
    if (alpha > 0) { convergeWeaponArm(rig, alpha); CONVERGE.set(rig, alpha); }
    if (tm && alpha > 0) tm.clock.editedR = tm.clock.n; // the drawn weapon shoulder now differs from the Skeleton's
  }
  const res = applyOffHandGrip(rig, plan, choke, rest);
  return res ? { ...res, converge: alpha } : null;
}

// ─── Temporal limiter (wave GEN, lane K) ───────────────────────────────────────────────────────

/** Fastest the weapon arm's convergence may change, rad/s (0.2 rad per 60 Hz frame; 6 left a thrust's guard jumping, 24 let walk pops through). */
export const CONVERGE_RATE = 12;
/** Fastest the off hand's grip weight may change, 1/s (a full release / re-grip takes 1 / HOLD_RATE s). */
export const HOLD_RATE = 5;
/** Fastest the drawn off arm (shoulderL, elbowL local rotations) may turn, rad/s (0.33 rad per 60 Hz frame). */
export const OFF_ARM_RATE = 20;
interface OffTemporal { frame: number; a0: number; a1: number; h0: number; h1: number }
/** SkinnedHumanoid.frameClock (structural: combat must not import the graphics rig module). */
interface ClockLike { n: number; dt: number; armL: readonly [THREE.Quaternion, THREE.Quaternion]; editedL: number; editedR: number }
const TEMPORAL = new WeakMap<object, OffTemporal>();
/**
 * The limiter's state for this frame of the rig's clock (SkinnedHumanoid.frameClock), or null on a rig
 * without a clock / a zero step (a bare test rig, a QA capture): those keep the exact pre-wave behaviour.
 * The previous FRAME's last values are the reference (the arm: as DRAWN last frame, frameClock.armL), so
 * the pose loop's call and the after-guard re-seat in one frame are limited against the same pose. A
 * skipped frame (the fall owned the body) restarts the scalars from 0 (no convergence, hand released).
 */
function temporalOf(rig: object): { state: OffTemporal; dt: number; clock: ClockLike } | null {
  const c = (rig as { frameClock?: ClockLike }).frameClock;
  if (!c || !(c.dt > 0) || !c.armL) return null;
  let s = TEMPORAL.get(rig);
  if (!s) { s = { frame: c.n, a0: Number.NaN, a1: Number.NaN, h0: Number.NaN, h1: Number.NaN }; TEMPORAL.set(rig, s); }
  if (s.frame !== c.n) {
    // A skipped frame means the override was off (a fall owned the body): resume from "no convergence,
    // released hand" so both ease back in (audit: 0.77 rad shoulderR pop at the get-up's hand-off).
    const prev = s.frame === c.n - 1;
    s.a0 = prev ? s.a1 : 0; s.h0 = prev ? s.h1 : 0;
    s.frame = c.n; s.a1 = Number.NaN; s.h1 = Number.NaN;
  }
  return { state: s, dt: c.dt, clock: c };
}
const limitTo = (x: number, ref: number, step: number): number => Number.isNaN(ref) ? x : Math.max(ref - step, Math.min(ref + step, x));
/** Turn q toward itself from `ref` by at most `step` rad (in place). */
function limitQuat(q: THREE.Quaternion, ref: THREE.Quaternion, step: number): void {
  const ang = 2 * Math.acos(Math.min(1, Math.abs(q.dot(ref))));
  if (ang > step) q.copy(qLim.copy(ref).slerp(q, step / ang));
}
const qLim = new THREE.Quaternion(), qUS = new THREE.Quaternion(), qUE = new THREE.Quaternion(), qLS = new THREE.Quaternion(), qLE = new THREE.Quaternion();

// ─── The off arm ───────────────────────────────────────────────────────────────────────────────

/** Result of one off-hand solve (QA). */
export interface OffHandResult {
  /** The fist's distance to its haft point after the solve, m (0 when reachable and clear of the torso). */
  gap: number;
  /** Haft point used, weapon-local y from the main grip (m). */
  y: number;
  /** Elbow hinge (Skeleton convention, ≤ 0) and forearm twist, rad. */
  elbow: number; twist: number;
  /** False when the point lay out of reach even after sliding (the arm reaches straight at it). */
  reached: boolean;
  /** How far the target was pushed out of the torso, m (0 = the fist sits on the haft). */
  pushed: number;
  /** Grip weight 0..1 (1 = the IK arm; < 1 eased toward the Skeleton's own arm: out of reach / in the torso). */
  hold: number;
}

/** Skeleton left-arm angles a released off hand eases back to. */
export interface OffArmRest { shoulder: number; elbow: number }
/** Default release pose: the free arm's guard (Poses.GUARD_POSE: forearm up in front of the face). */
export const OFF_REST: OffArmRest = { shoulder: GUARD_POSE.shoulderL ?? -0.85, elbow: GUARD_POSE.elbowL ?? -1.7 };

const qH = new THREE.Quaternion(), qT = new THREE.Quaternion(), qD = new THREE.Quaternion(), qW = new THREE.Quaternion();
const vS = new THREE.Vector3(), vT = new THREE.Vector3(), vG = new THREE.Vector3(), vE = new THREE.Vector3(), vP = new THREE.Vector3();
const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), vY = new THREE.Vector3(), vO = new THREE.Vector3();
const vH = new THREE.Vector3(), vN = new THREE.Vector3(), vQ = new THREE.Vector3();
const mInvParent = new THREE.Matrix4();

/** Elbow bone local rotation for hinge θ (Skeleton convention) and twist τ. */
function elbowQuat(a: ArmData, theta: number, twist: number, out: THREE.Quaternion): THREE.Quaternion {
  out.copy(a.restE).multiply(qH.setFromAxisAngle(a.hinge, a.sign * theta));
  if (twist !== 0) out.multiply(qT.setFromAxisAngle(a.axis, twist));
  return out;
}

/** The fist in the SHOULDER bone's local frame for hinge θ and twist τ (writes `out`). */
function fistInShoulder(a: ArmData, theta: number, twist: number, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(a.fist).applyQuaternion(elbowQuat(a, theta, twist, qW)).add(a.elbow.position);
}

/** Pose the off arm so its fist lands on T (parent frame): steps 2-4 of the module comment. Returns [θ, τ]. */
function solveArm(a: ArmData, S: THREE.Vector3, T: THREE.Vector3, reach: number, pole: THREE.Vector3, yDir: THREE.Vector3): [number, number] {
  const want = Math.min(reach, T.distanceTo(S));
  const tDir = vH.copy(T).sub(S).normalize();
  const qS = a.shoulder.quaternion;
  let theta = 0, twist = 0;
  for (let it = 0; it < OFF_ITERATIONS; it++) {
    // The hinge: |fist(θ)| = want (the distance shrinks as the elbow closes).
    const [lo, hi] = OFF_ELBOW_RANGE;
    const f = (th: number) => fistInShoulder(a, th, twist, vG).length() - want;
    if (f(hi) <= 0) theta = hi; // straight arm still short: reach straight at the point
    else if (f(lo) >= 0) theta = lo;
    else {
      let l = lo, h = hi; // f(l) < 0 < f(h)
      for (let k = 0; k < 40; k++) { const m = 0.5 * (l + h); if (f(m) < 0) l = m; else h = m; }
      theta = 0.5 * (l + h);
    }
    fistInShoulder(a, theta, twist, vG);
    // The shoulder: swing the fist onto the target direction, then swivel about it to put the elbow on the pole.
    qS.setFromUnitVectors(vA.copy(vG).normalize(), tDir);
    vE.copy(a.elbow.position).applyQuaternion(qS);
    const e1 = vA.copy(vE).addScaledVector(tDir, -vE.dot(tDir));
    const p1 = vB.copy(pole).addScaledVector(tDir, -pole.dot(tDir));
    if (e1.lengthSq() > 1e-10 && p1.lengthSq() > 1e-10) qS.premultiply(qD.setFromAxisAngle(tDir, Math.atan2(vC.copy(e1).cross(p1).dot(tDir), e1.dot(p1))));
    elbowQuat(a, theta, twist, a.elbow.quaternion);
    a.shoulder.updateMatrixWorld(true);
    if (it === OFF_ITERATIONS - 1) break;
    // The forearm twist: the thumb axis along the haft toward the striking end, about the forearm axis.
    const m = a.elbow.matrixWorld;
    const d = vA.copy(a.axis).transformDirection(m).transformDirection(mInvParent);
    const w = vB.copy(a.thumb).transformDirection(m).transformDirection(mInvParent);
    const wp = w.addScaledVector(d, -w.dot(d)), yp = vC.copy(yDir).addScaledVector(d, -yDir.dot(d));
    if (wp.lengthSq() > 1e-8 && yp.lengthSq() > 1e-8) {
      const dt = Math.atan2(vE.copy(wp).cross(yp).dot(d), wp.dot(yp));
      twist = Math.max(FOREARM_TWIST[0], Math.min(FOREARM_TWIST[1], twist + dt));
    }
  }
  return [theta, twist];
}

/** The torso's outward unit normal (world) at the torso capsule nearest to p, into `n`. */
function torsoNormal(a: ArmData, p: THREE.Vector3, n: THREE.Vector3): THREE.Vector3 {
  let best = Infinity;
  for (const b of a.torso) {
    const ax = b.wb[0] - b.wa[0], ay = b.wb[1] - b.wa[1], az = b.wb[2] - b.wa[2], L2 = ax * ax + ay * ay + az * az;
    let t = L2 > 1e-12 ? ((p.x - b.wa[0]) * ax + (p.y - b.wa[1]) * ay + (p.z - b.wa[2]) * az) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    vQ.set(p.x - b.wa[0] - ax * t, p.y - b.wa[1] - ay * t, p.z - b.wa[2] - az * t);
    const d = vQ.length() - b.radius;
    if (d < best && vQ.lengthSq() > 1e-12) { best = d; n.copy(vQ).normalize(); }
  }
  return n;
}

/**
 * Put the left fist on the haft (module comment). `choke`: how far the hands slid up the haft (the
 * weapon node sits at y = −choke). Call after the rig is posed, the grip set and the group's matrices
 * updated; leaves shoulderL/elbowL posed and their subtree's matrices refreshed.
 */
export function applyOffHandGrip(rig: CombatRig, plan: OffHandPlan, choke = 0, rest: OffArmRest | null = null): OffHandResult | null {
  const a = armOf(rig);
  if (!a) return null;
  // The arm a released hand eases back to (SkinnedHumanoid.update's rule from Skeleton angles; default the
  // free arm's GUARD — the swing's mirrored left arm can sit in the hip at a thrust's low chamber).
  const restS = new THREE.Quaternion(), restEl = new THREE.Quaternion(), r = rest ?? OFF_REST;
  const ax = rig.plan.bones.find((b) => b.id === "shoulderL")?.axis ?? "x";
  restS.setFromAxisAngle(Z, boneDisplayRoll(rig.plan, "shoulderL" as BoneId))
    .multiply(qD.setFromAxisAngle(ax === "x" ? X : ax === "y" ? Y : Z, (RIG_ROTATION_SIGN.shoulderL ?? 1) * r.shoulder));
  elbowQuat(a, r.elbow, 0, restEl);
  a.parent.updateMatrixWorld(true);
  mInvParent.copy(a.parent.matrixWorld).invert();
  const S = vS.copy(a.shoulder.position); // shoulder pivot in the parent frame
  const node = rig.weaponNode;
  // The haft in the PARENT frame: point at weapon-local y (from the main grip), direction +y (toward the striking end).
  const haft = (y: number, out: THREE.Vector3) => node.localToWorld(out.set(0, y + choke, 0)).applyMatrix4(mInvParent);
  const yDir = vY.set(0, 1, 0).transformDirection(node.matrixWorld).transformDirection(mInvParent);
  const reach = a.elbow.position.length() + a.fist.length() - OFF_REACH_SLACK;
  // 1. The haft point: the designed one when the arm reaches it and a fist there clears the torso; else
  // the nearest such point of the range; else the reachable point farthest from the torso; else the closest.
  poseBoxes(rig, a);
  const fistR = (a.handL[0]?.radius ?? 0.04) + 0.02;
  const dist = (y: number) => haft(y, vP).distanceTo(S);
  const clear = (y: number) => {
    node.localToWorld(vP.set(0, y + choke, 0));
    return segTorso(a, vP, vP, fistR);
  };
  let y = plan.y, reached = true;
  if (dist(y) > reach || clear(y) < OFF_TORSO_MARGIN) {
    const [lo, hi] = plan.range, N = 40;
    let near = Infinity, yNear = Number.NaN, most = -Infinity, yMost = Number.NaN, closest = Infinity, yClosest = y;
    for (let i = 0; i <= N; i++) {
      const yi = lo + (hi - lo) * i / N, d = dist(yi), c = clear(yi);
      if (d <= reach && c >= OFF_TORSO_MARGIN && Math.abs(yi - plan.y) < near) { near = Math.abs(yi - plan.y); yNear = yi; }
      if (d <= reach && c > most) { most = c; yMost = yi; }
      if (d < closest) { closest = d; yClosest = yi; }
    }
    y = Number.isFinite(yNear) ? yNear : Number.isFinite(yMost) ? yMost : yClosest;
    reached = dist(y) <= reach;
  }
  const H = haft(y, new THREE.Vector3()), T = vT.copy(H);
  // The pole (elbow goal) in the parent frame: down, out (+x of the body: away from the other shoulder), back.
  a.otherShoulder.getWorldPosition(vA).applyMatrix4(mInvParent);
  const out = vB.copy(S).sub(vA); out.y = 0; out.normalize();
  const down = vC.set(0, -1, 0).transformDirection(mInvParent);
  const fwd = vO.set(0, 0, 1).transformDirection(rig.group.matrixWorld).transformDirection(mInvParent);
  const pole = new THREE.Vector3().addScaledVector(down, OFF_POLE.down).addScaledVector(out, OFF_POLE.out).addScaledVector(fwd, -OFF_POLE.back).normalize();
  let [theta, twist] = solveArm(a, S, T, reach, pole, yDir);
  // 5. Out of the own torso: push the target along the torso's outward normal until the hand capsule clears.
  let pushed = 0;
  for (let k = 0; k < 4; k++) {
    poseBoxes(rig, a);
    let c = Infinity, worst: Hitbox | null = null;
    for (const h of a.handL) {
      vA.set(h.wa[0], h.wa[1], h.wa[2]); vB.set(h.wb[0], h.wb[1], h.wb[2]);
      const ci = segTorso(a, vA, vB, h.radius);
      if (ci < c) { c = ci; worst = h; }
    }
    if (!worst || c >= OFF_TORSO_MARGIN) break;
    vA.set(0.5 * (worst.wa[0] + worst.wb[0]), 0.5 * (worst.wa[1] + worst.wb[1]), 0.5 * (worst.wa[2] + worst.wb[2]));
    torsoNormal(a, vA, vN).transformDirection(mInvParent);
    const step = OFF_TORSO_MARGIN - c + 0.004;
    T.addScaledVector(vN, step);
    pushed += step;
    [theta, twist] = solveArm(a, S, T, reach, pole, yDir);
  }
  // Release (OFF_RELEASE_SPAN): out of reach, or still inside the torso after the pushes.
  let inside = Infinity;
  poseBoxes(rig, a);
  for (const h of a.handL) { vA.set(h.wa[0], h.wa[1], h.wa[2]); vB.set(h.wb[0], h.wb[1], h.wb[2]); inside = Math.min(inside, segTorso(a, vA, vB, h.radius)); }
  const short = dist(y) - reach;
  let hold = Math.max(0, Math.min(1, 1 - Math.max(short, 0) / OFF_RELEASE_SPAN));
  const ikS = a.shoulder.quaternion.clone(), ikE = a.elbow.quaternion.clone();
  const blend = (w: number) => {
    a.shoulder.quaternion.slerpQuaternions(restS, ikS, w);
    a.elbow.quaternion.slerpQuaternions(restEl, ikE, w);
    a.shoulder.updateMatrixWorld(true);
  };
  const handClear = () => {
    poseBoxes(rig, a);
    let m = Infinity;
    for (const h of a.handL) { vA.set(h.wa[0], h.wa[1], h.wa[2]); vB.set(h.wb[0], h.wb[1], h.wb[2]); m = Math.min(m, segTorso(a, vA, vB, h.radius)); }
    return m;
  };
  if (hold < 1) blend(hold);
  if (inside < OFF_TORSO_MARGIN || (hold < 1 && handClear() < 0.5 * OFF_TORSO_MARGIN)) {
    // Still in the torso after the pushes: ease toward the free arm until the hand clears (bisection on the weight).
    let lo = 0, hi = hold;
    for (let i = 0; i < 8; i++) { const m = 0.5 * (lo + hi); blend(m); if (handClear() >= 0.5 * OFF_TORSO_MARGIN) lo = m; else hi = m; }
    hold = lo;
    blend(hold);
  }
  // Wave GEN (lane K): the grip weight comes from reach / torso thresholds and a bisection, so it flipped
  // between ~0 and 1 from one frame to the next (audit: the off arm jumping between the haft and the
  // guard, 0.4-1.8 rad per frame). Rate-limit it on the rig's clock (no clock = a bare rig: unchanged).
  // Then the arm itself: near a singular reach (haft along the forearm, pole along shoulder->fist) the IK's
  // elbow plane and forearm twist flip in one frame (audit: greataxe windup, twist -0.1 -> 0.84 -> 1.3);
  // the drawn shoulder/elbow may turn at most OFF_ARM_RATE·dt from last frame's (the fist lags the haft
  // for those frames instead of the arm snapping).
  {
    const tm = temporalOf(rig);
    if (tm) {
      const h = limitTo(hold, tm.state.h0, HOLD_RATE * tm.dt);
      if (h !== hold) { hold = h; blend(hold); }
      tm.state.h1 = hold;
      const step = OFF_ARM_RATE * tm.dt;
      const uS = qUS.copy(a.shoulder.quaternion), uE = qUE.copy(a.elbow.quaternion), clear0 = handClear();
      limitQuat(a.shoulder.quaternion, tm.clock.armL[0], step);
      limitQuat(a.elbow.quaternion, tm.clock.armL[1], step);
      a.shoulder.updateMatrixWorld(true);
      // The torso outranks continuity: if the lagging arm would put the fist in the body where the solved
      // arm did not, give back just enough of the lag (bisection toward the solved arm).
      const need = Math.min(clear0, 0.5 * OFF_TORSO_MARGIN);
      if (handClear() < need) {
        const lS = qLS.copy(a.shoulder.quaternion), lE = qLE.copy(a.elbow.quaternion);
        const at = (w: number) => { a.shoulder.quaternion.slerpQuaternions(lS, uS, w); a.elbow.quaternion.slerpQuaternions(lE, uE, w); a.shoulder.updateMatrixWorld(true); };
        let lo = 0, hi = 1;
        for (let i = 0; i < 8; i++) { const m = 0.5 * (lo + hi); at(m); if (handClear() >= need) hi = m; else lo = m; }
        at(hi);
      }
      tm.clock.editedL = tm.clock.n;
    }
  }
  // The shoulder's quaternion is the bone's FULL local rotation (it replaces the display roll · single-axis
  // pitch the rig wrote), so nothing of the Skeleton's mirrored left-arm angle survives on the drawn arm.
  const fist = vG.copy(a.fist).applyMatrix4(a.elbow.matrixWorld).applyMatrix4(mInvParent);
  // Lane H (wave W) fingered hands close on whatever handle is in reach when they update; the rig
  // updated them in setGrip, before the off arm got here — re-close them on the haft now.
  (rig as { hands?: { update(): void } }).hands?.update();
  return { gap: fist.distanceTo(H), y, elbow: theta, twist, reached, pushed, hold };
}
