# Lane E: climate equations (continuity, totality, couplings)

Scope: the equation side of `src/world/climate/` (WorldVars, Weather, TimeWarp, Moons, RealClimate,
Calendar, Climate; Expr unchanged). `contracts.ts` is untouched. Every engine-facing name is kept:
`createClimate`, `evaluateWorld`, `WORLD_COEFFICIENTS` (`rainDim`, `ambNight`, `ambDay`,
`ambAlbedoGain`, `ambMoon` unchanged), and the frame vars `sunTransmittance`, `daylight`,
`albedoEff`, `moonLight` plus all 15 `RENDER_VARS`.

All numbers below come from real runs of
`deno check src/world/climate/*.ts tests/climate_*_test.ts && NO_COLOR=1 deno test --allow-read tests/climate_*_test.ts && deno lint src/world/climate tests/climate_*_test.ts`.
Result: check clean, **`ok | 72 passed | 0 failed`** (42 lane-C tests plus 30 new ones), lint clean
(20 files).

## How the defects were measured (before → after)

`tests/climate_continuity_test.ts` was written **first** and run on the untouched lane-C code. git
stash was not allowed, so the "before" numbers come from that first run. The measurement code is
still in the file.

**Lipschitz probe.** Each of the 25 inputs is swept across its declared range in 2000 steps, with the
other inputs at seeded typical values (6 seeds). For every derived output the probe records the
largest move between neighbouring steps, as a % of the output's declared range. Any move over
tolerance is then bisected 44 times. If the move does not shrink to ≤1e-6 of the range at an interval
of ~1e-12, it is a **true discontinuity**.

| | 5 largest neighbour moves (continuous outputs) | true discontinuities |
|---|---|---|
| **before** | frozen←T 100 % (TRUE); summerness←latitude 48.5 % (TRUE); render.wetness←T 41.1 % (TRUE); albedoEff←T 10.2 % (TRUE); render.giStrength←T 4.5 % (TRUE) | **9**: frozen, render.wetness, summerness, albedoEff, render.giStrength, apparentTempC, render.saturation, render.ambientMul, sceneEv |
| **after** | frozen←T 5.75 %; render.wetness←T 4.75 %; dayLengthHours←latitude 4.37 %; golden←sunElevation 2.70 %; render.fogFar←snow 2.12 % | **0** (`beaufort`, `precipKind` are discrete display codes, listed as exempt) |

All the "after" moves are continuous and steep by design or by physics. Each one has a declared
tolerance in the test:
- **frozen (6 %), wetness (5 %):** the 1.5 K freezing band. Smoothstep's peak slope × the 0.0575 K
  probe step = 5.75 %.
- **dayLengthHours (5 %):** the sunrise equation's square-root corner at the polar circle.
- **golden, airMass (3 %):** a 5° window, and the Kasten air mass near the horizon.
- **fog chain (4 %):** Koschmieder's V = 3.912/β is hypersensitive in clean air.
- **Default:** 2 % of range per 1/2000 of the input range.

**Frame probe.** A whole simulated run: frostford d100 (it crosses 0 °C daily), greywall d300 and
sunspire d190. Each runs 6 game days at 30 fps on a 240 s day (6× the default rate): 128 975 frames,
with the 625 lightning frames skipped because a flash is a legitimate discrete event.

| | largest per-frame move (% of range) |
|---|---|
| **before** | frozen 100 %, render.wetness 22.4 %, moonIlunBrightness 11.6 % (first step), moonLight 9.3 %, render.fogFar 5.3 %, albedoEff 4.8 %, giStrength 4.3 %, visibility 3.6 %, haze 2.1 %, exposure 2.0 %, hygroGrowth 1.7 %, apparentTempC 1.3 % (the first version mis-measured `hour` because it did not wrap it, so that row is left out) |
| **after** | visibilityKm 4.9 %, render.fogFar 4.1 %, render.fogNear 2.8 %, frozen 1.39 %, render.cloudShadow 1.06 % |
| **after, second difference** (a pop is a one-frame outlier, so this is the detector) | render.fogFar 1.07 %, visibilityKm 1.02 %, render.fogNear 0.74 %, render.wetness 0.37 %, render.haze 0.37 % |

Thresholds: first difference ≤2 % (fog chain ≤5–10 %), second difference ≤0.5 % (fog chain ≤1.5 %,
the Koschmieder curvature at the first trace of snow). The second-difference metric was added after
the first run, so it has no "before" number. Before the OU fix (below), the time probe measured a
frozen second difference of 1.90 % at a 0.25 h tick boundary; after the fix it is under 0.37 %.

**Handover / time-domain C1 test** (`climate_handover_test.ts`): the largest per-step velocity change
is measured at dt 0.004 h and again at dt 0.001 h. If the signal is C1 it shrinks ~4×; a kink keeps
it constant, and a jump grows it.
- Measured: storminess, cloudCover, temperatureC, windSpeedMs, pressureHPa and tower coverage all
  shrink **×4.0**.
- An intermediate run caught a jump in T (ratio 0.25). The cause was the test feeding a fixed day
  while the hour wrapped, so the test now rolls the day like Climate does.

**Totality**: 5 659 evaluations, every output finite and in range. The inputs were:
- NaN, ±∞, ±1e308, ±1e-300, 0, −0, and min/max for each input;
- all inputs set to the same special value at once;
- 4 000 random records with 5 % special values and 10 % values of ±5e5.

**Facade edge cases before** (scratch probe on the original code):
- `hour: NaN` gave `clock.hour = NaN`; `dayOfYear: NaN` gave `clock.dayOfYear = NaN`.
- `hour: 25` was clamped to 24 instead of wrapping.
- `step(1e6)` took 45.9 ms and left an OU tick backlog: the next step took 2.35 ms, for 6 more steps.
- A 1e-3 s day would have looped once per day: 1e9 iterations for `step(1e6)`. Not run, because it
  hangs.

**After:**
- `step(1e6)` takes 0.19 ms, and the next 20 steps are at worst 0.021 ms.
- A 1e-3 s day runs at 168 µs/step (16.7 game days per frame).
- All clock fields stay finite.

**Timing:** `climate.step()` went from **10.3 → 15.0 µs/step** over 10 000 steps (budget 50 µs,
asserted in `climate_edge_test.ts`).

## Changes: WorldVars (id: before → after: why)

| Equation / var | Before | After | Why |
|---|---|---|---|
| `frozen` | `1 − step(0.5, T)` (0/1) | `1 − smoothstep(−0.25, 1.25, surfaceTempC)` | A smooth frozen fraction (patchy ice first). It reads the SURFACE temperature, so frost appears on clear calm nights at an air temperature of ~2–3 °C. |
| `surfaceTempC` (new) | — | `T − 4 K·(1−cloud)(1−daylight)(1−smoothstep(0,5,wind))` | Radiative inversion: cloud returns longwave, wind mixes the surface layer. |
| `apparentTempC` | nested `select(step())` (pops 3.8 K at 10 °C, 2.2 K at 20 °C) | `T + wChill(wc−T) + wHum(hx−T)` with smoothstep weights over 5–10 °C and 20–25 °C | Continuous at the switch temperatures. Still exactly wind chill ≤5 °C and humidex ≥25 °C (the old test's `===` still holds). |
| `beaufort` | `floor((v/0.836)^(2/3)+0.5)` used as a number | `beaufortF` = `min(12, (v/0.836)^(2/3))` (continuous, for equations); `beaufort` = `floor(beaufortF+0.5)` | `beaufort` is now DISPLAY only and listed as discrete. |
| `summerness` | `0.5 + 0.5·sign(lat)·sin(…)` (48 % jump at the equator) | `hemisphere = sign(lat)·smoothstep(0, 15°, |lat|)`, `summerness = 0.5 + 0.5·hemisphere·sin(…)` | The sign is multiplied by a factor that vanishes at 0, so it is continuous. There are no thermal seasons in the deep tropics. |
| `windEffectiveMs` | `hypot(w, 0.5·max(0, g−w))` | `sqrt(mix(w², gEff², 0.25))` (RMS wind) | The old form FELL as the mean wind rose toward a fixed gust (caught by the monotonic test). The RMS of v² is monotone in both. |
| `gustEffMs` (new) | — | `max(gust, wind + 12·storminess·cloudTowering)` | Storm proximity: cumulonimbus outflow gusts. Feeds the felt wind, sway, drying and fog dispersal. |
| `fogEff` (new) | fog used raw | `fog / (1 + (windEff/7)²)` | Wind lowers fog (halved at 7 m/s). Every fog consumer uses it: aerosolTau, wetness, saturation, visibility, fogNear. Climate writes it back to `weather.fog` as the single source. |
| `wetBulbC` (new) | — | Stull (2011), held in [Td, T] (`atan` via `atan2(x,1)`) | Drives Weather's rain evaporation and snow phase. `stullWetBulbC` is the same law in TS. |
| `aerosolLoad` | `base·exp(−2.2·rain)·(1+dust)` | `base·(1+dust)`; washout moved to a Weather state | Instant washout made a light shower brighten the sun beam: `sunMul` rose with rain (caught by the monotonic test). |
| `dewDeposition` | `smoothstep(3,0.5,spread)·(1−cloud)·calm·cos-window` | `smoothstep(2,−1, surfaceTemp − Td)·cos-window·(1−smoothstep(0,12°,E))` | Dew forms where the radiatively cooled ground reaches the dew point, and the sun burns it off. The old cos window ran until 11:30 under a high sun. |
| `frostDeposit` (new) | — | `dewDeposition·frozen` | Hoar frost. It whitens `albedoEff` through a union with the snow cover (share 0.35). |
| `albedoEff` | `mix(g, 0.8, snow)·(1−0.35·wet)` | `mix(g, 0.8, 1−(1−snow)(1−0.35·frost))·(1−0.35·wet)` | Frost brightens the ground. Snow → albedo → GI / scene / dome are monotone (tested). |
| `heatShimmer` (new) | — | `smoothstep(26,40,T)·(1−smoothstep(.25,.6,RH))·sunMul·sin(h)/1.45·(1−smoothstep(1,6,wind))` | Heat haze needs hot × dry × strong sun × calm. |
| `render.haze` | `1−exp(−4/V)` | `1 − exp(−4/V)·(1 − 0.25·heatShimmer)` | Shimmer is united with the haze, so it stays <1 smoothly. |
| `airMass` | Kasten with `max(E,0)` (kinks at sunrise) | Kasten with `h = (E + hypot(E, 0.5°))/2` | Smooth horizon (air mass at E = 0: 36.5 → 33.7). |
| `render.exposure`, `render.fogFar`, `visibilityKm`, `render.turbidity`, `render.windSway` | hard clamp at the cap the sim actually reaches | `kneeCap(x, cap, k) = min(x,cap) − max(0, k−|x−cap|)²/4k` (C1, exactly x below cap−k, exactly cap above cap+k); caps 1.6 / 6000 m / 80 km / 10 / 1 | The second-difference probe showed the fog wall "stopping dead" at 6 km. Values are unchanged outside the knee. |
| `precipKind` (new) | — | `select(step(0.02, rain+snow), 1 + step(rain, snow), 0)` | A 0/1/2 display or event code: discrete by definition. It keeps `step`/`select` legitimately in use. |
| inputs | missing → def, else clamp | NaN → def; `hour` and `dayOfYear` are **periodic** (wrap mod 24 / 365); ±∞ clamps (`sanitizeInput`, `PERIODIC_INPUTS`) | Totality. `dayOfYear` range is now 0.5..365.5 (fractional). |
| ranges | T −45..50, wind 0..40, gust 0..60 | T −60..55, wind 0..60, gust 0..80 (derived ranges widened to match: e_s ≤170 hPa, Tv ≤360 K, ρ 0.85..1.8, windchill ≥−120, humidex ≤140, …) | The requested extremes are inside the table, not clamped away. |

Ops still in use: all 26 (coverage test green). The discrete ops are now used only where that is
legitimate:
- `floor`: the `beaufort` display value.
- `step` / `select`: the `precipKind` code.
- `sign`: multiplied by a factor that vanishes at the switch.
- `mod` / `fract`: periodic phases (`seasonPhase` is compared circularly by the probe).

Table size: 92 vars (25 inputs), 67 equations, 140 coefficients.

New coefficients: freezeBandC, apparentBandC, radCoolMaxC, radCoolCalmMs, hemiBandDeg, fogLiftMs,
outflowGustMs, stullA–F, dewBurnDeg, frostAlbedoShare, shimmerLoC/HiC/CalmMs/Haze, precipMin,
fogFarCapM/KneeM, visCapKm/KneeKm, exposureCap/Knee, turbidityCap/Knee, swayKnee, horizonSoftDeg.
Removed: `washout` (now `WASHOUT` in Weather).

## Changes: Weather, TimeWarp, Moons, RealClimate, Calendar, Climate

- **Handover**:
  - **Blend:** `smoothstep` → `handoverBlend` = smootherstep (C2). Acceleration at the ends went
    from 6.0 → 0.006 (numeric).
  - **Pair durations (exported in `HANDOVER_PAIR_H`, read through `handoverHours(a,b)`):**
    building→lull 0.12, lull→storm 0.18, storm→clearing 0.45, clearing→fair 0.5, clearing→clear
    0.55, fair→overcast 0.5, overcast→fair 0.45, clear→fair 0.35, fair→clear 0.4, *→building 0.25,
    building→overcast 0.35, overcast→clearing 0.35, clear→overcast 0.5 game h. Default `HANDOVER_H`
    is 0.3.
  - **Kept short for G18:** mean clearing visit 1.33 → 1.55 h, still below lull (2.08) and storm
    (3.70).
  - **Coverage:** a test asserts that every transition the Markov chain can take has a declared
    pair, and that 21 observed handovers lasted exactly their declared time (±2 dt).
- **OU anomalies**:
  - **Before:** one `damp` toward a piecewise-constant target redrawn every 0.25 h. That is C0, so
    the temperature kinked every 15 game minutes (and frozen twitched at the tick boundaries).
  - **After:** a critically damped **two-stage** filter integrated **exactly** between ticks:
    `x1 = u + d1 e^−Lt`, `x2 = u + (d2 + L t d1) e^−Lt`. The output is C1 and still frame-step
    independent (the existing dt 0.05 vs 0.2 test passes).
  - The tick backlog (10 000 ticks per step) is gone.
- **Couplings**:
  - **`rainEvaporation`:** precipitation moves the air 0.3·intensity of the way to its wet bulb, so
    T drops AND the dew point rises (RH = e_s(Td')/e_s(T')).
  - **Snow phase:** follows the wet bulb (`smoothstep(1.5, −0.5, Tw)`).
  - **Fog burn-off:** depends on the **sun's elevation** (`fogBurnOff(sunElevationDeg(…), cloud)`),
    not on the hour. At frostford, December noon is 3.56° with burn 0.003, so the fog persists; a June
    02:00 sun at −0.36° does not burn fog either.
  - **Radiation-fog RH band:** 0.96 → 0.93..1. The old band let a 0.001 RH wobble swing the fog 4 %.
  - **Aerosol washout as a state:** `dL/dt = (L_season−L)/18 h − 1.5/h·precip·L`, exact per step.
    Measured at sunspire d200: 0.341 → 0.018 after a 3 h storm, 0.110 after +6 h clear, 0.316 after
    +46 h.
- **Smooth floors and caps**:
  - Wind = `softFloor(x, 0.5)`, so calm air reads ~0.25 m/s instead of a kinked 0.
  - RH eases into saturation with `softCap(RH, 1, 0.03)`.
  - Normals and sunrise are read at the **fractional day** (`doy + hour/24`), so nothing steps at
    midnight.
- **Totality**:
  - dt that is NaN, negative or ±∞ → 0.
  - dt above `MAX_STEP_H` = 72 game h is simulated as 72 h (a time skip).
  - Clock and latitude NaN → last valid value; latitude is clamped to ±90.
- **TimeWarp**:
  - Whole days are advanced at once (`floor(s)`), never one loop per day.
  - `splitHour` wraps the hour with a day carry: −1 → previous day 23:00; 25 → next day 01:00;
    24 → next day 00:00 (it used to be the same day's 00:00).
  - `sanitizeDayLength`: ≤0 or non-finite → 0 (frozen); 0 < x < 1e-3 → 1e-3 (`MIN_DAY_LENGTH_S`).
  - NaN `setBlueSky` / `setLatitude` are ignored.
- **Moons**:
  - The sun's ecliptic longitude uses the fractional day `doy + (hour−12)/24`: exact at noon, and the
    moon no longer steps ~1° at midnight.
  - Non-finite inputs fall back to neutral values.
- **Calendar / RealClimate**: a non-finite day → day 1, a non-finite year → 0, a non-finite hour →
  midnight.
- **Climate**:
  - Options are sanitised.
  - The world sees `dayOfYear = doy + (hour−12)/24`.
  - `weather.fog` = `vars.fogEff`.
  - The initial compute runs twice, so the moons see this frame's aerosol depth (this removed the
    11.6 % first-step pop).

## Coupling results (all from `climate_couplings_test.ts`; monotone over 6 seeded bases each)

- **Rain** lowers render.sunMul and visibility and raises wetness and rain streaks. The clear-air
  beam (sunTransmittance) is unchanged by rain itself.
- **Wind** lowers fogEff; it raises visibility in fog, sway, drying rate and felt wind. Gusts raise
  the felt wind.
- **Colder** means more frozen. On a clear calm night at +2 °C air, the surface is more than 3 K
  colder, frozen is above 0.95 and frost above 0.3. Cloud and wind raise the surface temperature and
  lower the dew.
- **Snow cover** raises albedoEff, giStrength, sceneLuminance and ambientMul, and lowers
  render.exposure (eye adaptation to a brighter scene). This was checked at sun elevations of 10° and
  45°.
- **Storminess** (with towers) raises gustEffMs and the felt wind, and darkens the dome.
- **Heat shimmer** rises with T and falls with RH, wind and cloud. It is 0 at night and raises haze.
  At 38 °C, 15 % RH, 1 m/s wind and a 60° sun, shimmer is above 0.4.
- **Pinned regimes** at greywall d200 15:00: P clear 1021.0 > fair 1018.0 > building 1013.0 > lull
  1011.0 > storm 1008.0 hPa; gust fair 6.6 vs storm 22.7 m/s; T fair 29.3 vs storm 23.5 °C (more
  humid). The storm-to-pressure link was already in the regime profiles; it is now asserted.
- **Wind** speeds the cloud drift (`layerDriftSpeedMs`, shear law); higher layers are faster.

## Exports (all have live internal callers; the parent need not call anything new)

- **New, optional for the events module:**
  - `handoverHours`, `HANDOVER_PAIR_H`, `handoverBlend`.
  - The vars `frostDeposit`, `heatShimmer`, `wetBulbC`, `surfaceTempC`, `fogEff`, `gustEffMs`,
    `beaufortF`, `precipKind` (0/1/2), `hemisphere`.
  - `src/world/events/WorldEvents.ts` already reads `frozen`, `dewDeposition` and `weather.fog`.
    These are compatible: `frozen` is now a smooth 0..1 fraction.
- **Internal helpers**, exported for the tests: `rainEvaporation`, `sunElevationDeg`, `fogBurnOff`,
  `layerDriftSpeedMs`, `softFloor`, `softCap`, `WASHOUT`, `MAX_STEP_H`, `RAIN_COOL_SHARE`,
  `WIND_FLOOR_EPS`, `RH_KNEE`, `stullWetBulbC`, `sanitizeInput`, `PERIODIC_INPUTS`,
  `sanitizeDayLength`, `splitHour`, `MIN_DAY_LENGTH_S`.

## Behaviour changes the parent should know

- **`vars.dayOfYear` is now fractional** (doy + (hour−12)/24). `clock.dayOfYear` is still the integer
  day.
- **Bluer skies after storms:** washout is now a state, so the air stays clean after rain. Sunspire
  d200 turbidity median 2.97 → 2.27 and haze median 0.10 → 0.07. Greywall d15 turbidity median 3.10
  → 2.24.
- **`weather.fog` is now wind-dispersed** (`fogEff`).
- **Calm wind reads ~0.25 m/s**, never 0.
- **`setClock(d, 24)`** goes to the next day's 00:00.
- **Snow lowers `render.exposure`.** The brief said snow "raises GI and exposure". GI and scene
  brightness do rise, but the exposure *multiplier* falls, because the eye adapts to the brighter
  scene. Flip it in the engine if a brighter-looking snow scene is wanted.
- **The moon's position** changed slightly with the fractional ecliptic longitude. The moons test's
  Vesh horizon R/B probe moved 7.10 → 11.17 (different probe sample); its illumination-vs-elongation
  error is 0.053 (was 0.052).

## Honest gaps

- **`setPlace` is a teleport.** T, RH, wind and pressure jump to the new place's values at once.
  Clouds stay damped. A handover in flight continues on schedule (tested), but the thermodynamics
  are not blended.
- **`pinRegime` snaps on purpose** (a QA tool, and the existing tests rely on it). Releasing the pin
  is pop-free (tested).
- **Lightning is intentionally discrete**, and the frame probe skips lightning frames.
- **`TimeWarp.setBlueSky` is still quantised to 0.1.** The hour stays continuous, but
  `hoursPerSecond` steps by a few % when the table rebuilds. Not addressed.
- **The tolerances are declared, not derived from perception.** The steep-but-continuous outputs
  above have per-output exceptions with written reasons. The Koschmieder fog chain is the steepest
  (the first trace of snow in clean air moves the fog wall ~4 % of its range per frame at 6× clock
  speed).
- **Storm cooling may double-count.** Rain evaporation is added on top of the regime profiles' dT,
  which already encode storm outflow cooling. The 30-day climatology still passes: means +0.2 to
  +1.0 °C vs the normals, as before.
- **The Stull wet-bulb fit is approximate outside its validity box** (T < −20 °C, RH < 5 %). There it
  is held between Td and T. The wet bulb is conserved by the evaporation step only to within 0.6 K.
- **No before numbers** for the second-difference metric, or for the facade edge cases beyond the
  four probed above. The 1e9-iteration day loop was inferred from the code, not run.
- **Not run:** the whole suite, `deno task check`, the build, and an Engine type-check. Only the
  climate files and tests were checked, per the house rules. Exported names, signatures and the
  coefficient and var ids the engine reads are unchanged.
