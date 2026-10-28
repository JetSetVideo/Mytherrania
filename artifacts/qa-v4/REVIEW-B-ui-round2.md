# REVIEW B — Round 2: UI / History / Spectate / Victory / Anatomy (qa-v4)

Reviewer B, read-only. Evidence: vision review of the re-captured PNGs (full frames plus zoomed `region` crops)
and `manifest.json`, cross-checked field by field. No source was read this round. Interaction (clicks, inner
scrolling) was **not observed** and is inferred only from the static frames.
Note: two vision passes on 07b disagreed (ring present/absent, bodies clipping or not). Where that happened I
used the manifest coordinates as the tie-breaker and say so below.

## Round 1 → Round 2 delta

| ID | Area | R1 | R2 | Main reason for the change |
|----|------|----|----|----------------------------|
| U1 | History per-match record | PARTIAL | **PASS** | Reason `ring-out` comes from the real event; ♛ crown on the winner; damage matches raw HP loss |
| U2 | Aggregates / Wilson CI bars | PASS | **PASS** | Unchanged and correct; the cosmetic caveats remain |
| U3 | Typography & look | PARTIAL | **PARTIAL** (better) | Serif title, buttons and panels; gold-framed panels. HUD, table body and subtitle are still sans |
| U4 | Responsive | PARTIAL | **PASS** | Mobile matches table captured; `check-mobile-overflow: false` |
| U5 | Victory screen | PARTIAL | **PASS** | "Ser Vail wins" plus a correct detail line, a History button and a framed panel |
| U6 | Spectate live | FAIL | **PARTIAL** | Menu hidden ✔ and red rings in 07a ✔. 07b ring not reliably visible; arena surround is a flat grey field |
| U7 | Anatomy | FAIL | **PARTIAL** | Close-up face has iris, brows, dark nose and red lips; 4-finger hands; sword hilt. Blade and thumb not shown; sword hand unclear |
| U8 | Title screen | PARTIAL | **PARTIAL** (better) | ⚔ glyph, serif title and buttons, scene visible. No framed panel; noon sky still reads dark |

**R1: PASS 1 · PARTIAL 5 · FAIL 2 (5.5/10) → R2: PASS 4 · PARTIAL 4 · FAIL 0. Score: 7.0 / 10.**

---

## U1 History per-match record — PASS
Row in 09-history and 10-history-large (transcribed):
`#1 2026-10-10 09:33 | Sir Aldric — human Warrior · Longsword · AI tree | ♛ Ser Vail — human Warrior ·
Longsword · AI tree | Frostford Crossing / river · day 14h | ring-out / 4.1s · 1st: Ser Vail | 10/29, 2/3 hits |
V7 R8 W4 Rx4 S7 I3 vs V7 R8 W4 Rx4 S7 I3`

| Field | Shown | Manifest (08/09) | OK |
|---|---|---|---|
| Who won | ♛ Ser Vail | `winner:"opponent"` (Ser Vail) | ✔ |
| How | ring-out | player `ringedOut:true, eliminated:true`, `winCondition:"ring-out"` | ✔ (was `timed` in R1) |
| Duration | 4.1s | `elapsed 4.1` | ✔ |
| Where | Frostford Crossing, river, day, 14h | place, `arena:"river"`, `dayPhase:"day"`, `hour 14` | ✔ |
| First strike | Ser Vail | `firstStrike.from:"Ser Vail"` | ✔ |
| Dmg A/B | 10 / 29 | A dealt 30−20.4 = 9.6 → 10. B dealt 30−1.2 = 28.8 → 29 | ✔ raw, not clamped |
| Stats / AI | V7 R8 W4 Rx4 S7 I3, AI tree | stats block, spectate → decision-tree | ✔ |
| Count | 1 | `history: 1` | ✔ |

The R1 defects (wrong reason, colour-only winner) are fixed. The loser no longer falls: player `y` is −9.5 at
08, 09, 10-tablet, 10-large and 10-mobile-matches (R1: −37 528 → −41 216 and still falling).
Remaining nits:
- The in-world hour is still in *Where*, not *When*.
- Manifest `firstStrike.time` = 68.8 while `elapsed` = 0.8. These are different clocks; label or normalise them.
- 08 snapshot still says `phase:"fight"` while the victory screen is up.
- `surface` changes from `stone` (07a/b) to `ice` (08+) inside the same match. It may be a snapshot quirk, but
  it is worth checking.

## U2 Aggregates — PASS
- KPIs: `1 matches`, `4.1s mean (median 4.1s, sd 0.0)`, `100% first-strike wins (n=1)`.
- Chips: `ring-out 1 · day 1 · Frostford Crossing 1`. These now show the true reason.
- By Race / Class / Weapon / Controller: `2 · 1 · 50% · 9.5%–90.5%`. The Wilson 95% interval for 1/2 is
  9.45–90.55 ✔. Bars show a dark track, a salmon range and a tick at 50%.
- Still open (cosmetic): "1 matches" should be "1 match". "Games" counts fighter appearances, so mirror matches
  are uninformative.

## U3 Typography / look — PARTIAL (improved)
- ✔ The title "MYTHERRANIA" is a Trajan/Cinzel-like gold serif. Menu buttons, "Match History", "Back",
  "Ser Vail wins" and the victory buttons are serif. No Impact was seen anywhere.
- ✔ History and victory panels are dark with a thin warm-gold border (≈#c8a45c–#d4b06a). KPI cards and chips
  also have gold borders. Table rules are gold/brown, not teal.
- ✘ Sans-serif remains in the in-game HUD lines, the title subtitle "Cel-shaded arena combat", the control hints
  and (at 1280/1920) the history table body and chips. Two vision passes disagree on the table body. The mobile
  crop reads it as serif.
- ✘ The title-menu buttons have **white/grey** borders, not gold, and there is no enclosing frame (see U8).
  "Dark-metal/gold panels everywhere" is only true for History and Victory.
- Table body text at 1920 is about 11–12px and reads as cramped (same as R1).

## U4 Responsive — PASS
- 10-history-mobile-matches (390 wide) shows "Matches (newest first)" inside a bordered sub-box with columns
  When / Fighter A / Fighter B / Where. The ♛ crown is visible. The Back button is visible.
  The manifest entry `check-mobile-overflow: {horizontalOverflow:false}` confirms the page does not overflow.
- How, Dmg and Stats are out of view to the right. This is consistent with an inner horizontal scroll, but
  the frame shows **no scroll affordance** (no scrollbar, fade or cut column). Scrolling itself was not observed.
- "Frostford" is clipped to "Frostfor" in the Where cell. Add `word-break`/`hyphens` or a min-width.
- 1920: the panel is about 80% of the width (R1: 56%), with no clipping. The body text is still small.

## U5 Victory screen (08) — PASS
- Headline: **"Ser Vail wins"**. Detail line: *"Ser Vail (Warrior) beat Sir Aldric (Warrior) by ring-out in
  4.1s — Frostford Crossing, day"*. Every part matches the manifest: winner, classes, ring-out, 4.1s, place,
  phase.
- Buttons: Rematch · Sheet · **History** · Menu. They sit in a dark panel with a gold border, in a cream serif.
- The HUD behind it shows `HP 1/30` and `HP 20/30`, matching the manifest (1.2 and 20.4).
- Weakness: the fighters are hidden behind the modal and the dark overlay. Only a red sliver is visible, so the
  "frozen loser" can be seen only in the manifest. Clickability was not observed.

## U6 Spectate live (07a, 07b) — PARTIAL
- ✔ **The menu is hidden in both frames.** The HUD shows `AI — Sir Aldric … HP 18/30` and `AI — Ser Vail … HP 25/30`
  (07a), then `13/30` and `25/30` (07b). These match the manifest (18, 25.2 → 13.2, 25.2).
- ✔ 07a: a zoomed crop shows **red rings under both fighters**. That fits damage already being exchanged by
  0.8s (Aldric is at 18 HP). Swords with guard and pommel are visible on both fighters.
- ✘ 07b (`pose: hit` / `attack`, the frame meant to prove red): two of three vision passes report **no ring**
  under either fighter, and the third reports only a thin dark outline. Red is therefore *not* proven in the
  "clash" frame. Green is seen only in non-spectate frames (02, 05). Orange was never seen.
- Collision: one pass says the bodies clip in 07b and another says they don't. Manifest centres are 1.66 m apart
  (07b) and about 2.0 m apart (07a), so I accept that there is **no real overlap**.
- ✘ The arena (river, isometric) sits on a **uniform flat grey field with no horizon, texture or valley shading**.
  If this is the new valley floor, it still reads as a void at this camera. The terrain does read as land in
  02 and 05 (sky, hills, bushes).

## U7 Anatomy (05-camera-close, 02-fight-start-third) — PARTIAL
- Face (05, crop 540–740 × 200–360): white sclera, **yellow-amber iris, black pupil**, thick black brow bars, a
  **darker red-brown nose patch** and **dark-red lips**. Features read as painted onto the skull, not floating.
  ✔ Catch-light is unclear: the full-frame pass says there is a white dot and the zoom pass says there is none.
  It is at most 1–2px. **No ears.**
- Hands (05 crop): about **4 curled fingers** per hand, which is better than R1 mittens. The **thumb is not clearly
  visible**. In 02, at mid distance, both fighters' hands still read as mittens.
- Sword (05): round gold pommel, crossguard and grip, held in the hand on the **viewer's right**. The character
  faces the camera, so that would be its *left* hand. That contradicts the "right hand" claim and the opponent in
  02, who holds the sword in the right hand (viewer's left). The **steel blade is not visible** in 05. In 02 the
  player's sword cannot be seen from behind. 07a shows a full blade, guard and pommel at isometric scale ✔.
- 02: camera behind the player facing the opponent ✔. The opponent face shows eyes with catch-lights, a nose
  line and a reddish mouth ✔.
- The overall proportions are still chunky and toy-like. That is acceptable for the cel-shaded target, but the
  face is not "anatomical".

## U8 Title (01-title-noon) — PARTIAL (improved)
- ✔ Gold serif "MYTHERRANIA". Serif buttons with ⚔ Fight, 📖 History and 👁 Spectate. The arena, ropes, posts
  and fighter are visible through a lighter overlay (R1: near-opaque).
- ✘ The sky reads **dark grey-blue with no sun** at a manifest sun elevation of 70.3°, so the "live noon sky" is
  still not sold. The subtitle is sans. There is no framed panel. History/Spectate borders are white, not gold.

---

## Top 5 remaining fixes
1. **Prove the spectate ring states.** Make the ring thicker and more emissive (it is unreadable at isometric
   scale in 07b). Re-capture three frames — calm (green), closing in (orange), attack/hit (red) — and assert the
   ring material colour in the manifest next to `pose`.
2. **Surroundings, not a grey void.** Give the valley floor texture or colour variation and a horizon or fog
   gradient in the isometric/river camera. Brighten the title-screen sky at noon: lower the overlay alpha or add
   a top-half gradient cut-out.
3. **Weapon hand and blade.** Verify that the sword is parented to the *right*-hand bone (05 suggests left).
   Angle the blade so the steel shows in close and third-person views. Make the thumb a distinct segment and
   scale the fingers up so they survive at the 02 distance. Make the catch-light at least 2px.
4. **Finish the typography pass.** Use the serif family for the HUD status lines, the subtitle, chips and table
   body. Use gold (#c9a24a) borders on the title-menu buttons plus a framed backing plate behind the menu stack.
   Raise table/`small` text to about 0.85rem at ≥1601px.
5. **History polish.** Add a horizontal-scroll affordance (fade or shadow on the right edge) to the mobile
   `.table-scroll`. Fix the "Frostfor" clip. Fix "1 matches". Move the in-world hour into *When*. Rename "Games"
   to "Appearances". Set `phase` to `victory` and use one consistent clock for `firstStrike.time`. Keep the
   loser visible in the victory frame (dim the overlay less, or move the modal up).

## Verdict: **AGREE (acceptable)**, with reservations
Reasons:
- Both R1 FAILs are resolved to PARTIAL, and both R1 P0s are fixed and verified against the manifest:
  - Spectate hides the menu.
  - The true end reason is recorded.
  - The loser is frozen.
- The History record now matches the engine state exactly. The victory screen names the winner with a correct
  detail line and a History button.
- No item is FAIL. The remaining issues are polish and proof:
  - The ring-state evidence in 07b.
  - The grey surround.
  - The blade and handedness.
  - Leftover sans text.
- They do not break correctness.

Not accepted as claimed:
- "Rings red during attack/hit" (07b): not proven.
- "Valley floor instead of a void": it reads as flat grey at the spectate camera.
- "Sword held in the right hand": 05 suggests the left.
- "Fantasy serif everywhere": the HUD, subtitle and some table text are still sans.
