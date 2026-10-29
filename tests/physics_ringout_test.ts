// Lane R (V03): ring-out = elimination — the rule, the tie-break and the wall interplay.
import {
  beyondDistance, checkRingOut, outsideAt, REFERENCE_BODY_HEIGHT, ringOutDrop, ringOutLoser, trackExit,
  type ExitClock, type RingOutProbe,
} from "../src/game/RingOut.ts";
import { ringOutVerdict } from "../src/game/WinConditions.ts";
import { makeArena, type ArenaConfig } from "../src/game/ArenaConfig.ts";
import { stepArenaBody, type ArenaState } from "../src/physics/ArenaPhysics.ts";
import { REFERENCE_BODIES } from "../src/game/Physics.ts";
import { body as createBody } from "../src/physics/SmashPhysics.ts";
import { uniformSurroundings } from "./ragdoll_fixtures.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

const R = 0.35;
const probe = (over: Partial<RingOutProbe>): RingOutProbe => ({
  fighter: "opponent", x: 0, y: R, z: 0, vx: 0, vy: 0, vz: 0, radius: R, bottomY: 0,
  bodyHeight: REFERENCE_BODY_HEIGHT, rimY: 0, wallStopped: false, time: 10, ...over,
});
const open = (over: Partial<ArenaConfig> = {}) => makeArena({ size: 12, shape: 0, walls: 0, outsideGround: 1, outsideCollision: 1, outsideHeight: -1, objects: 0, ...over });

Deno.test("RINGOUT: RING_OUT_DROP is one standing height", () => {
  assert(ringOutDrop() === REFERENCE_BODY_HEIGHT && ringOutDrop(2.2) === 2.2, "drop = 1 x body height");
});

Deno.test("RINGOUT: a body over the ring, or with its footprint still over the floor, is in play", () => {
  const cfg = open();
  assert(checkRingOut(cfg, probe({ x: 0 }), null) === null, "centre of the ring");
  // Centre 0.2 m past the outline: beyond by less than the footprint radius.
  const edge = probe({ x: 6.2, y: -0.65, bottomY: -1 });
  assert(beyondDistance(cfg, 6.2, 0) < R, "fixture: within one radius of the outline");
  assert(checkRingOut(cfg, edge, null) === null, "a footprint still over the rim is not out");
});

Deno.test("RINGOUT: landing on the outside ground beyond the ring is a ring-out (medium ground)", () => {
  const cfg = open();
  const ev = checkRingOut(cfg, probe({ x: 7, y: -1 + R, bottomY: -1, vx: 3, vy: -6 }), null);
  assert(ev && ev.medium === "ground" && ev.fighter === "opponent", `ground ring-out expected, got ${JSON.stringify(ev)}`);
  assert(Math.abs(ev.speed - Math.hypot(3, 6)) < 1e-9 && ev.x === 7 && ev.time === 10, "event carries where/how fast/when");
  // Still in the air above that ground, with less than a body height of drop: not yet.
  assert(checkRingOut(cfg, probe({ x: 7, y: 0.5, bottomY: 0.15 }), null) === null, "airborne beyond the ring: not yet");
});

Deno.test("RINGOUT: over a void the ring-out fires once the drop exceeds one body height", () => {
  const cfg = open({ outsideGround: 0 });
  assert(outsideAt(cfg, null, 9, 0, 0, { medium: "ground", surfaceY: 0, killPlaneY: 0 }).medium === "void", "fallback void");
  const h = REFERENCE_BODY_HEIGHT;
  assert(checkRingOut(cfg, probe({ x: 8, bottomY: -(h - 0.05), y: -(h - 0.05) + R }), null) === null, "just under one body height: still falling");
  const ev = checkRingOut(cfg, probe({ x: 8, bottomY: -(h + 0.05), y: -(h + 0.05) + R }), null);
  assert(ev?.medium === "void", "beyond one body height: out over the void");
});

Deno.test("RINGOUT: touching water / magma from the Surroundings is a ring-out with that medium", () => {
  const cfg = open({ outsideGround: 0 });
  for (const m of ["water", "magma"] as const) {
    const s = uniformSurroundings(m, -0.6);
    assert(checkRingOut(cfg, probe({ x: 8, bottomY: -0.3, y: 0.05 }), s) === null, `${m}: above the surface, small drop`);
    const ev = checkRingOut(cfg, probe({ x: 8, bottomY: -0.6, y: -0.25 }), s);
    assert(ev?.medium === m, `${m}: touching the surface ends it`);
  }
});

Deno.test("RINGOUT: a wall that held the body this step is never a ring-out", () => {
  const cfg = open();
  assert(checkRingOut(cfg, probe({ x: 7, bottomY: -1, wallStopped: true }), null) === null, "wall stopped it");
});

Deno.test("RINGOUT: integration — thrown OVER a low wall rings out; thrown INTO it does not", () => {
  const cfg = makeArena({ size: 12, shape: 4, walls: 1, wallHeight: 0.6, wallResistance: 20000, outsideGround: 1, outsideCollision: 1, outsideHeight: -1, objects: 0 });
  for (const [y0, vy, expectOut] of [[1.6, 6, true], [R, 0, false]] as const) {
    const st: ArenaState = { cfg, walled: true, integrity: 1, props: [] };
    const b = createBody(3, y0, 0); b.radius = R;
    b.vx = 14; b.vy = vy;
    let event = null;
    for (let i = 0; i < 240 && !event; i++) {
      const prev = { x: b.x, z: b.z };
      const s = stepArenaBody(b, REFERENCE_BODIES.skirmisher, 1 / 120, st, 0, prev, R);
      event = checkRingOut(cfg, probe({
        x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, bottomY: b.y - R,
        wallStopped: s.wallContact && !s.wall?.breached, time: i / 120,
      }), null);
    }
    assert(!!event === expectOut, `y0 ${y0}: expected ${expectOut ? "a ring-out" : "the wall to hold"}, got ${JSON.stringify(event)}`);
  }
});

Deno.test("RINGOUT: exit clock and the double ring-out tie-break (earlier exit loses)", () => {
  const cfg = open();
  const c: ExitClock = { exitTime: null };
  trackExit(c, cfg, 0, 0, 1);
  assert(c.exitTime === null, "inside: no exit");
  trackExit(c, cfg, 6.5, 0, 2); trackExit(c, cfg, 7, 0, 2.5);
  assert(c.exitTime === 2, "first crossing time kept");
  trackExit(c, cfg, 5, 0, 3);
  assert(c.exitTime === null, "back over the ring resets");
  const ev = (f: "player" | "opponent") => ({ fighter: f, medium: "ground" as const, x: 7, z: 0, speed: 5, time: 4 });
  assert(ringOutLoser(null, null) === null, "nobody out");
  assert(ringOutLoser({ event: ev("player"), exitTime: 3, hpFraction: 1 }, null) === "player", "single ring-out loses");
  assert(ringOutLoser({ event: ev("player"), exitTime: 3.2, hpFraction: 0.2 }, { event: ev("opponent"), exitTime: 3.1, hpFraction: 0.9 }) === "opponent", "earlier exit loses");
  assert(ringOutLoser({ event: ev("player"), exitTime: 3, hpFraction: 0.8 }, { event: ev("opponent"), exitTime: 3, hpFraction: 0.4 }) === "opponent", "tie: lower HP fraction loses");
  const v = ringOutVerdict(1);
  assert(v.over && v.winner === 0 && v.reason === "ringout", "verdict: the other fighter wins by ringout");
});
