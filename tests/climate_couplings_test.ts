// Lane E: the interconnections are monotone in the physical direction. Each case sweeps ONE input
// with every other input fixed (several seeded bases), and asserts the output never moves the
// wrong way (non-strict, 1e-12 slack) and moves the right way overall.
import { evaluateWorld } from "../src/world/climate/WorldVars.ts";
import {
  createWeather, fogBurnOff, layerDriftSpeedMs, rainEvaporation, sunElevationDeg,
} from "../src/world/climate/Weather.ts";
import { stullWetBulbC } from "../src/world/climate/WorldVars.ts";
import { rng32 } from "../src/core/MathCore.ts";
import type { WeatherRegime } from "../src/world/climate/contracts.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

type Inputs = Record<string, number>;
const N = 120;

/** Seeded typical daytime/nighttime base (the sweep variable overrides one field). */
function base(seed: number, o: Inputs = {}): Inputs {
  const r = rng32(seed * 104729 + 7);
  const u = (lo: number, hi: number) => lo + (hi - lo) * r();
  const wind = u(0.5, 8);
  return {
    temperatureC: u(-5, 30), relativeHumidity: u(0.35, 0.95), pressureHPa: u(995, 1025), windSpeedMs: wind, gustMs: wind * u(1.2, 1.7),
    rain: 0, snow: 0, fog: 0, cloudLow: u(0, 0.5), cloudMid: u(0, 0.4), cloudHigh: u(0, 0.4), cloudTowering: u(0, 0.3),
    storminess: u(0, 0.6), lightning: 0, aerosolBase: u(0.1, 0.6), snowCover: 0, hour: u(0, 24), dayOfYear: u(1, 365),
    latitude: u(-60, 60), sunElevationDeg: u(15, 60), moonIlunBrightness: u(0, 0.5), moonVeshBrightness: 0,
    moonIlunIllumination: u(0, 1), moonVeshIllumination: u(0, 1), groundAlbedo: u(0.12, 0.35), ...o,
  };
}

/** Sweep `input` over [lo, hi]; `out` must be monotone in `dir` (+1 rising, -1 falling) and change by > minChange. */
function mono(input: string, lo: number, hi: number, out: string, dir: 1 | -1, o: Inputs = {}, minChange = 1e-6) {
  for (let seed = 1; seed <= 6; seed++) {
    const b = base(seed, o);
    let prev = NaN, first = NaN, last = NaN;
    for (let i = 0; i <= N; i++) {
      const x = lo + ((hi - lo) * i) / N;
      const y = evaluateWorld({ ...b, [input]: x })[out];
      if (i === 0) first = y;
      if (i > 0) assert(dir * (y - prev) >= -1e-12, `${out} must ${dir > 0 ? "rise" : "fall"} with ${input} (seed ${seed}: ${prev} -> ${y} at ${input}=${x.toFixed(3)})`);
      prev = y; last = y;
    }
    assert(dir * (last - first) > minChange, `${out} changes with ${input} (seed ${seed}: ${first} -> ${last})`);
  }
}

Deno.test("couplings: more rain -> less sun, wetter ground, worse visibility, more streaks", () => {
  mono("rain", 0, 1, "render.sunMul", -1);
  // the clear-air beam is unchanged by rain itself (washout is a time process in Weather)
  assert(evaluateWorld(base(1, { rain: 1 })).sunTransmittance === evaluateWorld(base(1)).sunTransmittance, "no instant washout");
  mono("rain", 0, 1, "render.wetness", 1);
  mono("rain", 0, 1, "visibilityKm", -1);
  mono("rain", 0, 1, "render.rainStreaks", 1);
});

Deno.test("couplings (weather): rain washes the aerosol out over time; the haze returns over the next day", () => {
  const w = createWeather({ placeId: "sunspire", latitude: 12, seed: 3, dayOfYear: 200, hour: 14 });
  const season = w.normals.aerosol;
  w.pin("storm");
  for (let i = 0; i < 60; i++) w.step(0.05, 3, 200, 14); // 3 game hours of storm
  const washed = w.aerosol;
  w.pin("clear");
  for (let i = 0; i < 6 * 20; i++) w.step(0.05, 3, 200, 14); // 6 h
  const after6 = w.aerosol;
  for (let i = 0; i < 40 * 20; i++) w.step(0.05, 3, 200, 14); // +40 h
  const after46 = w.aerosol;
  console.log(`  sunspire d200 aerosol: season ${season.toFixed(3)}, after 3 h storm ${washed.toFixed(3)}, +6 h clear ${after6.toFixed(3)}, +46 h ${after46.toFixed(3)}`);
  assert(washed < 0.25 * season, "the storm scavenges most of the aerosol");
  assert(after6 > washed && after6 < season && after46 > 0.9 * season, "it recovers over the next day");
  const clean = evaluateWorld(base(1, { aerosolBase: washed })), hazy = evaluateWorld(base(1, { aerosolBase: season }));
  assert(clean["render.turbidity"] < hazy["render.turbidity"] && clean.visibilityKm > hazy.visibilityKm, "washed air: bluer, clearer sky");
});

Deno.test("couplings: more wind -> less fog (dispersal), more sway, faster drying, better visibility in fog", () => {
  mono("windSpeedMs", 0, 20, "fogEff", -1, { fog: 0.8 });
  mono("windSpeedMs", 0, 20, "visibilityKm", 1, { fog: 0.8, aerosolBase: 0.1 });
  mono("windSpeedMs", 0, 20, "render.windSway", 1, {}, 1e-4);
  mono("windSpeedMs", 0, 20, "dryingRate", 1);
  mono("windSpeedMs", 0, 20, "windEffectiveMs", 1);
  mono("gustMs", 0, 30, "windEffectiveMs", 1, { storminess: 0 });
});

Deno.test("couplings: colder -> more frozen; clear calm nights cool the surface below the air (frost at T_air ~ 2 C)", () => {
  mono("temperatureC", 6, -6, "frozen", 1);
  const night = { sunElevationDeg: -25, cloudLow: 0, cloudMid: 0, cloudHigh: 0, cloudTowering: 0, windSpeedMs: 0.3, gustMs: 0.5, temperatureC: 2, relativeHumidity: 0.9, hour: 5 };
  const o = evaluateWorld(base(1, night));
  assert(o.surfaceTempC < o.temperatureC - 3, `clear calm night: surface ${o.surfaceTempC} well below air ${o.temperatureC}`);
  assert(o.frozen > 0.95 && o.frostDeposit > 0.3, `hoar frost on a clear calm night at +2 C air (frozen ${o.frozen}, frost ${o.frostDeposit})`);
  mono("cloudLow", 0, 1, "surfaceTempC", 1, night);
  mono("windSpeedMs", 0, 8, "surfaceTempC", 1, { ...night, gustMs: 8 });
  mono("cloudLow", 0, 1, "dewDeposition", -1, night);
  // noon: the sun burns the deposition off
  assert(evaluateWorld(base(1, { ...night, sunElevationDeg: 30, hour: 12 })).dewDeposition === 0, "no dew at noon");
});

Deno.test("couplings: snow cover -> higher albedo -> more GI, brighter scene and dome (the eye adapts: exposure down)", () => {
  for (const sun of [10, 45]) {
    mono("snowCover", 0, 1, "albedoEff", 1, { sunElevationDeg: sun });
    mono("snowCover", 0, 1, "render.giStrength", 1, { sunElevationDeg: sun });
    mono("snowCover", 0, 1, "sceneLuminance", 1, { sunElevationDeg: sun });
    mono("snowCover", 0, 1, "render.ambientMul", 1, { sunElevationDeg: sun });
    mono("snowCover", 0, 1, "render.exposure", -1, { sunElevationDeg: sun });
  }
});

Deno.test("couplings: storm proximity -> stronger gusts and felt wind, darker dome", () => {
  mono("storminess", 0, 1, "gustEffMs", 1, { cloudTowering: 0.8 });
  mono("storminess", 0, 1, "windEffectiveMs", 1, { cloudTowering: 0.8 });
  mono("storminess", 0, 1, "render.ambientMul", -1);
});

Deno.test("couplings: heat haze needs hot x dry x sunny x calm, and feeds the haze", () => {
  const hot = { temperatureC: 38, relativeHumidity: 0.15, windSpeedMs: 1, gustMs: 1.5, sunElevationDeg: 60, cloudLow: 0, cloudMid: 0, cloudHigh: 0, cloudTowering: 0, aerosolBase: 0.2 };
  const o = evaluateWorld(base(2, hot));
  assert(o.heatShimmer > 0.4, `hot dry calm noon shimmers (${o.heatShimmer})`);
  mono("temperatureC", 20, 45, "heatShimmer", 1, hot);
  mono("relativeHumidity", 0.1, 0.9, "heatShimmer", -1, hot);
  mono("windSpeedMs", 0, 10, "heatShimmer", -1, { ...hot, gustMs: 10 });
  mono("cloudLow", 0, 1, "heatShimmer", -1, hot);
  mono("temperatureC", 20, 45, "render.haze", 1, { ...hot, relativeHumidity: 0.15 }, 1e-4);
  assert(evaluateWorld(base(2, { ...hot, sunElevationDeg: -10 })).heatShimmer === 0, "no shimmer at night");
});

Deno.test("couplings: felt temperature is continuous at the wind-chill / humidex switches and monotone in wind when cold", () => {
  mono("windSpeedMs", 0, 30, "apparentTempC", -1, { temperatureC: -5 });
  for (const edge of [5, 10, 20, 25]) {
    const a = evaluateWorld(base(3, { temperatureC: edge - 1e-6 })).apparentTempC, b = evaluateWorld(base(3, { temperatureC: edge + 1e-6 })).apparentTempC;
    assert(Math.abs(a - b) < 1e-4, `apparent temperature continuous at ${edge} C (${a} vs ${b})`);
  }
});

Deno.test("couplings (weather): rain evaporation cools AND moistens the air along the wet bulb; phase follows the wet bulb", () => {
  const cases: [number, number][] = [[30, 0.3], [20, 0.6], [8, 0.8], [2, 0.5], [-5, 0.7], [45, 0.1]];
  for (const [T, RH] of cases) {
    let pT = T, pRH = RH;
    const tw0 = stullWetBulbC(T, RH);
    for (let i = 0; i <= 20; i++) {
      const a = rainEvaporation(T, RH, i / 20);
      assert(a.temperatureC <= pT + 1e-12 && a.relativeHumidity >= pRH - 1e-12, `monotone at T ${T} RH ${RH} intensity ${i / 20}`);
      assert(a.temperatureC >= tw0 - 1e-9, "never cools below the wet bulb");
      pT = a.temperatureC; pRH = a.relativeHumidity;
    }
    const full = rainEvaporation(T, RH, 1);
    assert(Math.abs(stullWetBulbC(full.temperatureC, full.relativeHumidity) - tw0) < 0.6, `wet bulb ~conserved (${tw0} -> ${stullWetBulbC(full.temperatureC, full.relativeHumidity)})`);
    if (RH < 0.95) assert(full.temperatureC < T - 0.1 && full.relativeHumidity > RH + 0.01, `rain cools ${T}->${full.temperatureC} and moistens ${RH}->${full.relativeHumidity}`);
    const none = rainEvaporation(T, RH, 0);
    assert(none.temperatureC === T && Math.abs(none.relativeHumidity - RH) < 1e-12, "no rain, no change");
  }
  // dry air: the wet bulb is below 0.5 C at +3 C air, so snow can reach the ground
  assert(stullWetBulbC(3, 0.4) < 0 && stullWetBulbC(3, 0.95) > 2, "wet bulb sits between dew point and T");
});

Deno.test("couplings (weather): wind speeds the clouds up; the sun (not the clock) burns fog off, polar-aware", () => {
  for (const alt of [500, 3500, 8000]) {
    let prev = -1;
    for (let w = 0; w <= 30; w += 0.5) { const s = layerDriftSpeedMs(w, alt); assert(s >= prev, "drift rises with wind"); prev = s; }
  }
  assert(layerDriftSpeedMs(5, 8000) > layerDriftSpeedMs(5, 3500) && layerDriftSpeedMs(5, 3500) > layerDriftSpeedMs(5, 500), "shear: higher is faster");
  let prev = -1;
  for (let e = -20; e <= 60; e += 0.5) { const b = fogBurnOff(e, 0.2); assert(b >= prev, "burn-off rises with the sun"); prev = b; }
  assert(fogBurnOff(40, 1) < fogBurnOff(40, 0), "cloud shades the burn-off");
  // frostford (63 N): December noon sun ~3.5 deg -> fog is NOT burnt off; June 02:00 (white night) neither
  const decNoon = sunElevationDeg(355, 12, 63), junNight = sunElevationDeg(172, 2, 63), junNoon = sunElevationDeg(172, 12, 63);
  assert(decNoon > 2 && decNoon < 5 && fogBurnOff(decNoon, 0) < 0.02, `polar-night noon keeps its fog (elev ${decNoon})`);
  assert(junNight < 0 && fogBurnOff(junNight, 0) === 0 && fogBurnOff(junNoon, 0) > 0.99, `white night ${junNight} / midsummer noon ${junNoon}`);
  console.log(`  frostford sun: Dec noon ${decNoon.toFixed(2)} deg (burn ${fogBurnOff(decNoon, 0).toFixed(3)}), Jun 02:00 ${junNight.toFixed(2)} deg, Jun noon ${junNoon.toFixed(1)} deg`);
});

Deno.test("couplings (weather): the storm cycle drops the pressure and raises the gusts (pinned regimes, same moment)", () => {
  const at = (r: WeatherRegime) => {
    const w = createWeather({ placeId: "greywall", latitude: 48, seed: 12, dayOfYear: 200, hour: 15 });
    w.pin(r);
    return w.state;
  };
  const clear = at("clear"), fair = at("fair"), building = at("building"), lull = at("lull"), storm = at("storm");
  assert(clear.pressureHPa > fair.pressureHPa && fair.pressureHPa > building.pressureHPa && building.pressureHPa > lull.pressureHPa && lull.pressureHPa > storm.pressureHPa,
    `pressure falls along the cycle: ${[clear, fair, building, lull, storm].map((s) => s.pressureHPa.toFixed(1)).join(" > ")}`);
  assert(storm.gustMs > fair.gustMs + 3 && storm.windSpeedMs > fair.windSpeedMs, "storm gusts");
  assert(storm.temperatureC < fair.temperatureC - 2, `the storm is cooler (rain evaporation + outflow): ${storm.temperatureC} vs ${fair.temperatureC}`);
  assert(storm.relativeHumidity > fair.relativeHumidity, "and more humid");
  console.log(`  greywall d200 15:00 pinned: P clear ${clear.pressureHPa.toFixed(1)} fair ${fair.pressureHPa.toFixed(1)} building ${building.pressureHPa.toFixed(1)} lull ${lull.pressureHPa.toFixed(1)} storm ${storm.pressureHPa.toFixed(1)} hPa; gust fair ${fair.gustMs.toFixed(1)} storm ${storm.gustMs.toFixed(1)} m/s; T fair ${fair.temperatureC.toFixed(1)} storm ${storm.temperatureC.toFixed(1)}`);
});
