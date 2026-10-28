// W04: the live arena's minimum size is DERIVED from gameplay (spawn, dash, knockback slide,
// prop bypass, wall clearance) and every path into the engine lands inside [MIN, MAX].
import {
  ARENA_SIZE_STEP, ARENA_SLIDER_RANDOM, arenaSizeFromSlider, clampLiveArenaSize, LIVE_ARENA_MAX, LIVE_ARENA_MIN,
  liveArenaMinimum,
} from "../src/ui/Menu.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}

Deno.test("arena minimum: the derivation's terms and result", () => {
  const t = liveArenaMinimum();
  // Each term from its source: Engine spawn 2.5 m, the longest skill lunge, 7 m/s x stone tau,
  // the widest prop (arch, r 1.9 m) + one body diameter, one body radius to the wall.
  assert(t.spawnOffset === 2.5 && t.throwSpeed === 7 && t.bodyRadius === 0.5, "base parameters");
  assert(t.longestDash >= 3 && t.longestDash <= 5, `longest dash ${t.longestDash}`);
  assert(Math.abs(t.half - (t.spawnOffset + t.longestDash + t.throwSpeed * t.slideTime + t.largestProp + 3 * t.bodyRadius)) < 1e-9, "half = s + d + v*tau + prop + 3r");
  assert(t.size >= 2 * t.half && t.size - 2 * t.half < ARENA_SIZE_STEP, `size ${t.size} rounds 2 x ${t.half} up to the step`);
  assert(t.size % ARENA_SIZE_STEP === 0, "size is a slider notch");
  assert(LIVE_ARENA_MIN === t.size, "the export is the derivation");
  assert(LIVE_ARENA_MIN >= 4 * 8, `minimum ${LIVE_ARENA_MIN} m must be much larger than the old 8 m`);
  assert(LIVE_ARENA_MIN < LIVE_ARENA_MAX, "range is not empty");
  console.log(`LIVE_ARENA_MIN = ${LIVE_ARENA_MIN} m (half ${t.half.toFixed(2)} m: spawn ${t.spawnOffset} + dash ${t.longestDash} + slide ${(t.throwSpeed * t.slideTime).toFixed(2)} + prop ${t.largestProp.toFixed(2)} + 3r ${3 * t.bodyRadius})`);
});

Deno.test("arena size: the slider's bottom notch and anything below the minimum are random", () => {
  assert(arenaSizeFromSlider(0) === null, "0 = random");
  assert(arenaSizeFromSlider(ARENA_SLIDER_RANDOM) === null, "bottom notch = random");
  assert(arenaSizeFromSlider(LIVE_ARENA_MIN - 0.01) === null, "just below the minimum = random");
  assert(arenaSizeFromSlider(NaN) === null, "NaN = random");
  assert(arenaSizeFromSlider(LIVE_ARENA_MIN) === LIVE_ARENA_MIN, "the minimum itself is a fixed size");
  assert(arenaSizeFromSlider(LIVE_ARENA_MAX + 50) === LIVE_ARENA_MAX, "above the max clamps");
});

Deno.test("arena size: the engine clamp puts every random size inside the live range", () => {
  // randomArena's archetypes draw 2-5 m closets, 6-14 m pits and 14-120 m fields.
  for (const size of [2, 5, 8, 14, 33.9, LIVE_ARENA_MIN, 60, 120, 320, -4, NaN, Infinity]) {
    const c = clampLiveArenaSize(size);
    assert(c >= LIVE_ARENA_MIN && c <= LIVE_ARENA_MAX, `clamp(${size}) = ${c}`);
  }
  assert(clampLiveArenaSize(60) === 60, "in-range sizes are kept");
});
