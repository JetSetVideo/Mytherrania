// Wave L (L-D): the menu/creator markup builders and the dice roll, pinned without a browser.
//
// These are the pieces the renderer lane owns: the closed option trees (L-C's contract), the
// purple rocky dice button, the étendard glyphs and the rolled fighter's stat sheet, plus the
// seeded PRNG the dice draws from. Pure strings and pure maths only — no DOM, no Math.random.
//
// The last two tests read the sources off disk: they guard the page's content-security policy
// (never a `style="…"` attribute) and the four-breakpoint promise, both of which live in files a
// unit test cannot otherwise see.
import {
  creatorSheetHtml,
  diceButtonHtml,
  mulberry32,
  optGroupHtml,
  optionCount,
  type OptGroupSpec,
} from "../src/ui/Menu.ts";
import { rollProfile, creatorSheet, type CreatorSheet } from "../src/ui/CreatorRoll.ts";
import { groupKey } from "../src/ui/Disclosure.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
function eq<T>(actual: T, expected: T, message = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message} expected ${e}, got ${a}`);
}
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

// ── The closed option tree (L-C's renderer contract) ────────────────────────────────────────────

const spec = (over: Partial<OptGroupSpec> = {}): OptGroupSpec => ({
  screen: "select", panel: "ancestry", id: "race", label: "Race", hint: "Pick the people.",
  colour: "grass", count: 1, open: false, body: "<p>controls</p>", ...over,
});

Deno.test("opt-group: closed by default, open only when Disclosure says so", () => {
  const closed = optGroupHtml(spec());
  assert(closed.startsWith(`<details class="opt-group" data-group="select/ancestry/race" data-colour="grass">`),
    `closed details has no open attribute: ${closed.slice(0, 90)}`);
  assert(!closed.includes(" open"), "a closed group carries no open attribute");
  const open = optGroupHtml(spec({ open: true }));
  assert(open.includes(`data-colour="grass" open>`), "an open group sets the native open attribute");
  // The data-group key is L-C's groupKey, so the renderer and the model cannot drift apart.
  eq(`data-group="${groupKey("select", "ancestry", "race")}"`, `data-group="select/ancestry/race"`);
  assert(closed.includes(`data-group="${groupKey("select", "ancestry", "race")}"`), "the group key matches Disclosure");
});

Deno.test("opt-group: header carries the glyph, label, count, hint and chevron; body holds the controls", () => {
  const html = optGroupHtml(spec({ label: "Weapon", hint: "Shaft, blade, curve.", count: 3, glyph: "<svg class=\"icon icon-dash\"></svg>" }));
  for (const cls of ["opt-head", "opt-glyph", "opt-label", "opt-count", "opt-hint", "opt-chevron", "opt-chevron-svg", "opt-body"]) {
    assert(html.includes(cls), `header/body declares .${cls}`);
  }
  assert(html.includes(`<span class="opt-label">Weapon</span>`), "the label is rendered");
  assert(html.includes(`<span class="opt-count">3 options</span>`), "the count is pluralised");
  assert(html.includes(`<span class="opt-hint">Shaft, blade, curve.</span>`), "the hint is rendered");
  assert(html.includes(`icon icon-dash`), "the glyph is placed in .opt-glyph");
  assert(html.includes(`<div class="opt-body"><p>controls</p></div>`), "the controls go in the body");
});

Deno.test("optionCount: singular for one, plural otherwise (never negative-NA)", () => {
  eq(optionCount(1), "1 option");
  eq(optionCount(0), "0 options");
  eq(optionCount(5), "5 options");
});

// ── The dice: purple, rocky, icon-led, CSP-safe ─────────────────────────────────────────────────

Deno.test("dice button: the rocky violet classes, the dice icon and data-action=\"dice\"", () => {
  const html = diceButtonHtml();
  assert(html.includes(`class="dice-btn dice-btn-rocky"`), "the rocky dice classes");
  assert(html.includes(`data-action="dice"`), "it is the dice action");
  assert(html.includes("icon icon-dice dice-glyph"), `the dice icon in the glyph slot: ${html}`);
  assert(html.includes(`<span class="dice-label">Roll</span>`), "a visible label beside the icon");
  assert(html.startsWith("<button") && html.endsWith("</button>"), "it is a real <button>");
});

// ── The seeded PRNG the dice draws from (never Math.random) ─────────────────────────────────────

Deno.test("mulberry32: deterministic, in [0,1), and different seeds diverge", () => {
  const a = mulberry32(12345), b = mulberry32(12345);
  const first = [a(), a(), a(), a(), a()];
  const second = [b(), b(), b(), b(), b()];
  eq(first, second, "the same seed replays the same stream");
  for (const v of first) assert(v >= 0 && v < 1, `a draw stays in [0,1): ${v}`);
  const c = mulberry32(54321);
  assert(first[0] !== c(), "a different seed starts elsewhere");
  assert(mulberry32(0)() >= 0 && mulberry32(0)() < 1, "seed 0 is valid");
});

// ── The rolled fighter's stat sheet ─────────────────────────────────────────────────────────────

const FIXTURE: CreatorSheet = {
  name: "Kestrel", raceLabel: "Elf", subraceLabel: "Wood Elf", className: "Archer",
  weaponLabel: "Yew Longbow", signLabel: "The Moon",
  primary: [
    { label: "Vitality", value: "47 100" },
    { label: "Resilience", value: "42" },
    { label: "Willpower", value: "38" },
    { label: "Reflex", value: "55" },
    { label: "Strength", value: "40" },
    { label: "Intelligence", value: "36" },
  ],
  derived: [
    { label: "Max Health", value: "47 100" },
    { label: "Attack Power", value: "312", hint: "≈ 12 a blow vs. an even foe" },
    { label: "Attack Interval", value: "0.80 s" },
    { label: "Armour", value: "12.0" },
  ],
  secondary: [
    { label: "Critical Chance", value: "+2.0%" },
    { label: "Haste", value: "+1.0%" },
  ],
};

Deno.test("creator sheet: three columns, every row labelled, the hint carries the WHY", () => {
  const html = creatorSheetHtml(FIXTURE);
  assert(html.includes(`class="sheet-name">Kestrel<`), "the identity line names the fighter");
  assert(html.includes("Elf · Wood Elf · Archer"), "race, sub-species and class are merged");
  for (const head of ["Attributes", "Derived", "Modifiers"]) assert(html.includes(`>${head}<`), `column ${head}`);
  for (const r of [...FIXTURE.primary, ...FIXTURE.derived, ...FIXTURE.secondary]) {
    assert(html.includes(`>${r.label}<`), `row label ${r.label}`);
    assert(html.includes(`>${r.value}<`), `row value ${r.value}`);
  }
  eq(count(html, `class="sheet-row"`), FIXTURE.primary.length + FIXTURE.derived.length + FIXTURE.secondary.length,
    "one .sheet-row per SheetRow");
  assert(html.includes(`class="sheet-row-hint">≈ 12 a blow vs. an even foe<`), "the derived hint is rendered");
});

Deno.test("the real pipeline: a seeded roll's sheet is reproduced by creatorSheetHtml", () => {
  const rolled = rollProfile(mulberry32(20261031));
  const sheet = creatorSheet(rolled.profile);
  eq(sheet.primary.map((r) => r.label), ["Vitality", "Resilience", "Willpower", "Reflex", "Strength", "Intelligence"]);
  eq(sheet.derived.map((r) => r.label), ["Max Health", "Attack Power", "Attack Interval", "Armour"]);
  const html = creatorSheetHtml(sheet);
  assert(html.includes(`>${sheet.name}<`), "the rolled name is on the sheet");
  for (const r of [...sheet.primary, ...sheet.derived, ...sheet.secondary]) assert(html.includes(`>${r.label}<`), `rendered ${r.label}`);
  // Same seed -> same fighter -> same sheet (the dice must be replayable; no Math.random anywhere).
  eq(creatorSheet(rollProfile(mulberry32(20261031)).profile), sheet, "the same seed yields the same sheet");
});

// ── Guards over the sources: the CSP and the four breakpoints ───────────────────────────────────

Deno.test("no inline style, no <script> in any builder output (the page CSP is style-src 'self')", () => {
  const outputs = [
    diceButtonHtml(),
    optGroupHtml(spec({ glyph: diceButtonHtml() })),
    creatorSheetHtml(FIXTURE),
  ];
  for (const html of outputs) {
    assert(!html.includes("style="), `an inline style attribute would be blocked: ${html.slice(0, 80)}`);
    assert(!html.includes("<script"), "no script tag is ever emitted");
  }
});

Deno.test("styles.css declares the new components and survives all four breakpoints", async () => {
  const css = await Deno.readTextFile(new URL("../styles.css", import.meta.url));
  for (const cls of [".opt-group", ".opt-head", ".opt-count", ".opt-body", ".dice-btn", ".dice-btn-rocky", ".creator-sheet", ".sheet-row", ".preview-grid", ".preview-canvas", ".race-box-banner", ".subrace-banner"]) {
    assert(css.includes(cls), `styles.css declares ${cls}`);
  }
  for (const bp of ["max-width:767px", "min-width:768px", "min-width:1024px", "min-width:1440px"]) {
    assert(css.includes(bp), `styles.css carries the ${bp} breakpoint`);
  }
  // The dice and the option headers clear the 44px touch target where it matters.
  assert(/\.dice-btn\{[^}]*min-height:48px/.test(css), "the dice is at least 44px tall");
  assert(/\.opt-head\{[^}]*min-height:44px/.test(css), "the option header is a 44px hit target");
});

Deno.test("Menu.ts renders the new keys the UI tree and the design promise (a silent removal fails here)", async () => {
  const menu = await Deno.readTextFile(new URL("../src/ui/Menu.ts", import.meta.url));
  for (const key of ["creator-preview", "creator-sheet", "data-action=\"dice\"", "preview-hint", "opt-group", "data-pinned"]) {
    assert(menu.includes(key), `Menu.ts renders ${key}`);
  }
  // The roll must come from CreatorRoll with a seeded rng, never Math.random.
  assert(menu.includes("rollProfile(mulberry32("), "the roll is seeded through CreatorRoll");
  // Strip comments first: the doc prose names Math.random to explain why it is never used.
  const code = menu.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert(!/Math\.random/.test(code), "Menu.ts never calls Math.random");
});
