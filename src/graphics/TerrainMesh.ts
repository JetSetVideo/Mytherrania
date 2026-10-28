// TerrainMesh: the rule-driven arena floor as a Three.js mesh (R07, R13).
//
// Wraps the pure RingSurface (src/world/RingSurface.ts): the floor clipped to the ring
// outline with shared vertices, per-vertex normals from the heightfield, vertex colours
// by ground-material band and height, and a skirt down to the platform bottom. Replaces
// the flat ExtrudeGeometry floor of Engine.#buildArena. Rebuilding for a new arena reuses
// the geometry's attribute arrays when the vertex layout is unchanged (same ring size).
//
// Cost: TerrainMeshBuild.triangleCount triangles in ONE draw call (one geometry, one
// material); the 12 m default ring at 0.5 m cells -> 12 rings x 96 segments ->
// 96 * (2 * 12 + 1) = 2,400 triangles (measured in tests/world_mesh_test.ts).
// @deno-types="@types/three"
import * as THREE from "three";
import type { ArenaOutline, Heightfield } from "../world/Heightfield.ts";
import { buildRingSurface, makeFloorSampler, type RingSurface, type RingSurfaceOptions } from "../world/RingSurface.ts";

/** Result of building the terrain mesh. */
export interface TerrainMeshBuild {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  surface: RingSurface;
  /** Triangles emitted (floor + skirt). */
  triangleCount: number;
  /**
   * Floor height at world (x, z), m: the DRAWN triangles inside the ring, outsideBaseY
   * outside (plus the field height if outsideFollowsTerrain). Allocation-free; call it per
   * body per frame.
   */
  floorHeightAt: (x: number, z: number) => number;
}

/** Options: RingSurface options plus where the outside ground sits. */
export interface TerrainMeshOptions extends RingSurfaceOptions {
  /** ArenaConfig.outsideHeight, m (NaN = void outside). Default -1 (the ArenaConfig default). */
  outsideBaseY?: number;
  /** Outside the ring, add the field's height to outsideBaseY. Default false: the engine's outside plane is flat. */
  outsideFollowsTerrain?: boolean;
}

/**
 * Write `surface` into `geometry`, reusing its attribute arrays when their lengths match
 * (no reallocation, just needsUpdate), else attaching new attributes.
 */
export function writeSurfaceToGeometry(geometry: THREE.BufferGeometry, surface: RingSurface): THREE.BufferGeometry {
  const put = (name: string, array: Float32Array) => {
    const attr = geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (attr && attr.array.length === array.length) {
      (attr.array as Float32Array).set(array);
      attr.needsUpdate = true;
    } else {
      geometry.setAttribute(name, new THREE.BufferAttribute(array, 3));
    }
  };
  put("position", surface.positions);
  put("normal", surface.normals);
  put("color", surface.colors);
  const index = geometry.getIndex();
  if (index && index.array.length === surface.indices.length) {
    (index.array as Uint32Array).set(surface.indices);
    index.needsUpdate = true;
  } else {
    geometry.setIndex(new THREE.BufferAttribute(surface.indices, 1));
  }
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

/**
 * Build the floor mesh of `field` clipped to `outline`. Pass the previous build as
 * `reuse` to recycle its geometry, material and typed arrays.
 */
export function buildTerrainMesh(field: Heightfield, outline: ArenaOutline, options: TerrainMeshOptions = {}, reuse?: TerrainMeshBuild): TerrainMeshBuild {
  const surface = buildRingSurface(field, outline, options, reuse?.surface);
  const geometry = writeSurfaceToGeometry(reuse?.mesh.geometry ?? new THREE.BufferGeometry(), surface);
  const material = reuse?.mesh.material ?? new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = reuse?.mesh ?? new THREE.Mesh(geometry, material);
  mesh.name = "arena-floor";
  mesh.receiveShadow = true;
  return {
    mesh, surface, triangleCount: surface.triangleCount,
    floorHeightAt: makeFloorSampler(surface, field, options.outsideBaseY ?? -1, options.outsideFollowsTerrain ?? false),
  };
}
