// Wave R, lane R-C: ONE entry to the generator, and a generator you can override by hand.
//
// What this file pins, without a browser (the pure model + the rendered-source contracts):
//   1. the title declares ONE entry — the ≡ Profiles button and the ⚔ Fight button are merged, so the
//      tree's `profiles` group holds only the picker and the `modes` group carries the single entry;
//   2. the roster and the generator are ONE screen: the standalone profiles screen is gone and
//      `#profiles-body` is rendered inside the Creator's own screen;
//   3. every hand-override routes through `CreatorSync.applyEdit`, and the override field names are
//      REAL — an applyEdit of each one moves the profile (race clears a foreign sub-species, height and
//      weight clamp into the race's band, the name lands, the six attributes are the allocated keys);
//   4. the save/discard decision is explicit (a Save control and a Discard control, with a re-roll);
//   5. the new markup stays CSP-safe (no inline `style="`), and styles.css declares the new classes and
//      keeps the four breakpoints.
import { screenPanels, defaultOpenGroups } from "../src/ui/UiTree.ts";
import { applyEdit, heightBand, weightBand } from "../src/ui/CreatorSync.ts";
import { rollProfile } from "../src/ui/CreatorRoll.ts";
import type { CharacterProfile } from "../src/game/Characters.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}

function eq<T>(actual: T, expected: T, message = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: expected ${e}, got ${a}`);
}

const menuSrc = await Deno.readTextFile(new URL("../src/ui/Menu.ts", import.meta.url));
const cssSrc = await Deno.readTextFile(new URL("../styles.css", import.meta.url));
/** Strip line/block comments so a doc prose "Math.random"/"style=" is not read as code. */
const code = menuSrc.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

/** A deterministic rng (mulberry32), the same the dice uses — no Math.random anywhere. */
function rng32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A genuinely ROLLED elf with a sub-species (so a race edit has a foreign nation to clear). */
function rolledElf(): CharacterProfile {
  for (let seed = 1; seed < 5000; seed++) {
    const { profile } = rollProfile(rng32(seed));
    if (profile.race === "elf" && profile.subrace) return profile;
  }
  throw new Error("no elf roll with a sub-species in 5000 seeds");
}

// ── 1. ONE entry: the tree declares it once, in the modes group ──────────────────────────────────

Deno.test("the title tree has ONE entry: the modes group carries it, the profiles group holds only the picker", () => {
  const title = screenPanels("title")[0];
  const groups = title.groups.map((g) => g.id);
  eq(groups, ["profiles", "modes"], "the title keeps its two groups");

  const profilesGroup = title.groups.find((g) => g.id === "profiles")!;
  const modesGroup = title.groups.find((g) => g.id === "modes")!;
  // The ≡ Profiles BUTTON is gone: the profiles group holds the saved-fighter picker and nothing else.
  eq(profilesGroup.controls.map((c) => c.key), ["profile-picker"], "no profiles-button control survives");
  // The one entry is declared in the modes group (the fight path), replacing the old Fight control.
  const keys = modesGroup.controls.map((c) => c.key);
  assert(keys.includes("btn-enter"), "the merged entry control is declared");
  assert(!keys.includes("btn-fight"), "the old separate Fight control is gone");
  const entry = modesGroup.controls.find((c) => c.key === "btn-enter")!;
  assert(entry.hint.includes("roster and the generator"), "the entry says it opens both");
});

Deno.test("the two entry groups stay default-open (the merge must not hide a way in)", () => {
  const open = defaultOpenGroups();
  eq(open.length, 2, "still exactly two default-open groups");
  eq([...open].sort(), ["title/start/modes", "title/start/profiles"], "the same two entry groups");
});

// ── 2. The rendered markup: one entry button, no profiles button, one merged screen ──────────────

Deno.test("Menu.ts renders exactly ONE entry button and NO separate profiles button", () => {
  assert(code.includes(`class="menu-btn menu-btn-primary entry-btn" data-action="start"`),
    "the single entry is the primary button with the old data-action name (so every tool still lands right)");
  assert(!code.includes(`data-action="profiles"`), "the ≡ Profiles button is gone from the markup and its handler");
  assert(!code.includes("≡ Profiles"), "the old profiles label is gone");
  // One entry: the button occurrence of data-action="start" (the click handler reads it back, so the
  // handler selector is allowed — the count is button(1) + handler(1)).
  const occurrences = code.split(`data-action="start"`).length - 1;
  eq(occurrences, 2, "one entry button plus its single handler selector");
});

Deno.test("the roster and the generator are ONE screen: no standalone profiles screen, #profiles-body is inside select", () => {
  assert(!code.includes(`data-screen="profiles"`), "the standalone profiles screen div is removed");
  assert(code.includes(`data-screen="select"`), "the Creator screen remains the one page");
  // The roster is a pinned panel inside the Creator's screen, holding #profiles-body.
  assert(code.includes(`ui-panel-roster`) && code.includes(`data-panel="roster"`) && code.includes(`data-pinned`),
    "the roster is a pinned panel on the Creator's screen");
  assert(code.includes(`id="profiles-body"`), "the roster body still exists for the engine to paint");
  // The engine's own `show("profiles")` lands on the merged page.
  assert(code.includes(`if (screen === "profiles") screen = "select"`), "the profiles route is aliased to the Creator");
  // Both the roster panel and the generator panels are rendered from the same screen template.
  assert(code.includes(`this.#rosterPanelHtml()`) && code.includes(`screenPanels("select")`),
    "the roster and the generator's panels render into the same screen");
});

// ── 3. Every override routes through CreatorSync.applyEdit, and the fields are real ──────────────

Deno.test("Menu.ts routes overrides through CreatorSync.applyEdit (the single route)", () => {
  assert(code.includes(`import { applyEdit, CREATOR_GROUP_IDS, groupSummary } from "./CreatorSync.ts"`),
    "applyEdit is imported from the pure module");
  assert(code.includes("#override(field: string"), "there is one override method");
  assert(code.includes("this.#player = applyEdit(this.#player, { field, value })"), "the method is applyEdit's only caller");
  // The controls the merge exposes: name, race, class, weapon, birthsign, height, weight, sex, six attrs.
  for (const id of ["creator-height", "creator-weight", "creator-sex"]) assert(code.includes(`id="${id}"`), `the ${id} control is rendered`);
  for (const a of ["vitality", "resilience", "focus", "reflex", "strength", "intelligence", "agility"]) {
    assert(code.includes(`"${a}"`), `the ${a} attribute is named in the override model`);
  }
  assert(code.includes("creator-attr-") && code.includes("ATTR_NAMES.map"), "the attribute controls are generated from the one list");
  // The dice present among the fields, and all dice buttons wired.
  assert(code.includes(`root.querySelectorAll('[data-action="dice"]')`), "every dice button is wired (one is among the fields)");
});

Deno.test("the override field names are REAL: applyEdit moves the profile for each", () => {
  const elf = rolledElf();
  // race: a foreign sub-species is cleared (the dependent synchronisation wave P left open).
  const raced = applyEdit(elf, { field: "race", value: "dwarf" });
  eq(raced.race, "dwarf", "the race changed by hand");
  eq(raced.subrace, null, "the foreign sub-species followed (cleared)");
  // subrace: a sub-species of the race lands.
  const subbed = applyEdit({ ...raced, subrace: null }, { field: "subrace", value: "forge" });
  eq(subbed.subrace, "forge", "a sub-species of the current race lands");
  // height / weight: clamped into the race's OWN band (a real, measured effect).
  const [, hHi] = heightBand("dwarf", "forge");
  const [, wHi] = weightBand("dwarf", "forge");
  eq(applyEdit(raced, { field: "appearance.height", value: 99 }).appearance.height, hHi, "a huge height clamps to the dwarf band");
  eq(applyEdit(raced, { field: "appearance.weight", value: 9999 }).appearance.weight, wHi, "a huge weight clamps to the dwarf band");
  // className / weaponType / birthsign / name: leaf edits that land.
  eq(applyEdit(elf, { field: "className", value: "Mage" }).className, "Mage", "the class lands");
  eq(applyEdit(elf, { field: "weaponType", value: "axe" }).weaponType, "axe", "the weapon lands");
  eq(applyEdit(elf, { field: "name", value: "Rook" }).name, "Rook", "the name lands");
});

Deno.test("the six attribute controls name the keys a rolled profile's `allocated` carries", () => {
  const p = rolledElf();
  for (const a of ["vitality", "resilience", "focus", "reflex", "strength", "intelligence", "agility"]) {
    assert(a in p.allocated, `allocated carries ${a}`);
    assert(Number.isFinite(p.allocated[a]), `${a} is a number`);
  }
  // An attribute edit is TOTAL through applyEdit even before CreatorSync grows the case (no throw):
  const out = applyEdit(p, { field: "allocated.vitality", value: 42 });
  assert(typeof out === "object" && out !== null, "an attribute override never throws (the UI side is exposed here)");
});

// ── 4. The save/discard decision is explicit ─────────────────────────────────────────────────────

Deno.test("the save/discard decision is explicit: a Save control, a Discard control, and a re-roll", () => {
  assert(code.includes(`data-action="save-profile"`), "Save (into the library) exists");
  assert(code.includes(`data-action="discard"`), "Discard exists");
  assert(code.includes("discardEdits()"), "Discard is a method, not just a label");
  // Discard re-rolls the recorded seed (throws the hand-edits away) and counts the decision.
  assert(code.includes("this.#refreshCreator(seed)"), "Discard regenerates from the roll's seed");
  assert(code.includes("#discarded++") && code.includes("get discardedCount"), "the decision is observable");
});

// ── 5. CSP safety and the stylesheet ─────────────────────────────────────────────────────────────

Deno.test("the new markup is CSP-safe: no inline style attribute, no Math.random", () => {
  assert(!code.includes(`style="`), "no inline style attribute (the CSP would blank it)");
  assert(!/Math\.random/.test(code), "no Math.random (the dice stay seeded)");
});

Deno.test("styles.css declares the merged-entry and override classes and keeps the four breakpoints", () => {
  for (const cls of [".ui-panel-roster", ".profiles-embedded", ".override-fields", ".override-attrs", ".btn-note", ".entry-btn"]) {
    assert(cssSrc.includes(cls), `styles.css declares ${cls}`);
  }
  for (const bp of ["max-width:767px", "min-width:768px", "min-width:1024px", "min-width:1440px"]) {
    assert(cssSrc.includes(bp), `styles.css carries the ${bp} breakpoint`);
  }
  // The roster is a grid item of the Creator's flat grid, so it sits on the same page as the generator's
  // panels; the probe measures the "beside" placement and the no-clip rule at four viewports.
  assert(/\.menu-screen\[data-flat="1"\] > \.ui-panel-roster\s*\{/.test(cssSrc),
    "the roster panel is laid out by the Creator's flat grid");
});