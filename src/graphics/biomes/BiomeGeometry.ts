// Geometry builders for the biome surroundings (lane S). Built ONCE per arena; every animation
// runs in the vertex shaders (no per-frame CPU rebuild). Triangle counts are exact and reported.
// @deno-types="@types/three"
import * as THREE from "three";
import type { Rgb3 } from "./BiomePalette.ts";
import { hash2 } from "../../world/biomes/BiomeTables.ts";

/** Radial growth of the coarse far rings (each ring 30% wider than the last). */
export const COARSE_GROWTH = 1.3;

/**
 * Ring radii of a polar grid, m: exponential spacing r_{k+1} = q r_k with q = 1 + 2 pi / S out to
 * rDetail (cells stay square: radial step = angular step), then COARSE_GROWTH out to rOut (the
 * fogged far field needs no detail). Always ends exactly at rOut.
 */
export function polarRadii(rIn: number, rDetail: number, rOut: number, segments: number, coarseGrowth = COARSE_GROWTH): number[] {
  const q = 1 + (2 * Math.PI) / segments;
  const radii = [Math.max(0.01, rIn)];
  let r = radii[0];
  const detail = Math.min(Math.max(rDetail, r), rOut);
  while (r < detail - 1e-6) { r = Math.min(detail, r * q); radii.push(r); }
  while (r < rOut - 1e-6) { r = Math.min(rOut, r * coarseGrowth); radii.push(r); }
  return radii;
}

/** Triangles of a polar grid: 2 S (rings - 1). */
export function polarTriangles(rings: number, segments: number): number {
  return 2 * segments * Math.max(0, rings - 1);
}

/**
 * Polar grid geometry: rings x segments vertices at (r cos a, heightAt, r sin a), quads split
 * in two. With heightAt the normals are computed (smooth, the seam wraps by index); without it
 * the grid is flat (y 0, normal up). Every vertex gets a color attribute (default white).
 */
export function polarGridGeometry(radii: readonly number[], segments: number, heightAt?: (x: number, z: number) => number, colorAt?: (x: number, z: number, out: Float32Array, o: number) => void): THREE.BufferGeometry {
  const rings = radii.length;
  const count = rings * segments;
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), colors = new Float32Array(count * 3).fill(1);
  for (let k = 0; k < rings; k++) {
    for (let j = 0; j < segments; j++) {
      const v = k * segments + j, a = (2 * Math.PI * j) / segments;
      const x = Math.cos(a) * radii[k], z = Math.sin(a) * radii[k];
      positions[v * 3] = x;
      positions[v * 3 + 1] = heightAt ? heightAt(x, z) : 0;
      positions[v * 3 + 2] = z;
      normals[v * 3 + 1] = 1;
      if (colorAt) colorAt(x, z, colors, v * 3);
    }
  }
  const indices = new Uint32Array(polarTriangles(rings, segments) * 3);
  let t = 0;
  for (let k = 0; k < rings - 1; k++) {
    for (let j = 0; j < segments; j++) {
      const j1 = (j + 1) % segments;
      const a = k * segments + j, b = k * segments + j1, c = (k + 1) * segments + j1, d = (k + 1) * segments + j;
      // Front face up (+y): (b - a) x (d - a) = (0, +, 0) since b is the next bearing (+z turn) and d the next ring (+r).
      indices[t++] = a; indices[t++] = b; indices[t++] = d;
      indices[t++] = b; indices[t++] = c; indices[t++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  if (heightAt) g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** One row of a ring-base profile: radius = rim * scale (or `radius` when set), y = top - drop, +- jitter m. */
export interface BaseRow {
  scale: number;
  drop: number;
  jitter: number;
  radius?: number;
}

/**
 * The solid under or around the ring (rock column, floating-island cone, giant trunk, cliff):
 * `rows` profile rings around the outline, `segments` bearings, vertex colours from light (top)
 * to dark (bottom). Outward-facing. Triangles: 2 segments (rows - 1).
 */
export function ringBaseGeometry(rows: readonly BaseRow[], segments: number, rimRadiusAt: (angle: number) => number, topY: number, light: Rgb3, dark: Rgb3, seed: number): THREE.BufferGeometry {
  const positions = new Float32Array(rows.length * segments * 3), colors = new Float32Array(rows.length * segments * 3);
  for (let k = 0; k < rows.length; k++) {
    const row = rows[k], shade = k / Math.max(1, rows.length - 1);
    for (let j = 0; j < segments; j++) {
      const v = k * segments + j, a = (2 * Math.PI * j) / segments;
      const n = hash2(j, k, seed) - 0.5;
      const r = Math.max(0, (row.radius ?? rimRadiusAt(a) * row.scale) + row.jitter * n);
      positions[v * 3] = Math.cos(a) * r;
      positions[v * 3 + 1] = topY - row.drop + 0.5 * row.jitter * (hash2(j + 977, k, seed) - 0.5);
      positions[v * 3 + 2] = Math.sin(a) * r;
      const g = 0.85 + 0.3 * hash2(j, k + 31, seed);
      for (let c = 0; c < 3; c++) colors[v * 3 + c] = (light[c] + (dark[c] - light[c]) * shade) * g;
    }
  }
  const indices = new Uint32Array(2 * segments * (rows.length - 1) * 3);
  let t = 0;
  for (let k = 0; k < rows.length - 1; k++) {
    for (let j = 0; j < segments; j++) {
      const j1 = (j + 1) % segments;
      const a = k * segments + j, b = k * segments + j1, c = (k + 1) * segments + j1, d = (k + 1) * segments + j;
      // Outward facing for rows going DOWN: a (top) -> b (top, next bearing) -> d (below).
      indices[t++] = a; indices[t++] = b; indices[t++] = d;
      indices[t++] = b; indices[t++] = c; indices[t++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** A grass tuft: `blades` single-triangle blades fanned around the y axis; y in [0, 1] is the height fraction. */
export function tuftGeometry(blades = 4, halfWidth = 0.06): THREE.BufferGeometry {
  const positions = new Float32Array(blades * 9);
  for (let b = 0; b < blades; b++) {
    const a = (Math.PI * b) / blades, lean = 0.18 * ((b % 2) * 2 - 1);
    const cx = Math.cos(a), sz = Math.sin(a);
    positions.set([-cx * halfWidth, 0, -sz * halfWidth, cx * halfWidth, 0, sz * halfWidth, lean * sz, 1, -lean * cx], b * 9);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return g;
}

/** Open cylinder, radius 1, y in [0, 1], `sides` faces (2 triangles each). */
export function trunkGeometry(sides = 5): THREE.BufferGeometry {
  const positions = new Float32Array(sides * 2 * 3), indices = new Uint32Array(sides * 6);
  for (let i = 0; i < sides; i++) {
    const a = (2 * Math.PI * i) / sides;
    positions.set([Math.cos(a), 0, Math.sin(a)], i * 3);
    positions.set([Math.cos(a), 1, Math.sin(a)], (sides + i) * 3);
    const i1 = (i + 1) % sides;
    indices.set([i, sides + i, i1, i1, sides + i, sides + i1], i * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  return g;
}

/** Wrap `base` as an InstancedBufferGeometry with one vec4 per-instance attribute `name`. */
export function instancedGeometry(base: THREE.BufferGeometry, name: string, data: Float32Array, count: number): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  for (const key of Object.keys(base.attributes)) g.setAttribute(key, base.attributes[key]);
  g.setAttribute(name, new THREE.InstancedBufferAttribute(data, 4));
  g.instanceCount = count;
  return g;
}

/** Triangles a geometry draws: (index or vertex count) / 3, times the instance count. */
export function geometryTriangles(g: THREE.BufferGeometry): number {
  const perInstance = (g.index ? g.index.count : g.attributes.position.count) / 3;
  const instances = (g as THREE.InstancedBufferGeometry).isInstancedBufferGeometry ? (g as THREE.InstancedBufferGeometry).instanceCount : 1;
  return perInstance * instances;
}
