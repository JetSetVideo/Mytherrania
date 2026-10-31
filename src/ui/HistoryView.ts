// History rendering logic and display formatting — the pure half of the History page.
//
// The DOM wiring lives in Menu.ts; everything that decides WHAT a row says and HOW the rows
// are arranged lives here, so it is unit-testable without a browser (the house convention:
// pure logic in its own module). The highlight semantics mirror `MatchHistory.highlights`
// (BRIEF 1.4) over a structural row type, so the menu renders new telemetry rows, legacy
// rows and everything between without a second DOM-coupled copy of the rules.
//
// No DOM. No Three.js. No Math.random.

/** The orderings the History sort control offers. */
export type HistorySort = "newest" | "fastest" | "biggest-gap" | "widest-margin" | "generation";

/** The orders in display order, so the menu builds the control from data, not markup. */
export const HISTORY_SORTS: readonly HistorySort[] = [
  "newest",
  "fastest",
  "biggest-gap",
  "widest-margin",
  "generation",
];

/** Human label for each order, for the sort control's options. */
export const HISTORY_SORT_LABEL: Readonly<Record<HistorySort, string>> = {
  newest: "Newest",
  fastest: "Fastest decided",
  "biggest-gap": "Biggest stat gap",
  "widest-margin": "Widest margin",
  generation: "Generation",
};

/**
 * How a match ended, as the UI reads it. "time-limit" is W-H's 180 s cap tie (BRIEF 1.4).
 * Legacy rows only ever carry the four old reasons, which are assignable to this union.
 */
export type HistoryEndReasonLike = "ko" | "endurance" | "domination" | "sudden-death" | "time-limit";

/** The stat gap a W-H record carries, narrowed to the two numbers the UI shows. */
export interface HistoryStatGapLike {
  /** Euclidean length of the per-stat z-differences: "how far apart were these builds". */
  distance?: number;
  /** 0..1 composite dominance of the winner (0 = a coin flip, 1 = a rout). */
  dominance?: number;
}

/** The generation block a W-H record carries, narrowed to the id the UI shows. */
export interface HistoryGenerationLike {
  /** Stable short id, e.g. "GEN-4F2A19". */
  id?: string;
}

/**
 * The structural shape the History UI sorts and badges. Deliberately structural so it accepts
 * both a W-H telemetry record and a legacy player-centric record — an old row is a valid row
 * (missing telemetry simply produces no badges and sorts last).
 */
export interface HistoryRowLike {
  durationS: number;
  endReason: HistoryEndReasonLike;
  /** Present on W-H records; absent on legacy rows. */
  statGap?: HistoryStatGapLike;
  /** Present on W-H records; absent on legacy rows. */
  generation?: HistoryGenerationLike;
  /** True when the match hit the time-limit cap with nobody KO'd (a tie). */
  tie?: boolean;
}

/** The id a legacy row sorts under (no generation block). */
export const LEGACY_GENERATION_ID = "GEN-LEGACY";

/** "GAP 2.31" — the badge for a stat-gap distance. */
export function formatGap(distance: number): string {
  return `GAP ${distance.toFixed(2)}`;
}

/** "MARGIN 0.84" — the badge for a dominance margin. */
export function formatMargin(dominance: number): string {
  return `MARGIN ${dominance.toFixed(2)}`;
}

/** Read a row's gap distance, defaulting to 0 so comparison never sees undefined. */
const gapDistance = (r: HistoryRowLike): number => r.statGap?.distance ?? 0;
/** Read a row's dominance, defaulting to 0. */
const gapDominance = (r: HistoryRowLike): number => r.statGap?.dominance ?? 0;
/** Read a row's generation id, defaulting to the legacy id so it sorts with the old matches. */
const generationId = (r: HistoryRowLike): string => r.generation?.id ?? LEGACY_GENERATION_ID;

/**
 * One comparator per order. `newest` is a table row too (identity), handled by reversal: the
 * list arrives oldest-first, so reversing gives newest-first without a timestamp. A table, not
 * an if-chain, so a new order is one row and no branch is added.
 */
const COMPARATORS: Readonly<Record<HistorySort, (a: HistoryRowLike, b: HistoryRowLike) => number>> = {
  newest: () => 0,
  fastest: (a, b) => a.durationS - b.durationS,
  "biggest-gap": (a, b) => gapDistance(b) - gapDistance(a),
  "widest-margin": (a, b) => gapDominance(b) - gapDominance(a),
  generation: (a, b) => generationId(a).localeCompare(generationId(b)),
};

/** Order a copy of `rows` by `sort`. Input is treated as oldest-first; never mutates the input. */
export function sortHistory<T extends HistoryRowLike>(rows: readonly T[], sort: HistorySort): T[] {
  const out = [...rows];
  if (sort === "newest") return out.reverse();
  const compare = COMPARATORS[sort];
  return out.sort((a, b) => compare(a, b));
}

/**
 * The badges a row shows, in display order: TIE, TIMEOUT, the generation id, the stat gap and
 * the margin. A legacy row with none of those fields yields [] so it renders exactly as before.
 */
export function rowBadges(row: HistoryRowLike): string[] {
  const badges: string[] = [];
  if (row.tie === true) badges.push("TIE");
  if (row.endReason === "time-limit") badges.push("TIMEOUT");
  const id = row.generation?.id;
  if (id) badges.push(id);
  const distance = row.statGap?.distance;
  if (distance !== undefined) badges.push(formatGap(distance));
  const dominance = row.statGap?.dominance;
  if (dominance !== undefined) badges.push(formatMargin(dominance));
  return badges;
}

/** The highlights the menu's summary strip names (BRIEF 1.4). */
export interface HistoryHighlights<T extends HistoryRowLike> {
  /** Fastest DECIDED match (a tie is not decided); null when every match was a tie. */
  fastest: T | null;
  /** Match with the widest stat gap (largest `statGap.distance`); null only for an empty list. */
  widestGap: T | null;
  tieCount: number;
  timeoutCount: number;
}

/**
 * The highlights the History menu shows. Same semantics as `MatchHistory.highlights` (BRIEF
 * 1.4): a single pass, first-wins on ties, `widestGap` null only for an empty list, and a
 * missing gap read as 0. Implemented locally over the structural row so the menu does not
 * depend on H-D's file landing first; the two implementations must agree (pinned by the parent
 * in tests/spec_test.ts). "Decided" is `tie !== true` (the row type carries no winner index).
 */
export function highlightsOf<T extends HistoryRowLike>(rows: readonly T[]): HistoryHighlights<T> {
  let fastest: T | null = null;
  let widestGap: T | null = null;
  let widest = -Infinity;
  let tieCount = 0;
  let timeoutCount = 0;
  for (const r of rows) {
    if (r.tie === true) tieCount++;
    if (r.endReason === "time-limit") timeoutCount++;
    if (r.tie !== true && (fastest === null || r.durationS < fastest.durationS)) fastest = r;
    const d = r.statGap?.distance ?? 0;
    if (widestGap === null || d > widest) {
      widestGap = r;
      widest = d;
    }
  }
  return { fastest, widestGap, tieCount, timeoutCount };
}

/** One labelled value of the summary strip. */
export interface HighlightLine {
  id: string;
  label: string;
  value: string;
}

/**
 * The summary strip's lines: the fastest decided match, the widest stat gap, and how many
 * matches were ties or ran to the time limit. `labelOf` names a row (the menu passes the two
 * fighter names); it defaults to the match's duration.
 */
export function highlightSummary<T extends HistoryRowLike>(
  rows: readonly T[],
  labelOf: (row: T) => string = (r) => `${r.durationS.toFixed(1)}s`,
): HighlightLine[] {
  const h = highlightsOf(rows);
  return [
    { id: "fastest", label: "Fastest decided", value: h.fastest ? `${labelOf(h.fastest)} · ${h.fastest.durationS.toFixed(1)}s` : "—" },
    { id: "gap", label: "Widest stat gap", value: h.widestGap ? formatGap(gapDistance(h.widestGap)) : "—" },
    { id: "ties", label: "Ties", value: String(h.tieCount) },
    { id: "timeouts", label: "Timeouts", value: String(h.timeoutCount) },
  ];
}
