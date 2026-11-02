// Wave W lane T: at guard the handle lies ACROSS the palm. GUARD_POSE's weapon forearm used to stand 46°
// from vertical, so an upright blade needed the wrist's whole ulnar range and the handle sat at the carry
// band's edge, 47° to the fingers, on every archetype (wave V lane G). The guard forearm now runs ~10°
// below the horizontal: the hammer grip already stands the blade, the wrist turns a few degrees. Pins, on
// lane A's real rig (tests/wave_w_twohand_fixture.ts): 70-90° handle to fingers for all 17 archetypes on
// a human, an ork and a dwarf, the carry rule (blades up/out, the dagger reversed, the bow upright), and
// the forearm angle the guard key encodes.
import { ARCHETYPE_IDS } from "../src/game/weapons/Archetypes.ts";
import { DWARF, HUMAN, measureAll, ORK } from "./wave_w_twohand_fixture.ts";
import { GUARD_KEY } from "../src/game/anim/Swing.ts";
import { GUARD_POSE } from "../src/game/anim/Poses.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

Deno.test("guard: the handle crosses the palm at 70-90° to the fingers for every archetype (human, ork, dwarf)", () => {
  const seen: string[] = [];
  for (const look of [HUMAN, ORK, DWARF]) {
    for (const id of ARCHETYPE_IDS) {
      const [g] = measureAll(id, null, look, ["guard"]);
      seen.push(`${look.race} ${id} ${g.grip.handleToFingers.toFixed(1)}° elev ${g.grip.elevation.toFixed(0)}°`);
      assert(g.grip.handleToFingers >= 70 && g.grip.handleToFingers <= 90, `${look.race} ${id}: handle ${g.grip.handleToFingers.toFixed(1)}° to the fingers`);
      assert(g.grip.through && g.grip.outOfPalmPlane < 5, `${look.race} ${id}: through the fist, in the palm plane`);
      assert(g.rule.ok, `${look.race} ${id}: ${g.rule.why.join("; ")}`);
    }
  }
  console.log(seen.filter((l) => l.startsWith("human")).join("\n"));
});

Deno.test("guard: the weapon forearm runs just below the horizontal (the guard key the swings start from)", () => {
  // Forearm direction in the arm plane, from up: π + λ + θs + θe (Swing.ts vocabulary); π/2 = level.
  const fore = Math.PI + GUARD_KEY.lean + GUARD_KEY.shoulder + GUARD_KEY.elbow;
  const deg = (fore - Math.PI / 2) * 180 / Math.PI;
  assert(deg > 0 && deg < 20, `guard forearm ${deg.toFixed(1)}° below the horizontal`);
  // The hammer grip (handle ⊥ forearm) is then within 20° of the wanted carry blade: the wrist barely turns.
  const hammerBlade = fore - Math.PI / 2;
  assert(Math.abs(GUARD_KEY.blade - hammerBlade) < 20 * Math.PI / 180, "the carry blade is near the hammer grip");
  // The key IS the Animator's guard pose (no pop between the guard layer and a swing's first frame).
  assert(GUARD_KEY.shoulder === GUARD_POSE.shoulderR && GUARD_KEY.elbow === GUARD_POSE.elbowR && GUARD_KEY.lean === GUARD_POSE.spine, "GUARD_KEY = GUARD_POSE");
});
