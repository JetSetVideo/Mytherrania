// Wave M (lane M-D): the branch tree's tests.
//
// The tree builder delegates to an INJECTED runner, so these tests supply two:
//   traceRunner — plays a branch with the headless simulator (MatchSim, the same simulator runBatch
//                 calls) and captures its trace, turning it into the M-A telemetry shape so the
//                 summary can print real distances and stalls. This is M-D evidence glue over the
//                 simulator's own event stream, not a second simulator and not lane M-A's module.
//   batchRunner — plays a branch through runBatch, the existing batch back end, proving the tree
//                 composes with it.
//
// House rules: a number is printed, not asserted in prose; the tree is bounded by nodes AND depth.

import {
  ARENA_SIZES,
  type BranchPlan,
  type BranchTree,
  branchPlan,
  buildBranchTree,
  MATCHUPS,
  outcomeLabel,
  summariseTree,
  telemetryFromRecord,
  VICTORIES,
  victoryOf,
  venueLabel,
} from "../src/balance/BranchTree.ts";
import { runBatch } from "../src/balance/Batch.ts";
import { simulateMatch, type SimEvent } from "../src/balance/MatchSim.ts";
import { WAVE_J_RULES, type MatchRules } from "../src/balance/MatchRules.ts";
import { buildLaneJTArena } from "../src/balance/ArenaJT.ts";
import { MID_KNOBS, fighterSpecOf, WEAPONS, type Categorical } from "../src/balance/Gradient.ts";
import { ANCESTRIES } from "../src/balance/FighterBuild.ts";
import { randomSource } from "../src/balance/ArenaHarness.ts";
import type { FightTelemetry, HitStat, StreakStats } from "../src/balance/BranchTree.ts";
import type { MatchConditions, MatchOutcome, MatchRecord } from "../src/game/arena/contracts.ts";
import { CLASSES, type ClassName } from "../src/game/Stats.ts";

// ─── assertions ──────────────────────────────────────────────────────────────────────────────────

function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function eq<T>(a: T, b: T, msg: string): void {
  if (a !== b) throw new Error(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

// ─── the M-D runner: the simulator + its trace -> the M-A telemetry shape ─────────────────────────

const CONTACT_M = 1.2, STRIKING_M = 2.6, CIRCLING_M = 6;

function streakOf(hitTimes: number[], durationS: number): StreakStats {
  const t = [...hitTimes].sort((a, b) => a - b);
  const gaps: number[] = [];
  let prev = 0;
  for (const x of t) { gaps.push(Math.max(0, x - prev)); prev = x; }
  gaps.push(Math.max(0, durationS - prev));
  const total = gaps.reduce((a, b) => a + b, 0);
  return { count: gaps.length, totalS: total, meanS: gaps.length ? total / gaps.length : 0, maxS: gaps.length ? Math.max(...gaps) : 0, minS: gaps.length ? Math.min(...gaps) : 0 };
}
const meanOf = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const q = (sorted: number[], p: number): number => {
  if (!sorted.length) return 0;
  const i = p * (sorted.length - 1), lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};
const bandOf = (d: number): keyof FightTelemetry["bands"] => d <= CONTACT_M ? "contact" : d <= STRIKING_M ? "striking" : d <= CIRCLING_M ? "circling" : "apart";

/** Turn a match's own event trace into a FightTelemetry (distance from inter-fighter samples). */
function telemetryFromEvents(o: MatchOutcome, events: SimEvent[]): FightTelemetry {
  const durationS = o.duration > 0 ? o.duration : (events.length ? events[events.length - 1].t : 0);
  const last: [number, number][] = [[NaN, NaN], [NaN, NaN]];
  const samples: { t: number; d: number }[] = [];
  const hitTimes: number[][] = [[], []];
  const hitDamage: number[][] = [[], []];
  for (const e of events) {
    if (e.kind === "think") {
      last[e.seat] = [e.x, e.z];
      if (Number.isFinite(last[0][0]) && Number.isFinite(last[1][0])) {
        samples.push({ t: e.t, d: Math.hypot(last[0][0] - last[1][0], last[0][1] - last[1][1]) });
      }
    } else if (e.kind === "hit") {
      hitTimes[e.seat].push(e.t);
      hitDamage[e.seat].push(e.damage ?? 0);
    }
  }
  const sortedD = samples.map((s) => s.d).sort((a, b) => a - b);
  const bands = { contact: 0, striking: 0, circling: 0, apart: 0 };
  let closingS = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t;
    if (dt <= 0) continue;
    bands[bandOf((samples[i].d + samples[i - 1].d) / 2)] += dt;
    if (samples[i].d < samples[i - 1].d) closingS += dt;
  }
  const allHits = [...hitTimes[0], ...hitTimes[1]].sort((a, b) => a - b);
  const quiet = streakOf(allHits, durationS);
  // Stand-off: the longest run of samples with no hit in the interval and distance > CIRCLING_M.
  let standoffMaxS = 0, runStart = -1, hp = 0, lastHitAt = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    while (hp < allHits.length && allHits[hp] <= s.t) { lastHitAt = allHits[hp]; hp++; }
    const prevT = i > 0 ? samples[i - 1].t : 0;
    const hitInGap = lastHitAt > prevT;
    if (s.d > CIRCLING_M && !hitInGap) { if (runStart < 0) runStart = prevT; standoffMaxS = Math.max(standoffMaxS, s.t - runStart); }
    else runStart = -1;
  }
  const stat = (seat: number): HitStat => ({ count: o.hits[seat], total: o.damageDealt[seat], max: hitDamage[seat].length ? Math.max(...hitDamage[seat]) : 0, mean: o.hits[seat] ? o.damageDealt[seat] / o.hits[seat] : 0 });
  const zeroStat = (): HitStat => ({ count: 0, total: 0, max: 0, mean: 0 });
  return {
    durationS,
    dryStreak: [streakOf(hitTimes[0], durationS), streakOf(hitTimes[1], durationS)],
    mutualDryS: quiet.totalS,
    quietS: quiet.totalS,
    quietMaxS: quiet.maxS,
    distance: { mean: meanOf(sortedD), median: q(sortedD, 0.5), min: sortedD[0] ?? 0, max: sortedD[sortedD.length - 1] ?? 0, p10: q(sortedD, 0.1), p90: q(sortedD, 0.9) },
    bands,
    engagement: { closingS, contactS: bands.contact, standoffMaxS },
    // The headless sim has no vertical motion, no items, no blocking trace and no leveling in one
    // bout (MatchSim's documented simplifications), so these stay zero rather than invented.
    jumps: [zeroStat(), zeroStat()],
    damageDealt: [stat(0), stat(1)],
    damageTaken: [stat(1), stat(0)],
    damageAbsorbed: [zeroStat(), zeroStat()],
    damageByWeapon: {},
    objects: { taken: 0, destroyed: 0, attacked: 0, defended: 0 },
    evolution: [],
  };
}

function conditionsFor(p: BranchPlan, m: [string, string]): MatchConditions {
  const seed = p.seed >>> 0;
  const rng = randomSource((seed ^ 0x51ed270b) >>> 0);
  const i = (n: number) => Math.min(n - 1, Math.floor(rng() * n));
  const cls = (c: string) => Math.max(0, CLASSES.indexOf(c as ClassName));
  const cat: Categorical = {
    ancestry: [i(ANCESTRIES.length), i(ANCESTRIES.length)],
    cls: [cls(m[0]), cls(m[1])],
    weapon: [i(WEAPONS.length), i(WEAPONS.length)],
    ground: i(4),
    shape: i(8),
  };
  const wall = p.arena.walls >= 1 ? "full" : "none";
  const built = buildLaneJTArena(structuredClone(p.arena), wall, p.arena.wallHeight, seed);
  const fighters = [fighterSpecOf(MID_KNOBS, cat, 0, seed), fighterSpecOf(MID_KNOBS, cat, 1, seed)];
  return {
    version: 1, seed, codeHash: "branchtree-test", simulator: "headless",
    arena: p.arena, walls: built.walls, symmetry: built.symmetry, digest: built.digest,
    fighters: [fighters[0], fighters[1]], timeScale: 1, design: `branch:${p.victory}`,
  };
}

function traceRunner(p: BranchPlan): MatchRecord & { telemetry?: FightTelemetry } {
  const m = p.matchups[0] ?? MATCHUPS[0];
  const cond = conditionsFor(p, m);
  const v = victoryOf(p.victory);
  const rules: MatchRules = { ...WAVE_J_RULES, timeLimit: v.timeLimit };
  const events: SimEvent[] = [];
  const outcome = simulateMatch(cond, { rules, timeLimit: v.limitS, trace: (e) => events.push(e) });
  return { conditions: cond, outcome, telemetry: telemetryFromEvents(outcome, events) };
}

// ─── tests ───────────────────────────────────────────────────────────────────────────────────────

Deno.test("branchPlan is reproducible from its seed and honest about its shape", () => {
  const a = branchPlan({ seed: 12345 });
  const b = branchPlan({ seed: 12345 });
  eq(JSON.stringify(a), JSON.stringify(b), "same seed must yield identical plans");
  const c = branchPlan({ seed: 12346 });
  ok(JSON.stringify(a) !== JSON.stringify(c), "a different seed should yield different plans");
  ok(a.length > 0, "plans expected");
  for (const p of a) {
    ok(ARENA_SIZES.includes(p.arena.size), `arena size drawn from the ladder, got ${p.arena.size}`);
    ok(VICTORIES.some((v) => v.id === p.victory), `known victory id, got ${p.victory}`);
    ok(p.matchups.length <= MATCHUPS.length, "match-up list within the table");
    ok(p.matchups.every((m) => m.length === 2), "each match-up is a pair");
  }
  // Open-arena victories (ring-out) drop the perimeter; walled victories may keep or drop it.
  for (const p of a) {
    const v = victoryOf(p.victory);
    if (v.openArena) eq(p.arena.walls >= 1, false, `an open-arena victory must drop the perimeter for ${p.victory}`);
  }
});

Deno.test("branchPlan respects the branch cap", () => {
  const plans = branchPlan({ seed: 3, arenas: 4, victories: 4, maxBranches: 8 });
  const total = plans.reduce((n, p) => n + p.matchups.length, 0);
  ok(total <= 8, `branch cap honoured, got ${total}`);
  ok(plans.length === 16, `one plan per (arena x victory), got ${plans.length}`);
});

Deno.test("buildBranchTree is bounded by node count and by depth, and counts the pruned", () => {
  const plans = branchPlan({ seed: 7, arenas: 3, victories: 3, maxBranches: 4096 });
  // Node bound.
  const capped = buildBranchTree(plans, traceRunner, 12);
  ok(capped.nodes.length === 12, `node cap must stop the tree at 12, got ${capped.nodes.length}`);
  ok(capped.pruned.byNodes > 0, "branches past the node cap must be counted as pruned");
  // Depth bound.
  const shallow = buildBranchTree(plans, traceRunner, 100000, 1);
  ok(shallow.nodes.every((n) => n.depth <= 1), "no node deeper than the depth cap");
  ok(shallow.pruned.byDepth > 0, "the branches a node at the depth cap would spawn must be counted");
  ok(shallow.pruned.byNodes === 0, "no node pruning when the cap is generous");
  // Depth histogram sums to the node count.
  const full = buildBranchTree(plans, traceRunner, 100000, 3);
  const sum = Object.values(summariseTree(full).depthHistogram).reduce((a, b) => a + b, 0);
  eq(sum, full.nodes.length, "depth histogram must sum to the node count");
});

Deno.test("the tree is reproducible: same plans + runner -> same ids and outcomes", () => {
  const plans = branchPlan({ seed: 99, arenas: 2, victories: 2, maxBranches: 4096 });
  const t1 = buildBranchTree(plans, traceRunner, 500);
  const t2 = buildBranchTree(plans, traceRunner, 500);
  eq(
    JSON.stringify(t1.nodes.map((n) => [n.id, n.depth, n.outcome])),
    JSON.stringify(t2.nodes.map((n) => [n.id, n.depth, n.outcome])),
    "the tree must be reproducible from its seed",
  );
});

Deno.test("shared branches are replayed once (memoised): runs < nodes", () => {
  const plans = branchPlan({ seed: 5, arenas: 3, victories: 3, maxBranches: 4096 });
  const tree = buildBranchTree(plans, traceRunner, 100000, 3);
  ok(tree.runs < tree.nodes.length, `shared branches must be memoised, runs ${tree.runs} vs nodes ${tree.nodes.length}`);
  ok(tree.nodes.every((n) => n.telemetry.durationS >= 0), "every node carries telemetry");
});

Deno.test("the tree composes with runBatch, the existing batch back end", () => {
  const recs = runBatch({ matches: 1, seed: 4242, design: "corner", provider: buildLaneJTArena, rules: WAVE_J_RULES, codeHash: "branchtree-test" });
  const tree: BranchTree = buildBranchTree(branchPlan({ seed: 5, arenas: 2, victories: 2 }), () => recs[0], 50);
  ok(tree.nodes.length > 1, "a runBatch-backed runner still builds a tree");
  ok(tree.nodes.every((n) => n.telemetry.durationS === recs[0].outcome.duration), "fallback telemetry reads the record");
});

Deno.test("telemetryFromRecord falls back to the record's own numbers, never fabricated", () => {
  const rec = runBatch({ matches: 1, seed: 1, design: "corner", provider: buildLaneJTArena, rules: WAVE_J_RULES, codeHash: "x" })[0];
  const tel = telemetryFromRecord(rec);
  eq(tel.distance.mean, 0, "no positions in a bare record -> zero distance, not an invented number");
  eq(tel.damageDealt[0].total, rec.outcome.damageDealt[0], "damage is the record's own");
  eq(tel.durationS, rec.outcome.duration, "duration is the record's own");
});

Deno.test("summariseTree prints the branches: per-depth win rates, bands, stall and damage", () => {
  const plans = branchPlan({ seed: 20261031, arenas: 32, victories: 4, maxBranches: 4096 });
  const t0 = performance.now();
  const tree = buildBranchTree(plans, traceRunner, 4096, 4);
  const wallS = (performance.now() - t0) / 1000;
  const s = summariseTree(tree);

  // EVERY number below is printed, not asserted in prose.
  console.log(`\n=== one real branch tree (seed 20261031) ===`);
  console.log(`wall-clock to build: ${wallS.toFixed(2)} s for ${tree.runs} replayed branches (memoised) -> ${tree.nodes.length} nodes`);
  console.log(`nodes ${s.nodes} · arenas ${s.arenas} · victories ${s.victories} · matchups ${s.matchups} · maxNodes ${s.maxNodes} · maxDepth ${s.maxDepth} · runs ${s.runs}`);
  console.log(`pruned: byNodes ${s.pruned.byNodes} · byDepth ${s.pruned.byDepth}`);
  console.log(`depth histogram: ${JSON.stringify(s.depthHistogram)}`);
  console.log(`per depth (d | branches | winA | draws | meanDur s | dist m | contact/striking/circling/apart s | stall s | dryA s | dmg HP):`);
  for (const d of s.perDepth) {
    console.log(
      `  d${d.depth} | ${d.branches} | ${d.winRateA.toFixed(3)} | ${d.draws} | ${d.meanDurationS.toFixed(2)} | ${d.meanDistanceM.toFixed(2)} | ` +
        `${d.bands.contact.toFixed(2)}/${d.bands.striking.toFixed(2)}/${d.bands.circling.toFixed(2)}/${d.bands.apart.toFixed(2)} | ` +
        `${d.stallMeanS.toFixed(2)} | ${d.dryMaxMeanS.toFixed(2)} | ${d.damageMean.toFixed(0)}`,
    );
  }

  ok(s.nodes === tree.nodes.length, "summary node count matches the tree");
  ok(s.nodes > 1000, `the user asked for thousands of branches; printed ${s.nodes}`);
  ok(s.pruned.byNodes === 0 && s.pruned.byDepth === 0, "a tree inside both caps drops nothing");
  ok(s.perDepth.every((d) => d.winRateA >= 0 && d.winRateA <= 1), "win rates are shares");
  ok(s.perDepth.some((d) => d.meanDistanceM > 0), "the distances are real (a runner with the trace)");
  ok(s.perDepth.some((d) => d.stallMeanS >= 0), "the stall metric is reported");
});

Deno.test("the shape of a node is what the contract asks for", () => {
  const tree = buildBranchTree(branchPlan({ seed: 11, arenas: 1, victories: 1 }), traceRunner, 10);
  const root = tree.nodes[0];
  eq(root.id, "root", "the first node is the initial-arena root");
  eq(root.parent, null, "the root has no parent");
  eq(root.depth, 0, "the root is depth 0");
  eq(root.condition, "-", "the root carries no victory condition");
  eq(root.matchup, "-", "the root carries no match-up");
  const child = tree.nodes.find((n) => n.parent === "root");
  ok(child !== undefined, "the root has children");
  ok(typeof child!.venue === "string" && child!.venue.length > 0, "a node names its venue");
  ok(VICTORIES.some((v) => v.id === child!.condition), "a node names a victory condition");
  ok(child!.matchup.includes(" vs "), "a node names its match-up");
  ok(/^[AB]·|^draw·/.test(child!.outcome), `a node names its outcome, got ${child!.outcome}`);
  void outcomeLabel;
  void venueLabel;
});
