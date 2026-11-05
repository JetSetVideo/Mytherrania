// Wave TEX lane P: material presets (src/graphics/paint/Presets.ts). SPEC TX60-69.
import { generateBody } from "../src/graphics/body/BodyMesh.ts";
import { formGainsFor } from "../src/graphics/body/Improvise.ts";
import { REGIONS, type BodySpec, type MeshData } from "../src/graphics/body/contracts.ts";
import { contrastRatio, hexToHsl, hexToRgb, relativeLuminance, srgbToLinear } from "../src/graphics/paint/Blend.ts";
import { CHANNEL_SPECS } from "../src/graphics/paint/Channels.ts";
import { evaluateStack } from "../src/graphics/paint/Evaluate.ts";
import { applyFormShade, FORM_SKIP, vertexRings } from "../src/graphics/paint/FormShade.ts";
import { cavityDepth, fineCurvature, miniatureMetrics, miniatureTerms } from "../src/graphics/paint/Miniature.ts";
import { validateStack } from "../src/graphics/paint/LayerStack.ts";
import { paintVertices } from "../src/graphics/paint/Layers.ts";
import { DEFAULT_LOOK, paintStage } from "../src/graphics/paint/PaintStage.ts";
import {
  applyPresetOverrides, CHANNEL_RANGE, presetBuffers, skinColourOf, CLASS_OUTFIT, colorBlend, evaluateFinish, GARMENT_FINISH, GARMENT_KINDS, LEGIBLE,
  legacyFinish, legibleGarment, NATURAL_COLOURS, paintPreset, presetFor, presetToV2, RACE_SUBRACES, SKIN_PRESETS, skinPresetFor,
  EDIT_LOCKED, editableOps, STEPS, subjectOfSpec,
} from "../src/graphics/paint/Presets.ts";
import { GARMENT_REGIONS, stackFor } from "../src/graphics/paint/Recipes.ts";
import { SKIN_MEDIAN_BOUNDS } from "../src/graphics/paint/Relevance.ts";
import { SUBRACE_SWATCH } from "../src/ui/Theme.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const RACES = ["human", "elf", "dwarf", "ork"] as const;
const CLASSES = ["Warrior", "Barbarian", "Rogue", "Assassin", "Mage", "Necromancer", "Archer", "Priest"] as const;
const specOf = (race: string, sex: string, subrace: string | null = null, className = "Warrior", seed = 7): BodySpec =>
  ({ race, subrace, className, height: 1.75, weight: 75, seed, sex } as BodySpec);
const bodies = new Map<string, ReturnType<typeof generateBody>>();
const bodyOf = (race: string, sex = "male") => {
  const k = `${race}/${sex}`;
  let b = bodies.get(k);
  if (!b) { b = generateBody(specOf(race, sex)); bodies.set(k, b); }
  return b;
};
const lumLin = (A: Float32Array, i: number) => relativeLuminance(A[i * 3], A[i * 3 + 1], A[i * 3 + 2]);

/** Area-free mean linear colour of the vertices of a region set (the game-distance read: a flat average). */
function meanColour(mesh: MeshData, A: Float32Array, regions: readonly string[]): [number, number, number, number] {
  const ids = new Set(regions.map((r) => REGIONS.indexOf(r as typeof REGIONS[number])));
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < mesh.region.length; i++) if (ids.has(mesh.region[i])) { r += A[i * 3]; g += A[i * 3 + 1]; b += A[i * 3 + 2]; n++; }
  return [r / Math.max(1, n), g / Math.max(1, n), b / Math.max(1, n), n];
}

Deno.test("SPEC TX60: the wave-V FormShade + wave-GEN Miniature pass AS LAYERS (legacyFinish) is byte-identical to applyFormShade", () => {
  let checked = 0;
  for (const race of RACES) for (const sex of ["male", "female"]) {
    const b = bodyOf(race, sex), cell = b.plan.cell;
    for (const garment of [DEFAULT_LOOK.garment, ""]) {
      const base = paintVertices(b.mesh, stackFor({ race, className: "Warrior", garment: garment || undefined, hair: DEFAULT_LOOK.hair, height: 1.75, vertexSpacing: cell, seed: 7 }));
      const g = garment ? GARMENT_REGIONS : [];
      for (const miniature of [1, 0]) {
        const opts = { cell, garment: g, regionGain: formGainsFor(7), miniature };
        const a = applyFormShade(b.mesh, base.slice(), opts);
        const c = evaluateFinish(b.mesh, base.slice(), legacyFinish(g), opts).albedo;
        let diff = 0;
        for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) diff++;
        assert(diff === 0, `${race}/${sex} garment=${!!garment} mini=${miniature}: ${diff} channels differ`);
        checked++;
      }
    }
  }
  assert(checked === 32, `checked ${checked}`);
  // Every legacy layer is a named miniature step with an operator and a reason.
  const L = legacyFinish(GARMENT_REGIONS);
  for (const l of L.layers) assert(STEPS.includes(l.step) && Object.keys(l.writes).length > 0 && l.why.length > 10, `legacy layer ${l.id}`);
  const ids = L.layers.filter((l) => l.enabled).map((l) => l.id);
  for (const want of ["skin.wash-form", "skin.edge-form", "*.clamp", "cloth.weather", "skin.wash", "*.prime", "skin.edge", "*.guard"]) assert(ids.includes(want), `legacy missing ${want}`);
  for (const off of ["skin.layer", "skin.glaze", "skin.varnish"]) assert(!ids.includes(off), `legacy must not enable ${off}`);
});

Deno.test("SPEC TX61: paintStage without a preset is unchanged (old law re-stated); with one it returns the channels", () => {
  const b = bodyOf("dwarf"), spec = specOf("dwarf", "male"), cell = b.plan.cell;
  const old = paintStage(b.mesh, spec, cell, {}, { metrics: false }).paint;
  const base = paintVertices(b.mesh, stackFor({ race: "dwarf", subrace: null, className: "Warrior", birthsign: null, hair: DEFAULT_LOOK.hair, accent: DEFAULT_LOOK.accent, garment: DEFAULT_LOOK.garment, height: 1.75, vertexSpacing: cell, seed: 7 }));
  const law = applyFormShade(b.mesh, base.slice(), { cell, garment: GARMENT_REGIONS, regionGain: formGainsFor(7) });
  let diff = 0;
  for (let i = 0; i < law.length; i++) if (law[i] !== old[i]) diff++;
  assert(diff === 0, `paintStage default differs in ${diff} channels`);
  const withP = paintStage(b.mesh, spec, cell, {}, { metrics: false, preset: true });
  assert(withP.channels && withP.channels.roughness && withP.channels.height && withP.channels.ao && withP.channels.subsurface, "preset channels");
  assert(withP.record.id === "paint" && withP.record.label.includes("preset:dwarf"), withP.record.label);
  assert(withP.record.warnings.length === 0, withP.record.warnings.join());
  let changed = 0;
  for (let i = 0; i < old.length; i++) if (old[i] !== withP.paint[i]) changed++;
  assert(changed > old.length * 0.3, `a preset must change the paint (changed ${changed})`);
});

Deno.test("SPEC TX62: preset completeness — every race x sub-race skin, every garment kind, every class outfit, the six miniature steps", () => {
  let n = 0;
  for (const [race, subs] of Object.entries(RACE_SUBRACES)) {
    assert(SKIN_PRESETS[race] && NATURAL_COLOURS[race], `race ${race}`);
    for (const s of subs) {
      assert(SKIN_PRESETS[s] && NATURAL_COLOURS[s], `sub-race ${s}`);
      assert(SUBRACE_SWATCH[race]?.[s], `THEME has no swatch for ${race}/${s}`);
      for (const sp of [SKIN_PRESETS[s], SKIN_PRESETS[race]]) assert(sp.why.roughness && sp.why.wash && sp.why.glaze, `${s} why`);
      assert(skinPresetFor(race, s) === SKIN_PRESETS[s], `${s} lookup`);
      for (const className of CLASSES) {
        const p = presetFor({ race, subrace: s, className, garment: DEFAULT_LOOK.garment, seed: 11 });
        const ids = p.finish.layers.map((l) => l.id);
        assert(new Set(ids).size === ids.length, `${race}/${s}/${className}: duplicate layer ids`);
        for (const m of p.finish.materials) {
          if (m.kind === "hair") continue;
          for (const step of ["basecoat", "wash", "layer", "edge", "glaze", "varnish"] as const) {
            assert(p.finish.layers.some((l) => l.material === m.id && l.step === step), `${race}/${s}/${className}: ${m.id} lacks ${step}`);
          }
          for (const step of ["basecoat", "wash", "edge"] as const) {
            assert(p.finish.layers.some((l) => l.material === m.id && l.step === step && l.enabled), `${m.id} ${step} disabled`);
          }
          assert(m.detail, `${m.id} has no fragment relief`);
        }
        // Outfit regions never overlap; every slot is a real garment material with a colour.
        const seen = new Set<string>();
        for (const sl of p.slots) for (const r of sl.regions) { assert(!seen.has(r), `${className}: ${r} twice`); seen.add(r); }
        assert(p.slots.length === (CLASS_OUTFIT[className] ?? CLASS_OUTFIT.default).length, `${className} slots`);
        assert(validateStack(presetToV2(p)).length === 0, `${race}/${s}/${className}: v2 export invalid: ${validateStack(presetToV2(p)).join("; ")}`);
        n++;
      }
    }
  }
  for (const k of GARMENT_KINDS) {
    const f = GARMENT_FINISH[k];
    assert(f.why.roughness && f.why.wash && f.why.edge && f.why.varnish && f.why.relief, `garment ${k} why`);
    assert(f.detail || f.relief, `garment ${k} relief`);
  }
  // Every kind is worn by at least one class (studded leather, metal trim and fur included).
  const worn = new Set(Object.values(CLASS_OUTFIT).flat().map((s) => s.kind));
  for (const k of GARMENT_KINDS) assert(worn.has(k), `no class wears ${k}`);
  assert(n === 12 * CLASSES.length, `presets built ${n}`);
  // A bare subject (no garment) is skin + hair only.
  const bare = presetFor({ race: "elf", subrace: "dark", seed: 3 });
  assert(bare.slots.length === 0 && bare.finish.materials.map((m) => m.id).join() === "skin,hair", "bare preset");
});

Deno.test("SPEC TX63: channel ranges — albedo 0..1, roughness/height/ao/subsurface inside the C-MAT ranges on painted bodies, no NaN", () => {
  for (const race of RACES) for (const className of ["Warrior", "Barbarian", "Archer"]) {
    const b = bodyOf(race), cell = b.plan.cell;
    const spec = specOf(race, "male", RACE_SUBRACES[race][1], className);
    const ch = paintPreset(b.mesh, presetFor(subjectOfSpec(spec, DEFAULT_LOOK, cell)), { cell, regionGain: formGainsFor(7) });
    for (const x of ch.albedo) assert(x >= 0 && x <= 1, `${race}: albedo ${x}`);
    for (const [k, arr] of [["roughness", ch.roughness!], ["height", ch.height!], ["ao", ch.ao!], ["subsurface", ch.subsurface!]] as const) {
      const [lo, hi] = CHANNEL_RANGE[k], spec2 = CHANNEL_SPECS[k];
      assert(lo >= (spec2.range[0] as number) && hi <= (spec2.range[1] as number), `${k} range inside L's`);
      for (const v of arr) assert(Number.isFinite(v) && v >= lo && v <= hi, `${race}/${className} ${k} ${v}`);
    }
  }
});

Deno.test("SPEC TX64: skin roughness by ancestry — elf satin < human < dwarf weathered < ork leathery, in the tables AND on painted skin", () => {
  const r = (k: string) => SKIN_PRESETS[k].roughness;
  assert(r("elf") < r("human") && r("human") < r("dwarf") && r("dwarf") < r("ork"), "race order");
  assert(Math.abs(r("elf") - 0.35) < 0.05 && Math.abs(r("human") - 0.5) < 0.05 && Math.abs(r("dwarf") - 0.6) < 0.05 && Math.abs(r("ork") - 0.7) < 0.05, "brief anchors");
  // sub-races vary within +-0.1 of their race, and the race MEANS (race + its sub-races) keep the ancestry order
  const ORDER = ["elf", "human", "dwarf", "ork"] as const;
  const mean: number[] = [];
  for (const race of ORDER) {
    const subs = RACE_SUBRACES[race];
    for (const s of subs) assert(Math.abs(r(s) - r(race)) <= 0.1 + 1e-9, `${s} ${r(s)} too far from ${race} ${r(race)}`);
    mean.push([race, ...subs].reduce((a, k) => a + r(k), 0) / (subs.length + 1));
  }
  for (let i = 1; i < mean.length; i++) assert(mean[i] > mean[i - 1] + 0.05, `race means ${mean.map((x) => x.toFixed(3)).join(" < ")}`);
  const measured: number[] = [];
  for (const race of ORDER) {
    const b = bodyOf(race), cell = b.plan.cell;
    const p = presetFor(subjectOfSpec(specOf(race, "male"), { ...DEFAULT_LOOK, garment: "" }, cell));
    const ch = paintPreset(b.mesh, p, { cell });
    const torso = REGIONS.indexOf("torso");
    let s = 0, n = 0;
    for (let i = 0; i < b.mesh.region.length; i++) if (b.mesh.region[i] === torso) { s += ch.roughness![i]; n++; }
    measured.push(s / n);
  }
  for (let i = 1; i < measured.length; i++) assert(measured[i] > measured[i - 1], `measured torso roughness ${measured.map((x) => x.toFixed(3)).join(" < ")}`);
  // Region modifiers: the face is glossier than the torso, the sole matte-r, the nails glossy.
  const sp = presetFor({ race: "human", seed: 1 }).finish.materials[0];
  assert((sp.regionRough!.face ?? 0) < 0 && (sp.regionRough!.sole ?? 0) > 0 && (sp.regionRough!.nail ?? 0) < -0.1, "region roughness");
});

Deno.test("SPEC TX65: operators — glaze = W3C color keeps the base luminosity; relief heightBlend bounded; the finish touches the body; all finish layers off = basecoat", () => {
  const lum = (c: number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  let worst = 0;
  for (let k = 0; k < 2000; k++) {
    const b = [((k * 37) % 101) / 100, ((k * 53) % 97) / 96, ((k * 71) % 89) / 88], s = [((k * 13) % 83) / 82, ((k * 29) % 79) / 78, ((k * 7) % 73) / 72];
    const o = colorBlend(b[0], b[1], b[2], s[0], s[1], s[2]);
    for (const x of o) assert(Number.isFinite(x) && x >= -1e-9 && x <= 1 + 1e-9, `color out of range ${o}`);
    worst = Math.max(worst, Math.abs(lum(o) - lum(b)));
  }
  assert(worst < 1e-9, `color blend luminosity drift ${worst}`);
  // grey top -> desaturated (hue/sat of the glaze), same luminosity
  const gr = colorBlend(0.8, 0.4, 0.2, 0.5, 0.5, 0.5);
  assert(Math.abs(gr[0] - gr[1]) < 1e-12 && Math.abs(gr[1] - gr[2]) < 1e-12, "grey glaze desaturates");
  // relief = L's heightBlend: never above the feature amplitude, never below the base offset
  {
    const b = bodyOf("ork"), cell = b.plan.cell;
    const p = presetFor(subjectOfSpec(specOf("ork", "male", "ironhide"), DEFAULT_LOOK, cell));
    const ch = paintPreset(b.mesh, p, { cell });
    p.finish.materials.forEach((m, k) => {
      const top = (m.relief?.amplitude ?? 0) + m.heightOffset;
      for (let i = 0; i < b.mesh.region.length; i++) if (p.finish.regionMaterial[b.mesh.region[i]] === k) {
        assert(ch.height![i] >= Math.min(0, m.heightOffset) - 1e-7 && ch.height![i] <= Math.max(top, m.heightOffset) + 1e-7, `${m.id} height ${ch.height![i]}`);
      }
    });
  }
  // On a painted body: the preset's wash darkens the cavities more than legacy did, the edge brightens ridges.
  const b = bodyOf("human"), cell = b.plan.cell;
  const p = presetFor(subjectOfSpec(specOf("human", "male"), DEFAULT_LOOK, cell));
  const base = paintVertices(b.mesh, p.basecoat);
  const fin = evaluateFinish(b.mesh, base.slice(), p.finish, { cell }).albedo;
  const off = applyPresetOverrides(p, p.finish.layers.filter((l) => l.step !== "basecoat").map((l) => ({ id: l.id, enabled: false })));
  const flat = evaluateFinish(b.mesh, base.slice(), off.finish, { cell }).albedo;
  const skip = new Set(FORM_SKIP.map((r) => REGIONS.indexOf(r as typeof REGIONS[number])));
  let same = 0, tot = 0;
  for (let i = 0; i < b.mesh.region.length; i++) {
    if (skip.has(b.mesh.region[i])) continue;
    tot++;
    if (Math.abs(fin[i * 3] - base[i * 3]) > 1e-6) same++;
  }
  assert(same > tot * 0.5, `the finish must touch most vertices (${same}/${tot})`);
  let maxd = 0;
  for (let i = 0; i < flat.length; i++) maxd = Math.max(maxd, Math.abs(flat[i] - base[i]));
  assert(maxd < 2e-6, `all finish layers disabled = basecoat (max diff ${maxd})`);
});

Deno.test("SPEC TX66: legibility at game distance — skin vs garment contrast ratio inside LEGIBLE on every race x sub-race x class (colours) and on painted bodies", () => {
  // colour level: every outfit slot (not metal) vs the recipe skin, for a spread of palette colours incl. skin-like ones
  const palette = ["#4f6f8a", "#88b060", "#e0a884", "#2a2a2a", "#f0f0f0", "#7a3a2a", "#d8c090", "#3d2650"];
  let checked = 0;
  for (const [race, subs] of Object.entries(RACE_SUBRACES)) for (const s of subs) for (const className of CLASSES) for (const garment of palette) {
    const p = presetFor({ race, subrace: s, className, garment, seed: 5 });
    const skin = stackFor({ race, subrace: s, seed: 5 }).layers[0].colour;
    for (const sl of p.slots) {
      if (sl.kind === "metalTrim") continue;
      const y = (h: string) => { const c = hexToRgb(h); return relativeLuminance(srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])); };
      const cr = contrastRatio(y(sl.colour), y(skin));
      assert(cr >= LEGIBLE.min - 1e-9 && cr <= LEGIBLE.max + 1e-9, `${race}/${s}/${className}/${garment} ${sl.slot}: ${cr.toFixed(2)}`);
      checked++;
    }
  }
  assert(checked > 1000, `checked ${checked}`);
  // legibleGarment keeps the hue
  const moved = legibleGarment("#e0a884", "#e0a884");
  assert(Math.abs(hexToHsl(moved).h - hexToHsl("#e0a884").h) < 0.02 && moved !== "#e0a884", `legible hue ${moved}`);
  // painted: mean skin (exposed regions) vs mean primary garment, after the whole finish
  for (const race of RACES) for (const garment of ["#4f6f8a", "#e0a884"]) {
    const b = bodyOf(race), cell = b.plan.cell;
    const p = presetFor(subjectOfSpec(specOf(race, "male", null, "Mage"), { ...DEFAULT_LOOK, garment }, cell));
    const ch = paintPreset(b.mesh, p, { cell, regionGain: formGainsFor(7) });
    const sk = meanColour(b.mesh, ch.albedo, ["upperArm", "foreArm", "neck", "hand"]);
    const ga = meanColour(b.mesh, ch.albedo, p.slots[0].regions);
    const cr = contrastRatio(relativeLuminance(sk[0], sk[1], sk[2]), relativeLuminance(ga[0], ga[1], ga[2]));
    assert(cr >= LEGIBLE.min * 0.9 && cr <= LEGIBLE.max, `${race}/${garment} painted contrast ${cr.toFixed(2)}`);
  }
});

Deno.test("SPEC TX67: the miniature workflow reads — ridge/cavity separation >= legacy, metal edges glossier than metal flats, recesses matter, studs raised", () => {
  for (const race of RACES) {
    const b = bodyOf(race), cell = b.plan.cell, spec = specOf(race, "male");
    const p = presetFor(subjectOfSpec(spec, DEFAULT_LOOK, cell));
    const base = paintVertices(b.mesh, p.basecoat);
    const fin = evaluateFinish(b.mesh, base.slice(), p.finish, { cell, regionGain: formGainsFor(7) });
    const leg = evaluateFinish(b.mesh, base.slice(), legacyFinish(p.slots.flatMap((s) => s.regions)), { cell, regionGain: formGainsFor(7) }).albedo;
    // separation: mean luminance of the top-decile convex vs top-decile concave (skin torso + arms)
    const { kappaTop, cavTop } = deciles(b.mesh, cell);
    const sep = (A: Float32Array) => { let r = 0, nr = 0, c = 0, nc = 0; for (const i of kappaTop) { r += lumLin(A, i); nr++; } for (const i of cavTop) { c += lumLin(A, i); nc++; } return (r / nr) / (c / nc); };
    const sp = sep(fin.albedo), sl = sep(leg);
    assert(sp >= sl * 0.98, `${race}: preset separation ${sp.toFixed(3)} < legacy ${sl.toFixed(3)}`);
    // the EDGE step reads (QA Z-76): painted/basecoat luminance on the top-decile fine-convex vertices >= legacy + 0.05
    const regs = p.slots.flatMap((s2) => s2.regions);
    const terms = miniatureTerms(b.mesh, vertexRings(b.mesh), { cell, garment: regs });
    const mp = miniatureMetrics(b.mesh, base, fin.albedo, terms, FORM_SKIP, regs), ml = miniatureMetrics(b.mesh, base, leg, terms, FORM_SKIP, regs);
    assert(mp.ridge >= ml.ridge + 0.05, `${race}: edge ridge ratio preset ${mp.ridge.toFixed(3)} vs legacy ${ml.ridge.toFixed(3)}`);
    // metal trim (Warrior bracers): edges glossier than the median trim vertex
    const mi = p.finish.materials.findIndex((m) => m.kind === "metalTrim");
    assert(mi >= 0, "warrior wears metal trim");
    const R = fin.roughness!, metal: number[] = [];
    for (let i = 0; i < b.mesh.region.length; i++) if (p.finish.regionMaterial[b.mesh.region[i]] === mi) metal.push(R[i]);
    metal.sort((a, c) => a - c);
    assert(metal[0] < metal[Math.floor(metal.length / 2)] - 0.01, `${race}: metal roughness flat ${metal[0]}..${metal[metal.length - 1]}`);
    // studded leather: some vertices raised >= 1 mm
    const si = p.finish.materials.findIndex((m) => m.kind === "studdedLeather");
    let raised = 0, tot = 0;
    for (let i = 0; i < b.mesh.region.length; i++) if (p.finish.regionMaterial[b.mesh.region[i]] === si) { tot++; if (fin.height![i] >= 0.001) raised++; }
    assert(raised > 0 && raised < tot * 0.6, `${race}: studs raised ${raised}/${tot}`);
  }
});

function deciles(mesh: MeshData, cell: number): { kappaTop: number[]; cavTop: number[] } {
  const ids: number[] = [];
  const skin = new Set(["upperArm", "foreArm", "neck"].map((r) => REGIONS.indexOf(r as typeof REGIONS[number])));
  for (let i = 0; i < mesh.region.length; i++) if (skin.has(mesh.region[i])) ids.push(i);
  // κ (fine convexity) and the broad cavity depth, the fields the miniature masks read
  const adj = vertexRings(mesh);
  const k = fineCurvature(mesh, adj, cell), d = cavityDepth(mesh, adj, cell);
  const top = (f: Float32Array) => { const s = ids.map((i) => f[i]).sort((a, b) => a - b); const t = s[Math.floor(0.9 * (s.length - 1))]; return ids.filter((i) => f[i] >= t); };
  return { kappaTop: top(k), cavTop: top(d) };
}

Deno.test("SPEC TX68: skin presets stay skin and match the THEME — painted skin median inside SKIN_MEDIAN_BOUNDS, glaze <= 15 %, plaque-cited glazes come from the sub-race swatch", () => {
  for (const [race, subs] of Object.entries(RACE_SUBRACES)) for (const s of [race, ...subs]) {
    const sp = SKIN_PRESETS[s];
    assert(sp.glazeOpacity > 0 && sp.glazeOpacity <= 0.15, `${s} glaze ${sp.glazeOpacity}`);
    if (s !== race && /plaque/i.test(sp.why.glaze)) {
      const sw = SUBRACE_SWATCH[race][s];
      assert([sw.base, sw.light, sw.dark, sw.accent, sw.ink].includes(sp.glaze), `${s}: glaze ${sp.glaze} not in THEME swatch`);
    }
  }
  for (const race of RACES) for (const s of RACE_SUBRACES[race]) {
    const b = bodyOf(race), cell = b.plan.cell;
    const spec = specOf(race, "male", s);
    const ch = paintPreset(b.mesh, presetFor(subjectOfSpec(spec, { ...DEFAULT_LOOK, garment: "" }, cell)), { cell, regionGain: formGainsFor(7) });
    const skinIds = new Set(["torso", "upperArm", "foreArm", "thigh", "shin", "neck"].map((r) => REGIONS.indexOf(r as typeof REGIONS[number])));
    const ys: number[] = [], cs: number[] = [];
    for (let i = 0; i < b.mesh.region.length; i++) {
      if (!skinIds.has(b.mesh.region[i])) continue;
      ys.push(lumLin(ch.albedo, i));
      const toS = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
      const r = toS(ch.albedo[i * 3]), g = toS(ch.albedo[i * 3 + 1]), bb = toS(ch.albedo[i * 3 + 2]);
      cs.push(Math.max(r, g, bb) - Math.min(r, g, bb));
    }
    ys.sort((a, c) => a - c); cs.sort((a, c) => a - c);
    const my = ys[ys.length >> 1], mc = cs[cs.length >> 1];
    assert(my >= SKIN_MEDIAN_BOUNDS.luminance[0] * 0.75 && my <= SKIN_MEDIAN_BOUNDS.luminance[1], `${race}/${s}: skin median Y ${my.toFixed(3)}`);
    assert(mc >= SKIN_MEDIAN_BOUNDS.chroma[0] * 0.75 && mc <= SKIN_MEDIAN_BOUNDS.chroma[1], `${race}/${s}: skin median chroma ${mc.toFixed(3)}`);
  }
});

Deno.test("SPEC TX69: determinism, overrides and the v2 export — same subject = same bytes; opacity 1 override = identity; v2 stack evaluates through L", () => {
  const b = bodyOf("ork"), cell = b.plan.cell, spec = specOf("ork", "male", "ironhide", "Barbarian");
  const p1 = presetFor(subjectOfSpec(spec, DEFAULT_LOOK, cell)), p2 = presetFor(subjectOfSpec(spec, DEFAULT_LOOK, cell));
  assert(JSON.stringify(p1) === JSON.stringify(p2), "preset deterministic");
  const a = paintPreset(b.mesh, p1, { cell }), c = paintPreset(b.mesh, applyPresetOverrides(p2, [{ id: "skin.wash", opacity: 1 }, { id: "unknown", enabled: false }]), { cell });
  for (const k of ["albedo", "roughness", "height", "ao", "subsurface"] as const) {
    const x = a[k]!, y = c[k]!;
    for (let i = 0; i < x.length; i++) assert(x[i] === y[i], `${k} differs at ${i}`);
  }
  // disabling the skin glaze changes skin only
  const d = paintPreset(b.mesh, applyPresetOverrides(p1, [{ id: "p:skin.glaze", enabled: false }]), { cell }).albedo;
  const skinK = p1.finish.materials.findIndex((m) => m.id === "skin");
  let skinDiff = 0, otherDiff = 0;
  for (let i = 0; i < b.mesh.region.length; i++) {
    const dd = Math.abs(d[i * 3] - a.albedo[i * 3]) + Math.abs(d[i * 3 + 2] - a.albedo[i * 3 + 2]);
    if (p1.finish.regionMaterial[b.mesh.region[i]] === skinK) { if (dd > 0) skinDiff++; } else if (dd > 0) otherDiff++;
  }
  assert(skinDiff > 0 && otherDiff === 0, `glaze toggle: skin ${skinDiff}, other ${otherDiff}`);
  // the v2 export runs through L's evaluator with sane channels
  const v2 = presetToV2(p1);
  assert(validateStack(v2).length === 0, validateStack(v2).join());
  const buf = evaluateStack(b.mesh, v2);
  for (const x of buf.albedo) assert(x >= 0 && x <= 1, "v2 albedo range");
  assert(buf.written.includes("roughness") && buf.written.includes("height"), `v2 writes ${buf.written}`);
  assert(buf.fragment.length === p1.details.length, `fragment layers ${buf.fragment.length} vs details ${p1.details.length}`);
  // presetBuffers = the game path in L's MaterialBuffers shape: same albedo as paintPreset, aMaterial in MATERIAL_LAYOUT order
  const mb = presetBuffers(b.mesh, p1, { cell });
  for (let i = 0; i < a.albedo.length; i++) assert(mb.albedo[i] === a.albedo[i], "presetBuffers albedo");
  for (let i = 0; i < b.mesh.region.length; i++) {
    assert(mb.material[i * 4] === a.roughness![i] && mb.material[i * 4 + 1] === a.height![i] && mb.material[i * 4 + 2] === a.ao![i] && mb.material[i * 4 + 3] === a.subsurface![i], "aMaterial layout");
  }
  for (let i = 0; i < b.mesh.region.length; i++) assert(mb.masks.skin[i] === (p1.finish.regionMaterial[b.mesh.region[i]] === skinK ? 1 : 0), "skin mask");
  assert(mb.masks.skin.some((v) => v === 0) && mb.masks.skin.some((v) => v === 1), "skin mask has both");
  assert(mb.fragment.length === p1.details.length && mb.fragment.every((f) => f.id.startsWith("p:") && f.writes[0].channel === "height"), "fragment relief layers");
  // the inspector stack (presetToV2 through L's evaluator) stays close to the game path (QC WARN PRE-5): bounded means
  {
    const A = mb, B = buf;
    let da = 0, dr = 0, ds = 0, dh = 0;
    const nn = b.mesh.region.length;
    for (let i = 0; i < nn; i++) {
      for (let q = 0; q < 3; q++) da += Math.abs(A.albedo[i * 3 + q] - B.albedo[i * 3 + q]) / 3;
      dr += Math.abs(A.material[i * 4] - B.material[i * 4]); dh = Math.max(dh, Math.abs(A.material[i * 4 + 1] - B.material[i * 4 + 1]));
      ds += Math.abs(A.material[i * 4 + 3] - B.material[i * 4 + 3]);
    }
    assert(da / nn < 0.03 && dr / nn < 0.02 && ds / nn < 1e-6 && dh < 0.002, `v2 vs game: albedo ${(da / nn).toFixed(4)} rough ${(dr / nn).toFixed(4)} ss ${ds / nn} height ${dh}`);
  }
  // the scar colour source (QD Z-61): the preset's skin basecoat, never the palette (garment) colour
  assert(skinColourOf(p1) === stackFor({ race: "ork", subrace: "ironhide", className: "Barbarian", seed: 7, height: 1.75, vertexSpacing: cell }).layers[0].colour && skinColourOf(p1) !== DEFAULT_LOOK.garment, `skin colour ${skinColourOf(p1)}`);
  // creator operator override (U, Z-32): an op change renders; a locked layer / wrong-kind op is ignored; order moves a layer
  const sw = applyPresetOverrides(p1, [{ id: "p:skin.wash", blend: { albedo: "screen" } }]);
  assert(sw.finish.layers.find((l) => l.id === "skin.wash")!.override?.albedo === "screen", "override stored");
  const e = paintPreset(b.mesh, sw, { cell }).albedo;
  let lighter = 0, darker = 0;
  for (let i = 0; i < b.mesh.region.length; i++) {
    if (p1.finish.regionMaterial[b.mesh.region[i]] !== skinK) continue;
    const d0 = lumLin(e, i) - lumLin(a.albedo, i);
    if (d0 > 1e-6) lighter++; else if (d0 < -1e-6) darker++;
  }
  assert(lighter > 100 && darker === 0, `wash multiply -> screen must only lighten skin (lighter ${lighter}, darker ${darker})`);
  const locked = applyPresetOverrides(p1, [{ id: "*.guard", blend: { albedo: "multiply" } }, { id: "skin.varnish", blend: { roughness: "multiply" as never, albedo: "screen" } }]);
  assert(!locked.finish.layers.find((l) => l.id === "*.guard")!.override, "guard locked");
  assert(EDIT_LOCKED.has("*.guard") && Object.keys(editableOps(p1.finish.layers.find((l) => l.id === "*.guard")!)).length === 0, "editableOps guard");
  const vo = locked.finish.layers.find((l) => l.id === "skin.varnish")!.override;
  assert(vo?.roughness === "multiply" && vo.albedo === undefined, `varnish override ${JSON.stringify(vo)}`);
  const ord = applyPresetOverrides(p1, [{ id: "p:skin.glaze", order: 0 }]);
  assert(ord.finish.layers[0].id === "skin.glaze" && ord.finish.layers.length === p1.finish.layers.length, "order override");
});
