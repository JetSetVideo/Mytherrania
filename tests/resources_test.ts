import {
  createResources,
  EXHAUST_RECOVER_FRACTION,
  EXHAUST_REGEN_MUL,
  grantResource,
  regenResources,
  trySpend,
} from "../src/game/Resources.ts";
import type { CombatStats } from "../src/game/Stats.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(String(message)); }

Deno.test("grantResource restores a pool and clamps at its maximum", () => {
  const s = createResources(stats(5, 5));
  const drained = trySpend(s, "mana", 20)!;
  const back = grantResource(drained, "mana", 5);
  assert(back.mana.current === drained.mana.current + 5, "a grant adds exactly its amount");
  const over = grantResource(drained, "mana", 10000);
  assert(over.mana.current === over.mana.max, "an oversized grant clamps at the maximum");
  assert(over.mana.current > drained.mana.current, "the grant is not a no-op");
});

Deno.test("a negative or non-finite grant never drains a pool", () => {
  const s = createResources(stats(5, 5));
  const drained = trySpend(s, "mana", 20)!;
  for (const bad of [-50, Number.NaN, Infinity, -Infinity]) {
    assert(
      grantResource(drained, "mana", bad).mana.current === drained.mana.current,
      `grant(${bad}) must leave the pool unchanged`,
    );
  }
});

Deno.test("granting mana leaves stamina and exhaustion untouched", () => {
  const s = createResources(stats(5, 5));
  const emptied = trySpend(s, "stamina", s.stamina.max)!;
  assert(emptied.exhausted, "precondition: stamina emptied");
  const after = grantResource(emptied, "mana", 5);
  assert(after.stamina.current === emptied.stamina.current, "stamina is unchanged");
  assert(after.exhausted, "exhaustion is unchanged by a mana grant");
});

Deno.test("granting exactly the wake fraction lifts exhaustion (the inclusive boundary)", () => {
  const s = createResources(stats(5, 5));
  const max = s.stamina.max;
  const drained = trySpend(s, "stamina", max)!;
  assert(drained.exhausted, "emptying stamina exhausts the fighter");
  const atWake = grantResource(drained, "stamina", max * EXHAUST_RECOVER_FRACTION);
  assert(!atWake.exhausted, "exactly at the wake fraction wakes the fighter (>= is inclusive)");
  const justBelow = grantResource(drained, "stamina", max * EXHAUST_RECOVER_FRACTION - 0.001);
  assert(justBelow.exhausted, "just below the wake fraction stays exhausted");
});

Deno.test("mana regen really clamps, having actually been drained first", () => {
  const s = createResources(stats(5, 5));
  const drained = trySpend(s, "mana", s.mana.max * 0.5)!;
  assert(drained.mana.current < drained.mana.max, "mana was actually drained (not trivially full)");
  const full = regenResources(drained, 1000);
  assert(full.mana.current === full.mana.max, "regen fills the pool and stops exactly at max");
});

/** A minimal stat block; only intelligence and vitality feed the resource pools. */
function stats(intelligence: number, vitality: number): CombatStats {
  return {
    vitality, resilience: 5, focus: 5, reflex: 5, strength: 5, intelligence, agility: 5,
    maxHealth: 100, attackPower: 10, attackInterval: 1, armor: 4,
  };
}

Deno.test("mana and stamina maxima are monotonic in their governing stat", () => {
  let prevMana = -Infinity;
  for (const int of [1, 4, 8, 12, 20]) {
    const max = createResources(stats(int, 5)).mana.max;
    assert(max > prevMana, `mana max must rise with intelligence (int=${int})`);
    prevMana = max;
  }
  let prevStam = -Infinity;
  for (const vit of [1, 4, 8, 12, 20]) {
    const max = createResources(stats(5, vit)).stamina.max;
    assert(max > prevStam, `stamina max must rise with vitality (vit=${vit})`);
    prevStam = max;
  }
  // Each pool is governed by a different stat.
  const low = createResources(stats(1, 20));
  const high = createResources(stats(20, 1));
  assert(high.mana.max > low.mana.max, "mana follows intelligence");
  assert(low.stamina.max > high.stamina.max, "stamina follows vitality");
});

Deno.test("createResources starts every pool full and unexhausted", () => {
  const s = createResources(stats(10, 10));
  for (const pool of [s.mana, s.stamina]) {
    assert(pool.current === pool.max, "pool starts full");
    assert(pool.max > 0, "pool has a positive maximum");
    assert(pool.regenPerSecond > 0, "pool has a positive regen rate");
  }
  assert(s.exhausted === false, "starts rested");
});

Deno.test("regen scales with dt", () => {
  const base = createResources(stats(10, 10));
  const drained = trySpend(base, "mana", 20)!;
  assert(drained, "the spend succeeded");
  const oneSec = regenResources(drained, 1).mana.current - drained.mana.current;
  const halfSec = regenResources(drained, 0.5).mana.current - drained.mana.current;
  assert(oneSec > 0, "regen over a second is positive");
  assert(Math.abs(oneSec - halfSec * 2) < 1e-9, `regen is linear in dt (1s=${oneSec}, 0.5s=${halfSec})`);
  const zero = regenResources(drained, 0);
  assert(zero.mana.current === drained.mana.current, "dt=0 regenerates nothing");
});

Deno.test("regen clamps at the pool maximum", () => {
  const base = createResources(stats(10, 10));
  const drained = trySpend(base, "stamina", base.stamina.max)!;
  const big = regenResources(drained, 1e6);
  assert(big.mana.current === big.mana.max, "mana clamps at its maximum");
  assert(big.stamina.current <= big.stamina.max, "stamina never exceeds its maximum");
});

Deno.test("a power whose cost exceeds the current resource is refused", () => {
  const s = createResources(stats(10, 10));
  const after = trySpend(s, "mana", s.mana.current + 1);
  assert(after === null, "an unaffordable power returns null");
  const drained = trySpend(s, "stamina", s.stamina.max)!;
  assert(trySpend(drained, "stamina", 1) === null, "an empty pool refuses any positive cost");
});

Deno.test("spending reduces exactly the cost", () => {
  const s = createResources(stats(10, 10));
  const after = trySpend(s, "mana", 15)!;
  assert(after, "the spend succeeded");
  assert(Math.abs(after.mana.current - (s.mana.current - 15)) < 1e-9, "mana dropped by exactly the cost");
  assert(after.stamina.current === s.stamina.current, "stamina is untouched");
  const big = trySpend(after, "mana", after.mana.current)!;
  assert(big.mana.current === 0, "spending the whole pool leaves exactly zero");
});

Deno.test("a zero-cost power always succeeds", () => {
  const s = createResources(stats(10, 10));
  const after = trySpend(s, "mana", 0)!;
  assert(after, "zero cost is accepted");
  assert(after.mana.current === s.mana.current, "zero cost changes nothing");
  assert(after.exhausted === false, "zero cost does not exhaust");
});

Deno.test("emptying stamina enters the exhausted state", () => {
  const s = createResources(stats(10, 10));
  const drained = trySpend(s, "stamina", s.stamina.max)!;
  assert(drained.stamina.current === 0, "stamina is empty");
  assert(drained.exhausted === true, "emptying stamina exhausts the fighter");
  const partial = trySpend(s, "stamina", s.stamina.max - 1)!;
  assert(partial.exhausted === false, "leaving one point of stamina is not exhaustion");
});

Deno.test("exhaustion lifts only after stamina recovers past the wake fraction", () => {
  const s = createResources(stats(10, 10));
  const drained = trySpend(s, "stamina", s.stamina.max)!;
  const wakeAt = s.stamina.max * EXHAUST_RECOVER_FRACTION;
  // Small dt keeps stamina below the wake threshold: still exhausted.
  const below = regenResources(drained, 5);
  assert(below.stamina.current < wakeAt, "still below the wake threshold");
  assert(below.exhausted === true, "exhaustion persists below the threshold");
  // A large dt pushes past the threshold: exhaustion clears.
  const above = regenResources(below, 20);
  assert(above.stamina.current >= wakeAt, "now above the wake threshold");
  assert(above.exhausted === false, "exhaustion lifts once recovered");
});

Deno.test("exhausted stamina regenerates more slowly than rested stamina", () => {
  const s = createResources(stats(10, 10));
  const rested = trySpend(s, "stamina", 10)!;
  assert(rested.exhausted === false, "a small spend does not exhaust");
  const tired = trySpend(s, "stamina", s.stamina.max)!;
  assert(tired.exhausted === true, "an empty pool is exhausted");
  const restedGain = regenResources(rested, 1).stamina.current - rested.stamina.current;
  const tiredGain = regenResources(tired, 1).stamina.current - tired.stamina.current;
  assert(restedGain > tiredGain, `rested regen (${restedGain}) beats exhausted regen (${tiredGain})`);
  assert(Math.abs(tiredGain - restedGain * EXHAUST_REGEN_MUL) < 1e-9, "exhausted regen uses the penalty multiplier");
});

Deno.test("spending mana never touches stamina or exhaustion", () => {
  const s = createResources(stats(10, 10));
  const after = trySpend(s, "mana", s.mana.current)!;
  assert(after.mana.current === 0, "mana emptied");
  assert(after.stamina.current === s.stamina.current, "stamina unchanged");
  assert(after.exhausted === false, "emptying mana does not exhaust");
});

Deno.test("negative and non-finite costs are handled safely", () => {
  const s = createResources(stats(10, 10));
  const refund = trySpend(s, "mana", -50)!;
  assert(refund, "a negative cost is clamped, not applied as a refund");
  assert(refund.mana.current === s.mana.current, "negative cost cannot grow the pool");
  assert(trySpend(s, "mana", Number.NaN) === null, "NaN cost is refused");
  assert(trySpend(s, "mana", Number.POSITIVE_INFINITY) === null, "infinite cost is refused");
  assert(trySpend(s, "stamina", Number.NEGATIVE_INFINITY) === null, "non-finite costs are refused");
});

Deno.test("no entry point ever returns NaN or a negative pool", () => {
  const samples = [stats(10, 10), stats(Number.NaN, -5), stats(Number.POSITIVE_INFINITY, 0), stats(-3, 1e9)];
  const dts = [0, 0.016, 1, -4, Number.NaN, Number.POSITIVE_INFINITY];
  const costs = [0, 1, 999999, -10, Number.NaN, Number.POSITIVE_INFINITY];
  for (const st of samples) {
    const fresh = createResources(st);
    for (const kind of ["mana", "stamina"] as const) {
      for (const dt of dts) {
        const r = regenResources(fresh, dt);
        for (const pool of [r.mana, r.stamina]) {
          assert(Number.isFinite(pool.current) && pool.current >= 0, `regen kept ${kind} finite and non-negative`);
          assert(pool.current <= pool.max, "regen never exceeds the maximum");
        }
      }
      for (const cost of costs) {
        const spent = trySpend(fresh, kind, cost);
        if (spent === null) continue;
        for (const pool of [spent.mana, spent.stamina]) {
          assert(Number.isFinite(pool.current) && pool.current >= 0, `spend kept ${kind} finite and non-negative`);
          assert(pool.current <= pool.max, "spend never exceeds the maximum");
        }
      }
    }
  }
});
