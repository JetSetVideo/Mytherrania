import { trainNeuralPolicy } from "../src/balance/NeuralTrainer.ts";

const seed = parseInt(Deno.args[0] || "1");
const generations = parseInt(Deno.args[1] || "10");
const population = parseInt(Deno.args[2] || "16");
const duels = parseInt(Deno.args[3] || "60");

const result = trainNeuralPolicy({ seed, population, generations, duelsPerOpponent: duels, mutationRate: 0.2 });
await Deno.mkdir("artifacts", { recursive: true });
await Deno.writeTextFile("artifacts/neural.json", JSON.stringify({
  ...result, policy: undefined,
  history: result.history,
  weights: [...result.policy.weights()],
}, null, 2) + "\n");

console.log(`Neural policy trained: ${result.totalDuels.toLocaleString()} duels over ${generations} generations`);
console.log(`Best win rate vs tree-driven opponents: ${(result.bestWinRate * 100).toFixed(1)}%`);
console.log(`First/last: ${(result.history[0].bestWinRate * 100).toFixed(1)}% -> ${(result.history.at(-1)!.bestWinRate * 100).toFixed(1)}%`);
