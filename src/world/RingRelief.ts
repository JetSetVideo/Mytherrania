// RingRelief: the relief that makes the ring band READ from the gameplay camera (lane E2:
// R07, R08). Three layers, all bound by the slope rule (the relaxation that follows clips
// anything steeper than tan(maxSlope)), none touching the fair centre:
//
//   fair centre  the disc of radius fairRadius (the duel's level ground): nothing this
//                module adds reaches it (rolling ground is cone-bounded, mounds are placed
//                whole outside it). freedomAt(x, z) is the smoothstep fade the paint and
//                callers can use to tell fair from free ground.
//   rolling      fBm over rollOctaves from rollWavelength = bandWidth, its amplitude SOLVED
//                so the RMS slope of the free nodes equals rollSlope = tan(maxSlope) / 2
//                (normalisation to a target spread, applied to slope instead of height):
//                k = rollSlope / rms(|grad n|),  roll = k (n - median(n)), then bounded by
//                the cone c = (tan(maxSlope) - rollSlope)(|p| - fairRadius):
//                h += c tanh(roll / c)  (0 on the fair centre, ~roll far from it).
//   mounds       Pareto mounds and hollows (bandFeatureCount), amplitudes in METRES up to
//                bandFeatureMaxAmplitude, radius from the slope rule r = 1.5 A / (tan g),
//                centres area-uniform in the band with the whole disc off the fair centre;
//                signs alternate by size rank.
//
// The in-ring flagged feature (terrace or shallow hole) is stamped by TerrainFeatures'
// stampDeliberate with ringDeliberateSpec; `flaggedInsideRing` counts what is visible.
// Pure module: no Three.js, no DOM.
import { clamp, lerp, smoothstep, topShare } from "../core/MathCore.ts";
import { fbm2, makeFbmOctaves } from "./HeightOps.ts";
import { FEATURE_CLIFF, FEATURE_HOLE, type ArenaOutline, type TerrainFeature, type WorkGrid } from "./TerrainFeatures.ts";
import { PARETO_TOP_FRACTION, PROFILE_PEAK_SLOPE, stratifiedParetoSample, type TerrainRules } from "./TerrainRules.ts";

/** Salt of the ring-relief random stream: rng32(seed ^ RING_STREAM_SALT) keeps the original draws of the base, bumps and outside stamps unchanged. */
export const RING_STREAM_SALT = 0x5eed_e2;

/** A spawn spot the generator keeps level with the fair centre, world metres. */
export interface FairSpot {
  x: number;
  z: number;
}

/**
 * The duel's spawn spots, mirroring Engine.#startFight (keep in sync, or pass the
 * engine's own spots as GenerateOptions.fairSpots): s = min(2.5, 0.4 ringHalf) with
 * ringHalf = the smallest outline radius over 16 bearings; player at (-s, 0), opponent at
 * (s, s).
 */
export function duelSpawnPoints(outline: ArenaOutline): FairSpot[] {
  let ringHalf = Infinity;
  for (let i = 0; i < 16; i++) ringHalf = Math.min(ringHalf, outline.radiusAt((i / 16) * Math.PI * 2));
  const s = Math.min(2.5, 0.4 * ringHalf);
  return [{ x: -s, z: 0 }, { x: s, z: s }];
}

/**
 * Distance from world (x, z) to the FAIR SET, m (0 on it): the fair centre (radius
 * fairRadius) and one pad of radius fairPadRadius per spawn spot.
 */
export function fairDistance(rules: TerrainRules, spots: readonly FairSpot[], x: number, z: number): number {
  let e = Math.hypot(x, z) - rules.fairRadius;
  for (const p of spots) e = Math.min(e, Math.hypot(x - p.x, z - p.z) - rules.fairPadRadius);
  return Math.max(0, e);
}

/**
 * Freedom weight at world (x, z), 0..1: 0 on the fair set, rising with a smoothstep to 1
 * at fairBlend from it (the paint uses it to wear the fair ground; the relief uses the
 * stricter slope cone of stampRingRoll).
 */
export function freedomAt(rules: TerrainRules, x: number, z: number, spots: readonly FairSpot[] = []): number {
  return smoothstep(0, rules.fairBlend, fairDistance(rules, spots, x, z));
}

/** What the pad levelling did. */
export interface PadReport {
  /** Fair datum, m: the median height of the nodes within fairRadius. */
  datum: number;
  /** Fade-out run of each pad, m. */
  blends: number[];
}

/**
 * Level each spawn pad with the fair centre: h <- lerp(h, datum, w), w = 1 within
 * fairPadRadius of the spot and 1 - smoothstep(fairPadRadius, fairPadRadius + B, e)
 * beyond, with B = max(cell, 1.5 D / (tan(maxSlope) g)) where D is the largest
 * |h - datum| within fairPadRadius + fairBlend: the smoothstep fade then stays inside the
 * feature slope budget. Pulling TOWARD the datum never widens the fair centre's relief.
 */
export function stampFairPads(g: WorkGrid, rules: TerrainRules, spots: readonly FairSpot[]): PadReport {
  const fair: number[] = [];
  for (let j = 0; j < g.rows; j++) {
    for (let i = 0; i < g.cols; i++) if (Math.hypot(g.originX + i * g.cell, g.originZ + j * g.cell) <= rules.fairRadius) fair.push(g.h[j * g.cols + i]);
  }
  fair.sort((a, b) => a - b);
  const datum = fair.length ? fair[fair.length >> 1] : 0;
  const budget = rules.maxSlopeTan * rules.featureSlopeUse;
  const blends: number[] = [];
  for (const p of spots) {
    let dev = 0;
    forEachNodeNear(g, p.x, p.z, rules.fairPadRadius + rules.fairBlend, (n) => { dev = Math.max(dev, Math.abs(g.h[n] - datum)); });
    const blend = Math.max(g.cell, (PROFILE_PEAK_SLOPE * dev) / budget);
    forEachNodeNear(g, p.x, p.z, rules.fairPadRadius + blend, (n, e) => {
      const w = 1 - smoothstep(rules.fairPadRadius, rules.fairPadRadius + blend, e);
      g.h[n] = lerp(g.h[n], datum, w);
    });
    blends.push(blend);
  }
  return { datum, blends };
}

/** Visit the nodes within `radius` of world (x, z) with their distance. */
function forEachNodeNear(g: WorkGrid, x: number, z: number, radius: number, visit: (n: number, dist: number) => void): void {
  const i0 = Math.max(0, Math.ceil((x - radius - g.originX) / g.cell)), i1 = Math.min(g.cols - 1, Math.floor((x + radius - g.originX) / g.cell));
  const j0 = Math.max(0, Math.ceil((z - radius - g.originZ) / g.cell)), j1 = Math.min(g.rows - 1, Math.floor((z + radius - g.originZ) / g.cell));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(g.originX + i * g.cell - x, g.originZ + j * g.cell - z);
      if (d <= radius) visit(j * g.cols + i, d);
    }
  }
}

/** What the rolling stage did. */
export interface RollReport {
  /** Solved gain k, m per unit of noise. */
  amplitude: number;
  /** RMS |grad| of the raw noise over the free nodes, 1/m (before the gain). */
  rawRmsSlope: number;
  /** Largest height the rolling ground added, m. */
  swing: number;
  /** Slope of the cone that bounds it around the fair centre: tan(maxSlope) - rollSlope. */
  coneSlope: number;
  /** RMS slope the rolling ground reaches over the free in-ring nodes (target rollSlope). */
  rmsSlope: number;
}

/**
 * Add the rolling ground to `g.h` (metres). The noise n uses rules.rollOctaves octaves with
 * gains persistence^k / sum (as the base fBm) and first wavelength rollWavelength.
 *
 * Fade-in: a slope CONE around the fair set. At distance e from it the rolling ground may
 * depart from the fair ground by at most c(e) = (tan(maxSlope) - rollSlope) e (the slope the
 * rolling ground leaves free), applied smoothly: added = c tanh(k (n - median) / c), ~ the
 * full roll where c >> |roll|, ~ +-c near the fair set, 0 on it. So no rolled node is ever
 * out of slope reach of the fair ground and the relaxation never has to move a fair node.
 *
 * Gain: normalisation to a target spread, applied to SLOPE: k is solved so the RMS
 * |grad added| over the FREE nodes inside the ring (ringNorm < 1, at least fairBlend from the
 * fair set) equals rollSlope - start at k0 = rollSlope / rms(|grad n|), then
 * k <- k * rollSlope / rms(|grad added|), at most ROLL_GAIN_STEPS times (the cone makes the
 * map slightly nonlinear). Gradients by central differences. Without `ringNorm` every free
 * node counts.
 */
export function stampRingRoll(g: WorkGrid, rules: TerrainRules, rng: () => number, spots: readonly FairSpot[] = [], ringNorm?: Float32Array): RollReport {
  const raw = Array.from({ length: rules.rollOctaves }, (_, k) => Math.pow(rules.base.persistence, k));
  const sum = raw.reduce((a, b) => a + b, 0);
  const octaves = makeFbmOctaves(raw.map((v) => v / sum), rules.rollWavelength, rng);
  const { cols, rows, cell } = g, count = cols * rows;
  const noise = new Float64Array(count), cone = new Float64Array(count), added = new Float64Array(count);
  const coneSlope = Math.max(0, rules.maxSlopeTan - rules.rollSlope);
  const free = new Uint8Array(count);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = g.originX + i * cell, z = g.originZ + j * cell, n = j * cols + i;
      noise[n] = fbm2(octaves, x, z);
      const e = fairDistance(rules, spots, x, z);
      cone[n] = coneSlope * e;
      free[n] = e >= rules.fairBlend && (!ringNorm || ringNorm[n] < 1) && i > 0 && j > 0 && i < cols - 1 && j < rows - 1 ? 1 : 0;
    }
  }
  const median = Float64Array.from(noise).sort()[count >> 1];
  /** RMS of |grad values| over the free nodes. */
  const rmsSlope = (values: Float64Array) => {
    let sq = 0, used = 0;
    for (let n = 0; n < count; n++) {
      if (!free[n]) continue;
      const gx = (values[n + 1] - values[n - 1]) / (2 * cell), gz = (values[n + cols] - values[n - cols]) / (2 * cell);
      sq += gx * gx + gz * gz;
      used++;
    }
    return used > 0 ? Math.sqrt(sq / used) : 0;
  };
  const fill = (k: number) => {
    for (let n = 0; n < count; n++) {
      const c = cone[n];
      added[n] = c > 1e-9 ? c * Math.tanh((k * (noise[n] - median)) / c) : 0;
    }
  };
  const rawRmsSlope = rmsSlope(noise);
  let amplitude = rawRmsSlope > 1e-12 ? rules.rollSlope / rawRmsSlope : 0;
  for (let step = 0; step < ROLL_GAIN_STEPS && amplitude > 0; step++) {
    fill(amplitude);
    const measured = rmsSlope(added);
    if (measured <= 1e-12) break;
    amplitude *= Math.min(2, rules.rollSlope / measured); // at most doubling per step
  }
  fill(amplitude);
  let swing = 0;
  for (let n = 0; n < count; n++) { g.h[n] += added[n]; swing = Math.max(swing, Math.abs(added[n])); }
  return { amplitude, rawRmsSlope, swing, coneSlope, rmsSlope: rmsSlope(added) };
}

/** Fixed-point steps of the rolling-ground gain: 3 (the residual is < 1% after 2 on the default grids). */
export const ROLL_GAIN_STEPS = 3;

/**
 * Stamp rules.bandFeatureCount Pareto mounds (+) and hollows (-) into `g.h` (metres).
 * Draw k: relative a_k from a stratified capped Pareto (bandFeatureCapRatio,
 * bandFeatureAlpha), so the top 20% hold ~80% of the amplitude; A_k = a_k *
 * bandFeatureMaxAmplitude; r_k = clamp(1.5 A_k / (tan g), featureMinRadius,
 * bandFeatureMaxRadius) and A_k is cut back to r_k tan g / 1.5 if r_k was clamped at the top.
 * Centres are area-uniform between fairRadius + r_k + cell and the outline, so no mound
 * reaches the fair centre. Profile: h += sign A (1 - smoothstep(0, r, dist)).
 */
export function stampBandMounds(g: WorkGrid, rules: TerrainRules, outline: ArenaOutline, rng: () => number, spots: readonly FairSpot[] = []): TerrainFeature[] {
  const n = rules.bandFeatureCount;
  const drawn = stratifiedParetoSample(rng, n, 1 / rules.bandFeatureCapRatio, rules.bandFeatureAlpha, rules.bandFeatureCapRatio);
  const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => drawn[b] - drawn[a]);
  const firstSign = rng() < 0.5 ? 1 : -1;
  const sign = new Int8Array(n);
  order.forEach((idx, rank) => { sign[idx] = rank % 2 === 0 ? firstSign : -firstSign; });
  const budget = rules.maxSlopeTan * rules.featureSlopeUse;
  const out: TerrainFeature[] = [];
  for (let k = 0; k < n; k++) {
    const wanted = drawn[k] * rules.bandFeatureMaxAmplitude;
    const radius = clamp((PROFILE_PEAK_SLOPE * wanted) / budget, rules.featureMinRadius, rules.bandFeatureMaxRadius);
    const amplitude = sign[k] * Math.min(wanted, (radius * budget) / PROFILE_PEAK_SLOPE);
    // The whole mound stays off the fair centre (+ one cell), so its flank is never cut by the
    // freedom ramp (a cut flank would be steeper than the budget and the relaxation would
    // then reach into the fair centre).
    // Up to ceil(1/d^2) = 25 draws for a centre whose disc clears the pads too; if none
    // does, the last draw is used and its profile fades out over the fair set instead.
    const tries = Math.ceil(1 / (PARETO_TOP_FRACTION * PARETO_TOP_FRACTION));
    let x = 0, z = 0, clear = false;
    for (let t = 0; t < tries && !clear; t++) {
      const angle = rng() * Math.PI * 2;
      const inner = rules.fairRadius + radius + rules.cell;
      const outer = Math.max(inner, outline.radiusAt(angle));
      const dist = Math.sqrt(lerp(inner * inner, outer * outer, rng()));
      x = Math.cos(angle) * dist; z = Math.sin(angle) * dist;
      clear = fairDistance(rules, spots, x, z) >= radius + rules.cell;
    }
    const i0 = Math.max(0, Math.ceil((x - radius - g.originX) / g.cell)), i1 = Math.min(g.cols - 1, Math.floor((x + radius - g.originX) / g.cell));
    const j0 = Math.max(0, Math.ceil((z - radius - g.originZ) / g.cell)), j1 = Math.min(g.rows - 1, Math.floor((z + radius - g.originZ) / g.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const nx = g.originX + i * g.cell, nz = g.originZ + j * g.cell;
        const d = Math.hypot(nx - x, nz - z);
        if (d < radius) g.h[j * g.cols + i] += amplitude * (1 - smoothstep(0, radius, d)) * (clear ? 1 : freedomAt(rules, nx, nz, spots));
      }
    }
    out.push({ kind: amplitude >= 0 ? "mound" : "hollow", x, z, radius, amplitude, relative: drawn[k], dirX: 0, dirZ: 0 });
  }
  return out;
}

/** topShare of the band mounds' drawn relative amplitudes (the 80/20 check), 0 when there are none. */
export function bandMoundShare(features: readonly TerrainFeature[]): number {
  const drawn = features.filter((f) => f.kind === "mound" || f.kind === "hollow").map((f) => f.relative);
  return drawn.length ? topShare(drawn, PARETO_TOP_FRACTION) : 0;
}

/**
 * HOLE and CLIFF nodes strictly inside the ring (ringNorm < 1): what the camera can see of
 * the dramatic features (ramps are walkable inclines and read as ordinary slope).
 */
export function flaggedInsideRing(mask: Uint8Array, ringNorm: Float32Array): number {
  let n = 0;
  for (let k = 0; k < mask.length; k++) if (ringNorm[k] < 1 && (mask[k] === FEATURE_HOLE || mask[k] === FEATURE_CLIFF)) n++;
  return n;
}

/**
 * Smallest visible feature, in nodes: ceil(featureMinRadius / cell)^2 = 4 at the default
 * grid (a 2 x 2 node patch, the smallest shape the grid draws).
 */
export function minVisibleNodes(rules: TerrainRules): number {
  return Math.ceil(rules.featureMinRadius / rules.cell - 1e-9) ** 2;
}
