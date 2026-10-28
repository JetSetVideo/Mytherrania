// Instant-battle corpus tool: run N headless fights across the sampled parameter
// space (class, race, arena size, win condition) and write the records plus a
// digest to artifacts/battle-corpus.json. No rendering — these are the "instant
// battles" the models train on.
//
//   deno run -A tools/battle-corpus.ts [fights] [seed] [exploreBias]

import { runCorpus, fighterTag } from "../src/balance/BattleCorpus.ts";
import { fold } from "../src/game/AiStats.ts";
import { aggregateRuns, drainPlan, type TrainingPlan } from "../src/game/TrainingRuns.ts";

const fights = Math.max(1, parseInt(Deno.args[0] ?? "200", 10) || 200);
const seed = parseInt(Deno.args[1] ?? "1", 10) || 1;
const explore = Math.min(1, Math.max(0, parseFloat(Deno.args[2] ?? "0.5") || 0));

// Automatic training: the planner expands the full class x race x round matrix and hands
// it over in batches, so a long run is driven from one plan rather than ad-hoc sampling.
// Each batch carries its own derived seed, so the same plan seed replays identically.
const plan: TrainingPlan = {
  rounds: 1, seed, classes: [], races: [],
  speedId: "normal", lengthId: "standard",
  arenaSizeMin: 12, arenaSizeMax: 60,
};
const batches = drainPlan(plan, Math.max(1, Math.ceil(fights / 8)));
const recs = [];
for (const batch of batches) {
  const n = Math.min(batch.length, fights - recs.length);
  if (n <= 0) break;
  recs.push(...runCorpus({ seed: batch[0].seed, fights: n, exploreBias: explore }));
}

// Per-class roll-up from the shared aggregator (the same one the training UI uses).
const training = aggregateRuns(recs.map((r) => ({
  winnerClass: r.winner === 0 ? r.axis.classA : r.axis.classB,
  loserClass: r.winner === 0 ? r.axis.classB : r.axis.classA,
  durationS: r.duration,
  // The corpus record carries no damage figure, so this is 0 and avgDamage below is NOT
  // meaningful. Win rates, end reasons and duration are.
  damage: 0,
  endReason: r.reason,
})));

// Digest: how each ending reason splits, win rates by class, the parameter spread.
const reasons: Record<string, number> = {};
const classWins = new Map<string, { w: number; g: number }>();
const durations: number[] = [];
for (const r of recs) {
  reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  durations.push(r.duration);
  for (const [cls, won] of [[r.axis.classA, r.winner === 0], [r.axis.classB, r.winner === 1]] as const) {
    const c = classWins.get(cls) ?? { w: 0, g: 0 };
    c.g++;
    if (won) c.w++;
    classWins.set(cls, c);
  }
}
const byClass = [...classWins.entries()]
  .map(([cls, c]) => ({ cls, games: c.g, winRate: +(c.w / c.g).toFixed(3) }))
  .sort((a, b) => b.games - a.games);

const out = {
  meta: { fights, seed, exploreBias: explore, at: new Date().toISOString() },
  digest: {
    reasons,
    duration: fold(durations),
    byClass,
    koShare: +((reasons.ko ?? 0) / fights).toFixed(3),
    training: {
      batches: batches.length,
      matches: training.matches,
      avgDurationS: +training.avgDurationS.toFixed(1),
      endReasons: training.endReasons,
      winRateByClass: Object.fromEntries(
        Object.entries(training.winRateByClass).map(([k, v]) => [k, +Number(v).toFixed(3)]),
      ),
    },
  },
  // A sample of full records (the first 40) so the file stays reviewable.
  sample: recs.slice(0, 40).map((r) => ({
    matchup: `${fighterTag(r.axis, 0, seed)} vs ${fighterTag(r.axis, 1, seed)}`,
    classes: [r.axis.classA, r.axis.classB],
    arenaSize: Math.round(r.axis.arenaSize),
    winCondition: r.axis.winCondition.kind,
    winner: r.winner,
    reason: r.reason,
    duration: +r.duration.toFixed(1),
    exchanges: r.exchanges,
    coords: r.coords.map((c) => +c.toFixed(3)),
  })),
};

await Deno.mkdir("artifacts", { recursive: true });
await Deno.writeTextFile("artifacts/battle-corpus.json", JSON.stringify(out, null, 2));

console.log(`fought ${fights} instant battles (seed ${seed}, explore ${explore})`);
console.log(`endings: ${Object.entries(reasons).map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`KO share ${(out.digest.koShare * 100).toFixed(0)}%  |  duration median ${out.digest.duration.median.toFixed(1)}s  |  classes ${byClass.length}`);
console.log(`wrote artifacts/battle-corpus.json`);
