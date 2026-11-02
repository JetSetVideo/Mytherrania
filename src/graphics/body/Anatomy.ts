// Anatomy plan (lane A, R03/R15): anatomyFor(spec) -> ONE signed-distance body (every part
// smooth-unioned into a single surface), the sculpt strokes, the bones and the bounds.
// Pure module: no THREE.
//
// Tree (k = blend width per joint, from the two radii, see AnatomyParts.blendWidth):
//   intersect( smoothUnion_shoulder( smoothUnion_hip( smoothUnion_neckTorso(torso, smoothUnion(neck, head)),
//                                                     legL, legR ),
//                                    armL, armR ),
//              groundHalfSpace )                         <- flat soles exactly on y = 0
// Limb abduction is SOLVED, not tuned. Two surfaces a gap g apart are blended by a smooth
// union of width k only where g < k, and Surface Nets resolves them only when g ≥ 2 cells,
// so the bind pose opens each limb until g ≥ max(k, MIN_GAP_CELLS·cell): the legs against
// each other, the arms against the trunk-with-legs field. A heavy body therefore opens its
// stance and arms instead of webbing a limb to the torso. The arms are then shown lower (the
// DISPLAY abduction: the smallest angle at which forearm and hand still clear the hips and
// thighs) — a rotation the skin follows, the way every A-pose-bound game character is posed.
//
// Cell: the DuBois estimate is refined from the field itself: Surface Nets makes 2 triangles
// per sign-change edge and that count scales as 1/cell², so a coarse count E0 at c0 gives
// cell = c0·√(2·E0 / TRIANGLE_TARGET).

import { rng32 } from "../../core/MathCore.ts";
import { defaultHumanoid, type JointName } from "../../game/Skeleton.ts";
import { type BilateralAsymmetry, bilateralAsymmetry, pairScales } from "../../game/BodyProfile.ts";
import type { AnatomyPlan, BodySpec, BoneId, BoneSegment, Bounds, BrushStroke, Primitive, SdfNode, SdfSample, Vec3 } from "./contracts.ts";
import { BONE_IDS, compileSdf, nodeBounds, type BodyField } from "./Sdf.ts";
import { applyFieldBrushes, brushReach } from "./Brushes.ts";
import { CELL_MAX, CELL_MIN, proportionsFor, TRIANGLE_TARGET, type BodyProportions } from "./Proportions.ts";
import { countSignChanges } from "./Polygonize.ts";
import { type PhysiqueOptions, type PhysiqueRecord, sculptSkin } from "./Physique.ts";
import {
  armNode, referenceForms, type ArmAnchors, blendWidth, type FaceAnchors, headNode, legNode, type LegAnchors, neckNode, op, prim, torsoNode,
} from "./AnatomyParts.ts";

/** Parent of every bone — the SAME tree as Humanoid.ts's pivots (spine is the top pivot). */
export const BONE_PARENT: Record<BoneId, BoneId | null> = {
  root: null, spine: "root", abdomen: "spine", neck: "spine", head: "neck",
  shoulderL: "spine", shoulderR: "spine", elbowL: "shoulderL", elbowR: "shoulderR",
  hipL: "abdomen", hipR: "abdomen", kneeL: "hipL", kneeR: "hipR",
  ankleL: "kneeL", ankleR: "kneeR", toeL: "ankleL", toeR: "ankleR",
};

/** Gap (in cells) Surface Nets needs to keep two surfaces apart (a cell's diagonal is √3). */
export const MIN_GAP_CELLS = 2;
/** Clearance (in cells) the lowered DISPLAY arm keeps from the hips and thighs. */
export const DISPLAY_CLEARANCE_CELLS = 0.5;
/** The sign-change count is taken at this multiple of the first cell (coarser = cheaper, less exact). */
export const COARSE_FACTOR = 1.5;
/** The cell is re-derived when the measured estimate differs from the first by more than this. */
export const CELL_TOLERANCE = 0.05;
/** Search window for the solved abductions (rad). */
export const ARM_ABDUCTION_RANGE: [number, number] = [0.1, 0.9];
export const LEG_ABDUCTION_RANGE: [number, number] = [0.0, 0.35];
/** Bisection steps for each abduction solve (window / 2^steps ≈ 0.003 rad). */
export const ABDUCTION_STEPS = 8;
/** Padding of the polygonising box beyond the solid, in cells (≥ 1 keeps the mesh closed). */
export const BOUNDS_PAD_CELLS = 2;

/** The plan plus the derived facts the rig and the paint lane need. */
export interface DetailedAnatomy extends AnatomyPlan {
  proportions: BodyProportions;
  /** Solved arm and leg abduction (rad) — the bind pose's shoulder/hip roll about z. */
  armAbduction: number;
  legAbduction: number;
  /** The arm abduction the rig shows at joint angle 0 (rad, ≤ armAbduction). */
  armDisplayAbduction: number;
  face: FaceAnchors;
  arms: [ArmAnchors, ArmAnchors];
  legs: [LegAnchors, LegAnchors];
  /** Wave V lane P: the final symmetry step's record (see finalSymmetryPass). */
  symmetry: SymmetryRecord;
  /**
   * Wave V lane P: the RENDERED skin's tree — `root` plus the seeded natural asymmetry. `root` stays
   * the exact mirror and is what the physics reads (Hitboxes, the ragdoll, the abduction solves):
   * the combat-capsule fit is so sensitive that a 0.4 % thigh girth change moved a fitted torso
   * capsule enough to swing a thrust's hand-to-torso clearance 32 -> -13 mm (measured), so the
   * asymmetry is a LOOK, never a physical property. Equal to `root` when the asymmetry is off.
   */
  skinRoot: SdfNode;
  /**
   * Wave X lane B: the rendered skin's physique sculpt (Physique.ts) — deltoid caps, abs, slimming,
   * the rare fat belly, the male bulge. null when the sculpt was off (QA / the reference forms).
   */
  physique: PhysiqueRecord | null;
  /** Wave X lane B: the rendered skin's polygonising box (= bounds, grown by whole cells where the sculpt stands proud). */
  skinBounds: Bounds;
}

/** What the final symmetry step found and did. */
export interface SymmetryRecord {
  /** Left/right primitive pairs found (ids ending L / R with the same stem). */
  pairs: number;
  /**
   * Largest left-vs-mirrored-right difference BEFORE the mirror was enforced, relative to the
   * pair's size (|Δparam| / max(r, size), max over pairs and params). 0 = already mirrored.
   */
  mirrorDeviationBefore: number;
  /** The seeded asymmetry re-applied (null = the pass ran with asymmetry off). */
  asymmetry: BilateralAsymmetry | null;
  /** Primitives the asymmetry rescaled. */
  scaled: number;
}

/** Options of anatomyFor (QA / measurement). */
export interface AnatomyOptions {
  /** Re-apply the seeded natural asymmetry after the mirror (default true). */
  asymmetry?: boolean;
  /** Run the final symmetry step at all (default true; false = the raw tree, for measurement). */
  symmetryPass?: boolean;
  /**
   * Wave X lane B: sculpt the RENDERED skin (Physique.sculptSkin; default true). false = the pre-wave
   * skin (before/after measurement); an object turns single parts off or forces the fat belly.
   */
  physique?: boolean | PhysiqueOptions;
}

const SIDES: [1, -1] = [1, -1];

/**
 * Half the gap between two solids along a set of probe rays: min over the probes of
 * max(dA, dB). At the midpoint of a gap g both distances equal g/2, so this is g/2; where
 * the solids touch it is ≤ 0.
 */
function halfGap(a: BodyField, b: BodyField, probes: Vec3[]): number {
  const sa: SdfSample = { d: 0, region: 0, bone: 0 }, sb: SdfSample = { d: 0, region: 0, bone: 0 };
  let best = Infinity;
  for (const p of probes) {
    const v = Math.max(a.sample(p[0], p[1], p[2], sa).d, b.sample(p[0], p[1], p[2], sb).d);
    if (v < best) best = v;
  }
  return best;
}

/** Bisection for the smallest angle in [lo, hi] whose clearance test passes. */
function solveAbduction(lo: number, hi: number, clear: (a: number) => boolean): number {
  if (clear(lo)) return lo;
  if (!clear(hi)) return hi;
  for (let i = 0; i < ABDUCTION_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (clear(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

/** Half-gap two blended limbs must keep: max(k, MIN_GAP_CELLS·cell) / 2 (see module comment). */
function neededHalfGap(k: number, cell: number): number {
  return Math.max(k, MIN_GAP_CELLS * cell) / 2;
}

/** Leg spread: probes on the midplane x = 0 from below the crotch to the knee. */
function solveLegs(P: BodyProportions, kHip: number): number {
  const h = P.head, c = P.cell;
  const need = neededHalfGap(kHip, c);
  const probes: Vec3[] = [];
  for (let y = P.y.crotch - 0.35 * h; y > P.y.knee; y -= c) for (let z = -0.3 * h; z <= 0.3 * h; z += 0.5 * c) probes.push([0, y, z]);
  return solveAbduction(LEG_ABDUCTION_RANGE[0], LEG_ABDUCTION_RANGE[1], (beta) => {
    const L = compileSdf(legNode(P, 1, beta).node), R = compileSdf(legNode(P, -1, beta).node);
    return halfGap(L, R, probes) >= need;
  });
}

/**
 * Arm spread: probe rays from the arm axis toward the body, from `from` metres down the arm
 * to the fingertip; passes when the half-gap is at least `need`.
 */
function solveArms(P: BodyProportions, body: BodyField, need: number, from: number, hi = ARM_ABDUCTION_RANGE[1]): number {
  const c = P.cell, h = P.head;
  return solveAbduction(ARM_ABDUCTION_RANGE[0], hi, (alpha) => {
    const { node, anchors } = armNode(P, 1, alpha);
    const arm = compileSdf(node);
    const { d, o } = anchors.frame;
    const total = P.upperArm + P.foreArm + P.hand;
    const probes: Vec3[] = [];
    for (let s = from; s <= total; s += c) {
      const axis: Vec3 = [anchors.shoulder[0] + d[0] * s, anchors.shoulder[1] + d[1] * s, anchors.shoulder[2]];
      for (const fz of [-0.5, 0, 0.5]) {
        for (let t = 0; t < 0.8 * h + 3 * c; t += 0.5 * c) probes.push([axis[0] - o[0] * t, axis[1] - o[1] * t, axis[2] + fz * t]);
      }
    }
    return halfGap(arm, body, probes) >= need;
  });
}

/** Head-unit jitter from the seed: two fighters of one race differ in nose and jaw. */
function seedJitter(seed: number): { nose: number; jaw: number } {
  const r = rng32(seed);
  return { nose: 1 + (r() - 0.5) * 0.16, jaw: 1 + (r() - 0.5) * 0.1 };
}

/** The sculpt strokes: every BrushKind at least once, each with its anatomical purpose. */
function strokesFor(P: BodyProportions, t: ReturnType<typeof torsoNode>, face: FaceAnchors, arms: ArmAnchors[], legs: LegAnchors[]): BrushStroke[] {
  const h = P.head, c = P.cell, y = P.y;
  const out: BrushStroke[] = [];
  for (const [i, leg] of legs.entries()) {
    const side = i === 0 ? "left" : "right";
    out.push({ kind: "inflate", centre: [leg.knee[0], leg.knee[1], leg.knee[2] + P.radius.knee], radius: 0.25 * h, strength: 0.05 * h, purpose: `${side} kneecap (patella) prominence` });
    out.push({ kind: "pinch", centre: [leg.ankle[0], 1.1 * P.y.ankle, leg.heelBack[2] + 0.05 * h], radius: Math.min(0.22 * h, P.y.ankle), strength: 0.05 * h, purpose: `${side} Achilles tendon above the heel` });
    out.push({ kind: "bend", centre: [leg.ball[0], 0, leg.ball[2]], radius: 0.45 * P.foot, axis: [1, 0, 0], strength: -0.04 * h, purpose: `${side} toe spring (toes curl up off the ground)` });
    out.push({ kind: "flatten", centre: [leg.ankle[0], 0, (leg.heelBack[2] + leg.toeTip[2]) / 2], radius: 0.6 * P.foot, axis: [0, -1, 0], strength: SOLE_FLATTEN_CELLS * c, purpose: `${side} sole contact plane` });
  }
  out.push({ kind: "deflate", centre: [0, y.waist, t.backZ], radius: 0.5 * h, strength: 0.05 * h, purpose: "lumbar hollow (lower-back lordosis)" });
  const sacrumZ = -0.03 * h - P.halfDepth.pelvis + 0.04 * h;
  out.push({ kind: "flatten", centre: [0, y.pelvis + 0.1 * h, sacrumZ], axis: [0, 0, -1], radius: 0.35 * h, strength: 0.04 * h, purpose: "sacral plane above the gluteal cleft" });
  out.push({ kind: "dig", centre: [t.sternalNotch[0], t.sternalNotch[1] + 0.05 * h, t.sternalNotch[2] + 0.05 * h], radius: 0.24 * h, strength: Math.max(0.08 * h, 0.9 * c), purpose: "suprasternal (clavicle) notch" });
  out.push({ kind: "crease", centre: [0, (y.ribBottom + y.shoulder) / 2, t.backZ], axis: [0, 1, 0], radius: 0.9 * h, strength: 0.04 * h, purpose: "spinal furrow between the erector spinae" });
  out.push({ kind: "pushPull", centre: [0, face.brow[0][1], face.brow[0][2]], axis: [0, 0, 1], radius: 0.28 * h, strength: 0.03 * h, purpose: "brow ridge forward of the eyes" });
  if (P.underbite > 0) {
    out.push({ kind: "pushPull", centre: face.chin, axis: [0, 0, 1], radius: 0.3 * h, strength: P.underbite * 0.12 * h, purpose: "underbite: lower jaw forward of the upper teeth" });
  }
  for (const [i, arm] of arms.entries()) {
    const side = i === 0 ? "left" : "right";
    const mid: Vec3 = [(arm.elbow[0] + arm.wrist[0]) / 2, (arm.elbow[1] + arm.wrist[1]) / 2, (arm.elbow[2] + arm.wrist[2]) / 2];
    // Mirror symmetry: a twist about the mirrored axis must turn the opposite way (σ·strength).
    const sigma = Math.sign(arm.shoulder[0]);
    out.push({ kind: "twist", centre: mid, axis: arm.frame.d, radius: 0.5 * P.foreArm, strength: sigma * 0.06 * h, purpose: `${side} forearm pronation (radius over ulna)` });
    const pit: Vec3 = [Math.sign(arm.shoulder[0]) * P.halfWidth.chest * 0.95, y.shoulder - 0.45 * h, -0.05 * h];
    out.push({ kind: "smooth", centre: pit, radius: 0.4 * h, strength: 0.08 * h, purpose: `${side} armpit (axilla) relax` });
  }
  return out;
}

/** The flatten stroke presses at most this many cells off the sole plane. */
export const SOLE_FLATTEN_CELLS = 1;

/** Contract entry point: the whole body plan for a spec (see the module comment). */
export function anatomyFor(spec: BodySpec, opts: AnatomyOptions = {}): DetailedAnatomy {
  const P = proportionsFor(spec);
  const asym = opts.asymmetry === false ? null : bilateralAsymmetry(spec.seed);
  const pass = opts.symmetryPass !== false;
  const phys = opts.physique === false ? null : opts.physique === true || opts.physique === undefined ? {} : opts.physique;
  const first = buildPlan(P, spec.seed, asym, pass, phys);
  // Refine the cell from the measured sign-change count at COARSE_FACTOR × the first estimate.
  const coarse = COARSE_FACTOR * P.cell;
  // Wave V lane B: count on the REFERENCE (pre-wave) forms so surface detail never moves the cell
  // (and with it every cell-scaled gap, the solved abductions and the grid phase of the pins).
  const ref = referenceForms(() => buildPlan(P, spec.seed, asym, pass, null));
  const edges = countSignChanges(applyFieldBrushes(compileSdf(ref.root), ref.strokes), ref.bounds, coarse);
  const cell = Math.min(CELL_MAX, Math.max(CELL_MIN, coarse * Math.sqrt(2 * edges / TRIANGLE_TARGET)));
  if (Math.abs(cell - P.cell) <= CELL_TOLERANCE * P.cell) return first;
  // Every cell-dependent size (gaps, minimum feature thickness, bounds) is rebuilt.
  return buildPlan({ ...P, cell }, spec.seed, asym, pass, phys);
}

/** Assemble the plan for fixed proportions (the cell is part of the proportions). */
function buildPlan(P: BodyProportions, seed: number, asym: BilateralAsymmetry | null, pass = true, phys: PhysiqueOptions | null = {}): DetailedAnatomy {
  const h = P.head, c = P.cell, R = P.radius;
  const jitter = seedJitter(seed);

  const head = headNode(P, jitter);
  const torso = torsoNode(P);
  const neck = neckNode(P);
  const kNeckHead = blendWidth(P.halfWidth.neck, P.halfWidth.skull);
  const kNeckTorso = blendWidth(P.halfWidth.neck, P.halfWidth.chest);
  const trunk = op("smoothUnion", kNeckTorso, torso.node, op("smoothUnion", kNeckHead, neck, head.node));

  const kHip = blendWidth(R.thighTop, P.halfWidth.hip);
  const legAbduction = solveLegs(P, kHip);
  const legs = SIDES.map((s) => legNode(P, s, legAbduction));
  const lower = op("smoothUnion", kHip, trunk, legs[0].node, legs[1].node);

  const kShoulder = blendWidth(R.deltoid, P.halfWidth.chest);
  const lowerField = compileSdf(lower);
  // Bind: clear the whole arm below the deltoid (the armpit fold above it is meant to blend).
  const armAbduction = solveArms(P, lowerField, neededHalfGap(kShoulder, c), 0.45 * P.upperArm);
  // Display: forearm and hand clear the hips and thighs by a small margin when lowered.
  const armDisplayAbduction = solveArms(P, lowerField, DISPLAY_CLEARANCE_CELLS * c / 2, P.upperArm, armAbduction);
  const arms = SIDES.map((s) => armNode(P, s, armAbduction));
  const bones = bonesFor(P, head.face, arms.map((a) => a.anchors), legs.map((l) => l.anchors), torso.backZ);
  // Wave V lane P: the FINAL symmetry step — enforce the mirror, then the seeded natural asymmetry.
  const rawBody = op("smoothUnion", kShoulder, lower, arms[0].node, arms[1].node);
  const sym = pass ? finalSymmetryPass(rawBody, bones, asym, P)
    : { node: rawBody, mirrored: rawBody, record: { pairs: 0, mirrorDeviationBefore: Number.NaN, asymmetry: null, scaled: 0 } };
  const body = sym.mirrored;

  // Wave X lane B: the physique sculpt rewrites ONLY the rendered skin (Physique.ts has the why).
  const sculpt = phys ? sculptSkin(sym.node, P, bones, phys) : null;
  // The ground: the half-space y ≥ 0 as a box whose bottom face is the plane y = 0.
  const raw = nodeBounds(body);
  const span = Math.max(raw.max[0] - raw.min[0], raw.max[2] - raw.min[2], P.y.crown) + 1;
  const ground = prim("groundHalfSpace", "roundBox", "root", "sole", [0, span, 0], { size: [span, span, span], r: 0.001 });
  const root: SdfNode = op("intersect", 0, body, ground);
  const skinRoot: SdfNode = sculpt ? op("intersect", 0, sculpt.node, ground)
    : sym.node === sym.mirrored ? root : op("intersect", 0, sym.node, ground);

  const strokes = strokesFor(P, torso, head.face, arms.map((a) => a.anchors), legs.map((l) => l.anchors));
  const pad = BOUNDS_PAD_CELLS * c + brushReach(strokes);
  // Grid rows straddle y = 0 at ±c/2, so the sole plane falls mid-edge, never on a corner.
  // Columns are mirror-symmetric about x = 0 (corners at ±(i + ½)·c, an odd cell count), so
  // the left and right limbs sample the same field values and polygonise as mirror images.
  const halfCells = Math.ceil(Math.max(-raw.min[0], raw.max[0]) / c + pad / c);
  const bounds: Bounds = {
    min: [-(halfCells + 0.5) * c, -(BOUNDS_PAD_CELLS + 0.5) * c, raw.min[2] - pad],
    max: [(halfCells + 0.5) * c - 1e-9, Math.min(raw.max[1], P.y.crown + h) + pad, raw.max[2] + pad],
  };
  // Wave X lane B: the sculpted skin may stand proud of the physics body (a fat belly, the bulge, a
  // deltoid cap). The SKIN's polygonising box grows by WHOLE cells where it must (the grid phase and
  // the physics' own box — Hitboxes voxelises plan.bounds — stay exactly as before).
  const skinBounds: Bounds = { min: [...bounds.min], max: [...bounds.max] };
  if (sculpt) {
    const sb = nodeBounds(sculpt.node);
    for (let k = 0; k < 3; k++) {
      const lo = sb.min[k] - BOUNDS_PAD_CELLS * c, hi = sb.max[k] + BOUNDS_PAD_CELLS * c;
      if (k !== 1 && lo < skinBounds.min[k]) skinBounds.min[k] -= Math.ceil((skinBounds.min[k] - lo) / c) * c;
      if (hi > skinBounds.max[k]) skinBounds.max[k] += Math.ceil((hi - skinBounds.max[k]) / c) * c;
    }
    // x stays mirror-symmetric about 0 (an odd cell count): take the wider side for both.
    const hx = Math.max(-skinBounds.min[0], skinBounds.max[0] + 1e-9);
    skinBounds.min[0] = -hx; skinBounds.max[0] = hx - 1e-9;
  }

  return {
    root, strokes, bones, bounds, cell: c,
    proportions: P, armAbduction, legAbduction, armDisplayAbduction, face: head.face,
    arms: [arms[0].anchors, arms[1].anchors], legs: [legs[0].anchors, legs[1].anchors],
    symmetry: sym.record, skinRoot, physique: sculpt?.record ?? null, skinBounds,
  };
}

// ---------------------------------------------------------------------------------------------
// Wave V lane P — the final symmetry step (BodyProfile.bilateralAsymmetry has the WHY).

/** Mirror of a primitive across the plane x = 0 (XYZ Euler: rx, −ry, −rz). */
function mirrorPrimitive(p: Primitive, id: string): Primitive {
  const m = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];
  return {
    ...p, id, a: m(p.a), ...(p.b ? { b: m(p.b) } : {}), ...(p.size ? { size: [p.size[0], p.size[1], p.size[2]] as Vec3 } : {}),
    ...(p.rot ? { rot: [p.rot[0], -p.rot[1], -p.rot[2]] as Vec3 } : {}),
    bone: (p.bone.endsWith("L") ? `${p.bone.slice(0, -1)}R` : p.bone.endsWith("R") ? `${p.bone.slice(0, -1)}L` : p.bone) as BoneId,
  };
}

/** Mean of two primitives' numeric parameters (same kind and topology). */
function meanPrimitive(a: Primitive, b: Primitive): Primitive {
  const v = (x: Vec3, y: Vec3): Vec3 => [(x[0] + y[0]) / 2, (x[1] + y[1]) / 2, (x[2] + y[2]) / 2];
  return {
    ...a, a: v(a.a, b.a), r: (a.r + b.r) / 2,
    ...(a.b && b.b ? { b: v(a.b, b.b) } : {}), ...(a.r2 !== undefined && b.r2 !== undefined ? { r2: (a.r2 + b.r2) / 2 } : {}),
    ...(a.size && b.size ? { size: v(a.size, b.size) } : {}), ...(a.rot && b.rot ? { rot: v(a.rot, b.rot) } : {}),
  };
}

/** Columns of the rotation matrix of an XYZ Euler (THREE: M = Rx·Ry·Rz), row-major 3×3. */
function eulerMatrix(r: Vec3 | undefined): number[] {
  const [x, y, z] = r ?? [0, 0, 0];
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  return [c * e, -c * f, d, a * f + b * e * d, a * e - b * f * d, -b * c, b * f - a * e * d, b * e + a * f * d, a * c];
}

/**
 * Largest |Δ| of two primitives' parameters relative to the primitive's size; orientations are
 * compared as principal AXES up to sign (an ellipsoid / box turned 180° about an axis is the same
 * solid, and the parts builder writes some mirrored ears that way).
 */
function primitiveDeviation(a: Primitive, b: Primitive): number {
  const scale = Math.max(1e-6, a.r, ...(a.size ?? [0]), a.r2 ?? 0);
  let d = Math.abs(a.r - b.r);
  const vd = (x?: Vec3, y?: Vec3) => { if (x && y) for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(x[k] - y[k])); };
  vd(a.a, b.a); vd(a.b, b.b); vd(a.size, b.size);
  if (a.r2 !== undefined && b.r2 !== undefined) d = Math.max(d, Math.abs(a.r2 - b.r2));
  let rd = 0;
  if (a.rot || b.rot) {
    const ma = eulerMatrix(a.rot), mb = eulerMatrix(b.rot);
    for (let k = 0; k < 3; k++) rd = Math.max(rd, 1 - Math.abs(ma[k] * mb[k] + ma[3 + k] * mb[3 + k] + ma[6 + k] * mb[6 + k]));
  }
  return Math.max(d / scale, rd);
}

/** A pair whose deviation is under this is already a mirror and is left exactly as built. */
export const MIRROR_TOLERANCE = 1e-9;

/** Which asymmetry dimension a primitive belongs to, and whether it scales about its BONE line. */
function asymmetryClass(p: Primitive): { key: keyof Omit<BilateralAsymmetry, "dominant">; aboutBone: boolean } | null {
  if ((p.bone === "shoulderL" || p.bone === "shoulderR") && p.region === "upperArm") return { key: "arm", aboutBone: true };
  if ((p.bone === "elbowL" || p.bone === "elbowR") && p.region === "foreArm") return { key: "foreArm", aboutBone: true };
  if ((p.bone === "hipL" || p.bone === "hipR") && p.region === "thigh") return { key: "thigh", aboutBone: true };
  if ((p.bone === "kneeL" || p.bone === "kneeR") && p.region === "shin") return { key: "shin", aboutBone: true };
  if (p.region === "torso" && /^(pectoral|scapula)[LR]$/.test(p.id)) return { key: "chest", aboutBone: false };
  if (p.region === "face" && /^(cheekbone|jaw|browRidge)[LR]$/.test(p.id)) return { key: "face", aboutBone: false };
  return null; // hands, feet, soles, ears, neck, everything central: untouched
}

/**
 * Scale a primitive's GIRTH by s: about the bone line (limbs: every point's offset from its
 * projection on head->tail scales by s, so the joints and the lengths along the bone stay) or
 * about its own centre (a muscle/face volume). Radii and sizes scale by s.
 */
function scalePrimitive(p: Primitive, s: number, bone: BoneSegment | null, taper: [number, number] | null = null): Primitive {
  // Fraction of the way along the bone (head 0 -> tail 1) and the girth scale there: s, easing
  // back to 1 over `taper` (bone fractions) so a distal joint (wrist, ankle) keeps its exact size.
  const frac = (v: Vec3): number => {
    if (!bone) return 0;
    const h = bone.head, d: Vec3 = [bone.tail[0] - h[0], bone.tail[1] - h[1], bone.tail[2] - h[2]];
    const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
    return ((v[0] - h[0]) * d[0] + (v[1] - h[1]) * d[1] + (v[2] - h[2]) * d[2]) / dd;
  };
  const sAt = (t: number): number => {
    if (!taper) return s;
    const u = Math.min(1, Math.max(0, (t - taper[0]) / Math.max(1e-9, taper[1] - taper[0])));
    return 1 + (s - 1) * (1 - u * u * (3 - 2 * u));
  };
  const about = (v: Vec3): Vec3 => {
    if (!bone) return v;
    const h = bone.head, t = frac(v), k = sAt(t);
    const q: Vec3 = [h[0] + t * (bone.tail[0] - h[0]), h[1] + t * (bone.tail[1] - h[1]), h[2] + t * (bone.tail[2] - h[2])];
    return [q[0] + k * (v[0] - q[0]), q[1] + k * (v[1] - q[1]), q[2] + k * (v[2] - q[2])];
  };
  const ta = frac(p.a), tb = p.b ? frac(p.b) : ta, tc = (ta + tb) / 2;
  const sc = sAt(tc);
  return {
    ...p, a: about(p.a), ...(p.b ? { b: about(p.b) } : {}), r: p.r * sAt(ta),
    ...(p.r2 !== undefined ? { r2: p.r2 * sAt(tb) } : {}),
    ...(p.size ? { size: [p.size[0] * sc, p.size[1] * sc, p.size[2] * sc] as Vec3 } : {}),
  };
}

/**
 * The final symmetry step of the generation: (1) every left/right primitive pair is made an exact
 * mirror (left := mean of left and mirrored right, right := mirror of left), measuring how far apart
 * they were; (2) the seeded natural asymmetry (BodyProfile.bilateralAsymmetry) rescales the girth of
 * the arm, forearm, chest, thigh, shin and face pairs with area-preserving pair scales. Returns a NEW
 * tree (the input primitives are never mutated). Joint positions and bone lengths never change.
 */
export function pairDeviations(root: SdfNode): { id: string; dev: number; l: Primitive; r: Primitive }[] {
  const prims = new Map<string, Primitive>();
  const collect = (n: SdfNode) => { if (n.type === "primitive") prims.set(n.primitive.id, n.primitive); else n.children.forEach(collect); };
  collect(root);
  const out: { id: string; dev: number; l: Primitive; r: Primitive }[] = [];
  for (const [id, pl] of prims) {
    if (!id.endsWith("L")) continue;
    const pr = prims.get(`${id.slice(0, -1)}R`);
    if (pr && pr.kind === pl.kind) out.push({ id, dev: primitiveDeviation(pl, mirrorPrimitive(pr, id)), l: pl, r: pr });
  }
  return out;
}

export function finalSymmetryPass(
  root: SdfNode, bones: readonly BoneSegment[], asym: BilateralAsymmetry | null, P?: BodyProportions,
): { node: SdfNode; mirrored: SdfNode; record: SymmetryRecord } {
  const prims = new Map<string, Primitive>();
  const collect = (n: SdfNode) => { if (n.type === "primitive") prims.set(n.primitive.id, n.primitive); else n.children.forEach(collect); };
  collect(root);
  const out = new Map<string, Primitive>();
  let pairs = 0, dev = 0;
  for (const [id, pl] of prims) {
    if (!id.endsWith("L")) continue;
    const pr = prims.get(`${id.slice(0, -1)}R`);
    if (!pr || pr.kind !== pl.kind) continue;
    pairs++;
    const mr = mirrorPrimitive(pr, id);
    const dv = primitiveDeviation(pl, mr);
    dev = Math.max(dev, dv);
    if (dv <= MIRROR_TOLERANCE) { out.set(id, pl); out.set(pr.id, pr); continue; } // already a mirror: untouched
    const left = meanPrimitive(pl, mr);
    out.set(id, left);
    out.set(pr.id, mirrorPrimitive(left, pr.id));
  }
  const rebuildWith = (m: Map<string, Primitive>) => {
    const rb = (n: SdfNode): SdfNode =>
      n.type === "primitive" ? (m.has(n.primitive.id) ? { type: "primitive", primitive: m.get(n.primitive.id)! } : n)
        : { ...n, children: n.children.map(rb) };
    return rb;
  };
  // Already a mirror everywhere: the physics tree is the input itself (byte-identical plan).
  const mirrored = dev <= MIRROR_TOLERANCE ? root : rebuildWith(out)(root);
  let scaled = 0;
  const skin = new Map(out);
  if (asym) {
    const boneOf = new Map(bones.map((b) => [b.id, b]));
    // Distal tapers (bone fractions): the forearm's girth eases back to 1 before the wrist (the hand
    // and its grip stay exact), the shin's before the ankle (the foot and sole contact stay exact).
    const wrist = P ? P.foreArm / (P.foreArm + P.hand) : 0.6;
    const TAPER: Partial<Record<string, [number, number]>> = { foreArm: [0.55 * wrist, wrist], shin: [0.6, 0.98] };
    for (const [id, p] of out) {
      const cls = asymmetryClass(p);
      if (!cls || asym[cls.key] === 0) continue;
      const [sl, sr] = pairScales(asym[cls.key]);
      skin.set(id, scalePrimitive(p, id.endsWith("L") ? sl : sr, cls.aboutBone ? boneOf.get(p.bone) ?? null : null, TAPER[cls.key] ?? null));
      scaled++;
    }
  }
  const node = scaled > 0 ? rebuildWith(skin)(root) : mirrored;
  return { node, mirrored, record: { pairs, mirrorDeviationBefore: dev, asymmetry: asym, scaled } };
}

/** One BoneSegment per JointName plus root, heads at the joint pivots, axes from the Skeleton. */
function bonesFor(P: BodyProportions, face: FaceAnchors, arms: ArmAnchors[], legs: LegAnchors[], backZ: number): BoneSegment[] {
  const h = P.head, y = P.y;
  const spineZ = 0.35 * backZ; // the column runs behind the body's centre line
  const skeleton = defaultHumanoid();
  const axisOf = (id: BoneId): "x" | "y" | "z" => (id === "root" ? "x" : skeleton.joint(id as JointName).axis);
  const seg: Record<BoneId, [Vec3, Vec3]> = {
    root: [[0, y.pelvis, 0], [0, y.abdomenPivot, spineZ]],
    spine: [[0, y.spinePivot, spineZ], [0, y.neckBase, -0.08 * h]],
    abdomen: [[0, y.abdomenPivot, spineZ], [0, y.pelvis, 0]],
    neck: [[0, y.neckBase, -0.08 * h], [0, y.headPivot, -0.04 * h]],
    head: [[0, y.headPivot, -0.04 * h], face.crown],
    shoulderL: [arms[0].shoulder, arms[0].elbow], shoulderR: [arms[1].shoulder, arms[1].elbow],
    elbowL: [arms[0].elbow, arms[0].fingertip], elbowR: [arms[1].elbow, arms[1].fingertip],
    hipL: [legs[0].hip, legs[0].knee], hipR: [legs[1].hip, legs[1].knee],
    kneeL: [legs[0].knee, legs[0].ankle], kneeR: [legs[1].knee, legs[1].ankle],
    ankleL: [legs[0].ankle, legs[0].ball], ankleR: [legs[1].ankle, legs[1].ball],
    toeL: [legs[0].ball, legs[0].toeTip], toeR: [legs[1].ball, legs[1].toeTip],
  };
  return BONE_IDS.map((id) => ({ id, parent: BONE_PARENT[id], head: seg[id][0], tail: seg[id][1], axis: axisOf(id) }));
}

/**
 * The bind-pose roll (rad, about +z) of a bone's frame relative to its parent: the
 * shoulders and hips carry the solved abduction (their −y axis points down the limb);
 * every other bone inherits its parent's frame (roll 0), exactly like Humanoid's pivots.
 */
export function boneBindRoll(plan: DetailedAnatomy, id: BoneId): number {
  if (id === "shoulderL") return plan.armAbduction;
  if (id === "shoulderR") return -plan.armAbduction;
  if (id === "hipL") return plan.legAbduction;
  if (id === "hipR") return -plan.legAbduction;
  return 0;
}

/** The roll the rig SHOWS at joint angle 0: the arms lowered to their display abduction. */
export function boneDisplayRoll(plan: DetailedAnatomy, id: BoneId): number {
  if (id === "shoulderL") return plan.armDisplayAbduction;
  if (id === "shoulderR") return -plan.armDisplayAbduction;
  return boneBindRoll(plan, id);
}
