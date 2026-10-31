# Wave I — spectator camera, inspect overlay, terrain fill, clash sparks, 60 FPS guard

**Where / what / why / when / by / for / who.** Frozen lane contract: `docs/spectator/BRIEF.md`.
Measured evidence: `artifacts/spectator/VERIFICATION.md` and `artifacts/qa-wave-i/report.json`.

| | |
| --- | --- |
| **WHERE** | Mytherrania (`~/Desktop/Mytherrania`). New: `src/game/SpectatorCamera.ts`, `src/ui/InspectOverlay.ts`, `src/graphics/GroundFill.ts`, `src/combat/Clash.ts`, `src/graphics/fx/ClashSparks.ts`, `src/game/FrameBudget.ts`, `tools/probe-wave-i.ts`. Edited: `src/engine/Engine.ts` (the spectator camera branch, free-mouse cursor/click handling, prop seating + fill layer, the clash tick, the frame governor, 14 QA hooks), `src/graphics/props/PropModels.ts`, `styles.css`, `src/ui/UiTree.ts`, `tools/frame-budget.ts`. |
| **WHAT** | A spectator camera whose angle sticks and persists; a custom cursor (reticle + trailing blob) with hover; click-to-inspect floating cards for both fighters and for every map object/boon; props seated on the terrain with base-anchored models; a ground-fill layer that closes the seam between a platform or prop and the ground, coloured by the material it stands on; bounded spark bursts where two blades clash; and a measured frame budget with an effects governor. |
| **WHY** | Your words: the spectator angle must stay where you put it; a cursor with "a nice little blob"; clicking a fighter should float their statistics beside them and clicking the other fighter or a map object should change it; some objects float above the map; the surface meets the ground "but not fully" and the fix is another generation layer that meets the terrain, "add some sand if it's partially on the sand"; keep 60 FPS at all times; and particles where "two weapons collide". |
| **WHEN** | 2026-10-31 (contract, 5 parallel lanes, integration, gate, live probe, commit). |
| **BY** | Five lanes in parallel — camera maths, inspect overlay + CSS, fill layer + prop anchoring, clash + sparks, governor + frame measurement — each owning disjoint files; the parent wired `Engine.ts`, pinned the spec, ran the gate and the browser probe. |
| **FOR** | Maximilien Pelletier (JetSetVideo) — watching fights the way an operator would: a camera you aim, a pointer that shows what is clickable, and numbers on demand. |
| **WHO** | The spectator: `[IA1]` an angle that stays, `[IB1]` cards on click, `[IC1]` ground that reads as ground, `[ID1]` sparks on a blade clash, `[IE1]` 60 FPS held. |

## The click paths (mouse-only, as asked)

**Spectating** (main menu → 👁 **Spectate**):
- **Drag** anywhere on the arena to orbit — the angle stays when you let go. **Wheel** zooms, **1–4** pick
  the four presets (Duel / Broadcast / Top-down / Low angle), **C** cycles Free → Follow A → Follow B.
- **Hover** a fighter: the cursor's blob grows and the reticle highlights. **Click a fighter**: their stat
  sheet appears beside them (name, ancestry, calling, level, weapon, HP/mana/stamina bars, the six
  primaries with any below-average stat flagged, the four combat numbers, damage dealt, hits, distance
  travelled, average distance to the enemy, peak 5 s damage, the techniques they can use, and a
  `GEN-…` generation badge).
- **Click the other fighter**: the sheet swaps to them and the camera locks its follow to that seat.
- **Click a prop or a boon** (crate, pillar, rock, arch, a rage orb, a coin): its own card — what it is,
  its size and scale, and what it does.
- **Click empty ground**: the card closes.

**Fighting**: unchanged — Space/click attacks, 1/2/3 skills, V first-person, M map, Esc pause.

## What the measurements changed

Three defects were found by measuring rather than reading (details in the verification log):

1. **Every prop model is centred on its own origin**, so the old placement floated each one by half its
   height — a pillar by 1.60 m, an arch by 1.85 m. Seating now uses the model's own bounding box, and the
   base sits on the highest ground under its footprint: **15 of 16 props in a prop-rich arena would have
   floated; 0 do**.
2. **The apron stopped short of the ground**: its depth cap was the default 0.6 m while a platform on a
   hillside spanned a **1.81 m** fall. Now 16/16 seams are covered.
3. **Pointer lock rejected its promise** (Chrome `WrongDocumentError` when the document is not focused),
   producing 4 page errors per run; now swallowed deliberately.

## Honest gaps

The inspect card is read-only. The clash threshold (0.35 m) is a chosen number, not a tuned one: natural
clashes fire ~8 times per spectated match, and whether that reads right is a judgement nobody has made by
eye yet. The frame numbers are a headless lab sample (cadence is a vsync artefact there; CPU and GPU times
are real). `floating: 0` means "seated on the high point of the sampled footprint", not mathematically
flush between samples. Wave H's stat-unlocked techniques still are not bound to extra HUD slots.
