import { armChainPose, palmIsUp, solveElbow, weaponFromPalm } from "../src/game/PalmWeapon.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }
function near(a: number, b: number, eps = 1e-3, m = ""): void { if (Math.abs(a - b) > eps) throw new Error(`${m} expected ~${b}, got ${a}`); }

Deno.test("a palm facing up makes the weapon vertical", () => {
  // Palm normal straight up, forearm forward: the weapon tip must point up.
  const { tip } = weaponFromPalm({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 });
  near(tip.y, 1, 1e-3, "palm up -> weapon vertical");
  assert(palmIsUp({ x: 0, y: 1, z: 0 }), "a straight-up palm is up");
});

Deno.test("tilting the palm tilts the weapon by the same rotation", () => {
  const up = weaponFromPalm({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }).tip;
  const tilted = weaponFromPalm({ x: 1, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }).tip; // palm tipped toward +x
  assert(Math.abs(up.y - tilted.y) > 0.1, "the weapon follows the palm off vertical");
  // A down-facing palm puts the weapon down, not up.
  const down = weaponFromPalm({ x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }).tip;
  assert(down.y < 0, "palm down -> weapon down");
});

Deno.test("the weapon tip is a unit vector along the palm normal", () => {
  const n = { x: 0.3, y: 0.9, z: 0.2 };
  const { tip } = weaponFromPalm(n, { x: 0, y: 0, z: 1 });
  // The tip is a unit vector pointing the same way as the palm normal.
  const nl = Math.hypot(n.x, n.y, n.z);
  near(tip.x, n.x / nl, 1e-3, "tip.x tracks the palm normal");
  near(tip.y, n.y / nl, 1e-3, "tip.y tracks the palm normal");
  near(tip.z, n.z / nl, 1e-3, "tip.z tracks the palm normal");
  near(Math.hypot(tip.x, tip.y, tip.z), 1, 1e-3, "the tip is a unit vector");
});

Deno.test("two-point IK finds an elbow for a reachable palm and none for an unreachable one", () => {
  const shoulder = { x: 0, y: 1.5, z: 0 };
  const reachable = { x: 0.3, y: 1.4, z: 0.3 };
  const elbow = solveElbow(shoulder, reachable, { x: 0, y: -1, z: 0 });
  assert(elbow !== null, "a palm within reach has an elbow");
  // The elbow must be upper-arm length from the shoulder.
  const du = Math.hypot(elbow!.x - shoulder.x, elbow!.y - shoulder.y, elbow!.z - shoulder.z);
  near(du, 0.46, 1e-3, "elbow is one upper-arm length from the shoulder");
  const tooFar = solveElbow(shoulder, { x: 3, y: 1.5, z: 0 }, { x: 0, y: -1, z: 0 });
  assert(tooFar === null, "an out-of-reach palm has no solution");
});

Deno.test("the arm chain straightens the elbow as the target moves further", () => {
  const nearPose = armChainPose({ x: 0.2, y: -0.2, z: 0.2 });
  const farPose = armChainPose({ x: 0.6, y: -0.1, z: 0.6 });
  assert(farPose.elbowBend <= nearPose.elbowBend, "a further target straightens the elbow");
});
