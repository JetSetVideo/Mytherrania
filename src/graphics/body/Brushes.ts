// Sculpt brushes (lane A, R15). Pure module: no THREE.
//
// Every brush acts inside a ball of radius R (m) around its centre c with the falloff
//
//     w(p) = 1 − smootherstep(0, R, |p − c|)        (1 at the centre, 0 at and beyond R)
//
// so a point at |p − c| ≥ R is returned BIT-IDENTICAL (the brush does not even run).
// `s` is the stroke's signed strength (m of displacement at the centre), â its unit axis.
//
// Field-domain brushes wrap a BodyField (they change d before polygonising):
//   inflate   d' = d − s·w                              (surface moves out along its normal)
//   deflate   d' = d + s·w                              (surface moves in)
//   dig       d' = d + w·(smax(d, s − |p − c|, k) − d), k = DIG_RIM_FRACTION·s
//             (smooth-subtract a cavity sphere of radius s; the rim blends over k)
//   pushPull  d' = d(p − s·w·â)                          (surface translated by s·w along â)
//   pinch     d' = d(c + (p − c)·(1 + (s/R)·w))           (local contraction toward c)
//   crease    d' = d + s·w·(1 − smootherstep(0, g, ρ)),   ρ = distance from p to the line (c, â),
//             g = CREASE_WIDTH_FRACTION·R                 (a groove of depth s along â)
//   flatten   d' = d + w·clamp(max(d, (p − c)·â) − d, 0, |s|)
//             (material on the +â side of the plane through c is pressed away, at most |s| deep)
//   twist     d' = d(c + Rot(â, −φ)(p − c)),  φ = (s/R)·((p − c)·â / R)·w   (rad, right-hand about â)
//   bend      d' = d(c + Rot(â, −φ)(p − c)),  φ = (s/R)·clamp((p − c)·u / R, 0, 1)·w,
//             u = normalize(â × ŷ) (ẑ when â ∥ ŷ): the +u side turns about â (right-hand
//             rule), the −u side is untouched, so a toe spring never pushes the heel down.
// Mesh-domain brush (moves vertices after polygonising):
//   smooth    Taubin λ/μ relaxation (λ = TAUBIN_LAMBDA·w, μ = TAUBIN_MU·w, SMOOTH_PASSES
//             pairs) of the vertices inside R; each vertex's total move is capped at |s|·w.
//
// Region/bone: brushes never change the dominant region or bone of a sample.

import { smootherstep } from "../../core/MathCore.ts";
import type { BrushKind, BrushStroke, MeshData, SdfSample, Vec3 } from "./contracts.ts";
import { smax, type BodyField } from "./Sdf.ts";

/** Brushes applied to the signed-distance field before polygonising. */
export const FIELD_BRUSHES: readonly BrushKind[] = ["inflate", "deflate", "dig", "pushPull", "pinch", "crease", "flatten", "twist", "bend"];
/** Brushes applied to the triangle mesh after polygonising. */
export const MESH_BRUSHES: readonly BrushKind[] = ["smooth"];

/** Groove half-width of a crease as a fraction of its radius (a crease is narrow by definition). */
export const CREASE_WIDTH_FRACTION = 0.3;
/** Rim blend of a dig as a fraction of the cavity radius (rounded lip, no sharp edge). */
export const DIG_RIM_FRACTION = 0.5;
/** Taubin smoothing: λ shrinks, μ (|μ| > λ) re-inflates, so the volume is kept (Taubin 1995). */
export const TAUBIN_LAMBDA = 0.5;
export const TAUBIN_MU = -0.53;
/** λ/μ pairs per smooth stroke: enough to relax a 2-3 cell kink, not enough to melt a part. */
export const SMOOTH_PASSES = 4;

/** Falloff w(p) = 1 − smootherstep(0, R, |p − c|) of a stroke at (x, y, z); 0 outside R. */
export function brushWeight(s: BrushStroke, x: number, y: number, z: number): number {
  const dx = x - s.centre[0], dy = y - s.centre[1], dz = z - s.centre[2];
  const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return r >= s.radius ? 0 : 1 - smootherstep(0, s.radius, r);
}

function unit(v: Vec3 | undefined, fallback: Vec3): Vec3 {
  const a = v ?? fallback;
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [...fallback];
}

/** Rodrigues: rotate v about unit axis k by angle t (rad), written into out. */
function rotateAbout(vx: number, vy: number, vz: number, k: Vec3, t: number, out: Vec3): Vec3 {
  const c = Math.cos(t), s = Math.sin(t);
  const kd = k[0] * vx + k[1] * vy + k[2] * vz;
  const cx = k[1] * vz - k[2] * vy, cy = k[2] * vx - k[0] * vz, cz = k[0] * vy - k[1] * vx;
  out[0] = vx * c + cx * s + k[0] * kd * (1 - c);
  out[1] = vy * c + cy * s + k[1] * kd * (1 - c);
  out[2] = vz * c + cz * s + k[2] * kd * (1 - c);
  return out;
}

/** Wrap a field with one field-domain stroke. Throws for `smooth` (a mesh-domain brush). */
export function applyFieldBrush(field: BodyField, st: BrushStroke): BodyField {
  const [cx, cy, cz] = st.centre;
  const R = st.radius, s = st.strength;
  const axis = unit(st.axis, [0, 1, 0]);
  const tmp: Vec3 = [0, 0, 0];
  // w and the untouched-outside guard, shared by every brush.
  const weight = (x: number, y: number, z: number): number => {
    const dx = x - cx, dy = y - cy, dz = z - cz;
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return r >= R ? 0 : 1 - smootherstep(0, R, r);
  };
  const wrap = (fn: (x: number, y: number, z: number, w: number, out: SdfSample) => void): BodyField => ({
    sample(x, y, z, out) {
      const w = weight(x, y, z);
      if (w <= 0) return field.sample(x, y, z, out);
      fn(x, y, z, w, out);
      return out;
    },
  });
  switch (st.kind) {
    case "inflate":
      return wrap((x, y, z, w, out) => { field.sample(x, y, z, out); out.d -= s * w; });
    case "deflate":
      return wrap((x, y, z, w, out) => { field.sample(x, y, z, out); out.d += s * w; });
    case "dig": {
      const k = DIG_RIM_FRACTION * Math.abs(s);
      return wrap((x, y, z, w, out) => {
        field.sample(x, y, z, out);
        const cavity = Math.abs(s) - Math.hypot(x - cx, y - cy, z - cz); // −(sphere SDF)
        out.d += w * (smax(out.d, cavity, k) - out.d);
      });
    }
    case "pushPull":
      return wrap((x, y, z, w, out) => {
        const m = s * w;
        field.sample(x - m * axis[0], y - m * axis[1], z - m * axis[2], out);
      });
    case "pinch": {
      const kappa = s / R;
      return wrap((x, y, z, w, out) => {
        const f = 1 + kappa * w;
        field.sample(cx + (x - cx) * f, cy + (y - cy) * f, cz + (z - cz) * f, out);
      });
    }
    case "crease": {
      const g = CREASE_WIDTH_FRACTION * R;
      return wrap((x, y, z, w, out) => {
        field.sample(x, y, z, out);
        const vx = x - cx, vy = y - cy, vz = z - cz;
        const t = vx * axis[0] + vy * axis[1] + vz * axis[2];
        const rho = Math.hypot(vx - t * axis[0], vy - t * axis[1], vz - t * axis[2]);
        out.d += s * w * (1 - smootherstep(0, g, rho));
      });
    }
    case "flatten": {
      const depth = Math.abs(s);
      return wrap((x, y, z, w, out) => {
        field.sample(x, y, z, out);
        const plane = (x - cx) * axis[0] + (y - cy) * axis[1] + (z - cz) * axis[2];
        const cut = Math.min(depth, Math.max(0, Math.max(out.d, plane) - out.d));
        out.d += w * cut;
      });
    }
    case "twist":
      return wrap((x, y, z, w, out) => {
        const vx = x - cx, vy = y - cy, vz = z - cz;
        const t = vx * axis[0] + vy * axis[1] + vz * axis[2];
        const phi = (s / R) * (t / R) * w;
        rotateAbout(vx, vy, vz, axis, -phi, tmp);
        field.sample(cx + tmp[0], cy + tmp[1], cz + tmp[2], out);
      });
    case "bend": {
      // Lever u = â × ŷ, or ẑ when the axis is vertical.
      let ux = axis[1] * 0 - axis[2] * 1, uy = axis[2] * 0 - axis[0] * 0, uz = axis[0] * 1 - axis[1] * 0;
      const ul = Math.hypot(ux, uy, uz);
      if (ul < 1e-9) { ux = 0; uy = 0; uz = 1; } else { ux /= ul; uy /= ul; uz /= ul; }
      return wrap((x, y, z, w, out) => {
        const vx = x - cx, vy = y - cy, vz = z - cz;
        const lever = Math.max(0, Math.min(1, (vx * ux + vy * uy + vz * uz) / R));
        const phi = (s / R) * lever * w;
        if (phi === 0) { field.sample(x, y, z, out); return; }
        rotateAbout(vx, vy, vz, axis, -phi, tmp);
        field.sample(cx + tmp[0], cy + tmp[1], cz + tmp[2], out);
      });
    }
    case "smooth":
      throw new Error("smooth is a mesh-domain brush: use smoothMesh / applyMeshBrushes");
  }
}

/** Wrap a field with every FIELD-domain stroke, in order (mesh-domain strokes are skipped). */
export function applyFieldBrushes(field: BodyField, strokes: readonly BrushStroke[]): BodyField {
  let f = field;
  for (const st of strokes) if (st.kind !== "smooth") f = applyFieldBrush(f, st);
  return f;
}

/** The largest distance any stroke can move the surface (m): pads polygonising bounds. */
export function brushReach(strokes: readonly BrushStroke[]): number {
  let m = 0;
  for (const st of strokes) if (st.kind !== "smooth") m = Math.max(m, Math.abs(st.strength));
  return m;
}

/** One-ring vertex adjacency in CSR form (offsets[v]..offsets[v+1] index into `list`). */
export interface Adjacency { offsets: Uint32Array; list: Uint32Array }

/** Build the one-ring neighbour lists of an indexed triangle mesh (each edge once per side). */
export function vertexAdjacency(mesh: MeshData): Adjacency {
  const n = mesh.positions.length / 3;
  const idx = mesh.indices;
  const count = new Uint32Array(n + 1);
  for (let t = 0; t < idx.length; t += 3) {
    count[idx[t]] += 2; count[idx[t + 1]] += 2; count[idx[t + 2]] += 2;
  }
  const offsets = new Uint32Array(n + 1);
  for (let v = 0; v < n; v++) offsets[v + 1] = offsets[v] + count[v];
  const fill = offsets.slice(0, n);
  const raw = new Uint32Array(offsets[n]);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    raw[fill[a]++] = b; raw[fill[a]++] = c;
    raw[fill[b]++] = c; raw[fill[b]++] = a;
    raw[fill[c]++] = a; raw[fill[c]++] = b;
  }
  // Deduplicate each ring (a manifold edge appears twice per vertex).
  const out = new Uint32Array(raw.length);
  const offs = new Uint32Array(n + 1);
  let w = 0;
  for (let v = 0; v < n; v++) {
    offs[v] = w;
    const start = w;
    for (let i = offsets[v]; i < offsets[v + 1]; i++) {
      const u = raw[i];
      let seen = false;
      for (let j = start; j < w; j++) if (out[j] === u) { seen = true; break; }
      if (!seen) out[w++] = u;
    }
  }
  offs[n] = w;
  return { offsets: offs, list: out.slice(0, w) };
}

/**
 * Mesh-domain `smooth` stroke: Taubin λ/μ relaxation restricted to the stroke's ball.
 * Vertices outside the radius keep their exact position (and normal). Normals of moved
 * vertices are recomputed from the area-weighted face normals. Returns how many vertices
 * moved. Mutates `mesh` in place.
 */
export function smoothMesh(mesh: MeshData, st: BrushStroke, adjacency?: Adjacency): number {
  if (st.kind !== "smooth") throw new Error(`smoothMesh got a ${st.kind} stroke`);
  const pos = mesh.positions;
  const n = pos.length / 3;
  const adj = adjacency ?? vertexAdjacency(mesh);
  const inside: number[] = [];
  const weights: number[] = [];
  for (let v = 0; v < n; v++) {
    const w = brushWeight(st, pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    if (w > 0) { inside.push(v); weights.push(w); }
  }
  if (inside.length === 0) return 0;
  const start = new Float32Array(inside.length * 3);
  for (let i = 0; i < inside.length; i++) for (let c = 0; c < 3; c++) start[i * 3 + c] = pos[inside[i] * 3 + c];
  const delta = new Float32Array(inside.length * 3);
  const step = (factor: number): void => {
    for (let i = 0; i < inside.length; i++) {
      const v = inside[i];
      const a = adj.offsets[v], b = adj.offsets[v + 1];
      if (b === a) { delta[i * 3] = delta[i * 3 + 1] = delta[i * 3 + 2] = 0; continue; }
      let sx = 0, sy = 0, sz = 0;
      for (let j = a; j < b; j++) { const u = adj.list[j]; sx += pos[u * 3]; sy += pos[u * 3 + 1]; sz += pos[u * 3 + 2]; }
      const inv = 1 / (b - a), f = factor * weights[i];
      delta[i * 3] = f * (sx * inv - pos[v * 3]);
      delta[i * 3 + 1] = f * (sy * inv - pos[v * 3 + 1]);
      delta[i * 3 + 2] = f * (sz * inv - pos[v * 3 + 2]);
    }
    for (let i = 0; i < inside.length; i++) for (let c = 0; c < 3; c++) pos[inside[i] * 3 + c] += delta[i * 3 + c];
  };
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) { step(TAUBIN_LAMBDA); step(TAUBIN_MU); }
  // Cap each vertex's total move at |s|·w (the stroke's displacement budget).
  const cap = Math.abs(st.strength);
  for (let i = 0; i < inside.length; i++) {
    const v = inside[i];
    const dx = pos[v * 3] - start[i * 3], dy = pos[v * 3 + 1] - start[i * 3 + 1], dz = pos[v * 3 + 2] - start[i * 3 + 2];
    const len = Math.hypot(dx, dy, dz), lim = cap * weights[i];
    if (len > lim && len > 0) {
      const k = lim / len;
      pos[v * 3] = start[i * 3] + dx * k; pos[v * 3 + 1] = start[i * 3 + 1] + dy * k; pos[v * 3 + 2] = start[i * 3 + 2] + dz * k;
    }
  }
  recomputeNormals(mesh, inside);
  return inside.length;
}

/** Area-weighted vertex normals for the listed vertices (all when `only` is absent). */
export function recomputeNormals(mesh: MeshData, only?: number[]): void {
  const pos = mesh.positions, idx = mesh.indices, nrm = mesh.normals;
  const n = pos.length / 3;
  const acc = new Float64Array(n * 3);
  const want = only ? new Uint8Array(n) : null;
  if (want && only) for (const v of only) want[v] = 1;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (want && !want[a] && !want[b] && !want[c]) continue;
    const e1x = pos[b * 3] - pos[a * 3], e1y = pos[b * 3 + 1] - pos[a * 3 + 1], e1z = pos[b * 3 + 2] - pos[a * 3 + 2];
    const e2x = pos[c * 3] - pos[a * 3], e2y = pos[c * 3 + 1] - pos[a * 3 + 1], e2z = pos[c * 3 + 2] - pos[a * 3 + 2];
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x; // 2·area·n̂
    for (const v of [a, b, c]) { acc[v * 3] += fx; acc[v * 3 + 1] += fy; acc[v * 3 + 2] += fz; }
  }
  const list = only ?? Array.from({ length: n }, (_, i) => i);
  for (const v of list) {
    const x = acc[v * 3], y = acc[v * 3 + 1], z = acc[v * 3 + 2];
    const l = Math.hypot(x, y, z);
    if (l > 0) { nrm[v * 3] = x / l; nrm[v * 3 + 1] = y / l; nrm[v * 3 + 2] = z / l; }
  }
}

/** Apply every MESH-domain stroke (`smooth`) in order. Returns the total vertices moved. */
export function applyMeshBrushes(mesh: MeshData, strokes: readonly BrushStroke[]): number {
  const mesh_ = strokes.filter((s) => s.kind === "smooth");
  if (mesh_.length === 0) return 0;
  const adj = vertexAdjacency(mesh);
  let moved = 0;
  for (const st of mesh_) moved += smoothMesh(mesh, st, adj);
  return moved;
}
