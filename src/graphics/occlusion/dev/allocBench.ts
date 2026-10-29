// Dev-only benchmark (not imported by the game): per-frame cost and steady-state allocation of
// OccluderSystem.update on a 150-occluder arena (96 wall segments, 48 props, 2 hills, 2 fighters,
// 2 weapons) with the camera orbiting the subject.
//
//   deno run --allow-read --allow-run src/graphics/occlusion/dev/allocBench.ts
//
// The parent run re-launches itself as a child with V8 `--trace-gc --max-semi-space-size=1` (a
// 1 MB young generation, so ANY steady per-frame garbage shows up as scavenges) and counts the
// GC lines whose timestamps fall inside the measured window. 0-3 GCs over 200k frames = no
// per-frame allocation; the pre-fix code (TS parameter properties, doubles passed to non-inlined
// calls) measured 94.

// @deno-types="@types/three"
import * as THREE from "three";
import { OccluderSystem } from "../Occluders.ts";
import { createCelMesh } from "../../shaders/CelShader.ts";

const FRAMES = 200_000, WARMUP = 20_000;

/** Build the synthetic arena; returns the system, the camera and the two fighters. */
function buildArena() {
  const scene = new THREE.Scene();
  const system = new OccluderSystem();
  const wallMat = new THREE.MeshLambertMaterial();
  const ringRadius = 17, segments = 96;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
    const ax = Math.cos(a0) * ringRadius, az = Math.sin(a0) * ringRadius;
    const bx = Math.cos(a1) * ringRadius, bz = Math.sin(a1) * ringRadius;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(bx - ax, bz - az), 2.5, 0.35), wallMat);
    seg.position.set((ax + bx) / 2, 1.25, (az + bz) / 2);
    seg.rotation.y = -Math.atan2(bz - az, bx - ax);
    scene.add(seg);
    system.register(seg, { kind: "wall" });
  }
  let seed = 1;
  const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 48; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1.2, 1), new THREE.MeshLambertMaterial());
    const r = 3 + rng() * 12, a = rng() * Math.PI * 2;
    m.position.set(Math.cos(a) * r, 0.6, Math.sin(a) * r);
    scene.add(m);
    system.register(m, { kind: "prop" });
  }
  for (const [x, z] of [[-8, 5], [7, -6]]) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(2, 12, 8), new THREE.MeshLambertMaterial());
    hill.position.set(x, 0.8, z);
    hill.scale.y = 0.5;
    scene.add(hill);
    system.register(hill, { kind: "terrain" });
  }
  const fighters: THREE.Group[] = [];
  for (const x of [-2.5, 2.5]) {
    const f = new THREE.Group();
    const body = createCelMesh(new THREE.CapsuleGeometry(0.3, 1.1, 4, 8), "#ef7455");
    body.position.y = 0.85;
    const blade = createCelMesh(new THREE.BoxGeometry(0.05, 0.9, 0.02), "#cccccc");
    blade.position.set(0.35, 1.2, 0.3);
    f.add(body, blade);
    f.position.x = x;
    scene.add(f);
    system.register(blade, { kind: "weapon" });
    system.register(f, { kind: "fighter" });
    fighters.push(f);
  }
  system.setSubject(fighters[0]);
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 300);
  scene.add(camera);
  return { system, camera, fighters };
}

/** Child: run the orbit and print the window markers (performance.now, ms) and the cost. */
function child(): void {
  const { system, camera, fighters } = buildArena();
  let frame = 0;
  const step = () => {
    const yaw = frame * 0.01, p = fighters[0].position;
    camera.position.set(p.x + Math.sin(yaw) * 5.5, 3.2, p.z + Math.cos(yaw) * 5.5);
    camera.lookAt(p.x, 1.15, p.z);
    fighters[1].position.set(2.5 * Math.cos(frame * 0.003), 0, 2.5 * Math.sin(frame * 0.003));
    system.update(camera, 1 / 60);
    frame++;
  };
  for (let i = 0; i < WARMUP; i++) step();
  const t0 = performance.now();
  for (let i = 0; i < FRAMES; i++) step();
  const t1 = performance.now();
  console.log(`WINDOW ${t0.toFixed(0)} ${t1.toFixed(0)} US_PER_FRAME ${((t1 - t0) / FRAMES * 1000).toFixed(2)} OCCLUDERS ${system.size}`);
}

/** Parent: launch the child under --trace-gc with a 1 MB young generation and count window GCs. */
async function parent(): Promise<void> {
  const self = new URL(import.meta.url).pathname;
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "--v8-flags=--trace-gc,--max-semi-space-size=1", self, "--child"],
    stdout: "piped", stderr: "piped",
  }).output();
  const text = new TextDecoder().decode(out.stdout) + new TextDecoder().decode(out.stderr);
  const w = /WINDOW (\d+) (\d+) US_PER_FRAME ([\d.]+) OCCLUDERS (\d+)/.exec(text);
  if (!w) { console.log(text); throw new Error("child produced no WINDOW line"); }
  const [t0, t1] = [Number(w[1]), Number(w[2])];
  let inWindow = 0, total = 0;
  for (const m of text.matchAll(/\]\s+(\d+) ms: (?:Scavenge|Mark)/g)) {
    total++;
    const t = Number(m[1]);
    if (t >= t0 && t <= t1) inWindow++;
  }
  console.log(`${w[4]} occluders, ${FRAMES} frames: ${w[3]} us/frame; GCs inside the window: ${inWindow} (whole run: ${total}, 1 MB young generation)`);
}

if (Deno.args.includes("--child")) child();
else await parent();
