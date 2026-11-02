// Lane X2: the plain-attack swing curves and the swing runtime (pure: src/game/anim/Swing.ts,
// src/combat/SwingDriver.ts) and the Animator's swing-driven attack layer.
import {
  AIM_PATTERN, aimYawForLine, armGeometry, armIK, bladePoint, CONTACT_HOLD, engageDistance, GUARD_KEY, gripPitchFor,
  newSwingSample, sampleSwing, STEP_BACK, STEP_MAX, stepInFor, strikeKeyAt, SWING_SHAPES, swingDuration, swingKindOf,
  SwingPlayer, swingPose, swingTiming, swingWindow, sweetDistance, TORSO_BAND,
} from "../src/game/anim/Swing.ts";
import { SwingDriver, swingSetupFor, weaponTip } from "../src/combat/SwingDriver.ts";
import { preferredGrip, weaponFromSeed } from "../src/game/weapons/Generate.ts";
import { profileTerms } from "../src/game/weapons/Profile.ts";
import { defaultHumanoid } from "../src/game/Skeleton.ts";
import { JOINT_INDEX, limitTableFrom } from "../src/game/anim/Rig.ts";
import { Animator, type AnimatorInput } from "../src/game/anim/Animator.ts";
import { legacyLegGeometryFor } from "../src/game/anim/LegacyGeometry.ts";
import type { ArchetypeId } from "../src/combat/contracts.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }
function assertEquals<T>(a: T, b: T, m = ""): void { if (a !== b) throw new Error(`${m} expected ${String(b)}, got ${String(a)}`); }
function assertAlmostEquals(a: number, b: number, tol: number, m = ""): void {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} ± ${tol}, got ${a}`);
}

/** A human-sized arm (lane A human 1.70 m: shoulder (−0.18, 1.36), elbow 0.31 m below, grip 0.36 m on). */
const ARM = armGeometry([-0.18, 1.36, -0.01], [-0.28, 1.07, -0.01], [-0.27, 0.72, 0.08]);
const LIM = limitTableFrom(defaultHumanoid().limits());

Deno.test("swing kind is derived from the weapon's damage mix and class", () => {
  const kind = (id: ArchetypeId) => {
    const s = weaponFromSeed(id, 7);
    return swingKindOf(profileTerms(s, preferredGrip(s)).mix, s.weaponClass, s.hands);
  };
  assertEquals(kind("longsword"), "slash");
  assertEquals(kind("sabre"), "slash");
  assertEquals(kind("axe"), "slash");
  assertEquals(kind("spear"), "thrust");
  assertEquals(kind("rapier"), "thrust");
  assertEquals(kind("dagger"), "thrust"); // reverse grip: 0.85 thrust
  assertEquals(kind("warhammer"), "chop");
  assertEquals(kind("maul"), "chop");
  assertEquals(kind("greataxe"), "chop");
});

Deno.test("a swing starts and ends at the guard key, eases in and out, and stays inside the joint limits", () => {
  for (const shape of Object.values(SWING_SHAPES)) {
    const t = swingTiming(0.2, 1);
    const s = newSwingSample();
    sampleSwing(shape, t, 0, s, ARM);
    assertAlmostEquals(s.shoulder, GUARD_KEY.shoulder, 1e-9);
    assertAlmostEquals(s.blade, GUARD_KEY.blade, 1e-9);
    assertEquals(s.weight, 0);
    sampleSwing(shape, t, swingDuration(t), s, ARM);
    assertAlmostEquals(s.elbow, GUARD_KEY.elbow, 1e-9);
    assertEquals(s.weight, 0);
    // No pops: at 240 Hz no DOF jumps more than its peak speed allows (≤ 0.2 rad per 1/240 s).
    const prev = newSwingSample();
    sampleSwing(shape, t, 0, prev, ARM);
    const pose = new Float64Array(LIM.rest.length);
    for (let c = 1 / 240; c <= swingDuration(t); c += 1 / 240) {
      sampleSwing(shape, t, c, s, ARM);
      for (const k of ["shoulder", "elbow", "blade", "lean", "twist", "roll"] as const) {
        assert(Math.abs(s[k] - prev[k]) < 0.2, `${shape.kind} ${k} jumps ${Math.abs(s[k] - prev[k]).toFixed(3)} at ${c.toFixed(3)} s`);
      }
      swingPose(s, true, LIM, pose);
      for (let j = 0; j < pose.length; j++) assert(pose[j] >= LIM.min[j] - 1e-9 && pose[j] <= LIM.max[j] + 1e-9, "joint limits");
      Object.assign(prev, s);
    }
  }
});

Deno.test("mid-strike the blade reaches forward through the torso band (not over or behind the body)", () => {
  for (const shape of Object.values(SWING_SHAPES)) {
    let forwardInBand = -Infinity;
    const k = { ...GUARD_KEY };
    for (let i = 0; i <= 40; i++) {
      strikeKeyAt(shape, ARM, i / 40, k);
      const p = bladePoint(ARM, k, 0.72 * 0.85);
      if (p[1] >= TORSO_BAND[0] && p[1] <= TORSO_BAND[1]) forwardInBand = Math.max(forwardInBand, p[0]);
    }
    assert(forwardInBand > 0.9, `${shape.kind}: sweet spot reaches only ${forwardInBand.toFixed(2)} m forward in the torso band`);
    // The old plain attack (ATTACK_POSE shoulder −1.7, elbow −0.3, spine −0.2, engine grip pitch 0:
    // world blade angle = lean + shoulder + elbow + grip = −2.2) had its sweet spot BEHIND the body.
    const old = bladePoint(ARM, { shoulder: -1.7, elbow: -0.3, blade: -0.2 - 1.7 - 0.3 + 0, roll: 0, lean: -0.2, twist: 0 }, 0.6);
    assert(old[0] < forwardInBand - 0.5, "the new strike reaches at least 0.5 m farther than the old pose");
  }
});

Deno.test("thrust: the hand travels a straight line (arm IK) and the point stays level", () => {
  const sh = SWING_SHAPES.thrust, k = { ...GUARD_KEY };
  const pts: [number, number][] = [];
  for (let i = 0; i <= 10; i++) { strikeKeyAt(sh, ARM, i / 10, k); pts.push(bladePoint(ARM, k, 0)); }
  const [a, b] = [pts[0], pts[10]];
  for (const p of pts) {
    // Distance from the chord a-b, m.
    const cross = Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
    assert(cross < 0.012, `hand ${cross.toFixed(3)} m off the straight line`);
    strikeKeyAt(sh, ARM, 0.5, k);
    assert(Math.abs(k.blade - Math.PI / 2) < 0.1, "point level within 0.1 rad");
  }
  assert(b[0] - a[0] > 0.35, `hand drives ${(b[0] - a[0]).toFixed(2)} m forward`);
});

Deno.test("arm IK round-trips through forward kinematics", () => {
  const out = { shoulder: 0, elbow: 0 };
  for (const [f, u] of [[0.3, -0.2], [0.6, -0.1], [0.2, -0.45], [0.5, 0.2]] as [number, number][]) {
    armIK(ARM, f, u, out);
    const p = bladePoint(ARM, { ...GUARD_KEY, shoulder: out.shoulder, elbow: out.elbow, lean: 0 }, 0);
    assertAlmostEquals(p[0], f, 1e-6);
    assertAlmostEquals(p[1], u, 1e-6);
    assert(out.elbow <= 0, "elbow flexes, never hyperextends");
  }
});

Deno.test("grip pitch holds the world blade angle: β = lean + shoulder + elbow + grip (reverse adds π)", () => {
  assertAlmostEquals(0.2 + -1.3 + -0.4 + gripPitchFor(1.5, 0.2, -1.3, -0.4, false), 1.5, 1e-12);
  assertAlmostEquals(gripPitchFor(1.5, 0.2, -1.3, -0.4, true), gripPitchFor(1.5, 0.2, -1.3, -0.4, false) - Math.PI, 1e-12);
});

Deno.test("timing: the strike keeps the weapon's speed; windup and recover give way to the cooldown", () => {
  const free = swingTiming(0.2, 10);
  assertAlmostEquals(free.strike, 0.2, 1e-12);
  const tight = swingTiming(0.2, 0.5);
  assertAlmostEquals(tight.strike, 0.2, 1e-12);
  assert(swingDuration(tight) <= 0.9 * 0.5 + 1e-9, "fits 90 % of the cooldown");
  const w = swingWindow(tight);
  assert(w.start < tight.windup && w.end > tight.windup + tight.strike, "window spans the strike");
});

Deno.test("step closes the gap to the sweet distance, a half step back when too close; engage ≥ sweet", () => {
  assertEquals(stepInFor(1.6, 1.4), 1.6 - 1.4);
  assertEquals(stepInFor(5, 1.4), STEP_MAX);
  assertEquals(stepInFor(0.5, 1.4), -STEP_BACK);
  const sweet = sweetDistance(SWING_SHAPES.slash, ARM, 0.85);
  assert(sweet > 1.1 && sweet < 1.8, `sweet ${sweet}`);
  assert(engageDistance(sweet) > sweet && engageDistance(sweet) < sweet + STEP_MAX);
});

Deno.test("aim yaw puts the blade line on the aim point (parallel line: asin(offset / D))", () => {
  assertAlmostEquals(aimYawForLine([-0.18, 0.3, -0.18, 1.2], 1.5), Math.asin(0.18 / 1.5), 1e-6);
  // A converging line already pointing at the centre needs no aim.
  assertAlmostEquals(aimYawForLine([-0.2, 0.5, 0, 1.5], 1.5), 0, 1e-6);
  // Aiming 0.17 m to the holder's right needs less turn than the centre.
  assert(aimYawForLine([-0.18, 0.3, -0.18, 1.2], 1.5, -0.17) < aimYawForLine([-0.18, 0.3, -0.18, 1.2], 1.5));
  assertEquals(AIM_PATTERN[0], 1);
});

Deno.test("a contact freezes the swing for CONTACT_HOLD, then it recovers to guard; no second strike", () => {
  const p = new SwingPlayer(), s = newSwingSample(), at = newSwingSample();
  const t = swingTiming(0.2, 1);
  p.begin(SWING_SHAPES.slash, t, 0.3, 0.1, false, ARM);
  while (p.clock < t.windup + 0.4 * t.strike) p.advance(1 / 60);
  assert(p.striking());
  const c = p.freeze(0.5);
  assert(c > p.prevClock - 1e-12 && !p.striking(), "frozen: no more strikes this swing");
  sampleSwing(SWING_SHAPES.slash, t, c, at, ARM);
  for (let i = 0; i < Math.floor(CONTACT_HOLD * 60) - 1; i++) {
    p.advance(1 / 60);
    p.sample(s);
    assertAlmostEquals(s.blade, at.blade, 1e-12);
    assertAlmostEquals(s.shoulder, at.shoulder, 1e-12);
  }
  let frames = 0;
  while (p.advance(1 / 60)) frames++;
  assert(frames <= Math.ceil((CONTACT_HOLD + t.recover) * 60) + 1, "ends after hold + recover");
  p.sample(s);
  assertAlmostEquals(s.shoulder, GUARD_KEY.shoulder, 1e-6);
});

Deno.test("SwingDriver: the step adds up to the planned distance; grip blends from the carry grip", () => {
  const spec = weaponFromSeed("longsword", 7);
  const setup = swingSetupFor(spec, ARM);
  assert(weaponTip(spec) > 0.7, "longsword tip > 0.7 m");
  const d = new SwingDriver(setup, LIM);
  const carry = d.wristPitch(0.1, -1, -1.45); // lane G: the WANTED wrist; gripPitch maps it into the hand
  assertAlmostEquals(carry, gripPitchFor(GUARD_KEY.blade, 0.1, -1, -1.45, false), 1e-12);
  d.begin(setup.sweet + 0.4, 1);
  let stepped = 0;
  while (d.active) { d.advance(1 / 60); stepped += d.takeStep(); }
  assertAlmostEquals(stepped, 0.4, 1e-9);
  assertEquals(d.attackPose(), null);
});

Deno.test("Animator: a swing pose drives the attack layer exactly once its weight is in (no pop-guard lag)", () => {
  const sk = defaultHumanoid(), lim = limitTableFrom(sk.limits());
  const an = new Animator(legacyLegGeometryFor("human", null, 1.75, 75), lim);
  const pose = swingPose({ ...GUARD_KEY, shoulder: -1.9, elbow: -0.4 }, false, lim, new Float64Array(lim.rest.length));
  const inp: AnimatorInput = {
    x: 0, z: 0, yaw: 0, speed: 0, moveDirLocal: 0, turnRate: 0, grounded: true, hit: false, attack: true, attackPose: pose,
    block: false, ko: false, engaged: true, skill: null, skillProgress: 0, groundHeight: () => 0,
  };
  let out = an.update(1 / 60, inp);
  for (let i = 0; i < 60; i++) out = an.update(1 / 60, inp);
  assertAlmostEquals(out.angles[JOINT_INDEX.shoulderR], -1.9, 0.02);
  assertAlmostEquals(out.angles[JOINT_INDEX.elbowR], -0.4, 0.02);
});
