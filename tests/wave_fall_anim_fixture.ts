// Wave FALL lane A: headless harness — lane A's REAL skinned rig + Skeleton + Animator driven with
// scripted AnimatorInput.fall / .shove, placed exactly like the engine must place it
// (docs/wave-fall/ANIMATION.md "Engine wiring"): drive(..., wideLimits) -> rig.update -> group
// position (lateral + forward offsets on the yaw + yawOffset frame) -> rotation (yaw, roll) ->
// applyRootTilt -> settleOnFloor(groundBody). Every number is measured on the SKIN / bones.
// @deno-types="@types/three"
import * as THREE from "three";
import { applyRootTilt, buildSkinnedHumanoid, settleOnFloor, skinClearance } from "../src/graphics/body/SkinnedHumanoid.ts";
import { defaultHumanoid } from "../src/game/Skeleton.ts";
import { generateClassWeapon } from "../src/game/WeaponGen.ts";
import type { Appearance } from "../src/game/Characters.ts";
import { wrapAngle } from "../src/core/MathCore.ts";
import { type AnimFallInput, Animator, type AnimShoveInput } from "../src/game/anim/Animator.ts";
import { JOINT_ORDER, legGeometryFromBones, limitTableFrom } from "../src/game/anim/Rig.ts";

export const BODIES: Record<string, Appearance> = {
  human: { body: "#ef7455", accent: "#dfaa55", height: 1.7, weight: 72, hair: "#3a2a1a", eyes: "#2f6fb5", race: "human", subrace: null, sex: "male" },
  humanF: { body: "#ef7455", accent: "#dfaa55", height: 1.64, weight: 60, hair: "#3a2a1a", eyes: "#2f6fb5", race: "human", subrace: null, sex: "female" },
  elf: { body: "#82b970", accent: "#a9ce7c", height: 1.77, weight: 60, hair: "#d8b87a", eyes: "#a9ce7c", race: "elf", subrace: "wood", sex: "male" },
  elfF: { body: "#82b970", accent: "#a9ce7c", height: 1.72, weight: 54, hair: "#d8b87a", eyes: "#a9ce7c", race: "elf", subrace: "wood", sex: "female" },
  dwarf: { body: "#9b72cf", accent: "#dfaa55", height: 1.39, weight: 70, hair: "#a87a4a", eyes: "#172128", race: "dwarf", subrace: "mountain", sex: "male" },
  dwarfF: { body: "#9b72cf", accent: "#dfaa55", height: 1.34, weight: 62, hair: "#a87a4a", eyes: "#172128", race: "dwarf", subrace: "mountain", sex: "female" },
  ork: { body: "#4f8490", accent: "#172128", height: 1.95, weight: 120, hair: "#172128", eyes: "#172128", race: "ork", subrace: "ironhide", sex: "male" },
  orkF: { body: "#4f8490", accent: "#172128", height: 1.86, weight: 100, hair: "#172128", eyes: "#172128", race: "ork", subrace: "ironhide", sex: "female" },
};

export type Rig = ReturnType<typeof buildSkinnedHumanoid>;
export interface FallFighter {
  key: string; rig: Rig; sk: ReturnType<typeof defaultHumanoid>; an: Animator;
  soles: { bone: THREE.Bone; local: THREE.Vector3; side: number }[];
  /** Skin vertex indices whose dominant bone is the torso (root / spine / abdomen). */
  torso: Uint32Array;
  /** Dominant bone name per skin vertex. */
  dominant: string[];
}

export function fallFighter(key: string): FallFighter {
  const rig = buildSkinnedHumanoid(generateClassWeapon("Warrior"), BODIES[key], "fire", undefined, { paint: false });
  const sk = defaultHumanoid();
  const ankleY = rig.plan.bones.find((b) => b.id === "ankleL")!.head[1];
  const an = new Animator(legGeometryFromBones(rig.plan.bones, ankleY, 1), limitTableFrom(sk.limits()));
  rig.group.updateMatrixWorld(true);
  const soles: FallFighter["soles"] = [];
  const P = rig.plan, w = P.proportions.radius.footHalfWidth;
  P.legs.forEach((leg, i) => {
    const s = i === 0 ? "L" : "R";
    const pts: [string, number[]][] = [
      [`ankle${s}`, [leg.ankle[0], 0, leg.heelBack[2] + 0.09 * P.proportions.foot]],
      [`ankle${s}`, [leg.ball[0] + 0.7 * w, 0, leg.ball[2]]], [`ankle${s}`, [leg.ball[0] - 0.7 * w, 0, leg.ball[2]]],
      [`toe${s}`, [leg.toeTip[0], 0, leg.toeTip[2] - 0.04 * P.proportions.foot]],
    ];
    for (const [id, p] of pts) {
      const bone = rig.bones.get(id as never)!;
      soles.push({ bone, local: new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(bone.matrixWorld.clone().invert()), side: i });
    }
  });
  const mesh = rig.skin as unknown as THREE.SkinnedMesh;
  const si = mesh.geometry.getAttribute("skinIndex"), sw = mesh.geometry.getAttribute("skinWeight");
  const torsoBones = new Set(["root", "spine", "abdomen"].map((id) => mesh.skeleton.bones.findIndex((b) => b.name === id)));
  const torso: number[] = [], dominant: string[] = [];
  for (let v = 0; v < si.count; v++) {
    let best = 0, bi = -1;
    for (let k = 0; k < 4; k++) { const wk = sw.getComponent(v, k); if (wk > best) { best = wk; bi = si.getComponent(v, k); } }
    if (torsoBones.has(bi)) torso.push(v);
    dominant.push(mesh.skeleton.bones[bi]?.name ?? "?");
  }
  return { key, rig, sk, an, soles, torso: Uint32Array.from(torso), dominant };
}

/** One scripted segment: fall/shove input with t01 running 0 -> 1 over `dur`, body velocity (world m/s). */
export interface Seg {
  dur: number; tag: string;
  fall?: { phase: AnimFallInput["phase"]; pose: AnimFallInput["pose"]; dir: [number, number] };
  shove?: { phase: AnimShoveInput["phase"]; dir: [number, number]; magnitude01: number };
  vel?: [number, number];
  /** Velocity as a function of the segment's t01 (overrides vel). */
  velAt?: (t01: number) => [number, number];
  engaged?: boolean;
}

export interface Frame {
  t: number; tag: string; phase: string;
  /** Skin clearance (lowest skin point - floor, m) BEFORE the settle (the animator's own grounding) and after. */
  modelClear: number; skinClear: number; settle: number;
  /** Lowest torso skin point above the floor (m). */
  torsoClear: number;
  /** Largest joint angle change since the last frame (rad), and the root rotation change (rad). */
  dJoint: number; dJointName: string; dRoot: number;
  /** Sole points [L, R] world: min height, and the mean (x, z). */
  soleY: [number, number]; sole: [[number, number], [number, number]];
  /** Loaded feet per the animator (contact weight), or planted by the gait. */
  loaded: [boolean, boolean];
  contact: number[];
  fallWeight: number;
  rootY: number;
  /** The model's lowest sphere (index) and the skin's lowest vertex's dominant bone. */
  lowSphere: number; lowPart: string;
  /** The gait's feet (world x, z, planted) — QA of the get-up hand-off. */
  gait: [number, number, boolean][];
  /** EXACT (every vertex) lowest skin point - floor after the settle, only in "down" frames (else NaN). */
  exactDown: number;
}

const V = new THREE.Vector3(), Q0 = new THREE.Quaternion();
const ground = () => 0;

/** Drive the fighter through `segs` at `hz`; returns every frame's metrics. */
export function drive(f: FallFighter, segs: Seg[], hz = 60, stride = 3, stopAt = Infinity): Frame[] {
  const dt = 1 / hz, out: Frame[] = [];
  const b = { x: 0, z: 0 }, prev = { x: 0, z: 0, yaw: 0 };
  const ox = 0, oz = 1000; // the rival, far ahead: yaw ~ 0
  let t = 0, lastA: Float64Array | null = null;
  const lastQ = new THREE.Quaternion();
  let first = true;
  const mesh = f.rig.skin as unknown as THREE.SkinnedMesh;
  const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  for (const seg of segs) {
    const n = Math.max(1, Math.round(seg.dur * hz));
    for (let k = 0; k < n; k++) {
      if (t + dt / 2 > stopAt) return out;
      t += dt;
      const t01 = (k + 1) / n;
      const vel = seg.velAt ? seg.velAt(t01) : seg.vel;
      if (vel) { b.x += vel[0] * dt; b.z += vel[1] * dt; }
      const yaw = Math.atan2(ox - b.x, oz - b.z);
      if (first) { prev.x = b.x; prev.z = b.z; prev.yaw = yaw; }
      const dx = b.x - prev.x, dz = b.z - prev.z, speed = Math.hypot(dx, dz) / dt;
      const fall = seg.fall ? { phase: seg.fall.phase, t01, dir: seg.fall.dir, pose: seg.fall.pose } : null;
      const shove = seg.shove ? { phase: seg.shove.phase, t01, dir: seg.shove.dir, magnitude01: seg.shove.magnitude01 } : null;
      const o = f.an.update(dt, {
        x: b.x, z: b.z, yaw, rootY: 0, speed, moveDirLocal: speed > 1e-3 ? wrapAngle(Math.atan2(dx, dz) - yaw) : 0,
        turnRate: wrapAngle(yaw - prev.yaw) / dt, grounded: true, hit: false, attack: false, block: false, ko: false,
        engaged: seg.engaged ?? true, skill: null, skillProgress: 0, groundHeight: ground, externalRoll: 0,
        honoursYawOffset: true, fall, shove,
      });
      // The engine applies bodyShift right after the update (the body follows the fallen pose's
      // pelvis); the previous position moves with it so the measured speed is the body's own.
      b.x += o.bodyShift[0]; b.z += o.bodyShift[1];
      prev.x = b.x; prev.z = b.z; prev.yaw = yaw;
      f.sk.drive(o.angles, o.hipRoll, o.ankleRoll, o.toeOut, undefined, o.wideLimits);
      f.rig.update(f.sk, dt);
      const yn = yaw + o.yawOffset;
      f.rig.group.position.set(
        b.x + o.rootOffsetLateral * Math.cos(yn) + o.rootOffsetForward * Math.sin(yn), o.rootOffsetY,
        b.z - o.rootOffsetLateral * Math.sin(yn) + o.rootOffsetForward * Math.cos(yn));
      f.rig.group.rotation.set(0, yn, o.rootRoll);
      applyRootTilt(f.rig.group, o.rootTilt);
      f.rig.group.updateMatrixWorld(true);
      const sc = skinClearance(f.rig, ground, stride), modelClear = sc.clearance;
      let lowPart = "";
      {
        // Which skin part is lowest (search the stride-sampled vertices again for the index).
        let best = Infinity;
        for (let v = 0; v < pos.count; v += stride) {
          V.fromBufferAttribute(pos, v); mesh.applyBoneTransform(v, V); V.applyMatrix4(mesh.matrixWorld);
          if (V.y < best) { best = V.y; lowPart = f.dominant[v]; }
        }
      }
      let lowSphere = -1;
      {
        const S = f.an.fallDebug.spheres;
        let best = Infinity;
        for (let k = 0; k < S.length / 4; k++) {
          V.set(S[k * 4], S[k * 4 + 1], S[k * 4 + 2]).applyMatrix4(f.rig.group.matrixWorld);
          if (V.y - S[k * 4 + 3] < best) { best = V.y - S[k * 4 + 3]; lowSphere = k; }
        }
      }
      const settle = settleOnFloor(f.rig, ground, o.groundBody);
      const skinClear = settle !== 0 ? skinClearance(f.rig, ground, stride).clearance : modelClear;
      let torsoClear = Infinity;
      for (const v of f.torso) {
        V.fromBufferAttribute(pos, v); mesh.applyBoneTransform(v, V); V.applyMatrix4(mesh.matrixWorld);
        torsoClear = Math.min(torsoClear, V.y);
      }
      // Joint continuity (the Skeleton's final angles) and root rotation continuity.
      const A = Float64Array.from(JOINT_ORDER.map((j) => f.sk.joint(j).angle));
      let dJoint = 0, dJointName = "";
      if (lastA) for (let j = 0; j < A.length; j++) { const d = Math.abs(A[j] - lastA[j]); if (d > dJoint) { dJoint = d; dJointName = JOINT_ORDER[j]; } }
      lastA = A;
      f.rig.group.getWorldQuaternion(Q0);
      const dRoot = first ? 0 : 2 * Math.acos(Math.min(1, Math.abs(Q0.dot(lastQ))));
      lastQ.copy(Q0);
      const soleY: [number, number] = [Infinity, Infinity], sole: [[number, number], [number, number]] = [[0, 0], [0, 0]];
      for (const sp of f.soles) {
        V.copy(sp.local).applyMatrix4(sp.bone.matrixWorld);
        soleY[sp.side] = Math.min(soleY[sp.side], V.y);
        sole[sp.side][0] += V.x / 4; sole[sp.side][1] += V.z / 4;
      }
      const fd = f.an.fallDebug;
      // "Loaded" = the animator's promise that the sole is planted (fall contacts, then the gait).
      const loaded: [boolean, boolean] = [o.feet[0].planted, o.feet[1].planted];
      out.push({
        t, tag: seg.tag, phase: fall?.phase ?? shove?.phase ?? "stand", modelClear, skinClear, settle, torsoClear,
        dJoint, dJointName, dRoot, soleY, sole, loaded, contact: Array.from(fd.contact), fallWeight: o.fallWeight, rootY: f.rig.group.position.y,
        lowSphere, lowPart, gait: f.an.gait.feet.map((g) => [g.x, g.z, g.planted] as [number, number, boolean]),
        exactDown: fall?.phase === "down" ? skinClearance(f.rig, ground, 1).clearance : NaN,
      });
      first = false;
    }
  }
  return out;
}

/**
 * The standard scripted fall: stagger 0.35 s (pushed 0.8 m/s along dir), falling FALL_SECONDS = 0.5 s
 * (M's Fall.ts), down `down` s, rising `rise` s (M's riseSeconds law clamps 0.8-3.5 s), 1 s after.
 */
export function fallScript(pose: "back" | "front" | "side", rise = 1.3, down = 0.8): Seg[] {
  const dir: [number, number] = pose === "back" ? [0, -1] : pose === "front" ? [0, 1] : [1, 0];
  return [
    { dur: 0.6, tag: "stand" },
    { dur: 0.35, tag: "stagger", fall: { phase: "stagger", pose, dir }, vel: [dir[0] * 0.8, dir[1] * 0.8] },
    { dur: 0.5, tag: "falling", fall: { phase: "falling", pose, dir }, vel: [dir[0] * 0.3, dir[1] * 0.3] },
    { dur: down, tag: "down", fall: { phase: "down", pose, dir } },
    { dur: rise, tag: "rising", fall: { phase: "rising", pose, dir } },
    { dur: 1.0, tag: "after" },
  ];
}

/** Stagger (pushed back, arms flailing) or stumble (pitching forward) with the body carried along dir. */
export function reactScript(kind: "stagger" | "stumble"): Seg[] {
  const dir: [number, number] = kind === "stagger" ? [0, -1] : [0, 1];
  const v = kind === "stagger" ? 1.0 : 0.8, D = kind === "stagger" ? 0.8 : 0.6;
  return [
    { dur: 0.6, tag: "stand" },
    { dur: D, tag: kind, fall: { phase: kind, pose: "back", dir }, velAt: (u) => [0, dir[1] * v * 2 * (1 - u)] },
    { dur: 1.0, tag: "after" },
  ];
}

export function shoveScript(mag = 0.8): Seg[] {
  const dir: [number, number] = [0, -1];
  // Pushback ~0.45·mag m over the recoil (decelerating), like M's law hands it to the body.
  const segs: Seg[] = [{ dur: 0.6, tag: "stand" }, { dur: 0.15, tag: "brace", shove: { phase: "brace", dir, magnitude01: mag } },
    { dur: 0.08, tag: "impact", shove: { phase: "impact", dir, magnitude01: mag } }];
  const R = 0.5, push = 0.45 * mag;
  // Linearly decaying speed that integrates to `push` over the recoil.
  segs.push({ dur: R, tag: "recoil", shove: { phase: "recoil", dir, magnitude01: mag }, velAt: (u) => [0, -(push / R) * 2 * (1 - u)] });
  segs.push({ dur: 1.0, tag: "after" });
  return segs;
}


/** Per-run summary (every number measured on the skin / bones of the real rig). */
export interface Summary {
  body: string; script: string; rise: number;
  /** Shoulder half-span (m): the side-lying band scales with it (the body lies on its deltoid). */
  w: number;
  /** Lowest skin point - floor during "down" (exact, after the settle), m. */
  downExact: [number, number];
  /** The animator's own grounding (before the skin settle) during "down", m. */
  downModel: [number, number];
  /** Lowest TORSO skin point (root/spine/abdomen-dominated) above the floor during "down", max over frames, m. */
  downTorso: number;
  /** Worst skin clearance (after the settle) over every frame of the run, m (no part below the floor). */
  worstSkin: number;
  /** Largest planted-foot slide (m) of a stance that starts in `rising` (through the hand-off). */
  riseSlide: number;
  /** Largest planted-foot slide (m) of any stance from the reaction (shove / stagger / stumble) on. */
  reactSlide: number;
  /** Foot lift-offs (steps) from the reaction's start to the end of the run, and the net body travel (m). */
  steps: number;
  /** Largest joint change per frame (rad) and root rotation change per frame (rad). */
  dJoint: number; dRoot: number;
  /** After the get-up: both feet gait-planted with soles within 1 cm of the floor by the end (true/false). */
  standsAtEnd: boolean;
}

function stances(fr: Frame[], from: (x: Frame) => boolean): number {
  let worst = 0;
  for (let i = 0; i < 2; i++) {
    let start: [number, number] | null = null, ok = false;
    for (const x of fr) {
      if (x.loaded[i]) {
        if (!start) { start = [x.sole[i][0], x.sole[i][1]]; ok = from(x); }
        if (ok) worst = Math.max(worst, Math.hypot(x.sole[i][0] - start[0], x.sole[i][1] - start[1]));
      } else start = null;
    }
  }
  return worst;
}

export function summarize(body: string, script: string, rise: number, fr: Frame[], w = 0): Summary {
  const down = fr.filter((x) => x.phase === "down");
  const reactTags = new Set(["brace", "impact", "recoil", "stagger", "stumble"]);
  const firstReact = fr.findIndex((x) => reactTags.has(x.tag));
  let steps = 0;
  if (firstReact >= 0) {
    for (let i = 0; i < 2; i++) for (let k = Math.max(1, firstReact); k < fr.length; k++) if (fr[k - 1].loaded[i] && !fr[k].loaded[i]) steps++;
  }
  const last = fr[fr.length - 1];
  return {
    body, script, rise, w,
    downExact: down.length ? [Math.min(...down.map((x) => x.exactDown)), Math.max(...down.map((x) => x.exactDown))] : [0, 0],
    downModel: down.length ? [Math.min(...down.map((x) => x.modelClear)), Math.max(...down.map((x) => x.modelClear))] : [0, 0],
    downTorso: down.length ? Math.max(...down.map((x) => x.torsoClear)) : 0,
    worstSkin: Math.min(...fr.map((x) => x.skinClear)),
    riseSlide: stances(fr, (x) => x.tag === "rising"),
    reactSlide: firstReact >= 0 ? stances(fr.slice(firstReact), () => true) : 0,
    steps,
    dJoint: Math.max(...fr.map((x) => x.dJoint)), dRoot: Math.max(...fr.map((x) => x.dRoot)),
    standsAtEnd: last.loaded[0] && last.loaded[1] && Math.abs(last.soleY[0]) < 0.01 && Math.abs(last.soleY[1]) < 0.01 && last.fallWeight === 0,
  };
}

/** Run one body through one script and summarize (stride: skin sampling for the per-frame meters). */
export function measure(body: string, script: "back" | "front" | "side" | "shove" | "stagger" | "stumble", rise = 1.3, stride = 4): Summary {
  const f = fallFighter(body);
  const segs = script === "shove" ? shoveScript() : script === "stagger" || script === "stumble" ? reactScript(script) : fallScript(script, rise);
  const w = Math.abs(f.rig.plan.bones.find((b) => b.id === "shoulderL")!.head[0]);
  return summarize(body, script, rise, drive(f, segs, 60, stride), w);
}
