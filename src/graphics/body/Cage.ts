// Wave GEN (lane P, contract C-CAGE): the 6-axis bounding cage per sub-race and per body part.
// Pure module (no THREE).
//
// A cage part is an axis-aligned box in bind-pose model space given as a centre and SIX half-extents
// (neg = distances toward -X,-Y,-Z, pos = toward +X,+Y,+Z). It is built from:
//   1. the REFERENCE body: the axis-aligned bounds of the part's positive primitives in `plan.root` —
//      the physics tree, which the stat morph never touches (lane B keeps root/bones byte-identical),
//      so the reference envelope is the same whatever the stats;
//   2. the sub-race's ALLOWANCE per axis: a fraction of that reference extent, scaled by the sub-race
//      silhouette (raceSilhouette width -> X, depth -> Z, height -> Y), plus the room the rendered
//      physique sculpt needs per direction (CAGE_SCULPT_ROOM, measured: a fat belly / deltoid cap stands
//      proud of the physics body), plus a fixed margin of max(CAGE_MARGIN_CELLS cells, CAGE_MARGIN_MIN);
//   3. the STATS: strength widens the girth axes (X, Z) of the muscled parts, level the Y extent; a
//      stat below the reference narrows the room at a quarter of the rate (never below the base room).
//      At STAT_REFERENCE (or with no stats) the stat terms are exactly 0.
//
// The inflate stage clamps every positive primitive of the rendered skin tree (and of B's optional
// hit tree) into its part's box by shrinking its GIRTH (radii / sizes, never a segment's endpoints, so
// no joint or bone length moves): the largest girth scale s in [CLAMP_MIN_SCALE, 1] that fits, by
// bisection; a centred volume (muscle ellipsoid) still outside at the minimum scale slides inward
// (reported as a warning: it means the morph put a volume outside its part). A primitive that already fits is returned as the SAME object and an unchanged tree as
// the same node, so a body whose primitives all fit is byte-identical (tests G3, G6).
//
// Metrics: cageViolationMm = max over primitives of how far the primitive's box pokes out of its
// part's box (mm; 0 after the clamp), cageFill = mean over parts of (part's primitive box volume /
// cage box volume), cageFillMin = the emptiest part.

import type { AnatomyPlan, BodySpec, Bounds, Primitive, SdfNode, Vec3 } from "./contracts.ts";
import { primitiveBounds } from "./Sdf.ts";
import { raceSilhouette } from "../../game/BodyProfile.ts";
import { statOffset } from "../../game/StatScale.ts";

export const CAGE_PARTS = [
  "head", "neck", "torso", "pelvis",
  "upperArmL", "upperArmR", "foreArmL", "foreArmR", "handL", "handR",
  "thighL", "thighR", "shinL", "shinR", "footL", "footR",
] as const;
export type CagePartId = typeof CAGE_PARTS[number];

/** One part's cage: centre + six positive half-extents (neg toward -X,-Y,-Z; pos toward +X,+Y,+Z). */
export interface CagePart { centre: Vec3; neg: Vec3; pos: Vec3 }
export interface Cage { race: string; subrace: string | null; parts: Record<CagePartId, CagePart> }

/** Base allowance per axis (fraction of the reference half-extent) at silhouette 1 and reference stats. */
export const CAGE_BASE_ROOM: Vec3 = [0.08, 0.04, 0.08];
/**
 * Strength's extra girth room (fraction of the reference half-extent at strength 1000) per part
 * class: muscled parts grow, the head / hands / feet barely.
 */
export const CAGE_STRENGTH_ROOM: Record<"muscle" | "extremity", number> = { muscle: 0.3, extremity: 0.05 };
/** Level's extra Y room at level 1000 (maturity: a little height and gravitas). */
export const CAGE_LEVEL_ROOM = 0.05;
/** Below-reference stats narrow the room at this share of the above-reference rate. */
export const CAGE_LOW_RATE = 0.25;
/** Absolute margin: max(cells x plan.cell, metres). */
export const CAGE_MARGIN_CELLS = 0.5, CAGE_MARGIN_MIN = 0.008;
/**
 * Extra absolute room per part and per DIRECTION for the rendered skin's physique sculpt and seeded
 * asymmetry (Physique.ts deltoid caps rise +Y and fold medially, the belly / bulge push +Z, the face
 * +Z) that the physics tree does not carry: metres per metre of standing height, order
 * [-X, +X, -Y, +Y, -Z, +Z]. Measured by tools/wave-gen-pipeline-report.ts (`sculptRoom`: max over
 * 4 races x 16 ancestries x 2 sexes x {1.55 m 45 kg fat belly, 1.95 m 140 kg fat belly, 1.75 m 75 kg, 1.7 m 90 kg seeded}
 * of the skin's part box minus the physics part box; the fat belly hangs below the torso box: -Y 78 mm/m),
 * then x1.25 headroom and +1 mm/m on every side.
 */
export const CAGE_SCULPT_ROOM: Record<CagePartId, [number, number, number, number, number, number]> = (() => {
  const m = (v: number[]) => v.map((x) => (1.25 * x + 1) / 1000) as [number, number, number, number, number, number];
  const armL = m([0.8, 0.8, 0.6, 17.9, 1, 1]), armR = armL;
  const none = m([0, 0, 0, 0, 0, 0]), thigh = m([0.3, 0.3, 0, 0, 0, 0]), shin = m([0.6, 0.6, 0.3, 0.3, 0, 1.4]);
  return {
    head: m([0, 0, 0, 0, 0, 21.6]), neck: m([0, 0, 0, 0, 0, 18.7]), torso: m([0, 0, 77.7, 10.4, 0.2, 34.9]), pelvis: m([0, 0, 0, 0, 0, 22.8]),
    upperArmL: armL, upperArmR: armR, foreArmL: none, foreArmR: none, handL: none, handR: none,
    thighL: thigh, thighR: thigh, shinL: shin, shinR: shin, footL: none, footR: none,
  };
})();
/** The clamp never shrinks a primitive's girth below this scale. */
export const CLAMP_MIN_SCALE = 0.5;
/** Inward slack of the clamp's slide (m), so rounding never leaves a 1e-14 m violation. */
export const CLAMP_EPS = 1e-9;
/** Bisection steps of the girth clamp (2^-14 of the window). */
export const CLAMP_STEPS = 14;

const MUSCLE_PARTS = new Set<CagePartId>(["neck", "torso", "pelvis", "upperArmL", "upperArmR", "foreArmL", "foreArmR", "thighL", "thighR", "shinL", "shinR"]);

/** The cage part a primitive belongs to (null: the ground half-space / a sole cutter). */
export function partOf(p: Primitive): CagePartId | null {
  if (p.id === "groundHalfSpace") return null;
  const side = p.bone.endsWith("L") ? "L" : "R";
  switch (p.bone) {
    case "head": return "head";
    case "neck": return "neck";
    case "spine": return "torso";
    case "abdomen": return p.region === "pelvis" ? "pelvis" : "torso";
    case "root": return p.region === "sole" ? null : "pelvis";
    case "shoulderL": case "shoulderR": return `upperArm${side}`;
    case "elbowL": case "elbowR": return p.region === "hand" || p.region === "nail" ? `hand${side}` : `foreArm${side}`;
    case "hipL": case "hipR": return `thigh${side}`;
    case "kneeL": case "kneeR": return `shin${side}`;
    default: return `foot${side}`;
  }
}

/** Primitives that ADD matter (the left operand of subtract/intersect keeps, cutters do not). */
export function positivePrims(node: SdfNode, out: Primitive[] = []): Primitive[] {
  if (node.type === "primitive") { out.push(node.primitive); return out; }
  const keepAll = node.op === "union" || node.op === "smoothUnion";
  node.children.forEach((c, i) => { if (keepAll || i === 0) positivePrims(c, out); });
  return out;
}

/** Row-major rotation matrix of an XYZ Euler (three.js M = Rx·Ry·Rz, the convention Sdf.ts inverts). */
function eulerMatrix(r: Vec3): number[] {
  const [x, y, z] = r;
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  return [c * e, -c * f, d, a * f + b * e * d, a * e - b * f * d, -b * c, b * f - a * e * d, b * e + a * f * d, a * c];
}

/**
 * A primitive's axis-aligned box, TIGHT for rotated ellipsoids (half-extent_k = |row_k(M)·diag(size)|)
 * and rotated round boxes (sum_j |M_kj| size_j); Sdf.primitiveBounds (a conservative sphere for those,
 * which also sizes the polygonising box and so must not change) for everything else.
 */
export function primBox(p: Primitive): Bounds {
  const rotated = !!(p.rot && (p.rot[0] || p.rot[1] || p.rot[2]));
  if (rotated && (p.kind === "ellipsoid" || p.kind === "roundBox")) {
    const M = eulerMatrix(p.rot!), s = p.size ?? [p.r, p.r, p.r];
    const half: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      half[k] = p.kind === "ellipsoid"
        ? Math.hypot(M[3 * k] * s[0], M[3 * k + 1] * s[1], M[3 * k + 2] * s[2])
        : Math.abs(M[3 * k]) * s[0] + Math.abs(M[3 * k + 1]) * s[1] + Math.abs(M[3 * k + 2]) * s[2];
    }
    return { min: [p.a[0] - half[0], p.a[1] - half[1], p.a[2] - half[2]], max: [p.a[0] + half[0], p.a[1] + half[1], p.a[2] + half[2]] };
  }
  return primitiveBounds(p);
}

function emptyBox(): Bounds { return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; }
function grow(b: Bounds, o: Bounds): void {
  for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], o.min[k]); b.max[k] = Math.max(b.max[k], o.max[k]); }
}
/** Axis-aligned box of every positive primitive per part. */
export function partBoxes(node: SdfNode): Partial<Record<CagePartId, Bounds>> {
  const out: Partial<Record<CagePartId, Bounds>> = {};
  for (const p of positivePrims(node)) {
    const id = partOf(p);
    if (!id) continue;
    grow(out[id] ??= emptyBox(), primBox(p));
  }
  return out;
}

/** The cage of a plan for a spec (module comment). `plan.root` is the reference envelope. */
export function cageFor(plan: AnatomyPlan, spec: BodySpec): Cage {
  const sil = raceSilhouette(spec.race, spec.subrace);
  const ref = partBoxes(plan.root);
  const sStr = statOffset(spec.stats?.strength), sLvl = statOffset(spec.stats?.level);
  const rate = (o: number) => (o >= 0 ? o : CAGE_LOW_RATE * o);
  const margin = Math.max(CAGE_MARGIN_CELLS * plan.cell, CAGE_MARGIN_MIN);
  const silAxis: Vec3 = [sil.width, sil.height, sil.depth];
  const parts = {} as Record<CagePartId, CagePart>;
  for (const id of CAGE_PARTS) {
    const b = ref[id] ?? { min: [0, 0, 0], max: [0, 0, 0] } as Bounds;
    const centre: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const strRoom = CAGE_STRENGTH_ROOM[MUSCLE_PARTS.has(id) ? "muscle" : "extremity"];
    const room: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const stat = k === 1 ? CAGE_LEVEL_ROOM * rate(sLvl) : strRoom * rate(sStr);
      // Below-reference stats narrow the room (rate CAGE_LOW_RATE), never below 0.
      room[k] = Math.max(0, CAGE_BASE_ROOM[k] * silAxis[k] + stat);
    }
    const neg: Vec3 = [0, 0, 0], pos: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const half = (b.max[k] - b.min[k]) / 2;
      neg[k] = half * (1 + room[k]) + margin + CAGE_SCULPT_ROOM[id][2 * k] * spec.height;
      pos[k] = half * (1 + room[k]) + margin + CAGE_SCULPT_ROOM[id][2 * k + 1] * spec.height;
    }
    parts[id] = { centre, neg, pos };
  }
  return { race: spec.race, subrace: spec.subrace, parts };
}

/** The cage part as a min/max box. */
export function cageBox(c: CagePart): Bounds {
  return {
    min: [c.centre[0] - c.neg[0], c.centre[1] - c.neg[1], c.centre[2] - c.neg[2]],
    max: [c.centre[0] + c.pos[0], c.centre[1] + c.pos[1], c.centre[2] + c.pos[2]],
  };
}

/** How far (m) box `b` pokes out of `cage` (0 when inside). */
export function boxViolation(b: Bounds, cage: Bounds): number {
  let v = 0;
  for (let k = 0; k < 3; k++) v = Math.max(v, cage.min[k] - b.min[k], b.max[k] - cage.max[k]);
  return Math.max(0, v);
}

/** A primitive with its girth scaled by s (radii / sizes; segment endpoints and centres stay). */
export function scaleGirth(p: Primitive, s: number): Primitive {
  return {
    ...p, r: p.r * s,
    ...(p.r2 !== undefined ? { r2: p.r2 * s } : {}),
    ...(p.size ? { size: [p.size[0] * s, p.size[1] * s, p.size[2] * s] as Vec3 } : {}),
  };
}

/** Kinds placed by a centre (a translation moves no joint): the clamp may slide them inward. */
const CENTRED = new Set(["sphere", "ellipsoid", "roundBox", "torus"]);

/** The smallest translation that brings box `b` inside `cage` per axis (centred when it is wider). */
function inwardShift(b: Bounds, cage: Bounds): Vec3 {
  const t: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    if (b.max[k] - b.min[k] > cage.max[k] - cage.min[k]) t[k] = (cage.min[k] + cage.max[k]) / 2 - (b.min[k] + b.max[k]) / 2;
    // CLAMP_EPS inward so the float sum lands inside, not 1e-14 m out.
    else if (b.min[k] < cage.min[k]) t[k] = cage.min[k] - b.min[k] + CLAMP_EPS;
    else if (b.max[k] > cage.max[k]) t[k] = cage.max[k] - b.max[k] - CLAMP_EPS;
  }
  return t;
}

/**
 * Clamp one primitive into its part's box (the same object when it already fits): (1) shrink the girth
 * by bisection down to CLAMP_MIN_SCALE; (2) if it still pokes out, a CENTRED primitive (a muscle
 * volume) slides inward by the smallest translation; a segment primitive (capsule / cone: a bone line)
 * never moves, and its residual violation is reported. `shiftMm` = the slide, for the stage warnings.
 */
export function clampPrimitive(p: Primitive, cage: Cage): { prim: Primitive; violation: number; clamped: boolean; shiftMm: number } {
  const id = partOf(p);
  if (!id) return { prim: p, violation: 0, clamped: false, shiftMm: 0 };
  const box = cageBox(cage.parts[id]);
  const v0 = boxViolation(primBox(p), box);
  if (v0 <= 0) return { prim: p, violation: 0, clamped: false, shiftMm: 0 };
  const fits = (s: number) => boxViolation(primBox(scaleGirth(p, s)), box) <= 0;
  let q: Primitive;
  if (fits(CLAMP_MIN_SCALE)) {
    let lo = CLAMP_MIN_SCALE, hi = 1;
    for (let i = 0; i < CLAMP_STEPS; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid; else hi = mid;
    }
    return { prim: scaleGirth(p, lo), violation: 0, clamped: true, shiftMm: 0 };
  }
  q = scaleGirth(p, CLAMP_MIN_SCALE);
  if (!CENTRED.has(q.kind)) return { prim: q, violation: boxViolation(primBox(q), box), clamped: true, shiftMm: 0 };
  const t = inwardShift(primBox(q), box);
  q = { ...q, a: [q.a[0] + t[0], q.a[1] + t[1], q.a[2] + t[2]], ...(q.b ? { b: [q.b[0] + t[0], q.b[1] + t[1], q.b[2] + t[2]] as Vec3 } : {}) };
  return { prim: q, violation: boxViolation(primBox(q), box), clamped: true, shiftMm: Math.hypot(t[0], t[1], t[2]) * 1000 };
}

/** Clamp every POSITIVE primitive of a tree; unchanged subtrees are returned as the same nodes. */
export function clampTree(node: SdfNode, cage: Cage): { node: SdfNode; clamped: number; violation: number; before: number; moved: { id: string; shiftMm: number }[] } {
  const acc = { clamped: 0, violation: 0, before: 0, moved: [] as { id: string; shiftMm: number }[] };
  const walk = (n: SdfNode): SdfNode => {
    if (n.type === "primitive") {
      const id = partOf(n.primitive);
      if (id) acc.before = Math.max(acc.before, boxViolation(primBox(n.primitive), cageBox(cage.parts[id])));
      const r = clampPrimitive(n.primitive, cage);
      acc.violation = Math.max(acc.violation, r.violation);
      if (r.shiftMm > 0) acc.moved.push({ id: n.primitive.id, shiftMm: r.shiftMm });
      if (!r.clamped) return n;
      acc.clamped++;
      return { type: "primitive", primitive: r.prim };
    }
    const keepAll = n.op === "union" || n.op === "smoothUnion";
    let changed = false;
    const kids = n.children.map((c, i) => {
      if (!keepAll && i > 0) return c;
      const m = walk(c);
      if (m !== c) changed = true;
      return m;
    });
    return changed ? { ...n, children: kids } : n;
  };
  const out = walk(node);
  return { node: out, ...acc };
}

/** Cage metrics of a tree: worst violation (mm) and fill (mean / min over the parts present). */
export function cageMetrics(node: SdfNode, cage: Cage): { cageViolationMm: number; cageFill: number; cageFillMin: number } {
  let viol = 0;
  for (const p of positivePrims(node)) {
    const id = partOf(p);
    if (id) viol = Math.max(viol, boxViolation(primBox(p), cageBox(cage.parts[id])));
  }
  const boxes = partBoxes(node);
  const vol = (b: Bounds) => Math.max(0, b.max[0] - b.min[0]) * Math.max(0, b.max[1] - b.min[1]) * Math.max(0, b.max[2] - b.min[2]);
  const fills: number[] = [];
  for (const id of CAGE_PARTS) {
    const b = boxes[id];
    if (!b) continue;
    const c = cageBox(cage.parts[id]);
    // Intersect with the cage (a violating part cannot read > 1).
    const inter: Bounds = {
      min: [Math.max(b.min[0], c.min[0]), Math.max(b.min[1], c.min[1]), Math.max(b.min[2], c.min[2])],
      max: [Math.min(b.max[0], c.max[0]), Math.min(b.max[1], c.max[1]), Math.min(b.max[2], c.max[2])],
    };
    fills.push(vol(inter) / Math.max(1e-12, vol(c)));
  }
  return {
    cageViolationMm: viol * 1000,
    cageFill: fills.length ? fills.reduce((s, v) => s + v, 0) / fills.length : 0,
    cageFillMin: fills.length ? Math.min(...fills) : 0,
  };
}
