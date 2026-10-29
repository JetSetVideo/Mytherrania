// Lane O (V01): cost of one OccluderSystem.update on a synthetic arena of 150 occluders
// (96 wall segments, 48 props, 2 fighters, 2 weapons, 2 detached hills), camera orbiting the subject.
// Budget: <= 0.1 ms per frame. Prints the measured numbers (quoted in docs/overhaul/lane-O.md).
// @deno-types="@types/three"
import * as THREE from "three";
import { OccluderSystem } from "../src/graphics/occlusion/Occluders.ts";
import { createCelMesh } from "../src/graphics/shaders/CelShader.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }

function arena() {
  const scene = new THREE.Scene();
  const system = new OccluderSystem();
  const wallMat = new THREE.MeshLambertMaterial({ color: "#8aa" });
  const ringR = 17, segs = 96;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const ax = Math.cos(a0) * ringR, az = Math.sin(a0) * ringR, bx = Math.cos(a1) * ringR, bz = Math.sin(a1) * ringR;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(bx - ax, bz - az) + 0.05, 2.5, 0.35), wallMat);
    seg.position.set((ax + bx) / 2, 1.25, (az + bz) / 2);
    seg.rotation.y = -Math.atan2(bz - az, bx - ax);
    scene.add(seg);
    system.register(seg, { kind: "wall" });
  }
  const rng = (() => { let s = 12345; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  const propMat = new THREE.MeshLambertMaterial({ color: "#6f7470" });
  const cyl = new THREE.CylinderGeometry(0.4, 0.4, 2.5, 16), rock = new THREE.DodecahedronGeometry(0.7), crate = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 48; i++) {
    const g = i % 3 === 0 ? cyl : i % 3 === 1 ? rock : crate;
    const m = new THREE.Mesh(g, propMat);
    const r = 3 + rng() * 12, a = rng() * Math.PI * 2;
    m.position.set(Math.cos(a) * r, 0.6, Math.sin(a) * r);
    m.rotation.y = rng() * Math.PI;
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
    f.add(body);
    const blade = createCelMesh(new THREE.BoxGeometry(0.05, 0.9, 0.02), "#ccc");
    blade.position.set(0.35, 1.2, 0.3);
    f.add(blade);
    f.position.x = x;
    scene.add(f);
    system.register(blade, { kind: "weapon" });
    system.register(f, { kind: "fighter" });
    fighters.push(f);
  }
  scene.updateMatrixWorld(true);
  system.setSubject(fighters[0]);
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 300);
  scene.add(camera);
  return { scene, system, camera, fighters };
}

Deno.test("150 occluders: one update costs <= 0.1 ms (camera orbiting the subject)", () => {
  const { system, camera, fighters } = arena();
  assert(system.size === 150, `registered ${system.size}`);
  const dt = 1 / 60;
  let frame = 0;
  const step = () => {
    const yaw = frame * 0.01;
    const p = fighters[0].position;
    camera.position.set(p.x + Math.sin(yaw) * 5.5, 3.2, p.z + Math.cos(yaw) * 5.5);
    camera.lookAt(p.x, 1.15, p.z);
    fighters[1].position.set(2.5 * Math.cos(frame * 0.003), 0, 2.5 * Math.sin(frame * 0.003));
    system.update(camera, dt);
    frame++;
  };
  for (let i = 0; i < 2000; i++) step(); // warm-up (JIT, lazy variants)
  const batches: number[] = [];
  const perBatch = 200;
  let maxFading = 0, maxBlocked = 0, narrow = 0;
  for (let b = 0; b < 50; b++) {
    const t0 = performance.now();
    for (let i = 0; i < perBatch; i++) step();
    batches.push((performance.now() - t0) / perBatch);
    maxFading = Math.max(maxFading, system.stats.fading);
    maxBlocked = Math.max(maxBlocked, system.stats.blocked);
    narrow += system.stats.narrowTests;
  }
  batches.sort((a, b) => a - b);
  const mean = batches.reduce((s, v) => s + v, 0) / batches.length;
  const median = batches[Math.floor(batches.length / 2)], p90 = batches[Math.floor(batches.length * 0.9)];
  console.log(
    `occlusion update, 150 occluders, ${batches.length * perBatch} frames (camera step included): ` +
      `mean ${(mean * 1000).toFixed(1)} us, median ${(median * 1000).toFixed(1)} us, p90 ${(p90 * 1000).toFixed(1)} us per frame; ` +
      `max blocked ${maxBlocked}, max fading ${maxFading}, narrow tests/frame (sampled) ${(narrow / 50).toFixed(1)}, ` +
      `variants created ${system.stats.variantsCreated} (allocation: see src/graphics/occlusion/dev/allocBench.ts)`,
  );
  assert(maxBlocked > 0, "the orbit does produce blockers (the test exercises the fade path)");
  assert(median <= 0.1, `median ${median} ms per frame exceeds the 0.1 ms budget`);
});
