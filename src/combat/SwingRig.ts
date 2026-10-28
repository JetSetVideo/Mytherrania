// Lane X2: the THREE side of the swing — measures where a body's blade really runs. The planar
// model in game/anim/Swing.ts ignores the shoulder's display roll (the arm hangs a little abducted,
// so a raised forearm converges ~0.15 rad toward the body's midline); the aim yaw needs the TRUE
// line, so it is measured once per fighter on the rig at spawn, in the body frame.

import type { HumanoidRig } from "../graphics/Humanoid.ts";
import type { SkinnedExtras } from "../graphics/body/SkinnedHumanoid.ts";
import type { JointName, Skeleton } from "../game/Skeleton.ts";
import { type AimLine, GUARD_KEY, gripPitchFor, strikeKeyAt, SWEET_SHARE, type SwingKey } from "../game/anim/Swing.ts";
import type { SwingSetup } from "./SwingDriver.ts";

/** Joints the measurement poses (and restores). */
const POSED: JointName[] = ["spine", "abdomen", "shoulderR", "elbowR", "shoulderL", "elbowL"];

/**
 * The blade's line at mid-strike in the BODY frame (group at the origin, facing +z, no yaw): the grip
 * centre and the sweet spot (SWEET_SHARE · tip along the blade), as [x1, z1, x2, z2] (m). Poses the
 * rig with the swing's mid-strike key, reads the weapon node, then restores the joints, the grip
 * and the group transform. Call at spawn (the Skeleton must not be Animator-driven yet).
 */
export function measureAimLine(rig: HumanoidRig & SkinnedExtras, sk: Skeleton, setup: SwingSetup): AimLine {
  const k: SwingKey = strikeKeyAt(setup.shape, setup.arm, 0.5, { ...GUARD_KEY });
  const saved = POSED.map((n) => sk.joint(n).angle);
  const set = (n: JointName, v: number) => { const j = sk.joint(n); j.angle = Math.max(j.min, Math.min(j.max, v)); j.target = j.angle; };
  set("spine", k.lean); set("abdomen", 0.5 * k.lean);
  set("shoulderR", k.shoulder); set("elbowR", k.elbow);
  if (setup.twoHanded) { set("shoulderL", k.shoulder); set("elbowL", k.elbow); }
  const g = rig.group, pos = g.position.clone(), rot = g.rotation.clone();
  g.position.set(0, 0, 0); g.rotation.set(0, 0, 0);
  rig.update(sk, 0);
  const shoulder = sk.joint("shoulderR").angle, elbow = sk.joint("elbowR").angle, lean = sk.joint("spine").angle;
  rig.setGrip(gripPitchFor(k.blade, lean, shoulder, elbow, setup.reverse), k.roll);
  g.updateMatrixWorld(true);
  const m = rig.weaponNode.matrixWorld.elements, r = SWEET_SHARE * setup.tip;
  // Weapon-local (0, 0, 0) and (0, r, 0) -> world (column-major 4x4).
  const line: AimLine = [m[12], m[14], m[12] + m[4] * r, m[14] + m[6] * r];
  POSED.forEach((n, i) => set(n, saved[i]));
  rig.update(sk, 0);
  rig.setGrip(0, 0);
  g.position.copy(pos); g.rotation.copy(rot);
  g.updateMatrixWorld(true);
  return line;
}
