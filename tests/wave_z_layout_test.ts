// Wave Z (lane F): the Fighters page — C-LV (the level badge's metal bands), the hero picture plate
// (portrait cover, LV top-left, name + tags floating), "Roll" on purple stone, the removed panel head,
// C-SHEET placed in the hero card and the + New column, and the CSS that makes it fit. SPEC Z1-Z19.
import { LEVEL_TIERS, levelBadgeHtml, levelTier, shownLevel } from "../src/ui/LevelBadge.ts";
import { MAX_LEVEL, MIN_LEVEL } from "../src/game/SpectateGen.ts";
import { heroFloatHtml, heroPlateHtml, heroRollButtonHtml, heroTags, mulberry32 } from "../src/ui/Menu.ts";
import { creatorSheet, rollProfile } from "../src/ui/CreatorRoll.ts";

function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals(a: unknown, b: unknown, msg = ""): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const menu = await Deno.readTextFile(new URL("../src/ui/Menu.ts", import.meta.url));
const css = await Deno.readTextFile(new URL("../styles.css", import.meta.url));

Deno.test("SPEC Z1: levelTier bands — 1-4 bronze, 5-8 copper, 9-12 silver, 13-16 gold, 17-20 platinum", () => {
  const expect: Record<number, string> = {};
  for (let n = 1; n <= 20; n++) expect[n] = ["bronze", "copper", "silver", "gold", "platinum"][Math.floor((n - 1) / 4)];
  for (let n = 1; n <= 20; n++) assertEquals(levelTier(n), expect[n], `level ${n}`);
  // Every band edge, both sides.
  for (const [lo, hi, t] of [[1, 4, "bronze"], [5, 8, "copper"], [9, 12, "silver"], [13, 16, "gold"], [17, 20, "platinum"]] as const) {
    assertEquals(levelTier(lo), t); assertEquals(levelTier(hi), t);
  }
  assertEquals([MIN_LEVEL, MAX_LEVEL], [1, 20], "the bands are spread over the game's own level span");
  assertEquals(LEVEL_TIERS.length, 5);
});

Deno.test("SPEC Z2: levelTier is total — out-of-span and non-finite levels clamp into the span", () => {
  assertEquals(levelTier(0), "bronze"); assertEquals(levelTier(-7), "bronze"); assertEquals(levelTier(NaN), "bronze");
  assertEquals(levelTier(21), "platinum"); assertEquals(levelTier(999), "platinum"); assertEquals(levelTier(Infinity), "bronze");
  assertEquals(levelTier(4.99), "bronze", "floored, not rounded"); assertEquals(levelTier(5), "copper");
  assertEquals(shownLevel(12.7), 12); assertEquals(shownLevel(-3), 1); assertEquals(shownLevel(40), 20);
  // Monotone: the metal never goes down as the level rises.
  let prev = 0;
  for (let n = -2; n <= 25; n += 0.5) { const i = LEVEL_TIERS.indexOf(levelTier(n)); assert(i >= prev, `monotone at ${n}`); prev = i; }
});

Deno.test("SPEC Z3: levelBadgeHtml is the C-LV markup — LV then the number, data-tier, no inline style", () => {
  const html = levelBadgeHtml(12);
  assert(html.startsWith(`<span class="lv-badge" data-tier="silver"`), html);
  assert(/<span class="lv-label"[^>]*>LV<\/span><span class="lv-num"[^>]*>12<\/span><\/span>$/.test(html), "LV, then the number to its right");
  assert(html.includes(`aria-label="Level 12"`));
  assert(levelBadgeHtml(3, { small: true }).includes(`class="lv-badge lv-badge-sm"`));
  assert(levelBadgeHtml(17).includes(`data-tier="platinum"`) && levelBadgeHtml(13).includes(`data-tier="gold"`));
  assert(levelBadgeHtml(NaN).includes(">1</span>"));
  for (const n of [1, 5, 9, 13, 17, 20]) assert(!levelBadgeHtml(n).includes("style="), "CSP: classes only");
});

Deno.test("SPEC Z4: every tier has its metal in styles.css (rim token + face + ink)", () => {
  for (const t of LEVEL_TIERS) assert(new RegExp(`\\.lv-badge\\[data-tier="${t}"\\]\\{--lv-rim:var\\(--metal-${t}\\);--lv-face:[^;]+;--lv-ink:#`).test(css), t);
  for (const k of ["--metal-silver:", "--metal-gold:", "--metal-platinum:", "--metal-silver-base:", "--metal-gold-base:", "--metal-platinum-base:"]) assert(css.includes(k), k);
});

const { profile } = rollProfile(mulberry32(7));
const sheet = creatorSheet(profile);

Deno.test("SPEC Z5: the hero plate — picture first (cover), LV badge in the corner, name + tags float in the foot", () => {
  const html = heroPlateHtml({ name: profile.name, level: 14, portrait: "data:image/jpeg;base64,AAAA", tags: heroTags(sheet, profile), record: "2 W · 1 L" });
  const iImg = html.indexOf(`<img class="hero-portrait"`), iCorner = html.indexOf("hero-plate-corner"), iFoot = html.indexOf("hero-plate-foot");
  assert(iImg > 0 && iImg < iCorner && iCorner < iFoot, "picture under, badge, then the floating foot");
  assert(html.includes(`data-tier="gold"`) && html.includes(">14</span>"), "LV 14 gold");
  assert(html.includes(`class="hero-name">${profile.name.replace(/'/g, "&#39;")}<`) || html.includes(`class="hero-name">`), "the name floats");
  assert(html.includes("2 W · 1 L"));
  assert(!html.includes("style="), "CSP: no inline style");
  // A portrait that is not an image data URL is never put into src.
  const bad = heroPlateHtml({ name: "X", level: 1, portrait: "javascript:alert(1)", tags: [] });
  assert(!bad.includes("<img") && bad.includes("hero-portrait-empty") && bad.includes("is-empty"));
});

Deno.test("SPEC Z6: the tags are race, sub-race, class, sign, weapon — empty parts left out, sign/weapon with icons", () => {
  const tags = heroTags(sheet, profile);
  const kinds = tags.map((t) => t.kind);
  assertEquals(kinds.filter((k) => k === "race").length, 1);
  assert(kinds.includes("class") && kinds.includes("weapon"), kinds.join());
  assertEquals(kinds, [...kinds].sort((a, b) => ["race", "subrace", "class", "sign", "weapon"].indexOf(a) - ["race", "subrace", "class", "sign", "weapon"].indexOf(b)), "fixed order");
  const none = heroTags({ raceLabel: "Human", subraceLabel: "—", className: "Warrior", signLabel: "None", weaponLabel: "" });
  assertEquals(none.map((t) => t.kind), ["race", "class"]);
  const f = heroFloatHtml("A <b>", tags);
  assert(f.includes("A &lt;b&gt;") && (f.match(/class="hero-tag"/g) ?? []).length === tags.length && !f.includes("style="));
  if (tags.some((t) => t.kind === "weapon")) assert(/data-tag="weapon"><svg/.test(f), "the weapon tag carries its icon");
});

Deno.test("SPEC Z7: 'Roll' replaces 'Reroll hero' — same hook/action, purple stone, a 1.4x icon, a 44 px target", () => {
  const b = heroRollButtonHtml("p1");
  assert(b.includes(">Roll</span>") && !b.includes("Reroll hero"), "the label is Roll");
  assert(b.includes("data-hero-reroll") && b.includes(`data-profile-id="p1"`), "the same hook (the engine's action id stays \"reroll\")");
  assert(b.includes("btn-stone btn-stone-purple") && b.includes("hero-roll-glyph"));
  assert(!menu.includes("<span>Reroll hero</span>"), "the old label is gone from the page");
  assert(menu.includes(`this.#cb.onProfileAction?.("reroll", playerId)`), "the action id stays reroll");
  assert(/--stone-purple:var\(--u-tex-grain\),var\(--stone-speckle\),var\(--u-tex-mottle\),var\(--stone-purple-base\)/.test(css), "purple stone = the stone recipe on a violet ramp");
  assert(/\.hero-roll-glyph\{width:1\.68em;height:1\.68em/.test(css), "icon 1.68em = 1.4 x the wave Y 1.2em");
  assert(/#menu \.hero-verbs \.hero-roll\{[^}]*padding:3px 12px 3px 7px;min-height:44px/.test(css), "tighter padding (was 8px 14px), still a 44 px target");
});

Deno.test("SPEC Z8: the 'Chosen hero — Figure, record, statistics.' panel head is gone; the roster keeps its body", () => {
  assert(!menu.includes("Chosen hero<span") && !menu.includes("Figure, record, statistics."));
  const roster = menu.slice(menu.indexOf("#rosterPanelHtml(): string"), menu.indexOf("#groupGlyph(panelId: string"));
  assert(!roster.includes("panel-head") && roster.includes(`id="profiles-body"`) && roster.includes(`aria-label="Chosen hero"`));
});

Deno.test("SPEC Z9: C-SHEET is placed in the hero card and the + New column, then toned", () => {
  const fn = menu.slice(menu.indexOf("#heroSheetHtml(sheet: CreatorSheet"), menu.indexOf("#heroColsHtml(sheet: CreatorSheet)"));
  assert(fn.includes("statSheetHtml(derivedSheet(character)"), "the hero card renders lane S's sheet");
  const card = menu.slice(menu.indexOf("#paintHeroCard(view"), menu.indexOf("// ── Wave Y: the hero reroll"));
  assert(card.includes(`<div class="hero-sheet">\${this.#heroSheetHtml(`) && card.indexOf("paintTones(body)") > card.indexOf("hero-sheet"), "hero card: sheet then paintTones");
  const creator = menu.slice(menu.indexOf("#renderCreatorSheet(): void"), menu.indexOf("#renderCreatorSheet(): void") + 900);
  assert(creator.includes("this.#heroSheetHtml(sheet, this.#player)") && creator.includes("paintTones(el)"), "+ New: the same sheet, toned");
});

Deno.test("SPEC Z10: the + New viewer wears the same plate — canvas under, LV corner, floating name, sockets kept", () => {
  const prev = menu.slice(menu.indexOf("#previewPanelHtml(): string"), menu.indexOf("#overrideFieldsHtml(): string"));
  const plate = prev.indexOf(`class="stage-plate"`), lv = prev.indexOf(`id="creator-lv"`), ring = prev.indexOf("equipRingHtml(this.#player)"), foot = prev.indexOf(`id="creator-float"`);
  assert(plate > 0 && plate < lv && lv < ring && ring < foot, "plate > LV corner > sockets+canvas > floating name");
  assert(/\.stage-plate \.equip-view\{position:absolute;inset:0;z-index:0/.test(css), "the canvas fills the plate under everything");
  assert(/\.stage-plate::before\{content:"";grid-column:1;grid-row:1\/-1;padding-top:133\.333%/.test(css), "at least 3:4, grows with its content (never clips the foot)");
  assert(/\.stage-plate \.preview-canvas\{display:block;width:100%;height:100%/.test(css));
  // The canvas left the ring's flow, so the right column must be pinned to the third track (it slid
  // into the middle track next to the left column before this rule).
  assert(/\.equip-col-right\{grid-column:3;grid-row:1\}/.test(css) && /\.equip-col-left\{grid-column:1;grid-row:1\}/.test(css));
});

Deno.test("SPEC Z11: the picture fills its plate — 3:4, object-fit cover, focal point on the figure", () => {
  assert(/\.hero-plate\{[^}]*aspect-ratio:3\/4;overflow:hidden/.test(css));
  assert(/\.hero-plate > \.hero-portrait\{position:absolute;inset:0;[^}]*object-fit:cover;object-position:50% 35%/.test(css));
  assert(/\.hero-plate-corner\{position:absolute;z-index:2;top:[^;]+;left:/.test(css), "LV badge top-left");
  assert(/\.hero-plate-foot\{position:absolute;z-index:1;left:0;right:0;bottom:0/.test(css), "name/tags float at the foot");
  assert(/--plate-scrim:linear-gradient\(0deg,rgba\(9,6,3,\.94\)/.test(css), "on a scrim");
});

Deno.test("SPEC Z12: no text below 11 px in the wave Z rules; the tab badge label is pinned at 11 px", () => {
  const block = css.slice(css.indexOf("Wave Z (lane F)"));
  for (const m of block.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)) assert(Number(m[1]) >= 11, `font-size ${m[1]}px`);
  assert(/\.lv-badge-sm \.lv-label\{font-size:11px/.test(block));
});

Deno.test("SPEC Z13: the tab strip wraps (no off-screen tabs), tab names wrap instead of an ellipsis", () => {
  const block = css.slice(css.indexOf("Wave Z (lane F)"));
  assert(/\.hero-tabs\{flex-wrap:wrap;overflow:visible/.test(block));
  assert(/\.hero-tab-text strong\{white-space:normal;overflow:visible;text-overflow:clip;max-width:18ch;overflow-wrap:break-word;word-break:normal/.test(block),
    "wrap at spaces; a word only breaks when it alone is wider than the tab (V Z-23: 'anywhere' broke 'Stepperunners')");
  assert(!/\.hero-tab-text strong\{[^}]*overflow-wrap:anywhere/.test(block));
  assert(/\.zs-label\{[^}]*overflow-wrap:break-word;word-break:normal/.test(block) && !/\.zs-label\{[^}]*anywhere/.test(block), "stat labels never split mid-word (V Z-35: 'Density')");
});
