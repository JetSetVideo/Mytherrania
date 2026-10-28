import type { CombatStats } from "../game/Stats.ts";
import { buildWeapon, type Weapon, type WeaponType } from "../game/Weapon.ts";
import { decide, defaultTree, mutate, type CombatView, type TreeNode } from "../game/DecisionTree.ts";

export interface Genome {
  stats: CombatStats;
  weapon: Weapon;
  tree: TreeNode;
}

export function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPES: WeaponType[] = ["axe", "sword", "dagger", "staff", "scythe", "bow", "mace"];
const STAT_NAMES = ["vitality", "resilience", "willpower", "reflex", "strength", "intelligence"] as const;

export function randomStats(rng: () => number): CombatStats {
  const primaries = Object.fromEntries(STAT_NAMES.map((n) => [n, 1 + Math.floor(rng() * 9)])) as Record<(typeof STAT_NAMES)[number], number>;
  return {
    ...primaries,
    maxHealth: 30 + Math.floor(rng() * 30),
    attackPower: 6 + Math.floor(rng() * 8),
    attackInterval: 0.7 + Math.floor(rng() * 6) * 0.1,
    armor: 2 + Math.floor(rng() * 6),
  };
}

export function randomWeapon(rng: () => number): Weapon {
  const type = TYPES[Math.floor(rng() * TYPES.length)];
  return buildWeapon(type, 1 + rng() * 9, rng(), rng(), type, "#cccccc");
}

export function randomGenome(rng: () => number): Genome {
  return { stats: randomStats(rng), weapon: randomWeapon(rng), tree: defaultTree() };
}

export function mutateGenome(g: Genome, rng: () => number, rate = 0.25): Genome {
  return {
    stats: mutateStats(g.stats, rng, rate),
    weapon: mutateWeapon(g.weapon, rng, rate),
    tree: mutate(g.tree, rate, rng),
  };
}

function mutateStats(s: CombatStats, rng: () => number, rate: number): CombatStats {
  const out = { ...s } as CombatStats;
  if (rng() < rate) out.maxHealth = clampInt(s.maxHealth + Math.floor((rng() - 0.5) * 12), 20, 80);
  if (rng() < rate) out.attackPower = clampInt(s.attackPower + Math.floor((rng() - 0.5) * 4), 4, 20);
  if (rng() < rate) out.attackInterval = clamp(s.attackInterval + (rng() - 0.5) * 0.3, 0.5, 1.6);
  if (rng() < rate) out.armor = clampInt(s.armor + Math.floor((rng() - 0.5) * 4), 1, 10);
  return out;
}

function mutateWeapon(w: Weapon, rng: () => number, rate: number): Weapon {
  const weight = rng() < rate ? clamp(w.weight + (rng() - 0.5) * 4, 1, 10) : w.weight;
  const balance = rng() < rate ? clamp(w.balance + (rng() - 0.5) * 0.4, 0, 1) : w.balance;
  const sharpness = rng() < rate ? clamp(w.sharpness + (rng() - 0.5) * 0.4, 0, 1) : w.sharpness;
  return buildWeapon(w.type, weight, balance, sharpness, w.name, w.color);
}

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
function clampInt(v: number, lo: number, hi: number): number { return Math.round(clamp(v, lo, hi)); }

// Abstract tick-based duel: both bots are driven by their decision trees over a
// scalar distance. Returns 1 (a wins), 0 (b wins), or 0.5 (draw).
export function duel(a: Genome, b: Genome, _rng: () => number): number {
  const aStats = a.stats, bStats = b.stats;
  let aHp = aStats.maxHealth, bHp = bStats.maxHealth;
  let dist = 3;
  let aCd = 0, bCd = 0, aBlock = 0, bBlock = 0;

  for (let t = 0; t < 400; t++) {
    aCd = Math.max(0, aCd - 1);
    bCd = Math.max(0, bCd - 1);
    aBlock = Math.max(0, aBlock - 1);
    bBlock = Math.max(0, bBlock - 1);

    const aView: CombatView = {
      distance: dist, selfReach: a.weapon.reach, enemyReach: b.weapon.reach,
      selfHpRatio: aHp / aStats.maxHealth, enemyHpRatio: bHp / bStats.maxHealth,
      nearEdge: false, ready: aCd <= 0, enemyAttacking: 0, selfDamagePercent: 0,
      enemyDamagePercent: 0, roundTime: t / 10,
    };
    const bView: CombatView = {
      distance: dist, selfReach: b.weapon.reach, enemyReach: a.weapon.reach,
      selfHpRatio: bHp / bStats.maxHealth, enemyHpRatio: aHp / aStats.maxHealth,
      nearEdge: false, ready: bCd <= 0, enemyAttacking: 0, selfDamagePercent: 0,
      enemyDamagePercent: 0, roundTime: t / 10,
    };

    // Decide once per bot, then resolve. Distance delta is data, not a branch chain.
    const aAct = decide(a.tree, aView);
    const bAct = decide(b.tree, bView);

    const DIST_DELTA: Record<string, number> = { advance: -1, retreat: 1 };
    const apply = (act: string, isA: boolean): void => {
      const [cd, setCd] = isA ? [aCd, (v: number) => { aCd = v; }] : [bCd, (v: number) => { bCd = v; }];
      const w = isA ? a.weapon : b.weapon;
      const defBlock = isA ? bBlock : aBlock;
      const defArmor = isA ? bStats.armor : aStats.armor;
      if (act === "attack" && cd <= 0 && dist <= w.reach) {
        const dmg = Math.max(1, w.damage * (defBlock > 0 ? 0.4 : 1) / (1 + defArmor * 0.04));
        if (isA) bHp -= dmg; else aHp -= dmg;
        setCd(Math.round(w.cooldown * 10));
        return;
      }
      const dd = DIST_DELTA[act];
      if (dd !== undefined) { dist = Math.max(0.5, dist + dd); return; }
      if (act === "block") { if (isA) aBlock = 2; else bBlock = 2; }
    };
    apply(aAct, true);
    apply(bAct, false);

    if (bHp <= 0 && aHp <= 0) return 0.5;
    if (bHp <= 0) return 1;
    if (aHp <= 0) return 0;
  }
  return aHp > bHp ? 1 : aHp < bHp ? 0 : 0.5;
}

// Fitness = mean deviation from 50% win rate against a reference pool. Lower is
// better (0 = perfectly balanced against every opponent).
export function evaluate(g: Genome, pool: Genome[], rng: () => number, duelsPerOpponent: number): number {
  let totalDev = 0;
  for (const opp of pool) {
    let wins = 0;
    for (let i = 0; i < duelsPerOpponent; i++) wins += duel(g, opp, rng);
    totalDev += Math.abs(wins / duelsPerOpponent - 0.5);
  }
  return totalDev / pool.length;
}

export interface EvolutionOptions {
  seed: number;
  population: number;
  generations: number;
  duelsPerOpponent: number;
  mutationRate: number;
  keep: number;
}

export interface EvolutionResult {
  options: EvolutionOptions;
  totalDuels: number;
  bestDeviation: number;
  history: { generation: number; bestDeviation: number }[];
  population: Genome[];
}

export function evolve(opts: EvolutionOptions): EvolutionResult {
  const rng = randomSource(opts.seed);
  let pop = Array.from({ length: opts.population }, () => randomGenome(rng));
  const history: { generation: number; bestDeviation: number }[] = [];
  let bestDeviation = 1;

  for (let gen = 0; gen < opts.generations; gen++) {
    const refs = pop.slice(0, Math.min(8, pop.length));
    const scored = pop.map((g) => ({ g, score: evaluate(g, refs, rng, opts.duelsPerOpponent) }));
    scored.sort((a, b) => a.score - b.score);
    bestDeviation = scored[0].score;
    history.push({ generation: gen, bestDeviation });

    const keep = Math.max(1, Math.min(opts.keep, scored.length));
    const next: Genome[] = scored.slice(0, keep).map((s) => s.g);
    while (next.length < opts.population) {
      const parent = scored[Math.floor(rng() * Math.min(10, scored.length))].g;
      next.push(mutateGenome(parent, rng, opts.mutationRate));
    }
    pop = next;
  }

  const refCount = Math.min(8, opts.population);
  const totalDuels = opts.generations * opts.population * refCount * opts.duelsPerOpponent;
  return { options: opts, totalDuels, bestDeviation, history, population: pop };
}
