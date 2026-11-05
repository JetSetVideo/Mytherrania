// Evaluate (wave TEX, contract C-MAT): run a v2 LayerStack over a mesh.
//   per-vertex pass  -> `albedo` (LINEAR RGB, the `color` attribute, exactly paintVertices' output for a
//                       v1-equivalent stack), `material` (aMaterial vec4: roughness, height m, ao,
//                       subsurface; Channels.MATERIAL_LAYOUT), `emissive` (aEmissive, only when written)
//                       and one array per named mask channel;
//   fragment list    -> every enabled layer with stage "fragment" (scars, tattoos, fine noise), with
//                       its effective opacity through its groups, for lane R's decal block (FragmentDecal,
//                       packDecals) — lane M turns the mark ids into decals.
// Canvases are Float32Array (the v1 canvas type, so the v1 path rounds exactly as paintVertices does).
// The root canvas is opaque: r = b + (B(b, s) − b) a (Operators.compositeOpaque). A group composites its
// children on an isolated transparent canvas (W3C source-over with backdrop alpha), then lands on its
// parent with its blend op, opacity and mask. Per-vertex loops allocate nothing.

import type { MeshData } from "../body/contracts.ts";
import { hexToLinear, hexToRgb, srgbToLinear } from "./Blend.ts";
import { ALBEDO_DEFAULT_SRGB, type ChannelId, channelSpec, type ChannelSpec, isChannelId, isMaskChannel, MATERIAL_LAYOUT } from "./Channels.ts";
import { evaluateMask, type MarkField, type MaskContext, MeshFields } from "./MaskAlgebra.ts";
import { makeNoise, type NoiseField } from "./Noise.ts";
import { compileNoise } from "./NoiseAlgebra.ts";
import {
  blendRgb, blendRgbLinear, blendSeparable, colorModeCode, compositeOver, FIRST_NON_SEPARABLE, lum, overAlpha,
  SCALAR_OP_DEFAULTS, type ScalarOp, scalarComposite, scalarOpCode, sat01, smoothstepSafe,
} from "./Operators.ts";
import { makePatternContext, PATTERNS, type PatternEnv, type PatternFn, REGION_INDEX } from "./Patterns.ts";
import { type ChannelWrite, type Layer, type LayerGroup, type LayerSource, type LayerStackV2, sortedNodes, type StackNode } from "./LayerStack.ts";
import type { PatternContext, PatternSample } from "./Patterns.ts";

/** Options of evaluateStack (all optional). */
export interface EvaluateOptions {
  /** Colour space of `albedo` (default "linear", like paintVertices). */
  space?: "linear" | "srgb";
  /** Overrides stack.background (default "#808080"). */
  background?: string;
  /** Per-mesh facts (reuse when evaluating one mesh many times). */
  fields?: MeshFields;
  /** Pattern env (shortcut when no `fields`). */
  env?: PatternEnv;
  /** Vertex-level coverage per mark id (lane M). Missing ids read 0. */
  marks?: Readonly<Record<string, MarkField>>;
  /** Reuse these output arrays when long enough. */
  out?: { albedo?: Float32Array; material?: Float32Array };
  /** Timing record (ms) for the bench. */
  record?: { ms?: number; layers?: number; vertices?: number };
}

/** A layer handed to the fragment stage. */
export interface FragmentLayer {
  id: string;
  name: string;
  /** Mark id when the source is a mark (lane M -> FragmentDecal). */
  markId?: string;
  source: LayerSource;
  writes: ChannelWrite[];
  /** Layer opacity x every enclosing group's opacity (0..1). */
  opacity: number;
  /** Enclosing group ids, outermost first. */
  path: string[];
}

/** What evaluateStack returns. */
export interface MaterialBuffers {
  /** RGB per vertex (3n), linear unless options.space = "srgb". */
  albedo: Float32Array;
  /** aMaterial per vertex (4n): roughness, height (m), ao, subsurface. */
  material: Float32Array;
  /** aEmissive per vertex (3n, linear) when any evaluated layer wrote emissive. */
  emissive?: Float32Array;
  /** One array (n) per mask channel written, keyed by name without "mask:". */
  masks: Record<string, Float32Array>;
  /** Channels written by at least one evaluated (enabled, vertex-stage) layer. */
  written: ChannelId[];
  fragment: FragmentLayer[];
}

// ---------------------------------------------------------------------------------------
// Canvases.

interface Plane {
  spec: ChannelSpec;
  /** Components per vertex (3 rgb, 1 scalar). */
  k: number;
  /** Values, k per vertex. */
  v: Float32Array;
  /** Coverage per vertex (isolated group canvases only; null = opaque). */
  a: Float32Array | null;
}

class Canvas {
  readonly planes = new Map<ChannelId, Plane>();
  constructor(readonly n: number, readonly opaque: boolean, readonly albedoBg: readonly [number, number, number]) {}
  plane(id: ChannelId): Plane {
    let p = this.planes.get(id);
    if (p) return p;
    const spec = channelSpec(id), k = spec.kind === "rgb" ? 3 : 1;
    const v = new Float32Array(this.n * k);
    const def = id === "albedo" ? this.albedoBg : spec.default;
    if (typeof def === "number") v.fill(def);
    else for (let i = 0; i < this.n; i++) { v[i * 3] = def[0]; v[i * 3 + 1] = def[1]; v[i * 3 + 2] = def[2]; }
    p = { spec, k, v, a: this.opaque ? null : new Float32Array(this.n) };
    this.planes.set(id, p);
    return p;
  }
}

// ---------------------------------------------------------------------------------------
// Sources.

interface SourceSampler {
  sample(i: number, out: PatternSample): void;
}

function fieldValue(f: MeshFields, field: string): (i: number) => number {
  const N = f.mesh.normals;
  switch (field) {
    case "curvature": { const k = f.kappa; return (i) => sat01(0.5 + 0.5 * k[i]); }
    case "convex": { const k = f.kappa; return (i) => smoothstepSafe(0.28, 0.55, k[i]); }
    case "concave": { const k = f.kappa; return (i) => smoothstepSafe(0.28, 0.55, -k[i]); }
    case "cavity": { const d = f.cavity; return (i) => smoothstepSafe(0.05, 0.3, d[i]); }
    case "bodyHeight": { const h = f.bodyHeight; return (i) => h[i]; }
    case "up": return (i) => sat01(0.5 + 0.5 * N[i * 3 + 1]);
    default: return () => 0;
  }
}

function makeSampler(src: LayerSource, f: MeshFields, marks: EvaluateOptions["marks"], noiseBySeed: Map<number, NoiseField>): SourceSampler {
  const M = f.mesh, P = M.positions, N = M.normals, R = M.region;
  switch (src.kind) {
    case "pattern": {
      const seed = (src.seed ?? 0) >>> 0;
      let noise = noiseBySeed.get(seed);
      if (!noise) { noise = makeNoise(seed); noiseBySeed.set(seed, noise); }
      const ctx: PatternContext = makePatternContext({
        name: "", pattern: src.pattern, colour: "#000000", opacity: 1, blend: "normal",
        scale: src.scale, params: src.params, seed: src.seed,
      }, f.env, noise);
      const fn: PatternFn = PATTERNS[src.pattern] ?? PATTERNS.solid;
      return { sample(i, out) { const o = i * 3; fn(ctx, P[o], P[o + 1], P[o + 2], N[o], N[o + 1], N[o + 2], R[i], out); } };
    }
    case "noise": {
      const fn = compileNoise(src.expr, (src.seed ?? 0) >>> 0);
      return { sample(i, out) { const o = i * 3; out.coverage = 1; out.mix = sat01(fn(P[o], P[o + 1], P[o + 2])); } };
    }
    case "field": {
      const g = fieldValue(f, src.field);
      return { sample(i, out) { out.coverage = 1; out.mix = sat01(g(i)); } };
    }
    case "mark": {
      const m = marks?.[src.id];
      if (!m) return { sample(_i, out) { out.coverage = 0; out.mix = 0; } };
      return {
        sample(i, out) {
          const o = i * 3;
          const c = sat01(m(P[o], P[o + 1], P[o + 2], N[o], N[o + 1], N[o + 2], R[i]));
          out.coverage = c; out.mix = c;
        },
      };
    }
    default: {
      const t = sat01((src as { value?: number }).value ?? 0);
      return { sample(_i, out) { out.coverage = 1; out.mix = t; } };
    }
  }
}

// ---------------------------------------------------------------------------------------
// Compiled writes.

interface CompiledWrite {
  plane: Plane;
  rgb: boolean;
  code: number;
  linear: boolean;
  c1: Float64Array; // rgb ends (sRGB for albedo, linear for emissive)
  c2: Float64Array;
  v1: number; v2: number;
  op: number;
  p: Float64Array;
  lo: number; hi: number;
  wop: number;
}

function compileWrite(w: ChannelWrite, canvas: Canvas): CompiledWrite | null {
  let spec: ChannelSpec;
  try { spec = channelSpec(w.channel); } catch { return null; }
  const plane = canvas.plane(w.channel);
  const rgb = spec.kind === "rgb";
  const c1 = new Float64Array(3), c2 = new Float64Array(3);
  if (rgb) {
    const parse = spec.space === "linear" ? hexToLinear : hexToRgb;
    const a = parse(w.colour ?? "#808080"), b = parse(w.colour2 ?? w.colour ?? "#808080");
    c1.set(a); c2.set(b);
  }
  const op = scalarOpCode(w.op);
  const def = SCALAR_OP_DEFAULTS[w.op as ScalarOp] ?? [0, 0, 0, 0];
  const p = new Float64Array(4);
  for (let k = 0; k < 4; k++) { const v = w.params?.[k]; p[k] = typeof v === "number" && Number.isFinite(v) ? v : def[k]; }
  const v1 = Number.isFinite(w.value) ? w.value as number : 0;
  const v2 = Number.isFinite(w.value2) ? w.value2 as number : v1;
  const wo = w.opacity === undefined ? 1 : w.opacity;
  return {
    plane, rgb, code: colorModeCode(w.op), linear: w.space === "linear" && w.channel === "albedo",
    c1, c2, v1, v2, op, p, lo: spec.range[0], hi: spec.range[1],
    wop: wo !== wo ? 0 : wo < 0 ? 0 : wo > 1 ? 1 : wo,
  };
}

const BL = new Float64Array(3);

/** Composite one write at vertex i with alpha a (> 0) and source t. */
function applyWrite(cw: CompiledWrite, i: number, a: number, t: number): void {
  const pl = cw.plane, v = pl.v;
  if (cw.rgb) {
    const o = i * 3;
    const s0 = cw.c1[0] + (cw.c2[0] - cw.c1[0]) * t;
    const s1 = cw.c1[1] + (cw.c2[1] - cw.c1[1]) * t;
    const s2 = cw.c1[2] + (cw.c2[2] - cw.c1[2]) * t;
    const b0 = v[o], b1 = v[o + 1], b2 = v[o + 2];
    if (cw.linear) blendRgbLinear(cw.code, b0, b1, b2, s0, s1, s2, BL, 0);
    else if (cw.code >= FIRST_NON_SEPARABLE) blendRgb(cw.code, b0, b1, b2, s0, s1, s2, BL, 0);
    else { BL[0] = blendSeparable(cw.code, b0, s0); BL[1] = blendSeparable(cw.code, b1, s1); BL[2] = blendSeparable(cw.code, b2, s2); }
    if (pl.a === null) {
      // The v1 expression, bit for bit: base + (blend - base) * alpha.
      v[o] = b0 + (BL[0] - b0) * a;
      v[o + 1] = b1 + (BL[1] - b1) * a;
      v[o + 2] = b2 + (BL[2] - b2) * a;
    } else {
      const ab = pl.a[i];
      v[o] = compositeOver(b0, ab, s0, BL[0], a);
      v[o + 1] = compositeOver(b1, ab, s1, BL[1], a);
      v[o + 2] = compositeOver(b2, ab, s2, BL[2], a);
      pl.a[i] = overAlpha(a, ab);
    }
    return;
  }
  const s = cw.v1 + (cw.v2 - cw.v1) * t, b = v[i], P = cw.p;
  if (pl.a === null) v[i] = scalarComposite(cw.op, b, s, a, P[0], P[1], P[2], P[3], cw.lo, cw.hi);
  else {
    const ab = pl.a[i];
    const B = scalarComposite(cw.op, b, s, 1, P[0], P[1], P[2], P[3], cw.lo, cw.hi);
    const r = compositeOver(b, ab, s, B, a);
    v[i] = r < cw.lo ? cw.lo : r > cw.hi ? cw.hi : r;
    pl.a[i] = overAlpha(a, ab);
  }
}

// ---------------------------------------------------------------------------------------
// Stack walk.

interface Walk {
  f: MeshFields;
  marks: EvaluateOptions["marks"];
  noiseBySeed: Map<number, NoiseField>;
  root: Canvas;
  maskCtx: MaskContext;
  fragment: FragmentLayer[];
  written: Set<ChannelId>;
  layers: number;
}

function regionGate(regions: readonly string[] | undefined): Uint8Array | null {
  if (!regions || regions.length === 0) return null;
  const g = new Uint8Array(32);
  for (const r of regions) { const k = (REGION_INDEX as Record<string, number>)[r]; if (k !== undefined) g[k] = 1; }
  return g;
}

function clampOpacity(o: number): number {
  return o !== o ? 0 : Math.max(0, Math.min(1, o));
}

function applyLayer(layer: Layer, canvas: Canvas, w: Walk): void {
  const opacity = clampOpacity(layer.opacity);
  if (opacity <= 0 || layer.writes.length === 0) return;
  const writes: CompiledWrite[] = [];
  for (const wr of layer.writes) { const c = compileWrite(wr, canvas); if (c) { writes.push(c); w.written.add(wr.channel); } }
  if (writes.length === 0) return;
  w.layers++;
  const gate = regionGate(layer.regions);
  const mask = layer.mask ? evaluateMask(layer.mask, w.maskCtx) : null;
  const sampler = makeSampler(layer.source, w.f, w.marks, w.noiseBySeed);
  const sample: PatternSample = { coverage: 0, mix: 0 };
  const R = w.f.mesh.region, n = w.f.n, nw = writes.length;
  for (let i = 0; i < n; i++) {
    if (gate !== null && gate[R[i]] !== 1) continue;
    sampler.sample(i, sample);
    let alpha = opacity * sample.coverage;
    if (mask !== null) alpha *= mask[i];
    if (!(alpha > 0)) continue;
    const t = sample.mix;
    for (let k = 0; k < nw; k++) {
      const cw = writes[k];
      const a = cw.wop === 1 ? alpha : alpha * cw.wop;
      if (a > 0) applyWrite(cw, i, a, t);
    }
  }
}

function collectFragments(node: StackNode, w: Walk, opacity: number, path: string[]): void {
  if (!node.enabled) return;
  const o = opacity * clampOpacity(node.opacity);
  if (node.kind === "group") { for (const c of sortedNodes(node.children)) collectFragments(c, w, o, [...path, node.id]); return; }
  if (node.stage !== "fragment" || o <= 0) return;
  w.fragment.push({
    id: node.id, name: node.name, markId: node.source.kind === "mark" ? node.source.id : undefined,
    source: node.source, writes: node.writes, opacity: o, path,
  });
}

function applyNodes(nodes: readonly StackNode[], canvas: Canvas, w: Walk): void {
  for (const node of sortedNodes(nodes)) {
    if (!node.enabled) continue;
    if (node.kind === "layer") { if (node.stage !== "fragment") applyLayer(node, canvas, w); }
    else applyGroup(node, canvas, w);
  }
}

function applyGroup(g: LayerGroup, parent: Canvas, w: Walk): void {
  const opacity = clampOpacity(g.opacity);
  if (opacity <= 0) return;
  const iso = new Canvas(w.f.n, false, parent.albedoBg);
  applyNodes(g.children, iso, w);
  if (iso.planes.size === 0) return;
  const gate = regionGate(g.regions);
  const mask = g.mask ? evaluateMask(g.mask, w.maskCtx) : null;
  const R = w.f.mesh.region, n = w.f.n;
  for (const [id, src] of iso.planes) {
    const rgb = src.k === 3;
    const op = g.blend?.[id] ?? (rgb ? "normal" : "replace");
    const cw = compileWrite({ channel: id, op }, parent);
    if (!cw) continue;
    const sv = src.v, sa = src.a as Float32Array;
    for (let i = 0; i < n; i++) {
      if (gate !== null && gate[R[i]] !== 1) continue;
      let a = opacity * sa[i];
      if (mask !== null) a *= mask[i];
      if (!(a > 0)) continue;
      // The group's colour is the composited child colour: feed it as both ends (t irrelevant).
      if (rgb) { const o = i * 3; cw.c1[0] = cw.c2[0] = sv[o]; cw.c1[1] = cw.c2[1] = sv[o + 1]; cw.c1[2] = cw.c2[2] = sv[o + 2]; }
      else { cw.v1 = cw.v2 = sv[i]; }
      applyWrite(cw, i, a, 0);
    }
  }
}

/**
 * Evaluate a v2 stack over a mesh. Deterministic (same mesh, stack, options -> same bits).
 * Channels no layer writes keep their defaults (Channels.CHANNEL_SPECS), so an albedo-only stack
 * gives aMaterial = (0.5, 0, 1, 0) — R's neutral, the pre-TEX look.
 */
export function evaluateStack(mesh: MeshData, stack: LayerStackV2, options: EvaluateOptions = {}): MaterialBuffers {
  const t0 = performance.now();
  const n = mesh.positions.length / 3;
  const f = options.fields ?? new MeshFields(mesh, { env: options.env });
  const bgHex = options.background ?? stack.background ?? "#808080";
  const bg = hexToRgb(bgHex);
  const root = new Canvas(n, true, [bg[0], bg[1], bg[2]]);
  const albedoOut = options.out?.albedo && options.out.albedo.length >= n * 3 ? options.out.albedo : undefined;
  // The albedo plane is always present (the v1 canvas). Reuse the caller's array as the canvas itself.
  if (albedoOut) {
    for (let i = 0; i < n; i++) { albedoOut[i * 3] = bg[0]; albedoOut[i * 3 + 1] = bg[1]; albedoOut[i * 3 + 2] = bg[2]; }
    root.planes.set("albedo", { spec: channelSpec("albedo"), k: 3, v: albedoOut, a: null });
  } else root.plane("albedo");
  const readScalar = (id: ChannelId, i: number): number => {
    if (!isChannelId(id)) return 0; // total on hostile JSON (an unknown channel reads 0)
    const p = root.planes.get(id);
    if (id === "albedo") { const v = root.plane("albedo").v; return lum(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]); }
    const spec = channelSpec(id);
    if (!p) { const d = spec.default; return typeof d === "number" ? (d - spec.range[0]) / (spec.range[1] - spec.range[0]) : lum(d[0], d[1], d[2]); }
    if (p.k === 3) return lum(p.v[i * 3], p.v[i * 3 + 1], p.v[i * 3 + 2]);
    return (p.v[i] - spec.range[0]) / (spec.range[1] - spec.range[0]);
  };
  const w: Walk = {
    f, marks: options.marks, noiseBySeed: new Map(), root, fragment: [], written: new Set(), layers: 0,
    maskCtx: {
      fields: f, marks: options.marks, channel: readScalar,
      heightAt: (i) => root.planes.get("height")?.v[i] ?? 0,
    },
  };
  applyNodes(stack.nodes, root, w);
  for (const node of sortedNodes(stack.nodes)) collectFragments(node, w, 1, []);

  const albedo = root.plane("albedo").v;
  if ((options.space ?? "linear") === "linear") for (let i = 0; i < n * 3; i++) albedo[i] = srgbToLinear(albedo[i]);
  const material = options.out?.material && options.out.material.length >= n * 4 ? options.out.material : new Float32Array(n * 4);
  for (let c = 0; c < 4; c++) {
    const id = MATERIAL_LAYOUT[c];
    const p = root.planes.get(id);
    const def = channelSpec(id).default as number;
    for (let i = 0; i < n; i++) material[i * 4 + c] = p ? p.v[i] : def;
  }
  const masks: Record<string, Float32Array> = {};
  for (const [id, p] of root.planes) if (isMaskChannel(id)) masks[id.slice(5)] = p.v;
  const emissive = root.planes.get("emissive")?.v;
  if (options.record) { options.record.ms = performance.now() - t0; options.record.layers = w.layers; options.record.vertices = n; }
  return { albedo, material, emissive, masks, written: [...w.written], fragment: w.fragment };
}

/** sRGB mid-grey canvas value (re-exported for tests/docs). */
export const DEFAULT_ALBEDO_SRGB = ALBEDO_DEFAULT_SRGB;
