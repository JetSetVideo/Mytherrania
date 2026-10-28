import {
  clamp, damp, dampAngle, easeInOutCubic, invLerp, lambdaFromHalfLife, lerp, lerpAngle, normalizeMinMax,
  PARETO_80_20_ALPHA, paretoSample, quantileSorted, remap, rng32, smootherstep, smoothstep, springStep,
  summarize, topShare, wrapAngle, type Spring,
} from "../src/core/MathCore.ts";

function near(a: number, b: number, eps = 1e-9, m = ""): void {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${m} expected ~${b}, got ${a}`);
}
function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

Deno.test("clamp rejects NaN and holds both bounds", () => {
  near(clamp(NaN, 0, 1), 0); near(clamp(-2, 0, 1), 0); near(clamp(2, 0, 1), 1); near(clamp(0.3, 0, 1), 0.3);
});

Deno.test("lerp / invLerp / remap are inverses on known points", () => {
  near(lerp(2, 6, 0.25), 3); near(invLerp(2, 6, 3), 0.25); near(invLerp(1, 1, 5), 0);
  near(remap(15, 10, 20, 0, 100), 50); near(remap(99, 10, 20, 0, 100), 100, 0, "output is clamped");
});

Deno.test("smoothstep and smootherstep hit 0, 0.5, 1 with flat ends", () => {
  for (const f of [smoothstep, smootherstep]) {
    near(f(0, 1, 0), 0); near(f(0, 1, 0.5), 0.5); near(f(0, 1, 1), 1);
    assert(f(0, 1, 1e-3) < 1e-5, "zero slope at the start");
  }
  near(easeInOutCubic(0.5), 0.5); near(easeInOutCubic(1), 1);
});

Deno.test("damp is frame-rate independent: two half steps equal one whole step", () => {
  const whole = damp(0, 10, 5, 0.1);
  const halves = damp(damp(0, 10, 5, 0.05), 10, 5, 0.05);
  near(whole, halves, 1e-12);
  near(damp(0, 10, lambdaFromHalfLife(0.2), 0.2), 5, 1e-9, "half-life closes half the gap");
});

Deno.test("angles wrap into (-PI, PI] and interpolate along the short arc", () => {
  near(wrapAngle(3 * Math.PI), Math.PI, 1e-9); near(wrapAngle(-Math.PI), Math.PI, 1e-9);
  const mid = lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
  near(Math.abs(wrapAngle(mid)), Math.PI, 1e-9, "short arc crosses PI, not 0");
  const d = dampAngle(3, -3, 1000, 1);
  near(wrapAngle(d), -3, 1e-6);
});

Deno.test("a critically damped spring converges without overshoot", () => {
  const s: Spring = { value: 0, velocity: 0 };
  let peak = 0;
  for (let i = 0; i < 240; i++) { springStep(s, 1, 0.25, 1 / 60); peak = Math.max(peak, s.value); }
  near(s.value, 1, 1e-3, "converged");
  assert(peak <= 1 + 1e-9, `no overshoot, peak ${peak}`);
});

Deno.test("summarize returns min, max, mean, median, Pareto cut points and spread", () => {
  const s = summarize([5, 1, 4, 2, 3]);
  near(s.min, 1); near(s.max, 5); near(s.mean, 3); near(s.median, 3); near(s.spread, 4);
  near(s.p20, 1.8); near(s.p80, 4.2); near(s.stdev, Math.SQRT2);
  near(quantileSorted([0, 10], 0.25), 2.5);
  let threw = false;
  try { summarize([]); } catch { threw = true; }
  assert(threw, "empty sample is an error, not NaN");
});

Deno.test("normalizeMinMax maps onto [0,1] and a flat sample onto 0", () => {
  const a = [2, 4, 6]; normalizeMinMax(a); near(a[0], 0); near(a[1], 0.5); near(a[2], 1);
  const f = [3, 3]; normalizeMinMax(f); near(f[0], 0); near(f[1], 0);
});

Deno.test("Pareto(alpha=log5/log4) gives the 80/20 rule on a large sample", () => {
  near(PARETO_80_20_ALPHA, 1.160964, 1e-6);
  const r = rng32(7);
  const xs = Array.from({ length: 200_000 }, () => paretoSample(r, 1, PARETO_80_20_ALPHA, 1e6));
  const share = topShare(xs, 0.2);
  assert(share > 0.7 && share < 0.88, `top 20% share ~0.8, got ${share.toFixed(3)}`);
  assert(Math.min(...xs.slice(0, 1000)) >= 1, "every draw is at least xm");
});

Deno.test("rng32 is reproducible per seed and differs across seeds", () => {
  const a = rng32(42), b = rng32(42), c = rng32(43);
  const sa = [a(), a(), a()], sb = [b(), b(), b()], sc = [c(), c(), c()];
  assert(sa.every((v, i) => v === sb[i]), "same seed, same stream");
  assert(sa.some((v, i) => v !== sc[i]), "different seed, different stream");
  assert(sa.every((v) => v >= 0 && v < 1), "range [0,1)");
});
