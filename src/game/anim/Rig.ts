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
import { toeOutYaw } from "./FootTurnout.ts";
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
  /**
   * Wave FALL: the upper body (chest, neck, head, arms) for the whole-body contact model
   * (bodySpheres). Absent = estimated from the leg length (legacy rig). Never read by the gait/IK.
   */
  upper?: UpperGeometry;
}

/**
 * Wave FALL: the parts above the hips, bind pose, metres. `chest` hangs off the spine pivot (the
 * first trunk link) and turns with the spine joint; neck -> head chain above it; each arm hangs
 * from its shoulder pivot along its own -y after the display roll about z (SkinnedHumanoid.update).
 */
export interface UpperGeometry {
  /** Neck pivot from the spine pivot (y, z), head pivot from the neck pivot, head crown from the head pivot. */
  neck: { y: number; z: number };
  head: { y: number; z: number };
  crown: { y: number; z: number };
  /** Shoulder pivots [L, R] from the spine pivot (x, y, z). */
  shoulder: readonly [readonly [number, number, number], readonly [number, number, number]];
  /** Display roll (rad, about z) of each upper arm [L, R]. */
  armRoll: readonly [number, number];
  upperArm: number;
  /** Elbow -> hand tip (the forearm bone runs to the mitten tip on lane A's body). */
  foreArm: number;
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
export function legGeometryFromBones(
  bones: readonly BoneSegment[], soleOffset: number, modelScale = 1, displayRoll?: (id: string) => number,
): LegGeometry {
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
    upper: upperFromBones(by, s, displayRoll),
  };
}

/** Wave FALL: UpperGeometry from the bind bones (null-safe: absent when a bone is missing). */
function upperFromBones(
  by: Map<string, BoneSegment>, s: number, displayRoll?: (id: string) => number,
): UpperGeometry | undefined {
  const spine = by.get("spine"), neck = by.get("neck"), head = by.get("head");
  const shL = by.get("shoulderL"), shR = by.get("shoulderR"), elL = by.get("elbowL");
  if (!spine || !neck || !head || !shL || !shR || !elL) return undefined;
  const d = (a: BoneSegment, b: readonly number[]) => Math.hypot(b[0] - a.head[0], b[1] - a.head[1], b[2] - a.head[2]);
  // Lane A's arms DISPLAY at 0.4 of their bind abduction (Anatomy armDisplayAbduction): +x arm -> +roll.
  const roll = (b: BoneSegment) => displayRoll ? displayRoll(b.id) : Math.atan2(b.tail[0] - b.head[0], b.head[1] - b.tail[1]) * 0.4;
  const fore = d(elL, elL.tail);
  return {
    neck: { y: (neck.head[1] - spine.head[1]) * s, z: (neck.head[2] - spine.head[2]) * s },
    head: { y: (head.head[1] - neck.head[1]) * s, z: (head.head[2] - neck.head[2]) * s },
    crown: { y: (head.tail[1] - head.head[1]) * s, z: (head.tail[2] - head.head[2]) * s },
    shoulder: [
      [(shL.head[0] - spine.head[0]) * s, (shL.head[1] - spine.head[1]) * s, (shL.head[2] - spine.head[2]) * s],
      [(shR.head[0] - spine.head[0]) * s, (shR.head[1] - spine.head[1]) * s, (shR.head[2] - spine.head[2]) * s],
    ],
    armRoll: [roll(shL), roll(shR)],
    upperArm: d(shL, shL.tail) * s,
    foreArm: fore * 0.97 * s,
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

/** Rotate point `p` about the vertical through `pivot` (right-handed +y: +R turns +z toward +x). */
function yawAbout(pivot: Float64Array, p: Float64Array, R: number): void {
  const c = Math.cos(R), s = Math.sin(R), x = p[0] - pivot[0], z = p[2] - pivot[2];
  p[0] = pivot[0] + x * c + z * s;
  p[2] = pivot[2] - x * s + z * c;
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
export function legFK3(g: LegGeometry, angles: Float64Array, side: Side, hipRoll: number, ankleRoll: number, out: LegFK3, toeOut = 0): LegFK3 {
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
  // Wave X: `toeOut` (rad, magnitude, + = toes outward) turns the foot toward its own side
  // (FootTurnout.toeOutYaw) about the VERTICAL through the ankle: the sole points' horizontal
  // offsets from the ankle rotate, their heights do not — so every sole height, pitch and the
  // planted-ball IK (Animator #ankleTarget) are exactly the pre-wave-X ones; 0 is the old foot.
  const yaw = toeOutYaw(g.hipLateral[side], toeOut);
  if (yaw !== 0) for (const p of [out.ball, out.heel, out.toe]) yawAbout(out.ankle, p, yaw);
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


// ---------------------------------------------------------------------------------------------
// Wave FALL: whole-body contact model. A fallen / rising body touches the floor with its back,
// hips, knees, hands and head, not only its soles, so the animator needs every part's position.
// bodySpheres() is the rig's forward kinematics (same chain, signs and roll orders as legFK3 and
// SkinnedHumanoid.update) for 32 spheres: centre (rig-local x, y, z) + radius. The radii are
// shares of the leg length L (calibrated against lane A's skin, tests/wave_fall_anim_test.ts F33);
// the exact skin contact is SkinnedHumanoid.settleOnFloor — this model is what the pure animator
// plans with (grounding, contact anchoring).
// ---------------------------------------------------------------------------------------------

/** Sphere indices of bodySpheres (4 floats each: x, y, z, r). Paired parts are [L, R]. */
export const SPHERE = {
  chest: 0, chest2: 1, neck: 2, head: 3, belly: 4, pelvis: 5,
  hip: [6, 7], thigh: [8, 9], knee: [10, 11], shin: [12, 13], ankle: [14, 15],
  heel: [16, 17], ball: [18, 19], toe: [20, 21],
  shoulder: [22, 23], upperArm: [24, 25], elbow: [26, 27], foreArm: [28, 29], hand: [30, 31],
} as const;
/** Number of spheres bodySpheres writes. */
export const SPHERE_COUNT = 32;

/**
 * Radius of each sphere (index = SPHERE order): trunk, arm and thigh spheres are shares of the
 * shoulder half-span w (UpperGeometry.shoulder x: girth goes with the frame — a dwarf's chest is as
 * deep as an elf's on a leg 30 % shorter), shins and feet shares of the leg length L. Calibrated on
 * lane A's skin, every race and sex (tests/wave_fall_anim_test.ts F33): torso half-depth ~0.6 w.
 */
export const SPHERE_RADIUS_W: readonly number[] = [
  0.6, 0.56, 0.3, 0, 0.56, 0.6,
  0.45, 0.45, 0.45, 0.45, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  0.34, 0.34, 0.29, 0.29, 0.25, 0.25, 0.22, 0.22, 0.16, 0.16,
];
export const SPHERE_RADIUS_L: readonly number[] = [
  0, 0, 0, 0.13, 0, 0,
  0, 0, 0, 0, 0.068, 0.068, 0.06, 0.06, 0.05, 0.05,
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

/** Shoulder half-span w (m) of a geometry (upperOf). */
export function shoulderHalfSpan(g: LegGeometry): number {
  const up = upperOf(g);
  return 0.5 * Math.abs(up.shoulder[1][0] - up.shoulder[0][0]);
}

/** The upper geometry, or one estimated from the leg length (legacy rig). */
export function upperOf(g: LegGeometry): UpperGeometry {
  if (g.upper) return g.upper;
  const L = legLength(g), w = Math.abs(g.hipLateral[1] - g.hipLateral[0]) * 1.1 + 0.05 * L;
  return {
    neck: { y: 0.18 * L, z: 0 }, head: { y: 0.15 * L, z: 0 }, crown: { y: 0.22 * L, z: 0 },
    shoulder: [[-w, 0.14 * L, 0], [w, 0.14 * L, 0]], armRoll: [-0.13, 0.13], upperArm: 0.36 * L, foreArm: 0.6 * L,
  };
}

const V3 = new Float64Array(3);

/** Push a point given in the frame of leg level (0 ankle, 1 shin/knee, 2 thigh/hip) to the rig origin. */
function legLevelToRoot(g: LegGeometry, angles: Float64Array, side: Side, hipRoll: number, ankleRoll: number, level: 0 | 1 | 2, v: Float64Array): void {
  const lj = LEG_JOINTS[side];
  if (level === 0) { rotZ(v, ankleRoll); rotX(v, angles[lj.ankle]); v[1] -= g.shin; }
  if (level <= 1) { rotX(v, RIG_ROTATION_SIGN.kneeL * angles[lj.knee]); v[1] -= g.thigh; }
  rotX(v, RIG_ROTATION_SIGN.hipL * angles[lj.hip]); rotZ(v, hipRoll + hipRestRollOf(g, side));
  v[0] += g.hipLateral[side]; v[1] += g.hipOffset.y; v[2] += g.hipOffset.z;
  for (let k = g.trunk.length - 1; k >= 0; k--) {
    const l = g.trunk[k];
    rotX(v, angles[JOINT_INDEX[l.joint]] * RIG_ROTATION_SIGN[l.joint]);
    v[1] += l.y; v[2] += l.z;
  }
}

function put(out: Float64Array, i: number, v: Float64Array, r: number): void {
  out[i * 4] = v[0]; out[i * 4 + 1] = v[1]; out[i * 4 + 2] = v[2]; out[i * 4 + 3] = r;
}

const FK3B = newLegFK3();

/**
 * Whole-body spheres (rig-local, the rig origin at the bind sole plane) for a pose: writes
 * SPHERE_COUNT × (x, y, z, r) into `out` (length >= 4·SPHERE_COUNT) and returns it.
 */
export function bodySpheres(
  g: LegGeometry, angles: Float64Array, hipRoll: ArrayLike<number>, ankleRoll: ArrayLike<number>, out: Float64Array,
  toeOut: ArrayLike<number> = [0, 0],
): Float64Array {
  const L = legLength(g), up = upperOf(g), w = shoulderHalfSpan(g);
  const rad = (i: number) => SPHERE_RADIUS_W[i] * w + SPHERE_RADIUS_L[i] * L;
  const Rs = angles[JOINT_INDEX.spine] * RIG_ROTATION_SIGN.spine;
  // Spine pivot (the first trunk link from the origin, unrotated) and the chest frame (rotX Rs).
  const t0 = g.trunk[0], Sy = t0 ? t0.y : 0, Sz = t0 ? t0.z : 0;
  const chestPt = (x: number, y: number, z: number, idx: number) => {
    V3[0] = x; V3[1] = y; V3[2] = z; rotX(V3, Rs); V3[1] += Sy; V3[2] += Sz; put(out, idx, V3, rad(idx));
  };
  // Chest centres sit ~0.2 w IN FRONT of the spine pivot (the pivot is near the back: lane A's
  // spine bone runs ~0.4 w inside the back surface, the chest is ~1.2 w deep).
  chestPt(0, -0.25 * up.neck.y, 0.18 * w, SPHERE.chest);
  chestPt(0, 0.45 * up.neck.y, 0.12 * w, SPHERE.chest2);
  // Neck / head chain.
  const Rn = Rs + angles[JOINT_INDEX.neck] * RIG_ROTATION_SIGN.neck, Rh = Rn + angles[JOINT_INDEX.head] * RIG_ROTATION_SIGN.head;
  const ny = Sy + Math.cos(Rs) * up.neck.y - Math.sin(Rs) * up.neck.z, nz = Sz + Math.sin(Rs) * up.neck.y + Math.cos(Rs) * up.neck.z;
  V3[0] = 0; V3[1] = ny; V3[2] = nz; put(out, SPHERE.neck, V3, rad(SPHERE.neck));
  const hy = ny + Math.cos(Rn) * up.head.y - Math.sin(Rn) * up.head.z, hz = nz + Math.sin(Rn) * up.head.y + Math.cos(Rn) * up.head.z;
  const cy = 0.5 * up.crown.y, cz = 0.5 * up.crown.z + 0.02 * L;
  V3[0] = 0; V3[1] = hy + Math.cos(Rh) * cy - Math.sin(Rh) * cz; V3[2] = hz + Math.sin(Rh) * cy + Math.cos(Rh) * cz;
  put(out, SPHERE.head, V3, Math.max(rad(SPHERE.head), 0.5 * Math.hypot(up.crown.y, up.crown.z)));
  // Belly (abdomen pivot) and pelvis (between the hips, a little behind them: the buttocks).
  hipPivot(g, angles[JOINT_INDEX.spine], angles[JOINT_INDEX.abdomen], HIP);
  {
    let y = 0, z = 0, Rr = 0;
    for (let k = 0; k < g.trunk.length; k++) {
      const l = g.trunk[k];
      const c = Math.cos(Rr), s = Math.sin(Rr);
      y += l.y * c - l.z * s; z += l.y * s + l.z * c;
      Rr += angles[JOINT_INDEX[l.joint]] * RIG_ROTATION_SIGN[l.joint];
      if (k === g.trunk.length - 1) {
        // Belly: in front of the abdomen pivot by ~0.1 w (frame z = (-sin, cos) of the pelvis frame).
        const cc = Math.cos(Rr), ss = Math.sin(Rr);
        V3[0] = 0; V3[1] = y - 0.1 * w * ss; V3[2] = z + 0.1 * w * cc; put(out, SPHERE.belly, V3, rad(SPHERE.belly));
      }
    }
    // The pelvis sphere: halfway between the abdomen pivot and the hip line, nudged back along the
    // pelvis frame's -z (the buttocks). Frame z maps to (y, z) = (-sin Rr, cos Rr).
    const c = Math.cos(Rr), s = Math.sin(Rr), back = 0.02 * w;
    V3[0] = 0; V3[1] = 0.5 * (y + HIP[0]) + back * s; V3[2] = 0.5 * (z + HIP[1]) - back * c;
    put(out, SPHERE.pelvis, V3, rad(SPHERE.pelvis));
  }
  for (let i = 0; i < 2; i++) {
    const sd = i as Side, hr = hipRoll[i], ar = ankleRoll[i];
    V3[0] = 0; V3[1] = 0; V3[2] = -0.05 * w; legLevelToRoot(g, angles, sd, hr, ar, 2, V3); put(out, SPHERE.hip[i], V3, rad(SPHERE.hip[i]));
    V3[0] = 0; V3[1] = -0.5 * g.thigh; V3[2] = 0; legLevelToRoot(g, angles, sd, hr, ar, 2, V3); put(out, SPHERE.thigh[i], V3, rad(SPHERE.thigh[i]));
    V3[0] = 0; V3[1] = 0; V3[2] = 0.01 * L; legLevelToRoot(g, angles, sd, hr, ar, 1, V3); put(out, SPHERE.knee[i], V3, rad(SPHERE.knee[i]));
    V3[0] = 0; V3[1] = -0.5 * g.shin; V3[2] = -0.01 * L; legLevelToRoot(g, angles, sd, hr, ar, 1, V3); put(out, SPHERE.shin[i], V3, rad(SPHERE.shin[i]));
    legFK3(g, angles, sd, hr, ar, FK3B, toeOut[i]);
    put(out, SPHERE.ankle[i], FK3B.ankle, rad(SPHERE.ankle[i]));
    put(out, SPHERE.heel[i], FK3B.heel, 0);
    put(out, SPHERE.ball[i], FK3B.ball, 0);
    put(out, SPHERE.toe[i], FK3B.toe, 0);
    // Arm: shoulder pivot in the chest frame, then Rz(display roll)·Rx(shoulder), elbow Rx(elbow).
    const aj = ARM_JOINTS[i], sh = up.shoulder[i];
    const sa = angles[aj.shoulder] * RIG_ROTATION_SIGN.shoulderL, ea = angles[aj.elbow] * RIG_ROTATION_SIGN.elbowL;
    const armPt = (along: number, fore: number, idx: number) => {
      // Point `fore` down the forearm (after the elbow), `along` down the upper arm.
      V3[0] = 0; V3[1] = -fore; V3[2] = 0;
      rotX(V3, ea); V3[1] -= along;
      rotX(V3, sa); rotZ(V3, up.armRoll[i]);
      V3[0] += sh[0]; V3[1] += sh[1]; V3[2] += sh[2];
      rotX(V3, Rs); V3[1] += Sy; V3[2] += Sz;
      put(out, idx, V3, rad(idx));
    };
    armPt(0, 0, SPHERE.shoulder[i]);
    armPt(0.5 * up.upperArm, 0, SPHERE.upperArm[i]);
    armPt(up.upperArm, 0, SPHERE.elbow[i]);
    armPt(up.upperArm, 0.45 * up.foreArm, SPHERE.foreArm[i]);
    armPt(up.upperArm, up.foreArm, SPHERE.hand[i]);
  }
  return out;
}
