// Heraldic standards: every race and every sub-species flies its own distinct banner, cut from
// the ancestry the rig uses, drawn as CSP-safe markup (presentation attributes only), with a
// charge that still reads at the 32 px chip. Pure module: no DOM, no Math.random.
import {
  BANNER_HEIGHT,
  BANNER_WIDTH,
  bannerCharge,
  bannerPalette,
  raceBanner,
  type BannerCharge,
} from "../src/ui/RaceBanners.ts";
import { ANCESTRY } from "../src/game/Ancestry.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

const RACES = ["human", "elf", "dwarf", "ork"] as const;
const SUBRACES: Record<string, readonly string[]> = {
  human: ["imperial", "nomad", "islander"],
  elf: ["high", "wood", "dark"],
  dwarf: ["mountain", "forge", "deep"],
  ork: ["greenhide", "ironhide", "bloodfang"],
};
const ALL_SUBS = Object.values(SUBRACES).flat();
const ALL_CHARGES: readonly BannerCharge[] = [
  "laurel", "sun", "hammer", "crown", "tusk", "anvil", "star", "skull",
];

/** Field rectangle (the field excludes the 4-unit trim): 88 x 112 at (4, 4), centre (48, 60). */
const FIELD_W = 88, FIELD_H = 112, FIELD_CX = 48, FIELD_CY = 60;

/**
 * A distinctive substring of each charge's geometry, used to read which charge a standard flies
 * back out of the markup (the module does not label the charge with an attribute).
 */
const CHARGE_SIG: Readonly<Record<BannerCharge, string>> = {
  laurel: "C74 34", sun: 'r="30"', hammer: "M16 28", anvil: "M16 30",
  crown: "M16 44", star: "56.82 47.87", skull: "C66 24", tusk: "C14 50",
};

/** The charge a rendered standard flies, read from its geometry. */
function chargeIn(svg: string): BannerCharge {
  for (const c of ALL_CHARGES) if (svg.includes(CHARGE_SIG[c])) return c;
  throw new Error("no known charge in the standard");
}

/** Minimal XML well-formedness check (same contract as tests/ui_icons_test.ts). */
function parseTags(svg: string): string[] {
  const stack: string[] = [];
  const seen: string[] = [];
  const tag = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  let consumed = 0;
  for (const m of svg.matchAll(tag)) {
    const between = svg.slice(consumed, m.index);
    if (between.trim() !== "") throw new Error(`text outside tags: "${between}"`);
    consumed = m.index! + m[0].length;
    const [, closing, name, , selfClosing] = m;
    if (closing) {
      const open = stack.pop();
      if (open !== name) throw new Error(`</${name}> closes <${open}>`);
    } else {
      seen.push(name);
      if (!selfClosing) stack.push(name);
    }
  }
  if (consumed !== svg.length) throw new Error(`unparsed tail: "${svg.slice(consumed, consumed + 40)}"`);
  if (stack.length) throw new Error(`unclosed: ${stack.join(",")}`);
  return seen;
}

/**
 * The coordinate envelope of a standard's charge: the min/max of every circle (cx±r, cy±r) and
 * every absolute path coordinate in the `<g class="banner-charge">` group. The charge is drawn
 * with absolute M/L/C/Q/Z commands only, so each number is an (x, y) pair.
 */
function chargeBox(svg: string): { w: number; h: number; cx: number; cy: number } {
  const start = svg.indexOf('<g class="banner-charge"');
  assert(start >= 0, "no charge group");
  const open = svg.indexOf(">", start) + 1;
  const end = svg.indexOf("</g>", open);
  const body = svg.slice(open, end);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const m of body.matchAll(/<circle\b([^>]*)\/>/g)) {
    const a = m[1];
    const cx = Number(/cx="([-\d.]+)"/.exec(a)![1]);
    const cy = Number(/cy="([-\d.]+)"/.exec(a)![1]);
    const r = Number(/r="([-\d.]+)"/.exec(a)![1]);
    add(cx - r, cy - r);
    add(cx + r, cy + r);
  }
  for (const m of body.matchAll(/<path\b[^>]*\bd="([^"]*)"/g)) {
    const nums = m[1].match(/-?\d*\.?\d+/g) ?? [];
    for (let i = 0; i + 1 < nums.length; i += 2) add(Number(nums[i]), Number(nums[i + 1]));
  }
  assert(Number.isFinite(minX), "no charge geometry found");
  return { w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/** Every (race, sub|null) standard the game can draw. */
function everyStandard(): { race: string; sub: string | null; svg: string }[] {
  const out: { race: string; sub: string | null; svg: string }[] = [];
  for (const race of RACES) out.push({ race, sub: null, svg: raceBanner(race) });
  for (const race of RACES) for (const sub of SUBRACES[race]) out.push({ race, sub, svg: raceBanner(race, sub) });
  return out;
}

Deno.test("banners: the standard is a 4:5 hanging field", () => {
  assert(BANNER_WIDTH === 96, `BANNER_WIDTH ${BANNER_WIDTH}`);
  assert(BANNER_HEIGHT === 120, `BANNER_HEIGHT ${BANNER_HEIGHT}`);
  assert(BANNER_HEIGHT / BANNER_WIDTH === 5 / 4, "must be exactly 4:5");
});

Deno.test("banners: each race bears its ancestry's charge, and the four are distinct", () => {
  const expected: Record<string, BannerCharge> = { elf: "laurel", human: "crown", dwarf: "hammer", ork: "tusk" };
  for (const race of RACES) assert(bannerCharge(race) === expected[race], `${race}: ${bannerCharge(race)}`);
  assert(new Set(RACES.map((r) => bannerCharge(r))).size === 4, "the four race charges must be distinct");
  // Ancestry tie-in: orks are the tusked race (count 2) and fly tusk/skull; elves carry no tusks
  // and fly laurel/star. The race node itself flies the primary charge.
  assert(ANCESTRY.ork.tusk.count === 2 && ANCESTRY.elf.tusk.count === 0, "ancestry tusk facts");
  assert(chargeIn(raceBanner("ork")) === "tusk", "ork flies the tusk");
  assert(chargeIn(raceBanner("elf")) === "laurel", "elf flies the laurel");
  // A sub-species id passed in the race slot climbs to its race.
  assert(bannerCharge("high") === "laurel" && bannerCharge("greenhide") === "tusk", "sub id climbs to its race");
});

Deno.test("banners: the palette is read from ancestry (skin base / crease) plus a lore trim", () => {
  const trims: Record<string, string> = { human: "#b5762e", elf: "#5b7c99", dwarf: "#6f7378", ork: "#7c6a9e" };
  for (const race of RACES) {
    const pal = bannerPalette(race);
    assert(pal.field === ANCESTRY[race].skin.base, `${race}: field is not the node's skin base`);
    assert(pal.charge === ANCESTRY[race].skin.crease, `${race}: charge is not the node's crease`);
    assert(pal.trim === trims[race], `${race}: trim ${pal.trim}`);
  }
  // A sub-species carries a differencing tint: its trim differs from the race's flat trim.
  for (const sub of ALL_SUBS) {
    const race = ANCESTRY[sub].race;
    const subPal = bannerPalette(race, sub);
    const racePal = bannerPalette(race);
    assert(subPal.field === ANCESTRY[sub].skin.base, `${sub}: field is not its own skin base`);
    assert(subPal.charge === ANCESTRY[sub].skin.crease, `${sub}: charge is not its own crease`);
    assert(subPal.trim !== racePal.trim, `${sub}: no differencing tint on the trim`);
    assert(/^#[0-9a-f]{6}$/.test(subPal.trim), `${sub}: tint is not a #rrggbb (${subPal.trim})`);
  }
  assert(bannerPalette("elf", "high").trim === bannerPalette("elf", "high").trim, "palette not deterministic");
});

Deno.test("banners: unknown ids return nothing; a foreign sub-species is refused", () => {
  assert(raceBanner("nope") === "", "unknown race must draw nothing");
  assert(raceBanner("") === "", "empty id must draw nothing");
  assert(raceBanner("elf", "mountain") === "", "a sub-species of another race must be refused");
  assert(raceBanner("elf", "nope") === "", "an unknown sub-species must be refused");
  assert(raceBanner("human").startsWith("<svg "), "a known race must draw an <svg>");
});

Deno.test("banners: every standard is well-formed markup with no style attribute", () => {
  for (const { race, sub, svg } of everyStandard()) {
    const label = sub ? `${race}/${sub}` : race;
    const tags = parseTags(svg);
    assert(tags[0] === "svg" && tags.filter((t) => t === "svg").length === 1, `${label}: root <svg>`);
    assert(svg.startsWith("<svg ") && svg.endsWith("</svg>"), `${label}: one <svg> element`);
    assert(svg.includes(`viewBox="0 0 ${BANNER_WIDTH} ${BANNER_HEIGHT}"`), `${label}: viewBox`);
    assert(svg.includes('aria-hidden="true"'), `${label}: must be aria-hidden`);
    assert(svg.includes('focusable="false"'), `${label}: must not be focusable`);
    assert(svg.includes('<g class="banner-charge"'), `${label}: no charge group`);
    assert(!/style\s*=/.test(svg), `${label}: contains a style attribute`);
    assert(!/<style|<script|<image|href=/i.test(svg), `${label}: script/style/href/external`);
    assert(!/on\w+=/i.test(svg), `${label}: event handler`);
    // Every paint is a #rrggbb or none — no named/url() paint can escape the CSP rules.
    for (const m of svg.matchAll(/\b(fill|stroke)="([^"]*)"/g)) {
      assert(/^(#[0-9a-f]{6}|none)$/.test(m[2]), `${label}: paint ${m[1]}="${m[2]}"`);
    }
  }
});

Deno.test("banners: the charge reads at 32 px — >=40% of the field, centred within +/-8 units", () => {
  const seen = new Set<BannerCharge>();
  for (const { race, sub, svg } of everyStandard()) {
    const label = sub ? `${race}/${sub}` : race;
    const box = chargeBox(svg);
    seen.add(chargeIn(svg));
    assert(box.w >= 0.4 * FIELD_W, `${label}: charge width ${box.w} < 40% of ${FIELD_W}`);
    assert(box.h >= 0.4 * FIELD_H, `${label}: charge height ${box.h} < 40% of ${FIELD_H}`);
    assert(box.w * box.h >= 0.4 * FIELD_W * FIELD_H, `${label}: charge area ${box.w * box.h} < 40% of field`);
    assert(Math.abs(box.cx - FIELD_CX) <= 8, `${label}: charge x-centre ${box.cx} off by > 8`);
    assert(Math.abs(box.cy - FIELD_CY) <= 8, `${label}: charge y-centre ${box.cy} off by > 8`);
  }
  // All eight charge geometries are exercised across the sixteen standards, so each is measured.
  assert(seen.size === 8, `only ${seen.size} of 8 charges exercised: ${[...seen].join(",")}`);
});

Deno.test("banners: the 4 race + 12 sub-species standards are all distinct, 0 duplicates", () => {
  const all = [
    ...RACES.map((r) => raceBanner(r)),
    ...RACES.flatMap((r) => SUBRACES[r].map((s) => raceBanner(r, s))),
  ];
  assert(all.length === 16, `expected 16 standards, got ${all.length}`);
  const unique = new Set(all);
  const duplicates = all.length - unique.size;
  assert(duplicates === 0, `${duplicates} duplicate standard(s)`);
  for (const race of RACES) {
    const raceSvg = raceBanner(race);
    for (const sub of SUBRACES[race]) assert(raceBanner(race, sub) !== raceSvg, `${sub} flies ${race}'s standard`);
    const sibs = SUBRACES[race].map((s) => raceBanner(race, s));
    assert(new Set(sibs).size === sibs.length, `${race} has two identical sibling standards`);
  }
});

Deno.test("banners: deterministic — the same ids give the identical string", () => {
  const pairs: [string, string | null][] = [["human", null], ["human", "nomad"], ["elf", "high"], ["ork", "bloodfang"]];
  for (const [race, sub] of pairs) assert(raceBanner(race, sub) === raceBanner(race, sub), `${race}/${sub} not deterministic`);
  const withClass = raceBanner("elf", "high", "chip-banner");
  assert(withClass.includes('class="banner banner-elf chip-banner"'), "extraClass placement");
});

Deno.test("banners: write the per-race table + distinctness to artifacts/design/race-banners.json", async () => {
  const table = RACES.map((race) => ({
    race,
    charge: bannerCharge(race),
    palette: bannerPalette(race),
    subraces: SUBRACES[race].map((sub) => ({
      sub,
      charge: chargeIn(raceBanner(race, sub)),
      palette: bannerPalette(race, sub),
      cadency: /data-cadency="([a-z]+)"/.exec(raceBanner(race, sub))?.[1] ?? "?",
    })),
  }));
  const all = everyStandard().map((s) => s.svg);
  const manifest = {
    standard: { width: BANNER_WIDTH, height: BANNER_HEIGHT, ratio: "4:5" },
    table,
    distinctness: { total: all.length, unique: new Set(all).size, duplicates: all.length - new Set(all).size },
  };
  await Deno.writeTextFile("artifacts/design/race-banners.json", JSON.stringify(manifest, null, 2));
  assert(manifest.distinctness.duplicates === 0, "manifest records duplicates");
});
