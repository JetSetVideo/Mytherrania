// Lane N-C: concealment — invisibility as authoritative simulation state.
//
// Covers the state's shape and defaults, all four end conditions (attack, damage, proximity,
// expiry), the causal guard on a break timestamp, idempotence, and NaN refusal. Pure fixtures:
// fixed sim times in seconds, no randomness, no clock.

import {
  beginConcealment,
  breakConcealment,
  breakReasonFor,
  CONCEAL_BREAK_M,
  CONCEAL_MAX_S,
  stepConcealment,
  type ConcealFrame,
} from "../src/game/Concealment.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok {
  if (!ok) throw new Error(m);
}

function near(a: number, b: number, m: string, eps = 1e-9): void {
  assert(Math.abs(a - b) <= eps, `${m}: got ${a}, want ${b}`);
}

Deno.test("beginConcealment: defaults and finite; NaN time folds to 0", () => {
  const c = beginConcealment({ atS: 12.5 });
  assert(c.active, "a fresh vanish is active");
  near(c.startedAtS, 12.5, "startedAtS");
  assert(c.revealOnAttack === true, "attacking reveals by default");
  near(c.breakBelowM, CONCEAL_BREAK_M, "breakBelowM default");

  const custom = beginConcealment({ atS: 0, breakBelowM: 1.0 });
  near(custom.breakBelowM, 1.0, "breakBelowM override");

  const nan = beginConcealment({ atS: Number.NaN, breakBelowM: Number.NaN });
  near(nan.startedAtS, 0, "NaN time refused to 0");
  near(nan.breakBelowM, CONCEAL_BREAK_M, "NaN threshold refused to default");
});

Deno.test("breakConcealment: all four reasons end it", () => {
  const c = beginConcealment({ atS: 0 });
  for (const why of ["attack", "damage", "proximity", "expired"] as const) {
    const ended = breakConcealment(c, why, 1);
    assert(!ended.active, `${why} breaks the vanish`);
    assert(ended.startedAtS === 0, "window preserved");
  }
});

Deno.test("breakConcealment: attack does not reveal when revealOnAttack is false", () => {
  const c = { ...beginConcealment({ atS: 0 }), revealOnAttack: false };
  const afterAttack = breakConcealment(c, "attack", 1);
  assert(afterAttack.active, "an attack leaves an attack-safe vanish active");
  // The other reasons still break it.
  assert(!breakConcealment(c, "damage", 1).active, "damage still breaks");
});

Deno.test("breakConcealment: idempotent and causally guarded", () => {
  const c = beginConcealment({ atS: 5 });
  const ended = breakConcealment(c, "damage", 6);
  assert(!ended.active, "broken once");
  const again = breakConcealment(ended, "expired", 7);
  assert(again === ended, "a second break returns the same (already broken) object");
  // A break that would predate the start is refused — the window cannot be corrupted.
  const impossible = breakConcealment(c, "damage", 4);
  assert(impossible === c, "break before the start is refused");
});

Deno.test("breakReasonFor: contract ordering and each condition", () => {
  const c = beginConcealment({ atS: 100 });
  const far: ConcealFrame = { atS: 101, distanceM: 10 };

  // attack outranks geometry.
  assert(breakReasonFor(c, { ...far, attacked: true, distanceM: 0.5 }) === "attack", "attack first");
  // then damage.
  assert(breakReasonFor(c, { ...far, damaged: true, distanceM: 0.5 }) === "damage", "damage next");
  // then proximity at/inside the threshold.
  assert(breakReasonFor(c, { atS: 101, distanceM: 2.5 }) === "proximity", "proximity at the edge");
  near(c.breakBelowM, 2.5, "default threshold is 2.5 m");
  assert(breakReasonFor(c, { atS: 101, distanceM: 2.51 }) === null, "outside proximity holds");
  // then expiry at exactly CONCEAL_MAX_S.
  assert(breakReasonFor(c, { atS: 100 + CONCEAL_MAX_S }) === "expired", "expiry at the cap");
  assert(breakReasonFor(c, { atS: 100 + CONCEAL_MAX_S - 0.001 }) === null, "before the cap holds");
  // a quiet frame well inside every bound holds.
  assert(breakReasonFor(c, { atS: 101 }) === null, "no fact, no break");
  // an already-broken concealment has no reason.
  assert(breakReasonFor(breakConcealment(c, "damage", 101), { atS: 200 }) === null, "broken → null");
});

Deno.test("stepConcealment: one frame advances through breakReasonFor", () => {
  const c = beginConcealment({ atS: 0 });
  const held = stepConcealment(c, { atS: 3, distanceM: 8 });
  assert(held === c, "a quiet frame returns the same object");
  const viaProximity = stepConcealment(c, { atS: 3, distanceM: 2.0 });
  assert(!viaProximity.active, "walking into contact breaks it");
  const viaExpiry = stepConcealment(c, { atS: CONCEAL_MAX_S });
  assert(!viaExpiry.active, "expiry breaks it");
});

Deno.test("stepConcealment: NaN frame facts cannot break or extend wrongly", () => {
  const c = beginConcealment({ atS: 10 });
  const held = stepConcealment(c, { atS: Number.NaN, distanceM: Number.NaN });
  assert(held === c, "a NaN frame with no facts holds");
});
