// Lane M-A: the live fight-telemetry accumulator. Exact stats on hand-built fixtures: a
// zero-hit match, a single-hit match, a match where the fighters never move, a NaN step that
// must be REFUSED, plus objects/jumps/evolution/weapons. Every distance/streak/band number here
// is computed by hand in the comment above it, so a regression is a wrong number, not a wrong
// assertion.

import {
  CONTACT_M,
  CIRCLING_M,
  createTelemetry,
  type FightTelemetry,
} from "../src/game/FightTelemetry.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok {
  if (!ok) throw new Error(m);
}

/** Field-by-field closeness for a bogus hand-typed number, so a typo fails with a number. */
function near(a: number, b: number, m: string, eps = 1e-9): void {
  assert(Math.abs(a - b) <= eps, `${m}: got ${a}, want ${b}`);
}

/** durationS split as the accumulator sees it: quiet seconds + active (hit/object) seconds. */
function activeS(seq: readonly { dt: number; hit?: boolean; object?: boolean }[]): number {
  return seq.reduce((s, x) => s + (x.hit || x.object ? x.dt : 0), 0);
}

/** The invariant the brief demands: quiet + active == duration, within 1e-9. */
function assertPartition(t: FightTelemetry, seq: readonly { dt: number; hit?: boolean; object?: boolean }[]): void {
  near(t.quietS + activeS(seq), t.durationS, "quietS + landingTime == durationS");
  const bandSum = t.bands.contact + t.bands.striking + t.bands.circling + t.bands.apart;
  near(bandSum, t.durationS, "distance bands sum to durationS");
}

Deno.test("M-A: zero-hit match — one dry run per fighter, the whole match is quiet", () => {
  const a = createTelemetry();
  // 6 substeps of 0.5 s (duration 3 s), distance 8→3 m (strictly closing), no hits.
  const dist = [8, 7, 6, 5, 4, 3];
  for (const d of dist) a.step(0.5, d);
  const t = a.summary();

  near(t.durationS, 3, "duration");
  // A fighter that never lands has exactly ONE dry streak: the whole match.
  for (const f of [0, 1] as const) {
    assert(t.dryStreak[f].count === 1, `fighter ${f}: one dry streak`);
    near(t.dryStreak[f].totalS, 3, `fighter ${f}: dry total`);
    near(t.dryStreak[f].meanS, 3, `fighter ${f}: dry mean`);
    near(t.dryStreak[f].maxS, 3, `fighter ${f}: dry max`);
    near(t.dryStreak[f].minS, 3, `fighter ${f}: dry min`);
  }
  // No hit landed anywhere: the whole match is quiet and mutually dry.
  near(t.quietS, 3, "quietS");
  near(t.quietMaxS, 3, "quietMaxS");
  near(t.mutualDryS, 3, "mutualDryS");
  // describe([8,7,6,5,4,3]): mean = 5.5, median = (5+6)/2 = 5.5, min 3, max 8.
  // percentile nearest-rank: p10 → rank ceil(0.6)=1 → 3; p90 → rank ceil(5.4)=6 → 8.
  near(t.distance.mean, 5.5, "distance mean");
  near(t.distance.median, 5.5, "distance median");
  near(t.distance.min, 3, "distance min");
  near(t.distance.max, 8, "distance max");
  near(t.distance.p10, 3, "distance p10");
  near(t.distance.p90, 8, "distance p90");
  // Bands: 8,7 → apart (2×0.5=1 s); 6,5,4,3 → circling (4×0.5=2 s).
  near(t.bands.apart, 1, "apart band");
  near(t.bands.circling, 2, "circling band");
  near(t.bands.contact, 0, "contact band");
  near(t.bands.striking, 0, "striking band");
  // Closing every step after the first: 5×0.5 = 2.5 s. No contact. Stand-off = 8,7 (>6) = 1 s.
  near(t.engagement.closingS, 2.5, "closingS");
  near(t.engagement.contactS, 0, "contactS");
  near(t.engagement.standoffMaxS, 1, "standoffMaxS");
  assert(t.jumps[0].count === 0 && t.jumps[1].count === 0, "no jumps");
  assert(Object.keys(t.damageByWeapon).length === 0, "no weapons");
  assertPartition(t, dist.map(() => ({ dt: 0.5 })));
});

Deno.test("M-A: single-hit match — the landing step is active, not dry; absorbed lands on the defender", () => {
  const a = createTelemetry();
  // 4 substeps of 1 s, distance 5 m (circling), fighter 0 lands once on step 3 (damage 20, absorbed 8, sword).
  a.step(1, 5);
  a.step(1, 5);
  a.hit(0, 20, 8, "sword");
  a.step(1, 5);
  a.step(1, 5);
  const t = a.summary();

  near(t.durationS, 4, "duration");
  // Fighter 0 lands once: dry runs [0→3)=2 s (closes on step 3) and [4→end]=1 s. count 2, total 3.
  assert(t.dryStreak[0].count === 2, "f0: two dry runs");
  near(t.dryStreak[0].totalS, 3, "f0: dry total");
  near(t.dryStreak[0].meanS, 1.5, "f0: dry mean");
  near(t.dryStreak[0].maxS, 2, "f0: dry max (the lead-in)");
  near(t.dryStreak[0].minS, 1, "f0: dry min (the tail)");
  // Fighter 1 never lands: one dry run over the whole match.
  assert(t.dryStreak[1].count === 1, "f1: one dry run");
  near(t.dryStreak[1].totalS, 4, "f1: dry total");
  near(t.dryStreak[1].maxS, 4, "f1: dry max");
  // Step 3 is a landing second: quiet runs are [2 s, 1 s], total 3, longest 2.
  near(t.quietS, 3, "quietS");
  near(t.quietMaxS, 2, "quietMaxS");
  near(t.mutualDryS, 3, "mutualDryS");
  // Constant 5 m → circling for all 4 s; no closing, no contact, no stand-off (5 <= 6).
  near(t.distance.mean, 5, "distance mean");
  near(t.distance.median, 5, "distance median");
  near(t.bands.circling, 4, "circling band");
  near(t.engagement.closingS, 0, "closingS");
  near(t.engagement.standoffMaxS, 0, "standoffMaxS");
  // Damage: dealt by 0, taken by 1, absorbed by 1; per-weapon "sword".
  assert(t.damageDealt[0].count === 1 && t.damageDealt[0].total === 20 && t.damageDealt[0].max === 20, "dealt[0]");
  assert(t.damageDealt[1].count === 0 && t.damageDealt[1].total === 0, "dealt[1] empty");
  assert(t.damageTaken[1].count === 1 && t.damageTaken[1].total === 20, "taken[1]");
  assert(t.damageTaken[0].count === 0, "taken[0] empty");
  assert(t.damageAbsorbed[1].count === 1 && t.damageAbsorbed[1].total === 8 && t.damageAbsorbed[1].max === 8, "absorbed[1]");
  assert(t.damageAbsorbed[0].count === 0, "absorbed[0] empty");
  const sword = t.damageByWeapon["sword"];
  assert(sword && sword.count === 1 && sword.total === 20 && sword.mean === 20, "per-weapon sword");
  assertPartition(t, [{ dt: 1 }, { dt: 1 }, { dt: 1, hit: true }, { dt: 1 }]);
});

Deno.test("M-A: fighters never move — constant contact distance, bands and stats are flat", () => {
  const a = createTelemetry();
  // 5 substeps of 2 s (duration 10 s) at a constant 0.9 m (inside contact), no hits.
  for (let i = 0; i < 5; i++) a.step(2, 0.9);
  const t = a.summary();

  near(t.durationS, 10, "duration");
  near(t.distance.mean, 0.9, "distance mean");
  near(t.distance.median, 0.9, "distance median");
  near(t.distance.min, 0.9, "distance min");
  near(t.distance.max, 0.9, "distance max");
  near(t.distance.p10, 0.9, "distance p10");
  near(t.distance.p90, 0.9, "distance p90");
  near(t.bands.contact, 10, "contact band");
  near(t.engagement.contactS, 10, "contactS");
  near(t.engagement.closingS, 0, "closingS (never approaching)");
  near(t.engagement.standoffMaxS, 0, "no stand-off inside 6 m");
  near(t.quietS, 10, "quietS");
  near(t.dryStreak[0].maxS, 10, "f0 dry max");
  assertPartition(t, [{ dt: 2 }, { dt: 2 }, { dt: 2 }, { dt: 2 }, { dt: 2 }]);
});

Deno.test("M-A: a non-finite step is REFUSED — it cannot poison the distance mean", () => {
  // The clean reference match.
  const clean = createTelemetry();
  clean.step(1, 5);
  clean.step(1, 5);
  clean.hit(0, 20, 8, "sword");
  clean.step(1, 5);
  clean.step(1, 5);
  const want = clean.summary();

  // The same match with one NaN distance step slipped in.
  const poisoned = createTelemetry();
  poisoned.step(1, 5);
  poisoned.step(1, 5);
  poisoned.hit(0, 20, 8, "sword");
  poisoned.step(1, 5);
  poisoned.step(1, Number.NaN);
  poisoned.step(1, 5);
  const got = poisoned.summary();
  assert(poisoned.refused === 1, `exactly one refused step (got ${poisoned.refused})`);
  assert(Number.isFinite(got.distance.mean), "the mean is finite, not NaN");
  near(got.distance.mean, want.distance.mean, "refused step did not move the mean");
  assert(JSON.stringify(got) === JSON.stringify(want), "refused summary is byte-identical to the clean one");

  // A NaN dt and a non-finite damage are refused too.
  const other = createTelemetry();
  other.step(Number.NaN, 5);
  other.hit(0, Number.NaN);
  other.jump(0, Number.POSITIVE_INFINITY);
  assert(other.refused === 3, `three refusals (got ${other.refused})`);
  near(other.durationS, 0, "a refused step adds no time");
  assert(other.summary().damageDealt[0].count === 0, "a refused hit is not counted");
});

Deno.test("M-A: objects, jumps, weapons and evolution accumulate exactly", () => {
  const a = createTelemetry();
  // 3 substeps of 1 s at 7 m (apart). The middle substep has an object event: mutually dry, not quiet.
  a.step(1, 7);
  a.object("attacked");
  a.step(1, 7);
  a.step(1, 7);
  // Two jumps by fighter 0, one by fighter 1.
  a.jump(0, 1.5);
  a.jump(0, 2.2);
  a.jump(1, 0.8);
  // Two weapons.
  a.hit(1, 10, 0, "bow");
  a.step(1, 7);
  a.hit(1, 4, 2, "bow");
  a.step(1, 7);
  // Evolution events.
  a.evolution(2, 0.05);
  a.evolution(3, 0.05);
  const t = a.summary();

  // The object substep is mutually dry but breaks the quiet run: quiet runs [1 s, 1 s] (steps 1 and 3).
  near(t.mutualDryS, 3, "mutualDryS counts the object substep");
  near(t.quietS, 2, "quietS excludes the object substep");
  near(t.quietMaxS, 1, "quiet runs are one second each");
  assert(t.objects.attacked === 1 && t.objects.taken === 0 && t.objects.destroyed === 0 && t.objects.defended === 0, "object counters");
  // Jumps: fighter 0 → count 2, total 3.7, max 2.2, mean 1.85; fighter 1 → count 1, total 0.8.
  assert(t.jumps[0].count === 2, "f0 jump count");
  near(t.jumps[0].total, 3.7, "f0 jump total", 1e-12);
  near(t.jumps[0].max, 2.2, "f0 jump peak", 1e-12);
  near(t.jumps[0].mean, 1.85, "f0 jump mean", 1e-12);
  assert(t.jumps[1].count === 1 && t.jumps[1].max === 0.8, "f1 jump");
  // Weapon "bow": fighter 1 landed twice (10 then 4) for 14 total; the highest single blow is 10.
  const bow = t.damageByWeapon["bow"];
  assert(bow && bow.count === 2 && bow.total === 14 && bow.max === 10 && bow.mean === 7, "per-weapon bow");
  // Fighter 1 dealt 14, fighter 0 took 14; fighter 0 absorbed 2 on the second blow.
  assert(t.damageDealt[1].count === 2 && t.damageDealt[1].total === 14, "dealt[1]");
  assert(t.damageTaken[0].total === 14, "taken[0]");
  assert(t.damageAbsorbed[0].count === 1 && t.damageAbsorbed[0].total === 2, "absorbed[0]");
  assert(t.evolution.length === 2 && t.evolution[1].level === 3 && t.evolution[0].statDelta === 0.05, "evolution events");
  // Stand-off: steps 1-3 at 7 m (>CIRCLING_M) — but steps 4/5 land hits, so the run is steps 1-3 = 3 s.
  near(t.engagement.standoffMaxS, 3, "standoffMaxS");
  assertPartition(t, [
    { dt: 1 }, { dt: 1, object: true }, { dt: 1 }, { dt: 1, hit: true }, { dt: 1, hit: true },
  ]);
});

Deno.test("M-A: empty match and single substep are total (zeros, never NaN)", () => {
  const empty = createTelemetry().summary();
  assert(empty.durationS === 0, "no time");
  assert(empty.dryStreak[0].count === 0 && empty.dryStreak[0].minS === 0, "no dry streak");
  assert(empty.distance.mean === 0 && empty.distance.p90 === 0, "distance zeros");
  assert(Number.isFinite(empty.quietS) && empty.bands.contact === 0, "finite quiet zero");
  assert(Object.keys(empty.damageByWeapon).length === 0, "no weapons");

  const one = createTelemetry();
  one.step(0.25, CIRCLING_M); // exactly the circling edge → circling
  const t = one.summary();
  near(t.bands.circling, 0.25, "the edge belongs to circling");
  near(t.bands.striking, 0, "not striking");
  near(t.engagement.standoffMaxS, 0, "6 m is not beyond CIRCLING_M");
  const inner = createTelemetry();
  inner.step(0.25, CONTACT_M); // exactly the contact edge → contact
  near(inner.summary().bands.contact, 0.25, "the edge belongs to contact");
});

Deno.test("M-A: printed summary for the single-hit scripted fixture", () => {
  const a = createTelemetry();
  a.step(1, 5);
  a.step(1, 5);
  a.hit(0, 20, 8, "sword");
  a.step(1, 5);
  a.step(1, 5);
  const t = a.summary();
  const lines: string[] = [];
  lines.push(`durationS ${t.durationS}  quietS ${t.quietS} (max ${t.quietMaxS})  mutualDryS ${t.mutualDryS}`);
  lines.push(`dryStreak  f0 ${JSON.stringify(t.dryStreak[0])}  f1 ${JSON.stringify(t.dryStreak[1])}`);
  lines.push(`distance   mean ${t.distance.mean}  median ${t.distance.median}  min ${t.distance.min}  max ${t.distance.max}  p10 ${t.distance.p10}  p90 ${t.distance.p90}`);
  lines.push(`bands      contact ${t.bands.contact}  striking ${t.bands.striking}  circling ${t.bands.circling}  apart ${t.bands.apart}`);
  lines.push(`engagement closingS ${t.engagement.closingS}  contactS ${t.engagement.contactS}  standoffMaxS ${t.engagement.standoffMaxS}`);
  lines.push(`jumps      f0 ${JSON.stringify(t.jumps[0])}  f1 ${JSON.stringify(t.jumps[1])}`);
  lines.push(`dealt      f0 ${JSON.stringify(t.damageDealt[0])}  f1 ${JSON.stringify(t.damageDealt[1])}`);
  lines.push(`absorbed   f0 ${JSON.stringify(t.damageAbsorbed[0])}  f1 ${JSON.stringify(t.damageAbsorbed[1])}`);
  lines.push(`byWeapon   ${JSON.stringify(t.damageByWeapon)}`);
  console.log(lines.join("\n"));
  assert(t.durationS === 4, "printed fixture is the single-hit match");
});
