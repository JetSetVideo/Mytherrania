// Wave GEN lane S: the miniature paint pass (src/graphics/paint/Miniature.ts via FormShade.applyFormShade),
// the pipeline's paint stage (src/graphics/paint/PaintStage.ts) and intelligence -> hair
// (src/graphics/body/HairIntellect.ts via HairMesh.buildHairData / FaceParts). SPEC G60-G69.
// Pins the CONTRACT (identity, bounds, determinism, monotonicity, budget) and prints the measured numbers.
// @deno-types="@types/three"
import * as THREE from "three";
import { generateBody } from "../src/graphics/body/BodyMesh.ts";
import { paintSkin } from "../src/graphics/body/SkinnedHumanoid.ts";
import { REGIONS, type BodySpec, type MeshData } from "../src/graphics/body/contracts.ts";
import { applyFormShade, CAVITY_DARK, FORM_SKIP, formTerms, meanCurvature, RIDGE_LIGHT, vertexRings, WEAR_LIGHT } from "../src/graphics/paint/FormShade.ts";
import { cavityDepth, MINIATURE, miniatureTerms, PAINT_MAX_DARK } from "../src/graphics/paint/Miniature.ts";
import { DEFAULT_LOOK, paintStage } from "../src/graphics/paint/PaintStage.ts";
import { GARMENT_REGIONS } from "../src/graphics/paint/Recipes.ts";
import { formGainsFor } from "../src/graphics/body/Improvise.ts";
import type { Appearance } from "../src/game/Characters.ts";
import { anatomyFor } from "../src/graphics/body/Anatomy.ts";
import { ancestryOf } from "../src/game/Ancestry.ts";
import { greyFraction, lifeFraction, LIFESPAN } from "../src/game/Age.ts";
import { hairLengthM } from "../src/graphics/body/Proportions.ts";
import { type HeadFrame, headFrameOf } from "../src/graphics/body/HairFollicles.ts";
import { buildHairData, type HairData, HAIR_TRI_BUDGET, type HairInput } from "../src/graphics/body/HairMesh.ts";
import {
  HAIR_INTELLECT, intellectDensity, intellectGrey, intellectLengthMul, intellectSilver, intellectUnit, silverShift,
} from "../src/graphics/body/HairIntellect.ts";
import { buildFaceParts, greyedHex, silveredHex } from "../src/graphics/body/FaceParts.ts";
import { hexToLinear } from "../src/graphics/paint/Blend.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const toS = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const RACES = ["human", "elf", "dwarf", "ork"] as const;
const SEXES = ["male", "female"] as const;
const specOf = (race: string, sex: string): BodySpec => ({ race, subrace: null, className: "Warrior", height: 1.75, weight: 75, seed: 7, sex } as BodySpec);
const appOf = (race: string): Appearance => ({ body: DEFAULT_LOOK.garment, accent: DEFAULT_LOOK.accent, height: 1.75, weight: 75, hair: DEFAULT_LOOK.hair, eyes: "#2f6fb5", race, subrace: null });
const bodies = new Map<string, ReturnType<typeof generateBody>>();
const bodyOf = (race: string, sex: string) => {
  const k = `${race}/${sex}`;
  let b = bodies.get(k);
  if (!b) { b = generateBody(specOf(race, sex)); bodies.set(k, b); }
  return b;
};
const skipIds = new Set(FORM_SKIP.map((r) => REGIONS.indexOf(r as typeof REGIONS[number])));

Deno.test("SPEC G60: miniature identity — gain 0 is the wave-V form paint exactly, strength 0 the base, skipped regions untouched", () => {
  const b = bodyOf("human", "male"), spec = specOf("human", "male"), app = appOf("human");
  const base = paintSkin(b.mesh, spec, app, b.plan.cell, app.body, false);
  const opts = { cell: b.plan.cell, garment: GARMENT_REGIONS, regionGain: formGainsFor(spec.seed) };
  const v0 = applyFormShade(b.mesh, base.slice(), { ...opts, miniature: 0 });
  // The wave-V reference, recomputed from its own definition (sRGB multiply + lift, clamp, back to linear).
  const live = paintSkin(b.mesh, spec, app, b.plan.cell, app.body);
  const full = applyFormShade(b.mesh, base.slice(), opts);
  assert(live.every((x, i) => x === full[i]), "paintSkin = applyFormShade with the miniature on (the live rig gets it)");
  // Gain 0 is BIT-exact to the wave-V law (re-stated here from FormShade's constants: sRGB multiply by the
  // groove darkening, lift by the ridge sheen / cloth wear, clamp, back to linear).
  {
    const t = formTerms(b.mesh, { cell: b.plan.cell });
    const toL = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const gains = formGainsFor(spec.seed) as Record<string, { cavity: number; ridge: number }>;
    let diff = 0;
    for (let i = 0; i < base.length / 3; i++) {
      const reg = REGIONS[b.mesh.region[i]];
      if (skipIds.has(b.mesh.region[i])) continue;
      const gc = Math.fround(gains[reg]?.cavity ?? 1), gr = Math.fround(gains[reg]?.ridge ?? 1); // FormShade keeps the gains in a Float32Array
      const dark = 1 - 1 * gc * CAVITY_DARK * t.cavity[i];
      const lift = 1 * gr * ((GARMENT_REGIONS as readonly string[]).includes(reg) ? WEAR_LIGHT : RIDGE_LIGHT) * t.ridge[i];
      for (let k = 0; k < 3; k++) {
        let s = toS(base[i * 3 + k]) * dark;
        s += (1 - s) * lift;
        if (Math.fround(toL(Math.max(0, Math.min(1, s)))) !== v0[i * 3 + k]) diff++;
      }
    }
    assert(diff === 0, `miniature 0 differs from the wave-V law in ${diff} channels`);
  }
  const off = applyFormShade(b.mesh, base.slice(), { ...opts, strength: 0 });
  assert(off.every((x, i) => x === base[i]), "strength 0 = identity");
  let changed = 0;
  for (let i = 0; i < base.length / 3; i++) {
    if (skipIds.has(b.mesh.region[i])) {
      for (let k = 0; k < 3; k++) assert(full[i * 3 + k] === base[i * 3 + k], `${REGIONS[b.mesh.region[i]]} repainted`);
    } else if (full[i * 3] !== v0[i * 3]) changed++;
  }
  console.log(`  vertices changed by the miniature pass: ${changed} of ${base.length / 3}`);
  assert(changed > 0.5 * (base.length / 3) * 0.5, "the miniature pass paints the body");
});

Deno.test("SPEC G61: bounds — every channel in 0..1 and no channel below (1 - PAINT_MAX_DARK) x the unpainted base (4 races x 2 sexes)", () => {
  for (const race of RACES) for (const sex of SEXES) {
    const b = bodyOf(race, sex), spec = specOf(race, sex), app = appOf(race);
    const base = paintSkin(b.mesh, spec, app, b.plan.cell, app.body, false);
    const p = paintSkin(b.mesh, spec, app, b.plan.cell, app.body);
    let worst = 0;
    for (let i = 0; i < p.length; i++) {
      assert(p[i] >= 0 && p[i] <= 1, `${race}/${sex}: channel ${p[i]}`);
      const s0 = toS(base[i]);
      if (s0 > 1e-4) worst = Math.max(worst, 1 - toS(p[i]) / s0);
    }
    assert(worst <= PAINT_MAX_DARK + 1e-4, `${race}/${sex}: darkest channel ${worst.toFixed(4)} > ${PAINT_MAX_DARK}`);
  }
});

Deno.test("SPEC G62: determinism — the paint, the terms and the stage paint are bit-identical across runs", () => {
  const b = bodyOf("dwarf", "female"), spec = specOf("dwarf", "female");
  const a1 = paintStage(b.mesh, spec, b.plan.cell, {}, { metrics: false }).paint;
  const a2 = paintStage(b.mesh, spec, b.plan.cell, {}, { metrics: false }).paint;
  assert(a1.every((x, i) => x === a2[i]), "stage paint deterministic");
  const adj = vertexRings(b.mesh);
  const t1 = miniatureTerms(b.mesh, adj, { cell: b.plan.cell, garment: GARMENT_REGIONS });
  const t2 = miniatureTerms(b.mesh, vertexRings(b.mesh), { cell: b.plan.cell, garment: GARMENT_REGIONS });
  for (const k of ["edge", "ao", "height", "weather"] as const) assert(t1[k].every((x, i) => x === t2[k][i]), `${k} deterministic`);
});

/** A UV sphere (radius r). */
function sphere(r: number, n = 24): MeshData {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j < 2 * n; j++) {
    const th = Math.PI * i / n, ph = Math.PI * j / n, x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
    pos.push(r * x, r * y, r * z); nor.push(x, y, z);
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < 2 * n; j++) {
    const a = i * 2 * n + j, b = i * 2 * n + (j + 1) % (2 * n), c = a + 2 * n, d = b + 2 * n;
    idx.push(a, c, b, b, c, d);
  }
  return { positions: Float32Array.from(pos), normals: Float32Array.from(nor), indices: Uint32Array.from(idx), region: new Uint8Array(pos.length / 3) };
}

Deno.test("SPEC G63: the curvature terms are geometric — a sphere has no cavity (Taubin smoothing does not shrink), body cavities sit in concave creases", () => {
  const s = sphere(0.2), adj = vertexRings(s);
  const d = cavityDepth(s, adj, 0.025);
  const n = 24, mid = (n / 2) * 2 * n;
  let maxMid = 0;
  for (let j = 0; j < 2 * n; j++) maxMid = Math.max(maxMid, Math.abs(d[mid + j]));
  console.log(`  sphere r=0.2 m: |cavity depth| on the equator <= ${maxMid.toFixed(4)} cells`);
  assert(maxMid < 0.05, `a sphere reads as a crease/ridge: ${maxMid}`);
  const t = miniatureTerms(s, adj, { cell: 0.025 });
  let aoMid = 0;
  for (let j = 0; j < 2 * n; j++) aoMid = Math.max(aoMid, t.ao[mid + j]);
  assert(aoMid === 0, `sphere cavity wash ${aoMid}`);
  // On a body (mostly convex: limbs are cylinders, mean H ~ +5..10 /m) the wash goes where the surface is
  // LESS convex than average (creases between masses) and the edge highlight where it is far MORE convex.
  // Measured, not hoped: the washed vertices' mean H is about half the body's, never negative on average —
  // the wash is a broad-scale depth (Taubin low-pass), the 2-ring H a fine one.
  for (const race of RACES) {
    const b = bodyOf(race, "male"), a = vertexRings(b.mesh), H = meanCurvature(b.mesh, 2, a);
    const tb = miniatureTerms(b.mesh, a, { cell: b.plan.cell });
    let hm = 0, hc = 0, wc = 0, he = 0, we = 0;
    for (let i = 0; i < H.length; i++) { hm += H[i]; hc += H[i] * tb.ao[i]; wc += tb.ao[i]; he += H[i] * tb.edge[i]; we += tb.edge[i]; }
    hm /= H.length;
    console.log(`  ${race}: body mean H ${hm.toFixed(2)} /m, wash-weighted ${(hc / wc).toFixed(2)} /m, edge-weighted ${(he / we).toFixed(2)} /m`);
    assert(hc / wc < 0.6 * hm && he / we > 2 * hm, `${race}: wash not in the creases or edge not on the ridges`);
  }
});

Deno.test("SPEC G64: contrast — the miniature pass separates ridges from cavities more than wave V did, and the feet sit darker than the shoulders", () => {
  const rows: string[] = [];
  for (const race of RACES) for (const sex of SEXES) {
    const b = bodyOf(race, sex), spec = specOf(race, sex);
    const v = paintStage(b.mesh, spec, b.plan.cell, {}, { miniature: 0 }).record.metrics;
    const g = paintStage(b.mesh, spec, b.plan.cell).record.metrics;
    rows.push(`${race}/${sex}: contrast V ${v.ridgeCavityContrast.toFixed(3)} -> GEN ${g.ridgeCavityContrast.toFixed(3)}, ridge ${g.ridgeRatio.toFixed(3)} cavity ${g.cavityRatio.toFixed(3)}, top ${g.topRatio.toFixed(3)} bottom ${g.bottomRatio.toFixed(3)}`);
    assert(g.ridgeCavityContrast > v.ridgeCavityContrast + 0.03, `${race}/${sex}: contrast ${v.ridgeCavityContrast} -> ${g.ridgeCavityContrast}`);
    assert(g.ridgeCavityContrast > 1.1, `${race}/${sex}: contrast ${g.ridgeCavityContrast}`);
    assert(g.bottomRatio < g.topRatio - 0.05, `${race}/${sex}: chiaroscuro top ${g.topRatio} bottom ${g.bottomRatio}`);
  }
  console.log("  " + rows.join("\n  "));
});

Deno.test("SPEC G65: weathering is cloth-only and bounded; a bare body (no garment) is not weathered", () => {
  const b = bodyOf("ork", "male"), adj = vertexRings(b.mesh), cloth = new Set(GARMENT_REGIONS.map((r) => REGIONS.indexOf(r)));
  const t = miniatureTerms(b.mesh, adj, { cell: b.plan.cell, garment: GARMENT_REGIONS });
  let on = 0, nOn = 0;
  for (let i = 0; i < t.weather.length; i++) {
    assert(t.weather[i] >= 0 && t.weather[i] <= 1, "weather in 0..1");
    if (!cloth.has(b.mesh.region[i])) assert(t.weather[i] === 0, `${REGIONS[b.mesh.region[i]]} weathered`);
    else { on += t.weather[i]; nOn++; }
  }
  console.log(`  mean weathering on cloth ${(on / nOn).toFixed(3)} (x WEATHER_MAX ${MINIATURE.weatherMax} grime + ${MINIATURE.weatherFade} fade)`);
  assert(on / nOn > 0.05, "garments carry some weathering");
  const bare = paintStage(b.mesh, specOf("ork", "male"), b.plan.cell, { garment: "" });
  assert(bare.record.metrics.weatheredShare === 0, "a bare body is not weathered");
});

Deno.test("SPEC G66: the paint stage record — id 'paint', timings, finite metrics, the same paint as the live rig's paintSkin", () => {
  const rows: string[] = [];
  for (const race of RACES) {
    const b = bodyOf(race, "female"), spec = specOf(race, "female"), app = appOf(race);
    const st = paintStage(b.mesh, spec, b.plan.cell, { hair: app.hair, accent: app.accent, garment: app.body });
    const live = paintSkin(b.mesh, spec, app, b.plan.cell, app.body);
    assert(st.paint.length === live.length && st.paint.every((x, i) => x === live[i]), `${race}: stage paint != paintSkin`);
    const r = st.record;
    assert(r.id === "paint" && r.label === "Paint" && r.ms > 0 && r.warnings.length === 0, `${race}: record ${JSON.stringify(r)}`);
    for (const [k, x] of Object.entries(r.metrics)) assert(Number.isFinite(x), `${race}: metric ${k} = ${x}`);
    assert(r.metrics.vertices === b.mesh.positions.length / 3, "vertex count");
    rows.push(`${race}: ${r.metrics.vertices} vertices, stage ${r.ms.toFixed(1)} ms (layers ${r.metrics.layersMs.toFixed(1)}, form ${r.metrics.formMs.toFixed(1)}, miniature ${r.metrics.miniatureMs.toFixed(1)})`);
  }
  console.log("  " + rows.join("\n  "));
});

// --- intelligence -> hair ----------------------------------------------------------------------

const ANCESTRIES: [string, string | null][] = [
  ["human", null], ["human", "imperial"], ["human", "nomad"], ["human", "islander"],
  ["elf", null], ["elf", "high"], ["elf", "wood"], ["elf", "dark"],
  ["dwarf", null], ["dwarf", "mountain"], ["dwarf", "forge"], ["dwarf", "deep"],
  ["ork", null], ["ork", "greenhide"], ["ork", "ironhide"], ["ork", "bloodfang"],
];
const frames = new Map<string, HeadFrame>();
function frameOf(race: string, sub: string | null): HeadFrame {
  const k = `${race}/${sub}`;
  let f = frames.get(k);
  if (!f) {
    const plan = anatomyFor({ race, subrace: sub, className: "Warrior", height: 1.7, weight: 70, seed: 7 });
    f = headFrameOf(plan.face, [0, 0, 0], plan.proportions.head, ancestryOf(race, sub).ears.lengthMul);
    frames.set(k, f);
  }
  return f;
}
function hairInput(race: string, sub: string | null, seed: number, years: number | undefined, intelligence?: number): HairInput {
  const node = ancestryOf(race, sub), f = frameOf(race, sub);
  const inp: HairInput = {
    frame: f, spec: node.hair, lengthM: hairLengthM(node, f.h), seed, race, ancestryIds: [race, sub ?? ""], sex: "male",
    lifeFraction: lifeFraction(race, years), grey: greyFraction(race, years), baseHex: node.hair.colors[0], skinHex: node.skin.base,
  };
  if (intelligence !== undefined) inp.intelligence = intelligence;
  return inp;
}
function meanLum(d: HairData): number {
  let s = 0, n = 0;
  for (const b of d.groups.values()) for (let i = 0; i < b.col.length; i += 3) { s += 0.2126 * b.col[i] + 0.7152 * b.col[i + 1] + 0.0722 * b.col[i + 2]; n++; }
  return s / Math.max(1, n);
}
const TIER_RANK: Record<string, number> = { buzz: 0, short: 1, shoulder: 2, long: 3 };

Deno.test("SPEC G67: intelligence identity — absent == 500, every law the identity at the reference, hair byte-identical", () => {
  assert(intellectUnit(undefined) === 0 && intellectUnit(500) === 0 && intellectUnit(NaN) === 0, "unit");
  assert(intellectLengthMul(500) === 1 && intellectDensity(0.6, 500) === 0.6 && intellectGrey(0.3, 500) === 0.3 && intellectSilver(500) === 0, "laws");
  for (const [race, sub] of ANCESTRIES) for (const seed of [3, 29]) {
    const a = buildHairData(hairInput(race, sub, seed, undefined));
    const b = buildHairData(hairInput(race, sub, seed, undefined, 500));
    for (const [k, buf] of a.groups) {
      const o = b.groups.get(k);
      assert(o && o.pos.length === buf.pos.length && o.pos.every((x, i) => x === buf.pos[i]) && o.col.every((x, i) => x === buf.col[i]), `${race}/${sub}/${seed}: group ${k} differs`);
    }
    assert(a.groups.size === b.groups.size && JSON.stringify(a.stats) === JSON.stringify(b.stats), `${race}/${sub}: stats differ`);
  }
  // FaceParts: absent stats == {intelligence: 500} (triangles + hair stats).
  const plan = anatomyFor({ race: "human", subrace: null, className: "Warrior", height: 1.7, weight: 70, seed: 7 });
  const app: Appearance = { body: "#c08870", accent: "#dfaa55", height: 1.7, weight: 70, hair: "#3a2a1e", eyes: "#2f6fb5", race: "human", subrace: null, age: 60 };
  const headSeg = plan.bones.find((x) => x.id === "head")!;
  const f0 = buildFaceParts(new THREE.Group(), plan.face, headSeg.head, plan.proportions.head, app);
  const f5 = buildFaceParts(new THREE.Group(), plan.face, headSeg.head, plan.proportions.head, app, { intelligence: 500 });
  assert(f0.triangleCount === f5.triangleCount && JSON.stringify(f0.hairStats) === JSON.stringify(f5.hairStats), "FaceParts identity");
  assert(silveredHex("#3a2a1e", "human", 0.4, 500) === greyedHex("#3a2a1e", "human", 0.4), "brow/beard identity");
});

Deno.test("SPEC G68: intelligence is monotone and bounded — length tier, follicles, grey share up; never darker than age alone", () => {
  const grid = [0, 250, 500, 750, 1000];
  for (let i = 1; i < grid.length; i++) {
    assert(intellectLengthMul(grid[i]) >= intellectLengthMul(grid[i - 1]), "length law monotone");
    assert(intellectDensity(0.6, grid[i]) >= intellectDensity(0.6, grid[i - 1]), "density law monotone");
    assert(intellectGrey(0.2, grid[i]) >= intellectGrey(0.2, grid[i - 1]), "grey law monotone");
  }
  assert(intellectLengthMul(0) === 1 - HAIR_INTELLECT.lengthDown && intellectLengthMul(1000) === 1 + HAIR_INTELLECT.lengthUp, "length bounds");
  assert(intellectLengthMul(-50) === intellectLengthMul(0) && intellectLengthMul(4000) === intellectLengthMul(1000), "clamped stat");
  assert(intellectDensity(0.9, 1000) <= 1 && intellectGrey(0.9, 1000) <= 1 && intellectGrey(0, 0) === 0, "bounded");
  // Silver never darkens a channel (any hair colour, incl. a near-white blond).
  const white = hexToLinear(HAIR_INTELLECT.silverWhite);
  for (const hex of ["#172128", "#3a2a1e", "#b8892f", "#f2e6b0", "#ffffff", "#8a1a10"]) {
    const c = hexToLinear(hex), s = silverShift(c, white, intellectSilver(1000));
    for (let k = 0; k < 3; k++) assert(s[k] >= c[k], `${hex}: silver darkened channel ${k}`);
    for (const g of [0, 0.3, 0.9]) {
      const a = new THREE.Color(greyedHex(hex, "human", g)), b = new THREE.Color(silveredHex(hex, "human", g, 1000));
      assert(b.r >= a.r && b.g >= a.g && b.b >= a.b, `${hex} g=${g}: brow darker than age alone`);
    }
  }
  const rows: string[] = [];
  for (const [race, sub] of ANCESTRIES) for (const years of [undefined, 0.75 * LIFESPAN[race]]) {
    const ds = grid.map((I) => buildHairData(hairInput(race, sub, 11, years, I)));
    for (let i = 1; i < ds.length; i++) {
      const a = ds[i - 1], b = ds[i];
      assert(b.plan.lengthM >= a.plan.lengthM - 1e-12, `${race}/${sub}: length ${a.plan.lengthM} -> ${b.plan.lengthM}`);
      assert(TIER_RANK[b.plan.tier] >= TIER_RANK[a.plan.tier], `${race}/${sub}: tier ${a.plan.tier} -> ${b.plan.tier}`);
      assert(b.stats.follicles >= a.stats.follicles, `${race}/${sub}: follicles ${a.stats.follicles} -> ${b.stats.follicles}`);
      assert(b.stats.grey >= a.stats.grey && b.stats.grey >= b.stats.ageGrey, `${race}/${sub}: grey ${a.stats.grey} -> ${b.stats.grey}`);
    }
    // Mean card colour at 1000 is never darker than at the reference (same age): the silver only lightens.
    const l5 = meanLum(ds[2]), l10 = meanLum(ds[4]);
    assert(l10 >= l5 - 1e-6, `${race}/${sub}: mean hair luminance ${l5} -> ${l10}`);
    // No silver CAP (Q2 r2): the scalp underlayer keeps the age colour, and the hanging locks silver with the crown.
    const u5 = ds[2].groups.get("under"), u10 = ds[4].groups.get("under");
    if (u5 && u10) assert(u10.col.length === u5.col.length && u10.col.every((x, i) => x === u5.col[i]), `${race}/${sub}: underlayer silvered`);
    const groupLum = (d: HairData, pick: (k: string) => boolean) => {
      let s = 0, n = 0;
      for (const [k, b] of d.groups) if (pick(k)) for (let i = 0; i < b.col.length; i += 3) { s += 0.2126 * b.col[i] + 0.7152 * b.col[i + 1] + 0.0722 * b.col[i + 2]; n++; }
      return n > 0 ? s / n : NaN;
    };
    const d10 = ds[4], scalp = groupLum(d10, (k) => k === "scalp"), hang = groupLum(d10, (k) => d10.hanging.includes(k));
    if (Number.isFinite(scalp) && Number.isFinite(hang)) {
      const lift = (x: number, y: number) => x - y;
      const dScalp = lift(scalp, groupLum(ds[2], (k) => k === "scalp")), dHang = lift(hang, groupLum(ds[2], (k) => ds[2].hanging.includes(k)));
      // The locks lift at least half as much as the crown's cards (braids: 3 bundles blend the extra share).
      assert(dHang >= 0.5 * dScalp, `${race}/${sub}: crown silvers far more than the locks (${dScalp.toFixed(3)} vs ${dHang.toFixed(3)})`);
    }
    if (years === undefined) rows.push(`${race}/${sub ?? "-"}: ` + ds.map((d, i) => `I${grid[i]} ${d.plan.style}/${d.plan.tier} L=${d.plan.lengthM.toFixed(3)} fol=${d.stats.follicles} grey=${d.stats.grey.toFixed(2)} lum=${meanLum(d).toFixed(3)}`).join(" | "));
  }
  console.log("  " + rows.join("\n  "));
});

Deno.test("SPEC G69: the hair triangle budget holds at every intelligence (16 ancestries x 3 seeds x I 0/500/1000)", () => {
  let worst = 0;
  for (const [race, sub] of ANCESTRIES) for (const seed of [3, 11, 101]) for (const I of [0, 500, 1000]) {
    const d = buildHairData(hairInput(race, sub, seed, 30, I));
    worst = Math.max(worst, d.stats.triangles);
    assert(d.stats.triangles <= HAIR_TRI_BUDGET, `${race}/${sub}/${seed} I=${I}: ${d.stats.triangles} > ${HAIR_TRI_BUDGET}`);
    assert(d.stats.minClearance >= 0, `${race}/${sub}: hair inside the skull`);
  }
  console.log(`  max hair triangles over 144 builds: ${worst} (budget ${HAIR_TRI_BUDGET})`);
});
