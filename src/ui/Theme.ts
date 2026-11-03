// Wave THEME (lane T, contract C-THEME): identity-driven styling — PURE data + functions (no DOM).
//
// Every identity variable a character exposes gets a material, a palette and a texture pattern:
//   race      -> the MATERIAL of the name plaque (ork clay, elf white scroll, human grained wood, dwarf stone),
//   sub-race  -> its own PALETTE (Swatch) on that material,
//   class     -> palette + pattern (class chip, class accent),
//   birth sign-> palette + emblem pattern (sign chip),
//   weapon    -> palette + pattern (weapon chip and the + New weapon socket),
// and a RELATION between the axes (class x weapon, class x sign, race x class, race x weapon):
//   synchronous   = the typical pair (the class's own weapon, the race's own calling, the sign that best
//                   matches the class's attributes) -> the chip shares the class's accent (harmonised);
//   complementary = works well (same weapon family/class as the typical one, positive attribute fit)
//                   -> the complementary accent (the class accent's hue turned 180 degrees);
//   opposite      = atypical -> a contrasting accent (warning red), dashed ring.
// The CSS that renders it lives in styles.css (`--th-*` custom properties) and ThemeTextures.ts (the
// generated gradient/SVG stacks); the tokens are written through CSSOM (CSP `style-src 'self'`).
import { RACES, raceById, type StatName } from "../game/Races.ts";
import { BIRTHSIGNS, birthsignById } from "../game/Birthsight.ts";
import { CLASSES, createStats, type ClassName } from "../game/Stats.ts";
import { ARCHETYPES, ARCHETYPE_IDS, CLASS_ARCHETYPE, isArchetypeId } from "../game/weapons/Archetypes.ts";
import type { ArchetypeId } from "../combat/contracts.ts";

// ── Types ───────────────────────────────────────────────────────────────────────────────────────
export type Material = "clay" | "scroll" | "wood" | "stone" | "neutral";
export interface Swatch { base: string; light: string; dark: string; ink: string; accent: string }
export type PatternId =
  // class
  | "fur" | "plates" | "stitch" | "crossstitch" | "sigils" | "bones" | "fletching" | "halo"
  // sign
  | "scales" | "peaks" | "flames" | "crescents" | "bolts" | "rings"
  // weapon family
  | "fuller" | "shaft" | "hammered" | "chain" | "grain" | "string"
  | "none";
export type Relation = "synchronous" | "complementary" | "opposite";
export type RelationKind = "class-weapon" | "class-sign" | "race-class" | "race-weapon";
export interface ChipTheme { id: string; label: string; swatch: Swatch; pattern: PatternId }
/** CSS custom properties for the card/plate root (`--th-*` -> value). */
export type ThemeTokens = Record<`--th-${string}`, string>;

// ── Colour maths (sRGB hex, WCAG luminance, CIE76 Lab distance) ─────────────────────────────────
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
const lin = (x: number) => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** `top` at opacity `alpha` composited over `under` (what a translucent pattern stroke paints). */
export function blend(under: string, top: string, alpha: number): string {
  const [r1, g1, b1] = hexToRgb(under), [r2, g2, b2] = hexToRgb(top);
  return rgbToHex(r1 + (r2 - r1) * alpha, g1 + (g2 - g1) * alpha, b1 + (b2 - b1) * alpha);
}
/** `#rrggbb` + alpha -> `rgba(r,g,b,a)` for gradient stops. */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${+alpha.toFixed(3)})`;
}
function toLab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map(lin);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, y = 0.2126 * r + 0.7152 * g + 0.0722 * b, z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
/** CIE76 delta E between two colours (2.3 ~ just noticeable; > 20 clearly different hues/values). */
export function colourDistance(a: string, b: string): number {
  const [l1, a1, b1] = toLab(a), [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}
/** Rotate a colour's hue by `deg` (HSL), keeping saturation and lightness. */
export function rotateHue(hex: string, deg: number): string {
  const [r, g, b] = hexToRgb(hex).map((x) => x / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d === 0) return hex.toLowerCase();
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = ((h * 60 + deg) % 360 + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [rr, gg, bb] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex((rr + m) * 255, (gg + m) * 255, (bb + m) * 255);
}

/** Own-property lookup (ids come from saved profiles: "__proto__" must not reach Object.prototype). */
function own<T>(table: Record<string, T>, key: string | null | undefined): T | undefined {
  return key != null && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

// ── Race -> material ────────────────────────────────────────────────────────────────────────────
const RACE_MATERIAL: Record<string, { material: Material; label: string }> = {
  ork: { material: "clay", label: "Fired clay" },
  elf: { material: "scroll", label: "White scroll" },
  human: { material: "wood", label: "Grained wood" },
  dwarf: { material: "stone", label: "Stone and dark metal-rock" },
};
export const NEUTRAL_RACE = { material: "neutral" as Material, label: "Plain" };
export function raceTheme(race: string | null | undefined): { material: Material; label: string } {
  return own(RACE_MATERIAL, race) ?? NEUTRAL_RACE;
}

// ── Sub-race -> swatch (on the race's material) ─────────────────────────────────────────────────
// Orks: DARK fired clay; the purple one is IRONHIDE — "war-forged in the Slag Pits": slag cools into
// violet-black glass and forged steel tempers through purple, so the slag-pit clan wears a temper-purple
// clay with a rust accent (the iron it still is). Greenhide keeps the marsh green, Bloodfang the dried red.
// Elves: parchment tints with an ink of their own. Humans: lighter woods. Dwarves: dark rock / metal.
export const SUBRACE_SWATCH: Record<string, Record<string, Swatch & { name: string; why: string }>> = {
  ork: {
    greenhide: { name: "Marsh green clay", why: "Blood-Marsh mud: dark green earthenware", base: "#2c4424", light: "#4b6a37", dark: "#16230f", ink: "#f2e9c8", accent: "#9fd06a" },
    ironhide: { name: "Slag purple clay", why: "PURPLE: slag glass + temper-purple of forged iron; rust accent", base: "#3d2650", light: "#5e3f76", dark: "#1e1029", ink: "#f4e8f6", accent: "#d07a3e" },
    bloodfang: { name: "Dried-blood clay", why: "Red Steppe: dark red fired clay", base: "#5a1d18", light: "#81342a", dark: "#2c0c09", ink: "#fae4cf", accent: "#ec6a4c" },
  },
  elf: {
    high: { name: "Ivory-gold scroll", why: "Star-scholars: ivory vellum, gilt ink", base: "#f5e0b0", light: "#fcf5e2", dark: "#c6ad74", ink: "#3b2a0e", accent: "#a87a18" },
    wood: { name: "Leaf-ink scroll", why: "Elderwood: green-tinted paper, leaf-green ink", base: "#d4e8c0", light: "#eef7e6", dark: "#a4b57c", ink: "#1d3818", accent: "#3f7a2a" },
    dark: { name: "Ink-violet scroll", why: "Obsidian Halls: lavender-grey vellum, violet ink", base: "#e0d4ea", light: "#f4eef7", dark: "#a493ae", ink: "#2c173d", accent: "#6b3a91" },
  },
  human: {
    imperial: { name: "Walnut-gold wood", why: "Golden Citadel: polished walnut with gilt", base: "#c0925a", light: "#d9b07a", dark: "#7d5530", ink: "#1e1105", accent: "#7a4f0c" },
    nomad: { name: "Sun-bleached ash", why: "Sunken Plains: pale weathered ash, open-sky accent", base: "#dccfb2", light: "#efe6d2", dark: "#a8957a", ink: "#2a1f12", accent: "#3f6f8f" },
    islander: { name: "Driftwood teal", why: "Sapphire Archipelago: salt-grey driftwood, teal stain", base: "#b2c1b6", light: "#d3ddd4", dark: "#6c8983", ink: "#10241f", accent: "#1f6b66" },
  },
  dwarf: {
    mountain: { name: "Granite", why: "Iron Reach: grey granite, iron-brown veins", base: "#524c47", light: "#766e66", dark: "#2a2724", ink: "#f2eee4", accent: "#9c7a55" },
    forge: { name: "Ember-black", why: "Khaz-Barad forges: black iron with ember veins", base: "#2a1e1a", light: "#4b2f22", dark: "#110b09", ink: "#ffe8cc", accent: "#ff7a2e" },
    deep: { name: "Slate-blue", why: "The Rootways: blue slate, cold iron", base: "#263a55", light: "#41597a", dark: "#171f2b", ink: "#e8f0fa", accent: "#86acd9" },
  },
};
export const NEUTRAL_SWATCH: Swatch = { base: "#2a241d", light: "#4a4035", dark: "#140f0a", ink: "#f3e8cf", accent: "#d9b25e" };
/** The race's own swatch when the sub-race is missing/unknown (its first nation), neutral for an unknown race. */
export function subraceSwatch(race: string | null | undefined, subrace: string | null | undefined): Swatch {
  const table = own(SUBRACE_SWATCH, race);
  if (!table) return { ...NEUTRAL_SWATCH };
  const s = own(table, subrace) ?? table[Object.keys(table)[0]];
  return { base: s.base, light: s.light, dark: s.dark, ink: s.ink, accent: s.accent };
}

// ── Class -> palette + pattern ──────────────────────────────────────────────────────────────────
export const CLASS_THEME: Record<ClassName, { swatch: Swatch; pattern: PatternId; why: string }> = {
  Barbarian: { pattern: "fur", why: "fur and claw scratches", swatch: { base: "#4a2a18", light: "#6e4429", dark: "#24130a", ink: "#f7e6cc", accent: "#e0703a" } },
  Warrior: { pattern: "plates", why: "riveted steel plates", swatch: { base: "#38404d", light: "#5a6474", dark: "#1b2028", ink: "#eef2f7", accent: "#d4ac52" } },
  Rogue: { pattern: "stitch", why: "dark leather, running stitch", swatch: { base: "#33271a", light: "#54412c", dark: "#18110a", ink: "#f1e4c8", accent: "#9cc068" } },
  Assassin: { pattern: "crossstitch", why: "black leather, cross stitch", swatch: { base: "#1f1c24", light: "#3a3442", dark: "#0c0a0f", ink: "#ece6f2", accent: "#d0404a" } },
  Mage: { pattern: "sigils", why: "arcane sigils", swatch: { base: "#2d1f52", light: "#4a3780", dark: "#150d2a", ink: "#f0e8ff", accent: "#b48cf0" } },
  Necromancer: { pattern: "bones", why: "bone and runes", swatch: { base: "#1e2a2c", light: "#36484b", dark: "#0c1213", ink: "#ece8d6", accent: "#62a8b4" } },
  Archer: { pattern: "fletching", why: "leaves and fletching", swatch: { base: "#22381f", light: "#3a5a34", dark: "#0f1b0d", ink: "#eef6e0", accent: "#a9d47a" } },
  Priest: { pattern: "halo", why: "gilt halo on white", swatch: { base: "#f2e9d0", light: "#fffaeb", dark: "#c9b57a", ink: "#33260a", accent: "#a67c12" } },
};
export const NEUTRAL_CHIP: ChipTheme = { id: "", label: "Unknown", swatch: { ...NEUTRAL_SWATCH }, pattern: "none" };
const isClass = (c: string | null | undefined): c is ClassName => !!c && (CLASSES as readonly string[]).includes(c);
export function classTheme(className: string | null | undefined): { swatch: Swatch; pattern: PatternId } {
  if (!isClass(className)) return { swatch: { ...NEUTRAL_SWATCH }, pattern: "none" };
  const t = CLASS_THEME[className];
  return { swatch: { ...t.swatch }, pattern: t.pattern };
}

// ── Birth sign -> palette + emblem pattern ──────────────────────────────────────────────────────
export const SIGN_THEME: Record<string, { swatch: Swatch; pattern: PatternId; why: string }> = {
  serpent: { pattern: "scales", why: "serpent scales", swatch: { base: "#18392d", light: "#2e5c4a", dark: "#0a1c15", ink: "#e6f6ec", accent: "#62cc92" } },
  mountain: { pattern: "peaks", why: "mountain chevrons", swatch: { base: "#3b3631", light: "#5c544c", dark: "#1d1a17", ink: "#f2ede4", accent: "#bfae92" } },
  flame: { pattern: "flames", why: "flame tongues", swatch: { base: "#4c180a", light: "#7a2c12", dark: "#260a03", ink: "#ffeedd", accent: "#ff9442" } },
  moon: { pattern: "crescents", why: "crescents and stars", swatch: { base: "#1b2142", light: "#30396a", dark: "#0b0f22", ink: "#e9edff", accent: "#cdd6ff" } },
  storm: { pattern: "bolts", why: "lightning bolts", swatch: { base: "#252b3d", light: "#3e4862", dark: "#11141d", ink: "#f2f5ff", accent: "#f2d64a" } },
  void: { pattern: "rings", why: "rings into the dark", swatch: { base: "#130f1e", light: "#2a2240", dark: "#05030a", ink: "#e9e0ff", accent: "#8a68e0" } },
};
export function signTheme(signId: string | null | undefined): { swatch: Swatch; pattern: PatternId } {
  const t = own(SIGN_THEME, signId);
  return t ? { swatch: { ...t.swatch }, pattern: t.pattern } : { swatch: { ...NEUTRAL_SWATCH }, pattern: "none" };
}

// ── Weapon -> palette + pattern ─────────────────────────────────────────────────────────────────
/** Pattern by family: blades show a fuller, polearms banded shafts, hafted heads hammered dimples, flails chain,
 *  staves the grain of their wood, bows the string's arcs. Palettes per archetype (steel, iron, bronze, wood...). */
export const FAMILY_PATTERN: Record<string, PatternId> = { blade: "fuller", polearm: "shaft", hafted: "hammered", flail: "chain", staff: "grain", bow: "string" };
export const WEAPON_SWATCH: Record<ArchetypeId, Swatch> = {
  dagger: { base: "#2b3138", light: "#4c5661", dark: "#14181c", ink: "#eef3f8", accent: "#9fb4c8" },
  shortsword: { base: "#33363b", light: "#555a62", dark: "#181a1d", ink: "#f0f2f4", accent: "#c0c8d0" },
  longsword: { base: "#2f3a48", light: "#4f6074", dark: "#161c24", ink: "#edf3fa", accent: "#d6b862" },
  greatsword: { base: "#3a3a44", light: "#5d5d6c", dark: "#1b1b21", ink: "#f1f1f6", accent: "#b9b9d6" },
  sabre: { base: "#2c3a3a", light: "#4a6060", dark: "#141c1c", ink: "#ebf6f5", accent: "#8fd0c8" },
  rapier: { base: "#3a2f3f", light: "#5d4c66", dark: "#1c161f", ink: "#f5eef8", accent: "#d4a8e4" },
  spear: { base: "#3a3122", light: "#5d4f37", dark: "#1c170f", ink: "#f6eedc", accent: "#c9b07a" },
  halberd: { base: "#2e3428", light: "#4b5541", dark: "#151912", ink: "#eff4e8", accent: "#b2c48a" },
  axe: { base: "#40261c", light: "#663e2e", dark: "#20120c", ink: "#f8e8dc", accent: "#e08a5a" },
  greataxe: { base: "#4a2016", light: "#733424", dark: "#250e09", ink: "#fbe6d8", accent: "#ef7455" },
  mace: { base: "#3c3420", light: "#5f5334", dark: "#1d180d", ink: "#f8f0d8", accent: "#e2c46a" },
  flail: { base: "#2f2d2a", light: "#4d4a45", dark: "#161512", ink: "#f2f0ea", accent: "#bdb6a4" },
  warhammer: { base: "#383232", light: "#5a5050", dark: "#1a1616", ink: "#f4eeee", accent: "#c49a8a" },
  maul: { base: "#3a2c26", light: "#5c463d", dark: "#1c1411", ink: "#f6ebe4", accent: "#c8a08e" },
  staff: { base: "#3a2a1a", light: "#5e452c", dark: "#1c130b", ink: "#f5e9d2", accent: "#b48cf0" },
  scythe: { base: "#1f2a2c", light: "#384a4e", dark: "#0d1314", ink: "#e8f0ee", accent: "#7fb8c0" },
  bow: { base: "#2a3a1e", light: "#465e33", dark: "#121b0c", ink: "#eff6e2", accent: "#a9ce7c" },
};
/** Legacy WeaponType ("sword", "axe"...) -> the archetype the game resolves it to (Loadout LEGACY_TO_ARCHETYPE). */
const LEGACY: Record<string, ArchetypeId> = { sword: "longsword", axe: "greataxe", dagger: "dagger", staff: "staff", scythe: "scythe", bow: "bow", mace: "mace" };
export function weaponId(weapon: string | null | undefined): ArchetypeId | null {
  if (isArchetypeId(weapon)) return weapon;
  return own(LEGACY, weapon) ?? null;
}
export function weaponTheme(weaponType: string | null | undefined): { swatch: Swatch; pattern: PatternId } {
  const id = weaponId(weaponType);
  if (!id) return { swatch: { ...NEUTRAL_SWATCH }, pattern: "none" };
  return { swatch: { ...WEAPON_SWATCH[id] }, pattern: own(FAMILY_PATTERN, ARCHETYPES[id].family) ?? "none" };
}

// ── Relations (data-driven: Archetypes.CLASS_ARCHETYPE, Stats primaries, Birthsight mods, Races) ──
const STATS: StatName[] = ["vitality", "resilience", "focus", "reflex", "strength", "intelligence", "agility"];
/** A class's attribute profile, centred on the mean of all classes (what DISTINGUISHES it). */
export function classProfile(c: ClassName): number[] {
  const v = (k: ClassName) => { const s = createStats(k) as unknown as Record<string, number>; return STATS.map((n) => s[n]); };
  const all = CLASSES.map(v), mine = v(c);
  return mine.map((x, i) => x - all.reduce((a, r) => a + r[i], 0) / all.length);
}
const modsVec = (m: Partial<Record<StatName, number>>) => STATS.map((n) => m[n] ?? 0);
function cosine(a: number[], b: number[]): number {
  const d = a.reduce((s, x, i) => s + x * b[i], 0), na = Math.hypot(...a), nb = Math.hypot(...b);
  return na && nb ? d / (na * nb) : 0;
}
/** How well a sign's modifiers fit a class's distinguishing attributes (cosine, -1..1). */
export function signFit(className: ClassName, signId: string): number {
  const s = birthsignById(signId);
  return s ? cosine(classProfile(className), modsVec(s.mods)) : 0;
}
/** How well a race's modifiers fit a class's distinguishing attributes (cosine, -1..1). */
export function raceFit(raceId: string, className: ClassName): number {
  const r = raceById(raceId);
  return r ? cosine(classProfile(className), modsVec(r.mods)) : 0;
}
/** The complementary-fit threshold for attribute cosines (a positive, clearly-shared direction). */
export const FIT_COMPLEMENTARY = 0.2;
/** Weapons that work well with a class beyond its own family/class (hand-picked from the class's fighting style). */
export const CLASS_WEAPON_COMPLEMENT: Record<ClassName, ArchetypeId[]> = {
  Barbarian: ["axe", "maul", "warhammer", "greatsword", "halberd", "flail"],
  Warrior: ["shortsword", "greatsword", "sabre", "spear", "halberd", "mace", "axe"],
  Rogue: ["shortsword", "sabre", "rapier", "bow"],
  Assassin: ["shortsword", "rapier", "sabre", "bow"],
  Mage: ["dagger", "scythe"],
  Necromancer: ["staff", "dagger", "flail"],
  Archer: ["dagger", "shortsword", "spear"],
  Priest: ["warhammer", "flail", "staff", "maul"],
};

/** The class's own weapon (Archetypes.CLASS_ARCHETYPE: Archer -> bow); "" for an unknown class. */
export function typicalWeapon(className: string | null | undefined): string {
  return isClass(className) ? CLASS_ARCHETYPE[className] : "";
}
function classWeapon(c: ClassName, w: ArchetypeId): Relation {
  const typical = CLASS_ARCHETYPE[c];
  if (w === typical) return "synchronous";
  if (CLASS_WEAPON_COMPLEMENT[c].includes(w)) return "complementary";
  const a = ARCHETYPES[w], t = ARCHETYPES[typical];
  if (a.family === t.family && a.weaponClass === t.weaponClass) return "complementary";
  return "opposite";
}
function classSign(c: ClassName, signId: string): Relation {
  const fits = BIRTHSIGNS.map((s) => [s.id, signFit(c, s.id)] as const).sort((a, b) => b[1] - a[1]);
  if (fits[0][0] === signId) return "synchronous";
  return signFit(c, signId) >= FIT_COMPLEMENTARY ? "complementary" : "opposite";
}
function raceClass(raceId: string, c: ClassName): Relation {
  const r = raceById(raceId)!;
  if (r.defaultClass === c) return "synchronous";
  // Humans are "adaptable" (+1 to everything): a flat modifier vector fits every calling.
  const m = modsVec(r.mods), mean = m.reduce((a, x) => a + x, 0) / m.length;
  if (m.every((x) => Math.abs(x - mean) < 1e-9)) return "complementary";
  return raceFit(raceId, c) >= FIT_COMPLEMENTARY ? "complementary" : "opposite";
}
function raceWeapon(raceId: string, w: ArchetypeId): Relation {
  const r = raceById(raceId)!;
  return classWeapon(r.defaultClass, w);
}

/**
 * The relation between two identity values. Total: an unknown id on either side reads "complementary"
 * (neutral — neither the harmonised nor the warning accent).
 */
export function relation(kind: RelationKind, a: string | null | undefined, b: string | null | undefined): Relation {
  switch (kind) {
    case "class-weapon": { const w = weaponId(b); return isClass(a) && w ? classWeapon(a, w) : "complementary"; }
    case "class-sign": return isClass(a) && birthsignById(b ?? "") ? classSign(a, b!) : "complementary";
    case "race-class": return raceById(a ?? "") && isClass(b) ? raceClass(a!, b) : "complementary";
    case "race-weapon": { const w = weaponId(b); return raceById(a ?? "") && w ? raceWeapon(a!, w) : "complementary"; }
  }
  return "complementary";
}

/** The accent a relation paints: shared (the anchor's own accent), complementary (its hue + 180), opposite (warning). */
export const OPPOSITE_ACCENT = "#ff4a5e";
export function relationAccent(rel: Relation, anchorAccent: string): string {
  if (rel === "synchronous") return anchorAccent;
  if (rel === "complementary") return rotateHue(anchorAccent, 180);
  return OPPOSITE_ACCENT;
}
export const RELATION_STYLE: Record<Relation, { border: string; mark: string; word: string }> = {
  synchronous: { border: "solid", mark: "=", word: "typical pair (shared accent)" },
  complementary: { border: "double", mark: "+", word: "works well (complementary accent)" },
  opposite: { border: "dashed", mark: "x", word: "atypical (contrasting accent)" },
};

// ── themeFor(profile) -> the CSS custom properties on the card/plate root ───────────────────────
export interface ThemeProfile { race: string | null | undefined; subrace?: string | null; className?: string | null; birthsign?: string | null; weapon?: string | null }
export interface ThemeSummary {
  material: Material; plaque: Swatch; cls: ChipTheme; sign: ChipTheme; weapon: ChipTheme;
  relations: { "race-class": Relation; "class-sign": Relation; "class-weapon": Relation; "race-weapon": Relation };
}
export function themeSummary(p: ThemeProfile): ThemeSummary {
  const c = classTheme(p.className), s = signTheme(p.birthsign), w = weaponTheme(p.weapon);
  return {
    material: raceTheme(p.race).material, plaque: subraceSwatch(p.race, p.subrace),
    cls: { id: p.className ?? "", label: p.className ?? "", ...c },
    sign: { id: p.birthsign ?? "", label: p.birthsign ?? "", ...s },
    weapon: { id: weaponId(p.weapon) ?? "", label: p.weapon ?? "", ...w },
    relations: {
      "race-class": relation("race-class", p.race, p.className),
      "class-sign": relation("class-sign", p.className, p.birthsign),
      "class-weapon": relation("class-weapon", p.className, p.weapon),
      "race-weapon": relation("race-weapon", p.race, p.weapon),
    },
  };
}
function swatchTokens(prefix: string, s: Swatch, out: Record<string, string>): void {
  for (const k of ["base", "light", "dark", "ink", "accent"] as const) out[`--th-${prefix}-${k}`] = s[k];
}
/**
 * The theme tokens of one character: `--th-plaque-*` (race material + sub-race swatch), `--th-chip-race-*`,
 * `--th-chip-subrace-*`, `--th-chip-class-*`, `--th-chip-sign-*`, `--th-chip-weapon-*` (swatches) and
 * `--th-relation-{class,sign,weapon}-{color,style}` (class chip vs race, sign chip vs class, weapon chip vs class).
 * The background STACKS (patterns) are added by ThemeTextures.themeBackgrounds.
 */
export function themeFor(p: ThemeProfile): ThemeTokens {
  const t = themeSummary(p), out: Record<string, string> = {};
  swatchTokens("plaque", t.plaque, out);
  swatchTokens("chip-race", t.plaque, out);
  swatchTokens("chip-subrace", t.plaque, out);
  swatchTokens("chip-class", t.cls.swatch, out);
  swatchTokens("chip-sign", t.sign.swatch, out);
  swatchTokens("chip-weapon", t.weapon.swatch, out);
  const rel = (name: string, r: Relation, anchor: string) => {
    out[`--th-relation-${name}-color`] = relationAccent(r, anchor);
    out[`--th-relation-${name}-style`] = RELATION_STYLE[r].border;
  };
  // The class chip relates to the race (anchor: the plaque's accent); sign and weapon to the class.
  rel("class", t.relations["race-class"], t.plaque.accent);
  rel("sign", t.relations["class-sign"], t.cls.swatch.accent);
  rel("weapon", t.relations["class-weapon"], t.cls.swatch.accent);
  return out as ThemeTokens;
}

/** Every theme the page can show (for tests, the probe and the THEME.md tables). */
export function allSwatches(): { group: string; id: string; swatch: Swatch }[] {
  const out: { group: string; id: string; swatch: Swatch }[] = [];
  for (const r of RACES) for (const s of r.subspecies) out.push({ group: `subrace:${r.id}`, id: s.id, swatch: subraceSwatch(r.id, s.id) });
  for (const c of CLASSES) out.push({ group: "class", id: c, swatch: classTheme(c).swatch });
  for (const s of BIRTHSIGNS) out.push({ group: "sign", id: s.id, swatch: signTheme(s.id).swatch });
  for (const w of ARCHETYPE_IDS) out.push({ group: "weapon", id: w, swatch: weaponTheme(w).swatch });
  out.push({ group: "neutral", id: "neutral", swatch: { ...NEUTRAL_SWATCH } });
  return out;
}
