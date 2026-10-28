// Anatomy part builders (lane A, R03/R15): the SDF volumes of each body part, in bind-pose
// model space (metres, +y up, +z forward, +x the character's LEFT, soles on y = 0).
// Pure module: no THREE. Every size is a named fraction of a BodyProportions number.
//
// Vocabulary: σ (side) = +1 for the left limb (+x), −1 for the right. `d` is a limb's unit
// direction from its root joint, `o` the outward lateral vector ⟂ d in the xy plane, `f` = +z.

import type { BoneId, Primitive, PrimitiveKind, Region, SdfNode, Vec3, VolumeOp } from "./contracts.ts";
import type { BodyProportions } from "./Proportions.ts";

/** Smooth-union width at a joint: BLEND_FRACTION × the harmonic mean of the two radii (m). */
export const BLEND_FRACTION = 0.5;
export function blendWidth(r1: number, r2: number): number {
  return BLEND_FRACTION * (2 * r1 * r2) / (r1 + r2);
}
/**
 * Fraction of each weight-bearing foot volume's vertical radius that lies BELOW the ground
 * before the half-space cut. The cut of an ellipsoid at depth f·r leaves a flat contact
 * ellipse of radius √(1 − (1 − f)²)·r, so 0.45 gives a patch of 0.84·r: a real sole, not a point.
 */
export const SOLE_CONTACT = 0.45;

// --- tiny vector + node helpers --------------------------------------------------------
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const along = (a: Vec3, d: Vec3, s: number): Vec3 => [a[0] + d[0] * s, a[1] + d[1] * s, a[2] + d[2] * s];
export function sum(...vs: Vec3[]): Vec3 { return vs.reduce((acc, v) => add(acc, v), [0, 0, 0] as Vec3); }

export function prim(id: string, kind: PrimitiveKind, bone: BoneId, region: Region, a: Vec3, extra: Partial<Primitive> = {}): SdfNode {
  return { type: "primitive", primitive: { id, kind, a, r: 0, bone, region, ...extra } };
}
export function op(o: VolumeOp, k: number, ...children: SdfNode[]): SdfNode {
  return { type: "op", op: o, k, children };
}

/** A limb frame: root joint, unit direction, outward lateral, forward, and its z-roll (rad). */
export interface LimbFrame { root: Vec3; d: Vec3; o: Vec3; f: Vec3; roll: number }
/** Frame of a limb hanging from `root`, rolled outward by `abduction` rad (σ picks the side). */
export function limbFrame(root: Vec3, abduction: number, side: 1 | -1): LimbFrame {
  const s = Math.sin(abduction), c = Math.cos(abduction);
  // Rz(σ·a) maps the local −y onto d = (σ sin a, −cos a, 0); `roll` is that Euler z.
  return { root, d: [side * s, -c, 0], o: [side * c, s, 0], f: [0, 0, 1], roll: side * abduction };
}

// --- head --------------------------------------------------------------------------------

/** Points the rigid face parts (eyes, brows, mouth, hair, ears) attach to, model space. */
export interface FaceAnchors {
  eye: [Vec3, Vec3];      // eyeball centres, L then R
  eyeRadius: number;
  brow: [Vec3, Vec3];
  mouth: Vec3;
  chin: Vec3;
  crown: Vec3;
  skullCentre: Vec3;
  skullRadii: Vec3;
  ear: [Vec3, Vec3];
  noseTip: Vec3;
}

/** Skull + jaw + face masses + ears, eye sockets carved (smoothSubtract), temples flattened (smoothIntersect). */
export function headNode(P: BodyProportions, jitter: { nose: number; jaw: number }): { node: SdfNode; face: FaceAnchors } {
  const h = P.head, H = P.y.crown, eyeY = P.y.eye, chinY = P.y.chin, c = P.cell;
  const sw = P.halfWidth.skull, sd = P.halfDepth.skull;
  const jut = P.underbite * 0.3 * h; // ork jaw jut, RaceAppearance.underbite in skull fractions
  const skullCentre: Vec3 = [0, H - 0.47 * h, -0.06 * h];
  const skullRadii: Vec3 = [sw, 0.47 * h, sd];
  const cranium = prim("cranium", "ellipsoid", "head", "head", skullCentre, { size: skullRadii });
  // Temple planes: the skull's sides are flatter than an ellipsoid.
  const temples = prim("templePlanes", "roundBox", "head", "head", skullCentre, { size: [sw * 0.88, 0.62 * h, sd * 1.25], r: 0.16 * h });
  const skull = op("smoothIntersect", 0.12 * h, cranium, temples);
  const chin: Vec3 = [0, chinY + 0.13 * h, 0.2 * h + jut];
  const face = prim("faceMass", "roundCone", "head", "face", [0, eyeY - 0.05 * h, 0.1 * h], { b: chin, r: 0.3 * h, r2: 0.14 * h });
  const jawW = 0.27 * h * jitter.jaw * (1 + 0.4 * P.underbite);
  const jaw = (s: 1 | -1) => prim(`jaw${s > 0 ? "L" : "R"}`, "sphere", "head", "face", [s * jawW, chinY + 0.3 * h, 0.02 * h + jut * 0.5], { r: 0.15 * h * (1 + 0.4 * P.underbite) });
  const cheek = (s: 1 | -1) => prim(`cheekbone${s > 0 ? "L" : "R"}`, "ellipsoid", "head", "face", [s * 0.24 * h, eyeY - 0.17 * h, 0.27 * h], { size: [0.12 * h, 0.08 * h, 0.1 * h] });
  const core = op("smoothUnion", 0.12 * h, skull, face, jaw(1), jaw(-1), cheek(1), cheek(-1));
  const brow = prim("browRidge", "capsule", "head", "face", [-0.24 * h, eyeY + 0.13 * h, 0.31 * h], { b: [0.24 * h, eyeY + 0.13 * h, 0.31 * h], r: Math.max(0.07 * h, 0.6 * c) });
  const noseTip: Vec3 = [0, eyeY - 0.27 * h * jitter.nose, 0.44 * h];
  const nose = prim("nose", "roundCone", "head", "face", [0, eyeY - 0.02 * h, 0.36 * h], { b: noseTip, r: Math.max(0.045 * h, 0.6 * c), r2: Math.max(0.075 * h, 0.75 * c) });
  const earLen = 0.2 * h * Math.pow(P.earScale, 0.8);
  const earTilt = 0.35 * (P.earScale - 1); // elf ears sweep up and out
  const earAt = (s: 1 | -1): Vec3 => [s * sw * 0.95, eyeY - 0.12 * h + (P.earScale - 1) * 0.1 * h, -0.06 * h];
  const ear = (s: 1 | -1) => prim(`ear${s > 0 ? "L" : "R"}`, "ellipsoid", "head", "ear", earAt(s), {
    size: [Math.max(0.06 * h, 1.1 * c), earLen, 0.13 * h], rot: [-0.7 * earTilt, 0, -s * earTilt],
  });
  const features = op("smoothUnion", 0.05 * h, core, brow, nose, ear(1), ear(-1));
  const eyeR = 0.075 * h;
  const socketAt = (s: 1 | -1): Vec3 => [s * 0.2 * h, eyeY, 0.37 * h];
  const socket = (s: 1 | -1) => prim(`eyeSocket${s > 0 ? "L" : "R"}`, "sphere", "head", "face", socketAt(s), { r: 0.105 * h });
  const node = op("smoothSubtract", 0.04 * h, features, socket(1), socket(-1));
  const eyeAt = (s: 1 | -1): Vec3 => [s * 0.2 * h, eyeY, 0.33 * h];
  return {
    node,
    face: {
      eye: [eyeAt(1), eyeAt(-1)], eyeRadius: eyeR,
      brow: [[0.2 * h, eyeY + 0.15 * h, 0.36 * h], [-0.2 * h, eyeY + 0.15 * h, 0.36 * h]],
      mouth: [0, chinY + 0.27 * h, 0.33 * h + jut * 0.5], chin, crown: [0, H, -0.06 * h],
      skullCentre, skullRadii, ear: [earAt(1), earAt(-1)], noseTip,
    },
  };
}

/** Neck column with the two sternocleidomastoid cords (mastoid → sternal notch). */
export function neckNode(P: BodyProportions): SdfNode {
  const h = P.head, r = P.halfWidth.neck;
  const column = prim("neck", "roundCone", "neck", "neck", [0, P.y.neckBase - 0.25 * h, -0.08 * h], { b: [0, P.y.headPivot + 0.05 * h, -0.04 * h], r: r * 1.25, r2: r });
  const scm = (s: 1 | -1) => prim(`sternocleidomastoid${s > 0 ? "L" : "R"}`, "capsule", "neck", "neck",
    [s * 0.22 * h, P.y.headPivot + 0.02 * h, -0.08 * h], { b: [s * 0.07 * h, P.y.sternalNotch + 0.06 * h, P.halfDepth.chest * 0.62], r: 0.07 * h * Math.sqrt(P.girth) });
  return op("smoothUnion", 0.06 * h, column, scm(1), scm(-1));
}

/** z of the front (+z) surface of an axis-aligned ellipsoid at height y. */
export function ellipsoidFrontZ(centre: Vec3, size: Vec3, y: number): number {
  const t = (y - centre[1]) / size[1];
  return centre[2] + size[2] * Math.sqrt(Math.max(0, 1 - t * t));
}

/** Torso: ribcage, shoulder girdle, pectorals, scapulae, clavicles, trapezius, abdomen, obliques, pelvis, glutes; navel carved (subtract). */
export function torsoNode(P: BodyProportions): { node: SdfNode; bellyFront: Vec3; sternalNotch: Vec3; backZ: number } {
  const h = P.head, y = P.y, m = P.muscle, c = P.cell;
  const cw = P.halfWidth.chest, cd = P.halfDepth.chest;
  const sx = P.halfWidth.shoulderJoint;
  const ribCentre: Vec3 = [0, (y.ribBottom + y.shoulder) / 2 + 0.05 * h, 0];
  const ribSize: Vec3 = [cw, (y.shoulder - y.ribBottom) / 2 + 0.2 * h, cd];
  const ribcage = prim("ribcage", "ellipsoid", "spine", "torso", ribCentre, { size: ribSize });
  const girdle = prim("shoulderGirdle", "capsule", "spine", "torso", [-sx * 0.85, y.shoulder + 0.08 * h, -0.05 * h], { b: [sx * 0.85, y.shoulder + 0.08 * h, -0.05 * h], r: 0.2 * h });
  const bellyCentre: Vec3 = [0, (y.navel + y.ribBottom) / 2, 0.04 * h * P.girth];
  const bellySize: Vec3 = [P.halfWidth.waist, (y.ribBottom - y.navel) / 2 + 0.45 * h, P.halfDepth.belly];
  const abdomen = prim("abdomen", "ellipsoid", "abdomen", "torso", bellyCentre, { size: bellySize });
  const oblique = (s: 1 | -1) => prim(`oblique${s > 0 ? "L" : "R"}`, "ellipsoid", "abdomen", "torso", [s * P.halfWidth.waist * 0.72, y.waist - 0.1 * h, -0.02 * h], { size: [0.3 * h * P.girth, 0.5 * h, 0.36 * h * P.girth] });
  const pelvisCentre: Vec3 = [0, y.pelvis, -0.03 * h];
  const pelvis = prim("pelvis", "ellipsoid", "abdomen", "pelvis", pelvisCentre, { size: [P.halfWidth.hip, 0.55 * h, P.halfDepth.pelvis] });
  const core = op("smoothUnion", blendWidth(cw, P.halfWidth.waist), ribcage, girdle, abdomen, oblique(1), oblique(-1), pelvis);

  const pec = (s: 1 | -1) => prim(`pectoral${s > 0 ? "L" : "R"}`, "ellipsoid", "spine", "torso", [s * 0.3 * h, y.nipple + 0.12 * h, cd * 0.62], { size: [0.32 * h * m, 0.26 * h, 0.2 * h * m], rot: [0, s * 0.25, 0] });
  const scap = (s: 1 | -1) => prim(`scapula${s > 0 ? "L" : "R"}`, "ellipsoid", "spine", "torso", [s * 0.33 * h, y.shoulder - 0.45 * h, -cd * 0.72], { size: [0.3 * h, 0.42 * h, 0.12 * h * m], rot: [0.15, -s * 0.35, s * 0.15] });
  const sternalNotch: Vec3 = [0, y.sternalNotch, cd * 0.7];
  const clav = (s: 1 | -1) => prim(`clavicle${s > 0 ? "L" : "R"}`, "capsule", "spine", "torso", [s * 0.08 * h, y.sternalNotch + 0.02 * h, cd * 0.7], { b: [s * sx * 0.95, y.shoulder + 0.14 * h, 0.02 * h], r: Math.max(0.065 * h, 0.6 * c) });
  const trap = (s: 1 | -1) => prim(`trapezius${s > 0 ? "L" : "R"}`, "roundCone", "spine", "torso", [0, y.neckBase + 0.15 * h, -0.15 * h], { b: [s * sx * 0.75, y.shoulder + 0.1 * h, -0.08 * h], r: 0.2 * h, r2: 0.12 * h * m });
  const glute = (s: 1 | -1) => prim(`gluteus${s > 0 ? "L" : "R"}`, "ellipsoid", "abdomen", "pelvis", [s * P.halfWidth.hip * 0.48, y.pelvis - 0.25 * h, -P.halfDepth.pelvis * 0.5], { size: [P.halfWidth.hip * 0.5, 0.48 * h, 0.34 * h * m] });
  const muscles = op("smoothUnion", 0.1 * h, core, pec(1), pec(-1), scap(1), scap(-1), clav(1), clav(-1), trap(1), trap(-1), glute(1), glute(-1));

  const navelR = Math.max(0.07 * h, 1.2 * c);
  const bellyFront: Vec3 = [0, y.navel, ellipsoidFrontZ(bellyCentre, bellySize, y.navel)];
  const navel = prim("navel", "sphere", "abdomen", "torso", [0, y.navel, bellyFront[2] + 0.3 * navelR], { r: navelR });
  const backZ = -ellipsoidFrontZ([ribCentre[0], ribCentre[1], -ribCentre[2]], ribSize, (y.ribBottom + y.shoulder) / 2);
  return { node: op("subtract", 0, muscles, navel), bellyFront, sternalNotch, backZ };
}

/** Where an arm's rigid parts mount: wrist, palm centre, grip point, fingertip (model space). */
export interface ArmAnchors { shoulder: Vec3; elbow: Vec3; wrist: Vec3; palm: Vec3; grip: Vec3; fingertip: Vec3; frame: LimbFrame }

/** One arm: deltoid, upper arm, biceps, triceps, elbow, forearm, brachioradialis, palm, finger mass, thumb. */
export function armNode(P: BodyProportions, side: 1 | -1, abduction: number): { node: SdfNode; anchors: ArmAnchors } {
  const h = P.head, R = P.radius, m = P.muscle, c = P.cell, L = side > 0 ? "L" : "R";
  const shoulder: Vec3 = [side * P.halfWidth.shoulderJoint, P.y.shoulder, -0.05 * h];
  const F = limbFrame(shoulder, abduction, side);
  const { d, o, f } = F;
  const rot: Vec3 = [0, 0, F.roll];
  const elbow = along(shoulder, d, P.upperArm);
  const wrist = along(elbow, d, P.foreArm);
  const fingertip = along(wrist, d, P.hand);
  const sb = `shoulder${L}` as BoneId, eb = `elbow${L}` as BoneId;
  const deltoid = prim(`deltoid${L}`, "ellipsoid", sb, "upperArm", sum(shoulder, mul(o, 0.08 * h), mul(d, 0.25 * h)), { size: [R.deltoid, 0.5 * h, R.deltoid * 1.05], rot });
  const upper = prim(`upperArm${L}`, "roundCone", sb, "upperArm", shoulder, { b: elbow, r: R.upperArm, r2: R.upperArmDistal });
  const biceps = prim(`biceps${L}`, "ellipsoid", sb, "upperArm", sum(shoulder, mul(d, 0.5 * P.upperArm), mul(f, 0.45 * R.upperArm)), { size: [0.62 * R.upperArm * m, 0.4 * P.upperArm, 0.58 * R.upperArm * m], rot });
  const triceps = prim(`triceps${L}`, "ellipsoid", sb, "upperArm", sum(shoulder, mul(d, 0.4 * P.upperArm), mul(f, -0.42 * R.upperArm)), { size: [0.6 * R.upperArm * m, 0.42 * P.upperArm, 0.55 * R.upperArm * m], rot });
  const upperGroup = op("smoothUnion", 0.35 * R.upperArm, upper, deltoid, biceps, triceps);
  const elbowBall = prim(`elbow${L}`, "sphere", eb, "foreArm", elbow, { r: R.upperArmDistal * 0.95 });
  const fore = prim(`foreArm${L}`, "roundCone", eb, "foreArm", elbow, { b: wrist, r: R.foreArm, r2: R.wrist });
  const brachio = prim(`brachioradialis${L}`, "ellipsoid", eb, "foreArm", sum(elbow, mul(d, 0.25 * P.foreArm), mul(o, 0.15 * R.foreArm), mul(f, 0.15 * R.foreArm)), { size: [0.7 * R.foreArm * m, 0.3 * P.foreArm, 0.7 * R.foreArm * m], rot });
  const foreGroup = op("smoothUnion", 0.35 * R.foreArm, elbowBall, fore, brachio);
  const thick = Math.max(R.palmHalfThickness, 1.1 * c);
  const palm = along(wrist, d, 0.28 * P.hand);
  const palmBox = prim(`palm${L}`, "roundBox", eb, "hand", palm, { size: [thick, 0.28 * P.hand, R.palmHalfWidth], r: 0.8 * thick, rot });
  const fingers = prim(`fingers${L}`, "roundBox", eb, "hand", sum(wrist, mul(d, 0.74 * P.hand), mul(f, 0.03 * P.hand)), {
    size: [0.85 * thick, 0.24 * P.hand, 0.92 * R.palmHalfWidth], r: 0.8 * 0.85 * thick, rot: [0.15, 0, F.roll],
  });
  const thumbBase = sum(wrist, mul(d, 0.2 * P.hand), mul(f, 0.75 * R.palmHalfWidth));
  const thumbTip = sum(wrist, mul(d, 0.55 * P.hand), mul(f, R.palmHalfWidth + 0.06 * h), mul(o, -0.3 * thick));
  const thumb = prim(`thumb${L}`, "roundCone", eb, "hand", thumbBase, { b: thumbTip, r: Math.max(0.75 * thick, 0.8 * c), r2: Math.max(0.6 * thick, 0.75 * c) });
  const handGroup = op("smoothUnion", 0.5 * thick, palmBox, fingers, thumb);
  const arm = op("smoothUnion", blendWidth(R.upperArmDistal, R.foreArm), upperGroup, foreGroup);
  const node = op("smoothUnion", blendWidth(R.wrist, thick), arm, handGroup);
  const grip = along(wrist, d, 0.45 * P.hand);
  return { node, anchors: { shoulder, elbow, wrist, palm, grip, fingertip, frame: F } };
}

/** Where a leg's joints and foot landmarks sit (model space). */
export interface LegAnchors { hip: Vec3; knee: Vec3; ankle: Vec3; ball: Vec3; toeTip: Vec3; heelBack: Vec3; frame: LimbFrame }

/** One leg: thigh, quadriceps, hamstrings, knee, patella, shin, calf, ankle, heel, instep, forefoot, toes. */
export function legNode(P: BodyProportions, side: 1 | -1, abduction: number): { node: SdfNode; anchors: LegAnchors } {
  const R = P.radius, m = P.muscle, c = P.cell, L = side > 0 ? "L" : "R";
  const hip: Vec3 = [side * P.halfWidth.hipJoint, P.y.hipJoint, 0];
  const F = limbFrame(hip, abduction, side);
  const { d, f } = F;
  const rot: Vec3 = [0, 0, F.roll];
  // The ankle sits on the abducted line at its own height; the knee splits hip→ankle thigh:shin.
  const drop = P.y.hipJoint - P.y.ankle;
  const ankle: Vec3 = [hip[0] + side * drop * Math.tan(abduction), P.y.ankle, 0];
  const legLen = Math.hypot(ankle[0] - hip[0], drop);
  const knee = along(hip, d, legLen * P.thigh / (P.thigh + P.shin));
  const hb = `hip${L}` as BoneId, kb = `knee${L}` as BoneId, ab = `ankle${L}` as BoneId, tb = `toe${L}` as BoneId;
  const rT = R.thighTop;
  const thigh = prim(`thigh${L}`, "roundCone", hb, "thigh", hip, { b: knee, r: rT, r2: R.thighDistal });
  const thighLen = legLen * P.thigh / (P.thigh + P.shin);
  const quads = prim(`quadriceps${L}`, "ellipsoid", hb, "thigh", sum(hip, mul(d, 0.5 * thighLen), mul(f, 0.3 * rT)), { size: [0.66 * rT * m, 0.36 * thighLen, 0.56 * rT * m], rot });
  const hams = prim(`hamstrings${L}`, "ellipsoid", hb, "thigh", sum(hip, mul(d, 0.5 * thighLen), mul(f, -0.3 * rT)), { size: [0.6 * rT * m, 0.32 * thighLen, 0.5 * rT * m], rot });
  const thighGroup = op("smoothUnion", 0.3 * rT, thigh, quads, hams);
  const kneeBall = prim(`knee${L}`, "sphere", kb, "shin", knee, { r: R.knee });
  const patella = prim(`patella${L}`, "ellipsoid", kb, "shin", along(knee, f, 0.75 * R.knee), { size: [0.45 * R.knee, 0.55 * R.knee, Math.max(0.3 * R.knee, 0.6 * c)] });
  const shinLen = legLen - thighLen;
  const shin = prim(`shin${L}`, "roundCone", kb, "shin", knee, { b: ankle, r: R.knee * 0.95, r2: R.ankle });
  const calf = prim(`calf${L}`, "ellipsoid", kb, "shin", sum(knee, mul(d, 0.3 * shinLen), mul(f, -0.45 * R.calf)), { size: [0.85 * R.calf * m, 0.32 * shinLen, 0.75 * R.calf * m], rot });
  const shinGroup = op("smoothUnion", 0.3 * R.knee, kneeBall, patella, shin, calf);

  // Foot along +z: heel back a quarter foot behind the ankle, ball at 72 % of the length.
  // Heel, forefoot and toes sink SOLE_CONTACT of their height below y = 0 (cut flat later).
  const heelR = R.heel, ballR = Math.max(0.6 * R.footHalfWidth, 1.1 * c), toeR = Math.max(0.75 * ballR, 0.9 * c);
  const below = (r: number) => r * (1 - SOLE_CONTACT); // centre height of a sole volume
  const heelBackZ = ankle[2] - 0.25 * P.foot;
  const ballZ = heelBackZ + 0.72 * P.foot, toeTipZ = heelBackZ + P.foot;
  const ax = ankle[0];
  const malleoli = prim(`malleoli${L}`, "ellipsoid", ab, "foot", ankle, { size: [R.ankle * 1.15, R.ankle * 0.9, R.ankle] });
  const heel = prim(`heel${L}`, "ellipsoid", ab, "foot", [ax, below(heelR), heelBackZ + 1.1 * heelR], { size: [heelR * 0.9, heelR, heelR * 1.1] });
  const instep = prim(`instep${L}`, "roundCone", ab, "foot", ankle, { b: [ax, ballR * 1.1, ballZ], r: R.ankle * 0.9, r2: ballR * 0.9 });
  const arch = prim(`arch${L}`, "roundCone", ab, "foot", [ax, heelR, heelBackZ + 1.1 * heelR], { b: [ax, ballR, ballZ], r: 0.85 * heelR, r2: ballR * 0.9 });
  const forefoot = prim(`forefoot${L}`, "ellipsoid", ab, "foot", [ax, below(ballR), ballZ], { size: [R.footHalfWidth, ballR, ballR * 1.2] });
  const toes = prim(`toes${L}`, "ellipsoid", tb, "foot", [ax, below(toeR), ballZ + 0.14 * P.foot], { size: [R.footHalfWidth * 0.92, toeR, 0.16 * P.foot] });
  const footGroup = op("smoothUnion", 0.5 * heelR, malleoli, heel, instep, arch, forefoot, toes);
  const leg = op("smoothUnion", blendWidth(R.thighDistal, R.knee), thighGroup, shinGroup);
  const node = op("smoothUnion", blendWidth(R.ankle, heelR), leg, footGroup);
  return {
    node,
    anchors: { hip, knee, ankle, ball: [ax, ballR, ballZ], toeTip: [ax, toeR, toeTipZ], heelBack: [ax, 0, heelBackZ], frame: F },
  };
}
