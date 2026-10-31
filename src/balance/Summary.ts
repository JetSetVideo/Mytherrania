// Wave J (lane J-B): batch summaries — ColumnStats (n, min, max, mean, median, p10, p90) per
// design cell and per gradient axis position, the "strong always beats weak" invariant check, and
// a readable Markdown rendering. Pure: records in, plain JSON out.

import type { ColumnStats, MatchRecord } from "../game/arena/contracts.ts";

/** The per-record numbers every summary column is built from. */
export const METRICS = ["winA", "duration", "hpFracA", "hpFracB", "damageA", "damageB", "ringout", "ko", "time"] as const;
export type Metric = typeof METRICS[number];

/** One record's metric values. winA = 1 seat A won, 0 seat B won, 0.5 tie/draw/error. */
export function metricsOf(r: MatchRecord): Record<Metric, number> {
  const o = r.outcome;
  return {
    winA: o.winner === 0 ? 1 : o.winner === 1 ? 0 : 0.5,
    duration: o.duration,
    hpFracA: o.hpFracLeft[0],
    hpFracB: o.hpFracLeft[1],
    damageA: o.damageDealt[0],
    damageB: o.damageDealt[1],
    ringout: o.reason === "ringout" ? 1 : 0,
    ko: o.reason === "ko" ? 1 : 0,
    time: o.reason === "time" ? 1 : 0,
  };
}

/**
 * ColumnStats of a numeric column (non-finite values dropped). Quantiles interpolate linearly
 * between order statistics (q·(n−1)); an empty column reports n = 0 and zeros.
 */
export function columnStats(values: readonly number[]): ColumnStats {
  const v = values.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return { n: 0, min: 0, max: 0, mean: 0, median: 0, p10: 0, p90: 0 };
  const q = (p: number) => {
    const i = p * (n - 1), lo = Math.floor(i), hi = Math.ceil(i);
    return v[lo] + (v[hi] - v[lo]) * (i - lo);
  };
  const mean = v.reduce((t, x) => t + x, 0) / n;
  const r = (x: number) => Math.round(x * 1e4) / 1e4;
  return { n, min: r(v[0]), max: r(v[n - 1]), mean: r(mean), median: r(q(0.5)), p10: r(q(0.1)), p90: r(q(0.9)) };
}

function table(rows: Record<Metric, number>[]): Record<Metric, ColumnStats> {
  const out = {} as Record<Metric, ColumnStats>;
  for (const m of METRICS) out[m] = columnStats(rows.map((r) => r[m]));
  return out;
}

/** Corner designs whose strong seat is known: max-vs-min (A strong), min-vs-max (B strong). */
export function strongSeatOf(design: string): 0 | 1 | null {
  if (design.startsWith("corner:max-vs-min")) return 0;
  if (design.startsWith("corner:min-vs-max")) return 1;
  return null;
}

export interface InvariantCheck {
  /** Matches where one seat is max (L20, best gear, max stats, full strategy) and the other min. */
  n: number;
  strongWins: number;
  rate: number;
  pass: boolean;
  /** Up to 20 counter-examples (seed, design, reason, classes). */
  failures: { seed: number; design: string; reason: string; strong: string; weak: string; duration: number }[];
  byReason: Record<string, number>;
}

export function invariantCheck(records: readonly MatchRecord[]): InvariantCheck {
  let n = 0, wins = 0;
  const failures: InvariantCheck["failures"] = [];
  const byReason: Record<string, number> = {};
  for (const r of records) {
    const s = strongSeatOf(r.conditions.design);
    if (s === null) continue;
    n++;
    byReason[r.outcome.reason] = (byReason[r.outcome.reason] ?? 0) + 1;
    if (r.outcome.winner === s) { wins++; continue; }
    const f = r.conditions.fighters;
    if (failures.length < 20) {
      failures.push({
        seed: r.conditions.seed, design: r.conditions.design, reason: r.outcome.reason,
        strong: `${f[s].race}/${f[s].subrace} ${f[s].className} ${f[s].weapon.type || "default"}`,
        weak: `${f[1 - s].race}/${f[1 - s].subrace} ${f[1 - s].className} ${f[1 - s].weapon.type || "default"}`,
        duration: r.outcome.duration,
      });
    }
  }
  return { n, strongWins: wins, rate: n > 0 ? wins / n : 0, pass: n > 0 && wins === n, failures, byReason };
}

export interface BatchSummary {
  matches: number;
  codeHash: string;
  reasons: Record<string, number>;
  overall: Record<Metric, ColumnStats>;
  /** design cell -> metric -> ColumnStats. */
  cells: Record<string, Record<Metric, ColumnStats>>;
  /** gradient axis -> step position (as a string, e.g. "0.25") -> metric -> ColumnStats. */
  axes: Record<string, Record<string, Record<Metric, ColumnStats>>>;
  invariant: InvariantCheck;
}

export function summarize(records: readonly MatchRecord[]): BatchSummary {
  const reasons: Record<string, number> = {};
  const byCell = new Map<string, Record<Metric, number>[]>();
  const byAxis = new Map<string, Map<string, Record<Metric, number>[]>>();
  const all: Record<Metric, number>[] = [];
  for (const r of records) {
    const m = metricsOf(r);
    all.push(m);
    reasons[r.outcome.reason] = (reasons[r.outcome.reason] ?? 0) + 1;
    const cell = r.conditions.design;
    if (!byCell.has(cell)) byCell.set(cell, []);
    byCell.get(cell)!.push(m);
    for (const [axis, pos] of Object.entries(r.conditions.gradient ?? {})) {
      if (!byAxis.has(axis)) byAxis.set(axis, new Map());
      const key = pos.toFixed(2);
      const ax = byAxis.get(axis)!;
      if (!ax.has(key)) ax.set(key, []);
      ax.get(key)!.push(m);
    }
  }
  const cells: BatchSummary["cells"] = {};
  for (const k of [...byCell.keys()].sort()) cells[k] = table(byCell.get(k)!);
  const axes: BatchSummary["axes"] = {};
  for (const k of [...byAxis.keys()].sort()) {
    axes[k] = {};
    const ax = byAxis.get(k)!;
    for (const p of [...ax.keys()].sort()) axes[k][p] = table(ax.get(p)!);
  }
  return {
    matches: records.length,
    codeHash: records[0]?.conditions.codeHash ?? "",
    reasons,
    overall: table(all),
    cells,
    axes,
    invariant: invariantCheck(records),
  };
}

const f2 = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toString() : v.toFixed(2));

/** A readable Markdown report: reasons, invariant, per-cell and per-axis tables. */
export function summaryMarkdown(s: BatchSummary, title = "Batch summary"): string {
  const L: string[] = [];
  L.push(`# ${title}`, "", `Matches: **${s.matches}** · code hash \`${s.codeHash.slice(0, 16)}\``, "");
  L.push("End reasons: " + Object.entries(s.reasons).map(([k, v]) => `${k} ${v}`).join(" · "), "");
  const inv = s.invariant;
  L.push("## Invariant: the strong fighter always beats the weak one", "",
    `strong = L20, max stats, gear 1, strategy full, aiLevel 1; weak = L1, no stats, gear 0, strategy none, aiLevel 0.`, "",
    `**${inv.pass ? "PASS" : "FAIL"}** — strong won ${inv.strongWins} / ${inv.n} (${(inv.rate * 100).toFixed(2)} %) · reasons ` +
      Object.entries(inv.byReason).map(([k, v]) => `${k} ${v}`).join(", "), "");
  if (inv.failures.length > 0) {
    L.push("| seed | design | reason | strong | weak | duration s |", "|---|---|---|---|---|---|");
    for (const f of inv.failures) L.push(`| ${f.seed} | ${f.design} | ${f.reason} | ${f.strong} | ${f.weak} | ${f.duration} |`);
    L.push("");
  }
  const head = "| cell | n | A win mean | duration median (min–max) | A hp left mean | B hp left mean | ring-out share | KO share | time share |";
  const sep = "|---|---|---|---|---|---|---|---|---|";
  const row = (name: string, t: Record<Metric, ColumnStats>) =>
    `| ${name} | ${t.winA.n} | ${f2(t.winA.mean)} | ${f2(t.duration.median)} (${f2(t.duration.min)}–${f2(t.duration.max)}) | ${f2(t.hpFracA.mean)} | ${f2(t.hpFracB.mean)} | ${f2(t.ringout.mean)} | ${f2(t.ko.mean)} | ${f2(t.time.mean)} |`;
  L.push("## Per design cell", "", head, sep, row("ALL", s.overall));
  for (const [k, t] of Object.entries(s.cells)) L.push(row(k, t));
  L.push("", "## Per gradient axis (seat A stepped, seat B at the median; arena axes step the arena)", "", head.replace("cell", "axis @ step"), sep);
  for (const [axis, steps] of Object.entries(s.axes)) for (const [p, t] of Object.entries(steps)) L.push(row(`${axis} @ ${p}`, t));
  L.push("", "Damage columns (min / median / max per cell) are in summary.json.");
  return L.join("\n") + "\n";
}
