// src/ui/LevelBadge.ts — Wave Z (lane F, contract C-LV): the hero's level badge.
//
// "LV" then the number (LV 12), struck in a metal that follows the level over the game's level span
// (MIN_LEVEL..MAX_LEVEL = 1..20 in src/game/SpectateGen.ts), in five equal bands of four levels:
//   1-4 bronze · 5-8 copper · 9-12 silver · 13-16 gold · 17-20 platinum.
// A level outside the span (or not a number) is clamped into it first, so the badge never shows a
// metal the game cannot reach. Pure: an HTML string with classes and data-attributes only (the page
// CSP is `style-src 'self'`), the metal lives in styles.css (`.lv-badge[data-tier=…]`).

import { MAX_LEVEL, MIN_LEVEL } from "../game/SpectateGen.ts";

export type LevelTier = "bronze" | "copper" | "silver" | "gold" | "platinum";

/** The five metals, lowest first (the band order). */
export const LEVEL_TIERS: readonly LevelTier[] = ["bronze", "copper", "silver", "gold", "platinum"];

/** The level shown: floored, clamped into MIN_LEVEL..MAX_LEVEL; anything not finite reads MIN_LEVEL. */
export function shownLevel(level: number): number {
  if (!Number.isFinite(level)) return MIN_LEVEL;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.floor(level)));
}

/** C-LV: the metal of a level — 1-4 bronze, 5-8 copper, 9-12 silver, 13-16 gold, 17-20 platinum. */
export function levelTier(level: number): LevelTier {
  const n = shownLevel(level);
  // Equal bands over the span: (MAX - MIN + 1) / 5 = 4 levels each.
  const width = (MAX_LEVEL - MIN_LEVEL + 1) / LEVEL_TIERS.length;
  return LEVEL_TIERS[Math.min(LEVEL_TIERS.length - 1, Math.floor((n - MIN_LEVEL) / width))];
}

/**
 * C-LV: `<span class="lv-badge" data-tier="…"><span class="lv-label">LV</span><span class="lv-num">12</span></span>`.
 * `small` adds `lv-badge-sm` (the hero tabs); the accessible name is "Level N".
 */
export function levelBadgeHtml(level: number, opts: { small?: boolean } = {}): string {
  const n = shownLevel(level);
  return `<span class="lv-badge${opts.small ? " lv-badge-sm" : ""}" data-tier="${levelTier(n)}" data-level="${n}" role="img" aria-label="Level ${n}" title="Level ${n}">` +
    `<span class="lv-label" aria-hidden="true">LV</span><span class="lv-num" aria-hidden="true">${n}</span></span>`;
}
