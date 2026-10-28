// Rig conventions for the procedural animator (lane C, R04).
//
// Pure module: no Three.js, no DOM. Everything the gait, the foot IK and the blender need to
// agree on lives here: the joint order of every per-joint typed array, the joint limit
// table, the SIGN each joint angle has when the rig applies it, the leg geometry in metres,
// and the sagittal forward kinematics (FK) that turns joint angles back into foot positions
// (the tests and the report measure planting with it).
//
// Vocabulary
//   sagittal plane  the body's own forward/up plane: z forward (the way the face points),
//                   y up. Every joint of the Skeleton is single-axis (rotation.x), so a leg
//                   lives entirely in the sagittal plane through its hip pivot.
//   rig rotation R  the angle the rig writes into pivot.rotation.x (radians). Rotating a
//                   local vector (y, z) by R gives (y cosR - z sinR, y sinR + z cosR): a bone
//                   hanging DOWN tips BACKWARD (-z) for R > 0.
//   forward pitch ψ of a downward bone: the angle from straight down toward +z, so its
//                   direction is (z = sin ψ, y = -cos ψ). ψ = -R.
//   toe-down pitch Θ of the foot: the angle the sole is rotated toes-down from level.
//
// SKELETON ANGLE CONVENTION (the convention every leg author in the codebase already used:
// the walk pose, Skills.legDrive, StanceAnim's kneel):
//   hip   > 0  thigh swings FORWARD (flexion)        range [-1.2, 1.2]
//   knee  < 0  knee flexes, shin swings BACK         range [-2.4, 0]
//   ankle > 0  toes DOWN (plantarflexion)            range [-0.8, 0.6]
//   toe   < 0  toes curl UP (extension, push-off)    range [-0.7, 0.4]
//   spine/abdomen/neck/head > 0  lean FORWARD
//   shoulder < 0 arm raised FORWARD; elbow < 0 flexion
// The legacy pivot rig (Humanoid.ts) writes rotation.x = angle for every joint, which renders
// hip and knee MIRRORED (a positive hip tips the thigh back, a negative knee folds the shin
// forward: a reversed "bird" knee). RIG_ROTATION_SIGN is the fix: rotation.x = sign * angle.

import type { JointName } from "../Skeleton.ts";
import type { BoneSegment } from "../../graphics/body/contracts.ts";

/** Every Skeleton joint, in the order every per-joint Float64Array of this lane uses. */
export const JOINT_ORDER: readonly JointName[] = [
  "spine", "abdomen", "neck", "head",
  "shoulderL", "shoulderR", "elbowL", "elbowR",
  "hipL", "hipR", "kneeL", "kneeR",
  "ankleL", "ankleR", "toeL", "toeR",
];

/** Number of joints (length of every per-joint array). */
export const JOINT_COUNT = JOINT_ORDER.length;

/** Index of each joint in JOINT_ORDER. */
export const JOINT_INDEX: Readonly<Record<JointName, number>> = Object.fromEntries(
  JOINT_ORDER.map((name, i) => [name, i]),
) as Record<JointName, number>;

/** Leg side: 0 = the "L" joints (hipL…toeL), 1 = the "R" joints. */
export type Side = 0 | 1;

/** Joint indices of one leg, by side. */
export const LEG_JOINTS: readonly { hip: number; knee: number; ankle: number; toe: number }[] = [
  { hip: JOINT_INDEX.hipL, knee: JOINT_INDEX.kneeL, ankle: JOINT_INDEX.ankleL, toe: JOINT_INDEX.toeL },
  { hip: JOINT_INDEX.hipR, knee: JOINT_INDEX.kneeR, ankle: JOINT_INDEX.ankleR, toe: JOINT_INDEX.toeR },
];

/** Joint indices of one arm, by side. */
export const ARM_JOINTS: readonly { shoulder: number; elbow: number }[] = [
  { shoulder: JOINT_INDEX.shoulderL, elbow: JOINT_INDEX.elbowL },
  { shoulder: JOINT_INDEX.shoulderR, elbow: JOINT_INDEX.elbowR },
];

/**
 * Sign the rig must apply to each Skeleton angle: `pivot.rotation.x = sign * joint.angle`.
 * Hip and knee are -1 because the Skeleton (and every animation authored against it) means
 * "hip > 0 = thigh forward, knee < 0 = shin back" while a rotation.x > 0 on a hanging bone
 * tips it BACKWARD in a +z-forward rig (see the file header). Everything else is +1.
 */
export const RIG_ROTATION_SIGN: Readonly<Record<JointName, 1 | -1>> = {
  spine: 1, abdomen: 1, neck: 1, head: 1,
  shoulderL: 1, shoulderR: 1, elbowL: 1, elbowR: 1,
  hipL: -1, hipR: -1, kneeL: -1, kneeR: -1,
  ankleL: 1, ankleR: 1, toeL: 1, toeR: 1,
};

/** Per-joint limits and rest angles (radians), indexed like JOINT_ORDER. */
export interface JointLimitTable {
  min: Float64Array;
  max: Float64Array;
  rest: Float64Array;
}

/**
 * Build the limit table from `Skeleton.limits()` (the BASE limits, not a pose's temporary
 * override). A joint missing from the map gets an open range [-PI, PI] and rest 0.
 */
export function limitTableFrom(
  limits: ReadonlyMap<JointName, { min: number; max: number; rest: number }>,
): JointLimitTable {
  const t: JointLimitTable = {
    min: new Float64Array(JOINT_COUNT), max: new Float64Array(JOINT_COUNT), rest: new Float64Array(JOINT_COUNT),
  };
  for (let i = 0; i < JOINT_COUNT; i++) {
    const l = limits.get(JOINT_ORDER[i]);
    t.min[i] = l ? l.min : -Math.PI;
    t.max[i] = l ? l.max : Math.PI;
    t.rest[i] = l ? l.rest : 0;
  }
  return t;
}

/** Clamp every angle of `angles` into its joint's [min, max], in place. */
export function clampToLimits(angles: Float64Array, lim: JointLimitTable): void {
  for (let i = 0; i < JOINT_COUNT; i++) {
    const v = angles[i];
    angles[i] = v < lim.min[i] ? lim.min[i] : v > lim.max[i] ? lim.max[i] : v;
  }
}

/**
 * One link of the trunk chain from the rig origin down to the hips: the pivot of `joint` sits
 * at (y, z) metres from the previous pivot (the rig origin for the first link), expressed in
 * the previous pivot's rotated frame. Legacy rig: origin -> spine pivot -> abdomen pivot.
 */
export interface TrunkLink {
  joint: "spine" | "abdomen";
  y: number;
  z: number;
}

/**
 * The leg measurements the animator needs, in WORLD metres (already multiplied by the rig's
 * scale), all in the bind pose (every joint angle 0).
 *   trunk         pivots from the rig origin to the last trunk pivot (pelvis frame).
 *   hipOffset     hip pivot from the last trunk pivot, in the pelvis frame (y up, z forward).
 *   hipLateral    signed local x of each hip pivot [L, R] (legacy: L at -x).
 *   thigh, shin   hip->knee and knee->ankle pivot distances.
 *   soleOffset    ankle pivot -> sole plane, perpendicular to the sole.
 *   ballForward   ankle projection on the sole -> ball of the foot (the push-off pivot).
 *   heelBack      ankle projection on the sole -> heel.
 */
export interface LegGeometry {
  trunk: readonly TrunkLink[];
  hipOffset: { y: number; z: number };
  hipLateral: readonly [number, number];
  thigh: number;
  shin: number;
  soleOffset: number;
  ballForward: number;
  heelBack: number;
  /**
   * Bind-pose abduction of each leg [L, R], rad, about the pelvis's forward axis (+ toward local
   * +x): the angle of hip -> knee from straight down in the frontal plane. Lane A's skinned body
   * binds its legs slightly apart (Anatomy legAbduction 0.03-0.18 rad) and the rig applies the
   * animator's hipRoll ON TOP of it, so the leg plane's true roll is hipRestRoll + hipRoll.
   * Ignoring it misplaces the ankle by ρ(cos r - cos(r + r0)) vertically (1.4 cm at r = 0.3).
   * Absent = [0, 0] (the legacy pivot rig hangs its legs straight).
   */
  hipRestRoll?: readonly [number, number];
  /** Ball -> toe tip along the sole, m (the toe bone's length). Absent = 0.6·ballForward. */
  toeForward?: number;
  /**
   * Height of the toe joint (the ball pivot) above the sole plane, m. The ball CONTACT sits right
   * under it; when the toes curl up on a steep foot, the pivot offset turns the tip by r·(1 - cos)
   * along the sole, which reads as up to 2 cm of height (ork, toe -0.68 rad). Absent = 0.
   */
  toePivotHeight?: number;
}

/** Bind-pose abduction (rad) of leg `side`: hipRestRoll or 0. */
export function hipRestRollOf(g: LegGeometry, side: Side): number {
  return g.hipRestRoll ? g.hipRestRoll[side] : 0;
}

/** Ball -> toe tip distance (m): toeForward or 0.6·ballForward. */
export function toeForwardOf(g: LegGeometry): number {
  return g.toeForward ?? 0.6 * g.ballForward;
}

/** Leg length L = thigh + shin (metres): the base length every gait quantity is derived from. */
export function legLength(g: LegGeometry): number {
  return g.thigh + g.shin;
}

/**
 * Depth of the sole plane below the rig origin in the bind pose (metres, > 0 when the origin
 * is above the feet). Derived, not stored:
 *   soleDepth = -( Σ trunk.y + hipOffset.y - (thigh + shin)·cos(hipRestRoll) - soleOffset )
 * (a leg bound abducted by r0 reaches only L·cos r0 below its hip). Legacy rig: 0.6 (the body
 * centre, BODY_RADIUS). A rig whose origin is at the soles (lane A's skinned body): 0.
 */
export function standingSoleDepth(g: LegGeometry): number {
  let y = 0;
  for (const l of g.trunk) y += l.y;
  return -(y + g.hipOffset.y - (g.thigh + g.shin) * Math.cos(hipRestRollOf(g, 0)) - g.soleOffset);
}

/**
 * Leg geometry of the LEGACY pivot rig (src/graphics/Humanoid.ts), from the locals that
 * buildHumanoid already computes. All inputs are in the rig's LOCAL units except
 * `heightScale` (the group scale); the pivot constants 0.14 / 0.22 / 0.05 / 0.22 are the
 * makePivot offsets written in Humanoid.ts (spine->abdomen, abdomen->hip, ankle->toe pivot).
 *   ballForward = 0.8 * 0.22 (the ball sits just behind the toe pivot)
 *   heelBack    = 0.07       (the foot loft's heel cap behind the ankle)
 */
export function legacyLegGeometry(p: {
  heightScale: number; spineY: number; thigh: number; shin: number; footDrop: number; hipX: number;
}): LegGeometry {
  const s = p.heightScale;
  return {
    trunk: [{ joint: "spine", y: p.spineY * s, z: 0 }, { joint: "abdomen", y: -0.14 * s, z: 0 }],
    hipOffset: { y: -0.22 * s, z: 0 },
    hipLateral: [-Math.abs(p.hipX) * s, Math.abs(p.hipX) * s],
    thigh: p.thigh * s,
    shin: p.shin * s,
    soleOffset: p.footDrop * s,
    ballForward: 0.8 * 0.22 * s,
    heelBack: 0.07 * s,
  };
}

/**
 * Leg geometry of a SKINNED rig from its bind-pose bone segments (contracts.ts BoneSegment:
 * `head` is the joint pivot in model metres, +y up, +z forward). Needs bones spine, abdomen,
 * hipL, hipR, kneeL, ankleL, toeL (heads). `soleOffset` is the ankle-to-sole distance the
 * body exposes; `modelScale` the group scale (1 if the bones are already in world metres).
 * The trunk chain follows the bones' parent links from the hip upward (spine/abdomen only).
 */
export function legGeometryFromBones(bones: readonly BoneSegment[], soleOffset: number, modelScale = 1): LegGeometry {
  const by = new Map(bones.map((b) => [b.id, b]));
  const need = (id: string): BoneSegment => {
    const b = by.get(id as BoneSegment["id"]);
    if (!b) throw new Error(`legGeometryFromBones: missing bone ${id}`);
    return b;
  };
  const hipL = need("hipL"), hipR = need("hipR"), kneeL = need("kneeL"), ankleL = need("ankleL"), toeL = need("toeL");
  const kneeR = by.get("kneeR") ?? null;
  const s = modelScale;
  // Walk up from the hip collecting trunk joints, then emit them root-first.
  const chain: BoneSegment[] = [];
  let cur = hipL.parent ? by.get(hipL.parent) : undefined;
  while (cur) {
    if (cur.id === "spine" || cur.id === "abdomen") chain.unshift(cur);
    cur = cur.parent ? by.get(cur.parent) : undefined;
  }
  const trunk: TrunkLink[] = [];
  let prev: [number, number] = [0, 0]; // (y, z) of the previous pivot; the origin first
  for (const b of chain) {
    trunk.push({ joint: b.id as "spine" | "abdomen", y: (b.head[1] - prev[0]) * s, z: (b.head[2] - prev[1]) * s });
    prev = [b.head[1], b.head[2]];
  }
  const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // Frontal-plane angle of hip -> knee from straight down: atan2(knee.x - hip.x, hip.y - knee.y).
  const restRoll = (hip: BoneSegment, knee: BoneSegment) => Math.atan2(knee.head[0] - hip.head[0], hip.head[1] - knee.head[1]);
  const rollL = restRoll(hipL, kneeL);
  const ballForward = Math.max(0.05 * s, (toeL.head[2] - ankleL.head[2]) * s);
  // Lane A's foot (AnatomyParts.legNode): heel back 0.25·foot behind the ankle, toe tip 0.75·foot
  // ahead, and its heel SOLE point inset 0.09·foot from the heel's back: 0.16·foot behind the ankle
  //   heelBack = (0.16 / 0.75)·(toe tip z - ankle z)   (the toe bone's TAIL is the toe tip).
  const tipForward = (toeL.tail[2] - ankleL.head[2]) * s;
  return {
    trunk,
    hipOffset: { y: (hipL.head[1] - prev[0]) * s, z: (hipL.head[2] - prev[1]) * s },
    hipLateral: [hipL.head[0] * s, hipR.head[0] * s],
    thigh: dist(hipL.head, kneeL.head) * s,
    shin: dist(kneeL.head, ankleL.head) * s,
    soleOffset: soleOffset * s,
    ballForward,
    heelBack: tipForward > ballForward ? (0.16 / 0.75) * tipForward : 0.3 * ballForward,
    hipRestRoll: [rollL, kneeR ? restRoll(hipR, kneeR) : -rollL],
    // Toe sole point: the tip inset by 0.04·foot = (0.04 / 0.75)·tipForward (lane A's sole point).
    toeForward: Math.max(0, (toeL.tail[2] - toeL.head[2]) * s - (0.04 / 0.75) * tipForward),
    toePivotHeight: Math.max(0, (toeL.head[1] - ankleL.head[1]) * s + soleOffset * s),
  };
}

/** Rotate local (y, z) by rig rotation R into `out` as [y', z']. */
function rotYZ(y: number, z: number, R: number, out: Float64Array, at: number): void {
  const c = Math.cos(R), s = Math.sin(R);
  out[at] = y * c - z * s;
  out[at + 1] = y * s + z * c;
}

const TMP = new Float64Array(2);

/**
 * Hip pivot of either leg relative to the rig origin, sagittal (y, z) metres, for the given
 * trunk angles (Skeleton convention). Writes [y, z] into `out` and returns the pelvis rig
 * rotation R_pelvis = Σ trunk angles (the frame the thighs hang from).
 */
export function hipPivot(g: LegGeometry, spine: number, abdomen: number, out: Float64Array): number {
  let y = 0, z = 0, R = 0;
  for (const l of g.trunk) {
    rotYZ(l.y, l.z, R, TMP, 0);
    y += TMP[0];
    z += TMP[1];
    R += (l.joint === "spine" ? spine : abdomen) * RIG_ROTATION_SIGN[l.joint];
  }
  rotYZ(g.hipOffset.y, g.hipOffset.z, R, TMP, 0);
  out[0] = y + TMP[0];
  out[1] = z + TMP[1];
  return R;
}

/** Result of the sagittal leg FK, metres relative to the rig origin (y up, z forward). */
export interface LegFK {
  hipY: number; hipZ: number;
  kneeY: number; kneeZ: number;
  ankleY: number; ankleZ: number;
  /** Ball of the foot (push-off pivot) on the sole plane. */
  ballY: number; ballZ: number;
  /** Heel on the sole plane. */
  heelY: number; heelZ: number;
  /** Toe-down pitch of the sole, radians (0 = level). */
  footPitch: number;
}

/** A zeroed LegFK to reuse. */
export function newLegFK(): LegFK {
  return { hipY: 0, hipZ: 0, kneeY: 0, kneeZ: 0, ankleY: 0, ankleZ: 0, ballY: 0, ballZ: 0, heelY: 0, heelZ: 0, footPitch: 0 };
}

const HIP = new Float64Array(2);

/**
 * Forward kinematics of one leg exactly as the rig renders it (with RIG_ROTATION_SIGN), from a
 * full joint-angle array in JOINT_ORDER. Chain: R_thigh = R_pelvis + sign*hip,
 * R_shin = R_thigh + sign*knee, R_foot = R_shin + ankle; each bone hangs along -y of its
 * frame, the sole points sit at (y = -soleOffset, z = ballForward | -heelBack) in the foot frame.
 */
export function legFK(g: LegGeometry, angles: Float64Array, side: Side, out: LegFK): LegFK {
  const lj = LEG_JOINTS[side];
  const Rp = hipPivot(g, angles[JOINT_INDEX.spine], angles[JOINT_INDEX.abdomen], HIP);
  const Rt = Rp + RIG_ROTATION_SIGN.hipL * angles[lj.hip];
  const Rs = Rt + RIG_ROTATION_SIGN.kneeL * angles[lj.knee];
  const Rf = Rs + angles[lj.ankle];
  out.hipY = HIP[0]; out.hipZ = HIP[1];
  rotYZ(-g.thigh, 0, Rt, TMP, 0);
  out.kneeY = out.hipY + TMP[0]; out.kneeZ = out.hipZ + TMP[1];
  rotYZ(-g.shin, 0, Rs, TMP, 0);
  out.ankleY = out.kneeY + TMP[0]; out.ankleZ = out.kneeZ + TMP[1];
  rotYZ(-g.soleOffset, g.ballForward, Rf, TMP, 0);
  out.ballY = out.ankleY + TMP[0]; out.ballZ = out.ankleZ + TMP[1];
  rotYZ(-g.soleOffset, -g.heelBack, Rf, TMP, 0);
  out.heelY = out.ankleY + TMP[0]; out.heelZ = out.ankleZ + TMP[1];
  out.footPitch = Rf;
  return out;
}

/** Sole points and joints of one leg in 3D, rig-local metres (x lateral, y up, z forward). */
export interface LegFK3 {
  ankle: Float64Array; // [x, y, z]
  ball: Float64Array;
  heel: Float64Array;
  /** Toe tip on the sole: toeForward past the ball, turned by the toe joint (pivot taken on the sole). */
  toe: Float64Array;
}

/** A zeroed LegFK3 to reuse. */
export function newLegFK3(): LegFK3 {
  return { ankle: new Float64Array(3), ball: new Float64Array(3), heel: new Float64Array(3), toe: new Float64Array(3) };
}

const Q = new Float64Array(3);

function rotX(v: Float64Array, R: number): void {
  const c = Math.cos(R), s = Math.sin(R), y = v[1], z = v[2];
  v[1] = y * c - z * s;
  v[2] = y * s + z * c;
}

function rotZ(v: Float64Array, R: number): void {
  const c = Math.cos(R), s = Math.sin(R), x = v[0], y = v[1];
  v[0] = x * c - y * s;
  v[1] = x * s + y * c;
}

/** Push a point given in the ankle frame up the chain to the rig origin (in place). */
function chainToRoot(g: LegGeometry, angles: Float64Array, side: Side, hipRoll: number, ankleRoll: number, v: Float64Array): void {
  const lj = LEG_JOINTS[side];
  rotZ(v, ankleRoll); rotX(v, angles[lj.ankle]); v[1] -= g.shin;           // ankle: Euler XYZ
  rotX(v, RIG_ROTATION_SIGN.kneeL * angles[lj.knee]); v[1] -= g.thigh;     // knee
  rotX(v, RIG_ROTATION_SIGN.hipL * angles[lj.hip]); rotZ(v, hipRoll + hipRestRollOf(g, side)); // hip: Euler ZYX
  v[0] += g.hipLateral[side]; v[1] += g.hipOffset.y; v[2] += g.hipOffset.z;
  for (let k = g.trunk.length - 1; k >= 0; k--) {
    const l = g.trunk[k];
    rotX(v, angles[JOINT_INDEX[l.joint]] * RIG_ROTATION_SIGN[l.joint]);
    v[1] += l.y; v[2] += l.z;
  }
}

/**
 * 3D forward kinematics of one leg with hip abduction `hipRoll` (Euler ZYX on the hip pivot, on
 * top of the geometry's hipRestRoll) and ankle counter-roll `ankleRoll` (Euler XYZ on the ankle),
 * rig-local metres. With both rolls 0 and no rest roll it equals legFK (plus the hip's lateral x).
 */
export function legFK3(g: LegGeometry, angles: Float64Array, side: Side, hipRoll: number, ankleRoll: number, out: LegFK3): LegFK3 {
  Q[0] = 0; Q[1] = 0; Q[2] = 0;
  chainToRoot(g, angles, side, hipRoll, ankleRoll, Q); out.ankle.set(Q);
  Q[0] = 0; Q[1] = -g.soleOffset; Q[2] = g.ballForward;
  chainToRoot(g, angles, side, hipRoll, ankleRoll, Q); out.ball.set(Q);
  Q[0] = 0; Q[1] = -g.soleOffset; Q[2] = -g.heelBack;
  chainToRoot(g, angles, side, hipRoll, ankleRoll, Q); out.heel.set(Q);
  // Toe tip: the toe joint sits r = toePivotHeight above the ball contact; the tip's sole point is
  // (0, -r, toeForward) in the toe frame, turned by the toe angle (sign +1, toe < 0 = toes up).
  const tf = toeForwardOf(g), ta = angles[LEG_JOINTS[side].toe] * RIG_ROTATION_SIGN.toeL, r = g.toePivotHeight ?? 0;
  const ct = Math.cos(ta), st = Math.sin(ta);
  Q[0] = 0; Q[1] = -g.soleOffset + r + (-r * ct - tf * st); Q[2] = g.ballForward + (-r * st + tf * ct);
  chainToRoot(g, angles, side, hipRoll, ankleRoll, Q); out.toe.set(Q);
  return out;
}

/**
 * Local -> world on the ground plane for a rig at (rootX, rootZ) with yaw `yaw`
 * (rig.group.rotation.y): world = root + Ry(yaw)·(lx, lz), i.e.
 *   x = rootX + lx cos(yaw) + lz sin(yaw),  z = rootZ - lx sin(yaw) + lz cos(yaw).
 * Writes [x, z] into `out` at `at`.
 */
export function localToWorld(rootX: number, rootZ: number, yaw: number, lx: number, lz: number, out: Float64Array, at = 0): void {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  out[at] = rootX + lx * c + lz * s;
  out[at + 1] = rootZ - lx * s + lz * c;
}

/** World -> local (inverse of localToWorld). Writes [lx, lz] into `out` at `at`. */
export function worldToLocal(rootX: number, rootZ: number, yaw: number, wx: number, wz: number, out: Float64Array, at = 0): void {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const dx = wx - rootX, dz = wz - rootZ;
  out[at] = dx * c - dz * s;
  out[at + 1] = dx * s + dz * c;
}
