import { filterHistory, summarizeFiltered } from "../src/game/HistoryFilter.ts";
import type { MatchRecord } from "../src/game/HistoryFilter.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }

// Oldest-first fixture. Indices are referenced by tests below.
const R: MatchRecord[] = [
  // 0
  { winner: "Kael", loser: null, durationS: 30, endReason: "ko", damageDealt: 100, playerRace: "Human", opponentRace: "Orc", playerClass: "Warrior", opponentClass: "Berserker" },
  // 1
  { winner: null, loser: "Kael", durationS: 90, endReason: "endurance", damageDealt: 50, playerRace: "Human", opponentRace: "Elf", playerClass: "Warrior", opponentClass: "Ranger" },
  // 2 - draw
  { winner: null, loser: null, durationS: 60, endReason: "sudden-death", damageDealt: 70, playerRace: "Elf", opponentRace: "Human", playerClass: "Ranger", opponentClass: "Warrior" },
  // 3
  { winner: "Kael", loser: null, durationS: 120, endReason: "domination", damageDealt: 200, playerRace: "Human", opponentRace: "Dwarf", playerClass: "Warrior", opponentClass: "Guardian" },
  // 4
  { winner: "Mira", loser: null, durationS: 45, endReason: "ko", damageDealt: 80, playerRace: "Elf", opponentRace: "Orc", playerClass: "Ranger", opponentClass: "Berserker" },
  // 5
  { winner: null, loser: "Mira", durationS: 150, endReason: "ko", damageDealt: 20, playerRace: "Elf", opponentRace: "Human", playerClass: "Ranger", opponentClass: "Warrior" },
];

Deno.test("an empty query returns every record in newest-first order", () => {
  const all = filterHistory(R, {});
  assert(all.length === R.length, `expected ${R.length} rows, got ${all.length}`);
  assert(filterHistory(R).length === R.length, "default query also returns everything");
  assert(all[0] === R[5] && all[all.length - 1] === R[0], "newest-first by default");
});

Deno.test("a name substring narrows to the matches involving that fighter", () => {
  assert(filterHistory(R, { name: "Kael" }).length === 3, "Kael fought in 3 matches");
  assert(filterHistory(R, { name: "Mira" }).length === 2, "Mira fought in 2 matches");
  assert(filterHistory(R, { name: "nobody" }).length === 0, "an unknown name matches nothing");
});

Deno.test("a name substring is case-insensitive and ignores surrounding space", () => {
  assert(filterHistory(R, { name: "kael" }).length === 3, "lowercase matches");
  assert(filterHistory(R, { name: "KAEL" }).length === 3, "uppercase matches");
  assert(filterHistory(R, { name: "  kAeL  " }).length === 3, "trimmed mixed case matches");
});

Deno.test("outcome win keeps only decisive player wins", () => {
  const wins = filterHistory(R, { outcome: "win" });
  assert(wins.length === 3, `expected 3 wins, got ${wins.length}`);
  assert(wins.every((r) => r.winner !== null), "every win has a winner");
  assert(!wins.includes(R[2]), "the draw is not a win");
});

Deno.test("outcome loss keeps only decisive player losses", () => {
  const losses = filterHistory(R, { outcome: "loss" });
  assert(losses.length === 2, `expected 2 losses, got ${losses.length}`);
  assert(losses.every((r) => r.winner === null && r.loser !== null), "every loss has a loser and no winner");
  assert(!losses.includes(R[2]), "the draw is not a loss");
});

Deno.test("outcome draw keeps only the drawn matches", () => {
  const draws = filterHistory(R, { outcome: "draw" });
  assert(draws.length === 1, "one draw");
  assert(draws[0] === R[2], "the draw is record 2");
});

Deno.test("the three outcomes partition the history", () => {
  const total = (["win", "loss", "draw"] as const)
    .map((o) => filterHistory(R, { outcome: o }).length)
    .reduce((a, b) => a + b, 0);
  assert(total === R.length, `win+loss+draw must cover all ${R.length}, got ${total}`);
});

Deno.test("an endReason filter narrows to matches that ended that way", () => {
  const ko = filterHistory(R, { endReason: "ko" });
  assert(ko.length === 3, `expected 3 ko matches, got ${ko.length}`);
  assert(ko.every((r) => r.endReason === "ko"), "all ko");
  assert(filterHistory(R, { endReason: "endurance" }).length === 1, "one endurance match");
  assert(filterHistory(R, { endReason: "sudden-death" }).length === 1, "one sudden-death match");
});

Deno.test("a race filter matches a match in which either fighter used that race", () => {
  assert(filterHistory(R, { race: "Elf" }).length === 4, "Elf on either side -> 4");
  assert(filterHistory(R, { race: "Human" }).length === 5, "Human on either side -> 5");
  assert(filterHistory(R, { race: "Dwarf" }).length === 1, "Dwarf only on the opponent side -> 1");
});

Deno.test("a class filter matches a match in which either fighter used that class", () => {
  assert(filterHistory(R, { className: "Warrior" }).length === 5, "Warrior on either side -> 5");
  assert(filterHistory(R, { className: "Ranger" }).length === 4, "Ranger on either side -> 4");
});

Deno.test("filters combine with AND", () => {
  const q = filterHistory(R, { outcome: "win", endReason: "ko" });
  assert(q.length === 2, `win AND ko -> 2, got ${q.length}`);
  assert(q.every((r) => r.winner !== null && r.endReason === "ko"), "both conditions hold");

  const q2 = filterHistory(R, { outcome: "win", race: "Human" });
  assert(q2.length === 2, `win AND Human -> 2, got ${q2.length}`);

  const q3 = filterHistory(R, { name: "Kael", outcome: "win", endReason: "domination" });
  assert(q3.length === 1 && q3[0] === R[3], "three filters intersect on record 3");
});

Deno.test("sort newest reverses the oldest-first input", () => {
  const rows = filterHistory(R, { sort: "newest" });
  assert(rows[0] === R[5] && rows[5] === R[0], "newest first, oldest last");
  for (let i = 1; i < rows.length; i++) {
    assert(R.indexOf(rows[i - 1]) > R.indexOf(rows[i]), "indices strictly descend");
  }
});

Deno.test("sort longest orders by duration descending", () => {
  const rows = filterHistory(R, { sort: "longest" });
  const want = [R[5], R[3], R[1], R[2], R[4], R[0]];
  assert(rows.length === want.length, "same count");
  for (let i = 0; i < want.length; i++) assert(rows[i] === want[i], `row ${i} is ${want[i].durationS}s`);
  for (let i = 1; i < rows.length; i++) assert(rows[i - 1].durationS >= rows[i].durationS, "non-increasing duration");
});

Deno.test("sort most-damage orders by damage descending", () => {
  const rows = filterHistory(R, { sort: "most-damage" });
  const want = [R[3], R[0], R[4], R[2], R[1], R[5]];
  for (let i = 0; i < want.length; i++) assert(rows[i] === want[i], `row ${i} is ${want[i].damageDealt} dmg`);
  for (let i = 1; i < rows.length; i++) assert(rows[i - 1].damageDealt >= rows[i].damageDealt, "non-increasing damage");
});

Deno.test("a tie in the sort key keeps the input order (stable)", () => {
  const tied: MatchRecord[] = [
    { winner: "A", loser: null, durationS: 50, endReason: "ko", damageDealt: 10, playerRace: "Human", opponentRace: "Orc", playerClass: "Warrior", opponentClass: "Berserker" },
    { winner: "B", loser: null, durationS: 50, endReason: "ko", damageDealt: 10, playerRace: "Human", opponentRace: "Orc", playerClass: "Warrior", opponentClass: "Berserker" },
    { winner: "C", loser: null, durationS: 50, endReason: "ko", damageDealt: 10, playerRace: "Human", opponentRace: "Orc", playerClass: "Warrior", opponentClass: "Berserker" },
  ];
  const byLength = filterHistory(tied, { sort: "longest" });
  assert(byLength[0] === tied[0] && byLength[1] === tied[1] && byLength[2] === tied[2], "longest preserves order on ties");
  const byDamage = filterHistory(tied, { sort: "most-damage" });
  assert(byDamage[0] === tied[0] && byDamage[1] === tied[1] && byDamage[2] === tied[2], "most-damage preserves order on ties");
});

Deno.test("the summary describes the filtered set, not the whole list", () => {
  const wins = filterHistory(R, { outcome: "win" });
  const s = summarizeFiltered(wins);
  assert(s.count === 3, `count follows the filtered set, got ${s.count}`);
  assert(s.wins === 3 && s.losses === 0 && s.draws === 0, "only wins in the win set");
  assert(summarizeFiltered(R).count === R.length, "the full list summarizes to 6");

  const lossOnly = summarizeFiltered(filterHistory(R, { outcome: "loss" }));
  assert(lossOnly.count === 2 && lossOnly.wins === 0 && lossOnly.losses === 2, "loss set is 2 losses");
});

Deno.test("the summary computes averages and totals over the filtered set", () => {
  const s = summarizeFiltered(filterHistory(R, { outcome: "win" }));
  // wins are records 0,3,4 -> durations 30,120,45 ; damage 100,200,80
  assert(s.avgDurationS === (30 + 120 + 45) / 3, `avg duration = 65, got ${s.avgDurationS}`);
  assert(s.totalDamage === 100 + 200 + 80, `total damage = 380, got ${s.totalDamage}`);
});

Deno.test("reasonCounts sums to the count and tracks each end reason", () => {
  const s = summarizeFiltered(R);
  const sum = s.reasonCounts.ko + s.reasonCounts.endurance + s.reasonCounts.domination + s.reasonCounts["sudden-death"];
  assert(sum === s.count, `reasonCounts sum ${sum} must equal count ${s.count}`);
  assert(s.reasonCounts.ko === 3, "three ko");
  assert(s.reasonCounts.endurance === 1, "one endurance");
  assert(s.reasonCounts.domination === 1, "one domination");
  assert(s.reasonCounts["sudden-death"] === 1, "one sudden-death");

  const sub = summarizeFiltered(filterHistory(R, { endReason: "ko" }));
  const subSum = sub.reasonCounts.ko + sub.reasonCounts.endurance + sub.reasonCounts.domination + sub.reasonCounts["sudden-death"];
  assert(subSum === sub.count && sub.count === 3, "reasonCounts sum to the filtered count too");
  assert(sub.reasonCounts.ko === 3 && sub.reasonCounts.endurance === 0, "only ko present in the ko set");
});

Deno.test("an empty result summarizes to zeros without NaN", () => {
  const s = summarizeFiltered(filterHistory(R, { name: "nobody" }));
  assert(s.count === 0, "no rows");
  assert(s.wins === 0 && s.losses === 0 && s.draws === 0, "no outcomes");
  assert(s.avgDurationS === 0 && Number.isFinite(s.avgDurationS), "avg is 0, not NaN");
  assert(s.totalDamage === 0, "no damage");
  const sum = s.reasonCounts.ko + s.reasonCounts.endurance + s.reasonCounts.domination + s.reasonCounts["sudden-death"];
  assert(sum === 0, "reasonCounts all zero");
});
