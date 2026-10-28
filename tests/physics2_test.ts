import {
  density, fallDamage, hitWall, IMPACT_K, kineticEnergy, makeBody,
  momentum, reducedMass, REFERENCE_BODIES, resolveImpact, totalArea,
  totalMass, totalVolume, toughness,
} from "../src/game/Physics.ts";
import { makeArena, randomArena, wallFor } from "../src/game/ArenaConfig.ts";
import { seededRng } from "../src/game/Items.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

Deno.test("a composite body sums its parts: mass, volume and area all add up", () => {
  const b = makeBody([
    { name: "a", mass: 10, volume: 0.01, area: 0.2 },
    { name: "b", mass: 5, volume: 0.004, area: 0.1 },
  ]);
  assert(totalMass(b) === 15, `mass should sum, got ${totalMass(b)}`);
  assert(Math.abs(totalVolume(b) - 0.014) < 1e-12, "volume should sum");
  assert(Math.abs(totalArea(b) - 0.3) < 1e-12, "area should sum");
  // Density is total mass over total volume, not an average of part densities.
  assert(Math.abs(density(b) - 15 / 0.014) < 1e-6, `density should be 1071, got ${density(b)}`);
});

Deno.test("adding a dense part raises the whole body's density; a hollow part lowers it", () => {
  const base = [{ name: "flesh", mass: 60, volume: 0.06, area: 0.3 }];
  const withPlate = [...base, { name: "plate", mass: 30, volume: 0.004, area: 0.2 }];
  const withAir = [...base, { name: "lungs", mass: 1, volume: 0.05, area: 0.05 }];
  const d0 = density(makeBody(base));
  assert(density(makeBody(withPlate)) > d0, "a steel plate should raise density");
  assert(density(makeBody(withAir)) < d0, "a hollow cavity should lower density");
});

Deno.test("momentum and energy follow their equations", () => {
  assert(momentum(10, 5) === 50, "p = mv");
  assert(momentum(10, -5) === 50, "speed is taken as a magnitude");
  assert(Math.abs(kineticEnergy(10, 4) - 80) < 1e-9, "KE = 1/2 m v^2");
  // Energy is quadratic: doubling speed quadruples it.
  assert(Math.abs(kineticEnergy(2, 8) / kineticEnergy(2, 4) - 4) < 1e-9, "energy should scale with v^2");
});

Deno.test("reduced mass is bounded by the lighter body and tends to it against a wall", () => {
  assert(Math.abs(reducedMass(10, 10) - 5) < 1e-9, "equal masses halve");
  assert(reducedMass(10, 1000) > 9.9 && reducedMass(10, 1000) < 10, "a wall gives back the body's own mass");
  assert(reducedMass(0, 0) === 0, "no mass, no collision");
  assert(reducedMass(1, 1e9) < 1.0000001, "never exceeds the lighter body");
});

Deno.test("the heaviest fastest body hurts the thinnest slowest one most", () => {
  const skirm = REFERENCE_BODIES.skirmisher;
  const jug = REFERENCE_BODIES.juggernaut;

  // Juggernaut hits skirmisher, hard.
  const heavy = resolveImpact({ attacker: jug, defender: skirm, attackerSpeed: 9 });
  // Skirmisher hits juggernaut, with the same speed.
  const light = resolveImpact({ attacker: skirm, defender: jug, attackerSpeed: 9 });
  assert(heavy.damage > light.damage * 2, `heavy should out-damage light: ${heavy.damage.toFixed(1)} vs ${light.damage.toFixed(1)}`);

  // A heavier attacker does more damage, all else equal.
  const lightAttacker = resolveImpact({ attacker: skirm, defender: skirm, attackerSpeed: 9 });
  const heavyAttacker = resolveImpact({ attacker: jug, defender: skirm, attackerSpeed: 9 });
  assert(heavyAttacker.damage > lightAttacker.damage, "more mass, more damage");

  // A faster attacker does more damage, all else equal.
  const slow = resolveImpact({ attacker: jug, defender: skirm, attackerSpeed: 3 });
  const fast = resolveImpact({ attacker: jug, defender: skirm, attackerSpeed: 12 });
  assert(fast.damage > slow.damage * 3, `speed should matter a lot: ${slow.damage.toFixed(1)} -> ${fast.damage.toFixed(1)}`);
});

Deno.test("a thin defender takes more from the same blow than a dense one", () => {
  const jug = REFERENCE_BODIES.juggernaut;
  // Two defenders of EQUAL MASS but different volume: one dense, one thin.
  const dense = makeBody([{ name: "x", mass: 60, volume: 0.02, area: 0.3 }], { armour: 0.3 });
  const thin = makeBody([{ name: "x", mass: 60, volume: 0.12, area: 0.3 }], { armour: 0.3 });
  assert(Math.abs(totalMass(dense) - totalMass(thin)) < 1e-9, "the two defenders must weigh the same");
  assert(density(dense) > density(thin), "the test is meaningless unless densities differ");
  const a = resolveImpact({ attacker: jug, defender: dense, attackerSpeed: 8 });
  const b = resolveImpact({ attacker: jug, defender: thin, attackerSpeed: 8 });
  assert(b.damage > a.damage, `the thin body should take more: ${a.damage.toFixed(1)} vs ${b.damage.toFixed(1)}`);
  assert(toughness(thin) < toughness(dense), "and have lower toughness");
});

Deno.test("a slow defender takes more than one retreating at the same speed", () => {
  const jug = REFERENCE_BODIES.juggernaut;
  const skirm = REFERENCE_BODIES.skirmisher;
  const standing = resolveImpact({ attacker: jug, defender: skirm, attackerSpeed: 8, defenderSpeed: 0 });
  const running = resolveImpact({ attacker: jug, defender: skirm, attackerSpeed: 8, defenderSpeed: 6 });
  assert(running.damage < standing.damage, "running away should reduce the blow");
  // And a defender moving INTO the blow takes more.
  const charging = resolveImpact({ attacker: jug, defender: skirm, attackerSpeed: 8, defenderSpeed: -4 });
  assert(charging.damage > standing.damage, "moving into it should hurt more");
});

Deno.test("knockback throws a light body further than a heavy one", () => {
  const jug = REFERENCE_BODIES.juggernaut;
  const skirm = REFERENCE_BODIES.skirmisher;
  const intoLight = resolveImpact({ attacker: jug, defender: skirm, attackerSpeed: 10 });
  const intoHeavy = resolveImpact({ attacker: skirm, defender: jug, attackerSpeed: 10 });
  assert(intoLight.knockback > intoHeavy.knockback, "the light body should be thrown further");
});

Deno.test("impact results are finite and never negative", () => {
  for (const speed of [0, 0.1, 5, 50, 500]) {
    for (const [a, d] of [[REFERENCE_BODIES.skirmisher, REFERENCE_BODIES.juggernaut], [REFERENCE_BODIES.juggernaut, REFERENCE_BODIES.skirmisher]] as const) {
      const i = resolveImpact({ attacker: a, defender: d, attackerSpeed: speed });
      for (const [k, v] of Object.entries(i)) {
        if (typeof v === "number") assert(Number.isFinite(v), `${k} not finite at speed ${speed}`);
      }
      assert(i.damage >= 0 && i.knockback >= 0 && i.impulse >= 0, "no negative physics");
    }
  }
});

Deno.test("a glancing blow is recognised, and scale/multiplier act as advertised", () => {
  const jug = REFERENCE_BODIES.juggernaut;
  const skirm = REFERENCE_BODIES.skirmisher;
  const graze = resolveImpact({ attacker: skirm, defender: jug, attackerSpeed: 0.05 });
  assert(graze.glanced, "a crawl into a juggernaut is a graze");
  const normal = resolveImpact({ attacker: jug, defender: skirm, attackerSpeed: 10 });
  const doubled = resolveImpact({ attacker: jug, defender: skirm, attackerSpeed: 10, multiplier: 2 });
  assert(Math.abs(doubled.damage - normal.damage * 2) < 1e-6, "multiplier should scale damage linearly");
  const halved = resolveImpact({ attacker: jug, defender: skirm, attackerSpeed: 10, scale: 0.5 });
  assert(Math.abs(halved.damage - normal.damage * 0.5) < 1e-6, "scale should scale damage linearly");
  assert(Math.abs(IMPACT_K - 1.15) < 1e-9, "the tuning constant should be stable");
});

// ------------------------------------------------------------------- walls

Deno.test("a light slow body bounces off a wall; a heavy fast one breaches it", () => {
  const wall = { resistance: 2200, height: 2.4, restitution: 0.3 };
  const skirm = REFERENCE_BODIES.skirmisher;
  const jug = REFERENCE_BODIES.juggernaut;
  const light = hitWall(skirm, 4, wall);
  assert(!light.breached, "a light body at walking speed should not breach a wall");
  assert(light.retainedSpeed < 4, "and should lose speed to the rebound");
  const heavy = hitWall(jug, 22, wall);
  assert(heavy.breached, `a juggernaut at 22 m/s should breach: J=${(totalMass(jug) * 22).toFixed(0)} vs R=${wall.resistance}`);
  assert(heavy.wallDamage > 0, "and should damage the wall");
  assert(heavy.retainedSpeed > 0, "and keep some speed through it");
});

Deno.test("wall resistance is a dial: higher resistance means fewer breaches", () => {
  const jug = REFERENCE_BODIES.juggernaut;
  let soft = 0, hard = 0;
  for (let i = 0; i < 100; i++) {
    const speed = 4 + (i / 100) * 16;
    if (hitWall(jug, speed, { resistance: 800, height: 2, restitution: 0.3 }).breached) soft++;
    if (hitWall(jug, speed, { resistance: 12000, height: 2, restitution: 0.3 }).breached) hard++;
  }
  assert(soft > 0, "a soft wall should be breached sometimes");
  assert(soft > hard, `a soft wall should be breached more often than a hard one: ${soft} vs ${hard}`);
});

Deno.test("wall integrity falls as it is damaged and reaches zero", () => {
  const wall = { resistance: 1200, height: 2, restitution: 0.3 };
  const jug = REFERENCE_BODIES.juggernaut;
  const hit = hitWall(jug, 30, wall);
  assert(hit.wallIntegrity < 1, "the wall should be damaged");
  assert(hit.wallIntegrity >= 0, "integrity cannot go negative");
  // A wall already at zero integrity offers no resistance.
  const broken = hitWall(jug, 1, wall, 0);
  assert(broken.breached, "a wall at zero integrity should not stop anything");
});

Deno.test("fall damage scales with mass and the square of impact speed", () => {
  const skirm = REFERENCE_BODIES.skirmisher;
  const jug = REFERENCE_BODIES.juggernaut;
  const slow = fallDamage(jug, 5);
  const fast = fallDamage(jug, 10);
  assert(fast > slow * 3.5, `fall damage should be quadratic: ${slow.toFixed(0)} -> ${fast.toFixed(0)}`);
  // A heavy thin body takes more than a heavy armoured one of the same mass.
  const heavyThin = makeBody([{ name: "x", mass: 100, volume: 0.2, area: 0.4 }], { armour: 0.1 });
  const heavyDense = makeBody([{ name: "x", mass: 100, volume: 0.05, area: 0.4 }], { armour: 0.9 });
  assert(fallDamage(heavyThin, 12) > fallDamage(heavyDense, 12), "the thin body should take more from the fall");
  assert(fallDamage(skirm, 0) === 0, "a zero-speed landing does no damage");
});

// ------------------------------------------------------------ arena walls

Deno.test("90% of generated arenas have walls (one roll, in randomArena)", () => {
  let walled = 0;
  const n = 2000;
  for (let seed = 0; seed < n; seed++) if (randomArena(seededRng(seed)).walls >= 1) walled++;
  const pct = (walled / n) * 100;
  // Binomial σ at n=2000, p=0.9 is 0.67%: ±3σ ≈ ±2%.
  assert(pct > 88 && pct < 92, `expected 90 ± 2% walled, got ${pct.toFixed(1)}%`);
  // An explicit override always wins.
  assert(randomArena(seededRng(1), { walls: 0 }).walls === 0, "walls: 0 means no walls, ever");
});

Deno.test("random arenas vary wall resistance widely enough to matter", () => {
  const seen = new Set<number>();
  let breached = 0;
  for (let seed = 0; seed < 60; seed++) {
    const cfg = makeArena({ size: 40, wallResistance: 900 + seed * 140 });
    seen.add(cfg.wallResistance);
    const w = wallFor(cfg);
    if (hitWall(REFERENCE_BODIES.juggernaut, 20, w).breached) breached++;
  }
  assert(seen.size > 10, "wall resistance should vary across the parameter space");
  assert(breached > 0 && breached < 60, `some walls should stop a juggernaut and some not: ${breached}/60 breached`);
});
