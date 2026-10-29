// Waves: the deep-water wave train shared by PHYSICS (Surroundings.surfaceAt) and the GPU (the
// water/magma vertex shader in src/graphics/biomes/). One parameter set, two evaluators that
// run the same arithmetic: `gerstnerAt` here and WAVE_GLSL's `gerstner()` there.
//
// Model: a sum of N Gerstner (trochoidal) waves. A rest point p0 = (x0, z0) on the still plane
// moves to
//     theta_i = k_i (D_i . p0) + phase_i(t)                 phase_i(t) = phi_i - omega_i t
//     x  = x0 - sum Q_i A_i f_i(r0) D_ix sin theta_i
//     z  = z0 - sum Q_i A_i f_i(r0) D_iz sin theta_i
//     y  =      sum     A_i f_i(r0)      cos theta_i
// D_i unit direction of travel, k_i = 2 pi / lambda_i wavenumber (rad/m), A_i amplitude (m),
// Q_i in [0, 1] the trochoid sharpness (1 = true Gerstner), f_i(r0) a resolution fade (below).
// The surface height at a WORLD point (x, z) needs the rest point that lands there: the
// fixed point p0 <- (x, z) + sum Q A f D sin theta(p0), a contraction with Lipschitz constant
// <= sum Q_i k_i A_i = totalSteepness < 1, so INVERT_ITERATIONS steps converge to < 1 mm.
//
// Everything derives from ONE input, the agitation a in [0, 1] (0 still, 1 storm):
//   wind speed        U = STORM_WIND * a                                   (m/s)
//   peak wavelength   lambda_0 = max(minWavelength, 2 pi U^2 / g)          (deep-water wave whose
//                     phase speed c = sqrt(g / k) equals the wind: a young, wind-driven sea)
//   spectrum          lambda_i = lambda_0 * SPECTRUM_RATIO^i, clamped >= minWavelength
//   steepness         S = a * STORM_STEEPNESS_FRACTION * BREAKING_STEEPNESS, shared EQUALLY by the
//                     N waves (Phillips saturation: each band sits at the same steepness k A)
//   amplitude         A_i = (S / N) / k_i                                  (m)
//   speed             omega_i = speedScale * sqrt(g k_i)                   (deep-water dispersion
//                     omega^2 = g k; speedScale 1 for water, < 1 for viscous magma)
//   direction         wind heading + DIRECTIONAL_SPREAD * u_i, u_i uniform in [-1, 1] (wave 0 = wind)
// Still water (a = 0) has every amplitude exactly 0: the surface is flat.
//
// Resolution fade: a polar mesh of `segments` bearings has an angular vertex spacing 2 pi r / S.
// Wave i is drawn faithfully while that spacing is <= lambda_i / VERTICES_PER_WAVELENGTH, i.e.
// out to fadeEnd_i = lambda_i S / (VERTICES_PER_WAVELENGTH 2 pi); it fades out over
// [FADE_START_FRACTION fadeEnd_i, fadeEnd_i] (no far-field aliasing). The fade is part of the
// shared function, so the GPU and physics still agree everywhere.
//
// Pure module: no Three.js, no DOM.
import { rng32 } from "../../core/MathCore.ts";

/** Real gravity for the dispersion relation, m/s^2 (the waves are scenery at real scale; body gravity is separate). */
export const WAVE_GRAVITY = 9.81;
/** Waves in a train (the shader's array size: keep in sync with WAVE_GLSL). */
export const WAVE_COUNT = 4;
/** Effective wind at agitation 1, m/s: Beaufort 4 ("moderate breeze", first whitecaps). */
export const STORM_WIND = 7;
/** Stokes breaking limit k A for H / lambda = 1/7: k A = pi H / lambda = pi / 7. */
export const BREAKING_STEEPNESS = Math.PI / 7;
/** Total steepness at agitation 1 as a fraction of the breaking limit (steep, foaming, not breaking). */
export const STORM_STEEPNESS_FRACTION = 0.7;
/** lambda_{i+1} / lambda_i: one wave per ~0.7 octave below the peak. */
export const SPECTRUM_RATIO = 0.62;
/** Half-width of the directional spread around the wind, rad (~ +-34 deg, a cos^2-like spread). */
export const DIRECTIONAL_SPREAD = 0.6;
/** Vertices per wavelength needed to draw a wave without aliasing (Nyquist 2, doubled for shape). */
export const VERTICES_PER_WAVELENGTH = 4;
/** A wave starts fading at this fraction of its fade-end radius. */
export const FADE_START_FRACTION = 0.6;
/** Fixed-point steps of the surface-height inversion (error <= S^n * A, S <= 0.32 -> < 1 mm). */
export const INVERT_ITERATIONS = 6;

/** One Gerstner component. */
export interface Wave {
  /** Unit direction of travel in the xz plane. */
  dirX: number;
  dirZ: number;
  /** Wavenumber 2 pi / wavelength, rad/m. */
  k: number;
  /** Wavelength, m. */
  wavelength: number;
  /** Crest height above the still level, m. */
  amplitude: number;
  /** Angular frequency, rad/s (omega^2 = g k, times speedScale). */
  omega: number;
  /** Phase at t = 0, rad. */
  phase0: number;
  /** Trochoid sharpness 0..1 (horizontal displacement factor). */
  sharpness: number;
  /** Rest radius where the resolution fade starts / ends, m (Infinity = never fades). */
  fadeStart: number;
  fadeEnd: number;
}

/** A complete wave train: what physics and the shader both evaluate. */
export interface WaveTrain {
  waves: Wave[];
  /** 0 still .. 1 storm. */
  agitation: number;
  /** Peak (longest) wavelength, m. */
  peakWavelength: number;
  /** sum k_i A_i: the inversion's contraction constant (< 1). */
  totalSteepness: number;
  /** Largest possible |y|, m: sum A_i. */
  maxElevation: number;
}

/** Options for deriveWaves. */
export interface WaveOptions {
  /** Shortest wavelength the mesh can draw near the ring, m (see minResolvableWavelength). Default 1. */
  minWavelength?: number;
  /** Bearings of the polar mesh (for the fade radii). Default Infinity (no fade). */
  segments?: number;
  /** Multiplies omega (1 water; < 1 viscous magma). Default 1. */
  speedScale?: number;
  /** Multiplies the steepness (1 water; < 1 heavy magma heave). Default 1. */
  steepnessScale?: number;
  /** Gravity for the dispersion relation, m/s^2. Default WAVE_GRAVITY. */
  gravity?: number;
}

/**
 * Shortest wavelength a polar mesh of `segments` bearings resolves at radius `radius`, m:
 * VERTICES_PER_WAVELENGTH * (2 pi radius / segments).
 */
export function minResolvableWavelength(radius: number, segments: number): number {
  return VERTICES_PER_WAVELENGTH * (2 * Math.PI * Math.max(0, radius)) / Math.max(3, segments);
}

/** Derive the wave train from the agitation (0..1), the wind heading (rad) and a seed. See the header. */
export function deriveWaves(agitation: number, windAngle: number, seed: number, options: WaveOptions = {}): WaveTrain {
  const a = Math.max(0, Math.min(1, Number.isFinite(agitation) ? agitation : 0));
  const g = options.gravity ?? WAVE_GRAVITY;
  const minWavelength = Math.max(0.05, options.minWavelength ?? 1);
  const speedScale = options.speedScale ?? 1;
  const segments = options.segments ?? Infinity;
  const rng = rng32((seed ^ 0x9e3779b9) >>> 0);
  const wind = STORM_WIND * a;
  const peakWavelength = Math.max(minWavelength, (2 * Math.PI * wind * wind) / g);
  const steepness = a * STORM_STEEPNESS_FRACTION * BREAKING_STEEPNESS * (options.steepnessScale ?? 1);
  const waves: Wave[] = [];
  let totalSteepness = 0, maxElevation = 0;
  for (let i = 0; i < WAVE_COUNT; i++) {
    const wavelength = Math.max(minWavelength, peakWavelength * Math.pow(SPECTRUM_RATIO, i));
    const k = (2 * Math.PI) / wavelength;
    const amplitude = steepness / WAVE_COUNT / k;
    const spread = i === 0 ? 0 : DIRECTIONAL_SPREAD * (2 * rng() - 1);
    const heading = windAngle + spread;
    const phase0 = 2 * Math.PI * rng();
    const fadeEnd = Number.isFinite(segments) ? (wavelength * segments) / (VERTICES_PER_WAVELENGTH * 2 * Math.PI) : Infinity;
    waves.push({
      dirX: Math.cos(heading), dirZ: Math.sin(heading), k, wavelength, amplitude,
      omega: speedScale * Math.sqrt(g * k), phase0, sharpness: 1,
      fadeStart: FADE_START_FRACTION * fadeEnd, fadeEnd,
    });
    totalSteepness += k * amplitude;
    maxElevation += amplitude;
  }
  return { waves, agitation: a, peakWavelength, totalSteepness, maxElevation };
}

/** Phase of every wave at time t, rad, wrapped to [0, 2 pi) in double precision (the shader gets these as uniforms). */
export function wavePhasesAt(train: WaveTrain, t: number, out: Float64Array | Float32Array = new Float64Array(WAVE_COUNT)): Float64Array | Float32Array {
  const twoPi = 2 * Math.PI;
  for (let i = 0; i < train.waves.length; i++) {
    const w = train.waves[i];
    const p = (w.phase0 - w.omega * t) % twoPi;
    out[i] = p < 0 ? p + twoPi : p;
  }
  return out;
}

/** GLSL's smoothstep, mirrored exactly (also returns 0/1 for a degenerate edge pair). */
export function glslSmoothstep(e0: number, e1: number, x: number): number {
  if (!(e1 > e0)) return x < e0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Result of the forward Gerstner map: world position of a rest point and the surface compression. */
export interface GerstnerSample {
  x: number;
  y: number;
  z: number;
  /** 1 - sum Q k A f cos theta: < 1 where the surface is compressed (crests), the foam signal. */
  jacobian: number;
}

/** Forward map of rest point (x0, z0) with the given wave phases (wavePhasesAt). Allocation-free with `out`. */
export function gerstnerAt(train: WaveTrain, x0: number, z0: number, phases: ArrayLike<number>, out: GerstnerSample = { x: 0, y: 0, z: 0, jacobian: 1 }): GerstnerSample {
  const r0 = Math.hypot(x0, z0);
  let dx = 0, dz = 0, y = 0, compression = 0;
  for (let i = 0; i < train.waves.length; i++) {
    const w = train.waves[i];
    const fade = 1 - glslSmoothstep(w.fadeStart, w.fadeEnd, r0);
    const amp = w.amplitude * fade;
    const theta = w.k * (w.dirX * x0 + w.dirZ * z0) + phases[i];
    const s = Math.sin(theta), c = Math.cos(theta);
    dx -= w.sharpness * amp * w.dirX * s;
    dz -= w.sharpness * amp * w.dirZ * s;
    y += amp * c;
    compression += w.sharpness * w.k * amp * c;
  }
  out.x = x0 + dx;
  out.y = y;
  out.z = z0 + dz;
  out.jacobian = 1 - compression;
  return out;
}

const SCRATCH_PHASES = new Float64Array(WAVE_COUNT);
const SCRATCH_SAMPLE: GerstnerSample = { x: 0, y: 0, z: 0, jacobian: 1 };

/**
 * Height of the waved surface above the still level at WORLD (x, z) and time t, m: inverts
 * the horizontal Gerstner displacement by fixed-point iteration (see the header). Allocation-free.
 */
export function waveHeightAt(train: WaveTrain, x: number, z: number, t: number): number {
  if (train.maxElevation === 0) return 0;
  wavePhasesAt(train, t, SCRATCH_PHASES);
  let x0 = x, z0 = z;
  for (let n = 0; n < INVERT_ITERATIONS; n++) {
    gerstnerAt(train, x0, z0, SCRATCH_PHASES, SCRATCH_SAMPLE);
    x0 += x - SCRATCH_SAMPLE.x;
    z0 += z - SCRATCH_SAMPLE.z;
  }
  return gerstnerAt(train, x0, z0, SCRATCH_PHASES, SCRATCH_SAMPLE).y;
}

/**
 * Pack the train into the shader's uniforms (WAVE_GLSL):
 *   uWaveA[i] = (dirX, dirZ, k, amplitude)     uWaveB[i] = (sharpness, fadeStart, fadeEnd, 0)
 * Infinity fade radii are written as 1e9 (GLSL has no Infinity literal). Returns the two arrays.
 */
export function packWaveUniforms(train: WaveTrain, outA = new Float32Array(WAVE_COUNT * 4), outB = new Float32Array(WAVE_COUNT * 4)): { a: Float32Array; b: Float32Array } {
  outA.fill(0);
  outB.fill(0);
  const finite = (v: number) => (Number.isFinite(v) ? v : 1e9);
  for (let i = 0; i < Math.min(WAVE_COUNT, train.waves.length); i++) {
    const w = train.waves[i];
    outA.set([w.dirX, w.dirZ, w.k, w.amplitude], i * 4);
    outB.set([w.sharpness, finite(w.fadeStart), finite(w.fadeEnd), 0], i * 4);
  }
  return { a: outA, b: outB };
}

/**
 * The GLSL twin of gerstnerAt (same order of operations). Needs the uniforms
 *   uniform vec4 uWaveA[4]; uniform vec4 uWaveB[4]; uniform vec4 uWavePhase;
 * Returns vec4(dx, y, dz, jacobian) for rest point p0, and writes the analytic normal.
 */
export const WAVE_GLSL = /* glsl */ `
uniform vec4 uWaveA[${WAVE_COUNT}];
uniform vec4 uWaveB[${WAVE_COUNT}];
uniform vec4 uWavePhase;
vec4 gerstner(vec2 p0, out vec3 waveNormal) {
  float r0 = length(p0);
  vec3 d = vec3(0.0);
  float compression = 0.0;
  vec3 tx = vec3(1.0, 0.0, 0.0);
  vec3 tz = vec3(0.0, 0.0, 1.0);
  for (int i = 0; i < ${WAVE_COUNT}; i++) {
    vec4 A = uWaveA[i];
    vec4 B = uWaveB[i];
    float fade = 1.0 - smoothstep(B.y, B.z, r0);
    float amp = A.w * fade;
    float theta = A.z * (A.x * p0.x + A.y * p0.y) + uWavePhase[i];
    float s = sin(theta);
    float c = cos(theta);
    d.x -= B.x * amp * A.x * s;
    d.z -= B.x * amp * A.y * s;
    d.y += amp * c;
    compression += B.x * A.z * amp * c;
    float wa = A.z * amp;
    tx += vec3(-B.x * A.x * A.x * wa * c, -A.x * wa * s, -B.x * A.x * A.y * wa * c);
    tz += vec3(-B.x * A.x * A.y * wa * c, -A.y * wa * s, -B.x * A.y * A.y * wa * c);
  }
  waveNormal = normalize(cross(tz, tx));
  return vec4(d.x, d.y, d.z, 1.0 - compression);
}
`;

/**
 * TS mirror of WAVE_GLSL evaluated on the PACKED Float32 uniforms (what the GPU receives),
 * in float32 arithmetic (Math.fround on every product), for the GPU/physics agreement test.
 */
export function evaluatePackedWaves(a: Float32Array, b: Float32Array, phases: ArrayLike<number>, x0: number, z0: number): GerstnerSample {
  const f = Math.fround;
  const r0 = f(Math.hypot(f(x0), f(z0)));
  let dx = 0, dz = 0, y = 0, compression = 0;
  for (let i = 0; i < WAVE_COUNT; i++) {
    const [ax, ay, az, aw] = [a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]];
    const [bx, by, bz] = [b[i * 4], b[i * 4 + 1], b[i * 4 + 2]];
    const fade = f(1 - glslSmoothstep(by, bz, r0));
    const amp = f(aw * fade);
    const theta = f(f(az * f(f(ax * f(x0)) + f(ay * f(z0)))) + f(phases[i]));
    const s = f(Math.sin(theta)), c = f(Math.cos(theta));
    dx = f(dx - f(bx * f(amp * f(ax * s))));
    dz = f(dz - f(bx * f(amp * f(ay * s))));
    y = f(y + f(amp * c));
    compression = f(compression + f(bx * f(az * f(amp * c))));
  }
  return { x: f(f(x0) + dx), y, z: f(f(z0) + dz), jacobian: f(1 - compression) };
}
