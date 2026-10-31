# Wave M — fight telemetry, branch trees and the one-click batch (contract)

**The user's ask, verbatim** (voice transcript, drifting):

> "Among the calculations that should be done, you should add variables that are processed by the frontend
> to fit the backend to work on the AI models of the behaviors of the characters while they're fighting they
> need to have some variables that past like number of seconde without without eating anything the maximum
> number of seconds, without eating any symptoms, the minimum seconds, without eating his things or without
> eating somebody without eating two players those type of entries should know like what's the average
> distance and the median distance and And I tried to solve the problem where the characters, they kind of
> move, but they don't really move. and they don't serve each other you know des should be systems where I
> can with one click one button on the on the spectator in the reading page page, run a batch of matches and
> Sidhu's batch of of matches, choose like 10 or 20 matches. and the computer doesn't even run the the
> graphics only runs the the simulator. Impove this prompt with a lot more min/max statistics number of
> jumps, highet damages dealt/taken, damaged absorbed which every weapons, etc. make thousands of trees and
> branches from the initial arena with victories conditons and match-up combinaision to the end and how the
> game was, the distances, the difference in the fighters, their evolutions, the objects taken or destroyed
> or defended, attacked, etc. The AI models for the fighters also need to know the behaviors of the enemy
> (all their data and then probable strategies). To avoid streaming everything for players to keep the game
> at stable 60FPS but also overloading the backend with personnal informations, the frontend does the
> preprocessing during the game and share its report at the end of the party for the backend to process them
> and ad store and digest them into the new version of the ai and the game sfixes. Right know this is
> development mode so the updates can be done automaticallly but as the game progresses, there will be a
> time where I will need to review the updates being done to accept them or push them for later or derefuse
> thel"

**Decoded** (spoken → decoded → where it lands). Words I decoded rather than heard are flagged; the drift
here is heavy ("eating" is the recurring one) and getting one wrong changes the whole metric, so each flag
says what I assumed and why.

| spoken | decoded | flag | lands in |
| --- | --- | --- | --- |
| "number of seconds without eating anything" | seconds a fighter spends WITHOUT LANDING a hit (a "dry streak"); "eating" is the transcript's word for landing/taking a hit — read below both ways: a *dry streak* (you land nothing) and a *starved* streak (nobody lands on you) | **FLAG**: I read it as *landing* (the fighter's own offence), because "maximum number of seconds without eating anything" only makes sense as a drought you would want to bound | lane M-A |
| "the maximum number of seconds without eating anything, the minimum seconds" | the MAX and MIN dry-streak lengths per fighter, over the whole match | — | lane M-A |
| "without eating somebody / without eating two players" | the same streak for the pair: seconds where NO fighter lands, and seconds where neither fighter lands on the other | — | lane M-A |
| "the average distance and the median distance" | the fighter-to-fighter distance statistics: mean, median, min, max, p10/p90, and the time spent in named distance bands (contact / striking / circling / apart) | — | lane M-A |
| "the characters, they kind of move, but they don't really move. and they don't serve each other" | the fighters move about without ENGAGING: they do not close on each other, do not trade blows, and long stand-offs happen. **FLAG**: "serve each other" = engage/answer each other (voice drift on "engage"/"exchange") | **FLAG** | lane M-A (the metric) + lane M-B (the behaviour that fixes it) |
| "with one click one button on the spectator in the reading page, run a batch of matches … choose like 10 or 20 matches. and the computer doesn't even run the the graphics, only runs the the simulator" | one button on the Spectate screen (and the History screen — "the reading page") that runs a batch of 10/20/50/100 matches SIMULATOR-ONLY (no rendering) and shows the results | — | lane M-C |
| "a lot more min/max statistics, number of jumps, highest damages dealt/taken, damage absorbed, which every weapons, etc." | the report's statistic set grows: counts, min/max/mean/median/p10/p90 per variable, including jumps (count, peak height), the highest single hit dealt and taken, damage absorbed (blocked/guarded), and the same broken out PER WEAPON | — | lane M-A |
| "make thousands of trees and branches from the initial arena with victory conditions and match-up combinations to the end and how the game was" | a BRANCH TREE generator: from an initial arena (map/conditions), enumerate branches over victory conditions × match-up combinations, run them, and keep the branch structure — the path taken, not just the leaf record | — | lane M-D |
| "the distances, the difference in the fighters, their evolutions, the objects taken or destroyed or defended, attacked" | every node carries its own distance stats, the fighter difference (the stat gap), the fighters' evolution over the match, and the object events (taken / destroyed / defended / attacked) | — | lane M-A (measure) + lane M-D (structure) |
| "the AI models … also need to know the behaviors of the enemy (all their data and then probable strategies)" | each report carries an OPPONENT MODEL: the enemy's full behavioural data plus the probable strategy it was running (so a policy can learn to counter it) | — | lane M-E |
| "the frontend does the preprocessing during the game and share its report at the end of the party for the backend to process" | the browser computes everything live and emits ONE compact report at match end — no streaming during the fight (60 FPS), and no raw personal data leaves the machine | — | lane M-A (compute live) + lane M-E (the payload) |
| "Right now this is development mode so the updates can be done automatically but as the game progresses … review the updates … accept them or push them for later or refuse them" | the report/update pipeline has a REVIEW GATE with three verdicts (accept / defer / refuse), and a mode switch: auto-apply in development, review-required later | — | lane M-E |

**What already exists — extend it, do not rebuild it.** The paired session's Wave J shipped a headless back
end: `src/balance/MatchSim.ts` (the simulator), `src/balance/Batch.ts` (`runBatch(BatchOptions)`),
`src/balance/MatchRules.ts`, `src/balance/Summary.ts` (min/max/mean/median), `src/balance/arena-worker.ts`
(a worker), `src/balance/EvolutionHarness.ts`, `src/balance/Gradient.ts`, `src/balance/Neural*.ts`,
`src/game/TrainingRuns.ts`, `tools/batch.ts` and `tools/probe-batch.ts` (the template: `Deno.serve` on port
0, `runBatch` headless, records beside). `src/game/MatchHistory.ts` already has `describe(values)` →
`{n, mean, median, sd, min, max}` and the `MatchRecord`/`FighterRecord` shapes. `docs/SPEC.md` §11C's
`MatchRecord` already carries `statGap`. Wave M adds the NEW variables, the tree, the one-click UI and the
payload — it must reuse `runBatch`, `describe` and the existing record shape.

House rules binding every lane: pure modules where the logic lives (no DOM, no THREE, no `Math.random`),
TDD, comments say WHY with units, no `any` without a scoped ignore, never an inline `style="…"` attribute
(the page CSP), a claim without a tool's literal output is not evidence, and a bound that a deliberate
change makes false is RE-STATED from measurement in the docs rather than deleted.

---

## Lane M-A — `src/game/FightTelemetry.ts` (new) + `tests/fighttelemetry_test.ts` (new)

The live accumulator. One object per match, fed the fighters' positions and events each simulated step, read
once at the end. Pure: it takes numbers and returns numbers; the engine (parent) feeds it.

```ts
export interface DistanceBands { contact: number; striking: number; circling: number; apart: number }  // seconds
export interface StreakStats { count: number; totalS: number; meanS: number; maxS: number; minS: number }
export interface HitStat { count: number; total: number; max: number; mean: number }
export interface FightTelemetry {
  durationS: number;
  /** Per fighter (index 0/1): seconds with no landed hit (a DRY STREAK) and its max/min/mean. */
  dryStreak: [StreakStats, StreakStats];
  /** Seconds neither fighter lands on the other (the pair's starved time). */
  mutualDryS: number;
  /** Seconds where no hit at all lands, and the longest such stretch. */
  quietS: number;
  quietMaxS: number;
  distance: { mean: number; median: number; min: number; max: number; p10: number; p90: number };
  bands: DistanceBands;
  /** Engagement: seconds spent closing, seconds in contact, and the longest stand-off. */
  engagement: { closingS: number; contactS: number; standoffMaxS: number };
  jumps: [HitStat, HitStat];              // count + peak height (m) per fighter
  damageDealt: [HitStat, HitStat];
  damageTaken: [HitStat, HitStat];
  damageAbsorbed: [HitStat, HitStat];     // blocked / guarded / parried
  damageByWeapon: Record<string, HitStat>; // key = weapon archetype id
  objects: { taken: number; destroyed: number; defended: number; attacked: number };
  evolution: { level: number; statDelta: number }[];   // the fighters' own evolution, per event
}
export const CONTACT_M = 1.2, STRIKING_M = 2.6, CIRCLING_M = 6;   // distance band edges, metres
export function createTelemetry(): TelemetryAccumulator;
export function telemetrySummary(a: TelemetryAccumulator): FightTelemetry;
```

Requirements: every streak and distance statistic must be exact on a hand-built fixture (a scripted
sequence of positions/hits with a known answer, including a zero-hit match, a single-hit match, a match
where the fighters never move, and a match with one NaN step which must be REFUSED rather than poisoning the
mean). `quietS + landing time = durationS` must hold within 1e-9. The stall metric the user is asking about
must be named: `standoffMaxS` (the longest stretch with no hit and the distance above `CIRCLING_M`) and
`dryStreak[0].maxS`.

Evidence: `deno check`, the whole test file's pass count, `deno lint`, and a printed summary for one
scripted fixture.

## Lane M-B — `src/game/Engagement.ts` (new, edit only if needed `src/game/DecisionTree.ts`) + `tests/engagement_test.ts` (new)

The behaviour fix behind "they move but they don't really move… they don't serve each other": the fighters
must close and trade. A pure module that turns the live picture (distance, both fighters' cooldowns, health
shares, current stance, the last landing time) into an ENGAGEMENT INTENT the decision tree can act on:
`approach`, `hold`, `circle`, `disengage`, `bait`. It must (a) make a stand-off self-limiting — the longer
the quiet stretch, the stronger the pull to close — and (b) never let a fighter walk past its own striking
band. Assert: from a stand-off state the intent becomes `approach` within a bounded time; the intent is
deterministic; and over a scripted 60 s stand-off the produced `standoffMaxS` (through M-A) is bounded.

Evidence: `deno check`, tests, `deno lint`, and the measured stand-off before/after on a fixed seed.

## Lane M-C — `src/ui/BatchPanel.ts` (new) + `tests/batchpanel_test.ts` (new)

The one-click batch, as a PURE model first (the parent renders it):
`batchPlan(size)` → `{ matches: number; jobs: JobPlan[]; estimatedS: number }`, `batchSummary(records)` →
min/max/mean/median/p10/p90 per variable using `describe()` from `MatchHistory.ts`, and
`batchProgress(done, total)` → `{ fraction, done, total, etaS }`. Sizes allowed: 10 / 20 / 50 / 100, in the
simulator only (no graphics). The model must state the cost it promises: the lane measures its own
`estimatedS` against a real `runBatch` of 10 on this machine and reports both numbers.

Evidence: `deno check`, tests, `deno lint`, and the literal estimated-vs-actual timing.

## Lane M-D — `src/balance/BranchTree.ts` (new) + `tests/branchtree_test.ts` (new)

"Thousands of trees and branches from the initial arena with victory conditions and match-up combinations to
the end": a deterministic TREE generator over the existing batch back end.

```ts
export interface BranchPlan { arena: ArenaConfig; victory: string; matchups: [string, string][]; seed: number }
export function branchPlan(o: { seed: number; arenas?: number; victories?: number; maxBranches?: number }): BranchPlan[];
export interface BranchNode { id: string; parent: string | null; depth: number; venue: string; condition: string; matchup: string; outcome: string; telemetry: FightTelemetry }
export function buildBranchTree(plans: BranchPlan[], run: (p: BranchPlan) => MatchRecord, maxNodes: number): BranchTree;
export function summariseTree(t: BranchTree): TreeSummary;   // per depth: win rates, distance bands, stall, damage
```

The tree is bounded by BOTH node count and depth, and `summariseTree` must report the branch counts at each
depth rather than prose. Reuse `runBatch`/`MatchSim` — never a second simulator.

Evidence: `deno check`, tests, `deno lint`, and one real tree: node count, depth histogram, per-depth win
rates, printed.

## Lane M-E — `src/game/MatchReport.ts` (new) + `tests/matchreport_test.ts` (new)

The payload the browser hands the back end at the end of a match, and the review gate.

```ts
export const REPORT_SCHEMA = 1;
export interface OpponentModel {
  behavior: FightTelemetry;              // all of the enemy's own data
  probableStrategies: { id: string; weight: number }[];   // ranked, weights sum to 1
  habits: { openingMove: string; averageApproachS: number; retreatThreshold: number; favouredBand: string };
}
export interface MatchReport { schema: number; id: string; createdAt: string; telemetry: [FightTelemetry, FightTelemetry]; opponent: OpponentModel; outcome: string; tree?: { node: string; depth: number } }
export function buildReport(o: {...}): MatchReport;                  // compact: no raw positions, no names
export function isPersonalData(report: MatchReport): false;          // the payload's own privacy claim
export type Verdict = "accept" | "defer" | "refuse";
export function applyVerdict(q: QueuedUpdate, v: Verdict, mode: "auto" | "review"): QueueState;
export function autoVerdict(q: QueuedUpdate, policy: AutoPolicy): Verdict;   // dev mode: everything that passes the measured gate
```

Requirements: a report must be COMPACT (assert a cap in bytes for a fixed-length match, and that no name,
no id of a person and no raw coordinate array appears in it — the privacy claim is a test, not a comment);
`probableStrategies` weights are a distribution (sum ≈ 1, no negatives); the review gate keeps a `defer`red
update queued with its reason, and `auto` mode applies only what the policy allows and records why.

Evidence: `deno check`, tests, `deno lint`, the measured report size in bytes, and a printed queue through
accept/defer/refuse.

---

## Parent (only these files)

`src/engine/Engine.ts` (feed the live telemetry, emit the report at the end, run the batch from the UI),
`src/ui/Menu.ts` + `styles.css` (the Spectate and History screens' "Run batch" button and its size picker;
lane M-C's plan does the model), `tools/probe-wave-m.ts` (new: a real 20-match headless batch from the UI
button, the report at match end, the tree's printed summary), `docs/SPEC.md` §11E,
`docs/telemetry/REPORT.md`, `artifacts/telemetry/VERIFICATION.md`, `artifacts/data-science.md` (new pass),
the commit.

## Acceptance

1. A finished match yields a report whose telemetry carries the dry/quiet streaks, the distance statistics
   (mean, median, min, max, p10/p90), the bands, jumps, the highest damages, damage absorbed and the per-weapon
   table — all measured, all in one payload sent once at the end.
2. The stand-off the user described is MEASURED (`standoffMaxS`) and ANSWERED (the engagement intent bounds it).
3. The Spectate/History screen has one button that runs 10/20/50/100 matches with no rendering, and prints the
   min/max/mean/median summary.
4. A branch tree over victory conditions × matchups is generated, bounded, and summarised per depth.
5. The report carries the opponent model (behaviour + probable strategies) and the update gate takes
   accept / defer / refuse with an auto mode for development.
6. `deno task check` 0 errors · `deno task test` green · `deno lint` clean · `deno task build` ·
   `deno run -A tools/probe-wave-m.ts` with 0 page errors and the printed numbers.
