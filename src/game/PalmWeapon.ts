// Palm-driven weapon constraint: the weapon's orientation derives from the palm
// of the hand that grips it, not from a fixed grip angle. When the palm's normal
// points up, the weapon stands vertical along the grip axis; rotating the palm
// rotates the weapon with it. The constraint chains through the arm — palm,
// wrist, elbow, shoulder, and the opposite shoulder — so a two-handed grip holds
// the weapon on the line between the hands, and the hand separation is limited
// by the torso width.
//
// The user asked for this explicitly: the palm decides the weapon. This module
// computes the weapon's target orientation and the arm-chain pose from a palm
// direction; the rig applies it so the blade is vertical when the palm faces up
// and follows the palm through every swing.
//
// Pure module: no Three.js, no DOM. Directions are unit vectors (x, y up, z fwd),
// angles in radians.

export interface Vec3 { x: number; y: number; z: number }

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const norm = (a: Vec3): Vec3 => { const l = len(a) || 1; return v(a.x / l, a.y / l, a.z / l); };
const sub = (a: Vec3, b: Vec3): Vec3 => v(a.x - b.x, a.y - b.y, a.z - b.z);

/** Anatomical link lengths (m), scaled by the rig's height. */
export const ARM_LINK = { shoulderToElbow: 0.46, elbowToWrist: 0.4, wristToPalm: 0.12 } as const;

/**
 * The weapon's orientation from the palm. The grip axis runs along the palm's
 * "wrap" direction (the curl of the fingers, perpendicular to the palm normal and
 * the forearm). When the palm normal points up (+y), the weapon's long axis is
 * vertical; tilting the palm tilts the weapon by the same rotation.
 *
 * Returns the weapon's forward (tip) direction and its roll about that axis.
 */
/**
 * The weapon's orientation from the palm. A held weapon points the way the palm
 * faces: the tip runs along the palm normal, so a palm facing up holds the weapon
 * vertical (tip up), and tilting the palm tilts the weapon by the same rotation.
 * The forearm only sets the roll reference about that axis.
 *
 * Returns the weapon's forward (tip) direction and its roll about that axis.
 */
// LEGACY (lane G, wave V): the engine no longer uses this — a blade along the palm NORMAL stands out of
// the back of the hand. A held handle runs ACROSS the palm: see gripEuler below.
export function weaponFromPalm(palmNormal: Vec3, forearmDir: Vec3): { tip: Vec3; roll: number } {
  const n = norm(palmNormal);
  // The tip follows the palm normal directly.
  const tip = n;
  // Roll: the rotation of the palm about the tip, measured against the forearm's
  // component perpendicular to the tip (so a twisted wrist rolls the weapon).
  const f = norm(forearmDir);
  const fPerp = norm(sub(f, v(tip.x * dot(f, tip), tip.y * dot(f, tip), tip.z * dot(f, tip))));
  const ref = Math.abs(tip.y) < 0.99 ? norm(cross(v(0, 1, 0), tip)) : v(1, 0, 0);
  const roll = Math.atan2(dot(fPerp, norm(cross(tip, ref))), dot(fPerp, ref));
  return { tip, roll };
}

/** True when the palm is facing up enough that the weapon should read vertical. */
export function palmIsUp(palmNormal: Vec3, tolerance = 0.7): boolean {
  return norm(palmNormal).y >= tolerance;
}

/**
 * Two-point IK for the arm chain: given the shoulder position, the target palm
 * position, and the elbow bend direction, return the elbow position so the hand
 * reaches the palm. Used so the fist tracks the weapon handle, not a free arc.
 * Returns null when the target is out of reach (the caller should straighten the arm).
 */
export function solveElbow(shoulder: Vec3, palm: Vec3, bendDir: Vec3): Vec3 | null {
  const upper = ARM_LINK.shoulderToElbow;
  const fore = ARM_LINK.elbowToWrist + ARM_LINK.wristToPalm;
  const axis = sub(palm, shoulder);
  const d = len(axis);
  if (d > upper + fore || d < 1e-6) return null; // out of reach
  // Law of cosines: distance from shoulder to the elbow's projection on the axis.
  const a = (upper * upper - fore * fore + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, upper * upper - a * a));
  const axisN = norm(axis);
  // Bend direction perpendicular to the axis.
  let bend = sub(norm(bendDir), v(axisN.x * dot(norm(bendDir), axisN), axisN.y * dot(norm(bendDir), axisN), axisN.z * dot(norm(bendDir), axisN)));
  if (len(bend) < 1e-4) bend = v(0, -1, 0); // default bend: elbow down
  bend = norm(bend);
  return v(
    shoulder.x + axisN.x * a + bend.x * h,
    shoulder.y + axisN.y * a + bend.y * h,
    shoulder.z + axisN.z * a + bend.z * h,
  );
}

/**
 * The full arm-chain pose for a weapon grip: shoulder angles that place the palm
 * at the handle with the palm facing the right way. Returns the elbow bend and
 * shoulder swing needed, so the fist, palm, elbow and shoulder stay coherent.
 */
/**
 * The full arm-chain pose for a weapon grip: shoulder angles that place the palm
 * at the handle with the palm facing the right way. The elbow bends more the
 * closer the target is (a tucked arm) and straightens as the target reaches the
 * limit, so the fist, palm, elbow and shoulder stay coherent.
 */
export function armChainPose(shoulderToPalm: Vec3): { elbowBend: number; shoulderSwing: number } {
  const upper = ARM_LINK.shoulderToElbow;
  const fore = ARM_LINK.elbowToWrist + ARM_LINK.wristToPalm;
  const d = Math.min(len(shoulderToPalm), upper + fore - 1e-4);
  // Elbow interior angle by the law of cosines; the BEND is pi minus that, so a
  // fully-extended arm (d = upper+fore) has ~0 bend and a tucked arm bends more.
  const cosInterior = (upper * upper + fore * fore - d * d) / (2 * upper * fore);
  const interior = Math.acos(Math.max(-1, Math.min(1, cosInterior)));
  const elbowBend = Math.PI - interior;
  const shoulderSwing = Math.atan2(shoulderToPalm.y, Math.hypot(shoulderToPalm.x, shoulderToPalm.z));
  return { elbowBend, shoulderSwing };
}

// ---------------------------------------------------------------------------------------------
// Lane G (wave V): the handle lies ACROSS the palm, through the closed fist.
//
// The skinned rig has no wrist bone: the hand (AnatomyParts.handNode) is rigid on the forearm
// bone, with d the finger axis, n the back-of-hand normal (the palm faces −n) and w = across the
// palm toward the thumb. A fist closes about w, so a held handle runs along ±w: the blade leaves
// the thumb side (forward grip) or the little-finger side (reverse grip), at ~90° to d and inside
// the hand plane (d, w). The grip group (rig.setGrip: rotation.x = pitch, rotation.z = roll, Euler
// XYZ) is the only "wrist", so whatever it does is drawn as the handle turning INSIDE a hand that
// does not move. Before this lane the wrist pitch was solved to hold any blade angle the swing asked
// for (Swing.gripPitchFor), up to ~1 rad past what a wrist can do, about the mount's x axis — which
// ignores the hand's pronation (HAND_PRONATION 0.6 rad turns w 34° out of the arm plane), so the
// handle ran ALONG the fingers or out through the back of the hand.
//
// The fix (gripEuler): the wrist pitch keeps its arm-plane meaning (Swing.ts: π/2 = the hammer
// grip, blade at a right angle to the forearm on the thumb side) but is read as a DEVIATION of the
// handle inside the hand plane, clamped to the wrist's range (radial / ulnar, per archetype:
// GripStance.GRIP_RULES), and the roll as a small forearm twist about d; the handle direction is
// then built in the hand frame and converted to the grip group's Euler (x, z).
// ---------------------------------------------------------------------------------------------

/** A direction as a tuple (x, y, z). */
export type V3t = [number, number, number];

/**
 * Default forearm supination while gripping, rad (= AnatomyParts.HAND_PRONATION, pinned by a test):
 * it turns the relaxed hand's thumb back into the arm plane. SwingRig.solveGripTwist refines it per
 * rig so the carried blade stands upright (an abducted ork arm needs a little more).
 */
export const GRIP_SUPINATION_DEFAULT = 0.6;

/** Arm-plane wrist pitch of the neutral hammer grip (the handle along w, 90° to the fingers). */
export const GRIP_NEUTRAL = Math.PI / 2;

/** A wrist range: radial (blade tips back toward the elbow) and ulnar (toward the finger line), rad, and the twist bound. */
export interface WristBand { radial: number; ulnar: number; roll: number }

/** The no-pronation hand frame (a hand hanging straight, thumb forward): [d, n, w] in the mount space. */
export const PLAIN_HAND: [V3t, V3t, V3t] = [[0, -1, 0], [-1, 0, 0], [0, 0, 1]];

const tdot = (a: V3t, b: V3t) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const tnorm = (a: V3t): V3t => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const tcross = (a: V3t, b: V3t): V3t => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Wrist deviation (rad, + ulnar = toward the finger line) of an arm-plane wrist pitch, clamped to the band. */
export function wristDeviation(pitch: number, band: WristBand): number {
  const dev = pitch - GRIP_NEUTRAL;
  return Math.max(-band.radial, Math.min(band.ulnar, Number.isFinite(dev) ? dev : 0));
}

/** The arm-plane wrist pitch actually drawn for a wanted one (the band's clamp). */
export function clampWristPitch(pitch: number, band: WristBand): number {
  return GRIP_NEUTRAL + wristDeviation(pitch, band);
}

/**
 * Handle direction (grip +y: the thumb-side end) in the hand frame's space for a wrist pitch and
 * roll: y0 = w·cos(dev) + d·sin(dev) inside the hand plane, then twisted about d by the roll
 * (+ toward n, the holder's outside). Unit vector.
 */
export function handleDirection(hand: [V3t, V3t, V3t], pitch: number, roll: number, band: WristBand): V3t {
  const [d, , w] = hand, dev = wristDeviation(pitch, band);
  const r = Math.max(-band.roll, Math.min(band.roll, Number.isFinite(roll) ? roll : 0));
  const cd = Math.cos(dev), sd = Math.sin(dev);
  const y0: V3t = tnorm([w[0] * cd + d[0] * sd, w[1] * cd + d[1] * sd, w[2] * cd + d[2] * sd]);
  // Rodrigues about d (unit): v cos r + (d × v) sin r + d (d·v)(1 − cos r).
  const dn = tnorm(d), k = tcross(dn, y0), dv = tdot(dn, y0), cr = Math.cos(r), sr = Math.sin(r);
  return tnorm([
    y0[0] * cr + k[0] * sr + dn[0] * dv * (1 - cr),
    y0[1] * cr + k[1] * sr + dn[1] * dv * (1 - cr),
    y0[2] * cr + k[2] * sr + dn[2] * dv * (1 - cr),
  ]);
}

/**
 * The grip group's Euler (XYZ, y = 0) that points its +y along `dir` (mount space):
 * Rx(a)·Rz(c)·ŷ = (−sin c, cos c·cos a, cos c·sin a). Writes [a, c] into `out`.
 */
export function eulerForAxis(dir: V3t, out: [number, number] = [0, 0]): [number, number] {
  const u = tnorm(dir);
  out[1] = -Math.asin(Math.max(-1, Math.min(1, u[0])));
  out[0] = Math.atan2(u[2], u[1]);
  return out;
}

/** rig.setGrip(pitch, roll) arguments [rotation.x, rotation.z] for an arm-plane wrist pitch and roll (module comment). */
export function gripEuler(hand: [V3t, V3t, V3t], pitch: number, roll: number, band: WristBand, out: [number, number] = [0, 0]): [number, number] {
  return eulerForAxis(handleDirection(hand, pitch, roll, band), out);
}

/** Handle direction (mount space) drawn by grip Euler (x = a, z = c, y = 0): the inverse map of eulerForAxis. */
export function axisOfEuler(a: number, c: number): V3t {
  return [-Math.sin(c), Math.cos(c) * Math.cos(a), Math.cos(c) * Math.sin(a)];
}

/** One live measurement (tools/probe-grip.ts reads it from Engine.debugGripInfo). */
export interface GripSample {
  hand: { palm: V3t; grip: V3t; d: V3t; n: V3t; w: V3t };
  /** Weapon +y (grip -> striking end), +z (edge / bow back), world. */
  y: V3t; z: V3t;
  /** Where the hand closes (the grip group's origin) and the striking end, world. */
  gripOrigin: V3t; tipPoint: V3t;
  /** Body axis (pelvis and chest, world) and the facing (unit, horizontal). */
  pelvis: V3t; chest: V3t; facing: V3t;
  /** Off hand grip anchor (two-handed weapons), world. */
  offGrip?: V3t | null;
}

/** Angles in degrees, distances in mm (see gripMetrics). */
export interface GripMetrics {
  /** Angle between the handle LINE and the finger axis d: 90 = straight across the palm. */
  handleToFingers: number;
  /** Angle between the handle line and the hand plane (d, w): 0 = in the palm, 90 = through the back of the hand. */
  outOfPalmPlane: number;
  /** +1 the blade leaves the thumb side (forward grip), −1 the little-finger side (reverse). */
  side: 1 | -1;
  /** Closest distance of the handle line to the palm centre / the anatomical grip anchor, mm. */
  lineToPalmMm: number; lineToGripAnchorMm: number;
  /** Grip point (grip group origin) to the palm centre, mm. */
  gripToPalmMm: number;
  /** The handle passes through the fist: within FIST_RADIUS of the grip anchor and in the palm plane (the across-the-fingers bound is the rule's wrist band: GripStance.checkOrientation). */
  through: boolean;
  /** Striking end elevation (deg above horizontal), outward share (horizontal, away from the body axis), forward share. */
  elevation: number; outward: number; forward: number;
  /** Weapon +z (edge / a bow's back, its string is at −z) along the facing, horizontal share: + = away from the holder. */
  edgeForward: number;
  /** The blade segment's closest horizontal approach to the body axis inside the torso band, mm. */
  bodyClearMm: number;
  /** Off hand to the handle line, mm (null for one-handed). */
  offHandGapMm: number | null;
}

/** Fist half-thickness used by the "through" test, mm (palm half-thickness + finger curl, adult). */
export const FIST_RADIUS_MM = 30;
/** How far (deg) a held handle may leave the palm plane (the forearm twist's bound plus slack). */
export const PALM_PLANE_TOLERANCE_DEG = 30;

const deg = (r: number) => r * 180 / Math.PI;
const sub3 = (a: V3t, b: V3t): V3t => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lineDist = (p: V3t, o: V3t, u: V3t) => { const q = sub3(p, o), t = tdot(q, u); return Math.hypot(q[0] - u[0] * t, q[1] - u[1] * t, q[2] - u[2] * t); };

/** Geometry of one grip sample (GripMetrics). Pure. */
export function gripMetrics(s: GripSample): GripMetrics {
  const y = tnorm(s.y), d = tnorm(s.hand.d), n = tnorm(s.hand.n), w = tnorm(s.hand.w);
  const handleToFingers = deg(Math.acos(Math.min(1, Math.abs(tdot(y, d)))));
  const outOfPalmPlane = deg(Math.asin(Math.min(1, Math.abs(tdot(y, n)))));
  const side: 1 | -1 = tdot(y, w) >= 0 ? 1 : -1;
  const lineToPalmMm = 1000 * lineDist(s.hand.palm, s.gripOrigin, y);
  const lineToGripAnchorMm = 1000 * lineDist(s.hand.grip, s.gripOrigin, y);
  const g = sub3(s.gripOrigin, s.hand.palm), gripToPalmMm = 1000 * Math.hypot(g[0], g[1], g[2]);
  const through = lineToGripAnchorMm <= FIST_RADIUS_MM && outOfPalmPlane <= PALM_PLANE_TOLERANCE_DEG;
  const elevation = deg(Math.asin(Math.max(-1, Math.min(1, y[1]))));
  const rad = tnorm([s.gripOrigin[0] - s.pelvis[0], 0, s.gripOrigin[2] - s.pelvis[2]]);
  const outward = y[0] * rad[0] + y[2] * rad[2];
  const forward = y[0] * s.facing[0] + y[2] * s.facing[2];
  const z = tnorm(s.z), edgeForward = z[0] * s.facing[0] + z[2] * s.facing[2];
  // Blade segment vs the vertical body axis (pelvis x,z) between the pelvis and above the chest.
  let clear = Infinity;
  const lo = s.pelvis[1] - 0.25, hi = s.chest[1] + 0.45;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, p: V3t = [s.gripOrigin[0] + (s.tipPoint[0] - s.gripOrigin[0]) * t, s.gripOrigin[1] + (s.tipPoint[1] - s.gripOrigin[1]) * t, s.gripOrigin[2] + (s.tipPoint[2] - s.gripOrigin[2]) * t];
    if (p[1] < lo || p[1] > hi) continue;
    clear = Math.min(clear, Math.hypot(p[0] - s.pelvis[0], p[2] - s.pelvis[2]));
  }
  const offHandGapMm = s.offGrip ? 1000 * lineDist(s.offGrip, s.gripOrigin, y) : null;
  return { handleToFingers, outOfPalmPlane, side, lineToPalmMm, lineToGripAnchorMm, gripToPalmMm, through, elevation, outward, forward, edgeForward, bodyClearMm: Number.isFinite(clear) ? 1000 * clear : 9999, offHandGapMm };
}
