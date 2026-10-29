// Lane C: real-world climate normals (plausibility, smooth cyclic interpolation, diurnal model)
// and the Mytherrania calendar.
import { DIURNAL, diurnalAt, MONTH_MID_DAYS, normalsAt, PLACE_CLIMATES, placeClimate } from "../src/world/climate/RealClimate.ts";
import {
  calendarFromDayOfYear, DAYS_PER_YEAR, dayOfYearFromCalendar, MONTHS, SEASON_STARTS,
} from "../src/world/climate/Calendar.ts";
import { solarPosition } from "../src/graphics/Environment.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

Deno.test("climate normals: plausible by place and season", () => {
  const jan = (id: string) => normalsAt(PLACE_CLIMATES[id], MONTH_MID_DAYS[0]);
  const jul = (id: string) => normalsAt(PLACE_CLIMATES[id], MONTH_MID_DAYS[6]);
  assert(jan("sunspire").tMeanC - jan("frostford").tMeanC > 20, "frostford January far colder than sunspire January");
  assert(jul("greywall").tMeanC > jan("greywall").tMeanC + 12, "Paris-like summer much warmer than winter");
  assert(jan("frostford").snowShare > 0.8 && jul("frostford").snowShare === 0, "frostford snows in winter only");
  assert(jul("sunspire").thunderDays > 8 && jan("sunspire").thunderDays < 0.5, "Sahel thunder in the monsoon, none in harmattan");
  assert(jan("sunspire").relativeHumidity < 0.3 && jul("sunspire").relativeHumidity > 0.6, "harmattan dry, monsoon humid");
  assert(jul("verdant").cloudFraction < 0.2 && jul("verdant").precipDays < 2, "Mediterranean summer dry and sunny");
  assert(jan("greywall").cloudFraction > 0.65, "grey oceanic winter");
  for (const id in PLACE_CLIMATES) {
    const p = PLACE_CLIMATES[id];
    assert(p.analogue.length > 5 && p.months.length === 12, `${id} has an analogue and 12 months`);
    for (const m of p.months) {
      assert(m.pressureHPa > 1000 && m.pressureHPa < 1025, `${id} MSL pressure ~1013 +- seasonal`);
      assert(m.relativeHumidity > 0.1 && m.relativeHumidity < 0.95, `${id} RH`);
      assert(m.thunderDays <= 31 && m.precipDays <= 31, `${id} day counts`);
    }
  }
  assert(placeClimate("unknown-place", 60).id === "frostford", "unknown id -> nearest latitude");
});

Deno.test("climate normals: interpolation hits the monthly values at mid-month, is smooth and cyclic", () => {
  const p = PLACE_CLIMATES.greywall;
  for (let m = 0; m < 12; m++) {
    const n = normalsAt(p, MONTH_MID_DAYS[m]);
    assert(Math.abs(n.tMeanC - p.months[m].tMeanC) < 1e-9, `mid-month ${m} exact`);
  }
  let maxJump = 0;
  let prev = normalsAt(p, 1).tMeanC;
  for (let d = 1.25; d <= 366; d += 0.25) {
    const t = normalsAt(p, d).tMeanC;
    maxJump = Math.max(maxJump, Math.abs(t - prev));
    prev = t;
  }
  assert(maxJump < 0.1, `smooth: max change per quarter day ${maxJump}`);
  assert(Math.abs(normalsAt(p, 365.99).tMeanC - normalsAt(p, 0.99).tMeanC) < 1e-6, "cyclic across the new year");
});

Deno.test("climate diurnal: min near sunrise, max ~15:00, mean = monthly mean, RH inverse, wind peaks afternoon", () => {
  const n = normalsAt(PLACE_CLIMATES.verdant, 172);
  const T: number[] = [], RH: number[] = [], W: number[] = [];
  for (let i = 0; i < 24 * 12; i++) {
    const d = diurnalAt(n, i / 12, 172, 34);
    T.push(d.temperatureC); RH.push(d.relativeHumidity); W.push(d.windMs);
  }
  const argmax = (a: number[]) => a.indexOf(Math.max(...a)) / 12;
  const argmin = (a: number[]) => a.indexOf(Math.min(...a)) / 12;
  const sunrise = (() => { for (let h = 0; h < 12; h += 0.05) if (solarPosition(172, h, 34).elevation > 0) return h; return 6; })();
  assert(Math.abs(argmax(T) - DIURNAL.tMaxHour) < 0.2, `Tmax at ~15:00 (got ${argmax(T)})`);
  assert(Math.abs(argmin(T) - sunrise) < 0.5, `Tmin near sunrise ${sunrise.toFixed(2)} (got ${argmin(T)})`);
  const mean = T.reduce((a, b) => a + b, 0) / T.length;
  assert(Math.abs(mean - n.tMeanC) < 0.05, `daily mean = monthly mean (${mean} vs ${n.tMeanC})`);
  assert(Math.abs(Math.max(...T) - Math.min(...T) - n.diurnalRangeC) < 0.05, "range = diurnal range");
  assert(Math.abs(argmin(RH) - argmax(T)) < 0.2 && Math.abs(argmax(RH) - argmin(T)) < 0.5, "humidity runs inversely to temperature");
  assert(Math.abs(argmax(W) - 15) < 0.2, "wind peaks mid-afternoon");
});

Deno.test("calendar: 12 named months sum to 365; dates round-trip; seasons from equinoxes/solstices", () => {
  assert(MONTHS.length === 12, "12 months");
  assert(MONTHS.reduce((s, m) => s + m.days, 0) === DAYS_PER_YEAR, "sum to 365");
  assert(new Set(MONTHS.map((m) => m.name)).size === 12, "distinct names");
  for (let d = 1; d <= 365; d++) {
    const c = calendarFromDayOfYear(d, 3);
    assert(c.dayOfYear === d && c.year === 3, "identity");
    assert(dayOfYearFromCalendar(c.monthIndex, c.dayOfMonth) === d, `round-trip ${d}`);
    assert(c.dayOfMonth >= 1 && c.dayOfMonth <= MONTHS[c.monthIndex].days, "day of month in range");
    assert(c.seasonProgress >= 0 && c.seasonProgress < 1, `season progress ${c.seasonProgress} at ${d}`);
  }
  const s = (d: number) => calendarFromDayOfYear(d, 1).season;
  assert(s(SEASON_STARTS.spring) === "spring" && s(SEASON_STARTS.spring - 1) === "winter", "spring from day 79");
  assert(s(172) === "summer" && s(171) === "spring", "summer from 172");
  assert(s(265) === "autumn" && s(264) === "summer", "autumn from 265");
  assert(s(355) === "winter" && s(354) === "autumn" && s(10) === "winter", "winter from 355 across the new year");
  assert(calendarFromDayOfYear(1, 1).seasonProgress > calendarFromDayOfYear(360, 0).seasonProgress, "winter progress continues across new year");
  const wrap = calendarFromDayOfYear(366, 4);
  assert(wrap.year === 5 && wrap.dayOfYear === 1 && wrap.monthIndex === 0 && wrap.dayOfMonth === 1, "day 366 wraps to next year");
  const back = calendarFromDayOfYear(0, 4);
  assert(back.year === 3 && back.dayOfYear === 365, "day 0 wraps back");
  // the calendar drives the sun: solstice noon is higher than winter-solstice noon at 48N
  const hi = solarPosition(dayOfYearFromCalendar(5, 21), 12, 48).elevation, lo = solarPosition(dayOfYearFromCalendar(11, 21), 12, 48).elevation;
  assert(hi * 180 / Math.PI > 64 && lo * 180 / Math.PI < 20, `Highsun 21 noon ${hi * 57.3} vs Longdark 21 noon ${lo * 57.3}`);
});
