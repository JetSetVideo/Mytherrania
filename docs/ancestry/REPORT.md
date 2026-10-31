# Wave H — ancestry hierarchy, hair physics, match telemetry, corpus data science

**Where / what / why / when / by / for / who**, in the user's format. The frozen lane contract is
`docs/ancestry/BRIEF.md`; the measured evidence is `artifacts/ancestry/VERIFICATION.md`.

| | |
| --- | --- |
| **WHERE** | Mytherrania (`~/Desktop/Mytherrania`): `src/game/Ancestry.ts` + `artifacts/design/ancestry.json` (new data), `src/game/anim/SecondaryMotion.ts` (new), `src/game/SpectateGen.ts` (new), `src/balance/CorpusMath.ts` + `tools/data-science.ts` (new), `src/ui/HistoryView.ts` (new), edits to `HumanoidRig`/`FaceParts`/`SkinnedHumanoid`, `MatchControl`/`WinConditions`/`MatchHistory`, `HistoryFilter`/`Menu`/`UiTree`/`styles.css`, and the engine's spectate/tie/record/spend wiring. |
| **WHAT** | A 16-node ancestry hierarchy (4 races + 12 subraces) with 13 ranked metrics and per-race look specs; hair/beard/brow physics whose mass comes from length and curl; a 180 s match limit that ends as a tie carrying the stat gap and a generation block in the log; generated spectator matches (levels, stat budget, techniques, arena); History highlights (fastest, widest gap, ties, timeouts); a bounded data-science pass (key variables, z-scores, Euclidean/Mahalanobis, PCA, robust outliers, k-NN). |
| **WHY** | The brief asked for the subraces to be a hierarchy with real body-part ratios and a look a viewer can read; for hair that reacts to the weather and to strikes with physics bound to its size; for generations and match outcomes to be logged so the models learn from played games; for a match to stop at three minutes as a tie with the difference recorded; and for all of it to stay runnable — compressed to the variables that matter, inside a time budget. |
| **WHEN** | 2026-10-31 (one wave: contract, 7 parallel lanes, integration, gate, live probe). |
| **BY** | Seven lanes in parallel (data+module, rig look, hair physics, match telemetry, spectator generator, corpus maths, UI), all in the parent's repo with disjoint file ownership; the parent wired the engine, pinned the spec, ran the gate and the browser probe. |
| **FOR** | Maximilien Pelletier (JetSetVideo) — Mytherrania's ancestry, its feel in motion, and the training data the models learn from. |
| **WHO** | Every race and subrace in the game becomes measurable and visible; the trainers get a generation-tagged, stat-gapped corpus; the player gets a History page that answers "what was my fastest fight, and which was the most one-sided". |

## The hierarchy, in one table

Ranks are 1 = most, 4 = least, and every metric is a strict ordering across the four races
(`[SPEC HA1]`). The full per-subrace data, with each node's skin/hair/brow/beard/tusk/ear/skull spec,
is `artifacts/design/ancestry.json`; the readable version is `docs/ancestry/HIERARCHY.md`.

| Metric (1 = most) | Elf | Ork | Human | Dwarf |
| --- | --- | --- | --- | --- |
| `height` | 1 | 2 | 3 | 4 |
| `thinness` | 1 | 3 | 2 | 4 |
| `legLength` | 1 | 3 | 2 | 4 |
| `armLength` | 1 | 3 | 2 | 4 |
| `shoulderWidth` | 4 | 2 | 3 | 1 |
| `torsoMass` | 4 | 2 | 3 | 1 |
| `skullProminence` | 4 | 2 | 3 | 1 |
| `browProminence` | 3 | 4 | 2 | 1 |
| `hairLength` | 1 | 3 | 2 | 4 |
| `beardCoverage` | 4 | 3 | 2 | 1 |
| `earLength` | 1 | 4 | 2 | 3 |
| `tuskProtrusion` | 4 | 1 | 3 | 2 |
| `skinDepth` | 4 | 2 | 1 | 3 |

The ordering is the brief's own list: elves tallest and thinnest with the longest legs and arms, dwarves
shortest with the broadest shoulders, the biggest torso and the heaviest skull, orks second tallest and
second broadest, humans in the middle. (Generated from `artifacts/design/ancestry.json`, not typed by hand.) What makes it readable is not the colours but the numbers — `Ancestry.skin.crease` (a
blue-shifted darkening with the zones `under-eye`, `cheek-fold`, `neck`, `joint` on the elf), `hair.colors`
(bluish-green through ginger for the elf, dark through blond for the human), `beard.mode`
(`moustache-thin` / `full` / `chin` / `none`), `tusk.count` (2, up, ork only), `brow.tipPastFace`
(largest on the elf) and `skull.massMul` (heaviest on dwarf and ork).

## Hair physics, in one equation

    a = ( windGain · wind_body · flutter − HEAD_DRAG · v_head ) / m − (k/m)·x − (c/m)·v

A damped spring per movable mass, integrated semi-implicitly at a 1/200 s sub-step with `dt` clamped to
`MAX_STEP_SECONDS`. `m`, `k`, `c` and `windGain` come from the ancestry, so a very-long elvish mane (0.70 kg,
k 50) swings and settles slowly while the dwarf's cropped hair (0.05 kg, k 170) barely moves; wetness raises
damping and lowers the response, so rain makes the mass hang heavy. Measured live: 5 masses per fighter,
6.3–7.5 cm of displacement, settling within 4 s, never near the clamp.

## Match telemetry, in one line

    every MatchRecord now carries: limitS · tie · StatGap{raw, z, distance, damageShare, dominance}
                                   · GenerationBlock{seed, id, arena, budget, techniques, ancestry}

so a match is not just "who won" but "how far apart were these two builds, and which generation produced
them" — which is what the trainers and the History page both needed.

## What is not done

The stat-unlocked techniques past a class's own three are recorded and displayed but not yet bound to HUD
slots; the brows have no secondary motion (the facial morph owns them); no frame-cost measurement of the
solver was taken this wave; and nobody has judged by eye whether 7 cm of hair movement reads at gameplay
distance. See `artifacts/ancestry/VERIFICATION.md` §4.
