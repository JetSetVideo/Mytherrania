// Signed-distance fields for the body pipeline (lane A, R03/R15). Pure module: no THREE.
//
// Vocabulary
//   signed distance d(p): metres from p to the surface; NEGATIVE inside, positive outside.
//   exact SDF: |d| is the true Euclidean distance. A "bound" never over-estimates the
//   distance by much and keeps the zero set exact (the ellipsoid is the only bound here).
//   anchor: the primitive's `a` (centre, or segment start). `rot` (XYZ Euler, radians,
//   three.js convention M = Rx·Ry·Rz) rotates the primitive about its anchor.
//   blend width k: metres over which a smooth operator rounds the junction (polynomial
//   smooth-min, Quilez 2013): h = max(k - |a - b|, 0) / k,  smin = min(a, b) - h²·k/4.
//
// Region/bone of a sample (SdfSample.region / .bone):
//   union, smoothUnion  -> the NEARER child (smaller d) owns the point.
//   intersect, subtract (and smooth variants) -> the bone stays the LEFT operand's (the
//   volume being trimmed keeps its skeletal attachment; a cutter has no bone of its own)
//   and the region is the DOMINANT child's (the one whose surface forms the boundary), so
//   an eye-socket wall reads "face" and the cut sole reads "sole".

import { REGIONS, type BoneId, type Bounds, type Primitive, type Region, type SdfNode, type SdfSample, type Vec3, type VolumeOp } from "./contracts.ts";

/**
 * The canonical bone order. `SdfSample.bone`, `MeshData.bone`, `AnatomyPlan.bones` and the
 * skin indices all index into this list: root first, then every Skeleton JointName.
 */
export const BONE_IDS: readonly BoneId[] = [
  "root", "spine", "abdomen", "neck", "head",
  "shoulderL", "shoulderR", "elbowL", "elbowR",
  "hipL", "hipR", "kneeL", "kneeR", "ankleL", "ankleR", "toeL", "toeR",
];

const BONE_INDEX = new Map<BoneId, number>(BONE_IDS.map((b, i) => [b, i]));
const REGION_INDEX = new Map<Region, number>(REGIONS.map((r, i) => [r, i]));

/** Index of a bone in BONE_IDS (throws on an unknown id, so a typo cannot skin to root). */
export function boneIndex(id: BoneId): number {
  const i = BONE_INDEX.get(id);
  if (i === undefined) throw new Error(`unknown bone ${id}`);
  return i;
}

/** Index of a region in REGIONS. */
export function regionIndex(r: Region): number {
  const i = REGION_INDEX.get(r);
  if (i === undefined) throw new Error(`unknown region ${r}`);
  return i;
}

// ---------------------------------------------------------------------------------------
// Primitive distances (local frame: the primitive's anchor at the origin, unrotated).
// ---------------------------------------------------------------------------------------

/** Sphere of radius r (m) centred at the origin. Exact. */
export function sdSphere(x: number, y: number, z: number, r: number): number {
  return Math.sqrt(x * x + y * y + z * z) - r;
}

/**
 * Ellipsoid with semi-axes (rx, ry, rz) m, centred at the origin. Quilez's estimate
 * e = k0·(k0 − 1)/k1 with k0 = |p/r|, k1 = |p/r²| has an exact zero set but UNDER-estimates
 * far away (about 0.8·distance off-axis for a 0.05/0.08/0.03 m ellipsoid). Both e and the
 * bounding-sphere distance |p| − max(r) are lower bounds of the true distance, so their
 * maximum is a tighter lower bound with the same zero set — and it keeps the union culling
 * in `compileSdf` exact (a child's value is never below its bounding-sphere distance).
 */
export function sdEllipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number): number {
  const ax = x / rx, ay = y / ry, az = z / rz;
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const bx = x / (rx * rx), by = y / (ry * ry), bz = z / (rz * rz);
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
  if (k1 < 1e-12) return -Math.min(rx, ry, rz); // the centre: deepest point
  return Math.max((k0 * (k0 - 1)) / k1, Math.sqrt(x * x + y * y + z * z) - Math.max(rx, ry, rz));
}

/** Capsule: segment a→b swept by radius r (m). Exact. h = clamp((p−a)·(b−a)/|b−a|², 0, 1). */
export function sdCapsule(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  r: number,
): number {
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const bb = bax * bax + bay * bay + baz * baz;
  const h = bb > 1e-18 ? Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / bb)) : 0;
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

/**
 * Round cone: spheres of radius r1 at a and r2 at b joined by their common tangent cone.
 * Exact (Quilez). When one sphere swallows the other (|r1 − r2| ≥ |b − a|) the shape IS the
 * larger sphere, and that sphere's distance is returned.
 */
export function sdRoundCone(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  r1: number, r2: number,
): number {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  if (a2 <= 1e-12) {
    return r1 >= r2 ? sdSphere(px - ax, py - ay, pz - az, r1) : sdSphere(px - bx, py - by, pz - bz, r2);
  }
  const il2 = 1 / l2;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

/**
 * Rounded box with OUTER half-extents (hx, hy, hz) m and corner radius r (m, ≤ the
 * smallest half-extent). Exact: q = |p| − h + r; d = |max(q, 0)| + min(max(qx, qy, qz), 0) − r.
 */
export function sdRoundBox(x: number, y: number, z: number, hx: number, hy: number, hz: number, r: number): number {
  const qx = Math.abs(x) - hx + r, qy = Math.abs(y) - hy + r, qz = Math.abs(z) - hz + r;
  const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
  return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
}

/** Torus in the local xz plane (axis +y): major radius R, minor radius r (m). Exact. */
export function sdTorus(x: number, y: number, z: number, major: number, minor: number): number {
  const qx = Math.sqrt(x * x + z * z) - major;
  return Math.sqrt(qx * qx + y * y) - minor;
}

// ---------------------------------------------------------------------------------------
// Volume operators.
// ---------------------------------------------------------------------------------------

/** Polynomial smooth minimum over blend width k (m): min(a,b) − h²k/4, h = max(k−|a−b|,0)/k. */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Polynomial smooth maximum: −smin(−a, −b, k). */
export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

/**
 * Combine two distances with a volume operator. union = min(a, b); subtract = max(a, −b)
 * (b carved out of a); intersect = max(a, b); the smooth variants replace min/max by
 * smin/smax over blend width k (m).
 */
export function combine(op: VolumeOp, a: number, b: number, k: number): number {
  switch (op) {
    case "union": return Math.min(a, b);
    case "subtract": return Math.max(a, -b);
    case "intersect": return Math.max(a, b);
    case "smoothUnion": return smin(a, b, k);
    case "smoothSubtract": return smax(a, -b, k);
    case "smoothIntersect": return smax(a, b, k);
  }
}

// ---------------------------------------------------------------------------------------
// Compiled evaluator: closures with precomputed rotations and bounding spheres, no
// allocation per sample. `evaluate` is the allocating convenience form of the contract.
// ---------------------------------------------------------------------------------------

/** A field the polygoniser and the brushes can sample without allocating. */
export interface BodyField {
  /** Write the signed distance (m) and the dominant region/bone at (x, y, z) into `out`. */
  sample(x: number, y: number, z: number, out: SdfSample): SdfSample;
}

type Eval = (x: number, y: number, z: number, out: SdfSample) => void;

/** Rows of Mᵀ for an XYZ Euler (three.js M = Rx·Ry·Rz), so local = Mᵀ·(p − anchor). */
function inverseRotation(rot: Vec3 | undefined): number[] | null {
  if (!rot || (rot[0] === 0 && rot[1] === 0 && rot[2] === 0)) return null;
  const a = Math.cos(rot[0]), b = Math.sin(rot[0]);
  const c = Math.cos(rot[1]), d = Math.sin(rot[1]);
  const e = Math.cos(rot[2]), f = Math.sin(rot[2]);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  // M columns: c0 = (ce, af+be·d, bf−ae·d), c1 = (−cf, ae−bf·d, be+af·d), c2 = (d, −bc, ac).
  // Mᵀ rows are M's columns.
  return [
    c * e, af + be * d, bf - ae * d,
    -c * f, ae - bf * d, be + af * d,
    d, -b * c, a * c,
  ];
}

function compilePrimitive(p: Primitive): Eval {
  const region = regionIndex(p.region);
  const bone = boneIndex(p.bone);
  const [ax, ay, az] = p.a;
  const m = inverseRotation(p.rot);
  const b = p.b ?? p.a;
  const size = p.size ?? [p.r, p.r, p.r];
  let local: (x: number, y: number, z: number) => number;
  switch (p.kind) {
    case "sphere": local = (x, y, z) => sdSphere(x, y, z, p.r); break;
    case "ellipsoid": local = (x, y, z) => sdEllipsoid(x, y, z, size[0], size[1], size[2]); break;
    case "roundBox": local = (x, y, z) => sdRoundBox(x, y, z, size[0], size[1], size[2], Math.min(p.r, size[0], size[1], size[2])); break;
    case "torus": local = (x, y, z) => sdTorus(x, y, z, p.r, p.r2 ?? p.r * 0.25); break;
    case "capsule": {
      const bx = b[0] - ax, by = b[1] - ay, bz = b[2] - az;
      local = (x, y, z) => sdCapsule(x, y, z, 0, 0, 0, bx, by, bz, p.r);
      break;
    }
    case "roundCone": {
      const bx = b[0] - ax, by = b[1] - ay, bz = b[2] - az, r2 = p.r2 ?? p.r;
      local = (x, y, z) => sdRoundCone(x, y, z, 0, 0, 0, bx, by, bz, p.r, r2);
      break;
    }
  }
  if (m) {
    return (x, y, z, out) => {
      const vx = x - ax, vy = y - ay, vz = z - az;
      out.d = local(m[0] * vx + m[1] * vy + m[2] * vz, m[3] * vx + m[4] * vy + m[5] * vz, m[6] * vx + m[7] * vy + m[8] * vz);
      out.region = region;
      out.bone = bone;
    };
  }
  return (x, y, z, out) => {
    out.d = local(x - ax, y - ay, z - az);
    out.region = region;
    out.bone = bone;
  };
}

/** Axis-aligned bounds of one primitive (conservative: rotation uses the bounding sphere). */
export function primitiveBounds(p: Primitive): Bounds {
  const b = p.b ?? p.a;
  let reach: number;
  switch (p.kind) {
    case "sphere": reach = p.r; break;
    case "ellipsoid": reach = Math.max(...(p.size ?? [p.r, p.r, p.r])); break;
    case "roundBox": { const s = p.size ?? [p.r, p.r, p.r]; reach = Math.hypot(s[0], s[1], s[2]); break; }
    case "torus": reach = p.r + (p.r2 ?? p.r * 0.25); break;
    case "capsule": reach = p.r; break;
    case "roundCone": reach = Math.max(p.r, p.r2 ?? p.r); break;
  }
  if (p.kind === "capsule" || p.kind === "roundCone") {
    // A rotation turns the segment about `a`: bound it by the sphere of radius |b − a| + reach.
    if (p.rot && (p.rot[0] || p.rot[1] || p.rot[2])) {
      const len = Math.hypot(b[0] - p.a[0], b[1] - p.a[1], b[2] - p.a[2]) + reach;
      return { min: [p.a[0] - len, p.a[1] - len, p.a[2] - len], max: [p.a[0] + len, p.a[1] + len, p.a[2] + len] };
    }
    return {
      min: [Math.min(p.a[0], b[0]) - reach, Math.min(p.a[1], b[1]) - reach, Math.min(p.a[2], b[2]) - reach],
      max: [Math.max(p.a[0], b[0]) + reach, Math.max(p.a[1], b[1]) + reach, Math.max(p.a[2], b[2]) + reach],
    };
  }
  if (p.kind === "ellipsoid" && !(p.rot && (p.rot[0] || p.rot[1] || p.rot[2]))) {
    const s = p.size ?? [p.r, p.r, p.r];
    return { min: [p.a[0] - s[0], p.a[1] - s[1], p.a[2] - s[2]], max: [p.a[0] + s[0], p.a[1] + s[1], p.a[2] + s[2]] };
  }
  if (p.kind === "roundBox" && !(p.rot && (p.rot[0] || p.rot[1] || p.rot[2]))) {
    const s = p.size ?? [p.r, p.r, p.r];
    return { min: [p.a[0] - s[0], p.a[1] - s[1], p.a[2] - s[2]], max: [p.a[0] + s[0], p.a[1] + s[1], p.a[2] + s[2]] };
  }
  return { min: [p.a[0] - reach, p.a[1] - reach, p.a[2] - reach], max: [p.a[0] + reach, p.a[1] + reach, p.a[2] + reach] };
}

/**
 * Bounds of the solid a node describes. union/smoothUnion: the union of the children,
 * grown by k/4 (the deepest a smooth-min can bulge). subtract: the first child's.
 * intersect: the overlap of the children.
 */
export function nodeBounds(node: SdfNode): Bounds {
  if (node.type === "primitive") return primitiveBounds(node.primitive);
  const kids = node.children.map(nodeBounds);
  if (kids.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  if (node.op === "union" || node.op === "smoothUnion") {
    const g = node.op === "smoothUnion" ? node.k * 0.25 : 0;
    const out: Bounds = { min: [...kids[0].min], max: [...kids[0].max] };
    for (const b of kids) for (let i = 0; i < 3; i++) { out.min[i] = Math.min(out.min[i], b.min[i]); out.max[i] = Math.max(out.max[i], b.max[i]); }
    for (let i = 0; i < 3; i++) { out.min[i] -= g; out.max[i] += g; }
    return out;
  }
  if (node.op === "subtract" || node.op === "smoothSubtract") return { min: [...kids[0].min], max: [...kids[0].max] };
  const out: Bounds = { min: [...kids[0].min], max: [...kids[0].max] };
  for (const b of kids) for (let i = 0; i < 3; i++) { out.min[i] = Math.max(out.min[i], b.min[i]); out.max[i] = Math.min(out.max[i], b.max[i]); }
  return out;
}

/** Margin on a culling sphere: covers the ellipsoid bound's slack (fraction of radius). */
const CULL_MARGIN = 0.1;

function compileNode(node: SdfNode): Eval {
  if (node.type === "primitive") return compilePrimitive(node.primitive);
  const kids = node.children.map(compileNode);
  if (kids.length === 0) return (_x, _y, _z, out) => { out.d = Infinity; out.region = 0; out.bone = 0; };
  const op = node.op, k = node.k;
  const scratch: SdfSample = { d: 0, region: 0, bone: 0 };
  const isUnion = op === "union" || op === "smoothUnion";
  // Culling spheres (union only): a child whose bounding sphere is farther than the
  // current best + k cannot change min or smin (h = 0 there), so it is skipped exactly.
  const spheres = node.children.map((c) => {
    const b = nodeBounds(c);
    const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const r = Math.hypot(b.max[0] - cx, b.max[1] - cy, b.max[2] - cz) * (1 + CULL_MARGIN);
    return [cx, cy, cz, r];
  });
  const slack = op === "smoothUnion" ? k : 0;
  return (x, y, z, out) => {
    kids[0](x, y, z, out);
    const leftBone = out.bone;
    for (let i = 1; i < kids.length; i++) {
      if (isUnion) {
        const s = spheres[i];
        const dx = x - s[0], dy = y - s[1], dz = z - s[2];
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) - s[3] >= out.d + slack) continue;
      }
      kids[i](x, y, z, scratch);
      const a = out.d, b = scratch.d;
      out.d = combine(op, a, b, k);
      if (isUnion) {
        if (b < a) { out.region = scratch.region; out.bone = scratch.bone; }
      } else {
        // The cutter dominates where its (signed) term is the larger one.
        const cut = op === "subtract" || op === "smoothSubtract" ? -b : b;
        if (cut > a) out.region = scratch.region;
        out.bone = leftBone;
      }
    }
  };
}

const COMPILED = new WeakMap<SdfNode, Eval>();

/** Compile an SDF scene graph into an allocation-free field (cached per node object). */
export function compileSdf(node: SdfNode): BodyField {
  let ev = COMPILED.get(node);
  if (!ev) { ev = compileNode(node); COMPILED.set(node, ev); }
  const fn = ev;
  return { sample: (x, y, z, out) => { fn(x, y, z, out); return out; } };
}

/** Contract entry point: signed distance and dominant region/bone of `node` at p. */
export function evaluate(node: SdfNode, p: Vec3): SdfSample {
  return compileSdf(node).sample(p[0], p[1], p[2], { d: 0, region: 0, bone: 0 });
}

/** Signed distance of a single primitive at p (world frame, rotation applied). */
export function primitiveDistance(p: Primitive, at: Vec3): number {
  return evaluate({ type: "primitive", primitive: p }, at).d;
}

/** Adapt the contract's `(p: Vec3) => SdfSample` form into a BodyField. */
export function fieldFromFunction(f: (p: Vec3) => SdfSample): BodyField {
  const p: Vec3 = [0, 0, 0];
  return {
    sample(x, y, z, out) {
      p[0] = x; p[1] = y; p[2] = z;
      const s = f(p);
      out.d = s.d; out.region = s.region; out.bone = s.bone;
      return out;
    },
  };
}

/** Adapt a BodyField back into the contract's `(p: Vec3) => SdfSample` form. */
export function fieldToFunction(f: BodyField): (p: Vec3) => SdfSample {
  return (p) => f.sample(p[0], p[1], p[2], { d: 0, region: 0, bone: 0 });
}
