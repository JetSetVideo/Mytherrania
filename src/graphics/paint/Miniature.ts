// Wave GEN lane S: the MINIATURE pass — paint that reads like a hand-painted tabletop miniature under the
// cel shader. Pure (no THREE, no DOM), deterministic (no Math.random: the weathering noise is a hash of the
// bind-pose position), computed from the polygonised mesh alone. It runs inside FormShade.applyFormShade
// after the wave-V groove/ridge terms, so every surface that already gets the form paint (the live rig via
// SkinnedHumanoid.paintSkin, the pipeline's paint stage) gets it with no new call site.
//
// Terms (per vertex; sRGB compositing like the layer stack; every magnitude under one cel band step):
//   edge      FINE convexity (mean curvature H smoothed over EDGE_RINGS 1-rings, in grid units κ = H·cell):
//             smoothstep(EDGE_ONSET, EDGE_FULL, κ) -> lift toward a LIGHTER TINT of the base colour (the
//             painter's edge highlight: base + white, never pure white) by EDGE_LIGHT.
//   cavity    BROAD occlusion: the vertex's depth under its neighbourhood, d = (S^k(p) − p)·n, where S^k is
//             k = CAVITY_SMOOTH Laplacian (1-ring mean) smoothings of the positions — a crease sits BELOW its
//             smoothed surface (d > 0), a ridge above it. In grid units a = d / cell:
//             smoothstep(AO_ONSET, AO_FULL, a) -> darken by AO_DARK and pool pigment (+AO_SAT saturation),
//             the wash that settles into the armpit, the gluteal fold, under the chin, between the fingers.
//   chiaro    top-down light/dark (the zenithal prime of a miniature): a vertical gradient over the body's
//             height, 1 − CHIARO_DARK at the soles easing to 1 at CHIARO_TOP of the height (shoulders up are
//             untouched, so the face — which the form paint skips — never meets a seam), plus a zenithal
//             term on up/down-facing normals (ZENITH_LIGHT on tops, ZENITH_DARK on undersides) faded out
//             above the shoulders the same way.
//   weather   garments only: grime rising from the ground and settling in the cavities, broken by a
//             ~WEATHER_PERIOD value-noise field — mix toward GRIME (a dull earth) by up to WEATHER_MAX, and
//             fade (desaturate) the cloth by WEATHER_FADE of the same weight.
// The whole result is clamped so no channel darkens below (1 − PAINT_MAX_DARK) of the UNPAINTED base — the
// combined form + miniature paint MODULATES a cel band and never invents a new contour.

import { REGIONS, type MeshData } from "../body/contracts.ts";

export const MINIATURE = {
  edgeRings: 1,
  edgeOnset: 0.28,
  edgeFull: 0.55,
  edgeLight: 0.4,
  /** Edge highlight tint: base lifted this far toward white (a highlight is a lighter BASE, not white). */
  edgeTint: 0.55,
  cavitySmooth: 20,
  aoOnset: 0.05,
  aoFull: 0.3,
  aoRings: 2,
  aoDark: 0.24,
  aoSat: 0.25,
  chiaroDark: 0.13,
  chiaroTop: 0.78,
  /** Fade band (fraction of height) above chiaroTop where the zenithal term goes to 0. */
  chiaroFade: 0.06,
  zenithLight: 0.06,
  zenithDark: 0.07,
  weatherMax: 0.12,
  weatherFade: 0.18,
  weatherPeriod: 0.14,
  /** The grime colour (sRGB 0..1): a dull earth. */
  grime: [0.36, 0.32, 0.27] as readonly number[],
} as const;

/** No channel ends darker than (1 − this) × the unpainted base (= 1.5 × FormShade.CAVITY_DARK − 0.01). */
export const PAINT_MAX_DARK = 0.32;

export interface MiniatureOptions {
  /** Polygonising cell (m). */
  cell: number;
  /** 0 = off, 1 = the stated magnitudes. */
  strength?: number;
  /** Cloth regions (weathered). */
  garment?: readonly string[];
  /** Regions left untouched (FormShade.FORM_SKIP). */
  skip?: readonly string[];
}

/** Taubin (1995) non-shrinking smoothing weights (λ > 0, μ < −λ). */
export const TAUBIN_LAMBDA = 0.5;
export const TAUBIN_MU = -0.53;

const smooth01 = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Signed broad cavity depth per vertex in GRID units (> 0 = below the smoothed neighbourhood). */
export function cavityDepth(mesh: MeshData, adj: Int32Array[], cell: number, iterations: number = MINIATURE.cavitySmooth): Float32Array {
  const P = mesh.positions, N = mesh.normals, n = P.length / 3;
  // Taubin λ|μ smoothing: a low-pass that does NOT shrink (plain Laplacian smoothing pulls every convex
  // limb inward, which read the whole body as "ridge" and no crease as deep enough — measured: median
  // depth −0.41 cells with the plain mean).
  let S = Float64Array.from(P);
  let T = new Float64Array(n * 3);
  for (let it = 0; it < 2 * iterations; it++) {
    const w = it % 2 === 0 ? TAUBIN_LAMBDA : TAUBIN_MU;
    for (let i = 0; i < n; i++) {
      const nb = adj[i];
      if (nb.length === 0) { T[i * 3] = S[i * 3]; T[i * 3 + 1] = S[i * 3 + 1]; T[i * 3 + 2] = S[i * 3 + 2]; continue; }
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < nb.length; k++) { const j = nb[k] * 3; x += S[j]; y += S[j + 1]; z += S[j + 2]; }
      const c = 1 / nb.length;
      T[i * 3] = S[i * 3] + w * (x * c - S[i * 3]);
      T[i * 3 + 1] = S[i * 3 + 1] + w * (y * c - S[i * 3 + 1]);
      T[i * 3 + 2] = S[i * 3 + 2] + w * (z * c - S[i * 3 + 2]);
    }
    const tmp = S; S = T; T = tmp;
  }
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    d[i] = ((S[i * 3] - P[i * 3]) * N[i * 3] + (S[i * 3 + 1] - P[i * 3 + 1]) * N[i * 3 + 1] + (S[i * 3 + 2] - P[i * 3 + 2]) * N[i * 3 + 2]) / cell;
  }
  return d;
}

/** Fine mean curvature in grid units over `rings` smoothings (the umbrella operator, see FormShade). */
export function fineCurvature(mesh: MeshData, adj: Int32Array[], cell: number, rings: number = MINIATURE.edgeRings): Float32Array {
  const P = mesh.positions, N = mesh.normals, n = P.length / 3;
  let H = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const nb = adj[i];
    if (nb.length === 0) continue;
    let ux = 0, uy = 0, uz = 0, l2 = 0;
    for (const j of nb) {
      const dx = P[j * 3] - P[i * 3], dy = P[j * 3 + 1] - P[i * 3 + 1], dz = P[j * 3 + 2] - P[i * 3 + 2];
      ux += dx; uy += dy; uz += dz; l2 += dx * dx + dy * dy + dz * dz;
    }
    ux /= nb.length; uy /= nb.length; uz /= nb.length; l2 /= nb.length;
    H[i] = cell * (-2 * (ux * N[i * 3] + uy * N[i * 3 + 1] + uz * N[i * 3 + 2])) / Math.max(l2, 1e-12);
  }
  for (let r = 0; r < rings; r++) {
    const S = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = H[i]; for (const j of adj[i]) s += H[j]; S[i] = s / (adj[i].length + 1); }
    H = S;
  }
  return H;
}

/** A smooth 3-D value noise in [0, 1] from a hash of the lattice (deterministic, no seed state). */
export function valueNoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number, c: number) => {
    let k = Math.imul(a, 0x8da6b343) ^ Math.imul(b, 0xd8163841) ^ Math.imul(c, 0xcb1ab31f) ^ 0x2545f491;
    k = Math.imul(k ^ (k >>> 15), 0x2c1b3c6d);
    k = Math.imul(k ^ (k >>> 12), 0x297a2d39);
    return ((k ^ (k >>> 15)) >>> 0) / 4294967296;
  };
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

/** The per-vertex miniature terms (0..1 each). Exposed for tests, the probe and the stage metrics. */
export interface MiniatureTerms {
  edge: Float32Array;
  ao: Float32Array;
  /** Vertical position as a share of the body's height (0 = soles, 1 = crown). */
  height: Float32Array;
  weather: Float32Array;
  /** Raw fields: fine curvature κ (grid units) and broad cavity depth (grid units). */
  kappa: Float32Array;
  depth: Float32Array;
}

export function miniatureTerms(mesh: MeshData, adj: Int32Array[], opts: MiniatureOptions): MiniatureTerms {
  const M = MINIATURE, P = mesh.positions, n = P.length / 3;
  const kappa = fineCurvature(mesh, adj, opts.cell);
  const depth = cavityDepth(mesh, adj, opts.cell);
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { const y = P[i * 3 + 1]; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const span = Math.max(1e-6, y1 - y0);
  const edge = new Float32Array(n), ao = new Float32Array(n), height = new Float32Array(n), weather = new Float32Array(n);
  const cloth = new Uint8Array(REGIONS.length);
  for (const r of opts.garment ?? []) { const k = REGIONS.indexOf(r as typeof REGIONS[number]); if (k >= 0) cloth[k] = 1; }
  const f = 1 / M.weatherPeriod;
  for (let i = 0; i < n; i++) ao[i] = smooth01(M.aoOnset, M.aoFull, depth[i]);
  // The wash is SOFT: averaged over AO_RINGS 1-rings so a crease fades out over a few vertices (a hard
  // AO ramp put cel-band-sized steps along the elbow crease — measured 3.5 % band jumps on the arms).
  for (let r = 0; r < M.aoRings; r++) {
    const S = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = ao[i]; for (const j of adj[i]) s += ao[j]; S[i] = s / (adj[i].length + 1); }
    ao.set(S);
  }
  for (let i = 0; i < n; i++) {
    edge[i] = smooth01(M.edgeOnset, M.edgeFull, kappa[i]);
    const t = (P[i * 3 + 1] - y0) / span;
    height[i] = t;
    if (cloth[mesh.region[i]]) {
      const nz = valueNoise(P[i * 3] * f, P[i * 3 + 1] * f, P[i * 3 + 2] * f) * 0.65 + valueNoise(P[i * 3] * f * 2.7 + 11, P[i * 3 + 1] * f * 2.7, P[i * 3 + 2] * f * 2.7) * 0.35;
      const rising = 1 - smooth01(0.12, 0.5, t);
      weather[i] = Math.max(0, Math.min(1, smooth01(0.42, 0.78, nz) * (0.45 + 0.55 * rising) + 0.5 * ao[i]));
    }
  }
  return { edge, ao, height, weather, kappa, depth };
}

/**
 * Apply the miniature pass to sRGB channels `s` (3 per vertex, in place) given the unpainted base `s0`
 * (sRGB, for the darkening clamp). Regions in `opts.skip` are left untouched. Returns `s`.
 */
export function applyMiniatureSrgb(mesh: MeshData, s: Float32Array | Float64Array, s0: Float32Array | Float64Array, terms: MiniatureTerms, opts: MiniatureOptions): Float32Array | Float64Array {
  const g = opts.strength ?? 1;
  if (g <= 0) return s;
  const M = MINIATURE, N = mesh.normals, n = mesh.positions.length / 3;
  const skip = new Uint8Array(REGIONS.length), cloth = new Uint8Array(REGIONS.length);
  for (const r of opts.skip ?? []) { const k = REGIONS.indexOf(r as typeof REGIONS[number]); if (k >= 0) skip[k] = 1; }
  for (const r of opts.garment ?? []) { const k = REGIONS.indexOf(r as typeof REGIONS[number]); if (k >= 0) cloth[k] = 1; }
  const lo = 1 - PAINT_MAX_DARK;
  for (let i = 0; i < n; i++) {
    const reg = mesh.region[i];
    if (skip[reg]) continue;
    const t = terms.height[i];
    const below = 1 - smooth01(M.chiaroTop, M.chiaroTop + M.chiaroFade, t); // 1 below the shoulders
    const chiaro = 1 - g * M.chiaroDark * (1 - smooth01(0, M.chiaroTop, t));
    const ny = N[i * 3 + 1];
    const zen = g * below * (M.zenithLight * Math.max(0, ny));
    const zenDark = 1 - g * below * M.zenithDark * Math.max(0, -ny);
    const ao = g * terms.ao[i], edge = g * terms.edge[i] * M.edgeLight, w = cloth[reg] ? g * terms.weather[i] : 0;
    let r = s[i * 3], gg = s[i * 3 + 1], b = s[i * 3 + 2];
    // Weathering: grime + fade (cloth only).
    if (w > 0) {
      const m = (r + gg + b) / 3, fade = M.weatherFade * w, mix = M.weatherMax * w;
      r += (m - r) * fade; gg += (m - gg) * fade; b += (m - b) * fade;
      r += (M.grime[0] - r) * mix; gg += (M.grime[1] - gg) * mix; b += (M.grime[2] - b) * mix;
    }
    // Cavity wash: darker, pigment pooled (more saturated).
    if (ao > 0) {
      const m = (r + gg + b) / 3, sat = 1 + M.aoSat * ao, k = 1 - M.aoDark * ao;
      r = (m + (r - m) * sat) * k; gg = (m + (gg - m) * sat) * k; b = (m + (b - m) * sat) * k;
    }
    // Chiaroscuro: the vertical gradient and the zenithal underside shade.
    const dk = chiaro * zenDark;
    r *= dk; gg *= dk; b *= dk;
    // Edge highlight toward a lighter tint of the colour, and the zenithal top light.
    const lift = Math.min(1, edge + zen);
    // (the target is base + EDGE_TINT·(white − base); moving `lift` of the way there.)
    if (lift > 0) { const k = M.edgeTint * lift; r += (1 - r) * k; gg += (1 - gg) * k; b += (1 - b) * k; }
    s[i * 3] = Math.max(lo * s0[i * 3], Math.min(1, r));
    s[i * 3 + 1] = Math.max(lo * s0[i * 3 + 1], Math.min(1, gg));
    s[i * 3 + 2] = Math.max(lo * s0[i * 3 + 2], Math.min(1, b));
  }
  return s;
}

/** Contrast metrics of a painted body against its unpainted base (both LINEAR rgb, 3 per vertex). */
export interface MiniatureMetrics {
  /** Mean painted/base sRGB-luminance ratio on the RIDGE vertices (top decile of fine curvature κ). */
  ridge: number;
  /** The same on the CAVITY vertices (top decile of the broad cavity depth). */
  cavity: number;
  /** ridge / cavity: how much more the paint separates convex from concave than the base did (1 = none). */
  contrast: number;
  /** Mean ratio on the top fifth (shoulders up) and the bottom fifth (shins/feet) of the height. */
  top: number;
  bottom: number;
  /** Share of garment vertices with weathering weight >= 0.25. */
  weathered: number;
  ridgeN: number;
  cavityN: number;
}

const toS = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const lumS = (rgb: Float32Array, i: number) => 0.2126 * toS(rgb[i * 3]) + 0.7152 * toS(rgb[i * 3 + 1]) + 0.0722 * toS(rgb[i * 3 + 2]);

/** Measure a paint (see MiniatureMetrics). `skip` regions are excluded (the form paint never touches them). */
export function miniatureMetrics(
  mesh: MeshData, base: Float32Array, painted: Float32Array, terms: MiniatureTerms, skip: readonly string[] = [], garment: readonly string[] = [],
): MiniatureMetrics {
  const n = mesh.positions.length / 3;
  const sk = new Set(skip.map((r) => REGIONS.indexOf(r as typeof REGIONS[number])));
  const cl = new Set(garment.map((r) => REGIONS.indexOf(r as typeof REGIONS[number])));
  const ids: number[] = [];
  for (let i = 0; i < n; i++) if (!sk.has(mesh.region[i])) ids.push(i);
  const decile = (f: Float32Array) => { const s = ids.map((i) => f[i]).sort((a, b) => a - b); return s[Math.floor(0.9 * (s.length - 1))]; };
  const kT = decile(terms.kappa), dT = decile(terms.depth);
  let r = 0, nr = 0, c = 0, nc = 0, tp = 0, nt = 0, bt = 0, nb = 0, w = 0, nw = 0;
  for (const i of ids) {
    const q = lumS(painted, i) / Math.max(1e-6, lumS(base, i));
    if (terms.kappa[i] >= kT) { r += q; nr++; }
    if (terms.depth[i] >= dT) { c += q; nc++; }
    if (terms.height[i] >= 0.8) { tp += q; nt++; }
    if (terms.height[i] <= 0.2) { bt += q; nb++; }
    if (cl.has(mesh.region[i])) { nw++; if (terms.weather[i] >= 0.25) w++; }
  }
  const ridge = r / Math.max(1, nr), cavity = c / Math.max(1, nc);
  return { ridge, cavity, contrast: ridge / Math.max(1e-6, cavity), top: tp / Math.max(1, nt), bottom: bt / Math.max(1, nb), weathered: w / Math.max(1, nw), ridgeN: nr, cavityN: nc };
}
