# Wave L — creation and menu components (contract)

**The user's ask, verbatim** (voice transcript):

> "improve the components on the pages from the main page to the panel before launching a game. The Races
> and sub races should have icons (like etendards. The character generator should show the model and its
> statistics after clicking on a random dice icon button purple rocky style and refresh the Creator step.
> Options should be visually in their closed tress tha[t]…"

**Decoded** (spoken → decoded → where it lands). The tail of the last sentence is cut off in the
transcript; the decode below is the one I am confident in, and it is flagged in the wave report.

| spoken | decoded | lands in |
| --- | --- | --- |
| "improve the components on the pages from the main page to the panel before launching a game" | polish every component on the title screen and through the whole Create screen (the panel you leave from to enter the ring) | lane L-D (`src/ui/Menu.ts`, `styles.css`) |
| "The Races and sub races should have icons (like étendards)" | every race AND every sub-species gets its own heraldic banner/standard (an *étendard*), drawn from the ancestry data, distinct per sub-species | lane L-A (`src/ui/RaceBanners.ts`), rendered by L-D |
| "character generator should show the model and its statistics after clicking on a random dice icon button, purple rocky style" | a purple, stone/rocky-styled dice **button with a dice icon**; clicking it rolls a complete random fighter AND the Creator then shows that fighter's **3D model** and its **stat sheet** | button + sheet: lane L-D + lane L-B (`src/ui/CreatorRoll.ts`); the model: parent (`src/graphics/PreviewScene.ts` + `Engine.ts`) |
| "refresh the Creator step" | one click refreshes the whole step: the race/sub-species pick, the class, the weapon, the star sign, the palettes, the stat sheet and the model — not just the name | lane L-D (`refreshCreator()`) |
| "Options should be visually in their closed trees tha…" (transcript ends) | the options live in visually **closed** disclosure trees (groups collapsed by default, a count on the header, open state remembered) | lane L-C (`src/ui/UiTree.ts`, `src/ui/Disclosure.ts`), rendered by L-D |

House rules that bind every lane: pure modules where the logic lives (no DOM, no THREE, no
`Math.random`), TDD (the new test file is written with the module), comments say WHY with units, no
`any` without a scoped ignore, **never an inline `style="…"` attribute** (the page runs under
`style-src 'self'`; SVG presentation attributes are fine), and a claim without a tool's literal output
is not evidence. `docs/DESIGN.md` does not exist — the visual contract is the repo-root **`DESIGN.md`**
(palette: ink `#172128`, sand `#dfaa55`, grass `#82b970`, ocean `#4f8490`, coral `#ef7455`, positive
`#a9ce7c`, violet `#a06cd5`), and `src/ui/UiTree.ts`'s `COLOUR_HEX` is the code copy of it.

---

## Lane L-A — `src/ui/RaceBanners.ts` (new) + `src/ui/Icons.ts` (edit) + `tests/racebanners_test.ts` (new)

Own exactly those three files. `src/ui/Icons.ts` is the existing monochrome icon module (24-unit grid,
`icon(name, extraClass)`); extend it, do not restructure it.

```ts
// src/ui/RaceBanners.ts — heraldic standards for the ancestry (pure, no DOM, no THREE)
export const BANNER_WIDTH = 96;
export const BANNER_HEIGHT = 120;          // 4:5, a hanging standard
export type BannerCharge = "laurel" | "sun" | "hammer" | "crown" | "tusk" | "anvil" | "star" | "skull";
export interface BannerPalette { field: string; charge: string; trim: string; }
/** The charge a race bears, from its ancestry (elf = leaf/star, human = crown/sun, dwarf = hammer/anvil, ork = tusk/skull). */
export function bannerCharge(raceId: string): BannerCharge;
/** Field / charge / trim colours for the race, and a sub-species differencing tint. */
export function bannerPalette(raceId: string, subraceId?: string | null): BannerPalette;
/** The full `<svg>` for the race or sub-species standard. Unknown ids return "" (never a broken glyph). */
export function raceBanner(raceId: string, subraceId?: string | null, extraClass?: string): string;
```

Requirements, all testable:

1. **One standard per race and per sub-species**, every one distinct: a sub-species banner carries a
   *differencing mark* (a bordure / chief / pile / bend) chosen deterministically from the sub-species id
   by a documented hash — heraldry calls this cadency, and it is why two nations of one people must not
   fly the same flag.
2. **Ancestry-driven**: read `src/game/Ancestry.ts` (`ANCESTRY`, `ancestryOf`) and
   `artifacts/design/ancestry.json`. The palette echoes the lore the wave before recorded — elves
   bluish, humans sand/warm, dwarves stone, orks green→violet.
3. **Pure and deterministic**: same ids → the identical string; no `Math.random`; no reads of the DOM.
4. **CSP-safe**: presentation attributes only, **no `style=`**, no `<script>`, no external href;
   `viewBox="0 0 96 120"`; `aria-hidden="true"` + `focusable="false"`.
5. The charge must read at 32 px (the chip size) — the tests must assert the charge geometry's
   bounding box is at least 40 % of the field and centred within ±8 units.
6. `Icons.ts`: add the icons this wave needs — at minimum `"dice"` (a pip die, 5-6 units per pip,
   readable at 20 px) and `"chevron-down"` (the closed-tree marker; `chevron-left` already exists).
   Keep `ICON_NAMES`, `PATHS` and the `icon()` contract intact; every existing name must still render.

Evidence: `deno check` for the three files, `deno test --allow-read --allow-write=artifacts tests/racebanners_test.ts`
(whole file, pass count) plus `deno test tests/ic*_test.ts` if such a test exists, and `deno lint`. Report the
literal per-race charge/palette table and the distinctness count (race banners 4 + sub-species banners N, all
distinct as strings).

## Lane L-B — `src/ui/CreatorRoll.ts` (new) + `tests/creatorroll_test.ts` (new)

```ts
// src/ui/CreatorRoll.ts — the character generator's roll and its stat sheet (pure)
export interface RolledProfile { profile: CharacterProfile; seed: number; }
/** A complete random fighter: race AND sub-species, class, a weapon LEGAL for that class, palette,
 *  birthsign, appearance. `rng` is the only source of randomness (seeded callers get the same profile). */
export function rollProfile(rng: () => number): RolledProfile;
export interface SheetRow { label: string; value: string; hint?: string; }
export interface CreatorSheet {
  name: string; raceLabel: string; subraceLabel: string; className: string; weaponLabel: string; signLabel: string;
  primary: SheetRow[];    // the six attributes
  derived: SheetRow[];    // max health, attack power, attack interval, armour
  secondary: SheetRow[];  // the birthsign/sub-species deltas
}
/** The stat sheet for a profile, computed with the REAL game maths. */
export function creatorSheet(profile: CharacterProfile): CreatorSheet;
```

Requirements:

1. **The numbers shown are the numbers fought with**: `creatorSheet` must build on `createStats`,
   `applyRaceBonus`/`computeRaceStats` (`src/game/Races.ts`), `attackDamage`/`attackInterval`
   (`src/game/Stats.ts`) and the secondary-stat deltas (`src/game/SecondaryStats.ts`,
   `src/game/Birthsight.ts`) — not a private re-derivation. A test must compare two rows against the
   source functions directly.
2. **A legal roll**: the class comes from `CLASSES`, the weapon from `weaponForClass`/`weaponMenuOptions`
   (`src/game/Weapons.ts`), and the sub-species must belong to the rolled race (check against `RACES`).
3. **Diversity, measured**: over a fixed seed sequence, all 4 races appear and at least 6 of the 8
   classes appear within 200 rolls; the same seed yields the same profile. Report both numbers.
4. Numbers are formatted with the same grouping the stat bars use (`47 100`, narrow no-break spaces are
   NOT required — a plain space is fine).
5. No DOM, no `Math.random`, no `any`.

Evidence: `deno check`, `deno test --allow-read --allow-write=artifacts tests/creatorroll_test.ts`, `deno lint`,
and a literal sample sheet for one rolled seed pasted in full.

## Lane L-C — `src/ui/UiTree.ts` (edit) + `src/ui/Disclosure.ts` (new) + `tests/disclosure_test.ts` (new)

The options must be *visually closed trees*. `UiTree.ts` already models screens → panels → groups →
controls; this lane gives it the disclosure model and the marker the renderer needs.

```ts
// src/ui/Disclosure.ts — which option groups are open (pure)
export type DisclosureState = Readonly<Record<string, boolean>>;   // group key -> open
/** "select/ancestry/race" — stable key for one group. */
export function groupKey(screen: string, panel: string, group: string): string;
/** Every group starts CLOSED, except the ones the tree marks `defaultOpen`. */
export function initialDisclosure(tree?: UiScreen[]): DisclosureState;
export function isOpen(state: DisclosureState, key: string): boolean;
export function toggleGroup(state: DisclosureState, key: string): DisclosureState;
export function openGroup(state: DisclosureState, key: string, open?: boolean): DisclosureState;
export function openKeys(state: DisclosureState): string[];
/** localStorage round-trip; a corrupt/absent payload yields the initial state, never a throw. */
export function encodeDisclosure(state: DisclosureState): string;
export function decodeDisclosure(raw: string | null, tree?: UiScreen[]): DisclosureState;
```

Plus in `UiTree.ts`: `UiGroup` gains `defaultOpen?: boolean` (absent = false) and a helper
`defaultOpenGroups(): string[]`. Set `defaultOpen: true` on **exactly one** group — `title/start/modes` —
because the entry paths must never be hidden behind a closed tree; every other group in every screen
starts closed. Add a test that asserts that count is exactly 1 and that no `defaultOpen` group is empty.

The renderer contract (lane L-D implements it, so freeze it here):

```html
<details class="opt-group" data-group="select/ancestry/race" data-colour="grass" [open]>
  <summary class="opt-head"><span class="opt-glyph" aria-hidden="true"><!-- icon or banner --></span>
    <span class="opt-label">Race</span><span class="opt-count">1 option</span>
    <span class="opt-hint">Pick the people; the hero panel previews it.</span></summary>
  <div class="opt-body"><!-- the group's controls --></div>
</details>
```
`opt-count` is the number of controls in the group (pluralised); the `open` attribute is set from
`Disclosure`, and toggling a `<details>` writes back through `toggleGroup` + `encodeDisclosure` under the
localStorage key `mytherrania-ui-open`. Native `<details>` is used deliberately: it is keyboard- and
screen-reader-correct for free, and "closed by default" is the *native* state, so the visual default and
the accessibility default cannot drift apart.

Evidence: `deno check`, `deno test --allow-read --allow-write=artifacts tests/disclosure_test.ts` plus the
pre-existing `deno test tests/uitree_test.ts`, `deno lint`, and a literal print of the open/closed state for
every group on the `select` screen.

## Lane L-D — `src/ui/Menu.ts` (edit) + `styles.css` (edit) + `tests/menu_creator_test.ts` (new)

The only lane that writes markup. Consume L-A/L-B/L-C exactly as specified above; if an interface is
missing or wrong, write `artifacts/messages-LD.md` and work around it — do not edit another lane's file.

Build:

1. **The dice button** (`data-action="dice"`, class `dice-btn dice-btn-rocky`, content `icon("dice", "dice-glyph")`).
   Purple, stone/rocky: a violet-to-ink gradient-free treatment using CSS only (`box-shadow` insets for a
   struck-stone face, a chipped/`clip-path` silhouette or a `border-image`-less pseudo-element crack, violet
   `#a06cd5` trim on ink), 44 px minimum hit target, `:hover`/`:focus-visible`/`:active`/`[disabled]` states,
   and it must not use an inline style attribute. It replaces the current plain
   `<button class="menu-btn menu-btn-sm" data-action="random">Random</button>` (keep the `data-action="random"`
   handler working, or move it to the new button — the presets stay).
2. **One click refreshes the whole Creator step** (`#refreshCreator()`): name input, race box + sub-species
   chips + `#race-detail` + `#ancestry-lore`, the class table's `data-selected`, `#class-skills`, the weapon
   table, the palette chips, the birthsign table, `#hero-secondary`, the new stat sheet (`#creator-sheet`)
   from `creatorSheet(rolled.profile)`, and the new preview panel. Then fire the parent's hook
   `cb.onRoll?.(rolled.profile)` so the engine can re-seat the 3D preview.
3. **A Creator preview panel** `data-panel="preview"` (label "Preview", colour `violet`) holding
   `<canvas id="creator-preview" width="360" height="440">` and `<div id="creator-sheet" class="creator-sheet">`,
   plus a `<p class="preview-hint">` explaining that the model is the rolled fighter. The canvas is written by
   the parent (the engine); the panel must not draw into it.
4. **Étendards everywhere the ancestry appears**: `raceBanner(raceId)` as the race box's glyph and
   `raceBanner(raceId, subraceId)` on each sub-species chip (32 px chip, 56 px box), replacing/joining the
   current text-only headers. Each banner needs a visible state for "selected"/"open".
5. **Closed trees** (L-C's contract) for every panel's groups on the `select` screen and for the title
   screen's groups; the panel tabs stay as they are.
6. **Component polish, main page → pre-match panel**: the title screen's buttons, the screen header, the
   panel tabs, `.pick-table` rows, `.palette-chip`, `.field`, `.creator-row` and the "Enter the ring" button
   get consistent spacing (the repo's 4 px scale), radii, hover/focus states and the coral focus ring. Nothing
   may clip at ≤767 / 768–1023 / 1024–1439 / ≥1440 px, and no component may be below 44 px of hit target on
   touch. Keep `docs/DESIGN.md`'s rules (root `DESIGN.md` items 2–8, 17).

Evidence: `deno check`, `deno test --allow-read --allow-write=artifacts tests/menu_creator_test.ts` plus every
pre-existing UI test that touches your files (`deno test tests/*menu*_test.ts tests/*uitree*_test.ts
tests/*panel*_test.ts`), `deno lint`, and a report listing the exact new class names and the `#creator-sheet`
row labels so the parent can photograph them.

---

## Parent (only these files, nobody else touches them)

`src/graphics/PreviewScene.ts` (new), `src/engine/Engine.ts`, `tools/probe-wave-l.ts` (new),
`docs/SPEC.md` §11D, `docs/creation/REPORT.md`, `artifacts/creation/VERIFICATION.md`,
`artifacts/data-science.md` (new pass), the commit.

The parent's job: a live 3D preview of the rolled fighter inside the Creator (its own small
`THREE.WebGLRenderer` on its own canvas, built from the same `buildSkinnedHumanoid` + race appearance the
fight uses), wired to the menu's `onRoll` hook and to the create screen's visibility, plus the wave's
integration, gate, browser evidence and re-pinning of anything this wave makes false.

## Acceptance (the wave is not done until every line has a literal output)

1. Every race and sub-species shows its own distinct étendard.
2. The dice button is purple/rocky, has a dice icon, and one click refreshes the whole Creator step.
3. The Creator shows the rolled fighter's **model** (a live render, not a placeholder) and its
   **statistics** (numbers from the real game maths).
4. Every option group is a closed tree by default, with a count and a remembered open state.
5. `deno task check` 0 errors · `deno task test` all green · `deno lint` clean · `deno task build` ·
   `deno run -A tools/probe-wave-l.ts` with 0 page errors and screenshots at four viewports.
