// LayerStack (wave TEX, contract C-MAT): the v2 multi-channel layer stack — layers, isolated groups,
// per-channel writes, enable/opacity/order — plus the v1 adapter (stackFromV1) and the creator's
// overrides (applyLayerOverrides, lane U). Pure data + pure functions; evaluation is Evaluate.ts.
//
// A LAYER samples its SOURCE once per vertex into (coverage, t):
//   coverage  0..1, multiplies the layer alpha (a v1 pattern's coverage; 1 for constants/noise/fields);
//   t         0..1, where each write's value sits between its two ends (colour -> colour2, value -> value2).
// alpha = clamp01(opacity) x coverage x mask (x the write's own opacity), and every ChannelWrite composites
// its value onto its channel with its operator (Operators.ts). So one layer can darken albedo, lower
// roughness and raise height at once (a scar).
// A GROUP composites its children onto an ISOLATED transparent canvas (W3C §5.2 / Photoshop group
// semantics), then blends that canvas onto its parent with its own opacity, mask and per-channel op.
// Siblings evaluate bottom first, sorted stably by `order ?? array index`.

import type { BlendMode, PaintStack, PatternKind, Region } from "../body/contracts.ts";
import { type ChannelId, isChannelId } from "./Channels.ts";
import type { MaskExpr } from "./MaskAlgebra.ts";
import type { NoiseExpr } from "./NoiseAlgebra.ts";
import { COLOR_BLEND_MODES, type OperatorId, SCALAR_OPS } from "./Operators.ts";

/** Derived per-vertex fields a source may read. */
export const SOURCE_FIELDS = ["curvature", "convex", "concave", "cavity", "bodyHeight", "up"] as const;
export type SourceField = typeof SOURCE_FIELDS[number];

/** Where a layer's (coverage, t) comes from. */
export type LayerSource =
  /** coverage 1, t = clamp01(value ?? 0). */
  | { kind: "constant"; value?: number }
  /** A v1 pattern (Patterns.ts): coverage and t = mix, exactly as paintVertices samples it. */
  | { kind: "pattern"; pattern: PatternKind; scale: number; params?: Record<string, number>; seed?: number }
  /** A NoiseAlgebra expression at the bind-pose position: coverage 1, t = clamp01(expr). */
  | { kind: "noise"; expr: NoiseExpr; seed?: number }
  /** A mesh-derived field: coverage 1, t = the field 0..1 (see Evaluate.ts fieldValue). */
  | { kind: "field"; field: SourceField }
  /** A mark (scar/tattoo, lane M) by id: coverage c = its vertex-level coverage, t = c. */
  | { kind: "mark"; id: string };

/** One channel a layer writes, with its operator and value ends. */
export interface ChannelWrite {
  channel: ChannelId;
  /** Colour blend mode for rgb channels, scalar op for scalar channels (Operators.ts). */
  op: OperatorId;
  /** rgb channels: "#rrggbb" ends (colour2 defaults to colour; colour defaults to #808080). */
  colour?: string;
  colour2?: string;
  /** scalar channels: value ends in channel units (value2 defaults to value; value defaults to 0). */
  value?: number;
  value2?: number;
  /** Extra per-write opacity multiplier 0..1 (default 1). */
  opacity?: number;
  /** Op parameters p0..p3 (Operators.SCALAR_OP_DEFAULTS when absent). */
  params?: readonly number[];
  /** albedo only: blend in sRGB (default, the reference) or linear light. */
  space?: "srgb" | "linear";
}

interface NodeBase {
  /** Stable id (unique in the stack): what the UI and the overrides address. */
  id: string;
  name: string;
  enabled: boolean;
  /** 0..1 (NaN reads as 0). */
  opacity: number;
  /** Sort key among siblings (default: array index). */
  order?: number;
  /** Mask expression (absent = 1 everywhere). */
  mask?: MaskExpr;
  /** Region shortcut (as v1): only these regions (all when absent/empty). */
  regions?: Region[];
}

/** A paint layer. */
export interface Layer extends NodeBase {
  kind: "layer";
  source: LayerSource;
  writes: ChannelWrite[];
  /** "fragment": not evaluated per vertex, handed to the shader's decal list (fine marks). Default "vertex". */
  stage?: "vertex" | "fragment";
}

/** An isolated group. */
export interface LayerGroup extends NodeBase {
  kind: "group";
  children: StackNode[];
  /** How the composited group lands on each channel (default normal / replace). */
  blend?: Partial<Record<ChannelId, OperatorId>>;
}

export type StackNode = Layer | LayerGroup;

/** A v2 stack, bottom first. */
export interface LayerStackV2 {
  version: 2;
  nodes: StackNode[];
  /** Albedo canvas under the first layer, "#rrggbb" sRGB (default #808080 = v1). */
  background?: string;
}

/** Creator override of one node (lane U, appearance.layerOverrides). */
export interface LayerOverride {
  id: string;
  enabled?: boolean;
  opacity?: number;
  /** Per-channel operator: replaces the op of the node's writes on that channel (groups: their blend). */
  blend?: Partial<Record<ChannelId, OperatorId>>;
  /** New index among the node's siblings. */
  order?: number;
}

/** Colour ops allowed on rgb channels / scalar ops on scalar channels (for the UI pickers). */
export const COLOR_OPS: readonly OperatorId[] = [...COLOR_BLEND_MODES, "linearDodge"];
export const SCALAR_OP_IDS: readonly OperatorId[] = SCALAR_OPS;

/** Siblings in evaluation order: stable sort by (order ?? index). Returns a new array. */
export function sortedNodes(nodes: readonly StackNode[]): StackNode[] {
  return nodes
    .map((node, i) => ({ node, key: Number.isFinite(node.order) ? node.order as number : i, i }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map((e) => e.node);
}

/** Every node of a stack, depth first (groups before their children). */
export function allNodes(stack: LayerStackV2): StackNode[] {
  const out: StackNode[] = [];
  const walk = (ns: readonly StackNode[]) => { for (const n of ns) { out.push(n); if (n.kind === "group") walk(n.children); } };
  walk(stack.nodes);
  return out;
}

/** Find a node by id (depth first), or undefined. */
export function findNode(stack: LayerStackV2, id: string): StackNode | undefined {
  return allNodes(stack).find((n) => n.id === id);
}

/** Every channel a stack can write (enabled or not), in first-write order. */
export function channelsWritten(stack: LayerStackV2): ChannelId[] {
  const s = new Set<ChannelId>();
  for (const n of allNodes(stack)) if (n.kind === "layer") for (const w of n.writes) s.add(w.channel);
  return [...s];
}

/** Problems that make a stack ill-formed (duplicate ids, unknown channels/ops); [] when valid. */
export function validateStack(stack: LayerStackV2): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  const colour = new Set<string>(COLOR_OPS), scalar = new Set<string>(SCALAR_OPS);
  for (const n of allNodes(stack)) {
    if (seen.has(n.id)) issues.push(`duplicate id ${n.id}`);
    seen.add(n.id);
    if (n.kind === "layer") {
      for (const w of n.writes) {
        if (!isChannelId(w.channel)) issues.push(`${n.id}: unknown channel ${w.channel}`);
        const rgb = w.channel === "albedo" || w.channel === "emissive";
        if (rgb ? !colour.has(w.op) : !scalar.has(w.op)) issues.push(`${n.id}: op ${w.op} not valid on ${w.channel}`);
      }
    }
  }
  return issues;
}

/**
 * The v2 equivalent of a v1 PaintStack: one pattern layer per v1 layer writing albedo with the same
 * blend mode, colours, opacity, regions and seed (ids "v1-<index>"). evaluateStack(stackFromV1(s))
 * albedo is byte-identical to paintVertices(s) (tests/wave_tex_layers_test.ts).
 */
export function stackFromV1(v1: PaintStack, background?: string): LayerStackV2 {
  return {
    version: 2,
    background,
    nodes: v1.layers.map((l, i): Layer => ({
      kind: "layer", id: `v1-${i}`, name: l.name, enabled: true, opacity: l.opacity,
      regions: l.regions ? [...l.regions] : undefined,
      source: { kind: "pattern", pattern: l.pattern, scale: l.scale, params: l.params ? { ...l.params } : undefined, seed: l.seed },
      writes: [{ channel: "albedo", op: l.blend as BlendMode, colour: l.colour, colour2: l.colour2 }],
    })),
  };
}

/** Deep copy (JSON-safe stacks: every field is plain data). */
export function cloneStack(stack: LayerStackV2): LayerStackV2 {
  return structuredClone(stack);
}

/**
 * Apply creator overrides (lane U): returns a NEW stack; unknown ids are ignored; total (NaN opacity
 * ignored, opacity clamped 0..1). `order` moves the node to that index among its siblings.
 */
export function applyLayerOverrides(stack: LayerStackV2, overrides: readonly LayerOverride[] | undefined): LayerStackV2 {
  const out = cloneStack(stack);
  if (!overrides || overrides.length === 0) return out;
  const byId = new Map<string, LayerOverride>();
  for (const o of overrides) if (o && typeof o.id === "string") byId.set(o.id, { ...byId.get(o.id), ...o });
  const visit = (siblings: StackNode[]): StackNode[] => {
    const ordered = sortedNodes(siblings);
    const movedSet = new Set<StackNode>();
    ordered.forEach((n, idx) => {
      const ov = byId.get(n.id);
      if (n.kind === "group") n.children = visit(n.children);
      if (!ov) return;
      if (typeof ov.enabled === "boolean") n.enabled = ov.enabled;
      if (typeof ov.opacity === "number" && Number.isFinite(ov.opacity)) n.opacity = Math.max(0, Math.min(1, ov.opacity));
      if (ov.blend) {
        for (const [ch, op] of Object.entries(ov.blend) as [ChannelId, OperatorId][]) {
          if (!op) continue;
          if (n.kind === "layer") { for (const w of n.writes) if (w.channel === ch) w.op = op; }
          else n.blend = { ...(n.blend ?? {}), [ch]: op };
        }
      }
      if (typeof ov.order === "number" && Number.isFinite(ov.order) && ov.order !== idx) {
        n.order = ov.order < idx ? ov.order - 0.5 : ov.order + 0.5;
        movedSet.add(n);
      }
    });
    if (movedSet.size === 0) return ordered;
    // Unmoved siblings keep their current index as key; moved ones sit half a slot before/after the
    // index they asked for. Then re-number so later overrides and the UI see plain indices.
    const keyed = ordered.map((n, i) => (movedSet.has(n) ? n : { ...n, order: i }) as StackNode);
    return sortedNodes(keyed).map((n, i) => ({ ...n, order: i }) as StackNode);
  };
  out.nodes = visit(out.nodes);
  return out;
}
