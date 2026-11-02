/**
 * EquipIcons — Wave Y (lane U): line icons for every weapon archetype and every equipment slot.
 *
 * Same contract as Icons.ts: a 24 x 24 grid, stroked with `currentColor`, round caps/joins,
 * ICON_STROKE_WIDTH, no `style=` (CSP `style-src 'self'`). Weapons are drawn on the icon's
 * diagonal — the grip bottom-left, the point/head top-right — so a grid of them reads as one family
 * and the silhouettes differ by what the game's archetypes differ by: blade length and width, guard,
 * curve, haft length, head shape.
 *
 * The blade/haft geometry is generated from a few numbers per archetype (a local frame along the
 * diagonal: s along the weapon, t across it), so the family stays consistent and each glyph is
 * defined by WHY it differs (a dagger is short, a greatsword long with a wide guard).
 */

import { ICON_GRID, ICON_STROKE_WIDTH } from "./Icons.ts";

/** The diagonal frame: origin at the guard, u along the weapon (to top-right), n across it. */
const U = [Math.SQRT1_2, -Math.SQRT1_2] as const;
const N = [Math.SQRT1_2, Math.SQRT1_2] as const;
const f = (v: number) => (Math.round(v * 10) / 10).toString();
function pt(o: readonly [number, number], s: number, t: number): string {
  return `${f(o[0] + s * U[0] + t * N[0])} ${f(o[1] + s * U[1] + t * N[1])}`;
}
const poly = (o: readonly [number, number], pts: [number, number][], close = true) =>
  `<path d="M${pts.map(([s, t]) => pt(o, s, t)).join(" L")}${close ? "z" : ""}"/>`;
const line = (o: readonly [number, number], a: [number, number], b: [number, number]) => `<path d="M${pt(o, a[0], a[1])} L${pt(o, b[0], b[1])}"/>`;
const dot = (o: readonly [number, number], s: number, t: number, r: number, fill = false) => {
  const [x, y] = pt(o, s, t).split(" ");
  return `<circle cx="${x}" cy="${y}" r="${r}"${fill ? ` fill="currentColor" stroke="none"` : ""}/>`;
};

interface BladeSpec { at: [number, number]; grip: number; blade: number; w: number; tip: number; guard: number; curve?: number; cup?: boolean }
/** A bladed weapon: grip + pommel, a cross-guard, a blade with a point (optionally curved). */
function blade(b: BladeSpec): string {
  const o = b.at;
  let out = line(o, [-b.grip, 0], [0, 0]) + dot(o, -b.grip - 1, 0, 1.1) + line(o, [0, -b.guard], [0, b.guard]);
  if (b.curve) {
    // A sabre: the back and the edge bow the same way; quadratic curves through a mid control point.
    const L = b.blade, c = b.curve;
    out += `<path d="M${pt(o, 0.6, -b.w)} Q${pt(o, L * 0.55, -b.w - c)} ${pt(o, L, -c * 0.9)} Q${pt(o, L * 0.55, b.w - c * 0.6)} ${pt(o, 0.6, b.w)}z"/>`;
  } else {
    out += poly(o, [[0.6, -b.w], [b.blade - b.tip, -b.w], [b.blade, 0], [b.blade - b.tip, b.w], [0.6, b.w]]);
  }
  if (b.cup) out += `<path d="M${pt(o, 0.2, -2.2)} A2.4 2.4 0 0 0 ${pt(o, 0.2, 2.2)}"/>`;
  return out;
}

/** A hafted/pole weapon: a shaft from s0 to s1 along the diagonal through `at`. */
const shaft = (o: readonly [number, number], s0: number, s1: number) => line(o, [s0, 0], [s1, 0]);

const C: [number, number] = [12, 12];

export const WEAPON_ICON_PATHS: Readonly<Record<string, string>> = {
  dagger: blade({ at: [11, 13], grip: 2.8, blade: 6.8, w: 1.8, tip: 3.4, guard: 1.9 }),
  shortsword: blade({ at: [8.6, 15.4], grip: 3.4, blade: 11, w: 1.3, tip: 2.6, guard: 2.8 }),
  longsword: blade({ at: [7.4, 16.6], grip: 4.2, blade: 13.4, w: 1.15, tip: 2.4, guard: 3.2 }),
  greatsword: blade({ at: [7.6, 16.4], grip: 5, blade: 13.5, w: 1.7, tip: 2.6, guard: 4.3 }),
  sabre: blade({ at: [8.2, 15.8], grip: 3.6, blade: 12.5, w: 1.1, tip: 1, guard: 2.4, curve: 3.4 }),
  rapier: blade({ at: [8.2, 15.8], grip: 3.6, blade: 13, w: 0.55, tip: 2, guard: 2.6, cup: true }),
  spear: shaft(C, -12, 6.5) + poly(C, [[6.5, -1.5], [9.5, -1.7], [13, 0], [9.5, 1.7], [6.5, 1.5]]) + line(C, [6, -1.6], [6, 1.6]),
  halberd: shaft(C, -12, 12.5) +
    poly(C, [[5, -0.6], [5, -4.4], [9.4, -3.6], [9.4, -0.6]]) + poly(C, [[6, 0.6], [8.4, 3.2], [9, 0.6]]) +
    poly(C, [[9.4, -0.8], [12.6, 0], [9.4, 0.8]], false),
  axe: shaft(C, -9.5, 7) + `<path d="M${pt(C, 3, -0.6)} L${pt(C, 2, -5.2)} Q${pt(C, 5.4, -6.4)} ${pt(C, 8.4, -5.2)} L${pt(C, 7, -0.6)}z"/>`,
  greataxe: shaft(C, -12, 9) +
    `<path d="M${pt(C, 4, -0.6)} L${pt(C, 2.8, -5.6)} Q${pt(C, 6.4, -7)} ${pt(C, 10, -5.6)} L${pt(C, 8.8, -0.6)}z"/>` +
    `<path d="M${pt(C, 4.6, 0.6)} L${pt(C, 3.8, 4)} Q${pt(C, 6.4, 5)} ${pt(C, 9, 4)} L${pt(C, 8.2, 0.6)}z"/>`,
  mace: shaft(C, -10, 4) + dot(C, 6.6, 0, 2.6) +
    line(C, [6.6, -2.6], [6.6, -4.6]) + line(C, [6.6, 2.6], [6.6, 4.6]) + line(C, [9.2, 0], [11.2, 0]) +
    line(C, [8.4, -1.9], [9.8, -3.3]) + line(C, [8.4, 1.9], [9.8, 3.3]),
  flail: shaft(C, -11, -2) + dot(C, -1.1, 0, 0.6, true) + dot(C, 0.6, 0.6, 0.6, true) + dot(C, 2.2, 1.4, 0.6, true) +
    dot(C, 5.6, 2.4, 2.5) + line(C, [5.6, -0.1], [5.6, -1.6]) + line(C, [8.1, 2.4], [9.6, 2.4]) + line(C, [5.6, 4.9], [5.6, 6.4]) + line(C, [3.1, 2.4], [1.6, 2.4]),
  warhammer: shaft(C, -10, 8) + poly(C, [[4.2, -0.8], [4.2, -4], [7.2, -4], [7.2, -0.8]]) + poly(C, [[4.4, 0.8], [5.7, 4.6], [7, 0.8]], false) + line(C, [8, 0], [10, 0]),
  maul: shaft(C, -12, 6) + poly(C, [[5, -4.4], [10, -4.4], [10, 4.4], [5, 4.4]]) + line(C, [6.6, -4.4], [6.6, 4.4]) + line(C, [8.4, -4.4], [8.4, 4.4]),
  staff: shaft(C, -12, 10.5) + dot(C, 11.6, 0, 1.6) + line(C, [7, -1.2], [7, 1.2]) + line(C, [-7, -1.2], [-7, 1.2]) + line(C, [8.6, -1.1], [8.6, 1.1]),
  scythe: shaft(C, -12, 10) + `<path d="M${pt(C, 10, 0)} Q${pt(C, 9.4, 7)} ${pt(C, 2.4, 10)} Q${pt(C, 6.2, 5.6)} ${pt(C, 7.6, 0.2)}"/>` + line(C, [-3, -1.4], [-3, 1.4]),
  bow: `<path d="M6 3.5Q20.5 3.5 20.5 18"/>` + `<path d="M6 3.5 20.5 18"/>` + `<path d="M3.5 20.5 15.5 8.5"/>` + `<path d="M15.5 8.5h-3M15.5 8.5v3"/>` + `<path d="M3.5 20.5h2.2M3.5 20.5v-2.2"/>`,
};

/** Slot glyphs (the empty socket's watermark and the placeholder pieces). */
export const SLOT_ICON_PATHS: Readonly<Record<string, string>> = {
  helmet: `<path d="M4.5 16.5C4.5 9.4 7.8 4.5 12 4.5S19.5 9.4 19.5 16.5v3h-4.3v-4.3c0-1.2-1-2.2-2.2-2.2h-2c-1.2 0-2.2 1-2.2 2.2v4.3H4.5z"/><path d="M12 4.5V18.5"/><path d="M6.2 10.2h11.6"/>`,
  armor: `<path d="M7.2 3.8 4.4 6.4 6 12v7.4c4 1.9 8 1.9 12 0V12l1.6-5.6-2.8-2.6c-1.4 1.7-3 2.6-4.8 2.6S8.6 5.5 7.2 3.8z"/><path d="M8.4 11.2c2.4 1.5 4.8 1.5 7.2 0"/><path d="M12 12.6v6.8"/>`,
  gloves: `<path d="M7.5 21v-4.5L5 12.5V7.5a1.3 1.3 0 0 1 2.6 0V11V5.2a1.3 1.3 0 0 1 2.6 0V11V4.5a1.3 1.3 0 0 1 2.6 0V11V5.5a1.3 1.3 0 0 1 2.6 0v8l2-2.4a1.4 1.4 0 0 1 2 1.9L15.6 17v4z"/>`,
  belt: `<path d="M2.5 10h19v4h-19z"/><rect x="9" y="8.3" width="6" height="7.4" rx="1"/><path d="M12 12h3"/>`,
  legs: `<path d="M7 3.5h10l.5 17h-4l-1.5-11-1.5 11h-4z"/>`,
  offhand: `<path d="M12 2.8 19.5 5.7v5.6c0 4.6-3.1 8.2-7.5 10.2-4.4-2-7.5-5.6-7.5-10.2V5.7z"/><path d="M12 5.5v13M7 10.5h10"/>`,
  cape: `<path d="M8 3.5h8l1 3 2.5 14H4.5L7 6.5z"/><path d="M9.5 3.5 12 7l2.5-3.5"/><path d="M10 11 9 20.5M14 11l1 9.5"/>`,
  boots: `<path d="M7 3.5h6v10.5l5.5 2.5c1.3.6 2 1.6 2 3V20.5H7z"/><path d="M7 17h13.5"/>`,
};

/** Every weapon icon key (the archetype ids). */
export const WEAPON_ICON_NAMES: readonly string[] = Object.keys(WEAPON_ICON_PATHS);

function svg(inner: string, cls: string): string {
  return `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_GRID} ${ICON_GRID}"` +
    ` width="24" height="24" fill="none" stroke="currentColor" stroke-width="${ICON_STROKE_WIDTH}"` +
    ` stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
}

/** The `<svg>` of a weapon archetype (an unknown id — e.g. "random" — draws a die-marked blade-less socket). */
export function weaponIcon(id: string, extraClass = ""): string {
  const inner = WEAPON_ICON_PATHS[id] ??
    `<rect x="5" y="5" width="14" height="14" rx="3"/><path d="M10 9.6a2.2 2.2 0 1 1 3 2c-.7.3-1 .8-1 1.6"/><circle cx="12" cy="16.2" r=".9" fill="currentColor" stroke="none"/>`;
  return svg(inner, `icon icon-weapon icon-weapon-${id}${extraClass ? " " + extraClass : ""}`);
}

/** The `<svg>` of an equipment slot / a placeholder piece of that slot. */
export function slotIcon(slot: string, extraClass = ""): string {
  return svg(SLOT_ICON_PATHS[slot] ?? SLOT_ICON_PATHS.armor, `icon icon-slot icon-slot-${slot}${extraClass ? " " + extraClass : ""}`);
}

/** The icon of a catalogue item (`EquipItem.icon` names an archetype or a slot). */
export function equipItemIcon(iconKey: string, extraClass = ""): string {
  return WEAPON_ICON_PATHS[iconKey] ? weaponIcon(iconKey, extraClass) : slotIcon(iconKey, extraClass);
}
