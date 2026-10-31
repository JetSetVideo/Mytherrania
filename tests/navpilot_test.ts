// Lane N-A: NavPilot — the stuck detector (basis: progressToward), the bounded re-plan cadence for
// a MOVING target, the arrival rule, and a scripted escape fixture for a prop, a wall and the rim.
import {
  ARRIVE_M, createNavPilot, ESCAPE_BURST_S, ESCAPE_CANDIDATES, ESCAPE_MAX_S, NAV_CLEAR_M,
  PASS_M, planLocalRoute, progressToward, REPLAN_DIST_M, REPLAN_S, STRAY_M, STUCK_S,
} from "../src/game/NavPilot.ts";
import { distanceToPolyline } from "../src/world/PathFinder.ts";

function assert(ok: unknown, message = "assertion failed"): void {
  if (!ok) throw new Error(String(message));
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

Deno.test("progressToward: closing is positive, receding negative, sideways ~0; total on bad input", () => {
  // 1 m/s straight at the goal for 0.1 s closes 0.1 m.
  assert(near(progressToward({ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 1, z: 0 }, 0.1), 0.1, 1e-9), "closing");
  assert(progressToward({ x: 0, z: 0 }, { x: 10, z: 0 }, { x: -1, z: 0 }, 0.1) < 0, "receding is negative");
  // Moving sideways is motion but not progress.
  assert(Math.abs(progressToward({ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 0, z: 3 }, 0.1)) < 0.02, "sideways ~0");
  assert(progressToward({ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 1, z: 0 }, 0) === 0, "dt=0");
  assert(progressToward({ x: NaN, z: 0 }, { x: 10, z: 0 }, { x: 1, z: 0 }, 0.1) === 0, "non-finite -> 0");
});

Deno.test("every bound is a finite, positive constant with the right unit scale", () => {
  for (const [name, v] of [["ARRIVE_M", ARRIVE_M], ["REPLAN_S", REPLAN_S], ["REPLAN_DIST_M", REPLAN_DIST_M],
    ["STUCK_S", STUCK_S], ["ESCAPE_BURST_S", ESCAPE_BURST_S], ["ESCAPE_MAX_S", ESCAPE_MAX_S],
    ["STRAY_M", STRAY_M], ["NAV_CLEAR_M", NAV_CLEAR_M], ["PASS_M", PASS_M]] as const) {
    assert(Number.isFinite(v) && v > 0, `${name} must be finite and positive`);
  }
  assert(near(ESCAPE_MAX_S, ESCAPE_BURST_S * ESCAPE_CANDIDATES), "ESCAPE_MAX_S covers one full cycle");
});

Deno.test("distanceToPolyline: 0 on the line, the offset off it, Infinity on empty/NaN", () => {
  const line = [{ x: 0, z: 0, y: 0 }, { x: 10, z: 0, y: 0 }];
  assert(distanceToPolyline(line, 5, 0) < 1e-9, "on the line");
  assert(near(distanceToPolyline(line, 5, 2), 2), "off the line");
  assert(distanceToPolyline(line, 20, 0) === 10, "beyond the end");
  assert(distanceToPolyline([], 0, 0) === Infinity, "empty");
  assert(distanceToPolyline(line, NaN, 0) === Infinity, "NaN input");
});

Deno.test("planLocalRoute bends around a named obstacle and stays clear of it", () => {
  const o = { x: 2.5, z: 0, radius: 0.5 };
  const route = planLocalRoute({ x: 0, z: 0 }, { x: 5, z: 0 }, [o]);
  assert(route.length >= 3, `route must bend (${route.length} points)`);
  // Every segment stays at least the obstacle radius from its centre.
  for (let k = 1; k < route.length; k++) {
    const steps = 40;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = route[k - 1].x + (route[k].x - route[k - 1].x) * t, z = route[k - 1].z + (route[k].z - route[k - 1].z) * t;
      assert(Math.hypot(x - o.x, z - o.z) >= o.radius - 1e-9, `bend clips the obstacle at (${x.toFixed(2)}, ${z.toFixed(2)})`);
    }
  }
  // A clear line is a single span (start -> goal).
  assert(planLocalRoute({ x: 0, z: 0 }, { x: 5, z: 5 }, [o]).length === 2, "clear line unchanged");
});

Deno.test("arrival: the pilot stops inside arriveM instead of orbiting, and the option is honoured", () => {
  const p = createNavPilot();
  p.plan({ x: 0.2, z: 0 }, { x: 0, z: 0 }, []);
  const st = p.step(1 / 30, { x: 0, z: 0, vx: 0, vz: 0 });
  assert(st.done, "inside arriveM -> done");
  assert(st.dirX === 0 && st.dirZ === 0, "no residual steering");
  const q = createNavPilot({ arriveM: 0.05 });
  q.plan({ x: 0.2, z: 0 }, { x: 0, z: 0 }, []);
  assert(!q.step(1 / 30, { x: 0, z: 0, vx: 0, vz: 0 }).done, "a tighter arriveM keeps going");
});

Deno.test("re-plan cadence: a MOVING goal is re-planned on a bounded schedule, and at once past the distance", () => {
  const p = createNavPilot({ replanS: 0.4 });
  let gx = 5;
  const gz = 0;
  p.plan({ x: gx, z: gz }, { x: 0, z: 0 }, []);
  assert(p.replans === 1, "first plan");
  const dt = 1 / 30;
  let t = 0;
  // The goal crawls at 0.4 m/s (never more than REPLAN_DIST_M between two ticks).
  while (t < 2) { t += dt; gx += 0.4 * dt; p.plan({ x: gx, z: gz }, { x: 0, z: 0 }, []); p.step(dt, { x: 0, z: 0, vx: 1, vz: 0 }); }
  assert(p.replans >= 4 && p.replans <= 7, `cadence replanned ${p.replans} times in 2 s`);
  // A jump past REPLAN_DIST_M re-plans on the very next plan call.
  const before = p.replans;
  p.plan({ x: gx + 3, z: gz }, { x: 0, z: 0 }, []);
  assert(p.replans === before + 1, "a goal jump re-plans at once");
  const end = p.route[p.route.length - 1];
  assert(Math.hypot(end.x - (gx + 3), end.z - gz) < 1e-9, "the fresh route ends at the new goal");
});

Deno.test("a stale path is never chased: the body straying past STRAY_M re-plans from where it is", () => {
  const p = createNavPilot({ replanS: 1e9 }); // cadence silenced so only the stray test can fire
  p.plan({ x: 5, z: 0 }, { x: 0, z: 0 }, []);
  assert(p.replans === 1, "initial plan");
  p.plan({ x: 5, z: 0 }, { x: 0, z: STRAY_M + 0.5 }, []);
  assert(p.replans === 2, "straying past STRAY_M re-plans");
  assert(Math.hypot(p.route[0].x - 0, p.route[0].z - (STRAY_M + 0.5)) < 1e-9, "the route starts where the body is");
});

/**
 * A scripted stuck fixture: a body walks at `speed` m/s toward `goal` under the pilot's steering,
 * but the environment refuses any step into blocked ground, so a step that is blocked leaves the
 * body pinned (zero closure) — exactly a body grinding on a prop, a wall or the rim. The pilot sees
 * none of that geometry (obstacles = []); it must free itself from closure alone, within a bound.
 */
function runFixture(o: { start: { x: number; z: number }; goal: { x: number; z: number }; isFree: (x: number, z: number) => boolean; speed?: number; maxS?: number }) {
  const speed = o.speed ?? 4.2, dt = 1 / 30, maxS = o.maxS ?? 8;
  const pilot = createNavPilot();
  let x = o.start.x, z = o.start.z, px = x, pz = z, t = 0, escapes = 0, wasEscaping = false, firstEscapeT = -1, lastEscapeEndT = -1;
  for (; t < maxS; t += dt) {
    pilot.plan(o.goal, { x, z }, []);
    const st = pilot.step(dt, { x, z, vx: (x - px) / dt, vz: (z - pz) / dt });
    px = x; pz = z;
    if (pilot.escaping && !wasEscaping) { escapes++; if (firstEscapeT < 0) firstEscapeT = t; }
    if (!pilot.escaping && wasEscaping) lastEscapeEndT = t;
    wasEscaping = pilot.escaping;
    if (st.done) return { reached: true, t, escapes, firstEscapeT, lastEscapeEndT, x, z };
    const nx = x + st.dirX * speed * dt, nz = z + st.dirZ * speed * dt;
    if (o.isFree(nx, nz)) { x = nx; z = nz; } // blocked -> pinned
  }
  return { reached: false, t, escapes, firstEscapeT, lastEscapeEndT, x, z };
}

Deno.test("stuck ESCAPE fixture — pinned on a PROP: the body sidesteps and reaches the goal in bounded time", () => {
  const goal = { x: 6, z: 0 };
  const isFree = (x: number, z: number) => Math.hypot(x - 2, z) >= 1.0;
  const r = runFixture({ start: { x: 0, z: 0 }, goal, isFree });
  assert(r.escapes >= 1, "the stuck detector must have fired against the prop");
  assert(r.reached, `never reached the goal (ended at ${r.x.toFixed(2)}, ${r.z.toFixed(2)})`);
  assert(r.lastEscapeEndT - r.firstEscapeT <= ESCAPE_MAX_S + 1e-6, `escape took ${(r.lastEscapeEndT - r.firstEscapeT).toFixed(2)} s > one cycle`);
  assert(r.t <= 6, `settled in ${r.t.toFixed(2)} s`);
});

Deno.test("stuck ESCAPE fixture — pinned on a WALL: the body sidesteps and reaches the goal in bounded time", () => {
  const goal = { x: 5, z: 0 };
  // A wall plate the direct line hits; the goal clear beyond its top edge (z > 0.5).
  const isFree = (x: number, z: number) => !(x >= 1.5 && x <= 1.8 && z <= 0.5);
  const r = runFixture({ start: { x: 0, z: 0 }, goal, isFree });
  assert(r.escapes >= 1, "the stuck detector must have fired against the wall");
  assert(r.reached, `never reached the goal (ended at ${r.x.toFixed(2)}, ${r.z.toFixed(2)})`);
  assert(r.lastEscapeEndT - r.firstEscapeT <= ESCAPE_MAX_S + 1e-6, `escape took ${(r.lastEscapeEndT - r.firstEscapeT).toFixed(2)} s > one cycle`);
  assert(r.t <= 6, `settled in ${r.t.toFixed(2)} s`);
});

Deno.test("stuck ESCAPE fixture — pinned on the RIM: the body sidesteps and reaches the goal in bounded time", () => {
  const goal = { x: 4, z: 0 };
  // A curved wall on the arena rim (radius 2.6..3.0 over the +x arc): the body is pinned on it and
  // must step off the arc to get around it.
  const isFree = (x: number, z: number) => {
    const r = Math.hypot(x, z);
    return !(r >= 2.6 && r <= 3.0 && Math.abs(Math.atan2(z, x)) <= 0.2);
  };
  const r = runFixture({ start: { x: 0, z: 0 }, goal, isFree });
  assert(r.escapes >= 1, "the stuck detector must have fired against the rim");
  assert(r.reached, `never reached the goal (ended at ${r.x.toFixed(2)}, ${r.z.toFixed(2)})`);
  assert(r.lastEscapeEndT - r.firstEscapeT <= ESCAPE_MAX_S + 1e-6, `escape took ${(r.lastEscapeEndT - r.firstEscapeT).toFixed(2)} s > one cycle`);
  assert(r.t <= 6, `settled in ${r.t.toFixed(2)} s`);
});

Deno.test("a clear run never escapes, and the pilot is deterministic (same inputs, same replans and route)", () => {
  const free = () => true;
  const r = runFixture({ start: { x: 0, z: 0 }, goal: { x: 5, z: 0 }, isFree: free });
  assert(r.reached && r.escapes === 0, `a clear run must not escape (escapes ${r.escapes})`);
  const mk = () => { const p = createNavPilot(); let gx = 5; const dt = 1 / 30; for (let t = 0; t < 1; t += dt) { gx += 0.05; p.plan({ x: gx, z: 0 }, { x: 0, z: 0 }, []); p.step(dt, { x: 0, z: 0, vx: 1, vz: 0 }); } return p; };
  const a = mk(), b = mk();
  assert(a.replans === b.replans, "same replans");
  assert(JSON.stringify(a.route) === JSON.stringify(b.route), "same route");
});
