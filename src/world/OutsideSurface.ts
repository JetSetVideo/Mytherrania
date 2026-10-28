// OutsideSurface: the ground BEYOND the ring as a triangle mesh that follows the
// heightfield (lane E2: R07, R13), as plain typed arrays (no Three.js), plus the matching
// floor sampler, so the outside holes, cliffs and swells the generator places out there are
// drawn and physical, instead of a flat plane.
//
// Layout (polar, the ring's own S segments so the seam has no T-junction):
//   rows k = 0..K      field-following rings: radius(j, k) = lerp(rim_j, outerRadius, k / K)
//                      along bearing j; y = baseY + heightAt(field). Row 0 lies exactly on the
//                      ring's rim vertices (x, z), at the OUTSIDE height.
//   row K + 1          the far apron: radius farRadius, y = farY (flat to the horizon, like
//                      the old outside plane). Row K takes the apron's up normal (no radial
//                      shading streaks along the long apron triangles).
//   seam row           S vertices on the rim at min(rimFloorY, outsideY): with row 0 they form
//                      an inward-facing wall wherever the outside stands ABOVE the ring floor
//                      (a raised outside cliff side at the rim); where the outside is lower the
//                      ring's own skirt (RingSurface, skirtBottomAt) reaches down to it and this
//                      strip collapses to zero area.
// Triangles:  2 S K (field bands) + 2 S (apron) + 2 S (seam) = 2 S (K + 2).
// K = clamp(ceil((outerRadius - maxRim) / cell), 1, floor(budget / (2 S)) - 2): one cell per
// radial step, cut to fit the triangle budget (TERRAIN_TRIANGLE_BUDGET minus the ring).
//
// Pure module: no Three.js, no DOM.
import { clamp, lerp } from "../core/MathCore.ts";
import { heightAt, normalAt, rNormAt, type ArenaOutline, type Heightfield } from "./Heightfield.ts";
import { surfaceHeightAt, type RingSurface } from "./RingSurface.ts";

/** Triangles the whole terrain (ring + outside) may use, the R13 budget the parent set for the default arena. */
export const TERRAIN_TRIANGLE_BUDGET = 6000;
/** Linear RGB of the old flat outside plane (#8d8a83 through THREE.Color's sRGB -> linear): the unpainted default. */
export const OUTSIDE_COLOUR: [number, number, number] = [0.266, 0.244, 0.231];

/** Resolution and extent. */
export interface OutsideLayout {
  /** Segments (= the ring's). */
  segments: number;
  /** Field-following bands between the rim and outerRadius. */
  bands: number;
  /** Radius of the last field-following row, m: the grid's inscribed half-extent minus one cell (normals stay on the grid). */
  outerRadius: number;
  /** Radius of the far apron, m: 4 arenaRadius + 40 (the old outside plane's half-width, (4 size + 80) / 2). */
  farRadius: number;
}

/** The built outside: typed arrays ready for a BufferGeometry. */
export interface OutsideSurface {
  layout: OutsideLayout;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  fieldTriangles: number;
  apronTriangles: number;
  seamTriangles: number;
  triangleCount: number;
  /** Rim radius per segment, m (copied from the ring). */
  rimRadius: Float32Array;
  /** ArenaConfig.outsideHeight: the outside datum, m. */
  baseY: number;
  /** y of the far apron, m: baseY + the median field height along row K. */
  farY: number;
}

/** Options for buildOutsideSurface. */
export interface OutsideOptions {
  /** Outside datum, m (ArenaConfig.outsideHeight). Default -1. */
  baseY?: number;
  /** Triangles this mesh may use. Default TERRAIN_TRIANGLE_BUDGET - ring.triangleCount (at least 6 S). */
  triangleBudget?: number;
  /** Far apron radius override, m. */
  farRadius?: number;
}

/** Derived layout (see the header). */
export function outsideLayoutFor(field: Heightfield, ring: RingSurface, options: OutsideOptions = {}): OutsideLayout {
  const S = ring.layout.segments;
  let maxRim = 0;
  for (let j = 0; j < S; j++) maxRim = Math.max(maxRim, ring.rimRadius[j]);
  const half = Math.min((field.cols - 1) * field.cell, (field.rows - 1) * field.cell) / 2;
  const outerRadius = Math.max(maxRim + field.cell, half - field.cell);
  const budget = options.triangleBudget ?? Math.max(6 * S, TERRAIN_TRIANGLE_BUDGET - ring.triangleCount);
  const bands = clamp(Math.ceil((outerRadius - maxRim) / field.cell), 1, Math.max(1, Math.floor(budget / (2 * S)) - 2));
  const farRadius = options.farRadius ?? Math.max(outerRadius + field.cell, 4 * field.rules.base.arenaRadius + 40);
  return { segments: S, bands, outerRadius, farRadius };
}

/** Vertex index of field row k (0..K) or the apron (k = K + 1), segment j. */
function oIndex(S: number, k: number, j: number): number {
  return k * S + (((j % S) + S) % S);
}

/**
 * Build (or rebuild into `reuse` when the layout matches) the outside of `field` around
 * `ring`. Colours are OUTSIDE_COLOUR until a painter (TerrainPaint) overwrites them.
 */
export function buildOutsideSurface(field: Heightfield, _outline: ArenaOutline, ring: RingSurface, options: OutsideOptions = {}, reuse?: OutsideSurface): OutsideSurface {
  const layout = outsideLayoutFor(field, ring, options);
  const S = layout.segments, K = layout.bands;
  const seamStart = (K + 2) * S, vertexCount = seamStart + S;
  const fieldTriangles = 2 * S * K, apronTriangles = 2 * S, seamTriangles = 2 * S;
  const triangleCount = fieldTriangles + apronTriangles + seamTriangles;
  const same = reuse && reuse.layout.segments === S && reuse.layout.bands === K;
  const positions = same ? reuse.positions : new Float32Array(vertexCount * 3);
  const normals = same ? reuse.normals : new Float32Array(vertexCount * 3);
  const colors = same ? reuse.colors : new Float32Array(vertexCount * 3);
  const indices = same ? reuse.indices : new Uint32Array(triangleCount * 3);
  const rimRadius = same ? reuse.rimRadius : new Float32Array(S);
  rimRadius.set(ring.rimRadius.subarray(0, S));
  const baseY = options.baseY ?? -1;
  const n = { x: 0, y: 1, z: 0 };
  const put = (v: number, x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    positions[v * 3] = x; positions[v * 3 + 1] = y; positions[v * 3 + 2] = z;
    normals[v * 3] = nx; normals[v * 3 + 1] = ny; normals[v * 3 + 2] = nz;
    colors[v * 3] = OUTSIDE_COLOUR[0]; colors[v * 3 + 1] = OUTSIDE_COLOUR[1]; colors[v * 3 + 2] = OUTSIDE_COLOUR[2];
  };
  const outer: number[] = [];
  for (let k = 0; k <= K; k++) {
    for (let j = 0; j < S; j++) {
      const a = (2 * Math.PI * j) / S, r = lerp(rimRadius[j], layout.outerRadius, k / K);
      const x = Math.cos(a) * r, z = Math.sin(a) * r, y = baseY + heightAt(field, x, z);
      // The last field row shares the apron's up normal: the long apron triangles then shade flat
      // instead of smearing the field's last normals into radial streaks.
      if (k === K) { n.x = 0; n.y = 1; n.z = 0; } else normalAt(field, x, z, n);
      put(oIndex(S, k, j), x, y, z, n.x, n.y, n.z);
      if (k === K) outer.push(y);
    }
  }
  outer.sort((p, q) => p - q);
  const farY = outer[outer.length >> 1];
  for (let j = 0; j < S; j++) {
    const a = (2 * Math.PI * j) / S;
    put(oIndex(S, K + 1, j), Math.cos(a) * layout.farRadius, farY, Math.sin(a) * layout.farRadius, 0, 1, 0);
  }
  // Seam row: on the rim at min(ring floor, outside); normal = inward horizontal.
  const ringRim = (j: number) => 1 + (ring.layout.rings - 1) * ring.layout.segments + (((j % S) + S) % S);
  for (let j = 0; j < S; j++) {
    const o = oIndex(S, 0, j), r = ringRim(j);
    const prev = ringRim(j - 1), next = ringRim(j + 1);
    const tx = ring.positions[next * 3] - ring.positions[prev * 3], tz = ring.positions[next * 3 + 2] - ring.positions[prev * 3 + 2];
    const len = Math.hypot(tx, tz) || 1;
    put(seamStart + j, positions[o * 3], Math.min(ring.positions[r * 3 + 1], positions[o * 3 + 1]), positions[o * 3 + 2], -tz / len, 0, tx / len);
  }
  let t = 0;
  const tri = (a: number, b: number, c: number) => { indices[t++] = a; indices[t++] = b; indices[t++] = c; };
  for (let k = 0; k <= K; k++) { // field bands k -> k + 1, then the apron band K -> K + 1
    for (let j = 0; j < S; j++) {
      const a = oIndex(S, k, j), b = oIndex(S, k, j + 1), c = oIndex(S, k + 1, j + 1), d = oIndex(S, k + 1, j);
      tri(a, b, d);
      tri(b, c, d);
    }
  }
  for (let j = 0; j < S; j++) { // seam: top = row 0 (outside height), bottom = seam row; faces inward
    const t0 = oIndex(S, 0, j), t1 = oIndex(S, 0, j + 1), b0 = seamStart + j, b1 = seamStart + ((j + 1) % S);
    tri(t0, b0, t1);
    tri(t1, b0, b1);
  }
  return {
    layout, positions, normals, colors, indices, vertexCount,
    fieldTriangles, apronTriangles, seamTriangles, triangleCount, rimRadius, baseY, farY,
  };
}

/** Scratch barycentric weights (allocation-free sampler). */
const W = new Float64Array(3);

/** Height of triangle (a, b, c) at (x, z) if inside (with tolerance), else NaN. */
function triangleY(p: Float32Array, a: number, b: number, c: number, x: number, z: number): number {
  const ax = p[a * 3], az = p[a * 3 + 2], bx = p[b * 3], bz = p[b * 3 + 2], cx = p[c * 3], cz = p[c * 3 + 2];
  const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(det) < 1e-12) return NaN;
  W[0] = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
  W[1] = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
  W[2] = 1 - W[0] - W[1];
  if (W[0] < -1e-6 || W[1] < -1e-6 || W[2] < -1e-6) return NaN;
  return W[0] * p[a * 3 + 1] + W[1] * p[b * 3 + 1] + W[2] * p[c * 3 + 1];
}

/**
 * Height of the DRAWN outside at world (x, z), m, or NaN when (x, z) is inside the rim or
 * beyond the far apron. O(1): segment from the angle, band from the radius, neighbours tried.
 */
export function outsideHeightAt(o: OutsideSurface, x: number, z: number): number {
  const S = o.layout.segments, K = o.layout.bands;
  let angle = Math.atan2(z, x);
  if (angle < 0) angle += 2 * Math.PI;
  const jf = (angle / (2 * Math.PI)) * S;
  const j = Math.min(S - 1, Math.floor(jf)), j1 = (j + 1) % S;
  const rim = lerp(o.rimRadius[j], o.rimRadius[j1], jf - j), dist = Math.hypot(x, z);
  const guess = dist >= o.layout.outerRadius ? K : Math.floor(((dist - rim) / Math.max(1e-9, o.layout.outerRadius - rim)) * K);
  for (const k of [guess, guess - 1, guess + 1]) {
    if (k < 0 || k > K) continue;
    const a = oIndex(S, k, j), b = oIndex(S, k, j1), c = oIndex(S, k + 1, j1), d = oIndex(S, k + 1, j);
    let h = triangleY(o.positions, a, b, d, x, z);
    if (Number.isNaN(h)) h = triangleY(o.positions, b, c, d, x, z);
    if (!Number.isNaN(h)) return h;
  }
  return NaN;
}

/**
 * The floor function physics should call when the outside is drawn: the ring's drawn
 * triangles inside, the outside's drawn triangles beyond the rim, the far apron height past
 * it. A point inside the true outline but outside the rim's chords (a sliver a few mm wide
 * on curved outlines) reads the field height, so a fighter on the ring never reads the lower
 * outside ground. Allocation-free.
 */
export function makeTerrainFloorSampler(ring: RingSurface, outside: OutsideSurface, field: Heightfield, outline: ArenaOutline): (x: number, z: number) => number {
  return (x: number, z: number) => {
    const h = surfaceHeightAt(ring, x, z);
    if (!Number.isNaN(h)) return h;
    if (rNormAt(outline, x, z) <= 1) return heightAt(field, x, z);
    const o = outsideHeightAt(outside, x, z);
    if (!Number.isNaN(o)) return o;
    return Math.hypot(x, z) > outside.layout.outerRadius ? outside.farY : outside.baseY + heightAt(field, x, z);
  };
}
