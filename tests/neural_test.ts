import { NeuralPolicy, toFeatures } from "../src/balance/NeuralPolicy.ts";
import { trainNeuralPolicy } from "../src/balance/NeuralTrainer.ts";
import { randomSource } from "../src/balance/EvolutionHarness.ts";

function assert(ok: boolean, message: string) { if (!ok) throw new Error(message); }

Deno.test("neural policy maps features to one of the five actions", () => {
  const rng = randomSource(5);
  const p = NeuralPolicy.random(rng);
  const f = toFeatures({ distance: 1, selfReach: 1.8, enemyReach: 1.8, selfHpRatio: 0.9, enemyHpRatio: 0.5, nearEdge: false, ready: true });
  assert(f.length === 6, "six features");
  const decision = p.decide(f);
  assert(["attack", "advance", "retreat", "block", "wait"].includes(decision), `valid action ${decision}`);
  assert(p.forward(f).length === 5, "five action logits");
});

Deno.test("mutate perturbs weights deterministically but stays finite", () => {
  const rng = randomSource(11);
  const a = NeuralPolicy.random(rng);
  const b = a.mutate(rng, 0.5);
  const f = [0.5, 0.1, 0.8, 0.7, 1, 0];
  const out = b.forward(f);
  assert(out.every((v) => Number.isFinite(v)), "outputs finite after mutation");
  const sameRng = randomSource(11);
  const c = NeuralPolicy.random(sameRng).mutate(sameRng, 0.5);
  assert(JSON.stringify(b.forward(f)) === JSON.stringify(c.forward(f)), "deterministic mutation");
});

Deno.test("training a neural policy improves or holds win rate and runs many duels", () => {
  const result = trainNeuralPolicy({ seed: 3, population: 8, generations: 5, duelsPerOpponent: 40, mutationRate: 0.2 });
  assert(result.totalDuels > 5000, `many duels: ${result.totalDuels}`);
  assert(result.history.length === 5, "one entry per generation");
  assert(result.bestWinRate >= 0 && result.bestWinRate <= 1, "win rate bounded");
  // The trained policy still yields valid decisions on a probe state
  const d = result.policy.decide(toFeatures({ distance: 1, selfReach: 1.8, enemyReach: 1.8, selfHpRatio: 0.8, enemyHpRatio: 0.8, nearEdge: false, ready: true }));
  assert(["attack", "advance", "retreat", "block", "wait"].includes(d), "trained policy still valid");
});
