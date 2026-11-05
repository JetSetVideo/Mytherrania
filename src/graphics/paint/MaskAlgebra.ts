// MaskAlgebra (wave TEX, contract C-MAT): where a layer lands. A mask is a JSON expression evaluated
// over a whole mesh into one 0..1 value per vertex (feather and grow need the neighbourhood, so masks
// are FIELDS, not point functions). Pure module: no THREE, no DOM. Setup allocates one buffer per
// expression node; the per-vertex loops allocate nothing.
//
// Sources (each 0..1 per vertex):
//   constant    value (saturated)
//   region      1 on the listed regions (optionally only one body side), else 0
//   curvature   S(lo, hi, ±κ): κ = fine mean curvature in grid cells (Miniature.fineCurvature);
//               convex uses +κ (defaults lo 0.28 hi 0.55 = the miniature edge highlight), concave −κ
//   ao          S(lo, hi, depth): broad cavity depth in cells (Miniature.cavityDepth; 0.05 / 0.3)
//   height      body: S(lo, hi, (y − minY)/(maxY − minY));  channel: S(lo, hi, height channel in m)
//   noise       a NoiseAlgebra expression at the bind-pose position (saturated)
//   pattern     a v1 PatternKind's coverage, mix or coverage·mix
//   mark        a mark's vertex-level coverage (MaskContext.marks[id], 0 when absent)
//   direction   S(lo, hi, n·d̂) (up-facing: d = [0,1,0]; down-facing: d = [0,−1,0]; defaults 0..1)
//   distance    1 − S(radius, radius + falloff, |p − anchor|) (anchor a point or a region centroid)
//   channel     the current value of a channel (scalars normalised to 0..1; albedo = W3C Lum of sRGB)
// Combinators (a, b masks, all results saturated):
//   and  min(a, b) | product a·b          or  max(a, b) | sum a + b − a·b (probabilistic)
//   xor  a + b − 2ab                       subtract  a·(1 − b)          invert  1 − a
//   feather  heat diffusion on the mesh for time σ²/2 with σ = radiusMm / 2 (a Gaussian of
//            standard deviation σ: the 95 % half-width is the radius)
//   grow / shrink  grey-scale geodesic dilation / erosion (edge-graph distance d, mean edge h):
//            grow g mm: max(a_i, max_j a_j · sat((g − d_ij)/h + min(1, g/h))); shrink g = 1 − grow_g(1 − a);
//            continuous in g, 0 mm is the exact identity, grow(−g) = shrink(g)
//   remap sat((a − lo)/(hi − lo))   threshold S(level − w, level + w, a)   scale sat(k a)   mix lerp(a, b, t)

import type { MeshData, PatternKind, Region, Vec3 } from "../body/contracts.ts";
import { REGIONS } from "../body/contracts.ts";
import { type ChannelId, isChannelId } from "./Channels.ts";
import { vertexRings } from "./FormShade.ts";
import { cavityDepth, fineCurvature } from "./Miniature.ts";
import { makeNoise } from "./Noise.ts";
import { compileNoise, type NoiseExpr } from "./NoiseAlgebra.ts";
import { sat01, smoothstepSafe } from "./Operators.ts";
import { buildPatternEnv, makePatternContext, PATTERNS, type PatternEnv, REGION_INDEX } from "./Patterns.ts";

/** Vertex-level coverage of a mark (M): bind-pose position, unit normal, region index -> 0..1. */
export type MarkField = (x: number, y: number, z: number, nx: number, ny: number, nz: number, region: number) => number;

export type MaskExpr =
  | { op: "constant"; value: number }
  | { op: "region"; regions: Region[]; side?: "left" | "right" }
  | { op: "curvature"; sign: "convex" | "concave"; lo?: number; hi?: number }
  | { op: "ao"; lo?: number; hi?: number }
  | { op: "height"; source?: "body" | "channel"; lo: number; hi: number }
  | { op: "noise"; expr: NoiseExpr; seed?: number }
  | { op: "pattern"; pattern: PatternKind; scale: number; params?: Record<string, number>; seed?: number; field?: "coverage" | "mix" | "product" }
  | { op: "mark"; id: string }
  | { op: "direction"; dir: Vec3; lo?: number; hi?: number }
  | { op: "distance"; anchor: Vec3 | { region: Region; side?: 0 | 1 }; radius: number; falloff?: number }
  | { op: "channel"; channel: ChannelId }
  | { op: "and"; a: MaskExpr; b: MaskExpr; mode?: "min" | "product" }
  | { op: "or"; a: MaskExpr; b: MaskExpr; mode?: "max" | "sum" }
  | { op: "xor"; a: MaskExpr; b: MaskExpr }
  | { op: "subtract"; a: MaskExpr; b: MaskExpr }
  | { op: "invert"; a: MaskExpr }
  | { op: "feather"; a: MaskExpr; radiusMm: number }
  | { op: "grow"; a: MaskExpr; mm: number }
  | { op: "shrink"; a: MaskExpr; mm: number }
  | { op: "remap"; a: MaskExpr; lo: number; hi: number }
  | { op: "threshold"; a: MaskExpr; level: number; softness?: number }
  | { op: "scale"; a: MaskExpr; k: number }
  | { op: "mix"; a: MaskExpr; b: MaskExpr; t: MaskExpr };

/** Every mask op name (sources then combinators), for coverage checks and the docs. */
export const MASK_SOURCES = ["constant", "region", "curvature", "ao", "height", "noise", "pattern", "mark", "direction", "distance", "channel"] as const;
export const MASK_COMBINATORS = ["and", "or", "xor", "subtract", "invert", "feather", "grow", "shrink", "remap", "threshold", "scale", "mix"] as const;

/**
 * Lazily computed per-mesh facts shared by masks, sources and the evaluator (one per mesh;
 * reuse it when evaluating the same mesh many times).
 */
export class MeshFields {
  readonly mesh: MeshData;
  readonly n: number;
  #env?: PatternEnv;
  #adj?: Int32Array[];
  #kappa?: Float32Array;
  #depth?: Float32Array;
  #edge?: number;
  #bodyH?: Float32Array;
  #ringL2?: { l2: Float64Array; median: number };
  /** Grid cell (m) used to normalise curvature/cavity; default = mean edge length. */
  readonly cell: number;

  constructor(mesh: MeshData, opts: { env?: PatternEnv; adj?: Int32Array[]; cell?: number } = {}) {
    this.mesh = mesh;
    this.n = mesh.positions.length / 3;
    this.#env = opts.env;
    this.#adj = opts.adj;
    this.cell = opts.cell && opts.cell > 0 ? opts.cell : this.meanEdge;
  }
  get env(): PatternEnv { return this.#env ??= buildPatternEnv(this.mesh); }
  get adj(): Int32Array[] { return this.#adj ??= vertexRings(this.mesh); }
  get kappa(): Float32Array { return this.#kappa ??= fineCurvature(this.mesh, this.adj, this.cell); }
  get cavity(): Float32Array { return this.#depth ??= cavityDepth(this.mesh, this.adj, this.cell); }
  /** Normalised stature 0 (lowest vertex) .. 1 (highest). */
  get bodyHeight(): Float32Array {
    if (this.#bodyH) return this.#bodyH;
    const P = this.mesh.positions, h = new Float32Array(this.n);
    let y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < this.n; i++) { const y = P[i * 3 + 1]; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const span = Math.max(1e-9, y1 - y0);
    for (let i = 0; i < this.n; i++) h[i] = (P[i * 3 + 1] - y0) / span;
    return this.#bodyH = h;
  }
  /** Mean squared 1-ring edge length per vertex (m²) and its median over vertices with a ring. */
  get ringL2(): { l2: Float64Array; median: number } {
    if (this.#ringL2) return this.#ringL2;
    const adj = this.adj, P = this.mesh.positions, n = this.n;
    const l2 = new Float64Array(n);
    const pos: number[] = [];
    for (let i = 0; i < n; i++) {
      const nb = adj[i];
      let s = 0;
      for (let k = 0; k < nb.length; k++) {
        const j = nb[k];
        const dx = P[j * 3] - P[i * 3], dy = P[j * 3 + 1] - P[i * 3 + 1], dz = P[j * 3 + 2] - P[i * 3 + 2];
        s += dx * dx + dy * dy + dz * dz;
      }
      l2[i] = nb.length > 0 ? s / nb.length : 0;
      if (l2[i] > 0) pos.push(l2[i]);
    }
    pos.sort((a, b) => a - b);
    return this.#ringL2 = { l2, median: pos.length > 0 ? pos[pos.length >> 1] : 0 };
  }
  /** Mean edge length (m) over the triangles (1 cm when the mesh has none). */
  get meanEdge(): number {
    if (this.#edge !== undefined) return this.#edge;
    const P = this.mesh.positions, I = this.mesh.indices;
    let s = 0, c = 0;
    for (let t = 0; t + 2 < I.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = I[t + k] * 3, b = I[t + ((k + 1) % 3)] * 3;
        s += Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]); c++;
      }
    }
    return this.#edge = c > 0 && s > 0 ? s / c : 0.01;
  }
}

/** What a mask may read besides the mesh. */
export interface MaskContext {
  fields: MeshFields;
  marks?: Readonly<Record<string, MarkField>>;
  /** Current value of a channel at vertex i, normalised 0..1 (supplied by the evaluator). */
  channel?: (id: ChannelId, i: number) => number;
  /** Raw height channel (m) at vertex i (for height source "channel"). */
  heightAt?: (i: number) => number;
}

/** Evaluate a mask into `out` (length >= n; allocated when absent). Every value is in [0, 1], never NaN. */
export function evaluateMask(expr: MaskExpr, ctx: MaskContext, out?: Float32Array): Float32Array {
  const f = ctx.fields, n = f.n;
  const o = out && out.length >= n ? out : new Float32Array(n);
  const M = f.mesh, P = M.positions, N = M.normals, R = M.region;
  switch (expr.op) {
    case "constant": { o.fill(sat01(expr.value), 0, n); break; }
    case "region": {
      const want = new Uint8Array(REGIONS.length);
      for (const r of expr.regions ?? []) { const k = REGION_INDEX[r]; if (k !== undefined) want[k] = 1; }
      const side = expr.side === "left" ? 0 : expr.side === "right" ? 1 : -1;
      const cx = f.env.core[0];
      for (let i = 0; i < n; i++) {
        let v = want[R[i]] === 1 ? 1 : 0;
        if (v && side >= 0) v = ((P[i * 3] >= cx ? 0 : 1) === side) ? 1 : 0;
        o[i] = v;
      }
      break;
    }
    case "curvature": {
      const k = f.kappa, sg = expr.sign === "concave" ? -1 : 1;
      const lo = expr.lo ?? 0.28, hi = expr.hi ?? 0.55;
      for (let i = 0; i < n; i++) o[i] = smoothstepSafe(lo, hi, sg * k[i]);
      break;
    }
    case "ao": {
      const d = f.cavity, lo = expr.lo ?? 0.05, hi = expr.hi ?? 0.3;
      for (let i = 0; i < n; i++) o[i] = smoothstepSafe(lo, hi, d[i]);
      break;
    }
    case "height": {
      if (expr.source === "channel") {
        const h = ctx.heightAt;
        for (let i = 0; i < n; i++) o[i] = smoothstepSafe(expr.lo, expr.hi, h ? h(i) : 0);
      } else {
        const h = f.bodyHeight;
        for (let i = 0; i < n; i++) o[i] = smoothstepSafe(expr.lo, expr.hi, h[i]);
      }
      break;
    }
    case "noise": {
      const fn = compileNoise(expr.expr, (expr.seed ?? 0) >>> 0);
      for (let i = 0; i < n; i++) o[i] = sat01(fn(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
      break;
    }
    case "pattern": {
      const pc = makePatternContext({
        name: "mask", pattern: expr.pattern, colour: "#000000", opacity: 1, blend: "normal",
        scale: expr.scale, params: expr.params, seed: expr.seed,
      }, f.env, makeNoise((expr.seed ?? 0) >>> 0));
      const fn = PATTERNS[expr.pattern] ?? PATTERNS.solid;
      const s = { coverage: 0, mix: 0 };
      const which = expr.field ?? "coverage";
      for (let i = 0; i < n; i++) {
        const q = i * 3;
        fn(pc, P[q], P[q + 1], P[q + 2], N[q], N[q + 1], N[q + 2], R[i], s);
        o[i] = sat01(which === "mix" ? s.mix : which === "product" ? s.coverage * s.mix : s.coverage);
      }
      break;
    }
    case "mark": {
      const m = ctx.marks?.[expr.id];
      if (!m) { o.fill(0, 0, n); break; }
      for (let i = 0; i < n; i++) {
        const q = i * 3;
        o[i] = sat01(m(P[q], P[q + 1], P[q + 2], N[q], N[q + 1], N[q + 2], R[i]));
      }
      break;
    }
    case "direction": {
      let [dx, dy, dz] = expr.dir;
      const l = Math.hypot(dx, dy, dz);
      if (!(l > 1e-12)) { dx = 0; dy = 1; dz = 0; } else { dx /= l; dy /= l; dz /= l; }
      const lo = expr.lo ?? 0, hi = expr.hi ?? 1;
      for (let i = 0; i < n; i++) o[i] = smoothstepSafe(lo, hi, N[i * 3] * dx + N[i * 3 + 1] * dy + N[i * 3 + 2] * dz);
      break;
    }
    case "distance": {
      let ax: number, ay: number, az: number;
      if (Array.isArray(expr.anchor)) [ax, ay, az] = expr.anchor as Vec3;
      else {
        const a = expr.anchor as { region: Region; side?: 0 | 1 };
        const k = ((REGION_INDEX[a.region] ?? 0) * 2 + (a.side ?? 0)) * 3;
        ax = f.env.anchors[k]; ay = f.env.anchors[k + 1]; az = f.env.anchors[k + 2];
      }
      const r = Math.max(0, expr.radius || 0), fo = Math.max(0, expr.falloff ?? 0);
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(P[i * 3] - ax, P[i * 3 + 1] - ay, P[i * 3 + 2] - az);
        o[i] = 1 - smoothstepSafe(r, r + fo, d);
      }
      break;
    }
    case "channel": {
      const c = ctx.channel;
      for (let i = 0; i < n; i++) o[i] = sat01(c && isChannelId(expr.channel) ? c(expr.channel, i) : 0);
      break;
    }
    case "and": case "or": case "xor": case "subtract": {
      const a = evaluateMask(expr.a, ctx, o);
      const b = evaluateMask(expr.b, ctx);
      if (expr.op === "and") {
        if (expr.mode === "product") for (let i = 0; i < n; i++) o[i] = a[i] * b[i];
        else for (let i = 0; i < n; i++) o[i] = a[i] < b[i] ? a[i] : b[i];
      } else if (expr.op === "or") {
        if (expr.mode === "sum") for (let i = 0; i < n; i++) o[i] = sat01(a[i] + b[i] - a[i] * b[i]);
        else for (let i = 0; i < n; i++) o[i] = a[i] > b[i] ? a[i] : b[i];
      } else if (expr.op === "xor") for (let i = 0; i < n; i++) o[i] = sat01(a[i] + b[i] - 2 * a[i] * b[i]);
      else for (let i = 0; i < n; i++) o[i] = sat01(a[i] * (1 - b[i]));
      break;
    }
    case "invert": { evaluateMask(expr.a, ctx, o); for (let i = 0; i < n; i++) o[i] = 1 - o[i]; break; }
    case "feather": { evaluateMask(expr.a, ctx, o); featherField(f, o, expr.radiusMm); break; }
    case "grow": { evaluateMask(expr.a, ctx, o); growField(f, o, expr.mm); break; }
    case "shrink": { evaluateMask(expr.a, ctx, o); growField(f, o, -expr.mm); break; }
    case "remap": {
      evaluateMask(expr.a, ctx, o);
      const lo = expr.lo, hi = expr.hi;
      for (let i = 0; i < n; i++) o[i] = hi === lo ? (o[i] >= lo ? 1 : 0) : sat01((o[i] - lo) / (hi - lo));
      break;
    }
    case "threshold": {
      evaluateMask(expr.a, ctx, o);
      const w = Math.abs(expr.softness ?? 0);
      for (let i = 0; i < n; i++) o[i] = smoothstepSafe(expr.level - w, expr.level + w, o[i]);
      break;
    }
    case "scale": { evaluateMask(expr.a, ctx, o); for (let i = 0; i < n; i++) o[i] = sat01(o[i] * expr.k); break; }
    case "mix": {
      const a = evaluateMask(expr.a, ctx, o), b = evaluateMask(expr.b, ctx), t = evaluateMask(expr.t, ctx);
      for (let i = 0; i < n; i++) o[i] = sat01(a[i] + (b[i] - a[i]) * t[i]);
      break;
    }
    default: throw new Error(`evaluateMask: unknown op ${(expr as { op: string }).op}`);
  }
  // Totality: never NaN, always in [0, 1].
  for (let i = 0; i < n; i++) { const v = o[i]; o[i] = v !== v ? 0 : v < 0 ? 0 : v > 1 ? 1 : v; }
  return o;
}

/** Max explicit diffusion steps of a feather (bounds the cost of a huge radius). */
export const FEATHER_MAX_STEPS = 400;

/**
 * Feather in place: Gaussian blur of standard deviation σ = radiusMm / 2 (mm) along the surface, as
 * heat diffusion u_t = Δu for t = σ²/2, explicit Euler with the umbrella Laplacian
 * Δu_i ≈ 4 (mean_j u_j − u_i) / ℓ²_i (ℓ²_i = mean squared 1-ring edge length), dt sized for the median
 * ring, per-step gain capped at ½ (a convex combination: stable, stays in [0, 1]). radius <= 0: identity.
 */
export function featherField(f: MeshFields, u: Float32Array, radiusMm: number): void {
  const sigma = (radiusMm > 0 && Number.isFinite(radiusMm) ? radiusMm : 0) / 2000; // metres
  if (sigma <= 0) return;
  const adj = f.adj, n = f.n;
  const { l2, median } = f.ringL2;
  if (!(median > 0)) return;
  // Each step is a convex combination (gain <= 1/2), so it is stable for any dt; dt is sized for the
  // MEDIAN ring (gain 1/2 there). Rings smaller than the median saturate at gain 1/2 (they diffuse a
  // little less than the exact law; on a uniform grid the law is exact — TX19).
  const T = (sigma * sigma) / 2;
  const dtMax = median / 8;
  const steps = Math.min(FEATHER_MAX_STEPS, Math.max(1, Math.ceil(T / dtMax)));
  const dt = T / steps;
  let a = Float64Array.from(u.subarray(0, n)), b = new Float64Array(n);
  for (let s = 0; s < steps; s++) {
    for (let i = 0; i < n; i++) {
      const nb = adj[i];
      if (nb.length === 0 || l2[i] <= 0) { b[i] = a[i]; continue; }
      let m = 0;
      for (let k = 0; k < nb.length; k++) m += a[nb[k]];
      m /= nb.length;
      const g = Math.min(0.5, (4 * dt) / l2[i]);
      b[i] = a[i] + g * (m - a[i]);
    }
    const t = a; a = b; b = t;
  }
  for (let i = 0; i < n; i++) u[i] = a[i];
}

/** Geodesic (edge-graph) distance from every vertex with seed[i] = 1; Infinity where unreachable. */
export function graphDistance(f: MeshFields, seed: Uint8Array): Float64Array {
  const n = f.n, adj = f.adj, P = f.mesh.positions;
  const d = new Float64Array(n).fill(Infinity);
  // Binary min-heap of (dist, vertex), lazy deletion.
  let hd = new Float64Array(Math.max(16, n)), hv = new Int32Array(Math.max(16, n)), size = 0;
  const push = (dist: number, v: number) => {
    if (size === hd.length) {
      const nd = new Float64Array(size * 2), nv = new Int32Array(size * 2);
      nd.set(hd); nv.set(hv); hd = nd; hv = nv;
    }
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hd[p] <= dist) break;
      hd[i] = hd[p]; hv[i] = hv[p]; i = p;
    }
    hd[i] = dist; hv[i] = v;
  };
  const pop = (): number => {
    const top = hv[0];
    const ld = hd[--size], lv = hv[size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= size) break;
      if (c + 1 < size && hd[c + 1] < hd[c]) c++;
      if (hd[c] >= ld) break;
      hd[i] = hd[c]; hv[i] = hv[c]; i = c;
    }
    hd[i] = ld; hv[i] = lv;
    return top;
  };
  for (let i = 0; i < n; i++) if (seed[i]) { d[i] = 0; push(0, i); }
  while (size > 0) {
    const dist = hd[0], v = pop();
    if (dist > d[v]) continue;
    const nb = adj[v];
    for (let k = 0; k < nb.length; k++) {
      const j = nb[k];
      const nd = dist + Math.hypot(P[j * 3] - P[v * 3], P[j * 3 + 1] - P[v * 3 + 1], P[j * 3 + 2] - P[v * 3 + 2]);
      if (nd < d[j]) { d[j] = nd; push(nd, j); }
    }
  }
  return d;
}

/**
 * Grow (mm > 0) or shrink (mm < 0) a mask in place along the surface: a grey-scale geodesic DILATION
 *   grow_g(u)_i = max(u_i, max_j u_j · ramp(d_ij)),  ramp(d) = sat((g − d)/h + min(1, g/h)),
 * with d_ij the edge-graph distance and h the mean edge length, and its dual EROSION
 *   shrink_g(u) = 1 − grow_g(1 − u).
 * Exact for that law: sources are processed in decreasing value with a shared reach array (a vertex
 * already reached at distance ≤ d by a source of higher-or-equal value dominates everything beyond it).
 * Continuous in g (g → 0 gives the identity on soft masks too), extensive / anti-extensive, monotone in
 * u, grow(−g) = shrink(g). On a binary mask the ½ contour moves by g + h/2 − (h/2) = g (TX19).
 */
export function growField(f: MeshFields, u: Float32Array, mm: number): void {
  if (!(mm !== 0 && Number.isFinite(mm))) return;
  const n = f.n;
  if (mm < 0) {
    for (let i = 0; i < n; i++) u[i] = 1 - u[i];
    dilate(f, u, -mm / 1000);
    for (let i = 0; i < n; i++) u[i] = 1 - u[i];
  } else dilate(f, u, mm / 1000);
}

function dilate(f: MeshFields, u: Float32Array, g: number): void {
  const n = f.n, adj = f.adj, P = f.mesh.positions, h = f.meanEdge;
  const lift = Math.min(1, g / h), cutoff = g + h * lift;
  const src = Float64Array.from(u.subarray(0, n));
  const order: number[] = [];
  for (let i = 0; i < n; i++) if (src[i] > 0) order.push(i);
  order.sort((a, b) => src[b] - src[a] || a - b);
  const reach = new Float64Array(n).fill(Infinity);
  let hd = new Float64Array(64), hv = new Int32Array(64), size = 0;
  const push = (dist: number, v: number) => {
    if (size === hd.length) { const nd = new Float64Array(size * 2), nv = new Int32Array(size * 2); nd.set(hd); nv.set(hv); hd = nd; hv = nv; }
    let i = size++;
    while (i > 0) { const p = (i - 1) >> 1; if (hd[p] <= dist) break; hd[i] = hd[p]; hv[i] = hv[p]; i = p; }
    hd[i] = dist; hv[i] = v;
  };
  const pop = (): number => {
    const top = hv[0], ld = hd[--size], lv = hv[size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= size) break;
      if (c + 1 < size && hd[c + 1] < hd[c]) c++;
      if (hd[c] >= ld) break;
      hd[i] = hd[c]; hv[i] = hv[c]; i = c;
    }
    hd[i] = ld; hv[i] = lv;
    return top;
  };
  for (const s of order) {
    if (reach[s] <= 0) continue; // an equal-or-higher source already sits here
    const val = src[s];
    reach[s] = 0; size = 0; push(0, s);
    while (size > 0) {
      const d = hd[0], v = pop();
      if (d > reach[v]) continue;
      let r = (g - d) / h + lift;
      r = r < 0 ? 0 : r > 1 ? 1 : r;
      const c = val * r;
      if (c > u[v]) u[v] = c;
      const nb = adj[v];
      for (let k = 0; k < nb.length; k++) {
        const j = nb[k];
        const nd = d + Math.hypot(P[j * 3] - P[v * 3], P[j * 3 + 1] - P[v * 3 + 1], P[j * 3 + 2] - P[v * 3 + 2]);
        if (nd < reach[j] && nd < cutoff) { reach[j] = nd; push(nd, j); }
      }
    }
  }
}
