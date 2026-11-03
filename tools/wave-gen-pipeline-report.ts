// Wave GEN lane P: measures the staged body pipeline and writes
//   artifacts/wave-gen/pipeline/report.json  (every number below)
//   docs/wave-gen/PIPELINE.md                (generated from that JSON; never hand-typed)
// Run: deno run -A tools/wave-gen-pipeline-report.ts   (~2 min)
// HEAD hashes: artifacts/wave-gen/pipeline/head-hashes.json, produced by artifacts/wave-gen/pipeline/hashes.ts
// run on `git archive 6a5f588` (see the doc's identity section for the exact commands).
import { anatomyFor } from "../src/graphics/body/Anatomy.ts";
import { generateBody, skinBoundsOf, skinField } from "../src/graphics/body/BodyMesh.ts";
import { polygonizeField } from "../src/graphics/body/Polygonize.ts";
import { applyMeshBrushes } from "../src/graphics/body/Brushes.ts";
import { generateStaged, STAGE_IDS, type StagedBody } from "../src/graphics/body/Pipeline.ts";
import { CAGE_PARTS, CAGE_SCULPT_ROOM, cageFor, clampTree, partBoxes } from "../src/graphics/body/Cage.ts";
import type { BodySpec, GeneratorStats, MeshData } from "../src/graphics/body/contracts.ts";
import { generatorStats, RUNTIME_ANCHORS, SHEET_ANCHORS } from "../src/game/StatScale.ts";
import { PRESETS } from "../src/game/Characters.ts";
import { RACES } from "../src/game/Races.ts";

const OUT_JSON = "artifacts/wave-gen/pipeline/report.json", OUT_MD = "docs/wave-gen/PIPELINE.md";
const MIN: GeneratorStats = { strength: 0, agility: 0, intelligence: 0, level: 0 };
const MAX: GeneratorStats = { strength: 1000, agility: 1000, intelligence: 1000, level: 1000 };
const specOf = (race: string, sex: "male" | "female", stats?: GeneratorStats): BodySpec => ({
  race, subrace: null, className: "Warrior", height: 1.75, weight: 75, seed: 1234567, sex, ...(stats ? { stats } : {}),
});

async function hash(buf: ArrayBufferView | string): Promise<string> {
  const data = typeof buf === "string" ? new TextEncoder().encode(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const d = await crypto.subtle.digest("SHA-256", data.slice() as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(d)).slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function meshHash(m: MeshData): Promise<string> {
  return [await hash(m.positions), await hash(m.normals), await hash(m.indices), await hash(m.region), await hash(m.bone ?? new Uint8Array())].join(":");
}
const r = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

// 1. Stage records for samples.
const samples: { name: string; spec: BodySpec }[] = [
  { name: "human male, no stats", spec: specOf("human", "male") },
  { name: "ork male, max stats", spec: specOf("ork", "male", MAX) },
  { name: "elf female, min stats", spec: specOf("elf", "female", MIN) },
  { name: "dwarf female, Sir Aldric's sheet", spec: { ...specOf("dwarf", "female"), stats: generatorStats(PRESETS[0]) } },
];
const stageSamples = samples.map(({ name, spec }) => {
  const s: StagedBody = generateStaged(spec);
  return { name, stats: spec.stats ?? null, stages: s.stages.map((x) => ({ id: x.id, ms: r(x.ms, 1), metrics: Object.fromEntries(Object.entries(x.metrics).map(([k, v]) => [k, r(v, 3)])), warnings: x.warnings })) };
});
console.log("stages done");

// 2. Byte identity: pipeline vs the pre-wave composition (current tree) and vs HEAD 6a5f588.
const head = JSON.parse(await Deno.readTextFile("artifacts/wave-gen/pipeline/head-hashes.json")) as Record<string, { mesh: string; physics: string; skin: string }>;
const identity = [];
for (const race of ["human", "elf", "dwarf", "ork"]) for (const sex of ["male", "female"] as const) {
  const spec = specOf(race, sex);
  const b = generateBody(spec);
  const plan = anatomyFor(spec);
  const legacy = polygonizeField(skinField(plan), skinBoundsOf(plan), plan.skinCell ?? plan.cell);
  applyMeshBrushes(legacy, plan.strokes);
  const mesh = await meshHash(b.mesh);
  const physics = await hash(JSON.stringify({ root: b.plan.root, bones: b.plan.bones, bounds: b.plan.bounds, cell: b.plan.cell }));
  identity.push({
    spec: `${race}/${sex}`, mesh, legacyEqual: mesh === await meshHash(legacy),
    headMeshEqual: mesh === head[`${race}/${sex}`].mesh, headPhysicsEqual: physics === head[`${race}/${sex}`].physics,
  });
}
console.log("identity done");

// 3. Cage: measured sculpt room and containment sweep at absent stats.
const sculptRoom: Record<string, number[]> = {};
let sweep = 0, sweepViolations = 0, sweepWorstMm = 0;
for (const race of RACES) for (const sub of [null, ...race.subspecies.map((s) => s.id)]) for (const sex of ["male", "female"] as const) {
  for (const [h, w, seed, belly] of [[1.55, 45, 3, 1], [1.95, 140, 5, 1], [1.75, 75, 9, 0], [1.7, 90, 21, null]] as const) {
    const spec: BodySpec = { race: race.id, subrace: sub, className: "Warrior", height: h, weight: w, seed, sex, belly };
    const plan = anatomyFor(spec);
    const a = partBoxes(plan.root), b = partBoxes(plan.skinRoot);
    for (const id of CAGE_PARTS) {
      const ex = [0, 1, 2].flatMap((k) => [(a[id]!.min[k] - b[id]!.min[k]) / h, (b[id]!.max[k] - a[id]!.max[k]) / h]);
      sculptRoom[id] ??= [0, 0, 0, 0, 0, 0];
      ex.forEach((v, i) => sculptRoom[id][i] = Math.max(sculptRoom[id][i], v));
    }
    const c = clampTree(plan.skinRoot, cageFor(plan, spec));
    sweep++;
    if (c.before > 0) sweepViolations++;
    sweepWorstMm = Math.max(sweepWorstMm, c.before * 1000);
  }
}
console.log("cage sweep done");

// 4. Stats per stat level (cage + morph reach), human male.
const statSweep = [];
for (const v of [0, 250, 500, 750, 1000]) {
  const s = generateStaged(specOf("human", "male", { strength: v, agility: v, intelligence: v, level: v }), { hitboxes: true, paint: false, weights: false, coverageStride: 2 });
  const inf = s.stages.find((x) => x.id === "inflate")!.metrics, hb = s.stages.find((x) => x.id === "hitboxes")!.metrics;
  const box = s.cage.parts.torso;
  statSweep.push({
    stat: v, torsoCageWidthMm: r((box.neg[0] + box.pos[0]) * 1000, 1), clamped: inf.clampedPrimitives, beforeMm: r(inf.cageViolationBeforeMm, 2),
    afterMm: r(inf.cageViolationMm, 3), fill: r(inf.cageFill, 3), coveragePct: r(hb.coveragePct, 2), overshootP95Mm: r(hb.overshootP95Mm, 1), fromStatTree: hb.fromStatTree,
    warnings: s.stages.find((x) => x.id === "inflate")!.warnings,
  });
}
console.log("stat sweep done");

const presets = PRESETS.map((p) => ({ name: p.name, race: p.race, className: p.className, level: p.level, stats: Object.fromEntries(Object.entries(generatorStats(p)).map(([k, v]) => [k, r(v, 1)])) }));
const report = {
  generated: new Date().toISOString(), stageIds: STAGE_IDS, stageSamples, identity,
  anchors: { sheet: SHEET_ANCHORS, runtime: RUNTIME_ANCHORS }, presets,
  cage: { sculptRoomMmPerM: Object.fromEntries(Object.entries(sculptRoom).map(([k, v]) => [k, v.map((x) => r(x * 1000, 1))])), sculptRoomUsed: Object.fromEntries(Object.entries(CAGE_SCULPT_ROOM).map(([k, v]) => [k, v.map((x) => r(x * 1000, 2))])), sweep, sweepViolations, sweepWorstMm: r(sweepWorstMm, 3) },
  statSweep,
};
await Deno.mkdir("artifacts/wave-gen/pipeline", { recursive: true });
await Deno.writeTextFile(OUT_JSON, JSON.stringify(report, null, 1));

// ── the document ───────────────────────────────────────────────────────────────────────────────
const L: string[] = [];
const row = (c: (string | number | boolean)[]) => L.push(`| ${c.join(" | ")} |`);
L.push("# Wave GEN — the staged body pipeline (lane P)", "",
  `Generated by \`deno run -A tools/wave-gen-pipeline-report.ts\` from \`${OUT_JSON}\` (${report.generated}). Do not edit by hand.`, "",
  "## Stages", "",
  "`src/graphics/body/Pipeline.ts generateStaged(spec, opts?) -> StagedBody` runs `skeleton -> cage -> inflate -> carve -> skin -> hitboxes -> paint`",
  "and returns one `StageRecord {id, label, ms, metrics, warnings}` per stage. `generateBody(spec, cell?)` keeps its signature: it runs the",
  "same stages with weights, hitboxes and paint off and returns the carved plan, field, mesh and mesh stats (+ `stages`).", "",
  "| stage | output | maths |", "|---|---|---|",
  "| skeleton | bind bones (solved A-pose) + cross-section disks + T-pose joints (display only) | Anatomy (B), anim/SkeletonDisks (K) |",
  "| cage | 16 parts x 6 half-extents (-X,-Y,-Z,+X,+Y,+Z), per sub-race, scaled by stats | Cage.cageFor (P) |",
  "| inflate | SDF volumes (incl. B's stat morph) clamped into the cage | Anatomy/StatMorph (B), Cage.clampTree (P) |",
  "| carve | sculpt strokes + physique + cutters (the full plan) | Anatomy/Physique/Brushes (B) |",
  "| skin | Surface Nets mesh + mesh brushes + skin weights | Polygonize (P), SkinWeights (K) |",
  "| hitboxes | capsules fitted to `hitRoot ?? root` + coverage / overshoot vs the skin | combat/Hitboxes (P) |",
  "| paint | vertex colours + miniature pass | paint/PaintStage (S) |", "",
  "Timing note: `anatomyFor` solves bones and volumes together (abductions are solved against the volumes), so `inflate.ms` holds that",
  "solve + the clamp, and `skeleton` / `carve` are extractions (sub-ms).", "");
for (const s of stageSamples) {
  L.push(`### ${s.name}`, "", `stats: \`${JSON.stringify(s.stats)}\``, "", "| stage | ms | metrics | warnings |", "|---|---:|---|---|");
  for (const st of s.stages) row([st.id, st.ms, Object.entries(st.metrics).map(([k, v]) => `${k} ${v}`).join(", "), st.warnings.join("; ") || "-"]);
  L.push("");
}
L.push("## Byte identity with no stats", "",
  "`legacyEqual` = generateBody's mesh == the pre-wave composition (anatomyFor -> skinField -> polygonizeField at skinCell ?? cell -> applyMeshBrushes) on the",
  "current tree. `headMeshEqual` / `headPhysicsEqual` = equal to `generateBody` at 6a5f588 (`git archive HEAD | tar -x -C <scratch>`, then",
  "`deno run -A --config deno.json artifacts/wave-gen/pipeline/hashes.ts <scratch>`). Spec: Warrior, 1.75 m, 75 kg, seed 1234567.", "",
  "| spec | legacyEqual | headMeshEqual | headPhysicsEqual | mesh hash |", "|---|---|---|---|---|");
for (const i of identity) row([i.spec, i.legacyEqual, i.headMeshEqual, i.headPhysicsEqual, `\`${i.mesh.slice(0, 24)}…\``]);
L.push("", "The pipeline itself changes no body (legacyEqual everywhere). The dwarf and ork SKINS differ from HEAD because lane B's race",
  "posture / digit terms apply with or without stats (board Z-11) — an open decision for the parent; physics is identical for every race.", "");
L.push("## Stat scale (src/game/StatScale.ts)", "",
  "Piecewise linear `lo -> 0, ref -> 500, hi -> 1000`, clamped. `ref` = mean of the 32 reference fighters (class x race, no sub-race,",
  "level 1); `lo`/`hi` = min/max over every class x ancestry, widened by the creator's tweak span (sheet, 4) or 2 points (runtime).",
  "Level: 1 -> 500, 20 -> 1000 (the game spawns level 1 = identity; 0..500 is reachable only through the generator view).", "",
  "| attribute | sheet lo | sheet ref | sheet hi | runtime lo | runtime ref | runtime hi |", "|---|---:|---:|---:|---:|---:|---:|");
for (const a of ["strength", "agility", "intelligence"] as const) {
  row([a, r(SHEET_ANCHORS[a].lo), r(SHEET_ANCHORS[a].ref), r(SHEET_ANCHORS[a].hi), r(RUNTIME_ANCHORS[a].lo), r(RUNTIME_ANCHORS[a].ref), r(RUNTIME_ANCHORS[a].hi)]);
}
L.push("", "| preset | race | class | level | strength | agility | intelligence | level (gen) |", "|---|---|---|---:|---:|---:|---:|---:|");
for (const p of presets) row([p.name, p.race, p.className, p.level, p.stats.strength, p.stats.agility, p.stats.intelligence, p.stats.level]);
L.push("", "Wiring: `Characters.profileBodyStats(profile)` -> `BodySpec.stats` in `Engine.#spawnMeshes` (also `skeleton.setAgility` before the",
  "Animator / SwingDriver copy the limits) and in `PreviewScene.previewBody` (lane U). The body cache key is `JSON.stringify(spec)`, so it",
  "includes the stats (G15).", "");
L.push("## Cage (src/graphics/body/Cage.ts)", "",
  "Per part: the box of the physics tree's primitives (the reference: stats never touch `root`), widened per axis by the sub-race",
  "allowance (base 8 % X/Z x silhouette width/depth, 4 % Y x height), strength (+30 % X/Z on muscled parts, +5 % extremities at 1000;",
  "a quarter of that rate below 500), level (+5 % Y at 1000), a margin max(0.5 cell, 8 mm) and the measured physique-sculpt room per",
  "direction (below). The inflate stage shrinks a poking primitive's girth (bisection, >= 0.5) and slides a centred volume inward if that",
  "is not enough (warning). Primitive boxes are tight for rotated ellipsoids / round boxes (`primBox`).", "",
  `Containment sweep, no stats: ${report.cage.sweep} bodies (16 ancestries x 2 sexes x 4 builds incl. fat bellies), ${report.cage.sweepViolations} with any primitive outside its part (worst ${report.cage.sweepWorstMm} mm).`, "",
  "| part | measured sculpt room mm/m (-X +X -Y +Y -Z +Z) | used mm/m |", "|---|---|---|");
for (const id of CAGE_PARTS) row([id, report.cage.sculptRoomMmPerM[id].join(" "), report.cage.sculptRoomUsed[id].join(" ")]);
L.push("", "### All four stats swept together, human male", "",
  "| stat | torso cage width mm | clamped prims | violation before mm | after mm | fill | hitbox coverage % | overshoot p95 mm | fit from stat tree | warnings |",
  "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|");
for (const s of statSweep) row([s.stat, s.torsoCageWidthMm, s.clamped, s.beforeMm, s.afterMm, s.fill, s.coveragePct, s.overshootP95Mm, s.fromStatTree, s.warnings.join("; ") || "-"]);
L.push("", "## Hitboxes", "",
  "`hitboxesFromPlan` fits `plan.hitRoot ?? plan.root` inside `hitBounds ?? bounds` (B's hit tree = physics tree x stat terms, absent at the",
  "reference), so the capsules follow the stat body and the ragdoll keeps `root`. `hitboxCoverage(set, positions, field)` reports the share of",
  "skin vertices within radius + CONTACT_SLACK (10 mm) and the capsule surface's distance outside the skin (p95 / max).", "",
  "Tests: `tests/wave_gen_pipeline_test.ts` SPEC G1-G19.", "");
await Deno.writeTextFile(OUT_MD, L.join("\n"));
console.log(JSON.stringify({ identity, sweep: report.cage.sweep, sweepViolations: report.cage.sweepViolations, statSweep }, null, 1));
