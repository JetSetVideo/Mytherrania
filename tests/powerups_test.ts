import {
  PICKUP_KINDS,
  rollPickup,
  spawnPickups,
  pickupAt,
  applyPickup,
  tickBuffs,
  buffMultiplier,
} from "../src/game/PowerUps.ts";
import type { ActiveBuff, PickupDef, Rng } from "../src/game/PowerUps.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

/** Deterministic LCG so tests never flake. */
function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function def(id: string): PickupDef {
  const d = PICKUP_KINDS.find((k) => k.id === id);
  assert(d, `missing pickup def: ${id}`);
  return d;
}

const KNOWN_IDS = new Set(PICKUP_KINDS.map((k) => k.id));

Deno.test("rollPickup always returns a known table row", () => {
  const rng = makeRng(1);
  for (let i = 0; i < 5000; i++) {
    const d = rollPickup(rng);
    assert(KNOWN_IDS.has(d.id), `unknown id ${d.id}`);
    assert(Number.isFinite(d.weight) && d.weight > 0, "bad weight");
  }
});

Deno.test("rollPickup covers every row across a wide sample", () => {
  const rng = makeRng(42);
  const seen = new Set<string>();
  for (let i = 0; i < 20000; i++) seen.add(rollPickup(rng).id);
  for (const id of KNOWN_IDS) assert(seen.has(id), `never rolled ${id}`);
});

Deno.test("rollPickup respects weights within a loose tolerance", () => {
  const rng = makeRng(7);
  const counts = new Map<string, number>();
  const N = 100000;
  for (let i = 0; i < N; i++) {
    const id = rollPickup(rng).id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const total = PICKUP_KINDS.reduce((s, d) => s + d.weight, 0);
  for (const d of PICKUP_KINDS) {
    const observed = (counts.get(d.id) ?? 0) / N;
    const expected = d.weight / total;
    assert(
      Math.abs(observed - expected) < 0.01,
      `${d.id}: observed ${observed.toFixed(4)} vs expected ${expected.toFixed(4)}`,
    );
  }
});

Deno.test("spawnPickups returns exactly the requested count", () => {
  const drops = spawnPickups(makeRng(3), 25, 40);
  assert(drops.length === 25, `got ${drops.length}`);
});

Deno.test("spawnPickups lands every drop inside the ring radius", () => {
  const radius = 40;
  const drops = spawnPickups(makeRng(9), 2000, radius);
  for (const p of drops) {
    const dist = Math.sqrt(p.x * p.x + p.z * p.z);
    assert(dist <= radius + 1e-9, `drop at ${dist} exceeds radius ${radius}`);
    assert(Number.isFinite(p.x) && Number.isFinite(p.z), "non-finite coords");
  }
});

Deno.test("spawnPickups of zero radius stays at the origin", () => {
  const drops = spawnPickups(makeRng(5), 50, 0);
  for (const p of drops) {
    assert(Math.abs(p.x) < 1e-9 && Math.abs(p.z) < 1e-9, "expected origin");
  }
});

Deno.test("pickupAt returns null when nothing is in reach", () => {
  const drops = [{ def: def("coin"), x: 10, z: 0 }];
  const hit = pickupAt(drops, 0, 0, 0.5); // reach 1.0 + 0.5 = 1.5 < 10
  assert(hit === null, "expected null out of reach");
});

Deno.test("pickupAt returns the nearest pickup in reach", () => {
  const near = { def: def("coin"), x: 1.0, z: 0 };
  const far = { def: def("coin"), x: 1.4, z: 0 };
  const hit = pickupAt([far, near], 0, 0, 0.5); // both within 1.5, near is closer
  assert(hit === near, "expected nearest pickup");
});

Deno.test("pickupAt respects the combined pickup + fighter radius", () => {
  const drop = { def: def("health_orb"), x: 1.5, z: 0 }; // pickup radius 1.2
  assert(pickupAt([drop], 0, 0, 0.2) === null, "1.4 reach should miss at 1.5");
  assert(pickupAt([drop], 0, 0, 0.4) !== null, "1.6 reach should hit at 1.5");
});

Deno.test("applyPickup refresh keeps the value and restarts the timer", () => {
  const ward = def("ward"); // stack: "refresh", duration 12
  const first = applyPickup([], ward, 0);
  assert(first.length === 1, "buff should be added");
  assert(first[0].expiresAt === 12, "first expiry");

  const second = applyPickup(first, ward, 5);
  assert(second.length === 1, "refresh should not duplicate");
  assert(second[0].value === ward.value, "refresh keeps value");
  assert(second[0].expiresAt === 17, `expected expiry 17, got ${second[0].expiresAt}`);
});

Deno.test("applyPickup stack sums the value", () => {
  const rage = def("rage"); // stack: "stack", value 1.25
  const first = applyPickup([], rage, 0);
  assert(first[0].value === 1.25, "first value");
  const second = applyPickup(first, rage, 1);
  assert(second.length === 1, "stack should not duplicate");
  assert(second[0].value === 2.5, `expected 2.5, got ${second[0].value}`);
});

Deno.test("applyPickup replace swaps the value", () => {
  const focus = def("focus"); // stack: "replace", value 1.2
  const existing: ActiveBuff[] = [{ id: "focus", value: 9, expiresAt: 100 }];
  const next = applyPickup(existing, focus, 10);
  assert(next.length === 1, "replace should not duplicate");
  assert(next[0].value === 1.2, `expected swap to 1.2, got ${next[0].value}`);
  assert(next[0].expiresAt === 25, `expected expiry 25, got ${next[0].expiresAt}`);
});

Deno.test("applyPickup ignores instant pickups (duration 0)", () => {
  const orb = def("health_orb"); // duration 0
  const next = applyPickup([], orb, 0);
  assert(next.length === 0, "instant pickup must not linger as a buff");
});

Deno.test("applyPickup does not mutate the input list", () => {
  const ward = def("ward");
  const original: ActiveBuff[] = [{ id: "ward", value: 0.75, expiresAt: 5 }];
  const snapshot = JSON.stringify(original);
  applyPickup(original, ward, 3);
  assert(JSON.stringify(original) === snapshot, "input list was mutated");
});

Deno.test("tickBuffs drops exactly the expired buffs", () => {
  const buffs: ActiveBuff[] = [
    { id: "a", value: 1, expiresAt: 10 },
    { id: "b", value: 1, expiresAt: 20 },
    { id: "c", value: 1, expiresAt: 30 },
  ];
  const alive = tickBuffs(buffs, 20); // expiresAt <= 20 dropped => a and b
  assert(alive.length === 1, `expected 1, got ${alive.length}`);
  assert(alive[0].id === "c", "wrong survivor");
});

Deno.test("tickBuffs keeps a buff on its exact expiry boundary excluded", () => {
  const buffs: ActiveBuff[] = [{ id: "a", value: 1, expiresAt: 15 }];
  assert(tickBuffs(buffs, 15).length === 0, "boundary should expire");
  assert(tickBuffs(buffs, 14.999).length === 1, "just before boundary survives");
});

Deno.test("buffMultiplier combines live buffs of the same id", () => {
  const buffs: ActiveBuff[] = [
    { id: "rage", value: 1.25, expiresAt: 10 },
    { id: "rage", value: 1.25, expiresAt: 10 },
    { id: "ward", value: 0.75, expiresAt: 10 },
  ];
  const m = buffMultiplier(buffs, "rage");
  assert(Math.abs(m - 1.5625) < 1e-9, `expected 1.5625, got ${m}`);
});

Deno.test("buffMultiplier returns 1 for a missing buff", () => {
  const buffs: ActiveBuff[] = [{ id: "swift", value: 1.3, expiresAt: 10 }];
  assert(buffMultiplier(buffs, "rage") === 1, "missing buff must be 1");
  assert(buffMultiplier([], "rage") === 1, "empty list must be 1");
});

Deno.test("nothing produces NaN across a full pipeline", () => {
  const rng = makeRng(2024);
  let buffs: ActiveBuff[] = [];
  const drops = spawnPickups(rng, 100, 30);
  for (const drop of drops) {
    assert(Number.isFinite(drop.x) && Number.isFinite(drop.z), "NaN coords");
    buffs = applyPickup(buffs, drop.def, rng() * 60);
    for (const b of buffs) {
      assert(Number.isFinite(b.value), "NaN buff value");
      assert(Number.isFinite(b.expiresAt), "NaN expiry");
    }
  }
  buffs = tickBuffs(buffs, 1000);
  for (const k of PICKUP_KINDS) {
    const m = buffMultiplier(buffs, k.id);
    assert(Number.isFinite(m), `NaN multiplier for ${k.id}`);
  }
});
