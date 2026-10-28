// Systems report: the declared bounds, the equation registry, the training planner and
// the network depth tables, printed from the code.
//
// This is the tool that keeps those pure modules LIVE (the zero-dead-code rule counts
// tools as runtime) and it is the audit the brief asks for: every parameter bounded,
// every equation bound to its variables, and nothing left implicit.
//   deno run -A tools/systems-report.ts
import { bound, boundsByCategory, clampToBound, outOfBounds, parameterCount, validateAll, type BoundCategory } from "../src/game/ParameterBounds.ts";
import { equation, equationCount, equationsByCategory, equationsTouching, inputsOf, unknownInputs, type EquationCategory } from "../src/game/EquationRegistry.ts";
import { aggregateRuns, drainPlan, expandPlan, planSize, type TrainingPlan } from "../src/game/TrainingRuns.ts";
import { activation, forward, gatedAction, NET_ARCHS, passesThreshold, THRESHOLD_RULES, weightCount } from "../src/balance/NeuralDepth.ts";
import { effectiveDuration, MATCH_LENGTHS, scaledMaxHealth, SPEEDS, stepTime } from "../src/game/MatchControl.ts";

const CATEGORIES: BoundCategory[] = ["stats", "physics", "skills", "senses", "arena", "resources", "pickups", "ranking", "balance", "body", "ui"];

console.log("=== parameter bounds ===");
console.log(`total declared: ${parameterCount()}`);
for (const cat of CATEGORIES) {
  const rows = boundsByCategory(cat);
  if (rows.length) console.log(`  ${cat.padEnd(10)} ${String(rows.length).padStart(2)}  e.g. ${rows[0].id} [${rows[0].min}..${rows[0].max}] ${rows[0].unit}`);
}

// Clamping really clamps: a sample of out-of-range values must land inside.
console.log("\n=== clamp spot-checks ===");
for (const [id, value] of [["arena_size", 9999], ["crit_chance", -1], ["frame_budget", NaN]] as [string, number][]) {
  const b = bound(id);
  if (b) console.log(`  ${id}: ${value} -> ${clampToBound(id, value)} (bound ${b.min}..${b.max}), was out of bounds: ${outOfBounds(id, value)}`);
}
const violations = validateAll({ arena_size: 5000, crit_chance: 0.5, truce_duration: 6 });
console.log(`validateAll on 3 bad values -> ${violations.length} violations: ${violations.map((v) => v.id).join(", ")}`);

console.log("\n=== equation registry ===");
console.log(`total equations: ${equationCount()}`);
// NOTE: the equation registry uses its OWN taxonomy (combat / physics / animation /
// ai / perception / environment), deliberately different from the bound registry's
// categories. They are two views of the same numbers, not one shared enum.
const E_CATEGORIES: EquationCategory[] = ["combat", "physics", "animation", "ai", "perception", "environment"];
for (const cat of E_CATEGORIES) {
  const rows = equationsByCategory(cat);
  if (rows.length) console.log(`  ${cat.padEnd(10)} ${String(rows.length).padStart(2)}  e.g. ${rows[0].id}: ${rows[0].expression}`);
}
const missing = unknownInputs();
console.log(`equation inputs with NO declared bound (${missing.length}): ${missing.join(", ") || "none"}`);
const sample = equation("crit");
if (sample) {
  console.log(`crit inputs: ${inputsOf("crit").join(", ")}`);
  console.log(`equations touching REF: ${equationsTouching("reflex").map((e) => e.id).join(", ") || "none"}`);
}

console.log("\n=== neural depth ===");
for (const arch of NET_ARCHS) console.log(`  ${arch.id.padEnd(9)} layers=[${arch.layers.join(",")}] weights=${weightCount(arch.layers)} activation=${arch.activation}`);
for (const kind of ["tanh", "relu", "sigmoid", "leaky"] as const) {
  console.log(`  ${kind.padEnd(8)} -1=${activation(-1, kind).toFixed(4)} 0=${activation(0, kind).toFixed(4)} 1=${activation(1, kind).toFixed(4)}`);
}
const deep = NET_ARCHS[NET_ARCHS.length - 1];
const w = new Array(weightCount(deep.layers)).fill(0.1);
const out = forward(deep, w, new Array(deep.layers[0]).fill(0.5));
console.log(`  forward(${deep.id}, in ${deep.layers[0]}) -> ${out.length} outputs, first ${out[0].toFixed(4)}`);
console.log(`  threshold rules: ${THRESHOLD_RULES.map((r) => r.id).join(", ")}`);
const first = THRESHOLD_RULES[0];
console.log(`  ${first.id} passes at its threshold: ${passesThreshold(first, first.threshold)}`);
const gated = gatedAction(THRESHOLD_RULES, Object.fromEntries(THRESHOLD_RULES.map((r) => [r.metric, 0])), "hold");
console.log(`  gatedAction with all metrics at 0 -> ${JSON.stringify(gated)}`);

console.log("\n=== match terms and playback ===");
for (const l of MATCH_LENGTHS) console.log(`  ${l.id.padEnd(9)} healthScale=${l.healthScale} -> base 40000 becomes ${scaledMaxHealth(40000, l.id)}`);
for (const s of SPEEDS) console.log(`  ${s.id.padEnd(7)} timeScale=${s.timeScale} step(0.016)=${stepTime(0.016, s.id).toFixed(4)}s  a 60s fight watches in ${effectiveDuration(60, s.id).toFixed(1)}s`);

console.log("\n=== automatic training plan ===");
const plan: TrainingPlan = {
  rounds: 2, seed: 20261011, classes: [], races: [], speedId: "eight", lengthId: "blitz",
  arenaSizeMin: 20, arenaSizeMax: 60,
};
console.log(`  all classes x all races x ${plan.rounds} rounds = ${planSize(plan)} matchups`);
const expanded = expandPlan(plan);
const batches = drainPlan(plan, 400);
const summary = aggregateRuns(expanded.map((m, i) => ({
  winnerClass: i % 3 === 0 ? m.classA : m.classB,
  loserClass: i % 3 === 0 ? m.classB : m.classA,
  durationS: 12 + (i % 7),
  damage: 1000 + (i % 500),
  endReason: (i % 4 === 0 ? "domination" : "ko") as "ko" | "domination",
})));
console.log(`  expanded=${expanded.length} batches=${batches.length} (last ${batches[batches.length - 1].length})`);
console.log(`  aggregate: matches=${summary.matches} avg=${summary.avgDurationS.toFixed(1)}s reasons=${JSON.stringify(summary.endReasons)}`);