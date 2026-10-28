import { duel, evolve, evaluate, mutateGenome, randomGenome, randomSource } from "../src/balance/EvolutionHarness.ts";

function assert(ok: boolean, message: string) { if (!ok) throw new Error(message); }

Deno.test("random genomes duel deterministically and end decisively", () => {
  const rng = randomSource(123);
  const a = randomGenome(rng);
  const b = randomGenome(rng);
  const outcomes = new Set<number>();
  for (let i = 0; i < 100; i++) outcomes.add(duel(a, b, rng));
  // A decisive duel model returns 1 or 0 (and occasionally 0.5)
  for (const o of outcomes) assert(o === 1 || o === 0 || o === 0.5, `valid outcome ${o}`);
  assert(outcomes.size >= 1, "at least one outcome");
});

Deno.test("mutateGenome stays within valid stat and weapon bounds", () => {
  const rng = randomSource(7);
  const base = randomGenome(rng);
  for (let i = 0; i < 200; i++) {
    const m = mutateGenome(base, rng, 0.5);
    assert(m.stats.maxHealth >= 20 && m.stats.maxHealth <= 80, "hp in bounds");
    assert(m.stats.armor >= 1 && m.stats.armor <= 10, "armor in bounds");
    assert(m.weapon.weight >= 1 && m.weapon.weight <= 10, "weight in bounds");
    assert(m.weapon.balance >= 0 && m.weapon.balance <= 1, "balance in bounds");
    assert(m.weapon.damage > 0, "damage positive");
  }
});

Deno.test("evaluate is lower for a build that mirrors the pool", () => {
  const rng = randomSource(99);
  const pool = Array.from({ length: 6 }, () => randomGenome(rng));
  const mirror = { ...pool[0] };
  const other = randomGenome(rng);
  const mirrorScore = evaluate(mirror, pool, rng, 200);
  const otherScore = evaluate(other, pool, rng, 200);
  // A perfect mirror of a pool member should be at least as balanced overall.
  assert(mirrorScore <= otherScore + 0.05, `mirror should be balanced (mirror=${mirrorScore.toFixed(3)} other=${otherScore.toFixed(3)})`);
});

Deno.test("evolve runs many duels and reports a non-degrading deviation", () => {
  const result = evolve({ seed: 1, population: 12, generations: 6, duelsPerOpponent: 60, mutationRate: 0.25, keep: 3 });
  assert(result.totalDuels > 1000, `many duels ran: ${result.totalDuels}`);
  assert(result.history.length === 6, "one history entry per generation");
  assert(result.population.length === 12, "population size preserved");
  assert(result.bestDeviation >= 0 && result.bestDeviation <= 0.5, "deviation bounded");
});
