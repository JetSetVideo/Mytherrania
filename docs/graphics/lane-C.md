# Lane C — world climate (G12 G13 G14-model G15-sea-state G16 G17 G18)

Pure model in `src/world/climate/` (no THREE, no DOM), implementing `contracts.ts` (unchanged).
All numbers below are pasted from real runs of
`deno check src/world/climate/*.ts tests/climate_*_test.ts && NO_COLOR=1 deno test --allow-read tests/climate_*_test.ts`
→ **`ok | 42 passed | 0 failed`** (check clean).

## Files

| File | What |
|------|------|
| `Expr.ts` | Evaluator for the contract `Expr` over all 26 `EXPR_OPS`: `evalExpr`, `compileExpr` (closure, no per-call allocation, compile-time errors naming unknown vars/coefficients, arity check), `exprRefs`, the terse builder `X`. Total semantics: div/0 → 0, GLSL `mod`, sign-preserving `pow`, `sqrt(max(0,x))`, `log(max(1e-9,x))`, GLSL `step`/`smoothstep` (also e0 > e1), `select(c,a,b) = c > 0.5 ? a : b`; any non-finite result → 0. |
| `WorldVars.ts` | `WORLD_VARS` at the very top (83 vars: 16 real, 9 input, 58 derived incl. all 15 `RENDER_VARS`), `WORLD_COEFFICIENTS` (111, each commented), `WORLD_EQUATIONS` (58, each with a `why`), `WORLD_ORDER` (topological order built at module load — a cycle throws naming it), `evaluateWorld`, `evaluateWorldInto` (reused record), `topoSortEquations`, `magnusDewPointC`, `magnusSatVapourHPa`. |
| `RealClimate.ts` | Monthly normals for the 4 places from real analogues — sunspire = Niamey, greywall = Paris, verdant = Algiers, frostford = Östersund (APPROXIMATE typical values, not station data). Fields: tMeanC, diurnalRangeC, relativeHumidity, pressureHPa, windMs, cloudFraction, precipDays, thunderDays, snowShare, aerosol. `normalsAt` (periodic Catmull-Rom between mid-months, cyclic), `diurnalAt` (T min at sunrise, max 15:00, daily mean = monthly mean; constant vapour pressure ⇒ RH inverse to T; wind peaks 15:00), `sunriseHour`, `diurnalShape`, `placeClimate` (unknown id → nearest latitude). |
| `Weather.ts` | Seeded weather: OU synoptic anomalies on a fixed 0.25 game-hour tick (exact discretisation), Markov regime chain with normals-driven weights, iconic dwell, regime profiles → 4 cloud layers, rain/snow/fog, Poisson lightning, ground snow, `seaStateAt`. Three independent rng streams (regimes, anomalies, lightning) ⇒ regime sequence is frame-step independent (tested). |
| `Calendar.ts` | 12 months (Frostwane, Emberthaw, Seedwake, Rainmoot, Bloomtide, Highsun, Goldcrest, Harvestfire, Ashfall, Mistveil, Starhollow, Longdark; Gregorian lengths = 365), `calendarFromDayOfYear`, `dayOfYearFromCalendar`, `seasonOf`, `normalizeDay`, `SEASON_STARTS` (79/172/265/355). The day of year is what `solarPosition` uses ⇒ the calendar drives the sun. |
| `TimeWarp.ts` | Iconic time dilation: `dwellWeight`, `classifyMoment`, per-day `buildDayTable` (480 samples of `solarPosition`, cumulative integral), `createWarpedClock` (advances the real-time phase s = C(h)/C(24) and inverts it ⇒ a full day is exactly `dayLengthSeconds`), `DWELL` numbers. |
| `Moons.ts` | Ilun (silver-blue, synodic 29.53 d, incl. 5.1°, r 0.0105 rad) and Vesh (amber-rose, 11.0 d, 11.5°, r 0.0055 rad). Phase from time, elongation-lagged hour angle, Kasten air mass, per-channel λ⁻⁴ Rayleigh + λ⁻¹·³ aerosol extinction → `skyColor`, `brightness`, moon-illusion radius. `updateMoons` mutates in place. |
| `Climate.ts` | `createClimate(opts): ClimateSim` — the facade. ~10 µs per `step()`. |

Tests: `tests/climate_{expr,world,real,time,moons,weather,sim}_test.ts` (42 tests).

## What the parent must call

```ts
import { createClimate } from "./src/world/climate/Climate.ts";
const climate = createClimate({ placeId, latitude, seed, year, dayOfYear, hour /*, dayLengthSeconds */ });
// every frame:
const f = climate.step(dtRealSeconds);
f.clock      // year, dayOfYear, hour, calendar (month name, season), moment, hoursPerSecond, dwell
             //   -> solarPosition(f.clock.dayOfYear, f.clock.hour, latitude) for the sun (same law used inside)
f.weather    // regime/nextRegime/transition/iconic, storminess, layers[4] (CLOUD_LAYERS order:
             //   altitudeM, coverage, density, typeMix, driftX/Z, darkness), rain/snow/fog,
             //   lightning (+ lightningDir), visibilityKm, cloudCover, sea (-> Waves)
f.moons      // [Ilun, Vesh]: dir, elevation, phase, illumination, angularRadius, baseColor, skyColor, brightness
f.vars["render.exposure" | ...]  // all 15 RENDER_VARS (+ every other world var)
// QA / settings:
climate.pinRegime("storm" | null); climate.setDayLength(0 /* freeze */ | 1440);
climate.setClock(doy, hour, year?); climate.setPlace(placeId, latitude);
```

Note: the frame object and its nested objects are reused and mutated every step (copy if you keep history).
`vars.sunElevationDeg` is the exact `solarPosition` elevation for the clock. When the clock is frozen the
weather keeps evolving at the default rate (24 game h per 1440 real s), as the contract says.

Exports used only by tests/QA (no runtime caller needed): `evalExpr`, `exprRefs`, `topoSortEquations`,
`WORLD_ORDER`, `moonStates`, `angleBetween`, `absoluteDays`, `isTwilightMoment`, `dayOfYearFromCalendar`,
`transitionWeights`, `meanDwellHours`, `MONTH_MID_DAYS`. Optional parent uses: `seaStateAt` (a Waves
preview slider) and `evaluateWorld` (a debug panel of the world table).

## The numbers (G18 iconic dwell)

- Regime dwell (game hours) = reality × iconic multiplier: clear 10×1.6 = 16, fair 8×1, overcast 10×0.8 = 8,
  **building 2×0.5 = 1**, **lull 0.75×2.5 = 1.875**, **storm 1.5×2.2 = 3.3**, **clearing 2×0.5 = 1**; each draw ×U(0.6, 1.4).
  Handover `HANDOVER_H = 0.3` game h (18 real s at the default day length).
- Day dwell weights: blue hour 2.1, golden hour 2.4, blue-sky midday 1.3 (cloudy 1.0), climbs 0.6, night 0.88;
  normalised so a full day = `dayLengthSeconds` (tested < 1 % error; measured exact to the step size).
- Measured (120 game days, sunspire Goldcrest): mean game hours per visit — clear 15.38 (×49), fair 8.26 (×121),
  overcast 8.66 (×34), building 1.30 (×98), lull 2.20 (×98), storm 3.60 (×98), clearing 1.33 (×103).
- Twilight (blue + dawn/dusk + golden) share: greywall d80 13.3 % of solar hours → 27.6 % of real time (×2.07);
  greywall d172 16.2 % → 34.2 % (×2.11); sunspire d200 9.7 % → 23.2 % (×2.39); verdant d300 11.4 % → 24.1 % (×2.12).

## Measured outputs

```
world: 83 vars (25 inputs), 58 equations, 111 coefficients, 26/26 ops
climate.step(): 10.3 us/step over 10 000 steps (budget 200 us)
sea  agit/sin/loop/straight: clear 0.11,1.00,0.00,0.00 building 0.51,0.01,1.00,0.00 lull 0.26,0.00,1.00,0.00 storm 0.90,0.00,0.00,1.00
storm lightning: 54 flashes in 600 s (rate 6.00/min -> expected ~60)
moons: max |illumination - (1 - cos elongation)/2| = 0.052 (inclination + obliquity offsets)
Ilun: R/B zenith-ish 0.88 vs horizon 2.24; radius 0.0105 -> 0.0127
Vesh: R/B zenith-ish 1.73 vs horizon 7.10; radius 0.0055 -> 0.0067
30-day climatology (4 seeds) vs normals:
  sunspire d200: T 28.72 (normal 28.41) RH 0.70 (0.67) cloud 0.62 (0.61)
  sunspire d15:  T 25.55 (normal 24.46) RH 0.17 (0.21) cloud 0.25 (0.12)
  greywall d15:  T 5.52 (normal 5.00)   RH 0.86 (0.86) cloud 0.63 (0.75)
  greywall d200: T 21.08 (normal 20.59) RH 0.71 (0.69) cloud 0.57 (0.50)
  verdant d200:  T 27.08 (normal 26.07) RH 0.66 (0.70) cloud 0.28 (0.10)
  frostford d15: T -6.95 (normal -7.48) RH 0.86 (0.86) cloud 0.63 (0.75)
Simulated 5 game days per place (render vars, min..max, median, p20, p80):
  sunspire d200: exposure [0.98..1.60] med 1.31 p20 1.11 p80 1.60 | sunMul [0.00..1.03] med 0.00 p20 0.00 p80 0.34 | haze [0.08..1.00] med 0.10 p20 0.09 p80 0.66 | wetness [0.00..1.00] med 0.00 p80 0.18 | turbidity [2.55..10.00] med 2.97
  greywall d15:  exposure [1.09..1.60] med 1.48 | sunMul [0.00..0.70] p80 0.12 | haze med 0.16 p80 0.92 | wetness [0.00..0.40] | turbidity med 3.10 | T med 0.80
  verdant d200:  exposure [0.99..1.60] med 1.20 | sunMul [0.00..1.05] p80 0.71 | haze med 0.11 p80 0.14 | turbidity med 3.23 | T med 23.05
  frostford d15: exposure [1.12..1.60] med 1.42 | sunMul [0.00..0.19] (noon sun ~6 deg) | haze med 0.34 p80 0.94 | T med -11.75
Uniform-random inputs (4000 samples, robustness — not a target distribution):
  render.exposure min 0.946 max 1.600 mean 1.214 median 1.160 p20 1.040 p80 1.479
  render.saturation min 0.069 max 0.991 mean 0.370 median 0.288 p20 0.171 p80 0.615
  render.turbidity min 1.021 max 10.000 mean 6.195 median 5.947 p20 2.355 p80 10.000
  render.giStrength min 0.053 max 1.500 mean 0.588 median 0.551 p20 0.255 p80 0.925
```

Physical spot checks (tested): T 20 °C / RH 0.5 → dew point 9.26 °C; e_s(20) = 23.3 hPa; ρ(20 °C, 1013 hPa) ≈ 1.20;
Beaufort 5 at 9.5 m/s, 6 at 11.5; wind chill −10 °C/36 km/h < −15; humidex 32 °C/70 % > 40; equinox day 12 h, 48 °N
midsummer ~15.8 h; LCL = 125 m/K × spread.

## Honest gaps

- Normals are rounded typical values from memory of climate summaries, not station data; verdant summer cloud runs
  high in the sim (0.28 vs 0.10: the fair regime's minimum cumulus) and dry-season Sahel too (0.25 vs 0.12);
  30-day means run +0.5..+1.1 °C warm (clear/fair regimes carry +0.8/+0.3 °C offsets).
- `render.exposure` saturates at its 1.6 cap for most of the night (p80 = 1.6), and `render.saturation`
  never exceeds ~1.0 in practice (contract allows 1.6). The fog distances are game-scale guesses (fogFar = 30 % of
  meteorological visibility, capped 6 km) — the parent may want to rescale to the arena size.
- When the sky's clearness changes mid-day the clock's blue-sky midday weight is rebuilt (quantised to 0.1), so a
  day with changing weather is only approximately `dayLengthSeconds` long (exact with constant sky; the facade test
  measured within 1 %).
- Moons: an analytic orbit (elongation-lagged hour angle + inclined declination), not an ephemeris; illumination
  vs observed elongation differs up to 0.052. No eclipses, no moon-moon interaction; `brightness` ignores clouds
  (the renderer should multiply by its own cloud occlusion / `1 - vars.sunOcclusion`-like factor).
- Lightning timing is a real-time Poisson draw per step, so the exact flash times depend on the dt sequence
  (rate is right; regimes/anomalies are dt-independent). "Cirrus first while building" comes from per-layer damping
  rates (high layer fastest) and the building profile; it is not separately asserted by a test.
- `Weather.visibilityKm`/`dewPointC` standalone are rough estimates; `createClimate` overwrites them with the
  world equations (single source). `WORLD_VARS` declares lane-C ranges for `render.fogNear` (0..3000 m) and
  `render.fogFar` (40..6000 m) since the contract gives none.
- Not run: the whole suite, `deno task check`, the build (per house rules). Nothing is wired into the engine yet.
