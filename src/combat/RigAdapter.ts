// Lane X: the THREE side of the combat model — reads the skinned rig (bones, weapon node) and
// drives the weapon arm for the self-clearance solver. Everything numeric lives in the pure
// modules (Hitboxes, Sweep, Impact, SelfGuard); this file only moves matrices.
//
// Bone rotation rule (identical to SkinnedHumanoid.update): bone.quaternion =
//   Rz(boneDisplayRoll(plan, id)) · R_axis(RIG_ROTATION_SIGN[id] · angle)
// so a joint angle written here renders exactly like one written by the Skeleton.

// @deno-types="@types/three"
import * as THREE from "three";
import type { HumanoidRig } from "../graphics/Humanoid.ts";
import type { SkinnedExtras } from "../graphics/body/SkinnedHumanoid.ts";
import { boneDisplayRoll } from "../graphics/body/Anatomy.ts";
import { HAND_PRONATION } from "../graphics/body/AnatomyParts.ts";
import type { BoneId } from "../graphics/body/contracts.ts";
import { RIG_ROTATION_SIGN } from "../game/anim/Rig.ts";
import type { JointName, Skeleton } from "../game/Skeleton.ts";
import type { HitboxSet, WeaponSpec } from "./contracts.ts";
import { updateHitboxes } from "./Hitboxes.ts";
import { convergeWeaponArm, weaponArmConvergenceOf } from "./OffHand.ts";
import {
  type ClearanceJoint, type ClearanceResult, SELF_JOINT_WEIGHT, selfClearance, type SelfOptions, selfPenetration, solveSelfClearance,
} from "./SelfGuard.ts";

/** The rig lane X works on: lane A's skinned humanoid. */
export type CombatRig = HumanoidRig & SkinnedExtras;

/** Wrist range the solver may use on the grip group, rad: pitch (flexion) and roll (pronation). */
export const GRIP_PITCH_RANGE: [number, number] = [-2.4, 1.2];
export const GRIP_ROLL_RANGE: [number, number] = [-1.8, 1.8];
/**
 * Lane G (wave V): how far (rad) the clearance solver may turn the grip group from the pose the
 * hand mapping drew (SwingDriver.gripEulerOf). The grip group is the only "wrist" and the hand mesh
 * does not follow it, so a free wrist DOF re-opened the handle-along-the-fingers bug whenever the
 * guard fired; past this the shoulder and elbow take the correction.
 */
export const GUARD_WRIST_SLACK = 0.2;

const IDENTITY = new THREE.Matrix4().elements;

/** boneWorld callback for updateHitboxes: the bone's matrixWorld elements (identity if unknown). */
export function boneWorldOf(rig: CombatRig): (bone: string) => Float32Array | number[] {
  return (bone) => rig.bones.get(bone as BoneId)?.matrixWorld.elements ?? IDENTITY;
}

/** The weapon's local->world matrix (weaponNode.matrixWorld), copied into `out`. */
export function weaponMatrix(rig: CombatRig, out: Float32Array = new Float32Array(16)): Float32Array {
  out.set(rig.weaponNode.matrixWorld.elements);
  return out;
}

/**
 * Lane G (wave V): the HAND frame of one arm, in world space, from the anatomy's own landmarks.
 * The hand is rigid on the forearm bone (elbowL/elbowR: there is no wrist bone), so its frame is
 * the bind-space frame of AnatomyParts.handNode mapped through that bone's skinning transform
 * (bone.matrixWorld · boneInverse — the SkinnedMesh binds with the group at the identity).
 *   d  finger axis (wrist -> fingertips)      n  back-of-hand normal (the palm faces −n)
 *   w  across the palm, toward the thumb: the line a held handle runs along (the fist closes about it)
 */
export interface HandFrameWorld {
  wrist: THREE.Vector3; palm: THREE.Vector3; grip: THREE.Vector3; fingertip: THREE.Vector3;
  d: THREE.Vector3; n: THREE.Vector3; w: THREE.Vector3;
}

/** The bind-space hand frame of arm `i` (0 = left, 1 = right): [d, n, w] unit tuples. */
export function handFrameBind(rig: CombatRig, i: 0 | 1): [V3t, V3t, V3t] {
  const F = rig.plan.arms[i].frame, cp = Math.cos(HAND_PRONATION), sp = Math.sin(HAND_PRONATION);
  const n: V3t = [F.o[0] * cp + F.f[0] * sp, F.o[1] * cp + F.f[1] * sp, F.o[2] * cp + F.f[2] * sp];
  const w: V3t = [F.f[0] * cp - F.o[0] * sp, F.f[1] * cp - F.o[1] * sp, F.f[2] * cp - F.o[2] * sp];
  return [[F.d[0], F.d[1], F.d[2]], n, w];
}
type V3t = [number, number, number];

/** World hand frame of the left (0) or right (1) arm in the rig's CURRENT matrices (call after updateMatrixWorld). */
export function handFrameWorld(rig: CombatRig, i: 0 | 1): HandFrameWorld {
  const bone = rig.bones.get(i === 1 ? "elbowR" : "elbowL")!;
  const idx = rig.skin.skeleton.bones.indexOf(bone);
  const m = new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, rig.skin.skeleton.boneInverses[idx]);
  const a = rig.plan.arms[i];
  const pt = (p: ArrayLike<number>) => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(m);
  const dir = (p: ArrayLike<number>) => new THREE.Vector3(p[0], p[1], p[2]).transformDirection(m);
  const [d, n, w] = handFrameBind(rig, i);
  return { wrist: pt(a.wrist), palm: pt(a.palm), grip: pt(a.grip), fingertip: pt(a.fingertip), d: dir(d), n: dir(n), w: dir(w) };
}

/**
 * The right hand's frame [d, n, w] in the GRIP MOUNT's space (the parent of the grip group that
 * rig.setGrip rotates). The mount and the hand are both rigid on the forearm bone, so this is a
 * constant of the rig: measure it once (SwingSetup.hand) and the pure wrist solver
 * (game/PalmWeapon.gripEuler) turns a wrist pitch/roll into the grip's Euler angles.
 */
export function handFrameInMount(rig: CombatRig): [V3t, V3t, V3t] {
  rig.group.updateMatrixWorld(true);
  const grip = rig.weaponNode.parent ?? rig.weaponNode, mount = grip.parent ?? grip;
  const inv = new THREE.Matrix4().copy(mount.matrixWorld).invert();
  const hf = handFrameWorld(rig, 1);
  const t = (v: THREE.Vector3): V3t => { const u = v.clone().transformDirection(inv); return [u.x, u.y, u.z]; };
  return [t(hf.d), t(hf.n), t(hf.w)];
}

/**
 * Lane G (wave V): forearm SUPINATION of the weapon arm while it grips, rad about the forearm's own
 * axis. The rig's relaxed hand is pronated (AnatomyParts.HAND_PRONATION 0.6: thumb turned in toward
 * the body), so a handle laid across its palm leaned ~33° across the holder's face at guard; a hand
 * that grips turns the thumb up instead. Rotating the forearm bone by exactly the pronation puts the
 * thumb axis back in the arm plane, where Swing.ts aims the blade. The hand and the grip mount ride
 * the same bone, so the hand frame in the mount (handFrameInMount) is unchanged by it.
 */
export const GRIP_SUPINATION = HAND_PRONATION;
// (PalmWeapon.GRIP_SUPINATION_DEFAULT is the same number for the pure modules; a test pins it.)

interface TwistData { axis: THREE.Vector3; rest: THREE.Quaternion; hinge: THREE.Vector3; sign: number }
const TWIST = new WeakMap<object, TwistData>();
/** The elbowR bone's twist data (cached per rig): the forearm's long axis in the bone's LOCAL frame, its display rest and hinge. */
function twistOf(rig: CombatRig): TwistData {
  let t = TWIST.get(rig);
  if (!t) {
    const bone = rig.bones.get("elbowR")!, idx = rig.skin.skeleton.bones.indexOf(bone);
    const d = rig.plan.arms[1].frame.d;
    const a = rig.plan.bones.find((b) => b.id === "elbowR")?.axis ?? "x";
    t = {
      axis: new THREE.Vector3(d[0], d[1], d[2]).transformDirection(rig.skin.skeleton.boneInverses[idx]),
      rest: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), boneDisplayRoll(rig.plan, "elbowR")),
      hinge: new THREE.Vector3(a === "x" ? 1 : 0, a === "y" ? 1 : 0, a === "z" ? 1 : 0),
      sign: RIG_ROTATION_SIGN.elbowR ?? 1,
    };
    TWIST.set(rig, t);
  }
  return t;
}
/** The right forearm's long axis (wrist direction) in the elbowR bone's LOCAL frame. */
export function forearmAxisLocal(rig: CombatRig): THREE.Vector3 { return twistOf(rig).axis; }

const GRIP_TWIST = new WeakMap<object, number>();
/**
 * The forearm supination measured for this rig (SwingRig.solveGripTwist, stored by measureAimLine),
 * or 0 for a rig no swing was ever set up on (the bare rig). The engine, every ArmGuard and any
 * harness that measured the aim line then all draw the same forearm.
 */
export function gripTwistOf(rig: object): number { return GRIP_TWIST.get(rig) ?? 0; }
/** Store the rig's grip supination (SwingRig.measureAimLine). */
export function setGripTwist(rig: object, twist: number): void { GRIP_TWIST.set(rig, twist); }

const qTwist = new THREE.Quaternion(), qHinge = new THREE.Quaternion();
/**
 * Pose the weapon forearm (elbowR) for the elbow angle `elbow` (the Skeleton's) and supinate it by
 * `twist` about its own axis: bone.quaternion = Rz(display roll) · R_hinge(sign · elbow) · R_axis(twist)
 * — SkinnedHumanoid.update's rule plus the twist, written from scratch so it is IDEMPOTENT (the engine
 * after rig.update, measureAimLine and every ArmGuard.solve may all call it in one frame).
 */
export function applyForearmTwist(rig: CombatRig, elbow: number, twist = GRIP_SUPINATION): void {
  const bone = rig.bones.get("elbowR");
  if (!bone) return;
  const t = twistOf(rig);
  bone.quaternion.copy(t.rest).multiply(qHinge.setFromAxisAngle(t.hinge, t.sign * elbow));
  if (twist !== 0) bone.quaternion.multiply(qTwist.setFromAxisAngle(t.axis, twist));
}

/** Guard options: SelfOptions plus which arm DOFs the solver may use. */
export interface ArmGuardOptions extends SelfOptions {
  /** DOFs, Skeleton joints or "gripPitch"/"gripRoll". Default: shoulder, elbow, grip pitch and roll of the grip side. */
  joints?: string[];
  /** Write the corrected Skeleton joint angles back (diagnostics/DepthGuard see the truth). Default true. */
  writeBack?: boolean;
  /**
   * Lane X2: bone matrices that pose the guarded hitbox set when it is NOT the holder's own body
   * (the OTHER fighter's rig: boneWorldOf(otherRig)) — the guard then keeps the blade out of that
   * body. Default: the holder's rig. Pair with `excludeGrip: false`.
   */
  targetBones?: (bone: string) => Float32Array | number[];
  /** Lane G: forearm supination (rad) the guard keeps on the grip-side forearm (ArmGuard.twist). Default: gripTwistOf(rig). */
  twist?: number;
}

/**
 * Keeps one fighter's weapon out of its own body. Construct once per fighter; call solve() each
 * frame AFTER rig.update, rig.setGrip and the group placement (it calls updateMatrixWorld itself).
 */
export class ArmGuard {
  readonly #rig: CombatRig;
  readonly #own: HitboxSet;
  readonly #weapon: WeaponSpec;
  readonly #opts: ArmGuardOptions;
  readonly #names: string[];
  readonly #bones: (THREE.Bone | null)[];
  readonly #rest: THREE.Quaternion[];
  readonly #axis: THREE.Vector3[];
  readonly #sign: number[];
  readonly #grip: THREE.Object3D;
  readonly #root: THREE.Object3D;
  readonly #m = new Float32Array(16);
  readonly #q = new THREE.Quaternion();
  readonly #boneWorld: (bone: string) => Float32Array | number[];
  #twist: number | undefined;
  /**
   * Lane G: supination of the grip-side forearm: ArmGuardOptions.twist, else the rig's measured grip
   * twist (gripTwistOf: 0 on a bare rig). solve() starts by re-posing elbowR with it (idempotent) and
   * apply() keeps it, so the guard measures the forearm the engine draws.
   */
  get twist(): number { return this.#twist ?? gripTwistOf(this.#rig); }
  set twist(t: number) { this.#twist = t; }
  /** Last result (QA). */
  last: ClearanceResult | null = null;
  /** Zone+side of the deepest own hitbox at the last solve's first measure (QA). */
  worst = "";

  constructor(rig: CombatRig, own: HitboxSet, weapon: WeaponSpec, opts: ArmGuardOptions = {}) {
    this.#rig = rig; this.#own = own; this.#weapon = weapon; this.#opts = opts;
    const s = opts.gripSide ?? "R";
    this.#names = opts.joints ?? [`shoulder${s}`, `elbow${s}`, "gripPitch", "gripRoll"];
    this.#bones = this.#names.map((n) => rig.bones.get(n as BoneId) ?? null);
    this.#rest = this.#names.map((n) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rig.bones.has(n as BoneId) ? boneDisplayRoll(rig.plan, n as BoneId) : 0));
    this.#axis = this.#names.map((n) => {
      const a = rig.plan.bones.find((b) => b.id === n)?.axis ?? "x";
      return new THREE.Vector3(a === "x" ? 1 : 0, a === "y" ? 1 : 0, a === "z" ? 1 : 0);
    });
    this.#sign = this.#names.map((n) => RIG_ROTATION_SIGN[n as JointName] ?? 1);
    this.#grip = rig.weaponNode.parent ?? rig.weaponNode;
    // The highest moved bone: updating its subtree refreshes every moved matrix.
    this.#root = this.#bones.find((b) => b) ?? this.#grip;
    this.#boneWorld = opts.targetBones ?? boneWorldOf(rig);
    this.#twist = opts.twist;
  }

  /** Write DOF values (same order as the joint names) to the bones / grip and refresh the subtree. */
  apply(angles: ArrayLike<number>): void {
    for (let i = 0; i < this.#names.length; i++) {
      const bone = this.#bones[i], name = this.#names[i];
      if (bone) {
        this.#q.setFromAxisAngle(this.#axis[i], this.#sign[i] * angles[i]);
        bone.quaternion.copy(this.#rest[i]).multiply(this.#q);
        if (this.twist !== 0 && name === "elbowR") bone.quaternion.multiply(this.#q.setFromAxisAngle(forearmAxisLocal(this.#rig), this.twist));
      } else if (name === "gripPitch") this.#grip.rotation.x = angles[i];
      else if (name === "gripRoll") this.#grip.rotation.z = angles[i];
    }
    this.#root.updateMatrixWorld(true);
    // Lane T (wave W): a two-handed grip converges the weapon arm toward the midline (OffHand.ts); the
    // guard draws and measures that same arm, so its correction holds for the arm on screen.
    const conv = this.#names.includes("shoulderR") ? weaponArmConvergenceOf(this.#rig) : 0;
    if (conv !== 0) convergeWeaponArm(this.#rig, conv);
  }

  /** Signed penetration (m) of the weapon into its holder in the rig's CURRENT matrices. */
  measure(): number {
    updateHitboxes(this.#own, this.#boneWorld);
    return selfClearance({ matrix: weaponMatrix(this.#rig, this.#m), time: 0 }, this.#own, this.#weapon, this.#opts);
  }

  /** The DOFs as solver joints, read from the Skeleton and the grip group. */
  joints(sk: Skeleton): ClearanceJoint[] {
    const lim = sk.limits();
    return this.#names.map((name) => {
      const weight = SELF_JOINT_WEIGHT[name] ?? 3;
      if (name === "gripPitch" || name === "gripRoll") {
        const angle = name === "gripPitch" ? this.#grip.rotation.x : this.#grip.rotation.z;
        const r = name === "gripPitch" ? GRIP_PITCH_RANGE : GRIP_ROLL_RANGE;
        return { name, angle, min: Math.max(r[0], angle - GUARD_WRIST_SLACK), max: Math.min(r[1], angle + GUARD_WRIST_SLACK), weight };
      }
      const j = sk.joint(name as JointName), l = lim.get(name as JointName)!;
      return { name, angle: j.angle, min: l.min, max: l.max, weight };
    });
  }

  /**
   * Measure; if the weapon is inside its holder, solve the minimal arm correction, leave the rig
   * in the corrected pose and (writeBack) store the corrected joint angles in the Skeleton.
   */
  solve(sk: Skeleton): ClearanceResult {
    if (this.twist !== 0 && this.#names.includes("elbowR")) applyForearmTwist(this.#rig, sk.joint("elbowR").angle, this.twist);
    this.#rig.group.updateMatrixWorld(true);
    const joints = this.joints(sk);
    const start = Float64Array.from(joints, (j) => j.angle);
    const pen0 = this.measure();
    this.worst = "";
    if (pen0 <= 0) {
      this.last = { angles: start, deltas: new Float64Array(joints.length), before: pen0, after: pen0, iterations: 0, evaluations: 1 };
      return this.last;
    }
    const deep = selfPenetration({ matrix: this.#m, time: 0 }, this.#own, this.#weapon, this.#opts);
    this.worst = deep.hitbox ? `${deep.hitbox.zone}${deep.hitbox.side}` : "";
    const res = solveSelfClearance({
      joints,
      penetration: (a) => { this.apply(a); return this.measure(); },
    });
    this.apply(res.angles);
    updateHitboxes(this.#own, this.#boneWorld);
    if (this.#opts.writeBack !== false) {
      joints.forEach((j, i) => { if (this.#bones[i]) sk.joint(j.name as JointName).angle = res.angles[i]; });
    }
    this.last = res;
    return res;
  }
}
