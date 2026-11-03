// Wave GEN (C-AGI, lane K): the animation audit. Every clip the game plays x 4 races x 2 sexes, on lane
// A's REAL skinned rig (no browser), posed in the ENGINE's frame order (Engine.#swingTick ->
// #updatePose -> rig loop -> #strikeTick):
//   SwingDriver.advance/takeStep -> Animator.update (attackPose / attackDrive / block / engaged / skill /
//   fall / shove) -> bodyShift -> Skeleton.drive(.., wideLimits) -> rig.update -> forearm supination ->
//   grip (swing wrist blended with a skill's stance grip) -> placement (lateral + forward offsets, hop,
//   rotation.set(0, yaw, roll), applyRootTilt) -> two-hand grip (not while a fall owns the body) ->
//   settleOnFloor (groundBody) -> ArmGuard.solve + off-hand re-seat (not while a fall owns the body).
// The opponent stands still ahead (at the swing's sweet distance for strikes); no contact is resolved
// (a whiff): the swing plays its full curve, the worst case for the blade passing near the holder.
//
// Metrics per run (60 Hz):
//   popJoint     largest |Δ| of a Skeleton joint angle in one frame, rad (+ joint)
//   popBone      largest rotation of a rig bone's LOCAL quaternion in one frame, rad (+ bone): includes
//                every render-side edit (knee-out, toe-out, forearm twist, ArmGuard, off hand)
//   slideMm      largest planted-ball drift within one stance (AnimatorOutput.feet[i].planted), mm
//   floorMm      lowest skin point - floor over the run (stride-sampled skin, after the settle), mm
//                (negative = the skin sinks into the floor)
//   soleMm       lowest sole point (heel/ball/toe) - floor, mm
//   foreTorsoMm  forearm/hand capsules into chest/abdomen/pelvis capsules (fitted combat hitboxes),
//                penetration BEYOND the same body's standing idle, mm
//   thighMm      left thigh capsules into right thigh capsules beyond standing idle, mm
//   weaponMm     the weapon's features into the holder's own capsules after the engine's ArmGuard
//                (SelfGuard.selfPenetration; gripping hand/forearm excluded), mm; weaponRawMm before it
// Balance (idle / guard / walk mid-stance): BalanceDisk.balanceDisk with the hitbox capsules as mass
// and the loaded soles as support; margin mm (+ inside). Walk also reports Hof's XCoM margin.
//
//   deno run -A tools/audit-animations.ts --out artifacts/wave-gen/anim-audit-before.json [--bodies human,elfF] [--clips idle,swing:axe] [--agility 1000]
//   deno run -A tools/audit-animations.ts --doc before.json after.json      (markdown tables, generated)
// @deno-types="@types/three"
import * as THREE from "three";
import { applyRootTilt, buildSkinnedHumanoid, settleOnFloor, skinClearance } from "../src/graphics/body/SkinnedHumanoid.ts";
import { defaultHumanoid, type JointName, type Skeleton } from "../src/game/Skeleton.ts";
import { JOINT_ORDER, legGeometryFromBones, limitTableFrom } from "../src/game/anim/Rig.ts";
import { Animator, type AnimFallInput, type AnimShoveInput } from "../src/game/anim/Animator.ts";
import { motionStyleFor, weaponMotionFromSpec } from "../src/game/anim/MotionStyle.ts";
import { createFighter } from "../src/game/Fighter.ts";
import { armGeometry } from "../src/game/anim/Swing.ts";
import { applyForearmTwist, ArmGuard, boneWorldOf, weaponMatrix } from "../src/combat/RigAdapter.ts";
import { skillGripPitch, SwingDriver, type SwingSetup, swingSetupFor } from "../src/combat/SwingDriver.ts";
import { measureAimLine } from "../src/combat/SwingRig.ts";
import { applyOffHandGrip, applyTwoHandGrip } from "../src/combat/OffHand.ts";
import { cloneHitboxSet, hitboxesFromPlan, updateHitboxes } from "../src/combat/Hitboxes.ts";
import { selfPenetration } from "../src/combat/SelfGuard.ts";
import { segSeg } from "../src/combat/Geom.ts";
import { weaponFromSeed } from "../src/game/weapons/Generate.ts";
import { toGeneratedWeapon } from "../src/game/weapons/Adapter.ts";
import { ARCHETYPE_IDS } from "../src/game/weapons/Archetypes.ts";
import { ALL_SKILLS } from "../src/game/Skills.ts";
import { hopAt, lungeAt } from "../src/game/AnimationCurve.ts";
import { damp, lerp, wrapAngle } from "../src/core/MathCore.ts";
import { balanceDisk, lateralXcomMargin, type V2 } from "../src/game/anim/BalanceDisk.ts";
import { totalTravel } from "../src/game/anim/AgilityLimits.ts";
import type { ArchetypeId, Hitbox, HitboxSet, WeaponSpec } from "../src/combat/contracts.ts";
import type { Appearance } from "../src/game/Characters.ts";

export const BODIES: Record<string, Appearance> = {
  human: { body: "#ef7455", accent: "#dfaa55", height: 1.7, weight: 72, hair: "#3a2a1a", eyes: "#2f6fb5", race: "human", subrace: null, sex: "male" },
  humanF: { body: "#ef7455", accent: "#dfaa55", height: 1.64, weight: 60, hair: "#3a2a1a", eyes: "#2f6fb5", race: "human", subrace: null, sex: "female" },
  elf: { body: "#82b970", accent: "#a9ce7c", height: 1.77, weight: 60, hair: "#d8b87a", eyes: "#a9ce7c", race: "elf", subrace: "wood", sex: "male" },
  elfF: { body: "#82b970", accent: "#a9ce7c", height: 1.72, weight: 54, hair: "#d8b87a", eyes: "#a9ce7c", race: "elf", subrace: "wood", sex: "female" },
  dwarf: { body: "#9b72cf", accent: "#dfaa55", height: 1.39, weight: 70, hair: "#a87a4a", eyes: "#172128", race: "dwarf", subrace: "mountain", sex: "male" },
  dwarfF: { body: "#9b72cf", accent: "#dfaa55", height: 1.34, weight: 62, hair: "#a87a4a", eyes: "#172128", race: "dwarf", subrace: "mountain", sex: "female" },
  ork: { body: "#4f8490", accent: "#172128", height: 1.95, weight: 120, hair: "#172128", eyes: "#172128", race: "ork", subrace: "ironhide", sex: "male" },
  orkF: { body: "#4f8490", accent: "#172128", height: 1.86, weight: 100, hair: "#172128", eyes: "#172128", race: "ork", subrace: "ironhide", sex: "female" },
} as Record<string, Appearance>;

/** Offender thresholds (a run above any one is listed; severity = worst ratio to its threshold). */
export const THRESHOLDS = {
  /**
   * rad / frame at 60 Hz: just above the Animator's own joint-speed limit (PoseBlender.maxJointSpeed =
   * π/2 · widest range / minSwingTime ≈ 23.6 rad/s = 0.393 rad per frame for every body), which the fastest
   * strikes reach BY DESIGN; anything faster is a pop the limiter did not see (a render-side edit, a solver flip).
   */
  popRad: 0.4,
  slideMm: 20, floorMm: -10, foreTorsoMm: 10, thighMm: 10, weaponMm: 10,
} as const;

/** The carry of the self-intersection baseline run (one-handed: the arms hang clear of the torso). */
export const BASELINE_CARRY: ArchetypeId = "dagger";

/** QA: print every frame over the pop threshold (stderr). */
export const TRACE = { on: false };

/** The default weapon every non-swing clip carries (two-handed: the off hand is exercised too). */
export const DEFAULT_ARCHETYPE: ArchetypeId = "longsword";

const HZ = 60, DT = 1 / HZ, ACCEL = 6.5 / 0.12, PI = Math.PI, SKILL_GRIP_RATE = 18;
const ground = () => 0;
const V = new THREE.Vector3();

// ─── Clips ────────────────────────────────────────────────────────────────────────────────────────
export interface Seg {
  dur: number; tag: string; speed?: number; dir?: number; engaged?: boolean; block?: boolean; orbit?: number;
  swing?: boolean; skill?: string;
  fall?: { phase: AnimFallInput["phase"]; pose: AnimFallInput["pose"]; dir: [number, number] };
  shove?: { phase: AnimShoveInput["phase"]; dir: [number, number]; magnitude01: number };
  vel?: [number, number]; velAt?: (u: number) => [number, number];
}
export interface Clip { id: string; kind: string; archetype: ArchetypeId; segs: Seg[]; /** Only these tags are measured (the lead-in settles). */ measure: string[] }

function fallSegs(pose: "back" | "front" | "side"): Seg[] {
  const dir: [number, number] = pose === "back" ? [0, -1] : pose === "front" ? [0, 1] : [1, 0];
  return [
    { dur: 0.6, tag: "stand", engaged: true },
    { dur: 0.35, tag: "fall", fall: { phase: "stagger", pose, dir }, vel: [dir[0] * 0.8, dir[1] * 0.8], engaged: true },
    { dur: 0.5, tag: "fall", fall: { phase: "falling", pose, dir }, vel: [dir[0] * 0.3, dir[1] * 0.3], engaged: true },
    { dur: 0.8, tag: "lie", fall: { phase: "down", pose, dir }, engaged: true },
    { dur: 1.3, tag: "rise", fall: { phase: "rising", pose, dir }, engaged: true },
    { dur: 1.0, tag: "rise", engaged: true },
  ];
}

/** Every clip the game plays (one entry per measured tag group). */
export function allClips(carry: ArchetypeId = DEFAULT_ARCHETYPE): Clip[] {
  const A = carry, c: Clip[] = [];
  const loco = (id: string, kind: string, segs: Seg[]) => c.push({ id, kind, archetype: A, segs, measure: ["x"] });
  loco("idle", "stand", [{ dur: 0.6, tag: "lead" }, { dur: 1.5, tag: "x" }]);
  loco("guard", "stand", [{ dur: 1.0, tag: "lead", engaged: true }, { dur: 1.5, tag: "x", engaged: true }]);
  loco("block", "stand", [{ dur: 0.6, tag: "lead", engaged: true }, { dur: 1.2, tag: "x", engaged: true, block: true }, { dur: 0.6, tag: "x", engaged: true }]);
  loco("walk", "move", [{ dur: 0.4, tag: "lead" }, { dur: 2.5, tag: "x", speed: 2.1 }]);
  loco("run", "move", [{ dur: 0.4, tag: "lead" }, { dur: 2, tag: "x", speed: 6.5 }]);
  loco("strafe", "move", [{ dur: 0.4, tag: "lead", engaged: true }, { dur: 2, tag: "x", speed: 6.5, dir: PI / 2, engaged: true }]);
  loco("backpedal", "move", [{ dur: 0.4, tag: "lead", engaged: true }, { dur: 2, tag: "x", speed: 6.5, dir: PI, engaged: true }]);
  loco("turn", "move", [{ dur: 0.3, tag: "lead" }, { dur: 1.5, tag: "x", orbit: 2 }]);
  for (const a of ARCHETYPE_IDS) {
    c.push({ id: `swing:${a}`, kind: "swing", archetype: a, segs: [{ dur: 0.5, tag: "lead", engaged: true }, { dur: 2.4, tag: "x", engaged: true, swing: true }], measure: ["x"] });
  }
  for (const s of ALL_SKILLS) {
    const kind = s.kind === "power" ? "cast" : s.kind;
    c.push({ id: `${kind}:${s.id}`, kind, archetype: A, segs: [{ dur: 0.4, tag: "lead", engaged: true }, { dur: s.animation.duration + 0.5, tag: "x", engaged: true, skill: s.id }], measure: ["x"] });
  }
  const back: [number, number] = [0, -1];
  c.push({
    id: "shove", kind: "react", archetype: A, measure: ["x"], segs: [
      { dur: 0.6, tag: "lead", engaged: true }, { dur: 0.15, tag: "x", shove: { phase: "brace", dir: back, magnitude01: 0.8 }, engaged: true },
      { dur: 0.08, tag: "x", shove: { phase: "impact", dir: back, magnitude01: 0.8 }, engaged: true },
      { dur: 0.5, tag: "x", shove: { phase: "recoil", dir: back, magnitude01: 0.8 }, velAt: (u) => [0, -(0.36 / 0.5) * 2 * (1 - u)], engaged: true },
      { dur: 1.0, tag: "x", engaged: true },
    ],
  });
  for (const k of ["stagger", "stumble"] as const) {
    const dir: [number, number] = k === "stagger" ? [0, -1] : [0, 1], v = k === "stagger" ? 1.0 : 0.8, D = k === "stagger" ? 0.8 : 0.6;
    c.push({
      id: k, kind: "react", archetype: A, measure: ["x"], segs: [
        { dur: 0.6, tag: "lead", engaged: true },
        { dur: D, tag: "x", fall: { phase: k, pose: "back", dir }, velAt: (u) => [0, dir[1] * v * 2 * (1 - u)], engaged: true },
        { dur: 1.0, tag: "x", engaged: true },
      ],
    });
  }
  for (const p of ["back", "front", "side"] as const) c.push({ id: `fall:${p}`, kind: "fall", archetype: A, segs: fallSegs(p), measure: ["fall", "lie", "rise"] });
  return c;
}

// ─── Bench ────────────────────────────────────────────────────────────────────────────────────────
type Rig = ReturnType<typeof buildSkinnedHumanoid>;
interface RigEntry { rig: Rig; spec: WeaponSpec; setup: SwingSetup; boxes: HitboxSet; guard: ArmGuard; soles: { bone: THREE.Bone; local: THREE.Vector3; side: number; kind: number }[] }
const BODY_BOXES = new Map<string, HitboxSet>();

function rigFor(body: string, arch: ArchetypeId, cache: Map<string, RigEntry>): RigEntry {
  const key = `${body}|${arch}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const look = BODIES[body], spec = weaponFromSeed(arch, 7);
  const rig = buildSkinnedHumanoid(toGeneratedWeapon(spec), look, "fire", undefined, { paint: false, weaponSpec: spec });
  if (!BODY_BOXES.has(body)) BODY_BOXES.set(body, hitboxesFromPlan(rig.plan));
  const boxes = cloneHitboxSet(BODY_BOXES.get(body)!);
  // Sole points from the BIND bones (before anything poses the rig), as lane A's fixtures do.
  rig.group.updateMatrixWorld(true);
  const soles: RigEntry["soles"] = [];
  const P = rig.plan, w = P.proportions.radius.footHalfWidth;
  P.legs.forEach((leg, i) => {
    const s = i === 0 ? "L" : "R";
    const heelZ = leg.heelBack[2] + 0.09 * P.proportions.foot;
    const pts: [string, number[]][] = [
      [`ankle${s}`, [leg.ankle[0] + 0.6 * w, 0, heelZ]], [`ankle${s}`, [leg.ankle[0] - 0.6 * w, 0, heelZ]],
      [`ankle${s}`, [leg.ball[0] + 0.7 * w, 0, leg.ball[2]]], [`ankle${s}`, [leg.ball[0] - 0.7 * w, 0, leg.ball[2]]],
      [`toe${s}`, [leg.toeTip[0], 0, leg.toeTip[2] - 0.04 * P.proportions.foot]],
    ];
    pts.forEach(([id, p], kind) => {
      const bone = rig.bones.get(id as never)!;
      soles.push({ bone, local: new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(bone.matrixWorld.clone().invert()), side: i, kind });
    });
  });
  const head = (b: string) => rig.plan.bones.find((x) => x.id === b)!.head;
  const setup = swingSetupFor(spec, armGeometry(head("shoulderR"), head("elbowR"), rig.plan.arms[1].grip));
  setup.aimLine = measureAimLine(rig, defaultHumanoid(), setup);
  const guard = new ArmGuard(rig, boxes, spec);
  const e: RigEntry = { rig, spec, setup, boxes, guard, soles };
  cache.set(key, e);
  return e;
}

/** Capsule-pair penetration (m, > 0 = overlapping): max over the pairs of the two box groups. */
function pairDepth(A: Hitbox[], B: Hitbox[]): number {
  let worst = -Infinity;
  for (const a of A) for (const b of B) {
    const d = Math.sqrt(segSeg(a.wa[0], a.wa[1], a.wa[2], a.wb[0], a.wb[1], a.wb[2], b.wa[0], b.wa[1], b.wa[2], b.wb[0], b.wb[1], b.wb[2]));
    worst = Math.max(worst, a.radius + b.radius - d);
  }
  return worst;
}
function groups(boxes: HitboxSet) {
  const z = (zs: string[], side?: string) => boxes.boxes.filter((b) => zs.includes(b.zone) && (!side || b.side === side));
  return {
    foreL: z(["foreArm", "hand"], "L"), foreR: z(["foreArm", "hand"], "R"), torso: z(["chest", "abdomen", "pelvis"]),
    thighL: z(["thigh"], "L"), thighR: z(["thigh"], "R"),
  };
}

export interface RunResult {
  body: string; race: string; sex: string; clip: string; kind: string; tag: string; archetype: string; frames: number;
  popJoint: number; popJointName: string; popBone: number; popBoneName: string; popAt: number;
  slideMm: number; floorMm: number; soleMm: number;
  foreTorsoMm: number; foreTorsoRawMm: number; foreTorsoSide: string; thighMm: number; thighRawMm: number;
  weaponMm: number; weaponRawMm: number; weaponAt: number; weaponBox: string;
  severity: number; offences: string[];
}
export interface BalanceResult {
  body: string; race: string; sex: string; stance: string;
  /** Static margin (CoM over the support polygon), mm: idle/guard over DOUBLE-support frames; walk at mid-stance. */
  marginMm: number;
  /** Walk only: Hof's mediolateral XCoM margin at mid-stance, mm (+ = inside the stance foot's lateral edge). */
  xcomMm: number | null;
  frames: number;
  /** idle/guard: share of the measured frames in double support. */
  doubleShare?: number;
}

interface Baseline { foreTorso: number; thigh: number }

/** Drive one clip on one body; returns one result per measured tag (+ balance samples for stances). */
export function runClip(body: string, clip: Clip, cache: Map<string, RigEntry>, base: Baseline | null, agility: number | null, reach?: Map<JointName, [number, number]>): { runs: RunResult[]; balance: BalanceResult[]; idle: Baseline } {
  const look = BODIES[body] as Appearance & { race: string; subrace: string | null }, E = rigFor(body, clip.archetype, cache), { rig, setup, boxes, guard, spec } = E;
  const sk: Skeleton = defaultHumanoid(agility);
  const ankleY = rig.plan.bones.find((x) => x.id === "ankleL")!.head[1];
  const geo = legGeometryFromBones(rig.plan.bones, ankleY, 1);
  const an = new Animator(geo, limitTableFrom(sk.limits()));
  const drv = new SwingDriver(setup, limitTableFrom(sk.limits()));
  let seed = 0;
  for (const ch of `${look.race}/${look.subrace}`) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const style = motionStyleFor({
    race: look.race, subrace: look.subrace, seed,
    body: { geometry: geo, height: look.height, weight: look.weight },
    weapon: weaponMotionFromSpec(spec, setup.kind), stats: createFighter("Warrior", look.race, 0, 0, 0.5, look.race, look.subrace).stats,
  });
  style.setLiveImmediate({ hpFrac: 1, staminaFrac: 1, manaFrac: 1, exhausted: false });
  an.setStyle(style); drv.setStyle(style);
  const G = groups(boxes), bw = boneWorldOf(rig);
  const bones = [...rig.bones.entries()];
  const lastQ = bones.map(() => new THREE.Quaternion());
  const b = { x: 0, z: 0, vx: 0, vz: 0 }, prev = { x: 0, z: 0, yaw: 0 };
  let ox = 0, oz = 1000, ang = 0, t = 0, first = true, skillPrev = 0, skillGrip = 0;
  let lastA: Float64Array | null = null;
  const acc = new Map<string, RunResult & { stanceStart: (number[] | null)[] }>();
  const bal: { stance: string; margin: number; xcom: number | null }[] = [];
  const idle: Baseline = { foreTorso: -Infinity, thigh: -Infinity };
  let lastCom: number[] | null = null;
  const single: { side: number; frames: { margin: number; xcom: number }[] }[] = [];
  for (const seg of clip.segs) {
    const n = Math.max(1, Math.round(seg.dur * HZ));
    if (seg.swing) { oz = b.z + setup.sweet; ox = b.x; drv.begin(setup.sweet, 0, 0, 0); }
    if (seg.skill) { const s = ALL_SKILLS.find((x) => x.id === seg.skill)!; sk.playSkill(s.animation); skillPrev = 0; }
    for (let k = 0; k < n; k++) {
      t += DT;
      const u = (k + 1) / n;
      // Engine.#swingTick: advance the swing, step toward the target.
      if (drv.active) {
        drv.advance(DT);
        const step = drv.takeStep();
        if (step !== 0) { const dx = ox - b.x, dz = oz - b.z, d = Math.hypot(dx, dz) || 1; b.x += (dx / d) * step; b.z += (dz / d) * step; }
      }
      if (seg.orbit) { ang += seg.orbit * DT; ox = b.x + 3 * Math.sin(ang); oz = b.z + 3 * Math.cos(ang); }
      // Body motion: commanded speed (accelerated like the keyboard), scripted velocity, skill lunge.
      const yaw0 = Math.atan2(ox - b.x, oz - b.z);
      if (seg.vel || seg.velAt) {
        const v = seg.velAt ? seg.velAt(u) : seg.vel!;
        b.x += v[0] * DT; b.z += v[1] * DT;
      } else {
        const sp = seg.speed ?? 0, md = yaw0 + (seg.dir ?? 0), tx = sp * Math.sin(md) - b.vx, tz = sp * Math.cos(md) - b.vz;
        const dv = Math.hypot(tx, tz), s = dv > ACCEL * DT ? ACCEL * DT / dv : 1;
        b.vx += tx * s; b.vz += tz * s; b.x += b.vx * DT; b.z += b.vz * DT;
      }
      const anim = sk.skillAnimation();
      if (anim) {
        const tp = Math.min(1, sk.skillProgress() ?? 1), gain = lungeAt(anim, tp) - lungeAt(anim, skillPrev);
        skillPrev = tp; b.x += gain * Math.sin(yaw0); b.z += gain * Math.cos(yaw0);
      }
      const yaw = Math.atan2(ox - b.x, oz - b.z) + (drv.active ? drv.yaw() : 0);
      if (first) { prev.x = b.x; prev.z = b.z; prev.yaw = yaw; }
      const dx = b.x - prev.x, dz = b.z - prev.z, speed = Math.hypot(dx, dz) / DT;
      const fall = seg.fall ? { phase: seg.fall.phase, t01: u, dir: seg.fall.dir, pose: seg.fall.pose } : null;
      const shove = seg.shove ? { phase: seg.shove.phase, t01: u, dir: seg.shove.dir, magnitude01: seg.shove.magnitude01 } : null;
      const o = an.update(DT, {
        x: b.x, z: b.z, yaw, rootY: 0, speed, moveDirLocal: speed > 1e-3 ? wrapAngle(Math.atan2(dx, dz) - yaw) : 0,
        turnRate: wrapAngle(yaw - prev.yaw) / DT, grounded: true, hit: false,
        attack: drv.active, attackPose: drv.active ? drv.attackPose() : null, attackDrive: drv.active ? drv.legDrive() : 0,
        block: !!seg.block, ko: false, engaged: !!seg.engaged,
        skill: sk.skillAnimation(), skillProgress: sk.skillProgress() ?? 0, groundHeight: ground, externalRoll: 0,
        honoursYawOffset: true, fall, shove,
      });
      b.x += o.bodyShift[0]; b.z += o.bodyShift[1];
      prev.x = b.x; prev.z = b.z; prev.yaw = yaw;
      sk.drive(o.angles, o.hipRoll, o.ankleRoll, o.toeOut, undefined, o.wideLimits);
      rig.update(sk, DT);
      applyForearmTwist(rig, sk.joint("elbowR").angle, setup.twist);
      skillGrip = damp(skillGrip, sk.skillHeld() ? 1 : 0, SKILL_GRIP_RATE, DT);
      const own = drv.wristPitch(sk.joint("spine").angle, sk.joint("shoulderR").angle, sk.joint("elbowR").angle);
      const ge = drv.gripEulerOf(lerp(own, skillGripPitch(sk.gripPose().pitch), skillGrip), lerp(drv.wristRoll(), 0, skillGrip));
      rig.setGrip(ge[0], ge[1]);
      rig.weaponNode.position.y = -drv.chokeOffset();
      const a2 = sk.skillAnimation(), hop = a2 ? hopAt(a2, Math.min(1, sk.skillProgress() ?? 1)) : 0;
      const yn = yaw + o.yawOffset, fwd = o.rootOffsetForward ?? 0;
      rig.group.position.set(b.x + o.rootOffsetLateral * Math.cos(yn) + fwd * Math.sin(yn), hop + o.rootOffsetY, b.z - o.rootOffsetLateral * Math.sin(yn) + fwd * Math.cos(yn));
      rig.group.rotation.set(0, yn, o.rootRoll);
      if (o.rootTilt) applyRootTilt(rig.group, o.rootTilt);
      const fallOwns = o.fallWeight > 0;
      let two: ReturnType<typeof applyTwoHandGrip> = null, reseat: ReturnType<typeof applyOffHandGrip> = null;
      if (setup.offHand && !fallOwns) { rig.group.updateMatrixWorld(true); two = applyTwoHandGrip(rig, sk.joint("shoulderR").angle, setup.offHand, drv.chokeOffset()); }
      if ((o.groundBody ?? 0) > 0) settleOnFloor(rig, ground, o.groundBody);
      rig.group.updateMatrixWorld(true);
      updateHitboxes(boxes, bw);
      const weaponRaw = selfPenetration({ matrix: weaponMatrix(rig), time: t }, boxes, spec).depth;
      if (!fallOwns) {
        guard.solve(sk);
        if (setup.offHand) reseat = applyOffHandGrip(rig, setup.offHand, drv.chokeOffset());
        rig.group.updateMatrixWorld(true);
        updateHitboxes(boxes, bw);
      }
      first = false;
      if (!clip.measure.includes(seg.tag)) { lastA = null; for (let i = 0; i < bones.length; i++) lastQ[i].copy(bones[i][1].quaternion); continue; }
      // ── measure ──
      const pen = selfPenetration({ matrix: weaponMatrix(rig), time: t }, boxes, spec);
      const A = Float64Array.from(JOINT_ORDER.map((j) => sk.joint(j).angle));
      if (reach) JOINT_ORDER.forEach((j, i) => { const r = reach.get(j) ?? [Infinity, -Infinity]; r[0] = Math.min(r[0], A[i]); r[1] = Math.max(r[1], A[i]); reach.set(j, r); });
      let popJ = 0, popJN = "";
      if (lastA) for (let j = 0; j < A.length; j++) { const d = Math.abs(A[j] - lastA[j]); if (d > popJ) { popJ = d; popJN = JOINT_ORDER[j]; } }
      let popB = 0, popBN = "";
      for (let i = 0; i < bones.length; i++) {
        const q = bones[i][1].quaternion;
        if (lastA) { const d = 2 * Math.acos(Math.min(1, Math.abs(q.dot(lastQ[i])))); if (d > popB) { popB = d; popBN = bones[i][0]; } }
        lastQ[i].copy(q);
      }
      lastA = A;
      const sole: number[][] = [[0, 0], [0, 0]], soleMin = [Infinity, Infinity], pts: V2[][] = [[], []];
      for (const sp of E.soles) {
        V.copy(sp.local).applyMatrix4(sp.bone.matrixWorld);
        soleMin[sp.side] = Math.min(soleMin[sp.side], V.y);
        pts[sp.side].push([V.x, V.z]);
        if (sp.kind === 2 || sp.kind === 3) { sole[sp.side][0] += V.x / 2; sole[sp.side][1] += V.z / 2; }
      }
      const skin = skinClearance(rig, ground, 6).clearance;
      const ftL = pairDepth(G.foreL, G.torso), ftR = pairDepth(G.foreR, G.torso), ft = Math.max(ftL, ftR), th = pairDepth(G.thighL, G.thighR);
      if (clip.id === "idle") { idle.foreTorso = Math.max(idle.foreTorso, ft); idle.thigh = Math.max(idle.thigh, th); }
      let r0 = acc.get(seg.tag);
      if (!r0) {
        r0 = {
          body, race: look.race, sex: look.sex ?? "male", clip: clip.id, kind: clip.kind, tag: seg.tag, archetype: clip.archetype, frames: 0,
          popJoint: 0, popJointName: "", popBone: 0, popBoneName: "", popAt: 0, slideMm: 0, floorMm: Infinity, soleMm: Infinity,
          foreTorsoMm: 0, foreTorsoRawMm: -Infinity, foreTorsoSide: "", thighMm: 0, thighRawMm: -Infinity, weaponMm: 0, weaponRawMm: 0, weaponAt: 0, weaponBox: "",
          severity: 0, offences: [], stanceStart: [null, null],
        };
        acc.set(seg.tag, r0);
      }
      const r = r0;
      r.frames++;
      if (TRACE.on && (popB > THRESHOLDS.popRad || popJ > THRESHOLDS.popRad)) {
        const f3 = (x: Record<string, unknown> | null) => x ? Object.entries(x).map(([k, v]) => `${k}=${typeof v === "number" ? v.toFixed(3) : v}`).join(" ") : "null";
        console.error(`   two: ${f3(two as never)} | reseat: ${f3(reseat as never)}`);
        const eL = rig.bones.get("elbowL" as never)!.quaternion, sL = rig.bones.get("shoulderL" as never)!.quaternion;
        console.error(`   elbowL q ${eL.toArray().map((v) => v.toFixed(3)).join(",")} shoulderL q ${sL.toArray().map((v) => v.toFixed(3)).join(",")} sk elbowR ${sk.joint("elbowR").angle.toFixed(3)} shoulderR ${sk.joint("shoulderR").angle.toFixed(3)} o.elbowR ${o.angles[JOINT_ORDER.indexOf("elbowR")].toFixed(3)}`);
        console.error(`TRACE ${body} ${clip.id}/${seg.tag} t=${t.toFixed(3)} joint ${popJN} ${popJ.toFixed(3)} bone ${popBN} ${popB.toFixed(3)} fallW ${o.fallWeight.toFixed(2)} skill ${!!sk.skillAnimation()} drv ${drv.active}`);
      }
      if (popJ > r.popJoint) { r.popJoint = popJ; r.popJointName = popJN; r.popAt = t; }
      if (popB > r.popBone) { r.popBone = popB; r.popBoneName = popBN; }
      for (let i = 0; i < 2; i++) {
        if (o.feet[i].planted) {
          if (!r.stanceStart[i]) r.stanceStart[i] = sole[i].slice();
          const sl = 1000 * Math.hypot(sole[i][0] - r.stanceStart[i]![0], sole[i][1] - r.stanceStart[i]![1]);
          if (TRACE.on && sl > THRESHOLDS.slideMm) console.error(`SLIDE ${body} ${clip.id}/${seg.tag} t=${t.toFixed(3)} foot ${i} ${sl.toFixed(1)} mm fallW ${o.fallWeight.toFixed(2)} phase ${seg.fall?.phase ?? "-"} u=${u.toFixed(2)} contact ${Array.from(an.fallDebug.contact).map((x) => x.toFixed(1)).join(",")}`);
          r.slideMm = Math.max(r.slideMm, sl);
        } else r.stanceStart[i] = null;
      }
      r.floorMm = Math.min(r.floorMm, 1000 * skin);
      r.soleMm = Math.min(r.soleMm, 1000 * Math.min(soleMin[0], soleMin[1]));
      r.foreTorsoRawMm = Math.max(r.foreTorsoRawMm, 1000 * ft);
      r.thighRawMm = Math.max(r.thighRawMm, 1000 * th);
      const bl = base ?? idle;
      if (1000 * (ft - Math.max(0, bl.foreTorso)) > r.foreTorsoMm) { r.foreTorsoMm = 1000 * (ft - Math.max(0, bl.foreTorso)); r.foreTorsoSide = ftL >= ftR ? "L" : "R"; }
      r.thighMm = Math.max(r.thighMm, 1000 * (th - Math.max(0, bl.thigh)));
      r.weaponRawMm = Math.max(r.weaponRawMm, 1000 * weaponRaw);
      if (1000 * pen.depth > r.weaponMm) { r.weaponMm = 1000 * pen.depth; r.weaponAt = t; r.weaponBox = pen.hitbox ? `${pen.hitbox.zone}${pen.hitbox.side}` : ""; }
      // Balance disk (idle / guard / walk): CoM of the capsules over the loaded soles.
      if (clip.id === "idle" || clip.id === "guard" || clip.id === "walk") {
        const loaded = [0, 1].filter((i) => o.feet[i].planted);
        const support = loaded.flatMap((i) => pts[i]);
        const disk = balanceDisk(boxes.boxes, support);
        const vel: V2 = lastCom ? [(disk.com[0] - lastCom[0]) / DT, (disk.com[2] - lastCom[2]) / DT] : [0, 0];
        lastCom = disk.com;
        // A standing stance is judged on its DOUBLE-support frames (a re-plant step is a walk, not a stance).
        if (clip.id !== "walk") bal.push({ stance: clip.id, margin: loaded.length === 2 ? disk.margin : Number.NaN, xcom: null });
        else if (loaded.length === 1 && seg.speed) {
          const side = loaded[0];
          let cur = single[single.length - 1];
          if (!cur || cur.side !== side) { cur = { side, frames: [] }; single.push(cur); }
          // Hof's MEDIOLATERAL margin of stability: the XCoM inside the stance foot's lateral edge (body frame).
          cur.frames.push({ margin: disk.margin, xcom: lateralXcomMargin(disk.com, vel, support, yaw, side as 0 | 1) });
        } else if (single.length && single[single.length - 1].side >= 0) single.push({ side: -1, frames: [] });
      }
    }
  }
  const runs: RunResult[] = [];
  for (const r of acc.values()) {
    const { stanceStart: _s, ...res } = r;
    classify(res);
    runs.push(res);
  }
  const balance: BalanceResult[] = [];
  const sex = look.sex ?? "male";
  for (const st of ["idle", "guard"]) {
    const xs = bal.filter((x) => x.stance === st), dbl = xs.filter((x) => !Number.isNaN(x.margin));
    if (dbl.length) balance.push({ body, race: look.race, sex, stance: st, marginMm: 1000 * Math.min(...dbl.map((x) => x.margin)), xcomMm: null, frames: dbl.length, doubleShare: dbl.length / xs.length });
  }
  // Walk mid-stance: the middle frame of each complete single-support interval (not the first / last).
  const mids = single.filter((s) => s.side >= 0 && s.frames.length >= 4).slice(1, -1).map((s) => s.frames[Math.floor(s.frames.length / 2)]);
  if (mids.length) balance.push({ body, race: look.race, sex, stance: "walk-midstance", marginMm: 1000 * Math.min(...mids.map((m) => m.margin)), xcomMm: 1000 * Math.min(...mids.map((m) => m.xcom)), frames: mids.length });
  return { runs, balance, idle };
}

/** Offences and severity (worst ratio to its threshold) of one run, from its metrics (in place). */
export function classify(res: RunResult): RunResult {
  const T = THRESHOLDS, off: string[] = [];
  const ratio = {
    pop: Math.max(res.popJoint, res.popBone) / T.popRad, slide: res.slideMm / T.slideMm, floor: res.floorMm < 0 ? res.floorMm / T.floorMm : 0,
    foreTorso: res.foreTorsoMm / T.foreTorsoMm, thigh: res.thighMm / T.thighMm, weapon: res.weaponMm / T.weaponMm,
  };
  for (const [k, v] of Object.entries(ratio)) if (v > 1) off.push(k);
  res.severity = Math.max(0, ...Object.values(ratio));
  res.offences = off;
  return res;
}

export interface AuditReport {
  meta: { date: string; hz: number; agility: number | null; bodies: string[]; clips: number; thresholds: typeof THRESHOLDS; ms: number };
  runs: RunResult[]; balance: BalanceResult[];
  reach: Record<string, Record<string, [number, number]>>;
}

/** The whole audit (or a subset). */
export function audit(opts: { bodies?: string[]; clips?: string[]; agility?: number | null; log?: boolean; carry?: ArchetypeId } = {}): AuditReport {
  const t0 = performance.now();
  const bodies = opts.bodies ?? Object.keys(BODIES);
  let clips = allClips(opts.carry);
  if (opts.clips) clips = clips.filter((c) => opts.clips!.some((p) => c.id === p || c.id.startsWith(p + ":") || c.kind === p));
  const out: AuditReport = { meta: { date: new Date().toISOString(), hz: HZ, agility: opts.agility ?? null, bodies, clips: clips.length, thresholds: THRESHOLDS, ms: 0 }, runs: [], balance: [], reach: {} };
  for (const body of bodies) {
    const cache = new Map<string, RigEntry>(), reach = new Map<JointName, [number, number]>();
    // The self-intersection baseline is the BODY's own standing overlap (one-handed carry: no arm crosses
    // the torso), so a two-handed carry's arm in the belly counts.
    const base = runClip(body, allClips(BASELINE_CARRY).find((c) => c.id === "idle")!, cache, null, opts.agility ?? null).idle;
    for (const c of clips) {
      const res = runClip(body, c, cache, base, opts.agility ?? null, reach);
      out.runs.push(...res.runs);
      out.balance.push(...res.balance);
    }
    out.reach[body] = Object.fromEntries([...reach].map(([j, r]) => [j, [+r[0].toFixed(4), +r[1].toFixed(4)]]));
    if (opts.log) console.error(`${body}: ${clips.length} clips, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
  out.meta.ms = performance.now() - t0;
  return out;
}

/** Markdown: limit windows and the reached envelope per agility (generated from anim-agility.json). */
export function agilityTable(rep: { travel: Record<string, number>; windows: Record<string, Record<string, [number, number]>>; reach: Record<string, Record<string, Record<string, [number, number]>>> }): string {
  const L: string[] = [];
  const f = (r: [number, number] | undefined) => r ? `${r[0].toFixed(2)}..${r[1].toFixed(2)}` : "-";
  L.push(`Total travel of the limit table (sum of max - min, rad): agility 0 ${rep.travel["0"]} · 500 ${rep.travel["500"]} · 1000 ${rep.travel["1000"]}`, "");
  L.push(`| joint | window @0 | window @500 | window @1000 | reached @0 (all clips, worst body) | reached @500 | reached @1000 |`, `|---|---|---|---|---|---|---|`);
  const joints = Object.keys(rep.windows["500"]);
  const env = (a: string, j: string): [number, number] | undefined => {
    let lo = Infinity, hi = -Infinity;
    for (const b of Object.values(rep.reach[a] ?? {})) { const r = b[j]; if (r) { lo = Math.min(lo, r[0]); hi = Math.max(hi, r[1]); } }
    return Number.isFinite(lo) ? [lo, hi] : undefined;
  };
  for (const j of joints) L.push(`| ${j} | ${f(rep.windows["0"][j])} | ${f(rep.windows["500"][j])} | ${f(rep.windows["1000"][j])} | ${f(env("0", j))} | ${f(env("500", j))} | ${f(env("1000", j))} |`);
  const span = (a: string) => joints.reduce((s, j) => { const r = env(a, j); return s + (r ? r[1] - r[0] : 0); }, 0);
  L.push("", `Reached envelope summed over joints (rad): agility 0 ${span("0").toFixed(3)} · 500 ${span("500").toFixed(3)} · 1000 ${span("1000").toFixed(3)}`);
  return L.join("\n");
}

// ─── Report tables ────────────────────────────────────────────────────────────────────────────────
const METRICS: [keyof RunResult, string, (v: number) => string][] = [
  ["popJoint", "max joint Δ rad/frame", (v) => v.toFixed(3)], ["popBone", "max bone Δ rad/frame", (v) => v.toFixed(3)],
  ["slideMm", "planted slide mm", (v) => v.toFixed(1)], ["floorMm", "lowest skin mm", (v) => v.toFixed(1)],
  ["foreTorsoMm", "forearm→torso mm", (v) => v.toFixed(1)], ["thighMm", "thigh→thigh mm", (v) => v.toFixed(1)],
  ["weaponMm", "weapon→body mm", (v) => v.toFixed(1)],
];
const worstOf = (k: keyof RunResult, xs: RunResult[]) => k === "floorMm" ? Math.min(...xs.map((x) => x[k] as number)) : Math.max(...xs.map((x) => x[k] as number));

/** Markdown: per clip kind x metric (worst over bodies), before vs after; offender counts; worst list; balance. */
export function docTables(before: AuditReport, after: AuditReport): string {
  const L: string[] = [];
  // Offences are re-derived with the CURRENT thresholds (a report written with older ones stays comparable).
  for (const r of [...before.runs, ...after.runs]) classify(r);
  const kinds = [...new Set(before.runs.map((r) => `${r.kind}${r.tag !== "x" ? ":" + r.tag : ""}`))];
  const kindOf = (r: RunResult) => `${r.kind}${r.tag !== "x" ? ":" + r.tag : ""}`;
  L.push(`### Worst value per clip family (over 8 bodies), before → after`, "");
  L.push(`| family | runs | ${METRICS.map((m) => m[1]).join(" | ")} |`, `|---|---|${METRICS.map(() => "---").join("|")}|`);
  for (const k of kinds) {
    const b = before.runs.filter((r) => kindOf(r) === k), a = after.runs.filter((r) => kindOf(r) === k);
    if (!b.length || !a.length) continue;
    L.push(`| ${k} | ${b.length} | ${METRICS.map(([m, , f]) => `${f(worstOf(m, b))} → ${f(worstOf(m, a))}`).join(" | ")} |`);
  }
  L.push("", `### Offending runs (any metric over its threshold: ${JSON.stringify(THRESHOLDS)})`, "");
  L.push(`| metric | before | after |`, `|---|---|---|`);
  for (const m of ["pop", "slide", "floor", "foreTorso", "thigh", "weapon"]) {
    L.push(`| ${m} | ${before.runs.filter((r) => r.offences.includes(m)).length} | ${after.runs.filter((r) => r.offences.includes(m)).length} |`);
  }
  L.push(`| any | ${before.runs.filter((r) => r.offences.length).length} / ${before.runs.length} | ${after.runs.filter((r) => r.offences.length).length} / ${after.runs.length} |`);
  L.push("", `### The 15 worst runs before, and the same runs after`, "");
  L.push(`| body | clip | tag | offences before | severity before | severity after | ${METRICS.map((m) => m[1]).join(" | ")} |`, `|---|---|---|---|---|---|${METRICS.map(() => "---").join("|")}|`);
  const key = (r: RunResult) => `${r.body}|${r.clip}|${r.tag}`;
  const amap = new Map(after.runs.map((r) => [key(r), r]));
  for (const r of [...before.runs].sort((x, y) => y.severity - x.severity).slice(0, 15)) {
    const a = amap.get(key(r));
    L.push(`| ${r.body} | ${r.clip} | ${r.tag} | ${r.offences.join(",") || "-"} | ${r.severity.toFixed(2)} | ${a ? a.severity.toFixed(2) : "-"} | ${METRICS.map(([m, , f]) => `${f(r[m] as number)} → ${a ? f(a[m] as number) : "-"}`).join(" | ")} |`);
  }
  L.push("", `### Balance disk: centre of mass over the support polygon (margin mm, + inside), before → after`, "");
  L.push(`| body | idle | guard | walk mid-stance (static, single foot) | walk mid-stance (Hof mediolateral XCoM) |`, `|---|---|---|---|---|`);
  for (const body of [...new Set(before.balance.map((x) => x.body))]) {
    const g = (rep: AuditReport, st: string, f: "marginMm" | "xcomMm") => { const x = rep.balance.find((y) => y.body === body && y.stance === st); return x && x[f] !== null ? (x[f] as number).toFixed(0) : "-"; };
    L.push(`| ${body} | ${g(before, "idle", "marginMm")} → ${g(after, "idle", "marginMm")} | ${g(before, "guard", "marginMm")} → ${g(after, "guard", "marginMm")} | ${g(before, "walk-midstance", "marginMm")} → ${g(after, "walk-midstance", "marginMm")} | ${g(before, "walk-midstance", "xcomMm")} → ${g(after, "walk-midstance", "xcomMm")} |`);
  }
  return L.join("\n");
}

if (import.meta.main) {
  const args = Deno.args, get = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  if (args[0] === "--write-doc") {
    // docs/wave-gen/KINEMATICS.md: the narrative is kept in docs/wave-gen/kinematics-notes.md (hand-written,
    // no numbers typed by hand); every table below it is generated from the JSONs.
    const J = (p: string) => JSON.parse(Deno.readTextFileSync(p));
    const before = J("artifacts/wave-gen/anim-audit-before.json") as AuditReport, after = J("artifacts/wave-gen/anim-audit-after.json") as AuditReport;
    const konly = J("artifacts/wave-gen/anim-audit-after-k-only.json") as AuditReport;
    const notes = Deno.readTextFileSync("docs/wave-gen/kinematics-notes.md");
    const doc = [notes.trimEnd(), "", "## Audit tables: HEAD (before) -> this tree (after)", "", docTables(before, after), "",
      "## Audit tables: HEAD -> HEAD + lane K's files only (isolates K from the other lanes' body changes)", "", docTables(before, konly), "",
      "## Agility: limit windows and the envelope the clips reach (anim-agility.json)", "", agilityTable(J("artifacts/wave-gen/anim-agility.json")), ""].join("\n");
    Deno.writeTextFileSync("docs/wave-gen/KINEMATICS.md", doc);
    console.log(`docs/wave-gen/KINEMATICS.md: ${doc.length} chars`);
  } else if (args[0] === "--agility-report") {
    // C-AGI meter: the limit tables' total travel at 0 / 500 / 1000 and the joint envelope every clip REACHES.
    const out = get("--out") ?? "artifacts/wave-gen/anim-agility.json";
    const bodies = (get("--bodies") ?? "human,elf,dwarf,ork").split(",");
    const rep: { travel: Record<string, number>; windows: Record<string, Record<string, [number, number]>>; reach: Record<string, Record<string, Record<string, [number, number]>>> } = { travel: {}, windows: {}, reach: {} };
    for (const a of [0, 500, 1000]) {
      const lim = defaultHumanoid(a).limits();
      rep.travel[a] = +totalTravel(lim).toFixed(4);
      rep.windows[a] = Object.fromEntries([...lim].map(([j, l]) => [j, [+l.min.toFixed(4), +l.max.toFixed(4)]]));
      rep.reach[a] = audit({ bodies, agility: a, log: true }).reach;
    }
    Deno.writeTextFileSync(out, JSON.stringify(rep, null, 1));
    console.log(agilityTable(rep));
  } else if (args[0] === "--doc") {
    const [b, a] = [args[1], args[2]].map((p) => JSON.parse(Deno.readTextFileSync(p)) as AuditReport);
    console.log(docTables(b, a));
  } else {
    const agility = get("--agility");
    TRACE.on = args.includes("--trace");
    const rep = audit({ bodies: get("--bodies")?.split(","), clips: get("--clips")?.split(","), agility: agility ? Number(agility) : null, log: true, carry: get("--carry") as ArchetypeId | undefined });
    const out = get("--out");
    if (out) Deno.writeTextFileSync(out, JSON.stringify(rep, null, 1));
    const offenders = rep.runs.filter((r) => r.offences.length).sort((x, y) => y.severity - x.severity);
    console.log(`${rep.runs.length} runs, ${offenders.length} offending, ${(rep.meta.ms / 1000).toFixed(1)} s${out ? " -> " + out : ""}`);
    for (const r of offenders.slice(0, 25)) {
      console.log(`${r.body.padEnd(7)} ${(r.clip + (r.tag !== "x" ? "/" + r.tag : "")).padEnd(34)} sev ${r.severity.toFixed(2)} [${r.offences.join(",")}] pop ${r.popJoint.toFixed(3)}(${r.popJointName})/${r.popBone.toFixed(3)}(${r.popBoneName}) slide ${r.slideMm.toFixed(1)} floor ${r.floorMm.toFixed(1)} fore ${r.foreTorsoMm.toFixed(1)}${r.foreTorsoSide}/raw ${r.foreTorsoRawMm.toFixed(0)} thigh ${r.thighMm.toFixed(1)} weapon ${r.weaponMm.toFixed(1)}(${r.weaponBox}@${r.weaponAt.toFixed(2)})`);
    }
    for (const x of rep.balance) console.log(`balance ${x.body.padEnd(7)} ${x.stance.padEnd(15)} margin ${x.marginMm.toFixed(0)} mm${x.xcomMm !== null ? ` ML-xcom ${x.xcomMm.toFixed(0)} mm` : ""}${x.doubleShare !== undefined ? ` double ${(100 * x.doubleShare).toFixed(0)}%` : ""}`);
  }
}
