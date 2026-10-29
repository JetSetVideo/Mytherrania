// Ragdoll ↔ skinned rig binding (V03): reads the REAL body (SkinnedHumanoid bones, the
// fighter's capsule hitboxes, the Skeleton's joint limits) into a RagdollModel, seeds the
// ragdoll from the rig's current bone world matrices, and writes the simulated bones back
// onto the THREE.Bone objects so the skinned mesh itself tumbles (no separate stick figure).
//
// While a RagdollDriver is active the ragdoll OWNS the bones: the engine must not call
// rig.update(skeleton) (which rewrites every bone from the Skeleton) nor place rig.group.
// Bone order everywhere = rig.plan.bones order. Units: metres, seconds, radians.
// @deno-types="@types/three"
import * as THREE from "three";
import type { SkinnedExtras } from "../../graphics/body/SkinnedHumanoid.ts";
import { boneDisplayRoll } from "../../graphics/body/Anatomy.ts";
import type { HitboxSet } from "../../combat/contracts.ts";
import { buildRagdollModel, type RagdollBoneInput, type RagdollModel, type V3 } from "./RagdollModel.ts";
import { Ragdoll, type RagdollReport, type RagdollSeed } from "./RagdollSolver.ts";
import type { FighterCondition } from "./MuscleTone.ts";
import type { RagdollWorld } from "./RagdollWorld.ts";

/** The parts of a skinned rig the binding needs (SkinnedHumanoid satisfies it). */
export type RagdollRig = Pick<SkinnedExtras, "plan" | "bones"> & { group: THREE.Group };

/**
 * The ragdoll's view of a rig: per bone (plan order) its parent, constant local position,
 * rest rotation at joint angle 0 (the rig's DISPLAY roll about z, exactly what
 * SkinnedHumanoid.update writes before the joint rotation) and the capsules of `boxes` on it.
 */
export function ragdollInputFromRig(rig: RagdollRig, boxes: HitboxSet): RagdollBoneInput[] {
  return rig.plan.bones.map((seg) => {
    const bone = rig.bones.get(seg.id);
    if (!bone) throw new Error(`ragdoll: rig has no bone ${seg.id}`);
    const roll = seg.parent === null ? 0 : boneDisplayRoll(rig.plan, seg.id);
    return {
      id: seg.id,
      parent: seg.parent,
      localPosition: [bone.position.x, bone.position.y, bone.position.z] as V3,
      restRotation: [0, 0, Math.sin(roll / 2), Math.cos(roll / 2)],
      capsules: boxes.boxes.filter((b) => b.bone === seg.id).map((b) => ({ a: [...b.a] as V3, b: [...b.b] as V3, radius: b.radius })),
    };
  });
}

/** Build the ragdoll model of a fighter's rig (once per fighter: it allocates). */
export function ragdollModelForRig(rig: RagdollRig, boxes: HitboxSet, skeletonLimits: ReadonlyMap<string, { min: number; max: number }>): RagdollModel {
  return buildRagdollModel(ragdollInputFromRig(rig, boxes), skeletonLimits, boxes.mass);
}

const M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3();

/** Capture every bone's world pose (7 floats: quaternion xyzw, origin xyz) into `out`, plan order. */
export function captureBoneWorld(rig: RagdollRig, out: Float64Array): Float64Array {
  rig.group.updateMatrixWorld(true);
  rig.plan.bones.forEach((seg, i) => {
    M.copy(rig.bones.get(seg.id)!.matrixWorld).decompose(P, Q, S);
    out[i * 7] = Q.x; out[i * 7 + 1] = Q.y; out[i * 7 + 2] = Q.z; out[i * 7 + 3] = Q.w;
    out[i * 7 + 4] = P.x; out[i * 7 + 5] = P.y; out[i * 7 + 6] = P.z;
  });
  return out;
}

/**
 * Write the ragdoll pose onto the rig: the group goes to the identity (the root bone carries
 * the world pose) and every bone gets its local rotation and position. `scratch` holds
 * 7 floats per bone (RagdollDriver owns one).
 */
export function applyRagdollToRig(rd: Ragdoll, rig: RagdollRig, scratch: Float64Array): void {
  rd.writeBones(scratch);
  rig.group.position.set(0, 0, 0);
  rig.group.rotation.set(0, 0, 0);
  rig.plan.bones.forEach((seg, i) => {
    const bone = rig.bones.get(seg.id)!;
    bone.quaternion.set(scratch[i * 7], scratch[i * 7 + 1], scratch[i * 7 + 2], scratch[i * 7 + 3]);
    bone.position.set(scratch[i * 7 + 4], scratch[i * 7 + 5], scratch[i * 7 + 6]);
  });
}

/** What the engine knows about the throw that started the fall. */
export interface RagdollStart {
  /** The fighter's condition: HP, stamina, damage meter, strength, statuses. */
  condition: FighterCondition;
  /** Whole-body velocity at the moment of the ring-out / KO, m/s. */
  velocity: [number, number, number];
  /** The last impact (impulse at a point), if any. */
  impact?: RagdollSeed["impact"];
  /** The rig's pose one frame earlier (captureBoneWorld) and that frame's dt, for joint velocities. */
  prevBoneWorld?: Float64Array;
  prevDt?: number;
}

/**
 * One fighter's ragdoll, ready to start: build it once per fighter (the model costs a few ms),
 * `start()` it when the body is ejected, then `update()` it every frame. Allocates only in the
 * constructor.
 */
export class RagdollDriver {
  readonly ragdoll: Ragdoll;
  readonly #rig: RagdollRig;
  readonly #bones: Float64Array;
  readonly #out: Float64Array;
  active = false;

  constructor(rig: RagdollRig, boxes: HitboxSet, skeletonLimits: ReadonlyMap<string, { min: number; max: number }>, gravity?: number) {
    this.#rig = rig;
    this.ragdoll = new Ragdoll(ragdollModelForRig(rig, boxes, skeletonLimits), gravity);
    this.#bones = new Float64Array(rig.plan.bones.length * 7);
    this.#out = new Float64Array(rig.plan.bones.length * 7);
  }

  /** The rig's current pose into a reusable buffer (call each frame BEFORE a possible start for joint velocities). */
  capture(out: Float64Array = new Float64Array(this.#rig.plan.bones.length * 7)): Float64Array {
    return captureBoneWorld(this.#rig, out);
  }

  /** Take over the bones: seed from the rig's current pose and the throw (see RagdollStart). */
  start(s: RagdollStart): void {
    captureBoneWorld(this.#rig, this.#bones);
    this.ragdoll.setCondition(s.condition);
    this.ragdoll.seed({
      boneWorld: this.#bones, velocity: s.velocity, impact: s.impact,
      prevBoneWorld: s.prevBoneWorld, prevDt: s.prevDt,
    });
    this.active = true;
  }

  /** Advance the fall and pose the real mesh. Returns the solver's report (cost, contacts, medium). */
  update(dt: number, world: RagdollWorld): RagdollReport {
    const r = this.ragdoll.step(dt, world);
    applyRagdollToRig(this.ragdoll, this.#rig, this.#out);
    return r;
  }

  /**
   * Hand the bones back: restore every bone's REST local pose (the ragdoll moved the root bone
   * in world space and turned it; SkinnedHumanoid.update rewrites only the joint bones, never
   * the root) — the next rig.update rebuilds the joints from the Skeleton and the engine places
   * rig.group again.
   */
  stop(): void {
    const m = this.ragdoll.model;
    this.#rig.plan.bones.forEach((seg, i) => {
      const bone = this.#rig.bones.get(seg.id)!;
      bone.position.set(m.boneLocalPos[i * 3], m.boneLocalPos[i * 3 + 1], m.boneLocalPos[i * 3 + 2]);
      bone.quaternion.set(m.boneRestRot[i * 4], m.boneRestRot[i * 4 + 1], m.boneRestRot[i * 4 + 2], m.boneRestRot[i * 4 + 3]);
    });
    this.active = false;
  }
}
