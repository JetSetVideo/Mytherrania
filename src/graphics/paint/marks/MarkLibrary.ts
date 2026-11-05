// MarkLibrary: mark sets, generated defaults and the compilers to the material system (wave TEX,
// lane M, contract C-MARK).
//
// Pure module: no THREE, no DOM, no Math.random.
//
//   MarkSet                  what Appearance.marks stores: { scars, tattoos } (sanitized on load)
//   defaultMarks(input)      the generated marks of a character from race / sub-race / class / birth
//                            sign / age / seed (deterministic; placement solved on nominal frames)
//   resolveMarks(set, ctx)   mirrors expanded, Langer angles and keloids resolved, looks and ink ages
//                            computed, placement validated (and movable marks moved)
//   marksToDecals(...)       (b) the fragment decal list in R's FragmentDecal layout (<= DECAL_MAX)
//   markFields / marksToLayers (a) per-vertex low-frequency contributions through L's layer API
//   hairlessAt / hairlessMask the follicle-free scar lines for the hair pass (docs/wave-x/HAIR.md)
//
// Per-vertex vs per-fragment: the skin's vertices are 22-35 mm apart, so a scar line or a tattoo
// stroke only exists in the fragment pass. The vertex layers carry what is broad: the pink
// perilesional halo of a fresh wound (and of a fresh tattoo), the keloid's swelling, the shine
// and the hairless zone; a mark whose decal fell outside the 16-decal budget falls back to a
// faint vertex tint of its mean coverage so it never vanishes.

import { REGIONS, type MeshData, type Region, type Vec3 } from "../../body/contracts.ts";
import { lifespanOf, ADULT_FRACTION } from "../../../game/Age.ts";
import { rng32 } from "../../../core/MathCore.ts";
import { DECAL_MAX, type FragmentDecal, HEIGHT_LIMIT, STROKES_MAX } from "../../shaders/MaterialChannels.ts";
import type { Layer, ChannelWrite } from "../LayerStack.ts";
import type { MarkField } from "../MaskAlgebra.ts";
import { TATTOO_SYMBOLS, symbolIndex, type TattooSymbol } from "../Symbols.ts";
import {
  type FaceAnchorsLike, faceZones, type Footprint, frameMmToPoint, frameOf, isPaired, markExtentMm, MARK_REGIONS, nominalFrames,
  type PlacementIssue, type PlacementItem, type PlacementResult, pointToFrameMm, REGION_BOUNDS, type RegionFrame, regionFrames,
  type RegionFrames, solvePlacement, TATTOO_REGIONS, uvToMm, wrapU,
} from "./Placement.ts";
import {
  gapeFactor, hypertrophicChance, keloidChance, langerAngle, type LangerFace, markHash, resolveHypertrophic, resolveKeloid, RED_TINT, SCAR_KINDS, type Scar, type ScarKind,
  scarColour, scarExtentMm, scarFootprintStats, type ScarLook, scarLook, sampleScar, type ScarSample, SUTURE_PITCH_MM,
  clawLines,
} from "./Scar.ts";
import {
  biologicalYears, dotScale, DOT_PITCH_MM, DOT_RADIUS_MM, INK_NAMES, inkAge, type InkAge, type InkName, motifsFor, RACE_INKS,
  runeCount, STYLE_STROKE, type Tattoo, TATTOO_STYLES, tattooDensity, tattooExtentMm, type TattooStyle,
} from "./Tattoo.ts";

/**
 * What Appearance.marks stores. `generated` marks a set made by defaultMarks: its marks may be MOVED
 * by the solver on the real body (a user-edited set should drop the flag: its marks stay put).
 */
export interface MarkSet { scars: Scar[]; tattoos: Tattoo[]; generated?: boolean }

export function emptyMarks(): MarkSet { return { scars: [], tattoos: [] }; }

/** Legal ranges of the editable numbers (the creator's sliders; sanitize clamps into them). */
export const MARK_RANGES = {
  lengthMm: [2, 300], widthMm: [0.5, 120], sizeMm: [8, 220], ageDays: [0, 400000], ageYears: [0, 1000],
} as const;

/** Most marks a set may carry (sanitize truncates). */
export const MAX_SCARS = 12;
export const MAX_TATTOOS = 8;

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const clampN = (x: unknown, lo: number, hi: number, d: number) => (isNum(x) ? Math.min(hi, Math.max(lo, x)) : d);

function sanitizeAnchor(a: unknown): [number, number] {
  const arr = Array.isArray(a) ? a : [];
  return [clampN(arr[0], -1, 1, 0), clampN(arr[1], -1, 1, 0)];
}
function sanitizeSide(x: unknown): 0 | 1 | undefined { return x === 0 || x === 1 ? x : undefined; }
function sanitizeAngle(x: unknown): number | null { return isNum(x) ? x : null; }

/**
 * Validate an untrusted value (a save) into a MarkSet: unknown kinds/styles/regions/inks drop the
 * mark, numbers clamp into MARK_RANGES, lists truncate to MAX_*. null when `raw` is not an object.
 * Optional fields that were absent stay absent, so a sanitized set round-trips byte-identically.
 */
export function sanitizeMarks(raw: unknown): MarkSet | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { scars?: unknown; tattoos?: unknown };
  const scars: Scar[] = [];
  for (const s0 of Array.isArray(r.scars) ? r.scars : []) {
    if (!s0 || typeof s0 !== "object") continue;
    const s = s0 as Record<string, unknown>;
    if (!(SCAR_KINDS as readonly string[]).includes(s.kind as string)) continue;
    if (!(MARK_REGIONS as readonly string[]).includes(s.region as string)) continue;
    const out: Scar = {
      kind: s.kind as ScarKind, region: s.region as Region, anchor: sanitizeAnchor(s.anchor),
      lengthMm: clampN(s.lengthMm, ...MARK_RANGES.lengthMm, 40), widthMm: clampN(s.widthMm, ...MARK_RANGES.widthMm, 3),
      ageDays: clampN(s.ageDays, ...MARK_RANGES.ageDays, 400), seed: isNum(s.seed) ? Math.floor(s.seed) | 0 : 0,
    };
    const side = sanitizeSide(s.side); if (side !== undefined) out.side = side;
    if ("angle" in s) out.angle = sanitizeAngle(s.angle);
    if ("keloid" in s) out.keloid = typeof s.keloid === "boolean" ? s.keloid : null;
    if ("hypertrophic" in s) out.hypertrophic = typeof s.hypertrophic === "boolean" ? s.hypertrophic : null;
    if ("mirror" in s) out.mirror = s.mirror === true;
    scars.push(out);
    if (scars.length >= MAX_SCARS) break;
  }
  const tattoos: Tattoo[] = [];
  for (const t0 of Array.isArray(r.tattoos) ? r.tattoos : []) {
    if (!t0 || typeof t0 !== "object") continue;
    const t = t0 as Record<string, unknown>;
    if (!(TATTOO_STYLES as readonly string[]).includes(t.style as string)) continue;
    if (!(TATTOO_REGIONS as readonly string[]).includes(t.region as string)) continue;
    if (!(TATTOO_SYMBOLS as readonly string[]).includes(t.motif as string)) continue;
    const inks = (Array.isArray(t.inks) ? t.inks : []).filter((i): i is InkName => (INK_NAMES as readonly unknown[]).includes(i)).slice(0, 2);
    const out: Tattoo = {
      style: t.style as TattooStyle, motif: t.motif as TattooSymbol, region: t.region as Region, anchor: sanitizeAnchor(t.anchor),
      sizeMm: clampN(t.sizeMm, ...MARK_RANGES.sizeMm, 50), inks: inks.length ? inks : ["black"],
      ageYears: clampN(t.ageYears, ...MARK_RANGES.ageYears, 5), seed: isNum(t.seed) ? Math.floor(t.seed) | 0 : 0,
    };
    const side = sanitizeSide(t.side); if (side !== undefined) out.side = side;
    if ("angle" in t) out.angle = sanitizeAngle(t.angle);
    if ("mirror" in t) out.mirror = t.mirror === true;
    if ("facial" in t) out.facial = t.facial === true;
    tattoos.push(out);
    if (tattoos.length >= MAX_TATTOOS) break;
  }
  const out: MarkSet = { scars, tattoos };
  if (r && (raw as { generated?: unknown }).generated === true) out.generated = true;
  return out;
}

/** The mirror image of a mark: the other side (paired regions) or u -> -u (midline). */
export function mirrorMark<T extends Scar | Tattoo>(m: T): T {
  const out = { ...m, anchor: [m.anchor[0], m.anchor[1]] as [number, number], mirror: false } as T;
  if (isPaired(m.region)) out.side = ((m.side ?? 0) === 0 ? 1 : 0);
  else {
    out.anchor[0] = wrapU(-m.anchor[0]);
    if (isNum(m.angle)) out.angle = -m.angle;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Resolution.

/** Context a set is resolved in. */
export interface MarkContext {
  race: string;
  subrace?: string | null;
  frames?: RegionFrames;
  /** Placement threshold (default 0.1). */
  overlapMax?: number;
  /** Treat the set's marks as user-placed (never moved). Default: !set.generated. */
  fixed?: boolean;
  /**
   * Regions the outfit covers (e.g. Recipes.GARMENT_REGIONS for a clothed fighter). Marks there are
   * kept but flagged `covered` (a scar cannot be seen through cloth); the creator says "hidden".
   */
  coveredRegions?: readonly Region[];
}

/** A mark ready to draw. */
export interface ResolvedMark {
  /** "scar.<i>" / "tattoo.<i>", mirror copies "<id>.m". */
  id: string;
  type: "scar" | "tattoo";
  region: Region;
  side: 0 | 1;
  anchor: [number, number];
  /** Resolved angle (rad, region frame). */
  angle: number;
  /** Langer's line at the anchor (rad). */
  langer: number;
  mirrorOf?: string;
  scar?: Scar;
  look?: ScarLook;
  keloid?: boolean;
  hypertrophic?: boolean;
  /** The region is under the outfit (ctx.coveredRegions): drawn only when the garment is off. */
  covered?: boolean;
  tattoo?: Tattoo;
  /** Ink ages of [line, accent]. */
  inks?: InkAge[];
  /** Ink ageing in biological years. */
  bioYears?: number;
  extentMm: [number, number];
}

export interface ResolvedMarks { marks: ResolvedMark[]; placement: PlacementResult; frames: RegionFrames }

function expand(set: MarkSet): { id: string; type: "scar" | "tattoo"; mark: Scar | Tattoo; mirrorOf?: string }[] {
  const out: { id: string; type: "scar" | "tattoo"; mark: Scar | Tattoo; mirrorOf?: string }[] = [];
  set.scars.forEach((s, i) => {
    out.push({ id: `scar.${i}`, type: "scar", mark: s });
    if (s.mirror) out.push({ id: `scar.${i}.m`, type: "scar", mark: mirrorMark(s), mirrorOf: `scar.${i}` });
  });
  set.tattoos.forEach((t, i) => {
    out.push({ id: `tattoo.${i}`, type: "tattoo", mark: t });
    if (t.mirror) out.push({ id: `tattoo.${i}.m`, type: "tattoo", mark: mirrorMark(t), mirrorOf: `tattoo.${i}` });
  });
  return out;
}

/**
 * Resolve a set: expand mirrors, take each mark's side (paired regions; default left), its
 * Langer angle when the angle is null, its keloid flag (ancestry x site x kind roll), its healed
 * width (a wound across Langer's lines gapes: x gapeFactor), its stage look / ink ages, then
 * validate the placement (moving only non-fixed marks). Marks the solver rejects are dropped.
 */
export function resolveMarks(set: MarkSet, ctx: MarkContext): ResolvedMarks {
  const frames = ctx.frames ?? nominalFrames(1.8, ctx.race);
  const life = lifespanOf(ctx.race);
  const pre: ResolvedMark[] = [];
  const langerFace = langerFaceOf(frames);
  for (const e of expand(set)) {
    const m = e.mark;
    const side: 0 | 1 = isPaired(m.region) ? (m.side ?? 0) : 0;
    const frame = frameOf(frames, m.region, side);
    const faceScale = frames.heightM / 1.8;
    const langer = langerAngle(m.region, m.anchor[0], m.anchor[1], faceScale, langerFace);
    if (e.type === "scar") {
      const s0 = m as Scar;
      const angle = isNum(s0.angle) ? s0.angle : langer;
      const keloid = resolveKeloid(s0, ctx.race, ctx.subrace);
      const hypertrophic = resolveHypertrophic(s0, ctx.race, ctx.subrace, keloid);
      const scar: Scar = { ...s0, side, angle, keloid, hypertrophic, widthMm: s0.widthMm * gapeFactor(angle, langer) };
      const look = scarLook(scar.kind, scar.ageDays, keloid, hypertrophic);
      pre.push({ id: e.id, type: "scar", region: m.region, side, anchor: [...m.anchor] as [number, number], angle, langer,
        mirrorOf: e.mirrorOf, scar, look, keloid, hypertrophic, extentMm: scarExtentMm(scar, look.spread) });
    } else {
      const t0 = m as Tattoo;
      const angle = t0.style === "band" ? 0 : isNum(t0.angle) ? t0.angle : 0;
      const bioYears = biologicalYears(t0.ageYears, life);
      const tattoo: Tattoo = { ...t0, side, angle };
      pre.push({ id: e.id, type: "tattoo", region: m.region, side, anchor: [...m.anchor] as [number, number], angle, langer,
        mirrorOf: e.mirrorOf, tattoo, bioYears, inks: (t0.inks.length ? t0.inks : ["black" as InkName]).map((k) => inkAge(k, bioYears)),
        extentMm: markExtentMm("tattoo", tattoo, frame) });
    }
  }
  const items: PlacementItem[] = pre.map((r) => ({
    id: r.id, type: r.type, region: r.region, side: r.side, anchor: r.anchor, angle: r.angle, extentMm: r.extentMm,
    facial: r.type === "scar" || r.tattoo?.facial === true, fixed: ctx.fixed ?? !set.generated,
  }));
  const placement = solvePlacement(items, frames, { overlapMax: ctx.overlapMax });
  const byId = new Map(placement.placed.map((p) => [p.id, p]));
  const marks: ResolvedMark[] = [];
  const covered = new Set<Region>(ctx.coveredRegions ?? []);
  for (const r of pre) {
    const p = byId.get(r.id);
    if (!p) continue;
    marks.push({ ...r, anchor: p.anchor, covered: covered.has(r.region) });
  }
  return { marks, placement, frames };
}

/** Langer's face input from a body's frames: its face frame size and the eye/nose/mouth centres. */
export function langerFaceOf(frames: RegionFrames): LangerFace | undefined {
  const f = frameOf(frames, "face", 0);
  if (!f) return undefined;
  const z = faceZones(frames);
  const eyes = z.filter((q) => q.name.startsWith("eye")), mouth = z.find((q) => q.name === "mouth");
  if (!eyes.length || !mouth) return undefined;
  const eyeY = eyes.reduce((a, q) => a + q.y, 0) / eyes.length;
  const top = Math.max(...eyes.map((q) => q.y + q.ry));
  return {
    radiusMm: f.radiusM * 1000, halfLengthMm: f.halfLengthM * 1000, foreheadMm: top,
    orifices: [...eyes.map((q) => ({ x: q.x, y: q.y })), { x: 0, y: (eyeY + mouth.y) / 2 }, { x: mouth.x, y: mouth.y }],
  };
}

/**
 * Face anchors for generated marks, (u, v), derived from the feature zones: the forehead above the
 * eye zones, both cheeks below them, the chin under the mouth, between the brows. The solver moves a
 * mark off any zone it still touches.
 */
export function faceSpots(frames: RegionFrames): [number, number][] {
  const f = frameOf(frames, "face", 0);
  if (!f) return [[0, 0]];
  const z = faceZones(frames), b = REGION_BOUNDS.face!;
  const eye = z.find((q) => q.name === "eyeL") ?? z[0], mouth = z.find((q) => q.name === "mouth") ?? z[z.length - 1];
  const hl = f.halfLengthM * 1000, uOf = (x: number) => x / (Math.PI * f.radiusM * 1000);
  const clampV = (v: number) => Math.max(-b.vMax, Math.min(b.vMax, v));
  const top = (eye.y + eye.ry) / hl, below = (eye.y - eye.ry) / hl, chin = (mouth.y - mouth.ry) / hl;
  return [
    [0, clampV((top + b.vMax) / 2)],
    [uOf(eye.x), clampV((below + mouth.y / hl) / 2)], [-uOf(eye.x), clampV((below + mouth.y / hl) / 2)],
    [0, clampV((chin - b.vMax) / 2)],
    [0, clampV((eye.y) / hl)],
  ];
}

/** Validate a set without moving anything (the creator's per-mark report; `covered` = under the outfit). */
export function validateMarks(set: MarkSet, ctx: MarkContext): { id: string; ok: boolean; issues: PlacementIssue[]; covered: boolean }[] {
  const res = resolveMarks(set, { ...ctx, fixed: true });
  const cov = new Set<Region>(ctx.coveredRegions ?? []);
  const regionOf = new Map(res.marks.map((m) => [m.id, m.region]));
  const exp = new Map(expand(set).map((e) => [e.id, e.mark.region]));
  return res.placement.report.map((r) => ({ ...r, covered: cov.has(regionOf.get(r.id) ?? exp.get(r.id) ?? "hair") }));
}

// ---------------------------------------------------------------------------------------------
// Generated defaults.

/** Expected scars of a young-adult fighter, per race (before class and age factors). */
export const RACE_SCAR_RATE: Readonly<Record<string, number>> = { ork: 2.2, dwarf: 1.4, human: 0.9, elf: 0.45 };
/** Class factor on the scar rate (front-line fighters collect more). */
export const CLASS_SCAR_RATE: Readonly<Record<string, number>> = {
  Barbarian: 1.6, Warrior: 1.4, Rogue: 1.1, Assassin: 1.0, Archer: 0.8, Necromancer: 0.7, Priest: 0.6, Mage: 0.5,
};
/** Chance a character has any tattoo, by sub-race then race. */
export const TATTOO_CHANCE: Readonly<Record<string, number>> = {
  ork: 0.85, greenhide: 0.85, ironhide: 0.8, bloodfang: 0.95,
  dwarf: 0.75, mountain: 0.75, forge: 0.7, deep: 0.8,
  elf: 0.5, high: 0.35, wood: 0.65, dark: 0.6,
  human: 0.2, imperial: 0.12, nomad: 0.3, islander: 0.45,
};
/** Extra tattoos beyond the first (Poisson mean), per race. */
export const TATTOO_EXTRA: Readonly<Record<string, number>> = { ork: 1.2, dwarf: 0.8, elf: 0.6, human: 0.3 };
/** Style weights per race: orks tribal woad, dwarves clan bands and runes, elves dotwork sigils. */
export const RACE_STYLES: Readonly<Record<string, readonly [TattooStyle, number][]>> = {
  ork: [["tribal", 5], ["band", 1], ["sigil", 1]],
  dwarf: [["band", 5], ["runic", 3], ["sigil", 0.5]],
  elf: [["dotwork", 5], ["sigil", 3], ["script", 1.5]],
  human: [["script", 2], ["sigil", 2], ["band", 1], ["tribal", 0.5], ["runic", 0.5], ["dotwork", 0.5]],
};
/** Scar kind weights per class. */
export const CLASS_SCAR_KINDS: Readonly<Record<string, readonly [ScarKind, number][]>> = {
  Barbarian: [["claw", 3], ["laceration", 3], ["burn", 1], ["puncture", 1], ["stitched", 1], ["incision", 0.2]],
  Warrior: [["laceration", 3], ["stitched", 2.5], ["puncture", 1.5], ["claw", 0.5], ["burn", 0.5], ["incision", 0.5]],
  Rogue: [["laceration", 2], ["puncture", 2], ["incision", 1], ["stitched", 1], ["claw", 0.5], ["burn", 0.3]],
  Assassin: [["puncture", 3], ["incision", 2], ["laceration", 1.5], ["stitched", 1], ["burn", 0.3]],
  Mage: [["burn", 3], ["laceration", 0.8], ["incision", 0.5], ["stitched", 0.5], ["puncture", 0.3]],
  Necromancer: [["incision", 3], ["burn", 1], ["puncture", 1], ["stitched", 1]],
  Archer: [["laceration", 2], ["puncture", 1.5], ["claw", 1], ["stitched", 0.5], ["burn", 0.3]],
  Priest: [["stitched", 2], ["laceration", 1], ["burn", 1], ["incision", 0.5]],
};
/** Race nudges on the kind weights (orks are clawed in the wild, forge dwarves burned). */
export const RACE_SCAR_KIND_BONUS: Readonly<Record<string, Partial<Record<ScarKind, number>>>> = {
  ork: { claw: 1, laceration: 0.5 }, dwarf: { burn: 1.5 }, elf: { incision: 0.5 }, human: {},
};
/** Where each scar kind lands (forearms first: the defensive wounds of anyone who fights). */
export const SCAR_REGIONS: Readonly<Record<ScarKind, readonly [Region, number][]>> = {
  laceration: [["foreArm", 3], ["upperArm", 2], ["hand", 1.5], ["torso", 2], ["face", 1.2], ["thigh", 1], ["shin", 1], ["neck", 0.3]],
  claw: [["torso", 3], ["upperArm", 2], ["foreArm", 2], ["thigh", 1.5], ["face", 0.8], ["shin", 0.5]],
  puncture: [["torso", 2], ["thigh", 1.5], ["upperArm", 1], ["foreArm", 1], ["pelvis", 0.6], ["ear", 0.3]],
  burn: [["hand", 2], ["foreArm", 2.5], ["torso", 1], ["upperArm", 0.8], ["face", 0.5], ["neck", 0.4]],
  incision: [["torso", 2], ["foreArm", 1.5], ["pelvis", 1], ["upperArm", 0.6], ["thigh", 0.6]],
  stitched: [["torso", 2], ["foreArm", 1.5], ["upperArm", 1.2], ["thigh", 1.2], ["face", 0.6], ["shin", 0.6]],
};
/** Scar size ranges (mm, at 1.8 m): length and width. */
export const SCAR_SIZES: Readonly<Record<ScarKind, { length: [number, number]; width: [number, number] }>> = {
  incision: { length: [30, 120], width: [1.5, 3.5] },
  laceration: { length: [25, 110], width: [2.5, 6] },
  claw: { length: [60, 140], width: [2.5, 4.5] },
  puncture: { length: [6, 14], width: [6, 14] },
  burn: { length: [40, 110], width: [30, 80] },
  stitched: { length: [40, 140], width: [2, 3.5] },
};
/** Tattoo regions per style. */
export const TATTOO_STYLE_REGIONS: Readonly<Record<TattooStyle, readonly [Region, number][]>> = {
  band: [["upperArm", 4], ["foreArm", 3], ["thigh", 0.5], ["shin", 0.5]],
  tribal: [["upperArm", 3], ["torso", 2], ["foreArm", 1.5], ["neck", 0.5], ["shin", 0.5]],
  runic: [["foreArm", 3], ["upperArm", 2], ["torso", 1], ["hand", 0.5]],
  sigil: [["foreArm", 2], ["hand", 1], ["torso", 1.5], ["neck", 1], ["upperArm", 1]],
  script: [["foreArm", 3], ["torso", 1], ["upperArm", 1]],
  dotwork: [["foreArm", 2], ["upperArm", 1.5], ["torso", 1.5], ["neck", 1]],
};
/** Tattoo sizes (mm, at 1.8 m). */
export const TATTOO_SIZES: Readonly<Record<TattooStyle, [number, number]>> = {
  band: [18, 40], tribal: [70, 150], runic: [40, 70], sigil: [30, 70], script: [24, 40], dotwork: [40, 90],
};
/** Chance a generated tattoo of a style is facial, per race (orks tribal, elves dotwork). */
export const FACIAL_CHANCE: Readonly<Record<string, Partial<Record<TattooStyle, number>>>> = {
  ork: { tribal: 0.25 }, elf: { dotwork: 0.12, sigil: 0.08 }, dwarf: {}, human: {},
};
/** Most generated scars / tattoos. */
export const MAX_GENERATED_SCARS = 6;
export const MAX_GENERATED_TATTOOS = 4;

/** Inputs of the generated defaults. */
export interface MarkDefaultsInput {
  race: string;
  subrace?: string | null;
  className: string;
  birthsign?: string | null;
  /** Years (Appearance.age); unset = a young adult (35 % of the lifespan). */
  ageYears?: number | null;
  seed: number;
  /** Body height (m), for sizes and placement. Default 1.8. */
  heightM?: number;
}

function pick<T>(rng: () => number, table: readonly (readonly [T, number])[]): T {
  let total = 0;
  for (const [, w] of table) total += Math.max(0, w);
  let r = rng() * total;
  for (const [v, w] of table) { r -= Math.max(0, w); if (r < 0) return v; }
  return table[table.length - 1][0];
}

function poisson(rng: () => number, mean: number): number {
  const L = Math.exp(-Math.max(0, mean));
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L && k < 64);
  return k - 1;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const raceKey = (race: string) => (RACE_SCAR_RATE[race] !== undefined ? race : "human");

/** Expected generated scars for an input (before the cap): race x class x age factor. */
export function expectedScars(race: string, className: string, ageYears?: number | null): number {
  const L = lifespanOf(race);
  const years = isNum(ageYears) ? ageYears : 0.35 * L;
  const f = years / L;
  const ageF = 0.5 + 1.5 * Math.min(1.4, Math.max(0, (f - ADULT_FRACTION) / 0.55));
  return RACE_SCAR_RATE[raceKey(race)] * (CLASS_SCAR_RATE[className] ?? 1) * ageF;
}

/**
 * The generated marks of a character. Deterministic from the input (its own RNG stream:
 * rng32(seed ^ 0x4d41524b), so it never shifts another roll). Scars: Poisson(expectedScars),
 * capped; kind by class (+ race nudge), region by kind, size by kind, age skewed old with a
 * fresh-wound chance for front-liners; incisions and stitched wounds follow Langer's lines,
 * trauma lies at any angle. Tattoos: a race/sub-race chance, then 1 + Poisson(extra); style by
 * race; motif from the sign / class / race sets (Tattoo.motifsFor); inks by race; age since
 * majority (dwarf clan bands are given AT majority). Placement is solved on nominal frames; marks
 * that cannot be placed are dropped.
 */
export function defaultMarks(input: MarkDefaultsInput): MarkSet {
  const rng = rng32((input.seed ^ 0x4d41524b) >>> 0);
  const race = raceKey(input.race);
  const L = lifespanOf(input.race);
  const years = isNum(input.ageYears) ? Math.max(0, input.ageYears) : 0.35 * L;
  const adultYears = Math.max(0.05, years - ADULT_FRACTION * L);
  const heightM = isNum(input.heightM) && input.heightM > 0 ? input.heightM : 1.8;
  const k = heightM / 1.8;
  const frames = nominalFrames(heightM, race);
  const FACE_SPOTS = faceSpots(frames);
  const scars: Scar[] = [];
  const nScars = Math.min(MAX_GENERATED_SCARS, poisson(rng, expectedScars(input.race, input.className, input.ageYears)));
  const kindTable = (CLASS_SCAR_KINDS[input.className] ?? CLASS_SCAR_KINDS.Warrior).map(([kd, w]) => [kd, w + (RACE_SCAR_KIND_BONUS[race]?.[kd] ?? 0)] as [ScarKind, number]);
  for (const [kd, w] of Object.entries(RACE_SCAR_KIND_BONUS[race] ?? {})) {
    if (!kindTable.some(([x]) => x === kd)) kindTable.push([kd as ScarKind, w ?? 0]);
  }
  const freshChance = input.className === "Barbarian" || input.className === "Warrior" ? 0.1 : 0.05;
  for (let i = 0; i < nScars; i++) {
    const kind = pick(rng, kindTable);
    const region = pick(rng, SCAR_REGIONS[kind]);
    const size = SCAR_SIZES[kind];
    const side: 0 | 1 = rng() < 0.5 ? 0 : 1;
    const fr = frameOf(frames, region, side)!;
    const b = REGION_BOUNDS[region]!;
    let lengthMm = lerp(size.length[0], size.length[1], rng()) * k;
    let widthMm = lerp(size.width[0], size.width[1], rng()) * k;
    if (kind === "puncture") widthMm = lengthMm;
    // Keep inside the region: no longer than ~70 % of the usable axis, ~40 % of the girth.
    const maxLen = Math.min(2 * b.vMax * fr.halfLengthM * 1000 * 0.7, 2 * Math.PI * fr.radiusM * 1000 * 0.4);
    if (region === "face") lengthMm = Math.min(lengthMm, 40 * k);
    if (kind === "burn") { lengthMm = Math.min(lengthMm, maxLen); widthMm = Math.min(widthMm, lengthMm * 0.8); }
    else lengthMm = Math.min(lengthMm, maxLen);
    const anchor: [number, number] = region === "face"
      ? [...FACE_SPOTS[Math.floor(rng() * FACE_SPOTS.length)]] as [number, number]
      : [rng() * 2 - 1, (rng() * 2 - 1) * 0.5];
    const fresh = rng() < freshChance;
    const ageDays = fresh ? 2 + rng() * 58 : Math.max(60, Math.pow(rng(), 0.8) * adultYears * 365.25);
    const surgical = kind === "incision" || kind === "stitched";
    const langer = langerAngle(region, anchor[0], anchor[1], k);
    const angle = surgical ? null : kind === "burn" ? langer + (rng() - 0.5) * 0.6 : langer + (rng() - 0.5) * Math.PI * 0.9;
    const scar: Scar = {
      kind, region, anchor, lengthMm: round2(lengthMm), widthMm: round2(widthMm), angle: angle === null ? null : round4(angle),
      ageDays: Math.round(ageDays), keloid: null, hypertrophic: null, seed: (rng() * 0x7fffffff) | 0,
    };
    if (isPaired(region)) scar.side = side;
    scars.push(scar);
  }
  const tattoos: Tattoo[] = [];
  const sub = input.subrace ?? "";
  const chance = TATTOO_CHANCE[sub] ?? TATTOO_CHANCE[race];
  if (rng() < chance) {
    const n = Math.min(MAX_GENERATED_TATTOOS, 1 + poisson(rng, TATTOO_EXTRA[race]));
    const motifs = motifsFor(race, input.className, input.birthsign);
    for (let i = 0; i < n; i++) {
      const style = pick(rng, RACE_STYLES[race]);
      const facial = rng() < (FACIAL_CHANCE[race]?.[style] ?? 0);
      const region: Region = facial ? "face" : pick(rng, TATTOO_STYLE_REGIONS[style]);
      const side: 0 | 1 = rng() < 0.5 ? 0 : 1;
      const r = rng();
      const motif = r < 0.5 ? motifs[0] : r < 0.8 ? motifs[Math.min(motifs.length - 1, 1 + Math.floor(rng() * 2))] : motifs[Math.floor(rng() * motifs.length)];
      const [s0, s1] = TATTOO_SIZES[style];
      const fr = frameOf(frames, region, side)!;
      const b = REGION_BOUNDS[region]!;
      let sizeMm = lerp(s0, s1, rng()) * k;
      if (facial) sizeMm = lerp(20, 28, rng()) * k;
      // The design must fit the usable axis.
      sizeMm = Math.min(sizeMm, b.vMax * fr.halfLengthM * 1000 * (style === "tribal" ? 0.7 : 0.9));
      const ink = pick(rng, RACE_INKS[race]);
      const accent = rng() < 0.3 ? pick(rng, RACE_INKS[race]) : null;
      const ageYears = style === "band" && race === "dwarf" ? adultYears * (0.9 + 0.1 * rng()) : rng() * adultYears;
      const anchor: [number, number] = facial ? [...FACE_SPOTS[Math.floor(rng() * FACE_SPOTS.length)]] as [number, number]
        : [style === "band" ? 0 : (rng() * 2 - 1) * 0.6, (rng() * 2 - 1) * 0.45];
      const mirror = style === "band" ? rng() < 0.5 : style === "tribal" && !facial ? rng() < 0.35 : false;
      const t: Tattoo = {
        style, motif, region, anchor, sizeMm: round2(sizeMm), angle: null,
        inks: accent && accent !== ink ? [ink, accent] : [ink], ageYears: round2(ageYears), seed: (rng() * 0x7fffffff) | 0,
      };
      if (isPaired(region)) t.side = side;
      if (mirror) t.mirror = true;
      if (facial) t.facial = true;
      tattoos.push(t);
    }
  }
  // Solve the generated placement on the nominal frames; write the final anchors back. A mirror
  // copy follows its original, so after the write-back the set is re-validated as FIXED marks and
  // any mark still in trouble loses its mirror (or is dropped) until the set is clean.
  const set: MarkSet = { scars, tattoos };
  const res = resolveMarks(set, { race: input.race, subrace: input.subrace, frames, fixed: false });
  const anchorOf = new Map(res.marks.map((m) => [m.id, m.anchor]));
  let keepS: Scar[] = [], keepT: Tattoo[] = [];
  scars.forEach((s, i) => { const a = anchorOf.get(`scar.${i}`); if (a) keepS.push({ ...s, anchor: [round4(a[0]), round4(a[1])] }); });
  tattoos.forEach((t, i) => {
    const a = anchorOf.get(`tattoo.${i}`);
    if (a) keepT.push({ ...t, anchor: [round4(a[0]), round4(a[1])] });
  });
  for (let pass = 0; pass < 2 * (keepS.length + keepT.length) + 1; pass++) {
    const check = resolveMarks({ scars: keepS, tattoos: keepT }, { race: input.race, subrace: input.subrace, frames, fixed: true });
    const bad = check.placement.report.find((r) => !r.ok);
    if (!bad) break;
    const [type, idx, mirror] = bad.id.split(".");
    const i = Number(idx);
    if (type === "scar") {
      if (mirror) delete keepS[i].mirror; else keepS = keepS.filter((_, k) => k !== i);
    } else {
      if (mirror || keepT[i].mirror) delete keepT[i].mirror; else keepT = keepT.filter((_, k) => k !== i);
    }
  }
  // Canonical field order (what a save round-trips to); flagged generated (movable on the real body).
  return sanitizeMarks({ scars: keepS, tattoos: keepT, generated: true }) ?? emptyMarks();
}

function round2(x: number): number { return Math.round(x * 100) / 100; }
function round4(x: number): number { return Math.round(x * 10000) / 10000; }

/** The marks a profile wears: its own `appearance.marks` (sanitized) or the generated defaults. */
export function marksForProfile(p: {
  race: string; subrace?: string | null; className: string; birthsign?: string | null;
  appearance: { marks?: MarkSet | null; age?: number; height?: number };
}, seed: number): MarkSet {
  const own = p.appearance.marks ? sanitizeMarks(p.appearance.marks) : null;
  if (own) return own;
  return defaultMarks({
    race: p.race, subrace: p.subrace, className: p.className, birthsign: p.birthsign,
    ageYears: p.appearance.age, seed, heightM: p.appearance.height,
  });
}

// ---------------------------------------------------------------------------------------------
// (b) Fragment decals in R's layout.

/** A decal plus the mark it came from. */
export type MarkDecal = FragmentDecal & {
  id: string;
  /** Wrap axis (the limb axis) for glyph/dots on a limb (R may ignore it: the glyph reads flat). */
  wrapAxis?: Vec3;
  /** Salience used to pick the 16 decals kept (area x contrast). */
  priority: number;
};

/** Options of the compilers. */
export interface CompileOptions {
  /** The body's base skin colour, sRGB 0..1 (default a mid human tone). */
  skinSrgb?: readonly number[];
  /** The skin roughness under the marks (default 0.5 = the neutral channel). */
  skinRoughness?: number;
  /** Mesh: decal centres and normals are taken off its skin (else the frame cylinder). */
  mesh?: MeshData;
  /** The body plan's face anchors (plan.face): eye/mouth zones measured on THIS head. */
  face?: FaceAnchorsLike | null;
  /**
   * The PAINTED skin per vertex of `mesh` (LINEAR rgb, 3 per vertex; e.g. P's preset albedo). When given, a scar's
   * colour is composed over the skin AROUND it (localSkinSrgb) instead of the body's mean skin: the preset paint varies
   * across the body (wash, edge highlight, zenithal prime), and a mature scar composed on the mean read DARKER than the
   * lighter forearm it sits on (QA r07q-before-F: dL* -1.5..-3.1) although M's law makes it paler (closing, F).
   */
  skinAlbedo?: Float32Array;
}

export const DEFAULT_SKIN_SRGB: readonly number[] = [0.78, 0.6, 0.5];
/** Scar edge softness (m). */
export const SCAR_BLUR_M = 0.0003;

const s2l = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toLinear = (c: readonly number[]): [number, number, number] => [s2l(c[0]), s2l(c[1]), s2l(c[2])];

/** Where a mark sits on the skin: centre, normal and the frame tangents there. */
function surfaceAt(frame: RegionFrame, x: number, y: number, mesh?: MeshData, frames?: RegionFrames): { p: Vec3; n: Vec3; tx: Vec3; ty: Vec3; radial: number } {
  let radial = frame.radiusM;
  let n: Vec3 | null = null;
  if (mesh && frames) {
    // Weighted mean of the 4 nearest skin vertices of this (region, side) in frame millimetres.
    const ri = REGIONS.indexOf(frame.region), P = mesh.positions, N = mesh.normals;
    const best: { d: number; r: number; i: number }[] = [];
    const circ = 2 * Math.PI * frame.radiusM * 1000;
    for (let i = 0; i < P.length / 3; i++) {
      if (mesh.region[i] !== ri) continue;
      const px = P[i * 3];
      if (isPaired(frame.region) && (px >= frames.coreX ? 0 : 1) !== frame.side) continue;
      const q = pointToFrameMm(frame, [px, P[i * 3 + 1], P[i * 3 + 2]]);
      let dx = Math.abs(q.x - x) % circ; if (dx > circ / 2) dx = circ - dx;
      const d = Math.hypot(dx, q.y - y);
      if (best.length < 4 || d < best[best.length - 1].d) {
        best.push({ d, r: q.radial, i });
        best.sort((a, b) => a.d - b.d);
        if (best.length > 4) best.pop();
      }
    }
    if (best.length) {
      let w = 0, r = 0; const nn: Vec3 = [0, 0, 0];
      for (const b of best) {
        const wi = 1 / (b.d + 1);
        w += wi; r += wi * b.r;
        nn[0] += wi * N[b.i * 3]; nn[1] += wi * N[b.i * 3 + 1]; nn[2] += wi * N[b.i * 3 + 2];
      }
      radial = r / w;
      const l = Math.hypot(nn[0], nn[1], nn[2]);
      if (l > 1e-9) n = [nn[0] / l, nn[1] / l, nn[2] / l];
    }
  }
  const s = frameMmToPoint(frame, x, y, radial);
  if (mesh && frames) {
    // Exact: cast the ray from the axis point outward through the region's triangles; the
    // outermost hit is the skin (Moller-Trumbore). Falls back to the vertex estimate above.
    const o = frameMmToPoint(frame, x, y, 0).p;
    const hit = castOut(mesh, frames, frame, o, s.out, true) ?? castOut(mesh, frames, frame, o, s.out, false);
    if (hit) return { p: hit.p, n: hit.n, tx: s.tx, ty: s.ty, radial: hit.t };
  }
  return { p: s.p, n: n ?? s.out, tx: s.tx, ty: s.ty, radial };
}

/**
 * Outermost intersection of the ray o + t d (t > 0) with triangles touching this region/side
 * (`own`), or with any triangle (fallback: the mark overhangs its region's edge).
 */
function castOut(mesh: MeshData, frames: RegionFrames, frame: RegionFrame, o: Vec3, d: Vec3, own: boolean): { p: Vec3; n: Vec3; t: number } | null {
  const P = mesh.positions, I = mesh.indices, ri = REGIONS.indexOf(frame.region), paired = isPaired(frame.region);
  let bestT = -1, bn: Vec3 = [0, 0, 0];
  for (let k = 0; k < I.length; k += 3) {
    const a = I[k], b = I[k + 1], c = I[k + 2];
    if (own && mesh.region[a] !== ri && mesh.region[b] !== ri && mesh.region[c] !== ri) continue;
    if (own && paired && (P[a * 3] >= frames.coreX ? 0 : 1) !== frame.side) continue;
    const e1: Vec3 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
    const e2: Vec3 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    const pv: Vec3 = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
    if (Math.abs(det) < 1e-14) continue;
    const inv = 1 / det;
    const tv: Vec3 = [o[0] - P[a * 3], o[1] - P[a * 3 + 1], o[2] - P[a * 3 + 2]];
    const u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) * inv;
    if (u < 0 || u > 1) continue;
    const qv: Vec3 = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
    const v = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) * inv;
    if (t > 0 && t > bestT) {
      bestT = t;
      const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
      const l = Math.hypot(nx, ny, nz) || 1;
      // Outward: the same side as the ray.
      const sgn = nx * d[0] + ny * d[1] + nz * d[2] < 0 ? -1 : 1;
      bn = [sgn * nx / l, sgn * ny / l, sgn * nz / l];
    }
  }
  if (bestT <= 0) return null;
  return { p: [o[0] + d[0] * bestT, o[1] + d[1] * bestT, o[2] + d[2] * bestT], n: bn, t: bestT };
}

const SCAR_DECAL_KIND: Readonly<Record<ScarKind, FragmentDecal["kind"]>> = {
  incision: "line", laceration: "line", claw: "line", puncture: "disc", burn: "disc", stitched: "stitched",
};
const TATTOO_DECAL_KIND: Readonly<Record<TattooStyle, FragmentDecal["kind"]>> = {
  tribal: "glyph", runic: "glyph", sigil: "glyph", band: "band", script: "line", dotwork: "dots",
};

const l2s = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055);
/**
 * Mean painted skin (sRGB) of the vertices of `region` within `radiusM` of bind point `p` (weights 1 / (d + 5 mm)),
 * from a LINEAR per-vertex albedo; null when no vertex is that close.
 */
export function localSkinSrgb(mesh: MeshData, albedoLin: Float32Array, p: readonly number[], region: Region, radiusM: number): [number, number, number] | null {
  const ri = REGIONS.indexOf(region), P = mesh.positions;
  if (albedoLin.length !== P.length) return null;
  let w = 0;
  const acc = [0, 0, 0];
  for (let i = 0; i < P.length / 3; i++) {
    if (mesh.region[i] !== ri) continue;
    const d = Math.hypot(P[i * 3] - p[0], P[i * 3 + 1] - p[1], P[i * 3 + 2] - p[2]);
    if (d > radiusM) continue;
    const wi = 1 / (d + 0.005);
    w += wi; acc[0] += wi * albedoLin[i * 3]; acc[1] += wi * albedoLin[i * 3 + 1]; acc[2] += wi * albedoLin[i * 3 + 2];
  }
  return w > 0 ? [l2s(acc[0] / w), l2s(acc[1] / w), l2s(acc[2] / w)] : null;
}

/** One mark -> one decal (R's FragmentDecal). */
export function markToDecal(m: ResolvedMark, frames: RegionFrames, opts: CompileOptions = {}): MarkDecal | null {
  const frame = frameOf(frames, m.region, m.side);
  if (!frame) return null;
  const skin = opts.skinSrgb ?? DEFAULT_SKIN_SRGB, rough = opts.skinRoughness ?? 0.5;
  const [x, y] = uvToMm(frame, m.anchor[0], m.anchor[1]);
  const at = surfaceAt(frame, x, y, opts.mesh, frames);
  const c = Math.cos(m.angle), s = Math.sin(m.angle);
  const tangent: Vec3 = [c * at.tx[0] + s * at.ty[0], c * at.tx[1] + s * at.ty[1], c * at.tx[2] + s * at.ty[2]];
  const seed01 = (sd: number) => markHash(sd, 77);
  if (m.type === "scar" && m.scar && m.look) {
    const sc = m.scar, look = m.look;
    // The skin AROUND the scar when the painted albedo is known (closing, F), else the body's skin colour.
    const here = opts.skinAlbedo && opts.mesh
      ? localSkinSrgb(opts.mesh, opts.skinAlbedo, at.p, m.region, Math.min(0.05, Math.max(0.015, sc.lengthMm / 2000))) : null;
    const col = scarColour(here ?? skin, look, 1);
    const W = Math.max(0.5, sc.widthMm) * look.spread;
    const d: MarkDecal = {
      id: m.id, kind: SCAR_DECAL_KIND[sc.kind], center: at.p, normal: at.n, tangent,
      halfLength: (sc.kind === "puncture" ? Math.max(sc.lengthMm, W) / 2 * look.spread : sc.lengthMm / 2) / 1000,
      halfWidth: (sc.kind === "puncture" ? Math.max(sc.lengthMm, W) / 2 * look.spread : W / 2) / 1000,
      blur: SCAR_BLUR_M, albedo: toLinear(col), albedoOpacity: 1,
      roughness: Math.min(1, Math.max(0, rough * look.roughnessScale)), roughnessOpacity: 1,
      height: Math.max(-HEIGHT_LIMIT, Math.min(HEIGHT_LIMIT, look.heightMm / 1000)), seed: seed01(sc.seed),
      priority: 0,
    };
    if (sc.kind === "claw") { const cl = clawLines(sc); d.count = cl.count; d.spacing = cl.spacingMm / 1000; }
    if (sc.kind === "stitched") {
      const nSt = Math.max(1, Math.floor(sc.lengthMm / SUTURE_PITCH_MM));
      d.count = Math.min(STROKES_MAX, nSt);
      d.spacing = Math.max(SUTURE_PITCH_MM, sc.lengthMm / d.count) / 1000;
    }
    const area = (sc.lengthMm * W) / 100;
    d.priority = area * (0.3 + Math.max(look.redness, look.maturity * 0.5)) + (m.keloid ? 20 : 0) + (m.hypertrophic ? 10 : 0);
    return d;
  }
  if (m.type === "tattoo" && m.tattoo && m.inks) {
    const t = m.tattoo, ink = m.inks[0], R = Math.max(4, t.sizeMm) / 2;
    const kind = TATTOO_DECAL_KIND[t.style];
    const glyph = Math.max(0, symbolIndex(t.motif));
    const d: MarkDecal = {
      id: m.id, kind, center: at.p, normal: at.n, tangent, halfLength: R / 1000,
      halfWidth: STYLE_STROKE[t.style] * R / 1000, blur: ink.blurMm / 1000,
      albedo: toLinear(ink.srgb), albedoOpacity: ink.opacity, glyph, seed: seed01(t.seed), priority: 0,
    };
    if (kind === "band") {
      d.tangent = at.ty;                                  // R: band tangent = limb axis
      d.halfLength = (t.sizeMm / 2) / 1000;
      d.halfWidth = STYLE_STROKE.band * 0.55 * R * 1.3 / 1000;
      d.wrapRadius = at.radial;
    } else if (kind === "dots") {
      d.halfWidth = DOT_RADIUS_MM * dotScale(t) / 1000; d.spacing = DOT_PITCH_MM * dotScale(t) / 1000;
      d.wrapRadius = at.radial; d.wrapAxis = frame.axis;
    } else if (kind === "glyph") {
      d.wrapRadius = at.radial; d.wrapAxis = frame.axis;
      if (t.style === "runic") { d.count = runeCount(t); d.spacing = 0.9 * R / 1000; d.halfLength = 0.5 * R / 1000; }
    } else if (kind === "line") {
      d.halfLength = 2.2 * R / 1000;
    }
    const [ex, ey] = tattooExtentMm(t, 2 * Math.PI * frame.radiusM * 1000);
    d.priority = (ex * ey * 4 / 100) * ink.opacity * 0.8;
    return d;
  }
  return null;
}

/**
 * All marks -> decals, the DECAL_MAX most salient kept (ties: input order), returned in input order.
 * `dropped` lists the ids that fell off the budget (their vertex layers fall back to a tint).
 */
export function marksToDecals(res: ResolvedMarks, opts: CompileOptions & { includeCovered?: boolean } = {}): { decals: MarkDecal[]; dropped: string[] } {
  const all = res.marks.filter((m) => opts.includeCovered || !m.covered)
    .map((m) => markToDecal(m, res.frames, opts)).filter((d): d is MarkDecal => d !== null);
  const ranked = all.map((d, i) => ({ d, i })).sort((a, b) => b.d.priority - a.d.priority || a.i - b.i);
  const keep = new Set(ranked.slice(0, DECAL_MAX).map((r) => r.i));
  return { decals: all.filter((_, i) => keep.has(i)), dropped: all.filter((_, i) => !keep.has(i)).map((d) => d.id) };
}

/**
 * R's one-call entry: a MarkSet on a body -> FragmentDecal[] (R's type, MaterialChannels.ts), budget
 * applied. ctx.race/subrace (keloid + hypertrophic rolls), ctx.mesh (frames + centres off the skin),
 * ctx.skinSrgb = the BODY'S OWN skin colour (sRGB 0..1; without it a mature scar is drawn over a
 * human tone), ctx.coveredRegions = the outfit (marks there are hidden). Extra fields (`id`,
 * `priority`, `wrapAxis`) ride along and are ignored by packDecals.
 */
export function marksToFragmentDecals(set: MarkSet, ctx: MarkContext & CompileOptions): FragmentDecal[] {
  const frames = ctx.frames ?? (ctx.mesh ? regionFrames(ctx.mesh, { face: ctx.face, race: ctx.race }) : nominalFrames(1.8, ctx.race));
  const res = resolveMarks(set, { ...ctx, frames });
  return marksToDecals(res, ctx).decals;
}

// ---------------------------------------------------------------------------------------------
// (a) Per-vertex contributions through L's layer API.

/** Halo of the vertex footprint beyond the mark's own extent (fraction of the extent). */
export const VERTEX_HALO = 0.6;

/** Local (s, t) mm of a bind-pose point for a resolved mark, or null when the point is not on its region/side. */
export function localMm(m: ResolvedMark, frames: RegionFrames, x: number, y: number, z: number, region: number): [number, number] | null {
  if (REGIONS[region] !== m.region) return null;
  if (isPaired(m.region) && (x >= frames.coreX ? 0 : 1) !== m.side) return null;
  const f = frameOf(frames, m.region, m.side);
  if (!f) return null;
  const q = pointToFrameMm(f, [x, y, z]);
  const [cx, cy] = uvToMm(f, m.anchor[0], m.anchor[1]);
  const circ = 2 * Math.PI * f.radiusM * 1000;
  let dx = q.x - cx;
  dx = ((dx % circ) + circ * 1.5) % circ - circ / 2;
  const dy = q.y - cy, c = Math.cos(m.angle), s = Math.sin(m.angle);
  return [c * dx + s * dy, -s * dx + c * dy];
}

/** The vertex-level coverage of each mark (L's MarkField): a soft footprint with a halo. */
export function markFields(res: ResolvedMarks): Record<string, MarkField> {
  const out: Record<string, MarkField> = {};
  for (const m of res.marks) {
    const [ex, ey] = m.extentMm;
    const halo = m.type === "scar" ? VERTEX_HALO : 0.25;
    // A vertex grid of ~25 mm must see narrow marks: never thinner than 14 mm.
    const hx = Math.max(ex, 14), hy = Math.max(ey, 14);
    out[`mark.${m.id}`] = (x, y, z, _nx, _ny, _nz, region) => {
      const st = localMm(m, res.frames, x, y, z, region);
      if (!st) return 0;
      const q = Math.max(Math.abs(st[0]) / hx, Math.abs(st[1]) / hy);
      const t = Math.min(1, Math.max(0, (q - 1) / halo));
      return 1 - t * t * (3 - 2 * t);
    };
  }
  return out;
}

const hex = (c: readonly number[]) => "#" + c.slice(0, 3).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");

/**
 * L layers for the marks. Per mark, a VERTEX layer (source { kind: "mark", id }) and a FRAGMENT
 * twin (stage "fragment": the decal; listed so the Layers inspector shows and toggles it).
 * Vertex writes (scar): albedo multiply by the perilesional erythema (fresh wounds are ringed
 * pink; opacity = redness), roughness multiply (shine, opacity = tissue share), height add (mean
 * relief: keloid swelling), mask:hairless max. Tattoo: albedo multiply by the fresh-tattoo
 * redness for the first ~2 weeks. A mark in `dropped` (no decal) also gets a normal-blend tint
 * of its colour at its mean coverage, so it never disappears.
 */
export function marksToLayers(res: ResolvedMarks, opts: CompileOptions & { dropped?: readonly string[] } = {}): Layer[] {
  const skin = opts.skinSrgb ?? DEFAULT_SKIN_SRGB;
  const dropped = new Set(opts.dropped ?? []);
  const layers: Layer[] = [];
  for (const m of res.marks) {
    const id = `mark.${m.id}`;
    const writes: ChannelWrite[] = [];
    let name = m.id;
    if (m.type === "scar" && m.scar && m.look) {
      const look = m.look, st = scarFootprintStats(m.scar, look, 16);
      name = `${m.scar.kind} scar (${look.stage}${m.keloid ? ", keloid" : m.hypertrophic ? ", hypertrophic" : ""})`;
      const ery = look.redness * 0.6;
      if (ery > 0.01) {
        writes.push({ channel: "albedo", op: "multiply", colour: hex([1 + (RED_TINT[0] - 1) * ery, 1 + (RED_TINT[1] - 1) * ery, 1 + (RED_TINT[2] - 1) * ery]), opacity: look.redness });
      }
      if (dropped.has(m.id)) writes.push({ channel: "albedo", op: "normal", colour: hex(scarColour(skin, look, 1)), opacity: Math.min(1, st.coverage) });
      writes.push({ channel: "roughness", op: "multiply", value: look.roughnessScale, opacity: Math.min(1, st.coverage * 2) });
      if (Math.abs(st.heightMm) > 1e-4) writes.push({ channel: "height", op: "add", value: Math.max(-HEIGHT_LIMIT, Math.min(HEIGHT_LIMIT, st.heightMm / 1000)) });
      writes.push({ channel: "mask:hairless", op: "max", value: 1, opacity: Math.min(1, st.hairless * 2) });
    } else if (m.type === "tattoo" && m.tattoo && m.inks) {
      const t = m.tattoo, ink = m.inks[0];
      name = `${t.style} tattoo (${t.motif}, ${t.inks.join("/")})`;
      const freshDays = (m.bioYears ?? 0) * 365.25;
      if (freshDays < 14) {
        const r = 0.5 * Math.exp(-freshDays / 5);
        writes.push({ channel: "albedo", op: "multiply", colour: hex([1, 1 - 0.5 * r, 1 - 0.5 * r]), opacity: 1 });
      }
      if (dropped.has(m.id)) {
        const dens = tattooDensity(t, ink.blurMm, 2 * Math.PI * (frameOf(res.frames, m.region, m.side)?.radiusM ?? 0.05) * 1000, 16);
        writes.push({ channel: "albedo", op: "normal", colour: hex(ink.srgb), opacity: Math.min(1, dens * ink.opacity) });
      }
    }
    if (writes.length) {
      layers.push({ kind: "layer", id, name, enabled: true, opacity: 1, source: { kind: "mark", id }, regions: [m.region], writes, stage: "vertex" });
    }
    layers.push({ kind: "layer", id: `${id}.decal`, name: `${name} decal`, enabled: !dropped.has(m.id), opacity: 1, source: { kind: "mark", id }, regions: [m.region], writes: [], stage: "fragment" });
  }
  return layers;
}

// ---------------------------------------------------------------------------------------------
// Hair: follicles absent along scars (for the hair pass; docs/wave-x/HAIR.md).

/** 1 when a bind-pose skin point lies on a scar line (or its 1.5 mm margin): no follicle there. */
export function hairlessAt(res: ResolvedMarks, x: number, y: number, z: number, region: number): number {
  const smp: ScarSample = { coverage: 0, heightMm: 0, mottle: 0, hairless: 0 };
  for (const m of res.marks) {
    if (m.type !== "scar" || !m.scar || !m.look) continue;
    const st = localMm(m, res.frames, x, y, z, region);
    if (!st) continue;
    if (sampleScar(m.scar, m.look, st[0], st[1], smp).hairless) return 1;
  }
  return 0;
}

/** Per-vertex hairless mask (n floats, 0/1) for a mesh. */
export function hairlessMask(mesh: MeshData, res: ResolvedMarks): Float32Array {
  const n = mesh.positions.length / 3, out = new Float32Array(n), P = mesh.positions;
  for (let i = 0; i < n; i++) out[i] = hairlessAt(res, P[i * 3], P[i * 3 + 1], P[i * 3 + 2], mesh.region[i]);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Generated statistics and the doc tables (docs/wave-tex/MARKS.md is written from these).

export interface MarkStats {
  race: string;
  n: number;
  meanScars: number;
  scarredShare: number;
  tattooedShare: number;
  meanTattoos: number;
  keloidShare: number;
  hypertrophicShare: number;
  styles: Record<string, number>;
  inks: Record<string, number>;
  kinds: Record<string, number>;
  facialShare: number;
}

/** Statistics of the generated marks over `n` seeds per race (classes cycle, signs cycle, ages rolled). */
export function generatedStats(race: string, n = 2000): MarkStats {
  const classes = Object.keys(CLASS_SCAR_RATE), signs = ["void", "mountain", "flame", "moon", "storm", "serpent"];
  let scars = 0, scarred = 0, tattooed = 0, tattoos = 0, keloids = 0, hyper = 0, facial = 0;
  const styles: Record<string, number> = {}, inks: Record<string, number> = {}, kinds: Record<string, number> = {};
  const L = lifespanOf(race);
  for (let i = 0; i < n; i++) {
    const rng = rng32(i * 7919 + 13);
    const ageYears = Math.round(L * (ADULT_FRACTION + rng() * 0.55));
    const set = defaultMarks({ race, subrace: null, className: classes[i % classes.length], birthsign: signs[i % signs.length], ageYears, seed: i + 1 });
    scars += set.scars.length; if (set.scars.length) scarred++;
    tattoos += set.tattoos.length; if (set.tattoos.length) tattooed++;
    for (const s of set.scars) {
      kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
      const kel = resolveKeloid(s, race, null);
      if (kel) keloids++;
      if (resolveHypertrophic(s, race, null, kel)) hyper++;
    }
    for (const t of set.tattoos) {
      styles[t.style] = (styles[t.style] ?? 0) + 1;
      inks[t.inks[0]] = (inks[t.inks[0]] ?? 0) + 1;
      if (t.facial) facial++;
    }
  }
  return {
    race, n, meanScars: scars / n, scarredShare: scarred / n, tattooedShare: tattooed / n, meanTattoos: tattoos / n,
    keloidShare: scars ? keloids / scars : 0, hypertrophicShare: scars ? hyper / scars : 0, styles, inks, kinds, facialShare: tattoos ? facial / tattoos : 0,
  };
}

const f2 = (x: number) => x.toFixed(2), f3 = (x: number) => x.toFixed(3), pct = (x: number) => `${(x * 100).toFixed(1)} %`;

/** The markdown tables of docs/wave-tex/MARKS.md (generated; the doc test compares them). */
export function marksTables(n = 2000): string {
  const out: string[] = [];
  out.push("### Healing stages (incision, not keloid)", "", "| age (days) | stage | redness | maturity | lift | desat | roughness x | height mm |", "|---:|---|---:|---:|---:|---:|---:|---:|");
  for (const d of [0, 2, 7, 14, 21, 45, 90, 180, 365, 730, 3650]) {
    const l = scarLook("incision", d, false);
    out.push(`| ${d} | ${l.stage} | ${f3(l.redness)} | ${f3(l.maturity)} | ${f3(l.lift)} | ${f3(l.desat)} | ${f3(l.roughnessScale)} | ${f3(l.heightMm)} |`);
  }
  out.push("", "### Keloid vs hypertrophic vs normal healing", "", "| age (days) | normal laceration mm | keloid laceration mm | keloid spread x | keloid redness | normal burn mm | hypertrophic burn mm | hypertrophic redness |", "|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const d of [7, 30, 90, 120, 180, 365, 730]) {
    const a = scarLook("laceration", d, false), b = scarLook("laceration", d, true);
    const c = scarLook("burn", d, false), h = scarLook("burn", d, false, true);
    out.push(`| ${d} | ${f3(a.heightMm)} | ${f3(b.heightMm)} | ${f3(b.spread)} | ${f3(b.redness)} | ${f3(c.heightMm)} | ${f3(h.heightMm)} | ${f3(h.redness)} |`);
  }
  out.push("", "### Mature relief per kind (atrophic < 0)", "", "| kind | swell mm (day 0) | height at 2 y mm |", "|---|---:|---:|");
  for (const k of SCAR_KINDS) out.push(`| ${k} | ${f3(scarLook(k, 0).heightMm)} | ${f3(scarLook(k, 730).heightMm)} |`);
  out.push("", "### Scar colour on four skins at full coverage (sRGB hex; capped at fresh-ink contrast)", "", "| skin | day 2 | day 21 | day 180 | 2 years | ink contrast | 2 y scar contrast |", "|---|---|---|---|---|---:|---:|");
  const skins: [string, number[]][] = [["human #c79a80", [0.78, 0.6, 0.5]], ["elf #e6d2c0", [0.9, 0.82, 0.75]], ["dwarf #a06a4c", [0.63, 0.42, 0.3]], ["ork #5d7a3e", [0.36, 0.48, 0.24]]];
  for (const [name, sk] of skins) {
    const cols = [2, 21, 180, 730].map((d) => hex(scarColour(sk, scarLook("incision", d), 1)));
    const ink = 0.92 * Math.hypot(sk[0] - 0.08, sk[1] - 0.08, sk[2] - 0.1);
    const sc = scarColour(sk, scarLook("incision", 730), 1);
    out.push(`| ${name} | ${cols.join(" | ")} | ${f3(ink)} | ${f3(Math.hypot(sc[0] - sk[0], sc[1] - sk[1], sc[2] - sk[2]))} |`);
  }
  out.push("", "### Langer's line default angle (rad; 0 transverse, 1.571 longitudinal)", "", "| region | u=0 v=0 | u=0.5 v=0 | u=0.9 v=0.6 | u=0 v=0.85 |", "|---|---:|---:|---:|---:|");
  for (const r of MARK_REGIONS) {
    out.push(`| ${r} | ${f3(langerAngle(r, 0, 0))} | ${f3(langerAngle(r, 0.5, 0))} | ${f3(langerAngle(r, 0.9, 0.6))} | ${f3(langerAngle(r, 0, 0.85))} |`);
  }
  out.push("", "### Keloid chance per scar (laceration) by ancestry and site", "", "| ancestry | torso | upperArm | ear (puncture) | foreArm | hand |", "|---|---:|---:|---:|---:|---:|");
  for (const [race, sub] of [["human", null], ["human", "islander"], ["elf", null], ["dwarf", null], ["ork", null], ["ork", "bloodfang"]] as [string, string | null][]) {
    out.push(`| ${race}${sub ? "/" + sub : ""} | ${f3(keloidChance(race, sub, "torso", "laceration"))} | ${f3(keloidChance(race, sub, "upperArm", "laceration"))} | ${f3(keloidChance(race, sub, "ear", "puncture"))} | ${f3(keloidChance(race, sub, "foreArm", "laceration"))} | ${f3(keloidChance(race, sub, "hand", "laceration"))} |`);
  }
  out.push("", "### Hypertrophic chance per scar by kind (human, torso / foreArm)", "", "| kind | human torso | human foreArm | ork torso | elf foreArm |", "|---|---:|---:|---:|---:|");
  for (const kd of SCAR_KINDS) {
    out.push(`| ${kd} | ${f3(hypertrophicChance("human", null, "torso", kd))} | ${f3(hypertrophicChance("human", null, "foreArm", kd))} | ${f3(hypertrophicChance("ork", null, "torso", kd))} | ${f3(hypertrophicChance("elf", null, "foreArm", kd))} |`);
  }
  out.push("", "### Ink ageing (biological years)", "", "| ink | fresh opacity | 10 y | 30 y | 60 y | blur mm 0 / 10 / 30 / 60 y |", "|---|---:|---:|---:|---:|---|");
  for (const ink of INK_NAMES) {
    const a = [0, 10, 30, 60].map((y) => inkAge(ink, y));
    out.push(`| ${ink} | ${f3(a[0].opacity)} | ${f3(a[1].opacity)} | ${f3(a[2].opacity)} | ${f3(a[3].opacity)} | ${a.map((x) => f2(x.blurMm)).join(" / ")} |`);
  }
  out.push("", `### Generated marks, ${n} seeds per race (classes and signs cycle, adult ages rolled)`, "", "| race | mean scars | scarred | keloid / scar | hypertrophic / scar | tattooed | mean tattoos | facial / tattoo | top style | top ink | top scar kind |", "|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|");
  for (const race of ["human", "elf", "dwarf", "ork"]) {
    const s = generatedStats(race, n);
    const top = (r: Record<string, number>) => {
      const e = Object.entries(r).sort((a, b) => b[1] - a[1])[0];
      const tot = Object.values(r).reduce((a, b) => a + b, 0);
      return e ? `${e[0]} ${pct(e[1] / tot)}` : "-";
    };
    out.push(`| ${race} | ${f2(s.meanScars)} | ${pct(s.scarredShare)} | ${pct(s.keloidShare)} | ${pct(s.hypertrophicShare)} | ${pct(s.tattooedShare)} | ${f2(s.meanTattoos)} | ${pct(s.facialShare)} | ${top(s.styles)} | ${top(s.inks)} | ${top(s.kinds)} |`);
  }
  return out.join("\n");
}

/** Re-exported for the creator: the editable enums in one place. */
export const MARK_ENUMS = {
  scarKinds: SCAR_KINDS, tattooStyles: TATTOO_STYLES, inks: INK_NAMES, symbols: TATTOO_SYMBOLS,
  regions: MARK_REGIONS, tattooRegions: TATTOO_REGIONS,
} as const;

export type { Footprint, PlacementIssue, RegionFrames, Scar, Tattoo };
