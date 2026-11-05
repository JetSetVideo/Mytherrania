// Wave TEX closing round (agent F): the four QA WARNs (Z-71) + the arena frame budget + QC REN-9 / QD Z-115/Z-121.
// SPEC TX90-97. Pure tests (no browser): the browser before/after numbers are in tools/probe-wave-tex-fix.ts and
// tools/bench-wave-tex.ts (docs/wave-tex/CLOSING.md).
import { generateBody } from "../src/graphics/body/BodyMesh.ts";
import { formGainsFor } from "../src/graphics/body/Improvise.ts";
import type { BodySpec, MeshData } from "../src/graphics/body/contracts.ts";
import { vertexRings } from "../src/graphics/paint/FormShade.ts";
import { fineCurvature } from "../src/graphics/paint/Miniature.ts";
import { hemisphereRays, meshOcclusion } from "../src/graphics/paint/MeshOcclusion.ts";
import {
  AO_SHARE, applyPresetOverrides, EDGE_CREST, OCCLUSION_AO, occlusionAo, paintPreset, presetBuffers, presetFor, subjectOfSpec,
} from "../src/graphics/paint/Presets.ts";
import {
  hypertrophicActivity, HYPERTROPHIC_ACTIVE, SCAR_KINDS, SCAR_STAGES, scarLook, scarStage, scarStageOf,
} from "../src/graphics/paint/marks/Scar.ts";
import { CEL_MATERIAL_GLSL, DECAL_GLSL } from "../src/graphics/shaders/CelMaterial.ts";
import { CEL_SKINNED_SHADERS, createCelSkinnedSurfaceMaterial } from "../src/graphics/shaders/CelSkinned.ts";
import { boundTilt, MAX_TILT, RELIEF_SHOULDER, RELIEF_SHOULDER_MAX, reliefProfile, reliefShoulder } from "../src/graphics/shaders/MaterialChannels.ts";
import { scarStageText } from "../src/ui/MarkEdit.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const RACES = ["human", "elf", "dwarf", "ork"] as const;
const specOf = (race: string, sex = "male", className = "Warrior", seed = 7): BodySpec =>
  ({ race, subrace: null, className, height: 1.75, weight: 75, seed, sex } as BodySpec);
const bodies = new Map<string, ReturnType<typeof generateBody>>();
const bodyOf = (race: string) => {
  let b = bodies.get(race);
  if (!b) { b = generateBody(specOf(race)); bodies.set(race, b); }
  return b;
};
const q = (a: ArrayLike<number>, p: number) => { const s = Array.from(a).sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

Deno.test("SPEC TX90: the off-neutral lit path looks the key's shadow up ONCE (arena budget); the neutral return is celShade alone", () => {
  const fn = CEL_MATERIAL_GLSL.slice(CEL_MATERIAL_GLSL.indexOf("vec3 celShadeMat("), CEL_MATERIAL_GLSL.indexOf("vec3 boundTilt("));
  const ret = "if (!(aoOn || roughOn || sssOn || emOn)) return celShade(base, n, l, viewPos, world, worldN, specular);";
  assert(fn.includes(ret), "neutral fragment: celShade returned alone");
  const after = fn.slice(fn.indexOf(ret) + ret.length);
  assert(!after.includes("celShade("), "the off-neutral path does not call celShade (it would look the shadow up again)");
  assert((after.match(/celShadow\(/g) ?? []).length === 1, "exactly one shadow lookup after the neutral return");
  // derivatives of the band / rim widths are taken before the first branch (uniform control flow)
  const body = fn.replace(/\/\/[^\n]*/g, "");
  assert(body.indexOf("fwidth(max(dot(n, l), 0.0))") < body.indexOf("if (!(aoOn"), "band AA derivative in uniform flow");
  // with P's details the wave-X grain / twill noise (gains 0) is compiled out; the neutral compile keeps it
  const frag = CEL_SKINNED_SHADERS.surfaceFragment;
  assert(/#ifndef USE_WAVE_TEX_DETAILS[\s\S]*dNoise\(p \* 600\.0\)[\s\S]*#endif/.test(frag), "grain skipped under USE_WAVE_TEX_DETAILS only");
});

Deno.test("SPEC TX91: scar relief reaches the shading — plateau with steep shoulders, tilt still bounded by MAX_TILT", () => {
  assert(DECAL_GLSL.includes(`${RELIEF_SHOULDER}`) && DECAL_GLSL.includes(`${RELIEF_SHOULDER_MAX}`), "GLSL uses the shoulder constants");
  // A 400-day hypertrophic laceration (h 0.44 mm, half width 2 mm, blur 0.3 mm) at the capture's forearm close-up
  // (1.24 mm/px) and at the full-body tile (3.6 mm/px): steepest slope of the new law vs the first law (shoulder =
  // max(W, blur, px)), by finite differences over s.
  const slope = (f: (s: number) => number, span: number) => {
    let m = 0;
    for (let s = -span; s <= span; s += span / 400) m = Math.max(m, Math.abs(f(s + 1e-6) - f(s - 1e-6)) / 2e-6);
    return m;
  };
  const h = 0.00044, W = 0.002, blur = 0.0003;
  for (const px of [0.00124, 0.0036]) {
    const neu = slope((s) => reliefProfile(s, h, W, blur, px), 0.01);
    const oldA = Math.max(W, blur, px);
    const old = slope((s) => { const t = Math.max(0, Math.min(1, (s + oldA) / (2 * oldA))); return h * (1 - t * t * (3 - 2 * t)); }, 0.01);
    assert(neu >= 1.6 * old, `px ${px}: slope ${neu.toFixed(3)} vs first law ${old.toFixed(3)}`);
    console.log(`TX91: px ${(px * 1000).toFixed(2)} mm: edge slope ${neu.toFixed(3)} (first law ${old.toFixed(3)}), tilt ${Math.min(MAX_TILT, Math.atan(neu)).toFixed(3)} rad`);
  }
  // the close-up tilt reaches the bound: the cel band guarantee (TX32) is what limits it, not the profile
  assert(Math.atan(slope((s) => reliefProfile(s, h, W, blur, 0.00124), 0.01)) > MAX_TILT, "close-up relief saturates the tilt bound");
  assert(reliefShoulder(W, blur, 0.00124) === Math.max(Math.min(W * RELIEF_SHOULDER, RELIEF_SHOULDER_MAX), blur, 0.00062), "shoulder law");
  assert(reliefProfile(-0.01, h, W, blur, 0.001) === h && reliefProfile(0.01, h, W, blur, 0.001) === 0, "plateau h inside, 0 outside");
  // bounded: any tilt request is clamped (re-stated from MaterialChannels.boundTilt)
  const n: [number, number, number] = [0, 0, 1], nb: [number, number, number] = [Math.sin(1.2), 0, Math.cos(1.2)];
  const r = boundTilt(n, nb);
  assert(Math.abs(Math.acos(r[2]) - MAX_TILT) < 1e-9, "tilt clamped");
});

Deno.test("SPEC TX92: stitched decals draw ONE centred line (QC REN-9): count = stitches, not parallel strokes", () => {
  assert(DECAL_GLSL.includes("float n = kind == 1 ? 1.0 : max(1.0, d4.y);"), "stitched: n = 1 (no sideways offset)");
});

Deno.test("SPEC TX93: geometric AO — hemisphere occlusion is 0 on an open convex surface, high between facing parts; deterministic and cached", () => {
  // two unit-ish boxes 6 cm apart facing each other (an arm against the ribs), plus a lone box
  const box = (cx: number, sx: number, sy: number, sz: number) => {
    const P: number[] = [], N: number[] = [], I: number[] = [];
    // 6 faces, each a 6x6 vertex grid
    const faces: [number[], number[], number[]][] = [
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
      [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
    ];
    const S = [sx, sy, sz];
    for (const [nn, a, b] of faces) {
      const base = P.length / 3, G = 6;
      for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
        const u = i / (G - 1) * 2 - 1, v = j / (G - 1) * 2 - 1;
        const p = [0, 1, 2].map((k) => (nn[k] + a[k] * u + b[k] * v) * S[k] + (k === 0 ? cx : 0));
        P.push(...p); N.push(...nn);
      }
      for (let i = 0; i < G - 1; i++) for (let j = 0; j < G - 1; j++) {
        const k = base + i * G + j;
        I.push(k, k + G, k + 1, k + 1, k + G, k + G + 1);
      }
    }
    return { P, N, I };
  };
  const merge = (...bs: { P: number[]; N: number[]; I: number[] }[]): MeshData => {
    const P: number[] = [], N: number[] = [], I: number[] = [];
    for (const b of bs) { const o = P.length / 3; P.push(...b.P); N.push(...b.N); I.push(...b.I.map((i) => i + o)); }
    return { positions: new Float32Array(P), normals: new Float32Array(N), indices: new Uint32Array(I), region: new Uint8Array(P.length / 3) } as unknown as MeshData;
  };
  const lone = merge(box(0, 0.1, 0.3, 0.1));
  const occLone = meshOcclusion(lone, { smooth: 0 });
  assert(q(occLone, 0.95) === 0 && Math.max(...occLone) <= 0.05, `a lone convex box sees open sky (max ${Math.max(...occLone)})`);
  const pair = merge(box(0, 0.1, 0.3, 0.1), box(0.26, 0.1, 0.3, 0.1)); // gap 6 cm between the +x face and the other's -x face
  const occ = meshOcclusion(pair, { smooth: 0 });
  let inner = 0, outer = 0, ni = 0, no = 0;
  for (let i = 0; i < occ.length; i++) {
    const x = pair.positions[i * 3], nx = pair.normals[i * 3], y = pair.positions[i * 3 + 1];
    if (Math.abs(y) > 0.2) continue;
    if (Math.abs(x - 0.1) < 1e-6 && nx > 0.9) { inner += occ[i]; ni++; }
    if (Math.abs(x + 0.1) < 1e-6 && nx < -0.9) { outer += occ[i]; no++; }
  }
  assert(ni > 0 && no > 0 && inner / ni > 0.3 && outer / no < 0.02, `facing face occluded ${(inner / ni).toFixed(3)}, outer face ${(outer / no).toFixed(3)}`);
  assert(meshOcclusion(pair, { smooth: 0 }) === occ, "cached per mesh");
  const a = meshOcclusion(merge(box(0, 0.1, 0.3, 0.1), box(0.26, 0.1, 0.3, 0.1)), { smooth: 0 });
  assert(a.every((v, i) => v === occ[i]), "deterministic");
  const R = hemisphereRays(16);
  for (let k = 0; k < 16; k++) assert(Math.abs(Math.hypot(R[k * 3], R[k * 3 + 1], R[k * 3 + 2]) - 1) < 1e-12 && R[k * 3 + 2] > 0, "unit upper-hemisphere rays");
});

Deno.test("SPEC TX94: the AO channel is populated on painted bodies — open skin stays 1, recesses darken within bounds, convex skin is not darkened", () => {
  const floor = (1 - AO_SHARE) * (1 - OCCLUSION_AO.gain);
  assert(occlusionAo(0) === 1 && occlusionAo(OCCLUSION_AO.onset) === 1 && Math.abs(occlusionAo(1) - (1 - OCCLUSION_AO.gain)) < 1e-12, "occlusion law ends");
  for (const race of RACES) {
    const b = bodyOf(race), cell = b.plan.cell;
    const ch = paintPreset(b.mesh, presetFor(subjectOfSpec(specOf(race), { garment: "#4f6f8a" }, cell)), { cell, regionGain: formGainsFor(7) });
    const ao = ch.ao!;
    const p50 = q(ao, 0.5), p5 = q(ao, 0.05), p1 = q(ao, 0.01), mn = Math.min(...ao);
    assert(mn >= floor - 1e-6 && Math.max(...ao) <= 1, `${race}: ao in [${floor.toFixed(3)}, 1] (min ${mn})`);
    assert(p50 >= 0.995, `${race}: open surfaces keep ao ~1 (p50 ${p50})`);
    assert(p1 <= 0.9, `${race}: the AO view is not flat (p1 ${p1})`);
    // convex skin (top-decile fine curvature) keeps its light (QD: AO is a contact darkening)
    const k = fineCurvature(b.mesh, vertexRings(b.mesh), cell), kq = q(k, 0.9);
    let s = 0, n = 0;
    for (let i = 0; i < ao.length; i++) if (k[i] >= kq) { s += ao[i]; n++; }
    assert(s / n >= 0.97, `${race}: convex mean ao ${s / n}`);
    console.log(`TX94 ${race}: ao min ${mn.toFixed(3)} p1 ${p1.toFixed(3)} p5 ${p5.toFixed(3)} p50 ${p50.toFixed(3)} convex mean ${(s / n).toFixed(3)}`);
  }
});

Deno.test("SPEC TX95: the fine edge highlight — a crest weight per vertex in [0, 1], off with the edge layer, drawn per fragment", () => {
  for (const race of RACES) {
    const b = bodyOf(race), cell = b.plan.cell;
    const preset = presetFor(subjectOfSpec(specOf(race), { garment: "#4f6f8a" }, cell));
    const buf = presetBuffers(b.mesh, preset, { cell, regionGain: formGainsFor(7) });
    const crest = buf.masks.crest;
    assert(crest && crest.length === b.mesh.positions.length / 3, `${race}: crest mask`);
    assert(crest.every((v) => v >= 0 && v <= 1), "crest in [0, 1]");
    // skin only (a crest on metal trim printed white blotches), on a thin share of the skin: the painter's LINE, not a wash
    let lit = 0, skinN = 0, garmentLit = 0;
    for (let i = 0; i < crest.length; i++) {
      if (buf.masks.skin[i] > 0.5) { skinN++; if (crest[i] > EDGE_CREST.onset) lit++; } else if (crest[i] > EDGE_CREST.onset) garmentLit++;
    }
    assert(lit > 0 && lit / skinN <= 0.15, `${race}: crest above onset on ${(100 * lit / skinN).toFixed(1)} % of skin vertices`);
    assert(garmentLit / Math.max(1, crest.length - skinN) <= 0.01, `${race}: garment crest ${garmentLit}`);
    console.log(`TX95 ${race}: crest > onset on ${(100 * lit / skinN).toFixed(1)} % of skin vertices`);
    const off = presetBuffers(b.mesh, applyPresetOverrides(preset, [{ id: "p:skin.edge", enabled: false }]), { cell, regionGain: formGainsFor(7) });
    let leak = 0;
    for (let i = 0; i < crest.length; i++) if (off.masks.skin[i] > 0.5 && (off.masks.crest?.[i] ?? 0) > 0) leak++;
    assert(leak === 0, `${race}: skin crest off with the skin edge layer (${leak})`);
  }
  const m = createCelSkinnedSurfaceMaterial("#fff", { material: { edge: true }, detail: true });
  assert("USE_WAVE_TEX_EDGE" in m.defines && "USE_WAVE_TEX_LIT" in m.defines, "edge implies the lit compile");
  const plain = createCelSkinnedSurfaceMaterial("#fff", { material: true, detail: true });
  assert(!("USE_WAVE_TEX_EDGE" in plain.defines), "no edge attribute, no edge define");
  const frag = CEL_SKINNED_SHADERS.surfaceFragment;
  assert(frag.includes(`smoothstep(${EDGE_CREST.onset.toFixed(2)}, ${EDGE_CREST.full.toFixed(2)}, vEdge) * ${EDGE_CREST.lift.toFixed(2)}`), "crest law in the shader");
  assert(CEL_SKINNED_SHADERS.surfaceVertex.includes("attribute float aEdge;"), "aEdge attribute");
});

Deno.test("SPEC TX96: mature scars (QD Z-115) — an ordinary 400-day laceration is flat/atrophic; a raised scar never reads 'mature'", () => {
  const lac = scarLook("laceration", 400, false, false);
  assert(lac.heightMm <= 0 && lac.heightMm >= -0.1 && lac.stage === "mature", `ordinary 400 d: ${lac.heightMm} mm ${lac.stage}`);
  for (const k of SCAR_KINDS) assert(scarLook(k, 400).heightMm <= 0.01, `${k}: ordinary 400 d not raised`);
  // stage shown: ordinary = by age; hypertrophic stays remodelling while active; keloid stays remodelling
  for (let a = 0; a <= 3650; a += 5) assert(scarStageOf(a) === scarStage(a), "ordinary = scarStage");
  assert(scarStageOf(400, false, true) === "remodelling" && hypertrophicActivity(400) >= HYPERTROPHIC_ACTIVE, "hypertrophic 400 d: remodelling");
  assert(scarStageOf(800, false, true) === "mature" && hypertrophicActivity(800) < HYPERTROPHIC_ACTIVE, "hypertrophic 800 d: mature");
  assert(scarStageOf(3650, true, false) === "remodelling", "keloid never 'mature'");
  for (const [kel, hyp] of [[false, false], [false, true], [true, false], [true, true]]) {
    let prev = 0;
    for (let a = 0; a <= 3650; a += 1) {
      const k = SCAR_STAGES.indexOf(scarStageOf(a, kel, hyp));
      assert(k >= prev, `stage order monotone (keloid ${kel}, hypertrophic ${hyp}) at ${a} d`);
      prev = k;
    }
  }
  assert(scarLook("laceration", 400, false, true).stage === "remodelling", "scarLook carries the shown stage");
  // the player's words (U's MarkEdit, QD Z-121)
  assert(scarStageText(400) === "mature: pale, flat", "no flags: by age");
  assert(scarStageText(400, { hypertrophic: true }).startsWith("maturing: raised"), "hypertrophic words");
  assert(scarStageText(900, { keloid: true }).startsWith("keloid: raised"), "keloid words");
  // Parent fix after QD Z-141: from 21 days a keloid / active hypertrophic scar is raised, so its words say so.
  assert(scarStageText(10, { keloid: true }) === scarStageText(10), "a fresh keloid: the age stage");
  assert(scarStageText(180, { keloid: true }).startsWith("keloid: raised"), "a 6-month keloid never reads fading");
  assert(scarStageText(120, { hypertrophic: true }).startsWith("maturing: raised"), "a hypertrophic scar at its peak reads raised");
});

Deno.test("SPEC TX97: a mature ordinary scar reads PALER and less saturated than the painted skin around it (QD Z-115 / Z-128)", async () => {
  const { texMaterialFor } = await import("../src/graphics/shaders/TexWiring.ts");
  const { localSkinSrgb } = await import("../src/graphics/paint/marks/MarkLibrary.ts");
  const l2s = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  const lab = (c: readonly number[]) => { // sRGB -> L*, C* (D65)
    const lin = c.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    const X = (0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]) / 0.95047, Y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2], Z = (0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]) / 1.08883;
    const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const L = 116 * f(Y) - 16, a = 500 * (f(X) - f(Y)), b = 200 * (f(Y) - f(Z));
    return { L, C: Math.hypot(a, b) };
  };
  const marks = { scars: [{ kind: "laceration", region: "foreArm", side: 0, anchor: [0.15, 0.1], lengthMm: 70, widthMm: 4, angle: null, ageDays: 400, keloid: false, hypertrophic: false, seed: 11 }], tattoos: [] };
  for (const race of RACES) {
    const b = bodyOf(race), spec = specOf(race);
    const tex = texMaterialFor(b.mesh, spec, { body: "#c79a80", marks } as never, b.plan.cell, "", formGainsFor(7), b.plan.face);
    const d = tex!.input.decals!.find((x) => (x as { id?: string }).id === "scar.0")!;
    const h = d?.height ?? 0, alb = d?.albedo ?? [0, 0, 0];
    assert(d && h <= 0, `${race}: ordinary 400-day laceration is not raised (${h})`);
    const here = localSkinSrgb(b.mesh, tex!.albedo!, d.center, "foreArm", 0.035)!;
    const scar = lab(alb.map(l2s)), skin = lab(here);
    assert(scar.L > skin.L && scar.C < skin.C, `${race}: scar L* ${scar.L.toFixed(1)} C* ${scar.C.toFixed(1)} vs skin L* ${skin.L.toFixed(1)} C* ${skin.C.toFixed(1)}`);
    console.log(`TX97 ${race}: dL* +${(scar.L - skin.L).toFixed(2)} dC* ${(scar.C - skin.C).toFixed(2)} height ${(h * 1000).toFixed(3)} mm`);
  }
});
