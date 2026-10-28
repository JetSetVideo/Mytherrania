import { NeuralPolicy, toFeatures } from "./NeuralPolicy.ts";
import { decide, type CombatView } from "../game/DecisionTree.ts";
import { randomGenome, randomSource, type Genome } from "./EvolutionHarness.ts";

// Duel where `self` acts from a neural policy and `opp` acts from its decision
// tree. Returns 1 (self wins), 0 (opp wins), 0.5 (draw).
function duelNN(self: Genome, policy: NeuralPolicy, opp: Genome, _rng: () => number): number {
  const s = self.stats, o = opp.stats;
  let sHp = s.maxHealth, oHp = o.maxHealth;
  let dist = 3;
  let sCd = 0, oCd = 0, sBlock = 0, oBlock = 0;

  for (let t = 0; t < 400; t++) {
    sCd = Math.max(0, sCd - 1);
    oCd = Math.max(0, oCd - 1);
    sBlock = Math.max(0, sBlock - 1);
    oBlock = Math.max(0, oBlock - 1);

    const selfAct = policy.decide(toFeatures({
      distance: dist, selfReach: self.weapon.reach, enemyReach: opp.weapon.reach,
      selfHpRatio: sHp / s.maxHealth, enemyHpRatio: oHp / o.maxHealth,
      nearEdge: false, ready: sCd <= 0,
    }));
    const oppView: CombatView = {
      distance: dist, selfReach: opp.weapon.reach, enemyReach: self.weapon.reach,
      selfHpRatio: oHp / o.maxHealth, enemyHpRatio: sHp / s.maxHealth,
      nearEdge: false, ready: oCd <= 0, enemyAttacking: 0, selfDamagePercent: 0,
      enemyDamagePercent: 0, roundTime: t / 10,
    };
    const oppAct = decide(opp.tree, oppView);

    // Distance delta per action (data, not a branch chain): advance closes, retreat opens.
    const DIST_DELTA: Record<string, number> = { advance: -1, retreat: 1 };
    const apply = (act: string, isSelf: boolean): void => {
      const [cd, setCd] = isSelf ? [sCd, (v: number) => { sCd = v; }] : [oCd, (v: number) => { oCd = v; }];
      const w = isSelf ? self.weapon : opp.weapon;
      const defBlock = isSelf ? oBlock : sBlock;
      const defArmor = isSelf ? o.armor : s.armor;
      if (act === "attack" && cd <= 0 && dist <= w.reach) {
        const dmg = Math.max(1, w.damage * (defBlock > 0 ? 0.4 : 1) / (1 + defArmor * 0.04));
        if (isSelf) oHp -= dmg; else sHp -= dmg;
        setCd(Math.round(w.cooldown * 10));
        return;
      }
      const dd = DIST_DELTA[act];
      if (dd !== undefined) { dist = Math.max(0.5, dist + dd); return; }
      if (act === "block") { if (isSelf) sBlock = 2; else oBlock = 2; }
    };
    apply(selfAct, true);
    apply(oppAct, false);

    if (oHp <= 0 && sHp <= 0) return 0.5;
    if (oHp <= 0) return 1;
    if (sHp <= 0) return 0;
  }
  return sHp > oHp ? 1 : sHp < oHp ? 0 : 0.5;
}

export interface NeuralTrainOptions {
  seed: number;
  population: number;
  generations: number;
  duelsPerOpponent: number;
  mutationRate: number;
}

export interface NeuralTrainResult {
  options: NeuralTrainOptions;
  totalDuels: number;
  bestWinRate: number;
  history: { generation: number; bestWinRate: number }[];
  policy: NeuralPolicy;
}

// Evolve a neural combat policy against a fixed pool of tree-driven opponents.
// Fitness = win rate; the network learns to out-decide the hand-written tree.
export function trainNeuralPolicy(opts: NeuralTrainOptions): NeuralTrainResult {
  const rng = randomSource(opts.seed);
  const opponents = Array.from({ length: 8 }, () => randomGenome(rng));
  let policies = Array.from({ length: opts.population }, () => NeuralPolicy.random(rng));
  const history: { generation: number; bestWinRate: number }[] = [];
  let bestWinRate = 0;
  let bestPolicy = policies[0];

  for (let gen = 0; gen < opts.generations; gen++) {
    const scored = policies.map((p) => {
      let wins = 0, total = 0;
      for (const opp of opponents) {
        for (let i = 0; i < opts.duelsPerOpponent; i++) {
          wins += duelNN(randomGenome(rng), p, opp, rng);
          total++;
        }
      }
      return { p, winRate: wins / total };
    });
    scored.sort((a, b) => b.winRate - a.winRate);
    bestPolicy = scored[0].p;
    bestWinRate = scored[0].winRate;
    history.push({ generation: gen, bestWinRate });

    const next = [scored[0].p];
    while (next.length < opts.population) {
      next.push(scored[Math.floor(rng() * Math.min(6, scored.length))].p.mutate(rng, opts.mutationRate));
    }
    policies = next;
  }

  const totalDuels = opts.generations * opts.population * opponents.length * opts.duelsPerOpponent;
  return { options: opts, totalDuels, bestWinRate, history, policy: bestPolicy };
}
