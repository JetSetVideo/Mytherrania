# Wave M — verification (measured)

Every number below is a tool's literal output. Wave M answers the ask quoted in `docs/telemetry/BRIEF.md`:
compute the fight's variables in the FRONTEND and share one report at the end, answer the stall ("they move
but they don't really move… they don't serve each other"), put a one-click headless batch on the reading
page with many more min/max statistics, branch a tree over arenas × victory conditions × match-ups, and hand
the back end the enemy's behaviour and probable strategies.

## 1. The stall, measured and answered (lanes M-A, M-B)

The metric is named before it is fixed: `engagement.standoffMaxS` (the longest stretch with no hit while the
pair is beyond the 6 m circling band) plus `dryStreak[f].maxS`. Lane M-B's `Engagement` intent pulls to close
with `pull(quietS) = clamp(quietS / 3 s, 0, 1)` and never returns `approach` inside the fighter's own band.

Same seed (20261031), 80 matches, through the repo's own `runBatch` → `MatchSim` → the M-A accumulator:

| number | before | after |
| --- | --- | --- |
| longest stand-off (s) | **143.97** | **10.5** (−92.7 %) |
| seconds spent beyond the circling band | 213.9 | **32.1** |
| peak separation (m) | 24.6 | **13.14** |
| mean distance (m) | 1.63 | 1.38 |

The engine now FEEDS that hook: `CombatView.quietS` is set per substep from `Engine.#stepFight`, so the pull
exists in the live game and not only in the batch (before this the field was absent and the hook could never
fire live — a wire, not a module, and no unit test would have caught its absence).

**One honest caveat the lane reported rather than hid:** `quietMaxS` is unchanged at 180.03 s — 1 of 80
matches is a 2 m walled closet where both fighters are in-band near the edge with the enemy INSIDE the band,
so a band-defined stand-off does not count it, and the tree cannot make an in-band near-edge fighter attack
without breaking the pinned pre-existing survival behaviour (nearEdge + in-band → retreat). Kept green, not
claimed as fixed.

## 2. The one-click batch (lane M-C + the parent's wiring)

One click on the **reading page** (History), sizes 10/20/50/100, **simulator only** — measured live:

```
progress readings   6 / 100 · ~1.0 s left … 43 / 100 · ~0.3 s left
matches summarised  100
variables           duration, damageA, damageB, hitsA, hitsB, hpFracA, hpFracB
endings             ringout 67 · ko 24 · time 9        → the timeout share is 9 %
frames while running p50 16.8 ms · p90 25 ms           (the game kept its loop: no freeze)
```

Per-variable spread, literal from the same run:

| variable | min | p10 | median | mean | p90 | max |
| --- | --- | --- | --- | --- | --- | --- |
| duration (s) | 7.23 | 15.38 | 49.39 | 60.88 | 126.67 | 186.03 |
| damageA | 0 | 1 243 | 15 196 | 15 587 | 30 394 | 46 909 |
| damageB | 0 | 927 | 10 548 | 14 560 | 33 766 | 47 051 |
| hitsA | 0 | 4 | 20.5 | 28.6 | 66 | 121 |
| hitsB | 0 | 2 | 17.5 | 23.6 | 49 | 155 |

Cost, measured on this machine: `runBatch` is **3.35–5.94 ms per match** (10 matches 59 ms, 50 matches
167 ms), and lane M-C's own estimate (`PER_MATCH_MS = 2`) landed within 2× on three runs after the lane
corrected a first constant of 4 ms that over-promised. The batch runs chunked, one match per turn, which is
why it needs no worker and why the frame cadence above survives.

## 3. The report at the bell (lanes M-A/M-E + the parent's assembly)

Assembled once, at the bell, from live telemetry — read off the page:

```
assembled true · bytes 6962 / cap 8192 · schema 1 · outcome "time-limit"
telemetry seats 2 · both durations 36.005700000047156 s
probable strategies  block, attack, advance, retreat   (weights sum to 1)
habits               openingMove "Bulwark" · averageApproachS 6.29 s · retreatThreshold 0 · favouredBand "striking"
contains no name, no personal id, no position: true
```

The weights are derived from what was MEASURED (contact time, closing time, blocks, stand-off, circling,
jumps), then `buildReport` drops any id a shipped decision tree cannot emit and normalises the rest — so the
list is four real leaf decisions, not a flat prior. `retreatThreshold: 0` is a fact about that match (the
enemy never broke away past the band), not a placeholder.

`telemetryForSeat` is the parent's integration addition: one accumulator covers the whole match, and the
payload needs one description per seat, so the shared spatial numbers are kept and the per-fighter arrays are
projected onto the seat (asserted in `tests/wave_m_wiring_test.ts`).

**No back end exists in this build.** The report is built, capped, privacy-checked and queued locally
(`Engine.#reportQueue`, last 8) — the hand-off to an endpoint is one call when an endpoint exists. Claiming a
send would have been a lie.

## 4. The branch tree (lane M-D)

One real tree, seed 20261031, arenas 32 · victories 4 · maxBranches 4096 · maxNodes 4096 · maxDepth 4:
**1 189 nodes in 3.34 s**, depth histogram `0:1, 1:45, 2:127, 3:508, 4:508`, 1 016 replays (a shared branch
key is memoised), pruned 0. Per depth: win rate 0.864 at depth 1 → 0.481 at depth 4 (the deeper the match-up
branch, the closer to even), mean duration 106.93 s → 77.71 s, stall mean 0.27 s → 0.12 s, damage mean
43 122 → 17 976. Bounds verified: `maxNodes = 12` stops at exactly 12 with `pruned.byNodes > 0`; `maxDepth = 1`
produces nothing deeper with `pruned.byDepth > 0`.

## 5. Gate

| command | result |
| --- | --- |
| `deno task check` | 0 errors |
| `deno task test` | see the log quoted in the wave report (the five lanes' 37 new tests + 4 wiring tests + the pre-existing suite) |
| `deno lint` | `Checked 499 files` |
| `deno task build` | 1 817 375 bytes (Wave L: 1 782 828 — the batch back end joined the client bundle) |
| `deno run -A tools/probe-wave-m.ts` | live telemetry accumulating, the report as above, a 100-match batch with its summary, **0 page errors** |

## 6. Integration fixes made in the parent (each was a real break, not a tidy-up)

1. **Two lanes mirrored `FightTelemetry` structurally** because M-A's module had not landed when they started.
   Both now import and re-export the real types, so a drift between the three is a compile error.
2. **I clipped M-D's `VictoryCondition` interface** while removing the duplicate telemetry types (a one-line
   interface made my block-removal swallow the next declaration). Restored from its own doc comment and the
   `VICTORIES` literal; the file compiles and its 9 tests pass.
3. **`MatchRecord` name collision**: `Engine` already imports `MatchRecord` from `MatchHistory.ts`, and the
   batch back end has its own; the engine's import is aliased to `BatchMatchRecord`.
4. **The report was wiped by the next match.** `#startFight` cleared `#report`, so a spectate match that
   rolled into the next one destroyed the evidence before QA (or a send) could read it — visible only because
   the probe found `assembled: false` twice. It is now "the last report assembled", replaced on assembly.
5. **The probe itself was wrong first**: it polled for a fixed 30 s and a spectate bell is a 30 s HOSTILE
   clock (the truce does not count), so it read the timeout instead of the report. It now waits for
   `debugClock().decided`.

## 7. Open, stated honestly

- No endpoint: the report is queued locally (above). The review gate (accept/defer/refuse) is implemented and
  tested in the model, with no UI yet — the parent has not built the review screen.
- The batch's `variables` cover the record's own numbers (duration, damage, hits, hp fractions); the richer
  per-match telemetry (bands, streaks, jumps, per-weapon damage) is computed in the LIVE match by the
  accumulator, and the headless back end does not attach it to its records yet — so a BATCH summary cannot
  yet show the dry streaks the user asked about. That is the next wave's first job, not a claim here.
- `frameMsDuringBatch` p90 25 ms means roughly one late frame per ten while 100 matches are simulated; the
  cadence holds but a batch should not be run during a fight (it is a reading-page action).
- The stall fix is measured on 80 headless matches and 1 of them remains a 180 s in-band stand-off (above).
