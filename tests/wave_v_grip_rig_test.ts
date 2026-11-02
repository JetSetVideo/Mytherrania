// Lane G (wave V): the grip on the REAL skinned rig (lane A's buildSkinnedHumanoid, no browser):
// posed like the engine (Skeleton joints from the swing -> rig.update -> forearm supination ->
// rig.setGrip(SwingDriver.gripPitch/gripRoll)), then measured from the scene graph the way
// tools/probe-grip.ts measures the live game (RigAdapter.handFrameWorld + weaponNode.matrixWorld ->
// PalmWeapon.gripMetrics -> GripStance.checkOrientation). Pins: the handle passes through the fist,
// across the fingers inside the wrist band, its line within a few cm of the palm centre, and the carry
// rule at guard and through the swing — for every archetype, on a human and an ork.
// @deno-types="@types/three"
import * as THREE from "three";
import { buildSkinnedHumanoid } from "../src/graphics/body/SkinnedHumanoid.ts";
import { defaultHumanoid, type JointName } from "../src/game/Skeleton.ts";
import { limitTableFrom } from "../src/game/anim/Rig.ts";
import { armGeometry, GUARD_KEY, type SwingKey } from "../src/game/anim/Swing.ts";
import { applyForearmTwist, GRIP_SUPINATION, handFrameWorld } from "../src/combat/RigAdapter.ts";
import { SwingDriver, swingSetupFor } from "../src/combat/SwingDriver.ts";
import { measureAimLine } from "../src/combat/SwingRig.ts";
import { gripMetrics, type V3t } from "../src/game/PalmWeapon.ts";
import { checkOrientation, GRIP_RULES } from "../src/game/GripStance.ts";
import { ARCHETYPE_IDS } from "../src/game/weapons/Archetypes.ts";
import { weaponFromSeed } from "../src/game/weapons/Generate.ts";
import { toGeneratedWeapon } from "../src/game/weapons/Adapter.ts";
import type { ArchetypeId } from "../src/combat/contracts.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

interface Look { body: string; accent: string; height: number; weight: number; hair: string; eyes: string; race: string; subrace: string | null }
const HUMAN: Look = { body: "#ef7455", accent: "#dfaa55", height: 1.7, weight: 72, hair: "#3a2a1a", eyes: "#2f6fb5", race: "human", subrace: null };
const ORK: Look = { body: "#4f8490", accent: "#172128", height: 1.95, weight: 120, hair: "#172128", eyes: "#172128", race: "ork", subrace: "ironhide" };
type Beat = "guard" | "windup" | "contact" | "recover";

const v3 = (v: THREE.Vector3): V3t => [v.x, v.y, v.z];

/** Pose the rig with key `k` like the engine and measure the grip (twist: the engine's forearm supination). */
function measure(id: ArchetypeId, app: Look, beats: Beat[], twistOverride?: number) {
  const spec = weaponFromSeed(id, 7);
  const rig = buildSkinnedHumanoid(toGeneratedWeapon(spec), app, "fire", undefined, { paint: false, weaponSpec: spec });
  const sk = defaultHumanoid();
  const head = (b: string) => rig.plan.bones.find((x) => x.id === b)!.head;
  const setup = swingSetupFor(spec, armGeometry(head("shoulderR"), head("elbowR"), rig.plan.arms[1].grip));
  setup.aimLine = measureAimLine(rig, sk, setup);
  const drv = new SwingDriver(setup, limitTableFrom(sk.limits()));
  const twist = twistOverride ?? setup.twist;
  const out: { beat: Beat; m: ReturnType<typeof gripMetrics>; rule: ReturnType<typeof checkOrientation> }[] = [];
  const set = (n: JointName, a: number) => { const j = sk.joint(n); j.angle = Math.max(j.min, Math.min(j.max, a)); j.target = j.angle; };
  const pose = (k: SwingKey) => {
    set("spine", k.lean); set("abdomen", 0.5 * k.lean); set("shoulderR", k.shoulder); set("elbowR", k.elbow);
    rig.update(sk, 0);
    if (twist) applyForearmTwist(rig, sk.joint("elbowR").angle, twist);
    rig.setGrip(drv.gripPitch(sk.joint("spine").angle, sk.joint("shoulderR").angle, sk.joint("elbowR").angle), drv.gripRoll());
    rig.weaponNode.position.y = -drv.chokeOffset();
    rig.group.updateMatrixWorld(true);
    const h = handFrameWorld(rig, 1), e = rig.weaponNode.matrixWorld.elements;
    const chest = new THREE.Vector3(), pelvis = new THREE.Vector3(), gripO = new THREE.Vector3();
    rig.bones.get("spine")!.getWorldPosition(chest);
    rig.bones.get("abdomen")!.getWorldPosition(pelvis);
    (rig.weaponNode.parent ?? rig.weaponNode).getWorldPosition(gripO);
    return gripMetrics({
      hand: { palm: v3(h.palm), grip: v3(h.grip), d: v3(h.d), n: v3(h.n), w: v3(h.w) },
      y: [e[4], e[5], e[6]], z: [e[8], e[9], e[10]], gripOrigin: v3(gripO),
      tipPoint: v3(rig.weaponNode.localToWorld(new THREE.Vector3(0, setup.tip, 0))),
      pelvis: v3(pelvis), chest: v3(chest), facing: [0, 0, 1], offGrip: null,
    });
  };
  const rule = GRIP_RULES[id];
  for (const beat of beats) {
    if (beat === "guard") { drv.player.cancel(); out.push({ beat, m: pose({ ...GUARD_KEY }), rule: { ok: true, why: [] } }); }
    else {
      drv.begin(setup.sweet, 0, 0);
      const t = drv.player.timing, at = beat === "windup" ? 0.97 * t.windup : beat === "contact" ? drv.phaseTimes().contactAt : t.windup + t.strike + (t.hold ?? 0) + 0.5 * t.recover;
      drv.player.clock = drv.player.prevClock = at;
      drv.player.sample(drv.sample);
      out.push({ beat, m: pose(drv.sample), rule: { ok: true, why: [] } });
    }
    const last = out[out.length - 1];
    last.rule = checkOrientation(rule, beat, last.m);
  }
  return Object.assign(out, { twist: setup.twist });
}

Deno.test("grip rig: every archetype — the handle crosses the palm through the fist, the carry rule holds (human)", () => {
  const lines: string[] = [];
  for (const id of ARCHETYPE_IDS) {
    for (const r of measure(id, HUMAN, ["guard", "windup", "contact", "recover"])) {
      const m = r.m;
      lines.push(`${id.padEnd(10)} ${r.beat.padEnd(7)} fingers ${m.handleToFingers.toFixed(1)}° outPalm ${m.outOfPalmPlane.toFixed(1)}° line->palm ${m.lineToPalmMm.toFixed(1)} mm elev ${m.elevation.toFixed(0)}° ${r.rule.ok ? "ok" : r.rule.why.join("; ")}`);
      assert(r.rule.ok, `${id} ${r.beat}: ${r.rule.why.join("; ")}`);
      assert(m.through, `${id} ${r.beat}: through the fist`);
      assert(m.lineToGripAnchorMm < 1, `${id} ${r.beat}: the handle line passes the grip anchor (${m.lineToGripAnchorMm.toFixed(2)} mm)`);
      assert(m.lineToPalmMm <= 45, `${id} ${r.beat}: handle line ${m.lineToPalmMm.toFixed(1)} mm from the palm centre`);
      if (r.beat === "guard") assert(m.handleToFingers >= 45 && m.handleToFingers <= 110, `${id} guard: ${m.handleToFingers.toFixed(1)}° to the fingers`);
    }
  }
  console.log(lines.filter((l) => l.includes(" guard ")).join("\n"));
});

Deno.test("grip rig: an ork holds them the same way (guard + contact)", () => {
  for (const id of ["dagger", "axe", "spear", "maul", "bow"] as ArchetypeId[]) {
    for (const r of measure(id, ORK, ["guard", "contact"])) assert(r.rule.ok, `ork ${id} ${r.beat}: ${r.rule.why.join("; ")}`);
  }
});

Deno.test("grip rig: the forearm supination is what stands the guard blade upright (control without it leans across the face)", () => {
  const lateral = (twist: number) => {
    const [g] = measure("longsword", HUMAN, ["guard"], twist);
    return g.m;
  };
  const withT = lateral(GRIP_SUPINATION), without = lateral(0);
  const solved = { human: measure("longsword", HUMAN, ["guard"]).twist, ork: measure("longsword", ORK, ["guard"]).twist };
  console.log(`solved supination: human ${solved.human.toFixed(3)} rad, ork ${solved.ork.toFixed(3)} rad (pronation ${GRIP_SUPINATION})`);
  assert(Math.abs(solved.human - GRIP_SUPINATION) < 0.25 && solved.ork >= solved.human - 0.05, "the solve refines the pronation, the abducted ork arm needs at least as much");
  console.log(`longsword guard elevation: supinated ${withT.elevation.toFixed(1)}°, bare forearm ${without.elevation.toFixed(1)}°`);
  assert(withT.elevation >= 70, `supinated guard stands up (${withT.elevation.toFixed(1)}°)`);
  assert(without.elevation < withT.elevation - 15, "without the twist the blade leans across the body");
  // Both keep the handle in the palm: the twist turns the whole hand, not the handle inside it.
  assert(Math.abs(withT.handleToFingers - without.handleToFingers) < 1, "the hand mapping is unchanged by the twist");
});
