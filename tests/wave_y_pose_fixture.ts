// Lane A (wave Y): the measurement harness behind tests/wave_y_pose_test.ts, tools/wave-y-pose-report.ts
// and docs/wave-y/POSE.md. Lane A's REAL skinned rig (no browser), posed the way each surface poses it:
//
//   idle     Engine pre-fight / out-of-fight standing: Animator (engaged false, speed 0, facing hold
//            honoured) -> Skeleton.drive -> rig.update -> forearm supination -> rig.setGrip(SwingDriver
//            wristPitch -> gripEulerOf) -> choke -> two-hand step (Engine pose loop order)
//   guard    the same, engaged (the fight's standing guard: GUARD layer at guardIdleWeight)
//   block    the same, blocking (GUARD layer at 1)
//   walk     the same, walking 2.1 m/s (the worst frame of a gait cycle)
//   preview  the Creator / portrait studio: PreviewScene.buildPreviewRig + skeleton.update + rig.update
//            (PreviewScene.#render) and whatever grip the rig itself carries there
//
// Measured in BODY space (rig group frame: +z the fighter's forward, +y up, +x the fighter's left):
//   fwd      forward share of the striking end's direction (grip -> tip), −1..1 (< 0: the tip is
//            BEHIND the frontal plane through the grip — "held backward")
//   elev     elevation of grip -> tip, deg
//   out      outward share (away from the body's sagittal plane on the weapon hand's side)
//   tipZmm   tip forward of the grip, mm
// Knees: lateral offset of each knee from its hip->ankle line (+ = away from the midline), mm.
// @deno-types="@types/three"
import * as THREE from "three";
import { buildSkinnedHumanoid } from "../src/graphics/body/SkinnedHumanoid.ts";
import { buildPreviewRig } from "../src/graphics/PreviewScene.ts";
import { defaultHumanoid, type Skeleton } from "../src/game/Skeleton.ts";
import { legGeometryFromBones, limitTableFrom } from "../src/game/anim/Rig.ts";
import { Animator } from "../src/game/anim/Animator.ts";
import { motionStyleFor, weaponMotionFromSpec } from "../src/game/anim/MotionStyle.ts";
import { createFighter } from "../src/game/Fighter.ts";
import { armGeometry } from "../src/game/anim/Swing.ts";
import { applyForearmTwist } from "../src/combat/RigAdapter.ts";
import { SwingDriver, swingSetupFor } from "../src/combat/SwingDriver.ts";
import { measureAimLine } from "../src/combat/SwingRig.ts";
import { applyTwoHandGrip } from "../src/combat/OffHand.ts";
import { weaponFromSeed } from "../src/game/weapons/Generate.ts";
import { toGeneratedWeapon } from "../src/game/weapons/Adapter.ts";
import { wrapAngle } from "../src/core/MathCore.ts";
import type { ArchetypeId } from "../src/combat/contracts.ts";
import type { CharacterProfile } from "../src/game/Characters.ts";

export interface Look { body: string; accent: string; height: number; weight: number; hair: string; eyes: string; race: string; subrace: string | null }
export const LOOKS: Record<string, Look> = {
  human: { body: "#ef7455", accent: "#dfaa55", height: 1.7, weight: 72, hair: "#3a2a1a", eyes: "#2f6fb5", race: "human", subrace: null },
  elf: { body: "#82b970", accent: "#a9ce7c", height: 1.77, weight: 60, hair: "#d8b87a", eyes: "#a9ce7c", race: "elf", subrace: "wood" },
  dwarf: { body: "#9b72cf", accent: "#dfaa55", height: 1.39, weight: 70, hair: "#a87a4a", eyes: "#172128", race: "dwarf", subrace: "mountain" },
  ork: { body: "#4f8490", accent: "#172128", height: 1.95, weight: 120, hair: "#172128", eyes: "#172128", race: "ork", subrace: "ironhide" },
};
export type PoseKind = "idle" | "guard" | "block" | "walk" | "preview";
export const POSES: PoseKind[] = ["idle", "guard", "block", "walk", "preview"];

type Rig = ReturnType<typeof buildSkinnedHumanoid>;
export interface BladeSample { id: string; pose: PoseKind; race: string; reverse: boolean; fwd: number; elev: number; out: number; tipZmm: number }
export interface KneeSample { race: string; pose: PoseKind; kneeOutMm: [number, number]; kneeFwdMm: [number, number] }
export interface PoseSample { blade: BladeSample; knee: KneeSample; slideMm: number; soleTiltDeg: number }

const DEG = 180 / Math.PI;
const V = new THREE.Vector3(), W = new THREE.Vector3();

/** Blade direction of the rig's weapon in its group's frame. */
export function bladeOf(rig: Rig, tipLen: number): { fwd: number; elev: number; out: number; tipZmm: number } {
  rig.group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(rig.group.matrixWorld).invert();
  const g = new THREE.Vector3(), tip = rig.weaponNode.localToWorld(new THREE.Vector3(0, tipLen, 0));
  (rig.weaponNode.parent ?? rig.weaponNode).getWorldPosition(g);
  g.applyMatrix4(inv); tip.applyMatrix4(inv);
  const d = tip.clone().sub(g), n = d.clone().normalize();
  // The weapon hand is the right one: the rig's right is −x, so outward = −x.
  return { fwd: n.z, elev: DEG * Math.asin(Math.max(-1, Math.min(1, n.y))), out: -n.x, tipZmm: 1000 * d.z };
}

/** Lateral offset of each knee from its hip->ankle line in the group frame, mm (+ = away from the midline) and forward offset. */
export function kneesOf(rig: Rig): { out: [number, number]; fwd: [number, number] } {
  rig.group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(rig.group.matrixWorld).invert();
  const out: [number, number] = [0, 0], fwd: [number, number] = [0, 0];
  for (let i = 0; i < 2; i++) {
    const S = i ? "R" : "L";
    const H = rig.bones.get(`hip${S}` as never)!.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const K = rig.bones.get(`knee${S}` as never)!.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const A = rig.bones.get(`ankle${S}` as never)!.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const t = (K.y - H.y) / ((A.y - H.y) || 1e-9);
    const lx = H.x + (A.x - H.x) * t, lz = H.z + (A.z - H.z) * t;
    const side = Math.sign(H.x) || (i ? -1 : 1); // left hip at +x
    out[i] = 1000 * (K.x - lx) * side;
    fwd[i] = 1000 * (K.z - lz);
  }
  return { out, fwd };
}

/** Rig + driver + animator for an archetype on a race, built like Engine.#spawnMeshes/#armCombat/#applyMotionStyle. */
export function benchY(id: ArchetypeId, race: string) {
  const look = LOOKS[race];
  const spec = weaponFromSeed(id, 7);
  const rig = buildSkinnedHumanoid(toGeneratedWeapon(spec), look, "fire", undefined, { paint: false, weaponSpec: spec });
  const sk = defaultHumanoid();
  const head = (b: string) => rig.plan.bones.find((x) => x.id === b)!.head;
  const setup = swingSetupFor(spec, armGeometry(head("shoulderR"), head("elbowR"), rig.plan.arms[1].grip));
  setup.aimLine = measureAimLine(rig, sk, setup);
  const drv = new SwingDriver(setup, limitTableFrom(sk.limits()));
  const ankleY = rig.plan.bones.find((x) => x.id === "ankleL")!.head[1];
  const geo = legGeometryFromBones(rig.plan.bones, ankleY, 1);
  const an = new Animator(geo, limitTableFrom(sk.limits()));
  let seed = 0;
  for (const ch of `${look.race}/${look.subrace}`) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const style = motionStyleFor({
    race: look.race, subrace: look.subrace, seed,
    body: { geometry: geo, height: look.height, weight: look.weight },
    weapon: weaponMotionFromSpec(spec, setup.kind), stats: createFighter("Warrior", look.race, 0, 0, 0.5, look.race, look.subrace).stats,
  });
  style.setLiveImmediate({ hpFrac: 1, staminaFrac: 1, manaFrac: 1, exhausted: false });
  an.setStyle(style);
  drv.setStyle(style);
  rig.group.updateMatrixWorld(true);
  const bindInv = ["ankleL", "ankleR"].map((n) => rig.bones.get(n as never)!.getWorldQuaternion(new THREE.Quaternion()).invert());
  return { id, spec, rig, sk, setup, drv, an, look, bindInv };
}
export type BenchY = ReturnType<typeof benchY>;

/** Engine pose-loop grip step (rig.update already ran). */
export function engineGrip(b: BenchY): void {
  const { rig, sk, drv, setup } = b;
  applyForearmTwist(rig, sk.joint("elbowR").angle, setup.twist);
  const own = drv.wristPitch(sk.joint("spine").angle, sk.joint("shoulderR").angle, sk.joint("elbowR").angle);
  const ge = drv.gripEulerOf(own, drv.wristRoll());
  rig.setGrip(ge[0], ge[1]);
  rig.weaponNode.position.y = -drv.chokeOffset();
  if (setup.offHand) {
    rig.group.updateMatrixWorld(true);
    applyTwoHandGrip(rig, sk.joint("shoulderR").angle, setup.offHand, drv.chokeOffset());
  }
  rig.group.updateMatrixWorld(true);
}

/** Drive the Animator like Engine.#updatePose for `secs`, standing or walking; returns per-frame samples of the last `measure` seconds. */
export function driveEngine(b: BenchY, pose: Exclude<PoseKind, "preview">, secs = 2.5, measure = 1.2): PoseSample[] {
  const { rig, sk, an } = b;
  const HZ = 60, dt = 1 / HZ, speed0 = pose === "walk" ? 2.1 : 0, ACCEL = 6.5 / 0.12;
  const body = { x: 0, z: 0, vx: 0, vz: 0 }, prev = { x: 0, z: 0, yaw: 0 };
  const ox = 0, oz = 1000;
  const out: PoseSample[] = [];
  const n = Math.round(secs * HZ), m0 = n - Math.round(measure * HZ);
  let plantStart: (number[] | null)[] = [null, null];
  let slide = 0;
  for (let k = 0; k < n; k++) {
    const speed = k < 0.4 * HZ ? 0 : speed0;
    const yaw0 = Math.atan2(ox - body.x, oz - body.z);
    const tx = speed * Math.sin(yaw0) - body.vx, tz = speed * Math.cos(yaw0) - body.vz;
    const dv = Math.hypot(tx, tz), s = dv > ACCEL * dt ? ACCEL * dt / dv : 1;
    body.vx += tx * s; body.vz += tz * s; body.x += body.vx * dt; body.z += body.vz * dt;
    const yaw = Math.atan2(ox - body.x, oz - body.z);
    if (k === 0) { prev.x = body.x; prev.z = body.z; prev.yaw = yaw; }
    const dx = body.x - prev.x, dz = body.z - prev.z, sp = Math.hypot(dx, dz) / dt;
    const o = an.update(dt, {
      x: body.x, z: body.z, yaw, rootY: 0, speed: sp, moveDirLocal: sp > 1e-3 ? wrapAngle(Math.atan2(dx, dz) - yaw) : 0,
      turnRate: wrapAngle(yaw - prev.yaw) / dt, grounded: true, hit: false, attack: false, attackPose: null, attackDrive: 0,
      block: pose === "block", ko: false, engaged: pose === "guard" || pose === "block",
      skill: null, skillProgress: 0, groundHeight: () => 0, externalRoll: 0, honoursYawOffset: true,
    });
    prev.x = body.x; prev.z = body.z; prev.yaw = yaw;
    driveSkeleton(sk, o);
    rig.update(sk, dt);
    const yawNow = yaw + o.yawOffset;
    rig.group.position.set(body.x + o.rootOffsetLateral * Math.cos(yawNow), o.rootOffsetY, body.z - o.rootOffsetLateral * Math.sin(yawNow));
    rig.group.rotation.set(0, yawNow, o.rootRoll);
    rig.group.updateMatrixWorld(true);
    engineGrip(b);
    if (k < m0) continue;
    // Planted-ball slide (world) and the planted sole's tilt.
    let tilt = 0;
    for (let i = 0; i < 2; i++) {
      const S = i ? "R" : "L";
      const toe = rig.bones.get(`toe${S}` as never)!.getWorldPosition(V);
      const ball = [toe.x, toe.z];
      if (o.feet[i].planted) {
        if (!plantStart[i]) plantStart[i] = ball;
        slide = Math.max(slide, Math.hypot(ball[0] - plantStart[i]![0], ball[1] - plantStart[i]![1]));
        // Sole tilt: the foot's lateral axis (bind +x carried by the ankle bone's rotation since the bind) vs the horizontal.
        const q = rig.bones.get(`ankle${S}` as never)!.getWorldQuaternion(new THREE.Quaternion()).multiply(b.bindInv[i]);
        W.set(1, 0, 0).applyQuaternion(q);
        tilt = Math.max(tilt, Math.abs(DEG * Math.asin(Math.max(-1, Math.min(1, W.y)))));
      } else plantStart[i] = null;
    }
    const bl = bladeOf(rig, b.setup.tip), kn = kneesOf(rig);
    out.push({
      blade: { id: b.id, pose, race: b.look.race, reverse: b.setup.reverse, ...bl },
      knee: { race: b.look.race, pose, kneeOutMm: kn.out, kneeFwdMm: kn.fwd },
      slideMm: 1000 * slide, soleTiltDeg: tilt,
    });
  }
  plantStart = [null, null];
  return out;
}

/** Skeleton.drive with every channel the Animator outputs (the Engine's call, plus any newer channel the Skeleton accepts). */
export function driveSkeleton(sk: Skeleton, o: ReturnType<Animator["update"]>): void {
  const x = o as unknown as { kneeOut?: Float64Array };
  (sk.drive as (...a: unknown[]) => void).call(sk, o.angles, o.hipRoll, o.ankleRoll, o.toeOut, x.kneeOut);
}

/** The Creator preview of a profile with this weapon type (PreviewScene.#render, one idle second). */
export function previewSample(weaponType: string | undefined, race: string, className = "Warrior"): PoseSample {
  const look = LOOKS[race];
  const profile: CharacterProfile = {
    name: "Aldric Vey", race: look.race, subrace: look.subrace, className: className as CharacterProfile["className"],
    appearance: { body: look.body, accent: look.accent, height: look.height, weight: look.weight, hair: look.hair, eyes: look.eyes, beard: false, moustache: false },
    palette: look.body, birthsign: null, level: 1, allocated: {}, weaponType,
  };
  const { rig, fighter } = buildPreviewRig(profile);
  for (let i = 0; i < 30; i++) { fighter.skeleton.update(0.05 * 0.5); rig.update(fighter.skeleton, 0.05); }
  rig.group.updateMatrixWorld(true);
  const spec = fighter.weaponSpec;
  let tipLen = 0.6;
  if (spec) {
    const head = (b: string) => rig.plan.bones.find((x) => x.id === b)!.head;
    tipLen = swingSetupFor(spec, armGeometry(head("shoulderR"), head("elbowR"), rig.plan.arms[1].grip)).tip;
  }
  const bl = bladeOf(rig, tipLen), kn = kneesOf(rig);
  const id = spec?.archetype ?? `classic:${weaponType ?? className}`;
  return {
    blade: { id, pose: "preview", race, reverse: spec ? spec.grips.length > 0 && rig.weaponNode.rotation.x !== 0 && Math.abs(rig.weaponNode.rotation.x) > 1 : false, ...bl },
    knee: { race, pose: "preview", kneeOutMm: kn.out, kneeFwdMm: kn.fwd }, slideMm: 0, soleTiltDeg: 0,
  };
}

/** The worst (most backward) sample of a run. */
export function worstBlade(s: PoseSample[]): BladeSample {
  return s.reduce((a, b) => b.blade.fwd < a.blade.fwd ? b : a).blade;
}
/** Mean knee lateral offset over a run, mm [L, R]. */
export function meanKnee(s: PoseSample[]): [number, number] {
  const m: [number, number] = [0, 0];
  for (const x of s) { m[0] += x.knee.kneeOutMm[0] / s.length; m[1] += x.knee.kneeOutMm[1] / s.length; }
  return m;
}
