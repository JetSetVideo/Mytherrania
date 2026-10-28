import { GripSolver, GUARD_GRIP, REST_GRIP, stanceForTechnique, SWING_H_GRIP, THRUST_GRIP } from "../src/game/GripStance.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }

Deno.test("rest grip points the blade up, not at the ground", () => {
  assert(REST_GRIP.pitch < 0 && REST_GRIP.pitch > -1, "rest pitch is a shallow upward cant");
  assert(REST_GRIP.fist > 0.5, "the hand holds the weapon at rest");
});

Deno.test("thrust levels the blade onto the forward vector", () => {
  assert(THRUST_GRIP.pitch < -1.3, "thrust pitch is near-horizontal forward");
  assert(THRUST_GRIP.pitch !== REST_GRIP.pitch, "thrust differs from rest");
});

Deno.test("guard lifts the blade near-vertical (within ~10 deg of upright)", () => {
  assert(Math.abs(GUARD_GRIP.pitch) < 0.2, `guard pitch ${GUARD_GRIP.pitch} near-vertical`);
  assert(GUARD_GRIP.roll > 1, "guard turns the edge out");
});

Deno.test("a defense technique guards; a thrust payload thrusts", () => {
  assert(stanceForTechnique("defense", false, 0) === "guard", "defense -> guard");
  assert(stanceForTechnique("power", true, 0) === "thrust", "thrust payload -> thrust");
});

Deno.test("consecutive swings alternate the arc plane", () => {
  const a = stanceForTechnique("power", false, 0);
  const b = stanceForTechnique("power", false, 1);
  const c = stanceForTechnique("power", false, 2);
  assert(a !== b && b !== c, "swing direction rotates across planes");
  assert(stanceForTechnique("power", false, 3) === a, "the cycle repeats after three");
});

Deno.test("the solver eases toward the stance without snapping", () => {
  const g = new GripSolver();
  g.setStance("guard");
  const first = g.update(1 / 60);
  // After one frame it has moved toward guard but not arrived.
  assert(Math.abs(first.pitch - GUARD_GRIP.pitch) > 0.01, "eases, does not snap");
  assert(first.pitch > REST_GRIP.pitch, "moving from rest toward guard");
  for (let i = 0; i < 120; i++) g.update(1 / 60);
  assert(Math.abs(g.pose().pitch - GUARD_GRIP.pitch) < 1e-3, "converges on the stance");
});

Deno.test("the fist closes fully for a strike and relaxes at rest", () => {
  assert(SWING_H_GRIP.fist === 1.0, "a strike grips tight");
  assert(REST_GRIP.fist < 1.0, "rest is not a white-knuckle grip");
});
