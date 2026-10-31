// Wave J (lane J-E): the pure parts of the engine wiring — the per-segment wall rule in
// ArenaPhysics (opening / curb / mid wall / tall wall, per-segment integrity), the spectator speed's
// substep arithmetic (SimSpeed) and the minimap's wall classes. The engine wiring itself is proved
// in a real browser by tools/probe-batch.ts.
import { COM_HEIGHT, KNOCK_OVER_SPEED, stepArenaBody, TRIP_KEEP, wallAt, wallHeightAtXZ, type ArenaState } from "../src/physics/ArenaPhysics.ts";
import { makeArena, type ArenaConfig } from "../src/game/ArenaConfig.ts";
import { REFERENCE_BODIES } from "../src/game/Physics.ts";
import { body as createBody } from "../src/physics/SmashPhysics.ts";
import { WALL_BLOCK_HEIGHT, WALL_SEGMENTS, type WallPlan } from "../src/game/arena/contracts.ts";
import { wallPlanFor } from "../src/game/arena/walls.ts";
import { MAX_STEP_SECONDS, SPEEDS } from "../src/game/MatchControl.ts";
import { BUDGET_SHARE, effectiveSpeed, FRAME_BUDGET_MS, shiftSpeed, SIM_SUBSTEP, speedLabel, SPEED_KEYS, substepPlan } from "../src/engine/SimSpeed.ts";
import { edgeClass } from "../src/ui/Minimap.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

const TAU = Math.PI * 2;
const R_BODY = 0.35;
const cfgOf = (over: Partial<ArenaConfig> = {}) =>
  makeArena({ size: 16, walls: 1, wallHeight: 1.2, wallResistance: 20000, wallBounce: 0.4, outsideHeight: -3, objects: 0, ...over });

/** A plan whose segment 0 (bearing 0..7.5°) has height `h0` and every other segment `rest`. */
function planWith(h0: number, rest = 3, resistance = 20000, bounce = 0.4): WallPlan {
  const segments = Array.from({ length: WALL_SEGMENTS }, (_, k) => ({
    a0: (k / WALL_SEGMENTS) * TAU, a1: ((k + 1) / WALL_SEGMENTS) * TAU,
    height: k === 0 ? h0 : rest, resistance: (k === 0 ? h0 : rest) > 0 ? resistance : 0, bounce,
  }));
  return { rules: [{ kind: "full", weight: 1, params: {} }], combine: "max", baseHeight: rest, segments, coverage: 1, meanHeight: rest, maxHeight: Math.max(h0, rest) };
}

function stateWith(plan: WallPlan, over: Partial<ArenaState> = {}): ArenaState {
  return { cfg: cfgOf(), walled: true, integrity: 1, props: [], wallPlan: plan, segIntegrity: new Float64Array(plan.segments.length).fill(1), ...over };
}

/** Throw a body outward along bearing `a` at `speed` m/s from 1 m inside the rim; run `frames` steps. */
function throwBody(st: ArenaState, a: number, speed: number, outward: number, frames = 90) {
  const rim = 8; // size 16 circle
  const b = createBody(Math.cos(a) * (rim - 1), R_BODY, Math.sin(a) * (rim - 1));
  b.radius = R_BODY;
  b.y = R_BODY;
  b.vx = speed * Math.cos(a); b.vz = speed * Math.sin(a);
  let wallEvents = 0, contacts = 0, everOut = false;
  for (let i = 0; i < frames; i++) {
    const prev = { x: b.x, z: b.z };
    const step = stepArenaBody(b, REFERENCE_BODIES.skirmisher, 1 / 60, st, i < 3 ? outward : 0, prev, R_BODY);
    if (step.wall) wallEvents++;
    if (step.wallContact) contacts++;
    if (!step.onRing) everOut = true;
  }
  return { b, wallEvents, contacts, everOut, r: Math.hypot(b.x, b.z) };
}

const BEARING = (3.75 * Math.PI) / 180; // the middle of segment 0

Deno.test("J-E WALLS: an opening (height 0) lets a thrown body leave the ring — no wall event, no contact", () => {
  const st = stateWith(planWith(0));
  const t = throwBody(st, BEARING, 6, 6);
  assert(t.everOut && t.r > 8, `left the ring (r ${t.r.toFixed(2)})`);
  assert(t.wallEvents === 0 && t.contacts === 0, `no wall at the gap (${t.wallEvents} events, ${t.contacts} contacts)`);
  // The neighbouring segment (3 m) still holds the same throw.
  const held = throwBody(stateWith(planWith(0)), BEARING + (TAU / WALL_SEGMENTS) * 4, 6, 6);
  assert(!held.everOut && held.wallEvents === 1, `the 3 m segment next to it holds (out ${held.everOut}, events ${held.wallEvents})`);
});

Deno.test("J-E WALLS: a curb (< WALL_BLOCK_HEIGHT) trips a BLOW over but a LEAN slides along it", () => {
  const h = 0.45;
  assert(h < WALL_BLOCK_HEIGHT);
  const blow = throwBody(stateWith(planWith(h), { wallImpactSpeed: 1 }), BEARING, 5, 5);
  assert(blow.everOut && blow.wallEvents === 0, `a 5 m/s blow trips over a ${h} m curb (out ${blow.everOut}, events ${blow.wallEvents})`);
  // A walk-speed lean (below the impact speed) is stopped: the curb keeps walkers on the ring.
  const st = stateWith(planWith(h), { wallImpactSpeed: 7 });
  const lean = throwBody(st, BEARING, 2, 2);
  assert(!lean.everOut && lean.contacts > 0, `a 2 m/s lean stays in (r ${lean.r.toFixed(3)}, contacts ${lean.contacts})`);
  assert(TRIP_KEEP > 0 && TRIP_KEEP < 1);
});

Deno.test("J-E WALLS: a mid wall (block height .. centre of mass) topples a HARD knock, holds a softer blow", () => {
  const h = 0.8;
  assert(h >= WALL_BLOCK_HEIGHT && h < COM_HEIGHT);
  const hard = throwBody(stateWith(planWith(h), { wallImpactSpeed: 1 }), BEARING, KNOCK_OVER_SPEED + 2, KNOCK_OVER_SPEED + 2);
  assert(hard.everOut && hard.wallEvents === 0, `a ${KNOCK_OVER_SPEED + 2} m/s knock topples over (out ${hard.everOut})`);
  const soft = throwBody(stateWith(planWith(h), { wallImpactSpeed: 1 }), BEARING, 3, 3);
  assert(!soft.everOut && soft.wallEvents === 1, `a 3 m/s blow is held (out ${soft.everOut}, events ${soft.wallEvents})`);
});

Deno.test("J-E WALLS: a tall segment holds; a breach wears ONE segment, integrity is the minimum, the rest stand", () => {
  const tall = throwBody(stateWith(planWith(2.4)), BEARING, KNOCK_OVER_SPEED + 4, KNOCK_OVER_SPEED + 4);
  assert(!tall.everOut && tall.wallEvents === 1, `a 2.4 m wall holds a ${KNOCK_OVER_SPEED + 4} m/s blow`);
  // A weak segment 0 (resistance 50 N·s) is breached by a heavy fast body.
  const plan = planWith(2.4, 2.4, 20000);
  plan.segments[0].resistance = 50;
  const st = stateWith(plan, { wallImpactSpeed: 1 });
  const t = throwBody(st, BEARING, 12, 12);
  const seg = st.segIntegrity!;
  assert(seg[0] < 1, `segment 0 wore down (${seg[0]})`);
  assert(seg.slice(1).every((v) => v === 1), "every other segment is intact");
  assert(Math.abs(st.integrity - seg[0]) < 1e-12, `integrity = min over segments (${st.integrity} vs ${seg[0]})`);
  assert(t.wallEvents === 1, `one blow (${t.wallEvents})`);
  // A spent segment is an opening for the collision and for wallAt / wallHeightAtXZ.
  seg[0] = 0;
  assert(wallAt(st, BEARING).height === 0 && wallHeightAtXZ(st, Math.cos(BEARING), Math.sin(BEARING)) === 0, "a breached segment reads as an opening");
  assert(wallAt(st, BEARING + 1).height === 2.4, "its neighbours still stand");
});

Deno.test("J-E WALLS: without a plan the legacy single wall is read (cfg.wallHeight, cfg resistance)", () => {
  const cfg = cfgOf({ wallHeight: 1.7, wallResistance: 1234, wallBounce: 0.25 });
  const st: ArenaState = { cfg, walled: true, integrity: 1, props: [] };
  const w = wallAt(st, 2);
  assert(w.k === -1 && w.height === 1.7 && w.resistance === 1234 && w.bounce === 0.25, JSON.stringify(w));
  st.integrity = 0;
  assert(wallAt(st, 2).height === 0, "a broken legacy wall is gone");
  assert(wallHeightAtXZ({ ...st, walled: false, integrity: 1 }, 1, 0) === 0, "an unwalled arena has no wall");
});

Deno.test("J-E WALLS: a generated plan's openings are exactly where wallHeightAtXZ reads 0 (48 segments, 3 seeds × 8 rules)", () => {
  for (let rule = 0; rule < 8; rule++) {
    for (const seed of [1, 77, 4242]) {
      const cfg = cfgOf({ wallRule: rule, wallRule2: -1, wallRule3: -1 });
      const plan = wallPlanFor(cfg, seed);
      const st = stateWith(plan, { cfg });
      for (let k = 0; k < plan.segments.length; k++) {
        const a = (plan.segments[k].a0 + plan.segments[k].a1) / 2;
        const h = wallHeightAtXZ(st, Math.cos(a) * 5, Math.sin(a) * 5);
        assert(h === plan.segments[k].height, `rule ${rule} seed ${seed} seg ${k}: ${h} vs ${plan.segments[k].height}`);
      }
    }
  }
});

Deno.test("J-E SPEED: substeps never exceed 1/60 s and add up to the scaled frame time when the budget allows", () => {
  for (const sp of SPEEDS) {
    for (const realDt of [1 / 120, 1 / 60, 1 / 30, 0.05, 0.1]) {
      const plan = substepPlan(realDt, sp.id, 0.1, 4);
      const sim = Math.min(MAX_STEP_SECONDS, realDt * sp.timeScale);
      assert(plan.dt <= SIM_SUBSTEP + 1e-12, `${sp.id} ${realDt}: dt ${plan.dt}`);
      assert(!plan.capped && Math.abs(plan.n * plan.dt - sim) < 1e-9, `${sp.id} ${realDt}: ${plan.n} × ${plan.dt} = ${plan.n * plan.dt} vs ${sim}`);
      assert(plan.n === Math.ceil(sim / SIM_SUBSTEP - 1e-9), `${sp.id} ${realDt}: n ${plan.n}`);
    }
  }
  // 8× at 60 FPS: 8 substeps of exactly 1/60.
  const eight = substepPlan(1 / 60, "eight", 0.1, 4);
  assert(eight.n === 8 && Math.abs(eight.dt - 1 / 60) < 1e-12, JSON.stringify(eight));
  // A paused frame: one substep of 0.
  const paused = substepPlan(0, "eight", 1, 4);
  assert(paused.n === 1 && paused.dt === 0 && paused.sim === 0, JSON.stringify(paused));
});

Deno.test("J-E SPEED: an expensive substep is CAPPED to the frame budget and the dropped time is reported", () => {
  // 2 ms per substep next to 8 ms of other work: room = floor((0.85 · 16.67 − 8) / 2) = 3.
  const plan = substepPlan(1 / 60, "eight", 2, 8);
  const room = Math.floor((BUDGET_SHARE * FRAME_BUDGET_MS - 8) / 2);
  assert(plan.capped && plan.n === room && plan.wanted === 8, JSON.stringify(plan));
  assert(Math.abs(plan.sim - room / 60) < 1e-12 && plan.dt === SIM_SUBSTEP, "capped frames run whole 1/60 s substeps");
  // Even a frame already over budget advances one substep (the match never freezes).
  const over = substepPlan(1 / 60, "eight", 5, 30);
  assert(over.n === 1 && over.capped, JSON.stringify(over));
  assert(Math.abs(effectiveSpeed(over.sim, 1 / 60) - 1) < 1e-9, "one substep per 60 Hz frame = 1× effective");
});

Deno.test("J-E SPEED: the controls step through the table and clamp at its ends; labels read as the HUD shows them", () => {
  assert(shiftSpeed("normal", 1) === "double" && shiftSpeed("quad", 1) === "eight" && shiftSpeed("eight", 1) === "eight");
  assert(shiftSpeed("normal", -1) === "half" && shiftSpeed("half", -1) === "half");
  assert(shiftSpeed("bogus", 1) === "double", "an unknown id steps from normal");
  assert(SPEED_KEYS.BracketLeft === -1 && SPEED_KEYS.BracketRight === 1 && SPEED_KEYS.Minus === -1 && SPEED_KEYS.Equal === 1);
  assert(speedLabel(8) === "8×" && speedLabel(0.5) === "½×" && speedLabel(5.34) === "5.3×" && speedLabel(0) === "0×");
});

Deno.test("J-E MINIMAP: edge classes follow the wall rule's thresholds", () => {
  assert(edgeClass(0) === 0 && edgeClass(0.01) === 0 && edgeClass(NaN) === 0);
  assert(edgeClass(0.45) === 1 && edgeClass(WALL_BLOCK_HEIGHT - 1e-9) === 1);
  assert(edgeClass(WALL_BLOCK_HEIGHT) === 2 && edgeClass(1.9) === 2);
  assert(edgeClass(2) === 3 && edgeClass(3.5) === 3);
});
