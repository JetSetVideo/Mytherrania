import { AiProfile } from "../src/game/AiStats.ts";
import { applyPersonality, Brain, PERSONALITY_BOUNDS } from "../src/game/AiBrain.ts";
import { defaultTree, decide, type CombatView } from "../src/game/DecisionTree.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }

function view(over: Partial<CombatView> = {}): CombatView {
  return {
    distance: 1.2, selfReach: 1.6, enemyReach: 1.6, selfHpRatio: 0.9, enemyHpRatio: 0.9,
    nearEdge: false, ready: true, enemyAttacking: 0, selfDamagePercent: 0, enemyDamagePercent: 0, roundTime: 5,
    ...over,
  };
}

Deno.test("adapt: a win makes the brain bolder, a loss more cautious", () => {
  const p = new AiProfile(1);
  const brain = new Brain("hybrid");
  const before = { ...brain.personality };
  // Feed a digest via a finished fight.
  p.beginFight();
  for (let i = 0; i < 3; i++) p.telemetry.recordHit(100, 1, i);
  p.endFight("win", 10);
  brain.adapt(true, 1, p.telemetry.digest());
  assert(brain.personality.aggression > before.aggression, "aggression should rise on a win");
  assert(brain.personality.cowardice < before.cowardice, "cowardice should fall on a win");
  brain.adapt(false, 0.5, p.telemetry.digest());
  assert(brain.personality.cowardice > before.cowardice - 0.05, "a loss should restore caution");
});

Deno.test("adapt stays inside the declared bounds", () => {
  const p = new AiProfile(2);
  const brain = new Brain("hybrid");
  p.beginFight();
  for (let i = 0; i < 12; i++) p.telemetry.tick(i, 0, 0, 50, i, 0.5, 0); // far away, so engage range should grow
  p.endFight("loss", 12);
  for (let i = 0; i < 40; i++) brain.adapt(false, 0.2, p.telemetry.digest());
  const b = PERSONALITY_BOUNDS;
  assert(brain.personality.aggression >= b.aggression[0] && brain.personality.aggression <= b.aggression[1], "aggression bounded");
  assert(brain.personality.cowardice >= b.cowardice[0] && brain.personality.cowardice <= b.cowardice[1], "cowardice bounded");
  assert(brain.personality.engageRange >= b.engageRange[0] && brain.personality.engageRange <= b.engageRange[1], "engage bounded");
});

Deno.test("applyPersonality rewrites distance thresholds but leaves the structure", () => {
  const tree = defaultTree();
  const tuned = applyPersonality(tree, { engageRange: 2.5, cowardice: 0.3, aggression: 0.3, neuralTrust: 0.4 });
  // The root-less branch that thresholds distance at 1.5 must now be 2.5.
  const distBranch = tuned.less!.greater!; // ready->distance
  assert(distBranch.field === "distance" && distBranch.threshold === 2.5, `expected 2.5, got ${distBranch.threshold}`);
  // The original tree is untouched.
  assert(defaultTree().less!.greater!.threshold === 1.5, "input tree must not be mutated");
});

Deno.test("tree mode ignores the network; a brain with no policy always uses the tree", () => {
  const treeBrain = new Brain("tree");
  const d1 = treeBrain.decide(view(), () => 0.99);
  const d2 = treeBrain.decide(view(), () => 0.01);
  // Both calls take the tree path, so they agree with decide() on the base tree.
  const base = decide(treeBrain.tree(), view());
  assert(d1 === base && d2 === base, "tree mode must be deterministic given the view");
});

Deno.test("a far enemy and full HP advances or attacks rather than idling", () => {
  const brain = new Brain("tree");
  const d = brain.decide(view({ distance: 5, ready: true }));
  assert(d === "advance" || d === "attack" || d === "flank", `expected to close, got ${d}`);
});
