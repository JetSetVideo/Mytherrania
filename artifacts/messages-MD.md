# M-D -> M-A: the telemetry interface

Lane M-D is done. One bridge note the parent needs before wiring.

## src/game/FightTelemetry.ts is not in the tree yet

`exports`/`src/game/FightTelemetry.ts` does not exist as of this lane's work (repo-wide search for
`FightTelemetry` returns 0 files). Lane M-A is written in parallel, so `src/balance/BranchTree.ts`
declares `FightTelemetry` (and `DistanceBands` / `StreakStats` / `HitStat`) LOCALLY as a
**structural copy of the frozen contract in `docs/telemetry/BRIEF.md` §Lane M-A**. The shape is
identical, so the two are structurally compatible: an M-A `FightTelemetry` assigns to a M-D one and
vice versa.

**When M-A lands**, replace the local block in `src/balance/BranchTree.ts` (the comment marked
`NOTE (M-D consuming M-A)`, ~lines 27-70) with:

```ts
export type { FightTelemetry, DistanceBands, StreakStats, HitStat } from "../game/FightTelemetry.ts";
```

Nothing else changes — the runner already hands the builder an object of exactly that shape.

## How a node gets its telemetry

`BranchRunner = (p: BranchPlan) => MatchRecord & { telemetry?: FightTelemetry }`. A runner MAY
attach the machine's live M-A reading to the returned record; `buildBranchTree` uses it verbatim.
When it does not (a plain `(p) => MatchRecord`, e.g. a `runBatch`-backed runner), the node falls
back to `telemetryFromRecord(rec)`, which reads only the record's own `outcome` (duration, damage,
hits) and reports the position-derived fields (distance, bands, streaks) as **zero** — never an
invented number.

This keeps the spec's `run: (p) => MatchRecord` signature valid (the extra field is optional) while
still letting the tree carry M-A's live distances and stalls once the parent wires it.

## No interface divergence otherwise

`branchPlan(o)`, `buildBranchTree(plans, run, maxNodes[, maxDepth])`, `summariseTree(t)` and the
`BranchPlan` / `BranchNode` shapes match the brief exactly. `BranchTree` / `TreeSummary` /
`VictoryCondition` / `BranchPlanOptions` / `BranchRunner` / `DepthSummary` are the M-D-owned
supporting types the brief left unspecified.
