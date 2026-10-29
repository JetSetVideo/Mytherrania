// World variables (G16 G17): ONE table of every world variable at the top of this file, the named
// coefficients, the equations that tie them together (using every EXPR_OPS operator), and the
// evaluator. Pure: no THREE, no DOM.
//
// Sources: "real"    = generated from real-world climate (RealClimate -> Weather);
//          "input"   = clock / place / sky geometry (Calendar, TimeWarp, Environment, Moons);
//          "derived" = written by exactly one equation below.
// Every derived value is clamped to its declared [min, max]; a missing input takes its `def`.
// The equation graph is topologically sorted at module load (a cycle throws, naming it).

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
  real("temperatureC", "degC", -45, 50, 15, "air temperature at 2 m"),
  real("relativeHumidity", "0..1", 0.02, 1, 0.6, "relative humidity"),
  real("pressureHPa", "hPa", 940, 1060, 1013.25, "mean-sea-level pressure"),
  real("windSpeedMs", "m/s", 0, 40, 3, "10 m mean wind speed"),
  real("gustMs", "m/s", 0, 60, 5, "10 m gust speed"),
  real("rain", "0..1", 0, 1, 0, "rain intensity"),
  real("snow", "0..1", 0, 1, 0, "snowfall intensity"),
  real("fog", "0..1", 0, 1, 0, "ground fog / mist density"),
  real("cloudLow", "0..1", 0, 1, 0.2, "low layer coverage (cumulus/stratus)"),
  real("cloudMid", "0..1", 0, 1, 0.1, "mid layer coverage (altocumulus/altostratus)"),
  real("cloudHigh", "0..1", 0, 1, 0.1, "high layer coverage (cirrus/cirrocumulus)"),
  real("cloudTowering", "0..1", 0, 1, 0, "towering layer coverage (cumulonimbus)"),
  real("storminess", "0..1", 0, 1, 0, "continuous position in the storm cycle"),
  real("lightning", "0..1", 0, 1, 0, "current lightning flash brightness"),
  real("aerosolBase", "0..1", 0, 1, 0.3, "background aerosol load of the place/season (dust, haze)"),
  real("snowCover", "0..1", 0, 1, 0, "ground snow cover"),
  // ---- clock / place / sky geometry
  input("hour", "h", 0, 24, 12, "local solar hour"),
  input("dayOfYear", "day", 1, 365, 172, "day of year (drives solar declination)"),
  input("latitude", "deg", -90, 90, 48, "place latitude, + north"),
  input("sunElevationDeg", "deg", -90, 90, 45, "sun elevation above the horizon"),
  input("moonIlunBrightness", "0..1", 0, 1, 0, "Ilun light: illumination x extinction x above horizon"),
  input("moonVeshBrightness", "0..1", 0, 1, 0, "Vesh light: illumination x extinction x above horizon"),
  input("moonIlunIllumination", "0..1", 0, 1, 0.5, "Ilun lit fraction (phase)"),
  input("moonVeshIllumination", "0..1", 0, 1, 0.5, "Vesh lit fraction (phase)"),
  input("groundAlbedo", "0..1", 0.05, 0.6, 0.2, "snow-free ground albedo of the place"),
  // ---- derived physics
  derived("tempK", "K", 228, 324, 288, "absolute temperature"),
  derived("satVapourHPa", "hPa", 0, 130, 17, "saturation vapour pressure (Magnus)"),
  derived("vapourHPa", "hPa", 0, 130, 10, "actual vapour pressure"),
  derived("magnusGamma", "1", -25, 3, 0, "Magnus gamma = ln(RH) + aT/(b+T)"),
  derived("dewPointC", "degC", -70, 50, 8, "dew point (inverse Magnus)"),
  derived("dewSpreadC", "K", 0, 80, 7, "temperature - dew point"),
  derived("cloudBaseM", "m", 0, 4000, 900, "lifting condensation level ~ 125 m/K x spread"),
  derived("virtualTempK", "K", 228, 340, 289, "virtual temperature (moist air buoyancy)"),
  derived("airDensity", "kg/m3", 0.9, 1.6, 1.22, "ideal gas: p / (R_d T_v)"),
  derived("absoluteHumidity", "g/m3", 0, 100, 9, "water vapour density e / (R_v T)"),
  derived("windEffectiveMs", "m/s", 0, 60, 3, "mean wind with gust excess in quadrature"),
  derived("dynamicPressurePa", "Pa", 0, 2500, 6, "q = rho v^2 / 2 (force on foliage)"),
  derived("beaufort", "B", 0, 12, 2, "Beaufort number B = (v/0.836)^(2/3)"),
  derived("windChillC", "degC", -80, 50, 15, "Environment Canada wind chill"),
  derived("humidexC", "degC", -50, 80, 15, "humidex T + 5/9 (e - 10)"),
  derived("apparentTempC", "degC", -80, 80, 15, "wind chill when cold, humidex when warm"),
  derived("frozen", "0/1", 0, 1, 0, "1 when the surface is below freezing"),
  derived("declinationDeg", "deg", -23.5, 23.5, 0, "solar declination (same law as Environment)"),
  derived("seasonPhase", "0..1", 0, 1, 0, "fraction of the year since the spring equinox"),
  derived("summerness", "0..1", 0, 1, 0.5, "0 midwinter .. 1 midsummer for this hemisphere"),
  derived("dayLengthHours", "h", 0, 24, 12, "sunrise equation: cos w0 = -tan(lat) tan(decl)"),
  derived("noonElevationDeg", "deg", -90, 90, 50, "90 - |lat - decl|"),
  derived("sunAltRad", "rad", -1.5708, 1.5708, 0.785, "sun elevation in radians"),
  derived("daylight", "0..1", 0, 1, 1, "civil daylight factor"),
  derived("golden", "0..1", 0, 1, 0, "golden/blue hour factor"),
  derived("airMass", "1", 1, 40, 1.4, "Kasten-Young relative optical air mass"),
  derived("aerosolLoad", "0..1.6", 0, 1.6, 0.3, "aerosol after rain washout and wind-lifted dust"),
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
  derived("dryingRate", "1", 0, 20, 1, "evaporation ~ (e_s - e)(1 + k u) x sun"),
  derived("sceneLuminance", "rel", 0.0001, 4, 1, "relative scene luminance"),
  derived("sceneEv", "EV", -14, 2.1, 0, "log2 scene luminance"),
  derived("visibilityKm", "km", 0.03, 80, 30, "Koschmieder V = 3.912 / beta_ext"),
  derived("tideRangeM", "m", 0, 6, 1.5, "spring/neap tide range from both moons' phases"),
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
  gustWeight: 0.5,         // share of the gust excess felt by foliage (quadrature)
  beaufortK: 0.836,        // Beaufort scale: v = 0.836 B^(3/2) m/s
  swayRefPa: 138,          // dynamic pressure of a 15 m/s wind at rho 1.225 -> full sway
  wcA: 13.12, wcB: 0.6215, wcC: 11.37, wcD: 0.3965, wcExp: 0.16, // wind chill (km/h form)
  msToKmh: 3.6,            // m/s -> km/h
  windChillMaxC: 10,       // wind chill defined at or below 10 degC
  humidexK: 0.5555,        // humidex 5/9 per hPa above 10 hPa
  humidexMinC: 20,         // humidex used at or above 20 degC
  freezeC: 0.5,            // surface freezes below ~0.5 degC air temperature
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
  washout: 2.2,            // rain scavenging: load ~ exp(-k rain)
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
  giSun: 0.6, giSky: 0.25, giRefAlbedo: 0.2, giAlbedoExp: 0.7,
  moonWashout: 0.7,        // bright moonlight hides faint stars
  streakBase: 0.6,         // rain streaks visible without wind
  flashBase: 0.6, flashDaySuppress: 0.7,
  fogFarFrac: 0.3,         // fogFar = 30 % of meteorological visibility (game scale)
  fogNearClear: 0.35, fogNearFog: 0.02,
  tideBase: 0.4, tideIlun: 1.6, tideVesh: 0.7, // tide range, m
};

const { v, c, add, sub, mul, div, mod, pow, neg, abs, sign, min, max, clamp: cl, sqrt, exp, log, sin, cos, tan, atan2, floor, fract, hypot, mix, step, smoothstep, select } = X;
const T = v("temperatureC"), RH = v("relativeHumidity"), E = v("sunElevationDeg");
const eq = (id: string, out: string, expr: Expr, why: string): WorldEquation => ({ id, out, expr, why });
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
  eq("cloudBase", "cloudBaseM", mul(c("lclMPerK"), v("dewSpreadC")), "Espy: LCL rises ~125 m per K of dew-point spread"),
  eq("virtualTemp", "virtualTempK",
    div(v("tempK"), sub(1, mul(div(v("vapourHPa"), v("pressureHPa")), sub(1, c("epsilon"))))),
    "virtual temperature Tv = T / (1 - (e/p)(1 - eps)): moist air is lighter"),
  eq("airDensity", "airDensity", div(mul(v("pressureHPa"), 100), mul(c("rDry"), v("virtualTempK"))),
    "ideal gas law rho = p / (R_d Tv)"),
  eq("absoluteHumidity", "absoluteHumidity", mul(div(mul(v("vapourHPa"), 100), mul(c("rVapour"), v("tempK"))), 1000),
    "water vapour density e / (R_v T), g/m3"),
  // ---- wind
  eq("windEffective", "windEffectiveMs",
    hypot(v("windSpeedMs"), mul(c("gustWeight"), max(0, sub(v("gustMs"), v("windSpeedMs"))))),
    "gust excess adds in quadrature to the mean wind felt by foliage"),
  eq("dynamicPressure", "dynamicPressurePa", mul(0.5, v("airDensity"), pow(v("windEffectiveMs"), 2)),
    "dynamic pressure q = rho v^2 / 2 is the force that bends plants"),
  eq("beaufort", "beaufort", floor(add(pow(div(v("windSpeedMs"), c("beaufortK")), 2 / 3), 0.5)),
    "Beaufort empirical scale v = 0.836 B^1.5, rounded"),
  eq("windChill", "windChillC", (() => {
    const vk = pow(max(mul(v("windSpeedMs"), c("msToKmh")), 4.8), c("wcExp"));
    return add(c("wcA"), mul(c("wcB"), T), neg(mul(c("wcC"), vk)), mul(c("wcD"), T, vk));
  })(), "Environment Canada wind chill (T <= 10 C, V >= 4.8 km/h)"),
  eq("humidex", "humidexC", add(T, mul(c("humidexK"), sub(v("vapourHPa"), 10))), "Environment Canada humidex"),
  eq("apparentTemp", "apparentTempC",
    select(step(T, c("windChillMaxC")), v("windChillC"), select(step(c("humidexMinC"), T), v("humidexC"), T)),
    "felt temperature: wind chill when cold, humidex when hot, air temperature between"),
  eq("frozen", "frozen", sub(1, step(c("freezeC"), T)), "surfaces freeze below ~0.5 C"),
  // ---- astronomy / season
  eq("declination", "declinationDeg",
    mul(c("obliquityDeg"), sin(div(mul(c("twoPi"), add(c("declOffsetDay"), v("dayOfYear"))), c("daysPerYear")))),
    "Cooper declination, the same law as Environment.solarPosition"),
  eq("seasonPhase", "seasonPhase", div(mod(sub(v("dayOfYear"), c("springEquinoxDay")), c("daysPerYear")), c("daysPerYear")),
    "cyclic position in the year since the spring equinox"),
  eq("summerness", "summerness", cl(add(0.5, mul(0.5, sign(v("latitude")), sin(mul(c("twoPi"), v("seasonPhase"))))), 0, 1),
    "the seasons are mirrored in the southern hemisphere"),
  eq("dayLength", "dayLengthHours", (() => {
    const x = cl(neg(mul(tan(mul(v("latitude"), c("degToRad"))), tan(mul(v("declinationDeg"), c("degToRad"))))), -1, 1);
    const acos = atan2(sqrt(sub(1, mul(x, x))), x); // acos(x) = atan2(sqrt(1 - x^2), x)
    return div(mul(2, acos, c("radToDeg")), c("degPerHour"));
  })(), "sunrise equation cos w0 = -tan(lat) tan(decl), day = 2 w0 / 15 deg/h"),
  eq("noonElevation", "noonElevationDeg", sub(90, abs(sub(v("latitude"), v("declinationDeg")))), "solar elevation at solar noon"),
  eq("sunAltRad", "sunAltRad", mul(E, c("degToRad")), "radians for the trigonometry"),
  eq("daylight", "daylight", smoothstep(-6, 8, E), "civil twilight (-6 deg) to full daylight"),
  eq("golden", "golden", mul(smoothstep(-6, -1, E), sub(1, smoothstep(4, 12, E))), "blue + golden hour window"),
  eq("airMass", "airMass",
    div(1, add(sin(max(v("sunAltRad"), 0)), mul(c("kastenA"), pow(add(max(E, 0), c("kastenB")), c("kastenC"))))),
    "Kasten air mass 1/(sin h + 0.15 (h + 3.885)^-1.253), h >= 0"),
  // ---- aerosols, scattering, turbidity
  eq("aerosolLoad", "aerosolLoad",
    mul(v("aerosolBase"), exp(neg(mul(c("washout"), v("rain")))),
      add(1, mul(c("dustLift"), smoothstep(c("dustWindMs"), mul(2, c("dustWindMs")), v("windSpeedMs")), sub(1, RH)))),
    "rain washes aerosols out; strong dry wind lifts dust"),
  eq("hygroGrowth", "hygroGrowth", pow(max(sub(1, RH), 0.05), neg(c("hanelGamma"))),
    "Hanel: humid air swells hygroscopic aerosols, tau ~ (1 - RH)^-gamma"),
  eq("aerosolTau", "aerosolTau", add(mul(c("aerosolTauRef"), v("aerosolLoad"), v("hygroGrowth")), mul(c("fogTau"), v("fog"))),
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
    mul(smoothstep(3, 0.5, v("dewSpreadC")), sub(1, v("cloudCover")), sub(1, smoothstep(1, 4, v("windSpeedMs"))),
      max(0, cos(mul(c("twoPi"), sub(fract(div(v("hour"), 24)), div(c("dewPeakHour"), 24)))))),
    "radiative cooling on calm clear nights deposits dew, peaking before dawn"),
  eq("dryingRate", "dryingRate",
    mul(c("dryRate"), sub(v("satVapourHPa"), v("vapourHPa")), add(1, mul(c("windDry"), v("windEffectiveMs"))),
      add(c("dryBase"), mul(v("daylight"), max(0, sin(v("sunAltRad")))))),
    "Dalton evaporation: vapour-pressure deficit x (1 + k u), faster in sun"),
  eq("wetness", "render.wetness",
    mul(add(mul(c("rainWet"), v("rain")), mul(c("fogWet"), v("fog")), v("dewDeposition"), mul(c("meltWet"), v("snowCover"), sub(1, v("frozen")))),
      exp(neg(mul(v("dryingRate"), sub(1, v("rain"))))), mix(1, c("iceWet"), v("frozen"))),
    "rain/fog/dew/melt wet the ground; warm dry wind dries it; ice is half as glossy"),
  eq("albedoEff", "albedoEff",
    mul(mix(v("groundAlbedo"), c("snowAlbedo"), v("snowCover")), sub(1, mul(c("wetDarken"), v("render.wetness")))),
    "snow brightens, water darkens the ground"),
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
  eq("exposure", "render.exposure", sub(1, mul(c("exposureSlope"), v("sceneEv"))),
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
      sub(1, mul(c("satFogLoss"), v("fog"))), sub(1, mul(c("satRainLoss"), v("rain"))),
      mix(c("satSeasonLo"), 1, v("summerness"))),
      mul(c("satGolden"), v("golden"), v("sunWarmth"))),
    "blue Rayleigh skies saturate, fog/rain/night desaturate, golden light warms"),
  // ---- visibility, haze, fog
  eq("visibility", "visibilityKm",
    div(c("koschmieder"), add(c("betaRayleighKm"), div(v("aerosolTau"), c("aerosolScaleKm")),
      mul(c("betaFogKm"), pow(v("fog"), 1.5)), mul(c("betaRainKm"), v("rain")), mul(c("betaSnowKm"), v("snow")))),
    "Koschmieder V = 3.912 / beta_ext (air + aerosol + fog + rain + snow)"),
  eq("haze", "render.haze", sub(1, exp(neg(div(c("hazeRefKm"), v("visibilityKm"))))), "aerial perspective over a reference distance"),
  eq("fogFar", "render.fogFar", mul(v("visibilityKm"), 1000, c("fogFarFrac")), "the fog wall sits at a share of the visibility"),
  eq("fogNear", "render.fogNear", mul(v("render.fogFar"), mix(c("fogNearClear"), c("fogNearFog"), max(v("fog"), mul(0.5, v("rain"))))),
    "fog/rain pull the fog start toward the camera"),
  eq("turbidity", "render.turbidity",
    add(1, div(add(v("aerosolTau"), mul(c("waterVapourTau"), v("absoluteHumidity"))), c("rayleighTau550"))),
    "Linke turbidity = total / Rayleigh optical depth"),
  // ---- motion, shadows, sky
  eq("windSway", "render.windSway", add(sqrt(div(v("dynamicPressurePa"), c("swayRefPa"))), mul(0.1, v("storminess"))),
    "sway amplitude ~ sqrt(q / q_ref) (bending ~ force)"),
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

/**
 * Evaluate the world into `out` (reused across frames: no per-call allocation). Inputs are clamped
 * to their declared range; a missing input takes `def`; derived outputs are clamped to theirs.
 */
export function evaluateWorldInto(inputs: Readonly<Record<string, number>>, out: Record<string, number>): Record<string, number> {
  for (let i = 0; i < NON_DERIVED.length; i++) {
    const d = NON_DERIVED[i];
    const x = inputs[d.id];
    out[d.id] = x === undefined ? d.def : clamp(x, d.min, d.max);
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
