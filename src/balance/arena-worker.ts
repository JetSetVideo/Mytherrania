import { createStats, type ClassName } from "../game/Stats.ts";
import { attackDamage } from "../game/Stats.ts";
import type { CombatStats } from "../game/Stats.ts";

function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simulate(a: CombatStats, b: CombatStats, rand: () => number): number {
  let aHp = a.maxHealth, bHp = b.maxHealth;
  let aTime = a.attackInterval, bTime = b.attackInterval;
  for (let t = 0; t < 600; t++) {
    const aGo = aTime <= bTime + 0.0005;
    const bGo = bTime <= aTime + 0.0005;
    if (aGo) aTime += a.attackInterval;
    if (bGo) bTime += b.attackInterval;
    let aDead = false, bDead = false;
    if (aGo) { bHp -= attackDamage(a, b, rand(), rand()); if (bHp <= 0) bDead = true; }
    if (bGo) { aHp -= attackDamage(b, a, rand(), rand()); if (aHp <= 0) aDead = true; }
    if (aDead && bDead) return 0.5;
    if (bDead) return 1;
    if (aDead) return 0;
  }
  return aHp > bHp ? 1 : aHp < bHp ? 0 : 0.5;
}

self.onmessage = (event: MessageEvent<{ a: ClassName; b: ClassName; seed: number; fights: number; index: number }>) => {
  const { a, b, seed, fights, index } = event.data;
  const sa = createStats(a);
  const sb = createStats(b);
  const r = randomSource(seed);
  let wins = 0, draws = 0;
  for (let f = 0; f < fights; f++) {
    const outcome = simulate(sa, sb, r);
    if (outcome === 0.5) draws++;
    else wins += outcome;
  }
  self.postMessage({ index, wins, draws, trials: fights });
};