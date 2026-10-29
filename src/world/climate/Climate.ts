// The climate facade (G12-G18): one `createClimate` ties the warped clock, the calendar, the sun
// (Environment.solarPosition), the two moons, the weather regime cycle and the world equations
// into a ClimateFrame per step. Pure: no THREE, no DOM. Deterministic for a seed and a dt sequence.
//
// Per step(dt real seconds):
//   1. the warped clock advances (dwell table per day; setDayLength(0) freezes it);
//   2. weather advances on GAME hours (when the clock is frozen it keeps evolving at the default
//      rate, 24 game hours per DEFAULT_DAY_LENGTH_S real seconds); lightning decays on REAL time;
//   3. sun from solarPosition(dayOfYear, hour, latitude); moons in place;
//   4. evaluateWorldInto(all inputs) -> vars (every WORLD_VARS id, RENDER_VARS included);
//   5. weather.dewPointC / visibilityKm / fog are taken from the equations (single source of truth;
//      fog after the world's wind dispersal).
// Total (lane E): NaN / Infinity options and arguments fall back to safe values; the world sees
// the FRACTIONAL day of year (doy + (hour - 12) / 24: exact at noon, continuous at midnight).
// The frame and its nested objects are reused and mutated each step (no per-frame garbage beyond
// solarPosition's small result).

import {
  type ClimateFrame, type ClimateOptions, type ClimateSim, type ClockState, DEFAULT_DAY_LENGTH_S, type WeatherRegime,
} from "./contracts.ts";
import { solarPosition } from "../../graphics/Environment.ts";
import { calendarFromDayOfYear } from "./Calendar.ts";
import { classifyMoment, createWarpedClock } from "./TimeWarp.ts";
import { createWeather } from "./Weather.ts";
import { createMoonStates, DEFAULT_AEROSOL_TAU, updateMoons } from "./Moons.ts";
import { evaluateWorldInto, WORLD_VARS } from "./WorldVars.ts";
import { placeClimate } from "./RealClimate.ts";

type Mut<T> = { -readonly [P in keyof T]: T[P] };

/** Create the climate simulation. */
export function createClimate(opts: ClimateOptions): ClimateSim {
  const dayLength0 = opts.dayLengthSeconds ?? DEFAULT_DAY_LENGTH_S;
  let latitude = Number.isFinite(opts.latitude) ? Math.max(-90, Math.min(90, opts.latitude)) : 0;
  let place = placeClimate(opts.placeId, latitude);
  const clock = createWarpedClock({ year: opts.year, dayOfYear: opts.dayOfYear, hour: opts.hour, latitude, dayLengthSeconds: dayLength0 });
  const seed = Number.isFinite(opts.seed) ? opts.seed : 0;
  const weather = createWeather({ placeId: opts.placeId, latitude, seed, dayOfYear: clock.dayOfYear, hour: clock.hour });
  const moons = createMoonStates();
  const inputs: Record<string, number> = {};
  const vars: Record<string, number> = {};
  for (const d of WORLD_VARS) vars[d.id] = d.def;

  let calendarDay = -1, calendarYear = -1;
  const clockState: Mut<ClockState> = {
    year: clock.year, dayOfYear: clock.dayOfYear, hour: clock.hour, calendar: calendarFromDayOfYear(clock.dayOfYear, clock.year),
    moment: "midday", hoursPerSecond: 0, dwell: 1,
  };
  const frame: ClimateFrame = { clock: clockState, weather: weather.state, moons, vars };

  function compute(dt: number, dGameH: number): ClimateFrame {
    const w = weather.step(dGameH, dt, clock.dayOfYear, clock.hour);
    const doy = clock.dayOfYear, hour = clock.hour, year = clock.year;
    const sun = solarPosition(doy, hour, latitude);
    const sunDeg = sun.elevation * 180 / Math.PI;
    updateMoons(moons, year, doy, hour, latitude, vars.aerosolTau ?? DEFAULT_AEROSOL_TAU);

    inputs.temperatureC = w.temperatureC;
    inputs.relativeHumidity = w.relativeHumidity;
    inputs.pressureHPa = w.pressureHPa;
    inputs.windSpeedMs = w.windSpeedMs;
    inputs.gustMs = w.gustMs;
    inputs.rain = w.rain;
    inputs.snow = w.snow;
    inputs.fog = w.fog;
    inputs.cloudLow = w.layers[0].coverage;
    inputs.cloudMid = w.layers[1].coverage;
    inputs.cloudHigh = w.layers[2].coverage;
    inputs.cloudTowering = w.layers[3].coverage;
    inputs.storminess = w.storminess;
    inputs.lightning = w.lightning;
    inputs.aerosolBase = weather.aerosol;
    inputs.snowCover = weather.groundSnow;
    inputs.hour = hour;
    inputs.dayOfYear = doy + (hour - 12) / 24;
    inputs.latitude = latitude;
    inputs.sunElevationDeg = sunDeg;
    inputs.moonIlunBrightness = moons[0].brightness;
    inputs.moonVeshBrightness = moons[1].brightness;
    inputs.moonIlunIllumination = moons[0].illumination;
    inputs.moonVeshIllumination = moons[1].illumination;
    inputs.groundAlbedo = place.groundAlbedo;
    evaluateWorldInto(inputs, vars);

    const wm = w as Mut<typeof w>;
    wm.dewPointC = vars.dewPointC;
    wm.visibilityKm = vars.visibilityKm;
    wm.fog = vars.fogEff;

    // blue-sky midday dwell follows the sky's clearness (quantised inside the clock)
    clock.setBlueSky((1 - w.cloudCover) * (1 - w.rain) * (1 - w.fog));

    if (doy !== calendarDay || year !== calendarYear) {
      calendarDay = doy; calendarYear = year;
      clockState.calendar = calendarFromDayOfYear(doy, year);
    }
    clockState.year = year;
    clockState.dayOfYear = doy;
    clockState.hour = hour;
    clockState.moment = classifyMoment(sunDeg, hour, clock.maxElevDeg);
    clockState.hoursPerSecond = clock.hoursPerSecond;
    clockState.dwell = clock.dwell;
    return frame;
  }

  compute(0, 0);
  compute(0, 0); // second pass: the moons now see this frame's aerosol depth (no pop on the first step)

  return {
    step(dt: number): ClimateFrame {
      const realDt = dt > 0 && Number.isFinite(dt) ? dt : 0;
      const dGame = clock.dayLengthSeconds > 0 ? clock.advance(realDt) : (realDt * 24) / DEFAULT_DAY_LENGTH_S;
      return compute(realDt, dGame);
    },
    frame: () => frame,
    setClock(dayOfYear: number, hour: number, year?: number) {
      clock.set(dayOfYear, hour, year);
      compute(0, 0);
    },
    setPlace(placeId: string, lat: number) {
      if (Number.isFinite(lat)) latitude = Math.max(-90, Math.min(90, lat));
      place = placeClimate(placeId, latitude);
      clock.setLatitude(latitude);
      weather.setPlace(placeId, latitude);
      compute(0, 0);
    },
    pinRegime(regime: WeatherRegime | null) {
      weather.pin(regime);
      compute(0, 0);
    },
    setDayLength(seconds: number) {
      clock.setDayLength(seconds > 0 && Number.isFinite(seconds) ? seconds : 0);
    },
  };
}
