// Physique (wave X, lane B): the RENDERED skin's sculpt — deltoid caps over the clavicle line with a
// valley between, the rectus abdominis sheets and the linea alba, a slimmer trunk and limbs, the rare
// fat belly and the male crotch bulge. Pure module: no THREE, no DOM.
//
// WHY render-only: every past attempt to add these as PHYSICAL volume broke a measured physics pin —
// the deltoid moved the ork half-guard trunk travel past its bound, the crotch pack kept the ragdoll
// from settling in RAGDOLL GROUND's window, a 1 % shoulder-joint move slid the planted foot off its
// band (tests/body_mass_test.ts records each). The physics reads `plan.root` (Hitboxes' capsule fit,
// the ragdoll masses, the abduction solves); the RENDERED skin reads `plan.skinRoot`
// (BodyMesh.skinField). This module rewrites ONLY the skin tree, after the final symmetry pass, so
// no joint moves, no bone length changes and no physical mass is added or removed. The cost is stated:
// the combat capsules are fitted to the pre-wave (fuller) body, so the visible skin sits a few
// millimetres INSIDE them at the waist (measured in docs/wave-x/BODY.md).
//
// Everything is a named fraction of a BodyProportions number (head heights `h`, radii, half-widths),
// so a dwarf and an ork get proportionate forms.

import { REGIONS, type BoneSegment, type MeshData, type Primitive, type SdfNode, type SdfSample, type Vec3 } from "./contracts.ts";
import type { BodyProportions } from "./Proportions.ts";
import { compileSdf } from "./Sdf.ts";
import { fatBellyFor } from "../../game/BodyProfile.ts";
import type { Morph } from "./StatMorph.ts";

/**
 * Girth multipliers on the rendered skin ("slimmer overall"). Applied to every race alike, so the
 * race ORDER of every width survives (the ork stays the broadest, the elf the leanest, the dwarf the
 * stockiest by width-to-height). The shoulder girdle, the pectorals and the hands/forearms/feet are
 * NOT slimmed (the V of the trunk grows; the forearm/hand/foot primitives are pinned as exact mirrors
 * of the physics by tests/wave_v_pose_symmetry_test.ts).
 */
export const SLIM = {
  ribX: 0.94, ribZ: 0.95,
  waistX: 0.84, bellyZ: 0.9,
  obliqueX: 0.82, obliqueZ: 0.9,
  pelvisX: 0.96, pelvisZ: 0.94,
  gluteZ: 0.93,
  thigh: 0.92, shin: 0.93, armBelly: 0.9,
} as const;
/**
 * The default (non-fat) belly never stands deeper than this fraction of the chest's half-depth.
 * Before the wave a heavy build's abdomen was DEEPER than its chest (ork 209 mm vs 181 mm), i.e.
 * every ork wore a fat belly; the fat belly is now the rare roll below.
 */
export const BELLY_FLAT_PER_CHEST = 0.86;
/** A rolled fat belly (amount 1) stands this many head heights in front of the flat belly. */
export const FAT_BELLY_FWD_PER_HEAD = 0.3;

/** Deltoid cap (head heights / radius.deltoid fractions): lateral offset, rise over the joint, radii. */
export const DELTOID = {
  outPerHead: 0.07,
  risePerHead: 0.2,
  halfHeightPerHead: 0.2,
  widthPerRadius: 0.8,
  depthPerRadius: 0.95,
  blendPerRadius: 0.22,
  /** The valley cutter: x at (shoulder joint − valleyInPerHead·h), radius, depth below the clavicle line. */
  valleyInPerHead: 0.12,
  valleyRPerHead: 0.085,
  valleyDepthPerHead: 0.085,
} as const;

/** Rectus abdominis sheets + linea alba (head heights). Geometry carries the broad form; the shader the 6-pack. */
export const ABS = {
  /** Top of the rectus band above the rib bottom, and its bottom below the navel. */
  topAboveRibPerHead: 0.25,
  bottomBelowNavelPerHead: 0.35,
  sheetXPerHead: 0.105,
  sheetHalfWPerHead: 0.1,
  /** How far each sheet stands proud of the slimmed abdomen's front (m per head height). */
  proudPerHead: 0.045,
  lineaRCells: 0.55,
  lineaDepthCells: 0.35,
} as const;

/** The male crotch bulge (head heights): height of its centre over the crotch, half-sizes, how proud it stands. */
export const BULGE = {
  risePerHead: 0.14,
  halfW: 0.11, halfH: 0.17, halfD: 0.13,
  /** Apex in front of the most forward neighbour (pubic surface, lower belly 0.3 h above, inner-thigh fronts). */
  proudPerHead: 0.11,
  blendPerHead: 0.05,
} as const;

/** What the sculpt did, for measurement and the docs. */
export interface PhysiqueRecord {
  slim: typeof SLIM;
  /** The fat belly worn (0 = none) and where it came from. */
  belly: number;
  bellySource: "seed" | "spec";
  /** True when the male crotch bulge was added. */
  bulge: boolean;
  /** The abs band (model y) and its front plane z at the band centre — the shader's uniforms. */
  abs: { yTop: number; yBottom: number; halfWidth: number; frontZ: number };
  /** Deltoid cap apex (model, left side) and the valley cutter centre. */
  deltoidApex: Vec3;
  valley: Vec3;
}

const scaleV = (v: Vec3, sx: number, sy: number, sz: number): Vec3 => [v[0] * sx, v[1] * sy, v[2] * sz];

/** Scale a limb primitive's girth by s about its bone line, easing back to 1 over `taper` (bone fractions). */
function girthAboutBone(p: Primitive, s: number, bone: BoneSegment | undefined, taper: [number, number] | null): Primitive {
  if (!bone) return p;
  const h = bone.head, d: Vec3 = [bone.tail[0] - h[0], bone.tail[1] - h[1], bone.tail[2] - h[2]];
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
  const frac = (v: Vec3) => ((v[0] - h[0]) * d[0] + (v[1] - h[1]) * d[1] + (v[2] - h[2]) * d[2]) / dd;
  const sAt = (t: number) => {
    if (!taper) return s;
    const u = Math.min(1, Math.max(0, (t - taper[0]) / Math.max(1e-9, taper[1] - taper[0])));
    return 1 + (s - 1) * (1 - u * u * (3 - 2 * u));
  };
  const about = (v: Vec3): Vec3 => {
    const t = frac(v), k = sAt(t), q: Vec3 = [h[0] + t * d[0], h[1] + t * d[1], h[2] + t * d[2]];
    return [q[0] + k * (v[0] - q[0]), q[1] + k * (v[1] - q[1]), q[2] + k * (v[2] - q[2])];
  };
  const ta = frac(p.a), tb = p.b ? frac(p.b) : ta, sc = sAt((ta + tb) / 2);
  return {
    ...p, a: about(p.a), ...(p.b ? { b: about(p.b) } : {}),
    r: p.kind === "roundBox" ? p.r : p.r * sAt(ta),
    ...(p.r2 !== undefined ? { r2: p.r2 * sAt(tb) } : {}),
    // Limb ellipsoids carry rot = [0, 0, roll]: local y runs along the bone, x/z are the section.
    ...(p.size ? { size: [p.size[0] * sc, p.size[1], p.size[2] * sc] as Vec3 } : {}),
  };
}

/** The slimmed copy of one primitive (identity for anything the sculpt leaves alone). */
function slimPrimitive(p: Primitive, P: BodyProportions, bones: Map<string, BoneSegment>): Primitive {
  const id = p.id, side = id.endsWith("L") || id.endsWith("R") ? id.slice(-1) : "";
  const stem = side ? id.slice(0, -1) : id;
  switch (stem) {
    case "ribcage": return { ...p, size: scaleV(p.size!, SLIM.ribX, 1, SLIM.ribZ) };
    case "abdomen": {
      const s = p.size!;
      const flat = Math.min(s[2], BELLY_FLAT_PER_CHEST * P.halfDepth.chest);
      return { ...p, size: [s[0] * SLIM.waistX, s[1], flat * SLIM.bellyZ] };
    }
    case "oblique": return { ...p, a: [p.a[0] * SLIM.obliqueX, p.a[1], p.a[2]], size: scaleV(p.size!, SLIM.obliqueX, 1, SLIM.obliqueZ) };
    case "pelvis": return { ...p, size: scaleV(p.size!, SLIM.pelvisX, 1, SLIM.pelvisZ) };
    case "gluteus": return { ...p, size: scaleV(p.size!, 1, 1, SLIM.gluteZ) };
    case "thigh": case "quadriceps": case "hamstrings": case "vastusMedialis":
      if (p.region !== "thigh") return p;
      return girthAboutBone(p, SLIM.thigh, bones.get(`hip${side}`), null);
    case "knee": case "patella": case "shin": case "calf": case "calfLateral":
      if (p.region !== "shin") return p;
      // The shin's girth eases back to 1 before the ankle: the foot and the sole contact stay exact.
      return girthAboutBone(p, SLIM.shin, bones.get(`knee${side}`), [0.6, 0.98]);
    case "biceps": case "triceps":
      return p.size ? { ...p, size: [p.size[0] * SLIM.armBelly, p.size[1], p.size[2] * SLIM.armBelly] } : p;
    default: return p;
  }
}

function mapPrims(n: SdfNode, f: (p: Primitive) => Primitive): SdfNode {
  return n.type === "primitive" ? { type: "primitive", primitive: f(n.primitive) } : { ...n, children: n.children.map((c) => mapPrims(c, f)) };
}
function findPrim(n: SdfNode, id: string): Primitive | null {
  if (n.type === "primitive") return n.primitive.id === id ? n.primitive : null;
  for (const c of n.children) { const p = findPrim(c, id); if (p) return p; }
  return null;
}
const node = (p: Primitive): SdfNode => ({ type: "primitive", primitive: p });
const op = (o: "smoothUnion" | "smoothSubtract", k: number, ...children: SdfNode[]): SdfNode => ({ type: "op", op: o, k, children });

/** Front (+z) surface of a field at (x, y): the outermost inside->outside crossing on [z0, z1] (m), or null. */
export function frontZ(sample: (x: number, y: number, z: number) => number, x: number, y: number, z0: number, z1: number, step = 0.004): number | null {
  for (let z = z1; z > z0; z -= step) {
    if (sample(x, y, z - step) < 0 && sample(x, y, z) >= 0) {
      let lo = z - step, hi = z;
      for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (sample(x, y, m) < 0) lo = m; else hi = m; }
      return lo;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Wave GEN lane B: the stat morph's INFLATE stage (muscle groups, bone density, shoulder breadth,
// maturity) and the race posture (ork forward neck, trapezius; dwarf lumbar), on the skin tree.

/** Scale a limb ellipsoid's section (local y runs along the bone) about its own centre. */
function limbGirth(p: Primitive, k: number): Primitive {
  return p.size && k !== 1 ? { ...p, size: [p.size[0] * k, p.size[1], p.size[2] * k] } : p;
}
/** A partial share of a multiplier: 1 + share·(k − 1). */
const share = (k: number, f: number) => 1 + f * (k - 1);

/** Share of a trunk muscle's gain that goes SIDEWAYS (toward the hanging arm); the rest goes into depth. */
export const LATERAL_SHARE = 0.35;

/** The inflated copy of one primitive under the morph (identity for anything it leaves alone). */
export function inflatePrimitive(p: Primitive, M: Morph, P: BodyProportions): Primitive {
  const id = p.id, side = id.endsWith("L") || id.endsWith("R") ? id.slice(-1) : "";
  const stem = side ? id.slice(0, -1) : id;
  const h = P.head, mu = M.muscle, mass = M.maturity.mass, lift = M.maturity.liftPerHead * h;
  switch (stem) {
    case "pectoral": {
      const k = mu.pectoralis, sz = p.size!;
      // Depth first: the plate thickens forward; its lateral edge grows by a smaller share so it never
      // reaches the arm across the bind-pose gap (a full-x pectoral webbed the ork's elbow to the trunk).
      return { ...p, a: [p.a[0], p.a[1], p.a[2] + lift], size: [sz[0] * share(k, LATERAL_SHARE), sz[1] * share(k, 0.5), sz[2] * k] };
    }
    case "ribcage": return { ...p, a: [p.a[0], p.a[1], p.a[2] + 0.5 * lift], size: [p.size![0] * mass, p.size![1], p.size![2] * mass] };
    case "abdomen": case "oblique": return p.region === "torso" ? { ...p, size: [p.size![0] * mass, p.size![1], p.size![2] * mass] } : p;
    case "scapula": return { ...p, size: [p.size![0] * share(mu.latissimus, LATERAL_SHARE), p.size![1], p.size![2] * mu.latissimus] };
    case "trapezius": {
      const k = mu.trapezius * M.posture.trapezius;
      return { ...p, r: p.r * k, ...(p.r2 !== undefined ? { r2: p.r2 * k } : {}) };
    }
    case "deltoid": {
      if (p.region !== "upperArm") return p;
      // The deltoid runs far down the arm: its section grows fully front/back (z) but only by
      // LATERAL_SHARE across (local x), and the centre moves OUT by that growth so the inner edge stays
      // where it was (a full-girth deltoid closed the ork's elbow-trunk gap: 140 mm -> 0, measured).
      const k = mu.deltoid, out = Math.sign(p.a[0]) * (M.shoulderBreadth - 1) * P.halfWidth.shoulderJoint;
      if (!p.size || k === 1 && out === 0) return p;
      const kx = share(k, LATERAL_SHARE), roll = p.rot?.[2] ?? 0;
      let ex: Vec3 = [Math.cos(roll), Math.sin(roll), 0];
      if (ex[0] * Math.sign(p.a[0]) < 0) ex = [-ex[0], -ex[1], 0];
      const grow = (kx - 1) * p.size[0];
      return { ...p, size: [p.size[0] * kx, p.size[1], p.size[2] * k], a: [p.a[0] + out + ex[0] * grow, p.a[1] + ex[1] * grow, p.a[2]] };
    }
    case "biceps": return p.region === "upperArm" ? limbGirth(p, mu.biceps) : p;
    case "triceps": return p.region === "upperArm" ? limbGirth(p, share(mu.biceps, 0.6)) : p;
    case "quadriceps": case "vastusMedialis": return p.region === "thigh" ? limbGirth(p, mu.quadriceps) : p;
    case "hamstrings": return p.region === "thigh" ? limbGirth(p, share(mu.quadriceps, 0.6)) : p;
    case "calf": case "calfLateral": return p.region === "shin" ? limbGirth(p, mu.calf) : p;
    case "clavicle": return { ...p, r: p.r * M.boneDensity };
    case "knee": case "elbow": case "olecranon": return limbGirth(p, M.boneDensity);
    case "neck": return { ...p, r: p.r * mass, ...(p.r2 !== undefined ? { r2: p.r2 * mass } : {}) };
    default: return p;
  }
}

/** The whole tree inflated by the morph and bent by its posture (neck, trapezius, brow): lane P's hit tree. */
export function inflateTree(n: SdfNode, M: Morph, P: BodyProportions): SdfNode {
  return mapPrims(n, (p) => posturePrimitive(inflatePrimitive(p, M, P), M, P));
}

/** The neck-forward weight at height y: 0 at the neck base, 1 at the chin (smoothstep); head bones move rigidly. */
export function neckForwardWeight(P: BodyProportions, y: number): number {
  const u = Math.min(1, Math.max(0, (y - P.y.neckBase) / Math.max(1e-9, P.y.chin - P.y.neckBase)));
  return u * u * (3 - 2 * u);
}

/** Posture + brow on one primitive: the neck leans forward, the head moves with it; the brow ridge recesses. */
export function posturePrimitive(p: Primitive, M: Morph, P: BodyProportions): Primitive {
  const off = M.posture.neckForwardPerHead * P.head;
  let q = p;
  if (off !== 0 && (p.bone === "neck" || p.bone === "head" || /^trapezius[LR]$/.test(p.id))) {
    const mv = (v: Vec3): Vec3 => [v[0], v[1], v[2] + off * (p.bone === "head" ? 1 : neckForwardWeight(P, v[1]))];
    q = { ...q, a: mv(q.a), ...(q.b ? { b: mv(q.b) } : {}) };
  }
  if (M.browRecessMm !== 0 && /^browRidge[LR]$/.test(p.id)) {
    const dz = -M.browRecessMm / 1000;
    q = { ...q, a: [q.a[0], q.a[1], q.a[2] + dz], ...(q.b ? { b: [q.b[0], q.b[1], q.b[2] + dz] as Vec3 } : {}) };
  }
  return q;
}

/** Back (−z) surface of a field at (x, y): the outermost crossing on [z0, z1] scanning from z0 up, or null. */
export function backZ(sample: (x: number, y: number, z: number) => number, x: number, y: number, z0: number, z1: number, step = 0.004): number | null {
  for (let z = z0; z < z1; z += step) {
    if (sample(x, y, z + step) < 0 && sample(x, y, z) >= 0) {
      let lo = z, hi = z + step;
      for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (sample(x, y, m) < 0) hi = m; else lo = m; }
      return hi;
    }
  }
  return null;
}
/** Lateral (+x) surface of a field at (y, z): the outermost crossing on [x0, x1] scanning inward, or null. */
export function sideX(sample: (x: number, y: number, z: number) => number, y: number, z: number, x0: number, x1: number, step = 0.004): number | null {
  for (let x = x1; x > x0; x -= step) {
    if (sample(x - step, y, z) < 0 && sample(x, y, z) >= 0) {
      let lo = x - step, hi = x;
      for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (sample(m, y, z) < 0) lo = m; else hi = m; }
      return lo;
    }
  }
  return null;
}

/** The trunk's own lateral (+x) surface at (y, z): the first exit marching OUT from x = 0 (an arm a gap away is not reached), or null. */
export function trunkSideX(sample: (x: number, y: number, z: number) => number, y: number, z: number, x1: number, step = 0.003): number | null {
  if (sample(0, y, z) >= 0) return null;
  for (let x = 0; x < x1; x += step) {
    if (sample(x + step, y, z) >= 0) {
      let lo = x, hi = x + step;
      for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (sample(m, y, z) < 0) lo = m; else hi = m; }
      return lo;
    }
  }
  return null;
}

/** The latissimus sheet: centre at centreX·(trunk half-width), half-width halfWX·(trunk half-width), half-height/-depth and how proud of the back it stands at max strength (head heights). */
export const LAT_SHEET = { centreX: 0.55, halfWX: 0.42, halfH: 0.55, halfD: 0.12, proudPerHead: 0.05 } as const;

/** The lumbar cutter's radius (head heights): wide and shallow, so the hollow is a curve, not a dent. */
export const LUMBAR_CUTTER = { rxPerHead: 0.5, ryPerHead: 0.4, rzPerHead: 0.3 } as const;

/**
 * Landmark re-carve depths at max strength (head heights): the sternal furrow between the pectorals,
 * the suprapatellar groove above the kneecap, the inguinal line running from the iliac crest's front
 * spine to the pubis. Scaled by the strength excess (0 at the reference: today's body).
 */
export const LANDMARK_CARVE = {
  sternum: { rPerHead: 0.05, depthPerHead: 0.03 },
  kneecap: { rPerHead: 0.06, depthPerHead: 0.06, abovePerHead: 0.22 },
  iliac: { rPerHead: 0.045, depthPerHead: 0.04 },
} as const;

/** The landmark cutters for an inflated skin tree (found on its own surface, never assumed). */
export function landmarkCutters(inflated: SdfNode, P: BodyProportions, bones: readonly BoneSegment[], amount: number): SdfNode[] {
  const h = P.head, y = P.y, s: SdfSample = { d: 0, region: 0, bone: 0 };
  const field = compileSdf(inflated);
  const F = (x: number, yy: number, z: number) => field.sample(x, yy, z, s).d;
  const fz = (x: number, yy: number) => frontZ(F, x, yy, -1.2 * h, 1.5 * h);
  const out: SdfNode[] = [];
  const at = (x: number, yy: number, r: number, depth: number): Vec3 | null => {
    const z = fz(x, yy);
    return z === null ? null : [x, yy, z + r - depth];
  };
  // Sternum: a midline furrow from below the pectorals up to the manubrium.
  {
    const C = LANDMARK_CARVE.sternum, r = C.rPerHead * h, d = C.depthPerHead * h * amount;
    // A polyline on the chest's own front (a straight capsule would pass behind a bulging chest).
    const y0 = y.nipple - 0.2 * h, y1 = y.sternalNotch - 0.2 * h, N = 5;
    const pts = Array.from({ length: N + 1 }, (_, i) => at(0, y0 + (y1 - y0) * i / N, r, d));
    for (let i = 0; i < N; i++) {
      const a = pts[i], b = pts[i + 1];
      if (a && b) out.push(node({ id: `sternalFurrow${i}`, kind: "capsule", bone: "spine", region: "torso", a, b, r }));
    }
  }
  // The bilateral cutters are found on the LEFT side and mirrored (the morph has no side term; the
  // skin's seeded asymmetry must not make the carve itself asymmetric).
  const left: SdfNode[] = [];
  {
    const side = 1 as const, L = "L";
    // Kneecap: a groove across the leg above the patella, between it and the quadriceps.
    const kb = bones.find((b) => b.id === `knee${L}`), hb = bones.find((b) => b.id === `hip${L}`);
    if (kb && hb) {
      const C = LANDMARK_CARVE.kneecap, r = C.rPerHead * h, d = C.depthPerHead * h * amount;
      // Placed C.abovePerHead over the patella's own front peak (found on the leg's line, ±0.15 h of the joint).
      const K = kb.head, H = hb.head, len = Math.max(1e-9, H[1] - K[1]);
      const onLine = (dy: number): [number, number] => [K[0] + (H[0] - K[0]) * dy / len, K[1] + dy];
      let peak = -Infinity, peakAt = 0;
      for (let dy = -0.15 * h; dy <= 0.15 * h; dy += 0.01 * h) { const q = onLine(dy), z = fz(q[0], q[1]) ?? -Infinity; if (z > peak) { peak = z; peakAt = dy; } }
      const [cx, cy] = onLine(peakAt + C.abovePerHead * h);
      const c = at(cx, cy, r, d);
      if (c) left.push(node({ id: `suprapatellar${L}`, kind: "capsule", bone: `hip${L}` as Primitive["bone"], region: "thigh", a: [c[0] - 0.18 * h, c[1], c[2]], b: [c[0] + 0.18 * h, c[1], c[2]], r }));
    }
    // Iliac crest: the inguinal line from the anterior iliac spine down to the pubis.
    {
      const C = LANDMARK_CARVE.iliac, r = C.rPerHead * h, d = C.depthPerHead * h * amount;
      // A polyline seated on the surface at every node (a straight capsule is buried under a full belly
      // and carves an inner void instead of a groove).
      const A: [number, number] = [side * 0.78 * P.halfWidth.hip, y.pelvis + 0.2 * h], B: [number, number] = [side * 0.18 * h, y.crotch + 0.4 * h];
      const N = 5, pts = Array.from({ length: N + 1 }, (_, i) => at(A[0] + (B[0] - A[0]) * i / N, A[1] + (B[1] - A[1]) * i / N, r, d));
      for (let i = 0; i < N; i++) {
        const a = pts[i], b = pts[i + 1];
        if (a && b) left.push(node({ id: `inguinal${i}${L}`, kind: "capsule", bone: "abdomen", region: "pelvis", a, b, r }));
      }
    }
  }
  const mirror = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];
  for (const n of left) {
    const p = (n as { primitive: Primitive }).primitive;
    out.push(n, node({ ...p, id: `${p.id.slice(0, -1)}R`, a: mirror(p.a), ...(p.b ? { b: mirror(p.b) } : {}), bone: (p.bone === "hipL" ? "hipR" : p.bone) as Primitive["bone"] }));
  }
  return out;
}

/** Options of the sculpt (measurement/QA): every part can be turned off, the belly forced. */
export interface PhysiqueOptions {
  slim?: boolean; deltoid?: boolean; abs?: boolean; bulge?: boolean;
  /** Force the fat belly (0..1); default = the spec's own, else the seeded rare roll. */
  belly?: number;
  /**
   * Wave GEN lane B: the stat + race morph (StatMorph.statMorph). Absent or identity = the pre-wave
   * sculpt exactly. `carve: false` skips the landmark re-carve (the pipeline's inflate-stage view).
   */
  morph?: Morph;
  carve?: boolean;
}

/**
 * The sculpted skin tree: `skin` is the symmetry pass's rendered tree (ground cut NOT yet applied).
 * Returns the new tree and its record. Joints, bone lengths and the physics tree are untouched.
 */
export function sculptSkin(skin: SdfNode, P: BodyProportions, bones: readonly BoneSegment[], opts: PhysiqueOptions = {}): { node: SdfNode; inflated: SdfNode; record: PhysiqueRecord } {
  const h = P.head, c = P.cell, y = P.y;
  const boneMap = new Map(bones.map((b) => [b.id as string, b]));
  let body = opts.slim === false ? skin : mapPrims(skin, (p) => slimPrimitive(p, P, boneMap));
  // Wave GEN lane B: the morph's inflate (muscle groups, bone density, breadth, maturity) and the race
  // posture / brow on the slimmed skin. An identity morph leaves the tree exactly as it was.
  const M = opts.morph && !(opts.morph.statIdentity && opts.morph.raceIdentity) ? opts.morph : null;
  if (M) body = mapPrims(body, (p) => posturePrimitive(inflatePrimitive(p, M, P), M, P));
  const solid = compileSdf(body), s: SdfSample = { d: 0, region: 0, bone: 0 };
  const F = (x: number, yy: number, z: number) => solid.sample(x, yy, z, s).d;
  const adds: SdfNode[] = [], cuts: SdfNode[] = [];
  const kAdd: number[] = [];

  // --- deltoid caps + the valley between the clavicle line and the cap ------------------------
  const sx = P.halfWidth.shoulderJoint, Rd = P.radius.deltoid;
  const capK = M ? M.muscle.deltoid : 1, capOut = M ? (M.shoulderBreadth - 1) * sx : 0;
  const apex: Vec3 = [sx + DELTOID.outPerHead * h + capOut, y.shoulder + (DELTOID.risePerHead + DELTOID.halfHeightPerHead) * h, -0.03 * h];
  const valley: Vec3 = [sx - DELTOID.valleyInPerHead * h, 0, 0.01 * h];
  if (opts.deltoid !== false) {
    // The clavicle line's top at the valley's x (the slimmed trunk's own surface, found, not assumed).
    let top = y.shoulder;
    for (let yy = y.shoulder + 0.6 * h; yy > y.shoulder; yy -= 0.002) if (F(valley[0], yy, valley[2]) < 0) { top = yy; break; }
    valley[1] = top - DELTOID.valleyDepthPerHead * h + DELTOID.valleyRPerHead * h;
    for (const side of [1, -1] as const) {
      const L = side > 0 ? "L" : "R";
      const roll = side * 0.25; // leans out with the shoulder slope
      adds.push(node({
        id: `deltoidCap${L}`, kind: "ellipsoid", bone: `shoulder${L}` as Primitive["bone"], region: "upperArm",
        a: [side * apex[0], y.shoulder + DELTOID.risePerHead * h, apex[2]],
        size: [DELTOID.widthPerRadius * Rd * capK, DELTOID.halfHeightPerHead * h, DELTOID.depthPerRadius * Rd * capK], r: 0, rot: [0, 0, roll],
      }));
      kAdd.push(DELTOID.blendPerRadius * Rd);
      cuts.push(node({
        id: `deltoidValley${L}`, kind: "capsule", bone: "spine", region: "torso",
        a: [side * valley[0], valley[1], valley[2] - 0.22 * h], b: [side * valley[0], valley[1], valley[2] + 0.22 * h], r: DELTOID.valleyRPerHead * h,
      }));
    }
  }

  // --- wave GEN: the latissimus sheets (strength above the reference) and the lumbar curve -----
  // The lats thicken the BACK-flank (behind the arm's plane): a sheet on the flank itself read as a
  // lump between the ork's arm and ribcage (Q2 Z-46). Each sheet is seated on the back surface found
  // at its own x and stands proud of it by amount·LAT_SHEET.proudPerHead·h.
  const latAmount = M ? Math.max(0, M.muscle.latissimus - 1) / 0.3 : 0;
  if (latAmount > 0) {
    const ly = (y.nipple + y.ribBottom) / 2;
    const xs = trunkSideX(F, ly, -0.15 * h, 2 * P.halfWidth.chest + h) ?? P.halfWidth.chest;
    const cx = LAT_SHEET.centreX * xs, zb = backZ(F, cx, ly, -1.5 * h, 0.5 * h) ?? -P.halfDepth.chest;
    for (const side of [1, -1] as const) {
      adds.push(node({
        id: `latissimus${side > 0 ? "L" : "R"}`, kind: "ellipsoid", bone: "spine", region: "torso",
        a: [side * cx, ly, zb + LAT_SHEET.halfD * h - latAmount * LAT_SHEET.proudPerHead * h],
        size: [LAT_SHEET.halfWX * xs, LAT_SHEET.halfH * h, LAT_SHEET.halfD * h], r: 0, rot: [0, 0, side * 0.18],
      }));
      kAdd.push(0.08 * h);
    }
  }
  const lumbarDepth = M ? M.posture.lumbarDepthPerHead * h : 0;
  if (lumbarDepth > 0) {
    const zb = backZ(F, 0, y.waist, -1.5 * h, 0.5 * h) ?? -P.halfDepth.belly;
    const rz = LUMBAR_CUTTER.rzPerHead * h;
    cuts.push(node({
      id: "lumbarHollow", kind: "ellipsoid", bone: "abdomen", region: "torso",
      a: [0, y.waist, zb - rz + lumbarDepth], size: [LUMBAR_CUTTER.rxPerHead * h, LUMBAR_CUTTER.ryPerHead * h, rz], r: 0,
    }));
  }

  // --- the rare fat belly ---------------------------------------------------------------------
  const specBelly = (P.spec as { belly?: number | null }).belly;
  const belly = Math.max(0, Math.min(1, opts.belly ?? (typeof specBelly === "number" ? specBelly : fatBellyFor(P.spec.seed, P.spec.race))));
  if (belly > 0) {
    const by = y.navel - 0.12 * h, bz = frontZ(F, 0, by, -0.2 * h, 1.2 * h) ?? P.halfDepth.belly;
    const d = 0.5 * h;
    adds.push(node({
      id: "fatBelly", kind: "ellipsoid", bone: "abdomen", region: "torso",
      a: [0, by, bz + belly * FAT_BELLY_FWD_PER_HEAD * h - d], size: [0.95 * P.halfWidth.waist * SLIM.waistX + 0.1 * h * belly, 0.85 * h, d], r: 0,
    }));
    kAdd.push(0.3 * h);
  }

  // --- rectus abdominis sheets + linea alba ---------------------------------------------------
  const yTop = y.ribBottom + ABS.topAboveRibPerHead * h, yBottom = y.navel - ABS.bottomBelowNavelPerHead * h;
  const yMid = (yTop + yBottom) / 2;
  const fz = frontZ(F, ABS.sheetXPerHead * h, yMid, -0.2 * h, 1.2 * h) ?? P.halfDepth.belly;
  // A fat belly hides the six-pack: no sheets, no linea, and the shader's abs band is off (halfWidth 0).
  const absOn = opts.abs !== false && belly === 0;
  const absRec = { yTop, yBottom, halfWidth: absOn ? 2 * ABS.sheetHalfWPerHead * h + 0.02 * h : 0, frontZ: fz };
  if (absOn) {
    const halfH = (yTop - yBottom) / 2, dz = 0.16 * h;
    for (const side of [1, -1] as const) {
      adds.push(node({
        id: `rectus${side > 0 ? "L" : "R"}`, kind: "ellipsoid", bone: "abdomen", region: "torso",
        a: [side * ABS.sheetXPerHead * h, yMid, fz + ABS.proudPerHead * h - dz], size: [ABS.sheetHalfWPerHead * h, halfH, dz], r: 0,
      }));
      kAdd.push(0.06 * h);
    }
    const lr = Math.max(ABS.lineaRCells * c, 0.03 * h);
    const lz = fz + ABS.proudPerHead * h + lr - ABS.lineaDepthCells * c;
    cuts.push(node({ id: "lineaAlba", kind: "capsule", bone: "abdomen", region: "torso", a: [0, yBottom + 0.15 * h, lz], b: [0, yTop, lz], r: lr }));
  }
  // The navel stays a hollow ON the final front (sheets or a fat belly would fill it or bury it — a
  // buried cutter carves an inner void, a second skin component): re-cut at the sculpted surface.
  const navel = findPrim(skin, "navel");
  if (navel && (absOn || belly > 0)) {
    let withAdds = body;
    for (let i = 0; i < adds.length; i++) withAdds = op("smoothUnion", kAdd[i], withAdds, adds[i]);
    const fa = compileSdf(withAdds);
    const nz = frontZ((x, yy, z) => fa.sample(x, yy, z, s).d, 0, navel.a[1], -0.2 * h, 1.5 * h);
    if (nz !== null) cuts.push(node({ ...navel, a: [navel.a[0], navel.a[1], nz + 0.3 * navel.r] }));
  }

  // --- the male crotch bulge ------------------------------------------------------------------
  const male = P.sex === "male";
  if (male && opts.bulge !== false) {
    const by = y.crotch + BULGE.risePerHead * h;
    // Proud of its NEIGHBOURS, not just of the pubic surface under it: the lower belly just above and
    // the inner-thigh fronts beside it (all found on the slimmed skin, never assumed).
    const zHere = frontZ(F, 0, by, -0.3 * h, 1.2 * h) ?? 0.1 * h;
    const zAbove = frontZ(F, 0, by + 0.3 * h, -0.3 * h, 1.2 * h) ?? zHere;
    const zThigh = frontZ(F, 0.35 * h, by, -0.3 * h, 1.2 * h) ?? zHere;
    const apexZ = Math.max(zHere, zAbove, zThigh) + BULGE.proudPerHead * h;
    adds.push(node({
      id: "crotchBulge", kind: "ellipsoid", bone: "abdomen", region: "pelvis",
      a: [0, by, apexZ - BULGE.halfD * h], size: [BULGE.halfW * h, BULGE.halfH * h, BULGE.halfD * h], r: 0, rot: [-0.3, 0, 0],
    }));
    kAdd.push(BULGE.blendPerHead * h);
  }

  // One smooth union per addition (each with its own blend width), then every cutter.
  for (let i = 0; i < adds.length; i++) body = op("smoothUnion", kAdd[i], body, adds[i]);
  const inflated = body;
  // --- wave GEN carve: landmarks stay readable on an inflated body (strength above the reference) --
  const carveAmt = M ? Math.max(0, M.u.strength) : 0;
  if (carveAmt > 0) cuts.push(...landmarkCutters(inflated, P, bones, carveAmt));
  if (cuts.length && opts.carve !== false) body = op("smoothSubtract", Math.max(0.6 * c, 0.03 * h), body, ...cuts);
  return {
    node: body, inflated,
    record: { slim: SLIM, belly, bellySource: typeof specBelly === "number" && opts.belly === undefined ? "spec" : "seed", bulge: male && opts.bulge !== false, abs: absRec, deltoidApex: apex, valley },
  };
}

// ---------------------------------------------------------------------------------------------
// Measurement on a BUILT mesh (the docs' numbers come from these; nothing is typed by hand).

const regionIs = (mesh: MeshData, v: number, names: readonly string[]) => names.includes(REGIONS[mesh.region[v]]);

/** Perimeter (m) of the convex hull of 2D points. */
function hullPerimeter(pts: [number, number][]): number {
  if (pts.length < 3) return 0;
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  const hull = lo.slice(0, -1).concat(up.slice(0, -1));
  let per = 0;
  for (let i = 0; i < hull.length; i++) { const a = hull[i], b = hull[(i + 1) % hull.length]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  return per;
}

/** The body measurements the wave reports (metres). */
export interface PhysiqueMeasure {
  /** Tape round the trunk at the waist line (convex hull of the torso/pelvis vertices in the band). */
  waistCircumference: number;
  /** Outer shoulder breadth: 2 × the largest |x| of trunk/upper-arm skin within ±0.4 h of the shoulder line. */
  shoulderWidth: number;
  /** Highest skin point over the deltoid (x in [sx − 0.02 h, sx + 0.35 h]) and over the clavicle line (x in [0.45, 0.7]·sx), front half. */
  deltoidApexY: number;
  clavicleY: number;
  /** Lowest point of the shoulder's top profile between them, and the valley depth min(peaks) − valley. */
  valleyY: number;
  valleyDepth: number;
  /** Front z at the linea alba vs the rectus crest beside it (abs band centre). Positive = a groove. */
  lineaDepth: number;
  /** Crotch: most forward z at the bulge (±0.15 h), vs the lower belly 0.3 h above it (the sculpt's own neighbour) and the inner-thigh fronts (|x| 0.3-0.5 h) beside it. */
  crotchZ: number;
  crotchVsBelly: number;
  crotchVsThigh: number;
  /** Most forward z of the belly at the navel band. */
  bellyZ: number;
}

/**
 * The shoulder's top profile seen from the front, on the skin FIELD (continuous, no grid sampling):
 * for x in [0.3·sx, sx + 0.4·h] the highest inside point over the front half (z ≥ −0.02·h) — the
 * clavicle shelf, the valley and the deltoid cap. Returns the profile and the three facts.
 */
export function shoulderProfile(sample: (x: number, y: number, z: number) => number, P: BodyProportions): {
  xs: number[]; top: number[]; clavicleY: number; clavicleX: number; apexY: number; apexX: number; valleyY: number; valleyX: number; valleyDepth: number;
} {
  const h = P.head, sx = P.halfWidth.shoulderJoint, y0 = P.y.shoulder;
  const xs: number[] = [], top: number[] = [];
  for (let x = 0.3 * sx; x <= sx + 0.4 * h; x += 0.004) {
    let best = -Infinity;
    for (let z = -0.02 * h; z <= 0.5 * h; z += 0.01) {
      for (let y = y0 + 0.6 * h; y > y0 - 0.3 * h; y -= 0.002) if (sample(x, y, z) < 0) { best = Math.max(best, y); break; }
    }
    xs.push(x); top.push(best);
  }
  // Clavicle shelf: the highest point for x in [0.55, 0.85]·sx; deltoid apex: for x ≥ sx − 0.05·h.
  let ic = -1, ia = -1;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] >= 0.55 * sx && xs[i] <= 0.85 * sx && (ic < 0 || top[i] > top[ic])) ic = i;
    if (xs[i] >= sx - 0.05 * h && (ia < 0 || top[i] > top[ia])) ia = i;
  }
  let iv = ic;
  for (let i = Math.min(ic, ia); i <= Math.max(ic, ia); i++) if (top[i] < top[iv]) iv = i;
  return {
    xs, top, clavicleY: top[ic], clavicleX: xs[ic], apexY: top[ia], apexX: xs[ia], valleyY: top[iv], valleyX: xs[iv],
    valleyDepth: Math.max(0, Math.min(top[ic], top[ia]) - top[iv]),
  };
}

/** Measure a built skin mesh against its plan's proportions (left side for the bilateral numbers). */
export function measurePhysique(mesh: MeshData, P: BodyProportions): PhysiqueMeasure {
  const pos = mesh.positions, n = pos.length / 3, h = P.head, c = P.cell, y = P.y, sx = P.halfWidth.shoulderJoint;
  const band: [number, number][] = [];
  let shoulder = 0;
  // Shoulder top profile on the MESH: one-cell bins of the front half (z ≥ −0.02 h), the same x windows
  // as shoulderProfile (clavicle shelf x in [0.55, 0.85]·sx, deltoid x ≥ sx − 0.05 h).
  const binW = c, x0 = 0.3 * sx, x1 = sx + 0.4 * h;
  const bins = new Float64Array(Math.ceil((x1 - x0) / binW) + 1).fill(-Infinity);
  let lineaZ = -Infinity, crestZ = -Infinity, crotchZ = -Infinity, bellyAbove = -Infinity, thighZ = -Infinity, bellyZ = -Infinity;
  const yMidAbs = (y.ribBottom + ABS.topAboveRibPerHead * h + y.navel - ABS.bottomBelowNavelPerHead * h) / 2;
  const cy = y.crotch + BULGE.risePerHead * h;
  for (let v = 0; v < n; v++) {
    const X = pos[v * 3], Y = pos[v * 3 + 1], Z = pos[v * 3 + 2];
    if (Math.abs(Y - y.waist) < 0.6 * c && regionIs(mesh, v, ["torso", "pelvis"])) band.push([X, Z]);
    if (Math.abs(Y - y.shoulder) < 0.4 * h && regionIs(mesh, v, ["torso", "upperArm", "neck"])) shoulder = Math.max(shoulder, Math.abs(X));
    if (X >= x0 && X <= x1 && Z >= -0.02 * h && regionIs(mesh, v, ["torso", "upperArm", "neck"])) {
      const b = Math.floor((X - x0) / binW); bins[b] = Math.max(bins[b], Y);
    }
    if (Math.abs(Y - yMidAbs) < 0.15 * h) {
      if (Math.abs(X) < 0.5 * c) lineaZ = Math.max(lineaZ, Z);
      if (Math.abs(Math.abs(X) - ABS.sheetXPerHead * h) < 0.5 * c) crestZ = Math.max(crestZ, Z);
    }
    if (Math.abs(X) < 0.08 * h && Math.abs(Y - cy) < 0.15 * h) crotchZ = Math.max(crotchZ, Z);
    if (Math.abs(X) < 0.08 * h && Math.abs(Y - (cy + 0.3 * h)) < 0.08 * h) bellyAbove = Math.max(bellyAbove, Z);
    if (Math.abs(X) > 0.3 * h && Math.abs(X) < 0.5 * h && Math.abs(Y - cy) < 0.15 * h && regionIs(mesh, v, ["pelvis", "thigh"])) thighZ = Math.max(thighZ, Z);
    if (Math.abs(X) < 0.1 * h && Math.abs(Y - y.navel) < 0.2 * h) bellyZ = Math.max(bellyZ, Z);
  }
  let ic = -1, ia = -1;
  for (let i = 0; i < bins.length; i++) {
    if (!Number.isFinite(bins[i])) continue;
    const X = x0 + (i + 0.5) * binW;
    if (X >= 0.55 * sx && X <= 0.85 * sx && (ic < 0 || bins[i] > bins[ic])) ic = i;
    if (X >= sx - 0.05 * h && (ia < 0 || bins[i] > bins[ia])) ia = i;
  }
  const clav = ic >= 0 ? bins[ic] : NaN, apex = ia >= 0 ? bins[ia] : NaN;
  let valleyY = Math.min(clav, apex);
  for (let i = Math.min(ic, ia) + 1; i < Math.max(ic, ia); i++) if (Number.isFinite(bins[i])) valleyY = Math.min(valleyY, bins[i]);
  return {
    waistCircumference: hullPerimeter(band), shoulderWidth: 2 * shoulder,
    deltoidApexY: apex, clavicleY: clav, valleyY, valleyDepth: Math.max(0, Math.min(clav, apex) - valleyY),
    lineaDepth: crestZ - lineaZ,
    crotchZ, crotchVsBelly: crotchZ - bellyAbove, crotchVsThigh: crotchZ - thighZ, bellyZ,
  };
}

// ---------------------------------------------------------------------------------------------
// Wave GEN lane B: measurement of the stat morph on the skin FIELD (continuous; no grid sampling).

type Sample3 = (x: number, y: number, z: number) => number;

/**
 * Circumference (m) of the field's section around a bone line at fraction t: 24 rays in the plane
 * normal to the bone, each marched out from the axis to the first exit (so a neighbouring limb a gap
 * away is not counted), polygon perimeter.
 */
export function girthAround(sample: Sample3, head: Vec3, tail: Vec3, t: number, maxR = 0.4): number {
  const d: Vec3 = [tail[0] - head[0], tail[1] - head[1], tail[2] - head[2]];
  const L = Math.hypot(d[0], d[1], d[2]) || 1;
  const u: Vec3 = [d[0] / L, d[1] / L, d[2] / L];
  const ref: Vec3 = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e1: Vec3 = [u[1] * ref[2] - u[2] * ref[1], u[2] * ref[0] - u[0] * ref[2], u[0] * ref[1] - u[1] * ref[0]];
  const n1 = Math.hypot(...e1); e1[0] /= n1; e1[1] /= n1; e1[2] /= n1;
  const e2: Vec3 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
  const c: Vec3 = [head[0] + d[0] * t, head[1] + d[1] * t, head[2] + d[2] * t];
  const rs: number[] = [], cs: [number, number][] = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
    const dir: Vec3 = [e1[0] * ca + e2[0] * sa, e1[1] * ca + e2[1] * sa, e1[2] * ca + e2[2] * sa];
    const at = (r: number) => sample(c[0] + dir[0] * r, c[1] + dir[1] * r, c[2] + dir[2] * r);
    let r = 0;
    while (r < maxR && at(r + 0.002) < 0) r += 0.002;
    let lo = r, hi = r + 0.002;
    for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; if (at(m) < 0) lo = m; else hi = m; }
    rs.push(lo); cs.push([ca, sa]);
  }
  // A ray that ran on into a neighbour (the trunk beside an arm, the other thigh) is clipped to
  // 1.5 × the median radius, so the girth is the limb's own section.
  const med = [...rs].sort((a, b) => a - b)[12];
  const pts = rs.map((r, k): [number, number] => [Math.min(r, 1.5 * med) * cs[k][0], Math.min(r, 1.5 * med) * cs[k][1]]);
  let per = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  return per;
}


/** The stat-morph and posture numbers the wave reports (metres unless named). */
export interface MorphMeasure {
  /** Section circumferences: upper arm at the biceps (shoulder bone t = 0.5), thigh at the quadriceps (t = 0.45), calf (knee bone t = 0.3), forearm control (elbow bone t = 0.3). */
  bicepsGirth: number; quadricepsGirth: number; calfGirth: number; forearmGirth: number;
  /** Chest front z at the pectoral (x = 0.3 h), torso half-width at the lats (behind the arm pit line). */
  pectoralFrontZ: number; latHalfWidth: number;
  /** Back surface z behind the lats (x = 0.55 trunk half-width, between the nipple line and the rib bottom; more negative = thicker back). */
  latBackZ: number;
  /** Smallest air gap between the arm's inner side and the trunk (m): rays from the arm axis toward x = 0, upper arm t 0.5-1, forearm t 0-0.5. */
  armGap: number;
  /** Top of the trapezius slope: at x = 0.5·shoulder half-span, the first exit marching up from the shoulder line (max over z in [−0.15 h, 0]). */
  trapeziusTopY: number;
  /** Outer shoulder breadth on the field (2 × the widest field x from 0.1 h below to 0.45 h above the shoulder line: the deltoid caps). */
  shoulderBreadth: number;
  /** Landmarks: deltoid valley depth (clavicle shelf), sternal groove (pec crest − midline), kneecap groove (deepest dent of the front profile below the chord from the patella peak to the quadriceps peak), inguinal groove below the iliac crest. */
  clavicleValley: number; sternalGroove: number; kneecapProud: number; iliacGroove: number;
  /** Posture: head forward offset = cranium front z at the eye line minus the sternal notch front z; neck front z at mid-neck; lumbar hollow depth (chord of thoracic and gluteal back points minus the back at the waist). */
  headForward: number; neckFrontZ: number; lumbarDepth: number;
  /** Brow ridge front z at the brow anchor (x of the left brow). */
  browFrontZ: number;
}

/** Smallest air gap from the arm's inner surface to the trunk, marching from the arm axis toward the midline. */
export function armGap(sample: Sample3, upper: BoneSegment, fore: BoneSegment): number {
  let best = Infinity;
  const probe = (p: Vec3) => {
    const dir = -Math.sign(p[0]) || -1;
    let x = p[0], inside = sample(x, p[1], p[2]) < 0, exitAt = Number.NaN;
    if (!inside) return;
    for (let k = 0; k < 400 && Math.sign(x) === Math.sign(p[0]); k++) {
      x += dir * 0.001;
      const d = sample(x, p[1], p[2]);
      if (inside && d >= 0) { inside = false; exitAt = x; } else if (!inside && d < 0) { best = Math.min(best, Math.abs(x - exitAt)); return; }
    }
  };
  for (let t = 0.5; t <= 1.0001; t += 0.05) probe([upper.head[0] + (upper.tail[0] - upper.head[0]) * t, upper.head[1] + (upper.tail[1] - upper.head[1]) * t, upper.head[2] + (upper.tail[2] - upper.head[2]) * t]);
  for (let t = 0; t <= 0.5001; t += 0.05) probe([fore.head[0] + (fore.tail[0] - fore.head[0]) * t, fore.head[1] + (fore.tail[1] - fore.head[1]) * t, fore.head[2] + (fore.tail[2] - fore.head[2]) * t]);
  return best;
}

export function measureMorph(sample: Sample3, plan: { proportions: BodyProportions; bones: readonly BoneSegment[]; legs: readonly { knee: Vec3; hip: Vec3 }[]; face: { brow: Vec3[] } }): MorphMeasure {
  const P = plan.proportions, h = P.head, y = P.y, sx = P.halfWidth.shoulderJoint;
  const bone = (id: string) => plan.bones.find((b) => b.id === id)!;
  const sh = bone("shoulderL"), hip = bone("hipL"), knee = bone("kneeL"), el = bone("elbowL");
  const fz = (x: number, yy: number) => frontZ(sample, x, yy, -1.2 * h, 1.5 * h) ?? Number.NaN;
  const bz = (x: number, yy: number) => backZ(sample, x, yy, -1.5 * h, 1.2 * h) ?? Number.NaN;
  // Shoulder breadth: widest field x around the shoulder line (z in the front half).
  let breadth = 0;
  for (let yy = y.shoulder - 0.1 * h; yy <= y.shoulder + 0.45 * h; yy += 0.01) {
    for (const z of [-0.1 * h, 0, 0.1 * h]) breadth = Math.max(breadth, sideX(sample, yy, z, 0, sx + 1.5 * h) ?? 0);
  }
  const prof = shoulderProfile(sample, P);
  // Sternal groove: pec crest (max front z for x in [0.1, 0.5] h) minus the midline, at the nipple line + 0.1 h.
  const ys = y.nipple + 0.1 * h;
  let crest = -Infinity;
  for (let x = 0.1 * h; x <= 0.5 * h; x += 0.01 * h) crest = Math.max(crest, fz(x, ys));
  // Kneecap: front z at the knee joint height vs the thigh 0.6 h above (on the leg's own line).
  const K = plan.legs[0].knee, H = plan.legs[0].hip;
  const along = (f: number): Vec3 => [K[0] + (H[0] - K[0]) * f, K[1] + (H[1] - K[1]) * f, 0];
  // Kneecap: the front profile up the leg's line from the knee joint: the patella peak (within ±0.15 h),
  // the quadriceps peak (0.5-1.2 h above).
  const legLen = Math.max(1e-9, H[1] - K[1]);
  const prof1 = (dy: number) => { const q = along(dy / legLen); return fz(q[0], q[1]); };
  let pk = -Infinity, pkAt = 0, qd = -Infinity, qdAt = 0;
  for (let dy = -0.15 * h; dy <= 0.15 * h; dy += 0.01 * h) { const z = prof1(dy); if (z > pk) { pk = z; pkAt = dy; } }
  for (let dy = 0.5 * h; dy <= 1.2 * h; dy += 0.02 * h) { const z = prof1(dy); if (z > qd) { qd = z; qdAt = dy; } }
  // Concavity below the chord from the patella peak to the quadriceps peak (a sloped thigh has no
  // "valley below both peaks", but a readable kneecap still dents the line between them).
  let kneeGroove = 0;
  for (let dy = pkAt; dy <= qdAt; dy += 0.01 * h) {
    const chordZ = pk + (qd - pk) * (dy - pkAt) / Math.max(1e-9, qdAt - pkAt);
    kneeGroove = Math.max(kneeGroove, chordZ - prof1(dy));
  }
  // Iliac crest / inguinal line: the front profile across the line (anterior iliac spine -> pubis) at its
  // midpoint: groove = min(peak on either side within 0.3 h) − the lowest point within 0.1 h of the line.
  const A: [number, number] = [0.78 * P.halfWidth.hip, y.pelvis + 0.2 * h], B: [number, number] = [0.18 * h, y.crotch + 0.4 * h];
  const Mx = (A[0] + B[0]) / 2, My = (A[1] + B[1]) / 2, ll = Math.hypot(A[0] - B[0], A[1] - B[1]) || 1;
  const nx = -(A[1] - B[1]) / ll, ny = (A[0] - B[0]) / ll;
  let pa = -Infinity, pb = -Infinity, vl = Infinity;
  for (let t = -0.3 * h; t <= 0.3 * h + 1e-9; t += 0.01 * h) {
    const z = fz(Mx + nx * t, My + ny * t);
    if (Math.abs(t) <= 0.1 * h) vl = Math.min(vl, z);
    if (t < -0.1 * h) pa = Math.max(pa, z); else if (t > 0.1 * h) pb = Math.max(pb, z);
  }
  // Lumbar: back points at the spine pivot (thoracic) and at the gluteal max, vs the waist.
  const bT = bz(0.05 * h, y.spinePivot), bW = bz(0.05 * h, y.waist);
  let bG = Infinity, yG = y.pelvis;
  for (let yy = y.crotch; yy <= y.waist; yy += 0.01 * h) { const b = bz(P.halfWidth.hip * 0.48, yy); if (b < bG) { bG = b; yG = yy; } }
  const chord = bT + (bG - bT) * (y.spinePivot - y.waist) / Math.max(1e-9, y.spinePivot - yG);
  const brow = plan.face.brow[0];
  // Trapezius: the highest skin over the slope behind the clavicles (x 0.3-0.5 of the joint half-span, z −0.2 h..0).
  const trapTop = () => {
    let best = -Infinity;
    // March UP from inside the shoulder girdle to the first exit (never reaches the head or a cap above it).
    for (let z = -0.15 * h; z <= 1e-9; z += 0.05 * h) {
      let yy = y.shoulder;
      if (sample(0.5 * sx, yy, z) >= 0) continue;
      while (yy < y.crown && sample(0.5 * sx, yy + 0.001, z) < 0) yy += 0.001;
      best = Math.max(best, yy);
    }
    return best;
  };
  return {
    bicepsGirth: girthAround(sample, sh.head, sh.tail, 0.5),
    quadricepsGirth: girthAround(sample, hip.head, hip.tail, 0.45),
    calfGirth: girthAround(sample, knee.head, knee.tail, 0.3),
    forearmGirth: girthAround(sample, el.head, el.tail, 0.3),
    pectoralFrontZ: fz(0.3 * h, y.nipple + 0.12 * h),
    latHalfWidth: trunkSideX(sample, (y.nipple + y.ribBottom) / 2, -0.15 * h, 2 * P.halfWidth.chest + h) ?? Number.NaN,
    latBackZ: bz(0.55 * (trunkSideX(sample, (y.nipple + y.ribBottom) / 2, -0.15 * h, 2 * P.halfWidth.chest + h) ?? P.halfWidth.chest), (y.nipple + y.ribBottom) / 2),
    armGap: armGap(sample, sh, el),
    trapeziusTopY: trapTop(),
    shoulderBreadth: 2 * breadth,
    clavicleValley: prof.valleyDepth,
    sternalGroove: crest - fz(0, ys),
    kneecapProud: kneeGroove,
    iliacGroove: Math.min(pa, pb) - vl,
    headForward: fz(0, y.eye ?? y.headPivot) - fz(0, y.sternalNotch - 0.05 * h),
    neckFrontZ: fz(0, (y.neckBase + y.chin) / 2),
    lumbarDepth: bW - chord,
    browFrontZ: fz(brow[0], brow[1]),
  };
}
