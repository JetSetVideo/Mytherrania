# Lane G — Menu / HUD (R01 Back navigation, R02 birth-sign icons, R09 bottom skill bar)

Status: built and unit-tested. Navigation, icons, and bar layout were checked in a real Chrome
tab on a scratch harness (`file://`, a `deno bundle` of Menu + SkillBar + the project's
`styles.css`). Port 8788 was not used. The live game was **not** rebuilt or checked: the parent
needs to apply the Engine patch, rebuild, and run the mouse path below.

## Files

| File | Change |
|------|--------|
| `src/ui/NavStack.ts` | NEW. Pure history stack. |
| `src/ui/Icons.ts` | NEW. 10 white line icons as inline SVG strings. |
| `src/ui/SkillBar.ts` | NEW. Builds the skill chips once, then patches only changed values. Chips can be pressed with the mouse. |
| `src/ui/Menu.ts` | EDIT. Every screen change goes through NavStack. Back bar on every non-title screen. `back()` for Esc. Birth-sign icons. Buttons `blur()` after a mouse click. Tab colour set through CSSOM. |
| `styles.css` | EDIT. `.icon`, Back bar, birth-sign icon alignment. The old vertical `#hud-skills` block is replaced by a bottom-centre row with 375 / 768 / 1440 / short-landscape rules. |
| `tests/ui_navstack_test.ts` | NEW, 10 tests |
| `tests/ui_icons_test.ts` | NEW, 5 tests |
| `tests/ui_skillbar_test.ts` | NEW, 10 tests, with a write-logging fake DOM (no dependencies) |
| `docs/overhaul/lane-G-engine.patch` | NEW. Unified diff for `src/engine/Engine.ts`. `git apply --check` passes against the current working copy. |

## Exports

`src/ui/NavStack.ts`
- `class NavStack<S extends string>`
  - `constructor(root: S)`
  - `get root(): S`, `get current(): S`, `get depth(): number`, `get canGoBack(): boolean`, `get previous(): S | null`
  - `trail(): S[]`: a copy of the trail, root first
  - `push(screen: S): S`: pushing the current screen does nothing; pushing the root resets to `[root]`
  - `back(): S`: pops one entry, never the root
  - `replace(screen: S): S`: swaps the top entry; the root always stays at the bottom
  - `reset(): S`

`src/ui/Icons.ts`
- `const ICON_STROKE_WIDTH = 1.75`, `const ICON_GRID = 24`
- `type IconName = "serpent"|"mountain"|"flame"|"moon"|"storm"|"void"|"chevron-left"|"dash"|"power"|"defense"`
- `const ICON_NAMES: readonly IconName[]`
- `function icon(name: IconName, extraClass = ""): string`: returns `<svg class="icon icon-<name> …" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">`
- `const BIRTHSIGN_ICON: Readonly<Record<string, IconName>>`, `const SKILL_KIND_ICON: Readonly<Record<string, IconName>>`
- `function birthsignIcon(signId: string | null | undefined, extraClass = ""): string`: returns `""` for an unknown id
- `function skillKindIcon(kind: string, extraClass = ""): string`: an unknown kind gets the power icon

`src/ui/SkillBar.ts`
- `interface SkillView { name; kind; keyLabel; altKeyLabel?; cooldown; cooldownMax; ready; active; art? }`. Times are in seconds. `keyLabel` and `altKeyLabel` come from the caller and are never hard-coded.
- `interface SkillBarOptions { onActivate?: (index: number) => void }`
- `const SWEEP_STEPS = 100`
- `function cooldownText(cooldown: number): string`: `"2.4s"`, or `""` when ready
- `function sweepFraction(cooldown: number, cooldownMax: number): string`: clamped and quantised value written to `--cd`
- `class SkillBar`
  - `constructor(container: HTMLElement, options: SkillBarOptions = {})`
  - `get size(): number`
  - `update(skills: readonly SkillView[]): void`
  - `dockAbove(anchor: HTMLElement, gapPx = 8): void`: a ResizeObserver writes `--skillbar-bottom`
  - `dispose(): void`

`src/ui/Menu.ts` (additions; existing API unchanged)
- `const SCREEN_LABEL: Readonly<Record<Screen, string>>`: breadcrumb labels
- `get screen(): Screen`, `get canGoBack(): boolean`
- `back(): boolean`: closes an open AI profile card first, else returns to the previous screen. Returns false when the menu is hidden or the title is showing. When the step lands on the title, it runs the same path as the "Menu" button (`cb.onMenu()`), so the engine leaves a finished fight.
- `show(screen, opts)` now records history: `"title"` resets the trail, any other screen is pushed.

Routing rules:
- The title's "Fight" now calls `show("select")`, so it is pushed.
- Sheet and digest keep their bottom `data-action="menu"` button, relabelled **"Main menu"** (it jumps to the title). `tools/probe-match.ts` and `tools/qa-matrix.ts` still click `[data-action="menu"]`.
- Victory keeps its "Menu" button.
- The new top-left button is `data-action="back"`.

## Engine.ts integration patch

Apply with `git apply docs/overhaul/lane-G-engine.patch`. It was checked in a scratch copy of the tree: `deno check src/engine/Engine.ts` exited 0. The same change by anchor:

1. **Import**. After `import { LIVE_ARENA_MAX, Menu } from "../ui/Menu.ts";` add:
   ```ts
   import { SkillBar, type SkillView } from "../ui/SkillBar.ts";
   ```
2. **Fields**. After `  #layout = new LayoutDetector();` add:
   ```ts
     /** The bottom-centre skill bar (R09): chips built once, patched each HUD tick. */
     #skillBar!: SkillBar;
     /** Reused per-tick view objects for #skillBar (no allocation once warm). */
     #skillViews: SkillView[] = [];
   ```
3. **`#buildHUD`**. After `    document.body.appendChild(hints);\n    this.#renderHints();` add:
   ```ts
       // Skill bar (R09): one horizontal row at the bottom centre, docked above the hint line.
       // Chips are pressable (mouse-only play); spectators watch, so their presses do nothing.
       this.#skillBar = new SkillBar(document.getElementById("hud-skills")!, {
         onActivate: (i) => { if (!this.#spectate) this.#playerSkill(i); },
       });
       this.#skillBar.dockAbove(hints);
   ```
4. **`#updateHUD`**. Replace the whole block from `    // Skill bar: name, kind, cooldown. The player's own three skills.` down to the `bar.innerHTML = …join("");` block and its two closing braces with:
   ```ts
       // Skill bar: the shown fighter's three skills, patched in place (no innerHTML per tick).
       const shown = this.#spectate ? o : p;
       const rt = this.#skills.get(shown);
       if (rt) {
         const art = this.#skillArt.get(shown);
         const views = this.#skillViews;
         views.length = rt.skills.length;
         for (let i = 0; i < rt.skills.length; i++) {
           const sk = rt.skills[i], cd = rt.cooldowns[i];
           const v = views[i] ??= { name: "", kind: "", keyLabel: "", cooldown: 0, cooldownMax: 0, ready: false, active: false };
           v.name = sk.name;
           v.kind = sk.kind;
           v.keyLabel = String(i + 1); // digits are layout-independent
           v.altKeyLabel = keyLabel(SKILL_LETTER_CODES[i] ?? "", this.#layout.layout); // A/E/F on AZERTY, Q/E/F on QWERTY
           v.cooldown = cd;
           v.cooldownMax = sk.cooldown;
           v.active = rt.active === i;
           v.ready = cd <= 0 && !v.active;
           v.art = art?.[i];
         }
         this.#skillBar.update(views);
       }
   ```
5. **Esc in `#loop`**. Replace `if (this.#input.consume("Escape") && this.#phase === "fight") { … }` with:
   ```ts
       if (this.#input.consume("Escape")) {
         // Esc = Back on a visible menu screen (the title is the floor); during a fight it opens
         // the title, as before.
         if (this.#menu.visible) this.#menu.back();
         else if (this.#phase === "fight") {
           this.#phase = "menu";
           this.#menu.show("title");
           this.#hud.style.display = "none";
         }
       }
   ```
6. **Callbacks** (`onMenu`, `onDigest`, `onSheet`, `onSpectate`): **no change needed**. `Menu.show()` records history itself, and `Menu.back()` reuses `onMenu` when it lands on the title.

## Mouse click path (what the user should see)

1. **Title → Fight.** The creator opens with a **‹ Back** button at the top-left of the panel and the breadcrumb "Menu › Create your fighter". The Back row stays pinned while the panel scrolls. Click **Back** to return to the title.
2. **Title → 📋 History.** The history page has **‹ Back** at the top-left. Click it to return to the title. The bottom button is now labelled "Main menu" and goes to the title.
3. **Title → Fight → "Star sign" tab.** Each row in the sign table has a small **white line icon on the left** of its name. On the **Ancestry** tab, each button in the race detail's "Birth Sign:" row has the same icon on its left. The selected sign's preview header shows the icon instead of an emoji.
4. **Enter the ring.** The three powers sit in **one horizontal row at the bottom centre**, just above the green controls line. Each chip has an icon (or the skill art), a digit badge plus the layout letter (A/E/F on AZERTY), the name, the kind, and a cooldown time. The dark shade drains downward as the skill recharges. Clicking a chip fires that power, but only while the pointer is not captured; see open issue 1.
5. **Win or lose → victory screen.** It has **‹ Back** at the top-left. Click **📋 Sheet**, then **Back** to return to the victory screen. Back again returns to the creator. Back once more returns to the title, and the engine leaves the fight through `onMenu`.
6. **Esc** on any menu screen does the same as Back. Esc on the title does nothing. If an AI profile card is open (History → click a leaderboard row), the first Esc closes the card and the second goes back.

## Verification (real output)

```
$ deno check src/ui/Menu.ts src/ui/Icons.ts src/ui/SkillBar.ts src/ui/NavStack.ts tests/ui_navstack_test.ts tests/ui_icons_test.ts tests/ui_skillbar_test.ts; echo "deno check exit=$?"
Check src/ui/Menu.ts
Check src/ui/Icons.ts
Check src/ui/SkillBar.ts
Check src/ui/NavStack.ts
Check tests/ui_navstack_test.ts
Check tests/ui_icons_test.ts
Check tests/ui_skillbar_test.ts
deno check exit=0

$ deno test --allow-read tests/ui_navstack_test.ts tests/ui_icons_test.ts tests/ui_skillbar_test.ts tests/uitree_test.ts
ok | 30 passed | 0 failed (95ms)

$ deno lint src/ui/Menu.ts src/ui/Icons.ts src/ui/SkillBar.ts src/ui/NavStack.ts tests/ui_navstack_test.ts tests/ui_icons_test.ts tests/ui_skillbar_test.ts
Checked 7 files
lint exit=0

$ git apply --check docs/overhaul/lane-G-engine.patch   (re-run after the parent's R14 commit 5b7d9c9)
patch still applies cleanly

$ (scratch copy of the tree + patch) deno check src/engine/Engine.ts
Check src/engine/Engine.ts
scratch engine check exit=0
$ git apply --check docs/overhaul/lane-G-engine.patch
patch applies cleanly to current Engine.ts
```

The 30 tests are: NavStack 10, Icons 5, SkillBar 10, and the existing uitree 5, which is still green. The SkillBar tests show:
- 1000 identical `update()` calls make **0** DOM writes.
- A cooldown change makes exactly `["nodeValue", "style.setProperty"]` writes, all inside the ticking chip.

**Browser harness** (Chrome, `file://`, real clicks with `click_at_xy`):
- Title → Fight → Back → title.
- Title → History → Back → title.
- Fight → select → (KO) victory: the crumb reads "Menu › Create your fighter › Result".
- → Sheet → Back → victory.
- → History, then Esc three times: digest → victory → select → title, with `onMenu` called.
- Esc on the title: no-op.
- AI card open → Esc closes the card and stays on the digest; the next Esc goes to the title.
- `document.activeElement` is BODY after the clicks, so the buttons were blurred.

**Birth signs:**
- 6 of 6 sign chips and 6 of 6 table rows have `svg.sign-icon`; no emoji remain.
- Computed `color` and `stroke` are `rgb(255, 255, 255)`. The icon is 18×18, left of the label, and its vertical centre is 0.0 px off the label's.

**Skill bar measurements** (after a forced frame; HUD filled with long sample lines):

| Viewport | Bar rect (l,t,r,b) | Gap to #hints | Overlaps | Chip width |
|---|---|---|---|---|
| 375×667 | 8,582,367,623 | 8 px | none | 116 |
| 768×1024 | 64,939,704,991 | 8 px | none | 208 |
| 1440×900 | 310,807,1130,867 | 8 px | none | 267 |
| 667×375 (landscape) | 297,292,657,331, docked bottom-right | 8 px | none (HUD column ends at y=282) | 116 |
| 812×375 | 364,299,802,342 | 8 px | none | 142 |

HUD changes: only `#hud-skills` moved. It is `position:fixed` inside `#hud`, which has no transform, so the fixed position resolves to the viewport. The rest of `#hud` (player, opponent, status, weapons, world, minimap, compass) is unchanged and stays a top-left column. Nothing else sits at the bottom centre. `#btn-settings` is at the top-right.

## Open issues and risks

1. **Clicking a chip vs pointer lock.** A canvas click requests pointer lock. While the pointer is locked, the mouse cannot reach the chips, so clicking a power only works when the pointer is free (before the first canvas click, or after Esc releases it). The parent owns the pointer-lock policy.
2. **Esc with pointer lock.** In Chrome, the Esc that exits pointer lock may never reach the page. The first Esc in a fight might only release the mouse, and a second Esc opens the title. Not verified in the live game.
3. **"Enter the ring" sits below the fold** at 1440×900. The creator scrolls; this was already the case before my change, and the Back row adds about 46 px. A sticky bottom button would fix it; I did not add one because it was not asked for.
4. **The Back route from victory goes to the creator** when the fight was started from the creator. That is the literal history; the "Menu" button still jumps straight to the title. If the user expects victory → title, switch to `replace` in `show("victory")`, which is a one-line change in `Menu.show`.
5. **Fallback reserve without `dockAbove`.** The parent may want to call `dockAbove` again if `#hints` is re-created. Without it, the CSS fallback assumes a 1-line hint (40 px), or 3 lines on phones (64 px).
6. **Not verified in the live game** (port 8788): CSP console output, the real `#skillArt` images, and spectate mode.
7. **`deno.lock` was rewritten twice.** My first test draft imported `jsr:@std/assert`, which added `jsr:@std/assert` / `@std/internal` entries. I removed exactly those entries both times, and `git diff --stat deno.lock` is now empty. The tests use local `assert` helpers and need no dependencies. If the parent sees those entries come back, they are stale and safe to drop.
