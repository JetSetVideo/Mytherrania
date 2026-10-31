// Wave Q: the LADDER's pure rules — deterministic generation, scored selection, mutation, pruning and
// the majority definition of a "type of game". The simulator is faked here: these tests are about the
// SEARCH's own logic (the records-based measurement lives in tools/evolution-ladder.ts).
import { clusterOf, CRITERIA, initialCases, majorityType, mutateCases, nextSeed, prunedCells, scoreCase, selectCases, type Case, type CaseMetrics } from "../src/balance/Ladder.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok {
  if (!ok) throw new Error(m);
}

const metrics = (o: Partial<CaseMetrics>): CaseMetrics => ({
  decisiveness: 1, closeness: 1, engagement: 1, mix: 1, medianSeconds: 30, dominantEnding: "ko", ...o,
});
const c = (cell: number, seed: number): Case => ({ cell, seed, matches: 10 });

Deno.test("the criteria are stated, weighted, and sum to 1", () => {
  const sum = CRITERIA.reduce((a, x) => a + x.weight, 0);
  assert(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}`);
  assert(CRITERIA.every((x) => x.why.length > 10), "every criterion states WHY");
  assert(scoreCase(metrics({})) === 1, "a perfect case scores 1");
  assert(scoreCase(metrics({ decisiveness: 0, closeness: 0, engagement: 0, mix: 0 })) === 0, "a dead case scores 0");
});

Deno.test("the score is bounded even when a metric leaves [0,1]", () => {
  const s = scoreCase(metrics({ decisiveness: 5, engagement: -3 }));
  assert(s >= 0 && s <= 1, `score ${s} out of range`);
});

Deno.test("step 0 generates DIFFERENT cases, deterministically", () => {
  const a = initialCases(6, 4, 1234, 10);
  const b = initialCases(6, 4, 1234, 10);
  assert(JSON.stringify(a) === JSON.stringify(b), "same seed -> same cases");
  assert(new Set(a.map((x) => x.seed)).size === a.length, "every case has its own seed");
  assert(a[0].cell === -1, "the first case is the mixed design");
  assert(new Set(a.slice(1).map((x) => x.cell)).size === a.length - 1, "the rest cover different cells");
  const other = initialCases(6, 4, 1235, 10);
  assert(JSON.stringify(other) !== JSON.stringify(a), "a different seed -> different cases");
});

Deno.test("selection keeps the best, is stable on ties and never returns more than asked", () => {
  const scored = [
    { c: c(1, 10), m: metrics({ decisiveness: 0.5 }) },
    { c: c(2, 20), m: metrics({ decisiveness: 1 }) },
    { c: c(3, 30), m: metrics({ decisiveness: 0.7 }) },
  ];
  const kept = selectCases(scored, 2);
  assert(kept.length === 2, "keeps exactly `keep`");
  assert(kept[0].c.seed === 20, "the best first");
  const tie = selectCases([{ c: c(1, 99), m: metrics({}) }, { c: c(2, 5), m: metrics({}) }], 1);
  assert(tie[0].c.seed === 5, "ties break by the case's own seed (stable, not by insertion order)");
  assert(selectCases(scored, 99).length === 3, "asking for more than we have keeps all");
});

Deno.test("mutation moves around the survivors, never repeats a case, and leaves the pruned cells", () => {
  const survivors = [{ c: c(2, 111) }, { c: c(4, 222) }];
  const next = mutateCases(survivors, 6, 4, 1);
  assert(next.length === 4, "generates the asked number of cases");
  assert(next.every((x) => x.cell >= 0 && x.cell < 6), "every cell is inside the ring");
  assert(new Set(next.map((x) => x.seed)).size === 4, "four fresh seeds");
  assert(!next.some((x) => x.seed === 111 || x.seed === 222), "no case is replayed verbatim");
  const avoided = mutateCases(survivors, 6, 4, 1, [3, 4, 5]);
  assert(avoided.every((x) => !(x.cell >= 3 && x.cell <= 5)), `pruned cells leaked back: ${avoided.map((x) => x.cell)}`);
});

Deno.test("a mixed survivor no longer produces mixed children (the collapse this tool measured)", () => {
  const next = mutateCases([{ c: c(-1, 7) }], 6, 3, 2);
  assert(next.every((x) => x.cell >= 0), `mixed children survived: ${JSON.stringify(next)}`);
  assert(new Set(next.map((x) => x.cell)).size === 3, "a mixed parent seeds DIFFERENT cells");
});

Deno.test("a cell that never clears the bar is pruned after the stated number of steps", () => {
  const low = (cell: number, score: number) => ({ cases: [{ cell, score }] });
  assert(JSON.stringify(prunedCells([low(5, 0.63), low(5, 0.69)])) === "[5]", "two low steps prune the cell");
  assert(prunedCells([low(5, 0.63)]).length === 0, "one step is not enough");
  assert(prunedCells([low(5, 0.63), low(5, 0.9)]).length === 0, "one good step rescues the cell");
});

Deno.test("a TYPE needs a majority, not unanimity — and the count is reported", () => {
  const three = [
    { c: c(2, 1), m: metrics({ dominantEnding: "ko" }) },
    { c: c(2, 2), m: metrics({ dominantEnding: "ko" }) },
    { c: c(4, 3), m: metrics({ dominantEnding: "ringout" }) },
  ];
  const type = majorityType(three);
  assert(type !== null, "2 of 3 is a majority");
  assert(type!.label === "cell 2 · ko" && type!.agree === 2 && type!.need === 2, JSON.stringify(type));
  const split = [
    { c: c(2, 1), m: metrics({ dominantEnding: "ko" }) },
    { c: c(3, 2), m: metrics({ dominantEnding: "ringout" }) },
    { c: c(4, 3), m: metrics({ dominantEnding: "time" }) },
  ];
  assert(majorityType(split) === null, "a three-way split is not a type");
  const four = [
    { c: c(1, 1), m: metrics({ dominantEnding: "ko" }) },
    { c: c(1, 2), m: metrics({ dominantEnding: "ko" }) },
    { c: c(1, 3), m: metrics({ dominantEnding: "ko" }) },
    { c: c(1, 4), m: metrics({ dominantEnding: "ringout" }) },
  ];
  const t4 = majorityType(four);
  assert(t4 !== null && t4.agree === 3 && t4.need === 3, `3 of 4 must be a type: ${JSON.stringify(t4)}`);
  assert(clusterOf(four)!.agree === 3, "the cluster count is the number of agreeing survivors");
});

Deno.test("the seed rule is a stated LCG: deterministic, different per (step, index), never zero-ish", () => {
  const a = nextSeed(20261031, 0, 0);
  assert(a === nextSeed(20261031, 0, 0), "same inputs -> same seed");
  assert(a !== nextSeed(20261031, 0, 1), "different index -> different seed");
  assert(a !== nextSeed(20261031, 1, 0), "different step -> different seed");
  const seeds = new Set(Array.from({ length: 200 }, (_, i) => nextSeed(20261031, i % 10, i)));
  assert(seeds.size === 200, `200 distinct seeds expected, got ${seeds.size}`);
  for (const s of seeds) assert(Number.isInteger(s) && s >= 0 && s <= 0xffffffff, `seed ${s} out of uint32 range`);
});