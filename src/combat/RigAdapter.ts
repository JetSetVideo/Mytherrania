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
import type { BoneId } from "../graphics/body/contracts.ts";
import { RIG_ROTATION_SIGN } from "../game/anim/Rig.ts";
import type { JointName, Skeleton } from "../game/Skeleton.ts";
import type { HitboxSet, WeaponSpec } from "./contracts.ts";
import { updateHitboxes } from "./Hitboxes.ts";
import {
  type ClearanceJoint, type ClearanceResult, SELF_JOINT_WEIGHT, selfClearance, type SelfOptions, selfPenetration, solveSelfClearance,
} from "./SelfGuard.ts";

/** The rig lane X works on: lane A's skinned humanoid. */
export type CombatRig = HumanoidRig & SkinnedExtras;

/** Wrist range the solver may use on the grip group, rad: pitch (flexion) and roll (pronation). */
export const GRIP_PITCH_RANGE: [number, number] = [-2.4, 1.2];
export const GRIP_ROLL_RANGE: [number, number] = [-1.8, 1.8];

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
  }

  /** Write DOF values (same order as the joint names) to the bones / grip and refresh the subtree. */
  apply(angles: ArrayLike<number>): void {
    for (let i = 0; i < this.#names.length; i++) {
      const bone = this.#bones[i], name = this.#names[i];
      if (bone) {
        this.#q.setFromAxisAngle(this.#axis[i], this.#sign[i] * angles[i]);
        bone.quaternion.copy(this.#rest[i]).multiply(this.#q);
      } else if (name === "gripPitch") this.#grip.rotation.x = angles[i];
      else if (name === "gripRoll") this.#grip.rotation.z = angles[i];
    }
    this.#root.updateMatrixWorld(true);
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
      if (name === "gripPitch") return { name, angle: this.#grip.rotation.x, min: GRIP_PITCH_RANGE[0], max: GRIP_PITCH_RANGE[1], weight };
      if (name === "gripRoll") return { name, angle: this.#grip.rotation.z, min: GRIP_ROLL_RANGE[0], max: GRIP_ROLL_RANGE[1], weight };
      const j = sk.joint(name as JointName), l = lim.get(name as JointName)!;
      return { name, angle: j.angle, min: l.min, max: l.max, weight };
    });
  }

  /**
   * Measure; if the weapon is inside its holder, solve the minimal arm correction, leave the rig
   * in the corrected pose and (writeBack) store the corrected joint angles in the Skeleton.
   */
  solve(sk: Skeleton): ClearanceResult {
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
