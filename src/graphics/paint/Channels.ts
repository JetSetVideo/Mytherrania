// Channels (wave TEX, contract C-MAT): the material channels a v2 layer stack writes, each with
// its range, default (the canvas before any layer), neutral element (the value at which the
// renderer reproduces the pre-TEX look) and storage (per-vertex attribute vs per-fragment).
// Pure module: no THREE, no DOM.
//
// Vocabulary:
//   albedo      base colour. The stack composites it in sRGB (the Photoshop / W3C reference
//               space, as v1 Layers.ts does) and the evaluator returns LINEAR RGB (three.js
//               vertex colours), exactly like paintVertices.
//   roughness   0 glossy .. 1 matte (scalar).
//   height      signed metres of relief along the normal (> 0 raised, < 0 sunken); the shader
//               turns it into a perturbed normal (owner R).
//   ao          0..1 baked occlusion MULTIPLIER (1 = unoccluded = neutral).
//   subsurface  0..1 warmth of thin skin (ears, lips); 0 = neutral (no wrap).
//   emissive    linear RGB added after lighting (runes, embers); black = neutral.
//   mask:<name> named scalar masks 0..1 (e.g. "mask:scar" = where a scar sits, read later by hair).
//
// Storage: the evaluator writes per-vertex attributes `color` (albedo, 3 floats) and
// `aMaterial` (4 floats: roughness, height, ao, subsurface — MATERIAL_LAYOUT), `aEmissive`
// (3 floats, only when a layer writes emissive) and one Float32Array per named mask. Fine marks
// (scars, tattoos, fine noise) are handed to the shader as a fragment layer list (Evaluate.ts).

/** The fixed (non-mask) channel ids. */
export const BASE_CHANNELS = ["albedo", "roughness", "height", "ao", "subsurface", "emissive"] as const;
export type BaseChannelId = typeof BASE_CHANNELS[number];
/** A named scalar mask channel: "mask:<name>" (name = [A-Za-z0-9_-]+). */
export type MaskChannelId = `mask:${string}`;
/** Any channel a layer can write. */
export type ChannelId = BaseChannelId | MaskChannelId;

/** "rgb" channels take colour blend modes, "scalar" channels take scalar ops. */
export type ChannelKind = "rgb" | "scalar";
/** Where the value lives at render time. */
export type ChannelStorage = "vertex" | "fragment" | "vertex+fragment";

/** Declaration of one channel. */
export interface ChannelSpec {
  id: ChannelId;
  kind: ChannelKind;
  /** Closed range every evaluated value is clamped to (per component for rgb). */
  range: readonly [number, number];
  /** Canvas value before the first layer (rgb: per component; albedo default is the v1 #808080 in sRGB). */
  default: number | readonly [number, number, number];
  /** Value at which the renderer reproduces the pre-TEX look (contract with R). */
  neutral: number | readonly [number, number, number];
  /** Space the stack composites in (albedo: sRGB like v1; emissive: linear). */
  space: "srgb" | "linear" | "scalar";
  storage: ChannelStorage;
  /** Vertex attribute name and component offset that carry the channel. */
  attribute: string;
  component: number;
  /** One line for docs / the UI tooltip. */
  doc: string;
}

/** Height range (metres): ±8 mm covers keloids (+3 mm) and atrophic scars (−2 mm) with headroom. */
export const HEIGHT_RANGE_M = 0.008;
/** Mid-grey #808080 in sRGB (the v1 paint canvas). */
export const ALBEDO_DEFAULT_SRGB = 128 / 255;

/** The fixed channels, in a fixed order (index = channel code). */
export const CHANNEL_SPECS: Readonly<Record<BaseChannelId, ChannelSpec>> = {
  albedo: {
    id: "albedo", kind: "rgb", range: [0, 1], default: [ALBEDO_DEFAULT_SRGB, ALBEDO_DEFAULT_SRGB, ALBEDO_DEFAULT_SRGB],
    neutral: [ALBEDO_DEFAULT_SRGB, ALBEDO_DEFAULT_SRGB, ALBEDO_DEFAULT_SRGB], space: "srgb", storage: "vertex+fragment",
    attribute: "color", component: 0, doc: "base colour; composited in sRGB, delivered linear (vertex colour)",
  },
  roughness: {
    id: "roughness", kind: "scalar", range: [0, 1], default: 0.5, neutral: 0.5, space: "scalar", storage: "vertex+fragment",
    attribute: "aMaterial", component: 0, doc: "0 glossy .. 1 matte; 0.5 = the pre-TEX specular band",
  },
  height: {
    id: "height", kind: "scalar", range: [-HEIGHT_RANGE_M, HEIGHT_RANGE_M], default: 0, neutral: 0, space: "scalar",
    storage: "vertex+fragment", attribute: "aMaterial", component: 1, doc: "signed relief in metres along the normal",
  },
  ao: {
    id: "ao", kind: "scalar", range: [0, 1], default: 1, neutral: 1, space: "scalar", storage: "vertex",
    attribute: "aMaterial", component: 2, doc: "occlusion multiplier on the lit term (1 = open)",
  },
  subsurface: {
    id: "subsurface", kind: "scalar", range: [0, 1], default: 0, neutral: 0, space: "scalar", storage: "vertex",
    attribute: "aMaterial", component: 3, doc: "thin-skin warmth (terminator wrap), 0 = none",
  },
  emissive: {
    id: "emissive", kind: "rgb", range: [0, 1], default: [0, 0, 0], neutral: [0, 0, 0], space: "linear",
    storage: "vertex+fragment", attribute: "aEmissive", component: 0, doc: "linear RGB added after lighting",
  },
};

/** aMaterial component order (vec4). */
export const MATERIAL_LAYOUT = ["roughness", "height", "ao", "subsurface"] as const;
export type MaterialScalar = typeof MATERIAL_LAYOUT[number];

/** True for "mask:<name>" ids with a valid name. */
export function isMaskChannel(id: string): id is MaskChannelId {
  return /^mask:[A-Za-z0-9_-]+$/.test(id);
}

/** True for every id a layer may write. */
export function isChannelId(id: string): id is ChannelId {
  return (BASE_CHANNELS as readonly string[]).includes(id) || isMaskChannel(id);
}

/** The spec of any channel (mask channels share one shape: scalar 0..1, default 0, vertex storage). */
export function channelSpec(id: ChannelId): ChannelSpec {
  if (isMaskChannel(id)) {
    return {
      id, kind: "scalar", range: [0, 1], default: 0, neutral: 0, space: "scalar", storage: "vertex",
      attribute: id, component: 0, doc: "named scalar mask 0..1",
    };
  }
  const s = CHANNEL_SPECS[id as BaseChannelId];
  if (!s) throw new Error(`channelSpec: unknown channel ${id}`);
  return s;
}

/** Clamp a scalar to a channel range; NaN maps to the channel default (total). */
export function clampToChannel(spec: ChannelSpec, v: number): number {
  if (v !== v) return typeof spec.default === "number" ? spec.default : 0;
  return v < spec.range[0] ? spec.range[0] : v > spec.range[1] ? spec.range[1] : v;
}
