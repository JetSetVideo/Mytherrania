// Lane X geometry kernel: closest points between segments, points and triangles, rigid-pose
// interpolation of 4x4 matrices, PCA and the minimum enclosing circle. Pure module (no THREE),
// allocation-free on the hot paths: results land in module-level scratch records that the
// caller reads immediately (single-threaded, not re-entrant).
//
// Vocabulary
//   segment P→Q: the points P + s·(Q − P), s ∈ [0, 1].
//   closest-point pair: the two points (one per primitive) whose distance is the minimum.
//   pose: a rigid transform with uniform-ish scale, stored as position p, unit quaternion q
//   (x, y, z, w) and per-axis scale s; a column-major 4x4 matrix (three.js `elements`).

/** Squared length below which a direction is treated as degenerate (m²). */
export const GEOM_EPS = 1e-12;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Result of segSeg(): parameters on each segment, the two closest points and the squared distance. */
export const SEG_SEG = { s: 0, t: 0, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, d2: 0 };

/**
 * Closest points between segment 1 (P1→Q1) and segment 2 (P2→Q2), Ericson (2005) §5.1.9.
 * Writes SEG_SEG (s on segment 1, t on segment 2, points a on 1 and b on 2) and returns
 * the squared distance (m²). Degenerate segments (points) are handled.
 */
export function segSeg(
  p1x: number, p1y: number, p1z: number, q1x: number, q1y: number, q1z: number,
  p2x: number, p2y: number, p2z: number, q2x: number, q2y: number, q2z: number,
): number {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z;
  const d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0, t = 0;
  if (a <= GEOM_EPS && e <= GEOM_EPS) { s = 0; t = 0; }
  else if (a <= GEOM_EPS) { s = 0; t = clamp01(f / e); }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= GEOM_EPS) { t = 0; s = clamp01(-c / a); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z, denom = a * e - b * b;
      s = denom > GEOM_EPS * a * e ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); }
      else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  const R = SEG_SEG;
  R.s = s; R.t = t;
  R.ax = p1x + d1x * s; R.ay = p1y + d1y * s; R.az = p1z + d1z * s;
  R.bx = p2x + d2x * t; R.by = p2y + d2y * t; R.bz = p2z + d2z * t;
  const dx = R.ax - R.bx, dy = R.ay - R.by, dz = R.az - R.bz;
  R.d2 = dx * dx + dy * dy + dz * dz;
  return R.d2;
}

/** Result of pointTri(): the closest point on the triangle and the squared distance. */
export const POINT_TRI = { x: 0, y: 0, z: 0, d2: 0 };

/** Closest point on triangle ABC to point P (Ericson §5.1.5). Writes POINT_TRI, returns d² (m²). */
export function pointTri(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let x: number, y: number, z: number;
  out: {
    if (d1 <= 0 && d2 <= 0) { x = ax; y = ay; z = az; break out; }
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { x = bx; y = by; z = bz; break out; }
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); x = ax + abx * v; y = ay + aby * v; z = az + abz * v; break out; }
    const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) { x = cx; y = cy; z = cz; break out; }
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); x = ax + acx * w; y = ay + acy * w; z = az + acz * w; break out; }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      x = bx + (cx - bx) * w; y = by + (cy - by) * w; z = bz + (cz - bz) * w; break out;
    }
    const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
    x = ax + abx * v + acx * w; y = ay + aby * v + acy * w; z = az + abz * v + acz * w;
  }
  POINT_TRI.x = x; POINT_TRI.y = y; POINT_TRI.z = z;
  const dx = px - x, dy = py - y, dz = pz - z;
  POINT_TRI.d2 = dx * dx + dy * dy + dz * dz;
  return POINT_TRI.d2;
}

/**
 * Squared distance between segment P→Q and triangle ABC (0 when the segment pierces the
 * triangle): min over the segment endpoints against the triangle and the segment against the
 * three triangle edges, after a Möller–Trumbore crossing test. Used for the SWEPT surface of a
 * blade edge between two sub-steps (two triangles span the quad the edge sweeps), so a contact
 * inside a sub-step is found even when both instants are clear (no tunnelling).
 */
export function segTri(
  px: number, py: number, pz: number, qx: number, qy: number, qz: number,
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number,
): number {
  // Crossing test: P + s·(Q − P) = A + u·(B − A) + v·(C − A).
  const dx = qx - px, dy = qy - py, dz = qz - pz;
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az, e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(det) > 1e-14) {
    const inv = 1 / det, sx = px - ax, sy = py - ay, sz = pz - az;
    const u = (sx * hx + sy * hy + sz * hz) * inv;
    if (u >= 0 && u <= 1) {
      const kx = sy * e1z - sz * e1y, ky = sz * e1x - sx * e1z, kz = sx * e1y - sy * e1x;
      const v = (dx * kx + dy * ky + dz * kz) * inv;
      if (v >= 0 && u + v <= 1) {
        const s = (e2x * kx + e2y * ky + e2z * kz) * inv;
        if (s >= 0 && s <= 1) return 0;
      }
    }
  }
  let best = pointTri(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz);
  best = Math.min(best, pointTri(qx, qy, qz, ax, ay, az, bx, by, bz, cx, cy, cz));
  best = Math.min(best, segSeg(px, py, pz, qx, qy, qz, ax, ay, az, bx, by, bz));
  best = Math.min(best, segSeg(px, py, pz, qx, qy, qz, bx, by, bz, cx, cy, cz));
  best = Math.min(best, segSeg(px, py, pz, qx, qy, qz, cx, cy, cz, ax, ay, az));
  return best;
}

// --- matrices and poses -------------------------------------------------------------------

/** Transform local point (x, y, z) by column-major 4x4 `m` into out[o..o+2]. */
export function transformPoint(m: ArrayLike<number>, x: number, y: number, z: number, out: Float64Array | number[], o = 0): void {
  out[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
}

/** Rotate local direction (x, y, z) by the 3x3 part of `m` into out[o..o+2] (not normalised). */
export function transformDir(m: ArrayLike<number>, x: number, y: number, z: number, out: Float64Array | number[], o = 0): void {
  out[o] = m[0] * x + m[4] * y + m[8] * z;
  out[o + 1] = m[1] * x + m[5] * y + m[9] * z;
  out[o + 2] = m[2] * x + m[6] * y + m[10] * z;
}

/** A decomposed rigid pose: position, unit quaternion (x, y, z, w), per-axis scale. 10 floats. */
export type Pose10 = Float64Array;
export function newPose(): Pose10 { return new Float64Array(10); }

/** Decompose column-major 4x4 `m` (rotation·scale + translation) into `out` (Shepperd's method). */
export function decompose(m: ArrayLike<number>, out: Pose10): Pose10 {
  const sx = Math.hypot(m[0], m[1], m[2]) || 1, sy = Math.hypot(m[4], m[5], m[6]) || 1, sz = Math.hypot(m[8], m[9], m[10]) || 1;
  const r00 = m[0] / sx, r10 = m[1] / sx, r20 = m[2] / sx;
  const r01 = m[4] / sy, r11 = m[5] / sy, r21 = m[6] / sy;
  const r02 = m[8] / sz, r12 = m[9] / sz, r22 = m[10] / sz;
  const tr = r00 + r11 + r22;
  let qx: number, qy: number, qz: number, qw: number;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); qw = 0.25 / s; qx = (r21 - r12) * s; qy = (r02 - r20) * s; qz = (r10 - r01) * s; }
  else if (r00 > r11 && r00 > r22) { const s = 2 * Math.sqrt(1 + r00 - r11 - r22); qw = (r21 - r12) / s; qx = 0.25 * s; qy = (r01 + r10) / s; qz = (r02 + r20) / s; }
  else if (r11 > r22) { const s = 2 * Math.sqrt(1 + r11 - r00 - r22); qw = (r02 - r20) / s; qx = (r01 + r10) / s; qy = 0.25 * s; qz = (r12 + r21) / s; }
  else { const s = 2 * Math.sqrt(1 + r22 - r00 - r11); qw = (r10 - r01) / s; qx = (r02 + r20) / s; qy = (r12 + r21) / s; qz = 0.25 * s; }
  const n = Math.hypot(qx, qy, qz, qw) || 1;
  out[0] = m[12]; out[1] = m[13]; out[2] = m[14];
  out[3] = qx / n; out[4] = qy / n; out[5] = qz / n; out[6] = qw / n;
  out[7] = sx; out[8] = sy; out[9] = sz;
  return out;
}

/** Rotation angle (rad, 0..π) between the orientations of two poses. */
export function poseAngle(a: Pose10, b: Pose10): number {
  const dot = Math.abs(a[3] * b[3] + a[4] * b[4] + a[5] * b[5] + a[6] * b[6]);
  return 2 * Math.acos(Math.min(1, dot));
}

/**
 * Interpolated pose at fraction t: position and scale lerped, rotation slerped (shortest arc),
 * written as a column-major 4x4 into `m`. Points of the weapon then move on arcs about the grip
 * — the right path for a swing whose wrist moves less than its tip.
 */
export function interpolatePose(a: Pose10, b: Pose10, t: number, m: Float64Array | number[]): void {
  let bx = b[3], by = b[4], bz = b[5], bw = b[6];
  let cos = a[3] * bx + a[4] * by + a[5] * bz + a[6] * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let k0: number, k1: number;
  if (cos > 0.9995) { k0 = 1 - t; k1 = t; }
  else { const th = Math.acos(cos), s = Math.sin(th); k0 = Math.sin((1 - t) * th) / s; k1 = Math.sin(t * th) / s; }
  let x = a[3] * k0 + bx * k1, y = a[4] * k0 + by * k1, z = a[5] * k0 + bz * k1, w = a[6] * k0 + bw * k1;
  const n = Math.hypot(x, y, z, w) || 1; x /= n; y /= n; z /= n; w /= n;
  const sx = a[7] + (b[7] - a[7]) * t, sy = a[8] + (b[8] - a[8]) * t, sz = a[9] + (b[9] - a[9]) * t;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  m[0] = (1 - (yy + zz)) * sx; m[1] = (xy + wz) * sx; m[2] = (xz - wy) * sx; m[3] = 0;
  m[4] = (xy - wz) * sy; m[5] = (1 - (xx + zz)) * sy; m[6] = (yz + wx) * sy; m[7] = 0;
  m[8] = (xz + wy) * sz; m[9] = (yz - wx) * sz; m[10] = (1 - (xx + yy)) * sz; m[11] = 0;
  m[12] = a[0] + (b[0] - a[0]) * t; m[13] = a[1] + (b[1] - a[1]) * t; m[14] = a[2] + (b[2] - a[2]) * t; m[15] = 1;
}

// --- statistics on point clouds -----------------------------------------------------------

/**
 * Eigen-decomposition of a symmetric 3x3 matrix (cyclic Jacobi). `a` = [xx, xy, xz, yy, yz, zz].
 * Returns the eigenvalues (descending) and the unit eigenvectors as rows of a 3x3.
 */
export function symEigen3(a: ArrayLike<number>): { values: [number, number, number]; vectors: [[number, number, number], [number, number, number], [number, number, number]] } {
  const A = [[a[0], a[1], a[2]], [a[1], a[3], a[4]], [a[2], a[4], a[5]]];
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = A[0][1] ** 2 + A[0][2] ** 2 + A[1][2] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(A[p][q]) < 1e-30) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = A[k][p], akq = A[k][q];
          A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = A[p][k], aqk = A[q][k];
          A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const idx = [0, 1, 2].sort((i, j) => A[j][j] - A[i][i]);
  const vec = (i: number): [number, number, number] => [V[0][i], V[1][i], V[2][i]];
  return {
    values: [A[idx[0]][idx[0]], A[idx[1]][idx[1]], A[idx[2]][idx[2]]],
    vectors: [vec(idx[0]), vec(idx[1]), vec(idx[2])],
  };
}

/**
 * Smallest circle enclosing 2-D points (Welzl, iterative move-to-front form; expected linear
 * time after the deterministic shuffle). Returns centre (cx, cy) and radius r.
 */
export function minEnclosingCircle(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number): { cx: number; cy: number; r: number } {
  if (n === 0) return { cx: 0, cy: 0, r: 0 };
  const X = new Float64Array(n), Y = new Float64Array(n);
  for (let i = 0; i < n; i++) { X[i] = xs[i]; Y[i] = ys[i]; }
  let seed = (0x9e3779b9 ^ n) >>> 0;
  for (let i = n - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    let t = X[i]; X[i] = X[j]; X[j] = t;
    t = Y[i]; Y[i] = Y[j]; Y[j] = t;
  }
  const EPS = 1e-12;
  let cx = X[0], cy = Y[0], r2 = 0;
  for (let i = 1; i < n; i++) {
    if ((X[i] - cx) ** 2 + (Y[i] - cy) ** 2 <= r2 * (1 + EPS) + 1e-18) continue;
    cx = X[i]; cy = Y[i]; r2 = 0;
    for (let j = 0; j < i; j++) {
      if ((X[j] - cx) ** 2 + (Y[j] - cy) ** 2 <= r2 * (1 + EPS) + 1e-18) continue;
      cx = (X[i] + X[j]) / 2; cy = (Y[i] + Y[j]) / 2; r2 = (X[i] - cx) ** 2 + (Y[i] - cy) ** 2;
      for (let k = 0; k < j; k++) {
        if ((X[k] - cx) ** 2 + (Y[k] - cy) ** 2 <= r2 * (1 + EPS) + 1e-18) continue;
        // Circumcircle of i, j, k (collinear: the widest pair).
        const ax = X[i], ay = Y[i], bx = X[j], by = Y[j], qx = X[k], qy = Y[k];
        const d = 2 * (ax * (by - qy) + bx * (qy - ay) + qx * (ay - by));
        if (Math.abs(d) < 1e-18) {
          const dij = (ax - bx) ** 2 + (ay - by) ** 2, dik = (ax - qx) ** 2 + (ay - qy) ** 2, djk = (bx - qx) ** 2 + (by - qy) ** 2;
          if (dij >= dik && dij >= djk) { cx = (ax + bx) / 2; cy = (ay + by) / 2; r2 = dij / 4; }
          else if (dik >= djk) { cx = (ax + qx) / 2; cy = (ay + qy) / 2; r2 = dik / 4; }
          else { cx = (bx + qx) / 2; cy = (by + qy) / 2; r2 = djk / 4; }
          continue;
        }
        const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = qx * qx + qy * qy;
        cx = (a2 * (by - qy) + b2 * (qy - ay) + c2 * (ay - by)) / d;
        cy = (a2 * (qx - bx) + b2 * (ax - qx) + c2 * (bx - ax)) / d;
        r2 = (ax - cx) ** 2 + (ay - cy) ** 2;
      }
    }
  }
  return { cx, cy, r: Math.sqrt(r2) };
}
