// Lane X2: the THREE side of the swing — measures where a body's blade really runs. The planar
// model in game/anim/Swing.ts ignores the shoulder's display roll (the arm hangs a little abducted,
// so a raised forearm converges ~0.15 rad toward the body's midline); the aim yaw needs the TRUE
// line, so it is measured once per fighter on the rig at spawn, in the body frame.

import type { HumanoidRig } from "../graphics/Humanoid.ts";
import type { SkinnedExtras } from "../graphics/body/SkinnedHumanoid.ts";
import type { JointName, Skeleton } from "../game/Skeleton.ts";
import { type AimLine, GUARD_KEY, gripPitchFor, strikeKeyAt, SWEET_SHARE, type SwingKey } from "../game/anim/Swing.ts";
import type { SwingSetup } from "./SwingDriver.ts";
import { gripEuler } from "../game/PalmWeapon.ts";
import { applyForearmTwist, handFrameInMount, setGripTwist } from "./RigAdapter.ts";

/** Lane G: the forearm supination search range, rad (a forearm turns ~1.4 rad palm-down to palm-up). */
export const TWIST_RANGE: [number, number] = [0, 1.4];
/** Lane G: how far (rad) the carried blade may lean sideways from upright before the forearm turns further (10°). */
export const GUARD_LEAN = 10 * Math.PI / 180;

/**
 * Lane G: the forearm supination (rad) that carries the blade UPRIGHT at guard on THIS rig: poses
 * GUARD_KEY with the carry grip and finds the twist whose blade has no sideways lean in the body
 * frame within GUARD_LEAN (the smallest such twist over TWIST_RANGE). The relaxed hand's pronation
 * (HAND_PRONATION 0.6) is the first-order answer; the arm's abduction (wider on an ork) adds the
 * rest. Restores the joints, grip and group. Call at spawn.
 */
export function solveGripTwist(rig: HumanoidRig & SkinnedExtras, sk: Skeleton, setup: SwingSetup): number {
  const saved = POSED.map((n) => sk.joint(n).angle);
  const set = (n: JointName, v: number) => { const j = sk.joint(n); j.angle = Math.max(j.min, Math.min(j.max, v)); j.target = j.angle; };
  const k = GUARD_KEY;
  set("spine", k.lean); set("abdomen", 0.5 * k.lean); set("shoulderR", k.shoulder); set("elbowR", k.elbow);
  const g = rig.group, pos = g.position.clone(), rot = g.rotation.clone();
  g.position.set(0, 0, 0); g.rotation.set(0, 0, 0);
  rig.update(sk, 0);
  const lean = sk.joint("spine").angle, shoulder = sk.joint("shoulderR").angle, elbow = sk.joint("elbowR").angle;
  const want = setup.rule.carry === "upright-bow" ? 0 : setup.reverse ? k.blade + Math.PI : k.blade;
  const e = gripEuler(setup.hand, gripPitchFor(want, lean, shoulder, elbow, setup.reverse), 0, setup.rule.band);
  rig.setGrip(e[0], e[1]);
  const sideways = (t: number) => {
    applyForearmTwist(rig, elbow, t);
    g.updateMatrixWorld(true);
    const m = rig.weaponNode.matrixWorld.elements;
    return Math.abs(m[4]) / (Math.hypot(m[4], m[5], m[6]) || 1);
  };
  // The SMALLEST supination that stands the blade within GUARD_LEAN of upright (a forearm turns no
  // further than it must; the elbow skin twists with it), else the most upright one in range.
  const limit = Math.sin(GUARD_LEAN);
  let twist = Number.NaN, best = TWIST_RANGE[0], bestV = Infinity;
  for (let t = TWIST_RANGE[0]; t <= TWIST_RANGE[1] + 1e-9; t += 0.02) {
    const s = sideways(t);
    if (s < bestV) { bestV = s; best = t; }
    if (s <= limit) { twist = t; break; }
  }
  if (Number.isNaN(twist)) twist = best;
  POSED.forEach((n, i) => set(n, saved[i]));
  rig.update(sk, 0);
  rig.setGrip(0, 0);
  g.position.copy(pos); g.rotation.copy(rot);
  g.updateMatrixWorld(true);
  return twist;
}

/** Joints the measurement poses (and restores). */
const POSED: JointName[] = ["spine", "abdomen", "shoulderR", "elbowR", "shoulderL", "elbowL"];

/**
 * The blade's line at mid-strike in the BODY frame (group at the origin, facing +z, no yaw): the grip
 * centre and the sweet spot (SWEET_SHARE · tip along the blade), as [x1, z1, x2, z2] (m). Poses the
 * rig with the swing's mid-strike key, reads the weapon node, then restores the joints, the grip
 * and the group transform. Call at spawn (the Skeleton must not be Animator-driven yet). Lane G: also
 * writes setup.hand (RigAdapter.handFrameInMount) and poses with the supinated forearm.
 */
export function measureAimLine(rig: HumanoidRig & SkinnedExtras, sk: Skeleton, setup: SwingSetup): AimLine {
  // Lane G: the palm the handle must lie across (constant per rig) and the forearm supination that
  // stands the carried blade upright — every caller of the aim line (engine, harnesses) then draws
  // the same hand.
  setup.hand = handFrameInMount(rig);
  setup.twist = solveGripTwist(rig, sk, setup);
  setGripTwist(rig, setup.twist);
  const k: SwingKey = strikeKeyAt(setup.shape, setup.arm, 0.5, { ...GUARD_KEY });
  const saved = POSED.map((n) => sk.joint(n).angle);
  const set = (n: JointName, v: number) => { const j = sk.joint(n); j.angle = Math.max(j.min, Math.min(j.max, v)); j.target = j.angle; };
  set("spine", k.lean); set("abdomen", 0.5 * k.lean);
  set("shoulderR", k.shoulder); set("elbowR", k.elbow);
  if (setup.twoHanded) { set("shoulderL", k.shoulder); set("elbowL", k.elbow); }
  const g = rig.group, pos = g.position.clone(), rot = g.rotation.clone();
  g.position.set(0, 0, 0); g.rotation.set(0, 0, 0);
  rig.update(sk, 0);
  applyForearmTwist(rig, sk.joint("elbowR").angle, setup.twist); // lane G: the engine draws the gripping forearm supinated
  const shoulder = sk.joint("shoulderR").angle, elbow = sk.joint("elbowR").angle, lean = sk.joint("spine").angle;
  // Lane G: the same hand mapping the engine draws (the handle across the palm, wrist band-limited).
  const e = gripEuler(setup.hand, gripPitchFor(k.blade, lean, shoulder, elbow, setup.reverse), k.roll, setup.rule.strikeBand);
  rig.setGrip(e[0], e[1]);
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
