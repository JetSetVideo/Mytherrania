// MarkEdit (Wave TEX, lane U): the Marks panel's editing model — pure (no DOM, no THREE, no Math.random).
//
// The profile stores M's MarkSet (`appearance.marks = { scars: Scar[], tattoos: Tattoo[] }`, contract C-MARK,
// board Z-15). ABSENT means "the generated defaults" (M rolls them from race/sub-race/class/sign/age/seed);
// the first user edit MATERIALISES the shown set (defaults included) so what the user saw is what is saved.
// Every reader is TOTAL (saves are user-editable): garbage in -> a valid MarkSet out.
//
// The panel addresses one mark as a `MarkRef` = { type, index } into the set's two arrays.

import type { Region } from "../graphics/body/contracts.ts";
import { HYPERTROPHIC_ACTIVE, hypertrophicActivity, resolveHypertrophic, resolveKeloid, SCAR_KINDS, type Scar, type ScarKind, scarStage, type ScarStage, scarStageOf } from "../graphics/paint/marks/Scar.ts";
import { INK_NAMES, type InkName, TATTOO_STYLES, type Tattoo, type TattooStyle } from "../graphics/paint/marks/Tattoo.ts";
import { TATTOO_SYMBOLS, type TattooSymbol } from "../graphics/paint/Symbols.ts";
import { MARK_REGIONS, TATTOO_REGIONS } from "../graphics/paint/marks/Placement.ts";
import { PAIRED_REGIONS as PATTERN_PAIRED } from "../graphics/paint/Patterns.ts";

export { INK_NAMES, SCAR_KINDS, TATTOO_STYLES, TATTOO_SYMBOLS };
export type { InkName, ScarKind, TattooStyle, TattooSymbol };
/** M's tattoo record (C-MARK). */
export type TattooRec = Tattoo;
export interface MarkSetRec { scars: Scar[]; tattoos: TattooRec[] }
export type MarkType = "scar" | "tattoo";
export interface MarkRef { type: MarkType; index: number }

/** Skin regions a mark may sit on (M's Placement lists: tattoos skip the ears and the scalp). */
export { MARK_REGIONS, TATTOO_REGIONS };
/** Regions that come in a left/right pair (the side picker shows only for these). */
export const PAIRED_REGIONS: readonly Region[] = PATTERN_PAIRED as readonly Region[];
/** The regions a mark of this type may be put on. */
export function regionsFor(type: MarkType): readonly Region[] { return type === "tattoo" ? TATTOO_REGIONS : MARK_REGIONS; }

/** Editable ranges (UI bands; M's solver may refuse a placement inside them, e.g. overlap). */
export const MARK_RANGES = {
  scarLengthMm: [3, 300, 1],
  scarWidthMm: [1, 40, 0.5],
  scarAgeDays: [0, 20000, 1],
  tattooSizeMm: [10, 220, 1],
  tattooAgeYears: [0, 80, 0.5],
  angleDeg: [-90, 90, 5],
  anchor: [-1, 1, 0.02],
} as const;
export const MAX_MARKS = { scars: 12, tattoos: 8 } as const;

export const MARK_KIND_LABEL: Readonly<Record<ScarKind | TattooStyle, string>> = {
  incision: "Incision", laceration: "Laceration", claw: "Claw", puncture: "Puncture", burn: "Burn", stitched: "Stitched",
  tribal: "Tribal", runic: "Runic", sigil: "Sigil", band: "Band", script: "Script", dotwork: "Dotwork",
};
export const INK_LABEL: Readonly<Record<InkName, string>> = { black: "Black", blueBlack: "Blue-black", red: "Red", ochre: "Ochre (earth)", woad: "Woad (plant blue)" };

/** M's healing stage of a scar in the player's words (QD Z-93: the visible change happens in the first year). */
export const STAGE_TEXT: Readonly<Record<ScarStage, string>> = {
  inflammatory: "fresh: red, swollen", proliferative: "healing: pink", remodelling: "maturing: fading", mature: "mature: pale, flat",
};
/**
 * The stage words of a scar. Without flags: M's stage by age (unchanged). With the RESOLVED keloid / hypertrophic flags
 * (wave TEX closing, F; QD Z-115): a scar still raised by its pathology past a year never reads "mature: pale, flat".
 */
export function scarStageText(ageDays: number, flags: { keloid?: boolean; hypertrophic?: boolean } = {}): string {
  const a = Math.max(0, ageDays);
  const st = scarStageOf(a, !!flags.keloid, !!flags.hypertrophic);
  if (st !== scarStage(a)) return flags.keloid ? "keloid: raised, dark pink (does not fade)" : "maturing: raised, pink (flattens over 1-2 years)";
  // Parent fix after QD Z-141: from the proliferative stage on, a keloid or an ACTIVE hypertrophic scar is raised
  // whatever its age, so it never reads "fading" (21-365 days used to).
  if (a >= 21 && flags.keloid) return "keloid: raised, dark pink (does not fade)";
  if (a >= 21 && flags.hypertrophic && hypertrophicActivity(a) >= HYPERTROPHIC_ACTIVE) return "maturing: raised, pink (flattens over 1-2 years)";
  return STAGE_TEXT[st];
}
/** The resolved keloid / hypertrophic flags of a scar on a fighter (M's seeded rolls when the scar leaves them unset). */
export function scarFlags(s: Scar, race: string, subrace: string | null | undefined): { keloid: boolean; hypertrophic: boolean } {
  const keloid = resolveKeloid(s, race, subrace);
  return { keloid, hypertrophic: resolveHypertrophic(s, race, subrace, keloid) };
}
/** Swatch colours (sRGB, the UI chip only; M's ink model owns the rendered colour). */
export const INK_SWATCH: Readonly<Record<InkName, string>> = { black: "#1b1a1f", blueBlack: "#1d2433", red: "#8e2b25", ochre: "#a8742a", woad: "#2f4f7a" };
export const REGION_LABEL: Readonly<Record<string, string>> = {
  head: "Scalp", face: "Face", ear: "Ear", neck: "Neck", torso: "Chest & back", pelvis: "Hips", upperArm: "Upper arm",
  foreArm: "Forearm", hand: "Hand", thigh: "Thigh", shin: "Shin", foot: "Foot",
};

const fin = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clampTo = (v: number, r: readonly [number, number, number] | readonly number[]) => Math.max(r[0], Math.min(r[1], v));
const isRegion = (r: unknown): r is Region => typeof r === "string" && (MARK_REGIONS as readonly string[]).includes(r);
const isTattooRegion = (r: unknown): r is Region => typeof r === "string" && (TATTOO_REGIONS as readonly string[]).includes(r);
const DEG = Math.PI / 180;

function anchorOf(a: unknown): [number, number] {
  const arr = Array.isArray(a) ? a : [];
  return [clampTo(fin(arr[0], 0), MARK_RANGES.anchor), clampTo(fin(arr[1], 0), MARK_RANGES.anchor)];
}
function angleOf(a: unknown): number | null {
  if (a === null || a === undefined) return null;
  const v = fin(a, NaN);
  if (!Number.isFinite(v)) return null;
  // radians, wrapped to (-pi/2, pi/2] (a line has no direction); idempotent on an already-wrapped value
  if (v > -Math.PI / 2 && v <= Math.PI / 2) return v;
  let r = ((v % Math.PI) + Math.PI) % Math.PI;
  if (r > Math.PI / 2) r -= Math.PI;
  return r;
}
function sideOf(region: Region, s: unknown): 0 | 1 | undefined {
  if (!(PAIRED_REGIONS as readonly string[]).includes(region)) return undefined;
  return s === 1 ? 1 : 0;
}

/** One saved scar, sanitised (null = unusable). */
export function parseScar(raw: unknown): Scar | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!(SCAR_KINDS as readonly string[]).includes(o.kind as string) || !isRegion(o.region)) return null;
  const s: Scar = {
    kind: o.kind as ScarKind, region: o.region, anchor: anchorOf(o.anchor),
    lengthMm: clampTo(fin(o.lengthMm, 40), MARK_RANGES.scarLengthMm), widthMm: clampTo(fin(o.widthMm, 4), MARK_RANGES.scarWidthMm),
    angle: angleOf(o.angle), ageDays: clampTo(Math.round(fin(o.ageDays, 400)), MARK_RANGES.scarAgeDays), seed: Math.floor(fin(o.seed, 1)) | 0,
  };
  const side = sideOf(s.region, o.side);
  if (side !== undefined) s.side = side;
  if (typeof o.keloid === "boolean") s.keloid = o.keloid;
  if (o.mirror === true) s.mirror = true;
  return s;
}

/** One saved tattoo, sanitised (null = unusable). */
export function parseTattoo(raw: unknown): TattooRec | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!(TATTOO_STYLES as readonly string[]).includes(o.style as string) || !isTattooRegion(o.region)) return null;
  const inks = (Array.isArray(o.inks) ? o.inks : []).filter((i): i is InkName => (INK_NAMES as readonly string[]).includes(i as string)).slice(0, 2);
  const t: TattooRec = {
    style: o.style as TattooStyle, motif: (TATTOO_SYMBOLS as readonly string[]).includes(o.motif as string) ? o.motif as TattooSymbol : TATTOO_SYMBOLS[0],
    region: o.region, anchor: anchorOf(o.anchor), sizeMm: clampTo(fin(o.sizeMm, 60), MARK_RANGES.tattooSizeMm), angle: angleOf(o.angle),
    inks: inks.length ? inks : ["black"], ageYears: clampTo(fin(o.ageYears, 5), MARK_RANGES.tattooAgeYears), seed: Math.floor(fin(o.seed, 1)) | 0,
  };
  const side = sideOf(t.region, o.side);
  if (side !== undefined) t.side = side;
  if (o.mirror === true) t.mirror = true;
  if (o.facial === true || t.region === "face") t.facial = true;
  return t;
}

/** A saved MarkSet, sanitised; undefined when the profile has none (= the generated defaults). */
export function parseMarkSet(raw: unknown): MarkSetRec | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const scars = (Array.isArray(o.scars) ? o.scars : []).map(parseScar).filter((s): s is Scar => s !== null).slice(0, MAX_MARKS.scars);
  const tattoos = (Array.isArray(o.tattoos) ? o.tattoos : []).map(parseTattoo).filter((t): t is TattooRec => t !== null).slice(0, MAX_MARKS.tattoos);
  return { scars, tattoos };
}

/** Deterministic seed for a new mark: a hash of the set's size and the profile name (no Math.random). */
export function newMarkSeed(set: MarkSetRec, salt: string): number {
  let h = 0x811c9dc5 ^ (set.scars.length * 131 + set.tattoos.length * 7919);
  for (let i = 0; i < salt.length; i++) h = Math.imul(h ^ salt.charCodeAt(i), 16777619);
  for (const s of set.scars) h = Math.imul(h ^ s.seed, 16777619);
  for (const t of set.tattoos) h = Math.imul(h ^ t.seed, 16777619);
  return (h ^ (h >>> 15)) | 0; // signed int32, as M's sanitizeMarks stores a seed
}

/** Add a scar or a tattoo with sensible defaults (on the left forearm; the user then places it). null = list full. */
export function addMark(set: MarkSetRec, type: MarkType, salt = "", motif: TattooSymbol = TATTOO_SYMBOLS[0]): { set: MarkSetRec; ref: MarkRef } | null {
  const seed = newMarkSeed(set, salt);
  if (type === "scar") {
    if (set.scars.length >= MAX_MARKS.scars) return null;
    const s: Scar = { kind: "laceration", region: "foreArm", side: 0, anchor: [0, 0], lengthMm: 45, widthMm: 4, angle: null, ageDays: 400, seed };
    return { set: { scars: [...set.scars, s], tattoos: set.tattoos.slice() }, ref: { type, index: set.scars.length } };
  }
  if (set.tattoos.length >= MAX_MARKS.tattoos) return null;
  const t: TattooRec = { style: "runic", motif, region: "upperArm", side: 0, anchor: [0, 0], sizeMm: 60, angle: null, inks: ["black"], ageYears: 3, seed };
  return { set: { scars: set.scars.slice(), tattoos: [...set.tattoos, t] }, ref: { type, index: set.tattoos.length } };
}

export function removeMark(set: MarkSetRec, ref: MarkRef): MarkSetRec {
  return ref.type === "scar"
    ? { scars: set.scars.filter((_, i) => i !== ref.index), tattoos: set.tattoos.slice() }
    : { scars: set.scars.slice(), tattoos: set.tattoos.filter((_, i) => i !== ref.index) };
}

export function getMark(set: MarkSetRec, ref: MarkRef | null): Scar | TattooRec | null {
  if (!ref) return null;
  return (ref.type === "scar" ? set.scars[ref.index] : set.tattoos[ref.index]) ?? null;
}

/** A patch of UI fields (degrees for the angle, `auto` = Langer's line / M's default). */
export interface MarkPatch {
  kind?: string; region?: string; side?: 0 | 1; anchor?: [number, number]; size?: number; width?: number;
  angleDeg?: number | "auto"; age?: number; ink?: string; ink2?: string | null; mirror?: boolean; motif?: string;
}

/** Apply a patch to one mark; every value re-sanitised through the parsers (a bad patch is a no-op field). */
export function updateMark(set: MarkSetRec, ref: MarkRef, p: MarkPatch): MarkSetRec {
  const cur = getMark(set, ref);
  if (!cur) return { scars: set.scars.slice(), tattoos: set.tattoos.slice() };
  const next: Record<string, unknown> = { ...cur };
  if (p.region !== undefined && (ref.type === "tattoo" ? isTattooRegion(p.region) : isRegion(p.region)) && p.region !== cur.region) { next.region = p.region; if (!p.anchor) next.anchor = [0, 0]; }
  if (p.side !== undefined) next.side = p.side;
  if (p.anchor) next.anchor = p.anchor;
  if (p.angleDeg !== undefined) next.angle = p.angleDeg === "auto" ? null : p.angleDeg * DEG;
  if (p.mirror !== undefined) next.mirror = p.mirror;
  if (ref.type === "scar") {
    if (p.kind !== undefined) next.kind = p.kind;
    if (p.size !== undefined) next.lengthMm = p.size;
    if (p.width !== undefined) next.widthMm = p.width;
    if (p.age !== undefined) next.ageDays = p.age;
    const s = parseScar(next) ?? cur as Scar;
    if (p.mirror === false) delete s.mirror;
    return { scars: set.scars.map((x, i) => (i === ref.index ? s : x)), tattoos: set.tattoos.slice() };
  }
  if (p.kind !== undefined) next.style = p.kind;
  if (p.size !== undefined) next.sizeMm = p.size;
  if (p.age !== undefined) next.ageYears = p.age;
  if (p.motif !== undefined) next.motif = p.motif;
  if (p.ink !== undefined || p.ink2 !== undefined) {
    const inks = [...((cur as TattooRec).inks ?? ["black"])];
    if (p.ink !== undefined) inks[0] = p.ink as InkName;
    if (p.ink2 !== undefined) { if (p.ink2 === null || p.ink2 === "") inks.length = 1; else inks[1] = p.ink2 as InkName; }
    next.inks = inks;
  }
  if (next.region !== "face") delete next.facial;
  const t = parseTattoo(next) ?? cur as TattooRec;
  if (p.mirror === false) delete t.mirror;
  return { scars: set.scars.slice(), tattoos: set.tattoos.map((x, i) => (i === ref.index ? t : x)) };
}

/** The flat list the panel shows: one row per mark, in the order scars then tattoos. */
export function markRows(set: MarkSetRec): { ref: MarkRef; label: string; detail: string }[] {
  const rows: { ref: MarkRef; label: string; detail: string }[] = [];
  set.scars.forEach((s, i) => rows.push({ ref: { type: "scar", index: i }, label: `${MARK_KIND_LABEL[s.kind]} scar`, detail: `${regionText(s.region, s.side)} · ${Math.round(s.lengthMm)} mm · ${ageText("scar", s.ageDays)}${s.mirror ? " · mirrored" : ""}` }));
  set.tattoos.forEach((t, i) => rows.push({ ref: { type: "tattoo", index: i }, label: `${MARK_KIND_LABEL[t.style]} tattoo`, detail: `${regionText(t.region, t.side)} · ${Math.round(t.sizeMm)} mm · ${t.inks.map((k) => INK_LABEL[k]).join(" + ")}${t.mirror ? " · mirrored" : ""}` }));
  return rows;
}

export function regionText(region: Region, side?: 0 | 1): string {
  const name = REGION_LABEL[region] ?? region;
  return (PAIRED_REGIONS as readonly string[]).includes(region) ? `${side === 1 ? "right" : "left"} ${name.toLowerCase()}` : name;
}

export function ageText(type: MarkType, age: number): string {
  if (type === "tattoo") return age < 1 ? "fresh" : `${Math.round(age * 10) / 10} y`;
  if (age < 21) return `${age} d (fresh)`;
  if (age < 365) return `${Math.round(age / 7)} wk`;
  return `${Math.round((age / 365) * 10) / 10} y`;
}

/** The angle a mark shows in the UI, degrees (null = auto / Langer's line). */
export function angleDegOf(m: { angle?: number | null }): number | null {
  return m.angle === null || m.angle === undefined ? null : Math.round(m.angle / DEG);
}

/** Stable JSON of a set (the save + preview key form). */
export function markSetKey(set: MarkSetRec | undefined): string {
  return set ? JSON.stringify(set) : "";
}
