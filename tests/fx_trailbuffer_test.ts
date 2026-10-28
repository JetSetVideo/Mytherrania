// TrailBuffer: the pure ribbon history behind every trail effect (lane D, R05).
import {
  angleBetween,
  catmullRom,
  fadeAlpha,
  stripIndices,
  subdivisionCount,
  TrailBuffer,
} from "../src/graphics/fx/TrailBuffer.ts";
import { rng32 } from "../src/core/MathCore.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function near(a: number, b: number, eps: number, message: string): void {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${message}: ${a} vs ${b} (eps ${eps})`);
}

/** A blade of inner radius 0.2 m and outer radius 1.0 m rotated `angle` rad about +y. */
function pushBlade(buf: TrailBuffer, angle: number, time: number): boolean {
  const c = Math.cos(angle), s = Math.sin(angle);
  return buf.push(0.2 * c, 1, 0.2 * s, 1.0 * c, 1, 1.0 * s, time);
}

Deno.test("ring buffer wraps without losing order", () => {
  const buf = new TrailBuffer({ capacity: 8, lifetime: 100, minSpawnDistance: 0.01 });
  for (let i = 0; i < 13; i++) buf.push(i, 0, 0, i, 1, 0, i * 0.01);
  assert(buf.count === 8, `count clamps to capacity, got ${buf.count}`);
  const out = new Float64Array(6);
  let prevTime = Infinity;
  for (let i = 0; i < buf.count; i++) {
    const t = buf.sampleAt(i, out);
    assert(t < prevTime, `sample ${i} is older than sample ${i - 1}`);
    prevTime = t;
    // Newest is the 13th push (x = 12); the ring kept pushes 5..12 in order.
    assert(out[0] === 12 - i && out[3] === 12 - i, `sample ${i} holds push ${12 - i}, got x=${out[0]}`);
    near(t, (12 - i) * 0.01, 1e-12, `sample ${i} time`);
  }
  let threw = false;
  try {
    buf.sampleAt(8, out);
  } catch {
    threw = true;
  }
  assert(threw, "reading past the stored count throws");
});

Deno.test("alpha is 1 at the newest sample and 0 at the lifetime", () => {
  assert(fadeAlpha(0, 0.5) === 1, "age 0 -> alpha 1");
  assert(fadeAlpha(0.5, 0.5) === 0, "age = lifetime -> alpha 0");
  assert(fadeAlpha(0.75, 0.5) === 0, "older than lifetime stays 0");
  near(fadeAlpha(0.25, 0.5), 0.5, 1e-12, "smoothstep midpoint");

  const lifetime = 0.5;
  const buf = new TrailBuffer({ capacity: 64, lifetime, minSpawnDistance: 0.001 });
  for (let i = 0; i <= 49; i++) buf.push(i * 0.05, 0, 0, i * 0.05, 1, 0, i * 0.01);
  const now = 0.49; // the newest sample's own time: age 0
  const verts = buf.build(now);
  assert(verts >= 4, "a strip was emitted");
  assert(buf.alphas[0] === 1 && buf.alphas[1] === 1, `head row alpha is 1, got ${buf.alphas[0]}`);
  const last = buf.rows - 1;
  // Oldest surviving row: time 0.0 -> age 0.49 of 0.5.
  near(buf.alphas[last * 2], fadeAlpha(0.49, lifetime), 1e-6, "tail alpha follows the fade curve");
  assert(buf.alphas[last * 2] < 0.002, `tail is almost transparent, got ${buf.alphas[last * 2]}`);
  for (let r = 1; r < buf.rows; r++) {
    assert(buf.alphas[r * 2] <= buf.alphas[(r - 1) * 2] + 1e-7, `alpha never rises toward the tail (row ${r})`);
  }
  assert(buf.along[0] === 0 && buf.along[last * 2] === 1, "along runs 0 at the head to 1 at the tail");
  // At now = newest + lifetime every sample has expired.
  assert(buf.build(0.49 + lifetime) === 0 && buf.count === 0, "everything expires at the lifetime");
});

Deno.test("no samples spawn below the distance threshold", () => {
  const buf = new TrailBuffer({ capacity: 32, lifetime: 10, minSpawnDistance: 0.1 });
  assert(buf.push(0, 0, 0, 0, 1, 0, 0), "the first sample is always stored");
  // 50 steps of 1 mm = 5 cm total, still under the 10 cm threshold.
  for (let i = 1; i <= 50; i++) {
    assert(!buf.push(i * 0.001, 0, 0, i * 0.001, 1, 0, i * 0.01), `step ${i} must not store`);
  }
  assert(buf.count === 1, `slow motion did not pile samples, count ${buf.count}`);
  // The live head is still drawn, so the ribbon stays attached to the moving edge.
  assert(buf.pointCount === 2, "live head + stored sample");
  assert(buf.build(0.5) === 4, "two rows: stored sample and live head");
  near(buf.positions[0], 0.05, 1e-6, "head row sits on the latest pushed position");
  // Cumulative motion past the threshold (measured from the last STORED sample) stores again.
  assert(buf.push(0.1, 0, 0, 0.1, 1, 0, 0.6), "10 cm from the stored sample spawns");
  assert((buf.count as number) === 2, "second sample stored");
  // Either edge moving is enough: a pure rotation of the tip.
  assert(buf.push(0.1, 0, 0, 0.1, 1, 0.15, 0.7), "a tip moving 15 cm spawns even with a still base");
});

Deno.test("subdivision count grows with curvature", () => {
  const step = Math.PI / 24;
  assert(subdivisionCount(0, step, 6) === 0, "straight: none");
  assert(subdivisionCount(step, step, 6) === 0, "exactly one step: none");
  assert(subdivisionCount(step * 2.5, step, 6) === 2, "2.5 steps -> 2 inserted rows");
  assert(subdivisionCount(Math.PI, step, 6) === 6, "capped at maxSubdivisions");
  let prev = -1;
  for (let turn = 0; turn <= Math.PI; turn += 0.05) {
    const n = subdivisionCount(turn, step, 6);
    assert(n >= prev, `monotonic in the turn angle at ${turn.toFixed(2)}`);
    prev = n;
  }

  const rowsFor = (degPerSample: number): number => {
    const buf = new TrailBuffer({ capacity: 16, lifetime: 10, minSpawnDistance: 0.001 });
    for (let i = 0; i < 6; i++) pushBlade(buf, (i * degPerSample * Math.PI) / 180, i * 0.016);
    buf.build(0.1);
    return buf.rows;
  };
  const translateRows = (() => {
    const buf = new TrailBuffer({ capacity: 16, lifetime: 10, minSpawnDistance: 0.001 });
    for (let i = 0; i < 6; i++) buf.push(i * 0.3, 0, 0, i * 0.3, 1, 0, i * 0.016);
    buf.build(0.1);
    return buf.rows;
  })();
  const gentle = rowsFor(5), medium = rowsFor(20), sharp = rowsFor(45);
  assert(translateRows === 6, `a straight translation inserts nothing, rows ${translateRows}`);
  assert(gentle === 6, `5 deg per sample is under one step, rows ${gentle}`);
  assert(medium > gentle && sharp > medium, `rows grow with curvature: ${gentle} < ${medium} < ${sharp}`);
  near(angleBetween(1, 0, 0, 0, 1, 0), Math.PI / 2, 1e-12, "angleBetween right angle");
  assert(angleBetween(0, 0, 0, 1, 0, 0) === 0, "a zero vector has no angle");
});

Deno.test("Catmull-Rom rows pass through the samples and stay on the swept arc", () => {
  assert(catmullRom(0, 1, 2, 3, 0) === 1 && catmullRom(0, 1, 2, 3, 1) === 2, "interpolates p1 -> p2");
  const buf = new TrailBuffer({ capacity: 16, lifetime: 10, minSpawnDistance: 0.001 });
  for (let i = 0; i < 6; i++) pushBlade(buf, (i * 40 * Math.PI) / 180, i * 0.016);
  buf.build(0.1);
  // Every tip vertex (edge 1) should sit near radius 1 — the subdivided arc is round.
  let worst = 0;
  for (let r = 0; r < buf.rows; r++) {
    const x = buf.positions[r * 6 + 3], z = buf.positions[r * 6 + 5];
    worst = Math.max(worst, Math.abs(Math.hypot(x, z) - 1));
  }
  assert(worst < 0.01, `tip stays within 1 cm of the arc, worst ${worst.toFixed(4)} m`);
});

Deno.test("vertex count never exceeds the strip capacity", () => {
  const clipped = new TrailBuffer({ capacity: 64, lifetime: 10, minSpawnDistance: 0.001, maxRows: 10 });
  for (let i = 0; i < 100; i++) {
    pushBlade(clipped, i * 0.9, i * 0.01);
    const v = clipped.build(i * 0.01);
    assert(v <= 20 && clipped.rows <= 10, `push ${i}: ${v} vertices > 2 * maxRows`);
  }
  assert(clipped.positions.length === 10 * 2 * 3, "output arrays sized from maxRows");
  // Fuzz the default (worst-case) sizing: it must never be reached by clipping.
  const rand = rng32(20261028);
  const buf = new TrailBuffer({ capacity: 24, lifetime: 0.4, minSpawnDistance: 0.02 });
  let t = 0;
  for (let i = 0; i < 2000; i++) {
    t += 0.004 + rand() * 0.02;
    buf.push(rand() * 4 - 2, rand() * 2, rand() * 4 - 2, rand() * 4 - 2, rand() * 2, rand() * 4 - 2, t);
    const v = buf.build(t);
    assert(v <= buf.maxRows * 2, `fuzz ${i}: ${v} > ${buf.maxRows * 2}`);
    // Bounds must contain every emitted vertex.
    for (let k = 0; k < v; k++) {
      for (let a = 0; a < 3; a++) {
        const p = buf.positions[k * 3 + a];
        assert(p >= buf.bounds[a] - 1e-5 && p <= buf.bounds[a + 3] + 1e-5, `vertex ${k} outside bounds`);
      }
    }
  }
  const idx = stripIndices(buf.maxRows);
  assert(idx.length === (buf.maxRows - 1) * 6, "6 indices per row gap");
  let maxIndex = 0;
  for (const i of idx) maxIndex = Math.max(maxIndex, i);
  assert(maxIndex === buf.maxRows * 2 - 1, "indices address exactly the vertex capacity");
});

Deno.test("taper narrows old rows toward the pivot; clear empties the strip", () => {
  const buf = new TrailBuffer({ capacity: 8, lifetime: 1, minSpawnDistance: 0.001, taper: 1, taperPivot: 1 });
  buf.push(0, 0, 0, 0, 1, 0, 0);
  buf.push(1, 0, 0, 1, 1, 0, 0.5);
  buf.build(0.5);
  const headSpan = buf.positions[4] - buf.positions[1];
  const tailSpan = buf.positions[10] - buf.positions[7];
  near(headSpan, 1, 1e-6, "the head keeps its full width");
  near(tailSpan, 0.5, 1e-6, "a half-life-aged row is half as wide (linear taper)");
  near(buf.positions[10], 1, 1e-6, "pivot 1 keeps edge 1 (the blade tip) in place");
  buf.clear();
  assert(buf.build(0.5) === 0 && buf.count === 0 && buf.pointCount === 0, "clear drops everything");
});
