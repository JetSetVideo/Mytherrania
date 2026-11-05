// Wave TEX lane R: the rendering pins (SPEC TX30-TX39) — the pure parts of C-REND: decal packing, the bounded
// normal, the uniform budget, the neutral identity argument, the profiles, the glyph atlas and the rig wiring.
// The pixel proof (0 changed pixels with neutral channels) and the frame/build budget are measured in Chrome by
// tools/bench-wave-tex.ts (docs/wave-tex/RENDER.md).
//   NO_COLOR=1 deno test -A tests/wave_tex_render_test.ts
import {
  boundTilt, channelViewCode, DETAIL_KINDS, packDetails, CHANNEL_VIEWS, coverage, DEAD_ZONE, DECAL_FLOATS, DECAL_KINDS, DECAL_MAX, DECAL_VEC4,
  decalRadius, type FragmentDecal, HEIGHT_LIMIT, MATERIAL_NEUTRAL, MAX_TILT, packDecals, profileSdf, STROKES_MAX,
  WEBGL2_MIN_FRAGMENT_VEC4,
} from "../src/graphics/shaders/MaterialChannels.ts";
import { CEL_MATERIAL_GLSL, CHANNEL_VIEW_GLSL, DECAL_GLSL, DETAIL_GLSL, DOT_TONE_INK, DOT_TONE_PX } from "../src/graphics/shaders/CelMaterial.ts";
import { CEL_BAND_EDGES } from "../src/graphics/shaders/CelShader.ts";
import { CEL_SKINNED_SHADERS, createCelSkinnedSurfaceMaterial } from "../src/graphics/shaders/CelSkinned.ts";
import { neutralMaterial, setChannelView, setDecals } from "../src/graphics/shaders/MaterialRender.ts";
import { bakeGlyphAtlas, GLYPH_ATLAS_PX, GLYPH_CELL_PX, GLYPH_DIST_MAX, GLYPH_EXTENT, sampleGlyphAtlas } from "../src/graphics/textures/GlyphAtlas.ts";
import { SYMBOL_COUNT, symbolDistance } from "../src/graphics/paint/Symbols.ts";
import { CHANNEL_SPECS, MATERIAL_LAYOUT } from "../src/graphics/paint/Channels.ts";
import { buildSkinnedHumanoid } from "../src/graphics/body/SkinnedHumanoid.ts";
import { TEX_DEFAULTS } from "../src/graphics/shaders/TexWiring.ts";
import { generateClassWeapon } from "../src/game/WeaponGen.ts";
import type { BodySpec } from "../src/graphics/body/contracts.ts";
// @deno-types="@types/three"
import type * as THREE from "three";

function assert(ok: boolean, msg = "assertion failed"): void { if (!ok) throw new Error(msg); }
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const unit = (r: () => number): [number, number, number] => {
  for (;;) {
    const v: [number, number, number] = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1];
    const l = Math.hypot(...v);
    if (l > 0.1 && l <= 1) return [v[0] / l, v[1] / l, v[2] / l];
  }
};
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const SCAR: FragmentDecal = {
  kind: "line", center: [0.05, 1.2, 0.12], normal: [0, 0, 2], tangent: [1, 0.2, 0.5], halfLength: 0.06, halfWidth: 0.003,
  blur: 0.0005, albedo: [0.6, 0.3, 0.3], albedoOpacity: 0.8, roughness: 0.2, roughnessOpacity: 1, height: 0.002, seed: 0.25,
  count: 3, spacing: 0.015,
};

Deno.test("SPEC TX30: packDecals writes the posted layout (7 vec4 per decal, unit frame, tangent orthogonal to the normal)", () => {
  assert(DECAL_VEC4 === 7 && DECAL_FLOATS === DECAL_MAX * DECAL_VEC4 * 4 && DECAL_MAX === 16, "block size");
  const tattoo: FragmentDecal = { kind: "band", center: [0, 1, 0], normal: [1, 0, 0], tangent: [0, 1, 0], halfLength: 0.02, halfWidth: 0.002, glyph: 3, wrapRadius: 0.04, spacing: 0.01, albedo: [0.05, 0.05, 0.1], emissive: 0.5 };
  const p = packDecals([SCAR, tattoo]);
  assert(p.count === 2 && p.dropped.length === 0 && p.anyHeight, `count ${p.count}`);
  const d = p.data;
  assert(d[0] === Math.fround(0.05) && d[1] === Math.fround(1.2) && d[2] === Math.fround(0.12), "D0 centre");
  const t = [d[4], d[5], d[6]], n = [d[8], d[9], d[10]];
  assert(Math.abs(Math.hypot(...t) - 1) < 1e-6 && Math.abs(Math.hypot(...n) - 1) < 1e-6, "unit frame");
  assert(Math.abs(dot(t, n)) < 1e-6, `tangent orthogonalised (${dot(t, n)})`);
  assert(d[7] === Math.fround(0.06) && d[11] === Math.fround(0.003), "D1.w halfLength, D2.w halfWidth");
  assert(d[15] === Math.fround(0.8), "D3.w albedo opacity");
  assert(d[16] === DECAL_KINDS.indexOf("line") && d[17] === 3 && d[18] === Math.fround(0.0005) && d[19] === 0.25, "D4 kind, strokes, blur, seed");
  assert(d[20] === Math.fround(0.2) && d[21] === 1 && d[22] === Math.fround(0.002) && d[23] === 0, "D5 roughness, opacity, height, emissive");
  assert(d[24] === Math.fround(0.015) && d[25] === 0 && d[26] === 0 && d[27] === 1, "D6 spacing, wrap, wrapMode, glyph row");
  const o = DECAL_VEC4 * 4;
  assert(d[o + 16] === DECAL_KINDS.indexOf("band") && d[o + 17] === 3 && d[o + 25] === Math.fround(0.04) && d[o + 23] === 0.5, "second decal: band, glyph, wrap, emissive");
  assert(d[o + 21] === 0, "roughness opacity 0 when the decal leaves roughness alone");
  // wrapAxis: a glyph whose tangent runs ROUND the limb wraps about its bitangent (M's upright forearm glyph).
  const g = packDecals([{ kind: "glyph", center: [0.3, 1.2, 0], normal: [0, 0, 1], tangent: [1, 0, 0], halfLength: 0.02, halfWidth: 0.002, glyph: 1, wrapRadius: 0.04, wrapAxis: [0, 1, 0], count: 3, spacing: 0.03 }]).data;
  assert(g[26] === 1 && g[27] === 3, "wrap about the bitangent, 3 glyphs in a row");
  assert(g[3] >= Math.SQRT2 * 0.02 + 0.03, "row widens the radius");
  // The radius covers every stroke: the outermost claw stroke's tip at (L, (n-1)/2 sp + W) is inside.
  const tip = Math.hypot(SCAR.halfLength, SCAR.spacing! + SCAR.halfWidth);
  assert(d[3] > tip, `radius ${d[3]} > ${tip}`);
  // band: the radius reaches the far side of the limb (2 x wrap radius).
  assert(d[o + 3] >= 2 * 0.04, "band radius covers the limb");
  console.log(`TX30: block ${DECAL_FLOATS} floats; scar radius ${(d[3] * 1000).toFixed(1)} mm, band radius ${(d[o + 3] * 1000).toFixed(1)} mm`);
});

Deno.test("SPEC TX31: packing is total — budget, degenerate frames, NaN, relief clamp", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ ...SCAR, seed: i / 20 }));
  const p = packDecals(many);
  assert(p.count === DECAL_MAX && p.dropped.join() === "16,17,18,19", `over budget dropped in order: ${p.dropped}`);
  const bad: FragmentDecal[] = [
    { ...SCAR, normal: [0, 0, 0] },
    { ...SCAR, tangent: [0, 0, 1] }, // parallel to the normal
    { ...SCAR, halfLength: 0 },
    { ...SCAR, center: [NaN, 0, 0] },
    { ...SCAR, kind: "smudge" as never },
    { ...SCAR, height: 1, blur: NaN, albedoOpacity: NaN, roughness: NaN, seed: Infinity, count: 99 },
  ];
  const q = packDecals(bad);
  assert(q.count === 1 && q.dropped.join() === "0,1,2,3,4", `degenerate dropped: ${q.dropped}`);
  assert(q.data.every(Number.isFinite), "no NaN / Infinity in the block");
  assert(q.data[22] === Math.fround(HEIGHT_LIMIT), "relief clamped to HEIGHT_LIMIT");
  assert(q.data[17] === STROKES_MAX, "strokes clamped");
  assert(q.data[20] === 0.5 && q.data[18] === 0 && q.data[15] === 1, "NaN fields take defaults");
  assert(packDecals([]).count === 0 && !packDecals([]).anyHeight, "empty");
  // glyph kinds carry no relief: the relief pass would cost them 3 more atlas fetches (budget <= 1 per decal)
  const gl = packDecals([{ ...SCAR, kind: "glyph", glyph: 2, height: 0.002 }, { ...SCAR, kind: "band", wrapRadius: 0.03, height: -0.001 }]);
  assert(gl.data[22] === 0 && gl.data[DECAL_VEC4 * 4 + 22] === 0 && !gl.anyHeight, "glyph / band height dropped");
  for (const k of DECAL_KINDS) assert(decalRadius({ ...SCAR, kind: k, wrapRadius: 0.03 }) > 0, k);
});

Deno.test("SPEC TX32: the height-perturbed normal is bounded — tilt <= MAX_TILT, so a relief crosses at most ONE cel band", () => {
  const r = rng(32);
  let worstTilt = 0, worstDl = 0;
  for (let i = 0; i < 20000; i++) {
    const n = unit(r), nb = i % 50 === 0 ? [-n[0], -n[1], -n[2]] as [number, number, number] : unit(r), l = unit(r);
    const b = boundTilt(n, nb);
    assert(Math.abs(Math.hypot(...b) - 1) < 1e-9, "unit");
    const tilt = Math.acos(Math.min(1, dot(n, b)));
    worstTilt = Math.max(worstTilt, tilt);
    worstDl = Math.max(worstDl, Math.abs(dot(b, l) - dot(n, l)));
    if (Math.acos(Math.min(1, dot(n, nb))) <= MAX_TILT) assert(dot(b, nb) > 1 - 1e-12, "inside the bound: unchanged");
  }
  const gap = CEL_BAND_EDGES[1] - CEL_BAND_EDGES[0];
  const bound = 2 * Math.sin(MAX_TILT / 2);
  assert(worstTilt <= MAX_TILT + 1e-9, `tilt ${worstTilt}`);
  assert(worstDl <= bound + 1e-9 && bound < gap, `lambert change ${worstDl} <= ${bound} < band gap ${gap}`);
  // the GLSL carries the same constants
  assert(CEL_MATERIAL_GLSL.includes(`const float cm = ${Math.cos(MAX_TILT)}`), "GLSL cos(MAX_TILT)");
  console.log(`TX32: worst tilt ${worstTilt.toFixed(4)} rad (MAX ${MAX_TILT}), worst |dLambert| ${worstDl.toFixed(4)} <= ${bound.toFixed(4)} < band gap ${gap}`);
});

/** vec4 rows a uniform takes (conservative: every scalar / vector a full row, matN = N rows). */
function uniformRows(glsl: string): { rows: number; samplers: number; names: string[] } {
  const seen = new Set<string>();
  let rows = 0, samplers = 0;
  for (const m of glsl.matchAll(/uniform\s+(\w+)\s+(\w+)\s*(?:\[\s*(\d+)\s*\])?\s*;/g)) {
    const [, type, name, len] = m;
    if (seen.has(name)) continue;
    seen.add(name);
    const n = len ? Number(len) : 1;
    if (type.startsWith("sampler")) { samplers += n; continue; }
    rows += n * (type === "mat4" ? 4 : type === "mat3" ? 3 : type === "mat2" ? 2 : 1);
  }
  return { rows, samplers, names: [...seen] };
}

Deno.test("SPEC TX33: uniform budget — the material fragment fits WebGL2's guaranteed 224 vec4 and 16 samplers", () => {
  const frag = CEL_SKINNED_SHADERS.surfaceFragment;
  const u = uniformRows(frag);
  const THREE_PREFIX_ROWS = 4 + 1 + 1 + 1; // viewMatrix, cameraPosition, isOrthographic, toneMappingExposure
  const total = u.rows + THREE_PREFIX_ROWS;
  const decalRows = DECAL_MAX * DECAL_VEC4;
  assert(frag.includes(`uniform vec4 uDecals[${decalRows}]`), "decal block declared at DECAL_MAX x DECAL_VEC4");
  assert(total <= WEBGL2_MIN_FRAGMENT_VEC4, `fragment uniforms ${total} vec4 > ${WEBGL2_MIN_FRAGMENT_VEC4}`);
  assert(u.samplers <= 16, `samplers ${u.samplers}`);
  console.log(`TX33: fragment uniform rows ${total} / ${WEBGL2_MIN_FRAGMENT_VEC4} (decals ${decalRows}), samplers ${u.samplers}, ${u.names.length} uniforms`);
});

Deno.test("SPEC TX34: neutral channels take the pre-TEX path — celShade's expression verbatim, neutral inside every dead zone", () => {
  // celShadeMat starts from celShade ITSELF (a re-typed copy moved 8 px by 1/255 in Chrome: RENDER.md), and every
  // new term is guarded by a dead-zone test, so neutral channels return celShade's value untouched.
  const fn = CEL_MATERIAL_GLSL.slice(CEL_MATERIAL_GLSL.indexOf("vec3 celShadeMat("));
  assert(fn.includes("if (!(aoOn || roughOn || sssOn || emOn)) return celShade(base, n, l, viewPos, world, worldN, specular);"), "neutral: celShade returned alone");
  for (const guard of ["if (aoOn)", "if (roughOn || sssOn)", "if (emOn)", `>= ${DEAD_ZONE.emissive};`]) assert(fn.includes(guard), `guard ${guard}`);
  // Neutral values sit inside the dead zones (interpolation of a constant may drift 1 ulp: margins >> ulp).
  const [r, h, ao, sss] = MATERIAL_NEUTRAL;
  assert(Math.abs(r - 0.5) < DEAD_ZONE.roughness && ao > DEAD_ZONE.ao && sss < DEAD_ZONE.subsurface && h === 0, "neutral in dead zones");
  // ... and they are L's neutrals (C-MAT): the same vec4 layout and values.
  assert(MATERIAL_LAYOUT.join() === "roughness,height,ao,subsurface", "layout");
  MATERIAL_LAYOUT.forEach((k, i) => assert(CHANNEL_SPECS[k].neutral === MATERIAL_NEUTRAL[i], `${k} neutral ${CHANNEL_SPECS[k].neutral} vs ${MATERIAL_NEUTRAL[i]}`));
  // Material channels are opt-in per material; with them on, the uniforms default to no decals + the final view.
  const plain = createCelSkinnedSurfaceMaterial("#fff");
  assert(!("USE_WAVE_TEX" in plain.defines) && !("uDecals" in plain.uniforms), "other skinned meshes unchanged");
  const m = createCelSkinnedSurfaceMaterial("#fff", { material: true, detail: true });
  assert("USE_WAVE_TEX" in m.defines && m.uniforms.uDecalCount.value === 0 && m.uniforms.uChannelView.value === 0, "defaults");
  const n = neutralMaterial(3);
  assert(Array.from(n).join() === "0.5,0,1,0,0.5,0,1,0,0.5,0,1,0", "neutralMaterial");
});

Deno.test("SPEC TX35: decal profiles — spindle lines, stitches, discs; anti-aliased coverage is monotone with 0.5 on the edge", () => {
  const L = 0.05, W = 0.003;
  assert(Math.abs(profileSdf("line", 0, W, L, W)) < 1e-12, "centre half width = W");
  assert(profileSdf("line", 0, 0, L, W) === -W, "inside");
  const tipHw = -profileSdf("line", L * 0.999, 0, L, W);
  assert(tipHw >= 0 && tipHw <= 0.26 * W + 1e-9 && tipHw > 0, `tip tapers to >= 25 % (${tipHw / W})`);
  assert(profileSdf("line", L * 1.2, 0, L, W) > 0, "beyond the tip: outside");
  // stitches: a tick crosses the line at u = k x spacing, out to 3 W
  assert(profileSdf("stitched", 0.01, 2.5 * W, L, W, 0.01) < 0 && profileSdf("line", 0.01, 2.5 * W, L, W) > 0, "tick");
  assert(Math.abs(profileSdf("disc", L, 0, L, 0.02)) < 1e-12 && Math.abs(profileSdf("disc", 0, 0.02, L, 0.02)) < 1e-12, "disc edge");
  let prev = 2;
  for (let s = -0.01; s <= 0.01; s += 0.0001) { const c = coverage(s, 0.001, 0.0005); assert(c <= prev + 1e-12 && c >= 0 && c <= 1, "monotone"); prev = c; }
  assert(Math.abs(coverage(0, 0.001) - 0.5) < 1e-12 && coverage(-1, 0.001) === 1 && coverage(1, 0.001) === 0, "edge 0.5, saturates");
  assert(coverage(-0.0004, 0.001, 0.003) < coverage(-0.0004, 0.001, 0), "blur (ink migration) softens");
  // the shader carries the same coverage law
  assert(DECAL_GLSL.includes("sqrt(0.49 * px * px + blur * blur)"), "GLSL coverage law");
  // dotwork below DOT_TONE_PX px per dot turns into a tone at DOT_TONE_INK (QD Z-84 game read)
  assert(DECAL_GLSL.includes(`if (pitch < ${DOT_TONE_PX} * px) return ${DOT_TONE_INK};`) && DOT_TONE_INK >= 0.6, "dot tone");
});

Deno.test("SPEC TX36: the glyph atlas reproduces Symbols' distances within one texel, 64 KB, deterministic", () => {
  const t0 = performance.now();
  const a = bakeGlyphAtlas();
  const ms = performance.now() - t0;
  assert(a.length === GLYPH_ATLAS_PX * GLYPH_ATLAS_PX && a.length === 65536, "size");
  assert(bakeGlyphAtlas().every((v, i) => v === a[i]), "deterministic");
  const texel = 2 * GLYPH_EXTENT / GLYPH_CELL_PX;
  const r = rng(36);
  let worst = 0;
  for (let i = 0; i < 4000; i++) {
    const g = Math.floor(r() * SYMBOL_COUNT), u = (r() * 2 - 1) * GLYPH_EXTENT * 0.97, v = (r() * 2 - 1) * GLYPH_EXTENT * 0.97;
    const ref = Math.min(symbolDistance(g, u, v), GLYPH_DIST_MAX);
    if (ref >= GLYPH_DIST_MAX - texel) continue;
    worst = Math.max(worst, Math.abs(sampleGlyphAtlas(a, g, u, v) - ref));
  }
  assert(worst <= texel, `atlas error ${worst} > 1 texel ${texel}`);
  console.log(`TX36: ${SYMBOL_COUNT} glyphs, bake ${ms.toFixed(1)} ms, worst |d - ref| ${worst.toFixed(4)} glyph units (texel ${texel.toFixed(4)})`);
});

Deno.test("SPEC TX37: the rig carries neutral channels, the region per vertex, and live decal / view controls", () => {
  const spec: BodySpec = { race: "human", subrace: null, className: "Warrior", height: 1.75, weight: 72, seed: 37 };
  const app = { body: "#4f8490", accent: "#dfaa55", height: 1.75, weight: 72, hair: "#172128", beard: false, moustache: false, eyes: "#2f6fb5" };
  const saved = { ...TEX_DEFAULTS };
  TEX_DEFAULTS.generatedMarks = false; TEX_DEFAULTS.preset = false; // the neutral body: no preset, no generated marks
  let rig;
  try { rig = buildSkinnedHumanoid(generateClassWeapon("Warrior"), app, "fire", spec); } finally { Object.assign(TEX_DEFAULTS, saved); }
  assert(rig.material!.stack === null, "both switches off and nothing explicit: the wiring stays out");
  const g = rig.skin.geometry as THREE.BufferGeometry;
  const n = g.getAttribute("position").count;
  const mat = g.getAttribute("aMaterial");
  assert(mat.itemSize === 4 && mat.count === n, "aMaterial vec4 per vertex");
  for (let i = 0; i < n; i++) assert(mat.getX(i) === 0.5 && mat.getY(i) === 0 && mat.getZ(i) === 1 && mat.getW(i) === 0, "neutral");
  assert(!g.getAttribute("aEmissive"), "no emissive attribute unless given");
  assert((g.userData.region as Uint8Array).length === n, "userData.region per vertex");
  const m = rig.skin.material as THREE.ShaderMaterial;
  assert("USE_WAVE_TEX" in m.defines && !("USE_WAVE_TEX_EMISSIVE" in m.defines), "defines");
  assert(!("USE_WAVE_TEX_LIT" in m.defines), "neutral + no decal: the lit path is not compiled (pre-TEX statement)");
  const block = m.uniforms.uDecals.value as Float32Array;
  const p = rig.material!.setDecals([SCAR, { ...SCAR, kind: "glyph", glyph: 2 }]);
  assert(p.count === 2 && m.uniforms.uDecalCount.value === 2 && m.uniforms.uDecalRelief.value === 1, "live decals");
  assert(m.uniforms.uDecals.value === block && block[0] === Math.fround(0.05), "written IN PLACE (fade variants share the object)");
  assert(m.uniforms.uGlyphAtlas.value !== null, "glyph kind binds the atlas");
  assert("USE_WAVE_TEX_LIT" in m.defines, "decals switch the lit path on");
  rig.material!.setDecals([]);
  assert(!("USE_WAVE_TEX_LIT" in m.defines) && m.uniforms.uDecalCount.value === 0, "... and off again");
  rig.material!.setDecals([SCAR, { ...SCAR, kind: "glyph", glyph: 2 }]);
  rig.material!.setChannelView("roughness");
  assert(m.uniforms.uChannelView.value === CHANNEL_VIEWS.indexOf("roughness"), "view");
  assert(setChannelView(rig, "nonsense") && m.uniforms.uChannelView.value === 0, "unknown view -> final");
  assert(setDecals(null, []) === null && !setChannelView(rig.outline, "albedo"), "targets without channels refuse");
  // options.material: a wrong-length array falls back to neutral; an emissive array turns the define on.
  const rig2 = buildSkinnedHumanoid(generateClassWeapon("Warrior"), app, "fire", spec, {
    material: (mesh) => ({ aMaterial: new Float32Array(7), aEmissive: new Float32Array(mesh.positions.length).fill(0.2), decals: [SCAR] }),
  });
  const g2 = rig2.skin.geometry as THREE.BufferGeometry;
  assert(g2.getAttribute("aMaterial").getX(0) === 0.5 && g2.getAttribute("aEmissive").getX(0) === Math.fround(0.2), "fallback + emissive");
  const m2 = rig2.skin.material as THREE.ShaderMaterial;
  assert("USE_WAVE_TEX_EMISSIVE" in m2.defines && "USE_WAVE_TEX_LIT" in m2.defines && rig2.material!.packed.count === 1, "emissive define, build-time decals");
  rig2.material!.setDecals([]);
  assert("USE_WAVE_TEX_LIT" in m2.defines, "off-neutral vertex channels keep the lit path without decals");
});

Deno.test("SPEC TX37b (wiring): the default body takes P's preset + M's marks; explicit empty marks + no overrides + switches off = neutral", () => {
  const spec: BodySpec = { race: "ork", subrace: null, className: "Warrior", height: 1.9, weight: 110, seed: 4242 };
  const app = { body: "#5f7a3a", accent: "#dfaa55", height: 1.9, weight: 110, hair: "#172128", beard: false, moustache: false, eyes: "#2f6fb5" };
  const t0 = performance.now();
  const rig = buildSkinnedHumanoid(generateClassWeapon("Warrior"), app, "fire", spec);
  const ms = performance.now() - t0;
  const st = rig.material!.stack!;
  assert(st.paint.startsWith("preset:") && st.layers.length > 0, `preset painted: ${st.paint}`);
  const mat = (rig.skin.geometry as THREE.BufferGeometry).getAttribute("aMaterial");
  let rough = 0;
  for (let i = 0; i < mat.count; i++) rough += mat.getX(i);
  assert(rough / mat.count > 0.55, `ork skin reads matte (mean roughness ${(rough / mat.count).toFixed(3)})`);
  assert("USE_WAVE_TEX_LIT" in (rig.skin.material as THREE.ShaderMaterial).defines, "off-neutral body compiles the lit path");
  assert(st.marksSource === "generated" || st.marksSource === "none", st.marksSource);
  assert(rig.material!.packed.count === st.marks.length, "every mark the wiring kept is packed");
  // explicit marks win, in the body's own frames
  // explicit marks win; a mark under the outfit (Warrior bracers on the forearm) emits no decal (QD Z-37, M Z-63)
  const lac = (region: string) => ({ kind: "laceration", region, side: 0, anchor: [0.1, 0.1], lengthMm: 70, widthMm: 4, angle: null, ageDays: 400, keloid: null, seed: 3 });
  const marked = buildSkinnedHumanoid(generateClassWeapon("Warrior"), { ...app, marks: { scars: [lac("upperArm"), lac("foreArm")], tattoos: [] } } as never, "fire", spec);
  assert(marked.material!.stack!.marksSource === "explicit" && marked.material!.packed.count === 1, `explicit: ${marked.material!.packed.count} (upper arm drawn, covered forearm skipped)`);
  // P's relief details: one-hot material weights per vertex, the detail define, and the generic wave-X grain off
  const g = rig.skin.geometry as THREE.BufferGeometry, m = rig.skin.material as THREE.ShaderMaterial;
  const w = g.getAttribute("aDetailW");
  let ones = 0;
  for (let i = 0; i < w.count; i++) { const s4 = w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i); assert(s4 === 0 || s4 === 1, "one-hot"); ones += s4; }
  assert("USE_WAVE_TEX_DETAILS" in m.defines && ones > w.count * 0.8 && (st.details ?? []).length >= 3, `details on ${ones}/${w.count} vertices: ${st.details}`);
  assert(m.uniforms.uDetailGain.value.y === 0 && m.uniforms.uDetailGain.value.z === 0 && m.uniforms.uDetailGain.value.x > 0, "P's details replace the generic grain; abs relief stays");
  console.log(`TX37b: ork rig ${ms.toFixed(0)} ms (preset ${st.ms.preset.toFixed(1)} ms, marks ${st.ms.marks.toFixed(1)} ms), ${st.layers.length} finish layers, marks ${st.marksSource} ${st.marks.length} drawn / ${st.dropped.length} dropped, mean roughness ${(rough / mat.count).toFixed(3)}`);
});

Deno.test("SPEC TX38b: packDetails — materials own <= 2 slots, one-hot vertex weights by region, overflow dropped, total", () => {
  const regions = ["torso", "pelvis", "thigh", "foreArm", "face"];
  const det = (material: string, regs: string[], kind: string, periodMm = 4, amplitude = 0.0003) => ({ material, regions: regs, detail: { kind, periodMm, amplitude, octaves: 2 } }) as never;
  const p = packDetails([det("skin", ["face"], "pores"), det("torso", ["torso"], "grain"), det("torso", ["torso"], "studs", 70, 0.0025),
    det("torso", ["torso"], "weave"), det("legs", ["pelvis", "thigh"], "weave"), det("bracers", ["foreArm"], "hammered"),
    det("extra", ["face"], "plates"), det("bad", ["face"], "nope"), det("zero", ["face"], "pores", 4, 0)], [0, 1, 2, 3, 4, 4], regions);
  assert(p.materials.join() === "skin,torso,legs,bracers", `materials ${p.materials}`);
  assert(p.dropped.join() === "3,6,7,8", `dropped (3rd torso detail, 5th material, unknown kind, zero amplitude): ${p.dropped}`);
  assert(p.slots[0] === DETAIL_KINDS.indexOf("pores") && p.slots[2 * 4] === DETAIL_KINDS.indexOf("grain") && p.slots[3 * 4] === DETAIL_KINDS.indexOf("studs"), "slots 2m, 2m+1");
  assert(p.slots[3 * 4 + 1] === Math.fround(0.07) && p.slots[3 * 4 + 2] === Math.fround(0.0025), "period in metres, amplitude");
  const wsum = (v: number) => [0, 1, 2, 3].map((k) => p.weights[v * 4 + k]);
  assert(wsum(0).join() === "0,1,0,0" && wsum(1).join() === "0,0,1,0" && wsum(3).join() === "0,0,0,1" && wsum(4).join() === "1,0,0,0", "one-hot by region");
  assert(p.slots.every(Number.isFinite) && packDetails([], [0], regions).weights.every((x) => x === 0), "total");
  assert(DETAIL_GLSL.includes("uniform vec4 uMatDetail[8]") && (DETAIL_GLSL.match(/texture2D\s*\(/g) ?? []).length === 0, "procedural: no texture fetch");
});

Deno.test("SPEC TX38: per-body GPU memory and CPU build cost of the channels stay inside the budget", () => {
  const vertices = 12000; // above the live rig's skin (body < 12 k triangles)
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) neutralMaterial(vertices);
  const attachMs = (performance.now() - t0) / 20;
  const t1 = performance.now();
  const many = Array.from({ length: 16 }, (_, i) => ({ ...SCAR, seed: i / 16 }));
  for (let i = 0; i < 200; i++) packDecals(many);
  const packMs = (performance.now() - t1) / 200;
  const bytes = vertices * 16 + DECAL_FLOATS * 4;
  assert(attachMs + packMs < 5, `channel build ${attachMs.toFixed(2)} + ${packMs.toFixed(3)} ms`);
  assert(bytes < 256 * 1024, `per-body bytes ${bytes}`);
  console.log(`TX38: neutral aMaterial ${attachMs.toFixed(2)} ms / ${vertices} vertices, pack 16 decals ${packMs.toFixed(3)} ms; per body ${(bytes / 1024).toFixed(0)} KB (+64 KB atlas once)`);
});

Deno.test("SPEC TX39: shader structure — bounded loops, ONE glyph fetch per decal, no derivatives in the decal loop, view codes", () => {
  const fetches = (DECAL_GLSL.match(/texture2D\s*\(/g) ?? []).length;
  assert(fetches === 1, `texture fetch sites in the decal chunk: ${fetches}`);
  // glyphDist is called once per decal kind branch (glyph, dots: once each; band: once) -> <= 1 fetch per decal per pass
  const sdf = DECAL_GLSL.slice(DECAL_GLSL.indexOf("float decalSdf("), DECAL_GLSL.indexOf("float decalCoverage("));
  for (const branch of sdf.split(/if \(kind ==|\/\/ band:/)) assert((branch.match(/glyphDist\(/g) ?? []).length <= 1, "one glyph lookup per kind branch");
  assert(DECAL_GLSL.includes(`for (int i = 0; i < ${DECAL_MAX}; i++)`) && DECAL_GLSL.includes(`for (int k = 0; k < ${STROKES_MAX}; k++)`), "constant loop bounds");
  assert(!/dFdx|dFdy|fwidth/.test(DECAL_GLSL), "no derivatives inside the decal functions (non-uniform control flow)");
  const main = CEL_SKINNED_SHADERS.surfaceFragment;
  const wt = main.slice(main.indexOf("Derivatives first")).replace(/\/\/[^\n]*/g, ""); // code only
  const firstBranch = wt.indexOf("if (");
  const lastDeriv = Math.max(wt.lastIndexOf("dFdx("), wt.lastIndexOf("dFdy("));
  assert(lastDeriv > 0 && lastDeriv < firstBranch, "every derivative of the wave-TEX main precedes its first branch");
  assert(CHANNEL_VIEW_GLSL.includes("0 final, 1 albedo, 2 roughness, 3 height, 4 normal, 5 ao, 6 marks"), "documented codes");
  CHANNEL_VIEWS.forEach((v, i) => assert(channelViewCode(v) === i, v));
  assert(main.includes("if (cv == 2)") && main.includes("else if (cv == 6)"), "views switched in the shader");
});
