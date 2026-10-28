# Lane U — Menu / HUD / Settings (W01, W02, W03, W04)

Status: lane files done and tested; the Engine/MatchHistory patch is written, type-checked and
browser-tested on a **scratch copy** (`git apply --check` passes on the live tree). Nothing
committed, nothing built in the project, port 8788 untouched.

## Files

| File | Change |
|------|--------|
| `src/ui/AncestryState.ts` | NEW — pure accordion state (one box open, sub-species selects its race, merged label, arrow-key roving) |
| `src/ui/SettingsPanel.ts` | NEW — settings model (schema, validation, versioned storage, pure helpers) + `SettingsPanel` class (icon gear, modal dialog, give-up confirm, focus trap) |
| `src/ui/Menu.ts` | EDIT — Ancestry accordion replaces race grid + separate sub-species nest; `LIVE_ARENA_MIN` derived; arena slider starts at the minimum; title **Settings** button (`onSettings`); creator name input escaped |
| `src/ui/Icons.ts` | EDIT — 6 new line icons: `gear`, `flag`, `play`, `restart`, `home`, `close` |
| `styles.css` | EDIT — top-right corner (minimap + gear + compass), settings dialog, accordion, `#hints.is-hidden` |
| `tests/ui_settings_test.ts` | NEW — 12 tests, own fake DOM |
| `tests/ui_ancestry_test.ts` | NEW — 7 tests |
| `tests/ui_arena_size_test.ts` | NEW — 3 tests (W04 derivation and clamps) |
| `docs/overhaul/lane-U-engine.diff` | NEW — exact patch for `src/engine/Engine.ts` + `src/game/MatchHistory.ts` (`git apply` it) |
| `docs/overhaul/lane-U-engine-patch.py` | NEW — the same patch as 31 anchor → code pairs; each anchor must match exactly once |

## Exports

`src/ui/AncestryState.ts`
- `interface AncestryRace { id; name; subspecies: readonly { id; name }[] }`; `interface AncestryState { expanded: string | null; race: string; subrace: string | null }`
- `interface SubraceChipView { id; name; selected }`; `interface RaceBoxView { raceId; label; expanded; selected; chips }`
- `const MERGE_SEPARATOR = " · "`
- `initialAncestry(races, race: string, subrace: string | null): AncestryState`
- `toggleRace(state, raceId: string, races): AncestryState`
- `selectSubrace(state, raceId: string, subraceId: string, races): AncestryState`
- `mergedName(raceName: string, subraceName: string | null | undefined): string` — "Human · Imperial", but "High Elf" (not "Elf · High Elf")
- `headerLabel(state, raceId: string, races): string`; `ancestryView(state, races): RaceBoxView[]`
- `nextHeaderIndex(current: number, key: string, count: number): number | null`

`src/ui/SettingsPanel.ts`
- Types: `KeyboardLayoutName`, `LayoutChoice`, `CameraChoice`, `MinimapChoice`, `EffectsLevel`, `QualityChoice`, `PanelContext = "menu" | "fight" | "spectate"`, `SettingRule`, `StorageLike`
- `interface GameSettings { layout; mouseSensitivity; invertY; camera; firstPerson; fov; minimap; effects; showHints; quality; volume }`
- `SETTINGS_STORAGE_KEY = "mytherrania.settings"`, `SETTINGS_VERSION = 1`, `SETTINGS_SCHEMA`, `SETTING_KEYS`, `DEFAULT_SETTINGS`
- `clampToRule(value, {min,max,step}): number`, `sanitizeSettings(raw: unknown): GameSettings`, `parseStoredSettings(text): GameSettings`, `serializeSettings(s): string`, `loadSettings(storage | null): GameSettings`, `saveSettings(storage | null, s): boolean`
- `PIXEL_BUDGETS` (auto 4 000 000, high 3840×2160, low 1280×720) + `pixelBudgetFor(q): number`
- `EFFECTS_DENSITY_SCALE` (low 0.6, normal 1, high 1.5) + `effectsDensityScale(level): number`
- `BASE_LOOK_RADIANS_PER_PIXEL = 0.003`, `lookRates(s): { yaw; pitch }` (pitch negative when inverted)
- `CLOSE_CAMERA_FOV_OFFSET = 10`, `fovFor("close" | "third", s): number`
- `effectiveLayout(choice, detected): KeyboardLayoutName`, `layoutName(l): string`
- `ESCAPE_GRACE_MS = 250`, `GIVE_UP_QUESTION = "Give up this fight? Your rival wins."`
- `interface SettingsCallbacks { onResume(); onGiveUp(); onRestart(); onMainMenu(); onChange(settings: GameSettings); onOpen?() }`
- `interface SettingsPanelOptions { storage?: StorageLike | null; detectedLayout?; gearContainer?: HTMLElement; now?: () => number }`
- `class SettingsPanel` — `constructor(container: HTMLElement, callbacks: SettingsCallbacks, options?: SettingsPanelOptions)`; `readonly button / dialog / backdrop`; getters `isOpen`, `isConfirming`, `context`, `settings`; `open()`, `close()` (= resume), `toggle()`, `handleEscape(): boolean`, `requestGiveUp()`, `confirmGiveUp()`, `cancelGiveUp()`, `setContext(ctx: PanelContext)`, `setDetectedLayout(layout)`, `update(patch: Partial<GameSettings>)`, `focusOrder(): HTMLElement[]`

`src/ui/Menu.ts` (new exports)
- `ARENA_SIZE_STEP = 2`, `interface ArenaMinimumTerms`, `liveArenaMinimum(): ArenaMinimumTerms`
- `LIVE_ARENA_MIN` (= 34), `clampLiveArenaSize(size: number): number`, `arenaSizeFromSlider(value: number): number | null`, `ARENA_SLIDER_RANDOM` (= 32)
- `MenuCallbacks.onSettings?(): void`

## W04 — the minimum arena, derived

Along a line from the centre to the wall, one fighter's half of the field must hold:

```
half = spawnOffset + longestDash + throwSpeed × slideTime + (largestProp + 2·bodyRadius) + bodyRadius
     =     2.5     +     3.4     +       7 × 0.7          +        (3.8 + 1.0)        +    0.5      = 16.1 m
LIVE_ARENA_MIN = ceil(2 × half / step) × step = ceil(32.2 / 2) × 2 = 34 m      (was 8 m: 4.25× wider, 18× the area)
```

Sources: spawn ±2.5 m (`Engine.#startFight`), longest skill lunge (`ALL_SKILLS`, Assassin 3.4 m),
the ragdoll threshold 7 m/s (`Engine.#tickWorld`) decaying as `v·exp(-dt/stop)` on stone
(`surfaceFor("stone").stop` = 0.7 s, so it slides v × stop), the widest prop (arch, r 1.9 m),
body radius 0.5 m. The dash, slide and prop terms are read live from the game data; 2.5, 7 and 0.5
are copies of Engine privates (keep in sync). Slider: `min = 32` = "random" notch, then 34…120 m.

## Engine.ts patch (apply `docs/overhaul/lane-U-engine.diff`)

| # | Anchor (first line) | What it does |
|---|---------------------|--------------|
| 1 | `import { LIVE_ARENA_MAX, Menu } from "../ui/Menu.ts";` | import `clampLiveArenaSize`, SettingsPanel + helpers |
| 2 | `function renderPixelRatio(cssW: number, cssH: number): number {` | `budget = PIXEL_BUDGET` parameter; `type MatchEndReason = "ko" \| "forfeit"` |
| 3 | `#frozen = false; // QA: pause…` | fields `#paused`, `#endReason`, `#settings`, `#layoutChoice`, `#look`, `#pixelBudget`, `#fxScale` |
| 4 | `onMenu: () => { this.#phase = "menu"; …` | `onMenu: () => this.#leaveToTitle()`, `onSettings` opens the panel in "menu" context |
| 5 | `this.#renderer.setPixelRatio(renderPixelRatio(w, h));` | resize uses `#pixelBudget` |
| 6 | `FX_DENSITY.value = fxDensityForLuminosity(…)` | `* this.#fxScale` |
| 7 | `const chosenSize = …` / `Math.max(8, cfg.size)` | `if (this.#arenaOverride?.size === undefined) cfg.size = clampLiveArenaSize(cfg.size);` |
| 8 | `this.#phase = "fight"; this.#winner = null;` | reset `#endReason`, `#paused`; `setContext(spectate ? "spectate" : "fight")` |
| 9 | keydown `if (isTyping(e.target)) return;` | while the dialog is open only Esc gets through; V/M go through `settings.update` (persisted); `pointerlockchange` mid-fight opens the panel (the browser spends Esc on releasing the lock) |
| 10 | old `⚙` text button in `#buildHUD` | removed; minimap click persists its mode to the settings |
| 11 | `#renderHints` / `skillKeyLabel` / HUD `altKeyLabel` | labels via `#keyLayout()` = override or detected; hint text "M: Map … Esc: Pause" |
| 12 | `#buildSettings()` body | `new SettingsPanel(document.body, …, { gearContainer: this.#hud, detectedLayout })`; new `#setPaused`, `#leaveToTitle`, `#onEscape`, `#applySettings` |
| 13 | `#playerSkill` / `#playerAttack` guards | `|| this.#paused` |
| 15 | `#checkElimination` winner block | becomes `#endMatch(winner, reason)`; new `#forfeit()` → `#endMatch("opponent", "forfeit")`; a forfeit skips `brain.adapt`; result text "X gave up against Y … after N s" |
| 16 | `#loop`: `const dt = …getDelta()…` and the Esc block | `dt = #paused ? 0 : …` (getDelta still runs: no jump on resume); Esc → `#onEscape()`; fight block, arena physics, `#checkElimination`, `#tickWorld` gated by `!this.#paused` |
| 17 | `this.#orbitYaw -= md.x * 0.003;` | `#look.yaw` / `#look.pitch` (sensitivity, invert Y) |
| 18 | `#recordMatch` `reason: "ko"` / state `endReason` | `this.#endReason ?? "ko"` |
| MH | `export type WinReason = "ko" \| "ring-out" \| "timed" \| "koth";` (MatchHistory.ts) | add `\| "forfeit"` |

Esc order (`#onEscape`): settings open → back out one level (confirm → panel → resume; an Esc
within 250 ms of opening is swallowed, so the pointer-lock-release press cannot also resume);
else a menu screen → Back; else a live fight → pause + open settings.

## Mouse click paths (French AZERTY Mac, mouse only)

1. **Race + sub-species in one box (W01):** title → **⚔ Fight** → *Create your fighter* opens on
   **Ancestry**. Click a race box, e.g. **Elf**: it opens in place, the others close, and its
   sub-species appear inside it. Click **Wood Elf**: the header now reads **Wood Elf** (Human reads
   e.g. **Human · Nomad**), and the box outline and the chip are both coral. Click the header again
   to close it (the choice stays). The stats, lore and birth signs are still below.
2. **Pause / settings during a fight (W02, W03):** click the **gear** at the top right (just left of
   the minimap) → the fight freezes and **Paused** opens. Or press **Esc**: if the cursor is
   captured, the browser releases it and the game pauses. Close it with **Resume**, the **X**, or
   **Esc**.
3. **Give up:** gear → **Give up** → *"Give up this fight? Your rival wins."* → **Yes, give up** →
   the **Defeat** screen reads "… gave up against … after N s". **No, keep fighting** goes back.
4. **Restart / Main menu:** gear → **Restart** or **Main menu**.
5. **Options:** gear (or title → **Settings**) → **Controls**: Keyboard layout *Auto (detected:
   AZERTY)* / AZERTY / QWERTY / QWERTZ, Mouse sensitivity, Invert vertical look → **Camera**:
   Camera, First-person view (V), Field of view → **Display**: Minimap view (M), Effects
   Low/Normal/High, Show control hints, Quality Auto (4 Mpx) / High (4K) / Low (720p) → **Audio**:
   Master volume. Every change applies and saves at once.
6. **Bigger minimum arena (W04):** Create your fighter → **Arena** tab → **Size**: the far left
   reads *random*, the first notch is **34 m**, the slider goes up to 120 m. A random arena is
   never smaller than 34 m either.

## Commands run (real output)

```
$ NO_COLOR=1 deno check src/ui/*.ts tests/ui_settings_test.ts tests/ui_ancestry_test.ts tests/ui_arena_size_test.ts
deno check exit=0
$ deno test --allow-read tests/ui_*_test.ts tests/uitree_test.ts
running 7 tests from ./tests/ui_ancestry_test.ts
running 3 tests from ./tests/ui_arena_size_test.ts
running 5 tests from ./tests/ui_icons_test.ts
running 10 tests from ./tests/ui_navstack_test.ts
running 12 tests from ./tests/ui_settings_test.ts
running 10 tests from ./tests/ui_skillbar_test.ts
running 5 tests from ./tests/uitree_test.ts
ok | 52 passed | 0 failed (239ms)
$ deno lint src/ui styles.css
Checked 13 files                       (deno lint skips .css: styles.css is NOT linted)
$ git apply --check docs/overhaul/lane-U-engine.diff
git apply --check: clean
# scratch copy (src + deno.json + lock, patch applied by lane-U-engine-patch.py):
$ python3 engine_patch.py proj/src/engine/Engine.ts proj/src/game/MatchHistory.ts
proj/src/engine/Engine.ts: 30 replacements applied
proj/src/game/MatchHistory.ts: 1 replacements applied
$ deno check main.ts src/**/*.ts        -> deno check exit=0, 0 error lines
$ deno lint src/engine/Engine.ts        -> Checked 1 file
```

`tests/ui_arena_size_test.ts` prints: `LIVE_ARENA_MIN = 34 m (half 16.10 m: spawn 2.5 + dash 3.4 + slide 4.90 + prop 3.80 + 3r 1.5)`.

## Browser verification (Chrome via CDP, file:// pages in the scratch dir, real mouse clicks)

**Lane harness** (real Menu + SettingsPanel + SkillBar, a copy of `#buildHUD`'s DOM):

| Viewport | gear (l,t,w) | minimap (l,t,size) | gap gear→map | gap text column→gear | overlaps | gear / map hit-test |
|----------|--------------|--------------------|--------------|----------------------|----------|---------------------|
| 375×812 | 201,8,40 | 247,8,120 | 6 | 6 | none (fresh load) | ok / ok |
| 768×1024 | 516,12,44 | 568,12,184 | 8 | 77 | none | ok / ok |
| 1280×720 | 1028,12,44 | 1080,12,184 | 8 | 589 | none | ok / ok |
| 1440×900 | 1148,12,48 | 1204,12,220 | 8 | 612 | none | ok / ok |
| 1920×1080 | 1628,12,48 | 1684,12,220 | 8 | 1092 | none | ok / ok |
| 812×375 (short landscape) | 628,8,40 | 676,8,120 | 8 | 189 | none | ok / ok |
| 667×375 (short landscape) | 493,8,40 | 539,8,120 | 6 | 62 | none | ok / ok |

Placement: the compass line (`Rival NE · 12 m · explored 34%`) sits under the minimap (top =
map bottom + 4 px), at the minimap's width. The world line stays in the left column, which is now
shorter because the 120–220 px map left it. Dialog: 760 px wide at 1440, one column below 768 px,
scrolls inside itself at 375×812 (913/784 px) and 812×375 (571/359 px).

Mouse paths in the harness: gear → *Paused*, focus on Resume; Give up → confirm, focus on **No**;
No → back, focus on Give up; Give up → Yes → `["open","giveup"]` (no resume); Resume → `resume`;
Esc → `resume`. Clicking the label of *Invert vertical look* checked it; clicking at 90% of the
FOV slider set 87° and saved `{"v":1,…}`. Accordion: Elf → `SE "High Elf"`, Wood Elf →
`"Wood Elf"`, Elf again → closed but still selected, Dwarf → `"Dwarf · Mountain"`, Deep →
`"Dwarf · Deep"`. Opening height samples 53 → 83 → 89 → 91 → 92 px over about 200 ms (animated, not a
jump). With reduced motion the box is fully open 30 ms after the click. Arrow Down/End/Home rove
the headers; Enter toggles. Title → Settings opens *Settings* with **Close** and Give up disabled.

**Patched engine, scratch bundle** (copy of `src/` with `lane-U-engine.diff` applied; telemetry's
`navigator.sendBeacon` stubbed because file:// refuses beacons — unrelated to this lane):
- Title → Fight → Elf → Wood Elf → Enter the ring: player `elf/wood`, arena `size: 34`
  (a random size clamped up to the minimum).
- Esc at elapsed 2.6 s → panel *Paused*; 2 s later elapsed is still **2.7**, the truce still reads
  **3.3 s**, and the AI is still at (2.843, 1.598). Esc again → resumed: elapsed 4.0, the AI moved.
- Gear (48 px, text "", hit-test = `btn-settings`) → Give up → Yes → `winner: "opponent"`,
  `endReason: "forfeit"`, screen *Defeat*, "Sir Aldric gave up against Ser Vail (Warrior) after
  11.4s — …", stored history `reason: forfeit`.
- Title → Settings: *Show control hints* off → `#hints` display none (back on → block);
  Quality at DPR 2 on 1440×900: low → ratio 1, high → 2, auto → 1.756 (= √(4 Mpx / 1.296 Mpx)).
- No page errors after the stub.

## Not done / not verified / risks

- **Pointer lock (mouse-only players):** clicking the canvas still captures the cursor (Engine
  `#wireInput`, unchanged), which hides the gear until Esc. Esc now pauses, so the gear is never a
  dead end. The `pointerlockchange` → pause path is code only: automation cannot take a real
  pointer lock. The 250 ms duplicate-Esc grace is unit-tested. Suggestion for the parent: do not
  request pointer lock on a plain click.
- **Wall-clock timers during a pause:** pickup buffs expire on `performance.now()`
  (`tickBuffs(…, nowS)` in the loop), so they keep running while paused. Audio is not suspended.
  AI position was verified frozen; any AI timer on wall-clock time was not audited.
- Mouse sensitivity and invert Y act on the third-person orbit only, the only mouse-look camera.
- The minimap mode stays in sync through the M key and the map click (patch #9/#10). `Minimap`
  has no mode-change callback.
- With hints hidden, `SkillBar.dockAbove` falls back to its CSS reserve (40 px; 64 px on phones).
  Lane G issue, seen only after an emulated resize: `dockAbove` re-measures only when `#hints`
  changes size, so the skill bar overlapped `#hints` once after 1280 → 375. A fresh load at 375
  was clean (skills bottom 768 < hints top 776).
- **W04 side effects:** closet (2–5 m) and pit (6–14 m) archetypes are now always clamped to 34 m.
  They used to be clamped to 8 m. They lose their cramped character, and a closet keeps its low
  ceiling over 34 m; lane E or the parent may want to drop those archetypes from live play.
  Bigger arenas mean more terrain and fog cells: re-measure R13 frame cost.
- Older issue, not fixed: two elements have `id="hero-secondary"` (the sign panel and the race
  detail).
- QA tools: `.race-card[data-race]` still exists (on the box headers). `.subrace-chip` is now inside
  the boxes, and only the open box's chips can be clicked. `#settings-dialog #sel-camera`
  (+ `change` event, as `tools/browser-ring.ts` and `qa-screenshots.ts` do), `#rng-volume`,
  `#btn-settings` and `#btn-close-settings` keep their ids.
- `SettingsPanel.ts` is about 31 KB, above the brief's 20k-per-write guideline (written in one
  pass).
