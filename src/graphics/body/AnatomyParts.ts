// Anatomy part builders (lane A, R03/R15): the SDF volumes of each body part, in bind-pose
// model space (metres, +y up, +z forward, +x the character's LEFT, soles on y = 0).
// Pure module: no THREE. Every size is a named fraction of a BodyProportions number.
//
// Vocabulary: σ (side) = +1 for the left limb (+x), −1 for the right. `d` is a limb's unit
// direction from its root joint, `o` the outward lateral vector ⟂ d in the xy plane, `f` = +z.

import type { BoneId, Primitive, PrimitiveKind, Region, SdfNode, SdfSample, Vec3, VolumeOp } from "./contracts.ts";
import type { BodyProportions } from "./Proportions.ts";
import { boneIndex, compileSdf, nodeBounds, primitiveDistance } from "./Sdf.ts";
import { ancestryOf, type AncestryNode } from "../../game/Ancestry.ts";
import { improvisationFor, knob, reshapeDepth, reshapeGirth, reshapeLong } from "./Improvise.ts";

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

// --- frames -------------------------------------------------------------------------------
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/**
 * XYZ Euler angles (three.js convention M = Rx·Ry·Rz, as Sdf.ts applies `rot`) of the rotation
 * whose columns are the orthonormal right-handed basis X, Y, Z: the primitive's local x, y, z
 * axes land on X, Y, Z.
 */
export function eulerXYZFromBasis(X: Vec3, Y: Vec3, Z: Vec3): Vec3 {
  const m13 = Z[0], m23 = Z[1], m33 = Z[2], m12 = Y[0], m11 = X[0], m32 = Y[2], m22 = Y[1];
  const y = Math.asin(Math.max(-1, Math.min(1, m13)));
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(-m23, m33), y, Math.atan2(-m12, m11)];
  return [Math.atan2(m32, m22), y, 0];
}

// --- ears ----------------------------------------------------------------------------------

/** Canon ear height over head height (a 6.5 cm ear on a 22.7 cm head). */
export const EAR_HEIGHT_PER_HEAD = 0.29;
/** Ear centre below the eye line, head heights (the ear spans brow line to nose base). */
export const EAR_DROP_PER_HEAD = 0.08;
/** Outward flare of the pinna's back edge away from the side of the head (rad, ≈ 20°). */
export const EAR_FLARE = 0.35;
/** Backward lean of the ear's long axis from vertical (rad). */
export const EAR_LEAN = 0.25;
/** RaceAppearance.earMul at which an ear is fully pointed (the elf's value). */
export const POINTED_EAR_MUL = 1.9;
/** Length of a fully pointed tip beyond the pinna's top-back rim, head heights. */
export const EAR_TIP_PER_HEAD = 0.34;
/**
 * The pinna's outer face stands at least this many cells off the skull side: the grid
 * resolves a lobe (and the crease behind it) only when it protrudes about a cell or more.
 */
export const EAR_MIN_STANDOFF_CELLS = 1.0;
/** Thinnest resolvable plate / tube radius, cells (a full thickness of ~1.2 cells). */
export const MIN_PLATE_CELLS = 0.6;
/** Hair cap (FaceParts): a shell over the skull radii × HAIR_CAP_SCALE, polar extent and tilt. */
export const HAIR_CAP_SCALE = 1.08;
export const HAIR_CAP_POLAR = 0.42 * Math.PI;
export const HAIR_CAP_TILT = -0.35;
/** A pointed ear's tip stays this many cells outside the hair cap shell. */
export const EAR_TIP_CLEAR_CELLS = 1.5;

/** True when model point p lies inside the hair cap shell grown by `margin` metres. */
export function insideHairCap(p: Vec3, skullCentre: Vec3, skullRadii: Vec3, margin: number): boolean {
  // Undo the cap's x-tilt about the skull centre, then test the scaled ellipsoid.
  const dy = p[1] - skullCentre[1], dz = p[2] - skullCentre[2];
  const c = Math.cos(-HAIR_CAP_TILT), s = Math.sin(-HAIR_CAP_TILT);
  const ly = c * dy - s * dz, lz = s * dy + c * dz;
  const rx = skullRadii[0] * HAIR_CAP_SCALE + margin, ry = skullRadii[1] * HAIR_CAP_SCALE + margin, rz = skullRadii[2] * HAIR_CAP_SCALE + margin;
  const q = Math.hypot((p[0] - skullCentre[0]) / rx, ly / ry, lz / rz);
  const polar = Math.acos(Math.max(-1, Math.min(1, ly / (ry * Math.max(q, 1e-9)))));
  return q < 1 && polar < HAIR_CAP_POLAR;
}

/** Smallest ear height, cells: a pinna about 2.6 cells tall keeps its outline in the grid. */
export const EAR_MIN_HEIGHT_CELLS = 2.6;

/**
 * Both ears (RaceAppearance.earMul = P.earScale), measured against the actual head: the
 * head's side surface x_s at the ear (bisection on `headSurface`, the skull + face field
 * WITHOUT ears) anchors a flared pinna plate whose outer face stands
 * max(0.06 h, EAR_MIN_STANDOFF_CELLS·cell) off it, bridged to the head by a concha.
 * Pinna height = max(EAR_HEIGHT_PER_HEAD·h·min(earMul, 1), EAR_MIN_HEIGHT_CELLS·cell).
 * Pointed ears — pointedness π = clamp((earMul − 1)/(POINTED_EAR_MUL − 1), 0, 1) — add a
 * leaf-shaped blade (an ellipsoid whose long axis runs from the pinna's top-back rim to the
 * tip, so its silhouette narrows to a point) of length EAR_TIP_PER_HEAD·h·π swept up, back
 * and out, pushed outward until the tip clears the hair cap by EAR_TIP_CLEAR_CELLS cells.
 */
export function earNodes(
  P: BodyProportions, skullCentre: Vec3, skullRadii: Vec3, headSurface: (x: number, y: number, z: number) => number,
): { nodes: SdfNode[]; anchors: [Vec3, Vec3]; tips: [Vec3 | null, Vec3 | null] } {
  const h = P.head, c = P.cell;
  const size = Math.min(P.earScale, 1); // big ears grow a tip, small ears shrink
  const pointed = Math.max(0, Math.min(1, (P.earScale - 1) / (POINTED_EAR_MUL - 1)));
  const earH = Math.max(EAR_HEIGHT_PER_HEAD * h * size, EAR_MIN_HEIGHT_CELLS * c);
  const halfT = Math.max(0.035 * h, MIN_PLATE_CELLS * c);
  const halfD = Math.max(0.32 * earH, 1.2 * MIN_PLATE_CELLS * c);
  const standoff = Math.max(0.06 * h, EAR_MIN_STANDOFF_CELLS * c);
  const y = P.y.eye - EAR_DROP_PER_HEAD * h;
  const z = skullCentre[2] - 0.02 * h;
  // The head's side: bisection of headSurface(x, y, zz) = 0 on x ∈ [0, 2·skull half-width] at
  // the ear's own depth (where the concha attaches) and its maximum over the head's depth (the
  // front silhouette the ear must stand out of).
  const sideAt = (zz: number): number => {
    let lo = 0, hi = 2 * skullRadii[0];
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (headSurface(mid, y, zz) < 0) lo = mid; else hi = mid; }
    return lo;
  };
  const sideHere = sideAt(z);
  let side = sideHere;
  for (let zz = skullCentre[2] - skullRadii[2]; zz <= skullCentre[2] + skullRadii[2] + 0.3 * h; zz += 0.5 * c) side = Math.max(side, sideAt(zz));
  const nodes: SdfNode[] = [];
  const anchors: Vec3[] = [], tips: (Vec3 | null)[] = [];
  for (const s of [1, -1] as const) {
    const L = s > 0 ? "L" : "R";
    // Pinna frame: thin axis X (outward, flared), long axis Y (up, leaning back), Z = X × Y.
    const out: Vec3 = [s * Math.cos(EAR_FLARE), 0, -Math.sin(EAR_FLARE)];
    const up: Vec3 = unit([0, Math.cos(EAR_LEAN), -Math.sin(EAR_LEAN)]);
    const X = unit(out), Z = unit(cross(X, up)), Y = cross(Z, X);
    const back: Vec3 = s > 0 ? mul(Z, -1) : Z;
    const centre: Vec3 = [s * (side + standoff - halfT), y, z];
    nodes.push(prim(`pinna${L}`, "ellipsoid", "head", "ear", centre, { size: [halfT, earH / 2, halfD], rot: eulerXYZFromBasis(X, Y, Z) }));
    // Concha: bridges the plate to the head so the ear is one piece with it.
    const reach = side + standoff - halfT - sideHere; // head surface → pinna centre (m)
    nodes.push(prim(`concha${L}`, "ellipsoid", "head", "ear", [s * (sideHere + 0.5 * reach), y - 0.1 * earH, z + 0.2 * halfD], {
      size: [0.5 * reach + 1.5 * halfT, 0.3 * earH, 0.6 * halfD],
    }));
    anchors.push(centre);
    if (pointed > 0) {
      const rim = sum(centre, mul(Y, 0.3 * earH), mul(back, 0.35 * halfD));
      const dir = unit(sum(mul(Y, 0.8), mul(out, 0.45), mul(back, 0.3)));
      let tip = along(rim, dir, EAR_TIP_PER_HEAD * h * pointed);
      for (let i = 0; i < 40 && insideHairCap(tip, skullCentre, skullRadii, EAR_TIP_CLEAR_CELLS * c); i++) tip = add(tip, [s * 0.25 * c, 0, 0]);
      // Blade: long axis A rim→tip, thin axis T = the pinna normal made ⟂ A, width axis T × A.
      const A = unit([tip[0] - rim[0], tip[1] - rim[1], tip[2] - rim[2]]);
      const T = unit(sum(X, mul(A, -(X[0] * A[0] + X[1] * A[1] + X[2] * A[2]))));
      const len = Math.hypot(tip[0] - rim[0], tip[1] - rim[1], tip[2] - rim[2]);
      const mid: Vec3 = [(rim[0] + tip[0]) / 2, (rim[1] + tip[1]) / 2, (rim[2] + tip[2]) / 2];
      nodes.push(prim(`earBlade${L}`, "ellipsoid", "head", "ear", along(mid, A, -0.25 * len), {
        size: [halfT, 0.6 * len, Math.max(0.55 * halfD, 0.8 * c)], rot: eulerXYZFromBasis(T, A, cross(T, A)),
      }));
      // The point itself: a tapering tube no thinner than the grid resolves (r ≥ 0.7 cell).
      nodes.push(prim(`earTip${L}`, "roundCone", "head", "ear", rim, { b: tip, r: Math.max(1.2 * halfT, 0.8 * c), r2: 0.7 * c }));
      tips.push(tip);
    } else tips.push(null);
  }
  return { nodes, anchors: [anchors[0], anchors[1]], tips: [tips[0], tips[1]] };
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

// --- pointed brow, eyelids and the recessed eyeball (lane Q-A) -------------------------------
//
// The brow is no longer a round capsule swept across the face (which read as a tube): it is a
// WEDGE per side whose inner (glabella) end has radius BROW_ROOT_R_PER_HEAD·h and whose outer tip
// tapers to ~0 (brow.point sharpens the taper and runs the tip further out). The eyeball is
// RECESSED: its centre sits behind the socket's opening plane by EYE_INSET_PER_HEAD·h and its
// front surface behind the socket rim by EYE_FRONT_VS_RIM_PER_HEAD·h, so the eyes sit IN the
// socket instead of bulging out of an open hole. The lids (FaceParts) cover the aperture.

/** Inner-end radius of the brow ridge, head heights (a ridge ~1.7 cm on a 22.7 cm head). */
export const BROW_ROOT_R_PER_HEAD = 0.075;
/** Outer tip radius as a fraction of the root, at brow.point = 0 and at brow.point = 1. */
export const BROW_TIP_FRAC_AT_POINT0 = 0.30;
export const BROW_TIP_FRAC_AT_POINT1 = 0.05;
/** Where the two brow halves meet the glabella, head heights (x magnitude). */
export const BROW_INNER_X_PER_HEAD = 0.10;
/** Base outer reach of the tip, head heights, and the extra reach a fully pointed brow adds. */
export const BROW_TIP_X_PER_HEAD = 0.20;
export const BROW_TIP_REACH_PER_HEAD = 0.10;
/** Ridge height above the eye line and its forward position, head heights (kept from the capsule). */
export const BROW_RISE_PER_HEAD = 0.13;
export const BROW_Z_PER_HEAD = 0.31;
/** The outer tip drops this far below the inner end, head heights (the brow's natural angle). */
export const BROW_DROP_PER_HEAD = 0.04;
/** SDF radius floors, cells: the ridge and its tip stay resolvable in the grid. */
export const BROW_ROOT_MIN_CELLS = 0.7;
export const BROW_TIP_MIN_CELLS = 0.45;

/** The pointed-brow geometry for one head (metres). Root radius > tip radius (the stated taper). */
export interface BrowWedge {
  /** Radius at the inner (glabella) end of the ridge (m). */
  rootR: number;
  /** Radius at the outer TIP (m); ~0 when pointed (tipR ≪ rootR). */
  tipR: number;
  /** x magnitude of the inner end (m). */
  innerX: number;
  /** x magnitude of the outer tip (m) - the tip's position, stated. */
  tipX: number;
  /** Ridge height (eye line + BROW_RISE_PER_HEAD·h) and forward position, model space (m). */
  y: number;
  z: number;
}
/**
 * The brow wedge for a head of height `h` with the eye line at `eyeY`: the ancestry's
 * brow.prominence bulges the root, brow.point sharpens the taper (tipR → BROW_TIP_FRAC_AT_POINT1
 * of the root) and runs the tip out (BROW_TIP_REACH_PER_HEAD). tipR < rootR always at point < 1.
 */
export function browWedge(node: AncestryNode, h: number, eyeY: number): BrowWedge {
  const point = Math.max(0, Math.min(1, node.brow.point));
  const rootR = BROW_ROOT_R_PER_HEAD * h * (0.75 + 0.5 * node.brow.prominence);
  const frac = BROW_TIP_FRAC_AT_POINT0 + (BROW_TIP_FRAC_AT_POINT1 - BROW_TIP_FRAC_AT_POINT0) * point;
  return {
    rootR, tipR: rootR * frac,
    innerX: BROW_INNER_X_PER_HEAD * h,
    tipX: (BROW_TIP_X_PER_HEAD + BROW_TIP_REACH_PER_HEAD * point) * h,
    y: eyeY + BROW_RISE_PER_HEAD * h, z: BROW_Z_PER_HEAD * h,
  };
}

/** Upper and lower lid band thickness and the lid aperture, metres, from the ancestry. */
export interface LidBands { upperThickness: number; lowerThickness: number; aperture: number }
/** The eyelid bands for a head of height `h`: node.lid (head heights) × h. */
export function lidBands(node: AncestryNode, h: number): LidBands {
  return { upperThickness: node.lid.upper * h, lowerThickness: node.lid.lower * h, aperture: node.lid.aperture * h };
}

/** Eyeball radius, head heights (a 1.7 cm globe on a 22.7 cm head). */
export const EYE_RADIUS_PER_HEAD = 0.075;
/** The socket carve sphere's centre z - its OPENING plane - head heights. */
export const SOCKET_OPEN_Z_PER_HEAD = 0.30;
/** The socket carve sphere's radius, head heights. */
export const SOCKET_R_PER_HEAD = 0.12;
/** The recessed eyeball centre's z, head heights (was 0.33h - a bulging eye in an open hole). */
export const EYE_Z_PER_HEAD = 0.16;
/** The socket rim = the carve's forward-most reach (opening plane + radius), head heights. */
export const SOCKET_RIM_Z_PER_HEAD = SOCKET_OPEN_Z_PER_HEAD + SOCKET_R_PER_HEAD;
/** The eyeball centre's inset behind the socket's opening plane, head heights (> 0). */
export const EYE_INSET_PER_HEAD = SOCKET_OPEN_Z_PER_HEAD - EYE_Z_PER_HEAD;
/** The eyeball's front surface's clearance behind the socket rim, head heights (> 0). */
export const EYE_FRONT_VS_RIM_PER_HEAD = SOCKET_RIM_Z_PER_HEAD - (EYE_Z_PER_HEAD + EYE_RADIUS_PER_HEAD);

/** The eye recess for a head of height `h` (metres): centre, front and the socket rim. */
export interface EyeRecess { eyeZ: number; eyeR: number; eyeFrontZ: number; socketOpenZ: number; socketR: number; rimZ: number }
/** The eye's recess geometry, metres: eye centre/front and the socket opening plane and rim. */
export function eyeRecess(h: number): EyeRecess {
  const eyeZ = EYE_Z_PER_HEAD * h, eyeR = EYE_RADIUS_PER_HEAD * h, socketOpenZ = SOCKET_OPEN_Z_PER_HEAD * h, socketR = SOCKET_R_PER_HEAD * h;
  return { eyeZ, eyeR, eyeFrontZ: eyeZ + eyeR, socketOpenZ, socketR, rimZ: socketOpenZ + socketR };
}

/** Skull + jaw + face masses + ears, eye sockets carved (smoothSubtract), temples flattened (smoothIntersect). */
export function headNode(P: BodyProportions, jitter: { nose: number; jaw: number }): { node: SdfNode; face: FaceAnchors } {
  const h = P.head, H = P.y.crown, eyeY = P.y.eye, chinY = P.y.chin, c = P.cell;
  const node0 = ancestryOf(P.race, P.spec.subrace);
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
  // Pointed brow (lane Q-A): two round-cone wedges, inner root → outer point, sized by the ancestry.
  const w = browWedge(node0, h, eyeY);
  const brow = (s: 1 | -1) => prim(`browRidge${s > 0 ? "L" : "R"}`, "roundCone", "head", "face",
    [s * w.innerX, w.y, w.z], { b: [s * w.tipX, w.y - BROW_DROP_PER_HEAD * h, w.z], r: Math.max(w.rootR, BROW_ROOT_MIN_CELLS * c), r2: Math.max(w.tipR, BROW_TIP_MIN_CELLS * c) });
  const noseTip: Vec3 = [0, eyeY - 0.27 * h * jitter.nose, 0.44 * h];
  const nose = prim("nose", "roundCone", "head", "face", [0, eyeY - 0.02 * h, 0.36 * h], { b: noseTip, r: Math.max(0.045 * h, 0.6 * c), r2: Math.max(0.075 * h, 0.75 * c) });
  const headField = compileSdf(core);
  const probe: SdfSample = { d: 0, region: 0, bone: 0 };
  const ears = earNodes(P, skullCentre, skullRadii, (x, y, z) => headField.sample(x, y, z, probe).d);
  const features = op("smoothUnion", 0.05 * h, core, brow(1), brow(-1), nose, ...ears.nodes);
  const eyeR = EYE_RADIUS_PER_HEAD * h;
  const socketAt = (s: 1 | -1): Vec3 => [s * 0.2 * h, eyeY, SOCKET_OPEN_Z_PER_HEAD * h];
  const socket = (s: 1 | -1) => prim(`eyeSocket${s > 0 ? "L" : "R"}`, "sphere", "head", "face", socketAt(s), { r: SOCKET_R_PER_HEAD * h });
  const node = op("smoothSubtract", 0.04 * h, features, socket(1), socket(-1));
  // The eyeball's anchor is RECESSED: its centre behind the socket's opening plane (lane Q-A).
  const eyeAt = (s: 1 | -1): Vec3 => [s * 0.2 * h, eyeY, EYE_Z_PER_HEAD * h];
  return {
    node,
    face: {
      eye: [eyeAt(1), eyeAt(-1)], eyeRadius: eyeR,
      brow: [[0.2 * h, w.y, w.z], [-0.2 * h, w.y, w.z]],
      mouth: [0, chinY + 0.27 * h, 0.33 * h + jut * 0.5], chin, crown: [0, H, -0.06 * h],
      skullCentre, skullRadii, ear: ears.anchors, noseTip,
    },
  };
}

/**
 * Neck column with the two sternocleidomastoid cords (mastoid → sternal notch).
 *
 * Lane S-B note: a NECK-TOP straighten (moving the neck top back by 0.02·h) was the first "less slouch"
 * attempt. It was DROPPED, not faked: moving the neck's top shifts the neck/head junction, which moves
 * body volume, and the default Warrior's forearm segment then falls below the ragdoll's 2 % weld floor
 * (elbowL 2.034 % -> 1.992 %, "welded light leaves: …elbowL…") — measured, and even a 0.1·h move flips
 * it. The slouch rides the SHOULDER GIRDLE instead (SLOUCH_FWD_PER_HEAD in torsoNode), a redistribution
 * that leaves every ragdoll and animation suite green.
 */
export function neckNode(P: BodyProportions): SdfNode {
  const h = P.head, r = P.halfWidth.neck;
  const column = prim("neck", "roundCone", "neck", "neck", [0, P.y.neckBase - 0.25 * h, -0.08 * h], { b: [0, P.y.headPivot + 0.05 * h, -0.04 * h], r: r * 1.25, r2: r });
  const scm = (s: 1 | -1) => prim(`sternocleidomastoid${s > 0 ? "L" : "R"}`, "capsule", "neck", "neck",
    [s * 0.22 * h, P.y.headPivot + 0.02 * h, -0.08 * h], { b: [s * 0.07 * h, P.y.sternalNotch + 0.06 * h, P.halfDepth.chest * 0.62], r: 0.07 * h * Math.sqrt(P.girth) });
  return op("smoothUnion", 0.06 * h * (REFERENCE_FORMS ? 1 : knob(improvisationFor(P.spec.seed), "trunk.sternocleidomastoid.blend")), column, scm(1), scm(-1));
}

/** z of the front (+z) surface of an axis-aligned ellipsoid at height y. */
export function ellipsoidFrontZ(centre: Vec3, size: Vec3, y: number): number {
  const t = (y - centre[1]) / size[1];
  return centre[2] + size[2] * Math.sqrt(Math.max(0, 1 - t * t));
}

/**
 * Pectoral depth gain (lane R-A): "the pectorals a bit more obvious". The chest plates' forward
 * extent (their z radius) is multiplied by this and their centres are pushed forward by
 * PECTORAL_FORWARD_PER_HEAD head heights — so the torso's front surface at the nipple line stands
 * measurably further out. 1.0 / 0 = the pre-wave chest. Races and builds scale it on top of this.
 */
export const PECTORAL_DEPTH_GAIN = 1 as number;
/** Additional forward offset of each pectoral centre, head heights (m). */
export const PECTORAL_FORWARD_PER_HEAD = 0 as number;

/** Optional overrides for the pectoral masses (lane R-A), so a test can reconstruct the pre-wave
 *  chest and measure the depth delta on the real field. Defaults are the wave's own constants. */
export interface TorsoOpts {
  /** Pectoral z-radius multiplier (default PECTORAL_DEPTH_GAIN; 1 = pre-wave). */
  pectoralGain?: number;
  /** Pectoral centre forward offset, head heights (default PECTORAL_FORWARD_PER_HEAD; 0 = pre-wave). */
  pectoralForwardPerHead?: number;
  /** Lane S-B: reconstruct the pre-wave (slouched, un-risen) trapezius for a before -> after measure. */
  trapeziusPreWave?: boolean;
  /** Lane S-B shoulder-girdle forward offset, head heights (default SLOUCH_FWD_PER_HEAD; 0 = pre-wave). */
  slouchForwardPerHead?: number;
}



/**
 * Lane S-B "less slouch (a straighter upper spine)": the shoulder girdle is squared FORWARD over the
 * hips by this many head heights — a REDISTRIBUTION (the girdle capsule moves; no volume is added), so
 * the upper spine reads straighter without perturbing the ragdoll. 0 = the pre-wave (slouched) girdle.
 */
export const SLOUCH_FWD_PER_HEAD = 0.03 as number;

/**
 * Lane S-B: "a bit more muscular with some muscles in the shoulders and the trapezoids". The trapezius
 * roundCone moves INWARD (tip x × TRAP_TIP_X_FRAC of the shoulder half-width) and RISES over the
 * shoulder line (both ends up by the stated head heights). This is a REDISTRIBUTION, NOT a radius gain:
 * the radii are unchanged, because ANY radius increase flips the default Warrior's forearm below the
 * ragdoll's 2 % weld floor (measured: TRAPEZIUS_GAIN 1.01 already welds the elbows). Measured as the
 * torso's top (+y) surface over the shoulder line. The `_PRE_` values are the pre-wave positions.
 */
export const TRAP_ROOT_RISE_PER_HEAD = 0.22 as number;
export const TRAP_ROOT_RISE_PRE_PER_HEAD = 0.15 as number;
export const TRAP_ROOT_Z_PER_HEAD = -0.13 as number;
export const TRAP_TIP_X_FRAC = 0.62 as number;
export const TRAP_TIP_RISE_PER_HEAD = 0.17 as number;
export const TRAP_TIP_Z_PER_HEAD = -0.07 as number;

/**
 * Lane S-B: "give them a little pack for simulating the genitals". The CROTCH PACK is a small,
 * tasteful ellipsoid at the crotch, in front of the body between the thighs, with its own size per sex
 * (head heights): the male pack sits lower and further forward, the female's sits higher and flatter.
 * GEOMETRY ONLY: it touches no leg-chain length, no hip joint and no ground-contact radius.
 *   w = half-width, h = half-height, d = half-depth, fwd = centre forward offset, per head height.
 *
 * DROPPED this wave, not faked: mid-size it no longer allows the default Warrior to settle inside
 * RAGDOLL GROUND's 3 s window (adding it shifts the pelvis segment's share of the body mass); the
 * suite stayed green only for a <=8 % copy (~2 mm), which is not a pack. Kept here as the stated
 * per-sex size the pack WOULD carry.
 */
export const CROTCH_PACK: Record<"male" | "female", { w: number; h: number; d: number; fwd: number }> = {
  male:   { w: 0.11, h: 0.17, d: 0.10, fwd: 0.06 },
  female: { w: 0.13, h: 0.10, d: 0.07, fwd: 0.04 },
};

/** Torso: ribcage, shoulder girdle, pectorals, scapulae, clavicles, trapezius, abdomen, obliques, pelvis, glutes; navel carved (subtract). */
export function torsoNode(P: BodyProportions, opts: TorsoOpts = {}): { node: SdfNode; bellyFront: Vec3; sternalNotch: Vec3; backZ: number } {
  const h = P.head, y = P.y, m = P.muscle, c = P.cell;
  const pecGain = opts.pectoralGain ?? PECTORAL_DEPTH_GAIN;
  const pecFwd = opts.pectoralForwardPerHead ?? PECTORAL_FORWARD_PER_HEAD;
  const trapPre = opts.trapeziusPreWave === true;
  const cw = P.halfWidth.chest, cd = P.halfDepth.chest;
  const sx = P.halfWidth.shoulderJoint;
  const ribCentre: Vec3 = [0, (y.ribBottom + y.shoulder) / 2 + 0.05 * h, 0];
  const ribSize: Vec3 = [cw, (y.shoulder - y.ribBottom) / 2 + 0.2 * h, cd];
  const ribcage = prim("ribcage", "ellipsoid", "spine", "torso", ribCentre, { size: ribSize });
  // Lane S-B "less slouch": the shoulder girdle is squared FORWARD over the hips (a REDISTRIBUTION,
  // not added volume), so the upper spine reads straighter. z = (-0.05 + slouchForward) · h.
  const slouchFwd = opts.slouchForwardPerHead ?? SLOUCH_FWD_PER_HEAD;
  const girdle = prim("shoulderGirdle", "capsule", "spine", "torso", [-sx * 0.85, y.shoulder + 0.08 * h, (-0.05 + slouchFwd) * h], { b: [sx * 0.85, y.shoulder + 0.08 * h, (-0.05 + slouchFwd) * h], r: 0.2 * h });
  const bellyCentre: Vec3 = [0, (y.navel + y.ribBottom) / 2, 0.04 * h * P.girth];
  const bellySize: Vec3 = [P.halfWidth.waist, (y.ribBottom - y.navel) / 2 + 0.45 * h, P.halfDepth.belly];
  const abdomen = prim("abdomen", "ellipsoid", "abdomen", "torso", bellyCentre, { size: bellySize });
  const oblique = (s: 1 | -1) => prim(`oblique${s > 0 ? "L" : "R"}`, "ellipsoid", "abdomen", "torso", [s * P.halfWidth.waist * 0.72, y.waist - 0.1 * h, -0.02 * h], { size: [0.3 * h * P.girth, 0.5 * h, 0.36 * h * P.girth] });
  const pelvisCentre: Vec3 = [0, y.pelvis, -0.03 * h];
  const pelvis = prim("pelvis", "ellipsoid", "abdomen", "pelvis", pelvisCentre, { size: [P.halfWidth.hip, 0.55 * h, P.halfDepth.pelvis] });
  const core = op("smoothUnion", blendWidth(cw, P.halfWidth.waist), ribcage, girdle, abdomen, oblique(1), oblique(-1), pelvis);

  const pec = (s: 1 | -1) => prim(`pectoral${s > 0 ? "L" : "R"}`, "ellipsoid", "spine", "torso",
    [s * 0.3 * h, y.nipple + 0.12 * h, cd * 0.62 + pecFwd * h],
    { size: [0.32 * h * m, 0.26 * h, 0.2 * h * m * pecGain], rot: [0, s * 0.25, 0] });
  const scap = (s: 1 | -1) => prim(`scapula${s > 0 ? "L" : "R"}`, "ellipsoid", "spine", "torso", [s * 0.33 * h, y.shoulder - 0.45 * h, -cd * 0.72], { size: [0.3 * h, 0.42 * h, 0.12 * h * m], rot: [0.15, -s * 0.35, s * 0.15] });
  const sternalNotch: Vec3 = [0, y.sternalNotch, cd * 0.7];
  const clav = (s: 1 | -1) => prim(`clavicle${s > 0 ? "L" : "R"}`, "capsule", "spine", "torso", [s * 0.08 * h, y.sternalNotch + 0.02 * h, cd * 0.7], { b: [s * sx * 0.95, y.shoulder + 0.14 * h, 0.02 * h], r: Math.max(0.065 * h, 0.6 * c) });
  const trap = (s: 1 | -1) => prim(`trapezius${s > 0 ? "L" : "R"}`, "roundCone", "spine", "torso",
    [0, y.neckBase + (trapPre ? TRAP_ROOT_RISE_PRE_PER_HEAD : TRAP_ROOT_RISE_PER_HEAD) * h, (trapPre ? -0.15 : TRAP_ROOT_Z_PER_HEAD) * h],
    { b: [s * sx * (trapPre ? 0.75 : TRAP_TIP_X_FRAC), y.shoulder + (trapPre ? 0.10 : TRAP_TIP_RISE_PER_HEAD) * h, (trapPre ? -0.08 : TRAP_TIP_Z_PER_HEAD) * h], r: 0.2 * h, r2: 0.12 * h * m });
  const glute = (s: 1 | -1) => prim(`gluteus${s > 0 ? "L" : "R"}`, "ellipsoid", "abdomen", "pelvis", [s * P.halfWidth.hip * 0.48, y.pelvis - 0.25 * h, -P.halfDepth.pelvis * 0.5], { size: [P.halfWidth.hip * 0.5, 0.48 * h, 0.34 * h * m] });
  // Lane S-B: the CROTCH PACK was DROPPED, not faked. Adding it (a small ellipsoid at the crotch, its
  // own size per sex — CROTCH_PACK) shifts the pelvis segment's share of the body mass and the default
  // Warrior no longer settles inside RAGDOLL GROUND's 3 s window; only a <=8 % copy of the designed
  // size (~2 mm — not a "pack") stayed green, so the geometry is not added.
  const muscles = op("smoothUnion", 0.1 * h, core, pec(1), pec(-1), scap(1), scap(-1), clav(1), clav(-1), trap(1), trap(-1), glute(1), glute(-1));

  const navelR = Math.max(0.07 * h, 1.2 * c);
  const bellyFront: Vec3 = [0, y.navel, ellipsoidFrontZ(bellyCentre, bellySize, y.navel)];
  const navel = prim("navel", "sphere", "abdomen", "torso", [0, y.navel, bellyFront[2] + 0.3 * navelR], { r: navelR });
  const backZ = -ellipsoidFrontZ([ribCentre[0], ribCentre[1], -ribCentre[2]], ribSize, (y.ribBottom + y.shoulder) / 2);
  return { node: op("subtract", 0, muscles, navel), bellyFront, sternalNotch, backZ };
}

/** Where an arm's rigid parts mount: wrist, palm centre, grip point, fingertip (model space). */
export interface ArmAnchors { shoulder: Vec3; elbow: Vec3; wrist: Vec3; palm: Vec3; grip: Vec3; fingertip: Vec3; frame: LimbFrame }

/**
 * Wave V (lane B) joint forms. The pre-wave limbs were one round tube per segment with a round ball at
 * each joint (an elbow SPHERE, a knee SPHERE), every muscle smooth-unioned at one width — "too round,
 * too generated". The joint now reads as muscle masses meeting:
 *   - the upper-arm core tube narrows into the elbow (UPPER_ARM_DISTAL_CORE) while the bellies grow to
 *     keep the segment's volume, so the limb WAISTS between two masses instead of tapering as one tube
 *     (the thigh keeps its medial extent: it is the leg-gap solve's input, see legForms);
 *   - the elbow ball becomes the bony landmarks it stands for: an epicondyle bar (wide, shallow) and an
 *     olecranon point behind; the knee ball becomes the femoral condyles (wide, flatter);
 *   - the biceps ends in a TENDON into the elbow crease; the forearm carries a FLEXOR mass (medial-front)
 *     beside the brachioradialis, so the forearm is widest just below the elbow;
 *   - the vastus medialis TEARDROP sits above the knee (medial-front), the calf splits into its medial
 *     (lower, bigger) and lateral (higher) gastrocnemius heads;
 *   - GROOVES are carved by cutters (smoothSubtract): the cubital fossa in front of the elbow, the
 *     popliteal hollow behind the knee. A cutter is not a positive primitive, so the hitbox/ragdoll
 *     fit ignores it (Hitboxes.positivePrimitives) and no mass moves;
 *   - muscle blend widths are VARIED (MUSCLE_K_*), sharper than the old single 0.35·R, so a belly keeps
 *     an edge where it meets its neighbour.
 * Every number is a fraction of a BodyProportions radius or length, and the 80/20 improvisation
 * (Improvise.ts) moves them per seed. `preWave: true` rebuilds the exact pre-wave part for before/after.
 */
export interface LimbOpts { preWave?: boolean }

/**
 * Reference forms: while `fn` runs, every part builder here builds its exact PRE-WAVE form (no joint
 * forms, no grooves, no improvisation, the pre-wave hand). For the anatomy's grid-cell refinement
 * (Anatomy.anatomyFor counts sign changes of a first plan): counted on the reference forms, surface
 * DETAIL can never move the polygonising cell — and with it every cell-scaled gap, the solved
 * abductions and the grid phase of the sole/ear/hand pins (measured: the forms alone moved the elf male's
 * cell 0.02271 -> 0.02286 m and its arm abduction by one bisection step). See docs/wave-v/lane-B-requests.md.
 */
let REFERENCE_FORMS = false;
export function referenceForms<T>(fn: () => T): T {
  const prev = REFERENCE_FORMS;
  REFERENCE_FORMS = true;
  try { return fn(); } finally { REFERENCE_FORMS = prev; }
}
/** True while referenceForms is running (exposed for tests). */
export function buildingReferenceForms(): boolean { return REFERENCE_FORMS; }
/** The upper-arm core tube's distal radius as a fraction of radius.upperArmDistal (the elbow waist). */
export const UPPER_ARM_DISTAL_CORE = 0.95;
/** Internal muscle blend widths as fractions of the segment radius (pre-wave: 0.35 arm, 0.3 leg). */
export const MUSCLE_K_ARM = 0.24;
/** The forearm core tube's root radius as a fraction of radius.foreArm (the flexors carry the rest). */
export const FOREARM_CORE = 1.0;
export const MUSCLE_K_LEG = 0.22;
/** Cubital fossa cutter radius (× radius.upperArmDistal) and its depth into the elbow front. */
export const FOSSA_R = 0.55;
export const FOSSA_DEPTH = 0.2;
/** Popliteal hollow cutter radius (× radius.knee) and its depth into the back of the knee. */
export const POPLITEAL_R = 0.5;
export const POPLITEAL_DEPTH = 0.2;

/** One arm: deltoid, upper arm, biceps (+ tendon), triceps, epicondyles, olecranon, forearm, brachioradialis, flexors, palm, finger mass, thumb. */
export function armNode(P: BodyProportions, side: 1 | -1, abduction: number, opts: LimbOpts = {}): { node: SdfNode; anchors: ArmAnchors } {
  if (opts.preWave || REFERENCE_FORMS) return armForms(P, side, abduction, null);
  return armForms(P, side, abduction, armGains(P));
}

/**
 * The belly gains that keep each arm segment's MASS at its pre-wave value (mass neutral by
 * construction): the upper-arm bellies (biceps, triceps) and the forearm masses (flexor,
 * brachioradialis) are scaled in depth until the volume owned by the shoulder bone and by the elbow
 * bone — measured as the physics does (boneVolumes) — equals the pre-wave arm's (secant, ≤ 4 steps,
 * residual stated in ArmGains.residual). Cached per body (spec + cell): the abduction solve calls
 * armNode dozens of times.
 */
export interface ArmGains { upper: number; fore: number; residual: [number, number] }
/** Bounds of a solved belly gain (a belly never vanishes, never doubles). */
export const GAIN_RANGE: [number, number] = [0.5, 1.8];
/**
 * The forearm keeps its pre-wave solid volume × this. Not added mass by intent: the ragdoll's segment
 * mass is the CAPSULE fit of that solid, and the fit covers an offset belly (the flexor) less tightly
 * than the old round elbow ball — at 1.00 the default Warrior's forearm fell to 1.93 % of the body,
 * under RagdollModel.WELD_MASS_FRACTION (2 %), so the elbow welded. The bias restores the fitted share.
 */
export const FOREARM_MASS_BIAS = 1.06;
const ARM_GAIN_CACHE = new Map<string, ArmGains>();
export function armGains(P: BodyProportions): ArmGains {
  const key = `${JSON.stringify(P.spec)}|${P.cell}|${P.build}`;
  const hit = ARM_GAIN_CACHE.get(key);
  if (hit) return hit;
  const sb = boneIndex("shoulderL"), eb = boneIndex("elbowL");
  const pre = boneVolumes(armForms(P, 1, 0, null).node, P.cell / 2, [sb, eb]);
  const target = [pre[0], pre[1] * FOREARM_MASS_BIAS];
  const solve = (which: 0 | 1, other: number): [number, number] => {
    const vol = (g: number) => boneVolumes(armForms(P, 1, 0, which === 0 ? { upper: g, fore: other } : { upper: other, fore: g }).node, P.cell / 2, [sb, eb])[which];
    let g0 = 1, v0 = vol(g0), g1 = 1.15, v1 = vol(g1);
    for (let i = 0; i < 4 && Math.abs(v1 - target[which]) > 0.002 * target[which]; i++) {
      const g2 = Math.max(GAIN_RANGE[0], Math.min(GAIN_RANGE[1], g1 + (target[which] - v1) * (g1 - g0) / ((v1 - v0) || 1e-12)));
      g0 = g1; v0 = v1; g1 = g2; v1 = vol(g1);
    }
    return [g1, v1 / target[which] - 1];
  };
  const [fore] = solve(1, 1);
  const [upper, ru] = solve(0, fore);
  const rf = boneVolumes(armForms(P, 1, 0, { upper, fore }).node, P.cell / 2, [sb, eb])[1] / target[1] - 1;
  const out: ArmGains = { upper, fore, residual: [ru, rf] };
  ARM_GAIN_CACHE.set(key, out);
  if (ARM_GAIN_CACHE.size > 64) ARM_GAIN_CACHE.delete(ARM_GAIN_CACHE.keys().next().value!);
  return out;
}

/**
 * Volume (m³) owned by each listed bone index, voxelised at `step` (voxel centres), measured the way
 * the PHYSICS measures a body: the hard union of the node's POSITIVE primitives (cutters dropped, no
 * smooth blend), each voxel owned by its deepest primitive — Hitboxes.fitPlan's rule, whose capsule
 * volumes are the ragdoll's segment masses (and its 2 % weld floor).
 */
export function boneVolumes(node: SdfNode, step: number, bones: number[]): number[] {
  const solid = op("union", 0, ...positiveNodes(node));
  const F = compileSdf(solid), b = nodeBounds(solid), s: SdfSample = { d: 0, region: 0, bone: 0 };
  const out = bones.map(() => 0), v = step * step * step;
  for (let z = b.min[2] + step / 2; z < b.max[2]; z += step) {
    for (let y = b.min[1] + step / 2; y < b.max[1]; y += step) {
      for (let x = b.min[0] + step / 2; x < b.max[0]; x += step) {
        if (F.sample(x, y, z, s).d > 0) continue;
        const i = bones.indexOf(s.bone);
        if (i >= 0) out[i] += v;
      }
    }
  }
  return out;
}

/** The primitives that ADD matter (the left operand of a subtract/intersect keeps, cutters do not). */
export function positiveNodes(node: SdfNode, out: SdfNode[] = []): SdfNode[] {
  if (node.type === "primitive") { out.push(node); return out; }
  const keepAll = node.op === "union" || node.op === "smoothUnion";
  node.children.forEach((c, i) => { if (keepAll || i === 0) positiveNodes(c, out); });
  return out;
}

/** The arm's volumes; `gains` null = the exact pre-wave arm. */
function armForms(P: BodyProportions, side: 1 | -1, abduction: number, gains: { upper: number; fore: number } | null): { node: SdfNode; anchors: ArmAnchors } {
  const opts = { preWave: gains === null };
  const h = P.head, R = P.radius, m = P.muscle, L = side > 0 ? "L" : "R", c = P.cell;
  const shoulder: Vec3 = [side * P.halfWidth.shoulderJoint, P.y.shoulder, -0.05 * h];
  const F = limbFrame(shoulder, abduction, side);
  const { d, o, f } = F;
  const rot: Vec3 = [0, 0, F.roll];
  const elbow = along(shoulder, d, P.upperArm);
  const wrist = along(elbow, d, P.foreArm);
  const fingertip = along(wrist, d, P.hand);
  const sb = `shoulder${L}` as BoneId, eb = `elbow${L}` as BoneId;
  // Lane S-B: the deltoid mass was DROPPED, not faked. The shoulder delivers its "some muscles in the
  // shoulders" through the TRAPEZIUS redistribution (see TRAP_TIP_X_FRAC) instead: the deltoid sits
  // exactly on the skin-weight shoulder seam, and EVERY direction of growth (lateral, along the arm, in
  // depth, or a bigger P.radius.deltoid) moved the ork half-guard trunk-skin travel from 54 mm to
  // 56-61 mm against a 56.2 mm bound (or split the slim elf mesh into 3 components) — measured, so the
  // deltoid geometry stays pre-wave.
  const deltoid = prim(`deltoid${L}`, "ellipsoid", sb, "upperArm", sum(shoulder, mul(o, 0.08 * h), mul(d, 0.25 * h)), { size: [R.deltoid, 0.5 * h, R.deltoid * 1.05], rot });
  const hand = handNode(P, side, wrist, F, gains === null);
  const palm = hand.palm;
  const grip = along(wrist, d, 0.45 * P.hand);
  const anchors: ArmAnchors = { shoulder, elbow, wrist, palm, grip, fingertip, frame: F };
  if (opts.preWave) {
    const upper = prim(`upperArm${L}`, "roundCone", sb, "upperArm", shoulder, { b: elbow, r: R.upperArm, r2: R.upperArmDistal });
    const biceps = prim(`biceps${L}`, "ellipsoid", sb, "upperArm", sum(shoulder, mul(d, 0.5 * P.upperArm), mul(f, 0.45 * R.upperArm)), { size: [0.62 * R.upperArm * m, 0.4 * P.upperArm, 0.58 * R.upperArm * m], rot });
    const triceps = prim(`triceps${L}`, "ellipsoid", sb, "upperArm", sum(shoulder, mul(d, 0.4 * P.upperArm), mul(f, -0.42 * R.upperArm)), { size: [0.6 * R.upperArm * m, 0.42 * P.upperArm, 0.55 * R.upperArm * m], rot });
    const upperGroup = op("smoothUnion", 0.35 * R.upperArm, upper, deltoid, biceps, triceps);
    const elbowBall = prim(`elbow${L}`, "sphere", eb, "foreArm", elbow, { r: R.upperArmDistal * 0.95 });
    const fore = prim(`foreArm${L}`, "roundCone", eb, "foreArm", elbow, { b: wrist, r: R.foreArm, r2: R.wrist });
    const brachio = prim(`brachioradialis${L}`, "ellipsoid", eb, "foreArm", sum(elbow, mul(d, 0.25 * P.foreArm), mul(o, 0.15 * R.foreArm), mul(f, 0.15 * R.foreArm)), { size: [0.7 * R.foreArm * m, 0.3 * P.foreArm, 0.7 * R.foreArm * m], rot });
    const foreGroup = op("smoothUnion", 0.35 * R.foreArm, elbowBall, fore, brachio);
    const arm = op("smoothUnion", blendWidth(R.upperArmDistal, R.foreArm), upperGroup, foreGroup);
    return { node: op("smoothUnion", blendWidth(R.wrist, hand.halfT), arm, hand.node), anchors };
  }
  const I = improvisationFor(P.spec.seed);
  const kv = (id: string) => knob(I, id);
  const Ru = R.upperArm, Rd = R.upperArmDistal, Rf = R.foreArm;
  const kArm = MUSCLE_K_ARM * kv("arm.muscles.blend");
  // Upper arm: the core narrows into the elbow; the bellies keep their pre-wave volume (reshape only).
  const upper = prim(`upperArm${L}`, "roundCone", sb, "upperArm", shoulder, { b: elbow, r: Ru, r2: UPPER_ARM_DISTAL_CORE * Rd });
  const gU = gains!.upper, gF = gains!.fore;
  const bicepsSize = reshapeDepth([0.62 * Ru * m, 0.4 * P.upperArm, 0.58 * gU * Ru * m], 0.9 * kv("arm.biceps.shape"));
  const bicepsAt = 0.5 * P.upperArm * kv("arm.biceps.place");
  const biceps = prim(`biceps${L}`, "ellipsoid", sb, "upperArm", sum(shoulder, mul(d, bicepsAt), mul(f, 0.47 * Ru)), { size: bicepsSize, rot });
  // The biceps tendon: from the belly's lower end into the elbow crease (radius >= MIN_PLATE_CELLS cells).
  const tendonTop = sum(shoulder, mul(d, bicepsAt + 0.75 * bicepsSize[1]), mul(f, 0.4 * Ru));
  const tendonEnd = sum(elbow, mul(d, 0.1 * P.foreArm), mul(f, 0.28 * Rd));
  const tendon = prim(`bicepsTendon${L}`, "capsule", sb, "upperArm", tendonTop, { b: tendonEnd, r: Math.max(0.26 * Rd, MIN_PLATE_CELLS * c) });
  const tricepsSize = reshapeDepth([0.6 * Ru * m, 0.42 * P.upperArm, 0.55 * gU * Ru * m], 0.92 * kv("arm.triceps.shape"));
  const triceps = prim(`triceps${L}`, "ellipsoid", sb, "upperArm", sum(shoulder, mul(d, 0.37 * P.upperArm * kv("arm.triceps.place")), mul(f, -0.44 * Ru)), { size: tricepsSize, rot });
  const bellies = op("smoothUnion", kArm * Ru, op("smoothUnion", kArm * kv("arm.biceps.blend") * Ru, upper, biceps), triceps);
  const upperGroup = op("smoothUnion", 0.35 * Ru, bellies, deltoid);
  // Elbow: the ball becomes an epicondyle bar (wide across, shallow front-to-back) and an olecranon point.
  const epicondyles = prim(`elbow${L}`, "ellipsoid", eb, "foreArm", along(elbow, f, -0.08 * Rd), { size: [1.05 * Rd, 0.5 * Rd, 0.7 * Rd], rot });
  const olecranon = prim(`olecranon${L}`, "ellipsoid", eb, "foreArm", sum(elbow, mul(f, -0.42 * Rd), mul(d, 0.04 * P.foreArm)), { size: [0.5 * Rd, 0.55 * Rd, Math.max(0.42 * Rd, MIN_PLATE_CELLS * c)], rot });
  // Forearm: slimmer core; the brachioradialis (lateral-front) and the FLEXOR mass (medial-front) make it
  // widest just below the elbow and taper it to the wrist.
  const fore = prim(`foreArm${L}`, "roundCone", eb, "foreArm", elbow, { b: wrist, r: FOREARM_CORE * Rf, r2: R.wrist });
  const brachio = prim(`brachioradialis${L}`, "ellipsoid", eb, "foreArm", sum(elbow, mul(d, 0.24 * P.foreArm), mul(o, 0.24 * Rf), mul(f, 0.18 * Rf)),
    { size: reshapeGirth([0.7 * Rf * m, 0.3 * P.foreArm, 0.7 * gF * Rf * m], kv("arm.brachioradialis.girth")), rot });
  const flexor = prim(`flexor${L}`, "ellipsoid", eb, "foreArm", sum(elbow, mul(d, 0.27 * P.foreArm * kv("arm.flexor.place")), mul(o, -0.1 * Rf), mul(f, 0.27 * Rf)),
    { size: reshapeDepth([0.62 * Rf * m, 0.3 * P.foreArm, 0.68 * gF * Rf * m], kv("arm.flexor.shape")), rot });
  const foreGroup = op("smoothUnion", kArm * Rf, op("smoothUnion", 0.3 * Rf, epicondyles, olecranon, fore), brachio, flexor);
  const arm = op("smoothUnion", blendWidth(R.upperArmDistal, R.foreArm), upperGroup, foreGroup);
  // The cubital fossa: a cutter in front of the elbow between the biceps tendon and the forearm masses;
  // the tendon is unioned back AFTER the cut so it crosses the hollow as a cord.
  const fossaR = Math.max(FOSSA_R * Rd, 0.8 * c);
  const fossa = prim(`cubitalFossa${L}`, "sphere", eb, "foreArm", sum(elbow, mul(d, 0.06 * P.foreArm), mul(f, (1 - FOSSA_DEPTH * kv("arm.fossa.groove")) * Rd + fossaR)), { r: fossaR });
  const carved = op("smoothSubtract", 0.5 * fossaR, arm, fossa);
  const withTendon = op("smoothUnion", 0.5 * kArm * Rd, carved, tendon);
  return { node: op("smoothUnion", blendWidth(R.wrist, hand.halfT), withTendon, hand.node), anchors };
}

/** Hand pronation (rad) about the forearm axis: the back of the hand turns forward-out, as in a relaxed stance. */
export const HAND_PRONATION = 0.6;
/** Relaxed finger curl toward the palm (rad). */
export const FINGER_CURL = 0.3;
/** Thumb splay from the hand axis (rad), start of the solve. */
export const THUMB_SPLAY = 0.45;
/** Gap (cells) the thumb tip keeps from the finger mass: the thumb web reads as a notch. */
export const THUMB_NOTCH_CELLS = 1.4;
/** Palm half-width floor as a multiple of the wrist radius (a palm is ~1.5 wrists wide). */
export const PALM_PER_WRIST = 1.35;
/** Smallest thumb-tip radius (cells): the tip stays one piece with the hand in the grid. */
export const THUMB_TIP_MIN_CELLS = 0.7;
/** Smallest palm half-width (cells): two cells across keeps the palm a plate, not a stick. */
export const PALM_MIN_HALF_CELLS = 1.5;

/** The hand of one arm: palm plate, curled finger mass, knuckle ridge and a splayed thumb. */
export interface HandParts { node: SdfNode; palm: Vec3; thumbTip: Vec3; halfT: number; halfW: number; splay: number; notch: number }

/**
 * One hand in the hand frame (d down the hand, n the back-of-hand normal, w toward the thumb),
 * pronated HAND_PRONATION about d; sizes from the forearm (R08): half-width
 * max(canon, PALM_PER_WRIST·wrist, PALM_MIN_HALF_CELLS·cell), half-thickness
 * max(canon, MIN_PLATE_CELLS·cell), thumb radius max(0.32·half-width, 0.7·cell), length ½ hand. The thumb's
 * splay is SOLVED: it opens from THUMB_SPLAY until the thumb tip clears the finger mass by
 * THUMB_NOTCH_CELLS cells, so the thumb survives the grid as its own digit on both hands.
 */
export function handNode(P: BodyProportions, side: 1 | -1, wrist: Vec3, F: LimbFrame, preWave = false): HandParts {
  const R = P.radius, c = P.cell, L = side > 0 ? "L" : "R", eb = `elbow${L}` as BoneId;
  const d = F.d, cp = Math.cos(HAND_PRONATION), sp = Math.sin(HAND_PRONATION);
  const n = unit(sum(mul(F.o, cp), mul(F.f, sp)));      // back of the hand: out and forward
  const w = unit(sum(mul(F.f, cp), mul(F.o, -sp)));     // across the palm, toward the thumb
  const basis = (dd: Vec3, nn: Vec3): Vec3 => {          // local x = σ·n, y = −d, z = x × y
    const X = mul(nn, side), Y = mul(dd, -1);
    return eulerXYZFromBasis(X, Y, cross(X, Y));
  };
  const halfT = Math.max(R.palmHalfThickness, MIN_PLATE_CELLS * c);
  const halfW = Math.max(R.palmHalfWidth, PALM_PER_WRIST * R.wrist, PALM_MIN_HALF_CELLS * c);
  const palmLen = 0.5 * P.hand, fingerLen = 0.5 * P.hand;
  const palm = along(wrist, d, 0.5 * palmLen);
  const palmBox = prim(`palm${L}`, "roundBox", eb, "hand", palm, { size: [halfT, 0.5 * palmLen, halfW], r: 0.8 * halfT, rot: basis(d, n) });
  // Fingers: curled toward the palm side (−n) about w.
  const cc = Math.cos(FINGER_CURL), sc = Math.sin(FINGER_CURL);
  const dCurl = unit(sum(mul(d, cc), mul(n, -sc))), nCurl = unit(sum(mul(n, cc), mul(d, sc)));
  const knuckle = along(wrist, d, palmLen);
  const fingerCentre = along(knuckle, dCurl, 0.45 * fingerLen);
  const fingerT = Math.max(0.8 * halfT, MIN_PLATE_CELLS * c);
  const fingerParams = { size: [fingerT, 0.5 * fingerLen, 0.92 * halfW] as Vec3, r: 0.85 * fingerT, rot: basis(dCurl, nCurl) };
  const fingers = prim(`fingers${L}`, "roundBox", eb, "hand", fingerCentre, fingerParams);
  const knuckles = prim(`knuckles${L}`, "capsule", eb, "hand", sum(knuckle, mul(w, -0.75 * halfW), mul(n, 0.35 * halfT)), {
    b: sum(knuckle, mul(w, 0.75 * halfW), mul(n, 0.35 * halfT)), r: Math.max(0.75 * halfT, MIN_PLATE_CELLS * c),
  });
  // Thumb: from the palm's thumb edge near the wrist, down and out of the palm plane.
  const thumbR = Math.max(0.32 * halfW, 0.7 * c);
  const base = sum(wrist, mul(d, 0.22 * P.hand), mul(w, 0.7 * halfW), mul(n, -0.3 * halfT));
  const thumbLen = 0.5 * P.hand;
  const fingerPrim = (fingers as { primitive: Primitive }).primitive;
  let splay = THUMB_SPLAY, tip: Vec3 = base, notch = 0;
  for (let i = 0; i < 24; i++, splay += 0.04) {
    const dir = unit(sum(mul(d, Math.cos(splay)), mul(w, Math.sin(splay)), mul(n, -0.25)));
    tip = along(base, dir, thumbLen);
    notch = primitiveDistance(fingerPrim, tip) - 0.8 * thumbR;
    if (notch >= THUMB_NOTCH_CELLS * c) break;
  }
  // The tip keeps >= THUMB_TIP_MIN_CELLS cells of radius: a 0.56-cell tip broke off the grid as its own
  // 8-vertex component on the slim elf hand once the cell moved by 0.1 mm (wave V, measured).
  const thumb = prim(`thumb${L}`, "roundCone", eb, "hand", base, { b: tip, r: thumbR, r2: preWave ? 0.8 * thumbR : Math.max(0.8 * thumbR, THUMB_TIP_MIN_CELLS * c) });
  const node = op("smoothUnion", 0.45 * halfT, palmBox, knuckles, fingers, thumb);
  return { node, palm, thumbTip: tip, halfT, halfW, splay, notch };
}

/** Where a leg's joints and foot landmarks sit (model space). */
export interface LegAnchors { hip: Vec3; knee: Vec3; ankle: Vec3; ball: Vec3; toeTip: Vec3; heelBack: Vec3; frame: LimbFrame }

/** Vertical radius of the sole pads, cells (floored at 0.35 × the ankle height): the sole edge's wall. */
export const SOLE_PAD_HALF_HEIGHT_CELLS = 0.9;
/** Medial-arch lift as a fraction of the ankle-joint height (≈ 2 cm on a 7 cm ankle). */
export const ARCH_LIFT = 0.3;

/** One leg: thigh, quadriceps, vastus medialis, hamstrings, condyles, patella, popliteal hollow, shin, calf heads, ankle, heel, instep, forefoot, toes. */
export function legNode(P: BodyProportions, side: 1 | -1, abduction: number, opts: LimbOpts = {}): { node: SdfNode; anchors: LegAnchors } {
  if (opts.preWave || REFERENCE_FORMS) return legForms(P, side, abduction, null);
  return legForms(P, side, abduction, legGains(P));
}

/** Leg belly gains (thigh bellies, calf heads) that keep the hip- and knee-bone volumes pre-wave (see ArmGains). */
export interface LegGains { thigh: number; calf: number; residual: [number, number] }
const LEG_GAIN_CACHE = new Map<string, LegGains>();
export function legGains(P: BodyProportions): LegGains {
  const key = `${JSON.stringify(P.spec)}|${P.cell}|${P.build}`;
  const hit = LEG_GAIN_CACHE.get(key);
  if (hit) return hit;
  const hb = boneIndex("hipL"), kb = boneIndex("kneeL");
  const step = P.cell / 2;
  const target = boneVolumes(legForms(P, 1, 0, null).node, step, [hb, kb]);
  const solve = (which: 0 | 1, other: number): [number, number] => {
    const vol = (g: number) => boneVolumes(legForms(P, 1, 0, which === 0 ? { thigh: g, calf: other } : { thigh: other, calf: g }).node, step, [hb, kb])[which];
    let g0 = 1, v0 = vol(g0), g1 = 1.12, v1 = vol(g1);
    for (let i = 0; i < 4 && Math.abs(v1 - target[which]) > 0.002 * target[which]; i++) {
      const g2 = Math.max(GAIN_RANGE[0], Math.min(GAIN_RANGE[1], g1 + (target[which] - v1) * (g1 - g0) / ((v1 - v0) || 1e-12)));
      g0 = g1; v0 = v1; g1 = g2; v1 = vol(g1);
    }
    return [g1, v1 / target[which] - 1];
  };
  const [calf] = solve(1, 1);
  const [thigh, rt] = solve(0, calf);
  const rc = boneVolumes(legForms(P, 1, 0, { thigh, calf }).node, step, [hb, kb])[1] / target[1] - 1;
  const out: LegGains = { thigh, calf, residual: [rt, rc] };
  LEG_GAIN_CACHE.set(key, out);
  if (LEG_GAIN_CACHE.size > 64) LEG_GAIN_CACHE.delete(LEG_GAIN_CACHE.keys().next().value!);
  return out;
}

function legForms(P: BodyProportions, side: 1 | -1, abduction: number, gains: { thigh: number; calf: number } | null): { node: SdfNode; anchors: LegAnchors } {
  const R = P.radius, m = P.muscle, c = P.cell, L = side > 0 ? "L" : "R";
  const hip: Vec3 = [side * P.halfWidth.hipJoint, P.y.hipJoint, 0];
  const F = limbFrame(hip, abduction, side);
  const { d, f, o } = F;
  const rot: Vec3 = [0, 0, F.roll];
  // The ankle sits on the abducted line at its own height; the knee splits hip→ankle thigh:shin.
  const drop = P.y.hipJoint - P.y.ankle;
  const ankle: Vec3 = [hip[0] + side * drop * Math.tan(abduction), P.y.ankle, 0];
  const legLen = Math.hypot(ankle[0] - hip[0], drop);
  const knee = along(hip, d, legLen * P.thigh / (P.thigh + P.shin));
  const hb = `hip${L}` as BoneId, kb = `knee${L}` as BoneId, ab = `ankle${L}` as BoneId, tb = `toe${L}` as BoneId;
  const rT = R.thighTop;
  const thighLen = legLen * P.thigh / (P.thigh + P.shin);
  const shinLen = legLen - thighLen;
  const patellaSize: [number, number, number] = [0.45 * R.knee, 0.55 * R.knee, Math.max(0.3 * R.knee, 0.6 * c)];
  const patella = prim(`patella${L}`, "ellipsoid", kb, "shin", along(knee, f, 0.75 * R.knee), {
    size: gains === null ? patellaSize : reshapeLong(patellaSize, knob(improvisationFor(P.spec.seed), "leg.patella.shape")),
  });
  let thighGroup: SdfNode, shinGroup: SdfNode, popliteal: SdfNode | null = null;
  if (gains === null) {
    const thigh = prim(`thigh${L}`, "roundCone", hb, "thigh", hip, { b: knee, r: rT, r2: R.thighDistal });
    const quads = prim(`quadriceps${L}`, "ellipsoid", hb, "thigh", sum(hip, mul(d, 0.5 * thighLen), mul(f, 0.3 * rT)), { size: [0.66 * rT * m, 0.36 * thighLen, 0.56 * rT * m], rot });
    const hams = prim(`hamstrings${L}`, "ellipsoid", hb, "thigh", sum(hip, mul(d, 0.5 * thighLen), mul(f, -0.3 * rT)), { size: [0.6 * rT * m, 0.32 * thighLen, 0.5 * rT * m], rot });
    thighGroup = op("smoothUnion", 0.3 * rT, thigh, quads, hams);
    const kneeBall = prim(`knee${L}`, "sphere", kb, "shin", knee, { r: R.knee });
    const shin = prim(`shin${L}`, "roundCone", kb, "shin", knee, { b: ankle, r: R.knee * 0.95, r2: R.ankle });
    const calf = prim(`calf${L}`, "ellipsoid", kb, "shin", sum(knee, mul(d, 0.3 * shinLen), mul(f, -0.45 * R.calf)), { size: [0.85 * R.calf * m, 0.32 * shinLen, 0.75 * R.calf * m], rot });
    shinGroup = op("smoothUnion", 0.3 * R.knee, kneeBall, patella, shin, calf);
  } else {
    const I = improvisationFor(P.spec.seed);
    const kv = (id: string) => knob(I, id);
    const gT = gains.thigh, gS = gains.calf, Rc = R.calf, Rk = R.knee;
    const kLeg = MUSCLE_K_LEG * kv("leg.muscles.blend");
    const thigh = prim(`thigh${L}`, "roundCone", hb, "thigh", hip, { b: knee, r: rT, r2: R.thighDistal });
    // The thigh's MEDIAL extent is the leg-gap solve's input (Anatomy.solveLegs probes the midplane
    // between the thighs): every thigh change keeps the pre-wave local-x (medial-lateral) semi-axes and
    // centres, and moves volume only front-to-back (z) and along the bone (y) — measured: the solved leg
    // abduction is bit-identical (tests/wave_v_body_forms_test.ts).
    const quads = prim(`quadriceps${L}`, "ellipsoid", hb, "thigh", sum(hip, mul(d, 0.5 * thighLen), mul(f, 0.3 * rT)),
      { size: [0.66 * rT * m, 0.36 * thighLen, 0.56 * gT * rT * m], rot });
    // The vastus medialis teardrop: above the knee, front-medial; its medial reach stays inside the
    // knee's own medial surface, so the leg-gap solve (Anatomy.solveLegs) reads the same field.
    const vmo = prim(`vastusMedialis${L}`, "ellipsoid", hb, "thigh", sum(knee, mul(d, -0.2 * thighLen), mul(f, 0.42 * rT), mul(o, -0.06 * rT)),
      { size: reshapeDepth([0.34 * rT * m, 0.17 * thighLen, 0.32 * rT * m], kv("leg.vastusMedialis.shape")), rot });
    const hams = prim(`hamstrings${L}`, "ellipsoid", hb, "thigh", sum(hip, mul(d, 0.5 * thighLen), mul(f, -0.3 * rT)),
      { size: [0.6 * rT * m, 0.32 * thighLen, 0.5 * gT * rT * m], rot });
    // The thigh keeps its pre-wave blend width (its top is where the leg-gap solve binds); the teardrop
    // joins it at the sharper muscle width.
    thighGroup = op("smoothUnion", kLeg * rT, op("smoothUnion", 0.3 * rT, thigh, quads, hams), vmo);
    // Knee: the ball becomes the femoral condyles — the same frontal outline (the leg-gap solve reads it),
    // flatter front-to-back, so the patella and the popliteal hollow read in profile.
    const condyles = prim(`knee${L}`, "ellipsoid", kb, "shin", along(knee, f, -0.04 * Rk), { size: [Rk, Rk, 0.84 * Rk * kv("leg.condyles.depth")], rot });
    const shin = prim(`shin${L}`, "roundCone", kb, "shin", knee, { b: ankle, r: Rk * 0.95, r2: R.ankle });
    // Gastrocnemius: the medial head lower and bigger, the lateral head higher; a valley between them.
    const calfMed = prim(`calf${L}`, "ellipsoid", kb, "shin", sum(knee, mul(d, 0.35 * shinLen * kv("leg.calfMedial.place")), mul(f, -0.42 * Rc), mul(o, -0.24 * Rc)),
      { size: reshapeLong([0.6 * gS * Rc * m, 0.3 * shinLen, 0.7 * gS * Rc * m], kv("leg.calfMedial.shape")), rot });
    const calfLat = prim(`calfLateral${L}`, "ellipsoid", kb, "shin", sum(knee, mul(d, 0.27 * shinLen * kv("leg.calfLateral.place")), mul(f, -0.4 * Rc), mul(o, 0.26 * Rc)),
      { size: reshapeGirth([0.52 * gS * Rc * m, 0.25 * shinLen, 0.62 * gS * Rc * m], kv("leg.calfLateral.girth")), rot });
    const core = op("smoothUnion", 0.3 * Rk, condyles, patella, shin);
    const shinSolid = op("smoothUnion", kLeg * Rk, core, calfMed, calfLat);
    // The popliteal hollow: a cutter behind the knee between the hamstring tendons.
    const popR = Math.max(POPLITEAL_R * Rk * kv("leg.poplitealWidth.groove"), 0.8 * c);
    popliteal = prim(`popliteal${L}`, "sphere", kb, "shin", sum(knee, mul(d, -0.06 * thighLen), mul(f, -((1 - POPLITEAL_DEPTH * kv("leg.popliteal.groove")) * Rk + popR))), { r: popR });
    shinGroup = shinSolid;
  }

  // Foot along +z: heel back a quarter foot behind the ankle, ball at 72 % of the length.
  // Heel, forefoot and toes sink SOLE_CONTACT of their height below y = 0 (cut flat later).
  const heelR = R.heel, ballR = Math.max(0.6 * R.footHalfWidth, 1.1 * c), toeR = Math.max(0.75 * ballR, 0.9 * c);
  const below = (r: number) => r * (1 - SOLE_CONTACT); // centre height of a sole volume
  const heelBackZ = ankle[2] - 0.25 * P.foot;
  const ballZ = heelBackZ + 0.72 * P.foot, toeTipZ = heelBackZ + P.foot;
  const ax = ankle[0];
  const fw = R.footHalfWidth;
  const malleoli = prim(`malleoli${L}`, "ellipsoid", ab, "foot", ankle, { size: [R.ankle * 1.15, R.ankle * 0.9, R.ankle] });
  const heel = prim(`heel${L}`, "ellipsoid", ab, "foot", [ax, below(heelR), heelBackZ + 1.1 * heelR], { size: [heelR * 0.9, heelR, heelR * 1.1] });
  const instep = prim(`instep${L}`, "roundCone", ab, "foot", ankle, { b: [ax, ballR * 1.1, ballZ], r: R.ankle * 0.9, r2: ballR * 0.9 });
  const arch = prim(`arch${L}`, "roundCone", ab, "foot", [ax, heelR, heelBackZ + 1.1 * heelR], { b: [ax, ballR, ballZ], r: 0.85 * heelR, r2: ballR * 0.9 });
  const forefoot = prim(`forefoot${L}`, "ellipsoid", ab, "foot", [ax, below(ballR), ballZ], { size: [fw, ballR, ballR * 1.2] });
  // Toes taper: the big toe (medial, −σ) reaches farthest, the lesser toes step back and down.
  const toes = prim(`toes${L}`, "ellipsoid", tb, "foot", [ax + side * 0.12 * fw, below(toeR), ballZ + 0.12 * P.foot], { size: [fw * 0.8, 0.9 * toeR, 0.15 * P.foot] });
  const bigToe = prim(`bigToe${L}`, "ellipsoid", tb, "foot", [ax - side * 0.45 * fw, below(toeR), ballZ + 0.16 * P.foot], { size: [Math.max(0.42 * fw, MIN_PLATE_CELLS * c), toeR, 0.13 * P.foot] });
  // Sole pads: ellipsoids centred ON the ground, so the half-space cut leaves a vertical wall
  // padH tall all round the sole — a crisp sole edge from the side instead of a rounded blob.
  // Heel pad, ball pad and the lateral band between them carry the weight (the lateral arch is
  // low); region "sole" so the paint's sole layer draws that edge.
  const padH = Math.max(SOLE_PAD_HALF_HEIGHT_CELLS * c, 0.35 * P.ankleHeight);
  const heelPad = prim(`heelPad${L}`, "ellipsoid", ab, "sole", [ax, 0, heelBackZ + heelR], { size: [0.85 * heelR, padH, heelR] });
  const ballPad = prim(`ballPad${L}`, "ellipsoid", ab, "sole", [ax, 0, ballZ], { size: [0.98 * fw, padH, 0.2 * P.foot] });
  const lateralBand = prim(`lateralSole${L}`, "ellipsoid", ab, "sole", [ax + side * 0.45 * fw, 0, (heelBackZ + heelR + ballZ) / 2], {
    size: [0.5 * fw, 0.8 * padH, 0.5 * (ballZ - heelBackZ - heelR) + 0.3 * heelR],
  });
  const toePad = prim(`toePad${L}`, "ellipsoid", tb, "sole", [ax - side * 0.1 * fw, 0, ballZ + 0.14 * P.foot], { size: [0.85 * fw, 0.7 * padH, 0.13 * P.foot] });
  const solid = op("smoothUnion", 0.5 * heelR, malleoli, heel, instep, arch, forefoot, toes, bigToe, heelPad, ballPad, lateralBand, toePad);
  // Medial longitudinal arch: the inner sole lifts between heel and ball (smooth subtract).
  const archLift = Math.max(ARCH_LIFT * P.ankleHeight, MIN_PLATE_CELLS * c);
  const archZ = (heelBackZ + heelR + ballZ) / 2;
  const archCut = prim(`archHollow${L}`, "ellipsoid", ab, "foot", [ax - side * 0.95 * fw, 0, archZ], { size: [0.7 * fw, archLift, 0.26 * P.foot] });
  const footGroup = op("smoothSubtract", 0.4 * archLift, solid, archCut);
  const joined = op("smoothUnion", blendWidth(R.thighDistal, R.knee), thighGroup, shinGroup);
  const leg = popliteal ? op("smoothSubtract", 0.5 * Math.max(POPLITEAL_R * R.knee, 0.8 * c), joined, popliteal) : joined;
  const node = op("smoothUnion", blendWidth(R.ankle, heelR), leg, footGroup);
  return {
    node,
    anchors: { hip, knee, ankle, ball: [ax, ballR, ballZ], toeTip: [ax, toeR, toeTipZ], heelBack: [ax, 0, heelBackZ], frame: F },
  };
}
