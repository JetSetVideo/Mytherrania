// Joint helper bones (wave W, lane H): the elbow and knee creases without the linear-blend collapse.
//
// Measured (tools/probe-creases.ts): with plain two-bone linear blending, the skin band an elbow
// shares between the upper-arm and forearm bones moves along the CHORD between the two rotations, so
// at the guard's 1.45 rad flexion the inner elbow fell to 0.33–0.38 of the joint radius from the bone
// axis and 15–31 triangles turned inside out on the dwarf/ork (the dark "pinched" wedge a vision pass
// flagged in the wave-V close-ups). Wave V's narrowed joint cores and the cubital fossa deepened it
// (pre-wave-V forms: 0.45–0.63).
//
// Fix, render-only: one HELPER bone per elbow/knee, a child of the upper bone placed exactly on the
// joint, that turns by HALF the joint's hinge angle every frame. The shared band's weights move onto
// it: a vertex weighted (a upper, b lower) becomes (a − m, b − m, 2m on the helper) with m = min(a, b),
// so the middle of the band turns rigidly by θ/2 (on the ARC, no shrink) instead of averaging R(0) and
// R(θ). The game skeleton, the anatomy plan, the hitboxes and the ragdoll never see the helpers.
// @deno-types="@types/three"
import * as THREE from "three";
import type { BoneId } from "./contracts.ts";
import type { DetailedAnatomy } from "./Anatomy.ts";

/** One helper: the joint bone it follows and the upper bone it hangs from. */
export interface JointHelper {
  joint: THREE.Bone;
  upper: THREE.Bone;
  helper: THREE.Bone;
  /** The joint bone's display rest rotation (bone.quaternion at angle 0). */
  rest: THREE.Quaternion;
  /** Hinge axis in the joint bone's local frame. */
  axis: THREE.Vector3;
  /** The lower segment's direction in the joint bone's local frame (to read the hinge angle). */
  lower: THREE.Vector3;
  /** Skeleton indices of upper, joint, helper. */
  iu: number; ij: number; ih: number;
}

/** The joints that get a helper: [joint, upper bone, lower-segment end anchor]. */
export const HELPED: readonly [BoneId, BoneId][] = [["elbowL", "shoulderL"], ["elbowR", "shoulderR"], ["kneeL", "hipL"], ["kneeR", "hipR"]];

/**
 * Create the helper bones (call BEFORE `new THREE.Skeleton(boneList)`: they are appended to
 * `boneList`, positioned and rotated like their joint bone at bind so their inverse bind matrix is the
 * joint's). `worldRest` maps a bone id to its bind world rotation.
 */
export function createJointHelpers(plan: DetailedAnatomy, bones: ReadonlyMap<BoneId, THREE.Bone>, boneList: THREE.Bone[], worldRest: ReadonlyMap<BoneId, THREE.Quaternion>, displayRest: ReadonlyMap<BoneId, THREE.Quaternion>): JointHelper[] {
  const out: JointHelper[] = [];
  for (const [jid, uid] of HELPED) {
    const joint = bones.get(jid), upper = bones.get(uid);
    const seg = plan.bones.find((b) => b.id === jid);
    if (!joint || !upper || !seg) continue;
    const helper = new THREE.Bone();
    helper.name = `${jid}-crease`;
    helper.position.copy(joint.position);
    helper.quaternion.copy(joint.quaternion);
    upper.add(helper);
    const iu = boneList.indexOf(upper), ij = boneList.indexOf(joint);
    boneList.push(helper);
    const axis = seg.axis === "x" ? new THREE.Vector3(1, 0, 0) : seg.axis === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    const dir = new THREE.Vector3(seg.tail[0] - seg.head[0], seg.tail[1] - seg.head[1], seg.tail[2] - seg.head[2]).normalize()
      .applyQuaternion(worldRest.get(jid)!.clone().invert());
    out.push({ joint, upper, helper, rest: displayRest.get(jid)!.clone(), axis, lower: dir, iu, ij, ih: boneList.length - 1 });
  }
  return out;
}

const qRel = new THREE.Quaternion(), qHalf = new THREE.Quaternion(), vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
/**
 * The hinge angle the joint bone carries now (rad, about its axis), whatever else (a forearm twist)
 * rides on it: the lower segment's direction turned by rest⁻¹·q, projected on the hinge plane.
 */
export function hingeAngle(h: JointHelper): number {
  qRel.copy(h.rest).invert().multiply(h.joint.quaternion);
  vA.copy(h.lower).addScaledVector(h.axis, -h.lower.dot(h.axis));
  vB.copy(h.lower).applyQuaternion(qRel);
  vB.addScaledVector(h.axis, -vB.dot(h.axis));
  return Math.atan2(vC.crossVectors(vA, vB).dot(h.axis), vA.dot(vB));
}

/** Turn every helper by half its joint's current hinge angle (call after the joints are posed). */
export function syncJointHelpers(helpers: readonly JointHelper[]): void {
  for (const h of helpers) {
    const a = hingeAngle(h);
    h.helper.quaternion.copy(h.rest).multiply(qHalf.setFromAxisAngle(h.axis, 0.5 * a));
  }
}

/** Half-width of the crease band along the limb, × the joint radius (elbow: upperArmDistal, knee: knee). */
export const CREASE_BAND = 1.8;

/** The bind geometry the band needs per helper: joint position, limb axis (down the limb), half-width. */
export interface CreaseBand { at: readonly number[]; axis: readonly number[]; half: number }

/** Bands of the four helpers from the anatomy (straight limbs in the bind pose). */
export function creaseBands(plan: DetailedAnatomy, helpers: readonly JointHelper[]): CreaseBand[] {
  return helpers.map((h) => {
    const id = h.joint.name as BoneId;
    const side = id.endsWith("L") ? 0 : 1;
    if (id.startsWith("elbow")) {
      const a = plan.arms[side];
      return { at: a.elbow, axis: a.frame.d, half: CREASE_BAND * plan.proportions.radius.upperArmDistal };
    }
    const l = plan.legs[side];
    return { at: l.knee, axis: l.frame.d, half: CREASE_BAND * plan.proportions.radius.knee };
  });
}

/**
 * Re-weight the joint bands onto three bones (returns NEW arrays; the inputs may be a cached body's).
 * A vertex weighted to a joint's upper and/or lower bone and lying within the band (|t| < half, t the
 * bind distance past the joint along the limb) takes the quadratic Bernstein blend of the three
 * rotations 0, θ/2, θ — upper (1−s)², helper 2s(1−s), lower s² with s = smoothstep(−half, half, t) —
 * scaled to the mass the pair had; other bones' weights (a torso share) are untouched. The skin then
 * bends along a smooth arc instead of averaging two rotations at a narrow seam.
 */
export function creaseWeights(skinIndex: Uint16Array, skinWeight: Float32Array, helpers: readonly JointHelper[], positions?: ArrayLike<number>, bands?: readonly CreaseBand[]): { skinIndex: Uint16Array; skinWeight: Float32Array; moved: number } {
  const si = skinIndex.slice(), sw = skinWeight.slice();
  const n = si.length / 4;
  let moved = 0;
  const slots: number[] = [];
  for (let v = 0; v < n; v++) {
    for (let hk = 0; hk < helpers.length; hk++) {
      const h = helpers[hk];
      let su = -1, sj = -1;
      for (let s = 0; s < 4; s++) {
        if (sw[v * 4 + s] <= 0) continue;
        if (si[v * 4 + s] === h.iu) su = s; else if (si[v * 4 + s] === h.ij) sj = s;
      }
      if (su < 0 && sj < 0) continue;
      const a = su >= 0 ? sw[v * 4 + su] : 0, b = sj >= 0 ? sw[v * 4 + sj] : 0, mass = a + b;
      let wu: number, wh: number, wl: number;
      const band = bands?.[hk];
      if (band && positions) {
        const t = (positions[v * 3] - band.at[0]) * band.axis[0] + (positions[v * 3 + 1] - band.at[1]) * band.axis[1] + (positions[v * 3 + 2] - band.at[2]) * band.axis[2];
        if (Math.abs(t) >= band.half) {
          if (su < 0 || sj < 0) continue; // a plain one-bone vertex outside the band stays as it is
          const m = Math.min(a, b); wu = a - m; wh = 2 * m; wl = b - m; // outside the band: the min rule
        } else {
          const x = Math.max(0, Math.min(1, (t + band.half) / (2 * band.half))), sm = x * x * (3 - 2 * x);
          wu = (1 - sm) * (1 - sm) * mass; wh = 2 * sm * (1 - sm) * mass; wl = sm * sm * mass;
        }
      } else {
        if (su < 0 || sj < 0) continue;
        const m = Math.min(a, b); wu = a - m; wh = 2 * m; wl = b - m;
      }
      // Write the three weights into the vertex's slots: reuse su/sj, then free slots, then the smallest.
      slots.length = 0;
      if (su >= 0) slots.push(su);
      if (sj >= 0) slots.push(sj);
      for (let s = 0; s < 4 && slots.length < 3; s++) if (!slots.includes(s) && sw[v * 4 + s] <= 0) slots.push(s);
      if (slots.length < 3) {
        // No free slot: drop the smallest other influence, renormalising the rest.
        let sMin = -1;
        for (let s = 0; s < 4; s++) if (!slots.includes(s) && (sMin < 0 || sw[v * 4 + s] < sw[v * 4 + sMin])) sMin = s;
        const lost = sw[v * 4 + sMin];
        sw[v * 4 + sMin] = 0;
        const keep = 1 - lost;
        for (let s = 0; s < 4; s++) sw[v * 4 + s] /= keep || 1;
        wu /= keep || 1; wh /= keep || 1; wl /= keep || 1;
        slots.push(sMin);
      }
      const ws = [wu, wh, wl], ids = [h.iu, h.ih, h.ij];
      for (let k = 0; k < 3; k++) { si[v * 4 + slots[k]] = ids[k]; sw[v * 4 + slots[k]] = ws[k]; }
      moved++;
      break;
    }
  }
  return { skinIndex: si, skinWeight: sw, moved };
}
void vC;
