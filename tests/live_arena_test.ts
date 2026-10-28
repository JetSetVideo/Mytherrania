// Live-arena physics, physics on body points, and elemental statuses.
import { ARENA_GRAVITY, edgeDistance, outline, stepArenaBody, type ArenaState } from "../src/physics/ArenaPhysics.ts";
import { makeArena, insideRing, ringRadiusAt } from "../src/game/ArenaConfig.ts";
import { bodyFromStats, REFERENCE_BODIES } from "../src/game/Physics.ts";
import { body as createBody } from "../src/physics/SmashPhysics.ts";
import { defaultHumanoid as createSkeleton } from "../src/game/Skeleton.ts";
import { KICK_DAMPING, KICK_STIFFNESS } from "../src/game/Skeleton.ts";
import { ELEMENT_STATUS, STATUS_DEFS, statusForSkill } from "../src/game/Status.ts";
import { ELEMENTS } from "../src/game/Skills.ts";
import { createStats } from "../src/game/Stats.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

const arena = (over = {}, walled = true): ArenaState => ({
  cfg: makeArena({ size: 12, shape: 0, walls: 1, wallHeight: 2.4, wallResistance: 2200, wallBounce: 0.3, outsideGround: 1, outsideCollision: 1, outsideHeight: -3, objects: 0, ...over }),
  walled, integrity: 1, props: [],
});

/** Drive a body outward at `speed` for up to 2 s; return the first wall event. */
function charge(st: ArenaState, body: ReturnType<typeof bodyFromStats>, speed: number) {
  const b = createBody(4, 0.5, 0); b.radius = 0.5;
  b.vx = speed;
  for (let i = 0; i < 240; i++) {
    const s = stepArenaBody(b, body, 1 / 120, st, b.vx);
    if (s.wall) return { b, s };
  }
  return { b, s: null };
}

Deno.test("ARENA: a body WALKED past the outline (x written directly) is still stopped by the wall", () => {
  const st = arena();
  const b = createBody(5.6, 0.5, 0); b.radius = 0.5;
  // The engine's walk/lunge moves x before the physics step: put the body outside.
  const prev = { x: b.x, z: b.z };
  b.x = 6.4;
  const s = stepArenaBody(b, REFERENCE_BODIES.skirmisher, 1 / 60, st, 4.2, prev);
  assert(s.wall && !s.wall.breached, "the wall must register the walker");
  assert(insideRing(st.cfg, b.x, b.z), `walker must be put back inside, at x=${b.x.toFixed(2)}`);
});

Deno.test("ARENA: a held wall keeps the body inside and sends it back", () => {
  const st = arena();
  const { b, s } = charge(st, REFERENCE_BODIES.skirmisher, 3);
  assert(s?.wall && !s.wall.breached, "a light, slow body must not break a 2200 N·s wall");
  assert(insideRing(st.cfg, b.x, b.z), "after a held hit the body is back inside");
  assert(b.vx < 0, `rebound must point inward, got vx=${b.vx.toFixed(2)}`);
});

Deno.test("ARENA: a heavy fast body breaks the wall and the wall wears down", () => {
  const st = arena();
  const { s } = charge(st, REFERENCE_BODIES.juggernaut, 30);
  assert(s?.wall?.breached, "a juggernaut at 30 m/s must breach");
  assert(st.integrity < 1, `integrity should drop, is ${st.integrity}`);
});

Deno.test("ARENA: no wall (the 10%) lets the body walk off the edge", () => {
  const st = arena({}, false);
  const { s } = charge(st, REFERENCE_BODIES.skirmisher, 3);
  assert(s === null, "no wall event without a wall");
});

Deno.test("ARENA: the outside ground catches a falling body and reports landing speed", () => {
  const st = arena({}, false);
  const b = createBody(20, 4, 0); b.radius = 0.5; // far outside the 12 m ring, 4 m up
  let landed = 0;
  for (let i = 0; i < 400 && !landed; i++) landed = stepArenaBody(b, REFERENCE_BODIES.skirmisher, 1 / 120, st, 0).landedOutside;
  assert(landed > 0, "the body must land on the concrete");
  // Free fall from 4 m to -3 m + radius: v = sqrt(2 g h) within discretisation error.
  const expect = Math.sqrt(2 * ARENA_GRAVITY * (4 - (-3 + b.radius)));
  assert(Math.abs(landed - expect) / expect < 0.05, `landing ${landed.toFixed(2)} vs v=√(2gh)=${expect.toFixed(2)}`);
  assert(Math.abs(b.y - (-3 + b.radius)) < 1e-9, "resting on the outside ground");
});

Deno.test("ARENA: a solid prop pushes the body out of its footprint", () => {
  const st = arena();
  st.props = [{ kind: "pillar", x: 0, z: 0, y: 0, rotation: 0, scale: 1, solid: true }];
  const b = createBody(0.2, 0.5, 0); b.radius = 0.5;
  stepArenaBody(b, REFERENCE_BODIES.skirmisher, 1 / 60, st, 0);
  assert(Math.hypot(b.x, b.z) >= 0.45 + 0.5 - 1e-6, `body must sit outside the pillar, at ${Math.hypot(b.x, b.z).toFixed(3)}`);
});

Deno.test("ARENA: edgeDistance is positive inside, zero on the outline, negative outside — every shape", () => {
  for (let shape = 0; shape < 8; shape++) {
    const cfg = makeArena({ size: 20, shape, aspect: 1.4, rotation: 17 });
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2, r = ringRadiusAt(cfg, a);
      assert(edgeDistance(cfg, Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5) > 0, `shape ${shape}: inside`);
      assert(Math.abs(edgeDistance(cfg, Math.cos(a) * r, Math.sin(a) * r)) < 1e-9, `shape ${shape}: on outline`);
      assert(edgeDistance(cfg, Math.cos(a) * r * 1.2, Math.sin(a) * r * 1.2) < 0, `shape ${shape}: outside`);
    }
    assert(outline(cfg, 64).length === 64, "outline sample count");
  }
});

// ------------------------------------------------- physics on the body points

Deno.test("BODY POINTS: a blow throws the spine, then the damped spring returns it to rest", () => {
  const sk = createSkeleton();
  sk.update(0.5); // settle the idle pose
  const rest = sk.joint("spine").angle;
  sk.applyImpulse(-4, 0);
  let peak = 0;
  for (let i = 0; i < 12; i++) { sk.update(1 / 60); peak = Math.max(peak, Math.abs(sk.joint("spine").angle - rest)); }
  assert(peak > 0.05, `the spine should visibly move (peak ${peak.toFixed(3)} rad)`);
  for (let i = 0; i < 180; i++) sk.update(1 / 60);
  assert(Math.abs(sk.kickOffset("spine")) < 1e-3, `the spring must settle, offset ${sk.kickOffset("spine")}`);
});

Deno.test("BODY POINTS: a heavier attacker throws the body further (ω = J / (m·L))", () => {
  const peakFor = (omega: number) => {
    const sk = createSkeleton();
    sk.update(0.5);
    sk.applyImpulse(omega, 0);
    let p = 0;
    for (let i = 0; i < 30; i++) { sk.update(1 / 120); p = Math.max(p, Math.abs(sk.kickOffset("spine"))); }
    return p;
  };
  assert(peakFor(-6) > peakFor(-2) * 2.5, "triple the impulse, roughly triple the throw");
  // Under-damped: ζ < 1, so the body overshoots and wobbles once.
  assert(KICK_DAMPING < 1 && KICK_STIFFNESS > 0, "spring constants");
});

Deno.test("BODY POINTS: the physics offset never pushes a joint past its limit", () => {
  const sk = createSkeleton();
  sk.update(0.5);
  sk.applyImpulse(-400, 1);
  for (let i = 0; i < 60; i++) {
    sk.update(1 / 60);
    for (const n of sk.jointNames()) {
      const j = sk.joint(n);
      assert(j.angle >= j.min - 1e-9 && j.angle <= j.max + 1e-9, `${n} ${j.angle} outside [${j.min}, ${j.max}]`);
    }
  }
});

// ------------------------------------------------- element -> status

Deno.test("STATUS: every skill element maps to a status that exists", () => {
  for (const el of Object.keys(ELEMENTS)) {
    const e = ELEMENT_STATUS[el];
    assert(e, `element ${el} has no status`);
    assert(STATUS_DEFS[e.status], `${el} -> ${e.status} is not a status`);
  }
});

Deno.test("STATUS: hypnosis and control come from shadow and necrotic; defense only buffs the caster", () => {
  assert(statusForSkill("shadow", "power")?.status === "hypnotised", "shadow hypnotises");
  assert(statusForSkill("necrotic", "power")?.status === "controlled", "necrotic controls");
  assert(statusForSkill("fire", "defense") === null, "a defensive fire skill inflicts nothing");
  assert(statusForSkill("holy", "defense")?.target === "self", "holy defense blesses the caster");
  assert(statusForSkill("fire", "dash")!.duration === statusForSkill("fire", "power")!.duration / 2, "dash is half");
});

Deno.test("STATUS: every clearedBy school is a real element (one vocabulary)", () => {
  const elements = new Set(Object.keys(ELEMENTS));
  for (const d of Object.values(STATUS_DEFS)) for (const s of d.clearedBy) assert(elements.has(s), `${d.name} cleared by unknown school ${s}`);
});

Deno.test("BODY: class bodies used for the live wall test are distinct", () => {
  assert(bodyFromStats(createStats("Barbarian")) !== bodyFromStats(createStats("Mage")), "distinct");
});
