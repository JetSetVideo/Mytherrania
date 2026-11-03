// Wave GEN lane S: INTELLIGENCE -> hair (pure; no THREE). The generator's 0..1000 intelligence stat
// (BodySpec.stats.intelligence, StatScale.ts) moves three hair terms, each bounded and monotone, and
// each the IDENTITY at the reference value (STAT_REFERENCE 500) and when the stat is absent:
//
//   length   x lengthMul(I): 1 - LENGTH_DOWN at 0 .. 1 at 500 .. 1 + LENGTH_UP at 1000 (piecewise linear).
//            The cut length goes through HairGrowth.hairPlanFor, so the TIER (buzz/short/shoulder/long)
//            follows; a shaved/mohawk style keeps its own cut (the style decides first).
//   density  x densityMul(I) on the ancestry's follicle density, clamped to [0, 1]: more follicles per h².
//            The clump count still refits to HAIR_TRI_BUDGET (HairMesh.buildHairData), so the triangle
//            budget holds at every value.
//   silver   above the reference only: the grey share rises g -> g + (1 - g)·GREY_UP·u (u = (I - 500)/500) —
//            drawn as salt and pepper (HairMesh: the shader's sub-strand rate; whole grey clumps stay at the age share),
//            and the remaining pigment drifts toward SILVER_WHITE by SILVER_UP·u·t^1.5 along the strand (t = root 0 ->
//            tip 1: silvering ends, the crown's roots and the scalp underlayer keep the age colour, so it never
//            reads as a silver cap — Q2 r2). Combined with the age grey
//            (Age.greyFraction) and NEVER darker than age alone: every term is a per-channel max with the
//            age-only colour (HairMesh), and the grey share is monotone non-decreasing in I.
//
// A low intelligence never adds grey (the silver is a sage's mark, not a penalty): below 500 only the
// length and the density fall.

/** The stated intelligence -> hair laws. */
export const HAIR_INTELLECT = {
  /** The reference stat (StatScale.STAT_REFERENCE): every law is the identity here. */
  reference: 500,
  /** Length multiplier: 1 + LENGTH_UP at 1000, 1 - LENGTH_DOWN at 0. */
  lengthUp: 0.45,
  lengthDown: 0.3,
  /** Follicle-density multiplier: 1 + DENSITY_UP at 1000, 1 - DENSITY_DOWN at 0 (result clamped to [0, 1]). */
  densityUp: 0.3,
  densityDown: 0.25,
  /** Extra grey share at 1000, as a fraction of the not-yet-grey hair. */
  greyUp: 0.3,
  /** Pigment drift toward SILVER_WHITE at 1000 (0..1 lerp, applied as a per-channel max). */
  silverUp: 0.12,
  /** The drift grows root -> tip as t^silverTipPow (roots on the crown keep their pigment). */
  silverTipPow: 1.5,
  /** The silver-white the pigment drifts toward (sRGB hex). */
  silverWhite: "#dfe3e8",
} as const;

/** Signed position of a stat around the reference, in [-1, 1] (0 when absent / not finite). */
export function intellectUnit(intelligence: number | null | undefined): number {
  if (intelligence === undefined || intelligence === null || !Number.isFinite(intelligence)) return 0;
  const I = Math.max(0, Math.min(1000, intelligence)), r = HAIR_INTELLECT.reference;
  return I >= r ? (I - r) / (1000 - r) : (I - r) / r;
}

/** Hair length multiplier (1 at the reference / absent). */
export function intellectLengthMul(intelligence?: number | null): number {
  const u = intellectUnit(intelligence);
  return u >= 0 ? 1 + HAIR_INTELLECT.lengthUp * u : 1 + HAIR_INTELLECT.lengthDown * u;
}

/** Follicle density after the intelligence term, clamped to [0, 1] (the input itself at the reference). */
export function intellectDensity(density: number, intelligence?: number | null): number {
  const u = intellectUnit(intelligence);
  if (u === 0) return density;
  const k = u >= 0 ? 1 + HAIR_INTELLECT.densityUp * u : 1 + HAIR_INTELLECT.densityDown * u;
  return Math.max(0, Math.min(1, density * k));
}

/** The grey share after intelligence, on top of the age grey g (= g at and below the reference). */
export function intellectGrey(ageGrey: number, intelligence?: number | null): number {
  const g = Math.max(0, Math.min(1, ageGrey)), u = Math.max(0, intellectUnit(intelligence));
  return u === 0 ? g : g + (1 - g) * HAIR_INTELLECT.greyUp * u;
}

/** The pigment drift toward silver-white, 0..silverUp (0 at and below the reference). */
export function intellectSilver(intelligence?: number | null): number {
  return HAIR_INTELLECT.silverUp * Math.max(0, intellectUnit(intelligence));
}

/** Lighten a LINEAR rgb toward `white` by s, never darker in any channel (per-channel max). */
export function silverShift(c: readonly number[], white: readonly number[], s: number): [number, number, number] {
  if (s <= 0) return [c[0], c[1], c[2]];
  const o: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) o[k] = Math.min(1, Math.max(c[k], c[k] + (white[k] - c[k]) * s));
  return o;
}
