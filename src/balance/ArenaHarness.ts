import { attackDamage, CLASSES, createStats, type ClassName, type CombatStats } from "../game/Stats.ts";
import { applyRaceBonus } from "../game/Races.ts";
import { applySecondary } from "../game/SecondaryStats.ts";
import { bodyFromStats, physicsMultiplier } from "../game/Physics.ts";

/** Closing speed (m/s) the harness assumes for every blow; see simulate(). */
export const HARNESS_CLOSING_SPEED = 1;

export function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function wilsonInterval(wins: number, trials: number): [number, number] {
  if (trials === 0) return [NaN, NaN];
  const p = wins / trials;
  const z = 1.96;
  const denom = 1 + z * z / trials;
  const centre = (p + z * z / (2 * trials)) / denom;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * trials)) / trials) / denom;
  let low = centre - margin;
  let high = centre + margin;
  if (wins === 0) low = 0;
  if (wins === trials) high = 1;
  return [Math.max(0, low), Math.min(1, high)];
}

// Each fighter draws from its OWN stream. A single shared stream makes the
// fighter that draws first win the coin-flip systematically, which shows up as
// false "imbalance" between classes whose stats are actually identical.
function simulate(a: CombatStats, b: CombatStats, randA: () => number, randB: () => number): number {
  let aHp = a.maxHealth, bHp = b.maxHealth;
  let aTime = a.attackInterval, bTime = b.attackInterval;
  // The live game multiplies every blow by the two bodies' physics (mass and density
  // ratios) at the measured closing speed. The harness uses one representative
  // closing speed for every blow: HARNESS_CLOSING_SPEED, set from the MEDIAN of the
  // closing speeds recorded on real hits by tools/probe-match.ts (data-science Pass 19).
  const physA = physicsMultiplier(bodyFromStats(a), bodyFromStats(b), HARNESS_CLOSING_SPEED);
  const physB = physicsMultiplier(bodyFromStats(b), bodyFromStats(a), HARNESS_CLOSING_SPEED);
  for (let t = 0; t < 600; t++) {
    const aGo = aTime <= bTime + 0.0005;
    const bGo = bTime <= aTime + 0.0005;
    if (aGo) aTime += a.attackInterval;
    if (bGo) bTime += b.attackInterval;
    let aDead = false, bDead = false;
    if (aGo) { bHp -= attackDamage(a, b, randA(), randA()) * physA; if (bHp <= 0) bDead = true; }
    if (bGo) { aHp -= attackDamage(b, a, randB(), randB()) * physB; if (aHp <= 0) aDead = true; }
    if (aDead && bDead) return 0.5;
    if (bDead) return 1;
    if (aDead) return 0;
  }
  // Death is the only ending, here as in the live game. The worst pair needs ~152
  // exchanges at minimum damage and no crit, so 600 is never reached; if a future
  // tuning change made it reachable, fail loudly instead of deciding by HP.
  throw new Error(`arena fight exceeded 600 exchanges without a death (hp ${aHp.toFixed(0)} vs ${bHp.toFixed(0)})`);
}

export interface ArenaResult {
  seed: number; fightsPerPair: number;
  pairResults: { a: ClassName; b: ClassName; wins: number; trials: number; p: number; ci95: [number, number]; draws: number }[];
  balanced: number; total: number;
}

export function runArena(
  seed: number,
  fightsPerPair: number,
  raceId?: string,
  /** Optional per-class override applied ON TOP of the race-modified stats, so a
   *  tuner and the default arena path measure the same thing. */
  transform?: (c: ClassName, base: CombatStats) => CombatStats,
): ArenaResult {
  const raceMod = (cn: ClassName): CombatStats => {
    // Secondary stats are ancestry-driven and apply to every class identically, so the
    // harness prices in a representative sub-species/birthsign pair to stay on the same
    // game the live build runs (which applies them from each fighter's profile).
    const base = applySecondary(applyRaceBonus(createStats(cn), raceId ?? "human", null), "imperial", "mountain");
    return transform ? transform(cn, base) : base;
  };
  const pairs: [ClassName, ClassName][] = [];
  for (let i = 0; i < CLASSES.length; i++)
    for (let j = i + 1; j < CLASSES.length; j++)
      pairs.push([CLASSES[i], CLASSES[j]]);

  const pairResults: ArenaResult["pairResults"] = [];
  let balanced = 0;

  for (let p = 0; p < pairs.length; p++) {
    const [a1, b1] = pairs[p];
    let wins = 0, draws = 0;
    const rA = randomSource((seed ^ (p * 0x9e3779b9)) >>> 0);
    const rB = randomSource((seed ^ ((p + 1) * 0x85ebca6b)) >>> 0);
    for (let f = 0; f < fightsPerPair; f++) {
      const outcome = simulate(raceMod(a1), raceMod(b1), rA, rB);
      if (outcome === 0.5) draws++;
      else wins += outcome;
    }
    const decisive = fightsPerPair - draws;
    const pct = decisive > 0 ? wins / decisive : 0.5;
    const ci95 = wilsonInterval(Math.round(wins), decisive);
    if (pct >= 0.48 && pct <= 0.52) balanced++;
    pairResults.push({ a: a1, b: b1, wins, trials: decisive, p: Math.round(pct * 1000) / 1000, ci95, draws });
  }

  return { seed, fightsPerPair, pairResults, balanced, total: pairs.length };
}