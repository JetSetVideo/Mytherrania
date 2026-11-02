// Lane R (V03): the ragdoll MODEL of the real skinned body — segments, masses, limits, and the
// rig round trip (seed from the bones → write the bones back unchanged).
import { buildRagdollModel, LATERAL_LIMITS, type RagdollBoneInput } from "../src/physics/ragdoll/RagdollModel.ts";
import { Ragdoll } from "../src/physics/ragdoll/RagdollSolver.ts";
import { captureBoneWorld, ragdollModelForRig } from "../src/physics/ragdoll/RigBinding.ts";
import { clampAngle, qFromFlexAbductTwist, qToFlexAbductTwist } from "../src/physics/ragdoll/QuatMath.ts";
import { muscleTone, STATUS_TONE } from "../src/physics/ragdoll/MuscleTone.ts";
import { rng32 } from "../src/core/MathCore.ts";
import { footprintRadius } from "../src/physics/ArenaPhysics.ts";
import { hitboxesFromPlan } from "../src/combat/Hitboxes.ts";
import { poseRig, realBody } from "./ragdoll_fixtures.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

Deno.test("RAGDOLL QUAT: flex/abduct/twist decomposition round-trips (|abduct| < π/2)", () => {
  const rnd = rng32(7), q = new Float64Array(4), a = new Float64Array(3);
  for (let i = 0; i < 2000; i++) {
    const f = (rnd() * 2 - 1) * 3, b = (rnd() * 2 - 1) * 1.4, t = (rnd() * 2 - 1) * 3;
    qFromFlexAbductTwist(q, 0, f, b, t);
    qToFlexAbductTwist(a, 0, q, 0);
    assert(Math.abs(a[0] - f) < 1e-9 && Math.abs(a[1] - b) < 1e-9 && Math.abs(a[2] - t) < 1e-9, `round trip ${f},${b},${t} -> ${[...a]}`);
  }
  assert(clampAngle(-3.1, -2.6, 0) === -2.6 && clampAngle(3.1, -2.6, 0) === -2.6 && clampAngle(0.4, -2.6, 0) === 0, "clamp picks the nearer bound by angle");
});

Deno.test("RAGDOLL MODEL: one segment per bone of the real rig (light feet welded), mass = body mass, limits from the Skeleton", () => {
  const b = realBody();
  const m = ragdollModelForRig(b.rig, b.boxes, b.skeleton.limits());
  const welded = m.boneIds.filter((_, i) => m.boneWelded[i]).sort();
  assert(JSON.stringify(welded) === JSON.stringify(["ankleL", "ankleR", "toeL", "toeR"]), `welded light leaves: ${welded}`);
  assert(m.boneIds.length === b.rig.plan.bones.length && m.n === m.boneIds.length - 1 - welded.length, `12 segments for 17 bones, got ${m.n}`);
  assert(m.boneIds[m.segBone[m.baseSegment]] === "spine", "the chest (spine bone) is the floating base");
  const total = Array.from(m.mass).reduce((s, x) => s + x, 0);
  assert(Math.abs(total - b.boxes.mass) < 1e-9, `segment masses sum to ${total} vs ${b.boxes.mass}`);
  const seg = (id: string) => m.segOfBone[m.boneIds.indexOf(id)];
  // Knee: Skeleton [-2.4, 0] with rig sign −1 -> flex [0, 2.4]; a pure hinge (no abduct/twist).
  const k = seg("kneeL") * 6;
  assert(Math.abs(m.limits[k] - 0) < 1e-12 && Math.abs(m.limits[k + 1] - 2.4) < 1e-12, "knee flex range from the Skeleton (signed)");
  assert(m.limits[k + 2] === 0 && m.limits[k + 3] === 0 && m.limits[k + 4] === 0 && m.limits[k + 5] === 0, "knee is a hinge");
  // Shoulders: abduction mirrored by side.
  const l = seg("shoulderL") * 6, r = seg("shoulderR") * 6;
  assert(m.limits[l + 3] === LATERAL_LIMITS.shoulder.abduct[1] && m.limits[r + 2] === -LATERAL_LIMITS.shoulder.abduct[1], "abduction mirrored");
  const elbow = b.skeleton.limits().get("elbowL")!;
  const e = seg("elbowL") * 6;
  assert(m.limits[e] === elbow.min && m.limits[e + 1] === elbow.max, "elbow flex = Skeleton limits");
  // Self-collision never tests a parent against its child.
  for (let i = 0; i < m.pairs.length; i += 2) {
    const [p, q] = [m.pairs[i], m.pairs[i + 1]];
    assert(m.segParent[p] !== q && m.segParent[q] !== p, "no adjacent pair");
  }
  const foot = footprintRadius(hitboxesFromPlan(b.rig.plan, { mass: 70 }).boxes);
  assert(foot > 0.2 && foot < 0.5, `wall footprint radius ${foot}`);
  console.log(`  wall footprint radius ${foot.toFixed(3)} m; segments ${m.n}, contact spheres ${m.sphereSeg.length}, self pairs ${m.pairs.length / 2}, masses ${Array.from(m.mass).map((x) => x.toFixed(2)).join(" ")}`);
});

Deno.test("RAGDOLL RIG: seeding from the bones and writing them back reproduces the pose (round trip)", () => {
  const b = realBody();
  // Wave X: the ragdoll's ankle is a hinge and cannot hold the render-only foot turn-out (a yaw), so
  // the exact round trip is checked without it. KNOWN GAP: at ragdoll start the 9° turn-out is
  // dropped (the feet snap straight as the body goes limp).
  b.skeleton.legRoll.toeOut.fill(0);
  poseRig(b, 1.5, 0.2, -2, 0.7);
  // Bend a few joints so the round trip is not the rest pose.
  b.rig.bones.get("elbowL")!.quaternion.setFromAxisAngle({ x: 1, y: 0, z: 0 } as never, -1.1);
  b.rig.bones.get("kneeR")!.quaternion.setFromAxisAngle({ x: 1, y: 0, z: 0 } as never, 0.9);
  b.rig.group.updateMatrixWorld(true);
  const m = ragdollModelForRig(b.rig, b.boxes, b.skeleton.limits());
  const rd = new Ragdoll(m);
  const world = captureBoneWorld(b.rig, new Float64Array(m.boneIds.length * 7));
  rd.seed({ boneWorld: world, velocity: [0, 0, 0] });
  const out = new Float64Array(m.boneIds.length * 7);
  rd.writeBones(out);
  // Compare world poses: compose the written locals and compare with the captured world.
  const qW = new Float64Array(m.boneIds.length * 4), oW = new Float64Array(m.boneIds.length * 3);
  for (let i = 0; i < m.boneIds.length; i++) {
    const p = m.boneParent[i];
    if (p < 0) { qW.set(out.subarray(i * 7, i * 7 + 4), i * 4); oW.set(out.subarray(i * 7 + 4, i * 7 + 7), i * 3); continue; }
    // q_world = q_parent ⊗ q_local; o_world = o_parent + q_parent · p_local.
    const [ax, ay, az, aw] = qW.subarray(p * 4, p * 4 + 4), [bx, by, bz, bw] = out.subarray(i * 7, i * 7 + 4);
    qW.set([aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz], i * 4);
    const [x, y, z] = out.subarray(i * 7 + 4, i * 7 + 7);
    const tx = 2 * (ay * z - az * y), ty = 2 * (az * x - ax * z), tz = 2 * (ax * y - ay * x);
    oW.set([oW[p * 3] + x + aw * tx + (ay * tz - az * ty), oW[p * 3 + 1] + y + aw * ty + (az * tx - ax * tz), oW[p * 3 + 2] + z + aw * tz + (ax * ty - ay * tx)], i * 3);
  }
  let worstQ = 0, worstP = 0;
  for (let i = 0; i < m.boneIds.length; i++) {
    const dot = Math.abs(qW[i * 4] * world[i * 7] + qW[i * 4 + 1] * world[i * 7 + 1] + qW[i * 4 + 2] * world[i * 7 + 2] + qW[i * 4 + 3] * world[i * 7 + 3]);
    worstQ = Math.max(worstQ, 1 - dot);
    worstP = Math.max(worstP, Math.hypot(oW[i * 3] - world[i * 7 + 4], oW[i * 3 + 1] - world[i * 7 + 5], oW[i * 3 + 2] - world[i * 7 + 6]));
  }
  assert(worstQ < 1e-9 && worstP < 1e-6, `round trip error: rotation ${worstQ}, position ${worstP} m`);
});

Deno.test("RAGDOLL MODEL: a minimal chain builds; a capsule-less leaf is welded to its parent", () => {
  const bones: RagdollBoneInput[] = [
    { id: "root", parent: null, localPosition: [0, 1, 0], restRotation: [0, 0, 0, 1], capsules: [] },
    { id: "spine", parent: "root", localPosition: [0, 0.3, 0], restRotation: [0, 0, 0, 1], capsules: [{ a: [0, -0.1, 0], b: [0, 0.1, 0], radius: 0.12 }] },
    { id: "neck", parent: "spine", localPosition: [0, 0.2, 0], restRotation: [0, 0, 0, 1], capsules: [] },
  ];
  const m = buildRagdollModel(bones, new Map([["neck", { min: -0.5, max: 0.5 }]]), 10);
  assert(m.n === 1 && m.baseSegment === 0 && m.boneWelded[2] === 1 && Math.abs(m.mass[0] - 10) < 1e-9, "the weightless neck leaf is welded; mass kept");
  const out = new Float64Array(3 * 7);
  const rd = new Ragdoll(m);
  rd.seed({ boneWorld: Float64Array.from([0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 1.3, 0, 0, 0, 0, 1, 0, 1.5, 0]), velocity: [0, 0, 0] });
  rd.writeBones(out);
  assert(out[2 * 7 + 3] === 1 && Math.abs(out[2 * 7 + 5] - 0.2) < 1e-12, "a welded bone is written at its rest rotation and offset");
});

Deno.test("MUSCLE TONE: fresh braces, KO / hypnosis is limp, exhaustion and the damage meter weaken it", () => {
  const base = { hpFraction: 1, staminaFraction: 1, damagePercent: 0, strength: 37 / 8, statuses: [] as string[] };
  assert(muscleTone(base).tone === 1 && Math.abs(muscleTone(base).torqueScale - 1) < 1e-12, "fresh = full tone at the reference strength");
  assert(muscleTone({ ...base, hpFraction: 0 }).tone === 0, "KO = limp");
  assert(muscleTone({ ...base, statuses: ["hypnotised"] }).tone === STATUS_TONE.hypnotised, "hypnotised = limp");
  assert(Math.abs(muscleTone({ ...base, damagePercent: 60 }).tone - 0.5) < 1e-12, "knockback law: 60% meter halves the tone");
  assert(muscleTone({ ...base, staminaFraction: 0 }).tone < muscleTone({ ...base, staminaFraction: 0.5 }).tone, "stamina feeds tone");
  assert(muscleTone({ ...base, strength: 9 }).torqueScale > muscleTone({ ...base, strength: 2 }).torqueScale, "strength feeds torque");
});

Deno.test("RAGDOLL DRIVER: start owns the bones (group at identity, the mesh moves); stop hands back the rest pose", async () => {
  const { RagdollDriver } = await import("../src/physics/ragdoll/RigBinding.ts");
  const { flatGroundWorld } = await import("../src/physics/ragdoll/RagdollWorld.ts");
  const b = realBody();
  const d = new RagdollDriver(b.rig, b.boxes, b.skeleton.limits());
  poseRig(b, 2, 1, -1, 1.1);
  const root = b.rig.bones.get("root")!;
  const restPos = root.position.toArray(), restQ = root.quaternion.toArray();
  d.start({ condition: { hpFraction: 0, staminaFraction: 1, damagePercent: 0, strength: 5, statuses: [] }, velocity: [4, 3, 0] });
  for (let f = 0; f < 30; f++) d.update(1 / 60, flatGroundWorld(0));
  assert(b.rig.group.position.length() === 0 && b.rig.group.rotation.y === 0, "the group sits at the identity while the ragdoll owns the bones");
  assert(Math.hypot(root.position.x - 2, root.position.z + 1) > 0.5, "the root bone carries the world pose (the body moved)");
  d.stop();
  assert(root.position.toArray().every((v, i) => Math.abs(v - restPos[i]) < 1e-12), "root position restored");
  assert(root.quaternion.toArray().every((v, i) => Math.abs(v - restQ[i]) < 1e-12), "root rotation restored");
  assert(!d.active, "inactive after stop");
});
