// RingSurface: the arena floor as a triangle mesh that follows the ring OUTLINE exactly,
// as plain typed arrays (no Three.js), plus the matching floor sampler (R07, R13).
//
// Layout (polar, shared vertices):
//   vertex 0                     the centre
//   vertex 1 + (i-1)*S + j       ring i in 1..R, segment j in 0..S-1, at
//                                angle_j = 2 pi j / S, radius = (i / R) * radiusAt(angle_j)
//   then S skirt-top + S skirt-bottom vertices (the rim duplicated, so the floor's smooth
//   normals and the skirt's outward normals do not average into a soft edge)
// Triangles:  centre fan S + bands 2 S (R - 1) + skirt 2 S  =  S (2R + 1)
//
// R = ceil(maxRadius / cell) and S = 24 * ceil(2 pi maxRadius / (24 cell)) (clamped), so a
// triangle edge is about one heightfield cell everywhere and S is divisible by 3, 4, 6
// and 8: triangle, square, hexagon and octagon corners land exactly on vertices.
//
// `surfaceHeightAt` returns the height of THESE triangles (not the bilinear field), so a
// body standing on it is exactly on the drawn floor: no sinking feet (R03).
// Pure module: no Three.js, no DOM.
import { clamp, clamp01, lerp } from "../core/MathCore.ts";
import { materialAt, type GroundMaterial } from "../game/Terrain.ts";
import { FEATURE_CLIFF, FEATURE_HOLE, FEATURE_RAMP, heightAt, nearestNode, normalAt, outlineMaxRadius, type ArenaOutline, type Heightfield } from "./Heightfield.ts";

/** Base colours (linear-ish sRGB 0..1) of the ground materials of Terrain.ts. */
export const GROUND_COLOURS: Record<GroundMaterial, [number, number, number]> = {
  stone: [0.62, 0.61, 0.57],
  wood: [0.63, 0.47, 0.31],
  sand: [0.87, 0.67, 0.33], // the old flat floor's #dfaa55
  ice: [0.8, 0.9, 0.94],
};
/** Colour of the skirt (the cut face of the platform). */
export const SKIRT_COLOUR: [number, number, number] = [0.36, 0.29, 0.23];
/** Thickness of the platform below its lowest floor point, m (the old extruded floor depth). */
export const FLOOR_THICKNESS = 0.6;

/** Mesh resolution. */
export interface RingLayout {
  /** Concentric vertex rings beyond the centre. */
  rings: number;
  /** Vertices per ring. */
  segments: number;
}

/** The built surface: typed arrays ready for a BufferGeometry. */
export interface RingSurface {
  layout: RingLayout;
  /** xyz per vertex, m. */
  positions: Float32Array;
  /** Unit normal per vertex. */
  normals: Float32Array;
  /** rgb per vertex, 0..1. */
  colors: Float32Array;
  /** Triangle vertex indices, counter-clockwise seen from outside (+y for the floor). */
  indices: Uint32Array;
  vertexCount: number;
  /** Floor triangles (fan + bands) and skirt triangles; triangleCount is their sum. */
  floorTriangles: number;
  skirtTriangles: number;
  triangleCount: number;
  /** radiusAt(angle_j) per segment, m (the sampler needs it). */
  rimRadius: Float32Array;
  /** y of the skirt's bottom edge, m. */
  skirtBottomY: number;
}

/** Options for buildRingSurface. */
export interface RingSurfaceOptions {
  /** Override the derived resolution. */
  layout?: Partial<RingLayout>;
  /** Radius used for the material bands (materialAt), m. Default: the outline's smallest radius. */
  ringHalf?: number;
  /** y of the skirt bottom, m. Default: lowest floor vertex - FLOOR_THICKNESS. */
  skirtBottomY?: number;
  /**
   * Per-rim-vertex skirt bottom (lane E2): the skirt reaches down to min(rim floor,
   * skirtBottomAt(x, z)), so it meets a drawn outside ground (OutsideSurface) exactly.
   * Overrides skirtBottomY; the result's skirtBottomY is then the lowest bottom.
   */
  skirtBottomAt?: (x: number, z: number) => number;
}

/** Derived resolution: one cell per triangle edge, segments a multiple of 24, capped at 768. */
export function ringLayoutFor(field: Heightfield, outline: ArenaOutline): RingLayout {
  const maxR = outlineMaxRadius(outline);
  const rings = Math.max(2, Math.ceil(maxR / field.cell));
  const segments = clamp(24 * Math.ceil((2 * Math.PI * maxR) / (24 * field.cell)), 24, 768);
  return { rings, segments };
}

/** Index of floor vertex (ring i >= 1, segment j). */
function vIndex(layout: RingLayout, i: number, j: number): number {
  return 1 + (i - 1) * layout.segments + (((j % layout.segments) + layout.segments) % layout.segments);
}

/**
 * Build (or rebuild into `reuse` when the layout matches: no new arrays) the floor surface
 * of `field` clipped to `outline`, with a skirt down to skirtBottomY.
 */
export function buildRingSurface(field: Heightfield, outline: ArenaOutline, options: RingSurfaceOptions = {}, reuse?: RingSurface): RingSurface {
  const layout = { ...ringLayoutFor(field, outline), ...options.layout };
  const R = layout.rings, S = layout.segments;
  const floorVerts = 1 + R * S, vertexCount = floorVerts + 2 * S;
  const floorTriangles = S + 2 * S * (R - 1), skirtTriangles = 2 * S;
  const same = reuse && reuse.layout.rings === R && reuse.layout.segments === S;
  const positions = same ? reuse.positions : new Float32Array(vertexCount * 3);
  const normals = same ? reuse.normals : new Float32Array(vertexCount * 3);
  const colors = same ? reuse.colors : new Float32Array(vertexCount * 3);
  const indices = same ? reuse.indices : new Uint32Array((floorTriangles + skirtTriangles) * 3);
  const rimRadius = same ? reuse.rimRadius : new Float32Array(S);
  let ringHalf = options.ringHalf ?? Infinity;
  for (let j = 0; j < S; j++) {
    rimRadius[j] = outline.radiusAt((2 * Math.PI * j) / S);
    if (options.ringHalf === undefined) ringHalf = Math.min(ringHalf, rimRadius[j]);
  }
  const lo = field.stats.heights.p20, hi = field.stats.heights.p80;
  const n = { x: 0, y: 1, z: 0 };
  const writeFloor = (v: number, x: number, z: number) => {
    const y = heightAt(field, x, z);
    positions[v * 3] = x; positions[v * 3 + 1] = y; positions[v * 3 + 2] = z;
    normalAt(field, x, z, n);
    normals[v * 3] = n.x; normals[v * 3 + 1] = n.y; normals[v * 3 + 2] = n.z;
    // Colour: material band, shaded by height (p20 -> 0.85, p80 -> 1.15: the Pareto cut points),
    // darkened in holes, greyed on cliff faces, lightened on ramps.
    const base = GROUND_COLOURS[materialAt(x, z, ringHalf)];
    let shade = lerp(0.85, 1.15, clamp01(hi > lo ? (y - lo) / (hi - lo) : 0.5));
    const flag = field.featureMask[nearestNode(field, x, z)];
    let grey = 0;
    if (flag === FEATURE_HOLE) shade *= 0.55;
    else if (flag === FEATURE_CLIFF) grey = 0.6;
    else if (flag === FEATURE_RAMP) shade *= 1.08;
    for (let c = 0; c < 3; c++) colors[v * 3 + c] = clamp01(lerp(base[c], 0.45, grey) * shade);
    return y;
  };
  let minY = writeFloor(0, 0, 0);
  for (let i = 1; i <= R; i++) {
    for (let j = 0; j < S; j++) {
      const a = (2 * Math.PI * j) / S, r = (i / R) * rimRadius[j];
      minY = Math.min(minY, writeFloor(vIndex(layout, i, j), Math.cos(a) * r, Math.sin(a) * r));
    }
  }
  let skirtBottomY = options.skirtBottomY ?? minY - FLOOR_THICKNESS;
  if (options.skirtBottomAt) {
    skirtBottomY = Infinity;
    for (let j = 0; j < S; j++) {
      const rim = vIndex(layout, R, j);
      skirtBottomY = Math.min(skirtBottomY, positions[rim * 3 + 1], options.skirtBottomAt(positions[rim * 3], positions[rim * 3 + 2]));
    }
  }
  for (let j = 0; j < S; j++) {
    const rim = vIndex(layout, R, j), top = floorVerts + j, bottom = floorVerts + S + j;
    const bottomY = options.skirtBottomAt
      ? Math.min(positions[rim * 3 + 1], options.skirtBottomAt(positions[rim * 3], positions[rim * 3 + 2]))
      : skirtBottomY;
    // Outward normal from the outline's tangent at this rim vertex: (tz, 0, -tx) normalised.
    const prev = vIndex(layout, R, j - 1), next = vIndex(layout, R, j + 1);
    const tx = positions[next * 3] - positions[prev * 3], tz = positions[next * 3 + 2] - positions[prev * 3 + 2];
    const len = Math.hypot(tx, tz) || 1;
    for (const v of [top, bottom]) {
      positions[v * 3] = positions[rim * 3];
      positions[v * 3 + 1] = v === top ? positions[rim * 3 + 1] : bottomY;
      positions[v * 3 + 2] = positions[rim * 3 + 2];
      normals[v * 3] = tz / len; normals[v * 3 + 1] = 0; normals[v * 3 + 2] = -tx / len;
      colors[v * 3] = SKIRT_COLOUR[0]; colors[v * 3 + 1] = SKIRT_COLOUR[1]; colors[v * 3 + 2] = SKIRT_COLOUR[2];
    }
  }
  let k = 0;
  const tri = (a: number, b: number, c: number) => { indices[k++] = a; indices[k++] = b; indices[k++] = c; };
  for (let j = 0; j < S; j++) tri(0, vIndex(layout, 1, j + 1), vIndex(layout, 1, j)); // centre fan
  for (let i = 1; i < R; i++) {
    for (let j = 0; j < S; j++) {
      const a = vIndex(layout, i, j), b = vIndex(layout, i, j + 1), c = vIndex(layout, i + 1, j + 1), d = vIndex(layout, i + 1, j);
      tri(a, b, d);
      tri(b, c, d);
    }
  }
  for (let j = 0; j < S; j++) {
    const t0 = floorVerts + j, t1 = floorVerts + ((j + 1) % S), b0 = floorVerts + S + j, b1 = floorVerts + S + ((j + 1) % S);
    tri(t0, t1, b0);
    tri(t1, b1, b0);
  }
  return {
    layout, positions, normals, colors, indices, vertexCount,
    floorTriangles, skirtTriangles, triangleCount: floorTriangles + skirtTriangles, rimRadius, skirtBottomY,
  };
}

/** Scratch barycentric weights (allocation-free sampler). */
const BARY = new Float64Array(3);

/** Barycentric weights of (px, pz) in triangle a, b, c (xz plane) into BARY; false if degenerate. */
function barycentric(px: number, pz: number, ax: number, az: number, bx: number, bz: number, cx: number, cz: number): boolean {
  const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(det) < 1e-12) return false;
  BARY[0] = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / det;
  BARY[1] = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / det;
  BARY[2] = 1 - BARY[0] - BARY[1];
  return true;
}

/** Height of triangle (a, b, c) of `s` at (x, z) if the point is inside it (with tolerance), else NaN. */
function triangleHeight(s: RingSurface, a: number, b: number, c: number, x: number, z: number): number {
  const p = s.positions;
  if (!barycentric(x, z, p[a * 3], p[a * 3 + 2], p[b * 3], p[b * 3 + 2], p[c * 3], p[c * 3 + 2])) return NaN;
  const eps = -1e-6;
  if (BARY[0] < eps || BARY[1] < eps || BARY[2] < eps) return NaN;
  return BARY[0] * p[a * 3 + 1] + BARY[1] * p[b * 3 + 1] + BARY[2] * p[c * 3 + 1];
}

/**
 * Height of the DRAWN floor at world (x, z), m, or NaN when (x, z) is outside the ring
 * (the caller then uses its outside ground). O(1): the segment comes from the angle, the
 * ring from the radius, and at most the neighbouring rings are tried.
 */
export function surfaceHeightAt(s: RingSurface, x: number, z: number): number {
  const R = s.layout.rings, S = s.layout.segments;
  let angle = Math.atan2(z, x);
  if (angle < 0) angle += 2 * Math.PI;
  const jf = (angle / (2 * Math.PI)) * S;
  const j = Math.min(S - 1, Math.floor(jf)), j1 = (j + 1) % S;
  const rim = lerp(s.rimRadius[j], s.rimRadius[j1], jf - j);
  const iGuess = Math.floor((Math.hypot(x, z) / Math.max(1e-9, rim)) * R);
  if (iGuess > R) return NaN;
  for (const i of [iGuess, iGuess - 1, iGuess + 1]) {
    if (i < 0 || i >= R) continue;
    if (i === 0) {
      const h = triangleHeight(s, 0, vIndex(s.layout, 1, j1), vIndex(s.layout, 1, j), x, z);
      if (!Number.isNaN(h)) return h;
      continue;
    }
    const a = vIndex(s.layout, i, j), b = vIndex(s.layout, i, j1), c = vIndex(s.layout, i + 1, j1), d = vIndex(s.layout, i + 1, j);
    let h = triangleHeight(s, a, b, d, x, z);
    if (Number.isNaN(h)) h = triangleHeight(s, b, c, d, x, z);
    if (!Number.isNaN(h)) return h;
  }
  return NaN;
}

/**
 * The floor height function physics should call: the DRAWN floor inside the ring; outside
 * it, `outsideBaseY` (ArenaConfig.outsideHeight: the engine's flat outside plane), or
 * `outsideBaseY + field height` when `outsideFollowsTerrain` (only once an outside mesh
 * is drawn to match). Pass outsideBaseY = NaN for a void outside.
 */
export function makeFloorSampler(s: RingSurface, field: Heightfield, outsideBaseY: number, outsideFollowsTerrain = false): (x: number, z: number) => number {
  return (x: number, z: number) => {
    const h = surfaceHeightAt(s, x, z);
    if (!Number.isNaN(h)) return h;
    return outsideFollowsTerrain ? outsideBaseY + heightAt(field, x, z) : outsideBaseY;
  };
}
