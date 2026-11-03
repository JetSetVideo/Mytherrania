// Wave GEN lane Q1: independent GEOMETRIC verifier of the character generator (pure Deno, no THREE).
//
// For 4 races x 2 sexes (x stat profiles min/reference/max once BodySpec.stats exists) it builds the body
// TWICE and measures, with its own code (only the builders' public entry points are called):
//   topology    boundary / non-manifold edges, components, winding conflicts (own edge maps, not MeshStats)
//   degenerate  triangles with area < 1e-10 m² or a min edge < 1e-6 m; min triangle quality (2√3·A / Σe²·... )
//   symmetry    mirror-vertex search (x -> -x) on the rendered skin AND on the physics field's mesh
//   skin        weight sum deviation, negative / NaN weights, influences per vertex
//   budget      body triangles (< 12 000 whole rig budget, tests/ancestry_look_test.ts)
//   hitboxes    coverage of the rendered skin's vertices (bind frames from bindBoneMatrix) and air overshoot
//   determinism SHA-256 of positions+indices+skin+hitboxes, two builds
//   pipeline    (when src/graphics/body/Pipeline.ts exists) stage list, cageViolationMm re-measured from the
//               cage and the inflate plan's primitives, morph identity (stats = reference vs none), monotonicity
//
// Usage:
//   deno run -A tools/verify-wave-gen-geo.ts run <label> [--races human,ork] [--sexes male] [--no-stats]
//   deno run -A tools/verify-wave-gen-geo.ts verdict <lane> <claim> <method> <PASS|FAIL|INFO> <boardId> <result...>
//   deno run -A tools/verify-wave-gen-geo.ts doc          # writes docs/wave-gen/VERIFY-GEO.md from the JSON
// Output: artifacts/wave-gen/verify-geo/<label>.json (+ ledger.json for verdicts).

import { generateBody } from "../src/graphics/body/BodyMesh.ts";
import { bodyField } from "../src/graphics/body/BodyMesh.ts";
import { polygonizeField } from "../src/graphics/body/Polygonize.ts";
import { computeSkinWeights, MAX_INFLUENCES, shoulderBands } from "../src/graphics/body/SkinWeights.ts";
import { bindBoneMatrix, CONTACT_SLACK, hitboxDistance, hitboxesFromPlan } from "../src/combat/Hitboxes.ts";
import type { BodySpec, Bounds, MeshData, SdfNode, SkinData } from "../src/graphics/body/contracts.ts";
import { compileSdf } from "../src/graphics/body/Sdf.ts";
import { applyFieldBrushes } from "../src/graphics/body/Brushes.ts";
import type { HitboxSet } from "../src/combat/contracts.ts";
import type { DetailedAnatomy } from "../src/graphics/body/Anatomy.ts";

const OUT = "artifacts/wave-gen/verify-geo";
const LEDGER = `${OUT}/ledger.json`;
const DOC = "docs/wave-gen/VERIFY-GEO.md";

export const RACE_SPECS: Record<string, { subrace: string; height: number; weight: number }> = {
  human: { subrace: "imperial", height: 1.75, weight: 75 },
  elf: { subrace: "high", height: 1.85, weight: 66 },
  dwarf: { subrace: "mountain", height: 1.38, weight: 82 },
  ork: { subrace: "ironhide", height: 1.95, weight: 118 },
};
export const SEXES = ["male", "female"] as const;
const TRI_BUDGET = 12000;
const DEGEN_AREA = 1e-10, DEGEN_EDGE = 1e-6;

type Stats = { strength: number; agility: number; intelligence: number; level: number };
type Loose = Record<string, unknown>;

// ---------- small helpers ----------
async function sha(...bufs: ArrayBufferView[]): Promise<string> {
  let n = 0;
  for (const b of bufs) n += b.byteLength;
  const all = new Uint8Array(n);
  let o = 0;
  for (const b of bufs) { all.set(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), o); o += b.byteLength; }
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", all));
  return Array.from(h.slice(0, 12), (x) => x.toString(16).padStart(2, "0")).join("");
}
const r = (x: number, d = 4) => Number.isFinite(x) ? Number(x.toFixed(d)) : x;
function quantile(a: number[], q: number): number {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
}

// ---------- topology (own implementation) ----------
export function topology(mesh: MeshData) {
  const n = mesh.positions.length / 3, idx = mesh.indices;
  const uses = new Map<number, number>(), dir = new Map<number, number>();
  for (let t = 0; t < idx.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e], b = idx[t + (e + 1) % 3];
      const k = a < b ? a * n + b : b * n + a;
      uses.set(k, (uses.get(k) ?? 0) + 1);
      const dk = a * n + b;
      dir.set(dk, (dir.get(dk) ?? 0) + 1);
    }
  }
  let boundary = 0, nonManifold = 0, winding = 0;
  for (const c of uses.values()) { if (c === 1) boundary++; else if (c > 2) nonManifold++; }
  for (const c of dir.values()) if (c > 1) winding++;
  // components by union-find over triangle vertices
  const p = new Int32Array(n);
  for (let i = 0; i < n; i++) p[i] = i;
  const f = (a: number) => { while (p[a] !== a) { p[a] = p[p[a]]; a = p[a]; } return a; };
  const used = new Uint8Array(n);
  for (let t = 0; t < idx.length; t += 3) {
    used[idx[t]] = used[idx[t + 1]] = used[idx[t + 2]] = 1;
    const a = f(idx[t]), b = f(idx[t + 1]), c = f(idx[t + 2]);
    p[b] = a; p[f(c)] = f(a);
  }
  const roots = new Set<number>();
  for (let i = 0; i < n; i++) if (used[i]) roots.add(f(i));
  // Euler characteristic: V - E + F (2 for a sphere-like closed surface per component)
  let usedV = 0;
  for (let i = 0; i < n; i++) usedV += used[i];
  const euler = usedV - uses.size + idx.length / 3;
  // degenerate triangles + quality
  const P = mesh.positions;
  let degenerate = 0, minQ = Infinity, minArea = Infinity;
  for (let t = 0; t < idx.length; t += 3) {
    const a = 3 * idx[t], b = 3 * idx[t + 1], c = 3 * idx[t + 2];
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const area = 0.5 * Math.hypot(cx, cy, cz);
    const e1 = ux * ux + uy * uy + uz * uz, e2 = vx * vx + vy * vy + vz * vz;
    const e3 = (P[c] - P[b]) ** 2 + (P[c + 1] - P[b + 1]) ** 2 + (P[c + 2] - P[b + 2]) ** 2;
    const q = (4 * Math.sqrt(3) * area) / (e1 + e2 + e3 || 1); // 1 = equilateral
    if (area < DEGEN_AREA || Math.sqrt(Math.min(e1, e2, e3)) < DEGEN_EDGE) degenerate++;
    if (q < minQ) minQ = q;
    if (area < minArea) minArea = area;
  }
  let nanPos = 0;
  for (let i = 0; i < P.length; i++) if (!Number.isFinite(P[i])) nanPos++;
  return {
    vertices: n, triangles: idx.length / 3, boundaryEdges: boundary, nonManifoldEdges: nonManifold,
    windingConflicts: winding, components: roots.size, euler, degenerate, minTriQuality: r(minQ, 5), minAreaMm2: r(minArea * 1e6, 6), nanPositions: nanPos,
  };
}

// ---------- L/R symmetry: nearest vertex to the mirrored position (spatial hash) ----------
export function symmetry(mesh: MeshData, cell: number, axis = 0) {
  const P = mesh.positions, n = P.length / 3, h = cell * 2;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / h)},${Math.floor(y / h)},${Math.floor(z / h)}`;
  for (let i = 0; i < n; i++) {
    const k = key(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  }
  const ds: number[] = [];
  for (let i = 0; i < n; i++) {
    const m = [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
    m[axis] = -m[axis];
    const gx = Math.floor(m[0] / h), gy = Math.floor(m[1] / h), gz = Math.floor(m[2] / h);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of grid.get(`${gx + dx},${gy + dy},${gz + dz}`) ?? []) {
        const d = Math.hypot(P[3 * j] - m[0], P[3 * j + 1] - m[1], P[3 * j + 2] - m[2]);
        if (d < best) best = d;
      }
    }
    ds.push(Number.isFinite(best) ? best : h * 1.5);
  }
  const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
  return { meanMm: r(mean * 1000, 2), p95Mm: r(quantile(ds, 0.95) * 1000, 2), maxMm: r(Math.max(...ds) * 1000, 2), cellMm: r(cell * 1000, 2) };
}

// ---------- skin weights ----------
export function skinCheck(skin: SkinData, vertices: number, bones: number) {
  const k = skin.skinWeight.length / vertices;
  let maxDev = 0, neg = 0, nan = 0, badIdx = 0, maxInf = 0;
  for (let v = 0; v < vertices; v++) {
    let s = 0, inf = 0;
    for (let j = 0; j < k; j++) {
      const w = skin.skinWeight[v * k + j];
      if (!Number.isFinite(w)) nan++;
      if (w < 0) neg++;
      if (w > 0) { inf++; if (skin.skinIndex[v * k + j] >= bones) badIdx++; }
      s += w;
    }
    maxDev = Math.max(maxDev, Math.abs(s - 1));
    maxInf = Math.max(maxInf, inf);
  }
  return { influencesSlot: k, maxSumDeviation: Number(maxDev.toExponential(2)), negative: neg, nan, badBoneIndex: badIdx, maxInfluences: maxInf };
}

// ---------- hitboxes: coverage of the RENDERED skin + air overshoot ----------
function placeBind(set: HitboxSet, plan: DetailedAnatomy) {
  const cache = new Map<string, Float64Array>();
  for (const b of set.boxes) {
    const m = cache.get(b.bone) ?? cache.set(b.bone, bindBoneMatrix(plan, b.bone as never)).get(b.bone)!;
    for (const [src, dst] of [[b.a, b.wa], [b.b, b.wb]] as const) {
      dst[0] = m[0] * src[0] + m[4] * src[1] + m[8] * src[2] + m[12];
      dst[1] = m[1] * src[0] + m[5] * src[1] + m[9] * src[2] + m[13];
      dst[2] = m[2] * src[0] + m[6] * src[1] + m[10] * src[2] + m[14];
    }
  }
}
export function hitboxCheck(set: HitboxSet, plan: DetailedAnatomy, mesh: MeshData) {
  placeBind(set, plan);
  const P = mesh.positions, n = P.length / 3;
  let ok = 0, worst = 0;
  const miss: number[] = [];
  for (let i = 0; i < n; i++) {
    let d = Infinity;
    for (const b of set.boxes) { const x = hitboxDistance(b, P[3 * i], P[3 * i + 1], P[3 * i + 2]); if (x < d) d = x; }
    if (d <= CONTACT_SLACK) ok++; else { worst = Math.max(worst, d); miss.push(d); }
  }
  // Capsules are fitted to hitRoot ?? root (P, Z-10): measure air against the same tree and box.
  const hp = plan as DetailedAnatomy & { hitRoot?: SdfNode; hitBounds?: Bounds };
  const field = hp.hitRoot ? applyFieldBrushes(compileSdf(hp.hitRoot), plan.strokes) : bodyField(plan);
  const s = { d: 0, region: 0, bone: 0 }, h = 0.015, B = hp.hitBounds ?? plan.bounds;
  let inBody = 0, air = 0;
  for (let x = B.min[0]; x < B.max[0]; x += h) for (let y = 0; y < B.max[1]; y += h) for (let z = B.min[2]; z < B.max[2]; z += h) {
    if (field.sample(x, y, z, s).d < 0) { inBody++; continue; }
    for (const b of set.boxes) if (hitboxDistance(b, x, y, z) < 0) { air++; break; }
  }
  let nonFinite = 0;
  for (const b of set.boxes) for (const v of [...b.wa, ...b.wb, b.radius]) if (!Number.isFinite(v)) nonFinite++;
  return {
    capsules: set.boxes.length, coveragePct: r((100 * ok) / n, 2), worstMissMm: r(worst * 1000, 1),
    p95MissMm: r(quantile(miss, 0.95) * 1000, 1), overshootPct: r((100 * air) / inBody, 2), mass: r(set.mass, 2), nonFinite,
  };
}

// ---------- optional pipeline (lane P) ----------
async function tryImport(path: string): Promise<Loose | null> {
  try { return await import(new URL(path, import.meta.url).href) as Loose; } catch (e) {
    if (String(e).includes("Module not found") || String(e).includes("NotFound")) return null;
    throw e;
  }
}

// Cage containment re-measured: every positive primitive's AABB (centre ± its own extents, coarse) vs its part cage.
// Only reported when the cage exposes parts; the builder's own cageViolationMm metric is reported beside it.
function stageMetrics(staged: Loose): Loose {
  const stages = (staged.stages as { id: string; ms: number; metrics: Record<string, number>; warnings: string[] }[] | undefined) ?? [];
  const out: Loose = { stageIds: stages.map((s) => s.id).join(">") };
  for (const s of stages) {
    out[`${s.id}.ms`] = r(s.ms, 1);
    for (const [k, v] of Object.entries(s.metrics ?? {})) out[`${s.id}.${k}`] = typeof v === "number" ? r(v, 4) : v;
    if (s.warnings?.length) out[`${s.id}.warnings`] = s.warnings.length;
  }
  return out;
}

/** Field of a plan's skin tree (skinRoot ?? root) with its strokes: the inflate view's own surface. */
function bodyFieldOfSkin(plan: DetailedAnatomy) {
  return applyFieldBrushes(compileSdf((plan as Partial<DetailedAnatomy>).skinRoot ?? plan.root), plan.strokes);
}

/**
 * Independent cage containment: every vertex must lie inside the UNION of the part boxes
 * (centre - neg .. centre + pos). Reports the share outside and the worst distance outside (mm).
 * Tolerance: half a polygoniser cell (the surface is only located to ~cell/2 by Surface Nets).
 */
export function cageVertexCheck(parts: Record<string, { centre: number[]; neg: number[]; pos: number[] }>, mesh: MeshData, cell: number) {
  const P = mesh.positions, n = P.length / 3, boxes = Object.values(parts);
  let outside = 0, worst = 0;
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    for (const b of boxes) {
      let d2 = 0;
      for (let k = 0; k < 3; k++) {
        const v = P[3 * i + k], lo = b.centre[k] - b.neg[k], hi = b.centre[k] + b.pos[k];
        const e = v < lo ? lo - v : v > hi ? v - hi : 0;
        d2 += e * e;
      }
      if (d2 < best) best = d2;
    }
    const d = Math.sqrt(best);
    if (d > cell / 2) { outside++; if (d > worst) worst = d; }
  }
  return { parts: boxes.length, outsidePct: r((100 * outside) / n, 3), worstOutsideMm: r(worst * 1000, 1), toleranceMm: r(cell * 500, 1) };
}

// ---------- one body ----------
interface BuildOut { spec: BodySpec; plan: DetailedAnatomy; mesh: MeshData; skin: SkinData; hitboxes: HitboxSet; staged?: Loose; ms: number }
function build(spec: BodySpec, pipe: Loose | null): BuildOut {
  const t0 = performance.now();
  if (pipe && typeof pipe.generateStaged === "function") {
    const st = (pipe.generateStaged as (s: BodySpec, o: Loose) => Loose)(spec, { weights: true, hitboxes: true });
    const plan = (st.carved ?? st.plan) as DetailedAnatomy, mesh = st.mesh as MeshData;
    // Fallbacks = the game's own calls (SkinnedHumanoid.cachedBody / Engine) when the stage omits them.
    const skin = (st.skin as SkinData | undefined) ??
      computeSkinWeights(mesh, plan.bones, MAX_INFLUENCES, { rootBands: shoulderBands(plan.proportions.radius.deltoid, plan.cell) });
    const hitboxes = (st.hitboxes as HitboxSet | undefined) ?? hitboxesFromPlan(plan, { mass: spec.weight });
    return { spec, plan, mesh, skin, hitboxes, staged: st, ms: performance.now() - t0 };
  }
  const body = generateBody(spec);
  const skin = computeSkinWeights(body.mesh, body.plan.bones, MAX_INFLUENCES, { rootBands: shoulderBands(body.plan.proportions.radius.deltoid, body.plan.cell) });
  const hitboxes = hitboxesFromPlan(body.plan, { mass: spec.weight });
  return { spec, plan: body.plan, mesh: body.mesh, skin, hitboxes, ms: performance.now() - t0 };
}
async function hashOf(b: BuildOut): Promise<string> {
  const hb = new Float64Array(b.hitboxes.boxes.flatMap((x) => [...x.a, ...x.b, x.radius]));
  return await sha(b.mesh.positions, b.mesh.indices, b.skin.skinIndex, b.skin.skinWeight, hb);
}

async function measure(spec: BodySpec, pipe: Loose | null, profile: string) {
  const a = build(spec, pipe);
  const b = build(structuredClone(spec), pipe);
  const ha = await hashOf(a), hb = await hashOf(b);
  const physMesh = polygonizeField(bodyField(a.plan), a.plan.bounds, a.plan.cell);
  const row: Loose = {
    race: spec.race, sex: spec.sex, profile, buildMs: r(a.ms, 0), cellMm: r(a.plan.cell * 1000, 2),
    topology: topology(a.mesh),
    symmetrySkin: symmetry(a.mesh, a.plan.cell),
    symmetryPhysics: symmetry(physMesh, a.plan.cell),
    skin: skinCheck(a.skin, a.mesh.positions.length / 3, a.plan.bones.length),
    hitboxes: hitboxCheck(a.hitboxes, a.plan, a.mesh),
    hash: ha, deterministic: ha === hb,
  };
  if (a.staged) {
    row.stages = stageMetrics(a.staged);
    const cage = a.staged.cage as { parts?: Record<string, { centre: number[]; neg: number[]; pos: number[] }> } | undefined;
    if (cage?.parts) row.cageQ1 = cageVertexCheck(cage.parts, a.mesh, a.plan.cell);
    const inflate = a.staged.plan as DetailedAnatomy | undefined;
    if (cage?.parts && inflate) row.cageQ1Inflate = cageVertexCheck(cage.parts, polygonizeField(bodyFieldOfSkin(inflate), (inflate as Partial<DetailedAnatomy>).skinBounds ?? inflate.bounds, inflate.cell), inflate.cell);
  }
  return { row, hash: ha, build: a };
}

// ---------- verdicts on a row ----------
export function rowFails(row: Loose): string[] {
  const t = row.topology as Loose, s = row.skin as Loose, h = row.hitboxes as Loose, f: string[] = [];
  if (t.boundaryEdges !== 0) f.push(`boundaryEdges=${t.boundaryEdges}`);
  if (t.nonManifoldEdges !== 0) f.push(`nonManifold=${t.nonManifoldEdges}`);
  if (t.components !== 1) f.push(`components=${t.components}`);
  if (t.windingConflicts !== 0) f.push(`winding=${t.windingConflicts}`);
  if (t.degenerate !== 0) f.push(`degenerate=${t.degenerate}`);
  if (t.nanPositions !== 0) f.push(`nanPos=${t.nanPositions}`);
  if ((t.triangles as number) >= TRI_BUDGET) f.push(`tris=${t.triangles}>=${TRI_BUDGET}`);
  if ((s.maxSumDeviation as number) > 1e-4 || s.negative || s.nan || s.badBoneIndex) f.push(`skin dev=${s.maxSumDeviation} neg=${s.negative} nan=${s.nan} bad=${s.badBoneIndex}`);
  if ((h.coveragePct as number) < 95) f.push(`coverage=${h.coveragePct}%<95`);
  // Overshoot: HEAD itself reads 21.5-35.2 % on these bodies (baseline.json), so the absolute 25 % band of
  // tests/combat_hitboxes_test.ts (human 72 kg / ork only) is not a contract here; regressions() gates it vs baseline.
  if ((h.overshootPct as number) >= 40) f.push(`overshoot=${h.overshootPct}%>=40`);
  if (h.nonFinite) f.push(`hitbox nonFinite=${h.nonFinite}`);
  if (!row.deterministic) f.push("nondeterministic");
  const st = row.stages as Loose | undefined;
  if (st) for (const [k, v] of Object.entries(st)) if (k.endsWith("cageViolationMm") && typeof v === "number" && v > 0) f.push(`${k}=${v}`);
  return f;
}

/** Regressions of a row against the HEAD baseline row of the same race/sex (profile none or reference). */
export function regressions(row: Loose, base: Loose | undefined): string[] {
  if (!base) return [];
  const f: string[] = [];
  const t = row.topology as Loose, bt = base.topology as Loose, h = row.hitboxes as Loose, bh = base.hitboxes as Loose;
  const sp = row.symmetryPhysics as Loose, bsp = base.symmetryPhysics as Loose, ss = row.symmetrySkin as Loose, bss = base.symmetrySkin as Loose;
  if ((t.components as number) > (bt.components as number)) f.push(`components ${bt.components}->${t.components}`);
  if ((h.overshootPct as number) > (bh.overshootPct as number) + 2) f.push(`overshoot ${bh.overshootPct}->${h.overshootPct}% (>+2pp)`);
  if ((h.coveragePct as number) < (bh.coveragePct as number) - 1) f.push(`coverage ${bh.coveragePct}->${h.coveragePct}% (<-1pp)`);
  if ((sp.p95Mm as number) > (bsp.p95Mm as number) + 1) f.push(`physics sym p95 ${bsp.p95Mm}->${sp.p95Mm} mm (>+1)`);
  if ((ss.p95Mm as number) > (bss.p95Mm as number) + 3) f.push(`skin sym p95 ${bss.p95Mm}->${ss.p95Mm} mm (>+3)`);
  return f;
}

// ---------- main: run ----------
async function run(label: string, args: string[]) {
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const races = (opt("--races") ?? Object.keys(RACE_SPECS).join(",")).split(",");
  const sexes = (opt("--sexes") ?? SEXES.join(",")).split(",") as ("male" | "female")[];
  const pipe = await tryImport("../src/graphics/body/Pipeline.ts");
  const scale = args.includes("--no-stats") ? null : await tryImport("../src/game/StatScale.ts");
  const ref = (scale?.STAT_REFERENCE as Stats | undefined) ?? null;
  const profiles: [string, Stats | undefined][] = [["none", undefined]];
  if (ref) {
    profiles.push(["reference", { ...ref }]);
    profiles.push(["min", { strength: 0, agility: 0, intelligence: 0, level: 0 }]);
    profiles.push(["max", { strength: 1000, agility: 1000, intelligence: 1000, level: 1000 }]);
  }
  console.log(`Q1 verify '${label}': pipeline=${pipe ? "yes" : "no"} statScale=${scale ? "yes" : "no"} profiles=${profiles.map((p) => p[0]).join(",")}`);
  const rows: Loose[] = [], extra: Loose[] = [];
  let baseRows: Loose[] = [];
  if (label !== "baseline") { try { baseRows = JSON.parse(await Deno.readTextFile(`${OUT}/baseline.json`)).rows; } catch { /* no baseline */ } }
  const baseOf = (race: string, sex: string) => baseRows.find((b) => b.race === race && b.sex === sex && b.profile === "none");
  for (const race of races) for (const sex of sexes) {
    const R = RACE_SPECS[race];
    const base: BodySpec = { race, subrace: R.subrace, className: "Warrior", height: R.height, weight: R.weight, seed: 1234567, sex };
    const hashes: Record<string, string> = {};
    for (const [name, stats] of profiles) {
      const spec = stats ? { ...base, stats } as BodySpec : base;
      const { row, hash } = await measure(spec, pipe, name);
      hashes[name] = hash;
      row.fails = rowFails(row);
      // Pre-existing at HEAD (same body in baseline.json) = KNOWN, not a regression of this wave.
      const known = new Set(label === "baseline" ? [] : ((baseOf(race, sex)?.fails as string[] | undefined) ?? []));
      row.known = (row.fails as string[]).filter((x) => known.has(x));
      row.fails = (row.fails as string[]).filter((x) => !known.has(x));
      if (name === "none" || name === "reference") row.regressions = regressions(row, baseOf(race, sex));
      rows.push(row);
      const t = row.topology as Loose, h = row.hitboxes as Loose, sy = row.symmetrySkin as Loose, sp = row.symmetryPhysics as Loose;
      console.log(`${race}/${sex}/${name}: tris ${t.triangles} bnd ${t.boundaryEdges} nm ${t.nonManifoldEdges} comp ${t.components} wind ${t.windingConflicts} degen ${t.degenerate} ` +
        `| sym skin p95 ${sy.p95Mm} max ${sy.maxMm} mm, phys p95 ${sp.p95Mm} max ${sp.maxMm} mm | skinDev ${(row.skin as Loose).maxSumDeviation} ` +
        `| cov ${h.coveragePct}% over ${h.overshootPct}% caps ${h.capsules} | det ${row.deterministic} | ${row.buildMs} ms ${(row.fails as string[]).length ? "FAIL " + (row.fails as string[]).join("; ") : "ok"}` +
        `${(row.known as string[]).length ? " | known@HEAD " + (row.known as string[]).join("; ") : ""}${(row.regressions as string[] | undefined)?.length ? " | REGRESSION " + (row.regressions as string[]).join("; ") : ""}`);
    }
    if (ref) {
      // morph identity at reference + monotone girth per stat (strength sweep on the rendered skin)
      const identity = hashes.reference === hashes.none;
      const girth: Loose = {};
      for (const stat of ["strength", "level", "intelligence", "agility"] as const) {
        const vals: number[] = [];
        for (const v of [0, 250, 500, 750, 1000]) {
          const b = build({ ...base, stats: { ...ref, [stat]: v } } as BodySpec, pipe);
          vals.push(girthMetric(b.mesh));
        }
        const d = vals.slice(1).map((x, i) => x - vals[i]);
        girth[stat] = { volumeL: vals.map((x) => r(x * 1000, 3)), monotoneUp: d.every((x) => x >= -1e-6), monotoneDown: d.every((x) => x <= 1e-6) };
      }
      extra.push({ race, sex, identityAtReference: identity, girth });
      console.log(`${race}/${sex}: identity@reference ${identity}; volume(L) by stat ${JSON.stringify(girth)}`);
    }
  }
  const fails = rows.filter((x) => (x.fails as string[]).length || (x.regressions as string[] | undefined)?.length)
    .map((x) => `${x.race}/${x.sex}/${x.profile}: ${[...(x.fails as string[]), ...((x.regressions as string[] | undefined) ?? [])].join("; ")}`);
  const report = { label, at: new Date().toISOString(), pipeline: !!pipe, statScale: !!scale, rows, morph: extra, fails };
  await Deno.mkdir(OUT, { recursive: true });
  await Deno.writeTextFile(`${OUT}/${label}.json`, JSON.stringify(report, null, 1));
  console.log(`\n${rows.length} bodies, ${fails.length} failing rows -> ${OUT}/${label}.json`);
  for (const f of fails) console.log("  FAIL " + f);
}

/** Enclosed volume of a closed mesh (divergence theorem), m³. */
export function girthMetric(mesh: MeshData): number {
  const P = mesh.positions, I = mesh.indices;
  let v = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2];
    v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return Math.abs(v / 6);
}


// ---------- independent animation meter (re-measures lane K's audit on a few clips) ----------
// Own driver: Animator.update -> Skeleton.drive -> rig.update -> placement (rotation.set + applyRootTilt) ->
// settleOnFloor when groundBody > 0. No swing / ArmGuard (locomotion and fall clips only, whose feet/floor numbers
// do not depend on the arm guard). Own meters on EVERY skin vertex (CPU-skinned, stride 1).
const ANIM_CLIPS: Record<string, { dur: number; tag: string; speed?: number; dir?: number; engaged?: boolean; fall?: { phase: string; pose: string; dir: [number, number] }; vel?: [number, number] }[]> = {
  idle: [{ dur: 0.6, tag: "lead" }, { dur: 1.5, tag: "x" }],
  walk: [{ dur: 0.4, tag: "lead" }, { dur: 2.5, tag: "x", speed: 2.1 }],
  strafe: [{ dur: 0.4, tag: "lead", engaged: true }, { dur: 2, tag: "x", speed: 6.5, dir: Math.PI / 2, engaged: true }],
  "fall:back": [
    { dur: 0.6, tag: "lead", engaged: true },
    { dur: 0.35, tag: "x", fall: { phase: "stagger", pose: "back", dir: [0, -1] }, vel: [0, -0.8], engaged: true },
    { dur: 0.5, tag: "x", fall: { phase: "falling", pose: "back", dir: [0, -1] }, vel: [0, -0.3], engaged: true },
    { dur: 0.8, tag: "x", fall: { phase: "down", pose: "back", dir: [0, -1] }, engaged: true },
    { dur: 1.3, tag: "x", fall: { phase: "rising", pose: "back", dir: [0, -1] }, engaged: true },
    { dur: 1.0, tag: "x", engaged: true },
  ],
};
// Same looks as lane K's tools/audit-animations.ts BODIES (copied so the meter also runs on a HEAD checkout).
const ANIM_BODIES: Record<string, Loose> = {
  human: { body: "#ef7455", accent: "#dfaa55", height: 1.7, weight: 72, hair: "#3a2a1a", eyes: "#2f6fb5", race: "human", subrace: null, sex: "male" },
  humanF: { body: "#ef7455", accent: "#dfaa55", height: 1.64, weight: 60, hair: "#3a2a1a", eyes: "#2f6fb5", race: "human", subrace: null, sex: "female" },
  elf: { body: "#82b970", accent: "#a9ce7c", height: 1.77, weight: 60, hair: "#d8b87a", eyes: "#a9ce7c", race: "elf", subrace: "wood", sex: "male" },
  elfF: { body: "#82b970", accent: "#a9ce7c", height: 1.72, weight: 54, hair: "#d8b87a", eyes: "#a9ce7c", race: "elf", subrace: "wood", sex: "female" },
  dwarf: { body: "#9b72cf", accent: "#dfaa55", height: 1.39, weight: 70, hair: "#a87a4a", eyes: "#172128", race: "dwarf", subrace: "mountain", sex: "male" },
  dwarfF: { body: "#9b72cf", accent: "#dfaa55", height: 1.34, weight: 62, hair: "#a87a4a", eyes: "#172128", race: "dwarf", subrace: "mountain", sex: "female" },
  ork: { body: "#4f8490", accent: "#172128", height: 1.95, weight: 120, hair: "#172128", eyes: "#172128", race: "ork", subrace: "ironhide", sex: "male" },
  orkF: { body: "#4f8490", accent: "#172128", height: 1.86, weight: 100, hair: "#172128", eyes: "#172128", race: "ork", subrace: "ironhide", sex: "female" },
};
async function animMeter(args: string[]) {
  const THREE = await import("three");
  const SH = await import("../src/graphics/body/SkinnedHumanoid.ts");
  const { defaultHumanoid } = await import("../src/game/Skeleton.ts");
  const { legGeometryFromBones, limitTableFrom } = await import("../src/game/anim/Rig.ts");
  const { Animator } = await import("../src/game/anim/Animator.ts");
  const { generateClassWeapon } = await import("../src/game/WeaponGen.ts");
  const { wrapAngle } = await import("../src/core/MathCore.ts");
  const BODIES = ANIM_BODIES;
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const label = opt("--label") ?? "anim";
  const bodies = (opt("--bodies") ?? "human,elfF,dwarf,ork").split(",");
  const clips = (opt("--clips") ?? Object.keys(ANIM_CLIPS).join(",")).split(",");
  const HZ = 60, DT = 1 / HZ, ACCEL = 6.5 / 0.12, ground = () => 0;
  const out: Loose[] = [];
  for (const body of bodies) {
    const look = BODIES[body];
    if (!look) { console.log(`no body ${body} in audit-animations BODIES`); continue; }
    for (const clip of clips) {
      // deno-lint-ignore no-explicit-any
      const rig = SH.buildSkinnedHumanoid(generateClassWeapon("Warrior"), look as any, "fire", undefined, { paint: false });
      const mesh = rig.skin, geo = mesh.geometry, pos = geo.getAttribute("position"), n = pos.count;
      const si = geo.getAttribute("skinIndex"), sw = geo.getAttribute("skinWeight");
      const names = mesh.skeleton.bones.map((b) => b.name);
      // foot vertices: dominant bone ankle*/toe* per side (bind)
      const footOf = new Int8Array(n).fill(-1);
      for (let i = 0; i < n; i++) {
        let best = 0, bi = 0;
        for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > best) { best = w; bi = si.getComponent(i, k); } }
        const nm = names[bi] ?? "";
        if (/^(ankle|toe)L/.test(nm)) footOf[i] = 0; else if (/^(ankle|toe)R/.test(nm)) footOf[i] = 1;
      }
      const sk = defaultHumanoid();
      const ankleY = rig.plan.bones.find((x) => x.id === "ankleL")!.head[1];
      const an = new Animator(legGeometryFromBones(rig.plan.bones, ankleY, 1), limitTableFrom(sk.limits()));
      const b = { x: 0, z: 0, vx: 0, vz: 0 }, prev = { x: 0, z: 0, yaw: 0 };
      const ox = 0, oz = 1000;
      let first = true;
      const v = new THREE.Vector3();
      let last: Float32Array | null = null, last2: Float32Array | null = null;
      const stanceIdx: (number[] | null)[] = [null, null];
      const lastQ = mesh.skeleton.bones.map((bn) => bn.quaternion.clone());
      const r0 = { body, clip, frames: 0, floorMm: Infinity, slideMm: 0, popMm: 0, popBoneRad: 0, popBone: "", popAt: 0 };
      const stanceStart: (number[] | null)[] = [null, null];
      let t = 0;
      for (const seg of ANIM_CLIPS[clip]) {
        const steps = Math.max(1, Math.round(seg.dur * HZ));
        for (let k = 0; k < steps; k++) {
          t += DT;
          const u = (k + 1) / steps, yaw0 = Math.atan2(ox - b.x, oz - b.z);
          if (seg.vel) { b.x += seg.vel[0] * DT; b.z += seg.vel[1] * DT; } else {
            const sp = seg.speed ?? 0, md = yaw0 + (seg.dir ?? 0), tx = sp * Math.sin(md) - b.vx, tz = sp * Math.cos(md) - b.vz;
            const dv = Math.hypot(tx, tz), s = dv > ACCEL * DT ? ACCEL * DT / dv : 1;
            b.vx += tx * s; b.vz += tz * s; b.x += b.vx * DT; b.z += b.vz * DT;
          }
          const yaw = Math.atan2(ox - b.x, oz - b.z);
          if (first) { prev.x = b.x; prev.z = b.z; prev.yaw = yaw; }
          const dx = b.x - prev.x, dz = b.z - prev.z, speed = Math.hypot(dx, dz) / DT;
          const o = an.update(DT, {
            x: b.x, z: b.z, yaw, rootY: 0, speed, moveDirLocal: speed > 1e-3 ? wrapAngle(Math.atan2(dx, dz) - yaw) : 0,
            turnRate: wrapAngle(yaw - prev.yaw) / DT, grounded: true, hit: false, attack: false, block: false, ko: false,
            engaged: !!seg.engaged, skill: null, skillProgress: 0, groundHeight: ground, externalRoll: 0, honoursYawOffset: true,
            // deno-lint-ignore no-explicit-any
            fall: seg.fall ? { ...seg.fall, t01: u } as any : null, shove: null,
          });
          b.x += o.bodyShift[0]; b.z += o.bodyShift[1];
          prev.x = b.x; prev.z = b.z; prev.yaw = yaw;
          sk.drive(o.angles, o.hipRoll, o.ankleRoll, o.toeOut, undefined, o.wideLimits);
          rig.update(sk, DT);
          const yn = yaw + o.yawOffset, fwd = o.rootOffsetForward ?? 0;
          rig.group.position.set(b.x + o.rootOffsetLateral * Math.cos(yn) + fwd * Math.sin(yn), o.rootOffsetY, b.z - o.rootOffsetLateral * Math.sin(yn) + fwd * Math.cos(yn));
          rig.group.rotation.set(0, yn, o.rootRoll);
          if (o.rootTilt) SH.applyRootTilt(rig.group, o.rootTilt);
          if ((o.groundBody ?? 0) > 0) SH.settleOnFloor(rig, ground, o.groundBody);
          rig.group.updateMatrixWorld(true);
          first = false;
          // ---- own CPU skinning of every vertex ----
          const cur = new Float32Array(3 * n);
          let minY = Infinity;
          const low: [number, number, number, number][][] = [[], []];
          for (let i = 0; i < n; i++) {
            mesh.getVertexPosition(i, v); mesh.localToWorld(v);
            cur[3 * i] = v.x; cur[3 * i + 1] = v.y; cur[3 * i + 2] = v.z;
            if (v.y < minY) minY = v.y;
            if (footOf[i] >= 0) low[footOf[i]].push([v.y, v.x, v.z, i]);
          }
          if (seg.tag !== "x") { last2 = last; last = cur; mesh.skeleton.bones.forEach((bn, i) => lastQ[i].copy(bn.quaternion)); continue; }
          r0.frames++;
          r0.floorMm = Math.min(r0.floorMm, 1000 * minY);
          if (last && last2) {
            // pop = largest second difference |x(t) - 2x(t-1) + x(t-2)| of any skin vertex (mm/frame²): a smooth
            // motion has a small one whatever its speed; a snap shows as a spike.
            let pm = 0;
            for (let i = 0; i < n; i++) {
              const d = Math.hypot(cur[3 * i] - 2 * last[3 * i] + last2[3 * i], cur[3 * i + 1] - 2 * last[3 * i + 1] + last2[3 * i + 1], cur[3 * i + 2] - 2 * last[3 * i + 2] + last2[3 * i + 2]);
              if (d > pm) pm = d;
            }
            if (1000 * pm > r0.popMm) { r0.popMm = 1000 * pm; r0.popAt = t; }
          }
          mesh.skeleton.bones.forEach((bn, i) => {
            const d = 2 * Math.acos(Math.min(1, Math.abs(bn.quaternion.dot(lastQ[i]))));
            if (d > r0.popBoneRad) { r0.popBoneRad = d; r0.popBone = bn.name; }
            lastQ[i].copy(bn.quaternion);
          });
          // slide: the SAME 12 vertices (the lowest of that foot when the stance began) are followed through the
          // stance; their xz centroid drift is the slide (a heel-to-ball roll moves which vertices are lowest,
          // so re-picking the lowest each frame would read the roll as a slide).
          for (let s = 0; s < 2; s++) {
            if (o.feet[s].planted) {
              if (!stanceIdx[s]) stanceIdx[s] = low[s].sort((a, c) => a[0] - c[0]).slice(0, 12).map((p) => p[3]);
              const ids = stanceIdx[s]!;
              const c = [ids.reduce((a, i) => a + cur[3 * i], 0) / ids.length, ids.reduce((a, i) => a + cur[3 * i + 2], 0) / ids.length];
              if (!stanceStart[s]) stanceStart[s] = c;
              r0.slideMm = Math.max(r0.slideMm, 1000 * Math.hypot(c[0] - stanceStart[s]![0], c[1] - stanceStart[s]![1]));
            } else { stanceStart[s] = null; stanceIdx[s] = null; }
          }
          last2 = last; last = cur;
        }
      }
      const row = { ...r0, floorMm: r(r0.floorMm, 1), slideMm: r(r0.slideMm, 1), popMm: r(r0.popMm, 1), popBoneRad: r(r0.popBoneRad, 3), popAt: r(r0.popAt, 3) };
      out.push(row);
      console.log(`${body} ${clip}: frames ${row.frames} floor ${row.floorMm} mm, slide ${row.slideMm} mm, vertex pop ${row.popMm} mm/frame², bone pop ${row.popBoneRad} rad (${row.popBone} @${row.popAt}s)`);
    }
  }
  await Deno.mkdir(OUT, { recursive: true });
  await Deno.writeTextFile(`${OUT}/${label}.json`, JSON.stringify({ label, at: new Date().toISOString(), rows: out }, null, 1));
  console.log(`-> ${OUT}/${label}.json`);
}


// ---------- lane S: paint stage + hair geometry (independent) ----------
// paint: length = 3 x vertices, finite, linear range, deterministic (hash of two runs), the mesh untouched (hash before/after).
// hair: own triangle count (idx/3 summed over groups), finite positions, identity absent == I 500 (hash), budget at I 0/500/1000.
async function paintCheck(args: string[]) {
  const { paintStage } = await import("../src/graphics/paint/PaintStage.ts");
  const HM = await import("../src/graphics/body/HairMesh.ts");
  const { anatomyFor } = await import("../src/graphics/body/Anatomy.ts");
  const { ancestryOf } = await import("../src/game/Ancestry.ts");
  const { greyFraction, lifeFraction } = await import("../src/game/Age.ts");
  const { hairLengthM } = await import("../src/graphics/body/Proportions.ts");
  const { headFrameOf } = await import("../src/graphics/body/HairFollicles.ts");
  const label = args[0] ?? "paint";
  const rows: Loose[] = [];
  for (const race of Object.keys(RACE_SPECS)) for (const sex of SEXES) {
    const R = RACE_SPECS[race];
    const spec: BodySpec = { race, subrace: R.subrace, className: "Warrior", height: R.height, weight: R.weight, seed: 1234567, sex };
    const body = generateBody(spec);
    const meshHash0 = await sha(body.mesh.positions, body.mesh.indices, body.mesh.normals);
    const a = paintStage(body.mesh, spec, body.plan.cell), b = paintStage(body.mesh, spec, body.plan.cell);
    const meshHash1 = await sha(body.mesh.positions, body.mesh.indices, body.mesh.normals);
    let nonFinite = 0, lo = Infinity, hi = -Infinity;
    for (const v of a.paint) { if (!Number.isFinite(v)) nonFinite++; else { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    const det = (await sha(a.paint)) === (await sha(b.paint));
    rows.push({ race, sex, kind: "paint", length: a.paint.length, want: body.mesh.positions.length, nonFinite, min: r(lo, 4), max: r(hi, 4), deterministic: det, meshUntouched: meshHash0 === meshHash1, ms: r(a.record.ms, 1), metrics: a.record.metrics });
    console.log(`paint ${race}/${sex}: len ${a.paint.length}/${body.mesh.positions.length} nonFinite ${nonFinite} range ${r(lo, 4)}..${r(hi, 4)} det ${det} meshUntouched ${meshHash0 === meshHash1} ${r(a.record.ms, 1)} ms ridge/cavity ${a.record.metrics.ridgeCavityContrast}`);
  }
  const subs: [string, string][] = [["human", "imperial"], ["elf", "high"], ["dwarf", "mountain"], ["ork", "ironhide"], ["elf", "wood"], ["dwarf", "deep"]];
  for (const [race, sub] of subs) for (const seed of [3, 29, 101]) {
    const plan = anatomyFor({ race, subrace: sub, className: "Warrior", height: 1.7, weight: 70, seed: 7 });
    const node = ancestryOf(race, sub), f = headFrameOf(plan.face, [0, 0, 0], plan.proportions.head, ancestryOf(race, sub).ears.lengthMul);
    const inp = (I?: number) => {
      const x: Loose = { frame: f, spec: node.hair, lengthM: hairLengthM(node, f.h), seed, race, ancestryIds: [race, sub], sex: "male", lifeFraction: lifeFraction(race, 30), grey: greyFraction(race, 30), baseHex: node.hair.colors[0], skinHex: node.skin.base };
      if (I !== undefined) x.intelligence = I;
      return x as unknown as Parameters<typeof HM.buildHairData>[0];
    };
    const geo = async (d: ReturnType<typeof HM.buildHairData>) => {
      let tris = 0, bad = 0;
      const pos: number[] = [];
      for (const [, g] of [...d.groups.entries()].sort((x, y) => x[0] < y[0] ? -1 : 1)) {
        tris += g.idx.length / 3;
        for (const v of g.pos) { if (!Number.isFinite(v)) bad++; pos.push(v); }
        for (const i of g.idx) if (i >= g.pos.length / 3) bad++;
      }
      return { tris, bad, hash: await sha(new Float64Array(pos)) };
    };
    const g0 = await geo(HM.buildHairData(inp())), g5 = await geo(HM.buildHairData(inp(500)));
    const gLo = await geo(HM.buildHairData(inp(0))), gHi = await geo(HM.buildHairData(inp(1000)));
    const row = { race, sub, seed, kind: "hair", identity: g0.hash === g5.hash, tris: [gLo.tris, g5.tris, gHi.tris], bad: g0.bad + gLo.bad + gHi.bad, budget: HM.HAIR_TRI_BUDGET };
    rows.push(row);
    console.log(`hair ${race}/${sub}/${seed}: identity(absent==500) ${row.identity} tris I0/500/1000 ${row.tris.join("/")} (budget ${row.budget}) bad ${row.bad}`);
  }
  const fails = rows.filter((x) => x.kind === "paint"
    ? (x.length !== x.want || x.nonFinite || !x.deterministic || !x.meshUntouched || (x.min as number) < 0 || (x.max as number) > 1.0001)
    : (!x.identity || (x.tris as number[]).some((t) => t > (x.budget as number)) || x.bad));
  await Deno.mkdir(OUT, { recursive: true });
  await Deno.writeTextFile(`${OUT}/${label}.json`, JSON.stringify({ label, at: new Date().toISOString(), rows, fails: fails.length }, null, 1));
  console.log(`${rows.length} rows, ${fails.length} failing -> ${OUT}/${label}.json`);
}


// ---------- lane U: neighbour-dependent constraints, fuzzed, + the geometry of the bodies they allow ----------
// Random edit sequences through Constraints.applyEdit (seeded LCG); after EVERY edit, my own reading of the
// rules on proportionsFor (waist half-width <= hip and <= shoulder joint + deltoid; BMI within the band; every
// number within its static band) and idempotence (re-applying the value moves nothing). Then the extreme states
// reached are BUILT (generateBody) and checked: topology, triangle budget, waist mesh width <= hip mesh width.
async function uiCheck(args: string[]) {
  const C = await import("../src/ui/Constraints.ts");
  const { proportionsFor } = await import("../src/graphics/body/Proportions.ts");
  const label = args[0] ?? "ui";
  const N = Number(args[1] ?? 300);
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const rows: Loose[] = [];
  for (const race of Object.keys(RACE_SPECS)) for (const sex of SEXES) {
    const R = RACE_SPECS[race];
    let st = C.bodyState({ race, subrace: R.subrace, sex, height: R.height, weight: R.weight });
    st = C.settle(st).state;
    let broken = 0, outStatic = 0, nonIdem = 0, minSlackMm = Infinity;
    const extremes = new Map<string, typeof st>();
    for (let i = 0; i < N; i++) {
      const k = C.BODY_KEYS[Math.floor(rnd() * C.BODY_KEYS.length)];
      const [lo, hi] = C.staticBand(st, k), span = hi - lo;
      const wanted = lo - 0.3 * span + rnd() * 1.6 * span; // also asks for values outside the static band
      st = C.applyEdit(st, k, wanted).state;
      const p = proportionsFor(C.specOf(st));
      const s1 = p.halfWidth.hip - p.halfWidth.waist, s2 = p.halfWidth.shoulderJoint + p.radius.deltoid - p.halfWidth.waist;
      minSlackMm = Math.min(minSlackMm, 1000 * Math.min(s1, s2));
      const bmi = st.weight / (st.height * st.height), c = C.raceBmi(race, R.subrace);
      if (s1 < -1e-9 || s2 < -1e-9 || bmi < C.BMI_BAND[0] * c - 1e-9 || bmi > C.BMI_BAND[1] * c + 1e-9) broken++;
      for (const kk of C.BODY_KEYS) { const [a, b] = C.staticBand(st, kk), v = C.valueOf(st, kk); if (v < a - 1e-9 || v > b + 1e-9) outStatic++; }
      const again = C.applyEdit(st, k, C.valueOf(st, k)).state;
      if (C.BODY_KEYS.some((kk) => Math.abs(C.valueOf(again, kk) - C.valueOf(st, kk)) > 1e-9)) nonIdem++;
      for (const kk of ["waist", "hip", "shoulder", "height", "weight"]) {
        const v = C.valueOf(st, kk as never);
        const lo2 = extremes.get(`${kk}-min`), hi2 = extremes.get(`${kk}-max`);
        if (!lo2 || v < C.valueOf(lo2, kk as never)) extremes.set(`${kk}-min`, st);
        if (!hi2 || v > C.valueOf(hi2, kk as never)) extremes.set(`${kk}-max`, st);
      }
    }
    // build the extreme bodies (the UI can produce them): topology + budget + mesh waist vs hip width
    let buildFails = 0, worstTris = 0;
    const meshW: string[] = [];
    for (const [name, x] of [...extremes.entries()].filter(([n]) => n.startsWith("waist") || n.startsWith("shoulder-min") || n.startsWith("hip-min"))) {
      const body = generateBody(C.specOf(x));
      const t = topology(body.mesh);
      worstTris = Math.max(worstTris, t.triangles);
      if (t.boundaryEdges || t.nonManifoldEdges || t.windingConflicts || t.degenerate || t.triangles >= TRI_BUDGET) buildFails++;
      const pp = proportionsFor(C.specOf(x));
      meshW.push(`${name}: waist ${r(pp.halfWidth.waist * 1000, 1)} hip ${r(pp.halfWidth.hip * 1000, 1)} mm tris ${t.triangles} bnd ${t.boundaryEdges} nm ${t.nonManifoldEdges} wind ${t.windingConflicts} degen ${t.degenerate} comps ${t.components}${t.degenerate || t.boundaryEdges || t.nonManifoldEdges ? " spec " + JSON.stringify(C.specOf(x)) : ""}`);
    }
    // whole live rig budget (< 12 000, tests/ancestry_look_test.ts) on the heaviest extreme body
    let rigTris = 0;
    {
      const SH = await import("../src/graphics/body/SkinnedHumanoid.ts");
      const { generateClassWeapon } = await import("../src/game/WeaponGen.ts");
      for (const [, x] of extremes) {
        const sp = C.specOf(x);
        const rig = SH.buildSkinnedHumanoid(generateClassWeapon("Warrior"), { body: "#ef7455", accent: "#dfaa55", height: sp.height, weight: sp.weight, hair: "#3a2a1a", eyes: "#2f6fb5", race, subrace: R.subrace, sex } as never, "fire", sp, { paint: false });
        rigTris = Math.max(rigTris, rig.triangleCount);
      }
    }
    const row = { race, sex, edits: N, rigTris, broken, outStatic, nonIdempotent: nonIdem, minRuleSlackMm: r(minSlackMm, 2), extremeBuilds: extremes.size, buildFails, worstTris, meshW };
    rows.push(row);
    console.log(`ui ${race}/${sex}: ${N} edits, broken ${broken}, outside static ${outStatic}, non-idempotent ${nonIdem}, min waist slack ${row.minRuleSlackMm} mm; extreme builds fail ${buildFails}, max body tris ${worstTris}, max rig tris ${rigTris}`);
  }
  await Deno.mkdir(OUT, { recursive: true });
  await Deno.writeTextFile(`${OUT}/${label}.json`, JSON.stringify({ label, at: new Date().toISOString(), rows }, null, 1));
  console.log(`-> ${OUT}/${label}.json`);
}


// ---------- lane B: the stat morph itself (monotone, bounded, identity at reference) ----------
async function morphCheck(args: string[]) {
  const SM = await import("../src/graphics/body/StatMorph.ts");
  const label = args[0] ?? "morph";
  const flat = (m: Loose, pre = "", out: Record<string, number> = {}) => {
    for (const [k, v] of Object.entries(m)) {
      if (k === "u" || k === "posture") continue;
      if (typeof v === "number") out[pre + k] = v; else if (v && typeof v === "object") flat(v as Loose, `${pre}${k}.`, out);
    }
    return out;
  };
  const rows: Loose[] = [];
  let bad = 0;
  for (const race of Object.keys(RACE_SPECS)) for (const sex of SEXES) {
    const sub = RACE_SPECS[race].subrace, ref = SM.STAT_REFERENCE;
    const absent = flat(SM.statMorph(null, race, sub, sex) as unknown as Loose), atRef = flat(SM.statMorph({ ...ref }, race, sub, sex) as unknown as Loose);
    const identity = JSON.stringify(absent) === JSON.stringify(atRef);
    const nonMono: string[] = [], nonFinite: string[] = [];
    const ranges: Record<string, string> = {};
    for (const stat of ["strength", "agility", "intelligence", "level"] as const) {
      const seq = Array.from({ length: 21 }, (_, i) => flat(SM.statMorph({ ...ref, [stat]: i * 50 }, race, sub, sex) as unknown as Loose));
      for (const k of Object.keys(seq[0])) {
        const v = seq.map((x) => x[k]);
        if (v.some((x) => !Number.isFinite(x))) nonFinite.push(`${stat}:${k}`);
        const d = v.slice(1).map((x, i) => x - v[i]);
        if (d.some((x) => x > 1e-12) && d.some((x) => x < -1e-12)) nonMono.push(`${stat}:${k}`);
        if (v[0] !== v[20]) ranges[`${stat}:${k}`] = `${r(v[0], 4)}..${r(v[20], 4)}`;
      }
    }
    const extreme = flat(SM.statMorph({ strength: 1e9, agility: -5, intelligence: NaN, level: Infinity }, race, sub, sex) as unknown as Loose);
    const extremeBad = Object.entries(extreme).filter(([, v]) => !Number.isFinite(v)).map(([k]) => k);
    const row = { race, sex, identityAbsentEqRef: identity, nonMonotone: nonMono, nonFinite, extremeNonFinite: extremeBad, ranges };
    if (!identity || nonMono.length || nonFinite.length || extremeBad.length) bad++;
    rows.push(row);
    console.log(`morph ${race}/${sex}: identity ${identity}, non-monotone ${nonMono.length ? nonMono.join(",") : 0}, non-finite ${nonFinite.length + extremeBad.length}; moving terms ${Object.entries(ranges).map(([k, v]) => `${k} ${v}`).join("; ")}`);
  }
  await Deno.mkdir(OUT, { recursive: true });
  await Deno.writeTextFile(`${OUT}/${label}.json`, JSON.stringify({ label, at: new Date().toISOString(), rows, bad }, null, 1));
  console.log(`${bad} bad -> ${OUT}/${label}.json`);
}

// ---------- ledger + doc ----------
interface Verdict { lane: string; claim: string; method: string; verdict: string; result: string; board: string; at: string }
async function readLedger(): Promise<Verdict[]> {
  try { return JSON.parse(await Deno.readTextFile(LEDGER)); } catch { return []; }
}
async function verdict(a: string[]) {
  const [lane, claim, method, v, board, ...rest] = a;
  const l = await readLedger();
  l.push({ lane, claim, method, verdict: v, board, result: rest.join(" "), at: new Date().toISOString() });
  await Deno.mkdir(OUT, { recursive: true });
  await Deno.writeTextFile(LEDGER, JSON.stringify(l, null, 1));
  console.log(`ledger: ${l.length} entries`);
}
function summaryTable(rep: Loose): string {
  const rows = rep.rows as Loose[];
  const lines = ["| body | tris | bnd/nm/comp/wind | degen | sym skin p95/max mm | sym phys p95/max mm | skin dev | coverage % | overshoot % | det | fails |", "|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const x of rows) {
    const t = x.topology as Loose, s = x.symmetrySkin as Loose, p = x.symmetryPhysics as Loose, h = x.hitboxes as Loose;
    lines.push(`| ${x.race}/${x.sex}/${x.profile} | ${t.triangles} | ${t.boundaryEdges}/${t.nonManifoldEdges}/${t.components}/${t.windingConflicts} | ${t.degenerate} | ${s.p95Mm}/${s.maxMm} | ${p.p95Mm}/${p.maxMm} | ${(x.skin as Loose).maxSumDeviation} | ${h.coveragePct} | ${h.overshootPct} | ${x.deterministic} | ${[...(x.fails as string[]), ...((x.regressions as string[] | undefined) ?? [])].join("; ") || "-"}${(x.known as string[] | undefined)?.length ? " (known@HEAD: " + (x.known as string[]).join("; ") + ")" : ""} |`);
  }
  const morph = (rep.morph as Loose[] | undefined) ?? [];
  if (morph.length) {
    lines.push("", "| body | identity@reference | volume L by strength 0..1000 | by level | by intelligence | by agility |", "|---|---|---|---|---|---|");
    for (const m of morph) {
      const g = m.girth as Record<string, Loose>;
      const c = (k: string) => `${(g[k].volumeL as number[]).join(" ")} (${g[k].monotoneUp ? "up" : g[k].monotoneDown ? "down" : "NOT monotone"})`;
      lines.push(`| ${m.race}/${m.sex} | ${m.identityAtReference} | ${c("strength")} | ${c("level")} | ${c("intelligence")} | ${c("agility")} |`);
    }
  }
  return lines.join("\n");
}
function animTable(base: Loose | null, fin: Loose | null): string {
  if (!fin) return "_not run_";
  const b = new Map(((base?.rows as Loose[]) ?? []).map((x) => [`${x.body}|${x.clip}`, x]));
  const lines = ["| body | clip | slide mm | floor mm | vertex pop mm/frame² | bone pop rad |", "|---|---|---|---|---|---|"];
  for (const x of fin.rows as Loose[]) {
    const o = b.get(`${x.body}|${x.clip}`);
    const c = (k: string) => o ? `${o[k]} -> ${x[k]}` : `${x[k]}`;
    lines.push(`| ${x.body} | ${x.clip} | ${c("slideMm")} | ${c("floorMm")} | ${c("popMm")} | ${c("popBoneRad")} |`);
  }
  return lines.join("\n");
}
function extraLines(ui: Loose | null, paint: Loose | null): string[] {
  const out: string[] = [];
  if (ui) {
    out.push("| body | edits | rules broken | outside static band | non-idempotent | min waist slack mm | extreme builds failing | max rig tris |", "|---|---|---|---|---|---|---|---|");
    for (const x of ui.rows as Loose[]) out.push(`| ${x.race}/${x.sex} | ${x.edits} | ${x.broken} | ${x.outStatic} | ${x.nonIdempotent} | ${x.minRuleSlackMm} | ${x.buildFails} | ${x.rigTris} |`);
  }
  if (paint) {
    const rows = paint.rows as Loose[], p = rows.filter((x) => x.kind === "paint"), h = rows.filter((x) => x.kind === "hair");
    out.push("", `paint: ${p.length} bodies, deterministic ${p.filter((x) => x.deterministic).length}, mesh untouched ${p.filter((x) => x.meshUntouched).length}, ` +
      `range ${Math.min(...p.map((x) => x.min as number))}..${Math.max(...p.map((x) => x.max as number))}; hair: ${h.length} builds, absent==I500 ${h.filter((x) => x.identity).length}, ` +
      `max tris ${Math.max(...h.flatMap((x) => x.tris as number[]))} (budget ${h[0]?.budget}).`);
  }
  return out;
}

async function doc() {
  const l = await readLedger();
  const load = async (n: string) => { try { return JSON.parse(await Deno.readTextFile(`${OUT}/${n}.json`)) as Loose; } catch { return null; } };
  const base = await load("baseline"), fin = await load("final");
  const latest = new Map<string, Verdict>();
  for (const v of l) latest.set(`${v.lane}|${v.claim}`, v);
  const open = [...latest.values()].filter((v) => v.verdict === "FAIL");
  const md = [
    "# Wave GEN — Q1 geometric verification (generated by `deno run -A tools/verify-wave-gen-geo.ts doc`)",
    "",
    "Every number below is read from `artifacts/wave-gen/verify-geo/*.json`; nothing is typed by hand.",
    "Method: `tools/verify-wave-gen-geo.ts run <label>` builds each body twice and measures topology (own edge maps),",
    "degenerate triangles (area < 1e-10 m² or edge < 1 µm), mirror-vertex symmetry (x -> -x nearest vertex; skin = rendered",
    "with the seeded natural asymmetry, phys = the exact-mirror physics field), skin weight sums, triangle budget (< 12 000),",
    "hitbox coverage of the rendered skin (bind frames from `bindBoneMatrix`, slack CONTACT_SLACK) and air overshoot (1.5 cm grid),",
    "determinism (SHA-256 of positions, indices, skin, capsules), and once the pipeline lands: stage metrics, cageViolationMm,",
    "morph identity at STAT_REFERENCE and enclosed-volume monotonicity per stat.",
    "",
    "## Verdict ledger (claim | lane | method | result | board id)",
    "",
    "| claim | lane | method | verdict | result | board |",
    "|---|---|---|---|---|---|",
    ...l.map((v) => `| ${v.claim} | ${v.lane} | ${v.method} | ${v.verdict} | ${v.result.replaceAll("|", "/")} | ${v.board} |`),
    "",
    "## Open FAILs (latest verdict per lane+claim)",
    "",
    open.length ? open.map((v) => `- ${v.lane} ${v.claim}: ${v.result} (${v.board})`).join("\n") : "- none",
    "",
    "## Baseline (HEAD 6a5f588)",
    "",
    base ? summaryTable(base) : "_not run_",
    "",
    "## Final",
    "",
    fin ? summaryTable(fin) : "_not run_",
    "",
    "## Animation, independent meter (own driver, every skin vertex, no swing/ArmGuard): HEAD -> final",
    "",
    "slide = drift of the 12 lowest foot vertices (fixed at stance start) while the Animator reports the foot planted; floor = min",
    "skin vertex y; pop = largest per-frame second difference of any skin vertex; bone = largest local-quaternion change per frame.",
    "",
    animTable(await load("anim-baseline"), await load("anim-final")),
    "",
    "## Constraints fuzz (lane U) and paint/hair (lane S), final tree",
    "",
    ...extraLines(await load("ui-final"), await load("paint-S-r3")),
    "",
  ].join("\n");
  await Deno.writeTextFile(DOC, md);
  console.log(`wrote ${DOC} (${l.length} verdicts, ${open.length} open FAILs)`);
}

if (import.meta.main) {
  const [cmd, ...rest] = Deno.args;
  if (cmd === "run") await run(rest[0] ?? "run", rest.slice(1));
  else if (cmd === "verdict") await verdict(rest);
  else if (cmd === "doc") await doc();
  else if (cmd === "anim") await animMeter(rest);
  else if (cmd === "paint") await paintCheck(rest);
  else if (cmd === "ui") await uiCheck(rest);
  else if (cmd === "morph") await morphCheck(rest);
  else console.log("usage: run <label> [--races a,b] [--sexes male] [--no-stats] | verdict <lane> <claim> <method> <PASS|FAIL|INFO> <board> <result..> | doc");
}
