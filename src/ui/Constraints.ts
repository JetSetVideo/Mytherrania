// Constraints (Wave GEN, lane U): the NEIGHBOUR-DEPENDENT limits of the Creator's body numbers.
//
// Wave X gave every number a STATIC band (CreatorTweak: the race's height/weight band, silhouette ±9 %).
// A static band cannot say "the waist may not be wider than the hips": that limit moves when the hips
// move. This module states such rules on the body the game would actually BUILD — every rule measures
// `Proportions.proportionsFor(spec)` (pure: half-widths, head unit, limb lengths in metres), never a
// private copy of the formulas — and turns them into a band per number:
//
//   waist<=hips       waist half-width        <= hip half-width                   (clamps waist AND hips)
//   waist<=shoulders  waist half-width        <= shoulder half-breadth            (clamps waist AND shoulders)
//                     (shoulder joint + deltoid radius: the shoulder knob scales the deltoid, Proportions)
//   head~height       skull half-width (m)    in HEAD_BAND x the race's skull at its mid height
//                     -> a taller body allows a relatively smaller head, a shorter one a bigger one
//                        (anthropometry: head size varies far less than stature)            (clamps head)
//   limbs~race        arm length x limbLength in LIMB_BAND x the race's arm at its mid height  (clamps limbLength)
//   weight~BMI        weight / height^2       in BMI_BAND x the race's mid BMI                 (clamps weight)
//
// Each rule names the numbers it CLAMPS. The number being edited is clamped by every rule that clamps
// it (its band comes from the neighbours' CURRENT values); a number a rule does not clamp is a DRIVER
// of that rule: changing it SETTLES the clamped ones (`settle`): a height edit pulls the weight into the
// new BMI band and the head into the new head band, instead of refusing the height.
//
// Feasible sets are intervals (every rule is monotone in each number inside the static bands), found
// by a sample + bisection scan of the static band, so the module needs no inverse of proportionsFor.
// Pure module: no DOM, no THREE, no Math.random.

import { proportionsFor, type BodyProportions } from "../graphics/body/Proportions.ts";
import { raceSilhouette, SILHOUETTE_TOP, type RaceSilhouette } from "../game/BodyProfile.ts";
import type { BodySpec } from "../graphics/body/contracts.ts";
import { heightBand, weightBand } from "./CreatorSync.ts";
import { SILHOUETTE_SPREAD } from "./CreatorTweak.ts";

/** The numbers the constraint system knows. Silhouette keys are the RaceSilhouette knobs. */
export type BodyKey = "height" | "weight" | "width" | "depth" | "muscle" | "shoulder" | "hip" | "waist" | "head" | "limbLength";
export const BODY_KEYS: readonly BodyKey[] = ["height", "weight", "width", "depth", "muscle", "shoulder", "hip", "waist", "head", "limbLength"];
type SilKey = Exclude<BodyKey, "height" | "weight">;
const SIL_KEYS: readonly SilKey[] = ["width", "depth", "muscle", "shoulder", "hip", "waist", "head", "limbLength"];

/** The body a constraint reads: identity (race, sub-race, sex) + the editable numbers. */
export interface BodyState {
  race: string;
  subrace: string | null;
  sex?: "male" | "female" | null;
  height: number;
  weight: number;
  silhouette: RaceSilhouette;
}

/** The head's absolute size band, x the race's own skull at its band's mid height. */
export const HEAD_BAND: readonly [number, number] = [0.85, 1.15];
/** The arm's absolute length band (arm x limbLength), x the race's arm at its band's mid height. */
export const LIMB_BAND: readonly [number, number] = [0.8, 1.2];
/** The body-mass-index band, x the race's mid BMI (mid weight / mid height^2 of its build bands). */
export const BMI_BAND: readonly [number, number] = [0.72, 1.4];
/** Slack below which a rule counts as broken (metres or BMI units; float noise of proportionsFor). */
export const RULE_EPS = 1e-9;

export interface Rule {
  id: string;
  label: string;
  /** The numbers this rule clamps (an edit of any other number SETTLES these). */
  clamps: readonly BodyKey[];
  /** Signed slack: >= 0 holds, < 0 broken (the size of the miss, in the rule's unit). */
  slack(s: BodyState, p: BodyProportions): number;
}

const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);

/** The spec a state builds (seed and class do not change a proportion). */
export function specOf(s: BodyState): BodySpec {
  return { race: s.race, subrace: s.subrace, className: "Warrior", height: s.height, weight: s.weight, seed: 1, sex: s.sex ?? null, silhouette: s.silhouette };
}

function propsOf(s: BodyState): BodyProportions {
  return proportionsFor(specOf(s));
}

/** The race's reference body at the middle of its build bands, race silhouette, same sex. */
function midRef(s: BodyState): BodyProportions {
  const hb = heightBand(s.race, s.subrace), wb = weightBand(s.race, s.subrace);
  return proportionsFor({ race: s.race, subrace: s.subrace, className: "Warrior", height: (hb[0] + hb[1]) / 2, weight: (wb[0] + wb[1]) / 2, seed: 1, sex: s.sex ?? null, silhouette: raceSilhouette(s.race, s.subrace) });
}
const midRefCache = new Map<string, BodyProportions>();
function midRefCached(s: BodyState): BodyProportions {
  const k = `${s.race}|${s.subrace ?? ""}|${s.sex ?? ""}`;
  let v = midRefCache.get(k);
  if (!v) { v = midRef(s); midRefCache.set(k, v); }
  return v;
}

/** The race's mid BMI (the centre of BMI_BAND). */
export function raceBmi(race: string, subrace: string | null): number {
  const hb = heightBand(race, subrace), wb = weightBand(race, subrace);
  const h = (hb[0] + hb[1]) / 2;
  return ((wb[0] + wb[1]) / 2) / (h * h);
}

const armOf = (p: BodyProportions) => p.upperArm + p.foreArm + p.hand;

export const RULES: readonly Rule[] = [
  { id: "waist<=hips", label: "waist no wider than the hips", clamps: ["waist", "hip"], slack: (_s, p) => p.halfWidth.hip - p.halfWidth.waist },
  { id: "waist<=shoulders", label: "waist no wider than the shoulders", clamps: ["waist", "shoulder"], slack: (_s, p) => p.halfWidth.shoulderJoint + p.radius.deltoid - p.halfWidth.waist },
  {
    id: "head~height", label: "head within its band of the height", clamps: ["head"],
    slack: (s, p) => { const ref = midRefCached(s).halfWidth.skull; const v = p.halfWidth.skull; return Math.min(v - HEAD_BAND[0] * ref, HEAD_BAND[1] * ref - v); },
  },
  {
    id: "limbs~race", label: "limb length within the race's band", clamps: ["limbLength"],
    slack: (s, p) => { const ref = armOf(midRefCached(s)); const v = armOf(p) * num(s.silhouette.limbLength, 1) / num(raceSilhouette(s.race, s.subrace).limbLength, 1); return Math.min(v - LIMB_BAND[0] * ref, LIMB_BAND[1] * ref - v); },
  },
  {
    id: "weight~bmi", label: "weight within the BMI band of the height", clamps: ["weight"],
    slack: (s) => { const c = raceBmi(s.race, s.subrace), b = s.weight / (s.height * s.height); return Math.min(b - BMI_BAND[0] * c, BMI_BAND[1] * c - b); },
  },
];

/** Read one number of a state. */
export function valueOf(s: BodyState, k: BodyKey): number {
  if (k === "height") return s.height;
  if (k === "weight") return s.weight;
  return num(s.silhouette[k], raceSilhouette(s.race, s.subrace)[k]);
}

/** A copy of the state with one number replaced. */
export function withValue(s: BodyState, k: BodyKey, v: number): BodyState {
  if (k === "height") return { ...s, height: v };
  if (k === "weight") return { ...s, weight: v };
  return { ...s, silhouette: { ...s.silhouette, [k]: v } };
}

/** The STATIC band of a number (wave X's: race build band, silhouette = race value ± SILHOUETTE_SPREAD, <= top). */
export function staticBand(s: BodyState, k: BodyKey): [number, number] {
  if (k === "height") return heightBand(s.race, s.subrace);
  if (k === "weight") return weightBand(s.race, s.subrace);
  const base = raceSilhouette(s.race, s.subrace)[k];
  const top = SILHOUETTE_TOP[k];
  const hi = Math.min(top, base * (1 + SILHOUETTE_SPREAD));
  return [Math.min(base * (1 - SILHOUETTE_SPREAD), hi), hi];
}

/** Every rule's slack on a state (id -> slack). */
export function slacks(s: BodyState): Record<string, number> {
  const p = propsOf(s);
  const out: Record<string, number> = {};
  for (const r of RULES) out[r.id] = r.slack(s, p);
  return out;
}

/** The ids of the rules a state breaks. */
export function violations(s: BodyState): string[] {
  const sl = slacks(s);
  return RULES.filter((r) => sl[r.id] < -RULE_EPS).map((r) => r.id);
}

/** The rules that clamp `k`. */
export function rulesClamping(k: BodyKey): Rule[] {
  return RULES.filter((r) => r.clamps.includes(k));
}

const SCAN = 40;
const BISECT = 22;

export interface Band {
  min: number;
  max: number;
  /** The static band before the neighbour rules. */
  staticMin: number;
  staticMax: number;
  /** The rule ids that made the band narrower than the static one (at its lower / upper end). */
  lowBy: string[];
  highBy: string[];
  /** False when no value of `k` satisfies its rules with the neighbours as they are (band = static then). */
  feasible: boolean;
}

/**
 * The band of `k` given every OTHER number as it is now: the static band intersected with each rule that
 * clamps `k`. Found by a SCAN-point scan + bisection at each edge (rules are monotone in one number inside
 * the static bands, so the feasible set is one interval; when it is not, the interval around the value
 * nearest to `s` is returned).
 */
export function bandFor(s: BodyState, k: BodyKey): Band {
  const [lo, hi] = staticBand(s, k);
  const rules = rulesClamping(k);
  const ok = (v: number) => { const t = withValue(s, k, v), p = propsOf(t); return rules.every((r) => r.slack(t, p) >= -RULE_EPS); };
  const failing = (v: number) => { const t = withValue(s, k, v), p = propsOf(t); return rules.filter((r) => r.slack(t, p) < -RULE_EPS).map((r) => r.id); };
  if (rules.length === 0 || hi <= lo) return { min: lo, max: hi, staticMin: lo, staticMax: hi, lowBy: [], highBy: [], feasible: true };
  const xs: number[] = [], oks: boolean[] = [];
  for (let i = 0; i <= SCAN; i++) { const v = lo + ((hi - lo) * i) / SCAN; xs.push(v); oks.push(ok(v)); }
  // The feasible run nearest the current value.
  const cur = Math.max(lo, Math.min(hi, valueOf(s, k)));
  let best = -1, bestD = Infinity;
  for (let i = 0; i <= SCAN; i++) if (oks[i]) { const d = Math.abs(xs[i] - cur); if (d < bestD) { bestD = d; best = i; } }
  if (best < 0) return { min: lo, max: hi, staticMin: lo, staticMax: hi, lowBy: failing(lo), highBy: failing(hi), feasible: false };
  let a = best, b = best;
  while (a > 0 && oks[a - 1]) a--;
  while (b < SCAN && oks[b + 1]) b++;
  const edge = (good: number, bad: number) => { let g = good, x = bad; for (let i = 0; i < BISECT; i++) { const m = (g + x) / 2; if (ok(m)) g = m; else x = m; } return { v: g, by: failing(x) }; };
  const low = a > 0 ? edge(xs[a], xs[a - 1]) : { v: lo, by: [] as string[] };
  const high = b < SCAN ? edge(xs[b], xs[b + 1]) : { v: hi, by: [] as string[] };
  return { min: low.v, max: high.v, staticMin: lo, staticMax: hi, lowBy: low.by, highBy: high.by, feasible: true };
}

/** Clamp a wanted value of `k` into its neighbour-dependent band; reports the rule that stopped it. */
export function constrain(s: BodyState, k: BodyKey, wanted: number): { value: number; clampedBy: string | null; band: Band } {
  const band = bandFor(s, k);
  const w = Number.isFinite(wanted) ? wanted : valueOf(s, k);
  if (w < band.min) return { value: band.min, clampedBy: band.lowBy[0] ?? (w < band.staticMin ? "static" : null), band };
  if (w > band.max) return { value: band.max, clampedBy: band.highBy[0] ?? (w > band.staticMax ? "static" : null), band };
  return { value: w, clampedBy: null, band };
}

/**
 * Apply an edit: clamp `k` to its band, then SETTLE every number a broken rule clamps (other than `k`)
 * into its own band, in BODY_KEYS order. Returns the new state and the numbers that moved besides `k`.
 */
export function applyEdit(s: BodyState, k: BodyKey, wanted: number): { state: BodyState; value: number; clampedBy: string | null; settled: BodyKey[] } {
  const c = constrain(s, k, wanted);
  let t = withValue(s, k, c.value);
  const settled: BodyKey[] = [];
  const res = settle(t, k);
  t = res.state;
  settled.push(...res.settled);
  return { state: t, value: c.value, clampedBy: c.clampedBy, settled };
}

/** Pull every number a broken rule clamps (except `keep`) into its band. Idempotent on a legal state. */
export function settle(s: BodyState, keep: BodyKey | null = null): { state: BodyState; settled: BodyKey[] } {
  let t = s;
  const settled: BodyKey[] = [];
  for (let pass = 0; pass < 2; pass++) {
    const broken = new Set(violations(t));
    if (broken.size === 0) break;
    for (const k of BODY_KEYS) {
      if (k === keep) continue;
      if (!rulesClamping(k).some((r) => broken.has(r.id))) continue;
      const v = valueOf(t, k), c = constrain(t, k, v);
      if (Math.abs(c.value - v) > 1e-12) { t = withValue(t, k, c.value); if (!settled.includes(k)) settled.push(k); }
    }
  }
  return { state: t, settled };
}

/** A state from loose creator data (missing silhouette keys = the race's own). */
export function bodyState(o: { race: string; subrace: string | null; sex?: "male" | "female" | null; height: number; weight: number; silhouette?: RaceSilhouette | null }): BodyState {
  const base = raceSilhouette(o.race, o.subrace);
  const sil = { ...base, ...(o.silhouette ?? {}) } as RaceSilhouette;
  for (const k of SIL_KEYS) if (!Number.isFinite(sil[k])) sil[k] = base[k];
  return { race: o.race, subrace: o.subrace, sex: o.sex ?? null, height: o.height, weight: o.weight, silhouette: sil };
}
