// Lane R (V03): the articulated ragdoll of the REAL body in motion — joint limits, energy,
// muscle tone, fluids, settling, determinism, the arena world, and the per-frame cost.
import { RagdollDriver } from "../src/physics/ragdoll/RigBinding.ts";
import { arenaWorld, flatGroundWorld, surroundingsWorld, voidWorld, type RagdollWorld } from "../src/physics/ragdoll/RagdollWorld.ts";
import type { Ragdoll } from "../src/physics/ragdoll/RagdollSolver.ts";
import type { FighterCondition } from "../src/physics/ragdoll/MuscleTone.ts";
import { makeArena } from "../src/game/ArenaConfig.ts";
import { insideRing } from "../src/game/ArenaConfig.ts";
import { rng32 } from "../src/core/MathCore.ts";
import { poseRig, realBody, uniformSurroundings } from "./ragdoll_fixtures.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

const G = 24;
const fresh: FighterCondition = { hpFraction: 1, staminaFraction: 1, damagePercent: 0, strength: 5, statuses: [] };
const limp: FighterCondition = { ...fresh, hpFraction: 0 };
const body = realBody();
const driver = new RagdollDriver(body.rig, body.boxes, body.skeleton.limits(), G);
const rd = driver.ragdoll, m = rd.model;

/** Restart the shared driver from the standing pose at (0, y, 0), facing yaw. */
function throwBody(cond: FighterCondition, y: number, yaw: number, velocity: [number, number, number], impact?: { point: [number, number, number]; impulse: [number, number, number] }) {
  driver.stop();
  poseRig(body, 0, y, 0, yaw);
  driver.start({ condition: cond, velocity, impact });
}

/** World position of a hand: the elbow segment's contact sphere farthest from the elbow joint. */
function handDistanceToHead(r: Ragdoll): number {
  const head = m.segOfBone[m.boneIds.indexOf("head")];
  let sum = 0;
  for (const id of ["elbowL", "elbowR"]) {
    const s = m.segOfBone[m.boneIds.indexOf(id)];
    let best = -1, hx = 0, hy = 0, hz = 0;
    for (let k = 0; k < m.sphereSeg.length; k++) {
      if (m.sphereSeg[k] !== s) continue;
      const d = Math.hypot(m.sphereLocal[k * 3] - m.anchorChild[s * 3], m.sphereLocal[k * 3 + 1] - m.anchorChild[s * 3 + 1], m.sphereLocal[k * 3 + 2] - m.anchorChild[s * 3 + 2]);
      if (d > best) { best = d; hx = m.sphereLocal[k * 3]; hy = m.sphereLocal[k * 3 + 1]; hz = m.sphereLocal[k * 3 + 2]; }
    }
    const [qx, qy, qz, qw] = r.q.subarray(s * 4, s * 4 + 4);
    const tx = 2 * (qy * hz - qz * hy), ty = 2 * (qz * hx - qx * hz), tz = 2 * (qx * hy - qy * hx);
    const wx = r.x[s * 3] + hx + qw * tx + (qy * tz - qz * ty), wy = r.x[s * 3 + 1] + hy + qw * ty + (qz * tx - qx * tz), wz = r.x[s * 3 + 2] + hz + qw * tz + (qx * ty - qy * tx);
    sum += Math.hypot(wx - r.x[head * 3], wy - r.x[head * 3 + 1], wz - r.x[head * 3 + 2]);
  }
  return sum / 2;
}

Deno.test("RAGDOLL FALL: joint limits are never exceeded (> 0.01 rad) during a 3 s fall — fresh and limp", () => {
  const rnd = rng32(3);
  let worst = 0, gap = 0;
  for (let k = 0; k < 12; k++) {
    const cond = k % 2 ? limp : fresh;
    throwBody(cond, 0.5 + 2 * rnd(), rnd() * 6.28, [(rnd() * 2 - 1) * 7, 2 + rnd() * 6, (rnd() * 2 - 1) * 7]);
    const w = flatGroundWorld(0);
    for (let f = 0; f < 180; f++) {
      driver.update(1 / 60, w);
      worst = Math.max(worst, rd.limitViolation());
      gap = Math.max(gap, rd.maxAnchorGap());
    }
  }
  console.log(`  worst joint-limit excursion ${worst.toExponential(2)} rad; worst anchor gap ${(gap * 1000).toFixed(1)} mm (impact frames; invisible on the skin)`);
  assert(worst < 0.01, `limit exceeded by ${worst} rad`);
});

Deno.test("RAGDOLL ENERGY: 1,000 seeded limp throws end with less energy, no explosion (bounded transients)", () => {
  const rnd = rng32(1000);
  let worstRise = -Infinity, worstEnd = -Infinity, frames = 0, ms = 0, maxMs = 0, over1 = 0;
  for (let k = 0; k < 1000; k++) {
    const y = 0.3 + 1.2 * rnd();
    throwBody(limp, y, rnd() * 6.28, [(rnd() * 2 - 1) * 9, rnd() * 7, (rnd() * 2 - 1) * 9],
      { point: [(rnd() - 0.5) * 0.6, y + 0.5 + rnd(), (rnd() - 0.5) * 0.6], impulse: [(rnd() * 2 - 1) * 250, (rnd() - 0.5) * 100, (rnd() * 2 - 1) * 250] });
    const w = flatGroundWorld(0);
    const e0 = rd.energy(G);
    let eMax = e0;
    for (let f = 0; f < 40; f++) {
      const r = driver.update(1 / 60, w);
      ms += r.ms; maxMs = Math.max(maxMs, r.ms); frames++;
      const e = rd.energy(G);
      assert(Number.isFinite(e), `throw ${k}: energy not finite`);
      if (e > eMax) eMax = e;
    }
    const rise = (eMax - e0) / e0;
    if (rise > 0.01) over1++;
    worstRise = Math.max(worstRise, rise);
    worstEnd = Math.max(worstEnd, (rd.energy(G) - e0) / e0);
  }
  console.log(`  ${over1}/1000 throws rose > 1 % (worst transient ${(worstRise * 100).toFixed(2)} %); worst end ${(worstEnd * 100).toFixed(1)} % of E0; ${(ms / frames).toFixed(3)} ms/frame mean, ${maxMs.toFixed(2)} ms max over ${frames} frames`);
  // Every throw ends lower; a transient rise (deep ground contact on an impact frame, an XPBD
  // position-projection artefact) stays rare and bounded — no run-away.
  assert(worstEnd < 0, `a throw ended with more energy than it started (${worstEnd})`);
  assert(over1 <= 10 && worstRise < 0.25, `${over1} throws rose > 1 %, worst ${(worstRise * 100).toFixed(2)} %`);
});

Deno.test("RAGDOLL ENERGY: 200 toned throws stay bounded (muscle work < 5 % of E0)", () => {
  const rnd = rng32(2000);
  let worstRise = -Infinity;
  for (let k = 0; k < 200; k++) {
    const y = 0.3 + 1.2 * rnd();
    throwBody({ ...fresh, hpFraction: 0.3 + 0.7 * rnd(), staminaFraction: rnd() }, y, rnd() * 6.28, [(rnd() * 2 - 1) * 9, rnd() * 7, (rnd() * 2 - 1) * 9]);
    const w = flatGroundWorld(0);
    const e0 = rd.energy(G);
    for (let f = 0; f < 40; f++) { driver.update(1 / 60, w); worstRise = Math.max(worstRise, (rd.energy(G) - e0) / e0); }
  }
  console.log(`  toned: worst transient rise ${(worstRise * 100).toFixed(3)} % of E0`);
  assert(worstRise < 0.05, `muscles added ${(worstRise * 100).toFixed(2)} %`);
});

Deno.test("RAGDOLL MUSCLE TONE: a fresh body's arms end nearer the head than a limp body's", () => {
  const ends: Record<string, number> = {};
  for (const [name, cond] of [["fresh", fresh], ["limp", limp]] as const) {
    const rnd = rng32(5);
    let sum = 0;
    for (let k = 0; k < 16; k++) {
      // Knocked backward (velocity along −z, the chest faces +z): the COVER guard.
      throwBody(cond, 1 + rnd(), 0, [(rnd() - 0.5) * 2, 3 + rnd() * 3, -4 - rnd() * 4]);
      const w = flatGroundWorld(0);
      for (let f = 0; f < 150; f++) driver.update(1 / 60, w);
      sum += handDistanceToHead(rd);
    }
    ends[name] = sum / 16;
  }
  console.log(`  mean hand-to-head distance at rest: fresh ${ends.fresh.toFixed(3)} m, limp ${ends.limp.toFixed(3)} m`);
  assert(ends.fresh < ends.limp - 0.1, `fresh ${ends.fresh} vs limp ${ends.limp}`);
});

Deno.test("RAGDOLL FLUIDS: water slows the fall (terminal speed) and buoyancy holds a floater at the surface", () => {
  const run = (w: RagdollWorld) => {
    throwBody(limp, 3, 0, [0, 0, 0]);
    let maxDown = 0;
    for (let f = 0; f < 240; f++) { driver.update(1 / 60, w); if (f >= 60) maxDown = Math.max(maxDown, -rd.comVelocity()[1]); }
    return { maxDown, y: rd.centreOfMass()[1], medium: rd.report.medium };
  };
  const air = run(voidWorld(-500));
  const water = run(surroundingsWorld(uniformSurroundings("water", 0)));
  const floater = run(surroundingsWorld(uniformSurroundings("water", 0, { buoyancy: 1.15 })));
  console.log(`  1-4 s max sinking speed: void ${air.maxDown.toFixed(2)} m/s, water(b=0.9) ${water.maxDown.toFixed(2)} m/s; floater COM ${floater.y.toFixed(2)} m from the surface`);
  assert(water.medium === "water" && water.maxDown < 1.5 && water.maxDown < air.maxDown / 20, "water: slow sinking, far below free fall");
  assert(Math.abs(floater.y) < 0.4, `buoyancy 1.15 keeps the centre near the surface (${floater.y})`);
});

Deno.test("RAGDOLL GROUND: a landing settles within 3 s (fresh and limp) and then sleeps", () => {
  for (const cond of [fresh, limp]) {
    const rnd = rng32(9);
    for (let k = 0; k < 4; k++) {
      throwBody(cond, 0.5 + rnd(), rnd() * 6.28, [(rnd() * 2 - 1) * 3, 2 * rnd(), (rnd() * 2 - 1) * 3]);
      const w = flatGroundWorld(0);
      let at = -1;
      for (let f = 0; f < 180 && at < 0; f++) if (driver.update(1 / 60, w).settled) at = (f + 1) / 60;
      assert(at > 0, `tone ${cond.hpFraction}: throw ${k} did not settle in 3 s`);
      const r = driver.update(1 / 60, w);
      assert(r.substeps === 0, "a settled ragdoll sleeps (no substeps)");
    }
  }
});

Deno.test("RAGDOLL DETERMINISM: the same seed gives bit-identical bones", () => {
  // The seed pose is captured ONCE (the Skeleton that poses the rig keeps its own easing state).
  driver.stop();
  poseRig(body, 0, 1.2, 0, 0.4);
  const pose = driver.capture();
  const out = () => {
    rd.setCondition(fresh);
    rd.seed({ boneWorld: pose, velocity: [3, 4, -2], impact: { point: [0.1, 2, 0], impulse: [80, 0, 30] } });
    const w = flatGroundWorld(0);
    for (let f = 0; f < 90; f++) rd.step(1 / 60, w);
    const o = new Float64Array(m.boneIds.length * 7);
    rd.writeBones(o);
    return o;
  };
  const a = out(), b = out();
  for (let i = 0; i < a.length; i++) assert(Object.is(a[i], b[i]), `bone value ${i} differs: ${a[i]} vs ${b[i]}`);
});

Deno.test("RAGDOLL ARENA: thrown off the platform, the body lands on the outside ground, never inside the ring's solid", () => {
  const cfg = makeArena({ size: 10, shape: 4, walls: 0, outsideGround: 1, outsideCollision: 1, outsideHeight: -3, objects: 0 });
  const w = arenaWorld({ cfg, walled: false, integrity: 1, props: [] }, null, G);
  driver.stop();
  poseRig(body, 3.8, 0, 0, Math.PI / 2);
  driver.start({ condition: limp, velocity: [7, 3, 0] });
  for (let f = 0; f < 240; f++) {
    driver.update(1 / 60, w);
    // No body part sinks into the platform: inside the outline every segment stays above y −0.25.
    for (let s = 0; s < m.n; s++) {
      if (insideRing(cfg, rd.x[s * 3], rd.x[s * 3 + 2])) assert(rd.x[s * 3 + 1] > -0.25, `segment ${s} inside the platform at frame ${f}`);
    }
  }
  const c = rd.centreOfMass();
  assert(!insideRing(cfg, c[0], c[2]) && Math.abs(c[1] - (-3)) < 0.5, `rests on the outside ground: COM ${c.map((v) => v.toFixed(2))}`);
});
