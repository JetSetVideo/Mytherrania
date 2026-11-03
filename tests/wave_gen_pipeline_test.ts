// Wave GEN lane P — SPEC G1-G19: the staged pipeline (Pipeline.ts), the 6-axis cage (Cage.ts), the
// 0..1000 stat scale (StatScale.ts), stats from profiles/engine into the body spec, hitboxes refitted
// from the carved plan, and the byte-identity of generateBody with no stats.
import { anatomyFor } from "../src/graphics/body/Anatomy.ts";
import { generateBody, skinBoundsOf, skinField } from "../src/graphics/body/BodyMesh.ts";
import { polygonizeField } from "../src/graphics/body/Polygonize.ts";
import { applyMeshBrushes } from "../src/graphics/body/Brushes.ts";
import { generateStaged, runPipeline, STAGE_IDS, stageOf } from "../src/graphics/body/Pipeline.ts";
import {
  boxViolation, CAGE_PARTS, cageBox, cageFor, cageMetrics, clampPrimitive, clampTree, partBoxes, primBox,
} from "../src/graphics/body/Cage.ts";
import type { BodySpec, GeneratorStats, MeshData, Primitive, SdfNode } from "../src/graphics/body/contracts.ts";
import {
  generatorStats, generatorStatsFromCombat, isReferenceStats, levelToGenerator, mapAnchored, RUNTIME_ANCHORS, SHEET_ANCHORS,
  SHEET_TWEAK_SPAN, STAT_REFERENCE,
} from "../src/game/StatScale.ts";
import { ATTR_DELTA_SPAN, referenceProfiles } from "../src/game/DerivedSheet.ts";
import { PRESETS, profileBodyStats } from "../src/game/Characters.ts";
import { startingStats } from "../src/game/Leveling.ts";
import { applyRaceBonus, RACES } from "../src/game/Races.ts";
import { CLASSES, createStats, LEVEL_CAP } from "../src/game/Stats.ts";
import { hitboxesFromPlan } from "../src/combat/Hitboxes.ts";
import { buildSkinnedHumanoid } from "../src/graphics/body/SkinnedHumanoid.ts";
import { generateClassWeapon } from "../src/game/WeaponGen.ts";

// The repo's tests carry a local assert (deno lint forbids inline jsr: imports).
function assert(ok: unknown, msg = "assertion failed"): asserts ok { if (!ok) throw new Error(msg); }
function assertEquals(a: unknown, b: unknown, msg = ""): void {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg} expected ${y.slice(0, 300)} got ${x.slice(0, 300)}`);
}

const RACE_IDS = ["human", "elf", "dwarf", "ork"] as const;
const SEXES = ["male", "female"] as const;
const specOf = (race: string, sex: "male" | "female", stats?: GeneratorStats | null): BodySpec => ({
  race, subrace: null, className: "Warrior", height: 1.75, weight: 75, seed: 1234567, sex, ...(stats !== undefined ? { stats } : {}),
});
const MIN: GeneratorStats = { strength: 0, agility: 0, intelligence: 0, level: 0 };
const MAX: GeneratorStats = { strength: 1000, agility: 1000, intelligence: 1000, level: 1000 };

async function hash(buf: ArrayBufferView | string): Promise<string> {
  const data = typeof buf === "string" ? new TextEncoder().encode(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const d = await crypto.subtle.digest("SHA-256", data.slice() as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(d)).slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function meshHash(m: MeshData): Promise<string> {
  return [await hash(m.positions), await hash(m.normals), await hash(m.indices), await hash(m.region), await hash(m.bone ?? new Uint8Array())].join(":");
}

/**
 * Hashes of generateBody at base commit 6a5f588 (git archive HEAD, ~/.hermes scratch, same hash code),
 * spec = specOf(race, sex). `physics` = JSON of plan {root, bones, bounds, cell}. Meshes are pinned for
 * human and elf only: lane B's race posture / digit terms deliberately change the dwarf and ork SKIN with
 * or without stats (board Z-11; open item in docs/wave-gen/PIPELINE.md), never their physics.
 */
const HEAD: Record<string, { mesh?: string; physics: string }> = {
  "human/male": { mesh: "56037db943c9aab8375574c2:8793d4685d24da52e6fb74ef:903f48e8a2068fc4aabad61e:02f61494dad8b983b39fab30:224bca7e334e95eb201ce804", physics: "716457557001ec618acbb805" },
  "human/female": { mesh: "36f0b8ac595e27f333d0e3ed:e87c36789d6935d0c5e0e611:a5b0297442a06461119b860d:d0d4559c3586b1c90714c001:70cfd4b5b44a169d98bbc879", physics: "7b5e9d730c683fea7cd91803" },
  "elf/male": { mesh: "d93ab43f1331bc47c0a0a562:95297b84875f3a49b8bf3873:dbecebaf62b690a32280b847:c0a054790eaceb83fda2ea97:416e41f525f35b939514b51e", physics: "6153a6d7d1f610021d41f738" },
  "elf/female": { mesh: "7d86338c91a32af68fa94090:ed3c73bf96e857616a1e2606:2aed372894f75a9cd4172242:0efe33c820639f7b6ffa6969:b3b356b76b54feb849547c05", physics: "6c729048e9a8aa6ee301b1c8" },
  "dwarf/male": { physics: "53c02fef29dd4d4e7335e83d" },
  "dwarf/female": { physics: "16dc73df58f5c3772519e3bc" },
  "ork/male": { physics: "685999f189f4790e1523190f" },
  "ork/female": { physics: "7808de5352e7262ecbd7fde7" },
};

// Built once and shared (each body costs ~0.5 s).
const BODIES = new Map<string, ReturnType<typeof generateBody>>();
function body(race: string, sex: "male" | "female"): ReturnType<typeof generateBody> {
  const k = `${race}/${sex}`;
  if (!BODIES.has(k)) BODIES.set(k, generateBody(specOf(race, sex)));
  return BODIES.get(k)!;
}

Deno.test("SPEC G1: generateStaged returns one record per stage, in pipeline order, with timings and metrics", () => {
  assertEquals([...STAGE_IDS], ["skeleton", "cage", "inflate", "carve", "skin", "hitboxes", "paint"]);
  const s = generateStaged(specOf("human", "male"));
  assertEquals(s.stages.map((r) => r.id), [...STAGE_IDS]);
  for (const r of s.stages) {
    assert(Number.isFinite(r.ms) && r.ms >= 0, `${r.id} ms ${r.ms}`);
    assert(r.label.length > 0);
    assert(Object.keys(r.metrics).length > 0, `${r.id} has metrics`);
    for (const [k, v] of Object.entries(r.metrics)) assert(Number.isFinite(v), `${r.id}.${k} = ${v}`);
  }
  assert(s.skin && s.hitboxes && s.paint, "full run carries weights, hitboxes and paint");
  assertEquals(s.paint!.length, s.mesh.positions.length);
  assertEquals(stageOf(s, "paint").metrics.vertices, s.mesh.positions.length / 3);
});

Deno.test("SPEC G2: generateBody keeps its signature and returns the carved stage", () => {
  const b = body("human", "male");
  for (const k of ["plan", "field", "mesh", "stats", "timing"] as const) assert(b[k] !== undefined, k);
  for (const k of ["anatomyMs", "polygonizeMs", "sampleMs", "meshBrushMs", "statsMs", "totalMs", "corners"] as const) {
    assert(Number.isFinite(b.timing[k]), k);
  }
  assertEquals(b.stages?.map((r) => r.id), [...STAGE_IDS]);
  assert(stageOf(b as { stages: NonNullable<typeof b.stages> }, "hitboxes").warnings.length > 0, "generateBody skips the fit");
});

Deno.test("SPEC G3: with no stats generateBody == the pre-wave composition, byte for byte (8 race/sex specs)", async () => {
  for (const race of RACE_IDS) for (const sex of SEXES) {
    const spec = specOf(race, sex);
    const plan = anatomyFor(spec);
    const legacy = polygonizeField(skinField(plan), skinBoundsOf(plan), plan.skinCell ?? plan.cell); // B's skin cell rule
    applyMeshBrushes(legacy, plan.strokes);
    const b = body(race, sex);
    assertEquals(await meshHash(b.mesh), await meshHash(legacy), `${race}/${sex} mesh`);
    assertEquals(JSON.stringify(b.plan.skinRoot), JSON.stringify(plan.skinRoot), `${race}/${sex} skin tree`);
    assertEquals(JSON.stringify([b.plan.root, b.plan.bones, b.plan.bounds, b.plan.strokes]), JSON.stringify([plan.root, plan.bones, plan.bounds, plan.strokes]));
    assertEquals(stageOf(b as { stages: NonNullable<typeof b.stages> }, "inflate").metrics.clampedPrimitives, 0, `${race}/${sex}: the clamp is a no-op`);
  }
});

Deno.test("SPEC G4: with no stats the physics plan of every race and the human/elf meshes equal HEAD 6a5f588", async () => {
  for (const race of RACE_IDS) for (const sex of SEXES) {
    const k = `${race}/${sex}`, b = body(race, sex), want = HEAD[k];
    assertEquals(await hash(JSON.stringify({ root: b.plan.root, bones: b.plan.bones, bounds: b.plan.bounds, cell: b.plan.cell })), want.physics, `${k} physics`);
    if (want.mesh) assertEquals(await meshHash(b.mesh), want.mesh, `${k} mesh`);
  }
});

Deno.test("SPEC G5: stats null and stats at STAT_REFERENCE build the absent-stats body (identity morph)", async () => {
  for (const race of ["human", "ork"]) {
    const a = await meshHash(body(race, "male").mesh);
    assertEquals(await meshHash(generateBody(specOf(race, "male", null)).mesh), a, `${race} null`);
    assertEquals(await meshHash(generateBody(specOf(race, "male", { ...STAT_REFERENCE })).mesh), a, `${race} reference`);
  }
});

Deno.test("SPEC G6: the cage has 16 parts with 6 positive extents and contains the reference body (16 ancestries x 2 sexes)", () => {
  for (const r of RACES) for (const sub of [null, ...r.subspecies.map((s) => s.id)]) for (const sex of SEXES) {
    const spec: BodySpec = { race: r.id, subrace: sub, className: "Warrior", height: 1.7, weight: 80, seed: 99, sex };
    const plan = anatomyFor(spec);
    const cage = cageFor(plan, spec);
    assertEquals(Object.keys(cage.parts).sort(), [...CAGE_PARTS].sort());
    for (const id of CAGE_PARTS) for (const v of [...cage.parts[id].neg, ...cage.parts[id].pos]) assert(v > 0, `${r.id}/${sub} ${id}`);
    const boxes = partBoxes(plan.root);
    for (const id of CAGE_PARTS) assertEquals(boxViolation(boxes[id]!, cageBox(cage.parts[id])), 0, `${r.id}/${sub}/${sex} physics ${id}`);
    assertEquals(cageMetrics(plan.skinRoot, cage).cageViolationMm, 0, `${r.id}/${sub}/${sex} skin`);
  }
});

Deno.test("SPEC G7: the cage is identity at the reference and monotone: strength widens X/Z, level grows Y", () => {
  const spec = specOf("human", "male");
  const plan = anatomyFor(spec);
  assertEquals(JSON.stringify(cageFor(plan, { ...spec, stats: { ...STAT_REFERENCE } })), JSON.stringify(cageFor(plan, spec)));
  let prev: ReturnType<typeof cageFor> | null = null;
  for (const v of [0, 250, 500, 750, 1000]) {
    const c = cageFor(plan, { ...spec, stats: { strength: v, agility: 500, intelligence: 500, level: v } });
    if (prev) {
      for (const id of CAGE_PARTS) for (const k of [0, 1, 2]) {
        assert(c.parts[id].pos[k] >= prev.parts[id].pos[k] - 1e-12 && c.parts[id].neg[k] >= prev.parts[id].neg[k] - 1e-12, `${id} axis ${k} at ${v}`);
      }
      assert(c.parts.torso.pos[0] > prev.parts.torso.pos[0], "strength widens the torso");
      assert(c.parts.torso.pos[1] > prev.parts.torso.pos[1], "level grows the torso's height room");
    }
    prev = c;
  }
});

Deno.test("SPEC G8: the clamp shrinks girth (never moves a segment), slides only centred volumes, keeps fitting nodes", () => {
  const spec = specOf("human", "male");
  const plan = anatomyFor(spec);
  const cage = cageFor(plan, spec);
  const box = cageBox(cage.parts.thighL);
  const cx = (box.min[0] + box.max[0]) / 2, cz = (box.min[2] + box.max[2]) / 2;
  const fat: Primitive = { id: "t", kind: "capsule", a: [cx, box.max[1] - 0.1, cz], b: [cx, box.min[1] + 0.1, cz], r: 0.7 * Math.min(box.max[0] - box.min[0], box.max[2] - box.min[2]), bone: "hipL", region: "thigh" };
  const r = clampPrimitive(fat, cage);
  assert(r.clamped && r.violation === 0 && r.shiftMm === 0);
  assertEquals(r.prim.a, fat.a); assertEquals(r.prim.b, fat.b);
  assert(r.prim.r < fat.r && boxViolation(primBox(r.prim), box) === 0);
  // Outside even at the minimum girth: a segment stays (violation reported), a centred volume slides in.
  const far: Primitive = { id: "f", kind: "ellipsoid", a: [box.max[0] + 0.2, (box.min[1] + box.max[1]) / 2, cz], r: 0.05, size: [0.05, 0.05, 0.05], bone: "hipL", region: "thigh" };
  const s = clampPrimitive(far, cage);
  assert(s.clamped && s.violation === 0 && s.shiftMm > 200, `slid ${s.shiftMm}`);
  const seg: Primitive = { ...fat, id: "s", a: [box.max[0] + 0.2, box.max[1] - 0.1, cz], b: [box.max[0] + 0.2, box.min[1] + 0.1, cz], r: 0.02 };
  const g = clampPrimitive(seg, cage);
  assert(g.violation > 0.19 && g.prim.a === seg.a);
  // A tree that fits comes back as the SAME node.
  const t = clampTree(plan.skinRoot as SdfNode, cage);
  assert(t.node === plan.skinRoot && t.clamped === 0);
  const inside = clampPrimitive(plan.bones.length ? fat : fat, { ...cage, parts: { ...cage.parts, thighL: { centre: [cx, 0.5, cz], neg: [9, 9, 9], pos: [9, 9, 9] } } });
  assert(!inside.clamped && inside.prim === fat);
});

Deno.test("SPEC G9: after the inflate clamp cageViolationMm = 0 at min and max stats for every race", () => {
  for (const race of RACE_IDS) for (const stats of [MIN, MAX]) {
    const s = generateStaged(specOf(race, "male", stats), { hitboxes: false, paint: false, weights: false });
    const m = stageOf(s, "inflate").metrics;
    assertEquals(m.cageViolationMm, 0, `${race} ${stats.strength}`);
    assertEquals(cageMetrics(s.carved.skinRoot, s.cage).cageViolationMm, 0);
    if (s.carved.hitRoot) assertEquals(cageMetrics(s.carved.hitRoot, s.cage).cageViolationMm, 0);
    assertEquals(stageOf(s, "skin").metrics.components, 1, `${race} ${stats.strength} skin one piece`);
  }
});

Deno.test("SPEC G10: cageFill is a share in (0, 1] and the reference body fills 40-70 % of its cage on average", () => {
  for (const race of RACE_IDS) {
    const m = stageOf(body(race, "male") as { stages: NonNullable<ReturnType<typeof generateBody>["stages"]> }, "inflate").metrics;
    assert(m.cageFill > 0.4 && m.cageFill < 0.7, `${race} fill ${m.cageFill}`);
    assert(m.cageFillMin > 0 && m.cageFillMin <= m.cageFill);
  }
});

Deno.test("SPEC G11: StatScale maps the reference fighter to 500, is monotone and clamped; level 1 -> 500, cap -> 1000", () => {
  for (const a of ["strength", "agility", "intelligence"] as const) {
    for (const A of [SHEET_ANCHORS[a], RUNTIME_ANCHORS[a]]) {
      assert(A.lo < A.ref && A.ref < A.hi, `${a} anchors ${JSON.stringify(A)}`);
      assertEquals(mapAnchored(A.ref, A), 500);
      assertEquals(mapAnchored(A.lo - 5, A), 0);
      assertEquals(mapAnchored(A.hi + 5, A), 1000);
      let prev = -1;
      for (let v = A.lo - 2; v <= A.hi + 2; v += 0.25) { const m = mapAnchored(v, A); assert(m >= prev); prev = m; }
    }
    // The anchors ARE the game tables: ref = mean of the 32 reference fighters' sheets / runtime blocks.
    const sheets = referenceProfiles().map((p) => startingStats(p.className, p.race, null).allocated[a]);
    assert(Math.abs(SHEET_ANCHORS[a].ref - sheets.reduce((s, v) => s + v, 0) / sheets.length) < 1e-9);
    const rt = CLASSES.flatMap((c) => RACES.map((r) => applyRaceBonus(createStats(c), r.id, null)[a]));
    assert(Math.abs(RUNTIME_ANCHORS[a].ref - rt.reduce((s, v) => s + v, 0) / rt.length) < 1e-9);
  }
  assertEquals(levelToGenerator(1), 500);
  assertEquals(levelToGenerator(LEVEL_CAP), 1000);
  assertEquals(levelToGenerator(0), 500);
  assertEquals(levelToGenerator(99), 1000);
  assert(levelToGenerator(10) > levelToGenerator(9));
  assert(isReferenceStats(null) && isReferenceStats({ ...STAT_REFERENCE }) && !isReferenceStats(MAX));
});

Deno.test("SPEC G12: every class x ancestry starting sheet maps inside 0..1000 and orders the classes as the sheet does", () => {
  for (const c of CLASSES) for (const r of RACES) for (const sub of [null, ...r.subspecies.map((s) => s.id)]) {
    const g = generatorStats({ className: c, race: r.id, subrace: sub, allocated: {}, level: 1 });
    for (const v of Object.values(g)) assert(v >= 0 && v <= 1000);
    assert(g.strength > 0 && g.strength < 1000, `${c}/${r.id}/${sub} strength strictly inside (tweak room both ways)`);
    assertEquals(g.level, 500);
  }
  const str = (c: typeof CLASSES[number]) => generatorStats({ className: c, race: "human", subrace: null, allocated: {}, level: 1 }).strength;
  assert(str("Barbarian") > str("Warrior") && str("Warrior") > str("Mage"), "barbarian > warrior > mage strength");
  const rt = generatorStatsFromCombat(createStats("Barbarian"), 20);
  assert(rt.strength > 500 && rt.level === 1000);
});

Deno.test("SPEC G13: SHEET_TWEAK_SPAN is the creator's tweak window (DerivedSheet.ATTR_DELTA_SPAN)", () => {
  assertEquals(SHEET_TWEAK_SPAN, ATTR_DELTA_SPAN);
});

Deno.test("SPEC G14: profiles and the engine carry stats into the body spec (and agility into the skeleton)", async () => {
  for (const p of PRESETS) assertEquals(profileBodyStats(p), generatorStats(p));
  const src = await Deno.readTextFile(new URL("../src/engine/Engine.ts", import.meta.url));
  const spawn = src.slice(src.indexOf("#spawnMeshes() {"), src.indexOf("#armCombat(f, rig);"));
  assert(/const bodyStats = profileBodyStats\(profiles\[i\]\);/.test(spawn), "engine derives the stats from the profile");
  assert(/stats: bodyStats,/.test(spawn), "the stats ride on the body spec");
  const agi = spawn.indexOf("f.skeleton.setAgility(bodyStats.agility)"), anim = spawn.indexOf("new Animator(");
  assert(agi > 0 && agi < anim, "agility set before the Animator copies the limit table");
  const pv = await Deno.readTextFile(new URL("../src/graphics/PreviewScene.ts", import.meta.url));
  assert(/\bstats: [^\n]*(generatorStats|profileBodyStats)\(profile\)/.test(pv), "the Creator preview carries the stats too (lane U)");
});

Deno.test("SPEC G15: the body cache key includes the stats (different stats = different body, same stats = cache hit)", () => {
  const w = generateClassWeapon("Warrior");
  const app = { body: "#ef7455", accent: "#dfaa55", height: 1.75, weight: 75, eyes: "#172128" };
  const base = specOf("human", "male");
  const strong = { ...base, stats: { ...STAT_REFERENCE, strength: 900 } };
  const a1 = buildSkinnedHumanoid(w, app, "fire", strong, { paint: false });
  const b = buildSkinnedHumanoid(w, app, "fire", { ...base, stats: { ...STAT_REFERENCE, strength: 100 } }, { paint: false });
  const a2 = buildSkinnedHumanoid(w, app, "fire", { ...strong }, { paint: false });
  assert(a1.plan !== b.plan, "different stats, different body");
  assert(a1.plan === a2.plan, "same stats hit the cache");
  assert(JSON.stringify(a1.plan.skinRoot) !== JSON.stringify(b.plan.skinRoot), "and the bodies really differ");
});

Deno.test("SPEC G16: the hitboxes stage wraps the skin (coverage >= 95 %, overshoot p95 <= 40 mm) at min / reference / max", () => {
  for (const race of ["human", "ork"]) for (const stats of [MIN, null, MAX]) {
    const s = generateStaged(specOf(race, "male", stats), { paint: false, weights: false, coverageStride: 2 });
    const m = stageOf(s, "hitboxes").metrics;
    assert(m.capsules >= 30, `${race} capsules ${m.capsules}`);
    assert(m.coveragePct >= 95, `${race} ${stats?.strength ?? "ref"} coverage ${m.coveragePct}`);
    assert(m.overshootP95Mm <= 40, `${race} overshoot ${m.overshootP95Mm}`);
    // B's hit tree exists when the stat terms OR the race posture are non-identity (ork: always; human: only off the reference).
    assertEquals(m.fromStatTree, stats === null && race === "human" ? 0 : 1, "fitted from B's hit tree exactly when it exists");
  }
});

Deno.test("SPEC G17: Hitboxes fit hitRoot ?? root — the stat tree moves the capsules, no hit tree = today's fit", () => {
  const plan = generateStaged(specOf("human", "male", MAX), { hitboxes: false, paint: false, weights: false }).carved;
  assert(plan.hitRoot, "a non-reference body carries B's stat hit tree");
  const withStat = hitboxesFromPlan(plan);
  const physicsOnly = hitboxesFromPlan({ ...plan, hitRoot: undefined, hitBounds: undefined });
  const ref = hitboxesFromPlan(body("human", "male").plan);
  assertEquals(JSON.stringify(physicsOnly.boxes.map((b) => [b.a, b.b, b.radius])), JSON.stringify(ref.boxes.map((b) => [b.a, b.b, b.radius])), "physics unchanged by stats");
  assert(JSON.stringify(withStat.boxes.map((b) => b.radius)) !== JSON.stringify(physicsOnly.boxes.map((b) => b.radius)), "the stat body refits");
});

Deno.test("SPEC G18: the pipeline is deterministic (same spec = same mesh, cage and metrics)", async () => {
  const spec = specOf("dwarf", "female", { strength: 800, agility: 300, intelligence: 700, level: 650 });
  const a = runPipeline(spec, { hitboxes: false, paint: false }).staged, b = runPipeline(spec, { hitboxes: false, paint: false }).staged;
  assertEquals(await meshHash(a.mesh), await meshHash(b.mesh));
  assertEquals(JSON.stringify(a.cage), JSON.stringify(b.cage));
  for (const id of STAGE_IDS) {
    const strip = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).filter(([k]) => !/Ms$/.test(k)));
    assertEquals(strip(stageOf(a, id).metrics), strip(stageOf(b, id).metrics), id);
  }
});

Deno.test("SPEC G19: the skeleton stage = the bind bones + disks + a T-pose with horizontal arms (bind pose untouched)", () => {
  const s = generateStaged(specOf("elf", "female"), { hitboxes: false, paint: false, weights: false });
  assert(s.skeleton.bones === s.carved.bones, "the bind bones are the plan's");
  assert(s.skeleton.disks.length > s.skeleton.bones.length);
  for (const d of s.skeleton.disks) assert(d.rx > 0 && d.rz > 0 && Math.abs(Math.hypot(...d.normal) - 1) < 1e-6, d.bone);
  const t = s.skeleton.tPose;
  for (const side of ["L", "R"] as const) {
    const sh = t[`shoulder${side}`], el = t[`elbow${side}`];
    assert(Math.abs(el[1] - sh[1]) < 1e-6, `${side} upper arm horizontal in the T-pose`);
  }
  const bindElbow = s.carved.bones.find((b) => b.id === "elbowL")!.head, bindShoulder = s.carved.bones.find((b) => b.id === "shoulderL")!.head;
  assert(bindShoulder[1] - bindElbow[1] > 0.1, "the bind pose stays the solved A-pose");
  // The inflate view is the carved plan without sculpt strokes.
  assertEquals(s.plan.strokes.length, 0);
  assert(s.carved.strokes.length > 0);
});
