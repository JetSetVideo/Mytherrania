// Wave V lane B: paint that follows the forms (src/graphics/paint/FormShade.ts, applied by
// SkinnedHumanoid.paintSkin). Grooves darker, bony points / worn cloth paler — measured:
// more painted gradient energy on the limbs, no "noise mush" (cel-band-sized jumps inside a region stay
// rare), deterministic, bounded, and hair/nails/soles untouched.
import { generateBody } from "../src/graphics/body/BodyMesh.ts";
import { paintSkin } from "../src/graphics/body/SkinnedHumanoid.ts";
import { REGIONS, type BodySpec, type MeshData } from "../src/graphics/body/contracts.ts";
import { applyFormShade, CAVITY_DARK, FORM_SKIP, formTerms, meanCurvature, vertexRings } from "../src/graphics/paint/FormShade.ts";
import { GARMENT_REGIONS } from "../src/graphics/paint/Recipes.ts";
import type { Appearance } from "../src/game/Characters.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const SPEC: BodySpec = { race: "human", subrace: null, className: "Warrior", height: 1.76, weight: 76, seed: 7, sex: "male" };
const APP: Appearance = { body: "#4f6f8a", accent: "#dfaa55", height: 1.76, weight: 76, hair: "#3a2a1e", eyes: "#2f6fb5", race: "human", subrace: null };
const body = generateBody(SPEC);
const toS = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const lum = (rgb: Float32Array, i: number) => 0.2126 * toS(rgb[i * 3]) + 0.7152 * toS(rgb[i * 3 + 1]) + 0.0722 * toS(rgb[i * 3 + 2]);

/** RMS luminance gradient (1/m) and the share of cel-band-sized jumps (> 0.08) on region-interior edges. */
function texture(mesh: MeshData, rgb: Float32Array, regions: string[]): { grad: number; mush: number } {
  const adj = vertexRings(mesh), P = mesh.positions, ids = new Set(regions.map((r) => REGIONS.indexOf(r as typeof REGIONS[number])));
  let g2 = 0, n = 0, jumps = 0;
  for (let i = 0; i < adj.length; i++) {
    if (!ids.has(mesh.region[i]) || !Array.from(adj[i]).every((j) => mesh.region[j] === mesh.region[i])) continue;
    for (const j of adj[i]) {
      if (j < i || !Array.from(adj[j]).every((k) => mesh.region[k] === mesh.region[j])) continue;
      const L = Math.hypot(P[i * 3] - P[j * 3], P[i * 3 + 1] - P[j * 3 + 1], P[i * 3 + 2] - P[j * 3 + 2]) || 1e-6;
      const dy = lum(rgb, i) - lum(rgb, j);
      g2 += (dy / L) ** 2; n++;
      if (Math.abs(dy) > 0.08) jumps++;
    }
  }
  return { grad: Math.sqrt(g2 / Math.max(1, n)), mush: jumps / Math.max(1, n) };
}

Deno.test("form paint: a sphere is all convex (no cavity); a body has grooves, and the cavity follows negative curvature", () => {
  const H = meanCurvature(body.mesh);
  const t = formTerms(body.mesh, { cell: body.plan.cell });
  let cavNeg = 0, nNeg = 0, cavPos = 0, nPos = 0;
  for (let i = 0; i < H.length; i++) { if (H[i] < 0) { cavNeg += t.cavity[i]; nNeg++; } else { cavPos += t.cavity[i]; nPos++; } }
  assert(nNeg > 0.03 * H.length, `only ${nNeg} concave vertices`);
  assert(cavPos === 0 && cavNeg / nNeg > 0.05, `cavity on convex ${cavPos}, mean on concave ${(cavNeg / nNeg).toFixed(3)}`);
  // A polygonised sphere's own body (the head-free torso is not a sphere, so use the math): H of a sphere = 1/r.
  const r = 0.2, n = 24, pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j < 2 * n; j++) {
    const th = Math.PI * i / n, ph = Math.PI * j / n, x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
    pos.push(r * x, r * y, r * z); nor.push(x, y, z);
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < 2 * n; j++) {
    const a = i * 2 * n + j, b = i * 2 * n + (j + 1) % (2 * n), c = a + 2 * n, d = b + 2 * n;
    idx.push(a, c, b, b, c, d);
  }
  const sphere: MeshData = { positions: Float32Array.from(pos), normals: Float32Array.from(nor), indices: Uint32Array.from(idx), region: new Uint8Array(pos.length / 3) };
  const Hs = meanCurvature(sphere);
  const mid = Hs[(n / 2) * 2 * n];
  assert(Math.abs(mid * r - 1) < 0.05, `sphere H·r = ${(mid * r).toFixed(3)} (want 1)`);
  assert(formTerms(sphere, { cell: 0.025 }).cavity.every((x) => x === 0), "a sphere has no cavity");
});

Deno.test("form paint: bounded, deterministic, strength 0 is the identity, skipped regions untouched", () => {
  const base = paintSkin(body.mesh, SPEC, APP, body.plan.cell, APP.body, false);
  const a = paintSkin(body.mesh, SPEC, APP, body.plan.cell);
  const b = paintSkin(body.mesh, SPEC, APP, body.plan.cell);
  assert(a.every((v, i) => v === b[i]), "deterministic");
  assert(a.every((v) => v >= 0 && v <= 1), "inside 0..1");
  const id = applyFormShade(body.mesh, base.slice(), { cell: body.plan.cell, garment: GARMENT_REGIONS, strength: 0 });
  assert(id.every((v, i) => v === base[i]), "strength 0 = identity");
  const skip = new Set(FORM_SKIP.map((r) => REGIONS.indexOf(r as typeof REGIONS[number])));
  let maxDark = 0;
  for (let i = 0; i < a.length / 3; i++) {
    if (skip.has(body.mesh.region[i])) { for (let k = 0; k < 3; k++) assert(a[i * 3 + k] === base[i * 3 + k], `${REGIONS[body.mesh.region[i]]} vertex repainted`); continue; }
    maxDark = Math.max(maxDark, 1 - lum(a, i) / Math.max(1e-6, lum(base, i)));
  }
  // The seeded trunk gains (Improvise "paint" knobs) are bounded by 1.5, so no vertex darkens beyond that.
  assert(maxDark <= 1.5 * CAVITY_DARK + 1e-6, `darkest change ${maxDark.toFixed(3)}`);
});

Deno.test("form paint: more painted detail on the limbs (gradient energy up), no noise mush (band-sized jumps stay rare)", () => {
  const before = paintSkin(body.mesh, SPEC, APP, body.plan.cell, APP.body, false);
  const after = paintSkin(body.mesh, SPEC, APP, body.plan.cell);
  // Gain floors per region family, measured: the arms and the (garment-covered) trunk roughly double;
  // the legs gain least — the thigh is cloth with few grooves and the shin is one long smooth form.
  for (const [regs, gain] of [[["upperArm", "foreArm"], 1.5], [["thigh", "shin"], 1.1], [["torso", "pelvis"], 1.5]] as [string[], number][]) {
    const t0 = texture(body.mesh, before, regs), t1 = texture(body.mesh, after, regs);
    console.log(`  ${regs.join("+")}: rms gradient ${t0.grad.toFixed(2)} -> ${t1.grad.toFixed(2)} /m, band jumps ${(100 * t0.mush).toFixed(2)} % -> ${(100 * t1.mush).toFixed(2)} %`);
    assert(t1.grad > gain * t0.grad, `${regs}: gradient ${t0.grad.toFixed(2)} -> ${t1.grad.toFixed(2)} (want x${gain})`);
    assert(t1.mush <= t0.mush + 0.01, `${regs}: band-sized jumps ${(100 * t0.mush).toFixed(2)} % -> ${(100 * t1.mush).toFixed(2)} %`);
  }
});
