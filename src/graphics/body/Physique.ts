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

/** Options of the sculpt (measurement/QA): every part can be turned off, the belly forced. */
export interface PhysiqueOptions {
  slim?: boolean; deltoid?: boolean; abs?: boolean; bulge?: boolean;
  /** Force the fat belly (0..1); default = the spec's own, else the seeded rare roll. */
  belly?: number;
}

/**
 * The sculpted skin tree: `skin` is the symmetry pass's rendered tree (ground cut NOT yet applied).
 * Returns the new tree and its record. Joints, bone lengths and the physics tree are untouched.
 */
export function sculptSkin(skin: SdfNode, P: BodyProportions, bones: readonly BoneSegment[], opts: PhysiqueOptions = {}): { node: SdfNode; record: PhysiqueRecord } {
  const h = P.head, c = P.cell, y = P.y;
  const boneMap = new Map(bones.map((b) => [b.id as string, b]));
  let body = opts.slim === false ? skin : mapPrims(skin, (p) => slimPrimitive(p, P, boneMap));
  const solid = compileSdf(body), s: SdfSample = { d: 0, region: 0, bone: 0 };
  const F = (x: number, yy: number, z: number) => solid.sample(x, yy, z, s).d;
  const adds: SdfNode[] = [], cuts: SdfNode[] = [];
  const kAdd: number[] = [];

  // --- deltoid caps + the valley between the clavicle line and the cap ------------------------
  const sx = P.halfWidth.shoulderJoint, Rd = P.radius.deltoid;
  const apex: Vec3 = [sx + DELTOID.outPerHead * h, y.shoulder + (DELTOID.risePerHead + DELTOID.halfHeightPerHead) * h, -0.03 * h];
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
        size: [DELTOID.widthPerRadius * Rd, DELTOID.halfHeightPerHead * h, DELTOID.depthPerRadius * Rd], r: 0, rot: [0, 0, roll],
      }));
      kAdd.push(DELTOID.blendPerRadius * Rd);
      cuts.push(node({
        id: `deltoidValley${L}`, kind: "capsule", bone: "spine", region: "torso",
        a: [side * valley[0], valley[1], valley[2] - 0.22 * h], b: [side * valley[0], valley[1], valley[2] + 0.22 * h], r: DELTOID.valleyRPerHead * h,
      }));
    }
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
  if (cuts.length) body = op("smoothSubtract", Math.max(0.6 * c, 0.03 * h), body, ...cuts);
  return {
    node: body,
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
