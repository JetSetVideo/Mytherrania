// Lane X (W05): the holder's weapon never passes through the holder. Pure solver checks plus the
// REAL rig: lane A's skinned humanoid + Skeleton, the attack pose and every skill curve
// (Skeleton.playSkill) at 60 Hz, grip driven like Engine (stance pitch while a skill is held,
// palm-up pitch 0 otherwise), longsword and greatsword fixtures on rig.weaponNode.
import { buildSkinnedHumanoid } from "../src/graphics/body/SkinnedHumanoid.ts";
import { generateClassWeapon } from "../src/game/WeaponGen.ts";
import { defaultHumanoid } from "../src/game/Skeleton.ts";
import { ALL_SKILLS } from "../src/game/Skills.ts";
import { stanceForTechnique } from "../src/game/GripStance.ts";
import { hitboxesFromPlan } from "../src/combat/Hitboxes.ts";
import { ArmGuard } from "../src/combat/RigAdapter.ts";
import { gripExcluded, selfPenetration, solveSelfClearance } from "../src/combat/SelfGuard.ts";
import type { HitboxSet } from "../src/combat/contracts.ts";
import { capsule, greatsword, longsword, pose, warhammer } from "./combat_fixtures.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

Deno.test("self guard: penetration depth, push direction and the gripping-hand exclusion", () => {
  const sword = longsword();
  const own: HitboxSet = { mass: 70, boxes: [capsule([0.1, 0.5, -0.2], [0.1, 0.5, 0.2], 0.05, "chest"), { ...capsule([0, -0.05, -0.1], [0, -0.05, 0.1], 0.04, "hand"), side: "R" }] };
  const p = selfPenetration({ matrix: pose([1, 0, 0], 0, [0.12, 0, 0]), time: 0 }, own, sword);
  assert(p.hitbox?.zone === "chest" && Math.abs(p.depth - 0.034) < 1e-6, `depth ${p.depth} into ${p.hitbox?.zone}`);
  assert(p.push[0] > 0.9, `push ${p.push}`);
  assert(gripExcluded(own.boxes[1], sword) && !gripExcluded(own.boxes[0], sword), "grip hand excluded, chest not");
  const clear = selfPenetration({ matrix: pose([1, 0, 0], 0, [0.4, 0, 0]), time: 0 }, own, sword);
  assert(clear.depth === 0 && clear.hitbox === null, "clear");
});

Deno.test("self guard: the solver moves the cheapest joints, respects limits, stops at the margin", () => {
  // Penetration = 0.1 − 0.5·a − 0.2·b (a: cheap wrist, b: stiff shoulder); b is pinned at its limit.
  const res = solveSelfClearance({
    joints: [{ name: "gripPitch", angle: 0, min: -1, max: 1, weight: 1 }, { name: "shoulderR", angle: 0, min: 0, max: 0, weight: 4 }],
    penetration: (x) => 0.1 - 0.5 * x[0] - 0.2 * x[1],
  });
  assert(res.before === 0.1 && res.after <= 0 && res.after > -0.02, `after ${res.after}`);
  assert(res.deltas[1] === 0 && res.deltas[0] > 0.2 && res.deltas[0] < 0.25, `deltas ${res.deltas}`);
  assert(res.iterations <= 6, "iteration cap");
});

Deno.test("self guard: real rig — attack pose + every skill, longsword / greatsword / war hammer: after the solver <= 1 cm", () => {
  const app = { body: "#ef7455", accent: "#dfaa55", height: 1.7, weight: 72, hair: "#3a2a1a", eyes: "#2f6fb5", race: "human", subrace: null };
  const rig = buildSkinnedHumanoid(generateClassWeapon("Warrior"), app, "fire", undefined, { paint: false });
  const own = hitboxesFromPlan(rig.plan, { mass: 72 });
  const DT = 1 / 60;
  for (const weapon of [longsword(), greatsword(), warhammer()]) {
    const guard = new ArmGuard(rig, own, weapon, { writeBack: false });
    let before = 0, after = 0, frames = 0, penetrating = 0, worstMs = 0;
    const scenarios = [null, ...ALL_SKILLS];
    for (const skill of scenarios) {
      const sk = defaultHumanoid();
      for (let i = 0; i < 20; i++) rig.update(sk, DT);
      if (skill) {
        sk.playSkill(skill.animation);
        sk.setGripStance(stanceForTechnique(skill.kind, (skill.payload?.knockbackMul ?? 0) > 1.4 || skill.kind === "dash", 0));
      } else sk.setPose("attack");
      const n = skill ? Math.ceil(skill.animation.duration / DT) + 2 : 36;
      for (let f = 0; f < n; f++, frames++) {
        rig.update(sk, DT);
        const gp = sk.gripPose();
        rig.setGrip(sk.skillHeld() ? gp.pitch : 0, gp.roll);
        const t0 = performance.now();
        const r = guard.solve(sk);
        worstMs = Math.max(worstMs, performance.now() - t0);
        if (r.before > 0) penetrating++;
        before = Math.max(before, r.before);
        after = Math.max(after, r.after);
      }
    }
    console.log(`  ${weapon.archetype}: ${scenarios.length} animations, ${frames} frames, penetrating ${penetrating}; max before ${(100 * before).toFixed(2)} cm → after ${(100 * Math.max(0, after)).toFixed(2)} cm; worst solve ${worstMs.toFixed(2)} ms`);
    assert(after <= 0.01, `${weapon.archetype}: ${(100 * after).toFixed(2)} cm left after the solver`);
  }
});
