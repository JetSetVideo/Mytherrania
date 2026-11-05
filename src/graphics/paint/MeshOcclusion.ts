// Wave TEX closing (agent F): GEOMETRIC ambient occlusion of a closed skin mesh, per vertex, for the C-MAT `ao`
// channel. Pure (no THREE, no DOM, no Math.random): the ray set is a fixed Fibonacci hemisphere.
//
// Why a ray estimate and not the curvature/cavity terms: the miniature wash (Miniature.cavityDepth, a Taubin-smoothed
// depth) already PAINTS the recesses of the one connected skin, and the AO channel only took AO_SHARE = 0.12 of it, so
// the AO view read flat 255 (QA Z-71 WARN-2). What the painted wash cannot see is occlusion BETWEEN parts of the body:
// the inner arm against the ribs, the armpit, the inner thighs, under the chin and the jaw, the gluteal fold — the
// places where the sky and the fill really are hidden. That is a visibility question, so it is answered by rays.
//
// Method:
//   1. voxelise: the mesh's triangles are rasterised into a grid of `voxel` metres (barycentric samples at <= voxel/2),
//      then the outside is flood-filled from the padded border; solid = shell + interior (the SDF skin is closed).
//   2. for each vertex, `rays` cosine-distributed directions of the hemisphere about its normal (a fixed Fibonacci set
//      rotated into the vertex frame) march from p + n·(1.5 voxel) in voxel steps up to `radius`; a ray that enters a
//      solid voxel at distance t is blocked with weight (1 − t/radius)^falloff (a near wall hides more sky than a far one).
//   3. occlusion = Σ weights / rays (0 open … 1 buried), smoothed over `smooth` 1-ring passes (the fixed ray set would
//      otherwise print a faint vertex-to-vertex pattern).
// Cost (5.4 k vertices, 16 rays, 2 cm voxels, 25 cm radius): ~15-25 ms in Deno; the result is cached per MeshData
// object, so the warm rig build (body cache hit) pays nothing.

import type { MeshData } from "../body/contracts.ts";

export interface OcclusionOptions {
  /** Voxel size (m). Default 0.02. Grown automatically so the grid stays under MAX_VOXELS. */
  voxel?: number;
  /** Ray length (m). Default 0.25 (about a forearm's distance from the ribs). */
  radius?: number;
  /** Rays per vertex. Default 16. */
  rays?: number;
  /** Distance falloff exponent of a blocked ray's weight. Default 1. */
  falloff?: number;
  /** 1-ring smoothing passes of the result. Default 2. */
  smooth?: number;
  /** Vertex adjacency (FormShade.vertexRings) when the caller has it. */
  adj?: Int32Array[];
}

export const OCCLUSION_DEFAULTS = { voxel: 0.02, radius: 0.25, rays: 16, falloff: 1, smooth: 2 } as const;
/** Grid cap (cells): a 2 m body at 2 cm is ~0.2 M cells. */
export const MAX_VOXELS = 2_000_000;

const cache = new WeakMap<MeshData, { key: string; occ: Float32Array }>();

/** Fixed cosine-weighted hemisphere directions about +Z (Fibonacci spiral on the disc, lifted: Malley's method). */
export function hemisphereRays(count: number): Float64Array {
  const out = new Float64Array(count * 3), ga = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < count; k++) {
    const r = Math.sqrt((k + 0.5) / count), a = k * ga;
    const x = r * Math.cos(a), y = r * Math.sin(a);
    out[k * 3] = x; out[k * 3 + 1] = y; out[k * 3 + 2] = Math.sqrt(Math.max(0, 1 - x * x - y * y));
  }
  return out;
}

/** Per-vertex occlusion in [0, 1] (0 = the whole hemisphere sees out to `radius`). Deterministic; cached per mesh. */
export function meshOcclusion(mesh: MeshData, opts: OcclusionOptions = {}): Float32Array {
  const o = { ...OCCLUSION_DEFAULTS, ...opts };
  const key = `${o.voxel}|${o.radius}|${o.rays}|${o.falloff}|${o.smooth}`;
  const hit = cache.get(mesh);
  if (hit && hit.key === key) return hit.occ;
  const P = mesh.positions, N = mesh.normals, I = mesh.indices, n = P.length / 3;
  const occ = new Float32Array(n);
  if (n === 0 || I.length < 3) return occ;
  // ── 1. voxelise ──────────────────────────────────────────────────────────────────────────────────────────────
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z;
    if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
  }
  let vs = Math.max(1e-3, o.voxel);
  const pad = 2;
  let nx = 0, ny = 0, nz = 0;
  for (;;) {
    nx = Math.ceil((x1 - x0) / vs) + 1 + 2 * pad; ny = Math.ceil((y1 - y0) / vs) + 1 + 2 * pad; nz = Math.ceil((z1 - z0) / vs) + 1 + 2 * pad;
    if (nx * ny * nz <= MAX_VOXELS) break;
    vs *= 1.25;
  }
  const ox = x0 - pad * vs, oy = y0 - pad * vs, oz = z0 - pad * vs, inv = 1 / vs;
  const grid = new Uint8Array(nx * ny * nz); // 0 unknown, 1 shell, 2 outside
  const cellOf = (x: number, y: number, z: number) => {
    const ix = Math.floor((x - ox) * inv), iy = Math.floor((y - oy) * inv), iz = Math.floor((z - oz) * inv);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return -1;
    return (iz * ny + iy) * nx + ix;
  };
  for (let t = 0; t + 2 < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const lab = Math.hypot(P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]);
    const lac = Math.hypot(P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]);
    const lbc = Math.hypot(P[c] - P[b], P[c + 1] - P[b + 1], P[c + 2] - P[b + 2]);
    const steps = Math.max(1, Math.ceil(Math.max(lab, lac, lbc) / (vs * 0.5)));
    for (let u = 0; u <= steps; u++) {
      for (let v = 0; u + v <= steps; v++) {
        const fu = u / steps, fv = v / steps, fw = 1 - fu - fv;
        const k = cellOf(P[a] * fw + P[b] * fu + P[c] * fv, P[a + 1] * fw + P[b + 1] * fu + P[c + 1] * fv, P[a + 2] * fw + P[b + 2] * fu + P[c + 2] * fv);
        if (k >= 0) grid[k] = 1;
      }
    }
  }
  // flood the outside from every border cell (6-connected, iterative stack)
  const stack = new Int32Array(nx * ny * nz);
  let sp = 0;
  const push = (k: number) => { if (grid[k] === 0) { grid[k] = 2; stack[sp++] = k; } };
  for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) { push((iz * ny + iy) * nx); push((iz * ny + iy) * nx + nx - 1); }
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) { push((iz * ny) * nx + ix); push((iz * ny + ny - 1) * nx + ix); }
  for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) { push(iy * nx + ix); push(((nz - 1) * ny + iy) * nx + ix); }
  const sx = 1, sy = nx, sz = nx * ny;
  while (sp > 0) {
    const k = stack[--sp];
    const ix = k % nx, iy = ((k - ix) / nx) % ny, iz = Math.floor(k / sz);
    if (ix > 0) push(k - sx); if (ix < nx - 1) push(k + sx);
    if (iy > 0) push(k - sy); if (iy < ny - 1) push(k + sy);
    if (iz > 0) push(k - sz); if (iz < nz - 1) push(k + sz);
  }
  // ── 2. rays ──────────────────────────────────────────────────────────────────────────────────────────────────
  const R = hemisphereRays(o.rays), K = o.rays, steps = Math.max(1, Math.ceil(o.radius / vs));
  const start = 1.5 * vs;
  for (let i = 0; i < n; i++) {
    let nxv = N[i * 3], nyv = N[i * 3 + 1], nzv = N[i * 3 + 2];
    const nl = Math.hypot(nxv, nyv, nzv);
    if (!(nl > 1e-9)) continue;
    nxv /= nl; nyv /= nl; nzv /= nl;
    // tangent frame (t, b, n): t = normalize(cross(n, y)) (or cross(n, x) near the poles)
    let tx: number, ty: number, tz: number;
    if (Math.abs(nyv) < 0.9) { tx = -nzv; ty = 0; tz = nxv; } else { tx = 0; ty = nzv; tz = -nyv; }
    const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
    const bx = nyv * tz - nzv * ty, by = nzv * tx - nxv * tz, bz = nxv * ty - nyv * tx;
    const px = P[i * 3] + nxv * start, py = P[i * 3 + 1] + nyv * start, pz = P[i * 3 + 2] + nzv * start;
    let blocked = 0;
    for (let r = 0; r < K; r++) {
      const lx = R[r * 3], ly = R[r * 3 + 1], lz = R[r * 3 + 2];
      const dx = tx * lx + bx * ly + nxv * lz, dy = ty * lx + by * ly + nyv * lz, dz = tz * lx + bz * ly + nzv * lz;
      for (let s = 0; s < steps; s++) {
        const t = s * vs;
        const k = cellOf(px + dx * t, py + dy * t, pz + dz * t);
        if (k < 0) break;
        if (grid[k] !== 2) { blocked += Math.pow(Math.max(0, 1 - (t + start) / (o.radius + start)), o.falloff); break; }
      }
    }
    occ[i] = blocked / K;
  }
  // ── 3. smooth ────────────────────────────────────────────────────────────────────────────────────────────────
  if (o.smooth > 0) {
    const adj = o.adj ?? ringsOf(mesh);
    const tmp = new Float32Array(n);
    for (let pass = 0; pass < o.smooth; pass++) {
      for (let i = 0; i < n; i++) { let s = occ[i]; const a = adj[i]; for (let j = 0; j < a.length; j++) s += occ[a[j]]; tmp[i] = s / (a.length + 1); }
      occ.set(tmp);
    }
  }
  cache.set(mesh, { key, occ });
  return occ;
}

/** 1-ring vertex adjacency from the index buffer (same as FormShade.vertexRings; local to keep this module free-standing). */
function ringsOf(mesh: MeshData): Int32Array[] {
  const n = mesh.positions.length / 3, I = mesh.indices;
  const sets: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let t = 0; t + 2 < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    sets[a].add(b); sets[a].add(c); sets[b].add(a); sets[b].add(c); sets[c].add(a); sets[c].add(b);
  }
  return sets.map((s) => Int32Array.from(s));
}
