// Lane C: the weather simulation — determinism, the storm cycle, iconic dwell, sea-state ordering,
// cloud layers per regime, lightning, snow.
import { CLOUD_LAYERS, LAYER_TYPES, WEATHER_REGIMES, type WeatherRegime } from "../src/world/climate/contracts.ts";
import {
  createWeather, HANDOVER_H, ICONIC_DWELL_MUL, LIGHTNING_DECAY_S, meanDwellHours, REALITY_DWELL_H, REGIME_PROFILES, seaStateAt,
  transitionWeights,
} from "../src/world/climate/Weather.ts";
import { normalsAt, PLACE_CLIMATES } from "../src/world/climate/RealClimate.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

/** Run a weather sim for `days` game days at a fixed game step, calling `each` per step. */
function run(place: string, lat: number, seed: number, doy: number, days: number, dtH: number, each?: (r: WeatherRegime, t: number) => void) {
  const w = createWeather({ placeId: place, latitude: lat, seed, dayOfYear: doy, hour: 6 });
  let hour = 6, day = doy, t = 0;
  for (let i = 0; i < Math.round((days * 24) / dtH); i++) {
    hour += dtH;
    if (hour >= 24) { hour -= 24; day = day % 365 + 1; }
    w.step(dtH, dtH * 60, doy, hour); // keep the month fixed: we test one place/month climatology
    t += dtH;
    each?.(w.state.regime, t);
  }
  return w;
}

Deno.test("weather: deterministic per seed, different across seeds", () => {
  const snap = (seed: number) => {
    const w = run("greywall", 48, seed, 200, 6, 0.1);
    return JSON.stringify({ s: w.state, c: w.cyclePos });
  };
  assert(snap(11) === snap(11), "same seed, same weather");
  assert(snap(11) !== snap(12), "different seed, different weather");
});

Deno.test("weather: the regime sequence and synoptic anomalies do not depend on the frame step", () => {
  const seqOf = (dtH: number) => {
    const seq: WeatherRegime[] = [];
    const w = run("greywall", 48, 21, 200, 12, dtH, (r) => { if (seq[seq.length - 1] !== r) seq.push(r); });
    return { seq: seq.join(" "), p: w.state.pressureHPa };
  };
  const a = seqOf(0.05), b = seqOf(0.2);
  assert(a.seq === b.seq, `same regimes at dt 0.05 h and 0.2 h:\n${a.seq}\n${b.seq}`);
  assert(Math.abs(a.p - b.p) < 0.5, `same synoptic pressure (${a.p} vs ${b.p})`);
});

Deno.test("weather: a thundery place/month cycles building -> lull -> storm -> clearing within 10 game days", () => {
  const seq: WeatherRegime[] = [];
  run("sunspire", 12, 3, 200, 10, 0.05, (r) => { if (seq[seq.length - 1] !== r) seq.push(r); });
  const s = seq.join(" ");
  assert(s.includes("building lull storm clearing"), `full storm cycle seen: ${s.slice(0, 300)}`);
  // the cycle's order is enforced: lull only after building, storm only after lull, clearing after storm
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] === "lull") assert(seq[i - 1] === "building", "lull follows building");
    if (seq[i] === "storm") assert(seq[i - 1] === "lull", "storm follows lull");
    if (seq[i - 1] === "storm") assert(seq[i] === "clearing", "storm gives way to clearing");
  }
  console.log(`  sunspire d200 regimes: ${s.slice(0, 160)}...`);
});

Deno.test("weather: transition weights follow the normals (thunder -> building, cloud -> overcast)", () => {
  const wet = normalsAt(PLACE_CLIMATES.sunspire, 200), dry = normalsAt(PLACE_CLIMATES.sunspire, 15);
  assert(transitionWeights("fair", wet).building > transitionWeights("fair", dry).building, "monsoon builds storms");
  assert(transitionWeights("fair", dry).building === 0, "no storms in the harmattan");
  const grey = normalsAt(PLACE_CLIMATES.greywall, 15), sunny = normalsAt(PLACE_CLIMATES.verdant, 200);
  assert(transitionWeights("fair", grey).overcast > transitionWeights("fair", sunny).overcast, "cloudy climates go overcast");
  assert(transitionWeights("lull", wet).storm > 0 && transitionWeights("storm", wet).clearing > 0, "cycle edges");
});

Deno.test("weather: iconic dwell — clear/storm/lull last longer per visit than building/clearing", () => {
  for (const r of ["clear", "storm", "lull"] as const) assert(ICONIC_DWELL_MUL[r] >= 1.5, `${r} stretched >= 1.5x reality`);
  for (const r of ["building", "clearing"] as const) assert(ICONIC_DWELL_MUL[r] < 1, `${r} hurried`);
  assert(HANDOVER_H <= 0.5, "the handover is brief");
  const time: Record<string, number> = {}, visits: Record<string, number> = {};
  let prev: WeatherRegime | null = null;
  const dtH = 0.02;
  run("sunspire", 12, 5, 200, 120, dtH, (r) => {
    time[r] = (time[r] ?? 0) + dtH;
    if (r !== prev) { visits[r] = (visits[r] ?? 0) + 1; prev = r; }
  });
  const mean = (r: WeatherRegime) => (time[r] ?? 0) / Math.max(1, visits[r] ?? 0);
  const line = WEATHER_REGIMES.map((r) => `${r} ${mean(r).toFixed(2)}h x${visits[r] ?? 0} (target ${meanDwellHours(r).toFixed(2)}+${HANDOVER_H})`).join(", ");
  console.log(`  mean game hours per visit: ${line}`);
  for (const iconic of ["clear", "storm", "lull"] as const) {
    for (const quick of ["building", "clearing"] as const) {
      assert((visits[iconic] ?? 0) >= 3 && (visits[quick] ?? 0) >= 3, `enough visits of ${iconic}/${quick}`);
      assert(mean(iconic) > mean(quick), `${iconic} (${mean(iconic)}) dwells longer than ${quick} (${mean(quick)})`);
    }
  }
  for (const r of WEATHER_REGIMES) assert(REALITY_DWELL_H[r] > 0, r);
});

Deno.test("weather: sea state follows the storm cycle (sinusoidal -> looping -> lull dip -> straight storm)", () => {
  const at = (r: WeatherRegime) => seaStateAt(REGIME_PROFILES[r].cyclePos, 0, 0.5);
  const calm = at("clear"), fair = at("fair"), build = at("building"), lull = at("lull"), storm = at("storm"), clearing = at("clearing");
  const all = [calm, fair, build, lull, storm, clearing];
  for (const s of all) for (const k of ["agitation", "sinusoidality", "looping", "straightness"] as const) assert(s[k] >= 0 && s[k] <= 1, k);
  assert(calm.sinusoidality === Math.max(...all.map((s) => s.sinusoidality)), "sinusoidality highest in calm");
  assert(calm.sinusoidality > build.sinusoidality && build.sinusoidality > storm.sinusoidality - 1e-9, "sine swell fades as the storm builds");
  const loopMax = Math.max(...all.map((s) => s.looping));
  assert(build.looping === loopMax || lull.looping === loopMax, "looping peaks around building/lull");
  assert(lull.looping > 0.8 && calm.looping < 0.05, "looping stays through the lull, absent in calm");
  assert(lull.agitation < build.agitation && lull.agitation < storm.agitation, "the quiet before the storm: agitation dips at the lull");
  assert(storm.agitation === Math.max(...all.map((s) => s.agitation)), "agitation max in the storm");
  assert(storm.straightness === Math.max(...all.map((s) => s.straightness)) && storm.straightness > 0.95, "straightness max in the storm");
  assert(clearing.agitation < storm.agitation && clearing.straightness < storm.straightness, "clearing relaxes back");
  // smooth along the cycle
  let prev = seaStateAt(0, 0), jump = 0;
  for (let i = 1; i <= 1000; i++) {
    const s = seaStateAt(i / 1000, 0);
    jump = Math.max(jump, Math.abs(s.agitation - prev.agitation), Math.abs(s.looping - prev.looping), Math.abs(s.straightness - prev.straightness), Math.abs(s.sinusoidality - prev.sinusoidality));
    prev = s;
  }
  assert(jump < 0.03, `smooth function of the cycle position (max step ${jump})`);
  console.log(`  sea  agit/sin/loop/straight: clear ${[calm.agitation, calm.sinusoidality, calm.looping, calm.straightness].map((x) => x.toFixed(2))} ` +
    `building ${[build.agitation, build.sinusoidality, build.looping, build.straightness].map((x) => x.toFixed(2))} ` +
    `lull ${[lull.agitation, lull.sinusoidality, lull.looping, lull.straightness].map((x) => x.toFixed(2))} ` +
    `storm ${[storm.agitation, storm.sinusoidality, storm.looping, storm.straightness].map((x) => x.toFixed(2))}`);
});

Deno.test("weather: pinned regimes produce consistent cloud layers, rain, sea and lightning", () => {
  const w = createWeather({ placeId: "greywall", latitude: 48, seed: 9, dayOfYear: 200, hour: 14 });
  const settle = (r: WeatherRegime) => { w.pin(r); for (let i = 0; i < 40; i++) w.step(0.05, 0.05 * 60, 200, 14); return structuredClone(w.state); };
  const storm = settle("storm");
  assert(storm.regime === "storm" && storm.iconic && storm.transition === 0, "pinned storm is settled and iconic");
  assert(storm.layers.length === 4 && storm.layers.every((l, i) => l.id === CLOUD_LAYERS[i]), "CLOUD_LAYERS order");
  assert(LAYER_TYPES.towering[0] === "cumulonimbus" && storm.layers[3].coverage > 0.8, "cumulonimbus towers in the storm");
  assert(storm.layers[1].typeMix > 0.9, "mid layer is altostratus in the storm");
  assert(storm.rain > 0.5 && storm.layers[3].darkness > 0.7, "downpour under dark bases");
  const expectCover = 1 - storm.layers.reduce((p, l) => p * (1 - l.coverage), 1);
  assert(Math.abs(storm.cloudCover - expectCover) < 1e-12, "cloudCover = 1 - prod(1 - c_i)");
  const speeds = storm.layers.map((l) => Math.hypot(l.driftX, l.driftZ));
  assert(speeds[2] > speeds[1] && speeds[1] > speeds[0], "wind shear: higher layers drift faster");
  assert(storm.sea.straightness > 0.9 && storm.sea.agitation > 0.9, "storm sea long-crested and rough");
  const fair = settle("fair");
  assert(fair.layers[0].typeMix < 0.3 && fair.layers[3].coverage < 0.05 && fair.rain === 0, "fair: cumulus, no towers, dry");
  const overcast = settle("overcast");
  assert(overcast.layers[0].typeMix > 0.8 && overcast.layers[0].coverage > 0.7, "overcast: stratus deck");
  const building = settle("building");
  assert(building.layers[2].coverage > fair.layers[2].coverage && building.layers[2].typeMix < 0.3, "building: cirrus spreads");
  assert(building.layers[1].typeMix > 0.6, "building: altostratus thickening");
  const lull = settle("lull");
  assert(lull.windSpeedMs < building.windSpeedMs && lull.sea.agitation < building.sea.agitation, "lull: the wind and sea drop");
  assert(!building.iconic && lull.iconic, "building is a transition, lull is iconic");
});

Deno.test("weather: lightning is a Poisson process at thunderPerMinute and a flash decays within ~0.3 s", () => {
  const w = createWeather({ placeId: "sunspire", latitude: 12, seed: 4, dayOfYear: 200, hour: 18 });
  w.pin("storm");
  const dt = 1 / 60;
  let flashes = 0, prev = 0, decayChecked = false;
  const seconds = 600;
  for (let i = 0; i < seconds * 60; i++) {
    w.step(dt * 24 / 1440, dt, 200, 18);
    const L = w.state.lightning;
    if (L > prev + 0.3) {
      flashes++;
      if (!decayChecked) {
        const peak = L;
        for (let k = 0; k < Math.round(LIGHTNING_DECAY_S * 60); k++) w.step(dt * 24 / 1440, dt, 200, 18);
        if (w.state.lightning < peak) { assert(w.state.lightning < 0.05 * peak, `decayed to ${w.state.lightning / peak} of the peak in 0.3 s`); decayChecked = true; }
      }
    }
    prev = w.state.lightning;
    assert(L >= 0 && L <= 1, "flash 0..1");
  }
  const rate = w.state.thunderPerMinute;
  const expected = rate * seconds / 60;
  console.log(`  storm lightning: ${flashes} flashes in ${seconds} s (rate ${rate.toFixed(2)}/min -> expected ~${expected.toFixed(0)})`);
  assert(decayChecked, "a flash decay was observed");
  assert(Math.abs(flashes - expected) < 4 * Math.sqrt(expected) + 3, "Poisson count near rate x time");
  const lx = w.state.lightningDir;
  assert(Math.abs(Math.hypot(lx[0], lx[1], lx[2]) - 1) < 1e-9 && lx[1] > 0, "strike direction is a unit sky vector");
  w.pin("clear");
  for (let i = 0; i < 120; i++) w.step(dt * 24 / 1440, dt, 200, 12);
  assert(w.state.thunderPerMinute === 0 && w.state.lightning < 1e-6, "no lightning under a clear sky");
});

Deno.test("weather: frostford winter precipitation falls as snow and builds ground snow", () => {
  const w = createWeather({ placeId: "frostford", latitude: 63, seed: 2, dayOfYear: 15, hour: 12 });
  w.pin("overcast");
  for (let i = 0; i < 200; i++) w.step(0.05, 3, 15, 12);
  assert(w.state.temperatureC < 1, `cold (${w.state.temperatureC})`);
  assert(w.state.snow > w.state.rain, `snow (${w.state.snow}) rather than rain (${w.state.rain})`);
  assert(w.groundSnow > 0.5, `ground snow cover ${w.groundSnow}`);
  const s = createWeather({ placeId: "sunspire", latitude: 12, seed: 2, dayOfYear: 200, hour: 12 });
  s.pin("storm");
  s.step(0.1, 1, 200, 12);
  assert(s.state.snow === 0 && s.groundSnow === 0, "no snow in the Sahel");
});

Deno.test("weather: 30-day climatology reproduces the normals (temperature, humidity, cloud) per place", () => {
  for (const [p, lat, d] of [["sunspire", 12, 200], ["sunspire", 12, 15], ["greywall", 48, 15], ["greywall", 48, 200], ["verdant", 34, 200], ["frostford", 63, 15]] as const) {
    let sT = 0, sRH = 0, sC = 0, n = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const w = createWeather({ placeId: p, latitude: lat, seed, dayOfYear: d, hour: 0 });
      let h = 0;
      for (let i = 0; i < 24 * 30 * 4; i++) {
        h = (h + 0.25) % 24;
        w.step(0.25, 15, d, h);
        sT += w.state.temperatureC; sRH += w.state.relativeHumidity; sC += w.state.cloudCover; n++;
      }
    }
    const nn = normalsAt(PLACE_CLIMATES[p], d);
    const T = sT / n, RH = sRH / n, C = sC / n;
    console.log(`  ${p} d${d}: T ${T.toFixed(2)} (normal ${nn.tMeanC.toFixed(2)}) RH ${RH.toFixed(2)} (${nn.relativeHumidity.toFixed(2)}) cloud ${C.toFixed(2)} (${nn.cloudFraction.toFixed(2)})`);
    assert(Math.abs(T - nn.tMeanC) < 1.5, `${p} mean temperature within 1.5 C`);
    assert(Math.abs(RH - nn.relativeHumidity) < 0.1, `${p} mean humidity within 0.1`);
    assert(Math.abs(C - nn.cloudFraction) < 0.2, `${p} mean cloud cover within 0.2`);
  }
});
