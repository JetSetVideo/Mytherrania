// Lane G (wave V): the weapon handle lies ACROSS the palm, through the fist, and every archetype is
// carried by its rule (GripStance.GRIP_RULES): the striking end up/outward, only a reverse dagger
// blade-down, a bow upright. Pure: the hand mapping (PalmWeapon.gripEuler) and the carry rules
// through the swing keys (SwingDriver), on a planar model of the supinated forearm.
import {
  axisOfEuler, clampWristPitch, eulerForAxis, GRIP_NEUTRAL, GRIP_SUPINATION_DEFAULT, gripEuler, handleDirection, PLAIN_HAND, type V3t, wristDeviation,
} from "../src/game/PalmWeapon.ts";
import { checkOrientation, GRIP_RULES, gripRuleOf, HAMMER_BAND } from "../src/game/GripStance.ts";
import { ARCHETYPE_IDS, ARCHETYPES } from "../src/game/weapons/Archetypes.ts";
import { preferredGrip, weaponFromSeed } from "../src/game/weapons/Generate.ts";
import { SwingDriver, swingSetupFor } from "../src/combat/SwingDriver.ts";
import { armGeometry, GUARD_KEY } from "../src/game/anim/Swing.ts";
import { defaultHumanoid } from "../src/game/Skeleton.ts";
import { limitTableFrom } from "../src/game/anim/Rig.ts";
import { HAND_PRONATION } from "../src/graphics/body/AnatomyParts.ts";
import { rng32 } from "../src/core/MathCore.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }
function assertEquals<T>(a: T, b: T, m = ""): void { if (a !== b) throw new Error(`${m} expected ${String(b)}, got ${String(a)}`); }
function assertAlmostEquals(a: number, b: number, tol: number, m = ""): void { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ~${b}, got ${a}`); }
const dot = (a: V3t, b: V3t) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const deg = (r: number) => r * 180 / Math.PI;
/** The rig's right hand in its grip mount (no abduction): fingers down, thumb turned in by the pronation. */
const P = HAND_PRONATION;
const HAND: [V3t, V3t, V3t] = [[0, -1, 0], [-Math.cos(P), 0, Math.sin(P)], [Math.sin(P), 0, Math.cos(P)]];

Deno.test("grip: the handle stays in the palm plane, across the fingers, for any wanted wrist (fuzzed)", () => {
  const rnd = rng32(91);
  for (let i = 0; i < 2000; i++) {
    const pitch = -8 + 16 * rnd(), roll = -2 + 4 * rnd();
    for (const hand of [HAND, PLAIN_HAND]) {
      const y = handleDirection(hand, pitch, roll, HAMMER_BAND);
      assertAlmostEquals(Math.hypot(...y), 1, 1e-9);
      const across = deg(Math.acos(Math.min(1, Math.abs(dot(y, hand[0])))));
      // Across the fingers: 90° minus the deviation, never past the band (+ the twist's share).
      assert(across >= 90 - deg(HAMMER_BAND.ulnar) - 1e-6, `across ${across.toFixed(1)}° at pitch ${pitch.toFixed(2)}`);
      // Out of the palm plane only by the forearm twist, never more than its bound.
      assert(deg(Math.asin(Math.min(1, Math.abs(dot(y, hand[1]))))) <= deg(HAMMER_BAND.roll) + 1e-6, "out of the palm plane");
      assert(dot(y, hand[2]) > 0, "the handle's +y leaves the thumb side");
    }
  }
});

Deno.test("grip: the pure default supination is the anatomy's hand pronation", () => {
  assertEquals(GRIP_SUPINATION_DEFAULT, HAND_PRONATION);
});

Deno.test("grip: the neutral hammer grip lays the handle exactly along the thumb axis w", () => {
  const y = handleDirection(HAND, GRIP_NEUTRAL, 0, HAMMER_BAND);
  for (let k = 0; k < 3; k++) assertAlmostEquals(y[k], HAND[2][k], 1e-12);
  assertEquals(wristDeviation(GRIP_NEUTRAL + 5, HAMMER_BAND), HAMMER_BAND.ulnar);
  assertEquals(wristDeviation(GRIP_NEUTRAL - 5, HAMMER_BAND), -HAMMER_BAND.radial);
  assertEquals(wristDeviation(Number.NaN, HAMMER_BAND), 0);
  assertAlmostEquals(clampWristPitch(2.7, HAMMER_BAND), GRIP_NEUTRAL + HAMMER_BAND.ulnar, 1e-12);
});

Deno.test("grip: Euler round trip, and a plain hand reproduces the old pitch inside the band", () => {
  const rnd = rng32(5);
  for (let i = 0; i < 500; i++) {
    const a = -3 + 6 * rnd(), c = -1.4 + 2.8 * rnd();
    const u = axisOfEuler(a, c), e = eulerForAxis(u), v = axisOfEuler(e[0], e[1]);
    for (let k = 0; k < 3; k++) assertAlmostEquals(u[k], v[k], 1e-9);
  }
  for (let p = GRIP_NEUTRAL - HAMMER_BAND.radial; p <= GRIP_NEUTRAL + HAMMER_BAND.ulnar; p += 0.05) {
    const e = gripEuler(PLAIN_HAND, p, 0, HAMMER_BAND);
    assertAlmostEquals(e[0], p, 1e-9);
    assertAlmostEquals(e[1], 0, 1e-9);
  }
});

Deno.test("rules: every archetype has a carry rule; only daggers may be held reverse", () => {
  for (const id of ARCHETYPE_IDS) {
    const r = GRIP_RULES[id];
    assert(r, `rule for ${id}`);
    assertEquals(r.reverseAllowed, id === "dagger", `${id} reverse`);
    assertEquals(r.carry, id === "dagger" ? "reverse-down" : id === "bow" ? "upright-bow" : "up-out", `${id} carry`);
    // A weapon whose grips list the reverse mode must be allowed it (the mesh flips by preferredGrip).
    if (ARCHETYPES[id].grips.some((g) => g.modes.includes("reverse"))) assert(r.reverseAllowed, `${id} lists reverse`);
    const spec = weaponFromSeed(id, 3), setup = swingSetupFor(spec, ARM);
    assertEquals(setup.reverse, id === "dagger" && preferredGrip(spec) === "reverse", `${id} setup.reverse`);
  }
  assertEquals(gripRuleOf("nonsense").carry, "up-out");
  // A spec that claims "reverse" for a non-dagger is held forward anyway.
  const axe = weaponFromSeed("axe", 3);
  const forged = { ...axe, grips: axe.grips.map((g) => ({ ...g, modes: ["reverse" as const, "forward" as const] })) };
  assertEquals(swingSetupFor(forged, ARM).reverse, false);
});

const ARM = armGeometry([-0.2, 1.45, -0.05], [-0.2, 1.17, -0.05], [-0.2, 0.86, -0.05]);
const LIM = limitTableFrom(defaultHumanoid().limits());

/**
 * World direction of the blade (grip -> striking end) on the planar rig: the forearm at
 * φ = π + λ + θs + θe (Rx(φ − π) from hanging), supinated by the pronation (lane G's forearm twist),
 * the handle from the hand mapping, a reverse grip turned by π. Returns [elevation°, forward share].
 */
function bladeOf(drv: SwingDriver, lean: number, shoulder: number, elbow: number): { elev: number; fwd: number; acrossDeg: number } {
  drv.setup.hand = HAND;
  const y = handleDirection(HAND, drv.wristPitch(lean, shoulder, elbow), drv.wristRoll(), drv.wristBand());
  // Supination about d = (0, -1, 0) by +P: Rodrigues.
  const d: V3t = [0, -1, 0], c = Math.cos(P), s = Math.sin(P), k = dot(d, y);
  const dx: V3t = [d[1] * y[2] - d[2] * y[1], d[2] * y[0] - d[0] * y[2], d[0] * y[1] - d[1] * y[0]];
  const t: V3t = [y[0] * c + dx[0] * s + d[0] * k * (1 - c), y[1] * c + dx[1] * s + d[1] * k * (1 - c), y[2] * c + dx[2] * s + d[2] * k * (1 - c)];
  const a = lean + shoulder + elbow, ca = Math.cos(a), sa = Math.sin(a);
  const b: V3t = [t[0], t[1] * ca - t[2] * sa, t[1] * sa + t[2] * ca];
  const sign = drv.setup.reverse ? -1 : 1;
  return { elev: deg(Math.asin(sign * b[1])), fwd: sign * b[2], acrossDeg: deg(Math.acos(Math.min(1, Math.abs(dot(y, HAND[0]))))) };
}

Deno.test("rules: the carry holds at guard and the swing never turns the end down into the holder", () => {
  for (const id of ARCHETYPE_IDS) {
    const spec = weaponFromSeed(id, 7), setup = swingSetupFor(spec, ARM), drv = new SwingDriver(setup, LIM), rule = GRIP_RULES[id];
    const g = bladeOf(drv, GUARD_KEY.lean, GUARD_KEY.shoulder, GUARD_KEY.elbow);
    if (rule.carry === "reverse-down") assert(g.elev <= -60, `${id} guard blade down: ${g.elev.toFixed(0)}°`);
    else assert(g.elev >= Math.max(60, rule.minGuardElevation), `${id} guard end up: ${g.elev.toFixed(0)}°`);
    assert(g.acrossDeg >= 90 - deg(rule.band.ulnar) - 1e-6 && g.acrossDeg <= 90 + deg(rule.band.radial) + 1e-6, `${id} guard handle across the palm: ${g.acrossDeg.toFixed(0)}°`);
    drv.begin(setup.sweet, 0, 0);
    let frames = 0;
    while (drv.active && frames++ < 600) {
      drv.advance(1 / 60);
      const k = drv.sample, b = bladeOf(drv, k.lean, k.shoulder, k.elbow);
      // Never past the strike's snap band; back inside the carry band once the snap has closed.
      assert(b.acrossDeg >= 90 - deg(rule.strikeBand.ulnar) - 1e-6, `${id} handle across the palm (${b.acrossDeg.toFixed(0)}°)`);
      if (drv.wristSnap() === 0) assert(b.acrossDeg >= 90 - deg(rule.band.ulnar) - 1e-6, `${id} carry band (${b.acrossDeg.toFixed(0)}°)`);
      if (rule.carry !== "reverse-down") assert(!(b.elev < -30 && b.fwd < -0.2), `${id} end down-and-back at frame ${frames}: ${b.elev.toFixed(0)}°`);
      if (rule.carry === "upright-bow") assert(b.elev >= 60, `${id} bow limbs stay upright: ${b.elev.toFixed(0)}°`);
    }
  }
});

Deno.test("rules: checkOrientation flags each failure it names", () => {
  const ok = { handleToFingers: 80, outOfPalmPlane: 3, side: 1 as const, lineToPalmMm: 20, lineToGripAnchorMm: 0, gripToPalmMm: 30, through: true, elevation: 70, outward: 0.1, forward: 0.2, edgeForward: 0.5, bodyClearMm: 500, offHandGapMm: null };
  assert(checkOrientation(GRIP_RULES.axe, "guard", ok).ok);
  assert(!checkOrientation(GRIP_RULES.axe, "guard", { ...ok, through: false }).ok);
  assert(!checkOrientation(GRIP_RULES.axe, "guard", { ...ok, elevation: -40 }).ok, "axe head down at guard");
  assert(!checkOrientation(GRIP_RULES.axe, "guard", { ...ok, side: -1 }).ok, "axe reversed");
  assert(checkOrientation(GRIP_RULES.dagger, "guard", { ...ok, side: -1, elevation: -70 }).ok, "reverse dagger");
  assert(!checkOrientation(GRIP_RULES.dagger, "guard", { ...ok, side: -1, elevation: 10 }).ok);
  assert(!checkOrientation(GRIP_RULES.bow, "guard", { ...ok, elevation: 80, edgeForward: -0.5 }).ok, "bow string away");
  assert(!checkOrientation(GRIP_RULES.mace, "contact", { ...ok, elevation: -50, forward: -0.6 }).ok, "into the holder");
  assert(!checkOrientation(GRIP_RULES.mace, "contact", { ...ok, bodyClearMm: 40 }).ok, "blade through the body axis");
  assert(checkOrientation(GRIP_RULES.mace, "contact", { ...ok, elevation: -20, forward: 0.8 }).ok, "a chop may land forward-down");
});
