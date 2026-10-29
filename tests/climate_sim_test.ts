// Lane C: the climate facade — every RENDER_VAR every frame, determinism, freeze, pin, place
// switching, realistic distributions per place, and the per-step cost.
import { createClimate } from "../src/world/climate/Climate.ts";
import { DEFAULT_DAY_LENGTH_S, RENDER_VARS } from "../src/world/climate/contracts.ts";
import { WORLD_VARS } from "../src/world/climate/WorldVars.ts";
import { summarize } from "../src/core/MathCore.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

Deno.test("climate: frames carry every WORLD_VARS id (RENDER_VARS included) within declared ranges", () => {
  const c = createClimate({ placeId: "greywall", latitude: 48, seed: 1, year: 1, dayOfYear: 120, hour: 5 });
  for (let i = 0; i < 3000; i++) {
    const f = c.step(1 / 30);
    if (i % 50 !== 0) continue;
    for (const d of WORLD_VARS) {
      const x = f.vars[d.id];
      assert(Number.isFinite(x) && x >= d.min - 1e-9 && x <= d.max + 1e-9, `${d.id}=${x}`);
    }
    for (const id of RENDER_VARS) assert(id in f.vars, id);
    assert(f.moons.length === 2 && f.weather.layers.length === 4, "moons + layers");
    assert(f.weather.dewPointC === f.vars.dewPointC && f.weather.visibilityKm === f.vars.visibilityKm, "single source of truth");
  }
});

Deno.test("climate: deterministic for a seed; time flows; setDayLength(0) freezes the clock but not the weather", () => {
  const mk = () => createClimate({ placeId: "verdant", latitude: 34, seed: 77, year: 1, dayOfYear: 280, hour: 10 });
  const a = mk(), b = mk();
  for (let i = 0; i < 2000; i++) { a.step(1 / 60); b.step(1 / 60); }
  assert(JSON.stringify(a.frame()) === JSON.stringify(b.frame()), "same seed -> same frames");
  const h0 = a.frame().clock.hour;
  a.step(1);
  assert(a.frame().clock.hour > h0, "the clock advances");
  a.setDayLength(0);
  const frozen = a.frame().clock.hour, w0 = a.frame().weather.temperatureC;
  for (let i = 0; i < 600; i++) a.step(1);
  assert(a.frame().clock.hour === frozen && a.frame().clock.hoursPerSecond === 0, "frozen clock");
  assert(a.frame().weather.temperatureC !== w0, "weather keeps evolving on real time");
  a.setDayLength(DEFAULT_DAY_LENGTH_S);
  a.step(1);
  assert(a.frame().clock.hour !== frozen, "unfrozen");
});

Deno.test("climate: a full warped game day lasts dayLengthSeconds of real time", () => {
  const c = createClimate({ placeId: "sunspire", latitude: 12, seed: 3, year: 1, dayOfYear: 50, hour: 0, dayLengthSeconds: 240 });
  let t = 0;
  while (c.frame().clock.dayOfYear === 50 && t < 1000) { c.step(1 / 20); t += 1 / 20; }
  assert(Math.abs(t - 240) / 240 < 0.01, `day took ${t} s`);
});

Deno.test("climate: pinRegime holds a regime settled; setClock / setPlace re-evaluate immediately", () => {
  const c = createClimate({ placeId: "greywall", latitude: 48, seed: 5, year: 1, dayOfYear: 200, hour: 15 });
  c.pinRegime("storm");
  for (let i = 0; i < 6000; i++) c.step(1 / 10); // 10 real minutes = 10 game hours
  const f = c.frame();
  assert(f.weather.regime === "storm" && f.weather.nextRegime === "storm" && f.weather.transition === 0, "still storm");
  assert(f.vars["render.rainStreaks"] > 0.3 && f.vars["render.wetness"] > 0.5 && f.vars["render.sunMul"] < 0.2, "storm render vars");
  c.pinRegime(null);
  c.setClock(172, 0.5);
  assert(c.frame().clock.hour === 0.5 && c.frame().vars["render.sunMul"] === 0, "midnight: no sun");
  assert(c.frame().clock.calendar.monthName === "Highsun" && c.frame().clock.moment === "night", "calendar + moment");
  c.pinRegime("clear");
  c.setPlace("frostford", 63);
  c.setClock(172, 0.0);
  assert(c.frame().vars.latitude === 63 && c.frame().vars.sunElevationDeg > -6, "frostford midsummer midnight: white night");
  assert(c.frame().clock.moment !== "night", `no true night at 63N midsummer (${c.frame().clock.moment})`);
});

Deno.test("climate: realistic render-var distributions over simulated days (stats per place)", () => {
  const f3 = (x: number) => x.toFixed(2);
  for (const [place, lat, doy] of [["sunspire", 12, 200], ["greywall", 48, 15], ["verdant", 34, 200], ["frostford", 63, 15]] as const) {
    const c = createClimate({ placeId: place, latitude: lat, seed: 42, year: 1, dayOfYear: doy, hour: 0, dayLengthSeconds: 240 });
    const keys = ["render.exposure", "render.sunMul", "render.haze", "render.wetness", "render.turbidity", "temperatureC"] as const;
    const s: Record<string, number[]> = {};
    for (const k of keys) s[k] = [];
    for (let i = 0; i < 240 * 5 * 4; i++) { // 5 game days, 4 samples per real second
      const f = c.step(0.25);
      for (const k of keys) s[k].push(f.vars[k]);
    }
    const line = keys.map((k) => { const z = summarize(s[k]); return `${k.replace("render.", "")} [${f3(z.min)}..${f3(z.max)}] med ${f3(z.median)} p20 ${f3(z.p20)} p80 ${f3(z.p80)}`; });
    console.log(`  ${place} d${doy}: ${line.join(" | ")}`);
    const t = summarize(s.temperatureC);
    if (place === "frostford") assert(t.median < 0, "frostford January below freezing");
    if (place === "sunspire") assert(t.median > 22, "Sahel monsoon warm");
    // frostford in January: the noon sun only reaches ~6 deg, so its beam stays weak (physics, not a bug)
    assert(summarize(s["render.sunMul"]).max > (place === "frostford" ? 0.02 : 0.5), `${place}: the sun shines at some point`);
  }
});

Deno.test("climate: step() cost (10 000 steps)", () => {
  const c = createClimate({ placeId: "greywall", latitude: 48, seed: 8, year: 1, dayOfYear: 100, hour: 6 });
  for (let i = 0; i < 1000; i++) c.step(1 / 60); // warm-up
  const t0 = performance.now();
  for (let i = 0; i < 10000; i++) c.step(1 / 60);
  const ms = (performance.now() - t0) / 10000;
  console.log(`  climate.step(): ${(ms * 1000).toFixed(1)} us/step over 10 000 steps (budget 200 us)`);
  assert(ms < 0.2, `step under 0.2 ms (got ${ms} ms)`);
});
