// TerrainMesh: the rule-driven arena floor as a Three.js mesh (R07, R13).
//
// Wraps the pure RingSurface (src/world/RingSurface.ts): the floor clipped to the ring
// outline with shared vertices, per-vertex normals from the heightfield, vertex colours
// by ground-material band and height, and a skirt down to the platform bottom. Replaces
// the flat ExtrudeGeometry floor of Engine.#buildArena. Rebuilding for a new arena reuses
// the geometry's attribute arrays when the vertex layout is unchanged (same ring size).
//
// Lane E2 options (all off by default, so existing callers are unchanged):
//   paint     TerrainPaint's derived layer stack instead of the plain band colours
//   outside   TerrainOutside's field-following annulus, added as a CHILD of `mesh` (one
//             g.add in the engine draws both); the ring skirt then reaches down exactly to
//             it, and with outsideFollowsTerrain the floor sampler returns its drawn
//             triangles beyond the rim (physics stands on what is drawn).
//
// Cost: TerrainMeshBuild.triangleCount triangles in one draw call per mesh; the 12 m
// default ring at 0.5 m cells -> 12 rings x 96 segments -> 96 * (2 * 12 + 1) = 2,400
// triangles (measured in tests/world_mesh_test.ts), + 1,344 with the outside.
// @deno-types="@types/three"
import * as THREE from "three";
import { heightAt, type ArenaOutline, type Heightfield } from "../world/Heightfield.ts";
import { makeTerrainFloorSampler } from "../world/OutsideSurface.ts";
import { buildRingSurface, makeFloorSampler, type RingSurface, type RingSurfaceOptions } from "../world/RingSurface.ts";
import { buildTerrainOutside, type TerrainOutsideBuild, writeArraysToGeometry } from "./TerrainOutside.ts";
import { paintTerrainSurface, type TerrainPaintOptions } from "./TerrainPaint.ts";

/** Result of building the terrain mesh. */
export interface TerrainMeshBuild {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  surface: RingSurface;
  /** Triangles emitted: ring floor + skirt, plus the outside when drawn. */
  triangleCount: number;
  /** Ring floor + skirt triangles only. */
  ringTriangles: number;
  /** The outside annulus (a child of `mesh`), or null when not drawn. */
  outside: TerrainOutsideBuild | null;
  /**
   * Floor height at world (x, z), m: the DRAWN triangles inside the ring; outside it the
   * drawn outside triangles (outside + outsideFollowsTerrain), else outsideBaseY (plus the
   * field height if outsideFollowsTerrain). Allocation-free; call it per body per frame.
   */
  floorHeightAt: (x: number, z: number) => number;
}

/** Options: RingSurface options plus where the outside ground sits and how it is drawn. */
export interface TerrainMeshOptions extends RingSurfaceOptions {
  /** ArenaConfig.outsideHeight, m (NaN = void outside). Default -1 (the ArenaConfig default). */
  outsideBaseY?: number;
  /** Outside the ring, the floor follows the field. Default false: the engine's outside plane is flat. */
  outsideFollowsTerrain?: boolean;
  /** Draw the field-following outside (TerrainOutside) as a child mesh (needs a finite outsideBaseY). Default false. */
  outside?: boolean;
  /** Triangle budget of the outside, default TERRAIN_TRIANGLE_BUDGET - ring triangles. */
  outsideTriangleBudget?: number;
  /** Paint ring and outside with TerrainPaint (false/absent = the plain band colours). */
  paint?: TerrainPaintOptions | false;
}

/**
 * Write `surface` into `geometry`, reusing its attribute arrays when their lengths match
 * (no reallocation, just needsUpdate), else attaching new attributes.
 */
export function writeSurfaceToGeometry(geometry: THREE.BufferGeometry, surface: RingSurface): THREE.BufferGeometry {
  return writeArraysToGeometry(geometry, surface);
}

/**
 * Build the floor mesh of `field` clipped to `outline`. Pass the previous build as
 * `reuse` to recycle its geometry, material, typed arrays and outside child.
 */
export function buildTerrainMesh(field: Heightfield, outline: ArenaOutline, options: TerrainMeshOptions = {}, reuse?: TerrainMeshBuild): TerrainMeshBuild {
  const baseY = options.outsideBaseY ?? -1;
  const drawOutside = options.outside === true && Number.isFinite(baseY);
  const ringOptions: RingSurfaceOptions = drawOutside ? { ...options, skirtBottomAt: (x, z) => baseY + heightAt(field, x, z) } : options;
  const surface = buildRingSurface(field, outline, ringOptions, reuse?.surface);
  if (options.paint) paintTerrainSurface(field, outline, surface, options.paint);
  const geometry = writeSurfaceToGeometry(reuse?.mesh.geometry ?? new THREE.BufferGeometry(), surface);
  const material = reuse?.mesh.material ?? new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = reuse?.mesh ?? new THREE.Mesh(geometry, material);
  mesh.name = "arena-floor";
  mesh.receiveShadow = true;
  let outside: TerrainOutsideBuild | null = null;
  if (drawOutside) {
    outside = buildTerrainOutside(field, outline, surface, { baseY, triangleBudget: options.outsideTriangleBudget, paint: options.paint }, reuse?.outside ?? undefined);
    if (outside.mesh.parent !== mesh) mesh.add(outside.mesh);
  } else if (reuse?.outside) {
    mesh.remove(reuse.outside.mesh);
  }
  const follows = options.outsideFollowsTerrain ?? false;
  return {
    mesh, surface, outside,
    ringTriangles: surface.triangleCount,
    triangleCount: surface.triangleCount + (outside?.triangleCount ?? 0),
    floorHeightAt: outside && follows ? makeTerrainFloorSampler(surface, outside.surface, field, outline) : makeFloorSampler(surface, field, baseY, follows),
  };
}
