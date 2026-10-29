// Lane C: the world-variable table — structure (one writer, acyclic, every op/coefficient/input
// used), contract ranges over random inputs (with distribution stats), and physical sanity.
import { EXPR_OPS, RENDER_VARS, type WorldEquation } from "../src/world/climate/contracts.ts";
import { exprRefs } from "../src/world/climate/Expr.ts";
import {
  evaluateWorld, magnusDewPointC, magnusSatVapourHPa, topoSortEquations, WORLD_COEFFICIENTS, WORLD_EQUATIONS, WORLD_ORDER, WORLD_VARS,
} from "../src/world/climate/WorldVars.ts";
import { rng32, summarize } from "../src/core/MathCore.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

/** Contract ranges written next to RENDER_VARS (fog distances: lane C's declared metres). */
const CONTRACT_RANGE: Record<string, [number, number]> = {
  "render.exposure": [0.6, 1.6], "render.saturation": [0, 1.6], "render.haze": [0, 1], "render.sunMul": [0, 1.5],
  "render.ambientMul": [0.3, 2], "render.wetness": [0, 1], "render.windSway": [0, 1], "render.cloudShadow": [0, 1],
  "render.giStrength": [0, 1.5], "render.turbidity": [1, 10], "render.starVisibility": [0, 1], "render.rainStreaks": [0, 1],
  "render.lightning": [0, 1], "render.fogNear": [0, 6000], "render.fogFar": [0, 6000],
};

Deno.test("world: every EXPR_OPS operator appears in at least one equation", () => {
  const used = new Set<string>();
  for (const e of WORLD_EQUATIONS) for (const op of exprRefs(e.expr).ops) used.add(op);
  const missing = EXPR_OPS.filter((op) => !used.has(op));
  assert(missing.length === 0, `unused operators: ${missing.join(", ")}`);
});

Deno.test("world: each derived var has exactly one writer; only derived vars are written", () => {
  const writers = new Map<string, number>();
  for (const e of WORLD_EQUATIONS) writers.set(e.out, (writers.get(e.out) ?? 0) + 1);
  for (const d of WORLD_VARS) {
    if (d.source === "derived") assert(writers.get(d.id) === 1, `${d.id} has ${writers.get(d.id) ?? 0} writers`);
    else assert(!writers.has(d.id), `${d.source} var ${d.id} must not be written`);
  }
  const ids = WORLD_VARS.map((d) => d.id);
  assert(new Set(ids).size === ids.length, "unique var ids");
  const eqIds = WORLD_EQUATIONS.map((e) => e.id);
  assert(new Set(eqIds).size === eqIds.length, "unique equation ids");
  for (const d of WORLD_VARS) assert(d.min <= d.def && d.def <= d.max, `${d.id} def inside [min,max]`);
});

Deno.test("world: the graph is acyclic (evaluation order respects every dependency) and a cycle throws naming it", () => {
  const pos = new Map(WORLD_ORDER.map((e, i) => [e.out, i]));
  assert(WORLD_ORDER.length === WORLD_EQUATIONS.length, "all equations ordered");
  const derived = new Set(WORLD_VARS.filter((d) => d.source === "derived").map((d) => d.id));
  for (const e of WORLD_ORDER) {
    for (const r of exprRefs(e.expr).vars) {
      if (derived.has(r)) assert(pos.get(r)! < pos.get(e.out)!, `${r} must be computed before ${e.out}`);
    }
  }
  const cyc: WorldEquation[] = [
    { id: "a", out: "p", expr: { v: "q" }, why: "" },
    { id: "b", out: "q", expr: { op: "add", args: [{ v: "p" }, 1] }, why: "" },
  ];
  let msg = "";
  try {
    topoSortEquations(cyc, [
      { id: "p", source: "derived", unit: "", min: 0, max: 1, def: 0, note: "" },
      { id: "q", source: "derived", unit: "", min: 0, max: 1, def: 0, note: "" },
    ]);
  } catch (e) { msg = (e as Error).message; }
  assert(msg.includes("cycle") && msg.includes("p") && msg.includes("q"), `cycle error names it: ${msg}`);
});

Deno.test("world: every coefficient is referenced and every non-derived var is read", () => {
  const coefs = new Set<string>(), reads = new Set<string>();
  for (const e of WORLD_EQUATIONS) {
    const r = exprRefs(e.expr);
    for (const k of r.coefficients) coefs.add(k);
    for (const x of r.vars) reads.add(x);
  }
  const unusedCoef = Object.keys(WORLD_COEFFICIENTS).filter((k) => !coefs.has(k));
  assert(unusedCoef.length === 0, `unreferenced coefficients: ${unusedCoef.join(", ")}`);
  const unread = WORLD_VARS.filter((d) => d.source !== "derived" && !reads.has(d.id)).map((d) => d.id);
  assert(unread.length === 0, `inputs never read: ${unread.join(", ")}`);
  for (const e of WORLD_EQUATIONS) assert(e.why.length > 10, `${e.id} documents its why`);
  console.log(`world: ${WORLD_VARS.length} vars (${WORLD_VARS.filter((d) => d.source !== "derived").length} inputs), ` +
    `${WORLD_EQUATIONS.length} equations, ${Object.keys(WORLD_COEFFICIENTS).length} coefficients, ${EXPR_OPS.length}/${EXPR_OPS.length} ops`);
});

Deno.test("world: all RENDER_VARS present, finite and inside the contract ranges over random inputs (stats)", () => {
  const rng = rng32(20261029);
  const N = 4000;
  const samples: Record<string, number[]> = {};
  for (const id of RENDER_VARS) samples[id] = [];
  samples.visibilityKm = []; samples.dewPointC = []; samples.cloudBaseM = [];
  for (let i = 0; i < N; i++) {
    const inputs: Record<string, number> = {};
    for (const d of WORLD_VARS) if (d.source !== "derived") inputs[d.id] = d.min + (d.max - d.min) * rng();
    // half the samples: realistic weather instead of uniform noise
    if (i % 2 === 0) {
      inputs.rain = rng() < 0.7 ? 0 : rng(); inputs.fog = rng() < 0.8 ? 0 : rng(); inputs.snow = rng() < 0.9 ? 0 : rng();
      inputs.lightning = rng() < 0.95 ? 0 : rng(); inputs.temperatureC = -15 + 50 * rng(); inputs.windSpeedMs = 12 * rng() ** 2;
      inputs.pressureHPa = 990 + 40 * rng();
    }
    const out = evaluateWorld(inputs);
    for (const d of WORLD_VARS) {
      const x = out[d.id];
      assert(Number.isFinite(x), `${d.id} finite (got ${x})`);
      assert(x >= d.min - 1e-9 && x <= d.max + 1e-9, `${d.id}=${x} inside declared [${d.min}, ${d.max}]`);
    }
    for (const id of RENDER_VARS) {
      const [lo, hi] = CONTRACT_RANGE[id];
      assert(out[id] >= lo - 1e-9 && out[id] <= hi + 1e-9, `${id}=${out[id]} inside contract [${lo}, ${hi}]`);
      samples[id].push(out[id]);
    }
    assert(out["render.fogNear"] <= out["render.fogFar"], "fog starts before it ends");
    samples.visibilityKm.push(out.visibilityKm); samples.dewPointC.push(out.dewPointC); samples.cloudBaseM.push(out.cloudBaseM);
  }
  const f = (x: number) => x.toFixed(3);
  for (const id of ["render.exposure", "render.saturation", "render.haze", "render.sunMul", "render.ambientMul", "render.wetness",
    "render.turbidity", "render.giStrength", "render.cloudShadow", "render.windSway", "visibilityKm", "cloudBaseM"]) {
    const s = summarize(samples[id]);
    console.log(`  ${id.padEnd(22)} min ${f(s.min)} max ${f(s.max)} mean ${f(s.mean)} median ${f(s.median)} p20 ${f(s.p20)} p80 ${f(s.p80)}`);
    assert(s.p80 > s.p20, `${id} varies (p20 ${s.p20} < p80 ${s.p80})`);
  }
  const missing = RENDER_VARS.filter((id) => !WORLD_VARS.some((d) => d.id === id));
  assert(missing.length === 0, `RENDER_VARS declared: ${missing.join(",")}`);
});

Deno.test("world: Magnus / dew point / gas-law / Beaufort / LCL sanity", () => {
  const o = evaluateWorld({ temperatureC: 20, relativeHumidity: 0.5, pressureHPa: 1013.25, windSpeedMs: 9.5 });
  assert(Math.abs(o.dewPointC - 9.3) < 0.15, `T=20 RH=0.5 -> Td ~9.3 (got ${o.dewPointC})`);
  assert(Math.abs(magnusDewPointC(20, 0.5) - o.dewPointC) < 1e-9, "helper == equation");
  assert(Math.abs(o.satVapourHPa - 23.37) < 0.2 && Math.abs(magnusSatVapourHPa(20) - o.satVapourHPa) < 1e-9, `e_s(20) ~23.4 hPa (${o.satVapourHPa})`);
  assert(Math.abs(o.cloudBaseM - 125 * (20 - o.dewPointC)) < 1e-6, "LCL = 125 m/K x spread");
  assert(o.airDensity > 1.17 && o.airDensity < 1.21, `rho(20 C, 1013 hPa) ~1.20 (got ${o.airDensity})`);
  assert(o.beaufort === 5, `9.5 m/s is Beaufort 5 (8.0-10.7) (got ${o.beaufort})`);
  assert(evaluateWorld({ windSpeedMs: 11.5 }).beaufort === 6 && evaluateWorld({ windSpeedMs: 0.2 }).beaufort === 0, "Beaufort 6 at 11.5 m/s, 0 at 0.2");
  const sat = evaluateWorld({ temperatureC: 10, relativeHumidity: 1 });
  assert(Math.abs(sat.dewPointC - 10) < 1e-6, "saturated: Td == T");
  const cold = evaluateWorld({ temperatureC: -10, windSpeedMs: 10, relativeHumidity: 0.7 });
  assert(cold.apparentTempC < -15 && cold.apparentTempC === cold.windChillC, `wind chill at -10 C, 36 km/h ~ -19 (got ${cold.apparentTempC})`);
  const hot = evaluateWorld({ temperatureC: 32, relativeHumidity: 0.7 });
  assert(hot.apparentTempC > 40 && hot.apparentTempC === hot.humidexC, `humidex(32 C, 70%) > 40 (got ${hot.apparentTempC})`);
  const eq = evaluateWorld({ dayOfYear: 81, latitude: 48 });
  assert(Math.abs(eq.dayLengthHours - 12) < 0.2, `equinox day ~12 h (got ${eq.dayLengthHours})`);
  const sol = evaluateWorld({ dayOfYear: 172, latitude: 48 });
  assert(sol.dayLengthHours > 15.5 && sol.dayLengthHours < 16.5, `48N midsummer ~16 h (got ${sol.dayLengthHours})`);
});

Deno.test("world: variables interact across groups in the physical direction", () => {
  const base = { sunElevationDeg: 40, temperatureC: 18, relativeHumidity: 0.55, cloudLow: 0.2, cloudMid: 0.1, cloudHigh: 0.1 };
  const w = (o: Record<string, number>) => evaluateWorld({ ...base, ...o });
  const b = w({});
  assert(w({ cloudLow: 1, cloudMid: 0.8 })["render.sunMul"] < b["render.sunMul"] * 0.5, "overcast dims the sun");
  assert(w({ sunElevationDeg: -20 })["render.exposure"] > b["render.exposure"], "night is exposed up");
  assert(w({ sunElevationDeg: -20, moonIlunBrightness: 1 })["render.exposure"] < w({ sunElevationDeg: -20 })["render.exposure"], "moonlight lowers night exposure");
  assert(w({ rain: 0.8 })["render.wetness"] > 0.7, "rain wets");
  assert(w({ rain: 0.8, temperatureC: -8 })["render.wetness"] < w({ rain: 0.8 })["render.wetness"], "ice is less glossy");
  assert(w({ relativeHumidity: 0.95 })["render.haze"] > b["render.haze"], "humid aerosols swell -> haze");
  assert(w({ fog: 0.8 })["render.fogFar"] < 200, "fog pulls the fog wall in");
  assert(w({ rain: 1 })["render.turbidity"] < b["render.turbidity"], "rain washout cleans the sky");
  assert(w({ snowCover: 1 })["render.giStrength"] > b["render.giStrength"], "snow bounces light");
  assert(w({ cloudTowering: 0.8 })["render.cloudShadow"] > b["render.cloudShadow"], "towers cast shadows");
  assert(w({ sunElevationDeg: -2 })["render.cloudShadow"] === 0, "no cloud shadow without sun");
  assert(w({ sunElevationDeg: 3 }).sunWarmth > b.sunWarmth + 0.3, "low sun is reddened (lambda^-4)");
  assert(w({ windSpeedMs: 14, gustMs: 22 })["render.windSway"] > 0.8, "gale sways");
});
