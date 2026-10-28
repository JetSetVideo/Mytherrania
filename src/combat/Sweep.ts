// Lane X (W05): continuous (swept) collision of a weapon's striking features against capsule
// hitboxes. Pure module (no THREE); allocation-free per call after a weapon's first sweep.
//
// Motion model between two frames: the weapon's local->world transform is interpolated as a
// rigid pose (grip position lerped, orientation slerped), so blade points travel on arcs about
// the grip. The frame is cut into N sub-steps, N = ceil(max(Δθ / MAX_SUBSTEP_ANGLE,
// travel / MAX_SUBSTEP_TRAVEL)), clamped to [1, MAX_SUBSTEPS]; inside a sub-step every point
// moves on a straight chord (sagitta ≤ L·Δθ²/8 ≈ 0.5 mm for a 1.5 m reach at 0.05 rad).
//   edge / shaft polyline segment: the quad its two endpoints sweep (two triangles) is tested
//     against each capsule axis — so a 30 m/s swing that crosses a forearm entirely between
//     two sub-steps still registers (no tunnelling);
//   point / head: the chord the point sweeps is a segment, tested against the capsule axis
//     (a swept sphere against a capsule).
// A hit inside sub-step k is refined to the EARLIEST instant at which the feature's capsule
// overlaps the hitbox (REFINE_SAMPLES samples; the closest approach if the overlap is thinner).

import type { Contact, Hitbox, HitboxSet, StrikeFeature, StrikeSample, V3, WeaponSpec } from "./contracts.ts";
import { decompose, interpolatePose, newPose, poseAngle, SEG_SEG, segSeg, segTri } from "./Geom.ts";

/** Largest rotation of the weapon inside one sub-step, rad (≈ 2.9°). */
export const MAX_SUBSTEP_ANGLE = 0.05;
/** Largest travel of any feature point inside one sub-step, m. */
export const MAX_SUBSTEP_TRAVEL = 0.03;
/** Sub-step cap per frame (a 60 Hz frame at 64 sub-steps is 0.26 ms of motion each). */
export const MAX_SUBSTEPS = 64;
/** Instants sampled inside the hit sub-step to find the earliest overlap. */
export const REFINE_SAMPLES = 8;
/** Frame interval assumed when the two samples carry no usable time difference, s. */
export const FALLBACK_DT = 1 / 60;
/** Contacts within this fraction of a frame count as simultaneous; the better feature wins. */
export const TIE_WINDOW = 1e-3;

/** Sweep options. */
export interface SweepOptions {
  /** Skip these hitboxes (e.g. the holder's gripping forearm in a self test). */
  exclude?: (box: Hitbox) => boolean;
  /** Extra contact distance, m (added to every feature radius). Default 0. */
  slack?: number;
}

/** Feature preference for simultaneous contacts: the one built to deliver this kind of blow. */
const KIND_RANK: Record<StrikeFeature["kind"], number> = { point: 3, edge: 2, head: 1, shaft: 0 };

/** Per-weapon scratch: flattened local points and world buffers for two instants. */
interface Compiled {
  features: StrikeFeature[];
  /** Offsets of each feature's points into `local` (in points). */
  start: Int32Array;
  count: Int32Array;
  local: Float64Array;
  /** World points at prev, at curr, two alternating sub-step buffers, and the refine buffer. */
  w0: Float64Array;
  w1: Float64Array;
  s1: Float64Array;
  s2: Float64Array;
  wr: Float64Array;
}
const COMPILED = new WeakMap<WeaponSpec, Compiled>();

function compile(weapon: WeaponSpec): Compiled {
  let c = COMPILED.get(weapon);
  if (c && c.features === weapon.features) return c;
  const n = weapon.features.reduce((s, f) => s + f.points.length, 0);
  const start = new Int32Array(weapon.features.length), count = new Int32Array(weapon.features.length);
  const local = new Float64Array(3 * n);
  let o = 0;
  weapon.features.forEach((f, i) => {
    start[i] = o; count[i] = f.points.length;
    for (const p of f.points) { local[3 * o] = p[0]; local[3 * o + 1] = p[1]; local[3 * o + 2] = p[2]; o++; }
  });
  const buf = () => new Float64Array(3 * n);
  c = { features: weapon.features, start, count, local, w0: buf(), w1: buf(), s1: buf(), s2: buf(), wr: buf() };
  COMPILED.set(weapon, c);
  return c;
}

/** Transform every local point by column-major `m` into `out`. */
function transformAll(m: ArrayLike<number>, local: Float64Array, out: Float64Array): void {
  for (let i = 0; i < local.length; i += 3) {
    const x = local[i], y = local[i + 1], z = local[i + 2];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
}

const P0 = newPose(), P1 = newPose();
const MT = new Float64Array(16), MA = new Float64Array(16), MB = new Float64Array(16);
const BOX = new Float64Array(6);

/** World AABB of a hitbox, grown by `grow` (m), into BOX. */
function boxAabb(b: Hitbox, grow: number): void {
  const r = b.radius + grow;
  BOX[0] = Math.min(b.wa[0], b.wb[0]) - r; BOX[3] = Math.max(b.wa[0], b.wb[0]) + r;
  BOX[1] = Math.min(b.wa[1], b.wb[1]) - r; BOX[4] = Math.max(b.wa[1], b.wb[1]) + r;
  BOX[2] = Math.min(b.wa[2], b.wb[2]) - r; BOX[5] = Math.max(b.wa[2], b.wb[2]) + r;
}

/** True when the points [from, to) of buffers A and B (both instants) can reach BOX. */
function sweptOverlaps(A: Float64Array, B: Float64Array, from: number, to: number): boolean {
  for (let k = 0; k < 3; k++) {
    let lo = Infinity, hi = -Infinity;
    for (let i = from; i < to; i++) {
      const a = A[3 * i + k], b = B[3 * i + k];
      if (a < lo) lo = a; if (a > hi) hi = a; if (b < lo) lo = b; if (b > hi) hi = b;
    }
    if (hi < BOX[k] || lo > BOX[k + 3]) return false;
  }
  return true;
}

/** Squared distance between feature fi (world points in W) and a hitbox axis; writes HIT_AT. */
const HIT_AT = { seg: 0, s: 0, fx: 0, fy: 0, fz: 0, bx: 0, by: 0, bz: 0 };
function featureDistance2(c: Compiled, fi: number, W: Float64Array, b: Hitbox): number {
  const s0 = c.start[fi], n = c.count[fi];
  let best = Infinity;
  if (n === 1) {
    const i = 3 * s0;
    best = segSeg(W[i], W[i + 1], W[i + 2], W[i], W[i + 1], W[i + 2], b.wa[0], b.wa[1], b.wa[2], b.wb[0], b.wb[1], b.wb[2]);
    HIT_AT.seg = 0; HIT_AT.s = 0;
    HIT_AT.fx = SEG_SEG.ax; HIT_AT.fy = SEG_SEG.ay; HIT_AT.fz = SEG_SEG.az; HIT_AT.bx = SEG_SEG.bx; HIT_AT.by = SEG_SEG.by; HIT_AT.bz = SEG_SEG.bz;
    return best;
  }
  for (let k = 0; k < n - 1; k++) {
    const i = 3 * (s0 + k), j = i + 3;
    const d2 = segSeg(W[i], W[i + 1], W[i + 2], W[j], W[j + 1], W[j + 2], b.wa[0], b.wa[1], b.wa[2], b.wb[0], b.wb[1], b.wb[2]);
    if (d2 < best) {
      best = d2; HIT_AT.seg = k; HIT_AT.s = SEG_SEG.s;
      HIT_AT.fx = SEG_SEG.ax; HIT_AT.fy = SEG_SEG.ay; HIT_AT.fz = SEG_SEG.az; HIT_AT.bx = SEG_SEG.bx; HIT_AT.by = SEG_SEG.by; HIT_AT.bz = SEG_SEG.bz;
    }
  }
  return best;
}

/** True when feature fi swept from W0 to W1 (straight chords) comes within `reach` of the box axis. */
function sweptHits(c: Compiled, fi: number, W0: Float64Array, W1: Float64Array, b: Hitbox, reach: number): boolean {
  const s0 = c.start[fi], n = c.count[fi], r2 = reach * reach;
  const ax = b.wa[0], ay = b.wa[1], az = b.wa[2], bx = b.wb[0], by = b.wb[1], bz = b.wb[2];
  if (n === 1) {
    const i = 3 * s0;
    return segSeg(W0[i], W0[i + 1], W0[i + 2], W1[i], W1[i + 1], W1[i + 2], ax, ay, az, bx, by, bz) <= r2;
  }
  for (let k = 0; k < n - 1; k++) {
    const i = 3 * (s0 + k), j = i + 3;
    // Quad A0 B0 B1 A1 as two triangles; the capsule axis is the segment.
    if (segTri(ax, ay, az, bx, by, bz, W0[i], W0[i + 1], W0[i + 2], W0[j], W0[j + 1], W0[j + 2], W1[j], W1[j + 1], W1[j + 2]) <= r2) return true;
    if (segTri(ax, ay, az, bx, by, bz, W0[i], W0[i + 1], W0[i + 2], W1[j], W1[j + 1], W1[j + 2], W1[i], W1[i + 1], W1[i + 2]) <= r2) return true;
  }
  return false;
}

/** The best contact found so far in the hit sub-step (scratch, copied into the result). */
const BEST = { t: Infinity, fi: -1, box: null as Hitbox | null, seg: 0, s: 0, fx: 0, fy: 0, fz: 0, bx: 0, by: 0, bz: 0, rank: -1 };

/** Unit vector of (x, y, z) into out (or the fallback when degenerate). Returns the length. */
function unitInto(x: number, y: number, z: number, out: V3, fx = 0, fy = 1, fz = 0): number {
  const l = Math.hypot(x, y, z);
  if (l > 1e-9) { out[0] = x / l; out[1] = y / l; out[2] = z / l; } else { out[0] = fx; out[1] = fy; out[2] = fz; }
  return l;
}

/**
 * Contract entry point: the EARLIEST contact of `weapon`'s striking features, moving from
 * `prev` to `curr`, with any hitbox of `target` (module comment). Returns null on a miss.
 * Contact.t is the fraction of the frame interval; velocity is the feature point's world
 * velocity there (m/s, central finite difference of the interpolated motion); edgeAlignment =
 * |cos(edge facing, velocity)| for edges (and the striking face of heads; 0 for shafts);
 * thrustAlignment = max(0, cos(thrust axis, velocity)) — a point only pierces moving forward
 * along its axis (the contract allows |cos|; the signed form is stricter).
 */
export function sweepStrike(prev: StrikeSample, curr: StrikeSample, target: HitboxSet, weapon: WeaponSpec, opts: SweepOptions = {}): Contact | null {
  if (weapon.features.length === 0 || target.boxes.length === 0) return null;
  const c = compile(weapon);
  const slack = opts.slack ?? 0;
  decompose(prev.matrix, P0); decompose(curr.matrix, P1);
  if (!P0.every(Number.isFinite) || !P1.every(Number.isFinite)) return null;
  transformAll(prev.matrix, c.local, c.w0);
  transformAll(curr.matrix, c.local, c.w1);
  // Broad phase: the whole frame's swept box against the whole target.
  let maxR = 0;
  for (const f of c.features) maxR = Math.max(maxR, f.radius);
  let travel = 0;
  for (let i = 0; i < c.local.length; i += 3) travel = Math.max(travel, Math.hypot(c.w1[i] - c.w0[i], c.w1[i + 1] - c.w0[i + 1], c.w1[i + 2] - c.w0[i + 2]));
  const nPts = c.local.length / 3;
  let anyNear = false;
  for (const b of target.boxes) {
    if (opts.exclude?.(b)) continue;
    boxAabb(b, maxR + slack);
    if (sweptOverlaps(c.w0, c.w1, 0, nPts)) { anyNear = true; break; }
  }
  if (!anyNear) return null;
  const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(Math.max(poseAngle(P0, P1) / MAX_SUBSTEP_ANGLE, travel / MAX_SUBSTEP_TRAVEL))));
  // Sub-step loop: wA/wB hold the feature points at the sub-step's two ends (s1/s2 alternate).
  let wA = c.w0, wB = c.s1;
  for (let k = 0; k < steps; k++) {
    const ta = k / steps, tb = (k + 1) / steps;
    if (k + 1 === steps) wB = c.w1; else { interpolatePose(P0, P1, tb, MT); transformAll(MT, c.local, wB); }
    BEST.t = Infinity; BEST.fi = -1; BEST.box = null; BEST.rank = -1;
    for (let fi = 0; fi < c.features.length; fi++) {
      const f = c.features[fi], reach = f.radius + slack;
      for (const b of target.boxes) {
        if (opts.exclude?.(b)) continue;
        boxAabb(b, reach);
        if (!sweptOverlaps(wA, wB, c.start[fi], c.start[fi] + c.count[fi])) continue;
        if (!sweptHits(c, fi, wA, wB, b, b.radius + reach)) continue;
        refine(c, fi, b, ta, tb, reach);
      }
    }
    if (BEST.box) return buildContact(c, prev, curr, steps);
    wA = wB;
    wB = wA === c.s1 ? c.s2 : c.s1;
  }
  return null;
}

/** Earliest overlap of feature fi with box b inside [ta, tb]; updates BEST when earlier/better. */
function refine(c: Compiled, fi: number, b: Hitbox, ta: number, tb: number, reach: number): void {
  const lim = (b.radius + reach) ** 2;
  let bestT = -1, closest = Infinity, closestT = ta;
  for (let s = 0; s <= REFINE_SAMPLES; s++) {
    const t = ta + (tb - ta) * (s / REFINE_SAMPLES);
    interpolatePose(P0, P1, t, MA);
    transformAll(MA, c.local, c.wr);
    const d2 = featureDistance2(c, fi, c.wr, b);
    if (d2 < closest) { closest = d2; closestT = t; }
    if (d2 <= lim) { bestT = t; break; }
  }
  const t = bestT >= 0 ? bestT : closestT;
  const rank = KIND_RANK[c.features[fi].kind];
  if (t < BEST.t - TIE_WINDOW || (Math.abs(t - BEST.t) <= TIE_WINDOW && rank > BEST.rank)) {
    // Re-evaluate at t for the closest-point pair.
    interpolatePose(P0, P1, t, MA);
    transformAll(MA, c.local, c.wr);
    featureDistance2(c, fi, c.wr, b);
    BEST.t = t; BEST.fi = fi; BEST.box = b; BEST.rank = rank; BEST.seg = HIT_AT.seg; BEST.s = HIT_AT.s;
    BEST.fx = HIT_AT.fx; BEST.fy = HIT_AT.fy; BEST.fz = HIT_AT.fz; BEST.bx = HIT_AT.bx; BEST.by = HIT_AT.by; BEST.bz = HIT_AT.bz;
  }
}

const LOC: V3 = [0, 0, 0], PA: V3 = [0, 0, 0], PB: V3 = [0, 0, 0];

/** World position of local point LOC under the interpolated pose at t, into out. */
function worldAt(t: number, out: V3): void {
  interpolatePose(P0, P1, t, MB);
  out[0] = MB[0] * LOC[0] + MB[4] * LOC[1] + MB[8] * LOC[2] + MB[12];
  out[1] = MB[1] * LOC[0] + MB[5] * LOC[1] + MB[9] * LOC[2] + MB[13];
  out[2] = MB[2] * LOC[0] + MB[6] * LOC[1] + MB[10] * LOC[2] + MB[14];
}

/** Build the Contact for BEST (allocates the result only). */
function buildContact(c: Compiled, prev: StrikeSample, curr: StrikeSample, steps: number): Contact {
  const f = c.features[BEST.fi], box = BEST.box!;
  const dtFrame = curr.time - prev.time > 1e-6 ? curr.time - prev.time : FALLBACK_DT;
  // Local coordinates of the contact point on the feature (segment seg, parameter s).
  const i = 3 * (c.start[BEST.fi] + BEST.seg), j = c.count[BEST.fi] > 1 ? i + 3 : i;
  for (let k = 0; k < 3; k++) LOC[k] = c.local[i + k] + (c.local[j + k] - c.local[i + k]) * BEST.s;
  // Velocity: central difference over half a sub-step either side, clamped to the frame.
  const h = 0.5 / steps, t0 = Math.max(0, BEST.t - h), t1 = Math.min(1, BEST.t + h);
  worldAt(t0, PA); worldAt(t1, PB);
  const span = Math.max(1e-9, (t1 - t0) * dtFrame);
  const velocity: V3 = [(PB[0] - PA[0]) / span, (PB[1] - PA[1]) / span, (PB[2] - PA[2]) / span];
  const vDir: V3 = [0, 0, 0];
  const speed = unitInto(velocity[0], velocity[1], velocity[2], vDir);
  // Normal: from the hitbox axis toward the feature (out of the target); degenerate -> against the motion.
  const normal: V3 = [0, 0, 0];
  unitInto(BEST.fx - BEST.bx, BEST.fy - BEST.by, BEST.fz - BEST.bz, normal, -vDir[0], -vDir[1], -vDir[2]);
  const point: V3 = [BEST.bx + normal[0] * box.radius, BEST.by + normal[1] * box.radius, BEST.bz + normal[2] * box.radius];
  // Directions at the contact instant.
  interpolatePose(P0, P1, BEST.t, MB);
  const dirOf = (x: number, y: number, z: number): V3 => {
    const out: V3 = [0, 0, 0];
    unitInto(MB[0] * x + MB[4] * y + MB[8] * z, MB[1] * x + MB[5] * y + MB[9] * z, MB[2] * x + MB[6] * y + MB[10] * z, out);
    return out;
  };
  const facing = f.facing ?? [0, 0, 1];
  const face = dirOf(facing[0], facing[1], facing[2]);
  // Thrust axis: a point feature's own `facing` when given, else the weapon's +y.
  const axis = f.kind === "point" && f.facing ? face : dirOf(0, 1, 0);
  const cosFace = face[0] * vDir[0] + face[1] * vDir[1] + face[2] * vDir[2];
  const cosAxis = axis[0] * vDir[0] + axis[1] * vDir[1] + axis[2] * vDir[2];
  const moving = speed > 1e-6;
  return {
    hitbox: box,
    feature: f.kind,
    point,
    normal,
    velocity,
    t: BEST.t,
    edgeAlignment: moving && f.kind !== "shaft" && f.kind !== "point" ? Math.abs(cosFace) : 0,
    thrustAlignment: moving ? Math.max(0, cosAxis) : 0,
    local: [LOC[0], LOC[1], LOC[2]],
    featureIndex: BEST.fi,
  };
}
