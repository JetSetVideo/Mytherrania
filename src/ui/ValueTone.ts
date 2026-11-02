// ValueTone (Wave X, contract C-TONE): the ONE colour law for every signed number on screen.
//
// The user asked that "positive numbers are green, shading through neutral to red for negatives".
// `toneFor(value, { neutral, span })` is that law: a value ABOVE `neutral` shades toward green, one
// BELOW shades toward red, and the neutral value itself reads a quiet grey. The shading is smooth
// (continuous in the value, saturation and lightness both ramp with |t|) and saturates at
// `neutral ± span`, so a +1 race bonus is a pale green and a +5 a full one.
//
// Two surfaces exist in this skin: dark walnut/leather frames and parchment wells (the stepper
// value wells, the field wells, the victory scroll). One colour cannot reach 4.5:1 on both, so the
// law takes a `surface` and darkens its inks on parchment. The DOM helper `paintTones` picks the
// surface from the element's own ancestry (`PARCHMENT_SELECTOR`), so a call site never guesses.
//
// Pure arithmetic + a tiny DOM pass that only reads `closest()` and writes `style.color` (CSSOM —
// the page CSP blocks inline `style=""` attributes). No THREE, no Math.random.

/** Which background a toned number sits on. */
export type ToneSurface = "dark" | "parchment";

export interface ToneOptions {
  /** The value that reads neutral grey (default 0: a signed delta). */
  neutral?: number;
  /** How far from neutral the colour saturates (default 5 units; always > 0). */
  span?: number;
  /** The background the number sits on (default "dark"). */
  surface?: ToneSurface;
  /** Lower is better (an attack interval, a cooldown): the colour flips. */
  invert?: boolean;
}

/** Hues (degrees): a heraldic green and a madder red, chosen to stay apart for deuteranopes in lightness too. */
export const TONE_HUE_POS = 122;
export const TONE_HUE_NEG = 5;
/** Default span when the caller gives none. */
export const TONE_DEFAULT_SPAN = 5;

/** Per-surface ink: lightness at neutral and at full tone, and the peak saturation per side. */
export const TONE_INK: Readonly<Record<ToneSurface, { lNeutral: number; lPos: number; lNeg: number; sPos: number; sNeg: number; sNeutral: number }>> = {
  // On walnut (#140d08..#2a1c12): light inks, the neutral a warm parchment grey.
  dark: { lNeutral: 0.72, lPos: 0.64, lNeg: 0.66, sPos: 0.58, sNeg: 0.78, sNeutral: 0.08 },
  // On parchment (#e9d9b2..#f3e7c6): iron-gall-dark inks.
  parchment: { lNeutral: 0.3, lPos: 0.205, lNeg: 0.34, sPos: 0.72, sNeg: 0.74, sNeutral: 0.1 },
};

/** Reference backgrounds the contrast test and the probe measure against (from styles.css tokens). */
export const TONE_BACKGROUNDS: Readonly<Record<ToneSurface, readonly string[]>> = {
  dark: ["#140d08", "#170f09", "#2a1c12", "#0b0705"],
  parchment: ["#e9d9b2", "#f3e7c6", "#ead9b0", "#dcc697"],
};

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** The signed, saturating position of `value`: -1 (full red) .. 0 (neutral) .. +1 (full green). */
export function toneT(value: number, o: ToneOptions = {}): number {
  if (!Number.isFinite(value)) return 0;
  const neutral = Number.isFinite(o.neutral) ? o.neutral! : 0;
  const span = Number.isFinite(o.span) && (o.span as number) > 0 ? o.span! : TONE_DEFAULT_SPAN;
  const t = clamp((value - neutral) / span, -1, 1);
  return o.invert ? -t : t;
}

/** HSL (h deg, s/l 0..1) -> [r, g, b] 0..255. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/**
 * The CSS colour for a value: `rgb(r, g, b)`. Green above neutral, red below, grey at it, smooth in
 * between (the ramp is an ease-out, so a small but real advantage is already visibly green).
 */
export function toneFor(value: number, o: ToneOptions = {}): string {
  const [r, g, b] = toneRgb(value, o);
  return `rgb(${r}, ${g}, ${b})`;
}

/** The same colour as an [r, g, b] triple (for contrast checks). */
export function toneRgb(value: number, o: ToneOptions = {}): [number, number, number] {
  const t = toneT(value, o);
  const ink = TONE_INK[o.surface ?? "dark"];
  const m = Math.abs(t);
  // Ease-out: |t| = 0.2 already carries ~36 % of the full tone; continuous and monotone.
  const e = 1 - (1 - m) * (1 - m);
  const pos = t >= 0;
  const hue = pos ? TONE_HUE_POS : TONE_HUE_NEG;
  const s = ink.sNeutral + ((pos ? ink.sPos : ink.sNeg) - ink.sNeutral) * e;
  const l = ink.lNeutral + ((pos ? ink.lPos : ink.lNeg) - ink.lNeutral) * e;
  // At exactly neutral the hue is irrelevant only if s is ~0; keep a warm grey (the parchment's hue).
  return hslToRgb(m === 0 ? 40 : hue, s, l);
}

/** The sign class of a value (for a colour-blind second channel: the glyph and the weight). */
export function toneClass(value: number, o: ToneOptions = {}): "tone-pos" | "tone-neg" | "tone-zero" {
  const t = toneT(value, o);
  return t > 1e-9 ? "tone-pos" : t < -1e-9 ? "tone-neg" : "tone-zero";
}

/** A signed number for display: "+3", "−2" (a real minus, U+2212), "0". Digits grouped in threes. */
export function signed(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "0";
  const p = 10 ** digits;
  const v = Math.round(n * p) / p;
  if (v === 0) return digits > 0 ? (0).toFixed(digits) : "0";
  const abs = Math.abs(v).toFixed(digits);
  const [int, frac] = abs.split(".");
  let g = "";
  for (let i = 0; i < int.length; i++) {
    if (i > 0 && (int.length - i) % 3 === 0) g += " ";
    g += int[i];
  }
  return `${v > 0 ? "+" : "\u2212"}${g}${frac ? `.${frac}` : ""}`;
}

// ── contrast (WCAG 2.x relative luminance) ──────────────────────────────────────────

/** Parse "#rrggbb", "rgb(r, g, b)" or "rgba(r, g, b, a)" to [r, g, b]; null when it is neither. */
export function parseColour(c: string): [number, number, number] | null {
  const s = c.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const v = parseInt(hex[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(s);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

/** WCAG relative luminance of an sRGB triple. */
export function luminance([r, g, b]: readonly [number, number, number]): number {
  const lin = (c: number) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours (1..21); NaN when either does not parse. */
export function contrastRatio(a: string | readonly [number, number, number], b: string | readonly [number, number, number]): number {
  const A = typeof a === "string" ? parseColour(a) : a;
  const B = typeof b === "string" ? parseColour(b) : b;
  if (!A || !B) return NaN;
  const la = luminance(A), lb = luminance(B);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ── the DOM pass ────────────────────────────────────────────────────────────────────

/** The containers whose background is parchment: a toned number inside one uses the dark inks. */
export const PARCHMENT_SELECTOR = ".stepper, .field input, .victory-card, .screen-hint-scroll, .parchment";

/** The minimal element surface `paintTones` needs (a real Element satisfies it; tests can shim it). */
export interface ToneElement {
  getAttribute(name: string): string | null;
  closest(selector: string): unknown;
  style: { color: string };
}

/** The surface an element sits on, read from its own ancestry. */
export function surfaceOf(el: Pick<ToneElement, "closest">): ToneSurface {
  return el.closest(PARCHMENT_SELECTOR) ? "parchment" : "dark";
}

/**
 * Colour every `[data-tone]` element under `root`: `data-tone` is the value, `data-tone-neutral`,
 * `data-tone-span` and `data-tone-invert` the options. Markup stays class/attribute-only (CSP), the
 * colour is written through CSSOM. Returns how many elements were painted.
 */
export function paintTones(root: { querySelectorAll(sel: string): ArrayLike<ToneElement> }): number {
  const els = root.querySelectorAll("[data-tone]");
  let n = 0;
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    const v = Number(el.getAttribute("data-tone"));
    if (!Number.isFinite(v)) continue;
    const neutral = Number(el.getAttribute("data-tone-neutral") ?? 0);
    const span = Number(el.getAttribute("data-tone-span") ?? TONE_DEFAULT_SPAN);
    const invert = el.getAttribute("data-tone-invert") === "1";
    el.style.color = toneFor(v, { neutral, span, invert, surface: surfaceOf(el) });
    n++;
  }
  return n;
}

/** Attribute markup for a toned element (escape-free: only numbers are written). */
export function toneAttrs(value: number, o: Omit<ToneOptions, "surface"> = {}): string {
  const fin = (x: number) => (Number.isFinite(x) ? String(+x.toFixed(6)) : "0");
  return ` data-tone="${fin(value)}"` +
    (o.neutral !== undefined ? ` data-tone-neutral="${fin(o.neutral)}"` : "") +
    (o.span !== undefined ? ` data-tone-span="${fin(o.span)}"` : "") +
    (o.invert ? ` data-tone-invert="1"` : "") +
    ` data-tone-class="${toneClass(value, o)}"`;
}
