// Wave Q: run the LADDER headless and print the step-by-step progression.
//
// "the generating process by batch … needs to generate different cases and … step-by-step … from
// functioning games to the functioning type of games."
//
// Each step generates different cases (a design cell + its own seed), scores them with the criteria in
// src/balance/Ladder.ts, keeps the survivors and mutates them into the next step, so the printed table
// reads as a progression rather than a single flat batch.
//
// Run: deno run -A tools/evolution-ladder.ts [steps=6] [cases=4] [matches=10] [keep=2]
// Writes artifacts/parts/ladder.json
//
// ONE HONEST SUBSTITUTION, stated because it is a measurement choice: `engagement` is measured from the
// headless records as the share of matches in which BOTH seats landed damage. Wave M's stricter
// "time both fighters spent inside striking range" lives in the frontend telemetry accumulator and is not
// in a MatchRecord, so the ladder uses the closest number the batch can actually produce.

import { runBatch } from "../src/balance/Batch.ts";
import { metricsOf } from "../src/balance/Summary.ts";
import { clusterOf, CRITERIA, initialCases, majorityType, mutateCases, prunedCells, scoreCase, selectCases, type Case, type CaseMetrics } from "../src/balance/Ladder.ts";
import type { DesignKind } from "../src/balance/Gradient.ts";
import type { MatchRecord } from "../src/game/arena/contracts.ts";

const [stepsArg, casesArg, matchesArg, keepArg] = Deno.args;
const STEPS = Number(stepsArg ?? 6);
const CASES = Number(casesArg ?? 4);
const MATCHES = Number(matchesArg ?? 10);
const KEEP = Number(keepArg ?? 2);
const SEED = 20261031;

/** The design cells the ladder walks: one per DesignKind the batch back end knows. */
const CELLS: readonly DesignKind[] = ["all", "corner", "extreme", "grid", "random", "invariant"];
const kindOf = (cell: number): DesignKind => (cell < 0 ? "all" : CELLS[cell % CELLS.length]);

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

/** Score one case from its records (the criteria in the contract, each in [0,1]). */
function measure(records: readonly MatchRecord[]): CaseMetrics {
  const ms = records.map(metricsOf);
  const n = Math.max(1, ms.length);
  const ended = ms.filter((m) => m.ko === 1 || m.ringout === 1).length;
  const bothLanded = records.filter((r) => r.outcome.damageDealt[0] > 0 && r.outcome.damageDealt[1] > 0).length;
  const winA = ms.reduce((a, m) => a + m.winA, 0) / n;
  const endings = new Set(records.map((r) => r.outcome.reason ?? "unknown"));
  const counts = new Map<string, number>();
  for (const r of records) counts.set(r.outcome.reason ?? "unknown", (counts.get(r.outcome.reason ?? "unknown") ?? 0) + 1);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
  return {
    decisiveness: ended / n,
    closeness: 1 - Math.abs(winA - 0.5) * 2,
    engagement: bothLanded / n,
    mix: Math.min(1, endings.size / 3),
    medianSeconds: median(records.map((r) => r.outcome.duration)),
    dominantEnding: dominant,
  };
}

const api = runBatch as unknown as (o: { matches: number; seed: number; design: DesignKind }) => MatchRecord[];
const t0 = performance.now();
let cases: Case[] = initialCases(CELLS.length, CASES, SEED, MATCHES);
const history: { step: number; cases: { cell: number; kind: string; seed: number; m: CaseMetrics; score: number; survived: boolean }[]; kept: number; archetype: string | null; cluster: string | null }[] = [];
let archetypeFirstSeen: { step: number; label: string; persisted: number } | null = null;

for (let step = 0; step < STEPS; step++) {
  const scored = cases.map((c) => ({ c, m: measure(api({ matches: c.matches, seed: c.seed, design: kindOf(c.cell) })) }));
  const survivors = selectCases(scored, KEEP);
  const arch = majorityType(survivors);
  const prunedNow = prunedCells(history);
  const survivedSeeds = new Set(survivors.map((s) => s.c.seed));
  history.push({
    step,
    cases: scored.map(({ c, m }) => ({ cell: c.cell, kind: kindOf(c.cell), seed: c.seed, m, score: scoreCase(m), survived: survivedSeeds.has(c.seed) })),
    kept: survivors.length,
    archetype: arch?.label ?? null,
    cluster: `${clusterOf(survivors)?.label ?? "-"} (${clusterOf(survivors)?.agree ?? 0}/${survivors.length} agree)`,
  });
  // "First AGREED type" means the FIRST step at which the survivors agreed — not the last. (The first
  // run of this tool overwrote it on every change and reported step 5 when the answer was step 3.)
  if (arch && archetypeFirstSeen === null) archetypeFirstSeen = { step, label: arch.label, persisted: 1 };
  else if (arch && archetypeFirstSeen && arch.label === archetypeFirstSeen.label) archetypeFirstSeen.persisted++;
  cases = mutateCases(survivors, CELLS.length, CASES, step + 1, prunedNow);
}
const ms = Math.round(performance.now() - t0);

// ── the printed progression ───────────────────────────────────────────────────────
console.log(`LADDER  steps=${STEPS} cases=${CASES} matches/case=${MATCHES} keep=${KEEP} seed=${SEED}`);
console.log(`criteria: ${CRITERIA.map((c) => `${c.key} (w ${c.weight})`).join(" · ")}\n`);
console.log("step case  design     seed        decis  engage  close  mix   score  kept");
for (const h of history) {
  for (const c of h.cases) {
    console.log(
      `${String(h.step).padEnd(4)} ${String(c.kind).padEnd(9)} ${String(c.seed).padEnd(11)} ` +
        `${c.m.decisiveness.toFixed(2)}   ${c.m.engagement.toFixed(2)}    ${c.m.closeness.toFixed(2)}   ${c.m.mix.toFixed(2)}  ` +
        `${c.score.toFixed(4)} ${c.survived ? "  *" : ""}`,
    );
  }
  console.log(`     -> step ${h.step}: ${h.kept} kept · type ${h.archetype ?? "not yet"} · leading cluster ${h.cluster}`);
}
const clusters = history.map((h) => h.cluster);
console.log(`pruned cells (never a type of game): ${prunedCells(history).map((c) => `${c}=${CELLS[c % CELLS.length]}`).join(", ") || "none"}`);
console.log(`\nfirst AGREED archetype: step ${archetypeFirstSeen?.step ?? "-"} ${archetypeFirstSeen?.label ?? "(none — the survivors never all agreed, see the per-step clusters above)"}`);
console.log(`leading cluster per step: ${clusters.join(" | ")}`);
console.log(`wall ${ms} ms`);

const outDir = "artifacts/parts";
await Deno.mkdir(outDir, { recursive: true });
await Deno.writeTextFile(
  `${outDir}/ladder.json`,
  JSON.stringify({ options: { STEPS, CASES, MATCHES, KEEP, SEED }, criteria: CRITERIA, history, archetypeFirstSeen, wallMs: ms }, null, 1),
);
