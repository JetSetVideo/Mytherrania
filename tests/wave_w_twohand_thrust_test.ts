// Wave W lane T: thrusts drive the point AT the target. On lane A's real rig in the engine's frame order
// (tests/wave_w_twohand_fixture.ts, the engine's lane M style), at the styled contact instant: the
// striking end's elevation (grip -> tip) within ±10° of the line from the grip to the target's torso
// centre (the same body standing at the swing's sweet distance), the hand inside lane G's wrist bands —
// spear, rapier and the reverse-grip dagger, on a human, an ork and a dwarf. The control is the wave-V
// hand path (forearm level: tip 24-27° above the line; the dagger's point 60° below it).
import { bench, DWARF, HUMAN, measureBeat, ORK, THRUSTERS } from "./wave_w_twohand_fixture.ts";
import { handPoint, REVERSE_THRUST, SWING_SHAPES, type SwingShape } from "../src/game/anim/Swing.ts";
import { GRIP_RULES } from "../src/game/GripStance.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

/** The deliverable's bound on the point's aim at the contact, degrees. */
const AIM_DEG = 10;
/** Wave V's thrust (Swing.ts before lane T): the hand on a level line, written in metres. */
const WAVE_V_THRUST: SwingShape = { ...SWING_SHAPES.thrust, hand: { windup: [0.2, -0.3], strike: [0.64, -0.2] }, handRef: undefined };

Deno.test("thrust: the point is aimed at the target's torso at the contact (spear, rapier, reverse dagger × 3 bodies)", () => {
  const lines: string[] = [];
  for (const look of [HUMAN, ORK, DWARF]) {
    for (const id of THRUSTERS) {
      const b = bench(id, look);
      const s = measureBeat(b, "contact", null), h = measureBeat(b, "hold", null);
      lines.push(`${look.race.padEnd(5)} ${id.padEnd(7)} contact tip ${s.tipElev.toFixed(1)}° line ${s.lineElev.toFixed(1)}° err ${s.aimErr.toFixed(1)}° | hold err ${h.aimErr.toFixed(1)}° | fingers ${s.grip.handleToFingers.toFixed(0)}°`);
      for (const x of [s, h]) {
        assert(Math.abs(x.aimErr) <= AIM_DEG, `${look.race} ${id} ${x.beat}: point ${x.aimErr.toFixed(1)}° off the line to the torso`);
        assert(x.rule.ok && x.grip.through, `${look.race} ${id} ${x.beat}: ${x.rule.why.join("; ")}`);
        // Inside the strike's wrist band (lane G: handle 30..110° to the fingers), measured slack 1°.
        const band = GRIP_RULES[id].strikeBand;
        assert(x.grip.handleToFingers >= 90 - band.ulnar * 180 / Math.PI - 1 && x.grip.handleToFingers <= 90 + band.radial * 180 / Math.PI + 1, `${id}: ${x.grip.handleToFingers.toFixed(1)}° to the fingers`);
      }
      // The reverse dagger stabs DOWN onto the chest; the forward thrusts come in near level.
      if (id === "dagger") assert(s.tipElev < -25, `dagger stabs down (${s.tipElev.toFixed(0)}°)`);
      else assert(Math.abs(s.tipElev) < 20, `${id} near level (${s.tipElev.toFixed(0)}°)`);
    }
  }
  console.log(lines.join("\n"));
});

Deno.test("thrust: the control — wave V's level-forearm path points the tip > 20° above the line (spear, rapier, human)", () => {
  for (const id of ["spear", "rapier"] as const) {
    const s = measureBeat(bench(id, HUMAN, WAVE_V_THRUST), "contact", null);
    console.log(`control ${id}: tip ${s.tipElev.toFixed(1)}° line ${s.lineElev.toFixed(1)}° err ${s.aimErr.toFixed(1)}°`);
    assert(s.aimErr > 20, `${id}: the old path should point up (${s.aimErr.toFixed(1)}°)`);
  }
  const d = measureBeat(bench("dagger", HUMAN, WAVE_V_THRUST), "contact", null);
  assert(d.aimErr < -40, `reverse dagger on the old path points at the floor (${d.aimErr.toFixed(1)}°)`);
});

Deno.test("thrust: hand paths scale with the arm's reach and the reverse grip stabs from above", () => {
  const arm = (r: number) => ({ upper: 0.47 * r, fore: 0.53 * r, shoulderHeight: 1.4, shoulderLateral: 0.2 });
  for (const r of [0.5, 0.66, 0.8]) {
    const s = handPoint(SWING_SHAPES.thrust, arm(r), "strike"), w = handPoint(SWING_SHAPES.thrust, arm(r), "windup");
    // The contact point keeps its direction (~37° below the horizontal) and its share of the reach.
    assert(Math.abs(Math.atan2(-s[1], s[0]) * 180 / Math.PI - 37) < 1, `strike direction at reach ${r}`);
    assert(Math.abs(Math.hypot(s[0], s[1]) / r - 0.968) < 0.01, `strike reach share at ${r}`);
    assert(s[0] - w[0] > 0.35 * r / 0.66 * 0.9, `the hand drives forward at reach ${r}`);
  }
  const rs = handPoint(REVERSE_THRUST, arm(0.66), "strike"), rw = handPoint(REVERSE_THRUST, arm(0.66), "windup");
  assert(rw[1] > rs[1] && rw[1] > 0.2, "the ice-pick cocks above the shoulder and comes down");
});
