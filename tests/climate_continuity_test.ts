// Lane E: continuity and totality of the world equations and the climate facade.
//
//  - Lipschitz probe: every input swept across its declared range in SWEEP_STEPS steps (others at
//    seeded typical values, several seeds); no derived output may move by more than its declared
//    tolerance (fraction of its declared range) between neighbouring steps, except the outputs
//    listed as DISCRETE (display values). Each offending pair is bisected to tell a true jump
//    (persists at a 1e-12 interval) from a merely steep slope.
//  - Time probe: a whole simulated run (handovers, midnight, day change, freezing) frame by frame:
//    no var pops by more than its tolerance between two frames (lightning frames excluded: a
//    flash is a legitimate discrete event).
//  - Totality: random, extreme and non-finite inputs -> every output finite and inside its range.
import { createClimate } from "../src/world/climate/Climate.ts";
import { evaluateWorld, WORLD_VARS } from "../src/world/climate/WorldVars.ts";
import { rng32 } from "../src/core/MathCore.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const SWEEP_STEPS = 2000;
const SEEDS = [1, 2, 3, 4, 5, 6];
/** Outputs that are legitimately discrete (rounded display values): exempt from the probe. */
const DISCRETE: ReadonlySet<string> = new Set(["beaufort", "precipKind"]);
/** Circular quantities (compared modulo their period). */
const CIRCULAR: Readonly<Record<string, number>> = { seasonPhase: 1, hour: 24, dayOfYear: 365 };
/** Default largest neighbour-to-neighbour move, as a fraction of the output's declared range. */
const DEFAULT_TOL = 0.02;
/**
 * Declared exceptions (continuous but steep). dayLengthHours: the sunrise equation has a
 * square-root (non-Lipschitz, still continuous) corner at the polar circle, where the day length
 * runs from 24 h down at an infinite slope — physics, not a pop (the bisection confirms it closes).
 */
const TOL: Readonly<Record<string, number>> = {
  dayLengthHours: 0.05,
  // the freezing band is 1.5 K wide by design (patchy ice, not a pop): smoothstep's peak slope
  // 1.5 / 1.5 K x the probe's 0.0575 K step = 5.75 % of the 0..1 range; wetness inherits it (ice is less glossy)
  frozen: 0.06, "render.wetness": 0.05,
  // golden-hour window: 5 deg ramps (slope 0.3/deg x the 0.09 deg probe step = 2.7 %)
  golden: 0.03,
  // Kasten air mass climbs ~10x within a few degrees of the horizon (physics; smooth since lane E)
  airMass: 0.03,
  // Koschmieder V = 3.912 / beta: the first trace of snow/fog in clean air moves the fog wall fast
  "render.fogFar": 0.04, "render.fogNear": 0.04,
};

const DERIVED = WORLD_VARS.filter((d) => d.source === "derived");
const INPUTS = WORLD_VARS.filter((d) => d.source !== "derived");

/** Seeded typical weather (not uniform noise: the coupled regions are where pops hide). */
function typical(seed: number): Record<string, number> {
  const r = rng32(seed * 7919 + 13);
  const u = (lo: number, hi: number) => lo + (hi - lo) * r();
  const wind = u(0, 12);
  return {
    temperatureC: u(-15, 35), relativeHumidity: u(0.2, 0.98), pressureHPa: u(990, 1030), windSpeedMs: wind,
    gustMs: wind * u(1.2, 1.8), rain: r() < 0.5 ? 0 : u(0, 1), snow: r() < 0.7 ? 0 : u(0, 1), fog: r() < 0.6 ? 0 : u(0, 1),
    cloudLow: u(0, 0.9), cloudMid: u(0, 0.8), cloudHigh: u(0, 0.6), cloudTowering: r() < 0.6 ? 0 : u(0, 0.9),
    storminess: u(0, 1), lightning: 0, aerosolBase: u(0.1, 0.8), snowCover: r() < 0.6 ? 0 : u(0, 1),
    hour: u(0, 24), dayOfYear: u(1, 365), latitude: u(-70, 70), sunElevationDeg: u(-30, 70),
    moonIlunBrightness: u(0, 1), moonVeshBrightness: u(0, 0.5), moonIlunIllumination: u(0, 1), moonVeshIllumination: u(0, 1),
    groundAlbedo: u(0.1, 0.4),
  };
}

interface Jump { out: string; input: string; at: number; jump: number; seed: number; closes: boolean }

function delta(id: string, a: number, b: number): number {
  const p = CIRCULAR[id];
  if (p === undefined) return Math.abs(b - a);
  const d = Math.abs(b - a) % p;
  return Math.min(d, p - d);
}

/** Bisect [x0, x1] toward the largest move of `out`; true when the move vanishes (continuous). */
function closes(base: Record<string, number>, input: string, out: string, x0: number, x1: number, span: number): boolean {
  const f = (x: number) => evaluateWorld({ ...base, [input]: x })[out];
  let a = x0, b = x1, fa = f(a), fb = f(b);
  for (let i = 0; i < 44 && b - a > 1e-12 * Math.max(1, Math.abs(a)); i++) {
    const m = 0.5 * (a + b), fm = f(m);
    if (delta(out, fa, fm) >= delta(out, fm, fb)) { b = m; fb = fm; } else { a = m; fa = fm; }
  }
  return delta(out, fa, fb) / span < 1e-6;
}

/** Sweep every input; returns every per-(output, input, seed) maximum move. */
function lipschitzProbe(): Jump[] {
  const worst = new Map<string, Jump>();
  for (const seed of SEEDS) {
    const base = typical(seed);
    for (const inp of INPUTS) {
      let prev = evaluateWorld(base);
      let prevX = inp.min;
      prev = evaluateWorld({ ...base, [inp.id]: prevX });
      for (let k = 1; k <= SWEEP_STEPS; k++) {
        const x = inp.min + ((inp.max - inp.min) * k) / SWEEP_STEPS;
        const cur = evaluateWorld({ ...base, [inp.id]: x });
        for (const d of DERIVED) {
          const span = d.max - d.min;
          const j = delta(d.id, prev[d.id], cur[d.id]) / span;
          const key = `${d.id}|${inp.id}|${seed}`;
          const w = worst.get(key);
          if (!w || j > w.jump) worst.set(key, { out: d.id, input: inp.id, at: prevX, jump: j, seed, closes: true });
        }
        prev = cur; prevX = x;
      }
    }
  }
  const all = [...worst.values()];
  for (const j of all) {
    if (j.jump <= (TOL[j.out] ?? DEFAULT_TOL) * 0.25) continue; // only bisect the suspicious ones
    const inp = INPUTS.find((d) => d.id === j.input)!;
    const d = DERIVED.find((x) => x.id === j.out)!;
    j.closes = closes(typical(j.seed), j.input, j.out, j.at, j.at + (inp.max - inp.min) / SWEEP_STEPS, d.max - d.min);
  }
  return all.sort((a, b) => b.jump - a.jump);
}

const fmtJump = (j: Jump) =>
  `${j.out} <- ${j.input}@${j.at.toFixed(3)} jump ${(j.jump * 100).toFixed(2)}% of range${j.closes ? "" : " (TRUE DISCONTINUITY)"}`;

Deno.test("continuity: Lipschitz probe over every input — no derived output pops (top 5 printed)", () => {
  const all = lipschitzProbe();
  const top = all.filter((j) => !DISCRETE.has(j.out));
  console.log(`  ${INPUTS.length} inputs x ${SEEDS.length} seeds x ${SWEEP_STEPS} steps; 5 largest neighbour moves (continuous outputs):`);
  const seen = new Set<string>();
  let shown = 0;
  for (const j of top) {
    const k = `${j.out}|${j.input}`;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`    ${fmtJump(j)}`);
    if (++shown === 5) break;
  }
  const trueJumps = top.filter((j) => !j.closes);
  const names = [...new Set(trueJumps.map((j) => `${j.out}<-${j.input}`))];
  console.log(`  true discontinuities (bisection does not close): ${names.length}${names.length ? " — " + names.join(", ") : ""}`);
  const bad = top.filter((j) => j.jump > (TOL[j.out] ?? DEFAULT_TOL));
  assert(trueJumps.length === 0, `true discontinuities: ${names.join(", ")}`);
  assert(bad.length === 0, `over tolerance: ${[...new Set(bad.map(fmtJump))].slice(0, 12).join("; ")}`);
});

/**
 * Per-frame tolerances of the time probe (fraction of the declared range). A POP is a one-frame
 * outlier: the move itself (first difference) AND its change from the previous frame's move
 * (second difference, ~0 for C1 motion, O(1) for a jump) are both bounded.
 */
const FRAME_TOL = 0.02, FRAME_TOL2 = 0.005; // at 6x the default clock rate (a 240 s day)
/**
 * Koschmieder's V = 3.912 / beta is hypersensitive in clean air (dV = -V^2 dbeta / 3.912), so a
 * thousandth of fog moves a 20 km visibility by a kilometre: fast, but smooth (its second
 * difference stays within FRAME_TOL2). Declared, with the measured value in lane-E.md.
 */
const FRAME_TOL_VAR: Readonly<Record<string, number>> = {
  visibilityKm: 0.05, "render.fogFar": 0.1, "render.fogNear": 0.1, "render.haze": 0.05,
};
/** Same reason for the second difference: V'' = 2 V^3 beta'^2 / 3.912^2 is large at the first trace of snow. */
const FRAME_TOL2_VAR: Readonly<Record<string, number>> = { visibilityKm: 0.015, "render.fogFar": 0.015, "render.fogNear": 0.015 };

Deno.test("continuity: frame-to-frame — a simulated run never pops a world var (lightning frames excluded)", () => {
  // frostford spring: the air crosses 0 C every day (freeze/thaw), regimes hand over, days roll.
  const worst: Record<string, { j: number; t: number; p: string }> = {}, worst2: Record<string, { j: number; t: number; p: string }> = {};
  let frames = 0, skipped = 0;
  for (const [place, lat, doy] of [["frostford", 63, 100], ["greywall", 48, 300], ["sunspire", 12, 190]] as const) {
    const c = createClimate({ placeId: place, latitude: lat, seed: 31, year: 1, dayOfYear: doy, hour: 0, dayLengthSeconds: 240 });
    let prev = { ...c.frame().vars };
    let prevD: Record<string, number> | null = null;
    for (let i = 0; i < 240 * 30 * 6; i++) { // 6 game days at 30 fps (6x the default clock rate)
      const v = c.step(1 / 30).vars;
      const flash = v.lightning > 1e-6 || prev.lightning > 1e-6;
      if (flash) { skipped++; prev = { ...v }; prevD = null; continue; }
      frames++;
      const dNow: Record<string, number> = {};
      for (const d of WORLD_VARS) {
        if (DISCRETE.has(d.id)) continue;
        const span = d.max - d.min;
        const p = CIRCULAR[d.id];
        let dv = v[d.id] - prev[d.id];
        if (p !== undefined) dv -= p * Math.round(dv / p);
        dNow[d.id] = dv;
        const j = Math.abs(dv) / span;
        if (!worst[d.id] || j > worst[d.id].j) worst[d.id] = { j, t: i / 30, p: place };
        if (prevD) {
          const j2 = Math.abs(dv - prevD[d.id]) / span;
          if (!worst2[d.id] || j2 > worst2[d.id].j) worst2[d.id] = { j: j2, t: i / 30, p: place };
        }
      }
      prev = { ...v }; prevD = dNow;
    }
  }
  const ranked = Object.entries(worst).sort((a, b) => b[1].j - a[1].j);
  const ranked2 = Object.entries(worst2).sort((a, b) => b[1].j - a[1].j);
  console.log(`  ${frames} frames (${skipped} lightning frames skipped); 5 largest per-frame moves | second differences (% of range):`);
  for (let k = 0; k < 5; k++) {
    const [a, w] = ranked[k], [b, w2] = ranked2[k];
    console.log(`    ${a} ${(w.j * 100).toFixed(3)}% (${w.p} t=${w.t.toFixed(1)} s)  |  ${b} ${(w2.j * 100).toFixed(4)}% (${w2.p} t=${w2.t.toFixed(1)} s)`);
  }
  const bad = ranked.filter(([id, w]) => w.j > (FRAME_TOL_VAR[id] ?? FRAME_TOL));
  const bad2 = ranked2.filter(([id, w]) => w.j > (FRAME_TOL2_VAR[id] ?? FRAME_TOL2));
  assert(bad.length === 0, `per-frame pops: ${bad.map(([id, w]) => `${id} ${(w.j * 100).toFixed(2)}%`).join(", ")}`);
  assert(bad2.length === 0, `per-frame velocity jumps: ${bad2.map(([id, w]) => `${id} ${(w.j * 100).toFixed(3)}%`).join(", ")}`);
});

Deno.test("totality: random, extreme and non-finite inputs -> every output finite and inside its declared range", () => {
  const specials = [NaN, Infinity, -Infinity, 1e308, -1e308, 0, -0, 1e-300, -1e-300];
  const check = (inputs: Record<string, number>, what: string) => {
    const o = evaluateWorld(inputs);
    for (const d of WORLD_VARS) {
      const x = o[d.id];
      assert(Number.isFinite(x), `${what}: ${d.id} not finite (${x})`);
      assert(x >= d.min - 1e-9 && x <= d.max + 1e-9, `${what}: ${d.id}=${x} outside [${d.min}, ${d.max}]`);
    }
  };
  let n = 0;
  for (const seed of SEEDS) {
    const base = typical(seed);
    for (const inp of INPUTS) {
      for (const s of [...specials, inp.min, inp.max]) { check({ ...base, [inp.id]: s }, `${inp.id}=${s}`); n++; }
    }
  }
  for (const s of specials) {
    const all: Record<string, number> = {};
    for (const inp of INPUTS) all[inp.id] = s;
    check(all, `all=${s}`); n++;
  }
  const r = rng32(99);
  for (let i = 0; i < 4000; i++) {
    const inputs: Record<string, number> = {};
    for (const inp of INPUTS) {
      const u = r();
      inputs[inp.id] = u < 0.05 ? specials[Math.floor(r() * specials.length)] : u < 0.15 ? (r() - 0.5) * 1e6 : inp.min + (inp.max - inp.min) * r();
    }
    check(inputs, `random #${i}`); n++;
  }
  console.log(`  totality: ${n} evaluations, every output finite and inside its declared range`);
});
