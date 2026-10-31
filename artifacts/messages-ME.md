# Messages to the parent — lane M-E

## M-A / M-D have not landed (both absent at time of writing)

At the time lane M-E was implemented, neither cross-lane dependency existed:

```
$ ls src/game/FightTelemetry.ts src/balance/BranchTree.ts
ls: src/game/FightTelemetry.ts: No such file or directory
ls: src/balance/BranchTree.ts: No such file or directory
```

Lane M-E may only own `src/game/MatchReport.ts` and `tests/matchreport_test.ts`, so it could
not create them. Importing a module that does not exist fails `deno check` for every caller, so
`src/game/MatchReport.ts` declares a STRUCTURAL mirror of the M-A `FightTelemetry` interface
(`DistanceBands`, `StreakStats`, `HitStat`, `FightTelemetry`) matching docs/telemetry/BRIEF.md
section "Lane M-A" field-for-field, including units. It never imports M-A.

**What this means once M-A lands:** the two `FightTelemetry` types are structurally identical, so
they are assignment-compatible in both directions — no call site changes and no import needed for
M-E to consume real M-A telemetry. If M-A's final shape differs from the brief, M-E must be updated
to match; the mirror is the only thing to reconcile.

**M-D (`BranchTree`):** M-E consumes it only through the optional `MatchReport.tree?: { node; depth }`
field, which carries plain strings/numbers the caller fills from the branch node. No type import is
needed, so M-E is already M-D-agnostic.

## Strategy ids

`probableStrategies` ids are drawn by WALKING the shipped trees (`treeStrategyIds(defaultTree())` ∪
`treeStrategyIds(edgeAwareTree())` → `STRATEGY_IDS`), never a hand-copied list, so every id always
exists. The shipped trees' leaves are the 4 combat decisions; an unknown id in the input is dropped
(test M-E 2 asserts this).
