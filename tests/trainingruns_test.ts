import { aggregateRuns, drainPlan, expandPlan, planSize, type TrainingPlan } from "../src/game/TrainingRuns.ts";
import { CLASSES } from "../src/game/Stats.ts";
import { RACES } from "../src/game/Races.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

const RACE_IDS = RACES.map((r) => r.id);

function plan(over: Partial<TrainingPlan> = {}): TrainingPlan {
  return {
    rounds: 1,
    seed: 1,
    classes: ["Warrior", "Mage"],
    races: ["human", "elf"],
    speedId: "normal",
    lengthId: "standard",
    arenaSizeMin: 4,
    arenaSizeMax: 9,
    ...over,
  };
}

// ------------------------------------------------------------------ expansion

Deno.test("expandPlan is deterministic: the same plan gives the same list", () => {
  const a = expandPlan(plan());
  const b = expandPlan(plan());
  assert(a.length === b.length, "same plan must produce the same count");
  assert(JSON.stringify(a) === JSON.stringify(b), "same plan must produce an identical list");
});

Deno.test("a different seed changes the arenas", () => {
  const a = expandPlan(plan({ seed: 1 }));
  const b = expandPlan(plan({ seed: 2 }));
  assert(a.length === b.length, "the seed must not change the count");
  const same = a.every((m, i) => m.arenaSize === b[i].arenaSize);
  assert(!same, "different seeds should not give every arena the same size");
});

Deno.test("the per-matchup seed is derived from the plan seed, and entries differ", () => {
  const a = expandPlan(plan({ seed: 42 }));
  const b = expandPlan(plan({ seed: 42 }));
  assert(a.every((m, i) => m.seed === b[i].seed), "the same plan seed must give the same matchup seeds");
  const c = expandPlan(plan({ seed: 43 }));
  assert(a.some((m, i) => m.seed !== c[i].seed), "a different plan seed should move the matchup seeds");
  assert(new Set(a.map((m) => m.seed)).size === a.length, "matchup seeds should be distinct within a plan");
});

Deno.test("planSize equals the length of expandPlan", () => {
  for (const p of [plan(), plan({ rounds: 3 }), plan({ classes: [], races: [] }), plan({ classes: ["Warrior"], races: ["human"] })]) {
    assert(planSize(p) === expandPlan(p).length, `planSize ${planSize(p)} != expandPlan length ${expandPlan(p).length}`);
  }
});

Deno.test("an empty classes list means every class in the game is used", () => {
  const p = plan({ classes: [] });
  assert(planSize(p) === CLASSES.length * CLASSES.length * 2 * 2, "empty classes should expand to the full roster");
  const seen = new Set(expandPlan(p).map((m) => m.classA));
  for (const c of CLASSES) assert(seen.has(c), `class ${c} missing from an all-classes sweep`);
});

Deno.test("an empty races list means every race in the game is used", () => {
  const p = plan({ races: [] });
  const seen = new Set(expandPlan(p).map((m) => m.raceA));
  for (const r of RACE_IDS) assert(seen.has(r), `race ${r} missing from an all-races sweep`);
});

Deno.test("every ordered class pair appears, including both directions of a mirror", () => {
  const classes = ["Warrior", "Mage", "Rogue"];
  const out = expandPlan(plan({ classes, races: ["human"] }));
  const count = new Map<string, number>();
  for (const m of out) count.set(`${m.classA}|${m.classB}`, (count.get(`${m.classA}|${m.classB}`) ?? 0) + 1);
  for (const a of classes) {
    for (const b of classes) {
      assert((count.get(`${a}|${b}`) ?? 0) === 1, `pair ${a} vs ${b} should appear exactly once per round`);
    }
  }
  // The mirror is a distinct entry, not the same one.
  assert(count.has("Warrior|Mage") && count.has("Mage|Warrior"), "a mirror matchup must be present in both directions");
});

Deno.test("every ordered race pairing is crossed with every class pairing", () => {
  const classes = ["Warrior", "Mage"];
  const races = ["human", "elf", "dwarf"];
  const out = expandPlan(plan({ classes, races }));
  assert(out.length === 2 * 2 * 3 * 3, `expected 36 matchups, got ${out.length}`);
  const combos = new Set(out.map((m) => `${m.classA}|${m.classB}|${m.raceA}|${m.raceB}`));
  assert(combos.size === 36, "every class pair x race pair combination should be distinct");
});

Deno.test("rounds multiply the matchup count", () => {
  const one = expandPlan(plan({ rounds: 1 }));
  const three = expandPlan(plan({ rounds: 3 }));
  assert(three.length === one.length * 3, `rounds should multiply the count, got ${three.length} vs ${one.length}`);
  assert(planSize(plan({ rounds: 3 })) === planSize(plan({ rounds: 1 })) * 3, "planSize should scale with rounds");
});

// ------------------------------------------------------------------- arena band

Deno.test("arena sizes stay inside [min, max]", () => {
  const out = expandPlan(plan({ arenaSizeMin: 4, arenaSizeMax: 9, rounds: 5, classes: [], races: [] }));
  for (const m of out) {
    assert(Number.isInteger(m.arenaSize), `arena size ${m.arenaSize} should be an integer`);
    assert(m.arenaSize >= 4 && m.arenaSize <= 9, `arena size ${m.arenaSize} outside [4, 9]`);
  }
});

Deno.test("min > max is tolerated by swapping the ends", () => {
  const out = expandPlan(plan({ arenaSizeMin: 10, arenaSizeMax: 3, rounds: 4 }));
  for (const m of out) assert(m.arenaSize >= 3 && m.arenaSize <= 10, `arena size ${m.arenaSize} outside the swapped [3, 10]`);
});

Deno.test("a degenerate band (min == max) always gives that exact size", () => {
  const out = expandPlan(plan({ arenaSizeMin: 7, arenaSizeMax: 7, rounds: 3 }));
  assert(out.every((m) => m.arenaSize === 7), "a single-value band must pin the arena size");
});

// ------------------------------------------------------------------- batching

Deno.test("drainPlan covers every matchup exactly once across its batches", () => {
  const p = plan({ rounds: 2, classes: ["Warrior", "Mage", "Rogue"], races: ["human", "elf"] });
  const expected = expandPlan(p);
  const batches = drainPlan(p, 5);
  const flat = batches.flat();
  assert(flat.length === expected.length, `drainPlan dropped matchups: ${flat.length} vs ${expected.length}`);
  assert(JSON.stringify(flat) === JSON.stringify(expected), "drainPlan must reproduce the full list in order");
  // No matchup is duplicated across the batches.
  const keys = flat.map((m) => `${m.round}|${m.classA}|${m.classB}|${m.raceA}|${m.raceB}`);
  assert(new Set(keys).size === keys.length, "a matchup appeared more than once across the batches");
});

Deno.test("the last batch may be shorter than batchSize", () => {
  const p = plan({ rounds: 1, classes: ["Warrior", "Mage", "Rogue"], races: ["human", "elf"] }); // 36 matchups
  const batches = drainPlan(p, 5);
  assert(batches.length === Math.ceil(36 / 5), `expected ${Math.ceil(36 / 5)} batches, got ${batches.length}`);
  for (const b of batches.slice(0, -1)) assert(b.length === 5, "every batch but the last must be full");
  assert(batches[batches.length - 1].length === 36 % 5, `the last batch should hold the remainder, got ${batches[batches.length - 1].length}`);
});

Deno.test("a batch size below 1 is treated as 1", () => {
  const p = plan({ rounds: 1 });
  const batches = drainPlan(p, 0);
  assert(batches.length === planSize(p), "batch size 0 must fall back to one matchup per batch");
  assert(batches.every((b) => b.length === 1), "each fallback batch holds a single matchup");
});

// ---------------------------------------------------------------- aggregation

Deno.test("win rates sum to 1 when every match has a winner", () => {
  const results = [
    { winnerClass: "Warrior", loserClass: "Mage", durationS: 12, damage: 300, endReason: "ko" },
    { winnerClass: "Mage", loserClass: "Warrior", durationS: 8, damage: 220, endReason: "timed" },
    { winnerClass: "Warrior", loserClass: "Rogue", durationS: 20, damage: 500, endReason: "ring-out" },
    { winnerClass: "Rogue", loserClass: "Mage", durationS: 15, damage: 400, endReason: "ko" },
  ];
  const s = aggregateRuns(results);
  assert(s.matches === 4, "matches should count the results");
  const sum = Object.values(s.winRateByClass).reduce((a, b) => a + b, 0);
  assert(Math.abs(sum - 1) < 1e-9, `win rates should sum to 1, got ${sum}`);
  assert(s.winsByClass.Warrior === 2, "Warrior won twice");
  assert(s.winsByClass.Mage === 1, "Mage won once");
});

Deno.test("aggregateRuns counts wins, end reasons, and averages duration and damage", () => {
  const results = [
    { winnerClass: "A", loserClass: "B", durationS: 10, damage: 100, endReason: "ko" },
    { winnerClass: "A", loserClass: "B", durationS: 20, damage: 300, endReason: "ko" },
    { winnerClass: "B", loserClass: "A", durationS: 30, damage: 200, endReason: "timed" },
  ];
  const s = aggregateRuns(results);
  assert(s.matches === 3, "three matches");
  assert(s.winsByClass.A === 2 && s.winsByClass.B === 1, "wins should tally per class");
  assert(s.endReasons.ko === 2 && s.endReasons.timed === 1, "end reasons should tally");
  assert(Math.abs(s.avgDurationS - 20) < 1e-9, `avg duration should be 20, got ${s.avgDurationS}`);
  assert(Math.abs(s.avgDamage - 200) < 1e-9, `avg damage should be 200, got ${s.avgDamage}`);
});

Deno.test("a class that only ever lost still appears with a zero win rate", () => {
  const s = aggregateRuns([
    { winnerClass: "A", loserClass: "Z", durationS: 5, damage: 50, endReason: "ko" },
    { winnerClass: "A", loserClass: "Z", durationS: 5, damage: 50, endReason: "ko" },
  ]);
  assert(s.winsByClass.Z === 0, "a losing-only class should have zero wins");
  assert(s.winRateByClass.Z === 0, "and a zero win rate");
  assert(s.winRateByClass.A === 1, "the winner takes the whole share");
});

Deno.test("an empty result list aggregates to zeros without NaN", () => {
  const s = aggregateRuns([]);
  assert(s.matches === 0, "no matches");
  assert(s.avgDurationS === 0 && !Number.isNaN(s.avgDurationS), "avg duration must be 0, not NaN");
  assert(s.avgDamage === 0 && !Number.isNaN(s.avgDamage), "avg damage must be 0, not NaN");
  assert(Object.keys(s.winsByClass).length === 0, "no win counts");
  assert(Object.keys(s.winRateByClass).length === 0, "no win rates");
  assert(Object.keys(s.endReasons).length === 0, "no end reasons");
});

Deno.test("the speed and length presets are carried through to every matchup", () => {
  const out = expandPlan(plan({ speedId: "fast", lengthId: "marathon" }));
  assert(out.length > 0, "the plan should expand to something");
  assert(out.every((m) => m.speedId === "fast"), "speedId must reach every matchup");
  assert(out.every((m) => m.lengthId === "marathon"), "lengthId must reach every matchup");
});
