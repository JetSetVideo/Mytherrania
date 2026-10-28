import { axisCoords, runCorpus, sampleMatchup, simulateBattle } from "../src/balance/BattleCorpus.ts";
import { randomSource } from "../src/balance/ArenaHarness.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }

Deno.test("a corpus run produces one record per fight, each with a decided winner path", () => {
  const recs = runCorpus({ seed: 7, fights: 60, exploreBias: 0.4 });
  assert(recs.length === 60, "one record per fight");
  for (const r of recs) {
    assert(r.reason.length > 0, "every fight has a reason");
    assert(r.duration > 0, "every fight lasts some time");
    assert(r.coords.length === 6, "six axes recorded");
    assert(r.dealtA.n >= 0 && r.dealtB.n >= 0, "damage series folded");
  }
});

Deno.test("death is always a possible ending and the corpus is reproducible", () => {
  const a = runCorpus({ seed: 99, fights: 40, exploreBias: 0 });
  const b = runCorpus({ seed: 99, fights: 40, exploreBias: 0 });
  assert(a.every((r, i) => r.reason === b[i].reason && r.winner === b[i].winner), "same seed, same corpus");
  assert(a.some((r) => r.reason === "ko"), "KO appears when exploration is off");
});

Deno.test("exploration spreads the ending reasons across the win conditions", () => {
  const recs = runCorpus({ seed: 5, fights: 300, exploreBias: 0.7 });
  const reasons = new Set(recs.map((r) => r.reason));
  assert(reasons.size >= 3, `expected >=3 ending reasons, saw ${[...reasons].join(",")}`);
});

Deno.test("match-ups span classes, races, arena sizes and conditions", () => {
  const rng = randomSource(3);
  const classes = new Set<string>(), races = new Set<string>(), conds = new Set<string>();
  let minSize = Infinity, maxSize = -Infinity;
  for (let i = 0; i < 400; i++) {
    const ax = sampleMatchup(rng, 0.5);
    classes.add(ax.classA); classes.add(ax.classB);
    races.add(ax.raceA); races.add(ax.raceB);
    conds.add(ax.winCondition.kind);
    minSize = Math.min(minSize, ax.arenaSize); maxSize = Math.max(maxSize, ax.arenaSize);
  }
  assert(classes.size >= 6, `classes sampled: ${classes.size}`);
  assert(races.size >= 3, `races sampled: ${races.size}`);
  assert(conds.size >= 3, `conditions sampled: ${conds.size}`);
  assert(minSize >= 2 && maxSize <= 320, "arena size within the parameter bounds");
});

Deno.test("axisCoords normalises every axis into 0..1", () => {
  const rng = randomSource(11);
  for (let i = 0; i < 100; i++) {
    const c = axisCoords(sampleMatchup(rng, 0.5));
    assert(c.length === 6, "six coords");
    for (const v of c) assert(v >= 0 && v <= 1, `coord ${v} in [0,1]`);
  }
});

Deno.test("a single battle terminates with a winner or a decided draw", () => {
  const rng = randomSource(21);
  for (let i = 0; i < 30; i++) {
    const r = simulateBattle(sampleMatchup(rng, 0.5), rng);
    assert(r.exchanges > 0, "at least one exchange");
    assert(r.winner === 0 || r.winner === 1 || r.winner === null, "decided");
  }
});
