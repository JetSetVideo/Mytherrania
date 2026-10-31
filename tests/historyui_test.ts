// Wave H (H-G): the History UI's pure logic — sort orders, row badges, highlight semantics —
// plus the additive HistoryFilter orders, the back-compat promise, and a text guard that the
// menu markup still names every key the UI tree declares. No browser, no DOM.
import {
  formatGap,
  formatMargin,
  highlightSummary,
  highlightsOf,
  HISTORY_SORTS,
  LEGACY_GENERATION_ID,
  rowBadges,
  sortHistory,
  type HistoryRowLike,
} from "../src/ui/HistoryView.ts";
import { filterHistory, summarizeFiltered, type MatchRecord } from "../src/game/HistoryFilter.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
function eq<T>(actual: T, expected: T, message = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message} expected ${e}, got ${a}`);
}

// A six-row fixture: a tie, a timeout (the same tie), two generations, and a legacy row with
// no telemetry at all. Indexed 0..5 so the sort assertions can name rows by identity.
const ROWS: HistoryRowLike[] = [
  { durationS: 30, endReason: "ko", statGap: { distance: 1.0, dominance: 0.4 }, generation: { id: "GEN-AAAAAA" } }, // 0
  { durationS: 90, endReason: "endurance", statGap: { distance: 2.31, dominance: 0.84 }, generation: { id: "GEN-BBBBBB" } }, // 1
  { durationS: 60, endReason: "time-limit", tie: true }, // 2 - the tie + timeout
  { durationS: 12.5, endReason: "ko", statGap: { distance: 0.5, dominance: 0.1 } }, // 3 - fastest decided
  { durationS: 45, endReason: "domination", statGap: { distance: 3.0, dominance: 0.2 } }, // 4 - widest gap
  { durationS: 120, endReason: "ko" }, // 5 - legacy, no telemetry
];

const ids = (rows: readonly HistoryRowLike[]) => rows.map((r) => ROWS.indexOf(r));

Deno.test("HistoryView: every sort order, over the six-row fixture", () => {
  eq(ids(sortHistory(ROWS, "newest")), [5, 4, 3, 2, 1, 0], "newest reverses the oldest-first input");
  eq(ids(sortHistory(ROWS, "fastest")), [3, 0, 4, 2, 1, 5], "fastest is ascending durationS");
  eq(ids(sortHistory(ROWS, "biggest-gap")), [4, 1, 0, 3, 2, 5], "biggest-gap is descending distance, stable on the two zeros");
  eq(ids(sortHistory(ROWS, "widest-margin")), [1, 0, 4, 3, 2, 5], "widest-margin is descending dominance");
  eq(ids(sortHistory(ROWS, "generation")), [0, 1, 2, 3, 4, 5], "generation sorts by id, legacy rows under GEN-LEGACY");
});

Deno.test("HistoryView: sorts never mutate the input and are total", () => {
  const before = ids(ROWS);
  for (const s of HISTORY_SORTS) sortHistory(ROWS, s);
  eq(ids(ROWS), before, "the fixture is unchanged after every sort");
  eq(HISTORY_SORTS.length, 5, "five orders are offered");
  for (const s of HISTORY_SORTS) eq(sortHistory(ROWS, s).length, ROWS.length, `${s} keeps every row`);
});

Deno.test("HistoryView: badges for every case, and none for a legacy row", () => {
  eq(rowBadges(ROWS[2]), ["TIE", "TIMEOUT"], "a tie at the time limit shows both flags");
  eq(rowBadges(ROWS[0]), ["GEN-AAAAAA", "GAP 1.00", "MARGIN 0.40"], "generation, gap and margin");
  eq(rowBadges(ROWS[1]), ["GEN-BBBBBB", "GAP 2.31", "MARGIN 0.84"], "the second generation's badge set");
  eq(rowBadges(ROWS[3]), ["GAP 0.50", "MARGIN 0.10"], "no generation block -> no id badge");
  eq(rowBadges(ROWS[5]), [], "a legacy row (no telemetry) has an empty badge list");
  eq(rowBadges({ durationS: 5, endReason: "ko", statGap: {} }), [], "an empty gap block yields no badges");
  assert(formatGap(2.31) === "GAP 2.31" && formatMargin(0.84) === "MARGIN 0.84", "the badge text formats to two decimals");
});

Deno.test("HistoryView: highlightsOf matches the BRIEF 1.4 semantics", () => {
  const h = highlightsOf(ROWS);
  assert(h.fastest === ROWS[3], "the fastest DECIDED match ignores the tie and picks the shortest win");
  assert(h.widestGap === ROWS[4], "the widest stat gap is the largest distance");
  eq(h.tieCount, 1, "one tie");
  eq(h.timeoutCount, 1, "one timeout");
  // A list of only ties has no decided match: fastest is null, the ties still count.
  const tieRows: HistoryRowLike[] = [
    { durationS: 10, endReason: "time-limit", tie: true },
    { durationS: 20, endReason: "time-limit", tie: true },
  ];
  const allTies = highlightsOf(tieRows);
  assert(allTies.fastest === null, "no decided match -> fastest is null");
  assert(allTies.widestGap === tieRows[0], "first-wins on equal (zero) gaps, same as MatchHistory.highlights");
  eq(allTies.tieCount, 2, "both counted as ties");
  eq(allTies.timeoutCount, 2, "both counted as timeouts");
  // Legacy rows: decided (tie !== true) with no gap read as 0, so fastest is the shortest.
  const legacyRows: HistoryRowLike[] = [{ durationS: 40, endReason: "ko" }, { durationS: 20, endReason: "ko" }];
  const legacy = highlightsOf(legacyRows);
  assert(legacy.fastest?.durationS === 20, "legacy rows are decided, so the fastest is the shortest");
  assert(legacy.widestGap === legacyRows[0] && (legacy.widestGap.statGap?.distance ?? 0) === 0, "a missing gap reads as 0");
  eq(legacy.tieCount, 0, "a legacy row is never a tie");
  assert(highlightsOf<HistoryRowLike>([]).widestGap === null, "an empty list -> null, matching MatchHistory.highlights");
});

Deno.test("HistoryView: highlightSummary names the fastest, the gap, ties and timeouts", () => {
  const lines = highlightSummary(ROWS, (r) => `match ${ROWS.indexOf(r)}`);
  eq(lines.map((l) => l.id), ["fastest", "gap", "ties", "timeouts"], "four strip lines in order");
  assert(lines[0].value.startsWith("match 3 · 12.5s"), `fastest names the row: ${lines[0].value}`);
  eq(lines[1].value, "GAP 3.00", "the widest gap value");
  eq(lines[2].value, "1", "tie count as text");
  eq(lines[3].value, "1", "timeout count as text");
  const empty = highlightSummary<HistoryRowLike>([]);
  eq(empty.map((l) => l.value), ["—", "—", "0", "0"], "an empty list shows dashes and zeros, never NaN");
  eq(LEGACY_GENERATION_ID, "GEN-LEGACY", "the legacy generation id is stable");
});

// The additive HistoryFilter orders. Legacy records (no telemetry) must not throw and sort last.
const F: MatchRecord[] = [
  { winner: "Kael", loser: null, durationS: 30, endReason: "ko", damageDealt: 100, playerRace: "Human", opponentRace: "Orc", playerClass: "Warrior", opponentClass: "Berserker", statGap: { distance: 1.0, dominance: 0.4 } },
  { winner: null, loser: "Kael", durationS: 90, endReason: "endurance", damageDealt: 50, playerRace: "Human", opponentRace: "Elf", playerClass: "Warrior", opponentClass: "Ranger", statGap: { distance: 2.31, dominance: 0.84 } },
  { winner: "Mira", loser: null, durationS: 12.5, endReason: "ko", damageDealt: 80, playerRace: "Elf", opponentRace: "Orc", playerClass: "Ranger", opponentClass: "Berserker" }, // legacy: no statGap
  { winner: "Kael", loser: null, durationS: 45, endReason: "domination", damageDealt: 200, playerRace: "Human", opponentRace: "Dwarf", playerClass: "Warrior", opponentClass: "Guardian", statGap: { distance: 3.0, dominance: 0.2 } },
];

Deno.test("HistoryFilter: the new orders honour duration, gap distance and dominance", () => {
  const fastest = filterHistory(F, { sort: "fastest" });
  const fastestFirst = fastest[0];
  assert(fastestFirst === F[2] && fastestFirst.durationS === 12.5, "fastest picks the shortest match");
  for (let i = 1; i < fastest.length; i++) assert(fastest[i - 1].durationS <= fastest[i].durationS, "non-decreasing duration");

  const gap = filterHistory(F, { sort: "biggest-gap" });
  assert(gap[0] === F[3] && gap[0].statGap?.distance === 3.0, "biggest-gap picks the widest distance");
  for (let i = 1; i < gap.length; i++) assert((gap[i - 1].statGap?.distance ?? 0) >= (gap[i].statGap?.distance ?? 0), "non-increasing distance");

  const margin = filterHistory(F, { sort: "widest-margin" });
  assert(margin[0] === F[1] && margin[0].statGap?.dominance === 0.84, "widest-margin picks the largest dominance");
  for (let i = 1; i < margin.length; i++) assert((margin[i - 1].statGap?.dominance ?? 0) >= (margin[i].statGap?.dominance ?? 0), "non-increasing dominance");

  // A legacy row (no statGap) neither throws nor displaces a real gap; it sorts to the end.
  const legacyOnly: MatchRecord[] = [
    { winner: "A", loser: null, durationS: 20, endReason: "ko", damageDealt: 10, playerRace: "Human", opponentRace: "Orc", playerClass: "Warrior", opponentClass: "Berserker" },
    { winner: "B", loser: null, durationS: 20, endReason: "ko", damageDealt: 10, playerRace: "Human", opponentRace: "Orc", playerClass: "Warrior", opponentClass: "Berserker" },
  ];
  eq(filterHistory(legacyOnly, { sort: "biggest-gap" }).length, 2, "legacy rows sort by the new key without throwing");
  eq(filterHistory(legacyOnly, { sort: "widest-margin" }).length, 2, "and by the margin order too");
});

Deno.test("HistoryFilter: back-compat — an old query and an old record still filter and summarize", () => {
  // The pre-W-H orders are untouched.
  assert(filterHistory(F, {})[0] === F[3], "the default (empty) query is newest-first");
  assert(filterHistory(F, { sort: "longest" })[0] === F[1], "longest still leads with the longest");
  assert(filterHistory(F, { sort: "most-damage" })[0] === F[3], "most-damage still leads with the biggest hit");
  assert(filterHistory(F, { sort: "newest" })[0] === F[3], "newest reverses the input");
  // A record with none of the new fields filters and summarizes without NaN.
  const olds: MatchRecord[] = [
    { winner: "Kael", loser: null, durationS: 30, endReason: "ko", damageDealt: 100, playerRace: "Human", opponentRace: "Orc", playerClass: "Warrior", opponentClass: "Berserker" },
    { winner: null, loser: null, durationS: 60, endReason: "sudden-death", damageDealt: 70, playerRace: "Elf", opponentRace: "Human", playerClass: "Ranger", opponentClass: "Warrior" },
  ];
  const s = summarizeFiltered(filterHistory(olds, { outcome: "win" }));
  assert(s.count === 1 && Number.isFinite(s.avgDurationS) && !Number.isNaN(s.totalDamage), "old records summarize steadily");
  const all = summarizeFiltered(olds);
  assert(all.count === 2 && all.draws === 1 && all.wins === 1, "the old outcome rule still holds");
});

Deno.test("the menu markup names every new UI key (a silent removal fails here)", async () => {
  const menu = await Deno.readTextFile(new URL("../src/ui/Menu.ts", import.meta.url));
  const tree = await Deno.readTextFile(new URL("../src/ui/UiTree.ts", import.meta.url));
  const NEW_KEYS = [
    "filter-sort", "history-highlights", "history-badge",
    "spectate-card", "spectate-level-a", "spectate-level-b", "spectate-budget-a", "spectate-budget-b",
    "spectate-techniques", "spectate-arena",
    "ancestry-lore", "ancestry-skin", "ancestry-hair", "ancestry-beard", "ancestry-tusk", "ancestry-ranks",
  ];
  for (const key of NEW_KEYS) {
    assert(tree.includes(`"${key}"`), `UiTree.ts declares key "${key}"`);
    assert(menu.includes(key), `Menu.ts renders key "${key}"`);
  }
});
