import {
  activation,
  forward,
  gatedAction,
  NET_ARCHS,
  passesThreshold,
  THRESHOLD_RULES,
  weightCount,
  type ActivationKind,
  type NetArch,
  type ThresholdRule,
} from "../src/balance/NeuralDepth.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

const KINDS: ActivationKind[] = ["tanh", "relu", "sigmoid", "leaky"];

function archOf(id: NetArch["id"]): NetArch {
  const a = NET_ARCHS.find((n) => n.id === id);
  assert(a, `arch ${id} exists`);
  return a;
}

Deno.test("weightCount matches hand-computed value for a 2-layer net", () => {
  // one layer: 4 in -> 3 out => (4+1)*3 = 15
  assert(weightCount([4, 3]) === 15, `got ${weightCount([4, 3])}`);
  // two weight layers: (2+1)*3 + (3+1)*2 = 9 + 8 = 17
  assert(weightCount([2, 3, 2]) === 17, `got ${weightCount([2, 3, 2])}`);
  // shallow arch: (6+1)*8 + (8+1)*5 = 56 + 45 = 101
  assert(weightCount([6, 8, 5]) === 101, `got ${weightCount([6, 8, 5])}`);
});

Deno.test("forward throws on a wrong weight count", () => {
  const arch = archOf("shallow");
  const good = new Array<number>(weightCount(arch.layers)).fill(0);
  let threw = false;
  try {
    forward(arch, good.slice(0, good.length - 1), new Array<number>(6).fill(0));
  } catch {
    threw = true;
  }
  assert(threw, "short weight array must throw");
  threw = false;
  try {
    forward(arch, [...good, 0], new Array<number>(6).fill(0));
  } catch {
    threw = true;
  }
  assert(threw, "oversized weight array must throw");
});

Deno.test("forward succeeds on the right weight count", () => {
  const arch = archOf("shallow");
  const w = new Array<number>(weightCount(arch.layers)).fill(0.1);
  const out = forward(arch, w, new Array<number>(6).fill(0.5));
  assert(out.length === arch.layers[arch.layers.length - 1], "output width matches last layer");
});

Deno.test("forward output length equals the last layer's width", () => {
  for (const arch of NET_ARCHS) {
    const w = new Array<number>(weightCount(arch.layers)).fill(0.05);
    const input = new Array<number>(arch.layers[0]).fill(0.3);
    const out = forward(arch, w, input);
    assert(out.length === arch.layers[arch.layers.length - 1], `${arch.id} output width`);
  }
});

Deno.test("forward throws when the input width mismatches the input layer", () => {
  const arch = archOf("standard");
  const w = new Array<number>(weightCount(arch.layers)).fill(0);
  let threw = false;
  try {
    forward(arch, w, new Array<number>(arch.layers[0] + 1).fill(0));
  } catch {
    threw = true;
  }
  assert(threw, "wrong input width must throw");
});

Deno.test("every activation is bounded and finite over -50..50", () => {
  for (const kind of KINDS) {
    for (let x = -50; x <= 50; x += 0.5) {
      const y = activation(x, kind);
      assert(Number.isFinite(y), `${kind}(${x}) finite`);
      if (kind === "tanh") assert(y >= -1 && y <= 1, `tanh bounded: ${y}`);
      // Sigmoid saturates to exactly 1.0 in float64 beyond |x| ≈ 37, so the bound is
      // the CLOSED interval. Strictness is checked on modest inputs below, where it
      // is a real property rather than a floating-point artefact.
      if (kind === "sigmoid") assert(y >= 0 && y <= 1, `sigmoid in [0,1]: ${y}`);
      if (kind === "relu") assert(y >= 0, `relu >= 0: ${y}`);
    }
  }
  // On modest inputs sigmoid really is strictly inside (0,1), and monotone.
  let prev = -1;
  for (let x = -8; x <= 8; x += 0.5) {
    const y = activation(x, "sigmoid");
    assert(y > 0 && y < 1, `sigmoid strictly inside on modest input: ${y}`);
    assert(y > prev, "sigmoid is monotone increasing");
    prev = y;
  }
});

Deno.test("activation at zero is 0 for tanh/relu/leaky and 0.5 for sigmoid", () => {
  assert(activation(0, "tanh") === 0, "tanh(0)");
  assert(activation(0, "relu") === 0, "relu(0)");
  assert(activation(0, "leaky") === 0, "leaky(0)");
  assert(activation(0, "sigmoid") === 0.5, "sigmoid(0)");
});

Deno.test("leaky is finite for any finite input and equals x when positive", () => {
  for (const x of [-1e6, -123.4, -0.5, 0.5, 123.4, 1e6]) {
    const y = activation(x, "leaky");
    assert(Number.isFinite(y), `leaky(${x}) finite`);
  }
  assert(activation(3, "leaky") === 3, "positive passthrough");
  assert(activation(-2, "leaky") === -0.02, "negative scaled");
});

Deno.test("relu zeroes negatives and passes positives", () => {
  assert(activation(-5, "relu") === 0, "relu clamps");
  assert(activation(5, "relu") === 5, "relu passes");
});

Deno.test("gt comparator evaluates correctly at, below and above threshold", () => {
  const rule: ThresholdRule = { id: "t", label: "t", metric: "m", comparator: "gt", threshold: 0.5, action: "a" };
  assert(passesThreshold(rule, 0.4) === false, "below");
  assert(passesThreshold(rule, 0.5) === false, "at");
  assert(passesThreshold(rule, 0.6) === true, "above");
});

Deno.test("lt comparator evaluates correctly at, below and above threshold", () => {
  const rule: ThresholdRule = { id: "t", label: "t", metric: "m", comparator: "lt", threshold: 0.5, action: "a" };
  assert(passesThreshold(rule, 0.4) === true, "below");
  assert(passesThreshold(rule, 0.5) === false, "at");
  assert(passesThreshold(rule, 0.6) === false, "above");
});

Deno.test("gte comparator evaluates correctly at, below and above threshold", () => {
  const rule: ThresholdRule = { id: "t", label: "t", metric: "m", comparator: "gte", threshold: 0.5, action: "a" };
  assert(passesThreshold(rule, 0.4) === false, "below");
  assert(passesThreshold(rule, 0.5) === true, "at");
  assert(passesThreshold(rule, 0.6) === true, "above");
});

Deno.test("lte comparator evaluates correctly at, below and above threshold", () => {
  const rule: ThresholdRule = { id: "t", label: "t", metric: "m", comparator: "lte", threshold: 0.5, action: "a" };
  assert(passesThreshold(rule, 0.4) === true, "below");
  assert(passesThreshold(rule, 0.5) === true, "at");
  assert(passesThreshold(rule, 0.6) === false, "above");
});

Deno.test("gatedAction picks the first passing rule", () => {
  // confidence-gate (>=0.6) is first and passes; resource-gate also passes but
  // the first match wins.
  const action = gatedAction(THRESHOLD_RULES, { confidence: 0.9, resourceRatio: 0.1 }, "wait");
  assert(action === "attack", `first rule wins, got ${action}`);
});

Deno.test("gatedAction falls back when no rule passes", () => {
  const action = gatedAction(THRESHOLD_RULES, { confidence: 0.1, resourceRatio: 0.9, healthRatio: 0.9, momentum: 0.1 }, "wait");
  assert(action === "wait", `fallback, got ${action}`);
});

Deno.test("gatedAction respects table order for later gates", () => {
  // confidence fails, resource fails, health-gate (<=0.3) passes.
  const action = gatedAction(THRESHOLD_RULES, { confidence: 0.1, resourceRatio: 0.9, healthRatio: 0.2 }, "wait");
  assert(action === "block", `health gate, got ${action}`);
});

Deno.test("forward output is never NaN for any arch", () => {
  for (const arch of NET_ARCHS) {
    const w = new Array<number>(weightCount(arch.layers)).fill(0).map((_, i) => (i % 7) - 3);
    const input = new Array<number>(arch.layers[0]).fill(0.5);
    const out = forward(arch, w, input);
    assert(out.every((v) => !Number.isNaN(v)), `${arch.id} no NaN`);
    assert(out.every((v) => Number.isFinite(v)), `${arch.id} all finite`);
  }
});

Deno.test("NET_ARCHS and THRESHOLD_RULES tables are well formed", () => {
  const ids = new Set(NET_ARCHS.map((a) => a.id));
  assert(ids.size === NET_ARCHS.length, "arch ids unique");
  for (const a of NET_ARCHS) {
    assert(a.layers.length >= 2, `${a.id} has at least input+output`);
    assert(a.layers.every((n) => Number.isInteger(n) && n > 0), `${a.id} positive widths`);
    assert(KINDS.includes(a.activation), `${a.id} known activation`);
  }
  const ruleIds = new Set(THRESHOLD_RULES.map((r) => r.id));
  assert(ruleIds.size === THRESHOLD_RULES.length, "rule ids unique");
  for (const r of THRESHOLD_RULES) {
    assert(["gt", "lt", "gte", "lte"].includes(r.comparator), `${r.id} comparator`);
    assert(Number.isFinite(r.threshold), `${r.id} threshold`);
    assert(r.action.length > 0, `${r.id} action`);
  }
});
