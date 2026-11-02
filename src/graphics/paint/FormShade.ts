// Form shading (wave V, lane B): paint that FOLLOWS the sculpted forms, so the muscle grooves, the
// joint creases and the bony points read under the cel bands even where the 2-3.5 cm polygonising grid
// can only hint at them. Pure module: no THREE, no DOM. Deterministic (no noise, no seed).
//
//   H      signed mean curvature per vertex (1/m), the umbrella operator H = −2 (ū − p)·n / ℓ², where
//          ū is the 1-ring mean, n the vertex normal and ℓ² the mean squared ring edge; a sphere of
//          radius r gives +1/r, a groove gives H < 0. Smoothed over FORM_RINGS 1-rings so a single
//          grid kink never paints a speck (the "no noise mush" rule: features ≥ 2 vertex spacings).
//   κ      H × cell: curvature in grid units (a 4-cell limb radius ≈ +0.25, a 2-cell groove ≈ −0.3).
//   cavity smoothstep(CAVITY_ONSET, CAVITY_FULL, −κ): the valley share -> MULTIPLY by 1 − CAVITY_DARK·cavity
//          (painted occlusion in the grooves between muscle masses: biceps/forearm, the popliteal
//          hollow, the infra-pectoral fold, the armpit, the spine).
//   ridge  smoothstep(RIDGE_ONSET, RIDGE_FULL, κ): bony points and tight convex forms (olecranon,
//          kneecap, knuckles, clavicle, shoulder cap) -> lift toward white by RIDGE_LIGHT·ridge (skin
//          sheen; on the garment the cloth is WORN pale there instead, by WEAR_LIGHT).
//   (no hem: a darkened garment hem was tried and DROPPED — the garment edge is a region seam, which the
//   grid quantises into stair-steps, and darkening it outlined every step; vision QA called it a
//   "blocky cutout" at the nape.)
// Magnitudes stay under one cel band step (the CelShader's bands are ~0.26 apart in tone), so the form
// paint MODULATES a band and never invents a new contour.

import { REGIONS, type MeshData } from "../body/contracts.ts";

export const FORM_RINGS = 2;
export const CAVITY_ONSET = 0.03;
export const CAVITY_FULL = 0.16;
export const CAVITY_DARK = 0.22;
export const RIDGE_ONSET = 0.18;
export const RIDGE_FULL = 0.42;
export const RIDGE_LIGHT = 0.1;
export const WEAR_LIGHT = 0.16;
/**
 * Regions the form paint never touches: hair and nails carry their own passes, the sole is flat, and the
 * FACE and EARS are a cluster of sub-cell features (nose, brows, lids) whose curvature would paint a
 * speckle — measured: with them the neck+face band-jump share rose 3.8 % -> 11 % on the human male.
 */
export const FORM_SKIP: readonly string[] = ["hair", "nail", "sole", "face", "ear"];

export interface FormShadeOptions {
  /** Polygonising cell (m): curvature is read in grid units. */
  cell: number;
  /** Regions painted as cloth (worn pale on ridges instead of skin sheen). Default: none. */
  garment?: readonly string[];
  /** Multiplies every term (0 = off, 1 = the stated magnitudes). */
  strength?: number;
  /**
   * Per-region gains on the cavity and the ridge terms (default 1), e.g. the seeded trunk knobs of
   * body/Improvise.ts (formGainsFor). A missing region keeps 1.
   */
  regionGain?: Partial<Record<string, { cavity?: number; ridge?: number }>>;
}

/** Vertex 1-rings of a triangle mesh (deduplicated, unsorted). */
export function vertexRings(mesh: MeshData): Int32Array[] {
  const n = mesh.positions.length / 3, sets: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  const I = mesh.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    sets[a].add(b); sets[a].add(c); sets[b].add(a); sets[b].add(c); sets[c].add(a); sets[c].add(b);
  }
  return sets.map((s) => Int32Array.from(s));
}

/** Signed mean curvature per vertex (1/m), smoothed over `rings` 1-rings (see the module comment). */
export function meanCurvature(mesh: MeshData, rings = FORM_RINGS, adj = vertexRings(mesh)): Float64Array {
  const P = mesh.positions, N = mesh.normals, n = P.length / 3;
  let H = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const nb = adj[i];
    if (nb.length === 0) continue;
    let ux = 0, uy = 0, uz = 0, l2 = 0;
    for (const j of nb) {
      const dx = P[j * 3] - P[i * 3], dy = P[j * 3 + 1] - P[i * 3 + 1], dz = P[j * 3 + 2] - P[i * 3 + 2];
      ux += dx; uy += dy; uz += dz; l2 += dx * dx + dy * dy + dz * dz;
    }
    ux /= nb.length; uy /= nb.length; uz /= nb.length; l2 /= nb.length;
    H[i] = (-2 * (ux * N[i * 3] + uy * N[i * 3 + 1] + uz * N[i * 3 + 2])) / Math.max(l2, 1e-12);
  }
  for (let r = 0; r < rings; r++) {
    const S = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = H[i]; for (const j of adj[i]) s += H[j]; S[i] = s / (adj[i].length + 1); }
    H = S;
  }
  return H;
}

const smooth01 = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const toS = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const toL = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** The per-vertex form terms (0..1 each): cavity and ridge, with the curvature. Exposed for tests and the probe. */
export function formTerms(mesh: MeshData, opts: FormShadeOptions): { cavity: Float32Array; ridge: Float32Array; H: Float64Array } {
  const n = mesh.positions.length / 3;
  const H = meanCurvature(mesh, FORM_RINGS);
  const cavity = new Float32Array(n), ridge = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = H[i] * opts.cell;
    cavity[i] = smooth01(CAVITY_ONSET, CAVITY_FULL, -k);
    ridge[i] = smooth01(RIDGE_ONSET, RIDGE_FULL, k);
  }
  return { cavity, ridge, H };
}

/**
 * Apply the form paint to LINEAR RGB vertex colours (3 per vertex), in place, compositing in sRGB like
 * the layer stack does. Returns the same array. Skips FORM_SKIP regions.
 */
export function applyFormShade(mesh: MeshData, rgb: Float32Array, opts: FormShadeOptions): Float32Array {
  const g = opts.strength ?? 1;
  if (g <= 0) return rgb;
  const { cavity, ridge } = formTerms(mesh, opts);
  const skip = new Uint8Array(REGIONS.length), cloth = new Uint8Array(REGIONS.length);
  for (const r of FORM_SKIP) skip[REGIONS.indexOf(r as typeof REGIONS[number])] = 1;
  for (const r of opts.garment ?? []) { const i = REGIONS.indexOf(r as typeof REGIONS[number]); if (i >= 0) cloth[i] = 1; }
  const n = mesh.positions.length / 3;
  const gc = new Float32Array(REGIONS.length).fill(1), gr = new Float32Array(REGIONS.length).fill(1);
  for (const [r, v] of Object.entries(opts.regionGain ?? {})) {
    const i = REGIONS.indexOf(r as typeof REGIONS[number]);
    if (i >= 0 && v) { gc[i] = v.cavity ?? 1; gr[i] = v.ridge ?? 1; }
  }
  for (let i = 0; i < n; i++) {
    const reg = mesh.region[i];
    if (skip[reg]) continue;
    const dark = 1 - g * gc[reg] * CAVITY_DARK * cavity[i];
    const lift = g * gr[reg] * (cloth[reg] ? WEAR_LIGHT : RIDGE_LIGHT) * ridge[i];
    for (let k = 0; k < 3; k++) {
      let s = toS(rgb[i * 3 + k]) * dark;
      s += (1 - s) * lift;
      rgb[i * 3 + k] = toL(Math.max(0, Math.min(1, s)));
    }
  }
  return rgb;
}
