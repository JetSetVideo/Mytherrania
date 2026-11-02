// Wave W lane T: the OFF hand on the haft of a two-handed weapon (combat/OffHand.ts), on lane A's REAL
// skinned rig posed in the engine's frame order (tests/wave_w_twohand_fixture.ts). Pins, from the
// measurement in docs/wave-w/lane-T.md:
//   - human: the off hand's grip anchor within OFF_GAP_MM of the handle line at guard, wind-up apex,
//     contact, hold and mid-recovery, for every two-handed archetype (before: 221-505 mm);
//   - the control: without the off-hand step the same poses leave it > 200 mm away (the bug is real);
//   - ork and dwarf: on the haft at guard for the swords/axes/hafted weapons, which needs the weapon arm's
//     convergence (before: 452-583 mm); the strike beats of a broad body may RELEASE (see the lane report);
//   - never inside the own torso: the off hand's capsule clears the chest/belly/pelvis capsules through
//     every sampled frame of every two-handed swing, three bodies (lane M's ClipMeter bound, > 0);
//   - render-only: the step changes no Skeleton joint (the ragdoll binds to those), and it is idempotent.
import { hitboxesFromPlan, updateHitboxes } from "../src/combat/Hitboxes.ts";
import { boneWorldOf } from "../src/combat/RigAdapter.ts";
import { applyTwoHandGrip } from "../src/combat/OffHand.ts";
import { setClearance, type CapsuleLike } from "../src/game/anim/Clipping.ts";
import { JOINT_ORDER } from "../src/game/anim/Rig.ts";
import { bench, BEATS, DWARF, ENGINE_TWO_HAND, fmt, HUMAN, measureAll, measureBeat, ORK, TWO_HANDED } from "./wave_w_twohand_fixture.ts";
import type { ArchetypeId } from "../src/combat/contracts.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

/** The deliverable's bound: the off fist within 40 mm of the haft line. */
const OFF_GAP_MM = 40;

Deno.test("off hand: on the haft at every beat of every two-handed swing (human), and the control shows the bug", () => {
  const lines: string[] = [];
  for (const id of TWO_HANDED) {
    const after = measureAll(id, ENGINE_TWO_HAND, HUMAN), before = measureAll(id, null, HUMAN);
    for (let i = 0; i < after.length; i++) {
      const a = after[i], b = before[i];
      lines.push(`${fmt(a)}   [control ${b.offGapMm!.toFixed(0)} mm]`);
      assert(a.offGapMm !== null && a.offGapMm < OFF_GAP_MM, `${id} ${a.beat}: off hand ${a.offGapMm?.toFixed(1)} mm from the haft`);
      assert(b.offGapMm! > 200, `${id} ${b.beat}: the control (no off-hand step) should miss the haft, got ${b.offGapMm!.toFixed(0)} mm`);
      // On the haft, not past its ends: between the butt and two half-hands below the main hand.
      assert(a.offAlongMm! <= -85 && a.offAlongMm! >= -800, `${id} ${a.beat}: off hand ${a.offAlongMm!.toFixed(0)} mm along the haft`);
      // The weapon hand still holds the handle through its fist, inside lane G's bands.
      assert(a.grip.through && a.rule.ok, `${id} ${a.beat}: weapon hand ${a.rule.why.join("; ")}`);
    }
  }
  console.log(lines.filter((l) => l.includes(" guard ") || l.includes(" contact ")).join("\n"));
});

Deno.test("off hand: broad bodies hold the haft at guard (the weapon arm converges toward the midline)", () => {
  const AT_GUARD: ArchetypeId[] = ["longsword", "greatsword", "halberd", "scythe", "greataxe", "maul"];
  for (const look of [ORK, DWARF]) {
    for (const id of AT_GUARD) {
      const [g] = measureAll(id, ENGINE_TWO_HAND, look, ["guard"]);
      assert(g.offGapMm! < OFF_GAP_MM, `${look.race} ${id} guard: off hand ${g.offGapMm!.toFixed(1)} mm from the haft`);
      assert(g.rule.ok, `${look.race} ${id} guard: ${g.rule.why.join("; ")}`);
    }
    // The ork also keeps the spear and the staff at guard and the swords/axes through the wind-up and contact.
    if (look === ORK) {
      for (const id of ["spear", "staff"] as ArchetypeId[]) assert(measureAll(id, ENGINE_TWO_HAND, ORK, ["guard"])[0].offGapMm! < OFF_GAP_MM, `ork ${id} guard`);
      for (const id of AT_GUARD) for (const s of measureAll(id, ENGINE_TWO_HAND, ORK, ["windup", "contact", "recover"])) assert(s.offGapMm! < OFF_GAP_MM, `ork ${id} ${s.beat}: ${s.offGapMm!.toFixed(1)} mm`);
    }
  }
});

Deno.test("off hand: never inside its own torso through the whole swing (human, ork, dwarf)", () => {
  for (const look of [HUMAN, ORK, DWARF]) {
    for (const id of TWO_HANDED) {
      const b = bench(id, look), boxes = hitboxesFromPlan(b.rig.plan);
      const torso = boxes.boxes.filter((h) => h.zone === "chest" || h.zone === "abdomen" || h.zone === "pelvis") as CapsuleLike[];
      const hands = boxes.boxes.filter((h) => h.zone === "hand") as CapsuleLike[];
      b.drv.begin(b.setup.sweet, 0, 0);
      const t = b.drv.player.timing, total = t.windup + t.strike + (t.hold ?? 0) + t.recover + (t.settle ?? 0);
      let worst = Infinity, at = 0;
      for (let i = 0; i <= 40; i++) {
        measureBeat(b, "contact", ENGINE_TWO_HAND, total * i / 40);
        updateHitboxes(boxes, boneWorldOf(b.rig));
        const c = setClearance(hands, torso);
        if (c < worst) { worst = c; at = i / 40; }
      }
      assert(worst > 0, `${look.race} ${id}: a hand ${(-1000 * worst).toFixed(1)} mm inside the torso at ${(100 * at).toFixed(0)} % of the swing`);
    }
  }
});

Deno.test("off hand: render-only (no Skeleton joint moves) and idempotent (the engine calls it twice a frame)", () => {
  const b = bench("greatsword", ORK);
  for (const beat of BEATS) {
    measureBeat(b, beat, null);
    const before = JOINT_ORDER.map((n) => b.sk.joint(n).angle);
    const plan = b.setup.offHand!;
    const r1 = applyTwoHandGrip(b.rig, b.sk.joint("shoulderR").angle, plan, b.drv.chokeOffset())!;
    b.rig.group.updateMatrixWorld(true);
    const q1 = ["shoulderL", "elbowL", "shoulderR"].map((n) => b.rig.bones.get(n as never)!.quaternion.toArray() as number[]);
    const r2 = applyTwoHandGrip(b.rig, b.sk.joint("shoulderR").angle, plan, b.drv.chokeOffset())!;
    const q2 = ["shoulderL", "elbowL", "shoulderR"].map((n) => b.rig.bones.get(n as never)!.quaternion.toArray() as number[]);
    JOINT_ORDER.forEach((n, i) => assert(b.sk.joint(n).angle === before[i], `${beat}: ${n} moved`));
    for (let k = 0; k < 3; k++) for (let c = 0; c < 4; c++) assert(Math.abs(q1[k][c] - q2[k][c]) < 1e-9, `${beat}: second call changed bone ${k}`);
    assert(Math.abs(r1.gap - r2.gap) < 1e-9 && r1.converge === r2.converge, `${beat}: same result twice`);
  }
});
