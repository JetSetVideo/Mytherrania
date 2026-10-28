// Race genes: the data-driven body-proportion model.
//
// A race is a set of per-part axis RANGES, plus a web of INFLUENCES: a neighbour's
// already-chosen value pulls this part's range toward it (or, with sign -1, away from
// it), scaled by a weight and clamped to the part's absolute legal bounds. The
// generator walks the body from the root outward, drawing each part inside the range
// its drawn parents and neighbours imply, then checks the result against the race's
// named RATIOS so a silhouette that breaks the race's proportions is rejected before
// it is ever built.
//
// Pure module: no Three.js, no DOM. Reads artifacts/design/race-genes.json.
// The engine's entry point is `randomRaceBody`; `checkRatios` is the rejection gate.

import genesRaw from "../../artifacts/design/race-genes.json" with { type: "json" };

type Axis = "x" | "y" | "z";
interface Range { min: number; max: number }
interface Influence { part: string; axis: Axis; weight: number; sign: number }
interface GenePart {
  axis: Record<Axis, Range>;
  parent: string | null;
  children: string[];
  neighbours: string[];
  influences: Influence[];
}
interface RatioDef {
  label: string;
  numerator: string;
  denominator: string;
  bounds: Range;
  perRace: Record<string, number>;
  note: string;
}
interface RaceGene {
  stature: number;
  parts: Record<string, { axis: Record<Axis, Range> }>;
  ratioTargets: Record<string, number>;
}
interface GeneData {
  version: number;
  units: string;
  axes: Axis[];
  parts: Record<string, GenePart>;
  ratios: Record<string, RatioDef>;
  races: Record<string, RaceGene>;
}
type AxisValues = Partial<Record<Axis, number>>;
type ValueMap = Record<string, AxisValues>;
type BodyValues = Record<string, Record<Axis, number>>;

const DATA = genesRaw as unknown as GeneData;
const AXES: Axis[] = ["x", "y", "z"];
const FALLBACK: Range = { min: 0, max: 1 };
/** How many independent rolls the generator makes before keeping the best. */
const RESTARTS = 16;
/** Ratio-repair sweeps per roll. */
const REPAIR_PASSES = 6;
/** Fraction of a range's half-width an influence of weight 1 removes (the "tighten"). */
const NARROW = 0.5;

function isNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
/** A range that is always finite and ordered, falling back field-by-field. */
function sane(r: Range | undefined, fb: Range = FALLBACK): Range {
  if (!r) return { ...fb };
  const min = isNum(r.min) ? r.min : fb.min;
  const max = isNum(r.max) ? r.max : fb.max;
  return min <= max ? { min, max } : { min: max, max: min };
}
function partOf(part: string): GenePart | undefined {
  return DATA.parts?.[part];
}
/**
 * The legal envelope for an axis: the union of every race's band.
 *
 * NOT `axisRange`, which returns the top-level entry — that is the HUMAN reference, not a
 * bound. An elf's chest is narrower than a human's (0.2507 vs 0.2848), so clamping an
 * influenced elf value into the human band shoved its centre AWAY from its own influences
 * and made the range travel in the wrong direction. The envelope contains every race by
 * construction, so the clamp can only trim a value no race could legally take.
 */
function envelope(part: string, axis: Axis, fallback: Range): Range {
  let min = Infinity;
  let max = -Infinity;
  for (const race of Object.values(DATA.races)) {
    const a = race.parts?.[part]?.axis?.[axis];
    if (a && Number.isFinite(a.min) && Number.isFinite(a.max)) {
      min = Math.min(min, a.min);
      max = Math.max(max, a.max);
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : fallback;
}

function axisRange(part: string, axis: Axis): Range | undefined {
  return partOf(part)?.axis?.[axis];
}
function valueAt(values: ValueMap | undefined, part: string, axis: Axis): number | undefined {
  const v = values?.[part]?.[axis];
  return isNum(v) ? v : undefined;
}

/**
 * The part's own axis range for a race: the race's override when it has one, else the
 * part's baseline. Always finite and ordered, so a missing or malformed entry cannot
 * leak a NaN into a draw.
 */
export function resolvePartAxis(part: string, axis: Axis, race: string): { min: number; max: number } {
  const raceRange = DATA.races?.[race]?.parts?.[part]?.axis?.[axis];
  const base = axisRange(part, axis);
  return sane(raceRange ?? base);
}

/**
 * THE CORE EQUATION. Start from the part's base range and let every influence on this
 * axis push it: an influence moves the range's centre toward the influencing part's
 * already-chosen value on that axis (or away from it when sign is -1), by weight of the
 * way to it, and tightens the band by the same weight. The result is clamped to the
 * part's absolute bounds, so no chain of influences can ever push a part outside its
 * legal range. Non-finite inputs fall back rather than produce NaN.
 */
export function applyInfluences(
  part: string,
  axis: Axis,
  values: ValueMap,
  race: string,
): { min: number; max: number } {
  const base = resolvePartAxis(part, axis, race);
  const abs = sane(envelope(part, axis, base), base);
  const centre0 = (base.min + base.max) / 2;
  let half = Math.max(0, (base.max - base.min) / 2);
  let centre = centre0;
  for (const inf of partOf(part)?.influences ?? []) {
    if (inf.axis !== axis) continue;
    const v = valueAt(values, inf.part, inf.axis);
    if (v === undefined) continue;
    const w = isNum(inf.weight) ? clamp(inf.weight, 0, 1) : 0;
    const sign = inf.sign === -1 ? -1 : 1;
    centre += sign * w * (v - centre0);
    half *= 1 - NARROW * w;
  }
  const c = clamp(centre, abs.min, abs.max);
  const min = Math.max(abs.min, c - half);
  const max = Math.min(abs.max, c + half);
  return min <= max ? { min, max } : { min: max, max: min };
}

/**
 * Evaluate a named ratio from resolved part axis values for a race. A numerator or
 * denominator is either "part.axis" or another ratio id. Missing part values fall back
 * to the midpoint of that part's race range; a zero or non-finite denominator falls
 * back to the ratio's per-race value. Never NaN.
 */
export function ratioValue(id: string, parts: ValueMap, race: string): number {
  const ratio = DATA.ratios?.[id];
  if (!ratio) return 0;
  const n = resolveRef(ratio.numerator, parts, race);
  const d = resolveRef(ratio.denominator, parts, race);
  if (isNum(n) && isNum(d) && d !== 0) {
    const value = n / d;
    return isNum(value) ? value : perRaceValue(ratio, race);
  }
  return perRaceValue(ratio, race);
}

function perRaceValue(ratio: RatioDef, race: string): number {
  const v = ratio.perRace?.[race];
  return isNum(v) ? v : 0;
}

function resolveRef(ref: string, parts: ValueMap, race: string): number {
  const dot = ref.indexOf(".");
  if (dot < 0) return ratioValue(ref, parts, race);
  const part = ref.slice(0, dot);
  const axis = ref.slice(dot + 1) as Axis;
  const direct = valueAt(parts, part, axis);
  if (direct !== undefined) return direct;
  const r = resolvePartAxis(part, axis, race);
  return (r.min + r.max) / 2;
}

/**
 * Every ratio whose value falls outside its bounds — the generator's rejection gate.
 * A silhouette with a non-empty report is thrown away.
 */
export function checkRatios(
  values: ValueMap,
  race: string,
): { id: string; value: number; min: number; max: number }[] {
  const out: { id: string; value: number; min: number; max: number }[] = [];
  for (const id of Object.keys(DATA.ratios ?? {})) {
    const bounds = sane(DATA.ratios[id]?.bounds);
    const value = ratioValue(id, values, race);
    if (value < bounds.min || value > bounds.max) out.push({ id, value, min: bounds.min, max: bounds.max });
  }
  return out;
}

/** Draw the whole body for a race. Several rolls are made and the best kept. */
export function randomRaceBody(race: string, rng: () => number): Record<string, Record<Axis, number>> {
  let best: BodyValues | null = null;
  let bestViolations = Infinity;
  for (let i = 0; i < RESTARTS; i++) {
    const cand = buildBody(race, rng);
    repairRatios(race, cand);
    const violations = checkRatios(cand, race).length;
    if (violations < bestViolations) {
      best = cand;
      bestViolations = violations;
    }
    if (bestViolations === 0) break;
  }
  return best ?? {};
}

/** Walk the body from the root outward, drawing each axis inside its resolved range. */
function buildBody(race: string, rng: () => number): BodyValues {
  const body: BodyValues = {};
  for (const part of walkOrder()) {
    const row: Record<Axis, number> = { x: 0, y: 0, z: 0 };
    for (const axis of AXES) {
      const range = applyInfluences(part, axis, body, race);
      const abs = sane(envelope(part, axis, range), range);
      const roll = rng();
      const t = isNum(roll) ? clamp(roll, 0, 1) : 0.5;
      const drawn = range.min + t * (range.max - range.min);
      row[axis] = clamp(drawn, abs.min, abs.max);
    }
    body[part] = row;
  }
  return body;
}

/** Root-first order: breadth-first over the parent/children tree, then any leftovers. */
function walkOrder(): string[] {
  const parts = DATA.parts ?? {};
  const names = Object.keys(parts);
  const roots = names.filter((p) => {
    const parent = parts[p]?.parent;
    return !parent || !parts[parent];
  });
  const seen = new Set<string>();
  const queue = [...roots];
  const out: string[] = [];
  while (queue.length > 0) {
    const part = queue.shift()!;
    if (seen.has(part)) continue;
    seen.add(part);
    out.push(part);
    for (const child of parts[part]?.children ?? []) {
      if (parts[child] && !seen.has(child)) queue.push(child);
    }
  }
  for (const name of names) if (!seen.has(name)) out.push(name);
  return out;
}

/** Nudge parts toward their race's ratio targets to clear out-of-range ratios. */
function repairRatios(race: string, body: BodyValues): void {
  for (let pass = 0; pass < REPAIR_PASSES; pass++) {
    const bad = checkRatios(body, race);
    if (bad.length === 0) return;
    for (const v of bad) {
      const ratio = DATA.ratios?.[v.id];
      if (!ratio) continue;
      const target = targetFor(v.id, ratio, race);
      if (!isNum(v.value) || v.value <= 0 || !isNum(target) || target <= 0) continue;
      const factor = clamp(target / v.value, 0.5, 2);
      scaleRef(ratio.numerator, body, Math.sqrt(factor));
      scaleRef(ratio.denominator, body, 1 / Math.sqrt(factor));
    }
  }
}

/** The ratio's target for a race (keyed by ratio id), else the midpoint of its bounds. */
function targetFor(id: string, ratio: RatioDef, race: string): number {
  const t = DATA.races?.[race]?.ratioTargets?.[id];
  if (isNum(t)) return t;
  const b = sane(ratio.bounds);
  return (b.min + b.max) / 2;
}

/** Scale one direct "part.axis" reference, clamped to that part's absolute bounds. */
function scaleRef(ref: string, body: BodyValues, factor: number): void {
  const dot = ref.indexOf(".");
  if (dot < 0) return;
  const part = ref.slice(0, dot);
  const axis = ref.slice(dot + 1) as Axis;
  const cur = body?.[part]?.[axis];
  if (!isNum(cur)) return;
  const abs = sane(envelope(part, axis, { min: cur, max: cur }), { min: cur, max: cur });
  body[part][axis] = clamp(cur * factor, abs.min, abs.max);
}
