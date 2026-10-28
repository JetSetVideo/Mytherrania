import { createFighter, knockbackPower } from "../src/game/Fighter.ts";
import { decide, type CombatView } from "../src/game/DecisionTree.ts";

function assert(ok: boolean, message: string) { if (!ok) throw new Error(message); }

Deno.test("createFighter initialises stats, weapon, skeleton and decision tree", () => {
  const f = createFighter("Barbarian", "Grug", 1, 2, 0.55);
  assert(f.hp === f.stats.maxHealth && f.damagePercent === 0, "fresh fighter at full health");
  assert(f.weapon.name === "Greataxe", "barbarian carries the greataxe");
  assert(f.stats.maxHealth > 0, "stats derived");
  assert(f.body.x === 1 && f.body.z === 2, "spawn position respected");
  assert(!f.ringedOut && !f.eliminated, "fighter starts in the ring");
  assert(f.skeleton.pose === "idle", "skeleton starts idle");
  assert(f.tree.kind === "branch", "decision tree attached");
});

Deno.test("knockbackPower scales with the target damage percent", () => {
  const attacker = createFighter("Warrior", "A", 0, 0, 0.5);
  const target = createFighter("Mage", "B", 2, 0, 0.5);
  const base = knockbackPower(attacker, target);
  target.damagePercent = 60;
  assert(knockbackPower(attacker, target) > base, "higher damage percent means more knockback");
});

Deno.test("a fighter's decision tree drives sensible ring actions", () => {
  const self = createFighter("Warrior", "A", 0, 0, 0.5);
  const view: CombatView = { distance: 1, selfReach: self.weapon.reach, enemyReach: 1.8, selfHpRatio: 0.8, enemyHpRatio: 0.8, nearEdge: false, ready: true, enemyAttacking: 0, selfDamagePercent: 0, enemyDamagePercent: 0, roundTime: 0 };
  assert(decide(self.tree, view) === "attack", "attack in reach");
  assert(decide(self.tree, { ...view, nearEdge: true }) === "retreat", "retreat near edge");
  assert(decide(self.tree, { ...view, distance: 6 }) === "advance", "advance when distant");
});
