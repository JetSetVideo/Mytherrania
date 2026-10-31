// FrameBudget: the adaptive effects governor and the frame-time arithmetic behind the
// 60 FPS guard (Wave I, lane I-E).
//
// Pure module: no THREE, no DOM, no Math.random, no allocation in `step`.
//
// Vocabulary (used the same way everywhere):
//   cpuMs    the CPU cost of the PREVIOUS frame (rAF callback time, measured by the tool).
//   dt       seconds since that frame: how long the sampled frame lasted.
//   scale    the multiplier in [minScale, 1] the CALLER applies to effect intensity and
//            particle counts. The governor never touches resolution — the engine's own
//            quality system (#pixelBudget / dynamic resolution) owns that.
//   targetMs the comfortable budget. Below it the governor recovers toward 1.
//   hardMs   the hard budget. Above it frames are already late.
//
// Why a governor at all: Wave I adds a free camera, a DOM cursor, floating cards, fill
// meshes and clash sparks. Rather than let a heavy frame drop the frame rate, the caller
// feeds the governor the previous frame's cost and thins the new effects when the budget is
// exceeded, so the 60 FPS cadence is preserved on modest hardware.
//
// Hysteresis (why a single lean frame cannot move the scale):
//   1. Smoothing. The governor acts on an EXPONENTIAL MOVING AVERAGE of cpuMs with a time
//      constant of EMA_TAU_S = 0.35 s (it closes ~63% of a step in 0.35 s). One 20 ms frame
//      among 12 ms frames moves the average by well under one ms, nowhere near hardMs.
//   2. A run gate. A drop additionally needs OVER_RUN_FRAMES = 12 CONSECUTIVE frames whose
//      SMOOTHED cost exceeds hardMs (0.2 s of sustained over-budget at 60 Hz). A lone spike
//      never reaches 12, and the counter resets the moment a frame is not over.
//   3. A dead zone. Between targetMs and hardMs the governor HOLDS the scale and clears the
//      run counters, so a mildly warm stretch cannot accumulate toward a drop. Together these
//      three stop the scale from flapping.
//
// Asymmetry (why recovery is slower than the drop — stated rates):
//   downRate = 0.25 scale units removed per DROP EVENT (one event per completed over-run).
//              From 1.0 three drops reach minScale 0.25; at 60 Hz that is ~54 frames (~0.9 s).
//   upRate   = 0.25 scale units recovered per SECOND while under targetMs.
//              Climbing the 0.75 units from minScale back to 1 takes 3 s (~3x slower than the
//              drop), and the scale is clamped to 1 so it can never overshoot.

/** Defaults for GovernorOptions: a comfortable 12 ms target inside a 16.6 ms (60 FPS) budget. */
export const GOVERNOR_DEFAULTS: Required<GovernorOptions> = {
  targetMs: 12,
  hardMs: 16.6,
  minScale: 0.25,
  upRate: 0.25,
  downRate: 0.25,
};

/** EMA time constant (s): the governor reacts to a trend, not to a frame. */
export const EMA_TAU_S = 0.35;
/** Consecutive over-budget frames required before one drop. */
export const OVER_RUN_FRAMES = 12;
/** A hostile dt (NaN / negative) cannot contribute; cap a huge one so a stalled tab is one event. */
const MAX_DT_S = 0.25;
/** A cpuMs beyond this is treated as an outlier spike, not an unbounded average pull. */
const MAX_CPU_MS = 1000;

export interface GovernorOptions {
  targetMs?: number;
  hardMs?: number;
  minScale?: number;
  upRate?: number;
  downRate?: number;
}

export class EffectsGovernor {
  readonly targetMs: number;
  readonly hardMs: number;
  readonly minScale: number;
  readonly upRate: number;
  readonly downRate: number;

  #scale = 1;
  #avg: number;
  #overRun = 0;
  #drops = 0;
  #recoveries = 0;
  #overBudgetFrames = 0;

  constructor(opts: GovernorOptions = {}) {
    this.targetMs = opts.targetMs ?? GOVERNOR_DEFAULTS.targetMs;
    this.hardMs = opts.hardMs ?? GOVERNOR_DEFAULTS.hardMs;
    this.minScale = opts.minScale ?? GOVERNOR_DEFAULTS.minScale;
    this.upRate = opts.upRate ?? GOVERNOR_DEFAULTS.upRate;
    this.downRate = opts.downRate ?? GOVERNOR_DEFAULTS.downRate;
    // Start the average at the comfortable target: the first frames must not read as a spike.
    this.#avg = this.targetMs;
  }

  /**
   * One call per frame with the PREVIOUS frame's CPU ms. Returns the effect scale in
   * [minScale, 1] to apply this frame. Every input (NaN, negative, zero, huge) yields a
   * finite scale, so a bad measurement can never corrupt the effect budget.
   */
  step(cpuMs: number, dt: number): number {
    const cpu = Number.isFinite(cpuMs) ? Math.max(0, Math.min(cpuMs, MAX_CPU_MS)) : 0;
    const h = Number.isFinite(dt) ? Math.max(0, Math.min(dt, MAX_DT_S)) : 0;

    // 1. Smooth (frame-rate independent). h = 0 leaves the average untouched.
    this.#avg += (cpu - this.#avg) * (1 - Math.exp(-h / EMA_TAU_S));

    if (this.#avg > this.hardMs) {
      // Over the hard budget: count toward a drop. A drop is a discrete event, not a per-frame
      // slide, so the scale moves in one direction while the regime holds.
      this.#overBudgetFrames++;
      this.#overRun++;
      if (this.#overRun >= OVER_RUN_FRAMES) {
        this.#overRun = 0;
        const before = this.#scale;
        this.#scale = Math.max(this.minScale, this.#scale - this.downRate);
        if (this.#scale < before) this.#drops++;
      }
    } else if (this.#avg < this.targetMs) {
      // Under the comfortable target: recover slowly, never above 1.
      this.#overRun = 0;
      const before = this.#scale;
      this.#scale = Math.min(1, this.#scale + this.upRate * h);
      if (this.#scale > before) this.#recoveries++;
    } else {
      // Dead zone (targetMs .. hardMs): hold and reset the run counter. This is the band that
      // removes flapping — a warm stretch is not allowed to accumulate momentum toward a drop.
      this.#overRun = 0;
    }
    return this.#scale;
  }

  /** Current effect scale in [minScale, 1]. */
  get scale(): number {
    return this.#scale;
  }
  /** Number of frames in which the scale was reduced (drop events). */
  get drops(): number {
    return this.#drops;
  }
  /** Number of frames in which the scale was increased. */
  get recoveries(): number {
    return this.#recoveries;
  }
  /** Number of frames whose SMOOTHED cost exceeded hardMs. */
  get overBudgetFrames(): number {
    return this.#overBudgetFrames;
  }
}

/**
 * Percentile of a sample using the NEAREST-RANK (ceil) convention: the rank is
 * `ceil(p * n)`, clamped to [1, n], and the value is that order statistic of an ascending
 * sorted copy. So on [1..100]: p50 = 50, p95 = 95, p99 = 99. An EMPTY sample has no
 * percentile and returns 0 (total, never NaN). Non-finite entries count as 0.
 */
export function percentile(samples: readonly number[], p: number): number {
  const n = samples.length;
  if (n === 0) return 0;
  const sorted = samples.map((x) => (Number.isFinite(x) ? x : 0)).sort((a, b) => a - b);
  const pp = Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
  const rank = Math.min(n, Math.max(1, Math.ceil(pp * n)));
  const v = sorted[rank - 1];
  return Number.isFinite(v) ? v : 0;
}

/** Descriptive summary of a sample. Empty input returns all zeros (never NaN). */
export function summarise(
  samples: readonly number[],
): { n: number; mean: number; p50: number; p95: number; p99: number; max: number } {
  const n = samples.length;
  if (n === 0) return { n: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  let sum = 0;
  let max = 0;
  for (const x of samples) {
    const v = Number.isFinite(x) ? x : 0;
    sum += v;
    if (v > max) max = v;
  }
  return {
    n,
    mean: sum / n,
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    p99: percentile(samples, 0.99),
    max,
  };
}
