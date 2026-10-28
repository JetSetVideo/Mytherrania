import { AiProfile, fold, Telemetry } from "../src/game/AiStats.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }
function assertEquals(a: unknown, b: unknown, m = ""): void { if (!Object.is(a, b)) throw new Error(`${m} expected ${b}, got ${a}`); }
function assertAlmostEquals(a: number, b: number, eps = 1e-6, m = ""): void { if (Math.abs(a - b) > eps) throw new Error(`${m} expected ~${b}, got ${a}`); }

Deno.test("fold returns zeros for empty input", () => {
  const s = fold([]);
  assertEquals(s.n, 0);
  assertEquals(s.mean, 0);
  assertEquals(s.median, 0);
});

Deno.test("fold computes mean, median, min, max over samples", () => {
  const s = fold([1, 2, 3, 4, 5]);
  assertEquals(s.n, 5);
  assertAlmostEquals(s.mean, 3);
  assertEquals(s.median, 3);
  assertEquals(s.min, 1);
  assertEquals(s.max, 5);
  // Even count: median is the average of the two middle values.
  assertEquals(fold([1, 2, 3, 4]).median, 2.5);
});

Deno.test("tick accumulates distance travelled and samples axes", () => {
  const t = new Telemetry();
  t.tick(0, 0, 0, 5, 0, 1, 0);
  t.tick(3, 0, 4, 4, 1, 0.9, 10);   // moved 3-4-5 = 5 m
  t.tick(6, 0, 4, 3, 2, 0.85, 20);  // moved 3 m
  assertAlmostEquals(t.distanceTravelled, 8);
  const d = t.digest();
  assertEquals(d.distToEnemy.min, 3);
  assertEquals(d.distToEnemy.max, 5);
  assertEquals(d.x.max, 6);
  assertEquals(d.z.max, 4);
});

Deno.test("hp thresholds fire once each, in order, with the fight state", () => {
  const t = new Telemetry();
  t.tick(0, 0, 0, 5, 1.0, 0.85, 0);
  t.tick(0, 0, 0, 5, 2.0, 0.79, 50);  // crosses 0.8
  t.tick(0, 0, 0, 5, 3.0, 0.45, 120); // crosses 0.5
  t.tick(0, 0, 0, 5, 4.0, 0.19, 200); // crosses 0.2
  t.tick(0, 0, 0, 5, 5.0, 0.18, 210); // 0.2 already fired
  const th = t.digest().thresholds;
  assertEquals(th.length, 3);
  assertEquals(th[0].hpRatio, 0.8);
  assertEquals(th[1].hpRatio, 0.5);
  assertEquals(th[2].hpRatio, 0.2);
  assertEquals(th[2].dealtSoFar, 200);
});

Deno.test("recordHit folds dealt and closing; peakWindow finds the busiest 5s", () => {
  const t = new Telemetry();
  for (let i = 0; i < 5; i++) t.recordHit(100, 1.2, i);       // 0-5s window, 500
  for (let i = 0; i < 2; i++) t.recordHit(400, 2.0, 6 + i);   // 5-10s window, 800
  const d = t.digest();
  assertEquals(d.dealt.n, 7);
  assertEquals(d.dealt.max, 400);
  assertAlmostEquals(d.closing.mean, (5 * 1.2 + 2 * 2.0) / 7, 1e-6);
  assertEquals(d.peakWindow.start, 5);
  assertEquals(d.peakWindow.damage, 800);
});

Deno.test("defence and missed feed the prevented/missed digest", () => {
  const t = new Telemetry();
  t.recordDefence(100, 30);  // prevented 70
  t.recordDefence(80, 60);   // prevented 20
  t.recordMissed(90);        // dodged entirely
  const d = t.digest();
  assertAlmostEquals(d.prevented.mean, 45);
  assertEquals(d.missed.max, 90);
});

Deno.test("favouriteTechnique tracks usage; a win updates the fastest-kill", () => {
  const p = new AiProfile(42);
  p.beginFight();
  p.telemetry.recordTechnique("power");
  p.telemetry.recordTechnique("power");
  p.telemetry.recordTechnique("dash");
  assertEquals(p.telemetry.digest().favouriteTechnique, "power");
  p.endFight("win", 23.5);
  assertAlmostEquals(p.telemetry.fastestWin, 23.5);
  assertEquals(p.wins, 1);
  p.endFight("loss", 40);
  assertAlmostEquals(p.winRate(), 0.5);
  // A fresh profile is undecided (0.5), not 0.
  assertEquals(new AiProfile(1).winRate(), 0.5);
});

Deno.test("identity is stable from a seed and unique across a roster", () => {
  const a = new AiProfile(7);
  const b = new AiProfile(7);
  assertEquals(a.id, b.id);            // reproducible
  assert(a.name.length > 0, "named");
  assert(a.id !== new AiProfile(8).id, "distinct seeds give distinct ids");
});

Deno.test("the digest never emits NaN, even if a body leaves the world", () => {
  const t = new Telemetry();
  t.tick(0, 0, 0, 5, 0, 1, 0);
  t.tick(NaN, NaN, NaN, NaN, 1, 0.9, 0);  // a fighter fell out: skip the sample
  t.tick(1, 0, 1, 4, 2, 0.8, 0);
  t.recordHit(NaN, NaN, 1);                // a NaN blow is dropped
  t.recordHit(120, 1.4, 2);
  t.recordDefence(NaN, 30);
  const d = t.digest();
  for (const [k, v] of Object.entries({ dist: d.distToEnemy.mean, dealt: d.dealt.mean, alt: d.altitude.mean, x: d.x.mean, prevented: d.prevented.mean, travelled: d.distanceTravelled })) {
    assert(Number.isFinite(v), `${k} must be finite, got ${v}`);
  }
  assertEquals(d.dealt.n, 1);       // only the finite hit counted
  assertEquals(d.dealt.max, 120);
});
