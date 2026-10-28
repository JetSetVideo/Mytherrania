import type { Decision } from "../game/DecisionTree.ts";

// A small feed-forward network (6 inputs -> 8 hidden -> 5 action logits) that
// acts as the combat decision function. Trained from combat data by evolving
// its weights, so it generalises where the hand-written decision tree is rigid.
export const FEATURES = 6;
export const HIDDEN = 8;
export const ACTIONS: Decision[] = ["attack", "advance", "retreat", "block", "wait"];

export interface CombatFeatures {
  distance: number;
  selfReach: number;
  enemyReach: number;
  selfHpRatio: number;
  enemyHpRatio: number;
  nearEdge: boolean;
  ready: boolean;
}

export function toFeatures(v: CombatFeatures): number[] {
  return [
    v.distance / 10,
    (v.selfReach - v.enemyReach) / 3, // reach advantage, signed
    v.selfHpRatio,
    v.enemyHpRatio,
    v.ready ? 1 : 0,
    v.nearEdge ? 1 : 0,
  ];
}

export class NeuralPolicy {
  #w1: Float64Array; #b1: Float64Array; // 6->8
  #w2: Float64Array; #b2: Float64Array; // 8->5

  constructor(w1: Float64Array, b1: Float64Array, w2: Float64Array, b2: Float64Array) {
    this.#w1 = w1; this.#b1 = b1; this.#w2 = w2; this.#b2 = b2;
  }

  static random(rng: () => number): NeuralPolicy {
    const w1 = new Float64Array(FEATURES * HIDDEN);
    const b1 = new Float64Array(HIDDEN);
    const w2 = new Float64Array(HIDDEN * ACTIONS.length);
    const b2 = new Float64Array(ACTIONS.length);
    for (let i = 0; i < w1.length; i++) w1[i] = (rng() - 0.5) * 2;
    for (let i = 0; i < w2.length; i++) w2[i] = (rng() - 0.5) * 2;
    return new NeuralPolicy(w1, b1, w2, b2);
  }

  forward(f: number[]): number[] {
    const h = new Float64Array(HIDDEN);
    for (let j = 0; j < HIDDEN; j++) {
      let sum = this.#b1[j];
      for (let i = 0; i < FEATURES; i++) sum += this.#w1[i * HIDDEN + j] * f[i];
      h[j] = Math.tanh(sum);
    }
    const out = new Float64Array(ACTIONS.length);
    for (let k = 0; k < ACTIONS.length; k++) {
      let sum = this.#b2[k];
      for (let j = 0; j < HIDDEN; j++) sum += this.#w2[j * ACTIONS.length + k] * h[j];
      out[k] = sum;
    }
    return [...out];
  }

  decide(f: number[]): Decision {
    const out = this.forward(f);
    let best = 0;
    for (let k = 1; k < out.length; k++) if (out[k] > out[best]) best = k;
    return ACTIONS[best];
  }

  // Mutate weights with gaussian-ish noise (scaled by rate).
  mutate(rng: () => number, rate = 0.15): NeuralPolicy {
    const jitter = (v: number) => rng() < rate ? v + (rng() - 0.5) * 0.8 : v;
    return new NeuralPolicy(
      this.#w1.map(jitter), this.#b1.map(jitter),
      this.#w2.map(jitter), this.#b2.map(jitter),
    );
  }

  weights(): Float64Array { return this.#w1; }
}
