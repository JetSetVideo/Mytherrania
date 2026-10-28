import { groundForward, lambdaForRiseTime, stepVelocity, worldDirection, type GroundDir } from "../src/input/MoveFrame.ts";

function near(a: number, b: number, eps = 1e-9, m = ""): void {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${m} expected ~${b}, got ${a}`);
}
function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const TUNING = { topSpeed: 6, riseTime: 0.12 };
const FLAT = { surfaceSpeed: 1, surfaceSlip: 1, speedMultiplier: 1, responsiveness: 1, canMove: true };

Deno.test("forward walks along the camera's ground heading, right is forward x up", () => {
  // Camera looking down +x (toward an opponent at +x): forward must be +x, right +z.
  const f = groundForward(1, 0, { x: 0, z: -1 });
  const fwd = worldDirection({ forward: 1, strafe: 0 }, f);
  near(fwd.x, 1); near(fwd.z, 0);
  const right = worldDirection({ forward: 0, strafe: 1 }, f);
  near(right.x, 0, 1e-12); near(right.z, 1, 1e-12, "right of +x is +z in three.js (y up)");
  const back = worldDirection({ forward: -1, strafe: 0 }, f);
  near(back.x, -1, 1e-12, "back is the opposite of forward");
});

Deno.test("a straight-down camera falls back to the given heading", () => {
  const f = groundForward(0, 0, { x: 0, z: -1 });
  near(f.z, -1);
});

Deno.test("diagonals are clamped to unit speed", () => {
  const d = worldDirection({ forward: 1, strafe: 1 }, { x: 1, z: 0 });
  near(Math.hypot(d.x, d.z), 1, 1e-12);
});

Deno.test("velocity reaches 95% of top speed at the rise time, from any frame rate", () => {
  for (const hz of [30, 60, 144]) {
    const v: GroundDir = { x: 0, z: 0 };
    const steps = Math.round(TUNING.riseTime * hz);
    for (let i = 0; i < steps; i++) stepVelocity(v, { x: 1, z: 0 }, TUNING, FLAT, 1 / hz);
    near(v.x / TUNING.topSpeed, 0.95, 0.02, `${hz} Hz`);
  }
  near(lambdaForRiseTime(1), Math.log(20), 1e-12);
});

Deno.test("ice (slip > 1) responds slower, stun stops the walk, release comes to an exact stop", () => {
  const stone: GroundDir = { x: 0, z: 0 }, ice: GroundDir = { x: 0, z: 0 };
  for (let i = 0; i < 6; i++) {
    stepVelocity(stone, { x: 1, z: 0 }, TUNING, FLAT, 1 / 60);
    stepVelocity(ice, { x: 1, z: 0 }, TUNING, { ...FLAT, surfaceSlip: 3 }, 1 / 60);
  }
  assert(ice.x < stone.x, "ice accelerates slower");
  const stunned: GroundDir = { x: 5, z: 0 };
  for (let i = 0; i < 120; i++) stepVelocity(stunned, { x: 1, z: 0 }, TUNING, { ...FLAT, canMove: false }, 1 / 60);
  near(stunned.x, 0, 1e-3, "a stunned fighter's walk decays to 0");
  const idle: GroundDir = { x: 3, z: 0 };
  for (let i = 0; i < 240; i++) stepVelocity(idle, { x: 0, z: 0 }, TUNING, FLAT, 1 / 60);
  assert(idle.x === 0 && idle.z === 0, "released input comes to an exact stop");
});
