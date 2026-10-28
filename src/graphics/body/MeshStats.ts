// Topology checker (lane A, R03). Pure module: no THREE.
//
// Vocabulary
//   edge: an unordered vertex pair used by at least one triangle.
//   boundary edge: used by exactly ONE triangle — a hole or a cut in the skin.
//   non-manifold edge: used by THREE or more triangles — sheets glued along a line.
//   component: a maximal set of vertices connected through triangles (union-find); a whole
//   body is exactly 1. Vertices no triangle references are not counted as components.
//   A closed, whole skin has boundaryEdges = 0, nonManifoldEdges = 0, components = 1.

import type { MeshData, MeshStats } from "./contracts.ts";

/** Union-find with path halving and union by size. */
class DisjointSet {
  #parent: Int32Array;
  #size: Int32Array;
  constructor(n: number) {
    this.#parent = new Int32Array(n);
    this.#size = new Int32Array(n).fill(1);
    for (let i = 0; i < n; i++) this.#parent[i] = i;
  }
  find(a: number): number {
    const p = this.#parent;
    while (p[a] !== a) { p[a] = p[p[a]]; a = p[a]; }
    return a;
  }
  union(a: number, b: number): void {
    let ra = this.find(a), rb = this.find(b);
    if (ra === rb) return;
    if (this.#size[ra] < this.#size[rb]) { const t = ra; ra = rb; rb = t; }
    this.#parent[rb] = ra;
    this.#size[ra] += this.#size[rb];
  }
}

/** Count how many triangles use each undirected edge. Key = lo·n + hi (exact below 2^53). */
export function edgeUseCounts(mesh: MeshData): Map<number, number> {
  const n = mesh.positions.length / 3;
  const idx = mesh.indices;
  const uses = new Map<number, number>();
  for (let t = 0; t < idx.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e], b = idx[t + ((e + 1) % 3)];
      const key = a < b ? a * n + b : b * n + a;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  return uses;
}

/**
 * Directed-edge consistency: in a consistently wound closed mesh every directed edge
 * (a→b) occurs once and its twin (b→a) once. Returns how many directed edges occur more
 * than once (0 for a consistently oriented manifold).
 */
export function windingConflicts(mesh: MeshData): number {
  const n = mesh.positions.length / 3;
  const idx = mesh.indices;
  const seen = new Map<number, number>();
  let conflicts = 0;
  for (let t = 0; t < idx.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e], b = idx[t + ((e + 1) % 3)];
      const key = a * n + b;
      const c = (seen.get(key) ?? 0) + 1;
      seen.set(key, c);
      if (c === 2) conflicts++;
    }
  }
  return conflicts;
}

/**
 * Signed volume (m³) by the divergence theorem, Σ (a · (b × c)) / 6 over triangles.
 * Positive when the triangles are wound counter-clockwise seen from outside.
 */
export function signedVolume(mesh: MeshData): number {
  const p = mesh.positions, idx = mesh.indices;
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const bx = p[b], by = p[b + 1], bz = p[b + 2], cx = p[c], cy = p[c + 1], cz = p[c + 2];
    v += p[a] * (by * cz - bz * cy) + p[a + 1] * (bz * cx - bx * cz) + p[a + 2] * (bx * cy - by * cx);
  }
  return v / 6;
}

/** Contract entry point: the topology facts that prove a skin is whole. */
export function meshStats(mesh: MeshData): MeshStats {
  const n = mesh.positions.length / 3;
  const idx = mesh.indices;
  let boundaryEdges = 0, nonManifoldEdges = 0;
  for (const c of edgeUseCounts(mesh).values()) {
    if (c === 1) boundaryEdges++;
    else if (c > 2) nonManifoldEdges++;
  }
  const ds = new DisjointSet(n);
  const used = new Uint8Array(n);
  for (let t = 0; t < idx.length; t += 3) {
    used[idx[t]] = used[idx[t + 1]] = used[idx[t + 2]] = 1;
    ds.union(idx[t], idx[t + 1]);
    ds.union(idx[t], idx[t + 2]);
  }
  const roots = new Set<number>();
  let minY = Infinity, maxY = -Infinity;
  for (let v = 0; v < n; v++) {
    if (!used[v]) continue;
    roots.add(ds.find(v));
    const y = mesh.positions[v * 3 + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    vertices: n,
    triangles: idx.length / 3,
    boundaryEdges,
    nonManifoldEdges,
    components: roots.size,
    minY: Number.isFinite(minY) ? minY : 0,
    maxY: Number.isFinite(maxY) ? maxY : 0,
  };
}
