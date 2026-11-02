# Wave X — lane U messages (requests for files lane U does not own)

## To lane B (src/graphics/PreviewScene.ts) — the Creator's live model

Measured by `tools/probe-wave-x-ui.ts` (canvas pixel hash before/after ONE stepper step, see
`artifacts/qa-wave-x/ui/report.json` → `modelChangesOn`): height, weight and sex visibly rebuild the
model; **age and the silhouette parameters do not** (strength is not expected to).

1. `previewKey(profile)` omits `appearance.age`, `appearance.silhouette`, `appearance.eyes`,
   `appearance.beard/moustache` and `appearance.body`, so `setProfile` skips the rebuild for those edits.
   Please add them (e.g. `|${a.sex ?? ""}|${a.age ?? ""}|${silKey(a.silhouette)}|${a.eyes ?? ""}|${a.beard ? 1 : 0}${a.moustache ? 1 : 0}`).
2. `buildPreviewRig` OVERRIDES `silhouette` (and `body`) with values seeded from the NAME
   (`randomSilhouette(seededRng(seed ^ 0x2545f491), …)`), so the Creator's silhouette steppers
   (`appearance.silhouette`, clamped by `src/ui/CreatorTweak.ts` to the race's ±9 % roll band, ≤ SILHOUETTE_TOP)
   can never show. Please honour `profile.appearance.silhouette ?? randomSilhouette(...)`.
3. FYI latency: the menu calls `onRoll(profile)` (→ `PreviewScene.setProfile`) on the next animation frame
   after an edit (rAF wait 7–14 ms measured). A rebuild costs ~45–50 ms warm, but the first two rebuilds
   after an ancestry change cost ~680–730 ms (cache warm-up inside `buildPreviewRig`/paint), which is the
   whole "instant" budget.

## To lane L / Engine (src/engine/Engine.ts)

4. The fight ignores the Creator's hand-tweaked attributes for the HUMAN player: only spectate applies a
   spend (`#applySpend`). The Creator now lets the user spend the level budget (`SpectateGen.budgetForLevel`,
   per-stat floor/cap in `src/ui/CreatorTweak.ts`) and the sheet shows the result through the game's own
   law (`creatorSheet` → `tweakedStats` = rolled + `statDelta(allocated) - statDelta(startingStats)`).
   To make the sheet the numbers the duel runs, `#startFight` should add that same difference for the
   player profile (or reuse `tweakedStats` from `src/ui/CreatorRoll.ts`).
5. The inspect card's rows are rendered by the engine as `<b>` with a `tone-<x>` class only. `InspectRow`
   now also carries `toneValue` (the signed deviation from the fighter's own average). For the smooth
   green→red ramp, render `<b data-tone="${r.toneValue}" data-tone-span="4">` and call
   `paintTones(el)` from `src/ui/ValueTone.ts` after `innerHTML` (CSS fallback for tone-good/tone-bad is in
   styles.css now; the old `.inspect-row-value` selectors never matched the `<b>`).
6. Combat text: `#spawnDamageText` passes `element: "fury"` always; styles.css now colours every floating
   number with the negative tone's hue (a loss for the victim) and misses/absorbs neutral grey. No engine
   change needed; if heals ever float, give them a class and they can take `toneFor(+x)`.

## To the parent (tests outside lane U's list that pin the old six attributes)

7. `tests/menu_creator_test.ts:133` expects six primary labels → add `"Agility"` (the brief's step 4).
8. `tests/spec_test.ts` SPEC LL3 asserts `sheet.primary.length === 6` → `=== 7`.
   Both are the only failures in the UI-touching suites (225 + 40 tests run; see docs/wave-x/UI.md).
