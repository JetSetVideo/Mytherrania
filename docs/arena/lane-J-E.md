# Lane J-E — wave J wired into the live engine

Lane J-E took the committed pure modules of lanes J-T and J-B (6a964b5) and wired them into the
running game, then measured the wiring in headless Chrome (`tools/probe-batch.ts`). The specs were
`docs/arena/wave-J-T-engine-notes.md` and `docs/arena/wave-J-B-engine-notes.md`. Where the two
overlapped, the digest is J-T's `arenaDigest` (one arena description per match) and the AI reads it
through J-B's `DecisionTree.arenaFeatures`, as the brief asked.

Every number below comes from `artifacts/qa-wave-j/report.json`. The tables were generated from it
by code, not typed by hand.

## What was wired (file · anchor)

| item | where |
|---|---|
| Match start: `symmetryFor` → `placeObjects` → terrain seed → `wallPlanFor(cfg, seed ^ 0x3c6ef372, sym)` → nominal `spawnPlan` → `generateArenaTerrain(fairSpots)` → `symmetrizeHeightfield` → `symmetrizeObjects(zones)` → `spawnPlan(field, props)` → `arenaDigest`. The arenaRng draw order is unchanged. Both seats spawn on the plan's image seats; the old spectate `Math.random()` spawn is gone | `Engine.#startFight` ("Wave J (J-T §1)") |
| `ArenaState.wallPlan` + `segIntegrity` (`integrity` = the minimum over segments) | `#startFight`, `ArenaPhysics.ArenaState` |
| Per-segment wall meshes: runs of equal height, a polyline through the polygon vertices (or 7.5° steps on a curve), each box standing on its local rim. Openings build nothing. Towers (≥ 2 m) are 1.4× thicker and darker, and materials are shared per colour band | `Engine.#buildPlanWalls` (called from `#buildArena`) |
| Per-segment collision rule: an opening, or a breached segment, lets the body through (`break`). Over the top uses the segment's height. A curb (< 0.6 m) trips a blow over it at 0.7× speed. A wall below 0.95 m (`COM_HEIGHT`) topples a knock of ≥ 6 m/s over it at 0.6× speed. Otherwise `hitWall` uses the segment's own resistance, bounce and integrity. The final depenetration guard uses the height at the body's bearing | `ArenaPhysics.stepArenaBody`, `wallAt`, `wallHeightAtXZ`, `restitutionOf` |
| A breach refreshes the AI digest (breached segments become openings), on the event and not every frame | `Engine.#refreshDigest` (the `step.wall.breached` branch) |
| Race health window (`raceAffinity.health`). An empty spend is not clamped, which matches `FighterBuild` | `Engine.#applySpend(f, spent, prof)` |
| `applyLevel(stats, level)` for both seats, every match | `#startFight` ("J-B §1") |
| `createResources(stats, { race, subrace, gear })` | `Engine.#spawnMeshes` |
| Health-relative meter `meterGain(WAVE_J_RULES, …)` on blows and on DoT. Knockback floor `knockbackFloor + p/60` on the impulse path and on the legacy `knockbackPower` path (scaled by ratio, so `Fighter.ts` is untouched) | `Engine.#resolveHit`, the DoT block in `#stepFight` |
| Mass-weighted body push | `#stepFight` body-body block, `#massOf` |
| `judgeTimeLimit` at the bell; the result reads "wins on points" | `#checkElimination`, `#endMatch` |
| AI: `arenaFeatures` in the CombatView, the `edgeAwareTree(reach)` Brain, `sensibleSkill` filtering `chooseAiSkill`, flank toward `edgePlayTarget` via `strafeToward`, and a walk-off guard (a voluntary step never crosses its own open rim). Both seats run the same `#botAct`, with A* (a per-seat route) for both. Strategy per seat: `none` (walk + swing) / `basic` (default tree, no skills) / `full`. A batch match re-thinks every 0.05 + 0.25·(1 − aiLevel) s | `Engine.#botAct`, `#botFight`, `#aiStep`, `#aiHeading` |
| Spectator speed: `MatchControl.SPEEDS` through `SimSpeed.substepPlan`. Fight substeps are ≤ 1/60 s and capped by the frame budget. Rendering, HUD, camera, sparks and the governor keep the real dt. Player matches run one real-dt step exactly as before | `Engine.#runFight` / `#stepFight` (the fight half of `#loop`), `src/engine/SimSpeed.ts` |
| Speed UI: mouse buttons − ½× 1× 2× 4× 8× + and a readout that shows the effective speed when the budget caps it. Keys `[` `]` and `-` `+`. Persisted in sessionStorage | `Engine.#buildSpeedUi`, `#setSpeed`, `#renderSpeedUi`, the spectate branch of the keydown handler |
| Full-condition `MatchRecord` (MatchConditions + MatchOutcome) for every match, kept in a ring buffer of 200. Exposed as `debugArenaRecords()`, `debugArena()`, `debugSimSpeed()`, `debugSetSpeed()` | `Engine.#pushArenaRecord` (from `#endMatch`) |
| `runConditions(c, speedId = "eight")` batch hook. It plays the conditions' exact arena config, wall plan and symmetry; props come from ArenaJT's own derivation; weapons are archetype + seed; gear (armour + damage ×) and strategy/aiLevel are applied per seat; `c.seed` seeds the arena, props, terrain and weapons | `Engine.runConditions` |
| Snapshot: `ring.walls` (rules, combine, base, coverage, mean, max, openSegments, meshes), `ring.symmetry`, `ring.spawns`, `ring.digest`, `ring.speed` | `Engine.snapshot` |
| Minimap: wall height per outline edge. Gaps are drawn dashed, curbs thin, walls full, towers thick | `Minimap.setWorld({ edgeHeights })`, `#strokeEdges`, `edgeClass` |

`src/physics/WallCollision.ts` did not need to change: the collision shape is still the outline polygon.

## Fixes made while wiring (engine-side, all in owned files)

- The spectated **player seat played by different rules** from the opponent: no truce roam, no
  senses, no coins, and it walked straight. On a symmetric map that is not a fair seat. Both seats
  now run `#botAct`. The first fidelity run showed the effect: the player seat walked into the
  opponent during the truce and shoved it out of a 2 m ring in 0.98 s.
- A QA `debugWorld({ nextArena })` size was overridden by the spectator card's size. The override
  now wins (QA only).
- The speed control's inline `style=""` markup was blocked by the page CSP (`style-src 'self'`, 18
  console errors). It is now built through the CSSOM instead (0 errors).
- `RagdollWorld` knows only one wall height. Instead of editing that file (not owned), the engine
  builds the ragdoll world with the wall height at the body's bearing (0 at a gate).

## Measured (headless Chrome, `deno run -A tools/probe-batch.ts --fidelity 32 --invariant 28`)

Page errors: 0. Console errors excluding the known harmless 405: 0 (405 seen 0×).

### (a)+(b) Generated arenas, live pipeline (wall rules and symmetry fixed by override; the rest rolled)

| match | shape | size m | rules (combine) | coverage | open segs /48 | max h m | wall meshes | symmetry | seat radii m | fair |
|---|---|---|---|---|---|---|---|---|---|---|
| towers-rot4 | circle | 40 | towers (blend) | 1.00 | 0 | 2.86 | 52 | rotational/4 | 4.082, 4.082 | True |
| battlement-mirror | square | 38 | battlement (min) | 0.50 | 0 | 1.64 | 20 | mirror/1 | 3.056, 3.056 | True |
| gates-point | octagon | 42 | gates (min) | 0.79 | 10 | 1.02 | 10 | point/2 | 4.57, 4.57 | True |
| ruin-mirror2 | circle | 44 | ruin (max) | 0.00 | 18 | 0.37 | 40 | mirror2/2 | 4.398, 4.398 | True |
| low+towers-rot3 | triangle | 40 | low+towers (max) | 0.25 | 0 | 2.26 | 15 | rotational/3 | 2.68, 2.68 | True |
| half-none | hexagon | 36 | half (min) | 0.00 | 24 | 0.46 | 3 | none/1 | 2.733, 2.733 | False |

`fair = false` on `half-none` is the contract: with no symmetry, the seats are not images of each
other. Seat radii are equal in every match.

### (d) Effective speed per speed (mouse click on the HUD button, 4 s real window each)

| speed | timeScale | sim s | real s | effective | substeps/frame | capped frames | substep ms (EMA) | rest of frame ms (EMA) | frame CPU p50 / p95 / max ms | HUD readout |
|---|---|---|---|---|---|---|---|---|---|---|
| half | 0.5 | 2 | 4 | 0.5 | 1.01 | 0/240 | 0.524 | 0.855 | 1.4 / 2.2 / 2.9 | ½× |
| normal | 1 | 4.017 | 4.017 | 1 | 1.49 | 0/241 | 0.696 | 0.898 | 1.8 / 3.9 / 14.8 | 1× |
| double | 2 | 8.032 | 4.016 | 2 | 2.54 | 0/241 | 0.523 | 0.853 | 2.0 / 3.0 / 4.9 | 2× |
| quad | 4 | 16.065 | 4.016 | 4 | 4.46 | 0/241 | 0.393 | 0.867 | 2.4 / 4.1 / 5.2 | 4× |
| eight | 8 | 32.006 | 4.001 | 8 | 8.49 | 0/240 | 0.28 | 0.958 | 3.2 / 4.8 / 22.7 | 8× |

Keys: `[` from eight → quad, then `]` → eight; sessionStorage holds `eight`.
At 8× the frame time stays at 60 Hz (4.001 real s over 240 frames). The budget cap never fired on this
machine; the cap arithmetic is proved by `tests/engine_wavej_test.ts`. "Normal" averages 1.49
substeps because a frame slightly longer than 1/60 s takes two substeps (kept strict: ≤ 1/60 s each).

### (c) Simulator fidelity: corner cells, headless (`runBatch` corner, ArenaJT provider, WAVE_J_RULES) vs engine at "eight"

32/32 played, winner agreement 26/32 (81.3 %), duration ratio min 0.54 / median 1.07 / max 4.83; end reasons headless {'ringout': 9, 'ko': 22, 'time': 1} vs engine {'ringout': 10, 'ko': 22}; whole-match effective speed at 'eight' min 7.366 / median 7.888 / max 7.969; real seconds per match min 1.8 / median 6.2 / max 18.8

| cell | n | winner agree | duration ratio engine/headless | headless (winner/reason/s) | engine (winner/reason/s) |
|---|---|---|---|---|---|
| corner:max-vs-max|large-open | 2 | 2/2 | 1.23, 1.73 | 0/ringout/104.5; 1/ko/43.8 | 0/ko/128.085; 1/ko/75.876 |
| corner:max-vs-max|large-walled | 2 | 2/2 | 0.74, 0.68 | 1/ko/105.87; 1/ko/76.63 | 1/ko/78.514; 1/ko/52.033 |
| corner:max-vs-max|small-open | 2 | 0/2 | 0.54, 0.74 | 1/ringout/12.5; 1/ringout/10.23 | 0/ringout/6.773; 0/ringout/7.553 |
| corner:max-vs-max|small-walled | 2 | 0/2 | 0.85, 2.59 | 0/ko/79.97; 0/ko/54.1 | 1/ko/67.671; 1/ko/140.288 |
| corner:max-vs-min|large-open | 2 | 2/2 | 1.36, 0.98 | 0/ko/30.33; 0/ko/26.23 | 0/ko/41.393; 0/ko/25.654 |
| corner:max-vs-min|large-walled | 2 | 2/2 | 1, 3.42 | 0/ko/17.63; 0/ko/16.93 | 0/ko/17.565; 0/ko/57.983 |
| corner:max-vs-min|small-open | 2 | 2/2 | 1.1, 1.05 | 0/ringout/6.4; 0/ringout/6.47 | 0/ringout/7.034; 0/ringout/6.777 |
| corner:max-vs-min|small-walled | 2 | 2/2 | 1.67, 2.29 | 0/ko/14.63; 0/ko/13.1 | 0/ko/24.493; 0/ringout/29.996 |
| corner:min-vs-max|large-open | 2 | 2/2 | 0.9, 1.85 | 1/ko/17.03; 1/ko/19.6 | 1/ko/15.407; 1/ko/36.211 |
| corner:min-vs-max|large-walled | 2 | 2/2 | 1.29, 2.16 | 1/ko/17.13; 1/ko/20.37 | 1/ko/22.1; 1/ko/43.987 |
| corner:min-vs-max|small-open | 2 | 2/2 | 1, 1 | 1/ringout/6.5; 1/ringout/6.53 | 1/ringout/6.504; 1/ringout/6.498 |
| corner:min-vs-max|small-walled | 2 | 2/2 | 4.83, 1.27 | 1/ko/16.27; 1/ko/16.27 | 1/ko/78.66; 1/ko/20.69 |
| corner:min-vs-min|large-open | 2 | 2/2 | 0.71, 0.7 | 0/time/186.03; 1/ko/74.5 | 0/ko/131.724; 1/ko/52.282 |
| corner:min-vs-min|large-walled | 2 | 2/2 | 1.28, 0.6 | 1/ko/64.03; 0/ko/126.2 | 1/ko/82.03; 0/ko/76.058 |
| corner:min-vs-min|small-open | 2 | 1/2 | 1.07, 0.79 | 0/ringout/8.27; 1/ringout/10.9 | 1/ringout/8.825; 1/ringout/8.593 |
| corner:min-vs-min|small-walled | 2 | 1/2 | 1.92, 0.85 | 0/ko/69.3; 1/ko/83.2 | 0/ko/133.37; 0/ringout/70.969 |

How to read it: one engine run per headless record, with two records per cell. The engine is not
deterministic (Math.random in strikes, real frame times), so a cell of n = 2 is an anecdote, not a
rate. Every max-vs-min and min-vs-max cell agrees on the winner (16/16). The disagreements are all
equal-strength pairs (max-vs-max, min-vs-min) in the 2 m closet, where either seat can win. The
engine runs longer than the headless sim in the walled closet (up to 4.83×) and once on large walled
max-vs-min (3.42×). The headless sim lands a swing by distance after a wind-up, while the engine needs
the blade to actually cross the body.

### (e) Strong-beats-weak in the real engine (max vs min; sizes 3/8/25/120 m × walls none/low/full/gates/towers/ruin, both seat orders)

strong won 28/28 (losses 0, ties 0); by reason {'strong:ringout': 10, 'strong:ko': 18}; the headless sim on the same conditions: strong won 28/28

| design | size m | strong seat | engine winner/reason/s | strong hpFrac / weak hpFrac | hits [0,1] | headless |
|---|---|---|---|---|---|---|
| sweep-3m-none | 3 | 0 | 0/ringout/7.061 | 1 / 0.8939 | [2, 0] | strong/ringout |
| sweep-3m-none | 3 | 1 | 1/ringout/7.891 | 0.999 / 0.9652 | [2, 2] | strong/ringout |
| sweep-8m-none | 8 | 0 | 0/ringout/6.913 | 1 / 0.804 | [2, 0] | strong/ringout |
| sweep-8m-none | 8 | 1 | 1/ringout/16.852 | 0.9886 / 0.0367 | [3, 8] | strong/ringout |
| sweep-25m-none | 25.00000000000001 | 0 | 0/ringout/47.675 | 0.9713 / 0.005 | [32, 12] | strong/ringout |
| sweep-25m-none | 25.00000000000001 | 1 | 1/ko/26.132 | 0.999 / 0 | [3, 18] | strong/ringout |
| sweep-120m-none | 120 | 0 | 0/ko/26.145 | 1 / 0 | [12, 4] | strong/ko |
| sweep-120m-none | 120 | 1 | 1/ringout/38.872 | 0.9805 / 0.0893 | [7, 17] | strong/ko |
| sweep-3m-low | 3 | 0 | 0/ko/20.097 | 0.9611 / 0 | [7, 7] | strong/ringout |
| sweep-3m-low | 3 | 1 | 1/ko/29.239 | 0.9152 / 0 | [6, 18] | strong/ringout |
| sweep-8m-low | 8 | 0 | 0/ko/18.897 | 0.9875 / 0 | [16, 3] | strong/ringout |
| sweep-8m-low | 8 | 1 | 1/ko/28.443 | 0.9626 / 0 | [8, 16] | strong/ringout |
| sweep-25m-low | 25.00000000000001 | 0 | 0/ringout/49.16 | 0.9422 / 0.3886 | [31, 10] | strong/ringout |
| sweep-25m-low | 25.00000000000001 | 1 | 1/ko/21.306 | 0.9794 / 0 | [8, 11] | strong/ko |
| sweep-120m-low | 120 | 0 | 0/ko/31.403 | 0.973 / 0 | [24, 8] | strong/ringout |
| sweep-120m-low | 120 | 1 | 1/ko/22.78 | 0.9944 / 0 | [6, 27] | strong/ko |
| sweep-3m-full | 3 | 0 | 0/ko/14.144 | 0.9806 / 0 | [14, 4] | strong/ko |
| sweep-3m-full | 3 | 1 | 1/ko/17.31 | 0.9928 / 0 | [3, 8] | strong/ko |
| sweep-8m-full | 8 | 0 | 0/ko/21.516 | 0.9909 / 0 | [12, 8] | strong/ko |
| sweep-8m-full | 8 | 1 | 1/ringout/11.483 | 1 / 0.2764 | [1, 7] | strong/ko |
| sweep-25m-full | 25.00000000000001 | 0 | 0/ko/23.596 | 1 / 0 | [17, 2] | strong/ko |
| sweep-25m-full | 25.00000000000001 | 1 | 1/ko/16.345 | 0.9825 / 0 | [2, 7] | strong/ko |
| sweep-120m-full | 120 | 0 | 0/ko/28.279 | 0.9522 / 0 | [32, 3] | strong/ko |
| sweep-120m-full | 120 | 1 | 1/ko/34.186 | 0.9472 / 0 | [9, 19] | strong/ko |
| sweep-3m-ruin | 3 | 0 | 0/ringout/14.779 | 0.9789 / 0.668 | [6, 7] | strong/ringout |
| sweep-3m-ruin | 3 | 1 | 1/ringout/10.327 | 0.9827 / 0.5423 | [1, 5] | strong/ko |
| sweep-8m-ruin | 8 | 0 | 0/ko/20.082 | 1 / 0 | [12, 4] | strong/ringout |
| sweep-8m-ruin | 8 | 1 | 1/ko/11.196 | 1 / 0 | [0, 7] | strong/ko |

## Screenshots

- `artifacts/qa-wave-j/arena-towers-rot4.png`
- `artifacts/qa-wave-j/arena-battlement-mirror.png`
- `artifacts/qa-wave-j/arena-gates-point.png`
- `artifacts/qa-wave-j/arena-ruin-mirror2.png`
- `artifacts/qa-wave-j/arena-low+towers-rot3.png`
- `artifacts/qa-wave-j/arena-half-none.png`
- `artifacts/qa-wave-j/hud-speed-control.png`

## Not wired, or approximated (honest gaps)

- **Replays are not bit-identical.** `c.seed` fixes the arena, props, terrain and weapons, but the
  fight draws `Math.random` (accuracy, crits, impact jitter) and steps on real frame times.
- **Fidelity is confounded** by real differences between the two simulators. The engine has terrain
  relief (the headless sim is flat), senses/fog, coins, statuses/DoT, the truce roam, the rig and
  blade geometry, and ragdolls. The headless sim holds the spawn during the truce. The
  comparison measures the simulator, not only the sim's arithmetic.
- **Gear tier**: the engine applies the armour bonus and the damage multiplier only. Gear accuracy is
  not applied (the Impact path owns accuracy). Live matches have no gear tier (none is set).
- **Real-time leftovers at speed > 1**:
  - Pickup buffs expire on `performance.now()`, so a buff lasts 8× more simulated time at 8×.
  - Clash sparks are detected once per frame, not per substep. This is visual only.
  - Combat-log timestamps are real time.
- **A breach is not drawn.** A breached segment is an opening for the collision and for the AI's
  digest, but its wall box stays visible, because meshes are merged per run of equal height.
- **Ragdoll walls**: the ragdoll world uses one wall height, taken at the body's bearing when the
  ragdoll starts. The real fix is per-segment in `src/physics/ragdoll/RagdollWorld.ts` (not owned).
- **The 2 m "closet"** used by the corner design is outside the live band (34–120 m). The engine plays
  it, but two bodies at 0.9 m spacing nearly fill the ring.
- **`MatchConditions.timeScale`** records the nominal speed. The measured effective speed is in
  `debugSimSpeed()`. Over whole matches it reads 7.4–7.97× at "eight", because the match-build frame
  is clamped at `MAX_STEP_SECONDS`. The steady state is 8.0×.
- **A human player's record** has `strategy: "none"` and `design: "live:player"`. The contract has no
  "human" strategy.
- **SPEC pins** J1–J3 (J-T §6) were not added: `tests/spec_test.ts` is not owned by this lane.
- **Pure-module notes for their owners**:
  - `SkillRuntime.chooseAiSkill` still treats every dash as a gap-closer. It is filtered here by
    `sensibleSkill`, as J-B asked.
  - `Fighter.knockbackPower` keeps `1 + p/60`. The engine rescales it to the floor instead.
- **Screenshots** were judged by a vision pass (low curbs, 3 towers at the triangle's corners, gate
  gaps). Treat that as a hypothesis. The measured facts are the snapshot numbers above.
