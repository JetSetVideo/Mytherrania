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
import type { AnatomyPlan, BodySpec, BoneId, BoneSegment, Bounds, BrushStroke, SdfNode, SdfSample, Vec3 } from "./contracts.ts";
import { BONE_IDS, compileSdf, nodeBounds, type BodyField } from "./Sdf.ts";
import { applyFieldBrushes, brushReach } from "./Brushes.ts";
import { CELL_MAX, CELL_MIN, proportionsFor, TRIANGLE_TARGET, type BodyProportions } from "./Proportions.ts";
import { countSignChanges } from "./Polygonize.ts";
import {
  armNode, type ArmAnchors, blendWidth, type FaceAnchors, headNode, legNode, type LegAnchors, neckNode, op, prim, torsoNode,
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
export function anatomyFor(spec: BodySpec): DetailedAnatomy {
  const P = proportionsFor(spec);
  const first = buildPlan(P, spec.seed);
  // Refine the cell from the measured sign-change count at COARSE_FACTOR × the first estimate.
  const coarse = COARSE_FACTOR * P.cell;
  const edges = countSignChanges(applyFieldBrushes(compileSdf(first.root), first.strokes), first.bounds, coarse);
  const cell = Math.min(CELL_MAX, Math.max(CELL_MIN, coarse * Math.sqrt(2 * edges / TRIANGLE_TARGET)));
  if (Math.abs(cell - P.cell) <= CELL_TOLERANCE * P.cell) return first;
  // Every cell-dependent size (gaps, minimum feature thickness, bounds) is rebuilt.
  return buildPlan({ ...P, cell }, spec.seed);
}

/** Assemble the plan for fixed proportions (the cell is part of the proportions). */
function buildPlan(P: BodyProportions, seed: number): DetailedAnatomy {
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
  const body = op("smoothUnion", kShoulder, lower, arms[0].node, arms[1].node);

  // The ground: the half-space y ≥ 0 as a box whose bottom face is the plane y = 0.
  const raw = nodeBounds(body);
  const span = Math.max(raw.max[0] - raw.min[0], raw.max[2] - raw.min[2], P.y.crown) + 1;
  const ground = prim("groundHalfSpace", "roundBox", "root", "sole", [0, span, 0], { size: [span, span, span], r: 0.001 });
  const root: SdfNode = op("intersect", 0, body, ground);

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
  const bones = bonesFor(P, head.face, arms.map((a) => a.anchors), legs.map((l) => l.anchors), torso.backZ);
  return {
    root, strokes, bones, bounds, cell: c,
    proportions: P, armAbduction, legAbduction, armDisplayAbduction, face: head.face,
    arms: [arms[0].anchors, arms[1].anchors], legs: [legs[0].anchors, legs[1].anchors],
  };
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
