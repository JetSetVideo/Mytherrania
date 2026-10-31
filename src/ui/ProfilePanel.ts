// src/ui/ProfilePanel.ts — the Profiles panel's VIEW MODEL (lane O-C).
//
// WHY this module exists: clicking the title screen's profile button must open a panel that lists
// every saved profile with its real model (a portrait), its ancestry standard, calling, level and
// record, and shows the selected profile's own statistics. All of that DECIDING — which rows, which
// one is active, which is selected, what the sheet says, which buttons exist and why one is disabled
// — is pure and lives here, so it is unit-tested in Deno with no browser. The parent (Menu.ts /
// Engine.ts) only renders what this returns and never re-derives a fact.
//
// House rules honoured: no DOM, no THREE, no Math.random, no `any`. Every number comes from the
// game's own maths — the selected sheet is Wave L's `creatorSheet`, the ancestry standard is
// `raceBanner`, and the row labels are the same names `creatorSheet` prints — never a private copy.
// The module emits class names and DATA (a portrait key, an SVG string); it never emits a style
// string and never an inline style attribute (the page runs under `style-src 'self'`, which silently
// blanks anything built from an inline style — a trap the History panel already hit).

import type { CharacterProfile } from "../game/Characters.ts";
import { raceById } from "../game/Races.ts";
import { raceBanner } from "./RaceBanners.ts";
import { creatorSheet, type CreatorSheet } from "./CreatorRoll.ts";
import type { ProfileEntry } from "../game/ProfileLibrary.ts";

// Re-exported so a consumer that only needs the entry shape can import it from the panel too; the
// SINGLE source of truth stays lane O-B's src/game/ProfileLibrary.ts.
export type { ProfileEntry };

/** The action kinds a panel action carries: the dice, the Creator, or a per-profile manage verb. */
export type ProfileActionKind = "random" | "specific" | "manage";

/** One button the parent renders. `disabled` is the truth; `hint` says what it does, or why it is off. */
export interface ProfileAction {
  id: string;
  label: string;
  hint: string;
  kind: ProfileActionKind;
  disabled: boolean;
}

/** One row of the list — everything the DOM needs for a single saved profile. */
export interface ProfileRowView {
  playerId: string;
  name: string;
  raceLabel: string;
  subraceLabel: string;
  /** The calling (class name), e.g. "Warrior". */
  className: string;
  /** The raceBanner SVG for the row's ancestry ("" for an unknown race — never a broken glyph). */
  banner: string;
  /** The key the parent hands to PortraitStudio (and uses as the element's key). */
  portraitKey: string;
  level: number;
  /** "12 W · 4 L". */
  record: string;
  active: boolean;
  selected: boolean;
}

/** The whole panel: what the parent renders, and nothing else. */
export interface ProfilePanelView {
  title: string;
  hint: string;
  rows: ProfileRowView[];
  empty: { show: boolean; text: string; action: string };
  selected: null | {
    playerId: string;
    name: string;
    sheet: CreatorSheet;
    portraitKey: string;
    actions: ProfileAction[];
  };
  actions: ProfileAction[];
  /** The TRUE number of saved profiles (may exceed rows.length — see PROFILE_ROW_CAP). */
  count: number;
  /** The stable class-name vocabulary the parent attaches (see PROFILE_PANEL_CLASSES). */
  classes: typeof PROFILE_PANEL_CLASSES;
}

/** Everything the view model reads. Only `entries` and `selectedId` are required. */
export interface ProfilePanelInput {
  entries: ProfileEntry[];
  /** The row the user selected; a stale id falls back to the active, then the first. */
  selectedId: string | null;
  /**
   * The currently active profile's id. Optional: `libraryEntries` orders the active profile FIRST,
   * so when the caller omits it the first entry is treated as active. The parent supplies the real
   * value from the library's own active id when it has one.
   */
  activeId?: string | null;
  /** Override the sheet computation (tests/other callers); defaults to Wave L's creatorSheet. */
  sheetOf?: (c: CharacterProfile) => CreatorSheet;
}

/**
 * How many rows the model builds. The library is unbounded (a player may roll all day), but each
 * row carries a ~1.3 KB banner SVG and a portrait request, and the parent renders one DOM row and
 * queues one studio render per row. 100 bounds both (≈130 KB of markup, ≤100 one-time renders,
 * which the studio caches) while still covering any realistic hand-built library; `count` stays the
 * true total so the parent can say "showing 100 of N".
 */
export const PROFILE_ROW_CAP = 100;

/** The ids the parent dispatches on. Stable strings, never labels. */
export const PROFILE_ACTION = {
  random: "new-random",
  specific: "new-specific",
  load: "load",
  duplicate: "duplicate",
  rename: "rename",
  delete: "delete",
} as const;

/**
 * The class names the parent attaches to the elements it builds. A pure model cannot set classes,
 * so it names them here — one place, so a rename lands once and the CSP trap (no style attributes)
 * is sidestepped by construction: everything the panel paints is a class or a data field.
 */
export const PROFILE_PANEL_CLASSES = {
  panel: "profiles-panel",
  header: "profiles-head",
  title: "profiles-title",
  hint: "profiles-hint",
  count: "profiles-count",
  toolbar: "profiles-actions",
  action: "profile-action",
  actionRandom: "profile-action-random",
  actionSpecific: "profile-action-specific",
  actionManage: "profile-action-manage",
  list: "profiles-list",
  row: "profile-row",
  rowActive: "is-active",
  rowSelected: "is-selected",
  portrait: "profile-portrait",
  banner: "profile-banner",
  name: "profile-name",
  identity: "profile-ident",
  level: "profile-level",
  record: "profile-record",
  sheet: "profile-sheet",
  sheetRow: "profile-sheet-row",
  empty: "profiles-empty",
} as const;

const TITLE = "Profiles";
const HINT = "Your saved fighters — roll a random one, build a specific one, or select a row to see its statistics.";
const EMPTY_TEXT = "No profiles yet. Roll a random fighter, or build one in the Creator.";

/** A finite, non-negative integer count (a NaN or negative telemetry value reads as 0). */
function count0(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The row's level: an integer, never below 1. */
function level1(n: number): number {
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** The display name of an entry — the stored profile's name, falling back to the character's. */
function displayName(e: ProfileEntry): string {
  const n = (e.profile?.name ?? "").trim();
  return n.length > 0 ? e.profile.name : (e.character?.name ?? "");
}

/**
 * The key PortraitStudio caches a fighter's render under. It mirrors `PreviewScene.setProfile`'s
 * build key verbatim (name|race|sub-race|calling|weapon|height|weight|hair|birthsign) because the
 * rig's seed is derived from the name — so a rename is a DIFFERENT model, and the studio and the
 * live preview must agree on when to rebuild. This is an OPAQUE cache key and an element key: it is
 * never interpolated into markup. Units: height in metres, weight in kilograms, both to 1e-4 m/kg.
 */
export function portraitKey(c: CharacterProfile): string {
  const a = c.appearance;
  return `${c.name}|${c.race}|${c.subrace ?? ""}|${c.className}|${c.weaponType ?? ""}|` +
    `${a.height.toFixed(4)}|${a.weight.toFixed(4)}|${a.hair ?? ""}|${c.birthsign ?? ""}`;
}

/** The ancestry labels for a character, by the SAME lookups `creatorSheet` uses (labels never drift). */
function ancestryLabels(c: CharacterProfile): { raceLabel: string; subraceLabel: string } {
  const race = raceById(c.race);
  const sub = c.subrace ? race?.subspecies.find((s) => s.id === c.subrace) ?? null : null;
  return { raceLabel: race?.name ?? c.race, subraceLabel: sub?.name ?? "—" };
}

/** One row: identity, ancestry standard, the portrait key, level, record, and the two flags. */
function rowView(e: ProfileEntry, activeId: string | null, selectedId: string | null): ProfileRowView {
  const c = e.character;
  const { raceLabel, subraceLabel } = ancestryLabels(c);
  return {
    playerId: e.profile.playerId,
    name: displayName(e),
    raceLabel,
    subraceLabel,
    className: c.className,
    banner: raceBanner(c.race, c.subrace),
    portraitKey: portraitKey(c),
    level: level1(e.level),
    record: `${count0(e.wins)} W · ${count0(e.losses)} L`,
    active: e.profile.playerId === activeId,
    selected: e.profile.playerId === selectedId,
  };
}

/** The two ways to make a new profile — always offered, never disabled. */
function createActions(): ProfileAction[] {
  return [
    {
      id: PROFILE_ACTION.random,
      label: "Roll a fighter",
      hint: "Roll a random fighter and save it to the library.",
      kind: "random",
      disabled: false,
    },
    {
      id: PROFILE_ACTION.specific,
      label: "Create a fighter",
      hint: "Build a specific fighter in the Creator, then save it.",
      kind: "specific",
      disabled: false,
    },
  ];
}

/**
 * The per-profile manage verbs, with their disabled reasons. A load or delete of the ACTIVE profile
 * is nonsense (you are already playing it; you cannot delete your identity) and the LAST profile may
 * never be deleted (the game needs an identity), so the reason rides on `hint` and `disabled` is set.
 */
function manageActions(active: boolean, alone: boolean): ProfileAction[] {
  return [
    {
      id: PROFILE_ACTION.load,
      label: "Load",
      hint: active ? "Already the active fighter." : "Make this the fighter you play.",
      kind: "manage",
      disabled: active,
    },
    {
      id: PROFILE_ACTION.duplicate,
      label: "Duplicate",
      hint: "Copy this fighter into a new profile.",
      kind: "manage",
      disabled: false,
    },
    {
      id: PROFILE_ACTION.rename,
      label: "Rename",
      hint: "Give this fighter a new name.",
      kind: "manage",
      disabled: false,
    },
    {
      id: PROFILE_ACTION.delete,
      label: "Delete",
      hint: alone
        ? "The last fighter cannot be deleted — the game needs an identity."
        : active
        ? "The active fighter cannot be deleted."
        : "Remove this fighter for good.",
      kind: "manage",
      disabled: active || alone,
    },
  ];
}

/**
 * Everything the Profiles panel shows, computed once. Total over the ugly inputs: no profiles, a
 * stale selectedId (falls back to the active, then the first), one profile, 500 profiles (rows are
 * capped), a name full of markup characters (carried as DATA, never injected), and an unknown race.
 */
export function profilePanelView(o: ProfilePanelInput): ProfilePanelView {
  const entries = Array.isArray(o.entries) ? o.entries : [];
  const count = entries.length;

  // The active id: the caller's, else the first entry's (libraryEntries orders the active first).
  const activeId = o.activeId ?? entries[0]?.profile.playerId ?? null;

  // The selection: the named row, else the active, else the first — so a stale id never leaves the
  // panel with nothing shown while profiles exist.
  const selectedEntry = entries.find((e) => e.profile.playerId === o.selectedId)
    ?? entries.find((e) => e.profile.playerId === activeId)
    ?? entries[0]
    ?? null;

  const rows = entries.slice(0, PROFILE_ROW_CAP).map((e) => rowView(e, activeId, o.selectedId));

  const sheetOf = o.sheetOf ?? creatorSheet;
  let selected: ProfilePanelView["selected"] = null;
  let manage: ProfileAction[] = [];
  if (selectedEntry) {
    const c = selectedEntry.character;
    const active = selectedEntry.profile.playerId === activeId;
    manage = manageActions(active, count <= 1);
    selected = {
      playerId: selectedEntry.profile.playerId,
      name: displayName(selectedEntry),
      sheet: sheetOf(c),
      portraitKey: portraitKey(c),
      actions: manage,
    };
  }

  return {
    title: TITLE,
    hint: HINT,
    rows,
    empty: { show: count === 0, text: EMPTY_TEXT, action: PROFILE_ACTION.random },
    selected,
    // The full ordered action set the panel offers: the two ways to create, then (when a profile is
    // selected) its manage verbs — one bar the parent can render without knowing the taxonomy.
    actions: [...createActions(), ...manage],
    count,
    classes: PROFILE_PANEL_CLASSES,
  };
}
