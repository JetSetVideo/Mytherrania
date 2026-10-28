// Deeper network configuration, threshold activation and the pass-a-threshold
// rule for combat decisions. Pure data + pure math: no DOM, no Three.js.
//
// A "net arch" is a fully-connected perceptron described by `layers`, where
// layers[0] is the input width and every following entry is a hidden/output
// width. Weights are a single flat array: for each adjacent pair
// (in -> out) the block is laid out row-major as `out` rows of
// (in weights + 1 bias), so one layer costs (in + 1) * out numbers.

export type ActivationKind = "tanh" | "relu" | "sigmoid" | "leaky";

export interface NetArch {
  id: "shallow" | "standard" | "deep" | "wide";
  label: string;
  /** Unit counts, input first: [in, hidden..., out]. */
  layers: number[];
  activation: ActivationKind;
}

// Network shapes the balance engine can select between. `layers[0]` is always
// the 6 combat features from NeuralPolicy; the tail is the action-logit width.
export const NET_ARCHS: NetArch[] = [
  { id: "shallow", label: "Shallow 6-8-5", layers: [6, 8, 5], activation: "tanh" },
  { id: "standard", label: "Standard 6-12-8-5", layers: [6, 12, 8, 5], activation: "relu" },
  { id: "deep", label: "Deep 6-16-16-12-5", layers: [6, 16, 16, 12, 5], activation: "leaky" },
  { id: "wide", label: "Wide 6-32-5", layers: [6, 32, 5], activation: "sigmoid" },
];

export type Comparator = "gt" | "lt" | "gte" | "lte";

export interface ThresholdRule {
  id: string;
  label: string;
  /** Key into the metrics record passed to gatedAction. */
  metric: string;
  comparator: Comparator;
  threshold: number;
  /** Action returned when the gate passes. */
  action: string;
}

// Named gates evaluated in order; the first whose condition holds decides the
// action. Data-driven so the engine can reorder / retune without branching.
export const THRESHOLD_RULES: ThresholdRule[] = [
  { id: "confidence-gate", label: "Commit when confident", metric: "confidence", comparator: "gte", threshold: 0.6, action: "attack" },
  { id: "resource-gate", label: "Disengage when low on stamina", metric: "resourceRatio", comparator: "lt", threshold: 0.25, action: "retreat" },
  { id: "health-gate", label: "Guard when wounded", metric: "healthRatio", comparator: "lte", threshold: 0.3, action: "block" },
  { id: "momentum-gate", label: "Press an advantage", metric: "momentum", comparator: "gt", threshold: 0.5, action: "advance" },
];

// Comparator table (no if/else chain): each maps (value, threshold) -> boolean.
const COMPARATORS: Record<Comparator, (value: number, threshold: number) => boolean> = {
  gt: (v, t) => v > t,
  lt: (v, t) => v < t,
  gte: (v, t) => v >= t,
  lte: (v, t) => v <= t,
};

// Bounded activations. tanh -> [-1,1], sigmoid -> (0,1), relu -> [0,inf),
// leaky -> finite for any finite input. All are 0 at 0 except sigmoid (0.5).
export function activation(x: number, kind: ActivationKind): number {
  switch (kind) {
    case "tanh":
      return Math.tanh(x);
    case "relu":
      return x > 0 ? x : 0;
    case "sigmoid":
      return 1 / (1 + Math.exp(-x));
    case "leaky":
      return x >= 0 ? x : 0.01 * x;
  }
}

// Number of weights a flat array needs for these layers: sum of (in + 1) * out
// over every adjacent pair, the +1 being one bias per output unit.
export function weightCount(layers: number[]): number {
  let total = 0;
  for (let l = 0; l < layers.length - 1; l++) total += (layers[l] + 1) * layers[l + 1];
  return total;
}

// Real forward pass over the layer sizes. Hidden layers apply the arch's
// activation; the final layer is left linear (logits). Throws if the weight
// count or the input width does not match the architecture.
export function forward(arch: NetArch, weights: number[], input: number[]): number[] {
  const layers = arch.layers;
  const expected = weightCount(layers);
  if (weights.length !== expected) {
    throw new Error(`forward: arch "${arch.id}" needs ${expected} weights, got ${weights.length}`);
  }
  if (input.length !== layers[0]) {
    throw new Error(`forward: arch "${arch.id}" needs ${layers[0]} inputs, got ${input.length}`);
  }
  let act = input.slice();
  let base = 0;
  for (let l = 0; l < layers.length - 1; l++) {
    const inSize = layers[l];
    const outSize = layers[l + 1];
    const isOutput = l === layers.length - 2;
    const next = new Array<number>(outSize);
    for (let j = 0; j < outSize; j++) {
      const row = base + j * (inSize + 1);
      let sum = weights[row + inSize]; // bias
      for (let i = 0; i < inSize; i++) sum += weights[row + i] * act[i];
      next[j] = isOutput ? sum : activation(sum, arch.activation);
    }
    act = next;
    base += (inSize + 1) * outSize;
  }
  return act;
}

// Evaluate a single gate against a metric value.
export function passesThreshold(rule: ThresholdRule, value: number): boolean {
  return COMPARATORS[rule.comparator](value, rule.threshold);
}

// First rule whose gate passes wins; otherwise the fallback. Table-driven.
export function gatedAction(
  rules: ThresholdRule[],
  metrics: Record<string, number>,
  fallback: string,
): string {
  for (const rule of rules) {
    if (passesThreshold(rule, metrics[rule.metric])) return rule.action;
  }
  return fallback;
}
