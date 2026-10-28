// Match-history filtering and summary.
//
// The post-match screen and the profile "battle log" both read one flat list of
// finished matches and need the same two operations: narrow the list down to
// what the player asked for, then roll the narrowed list up into the headline
// numbers shown in the header. This module is pure data — no Three.js, no DOM —
// so both the filter and the arithmetic can be asserted directly in tests.
//
// Engine call:
//   const rows = filterHistory(records, query);   // rows to render
//   const head = summarizeFiltered(rows);         // header numbers
// The engine only calls those two functions; the predicate table, the sort
// table and the outcome rule stay private.
//
// Records are player-centric: `winner` carries the player's name when the
// player won, `loser` carries it when the player lost, and both are null on a
// draw. `playerRace`/`playerClass` describe the player; the opponent fields the
// other fighter. A race or class filter matches a match in which *either*
// fighter used that value.

/** One finished match, stored player-centric (see the note above). */
export interface MatchRecord {
  /** Player's name if the player won, else null. */
  winner: string | null;
  /** Player's name if the player lost, else null. */
  loser: string | null;
  durationS: number;
  endReason: EndReason;
  damageDealt: number;
  playerRace: string;
  opponentRace: string;
  playerClass: string;
  opponentClass: string;
}

/** How a match ended. */
export type EndReason = "ko" | "endurance" | "domination" | "sudden-death";

/** Player-perspective result, or "any" to skip the filter. */
export type Outcome = "any" | "win" | "loss" | "draw";

/** Ordering applied to the surviving rows. */
export type SortKey = "newest" | "longest" | "most-damage";

/**
 * A history search. Every field is optional: an empty query `{}` returns the
 * whole list in newest-first order. `"any"` (or an omitted field) means the
 * filter is skipped.
 */
export interface HistoryQuery {
  /** Case-insensitive substring of the recorded player name. */
  name?: string;
  outcome?: Outcome;
  endReason?: EndReason | "any";
  race?: string;
  className?: string;
  sort?: SortKey;
}

/** Headline numbers for a filtered set of matches. */
export interface HistorySummary {
  count: number;
  wins: number;
  losses: number;
  draws: number;
  avgDurationS: number;
  totalDamage: number;
  /** Matches per end reason; always sums to `count`. */
  reasonCounts: Record<EndReason, number>;
}

/** Query defaults — one row per field, so normalization is a table walk. */
const DEFAULTS: Required<HistoryQuery> = {
  name: "",
  outcome: "any",
  endReason: "any",
  race: "any",
  className: "any",
  sort: "newest",
};

/** Comparators for the numeric sorts. `newest` is handled by reversal. */
const SORTS: Record<SortKey, (a: MatchRecord, b: MatchRecord) => number> = {
  newest: () => 0,
  longest: (a, b) => b.durationS - a.durationS,
  "most-damage": (a, b) => b.damageDealt - a.damageDealt,
};

/** Player-perspective result of one match. */
function outcomeOf(r: MatchRecord): "win" | "loss" | "draw" {
  if (r.winner !== null) return "win";
  if (r.loser !== null) return "loss";
  return "draw";
}

/** Case-insensitive substring test against the recorded player name. */
function matchesName(r: MatchRecord, needle: string): boolean {
  return (r.winner?.toLowerCase().includes(needle) ?? false) ||
    (r.loser?.toLowerCase().includes(needle) ?? false);
}

type Predicate = (r: MatchRecord, q: Required<HistoryQuery>, needle: string) => boolean;

/** One predicate per filterable field; all must pass (AND). */
const PREDICATES: readonly Predicate[] = [
  (r, _q, needle) => needle === "" || matchesName(r, needle),
  (r, q) => q.outcome === "any" || outcomeOf(r) === q.outcome,
  (r, q) => q.endReason === "any" || r.endReason === q.endReason,
  (r, q) => q.race === "any" || r.playerRace === q.race || r.opponentRace === q.race,
  (r, q) => q.className === "any" || r.playerClass === q.className || r.opponentClass === q.className,
];

/** Fill omitted query fields from the defaults. */
function normalize(query: HistoryQuery): Required<HistoryQuery> {
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof HistoryQuery)[]) {
    const v = query[key];
    if (v !== undefined) (out as Record<string, unknown>)[key] = v;
  }
  return out;
}

/** Narrow a history to the rows matching `query`, in the requested order. */
export function filterHistory(records: readonly MatchRecord[], query: HistoryQuery = {}): MatchRecord[] {
  const q = normalize(query);
  const needle = q.name.trim().toLowerCase();
  const rows = records.filter((r) => PREDICATES.every((p) => p(r, q, needle)));
  if (q.sort === "newest") return rows.reverse();
  return rows.sort(SORTS[q.sort]);
}

/** Roll a (usually filtered) set of matches up into headline numbers. */
export function summarizeFiltered(records: readonly MatchRecord[]): HistorySummary {
  const reasonCounts: Record<EndReason, number> = { ko: 0, endurance: 0, domination: 0, "sudden-death": 0 };
  let wins = 0, losses = 0, draws = 0, totalDamage = 0, totalDuration = 0;
  for (const r of records) {
    const o = outcomeOf(r);
    if (o === "win") wins++;
    else if (o === "loss") losses++;
    else draws++;
    totalDamage += r.damageDealt;
    totalDuration += r.durationS;
    reasonCounts[r.endReason]++;
  }
  const count = records.length;
  return {
    count,
    wins,
    losses,
    draws,
    avgDurationS: count === 0 ? 0 : totalDuration / count,
    totalDamage,
    reasonCounts,
  };
}
