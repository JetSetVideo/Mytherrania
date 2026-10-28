// Lane W (W06): the weapon generator. Every archetype generates, every axis stays inside its
// archetype's range, the generator is deterministic per seed, the strike features sit in the
// contract frame (edge facing +z, points beyond the grip), two-handed weapons have an off
// grip and daggers offer the reverse grip first.

import type { ArchetypeId, WeaponSpec } from "../src/combat/contracts.ts";
import { rng32, summarize } from "../src/core/MathCore.ts";
import { ARCHETYPE_IDS, ARCHETYPES, archetypesOfClass } from "../src/game/weapons/Archetypes.ts";
import {
  axesOfSpec, candidateArchetypes, type GeneratedSpec, gripModeRotation, preferredGrip, rollWeapon, weaponForm,
  weaponFromArchetype, weaponFromSeed,
} from "../src/game/weapons/Generate.ts";
import { forwardLength, tailLength } from "../src/game/weapons/Form.ts";
import { RANDOM_WEAPON, resolveWeapon, weaponMenuOptions } from "../src/game/weapons/Loadout.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok {
  if (!ok) throw new Error(m);
}
const SEEDS_PER_ARCHETYPE = 300;
const seedOf = (i: number) => (i * 2654435761) >>> 0;
const EPS = 1e-9;

function forEachWeapon(fn: (w: GeneratedSpec, id: ArchetypeId) => void): void {
  for (const id of ARCHETYPE_IDS) for (let i = 1; i <= SEEDS_PER_ARCHETYPE; i++) fn(weaponFromSeed(id, seedOf(i)), id);
}

Deno.test("weapons: deterministic per seed (same seed -> identical spec; rollWeapon repeats with the rng)", () => {
  for (const id of ARCHETYPE_IDS) {
    const a = JSON.stringify(weaponFromSeed(id, 12345));
    const b = JSON.stringify(weaponFromSeed(id, 12345));
    assert(a === b, `${id}: same seed must give the same weapon`);
    assert(a !== JSON.stringify(weaponFromSeed(id, 12346)), `${id}: a different seed must change the weapon`);
  }
  const sequence = () => {
    const r = rng32(42);
    return Array.from({ length: 20 }, () => JSON.stringify(rollWeapon(r))).join();
  };
  assert(sequence() === sequence(), "a seeded rng must give a repeatable sequence of rolls");
  const w = weaponFromArchetype("sabre", rng32(7), { seed: 99 });
  assert(JSON.stringify(w) === JSON.stringify(weaponFromSeed("sabre", 99)), "opts.seed pins the weapon");
});

Deno.test("weapons: every archetype generates, with finite physics and the right class", () => {
  forEachWeapon((w, id) => {
    assert(w.archetype === id && w.weaponClass === ARCHETYPES[id].weaponClass, `${id}: identity`);
    for (const k of ["length", "mass", "balance", "inertia", "headLength", "sharpness", "curvature"] as const) {
      assert(Number.isFinite(w[k]), `${id}: ${k} finite`);
    }
    assert(w.inertia > 0 && w.mass > 0 && w.length > 0, `${id}: positive physics`);
    // Parallel-axis bound: I about the grip >= M b^2 (the centroidal inertia is never negative).
    assert(w.inertia >= w.mass * w.balance * w.balance - EPS, `${id}: inertia ${w.inertia} >= M b^2`);
    const tail = tailLength(id, axesOfSpec(w));
    assert(w.balance > -tail && w.balance < w.length - tail, `${id}: centre of mass on the weapon`);
    assert(w.name.length > 3 && w.id.startsWith(id), `${id}: named and identified`);
    assert(w.features.length >= 1, `${id}: has strike features`);
    assert((w.ranged !== undefined) === (id === "bow"), `${id}: only the bow is ranged`);
  });
});

Deno.test("weapons: every axis stays inside its archetype range (300 seeds x 17 archetypes)", () => {
  let checked = 0;
  forEachWeapon((w, id) => {
    const ax = ARCHETYPES[id].axes, v = axesOfSpec(w);
    for (const k of ["length", "mass", "headLength", "sharpness", "curvature", "headRadius", "balanceFraction"] as const) {
      assert(v[k] >= ax[k].min - 1e-6 && v[k] <= ax[k].max + 1e-6, `${id} seed ${w.seed}: ${k}=${v[k]} outside [${ax[k].min}, ${ax[k].max}]`);
      checked++;
    }
    const hilt = ARCHETYPES[id].hilt;
    if (hilt) {
      const handle = w.length - w.headLength - hilt.guardThickness - hilt.pommelLength;
      assert(handle >= hilt.handle.min - 1e-6 && handle <= hilt.handle.max + 1e-6, `${id}: handle ${handle} in the hilt range`);
    }
  });
  assert(checked === 17 * SEEDS_PER_ARCHETYPE * 7, `checked ${checked}`);
});

Deno.test("weapons: correlated axes (longer -> heavier) and curvature only on curved families", () => {
  for (const id of ARCHETYPE_IDS) {
    const L: number[] = [], M: number[] = [];
    for (let i = 1; i <= SEEDS_PER_ARCHETYPE; i++) {
      const w = weaponFromSeed(id, seedOf(i));
      L.push(w.length); M.push(w.mass);
      const range = ARCHETYPES[id].axes.curvature;
      if (range.max === 0) assert(w.curvature === 0, `${id}: straight family has curvature 0`);
    }
    const sl = summarize(L), sm = summarize(M);
    let cov = 0;
    for (let i = 0; i < L.length; i++) cov += (L[i] - sl.mean) * (M[i] - sm.mean);
    const corr = cov / L.length / (sl.stdev * sm.stdev);
    assert(corr > 0.3, `${id}: corr(length, mass) = ${corr.toFixed(2)} should be > 0.3`);
  }
});

Deno.test("weapons: strike features in the contract frame (edge faces +z, points beyond the grip)", () => {
  forEachWeapon((w, id) => {
    const edges = w.features.filter((f) => f.kind === "edge");
    for (const f of w.features) {
      if (f.kind === "edge" || f.kind === "shaft") assert(f.points.length >= 2, `${id}: ${f.kind} polyline`);
      else assert(f.points.length === 1, `${id}: ${f.kind} is one point`);
      assert(f.radius > 0, `${id}: ${f.kind} radius`);
      const mixSum = f.mix.cut + f.mix.thrust + f.mix.blunt;
      assert(Math.abs(mixSum - 1) < 1e-9, `${id}: feature mix sums to 1`);
      if (f.facing) assert(Math.abs(Math.hypot(...f.facing) - 1) < 1e-9, `${id}: ${f.kind} facing is a unit vector`);
      if (f.kind === "point") {
        assert(f.points[0][1] > 0, `${id}: point beyond the grip (y=${f.points[0][1]})`);
        assert(f.facing !== undefined, `${id}: point has a thrust axis`);
      }
    }
    if (edges.length > 0) {
      assert(edges[0].facing![2] > 0.5, `${id}: primary edge faces +z (facing.z=${edges[0].facing![2].toFixed(2)})`);
      for (const e of edges) for (const p of e.points) assert(p[1] > 0, `${id}: edge in front of the grip`);
    }
    if (ARCHETYPES[id].family === "blade") {
      const tip = w.features.find((f) => f.kind === "point")!;
      assert(tip.facing![1] > 0.8, `${id}: blade point thrusts along +y`);
      assert(edges.length === 2, `${id}: a primary and a back/false edge`);
      assert(edges[1].facing![2] < -0.5, `${id}: back edge faces -z`);
    }
    if (w.curvature > 0.2 && (id === "sabre" || id === "scythe")) {
      assert(edges[0].points.length >= 5, `${id}: a curved edge is a polyline that follows the curve`);
      const zs = edges[0].points.map((p) => p[2]);
      assert(Math.max(...zs) - Math.min(...zs) > 0.02, `${id}: the edge polyline bends`);
    }
  });
});

Deno.test("weapons: grips - two-handed weapons have an off grip; daggers prefer the reverse grip", () => {
  forEachWeapon((w, id) => {
    const main = w.grips.find((g) => g.id === "main");
    assert(main && main.y === 0, `${id}: main grip at the origin`);
    const tail = tailLength(id, axesOfSpec(w)), fwd = forwardLength(id, axesOfSpec(w));
    for (const g of w.grips) assert(g.y >= -tail && g.y <= fwd, `${id}: grip ${g.id} on the weapon (${g.y})`);
    if (w.hands >= 1.5) {
      const off = w.grips.find((g) => g.id === "off");
      assert(off, `${id}: two-handed weapons have an off grip`);
      if (id !== "bow") assert(off.y <= -0.09 + 1e-9, `${id}: off hand a palm or more behind the main hand (${off.y})`);
    }
    if (id === "dagger") {
      assert(main.modes[0] === "reverse" && main.modes.includes("forward"), "dagger: reverse first, forward allowed");
      assert(preferredGrip(w) === "reverse", "dagger prefers reverse");
    } else assert(!main.modes.includes("reverse"), `${id}: only daggers reverse`);
  });
  const rot = gripModeRotation("reverse");
  assert(Math.abs(rot[2] - Math.PI) < 1e-12 && rot[0] === 0, "reverse = half turn about z (edge keeps facing +z)");
});

Deno.test("weapons: the form re-derived from a spec matches the generated physics", () => {
  forEachWeapon((w, id) => {
    const f = weaponForm(w);
    assert(Math.abs(f.balance - w.balance) < 1e-6, `${id}: balance round-trips`);
    assert(Math.abs(f.inertia - w.inertia) < 1e-6, `${id}: inertia round-trips`);
    const total = f.parts.reduce((s, p) => s + p.mass, 0);
    assert(Math.abs(total - w.mass) < 1e-6, `${id}: part masses sum to the mass`);
    for (const p of f.parts) assert(p.mass >= 0, `${id}: ${p.name} mass >= 0`);
  });
});

Deno.test("weapons: rollWeapon respects options and rarity weights", () => {
  const rng = rng32(2026);
  for (let i = 0; i < 200; i++) {
    assert(rollWeapon(rng, { classes: ["heavy"] }).weaponClass === "heavy", "class filter");
    const w = rollWeapon(rng, { archetypes: ["bow", "spear"] });
    assert(w.archetype === "bow" || w.archetype === "spear", "archetype filter");
  }
  let threw = false;
  try { candidateArchetypes({ classes: ["finesse"], archetypes: ["maul"] }); } catch { threw = true; }
  assert(threw, "an empty pool throws");
  const counts = new Map<ArchetypeId, number>();
  const N = 6000;
  for (let i = 0; i < N; i++) {
    const id = rollWeapon(rng).archetype;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const totalWeight = ARCHETYPE_IDS.reduce((s, id) => s + ARCHETYPES[id].rollWeight, 0);
  for (const id of ARCHETYPE_IDS) {
    const expected = (N * ARCHETYPES[id].rollWeight) / totalWeight;
    const got = counts.get(id) ?? 0;
    assert(Math.abs(got - expected) < 0.25 * expected, `${id}: rolled ${got}, expected ~${expected.toFixed(0)}`);
  }
  assert(archetypesOfClass("heavy").length === 6 && archetypesOfClass("finesse").length === 6, "class roster sizes");
});

Deno.test("weapons: loadout resolves menu choices (default, random, archetype, legacy) and lists options", () => {
  assert(resolveWeapon("Warrior", undefined, 1).archetype === "longsword", "class default");
  assert(resolveWeapon("Barbarian", "", 1).archetype === "greataxe", "empty = class default");
  assert(resolveWeapon("Rogue", "warhammer", 1).archetype === "warhammer", "archetype id");
  assert(resolveWeapon("Rogue", "sword", 1).archetype === "longsword", "legacy type");
  assert(JSON.stringify(resolveWeapon("Mage", "random", 77)) === JSON.stringify(resolveWeapon("Mage", "random", 77)), "random is seeded");
  const kinds = new Set(Array.from({ length: 60 }, (_, i) => resolveWeapon("Mage", RANDOM_WEAPON, i).archetype));
  assert(kinds.size >= 10, `random spans the roster (${kinds.size} archetypes in 60 rolls)`);
  const opts = weaponMenuOptions();
  assert(opts.length === 2 + ARCHETYPE_IDS.length && opts[0].value === "" && opts[1].value === RANDOM_WEAPON, "menu rows");
  for (const o of opts.slice(2)) assert(ARCHETYPES[o.value as ArchetypeId].label === o.label && o.hint.length > 0, `row ${o.value}`);
});

Deno.test("weapons: readable names follow the axes ('Curved Bronze Sabre')", () => {
  let curved = 0;
  const seen = new Set<string>();
  for (let i = 1; i <= 400; i++) {
    const w: WeaponSpec = weaponFromSeed("sabre", seedOf(i), { metal: "bronze" });
    assert(w.name.endsWith("Bronze Sabre"), `name '${w.name}'`);
    if (w.name === "Curved Bronze Sabre") curved++;
    seen.add(w.name);
  }
  assert(curved > 20, `curved sabres are named so (${curved})`);
  assert(seen.size >= 3, "names vary with the axes");
  for (const id of ARCHETYPE_IDS) {
    const n = weaponFromSeed(id, 5).name;
    assert(/^[A-Z][a-z]+( [A-Z][a-z]+)* [A-Z][a-z]+$/.test(n), `${id}: '${n}' reads as words`);
  }
});
