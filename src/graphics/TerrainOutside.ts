// TerrainOutside: the ground beyond the ring as a Three.js mesh (lane E2: R07, R13).
//
// Wraps the pure OutsideSurface (src/world/OutsideSurface.ts): an annulus from the ring's
// rim out to the heightfield's extent that FOLLOWS the field (outside holes, cliffs and
// swells are drawn), a far apron to the horizon, and an inward seam wall where the outside
// stands above the ring floor. It replaces the flat grey PlaneGeometry of Engine.#buildArena.
// Cost: OutsideSurface.triangleCount = 2 S (K + 2) triangles in ONE draw call; the 12 m
// default arena: S = 96, K = 5 -> 1,344 triangles (ring 2,400 + outside 1,344 = 3,744).
// @deno-types="@types/three"
import * as THREE from "three";
import type { ArenaOutline, Heightfield } from "../world/Heightfield.ts";
import { buildOutsideSurface, type OutsideOptions, type OutsideSurface } from "../world/OutsideSurface.ts";
import type { RingSurface } from "../world/RingSurface.ts";
import { paintOutsideSurface, type TerrainPaintOptions } from "./TerrainPaint.ts";

/** Result of building the outside mesh. */
export interface TerrainOutsideBuild {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  surface: OutsideSurface;
  /** Triangles emitted (field bands + apron + seam). */
  triangleCount: number;
}

/** Options: OutsideSurface options plus the paint (false = the unpainted OUTSIDE_COLOUR). */
export interface TerrainOutsideOptions extends OutsideOptions {
  paint?: TerrainPaintOptions | false;
}

/** Plain typed arrays of an indexed, vertex-coloured triangle mesh. */
export interface MeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

/**
 * Write `arrays` into `geometry`, reusing its attribute arrays when their lengths match
 * (no reallocation, just needsUpdate), else attaching new attributes.
 */
export function writeArraysToGeometry(geometry: THREE.BufferGeometry, arrays: MeshArrays): THREE.BufferGeometry {
  const put = (name: string, array: Float32Array) => {
    const attr = geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (attr && attr.array.length === array.length) {
      (attr.array as Float32Array).set(array);
      attr.needsUpdate = true;
    } else {
      geometry.setAttribute(name, new THREE.BufferAttribute(array, 3));
    }
  };
  put("position", arrays.positions);
  put("normal", arrays.normals);
  put("color", arrays.colors);
  const index = geometry.getIndex();
  if (index && index.array.length === arrays.indices.length) {
    (index.array as Uint32Array).set(arrays.indices);
    index.needsUpdate = true;
  } else {
    geometry.setIndex(new THREE.BufferAttribute(arrays.indices, 1));
  }
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

/**
 * Build the outside mesh of `field` around the already-built `ring`. Pass the previous build
 * as `reuse` to recycle its geometry, material and typed arrays.
 */
export function buildTerrainOutside(field: Heightfield, outline: ArenaOutline, ring: RingSurface, options: TerrainOutsideOptions = {}, reuse?: TerrainOutsideBuild): TerrainOutsideBuild {
  const surface = buildOutsideSurface(field, outline, ring, options, reuse?.surface);
  if (options.paint) paintOutsideSurface(field, outline, surface, options.paint);
  const geometry = writeArraysToGeometry(reuse?.mesh.geometry ?? new THREE.BufferGeometry(), surface);
  const material = reuse?.mesh.material ?? new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = reuse?.mesh ?? new THREE.Mesh(geometry, material);
  mesh.name = "arena-outside";
  mesh.receiveShadow = true;
  return { mesh, surface, triangleCount: surface.triangleCount };
}
