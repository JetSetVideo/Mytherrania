# Lane J-B — balance, resources and the headless batch back end (Wave J)

Owner: lane J-B. Engine wiring is the parent's: `docs/arena/wave-J-B-engine-notes.md`.
Every number below was printed by a tool in this lane; the raw outputs are in `artifacts/batch/`
(`summary.md|json`, `records.jsonl`, `resources.md`, `invariant-sweep.txt|json`, `ablation-ladder.txt`,
`monotonicity.txt`) and `artifacts/batch-engine/` (the same batch under the engine's current rules).

## 1. What was built

| File | What |
|---|---|
| `src/game/Races.ts` | `RaceAffinity` (health, manaFlow, endurance) per race + sub-race tweaks, `raceAffinity()`; health factor applied in `applyRaceBonus` (inside the 30–60 k window) |
| `src/game/Resources.ts` | `resourceRates(stats, {race, subrace, gear})`; mana regen 3 → 1.2 /s base × manaFlow × f(WIL) × gear; stamina 5 /s × endurance × f(RES) × gear |
| `src/game/Stats.ts` | `levelScale` / `applyLevel` (+3 %/level on health and power, L20 = ×1.57), `LEVEL_CAP = 20` |
| `src/game/DecisionTree.ts` | optional digest fields on `CombatView`, `TreeNode.missing`, `arenaFeatures`, `rayToRim`, `edgeAwareTree(reach)` |
| `src/game/AiBrain.ts` | `edgePlayTarget`, `strafeToward`, `sensibleSkill`, `Brain(…, tree?)` |
| `src/game/MatchControl.ts` | `judgeTimeLimit` (+ `JUDGE_MARGIN` 5 points) |
| `src/balance/MatchRules.ts` | the rule knobs (`ENGINE_RULES` = today, `WAVE_J_RULES` = fixes), knockback / meter / gear formulas |
| `src/balance/FighterBuild.ts` | FighterSpec → stats/weapon/resources exactly as `createFighter` + `#applySpend` (+ the race-scaled window) |
| `src/balance/MatchSim.ts` | the headless duel simulator (header lists every rule followed and every simplification) |
| `src/balance/SimPath.ts` | grid A* around props (stand-in for the engine's `GridPathFinder`) |
| `src/balance/ArenaFixtures.ts` / `ArenaJT.ts` | fallback wall plan + digest from the contract fields / the provider backed by lane J-T's generator |
| `src/balance/Gradient.ts` | designs: extreme, corner, grid (gradient lines), random, invariant sweep |
| `src/balance/Batch.ts` / `Summary.ts` | `runBatch`, `codeHash` (sha256 of src/balance + src/game), ColumnStats per cell/axis, invariant check, Markdown |
| `tools/batch.ts`, `tools/arena-resources.ts` | the CLI; the before/after resource tables |
| `tests/balance_{resources,matchsim,decision}_test.ts`, `tests/batch_backend_test.ts` | 19 tests |

## 2. Resources (request c) — before / after (`deno run -A tools/arena-resources.ts`)

Race rows: mean over the three sub-races, class Warrior, level 1, no gear.

| race | mana regen /s | mana refill from empty, s | stamina regen /s | max health |
|---|---|---|---|---|
| human | 3.00 → **1.21** | 26 → **64** | 5.00 → **5.64** | 51 417 → **51 964** |
| elf | 3.00 → **1.58** | 28 → **54** | 5.00 → **4.66** | 45 083 → **44 036** |
| dwarf | 3.00 → **0.74** | 22 → **91** | 5.00 → **7.37** | 50 083 → **52 919** |
| ork | 3.00 → **0.85** | 14 → **50** | 5.00 → **6.35** | 58 083 → **60 000** |

After: mana regen elf > human > ork > dwarf · stamina regen dwarf > ork > human > elf · health
ork > dwarf > human > elf. Before: mana and stamina regen identical for every race; health ork > human > dwarf > elf.

Per class (human, no sub-race): mana regen 3.00 → 1.13 (Barbarian) … 1.38 (Necromancer, Priest);
refill 19–43 s → 50–95 s. **Why 1.2 /s:** the match limit is 180 s and a typical decisive duel runs
50–120 s (sample batch medians). At 3 /s a 20-mana power came back every 6.7 s and a low-INT pool
refilled in 14–26 s — casters never ran dry. At the new rate a power costs 11–27 s of regen and a
full pool takes 50–95 s: one pool plus roughly half a pool per fight. The test band (`J-B R3`) is
every race × sub-race × class × gear refilling in 30–165 s, all below the old 3 /s.

How the race enters (not a hard-coded ranking): `RaceAffinity` is a physiology factor per race
(human 1/1/1; elf 0.97/1.30/0.85; dwarf 1.05/0.62/1.25; ork 1.07/0.80/1.12 for health/manaFlow/
endurance) plus small sub-race tweaks (e.g. high elf +0.08 mana flow, mountain dwarf +0.02 health
+0.03 endurance). The formulas multiply it with the primaries (WIL for mana regen, RES for stamina
regen, VIT/STR for health), class (through its primaries), level (through spent points) and gear.
Sub-races move individuals (`J-B R2`: no race has one mana regen for all three sub-races). The
orderings are tested for all 8 classes at L1/no stats/gear 0, L10/half/0.5 and L20/max/gear 1
(`J-B R1`). One consequence found by that test: a fully spent budget hits the 60 k ceiling, where a
shared ceiling erased the race (every max-VIT build = 60 000), so the spend window now scales with
the race's health factor (`FighterBuild.clampWindow`, engine note §1) and the factor itself is ordered.

## 3. The invariant: strong always beats weak

**strong** = level 20, the whole L20 budget (126 points) spent along the class lean, gear quality 1,
strategy `full`, aiLevel 1. **weak** = level 1, nothing allocated, gear quality 0, strategy `none`
("walk at the enemy and swing"), aiLevel 0. Race, sub-race, class and weapon archetype random per
fighter, seats alternating. Arenas: 2, 3, 5, 8, 14, 25, 60, 120, 320 m × every wall rule (none = open
pit, low, ruin, battlement, gates, half, towers, full) × random ground, shape and props (0 or 14).

| Run | engine rules today | Wave J rules |
|---|---|---|
| sweep, all sizes, lane J-T arenas, 57 600 matches (seed 101) | 57 549 (51 losses: 34 ring-out, 17 time; 33 of them in 2 m) | **57 596** (4 losses, all time-outs) |
| same, first 28 800 | 28 782 | **28 800 / 28 800** |
| ≤ 8 m only, 51 200 matches (seed 11) | 51 099 (101 losses: 73 ring-out, 25 time, 3 KO) | **51 197** (3, all time-outs) |
| test `J-B S3` (fallback arenas, 3 seeds × 576) | — | **1 728 / 1 728** |
| sample batch corners (300) | 300 / 300 | 300 / 300 |

So 100 % is measured on the test's seeds and on 28 800 J-T matches; across 57 600 it is 99.993 %.
The 4 residual losses are all a strong **Archer with a melee weapon** (the Archer kit has no forward
gap-closer — its dash is a backward roll) either pinned in a pocket sealed by two overlapping props
and the rim while a longer weapon reaches it over the prop (attacks have no line of sight), or
knockback-locked by a longer weapon; one is a 0–0 standoff in such a pocket.

### Mechanics that broke it, and the fixes (leave-one-out on the ≤ 8 m set, 51 200 matches)

| Mechanic (found by tracing the losing matches) | Fix | engine + this fix only | Wave J without it |
|---|---|---|---|
| none (engine rules) | — | 101 losses | (Wave J: 3) |
| A level was only a point budget; INT/WIL points move no combat stat and the 30–60 k / 500–1 400 window caps the rest — an L20 mage fought like an L1 mage | `applyLevel` +3 %/level | 49 | 11 |
| Full knockback at 0 %: in a 2–5 m open arena the FIRST blow decides (ring-out luck) | meter floor 0.35 (`knockbackFloor`) | 38 | 19 |
| A bout the strong had won on health was a plain tie at the bell | `judgeTimeLimit` (5-point margin) | 76 (all 25 ties gone) | 21 |
| Absolute meter: a 94 k fighter that lost 3.7 % of its health reads 28 % | `relativeMeter` (360 % at 0 HP) | 80 | 3 (neutral) |
| Body push split 50/50: a 70 kg walker shoves a 170 kg body out of a closet | `massPush` | 84 | 4 (neutral) |
| (rejected) level poise on knockback | `levelPoise` | — | +poise: 6 (worse) |
| (rejected for the rules) walk-off guard for every AI | `walkOffGuard` | — | +guard: 3 (neutral) |

AI defects found the same way and fixed in the lane's brain (`full`) — engine note §6 says how to
give the live AI the same:

| Defect (live AI) | Measured | Fix |
|---|---|---|
| `defaultTree`: `nearEdge` = edge within 1.5 m, TRUE everywhere in an arena under ~3 m — the bot only blocks or retreats | 2 m grid cell: 15/15 time-outs at 100 % health (first sample batch) | `edgeAwareTree`: a WALLED back is not "near the edge" |
| `chooseAiSkill` uses "dash" to close a gap; the Archer's dash is Rolling Shot, lunge **−2.6 m** | archers rolled away every 3.5 s, 0 hits in 180 s; near an open edge they rolled themselves out (the largest single loss source under engine rules) | `sensibleSkill`: no backward roll that ends out of reach or off an open edge, no slowing stance out of reach |
| tree distance thresholds fixed at 1.5 / 2.0 m whatever the weapon | a 2.1 m spear never swung from 1.6–2.1 m, walked into a longer weapon's range | `edgeAwareTree(reach)` rescales them to the fighter's reach |
| the digest's 32 rays can straddle a gate: the exit point read "walled" | backward rolls through gates | `arenaFeatures` reads both bracketing rays (open if either is) |
| "flank" with the back to an open edge circles at constant range | 0 hits vs a longer weapon | step IN (advance): every step toward the enemy is a step away from the drop |
| the spectate player seat walks straight (no A*), and a walk-off guard on the default tree | — / basic-vs-basic open 8–25 m: self walk-offs 28 → 3 of 600 but time-outs 13 → 228 | A* for both seats; the guard only with the edge tree |

### Monotonicity (`artifacts/batch/monotonicity.txt`, n = 200 per step, B at the median, 25 m arena)

A's win rate as one axis goes min → max (Wave J rules): level 0.10 → 0.23 → 0.46 → 0.59 → 0.68 ·
stats 0.13 → 0.28 → 0.46 → 0.60 → 0.66 · gear 0.40 → 0.45 → 0.49 → 0.53 → 0.62 · ai 0.37 → 0.43 →
0.52 → 0.60 → 0.63 · strategy 0.42 → 0.42 → **0.41** → 0.85 → 0.85. Under the engine's rules level
spans only 0.23 → 0.56. The one dip is `basic` (the live default tree) doing no better than `none`
— the tree's passivity above; it is within 1 SE (±0.035) and the test (`J-B S4`) asserts max ≥ min.

## 4. The headless simulator (`src/balance/MatchSim.ts`)

Follows the engine for: ring outline `ringRadiusAt`; WallPlan segment heights (≥ `WALL_BLOCK_HEIGHT`
stops a knocked body, rebound `e = bounce·(1 − mv/R)`, breach by `Physics.hitWall`, self-damage);
ring-out = centre beyond the rim by the footprint on an open/breached bearing; zoned ground
(`materialAt`: stone → ice at the rim) with the engine's slide decay; AI speed 4.2 m/s; body spacing
0.9 m and walking-shoves; swing cooldown = attackInterval × profile.cooldown; engage = profile reach
+ 0.6 (ranged capped at 2.8); damage = the engine's profile branch (`rollStrike` × `attackDamage`
re-armoured by pierce × `physicsMultiplier` × skill × block 0.4); knockback = Δv·6 capped at 4 m/s ×
(floor + %/60), meter raised before the push; `stunDuration`; `Resources` with `SKILL_RESOURCE_COST`;
`SkillRuntime` + `chooseAiSkill`, lunges (incl. backward); 6 s truce; 180 s limit; KO both → higher hp.

Simplifications (each a known gap vs the engine): no skeleton / swing rig / blade sweep (a swing lands
by distance after a wind-up of 40 % of the cooldown, 0.15–0.5 s); no geometric `Impact` (the impulse
is `IMPULSE_K·impact·9·s(STR)`, calibrated to the engine's 1.2–3.6 m/s band); no vertical motion,
hop, airborne time or ragdoll; radial wall normals; flat terrain; no senses/fog/statuses/DoT/items/
coins/buffs/wind; fighters hold their spawn during the truce (the engine roams); grid A* instead of
the heightfield `GridPathFinder`; the brain does not adapt between matches; gear quality is the
lane's proposal (`MatchRules.GEAR`: damage ×0.75–1.25, accuracy ±0.04, armour +0–2.5) — the engine
has no gear tier yet. Deterministic per `conditions.seed` (test `J-B S1`, outcome and full trace);
fixed dt 1/30; 10–14 k matches/min on this machine; the seat order alternates per tick (a fixed
order gave seat A +3 % in exact mirrors; after: 0.492 / 0.506 / 0.490 for none / basic / full).

## 5. Running the batch

```
deno run -A tools/batch.ts --matches 2000 --seed 1 --design all --out artifacts/batch
    [--design all|extreme|corner|grid|random|invariant] [--rules wave-j|engine] [--arena jt|fallback] [--dt 0.0333]
deno run -A tools/arena-resources.ts --out artifacts/batch/resources.md
```

`all` = 30 % corners (max-vs-max, min-vs-min, max-vs-min, min-vs-max × smallest/largest × open/walled),
25 % extremes (every numeric attribute of both fighters and the arena independently at min or max),
30 % grid lines (one axis stepped 0, .25, .5, .75, 1; the rest median; fighter axes on seat A only),
15 % random. Each record is a full `MatchRecord`: conditions (config, wall plan, digest, symmetry,
both specs with the stats used, seed, codeHash, design, gradient) + outcome. The CLI prints the
invariant and exits 1 if it fails. Sample (seed 1, 2 000 matches, 8.5 s): reasons ring-out 928 /
KO 921 / time 151; invariant PASS 300/300; per-cell and per-axis tables in `artifacts/batch/summary.md`.

## 6. Honest gaps

- 100 % is not proven in general: 4 / 57 600 sweep losses remain (§3), all one archetype/topology.
  The pocket case is a map-generation property (props + rim sealing a dead end; the engine's own A*
  finds no route either) — lane J-T / the parent should guarantee a body-wide corridor, and blades
  could be blocked by solid props (no line of sight today).
- The simulator's fidelity to the engine is argued rule by rule, not yet measured: the engine batch
  hook (engine note §9) would let `Summary` compare the two cell by cell.
- `relativeMeter` and `massPush` are neutral for the invariant within noise; kept because they are
  the physically consistent rules (and each closed a traced loss), the parent may drop them.
- Gear quality has no engine counterpart; the sim's gear rule is a proposal.
- The live `basic` tree (the engine's AI) is passive or walks off open edges depending on the guard;
  only the edge-aware tree fixes it, which needs the digest wired (engine note §6).
- `MatchControl.stepTime` is unused in the engine (engine note §7).
- The fallback arena provider is used by the tests for stability while lane J-T's generator is in
  flux; the CLI defaults to J-T's (`--arena jt`). `ArenaJT` writes the batch's wall keys into the
  config it is given (so the record's config is the plan's).
- Not run by this lane (per brief): the full test suite and the build.
