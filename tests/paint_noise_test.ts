// Lane B paint: seeded noise is deterministic, bounded and shaped as documented.
import {
  fbm3, gradientNoise3, hash01, hashCell, makeCellSample, makeNoise, PERM_SIZE, ridged3, valueNoise3, warp3, worley3,
} from "../src/graphics/paint/Noise.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

/** A fixed, irregular probe cloud (no RNG, so the test itself is deterministic). */
function probes(count: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < count; i++) out.push([Math.sin(i * 12.9898) * 7.3, Math.cos(i * 78.233) * 5.1, Math.sin(i * 3.7) * 9.2]);
  return out;
}

Deno.test("noise: the permutation table is a seeded shuffle of 0..255, stored twice", () => {
  const f = makeNoise(42);
  assert(f.perm.length === PERM_SIZE * 2, "512 entries");
  const seen = new Set(f.perm.slice(0, PERM_SIZE));
  assert(seen.size === PERM_SIZE, "a permutation: every byte exactly once");
  for (let i = 0; i < PERM_SIZE; i++) assert(f.perm[i] === f.perm[i + PERM_SIZE], "second copy identical");
  const g = makeNoise(42), h = makeNoise(43);
  assert(f.perm.every((v, i) => v === g.perm[i]), "same seed -> same table");
  assert(f.perm.some((v, i) => v !== h.perm[i]), "different seed -> different table");
});

Deno.test("noise: every function is deterministic per seed and differs across seeds", () => {
  const a = makeNoise(7), b = makeNoise(7), c = makeNoise(8);
  const cellA = makeCellSample(), cellB = makeCellSample();
  let differs = 0;
  for (const [x, y, z] of probes(200)) {
    assert(gradientNoise3(a, x, y, z) === gradientNoise3(b, x, y, z), "gradient deterministic");
    assert(valueNoise3(a, x, y, z) === valueNoise3(b, x, y, z), "value deterministic");
    assert(fbm3(a, x, y, z) === fbm3(b, x, y, z), "fbm deterministic");
    assert(ridged3(a, x, y, z) === ridged3(b, x, y, z), "ridged deterministic");
    worley3(a, x, y, z, 0.8, cellA); worley3(b, x, y, z, 0.8, cellB);
    assert(cellA.f1 === cellB.f1 && cellA.cellId === cellB.cellId, "worley deterministic");
    if (Math.abs(gradientNoise3(a, x, y, z) - gradientNoise3(c, x, y, z)) > 1e-6) differs++;
  }
  assert(differs > 150, `seed changes the field (${differs}/200 probes differ)`);
});

Deno.test("noise: gradient noise is 0 on the lattice, bounded, and continuous", () => {
  const f = makeNoise(3);
  for (let i = -3; i <= 3; i++) assert(Math.abs(gradientNoise3(f, i, 2 * i, -i)) < 1e-12, "zero at integer points");
  let lo = Infinity, hi = -Infinity;
  for (const [x, y, z] of probes(5000)) {
    const n = gradientNoise3(f, x, y, z);
    lo = Math.min(lo, n); hi = Math.max(hi, n);
    const step = gradientNoise3(f, x + 1e-4, y, z) - n;
    assert(Math.abs(step) < 1e-3, "continuous: a 0.1 mm step moves the value < 1e-3");
  }
  assert(lo >= -1.1 && hi <= 1.1, `range ~[-1, 1], got [${lo.toFixed(3)}, ${hi.toFixed(3)}]`);
  assert(hi - lo > 1, "the field actually varies");
});

Deno.test("noise: value noise hits its corner values; fbm stays in [-1, 1]; ridged in [0, 1]", () => {
  const f = makeNoise(11);
  for (let i = 0; i < 8; i++) {
    const v = valueNoise3(f, i, i + 1, i + 2);
    const corner = f.perm[f.perm[f.perm[i & 255] + ((i + 1) & 255)] + ((i + 2) & 255)] / 127.5 - 1;
    assert(Math.abs(v - corner) < 1e-12, "value noise interpolates its lattice values");
  }
  for (const [x, y, z] of probes(3000)) {
    const n = fbm3(f, x, y, z, 5);
    assert(n >= -1.05 && n <= 1.05, `fbm bounded, got ${n}`);
    const r = ridged3(f, x, y, z);
    assert(r >= 0 && r <= 1, `ridged in [0, 1], got ${r}`);
  }
});

Deno.test("noise: Worley F1 <= F2, jitter 0 puts the feature at the cell centre, ids are per cell", () => {
  const f = makeNoise(5), s = makeCellSample();
  for (const [x, y, z] of probes(1000)) {
    worley3(f, x, y, z, 1, s);
    assert(s.f1 <= s.f2, "F1 is the nearest");
    assert(s.f1 >= 0 && s.f1 < Math.sqrt(3) * 1.5, "F1 is within the 3x3x3 search");
  }
  worley3(f, 0.5, 0.5, 0.5, 0, s);
  assert(s.f1 < 1e-12, "regular grid: the centre of cell (0,0,0) is a feature point");
  const id = s.cellId;
  worley3(f, 0.45, 0.55, 0.52, 0, s);
  assert(s.cellId === id, "nearby point, same nearest cell id");
  worley3(f, 3.5, 0.5, 0.5, 0, s);
  assert(s.cellId !== id, "a different cell, a different id");
});

Deno.test("noise: domain warp is the identity at amplitude 0 and moves points otherwise", () => {
  const f = makeNoise(9), w = { x: 0, y: 0, z: 0 };
  warp3(f, 1.25, -2.5, 3.75, 0, w);
  assert(w.x === 1.25 && w.y === -2.5 && w.z === 3.75, "amplitude 0 -> identity");
  let moved = 0;
  for (const [x, y, z] of probes(100)) {
    warp3(f, x, y, z, 0.8, w);
    const d = Math.hypot(w.x - x, w.y - y, w.z - z);
    assert(d <= 0.8 * Math.sqrt(3) * 1.05, "displacement bounded by amplitude * sqrt 3");
    if (d > 1e-3) moved++;
  }
  assert(moved > 90, "amplitude > 0 displaces almost every point");
});

Deno.test("noise: integer cell hash is deterministic, salted, and roughly uniform", () => {
  assert(hashCell(1, 2, 3, 4) === hashCell(1, 2, 3, 4), "deterministic");
  assert(hashCell(1, 2, 3, 4, 0) !== hashCell(1, 2, 3, 4, 1), "salt decorrelates");
  assert(hashCell(1, 2, 3, 4) !== hashCell(2, 2, 3, 4), "seed decorrelates");
  const bins = new Array(10).fill(0);
  for (let i = 0; i < 10000; i++) bins[Math.floor(hash01(77, i, i >> 3, -i) * 10)]++;
  for (const b of bins) assert(b > 850 && b < 1150, `uniform within 15%: ${bins.join(",")}`);
});
