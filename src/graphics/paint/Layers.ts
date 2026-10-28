// Layers: composite a PaintStack onto a mesh, one RGB colour per vertex.
//
// Algorithm (bottom-up, Photoshop order): the canvas starts at `options.background`
// (mid-grey; recipes always begin with an opaque solid coat). For each layer, for each
// vertex inside the layer's region mask:
//   (coverage, mix) = pattern(position, normal, region)
//   top   = lerp(colour, colour2 ?? colour, mix)                  sRGB
//   alpha = clamp01(opacity * coverage)
//   canvas = lerp(canvas, blend(canvas, top), alpha)              per channel, sRGB
// Compositing happens in sRGB because that is where Photoshop's blend formulas are
// defined; the result is converted to LINEAR at the end (options.space = "linear",
// the default), which is what three.js expects in a `color` vertex attribute.
//
// Cost: O(layers x vertices) pattern evaluations. Allocation: the one output array
// (or none when options.out is passed) plus O(layers + regions) setup records.

import type { MeshData, PaintLayer, PaintStack } from "../body/contracts.ts";
import { REGIONS } from "../body/contracts.ts";
import { blendChannelCode, blendCode, hexToRgb, srgbToLinear } from "./Blend.ts";
import { makeNoise, type NoiseField } from "./Noise.ts";
import { buildPatternEnv, makePatternContext, PATTERNS, type PatternEnv, REGION_INDEX } from "./Patterns.ts";

/** Optional knobs for paintVertices (all have safe defaults). */
export interface PaintOptions {
  /** Colour space of the returned channels. "linear" (default) for three.js vertex colours. */
  space?: "linear" | "srgb";
  /** Canvas colour under the first layer, "#rrggbb" (default "#808080", mid-grey). */
  background?: string;
  /** Reuse this array (length >= 3 x vertex count) instead of allocating. */
  out?: Float32Array;
  /** Precomputed per-mesh facts (from buildPatternEnv), when painting one mesh many times. */
  env?: PatternEnv;
}

/** Region mask of a layer: 1 per REGIONS index the layer may touch (all when absent). */
export function regionMask(layer: PaintLayer): Uint8Array {
  const mask = new Uint8Array(REGIONS.length);
  if (!layer.regions || layer.regions.length === 0) mask.fill(1);
  else for (const r of layer.regions) mask[REGION_INDEX[r]] = 1;
  return mask;
}

/**
 * Paint every vertex of `mesh` with `stack`. Returns RGB per vertex (length 3 x vertex
 * count), each channel 0..1, LINEAR by default (see PaintOptions.space). Deterministic:
 * the same mesh, stack and layer seeds always give bit-identical output.
 * Works for any MeshData: for terrain or weapons fill `region` with 0 and leave the
 * layers' `regions` unset.
 */
export function paintVertices(mesh: MeshData, stack: PaintStack, options: PaintOptions = {}): Float32Array {
  const n = mesh.positions.length / 3;
  const out = options.out && options.out.length >= n * 3 ? options.out : new Float32Array(n * 3);
  const bg = hexToRgb(options.background ?? "#808080");
  for (let i = 0; i < n; i++) { out[i * 3] = bg[0]; out[i * 3 + 1] = bg[1]; out[i * 3 + 2] = bg[2]; }
  const env = options.env ?? buildPatternEnv(mesh);
  const noiseBySeed = new Map<number, NoiseField>();
  const sample = { coverage: 0, mix: 0 };
  const P = mesh.positions, N = mesh.normals, R = mesh.region;
  for (const layer of stack.layers) {
    const opacity = Math.max(0, Math.min(1, layer.opacity));
    if (opacity <= 0) continue;
    const seed = (layer.seed ?? 0) >>> 0;
    let noise = noiseBySeed.get(seed);
    if (!noise) { noise = makeNoise(seed); noiseBySeed.set(seed, noise); }
    const ctx = makePatternContext(layer, env, noise);
    const fn = PATTERNS[layer.pattern];
    const mask = regionMask(layer);
    const mode = blendCode(layer.blend);
    const c1 = hexToRgb(layer.colour), c2 = hexToRgb(layer.colour2 ?? layer.colour);
    for (let i = 0; i < n; i++) {
      const region = R[i];
      if (mask[region] !== 1) continue;
      const o = i * 3;
      fn(ctx, P[o], P[o + 1], P[o + 2], N[o], N[o + 1], N[o + 2], region, sample);
      const alpha = opacity * sample.coverage;
      if (alpha <= 0) continue;
      const m = sample.mix;
      for (let k = 0; k < 3; k++) {
        const base = out[o + k];
        const top = c1[k] + (c2[k] - c1[k]) * m;
        out[o + k] = base + (blendChannelCode(mode, base, top) - base) * alpha;
      }
    }
  }
  if ((options.space ?? "linear") === "linear") {
    for (let i = 0; i < n * 3; i++) out[i] = srgbToLinear(out[i]);
  }
  return out;
}
