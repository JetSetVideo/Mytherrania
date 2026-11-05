// QA (wave TEX closing): AO per skin vertex vs fine curvature class, bind pose. Own meter.
import { buildPreviewRig } from "/Users/macmax/Desktop/Mytherrania/src/graphics/PreviewScene.ts";
import { raceBuild } from "/Users/macmax/Desktop/Mytherrania/src/game/RaceAppearance.ts";
import { fineCurvature } from "/Users/macmax/Desktop/Mytherrania/src/graphics/paint/Miniature.ts";
import { vertexRings } from "/Users/macmax/Desktop/Mytherrania/src/graphics/paint/FormShade.ts";
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
for (const [race, sex] of [["human", "male"], ["ork", "female"], ["elf", "female"], ["dwarf", "male"]]) {
  const BASE: any = { male: { h: 1.75, w: 72 }, female: { h: 1.65, w: 60 } };
  const b = raceBuild(race as any, null);
  const appearance: any = { body: "", accent: "#dfaa55", height: +(BASE[sex].h * b.heightMul).toFixed(3), weight: +(BASE[sex].w * b.weightMul).toFixed(1), eyes: "#2f6fb5", sex };
  const { rig } = buildPreviewRig({ name: "TEX " + race + " " + sex, race, subrace: null, className: "Warrior", palette: "ember", birthsign: null, level: 1, allocated: {}, appearance } as any);
  const g = (rig.skin as any).geometry;
  const P = g.getAttribute("position").array, N = g.getAttribute("normal").array, S = g.getAttribute("aSurface").array, M = g.getAttribute("aMaterial").array;
  const mesh: any = { positions: P, normals: N, indices: g.index.array, region: g.userData.region };
  const k = fineCurvature(mesh, vertexRings(mesh), (rig as any).plan?.cell ?? 0.028);
  const K: number[] = [], A: number[] = [];
  for (let i = 0; i < P.length / 3; i++) if (S[i * 2] < 0.5) { K.push(k[i]); A.push(M[i * 4 + 2]); }
  const hi = q(K, 0.9), lo = q(K, 0.1);
  const conv = A.filter((_, i) => K[i] >= hi), conc = A.filter((_, i) => K[i] <= lo);
  // where is the darkest AO? share of the 5 % darkest-AO vertices that are convex (top 25 % kappa)
  const a5 = q(A, 0.05), k75 = q(K, 0.75), k25 = q(K, 0.25);
  const dark = A.map((a, i) => [a, K[i]]).filter(([a]) => a <= a5);
  console.log(race, sex, JSON.stringify({ skinV: A.length, aoMean: +mean(A).toFixed(3), aoP5: +a5.toFixed(3), convexMean: +mean(conv).toFixed(3), convexP5: +q(conv, 0.05).toFixed(3), concaveMean: +mean(conc).toFixed(3), concaveP5: +q(conc, 0.05).toFixed(3), darkest5Convex25: +(dark.filter(([, kk]) => kk >= k75).length / dark.length).toFixed(3), darkest5Concave25: +(dark.filter(([, kk]) => kk <= k25).length / dark.length).toFixed(3) }));
}
