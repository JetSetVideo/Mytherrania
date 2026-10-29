// World variables (G16 G17): ONE table of every world variable at the top of this file, the named
// coefficients, the equations that tie them together (using every EXPR_OPS operator), and the
// evaluator. Pure: no THREE, no DOM.
//
// Sources: "real"    = generated from real-world climate (RealClimate -> Weather);
//          "input"   = clock / place / sky geometry (Calendar, TimeWarp, Environment, Moons);
//          "derived" = written by exactly one equation below.
// Every derived value is clamped to its declared [min, max]; a missing or NaN input takes its
// `def`, +-Infinity clamps to the bound, and the PERIODIC inputs (hour, dayOfYear) wrap instead of
// clamping, so the table is TOTAL: any input record gives finite, in-range outputs.
// The equation graph is topologically sorted at module load (a cycle throws, naming it).
//
// Lane E (continuity): no continuous quantity goes through step/floor/select/sign any more — those
// ops remain only where the output is legitimately discrete (beaufort, precipKind: display codes)
// or where the discrete factor is multiplied by something that vanishes at the switch (the
// hemisphere factor sign(lat) * smoothstep(0, band, |lat|)). Regime-like switches (frozen, felt
// temperature) are smooth fractions over a declared band. tests/climate_continuity_test.ts sweeps
// every input and bisects every large move to prove it.

import type { Expr, WorldEquation, WorldVarDef } from "./contracts.ts";
import { compileExpr, type CompiledExpr, exprRefs, X } from "./Expr.ts";
import { clamp } from "../../core/MathCore.ts";

const real = (id: string, unit: string, min: number, max: number, def: number, note: string): WorldVarDef =>
  ({ id, source: "real", unit, min, max, def, note });
const input = (id: string, unit: string, min: number, max: number, def: number, note: string): WorldVarDef =>
  ({ id, source: "input", unit, min, max, def, note });
const derived = (id: string, unit: string, min: number, max: number, def: number, note: string): WorldVarDef =>
  ({ id, source: "derived", unit, min, max, def, note });

/** Every world variable. */
export const WORLD_VARS: readonly WorldVarDef[] = [
  // ---- real-world weather (RealClimate normals + Weather anomalies/regimes)
  real("temperatureC", "degC", -60, 55, 15, "air temperature at 2 m"),
  real("relativeHumidity", "0..1", 0.02, 1, 0.6, "relative humidity"),
  real("pressureHPa", "hPa", 940, 1060, 1013.25, "mean-sea-level pressure"),
  real("windSpeedMs", "m/s", 0, 60, 3, "10 m mean wind speed"),
  real("gustMs", "m/s", 0, 80, 5, "10 m gust speed"),
  real("rain", "0..1", 0, 1, 0, "rain intensity"),
  real("snow", "0..1", 0, 1, 0, "snowfall intensity"),
  real("fog", "0..1", 0, 1, 0, "ground fog / mist density"),
  real("cloudLow", "0..1", 0, 1, 0.2, "low layer coverage (cumulus/stratus)"),
  real("cloudMid", "0..1", 0, 1, 0.1, "mid layer coverage (altocumulus/altostratus)"),
  real("cloudHigh", "0..1", 0, 1, 0.1, "high layer coverage (cirrus/cirrocumulus)"),
  real("cloudTowering", "0..1", 0, 1, 0, "towering layer coverage (cumulonimbus)"),
  real("storminess", "0..1", 0, 1, 0, "continuous position in the storm cycle"),
  real("lightning", "0..1", 0, 1, 0, "current lightning flash brightness"),
  real("aerosolBase", "0..1", 0, 1, 0.3, "aerosol load of the place/season after rain washout (Weather state: scavenged by rain, recovers over ~18 h)"),
  real("snowCover", "0..1", 0, 1, 0, "ground snow cover"),
  // ---- clock / place / sky geometry
  input("hour", "h", 0, 24, 12, "local solar hour (PERIODIC: wraps mod 24)"),
  input("dayOfYear", "day", 0.5, 365.5, 172, "fractional day of year, noon = integer (PERIODIC: wraps mod 365; drives declination)"),
  input("latitude", "deg", -90, 90, 48, "place latitude, + north"),
  input("sunElevationDeg", "deg", -90, 90, 45, "sun elevation above the horizon"),
  input("moonIlunBrightness", "0..1", 0, 1, 0, "Ilun light: illumination x extinction x above horizon"),
  input("moonVeshBrightness", "0..1", 0, 1, 0, "Vesh light: illumination x extinction x above horizon"),
  input("moonIlunIllumination", "0..1", 0, 1, 0.5, "Ilun lit fraction (phase)"),
  input("moonVeshIllumination", "0..1", 0, 1, 0.5, "Vesh lit fraction (phase)"),
  input("groundAlbedo", "0..1", 0.05, 0.6, 0.2, "snow-free ground albedo of the place"),
  // ---- derived physics
  derived("tempK", "K", 213, 329, 288, "absolute temperature"),
  derived("satVapourHPa", "hPa", 0, 170, 17, "saturation vapour pressure (Magnus)"),
  derived("vapourHPa", "hPa", 0, 170, 10, "actual vapour pressure"),
  derived("magnusGamma", "1", -25, 3, 0, "Magnus gamma = ln(RH) + aT/(b+T)"),
  derived("dewPointC", "degC", -90, 55, 8, "dew point (inverse Magnus)"),
  derived("dewSpreadC", "K", 0, 100, 7, "temperature - dew point"),
  derived("wetBulbC", "degC", -90, 55, 10, "psychrometric wet-bulb (Stull 2011), held in [dew point, T]"),
  derived("cloudBaseM", "m", 0, 4000, 900, "lifting condensation level ~ 125 m/K x spread"),
  derived("virtualTempK", "K", 213, 360, 289, "virtual temperature (moist air buoyancy)"),
  derived("airDensity", "kg/m3", 0.85, 1.8, 1.22, "ideal gas: p / (R_d T_v)"),
  derived("absoluteHumidity", "g/m3", 0, 120, 9, "water vapour density e / (R_v T)"),
  derived("gustEffMs", "m/s", 0, 90, 5, "gust incl. cumulonimbus outflow: max(gust, wind + k storm towers)"),
  derived("windEffectiveMs", "m/s", 0, 90, 3, "RMS wind: sqrt((1 - k^2) v^2 + k^2 gust^2)"),
  derived("dynamicPressurePa", "Pa", 0, 8000, 6, "q = rho v^2 / 2 (force on foliage)"),
  derived("beaufortF", "B", 0, 12, 2, "continuous Beaufort number B = (v/0.836)^(2/3) (for equations)"),
  derived("beaufort", "B", 0, 12, 2, "Beaufort force, rounded (DISPLAY only: discrete)"),
  derived("windChillC", "degC", -120, 55, 15, "Environment Canada wind chill"),
  derived("humidexC", "degC", -60, 140, 15, "humidex T + 5/9 (e - 10)"),
  derived("apparentTempC", "degC", -120, 140, 15, "felt temperature: smooth blend wind chill / air / humidex"),
  derived("surfaceTempC", "degC", -70, 55, 15, "ground surface: air minus clear-calm-night radiative cooling"),
  derived("frozen", "0..1", 0, 1, 0, "frozen fraction of the surface (smooth over a 1.5 K band)"),
  derived("declinationDeg", "deg", -23.5, 23.5, 0, "solar declination (same law as Environment)"),
  derived("seasonPhase", "0..1", 0, 1, 0, "fraction of the year since the spring equinox"),
  derived("hemisphere", "-1..1", -1, 1, 1, "smooth hemisphere sign: 0 at the equator (no thermal seasons)"),
  derived("summerness", "0..1", 0, 1, 0.5, "0 midwinter .. 1 midsummer for this hemisphere"),
  derived("dayLengthHours", "h", 0, 24, 12, "sunrise equation: cos w0 = -tan(lat) tan(decl)"),
  derived("noonElevationDeg", "deg", -90, 90, 50, "90 - |lat - decl|"),
  derived("sunAltRad", "rad", -1.5708, 1.5708, 0.785, "sun elevation in radians"),
  derived("daylight", "0..1", 0, 1, 1, "civil daylight factor"),
  derived("golden", "0..1", 0, 1, 0, "golden/blue hour factor"),
  derived("airMass", "1", 1, 40, 1.4, "Kasten-Young relative optical air mass"),
  derived("fogEff", "0..1", 0, 1, 0, "fog after wind dispersal: fog / (1 + (u / u_lift)^2)"),
  derived("aerosolLoad", "0..1.6", 0, 1.6, 0.3, "aerosol incl. wind-lifted dust"),
  derived("hygroGrowth", "1", 1, 3, 1.2, "Hanel hygroscopic growth (1-RH)^-gamma"),
  derived("aerosolTau", "1", 0, 6, 0.1, "aerosol (+fog) optical depth at 550 nm"),
  derived("rayleighShare", "0..1", 0, 1, 0.5, "Rayleigh share of the total scattering optical depth"),
  derived("sunTransmittance", "0..1", 0, 1, 0.8, "Beer-Lambert direct-beam transmittance at 550 nm"),
  derived("sunWarmth", "0..1", 0, 1, 0, "1 - T_blue / T_red: sunset reddening from lambda^-4"),
  derived("cloudCover", "0..1", 0, 1, 0.3, "union of the layers: 1 - prod(1 - c_i)"),
  derived("cloudOpticalDepth", "1", 0, 12, 0.5, "sum of layer coverage x layer optical depth"),
  derived("sunOcclusion", "0..1", 0, 1, 0.3, "1 - exp(-cloud optical depth)"),
  derived("moonLight", "0..1", 0, 1, 0, "combined moonlight of Ilun and Vesh"),
  derived("albedoEff", "0..1", 0, 0.9, 0.2, "ground albedo with snow, darkened when wet"),
  derived("dewDeposition", "0..1", 0, 1, 0, "dew/frost on calm clear nights near dawn"),
  derived("frostDeposit", "0..1", 0, 1, 0, "hoar frost: the frozen share of the deposition"),
  derived("dryingRate", "1", 0, 20, 1, "evaporation ~ (e_s - e)(1 + k u) x sun"),
  derived("sceneLuminance", "rel", 0.0001, 4, 1, "relative scene luminance"),
  derived("sceneEv", "EV", -14, 2.1, 0, "log2 scene luminance"),
  derived("visibilityKm", "km", 0.03, 80, 30, "Koschmieder V = 3.912 / beta_ext"),
  derived("tideRangeM", "m", 0, 6, 1.5, "spring/neap tide range from both moons' phases"),
  derived("heatShimmer", "0..1", 0, 1, 0, "heat haze: hot x dry x strong sun x calm"),
  derived("precipKind", "code", 0, 2, 0, "0 dry, 1 rain, 2 snow (DISPLAY/event code: discrete)"),
  // ---- render variables read by the parent (RENDER_VARS; ranges from the contract)
  derived("render.exposure", "x", 0.6, 1.6, 1, "scene exposure multiplier (eye adaptation)"),
  derived("render.saturation", "x", 0, 1.6, 1, "colour saturation multiplier"),
  derived("render.haze", "0..1", 0, 1, 0.1, "aerial-perspective strength"),
  derived("render.fogNear", "m", 0, 3000, 300, "distance where aerial fog starts"),
  derived("render.fogFar", "m", 40, 6000, 2000, "distance where aerial fog is total"),
  derived("render.sunMul", "x", 0, 1.5, 1, "direct sunlight multiplier"),
  derived("render.ambientMul", "x", 0.3, 2, 1, "sky/ambient light multiplier"),
  derived("render.wetness", "0..1", 0, 1, 0, "wet ground (SSR strength)"),
  derived("render.windSway", "0..1", 0, 1, 0.2, "vegetation sway amplitude"),
  derived("render.cloudShadow", "0..1", 0, 1, 0.2, "cloud-shadow strength on the ground"),
  derived("render.giStrength", "x", 0, 1.5, 0.6, "indirect-bounce strength"),
  derived("render.turbidity", "1", 1, 10, 2.5, "sky turbidity (Linke): Rayleigh -> Mie"),
  derived("render.starVisibility", "0..1", 0, 1, 0, "star visibility"),
  derived("render.rainStreaks", "0..1", 0, 1, 0, "rain streak strength"),
  derived("render.lightning", "0..1", 0, 1, 0, "flash brightness this frame"),
];

/** Named coefficients (each referenced by at least one equation). */
export const WORLD_COEFFICIENTS: Readonly<Record<string, number>> = {
  // thermodynamics
  kelvin: 273.15,          // 0 degC in K
  magnusA: 17.625,         // Magnus (Alduchov & Eskridge 1996) a
  magnusB: 243.04,         // Magnus b, degC
  magnusE0: 6.1094,        // Magnus saturation vapour pressure at 0 degC, hPa
  lclMPerK: 125,           // lifting condensation level: ~125 m per K of dew-point spread (Espy)
  rDry: 287.05,            // specific gas constant of dry air, J/(kg K)
  rVapour: 461.5,          // specific gas constant of water vapour, J/(kg K)
  epsilon: 0.622,          // R_d / R_v
  // wind
  gustWeight: 0.5,         // gusts carry k^2 = 25 % of the felt dynamic pressure (RMS wind)
  beaufortK: 0.836,        // Beaufort scale: v = 0.836 B^(3/2) m/s
  swayRefPa: 138,          // dynamic pressure of a 15 m/s wind at rho 1.225 -> full sway
  wcA: 13.12, wcB: 0.6215, wcC: 11.37, wcD: 0.3965, wcExp: 0.16, // wind chill (km/h form)
  msToKmh: 3.6,            // m/s -> km/h
  windChillMaxC: 10,       // wind chill defined at or below 10 degC
  humidexK: 0.5555,        // humidex 5/9 per hPa above 10 hPa
  humidexMinC: 20,         // humidex used at or above 20 degC
  freezeC: 0.5,            // surface freezes below ~0.5 degC (centre of the freezing band)
  freezeBandC: 1.5,        // frozen fraction ramps over 1.5 K of SURFACE temperature (patchy ice, no pop)
  apparentBandC: 5,        // felt temperature blends over 5 K below windChillMaxC / above humidexMinC
  radCoolMaxC: 4,          // clear, calm night: the ground radiates ~4 K below the air (inversion)
  radCoolCalmMs: 5,        // wind above ~5 m/s mixes the surface layer: no radiative inversion
  hemiBandDeg: 15,         // seasons fade out within 15 deg of the equator (no thermal seasons there)
  fogLiftMs: 7,            // fog halves at 7 m/s of effective wind: turbulence lifts it into stratus
  outflowGustMs: 12,       // cumulonimbus downdraft outflow adds up to ~12 m/s to the gusts
  // Stull (2011) wet-bulb fit, RH in %: Tw = T atan(a (RH + b)^1/2) + atan(T + RH) - atan(RH - c)
  //   + d RH^3/2 atan(e RH) - f
  stullA: 0.151977, stullB: 8.313659, stullC: 1.676331, stullD: 0.00391838, stullE: 0.023101, stullF: 4.686035,
  // astronomy (same as Environment.solarPosition)
  obliquityDeg: 23.44,     // axial tilt
  declOffsetDay: 284,      // declination phase offset (Cooper 1969)
  daysPerYear: 365,        // Mytherrania year length
  springEquinoxDay: 79,    // northern spring equinox day of year
  degToRad: Math.PI / 180, // degrees -> radians
  radToDeg: 180 / Math.PI, // radians -> degrees
  twoPi: 2 * Math.PI,      // full turn
  degPerHour: 15,          // Earth-like rotation: 15 deg per hour
  kastenA: 0.15, kastenB: 3.885, kastenC: -1.253, // Kasten (1966) air mass: 1/(sin h + a (h+b)^c)
  // optics
  rayleighTau550: 0.097,   // Rayleigh vertical optical depth at 550 nm (sea level)
  lambdaRefNm: 550,        // reference wavelength
  lambdaBlueNm: 450,       // blue channel wavelength
  lambdaRedNm: 650,        // red channel wavelength
  angstrom: 1.3,           // Angstrom exponent of continental aerosol, tau ~ lambda^-1.3
  aerosolTauRef: 0.25,     // aerosol optical depth at aerosol load 1, dry air
  hanelGamma: 0.3,         // Hanel growth exponent: tau ~ (1 - RH)^-gamma
  dustLift: 0.6,           // extra dust lifted by strong dry wind
  dustWindMs: 7,           // dust lift starts at ~7 m/s (saltation threshold region)
  fogTau: 2.0,             // fog optical depth contribution at fog 1
  waterVapourTau: 0.004,   // turbidity contribution per g/m3 of water vapour
  koschmieder: 3.912,      // -ln(0.02): contrast threshold 2 %
  betaRayleighKm: 0.0116,  // clear-air Rayleigh extinction at 550 nm, 1/km
  aerosolScaleKm: 1.5,     // aerosol scale height, km (beta = tau / H)
  betaFogKm: 39,           // fog 1 -> ~100 m visibility
  betaRainKm: 2.2,         // heavy rain -> ~1.5 km
  betaSnowKm: 12,          // heavy snow -> ~300 m
  hazeRefKm: 4,            // haze = 1 - exp(-4 km / V)
  // clouds: effective sun-occluding optical depth per layer at full coverage (a mean over the
  // sun being behind / between clouds; ordered like CLOUD_SHAPES thickness)
  tauLow: 1.5, tauMid: 0.9, tauHigh: 0.15, tauTower: 3.5,
  shadowLow: 0.85, shadowMid: 0.45, shadowHigh: 0.12, shadowTower: 1.0, // cloud-shadow contrast per layer
  overcastShadowLo: 0.82,  // above this union cover the light is diffuse: no distinct shadows
  // light
  sunPeak: 1.45,           // sunMul at zenith before extinction
  rainDim: 0.35,           // rain curtain dims the sun beam
  sunLumWeight: 0.7,       // share of scene luminance from the direct sun
  skyLumWeight: 0.35,      // share from the sky dome
  stormDarkening: 0.55,    // storm bases darken the sky dome
  moonLumWeight: 0.02,     // full moonlight ~ 1/400 of daylight on the log scale
  starlightFloor: 0.002,   // starlight + airglow
  flashLum: 0.8,           // lightning flash luminance
  ilunLight: 0.8, veshLight: 0.35, // relative light of the two moons (size x albedo)
  exposureSlope: 0.09,     // exposure change per EV (partial adaptation)
  albedoLumBase: 0.84,     // luminance factor of a black ground (0.84 + 0.8 x 0.2 albedo = 1)
  albedoLumGain: 0.8,      // bright ground raises scene luminance
  satNight: 0.35,          // Purkinje: scotopic vision desaturates
  satBase: 0.72, satSky: 0.5, satFogLoss: 0.55, satRainLoss: 0.3, satGolden: 0.35,
  satSeasonLo: 0.85,       // winter palettes are 15 % greyer
  ambNight: 0.32, ambDay: 0.75, ambCloudGain: 0.35, ambStormLoss: 0.45, ambMoon: 0.25,
  ambFlash: 0.9, ambAlbedoGain: 0.4,
  snowAlbedo: 0.8,         // fresh snow albedo
  wetDarken: 0.35,         // wet surfaces lose ~1/3 of albedo
  rainWet: 1.3, fogWet: 0.25, meltWet: 0.4, iceWet: 0.5, // wetness gains
  dryRate: 0.06,           // drying per hPa of vapour-pressure deficit
  windDry: 0.15,           // Dalton: evaporation ~ (1 + k u)
  dryBase: 0.4,            // drying at night relative to full sun
  dewPeakHour: 5.5,        // dew deposition peaks just before sunrise
  dewBurnDeg: 12,          // the sun burns dew/frost off as it climbs to ~12 deg
  frostAlbedoShare: 0.35,  // hoar frost whitens ~1/3 as much as a snow cover
  giSun: 0.6, giSky: 0.25, giRefAlbedo: 0.2, giAlbedoExp: 0.7,
  moonWashout: 0.7,        // bright moonlight hides faint stars
  streakBase: 0.6,         // rain streaks visible without wind
  flashBase: 0.6, flashDaySuppress: 0.7,
  fogFarFrac: 0.3,         // fogFar = 30 % of meteorological visibility (game scale)
  // soft caps (C1 quadratic knee of half-width k around the cap, see kneeCap): an output that the
  // sim actually drives into its bound must not kink there (velocity jump = a visible "stop")
  fogFarCapM: 6000, fogFarKneeM: 1000, // fog wall never beyond 6 km
  visCapKm: 80, visKneeKm: 10,         // meteorological visibility tops out at 80 km
  exposureCap: 1.6, exposureKnee: 0.1, // contract maximum of render.exposure
  turbidityCap: 10, turbidityKnee: 1,  // contract maximum of render.turbidity
  swayKnee: 0.15,                      // render.windSway approaches 1 smoothly
  horizonSoftDeg: 0.5,     // air mass: elevation floored at the horizon by a smooth max (no kink at sunrise)
  fogNearClear: 0.35, fogNearFog: 0.02,
  tideBase: 0.4, tideIlun: 1.6, tideVesh: 0.7, // tide range, m
  shimmerLoC: 26, shimmerHiC: 40, // heat shimmer grows from 26 to 40 degC air temperature
  shimmerCalmMs: 6,        // wind above ~6 m/s mixes the superadiabatic surface layer away
  shimmerHaze: 0.25,       // heat shimmer's share of render.haze
  precipMin: 0.02,         // precipitation below this reads as dry (display code)
};

const { v, c, add, sub, mul, div, mod, pow, neg, abs, sign, min, max, clamp: cl, sqrt, exp, log, sin, cos, tan, atan2, floor, fract, hypot, mix, step, smoothstep, select } = X;
const T = v("temperatureC"), RH = v("relativeHumidity"), E = v("sunElevationDeg");
const eq = (id: string, out: string, expr: Expr, why: string): WorldEquation => ({ id, out, expr, why });
/**
 * C1 soft upper cap: x below cap - k, EXACTLY cap above cap + k, a quadratic knee between
 *   min(x, cap) - max(0, k - |x - cap|)^2 / 4k
 * (value and slope continuous at both knee ends; slope 1 -> 0). Replaces a hard min/clamp where
 * the simulation really reaches the bound, so the output eases into it instead of stopping dead.
 */
const kneeCap = (x: Expr, cap: Expr, k: Expr): Expr =>
  sub(min(x, cap), div(pow(max(0, sub(k, abs(sub(x, cap)))), 2), mul(4, k)));
/** Smooth max(x, 0): (x + hypot(x, eps)) / 2 — C-infinity, within eps/2 of max(x, 0). */
const softPos = (x: Expr, eps: Expr): Expr => mul(0.5, add(x, hypot(x, eps)));
/** Optical depth at wavelength `lam` from a 550 nm depth: tau * (550 / lam)^k. */
const atLambda = (tau550: Expr, lamC: string, k: Expr) => mul(tau550, pow(div(c("lambdaRefNm"), c(lamC)), k));

/** The equations (each derived variable has exactly one). */
export const WORLD_EQUATIONS: readonly WorldEquation[] = [
  // ---- thermodynamics
  eq("tempK", "tempK", add(T, c("kelvin")), "Kelvin scale for the gas laws"),
  eq("satVapour", "satVapourHPa", mul(c("magnusE0"), exp(div(mul(c("magnusA"), T), add(c("magnusB"), T)))),
    "Magnus formula: e_s = 6.1094 exp(17.625 T / (243.04 + T))"),
  eq("vapour", "vapourHPa", mul(RH, v("satVapourHPa")), "RH is e / e_s"),
  eq("magnusGamma", "magnusGamma", add(log(RH), div(mul(c("magnusA"), T), add(c("magnusB"), T))),
    "inverse Magnus intermediate gamma = ln RH + aT/(b+T)"),
  eq("dewPoint", "dewPointC", div(mul(c("magnusB"), v("magnusGamma")), sub(c("magnusA"), v("magnusGamma"))),
    "inverse Magnus: Td = b gamma / (a - gamma)"),
  eq("dewSpread", "dewSpreadC", max(0, sub(T, v("dewPointC"))), "dew-point depression drives cloud base, dew and haze"),
  eq("wetBulb", "wetBulbC", (() => {
    const rh = mul(RH, 100);
    const atan = (x: Expr) => atan2(x, 1);
    const stull = add(
      mul(T, atan(mul(c("stullA"), sqrt(add(rh, c("stullB")))))), atan(add(T, rh)), neg(atan(sub(rh, c("stullC")))),
      mul(c("stullD"), pow(rh, 1.5), atan(mul(c("stullE"), rh))), neg(c("stullF")));
    return cl(stull, v("dewPointC"), T); // the fit leaves its validity box at the extremes: Td <= Tw <= T always
  })(), "Stull (2011) wet bulb: evaporating rain cools the air toward it (Weather applies it), snow below ~0.5 C Tw"),
  eq("cloudBase", "cloudBaseM", mul(c("lclMPerK"), v("dewSpreadC")), "Espy: LCL rises ~125 m per K of dew-point spread"),
  eq("virtualTemp", "virtualTempK",
    div(v("tempK"), sub(1, mul(div(v("vapourHPa"), v("pressureHPa")), sub(1, c("epsilon"))))),
    "virtual temperature Tv = T / (1 - (e/p)(1 - eps)): moist air is lighter"),
  eq("airDensity", "airDensity", div(mul(v("pressureHPa"), 100), mul(c("rDry"), v("virtualTempK"))),
    "ideal gas law rho = p / (R_d Tv)"),
  eq("absoluteHumidity", "absoluteHumidity", mul(div(mul(v("vapourHPa"), 100), mul(c("rVapour"), v("tempK"))), 1000),
    "water vapour density e / (R_v T), g/m3"),
  // ---- wind
  eq("gustEff", "gustEffMs", max(v("gustMs"), add(v("windSpeedMs"), mul(c("outflowGustMs"), v("storminess"), v("cloudTowering")))),
    "storm proximity: cumulonimbus downdraft outflow gusts grow with storminess x tower cover"),
  eq("windEffective", "windEffectiveMs",
    sqrt(mix(pow(v("windSpeedMs"), 2), pow(v("gustEffMs"), 2), pow(c("gustWeight"), 2))),
    "RMS wind felt by foliage: v^2 averaged over gusts (share k^2) — monotone in both the mean wind and the gust (the old hypot(w, k(g - w)) fell as w rose)"),
  eq("dynamicPressure", "dynamicPressurePa", mul(0.5, v("airDensity"), pow(v("windEffectiveMs"), 2)),
    "dynamic pressure q = rho v^2 / 2 is the force that bends plants"),
  eq("beaufortF", "beaufortF", min(12, pow(div(v("windSpeedMs"), c("beaufortK")), 2 / 3)),
    "Beaufort empirical scale v = 0.836 B^1.5, inverted and kept continuous for equations"),
  eq("beaufort", "beaufort", floor(add(v("beaufortF"), 0.5)),
    "DISPLAY only: Beaufort force rounded to the nearest integer (discrete by definition)"),
  eq("windChill", "windChillC", (() => {
    const vk = pow(max(mul(v("windSpeedMs"), c("msToKmh")), 4.8), c("wcExp"));
    return add(c("wcA"), mul(c("wcB"), T), neg(mul(c("wcC"), vk)), mul(c("wcD"), T, vk));
  })(), "Environment Canada wind chill (T <= 10 C, V >= 4.8 km/h)"),
  eq("humidex", "humidexC", add(T, mul(c("humidexK"), sub(v("vapourHPa"), 10))), "Environment Canada humidex"),
  eq("apparentTemp", "apparentTempC", (() => {
    const wChill = sub(1, smoothstep(sub(c("windChillMaxC"), c("apparentBandC")), c("windChillMaxC"), T));
    const wHumid = smoothstep(c("humidexMinC"), add(c("humidexMinC"), c("apparentBandC")), T);
    return add(T, mul(wChill, sub(v("windChillC"), T)), mul(wHumid, sub(v("humidexC"), T)));
  })(), "felt temperature: wind chill when cold, humidex when hot, blended smoothly over 5 K so it never jumps"),
  eq("surfaceTemp", "surfaceTempC",
    sub(T, mul(c("radCoolMaxC"), sub(1, v("cloudCover")), sub(1, v("daylight")), sub(1, smoothstep(0, c("radCoolCalmMs"), v("windSpeedMs"))))),
    "clear calm nights: longwave loss cools the ground below the air (cloud returns longwave, wind mixes it away)"),
  eq("frozen", "frozen",
    sub(1, smoothstep(sub(c("freezeC"), mul(0.5, c("freezeBandC"))), add(c("freezeC"), mul(0.5, c("freezeBandC"))), v("surfaceTempC"))),
    "the surface freezes over a 1.5 K band of SURFACE temperature (patchy ice first; frost on clear nights at T_air ~ 3 C)"),
  // ---- astronomy / season
  eq("declination", "declinationDeg",
    mul(c("obliquityDeg"), sin(div(mul(c("twoPi"), add(c("declOffsetDay"), v("dayOfYear"))), c("daysPerYear")))),
    "Cooper declination, the same law as Environment.solarPosition"),
  eq("seasonPhase", "seasonPhase", div(mod(sub(v("dayOfYear"), c("springEquinoxDay")), c("daysPerYear")), c("daysPerYear")),
    "cyclic position in the year since the spring equinox"),
  eq("hemisphere", "hemisphere", mul(sign(v("latitude")), smoothstep(0, c("hemiBandDeg"), abs(v("latitude")))),
    "seasons mirror across the equator; sign() is multiplied by a factor that vanishes at 0, so no jump"),
  eq("summerness", "summerness", cl(add(0.5, mul(0.5, v("hemisphere"), sin(mul(c("twoPi"), v("seasonPhase"))))), 0, 1),
    "the seasons are mirrored in the southern hemisphere and fade out at the equator"),
  eq("dayLength", "dayLengthHours", (() => {
    const x = cl(neg(mul(tan(mul(v("latitude"), c("degToRad"))), tan(mul(v("declinationDeg"), c("degToRad"))))), -1, 1);
    const acos = atan2(sqrt(sub(1, mul(x, x))), x); // acos(x) = atan2(sqrt(1 - x^2), x)
    return div(mul(2, acos, c("radToDeg")), c("degPerHour"));
  })(), "sunrise equation cos w0 = -tan(lat) tan(decl), day = 2 w0 / 15 deg/h"),
  eq("noonElevation", "noonElevationDeg", sub(90, abs(sub(v("latitude"), v("declinationDeg")))), "solar elevation at solar noon"),
  eq("sunAltRad", "sunAltRad", mul(E, c("degToRad")), "radians for the trigonometry"),
  eq("daylight", "daylight", smoothstep(-6, 8, E), "civil twilight (-6 deg) to full daylight"),
  eq("golden", "golden", mul(smoothstep(-6, -1, E), sub(1, smoothstep(4, 12, E))), "blue + golden hour window"),
  eq("airMass", "airMass", (() => {
    const h = softPos(E, c("horizonSoftDeg")); // smooth max(E, 0): no kink as the sun crosses the horizon
    return div(1, add(sin(mul(h, c("degToRad"))), mul(c("kastenA"), pow(add(h, c("kastenB")), c("kastenC")))));
  })(), "Kasten air mass 1/(sin h + 0.15 (h + 3.885)^-1.253), h = smooth max(elevation, 0)"),
  // ---- aerosols, scattering, turbidity
  eq("fogEff", "fogEff", div(v("fog"), add(1, pow(div(v("windEffectiveMs"), c("fogLiftMs")), 2))),
    "wind lowers fog: turbulent mixing lifts it into stratus (halved at 7 m/s)"),
  eq("aerosolLoad", "aerosolLoad",
    mul(v("aerosolBase"), add(1, mul(c("dustLift"), smoothstep(c("dustWindMs"), mul(2, c("dustWindMs")), v("windSpeedMs")), sub(1, RH)))),
    "strong dry wind lifts dust (rain washout is a TIME process: Weather scavenges aerosolBase during rain, it recovers over hours)"),
  eq("hygroGrowth", "hygroGrowth", pow(max(sub(1, RH), 0.05), neg(c("hanelGamma"))),
    "Hanel: humid air swells hygroscopic aerosols, tau ~ (1 - RH)^-gamma"),
  eq("aerosolTau", "aerosolTau", add(mul(c("aerosolTauRef"), v("aerosolLoad"), v("hygroGrowth")), mul(c("fogTau"), v("fogEff"))),
    "aerosol + fog droplet optical depth at 550 nm"),
  eq("rayleighShare", "rayleighShare", div(c("rayleighTau550"), add(c("rayleighTau550"), v("aerosolTau"))),
    "blue Rayleigh sky vs white Mie sky"),
  eq("sunTransmittance", "sunTransmittance", exp(neg(mul(add(c("rayleighTau550"), v("aerosolTau")), v("airMass")))),
    "Beer-Lambert: T = exp(-tau m)"),
  eq("sunWarmth", "sunWarmth", (() => {
    const tau = (lam: string) => add(atLambda(c("rayleighTau550"), lam, 4), atLambda(v("aerosolTau"), lam, c("angstrom")));
    const tB = exp(neg(mul(tau("lambdaBlueNm"), v("airMass"))));
    const tR = exp(neg(mul(tau("lambdaRedNm"), v("airMass"))));
    return sub(1, div(tB, max(tR, 1e-6)));
  })(), "Rayleigh lambda^-4 (+ aerosol lambda^-1.3): low sun loses blue first"),
  // ---- clouds
  eq("cloudCover", "cloudCover",
    sub(1, mul(sub(1, v("cloudLow")), sub(1, v("cloudMid")), sub(1, v("cloudHigh")), sub(1, v("cloudTowering")))),
    "random-overlap union of independent layers"),
  eq("cloudOpticalDepth", "cloudOpticalDepth",
    add(mul(v("cloudLow"), c("tauLow")), mul(v("cloudMid"), c("tauMid")), mul(v("cloudHigh"), c("tauHigh")), mul(v("cloudTowering"), c("tauTower"))),
    "coverage-weighted optical depth of the layers"),
  eq("sunOcclusion", "sunOcclusion", sub(1, exp(neg(v("cloudOpticalDepth")))), "Beer-Lambert through the cloud deck"),
  eq("moonLight", "moonLight", min(1, add(mul(c("ilunLight"), v("moonIlunBrightness")), mul(c("veshLight"), v("moonVeshBrightness")))),
    "the two moons' light adds"),
  // ---- surface
  eq("dewDeposition", "dewDeposition",
    mul(smoothstep(2, -1, sub(v("surfaceTempC"), v("dewPointC"))),
      max(0, cos(mul(c("twoPi"), sub(fract(div(v("hour"), 24)), div(c("dewPeakHour"), 24))))),
      sub(1, smoothstep(0, c("dewBurnDeg"), E))),
    "dew forms where the radiatively cooled ground reaches the dew point (clear calm nights), peaks before dawn, the sun burns it off"),
  eq("frostDeposit", "frostDeposit", mul(v("dewDeposition"), v("frozen")), "below freezing the deposition is hoar frost"),
  eq("dryingRate", "dryingRate",
    mul(c("dryRate"), sub(v("satVapourHPa"), v("vapourHPa")), add(1, mul(c("windDry"), v("windEffectiveMs"))),
      add(c("dryBase"), mul(v("daylight"), max(0, sin(v("sunAltRad")))))),
    "Dalton evaporation: vapour-pressure deficit x (1 + k u), faster in sun"),
  eq("wetness", "render.wetness",
    mul(add(mul(c("rainWet"), v("rain")), mul(c("fogWet"), v("fogEff")), v("dewDeposition"), mul(c("meltWet"), v("snowCover"), sub(1, v("frozen")))),
      exp(neg(mul(v("dryingRate"), sub(1, v("rain"))))), mix(1, c("iceWet"), v("frozen"))),
    "rain/fog/dew/melt wet the ground; warm dry wind dries it; ice is half as glossy"),
  eq("albedoEff", "albedoEff",
    mul(mix(v("groundAlbedo"), c("snowAlbedo"), sub(1, mul(sub(1, v("snowCover")), sub(1, mul(c("frostAlbedoShare"), v("frostDeposit")))))),
      sub(1, mul(c("wetDarken"), v("render.wetness")))),
    "snow and hoar frost brighten (union of covers), water darkens the ground"),
  // ---- light
  eq("sunMul", "render.sunMul",
    mul(c("sunPeak"), smoothstep(-1, 3, E), v("sunTransmittance"), sub(1, v("sunOcclusion")), sub(1, mul(c("rainDim"), v("rain")))),
    "direct beam: atmosphere x clouds x rain curtain"),
  eq("sceneLuminance", "sceneLuminance",
    max(1e-4, mul(add(
      mul(c("sunLumWeight"), v("render.sunMul"), max(0, sin(v("sunAltRad")))),
      mul(c("skyLumWeight"), v("daylight"), sub(1, mul(0.5, v("sunOcclusion"))), sub(1, mul(c("stormDarkening"), v("storminess"), v("cloudTowering")))),
      mul(c("moonLumWeight"), v("moonLight")), mul(c("flashLum"), v("lightning")), c("starlightFloor")),
      add(c("albedoLumBase"), mul(c("albedoLumGain"), v("albedoEff"))))),
    "sun + sky dome + moons + lightning + starlight, lifted by bright ground"),
  eq("sceneEv", "sceneEv", div(log(v("sceneLuminance")), Math.LN2), "photographic EV is log2 of luminance"),
  eq("exposure", "render.exposure", kneeCap(sub(1, mul(c("exposureSlope"), v("sceneEv"))), c("exposureCap"), c("exposureKnee")),
    "partial eye adaptation: darker scenes are exposed up, flashes down"),
  eq("ambientMul", "render.ambientMul",
    add(c("ambNight"),
      mul(v("daylight"), add(c("ambDay"), mul(c("ambCloudGain"), v("cloudCover"))), sub(1, mul(c("ambStormLoss"), v("storminess")))),
      mul(c("ambMoon"), v("moonLight")), mul(c("ambFlash"), v("lightning")), mul(c("ambAlbedoGain"), v("albedoEff"), v("daylight"))),
    "overcast diffuses sunlight into the dome; storms darken it; moons and flashes add"),
  eq("giStrength", "render.giStrength",
    mul(add(mul(c("giSun"), v("render.sunMul"), max(0, sin(v("sunAltRad")))), mul(c("giSky"), v("render.ambientMul"))),
      pow(div(v("albedoEff"), c("giRefAlbedo")), c("giAlbedoExp"))),
    "one bounce scales with the light received and the ground's albedo (snow bounces most)"),
  eq("saturation", "render.saturation",
    add(mul(mix(c("satNight"), 1, v("daylight")), add(c("satBase"), mul(c("satSky"), v("rayleighShare"), sub(1, v("cloudCover")))),
      sub(1, mul(c("satFogLoss"), v("fogEff"))), sub(1, mul(c("satRainLoss"), v("rain"))),
      mix(c("satSeasonLo"), 1, v("summerness"))),
      mul(c("satGolden"), v("golden"), v("sunWarmth"))),
    "blue Rayleigh skies saturate, fog/rain/night desaturate, golden light warms"),
  // ---- visibility, haze, fog
  eq("visibility", "visibilityKm",
    kneeCap(div(c("koschmieder"), add(c("betaRayleighKm"), div(v("aerosolTau"), c("aerosolScaleKm")),
      mul(c("betaFogKm"), pow(v("fogEff"), 1.5)), mul(c("betaRainKm"), v("rain")), mul(c("betaSnowKm"), v("snow")))),
      c("visCapKm"), c("visKneeKm")),
    "Koschmieder V = 3.912 / beta_ext (air + aerosol + fog + rain + snow)"),
  eq("heatShimmer", "heatShimmer",
    mul(smoothstep(c("shimmerLoC"), c("shimmerHiC"), T), sub(1, smoothstep(0.25, 0.6, RH)),
      div(mul(v("render.sunMul"), max(0, sin(v("sunAltRad")))), c("sunPeak")), sub(1, smoothstep(1, c("shimmerCalmMs"), v("windSpeedMs")))),
    "heat haze: a superadiabatic surface layer needs heat, dry air, strong insolation and calm"),
  eq("haze", "render.haze",
    sub(1, mul(exp(neg(div(c("hazeRefKm"), v("visibilityKm")))), sub(1, mul(c("shimmerHaze"), v("heatShimmer"))))),
    "aerial perspective over a reference distance, united with the shimmer of a hot calm day (stays < 1 smoothly)"),
  eq("fogFar", "render.fogFar", kneeCap(mul(v("visibilityKm"), 1000, c("fogFarFrac")), c("fogFarCapM"), c("fogFarKneeM")),
    "the fog wall sits at a share of the visibility, easing into its 6 km cap"),
  eq("fogNear", "render.fogNear", mul(v("render.fogFar"), mix(c("fogNearClear"), c("fogNearFog"), max(v("fogEff"), mul(0.5, v("rain"))))),
    "fog/rain pull the fog start toward the camera"),
  eq("turbidity", "render.turbidity",
    kneeCap(add(1, div(add(v("aerosolTau"), mul(c("waterVapourTau"), v("absoluteHumidity"))), c("rayleighTau550"))),
      c("turbidityCap"), c("turbidityKnee")),
    "Linke turbidity = total / Rayleigh optical depth"),
  // ---- motion, shadows, sky
  eq("windSway", "render.windSway", kneeCap(add(sqrt(div(v("dynamicPressurePa"), c("swayRefPa"))), mul(0.1, v("storminess"))), 1, c("swayKnee")),
    "sway amplitude ~ sqrt(q / q_ref) (bending ~ force), easing into full sway"),
  eq("cloudShadow", "render.cloudShadow",
    mul(add(mul(c("shadowLow"), v("cloudLow")), mul(c("shadowMid"), v("cloudMid")), mul(c("shadowHigh"), v("cloudHigh")), mul(c("shadowTower"), v("cloudTowering"))),
      smoothstep(0, 12, E), sub(1, smoothstep(c("overcastShadowLo"), 1, v("cloudCover")))),
    "low/towering clouds cast hard shadows when the sun is up; full overcast is shadowless"),
  eq("starVisibility", "render.starVisibility",
    mul(sub(1, smoothstep(-16, -6, E)), sub(1, v("cloudCover")), sub(1, mul(c("moonWashout"), v("moonLight"))), sub(1, v("render.haze"))),
    "stars need astronomical dark, clear sky, little moon and clean air"),
  eq("rainStreaks", "render.rainStreaks",
    mul(v("rain"), add(c("streakBase"), mul(sub(1, c("streakBase")), smoothstep(0, 12, v("windSpeedMs")))),
      mix(0.6, 1, max(v("daylight"), v("lightning")))),
    "streaks lengthen in wind and show when lit"),
  eq("lightning", "render.lightning",
    mul(v("lightning"), add(c("flashBase"), mul(sub(1, c("flashBase")), v("cloudTowering"))),
      sub(1, mul(c("flashDaySuppress"), v("daylight"), sub(1, v("sunOcclusion"))))),
    "flashes light the cloud deck; bright sun drowns them"),
  eq("tideRange", "tideRangeM",
    add(c("tideBase"), mul(c("tideIlun"), abs(sub(1, mul(2, v("moonIlunIllumination"))))),
      mul(c("tideVesh"), abs(sub(1, mul(2, v("moonVeshIllumination")))))),
    "spring tides at new and full (|cos phase| = |1 - 2 illumination|), neap at quarters"),
  eq("precipKind", "precipKind", select(step(c("precipMin"), add(v("rain"), v("snow"))), add(1, step(v("rain"), v("snow"))), 0),
    "DISPLAY/event code 0 dry / 1 rain / 2 snow: discrete by definition (equations use rain and snow themselves)"),
];

// ---------------------------------------------------------------- validation + topological order

const VAR_BY_ID: ReadonlyMap<string, WorldVarDef> = new Map(WORLD_VARS.map((d) => [d.id, d]));

/**
 * Order equations so every equation runs after the writers of the derived variables it reads.
 * Throws on a duplicate writer, a write to a non-derived var, a derived var without a writer,
 * an unknown reference, or a cycle (naming the variables on it).
 */
export function topoSortEquations(eqs: readonly WorldEquation[], vars: readonly WorldVarDef[]): WorldEquation[] {
  const byId = new Map(vars.map((d) => [d.id, d]));
  const writer = new Map<string, WorldEquation>();
  for (const e of eqs) {
    const d = byId.get(e.out);
    if (!d) throw new Error(`world: equation ${e.id} writes unknown variable "${e.out}"`);
    if (d.source !== "derived") throw new Error(`world: equation ${e.id} writes ${d.source} variable "${e.out}"`);
    if (writer.has(e.out)) throw new Error(`world: "${e.out}" has two writers (${writer.get(e.out)!.id}, ${e.id})`);
    writer.set(e.out, e);
  }
  for (const d of vars) if (d.source === "derived" && !writer.has(d.id)) throw new Error(`world: derived "${d.id}" has no writer`);
  const deps = new Map<string, string[]>();
  for (const e of eqs) {
    const refs = exprRefs(e.expr).vars;
    for (const r of refs) if (!byId.has(r)) throw new Error(`world: equation ${e.id} reads unknown variable "${r}"`);
    deps.set(e.out, [...refs].filter((r) => byId.get(r)!.source === "derived"));
  }
  const out: WorldEquation[] = [];
  const state = new Map<string, 1 | 2>(); // 1 visiting, 2 done
  const stack: string[] = [];
  const visit = (id: string) => {
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) {
      const cyc = stack.slice(stack.indexOf(id)).concat(id);
      throw new Error(`world: equation cycle ${cyc.join(" -> ")}`);
    }
    state.set(id, 1); stack.push(id);
    for (const d of deps.get(id)!) visit(d);
    stack.pop(); state.set(id, 2);
    out.push(writer.get(id)!);
  };
  for (const e of eqs) visit(e.out);
  return out;
}

/** Equations in evaluation order (computed at module load: throws here on a cycle). */
export const WORLD_ORDER: readonly WorldEquation[] = topoSortEquations(WORLD_EQUATIONS, WORLD_VARS);

const KNOWN = new Set(WORLD_VARS.map((d) => d.id));
interface Step { out: string; f: CompiledExpr; lo: number; hi: number }
const STEPS: readonly Step[] = WORLD_ORDER.map((e) => {
  const d = VAR_BY_ID.get(e.out)!;
  return { out: e.out, f: compileExpr(e.expr, WORLD_COEFFICIENTS, KNOWN), lo: d.min, hi: d.max };
});
const NON_DERIVED: readonly WorldVarDef[] = WORLD_VARS.filter((d) => d.source !== "derived");

/** Inputs that are angles on a circle: they wrap into [min, min + period) instead of clamping. */
export const PERIODIC_INPUTS: Readonly<Record<string, number>> = { hour: 24, dayOfYear: 365 };

/**
 * An input as the equations see it: missing or NaN -> `def`; periodic -> wrapped (a non-finite
 * periodic value -> `def`); otherwise clamped to [min, max] (so +-Infinity lands on a bound).
 */
export function sanitizeInput(d: WorldVarDef, x: number | undefined): number {
  if (x === undefined || Number.isNaN(x)) return d.def;
  const period = PERIODIC_INPUTS[d.id];
  if (period !== undefined) {
    if (!Number.isFinite(x)) return d.def;
    const r = (x - d.min) % period;
    return d.min + (r < 0 ? r + period : r);
  }
  return clamp(x, d.min, d.max);
}

/**
 * Evaluate the world into `out` (reused across frames: no per-call allocation). Inputs are clamped
 * to their declared range; a missing input takes `def`; derived outputs are clamped to theirs.
 */
export function evaluateWorldInto(inputs: Readonly<Record<string, number>>, out: Record<string, number>): Record<string, number> {
  for (let i = 0; i < NON_DERIVED.length; i++) {
    const d = NON_DERIVED[i];
    out[d.id] = sanitizeInput(d, inputs[d.id]);
  }
  for (let i = 0; i < STEPS.length; i++) {
    const s = STEPS[i];
    out[s.out] = clamp(s.f(out), s.lo, s.hi);
  }
  return out;
}

/** Evaluate every world variable from the given inputs (a fresh record). */
export function evaluateWorld(inputs: Readonly<Record<string, number>>): Record<string, number> {
  return evaluateWorldInto(inputs, {});
}

/** Magnus dew point, degC — the same law and coefficients as the `dewPoint` equation (for Weather). */
export function magnusDewPointC(temperatureC: number, relativeHumidity: number): number {
  const a = WORLD_COEFFICIENTS.magnusA, b = WORLD_COEFFICIENTS.magnusB;
  const g = Math.log(Math.max(1e-9, relativeHumidity)) + (a * temperatureC) / (b + temperatureC);
  return (b * g) / (a - g);
}

/** Magnus saturation vapour pressure, hPa — the same law and coefficients as the `satVapour` equation. */
export function magnusSatVapourHPa(temperatureC: number): number {
  const k = WORLD_COEFFICIENTS;
  return k.magnusE0 * Math.exp((k.magnusA * temperatureC) / (k.magnusB + temperatureC));
}

/** Stull (2011) wet-bulb temperature, degC, held in [dew point, T] — the same law as the `wetBulb` equation. */
export function stullWetBulbC(temperatureC: number, relativeHumidity: number): number {
  const k = WORLD_COEFFICIENTS, T = temperatureC;
  const RH = clamp(relativeHumidity, 0.02, 1), rh = 100 * RH;
  const tw = T * Math.atan(k.stullA * Math.sqrt(rh + k.stullB)) + Math.atan(T + rh) - Math.atan(rh - k.stullC) +
    k.stullD * Math.pow(rh, 1.5) * Math.atan(k.stullE * rh) - k.stullF;
  return clamp(tw, Math.min(T, magnusDewPointC(T, RH)), T);
}
