// L's ring review of R (C-REND), independent checks against L's C-MAT. Run: deno run -A artifacts/wave-tex/reviews/l-review-R.ts
import { rng32 } from "../../../src/core/MathCore.ts";
import { generateBody } from "../../../src/graphics/body/BodyMesh.ts";
import { CHANNEL_SPECS, HEIGHT_RANGE_M, MATERIAL_LAYOUT } from "../../../src/graphics/paint/Channels.ts";
import { evaluateStack } from "../../../src/graphics/paint/Evaluate.ts";
import { stackFromV1 } from "../../../src/graphics/paint/LayerStack.ts";
import { stackFor } from "../../../src/graphics/paint/Recipes.ts";
import {
  boundTilt, coverage, DECAL_FLOATS, DECAL_KINDS, DECAL_MAX, DECAL_VEC4, type FragmentDecal, HEIGHT_LIMIT, MATERIAL_COMPONENTS,
  MATERIAL_NEUTRAL, MAX_TILT, packDecals, profileSdf,
} from "../../../src/graphics/shaders/MaterialChannels.ts";
import { isNeutralMaterial, neutralMaterial } from "../../../src/graphics/shaders/MaterialRender.ts";

const out: Record<string, unknown> = {};
const fail: string[] = [];
const check = (ok: boolean, m: string) => { if (!ok) fail.push(m); };

// 1. Contract agreement C-MAT <-> C-REND.
check(MATERIAL_COMPONENTS.join() === MATERIAL_LAYOUT.join(), "layout");
check(MATERIAL_LAYOUT.every((c, i) => CHANNEL_SPECS[c].neutral === MATERIAL_NEUTRAL[i]), "neutral values");
check(HEIGHT_LIMIT === HEIGHT_RANGE_M, "height limit");
// 2. L's evaluator on a v1-only stack gives exactly R's neutral array, and R calls it neutral.
const bodies = [["human", "male"], ["ork", "female"], ["elf", "female"], ["dwarf", "male"]] as const;
let neutralBodies = 0;
for (const [race, sex] of bodies) {
  const mesh = generateBody({ race, subrace: null, className: "Warrior", height: 1.7, weight: 75, seed: 3, sex }).mesh;
  const n = mesh.positions.length / 3;
  const r = evaluateStack(mesh, stackFromV1(stackFor({ race, seed: 5 })));
  const a = new Uint32Array(r.material.buffer), b = new Uint32Array(neutralMaterial(n).buffer);
  check(a.length === b.length && a.every((v, i) => v === b[i]), `${race} neutral bits`);
  check(isNeutralMaterial(r.material), `${race} isNeutral`);
  // A roughness-0.6 layer is NOT neutral (the dead zone does not swallow real edits).
  const s = stackFromV1(stackFor({ race, seed: 5 }));
  s.nodes.push({ kind: "layer", id: "r", name: "r", enabled: true, opacity: 1, source: { kind: "constant", value: 1 }, writes: [{ channel: "roughness", op: "replace", value: 0.51 }] });
  check(!isNeutralMaterial(evaluateStack(mesh, s).material), `${race} 0.51 roughness leaves the dead zone`);
  neutralBodies++;
}
out.neutralBodies = neutralBodies;
// 3. packDecals fuzz (2000 lists, hostile fields).
const r = rng32(42);
const E = [NaN, Infinity, -Infinity, 0, -1, 1e9, 1e-12];
const num = (scale: number) => (r() < 0.15 ? E[Math.floor(r() * E.length)] : (r() * 2 - 1) * scale);
const v3 = (): [number, number, number] => [num(1), num(1), num(1)];
let packed = 0, maxCount = 0, worstOrtho = 0, worstUnit = 0, badFinite = 0, badHeight = 0, badRadius = 0, badDrop = 0;
for (let k = 0; k < 2000; k++) {
  const len = Math.floor(r() * 40);
  const ds: FragmentDecal[] = [];
  for (let i = 0; i < len; i++) {
    ds.push({
      kind: r() < 0.05 ? ("nope" as FragmentDecal["kind"]) : DECAL_KINDS[Math.floor(r() * DECAL_KINDS.length)],
      center: v3(), normal: v3(), tangent: v3(), halfLength: num(0.05), halfWidth: num(0.01), blur: num(0.001),
      albedo: [num(1), num(1), num(1)], albedoOpacity: num(1), roughness: num(1), roughnessOpacity: num(1), height: num(0.02),
      emissive: num(1), glyph: num(20), count: num(10), spacing: num(0.01), wrapRadius: num(0.1), seed: num(100),
    } as FragmentDecal);
  }
  const p = packDecals(ds);
  packed++;
  maxCount = Math.max(maxCount, p.count);
  if (p.data.length !== DECAL_FLOATS || p.count + p.dropped.length !== len) badDrop++;
  for (let i = 0; i < p.data.length; i++) if (!Number.isFinite(p.data[i])) badFinite++;
  for (let d = 0; d < p.count; d++) {
    const o = d * DECAL_VEC4 * 4;
    const t = [p.data[o + 4], p.data[o + 5], p.data[o + 6]], n = [p.data[o + 8], p.data[o + 9], p.data[o + 10]];
    worstUnit = Math.max(worstUnit, Math.abs(Math.hypot(t[0], t[1], t[2]) - 1), Math.abs(Math.hypot(n[0], n[1], n[2]) - 1));
    worstOrtho = Math.max(worstOrtho, Math.abs(t[0] * n[0] + t[1] * n[1] + t[2] * n[2]));
    if (Math.abs(p.data[o + 22]) > Math.fround(HEIGHT_LIMIT)) badHeight++;
    if (!(p.data[o + 3] > 0)) badRadius++;
  }
}
check(maxCount <= DECAL_MAX && badFinite === 0 && badHeight === 0 && badRadius === 0 && badDrop === 0 && worstUnit < 1e-6 && worstOrtho < 1e-6, "packDecals");
const valid: FragmentDecal[] = Array.from({ length: 40 }, (_, i) => ({ kind: DECAL_KINDS[i % 6], center: [0, 1, 0.1], normal: [0, 0, 1], tangent: [1, 0.2, 0.3], halfLength: 0.02, halfWidth: 0.002, albedo: [0.2, 0.1, 0.1], height: 0.001 } as FragmentDecal));
const pv = packDecals(valid);
check(pv.count === DECAL_MAX && pv.dropped.join() === Array.from({ length: 24 }, (_, i) => i + 16).join(), "budget drops in order");
out.packDecals = { lists: packed, maxCount, badFinite, badHeight, badRadius, badDrop, worstUnit, worstOrtho, valid40: { count: pv.count, dropped: pv.dropped.length } };
// 4. boundTilt: angle <= MAX_TILT, unit, identity inside the cone; lambert change <= 2 sin(MAX_TILT/2) < band gap 0.38.
const unit = () => { for (;;) { const v = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]; const l = Math.hypot(v[0], v[1], v[2]); if (l > 0.1 && l <= 1) return [v[0] / l, v[1] / l, v[2] / l] as [number, number, number]; } };
let worstAngle = 0, worstLen = 0, worstLam = 0, idBreak = 0;
for (let k = 0; k < 20000; k++) {
  const n = unit(), nb = k % 50 === 0 ? [-n[0], -n[1], -n[2]] as [number, number, number] : unit(), l = unit();
  const t = boundTilt(n, nb);
  const c = Math.min(1, t[0] * n[0] + t[1] * n[1] + t[2] * n[2]);
  worstAngle = Math.max(worstAngle, Math.acos(c));
  worstLen = Math.max(worstLen, Math.abs(Math.hypot(t[0], t[1], t[2]) - 1));
  worstLam = Math.max(worstLam, Math.abs((t[0] - n[0]) * l[0] + (t[1] - n[1]) * l[1] + (t[2] - n[2]) * l[2]));
  if (n[0] * nb[0] + n[1] * nb[1] + n[2] * nb[2] >= Math.cos(MAX_TILT) && (t[0] !== nb[0] || t[1] !== nb[1] || t[2] !== nb[2])) idBreak++;
}
check(worstAngle <= MAX_TILT + 1e-7 && worstLen < 1e-12 && worstLam <= 2 * Math.sin(MAX_TILT / 2) + 1e-12 && idBreak === 0 && worstLam < 0.38, "boundTilt");
out.boundTilt = { cases: 20000, worstAngle, bound: MAX_TILT, worstLen, worstLambert: worstLam, chordBound: 2 * Math.sin(MAX_TILT / 2), idBreak };
// 5. coverage law: in [0,1], 1 deep inside, 0 far outside, non-increasing in s, 0.5 at s = 0.
let covBad = 0;
for (let k = 0; k < 20000; k++) {
  const px = r() * 0.002, blur = r() * 0.002, s1 = (r() * 2 - 1) * 0.01, s2 = s1 + r() * 0.002;
  const c1 = coverage(s1, px, blur), c2 = coverage(s2, px, blur);
  if (!(c1 >= 0 && c1 <= 1) || c2 > c1 + 1e-15 || Math.abs(coverage(0, px, blur) - 0.5) > 1e-12) covBad++;
}
check(covBad === 0, "coverage");
// 6. profileSdf: spindle inside at centre, outside beyond the tips, disc exact on its rim.
let sdfBad = 0;
for (let k = 0; k < 5000; k++) {
  const L = 0.001 + r() * 0.05, W = 0.0005 + r() * 0.005;
  if (!(profileSdf("line", 0, 0, L, W) < 0) || !(profileSdf("line", L * 1.01 + 1e-6, 0, L, W) > 0) || !(profileSdf("line", 0, W * 1.01 + 1e-6, L, W) > 0)) sdfBad++;
  const a = r() * 2 * Math.PI;
  if (Math.abs(profileSdf("disc", L * Math.cos(a), W * Math.sin(a), L, W)) > 1e-12) sdfBad++;
}
check(sdfBad === 0, "profileSdf");
out.coverageBad = covBad; out.sdfBad = sdfBad;
out.fail = fail;
await Deno.writeTextFile(new URL("./l-review-R.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
