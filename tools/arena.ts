import { runArena } from "../src/balance/ArenaHarness.ts";
import { RACES } from "../src/game/Races.ts";

const seed = parseInt(Deno.args[0] || "20261009");
const fights = parseInt(Deno.args[1] || "10000");
const raceArg = Deno.args[2]; // optional race id

if (raceArg === "all") {
  // Run arena for every race and summarize
  await Deno.mkdir("artifacts", { recursive: true });
  const results: Record<string, { balanced: number; total: number; pct: number }> = {};
  for (const race of RACES) {
    const result = runArena(seed, fights, race.id);
    const pct = result.total ? Math.round(result.balanced / result.total * 100) : 0;
    results[race.name] = { balanced: result.balanced, total: result.total, pct };
    console.log(`${race.name}: ${result.balanced}/${result.total} balanced (${pct}%)`);
  }
  await Deno.writeTextFile("artifacts/arena-races.json", JSON.stringify(results, null, 2) + "\n");
  const allOk = Object.values(results).every(r => r.balanced === r.total);
  if (!allOk) Deno.exitCode = 1;
} else {
  const result = runArena(seed, fights, raceArg);
  await Deno.mkdir("artifacts", { recursive: true });
  await Deno.writeTextFile("artifacts/arena.json", JSON.stringify(result, null, 2) + "\n");
  const pct = result.total ? Math.round(result.balanced / result.total * 100) : 0;
  console.log(`${result.balanced}/${result.total} unordered pairs balanced (${pct}%)`);
  if (raceArg) console.log(`(race: ${raceArg})`);
  for (const pr of result.pairResults) {
    console.log(`  ${pr.a} vs ${pr.b}: p=${pr.p} ci95=[${pr.ci95[0].toFixed(3)},${pr.ci95[1].toFixed(3)}]`);
  }
  if (result.balanced < result.total) Deno.exitCode = 1;
}