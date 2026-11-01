// Body profile: the proportion parameters that shape every part of a body, per race.
//
// A race is a SET OF NUMBERS, not a mesh. The numbers feed the shape equations
// (ShapeEquations.ts), which feed the loft builder (graphics/Loft.ts), which produces
// the surface. Change the numbers and the silhouette changes — which is what lets the
// generator roll a new character and still get a body worth looking at.
//
// The lists here are COMPLETE on purpose: every part, every state, every joint. Nothing
// is left to a default that a later caller has to guess.
//
// Pure module: no Three.js, no DOM.

import type { JointName } from "./Skeleton.ts";
import type { Lobe } from "./ShapeEquations.ts";

/** The parts a body is built from. Each is one lofted surface. */
export type BodyPartName =
  | "chest" | "abdomen" | "pelvis" | "neck" | "head"
  | "pectorals" | "scapulae"
  | "upperArm" | "foreArm" | "hand"
  | "thigh" | "shin" | "foot";

export const BODY_PARTS: BodyPartName[] = [
  "chest", "abdomen", "pelvis", "neck", "head",
  "pectorals", "scapulae",
  "upperArm", "foreArm", "hand", "thigh", "shin", "foot",
];

/**
 * Parts that hang off the torso. Only these scale with a race's `limbLength`; the torso,
 * neck, head and the two chest plates keep their baseline length so limb:torso can differ
 * between races.
 */
export const LIMB_PARTS: BodyPartName[] = ["upperArm", "foreArm", "hand", "thigh", "shin", "foot"];

/** The proportion knobs a race sets. All are multipliers on the human baseline. */
export interface RaceSilhouette {
  /** Overall stature: dwarves are the shortest, elves the tallest. */
  height: number;
  /** Across-the-body width: elves are the thinnest. */
  width: number;
  /** Front-to-back depth. */
  depth: number;
  /** How fast a limb drains toward its tip (higher = spindlier). */
  limbTaper: number;
  /**
   * Limb-length multiplier, applied to the limbs and NOT to the torso. This is the only
   * knob that can change limb:torso ratio: stature is one uniform scale on the whole rig,
   * so if every part keeps its baseline length a dwarf is a scaled-down human rather than
   * a short-limbed one. Optional, so a sub-race override may omit it and inherit its race.
   */
  limbLength: number;
  /** Muscle lobe amplitude multiplier. */
  muscle: number;
  /** Shoulder offset from the spine, in metres at 1.0 scale. */
  shoulder: number;
  /** Hip offset from the spine, in metres at 1.0 scale. */
  hip: number;
  /** Waist pinch depth, 0..1. */
  waist: number;
  /** Head size relative to the baseline. */
  head: number;
  /** Superellipse exponent: 2 is a clean oval, higher squares the section. */
  sectionN: number;
  /**
   * The UNGAINED section exponent (lane Q-B). `sectionN` carries the angular-side-plane gain and is used
   * by the torso; the limbs, hands and feet keep this one, so the angular change never moves a contact
   * surface (a foot's cross-section decides how the body settles on the ground). REQUIRED, and equal to
   * the row's own base exponent: an optional field here made `SILHOUETTE_TOP[key]` possibly-undefined
   * across every silhouette key (a type error the compiler caught, measured).
   */
  sectionNBase: number;
}

/**
 * Character sex (lane R-A). `male` is the NEUTRAL body — every curve term is exactly 1.0, so a male
 * body is the pre-wave silhouette and the "bulky is the neutral build" invariant is untouched.
 * `female` adds measured curves. The sex rides the profile AND the body spec and is read by
 * proportionsFor; it is NOT a build (it composes with fit/bulky/heavy).
 */
export type Sex = "male" | "female";

/** The two values, for a UI that must list them (lane R-C). */
export const SEXES: Sex[] = ["male", "female"];

/**
 * The female curve multipliers (lane R-A): each a stated multiplier on the MALE body of the same
 * race/height/weight (dimensionless; 1.0 = the male value). "make the female a bit more curvy": a
 * narrower waist relative to fuller hips, and a fuller bust. TORSO ONLY — the ground-contact radii
 * (ankle/foot/heel) and the hip JOINT never take these, so a female plants her feet where a male does.
 *
 * NO shoulder and NO rib-width term, on purpose: narrowing the shoulder JOINT moves a physical
 * property (the swing's planted-foot slide in tests/anim_measure_test.ts moves off its band even at
 * a 1 % cut — measured), and widening the ribcage would push the get-out-of-the-ribcage shoulder
 * overhang clamp out with it (which forces the shoulders back out, the opposite of the ask). Both are
 * scoped OUT here, the way the lane-Q-B angular gain had to be scoped to the torso.
 */
export interface SexCurve {
  /** Chest half-depth (the bust), × the male value. */
  chestDepth: number;
  /** Waist half-width, × the male value (the pinch is the ratio to the hips). */
  waist: number;
  /** Hip half-width AND pelvis half-depth, × the male value. */
  hip: number;
}

/** male is EXACTLY the pre-wave silhouette (1.0 on every term); female is the stated curve. */
export const SEX_CURVE: Record<Sex, SexCurve> = {
  male:   { chestDepth: 1.00, waist: 1.00, hip: 1.00 },
  female: { chestDepth: 1.12, waist: 0.80, hip: 1.09 },
};

/**
 * Wave S (lane S-B): "boys have a larger shoulder-to-hip ratio, and girls, they're more curvy" — the
 * shoulder-to-hip RATIO is made to differ by sex by a STATED amount, ON TOP of wave R's female curve.
 * The shoulder JOINT takes NO sex multiplier (a moved shoulder joint moves the swing's planted-foot
 * slide off its band — measured; the numbers live in the SHOULDER_OVERHANG note in
 * graphics/body/Proportions.ts), so the difference is realised through the HIP half-width (and the
 * pelvis half-depth), the same lever wave R already leans on. male = 1.0 (the neutral body, so the
 * pre-wave silhouette is untouched); female = the extra width her hips carry over SEX_CURVE.female.hip.
 * Effect: female shoulder-to-hip = male's ÷ (SEX_CURVE.female.hip · SEX_HIP_GAIN.female).
 */
export const SEX_HIP_GAIN: Record<Sex, number> = { male: 1.0, female: 1.06 };

/**
 * The four races' silhouettes. The brief's hard requirements live here:
 * the DWARF is the smallest (height 0.80) and the ELF the thinnest (width 0.84,
 * depth 0.88, muscle 0.68), with the ORK the heaviest (width 1.34).
 */
export const RACE_SILHOUETTE: Record<string, RaceSilhouette> = {
  human: { height: 1.0, width: 1.0, depth: 1.0, limbTaper: 1.0, limbLength: 1.0, muscle: 1.0, shoulder: 0.46, hip: 0.3, waist: 0.1, head: 1.0, sectionN: 2.1, sectionNBase: 2.1 },
  elf: { height: 1.05, width: 0.84, depth: 0.88, limbTaper: 1.25, limbLength: 1.06, muscle: 0.68, shoulder: 0.4, hip: 0.26, waist: 0.16, head: 0.98, sectionN: 1.9, sectionNBase: 1.9 },
  // Lane R-A: "make the dwarves a bit less large of shoulders and have a bigger fit". The dwarf's
  // muscle term goes UP (1.45 -> 1.60: the dwarf is FIT, not wide — the deltoid/chest mass radii
  // measure +2.6 mm at the reference build). The "less large of shoulders" half is DROPPED, not
  // faked: the dwarf's shoulder half-width is set by the rib-cage overhang clamp in Proportions
  // (its canon shoulder sits well below the clamp), so the row knob does nothing, and narrowing the
  // shoulder joint itself moves tests/anim_measure_test.ts's planted-foot slide off its band at
  // dwarf/mountain slash fresh (5.54 -> 6.42 mm against 5.6, measured; even a 1 % cut -> 5.65 mm).
  dwarf: { height: 0.8, width: 1.3, depth: 1.16, limbTaper: 0.78, limbLength: 0.82, muscle: 1.6, shoulder: 0.5, hip: 0.34, waist: 0.05, head: 1.12, sectionN: 2.35, sectionNBase: 2.35 },
  ork: { height: 1.12, width: 1.34, depth: 1.1, limbTaper: 0.85, limbLength: 0.94, muscle: 1.6, shoulder: 0.54, hip: 0.32, waist: 0.06, head: 1.08, sectionN: 2.4, sectionNBase: 2.4 },
};

// -------------------------------------------------------------------------------------------
// Body builds (lane P-C): "either fat or fit". Three explicit builds, each a row of measured
// multipliers on the race-derived radii plus a muscle and a fat term, and every ancestry mapped
// onto one. Composing with the race (never replacing it) is what keeps "dwarves are the shortest"
// while a heavy ork is still fatter than a fit high elf.

/** The three body builds: a fit body is lean and defined, a heavy one is fat, bulky sits between. */
export type BuildType = "fit" | "bulky" | "heavy";

/**
 * One build's measurable terms. Every radius term is a multiplier on the race-derived number,
 * so the ancestry sets the base silhouette and the build scales it (units: dimensionless, and
 * 1.0 = the race's own value). The tests rank the three rows on every term.
 */
export interface BuildRow {
  /** Half-width across the shoulder joints, × the race value. */
  shoulder: number;
  /** Chest half-width AND half-depth, × the race value. */
  chest: number;
  /** Waist half-width, × the race value. */
  waist: number;
  /** Hip half-width AND pelvis half-depth, × the race value. */
  hip: number;
  /** Limb radii (arms, thighs, shins, hands, feet), × the race value. */
  limb: number;
  /** Muscle-mass term on the SDF muscle masses (pectorals, biceps, quads, calves); > 1 = bigger. */
  muscle: number;
  /** Fat-mass term: fattens the belly and hips; 1.0 = no added fat. */
  fat: number;
}

/**
 * The three rows (lane P-C), ordered non-decreasing fit -> bulky -> heavy on EVERY term, and
 * strictly larger fit -> heavy. `bulky` is the neutral reference (1.0 on every term), so a
 * default bulky body is the pre-existing silhouette; the build only leans it. Cartoonish on
 * purpose: a heavy body's waist is 22% wider than a bulky one's and its belly 28% fuller.
 */
export const BUILDS: Record<BuildType, BuildRow> = {
  fit:   { shoulder: 0.95, chest: 0.93, waist: 0.88, hip: 0.95, limb: 0.95, muscle: 0.96, fat: 1.0 },
  bulky: { shoulder: 1.0,  chest: 1.0,  waist: 1.0,  hip: 1.0,  limb: 1.0,  muscle: 1.0,  fat: 1.0 },
  heavy: { shoulder: 1.10, chest: 1.12, waist: 1.22, hip: 1.10, limb: 1.10, muscle: 1.16, fat: 1.28 },
};

/**
 * Which build each of the 16 ancestry nodes wears. Orks (and the humans/dwarves that live hard —
 * the islander and the mountaineer) are heavy; dwarves and most elves/humans are bulky with real
 * muscle; the slim high and imperial lines are fit. Every key is an ancestry node id.
 */
export const BUILD_FOR: Record<string, BuildType> = {
  human: "bulky", imperial: "fit", nomad: "bulky", islander: "heavy",
  elf: "bulky", high: "fit", wood: "bulky", dark: "bulky",
  dwarf: "bulky", mountain: "heavy", forge: "bulky", deep: "bulky",
  ork: "heavy", greenhide: "bulky", ironhide: "heavy", bloodfang: "heavy",
};

/** The build for a race + sub-species: a sub-race's own row wins, else the race's, else bulky. */
export function buildFor(raceId: string, subraceId: string | null): BuildType {
  if (subraceId && BUILD_FOR[subraceId]) return BUILD_FOR[subraceId];
  return BUILD_FOR[raceId] ?? "bulky";
}

/** Sub-species nudge a race's silhouette without replacing it. */
export const SUBRACE_SILHOUETTE: Record<string, Partial<RaceSilhouette>> = {
  imperial: { width: 1.02 },
  nomad: { limbTaper: 1.12 },
  islander: { muscle: 0.94 },
  high: { height: 1.03, muscle: 0.9 },
  wood: { limbTaper: 1.1 },
  dark: { depth: 0.96 },
  mountain: { width: 1.1, muscle: 1.12 },
  forge: { width: 1.06, muscle: 1.08 },
  deep: { height: 0.96, depth: 1.05 },
  greenhide: { muscle: 0.95 },
  ironhide: { muscle: 1.08, width: 1.06 },
  bloodfang: { muscle: 1.12, sectionN: 2.45 },
};

// -------------------------------------------------------------------------------------------
// Angular side planes (lane Q-B). The torso's side profile must read as FLAT PLANES with corners
// instead of one round sweep. The lever is the section's SUPER-ELLIPSE EXPONENT (`sectionN`):
// BodySurface.stationsFor lofts every station with `n = s.sectionN`, so raising it squares the
// section — flatter sides meeting at a sharper corner — without touching a single half-width.
//
// The raise is RACE-RELATIVE: each race closes SECTION_PLANE_GAIN of the gap between its own
// exponent and PLANE_N_CEILING, so an elf (1.9 -> 2.175) stays slimmer than an ork (2.4 -> 2.425)
// while EVERY race gains the corners. 2.45 is the ceiling: the bloodfang's exponent and the
// "organic section" bound in tests/bodyshape_test.ts, so no race crosses it and no section turns
// a right angle (ShapeEquations.maxCorner).
export const PLANE_N_CEILING = 2.45;
/** Fraction of the gap to the squared-corner ceiling each race closes. 0 = the pre-wave round
 *  sweep, 1 = fully squared. Half the gap is a stated, measured raise, not a redesign. */
export const SECTION_PLANE_GAIN = 0.5;

/** The section exponent a race uses once the angular-plane gain is applied (race-relative). */
export function planeExponent(baseN: number): number {
  return baseN + SECTION_PLANE_GAIN * (PLANE_N_CEILING - baseN);
}

/** The effective silhouette for a race + sub-species, with the lane-Q-B angular-plane gain. */
export function raceSilhouette(raceId: string, subraceId: string | null): RaceSilhouette {
  const base = RACE_SILHOUETTE[raceId] ?? RACE_SILHOUETTE.human;
  const tweak = subraceId ? SUBRACE_SILHOUETTE[subraceId] : undefined;
  const s = tweak ? { ...base, ...tweak } : { ...base };
  // Race-relative: the gain scales off each race's own exponent, so the race ordering survives.
  // The plane gain is scoped to the TORSO (the "side" the ask was about). Applying it to every section
  // — which the first pass did, because BodySurface lofts every part with one `sectionN` — changed the
  // limbs' and the FEET's cross-sections, and that broke two measured physics properties: the planted
  // foot's slide moved 5.54 -> 5.75 mm and the ragdoll stopped settling inside 3 s (both reproduce with
  // these files stashed and pass without them, measured). So the base exponent rides along for the parts
  // that touch the ground.
  return { ...s, sectionN: planeExponent(s.sectionN), sectionNBase: s.sectionN };
}

/**
 * One part's shape parameters. `root` is the radius at the base in metres at 1.0
 * scale; `taper` drains it along the part; `bulges` add muscle along the length;
 * `pinch` carves a waist; `lobes` fatten specific directions; `n` and `depth` set the
 * cross-section's shape.
 */
export interface BodyPartShape {
  part: BodyPartName;
  /** Length along the part, metres at 1.0 scale. */
  length: number;
  /** Root radius, metres at 1.0 scale. */
  root: number;
  /** [root scale, tip scale, bias] for the taper equation. */
  taper: [number, number, number];
  /** [centre, width, amplitude] muscle bulges along the length. */
  bulges: [number, number, number][];
  /** [centre, width, depth] waist pinch, or null. */
  pinch: [number, number, number] | null;
  /** Directional lobes around the section. */
  lobes: Lobe[];
  /** Depth/width ratio of the section. */
  depth: number;
  /** How far the end domes bulge past the part, as a fraction of the end radius. A
   *  large value balloons the part into its neighbour and hides the waist; a small
   *  value keeps the ends tight. */
  cap: number;
}

/**
 * Every part's shape, completely specified. Angles are radians around the section:
 * 0 = front (+z), π/2 = the body's left, π = back.
 */
export const BODY_PART_SHAPES: Record<BodyPartName, BodyPartShape> = {
  chest: {
    part: "chest", length: 0.56, root: 0.36, taper: [1.0, 0.72, 1.2],
    bulges: [[0.25, 0.16, 0.14], [0.62, 0.2, 0.06]],
    pinch: [0.04, 0.09, 0.12], depth: 0.86, cap: 0.28,
    lobes: [
      { angle: 0.45, amp: 0.24, sharp: 2.6 },   // pectoral
      { angle: -0.45, amp: 0.24, sharp: 2.6 },  // pectoral
      { angle: 1.6, amp: 0.18, sharp: 2.2 },    // latissimus
      { angle: -1.6, amp: 0.18, sharp: 2.2 },   // latissimus
      { angle: Math.PI, amp: -0.09, sharp: 3.5 }, // spine groove
    ],
  },
  pectorals: {
    part: "pectorals", length: 0.26, root: 0.22, taper: [0.86, 1.0, 0.74],
    bulges: [[0.42, 0.22, 0.12]],
    pinch: [0.05, 0.14, 0.1], depth: 0.6, cap: 0.2,
    lobes: [
      { angle: 0, amp: -0.07, sharp: 3.2 },     // sternal groove between the two plates
      { angle: 1.57, amp: 0.11, sharp: 2.4 },   // outer sweep into the deltoid
      { angle: -1.57, amp: 0.11, sharp: 2.4 },
      { angle: 0.6, amp: 0.14, sharp: 2.0 },    // lower pectoral fold
      { angle: -0.6, amp: 0.14, sharp: 2.0 },
    ],
  },
  scapulae: {
    part: "scapulae", length: 0.24, root: 0.2, taper: [0.74, 1.0, 0.58],
    bulges: [[0.55, 0.24, 0.1]],
    pinch: [0.06, 0.16, 0.12], depth: 0.46, cap: 0.18,
    lobes: [
      { angle: Math.PI, amp: 0.13, sharp: 2.2 }, // the spine of the scapula
      { angle: 0, amp: -0.09, sharp: 3.4 },      // medial border valley toward the spine
      { angle: 2.2, amp: 0.08, sharp: 2.6 },
      { angle: -2.2, amp: 0.08, sharp: 2.6 },
    ],
  },
  abdomen: {
    part: "abdomen", length: 0.32, root: 0.3, taper: [1.0, 0.94, 0.85], bulges: [],
    pinch: [0.5, 0.26, 0.3], depth: 0.9, cap: 0.3,
    lobes: [{ angle: 0, amp: 0.12, sharp: 2.2 }, { angle: Math.PI, amp: -0.07, sharp: 3.5 }],
  },
  pelvis: {
    part: "pelvis", length: 0.28, root: 0.33, taper: [1.0, 0.8, 1.2], bulges: [[0.32, 0.28, 0.07]],
    pinch: null, depth: 0.82, cap: 0.35,
    lobes: [{ angle: 1.5, amp: 0.22, sharp: 2.2 }, { angle: -1.5, amp: 0.22, sharp: 2.2 }], // hip flare
  },
  neck: {
    part: "neck", length: 0.26, root: 0.115, taper: [1.0, 0.88, 1.0], bulges: [],
    pinch: null, depth: 0.92, cap: 0.5,
    lobes: [{ angle: 0, amp: 0.08, sharp: 2 }, { angle: Math.PI, amp: -0.05, sharp: 3 }],
  },
  head: {
    part: "head", length: 0.38, root: 0.185, taper: [1.0, 0.8, 0.9], bulges: [[0.55, 0.24, 0.045]],
    pinch: [0.3, 0.2, 0.12], depth: 1.0, cap: 0.7,
    lobes: [{ angle: Math.PI, amp: 0.1, sharp: 2 }, { angle: 0, amp: 0.05, sharp: 3 }],
  },
  upperArm: {
    part: "upperArm", length: 0.46, root: 0.1, taper: [1.0, 0.72, 0.9], bulges: [[0.3, 0.24, 0.05]],
    pinch: null, depth: 0.94, cap: 0.8,
    lobes: [{ angle: 0, amp: 0.18, sharp: 2.4 }, { angle: Math.PI, amp: 0.12, sharp: 2.2 }], // biceps / triceps
  },
  foreArm: {
    part: "foreArm", length: 0.4, root: 0.084, taper: [1.0, 0.5, 1.4], bulges: [[0.26, 0.2, 0.045]],
    pinch: null, depth: 0.92, cap: 0.5,
    lobes: [{ angle: 0, amp: 0.13, sharp: 2.6 }, { angle: Math.PI, amp: 0.1, sharp: 2.4 }],
  },
  hand: {
    part: "hand", length: 0.16, root: 0.062, taper: [1.0, 0.88, 1.6], bulges: [[0.2, 0.3, 0.03]],
    pinch: null, depth: 0.5, cap: 0.7,
    lobes: [{ angle: 1.4, amp: 0.2, sharp: 2.2 }, { angle: -1.4, amp: 0.2, sharp: 2.2 }], // thumb pad / pinky pad
  },
  thigh: {
    part: "thigh", length: 0.42, root: 0.13, taper: [1.0, 0.68, 0.9], bulges: [[0.28, 0.24, 0.06]],
    pinch: null, depth: 0.93, cap: 0.8,
    lobes: [{ angle: 0, amp: 0.2, sharp: 2.2 }, { angle: Math.PI, amp: 0.15, sharp: 2 }],
  },
  shin: {
    part: "shin", length: 0.38, root: 0.105, taper: [1.0, 0.48, 1.2], bulges: [[0.3, 0.2, 0.055]],
    pinch: null, depth: 0.9, cap: 0.8,
    lobes: [{ angle: Math.PI, amp: 0.24, sharp: 2.4 }, { angle: 0, amp: 0.06, sharp: 2 }], // calf / shin
  },
  foot: {
    part: "foot", length: 0.26, root: 0.07, taper: [1.0, 0.72, 0.7], bulges: [[0.2, 0.3, 0.03]],
    pinch: null, depth: 0.55, cap: 0.5,
    lobes: [{ angle: 1.5, amp: 0.14, sharp: 2 }, { angle: -1.5, amp: 0.14, sharp: 2 }], // the arch / heel
  },
};

/** The effective shape of one part for a silhouette. */
export function partShape(part: BodyPartName, s: RaceSilhouette): BodyPartShape {
  const p = BODY_PART_SHAPES[part];
  return {
    ...p,
    // Torso length stays at baseline; LIMB length is scaled by the race's limbLength. This
    // is what makes a dwarf short-limbed rather than a scaled-down human: with every part at
    // baseline length, limb:torso is a constant across all races.
    length: LIMB_PARTS.includes(part) ? p.length * s.limbLength : p.length,
    root: p.root * s.width,
    taper: [p.taper[0], p.taper[1], p.taper[2] * s.limbTaper],
    bulges: p.bulges.map(([c, w, a]) => [c, w, a * s.muscle] as [number, number, number]),
    pinch: p.pinch,
    lobes: p.lobes.map((l) => ({ ...l, amp: l.amp * s.muscle })),
    depth: p.depth * (s.depth / s.width),
  };
}

/** Every body state. A complete list, so a caller never has to invent one. */
export type BodyState = "idle" | "walk" | "attack" | "block" | "hit" | "stagger" | "kneel" | "fallen" | "ko";

export const BODY_STATES: BodyState[] = ["idle", "walk", "attack", "block", "hit", "stagger", "kneel", "fallen", "ko"];

/** Expand a symmetric set of joint scales into the complete per-joint record. */
function sym(spine: number, abdomen: number, neck: number, head: number, shoulder: number, elbow: number, hip: number, knee: number, ankle: number, toe: number): Record<JointName, number> {
  return {
    spine, abdomen, neck, head,
    shoulderL: shoulder, shoulderR: shoulder,
    elbowL: elbow, elbowR: elbow,
    hipL: hip, hipR: hip,
    kneeL: knee, kneeR: knee,
    ankleL: ankle, ankleR: ankle,
    toeL: toe, toeR: toe,
  };
}

/**
 * How much of each joint's range a state allows, as a scale on the joint's limits.
 * 1 = the full range, < 1 braced, 0 = locked. COMPLETE: every state, every joint.
 * A braced or prone body articulates less, which is what keeps a kneel from bending
 * like a stand.
 */
export const STATE_JOINT_SCALE: Record<BodyState, Record<JointName, number>> = {
  idle: sym(1, 1, 1, 1, 1, 1, 1, 1, 1, 1),
  walk: sym(1, 1, 1, 1, 1, 1, 1, 1, 1, 1),
  attack: sym(1, 1, 1, 1, 1, 1, 0.9, 0.9, 1, 1),
  block: sym(0.55, 0.5, 0.7, 0.8, 0.6, 0.55, 0.85, 0.8, 1, 1),
  hit: sym(0.8, 0.75, 0.85, 0.9, 0.8, 0.75, 0.8, 0.75, 1, 1),
  stagger: sym(0.45, 0.4, 0.6, 0.7, 0.5, 0.45, 0.55, 0.5, 0.8, 0.9),
  kneel: sym(0.3, 0.3, 0.5, 0.6, 0.4, 0.35, 0.25, 0.9, 0.6, 0.7),
  fallen: sym(0.15, 0.15, 0.3, 0.4, 0.25, 0.2, 0.15, 0.5, 0.3, 0.4),
  ko: sym(0.05, 0.05, 0.1, 0.2, 0.1, 0.05, 0.05, 0.1, 0.1, 0.1),
};

/** One joint's resolved constraint for a state. */
export interface JointConstraint {
  joint: JointName;
  rest: number;
  min: number;
  max: number;
  /** The scale the state applied, kept for inspection. */
  scale: number;
}

/** How much a heavy build resists articulation: mass narrows the range. */
export function raceConstraintScale(s: RaceSilhouette): number {
  // Dwarves and orks are stockier, so their joints travel less; elves travel more.
  return 1 / (0.75 + 0.25 * (s.width + s.depth));
}

/**
 * The COMPLETE constraint list for a body in a state: every joint, resolved. This is
 * the list a rig or an animation solver reads instead of inventing ranges.
 */
export function constraintList(
  state: BodyState,
  s: RaceSilhouette,
  limits: Map<JointName, { rest: number; min: number; max: number }>,
): JointConstraint[] {
  const stateScale = STATE_JOINT_SCALE[state];
  const raceScale = raceConstraintScale(s);
  const out: JointConstraint[] = [];
  for (const [joint, lim] of limits) {
    const scale = (stateScale[joint] ?? 1) * raceScale;
    out.push({
      joint,
      rest: lim.rest,
      min: lim.rest + (lim.min - lim.rest) * scale,
      max: lim.rest + (lim.max - lim.rest) * scale,
      scale,
    });
  }
  return out;
}

/** The absolute top of each proportion knob, used to bound random variation. */
export const SILHOUETTE_TOP: RaceSilhouette = {
  height: 1.25, width: 1.5, depth: 1.35, limbTaper: 1.6, limbLength: 1.2, muscle: 1.9,
  shoulder: 0.62, hip: 0.42, waist: 0.3, head: 1.25, sectionN: 2.45, sectionNBase: 2.45,
};

/**
 * Roll a silhouette for a race: the race's values jittered inside a band, clamped to
 * the absolute tops so a generated body still reads as its race and still has a good
 * silhouette. The race's own numbers are the centre, so variation never overrides
 * "dwarves are the shortest" — it only makes two dwarves different.
 */
export function randomSilhouette(rng: () => number, raceId: string, subraceId: string | null, spread = 0.09): RaceSilhouette {
  const base = raceSilhouette(raceId, subraceId);
  const roll = (): RaceSilhouette => {
    const out = { ...base };
    for (const key of Object.keys(out) as (keyof RaceSilhouette)[]) {
      // limbLength is deliberately NOT jittered. It is the knob that makes a dwarf
      // short-limbed and an elf long-limbed, so rolling it would let a dwarf land in human
      // proportions and erase the race ordering that must survive every roll.
      if (key === "limbLength") continue;
      const jitter = 1 + (rng() * 2 - 1) * spread;
      out[key] = Math.min(SILHOUETTE_TOP[key], base[key] * jitter);
    }
    return out;
  };
  // Re-roll until the body actually reads from every side. The race's own numbers are
  // the centre, so this never overrides "dwarves are the shortest" — it only rejects a
  // bad roll, which is what keeps generated characters from being deformed.
  let best = roll();
  for (let i = 0; i < 6; i++) {
    const cand = roll();
    if (silhouetteScore(cand) > silhouetteScore(best)) best = cand;
  }
  return best;
}

/**
 * A silhouette quality score in 0..1: does this body read well from every side? It
 * rewards a non-circular section, a real waist, a taper that is neither a tube nor a
 * needle, and proportions inside the sane band. Used to reject a bad random roll.
 */
export function silhouetteScore(s: RaceSilhouette): number {
  const oval = 1 - Math.min(1, Math.abs(s.depth / Math.max(1e-6, s.width) - 1) * 1.6);
  const waist = 1 - Math.min(1, Math.abs(s.waist - 0.12) * 3.2);
  const taper = 1 - Math.min(1, Math.abs(s.limbTaper - 1.05) * 1.5);
  const stature = 1 - Math.min(1, Math.abs(s.height - 1.0) * 1.1);
  const section = 1 - Math.min(1, Math.abs(s.sectionN - 2.1) * 1.4);
  return Math.max(0, Math.min(1, (oval + waist + taper + stature + section) / 5));
}
