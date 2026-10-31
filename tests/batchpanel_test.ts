// Wave M (lane M-C): the one-click batch model. Pure: no DOM, no worker, no Math.random.
//   plan    — sizes, one job per match with its own seed, the promised cost;
//   progress — fraction / done / total / eta, total over bad input;
//   summary  — min/max/mean/median/sd/p10/p90 per variable, on describe().
import {
  BATCH_SIZES,
  BATCH_VARIABLES,
  batchPlan,
  batchProgress,
  batchSummary,
  isBatchSize,
  PER_MATCH_MS,
} from "../src/ui/BatchPanel.ts";
import { describe } from "../src/game/MatchHistory.ts";
import type { EndReason, MatchConditions, MatchOutcome, MatchRecord } from "../src/game/arena/contracts.ts";

function assert(ok: unknown, msg: string): asserts ok { if (!ok) throw new Error(msg); }

/** A record with only the outcome fields batchSummary reads; conditions are never touched. */
function rec(o: Partial<MatchOutcome>): MatchRecord {
  const outcome: MatchOutcome = {
    winner: 0, reason: "ko", duration: 0, hpLeft: [0, 0], hpFracLeft: [0, 0],
    damageDealt: [0, 0], hits: [0, 0], swings: [0, 0], wallHits: [0, 0], edgeTime: [0, 0],
    ...o,
  };
  return { conditions: {} as unknown as MatchConditions, outcome };
}

Deno.test("M-C P1: the button offers 10/20/50/100 and nothing else", () => {
  assert(JSON.stringify(BATCH_SIZES) === "[10,20,50,100]", `sizes ${BATCH_SIZES}`);
  for (const n of BATCH_SIZES) assert(isBatchSize(n), `${n} allowed`);
  for (const n of [0, 5, 25, 200, -10]) assert(!isBatchSize(n), `${n} refused`);
});

Deno.test("M-C P2: batchPlan — one job per match, a distinct seed each, and the promised cost", () => {
  const p = batchPlan(20, 20261031, "all");
  assert(p.matches === 20, `matches ${p.matches}`);
  assert(p.jobs.length === 20, `jobs ${p.jobs.length}`);
  assert(p.jobs.every((j, i) => j.index === i && j.design === "all"), "index and design per job");
  assert(new Set(p.jobs.map((j) => j.seed)).size === 20, "every job has its own seed");
  assert(Math.abs(p.estimatedS - (20 * PER_MATCH_MS) / 1000) < 1e-12, `estimatedS ${p.estimatedS}`);
  // Same inputs -> identical plan; the seed is the only source of variation.
  assert(JSON.stringify(batchPlan(20, 20261031, "all")) === JSON.stringify(p), "deterministic");
  assert(JSON.stringify(batchPlan(20, 7, "all")) !== JSON.stringify(p), "a new seed makes a new plan");
});

Deno.test("M-C P3: batchPlan is total — 0, negative and non-finite sizes yield an empty plan", () => {
  for (const bad of [0, -5, NaN, Infinity, 3.9]) {
    const p = batchPlan(bad, 1, "random");
    const want = bad === 3.9 ? 3 : 0; // floored to a whole number of matches
    assert(p.matches === want && p.jobs.length === want, `size ${bad} -> ${p.matches}`);
    assert(Number.isFinite(p.estimatedS) && p.estimatedS >= 0, `estimate ${p.estimatedS}`);
    if (want > 0) assert(p.jobs[0].design === "random", "the design reaches every job");
  }
  assert(batchPlan(10, 1).jobs[0].design === "all", "design defaults to all");
});

Deno.test("M-C P4: batchProgress — fraction, done, total and the ETA the plan promises", () => {
  const plan = batchPlan(100, 5);
  const start = batchProgress(0, plan.matches, plan.estimatedS);
  assert(start.fraction === 0 && start.done === 0 && start.total === 100, JSON.stringify(start));
  assert(Math.abs(start.etaS - plan.estimatedS) < 1e-12, `full ETA ${start.etaS}`);
  const half = batchProgress(50, 100, plan.estimatedS);
  assert(half.fraction === 0.5 && Math.abs(half.etaS - plan.estimatedS / 2) < 1e-12, JSON.stringify(half));
  const done = batchProgress(100, 100, plan.estimatedS);
  assert(done.fraction === 1 && done.etaS === 0, JSON.stringify(done));
  // Default estimate is the plan's own promise.
  assert(Math.abs(batchProgress(0, 100).etaS - (100 * PER_MATCH_MS) / 1000) < 1e-12, "default ETA");
});

Deno.test("M-C P5: batchProgress is total — clamps, an empty batch reads complete, no NaN ETA", () => {
  assert(batchProgress(150, 100).done === 100 && batchProgress(150, 100).fraction === 1, "done clamps to total");
  assert(batchProgress(-5, 100).done === 0 && batchProgress(-5, 100).fraction === 0, "done clamps to 0");
  const empty = batchProgress(0, 0);
  assert(empty.fraction === 1 && empty.total === 0 && empty.etaS === 0, `empty ${JSON.stringify(empty)}`);
  for (const v of [batchProgress(NaN, 100), batchProgress(10, NaN), batchProgress(10, 100, NaN)]) {
    assert(Number.isFinite(v.fraction) && Number.isFinite(v.etaS), `finite ${JSON.stringify(v)}`);
  }
});

Deno.test("M-C P6: batchSummary — known numbers, and describe() is the source of the core six", () => {
  const records = [rec({ duration: 10 }), rec({ duration: 20 }), rec({ duration: 30 })];
  const duration = batchSummary(records).variables.duration;
  const v = [10, 20, 30];
  const d = describe(v); // the repo's own describe(), re-derived here for comparison
  assert(duration.n === 3 && duration.min === 10 && duration.max === 30, JSON.stringify(duration));
  assert(duration.mean === d.mean && duration.median === d.median && duration.sd === d.sd, "core six from describe");
  assert(Math.abs(duration.p10 - 12) < 1e-9 && Math.abs(duration.p90 - 28) < 1e-9, `p10/p90 ${duration.p10}/${duration.p90}`);
});

Deno.test("M-C P7: batchSummary — every variable, the end-reason tally, and totals over empty/NaN", () => {
  const records = [
    rec({ reason: "ko", duration: 10, damageDealt: [5, 3], hits: [2, 1], hpFracLeft: [0.4, 0.7] }),
    rec({ reason: "ko", duration: 20, damageDealt: [7, 9], hits: [4, 3], hpFracLeft: [0.1, 0.9] }),
    rec({ reason: "ringout", duration: NaN, damageDealt: [NaN, 4], hits: [1, 2], hpFracLeft: [0.5, 0.2] }),
  ];
  const s = batchSummary(records);
  assert(s.matches === 3, `matches ${s.matches}`);
  assert(JSON.stringify(s.reasons) === JSON.stringify({ ko: 2, ringout: 1 }), `reasons ${JSON.stringify(s.reasons)}`);
  for (const v of BATCH_VARIABLES) assert(v.key in s.variables, `variable ${v.key} reported`);
  // A non-finite value is dropped from its column but not from the others' counts.
  assert(s.variables.duration.n === 2 && s.variables.damageB.n === 3, "NaN dropped per column");
  assert(s.variables.damageA.n === 2 && s.variables.damageA.max === 7, "damageA ignores the NaN");
  const empty = batchSummary([]);
  assert(empty.matches === 0 && empty.variables.duration.n === 0 && empty.variables.duration.mean === 0, "empty batch");
  assert(Object.keys(empty.reasons).length === 0, "no reasons on an empty batch");
});

Deno.test("M-C P8: the summary is total over every end reason", () => {
  const reasons: EndReason[] = ["ko", "ringout", "time", "draw", "error"];
  const s = batchSummary(reasons.map((reason, i) => rec({ reason, duration: i })));
  assert(Object.keys(s.reasons).length === 5, `five reasons tallied: ${JSON.stringify(s.reasons)}`);
});
