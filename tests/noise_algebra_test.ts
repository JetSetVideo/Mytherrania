// Lane N: the noise algebra — every source and every operator, determinism, ranges,
// simplex statistics and the periodic (tileable) contract.
import {
  BINARY_OPS, blendOp, compileNoise, DOMAIN_OPS, floorMod, gradientPeriodic3, NOISE_OPERATORS, NOISE_SOURCES,
  type NoiseExpr, noiseOpsUsed, quantizeLevels, safeDiv, schlickBias, schlickGain, SHAPING_OPS, simplex3,
  simplexPeriodic3, SMOOTH_CSG_OPS, smoothMax, smoothMin, UNARY_OPS, valuePeriodic3, worleyPeriodic3,
} from "../src/graphics/paint/NoiseAlgebra.ts";
import { makeCellSample, makeNoise } from "../src/graphics/paint/Noise.ts";
import { rng32 } from "../src/core/MathCore.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const c = (value: number): NoiseExpr => ({ op: "constant", value });
const X: NoiseExpr = { op: "coordinate", axis: "x" };
const Y: NoiseExpr = { op: "coordinate", axis: "y" };

/** A fixed, irregular probe cloud (no RNG, so the test itself is deterministic). */
function probes(count: number, spread = 9): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    out.push([Math.sin(i * 12.9898) * spread, Math.cos(i * 78.233) * spread * 0.7, Math.sin(i * 3.7 + 1) * spread]);
  }
  return out;
}

/** [expression, sample point, expected value, tolerance] — one or more rows per operator. */
type Row = [NoiseExpr, [number, number, number], number, number?];
const O: [number, number, number] = [0, 0, 0];
const ROWS: Row[] = [
  // arithmetic
  [{ op: "add", a: c(0.2), b: c(0.3) }, O, 0.5],
  [{ op: "sub", a: c(0.2), b: c(0.3) }, O, -0.1],
  [{ op: "mul", a: c(0.2), b: c(0.3) }, O, 0.06],
  [{ op: "div", a: c(1), b: c(4) }, O, 0.25],
  [{ op: "div", a: c(1), b: c(0) }, O, 1e6],
  [{ op: "mod", a: c(-1), b: c(3) }, O, 2],
  [{ op: "mod", a: c(5), b: c(0) }, O, 0],
  [{ op: "pow", a: c(4), b: c(0.5) }, O, 2],
  [{ op: "pow", a: c(-4), b: c(0.5) }, O, 0],
  [{ op: "neg", a: c(0.3) }, O, -0.3],
  [{ op: "abs", a: c(-0.4) }, O, 0.4],
  [{ op: "min", a: c(0.2), b: c(0.6) }, O, 0.2],
  [{ op: "max", a: c(0.2), b: c(0.6) }, O, 0.6],
  [{ op: "oneMinus", a: c(0.3) }, O, 0.7],
  [{ op: "sqrt", a: c(0.25) }, O, 0.5],
  [{ op: "sqrt", a: c(-1) }, O, 0],
  [{ op: "exp", a: c(1) }, O, Math.E],
  [{ op: "log", a: c(Math.E) }, O, 1],
  [{ op: "log", a: c(0) }, O, Math.log(1e-6)],
  // shaping
  [{ op: "clamp", a: c(1.4), lo: 0, hi: 1 }, O, 1],
  [{ op: "clamp", a: c(-2), lo: -1, hi: 1 }, O, -1],
  [{ op: "saturate", a: c(1.5) }, O, 1],
  [{ op: "saturate", a: c(-0.5) }, O, 0],
  [{ op: "step", a: c(0.5), edge: 0.5 }, O, 1],
  [{ op: "step", a: c(0.49), edge: 0.5 }, O, 0],
  [{ op: "smoothstep", a: c(0.5), e0: 0, e1: 1 }, O, 0.5],
  [{ op: "smoothstep", a: c(0.25), e0: 0, e1: 1 }, O, 0.15625],
  [{ op: "threshold", a: c(0.6), level: 0.5 }, O, 1],
  [{ op: "threshold", a: c(0.5), level: 0.5, softness: 0.1 }, O, 0.5],
  [{ op: "quantize", a: c(0.6), levels: 4 }, O, 2 / 3],
  [{ op: "quantize", a: c(1), levels: 4 }, O, 1],
  [{ op: "bias", a: c(0.5), amount: 0.7 }, O, 0.7, 1e-12],
  [{ op: "bias", a: c(0.3), amount: 0.5 }, O, 0.3, 1e-12],
  [{ op: "gain", a: c(0.5), amount: 0.8 }, O, 0.5, 1e-12],
  [{ op: "gain", a: c(0.25), amount: 0.75 }, O, 0.125, 1e-12],
  [{ op: "remap", a: c(0.5), inLo: 0, inHi: 1, outLo: 10, outHi: 20 }, O, 15],
  [{ op: "remap", a: c(2), inLo: 0, inHi: 1, outLo: 10, outHi: 20 }, O, 20],
  [{ op: "contrast", a: c(0.6), amount: 2 }, O, 0.7],
  [{ op: "contrast", a: c(0.6), amount: 2, pivot: 0 }, O, 1.2],
  // interpolation + trig
  [{ op: "mix", a: c(0), b: c(10), t: c(0.25) }, O, 2.5],
  [{ op: "mix", a: c(0), b: c(10), t: c(3) }, O, 10],
  [{ op: "sin", a: c(Math.PI / 2) }, O, 1],
  [{ op: "cos", a: c(0) }, O, 1],
  // blend modes (base a, top b)
  [{ op: "screen", a: c(0.5), b: c(0.5) }, O, 0.75],
  [{ op: "overlay", a: c(0.25), b: c(0.5) }, O, 0.25],
  [{ op: "overlay", a: c(0.75), b: c(0.5) }, O, 0.75],
  [{ op: "softLight", a: c(0.3), b: c(0.5) }, O, 0.3, 1e-12],
  [{ op: "multiply", a: c(0.5), b: c(0.4) }, O, 0.2],
  [{ op: "difference", a: c(0.2), b: c(0.7) }, O, 0.5],
  [{ op: "exclusion", a: c(1), b: c(0.3) }, O, 0.7],
  [{ op: "colorDodge", a: c(0.3), b: c(0.5) }, O, 0.6],
  [{ op: "colorDodge", a: c(0.3), b: c(1) }, O, 1],
  [{ op: "colorBurn", a: c(0.7), b: c(0.5) }, O, 0.4],
  [{ op: "colorBurn", a: c(0.7), b: c(0) }, O, 0],
  // CSG (densities: higher = inside)
  [{ op: "union", a: c(0.2), b: c(0.6) }, O, 0.6],
  [{ op: "intersect", a: c(0.2), b: c(0.6) }, O, 0.2],
  [{ op: "subtract", a: c(0.8), b: c(0.3) }, O, 0.7],
  [{ op: "smoothUnion", a: c(0.5), b: c(0.5), k: 0.2 }, O, 0.55],
  [{ op: "smoothUnion", a: c(0.1), b: c(0.9), k: 0.2 }, O, 0.9],
  [{ op: "smoothIntersect", a: c(0.5), b: c(0.5), k: 0.2 }, O, 0.45],
  [{ op: "smoothSubtract", a: c(0.5), b: c(0.5), k: 0.2 }, O, 0.45],
  [{ op: "smoothSubtract", a: c(0.9), b: c(0.8), k: 0.1 }, O, 0.2],
  // domain ops (through coordinate sources)
  [{ op: "translate", a: X, offset: [1, 2, 3] }, [0.5, 0, 0], 1.5],
  [{ op: "scale", a: X, factor: 2 }, [3, 0, 0], 1.5],
  [{ op: "rotate", a: X, angle: Math.PI / 2 }, [0, 0, 1], -1, 1e-12],
  [{ op: "rotate", a: X, angle: Math.PI / 2 }, [1, 0, 0], 0, 1e-12],
  [{ op: "warp", a: X, amount: 0.5, by: c(1) }, [0, 0, 0], 0.5],
  [{ op: "warp", a: Y, amount: 0.5, by: [c(1), c(0), c(0.5)] }, [0, 0, 0], -0.5],
  [{ op: "tile", a: X, period: 4 }, [1, 0, 0], 0.5],
  [{ op: "tile", a: X, period: 4 }, [5, 0, 0], 0.5],
  [{ op: "tile", a: X, period: 4 }, [2, 0, 0], 1],
  // sources with exact values
  [c(0.42), [3, 4, 5], 0.42],
  [{ op: "coordinate", axis: "radial" }, [3, 9, 4], 5],
  [{ op: "coordinate", axis: "angle" }, [1, 0, 0], 0.5],
  [{ op: "coordinate", axis: "angle" }, [0, 0, 1], 0.75],
  [{ op: "coordinate", axis: "y" }, [0, 2, 0], 2],
  [{ op: "coordinate", axis: "z" }, [0, 0, -3], -3],
  [{ op: "coordinate", axis: "x", cell: 2 }, [0.5, 0, 0], 0.5],
  [{ op: "checker", scale: 1 }, [0.5, 0.5, 0.5], 0],
  [{ op: "checker", scale: 1 }, [1.5, 0.5, 0.5], 1],
  [{ op: "stripes", axis: "x", scale: 4 }, [1, 0, 0], 1, 1e-12],
  [{ op: "stripes", axis: "z", scale: 4 }, [0, 0, 3], 0, 1e-12],
];

Deno.test("algebra: vocabulary lists are complete and disjoint", () => {
  assert(NOISE_SOURCES.length === 13, `13 sources, got ${NOISE_SOURCES.length}`);
  assert(NOISE_OPERATORS.length === 46, `46 operators, got ${NOISE_OPERATORS.length}`);
  const all = new Set<string>([...NOISE_SOURCES, ...NOISE_OPERATORS]);
  assert(all.size === NOISE_SOURCES.length + NOISE_OPERATORS.length, "no name is both a source and an operator");
  const groups = UNARY_OPS.length + BINARY_OPS.length + SMOOTH_CSG_OPS.length + SHAPING_OPS.length + 1 + DOMAIN_OPS.length;
  assert(groups === NOISE_OPERATORS.length, "operator groups add up");
});

Deno.test("algebra: every operator's math on known inputs (direct unit table)", () => {
  const used = new Set<string>();
  for (const [e, p, want, tol] of ROWS) {
    const got = compileNoise(e, 1)(p[0], p[1], p[2]);
    assert(near(got, want, tol ?? 1e-9), `${JSON.stringify(e)} at ${p}: got ${got}, want ${want}`);
    noiseOpsUsed(e, used);
  }
  const missing = NOISE_OPERATORS.filter((o) => !used.has(o));
  assert(missing.length === 0, `operators without a unit row: ${missing.join(", ")}`);
});

Deno.test("algebra: exported scalar helpers match their formulas", () => {
  assert(near(safeDiv(1, -1e-9), -1e6), "safeDiv keeps the sign of a ~0 divisor");
  assert(near(floorMod(-0.5, 1), 0.5), "floored modulo");
  assert(near(schlickBias(0.25, 0.5), 0.25) && near(schlickGain(0.8, 0.5), 0.8, 1e-12), "0.5 is identity");
  assert(schlickGain(0.2, 0.8) < 0.2 && schlickGain(0.8, 0.8) > 0.8, "gain > 0.5 adds contrast");
  assert(quantizeLevels(0.49, 2) === 0 && quantizeLevels(0.51, 2) === 1, "2-level quantize is a threshold");
  assert(near(smoothMin(0, 1, 0.1), 0) && near(smoothMax(0, 1, 0.1), 1), "far apart, smooth = hard");
  assert(near(smoothMin(0.3, 0.3, 0.4), 0.2), "equal inputs: min - k/4");
  for (const m of ["screen", "overlay", "softLight", "multiply", "difference", "exclusion", "colorDodge", "colorBurn"]) {
    for (const [a, b] of [[0, 0], [1, 1], [0.3, 0.8], [-2, 3]]) {
      const v = blendOp(m, a, b);
      assert(Number.isFinite(v) && v >= 0 && v <= 1, `${m}(${a},${b}) = ${v} in [0,1]`);
    }
  }
});

/** One instance of every source, with its documented output bounds. */
const SOURCE_CASES: [NoiseExpr, number, number][] = [
  [c(0.3), 0.3, 0.3],
  [{ op: "coordinate", axis: "angle" }, 0, 1],
  [{ op: "value", scale: 1.3 }, 0, 1],
  [{ op: "gradient", scale: 1.3 }, 0, 1],
  [{ op: "simplex", scale: 1.3 }, 0, 1],
  [{ op: "worley", scale: 1.3, feature: "f1" }, 0, 1.5],
  [{ op: "worley", scale: 1.3, feature: "f2" }, 0, 2],
  [{ op: "worley", scale: 1.3, feature: "f2MinusF1" }, 0, 1.5],
  [{ op: "worley", scale: 1.3, feature: "cellId" }, 0, 1],
  [{ op: "fbm", base: "value", scale: 2 }, 0, 1],
  [{ op: "fbm", base: "gradient", scale: 2 }, 0, 1],
  [{ op: "fbm", base: "simplex", scale: 2 }, 0, 1],
  [{ op: "ridged", base: "simplex", scale: 2 }, 0, 1],
  [{ op: "billow", base: "gradient", scale: 2 }, 0, 1],
  [{ op: "turbulence", base: "value", scale: 2 }, 0, 1],
  [{ op: "checker", scale: 0.7 }, 0, 1],
  [{ op: "stripes", axis: "x", scale: 0.7, sharpness: 0.5 }, 0, 1],
  [{ op: "spots", scale: 1.1, radius: 0.35, density: 0.7 }, 0, 1],
];

Deno.test("algebra: every source is finite, bounded, seeded and deterministic", () => {
  const covered = new Set<string>();
  const pts = probes(1500);
  for (const [e, lo, hi] of SOURCE_CASES) {
    covered.add(e.op);
    for (const opts of [{}, { period: 8 }]) {
      const a = compileNoise(e, 7, opts), b = compileNoise(e, 7, opts), d = compileNoise(e, 8, opts);
      let differs = 0, mn = Infinity, mx = -Infinity;
      for (const [x, y, z] of pts) {
        const v = a(x, y, z);
        assert(Number.isFinite(v), `${e.op} finite`);
        assert(v === b(x, y, z), `${e.op}: same seed -> same value`);
        if (v !== d(x, y, z)) differs++;
        mn = Math.min(mn, v); mx = Math.max(mx, v);
      }
      assert(mn >= lo - 1e-12 && mx <= hi + 1e-12, `${JSON.stringify(e)} ${JSON.stringify(opts)} in [${lo},${hi}]: [${mn},${mx}]`);
      const seeded = !["constant", "coordinate", "checker", "stripes"].includes(e.op);
      if (seeded) assert(differs > pts.length * 0.08, `${e.op}: a different seed differs (${differs}/${pts.length})`);
      if (lo < hi && e.op !== "checker") assert(mx - mn > 0.1 * (hi - lo), `${e.op} actually varies: ${mn}..${mx}`);
    }
  }
  const missing = NOISE_SOURCES.filter((s) => !covered.has(s));
  assert(missing.length === 0, `sources not covered: ${missing.join(", ")}`);
});

Deno.test("algebra: single-octave lattice sources are centred (~0.5 mean) and fbm bases differ", () => {
  const pts = probes(4000, 40);
  for (const op of ["value", "gradient", "simplex"] as const) {
    const f = compileNoise({ op, scale: 1 }, 3);
    let sum = 0;
    for (const [x, y, z] of pts) sum += f(x, y, z);
    const mean = sum / pts.length;
    console.log(`  ${op} mean ${mean.toFixed(4)}`);
    assert(Math.abs(mean - 0.5) < 0.05, `${op} mean ${mean}`);
  }
  const fv = compileNoise({ op: "fbm", base: "value" }, 3), fg = compileNoise({ op: "fbm", base: "gradient" }, 3);
  const fs = compileNoise({ op: "fbm", base: "simplex" }, 3);
  let dvg = 0, dgs = 0;
  for (const [x, y, z] of probes(300)) { dvg += Math.abs(fv(x, y, z) - fg(x, y, z)); dgs += Math.abs(fg(x, y, z) - fs(x, y, z)); }
  assert(dvg > 1 && dgs > 1, "the three fbm bases are different fields");
});

Deno.test("algebra: simplex noise range, mean, spread and continuity", () => {
  const f = makeNoise(5), rnd = rng32(9);
  const N = 200000;
  let mn = Infinity, mx = -Infinity, sum = 0, sq = 0;
  for (let i = 0; i < N; i++) {
    const v = simplex3(f, rnd() * 100, rnd() * 100, rnd() * 100);
    mn = Math.min(mn, v); mx = Math.max(mx, v); sum += v; sq += v * v;
  }
  const mean = sum / N, std = Math.sqrt(sq / N - mean * mean);
  console.log(`  simplex3 over ${N}: min ${mn.toFixed(3)} max ${mx.toFixed(3)} mean ${mean.toFixed(4)} std ${std.toFixed(3)}`);
  assert(mn >= -1 && mx <= 1, "within [-1, 1]");
  assert(mx > 0.75 && mn < -0.75, "uses most of the range");
  assert(Math.abs(mean) < 0.01, `mean ~0: ${mean}`);
  assert(std > 0.2 && std < 0.5, `std ${std}`);
  let jump = 0;
  for (let i = 0; i < 50000; i++) {
    const x = rnd() * 50, y = rnd() * 50, z = rnd() * 50, h = 1e-4;
    jump = Math.max(jump, Math.abs(simplex3(f, x, y, z) - simplex3(f, x + h, y - h, z + h)));
  }
  assert(jump < 0.005, `continuous: max jump over a 1e-4 step ${jump}`);
  // Different seeds: different fields.
  const g = makeNoise(6);
  let d = 0;
  for (const [x, y, z] of probes(200)) d += Math.abs(simplex3(f, x, y, z) - simplex3(g, x, y, z));
  assert(d > 10, "seeded");
});

Deno.test("algebra: periodic lattice primitives repeat exactly at their integer period", () => {
  const cellA = makeCellSample(), cellB = makeCellSample();
  for (const [x, y, z] of probes(500, 20)) {
    const sv = simplexPeriodic3(3, x, y, z, 4, 6, 8);
    assert(near(sv, simplexPeriodic3(3, x + 4, y - 6, z + 16, 4, 6, 8), 1e-12), "simplex periodic");
    assert(near(valuePeriodic3(3, x, y, z, 5, 3, 7), valuePeriodic3(3, x - 5, y + 3, z + 7, 5, 3, 7), 1e-12), "value periodic");
    assert(near(gradientPeriodic3(3, x, y, z, 5, 3, 7), gradientPeriodic3(3, x + 10, y + 3, z - 7, 5, 3, 7), 1e-12), "gradient periodic");
    worleyPeriodic3(3, x, y, z, 0.9, cellA, 3, 4, 5);
    worleyPeriodic3(3, x + 3, y + 8, z - 5, 0.9, cellB, 3, 4, 5);
    assert(near(cellA.f1, cellB.f1, 1e-9) && near(cellA.f2, cellB.f2, 1e-9) && cellA.cellId === cellB.cellId, "worley periodic");
  }
  // A period of 0 on an axis means "not periodic" there.
  let d = 0;
  for (const [x, y, z] of probes(200)) d += Math.abs(simplexPeriodic3(3, x, y, z, 0, 0, 0) - simplexPeriodic3(3, x + 4, y, z, 0, 0, 0));
  assert(d > 5, "no wrap without a period");
});

Deno.test("algebra: compiled trees with `period` tile exactly, through every domain op", () => {
  const P = 8;
  const trees: NoiseExpr[] = [
    { op: "fbm", base: "simplex", scale: 1.7, octaves: 5, lacunarity: 2.3 },
    { op: "ridged", base: "value", scale: 0.9 },
    { op: "rotate", angle: 0.3, a: { op: "worley", scale: 1.1, feature: "f2MinusF1" } },
    { op: "rotate", angle: 2.0, a: { op: "stripes", axis: "x", scale: 0.6 } },
    { op: "scale", factor: 1.7, a: { op: "gradient", scale: 0.8 } },
    { op: "translate", offset: [0.3, 1.1, -2.5], a: { op: "spots", scale: 0.9 } },
    { op: "warp", amount: 0.7, a: { op: "checker", scale: 0.5 } },
    { op: "warp", amount: 0.7, by: { op: "billow", scale: 2 }, a: { op: "turbulence", scale: 1.3 } },
    { op: "tile", period: 3, a: { op: "value", scale: 0.45 } },
    { op: "coordinate", axis: "radial", cell: 2.5 },
  ];
  for (const t of trees) {
    const f = compileNoise(t, 11, { period: P });
    let bad = 0;
    for (const [x, y, z] of probes(600, 8)) {
      const v = f(x, y, z);
      if (!near(v, f(x + P, y, z), 1e-7) || !near(v, f(x, y + P, z - 2 * P), 1e-7)) bad++;
    }
    // Step-like trees may flip at a cell border from float rounding: allow 0.5%.
    assert(bad <= 3, `${JSON.stringify(t)} periodic: ${bad} mismatches`);
  }
  // Non-periodic compiles really are not periodic.
  const f = compileNoise({ op: "fbm", scale: 1.7 }, 11);
  let d = 0;
  for (const [x, y, z] of probes(200)) d += Math.abs(f(x, y, z) - f(x + P, y, z));
  assert(d > 5, "no period -> no wrap");
});

Deno.test("algebra: non-periodic warp (Noise.ts warp3) bends the domain, deterministic per seed", () => {
  const e: NoiseExpr = { op: "warp", amount: 1, a: X };
  const f = compileNoise(e, 4), g = compileNoise(e, 4);
  let moved = 0;
  for (const [x, y, z] of probes(300)) {
    const v = f(x, y, z);
    assert(v === g(x, y, z), "deterministic");
    if (Math.abs(v - x) > 0.05) moved++;
    assert(Math.abs(v - x) <= 1 + 1e-9, "displacement bounded by amount");
  }
  assert(moved > 150, `warp moves most points (${moved}/300)`);
});

Deno.test("algebra: salts decorrelate sources; equal salts correlate; trees are JSON round-trippable", () => {
  const a: NoiseExpr = { op: "gradient", scale: 1, seedSalt: 5 };
  const b: NoiseExpr = { op: "gradient", scale: 1, seedSalt: 6 };
  const fa = compileNoise(a, 1), fa2 = compileNoise({ op: "add", a: c(0), b: a }, 1), fb = compileNoise(b, 1);
  let same = 0, diff = 0;
  for (const [x, y, z] of probes(200)) { same += Math.abs(fa(x, y, z) - fa2(x, y, z)); diff += Math.abs(fa(x, y, z) - fb(x, y, z)); }
  assert(same === 0 && diff > 5, "explicit salt pins the field");
  const tree: NoiseExpr = { op: "mix", a: { op: "fbm", base: "simplex" }, b: { op: "spots" }, t: { op: "checker" } };
  const back = JSON.parse(JSON.stringify(tree)) as NoiseExpr;
  const f1 = compileNoise(tree, 9), f2 = compileNoise(back, 9);
  for (const [x, y, z] of probes(100)) assert(f1(x, y, z) === f2(x, y, z), "JSON round trip");
  assert([...noiseOpsUsed(tree)].sort().join() === ["checker", "fbm", "mix", "spots"].join(), "noiseOpsUsed walks a, b, t");
});

Deno.test("algebra: compiled samplers are fast enough to bake (allocation-free closures)", () => {
  const f = compileNoise({ op: "fbm", base: "simplex", octaves: 5, scale: 2 }, 1, { period: 8 });
  let s = 0;
  const t0 = performance.now();
  for (let i = 0; i < 100000; i++) s += f(i * 0.013, 0.37, i * 0.007);
  const ms = performance.now() - t0;
  console.log(`  periodic 5-octave simplex fbm: ${(ms * 10).toFixed(1)} ns/sample (100k samples in ${ms.toFixed(1)} ms)`);
  assert(Number.isFinite(s) && ms < 1500, "bounded cost");
});
