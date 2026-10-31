// Lane I-D: the bounded spark pool. Fixed capacity, no per-frame allocation, a
// deterministic seed, and a measured wall clock over 10 000 burst+update pairs.
// @deno-types="@types/three"
import * as THREE from "three";
import { ClashSparks, DEFAULT_MAX_SPARKS, SPARKS_PER_BURST } from "../src/graphics/fx/ClashSparks.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok {
  if (!ok) throw new Error(m);
}
const DT = 1 / 60;

Deno.test("ClashSparks: one shared geometry, at most 2 meshes, triangles under 4000", () => {
  const scene = new THREE.Scene();
  const s = new ClashSparks(scene);
  assert(s.triangleCount < 4000, `triangleCount ${s.triangleCount}`);
  assert(s.triangleCount === DEFAULT_MAX_SPARKS * 2, `triangleCount ${s.triangleCount}`);
  const meshes = s.object.children as THREE.Mesh[];
  assert(meshes.length <= 2, `${meshes.length} meshes`);
  assert(meshes.length === 2 && meshes[0].geometry === meshes[1].geometry, "both layers share ONE geometry");
  const pos = meshes[0].geometry.getAttribute("position") as THREE.BufferAttribute;
  assert(pos.array.length === DEFAULT_MAX_SPARKS * 4 * 3, "fixed position buffer, 4 verts per spark");
  s.dispose();
});

Deno.test("ClashSparks: 10 000 burst+update pairs stay inside the pool and the counters balance", () => {
  const scene = new THREE.Scene();
  const s = new ClashSparks(scene);
  const N = 10000;
  let now = 0;
  let maxLive = 0;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    s.burst([0.0, 1.0, 0.0], 0.8, now, [0, 1, 0]);
    s.update(now, DT);
    if (s.liveCount > maxLive) maxLive = s.liveCount;
    now += DT;
  }
  const ms = performance.now() - t0;
  console.log(`  10 000 burst+update pairs: ${ms.toFixed(2)} ms wall clock, peak live ${maxLive}, spawned ${s.spawned}, dropped ${s.dropped}`);
  assert(ms < 1000, `wall clock ${ms.toFixed(1)} ms must be well under 1 s`);
  assert(maxLive <= DEFAULT_MAX_SPARKS, `liveCount peaked at ${maxLive}`);
  assert(s.spawned + s.dropped === N * SPARKS_PER_BURST, `spawned+dropped ${s.spawned + s.dropped} != ${N * SPARKS_PER_BURST}`);
  s.dispose();
});

Deno.test("ClashSparks: every spark dies within 0.5 s of simulated time", () => {
  const scene = new THREE.Scene();
  const s = new ClashSparks(scene);
  s.burst([0, 0, 0], 1, 100, [0, 1, 0]);
  const spawned = s.liveCount;
  assert(spawned === SPARKS_PER_BURST, `burst spawned ${spawned}`);
  let now = 100;
  let emptiedAt = Infinity;
  for (let i = 0; i < 60; i++) {
    now += DT;
    s.update(now, DT);
    if (s.liveCount === 0 && emptiedAt === Infinity) emptiedAt = now - 100;
  }
  assert(emptiedAt <= 0.5, `pool kept sparks ${emptiedAt.toFixed(3)} s`);
  assert(s.liveCount === 0, "pool empty by 0.5 s");
  assert(now - 100 >= 0.5, "test ran at least 0.5 s");
  s.dispose();
});

Deno.test("ClashSparks: setScale(0) spawns nothing; a thinned burst spawns fewer and drops the rest", () => {
  const scene = new THREE.Scene();
  const s = new ClashSparks(scene);
  s.setScale(0);
  s.burst([0, 0, 0], 1, 0, [0, 1, 0]);
  assert(s.liveCount === 0 && s.spawned === 0, "scale 0 spawns nothing");
  assert(s.dropped === SPARKS_PER_BURST, `dropped ${s.dropped}`);
  s.setScale(0.5);
  s.burst([0, 0, 0], 1, 0, [0, 1, 0]);
  assert(s.spawned === Math.round(SPARKS_PER_BURST * 0.5), `half scale spawned ${s.spawned}`);
  assert(s.spawned + s.dropped === 2 * SPARKS_PER_BURST, "counters balance with thinning");
  s.dispose();
});

Deno.test("ClashSparks: the same seed reproduces the same first-burst directions", () => {
  const scene = new THREE.Scene();
  const a = new ClashSparks(scene, { seed: 7 });
  const b = new ClashSparks(scene, { seed: 7 });
  const c = new ClashSparks(scene, { seed: 8 });
  a.burst([1, 2, 3], 0.7, 0, [0, 1, 0]);
  b.burst([1, 2, 3], 0.7, 0, [0, 1, 0]);
  c.burst([1, 2, 3], 0.7, 0, [0, 1, 0]);
  let same = true, differs = false;
  for (let i = 0; i < SPARKS_PER_BURST; i++) {
    const va = a.velocityOf(i)!, vb = b.velocityOf(i)!, vc = c.velocityOf(i)!;
    if (va.some((v, k) => Math.abs(v - vb[k]) > 1e-12)) same = false;
    if (va.some((v, k) => Math.abs(v - vc[k]) > 1e-9)) differs = true;
  }
  assert(same, "same seed -> identical first-burst directions");
  assert(differs, "a different seed -> different directions");
  // The second burst differs from the first (the per-burst counter advances the stream).
  a.burst([1, 2, 3], 0.7, 0, [0, 1, 0]);
  const second = a.velocityOf(0)!;
  a.clear();
  a.burst([1, 2, 3], 0.7, 0, [0, 1, 0]);
  const firstAgain = a.velocityOf(0)!;
  assert(second.some((v, k) => Math.abs(v - firstAgain[k]) > 1e-9), "burst 2 differs from burst 1");
  a.dispose();
  b.dispose();
  c.dispose();
});

Deno.test("ClashSparks: built with a custom size, it caps at maxSparks and stays finite", () => {
  const scene = new THREE.Scene();
  const s = new ClashSparks(scene, { maxSparks: 10, seed: 3 });
  assert(s.triangleCount === 20, `triangleCount ${s.triangleCount}`);
  // A burst asks for 12 but the pool is 10: 10 spawn, 2 drop.
  s.burst([0, 0, 0], 1, 0, [0, 0, 1]);
  assert(s.liveCount === 10 && s.spawned === 10 && s.dropped === 2, `live ${s.liveCount}`);
  const p = s.positionOf(0)!;
  assert(p.every(Number.isFinite), "finite position");
  // Gravity pulls the sparks down over time.
  const vy0 = s.velocityOf(0)![1];
  s.update(0.1, 0.1);
  assert(s.velocityOf(0)![1] < vy0, "gravity lowers the vertical velocity");
  s.dispose();
});
