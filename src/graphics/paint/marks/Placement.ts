// Placement: region frames, footprints and the placement solver for marks (wave TEX, lane M).
//
// Pure module: no THREE, no DOM, no Math.random.
//
// REGION FRAME. Every (region, side) of the skin gets a cylinder frame: `origin`, unit `axis`
// (v+ = up for the trunk, neck, head and face; toward the body = PROXIMAL for limbs), unit `front`
// (u = 0) and unit `lateral` (u > 0: away from the midline on paired regions, the character's
// LEFT, +x, on midline regions). A mark's anchor is (u, v) in [-1, 1]^2:
//   u = the angle around the axis / pi   (0 front, +-1 back; WRAPS)
//   v = the distance along the axis / halfLength
// and its millimetre coordinates on the unrolled cylinder are
//   x = u * pi * radius   (arc length; period 2 pi radius)       y = v * halfLength.
// A mark's `angle` rotates its own (s, t) axes in that (x, y) plane: 0 = circumferential /
// transverse, pi/2 = longitudinal. Because a point of the skin maps to (x, y) by its bind-pose
// position, a mark wraps around a limb and rides the skin as it deforms.
//
// Paired regions mirror: the right side's lateral is -x, so (u, v) names the SAME anatomical spot
// on both sides and mirroring a mark is a side swap. Midline regions mirror by u -> -u.

import { REGIONS, type MeshData, type Region, type Vec3 } from "../../body/contracts.ts";
import { PAIRED_REGIONS } from "../Patterns.ts";
import { FACE_FRAME_MM, FACE_ORIFICES_MM, type Scar, scarExtentMm } from "./Scar.ts";
import { type Tattoo, tattooExtentMm } from "./Tattoo.ts";

/** A cylinder frame of one (region, side). */
export interface RegionFrame {
  region: Region;
  side: 0 | 1;
  origin: Vec3;
  axis: Vec3;
  front: Vec3;
  lateral: Vec3;
  radiusM: number;
  halfLengthM: number;
}

/** Every frame of one body. */
export interface RegionFrames {
  /** Torso centroid x: the left/right split (Patterns.sideOf). */
  coreX: number;
  /** Body height (m); scales face features. */
  heightM: number;
  frames: Partial<Record<string, RegionFrame>>;
  /** True when measured from a mesh (false = the nominal table). */
  measured: boolean;
  /**
   * Eye and mouth zones in FACE-frame millimetres (marks never cover them). From the body's own face
   * anchors when given (regionFrames(mesh, { face })), else the race's measured table (FACE_FEATURES_UV).
   */
  faceFeatures?: FaceFeature[];
}

/** A face feature zone (ellipse) in face-frame millimetres. */
export interface FaceFeature { name: string; x: number; y: number; rx: number; ry: number }

/** The face anchors a body plan carries (AnatomyParts.FaceAnchors, structurally). */
export interface FaceAnchorsLike { eye: [Vec3, Vec3]; eyeRadius: number; mouth: Vec3 }

/**
 * Measured feature positions per race in face-frame (u, v), and the eye radius as a fraction of the
 * face frame radius: the means of generateBody plan.face over male + female, seeds 7 and 21, in
 * regionFrames(mesh). These heads are stylised: the eyes sit at u ~ 0.18-0.19 (66 mm off the midline
 * on a 1.8 m human), well wider than a real face's +-32 mm.
 */
export const FACE_FEATURES_UV: Readonly<Record<string, { eye: [number, number]; mouth: [number, number]; eyeR: number }>> = {
  human: { eye: [0.182, 0.515], mouth: [0, -0.226], eyeR: 0.159 },
  elf: { eye: [0.182, 0.469], mouth: [0, -0.253], eyeR: 0.164 },
  dwarf: { eye: [0.191, 0.439], mouth: [0, -0.36], eyeR: 0.145 },
  ork: { eye: [0.19, 0.576], mouth: [0, -0.12], eyeR: 0.148 },
};

/** Zone radii from the eye radius: the socket and lids (eye), the lips (mouth). */
export const FACE_ZONE_SCALE = { eyeRx: 1.6, eyeRy: 1.35, mouthRx: 2.2, mouthRy: 1.0 } as const;

function zonesFrom(eyeL: [number, number], eyeR: [number, number], mouth: [number, number], eyeRadiusMm: number): FaceFeature[] {
  const z = FACE_ZONE_SCALE;
  return [
    { name: "eyeL", x: eyeL[0], y: eyeL[1], rx: z.eyeRx * eyeRadiusMm, ry: z.eyeRy * eyeRadiusMm },
    { name: "eyeR", x: eyeR[0], y: eyeR[1], rx: z.eyeRx * eyeRadiusMm, ry: z.eyeRy * eyeRadiusMm },
    { name: "mouth", x: mouth[0], y: mouth[1], rx: z.mouthRx * eyeRadiusMm, ry: z.mouthRy * eyeRadiusMm },
  ];
}

/** Feature zones of a face frame from the race table. */
export function faceZonesForRace(face: RegionFrame, race?: string | null): FaceFeature[] {
  const t = FACE_FEATURES_UV[race ?? ""] ?? FACE_FEATURES_UV.human;
  const r = face.radiusM * 1000;
  const e = uvToMm(face, t.eye[0], t.eye[1]), m = uvToMm(face, t.mouth[0], t.mouth[1]);
  return zonesFrom([e[0], e[1]], [-e[0], e[1]], [m[0], m[1]], t.eyeR * r);
}

/** Feature zones of a face frame from the body's own anchors (bind pose). */
export function faceZonesFromAnchors(face: RegionFrame, a: FaceAnchorsLike): FaceFeature[] {
  const l = pointToFrameMm(face, a.eye[0]), r = pointToFrameMm(face, a.eye[1]), m = pointToFrameMm(face, a.mouth);
  return zonesFrom([l.x, l.y], [r.x, r.y], [m.x, m.y], a.eyeRadius * 1000);
}

/** The zones a placement checks: the frames' own, else the human table on the face frame. */
export function faceZones(frames: RegionFrames): FaceFeature[] {
  if (frames.faceFeatures) return frames.faceFeatures;
  const f = frames.frames[frameKey("face", 0)] ?? nominalFrames(frames.heightM).frames[frameKey("face", 0)];
  return f ? faceZonesForRace(f, "human") : faceFeatureZones(frames.heightM);
}

/** Map key of a frame. Midline regions use side 0 for both sides. */
export function frameKey(region: Region, side: 0 | 1): string {
  return `${region}:${isPaired(region) ? side : 0}`;
}

export function isPaired(region: Region): boolean { return (PAIRED_REGIONS as readonly Region[]).includes(region); }

/** Regions a mark may sit on (hair, nails and soles carry none). */
export const MARK_REGIONS: readonly Region[] = [
  "torso", "pelvis", "neck", "head", "face", "ear", "upperArm", "foreArm", "hand", "thigh", "shin", "foot",
];

/** Regions a tattoo may sit on (ears and the scalp under hair are left to scars). */
export const TATTOO_REGIONS: readonly Region[] = [
  "torso", "pelvis", "neck", "face", "upperArm", "foreArm", "hand", "thigh", "shin", "foot",
];

/**
 * Usable (u, v) box per region: the mark's whole footprint must stay inside (v always; u only
 * where the region does not wrap). Ends of limbs stop short of the joint creases.
 */
export const REGION_BOUNDS: Readonly<Partial<Record<Region, { uMax: number; vMax: number; wrap: boolean }>>> = {
  torso: { uMax: 1, vMax: 0.9, wrap: true },
  pelvis: { uMax: 1, vMax: 0.8, wrap: true },
  neck: { uMax: 1, vMax: 0.75, wrap: true },
  head: { uMax: 1, vMax: 0.85, wrap: true },
  face: { uMax: 0.24, vMax: 0.9, wrap: false },
  ear: { uMax: 1, vMax: 0.8, wrap: true },
  upperArm: { uMax: 1, vMax: 0.9, wrap: true },
  foreArm: { uMax: 1, vMax: 0.9, wrap: true },
  hand: { uMax: 1, vMax: 0.8, wrap: true },
  thigh: { uMax: 1, vMax: 0.9, wrap: true },
  shin: { uMax: 1, vMax: 0.9, wrap: true },
  foot: { uMax: 1, vMax: 0.8, wrap: true },
};

/**
 * Holes in a region's (u, v) box where the cylinder has no skin of that region: the armpits on
 * the torso (the arm takes over there) and the gluteal fold at the back of the thigh (pelvis).
 * Ellipses in (u, v); u is matched by |u| (both sides / both flanks).
 */
export const REGION_HOLES: Readonly<Partial<Record<Region, readonly { u: number; v: number; ru: number; rv: number }[]>>> = {
  torso: [{ u: 0.5, v: 0.8, ru: 0.2, rv: 0.55 }],
  thigh: [{ u: 1, v: 0.8, ru: 0.4, rv: 0.55 }],
  upperArm: [{ u: 0.5, v: 1, ru: 0.25, rv: 0.25 }],
};

/** Is (u, v) inside one of the region's holes? */
export function inRegionHole(region: Region, u: number, v: number): boolean {
  for (const h of REGION_HOLES[region] ?? []) {
    if (((Math.abs(u) - h.u) / h.ru) ** 2 + ((v - h.v) / h.rv) ** 2 <= 1) return true;
  }
  return false;
}

/**
 * Nominal frames at a 1.8 m human (radius, half length in metres; centre and axis direction
 * in the bind pose, measured off a generated human body and rounded). Used when no mesh is at
 * hand (default generation, tests); scaled by height / 1.8.
 */
export const NOMINAL_FRAMES: Readonly<Partial<Record<Region, { r: number; hl: number; c: Vec3; axis: Vec3 }>>> = {
  torso: { r: 0.14, hl: 0.26, c: [0, 1.3, 0], axis: [0, 1, 0] },
  pelvis: { r: 0.14, hl: 0.13, c: [0, 0.95, -0.045], axis: [0, 1, 0] },
  neck: { r: 0.065, hl: 0.08, c: [0, 1.535, -0.007], axis: [0, 1, 0] },
  head: { r: 0.09, hl: 0.1, c: [0, 1.72, -0.036], axis: [0, 1, 0] },
  face: { r: FACE_FRAME_MM.radius / 1000, hl: FACE_FRAME_MM.halfLength / 1000, c: [0, 1.64, -0.036], axis: [0, 1, 0] },
  ear: { r: 0.018, hl: 0.03, c: [0.102, 1.665, -0.022], axis: [0, 1, 0] },
  upperArm: { r: 0.05, hl: 0.19, c: [0.244, 1.337, -0.014], axis: [-0.24, 0.97, 0] },
  foreArm: { r: 0.045, hl: 0.16, c: [0.331, 1.022, -0.01], axis: [-0.27, 0.96, 0] },
  hand: { r: 0.04, hl: 0.1, c: [0.402, 0.763, -0.006], axis: [-0.3, 0.95, 0] },
  thigh: { r: 0.085, hl: 0.26, c: [0.117, 0.703, 0.008], axis: [-0.06, 1, 0] },
  shin: { r: 0.055, hl: 0.21, c: [0.141, 0.297, -0.002], axis: [-0.06, 1, 0] },
  foot: { r: 0.045, hl: 0.1, c: [0.158, 0.039, 0.061], axis: [0, 0.3, -0.95] },
};

// ---------------------------------------------------------------------------------------------
// Vector helpers.

function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function scale(a: Vec3, k: number): Vec3 { return [a[0] * k, a[1] * k, a[2] * k]; }
function addv(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function norm(a: Vec3, fallback: Vec3 = [0, 1, 0]): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : fallback;
}

/** Complete a frame from origin + axis: front = +z (or +y) made perpendicular, lateral by side. */
function completeFrame(region: Region, side: 0 | 1, origin: Vec3, axis: Vec3, radiusM: number, halfLengthM: number): RegionFrame {
  const A = norm(axis);
  let F = sub([0, 0, 1], scale(A, A[2]));
  if (Math.hypot(F[0], F[1], F[2]) < 0.3) F = sub([0, 1, 0], scale(A, A[1]));
  F = norm(F, [0, 0, 1]);
  let Lt = cross(A, F);                       // a unit vector perpendicular to both
  const wantX = !isPaired(region) || side === 0 ? 1 : -1;
  if (Lt[0] * wantX < 0) Lt = scale(Lt, -1);
  return { region, side, origin, axis: A, front: F, lateral: norm(Lt), radiusM, halfLengthM };
}

/** The segment a limb region hangs from: its axis points toward it (v+ = proximal). */
export const PROXIMAL_PARENT: Readonly<Partial<Record<Region, Region>>> = {
  upperArm: "torso", foreArm: "upperArm", hand: "foreArm", thigh: "pelvis", shin: "thigh", foot: "shin", ear: "head",
};

/** The segment hanging from a limb region (the chain's next link). */
export const DISTAL_CHILD: Readonly<Partial<Record<Region, Region>>> = {
  upperArm: "foreArm", foreArm: "hand", thigh: "shin", shin: "foot",
};

/** The nominal frames scaled to a body height (both sides of paired regions). */
export function nominalFrames(heightM = 1.8, race?: string | null): RegionFrames {
  const k = (Number.isFinite(heightM) && heightM > 0 ? heightM : 1.8) / 1.8;
  const frames: Partial<Record<string, RegionFrame>> = {};
  for (const region of MARK_REGIONS) {
    const n = NOMINAL_FRAMES[region];
    if (!n) continue;
    for (const side of [0, 1] as const) {
      if (side === 1 && !isPaired(region)) continue;
      const sx = side === 1 ? -1 : 1;
      const c: Vec3 = [n.c[0] * sx * k, n.c[1] * k, n.c[2] * k];
      const axis: Vec3 = [n.axis[0] * sx, n.axis[1], n.axis[2]];
      frames[frameKey(region, side)] = completeFrame(region, side, c, axis, n.r * k, n.hl * k);
    }
  }
  const face = frames[frameKey("face", 0)];
  return { coreX: 0, heightM: heightM > 0 ? heightM : 1.8, frames, measured: false, faceFeatures: face ? faceZonesForRace(face, race) : undefined };
}

/**
 * Measure the frames of a mesh: per (region, side) the centroid, the principal axis (power
 * iteration on the covariance; vertical for trunk/head/face/neck), the mean radial distance as
 * radius and the 95th-percentile axial reach as half length. Face: its axis passes through the
 * head's centroid (the face is a patch of the head cylinder). Limbs: axis oriented proximal.
 */
export function regionFrames(mesh: MeshData, opts: { face?: FaceAnchorsLike | null; race?: string | null } = {}): RegionFrames {
  const P = mesh.positions, n = P.length / 3;
  let tx = 0, tz = 0, tn = 0, minY = Infinity, maxY = -Infinity;
  const torso = REGIONS.indexOf("torso");
  for (let i = 0; i < n; i++) {
    const y = P[i * 3 + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (mesh.region[i] === torso) { tx += P[i * 3]; tz += P[i * 3 + 2]; tn++; }
  }
  const coreX = tn > 0 ? tx / tn : 0;
  const heightM = n > 0 ? maxY - minY : 1.8;
  const groups = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const region = REGIONS[mesh.region[i]];
    if (!region) continue;
    const side: 0 | 1 = isPaired(region) ? (P[i * 3] >= coreX ? 0 : 1) : 0;
    const key = frameKey(region, side);
    let g = groups.get(key);
    if (!g) groups.set(key, g = []);
    g.push(i);
  }
  const centroid = (idx: number[]): Vec3 => {
    let x = 0, y = 0, z = 0;
    for (const i of idx) { x += P[i * 3]; y += P[i * 3 + 1]; z += P[i * 3 + 2]; }
    return idx.length ? [x / idx.length, y / idx.length, z / idx.length] : [coreX, 0, 0];
  };
  const head = groups.get(frameKey("head", 0)) ?? [];
  const headC = centroid(head);
  const core: Vec3 = [coreX, 0, tn > 0 ? tz / tn : 0];
  const frames: Partial<Record<string, RegionFrame>> = {};
  for (const region of MARK_REGIONS) {
    for (const side of [0, 1] as const) {
      if (side === 1 && !isPaired(region)) continue;
      const idx = groups.get(frameKey(region, side));
      if (!idx || idx.length < 4) continue;
      const c = centroid(idx);
      let origin: Vec3 = c, axis: Vec3 = [0, 1, 0];
      const vertical = region === "torso" || region === "pelvis" || region === "neck" || region === "head" || region === "face";
      if (region === "face" && head.length) origin = [headC[0], c[1], headC[2]];
      if (!vertical) {
        // Principal axis by power iteration on the covariance.
        let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0;
        for (const i of idx) {
          const dx = P[i * 3] - c[0], dy = P[i * 3 + 1] - c[1], dz = P[i * 3 + 2] - c[2];
          cxx += dx * dx; cxy += dx * dy; cxz += dx * dz; cyy += dy * dy; cyz += dy * dz; czz += dz * dz;
        }
        let v: Vec3 = [0.1, 1, 0.05];
        for (let k = 0; k < 32; k++) {
          v = norm([cxx * v[0] + cxy * v[1] + cxz * v[2], cxy * v[0] + cyy * v[1] + cyz * v[2], cxz * v[0] + cyz * v[1] + czz * v[2]]);
        }
        // The limb chain gives a robust direction (a thick, short segment can fool the covariance):
        // from the distal neighbour's centroid to this one, or from this one to the proximal
        // neighbour's for an end segment (hand). The principal axis is kept when it agrees.
        const parent = PROXIMAL_PARENT[region], child = DISTAL_CHILD[region];
        const pIdx = parent ? groups.get(frameKey(parent, side)) : undefined;
        const cIdx = child ? groups.get(frameKey(child, side)) : undefined;
        let chain: Vec3 | null = null;
        if (cIdx && cIdx.length >= 4) chain = norm(sub(c, centroid(cIdx)));
        else if (pIdx && pIdx.length >= 4) chain = norm(sub(centroid(pIdx), c));
        if (region === "foot" || region === "ear" || !chain) {
          const target: Vec3 = pIdx && pIdx.length ? centroid(pIdx) : [core[0], minY + 0.72 * heightM, core[2]];
          const ref: Vec3 = region === "foot" ? [0, 0, -1] : sub(target, c);
          axis = dot(v, ref) < 0 ? scale(v, -1) : v;
        } else {
          const vv = dot(v, chain) < 0 ? scale(v, -1) : v;
          axis = dot(vv, chain) > 0.85 ? vv : chain;
        }
      }
      const A = norm(axis);
      const rad: number[] = [], ax: number[] = [];
      for (const i of idx) {
        const d = sub([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], origin);
        const y = dot(d, A);
        ax.push(Math.abs(y));
        rad.push(Math.hypot(...sub(d, scale(A, y))));
      }
      ax.sort((a, b) => a - b);
      const radius = rad.reduce((s, r) => s + r, 0) / rad.length;
      const hl = ax[Math.min(ax.length - 1, Math.floor(ax.length * 0.95))];
      frames[frameKey(region, side)] = completeFrame(region, side, origin, A, Math.max(0.005, radius), Math.max(0.005, hl));
    }
  }
  const face = frames[frameKey("face", 0)];
  const faceFeatures = face ? (opts.face ? faceZonesFromAnchors(face, opts.face) : faceZonesForRace(face, opts.race)) : undefined;
  return { coreX, heightM, frames, measured: true, faceFeatures };
}

/** The frame of a mark (falls back to the nominal frame of its region). */
export function frameOf(frames: RegionFrames, region: Region, side: 0 | 1 = 0): RegionFrame | null {
  return frames.frames[frameKey(region, side)] ?? nominalFrames(frames.heightM).frames[frameKey(region, side)] ?? null;
}

/** (u, v) -> frame millimetres. */
export function uvToMm(frame: RegionFrame, u: number, v: number): [number, number] {
  return [u * Math.PI * frame.radiusM * 1000, v * frame.halfLengthM * 1000];
}

/** Frame millimetres -> (u, v) (u wrapped into [-1, 1]). */
export function mmToUv(frame: RegionFrame, x: number, y: number): [number, number] {
  return [wrapU(x / (Math.PI * frame.radiusM * 1000)), y / (frame.halfLengthM * 1000)];
}

/** Wrap u into [-1, 1). */
export function wrapU(u: number): number {
  if (!Number.isFinite(u)) return 0;
  if (u >= -1 && u < 1) return u;
  return ((((u + 1) % 2) + 2) % 2) - 1;
}

/** A bind-pose point -> frame millimetres (x arc length, y axial) and its radial distance (m). */
export function pointToFrameMm(frame: RegionFrame, p: Vec3): { x: number; y: number; radial: number } {
  const d = sub(p, frame.origin), y = dot(d, frame.axis);
  const r = sub(d, scale(frame.axis, y));
  const phi = Math.atan2(dot(r, frame.lateral), dot(r, frame.front));
  return { x: phi * frame.radiusM * 1000, y: y * 1000, radial: Math.hypot(r[0], r[1], r[2]) };
}

/** Frame (x, y) mm -> a point on the frame's cylinder at `radialM`, and the two tangents there. */
export function frameMmToPoint(frame: RegionFrame, x: number, y: number, radialM = frame.radiusM): { p: Vec3; out: Vec3; tx: Vec3; ty: Vec3 } {
  const phi = x / (frame.radiusM * 1000);
  const out = norm(addv(scale(frame.front, Math.cos(phi)), scale(frame.lateral, Math.sin(phi))));
  const p = addv(addv(frame.origin, scale(frame.axis, y / 1000)), scale(out, radialM));
  const tx = norm(addv(scale(frame.front, -Math.sin(phi)), scale(frame.lateral, Math.cos(phi))));
  return { p, out, tx, ty: frame.axis };
}

/** Which side of the body a bind-pose x is on (0 left = x >= coreX). */
export function sideAt(frames: RegionFrames, x: number): 0 | 1 { return x >= frames.coreX ? 0 : 1; }

/** For the creator's raycast: a bind-pose skin point of a region -> the mark anchor. */
export function anchorAt(frames: RegionFrames, region: Region | number, point: Vec3): { region: Region; side: 0 | 1; anchor: [number, number] } | null {
  const r = typeof region === "number" ? REGIONS[region] : region;
  if (!r) return null;
  const side: 0 | 1 = isPaired(r) ? sideAt(frames, point[0]) : 0;
  const f = frameOf(frames, r, side);
  if (!f) return null;
  const q = pointToFrameMm(f, point);
  const [u, v] = mmToUv(f, q.x, q.y);
  return { region: r, side, anchor: [u, Math.max(-1, Math.min(1, v))] };
}

// ---------------------------------------------------------------------------------------------
// Footprints.

/** Oriented box in frame millimetres: centre, half extents along (s, t), angle of s. */
export interface Footprint { cx: number; cy: number; ex: number; ey: number; angle: number; circumferenceMm: number; wrap: boolean }

/** A mark ready for placement. */
export interface PlacementItem {
  id: string;
  type: "scar" | "tattoo";
  region: Region;
  side: 0 | 1;
  anchor: [number, number];
  /** Resolved angle (rad). */
  angle: number;
  /** Half extents of the design (mm) along s and t. */
  extentMm: [number, number];
  /** Facial tattoo style (allowed on the face). Scars may always be on the face. */
  facial: boolean;
  /** Fixed: the solver reports problems but never moves it (user-placed marks). */
  fixed: boolean;
}

/** Half extents of a scar (keloid spread applied by the caller) or a tattoo. */
export function markExtentMm(type: "scar" | "tattoo", mark: Scar | Tattoo, frame: RegionFrame | null, spread = 1): [number, number] {
  if (type === "scar") return scarExtentMm(mark as Scar, spread);
  const circ = frame ? 2 * Math.PI * frame.radiusM * 1000 : Infinity;
  return tattooExtentMm(mark as Tattoo, circ);
}

export function footprintOf(item: PlacementItem, frame: RegionFrame): Footprint {
  const [cx, cy] = uvToMm(frame, item.anchor[0], item.anchor[1]);
  const b = REGION_BOUNDS[item.region];
  return {
    cx, cy, ex: item.extentMm[0], ey: item.extentMm[1], angle: item.angle,
    circumferenceMm: 2 * Math.PI * frame.radiusM * 1000, wrap: b?.wrap ?? true,
  };
}

/** Sample points of a footprint (k x k grid over the box), frame mm. */
export function footprintPoints(f: Footprint, k = 7): [number, number][] {
  const c = Math.cos(f.angle), s = Math.sin(f.angle), out: [number, number][] = [];
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const a = (i / (k - 1) * 2 - 1) * f.ex, b = (j / (k - 1) * 2 - 1) * f.ey;
      out.push([f.cx + c * a - s * b, f.cy + s * a + c * b]);
    }
  }
  return out;
}

/** Is a frame point inside a footprint (x wraps on wrapping regions)? */
export function insideFootprint(f: Footprint, x: number, y: number): boolean {
  let dx = x - f.cx;
  if (f.wrap && Number.isFinite(f.circumferenceMm) && f.circumferenceMm > 0) {
    dx = ((dx % f.circumferenceMm) + f.circumferenceMm * 1.5) % f.circumferenceMm - f.circumferenceMm / 2;
  }
  const dy = y - f.cy, c = Math.cos(f.angle), s = Math.sin(f.angle);
  const eps = 1e-6;
  return Math.abs(c * dx + s * dy) <= f.ex + eps && Math.abs(-s * dx + c * dy) <= f.ey + eps;
}

/** Fraction (0..1) of the SMALLER footprint covered by the other (9 x 9 sample grid). */
export function overlapFraction(a: Footprint, b: Footprint): number {
  const [small, big] = a.ex * a.ey <= b.ex * b.ey ? [a, b] : [b, a];
  const pts = footprintPoints(small, 9);
  let hit = 0;
  for (const [x, y] of pts) if (insideFootprint(big, x, y)) hit++;
  return hit / pts.length;
}

/**
 * Legacy zones from Scar.FACE_ORIFICES_MM (real-human proportions, scaled by height). Kept for callers
 * of the first round; placement now uses faceZones(frames) (the stylised heads' measured features).
 */
export function faceFeatureZones(heightM: number): { name: string; x: number; y: number; rx: number; ry: number }[] {
  const k = heightM / 1.8;
  return FACE_ORIFICES_MM.filter((o) => o.name !== "nose").map((o) => ({
    name: o.name, x: o.x * k, y: o.y * k, rx: (o.name === "mouth" ? 26 : 17) * k, ry: (o.name === "mouth" ? 12 : 11) * k,
  }));
}

/** Why a placement fails (empty = fine). */
export type PlacementIssue = "regionNotAllowed" | "outOfRegion" | "faceNotAllowed" | "faceFeature" | "overlap";

/** Problems of one item against its region (not against other marks). */
export function regionIssues(item: PlacementItem, frame: RegionFrame | null, heightM: number, zones?: readonly FaceFeature[]): PlacementIssue[] {
  const out: PlacementIssue[] = [];
  const allowed = item.type === "tattoo" ? TATTOO_REGIONS : MARK_REGIONS;
  if (!allowed.includes(item.region) || !frame) return ["regionNotAllowed"];
  if (item.type === "tattoo" && item.region === "face" && !item.facial) out.push("faceNotAllowed");
  const f = footprintOf(item, frame), b = REGION_BOUNDS[item.region]!;
  const yMax = b.vMax * frame.halfLengthM * 1000, xMax = b.uMax * Math.PI * frame.radiusM * 1000;
  const pts = footprintPoints(f, 5);
  let outside = false;
  for (const [x, y] of pts) {
    if (Math.abs(y) > yMax + 1e-6) outside = true;
    if (!b.wrap && Math.abs(x) > xMax + 1e-6) outside = true;
    const [u, v] = mmToUv(frame, x, y);
    if (inRegionHole(item.region, u, v)) outside = true;
  }
  // A design wider than the limb's circumference cannot wrap without overlapping itself (bands
  // are exactly one circumference).
  if (f.ex * 2 > f.circumferenceMm + 1e-6 && f.wrap) outside = true;
  if (outside) out.push("outOfRegion");
  if (item.region === "face") {
    const zs = zones ?? faceFeatureZones(heightM);
    const fine = footprintPoints(f, 9);
    const hit = fine.some(([x, y]) => zs.some((z) => ((x - z.x) / z.rx) ** 2 + ((y - z.y) / z.ry) ** 2 <= 1));
    if (hit) out.push("faceFeature");
  }
  return out;
}

/** Placement options. */
export interface PlacementOptions {
  /** Largest allowed overlap fraction between two marks (default 0.1). */
  overlapMax?: number;
  /** Candidate positions tried per movable mark (default 40). */
  tries?: number;
}

export interface PlacementResult {
  /** Items with their final anchors (only the accepted ones, in input order). */
  placed: PlacementItem[];
  /** Ids moved by the solver. */
  moved: string[];
  /** Refused items and why. */
  rejected: { id: string; issues: PlacementIssue[] }[];
  /** Per item (input order) the issues of its FINAL position (empty = ok). */
  report: { id: string; ok: boolean; issues: PlacementIssue[] }[];
}

function issuesAgainst(item: PlacementItem, frame: RegionFrame | null, heightM: number, accepted: PlacementItem[], frames: RegionFrames, overlapMax: number): PlacementIssue[] {
  const issues = regionIssues(item, frame, heightM, faceZones(frames));
  if (frame && !issues.includes("regionNotAllowed")) {
    const f = footprintOf(item, frame);
    for (const o of accepted) {
      if (o.region !== item.region || o.side !== item.side) continue;
      const of = frameOf(frames, o.region, o.side);
      if (of && overlapFraction(f, footprintOf(o, of)) > overlapMax) { issues.push("overlap"); break; }
    }
  }
  return issues;
}

/**
 * Greedy deterministic solver. Items are taken in order (put user marks first). A fixed item is
 * accepted when its region allows it at all (its other issues are only reported); a movable item
 * that fails is moved along a golden-angle spiral of candidate anchors (step 6 % of the region
 * per ring) and accepted at the first clean candidate, else rejected.
 */
export function solvePlacement(items: readonly PlacementItem[], frames: RegionFrames, opts: PlacementOptions = {}): PlacementResult {
  const overlapMax = opts.overlapMax ?? 0.1, tries = opts.tries ?? 40;
  const placed: PlacementItem[] = [], moved: string[] = [], rejected: PlacementResult["rejected"] = [];
  const report: PlacementResult["report"] = [];
  for (const item0 of items) {
    const frame = frameOf(frames, item0.region, item0.side);
    let item = { ...item0, anchor: [item0.anchor[0], item0.anchor[1]] as [number, number] };
    let issues = issuesAgainst(item, frame, frames.heightM, placed, frames, overlapMax);
    if (issues.length && !item.fixed && frame && !issues.includes("regionNotAllowed") && !issues.includes("faceNotAllowed")) {
      const b = REGION_BOUNDS[item.region]!;
      for (let k = 1; k <= tries; k++) {
        const r = 0.06 * Math.sqrt(k) * 2, a = k * 2.399963229728653;
        const v = Math.max(-b.vMax, Math.min(b.vMax, item0.anchor[1] + r * Math.sin(a)));
        let u = item0.anchor[0] + r * Math.cos(a) * (b.wrap ? 1 : b.uMax);
        u = b.wrap ? wrapU(u) : Math.max(-b.uMax, Math.min(b.uMax, u));
        const cand = { ...item, anchor: [u, v] as [number, number] };
        const ci = issuesAgainst(cand, frame, frames.heightM, placed, frames, overlapMax);
        if (!ci.length) { item = cand; issues = ci; moved.push(item.id); break; }
      }
    }
    const hard = issues.includes("regionNotAllowed") || issues.includes("faceNotAllowed");
    if (!issues.length || (item.fixed && !hard)) placed.push(item);
    else rejected.push({ id: item.id, issues });
    report.push({ id: item.id, ok: issues.length === 0, issues });
  }
  return { placed, moved, rejected, report };
}

/** Footprint centre of an item in 3D on the frame cylinder (debug / tests). */
export function itemCentre(item: PlacementItem, frames: RegionFrames): Vec3 | null {
  const f = frameOf(frames, item.region, item.side);
  if (!f) return null;
  const [x, y] = uvToMm(f, item.anchor[0], item.anchor[1]);
  return frameMmToPoint(f, x, y).p;
}
