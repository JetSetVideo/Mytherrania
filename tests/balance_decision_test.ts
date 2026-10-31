// Wave J (lane J-B): the digest features, the edge-aware tree and the brain helpers.
import { arenaFeatures, decide, defaultTree, edgeAwareTree, FAR_EDGE, rayToRim, type CombatView, type TreeNode } from "../src/game/DecisionTree.ts";
import { Brain, edgePlayTarget, sensibleSkill, strafeToward } from "../src/game/AiBrain.ts";
import { judgeTimeLimit, JUDGE_MARGIN } from "../src/game/MatchControl.ts";
import { skillsForClass } from "../src/game/Skills.ts";
import { DIGEST_DIRS } from "../src/game/arena/contracts.ts";
import { ENGINE_RULES, knockbackSpeed, meterGain, METER_FULL, WAVE_J_RULES } from "../src/balance/MatchRules.ts";
import { DAMAGE_SCALE , HEALTH_SCALE } from "../src/game/Stats.ts";

function assert(ok: unknown, msg: string): asserts ok { if (!ok) throw new Error(msg); }

/** A circular digest of radius R; `openDirs` lists the open direction indices (the rest walled 1.2 m). */
function circle(R: number, openDirs: number[]) {
  const rim = Array.from({ length: DIGEST_DIRS }, () => R);
  const open = rim.map((_, k) => (openDirs.includes(k) ? 1 : 0));
  return { rim, open, wallHeight: open.map((o) => (o ? 0 : 1.2)), openFraction: openDirs.length / DIGEST_DIRS };
}
function view(p: Partial<CombatView>): CombatView {
  return { distance: 2, selfReach: 1.8, enemyReach: 1.8, selfHpRatio: 0.8, enemyHpRatio: 0.8, nearEdge: false, ready: true, enemyAttacking: 0, selfDamagePercent: 0, enemyDamagePercent: 0, roundTime: 0, ...p };
}

Deno.test("J-B D1: without digest features the edge-aware tree decides exactly like the default tree", () => {
  const a = defaultTree(), b = edgeAwareTree();
  for (const distance of [0.5, 1.2, 1.6, 2.5, 6]) for (const ready of [true, false]) for (const nearEdge of [true, false])
    for (const hp of [0.1, 0.4, 0.9]) for (const enemyAttacking of [0, 1]) {
      const v = view({ distance, ready, nearEdge, selfHpRatio: hp, enemyHpRatio: 1 - hp, enemyAttacking });
      assert(decide(a, v) === decide(b, v), `differs at ${JSON.stringify(v)}`);
    }
});

Deno.test("J-B D2: `missing` sends an absent field down the named branch; the default stays 'greater'", () => {
  const t = (missing?: "less" | "greater"): TreeNode => ({ kind: "branch", field: "rimBehind", threshold: 1, missing, less: { kind: "leaf", decision: "flank" }, greater: { kind: "leaf", decision: "attack" } });
  assert(decide(t("less"), view({})) === "flank", "missing -> less");
  assert(decide(t(), view({})) === "attack", "default missing -> greater (the pre-Wave-J behaviour)");
  assert(decide(t(), view({ rimBehind: NaN })) === "attack", "NaN counts as missing");
  assert(decide(t("less"), view({ rimBehind: 3 })) === "attack", "a present value is compared normally");
});

Deno.test("J-B D3: arena features read the digest along both knockback lines", () => {
  const d = circle(5, [0]); // only +x is open
  // Self at (2, 0), enemy at the centre: a blow throws self along +x, 3 m to an open rim.
  const f = arenaFeatures(d, { x: 2, z: 0 }, { x: 0, z: 0 });
  assert(Math.abs(f.rimBehind - 3) < 0.02, `rimBehind ${f.rimBehind}`);
  assert(f.openBehind === 1 && f.wallBehind === 0, "self's back is to the open edge");
  assert(Math.abs(f.enemyRimBehind - 5) < 0.02 && f.enemyOpenBehind === 0 && f.enemyWallBehind === 1.2, "enemy's back is walled, 5 m");
  assert(f.laneOffset > 3, `enemy's open lane is behind self: offset ${f.laneOffset}`);
  // Swap: self at the centre pushes the enemy at (2, 0) straight at the open edge.
  const g = arenaFeatures(d, { x: 0, z: 0 }, { x: 2, z: 0 });
  assert(g.enemyOpenBehind === 1 && Math.abs(g.enemyRimBehind - 3) < 0.02 && g.laneOffset < 0.05, `lined up: ${JSON.stringify(g)}`);
  // Between an open and a walled ray the exit reads open (conservative).
  const gate = arenaFeatures(circle(5, [1]), { x: 2 * Math.cos(Math.PI / 32), z: 2 * Math.sin(Math.PI / 32) }, { x: 0, z: 0 });
  assert(gate.openBehind === 1 && gate.wallBehind === 0, `half-way to an open ray reads open: ${JSON.stringify(gate)}`);
  // Fully walled: no lane, offset π; every value finite.
  const w = arenaFeatures(circle(5, []), { x: 1, z: 1 }, { x: -1, z: 0 });
  assert(w.laneOffset === Math.PI && w.openBehind === 0 && w.enemyOpenBehind === 0, "walled arena");
  const z = arenaFeatures(d, { x: 0, z: 0 }, { x: 0, z: 0 });
  assert(Object.values(z).every(Number.isFinite), "coincident fighters stay finite");
  assert(rayToRim({ rim: [] }, 0, 0, 1, 0).dist === FAR_EDGE, "an empty rim is far");
});

Deno.test("J-B D4: the edge tree strikes or steps in with its back to an open edge, and pushes an enemy at one", () => {
  const t = edgeAwareTree();
  const edge = { openFraction: 0.25, openBehind: 1, rimBehind: 1.2, wallBehind: 0, enemyOpenBehind: 0, enemyRimBehind: 4, enemyWallBehind: 1.2, laneOffset: 2 };
  assert(decide(t, view({ ...edge, ready: true, distance: 1.2 })) === "attack", "ready in reach: strike");
  assert(decide(t, view({ ...edge, ready: false, distance: 1.2 })) === "advance", "not ready: step in, away from the drop");
  assert(decide(t, view({ ...edge, ready: true, distance: 3 })) === "advance", "out of reach: close in");
  const push = { ...edge, openBehind: 0, rimBehind: 4, enemyOpenBehind: 1, enemyRimBehind: 1.5 };
  assert(decide(t, view({ ...push, ready: true, distance: 1.2, nearEdge: true })) === "attack", "enemy at an open edge: push");
  // A walled back near the rim is NOT "near the edge" for the edge tree (the default tree would block/retreat).
  const walled = { ...edge, openBehind: 0, rimBehind: 0.4 };
  assert(decide(t, view({ ...walled, ready: true, distance: 1.2, nearEdge: true, enemyAttacking: 1 })) === "attack", "walled back: fight on");
  assert(decide(defaultTree(), view({ ready: true, distance: 1.2, nearEdge: true, enemyAttacking: 1 })) !== "attack", "the default tree would not");
});

Deno.test("J-B D5: edge play targets the enemy's far side from its open edge; strafe and skill sense", () => {
  const d = circle(6, [0]);
  const T = edgePlayTarget(d, { x: 2, z: 0 }, 1)!;
  assert(T && Math.abs(T.x - 1) < 1e-9 && Math.abs(T.z) < 1e-9, `target ${JSON.stringify(T)}`);
  assert(edgePlayTarget(circle(6, []), { x: 0, z: 0 }, 1) === null, "no open edge, no target");
  const s = strafeToward({ x: 0, z: -2 }, { x: 0, z: 0 }, { x: -2, z: 0 });
  assert(s === 1 || s === -1, "a side is chosen");
  assert(strafeToward({ x: 1, z: 1 }, { x: 0, z: 0 }, { x: 1.1, z: 1 }) === 0, "already there");
  const roll = skillsForClass("Archer").find((k) => k.id === "archer-rollback")!;
  const aim = skillsForClass("Archer").find((k) => k.id === "archer-steady-aim")!;
  const nova = skillsForClass("Mage").find((k) => k.kind === "power")!;
  assert(roll.animation.lunge < 0, "Rolling Shot lunges backward (the hazard this guards)");
  assert(!sensibleSkill(roll, { distance: 4, selfReach: 2 }), "no backward roll out of reach");
  assert(!sensibleSkill(roll, { distance: 1, selfReach: 2, openBehind: 0, rimBehind: 5 }), "no roll that ends out of the user's reach");
  assert(!sensibleSkill(roll, { distance: 0.9, selfReach: 3.6, openBehind: 1, rimBehind: 1.5 }), "no roll off an open edge");
  assert(sensibleSkill(roll, { distance: 0.9, selfReach: 3.6, openBehind: 0, rimBehind: 1.5 }), "a walled back is fine");
  assert(!sensibleSkill(aim, { distance: 4, selfReach: 2 }) && sensibleSkill(aim, { distance: 1, selfReach: 2 }), "slowing stance only in reach");
  assert(sensibleSkill(nova, { distance: 9, selfReach: 2 }), "forward/zero lunge always sensible");
});

Deno.test("J-B D6: the judge at the bell, the knockback meter and floor", () => {
  assert(judgeTimeLimit(0.9, 0.2) === 0 && judgeTimeLimit(0.1, 0.6) === 1, "the clear leader wins");
  assert(judgeTimeLimit(0.5, 0.5 + JUDGE_MARGIN / 2) === null && judgeTimeLimit(NaN, NaN) === null, "close or broken -> tie");
  // Relative meter equals the engine's at the reference pool, halves at twice that pool. The pool is
  // DERIVED from HEALTH_SCALE: Wave J halved it (1000 -> 500), and a hard-coded 45 000 was the
  // pre-Wave-J value, which made this assertion compare two different pools.
  const pool = 45 * HEALTH_SCALE;
  const eng = meterGain(ENGINE_RULES, 900, pool, DAMAGE_SCALE), rel = meterGain(WAVE_J_RULES, 900, pool, DAMAGE_SCALE);
  assert(Math.abs(eng - rel) < 1e-9, `pool ${pool}: engine ${eng} vs relative ${rel}`);
  assert(Math.abs(meterGain(WAVE_J_RULES, 900, pool * 2, DAMAGE_SCALE) - rel / 2) < 1e-9 && METER_FULL === 360, "relative to the pool");
  // Knockback grows with the meter; the Wave J floor lowers the push on a fresh fighter only.
  let prev = -1;
  for (const pct of [0, 30, 60, 120, 300]) {
    const v = knockbackSpeed(WAVE_J_RULES, 1.2, 8, 80, pct, 1, 1);
    assert(v > prev, `knockback must grow with the meter (${pct} %: ${v})`);
    prev = v;
  }
  const fresh = (r: typeof ENGINE_RULES) => knockbackSpeed(r, 1.2, 8, 80, 0, 1, 1);
  assert(Math.abs(fresh(WAVE_J_RULES) / fresh(ENGINE_RULES) - 0.35) < 1e-9, "0 %: floor 0.35 vs the engine's 1");
  assert(knockbackSpeed(ENGINE_RULES, 1.2, 8, 300, 0, 1, 1) < knockbackSpeed(ENGINE_RULES, 1.2, 8, 60, 0, 1, 1), "a heavier body is pushed less");
  assert(knockbackSpeed(WAVE_J_RULES, NaN, NaN, NaN, NaN, NaN, NaN) >= 0, "total");
});

Deno.test("J-B D7: a Brain can walk the edge-aware tree; the default brain is unchanged", () => {
  const edge = { openFraction: 0.25, openBehind: 1, rimBehind: 1.2, wallBehind: 0, enemyOpenBehind: 0, enemyRimBehind: 4, enemyWallBehind: 1.2, laneOffset: 2 };
  const v = view({ ...edge, ready: false, distance: 1.2 });
  assert(new Brain("tree", undefined, null, edgeAwareTree()).decide(v) === "advance", "edge-aware brain steps in");
  assert(new Brain("tree").decide(v) === decide(defaultTree(), v), "default brain = default tree");
});
