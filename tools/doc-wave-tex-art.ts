// Wave TEX lane P: writes docs/wave-tex/ART.md from Presets.ts tables + measurements on generated bodies.
// deno run -A tools/doc-wave-tex-art.ts            (prints the measurement JSON too: artifacts/wave-tex/art/measure.json)
import { generateBody } from "../src/graphics/body/BodyMesh.ts";
import { formGainsFor } from "../src/graphics/body/Improvise.ts";
import { REGIONS, type BodySpec } from "../src/graphics/body/contracts.ts";
import { contrastRatio, relativeLuminance } from "../src/graphics/paint/Blend.ts";
import { FORM_SKIP, vertexRings } from "../src/graphics/paint/FormShade.ts";
import { paintVertices } from "../src/graphics/paint/Layers.ts";
import { cavityDepth, fineCurvature, miniatureMetrics, miniatureTerms } from "../src/graphics/paint/Miniature.ts";
import { DEFAULT_LOOK } from "../src/graphics/paint/PaintStage.ts";
import { evaluateStack } from "../src/graphics/paint/Evaluate.ts";
import {
  AO_SHARE, CLASS_OUTFIT, EDGE_CREST, OCCLUSION_AO, presetBuffers, evaluateFinish, garmentTable, LEGIBLE, legacyFinish, NATURAL_COLOURS, presetFor, presetToV2, RACE_SUBRACES, skinTable, subjectOfSpec,
} from "../src/graphics/paint/Presets.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const table = (head: string[], rows: string[][]) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const lum = (A: Float32Array, i: number) => relativeLuminance(A[i * 3], A[i * 3 + 1], A[i * 3 + 2]);

interface Row { ridgeLegacy: number; ridgePreset: number; v2Albedo: number; v2Rough: number; v2HeightMax: number; race: string; sub: string; cls: string; ms: number; legacySep: number; presetSep: number; skinRough: number; garmentRough: number; metalEdge: number; metalFlat: number; contrast: number; studsRaisedPct: number; enabled: number }
const rows: Row[] = [];
for (const race of ["elf", "human", "dwarf", "ork"]) {
  const spec = { race, subrace: null, className: "Warrior", height: 1.75, weight: 75, seed: 7, sex: "male" } as BodySpec;
  const b = generateBody(spec), cell = b.plan.cell, mesh = b.mesh, n = mesh.region.length;
  const adj = vertexRings(mesh), k = fineCurvature(mesh, adj, cell), d = cavityDepth(mesh, adj, cell);
  const arm = new Set(["upperArm", "foreArm", "neck"].map((r) => REGIONS.indexOf(r as typeof REGIONS[number])));
  const ids = [...Array(n).keys()].filter((i) => arm.has(mesh.region[i]));
  const top = (f: Float32Array) => { const s = ids.map((i) => f[i]).sort((a, c) => a - c); const t = s[Math.floor(0.9 * (s.length - 1))]; return ids.filter((i) => f[i] >= t); };
  const kt = top(k), ct = top(d);
  const sep = (A: Float32Array) => (kt.reduce((s, i) => s + lum(A, i), 0) / kt.length) / (ct.reduce((s, i) => s + lum(A, i), 0) / ct.length);
  for (const sub of RACE_SUBRACES[race]) {
    const p = presetFor(subjectOfSpec({ ...spec, subrace: sub }, DEFAULT_LOOK, cell));
    const base = paintVertices(mesh, p.basecoat);
    const t0 = performance.now();
    const f = evaluateFinish(mesh, base.slice(), p.finish, { cell, regionGain: formGainsFor(7) });
    const ms = performance.now() - t0;
    const lg = evaluateFinish(mesh, base.slice(), legacyFinish(p.slots.flatMap((s) => s.regions)), { cell, regionGain: formGainsFor(7) }).albedo;
    const mat = (kind: string) => p.finish.materials.findIndex((m) => m.kind === kind);
    const vals = (mi: number, A: Float32Array) => [...Array(n).keys()].filter((i) => p.finish.regionMaterial[mesh.region[i]] === mi).map((i) => A[i]);
    const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
    const metal = vals(mat("metalTrim"), f.roughness!).sort((a, c) => a - c);
    const studs = vals(mat("studdedLeather"), f.height!);
    const skinI = [...Array(n).keys()].filter((i) => p.finish.regionMaterial[mesh.region[i]] === 0 && arm.has(mesh.region[i]));
    const legs = [...Array(n).keys()].filter((i) => p.finish.regionMaterial[mesh.region[i]] === mat("wool"));
    const mc = (I: number[]) => { let r = 0, g = 0, bb = 0; for (const i of I) { r += f.albedo[i * 3]; g += f.albedo[i * 3 + 1]; bb += f.albedo[i * 3 + 2]; } return relativeLuminance(r / I.length, g / I.length, bb / I.length); };
    const gb = presetBuffers(mesh, p, { cell, regionGain: formGainsFor(7) }), vb = evaluateStack(mesh, presetToV2(p));
    let v2a = 0, v2r = 0, v2h = 0;
    for (let i = 0; i < n; i++) {
      for (let q = 0; q < 3; q++) v2a += Math.abs(gb.albedo[i * 3 + q] - vb.albedo[i * 3 + q]) / 3;
      v2r += Math.abs(gb.material[i * 4] - vb.material[i * 4]); v2h = Math.max(v2h, Math.abs(gb.material[i * 4 + 1] - vb.material[i * 4 + 1]));
    }
    const regs = p.slots.flatMap((s2) => s2.regions), mt = miniatureTerms(mesh, adj, { cell, garment: regs });
    const ridgeLegacy = miniatureMetrics(mesh, base, lg, mt, FORM_SKIP, regs).ridge, ridgePreset = miniatureMetrics(mesh, base, f.albedo, mt, FORM_SKIP, regs).ridge;
    rows.push({
      ridgeLegacy, ridgePreset, v2Albedo: v2a / n, v2Rough: v2r / n, v2HeightMax: v2h,
      race, sub, cls: "Warrior", ms, legacySep: sep(lg), presetSep: sep(f.albedo), skinRough: avg(skinI.map((i) => f.roughness![i])), garmentRough: avg(legs.map((i) => f.roughness![i])),
      metalEdge: metal[Math.floor(metal.length * 0.05)], metalFlat: metal[Math.floor(metal.length / 2)], contrast: contrastRatio(mc(skinI), mc(legs)),
      studsRaisedPct: 100 * studs.filter((h) => h >= 0.001).length / Math.max(1, studs.length), enabled: p.finish.layers.filter((l) => l.enabled).length,
    });
  }
}
await Deno.mkdir(`${ROOT}artifacts/wave-tex/art`, { recursive: true });
await Deno.writeTextFile(`${ROOT}artifacts/wave-tex/art/measure.json`, JSON.stringify(rows, null, 1));

const ex = presetFor({ race: "ork", subrace: "ironhide", className: "Warrior", garment: DEFAULT_LOOK.garment, seed: 7 });
const v2 = presetToV2(ex);
const f3 = (x: number) => x.toFixed(3);
const md = `# Wave TEX — lane P: art-directed material presets

GENERATED by \`deno run -A tools/doc-wave-tex-art.ts\` from \`src/graphics/paint/Presets.ts\` and measurements on generated bodies
(\`artifacts/wave-tex/art/measure.json\`). Do not edit by hand. Tests: \`tests/wave_tex_presets_test.ts\` (SPEC TX60-69).

## What it is

\`presetFor(subject, {outfit?, kinds?})\` builds a **MaterialPreset**: the v1 recipe stack as the skin basecoat (+ one basecoat
and texture layer per garment slot), and a **finish stack** — the miniature-painting workflow as ordered layers per material,
writing the C-MAT channels (albedo, roughness, height, ao, subsurface). \`paintPreset(mesh, preset, {cell})\` evaluates it;
\`paintStage(..., {preset: true})\` returns it as \`channels\`. With no preset every old path is byte-identical:
\`legacyFinish()\` IS the wave-V FormShade + wave-GEN Miniature pass written as these layers, and its evaluation equals
\`applyFormShade\` bit for bit on 4 races x 2 sexes x {garment, bare} x {miniature 1, 0} (TX60). \`presetToV2(preset)\` exports
the same stack as L's \`LayerStackV2\` (ids \`p:<id>\`) for the creator's Layers inspector.

The evaluator runs **layer by layer** in \`finish.layers\` order (per-vertex operations are independent, so splitting the fused
wave-V/GEN loops keeps every IEEE result — TX60 proves it). Creator overrides (\`applyPresetOverrides\`, L's LayerOverride shape,
ids \`skin.wash\` or \`p:skin.wash\`): \`enabled\`/\`opacity\` exact; \`blend\` per channel = any of L's COLOR_OPS (albedo) /
SCALAR_OPS (scalars) run on the step's own (top, alpha) — wash top = 1 − peak·(1 − pigment), edge top = the highlight, layer top
= the basecoat, glaze top = the glaze, prime top = the zenithal grey; \`order\` moves the layer. Locked (\`EDIT_LOCKED\`,
\`editableOps\` returns none): \`*.clamp\` and \`*.guard\` (they reference the basecoat). \`presetBuffers\` returns L's MaterialBuffers
(albedo, aMaterial, fragment relief layers, \`masks.skin\` = 1 on bare skin so marks are hidden under garments).

## The workflow as operators (why each one)

| step | layer ids | operator (channel) | mask | why this operator |
|---|---|---|---|---|
| prime | \`*.prime\` | multiply (albedo) | body height below the shoulders (+ underside) | a zenithal prime: light from above before any colour; multiply keeps hue |
| basecoat | \`<m>.basecoat\` | normal (albedo); replace (roughness, height, subsurface) | material regions | flat colour + the material's own sheen and translucency |
| wash | \`<m>.wash-form\`, \`<m>.wash\` | saturation then **multiply** by the wash pigment (albedo); add (roughness); multiply (ao) | **concave** curvature (fine groove term; broad Taubin cavity) | a wash is a dark transparent pigment that only ever darkens and pools in recesses; multiply by a coloured filter darkens AND tints the shadow (warm flesh, green-black ork, oil-black metal); pigment that pools is more saturated; recesses go matte |
| layer | \`<m>.layer\` | **normal** toward the basecoat (albedo) | **invert(concave)** | the painter re-lays the base on the raised planes so the wash stays only in the recesses |
| edge | \`<m>.edge-form\`, \`<m>.edge\` | **lift** = screen in its b + (1 − b)·t form toward the highlight colour (albedo); add (roughness: burnished/polished edges) | **convex** fine curvature OR up-facing (bounded sum) | an edge highlight is a lighter base on the edges that catch light; screen never darkens; for a white highlight lift(b, k) = screen(b, k) exactly, for a coloured one it is normal toward that colour |
| glaze | \`<m>.glaze\` | **color** (W3C non-separable: hue+saturation of the glaze, luminosity of the base) at <= 15 % | all, or weighted toward the concave share | a glaze is a transparent filter: it unifies hue without undoing the values the wash/layer/edge built (luminosity preserved to 1e-9, TX65) |
| guard | \`*.clamp\`, \`*.guard\` | clamp / value guard | all | no channel below (1 − 0.32) × the basecoat: paint modulates a cel band, never invents a contour (wave GEN) |
| varnish | \`<m>.varnish\` | **lerp** (roughness) toward matte 0.95 / satin 0.5 / gloss 0.2 | all | the last coat sets the sheen; skin is never varnished (its sheen is sebum, set at basecoat) |
| relief | \`<m>.relief\`, \`<m>.relief-fragment\` | **heightBlend** (soft max, max <= v <= max + k/4) + lerp (roughness) + normal (albedo: stud heads) per vertex; add (height) per fragment | the pattern's coverage | hide plates, studs and fur clumps are features >= 2 vertex spacings; pores, weave, grain, hammering and strands are sub-cell and go to lane R's fragment pass |
| weather | \`<m>.weather\` | desaturate then normal toward a dull earth | garment, rising from the ground + cavities | wave-GEN weathering, gain per material (linen shows grime most, metal least) |

AO channel: a miniature paints its own occlusion, so the painted cavity contributes only \`${AO_SHARE} × cavity\` (the painted wash already carries 0.24);
the closing round (agent F) adds the GEOMETRIC occlusion between body parts (\`MeshOcclusion.meshOcclusion\`: 16 cosine rays per vertex on the
voxelised skin, 25 cm): the wash layer writes \`ao = (1 − ${AO_SHARE}·cavity)·(1 − ${OCCLUSION_AO.gain}·smoothstep(${OCCLUSION_AO.onset}, ${OCCLUSION_AO.full}, occlusion))\`, so open
and convex surfaces keep ao = 1 and the armpit / inner arm / inner thigh go down to ${((1 - AO_SHARE) * (1 - OCCLUSION_AO.gain)).toFixed(2)} of the lit term (TX94). The occlusion is
baked on the BIND pose (arms out): a pose that closes the arm on the ribs is not re-occluded.

Edge: the edge layer also writes a per-vertex CREST weight (\`masks.crest\`, lift normalised to the skin preset's full edge); the skinned cel
shader re-thresholds it per fragment (\`smoothstep(${EDGE_CREST.onset}, ${EDGE_CREST.full}, w)\`, lift ${EDGE_CREST.lift} toward white): the vertex highlight's soft glow over
22-35 mm triangles becomes a crisp painted line along the crest (TX95).

## Skin presets: race x sub-race

${table(["race", "sub-race", "roughness", "subsurface", "pores (fragment)", "wash", "glaze (color)", "why the roughness"], skinTable())}

Region modifiers on skin roughness: face −0.08 (sebum T-zone), ear −0.04, hand +0.04, foot +0.06, sole +0.15 (callus), nail −0.25 (keratin gloss).
Subsurface multipliers: ear ×1.4, face ×1.15, hand ×1.1, sole ×0.6, nail ×0.4. Sub-race glazes cite the THEME plaque swatch they
come from (\`src/ui/Theme.ts SUBRACE_SWATCH\`; TX68 checks each cited colour is in that swatch).

## Garment presets

${table(["kind", "roughness", "varnish", "wash", "layer", "edge", "glaze", "relief (vertex)", "relief (fragment)", "weather", "why"], garmentTable())}

Natural material colours (leather, fur, metal) per race / sub-race, coherent with the THEME plaques:

${table(["race / sub-race", "leather", "fur", "metal", "why"], Object.entries(NATURAL_COLOURS).map(([k, v]) => [k, `\`${v.leather}\``, `\`${v.fur}\``, `\`${v.metal}\``, v.why]))}

Class outfits (first slot = Appearance.body; wool/linen take the palette colour, leather 25 %, fur 15 %, metal 0 %):

${table(["class", "slots"], Object.entries(CLASS_OUTFIT).map(([k, v]) => [k, v.map((s) => `${s.slot}: ${s.kind} (${s.regions.join(", ")})`).join("; ")]))}

Legibility: every non-metal slot colour is moved in HSL lightness (hue kept) until its contrast ratio with the recipe skin lies in
[${LEGIBLE.min}, ${LEGIBLE.max}] — below that the figure reads as one blob at game distance, above it a pale tunic flares out of the
cel band. TX66 checks ${12 * 8 * 8}+ colour combinations and the painted bodies.

## Measured on generated bodies (Warrior, seed 7, male, 1.75 m; default garment ${DEFAULT_LOOK.garment})

Separation = mean luminance of the top-decile convex / top-decile concave vertices of upper arm, forearm and neck.
Contrast = arm/neck skin mean vs wool legs mean (linear-luminance contrast ratio).

Edge = painted/basecoat luminance on the top-decile fine-convex vertices (Miniature.miniatureMetrics ridge), legacy -> preset
(PRESET_EDGE: skin gain x1.6, tint 0.68; TX67 pins preset >= legacy + 0.05).

${table(["race", "sub-race", "finish ms", "edge legacy -> preset", "separation legacy -> preset", "skin roughness", "wool roughness", "metal roughness p5 / p50", "skin/garment contrast", "studs raised >= 1 mm", "enabled layers"],
  rows.map((r) => [r.race, r.sub, r.ms.toFixed(1), `${f3(r.ridgeLegacy)} -> ${f3(r.ridgePreset)}`, `${f3(r.legacySep)} -> ${f3(r.presetSep)}`, f3(r.skinRough), f3(r.garmentRough), `${f3(r.metalEdge)} / ${f3(r.metalFlat)}`, r.contrast.toFixed(2), `${r.studsRaisedPct.toFixed(1)} %`, String(r.enabled)]))}

## Example: ork / ironhide / Warrior as a v2 stack (\`presetToV2\`)

${table(["id", "enabled", "opacity", "stage", "writes"], (v2.nodes.flatMap((n) => n.kind === "group" ? [n, ...n.children.slice(-ex.finish.materials.length)] : [n])).map((n) =>
  [n.id, String(n.enabled), n.opacity.toFixed(2), n.kind === "layer" ? n.stage ?? "vertex" : "group", n.kind === "layer" ? n.writes.map((w) => `${w.channel}:${w.op}`).join(", ") : "(children)"]))}

## Known limits (honest)

- \`presetToV2\` is the editable description; the game paint is \`evaluateFinish\` (exact wave-V/GEN arithmetic; R's TexWiring
  calls \`presetBuffers\`). L's evaluator on the export is close but not identical (the value guard has no v2 operator and is exported
  disabled; L's curvature/AO masks are not FormShade's 2-ring curvature nor the Miniature's 2-ring-softened Taubin wash). Measured
  (evaluateStack(presetToV2) vs presetBuffers, Warrior bodies above): mean |Δ albedo| ${Math.min(...rows.map((r) => r.v2Albedo)).toFixed(4)}..${Math.max(...rows.map((r) => r.v2Albedo)).toFixed(4)} linear,
  mean |Δ roughness| ${Math.min(...rows.map((r) => r.v2Rough)).toFixed(4)}..${Math.max(...rows.map((r) => r.v2Rough)).toFixed(4)}, max |Δ height| ${(Math.max(...rows.map((r) => r.v2HeightMax)) * 1000).toFixed(2)} mm (TX69 pins the bounds).
- Fragment relief (pores, weave, grain, hammering, strands) is a descriptor list (\`preset.details\`): it is visible only once lane R's
  shader reads it. Vertex relief features are kept >= 5 cm (2 vertex spacings).
- Garment slots follow body REGIONS, so hems sit on region seams (the grid stair-steps them; wave V dropped a darkened hem for this
  reason). The bracers end at the wrist/elbow seams.
- Skin roughness numbers are art-directed by lore and tuned against the cel specular band, not measured skin BRDFs.
`;
await Deno.writeTextFile(`${ROOT}docs/wave-tex/ART.md`, md);
console.log(JSON.stringify(rows.map((r) => ({ ...r, ms: +r.ms.toFixed(1) }))));
