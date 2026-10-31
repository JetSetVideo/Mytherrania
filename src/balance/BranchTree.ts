// Wave M (lane M-D): the BRANCH TREE over the initial arena.
//
//   branchPlan()      a deterministic planner: builds the arenas from one seed and enumerates the
//                     branches over arena x victory condition x match-up combination.
//   buildBranchTree() a builder that replays each branch through an INJECTED runner — the existing
//                     batch back end (runBatch/MatchSim), never a second simulator — and keeps the
//                     branch structure: every node carries its own telemetry, outcome, distance
//                     bands, fighter gap, evolution and object events, plus a link to its parent.
//   summariseTree()   a summariser that reports, per depth, the win rates, distance bands, stall and
//                     damage, and the branch COUNTS at each depth (numbers, not prose).
//
// The tree is bounded by BOTH a node count and a depth; the counts of branches pruned by each bound
// are kept on the tree so the summary can print them. The plan is reproducible from its seed:
// branchPlan(o) twice returns byte-identical plans.
//
// Pure module: no DOM, no THREE, no Math.random. Deterministic per seed.
//
// NOTE (M-D consuming M-A): lane M-A's src/game/FightTelemetry.ts is not in the tree yet. This
// module declares FightTelemetry locally as a STRUCTURAL copy of the frozen contract in
// docs/telemetry/BRIEF.md, so a node's telemetry is exactly the shape M-A will produce (the parent
// wires the two). When M-A lands, swap this block for
//   export type { FightTelemetry } from "../game/FightTelemetry.ts";
// and nothing else in this file changes. A runner may attach its live telemetry to the returned
// record (MatchRecord & { telemetry? }); when it does not, the node falls back to the numbers the
// record itself carries (see telemetryFromRecord).

import { makeArena, shapeOf, type ArenaConfig } from "../game/ArenaConfig.ts";
import type { MatchOutcome, MatchRecord } from "../game/arena/contracts.ts";
import { randomSource } from "./ArenaHarness.ts";
import type { DistanceBands, FightTelemetry, HitStat, StreakStats } from "../game/FightTelemetry.ts";
export type { DistanceBands, FightTelemetry, HitStat, StreakStats } from "../game/FightTelemetry.ts";
// Wave M integration: these types live in ONE place. Lanes M-D and M-E declared structural
// copies while M-A's module was still in flight; now they re-export the real ones, so a drift
// between the three is a compile error instead of a silent mismatch.

// ─── victory conditions ──────────────────────────────────────────────────────────────────────────

/**
 * A victory condition the tree branches on. Each is a genuinely different bout in the headless
 * simulator: `timeLimit` picks MatchControl's rule at the bell (a judged decision vs a plain tie) and
 * `limitS` is the hostile-seconds cap (a short cap forces the judge, a long one lets a KO land), while
 * `openArena` knocks the perimeter open so a ring-out can decide the bout.
 */
export interface VictoryCondition {
  id: string;
  label: string;
  /** Which rule decides at the bell: the judge's decision, or a plain time-limit tie. */
  timeLimit: "judge" | "tie";
  /** The hostile-seconds cap this bout is played under (MatchControl's limit). */
  limitS: number;
  /** Knock the perimeter open so a ring-out can decide the bout. */
  openArena: boolean;
}

export const VICTORIES: readonly VictoryCondition[] = [
  { id: "ko", label: "Knockout", timeLimit: "judge", limitS: 180, openArena: false },
  { id: "ringout", label: "Ring-out", timeLimit: "judge", limitS: 180, openArena: true },
  { id: "judge", label: "Judge's decision", timeLimit: "judge", limitS: 60, openArena: false },
  { id: "tie", label: "Time-limit tie", timeLimit: "tie", limitS: 180, openArena: false },
];

const VICTORY_BY_ID: Record<string, VictoryCondition> = Object.fromEntries(VICTORIES.map((v) => [v.id, v]));

/** The victory condition a runner should play a branch with (unknown id -> the first). */
export function victoryOf(id: string): VictoryCondition {
  return VICTORY_BY_ID[id] ?? VICTORIES[0];
}

// ─── match-up combinations ───────────────────────────────────────────────────────────────────────

/**
 * The match-up combinations the tree branches on: ordered pairs of fighter classes (seat A vs seat
 * B). "Ordered" means a mirror is distinct; the runner turns a pair into the two FighterSpecs.
 */
export const MATCHUPS: readonly [string, string][] = [
  ["Warrior", "Mage"],
  ["Barbarian", "Rogue"],
  ["Assassin", "Archer"],
  ["Priest", "Necromancer"],
];

// ─── the plan ────────────────────────────────────────────────────────────────────────────────────

/** One planned branch group: an arena, ONE victory condition, the match-ups to try under it, a seed. */
export interface BranchPlan { arena: ArenaConfig; victory: string; matchups: [string, string][]; seed: number }

export interface BranchPlanOptions {
  seed: number;
  /** Distinct arenas to build (1..64, default 4). */
  arenas?: number;
  /** Victory conditions to use, in VICTORIES order (1..4, default all). */
  victories?: number;
  /** Cap on the branch groups (arena x victory x match-up); default the user's "thousands" = 4096. */
  maxBranches?: number;
}

/** Arena sizes the planner draws from, m (spanning the arena model's 2 m closet to a 320 m field). */
export const ARENA_SIZES: readonly number[] = [8, 14, 25, 60];
/** Base perimeter-wall height the planner spawns, m (the contract's typical low band). */
export const ARENA_WALL_HEIGHT = 1.2;
/** Interpolated default cap: "thousands of branches" (the user's words), a round power of two. */
export const DEFAULT_MAX_BRANCHES = 4096;

const clampInt = (v: number, lo: number, hi: number): number => Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : lo;
/** Mulberry3-style integer avalanche: any int -> a uint32 (seeded, no Math.random). */
function mix32(x: number): number {
  let h = x >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h >>> 0;
}

/** A short, human-readable venue label so two nodes on different arenas never collide. */
export function venueLabel(cfg: ArenaConfig): string {
  return `${cfg.size.toFixed(0)}m/${shapeOf(cfg)}/${cfg.walls >= 1 ? "walled" : "open"}/g${cfg.ground}`;
}

/**
 * Enumerate the branch groups from one seed. One plan per (arena x victory): the arena config, the
 * victory condition and the match-up list to branch. The match-ups per plan are shrunk so that
 * arenas * victories * perPlan <= maxBranches. Deterministic: the same options always give the
 * same plans, in the same order, with the same seeds.
 */
export function branchPlan(o: BranchPlanOptions): BranchPlan[] {
  const seed = Number.isFinite(o.seed) ? Math.trunc(o.seed) : 0;
  const nArenas = clampInt(o.arenas ?? 4, 1, 64);
  const nVict = clampInt(o.victories ?? VICTORIES.length, 1, VICTORIES.length);
  const cap = o.maxBranches === undefined ? DEFAULT_MAX_BRANCHES : Math.max(0, Math.floor(o.maxBranches));
  const victories = VICTORIES.slice(0, nVict);
  // How many match-ups fit under each (arena, victory) without breaking the branch cap.
  const perPlan = Math.min(MATCHUPS.length, Math.floor(cap / Math.max(1, nArenas * victories.length)));

  const rng = randomSource((seed ^ 0x9e3779b1) >>> 0);
  const bases: Partial<ArenaConfig>[] = [];
  for (let i = 0; i < nArenas; i++) {
    bases.push({
      size: ARENA_SIZES[Math.floor(rng() * ARENA_SIZES.length)],
      walls: rng() < 0.5 ? 1 : 0,
      wallHeight: ARENA_WALL_HEIGHT,
      objects: Math.floor(rng() * 6),
      objectSpread: 0.75,
      shape: Math.floor(rng() * 8),
      ground: Math.floor(rng() * 4),
      aspect: 1,
      rotation: 0,
      outsideGround: 1,
      outsideCollision: 1,
      outsideHeight: -1,
      roamSeconds: 6,
    });
  }

  const plans: BranchPlan[] = [];
  for (let ai = 0; ai < nArenas; ai++) {
    for (let vi = 0; vi < victories.length; vi++) {
      const v = victories[vi];
      const arena = makeArena({ ...bases[ai], walls: v.openArena ? 0 : bases[ai].walls });
      const pseed = mix32((seed ^ Math.imul(ai * 31 + vi + 1, 0x85ebca6b)) >>> 0);
      const matchups = MATCHUPS.slice(0, perPlan).map((m): [string, string] => [m[0], m[1]]);
      plans.push({ arena, victory: v.id, matchups, seed: pseed });
    }
  }
  return plans;
}

// ─── the tree ────────────────────────────────────────────────────────────────────────────────────

/** One branch node = one played match: who/where/how, its telemetry, and its place in the tree. */
export interface BranchNode {
  id: string;
  parent: string | null;
  depth: number;
  venue: string;
  condition: string;
  matchup: string;
  outcome: string;
  telemetry: FightTelemetry;
}

/** Cross-branch counts pruned by the tree's two bounds, so nothing is silently dropped. */
export interface PrunedCounts { byNodes: number; byDepth: number }

export interface BranchTree {
  root: string | null;
  nodes: BranchNode[];
  /** Distinct arenas / victories / match-ups the tree actually branches on. */
  arenas: number;
  victories: number;
  matchups: number;
  maxNodes: number;
  maxDepth: number;
  /** Distinct branches replayed through the runner (memoised: a shared key runs once). */
  runs: number;
  pruned: PrunedCounts;
}

/**
 * How a branch is played. It receives a plan whose `matchups` list has been narrowed to the ONE
 * match-up this branch is about (plus the arena, the victory id and a per-branch seed), so a runner
 * is a plain function of the plan — the parent wires it to runBatch. It may attach the machine's
 * live telemetry to the returned record; if it does not, the node falls back to the record's own
 * numbers (telemetryFromRecord).
 */
export type BranchRunner = (p: BranchPlan) => MatchRecord & { telemetry?: FightTelemetry };

/** How many depth levels to branch before stopping (the tree's depth bound). */
export const DEFAULT_MAX_DEPTH = 3;

/** A zero-count hit statistic, for a runner that carries no live telemetry. */
function emptyHitStat(): HitStat { return { count: 0, total: 0, max: 0, mean: 0 }; }
function emptyStreak(): StreakStats { return { count: 0, totalS: 0, meanS: 0, maxS: 0, minS: 0 }; }

/**
 * The telemetry a node carries. A runner that captured live telemetry returns it on the record and
 * it is used verbatim (the M-A shape, exact). A runner that did not returns a record whose outcome
 * still carries the damages, hits and duration, so the node reports those and the position-derived
 * fields (distance, bands, streaks) as zero — never a fabricated number.
 */
export function telemetryFromRecord(rec: MatchRecord & { telemetry?: FightTelemetry }): FightTelemetry {
  if (rec.telemetry) return rec.telemetry;
  const o = rec.outcome;
  const stat = (total: number, count: number): HitStat => ({ count, total, max: count > 0 ? total / count : 0, mean: count > 0 ? total / count : 0 });
  return {
    durationS: o.duration,
    dryStreak: [emptyStreak(), emptyStreak()],
    mutualDryS: 0, quietS: 0, quietMaxS: 0,
    distance: { mean: 0, median: 0, min: 0, max: 0, p10: 0, p90: 0 },
    bands: { contact: 0, striking: 0, circling: 0, apart: 0 },
    engagement: { closingS: 0, contactS: 0, standoffMaxS: 0 },
    jumps: [emptyHitStat(), emptyHitStat()],
    damageDealt: [stat(o.damageDealt[0], o.hits[0]), stat(o.damageDealt[1], o.hits[1])],
    damageTaken: [stat(o.damageDealt[1], o.hits[1]), stat(o.damageDealt[0], o.hits[0])],
    damageAbsorbed: [emptyHitStat(), emptyHitStat()],
    damageByWeapon: {},
    objects: { taken: 0, destroyed: 0, defended: 0, attacked: 0 },
    evolution: [],
  };
}

/** A branch outcome as one label: "A·ko", "B·ringout", "draw·time". */
export function outcomeLabel(o: MatchOutcome): string {
  const who = o.winner === null ? "draw" : o.winner === 0 ? "A" : "B";
  return `${who}·${o.reason}`;
}

interface Venue { label: string; cfg: ArenaConfig; victories: string[]; matchups: [string, string][] }
interface Ctx { venue: number; victory: string; matchup: [string, string]; round: number }

/**
 * Play every branch through `run` and keep the branch structure.
 *
 * Layout — depth is how many branch decisions deep a node is:
 *   0  the initial arena (one synthetic node; its telemetry is the arena's opening branch)
 *   1  one node per venue (that arena's opening branch)
 *   2  one node per victory condition under each venue
 *   3  one node per match-up combination under each victory
 *   4  the continuation round of each match-up ("to the end")
 * Bounded by BOTH maxNodes (a branch that would start past the cap is counted in pruned.byNodes)
 * and maxDepth (a level past the depth cap is counted in pruned.byDepth). A branch key is memoised,
 * so a shared reading is replayed once. Pure: nodes, ids, seeds and order are all deterministic.
 */
export function buildBranchTree(plans: BranchPlan[], run: BranchRunner, maxNodes: number, maxDepth = DEFAULT_MAX_DEPTH): BranchTree {
  const nodeCap = Math.max(0, Math.floor(maxNodes));
  const depthCap = Math.max(0, Math.floor(maxDepth));

  // Group the plans by venue: an arena is distinct once (its victories / match-ups accumulate).
  const venueMap = new Map<string, Venue>();
  for (const p of plans) {
    const label = venueLabel(p.arena);
    let e = venueMap.get(label);
    if (!e) {
      e = { label, cfg: p.arena, victories: [], matchups: p.matchups.length ? p.matchups : MATCHUPS.map((m): [string, string] => [m[0], m[1]]) };
      venueMap.set(label, e);
    }
    if (!e.victories.includes(p.victory)) e.victories.push(p.victory);
  }
  const venues = [...venueMap.values()];

  const nodes: BranchNode[] = [];
  const memo = new Map<string, MatchRecord & { telemetry?: FightTelemetry }>();
  const pruned: PrunedCounts = { byNodes: 0, byDepth: 0 };
  let runs = 0;

  /** Seed a branch from its indices so the same branch key always plays the same match. */
  const branchSeed = (vi: number, victory: string, m: [string, string], round: number): number => {
    const vIdx = VICTORIES.findIndex((x) => x.id === victory);
    const mIdx = MATCHUPS.findIndex((x) => x[0] === m[0] && x[1] === m[1]);
    return mix32((vi * 73856093) ^ (vIdx * 19349663) ^ (mIdx * 83492791) ^ (round * 2654435761)) >>> 0;
  };
  const keyOf = (vi: number, victory: string, m: [string, string], round: number): string => `${vi}|${victory}|${m[0]}-${m[1]}|r${round}`;

  const play = (vi: number, victory: string, m: [string, string], round: number): MatchRecord & { telemetry?: FightTelemetry } => {
    const key = keyOf(vi, victory, m, round);
    let r = memo.get(key);
    if (!r) {
      const plan: BranchPlan = { arena: venues[vi].cfg, victory, matchups: [m], seed: branchSeed(vi, victory, m, round) };
      r = run(plan);
      runs++;
      memo.set(key, r);
    }
    return r;
  };

  const push = (parentId: string | null, depth: number, vi: number, victory: string, m: [string, string], round: number, id: string): string => {
    const rec = play(vi, victory, m, round);
    nodes.push({
      id, parent: parentId, depth, venue: venues[vi].label,
      condition: depth === 0 ? "-" : victory,
      matchup: depth === 0 ? "-" : `${m[0]} vs ${m[1]}`,
      outcome: outcomeLabel(rec.outcome),
      telemetry: telemetryFromRecord(rec),
    });
    return id;
  };

  if (venues.length === 0 || nodeCap === 0 || depthCap < 0) {
    return { root: null, nodes, arenas: venues.length, victories: 0, matchups: 0, maxNodes: nodeCap, maxDepth: depthCap, runs, pruned };
  }

  // Depth 0: the initial arena. Synthetic — the arena itself has no match, so it borrows the reading
  // of its opening branch (arena 0, its first victory, its first match-up): "how the game was".
  const v0 = venues[0];
  const rootVictory = v0.victories[0] ?? VICTORIES[0].id;
  const rootMatchup = v0.matchups[0] ?? MATCHUPS[0];
  const rootId = push(null, 0, 0, rootVictory, rootMatchup as [string, string], 1, "root");

  // Children of a node, by depth (returns the branch contexts, not yet built).
  const childrenOf = (depth: number, ctx: Ctx): Ctx[] => {
    const v = venues[ctx.venue];
    if (depth === 0) return venues.map((_, vi) => ({ venue: vi, victory: venues[vi].victories[0] ?? VICTORIES[0].id, matchup: venues[vi].matchups[0] ?? MATCHUPS[0], round: 1 }));
    if (depth === 1) return v.victories.map((victory) => ({ venue: ctx.venue, victory, matchup: v.matchups[0] ?? MATCHUPS[0], round: 1 }));
    if (depth === 2) return v.matchups.map((matchup) => ({ venue: ctx.venue, victory: ctx.victory, matchup, round: 1 }));
    if (depth === 3) return [{ venue: ctx.venue, victory: ctx.victory, matchup: ctx.matchup, round: 2 }];
    return [];
  };
  const idOf = (depth: number, ctx: Ctx): string => {
    const mIdx = venues[ctx.venue].matchups.findIndex((m) => m[0] === ctx.matchup[0] && m[1] === ctx.matchup[1]);
    if (depth === 1) return `v${ctx.venue}`;
    if (depth === 2) return `w${ctx.venue}·${ctx.victory}`;
    if (depth === 3) return `m${ctx.venue}·${ctx.victory}·${mIdx}`;
    return `e${ctx.venue}·${ctx.victory}·${mIdx}·r${ctx.round}`;
  };

  // Breadth-first, so a node-cap truncation drops the deepest / latest branches.
  const queue: { id: string; depth: number; ctx: Ctx }[] = [{ id: rootId, depth: 0, ctx: { venue: 0, victory: rootVictory, matchup: rootMatchup as [string, string], round: 1 } }];
  while (queue.length > 0) {
    const { id, depth, ctx } = queue.shift()!;
    if (depth >= depthCap) {
      // The depth bound refuses this node's children: count every branch it would have spawned.
      if (depth === depthCap) pruned.byDepth += childrenOf(depth, ctx).length;
      continue;
    }
    const kids = childrenOf(depth, ctx);
    for (let i = 0; i < kids.length; i++) {
      if (nodes.length >= nodeCap) { pruned.byNodes += kids.length - i; break; }
      const kid = kids[i];
      const kidId = push(id, depth + 1, kid.venue, kid.victory, kid.matchup, kid.round, idOf(depth + 1, kid));
      queue.push({ id: kidId, depth: depth + 1, ctx: kid });
    }
  }
  const victories = new Set(nodes.filter((n) => n.depth >= 1).map((n) => n.condition));
  const matchups = new Set(nodes.filter((n) => n.depth >= 2).map((n) => n.matchup));
  return { root: rootId, nodes, arenas: venues.length, victories: victories.size, matchups: matchups.size, maxNodes: nodeCap, maxDepth: depthCap, runs, pruned };
}

// ─── the summary ─────────────────────────────────────────────────────────────────────────────────

/** The report for one depth in the tree: branch counts, win rates, distance, stall and damage. */
export interface DepthSummary {
  depth: number;
  /** Branches — the node count at this depth (the number the report leads with). */
  branches: number;
  /** Branches with a winner / a draw. */
  decided: number;
  draws: number;
  /** Seat-A win share of the DECIDED branches (0 when none). */
  winRateA: number;
  reasons: Record<string, number>;
  meanDurationS: number;
  /** Mean telemetry distance (m) across the branches. */
  meanDistanceM: number;
  /** Mean seconds per distance band across the branches. */
  bands: DistanceBands;
  /** Mean longest stand-off (s) — the stall the user described. */
  stallMeanS: number;
  /** Mean of fighter A's longest dry streak (s). */
  dryMaxMeanS: number;
  /** Mean total damage dealt across the branches (both seats, HP). */
  damageMean: number;
}

export interface TreeSummary {
  nodes: number;
  arenas: number;
  victories: number;
  matchups: number;
  maxNodes: number;
  maxDepth: number;
  runs: number;
  pruned: PrunedCounts;
  /** depth -> branch count (the depth histogram, as counts). */
  depthHistogram: Record<string, number>;
  perDepth: DepthSummary[];
}

const f2 = (v: number): number => (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : 0);
const mean = (xs: number[]): number => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : 0);

/** Summarise a tree per depth: win rates, distance bands, stall, damage and the branch counts. */
export function summariseTree(t: BranchTree): TreeSummary {
  const byDepth = new Map<number, BranchNode[]>();
  for (const n of t.nodes) {
    if (!byDepth.has(n.depth)) byDepth.set(n.depth, []);
    byDepth.get(n.depth)!.push(n);
  }
  const perDepth: DepthSummary[] = [];
  const depthHistogram: Record<string, number> = {};
  let total = 0;
  for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
    const list = byDepth.get(depth)!;
    depthHistogram[String(depth)] = list.length;
    total += list.length;
    const decided = list.filter((n) => !n.outcome.startsWith("draw")).length;
    const winsA = list.filter((n) => n.outcome.startsWith("A·")).length;
    const reasons: Record<string, number> = {};
    for (const n of list) {
      const r = n.outcome.slice(n.outcome.indexOf("·") + 1);
      reasons[r] = (reasons[r] ?? 0) + 1;
    }
    perDepth.push({
      depth,
      branches: list.length,
      decided,
      draws: list.length - decided,
      winRateA: decided > 0 ? f2(winsA / decided) : 0,
      reasons,
      meanDurationS: f2(mean(list.map((n) => n.telemetry.durationS))),
      meanDistanceM: f2(mean(list.map((n) => n.telemetry.distance.mean))),
      bands: {
        contact: f2(mean(list.map((n) => n.telemetry.bands.contact))),
        striking: f2(mean(list.map((n) => n.telemetry.bands.striking))),
        circling: f2(mean(list.map((n) => n.telemetry.bands.circling))),
        apart: f2(mean(list.map((n) => n.telemetry.bands.apart))),
      },
      stallMeanS: f2(mean(list.map((n) => n.telemetry.engagement.standoffMaxS))),
      dryMaxMeanS: f2(mean(list.map((n) => n.telemetry.dryStreak[0].maxS))),
      damageMean: f2(mean(list.map((n) => n.telemetry.damageDealt[0].total + n.telemetry.damageDealt[1].total))),
    });
  }
  return {
    nodes: total, arenas: t.arenas, victories: t.victories, matchups: t.matchups,
    maxNodes: t.maxNodes, maxDepth: t.maxDepth, runs: t.runs, pruned: t.pruned,
    depthHistogram, perDepth,
  };
}
