# Statistics: distributions, target spreads and normalisation (R08)

Lane H review, 2026-10-28. This is analysis only. **No harness or game was run for this review.**
Every number below is either quoted from a cited doc or computed by hand from literals cited in the code.
The hand computations are marked "(hand)".

---

## S-0. The targets the plans state

| Metric | Target | Source | Status recorded in the docs |
|---|---|---|---|
| Pairwise win rate for every unordered class pair (28 pairs) | **48–52%** | PHASE1_PLAN.md:6 (G3); docs/SPEC.md:583; Stats.ts:146 | **Not met.** SPEC.md:596 "SC-002 pairwise target: not met"; artifacts/data-science.md:284-285 records "pairs 44–56%, **15/28** in 48–52%" |
| Mirror matchups | 50% ± 2 | SPEC.md:583 | data-science.md:284 records "mirrors 48.7–51.1%" |
| Per-class field share | **49.4–50.6%** | PHASE1_PLAN.md:20 (Phase 3); SPEC.md:594 | Met (SPEC.md:594) |
| Sample size | 10,000 independent fights per unordered pair, held-out seeds | PHASE1_PLAN.md:6 | The calibration used 3 seeds × 1,500 fights/pair (Stats.ts:110-112) |
| Fight duration | "roughly 45–50 seconds" | Stats.ts:56-57 (FIGHT_LENGTH comment) | No measured duration was found in code. `MatchHistory.describe` reports it per session (MatchHistory.ts:112) |
| Telemetry digest | min / max / avg / median, distances, damage dealt/prevented/missed, technique share, altitude/xyz, 80/50/20%/last-hit thresholds | PHASE1_PLAN.md:17-19 | Implemented by `AiStats.fold` (AiStats.ts:25-38, 162-169) |
| Frame time | ≤ 16.6 ms | PHASE1_PLAN.md:6 (G5) | (R13; not in scope here) |
| Map feature sizes | Pareto 80/20 | BRIEF.md:21 (R07) | Lane E is building it; MathCore offers `paretoSample` and `topShare` (MathCore.ts:168-190) |

## S-1. Where distributions are computed today

| Site | What it reports | min | max | mean | median | sd | quantiles | Notes |
|---|---|---|---|---|---|---|---|---|
| `MathCore.summarize` (MathCore.ts:140-158) | a full Summary | ✅ | ✅ | ✅ | ✅ | population | p20, p80 | the new shared helper; spread = max − min |
| `MatchHistory.describe` (MatchHistory.ts:66-74) | match duration on the History screen (shown at Menu.ts:567) | ✅ | ✅ | ✅ | ✅ | **sample** (n − 1) | — | a duplicate of `summarize` with a different sd convention |
| `MatchHistory.wilson` / `rateBy` (MatchHistory.ts:57-91) | win rate by race, class, weapon and controller, with a 95% Wilson CI | — | — | rate | — | — | lo, hi | z = 1.96 literal |
| `AiStats.fold` (AiStats.ts:25-38) | per-fight telemetry: distance to enemy, dealt, prevented, missed, altitude, x, z, closing speed | ✅ | ✅ | ✅ | ✅ | **sample** | — | drops non-finite samples (good); third copy of the same fold. Also used by BattleCorpus.ts:155-156 |
| `ArenaHarness.runArena` (ArenaHarness.ts:69-109) | per-pair `p`, `ci95` (Wilson on decisive fights), draws, and a count of pairs with p ∈ [0.48, 0.52] | — | — | — | — | — | ci95 | does **not** summarise the 28 pair rates (no min/max/median/spread) and does not compute field shares; band literals 0.48/0.52 at ArenaHarness.ts:105 |
| `Races.computeRaceStats` (Races.ts:33-67) → shown to the player in the creator (Menu.ts:355-373) | "min, max, average, median" per primary stat | invented | invented | invented | invented | — | — | **P1.** Not computed from any sample: `min = c−3`, `max = c+4`, `avg = c+0.5`, `median = c`, with `c = 8 + bonus` (Races.ts:54-57). The code comment admits it: "These are descriptive, not sampled" (Races.ts:51). |
| Engine snapshot (Engine.ts:2516-2524) | `dealtMax`, `dealtAvg`, `preventedAvg`, `altitudeAvg`, `distToEnemyAvg` | partial | partial | ✅ | ✗ | ✗ | ✗ | drops the median and sd that `fold` already computed |
| Engine `#closingLog` (Engine.ts:214-215, 1379, 2496) | the raw list of closing speeds | — | — | — | — | — | — | not summarised in-engine. Its **median** is the source of `HARNESS_CLOSING_SPEED = 1` (ArenaHarness.ts:6-7, 41-42), so this is already a derived constant |
| `Leaderboard` (Ranking.ts:59-113) | MMR per AI, plus peak | — | — | — | — | — | — | no ladder distribution is reported |

**Recommendation S-1a.** Make `MathCore.summarize` the one implementation:
- Add `summarize(values, { sd: "population" | "sample", dropNonFinite: true })`.
- Delete `describe` and `fold`, or make them one-line wrappers.
- Move `wilson(wins, n, z = Z_95)` into MathCore, with `Z_95 = 1.959964`, replacing both copies.

## S-2. Class stat distributions (hand, from Stats.ts:25-43, before race and secondary modifiers)

| Quantity | Barb | Warr | Rogue | Assn | Mage | Necro | Arch | Priest | min | max | mean | median | spread | spread/mean |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| maxHealth (k HP) = 33 + 1.7·VIT + 0.55·STR | 53.25 | 48.75 | 44.25 | 40.30 | 40.90 | 39.20 | 42.55 | 44.85 | 39.20 | 53.25 | 44.26 | 43.40 | 14.05 | 0.317 |
| attackInterval (s) = 1.33 − 0.046·REF | 1.238 | 1.146 | 0.962 | 0.916 | 1.146 | 1.192 | 0.916 | 1.192 | 0.916 | 1.238 | 1.089 | 1.146 | 0.322 | 0.296 |
| armor = 2.2 + 0.32·RES | 4.44 | 4.76 | 3.48 | 3.16 | 3.16 | 3.48 | 3.48 | 3.80 | 3.16 | 4.76 | 3.72 | 3.48 | 1.60 | 0.430 |
| primary budget Σ(6 stats) | 30 | 33 | 29 | 25 | 31 | 29 | 28 | 33 | 25 | 33 | 29.75 | 29.5 | 8 | 0.269 |

Findings:
- **The clamps in `shape()` are inert for the eight classes.** HP [34, 58] k, interval [0.85, 1.35] and
  armor [2, 6.5] (Stats.ts:81-83) never bind on these values. They exist only for race and level
  extremes.
  - Proposal: derive each clamp from the class distribution and name the multiplier: `[min − k·sd, max + k·sd]`.
- **The primary budgets are not normalised** (25–33). Combat power is equalised afterwards by solving
  for `attackPower` (Stats.ts:45-49, 88-103). The primaries also feed body mass (Physics.ts:250),
  senses and the mesh, so a low-budget class (Assassin, 25) is physically lighter *and* has fewer
  points.
  - Proposal: either normalise `Σ primaries = B` (B = 30), or declare that the budget is free and only
    the power index is normalised.
- **The "average defender" for crit is 5** (Stats.ts:75), but the mean resilience is 38/8 = **4.75**
  (hand). Derive it.
- **The invented race ranges use base 8** (Races.ts:54), and the telemetry event sends 8 for every
  primary (Engine.ts:2418). The real class means are 4.6–5.3:

| Primary | min | max | mean | median |
|---|---|---|---|---|
| VIT | 3 | 9 | 5.125 | 4.5 |
| RES | 3 | 8 | 4.75 | 4 |
| WIL | 2 | 9 | 5.0 | 3.5 |
| REF | 2 | 9 | 5.25 | 4 |
| STR | 2 | 9 | 4.625 | 4.5 |
| INT | 1 | 10 | 5.0 | 4 |

  All values are (hand) over the 8 classes.
  - Proposal for S-4 below: compute `RaceStats` as
    `summarize({ PRIMARY[c][s] + raceBonus(r, sub)[s] : c ∈ CLASSES })`. That gives real
    min/max/mean/median over the eight classes the player could pick with that ancestry.

## S-3. Win-rate targets versus sampling noise

A pair whose true win rate is exactly 50% still shows a sample rate p̂ with standard error
`SE = sqrt(0.25 / n)`, where n is the number of decisive fights.

| n (fights/pair) | SE | ±z·SE at 95% | Chance a perfectly balanced pair falls outside 48–52% |
|---|---|---|---|
| 1,500 (calibration, Stats.ts:111) | 1.29% | ±2.53% | P(abs Z > 1.549) ≈ **12%** (hand) |
| 10,000 (PHASE1_PLAN.md:6) | 0.50% | ±0.98% | P(abs Z > 4.0) ≈ 0.006% |

With 1,500 fights per pair, about 3 of 28 perfectly balanced pairs would miss the band from noise alone
(28 × 0.12 = 3.4). The band is only meaningful at the 10k sample size.

**Normalisation S-3a: report z-scores, not raw percentages.**
- Per pair: `z_ij = (p̂_ij − 0.5) / sqrt(0.25 / n_ij)`.
- Report `summarize(|z|)` over the 28 pairs (min, max, mean, median, p80).
- Pass condition: `max |z| ≤ z_target`, where z_target is derived from the band, `z_target = 0.02 / SE(n)`.
- With n = 10k that is 4.0. A pair that fails at z > 4 is a real imbalance, not noise.

**Target spread S-3b (pairwise).**
- The 28 pair rates should satisfy `spread(p̂) = max − min ≤ 0.04` (48–52%).
- Today's recorded spread is 0.56 − 0.44 = **0.12** (data-science.md:284), **3×** the target.
- Mirrors: `spread ≤ 0.04` and `|mean − 0.5| ≤ 2·SE`.

**Target spread S-3c (field-wide).**
- Field share of class c: `F_c = mean_j p̂_cj` over its 7 cross pairs.
- Target `spread(F) ≤ 0.012` (49.4–50.6%), which is met per SPEC.md:594.
- Its SE is `0.5 / sqrt(7n)`: 0.19% at n = 10k, so 49.4–50.6% is ±3.2 SE.

The harness change is to emit, alongside `balanced`:
- `pairSummary = summarize(p̂)`
- `fieldShare[c]` and `fieldSummary = summarize(F)`
- `zSummary = summarize(|z|)`

This answers "find the minimum and the maximum, then the average and median, give a target spread"
directly for the balance problem.

## S-4. The creator's fake statistics (P1, player-visible)

- **Problem.** `computeRaceStats` (Races.ts:52-67) is rendered as "min / max / avg / median" for every
  primary in the race panel (Menu.ts:355-373). All four numbers come from formulas that do not depend on
  any data:
  - `avg = median + 0.5` always;
  - the "spread" is always −3/+4;
  - the base is 8, while class means are about 5 (S-2).
- **Fix (equation).** For race r, subrace u and stat s:
  `X_rs = { PRIMARY[c][s] + bonus(r, u)[s] : c ∈ CLASSES }`, then `RaceStats[s] = summarize(X_rs)`.
  This is 8 samples, so report n = 8 next to it.
- **Normalisation for display.** Show each stat as a bar `normalised = invLerp(globalMin_s, globalMax_s, value)`
  across all races and classes, so bars are comparable between stats.

## S-5. Physics multiplier normalisation

- **What the code does.**
  - `physicsMultiplier` (Physics.ts:262-275) returns 0.935 for equal bodies at rest (its own comment,
    Physics.ts:265).
  - It returns **1.10** at the harness's reference closing speed of 1 m/s (hand: (0.55 + 0.30 + 0.25)·(0.85 + 0.15)).
  - Class pricing divides by `edge = phys(c→avg)/phys(avg→c)` at speed 0 (Stats.ts:99). The closing
    factor depends only on the attacker's speed, so it cancels in that ratio unless the
    [0.6, 1.8] clamp binds. Pricing and harness therefore agree on *relative* strength, but every blow
    in harness and game is 10% above the solved `attackPower`.
- **Proposed normalised form.**
  `physicsMul = clamp( (w0 + wm·m_a/m_d + wρ·ρ_a/ρ_d)/(w0 + wm + wρ) · (1 + c_v·(min(v, v_cap) − v_ref)), 1/k, k )`
  - weights w0 = 0.55, wm = 0.30, wρ = 0.25; c_v = 0.15; v_cap = 2;
  - v_ref = `HARNESS_CLOSING_SPEED` (the measured median); k = 1.8.
  - **Invariant:** equal bodies at the median closing speed → exactly 1.
  - **Coefficient attribution:** ∂ln(mul)/∂ln(m_a/m_d) = wm/Σw = 0.27 and ∂ln(mul)/∂ln(ρ_a/ρ_d) = 0.23
    at equal bodies. Mass matters slightly more than density, and both have positive sign for the
    attacker and negative sign for the defender (mirror-symmetric).
- **Consequence.** Every blow shrinks by 1/1.10, so duels last about 10% longer. Re-run the calibration
  (Stats.ts:110-122) after the change; do not hand-adjust `TARGET_POWER_INDEX`.

## S-6. Per-hit damage spread (the damage product)

Engine.ts:1386 computes
`dmg = base · damageMul · statusMul · physicsMul · rage · ward · block`, with
`base = attackPower · crit · jitter / (1 + κ_a·armor)` (Stats.ts:149-153).

The log-range of each factor (hand, from the cited literals):

| Factor | Range | ln(max/min) | Source |
|---|---|---|---|
| attackPower (across classes) | [500, 1400] (clamp) | 1.030 | Stats.ts:70-71 |
| jitter | [0.65, 1.35] | 0.731 | Stats.ts:147, 151 |
| crit | {1, 1.4} | 0.336 | Stats.ts:150 |
| armour reduction (armor 2 to 6.5) | [0.794, 0.926] | 0.154 | Stats.ts:83, 152 |
| physicsMul | [0.6, 1.8] | 1.099 | Physics.ts:267-268 |
| block | {0.4, 1} | 0.916 | Engine.ts:1386 |
| statusMul, combined statuses (chilled·poisoned·slowed to hasted·blessed) | [0.54, 1.43] | 0.974 | Status.ts:35-39 |
| skill damageMul (only rows read: 0.8 to 2.3) | ≥ [0.8, 2.3] | ≥ 1.056 | Skills.ts:151, 159 |
| rage / ward pickups | not read | — | PowerUps.ts (values not read) |

- **Worst-case ratio.** The sum of the log-ranges is ≥ 6.30 (hand: 6.296), so the worst-case
  max/min ratio of a single hit is ≥ e^6.296 ≈ **540×**.
- **Normalised hit.** Define the reference hit as an equal-body, no-buff, no-block, median-class hit:
  `E_ref = median(attackPower) · (1 + 0.4·p̄_crit) / (1 + κ_a·median(armor))`.
  Then report the dimensionless `d̂ = dmg / E_ref` in telemetry (AiStats `dealt`), with
  `summarize(d̂)` per fight.
- **Target spread proposal.** Let jitter, crit and physics carry the in-fight variety, and keep the
  rest bounded by design:
  - `p80(d̂) / p20(d̂) ≤ 2.5` per fight; this uses MathCore's Pareto cut points;
  - `max(d̂) ≤ 6`.

  Both are proposals, to be checked against a measured corpus. **Not measured here.**
- **Bug that skews any measured spread.**
  - Skill DoT adds 14 HP instead of 1,400 (vocabulary.md, V-09).
  - `statusMul` multiplies both the swing rate and the damage (V-13), so the effective status range
    is the *square* of the table's: [0.29, 2.04] instead of [0.54, 1.43].

## S-7. Other metrics that should report distributions

| Metric | Today | Should report | Normalisation / target |
|---|---|---|---|
| Fight duration | `describe` in History (mean, median, sd) | + p20/p80; the harness should report it too | `T̂ = T / T_target` with T_target = 47.5 s (midpoint of Stats.ts:56-57); target `T̂ ∈ [0.95, 1.05]` at the median. Expected duration `E[T] ≈ EHP_def / DPS_att` (Stats.ts:105-108). |
| Closing speed | raw list (`#closingLog`) | `summarize` per match; keep n | Its median **is** `HARNESS_CLOSING_SPEED`. Record n and the date, and fail a test if the live median drifts by more than 25%. |
| Telemetry snapshot | mean and max only (Engine.ts:2516-2524) | the full `fold`: n, min, max, mean, median, sd | — |
| MMR ladder | per-AI value only | `summarize(mmr)` and `topShare(mmr − min, 0.2)` | If `recordMatch` updates both sides with `mmrAfter` and the same K (the body of `recordMatch` was not read), Elo is zero-sum, so `mean(mmr) = START_MMR` (Ranking.ts:45, 55-56). Spread is then the informative statistic. Normalise with `z = (mmr − 1000)/400`, the Elo logistic scale (Ranking.ts:51). |
| Pair imbalance | `balanced` count | `summarize(|z|)` (S-3a) | `max |z| ≤ 4` at n = 10k |
| Map heights and feature sizes (R07, lane E) | — (lane E in progress; it already calls `summarize`, src/world/Heightfield.ts:166-229) | `topShare(sizes, 0.2)` | acceptance 0.75–0.85 for n ≥ 200 when capped (`paretoSample` with `cap` lowers the share; MathCore.ts:176-180) |
| Per-hit damage | `dealt` samples in AiStats | `summarize(d̂)` | S-6 |
| Senses (perceivesBy) | list per frame | share of frames each sense was the first perceiver | report as `share`; target none (diagnostic) |
