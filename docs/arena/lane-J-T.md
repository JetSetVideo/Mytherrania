# Lane J-T — terrain walls, symmetry, start zones, AI arena digest

Wave J, lane J-T, 2026-10-31. Contract: `src/game/arena/contracts.ts` (frozen, not edited).
Engine wiring is NOT done here (Engine.ts belongs to wave I right now): see
`docs/arena/wave-J-T-engine-notes.md` for the exact patch.

## What changed

| File | Change |
|---|---|
| `src/game/ArenaConfig.ts` | 19 new params (wallRule/wallRule2/wallRule3, wallMix, wallCombine, wallTall, wallLow, wallGap, wallGate, wallPeriod, wallTowers, wallArc, wallArcCentre, symmetry, symmetryOrder, symmetryAxis, spawnAngle, spawnDistance, spawnZone) with ranges + notes; `wallHeight` default 2.4 → 0.9 m and its meaning is now the plan's BASE height; `ringSymmetry(cfg)` (the outline's own group); `randomArena` rolls the wave J part from its own child stream (legacy values per seed unchanged; the old wallHeight draw is consumed and discarded) |
| `src/game/arena/walls.ts` (new) | `wallPlanFor(cfg, seed, sym)`, `wallRulesFor`, `wallHeightAt`, `segmentIndexAt`, `planEnclosure`, `gateBearings` |
| `src/game/arena/symmetry.ts` (new) | `symmetryFor(cfg)`, `symmetryOps`, `symmetryImages`, `uniqueImages`, `applyOp*`, `symmetrizeObjects`, `symmetrizeHeightfield` (2 passes), `heightfieldAsymmetry`, `ringAsymmetry`, `symmetryFitsRing`, `foldHalfSteps` |
| `src/game/arena/spawns.ts` (new) | `spawnPlan(cfg, sym, field, fighters, props?)`, `seatOps`, `seatBearing`, `minRingRadius`, `propIntrusion` |
| `src/game/arena/digest.ts` (new) | `arenaDigest(...)` per contract, `digestFeatures(d, x, z, towardX, towardZ)`, `rimRay` |
| `tests/arena_walls_test.ts`, `tests/arena_symmetry_test.ts`, `tests/arena_digest_test.ts` (new) | 17 tests |

`cfg.walls` keeps its meaning (0 = no wall at all, rolled 90% walled — the pre-existing
physics2 pin still passes); whether the wall BLOCKS is now per segment (`plan.coverage`).

## Measured distribution, before and after (2000 arenas, `randomArena(seededRng(0..1999))`)

Before (measured on the unmodified ArenaConfig, one wall of `wallHeight` all round when walls = 1;
open arenas counted as 0 m):

```
{"N":2000,"walledShare":0.902,"fullyOpenShare":0.098,"fullyEnclosedShare":0.902,"mixedShare":0,
 "perimeterMeanIncl0":3.346,"median":3.453,"p10":1.41,"p90":5.501,"max":5.999,"walledMean":3.709,"share_below_1_2":0}
```

After (tests/arena_walls_test.ts output; per perimeter segment, openings = 0 m; "open" = no segment
≥ WALL_BLOCK_HEIGHT 0.6 m, "enclosed" = every segment ≥ 0.6 m):

```
{"arenas":2000,"segmentMean":0.688,"median":0.615,"p90":1.485,"p99":2.622,"max":3.486,
 "fullyOpen":0.3415,"fullyEnclosed":0.3835,"mixed":0.275,"mostlyOpen":0.497,"withTallPart2m":0.1095,"walledIn0p3to1p2":0.678}
```

| | before | after |
|---|---|---|
| median wall height | 3.45 m | 0.62 m |
| mean | 3.35 m | 0.69 m |
| p90 | 5.50 m | 1.49 m |
| max | 6.00 m | 3.49 m (towers/merlons) |
| fully open | 9.8 % | 34.2 % |
| fully enclosed | 90.2 % | 38.4 % (mostly the closet preset: always a full 0.8–1.6 m wall) |
| partly open (mixed) | 0 % | 27.5 % |
| arenas with a part ≥ 2 m | 90.2 % (the whole wall) | 11.0 % |
| walled perimeter in 0.3..1.2 m | 0 % | 67.8 % |

Symmetry rolls (2000 arenas): none 817, mirror 376, mirror2 200, point 308, rotational 3/4/5/6 = 63/84/68/84
(rolled probabilities 40 / 20 / 10 / 15 / 15 %, order uniform 3..6). Every rolled symmetry fits its outline
(no degradation, ring asymmetry < 1e-6·size in all 2000).

Heightfield symmetrization (34 m circle, seed 7, tests/arena_symmetry_test.ts):
node-preserving groups (point, mirror2@0, mirror@0, rotational 4) are exact (0.0000 m); the others
leave RMS 4–7 mm, p99 2–3 cm, max 4–13 cm (mirror@30: 0.127 m at a cliff edge) from 3.1–4.2 m of raw asymmetry.

## Honest gaps

- **Rotational order 5 walls are not exactly symmetric**: 48 segments are not divisible by 5, so the
  plan is symmetric as a function but sampled off-lattice: 6.9 % of segment/image pairs differ (measured).
  Orders 2, 3, 4, 6 and every mirror are exact (the axis is snapped to the 3.75° lattice).
- **The terrain is symmetric only up to grid sampling** for mirrors off 0/45/90/135° and orders 3, 5, 6
  (numbers above); cliff/hole edges carry the largest error. `features` of a symmetrized field lists the
  SOURCE stamps only; `stats` other than `heights` describe the source.
- **Digest rays**: wallHeight/open are point samples on 32 rays. Gates and crenels are ≥ 15° (always hit
  by a ray); a ruin gap or a tower narrower than 11.25° can fall between rays.
- **ringOutFatal** is a description (void, or a drop ≥ 8 m); under RingOut V03 every ring-out already
  ends the match.
- `symmetrizeObjects` can overshoot the requested prop count by up to |G| − 1 (it adds whole orbits) and
  drops an orbit that does not fit (so a crowded small ring gets fewer props).
- Prop yaw is mirrored as a rig yaw (`rotation.y = atan2(dx, dz)` convention); not verified against the
  prop models' own forward axis (cosmetic).
- Nothing is wired: the live game only gets the lower base height until the engine patch
  (wave-J-T-engine-notes.md). The closet preset's arenas are clamped to ≥ 34 m by the engine, so in live
  play their "enclosed" walls surround a field, not a closet.
- Lane J-B's `DecisionTree.arenaFeatures` overlaps `digestFeatures`; integration should keep one.

## Contract remarks (contracts.ts not edited)

- `WallSegment` says angles are "in [0, 2π)"; the last segment's `a1` is exactly 2π (half-open
  `[a0, a1)` covering the circle). Consumers should treat `a1` as exclusive; `wallHeightAt` wraps.
- `SymmetrySpec.order` is documented only for rotational; here it is the ROTATIONAL order of the group
  (1 none/mirror, 2 mirror2/point, m rotational).
- `digestFeatures` is not in the contract; its `toward` is a POINT (the other fighter), not a direction.

## Gate (actual output)

```
deno check src/game/ArenaConfig.ts src/game/arena/*.ts tests/arena_*_test.ts   -> exit 0
deno lint src/game/arena src/game/ArenaConfig.ts tests/arena_*_test.ts         -> Checked 9 files, exit 0
NO_COLOR=1 deno test --allow-read tests/arena_*_test.ts                         -> ok | 17 passed | 0 failed (1s)
the 20 pre-existing test files that import ArenaConfig                           -> ok | 183 passed | 0 failed (23s)
deno check of the 27 src/tools files importing ArenaConfig (Engine.ts excluded)   -> exit 0
```
