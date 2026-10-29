// Lane C: iconic time dilation (G18) — a full day still takes dayLengthSeconds, twilight gets
// >= 2x its share of real time, the clock is monotonic and dayLength 0 freezes it.
import {
  buildDayTable, classifyMoment, createWarpedClock, DWELL, dwellWeight, hourAtPhase, isTwilightMoment, phaseAtHour,
} from "../src/world/climate/TimeWarp.ts";
import { solarPosition } from "../src/graphics/Environment.ts";
import { DAY_MOMENTS } from "../src/world/climate/contracts.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }
const deg = (doy: number, h: number, lat: number) => solarPosition(doy, h, lat).elevation * 180 / Math.PI;

Deno.test("timewarp: dwell weights — twilight ~2-2.5x, blue-sky midday ~1.3x, climbs < 1, night ~0.8-1", () => {
  assert(Math.abs(dwellWeight(-4, 60, 1) - DWELL.blueHour) < 1e-9 && DWELL.blueHour >= 2, "blue hour");
  assert(Math.abs(dwellWeight(5, 60, 1) - DWELL.golden) < 1e-9 && DWELL.golden <= 2.5, "golden hour");
  assert(Math.abs(dwellWeight(60, 60, 1) - 1.3) < 1e-9, "blue-sky midday 1.3");
  assert(Math.abs(dwellWeight(60, 60, 0) - 1.0) < 1e-9, "cloudy midday 1.0");
  assert(dwellWeight(25, 60, 1) < 1, "morning climb hurried");
  const night = dwellWeight(-30, 60, 1);
  assert(night >= 0.8 && night <= 1, "night 0.8..1");
  for (const m of DAY_MOMENTS) assert(typeof isTwilightMoment(m) === "boolean", m);
});

Deno.test("timewarp: the table's phase <-> hour maps are inverse and monotonic", () => {
  const t = buildDayTable(100, 48, 1);
  let prev = -1;
  for (let i = 0; i <= 1000; i++) {
    const s = i / 1000, h = hourAtPhase(t, s);
    assert(h >= prev - 1e-12, "monotonic");
    prev = h;
    assert(Math.abs(phaseAtHour(t, h) - s) < 1e-9, `inverse at ${s}`);
  }
});

for (const [place, lat, doy] of [["greywall", 48, 80], ["greywall", 48, 172], ["sunspire", 12, 200], ["verdant", 34, 300]] as const) {
  Deno.test(`timewarp: ${place} day ${doy} — full day == dayLengthSeconds, twilight >= 2x share, monotonic`, () => {
    const dayLength = 600, dt = 1 / 30;
    const clock = createWarpedClock({ year: 1, dayOfYear: doy, hour: 0, latitude: lat, dayLengthSeconds: dayLength });
    let real = 0, twReal = 0, prevH = 0;
    const prevDay = clock.dayOfYear;
    while (clock.dayOfYear === prevDay) {
      const m = classifyMoment(deg(clock.dayOfYear, clock.hour, lat), clock.hour, clock.maxElevDeg);
      if (isTwilightMoment(m)) twReal += dt;
      clock.advance(dt);
      real += dt;
      if (clock.dayOfYear === prevDay) assert(clock.hour >= prevH, "monotonic within the day");
      prevH = clock.hour;
      if (real > dayLength * 2) throw new Error("day never ended");
    }
    assert(Math.abs(real - dayLength) / dayLength < 0.01, `full day took ${real.toFixed(2)} s of ${dayLength}`);
    // solar-hour share of twilight
    const t = buildDayTable(doy, lat, 1);
    let twHours = 0;
    const N = 24 * 60;
    for (let i = 0; i < N; i++) {
      const h = (i + 0.5) / 60;
      if (isTwilightMoment(classifyMoment(deg(doy, h, lat), h, t.maxElevDeg))) twHours += 1 / 60;
    }
    const realShare = twReal / real, hourShare = twHours / 24;
    console.log(`  ${place} d${doy}: twilight ${(hourShare * 100).toFixed(1)}% of solar hours -> ${(realShare * 100).toFixed(1)}% of real time (x${(realShare / hourShare).toFixed(2)})`);
    assert(realShare >= 2 * hourShare, `dawn+dusk real share ${realShare} >= 2x solar share ${hourShare}`);
  });
}

Deno.test("timewarp: dayLength 0 freezes; crossing midnight advances the day; hoursPerSecond tracks the dwell", () => {
  const c = createWarpedClock({ year: 2, dayOfYear: 365, hour: 23.9, latitude: 48, dayLengthSeconds: 0 });
  assert(c.advance(100) === 0 && c.hour === 23.9 && c.hoursPerSecond === 0, "frozen");
  c.setDayLength(1440);
  const dh = c.advance(60);
  assert(dh > 0 && c.dayOfYear === 1 && c.year === 3, `wrapped into the next year (day ${c.dayOfYear}, year ${c.year})`);
  c.set(172, 12);
  const mid = c.hoursPerSecond;
  c.set(172, 4.0); // ~ sunrise twilight at 48N midsummer
  const tw = c.hoursPerSecond;
  assert(tw < mid, `twilight hours pass slower (${tw} < ${mid})`);
  assert(c.dwell > 1.5, `twilight dwell > 1.5 (got ${c.dwell})`);
});
