// Hands with fingers (wave W, lane H). Pure module: no THREE, no DOM.
//
// Why a separate hand: the body skin is ONE Surface-Nets mesh on a 2.2-3.5 cm grid, so a hand on it can
// only be a mitten (a 2 cm finger is under one cell). The rendered hand is therefore its own small mesh:
// a lofted PALM plus five lofted DIGITS (four fingers of three phalanges, a thumb of metacarpal +
// two phalanges), posed on the CPU every time the grip changes. It is RENDER-ONLY: the physics body,
// the hitboxes and the ragdoll still read the anatomy plan (whose mitten is unchanged), so no mass moves
// and no joint moves (CHANNEL MSG-12/14/20 physics rules).
//
// Frame ("hand-local"): origin at the wrist (AnatomyParts ArmAnchors.wrist), X = d (down the hand, to
// the fingertips), Y = n (the back of the hand), Z = X × Y. The thumb sits on +Z·thumb where
// thumb = sign(w · Z) (w = across the palm toward the thumb, RigAdapter.handFrameBind).
//
// Two poses:
//   relaxedPose — the free hand: a light cascade curl (little finger most), the thumb resting beside
//                 the index;
//   gripPose    — the weapon hand: a small in-plane wrist deviation toward the handle (≤ DEVIATION_MAX),
//                 the palm tilted back just enough that its palmar face clears the handle cylinder, then
//                 every phalanx flexes until it TOUCHES the handle (greedy "flex until contact": each
//                 segment rotates about its joint from the previous segment's direction until its
//                 capsule meets the handle capsule), the thumb wraps the other way, over the index and
//                 middle fingers. The gaps that remain are measured (contactReport), never assumed.
// The mesh topology is the same in both poses (rings × sides fixed), so posing only rewrites
// positions and normals.

import type { Vec3 } from "./contracts.ts";

// ---------------------------------------------------------------------------------------------
// small vector kit (allocating; the hand has a few hundred vertices, posed only on grip changes)
// ---------------------------------------------------------------------------------------------
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Rodrigues: rotate v about the unit axis k by θ. */
export function rotate(v: Vec3, k: Vec3, th: number): Vec3 {
  const c = Math.cos(th), s = Math.sin(th), kv = cross(k, v), kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}
/** Closest distance between segments p0-p1 and q0-q1. */
export function segSegDistance(p0: Vec3, p1: Vec3, q0: Vec3, q1: Vec3): number {
  const d1 = sub(p1, p0), d2 = sub(q1, q0), r = sub(p0, q0);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s: number, t: number;
  if (a <= 1e-14 && e <= 1e-14) return len(r);
  if (a <= 1e-14) { s = 0; t = Math.max(0, Math.min(1, f / e)); } else {
    const c = dot(d1, r);
    if (e <= 1e-14) { t = 0; s = Math.max(0, Math.min(1, -c / a)); } else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-14 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); } else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  return len(sub(add(p0, mul(d1, s)), add(q0, mul(d2, t))));
}

// ---------------------------------------------------------------------------------------------
// sizes
// ---------------------------------------------------------------------------------------------
/** Finger order: index, middle, ring, little (index nearest the thumb). */
export const FINGERS = ["index", "middle", "ring", "little"] as const;
export type DigitName = typeof FINGERS[number] | "thumb";
export const DIGITS: readonly DigitName[] = [...FINGERS, "thumb"];
/** Finger length as a share of the finger span (½ hand), index→little. */
export const FINGER_LENGTH = [0.92, 1.0, 0.95, 0.76] as const;
/** Phalanx split (proximal, middle, distal) of a finger. */
export const PHALANX_SPLIT = [0.45, 0.31, 0.24] as const;
/** Thumb segments (metacarpal, proximal, distal) as shares of the hand length. */
export const THUMB_SPLIT = [0.27, 0.17, 0.15] as const;
/**
 * Largest in-plane wrist deviation the rendered hand takes toward a diagonal handle (rad): a wrist
 * bends ~35° toward the little finger (ulnar) and ~20° toward the thumb (radial).
 */
export const ULNAR_MAX = 0.65;
export const RADIAL_MAX = 0.35;
/** Largest wrist extension (palm tilt toward the back of the hand) the grip may take (rad). */
export const PALM_TILT_MAX = 0.8;
/** How far (m) the handle may press into the palm's soft heel before the wrist extends further. */
export const PALM_PRESS = 0.004;
/** Flexion ranges (rad) of the finger joints MCP, PIP, DIP and of the thumb's three joints. */
export const FINGER_RANGE: readonly [number, number][] = [[-0.6, 1.75], [-0.25, 1.95], [-0.25, 1.35]];
export const THUMB_RANGE: readonly [number, number][] = [[-0.3, 1.8], [0, 1.1], [0, 1.3]];
/** Widest rendered palm half-width (m): 1.15 × the weapons' HAND_HALF_WIDTH (game/weapons/Form.ts, 0.045). */
export const GRIP_FIT_WIDTH = 1.15 * 0.045;
/** Thickest rendered palm as a share of its half-width (a palm is about half as thick as it is wide). */
export const PALM_ASPECT = 0.55;
/** Rendered palm half-thickness as a share of the anatomy's (which is floored to the body grid). */
export const PALM_THICKNESS_SHARE = 0.85;
/** Sides of a digit / the palm cross-section (the triangle budget lives here). */
export const DIGIT_SIDES = 6;
export const PALM_SIDES = 8;

export interface HandInput {
  /** Hand length wrist→fingertip (m), BodyProportions.hand. */
  hand: number;
  /** Palm half-width / half-thickness (BodyProportions.radius.palmHalfWidth / palmHalfThickness). */
  palmHalfWidth: number;
  palmHalfThickness: number;
  /** Wrist radius (BodyProportions.radius.wrist). */
  wrist: number;
  /** +1 when the thumb is on +Z of the hand-local frame, −1 on −Z. */
  thumb: 1 | -1;
  /** The rendered body's wrist rim (hand-local): where the cut skin ends. Optional (defaults to a round wrist). */
  rim?: WristRim;
}
/** The cut body skin's opening at the wrist, in hand-local coordinates. */
export interface WristRim { xMin: number; xMax: number; cy: number; cz: number; ay: [number, number]; az: number }

export interface HandSize {
  H: number; halfW: number; halfT: number; wristR: number; thumb: 1 | -1;
  /** Palm length wrist → knuckle line. */
  palmLen: number;
  /** Finger radius at the knuckle, index→little. */
  fingerR: number[];
  /** Phalanx lengths per finger. */
  phalanx: [number, number, number][];
  /** Knuckle positions in the PALM frame (x along the palm, y dorsal, z across). */
  knuckle: Vec3[];
  thumbR: number;
  thumbLen: [number, number, number];
  /** The thumb's root (CMC) in the palm frame. */
  thumbRoot: Vec3;
  rim: WristRim;
}

export function handSize(inp: HandInput): HandSize {
  const H = inp.hand;
  // The weapons' grips are built for a HAND_HALF_WIDTH-wide hand: a wider rendered fist would run its
  // index finger into the guard (the wave-V ork mitten clipped the longsword's cross-guard). The
  // rendered palm is the anatomy's, capped at max(1.2 wrist, GRIP_FIT_WIDTH).
  const halfW = Math.max(1.2 * inp.wrist, Math.min(inp.palmHalfWidth, Math.max(1.2 * inp.wrist, GRIP_FIT_WIDTH)));
  // The anatomy's palm thickness was floored to grid cells for the mitten; the rendered palm is slimmer.
  const halfT = Math.max(Math.min(PALM_THICKNESS_SHARE * inp.palmHalfThickness, PALM_ASPECT * halfW), 0.42 * inp.wrist);
  const palmLen = 0.5 * H;
  const spacing = (2 * 0.92 * halfW) / 4;
  const base = 0.5 * spacing;
  const fingerR = [1.0, 1.02, 0.97, 0.86].map((k) => k * base);
  const phalanx = FINGER_LENGTH.map((k) => PHALANX_SPLIT.map((s) => s * k * 0.5 * H) as [number, number, number]);
  const t = inp.thumb;
  const knuckle: Vec3[] = [0, 1, 2, 3].map((i) => {
    const z = t * 0.9 * halfW * (0.75 - 0.5 * i);
    const x = palmLen - [0.03, 0.0, 0.03, 0.11][i] * H;
    return [x, 0.18 * halfT, z];
  });
  const thumbR = 1.12 * fingerR[0];
  const thumbLen = THUMB_SPLIT.map((s) => s * H) as [number, number, number];
  const thumbRoot: Vec3 = [0.12 * H, -0.3 * halfT, t * 0.45 * halfW];
  const rim = inp.rim ?? { xMin: -0.02 * H, xMax: 0, cy: 0, cz: 0, ay: [inp.wrist, inp.wrist], az: inp.wrist };
  return { H, halfW, halfT, wristR: inp.wrist, thumb: t, palmLen, fingerR, phalanx, knuckle, thumbR, thumbLen, thumbRoot, rim };
}

// ---------------------------------------------------------------------------------------------
// poses
// ---------------------------------------------------------------------------------------------
/** A handle in hand-local coordinates: a point on its axis, its direction, its radius. */
export interface HandleLine { p: Vec3; u: Vec3; r: number }

/** One posed digit: joint positions root→tip (4 points), segment radii at each joint, and the ring frames. */
export interface DigitPose { name: DigitName; joints: Vec3[]; dirs: Vec3[]; radii: number[]; angles: number[]; side: Vec3 }
export interface HandPose {
  kind: "relaxed" | "grip";
  /** Palm frame: origin = wrist, axes in hand-local. */
  palmX: Vec3; palmY: Vec3; palmZ: Vec3;
  tilt: number; deviation: number;
  /** Wrist → knuckle-line length of this pose (the grip lengthens the palm to put the crease on the handle). */
  palmLen: number;
  digits: DigitPose[];
}

function palmFrame(tilt: number, dev: number): { X: Vec3; Y: Vec3; Z: Vec3 } {
  // Deviation in the hand plane (about Y), then extension (about the deviated Z).
  const X0 = rotate([1, 0, 0], [0, 1, 0], dev), Z0 = rotate([0, 0, 1], [0, 1, 0], dev);
  const X = rotate(X0, Z0, tilt), Y = rotate([0, 1, 0], Z0, tilt);
  return { X, Y, Z: Z0 };
}
const inPalm = (F: { X: Vec3; Y: Vec3; Z: Vec3 }, p: Vec3): Vec3 => add(add(mul(F.X, p[0]), mul(F.Y, p[1])), mul(F.Z, p[2]));

/** Tapering radii of a digit along its joints (root, j1, j2, tip). */
function fingerRadii(r: number): number[] { return [r, 0.93 * r, 0.86 * r, 0.8 * r]; }
function thumbRadii(r: number): number[] { return [1.45 * r, 1.08 * r, 0.98 * r, 0.86 * r]; }

/** A chain posed by planar flexion angles about one axis (each angle relative to the previous segment). */
function chainFrom(root: Vec3, base: Vec3, axis: Vec3, lengths: readonly number[], angles: number[]): { joints: Vec3[]; dirs: Vec3[] } {
  const joints: Vec3[] = [root], dirs: Vec3[] = [];
  let dir = base, at = root, acc = 0;
  for (let j = 0; j < lengths.length; j++) {
    acc += angles[j];
    dir = unit(rotate(base, axis, acc));
    at = add(at, mul(dir, lengths[j]));
    dirs.push(dir);
    joints.push(at);
  }
  return { joints, dirs };
}

/** Capsule obstacle for the wrap solver. */
export interface Capsule { a: Vec3; b: Vec3; r: number }

/**
 * Greedy wrap: joint by joint, sweep the flexion from range.min upward and stop at the first angle
 * whose segment capsule penetrates an obstacle (bisected to 1e-3 rad); keep the last clear angle.
 * A segment that never meets an obstacle takes `free[j]` (a natural fist closure) — its gap is
 * measured later, not hidden.
 */
export function wrapChain(root: Vec3, base: Vec3, axis: Vec3, lengths: readonly number[], radii: readonly number[], ranges: readonly [number, number][], obstacles: readonly Capsule[], free: readonly number[]): number[] {
  const angles: number[] = [];
  let acc = 0, at = root;
  for (let j = 0; j < lengths.length; j++) {
    const segR = 0.5 * (radii[j] + radii[j + 1]);
    const pen = (th: number): number => {
      const dir = unit(rotate(base, axis, acc + th));
      const end = add(at, mul(dir, lengths[j]));
      // The first 15 % of a segment sits in its joint (shared with the previous segment): skip it.
      const start = add(at, mul(dir, 0.15 * lengths[j]));
      let m = Infinity;
      for (const o of obstacles) m = Math.min(m, segSegDistance(start, end, o.a, o.b) - (segR + o.r));
      return m;
    };
    const [lo, hi] = ranges[j];
    let chosen = Math.min(hi, Math.max(lo, free[j]));
    if (obstacles.length) {
      if (pen(lo) < 0) chosen = lo;
      else {
        let last = lo, hit: number | null = null;
        for (let th = lo + 0.03; th <= hi + 1e-9; th += 0.03) { if (pen(th) < 0) { hit = th; break; } last = th; }
        if (hit !== null) {
          let a = last, b = hit;
          for (let k = 0; k < 12; k++) { const m = 0.5 * (a + b); if (pen(m) < 0) b = m; else a = m; }
          chosen = a;
        } else chosen = Math.max(chosen, Math.min(hi, free[j]));
      }
    }
    angles.push(chosen);
    acc += chosen;
    at = add(at, mul(unit(rotate(base, axis, acc)), lengths[j]));
  }
  return angles;
}

/** Knuckle i in the palm frame for a palm of length Lp. */
function knuckleAt(S: HandSize, i: number, Lp: number): Vec3 { return [S.knuckle[i][0] + (Lp - S.palmLen), S.knuckle[i][1], S.knuckle[i][2]]; }

/** The free hand: a light cascade curl, thumb beside the index. */
export function relaxedPose(S: HandSize): HandPose {
  const F = palmFrame(0, 0);
  const digits: DigitPose[] = [];
  const curl = [[0.18, 0.28, 0.14], [0.24, 0.34, 0.18], [0.3, 0.4, 0.2], [0.36, 0.48, 0.24]];
  const axis = mul(F.Z, -1);
  for (let i = 0; i < 4; i++) {
    const root = inPalm(F, knuckleAt(S, i, S.palmLen));
    const c = chainFrom(root, F.X, axis, S.phalanx[i], curl[i]);
    digits.push({ name: FINGERS[i], ...c, radii: fingerRadii(S.fingerR[i]), angles: curl[i], side: F.Z });
  }
  const t = S.thumb;
  const tb = unit(add(add(mul(F.X, 0.62), mul(F.Z, t * 0.62)), mul(F.Y, -0.45)));
  const toward = unit(add(mul(F.X, 1), mul(F.Y, -0.35)));
  const tAxis = unit(cross(tb, toward));
  const ta = [0.05, 0.18, 0.25];
  const c = chainFrom(inPalm(F, S.thumbRoot), tb, tAxis, S.thumbLen, ta);
  digits.push({ name: "thumb", ...c, radii: thumbRadii(S.thumbR), angles: ta, side: tAxis });
  return { kind: "relaxed", palmX: F.X, palmY: F.Y, palmZ: F.Z, tilt: 0, deviation: 0, palmLen: S.palmLen, digits };
}

/** Palmar half-thickness along the palm (thick heel, thinner at the distal crease). */
export function palmarExtent(S: HandSize, x: number, Lp = S.palmLen): number {
  const t = Math.max(0, Math.min(1, x / Lp));
  return S.halfT * (1.0 - 0.42 * t);
}

/**
 * Signed clearance (m) of the handle from the palm SLAB: for sample columns across the palm, the
 * handle axis must lie on the palmar side, at least r below the palmar face. Negative = the handle
 * runs inside the palm by that much (the depth is measured, the worst column wins).
 */
export function palmClearance(S: HandSize, h: HandleLine, tilt: number, dev: number, Lp = S.palmLen): number {
  const F = palmFrame(tilt, dev);
  let m = Infinity;
  for (let a = 0; a <= 6; a++) {
    for (let b = 0; b <= 4; b++) {
      const x = Lp * (0.25 + 0.75 * a / 6), z = S.halfW * 0.85 * (-1 + b / 2);
      // The handle's point in this column (closest to the column line through (x, ·, z)).
      const col = inPalm(F, [x, 0, z]);
      const rel = sub(col, h.p), t = dot(rel, h.u);
      const q = add(h.p, mul(h.u, t));
      // Its palm-frame height relative to the palmar face: below the face by ≥ r is clear.
      const y = dot(sub(q, col), F.Y);
      const lateral = len(sub(sub(q, col), mul(F.Y, y)));
      if (lateral > 0.6 * S.halfW) continue; // the handle does not pass this column
      m = Math.min(m, -palmarExtent(S, x, Lp) - y - h.r);
    }
  }
  return m === Infinity ? 1 : m;
}

/**
 * The weapon hand closed on `h`. Deviation: the fingers turn in the hand plane toward
 * perpendicular to the handle, ≤ DEVIATION_MAX. Tilt: the smallest wrist extension whose palmar face
 * clears the handle (or the clearest tilt when none does). Then the fingers and the thumb wrap.
 */
export function gripPose(S: HandSize, h0: HandleLine): HandPose {
  // Handle direction with u·Z ≥ 0 (a line has no sign) and in-plane angle ψ from X.
  const u = dot(h0.u, [0, 0, 1]) < 0 ? mul(unit(h0.u), -1) : unit(h0.u);
  const h: HandleLine = { p: h0.p, u, r: h0.r };
  const psi = Math.atan2(u[2], u[0]);
  // Fingers toward perpendicular to the handle in the hand plane: X turns about Y (toward −Z for a
  // positive angle, Y × X = −Z) by π/2 − ψ, clamped.
  // Ulnar (away from the thumb: dev·thumb > 0) reaches ULNAR_MAX, radial (toward it) RADIAL_MAX.
  const want = Math.PI / 2 - psi;
  const dev = want * S.thumb > 0 ? Math.sign(want) * Math.min(Math.abs(want), ULNAR_MAX) : Math.sign(want) * Math.min(Math.abs(want), RADIAL_MAX);
  // In the deviated frame, where does the handle cross the middle finger's plane?
  const Fd = palmFrame(0, dev);
  const toD = (v: Vec3): Vec3 => [dot(v, Fd.X), dot(v, Fd.Y), dot(v, Fd.Z)];
  const G = toD(h.p), ud = toD(u), zMid = S.knuckle[1][2];
  const c = Math.abs(ud[2]) > 0.2 ? add(G, mul(ud, (zMid - G[2]) / ud[2])) : G;
  // Tilt so the distal palm crease (palm frame (x_c, −(palmar + r))) lands on the handle axis.
  const rho = h.r + S.fingerR[1];
  let Lp = S.palmLen, tilt = 0, xc = 0;
  for (let k = 0; k < 3; k++) {
    const need = palmarExtent(S, Lp, Lp) + h.r + 0.0005;
    const D = Math.hypot(c[0], c[1]);
    xc = Math.sqrt(Math.max(D * D - need * need, (0.25 * S.H) ** 2));
    tilt = Math.max(-0.2, Math.min(PALM_TILT_MAX, Math.atan2(c[1], c[0]) + Math.atan2(need, xc)));
    Lp = Math.max(0.42 * S.H, Math.min(0.62 * S.H, xc + 0.3 * rho));
  }
  // A diagonal handle runs deeper toward the heel on one side: extend the wrist further until the
  // whole palm clears it (or the tilt bound) — the residual is measured by contactReport.
  while (tilt < PALM_TILT_MAX && palmClearance(S, h, tilt, dev, Lp) < -PALM_PRESS) tilt = Math.min(PALM_TILT_MAX, tilt + 0.02);
  const F = palmFrame(tilt, dev);
  const handle: Capsule = { a: add(h.p, mul(u, -0.5)), b: add(h.p, mul(u, 0.5)), r: h.r };
  const digits: DigitPose[] = [];
  const axis = mul(F.Z, -1);
  const fist = [1.5, 1.6, 0.9];
  for (let i = 0; i < 4; i++) {
    const root = inPalm(F, knuckleAt(S, i, Lp));
    const radii = fingerRadii(S.fingerR[i]);
    const angles = wrapChain(root, F.X, axis, S.phalanx[i], radii, FINGER_RANGE, [handle], fist);
    const c = chainFrom(root, F.X, axis, S.phalanx[i], angles);
    digits.push({ name: FINGERS[i], ...c, radii, angles, side: F.Z });
  }
  // Thumb: circles the handle the other way (about ±u, opposite to the fingers' −Z), from the thenar
  // down the proximal side and under the handle, over the index/middle fingers.
  const root = inPalm(F, S.thumbRoot);
  const fingerSense = dot(axis, u) >= 0 ? 1 : -1;
  const tAxis = mul(u, -fingerSense);
  let tb = unit(add(mul(F.X, 0.25), mul(F.Y, -1)));
  tb = unit(sub(tb, mul(u, dot(tb, u))));
  const obstacles: Capsule[] = [handle];
  for (const d of digits.slice(0, 2)) for (let j = 0; j < 3; j++) obstacles.push({ a: d.joints[j], b: d.joints[j + 1], r: d.radii[j + 1] });
  const tRadii = thumbRadii(S.thumbR);
  const tAngles = wrapChain(root, tb, tAxis, S.thumbLen, tRadii, THUMB_RANGE, obstacles, [0.6, 0.7, 0.6]);
  const tc = chainFrom(root, tb, tAxis, S.thumbLen, tAngles);
  digits.push({ name: "thumb", ...tc, radii: tRadii, angles: tAngles, side: tAxis });
  return { kind: "grip", palmX: F.X, palmY: F.Y, palmZ: F.Z, tilt, deviation: dev, palmLen: Lp, digits };
}

// ---------------------------------------------------------------------------------------------
// mesh
// ---------------------------------------------------------------------------------------------
/** Region codes of the hand mesh (indices into contracts.REGIONS are mapped by the caller). */
export const HAND_REGION = 0, NAIL_REGION = 1;

export interface HandMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** 0 = hand skin, 1 = nail plate. */
  kind: Uint8Array;
  /** Which part each vertex belongs to: 0 palm, 1..5 index..thumb. */
  part: Uint8Array;
}

/** Ring layout of the mesh (fixed topology). */
const PALM_RINGS = 4; // A (in the forearm), B (wrist), C (palm), D (knuckles) + apex
const DIGIT_RINGS = 4; // root, joint 1, joint 2, tip ring + apex

export function handVertexCount(): number {
  return (PALM_RINGS * PALM_SIDES + 1) + 5 * (DIGIT_RINGS * DIGIT_SIDES + 1);
}
export function handTriangleCount(): number {
  return (PALM_RINGS - 1) * PALM_SIDES * 2 + PALM_SIDES + 5 * ((DIGIT_RINGS - 1) * DIGIT_SIDES * 2 + DIGIT_SIDES);
}

/** Superellipse-ish ring: offsets of `sides` points (unit-ish), exponent 2.6 → a rounded rectangle. */
function ringShape(sides: number, phase: number): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < sides; k++) {
    const a = phase + (2 * Math.PI * k) / sides;
    const c = Math.cos(a), s = Math.sin(a), e = 2 / 2.6;
    out.push([Math.sign(c) * Math.pow(Math.abs(c), e), Math.sign(s) * Math.pow(Math.abs(s), e)]);
  }
  return out;
}

/** Build the fixed index buffer + per-vertex part/kind tags. */
export function handTopology(): { indices: Uint32Array; part: Uint8Array; kind: Uint8Array } {
  const nv = handVertexCount();
  const part = new Uint8Array(nv), kind = new Uint8Array(nv);
  const idx: number[] = [];
  let base = 0;
  const tube = (rings: number, sides: number, p: number) => {
    for (let r = 0; r + 1 < rings; r++) {
      for (let k = 0; k < sides; k++) {
        const a = base + r * sides + k, b = base + r * sides + (k + 1) % sides;
        const c = base + (r + 1) * sides + k, d = base + (r + 1) * sides + (k + 1) % sides;
        idx.push(a, b, c, b, d, c);
      }
    }
    const apex = base + rings * sides;
    for (let k = 0; k < sides; k++) idx.push(base + (rings - 1) * sides + k, base + (rings - 1) * sides + (k + 1) % sides, apex);
    for (let v = base; v <= apex; v++) part[v] = p;
    base = apex + 1;
  };
  tube(PALM_RINGS, PALM_SIDES, 0);
  for (let d = 0; d < 5; d++) tube(DIGIT_RINGS, DIGIT_SIDES, d + 1);
  return { indices: new Uint32Array(idx), part, kind };
}

/**
 * Write the posed hand into `out` (positions, normals; kind marks the nail vertices). The winding of
 * handTopology is outward when the ring's (e1, e2, tangent) frame is right-handed — ensured here.
 */
export function writeHand(S: HandSize, pose: HandPose, out: HandMesh): void {
  const P = out.positions, N = out.normals;
  let v = 0;
  const put = (p: Vec3, n: Vec3) => { P[v * 3] = p[0]; P[v * 3 + 1] = p[1]; P[v * 3 + 2] = p[2]; const u = unit(n); N[v * 3] = u[0]; N[v * 3 + 1] = u[1]; N[v * 3 + 2] = u[2]; v++; };
  /** A ring: centre c, tangent t, in-plane axes e1 (half-extent a1, may be offset), e2. */
  const ring = (sides: number, c: Vec3, t: Vec3, e1: Vec3, e2: Vec3, a1lo: number, a1hi: number, a2: number, phase: number, nail = false) => {
    // Orthonormalise e1/e2 against t and make (e1, e2, t) right-handed.
    let E1 = unit(sub(e1, mul(t, dot(e1, t))));
    let E2 = unit(cross(t, E1));
    if (dot(E2, e2) < 0) { E1 = mul(E1, -1); E2 = mul(E2, -1); const tmp = a1lo; a1lo = a1hi; a1hi = tmp; }
    const shape = ringShape(sides, phase);
    const start = v;
    for (const [x, y] of shape) {
      const a1 = x >= 0 ? a1hi : a1lo;
      const p = add(c, add(mul(E1, x * a1), mul(E2, y * a2)));
      const n = add(mul(E1, x / Math.max(a1, 1e-6)), mul(E2, y / Math.max(a2, 1e-6)));
      if (nail && x > 0.35) out.kind[v] = NAIL_REGION;
      put(p, n);
    }
    return start;
  };
  const F = { X: pose.palmX, Y: pose.palmY, Z: pose.palmZ };
  const rim = S.rim;
  // Palm rings: A inside the forearm (untilted), B at the wrist (mitred), C mid-palm, D knuckles, E end.
  const xA = rim.xMin - 0.25 * S.wristR;
  const A: Vec3 = [xA, rim.cy, rim.cz];
  const bX = unit(add([1, 0, 0], F.X));
  const B: Vec3 = [Math.max(0, rim.xMax) + 0.02 * S.H, rim.cy * 0.5, rim.cz * 0.5];
  const Lp = pose.palmLen;
  const xC = 0.32 * Lp, xD = 0.92 * Lp, xE = Lp + 0.04 * S.H;
  const C = inPalm(F, [xC, 0.05 * S.halfT, 0]), D = inPalm(F, [xD, 0.1 * S.halfT, 0]);
  const fitZ = rim.az, fitYd = rim.ay[1], fitYp = rim.ay[0];
  ring(PALM_SIDES, A, [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.97 * fitYp, 0.97 * fitYd, 0.97 * fitZ, Math.PI / PALM_SIDES);
  ring(PALM_SIDES, B, bX, F.Y, F.Z, 1.05 * Math.max(fitYp, 0.8 * S.halfT), 1.05 * Math.max(fitYd, 0.8 * S.halfT), 1.06 * Math.max(fitZ, 0.85 * S.halfW), Math.PI / PALM_SIDES);
  ring(PALM_SIDES, C, F.X, F.Y, F.Z, palmarExtent(S, xC, Lp), S.halfT, S.halfW, Math.PI / PALM_SIDES);
  ring(PALM_SIDES, D, F.X, F.Y, F.Z, palmarExtent(S, xD, Lp), 0.85 * S.halfT, 0.97 * S.halfW, Math.PI / PALM_SIDES);
  put(inPalm(F, [xE, 0.12 * S.halfT, 0]), F.X);
  // Digits: root ring (mitred palm→first segment), joint rings (mitred), tip ring, end ring, apex.
  for (const d of pose.digits) {
    const J = d.joints, dirs = d.dirs, r = d.radii;
    const isThumb = d.name === "thumb";
    // The digit's "dorsal" reference: the back of the hand for fingers; for the thumb, the side axis × dir.
    const dorsal = (dir: Vec3): Vec3 => isThumb ? unit(cross(d.side, dir)) : unit(sub(F.Y, mul(dir, dot(F.Y, dir))));
    const sideOf = (dir: Vec3): Vec3 => unit(cross(dir, dorsal(dir)));
    const miter = (a: Vec3, b: Vec3) => unit(add(a, b));
    const half = (a: Vec3, b: Vec3) => Math.min(1.35, 1 / Math.max(0.6, Math.cos(0.5 * Math.acos(Math.max(-1, Math.min(1, dot(a, b)))))));
    const rootDir = isThumb ? dirs[0] : miter(F.X, dirs[0]);
    const flat = 0.88; // digits are a little flatter dorsal-palmar than wide
    const t0 = rootDir;
    ring(DIGIT_SIDES, J[0], t0, dorsal(t0), sideOf(t0), flat * r[0], flat * r[0], r[0], 0);
    const t1 = miter(dirs[0], dirs[1]), k1 = half(dirs[0], dirs[1]);
    ring(DIGIT_SIDES, J[1], t1, dorsal(t1), sideOf(t1), flat * r[1] * k1, flat * r[1], r[1], 0);
    const t2 = miter(dirs[1], dirs[2]), k2 = half(dirs[1], dirs[2]);
    ring(DIGIT_SIDES, J[2], t2, dorsal(t2), sideOf(t2), flat * r[2] * k2, flat * r[2], r[2], 0);
    const L3 = len(sub(J[3], J[2]));
    const tipC = add(J[2], mul(dirs[2], 0.7 * L3));
    ring(DIGIT_SIDES, tipC, dirs[2], dorsal(dirs[2]), sideOf(dirs[2]), flat * r[3], flat * r[3], r[3], 0, true);
    put(add(J[2], mul(dirs[2], L3 + 0.1 * r[3])), dirs[2]);
  }
}

/** A fresh hand mesh in `pose`. */
export function buildHandMesh(S: HandSize, pose: HandPose): HandMesh {
  const topo = handTopology();
  const nv = handVertexCount();
  const m: HandMesh = { positions: new Float32Array(nv * 3), normals: new Float32Array(nv * 3), indices: topo.indices, kind: topo.kind, part: topo.part };
  writeHand(S, pose, m);
  return m;
}

// ---------------------------------------------------------------------------------------------
// measurement
// ---------------------------------------------------------------------------------------------
export interface DigitContact {
  name: DigitName;
  /** Model gap (mm): the closest segment capsule surface to the handle surface (negative = into it). */
  gapMm: number;
  /** Mesh gap (mm): the closest vertex of this digit's palmar side to the handle surface. */
  meshGapMm: number;
  /** Segments whose capsule is within 1.5 mm of the handle surface. */
  touching: number;
  angles: number[];
}
export interface ContactReport { digits: DigitContact[]; palmClearMm: number; tilt: number; deviation: number; wrapDeg: number }

/** Measure the grip: finger/thumb gaps on the capsule model and on the mesh, palm clearance, wrap angle. */
export function contactReport(S: HandSize, pose: HandPose, h0: HandleLine, mesh?: HandMesh): ContactReport {
  const u = unit(h0.u);
  const a = add(h0.p, mul(u, -0.5)), b = add(h0.p, mul(u, 0.5));
  const digits: DigitContact[] = pose.digits.map((d, di) => {
    let gap = Infinity, touching = 0;
    for (let j = 0; j < 3; j++) {
      const segR = 0.5 * (d.radii[j] + d.radii[j + 1]);
      const g = segSegDistance(d.joints[j], d.joints[j + 1], a, b) - segR - h0.r;
      if (g < 0.0015) touching++;
      gap = Math.min(gap, g);
    }
    let meshGap = Infinity;
    if (mesh) {
      for (let v = 0; v < mesh.part.length; v++) {
        if (mesh.part[v] !== di + 1) continue;
        const p: Vec3 = [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]];
        meshGap = Math.min(meshGap, segSegDistance(p, p, a, b) - h0.r);
      }
    }
    return { name: d.name, gapMm: +(gap * 1000).toFixed(2), meshGapMm: +(meshGap * 1000).toFixed(2), touching, angles: d.angles.map((x) => +x.toFixed(3)) };
  });
  // How far round the handle the middle finger reaches (degrees about the axis, knuckle → tip).
  const mid = pose.digits[1];
  const ang = (p: Vec3) => {
    const rel = sub(p, h0.p), q = sub(rel, mul(u, dot(rel, u)));
    return q;
  };
  const q0 = ang(mid.joints[0]), q1 = ang(mid.joints[3]);
  let wrap = Math.acos(Math.max(-1, Math.min(1, dot(unit(q0), unit(q1))))) * 180 / Math.PI;
  // Past 180°: the tip came round the far side (cross product sense against the knuckle's).
  const sense = dot(cross(q0, q1), u) * dot(cross(q0, ang(mid.joints[1])), u);
  if (sense < 0) wrap = 360 - wrap;
  const palmClear = palmClearance(S, { p: h0.p, u, r: h0.r }, pose.tilt, pose.deviation, pose.palmLen);
  return { digits, palmClearMm: +(palmClear * 1000).toFixed(2), tilt: +pose.tilt.toFixed(3), deviation: +pose.deviation.toFixed(3), wrapDeg: +wrap.toFixed(1) };
}

void lerp3;
