// Body proportions (lane A, R03/R08): EVERY length, width and radius of the generated body,
// derived top-down from a BodySpec (height m, weight kg, race, sub-race) through named
// ratios. Pure module: no THREE.
//
// Derivation, in order (each step names its source):
//   1. head unit   h = height / headsTall,  headsTall = CANON_HEADS_TALL ·
//                  headToBody(human) / headToBody(race)              (RaceGenes ratios)
//   2. legs vs torso: below the chin B = height − h splits into the hip-joint height L and
//                  the torso T with L/T = CANON_LEG_TO_TORSO · legToTorso(race)/legToTorso(human)
//   3. leg chain   thigh : shin : foot = thighToShin : 1 : footToShin  (RaceGenes ratios),
//                  ankle height = ANKLE_PER_FOOT · foot, scaled so the chain fills L
//   4. torso landmarks: CANON_Y fractions between the hip joint and the neck base
//   5. arm chain   upperArm = CANON_UPPER_ARM_PER_TORSO · T · armToTorso(race)/armToTorso(human),
//                  foreArm = upperArm · (foreArm.y / upperArm.y)(race gene midpoints),
//                  hand = foreArm · CANON_HAND_PER_FOREARM · handToForearm(race)/(human)
//   6. widths      CANON_* (head units, human anthropometry) × the race's gene width ratio
//                  (part.x or part.z midpoint, race / human) × girth^exponent
//   7. girth       G = clamp(√(BMI / BMI_REFERENCE), GIRTH_MIN, GIRTH_MAX), BMI = weight/height²,
//                  BMI_REFERENCE = the default fighter (70 kg at 1.70 m)
//   8. grid cell   c = √(TRIS_PER_AREA_CELL2 · A / TRIANGLE_TARGET), A = DuBois body
//                  surface area (m²) — the cell that lands the mesh near its triangle budget.

import { ratioValue, resolvePartAxis } from "../../game/RaceGenes.ts";
import { RACE_SILHOUETTE, raceSilhouette } from "../../game/BodyProfile.ts";
import { raceBuild } from "../../game/RaceAppearance.ts";
import { clamp } from "../../core/MathCore.ts";
import type { BodySpec } from "./contracts.ts";

/** The canonical human figure is 7.5 head heights tall (Loomis' "ideal" adult). */
export const CANON_HEADS_TALL = 7.5;

/**
 * Landmark heights of the canonical human, in head heights above the sole. Read from the
 * 7.5-head canon and adult anthropometry (eye line at mid-head, nipples two heads down,
 * navel three, femoral head at 0.52 of stature).
 */
export const CANON_Y = {
  crown: 7.5, eye: 7.0, headPivot: 6.7, chin: 6.5, neckBase: 6.15, sternalNotch: 6.05,
  shoulder: 6.0, nipple: 5.5, spinePivot: 5.5, ribBottom: 4.95, abdomenPivot: 4.8,
  waist: 4.7, navel: 4.5, pelvis: 4.15, hipJoint: 3.9, crotch: 3.55,
} as const;

/** Hip-joint height over the torso (hip joint to chin) of the canon: 3.9 / (6.5 − 3.9). */
export const CANON_LEG_TO_TORSO = CANON_Y.hipJoint / (CANON_Y.chin - CANON_Y.hipJoint);
/** Ankle-joint height as a fraction of foot length (0.07 m over 0.26 m in adults). */
export const ANKLE_PER_FOOT = 0.27;
/** Humerus length over the torso (hip joint to chin): 0.31 m / 0.59 m in adults. */
export const CANON_UPPER_ARM_PER_TORSO = 0.523;
/** Hand (wrist to fingertip) over forearm length: 0.19 m / 0.27 m in adults. */
export const CANON_HAND_PER_FOREARM = 0.7;
/** Default fighter (Humanoid DEFAULT_APPEARANCE): 70 kg at 1.70 m → BMI 24.2 kg/m². */
export const BMI_REFERENCE = 70 / (1.7 * 1.7);
/** Girth clamp: a body never thinner than 0.8× or fatter than 1.35× the reference section. */
export const GIRTH_MIN = 0.8;
export const GIRTH_MAX = 1.35;
/** How much a race's muscle knob (BodyProfile) changes muscle masses: 1 + gain·(muscle − 1). */
export const MUSCLE_GAIN = 0.2;
/** Triangles a body should land near (the test budget is 12 000; this leaves headroom). */
export const TRIANGLE_TARGET = 9000;
/**
 * Surface Nets triangles per (area / cell²): 2 triangles per sign-change edge, and a surface
 * crosses on average E[|nx| + |ny| + |nz|] = 3/2 grid edges per cell² of area → 3.
 */
export const TRIS_PER_AREA_CELL2 = 3;
/** Cell clamp (m): finer wastes triangles, coarser loses the hands. */
export const CELL_MIN = 0.012;
export const CELL_MAX = 0.035;

/**
 * The shoulder joint sits at least this many upper-arm radii outside the ribcage's widest
 * half-width, so a broad race's arm hangs beside its chest instead of starting inside it.
 */
export const SHOULDER_OVERHANG = 0.35;

/** Canon half-widths (x), head heights: shoulder joint, ribcage, waist, hips, hip joint, neck, skull. */
export const CANON_HALF_WIDTH = {
  shoulderJoint: 0.8, chest: 0.64, waist: 0.56, hip: 0.72, hipJoint: 0.4, neck: 0.27, skull: 0.34,
} as const;
/** Canon half-depths (z), head heights. */
export const CANON_HALF_DEPTH = { chest: 0.47, belly: 0.44, pelvis: 0.47, skull: 0.42 } as const;
/** Canon limb radii and hand/foot half-sizes, head heights (adult anthropometry, lightly stylised). */
export const CANON_RADIUS = {
  deltoid: 0.27, upperArm: 0.23, upperArmDistal: 0.18, foreArm: 0.21, wrist: 0.13,
  palmHalfWidth: 0.2, palmHalfThickness: 0.11, thighTop: 0.37, thighDistal: 0.24, knee: 0.22,
  calf: 0.23, ankle: 0.15, footHalfWidth: 0.19, heel: 0.16,
} as const;

/** Exponent of girth per tissue: fat gathers at the belly, skulls and hands barely change. */
export const GIRTH_EXPONENT = { torso: 0.8, belly: 1.4, waist: 1.0, limb: 0.8, neck: 0.5, extremity: 0.3 } as const;

/** Every derived number of one body (metres unless stated). */
export interface BodyProportions {
  spec: BodySpec;
  /** Race actually used (an unknown race falls back to human). */
  race: string;
  headsTall: number;
  /** Head height h (crown to chin), the unit every canon number is measured in. */
  head: number;
  /** Girth multiplier G from BMI (dimensionless). */
  girth: number;
  /** Muscle-mass multiplier from the race's muscle knob (dimensionless). */
  muscle: number;
  /** Landmark heights above the sole. */
  y: { [K in keyof typeof CANON_Y]: number } & { knee: number; ankle: number };
  thigh: number; shin: number; foot: number; ankleHeight: number;
  upperArm: number; foreArm: number; hand: number;
  halfWidth: { [K in keyof typeof CANON_HALF_WIDTH]: number };
  halfDepth: { [K in keyof typeof CANON_HALF_DEPTH]: number };
  radius: { [K in keyof typeof CANON_RADIUS]: number };
  /** Ear length multiplier (RaceAppearance.earMul) and ork jaw jut (RaceAppearance.underbite). */
  earScale: number;
  underbite: number;
  /** DuBois body surface area (m²) and the derived polygonising cell (m). */
  surfaceArea: number;
  cell: number;
}

/** Midpoint of a race's gene range for part.axis (RaceGenes, metres at stature 1). */
function geneMid(part: string, axis: "x" | "y" | "z", race: string): number {
  const r = resolvePartAxis(part, axis, race);
  return (r.min + r.max) / 2;
}
/** A race's gene value relative to the human's (1 for humans). */
function geneRel(part: string, axis: "x" | "y" | "z", race: string): number {
  return geneMid(part, axis, race) / geneMid(part, axis, "human");
}
/** A named RaceGenes ratio of the race over the human's. */
function ratioRel(id: string, race: string): number {
  return ratioValue(id, {}, race) / ratioValue(id, {}, "human");
}

/** DuBois & DuBois (1916) body surface area, m², from weight (kg) and height (m). */
export function duBoisArea(weightKg: number, heightM: number): number {
  return 0.007184 * Math.pow(weightKg, 0.425) * Math.pow(heightM * 100, 0.725);
}

/** Derive every proportion of a body from its spec (see the module comment for the chain). */
export function proportionsFor(spec: BodySpec): BodyProportions {
  const race = spec.race in RACE_SILHOUETTE ? spec.race : "human";
  const sil = raceSilhouette(race, spec.subrace);
  const build = raceBuild(race, spec.subrace);
  const H = spec.height;

  // 1. Head unit.
  const headsTall = CANON_HEADS_TALL / ratioRel("headToBody", race);
  const h = H / headsTall;

  // 7. Girth and muscle.
  const bmi = spec.weight / (H * H);
  const G = clamp(Math.sqrt(bmi / BMI_REFERENCE), GIRTH_MIN, GIRTH_MAX);
  const muscle = 1 + MUSCLE_GAIN * (sil.muscle - 1);

  // 2. Hip-joint height vs torso below the chin.
  const chin = H - h;
  const legToTorso = CANON_LEG_TO_TORSO * ratioRel("legToTorso", race);
  const hipJoint = chin * legToTorso / (1 + legToTorso);
  const torso = chin - hipJoint;

  // 3. Leg chain (bind pose is straight; the small abduction is solved later in Anatomy).
  const t2s = ratioValue("thighToShin", {}, race);
  const f2s = ratioValue("footToShin", {}, race);
  const shin = hipJoint / (t2s + 1 + ANKLE_PER_FOOT * f2s);
  const thigh = shin * t2s;
  const foot = shin * f2s;
  const ankleHeight = ANKLE_PER_FOOT * foot;

  // 4. Torso landmarks between the hip joint and the neck base; the neck base hangs below
  //    the head pivot by the canon neck (0.55 h) scaled by the race's neck:head ratio.
  const headPivot = chin + (CANON_Y.headPivot - CANON_Y.chin) * h;
  const neckBase = headPivot - (CANON_Y.headPivot - CANON_Y.neckBase) * h * ratioRel("neckToHead", race);
  const span = neckBase - hipJoint;
  const canonSpan = CANON_Y.neckBase - CANON_Y.hipJoint;
  const at = (k: keyof typeof CANON_Y) => hipJoint + span * (CANON_Y[k] - CANON_Y.hipJoint) / canonSpan;
  const y = {
    crown: H, eye: H - (CANON_Y.crown - CANON_Y.eye) * h, headPivot, chin, neckBase,
    sternalNotch: at("sternalNotch"), shoulder: at("shoulder"), nipple: at("nipple"),
    spinePivot: at("spinePivot"), ribBottom: at("ribBottom"), abdomenPivot: at("abdomenPivot"),
    waist: at("waist"), navel: at("navel"), pelvis: at("pelvis"), hipJoint, crotch: at("crotch"),
    knee: ankleHeight + shin, ankle: ankleHeight,
  };

  // 5. Arm chain.
  const upperArm = CANON_UPPER_ARM_PER_TORSO * torso * ratioRel("armToTorso", race);
  const foreArm = upperArm * geneMid("foreArm", "y", race) / geneMid("upperArm", "y", race);
  const hand = foreArm * CANON_HAND_PER_FOREARM * ratioRel("handToForearm", race);

  // 6. Widths: canon × race gene ratio × girth^exponent.
  const g = (e: number) => Math.pow(G, e);
  const halfWidth = {
    shoulderJoint: CANON_HALF_WIDTH.shoulderJoint * h * (sil.shoulder / RACE_SILHOUETTE.human.shoulder) * g(GIRTH_EXPONENT.neck),
    chest: CANON_HALF_WIDTH.chest * h * geneRel("chest", "x", race) * g(GIRTH_EXPONENT.torso),
    waist: CANON_HALF_WIDTH.waist * h * geneRel("abdomen", "x", race) * g(GIRTH_EXPONENT.waist),
    hip: CANON_HALF_WIDTH.hip * h * geneRel("pelvis", "x", race) * g(GIRTH_EXPONENT.torso),
    hipJoint: CANON_HALF_WIDTH.hipJoint * h * geneRel("pelvis", "x", race) * g(GIRTH_EXPONENT.neck),
    neck: CANON_HALF_WIDTH.neck * h * geneRel("neck", "x", race) * g(GIRTH_EXPONENT.neck),
    // The skull's proportions relative to its own height (head.x / head.y, race over human).
    skull: CANON_HALF_WIDTH.skull * h * geneRel("head", "x", race) / geneRel("head", "y", race),
  };
  const halfDepth = {
    chest: CANON_HALF_DEPTH.chest * h * geneRel("chest", "z", race) * g(GIRTH_EXPONENT.torso),
    belly: CANON_HALF_DEPTH.belly * h * geneRel("abdomen", "z", race) * g(GIRTH_EXPONENT.belly),
    pelvis: CANON_HALF_DEPTH.pelvis * h * geneRel("pelvis", "z", race) * g(GIRTH_EXPONENT.torso),
    skull: CANON_HALF_DEPTH.skull * h * geneRel("head", "z", race) / geneRel("head", "y", race),
  };
  const limb = (k: keyof typeof CANON_RADIUS, part: string, e: number, m = 1) => CANON_RADIUS[k] * h * geneRel(part, "x", race) * g(e) * m;
  const radius = {
    deltoid: limb("deltoid", "upperArm", GIRTH_EXPONENT.limb, muscle),
    upperArm: limb("upperArm", "upperArm", GIRTH_EXPONENT.limb),
    upperArmDistal: limb("upperArmDistal", "upperArm", GIRTH_EXPONENT.limb),
    foreArm: limb("foreArm", "foreArm", GIRTH_EXPONENT.limb, muscle),
    wrist: limb("wrist", "foreArm", GIRTH_EXPONENT.extremity),
    palmHalfWidth: limb("palmHalfWidth", "hand", GIRTH_EXPONENT.extremity),
    palmHalfThickness: limb("palmHalfThickness", "hand", GIRTH_EXPONENT.extremity),
    thighTop: limb("thighTop", "thigh", GIRTH_EXPONENT.limb),
    thighDistal: limb("thighDistal", "thigh", GIRTH_EXPONENT.limb),
    knee: limb("knee", "shin", GIRTH_EXPONENT.extremity),
    calf: limb("calf", "shin", GIRTH_EXPONENT.limb, muscle),
    ankle: limb("ankle", "shin", GIRTH_EXPONENT.extremity),
    footHalfWidth: limb("footHalfWidth", "foot", GIRTH_EXPONENT.extremity),
    heel: limb("heel", "foot", GIRTH_EXPONENT.extremity),
  };

  // The shoulder joint never sits inside the ribcage: max(canon, chest + overhang · arm radius).
  halfWidth.shoulderJoint = Math.max(halfWidth.shoulderJoint, halfWidth.chest + SHOULDER_OVERHANG * radius.upperArm);

  // 8. Grid cell from the triangle budget and the DuBois area (a first estimate: Anatomy
  //    refines it from the measured sign-change count of the actual field).
  const surfaceArea = duBoisArea(spec.weight, H);
  const cell = clamp(Math.sqrt(TRIS_PER_AREA_CELL2 * surfaceArea / TRIANGLE_TARGET), CELL_MIN, CELL_MAX);

  return {
    spec, race, headsTall, head: h, girth: G, muscle, y,
    thigh, shin, foot, ankleHeight, upperArm, foreArm, hand,
    halfWidth, halfDepth, radius,
    earScale: build.earMul, underbite: build.underbite,
    surfaceArea, cell,
  };
}
