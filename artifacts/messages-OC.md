# Lane O-C message — ProfilePanel view model (integration notes)

Lane O-C shipped `src/ui/ProfilePanel.ts` + `tests/profilepanel_test.ts`. Three deliberate,
ADDITIVE extensions to the frozen contract — all supersets; nothing the contract names was removed
or renamed. The parent should know about them.

## 1. `ProfileEntry` is imported from lane O-B (single source of truth)

`ProfilePanel.ts` imports `type { ProfileEntry }` from `../game/ProfileLibrary.ts` (lane O-B) and
re-exports it. At the time this lane started O-B's file did not exist yet; when it appeared its
`ProfileEntry` was checked and is structurally identical ({ profile, character, level, matches,
wins, losses }), so the import was adopted. If O-B's export ever changes shape, fix it in O-B (or
here) — this file is never edited to chase it.

## 2. `profilePanelView` takes one extra optional input: `activeId?: string | null`

The contract signature is `{ entries, selectedId, sheetOf? }`, but `ProfileEntry` carries no
"active" flag, so the view cannot mark the active row without the id. Added
`activeId?: string | null`. When omitted, the FIRST entry reads as active (lane O-B's
`libraryEntries` orders the active profile first, so this is a safe default). The parent should pass
the real value from `librarySummary(repo).activeId`.

## 3. Action objects carry `disabled: boolean` (contract listed only id/label/hint/kind)

The brief requires delete/load to be disabled "with their disabled reasons". Disabled-ness cannot
be expressed by `hint` alone, so each action object is a superset: `{ id, label, hint, kind,
disabled }` at panel level, and `{ id, label, hint, kind, disabled }` inside `selected.actions`
(the contract's `selected.actions` item type had no `kind`/`disabled`; both are additive). `hint`
states what the verb does, or WHY it is off ("Already the active fighter.", "The active fighter
cannot be deleted.", "The last fighter cannot be deleted — the game needs an identity.").

Also additive: `ProfilePanelView.classes` (the exported `PROFILE_PANEL_CLASSES` vocabulary) so the
pure model can name every element the parent builds. `count` is the TRUE total; `rows.length` is
capped at `PROFILE_ROW_CAP` (100).

## For the renderer

Class names to attach (from `PROFILE_PANEL_CLASSES`): `profiles-panel`, `profiles-head`,
`profiles-title`, `profiles-hint`, `profiles-count`, `profiles-actions`, `profile-action` (+
`profile-action-random` / `profile-action-specific` / `profile-action-manage`), `profiles-list`,
`profile-row` (+ state class `is-active` / `is-selected`), `profile-portrait`, `profile-banner`,
`profile-name`, `profile-ident`, `profile-level`, `profile-record`, `profile-sheet`,
`profile-sheet-row`, `profiles-empty`. Row `banner` is an SVG STRING (inject via safe element
construction / a data URL — never build markup by concatenating a name). `portraitKey` is an opaque
cache key for `PortraitStudio.forget` / the element key, never markup.
