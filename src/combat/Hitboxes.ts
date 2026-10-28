// Lane X (W09): body-shaped capsule hitboxes fitted to the SDF anatomy, one or more capsules per
// anatomical part, each riding the bone its volumes follow. Pure module (no THREE).
//
// Method (every number derived from the plan; see the constants below):
//   1. Voxelise the body's POSITIVE volumes (primitives that add matter; the cutters of a
//      subtract/intersect are skipped, the ground half-space is replaced by y >= 0) on a grid
//      of step h = VOXEL_PER_CELL · plan.cell. Each voxel belongs to the primitive it is
//      deepest inside, hence to a (zone, side, bone) GROUP via zoneOf(bone, region).
//   2. Fit each group's voxel cloud with a capsule: for each candidate axis (the bone direction
//      and the cloud's principal axes) the cross-section is centred on the minimum enclosing
//      circle and sized to hold COVER_QUANTILE of the voxels, grown by half a voxel and inset by
//      SKIN_INSET, capped at THICKNESS_CAP × the part's half-thickness; the segment ends are the
//      tightest caps that still hold every kept voxel. The axis with the lowest COST wins, cost =
//      air enclosed (overshoot, measured on the voxel grid) + UNCOVERED_WEIGHT × body left out.
//   3. While a capsule costs more than SPLIT_RATIO − 1 of its cloud, split the cloud across a
//      principal axis at SPLIT_QUANTILES and keep the cheapest split if it saves 1 − SPLIT_GAIN;
//      budget ceil(V / VOLUME_PER_CAPSULE) + EXTRA_CAPSULES ≤ MAX_CAPSULES_PER_GROUP. A repair
//      pass gives voxels no capsule holds (> REPAIR_SHARE of the part) their own capsules.
//   4. Store each capsule in its bone's BIND frame (T(head)·Rz(bind roll), the frame
//      SkinnedHumanoid builds), so updateHitboxes only needs the bones' world matrices.
// Measured (tests/combat_hitboxes_test.ts): human 50 capsules, ork 57; 99.0 % / 95.9 % of skin
// vertices within r + 1 cm; air overshoot 21.6 % / 15.5 %; 230–320 ms once per body (cached per
// plan object, so a rematch refits nothing).
//   Mass: voxel volume × TISSUE_DENSITY unless the caller passes the body's real mass.

import type { AnatomyPlan, BoneId, Primitive, Region, SdfNode, SdfSample, Vec3 } from "../graphics/body/contracts.ts";
import { REGIONS } from "../graphics/body/contracts.ts";
import { BONE_IDS, compileSdf, primitiveBounds } from "../graphics/body/Sdf.ts";
import { bodyField } from "../graphics/body/BodyMesh.ts";
import type { HitZone, Hitbox, HitboxSet, V3 } from "./contracts.ts";
import { minEnclosingCircle, symEigen3 } from "./Geom.ts";

/** Soft-tissue density, kg/m³ (lean muscle 1060, fat 920, whole body ≈ 1010 with the lungs). */
export const TISSUE_DENSITY = 1010;
/** Voxel step as a fraction of the plan's polygoniser cell (finer than the skin's own grid). */
export const VOXEL_PER_CELL = 0.5;
/** Voxel step clamp, m: below 6 mm the fit costs more than it gains; above 15 mm radii drift. */
export const VOXEL_MIN = 0.006, VOXEL_MAX = 0.015;
/**
 * Share of a group's voxels the cross-section circle must hold. The rest (a thumb tip, a nose)
 * pokes out by a few mm; the weapon's own radius and CONTACT_SLACK absorb it.
 */
export const COVER_QUANTILE = 0.985;
/** Split a capsule when its volume exceeds its voxel cloud's volume by this factor. */
export const SPLIT_RATIO = 1.1;
/** Keep a split only when the two halves need at most this share of the parent's volume. */
export const SPLIT_GAIN = 0.88;
/** Capsules per group, at most. */
export const MAX_CAPSULES_PER_GROUP = 8;
/**
 * Body volume one capsule may stand for, m³: a group of volume V gets at most
 * ceil(V / VOLUME_PER_CAPSULE) capsules (a 13 L chest: 6, a 1 L forearm: 1), so small parts
 * stay single and the whole body lands near 30–40 capsules.
 */
export const VOLUME_PER_CAPSULE = 0.0025;
/**
 * Depth (m) the capsule surface sits INSIDE the skin, ≤ CONTACT_SLACK: a blow must reach this
 * deep into the skin to count (no phantom hits on the air around a limb). The body's
 * surface-to-volume ratio is ~27 /m, so every mm of radius is ~2.7 % of overshoot.
 */
export const SKIN_INSET = 0.006;
/**
 * A capsule's radius never exceeds THICKNESS_CAP × its part's half-thickness: 1 keeps a flat
 * trunk from being covered by one fat capsule (round limbs are unaffected: a cylinder's
 * moment-based half-thickness is 1.12 × its radius).
 */
export const THICKNESS_CAP = 1.2;
/** Weight of an uncovered body voxel against an enclosed air voxel in the fit cost. */
export const UNCOVERED_WEIGHT = 2;
/** Voxels used to RANK candidate axes and splits (the winner is refitted on all voxels). */
export const FIT_SAMPLE = 500;
/** Split planes tried across each principal axis, as quantiles of the cloud's projection. */
export const SPLIT_QUANTILES = [1 / 3, 1 / 2, 2 / 3];
/** Air sampling stride for capsules whose box spans more than AIR_STRIDE_CELLS cells. */
export const AIR_STRIDE = 2, AIR_STRIDE_CELLS = 3000;
/** Extra capsules every group may use beyond its volume share (tapered limbs, flat hands). */
export const EXTRA_CAPSULES = 2;
/**
 * Repair pass: a part whose uncovered voxels exceed max(REPAIR_MIN_VOXELS, REPAIR_SHARE × its
 * voxels) gets up to REPAIR_CAPSULES extra, uncapped capsules fitted to exactly those voxels.
 */
export const REPAIR_SHARE = 0.08, REPAIR_MIN_VOXELS = 12, REPAIR_CAPSULES = 2;
/** A cloud with fewer voxels than this is never split (too thin to fit two capsules). */
export const MIN_SPLIT_VOXELS = 60;
/**
 * Skin that may stand outside a hitbox, m: smooth-union bulges (≤ k/4 of the blend width) and
 * sculpt strokes (kneecap, brow) that the primitives do not carry. Contact tests add it to the
 * weapon radius; coverage tests allow it.
 */
export const CONTACT_SLACK = 0.01;

/** Debug switch (QA probes): log every rejected split. */
export const DEBUG = { on: false };

/** Timings of the last hitboxesFromPlan call (ms) and its sizes, for QA/perf reports. */
export const lastFitTiming = { voxelMs: 0, bandMs: 0, bandCells: 0, fitMs: 0, capsules: 0, voxels: 0, step: 0 };

/** Build options (all optional; defaults derived above). */
export interface HitboxFitOptions {
  /** Total body mass, kg (e.g. BodySpec.weight). Default: voxel volume × TISSUE_DENSITY. */
  mass?: number;
  /** Voxel step, m. Default clamp(VOXEL_PER_CELL · plan.cell, VOXEL_MIN, VOXEL_MAX). */
  step?: number;
  /**
   * Test the thin band just outside the primitives against the real skin field (smooth-union
   * bulges, sculpt strokes). Default true; false is faster and fits the bare primitives.
   */
  fullField?: boolean;
}

/** Which hit zone and side a body volume belongs to (null: not part of the target, e.g. the ground). */
export function zoneOf(bone: BoneId, region: Region): { zone: HitZone; side: "L" | "R" | "C" } | null {
  const side: "L" | "R" | "C" = bone.endsWith("L") ? "L" : bone.endsWith("R") ? "R" : "C";
  switch (bone) {
    case "head": return { zone: "head", side };
    case "neck": return { zone: "neck", side };
    case "spine": return { zone: "chest", side };
    case "abdomen": return { zone: region === "pelvis" ? "pelvis" : "abdomen", side };
    case "root": return region === "sole" ? null : { zone: "pelvis", side };
    case "shoulderL": case "shoulderR": return { zone: "upperArm", side };
    case "elbowL": case "elbowR": return { zone: region === "hand" || region === "nail" ? "hand" : "foreArm", side };
    case "hipL": case "hipR": return { zone: "thigh", side };
    case "kneeL": case "kneeR": return { zone: "shin", side };
    default: return { zone: "foot", side };
  }
}

/** Primitives that ADD matter: the left operand of subtract/intersect keeps, the cutters do not. */
export function positivePrimitives(node: SdfNode, out: Primitive[] = []): Primitive[] {
  if (node.type === "primitive") { out.push(node.primitive); return out; }
  const keepAll = node.op === "union" || node.op === "smoothUnion";
  node.children.forEach((c, i) => { if (keepAll || i === 0) positivePrimitives(c, out); });
  return out;
}

/**
 * Bind-pose roll (rad about +z) of a bone's WORLD frame, as SkinnedHumanoid builds it: the arm
 * chain carries the solved arm abduction, the leg chain the leg abduction (σ = +1 left, −1
 * right), every other bone 0. Read from DetailedAnatomy when present, else solved from the bone
 * direction d = (σ sin a, −cos a, 0) of the shoulder / hip.
 */
export function bindRoll(plan: AnatomyPlan, bone: BoneId): number {
  const extra = plan as AnatomyPlan & { armAbduction?: number; legAbduction?: number };
  const fromDir = (id: BoneId): number => {
    const seg = plan.bones.find((b) => b.id === id);
    if (!seg) return 0;
    const dx = seg.tail[0] - seg.head[0], dy = seg.tail[1] - seg.head[1];
    return Math.atan2(Math.abs(dx), -dy);
  };
  const arm = typeof extra.armAbduction === "number" ? extra.armAbduction : fromDir("shoulderL");
  const leg = typeof extra.legAbduction === "number" ? extra.legAbduction : fromDir("hipL");
  if (bone === "shoulderL" || bone === "elbowL") return arm;
  if (bone === "shoulderR" || bone === "elbowR") return -arm;
  if (bone === "hipL" || bone === "kneeL" || bone === "ankleL" || bone === "toeL") return leg;
  if (bone === "hipR" || bone === "kneeR" || bone === "ankleR" || bone === "toeR") return -leg;
  return 0;
}

/** Column-major 4x4 of a bone's bind WORLD frame (model space = group space at identity). */
export function bindBoneMatrix(plan: AnatomyPlan, bone: BoneId): Float64Array {
  const seg = plan.bones.find((b) => b.id === bone);
  const h = seg ? seg.head : [0, 0, 0];
  const r = bindRoll(plan, bone), c = Math.cos(r), s = Math.sin(r);
  return new Float64Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, h[0], h[1], h[2], 1]);
}

/** Distance (m) from a point to a model capsule's AXIS segment. */
function pointCapsule(x: number, y: number, z: number, c: ModelCapsule): number {
  const dx = c.b[0] - c.a[0], dy = c.b[1] - c.a[1], dz = c.b[2] - c.a[2], L2 = dx * dx + dy * dy + dz * dz;
  let t = L2 > 1e-12 ? ((x - c.a[0]) * dx + (y - c.a[1]) * dy + (z - c.a[2]) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - c.a[0] - dx * t, y - c.a[1] - dy * t, z - c.a[2] - dz * t);
}

/** One fitted capsule in MODEL space. */
interface ModelCapsule { a: Vec3; b: Vec3; r: number; volume: number }


/** Two unit vectors completing `u` to an orthonormal basis. */
function basisOf(u: Vec3): [Vec3, Vec3] {
  const t: Vec3 = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const v0: Vec3 = [u[1] * t[2] - u[2] * t[1], u[2] * t[0] - u[0] * t[2], u[0] * t[1] - u[1] * t[0]];
  const lv = Math.hypot(...v0) || 1;
  const v: Vec3 = [v0[0] / lv, v0[1] / lv, v0[2] / lv];
  return [v, [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]];
}

/** Principal axes of a cloud (rows, descending variance). */
function principalAxes(pts: Float64Array, n: number): Vec3[] {
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < n; i++) { mx += pts[3 * i]; my += pts[3 * i + 1]; mz += pts[3 * i + 2]; }
  mx /= n; my /= n; mz /= n;
  const c = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = pts[3 * i] - mx, y = pts[3 * i + 1] - my, z = pts[3 * i + 2] - mz;
    c[0] += x * x; c[1] += x * y; c[2] += x * z; c[3] += y * y; c[4] += y * z; c[5] += z * z;
  }
  return symEigen3(c).vectors as Vec3[];
}

/** A fitted capsule plus how well it fits its cloud. */
interface Fit extends ModelCapsule { air: number; uncovered: number; axis: Vec3 }

/**
 * Tightest capsule along axis u holding the COVER_QUANTILE nearest voxels of the cloud, grown
 * by `pad` (half a voxel minus SKIN_INSET) and capped at `rCap` (the part's half-thickness: a
 * flat trunk is tiled by several thin capsules rather than one fat one). `uncovered` counts the
 * voxels left outside (the corners a capped radius gives up; a split then picks them up).
 */
function capsuleAlong(
  pts: Float64Array, n: number, u: Vec3, pad: number, rCap: number, full: Float64Array = pts, fullN: number = n,
): ModelCapsule & { uncovered: number } {
  const [v, w] = basisOf(u);
  const xs = new Float64Array(n), ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const px = pts[3 * i], py = pts[3 * i + 1], pz = pts[3 * i + 2];
    xs[i] = px * v[0] + py * v[1] + pz * v[2]; ys[i] = px * w[0] + py * w[1] + pz * w[2];
  }
  // Cross-section: centre of the enclosing circle; radius = the COVER_QUANTILE radial distance.
  const circ = minEnclosingCircle(xs, ys, n);
  const rho = new Float64Array(n);
  for (let i = 0; i < n; i++) rho[i] = Math.hypot(xs[i] - circ.cx, ys[i] - circ.cy);
  const sorted = Float64Array.from(rho).sort();
  circ.r = sorted[Math.min(n - 1, Math.floor(COVER_QUANTILE * (n - 1)))];
  const r = Math.min(rCap, Math.max(0.5 * circ.r, circ.r + pad));
  // Ends and coverage over the FULL cloud (the circle may come from a subsample). A voxel is
  // uncovered when it lies beyond the accepted skin layer: rr > r + SKIN_INSET.
  let t0 = Infinity, t1 = -Infinity, uncovered = 0;
  for (let i = 0; i < fullN; i++) {
    const px = full[3 * i], py = full[3 * i + 1], pz = full[3 * i + 2];
    const rv = px * v[0] + py * v[1] + pz * v[2] - circ.cx, rw = px * w[0] + py * w[1] + pz * w[2] - circ.cy;
    const rr = Math.sqrt(rv * rv + rw * rw), t = px * u[0] + py * u[1] + pz * u[2];
    if (rr > r + SKIN_INSET) uncovered++;
    if (rr > r) continue;
    const half = Math.sqrt(r * r - rr * rr);
    t0 = Math.min(t0, t + half);
    t1 = Math.max(t1, t - half);
  }
  if (!(t0 <= t1)) { const m = Number.isFinite(t0 + t1) ? (t0 + t1) / 2 : 0; t0 = m; t1 = m; }
  const at = (t: number): Vec3 => [
    u[0] * t + v[0] * circ.cx + w[0] * circ.cy,
    u[1] * t + v[1] * circ.cx + w[1] * circ.cy,
    u[2] * t + v[2] * circ.cx + w[2] * circ.cy,
  ];
  return { a: at(t0), b: at(t1), r, volume: Math.PI * r * r * (t1 - t0) + (4 / 3) * Math.PI * r ** 3, uncovered };
}

/**
 * The voxel grid the fit scores against: owner[cell] >= 0 means the cell is body (any group),
 * < 0 means air. A capsule's OVERSHOOT is the air it encloses — overlap with other capsules or
 * other body parts costs nothing, so overlapping capsules can tile a flat trunk tightly.
 */
interface Grid { owner: Int16Array; nx: number; ny: number; nz: number; min: number[]; h: number }

/**
 * Air volume (m³) inside a capsule, counted on the grid's cell centres. Large capsules are
 * sampled every AIR_STRIDE cells per axis (each sample stands for stride³ cells): the fit only
 * RANKS candidates, so a 1/8 sample is enough and keeps the fit fast.
 */
function airInside(c: ModelCapsule, g: Grid): number {
  const { owner, nx, ny, nz, min, h } = g;
  const lo = (k: number) => Math.min(c.a[k], c.b[k]) - c.r, hi = (k: number) => Math.max(c.a[k], c.b[k]) + c.r;
  const i0 = Math.max(0, Math.floor((lo(0) - min[0]) / h)), i1 = Math.min(nx - 1, Math.floor((hi(0) - min[0]) / h));
  const j0 = Math.max(0, Math.floor((lo(1) - min[1]) / h)), j1 = Math.min(ny - 1, Math.floor((hi(1) - min[1]) / h));
  const k0 = Math.max(0, Math.floor((lo(2) - min[2]) / h)), k1 = Math.min(nz - 1, Math.floor((hi(2) - min[2]) / h));
  const cells = (i1 - i0 + 1) * (j1 - j0 + 1) * (k1 - k0 + 1);
  const st = cells > AIR_STRIDE_CELLS ? AIR_STRIDE : 1;
  const dx = c.b[0] - c.a[0], dy = c.b[1] - c.a[1], dz = c.b[2] - c.a[2], L2 = dx * dx + dy * dy + dz * dz, r2 = c.r * c.r;
  let air = 0;
  for (let k = k0; k <= k1; k += st) {
    const z = min[2] + (k + 0.5) * h - c.a[2];
    for (let j = j0; j <= j1; j += st) {
      const y = min[1] + (j + 0.5) * h - c.a[1];
      for (let i = i0; i <= i1; i += st) {
        if (owner[i + nx * (j + ny * k)] >= 0) continue;
        const x = min[0] + (i + 0.5) * h - c.a[0];
        let t = L2 > 1e-12 ? (x * dx + y * dy + z * dz) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = x - dx * t, ey = y - dy * t, ez = z - dz * t;
        if (ex * ex + ey * ey + ez * ez <= r2) air++;
      }
    }
  }
  return air * (st * h) ** 3;
}

/** Every k-th voxel so at most FIT_SAMPLE remain (candidate ranking only; the winner uses all). */
function subsample(pts: Float64Array, n: number): { pts: Float64Array; n: number; scale: number } {
  if (n <= FIT_SAMPLE) return { pts, n, scale: 1 };
  const step = Math.ceil(n / FIT_SAMPLE), m = Math.ceil(n / step), out = new Float64Array(3 * m);
  for (let i = 0, o = 0; i < n; i += step, o++) { out[3 * o] = pts[3 * i]; out[3 * o + 1] = pts[3 * i + 1]; out[3 * o + 2] = pts[3 * i + 2]; }
  return { pts: out, n: m, scale: n / m };
}

/**
 * Fit cost, m³: air enclosed plus UNCOVERED_WEIGHT × the body left uncovered (both are hit-test
 * errors; a blow that passes through a body part unregistered is the worse one).
 */
const costOf = (f: { air: number; uncovered: number }, voxel: number) => f.air + UNCOVERED_WEIGHT * f.uncovered * voxel;

/**
 * Best single capsule over the candidate axes (the bone direction, then the cloud's principal
 * axes; `axisCount` limits the principal axes tried), ranked by costOf on a subsample, then
 * refitted on the whole cloud along the winning axis.
 */
function fitOne(pts: Float64Array, n: number, boneDir: Vec3 | null, pad: number, rCap: number, g: Grid, axisCount = 3): Fit {
  const sub = subsample(pts, n), voxel = g.h ** 3;
  const axes = principalAxes(sub.pts, sub.n).slice(0, axisCount);
  if (boneDir) axes.unshift(boneDir);
  let bestAxis = axes[0], bestCost = Infinity;
  for (const u of axes) {
    const c = capsuleAlong(sub.pts, sub.n, u, pad, rCap);
    const cost = costOf({ air: airInside(c, g), uncovered: c.uncovered * sub.scale }, voxel);
    if (cost < bestCost) { bestCost = cost; bestAxis = u; }
  }
  const c = capsuleAlong(sub.pts, sub.n, bestAxis, pad, rCap, pts, n);
  return { ...c, air: airInside(c, g), axis: bestAxis };
}

/**
 * Recursive fit (module comment, step 3): split while the capsule's cost (air + uncovered body)
 * exceeds SPLIT_RATIO − 1 of its cloud, trying SPLIT_QUANTILES planes across each principal axis
 * and keeping the split whose halves cost least, if that saves at least 1 − SPLIT_GAIN.
 */
function fitCloud(pts: Float64Array, n: number, boneDir: Vec3 | null, pad: number, rCap: number, budget: number, g: Grid): ModelCapsule[] {
  const voxel = g.h ** 3;
  const one = fitOne(pts, n, boneDir, pad, rCap, g);
  const oneCost = costOf(one, voxel), cloud = n * voxel;
  if (budget < 2 || n < MIN_SPLIT_VOXELS || oneCost <= (SPLIT_RATIO - 1) * cloud) return [one];
  let best: { lo: Float64Array; hi: Float64Array; cost: number } | null = null;
  const sub = subsample(pts, n);
  const proj = new Float64Array(n);
  for (const axis of principalAxes(sub.pts, sub.n)) {
    for (let i = 0; i < n; i++) proj[i] = pts[3 * i] * axis[0] + pts[3 * i + 1] * axis[1] + pts[3 * i + 2] * axis[2];
    const sorted = Float64Array.from(proj).sort();
    for (const q of SPLIT_QUANTILES) {
      const plane = sorted[Math.floor(q * n)];
      let nLo = 0;
      for (let i = 0; i < n; i++) if (proj[i] < plane) nLo++;
      if (nLo < 3 || n - nLo < 3) continue;
      const lo = new Float64Array(3 * nLo), hi = new Float64Array(3 * (n - nLo));
      for (let i = 0, a = 0, b = 0; i < n; i++) {
        const dst = proj[i] < plane ? lo : hi, o = proj[i] < plane ? a++ : b++;
        dst[3 * o] = pts[3 * i]; dst[3 * o + 1] = pts[3 * i + 1]; dst[3 * o + 2] = pts[3 * i + 2];
      }
      // Candidate halves try the bone axis and their two widest principal axes only (the
      // thinnest axis never carries the best capsule of a blob); the winner is refitted fully.
      const cost = costOf(fitOne(lo, nLo, boneDir, pad, rCap, g, 1), voxel) + costOf(fitOne(hi, n - nLo, boneDir, pad, rCap, g, 1), voxel);
      if (!best || cost < best.cost) best = { lo, hi, cost };
    }
  }
  if (!best || best.cost > SPLIT_GAIN * oneCost) {
    if (DEBUG.on) console.log(`    nosplit n=${n} budget=${budget} cloud=${(cloud * 1e3).toFixed(2)}L cost=${(oneCost * 1e3).toFixed(2)}L split=${best ? (best.cost * 1e3).toFixed(2) : "-"}L r=${one.r.toFixed(3)}`);
    return [one];
  }
  const nLo = best.lo.length / 3, bLo = Math.min(budget - 1, Math.max(1, Math.round(budget * nLo / n)));
  return [
    ...fitCloud(best.lo, nLo, boneDir, pad, rCap, bLo, g),
    ...fitCloud(best.hi, best.hi.length / 3, boneDir, pad, rCap, budget - bLo, g),
  ];
}

/**
 * Half-thickness of a part, m: the thinnest semi-axis of the solid ellipsoid with the cloud's
 * second moments (an ellipsoid of semi-axis c has variance c²/5 along it, so c = √(5·λ_min)).
 */
function halfThickness(pts: Float64Array, n: number): number {
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < n; i++) { mx += pts[3 * i]; my += pts[3 * i + 1]; mz += pts[3 * i + 2]; }
  mx /= n; my /= n; mz /= n;
  const c = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = pts[3 * i] - mx, y = pts[3 * i + 1] - my, z = pts[3 * i + 2] - mz;
    c[0] += x * x; c[1] += x * y; c[2] += x * z; c[3] += y * y; c[4] += y * z; c[5] += z * z;
  }
  for (let k = 0; k < 6; k++) c[k] /= n;
  return Math.sqrt(5 * Math.max(0, symEigen3(c).values[2]));
}

/**
 * Widest band (m) outside the union of the primitives where the real skin can still be: the
 * largest smooth-union bulge (k/4 at equal distances, the polynomial smin) plus the largest
 * outward sculpt stroke. Only voxels inside this band need the (slow) full-field test.
 */
export function bulgeBand(plan: AnatomyPlan): number {
  let k = 0;
  const walk = (n: SdfNode): void => {
    if (n.type !== "op") return;
    if (n.op === "smoothUnion") k = Math.max(k, n.k);
    n.children.forEach(walk);
  };
  walk(plan.root);
  let stroke = 0;
  for (const s of plan.strokes) if (s.kind === "inflate" || s.kind === "pushPull" || s.kind === "bend") stroke = Math.max(stroke, Math.abs(s.strength));
  return k / 4 + stroke;
}

/**
 * Contract entry point: capsule hitboxes of a body, fitted to its SDF volumes (module comment).
 * Endpoints `a`/`b` are in the bone's BIND frame; `wa`/`wb` start at the bind-pose world
 * position (group at the origin) until updateHitboxes moves them. Cost: ~0.2–0.35 s per new plan.
 */
export function hitboxesFromPlan(plan: AnatomyPlan, opts: HitboxFitOptions = {}): HitboxSet {
  const key = `${opts.step ?? ""}|${opts.fullField ?? ""}`;
  const hit = FIT_CACHE.get(plan)?.get(key);
  if (hit) return cloneHitboxSet(hit, opts.mass);
  const fitted = fitPlan(plan, opts);
  if (!FIT_CACHE.has(plan)) FIT_CACHE.set(plan, new Map());
  FIT_CACHE.get(plan)!.set(key, fitted);
  return cloneHitboxSet(fitted, opts.mass);
}

/** Fitted sets per plan object (SkinnedHumanoid caches plans by spec, so a rematch refits nothing). */
const FIT_CACHE = new WeakMap<AnatomyPlan, Map<string, HitboxSet>>();

/** A deep copy (each fighter mutates its own world endpoints); `mass` overrides the total. */
export function cloneHitboxSet(set: HitboxSet, mass?: number): HitboxSet {
  return {
    mass: mass ?? set.mass,
    boxes: set.boxes.map((b) => ({ ...b, a: [...b.a] as V3, b: [...b.b] as V3, wa: [...b.wa] as V3, wb: [...b.wb] as V3 })),
  };
}

function fitPlan(plan: AnatomyPlan, opts: HitboxFitOptions): HitboxSet {
  const h = opts.step ?? Math.min(VOXEL_MAX, Math.max(VOXEL_MIN, VOXEL_PER_CELL * plan.cell));
  const prims = positivePrimitives(plan.root).filter((p) => zoneOf(p.bone, p.region) !== null);
  // Groups: one per (zone, side, bone).
  const groupKey: string[] = [];
  const groupOfPrim = prims.map((p) => {
    const z = zoneOf(p.bone, p.region)!;
    const key = `${z.zone}|${z.side}|${p.bone}`;
    let g = groupKey.indexOf(key);
    if (g < 0) { g = groupKey.length; groupKey.push(key); }
    return g;
  });
  // Voxel grid over the plan bounds (y clipped at the ground).
  const min = [plan.bounds.min[0], Math.max(0, plan.bounds.min[1]), plan.bounds.min[2]];
  const nx = Math.ceil((plan.bounds.max[0] - min[0]) / h) + 1;
  const ny = Math.ceil((plan.bounds.max[1] - min[1]) / h) + 1;
  const nz = Math.ceil((plan.bounds.max[2] - min[2]) / h) + 1;
  const depth = new Float32Array(nx * ny * nz).fill(Infinity);
  const owner = new Int16Array(nx * ny * nz).fill(-1);
  const band = opts.fullField === false ? 0 : bulgeBand(plan);
  const sample: SdfSample = { d: 0, region: 0, bone: 0 };
  const tStart = performance.now();
  prims.forEach((prim, pi) => {
    const field = compileSdf({ type: "primitive", primitive: prim });
    const b = primitiveBounds(prim);
    const i0 = Math.max(0, Math.floor((b.min[0] - band - min[0]) / h)), i1 = Math.min(nx - 1, Math.ceil((b.max[0] + band - min[0]) / h));
    const j0 = Math.max(0, Math.floor((b.min[1] - band - min[1]) / h)), j1 = Math.min(ny - 1, Math.ceil((b.max[1] + band - min[1]) / h));
    const k0 = Math.max(0, Math.floor((b.min[2] - band - min[2]) / h)), k1 = Math.min(nz - 1, Math.ceil((b.max[2] + band - min[2]) / h));
    for (let k = k0; k <= k1; k++) {
      const z = min[2] + (k + 0.5) * h;
      for (let j = j0; j <= j1; j++) {
        const y = min[1] + (j + 0.5) * h;
        for (let i = i0; i <= i1; i++) {
          const d = field.sample(min[0] + (i + 0.5) * h, y, z, sample).d;
          if (d > band) continue;
          const cell = i + nx * (j + ny * k);
          if (d < depth[cell]) { depth[cell] = d; owner[cell] = d <= 0 ? groupOfPrim[pi] : -2; }
        }
      }
    }
  });
  // The band just outside the primitives: the real (blended, sculpted) skin decides, and its
  // dominant bone/region names the group.
  const tVoxel = performance.now();
  let bandCells = 0;
  if (band > 0) {
    const body = bodyField(plan);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const cell = i + nx * (j + ny * k);
      if (owner[cell] !== -2) continue;
      owner[cell] = -1;
      bandCells++;
      if (body.sample(min[0] + (i + 0.5) * h, min[1] + (j + 0.5) * h, min[2] + (k + 0.5) * h, sample).d > 0) continue;
      const z = zoneOf(BONE_IDS[sample.bone], REGIONS[sample.region]);
      if (!z) continue;
      const g = groupKey.indexOf(`${z.zone}|${z.side}|${BONE_IDS[sample.bone]}`);
      if (g >= 0) owner[cell] = g;
    }
  }
  const tBand = performance.now();
  // Clouds per group.
  const counts = new Int32Array(groupKey.length);
  let total = 0;
  for (let c = 0; c < owner.length; c++) if (owner[c] >= 0) { counts[owner[c]]++; total++; }
  const clouds = Array.from(counts, (n) => new Float64Array(3 * n));
  const fill = new Int32Array(groupKey.length);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const g = owner[i + nx * (j + ny * k)];
    if (g < 0) continue;
    const o = 3 * fill[g]++;
    clouds[g][o] = min[0] + (i + 0.5) * h; clouds[g][o + 1] = min[1] + (j + 0.5) * h; clouds[g][o + 2] = min[2] + (k + 0.5) * h;
  }
  const voxelVolume = h * h * h;
  const grid: Grid = { owner, nx, ny, nz, min, h };
  const boxes: Hitbox[] = [];
  groupKey.forEach((key, g) => {
    const n = counts[g];
    if (n < 4) return;
    const [zone, side, bone] = key.split("|") as [HitZone, "L" | "R" | "C", BoneId];
    const seg = plan.bones.find((b) => b.id === bone);
    let boneDir: Vec3 | null = null;
    if (seg) {
      const d: Vec3 = [seg.tail[0] - seg.head[0], seg.tail[1] - seg.head[1], seg.tail[2] - seg.head[2]];
      const l = Math.hypot(...d);
      if (l > 1e-6) boneDir = [d[0] / l, d[1] / l, d[2] / l];
    }
    const budget = Math.min(MAX_CAPSULES_PER_GROUP, Math.ceil(n * voxelVolume / VOLUME_PER_CAPSULE) + EXTRA_CAPSULES);
    // pad: a voxel centre sits ~h/2 inside the surface it samples; the capsule then insets SKIN_INSET.
    if (DEBUG.on) console.log(`  group ${key} n=${n} budget=${budget}`);
    // Radius cap: the part's half-thickness (+ the same pad), so flat parts tile with thin capsules.
    const pad = 0.5 * h - SKIN_INSET;
    const caps = fitCloud(clouds[g], n, boneDir, pad, THICKNESS_CAP * halfThickness(clouds[g], n) + pad, budget, grid);
    // Repair pass: voxels of this part that no capsule holds (the corners a capped radius gave
    // up) get their own uncapped capsule(s) when they amount to more than REPAIR_SHARE of it.
    const left: number[] = [];
    const cl = clouds[g];
    for (let i = 0; i < n; i++) {
      const x = cl[3 * i], y = cl[3 * i + 1], z = cl[3 * i + 2];
      if (!caps.some((c) => pointCapsule(x, y, z, c) <= c.r + SKIN_INSET)) left.push(x, y, z);
    }
    if (left.length / 3 > Math.max(REPAIR_MIN_VOXELS, REPAIR_SHARE * n)) {
      caps.push(...fitCloud(Float64Array.from(left), left.length / 3, boneDir, pad, Infinity, REPAIR_CAPSULES, grid));
    }
    const m = bindBoneMatrix(plan, bone);
    // Inverse of a rotation-about-z + translation: local = Rᵀ (p − head).
    const toLocal = (q: Vec3): V3 => {
      const x = q[0] - m[12], y = q[1] - m[13], z = q[2] - m[14];
      return [m[0] * x + m[1] * y + m[2] * z, m[4] * x + m[5] * y + m[6] * z, m[8] * x + m[9] * y + m[10] * z];
    };
    for (const c of caps) {
      boxes.push({ zone, side, bone, a: toLocal(c.a), b: toLocal(c.b), radius: c.r, wa: [...c.a] as V3, wb: [...c.b] as V3 });
    }
  });
  const T = lastFitTiming;
  T.voxelMs = tVoxel - tStart; T.bandMs = tBand - tVoxel; T.bandCells = bandCells; T.fitMs = performance.now() - tBand;
  T.capsules = boxes.length; T.voxels = total; T.step = h;
  return { boxes, mass: total * voxelVolume * TISSUE_DENSITY };
}

/**
 * Move every hitbox to the current pose: wa = M_bone · a, wb = M_bone · b, with M_bone the
 * bone's column-major world matrix (THREE.Bone.matrixWorld.elements). Allocates nothing.
 */
export function updateHitboxes(set: HitboxSet, boneWorld: (bone: string) => Float32Array | number[]): void {
  for (const box of set.boxes) {
    const m = boneWorld(box.bone);
    const a = box.a, b = box.b, wa = box.wa, wb = box.wb;
    wa[0] = m[0] * a[0] + m[4] * a[1] + m[8] * a[2] + m[12];
    wa[1] = m[1] * a[0] + m[5] * a[1] + m[9] * a[2] + m[13];
    wa[2] = m[2] * a[0] + m[6] * a[1] + m[10] * a[2] + m[14];
    wb[0] = m[0] * b[0] + m[4] * b[1] + m[8] * b[2] + m[12];
    wb[1] = m[1] * b[0] + m[5] * b[1] + m[9] * b[2] + m[13];
    wb[2] = m[2] * b[0] + m[6] * b[1] + m[10] * b[2] + m[14];
  }
}

/** Sum of the capsule volumes, m³ (overlaps counted twice: an upper bound of the union). */
export function capsuleVolume(set: HitboxSet): number {
  let v = 0;
  for (const b of set.boxes) {
    const L = Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1], b.b[2] - b.a[2]);
    v += Math.PI * b.radius ** 2 * L + (4 / 3) * Math.PI * b.radius ** 3;
  }
  return v;
}

/** Signed distance (m) from world point (x, y, z) to one hitbox's surface (negative inside). */
export function hitboxDistance(box: Hitbox, x: number, y: number, z: number): number {
  const ax = box.wa[0], ay = box.wa[1], az = box.wa[2];
  const dx = box.wb[0] - ax, dy = box.wb[1] - ay, dz = box.wb[2] - az;
  const L2 = dx * dx + dy * dy + dz * dz;
  let t = L2 > 1e-12 ? ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - ax - dx * t, y - ay - dy * t, z - az - dz * t) - box.radius;
}
