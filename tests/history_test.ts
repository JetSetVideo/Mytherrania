import { appendRecord, describe, HISTORY_CAP, parseHistory, summarize, wilson, type MatchRecord } from "../src/game/MatchHistory.ts";

function assert(ok: boolean, message = "assertion failed") { if (!ok) throw new Error(message); }
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const stats = { vitality: 10, resilience: 10, willpower: 10, reflex: 10, strength: 10, intelligence: 10, maxHealth: 45, attackPower: 9, armor: 4 };
function rec(id: number, winner: 0 | 1, a: Partial<MatchRecord["fighters"][0]>, b: Partial<MatchRecord["fighters"][0]>, extra: Partial<MatchRecord> = {}): MatchRecord {
  const base = { subrace: null, weapon: "Longsword", level: 1, controller: "decision-tree" as const, stats, dealt: 10, hits: 2, hpLeft: 10 };
  return {
    id, at: "2026-10-10T12:00:00Z", hour: 12, phase: "day", place: "Sunspire Steppe", arena: "ring", reason: "ko",
    duration: 20, firstStrike: null, winner,
    fighters: [{ ...base, name: "A", race: "human", className: "Warrior", ...a }, { ...base, name: "B", race: "ork", className: "Rogue", ...b }],
    ...extra,
  };
}

Deno.test("wilson: known values and the expectation that the interval narrows with n", () => {
  const w = wilson(5, 10);
  assert(near(w.rate, 0.5) && near(w.lo, 0.2366, 1e-3) && near(w.hi, 0.7634, 1e-3), JSON.stringify(w));
  assert(wilson(500, 1000).hi - wilson(500, 1000).lo < w.hi - w.lo, "narrower with more data");
  assert(wilson(0, 0).rate === 0);
  // Inverse: swapping wins/losses mirrors the interval around 0.5.
  const x = wilson(3, 10), y = wilson(7, 10);
  assert(near(x.lo, 1 - y.hi) && near(x.hi, 1 - y.lo));
});

Deno.test("describe: mean, median (odd/even), sample sd", () => {
  const d = describe([2, 4, 4, 4, 5, 5, 7, 9]);
  assert(d.mean === 5 && d.median === 4.5 && near(d.sd, 2.138, 1e-3) && d.min === 2 && d.max === 9);
  assert(describe([3, 1, 2]).median === 2);
  assert(describe([]).n === 0);
});

Deno.test("summarize: each appearance counts, games conserve, first-strike rate", () => {
  const list = [
    rec(1, 0, {}, {}, { firstStrike: "A" }),
    rec(2, 1, {}, {}, { firstStrike: "A", phase: "night", reason: "ring-out" }),
    rec(3, 0, { race: "elf" }, { race: "elf" }, { firstStrike: "A" }),
  ];
  const s = summarize(list);
  assert(s.matches === 3);
  // Conservation: total games across races = 2 × matches; total wins = matches.
  assert(s.byRace.reduce((a, r) => a + r.games, 0) === 6);
  assert(s.byRace.reduce((a, r) => a + r.wins, 0) === 3);
  const elf = s.byRace.find((r) => r.key === "elf")!;
  assert(elf.games === 2 && elf.wins === 1 && elf.rate === 0.5, "mirror match = exactly 50%");
  assert(near(s.firstStrikeWinRate.rate, 2 / 3) && s.firstStrikeWinRate.n === 3);
  assert(s.reasons["ko"] === 2 && s.reasons["ring-out"] === 1 && s.byPhase["night"] === 1);
});

Deno.test("parse/append: tolerate corrupt storage and cap the list", () => {
  assert(parseHistory("{oops").length === 0);
  assert(parseHistory(null).length === 0);
  assert(parseHistory(JSON.stringify([{ bad: 1 }, rec(1, 0, {}, {})])).length === 1);
  let list: MatchRecord[] = [];
  for (let i = 0; i < HISTORY_CAP + 5; i++) list = appendRecord(list, rec(i, 0, {}, {}));
  assert(list.length === HISTORY_CAP && list[0].id === 5, "oldest dropped first");
});
