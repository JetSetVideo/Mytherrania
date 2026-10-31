// tests/profilepanel_test.ts — lane O-C: the Profiles panel's pure view model.
//
// What is proven here, with no browser:
//   1. the empty library is REAL and actionable (empty.show, its text, its action id);
//   2. rows carry every fact the DOM needs (name, ancestry labels, the raceBanner SVG, the portrait
//      key, calling, level, record, active/selected) and the selected profile's sheet is EXACTLY
//      Wave L's creatorSheet output — the model re-derives no number;
//   3. a stale selectedId falls back to the active, then the first;
//   4. the row CAP applies (500 profiles in, PROFILE_ROW_CAP rows out, count stays the true total);
//   5. a name full of markup characters is carried as DATA and never injected into markup;
//   6. the manage verbs carry their disabled reasons (load/delete on the active row; delete on the
//      last profile);
//   7. the module is pure (no Math.random, no DOM, no inline style attribute, no innerHTML).

import {
  PROFILE_ACTION,
  PROFILE_PANEL_CLASSES,
  PROFILE_ROW_CAP,
  portraitKey,
  profilePanelView,
  type ProfileEntry,
} from "../src/ui/ProfilePanel.ts";
import { creatorSheet } from "../src/ui/CreatorRoll.ts";
import { raceBanner } from "../src/ui/RaceBanners.ts";
import { startingStats } from "../src/game/Leveling.ts";
import { DEFAULT_KEYBINDINGS, type Profile } from "../src/game/Profiles.ts";
import type { CharacterProfile } from "../src/game/Characters.ts";
import type { ClassName } from "../src/game/Stats.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok {
  if (!ok) throw new Error(m);
}

/** A legal-enough character for the sheet maths (allocated comes from the class's own starting stats). */
function char(name: string, race: string, subrace: string | null, className: ClassName, level = 1): CharacterProfile {
  return {
    name,
    race,
    subrace,
    className,
    palette: "Ember",
    birthsign: "mountain",
    level,
    allocated: startingStats(className, race, subrace).allocated,
    appearance: {
      body: "#ef7455", accent: "#dfaa55", height: 1.8, weight: 90,
      hair: "#172128", eyes: "#dfaa55", race, subrace,
    },
  };
}

/** A stored record for that character. */
function profile(playerId: string, name: string, className: ClassName, race: string, subrace: string | null): Profile {
  return {
    playerId, name, className, race, subrace, birthsign: "mountain",
    keybindings: { ...DEFAULT_KEYBINDINGS },
    telemetry: { matches: 0, wins: 0, losses: 0, damageDealt: 0, favouriteClass: null },
    createdAt: "2026-10-31T00:00:00.000Z",
  };
}

/** One library entry, its character built from the same identity. */
function entry(
  playerId: string, name: string, race: string, subrace: string | null, className: ClassName,
  level: number, wins: number, losses: number,
): ProfileEntry {
  const character = char(name, race, subrace, className, level);
  return { profile: profile(playerId, name, className, race, subrace), character, level, matches: wins + losses, wins, losses };
}

const HUMAN = entry("PL-000001", "Aldric", "human", "imperial", "Warrior", 4, 12, 4);
const ELF = entry("PL-000002", "Vex", "elf", "dark", "Rogue", 2, 3, 7);

// ── (a) the empty library ────────────────────────────────────────────────────────────────────

Deno.test("empty library: a real, actionable empty state and no rows", () => {
  const v = profilePanelView({ entries: [], selectedId: null });
  assert(v.empty.show === true, "empty.show must be true");
  assert(v.empty.text.length > 0, "the empty state must say something");
  assert(v.empty.action === PROFILE_ACTION.random, `empty.action ${v.empty.action}`);
  assert(v.rows.length === 0, "no rows for an empty library");
  assert(v.selected === null, "no selection for an empty library");
  assert(v.count === 0, "count 0");
  // The two ways to create survive the empty state (that is the whole point of showing it).
  assert(v.actions.some((a) => a.id === PROFILE_ACTION.random && a.kind === "random"), "a random action");
  assert(v.actions.some((a) => a.id === PROFILE_ACTION.specific && a.kind === "specific"), "a specific action");
  assert(v.actions.every((a) => a.disabled === false), "creation actions are never disabled");
});

// ── (b) two profiles, one selected ───────────────────────────────────────────────────────────

Deno.test("two profiles, one selected: rows, flags, and the sheet is creatorSheet's own output", () => {
  const v = profilePanelView({ entries: [HUMAN, ELF], selectedId: ELF.profile.playerId, activeId: HUMAN.profile.playerId });
  assert(v.count === 2 && v.rows.length === 2, "two rows");
  assert(v.empty.show === false, "not empty");

  const [h, e] = v.rows;
  assert(h.playerId === HUMAN.profile.playerId && h.name === "Aldric", "human row identity");
  assert(h.raceLabel === "Human" && h.subraceLabel === "Imperial", `human ancestry labels: ${h.raceLabel}/${h.subraceLabel}`);
  assert(h.className === "Warrior" && h.level === 4 && h.record === "12 W · 4 L", `human row detail: ${h.className} lv${h.level} ${h.record}`);
  assert(h.banner === raceBanner("human", "imperial"), "the row's banner is raceBanner's own SVG");
  assert(h.banner.includes("<svg") && h.banner.includes("banner-human"), "the banner is a real standard");
  assert(h.portraitKey === portraitKey(HUMAN.character), "the row's portrait key");
  assert(h.active === true && h.selected === false, "the human is active, not selected");
  assert(e.selected === true && e.active === false, "the elf is selected, not active");

  // The selected sheet is EXACTLY creatorSheet(character) — the model re-derives no number.
  assert(v.selected !== null, "a selection exists");
  const sel = v.selected!;
  assert(sel.playerId === ELF.profile.playerId && sel.name === "Vex", "selected identity");
  assert(sel.portraitKey === portraitKey(ELF.character), "selected portrait key");
  assert(sel.sheet === creatorSheet(ELF.character) ? true : JSON.stringify(sel.sheet) === JSON.stringify(creatorSheet(ELF.character)), "sheet deep-equals creatorSheet");
  // Spot-check the numbers are non-empty and drawn from the sheet's own rows.
  assert(sel.sheet.primary.some((r) => r.label === "Vitality" && r.value.length > 0), "a primary row");
  assert(sel.sheet.derived.some((r) => r.label === "Max Health" && r.value.length > 0), "a derived row");

  // Manage verbs present with reasons; load AND delete disabled on the ACTIVE row.
  const byId = (id: string) => sel.actions.find((a) => a.id === id)!;
  assert(sel.actions.length === 4, "four manage verbs");
  assert(byId(PROFILE_ACTION.duplicate).disabled === false && byId(PROFILE_ACTION.rename).disabled === false, "duplicate/rename enabled");
  assert(byId(PROFILE_ACTION.delete).disabled === false, "delete enabled on a non-active row when >1 profile");
  // The selected row here is the ELF (not active) so load is enabled; check the ACTIVE-row rule below.
});

Deno.test("the manage reasons: load/delete off on the ACTIVE row, delete off on the LAST profile", () => {
  // Select the active row: load and delete must be disabled, with the reason on the hint.
  const v = profilePanelView({ entries: [HUMAN, ELF], selectedId: HUMAN.profile.playerId, activeId: HUMAN.profile.playerId });
  const active = v.selected!.actions;
  const load = active.find((a) => a.id === PROFILE_ACTION.load)!;
  const del = active.find((a) => a.id === PROFILE_ACTION.delete)!;
  assert(load.disabled === true, "load is disabled on the active profile");
  assert(load.hint.toLowerCase().includes("active"), `load reason: ${load.hint}`);
  assert(del.disabled === true, "delete is disabled on the active profile");
  assert(del.hint.toLowerCase().includes("active"), `delete reason: ${del.hint}`);

  // The last remaining profile: delete is disabled and its hint names the last-profile rule.
  const one = profilePanelView({ entries: [HUMAN], selectedId: HUMAN.profile.playerId, activeId: HUMAN.profile.playerId });
  const onlyDel = one.selected!.actions.find((a) => a.id === PROFILE_ACTION.delete)!;
  assert(onlyDel.disabled === true, "delete is disabled when only one profile exists");
  assert(onlyDel.hint.includes("last"), `last-profile reason: ${onlyDel.hint}`);

  // Every manage action's kind is "manage" and it also appears in the panel-wide action bar.
  assert(v.actions.filter((a) => a.kind === "manage").length === 4, "the manage verbs appear in the action bar");
  for (const a of active) assert(a.kind === "manage", `kind of ${a.id}`);
});

// ── (c) a stale selectedId ───────────────────────────────────────────────────────────────────

Deno.test("a stale selectedId falls back to the active, then to the first", () => {
  const stale = profilePanelView({ entries: [HUMAN, ELF], selectedId: "PL-GONE", activeId: HUMAN.profile.playerId });
  assert(stale.selected !== null, "still a selection");
  assert(stale.selected!.playerId === HUMAN.profile.playerId, "fell back to the active profile");
  assert(stale.rows.every((r) => r.selected === false), "no row is marked selected when the id is stale");

  // No activeId given either: the fallback is the FIRST entry (libraryEntries orders active first).
  const noActive = profilePanelView({ entries: [HUMAN, ELF], selectedId: "PL-GONE" });
  assert(noActive.selected!.playerId === HUMAN.profile.playerId, "fell back to the first entry");
  assert(noActive.rows[0].active === true, "the first entry reads as active when no activeId is given");
});

// ── row cap ──────────────────────────────────────────────────────────────────────────────────

Deno.test(`the row cap: 500 profiles in, ${PROFILE_ROW_CAP} rows out, count stays 500`, () => {
  const many: ProfileEntry[] = [];
  for (let i = 0; i < 500; i++) {
    many.push(entry(`PL-${String(i).padStart(6, "0")}`, `F${i}`, "human", "imperial", "Warrior", 1, i, 0));
  }
  const v = profilePanelView({ entries: many, selectedId: "PL-000250", activeId: "PL-000000" });
  assert(v.count === 500, `count ${v.count}`);
  assert(v.rows.length === PROFILE_ROW_CAP, `rows capped: ${v.rows.length}`);
  // The selected profile is beyond the cap but the sheet still resolves (selection is independent).
  assert(v.selected !== null && v.selected.playerId === "PL-000250", "a selection beyond the cap still resolves");
});

// ── markup in a name ─────────────────────────────────────────────────────────────────────────

Deno.test("a name with markup characters is carried as DATA, never injected", () => {
  const nasty = `<img src=x onerror="alert(1)">&<script>`;
  const e = entry("PL-BAD", nasty, "human", "imperial", "Warrior", 1, 0, 0);
  const v = profilePanelView({ entries: [e], selectedId: e.profile.playerId, activeId: e.profile.playerId });
  // Carried verbatim as data on the row and the selection — the model builds no HTML from it.
  assert(v.rows[0].name === nasty, `row.name is carried as data: ${v.rows[0].name}`);
  assert(v.selected!.name === nasty, "selected.name is carried as data");
  // It never leaks into any DERIVED display field.
  for (const field of [v.rows[0].raceLabel, v.rows[0].subraceLabel, v.rows[0].className, v.rows[0].record]) {
    assert(!field.includes(nasty) && !field.includes("<"), `derived field leaked markup: ${field}`);
  }
  // The banner comes from the ancestry ids alone — it can never carry the name.
  assert(v.rows[0].banner === raceBanner("human", "imperial"), "the banner is derived from ancestry, not the name");
  assert(!v.rows[0].banner.includes(nasty), "the name is not in the banner");
});

// ── hostile inputs ───────────────────────────────────────────────────────────────────────────

Deno.test("an unknown race: no broken glyph, and the raw id is shown", () => {
  const e = entry("PL-X", "Nobody", "vulcan", null, "Mage", 1, 0, 0);
  const v = profilePanelView({ entries: [e], selectedId: e.profile.playerId });
  assert(v.rows[0].banner === "", "an unknown race yields no banner");
  assert(v.rows[0].raceLabel === "vulcan", "the raw race id stands in for the label");
  assert(v.rows[0].subraceLabel === "—", "no sub-species reads as an em dash, like the sheet");
});

Deno.test("hostile telemetry is total: NaN/negative wins, losses and level", () => {
  const e: ProfileEntry = { ...HUMAN, level: NaN, wins: -3, losses: NaN, matches: 0 };
  const v = profilePanelView({ entries: [e], selectedId: e.profile.playerId });
  assert(v.rows[0].record === "0 W · 0 L", `record ${v.rows[0].record}`);
  assert(v.rows[0].level === 1, `level ${v.rows[0].level}`);
});

// ── class vocabulary ─────────────────────────────────────────────────────────────────────────

Deno.test("the class vocabulary is exposed for the parent and is stable", () => {
  const v = profilePanelView({ entries: [HUMAN], selectedId: HUMAN.profile.playerId });
  assert(v.classes === PROFILE_PANEL_CLASSES, "the view carries the class map");
  for (const [k, val] of Object.entries(PROFILE_PANEL_CLASSES)) {
    assert(typeof val === "string" && val.length > 0, `class ${k} is empty`);
  }
  assert(PROFILE_PANEL_CLASSES.row === "profile-row" && PROFILE_PANEL_CLASSES.panel === "profiles-panel", "key names");
});

// ── purity ───────────────────────────────────────────────────────────────────────────────────

Deno.test("ProfilePanel.ts is pure: no Math.random, no DOM, no inline style, no innerHTML", () => {
  const here = new URL("../", import.meta.url);
  const src = Deno.readTextFileSync(new URL("src/ui/ProfilePanel.ts", here));
  assert(!src.includes("Math.random("), "ProfilePanel.ts calls Math.random");
  for (const dom of ["document.", "window.", "localStorage", "innerHTML", "outerHTML", "insertAdjacentHTML"]) {
    assert(!src.includes(dom), `ProfilePanel.ts touches ${dom}`);
  }
  assert(!src.includes('.setAttribute("style"') && !src.includes(".setAttribute('style'"), "ProfilePanel.ts writes an inline style attribute");
  assert(!src.includes("style="), "ProfilePanel.ts carries a style= string");
});

// ── the recorded views (the evidence) ────────────────────────────────────────────────────────

Deno.test("record the three evidence views to artifacts/profiles/panel-views.json", () => {
  const show = (v: ReturnType<typeof profilePanelView>) => ({
    title: v.title, hint: v.hint, count: v.count,
    empty: v.empty,
    rows: v.rows,
    selected: v.selected ? { playerId: v.selected.playerId, name: v.selected.name, portraitKey: v.selected.portraitKey, sheet: v.selected.sheet, actions: v.selected.actions } : null,
    actions: v.actions,
  });
  const views = {
    empty: show(profilePanelView({ entries: [], selectedId: null })),
    twoSelected: show(profilePanelView({ entries: [HUMAN, ELF], selectedId: ELF.profile.playerId, activeId: HUMAN.profile.playerId })),
    staleSelected: show(profilePanelView({ entries: [HUMAN, ELF], selectedId: "PL-GONE", activeId: HUMAN.profile.playerId })),
  };
  const out = new URL("../artifacts/profiles/panel-views.json", import.meta.url);
  Deno.mkdirSync(new URL("../artifacts/profiles/", import.meta.url), { recursive: true });
  Deno.writeTextFileSync(out, JSON.stringify(views, null, 2));
  console.log(JSON.stringify(views, null, 2));
  assert(views.twoSelected.rows.length === 2, "recorded two rows");
});
