// Lane C2 (R04 + R03 soles): the Animator on lane A's REAL skinned rig, driven exactly like
// Engine.#updatePose + the driven rig placement, measured on the rig's bones in world space.
// Invariants: (a) no sole point sinks > 1 cm, (b) planted soles within 1 cm and slide <= 2 cm per
// stance, (c) knees never reversed, (d) chest leans forward 0..15° walking/running, head near
// level, (e) no spurious crouch, plus model-vs-rig agreement of the foot geometry and the ankle
// roll order. Builds one body per race (~0.3 s each, cached by spec).
// @deno-types="@types/three"
import * as THREE from "three";
import { buildSkinnedHumanoid } from "../src/graphics/body/SkinnedHumanoid.ts";
import { defaultHumanoid, type JointName } from "../src/game/Skeleton.ts";
import { generateClassWeapon } from "../src/game/WeaponGen.ts";
import type { Appearance } from "../src/game/Characters.ts";
import { ALL_SKILLS } from "../src/game/Skills.ts";
import { hopAt, lungeAt } from "../src/game/AnimationCurve.ts";
import { wrapAngle } from "../src/core/MathCore.ts";
import { Animator } from "../src/game/anim/Animator.ts";
import { JOINT_ORDER, legFK3, legGeometryFromBones, limitTableFrom, newLegFK3 } from "../src/game/anim/Rig.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const RACES: Record<string, Appearance> = {
  human: { body: "#ef7455", accent: "#dfaa55", height: 1.7, weight: 72, hair: "#3a2a1a", eyes: "#2f6fb5", race: "human", subrace: null },
  elf: { body: "#82b970", accent: "#a9ce7c", height: 1.77, weight: 60, hair: "#d8b87a", eyes: "#a9ce7c", race: "elf", subrace: "wood" },
  dwarf: { body: "#9b72cf", accent: "#dfaa55", height: 1.39, weight: 70, hair: "#a87a4a", eyes: "#172128", race: "dwarf", subrace: "mountain" },
  ork: { body: "#4f8490", accent: "#172128", height: 1.95, weight: 120, hair: "#172128", eyes: "#172128", race: "ork", subrace: "ironhide" },
};
const RADIUS = 0.5, ACCEL = 6.5 / 0.12, HZ = 60, PI = Math.PI; // engine PLAYER_RADIUS, PLAYER_WALK
const dash = ALL_SKILLS.find((s) => s.animation.lunge > 1 && s.animation.tracks.some((t) => t.joint.startsWith("hip")))!;

interface Seg { dur: number; speed: number; dir?: number; engaged?: boolean; attack?: boolean; skill?: typeof dash.animation; orbit?: number; tag?: string }
const SCENARIOS: Record<string, Seg[]> = {
  idle: [{ dur: 1, speed: 0, tag: "x" }],
  walk: [{ dur: 0.4, speed: 0 }, { dur: 2, speed: 2.1, tag: "x" }],
  run: [{ dur: 0.4, speed: 0 }, { dur: 2, speed: 6.5, tag: "x" }],
  strafe: [{ dur: 0.4, speed: 0, engaged: true }, { dur: 2, speed: 6.5, dir: PI / 2, engaged: true, tag: "x" }],
  back: [{ dur: 0.4, speed: 0, engaged: true }, { dur: 2, speed: 6.5, dir: PI, engaged: true, tag: "x" }],
  turn: [{ dur: 0.3, speed: 0 }, { dur: 1.5, speed: 0, orbit: 2, tag: "x" }],
  attack: [{ dur: 0.4, speed: 0, engaged: true }, { dur: 0.5, speed: 0, attack: true, engaged: true, tag: "x" }],
  dash: [{ dur: 0.4, speed: 0, engaged: true }, { dur: dash.animation.duration + 0.4, speed: 0, engaged: true, skill: dash.animation, tag: "x" }],
};

type Rig = ReturnType<typeof buildSkinnedHumanoid>;
interface Fighter { rig: Rig; sk: ReturnType<typeof defaultHumanoid>; an: Animator; soles: { bone: THREE.Bone; local: THREE.Vector3; side: number; kind: number }[]; bindPitch: number }

const V = new THREE.Vector3(), W = new THREE.Vector3();
function bonePos(f: Fighter, id: string, out: THREE.Vector3): THREE.Vector3 { return f.rig.bones.get(id as never)!.getWorldPosition(out); }
function trunkPitch(f: Fighter, yaw: number): number {
  bonePos(f, "hipL", V); bonePos(f, "hipR", W); V.add(W).multiplyScalar(0.5);
  bonePos(f, "neck", W).sub(V);
  return Math.atan2(W.x * Math.sin(yaw) + W.z * Math.cos(yaw), W.y);
}

/** Lane A's rig + Skeleton + Animator, built like Engine.#spawnMeshes; sole points as in SkinnedHumanoid. */
function fighter(race: string): Fighter {
  const rig = buildSkinnedHumanoid(generateClassWeapon("Warrior"), RACES[race], "fire", undefined, { paint: false });
  const sk = defaultHumanoid();
  const ankleY = rig.plan.bones.find((b) => b.id === "ankleL")!.head[1];
  const an = new Animator(legGeometryFromBones(rig.plan.bones, ankleY, 1), limitTableFrom(sk.limits()));
  rig.group.updateMatrixWorld(true);
  const soles: Fighter["soles"] = [];
  const P = rig.plan, w = P.proportions.radius.footHalfWidth;
  P.legs.forEach((leg, i) => {
    const s = i === 0 ? "L" : "R";
    const pts: [string, number[]][] = [
      [`ankle${s}`, [leg.ankle[0], 0, leg.heelBack[2] + 0.09 * P.proportions.foot]],
      [`ankle${s}`, [leg.ball[0] + 0.7 * w, 0, leg.ball[2]]], [`ankle${s}`, [leg.ball[0] - 0.7 * w, 0, leg.ball[2]]],
      [`toe${s}`, [leg.toeTip[0], 0, leg.toeTip[2] - 0.04 * P.proportions.foot]],
    ];
    pts.forEach(([id, p], kind) => {
      const bone = rig.bones.get(id as never)!;
      soles.push({ bone, local: new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(bone.matrixWorld.clone().invert()), side: i, kind });
    });
  });
  const f: Fighter = { rig, sk, an, soles, bindPitch: 0 };
  f.bindPitch = trunkPitch(f, 0);
  return f;
}

interface Frame { t: number; tag: string; sole: number[][]; planted: boolean[]; ball: number[][]; knee: number[]; trunk: number; head: number; midHip: number; moving: number }

/** Drive like Engine.#updatePose (+ the driven placement block); record world metrics per frame. */
function drive(f: Fighter, segs: Seg[]): Frame[] {
  const dt = 1 / HZ, ground = () => 0, out: Frame[] = [];
  const b = { x: 0, z: 0, vx: 0, vz: 0 }, prev = { x: 0, z: 0, yaw: 0 };
  let ox = 0, oz = 1000, ang = 0, t = 0, skillPrev = 0;
  for (const seg of segs) {
    if (seg.skill) { f.sk.playSkill(seg.skill); skillPrev = 0; }
    for (let k = 0; k < Math.round(seg.dur * HZ); k++) {
      t += dt;
      if (seg.orbit) { ang += seg.orbit * dt; ox = b.x + 3 * Math.sin(ang); oz = b.z + 3 * Math.cos(ang); }
      let yaw = Math.atan2(ox - b.x, oz - b.z);
      const md = yaw + (seg.dir ?? 0), tx = seg.speed * Math.sin(md) - b.vx, tz = seg.speed * Math.cos(md) - b.vz;
      const dv = Math.hypot(tx, tz), s = dv > ACCEL * dt ? ACCEL * dt / dv : 1;
      b.vx += tx * s; b.vz += tz * s; b.x += b.vx * dt; b.z += b.vz * dt;
      const anim = f.sk.skillAnimation();
      if (anim) {
        const tp = Math.min(1, f.sk.skillProgress() ?? 1), gain = lungeAt(anim, tp) - lungeAt(anim, skillPrev);
        skillPrev = tp; b.x += gain * Math.sin(yaw); b.z += gain * Math.cos(yaw);
      }
      yaw = Math.atan2(ox - b.x, oz - b.z);
      if (t === dt) { prev.x = b.x; prev.z = b.z; prev.yaw = yaw; }
      const bodyY = ground() + RADIUS, floor = bodyY - RADIUS; // Engine: the body centre rides one radius up
      const dx = b.x - prev.x, dz = b.z - prev.z, speed = Math.hypot(dx, dz) / dt;
      const o = f.an.update(dt, {
        x: b.x, z: b.z, yaw, rootY: floor, speed, moveDirLocal: speed > 1e-3 ? wrapAngle(Math.atan2(dx, dz) - yaw) : 0,
        turnRate: wrapAngle(yaw - prev.yaw) / dt, grounded: true, hit: false, attack: !!seg.attack, block: false, ko: false,
        engaged: !!seg.engaged, skill: f.sk.skillAnimation(), skillProgress: f.sk.skillProgress() ?? 0, groundHeight: ground, externalRoll: 0,
      });
      prev.x = b.x; prev.z = b.z; prev.yaw = yaw;
      f.sk.drive(o.angles, o.hipRoll, o.ankleRoll);
      f.rig.update(f.sk, dt);
      const a2 = f.sk.skillAnimation(), hop = a2 ? hopAt(a2, Math.min(1, f.sk.skillProgress() ?? 1)) : 0;
      f.rig.group.position.set(b.x + o.rootOffsetLateral * Math.cos(yaw), floor + hop + o.rootOffsetY, b.z - o.rootOffsetLateral * Math.sin(yaw));
      f.rig.group.rotation.set(0, yaw, o.rootRoll);
      f.rig.group.updateMatrixWorld(true);
      const sole = [[0, 0, 0, 0], [0, 0, 0, 0]], ball = [[0, 0], [0, 0]];
      for (const sp of f.soles) {
        V.copy(sp.local).applyMatrix4(sp.bone.matrixWorld);
        sole[sp.side][sp.kind] = V.y - hop;
        if (sp.kind === 1 || sp.kind === 2) { ball[sp.side][0] += V.x / 2; ball[sp.side][1] += V.z / 2; }
      }
      const fx = Math.sin(yaw), fz = Math.cos(yaw), knee = [0, 0];
      for (let i = 0; i < 2; i++) {
        const S = i ? "R" : "L", H = bonePos(f, `hip${S}`, new THREE.Vector3()), K = bonePos(f, `knee${S}`, new THREE.Vector3());
        const A = bonePos(f, `ankle${S}`, new THREE.Vector3());
        const dzf = (A.x - H.x) * fx + (A.z - H.z) * fz, dy = A.y - H.y, kz = (K.x - H.x) * fx + (K.z - H.z) * fz, ky = K.y - H.y;
        knee[i] = (dzf * ky - dy * kz) / Math.hypot(dzf, dy); // + = knee forward of the hip-ankle line
      }
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(f.rig.bones.get("head" as never)!.getWorldQuaternion(new THREE.Quaternion()));
      bonePos(f, "hipL", V); bonePos(f, "hipR", W);
      out.push({
        t, tag: seg.tag ?? "", sole, planted: [o.feet[0].planted, o.feet[1].planted], ball, knee,
        trunk: trunkPitch(f, yaw) - f.bindPitch, head: Math.atan2(up.x * fx + up.z * fz, up.y),
        midHip: 0.5 * (V.y + W.y) - hop, moving: f.an.gait.moving,
      });
    }
  }
  return out;
}

const CACHE = new Map<string, Record<string, Frame[]>>();
function framesFor(race: string): Record<string, Frame[]> {
  if (!CACHE.has(race)) {
    const res: Record<string, Frame[]> = {};
    for (const [name, segs] of Object.entries(SCENARIOS)) res[name] = drive(fighter(race), segs).filter((x) => x.tag === "x");
    CACHE.set(race, res);
  }
  return CACHE.get(race)!;
}
const cm = (v: number) => (v * 100).toFixed(2);

Deno.test("real rig (a): no heel, ball or toe tip sinks more than 1 cm — every race, every scenario", () => {
  for (const race of Object.keys(RACES)) {
    for (const [name, fr] of Object.entries(framesFor(race))) {
      let worst = Infinity, at = 0;
      for (const x of fr) for (const s of x.sole) for (const h of s) if (h < worst) { worst = h; at = x.t; }
      assert(worst >= -0.01, `${race}/${name}: a sole point sinks ${cm(worst)} cm at t=${at.toFixed(3)} s`);
    }
  }
});

Deno.test("real rig (b): planted soles within 1 cm of the ground, planted balls slide <= 2 cm per stance", () => {
  for (const race of Object.keys(RACES)) {
    for (const [name, fr] of Object.entries(framesFor(race))) {
      for (let i = 0; i < 2; i++) {
        let start: number[] | null = null, slide = 0;
        for (const x of fr) {
          if (x.planted[i]) {
            const gap = Math.min(...x.sole[i]);
            assert(Math.abs(gap) <= 0.01, `${race}/${name}: planted foot ${i} sole gap ${cm(gap)} cm at t=${x.t.toFixed(3)}`);
            if (!start) start = x.ball[i].slice();
            slide = Math.max(slide, Math.hypot(x.ball[i][0] - start[0], x.ball[i][1] - start[1]));
            assert(slide <= 0.02, `${race}/${name}: planted foot ${i} slid ${cm(slide)} cm`);
          } else { start = null; slide = 0; }
        }
      }
    }
  }
});

Deno.test("real rig (c): knees always bend forward (never behind the hip-ankle line), both legs, every frame", () => {
  for (const race of Object.keys(RACES)) {
    for (const [name, fr] of Object.entries(framesFor(race))) {
      const worst = Math.min(...fr.flatMap((x) => x.knee));
      assert(worst >= 0, `${race}/${name}: a knee sits ${cm(worst)} cm BEHIND its hip-ankle line`);
    }
  }
});

Deno.test("real rig (d): the chest leans forward 0..15° walking and running; the head stays within ±8°", () => {
  for (const race of Object.keys(RACES)) {
    const all = framesFor(race);
    for (const name of ["walk", "run"]) {
      const moving = all[name].filter((x) => x.moving > 0.9);
      assert(moving.length > 30, `${race}/${name}: the gait got moving`);
      const lo = Math.min(...moving.map((x) => x.trunk)), hi = Math.max(...moving.map((x) => x.trunk));
      assert(lo >= 0 && hi <= 15 * PI / 180, `${race}/${name}: trunk pitch [${(lo * 180 / PI).toFixed(1)}, ${(hi * 180 / PI).toFixed(1)}]° outside [0, 15]`);
    }
    for (const name of ["idle", "walk", "run", "strafe", "back", "turn"]) {
      const h = all[name].map((x) => Math.abs(x.head));
      assert(Math.max(...h) <= 8 * PI / 180, `${race}/${name}: head pitch ${(Math.max(...h) * 180 / PI).toFixed(1)}° beyond 8°`);
    }
  }
});

// Pelvis dip budget per scenario, / L. Forward gaits: 0.1 L (a walking pelvis moves ~4-5 cm on a
// 0.8 m leg). Sideways / backward from a standstill at the keyboard's 54 m/s² the first planted foot
// ends up AHEAD of the retreating hips for a few frames: measured 0.11 L (human backpedal start).
const DIP_BUDGET: Record<string, number> = { walk: 0.1, run: 0.1, strafe: 0.12, back: 0.12 };

Deno.test("real rig (e): no spurious crouch — the pelvis stays within its dip budget of the standing height", () => {
  for (const race of Object.keys(RACES)) {
    const all = framesFor(race), L = fighter(race).an.legLength;
    const stand = all.idle[all.idle.length - 1].midHip;
    for (const [name, budget] of Object.entries(DIP_BUDGET)) {
      const lowF = all[name].reduce((a, x) => (x.midHip < a.midHip ? x : a));
      const low = lowF.midHip;
      assert(stand - low <= budget * L, `${race}/${name}: pelvis dips ${cm(stand - low)} cm (> ${budget} L = ${cm(budget * L)} cm) at t=${lowF.t.toFixed(3)}`);
    }
  }
});

Deno.test("real rig: Rig.legFK3 (ball, heel, toe tip) matches lane A's sole points within 1 cm for compound poses", () => {
  const f = fighter("ork"), fk = newLegFK3(), angles = new Float64Array(JOINT_ORDER.length);
  const poses: Partial<Record<JointName, number>>[] = [
    {}, { toeR: -0.68, ankleR: 0.23 }, { hipR: -0.79, kneeR: -0.86, ankleR: 0.23, toeR: -0.68, spine: -0.25, abdomen: -0.28 },
    { hipR: 0.9, kneeR: -1.6, ankleR: -0.6 }, { ankleR: 0.5, toeR: 0.3 },
  ];
  for (const pose of poses) {
    angles.fill(0);
    for (const [k, v] of Object.entries(pose)) angles[JOINT_ORDER.indexOf(k as JointName)] = v!;
    f.sk.drive(Float64Array.from(angles), [0, 0], [0, 0]);
    f.rig.update(f.sk, 0);
    f.rig.group.position.set(0, 0, 0); f.rig.group.rotation.set(0, 0, 0); f.rig.group.updateMatrixWorld(true);
    legFK3(f.an.geometry, angles, 1, 0, 0, fk);
    const real = f.soles.filter((s) => s.side === 1).map((s) => V.copy(s.local).applyMatrix4(s.bone.matrixWorld).toArray());
    const ballY = 0.5 * (real[1][1] + real[2][1]);
    for (const [name, m, r] of [["heel", fk.heel[1], real[0][1]], ["ball", fk.ball[1], ballY], ["toe", fk.toe[1], real[3][1]]] as const) {
      assert(Math.abs(m - r) <= 0.01, `${JSON.stringify(pose)} ${name}: model ${m.toFixed(3)} vs rig ${r.toFixed(3)} m`);
    }
  }
});

Deno.test("real rig: hip roll + ankle counter-roll keep a flat sole level on a pitched leg (ankle roll innermost)", () => {
  const f = fighter("ork"), angles = new Float64Array(JOINT_ORDER.length);
  angles[JOINT_ORDER.indexOf("hipR")] = 0.4; angles[JOINT_ORDER.indexOf("kneeR")] = -0.9; angles[JOINT_ORDER.indexOf("ankleR")] = -0.5;
  f.sk.drive(angles, [0, 0.3], [0, -0.3]);
  f.rig.update(f.sk, 0);
  f.rig.group.position.set(0, 0, 0); f.rig.group.rotation.set(0, 0, 0); f.rig.group.updateMatrixWorld(true);
  const pts = f.soles.filter((s) => s.side === 1).map((s) => V.copy(s.local).applyMatrix4(s.bone.matrixWorld).toArray());
  // Rig pitches: hip -0.4, knee +0.9, ankle -0.5 sum to 0, so the sole is flat; the 0.3 rad hip roll and
  // its -0.3 ankle counter-roll must not bank it (outermost ankle roll banks it by ~2·0.3·sin(0.25)).
  assert(Math.abs(pts[1][1] - pts[2][1]) < 0.003, `ball in/out heights differ by ${cm(pts[1][1] - pts[2][1])} cm (sole banked)`);
});
