// Lane N: value spread (histogram stretch / equalise) and spatial spread (Poisson disc,
// Pareto-sized non-overlapping scatter).
import {
  alphaForTopShare, cappedParetoTopShare, measureSpread, paretoSizes, poissonDisc, scatter, spreadTo,
} from "../src/graphics/paint/Spread.ts";
import { compileNoise } from "../src/graphics/paint/NoiseAlgebra.ts";
import { PARETO_80_20_ALPHA, rng32, topShare } from "../src/core/MathCore.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }
const f3 = (v: number) => v.toFixed(3);

/** 64 x 64 fbm sample (the muddy N(0.5, ~0.1) distribution spreadTo exists for). */
function fbmSample(seed: number): Float32Array {
  const f = compileNoise({ op: "fbm", base: "gradient", octaves: 5, scale: 2 }, seed);
  const out = new Float32Array(64 * 64);
  for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) out[j * 64 + i] = f(i * 0.125, 0.37, j * 0.125);
  return out;
}

Deno.test("spread: measureSpread reports p20/p80 and spread = p80 - p20", () => {
  const v = Array.from({ length: 101 }, (_, i) => i / 100);
  const s = measureSpread(v);
  assert(Math.abs(s.p20 - 0.2) < 1e-12 && Math.abs(s.p80 - 0.8) < 1e-12, "uniform quantiles");
  assert(Math.abs(s.spread - 0.6) < 1e-12 && s.range === 1 && s.median === 0.5 && s.count === 101, "fields");
});

Deno.test("spread: spreadTo lands an fbm sample on target p20/p80 within 0.02", () => {
  for (const seed of [1, 2, 3]) {
    const v = fbmSample(seed);
    const before = measureSpread(v);
    for (const t of [{ p20: 0.25, p80: 0.75 }, { p20: 0.3, p80: 0.7 }, { p20: 0.55, p80: 0.85 }]) {
      const w = spreadTo(Float32Array.from(v), t);
      const after = measureSpread(w);
      if (seed === 1) {
        console.log(`  fbm p20..p80 ${f3(before.p20)}..${f3(before.p80)} (spread ${f3(before.spread)}) -> ` +
          `${f3(after.p20)}..${f3(after.p80)} (target ${t.p20}..${t.p80}), range ${f3(after.min)}..${f3(after.max)}`);
      }
      assert(Math.abs(after.p20 - t.p20) < 0.02 && Math.abs(after.p80 - t.p80) < 0.02, `seed ${seed} hits ${JSON.stringify(t)}`);
      assert(after.min >= 0 && after.max <= 1, "clamped to [0,1]");
    }
    assert(before.spread < 0.3, `fbm really is bunched (spread ${before.spread})`);
  }
});

Deno.test("spread: {lo, hi} min/max stretch and custom clamp", () => {
  const v = [2, 3, 4, 6];
  spreadTo(v, { lo: 0.1, hi: 0.9 });
  assert(Math.abs(v[0] - 0.1) < 1e-12 && Math.abs(v[3] - 0.9) < 1e-12 && Math.abs(v[1] - 0.3) < 1e-12, "linear stretch");
  const w = [0, 1, 2];
  spreadTo(w, { lo: -1, hi: 1 }, { clampLo: -1, clampHi: 1 });
  assert(w[0] === -1 && w[1] === 0 && w[2] === 1, "custom clamp range");
});

Deno.test("spread: equalize gives a uniform histogram (CDF), and hits p20/p80 targets", () => {
  const v = fbmSample(4);
  const eq = spreadTo(Float32Array.from(v), { lo: 0, hi: 1 }, { equalize: true });
  const bins = new Array(10).fill(0);
  for (const x of eq) bins[Math.min(9, Math.floor(x * 10))]++;
  const shares = bins.map((b) => b / eq.length);
  console.log(`  equalised decile shares: ${shares.map(f3).join(" ")}`);
  for (const s of shares) assert(Math.abs(s - 0.1) < 0.01, `uniform decile ${s}`);
  const eq2 = measureSpread(spreadTo(Float32Array.from(v), { p20: 0.3, p80: 0.7 }, { equalize: true }));
  assert(Math.abs(eq2.p20 - 0.3) < 0.02 && Math.abs(eq2.p80 - 0.7) < 0.02, "equalize + quantile target");
  // Monotone: order is preserved.
  for (let i = 1; i < 200; i++) if (v[i] > v[i - 1]) assert(eq[i] >= eq[i - 1], "monotone map");
  // Ties share a rank.
  const t = spreadTo([5, 5, 1, 9], { lo: 0, hi: 1 }, { equalize: true });
  assert(t[0] === t[1] && t[2] === 0 && t[3] === 1, "ties share their mean rank");
});

Deno.test("spread: degenerate samples fall back safely", () => {
  const flat = spreadTo([0.4, 0.4, 0.4], { p20: 0.2, p80: 0.6 });
  assert(flat.every((x) => Math.abs(x - 0.4) < 1e-12), "constant -> target midpoint");
  const mask = new Float32Array(100); mask[3] = 1; mask[50] = 1; // p20 = p80 = 0
  spreadTo(mask, { p20: 0.3, p80: 0.7 });
  assert(mask[3] === 1 && mask[0] === 0, "sparse mask -> min/max stretch, stays binary");
  assert(spreadTo([], { lo: 0, hi: 1 }).length === 0, "empty is a no-op");
});

/** Toroidal-or-plain distance. */
function dist(a: { x: number; y: number }, b: { x: number; y: number }, w: number, h: number, wrap: boolean): number {
  let dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
  if (wrap) { dx = Math.min(dx, w - dx); dy = Math.min(dy, h - dy); }
  return Math.hypot(dx, dy);
}

Deno.test("spread: poissonDisc keeps the min-distance invariant and covers the domain", () => {
  const W = 100, H = 60, r = 3;
  for (const wrap of [false, true]) {
    const pts = poissonDisc(rng32(1), W, H, r, { wrap });
    let minD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      assert(pts[i].x >= 0 && pts[i].x < W && pts[i].y >= 0 && pts[i].y < H, "inside the domain");
      for (let j = i + 1; j < pts.length; j++) minD = Math.min(minD, dist(pts[i], pts[j], W, H, wrap));
    }
    // Coverage: no probe farther than 2r from a sample (Bridson's maximality, k = 30).
    let gapMax = 0;
    for (let y = 0.5; y < H; y += 1) {
      for (let x = 0.5; x < W; x += 1) {
        let best = Infinity;
        for (const p of pts) best = Math.min(best, dist(p, { x, y }, W, H, wrap));
        gapMax = Math.max(gapMax, best);
      }
    }
    const density = pts.length * r * r / (W * H);
    console.log(`  poisson wrap=${wrap}: ${pts.length} points, min pair distance ${f3(minD)} (r=${r}), ` +
      `largest gap ${f3(gapMax)} (< 2r), density n r^2 / A = ${f3(density)}`);
    assert(minD >= r - 1e-9, `min distance ${minD} >= ${r}`);
    assert(gapMax < 2 * r, `coverage gap ${gapMax} < ${2 * r}`);
    assert(density > 0.55 && density < 0.85, `blue-noise density ${density}`);
  }
  const a = poissonDisc(rng32(7), 40, 40, 2), b = poissonDisc(rng32(7), 40, 40, 2), c = poissonDisc(rng32(8), 40, 40, 2);
  assert(JSON.stringify(a) === JSON.stringify(b), "deterministic per seed");
  assert(JSON.stringify(a) !== JSON.stringify(c), "different seed -> different set");
});

Deno.test("spread: Pareto sizes at PARETO_80_20_ALPHA — top 20% hold ~80% (large sample)", () => {
  const shares: number[] = [];
  for (const seed of [1, 2, 3, 4, 5]) shares.push(topShare(paretoSizes(rng32(seed), 200000, 1)));
  shares.sort();
  const median = shares[2];
  console.log(`  uncapped top-20% share over 5 x 200k draws: ${shares.map(f3).join(" ")} (median ${f3(median)}, theory 0.8)`);
  assert(Math.abs(median - 0.8) < 0.05, `median share ${median}`);
  assert(Math.abs(cappedParetoTopShare(PARETO_80_20_ALPHA, Infinity) - 0.8) < 1e-9, "analytic uncapped share is 0.8");
  // A cap lowers the share; the analytic formula predicts the sampled one.
  const capped = topShare(paretoSizes(rng32(9), 200000, 1, 100));
  const predicted = cappedParetoTopShare(PARETO_80_20_ALPHA, 100);
  console.log(`  capped at 100 x min: sampled ${f3(capped)}, predicted ${f3(predicted)}`);
  assert(Math.abs(capped - predicted) < 0.02, "capped share matches the analytic value");
  const a400 = alphaForTopShare(400);
  assert(Math.abs(cappedParetoTopShare(a400, 400) - 0.8) < 1e-6, "alphaForTopShare solves for 0.8 (cap 400)");
  const a20 = alphaForTopShare(20), peak20 = cappedParetoTopShare(a20, 20);
  console.log(`  cap 400: alpha ${f3(a400)} keeps 80/20; cap 20: unreachable, peak share ${f3(peak20)} at alpha ${f3(a20)}`);
  assert(peak20 < 0.8 && peak20 >= cappedParetoTopShare(a20 * 1.2, 20) && peak20 >= cappedParetoTopShare(a20 / 1.2, 20),
    "too tight a cap returns the peak-share alpha");
  assert(Math.abs(alphaForTopShare(Infinity) - PARETO_80_20_ALPHA) < 1e-6, "uncapped -> the 80/20 alpha");
});

Deno.test("spread: scatter — non-overlapping discs, 80/20 sizes, deterministic, clusterable", () => {
  const area = { width: 240, height: 240 }, sizeMin = 0.6, sizeMax = 12, cap = sizeMax / sizeMin;
  // Disc AREA r^2 is Pareto with alpha_r / 2 and cap^2: pick alpha_r so the AREAS keep 80/20.
  const alpha = 2 * alphaForTopShare(cap * cap);
  for (const wrap of [false, true]) {
    const pts = scatter(rng32(3), area, 800, { sizeMin, sizeMax, wrap, alpha, gap: 0.2 });
    let violations = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!wrap) assert(p.x - p.r >= -1e-9 && p.x + p.r <= area.width + 1e-9, "disc inside the area");
      assert(p.r >= sizeMin - 1e-12 && p.r <= sizeMax + 1e-12, "radius within [sizeMin, sizeMax]");
      for (let j = i + 1; j < pts.length; j++) {
        if (dist(p, pts[j], area.width, area.height, wrap) < p.r + pts[j].r + 0.2 - 1e-9) violations++;
      }
    }
    const areaShare = topShare(pts.map((p) => p.r * p.r)), radiusShare = topShare(pts.map((p) => p.r));
    console.log(`  scatter wrap=${wrap}: placed ${pts.length}/800, alpha_r ${f3(alpha)}, top-20% AREA share ${f3(areaShare)}, ` +
      `radius share ${f3(radiusShare)} (predicted ${f3(cappedParetoTopShare(alpha, cap))}), overlaps ${violations}`);
    assert(violations === 0, "min-distance invariant: d >= r_i + r_j + gap");
    assert(pts.length >= 780, "almost every item finds room");
    assert(Math.abs(areaShare - 0.8) < 0.06, `80/20 disc areas: ${areaShare}`);
  }
  // Default alpha = PARETO_80_20_ALPHA on the radii: the capped share matches the analytic prediction.
  const d = scatter(rng32(4), area, 1500, { sizeMin, sizeMax: 6 });
  const got = topShare(d.map((p) => p.r)), want = cappedParetoTopShare(PARETO_80_20_ALPHA, 10);
  console.log(`  scatter default alpha (cap 10x): placed ${d.length}/1500, radius share ${f3(got)}, predicted ${f3(want)}`);
  assert(d.length >= 1450 && Math.abs(got - want) < 0.04, "default radii follow the capped 80/20 Pareto");
  const a = scatter(rng32(5), area, 300, { sizeMin, sizeMax, cluster: 0.8 });
  const b = scatter(rng32(5), area, 300, { sizeMin, sizeMax, cluster: 0.8 });
  assert(JSON.stringify(a) === JSON.stringify(b), "deterministic per seed");
});

Deno.test("spread: cluster > 0 concentrates items where the density noise is high", () => {
  const area = { width: 200, height: 200 };
  const density = {
    op: "smoothstep", e0: 0.35, e1: 0.65, a: { op: "fbm", base: "simplex", octaves: 3, scale: 50, seedSalt: 3 },
  } as const;
  const meanDensity = (cluster: number): number => {
    let sum = 0, n = 0;
    for (const seed of [1, 2, 3]) {
      // scatter draws the density seed as its first non-size rng value; rebuild the same field.
      const rnd = rng32(seed);
      const pts = scatter(rnd, area, 400, { sizeMin: 0.5, sizeMax: 2, cluster, density });
      const probe = rng32(seed);
      for (let i = 0; i < 400; i++) probe();
      const f = compileNoise(density, Math.floor(probe() * 4294967296));
      for (const p of pts) { sum += f(p.x, 0, p.y); n++; }
    }
    return sum / n;
  };
  const even = meanDensity(0), clustered = meanDensity(1);
  console.log(`  mean density at placed items: cluster 0 -> ${f3(even)}, cluster 1 -> ${f3(clustered)}`);
  assert(clustered > even + 0.2, "clustered scatter sits on the dense patches");
});
