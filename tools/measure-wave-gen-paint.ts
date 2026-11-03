// Wave GEN lane S: headless measurements of the miniature paint pass, the paint stage record and
// intelligence -> hair, written to artifacts/wave-gen/paint/measure.json, then docs/wave-gen/PAINT.md is
// GENERATED from that JSON plus the Chrome probe's artifacts/qa-wave-gen/paint/report.json (if present).
//   deno run -A tools/measure-wave-gen-paint.ts
import { generateBody } from "../src/graphics/body/BodyMesh.ts";
import type { BodySpec } from "../src/graphics/body/contracts.ts";
import { paintStage } from "../src/graphics/paint/PaintStage.ts";
import { MINIATURE, PAINT_MAX_DARK } from "../src/graphics/paint/Miniature.ts";
import { anatomyFor } from "../src/graphics/body/Anatomy.ts";
import { ancestryOf } from "../src/game/Ancestry.ts";
import { greyFraction, LIFESPAN, lifeFraction } from "../src/game/Age.ts";
import { hairLengthM } from "../src/graphics/body/Proportions.ts";
import { headFrameOf } from "../src/graphics/body/HairFollicles.ts";
import { buildHairData, HAIR_TRI_BUDGET, type HairInput } from "../src/graphics/body/HairMesh.ts";
import { HAIR_INTELLECT } from "../src/graphics/body/HairIntellect.ts";

const OUT = "artifacts/wave-gen/paint";
await Deno.mkdir(OUT, { recursive: true });
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// --- paint ---------------------------------------------------------------------------------------
const paint: Record<string, unknown>[] = [];
for (const race of ["human", "elf", "dwarf", "ork"]) for (const sex of ["male", "female"]) {
  const spec = { race, subrace: null, className: "Warrior", height: 1.75, weight: 75, seed: 7, sex } as BodySpec;
  const b = generateBody(spec);
  const v = paintStage(b.mesh, spec, b.plan.cell, {}, { miniature: 0 }).record.metrics;
  const runs = Array.from({ length: 7 }, () => paintStage(b.mesh, spec, b.plan.cell, {}, { metrics: false }).record);
  const g = paintStage(b.mesh, spec, b.plan.cell).record.metrics;
  paint.push({
    race, sex, vertices: g.vertices,
    contrastV: v.ridgeCavityContrast, contrastGen: g.ridgeCavityContrast, ridgeV: v.ridgeRatio, ridgeGen: g.ridgeRatio, cavityV: v.cavityRatio, cavityGen: g.cavityRatio,
    topGen: g.topRatio, bottomGen: g.bottomRatio, weatheredShare: g.weatheredShare,
    stageMs: median(runs.map((r) => r.ms)), layersMs: median(runs.map((r) => r.metrics.layersMs)), formMs: median(runs.map((r) => r.metrics.formMs)), miniatureMs: median(runs.map((r) => r.metrics.miniatureMs)),
  });
}

// --- hair ----------------------------------------------------------------------------------------
const ANC: [string, string | null][] = [["human", null], ["human", "nomad"], ["elf", null], ["elf", "wood"], ["dwarf", null], ["dwarf", "mountain"], ["ork", null], ["ork", "bloodfang"]];
const hair: Record<string, unknown>[] = [];
for (const [race, sub] of ANC) for (const elder of [false, true]) {
  const plan = anatomyFor({ race, subrace: sub, className: "Warrior", height: 1.7, weight: 70, seed: 7 });
  const node = ancestryOf(race, sub), f = headFrameOf(plan.face, [0, 0, 0], plan.proportions.head, node.ears.lengthMul);
  const years = elder ? 0.75 * LIFESPAN[race] : undefined;
  for (const I of [0, 500, 1000]) {
    const inp: HairInput = {
      frame: f, spec: node.hair, lengthM: hairLengthM(node, f.h), seed: 11, race, ancestryIds: [race, sub ?? ""], sex: "male",
      lifeFraction: lifeFraction(race, years), grey: greyFraction(race, years), baseHex: node.hair.colors[0], skinHex: node.skin.base, intelligence: I,
    };
    const d = buildHairData(inp);
    let s = 0, n = 0;
    for (const bf of d.groups.values()) for (let i = 0; i < bf.col.length; i += 3) { s += 0.2126 * bf.col[i] + 0.7152 * bf.col[i + 1] + 0.0722 * bf.col[i + 2]; n++; }
    hair.push({
      ancestry: `${race}/${sub ?? "-"}`, elder, intelligence: I, style: d.plan.style, tier: d.plan.tier, lengthM: d.plan.lengthM, density: d.stats.density,
      follicles: d.stats.follicles, clumps: d.stats.clumps, triangles: d.stats.triangles, ageGrey: d.stats.ageGrey, grey: d.stats.grey, silver: d.stats.silver, meanLum: s / Math.max(1, n),
    });
  }
}
const data = { generated: new Date().toISOString(), constants: { MINIATURE, PAINT_MAX_DARK, HAIR_INTELLECT, HAIR_TRI_BUDGET }, paint, hair };
await Deno.writeTextFile(`${OUT}/measure.json`, JSON.stringify(data, null, 2));

// --- PAINT.md (generated) --------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
let probe: any = null;
try { probe = JSON.parse(await Deno.readTextFile("artifacts/qa-wave-gen/paint/report.json")); } catch { probe = null; }
const f3 = (x: unknown) => (typeof x === "number" ? x.toFixed(3) : String(x));
const f1 = (x: unknown) => (typeof x === "number" ? x.toFixed(1) : String(x));
const table = (head: string[], rows: string[][]) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const md: string[] = [];
md.push("# Wave GEN — lane S: miniature paint, the paint stage, intelligence -> hair");
md.push("");
md.push("GENERATED by `deno run -A tools/measure-wave-gen-paint.ts` from `artifacts/wave-gen/paint/measure.json` and the Chrome probe's");
md.push("`artifacts/qa-wave-gen/paint/report.json` (`deno run -A tools/probe-wave-gen-paint.ts`). Do not edit by hand.");
md.push("");
md.push("## What changed");
md.push("");
md.push(table(["file", "role"], [
  ["`src/graphics/paint/Miniature.ts` (new, pure)", "edge highlight (fine mean curvature), cavity wash (Taubin non-shrinking low-pass depth, 2-ring soft), top-down chiaroscuro + zenithal light, garment weathering (grime rising from the ground + value noise), clamp: no channel below (1 − PAINT_MAX_DARK) × unpainted base; `miniatureMetrics`"],
  ["`src/graphics/paint/FormShade.ts`", "runs the miniature pass after the wave-V groove/ridge terms (shared 1-rings); `miniature` gain (0 = wave V exactly); `record` timings; QA switch `FORM_SHADE_QA`"],
  ["`src/graphics/paint/PaintStage.ts` (new, pure)", "`paintStage(mesh, spec, cell, look?, opts?) -> {paint, record}` for P's pipeline: same paint as `SkinnedHumanoid.paintSkin`, record `{id:'paint', ms, metrics, warnings}`"],
  ["`src/graphics/body/HairIntellect.ts` (new, pure)", "intelligence laws: length ×(0.7..1.45), follicle density ×(0.75..1.3) clamped to 1, grey share g + (1−g)·0.3·u and pigment drift 0.12·u toward silver-white above 500 only; identity at 500 / absent"],
  ["`src/graphics/body/HairMesh.ts`", "`HairInput.intelligence`; whole grey clumps stay at the AGE share, the extra share is the shader's salt-and-pepper sub-strand rate (`stats.greySub`) + pigment silvering toward the tips; the scalp underlayer keeps the age colour (no silver cap, Q2 r2); colours are per-channel max with the age-only colour (never darker); stats gain ageGrey/silver/greySub/lengthM/density"],
  ["`src/graphics/body/FaceParts.ts`", "optional 6th arg `stats` -> hair; brows/beard via `silveredHex` (per-channel max with the age-only colour)"],
  ["`src/graphics/paint/MiniatureQaPage.ts`", "QA-only page bundled by the probe (not in the game bundle)"],
]));
md.push("");
md.push("Per-frame cost is zero by construction: the pass writes the existing `color` vertex attribute at build time; no shader changed.");
md.push("");
md.push("## Paint: contrast and cost (headless, seed 7, 1.75 m, 75 kg; timings = median of 7 stage runs)");
md.push("");
md.push("Ratios are painted/unpainted sRGB luminance. Ridge = top decile of fine curvature κ, cavity = top decile of the broad cavity depth;");
md.push("contrast = ridge/cavity (1 = the paint does not separate them). Top/bottom = the top and bottom fifth of the height.");
md.push("");
md.push(table(["body", "verts", "contrast V -> GEN", "ridge V -> GEN", "cavity V -> GEN", "top", "bottom", "weathered cloth", "stage ms", "layers", "form", "miniature"],
  paint.map((p) => [`${p.race}/${p.sex}`, String(p.vertices), `${f3(p.contrastV)} -> ${f3(p.contrastGen)}`, `${f3(p.ridgeV)} -> ${f3(p.ridgeGen)}`, `${f3(p.cavityV)} -> ${f3(p.cavityGen)}`, f3(p.topGen), f3(p.bottomGen), f3(p.weatheredShare), f1(p.stageMs), f1(p.layersMs), f1(p.formMs), f1(p.miniatureMs)])));
md.push("");
if (probe) {
  const s = probe.summary;
  md.push("## Real Chrome (dist-paint, port 8823; before = same bundle with FORM_SHADE_QA.miniature = 0)");
  md.push("");
  md.push(`Shots: **${s.shots}** PNGs in \`artifacts/qa-wave-gen/paint/\`; page errors: **${s.pageErrors}**; console errors: ${s.consoleErrors.length} (${[...new Set(s.consoleErrors)].join("; ")}).`);
  md.push("");
  md.push(table(["measure (mean of 24 shots)", "before", "after"], [
    ["upper/lower figure luminance (chiaroscuro)", f3(s.meanUpperLowerBefore), f3(s.meanUpperLowerAfter)],
    ["figure luminance std-dev", f3(s.meanStdBefore), f3(s.meanStdAfter)],
    ["draw ms (PreviewStage.draw, shadow + main pass, 30 draws)", f3(s.meanFrameMsBefore), f3(s.meanFrameMsAfter)],
  ]));
  md.push("");
  md.push(table(["shot", "upper/lower before", "after", "draw ms before", "after"],
    probe.pairs.map((p: Record<string, number | string>) => [`${p.race}-${p.sex}-${p.view}`, f3(p.upperLowerBefore), f3(p.upperLowerAfter), f3(p.frameMsBefore), f3(p.frameMsAfter)])));
  md.push("");
}
if (probe) {
  md.push("## Intelligence in real Chrome (the Creator's buildPreviewRig path, back three-quarter head shots `int-<race>-<age>-<I>.png`)");
  md.push("");
  md.push(table(["race", "age", "I", "style/tier", "length m", "follicles", "grey", "silver", "hair tris", "rig tris"],
    // deno-lint-ignore no-explicit-any
    probe.summary.hairByIntelligence.map((h: Record<string, any>) => [h.race, h.elder ? "elder" : "young", String(h.intelligence), `${h.hair?.style}/${h.hair?.tier}`, f3(h.hair?.lengthM), String(h.hair?.follicles), f3(h.hair?.grey), f3(h.hair?.silver), String(h.hair?.triangles), String(h.tris)])));
  md.push("");
}
md.push("## Intelligence -> hair (headless, seed 11, male; elder = 0.75 of the lifespan)");
md.push("");
md.push(table(["ancestry", "age", "I", "style/tier", "length m", "density", "follicles", "clumps", "tris", "grey (age)", "silver", "mean lum"],
  hair.map((h) => [String(h.ancestry), h.elder ? "elder" : "young", String(h.intelligence), `${h.style}/${h.tier}`, f3(h.lengthM), f3(h.density), String(h.follicles), String(h.clumps), String(h.triangles), `${f3(h.grey)} (${f3(h.ageGrey)})`, f3(h.silver), f3(h.meanLum)])));
md.push("");
md.push(`Budget: max hair triangles in this table ${Math.max(...hair.map((h) => h.triangles as number))} (HAIR_TRI_BUDGET ${HAIR_TRI_BUDGET}); the clump count refits to the budget at every intelligence (SPEC G69: 144 builds).`);
md.push("");
md.push("## Tests — `deno test -A tests/wave_gen_paint_test.ts` (SPEC G60–G69)");
md.push("");
md.push("G60 identity (gain 0 = wave V, strength 0 = base, skipped regions untouched), G61 bounds (0..1, ≤ PAINT_MAX_DARK), G62 determinism,");
md.push("G63 geometry (sphere: no cavity; wash on less-convex, edge on more-convex vertices), G64 contrast up vs wave V + chiaroscuro, G65 cloth-only");
md.push("weathering, G66 stage record = live paintSkin, G67 hair identity at 500 / absent, G68 monotone + never darker than age, G69 budget.");
md.push("");
md.push("## Honest gaps");
md.push("");
md.push("- **The mesh is coarse (~4.2–4.5 k vertices, 2.5 cm cells).** The edge highlight lands mostly on hands/feet/shoulders/knuckles; sub-cell edges (brows, lips) are out of reach and the face/ears stay skipped (FORM_SKIP), as in wave V.");
md.push("- **The cavity wash is a broad-scale depth, not a ray-traced AO.** On a mostly convex body the washed vertices are LESS convex than average (mean H about half the body's), not concave on average — SPEC G63 pins that measured relation, not more.");
md.push("- **Contrast gain is modest (+0.07–0.10 over wave V)**: the wave-V `noise mush` pin (band-sized jumps ≤ +1 pp on the arms) bounds how hard the wash can be; the arms read 1.50 % vs the 1.59 % cap.");
md.push("- **Chiaroscuro is in BIND-pose height**: a lying body keeps its standing gradient (the paint is a vertex attribute).");
md.push("- **Live wiring is K's line** (`SkinnedHumanoid.ts`: `buildFaceParts(..., appearance, bodySpec.stats)`, done in this wave); the Chrome heads below come through the Creator's `buildPreviewRig(profile, stats)` path.");
md.push("- **A style can switch with the length**: the ponytail variant of flowing hair needs a cut > 1.2 head heights, so a low intelligence can turn a ponytail into loose flowing hair (human young, I=0 below). The tier never goes DOWN as I rises (SPEC G68).");
md.push("- **Shader sub-strand grey** (`uGreySub` = `stats.greySub`) mixes toward the grey colour on the GPU; for a near-white blond that grey can be darker than the pigment. The CPU card colours are pinned never-darker per channel; the shader's sub-strands are not.");
md.push("- r2 -> r3 (Q2 FAIL Z-35, 'silver cap'): the intelligence share first turned extra WHOLE clumps grey and lightened the scalp underlayer, so the lit crown read as a silver helmet; then a braid blend made the braid solid silver. r3 spreads the extra share evenly (shader sub-strands + tip silvering) and keeps the underlayer at the age colour; image-model check of `int-elf-young-1000.png` / `int-human-young-1000.png`: 'one head of hair with silver streaks through its length'.");
md.push("- Crop / mohawk / shaved styles cut their own length: intelligence changes their density and silver, not their tier.");
md.push("- The garment's dark belly blotches seen by the image model are present BEFORE the pass too (wave-X abs/cloth detail + cel bands), not introduced here.");
await Deno.writeTextFile("docs/wave-gen/PAINT.md", md.join("\n") + "\n");
console.log(JSON.stringify({ paint: paint.map((p) => `${p.race}/${p.sex} ${f3(p.contrastV)}->${f3(p.contrastGen)} ${f1(p.stageMs)}ms`), hairRows: hair.length }, null, 1));
