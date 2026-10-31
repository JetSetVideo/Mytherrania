/**
 * RaceBanners — heraldic standards (étendards) for every race and every sub-species, as
 * inline SVG strings (pure: no DOM, no THREE, no Math.random).
 *
 * A standard is a hanging field, 4:5, drawn on a 96 x 120 user-unit grid. Every race flies
 * one; every sub-species flies the race's field differenced by a cadency mark (a bordure /
 * chief / pile / bend …) cut from a hash of the sub-species id, because in heraldry two
 * nations of one people may not fly the same flag. The palette is read from the ancestry the
 * rig uses ({@link ANCESTRY}): the field is the node's own skin base, the charge its crease
 * colour, and the trim the race's lore colour (elf bluish, human sand/warm, dwarf stone, ork
 * green→violet).
 *
 * CSP note: the page runs under `style-src 'self'`, which blocks `style="…"`. Every colour and
 * shape here is an SVG presentation attribute (`fill`, `stroke`, `stroke-width`), never a
 * style; the string never contains `style=`, `<script>`, or an external `href`.
 */
import { ANCESTRY, ancestryOf, type AncestryNode } from "../game/Ancestry.ts";

/** Width of the standard in user units (its x axis). */
export const BANNER_WIDTH = 96;
/** Height of the standard in user units (4:5 with the width — a hanging standard). */
export const BANNER_HEIGHT = 120;

/** The eight charges an ancestry may bear; each is drawn on the field at the charge centre. */
export type BannerCharge = "laurel" | "sun" | "hammer" | "crown" | "tusk" | "anvil" | "star" | "skull";

/** Field / charge / trim colours of a standard, as `#rrggbb`. */
export interface BannerPalette { field: string; charge: string; trim: string; }

/**
 * Each race's two charges, primary first — the pair heraldry gives the people: the elf's leaf
 * or star, the human's crown or sun, the dwarf's hammer or anvil, the ork's tusk or skull.
 * Index [0] is what a race node flies; a sub-species may differencing to the alternate.
 */
const RACE_CHARGES: Readonly<Record<string, readonly [BannerCharge, BannerCharge]>> = {
  elf: ["laurel", "star"],
  human: ["crown", "sun"],
  dwarf: ["hammer", "anvil"],
  ork: ["tusk", "skull"],
};

/**
 * The trim colour of each race's field — its lore colour, not its skin: the elf crease darkens
 * blue (ancestry.json elf.skin.crease #2f3d63), humans are sand and hide-brown, dwarves run to
 * stone, and the ork hide runs green to violet so the trim takes the violet end.
 */
const RACE_TRIM: Readonly<Record<string, string>> = {
  human: "#b5762e",
  elf: "#5b7c99",
  dwarf: "#6f7378",
  ork: "#7c6a9e",
};

/**
 * FNV-1a, the 32-bit variant (offset basis 0x811c9dc5, prime 0x01000193). Chosen because it
 * needs no table and — unlike a rolling sum — spreads near-identical ids ("forge", "forged")
 * across the whole output, so two sub-species of one race almost never land on the same mark.
 * It is a promise: the same id must cut the same cadency on every machine, forever.
 */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The eight cadency marks a sub-species may add, drawn in the trim colour. */
const CADENCY: readonly string[] = ["bordure", "chief", "pile", "bend", "chevron", "canton", "fess", "saltire"];

/** The cadency mark for a sub-species id, from bits 4..6 of its hash (8 choices). */
function cadencyOf(subraceId: string): string {
  return CADENCY[(hashId(subraceId) >>> 4) % CADENCY.length];
}

/** A sub-species' differencing tint factor on the trim, 0.72..1.20, from bits 8..10 of its hash. */
function differencingTint(subraceId: string): number {
  return 0.72 + ((hashId(subraceId) >>> 8) % 7) * 0.08;
}

/** Multiply an `#rrggbb` by a factor, clamped to 0..255, to tint a trim deterministically. */
function tintHex(hex: string, factor: number): string {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)));
  const r = ch(parseInt(hex.slice(1, 3), 16));
  const g = ch(parseInt(hex.slice(3, 5), 16));
  const b = ch(parseInt(hex.slice(5, 7), 16));
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** The root race of any known ancestry id (a sub-species id climbs to its parent race). */
function raceOf(raceId: string): string {
  return ancestryOf(raceId, null).race;
}

/** The charge a race bears, from its ancestry (elf = leaf/star, human = crown/sun, dwarf = hammer/anvil, ork = tusk/skull). */
export function bannerCharge(raceId: string): BannerCharge {
  return (RACE_CHARGES[raceOf(raceId)] ?? RACE_CHARGES.human)[0];
}

/** Field / charge / trim colours for the race, and a sub-species differencing tint. */
export function bannerPalette(raceId: string, subraceId: string | null = null): BannerPalette {
  const node = ancestryOf(raceId, subraceId);
  const race = node.race;
  const baseTrim = RACE_TRIM[race] ?? RACE_TRIM.human;
  return {
    field: node.skin.base,
    charge: node.skin.crease,
    trim: subraceId ? tintHex(baseTrim, differencingTint(subraceId)) : baseTrim,
  };
}

/**
 * The charge a banner flies. A race node flies its primary; a sub-species takes the alternate
 * charge when bit 0 of its hash is set, so the four pairs (8 charges) are all reachable and two
 * sub-species of one race can differ by charge as well as by cadency.
 */
function chargeFor(race: string, subraceId: string | null): BannerCharge {
  const pair = RACE_CHARGES[race] ?? RACE_CHARGES.human;
  return subraceId && (hashId(subraceId) & 1) ? pair[1] : pair[0];
}

/**
 * The inner geometry of each charge, on the 96 x 120 grid, centred so its coordinate envelope
 * spans the charge box x 16..80, y 24..96 (a bounding box ~64 x 72 units — well over 40 % of the
 * 88 x 112 field, so the charge still reads at the 32 px chip). Filled shapes inherit the
 * charge colour from the group; line-only shapes (veins, rays, tusks) set `fill="none"`. All
 * path commands are ABSOLUTE and only M/L/C/Q/Z, so every number is an (x, y) pair and the
 * envelope can be measured straight off the markup.
 */
const CHARGE_PATHS: Readonly<Record<BannerCharge, string>> = {
  laurel:
    `<path d="M48 24 C74 34 80 48 80 60 C80 72 74 86 48 96 C22 86 16 72 16 60 C16 48 22 34 48 24 Z"/>` +
    `<path fill="none" d="M48 28 L48 92"/>`,
  sun:
    `<circle cx="48" cy="60" r="30"/>` +
    `<path fill="none" d="M78 60 L86 60 M69.21 81.21 L74.87 86.87 M48 90 L48 98 M26.79 81.21 L21.13 86.87 ` +
    `M18 60 L10 60 M26.79 38.79 L21.13 33.13 M48 30 L48 22 M69.21 38.79 L74.87 33.13"/>`,
  hammer:
    `<path d="M16 28 L80 28 L80 44 L52 44 L52 96 L44 96 L44 44 L16 44 Z"/>`,
  anvil:
    `<path d="M16 30 L80 30 L80 42 L56 42 L62 58 L34 58 L40 42 L16 42 Z"/>` +
    `<path d="M30 58 L66 58 L66 74 L30 74 Z"/>` +
    `<path d="M22 74 L74 74 L74 94 L22 94 Z"/>`,
  crown:
    `<path d="M16 44 L16 90 L80 90 L80 44 L64 66 L57 26 L48 60 L39 26 L32 66 Z"/>`,
  star:
    `<path d="M48 24 L56.82 47.87 L82.24 48.88 L62.27 64.63 L69.16 89.12 L48 75 ` +
    `L26.84 89.12 L33.73 64.63 L13.76 48.88 L39.18 47.87 Z"/>`,
  skull:
    `<path d="M48 24 C66 24 80 38 80 56 C80 70 72 80 62 84 L62 94 L34 94 L34 84 C24 80 16 70 16 56 C16 38 30 24 48 24 Z"/>` +
    `<circle fill="none" cx="38" cy="52" r="7"/>` +
    `<circle fill="none" cx="58" cy="52" r="7"/>` +
    `<path fill="none" d="M48 62 L44 72 L52 72 Z M40 86 L40 94 M48 86 L48 94 M56 86 L56 94"/>`,
  tusk:
    `<path fill="none" d="M28 26 C14 50 18 80 42 96 M68 26 C82 50 78 80 54 96"/>`,
};

/**
 * The inner geometry of each cadency mark, drawn in the trim colour inside the 4..92 / 4..116
 * field. Eight differencing shapes; the mark is only ever added to a sub-species standard.
 */
function cadencyMark(shape: string, trim: string): string {
  switch (shape) {
    case "bordure":
      return `<rect x="8" y="8" width="80" height="104" fill="none" stroke="${trim}" stroke-width="6"/>`;
    case "chief":
      return `<rect x="4" y="4" width="88" height="24" fill="${trim}"/>`;
    case "pile":
      return `<path d="M4 4 L92 4 L48 64 Z" fill="${trim}"/>`;
    case "bend":
      return `<path d="M4 4 L24 4 L92 116 L72 116 Z" fill="${trim}"/>`;
    case "chevron":
      return `<path d="M4 78 L48 34 L92 78" fill="none" stroke="${trim}" stroke-width="10"/>`;
    case "canton":
      return `<rect x="4" y="4" width="32" height="32" fill="${trim}"/>`;
    case "fess":
      return `<rect x="4" y="52" width="88" height="16" fill="${trim}"/>`;
    default:
      return `<path d="M4 4 L92 116 M92 4 L4 116" fill="none" stroke="${trim}" stroke-width="8"/>`;
  }
}

/** The full `<svg>` for the race or sub-species standard. Unknown ids return "" (never a broken glyph). */
export function raceBanner(raceId: string, subraceId: string | null = null, extraClass = ""): string {
  const raceNode = ANCESTRY[raceId];
  if (!raceNode) return "";
  const race = raceNode.parent === null ? raceNode.id : raceNode.race;
  let subId: string | null = null;
  if (subraceId) {
    const sub: AncestryNode | undefined = ANCESTRY[subraceId];
    // A foreign or misspelled sub-species would borrow another race's look — refuse it.
    if (!sub || sub.parent === null || sub.race !== race) return "";
    subId = sub.id;
  }
  const pal = bannerPalette(race, subId);
  const charge = chargeFor(race, subId);
  const mark = subId ? cadencyMark(cadencyOf(subId), pal.trim) : "";
  // data-cadency names the differencing mark (absent on a race node) so CSS can target it and a
  // reader can tell two sub-species of one race apart without parsing geometry.
  const cadencyAttr = subId ? ` data-cadency="${cadencyOf(subId)}"` : "";
  const cls = extraClass ? `banner banner-${race} ${extraClass}` : `banner banner-${race}`;
  return `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg"` +
    ` viewBox="0 0 ${BANNER_WIDTH} ${BANNER_HEIGHT}" width="${BANNER_WIDTH}" height="${BANNER_HEIGHT}"` +
    cadencyAttr +
    ` aria-hidden="true" focusable="false">` +
    `<rect x="4" y="4" width="88" height="112" fill="${pal.field}"/>` +
    mark +
    `<g class="banner-charge" fill="${pal.charge}" stroke="${pal.charge}" stroke-width="3"` +
    ` stroke-linecap="round" stroke-linejoin="round">${CHARGE_PATHS[charge]}</g>` +
    `<rect x="4" y="4" width="88" height="112" fill="none" stroke="${pal.trim}" stroke-width="6"/>` +
    `</svg>`;
}
