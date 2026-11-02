// End-of-match report payload + the update review gate (Wave M, lane M-E).
//
// ONE compact object the BROWSER hands the back end once, at the end of a match:
// no streaming during the fight (the live per-tick work stays inside the engine
// at 60 FPS, lane M-A), and nothing personal in the payload — a fighter's name, a
// person's id or a raw position array must never appear in it. The report carries
// BOTH fighters' telemetry, the OPPONENT MODEL (the enemy's own behavioural data
// plus a ranked distribution over the strategies it was probably running, drawn
// from the decision tree's real leaves so every id exists) and, optionally, the
// branch-tree node the match grew from (lane M-D).
//
// The second half is the REVIEW GATE: a queued update takes accept / defer /
// refuse. Development runs in "auto" mode, where a policy decides and the
// decision records WHY; later the gate runs in "review" mode, where a person
// decides and a deferred update stays queued with its reason for a later pass.
//
// Pure module: no DOM, no THREE, no network, no Math.random and no clock — the
// caller passes the report id and the timestamp, and every statistic is a number.

import { defaultTree, edgeAwareTree, type TreeNode } from "./DecisionTree.ts";
import type { FightTelemetry } from "./FightTelemetry.ts";
export type { DistanceBands, FightTelemetry, ForceEvent, ForceSummary, HitStat, StreakStats } from "./FightTelemetry.ts";
import type { ForceSummary } from "./FightTelemetry.ts";
// Wave M integration: these types live in ONE place. Lanes M-D and M-E declared structural
// copies while M-A's module was still in flight; now they re-export the real ones, so a drift
// between the three is a compile error instead of a silent mismatch.

// ---------------------------------------------------------------------------
// The telemetry shape the report carries.
//
// WHICH: lanes M-A (FightTelemetry.ts) and M-D (BranchTree.ts) are written in
// parallel from the same contract (docs/telemetry/BRIEF.md). Neither has landed
// at the time of writing, so this module declares the STRUCTURAL mirror below
// rather than importing a file that does not exist (an import of a missing
// module would fail `deno check` for every caller). The fields and units match
// the brief exactly, so once M-A lands its `FightTelemetry` is assignment-
// compatible with this one and no call site changes. See artifacts/messages-ME.md.
// ---------------------------------------------------------------------------

/** Seconds spent in each fighter-to-fighter distance band (metres → seconds). */

/** A dry-streak distribution per fighter: how long it went without landing (s). */

/** A count + running total/max/mean for one measured quantity (damage, jumps). */

/** Everything the browser measured about ONE fighter over ONE match (M-A shape). */

// ---------------------------------------------------------------------------
// Strategy ids — drawn from the decision tree itself.
// ---------------------------------------------------------------------------

/**
 * The distinct leaf decisions a decision tree can actually emit. Walking the
 * real tree (never a hand-copied list) is what makes every `probableStrategies`
 * id one that EXISTS: a tree whose leaves change changes this set with it.
 */
export function treeStrategyIds(tree: TreeNode): string[] {
  const out: string[] = [];
  const walk = (n: TreeNode): void => {
    if (n.kind === "leaf") {
      if (n.decision !== undefined && !out.includes(n.decision)) out.push(n.decision);
      return;
    }
    walk(n.less!);
    walk(n.greater!);
  };
  walk(tree);
  return out;
}

/**
 * Every strategy id the shipped trees can produce, sorted: the union of the
 * default tree's leaves and the edge-aware tree's leaves (the "full" strategy,
 * a superset). This is the closed set a report's `probableStrategies` draws from.
 */
export const STRATEGY_IDS: readonly string[] = (() => {
  const set = new Set<string>([...treeStrategyIds(defaultTree()), ...treeStrategyIds(edgeAwareTree())]);
  return [...set].sort();
})();

/** The named distance bands a fighter can favour (the keys of `DistanceBands`). */
export const BANDS: readonly string[] = ["contact", "striking", "circling", "apart"];

// ---------------------------------------------------------------------------
// The report.
// ---------------------------------------------------------------------------

/** Bump when the payload's shape changes so the back end can refuse an old one. */
export const REPORT_SCHEMA = 1;

/** The enemy as the report sees it: all its behaviour + what it was probably doing. */
export interface OpponentModel {
  /** All of the enemy's own data (its side of the fight), measured live. */
  behavior: FightTelemetry;
  /** Ranked probable strategies, weights summing to 1; ids exist in the tree. */
  probableStrategies: { id: string; weight: number }[];
  /** Cheap habits the back end reads without re-deriving them. */
  habits: { openingMove: string; averageApproachS: number; retreatThreshold: number; favouredBand: string };
}

/** The one payload the browser hands the back end at the end of a match. */
export interface MatchReport {
  /** Payload version (REPORT_SCHEMA). */
  schema: number;
  /** Opaque, caller-supplied report id — not a person, not a name. */
  id: string;
  /** Caller-supplied ISO timestamp (the module holds no clock). */
  createdAt: string;
  /** [fighter 0, fighter 1] telemetry, measured live by the front end. */
  telemetry: [FightTelemetry, FightTelemetry];
  /** The opponent model (the enemy's behaviour + probable strategies). */
  opponent: OpponentModel;
  /** How the match ended, e.g. "ko", "ring-out", "time-limit". */
  outcome: string;
  /** The branch-tree node the match came from, when it grew from one (M-D). */
  tree?: { node: string; depth: number };
  /** Wave FALL (C-LOG): the match's collisions / falls / rises (events capped at REPORT_FORCE_EVENTS). */
  forces?: ForceSummary;
}

/** Wave FALL: force events a report carries (the rest are counted in `dropped`), keeping it under the byte cap. */
export const REPORT_FORCE_EVENTS = 16;

/** A force summary trimmed for the wire: events capped, numbers rounded to 0.01. */
export function compactForces(f: ForceSummary, cap = REPORT_FORCE_EVENTS): ForceSummary {
  const r = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
  const kept = f.events.slice(0, cap).map((e) => ({
    ...e, t: r(e.t), impulse: r(e.impulse), balance: r(e.balance), pushback: r(e.pushback), duration: r(e.duration), hp01: r(e.hp01), stamina01: r(e.stamina01),
  }));
  return {
    ...f, downS: [r(f.downS[0]), r(f.downS[1])], meanDownS: r(f.meanDownS),
    damageWhileDown: [r(f.damageWhileDown[0]), r(f.damageWhileDown[1])], causes: { ...f.causes },
    events: kept, dropped: f.dropped + Math.max(0, f.events.length - cap),
  };
}

/** Hard cap (bytes) on an encoded report for a fixed 180-second match. */
export const REPORT_BYTE_CAP = 8192;

/** Bytes the JSON encoding of a report occupies: the payload's real wire size. */
export function encodedBytes(report: MatchReport): number {
  return new TextEncoder().encode(JSON.stringify(report)).length;
}

export interface BuildReportInput {
  /** Opaque report id (no person, no name). */
  id: string;
  /** ISO timestamp, supplied by the caller. */
  createdAt: string;
  /** Both fighters' telemetry, index 0 / 1. */
  telemetry: [FightTelemetry, FightTelemetry];
  /** Which index the opponent model describes (the enemy). */
  opponentIndex: 0 | 1;
  /** Candidate probable strategies; ids not in the tree are DROPPED, not kept. */
  probableStrategies: { id: string; weight: number }[];
  /** The enemy's measured habits. */
  habits: OpponentModel["habits"];
  /** How the match ended. */
  outcome: string;
  /** Optional branch-tree provenance (M-D). */
  tree?: { node: string; depth: number };
  /** Wave FALL: the match's force log (compacted by compactForces). */
  forces?: ForceSummary;
}

/**
 * Keep only real, positive-weighted strategies, then normalise to a distribution
 * (weights sum to 1) and rank them descending. An id that is not a leaf of a
 * shipped tree is dropped — the report may never claim a strategy that cannot
 * happen. All-zero or all-unknown input yields an empty list (no strategies).
 */
function normalizeStrategies(list: { id: string; weight: number }[]): { id: string; weight: number }[] {
  const known = new Set(STRATEGY_IDS);
  const seen = new Set<string>();
  const kept: { id: string; weight: number }[] = [];
  for (const s of list) {
    const w = Number.isFinite(s.weight) && s.weight > 0 ? s.weight : 0;
    if (w === 0 || !known.has(s.id) || seen.has(s.id)) continue;
    seen.add(s.id);
    kept.push({ id: s.id, weight: w });
  }
  const sum = kept.reduce((a, s) => a + s.weight, 0);
  if (sum <= 0) return [];
  return kept
    .map((s) => ({ id: s.id, weight: s.weight / sum }))
    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
}

/** Finite number, else 0 — a habit must never carry a NaN into the payload. */
function num(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

/**
 * Build the compact report. Copies the two fighters' telemetry, points the
 * opponent model at the enemy's side, normalises the probable strategies to a
 * real distribution drawn from the decision tree, and sanitises the habits.
 * Nothing here can carry a name, an id of a person or a position: the input has
 * no such field and the output adds none.
 */
export function buildReport(o: BuildReportInput): MatchReport {
  const opponent: OpponentModel = {
    behavior: o.telemetry[o.opponentIndex],
    probableStrategies: normalizeStrategies(o.probableStrategies),
    habits: {
      openingMove: o.habits.openingMove,
      averageApproachS: num(o.habits.averageApproachS),
      retreatThreshold: num(o.habits.retreatThreshold),
      favouredBand: o.habits.favouredBand,
    },
  };
  const report: MatchReport = {
    schema: REPORT_SCHEMA,
    id: o.id,
    createdAt: o.createdAt,
    telemetry: o.telemetry,
    opponent,
    outcome: o.outcome,
  };
  if (o.tree) report.tree = { node: o.tree.node, depth: num(o.tree.depth) };
  if (o.forces) report.forces = compactForces(o.forces);
  return report;
}

// ---------------------------------------------------------------------------
// Privacy: the payload's own claim, enforced (not a comment).
// ---------------------------------------------------------------------------

/** Keys whose mere presence would mean a person travelled with the payload. */
const FORBIDDEN_KEYS = new Set([
  "name", "fullname", "playername", "player", "userid", "user", "personalid", "person", "email",
  "account", "accountid", "ip", "deviceid", "coordinates", "coords", "positions", "position",
  "path", "trail", "gps",
]);

/** Longest numeric run a report may legitimately carry (a coordinate triple is 3). */
const MAX_NUMERIC_ARRAY = 3;

function scanForPersonal(v: unknown, path: string): void {
  if (Array.isArray(v)) {
    if (v.length > MAX_NUMERIC_ARRAY && v.every((e) => typeof e === "number")) {
      throw new Error(`report carries a raw numeric array at ${path} (len ${v.length})`);
    }
    v.forEach((e, i) => scanForPersonal(e, `${path}[${i}]`));
    return;
  }
  if (v !== null && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k.toLowerCase())) {
        throw new Error(`report carries a personal field "${k}" at ${path}`);
      }
      scanForPersonal(val, `${path}.${k}`);
    }
  }
}

/**
 * The payload's own privacy claim. Returns `false` — the literal type — because
 * a report built by `buildReport` carries no name, no id of a person and no raw
 * position array. It does not merely ASSERT that: it walks the payload and throws
 * if a personal key or a long numeric (coordinate) array ever appears, so adding
 * one such field to the type breaks this claim loudly instead of shipping.
 */
export function isPersonalData(report: MatchReport): false {
  scanForPersonal(report, "$");
  return false;
}

// ---------------------------------------------------------------------------
// The review gate: accept / defer / refuse, plus a development auto mode.
// ---------------------------------------------------------------------------

export type Verdict = "accept" | "defer" | "refuse";

/** An update the back end digested from a report and queued for the game. */
export interface QueuedUpdate {
  /** Opaque update id. */
  id: string;
  /** The report it was digested from. */
  reportId: string;
  /** What it changes, e.g. "policy-weights", "tree-thresholds", "balance". */
  kind: string;
  /** Measured confidence/quality of the update, 0..1. */
  confidence: number;
  /** WHY this update exists (kept verbatim, survives a deferral). */
  reason: string;
  /** The verdict applied, once one is. Absent = still awaiting a decision. */
  verdict?: Verdict;
  /** WHY the verdict was reached (mode + the value it rested on). */
  decisionReason?: string;
}

/** The review ledger: what still waits, and where each decided update landed. */
export interface QueueState {
  /** Updates with no verdict yet. */
  pending: QueuedUpdate[];
  /** Accepted updates, to be applied. */
  accepted: QueuedUpdate[];
  /** Deferred updates: still queued, kept with their reason for a later pass. */
  deferred: QueuedUpdate[];
  /** Refused updates: never applied. */
  refused: QueuedUpdate[];
}

/** An empty ledger: nothing queued, nothing decided. */
export function emptyQueue(): QueueState {
  return { pending: [], accepted: [], deferred: [], refused: [] };
}

/** Concatenate two ledgers bucket by bucket (order preserved). */
export function mergeQueues(a: QueueState, b: QueueState): QueueState {
  return {
    pending: [...a.pending, ...b.pending],
    accepted: [...a.accepted, ...b.accepted],
    deferred: [...a.deferred, ...b.deferred],
    refused: [...a.refused, ...b.refused],
  };
}

/**
 * Apply one verdict to one queued update and return the ledger for it.
 *
 * accept  → the update lands in `accepted` (to be applied).
 * defer   → the update lands in `deferred`, STILL QUEUED for a later review, and
 *           keeps its original `reason`; only `decisionReason` records the why.
 * refuse  → the update lands in `refused` (never applied).
 *
 * `mode` records HOW the verdict was reached and is written into the reason:
 * "auto" is the development policy deciding, "review" is a person deciding.
 */
export function applyVerdict(q: QueuedUpdate, v: Verdict, mode: "auto" | "review"): QueueState {
  const why = mode === "auto"
    ? `auto: confidence ${num(q.confidence).toFixed(2)} -> ${v}`
    : `review: reviewer chose ${v}`;
  const decided: QueuedUpdate = { ...q, verdict: v, decisionReason: why };
  const state = emptyQueue();
  if (v === "accept") state.accepted.push(decided);
  else if (v === "defer") state.deferred.push(decided);
  else state.refused.push(decided);
  return state;
}

/** The development policy: the thresholds and the kinds auto mode may touch. */
export interface AutoPolicy {
  /** Accept at or above this confidence (0..1). */
  acceptAt: number;
  /** Refuse below this confidence (0..1); in between is deferred. */
  refuseBelow: number;
  /** Update kinds auto mode may apply; absent/empty = any kind. */
  allowedKinds?: string[];
}

/**
 * The verdict the development auto mode gives an update: everything that passes
 * the policy's MEASURED gate. A kind the policy does not allow is REFUSED (auto
 * mode may not silently touch it); otherwise confidence at/above `acceptAt` is
 * accepted, below `refuseBelow` is refused, and the band between is deferred to a
 * person. Pure: the policy is a value, so the same update always decides the same.
 */
export function autoVerdict(q: QueuedUpdate, policy: AutoPolicy): Verdict {
  const allowed = policy.allowedKinds;
  if (allowed && allowed.length > 0 && !allowed.includes(q.kind)) return "refuse";
  const c = num(q.confidence);
  if (c >= policy.acceptAt) return "accept";
  if (c < policy.refuseBelow) return "refuse";
  return "defer";
}
