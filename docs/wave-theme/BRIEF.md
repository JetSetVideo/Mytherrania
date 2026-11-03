# Wave THEME — identity-driven styling + a real 3D viewer (frozen contract, swarm protocol)

Repo `~/Desktop/Mytherrania`, base commit 0f7df08 (Wave GEN). Read FIRST
`~/.hermes/skills/software-development/mytherrania-wave/SKILL.md` (CSP: no inline `style=` in innerHTML — use
createElement + Object.assign / CSS classes and custom properties set via `el.style.setProperty`; BUILD_OUT=dist-<lane>;
macOS has no `timeout`; title meter + metal token lessons). Read `docs/wave-z/LAYOUT.md`, `docs/wave-y/UI.md`,
`docs/wave-gen/UI.md` (the + New plate, stage scrubber, drag-to-scrub) and `src/graphics/PreviewScene.ts`.

## The user's ask (voice-transcribed, decoded)
1. **Style follows the variables the character exposes.** Every identity variable gets a material, texture pattern and
   palette, applied to the surfaces that show it (the name plaque, the tags/chips, the viewer frame/sign, the hero card):
   - **Race -> material of the name plaque/background:** Orc = **clay** (fired, cracked earthenware), Elf = **white
     scroll** (pale parchment, rolled ends), Human = **wood** with a visible grain, lighter tones, Dwarf = **stone /
     dark metal-rock** (slate with iron veins).
   - **Sub-race -> its own palette** on the race material, distinct within the race. Orcs: darker palettes, e.g.
     Greenhide dark green, Ironhide iron-grey/rust, Bloodfang dark red — and one of the ork palettes PURPLE (the user
     asked for a purple one: give it to the sub-race it suits best and document why). Dwarves: dark metal / rock tones
     (Mountain granite, Forge ember-black, Deep slate-blue). Humans: woods (Imperial walnut-gold, Nomad sun-bleached
     ash, Islander driftwood-teal). Elves: parchment tints (High ivory-gold, Wood leaf-green ink, Dark ink-violet).
   - **Class -> palette + texture pattern** (e.g. Archer leaf/fletching pattern, Mage arcane sigils, Warrior
     riveted plates, Rogue/Assassin dark leather stitching, Necromancer bone/runes, Priest gilt halo, Barbarian fur/
     scratches) for the class chip and a class accent.
   - **Birth sign -> palette + emblem pattern** on its chip.
   - **Weapon -> palette + pattern** on its chip/socket.
   - **A relation logic between the axes:** each class has typical weapons (Longbow is THE archer weapon) and each
     pair (class x weapon, class x sign, race x class...) is classified **synchronous** (typical pair -> shared/
     harmonised palette), **complementary** (works well -> complementary accent) or **opposite** (atypical -> contrasting
     accent). Pure, data-driven, tested.
2. **3D viewer interactions (Mac trackpad + mouse):** hovering the model shows a grab cursor; **click-drag rotates**
   the character (yaw, and limited pitch); **zoom toward the cursor** when the pointer is over the model (wheel AND
   trackpad pinch — on macOS pinch arrives as `wheel` with `ctrlKey: true`; two-finger scroll as wheel without ctrl),
   clamped, with the page NOT scrolling while zooming over the model (preventDefault only over the model);
   double-click resets. Touch: one-finger drag rotates, two-finger pinch zooms.
3. **Axis gizmo in the TOP-RIGHT corner of the viewer**: a small 3D axes widget that rotates with the camera, **X red,
   Y yellow, Z green** (the user specified Y yellow and Z green; X takes the conventional red), labelled; clicking an
   axis end snaps the camera to look along it (+X/-X/+Y/-Y/+Z/-Z) — "so I can give a direction".

## Lanes (DISJOINT writes; read anything; no git commit/stash/checkout/add -A)

| agent | owns |
|---|---|
| **T — theme system** | new `src/ui/Theme.ts` (pure data + functions), new `src/ui/ThemeTextures.ts` (generated CSS-gradient / SVG-data-URI patterns, CSP-safe: `img-src`/`style-src 'self'` — check index.html CSP; data: URIs in CSS files may be blocked, prefer pure CSS gradients or generated canvas -> blob URL set via CSSOM), `styles.css`, `src/ui/Menu.ts`, `src/ui/ProfilePanel.ts`, `src/ui/LevelBadge.ts`, `src/ui/Icons.ts`, new `tests/wave_theme_test.ts`, new `tools/probe-wave-theme.ts`, `docs/wave-theme/THEME.md` |
| **V — viewer controls + gizmo** | `src/graphics/PreviewScene.ts`, `src/graphics/PortraitStudio.ts`, new `src/graphics/ViewerControls.ts` (pure camera math: orbit, zoom-to-cursor, clamps, snap), new `src/graphics/AxisGizmo.ts`, new `tests/wave_theme_viewer_test.ts`, new `tools/probe-wave-theme-viewer.ts`, `docs/wave-theme/VIEWER.md` |
| **Q — verifier** | only `tools/verify-wave-theme.ts`, `docs/wave-theme/VERIFY.md`, `artifacts/wave-theme/verify/**` |

If V needs DOM around the canvas (gizmo overlay element, cursor classes), V creates it from PreviewScene with
createElement (no innerHTML) and gives it classes T styles; post the class names on the board.

## Contracts
- **C-THEME (T)** `Theme.ts`:
  `type Material = "clay"|"scroll"|"wood"|"stone"|...`; `interface Swatch { base: string; light: string; dark: string; ink: string; accent: string }`;
  `raceTheme(race): { material: Material; label: string }`, `subraceSwatch(race, subrace): Swatch`,
  `classTheme(className): { swatch: Swatch; pattern: PatternId }`, `signTheme(signId)`, `weaponTheme(weaponType)`,
  `relation(kind: "class-weapon"|"class-sign"|"race-class"|"race-weapon", a, b): "synchronous"|"complementary"|"opposite"`,
  `themeFor(profile): ThemeTokens` -> the CSS custom properties applied on the card/plate root
  (`--th-plaque-*`, `--th-chip-class-*`, `--th-chip-sign-*`, `--th-chip-weapon-*`, `--th-relation-*`).
  Every swatch's ink-on-base contrast >= 4.5 (computed, tested). Palettes distinct: min pairwise colour distance within
  a race >= a measured band. Unknown ids -> neutral theme (total function).
- **C-VIEW (V)** `ViewerControls.ts` pure: `orbit(state, dx, dy)`, `zoomAt(state, factor, ndcX, ndcY, hitPoint?)` (the
  point under the cursor stays under the cursor within a tolerance), `clampState`, `snapTo(axis)`, `reset()`. PreviewScene
  wires pointer/wheel/touch/dblclick, raycasts the rig for "cursor over model", exposes QA `debugView()` (yaw, pitch,
  distance, target) and `debugGizmo()` (axis screen positions). Wheel over the model is preventDefault'ed; elsewhere the
  page scrolls normally. Gizmo: X `#e0443a`-ish red, Y yellow, Z green; rendered in a small inset (second scene/
  viewport or an overlay canvas) at the viewer's top-right, rotating with the camera; axis-end click -> `snapTo`.

## Swarm protocol
Board: `BOARD_DIR=artifacts/wave-theme deno run -A tools/board.ts post <FROM> <TO|ALL> <TYPE> "msg"` /
`BOARD_DIR=artifacts/wave-theme deno run -A tools/board.ts read <since> --to <ME>`. CLAIM first; READY with reproduce
commands + numbers; **T reviews V, V reviews T**; **Q verifies every READY** independently in Chrome at 320, 390, 820,
1280, 1920 and 844x390: every race/sub-race/class/sign/weapon renders its theme (computed styles differ as specified;
contrast on pixels >= 4.5), relation classification visible and correct for typical pairs (Archer+Longbow
synchronous), drag rotates (yaw change), wheel/pinch-as-ctrl-wheel zooms toward the cursor (the model point under the
cursor moves < tolerance px), page does not scroll while zooming over the model but does elsewhere, gizmo in the
top-right with the 3 colours and labels, clicking an axis snaps, 0 page errors, no overflow/clipping. Q also inspects
screenshots with `vision_analyze` for "does each race plaque read as its material" (judgement, paired with pixel
measurements). Done when the partner AND Q passed the latest READY, or after 3 rounds. `sleep 150` while waiting.
SPEC pins: T TH1-TH19, V TH20-TH39. Gate: `deno task check`, `deno lint`, your tests + tests importing your modules;
parent runs the full suite and commits.
