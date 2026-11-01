/**
 * Icons — monochrome line icons as inline SVG strings (pure: no DOM, no THREE).
 *
 * Every icon is drawn on a 24 x 24 user-unit grid (`viewBox="0 0 24 24"`), stroked with
 * `currentColor` (so CSS `color` paints it; the menu sets white), never filled, with round caps
 * and joins. The stroke width is {@link ICON_STROKE_WIDTH} user units: at the 18-20 px display
 * size that is ~1.4 px, crisp on 1x and 2x screens.
 *
 * CSP note: the page runs under `style-src 'self'`, which blocks `style="..."` attributes.
 * SVG presentation attributes (`stroke`, `fill`, `stroke-width`, ...) are attributes, not
 * inline styles, so they are allowed. No icon string contains `style=`.
 */

/** Stroke width in viewBox units (24 units = the icon's side). */
export const ICON_STROKE_WIDTH = 1.75;

/** Side of the icon grid in user units; every path below is drawn inside [0, 24]. */
export const ICON_GRID = 24;

/** Names of every icon this module can draw. */
export type IconName =
  | "serpent" | "mountain" | "flame" | "moon" | "storm" | "void"
  | "chevron-left" | "chevron-down"
  | "dash" | "power" | "defense" | "dice"
  | "gear" | "flag" | "play" | "restart" | "home" | "close"
  // Wave U: the menus' own glyphs (they replace the emoji buttons: ⚔ 📋 📜 👁).
  | "swords" | "scroll" | "eye" | "sheet" | "save" | "chevron-right";

/**
 * The inner SVG markup (paths only) of each icon, in viewBox units.
 * Shapes, in words:
 * - serpent: an oval head (top-right, ~2x the stroke so it survives 18 px), an S-shaped body
 *   down to the tail (bottom-left) and a forked tongue.
 * - mountain: two peaks on a baseline with a snow-line zig-zag on the tall one.
 * - flame: an outer tongue of fire with an inner flame.
 * - moon: a crescent.
 * - storm: a lightning bolt.
 * - void: a vortex of three semicircles of radius r, 2r, 3r (r = 2.4) alternating between two
 *   centres r apart, so successive rings sit 2r = 4.8 units apart — about 2.7 stroke widths,
 *   which keeps the turns separate at 18 px instead of merging into a disc.
 * - chevron-left: the Back arrow.
 * - chevron-down: the closed-tree disclosure marker (a downward chevron); chevron-left is its left twin.
 * - dash: three staggered speed lines with an arrowhead (a movement burst).
 * - power: an eight-point impact star (outer radius 9.5, inner 4.4, about the centre).
 * - defense: a heater shield.
 * - dice: a five-pip die — a rounded 17-unit square face (3.5..20.5) with five solid pips of
 *   radius 1.6 units on the corners and the centre, so it reads as a die at 20 px.
 * - gear: the Settings cog — eight teeth (tip radius 9.6, root radius 7.4, each tip 21 deg wide)
 *   around a hub circle of radius 3.2, all centred on (12, 12).
 * - flag: a white flag (Give up) — a pole on the left with a waving cloth.
 * - play: a right-pointing triangle (Resume).
 * - restart: a circular arrow, open at the top-right, arrowhead clockwise (Restart).
 * - home: a house outline with a door (Main menu).
 * - close: an X (close a dialog).
 */
const PATHS: Record<IconName, string> = {
  serpent:
    `<ellipse cx="16.6" cy="5.6" rx="3.1" ry="2.4"/>` +
    `<path d="M13.6 6.4C10.2 6.7 7.6 8 7.6 10.2s2.6 3 5 3.3 5.1 1.3 5.1 3.6-2.5 3.7-5.6 3.7c-2.3 0-4.2-.6-5.6-1.8"/>` +
    `<path d="M19.7 5.6h1.2l1.4-1.5M20.9 5.6l1.4 1.5"/>`,
  mountain:
    `<path d="M2.5 19.5 9 8l4.2 7 2.6-3.8 5.7 8.3z"/>` +
    `<path d="M6.9 11.7 8.3 13l1.5-1.2 1.4 1.1"/>`,
  flame:
    `<path d="M12 21.5c-3.8 0-6.5-2.6-6.5-6.1 0-3.4 2.5-5.2 3.6-8 .6 1.7 1.5 2.8 2.6 3.2.2-3.4 1.7-5.9 3.9-7.6-.3 2.8.6 4.9 1.9 6.7 1.1 1.5 2 3.3 2 5.7 0 3.7-2.9 6.1-7.5 6.1z"/>` +
    `<path d="M12 21.5c-1.9 0-3.2-1.2-3.2-3 0-1.9 1.6-2.9 2.6-4.6 1.1 1.6 3.8 2.6 3.8 4.8 0 1.7-1.3 2.8-3.2 2.8z"/>`,
  moon:
    `<path d="M20 14.6A8.6 8.6 0 1 1 9.4 4a7 7 0 0 0 10.6 10.6z"/>`,
  storm:
    `<path d="M13.5 2.5 5 13.5h6.2L10 21.5l8.5-11.2h-6.2z"/>`,
  void:
    `<path d="M9.6 13.2a2.4 2.4 0 0 1 4.8 0 4.8 4.8 0 0 1-9.6 0 7.2 7.2 0 0 1 14.4 0"/>`,
  "chevron-left":
    `<path d="M15 5.5 8.5 12l6.5 6.5"/>`,
  "chevron-down":
    `<path d="M5.5 9 12 15.5 18.5 9"/>`,
  dash:
    `<path d="M2.5 12H14"/><path d="M5.5 7.5H10"/><path d="M3.5 16.5H9"/><path d="M13.5 6.5 19.5 12l-6 5.5"/>`,
  power:
    `<path d="M12 2.5 13.7 7.9 18.7 5.3 16.1 10.3 21.5 12 16.1 13.7 18.7 18.7 13.7 16.1 12 21.5 10.3 16.1 5.3 18.7 7.9 13.7 2.5 12 7.9 10.3 5.3 5.3 10.3 7.9z"/>`,
  defense:
    `<path d="M12 2.8 19.5 5.7v5.6c0 4.6-3.1 8.2-7.5 10.2-4.4-2-7.5-5.6-7.5-10.2V5.7z"/>`,
  dice:
    `<rect x="3.5" y="3.5" width="17" height="17" rx="3"/>` +
    `<circle cx="8.5" cy="8.5" r="1.6" fill="currentColor" stroke="none"/>` +
    `<circle cx="15.5" cy="8.5" r="1.6" fill="currentColor" stroke="none"/>` +
    `<circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>` +
    `<circle cx="8.5" cy="15.5" r="1.6" fill="currentColor" stroke="none"/>` +
    `<circle cx="15.5" cy="15.5" r="1.6" fill="currentColor" stroke="none"/>`,
  gear:
    `<path d="M9.8 4.9 10.3 2.6 13.7 2.6 14.2 4.9 15.5 5.5 17.4 4.1 19.9 6.6 18.5 8.5 19.1 9.8 21.4 10.3 21.4 13.7 19.1 14.2 18.5 15.5 19.9 17.4 17.4 19.9 15.5 18.5 14.2 19.1 13.7 21.4 10.3 21.4 9.8 19.1 8.5 18.5 6.6 19.9 4.1 17.4 5.5 15.5 4.9 14.2 2.6 13.7 2.6 10.3 4.9 9.8 5.5 8.5 4.1 6.6 6.6 4.1 8.5 5.5z"/>` +
    `<circle cx="12" cy="12" r="3.2"/>`,
  flag:
    `<path d="M5.5 21.5V2.8"/>` +
    `<path d="M5.5 4.2C8 2.8 10.2 2.8 12.6 4.2S17.2 5.6 19.6 4.2V13C17.2 14.4 15 14.4 12.6 13S8 11.6 5.5 13"/>`,
  play:
    `<path d="M7.5 4.5 19 12 7.5 19.5z"/>`,
  restart:
    `<path d="M19.6 13.4A7.8 7.8 0 1 1 17.4 6.4"/>` +
    `<path d="M18.2 2.8 17.6 6.6 13.8 6"/>`,
  home:
    `<path d="M3.5 11.2 12 3.8l8.5 7.4"/>` +
    `<path d="M5.8 9.4V20.2H18.2V9.4"/>` +
    `<path d="M10 20.2V14.4H14V20.2"/>`,
  close:
    `<path d="M6 6 18 18M18 6 6 18"/>`,
  // Two crossed blades, each with a cross-guard (Fighters).
  swords:
    `<path d="M4 4l9.5 9.5M20 4l-9.5 9.5"/><path d="M11.5 16.5 7.5 20.5M12.5 16.5l4 4"/>` +
    `<path d="M6 13.5l4.5 4.5M18 13.5 13.5 18"/>`,
  // A scroll: a sheet with rolled ends (History).
  scroll:
    `<path d="M7 4.5h11a2 2 0 0 1 0 4h-1.5V18a2 2 0 0 1-2 2H5.5a2 2 0 0 1 0-4H7z"/><path d="M7 16V4.5"/>` +
    `<path d="M10 9h4M10 12.5h4"/>`,
  // An eye: almond outline and pupil (Spectate).
  eye:
    `<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>`,
  // A character sheet: a page with a portrait box and two lines (Sheet).
  sheet:
    `<rect x="5" y="3" width="14" height="18" rx="1.5"/><rect x="8" y="6" width="4" height="4"/>` +
    `<path d="M14 7h2M8 13.5h8M8 17h8"/>`,
  // A disk-like seal: a square ribbon with a notch (Save).
  save:
    `<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4"/><rect x="8" y="13" width="8" height="5"/>`,
  "chevron-right":
    `<path d="M9 5.5 15.5 12 9 18.5"/>`,
};

/** Every icon name, in a stable order (birth signs, navigation, skill kinds). */
export const ICON_NAMES: readonly IconName[] = Object.keys(PATHS) as IconName[];

/**
 * The full `<svg>` element string for icon `name`. `extraClass` (optional, space-separated)
 * is appended to the base classes `icon icon-<name>`. The width/height attributes (20) are a
 * fallback only; the stylesheet sizes `.icon` in px/em.
 */
export function icon(name: IconName, extraClass = ""): string {
  const cls = extraClass ? `icon icon-${name} ${extraClass}` : `icon icon-${name}`;
  return `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_GRID} ${ICON_GRID}"` +
    ` width="20" height="20" fill="none" stroke="currentColor" stroke-width="${ICON_STROKE_WIDTH}"` +
    ` stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">` +
    PATHS[name] + `</svg>`;
}

/** Birth-sign id (from `Birthsight.ts`) to its icon name. */
export const BIRTHSIGN_ICON: Readonly<Record<string, IconName>> = {
  serpent: "serpent",
  mountain: "mountain",
  flame: "flame",
  moon: "moon",
  storm: "storm",
  void: "void",
};

/** Skill kind (`Skill.kind`) to its icon name. */
export const SKILL_KIND_ICON: Readonly<Record<string, IconName>> = {
  dash: "dash",
  power: "power",
  defense: "defense",
};

/** The `<svg>` for a birth sign id, or "" for an unknown id (no broken glyph). */
export function birthsignIcon(signId: string | null | undefined, extraClass = ""): string {
  const name = signId ? BIRTHSIGN_ICON[signId] : undefined;
  return name ? icon(name, extraClass) : "";
}

/** The `<svg>` for a skill kind; unknown kinds fall back to the power burst. */
export function skillKindIcon(kind: string, extraClass = ""): string {
  return icon(SKILL_KIND_ICON[kind] ?? "power", extraClass);
}
