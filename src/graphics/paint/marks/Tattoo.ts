// Tattoo: the tattoo model (wave TEX, lane M, contract C-MARK).
//
// Pure module: no THREE, no DOM, no Math.random. A tattoo is a STYLE (how it is drawn), a MOTIF
// (a glyph of Symbols.ts, chosen from the race / class / birth-sign symbol sets), INKS, a size and
// an age. Drawing happens in local millimetres (s along the design's horizontal, t up), like a
// scar; the region frame (Placement.ts) wraps that plane around the limb, so a band closes on
// itself and every design bends with the bind-pose surface (it rides the skin as muscles move).
//
// Tattoo-artist / dermatology notes (plain language; tables in docs/wave-tex/MARKS.md):
// - Ink sits in the dermis; over years macrophages carry pigment a little sideways, so lines
//   SPREAD (a 0.3 mm line reads ~0.8 mm after a few decades) and the whole piece FADES (sunlight
//   and clearance). Carbon black is the most stable; reds and earth pigments fade faster; old
//   black drifts toward blue-green-grey.
// - Fine dotwork and script suffer most from spread: dots merge, letters close up.
// - Bands wrap a limb completely; they sit on the upper arm, forearm, wrist and calf.

import type { Region } from "../../body/contracts.ts";
import { symbolDistance, symbolIndex, TATTOO_SYMBOLS, type TattooSymbol } from "../Symbols.ts";
import { markHash, valueNoise1 } from "./Scar.ts";

/** Styles, in a fixed order (a style's index is its numeric code). */
export const TATTOO_STYLES = ["tribal", "runic", "sigil", "band", "script", "dotwork"] as const;
export type TattooStyle = typeof TATTOO_STYLES[number];

/** Inks, in a fixed order (an ink's index is its numeric code). */
export const INK_NAMES = ["black", "blueBlack", "red", "ochre", "woad"] as const;
export type InkName = typeof INK_NAMES[number];

/** A tattoo on the body (C-MARK). `anchor` is (u, v) in the region frame, each in [-1, 1]. */
export interface Tattoo {
  style: TattooStyle;
  motif: TattooSymbol;
  region: Region;
  side?: 0 | 1;
  anchor: [number, number];
  /** Design height in mm (a band: the band's width along the limb). */
  sizeMm: number;
  /** Radians in the region frame; null/absent = upright (along the region's axis), bands 0. */
  angle?: number | null;
  /** 1-2 inks: [line, accent]. */
  inks: InkName[];
  /** Years since it was tattooed (biological years: Tattoo ages the skin at the race's pace). */
  ageYears: number;
  seed: number;
  mirror?: boolean;
  /** A facial tattoo: allowed on the face (still never over the eyes or the lips). */
  facial?: boolean;
}

/** Ink pigments: fresh sRGB colour, fade time constant (years) and the floor it fades to. */
export const INKS: Readonly<Record<InkName, { srgb: [number, number, number]; fadeTauYears: number; fadeFloor: number; note: string }>> = {
  black:     { srgb: [0.08, 0.08, 0.1],  fadeTauYears: 40, fadeFloor: 0.7,  note: "carbon black: most stable, drifts blue-green with age" },
  blueBlack: { srgb: [0.1, 0.13, 0.22],  fadeTauYears: 35, fadeFloor: 0.65, note: "carbon with indigo: sailor's and clan ink" },
  red:       { srgb: [0.55, 0.12, 0.1],  fadeTauYears: 18, fadeFloor: 0.45, note: "cinnabar/iron red: fades fastest" },
  ochre:     { srgb: [0.66, 0.45, 0.16], fadeTauYears: 20, fadeFloor: 0.45, note: "earth ochre: warm, fades to straw" },
  woad:      { srgb: [0.15, 0.27, 0.5],  fadeTauYears: 25, fadeFloor: 0.5,  note: "woad (plant indigo): the orc war-blue" },
};

/** The colour old black ink drifts toward. */
export const AGED_BLACK: readonly [number, number, number] = [0.2, 0.27, 0.3];
/** Fresh ink opacity over skin. */
export const FRESH_OPACITY = 0.92;
/** Fresh line spread (mm), extra spread after decades (mm), and its time constant (years). */
export const INK_BLUR = { freshMm: 0.08, maxExtraMm: 0.6, tauYears: 15 } as const;

/** What years do to an ink: blur (mm), opacity, and the shifted colour. */
export interface InkAge { blurMm: number; opacity: number; srgb: [number, number, number] }

/**
 * Ink ageing:
 *   blur    = freshMm + maxExtraMm (1 - e^(-y / tauBlur))                  (mm, non-decreasing)
 *   opacity = FRESH (floor + (1 - floor) e^(-y / tauFade(ink)))             (non-increasing)
 *   colour  = black: lerp(black, AGED_BLACK, 1 - e^(-y / 25)); others unchanged.
 */
export function inkAge(ink: InkName, years: number): InkAge {
  const y = Math.max(0, Number.isFinite(years) ? years : 0);
  const p = INKS[ink] ?? INKS.black;
  const blurMm = INK_BLUR.freshMm + INK_BLUR.maxExtraMm * (1 - Math.exp(-y / INK_BLUR.tauYears));
  const opacity = FRESH_OPACITY * (p.fadeFloor + (1 - p.fadeFloor) * Math.exp(-y / p.fadeTauYears));
  let srgb: [number, number, number] = [p.srgb[0], p.srgb[1], p.srgb[2]];
  if (ink === "black") {
    const k = 1 - Math.exp(-y / 25);
    srgb = [srgb[0] + (AGED_BLACK[0] - srgb[0]) * k, srgb[1] + (AGED_BLACK[1] - srgb[1]) * k, srgb[2] + (AGED_BLACK[2] - srgb[2]) * k];
  }
  return { blurMm, opacity, srgb };
}

/** Lifespans used to turn calendar years into the skin's biological years (Age.ts LIFESPAN). */
export function biologicalYears(years: number, lifespan: number): number {
  return Math.max(0, years) * (80 / Math.max(1, lifespan));
}

// ---------------------------------------------------------------------------------------------
// Motif sets.

/** Birth sign -> glyph (Symbols.ts already draws one glyph per sign). */
export const SIGN_MOTIFS: Readonly<Record<string, TattooSymbol>> = {
  void: "ring", mountain: "peaks", flame: "flame", moon: "crescent", storm: "bolt", serpent: "serpent",
};

/** Class -> glyphs (Symbols.ts: star arcane, sun devotion, eye the watching dead, ...). */
export const CLASS_MOTIFS: Readonly<Record<string, readonly TattooSymbol[]>> = {
  Barbarian: ["fang", "claw"], Warrior: ["sword", "peaks"], Rogue: ["claw", "crescent"],
  Assassin: ["fang", "eye"], Mage: ["star", "bolt"], Necromancer: ["eye", "ring"],
  Archer: ["arrow", "crescent"], Priest: ["sun", "star"],
};

/** Race -> glyphs that belong to the people. */
export const RACE_MOTIFS: Readonly<Record<string, readonly TattooSymbol[]>> = {
  ork: ["fang", "claw", "bolt"], dwarf: ["peaks", "ring", "sword"],
  elf: ["crescent", "star", "serpent"], human: ["sword", "sun", "arrow"],
};

/** Race -> inks with weights (race-appropriate pigments). */
export const RACE_INKS: Readonly<Record<string, readonly [InkName, number][]>> = {
  ork: [["woad", 5], ["black", 2], ["red", 1], ["ochre", 1]],
  dwarf: [["black", 4], ["blueBlack", 2], ["ochre", 1.5]],
  elf: [["blueBlack", 3], ["woad", 2], ["black", 1], ["red", 0.3]],
  human: [["black", 4], ["red", 1.5], ["blueBlack", 1]],
};

/** Every glyph a profile may wear: its sign, class and race sets (deduplicated, in that order). */
export function motifsFor(race: string, className: string, birthsign: string | null | undefined): TattooSymbol[] {
  const out: TattooSymbol[] = [];
  const add = (m: TattooSymbol | undefined) => { if (m && !out.includes(m)) out.push(m); };
  add(SIGN_MOTIFS[birthsign ?? ""]);
  for (const m of CLASS_MOTIFS[className] ?? []) add(m);
  for (const m of RACE_MOTIFS[race] ?? RACE_MOTIFS.human) add(m);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Drawing.

/** Half extents (mm) of the design along s and t. A band's s extent is the full circumference. */
export function tattooExtentMm(t: Tattoo, circumferenceMm = Infinity): [number, number] {
  const h = Math.max(4, t.sizeMm) / 2;
  switch (t.style) {
    case "band": return [Number.isFinite(circumferenceMm) ? circumferenceMm / 2 : h * 6, h];
    case "runic": return [h * runeCount(t) * 0.9, h * 0.75];
    case "script": return [h * 2.2, h * 0.6];
    case "tribal": return [h * 1.3, h * 1.3];
    case "dotwork": { const e = h * 1.45 + DOT_RADIUS_MM * dotScale(t) + DOT_PITCH_MM * dotScale(t) * 0.15; return [e, e]; } // stipple halo
    default: return [h, h];
  }
}

/** Runes in a runic line (3-5). */
export function runeCount(t: Pick<Tattoo, "seed">): number { return 3 + Math.floor(markHash(t.seed, 0x52) * 3); }

/** Glyph index of rune k of a runic tattoo: the motif first, then seeded glyphs. */
function runeSymbol(t: Tattoo, k: number): number {
  const m = symbolIndex(t.motif);
  return k === 0 ? Math.max(0, m) : Math.floor(markHash(t.seed, 0x5200 + k) * TATTOO_SYMBOLS.length);
}

/** Stroke half-widths in glyph units per style (sigil fine line, tribal bold). */
export const STYLE_STROKE: Readonly<Record<TattooStyle, number>> = {
  tribal: 0.17, runic: 0.09, sigil: 0.06, band: 0.09, script: 0.07, dotwork: 0.14,
};

/**
 * Dotwork: dot pitch and dot radius (mm) for a 40 mm design. Real fine dotwork uses ~0.3-0.5 mm dots;
 * at every game camera (0.8-3 mm per pixel) those are sub-pixel and the piece vanishes (QD Z-78), so
 * the game stylises: 0.9 mm dots on a 2.6 mm pitch, scaled up with the design (dotScale).
 */
export const DOT_PITCH_MM = 2.6;
export const DOT_RADIUS_MM = 0.9;
/** Dot scale of a design: 1 up to 40 mm, then proportional (a 90 mm piece has 2 mm dots). */
export function dotScale(t: Pick<Tattoo, "sizeMm">): number { return Math.max(1, Math.max(4, t.sizeMm) / 40); }

function clamp(x: number, lo: number, hi: number): number { return x < lo ? lo : x > hi ? hi : x; }
function inkEdge(d: number, w: number, blur: number): number {
  // d, w, blur in mm: a line of half-width w with a soft edge widened by the ink spread.
  const e = 0.12 + blur;
  return 1 - clamp((d - (w - e)) / (2 * e), 0, 1);
}

/** One tattoo sample: ink coverage 0..1 and which ink (0 line, 1 accent). */
export interface TattooSample { coverage: number; accent: number }

/**
 * Ink coverage at local (s, t) mm (s along the design, t up). `blurMm` widens every edge (ink
 * migration); `circumferenceMm` is needed by bands (s wraps with that period). Styles:
 *   sigil   the glyph as a fine line (radius = size / 2);
 *   tribal  the glyph in a bold line, ringed by thorns (accent ink);
 *   runic   a row of 3-5 glyphs between two rule lines (accent), the motif first;
 *   band    two border lines and the glyph repeated around the whole limb;
 *   script  a cursive baseline of loops broken into words;
 *   dotwork the glyph stippled: dots on a jittered grid, denser on the stroke, a sparse halo.
 */
export function sampleTattoo(t: Tattoo, s: number, tt: number, blurMm: number, circumferenceMm = Infinity, out?: TattooSample): TattooSample {
  const o = out ?? { coverage: 0, accent: 0 };
  o.coverage = 0; o.accent = 0;
  const R = Math.max(4, t.sizeMm) / 2;                 // glyph radius, mm
  const sym = Math.max(0, symbolIndex(t.motif));
  const w = STYLE_STROKE[t.style] * R;
  switch (t.style) {
    case "sigil": {
      o.coverage = inkEdge(symbolDistance(sym, s / R, tt / R) * R, w, blurMm);
      break;
    }
    case "tribal": {
      const g = inkEdge(symbolDistance(sym, s / R, tt / R) * R, w, blurMm);
      // Thorn ring: radius 1.05-1.3 R, 9 spikes whose width shrinks outward.
      const r = Math.hypot(s, tt) / R, a = Math.atan2(tt, s);
      let thorn = 0;
      if (r > 1.0 && r < 1.32) {
        const f = (a / (2 * Math.PI)) * 9 + 0.5 * markHash(t.seed, 3);
        const tri = Math.abs(2 * (f - Math.floor(f)) - 1);       // 0 at a spike centre
        const half = 0.5 * (1.32 - r) / 0.32;                     // spike half-width (in periods)
        thorn = tri < half ? 1 - clamp((tri - half + 0.06) / 0.12, 0, 1) : 0;
      }
      o.coverage = Math.max(g, thorn); o.accent = thorn > g ? 1 : 0;
      break;
    }
    case "runic": {
      const n = runeCount(t), cell = 1.8 * R * 0.5;              // rune radius 0.5 R, pitch 1.8 rr
      const rr = 0.5 * R, x0 = -((n - 1) * cell) / 2;
      const k = Math.round((s - x0) / cell);
      let g = 0;
      if (k >= 0 && k < n) {
        const sx = s - (x0 + k * cell);
        g = inkEdge(symbolDistance(runeSymbol(t, k), sx / rr, tt / rr) * rr, STYLE_STROKE.runic * rr * 1.4, blurMm);
      }
      const halfLen = (n * cell) / 2 + 0.2 * rr, ruleY = 0.72 * R;
      let rule = 0;
      if (Math.abs(s) <= halfLen) rule = Math.max(inkEdge(Math.abs(tt - ruleY), 0.05 * R, blurMm), inkEdge(Math.abs(tt + ruleY), 0.05 * R, blurMm));
      o.coverage = Math.max(g, rule); o.accent = rule > g ? 1 : 0;
      break;
    }
    case "band": {
      const C = Number.isFinite(circumferenceMm) ? circumferenceMm : 12 * R;
      const tileW = 1.6 * R * 0.6, n = Math.max(3, Math.round(C / tileW)), pitch = C / n;
      const ss = ((s % C) + C) % C;                              // wraps the limb
      const sx = ss - (Math.floor(ss / pitch) + 0.5) * pitch;
      const gr = 0.55 * R;
      const g = inkEdge(symbolDistance(sym, sx / gr, tt / gr) * gr, STYLE_STROKE.band * gr * 1.3, blurMm);
      const border = Math.max(inkEdge(Math.abs(tt - 0.9 * R), 0.09 * R, blurMm), inkEdge(Math.abs(tt + 0.9 * R), 0.09 * R, blurMm));
      o.coverage = Math.max(g, border); o.accent = border > g ? 1 : 0;
      break;
    }
    case "script": {
      const hl = 2.2 * R, x = s / (0.35 * R);
      if (Math.abs(s) > hl) break;
      // Words: gaps where a slow hash noise dips; letters: loops of a sum of sines.
      const word = valueNoise1(t.seed + 9, s / (0.9 * R));
      if (word < -0.55) break;
      const y = 0.22 * R * Math.sin(x * 2.1) + 0.12 * R * Math.sin(x * 4.7 + 1.3) + 0.08 * R * valueNoise1(t.seed + 11, x);
      const dy = 0.22 * R * 2.1 * Math.cos(x * 2.1) / (0.35 * R) + 0.12 * R * 4.7 * Math.cos(x * 4.7 + 1.3) / (0.35 * R);
      const d = Math.abs(tt - y) / Math.sqrt(1 + dy * dy);
      o.coverage = inkEdge(d, STYLE_STROKE.script * R, blurMm);
      break;
    }
    case "dotwork": {
      const gd = symbolDistance(sym, s / R, tt / R);             // glyph units
      const k = dotScale(t), pitch = DOT_PITCH_MM * k, rad = DOT_RADIUS_MM * k;
      const ix = Math.round(s / pitch), iy = Math.round(tt / pitch);
      let best = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const cx = ix + dx, cy = iy + dy, h = markHash(t.seed, Math.imul(cx, 92821) ^ Math.imul(cy, 68917));
          const px = (cx + (h - 0.5) * 0.3) * pitch, py = (cy + (markHash(t.seed + 1, cx * 31 + cy) - 0.5) * 0.3) * pitch;
          const gdc = symbolDistance(sym, px / R, py / R);
          // Keep a dot: always on the stroke, with falling probability in the halo (stipple).
          const keep = gdc < STYLE_STROKE.dotwork ? 1 : gdc < 0.45 ? 1 - (gdc - STYLE_STROKE.dotwork) / (0.45 - STYLE_STROKE.dotwork) : 0;
          if (keep <= 0 || h > keep * keep) continue;
          best = Math.max(best, inkEdge(Math.hypot(s - px, tt - py), rad, blurMm));
        }
      }
      o.coverage = gd > 0.6 ? 0 : best;
      break;
    }
  }
  return o;
}

/** Mean ink coverage over the design's footprint (n x n grid): the per-vertex density. */
export function tattooDensity(t: Tattoo, blurMm: number, circumferenceMm = Infinity, n = 32): number {
  const [ex, ey] = tattooExtentMm(t, circumferenceMm), smp: TattooSample = { coverage: 0, accent: 0 };
  let c = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      c += sampleTattoo(t, ((i + 0.5) / n * 2 - 1) * ex, ((j + 0.5) / n * 2 - 1) * ey, blurMm, circumferenceMm, smp).coverage;
    }
  }
  return c / (n * n);
}

/** The colour of ink `ink` aged `years`, over `skin` at coverage (sRGB 0..1, normal blend). */
export function inkOver(skin: readonly number[], ink: InkName, years: number, coverage = 1): [number, number, number] {
  const a = inkAge(ink, years), k = clamp(coverage, 0, 1) * a.opacity;
  return [skin[0] + (a.srgb[0] - skin[0]) * k, skin[1] + (a.srgb[1] - skin[1]) * k, skin[2] + (a.srgb[2] - skin[2]) * k];
}
