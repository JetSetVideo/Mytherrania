// Stitch: weld two lofted body parts into one continuous surface at a joint.
//
// A part (graphics/Loft.ts) ends in a DOME cap: a short run of shrinking rings that
// closes the tube. Where two parts meet, two domes butt: the inner cap is invisible
// and wasted, and the two boundary rings share no vertices, so the seam reads as a
// hard edge instead of a continuous surface.
//
// This module finds each part's BOUNDARY RING — the body's end rim, with the cap dome
// excluded — pairs the two rims by proximity, and, ONLY when they are close enough,
// drops the cap closure at the meeting end and merges the rims onto averaged positions
// so neither part wins. Nothing moves unless the seam is safe: an over-wide gap is
// refused and both parts come back untouched.

// @deno-types="@types/three"
import * as THREE from "three";

/** Which end of a loft: `first` is the root (min y), `last` the tip (max y). */
export type End = "first" | "last";

/** Position rounding used to deduplicate a ring, 6 decimal places. */
const POS_DP = 1e6;
/** Tolerance for treating two ring y-values as the same plane. */
const RING_EPS = 1e-5;
/** Default weld distance, metres. */
const DEFAULT_MAX_WELD = 0.06;

/** The read surface of a BufferAttribute, so indexed and non-indexed both work. */
interface VecAttr {
  count: number;
  getX(i: number): number;
  getY(i: number): number;
  getZ(i: number): number;
}

/** One vertex of a boundary ring: its index in the source geometry and its position. */
interface RingVertex {
  index: number;
  position: THREE.Vector3;
}

/** A ring of the loft: all vertices sharing one y plane, plus that plane's y. */
interface Ring {
  y: number;
  verts: RingVertex[];
}

/** A pairwise-proximity match between two boundary rings. */
interface Pair {
  ai: number;
  bi: number;
  distance: number;
}

/** The verdict on a candidate seam. */
export interface SeamReport {
  pairs: number;
  maxDistance: number;
  meanDistance: number;
  welded: boolean;
  reason: string;
}

/** One geometry contributing to a weld, with the triangles to keep and the moved verts. */
interface Piece {
  geo: THREE.BufferGeometry;
  keep: (i: number) => boolean;
  overrides: Map<number, THREE.Vector3>;
}

function positionAttr(geo: THREE.BufferGeometry): VecAttr {
  const attr = geo.getAttribute("position") as unknown as VecAttr | undefined;
  if (!attr) throw new Error("Stitch: geometry has no position attribute");
  return attr;
}

function finite(v: THREE.Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function posKey(v: THREE.Vector3): string {
  return `${Math.round(v.x * POS_DP)},${Math.round(v.y * POS_DP)},${Math.round(v.z * POS_DP)}`;
}

/** Group the loft's vertices into rings by their y plane, ordered along +y. */
function ringsByY(geo: THREE.BufferGeometry): Ring[] {
  const pos = positionAttr(geo);
  const byPlane = new Map<number, Ring>();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (!Number.isFinite(y)) continue;
    const plane = Math.round(y * POS_DP);
    const ring = byPlane.get(plane) ?? { y, verts: [] };
    ring.verts.push({ index: i, position: new THREE.Vector3(pos.getX(i), y, pos.getZ(i)) });
    byPlane.set(plane, ring);
  }
  return [...byPlane.values()].sort((a, b) => a.y - b.y);
}

/**
 * The body band: the run of evenly spaced rings that form the lofted tube. The cap
 * rings (graphics/Loft.ts) sit outside it at both ends with uneven spacing, so the
 * band's end rings are the rims where the dome attaches to the body.
 */
function bodyBand(rings: Ring[]): { lo: number; hi: number } {
  if (rings.length < 3) return { lo: 0, hi: rings.length - 1 };
  const gaps = rings.slice(1).map((r, i) => r.y - rings[i].y);
  const mid = gaps.length >> 1;
  const g = gaps[mid];
  const tol = Math.max(RING_EPS, Math.abs(g) * 0.02);
  const equal = (d: number): boolean => Math.abs(d - g) <= tol;
  let lo = mid;
  let hi = mid;
  while (lo > 0 && equal(gaps[lo - 1])) lo--;
  while (hi + 1 < gaps.length && equal(gaps[hi + 1])) hi++;
  return { lo, hi: hi + 1 };
}

/**
 * The ring of unique vertices at one end of the loft, the single cap apex excluded.
 * The ring is identified by the position component extremal along the loft's axis: the
 * cap dome is dropped, so `last` returns the body's tip rim and `first` its root rim.
 * Duplicates are collapsed by rounded position (6 dp) so a shared corner appears once.
 */
export function endRing(geo: THREE.BufferGeometry, end: End): RingVertex[] {
  const rings = ringsByY(geo);
  if (rings.length === 0) return [];
  const band = bodyBand(rings);
  const fallback = end === "last" ? rings.length - 1 : 0;
  const rim = rings[end === "last" ? band.hi : band.lo] ?? rings[fallback];
  const seen = new Set<string>();
  const out: RingVertex[] = [];
  for (const v of rim.verts) {
    if (!finite(v.position)) continue;
    const key = posKey(v.position);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/**
 * For each vertex in `a`, its nearest vertex in `b`, one-to-one: a `b` vertex may be
 * the target of at most one pair, and the greedy pass runs closest-first so the
 * shortest matches are never displaced. Deterministic: sorted by distance then `ai`.
 */
export function pairByProximity(a: RingVertex[], b: RingVertex[]): Pair[] {
  const candidates: Pair[] = [];
  for (let ai = 0; ai < a.length; ai++) {
    for (let bi = 0; bi < b.length; bi++) {
      candidates.push({ ai, bi, distance: a[ai].position.distanceTo(b[bi].position) });
    }
  }
  candidates.sort((p, q) => p.distance - q.distance || p.ai - q.ai || p.bi - q.bi);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const pairs: Pair[] = [];
  for (const c of candidates) {
    if (usedA.has(c.ai) || usedB.has(c.bi)) continue;
    usedA.add(c.ai);
    usedB.add(c.bi);
    pairs.push(c);
  }
  pairs.sort((p, q) => p.distance - q.distance || p.ai - q.ai);
  return pairs;
}

/**
 * The decision. Pair the two boundary rings and weld only if the largest pair distance
 * is within `maxWeld` (default 0.06 m). A refused seam leaves both parts untouched; the
 * caller must then not weld rather than force a bad one.
 */
export function planSeam(
  geoA: THREE.BufferGeometry,
  endA: End,
  geoB: THREE.BufferGeometry,
  endB: End,
  opts: { maxWeld?: number } = {},
): { report: SeamReport; pairs: Pair[] } {
  const maxWeld = opts.maxWeld ?? DEFAULT_MAX_WELD;
  const pairs = pairByProximity(endRing(geoA, endA), endRing(geoB, endB));
  const distances = pairs.map((p) => p.distance);
  const maxDistance = distances.length ? Math.max(...distances) : Infinity;
  const meanDistance = distances.length ? distances.reduce((s, d) => s + d, 0) / distances.length : Infinity;
  const welded = pairs.length > 0 && maxDistance <= maxWeld;
  const reason = welded
    ? `${pairs.length} pairs within ${maxWeld} m (max ${maxDistance.toFixed(4)} m)`
    : `largest pair distance ${Number.isFinite(maxDistance) ? `${maxDistance.toFixed(4)} m` : "unbounded"} exceeds maxWeld ${maxWeld} m`;
  return { report: { pairs: pairs.length, maxDistance, meanDistance, welded, reason }, pairs };
}

/**
 * The operation. Returns ONE merged non-indexed geometry: both parts with the
 * meeting-end cap closures dropped (the dome triangles, so no kept triangle references
 * a removed vertex) and the two boundary rims merged so each paired pair shares a
 * single averaged position. The other end's cap is preserved. If the seam is refused,
 * the two geometries are concatenated unchanged — no vertex moved, no triangle dropped.
 */
export function weldSeam(
  geoA: THREE.BufferGeometry,
  endA: End,
  geoB: THREE.BufferGeometry,
  endB: End,
  opts: { maxWeld?: number } = {},
): { geometry: THREE.BufferGeometry; report: SeamReport } {
  const { report, pairs } = planSeam(geoA, endA, geoB, endB, opts);
  if (!report.welded) {
    const geometry = assemble([untouched(geoA), untouched(geoB)]);
    return { geometry, report: { ...report, reason: `${report.reason}; parts left untouched` } };
  }
  const rimA = endRing(geoA, endA);
  const rimB = endRing(geoB, endB);
  const overrides = new Map<number, THREE.Vector3>();
  for (const p of pairs) {
    const avg = rimA[p.ai].position.clone().add(rimB[p.bi].position).multiplyScalar(0.5);
    overrides.set(rimA[p.ai].index, avg);
    overrides.set(rimB[p.bi].index, avg);
  }
  const geometry = assemble([
    { geo: geoA, keep: keepBody(geoA, rimA[0].position.y, endA), overrides },
    { geo: geoB, keep: keepBody(geoB, rimB[0].position.y, endB), overrides },
  ]);
  return { geometry, report: { ...report, reason: `${report.reason}; cap closure dropped, rims merged` } };
}

function untouched(geo: THREE.BufferGeometry): Piece {
  return { geo, keep: () => true, overrides: new Map() };
}

/** Keep only the body: the cap closure beyond the rim is dropped at the meeting end. */
function keepBody(geo: THREE.BufferGeometry, rimY: number, end: End): (i: number) => boolean {
  const pos = positionAttr(geo);
  return (i: number): boolean => {
    const y = pos.getY(i);
    if (!Number.isFinite(y)) return false;
    return end === "last" ? y <= rimY + RING_EPS : y >= rimY - RING_EPS;
  };
}

function indexTriples(geo: THREE.BufferGeometry): number[] {
  const index = geo.getIndex();
  if (index) return Array.from(index.array as ArrayLike<number>);
  const pos = positionAttr(geo);
  return Array.from({ length: pos.count }, (_, i) => i);
}

/** Emit the kept triangles of every piece as one non-indexed geometry. */
function assemble(pieces: Piece[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const piece of pieces) {
    const pos = positionAttr(piece.geo);
    const uv = piece.geo.getAttribute("uv") as unknown as VecAttr | undefined;
    const idx = indexTriples(piece.geo);
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const tri = [idx[t], idx[t + 1], idx[t + 2]];
      if (!tri.every((i) => piece.keep(i))) continue;
      const verts = tri.map((i) => piece.overrides.get(i) ?? new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
      if (!verts.every(finite)) continue;
      for (let k = 0; k < 3; k++) {
        positions.push(verts[k].x, verts[k].y, verts[k].z);
        if (uv) uvs.push(uv.getX(tri[k]), uv.getY(tri[k]));
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (uvs.length) geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return geo;
}
