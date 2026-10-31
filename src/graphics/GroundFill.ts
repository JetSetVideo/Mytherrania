// GroundFill: the terrain fill / skirt layer (lane I-C).
//
// WHY (the user's own words): "the surface is already connected to the ground but not fully …
// another layer in the generation system for the ground … forms that would be met with the terrain
// to close the gaps depending on which ground they've been put on … add some sand if it's partially
// on the sand". A prop or platform placed with its base at the terrain height sampled at the
// CENTRE floats on a slope (the downhill rim hangs in the air) and floats by a CONSTANT amount on
// any model whose origin is not its base. Two pure helpers fix that, plus this apron:
//
//   footHeight / seatingY  measure the terrain under a circular footprint (rim + centre) and return
//                          its MAX, so a base placed there can never float; the apron below then
//                          covers the uphill overlap.
//   materialUnder          votes the ground material the fill should be coloured as (sand if it
//                          mostly stands on sand), ties resolved by the centre.
//   skirtFor               a closed apron from the base edge DOWN to the terrain, bevelled so it
//                          does not read as a flat disc rim.
//   propBaseOffset (in PropModels.ts)  the model's base offset, so the caller seats it exactly.
//
// GEOMETRY CHOICE: a skirt is engineering geometry (a seam filler), not an organic body, so a ring
// is correct here — the body-shape contract (docs/DESIGN.md 20-25: no primitives, no flat discs,
// no right angles where a surface shows) governs BODIES, and this apron is never a body. Its outer
// edge is still bevelled/flared (4 rings, not a hard cylinder wall) so no flat disc rim shows.
//
// Pure module apart from the THREE geometry it returns. No randomness.
// @deno-types="@types/three"
import * as THREE from "three";

/** The ground materials a fill can be coloured as. Superset of Terrain.ts's GroundMaterial bands. */
export type GroundMaterialId = "stone" | "grass" | "sand" | "wood" | "ice" | "rock";

/** One fill/skirt run: a circular base edge at (x, z), its top at y, radius (m) and rotation (rad). */
export interface FillRun {
  x: number;
  z: number;
  y: number;
  radius: number;
  rotation: number;
  material: GroundMaterialId;
}

/** The built apron plus what a caller wants to budget: triangle count and the deepest drop used (m). */
export interface SkirtResult {
  geometry: THREE.BufferGeometry;
  triangles: number;
  maxDrop: number;
}

/** Terrain under a circular footprint, metres. */
export interface Footprint {
  min: number;
  max: number;
  mean: number;
  range: number;
}

/** Canonical material order, used only to break a tie that the centre does not decide. */
const MATERIALS: readonly GroundMaterialId[] = ["stone", "grass", "sand", "wood", "ice", "rock"];

/**
 * The terrain under a circular footprint: `count` samples around the rim (evenly spaced, first at
 * angle 0) plus the centre. Heights in metres. `count` defaults to 16.
 */
export function footHeight(
  sample: (x: number, z: number) => number,
  x: number,
  z: number,
  radius: number,
  count = 16,
): Footprint {
  const centre = sample(x, z);
  let min = centre, max = centre, sum = centre, n = 1;
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2;
    const h = sample(x + Math.cos(a) * radius, z + Math.sin(a) * radius);
    if (h < min) min = h;
    if (h > max) max = h;
    sum += h;
    n++;
  }
  return { min, max, mean: sum / n, range: max - min };
}

/**
 * Where a prop's base must sit so that NO point of its footprint is above the ground: the footprint
 * MAX. Placing the base here can never float; the uphill overlap (from max down to min) is covered
 * by the apron from `skirtFor`. Units: metres.
 */
export function seatingY(
  sample: (x: number, z: number) => number,
  x: number,
  z: number,
  radius: number,
  count = 16,
): number {
  return footHeight(sample, x, z, radius, count).max;
}

/**
 * Which material a fill should be coloured as: the most common ground material over the centre and
 * 8 evenly-spaced rim points. Ties are resolved by the CENTRE (the material directly under it wins).
 */
export function materialUnder(
  sampleMaterial: (x: number, z: number) => GroundMaterialId,
  x: number,
  z: number,
  radius: number,
): GroundMaterialId {
  const centre = sampleMaterial(x, z);
  const counts = new Map<GroundMaterialId, number>();
  counts.set(centre, 1);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const m = sampleMaterial(x + Math.cos(a) * radius, z + Math.sin(a) * radius);
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  let best = 0;
  for (const m of MATERIALS) best = Math.max(best, counts.get(m) ?? 0);
  if ((counts.get(centre) ?? 0) === best) return centre; // the centre decides a tie
  for (const m of MATERIALS) if ((counts.get(m) ?? 0) === best) return m;
  return centre;
}

// Apron profile: 4 rings, radius growing outward as it descends and the top bevelled, so the outer
// edge is a rounded shoulder rather than a flat disc rim. ring 0 sits exactly on the base edge
// (radius + lip); ring 3 meets the terrain. R_MUL is the radius multiplier of each ring,
// RING_T its fraction of the way from the base edge down to that vertex's own terrain.
const RINGS = 4;
const R_MUL = [1.0, 1.05, 1.11, 1.18];
const RING_T = [0, 0.16, 0.52, 1];

/**
 * Build the apron of one fill run: a closed ring of `segments` vertices (default 24) on the run's
 * base edge — radius + `lip` (default 0.06 m) outward — each carried DOWN to the terrain under it,
 * stitched into a closed strip and bevelled outward as it descends.
 *
 * Per vertex the bottom is `terrainY - 0.02` (buried 2 cm so the seam has no gap), clamped so it is
 * never below the base by more than `maxDrop` (default 0.6 m) and never above the base:
 *   bottom = clamp(terrainY - 0.02, baseY - maxDrop, baseY).  (Units: metres.)
 * On a flat ground the base and the terrain coincide, so the deepest drop is the 2 cm burial (~0);
 * on a slope it is the footprint fall plus that burial, i.e. the apron reaches the terrain everywhere.
 *
 * Triangles: (RINGS - 1) × segments × 2 = 6 × segments, so `triangles <= segments × 2 × 3` always.
 * The readable `maxDrop` is the deepest drop actually used (baseY - lowest vertex), metres.
 */
export function skirtFor(
  run: FillRun,
  sample: (x: number, z: number) => number,
  opts: { segments?: number; lip?: number; maxDrop?: number } = {},
): SkirtResult {
  const segments = Math.max(3, Math.floor(opts.segments ?? 24));
  const lip = opts.lip ?? 0.06;
  const dropLimit = opts.maxDrop ?? 0.6;
  const baseY = run.y;
  const rBase = Math.max(0, run.radius) + lip;
  const floorY = baseY - dropLimit;

  // bottom(x, z): the terrain there, buried 2 cm, clamped into [baseY - maxDrop, baseY].
  const bottom = (x: number, z: number): number => {
    const t = sample(x, z);
    let b = Number.isFinite(t) ? t - 0.02 : floorY;
    if (b > baseY) b = baseY;
    if (b < floorY) b = floorY;
    return b;
  };

  // Vertex grid: v[i][k] for ring i and segment k. Allocation is one-shot (build time, not per frame).
  const px = new Float64Array(RINGS * segments), py = new Float64Array(RINGS * segments), pz = new Float64Array(RINGS * segments);
  for (let i = 0; i < RINGS; i++) {
    for (let k = 0; k < segments; k++) {
      const a = run.rotation + (k / segments) * Math.PI * 2;
      const rr = rBase * R_MUL[i];
      const x = run.x + Math.cos(a) * rr;
      const z = run.z + Math.sin(a) * rr;
      const n = i * segments + k;
      px[n] = x;
      pz[n] = z;
      py[n] = baseY + RING_T[i] * (bottom(x, z) - baseY);
    }
  }

  const triangles = (RINGS - 1) * segments * 2;
  const position = new Float32Array(triangles * 3 * 3); // 3 vertices × 3 floats, non-indexed
  let o = 0;
  const at = (i: number, k: number): [number, number, number] => {
    const n = i * segments + (k % segments);
    return [px[n], py[n], pz[n]];
  };
  for (let i = 0; i < RINGS - 1; i++) {
    for (let k = 0; k < segments; k++) {
      const k2 = (k + 1) % segments;
      const a = at(i, k), b = at(i + 1, k), c = at(i + 1, k2), d = at(i, k2);
      // quad a-b-c-d -> triangles (a, b, c) and (a, c, d)
      for (const v of [a, b, c, a, c, d]) {
        position[o++] = v[0];
        position[o++] = v[1];
        position[o++] = v[2];
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.computeVertexNormals();

  let deepest = baseY;
  for (let n = 0; n < py.length; n++) if (py[n] < deepest) deepest = py[n];
  return { geometry, triangles, maxDrop: baseY - deepest };
}
