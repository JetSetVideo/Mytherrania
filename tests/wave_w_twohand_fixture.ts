// Lane T (wave W): the measurement harness behind tests/wave_w_twohand_*_test.ts and the lane report.
// Lane A's REAL skinned rig (no browser), posed in the ENGINE's frame order:
//   Skeleton joints (the swing's attack pose, or GUARD_POSE at guard) -> rig.update -> forearm
//   supination (RigAdapter.applyForearmTwist) -> rig.setGrip(SwingDriver.gripPitch/gripRoll) -> choke
//   -> the off hand on the haft (`post`: RigAdapter.applyOffHandGrip in the engine)
// then measured from the scene graph:
//   offGapMm      the off hand's grip anchor (AnatomyParts' fist point) to the handle LINE, mm
//   offAlongMm    where along the haft it sits (weapon +y from the main grip, mm; < 0 = below the main hand)
//   offFingers    the off hand's handle-to-finger angle, deg (90 = across the palm)
//   tipElev       the striking end's elevation (grip -> tip), deg
//   lineElev      the line from the grip to the target's torso centre (mid shoulder-hip of the same body,
//                 standing at the swing's sweet distance straight ahead), deg
//   grip          the weapon hand's PalmWeapon.gripMetrics (handle to fingers, through the fist, elevation)
// @deno-types="@types/three"
import * as THREE from "three";
import { buildSkinnedHumanoid } from "../src/graphics/body/SkinnedHumanoid.ts";
import { defaultHumanoid, type JointName, type Skeleton } from "../src/game/Skeleton.ts";
import { JOINT_ORDER, legGeometryFromBones, limitTableFrom } from "../src/game/anim/Rig.ts";
import { motionStyleFor, weaponMotionFromSpec } from "../src/game/anim/MotionStyle.ts";
import { createFighter } from "../src/game/Fighter.ts";
import { armGeometry, engageDistance, type SwingShape } from "../src/game/anim/Swing.ts";
import { GUARD_POSE } from "../src/game/anim/Poses.ts";
import { applyForearmTwist, handFrameWorld } from "../src/combat/RigAdapter.ts";
import { handSweetDistance, SwingDriver, type SwingSetup, swingSetupFor } from "../src/combat/SwingDriver.ts";
import { measureAimLine } from "../src/combat/SwingRig.ts";
import { applyTwoHandGrip, clearWeaponArmConvergence } from "../src/combat/OffHand.ts";
import { gripMetrics, type V3t } from "../src/game/PalmWeapon.ts";
import { checkOrientation, GRIP_RULES } from "../src/game/GripStance.ts";
import { weaponFromSeed } from "../src/game/weapons/Generate.ts";
import { toGeneratedWeapon } from "../src/game/weapons/Adapter.ts";
import type { ArchetypeId, WeaponSpec } from "../src/combat/contracts.ts";

export interface Look { body: string; accent: string; height: number; weight: number; hair: string; eyes: string; race: string; subrace: string | null }
export const HUMAN: Look = { body: "#ef7455", accent: "#dfaa55", height: 1.7, weight: 72, hair: "#3a2a1a", eyes: "#2f6fb5", race: "human", subrace: null };
export const ORK: Look = { body: "#4f8490", accent: "#172128", height: 1.95, weight: 120, hair: "#172128", eyes: "#172128", race: "ork", subrace: "ironhide" };
export const DWARF: Look = { body: "#c08060", accent: "#704020", height: 1.39, weight: 70, hair: "#603010", eyes: "#203040", race: "dwarf", subrace: "mountain" };
export type Beat = "guard" | "windup" | "contact" | "hold" | "recover";
export const BEATS: Beat[] = ["guard", "windup", "contact", "hold", "recover"];
/** Two-handed archetypes whose off hand belongs on the haft (the bow's off hand draws the string). */
export const TWO_HANDED: ArchetypeId[] = ["longsword", "greatsword", "spear", "halberd", "scythe", "staff", "greataxe", "maul"];
/** Thrusting archetypes (reverse dagger included). */
export const THRUSTERS: ArchetypeId[] = ["spear", "rapier", "dagger"];

export type Post = (rig: Rig, sk: Skeleton, drv: SwingDriver, spec: WeaponSpec) => void;
/** The engine's two-hand step (Engine pose loop: OffHand.applyTwoHandGrip with the setup's off-hand plan). */
export const ENGINE_TWO_HAND: Post = (rig, sk, drv) => {
  if (drv.setup.offHand) applyTwoHandGrip(rig, sk.joint("shoulderR").angle, drv.setup.offHand, drv.chokeOffset());
};
type Rig = ReturnType<typeof buildSkinnedHumanoid>;

export interface BeatSample {
  id: ArchetypeId; beat: Beat; kind: string; reverse: boolean; twoHanded: boolean;
  offGapMm: number | null; offAlongMm: number | null; offFingers: number | null;
  tipElev: number; lineElev: number; aimErr: number;
  grip: ReturnType<typeof gripMetrics>; rule: ReturnType<typeof checkOrientation>;
}

const v3 = (v: THREE.Vector3): V3t => [v.x, v.y, v.z];
const DEG = 180 / Math.PI;

export interface Bench { id: ArchetypeId; spec: WeaponSpec; rig: Rig; sk: Skeleton; setup: SwingSetup; drv: SwingDriver; torsoY: number }

/** Build a rig + driver for an archetype the way Engine.#armCombat does. `shape`: a CONTROL swing shape (before/after pins). */
export function bench(id: ArchetypeId, look: Look = HUMAN, shape: SwingShape | null = null): Bench {
  const spec = weaponFromSeed(id, 7);
  const rig = buildSkinnedHumanoid(toGeneratedWeapon(spec), look, "fire", undefined, { paint: false, weaponSpec: spec });
  const sk = defaultHumanoid();
  const head = (b: string) => rig.plan.bones.find((x) => x.id === b)!.head;
  const setup = swingSetupFor(spec, armGeometry(head("shoulderR"), head("elbowR"), rig.plan.arms[1].grip));
  if (shape) {
    setup.shape = shape;
    setup.sweet = handSweetDistance(shape, setup.arm, setup.tip, setup.rule, setup.reverse);
    setup.engage = engageDistance(setup.sweet);
  }
  setup.aimLine = measureAimLine(rig, sk, setup);
  const drv = new SwingDriver(setup, limitTableFrom(sk.limits()));
  // The engine's lane M motion style (fresh): the styled four-phase swing, whose contact is the real one
  // (an unstyled swing's "contact" is mid-strike).
  const ankleY = rig.plan.bones.find((x) => x.id === "ankleL")!.head[1];
  let seed = 0;
  for (const ch of `${look.race}/${look.subrace}`) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const style = motionStyleFor({
    race: look.race, subrace: look.subrace, seed,
    body: { geometry: legGeometryFromBones(rig.plan.bones, ankleY, 1), height: look.height, weight: look.weight },
    weapon: weaponMotionFromSpec(spec, setup.kind), stats: createFighter("Warrior", look.race, 0, 0, 0.5, look.race, look.subrace).stats,
  });
  style.setLiveImmediate({ hpFrac: 1, staminaFrac: 1, manaFrac: 1, exhausted: false });
  drv.setStyle(style);
  const torsoY = 0.5 * (head("shoulderR")[1] + head("hipR")[1]);
  return { id, spec, rig, sk, setup, drv, torsoY };
}

/** Clock (s since the press) of a beat of the driver's current timing. */
export function beatClock(drv: SwingDriver, beat: Exclude<Beat, "guard">): number {
  const t = drv.player.timing, ph = drv.phaseTimes();
  if (beat === "windup") return 0.97 * t.windup;
  if (beat === "contact") return ph.contactAt;
  if (beat === "hold") return t.windup + t.strike + 0.5 * (t.hold ?? 0);
  return t.windup + t.strike + (t.hold ?? 0) + 0.5 * t.recover;
}

/** Pose the bench at a beat (engine order) and measure it. `post` = the engine's off-hand step; `clock` (s since the press) overrides the beat's instant. */
export function measureBeat(b: Bench, beat: Beat, post: Post | null, clock?: number): BeatSample {
  const { rig, sk, drv, setup, spec } = b;
  const set = (n: JointName, a: number) => { const j = sk.joint(n); j.angle = Math.max(j.min, Math.min(j.max, a)); j.target = j.angle; };
  for (const n of JOINT_ORDER) set(n, sk.limits().get(n)!.rest);
  if (beat === "guard") {
    drv.player.cancel();
    for (const n in GUARD_POSE) set(n as JointName, GUARD_POSE[n as JointName]!);
  } else {
    drv.begin(setup.sweet, 0, 0);
    drv.player.clock = drv.player.prevClock = clock ?? beatClock(drv, beat);
    drv.player.sample(drv.sample);
    const pose = drv.attackPose()!;
    for (const n of ["spine", "abdomen", "neck", "head", "shoulderL", "shoulderR", "elbowL", "elbowR"] as JointName[]) set(n, pose[JOINT_ORDER.indexOf(n)]);
  }
  rig.group.position.set(0, 0, 0); rig.group.rotation.set(0, 0, 0);
  rig.update(sk, 0);
  applyForearmTwist(rig, sk.joint("elbowR").angle, setup.twist);
  rig.setGrip(drv.gripPitch(sk.joint("spine").angle, sk.joint("shoulderR").angle, sk.joint("elbowR").angle), drv.gripRoll());
  rig.weaponNode.position.y = -drv.chokeOffset();
  rig.group.updateMatrixWorld(true);
  if (post) { post(rig, sk, drv, spec); rig.group.updateMatrixWorld(true); }
  else clearWeaponArmConvergence(rig);
  const h = handFrameWorld(rig, 1), e = rig.weaponNode.matrixWorld.elements;
  const chest = new THREE.Vector3(), pelvis = new THREE.Vector3(), gripO = new THREE.Vector3();
  rig.bones.get("spine")!.getWorldPosition(chest);
  rig.bones.get("abdomen")!.getWorldPosition(pelvis);
  (rig.weaponNode.parent ?? rig.weaponNode).getWorldPosition(gripO);
  const tip = rig.weaponNode.localToWorld(new THREE.Vector3(0, setup.tip, 0));
  const y = new THREE.Vector3(e[4], e[5], e[6]).normalize();
  const twoHanded = setup.twoHanded && setup.rule.carry !== "upright-bow";
  const left = handFrameWorld(rig, 0);
  const grip = gripMetrics({
    hand: { palm: v3(h.palm), grip: v3(h.grip), d: v3(h.d), n: v3(h.n), w: v3(h.w) },
    y: [y.x, y.y, y.z], z: [e[8], e[9], e[10]], gripOrigin: v3(gripO), tipPoint: v3(tip),
    pelvis: v3(pelvis), chest: v3(chest), facing: [0, 0, 1], offGrip: twoHanded ? v3(left.grip) : null,
  });
  const q = left.grip.clone().sub(gripO);
  const offAlongMm = twoHanded ? 1000 * q.dot(y) : null;
  const offFingers = twoHanded ? DEG * Math.acos(Math.min(1, Math.abs(left.d.dot(y)))) : null;
  const dir = tip.clone().sub(gripO).normalize();
  const tipElev = DEG * Math.asin(Math.max(-1, Math.min(1, dir.y)));
  // The target: the same body standing at the sweet distance straight ahead; its torso centre.
  const T = new THREE.Vector3(0, b.torsoY, setup.sweet);
  const lineElev = DEG * Math.atan2(T.y - gripO.y, Math.hypot(T.x - gripO.x, T.z - gripO.z));
  const rule = checkOrientation(GRIP_RULES[b.id], beat === "hold" ? "contact" : beat, grip);
  return {
    id: b.id, beat, kind: setup.kind, reverse: setup.reverse, twoHanded,
    offGapMm: grip.offHandGapMm, offAlongMm, offFingers, tipElev, lineElev, aimErr: tipElev - lineElev, grip, rule,
  };
}

/** Every beat of an archetype. */
export function measureAll(id: ArchetypeId, post: Post | null, look: Look = HUMAN, beats: Beat[] = BEATS): BeatSample[] {
  const b = bench(id, look);
  return beats.map((beat) => measureBeat(b, beat, post));
}

/** One printable line. */
export function fmt(s: BeatSample): string {
  const f = (x: number | null, d = 0) => x === null ? "   -" : x.toFixed(d).padStart(5);
  return `${s.id.padEnd(10)} ${s.beat.padEnd(7)} ${s.kind.padEnd(6)} off gap ${f(s.offGapMm)} mm along ${f(s.offAlongMm)} mm offFingers ${f(s.offFingers)}° | fingers ${s.grip.handleToFingers.toFixed(1)}° through ${s.grip.through ? "y" : "N"} | tip ${s.tipElev.toFixed(1)}° line ${s.lineElev.toFixed(1)}° err ${s.aimErr.toFixed(1)}° | ${s.rule.ok ? "ok" : "RULE " + s.rule.why.join(";")}`;
}
