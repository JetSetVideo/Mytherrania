// Patterns: every PatternKind of the paint contract as a pure function of a surface
// point (model-space metres), its unit normal, its region and the layer parameters.
// A pattern returns two numbers per vertex (written into a reused PatternSample):
//   coverage  0..1, how much of the layer lands here (multiplies the layer opacity);
//   mix       0..1, where the layer colour sits between `colour` (0) and `colour2` (1).
// Patterns never see colours; Layers.ts turns (coverage, mix) into paint.
//
// Vocabulary:
//   q          the point in lattice units: q = p / layer.scale. One lattice unit is one
//              pattern feature (a spot cell, a stripe period, a symbol radius).
//   anchor     the centroid of the vertex's region (per body side for paired regions);
//              warpaint and tattoos are drawn in a frame centred on it.
//   side       +x is the character's LEFT (contract frame). side 0 = left (x >= core.x).
//   h          normalised height (y - minY) / (maxY - minY), 0 at the soles, 1 at the crown.

import { clamp01, smoothstep } from "../../core/MathCore.ts";
import { type MeshData, type PaintLayer, type PatternKind, REGIONS, type Region, type Vec3 } from "../body/contracts.ts";
import {
  type CellSample, fbm3, gradientNoise3, hash01, makeCellSample, makeNoise, type NoiseField,
  ridged3, valueNoise3, warp3, type WarpOut, worley3,
} from "./Noise.ts";
import { symbolDistance } from "./Symbols.ts";

/** Every pattern kind, in a fixed order (a kind's index is its numeric code). */
export const PATTERN_KINDS: readonly PatternKind[] = [
  "solid", "noise", "stripes", "spots", "scales", "freckles", "gradient", "warpaint", "veins", "tattoo",
];

/** Region name -> index into REGIONS (what MeshData.region stores). */
export const REGION_INDEX: Readonly<Record<Region, number>> = Object.fromEntries(
  REGIONS.map((r, i) => [r, i]),
) as Record<Region, number>;

/** Regions that come as a left/right pair: their anchor is computed per body side. */
export const PAIRED_REGIONS: readonly Region[] = ["ear", "upperArm", "foreArm", "hand", "thigh", "shin", "foot", "sole", "nail"];

/**
 * Landmark heights as fractions of stature (Drillis & Contini 1966 segment table),
 * used to place freckles on the shoulders without knowing the mesh's skeleton.
 */
export const LANDMARK_HEIGHT = { chin: 0.870, shoulder: 0.818, chest: 0.720 } as const;

/** gradient `axis` codes: which scalar t in 0..1 the gradient runs along. */
export const GRADIENT_AXES = ["height", "up", "front", "extremity", "side"] as const;

/** warpaint `motif` codes: the band shape drawn around the region anchor. */
export const WARPAINT_MOTIFS = ["bars", "chevron", "zigzag", "rings", "bolt", "split"] as const;

/** tattoo `project` codes: the plane a glyph is projected from. */
export const TATTOO_PROJECTIONS = ["front", "side", "back", "top"] as const;

/**
 * Default parameters per pattern (lattice units unless stated). A layer's `params`
 * override these key by key. Each value's meaning is documented on its pattern.
 */
export const PATTERN_DEFAULTS: Readonly<Record<PatternKind, Readonly<Record<string, number>>>> = {
  solid: {},
  noise: { octaves: 4, contrast: 1.6, bias: 0, warp: 0 },
  stripes: { angle: 0, width: 0.45, warp: 0.6, sharpness: 0.7, octaves: 2 },
  spots: { density: 0.6, size: 0.35, sizeJitter: 0.4, jitter: 0.9, softness: 0.35, warp: 0 },
  scales: { jitter: 0.3, rim: 0.22, rimDepth: 0.45, stretch: Math.sqrt(3) / 2 },
  freckles: { density: 0.45, size: 0.3, faceBoost: 1, shoulderBoost: 0.8, armBoost: 0.4, exposure: 0.5 },
  gradient: { axis: 0, from: 0, to: 1, power: 1, invert: 0, fill: 0 },
  warpaint: { motif: 0, bands: 2, width: 0.45, angle: 0, edge: 0.12, mirror: 1, warp: 0.12, offset: 0, slope: 0.75 },
  veins: { octaves: 3, threshold: 0.72, sharpness: 2, warp: 0.6 },
  tattoo: { symbol: 0, project: 0, offsetX: 0, offsetY: 0, stroke: 0.14, facing: 0.3, mirror: 1 },
};

/** Per-mesh facts patterns need, computed once per paint pass by buildPatternEnv. */
export interface PatternEnv {
  /** Bounds of the mesh (metres). */
  min: Vec3;
  max: Vec3;
  /** Centroid of the torso vertices (the bounds centre when there are none). */
  core: Vec3;
  /** Largest vertex distance from `core` (metres), > 0. */
  maxCoreDistance: number;
  /** Anchor per (region, side): xyz at ((region * 2 + side) * 3). */
  anchors: Float64Array;
}

/** Output record of one pattern evaluation (reuse one per pass). */
export interface PatternSample { coverage: number; mix: number }

/** A layer resolved for evaluation: its noise source, 1/scale, merged params and scratch. */
export interface PatternContext {
  kind: PatternKind;
  noise: NoiseField;
  /** 1 / layer.scale (1/m): metres -> lattice units. */
  invScale: number;
  params: Record<string, number>;
  env: PatternEnv;
  cell: CellSample;
  warp: WarpOut;
}

/** Signature shared by every pattern. (px, py, pz) metres; (nx, ny, nz) unit normal. */
export type PatternFn = (
  ctx: PatternContext, px: number, py: number, pz: number,
  nx: number, ny: number, nz: number, region: number, out: PatternSample,
) => PatternSample;

/** Which side a point is on: 0 = character's left (x >= core.x), 1 = right. */
export function sideOf(env: PatternEnv, x: number): number { return x >= env.core[0] ? 0 : 1; }

/** Compute bounds, core, reach and region anchors of a mesh. O(vertices), allocates once. */
export function buildPatternEnv(mesh: MeshData): PatternEnv {
  const P = mesh.positions, n = P.length / 3;
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const torso = REGION_INDEX.torso;
  let tx = 0, ty = 0, tz = 0, tn = 0;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) { const v = P[i * 3 + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
    if (mesh.region[i] === torso) { tx += P[i * 3]; ty += P[i * 3 + 1]; tz += P[i * 3 + 2]; tn++; }
  }
  if (n === 0) { min[0] = min[1] = min[2] = 0; max[0] = max[1] = max[2] = 0; }
  const core: Vec3 = tn > 0 ? [tx / tn, ty / tn, tz / tn]
    : [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const paired = new Uint8Array(REGIONS.length);
  for (const r of PAIRED_REGIONS) paired[REGION_INDEX[r]] = 1;
  const sums = new Float64Array(REGIONS.length * 2 * 4);
  let reach = 0;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], r = mesh.region[i];
    const side = paired[r] ? (x >= core[0] ? 0 : 1) : 0;
    const o = (r * 2 + side) * 4;
    sums[o] += x; sums[o + 1] += y; sums[o + 2] += z; sums[o + 3] += 1;
    reach = Math.max(reach, Math.hypot(x - core[0], y - core[1], z - core[2]));
  }
  const anchors = new Float64Array(REGIONS.length * 2 * 3);
  for (let r = 0; r < REGIONS.length; r++) {
    for (let side = 0; side < 2; side++) {
      // Midline regions share one anchor: side 1 mirrors side 0.
      const o = (r * 2 + (paired[r] ? side : 0)) * 4, c = sums[o + 3];
      const a = (r * 2 + side) * 3;
      anchors[a] = c > 0 ? sums[o] / c : core[0];
      anchors[a + 1] = c > 0 ? sums[o + 1] / c : core[1];
      anchors[a + 2] = c > 0 ? sums[o + 2] / c : core[2];
    }
  }
  return { min, max, core, maxCoreDistance: Math.max(1e-6, reach), anchors };
}

/** Merge a layer's params over its pattern's defaults. */
export function resolveParams(kind: PatternKind, params?: Record<string, number>): Record<string, number> {
  return { ...PATTERN_DEFAULTS[kind], ...(params ?? {}) };
}

/**
 * Resolve a layer for evaluation. `noise` may be shared between layers with one seed.
 * The layer seed defaults to 0; a non-positive scale falls back to 1 mm to stay finite.
 */
export function makePatternContext(layer: PaintLayer, env: PatternEnv, noise?: NoiseField): PatternContext {
  return {
    kind: layer.pattern,
    noise: noise ?? makeNoise(layer.seed ?? 0),
    invScale: 1 / Math.max(1e-3, layer.scale),
    params: resolveParams(layer.pattern, layer.params),
    env, cell: makeCellSample(), warp: { x: 0, y: 0, z: 0 },
  };
}

/** Write and return. Keeps every pattern a single expression at its end. */
function emit(out: PatternSample, coverage: number, mix: number): PatternSample {
  out.coverage = clamp01(coverage); out.mix = clamp01(mix);
  return out;
}

/** solid: coverage = 1, mix = 0. The base coat. No parameters. */
export const solid: PatternFn = (_c, _x, _y, _z, _nx, _ny, _nz, _r, out) => emit(out, 1, 0);

/**
 * noise (mottling): n = fbm(q) [warped by `warp` lattice units when > 0];
 *   coverage = clamp01(0.5 + 0.5 * contrast * n + bias),
 *   mix = 0.5 + 0.5 * valueNoise(q / 2)  (colour2 drifts in over patches twice as wide).
 * Params: octaves (fBm octaves), contrast (gain on n; > 1 hardens the blotches), bias
 * (shifts coverage; > 0 = more of the layer), warp (domain-warp amplitude).
 */
export const noise: PatternFn = (c, px, py, pz, _nx, _ny, _nz, _r, out) => {
  const p = c.params, s = c.invScale;
  let x = px * s, y = py * s, z = pz * s;
  if (p.warp > 0) { warp3(c.noise, x, y, z, p.warp, c.warp); x = c.warp.x; y = c.warp.y; z = c.warp.z; }
  const n = fbm3(c.noise, x, y, z, p.octaves);
  return emit(out, 0.5 + 0.5 * p.contrast * n + p.bias, 0.5 + 0.5 * valueNoise3(c.noise, x / 2, y / 2, z / 2));
};

/**
 * stripes: t = sin(angle) * qx + cos(angle) * qy + warp * fbm(q) (angle 0 = horizontal
 * bands, PI/2 = vertical stripes); u = t - floor(t); d = |u - 0.5|; half-width w = width / 2;
 *   coverage = 1 - smoothstep(w - e, w + e, d),  e = max(0.02, (1 - sharpness) * w),
 *   mix = hash(stripe index floor(t))  (each stripe picks its own shade).
 * Params: angle (rad), width (painted fraction of one period, 0..1), warp (lattice units),
 * sharpness (0 soft .. 1 hard edge), octaves (warp fBm octaves).
 */
export const stripes: PatternFn = (c, px, py, pz, _nx, _ny, _nz, _r, out) => {
  const p = c.params, s = c.invScale;
  const x = px * s, y = py * s, z = pz * s;
  const t = Math.sin(p.angle) * x + Math.cos(p.angle) * y + p.warp * fbm3(c.noise, x, y, z, p.octaves);
  const u = t - Math.floor(t), d = Math.abs(u - 0.5), w = p.width / 2;
  const e = Math.max(0.02, (1 - p.sharpness) * w);
  return emit(out, 1 - smoothstep(w - e, w + e, d), hash01(c.noise.seed, Math.floor(t), 0, 0, 11));
};

/**
 * spots (cellular): Worley F1 at q (feature jitter `jitter`); a cell holds a spot when
 * hash(cell) < density; its radius r = size * (1 - sizeJitter * hash'(cell));
 *   coverage = spot ? 1 - smoothstep(r * (1 - softness), r, F1) : 0,  mix = hash''(cell).
 * Params: density (0..1 share of cells with a spot), size (radius in cells, <= 0.5 keeps
 * spots apart), sizeJitter (0..1), jitter (feature randomness), softness (edge width
 * as a fraction of r), warp (domain warp, lattice units).
 */
export const spots: PatternFn = (c, px, py, pz, _nx, _ny, _nz, _r, out) => {
  const p = c.params, s = c.invScale;
  let x = px * s, y = py * s, z = pz * s;
  if (p.warp > 0) { warp3(c.noise, x, y, z, p.warp, c.warp); x = c.warp.x; y = c.warp.y; z = c.warp.z; }
  const cell = worley3(c.noise, x, y, z, p.jitter, c.cell), id = cell.cellId | 0, seed = c.noise.seed;
  if (hash01(seed, id, 0, 0, 5) >= p.density) return emit(out, 0, 0);
  const r = p.size * (1 - p.sizeJitter * hash01(seed, id, 0, 0, 6));
  return emit(out, 1 - smoothstep(r * (1 - p.softness), r, cell.f1), hash01(seed, id, 0, 0, 7));
};

/**
 * scales: Worley on a lattice squashed vertically by `stretch` (sqrt(3)/2 = hexagonal row
 * spacing) with low jitter, so plates sit in offset rows. edge = F2 - F1 (0 on a border);
 *   rimness = 1 - smoothstep(0, rim, edge);
 *   coverage = 1 - rimDepth * rimness,  mix = rimness  (colour2 = the darker rim).
 * Params: jitter (plate irregularity), rim (rim width, lattice units), rimDepth (0..1
 * how much the rim drops the layer), stretch (vertical squash).
 */
export const scales: PatternFn = (c, px, py, pz, _nx, _ny, _nz, _r, out) => {
  const p = c.params, s = c.invScale;
  const cell = worley3(c.noise, px * s, py * s, pz * s, p.jitter, c.cell, p.stretch);
  const rimness = 1 - smoothstep(0, p.rim, cell.f2 - cell.f1);
  return emit(out, 1 - p.rimDepth * rimness, rimness);
};

/**
 * freckles: sparse small spots whose density is weighted by where sun lands.
 *   weight = (faceBoost [face] | 0.7 faceBoost [ear] |
 *             shoulderBoost * exp(-((h - 0.818) / sigma)^2) [torso, neck, upperArm] |
 *             armBoost [foreArm, hand] | 0 elsewhere)
 *            * ((1 - exposure) + exposure * clamp01(0.5 + 0.5 (ny + nz) / sqrt 2)),
 *   sigma = (chin - chest) / 2 = 0.075 (stature fractions);
 *   a cell has a freckle when hash < density * weight; radius = size * (0.6 + 0.4 hash');
 *   coverage = 1 - smoothstep(0.6 r, r, F1), mix = hash''.
 * Params: density, size (radius in cells), faceBoost, shoulderBoost, armBoost (0..1
 * region weights), exposure (0..1 weight of facing up/forward).
 */
export const freckles: PatternFn = (c, px, py, pz, _nx, ny, nz, region, out) => {
  const p = c.params, s = c.invScale, env = c.env;
  const h = (py - env.min[1]) / Math.max(1e-6, env.max[1] - env.min[1]);
  const sigma = (LANDMARK_HEIGHT.chin - LANDMARK_HEIGHT.chest) / 2;
  let weight = 0;
  if (region === REGION_INDEX.face) weight = p.faceBoost;
  else if (region === REGION_INDEX.ear) weight = 0.7 * p.faceBoost;
  else if (region === REGION_INDEX.torso || region === REGION_INDEX.neck || region === REGION_INDEX.upperArm) {
    weight = p.shoulderBoost * Math.exp(-(((h - LANDMARK_HEIGHT.shoulder) / sigma) ** 2));
  } else if (region === REGION_INDEX.foreArm || region === REGION_INDEX.hand) weight = p.armBoost;
  weight *= (1 - p.exposure) + p.exposure * clamp01(0.5 + 0.5 * (ny + nz) / Math.SQRT2);
  if (weight <= 0) return emit(out, 0, 0);
  const cell = worley3(c.noise, px * s, py * s, pz * s, 1, c.cell), id = cell.cellId | 0, seed = c.noise.seed;
  if (hash01(seed, id, 0, 0, 8) >= p.density * weight) return emit(out, 0, 0);
  const r = p.size * (0.6 + 0.4 * hash01(seed, id, 0, 0, 9));
  return emit(out, 1 - smoothstep(0.6 * r, r, cell.f1), hash01(seed, id, 0, 0, 10));
};

/**
 * gradient: a scalar t in 0..1 chosen by `axis` (GRADIENT_AXES):
 *   0 height     t = h
 *   1 up         t = 0.5 + 0.5 ny      (1 on top surfaces: countershading's dark back)
 *   2 front      t = 0.5 + 0.5 nz      (1 facing forward: the belly / chest)
 *   3 extremity  t = |p - core| / maxCoreDistance  (0 torso core .. 1 fingertips, crown)
 *   4 side       t = |x - core.x| / max(|x - core.x|)  (distance from the mid-plane)
 *   g = smoothstep(from, to, t)^power;  c = invert ? 1 - g : g;
 *   coverage = fill + (1 - fill) * c;  mix = g.
 * Params: axis, from/to (t window), power (> 1 pushes the change toward `to`), invert (0/1),
 * fill (0..1 coverage floor; 1 = paint everywhere and let `mix` carry a two-tone ramp
 * from colour at t <= from to colour2 at t >= to, e.g. light belly -> dark back).
 * The scale is unused (the gradient spans the body).
 */
export const gradient: PatternFn = (c, px, py, pz, _nx, ny, nz, _r, out) => {
  const p = c.params, env = c.env, axis = Math.round(p.axis);
  let t: number;
  if (axis === 1) t = 0.5 + 0.5 * ny;
  else if (axis === 2) t = 0.5 + 0.5 * nz;
  else if (axis === 3) t = Math.hypot(px - env.core[0], py - env.core[1], pz - env.core[2]) / env.maxCoreDistance;
  else if (axis === 4) {
    const half = Math.max(env.max[0] - env.core[0], env.core[0] - env.min[0], 1e-6);
    t = Math.abs(px - env.core[0]) / half;
  } else t = (py - env.min[1]) / Math.max(1e-6, env.max[1] - env.min[1]);
  const g = Math.pow(smoothstep(p.from, p.to, t), Math.max(1e-3, p.power));
  const ramp = p.invert >= 0.5 ? 1 - g : g;
  return emit(out, p.fill + (1 - p.fill) * ramp, g);
};

/** Triangle wave, period 1, range 0..1 (0 at integers, 1 at half-integers). */
function tri(x: number): number { return 1 - Math.abs(2 * (x - Math.floor(x)) - 1); }

/**
 * warpaint: bold bands drawn in the frame of the region anchor (centroid of the vertex's
 * region; per side for paired regions). l = (p - anchor) / scale; lx = |lx| when mirror;
 * (lx, ly) rotated by `angle`; then a band coordinate t by `motif` (WARPAINT_MOTIFS):
 *   bars t = ly; chevron t = ly + slope |lx|; zigzag t = ly + slope tri(lx);
 *   rings t = |(lx, ly)|; bolt t = ly + slope lx + 0.5 slope tri(2 lx); split t = lx;
 *   t += offset + warp * noise(q)  (the brush wobble);
 *   band k = round(t) is painted when 0 <= k < bands; d = |t - k|; w = width / 2;
 *   coverage = 1 - smoothstep(w (1 - edge), w, d);  mix = k mod 2 (bands alternate colours).
 * Params: motif, bands (count), width (band thickness, fraction of the period), angle (rad),
 * edge (0..1 soft fraction), mirror (0/1), warp (lattice units), offset (shifts bands
 * along t, in periods), slope (motif steepness).
 */
export const warpaint: PatternFn = (c, px, py, pz, _nx, _ny, _nz, region, out) => {
  const p = c.params, s = c.invScale, a = (region * 2 + sideOf(c.env, px)) * 3, A = c.env.anchors;
  let lx = (px - A[a]) * s;
  const ly0 = (py - A[a + 1]) * s;
  if (p.mirror >= 0.5) lx = Math.abs(lx);
  const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
  const rx = ca * lx - sa * ly0, ry = sa * lx + ca * ly0;
  const motif = Math.round(p.motif);
  let t: number;
  if (motif === 1) t = ry + p.slope * Math.abs(rx);
  else if (motif === 2) t = ry + p.slope * tri(rx);
  else if (motif === 3) t = Math.hypot(rx, ry);
  else if (motif === 4) t = ry + p.slope * rx + 0.5 * p.slope * tri(2 * rx);
  else if (motif === 5) t = rx;
  else t = ry;
  t += p.offset + p.warp * gradientNoise3(c.noise, px * s * 2, py * s * 2, pz * s * 2);
  const k = Math.round(t);
  if (k < 0 || k >= Math.round(p.bands)) return emit(out, 0, 0);
  const w = p.width / 2;
  return emit(out, 1 - smoothstep(w * (1 - p.edge), w, Math.abs(t - k)), k & 1);
};

/**
 * veins: ridged multifractal of the warped point, r = ridged(warp(q)) in 0..1 (1 on a crest);
 *   coverage = smoothstep(threshold, 1, r)^sharpness,  mix = 0.5 + 0.5 noise(q) (deep vs near).
 * Params: octaves, threshold (crest cut, 0..1; higher = thinner, rarer veins), sharpness
 * (exponent; higher = crisper lines), warp (domain-warp amplitude, lattice units).
 */
export const veins: PatternFn = (c, px, py, pz, _nx, _ny, _nz, _r, out) => {
  const p = c.params, s = c.invScale;
  const w = warp3(c.noise, px * s, py * s, pz * s, p.warp, c.warp);
  const r = ridged3(c.noise, w.x, w.y, w.z, p.octaves);
  const cov = Math.pow(smoothstep(p.threshold, 1, r), Math.max(1e-3, p.sharpness));
  return emit(out, cov, 0.5 + 0.5 * gradientNoise3(c.noise, w.y, w.z, w.x));
};

/**
 * tattoo: a glyph (Symbols.ts, index `symbol`) projected onto the region from a plane
 * (`project`: 0 front +z, 1 side = outward +-x, 2 back -z, 3 top +y). Glyph coordinates
 * (u, v) = (p - anchor) / scale in that plane minus (offsetX, offsetY); scale = glyph radius (m).
 *   d = distance to the nearest stroke (glyph units);
 *   coverage = facing ? 1 - smoothstep(0.6 stroke, stroke, d) : 0, mix = 0,
 *   facing = dot(n, projection direction) >= facing param (no ink through to the far side).
 * Params: symbol, project, offsetX/offsetY (glyph radii), stroke (half line width, glyph
 * radii), facing (min cosine), mirror (1 = both sides of paired regions, 0 = left only).
 */
export const tattoo: PatternFn = (c, px, py, pz, nx, ny, nz, region, out) => {
  const p = c.params, s = c.invScale, side = sideOf(c.env, px);
  if (p.mirror < 0.5 && side === 1) return emit(out, 0, 0);
  const a = (region * 2 + side) * 3, A = c.env.anchors;
  const dx = (px - A[a]) * s, dy = (py - A[a + 1]) * s, dz = (pz - A[a + 2]) * s;
  const outward = side === 0 ? 1 : -1, proj = Math.round(p.project);
  let u: number, v: number, facing: number;
  if (proj === 1) { u = dz * outward; v = dy; facing = nx * outward; }
  else if (proj === 2) { u = -dx; v = dy; facing = -nz; }
  else if (proj === 3) { u = dx; v = -dz; facing = ny; }
  else { u = dx; v = dy; facing = nz; }
  if (facing < p.facing) return emit(out, 0, 0);
  u -= p.offsetX; v -= p.offsetY;
  if (Math.abs(u) > 1 + p.stroke || Math.abs(v) > 1 + p.stroke) return emit(out, 0, 0);
  const d = symbolDistance(p.symbol, u, v);
  return emit(out, 1 - smoothstep(0.6 * p.stroke, p.stroke, d), 0);
};

/** Pattern function by kind. */
export const PATTERNS: Readonly<Record<PatternKind, PatternFn>> = {
  solid, noise, stripes, spots, scales, freckles, gradient, warpaint, veins, tattoo,
};

/** Evaluate the context's pattern at one point. */
export function samplePattern(
  ctx: PatternContext, px: number, py: number, pz: number,
  nx: number, ny: number, nz: number, region: number, out: PatternSample,
): PatternSample {
  return PATTERNS[ctx.kind](ctx, px, py, pz, nx, ny, nz, region, out);
}
