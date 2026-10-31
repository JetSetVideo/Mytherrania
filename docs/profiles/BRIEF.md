# Wave O — the Profiles panel (contract)

**The user's ask, verbatim:**

> "improve the user experiences from clicking on the main page profile button to a panel where the user can
> generate a random or specified profiles or look at the list of already existing profiles and see their
> models and statistics."

**Decoded, spoken → decoded → where it lands.** No drift to guess at this time; the three capabilities are
plain, and the only thing that needs saying is what "their models" means for a LIST.

| spoken | decoded | lands in |
| --- | --- | --- |
| "clicking on the main page profile button" | the title screen's profile area becomes a BUTTON that opens a panel (today it is a row of chips that silently switches the active profile) | parent (Menu + Engine) |
| "generate a random … profile" | a dice action in the panel that rolls a complete fighter (reusing Wave L's `rollProfile`) and SAVES it as a new profile | lane O-B + parent |
| "or specified profiles" | a path into the existing Creator for a deliberately built fighter, and the ability to load/duplicate/rename/delete saved ones | lane O-B + lane O-C + parent |
| "look at the list of already existing profiles" | every saved profile as a row: name, race + sub-species standard, calling, level, record, and which one is active | lane O-C + parent |
| "see their models and statistics" | EACH row shows a real render of that fighter (a thumbnail from the same rig the arena builds, not the stale `buildHumanoid` portrait), and the selected row shows its full stat sheet | lane O-A (the renderer) + lane O-C (the sheet, reusing Wave L's `creatorSheet`) + parent (the DOM) |

**What already exists — extend it, do not rebuild it.**
- `src/game/Profiles.ts`: `ProfileRepo` (`list`, `active`, `add`, `select`, `update`, `recordMatch`) over an
  injected `Store` (localStorage-shaped), `createProfile(seed, name, className)`, `PROFILES_KEY`, and the
  `Profile`/`ProfileTelemetry`/`Keybindings` types. **A `Profile` does NOT carry the appearance** (no body
  colours, height, weight or hair), which is exactly why "see their models" needs the migration in lane O-B.
- `src/game/Characters.ts`: `CharacterProfile`, `PRESETS`, `PALETTES`, `NPCS`.
- Wave L: `src/ui/CreatorRoll.ts` (`rollProfile(rng)` → a complete legal `CharacterProfile` + seed;
  `creatorSheet(profile)` → the sheet computed by the game's own maths), `src/graphics/PreviewScene.ts`
  (the LIVE turntable rig, built through the same path the arena uses: `raceBuild` → seeded hair/skin/
  silhouette → `buildSkinnedHumanoid` with `{garment, weaponSpec}`), `src/ui/RaceBanners.ts` (`raceBanner`,
  `bannerPalette`), `src/ui/Icons.ts`.
- `src/graphics/Portrait.ts`: `renderPortrait(profile)` — **the stale path**: it calls `buildHumanoid` (a body
  the game no longer renders) and constructs a WHOLE new `WebGLRenderer` per call. It is the reason a list of
  profiles cannot have real thumbnails today (one context per row hits the browser's context limit).
- `src/engine/Engine.ts`: `#refreshProfilePicker()` (`renderProfiles` rows → `#profileRepo.select(id)` →
  `#applyProfile`), and `#applyProfile` builds the live `CharacterProfile`.

House rules binding every lane: pure modules where the logic lives (no DOM, no THREE, no `Math.random`),
TDD, comments say WHY with units, no `any` without a scoped ignore, never an inline `style="…"` attribute
(the page CSP), a claim without a tool's literal output is not evidence.

---

## Lane O-A — `src/graphics/PortraitStudio.ts` (new) + `src/graphics/PreviewScene.ts` (edit: export the rig builder) + `src/graphics/Portrait.ts` (edit: delegate) + `tests/portraitstudio_test.ts` (new)

```ts
/** Build the preview rig a profile renders as — ONE place, shared by the live preview and the studio. */
export function buildPreviewRig(profile: CharacterProfile): { rig: HumanoidRig & SkinnedExtras; fighter: Fighter };

export interface PortraitOptions { size?: number }        // default 256
export class PortraitStudio {
  constructor(options?: PortraitOptions);
  /** A PNG data URL of `profile`, cached by its build key. One renderer, every profile. */
  portraitOf(profile: CharacterProfile): string;
  /** Forget one profile (its appearance changed) or everything. */
  forget(key: string): void;
  clear(): void;
  stats(): { renders: number; cacheHits: number; cached: number };
  dispose(): void;
}
```

Requirements:
1. **ONE `WebGLRenderer` for the whole studio**, created lazily and reused for every portrait. Browsers cap
   live WebGL contexts and `renderPortrait` was burning one per call — a 12-profile list must not need 12.
2. The rig is built by `buildPreviewRig`, the SAME function `PreviewScene` uses, so a thumbnail cannot drift
   from the figure the arena builds. `PreviewScene.setProfile` is refactored to call it (no behaviour change:
   its own build key logic stays).
3. `portraitOf` is deterministic for a given profile: the same profile returns the identical cached string,
   and a second call is a cache HIT (asserted through `stats()`).
4. `Portrait.renderPortrait` becomes a thin delegation to a module-level studio (`new PortraitStudio().portraitOf(profile)`),
   so the sheet screen's PNG is finally the real fighter; keep its export signature.
5. Survive: an unknown race, a zero-size option, a profile whose render throws (return an empty string, do not
   throw), and `dispose()` twice.
6. Frame it like a portrait (head and shoulders, the face readable at 48 px), not a full-body shot: state the
   camera framing in a comment with its units.

**Evidence:** `deno check`, the test file's count, `deno lint`, a printed `stats()` after rendering 12 distinct
profiles and again after re-rendering them, and the byte length of one portrait.

## Lane O-B — `src/game/ProfileLibrary.ts` (new) + `tests/profilelibrary_test.ts` (new)

```ts
export interface ProfileEntry {
  profile: Profile;                 // the stored record
  character: CharacterProfile;      // the CHARACTER it describes (appearance resolved, legacy migrated)
  level: number; matches: number; wins: number; losses: number;
}
/** The library's whole view of the repo: migrated, ordered (active first, then newest). */
export function libraryEntries(repo: ProfileRepo): ProfileEntry[];
/** The appearance a legacy profile needs: deterministic from its name/race/sub-species/calling. */
export function appearanceFor(profile: Profile): Appearance;
/** Roll a complete fighter (lane L's rollProfile) and SAVE it as a new profile. */
export function createRandomProfile(repo: ProfileRepo, rng: () => number, nowIso: string): ProfileEntry;
/** Save a deliberately built character as a new profile. */
export function createFromCharacter(repo: ProfileRepo, c: CharacterProfile, name: string, nowIso: string): ProfileEntry;
export function renameProfile(repo: ProfileRepo, playerId: string, name: string): boolean;
export function duplicateProfile(repo: ProfileRepo, playerId: string, nowIso: string): ProfileEntry | null;
export function deleteProfile(repo: ProfileRepo, playerId: string): boolean;
export function setActive(repo: ProfileRepo, playerId: string): boolean;
export function librarySummary(repo: ProfileRepo): { count: number; names: string[]; activeId: string | null };
```

Requirements:
1. **The migration is the point**: a stored `Profile` has no appearance, so `libraryEntries` resolves one
   deterministically (by name seed + race + sub-species + calling) rather than showing a default body for
   everyone. A profile saved WITH an appearance keeps it. State the precedence in a comment.
2. **Ids stay unique**: 100 rolls in a row must not collide (the id comes from a seed hash), and a collision is
   resolved rather than overwritten.
3. **The library never empties**: deleting the last profile is refused (the game needs an identity), and the
   refusal is a returned `false` plus a documented reason.
4. Rename trims, refuses an empty name, and never changes the id.
5. Everything is pure over the injected repo/store: tests use an in-memory `Store`. Do NOT touch localStorage.

**Evidence:** `deno check`, the test file's count, `deno lint`, a printed library after (roll × 3, rename,
duplicate, delete, setActive) and the printed collision count over 100 ids.

## Lane O-C — `src/ui/ProfilePanel.ts` (new) + `tests/profilepanel_test.ts` (new)

The panel's view model: everything the DOM needs, nothing that touches the DOM.

```ts
export interface ProfileRowView {
  playerId: string; name: string; raceLabel: string; subraceLabel: string; className: string;
  banner: string;                    // the raceBanner SVG for the row's ancestry
  portraitKey: string;               // the key the parent asks PortraitStudio for
  level: number; record: string;     // "12 W · 4 L"
  active: boolean; selected: boolean;
}
export interface ProfilePanelView {
  title: string; hint: string;
  rows: ProfileRowView[];
  empty: { show: boolean; text: string; action: string };
  selected: null | { playerId: string; name: string; sheet: CreatorSheet; portraitKey: string; actions: { id: string; label: string; hint: string }[] };
  actions: { id: string; label: string; hint: string; kind: "random" | "specific" | "manage" }[];
  count: number;
}
export function profilePanelView(o: { entries: ProfileEntry[]; selectedId: string | null; sheetOf?: (c: CharacterProfile) => CreatorSheet }): ProfilePanelView;
```

Requirements:
1. Reuse Wave L's `creatorSheet` for the selected profile's statistics (do not re-derive a number), and
   `raceBanner`/`bannerPalette` for each row's standard.
2. **Two ways to get a new profile, both present**: a `random` action (the dice) and a `specific` action
   (the Creator). Plus per-profile `manage` actions (load, duplicate, rename, delete) — with delete and load
   disabled on the active row when that would be nonsense, and delete disabled when only one profile exists.
3. The empty state is real and actionable: no profiles → `empty.show` true with the text and the action id.
4. Total over the ugly inputs: no profiles, a `selectedId` that does not exist (fall back to the active, then
   the first), one profile, 500 profiles (the view must not build 500 rows of anything expensive — state the
   cap you apply and why), a name with markup characters, a profile with an unknown race.
5. No DOM, no `Math.random`, no `any`. Class names for the parent: list them in your report.

**Evidence:** `deno check`, the test file's count, `deno lint`, the printed view for (a) an empty library,
(b) two profiles with one selected, and (c) the same library with a stale `selectedId`.

---

## Parent (only these files)

`src/ui/Menu.ts` + `styles.css` (the new Profiles screen, the row design, the portrait images, the empty
state, the actions; reachable from the title's profile button), `src/engine/Engine.ts` (the profile library
callbacks: list, roll-and-save, save-from-Creator, load, duplicate, rename, delete; the studio's lifetime and
the portrait fetching; the title button), `tools/probe-wave-o.ts` (new: the click path from the title through
the panel, a roll that appears in the list with a portrait, a load that changes the active profile, a screenshot
at four viewports), `docs/SPEC.md` §11G, `docs/profiles/REPORT.md`, `artifacts/profiles/VERIFICATION.md`,
`artifacts/data-science.md` (new pass), the commit.

Wave N's remaining parent wiring (the cast bar, the combat text, the concealment hide) also lands in
`Menu.ts`/`styles.css`/`Engine.ts`; the parent is the only writer there and serializes the two, so no lane may
touch those three files in this wave.

## Acceptance

1. The title's profile button opens a panel (not a silent switch).
2. The panel lists every saved profile with a real portrait of that fighter, its ancestry standard, calling,
   level and record, and marks the active one.
3. A dice action generates AND saves a random profile which appears in the list at once; a "create specific"
   action reaches the Creator, and saving from there adds it to the list.
4. Selecting a row shows that profile's own statistics and its own model.
5. Load / duplicate / rename / delete work, the last profile cannot be deleted, and ids never collide.
6. `deno task check` 0 errors · `deno task test` green · `deno lint` clean · `deno task build` ·
   `deno run -A tools/probe-wave-o.ts` with 0 page errors and screenshots at four viewports.
