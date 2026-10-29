// View-corridor geometry for camera occlusion (lane O, V01). Pure module: no THREE, no DOM.
//
// Vocabulary (used by Occluders.ts and the tests):
// - eye: where a view ray starts. Perspective camera: the camera position. Orthographic camera:
//   the target point projected back onto the camera plane (parallel rays).
// - target point: a point on the VIEWED character (head, chest, knees) that must stay visible.
// - corridor: the truncated cone from the eye (radius `eyeRadius`, m) to one target point (radius
//   `targetRadius`, m — the character's half-width at that height). Anything overlapping it hides
//   part of the character.
// - corridor parameter t: 0 at the eye, 1 at the target point (unitless). The corridor ENDS at
//   tEnd = 1 - subjectDepth / length: the part past the character's front surface is the
//   character itself or what stands BEHIND it, which never hides it.
// - cone radius r(t) = eyeRadius + (targetRadius - eyeRadius) * t, m.
// - margin: extra radius, m, carried by each tested bound (hysteresis: an occluder that is already
//   fading is released only once it clears the corridor by this much, so it never flickers).
//
// Allocation rule (measured with --trace-gc on V8 15): a double passed to, or returned from, a
// call V8 does not inline is boxed into a fresh HeapNumber. The per-frame tests therefore take
// OBJECTS (the corridor, the bound) or a Float64Array, never loose doubles, and write numeric
// results into a Float64Array instead of returning them.

import { clamp, clamp01, damp, lambdaFromHalfLife } from "../../core/MathCore.ts";

/** Below this squared length (m^2) a direction is treated as zero. */
const EPS = 1e-12;

/** One view corridor: the cone from an eye to one target point. Reused, never reallocated. */
export class Corridor {
  /** Eye position, m. */
  ex = 0; ey = 0; ez = 0;
  /** Full eye -> target vector, m (t = 1 at its tip). */
  dx = 0; dy = 0; dz = 0;
  /** |d|, m. */
  length = 0;
  /** Last corridor parameter that can hide the character (see the header), unitless in [0, 1]. */
  tEnd = 0;
  /** Cone radius at the eye and at the target point, m. */
  eyeRadius = 0; targetRadius = 0;

  /** The cone radius at corridor parameter `t`, m (convenience; the hot path inlines it). */
  radiusAt(t: number): number {
    return this.eyeRadius + (this.targetRadius - this.eyeRadius) * t;
  }
}

/** Index layout of the loadCorridor buffer: eye, target point, radii, subject depth (m). */
export const CORRIDOR_IN = { EYE: 0, TARGET: 3, EYE_RADIUS: 6, TARGET_RADIUS: 7, DEPTH: 8, LENGTH: 9 } as const;

/**
 * Fill `c` from `b` (layout CORRIDOR_IN): the corridor from the eye to the target point, m.
 * The depth (m) is how far in front of the target point the character's surface lies; the
 * corridor stops there: tEnd = max(0, 1 - depth / length). Allocation-free.
 */
export function loadCorridor(c: Corridor, b: Float64Array): Corridor {
  c.ex = b[0]; c.ey = b[1]; c.ez = b[2];
  c.dx = b[3] - b[0]; c.dy = b[4] - b[1]; c.dz = b[5] - b[2];
  c.length = Math.sqrt(c.dx * c.dx + c.dy * c.dy + c.dz * c.dz);
  c.tEnd = c.length > 1e-6 ? Math.max(0, 1 - b[8] / c.length) : 0;
  c.eyeRadius = b[6];
  c.targetRadius = b[7];
  return c;
}

const CORRIDOR_SCRATCH = new Float64Array(CORRIDOR_IN.LENGTH);

/**
 * Fill `c` with the corridor from eye (ex,ey,ez) to target point (tx,ty,tz), m (see
 * loadCorridor). Convenience form for build-time code and tests.
 */
export function setCorridor(
  c: Corridor,
  ex: number, ey: number, ez: number,
  tx: number, ty: number, tz: number,
  eyeRadius: number, targetRadius: number, subjectDepth: number,
): Corridor {
  const b = CORRIDOR_SCRATCH;
  b[0] = ex; b[1] = ey; b[2] = ez; b[3] = tx; b[4] = ty; b[5] = tz;
  b[6] = eyeRadius; b[7] = targetRadius; b[8] = subjectDepth;
  return loadCorridor(c, b);
}

/**
 * The corridor parameter of the point of the corridor axis closest to (px,py,pz), clamped to
 * [0, tEnd]. Unitless. (Build-time/test helper; the per-frame tests inline it.)
 */
export function corridorParamOf(c: Corridor, px: number, py: number, pz: number): number {
  const len2 = c.dx * c.dx + c.dy * c.dy + c.dz * c.dz;
  if (len2 < EPS) return 0;
  const t = ((px - c.ex) * c.dx + (py - c.ey) * c.dy + (pz - c.ez) * c.dz) / len2;
  return clamp(t, 0, c.tEnd);
}

/** A world bounding sphere and the test margin, m (OccluderRecord satisfies it). */
export interface SphereBound { wcx: number; wcy: number; wcz: number; wr: number; margin: number }

/** A world capsule (axis A->B, radius cr) and the test margin, m. */
export interface CapsuleBound { ax: number; ay: number; az: number; bx: number; by: number; bz: number; cr: number; margin: number }

/**
 * An oriented box: root-space centre (lcx..) and half extents (lhx..), the root's axis scales
 * (sx..), its world centre (wcx..) and world -> root matrix `inv` (column-major 4x4), m.
 */
export interface BoxBound extends SphereBound {
  lcx: number; lcy: number; lcz: number;
  lhx: number; lhy: number; lhz: number;
  sx: number; sy: number; sz: number;
  readonly inv: { readonly elements: ArrayLike<number> };
}

/**
 * Whether a sphere (world centre, radius, m) overlaps the corridor before tEnd.
 * Test: the axis point closest to the centre (t* in [0, tEnd]) lies within wr + r(t*) + margin.
 * Slightly conservative near the cone's flanks (the true closest cone point is not exactly at t*).
 */
export function sphereBlocksCorridor(c: Corridor, s: SphereBound): boolean {
  if (c.tEnd <= 0) return false;
  const len2 = c.dx * c.dx + c.dy * c.dy + c.dz * c.dz;
  if (len2 < EPS) return false;
  const t = clamp(((s.wcx - c.ex) * c.dx + (s.wcy - c.ey) * c.dy + (s.wcz - c.ez) * c.dz) / len2, 0, c.tEnd);
  const ox = c.ex + c.dx * t - s.wcx, oy = c.ey + c.dy * t - s.wcy, oz = c.ez + c.dz * t - s.wcz;
  const reach = s.wr + c.eyeRadius + (c.targetRadius - c.eyeRadius) * t + s.margin;
  return ox * ox + oy * oy + oz * oz <= reach * reach;
}

/** Index layout of the closestSegmentSegment buffer: inputs P1, Q1, P2, Q2; outputs S, T, DIST2. */
export const SEG = { P1: 0, Q1: 3, P2: 6, Q2: 9, S: 12, T: 13, DIST2: 14, LENGTH: 15 } as const;

/** Module scratch for the per-frame capsule test. */
const SEG_SCRATCH = new Float64Array(SEG.LENGTH);

/**
 * Closest points of segment P1->Q1 and segment P2->Q2. `buf` holds the inputs (m) at SEG.P1,
 * SEG.Q1, SEG.P2, SEG.Q2 (x, y, z each) and receives s, t (closest-point parameters in [0, 1])
 * and the squared distance (m^2) at SEG.S, SEG.T, SEG.DIST2. Ericson, Real-Time Collision
 * Detection 5.1.9. Allocation-free (buffer in, buffer out).
 */
export function closestSegmentSegment(buf: Float64Array): void {
  const p1x = buf[0], p1y = buf[1], p1z = buf[2], q1x = buf[3], q1y = buf[4], q1z = buf[5];
  const p2x = buf[6], p2y = buf[7], p2z = buf[8], q2x = buf[9], q2y = buf[10], q2z = buf[11];
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z;
  const d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0, t = 0;
  if (a <= EPS && e <= EPS) {
    s = 0; t = 0;
  } else if (a <= EPS) {
    s = 0; t = clamp01(f / e);
  } else {
    const cc = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0; s = clamp01(-cc / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > EPS ? clamp01((b * f - cc * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-cc / a); } else if (t > 1) { t = 1; s = clamp01((b - cc) / a); }
    }
  }
  const ox = p1x + d1x * s - (p2x + d2x * t);
  const oy = p1y + d1y * s - (p2y + d2y * t);
  const oz = p1z + d1z * s - (p2z + d2z * t);
  buf[12] = s; buf[13] = t; buf[14] = ox * ox + oy * oy + oz * oz;
}

/**
 * Whether a capsule overlaps the corridor before tEnd: the closest distance between the corridor
 * axis [0, tEnd] and the capsule axis is within cr + r(t*) + margin. Allocation-free.
 */
export function capsuleBlocksCorridor(c: Corridor, k: CapsuleBound): boolean {
  if (c.tEnd <= 0) return false;
  const e = c.tEnd, b = SEG_SCRATCH;
  b[0] = c.ex; b[1] = c.ey; b[2] = c.ez;
  b[3] = c.ex + c.dx * e; b[4] = c.ey + c.dy * e; b[5] = c.ez + c.dz * e;
  b[6] = k.ax; b[7] = k.ay; b[8] = k.az; b[9] = k.bx; b[10] = k.by; b[11] = k.bz;
  closestSegmentSegment(b);
  const t = b[12] * e;
  const reach = k.cr + c.eyeRadius + (c.targetRadius - c.eyeRadius) * t + k.margin;
  return b[14] <= reach * reach;
}

/** Index layout of the segmentHitsLocalBox buffer: segment S->Q, half extents H, pads P (m). */
export const SLAB = { S: 0, Q: 3, HALF: 6, PAD: 9, LENGTH: 12 } as const;

/** Module scratch for the per-frame box test. */
const SLAB_SCRATCH = new Float64Array(SLAB.LENGTH);

/**
 * Whether the segment S->Q (box-local coordinates, m) touches the axis-aligned box centred on the
 * origin with half extents H grown by pads P (buffer layout SLAB). Slab test over s in [0, 1].
 * Growing the box by the corridor radius approximates the cone-vs-box Minkowski sum
 * (conservative at the box corners by at most pad * (sqrt(3) - 1)).
 */
export function segmentHitsLocalBox(buf: Float64Array): boolean {
  let lo = 0, hi = 1;
  for (let axis = 0; axis < 3; axis++) {
    const s = buf[axis], d = buf[3 + axis] - s, h = buf[6 + axis] + buf[9 + axis];
    if (d * d < EPS) {
      if (s < -h || s > h) return false; // parallel to this slab and outside it
      continue;
    }
    let t1 = (-h - s) / d, t2 = (h - s) / d;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > lo) lo = t1;
    if (t2 < hi) hi = t2;
    if (lo > hi) return false;
  }
  return true;
}

/**
 * Whether an oriented box overlaps the corridor before tEnd: the corridor segment [0, tEnd] is
 * taken into root space (b.inv) and slab-tested against the box grown by the cone radius at the
 * box centre's corridor parameter plus the margin (divided by each axis scale). Allocation-free.
 */
export function boxBlocksCorridor(c: Corridor, b: BoxBound): boolean {
  if (c.tEnd <= 0) return false;
  const len2 = c.dx * c.dx + c.dy * c.dy + c.dz * c.dz;
  if (len2 < EPS) return false;
  const tMid = clamp(((b.wcx - c.ex) * c.dx + (b.wcy - c.ey) * c.dy + (b.wcz - c.ez) * c.dz) / len2, 0, c.tEnd);
  const pad = c.eyeRadius + (c.targetRadius - c.eyeRadius) * tMid + b.margin;
  const m = b.inv.elements, e = c.tEnd;
  const px = c.ex, py = c.ey, pz = c.ez;
  const qx = c.ex + c.dx * e, qy = c.ey + c.dy * e, qz = c.ez + c.dz * e;
  const s = SLAB_SCRATCH;
  s[0] = m[0] * px + m[4] * py + m[8] * pz + m[12] - b.lcx;
  s[1] = m[1] * px + m[5] * py + m[9] * pz + m[13] - b.lcy;
  s[2] = m[2] * px + m[6] * py + m[10] * pz + m[14] - b.lcz;
  s[3] = m[0] * qx + m[4] * qy + m[8] * qz + m[12] - b.lcx;
  s[4] = m[1] * qx + m[5] * qy + m[9] * qz + m[13] - b.lcy;
  s[5] = m[2] * qx + m[6] * qy + m[10] * qz + m[14] - b.lcz;
  s[6] = b.lhx; s[7] = b.lhy; s[8] = b.lhz;
  s[9] = pad / b.sx; s[10] = pad / b.sy; s[11] = pad / b.sz;
  return segmentHitsLocalBox(s);
}

// ---------------------------------------------------------------------------------------------
// Fade timing
// ---------------------------------------------------------------------------------------------

/**
 * Settle time of a fade TOWARD transparency, s: a blocker must be 95% faded within 0.3 s so the
 * character reappears within one reaction time (~0.25-0.3 s, the human visual reaction time).
 */
export const FADE_IN_SETTLE_TIME = 0.3;
/** The share of a fade that counts as settled (95%: the rest is below what the eye notices). */
export const FADE_SETTLE_FRACTION = 0.95;
/**
 * Half-life of the fade toward transparency, s:
 *   halfLife = settleTime / log2(1 / (1 - settleFraction)) = 0.3 / log2(20) ~= 0.069 s.
 */
export const FADE_IN_HALF_LIFE = FADE_IN_SETTLE_TIME / Math.log2(1 / (1 - FADE_SETTLE_FRACTION));
/**
 * Half-life of the return to opaque, s. Slower than the fade-in (0.25 s, 95% settled in ~1.1 s)
 * so an object that merely grazes the corridor does not pulse.
 */
export const FADE_OUT_HALF_LIFE = 0.25;
/**
 * Below this opacity gap (unitless) the opacity snaps onto its target, so a released occluder
 * gets its ORIGINAL material back in finite time (0.004 < 1/255: invisible on an 8-bit screen).
 */
export const FADE_SNAP = 0.004;

/**
 * One frame of opacity easing, frame-rate independent (MathCore.damp): toward a lower target
 * with `inHalfLife`, toward a higher one with `outHalfLife`, snapping within `snap`.
 * `current`, `target` in [0, 1]; `dt` in s; half-lives in s.
 */
export function stepOpacity(
  current: number, target: number, dt: number,
  inHalfLife = FADE_IN_HALF_LIFE, outHalfLife = FADE_OUT_HALF_LIFE, snap = FADE_SNAP,
): number {
  const halfLife = target < current ? inHalfLife : outHalfLife;
  const next = damp(current, target, lambdaFromHalfLife(halfLife), dt);
  return Math.abs(next - target) <= snap ? target : next;
}

/** The easing state stepped in place by stepFade (OccluderRecord satisfies it). */
export interface FadeState {
  /** Current opacity, [0, 1]. */
  opacity: number;
  /** Opacity it eases toward, [0, 1]. */
  targetOpacity: number;
}

/** The easing constants of stepFade (OcclusionTuning satisfies it). */
export interface FadeTiming {
  /** Seconds: half-life toward transparency, half-life back to opaque. */
  fadeInHalfLife: number; fadeOutHalfLife: number;
  /** Snap gap, unitless. */
  snap: number;
  /** This frame's step, s. */
  dt: number;
}

/**
 * stepOpacity in place: `state.opacity` eases toward `state.targetOpacity` with the SAME equation
 * (MathCore.damp with lambdaFromHalfLife, written out: next = cur + (target - cur) *
 * (1 - e^(-ln2 / halfLife * dt))), every input read from objects so no double crosses a call
 * boundary (see the header). tests/occlusion_corridor_test.ts asserts it equals stepOpacity.
 */
export function stepFade(state: FadeState, timing: FadeTiming): void {
  const cur = state.opacity, target = state.targetOpacity;
  const halfLife = target < cur ? timing.fadeInHalfLife : timing.fadeOutHalfLife;
  const k = 1 - Math.exp(-(Math.LN2 / Math.max(1e-6, halfLife)) * Math.max(0, timing.dt));
  const next = cur + (target - cur) * k;
  state.opacity = Math.abs(next - target) <= timing.snap ? target : next;
}

// ---------------------------------------------------------------------------------------------
// Screen-door dither (mirrors the GLSL in FadeMaterials.ts)
// ---------------------------------------------------------------------------------------------

/** 2x2 Bayer index of cell (x, y) in {0,1}^2: M2 = [[0, 2], [3, 1]] = 2x + 3y - 4xy. */
function bayer2(x: number, y: number): number {
  return 2 * x + 3 * y - 4 * x * y;
}

/**
 * The 4x4 ordered-dither (Bayer) threshold of pixel (x, y), in (0, 1):
 *   M4(x, y) = 4 * M2(x mod 2, y mod 2) + M2(floor(x/2) mod 2, floor(y/2) mod 2)
 *   threshold = (M4 + 0.5) / 16
 * A fragment is KEPT when opacity >= threshold, so opacity k/16 keeps exactly k of 16 pixels.
 */
export function bayer4Threshold(x: number, y: number): number {
  const px = ((Math.floor(x) % 4) + 4) % 4, py = ((Math.floor(y) % 4) + 4) % 4;
  const m = 4 * bayer2(px % 2, py % 2) + bayer2(Math.floor(px / 2), Math.floor(py / 2));
  return (m + 0.5) / 16;
}

/** The share of pixels a dithered surface keeps at `opacity` (= round(16 * opacity) / 16). */
export function ditherCoverage(opacity: number): number {
  let kept = 0;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (opacity >= bayer4Threshold(x, y)) kept++;
  return kept / 16;
}
