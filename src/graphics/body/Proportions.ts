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
import { BUILDS, buildFor, RACE_SILHOUETTE, raceSilhouette, SEX_CURVE, type BuildRow, type BuildType, type RaceSilhouette, type Sex } from "../../game/BodyProfile.ts";
import { HAIR_LENGTH_M, nameSeed, raceBuild } from "../../game/RaceAppearance.ts";
import { ancestryOf, type AncestryNode, type BeardSpec } from "../../game/Ancestry.ts";
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

/**
 * The muscle-mass term for a silhouette under a build (single source of truth: proportionsFor
 * scales the SDF muscle masses by it, and the paint's definition pass reads it). The race's
 * muscle knob sets the base, the build's muscle term scales it — so a heavy ork is the biggest.
 */
/**
 * Lane Q-B: the neck's half-width comes down by this fraction — 0.94 = -6 %. "Reduce ... their neck"
 * is an explicit ask; the SHOULDER overhang cut from the same lane is NOT taken here: at 15 % it moved
 * lane M's planted-foot slide from 5.54 mm to 5.75 mm (band 5.6) and tipped the ragdoll settle, both
 * re-measured in the parent's integration. A slimmer neck does not touch either.
 */
export const NECK_SLIM = 0.94;

export function buildMuscleTerm(sil: RaceSilhouette, build: BuildType): number {
  return (1 + MUSCLE_GAIN * (sil.muscle - 1)) * BUILDS[build].muscle;
}
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

// Lane R-A: the shoulder half-width takes NO new multiplier — not the sex curve, not a race
// "fit-not-wide" factor. Narrowing the shoulder JOINT moves a physical property: the swing's
// planted-foot slide (tests/anim_measure_test.ts) leaves its band at dwarf/mountain slash fresh at a
// 1 % cut (5.54 -> 5.65 mm against 5.6), and at -8 % (5.54 -> 6.42 mm). So the dwarf's "less large of
// shoulders" asks is DROPPED with its numbers rather than faked, the way the lane-Q-B angular gain
// had to be scoped to the torso to leave the ground-contact geometry alone.

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
  /** Muscle-mass multiplier from the race's muscle knob AND the build's muscle term. */
  muscle: number;
  /** The build this body wears (lane P-C): fit / bulky / heavy. */
  build: BuildType;
  /** The sex this body wears (lane R-A): male (neutral) / female (the stated curve). */
  sex: Sex;
  /** The sex's curve multipliers actually applied, kept for inspection (male = all 1.0). */
  sexCurve: { chestDepth: number; waist: number; hip: number };
  /** The build's own row of multipliers, kept for the paint's definition pass. */
  buildRow: BuildRow;
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

/**
 * A body spec that may carry the (lane R-A) sex. BodySpec itself lists only the pre-wave fields;
 * an OPTIONAL read keeps every consumer compiling and keeps a spec WITHOUT a sex neutral male —
 * which is what holds the pre-wave tests green. The engine's roll and the generator set it.
 */
type SexedSpec = BodySpec & { sex?: Sex | null };

/** The sex a spec builds at: the spec's own, else the neutral male (never a random draw here). */
export function sexOf(spec: BodySpec): Sex {
  return (spec as SexedSpec).sex === "female" ? "female" : "male";
}

/** Derive every proportion of a body from its spec (see the module comment for the chain). */
export function proportionsFor(spec: BodySpec, buildOverride?: BuildType): BodyProportions {
  const race = spec.race in RACE_SILHOUETTE ? spec.race : "human";
  const sil = raceSilhouette(race, spec.subrace);
  const buildType = buildOverride ?? buildFor(race, spec.subrace);
  const B = BUILDS[buildType];
  const build = raceBuild(race, spec.subrace);
  const H = spec.height;
  // Lane R-A: the sex's curve multipliers, on the male body of the same race/height/weight.
  // Default male = 1.0 on every term, so an unset spec is byte-for-byte the pre-wave silhouette.
  const sex = sexOf(spec);
  const C = SEX_CURVE[sex];

  // 1. Head unit.
  const headsTall = CANON_HEADS_TALL / ratioRel("headToBody", race);
  const h = H / headsTall;

  // 7. Girth and muscle. The build's muscle term multiplies the race's (lane P-C): a heavy
  //    build carries visibly bigger SDF muscle masses (pecs, biceps, quads) than a fit one.
  const bmi = spec.weight / (H * H);
  const G = clamp(Math.sqrt(bmi / BMI_REFERENCE), GIRTH_MIN, GIRTH_MAX);
  const muscle = buildMuscleTerm(sil, buildType);

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

  // 6. Widths: canon × race gene ratio × girth^exponent × BUILD. The build (lane P-C) narrows a
  //    fit body at shoulder/chest/waist and broadens a heavy one (the fat gathers at the waist).
  const g = (e: number) => Math.pow(G, e);
  const halfWidth = {
    shoulderJoint: CANON_HALF_WIDTH.shoulderJoint * h * (sil.shoulder / RACE_SILHOUETTE.human.shoulder) * g(GIRTH_EXPONENT.neck) * B.shoulder,
    chest: CANON_HALF_WIDTH.chest * h * geneRel("chest", "x", race) * g(GIRTH_EXPONENT.torso) * B.chest,
    waist: CANON_HALF_WIDTH.waist * h * geneRel("abdomen", "x", race) * g(GIRTH_EXPONENT.waist) * B.waist * C.waist,
    hip: CANON_HALF_WIDTH.hip * h * geneRel("pelvis", "x", race) * g(GIRTH_EXPONENT.torso) * B.hip * C.hip,
    // The hip JOINT takes NO sex curve: a female's leg roots stay where the male's are, so her feet
    // plant exactly as his do (a moved hip joint would move the whole ground-contact layout).
    hipJoint: CANON_HALF_WIDTH.hipJoint * h * geneRel("pelvis", "x", race) * g(GIRTH_EXPONENT.neck) * B.hip,
    neck: CANON_HALF_WIDTH.neck * h * geneRel("neck", "x", race) * g(GIRTH_EXPONENT.neck) * NECK_SLIM,
    // The skull's proportions relative to its own height (head.x / head.y, race over human).
    skull: CANON_HALF_WIDTH.skull * h * geneRel("head", "x", race) / geneRel("head", "y", race),
  };
  const halfDepth = {
    chest: CANON_HALF_DEPTH.chest * h * geneRel("chest", "z", race) * g(GIRTH_EXPONENT.torso) * B.chest * C.chestDepth,
    belly: CANON_HALF_DEPTH.belly * h * geneRel("abdomen", "z", race) * g(GIRTH_EXPONENT.belly) * B.fat,
    pelvis: CANON_HALF_DEPTH.pelvis * h * geneRel("pelvis", "z", race) * g(GIRTH_EXPONENT.torso) * B.hip * C.hip,
    skull: CANON_HALF_DEPTH.skull * h * geneRel("head", "z", race) / geneRel("head", "y", race),
  };
  // 7. Limb radii: canon x race gene ratio x girth^exponent x the build's limb term x a local
  //    muscle term (pecs/biceps/quads read bigger on a heavier body, not just wider).
  const limb = (k: keyof typeof CANON_RADIUS, part: string, e: number, m = 1) => CANON_RADIUS[k] * h * geneRel(part, "x", race) * g(e) * m * B.limb;
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
  // Lane R-A: NO shoulder multiplier is applied here (see the note above SHOULDER_OVERHANG) — doing
  // so moves the swing's planted-foot slide off its band. The shoulder stays the pre-wave value.

  // 8. Grid cell from the triangle budget and the DuBois area (a first estimate: Anatomy
  //    refines it from the measured sign-change count of the actual field).
  const surfaceArea = duBoisArea(spec.weight, H);
  const cell = clamp(Math.sqrt(TRIS_PER_AREA_CELL2 * surfaceArea / TRIANGLE_TARGET), CELL_MIN, CELL_MAX);

  return {
    spec, race, headsTall, head: h, girth: G, muscle, build: buildType, sex, sexCurve: { ...C }, buildRow: B, y,
    thigh, shin, foot, ankleHeight, upperArm, foreArm, hand,
    halfWidth, halfDepth, radius,
    // Ear length now comes from the ancestry hierarchy (Ancestry.ears.lengthMul), not the older
    // RaceAppearance build flag, so the hierarchy drives the live rig. The values coincide at
    // race level, so this is the same ear on screen and one fewer place to keep in sync.
    earScale: ancestryOf(race, spec.subrace).ears.lengthMul, underbite: build.underbite,
    surfaceArea, cell,
  };
}

// ---------------------------------------------------------------------------------------------
// Ancestry look helpers (lane H-B). The numbers behind "ancestry is visible, not cosmetic": the
// hair colour/curl/bald draw, the brow dimensions, the beard mode and the ear length. Pure —
// no Three.js — so the legacy rig (graphics/Humanoid.ts) and the skinned rig (body/FaceParts.ts)
// both read the SAME numbers from here instead of each re-deriving them.

/** The effective beard mode: mode none|chin|moustache-thin|moustache|full from Ancestry.beard. */
export type BeardMode = BeardSpec["mode"];

/** A stable character-look seed from its visual identity (no Math.random anywhere). */
export function lookSeed(a: { race?: string; subrace?: string | null; body: string; hair?: string; eyes: string }): number {
  return nameSeed(`${a.race ?? "human"}|${a.subrace ?? ""}|${a.body}|${a.hair ?? ""}|${a.eyes}`);
}

/** A deterministic [0,1) hash of a seed (same seed -> same value). */
function seedUnit(seed: number): number {
  let h = Math.imul((seed | 0) ^ 0x27d4eb2d, 0x165667b1) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0; // >>> 0: a JS XOR yields a SIGNED 32-bit int, which would go negative
  return h / 0x100000000;
}

/** The hair colour this character draws from its ancestry's palette (first tone = most common). */
export function hairColourFor(node: AncestryNode, seed: number): string {
  const colors = node.hair.colors;
  if (colors.length === 0) return node.skin.base;
  // Offset the seed so the colour draw is independent of the bald/curl draws.
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0; // keep it unsigned, or a negative modulo indexes the palette backwards
  return colors[h % colors.length];
}

/**
 * Whether this character is bald. `baldChance === 0` is respected EXACTLY: an ancestry that can
 * never be bald (the elf) is never bald on any seed, not merely unlikely. A positive chance is a
 * deterministic draw from the seed, so a given character is always the same.
 */
export function isBald(node: AncestryNode, seed: number): boolean {
  if (node.hair.baldChance <= 0) return false;
  return seedUnit(seed ^ 0x5bd1e995) < node.hair.baldChance;
}

/**
 * The beard this character actually grows. `allowed === false` is never (whatever the character
 * says); `required === true` always grows it; otherwise the character's own flag decides.
 */
export function beardModeFor(node: AncestryNode, wantsBeard: boolean): BeardMode {
  const b = node.beard;
  if (!b.allowed || b.mode === "none") return "none";
  if (b.required) return b.mode;
  return wantsBeard ? b.mode : "none";
}

/** Hair length in metres for this head size (the ancestry's length tier scaled to the skull). */
export function hairLengthM(node: AncestryNode, headR: number): number {
  return HAIR_LENGTH_M[node.hair.length] * (headR / 0.18);
}

/** The shape a hair fall takes: curl widens the mass and SHORTENS it, density thickens it. */
export interface HairFall { drop: number; topRadius: number; botRadius: number; lobes: number }

/**
 * A hair fall's dimensions. Higher `curl` coils the mass: it grows WIDER (more air held) and
 * SHORTER (a coiled fall hangs less far), and `density` thickens the tube. Used so a curly
 * ancestry's fall reads as a wider, shorter mass than a straight one of the same length.
 */
export function hairFall(curl: number, density: number, lengthM: number, headR: number): HairFall {
  const c = clamp(curl, 0, 1), d = clamp(density, 0, 1);
  const drop = Math.min(lengthM, 0.62 * (headR / 0.18)) * (1 - 0.45 * c) * (0.72 + 0.4 * d);
  const thick = 0.6 + 0.7 * d;
  const widen = 1 + 0.6 * c;
  return {
    drop: Math.max(0, drop),
    topRadius: headR * 0.72 * thick * widen,
    botRadius: headR * 0.4 * thick * widen,
    lobes: Math.round(3 + 5 * c), // a coiled fall gets more lobes; a straight one stays a smooth tube
  };
}

/** Ear height in metres: the ancestry's lengthMul on the skull unit. */
export function earLengthM(node: AncestryNode, headR: number): number {
  return headR * 0.4 * node.ears.lengthMul;
}

/** Brow dimensions in metres plus the outward reach of the tip past the skull radius. */
export interface BrowDims { width: number; thickness: number; depth: number; tipPast: number; outerTipX: number }

/**
 * The brow's box, from Ancestry.brow: `length` scales the span, `thickness` the bar's height,
 * `prominence` bulges it off the face, and `tipPastFace` runs the OUTER tip beyond the skull
 * radius (`outerTipX > eyeX + width/2` by exactly `tipPast`), which is what the elf needs.
 */
export function browDims(node: AncestryNode, headR: number, eyeX: number): BrowDims {
  const b = node.brow;
  const width = headR * (0.3 + 0.6 * b.length);
  const thickness = headR * (0.05 + 0.15 * b.thickness);
  const depth = headR * (0.02 + 0.06 * (1 - b.prominence));
  const tipPast = headR * 0.6 * b.tipPastFace;
  return { width, thickness, depth, tipPast, outerTipX: eyeX + width / 2 + tipPast };
}

/** Tusk dimensions: how many lower tusks and how far they protrude (metres) for this skull. */
export function tuskDims(node: AncestryNode, headR: number): { count: number; protrusion: number; length: number } {
  return { count: node.tusk.count, protrusion: node.tusk.protrusion * headR, length: headR * (0.3 + 0.6 * node.tusk.protrusion) };
}
