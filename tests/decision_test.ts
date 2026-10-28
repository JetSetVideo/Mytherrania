import { decide, defaultTree, mutate, type CombatView, type TreeNode } from "../src/game/DecisionTree.ts";

function assert(ok: boolean, message: string) { if (!ok) throw new Error(message); }
function rng(): () => number { let x = 42; return () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; }; }

function view(partial: Partial<CombatView>): CombatView {
  return { distance: 2, selfReach: 1.8, enemyReach: 1.8, selfHpRatio: 0.8, enemyHpRatio: 0.8, nearEdge: false, ready: true, enemyAttacking: 0, selfDamagePercent: 0, enemyDamagePercent: 0, roundTime: 0, ...partial };
}

Deno.test("default tree attacks in reach, retreats from edge, advances when distant", () => {
  const tree = defaultTree();
  assert(decide(tree, view({ distance: 1, ready: true })) === "attack", "attack in reach");
  assert(decide(tree, view({ nearEdge: true })) === "retreat", "retreat near edge");
  assert(decide(tree, view({ distance: 5, ready: true })) === "advance", "advance when distant");
  assert(decide(tree, view({ distance: 1, ready: false, selfHpRatio: 0.2 })) === "retreat", "retreat when low hp and not ready");
});

Deno.test("mutate produces a valid tree that can still be decided", () => {
  const tree = defaultTree();
  const mutated = mutate(tree, 1.0, rng()); // full mutation
  for (let i = 0; i < 100; i++) {
    const d = decide(mutated, view({ distance: i / 10, ready: i % 2 === 0, nearEdge: i % 7 === 0 }));
    assert(["attack", "advance", "retreat", "block", "wait", "flank"].includes(d), `valid decision: ${d}`);
  }
});

Deno.test("mutate is deterministic for a given RNG and returns fresh nodes", () => {
  const tree = defaultTree();
  const a = mutate(tree, 1.0, rng());
  const b = mutate(tree, 1.0, rng());
  assert(JSON.stringify(a) === JSON.stringify(b), "same RNG -> same tree");
  // Deep-copy check: overwriting a leaf of the mutated tree must not alter the source
  const original = JSON.stringify(tree);
  const leaf = findLeaf(a);
  if (leaf) leaf.decision = leaf.decision === "wait" ? "attack" : "wait";
  assert(JSON.stringify(tree) === original, "source tree not aliased by mutation result");
});

function findLeaf(node: TreeNode): TreeNode | null {
  if (node.kind === "leaf") return node;
  return findLeaf(node.less!) ?? findLeaf(node.greater!);
}
