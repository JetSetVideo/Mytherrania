import { analogVector, ApmTracker, movementStep, toCameraSpace, turnScale, TURN_MIN } from "../src/game/InputVector.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }
function near(a: number, b: number, eps = 1e-3, m = ""): void { if (Math.abs(a - b) > eps) throw new Error(`${m} expected ~${b}, got ${a}`); }

Deno.test("the keyboard drives the vector when no controller is active", () => {
  const v = analogVector({ keyX: 1, keyZ: 0, padX: null, padZ: null });
  near(v.x, 1, 1e-9); near(v.z, 0, 1e-9);
});

Deno.test("the controller stick wins when pushed past the dead zone", () => {
  const v = analogVector({ keyX: 1, keyZ: 0, padX: 0, padZ: -0.9 });
  near(v.z, -0.9, 1e-9, "stick forward wins");
  // Below the dead zone the keyboard is the fallback.
  const kb = analogVector({ keyX: 1, keyZ: 0, padX: 0.05, padZ: 0.05 });
  near(kb.x, 1, 1e-9, "small stick input is ignored");
});

Deno.test("diagonal input is clamped to the unit circle (no faster diagonal)", () => {
  const v = analogVector({ keyX: 1, keyZ: 1, padX: null, padZ: null });
  near(Math.hypot(v.x, v.z), 1, 1e-9, "clamped to unit length");
});

Deno.test("the vector rotates into camera space by the camera yaw", () => {
  // Facing -z (forward). With camYaw 0 the world vector matches the input.
  const fwd = toCameraSpace({ x: 0, z: -1 }, 0);
  near(fwd.x, 0, 1e-9); near(fwd.z, -1, 1e-9);
  // With the camera turned 90° (pi/2), "forward" maps onto +x.
  const turned = toCameraSpace({ x: 0, z: -1 }, Math.PI / 2);
  near(turned.x, 1, 1e-3, "camera-relative forward follows the yaw");
});

Deno.test("APM rises with activity and decays as the window slides", () => {
  const t = new ApmTracker();
  for (let i = 0; i < 60; i++) t.action(i * 0.1); // 600 apm burst
  assert(t.apm(6) > 300, `high activity -> high APM, got ${t.apm(6)}`);
  // 20s later the burst is outside the window.
  assert(t.apm(30) === 0, "the window slides and the burst expires");
});

Deno.test("turn radius tightens as APM climbs, bounded by TURN_MIN", () => {
  assert(turnScale(0) === 1, "at rest the turn is full width");
  const slow = turnScale(20);
  const fast = turnScale(240);
  assert(fast < slow, "faster play turns tighter");
  assert(turnScale(1e6) >= TURN_MIN - 1e-9, "bounded below by TURN_MIN");
  assert(turnScale(0) <= 1, "never above 1");
});

Deno.test("movementStep applies speed, dt, and the turn tightening", () => {
  const rest = movementStep({ keyX: 0, keyZ: -1, padX: null, padZ: null }, 0, 4, 1 / 60, 0);
  const apmHigh = movementStep({ keyX: 0, keyZ: -1, padX: null, padZ: null }, 0, 4, 1 / 60, 300);
  assert(Math.abs(rest.z) > Math.abs(apmHigh.z), "high APM reduces the per-frame step (tighter control)");
  near(Math.hypot(rest.x, rest.z), 4 * (1 / 60), 1e-3, "rest step = speed*dt");
});
