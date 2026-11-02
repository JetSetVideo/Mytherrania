# Wave Z — the Fighters menu (frozen contract, swarm protocol)

Repo `~/Desktop/Mytherrania`. Read `~/.hermes/skills/software-development/mytherrania-wave/SKILL.md` first (CSP: no
inline `style=` in innerHTML; rebuild before probing: `BUILD_OUT=dist-<lane> deno task build`; macOS has no `timeout`).
Base: Wave Y (commit ef4fdf4) — read `docs/wave-y/UI.md` (hero card, action bar, level coin, metal/stone tokens,
`.btn-stone`, equipment sockets, weapon picker) and `docs/wave-x/UI.md` (ValueTone `toneFor`, CreatorTweak, steel sign).

## The user's ask (voice-transcribed, decoded)
1. Improve every element of the **Fighters** page (hero tabs + hero card + the "+ New" generator) and make it fit every
   screen size (320, 390, 820, 1280, 1920, 2560 px wide; also landscape phone 844x390).
2. Delete the panel head "Chosen hero — Figure, record, statistics." (Menu.ts ~1007) — not needed.
3. The "Reroll hero" button becomes **"Roll"**: back to the PURPLE stone texture, bigger icon, smaller margin/padding.
4. The 3D model viewer: a better ground (stone floor/plinth), shadows under the characters, light from straight above.
5. Hero card: the picture (portrait/3D) takes the WHOLE card background; the name and tags (race, sub-race, class,
   sign...) FLOAT over it (legible: scrim/shadow), not above it.
6. Attributes show their **game-computed modifier in parentheses**: e.g. `Agility 14 (+2)` — the +/- is computed from
   the game statistics (vs the class/race baseline or the neutral reference the game uses), coloured with `toneFor`.
7. **Many more derived statistics**, each with its (+/-) in parentheses, no explanatory text needed: max health, max
   mana, max stamina, health/mana/stamina regeneration, attack power, attack interval / attacks per second, armour,
   crit chance, movement speed, turn rate, dodge, dash, recovery, cast speed, mana cost, cooldown factor, wound/fatigue
   resistance (Potential.ts), mass, reach... EVERYTHING the game really computes (find it in src/game: Stats, Races,
   SecondaryStats, Resources, Potential, Agility, Physics, PowerCost, Cast, Leveling, Birthsight, Skills). Only show
   numbers the game really uses; each value = the game's own function.
8. Level: TOP-LEFT corner of the hero card, written `LV` with the number to its right (`LV 12`). The badge's metal
   follows the level: bronze -> copper -> silver -> gold -> platinum, spread over levels 1..20 (MIN/MAX_LEVEL in
   src/game/SpectateGen.ts): 1-4 bronze, 5-8 copper, 9-12 silver, 13-16 gold, 17-20 platinum (pure function).

## Lanes and ownership (DISJOINT writes; read anything)

| agent | owns |
|---|---|
| **F — Fighters layout** | `src/ui/Menu.ts`, `src/ui/ProfilePanel.ts`, `src/ui/HeroReroll.ts`, `styles.css`, `index.html`, new `src/ui/LevelBadge.ts`, `tests/ui_*`, `tests/menu_*`, new `tests/wave_z_layout_test.ts`, new `tools/probe-wave-z-fighters.ts`, `docs/wave-z/LAYOUT.md` |
| **S — derived statistics** | new `src/game/DerivedSheet.ts` (pure), new `src/ui/StatSheet.ts` (pure HTML-string renderer, no inline style), `src/ui/CreatorRoll.ts`, new `tests/wave_z_stats_test.ts`, `docs/wave-z/STATS.md` |
| **G — viewer** | `src/graphics/**` (PreviewScene, PortraitStudio, Portrait*, PortraitBackdrop, Environment...), new `tests/wave_z_viewer_test.ts`, new `tools/probe-wave-z-viewer.ts`, `docs/wave-z/VIEWER.md` |
| **V — verifier** | writes ONLY `docs/wave-z/VERIFY.md`, `tools/verify-wave-z.ts`, `artifacts/wave-z/verify/**`; reads and runs everything |

Nobody runs `git commit`, `git stash`, `git checkout`, `git add -A`. Engine.ts is the parent's: write requests on the board.

## Contracts
- **C-SHEET (S)** `DerivedSheet.ts`: `derivedSheet(profile: CharacterProfile): { attributes: Row[]; derived: Row[] }` with
  `interface Row { key: string; label: string; value: number; display: string; delta: number; deltaDisplay: string; unit?: string; group: "pools"|"offence"|"defence"|"mobility"|"magic"|"body" }`
  — `delta` = value minus the reference (S documents the reference per row; it must be computed by the game's own
  functions). `src/ui/StatSheet.ts`: `statSheetHtml(sheet, opts?: { compact?: boolean }): string` producing rows
  `<div class="zs-row" data-key data-group><span class="zs-label"></span><span class="zs-value"></span><span class="zs-delta" data-tone="<delta>" data-tone-span="..."></span></div>`
  grouped in `<section class="zs-group" data-group>`; the caller runs `paintTones(el)` (ValueTone) after insertion.
  Delta format: `(+2)`, `(−0.3)`, `(0)` with a real minus sign; integers when the value is integer-like, else 1-2 dp.
- **C-LV (F)** `LevelBadge.ts`: `levelTier(level): "bronze"|"copper"|"silver"|"gold"|"platinum"` (bands above) and
  `levelBadgeHtml(level): string` -> `<span class="lv-badge" data-tier="..."><span class="lv-label">LV</span><span class="lv-num">12</span></span>`.
- **C-VIEW (G)** viewer public API unchanged; F places DOM over it. G owns the floor, shadows, top light and the
  portrait image quality (portrait must be suitable as a FULL-CARD background: aspect/size F needs — ask on the board).

## Swarm protocol (communicate + verify each other)
Board: `deno run -A tools/board.ts post <FROM> <TO|ALL> <TYPE> "msg"` and `deno run -A tools/board.ts read <since> --to <ME>`.
1. Start: post CLAIM (your files). Read the board every ~10 minutes of work and before finishing.
2. Builders cross-review in a ring: **F reviews G, G reviews S, S reviews F** — when your target posts READY, run their
   tests/probe, look at their screenshots/numbers, and post PASS or FAIL with evidence (command + literal output).
3. **V** independently verifies every READY: runs `deno task check`, `deno lint`, the lane's tests, its probe, and its
   OWN measurements in Chrome at all widths (overflow/clipping, element overlap, legibility contrast, title centring,
   level tier colours, delta correctness by recomputing 5 random rows from the game functions). V posts PASS/FAIL to the
   lane and keeps `docs/wave-z/VERIFY.md` (a table: claim, lane, how verified, result).
4. A FAIL must be answered with FIX (what changed) then READY again. A lane is finished only after **both its ring
   reviewer and V posted PASS** for its latest READY (or after 3 rounds — then list the open FAILs honestly).
5. Final answer of each agent: files changed, measurements, the board message ids of its PASS/FAIL, open issues.

Evidence: numbers generated by code; screenshots under `artifacts/qa-wave-z/<lane>/`. SPEC pins: F Z1-Z19, S Z20-Z39, G Z40-Z49.
