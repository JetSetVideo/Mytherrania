// Wave G2: fuzzy maths + situational events (gates, fades, edge cases, strikes, composition).
import { and, angleBetween, bump, createEnvelope, ENVELOPE_MAX_DT, gate, not, or, ramp, stepEnvelope, unit, window } from "../src/core/Fuzzy.ts";
import { createWorldEvents, EVENT_IDS, EVENTS, inputsFromFrame, SPEED_OF_SOUND, STRIKE_MAX_M, STRIKE_MIN_M, type EventInputs } from "../src/world/events/WorldEvents.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const WEIRD = [NaN, Infinity, -Infinity, -1e300, 1e300, 0, -0];

Deno.test("fuzzy: every function is total (finite, in range) for NaN / +-Inf / degenerate widths", () => {
  for (const x of WEIRD) for (const a of WEIRD) for (const b of [0, 1, -1, NaN]) {
    for (const v of [unit(x), ramp(x, a, b), window(x, a, b, 0.5), bump(x, a, b), and(x, a), or(x, a), not(x)]) {
      assert(Number.isFinite(v) && v >= 0 && v <= 1, `out of range ${v} for ${x},${a},${b}`);
    }
  }
  assert(Number.isFinite(angleBetween([0, 0, 0], [1, 0, 0])), "zero vector angle finite");
  assert(Math.abs(angleBetween([1, 0, 0], [-1, 0, 0]) - Math.PI) < 1e-12, "antiparallel = pi");
  // The quintic overshoots 1 by an ulp just below t = 1 (found by the live-climate run): never > 1.
  for (let x = 0.999; x <= 1; x += 1e-7) assert(ramp(x, 0, 1) <= 1, `ramp(${x}) <= 1`);
});

Deno.test("fuzzy: ramp is C1 at both ends and monotone; window/bump peak inside", () => {
  const h = 1e-4;
  const d0 = (ramp(h, 0, 1) - ramp(0, 0, 1)) / h, d1 = (ramp(1, 0, 1) - ramp(1 - h, 0, 1)) / h;
  assert(d0 < 1e-6 && d1 < 1e-6, `zero slope at the ends: ${d0} ${d1}`);
  let prev = -1;
  for (let x = -0.5; x <= 1.5; x += 0.01) { const r = ramp(x, 0, 1); assert(r >= prev, "monotone"); prev = r; }
  assert(ramp(0.5, 1, 0) === 1 - ramp(0.5, 0, 1), "reversed ramp falls");
  assert(window(5, 0, 10, 2) === 1 && window(-1, 0, 10, 2) === 0 && window(11, 0, 10, 2) === 0, "window");
  assert(window(5, 10, 0, 2) === 0, "inverted window is empty");
});

Deno.test("fuzzy: t-norm / t-conorm laws (bounds, identity, commutativity, De Morgan)", () => {
  for (const a of [0, 0.2, 0.5, 0.9, 1]) for (const b of [0, 0.3, 0.7, 1]) {
    assert(and(a, b) <= Math.min(a, b) + 1e-12 && or(a, b) >= Math.max(a, b) - 1e-12, "bounds");
    assert(and(a, 1) === a && Math.abs(or(a, 0) - a) < 1e-12, "identity");
    assert(Math.abs(and(a, b) - and(b, a)) < 1e-12 && Math.abs(or(a, b) - or(b, a)) < 1e-12, "commutative");
    assert(Math.abs(not(and(a, b)) - or(not(a), not(b))) < 1e-12, "De Morgan");
  }
});

Deno.test("gate: hysteresis never flickers on a noisy score at the threshold", () => {
  const g = { on: false };
  let flips = 0, prev = false;
  for (let k = 0; k < 2000; k++) {
    const s = 0.5 + 0.04 * Math.sin(k * 1.7);  // hovers around on = 0.5
    const now = gate(g, s, 0.5, 0.4);
    if (now !== prev) flips++;
    prev = now;
  }
  assert(flips === 1, `one switch on, never off: ${flips}`);
  assert(!gate({ on: true }, NaN, 0.5, 0.4), "NaN closes the gate");
});

Deno.test("envelope: smooth start/end, holds, clamps huge dt, snaps to exact 0/1", () => {
  const e = createEnvelope();
  const outs: number[] = [];
  for (let k = 0; k < 1000; k++) outs.push(stepEnvelope(e, k < 200, 1, 1 / 60, 0.5, 0.8, 0).out);
  assert(outs[199] === 1 || outs[199] > 0.999, `reaches 1: ${outs[199]}`);
  assert(outs[999] === 0, `snaps back to exactly 0: ${outs[999]}`);
  // First derivative small at the very start (smootherstep shaping): the first frame moves < 1 %.
  assert(outs[0] < 0.01, `soft start ${outs[0]}`);
  for (let k = 1; k < outs.length; k++) assert(Math.abs(outs[k] - outs[k - 1]) < 0.06, `no pop at ${k}`);
  const h = createEnvelope();
  stepEnvelope(h, true, 1, 0.1, 0.01, 0.01, 5);
  for (let k = 0; k < 30; k++) stepEnvelope(h, false, 0, 0.1, 0.01, 0.01, 5);
  assert(h.out > 0.9, "minimum hold keeps it up for 5 s after the gate closes");
  for (let k = 0; k < 40; k++) stepEnvelope(h, false, 0, 0.1, 0.01, 0.01, 5);
  assert(h.out === 0, "then releases");
  const big = createEnvelope();
  stepEnvelope(big, true, 1, 1e9, 1, 1, 0);
  assert(big.level <= 1 - Math.pow(2, -ENVELOPE_MAX_DT) + 1e-9, "a huge dt is clamped (a returning tab fades, never snaps)");
  for (const dt of [NaN, -1, 0, Infinity]) {
    const z = createEnvelope();
    stepEnvelope(z, true, NaN, dt, NaN, NaN, NaN);
    assert(Number.isFinite(z.out) && z.out >= 0 && z.out <= 1, `total for dt ${dt}`);
  }
});

function base(): EventInputs {
  return {
    sunElevDeg: 30, sunCloud: 0, cloudCover: 0.2, highCover: 0, highDensity: 0, rain: 0, snow: 0, fog: 0, storminess: 0,
    lightning: 0, lightningDir: [1, 0.2, 0], windMs: 3, gustMs: 5, temperatureC: 18, relativeHumidity: 0.5, frozen: 0,
    dewDeposition: 0, cloudBaseM: 1200, shimmerVar: 0, frostDeposit: 0, lullness: 0, clearingness: 0,
    moons: [{ dir: [0, -1, 0], elevationDeg: -30, brightness: 0, illumination: 0.5 }, { dir: [0, -1, 0], elevationDeg: -30, brightness: 0, illumination: 0.5 }],
  };
}

function settle(i: EventInputs, seconds = 120) {
  const ev = createWorldEvents();
  for (let t = 0; t < seconds; t += 0.1) ev.step(i, 0.1);
  return ev;
}

Deno.test("events: each fires in its situation and stays off in the neutral noon", () => {
  const noon = settle(base());
  assert(noon.frame().active.length === 0, `neutral noon has no event: ${noon.frame().active}`);
  const cases: [string, Partial<EventInputs>][] = [
    ["goldenHour", { sunElevDeg: 4 }],
    ["blueHour", { sunElevDeg: -4 }],
    ["rainbow", { sunElevDeg: 20, rain: 0.25, clearingness: 1 }],
    ["halo", { highCover: 0.7, highDensity: 0.3, cloudCover: 0.6 }],
    ["lull", { lullness: 1, windMs: 2 }],
    ["thunderstorm", { storminess: 0.9, rain: 0.8, cloudCover: 1, sunCloud: 1 }],
    ["fogBank", { fog: 0.8 }],
    ["frost", { frozen: 1, dewDeposition: 0.4, sunElevDeg: 2, temperatureC: -3 }],
    ["heatShimmer", { temperatureC: 38, sunElevDeg: 60, relativeHumidity: 0.2, windMs: 1, cloudCover: 0 }],
    ["snowfall", { snow: 0.6, temperatureC: -2 }],
    ["moonrise", { sunElevDeg: -20, moons: [{ dir: [1, 0.05, 0], elevationDeg: 3, brightness: 0.4, illumination: 0.9 }, { dir: [0, -1, 0], elevationDeg: -40, brightness: 0, illumination: 0.5 }] }],
    ["moonConjunction", { sunElevDeg: -20, moons: [{ dir: [0.6, 0.8, 0], elevationDeg: 53, brightness: 0.5, illumination: 0.7 }, { dir: [0.64, 0.77, 0], elevationDeg: 50, brightness: 0.3, illumination: 0.7 }] }],
    ["starryNight", { sunElevDeg: -25, cloudCover: 0.05 }],
    ["sunBreak", { clearingness: 1, sunElevDeg: 25, sunCloud: 0.1 }],
    ["gale", { windMs: 15, gustMs: 22 }],
  ];
  const fired = new Set<string>();
  for (const [id, patch] of cases) {
    const ev = settle({ ...base(), ...patch } as EventInputs);
    const k = ev.frame().intensity[id as typeof EVENT_IDS[number]];
    assert(k > 0.9, `${id} fires: ${k.toFixed(3)} (active ${ev.frame().active})`);
    fired.add(id);
  }
  // lightningStrike is driven by a flash, below.
  assert(fired.size === EVENTS.length - 1, `every event has a situation test (${fired.size})`);
});

Deno.test("events: rainbow needs BOTH rain and a shining sun at <= 41 deg", () => {
  const k = (p: Partial<EventInputs>) => settle({ ...base(), clearingness: 1, ...p } as EventInputs).frame().intensity.rainbow;
  assert(k({ rain: 0.25, sunElevDeg: 20 }) > 0.9, "yes");
  assert(k({ rain: 0.25, sunElevDeg: 50 }) === 0, "sun too high: the bow is below the horizon");
  assert(k({ rain: 0.25, sunElevDeg: 20, sunCloud: 0.95 }) === 0, "sun behind cloud");
  assert(k({ rain: 0.95, sunElevDeg: 20 }) === 0, "a downpour hides it");
  assert(k({ rain: 0, sunElevDeg: 20 }) === 0, "no rain");
  assert(k({ rain: 0.25, sunElevDeg: 20, clearingness: 0 }) === 0, "steady frontal rain (not showery) has none");
});

Deno.test("events: lightning strikes give a distance from geometry, thunder delay d/343, re-arm between flashes", () => {
  const ev = createWorldEvents();
  const i = base();
  i.storminess = 1; i.rain = 1;
  let strikes = 0, lastDelay = 0;
  for (let k = 0; k < 600; k++) {
    i.lightning = k % 100 < 3 ? 1 - (k % 100) * 0.3 : 0;   // a 3-frame flash every 100 frames
    i.lightningDir = [Math.cos(k), 0.05 + (k % 7) * 0.08, Math.sin(k)];
    const f = ev.step(i, 1 / 60);
    if (f.strike.fresh) {
      strikes++;
      assert(f.strike.distanceM >= STRIKE_MIN_M && f.strike.distanceM <= STRIKE_MAX_M, "distance clamped");
      assert(Math.abs(f.strike.delayS - f.strike.distanceM / SPEED_OF_SOUND) < 1e-9, "delay");
      assert(f.strike.loudness > 0 && f.strike.loudness <= 1, "loudness");
      lastDelay = f.strike.delayS;
    }
  }
  assert(strikes === 6, `one strike per flash, no double count inside a flash: ${strikes}`);
  assert(lastDelay > 0, "thunder delayed");
  const high = createWorldEvents(), low = createWorldEvents();
  const hi = { ...base(), lightning: 1, lightningDir: [0.3, 0.9, 0] as const };
  const lo = { ...base(), lightning: 1, lightningDir: [1, 0.05, 0] as const };
  assert(high.step(hi as EventInputs, 0.016).strike.distanceM < low.step(lo as EventInputs, 0.016).strike.distanceM, "a high flash is closer than one on the horizon");
});

Deno.test("events: composition is neutral when idle, bounded and normalised when many events stack", () => {
  const idle = settle(base()).frame().effects;
  assert(idle.exposure === 1 && idle.saturation === 1 && idle.fogDistance === 1, "neutral multipliers");
  assert(idle.tint.every((c) => c === 1), "white tint");
  const all = settle({ ...base(), sunElevDeg: 4, rain: 0.9, storminess: 0.95, fog: 0.9, snow: 0.8, temperatureC: -2, windMs: 18, gustMs: 25, frozen: 1, dewDeposition: 0.5, lullness: 0.5, clearingness: 0.5 } as EventInputs).frame().effects;
  for (const v of [all.exposure, all.saturation, all.fogDistance, ...all.tint]) assert(Number.isFinite(v) && v > 0 && v < 3, `bounded ${v}`);
  assert(all.fogDistance < 0.6, "fog + storm + snow close the fog in");
  const t = all.tint, mean = (t[0] + t[1] + t[2]) / 3;
  assert(mean > 0.85 && mean < 1.15, `tint keeps brightness (mean ${mean})`);
});

Deno.test("events: total under garbage inputs (NaN everywhere) and dt edge cases", () => {
  const ev = createWorldEvents();
  const bad = Object.fromEntries(Object.entries(base()).map(([k, v]) => [k, typeof v === "number" ? NaN : v])) as unknown as EventInputs;
  bad.lightningDir = [NaN, NaN, NaN];
  for (const dt of [NaN, -5, 0, 1e9, 0.016]) {
    const f = ev.step(bad, dt);
    for (const id of EVENT_IDS) assert(Number.isFinite(f.intensity[id]) && f.intensity[id] >= 0 && f.intensity[id] <= 1, `${id} total`);
    for (const v of [f.effects.exposure, f.effects.saturation, f.effects.fogDistance, ...f.effects.tint]) assert(Number.isFinite(v), "effects finite");
  }
  ev.reset();
  assert(ev.frame().active.length === 0 && ev.labels() === "", "reset clears");
});

Deno.test("events: a 60 s fade between two situations never jumps (per-frame delta bound)", () => {
  const ev = createWorldEvents();
  const i = base();
  let prev = ev.step(i, 1 / 60).effects.saturation, worst = 0;
  for (let k = 0; k < 3600 * 3; k++) {
    // sweep the sun from 20 deg to -20 deg over 3 minutes: golden -> blue -> night
    i.sunElevDeg = 20 - (40 * k) / (3600 * 3);
    const s = ev.step(i, 1 / 60).effects.saturation;
    worst = Math.max(worst, Math.abs(s - prev));
    prev = s;
  }
  assert(worst < 0.002, `largest per-frame saturation change ${worst}`);
});

Deno.test("events: the world equations' shimmer and frost deposit feed the events (one source)", () => {
  const k = (p: Partial<EventInputs>, id: "heatShimmer" | "frost") => settle({ ...base(), ...p } as EventInputs).frame().intensity[id];
  assert(k({ shimmerVar: 0.7 }, "heatShimmer") > 0.9, "equation shimmer alone fires the event");
  assert(k({ shimmerVar: 0.7, sunCloud: 0.95 }, "heatShimmer") === 0, "but not with the sun behind a cloud");
  assert(k({ frostDeposit: 0.4, sunElevDeg: 3 }, "frost") > 0.9, "equation frost deposit fires frost");
  assert(k({ frostDeposit: 0.4, sunElevDeg: 35 }, "frost") === 0, "the high sun burns it off");
});

Deno.test("events: the live climate drives the events at real game speed (60 spring days, rates plausible)", async () => {
  const { createClimate } = await import("../src/world/climate/Climate.ts");
  const { advanceDrift, cloudOcclusionAt, packCloudLayers } = await import("../src/graphics/sky/CloudField.ts");
  const { solarPosition } = await import("../src/graphics/Environment.ts");
  // The default flow (1 day = 24 real min) at Greywall (lat 48), from 1 March. The engine feeds the
  // DRAWN sun occlusion (patchy: gaps between showers), not the climate's statistical mean.
  const c = createClimate({ placeId: "greywall", latitude: 48, seed: 11, year: 2026, dayOfYear: 60, hour: 0 });
  const ev = createWorldEvents();
  const off = new Float64Array(8), packed = new Float32Array(64);
  const starts: Record<string, number> = {};
  const was = new Set<string>();
  let inp: EventInputs | undefined;
  const DT = 0.5, DAYS = 60;
  for (let t = 0; t < 1440 * DAYS; t += DT) {
    const f = c.step(DT);
    advanceDrift(f.weather.layers, off, DT);
    packCloudLayers(f.weather.layers, off, packed);
    const sd = solarPosition(f.clock.dayOfYear, f.clock.hour, 48).dir;
    const fr = ev.step(inp = inputsFromFrame(f, f.vars["sunElevationDeg"] ?? 0, sd[1] > 0 ? cloudOcclusionAt(packed, sd, 3) : 1, inp), DT);
    for (const id of fr.active) if (!was.has(id)) starts[id] = (starts[id] ?? 0) + 1;
    was.clear();
    for (const id of fr.active) was.add(id);
    for (const id of EVENT_IDS) assert(Number.isFinite(fr.intensity[id]) && fr.intensity[id] >= 0 && fr.intensity[id] <= 1, id);
  }
  console.log(`occurrences in ${DAYS} spring days: ${JSON.stringify(starts)}`);
  const n = (id: string) => starts[id] ?? 0;
  // Daily events happen about daily (cloudy days skip them); rare ones stay rare but do happen.
  assert(n("goldenHour") >= DAYS * 0.8 && n("goldenHour") <= DAYS * 2.6, `golden hour ~1-2 a day: ${n("goldenHour")}`);
  assert(n("blueHour") >= DAYS * 0.6, `blue hour: ${n("blueHour")}`);
  assert(n("rainbow") >= 1 && n("rainbow") <= DAYS * 0.25, `rainbows are rare: ${n("rainbow")}`);
  for (const id of ["thunderstorm", "lightningStrike", "lull", "halo", "sunBreak", "gale", "moonrise", "starryNight"]) assert(n(id) >= 1, `${id} happens in a spring`);
});

Deno.test("events: step is cheap (10 000 steps)", () => {
  const ev = createWorldEvents();
  const i = base();
  const t0 = performance.now();
  for (let k = 0; k < 10000; k++) { i.sunElevDeg = 10 * Math.sin(k * 0.001); ev.step(i, 1 / 60); }
  const per = (performance.now() - t0) / 10000;
  console.log(`events.step: ${(per * 1000).toFixed(1)} us`);
  assert(per < 0.05, `${per} ms per step`);
});
