// Lane E: the named edge cases — each one a test. Every frame/state must stay finite and inside
// its declared range; the clock/calendar must wrap the way a player would expect.
import { createClimate } from "../src/world/climate/Climate.ts";
import { type ClimateFrame, WEATHER_REGIMES } from "../src/world/climate/contracts.ts";
import { evaluateWorld, WORLD_VARS } from "../src/world/climate/WorldVars.ts";
import { createWeather } from "../src/world/climate/Weather.ts";
import { absoluteDays, createMoonStates, MOON_ILLUSION, MOONS, updateMoon } from "../src/world/climate/Moons.ts";
import { createWarpedClock } from "../src/world/climate/TimeWarp.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

/** Every var finite and in range; clock, weather and moons finite. */
function checkFrame(f: ClimateFrame, what: string): void {
  for (const d of WORLD_VARS) {
    const x = f.vars[d.id];
    assert(Number.isFinite(x) && x >= d.min - 1e-9 && x <= d.max + 1e-9, `${what}: ${d.id}=${x} outside [${d.min}, ${d.max}]`);
  }
  const c = f.clock;
  assert([c.year, c.dayOfYear, c.hour, c.hoursPerSecond, c.dwell].every(Number.isFinite), `${what}: clock finite ${JSON.stringify(c)}`);
  assert(c.dayOfYear >= 1 && c.dayOfYear <= 365 && c.hour >= 0 && c.hour < 24, `${what}: clock in range (day ${c.dayOfYear}, hour ${c.hour})`);
  const w = f.weather;
  for (const k of ["storminess", "temperatureC", "dewPointC", "relativeHumidity", "pressureHPa", "windSpeedMs", "windDirRad", "gustMs", "rain", "snow", "fog", "lightning", "visibilityKm", "cloudCover", "transition"] as const) {
    assert(Number.isFinite(w[k]), `${what}: weather.${k}=${w[k]}`);
  }
  for (const L of w.layers) assert([L.altitudeM, L.coverage, L.density, L.typeMix, L.driftX, L.driftZ, L.darkness].every(Number.isFinite), `${what}: layer ${L.id}`);
  assert(Object.values(w.sea).every(Number.isFinite), `${what}: sea`);
  for (const m of f.moons) {
    assert([...m.dir, m.elevation, m.phase, m.illumination, m.angularRadius, ...m.skyColor, m.brightness].every(Number.isFinite), `${what}: moon ${m.id}`);
  }
}

const mk = (o: Partial<{ placeId: string; latitude: number; seed: number; year: number; dayOfYear: number; hour: number; dayLengthSeconds: number }> = {}) =>
  createClimate({ placeId: "greywall", latitude: 48, seed: 1, year: 1, dayOfYear: 100, hour: 6, dayLengthSeconds: 240, ...o });

function run(c: ReturnType<typeof mk>, steps: number, dt: number, what: string): void {
  for (let i = 0; i < steps; i++) checkFrame(c.step(dt), `${what} step ${i}`);
}

Deno.test("edge: latitude +90 / -90 / 0 (poles and equator)", () => {
  for (const lat of [90, -90, 0]) {
    for (const doy of [172, 355]) run(mk({ placeId: "nowhere", latitude: lat, dayOfYear: doy, hour: 0 }), 240 * 4, 0.25, `lat ${lat} d${doy}`);
  }
  const jun = evaluateWorld({ latitude: 90, dayOfYear: 172 }), dec = evaluateWorld({ latitude: 90, dayOfYear: 355 });
  assert(jun.dayLengthHours === 24 && dec.dayLengthHours === 0, `north pole: 24 h in June, 0 h in December (${jun.dayLengthHours}, ${dec.dayLengthHours})`);
  const s = evaluateWorld({ latitude: -90, dayOfYear: 172 });
  assert(s.dayLengthHours === 0 && s.summerness < 0.01, "south pole: polar night and midwinter in June");
  const eq = evaluateWorld({ latitude: 0, dayOfYear: 172 });
  assert(eq.summerness === 0.5 && Math.abs(eq.dayLengthHours - 12) < 0.01, "equator: no thermal season, 12 h day");
});

Deno.test("edge: dayOfYear 0 / 1 / 365 / 366 / fractional", () => {
  const w0 = evaluateWorld({ dayOfYear: 0 }), w365 = evaluateWorld({ dayOfYear: 365 });
  assert(Math.abs(w0.declinationDeg - w365.declinationDeg) < 1e-9, "day 0 wraps onto day 365 (periodic input)");
  assert(Math.abs(evaluateWorld({ dayOfYear: 366 }).declinationDeg - evaluateWorld({ dayOfYear: 1 }).declinationDeg) < 1e-9, "366 wraps onto 1");
  const a = evaluateWorld({ dayOfYear: 365.49 }).declinationDeg, b = evaluateWorld({ dayOfYear: 0.51 }).declinationDeg;
  assert(Math.abs(a - b) < 0.01, `the year closes continuously (${a} vs ${b})`);
  const cases: [number, number, number][] = [[0, 365, 0], [1, 1, 1], [365, 365, 1], [366, 1, 2], [100.5, 100, 1], [-364, 1, 0]];
  for (const [doy, day, year] of cases) {
    const c = mk({ dayOfYear: doy });
    checkFrame(c.frame(), `doy ${doy}`);
    assert(c.frame().clock.dayOfYear === day && c.frame().clock.year === year, `doy ${doy} -> day ${day} of year ${year} (got ${c.frame().clock.dayOfYear}/${c.frame().clock.year})`);
    run(c, 300, 1 / 10, `doy ${doy}`);
  }
});

Deno.test("edge: hour 0 / 24 / negative / > 24 / non-finite", () => {
  const cases: [number, number, number][] = [[0, 100, 0], [24, 101, 0], [-1, 99, 23], [25, 101, 1], [47.5, 101, 23.5], [-24.25, 98, 23.75]];
  for (const [h, day, hour] of cases) {
    const c = mk();
    c.setClock(100, h);
    const k = c.frame().clock;
    assert(k.dayOfYear === day && Math.abs(k.hour - hour) < 1e-9, `setClock(100, ${h}) -> day ${day} hour ${hour} (got ${k.dayOfYear} ${k.hour})`);
    checkFrame(c.frame(), `hour ${h}`);
    const d = mk({ hour: h });
    assert(d.frame().clock.dayOfYear === day && Math.abs(d.frame().clock.hour - hour) < 1e-9, `createClimate hour ${h}`);
  }
  const c = mk({ hour: 7 });
  c.setClock(100, NaN);
  assert(c.frame().clock.hour === 7 && c.frame().clock.dayOfYear === 100, "NaN hour keeps the clock");
  c.setClock(NaN, Infinity, NaN);
  checkFrame(c.frame(), "setClock(NaN, Infinity, NaN)");
  assert(Math.abs(evaluateWorld({ hour: 24 }).dewDeposition - evaluateWorld({ hour: 0 }).dewDeposition) < 1e-12, "world: hour 24 == hour 0");
  assert(evaluateWorld({ hour: -1 }).hour === 23 && evaluateWorld({ hour: 49 }).hour === 1, "world: the hour wraps");
});

Deno.test("edge: dt 0 / negative / NaN / Infinity / huge (1e6 s): finite, bounded cost, no backlog", () => {
  const c = mk();
  const h0 = c.frame().clock.hour;
  for (const dt of [0, -1, -1e9, NaN, Infinity, -Infinity]) {
    checkFrame(c.step(dt), `dt ${dt}`);
    assert(c.frame().clock.hour === h0, `dt ${dt} does not move the clock`);
  }
  const big = mk({ dayLengthSeconds: 1440 });
  const t0 = performance.now();
  const f = big.step(1e6);
  const t1 = performance.now();
  checkFrame(f, "dt 1e6");
  let worst = 0;
  for (let i = 0; i < 20; i++) { const a = performance.now(); big.step(1 / 60); worst = Math.max(worst, performance.now() - a); }
  console.log(`  step(1e6 s): ${(t1 - t0).toFixed(2)} ms (clock jumped to day ${f.clock.dayOfYear} y${f.clock.year}); next 20 steps worst ${worst.toFixed(3)} ms`);
  assert(f.clock.year === 3 && f.clock.dayOfYear === 64, `1e6 s / 1440 s = 694.4 days after y1 d100 -> y3 d64 (got day ${f.clock.dayOfYear} y${f.clock.year})`);
  assert(t1 - t0 < 50, `a huge step is bounded (${t1 - t0} ms)`);
  assert(worst < 2, `no anomaly backlog on the following steps (${worst} ms)`);
  // the weather alone, directly
  const w = createWeather({ placeId: "greywall", latitude: 48, seed: 1, dayOfYear: 100, hour: 6 });
  for (const dt of [NaN, -5, Infinity, 1e12]) {
    w.step(dt, dt, NaN, NaN);
    for (const k of ["temperatureC", "relativeHumidity", "pressureHPa", "windSpeedMs", "cloudCover", "lightning", "fog"] as const) assert(Number.isFinite(w.state[k]), `weather.step(${dt}): ${k}=${w.state[k]}`);
  }
});

Deno.test("edge: dayLengthSeconds 0 (frozen), tiny (1e-3), NaN / negative (frozen)", () => {
  const frozen = mk({ dayLengthSeconds: 0 });
  const h = frozen.frame().clock.hour;
  run(frozen, 100, 1, "dayLength 0");
  assert(frozen.frame().clock.hour === h && frozen.frame().clock.hoursPerSecond === 0, "frozen clock");
  const tiny = mk({ dayLengthSeconds: 1e-3 });
  const t0 = performance.now();
  run(tiny, 200, 1 / 60, "dayLength 1e-3"); // ~16.7 game days per frame
  const ms = (performance.now() - t0) / 200;
  console.log(`  dayLength 1e-3 s: ${(ms * 1000).toFixed(1)} us/step (16.7 game days per frame), day ${tiny.frame().clock.dayOfYear} y${tiny.frame().clock.year}`);
  assert(tiny.frame().clock.year > 1, "years roll by");
  const odd = mk({ dayLengthSeconds: NaN });
  const h2 = odd.frame().clock.hour;
  odd.step(10);
  assert(odd.frame().clock.hour === h2, "NaN day length freezes");
  odd.setDayLength(-5); odd.step(10);
  assert(odd.frame().clock.hour === h2, "negative day length freezes");
  odd.setDayLength(1e-9); odd.step(1 / 60);
  checkFrame(odd.frame(), "dayLength 1e-9 -> raised to the minimum");
  const clock = createWarpedClock({ year: 1, dayOfYear: 1, hour: 0, latitude: 48, dayLengthSeconds: 1e-3 });
  const dh = clock.advance(1e6);
  assert(Number.isFinite(dh) && dh > 1e10, `1e9 days in one advance, no per-day loop (dh ${dh})`);
});

Deno.test("edge: temperature -60 / +55, humidity 0 / 1, wind 0 / 60 (all combinations)", () => {
  for (const T of [-60, 55]) for (const RH of [0, 1]) for (const wind of [0, 60]) {
    const o = evaluateWorld({ temperatureC: T, relativeHumidity: RH, windSpeedMs: wind, gustMs: wind * 1.3, sunElevationDeg: 40 });
    for (const d of WORLD_VARS) assert(Number.isFinite(o[d.id]) && o[d.id] >= d.min - 1e-9 && o[d.id] <= d.max + 1e-9, `T ${T} RH ${RH} wind ${wind}: ${d.id}=${o[d.id]}`);
    assert(o.dewPointC <= T + 1e-9 && o.wetBulbC <= T + 1e-9 && o.wetBulbC >= o.dewPointC - 1e-9, `T ${T} RH ${RH}: Td <= Tw <= T`);
    assert(o.temperatureC === T, "the extremes are inside the declared range (not clamped away)");
    if (T === -60) assert(o.frozen === 1 && o.apparentTempC <= T + 1e-9, "-60: frozen, feels at least as cold");
    // humidex = T + 5/9 (e - 10 hPa): above T in humid heat, slightly below it in bone-dry heat (by definition)
    if (T === 55) assert(o.frozen === 0 && (RH === 1 ? o.apparentTempC > T + 20 : Math.abs(o.apparentTempC - T) < 6), `+55: thawed; humidex ${o.apparentTempC}`);
    if (wind === 60) assert(o.beaufort === 12 && o.beaufortF === 12 && o["render.windSway"] === 1, "hurricane: Beaufort 12, full sway");
  }
});

Deno.test("edge: every regime pinned (climate), then released", () => {
  const c = mk({ placeId: "sunspire", latitude: 12, dayOfYear: 200, hour: 15 });
  for (const r of WEATHER_REGIMES) {
    c.pinRegime(r);
    run(c, 200, 1 / 10, `pinned ${r}`);
    assert(c.frame().weather.regime === r && c.frame().weather.transition === 0, `${r} holds`);
  }
  c.pinRegime(null);
  run(c, 2000, 1 / 10, "released");
});

Deno.test("edge: moons exactly on the horizon and in conjunction with the sun", () => {
  const states = createMoonStates();
  for (let k = 0; k < 2; k++) {
    const def = MOONS[k], st = states[k];
    // a horizon crossing: bisect the hour where the elevation changes sign (day 100, 48 N)
    const el = (h: number) => updateMoon(def, st, 1, 100, h, 48).elevation;
    let a = 0, b = 0;
    for (let h = 0; h < 24; h += 0.25) if (Math.sign(el(h)) !== Math.sign(el(h + 0.25))) { a = h; b = h + 0.25; break; }
    assert(b > a, `${def.id} crosses the horizon on day 100`);
    for (let i = 0; i < 60; i++) { const m = 0.5 * (a + b); if (Math.sign(el(m)) === Math.sign(el(a))) a = m; else b = m; }
    const m0 = updateMoon(def, st, 1, 100, a, 48);
    assert(Math.abs(m0.elevation) < 1e-9, `${def.id} exactly on the horizon (${m0.elevation})`);
    assert([...m0.dir, m0.brightness, ...m0.skyColor, m0.angularRadius].every(Number.isFinite), `${def.id} at the horizon: finite`);
    assert(Math.abs(m0.angularRadius - def.angularRadius * (1 + MOON_ILLUSION)) < 1e-12, "full moon illusion at the horizon");
    const bLo = updateMoon(def, st, 1, 100, a - 1e-6, 48).brightness, bHi = updateMoon(def, st, 1, 100, a + 1e-6, 48).brightness;
    assert(Math.abs(bLo - bHi) < 1e-5, `${def.id} brightness continuous through the horizon (${bLo} vs ${bHi})`);
    // conjunction (new moon): phase 0 at absolute day (n - phase0) * synodic
    const days = (Math.ceil(def.phase0 + absoluteDays(1, 1, 0) / def.synodicDays) - def.phase0) * def.synodicDays;
    const year = Math.floor(days / 365), rem = days - year * 365, doy = Math.floor(rem) + 1, hour = (rem - Math.floor(rem)) * 24;
    const nm = updateMoon(def, st, year, doy, hour, 48);
    assert(Math.min(nm.phase, 1 - nm.phase) < 1e-9 && nm.illumination < 1e-12 && nm.brightness < 1e-12, `${def.id} new: dark (phase ${nm.phase})`);
    assert([...nm.dir, ...nm.skyColor].every(Number.isFinite), `${def.id} new: finite`);
  }
  // both moons' light at the horizon into the world: finite moonLight
  const o = evaluateWorld({ moonIlunBrightness: 0, moonVeshBrightness: 0, moonIlunIllumination: 0, moonVeshIllumination: 0 });
  assert(o.moonLight === 0 && o.tideRangeM > 2.5, "both new: no moonlight, spring tide");
});

Deno.test("edge: non-finite options everywhere -> a finite climate", () => {
  const c = createClimate({ placeId: "??", latitude: NaN, seed: NaN, year: NaN, dayOfYear: NaN, hour: NaN, dayLengthSeconds: NaN });
  checkFrame(c.frame(), "NaN options");
  c.setDayLength(240);
  run(c, 500, 1 / 10, "NaN options, running");
  c.setPlace("frostford", Infinity);
  checkFrame(c.frame(), "setPlace(Infinity)");
  assert(c.frame().vars.latitude === 0, "an infinite latitude is ignored (kept)");
  c.setPlace("frostford", 200);
  assert(c.frame().vars.latitude === 90, "latitude clamped to 90");
  run(c, 300, 1 / 10, "pole after clamp");
});

Deno.test("edge: climate.step() cost stays under 0.05 ms (10 000 steps)", () => {
  const c = createClimate({ placeId: "greywall", latitude: 48, seed: 8, year: 1, dayOfYear: 100, hour: 6 });
  for (let i = 0; i < 2000; i++) c.step(1 / 60);
  const t0 = performance.now();
  for (let i = 0; i < 10000; i++) c.step(1 / 60);
  const ms = (performance.now() - t0) / 10000;
  console.log(`  climate.step(): ${(ms * 1000).toFixed(1)} us/step over 10 000 steps (budget 50 us)`);
  assert(ms < 0.05, `step under 0.05 ms (got ${ms} ms)`);
});
