// Combat text (Wave N, lane N-E): the floating damage number's STYLE, a pure function of the
// statistics of the blow that landed. The user asked for "numbers of damages popping out of the
// victim with their styles, colors, boldness, size, speed, brightness, hueness, etc depending on
// all the statistics of the combat" — this is that mapping, and nothing else. The DOM is written
// by the PARENT: this module exposes channel VALUES and CLASS NAMES (the page CSP blocks an inline
// `style=""` attribute — the previous wave lost a screen to it — so the parent sets CSS custom
// properties through CSSOM, element.style.setProperty(name, value), and the class names below).
//
// Colour is NEVER the only channel. A colour-blind reader tells a crit from a normal hit by the
// GLYPH, by the BOLDNESS (weight) and by the SIZE; hue is one signal among four. The test asserts
// that every outcome is separable without hue.
//
// Pure module: no DOM, no THREE, no Math.random, no `any`.

import { ELEMENTS, type Element } from "../game/Skills.ts";

/** The six outcomes a floating number can announce (the enum the parent renders). */
export type HitGlyph = "crit" | "hit" | "absorbed" | "resisted" | "miss" | "immune";

/** The floating number's style: every field bounded and finite (see the constants below). */
export interface HitStyle {
  /** Rendered font size, px, in [HIT_SIZE_MIN_PX, HIT_SIZE_MAX_PX]. Bigger hit = bigger number. */
  sizePx: number;
  /** Font weight, 400..900. Bolder = a bigger or criticaller blow (a colour-blind channel). */
  weight: number;
  /** HSL hue in degrees, [0, 360): comes from the damage's ELEMENT (fire/fury/poison/shadow…). */
  hue: number;
  /** HSL lightness, [0, 1]: brighter for a bigger, criticaller hit (a colour-blind channel). */
  lightness: number;
  /** Milliseconds the number takes to rise. SMALLER = faster; a bigger hit rises faster. */
  riseMs: number;
  /** Milliseconds the number lives before it fades. A bigger hit lingers longer. */
  lifeMs: number;
  /** Which outcome the number announces. */
  glyph: HitGlyph;
}

// ── Bounds (every one a named constant with units; the house rule: a bound is stated, not magic) ──

export const HIT_SIZE_MIN_PX = 16, HIT_SIZE_MAX_PX = 64;
export const HIT_WEIGHT_MIN = 400, HIT_WEIGHT_MAX = 900;
export const HIT_LIGHT_MIN = 0.45, HIT_LIGHT_MAX = 0.9;
/** Rise duration, ms: the FAST end (a huge crit) and the SLOW end (a graze). */
export const HIT_RISE_MIN_MS = 380, HIT_RISE_MAX_MS = 900;
/** Lifetime, ms: the SHORT end (a small hit) and the LONG end (a huge one). */
export const HIT_LIFE_MIN_MS = 650, HIT_LIFE_MAX_MS = 1600;

/**
 * Damage share of the pool that reads as "half scale". The style is monotone in the blow's share
 * of the victim's health — NOT in the raw number — so a 500-damage hit means the same on a level-1
 * fighter (HP ~45 k) and on a level-20 one (HP ~70 k). The curve
 *   t = share / (share + HIT_REF_SHARE)
 * is strictly increasing in `share`, stays inside [0, 1) for any finite share (bounded), and hits
 * 0.5 exactly at a quarter of the pool.
 */
export const HIT_REF_SHARE = 0.25;
/** Share of the pool below which a blow that landed was overwhelmingly resisted. */
export const HIT_RESIST_SHARE = 0.005;
/** Hue shown when the element is unknown: a warm amber that reads neutral (never NaN). */
export const HIT_HUE_FALLBACK = 30;

/** Lowercase, dash-free base class the parent puts on the number's element. */
export const COMBAT_TEXT_BASE_CLASS = "combat-text";

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const fin = (v: number, fallback = 0): number => (Number.isFinite(v) ? v : fallback);

/** Hue (deg) of a #rrggbb colour, or null for grey/undefined — text hues come from ELEMENTS. */
function hexHue(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  const r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return null;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** Hue (deg) of an element's own colour (its `edge`, the shade the player actually sees). */
export function elementHue(element: string): number {
  const style = ELEMENTS[element as Element];
  if (!style) return HIT_HUE_FALLBACK;
  return hexHue(style.edge) ?? hexHue(style.core) ?? HIT_HUE_FALLBACK;
}

/**
 * Which outcome a blow announces, from its statistics alone (precedence, first match wins):
 *   immune   the victim has no health pool at all (maxHealth <= 0) — nothing can wound it;
 *   absorbed the blow was fully eaten by an absorb (absorbedFrac >= 1) — the shield took it all;
 *   miss     no damage got through (damage <= 0) — the swing found nothing;
 *   resisted the blow landed but was reduced below HIT_RESIST_SHARE of the pool;
 *   crit     a critical; otherwise a plain hit.
 */
export function classifyHit(o: {
  damage: number; maxHealth: number; crit: boolean; absorbedFrac: number;
}): HitGlyph {
  const pool = fin(o.maxHealth);
  if (pool <= 0) return "immune";
  const absorbed = Math.max(0, fin(o.absorbedFrac));
  if (absorbed >= 1) return "absorbed";
  const dmg = Math.max(0, fin(o.damage));
  if (dmg <= 0) return "miss";
  if (dmg / pool < HIT_RESIST_SHARE) return "resisted";
  return o.crit ? "crit" : "hit";
}

/** Weight added per outcome so BOLDNESS alone separates the classes (a colour-blind channel). */
const WEIGHT_BY_GLYPH: Record<HitGlyph, number> = {
  crit: 250, absorbed: 150, hit: 0, resisted: 75, immune: 25, miss: -150,
};
/** Size multiplier per outcome: the no-damage outcomes read quieter. */
const SIZE_MUL_BY_GLYPH: Record<HitGlyph, number> = {
  crit: 1, hit: 1, absorbed: 0.95, resisted: 0.9, immune: 0.85, miss: 0.8,
};
const LIGHT_BY_GLYPH: Record<HitGlyph, number> = { miss: -0.08, hit: 0, resisted: 0, absorbed: 0, immune: -0.04, crit: 0.06 };

/**
 * The floating number's style, a pure function of the blow's statistics. Monotone in the hit's
 * SIZE (a bigger share of the pool gives a bigger, brighter, bolder, faster-rising, longer-lived
 * number); every field bounded by the constants above and finite for any input (NaN/negative/
 * Infinity are refused into the floor). Hue comes from the element; crit, the weapon's heft and the
 * attacker's haste add their bounded lifts.
 */
export function hitStyle(o: {
  damage: number; maxHealth: number; crit: boolean; absorbedFrac: number;
  element: string; weaponHeavy: boolean; attackerHastePct: number;
}): HitStyle {
  const glyph = classifyHit(o);
  const pool = fin(o.maxHealth) > 0 ? o.maxHealth : 1;
  const share = Math.max(0, fin(o.damage)) / pool;
  // Bounded, strictly increasing map of the pool share to 0..1 (a Michaelis-Menten saturating curve).
  const t = share / (share + HIT_REF_SHARE);
  const heavy = o.weaponHeavy === true;
  const haste = clamp(fin(o.attackerHastePct), 0, 100) / 100;

  const sizePx = clamp(
    (HIT_SIZE_MIN_PX + (HIT_SIZE_MAX_PX - HIT_SIZE_MIN_PX) * t) *
      SIZE_MUL_BY_GLYPH[glyph] + (o.crit ? 6 : 0) + (heavy ? 3 : 0),
    HIT_SIZE_MIN_PX, HIT_SIZE_MAX_PX,
  );
  const weight = Math.round(clamp(
    HIT_WEIGHT_MIN + (HIT_WEIGHT_MAX - HIT_WEIGHT_MIN) * 0.4 * t
      + WEIGHT_BY_GLYPH[glyph] + (heavy ? 60 : 0),
    HIT_WEIGHT_MIN, HIT_WEIGHT_MAX,
  ));
  const lightness = clamp(
    HIT_LIGHT_MIN + (HIT_LIGHT_MAX - HIT_LIGHT_MIN) * t
      + LIGHT_BY_GLYPH[glyph] + (o.crit ? 0.05 : 0) + (heavy ? 0.03 : 0),
    HIT_LIGHT_MIN, HIT_LIGHT_MAX,
  );
  const riseMs = clamp(
    (HIT_RISE_MAX_MS - (HIT_RISE_MAX_MS - HIT_RISE_MIN_MS) * t)
      * (o.crit ? 0.9 : 1) / (1 + haste),
    HIT_RISE_MIN_MS, HIT_RISE_MAX_MS,
  );
  const lifeMs = clamp(
    (HIT_LIFE_MIN_MS + (HIT_LIFE_MAX_MS - HIT_LIFE_MIN_MS) * t) * (o.crit ? 1.1 : 1),
    HIT_LIFE_MIN_MS, HIT_LIFE_MAX_MS,
  );
  return {
    sizePx, weight, hue: elementHue(o.element), lightness,
    riseMs, lifeMs, glyph,
  };
}

/**
 * The damage number, grouped in threes with a space — the repo's own house style ("47 100",
 * FighterPanel.barLabel). Total over any input: a non-finite value reads "0"; the sign is kept.
 */
export function formatHit(n: number): string {
  const v = Math.round(fin(n));
  const neg = v < 0, digits = String(Math.abs(v));
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    out += digits[i];
    const fromEnd = digits.length - i;
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += " ";
  }
  return neg ? `-${out}` : out;
}

/** A distinct SHAPE per outcome — the glyph channel a colour-blind reader relies on. */
export const HIT_GLYPH_CHAR: Record<HitGlyph, string> = {
  crit: "\u2726",      // ✦  four-pointed star
  hit: "\u25CF",       // ●  filled circle
  absorbed: "\u25C7",  // ◇  hollow diamond
  resisted: "\u25BD",  // ▽  hollow triangle
  miss: "\u2715",      // ✕  cross
  immune: "\u26E8",    // ⛨  shield
};

/** A word per outcome for screen readers and the combat log (colour is never the only channel). */
export const HIT_GLYPH_WORD: Record<HitGlyph, string> = {
  crit: "CRIT", hit: "HIT", absorbed: "ABSORBED", resisted: "RESISTED", miss: "MISS", immune: "IMMUNE",
};

/** The class list the parent assigns (element.className): base + the outcome modifier. */
export function combatTextClass(s: HitStyle): string {
  return `${COMBAT_TEXT_BASE_CLASS} ${COMBAT_TEXT_BASE_CLASS}--${s.glyph}`;
}

/**
 * The CSS custom properties the parent sets through CSSOM (element.style.setProperty(name, value)).
 * Values carry their unit so the parent's stylesheet can consume them directly. NEVER an inline
 * style="" attribute — the page CSP blocks those.
 */
export function combatTextVars(s: HitStyle): Record<string, string> {
  return {
    "--ct-size": `${s.sizePx.toFixed(1)}px`,
    "--ct-weight": String(Math.round(s.weight)),
    "--ct-hue": s.hue.toFixed(1),
    "--ct-light": `${(s.lightness * 100).toFixed(1)}%`,
    "--ct-rise": `${Math.round(s.riseMs)}ms`,
    "--ct-life": `${Math.round(s.lifeMs)}ms`,
  };
}

/** The number's text content: glyph + grouped damage, e.g. "✦ 4 210" (or "✕ 0" for a miss). */
export function combatTextText(s: HitStyle, damage: number): string {
  return `${HIT_GLYPH_CHAR[s.glyph]} ${formatHit(damage)}`;
}
