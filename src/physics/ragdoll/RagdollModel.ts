// Articulated ragdoll MODEL (V03): one rigid segment per bone of the REAL skinned rig, built
// from plain data so it is unit-testable without Three.js (RigBinding.ts extracts the data
// from a SkinnedHumanoid; tests can build it the same way).
//
// Frames and units: metres, kilograms, radians. Every segment's body frame IS its bone's frame
// (the frame the hitbox capsules and the skin are expressed in); the segment's centre of mass
// (COM) sits at `com` in that frame. A joint sits at the CHILD bone's origin: in the parent's
// frame that is the child's constant local position P_child (bones only rotate).
//
// Mass:      m_seg = Σ capsule volume · TISSUE_DENSITY, rescaled so Σ m_seg = the body mass
//            (capsule volume V = π r² L + 4/3 π r³; overlaps make it an upper bound, the rescale
//            removes the bias).
// Inertia:   each capsule as a solid cylinder of the same volume along its axis
//            (I_axis = ½ m r², I_perp = m (3 r² + L_eq²)/12, L_eq = L + 4r/3), moved to the
//            segment COM by the parallel-axis term; the ragdoll keeps the diagonal in the bone frame.
// Limits:    flex = the Skeleton's hinge range (Skeleton.limits(), the rig's x axis, times the
//            rig's rotation sign); abduct/twist from LATERAL_LIMITS (anatomical ranges; hinges
//            are locked to 0 on those axes).
import { TISSUE_DENSITY } from "../../combat/Hitboxes.ts";
import { qFromFlexAbductTwist } from "./QuatMath.ts";

/** A 3-vector [x, y, z] in metres. */
export type V3 = [number, number, number];
/** A unit quaternion [x, y, z, w]. */
export type Quat = [number, number, number, number];

/** One collision/mass capsule in its bone's frame. */
export interface CapsuleInput { a: V3; b: V3; radius: number }

/** One bone of the rig, as the model builder reads it. */
export interface RagdollBoneInput {
  id: string;
  /** Parent bone id (null for the root). */
  parent: string | null;
  /** Bone origin in the parent bone's frame (THREE.Bone.position), m. */
  localPosition: V3;
  /** Local rotation at joint angle 0 (the rig's display rest), unit quaternion. */
  restRotation: Quat;
  /** Hitbox capsules on this bone, in its frame. Empty = a massless frame (the rig's root). */
  capsules: CapsuleInput[];
}

/** Anatomical ranges of the two axes the Skeleton does not drive, rad: [min, max] (+ = away from the midline). */
export const LATERAL_LIMITS: Record<string, { abduct: [number, number]; twist: [number, number] }> = {
  // Adduction stops on the ribs; abduction ~75° before the scapula would have to rotate.
  shoulder: { abduct: [-0.35, 1.3], twist: [-1.0, 1.0] },
  // Hip: 0.3 rad adduction (thighs cross), 0.8 abduction (a split's start), ±35° rotation.
  hip: { abduct: [-0.3, 0.8], twist: [-0.6, 0.6] },
  // Lumbar side bend and rotation.
  waist: { abduct: [-0.35, 0.35], twist: [-0.5, 0.5] },
  // Cervical side bend and rotation (the head's own joint adds a little more).
  neck: { abduct: [-0.45, 0.45], twist: [-0.9, 0.9] },
  head: { abduct: [-0.25, 0.25], twist: [-0.4, 0.4] },
  // Ankle inversion/eversion (subtalar); almost no axial twist.
  ankle: { abduct: [-0.3, 0.3], twist: [-0.1, 0.1] },
  // Pure hinges.
  elbow: { abduct: [0, 0], twist: [0, 0] },
  knee: { abduct: [0, 0], twist: [0, 0] },
  toe: { abduct: [0, 0], twist: [0, 0] },
};

/** Rig rotation sign per Skeleton joint (lane C's RIG_ROTATION_SIGN: hip and knee are mirrored). */
export const FLEX_SIGN: Record<string, 1 | -1> = { hipL: -1, hipR: -1, kneeL: -1, kneeR: -1 };

/** Which LATERAL_LIMITS row a bone id uses, and its side (+1 left, −1 right, 0 centre). */
export function jointKindOf(id: string): { kind: string; side: 1 | -1 | 0 } {
  const side: 1 | -1 | 0 = id.endsWith("L") ? 1 : id.endsWith("R") ? -1 : 0;
  const base = side ? id.slice(0, -1) : id;
  const kind = base === "abdomen" || base === "spine" ? "waist" : base;
  return { kind, side };
}

/**
 * Lightest segment as a fraction of the body mass (0.5%: 0.35 kg of a 70 kg body). The toes'
 * capsules weigh ~0.06 kg; a 1:200 mass ratio between neighbours makes Gauss–Seidel converge
 * so slowly that the feet jitter, so tiny segments are floored (the total is kept).
 */
export const MIN_SEGMENT_MASS_FRACTION = 0.005;

/**
 * A LEAF bone whose capsules weigh less than this fraction of the body is WELDED to its parent
 * at its rest angle (2%: the toe, ~0.06 kg, then the foot, ~0.8 kg, of a 70 kg body). Such a
 * light end has almost no inertia, so the ground contact and its joint limits fight every
 * substep and it spins tens of rad/s, pumping energy into a body that should lie still
 * (measured: a limp body crawling at 1.3 m/s for 5 s); welded, its capsules join the parent's
 * (the shin) and the bone is written at its rest rotation. The hands are part of the forearm
 * bone (2.2%) and stay free.
 */
export const WELD_MASS_FRACTION = 0.02;

/** Self-collision is skipped for segment pairs whose rest-pose capsules come closer than this, m. */
export const SELF_REST_CLEARANCE = 0.01;
/** Contact spheres closer than this on one segment are merged (keeps the contact count low), m. */
export const SPHERE_MERGE = 0.03;

/** The built model: flat typed arrays, indexed by segment (seg) or bone. */
export interface RagdollModel {
  /** Bone ids in input order (the root included), their parents (index, −1 = none). */
  boneIds: string[];
  boneParent: Int16Array;
  /** Constant local positions (3/bone) and rest local rotations (4/bone). */
  boneLocalPos: Float64Array;
  boneRestRot: Float64Array;
  /** Segment of each bone (−1 for the massless root frame and for welded bones) and bone of each segment. */
  segOfBone: Int16Array;
  /** 1 for a bone welded to its parent at its rest rotation (WELD_MASS_FRACTION). */
  boneWelded: Uint8Array;
  segBone: Int16Array;
  /** The massless root bone, and the segment hanging from it (the free floating base). */
  rootBone: number;
  baseSegment: number;
  /** Segment count. */
  n: number;
  /** Parent segment (−1 for the base). */
  segParent: Int16Array;
  mass: Float64Array; invMass: Float64Array;
  /** Diagonal inertia in the bone frame about the COM, kg·m², and its inverse (3/seg). */
  inertia: Float64Array; invInertia: Float64Array;
  /** COM in the bone frame (3/seg). */
  com: Float64Array;
  /** Joint anchor relative to the PARENT segment's COM, in the parent's frame (3/seg). */
  anchorParent: Float64Array;
  /** Joint anchor relative to this segment's COM, in its frame (= −com) (3/seg). */
  anchorChild: Float64Array;
  /** Rest relative rotation parent→child (the bone's rest local rotation) (4/seg). */
  restRel: Float64Array;
  /** Joint limits [flexLo, flexHi, abductLo, abductHi, twistLo, twistHi] in rig axes (6/seg). */
  limits: Float64Array;
  /** Rig sign of the Skeleton flex angle, and side (+1 left, −1 right, 0 centre) per segment. */
  flexSign: Int8Array; side: Int8Array;
  /** Joint kind per segment (LATERAL_LIMITS key). */
  kind: string[];
  /** Contact spheres: owning segment, centre relative to the COM in the bone frame (3/sphere), radius. */
  sphereSeg: Int16Array; sphereLocal: Float64Array; sphereRadius: Float64Array;
  /** Self-collision capsule per segment (endpoints relative to the COM, 3 each) and radius. */
  selfA: Float64Array; selfB: Float64Array; selfR: Float64Array;
  /** Non-adjacent segment pairs tested for self-collision (2/pair). */
  pairs: Int16Array;
  /** Volume-equivalent radius per segment (for immersion), m. */
  eqRadius: Float64Array;
  totalMass: number;
}

const capsuleVolume = (c: CapsuleInput) => {
  const L = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]);
  return Math.PI * c.radius * c.radius * L + (4 / 3) * Math.PI * c.radius ** 3;
};

/**
 * Build the ragdoll model of a rig. `skeletonLimits` is Skeleton.limits() (Skeleton angles
 * per joint name); `totalMass` the fighter's mass in kg (the HitboxSet mass). Allocates
 * (call once per fighter; the solver reuses everything).
 */
export function buildRagdollModel(
  bones: readonly RagdollBoneInput[],
  skeletonLimits: ReadonlyMap<string, { min: number; max: number }>,
  totalMass: number,
): RagdollModel {
  const nb = bones.length;
  const index = new Map(bones.map((b, i) => [b.id, i]));
  const boneParent = new Int16Array(nb);
  const boneLocalPos = new Float64Array(nb * 3), boneRestRot = new Float64Array(nb * 4);
  const segOfBone = new Int16Array(nb).fill(-1);
  const boneWelded = new Uint8Array(nb);
  const segList: number[] = [];
  let rootBone = -1;
  // Welding: light leaves join their parent (capsules moved into the parent's frame by the
  // rest local transform p_parent = P + R_rest·p), repeatedly — once the toe is welded the
  // foot may become a light leaf in turn.
  const own = bones.map((b) => b.capsules.slice());
  const ownVol = (i: number) => own[i].reduce((t, c) => t + capsuleVolume(c), 0);
  const bodyRaw = bones.reduce((s, _b, i) => s + ownVol(i), 0);
  for (let changed = true; changed;) {
    changed = false;
    bones.forEach((b, i) => {
      if (b.parent === null || boneWelded[i]) return;
      const hasLiveChild = bones.some((c, j) => c.parent === b.id && !boneWelded[j]);
      if (hasLiveChild || ownVol(i) >= WELD_MASS_FRACTION * bodyRaw) return;
      const pi = index.get(b.parent);
      if (pi === undefined || bones[pi].parent === null) return; // never weld onto the root frame
      const move = (v: V3): V3 => {
        const r = rotateArr(b.restRotation, v);
        return [b.localPosition[0] + r[0], b.localPosition[1] + r[1], b.localPosition[2] + r[2]];
      };
      for (const c of own[i]) own[pi].push({ a: move(c.a), b: move(c.b), radius: c.radius });
      own[i] = [];
      boneWelded[i] = 1;
      changed = true;
    });
  }
  bones.forEach((b, i) => {
    boneParent[i] = b.parent === null ? -1 : index.get(b.parent) ?? -1;
    boneLocalPos.set(b.localPosition, i * 3);
    boneRestRot.set(b.restRotation, i * 4);
    if (b.parent === null) rootBone = i;
    else if (!boneWelded[i]) { segOfBone[i] = segList.length; segList.push(i); }
  });
  if (rootBone < 0) throw new Error("ragdoll: the rig has no root bone");
  const n = segList.length;
  const segBone = Int16Array.from(segList);
  const segParent = new Int16Array(n);
  let baseSegment = -1;
  for (let s = 0; s < n; s++) {
    const pb = boneParent[segBone[s]];
    segParent[s] = pb < 0 ? -1 : segOfBone[pb];
    if (segParent[s] < 0) { if (baseSegment >= 0) throw new Error("ragdoll: more than one floating segment"); baseSegment = s; }
  }

  // Mass, COM and inertia from the capsules (a capsule-less bone gets a 3 cm sphere at its origin).
  const caps = segList.map((bi) => own[bi].length ? own[bi] : [{ a: [0, 0, 0] as V3, b: [0, 0, 0] as V3, radius: 0.03 }]);
  const vol = caps.map((cs) => cs.reduce((s, c) => s + capsuleVolume(c), 0));
  // Floor every segment at MIN_SEGMENT_MASS_FRACTION of the body, then rescale to the total.
  const rawMass = vol.map((v) => v * TISSUE_DENSITY);
  const rawTotal = rawMass.reduce((s, m) => s + m, 0);
  const floored = rawMass.map((m) => Math.max(m, MIN_SEGMENT_MASS_FRACTION * rawTotal));
  const scale = totalMass / floored.reduce((s, m) => s + m, 0);
  const mass = Float64Array.from(floored, (m) => m * scale);
  const invMass = Float64Array.from(mass, (m) => 1 / m);
  const com = new Float64Array(n * 3), inertia = new Float64Array(n * 3), invInertia = new Float64Array(n * 3);
  const eqRadius = new Float64Array(n);
  for (let s = 0; s < n; s++) {
    let cx = 0, cy = 0, cz = 0;
    for (const c of caps[s]) {
      const w = capsuleVolume(c) / vol[s];
      cx += w * (c.a[0] + c.b[0]) / 2; cy += w * (c.a[1] + c.b[1]) / 2; cz += w * (c.a[2] + c.b[2]) / 2;
    }
    com[s * 3] = cx; com[s * 3 + 1] = cy; com[s * 3 + 2] = cz;
    let ixx = 0, iyy = 0, izz = 0;
    for (const c of caps[s]) {
      const m = mass[s] * capsuleVolume(c) / vol[s];
      const dx = c.b[0] - c.a[0], dy = c.b[1] - c.a[1], dz = c.b[2] - c.a[2];
      const L = Math.hypot(dx, dy, dz), Leq = L + (4 / 3) * c.radius;
      const ux = L > 1e-9 ? dx / L : 0, uy = L > 1e-9 ? dy / L : 1, uz = L > 1e-9 ? dz / L : 0;
      const iAxis = 0.5 * m * c.radius ** 2, iPerp = m * (3 * c.radius ** 2 + Leq * Leq) / 12;
      // Diagonal of iPerp·(E − u uᵀ) + iAxis·u uᵀ + m·(|d|² E − d dᵀ).
      const ox = (c.a[0] + c.b[0]) / 2 - cx, oy = (c.a[1] + c.b[1]) / 2 - cy, oz = (c.a[2] + c.b[2]) / 2 - cz;
      const d2 = ox * ox + oy * oy + oz * oz;
      ixx += iPerp * (1 - ux * ux) + iAxis * ux * ux + m * (d2 - ox * ox);
      iyy += iPerp * (1 - uy * uy) + iAxis * uy * uy + m * (d2 - oy * oy);
      izz += iPerp * (1 - uz * uz) + iAxis * uz * uz + m * (d2 - oz * oz);
    }
    // Floor each axis at a thin rod's (keeps the inverse finite for a degenerate segment).
    const floor = mass[s] * 1e-4;
    inertia[s * 3] = Math.max(floor, ixx); inertia[s * 3 + 1] = Math.max(floor, iyy); inertia[s * 3 + 2] = Math.max(floor, izz);
    for (let k = 0; k < 3; k++) invInertia[s * 3 + k] = 1 / inertia[s * 3 + k];
    eqRadius[s] = Math.cbrt((3 * vol[s]) / (4 * Math.PI));
  }

  // Joints: anchors, rest relative rotation, limits.
  const anchorParent = new Float64Array(n * 3), anchorChild = new Float64Array(n * 3), restRel = new Float64Array(n * 4);
  const limits = new Float64Array(n * 6), flexSign = new Int8Array(n), side = new Int8Array(n);
  const kind: string[] = [];
  for (let s = 0; s < n; s++) {
    const bi = segBone[s], id = bones[bi].id, p = segParent[s];
    for (let k = 0; k < 3; k++) {
      anchorChild[s * 3 + k] = -com[s * 3 + k];
      anchorParent[s * 3 + k] = p >= 0 ? boneLocalPos[bi * 3 + k] - com[p * 3 + k] : 0;
    }
    restRel.set(bones[bi].restRotation, s * 4);
    const jk = jointKindOf(id);
    kind.push(jk.kind); side[s] = jk.side;
    const sign = FLEX_SIGN[id] ?? 1;
    flexSign[s] = sign;
    const sk = skeletonLimits.get(id);
    const flo = sk ? Math.min(sign * sk.min, sign * sk.max) : -Math.PI, fhi = sk ? Math.max(sign * sk.min, sign * sk.max) : Math.PI;
    const lat = LATERAL_LIMITS[jk.kind] ?? { abduct: [-0.3, 0.3], twist: [-0.3, 0.3] };
    // Abduction is "+ away from the midline": the left side is +z, the right side mirrors.
    const alo = jk.side < 0 ? -lat.abduct[1] : lat.abduct[0], ahi = jk.side < 0 ? -lat.abduct[0] : lat.abduct[1];
    limits.set([flo, fhi, alo, ahi, lat.twist[0], lat.twist[1]], s * 6);
  }

  // Contact spheres: capsule endpoints, merged when closer than SPHERE_MERGE.
  const sSeg: number[] = [], sLoc: number[] = [], sRad: number[] = [];
  for (let s = 0; s < n; s++) {
    const start = sSeg.length;
    for (const c of caps[s]) {
      for (const e of [c.a, c.b]) {
        const lx = e[0] - com[s * 3], ly = e[1] - com[s * 3 + 1], lz = e[2] - com[s * 3 + 2];
        let merged = false;
        for (let k = start; k < sSeg.length; k++) {
          if (Math.hypot(sLoc[k * 3] - lx, sLoc[k * 3 + 1] - ly, sLoc[k * 3 + 2] - lz) < SPHERE_MERGE) {
            sRad[k] = Math.max(sRad[k], c.radius); merged = true; break;
          }
        }
        if (!merged) { sSeg.push(s); sLoc.push(lx, ly, lz); sRad.push(c.radius); }
      }
    }
  }

  // Self-collision capsule: the segment's farthest capsule endpoints along its main spread,
  // with the volume-equivalent cylinder radius r = √(V / (π L)), bounded by the capsules' radii.
  const selfA = new Float64Array(n * 3), selfB = new Float64Array(n * 3), selfR = new Float64Array(n);
  for (let s = 0; s < n; s++) {
    const pts: V3[] = [];
    for (const c of caps[s]) pts.push(c.a, c.b);
    let best = -1, ia = 0, ib = 0;
    for (let i = 0; i < pts.length; i++) for (let j = i; j < pts.length; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2]);
      if (d > best) { best = d; ia = i; ib = j; }
    }
    const maxR = Math.max(...caps[s].map((c) => c.radius)), minR = Math.min(...caps[s].map((c) => c.radius));
    const r = best > 1e-6 ? Math.min(maxR, Math.max(minR, Math.sqrt(vol[s] / (Math.PI * best)))) : maxR;
    for (let k = 0; k < 3; k++) {
      selfA[s * 3 + k] = pts[ia][k] - com[s * 3 + k];
      selfB[s * 3 + k] = pts[ib][k] - com[s * 3 + k];
    }
    selfR[s] = r;
  }

  const model: RagdollModel = {
    boneIds: bones.map((b) => b.id), boneParent, boneLocalPos, boneRestRot, segOfBone, boneWelded, segBone, rootBone, baseSegment, n,
    segParent, mass, invMass, inertia, invInertia, com, anchorParent, anchorChild, restRel, limits, flexSign, side, kind,
    sphereSeg: Int16Array.from(sSeg), sphereLocal: Float64Array.from(sLoc), sphereRadius: Float64Array.from(sRad),
    selfA, selfB, selfR, pairs: new Int16Array(0), eqRadius, totalMass,
  };
  model.pairs = selfPairs(model);
  return model;
}

/** Closest distance between segments [p0, p1] and [q0, q1] (3D); writes the parameters into st. */
export function segmentSegment(
  p0x: number, p0y: number, p0z: number, p1x: number, p1y: number, p1z: number,
  q0x: number, q0y: number, q0z: number, q1x: number, q1y: number, q1z: number, st: { s: number; t: number },
): number {
  const dx = p1x - p0x, dy = p1y - p0y, dz = p1z - p0z, ex = q1x - q0x, ey = q1y - q0y, ez = q1z - q0z;
  const rx = p0x - q0x, ry = p0y - q0y, rz = p0z - q0z;
  const a = dx * dx + dy * dy + dz * dz, e = ex * ex + ey * ey + ez * ez, f = ex * rx + ey * ry + ez * rz;
  let s = 0, t = 0;
  if (a <= 1e-12 && e <= 1e-12) { s = 0; t = 0; }
  else if (a <= 1e-12) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = dx * rx + dy * ry + dz * rz;
    if (e <= 1e-12) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = dx * ex + dy * ey + dz * ez, den = a * e - b * b;
      s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  st.s = s; st.t = t;
  return Math.hypot(p0x + dx * s - q0x - ex * t, p0y + dy * s - q0y - ey * t, p0z + dz * s - q0z - ez * t);
}

/**
 * Non-adjacent segment pairs for self-collision: not parent/child, and not already touching in
 * the REST pose (rest gap < SELF_REST_CLEARANCE: anatomically joined, e.g. the chest and the
 * upper arms at the shoulder).
 */
function selfPairs(m: RagdollModel): Int16Array {
  // Rest pose world frames: compose rest local rotations down the bone tree (root at identity).
  const nb = m.boneIds.length;
  const Q = new Float64Array(nb * 4), O = new Float64Array(nb * 3);
  const order = [...Array(nb).keys()];
  const depth = (b: number): number => (m.boneParent[b] < 0 ? 0 : 1 + depth(m.boneParent[b]));
  order.sort((a, b) => depth(a) - depth(b));
  for (const b of order) {
    const p = m.boneParent[b];
    if (p < 0) { Q.set([0, 0, 0, 1], b * 4); O.set([0, 0, 0], b * 3); continue; }
    const tmp = new Float64Array(4), v = new Float64Array(3);
    rotate(v, Q, p * 4, m.boneLocalPos[b * 3], m.boneLocalPos[b * 3 + 1], m.boneLocalPos[b * 3 + 2]);
    O[b * 3] = O[p * 3] + v[0]; O[b * 3 + 1] = O[p * 3 + 1] + v[1]; O[b * 3 + 2] = O[p * 3 + 2] + v[2];
    mul(tmp, Q, p * 4, m.boneRestRot, b * 4);
    Q.set(tmp, b * 4);
  }
  const world = (s: number, local: Float64Array, out: Float64Array) => {
    const b = m.segBone[s];
    rotate(out, Q, b * 4, local[s * 3] + m.com[s * 3], local[s * 3 + 1] + m.com[s * 3 + 1], local[s * 3 + 2] + m.com[s * 3 + 2]);
    out[0] += O[b * 3]; out[1] += O[b * 3 + 1]; out[2] += O[b * 3 + 2];
  };
  const out: number[] = [];
  const a0 = new Float64Array(3), a1 = new Float64Array(3), b0 = new Float64Array(3), b1 = new Float64Array(3);
  const st = { s: 0, t: 0 };
  for (let i = 0; i < m.n; i++) for (let j = i + 1; j < m.n; j++) {
    if (m.segParent[i] === j || m.segParent[j] === i) continue;
    world(i, m.selfA, a0); world(i, m.selfB, a1); world(j, m.selfA, b0); world(j, m.selfB, b1);
    const d = segmentSegment(a0[0], a0[1], a0[2], a1[0], a1[1], a1[2], b0[0], b0[1], b0[2], b1[0], b1[1], b1[2], st);
    if (d - m.selfR[i] - m.selfR[j] > SELF_REST_CLEARANCE) out.push(i, j);
  }
  return Int16Array.from(out);
}

/** q · v for a quaternion tuple (build-time helper; allocates). */
function rotateArr(q: Quat, v: V3): V3 {
  const out = new Float64Array(3);
  rotate(out, Float64Array.from(q), 0, v[0], v[1], v[2]);
  return [out[0], out[1], out[2]];
}

function rotate(out: Float64Array, q: Float64Array, qi: number, x: number, y: number, z: number): void {
  const qx = q[qi], qy = q[qi + 1], qz = q[qi + 2], qw = q[qi + 3];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out[0] = x + qw * tx + (qy * tz - qz * ty);
  out[1] = y + qw * ty + (qz * tx - qx * tz);
  out[2] = z + qw * tz + (qx * ty - qy * tx);
}

function mul(out: Float64Array, a: Float64Array, ai: number, b: Float64Array, bi: number): void {
  const ax = a[ai], ay = a[ai + 1], az = a[ai + 2], aw = a[ai + 3];
  const bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** Joint rotation (relative, rest included) for Skeleton-style targets: restRel · Rx(sign·flex)·Rz(side·abduct)·Ry(twist). */
export function targetRelative(m: RagdollModel, s: number, skeletonFlex: number, abductOut: number, twist: number, out: Float64Array, oi: number): void {
  const tmp = TMP4;
  qFromFlexAbductTwist(tmp, 0, m.flexSign[s] * skeletonFlex, (m.side[s] < 0 ? -1 : 1) * abductOut, twist);
  const r = m.restRel, i = s * 4;
  const ax = r[i], ay = r[i + 1], az = r[i + 2], aw = r[i + 3];
  const bx = tmp[0], by = tmp[1], bz = tmp[2], bw = tmp[3];
  out[oi] = aw * bx + ax * bw + ay * bz - az * by;
  out[oi + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[oi + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
}
const TMP4 = new Float64Array(4);
