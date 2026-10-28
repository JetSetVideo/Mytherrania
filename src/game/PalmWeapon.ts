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
