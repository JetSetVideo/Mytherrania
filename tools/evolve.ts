import { evolve } from "../src/balance/EvolutionHarness.ts";

const seed = parseInt(Deno.args[0] || "42");
const generations = parseInt(Deno.args[1] || "20");
const population = parseInt(Deno.args[2] || "24");
const duels = parseInt(Deno.args[3] || "300");

const result = evolve({ seed, population, generations, duelsPerOpponent: duels, mutationRate: 0.25, keep: 4 });
await Deno.mkdir("artifacts", { recursive: true });
await Deno.writeTextFile("artifacts/evolution.json", JSON.stringify({
  ...result,
  population: result.population.slice(0, 8).map((g) => ({
    stats: g.stats, weapon: { name: g.weapon.name, type: g.weapon.type, weight: g.weapon.weight, balance: g.weapon.balance, sharpness: g.weapon.sharpness, damage: g.weapon.damage, cooldown: g.weapon.cooldown, reach: g.weapon.reach },
  })),
}, null, 2) + "\n");

console.log(`Evolution complete: ${result.totalDuels.toLocaleString()} duels over ${generations} generations`);
console.log(`Best balance deviation: ${(result.bestDeviation * 100).toFixed(2)}% from 50%`);
console.log(`First/last generation: ${(result.history[0].bestDeviation * 100).toFixed(2)}% -> ${(result.history.at(-1)!.bestDeviation * 100).toFixed(2)}%`);
for (const g of result.population.slice(0, 8)) {
  console.log(`  ${g.weapon.type.padEnd(6)} dmg=${g.weapon.damage} cd=${g.weapon.cooldown.toFixed(2)} reach=${g.weapon.reach.toFixed(2)} HP=${g.stats.maxHealth} arm=${g.stats.armor}`);
}
if (result.history.at(-1)!.bestDeviation > result.history[0].bestDeviation) Deno.exitCode = 1;
