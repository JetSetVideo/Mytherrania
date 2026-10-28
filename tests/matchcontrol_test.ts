import {
  effectiveDuration,
  MATCH_LENGTHS,
  MAX_STEP_SECONDS,
  resolveLength,
  resolveSpeed,
  scaledMaxHealth,
  SPEEDS,
  stepTime,
} from "../src/game/MatchControl.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }

Deno.test("the length table offers standard, short and blitz with 1 / 0.5 / 0.25 scaling", () => {
  const byId = Object.fromEntries(MATCH_LENGTHS.map((l) => [l.id, l.healthScale]));
  assert(byId.standard === 1, "standard scales 1");
  assert(byId.short === 0.5, "short scales 0.5");
  assert(byId.blitz === 0.25, "blitz scales 0.25");
  assert(MATCH_LENGTHS.length === 3, "exactly three lengths");
});

Deno.test("the speed table offers half through eight with 0.5..8 time scales", () => {
  const byId = Object.fromEntries(SPEEDS.map((s) => [s.id, s.timeScale]));
  assert(byId.half === 0.5, "half scales 0.5");
  assert(byId.normal === 1, "normal scales 1");
  assert(byId.double === 2, "double scales 2");
  assert(byId.quad === 4, "quad scales 4");
  assert(byId.eight === 8, "eight scales 8");
  assert(SPEEDS.length === 5, "exactly five speeds");
});

Deno.test("blitz health is a quarter of standard", () => {
  const base = 400;
  assert(scaledMaxHealth(base, "blitz") === base * 0.25, "blitz is a quarter of standard");
  assert(scaledMaxHealth(base, "blitz") === scaledMaxHealth(base, "standard") / 4, "quarter of standard pool");
});

Deno.test("short health is half of standard", () => {
  assert(scaledMaxHealth(100, "short") === 50, "short halves the pool");
  assert(scaledMaxHealth(100, "standard") === 100, "standard leaves the pool alone");
});

Deno.test("scaled health is floored at 1 so a fighter never spawns dead", () => {
  assert(scaledMaxHealth(1, "blitz") === 1, "1 hp blitz stays at 1");
  assert(scaledMaxHealth(3, "blitz") === 1, "3 * 0.25 = 0.75 floors to 1");
  assert(scaledMaxHealth(0, "blitz") === 1, "even a zero base floors to 1");
  assert(scaledMaxHealth(1, "short") === 1, "0.5 floors to 1");
});

Deno.test("scaled health is a whole number", () => {
  assert(Number.isInteger(scaledMaxHealth(7, "short")), "7 * 0.5 = 3.5 floors to 3");
  assert(scaledMaxHealth(7, "short") === 3, "floors rather than rounds up");
});

Deno.test("stepTime scales the dt by the speed's time scale", () => {
  assert(stepTime(0.01, "normal") === 0.01, "normal passes dt through");
  assert(stepTime(0.01, "double") === 0.02, "double doubles the step");
  assert(stepTime(0.01, "half") === 0.005, "half halves the step");
  assert(stepTime(0.01, "quad") === 0.04, "quad quadruples the step");
});

Deno.test("stepTime clamps at 0.25 s at 8x with a large dt", () => {
  assert(stepTime(1, "eight") === MAX_STEP_SECONDS, "1 s * 8 clamps to 0.25");
  assert(stepTime(10, "eight") === MAX_STEP_SECONDS, "a huge dt clamps to 0.25");
  assert(stepTime(0.1, "eight") === MAX_STEP_SECONDS, "0.1 s * 8 = 0.8 clamps to 0.25");
  assert(stepTime(0.5, "quad") === MAX_STEP_SECONDS, "0.5 s * 4 = 2 clamps to 0.25");
  assert(stepTime(0.03, "eight") === 0.24, "just under the ceiling is untouched");
});

Deno.test("stepTime never goes negative on a negative dt", () => {
  assert(stepTime(-1, "eight") === 0, "a backwards dt yields zero advance");
  assert(stepTime(-0.01, "normal") === 0, "no negative simulated time");
});

Deno.test("effectiveDuration halves at double speed and eighths at 8x", () => {
  assert(effectiveDuration(120, "normal") === 120, "normal watches in real time");
  assert(effectiveDuration(120, "double") === 60, "double halves the watch time");
  assert(effectiveDuration(120, "eight") === 15, "8x is an eighth of the watch time");
  assert(effectiveDuration(120, "half") === 240, "half doubles the watch time");
});

Deno.test("resolveLength falls back to standard for an unknown id", () => {
  const unknown = resolveLength("marathon");
  assert(unknown.id === "standard", "unknown length resolves to standard");
  assert(unknown.healthScale === 1, "fallback keeps standard scaling");
  assert(resolveLength("blitz").id === "blitz", "a known id still resolves itself");
});

Deno.test("resolveSpeed falls back to normal for an unknown id", () => {
  const unknown = resolveSpeed("ludicrous");
  assert(unknown.id === "normal", "unknown speed resolves to normal");
  assert(unknown.timeScale === 1, "fallback keeps normal time scale");
  assert(resolveSpeed("quad").id === "quad", "a known id still resolves itself");
});

Deno.test("no length or speed output is NaN or negative", () => {
  for (const l of MATCH_LENGTHS) {
    const hp = scaledMaxHealth(100, l.id);
    assert(Number.isFinite(hp) && hp >= 1, `health for ${l.id} is finite and >= 1`);
  }
  for (const s of SPEEDS) {
    const step = stepTime(0.016, s.id);
    const dur = effectiveDuration(90, s.id);
    assert(Number.isFinite(step) && step >= 0, `step for ${s.id} is finite and non-negative`);
    assert(Number.isFinite(dur) && dur >= 0, `duration for ${s.id} is finite and non-negative`);
  }
});
