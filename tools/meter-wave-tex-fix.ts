// deno-lint-ignore-file no-explicit-any -- QA meter (Wave TEX closing, agent F), never game code.
// CPU meters on the GAME rig (PreviewScene.buildPreviewRig, the capture subjects of tools/capture-wave-tex.ts) for the
// closing round's four WARNs: edge highlight strength in the painted albedo, AO channel spread, mature scar relief.
//
//   deno run -A tools/meter-wave-tex-fix.ts [--json <out>]
//
// edge   per skin vertex sRGB luma (Rec.709) of the painted albedo; "convex" = top 10 % fine curvature kappa
//        (Miniature.fineCurvature) on skin outside the face/ears/nails (the passes skip those); reports the
//        convex-mean / all-skin median ratio and the brightest-5 % mean, preset vs the v1 paint (TEX_DEFAULTS.preset off).
// ao     aMaterial.z over the whole skin mesh: p5 / p50 / p95 / min, share of vertices < 0.9.
import { buildPreviewRig } from "../src/graphics/PreviewScene.ts";
import { raceBuild } from "../src/game/RaceAppearance.ts";
import { TEX_DEFAULTS } from "../src/graphics/shaders/TexWiring.ts";
import { fineCurvature } from "../src/graphics/paint/Miniature.ts";
import { vertexRings } from "../src/graphics/paint/FormShade.ts";
import { REGIONS } from "../src/graphics/body/contracts.ts";

const SUBJECTS = [["human", "male"], ["ork", "female"], ["elf", "female"], ["dwarf", "male"]] as const;
const toS = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);

function profileFor(race: string, sex: string): any {
  const BASE: any = { male: { h: 1.75, w: 72 }, female: { h: 1.65, w: 60 } };
  const b = raceBuild(race as any, null);
  const appearance: any = { body: "#4f8490", accent: "#dfaa55", height: +(BASE[sex].h * b.heightMul).toFixed(3), weight: +(BASE[sex].w * b.weightMul).toFixed(1), eyes: "#2f6fb5", sex };
  return { name: "TEX " + race + " " + sex, race, subrace: null, className: "Warrior", palette: "ember", birthsign: null, level: 1, allocated: {}, appearance };
}

function measure(race: string, sex: string) {
  const { rig } = buildPreviewRig(profileFor(race, sex));
  const g = (rig.skin as any).geometry;
  const P = g.getAttribute("position").array as Float32Array, N = g.getAttribute("normal").array as Float32Array;
  const col = g.getAttribute("color")?.array as Float32Array | undefined;
  const mat = g.getAttribute("aMaterial")?.array as Float32Array | undefined;
  const surf = g.getAttribute("aSurface").array as Float32Array;
  const region = g.userData.region as Uint8Array;
  const mesh: any = { positions: P, normals: N, indices: g.index.array, region };
  const adj = vertexRings(mesh);
  const cell = (rig as any).plan?.cell ?? 0.028;
  const kappa = fineCurvature(mesh, adj, cell);
  const n = P.length / 3;
  const skipped = new Set(["face", "ear", "nail"].map((r) => REGIONS.indexOf(r as any)));
  const L: number[] = [], K: number[] = [], idx: number[] = [];
  for (let i = 0; i < n; i++) {
    if (surf[i * 2] > 0.5 || skipped.has(region[i])) continue;
    const r = col ? toS(col[i * 3]) : 1, gg = col ? toS(col[i * 3 + 1]) : 1, b = col ? toS(col[i * 3 + 2]) : 1;
    L.push(255 * (0.2126 * r + 0.7152 * gg + 0.0722 * b)); K.push(kappa[i]); idx.push(i);
  }
  const kq = q(K, 0.9);
  const convex = L.filter((_, k) => K[k] >= kq), med = q(L, 0.5);
  const top5 = [...L].sort((a, b) => b - a).slice(0, Math.max(1, Math.floor(L.length * 0.05)));
  const ao: number[] = [];
  if (mat) for (let i = 0; i < n; i++) ao.push(mat[i * 4 + 2]);
  return {
    vertices: n, skinVerts: L.length, kappaP90: +kq.toFixed(3),
    edge: { convexMean: +mean(convex).toFixed(2), skinMedian: +med.toFixed(2), convexOverMedian: +(mean(convex) / med).toFixed(4), bright5: +mean(top5).toFixed(2) },
    ao: ao.length ? { min: +Math.min(...ao).toFixed(3), p5: +q(ao, 0.05).toFixed(3), p50: +q(ao, 0.5).toFixed(3), p95: +q(ao, 0.95).toFixed(3), below09: +(ao.filter((a) => a < 0.9).length / ao.length).toFixed(4) } : null,
  };
}

const out: any = {};
for (const [race, sex] of SUBJECTS) {
  const key = `${race}-${sex}`;
  TEX_DEFAULTS.preset = false;
  const v1 = measure(race, sex);
  TEX_DEFAULTS.preset = true;
  const pr = measure(race, sex);
  out[key] = { v1: v1.edge, preset: pr.edge, ao: pr.ao, kappaP90: pr.kappaP90 };
  console.log(key, JSON.stringify(out[key]));
}
const ji = Deno.args.indexOf("--json");
if (ji >= 0) Deno.writeTextFileSync(Deno.args[ji + 1], JSON.stringify(out, null, 1));
