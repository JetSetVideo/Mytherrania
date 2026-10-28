import { body, impact, stunDuration } from "../src/physics/SmashPhysics.ts";
import { stepArenaBody, type ArenaState } from "../src/physics/ArenaPhysics.ts";
import { makeArena } from "../src/game/ArenaConfig.ts";
import { REFERENCE_BODIES } from "../src/game/Physics.ts";

function assert(ok: boolean, message: string) { if (!ok) throw new Error(message); }

const walledSquare = (): ArenaState => ({
  cfg: makeArena({ size: 20, shape: 2, walls: 1, wallHeight: 3, wallResistance: 20000, wallBounce: 0.7, objects: 0 }),
  walled: true, integrity: 1, props: [],
});

Deno.test("gravity lands a falling box on the ring floor", () => {
  const box = body(0, 5, 0);
  for (let i = 0; i < 240; i++) stepArenaBody(box, REFERENCE_BODIES.skirmisher, 1 / 120, walledSquare(), 0);
  assert(box.y === box.radius, "box must settle on the ring surface");
  assert(box.vy === 0, "landing must cancel downward velocity");
});

Deno.test("a smash launches the dummy and a wall contains and reflects it", () => {
  const st = walledSquare();
  const dummy = body(6, 0.6, 0);
  impact(dummy, 1, 0, 12);
  assert(dummy.vx > 0 && dummy.vy > 0, "impact must launch horizontally and vertically");
  let hits = 0;
  for (let i = 0; i < 120; i++) if (stepArenaBody(dummy, REFERENCE_BODIES.skirmisher, 1 / 120, st, dummy.vx).wall) hits++;
  assert(hits > 0, "the wall must be struck");
  assert(dummy.x <= 10, `wall must contain the dummy, x=${dummy.x.toFixed(2)}`);
  assert(stunDuration(10, 2, 2) === 0.45, "stun uses damage*impact*1.5^bounces at 10ms/unit");
});
