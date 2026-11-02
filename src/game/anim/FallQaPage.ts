// Wave FALL lane A — QA ONLY (not game behaviour): a side-view test stage for the fall / lying /
// get-up and shove animations. tools/probe-wave-fall-anim.ts bundles this file into
// dist-anim/fallqa.js and drives it from Playwright. It builds each fighter with the game's own
// buildSkinnedHumanoid + Skeleton + Animator and places the rig exactly like the engine wiring
// (docs/wave-fall/ANIMATION.md): drive(..., wideLimits) -> rig.update -> lateral/forward offsets ->
// yaw/roll -> applyRootTilt -> settleOnFloor -> bodyShift. Scripted fall/shove inputs.
// @deno-types="@types/three"
import * as THREE from "three";
import { applyRootTilt, buildSkinnedHumanoid, settleOnFloor, skinClearance } from "../../graphics/body/SkinnedHumanoid.ts";
import { defaultHumanoid } from "../Skeleton.ts";
import { generateClassWeapon } from "../WeaponGen.ts";
import type { Appearance } from "../Characters.ts";
import { wrapAngle } from "../../core/MathCore.ts";
import { Animator, type AnimFallInput, type AnimShoveInput } from "./Animator.ts";
import { legGeometryFromBones, limitTableFrom } from "./Rig.ts";

const BODIES: Record<string, Appearance> = {
  human: { body: "#ef7455", accent: "#dfaa55", height: 1.7, weight: 72, hair: "#3a2a1a", eyes: "#2f6fb5", race: "human", subrace: null, sex: "male" },
  humanF: { body: "#ef7455", accent: "#dfaa55", height: 1.64, weight: 60, hair: "#3a2a1a", eyes: "#2f6fb5", race: "human", subrace: null, sex: "female" },
  elf: { body: "#82b970", accent: "#a9ce7c", height: 1.77, weight: 60, hair: "#d8b87a", eyes: "#a9ce7c", race: "elf", subrace: "wood", sex: "male" },
  dwarf: { body: "#9b72cf", accent: "#dfaa55", height: 1.39, weight: 70, hair: "#a87a4a", eyes: "#172128", race: "dwarf", subrace: "mountain", sex: "male" },
  ork: { body: "#4f8490", accent: "#172128", height: 1.95, weight: 120, hair: "#172128", eyes: "#172128", race: "ork", subrace: "ironhide", sex: "male" },
};

interface Seg { dur: number; tag: string; fall?: Omit<AnimFallInput, "t01">; shove?: Omit<AnimShoveInput, "t01">; vel?: (u: number) => [number, number] }

function script(name: string, rise: number): Seg[] {
  if (name === "shove") {
    const dir: [number, number] = [0, -1];
    return [{ dur: 0.5, tag: "stand" }, { dur: 0.12, tag: "brace", shove: { phase: "brace", dir, magnitude01: 0.9 } },
      { dur: 0.08, tag: "impact", shove: { phase: "impact", dir, magnitude01: 0.9 } },
      { dur: 0.5, tag: "recoil", shove: { phase: "recoil", dir, magnitude01: 0.9 }, vel: (u) => [0, -1.6 * (1 - u)] }, { dur: 0.8, tag: "after" }];
  }
  if (name === "stagger" || name === "stumble") {
    const dir: [number, number] = name === "stagger" ? [0, -1] : [0, 1];
    return [{ dur: 0.5, tag: "stand" }, { dur: 0.8, tag: name, fall: { phase: name, dir, pose: "back" }, vel: (u) => [0, dir[1] * 1.8 * (1 - u)] }, { dur: 0.8, tag: "after" }];
  }
  const pose = name as AnimFallInput["pose"];
  const dir: [number, number] = pose === "back" ? [0, -1] : pose === "front" ? [0, 1] : [1, 0];
  return [
    { dur: 0.5, tag: "stand" },
    { dur: 0.35, tag: "stagger", fall: { phase: "stagger", pose, dir }, vel: () => [dir[0] * 0.8, dir[1] * 0.8] },
    { dur: 0.5, tag: "falling", fall: { phase: "falling", pose, dir }, vel: () => [dir[0] * 0.3, dir[1] * 0.3] },
    { dur: 0.8, tag: "down", fall: { phase: "down", pose, dir } },
    { dur: rise, tag: "rising", fall: { phase: "rising", pose, dir } },
    { dur: 0.8, tag: "after" },
  ];
}

const canvas = document.getElementById("c") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(canvas.width, canvas.height, false);
renderer.setClearColor(0x2c2a33, 1);
const scene = new THREE.Scene();
scene.add(new THREE.AmbientLight("#e8dcc8", 0.9));
const key = new THREE.DirectionalLight("#fff3cf", 1.1);
key.position.set(2, 3, 2);
scene.add(key);
// The floor: a checker of 0.25 m cells so contact and sliding read in a still frame.
{
  const tex = new THREE.DataTexture(Uint8Array.from([90, 86, 80, 255, 120, 114, 104, 255, 120, 114, 104, 255, 90, 86, 80, 255]), 2, 2);
  tex.magFilter = THREE.NearestFilter; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(16, 16); tex.needsUpdate = true;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshLambertMaterial({ map: tex }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
}
const camera = new THREE.PerspectiveCamera(32, canvas.width / canvas.height, 0.05, 30);

interface Sample { t: number; tag: string; phase: string; t01: number; skin: number; bodyX: number; bodyZ: number; fallWeight: number }

function run(body: string, name: string, rise: number, at: number[], view: "side" | "front" = "side"): { strip: string; samples: Sample[] } {
  const rig = buildSkinnedHumanoid(generateClassWeapon("Warrior"), BODIES[body], "fire");
  scene.add(rig.group);
  const sk = defaultHumanoid();
  const ankleY = rig.plan.bones.find((b) => b.id === "ankleL")!.head[1];
  const an = new Animator(legGeometryFromBones(rig.plan.bones, ankleY, 1), limitTableFrom(sk.limits()));
  const segs = script(name, rise), dt = 1 / 60, ground = () => 0;
  const b = { x: 0, z: 0 }, prev = { x: 0, z: 0, yaw: 0 };
  const W = 220, H = canvas.height, strip = document.createElement("canvas");
  strip.width = W * at.length; strip.height = H;
  const ctx = strip.getContext("2d")!;
  const samples: Sample[] = [];
  let t = 0, next = 0;
  for (const seg of segs) {
    const n = Math.max(1, Math.round(seg.dur / dt));
    for (let k = 0; k < n; k++) {
      t += dt;
      const u = (k + 1) / n;
      if (seg.vel) { const v = seg.vel(u); b.x += v[0] * dt; b.z += v[1] * dt; }
      const yaw = Math.atan2(-b.x, 1000 - b.z);
      const dx = b.x - prev.x, dz = b.z - prev.z, speed = Math.hypot(dx, dz) / dt;
      const fall = seg.fall ? { ...seg.fall, t01: u } : null, shove = seg.shove ? { ...seg.shove, t01: u } : null;
      const o = an.update(dt, {
        x: b.x, z: b.z, yaw, rootY: 0, speed, moveDirLocal: speed > 1e-3 ? wrapAngle(Math.atan2(dx, dz) - yaw) : 0, turnRate: 0,
        grounded: true, hit: false, attack: false, block: false, ko: false, engaged: true, skill: null, skillProgress: 0,
        groundHeight: ground, honoursYawOffset: true, fall, shove,
      });
      b.x += o.bodyShift[0]; b.z += o.bodyShift[1];
      prev.x = b.x; prev.z = b.z; prev.yaw = yaw;
      sk.drive(o.angles, o.hipRoll, o.ankleRoll, o.toeOut, undefined, o.wideLimits);
      rig.update(sk, dt);
      const yn = yaw + o.yawOffset;
      rig.group.position.set(b.x + o.rootOffsetLateral * Math.cos(yn) + o.rootOffsetForward * Math.sin(yn), o.rootOffsetY,
        b.z - o.rootOffsetLateral * Math.sin(yn) + o.rootOffsetForward * Math.cos(yn));
      rig.group.rotation.set(0, yn, o.rootRoll);
      applyRootTilt(rig.group, o.rootTilt);
      settleOnFloor(rig, ground, o.groundBody);
      while (next < at.length && t >= at[next] - 1e-6) {
        const box = new THREE.Box3().setFromObject(rig.group), c = box.getCenter(new THREE.Vector3());
        if (view === "side") camera.position.set(c.x + 3.6, 0.85, c.z); else camera.position.set(c.x, 0.85, c.z + 3.6);
        camera.lookAt(c.x, 0.55, c.z);
        renderer.render(scene, camera);
        ctx.drawImage(canvas, (canvas.width - W) / 2, 0, W, H, next * W, 0, W, H);
        ctx.fillStyle = "#f0e6d0"; ctx.font = "13px sans-serif";
        ctx.fillText(`${seg.tag}${fall || shove ? " " + u.toFixed(2) : ""}`, next * W + 6, 18);
        samples.push({ t, tag: seg.tag, phase: fall?.phase ?? shove?.phase ?? "stand", t01: u, skin: skinClearance(rig, ground, 2).clearance, bodyX: b.x, bodyZ: b.z, fallWeight: o.fallWeight });
        next++;
      }
    }
  }
  scene.remove(rig.group);
  return { strip: strip.toDataURL("image/png"), samples };
}

(globalThis as unknown as { __FALLQA__: unknown }).__FALLQA__ = { run, bodies: Object.keys(BODIES) };
