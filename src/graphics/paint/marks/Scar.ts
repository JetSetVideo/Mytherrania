// Scar: a medically plausible scar model (wave TEX, lane M, contract C-MARK).
//
// Pure module: no THREE, no DOM, no Math.random. Everything is a deterministic function of the
// scar record (its `seed` included). Two halves:
//
//   1. the STAGE model — what a scar looks like at `ageDays` (wound healing in three overlapping
//      phases: inflammatory, proliferative, remodelling; "mature" once remodelling has settled);
//   2. the SHAPE model — where on its own little 2D patch the scar tissue is, per kind
//      (incision, laceration, claw, puncture, burn, stitched), in millimetres.
//
// Local mark coordinates (mm): s along the scar's long axis (0 at the anchor), t across it.
// The region frame (Placement.ts) places that patch on the body: angle 0 = circumferential /
// transverse, pi/2 = longitudinal (along the limb / up the trunk).
//
// Medical rationale (plain language; details and tables in docs/wave-tex/MARKS.md):
// - A fresh wound is red, swollen and moist (inflammation: dilated vessels, oedema).
// - In the proliferative phase (about day 4 to week 3) new granulation tissue fills it: pink.
// - Remodelling (week 3 to a year or two) replaces that collagen with denser, aligned collagen;
//   vessels regress, so the redness fades and the scar ends PALER than the skin around it
//   (fewer melanocytes), flat or slightly sunken (atrophic), shiny (no pores, no hair follicles,
//   no sweat glands) and hairless.
// - A keloid is the exception: scar tissue that keeps growing past the wound's borders, stays
//   raised and darker; it is far more common in some ancestries and on some sites (chest,
//   shoulders, ear lobes).
// - Langer's lines (cleavage lines) are the directions of the dermis' collagen grain; surgical
//   incisions follow them and heal thinner; a wound ACROSS them gapes and heals wider.

import type { Region } from "../../body/contracts.ts";

/** The scar kinds of the contract, in a fixed order (a kind's index is its numeric code). */
export const SCAR_KINDS = ["incision", "laceration", "claw", "puncture", "burn", "stitched"] as const;
export type ScarKind = typeof SCAR_KINDS[number];

/** Healing stages, in time order. */
export const SCAR_STAGES = ["inflammatory", "proliferative", "remodelling", "mature"] as const;
export type ScarStage = typeof SCAR_STAGES[number];

/**
 * Stage boundaries in DAYS (start of each stage). Inflammation ~0-4 d, proliferation ~4-21 d,
 * remodelling 3 weeks to ~1 year; a scar is called mature once remodelling has settled (>= 1 y).
 */
export const STAGE_START_DAYS: Readonly<Record<ScarStage, number>> = {
  inflammatory: 0, proliferative: 4, remodelling: 21, mature: 365,
};

/** A scar on the body (C-MARK). `anchor` is (u, v) in the region frame, each in [-1, 1]. */
export interface Scar {
  kind: ScarKind;
  region: Region;
  /** 0 = character's left, 1 = right (paired regions only; midline regions ignore it). */
  side?: 0 | 1;
  anchor: [number, number];
  lengthMm: number;
  widthMm: number;
  /** Radians in the region frame (0 transverse, pi/2 longitudinal). null/absent = Langer's line. */
  angle?: number | null;
  /** Days since the wound. */
  ageDays: number;
  /** true/false forces; null/absent = rolled from the ancestry x region x kind propensity. */
  keloid?: boolean | null;
  /**
   * Hypertrophic healing (raised, red and firm WITHIN the wound's border, peaking at 3-6 months and
   * regressing over 1-2 years; common after deep burns). true/false forces; null/absent = rolled.
   * A keloid wins over it.
   */
  hypertrophic?: boolean | null;
  seed: number;
  /** Also draw the mirror image on the other side (paired) or across the midline. */
  mirror?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Small deterministic helpers (shared with Tattoo.ts).

/** Integer hash of (seed, i) -> [0, 1). */
export function markHash(seed: number, i: number): number {
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i | 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 1D value noise in [-1, 1] (cubic Hermite between hashed integer lattice values). */
export function valueNoise1(seed: number, x: number): number {
  const i = Math.floor(x), f = x - i, w = f * f * (3 - 2 * f);
  const a = markHash(seed, i) * 2 - 1, b = markHash(seed, i + 1) * 2 - 1;
  return a + (b - a) * w;
}

/** Smooth 2D value noise in [-1, 1]. */
export function valueNoise2(seed: number, x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const wx = fx * fx * (3 - 2 * fx), wy = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number) => markHash(seed, Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) * 2 - 1;
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  return a + (b - a) * wx + (c - a) * wy + (a - b - c + d) * wx * wy;
}

function clamp(x: number, lo: number, hi: number): number { return x < lo ? lo : x > hi ? hi : x; }
function smooth(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0 || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------------------------
// Langer's lines.

/** The face frame at the reference 1.8 m body: radius from the head axis and half height (mm). */
export const FACE_FRAME_MM = { radius: 120, halfLength: 75 } as const;

/** Face orifices in face-frame millimetres at the reference 1.8 m body (eyes, nose, mouth). */
export const FACE_ORIFICES_MM: readonly { name: string; x: number; y: number }[] = [
  { name: "eyeL", x: 32, y: 25 }, { name: "eyeR", x: -32, y: 25 },
  { name: "nose", x: 0, y: -5 }, { name: "mouth", x: 0, y: -40 },
];

/**
 * The default scar orientation at (u, v) of a region frame: the local direction of Langer's
 * cleavage lines, as an angle in [-pi/2, pi/2] (0 = transverse/circumferential, pi/2 = along
 * the limb or up the trunk). Summary of the maps (Langer 1861; surgical texts):
 * - trunk: horizontal on the chest/sternum and the front of the abdomen, oblique on the flanks
 *   (descending toward the front midline), oblique over the scapulae, horizontal low on the back;
 * - pelvis, neck: horizontal (why a thyroid or Pfannenstiel incision is transverse);
 * - long limb segments: longitudinal; they turn transverse (concentric) over the joints;
 * - back of the hand and foot: transverse;
 * - scalp: sagittal (front-to-back over the crown);
 * - face: horizontal on the forehead, otherwise radiating from the nearest orifice
 *   (eyes = crow's feet, mouth = perioral lines).
 */
export function langerAngle(region: Region, u: number, v: number, faceScale = 1, face?: LangerFace): number {
  const HALF_PI = Math.PI / 2;
  const au = Math.abs(u), su = u < 0 ? -1 : 1;
  switch (region) {
    case "torso":
      if (au < 0.3) return 0;                       // sternum, front of the abdomen
      if (au < 0.65) return 0.35 * su;              // flanks: oblique, descending to the front
      return v > 0.35 ? -0.4 * su : 0;              // back: oblique over the scapulae, then flat
    case "pelvis": case "neck": case "hand": case "foot": case "sole":
      return 0;
    case "upperArm": case "foreArm": case "thigh": case "shin":
      return Math.abs(v) >= 0.75 ? 0 : HALF_PI;     // longitudinal; concentric over the joints
    case "head":
      // Sagittal on the scalp: front-to-back reads longitudinal at the front/back of the
      // cylinder (u ~ 0 or ~ +-1) and circumferential on its sides (u ~ +-0.5).
      return HALF_PI * Math.abs(Math.cos(u * Math.PI));
    case "ear":
      return HALF_PI;
    case "face": {
      // Face mm from (u, v): the body's own face frame and orifices when given, else the table.
      const R = face ? face.radiusMm : FACE_FRAME_MM.radius * faceScale;
      const H = face ? face.halfLengthMm : FACE_FRAME_MM.halfLength * faceScale;
      const x = u * Math.PI * R, y = v * H;
      const orifices = face ? face.orifices : FACE_ORIFICES_MM.map((o) => ({ x: o.x * faceScale, y: o.y * faceScale }));
      const forehead = face ? face.foreheadMm : 0.45 * H;
      if (y > forehead) return 0;                   // forehead: horizontal
      let best = Infinity, ang = 0;
      for (const o of orifices) {
        const dx = x - o.x, dy = y - o.y, d = dx * dx + dy * dy;
        if (d < best) { best = d; ang = Math.atan2(dy, dx); }
      }
      if (best < 1e-9) return 0;
      // Fold a direction into a line angle in [-pi/2, pi/2].
      if (ang > HALF_PI) ang -= Math.PI;
      if (ang < -HALF_PI) ang += Math.PI;
      return ang;
    }
    default:
      return 0;
  }
}

/** A body's own face for Langer's radiating lines: frame size and orifice centres (face-frame mm). */
export interface LangerFace { radiusMm: number; halfLengthMm: number; orifices: { x: number; y: number }[]; foreheadMm: number }

/** Smallest unsigned angle between two LINES (period pi), in [0, pi/2]. */
export function lineAngleDelta(a: number, b: number): number {
  let d = Math.abs(a - b) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
}

/**
 * Gaping: a wound across Langer's lines is pulled open by the skin's tension and heals WIDER.
 * Factor on the healed width: 1 along the lines, up to 1 + GAPE across them.
 */
export const GAPE = 0.6;
export function gapeFactor(angle: number, langer: number): number {
  return 1 + GAPE * Math.sin(lineAngleDelta(angle, langer));
}

// ---------------------------------------------------------------------------------------------
// Keloid propensity.

/**
 * Per-ancestry chance that a scar becomes a keloid (before site and kind factors). Real-world
 * keloid rates differ by ancestry by an order of magnitude; the game maps that onto its peoples:
 * orks heal with exuberant scar tissue, elves almost never form keloids.
 */
export const KELOID_PROPENSITY: Readonly<Record<string, number>> = {
  human: 0.05, imperial: 0.04, nomad: 0.07, islander: 0.09,
  elf: 0.01, high: 0.005, wood: 0.015, dark: 0.03,
  dwarf: 0.08, mountain: 0.08, forge: 0.1, deep: 0.06,
  ork: 0.15, greenhide: 0.14, ironhide: 0.17, bloodfang: 0.2,
};

/** Site factor: chest/sternum, shoulders and ear lobes are classic keloid sites; palms/soles rare. */
export const KELOID_SITE: Readonly<Partial<Record<Region, number>>> = {
  torso: 2.0, upperArm: 1.8, ear: 2.5, neck: 1.2, face: 0.8, pelvis: 0.5, foreArm: 0.6,
  hand: 0.3, thigh: 0.5, shin: 0.4, foot: 0.2, sole: 0.05,
};

/** Kind factor: burns and wounds closed under tension keloid more; clean punctures less. */
export const KELOID_KIND: Readonly<Record<ScarKind, number>> = {
  incision: 1, laceration: 1.1, claw: 1.1, puncture: 0.8, burn: 1.5, stitched: 1,
};

/** Chance (0..0.8) that a scar of `kind` on `region` keloids for this ancestry. */
export function keloidChance(race: string, subrace: string | null | undefined, region: Region, kind: ScarKind): number {
  const base = KELOID_PROPENSITY[subrace ?? ""] ?? KELOID_PROPENSITY[race] ?? KELOID_PROPENSITY.human;
  // A pierced ear lobe is THE classic keloid: puncture on the ear doubles.
  const kindF = kind === "puncture" && region === "ear" ? 2 : KELOID_KIND[kind];
  return clamp(base * (KELOID_SITE[region] ?? 0.3) * kindF, 0, 0.8);
}

/** Resolve a scar's keloid flag: an explicit boolean wins, else a seeded roll against the chance. */
export function resolveKeloid(scar: Scar, race: string, subrace: string | null | undefined): boolean {
  if (scar.keloid === true || scar.keloid === false) return scar.keloid;
  return markHash(scar.seed, 0x6b656c) < keloidChance(race, subrace, scar.region, scar.kind);
}

/**
 * Per-kind chance of hypertrophic healing: deep burns 30-70 % in the burn literature (0.5 here),
 * wounds closed under tension or left to gape less, clean punctures rarely.
 */
export const HYPERTROPHIC_KIND: Readonly<Record<ScarKind, number>> = {
  incision: 0.05, laceration: 0.15, claw: 0.15, puncture: 0.02, burn: 0.5, stitched: 0.1,
};
/** Tension sites (chest, shoulders, neck) favour hypertrophy. */
export const HYPERTROPHIC_SITE: Readonly<Partial<Record<Region, number>>> = { torso: 1.2, upperArm: 1.2, neck: 1.2 };

/** Chance (0..0.8) of hypertrophic healing: kind x site x (1 + 2 x the ancestry's keloid propensity). */
export function hypertrophicChance(race: string, subrace: string | null | undefined, region: Region, kind: ScarKind): number {
  const base = KELOID_PROPENSITY[subrace ?? ""] ?? KELOID_PROPENSITY[race] ?? KELOID_PROPENSITY.human;
  return clamp(HYPERTROPHIC_KIND[kind] * (HYPERTROPHIC_SITE[region] ?? 1) * (1 + 2 * base), 0, 0.8);
}

/** Resolve the hypertrophic flag (false when the scar is a keloid). */
export function resolveHypertrophic(scar: Scar, race: string, subrace: string | null | undefined, keloid: boolean): boolean {
  if (keloid) return false;
  if (scar.hypertrophic === true || scar.hypertrophic === false) return scar.hypertrophic;
  return markHash(scar.seed, 0x687970) < hypertrophicChance(race, subrace, scar.region, scar.kind);
}

// ---------------------------------------------------------------------------------------------
// Stage model.

/** Which stage a scar of `ageDays` is in. */
export function scarStage(ageDays: number): ScarStage {
  const a = Number.isFinite(ageDays) ? ageDays : 0;
  if (a >= STAGE_START_DAYS.mature) return "mature";
  if (a >= STAGE_START_DAYS.remodelling) return "remodelling";
  if (a >= STAGE_START_DAYS.proliferative) return "proliferative";
  return "inflammatory";
}

/** Hypertrophic activity from which a scar still SHOWS as remodelling (raised, pinkish), whatever its age (QD Z-115). */
export const HYPERTROPHIC_ACTIVE = 0.1;

/**
 * The stage a scar SHOWS (wave TEX closing, F; QD ruling Z-115): scarStage by age, except that a scar that is still
 * raised by its own pathology is never called "mature: pale, flat" — an active hypertrophic scar
 * (hypertrophicActivity >= HYPERTROPHIC_ACTIVE, i.e. up to ~19 months for the 120-day peak) and a keloid (which
 * persists raised) stay "remodelling". Order is still monotone in age for fixed flags: the activity only falls after
 * its peak, so once a hypertrophic scar turns mature it stays mature. An ordinary scar is exactly scarStage.
 */
export function scarStageOf(ageDays: number, keloid = false, hypertrophic = false): ScarStage {
  const st = scarStage(ageDays);
  if (st !== "mature") return st;
  if (keloid) return "remodelling";
  if (hypertrophic && hypertrophicActivity(ageDays) >= HYPERTROPHIC_ACTIVE) return "remodelling";
  return st;
}

/** Time constants (days) of the healing curves. */
export const HEALING = {
  /** Erythema (redness) decays with this e-folding time: still pink at 3 weeks, faint at 6 months. */
  rednessTau: 75,
  /** Maturation (collagen remodelling) e-folding time: ~96 % mature at one year. */
  maturityTau: 110,
  /** Oedema / granulation swelling e-folding time. */
  swellTau: 40,
  /** Keloid growth e-folding time (keloids grow for months, then persist). */
  keloidTau: 120,
  /** Hypertrophic peak (days): the bump (a/peak) e^(1 - a/peak) is 1 at ~4 months, 0.4 at 1 y, 0.04 at 2 y. */
  hypertrophicPeak: 120,
} as const;

/** The scar's look at an age: colour operators, roughness and height. */
export interface ScarLook {
  stage: ScarStage;
  /** 0..1: erythema (red, from dilated vessels). */
  redness: number;
  /** 0..1: remodelling progress. */
  maturity: number;
  /** Multiply tint, sRGB 0..1 (reddening). */
  tint: [number, number, number];
  /** Screen lift 0..1 toward white (hypopigmentation: paler than the skin). */
  lift: number;
  /** 0..1 desaturation toward the skin's own luminance (loss of melanin). */
  desat: number;
  /** Multiplier on the skin's roughness: always < 1 (scar tissue is shinier than skin). */
  roughnessScale: number;
  /** Centre-line relief in millimetres (+ raised, - sunken/atrophic). */
  heightMm: number;
  /** Width factor (keloids spread past the wound's borders). */
  spread: number;
}

/** Final (mature) relief per kind, mm: <= 0, punctures and claw rakes heal sunken (atrophic). */
export const MATURE_HEIGHT_MM: Readonly<Record<ScarKind, number>> = {
  incision: 0, laceration: -0.05, claw: -0.15, puncture: -0.4, burn: -0.05, stitched: 0,
};

/** Early swelling per kind, mm (oedema + granulation): burns and ragged wounds swell most. */
export const SWELL_MM: Readonly<Record<ScarKind, number>> = {
  incision: 0.5, laceration: 0.8, claw: 0.7, puncture: 0.4, burn: 0.9, stitched: 0.6,
};

/** Keloid plateau height, mm. */
export const KELOID_HEIGHT_MM = 2.5;
/** Hypertrophic peak height, mm (raised within the border; regresses). */
export const HYPERTROPHIC_HEIGHT_MM = 1.5;

/** Hypertrophic activity 0..1 at an age: (a/peak) e^(1 - a/peak). */
export function hypertrophicActivity(ageDays: number): number {
  const x = Math.max(0, Number.isFinite(ageDays) ? ageDays : 0) / HEALING.hypertrophicPeak;
  return x * Math.exp(1 - x);
}
/** Strongest reddening tint (inflammatory), multiply, sRGB. */
export const RED_TINT: readonly [number, number, number] = [1, 0.5, 0.48];
/** Hypopigmentation lift of a mature scar (screen amount). */
export const MATURE_LIFT = 0.26;

/**
 * The look of a scar of `kind` at `ageDays` (keloid or not). Formulas:
 *   redness  r = exp(-a / rednessTau)           (keloid: 0.35 + 0.65 r, keloids stay dark-pink)
 *   maturity m = 1 - exp(-a / maturityTau)
 *   tint     = lerp(white, RED_TINT, r)
 *   lift     = MATURE_LIFT m (keloid 0: they are not hypopigmented)
 *   desat    = 0.6 m (keloid 0.15 m)
 *   height   = SWELL e^(-a/swellTau) + MATURE_HEIGHT m           (non-increasing in a)
 *              keloid: SWELL e^(-a/swellTau) + KELOID_HEIGHT (1 - e^(-a/keloidTau))
 *   rough    = piecewise in log-age: 0.55 wet (day 0) -> 0.75 granulation (day 14) -> 0.62 mature
 *   spread   = 1 (keloid 1 + 0.6 (1 - e^(-a/keloidTau)))
 * Hypertrophic (not keloid), activity b = (a/120) e^(1 - a/120):
 *   redness = max(r, 0.7 b);  height += HYPERTROPHIC_HEIGHT b;  lift, desat x (1 - b), (1 - 0.7 b);
 *   spread 1 (it stays inside the wound's border, unlike a keloid). Monotone again after the peak.
 */
export function scarLook(kind: ScarKind, ageDays: number, keloid = false, hypertrophic = false): ScarLook {
  const a = Math.max(0, Number.isFinite(ageDays) ? ageDays : 0);
  const r0 = Math.exp(-a / HEALING.rednessTau);
  // Hypertrophic (not keloid): an activity bump that keeps the scar red and raised while active.
  const hb = !keloid && hypertrophic ? hypertrophicActivity(a) : 0;
  const redness = keloid ? 0.35 + 0.65 * r0 : Math.max(r0, 0.7 * hb);
  const maturity = 1 - Math.exp(-a / HEALING.maturityTau);
  const tint: [number, number, number] = [
    1 + (RED_TINT[0] - 1) * redness, 1 + (RED_TINT[1] - 1) * redness, 1 + (RED_TINT[2] - 1) * redness,
  ];
  const swell = SWELL_MM[kind] * Math.exp(-a / HEALING.swellTau);
  const grow = 1 - Math.exp(-a / HEALING.keloidTau);
  const heightMm = keloid ? swell + KELOID_HEIGHT_MM * grow
    : swell + HYPERTROPHIC_HEIGHT_MM * hb + MATURE_HEIGHT_MM[kind] * maturity;
  // Roughness scale through log-age keys (day 0 wet/glossy, day 14 granulation, mature shiny).
  const la = Math.log10(1 + a);
  const k1 = Math.log10(15), k2 = Math.log10(366);
  const mature = kind === "burn" ? 0.7 : 0.62;
  const roughnessScale = la <= k1 ? 0.55 + (0.75 - 0.55) * (la / k1)
    : la <= k2 ? 0.75 + (mature - 0.75) * ((la - k1) / (k2 - k1)) : mature;
  return {
    stage: scarStageOf(a, keloid, hypertrophic), redness, maturity, tint,
    lift: keloid ? 0 : MATURE_LIFT * maturity * (1 - hb),
    desat: (keloid ? 0.15 : 0.6) * maturity * (1 - 0.7 * hb),
    roughnessScale,
    heightMm,
    spread: keloid ? 1 + 0.6 * grow : 1,
  };
}

/** Rec. 709 luma of an sRGB triple (a perceptual-enough lightness for contrast caps). */
export function luma(c: readonly number[]): number { return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }

/** Euclidean sRGB distance. */
export function rgbDistance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Fresh black ink and its opacity: the contrast ceiling a scar may not exceed (C-MARK). */
export const REFERENCE_INK: readonly [number, number, number] = [0.08, 0.08, 0.1];
export const FRESH_INK_OPACITY = 0.92;

/** Contrast of fresh black ink on this skin (sRGB distance). */
export function inkContrast(skin: readonly number[]): number {
  return FRESH_INK_OPACITY * rgbDistance(skin, REFERENCE_INK);
}

/**
 * The scar colour over `skin` (sRGB 0..1) at full coverage, uncapped:
 *   c1 = lerp(skin, luma(skin), desat);  c2 = c1 * tint;  out = 1 - (1 - c2)(1 - lift).
 */
export function scarColourRaw(skin: readonly number[], look: ScarLook): [number, number, number] {
  const y = luma(skin), out: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const c1 = skin[k] + (y - skin[k]) * look.desat;
    const c2 = c1 * look.tint[k];
    out[k] = clamp(1 - (1 - c2) * (1 - look.lift), 0, 1);
  }
  return out;
}

/** Strength 0..1 that keeps the scar's contrast on this skin <= fresh ink contrast (C-MARK). */
export function scarStrengthCap(skin: readonly number[], look: ScarLook): number {
  const d = rgbDistance(scarColourRaw(skin, look), skin);
  return d <= 1e-9 ? 1 : Math.min(1, inkContrast(skin) / d);
}

/** The scar colour over `skin` at coverage 0..1, with the ink-contrast cap applied. */
export function scarColour(skin: readonly number[], look: ScarLook, coverage = 1): [number, number, number] {
  const raw = scarColourRaw(skin, look), k = clamp(coverage, 0, 1) * scarStrengthCap(skin, look);
  return [skin[0] + (raw[0] - skin[0]) * k, skin[1] + (raw[1] - skin[1]) * k, skin[2] + (raw[2] - skin[2]) * k];
}

// ---------------------------------------------------------------------------------------------
// Shape model.

/** Claw rakes: number of parallel lines (3 or 4) and their spacing, from the scar. */
export function clawLines(scar: Pick<Scar, "seed" | "widthMm">): { count: number; spacingMm: number } {
  return { count: markHash(scar.seed, 0xc1a) < 0.6 ? 3 : 4, spacingMm: Math.max(12, scar.widthMm * 4) };
}

/** Sutures: pitch along the line and bite (distance of each stitch mark from the line), mm. */
export const SUTURE_PITCH_MM = 7;
export const SUTURE_BITE_MM = 4;
/** Stitch-mark line half-width, mm. */
export const SUTURE_MARK_HALF_MM = 0.6;
/** Hair is absent this far around the scar tissue (follicles destroyed), mm. */
export const HAIRLESS_MARGIN_MM = 1.5;

/** Half extents (mm) of the scar's footprint along s and t (before rotation), keloid spread included. */
export function scarExtentMm(scar: Scar, spread = 1): [number, number] {
  const L = Math.max(1, scar.lengthMm), W = Math.max(0.5, scar.widthMm) * spread;
  switch (scar.kind) {
    case "claw": {
      const { count, spacingMm } = clawLines(scar);
      return [L / 2 + 4, ((count - 1) * spacingMm) / 2 + W];
    }
    case "puncture": { const r = Math.max(L, W) / 2 * spread * 1.2 + 0.5; return [r, r]; } // +18 % stellate edge
    case "burn": return [L / 2 * 1.25, W / 2 * 1.25];
    case "stitched": return [L / 2 + 1, Math.max(W / 2, SUTURE_BITE_MM + SUTURE_MARK_HALF_MM) + 0.5];
    default: return [L / 2 + 1, W / 2 * 1.5 + 1];
  }
}

/** One sample of a scar's tissue at a local point. */
export interface ScarSample {
  /** 0..1 scar tissue coverage (drives albedo and roughness). */
  coverage: number;
  /** Relief at this point in mm (signed). */
  heightMm: number;
  /** -1..1 mottling (burns: patchy hyper/hypopigmentation), 0 elsewhere. */
  mottle: number;
  /** 1 where hair follicles are absent (scar line + margin), else 0. */
  hairless: number;
}

/** Profile of a raised or sunken ridge across its width: 1 at the centre, 0 at the edge. */
function ridge(t: number, w: number): number {
  const q = Math.abs(t) / Math.max(1e-6, w);
  return q >= 1 ? 0 : 1 - q * q;
}

/** A tapered line of half-width w(s), centre offset c(s): returns coverage and ridge. */
function line(s: number, t: number, halfLen: number, w: number, c: number): [number, number] {
  if (Math.abs(s) > halfLen) return [0, 0];
  const taper = Math.sqrt(Math.max(0, 1 - (s / halfLen) ** 2));
  const ww = Math.max(0.15, w * taper), d = Math.abs(t - c);
  return [1 - smooth(0.7 * ww, ww + 0.3, d), ridge(t - c, ww)];
}

/**
 * The scar's tissue at local (s, t) mm, given its look (`scarLook`). Coverage is the tissue
 * fraction (soft edge ~0.3 mm), height = look.heightMm x the across-profile (stitch marks at half
 * height), mottle only for burns. Shapes:
 *   incision   a clean spindle (elliptical taper), centred;
 *   laceration a ragged line: width 0.6-1.3 x and a centre wobble of 0.35 half-widths (noise, 4 mm);
 *   claw       3-4 parallel rakes, slightly curved and staggered;
 *   puncture   a round pit (stellate edge from noise);
 *   burn       an irregular patch (noisy ellipse boundary), mottled, with ridged contracture bands;
 *   stitched   an incision plus transverse suture marks every SUTURE_PITCH_MM ("railroad tracks").
 */
export function sampleScar(scar: Scar, look: ScarLook, s: number, t: number, out?: ScarSample): ScarSample {
  const o = out ?? { coverage: 0, heightMm: 0, mottle: 0, hairless: 0 };
  const core = scarCore(scar, look, s, t, CORE);
  o.coverage = core[0];
  o.heightMm = o.coverage > 0 ? look.heightMm * core[1] : 0;
  o.mottle = core[2];
  // Hairless: the tissue itself, dilated by HAIRLESS_MARGIN_MM (4 probes at the margin distance).
  o.hairless = o.coverage > 0.05 ? 1 : 0;
  if (!o.hairless) {
    const [ex, ey] = scarExtentMm(scar, look.spread), m = HAIRLESS_MARGIN_MM;
    if (Math.abs(s) <= ex + m && Math.abs(t) <= ey + m) {
      for (let k = 0; k < 4; k++) {
        const ds = k === 0 ? m : k === 1 ? -m : 0, dt = k === 2 ? m : k === 3 ? -m : 0;
        if (scarCore(scar, look, s + ds, t + dt, CORE)[0] > 0.05) { o.hairless = 1; break; }
      }
    }
  }
  return o;
}

const CORE: [number, number, number] = [0, 0, 0];

/** Coverage, across-profile and mottle of the scar at (s, t): the shape table above. */
function scarCore(scar: Scar, look: ScarLook, s: number, t: number, out: [number, number, number]): [number, number, number] {
  const L = Math.max(1, scar.lengthMm), hl = L / 2, W = Math.max(0.5, scar.widthMm) * look.spread, hw = W / 2;
  const seed = scar.seed | 0;
  let cov = 0, prof = 0, mottle = 0;
  switch (scar.kind) {
    case "incision": {
      [cov, prof] = line(s, t, hl, hw, 0);
      break;
    }
    case "laceration": {
      const w = hw * (0.95 + 0.35 * valueNoise1(seed + 1, s / 4));
      const c = 0.35 * hw * valueNoise1(seed + 2, s / 4);
      [cov, prof] = line(s, t, hl, w, c);
      break;
    }
    case "claw": {
      const { count, spacingMm } = clawLines(scar);
      for (let k = 0; k < count; k++) {
        const off = (k - (count - 1) / 2) * spacingMm;
        const stagger = (markHash(seed, 10 + k) - 0.5) * 0.3 * hl;
        const lenK = hl * (0.75 + 0.25 * markHash(seed, 20 + k));
        const ss = s - stagger, curve = 0.08 * (ss * ss) / Math.max(1, hl);
        const w = hw * (0.9 + 0.3 * valueNoise1(seed + 30 + k, ss / 5));
        const [c, p] = line(ss, t, lenK, w, off + curve);
        if (c > cov) { cov = c; prof = p; }
      }
      break;
    }
    case "puncture": {
      const r = Math.max(L, W) / 2 * look.spread;
      const ang = Math.atan2(t, s);
      const rr = r * (1 + 0.18 * valueNoise1(seed + 3, (ang + Math.PI) * 2.5));
      const d = Math.hypot(s, t);
      cov = 1 - smooth(0.75 * rr, rr + 0.3, d);
      prof = ridge(d, rr);
      break;
    }
    case "burn": {
      const q = Math.hypot(s / hl, t / hw);
      const edge = 1 + 0.22 * valueNoise2(seed + 4, s / 9, t / 9) + 0.08 * valueNoise2(seed + 5, s / 3, t / 3);
      cov = 1 - smooth(0.85 * edge, edge, q);
      mottle = cov * valueNoise2(seed + 6, s / 6, t / 6);
      // Contracture bands: ridges along s, spaced ~6 mm.
      const band = Math.abs(Math.sin((t / 6) * Math.PI + 1.7 * valueNoise1(seed + 7, s / 10)));
      prof = cov * (0.55 + 0.45 * (1 - band));
      break;
    }
    case "stitched": {
      [cov, prof] = line(s, t, hl, hw, 0);
      const n = Math.max(1, Math.floor(L / SUTURE_PITCH_MM));
      const first = -((n - 1) * SUTURE_PITCH_MM) / 2;
      const k = Math.round((s - first) / SUTURE_PITCH_MM);
      if (k >= 0 && k < n) {
        const ds = Math.abs(s - (first + k * SUTURE_PITCH_MM)), dt = Math.abs(t);
        if (dt <= SUTURE_BITE_MM + SUTURE_MARK_HALF_MM) {
          const c = (1 - smooth(SUTURE_MARK_HALF_MM * 0.6, SUTURE_MARK_HALF_MM + 0.25, ds))
            * (1 - smooth(SUTURE_BITE_MM, SUTURE_BITE_MM + SUTURE_MARK_HALF_MM, dt));
          if (c > cov) { cov = c; prof = 0.5; }
        }
      }
      break;
    }
  }
  out[0] = clamp(cov, 0, 1); out[1] = prof; out[2] = mottle;
  return out;
}

/**
 * Mean coverage, mean height (mm) and hairless share over the footprint box, sampled on an
 * n x n grid: what the coarse per-vertex pass uses (vertices are 22-35 mm apart, finer than a
 * scar's line only in the fragment pass).
 */
export function scarFootprintStats(scar: Scar, look: ScarLook, n = 24): { coverage: number; heightMm: number; hairless: number } {
  const [ex, ey] = scarExtentMm(scar, look.spread), smp: ScarSample = { coverage: 0, heightMm: 0, mottle: 0, hairless: 0 };
  let c = 0, h = 0, hr = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      sampleScar(scar, look, ((i + 0.5) / n * 2 - 1) * ex, ((j + 0.5) / n * 2 - 1) * ey, smp);
      c += smp.coverage; h += smp.heightMm; hr += smp.hairless;
    }
  }
  const k = 1 / (n * n);
  return { coverage: c * k, heightMm: h * k, hairless: hr * k };
}
