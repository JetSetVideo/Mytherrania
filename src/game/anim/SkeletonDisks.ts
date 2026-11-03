// Wave GEN (lane K, for P's Skeleton stage): the node-and-disk skeleton and the T-pose inspection pose.
// Pure (no THREE, no DOM): reads only the plan's bones, proportions and limb anchors.
//
// skeletonDisks(plan): one cross-section ellipse per joint, read from the plan's own radii
//   (Proportions half-widths / half-depths / limb radii). A disk sits at a bone's HEAD (the joint),
//   its normal along the bone (head -> tail), rx its semi-axis in the body's lateral (x) direction
//   projected off the normal, rz the depth semi-axis. Extra disks: the wrist and the hand (palm) on each
//   arm, the ball of each foot, and the skull centre — the places the silhouette is read at.
// tPose(plan): the joint (bone head) positions with each ARM straightened and swung up to horizontal
//   about its shoulder (lengths kept, legs/trunk untouched). The BIND pose stays the solved A-pose
//   (skinning, ragdoll and every rig test read it); the T-pose is a display pose only (BRIEF deviation 1).
//   Digits are render-only (HandRig) and are not plan bones: the inspection pose shows the mitten at the
//   arm's end, i.e. digits at minimal divergence.
import type { BoneId, BoneSegment, Vec3 } from "../../graphics/body/contracts.ts";

/** One cross-section ellipse (model space, metres). */
export interface SkeletonDisk { bone: BoneId; at: Vec3; normal: Vec3; rx: number; rz: number; label: string }

/** The structural slice of DetailedAnatomy this module reads (any plan from Anatomy.anatomyFor fits). */
export interface DiskPlan {
  bones: BoneSegment[];
  proportions: {
    halfWidth: { chest: number; waist: number; hip: number; neck: number; skull: number };
    halfDepth: { chest: number; belly: number; pelvis: number; skull: number };
    radius: {
      deltoid: number; foreArm: number; wrist: number; palmHalfWidth: number; palmHalfThickness: number;
      thighTop: number; knee: number; ankle: number; footHalfWidth: number; heel: number;
    };
  };
  arms?: readonly { wrist: Vec3; palm: Vec3 }[];
  legs?: readonly { ball: Vec3 }[];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Per bone: the head-joint cross-section (rx lateral, rz depth), metres, and a label. */
function headSection(id: BoneId, P: DiskPlan["proportions"]): { rx: number; rz: number; label: string } {
  const r = P.radius, hw = P.halfWidth, hd = P.halfDepth;
  switch (id) {
    case "root": return { rx: hw.hip, rz: hd.pelvis, label: "pelvis" };
    case "abdomen": return { rx: hw.waist, rz: hd.belly, label: "waist" };
    case "spine": return { rx: hw.chest, rz: hd.chest, label: "chest" };
    case "neck": return { rx: hw.neck, rz: hw.neck, label: "neck" };
    case "head": return { rx: hw.neck, rz: hw.neck, label: "skull base" };
    case "shoulderL": case "shoulderR": return { rx: r.deltoid, rz: r.deltoid, label: "shoulder" };
    case "elbowL": case "elbowR": return { rx: r.foreArm, rz: r.foreArm, label: "elbow" };
    case "hipL": case "hipR": return { rx: r.thighTop, rz: r.thighTop, label: "hip" };
    case "kneeL": case "kneeR": return { rx: r.knee, rz: r.knee, label: "knee" };
    case "ankleL": case "ankleR": return { rx: r.ankle, rz: r.heel, label: "ankle" };
    default: return { rx: r.footHalfWidth, rz: 0.5 * r.footHalfWidth, label: "toe" };
  }
}

/** The plan's cross-section disks (bind pose unless `positions` re-places the joints, see tPoseDisks). */
export function skeletonDisks(plan: DiskPlan): SkeletonDisk[] {
  const P = plan.proportions, out: SkeletonDisk[] = [];
  for (const b of plan.bones) {
    const s = headSection(b.id, P);
    out.push({ bone: b.id, at: [...b.head] as Vec3, normal: unit(sub(b.tail, b.head)), rx: s.rx, rz: s.rz, label: s.label });
  }
  const bone = (id: BoneId) => plan.bones.find((x) => x.id === id);
  const head = bone("head");
  if (head) {
    const mid: Vec3 = [0.5 * (head.head[0] + head.tail[0]), 0.5 * (head.head[1] + head.tail[1]), 0.5 * (head.head[2] + head.tail[2])];
    out.push({ bone: "head", at: mid, normal: unit(sub(head.tail, head.head)), rx: P.halfWidth.skull, rz: P.halfDepth.skull, label: "skull" });
  }
  (plan.arms ?? []).forEach((a, i) => {
    const fore = bone(i === 0 ? "elbowL" : "elbowR");
    if (!fore) return;
    const n = unit(sub(fore.tail, fore.head));
    out.push({ bone: fore.id, at: [...a.wrist] as Vec3, normal: n, rx: P.radius.wrist, rz: P.radius.wrist, label: "wrist" });
    out.push({ bone: fore.id, at: [...a.palm] as Vec3, normal: n, rx: P.radius.palmHalfWidth, rz: P.radius.palmHalfThickness, label: "palm" });
  });
  (plan.legs ?? []).forEach((l, i) => {
    const toe = bone(i === 0 ? "toeL" : "toeR");
    if (!toe) return;
    out.push({ bone: toe.id, at: [...l.ball] as Vec3, normal: unit(sub(toe.tail, toe.head)), rx: P.radius.footHalfWidth, rz: 0.5 * P.radius.footHalfWidth, label: "ball" });
  });
  return out;
}

/** The arm bones and the points that ride on each arm (index 0 = left, 1 = right). */
const ARM: readonly [BoneId, BoneId][] = [["shoulderL", "elbowL"], ["shoulderR", "elbowR"]];

/**
 * Rigid re-placement of the arm chain for the T-pose: every point p of arm i maps to
 * shoulder + |p - shoulder|_along · (side, 0, 0) — the straight arm laid along ±x at shoulder height
 * (the distance along the bind chain is kept, so every segment keeps its length).
 */
function tArmMap(plan: DiskPlan): ((p: Vec3) => Vec3)[] {
  return ARM.map(([up, fore]) => {
    const U = plan.bones.find((b) => b.id === up)!, F = plan.bones.find((b) => b.id === fore)!;
    const S = U.head, E = F.head, side = Math.sign(S[0]) || 1;
    const lu = len(sub(E, S));
    return (p: Vec3): Vec3 => {
      // Distance along the chain: projected on the upper arm before the elbow, else lu + along the forearm.
      const du = sub(p, S), dirU = unit(sub(E, S)), tU = du[0] * dirU[0] + du[1] * dirU[1] + du[2] * dirU[2];
      let d: number;
      if (tU <= lu) d = Math.max(0, tU);
      else { const df = sub(p, E), dirF = unit(sub(F.tail, E)); d = lu + Math.max(0, df[0] * dirF[0] + df[1] * dirF[1] + df[2] * dirF[2]); }
      return [S[0] + side * d, S[1], S[2]];
    };
  });
}

/** C-STAGE (P's SkeletonStage.tPose): every bone's head (joint) in the T-pose, model space. */
export function tPose(plan: DiskPlan): Record<BoneId, Vec3> {
  const maps = tArmMap(plan), out = {} as Record<BoneId, Vec3>;
  for (const b of plan.bones) {
    const arm = ARM.findIndex((a) => a.includes(b.id));
    out[b.id] = arm >= 0 ? maps[arm](b.head) : [...b.head] as Vec3;
  }
  return out;
}

/** The T-pose bones (head and tail re-placed; parents and axes kept): what the stage view draws. */
export function tPoseBones(plan: DiskPlan): BoneSegment[] {
  const maps = tArmMap(plan);
  return plan.bones.map((b) => {
    const arm = ARM.findIndex((a) => a.includes(b.id));
    return arm >= 0 ? { ...b, head: maps[arm](b.head), tail: maps[arm](b.tail) } : { ...b, head: [...b.head] as Vec3, tail: [...b.tail] as Vec3 };
  });
}

/** The disks re-placed into the T-pose (arm disks moved along the straightened arm, normals along ±x). */
export function tPoseDisks(plan: DiskPlan): SkeletonDisk[] {
  const maps = tArmMap(plan);
  return skeletonDisks(plan).map((d) => {
    const arm = ARM.findIndex((a) => a.includes(d.bone));
    if (arm < 0) return d;
    const side = Math.sign(plan.bones.find((b) => b.id === ARM[arm][0])!.head[0]) || 1;
    return { ...d, at: maps[arm](d.at), normal: [side, 0, 0] as Vec3 };
  });
}
