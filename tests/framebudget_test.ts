// Tests for the Wave I effects governor and the frame-time arithmetic (lane I-E).
// The claims here are the ones the BRIEF §1.5 makes: hysteretic (a lone spike cannot drop
// the scale), bounded [minScale, 1], recovery slower than the drop and never above 1, no
// flapping, and total arithmetic for any input.
import { EffectsGovernor, percentile, summarise } from "../src/game/FrameBudget.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}

const DT = 1 / 60;

/** Direction changes between consecutive non-zero deltas: 0 == monotone while a regime holds. */
function directionChanges(xs: number[]): number {
  let dir = 0;
  let changes = 0;
  let prev = xs[0];
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i] - prev;
    prev = xs[i];
    if (d > 0) {
      if (dir === -1) changes++;
      dir = 1;
    } else if (d < 0) {
      if (dir === 1) changes++;
      dir = -1;
    }
  }
  return changes;
}

Deno.test("sustained 20 ms/frame drives the scale to exactly minScale and never below", () => {
  const g = new EffectsGovernor();
  let lowest = Infinity;
  for (let i = 0; i < 600; i++) {
    const s = g.step(20, DT);
    assert(Number.isFinite(s), `scale ${s} not finite`);
    assert(s >= g.minScale, `scale ${s} fell below minScale`);
    assert(s <= 1, `scale ${s} above 1`);
    lowest = Math.min(lowest, s);
  }
  assert(Math.abs(g.scale - 0.25) < 1e-12, `sustained 20 ms should sit at minScale, got ${g.scale}`);
  assert(Math.abs(lowest - 0.25) < 1e-12, `lowest was ${lowest}`);
  assert(g.drops === 3, `expected exactly 3 drops (1.0 -> 0.75 -> 0.5 -> 0.25), got ${g.drops}`);
  assert(g.overBudgetFrames > 0, "sustained over-budget frames should have been counted");
});

Deno.test("a single 20 ms spike frame does not drop the scale", () => {
  const g = new EffectsGovernor();
  for (let i = 0; i < 30; i++) g.step(12, DT); // settle in the dead zone at the target
  assert(g.scale === 1, "starts at 1");
  const afterSpike = g.step(20, DT); // the one lean frame
  assert(afterSpike === 1, `a single 20 ms frame dropped the scale to ${afterSpike}`);
  assert(g.drops === 0, `no drop event expected, got ${g.drops}`);
  for (let i = 0; i < 30; i++) g.step(12, DT);
  assert(g.scale === 1, "still 1 after the spike passes");
});

Deno.test("recovery is slower than the drop and never exceeds 1", () => {
  // How many frames to drive the scale down (over-budget regime).
  const drop = new EffectsGovernor();
  let dropFrames = 0;
  while (drop.scale > drop.minScale && dropFrames < 100000) {
    drop.step(20, DT);
    dropFrames++;
  }
  assert(Math.abs(drop.scale - drop.minScale) < 1e-12, `did not reach minScale: ${drop.scale}`);

  // How many frames to recover back to 1 (under-target regime, from a settled cold start).
  const rec = new EffectsGovernor();
  for (let i = 0; i < 3000; i++) rec.step(20, DT);
  assert(Math.abs(rec.scale - rec.minScale) < 1e-12, `cold start not at minScale: ${rec.scale}`);
  let recFrames = 0;
  while (rec.scale < 1 && recFrames < 100000) {
    rec.step(5, DT);
    recFrames++;
  }
  assert(rec.scale === 1, `recovery stalled at ${rec.scale}`);

  assert(dropFrames > 0 && recFrames > 0, "both phases must take a measurable number of frames");
  assert(recFrames > dropFrames, `recovery (${recFrames}) must be slower than the drop (${dropFrames})`);

  // Keep feeding the comfortable load: the scale is clamped and can never exceed 1.
  for (let i = 0; i < 2000; i++) {
    const s = rec.step(5, DT);
    assert(s <= 1, `scale ${s} exceeded 1 during recovery hold`);
  }
  assert(rec.scale === 1, `recovery overshoot: ${rec.scale}`);
});

Deno.test("no flapping: the scale moves in one direction while a regime holds", () => {
  const g = new EffectsGovernor();

  const over: number[] = [];
  for (let i = 0; i < 400; i++) over.push(g.step(20, DT));
  assert(directionChanges(over) === 0, `over regime changed direction ${directionChanges(over)} times`);

  const under: number[] = [];
  for (let i = 0; i < 400; i++) under.push(g.step(4, DT));
  assert(directionChanges(under) === 0, `under regime changed direction ${directionChanges(under)} times`);

  // And the two regimes do move in the expected directions overall.
  assert(over[over.length - 1] < over[0], "the over regime should have lowered the scale");
  assert(under[under.length - 1] > under[0], "the under regime should have raised the scale");
});

Deno.test("every returned value is finite and in range for hostile cpu/dt inputs", () => {
  const cpus = [NaN, -1, -100, 0, 1e9, Infinity, -Infinity, 12, 20, 16.6];
  const dts = [NaN, -1, 0, 1 / 60, 0.5, 1e9, Infinity, -Infinity];
  const g = new EffectsGovernor();
  for (const cpu of cpus) {
    for (const dt of dts) {
      const s = g.step(cpu, dt);
      assert(Number.isFinite(s), `scale ${s} for cpu=${cpu} dt=${dt}`);
      assert(s >= g.minScale && s <= 1, `scale ${s} out of range for cpu=${cpu} dt=${dt}`);
    }
  }
  // Also from a governor already pinned at minScale.
  const cold = new EffectsGovernor();
  for (let i = 0; i < 3000; i++) cold.step(30, DT);
  for (const cpu of cpus) {
    for (const dt of dts) {
      const s = cold.step(cpu, dt);
      assert(Number.isFinite(s) && s >= cold.minScale && s <= 1, `cold scale ${s}`);
    }
  }
});

Deno.test("percentile is exact (nearest-rank) on [1..100] and total on an empty sample", () => {
  const s = Array.from({ length: 100 }, (_, i) => i + 1);
  // Nearest-rank ceil convention: rank = ceil(p*n). On [1..100]: p50 -> rank 50 -> 50,
  // p95 -> rank 95 -> 95, p99 -> rank 99 -> 99.
  assert(percentile(s, 0.5) === 50, `p50 = ${percentile(s, 0.5)}, expected 50`);
  assert(percentile(s, 0.95) === 95, `p95 = ${percentile(s, 0.95)}, expected 95`);
  assert(percentile(s, 0.99) === 99, `p99 = ${percentile(s, 0.99)}, expected 99`);
  assert(percentile(s, 0) === 1, `p0 = ${percentile(s, 0)}, expected 1`);
  assert(percentile(s, 1) === 100, `p100 = ${percentile(s, 1)}, expected 100`);

  // Hand sample [10,20,30,40]: p50 -> rank 2 -> 20, p75 -> rank 3 -> 30.
  assert(percentile([10, 20, 30, 40], 0.5) === 20, "hand p50");
  assert(percentile([10, 20, 30, 40], 0.75) === 30, "hand p75");

  // Total: an empty sample has no percentile and returns 0, never NaN.
  assert(percentile([], 0.5) === 0, "empty sample must return 0");
  assert(percentile([], 0.99) === 0, "empty sample must return 0");
});

Deno.test("summarise is exact on a 5-element sample", () => {
  const r = summarise([1, 2, 3, 4, 5]);
  assert(r.n === 5, `n = ${r.n}`);
  assert(r.mean === 3, `mean = ${r.mean}, expected 3`);
  assert(r.p50 === 3, `p50 = ${r.p50}, expected 3`);
  assert(r.p95 === 5, `p95 = ${r.p95}, expected 5`);
  assert(r.p99 === 5, `p99 = ${r.p99}, expected 5`);
  assert(r.max === 5, `max = ${r.max}, expected 5`);

  const empty = summarise([]);
  assert(empty.n === 0 && empty.mean === 0 && empty.max === 0, "empty summary is all zeros");
  for (const v of [empty.n, empty.mean, empty.p50, empty.p95, empty.p99, empty.max]) {
    assert(Number.isFinite(v), `empty summary field ${v} not finite`);
  }
});
