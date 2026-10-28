# REVIEW B — UI / History / Spectate–Victory / Responsive / Anatomy (qa-v4)

Reviewer: independent, read-only. Evidence: vision review of 9 PNGs (full frame + zoomed crops),
`manifest.json` snapshots, `styles.css`, `src/ui/Menu.ts`, `src/engine/Engine.ts` (grep only).
Main captures are 1280×800; responsive captures are at the stated viewports.
Limit: I can only judge what the PNGs show. Interaction (clicks, scrolling, pointer lock) is inferred
from source and was not observed.

## Verdict summary

| ID | Area | Verdict |
|----|------|---------|
| U1 | History per-match record | **PARTIAL** |
| U2 | Aggregates / KPIs / Wilson CI bars | **PASS** (one caveat) |
| U3 | Typography & look | **PARTIAL** |
| U4 | Responsive | **PARTIAL** |
| U5 | Victory screen | **PARTIAL** |
| U6 | Spectate live | **FAIL** |
| U7 | Anatomy close / fight start | **FAIL** |
| U8 | Title over live sky | **PARTIAL** |

**PASS 1 · PARTIAL 5 · FAIL 2. Overall UI score: 5.5 / 10** (REVISE). The History page is the strongest
part of the build. Spectate capture, end-of-match truth and the character models are the weakest.

---

## U1 History per-match record — PARTIAL
Match row seen in 09-history (zoomed crop):
`#1 · 2026-10-10 09:06 | Sir Aldric (green, bold) / human Warrior · Longsword · AI tree | Ser Vail (orange-red) /
human Warrior · Longsword · AI tree | Greywall Keep / walls · day 11h | timed / 60s · 1st: Sir Aldric |
30/10 / 4/2 hits | V7 R8 W4 Rx4 S7 I3 vs V7 R8 W4 Rx4 S7 I3`

| Field | Shown | Matches manifest? |
|---|---|---|
| WHO (names, race, class, weapon) | yes | yes: Sir Aldric/Ser Vail, human, Longsword |
| WHEN timestamp + in-world hour | yes (real date; hour `11h` is under Where) | hour 11.08 → "11h" ✔ |
| WHERE place + layout + phase | yes | Greywall Keep, arena `walls`, `day` ✔ |
| HOW reason + first striker | yes | `timed`, firstStrike.from = Sir Aldric ✔ |
| STATS six primaries | yes | V7 R8 W4 Rx4 S7 I3 = vit/res/wil/ref/str/int ✔ |
| WHICH AI | yes ("AI tree") | spectate → decision-tree ✔ |
| WHO WON highlighted | colour only (.won #a9ce7c / .lost #ef7455) | winner=player=Sir Aldric ✔ |
| HOW LONG | 60s | elapsed 60 ✔ |
| Dmg/hits per side | 30/10, 4/2 | see defect 2 |
| Count | 1 row, "1 matches" | history = 1 ✔ |

Defects:
1. **Win reason is wrong or misleading.** Manifest at 08/09: opponent `hp -3.6`, `eliminated:true`,
   `ringedOut:true`, `pose:"ko"`. The row still says `timed`. It looks like the row logs the selected
   mode (`winCondition`), not the real cause. It should say `ko` (or `ring-out`). This makes the
   "win reasons" chip and the reason column unreliable.
2. **Damage is clamped or off.** The opponent lost 33.6 HP (30 → −3.6) but A "dealt" shows 30. B dealt 9.6 → "10" is
   fine. Either show raw damage or label the column "effective dmg".
3. **Opponent falls out of the world.** Opponent `y` goes from −37 528 (08) to −41 216 (10-large). The body
   keeps falling through the `walls` arena forever, so it is missing from the victory frame. This is
   an engine bug, but it shows up in the UI. Freeze the body on elimination.
4. The winner is marked by colour only (green vs red). There is no glyph, so it fails for colour-blind
   users (WCAG 1.4.1). Add a "★"/"W" marker or a "Winner" column.
5. The in-world hour sits in the *Where* cell and the When cell shows only the real timestamp. Add the
   in-world hour (e.g. `11:05 in-world`) to When as the spec asks.

## U2 Aggregates — PASS
- KPIs: `1 matches`, `60.0s mean (median 60.0s, sd 0.0)`, `100% first-strike wins (n=1)` ✔.
- Chips: `timed 1`, `day 1`, `Greywall Keep 1` ✔ (reasons, phases and places all present).
- Tables By Race / Class / Weapon / Controller each show `2 games 1 win 50% 9.5%–90.5%`.
  I checked the Wilson 95% interval for 1/2 by hand: 9.45%–90.55%, which rounds to 9.5–90.5 ✔.
- Bars: `.ci-track` + `.ci-range` (rgba(239,116,85,.45)) + `.ci-point` (#f2c46b) + a 50% `::after` line.
  All are visible at 1280, 820 and 1920 ✔.
- Caveat: "games" counts fighter-appearances. A mirror match gives 2 games / 1 win per row, which tells
  you nothing. Rename the column to "Appearances", or leave mirror matches out of the By-X tables.
- Minor: "1 matches" should read "1 match".

## U3 Typography / look — PARTIAL
- Body is Palatino/Georgia (styles.css:2) and KPI numbers are Palatino (:89) ✔. But `.digest-table th`
  (:106), `.menu-title` (:34), `.menu-btn` (:37) and `#hud-status` all use **Impact/Arial Black**. The
  result is a modern arcade-poster look, not "fantasy serif". In the capture, vision also read the
  table data as sans-serif.
- Panel: brown gradient `rgba(38,32,26)→rgba(20,22,26)`, 2px `#6b5a3e` border, inset shadow. It reads as
  a dark wood/leather frame. The "gold" is a muted bronze (#6b5a3e) and does not read as gilded.
  Table rules are teal `#4f8490`, which clashes with the gold scheme.
- Contrast (computed on a ~#141210 panel): `.kpis span` #b9c9c8 ≈ 10.8:1. `.match-table small` #9fb0b0
  at 11px ≈ 8.2:1. `.chip` #d8e4e3 is above 12:1. All pass AA on paper. In practice 11–12px text on a
  92%-opaque overlay over the 3D scene looked faint in the vision review. Raise the size, not the colour.
- Spacing is consistent: 16px panel padding, 10px KPI gap, 4px/8px cells.

## U4 Responsive — PARTIAL
- **Mobile 390×844:** no horizontal overflow ✔. KPI cards stack 1-per-row (`.kpis{1fr}`) ✔. `.bar-col`
  is hidden ✔. The page is cut off at the bottom of "By Controller", and the Matches table is
  **not in the capture**. So "table scrolls inside its container" (`.table-scroll{overflow:auto}`)
  has **no visual evidence**. A 7-column match table needs a second capture scrolled to the
  match table at 390px.
- **Tablet 820×1180:** panel is centred, bars are visible, the table fits, and the Back button is visible ✔.
  There is a lot of empty space below, which is acceptable.
- **Large 1920×1080:** panel is about 1080px of 1920 (≈56%), so it is under-used. Text is about 12–14px (`.kpis
  span` and `small` are fixed 11–12px and ignore the ≥1601 17px base). No clipping. Back button visible ✔.

## U5 Victory screen (08) — PARTIAL
- `You win!` is large and clear. Rematch (amber #dfaa55), 📋 Sheet and Menu (outlined) are all visible ✔.
  There is no pointer-lock overlay. Engine.ts:583 calls `exitPointerLock()` ✔. Clickability was **not
  observed**, only inferred.
- **Wrong message for spectate:** both fighters are AI, so "You win!" is false. Show
  `Sir Aldric wins — KO` (name + reason) when `#spectate` is on.
- There is no **History** button on victory, so the freshly recorded match is two clicks away.
- There is no backing panel. The HUD text above is faint under the 0.92 overlay. Only one fighter is
  visible because the loser fell through the floor (U1 defect 3).

## U6 Spectate live (07) — FAIL
- The frame shows the **title menu (MYTHERRANIA / Fight / History / Spectate) still overlaid**, even
  though the manifest says `phase:"fight", elapsed:1`. Either the menu is not hidden when spectate
  starts, or the capture fired before the transition. In both cases the deliverable is not shown.
- The HUD labels both lines as `AI —` ✔ (Engine.ts:528). Opponent HP 18/30 and player 25.2/30 are
  live in the manifest.
- Rings: only **yellow/orange** rings can be made out under the 92% dim. Green, orange and red states
  cannot be checked. Re-capture with `#menu` hidden, at 3 moments (pre-contact, approach, clash).

## U7 Anatomy (05-camera-close, 02-fight-start) — FAIL
What is actually visible at render scale:
- Eyes: a white sclera and a black pupil. **No distinct iris.** On the orange fighter the eye is barely visible.
- **Not visible:** eyebrows, nose, nostrils, upper/lower lips (02 shows a rectangular open mouth),
  ears, a defined chin.
- Hair cap: visible (black) ✔.
- Body: rounded shoulders only. **No readable pecs or pelvis.** Hands are **mittens with no separate fingers**.
- Weapons: in 05 one longsword is gripped in the right hand ✔. The other is obscured, and a loose brown
  plank/stick lies on the floor (dropped weapon or prop?). In 02 **no swords are visible on either
  fighter**, although the HUD says "Longsword vs Longsword".
- The overall look is toy-like (capsules and spheres, Roblox-like proportions), not anatomical.
  Humanoid.ts mentions brows, nostrils, lips, ears, fingers and so on (41 keyword hits), but at this
  scale they render too small, are hidden, or are not built. Close camera does not reveal them.

## U8 Title screen (01-title-noon) — PARTIAL
- `MYTHERRANIA` (Impact 64px #dfaa55, red offset shadow) is strongly legible. The subtitle is #b9c9c8 16px.
  The Fight/History/Spectate stack is centred ✔.
- **The "live sky" is not visible.** At noon (sun elev 70°) the frame shows a near-black sky with no sun
  or clouds, because `#menu{background:rgba(23,33,40,.92)}` covers it. The live world adds nothing to
  the composition.
- The "✕" glyph on Fight reads as "close". Use ⚔.

---

## TOP 6 prioritized fixes
1. **P0: Spectate must hide the menu.** In `onSpectate` (Engine.ts:132) call the same menu-hide path as
   `onStart`, and assert `#menu` has `display:none` before the 07 capture. Re-capture 07 at 3 times
   to show the green, orange and red rings.
2. **P0: Record the true win reason and stop the fall.** When a fighter is eliminated, set
   `reason = ringedOut ? "ring-out" : hp<=0 ? "ko" : mode`. Freeze the loser's y and velocity on
   `eliminated`. Report raw damage dealt (33.6 → "34"), not damage clamped to max HP.
3. **P1: Spectate victory copy and History access.** `#victory-text` should read
   `${winnerName} wins — ${reason}` when spectating. Add `<button data-action="history">📜 History</button>`
   to the victory screen. Add a translucent backing panel
   (`background:rgba(20,22,26,.85);border:2px solid #6b5a3e;padding:24px;border-radius:6px`).
4. **P1: Anatomy readability.** Scale up the facial features (iris disc ≥40% of eye width in a colour
   different from the pupil, nose wedge, brow bars ~1.5× thicker, lip split line). Build 3 + thumb finger
   segments per hand. Make sure the weapon mesh is parented to the hand bone, so it shows in 02.
   Remove or explain the loose floor plank.
5. **P1: Fantasy typography and colour-blind safe winner.** Replace Impact in `.digest-table th`,
   `.menu-title`, `.menu-btn` and `#hud-status` with `'Cinzel','Palatino',serif` (bundle it).
   Use `#c9a24a` for the panel border and change `.digest-table` row rules from `#4f8490` to `#5a4a32`.
   Prefix the winner with `★` (e.g. a `.won::before` rule).
6. **P2: Responsive polish and sky.** At ≥1601px set `.digest-body{max-width:1400px}`, and set
   `.kpis span` and `.match-table small` to `0.8rem` so they scale. Add a mobile capture scrolled to
   `.table-scroll`. On the title screen lower `#menu` alpha to `.55` and add a radial vignette behind the
   button stack, so the live noon sky shows. Fix "1 matches" → "1 match".

## Re-capture needed for PASS
07 (menu hidden, 3 ring states) · 08 after fixes 2/3 · 10-mobile scrolled to the match table ·
05/02 after the anatomy changes. Click-through of Rematch/Sheet/Menu was not observed. It needs a recorded
interaction trace.
