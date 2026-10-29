// Quaternion and small-vector helpers for the ragdoll, on flat Float64Arrays with offsets so
// the solver allocates nothing per frame. Quaternions are [x, y, z, w] (THREE's order), unit
// length, rotating vectors by v' = q·v·q⁻¹. Angles in radians.
//
// Joint-angle convention (the ragdoll's limit table): a joint's rotation relative to its rest
// is decomposed as R = Rx(flex) · Rz(abduct) · Ry(twist) — THREE's Euler order "XZY". Flex is the
// Skeleton's hinge axis (any angle, atan2), abduct the middle axis (|abduct| < π/2), twist the
// bone's long axis (the rig's bones run along −y).

/** out[oi..oi+3] = a[ai..] ⊗ b[bi..] (Hamilton product; `out` may alias neither input). */
export function qMul(out: Float64Array, oi: number, a: Float64Array, ai: number, b: Float64Array, bi: number): void {
  const ax = a[ai], ay = a[ai + 1], az = a[ai + 2], aw = a[ai + 3];
  const bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  out[oi] = aw * bx + ax * bw + ay * bz - az * by;
  out[oi + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[oi + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** out = conj(a) ⊗ b  (a⁻¹·b for unit a). */
export function qConjMul(out: Float64Array, oi: number, a: Float64Array, ai: number, b: Float64Array, bi: number): void {
  const ax = -a[ai], ay = -a[ai + 1], az = -a[ai + 2], aw = a[ai + 3];
  const bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  out[oi] = aw * bx + ax * bw + ay * bz - az * by;
  out[oi + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[oi + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** out = a ⊗ conj(b)  (a·b⁻¹ for unit b). */
export function qMulConj(out: Float64Array, oi: number, a: Float64Array, ai: number, b: Float64Array, bi: number): void {
  const ax = a[ai], ay = a[ai + 1], az = a[ai + 2], aw = a[ai + 3];
  const bx = -b[bi], by = -b[bi + 1], bz = -b[bi + 2], bw = b[bi + 3];
  out[oi] = aw * bx + ax * bw + ay * bz - az * by;
  out[oi + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[oi + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** Normalise q in place (a zero quaternion becomes the identity). */
export function qNormalize(q: Float64Array, i: number): void {
  const l = Math.hypot(q[i], q[i + 1], q[i + 2], q[i + 3]);
  if (l < 1e-12) { q[i] = 0; q[i + 1] = 0; q[i + 2] = 0; q[i + 3] = 1; return; }
  q[i] /= l; q[i + 1] /= l; q[i + 2] /= l; q[i + 3] /= l;
}

/** out[oi..oi+2] = q · v · q⁻¹ for v = (x, y, z). */
export function qRotate(out: Float64Array, oi: number, q: Float64Array, qi: number, x: number, y: number, z: number): void {
  const qx = q[qi], qy = q[qi + 1], qz = q[qi + 2], qw = q[qi + 3];
  // t = 2·(q.xyz × v); v' = v + w·t + q.xyz × t
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out[oi] = x + qw * tx + (qy * tz - qz * ty);
  out[oi + 1] = y + qw * ty + (qz * tx - qx * tz);
  out[oi + 2] = z + qw * tz + (qx * ty - qy * tx);
}

/** out = q⁻¹ · v · q (world → body frame). */
export function qRotateInv(out: Float64Array, oi: number, q: Float64Array, qi: number, x: number, y: number, z: number): void {
  const qx = -q[qi], qy = -q[qi + 1], qz = -q[qi + 2], qw = q[qi + 3];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out[oi] = x + qw * tx + (qy * tz - qz * ty);
  out[oi + 1] = y + qw * ty + (qz * tx - qx * tz);
  out[oi + 2] = z + qw * tz + (qx * ty - qy * tx);
}

/** q += ½·[ω, 0] ⊗ q with ω = (wx, wy, wz) in WORLD axes (a small rotation by |ω| rad), then normalise. */
export function qApplyRotation(q: Float64Array, i: number, wx: number, wy: number, wz: number): void {
  const qx = q[i], qy = q[i + 1], qz = q[i + 2], qw = q[i + 3];
  q[i] += 0.5 * (wx * qw + wy * qz - wz * qy);
  q[i + 1] += 0.5 * (wy * qw + wz * qx - wx * qz);
  q[i + 2] += 0.5 * (wz * qw + wx * qy - wy * qx);
  q[i + 3] += 0.5 * (-wx * qx - wy * qy - wz * qz);
  qNormalize(q, i);
}

/** q ← exp(½·θ) ⊗ q: rotate q by the world rotation vector θ = (tx, ty, tz) exactly (any angle). */
export function qIntegrate(q: Float64Array, i: number, tx: number, ty: number, tz: number): void {
  const angle = Math.hypot(tx, ty, tz);
  if (angle < 1e-9) return;
  const s = Math.sin(angle / 2) / angle, c = Math.cos(angle / 2);
  const ax = tx * s, ay = ty * s, az = tz * s, aw = c;
  const bx = q[i], by = q[i + 1], bz = q[i + 2], bw = q[i + 3];
  q[i] = aw * bx + ax * bw + ay * bz - az * by;
  q[i + 1] = aw * by - ax * bz + ay * bw + az * bx;
  q[i + 2] = aw * bz + ax * by - ay * bx + az * bw;
  q[i + 3] = aw * bw - ax * bx - ay * by - az * bz;
  qNormalize(q, i);
}

/**
 * Rotation vector (axis · angle, rad) of unit quaternion q, shortest arc (w ≥ 0), into out[oi..oi+2].
 * Returns the angle.
 */
export function qToRotationVector(out: Float64Array, oi: number, q: Float64Array, qi: number): number {
  let x = q[qi], y = q[qi + 1], z = q[qi + 2], w = q[qi + 3];
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.hypot(x, y, z);
  if (s < 1e-12) { out[oi] = 2 * x; out[oi + 1] = 2 * y; out[oi + 2] = 2 * z; return 2 * s; }
  const angle = 2 * Math.atan2(s, w);
  const k = angle / s;
  out[oi] = x * k; out[oi + 1] = y * k; out[oi + 2] = z * k;
  return angle;
}

/** Joint angles of a relative rotation q = Rx(flex)·Rz(abduct)·Ry(twist), into out[oi..oi+2] = [flex, abduct, twist]. */
export function qToFlexAbductTwist(out: Float64Array, oi: number, q: Float64Array, qi: number): void {
  const x = q[qi], y = q[qi + 1], z = q[qi + 2], w = q[qi + 3];
  const m00 = 1 - 2 * (y * y + z * z), m01 = 2 * (x * y - z * w), m02 = 2 * (x * z + y * w);
  const m11 = 1 - 2 * (x * x + z * z), m21 = 2 * (y * z + x * w);
  const m01c = m01 < -1 ? -1 : m01 > 1 ? 1 : m01;
  out[oi + 1] = Math.asin(-m01c);
  if (Math.abs(m01c) < 0.9999999) {
    out[oi] = Math.atan2(m21, m11);
    out[oi + 2] = Math.atan2(m02, m00);
  } else {
    // Gimbal (abduct = ±π/2): fold the twist into flex.
    const m12 = 2 * (y * z - x * w), m22 = 1 - 2 * (x * x + y * y);
    out[oi] = Math.atan2(-m12, m22);
    out[oi + 2] = 0;
  }
}

/** out[oi..oi+3] = Rx(flex) · Rz(abduct) · Ry(twist). */
export function qFromFlexAbductTwist(out: Float64Array, oi: number, flex: number, abduct: number, twist: number): void {
  const cx = Math.cos(flex / 2), sx = Math.sin(flex / 2);
  const cz = Math.cos(abduct / 2), sz = Math.sin(abduct / 2);
  const cy = Math.cos(twist / 2), sy = Math.sin(twist / 2);
  // (Rx ⊗ Rz) first: [sx·cz, −sx·sz, cx·sz, cx·cz]
  const ax = sx * cz, ay = -sx * sz, az = cx * sz, aw = cx * cz;
  // then ⊗ Ry = [0, sy, 0, cy]
  out[oi] = ax * cy - az * sy;
  out[oi + 1] = aw * sy + ay * cy;
  out[oi + 2] = az * cy + ax * sy;
  out[oi + 3] = aw * cy - ay * sy;
}

/** Wrap an angle to (−π, π]. */
export function wrapPi(a: number): number {
  const t = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return t === -Math.PI ? Math.PI : t;
}

/** Clamp an angle into [lo, hi] (lo ≤ hi), choosing the NEARER bound by angular distance when outside. */
export function clampAngle(a: number, lo: number, hi: number): number {
  if (a >= lo && a <= hi) return a;
  return Math.abs(wrapPi(a - lo)) <= Math.abs(wrapPi(a - hi)) ? lo : hi;
}
