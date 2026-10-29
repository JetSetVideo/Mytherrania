// Camera occlusion helpers (pure module: no Three.js, no DOM).
//
// Two parts:
// 1. Terrain clearance (lane O, V01): a heightfield (hills, cliffs) cannot be faded piecewise, so
//    when the ground rises between the third-person camera and the character the camera is
//    PULLED IN along its ray to just in front of the first ground hit (counted from the
//    character), or RAISED when pulling in would come closer than a minimum distance.
//    `cameraClearance` is the pure per-frame answer; `CameraClearance` adds the smoothing
//    (instant pull-in, eased release) the Engine applies to the third-person camera.
// 2. Legacy wall fade math (`occlusionAlpha`, `blockDistance`): the 2D ground-plane test the
//    Engine used before src/graphics/occlusion/Occluders.ts. Kept for its existing tests.

import { clamp, damp, lambdaFromHalfLife } from "../core/MathCore.ts";

/** A point in metres (THREE.Vector3 satisfies it). */
export interface Vec3Like { x: number; y: number; z: number }

/**
 * Ground height at world (x, z), m. NaN or -Infinity = no ground (the void): never blocks.
 * The Engine passes TerrainMeshBuild.floorHeightAt (allocation-free).
 */
export type HeightSampler = (x: number, z: number) => number;

/** Tunables of the terrain clearance (units per field). */
export interface ClearanceOptions {
  /**
   * Height the view ray must keep above the ground, m. The near plane (0.1 m) at a 50 deg
   * vertical fov is ~0.05 m tall; 0.3 m keeps the near plane AND the lower frame edge out of
   * the slope just under the ray.
   */
  groundClearance: number;
  /** Ray-march step, m. Must stay below the narrowest ridge the terrain rules emit (~0.5 m). */
  sampleStep: number;
  /** Bisection steps refining a hit (precision = sampleStep / 2^n: 0.2 / 64 ~ 3 mm). */
  refineIterations: number;
  /** Distance kept in front of the hit, m (the near plane must not cut the slope). */
  backoff: number;
  /**
   * Closest the camera may be pulled toward the character, m. Closer than ~1.2 m the character
   * fills the 50 deg frame (a 1.7 m body subtends 70 deg at 1.2 m), so the camera rises instead.
   */
  minDistance: number;
  /** Highest lift above the pulled-in point, m. */
  maxLift: number;
  /** Lift search step, m. */
  liftStep: number;
  /** Ray-march start, m from the character: skips the character's own footing. */
  startOffset: number;
}

/** Default clearance tuning (reasons in ClearanceOptions). */
export const DEFAULT_CLEARANCE: Readonly<ClearanceOptions> = {
  groundClearance: 0.3,
  sampleStep: 0.2,
  refineIterations: 6,
  backoff: 0.2,
  minDistance: 1.2,
  maxLift: 4,
  liftStep: 0.25,
  startOffset: 0.4,
};

/** Result of cameraClearance. */
export interface ClearanceResult {
  /** Cleared camera position, m. */
  x: number; y: number; z: number;
  /** Kept share of the character->camera distance, in (0, 1]; 1 = the ray was clear. */
  fraction: number;
  /** Height added above the pulled-in point, m (0 unless pulling in hit minDistance). */
  lift: number;
  /** Whether the ground blocked the original ray. */
  blocked: boolean;
}

/** A fresh, unblocked result (allocate once, then reuse it every frame). */
export function createClearanceResult(): ClearanceResult {
  return { x: 0, y: 0, z: 0, fraction: 1, lift: 0, blocked: false };
}

/** Ground height with the void (NaN) read as "no ground". */
function groundAt(heightAt: HeightSampler, x: number, z: number): number {
  const h = heightAt(x, z);
  return Number.isNaN(h) ? -Infinity : h;
}

/** Whether the ray point at distance s is within groundClearance of (or under) the ground. */
function rayBelowGround(
  ox: number, oy: number, oz: number, ux: number, uy: number, uz: number,
  s: number, heightAt: HeightSampler, clearance: number,
): boolean {
  return oy + uy * s < groundAt(heightAt, ox + ux * s, oz + uz * s) + clearance;
}

/**
 * Distance (m) from (ox,oy,oz) along the unit direction (ux,uy,uz) at which the ray first comes
 * within `groundClearance` of the ground, searching [startOffset, length]; -1 when clear.
 * Fixed-step march, then bisection between the last clear and the first blocked sample.
 * Allocation-free.
 */
export function firstGroundHit(
  ox: number, oy: number, oz: number,
  ux: number, uy: number, uz: number,
  length: number, heightAt: HeightSampler, opts: ClearanceOptions = DEFAULT_CLEARANCE,
): number {
  const g = opts.groundClearance;
  const step = Math.max(1e-3, opts.sampleStep);
  let prev = Math.min(opts.startOffset, length);
  for (let s = prev; ; s += step) {
    const at = Math.min(s, length);
    if (rayBelowGround(ox, oy, oz, ux, uy, uz, at, heightAt, g)) {
      let lo = prev, hi = at;
      for (let i = 0; i < opts.refineIterations; i++) {
        const mid = (lo + hi) / 2;
        if (rayBelowGround(ox, oy, oz, ux, uy, uz, mid, heightAt, g)) hi = mid; else lo = mid;
      }
      return lo;
    }
    prev = at;
    if (at >= length) return -1;
  }
}

/**
 * Where the third-person camera may sit so the ground does not hide the character.
 *
 * March from `target` (a point on the character, e.g. its chest) toward `cam`. At the first
 * ground hit s_hit (within groundClearance), keep d = s_hit - backoff:
 *   fraction = d / |cam - target|,  position = target + (cam - target) * fraction.
 * When d < minDistance the camera stays at minDistance and RISES (liftStep increments up to
 * maxLift) until the ray to the character is clear. The final point is kept groundClearance
 * above the ground under it. Writes into `out` and returns it; no allocation.
 */
export function cameraClearance(
  cam: Vec3Like, target: Vec3Like, heightAt: HeightSampler,
  out: ClearanceResult = createClearanceResult(), opts: ClearanceOptions = DEFAULT_CLEARANCE,
): ClearanceResult {
  const dx = cam.x - target.x, dy = cam.y - target.y, dz = cam.z - target.z;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  out.x = cam.x; out.y = cam.y; out.z = cam.z;
  out.fraction = 1; out.lift = 0; out.blocked = false;
  if (length < 1e-6) return out;
  const ux = dx / length, uy = dy / length, uz = dz / length;
  const hit = firstGroundHit(target.x, target.y, target.z, ux, uy, uz, length, heightAt, opts);
  if (hit >= 0) {
    out.blocked = true;
    let keep = hit - opts.backoff;
    if (keep < opts.minDistance) {
      keep = Math.min(length, opts.minDistance);
      // Raise: the lowest lift whose ray from the character is clear.
      const lx = ux * keep, lz = uz * keep, baseY = uy * keep;
      let lift = opts.liftStep;
      for (; lift < opts.maxLift; lift += opts.liftStep) {
        const ly = baseY + lift;
        const ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
        if (firstGroundHit(target.x, target.y, target.z, lx / ll, ly / ll, lz / ll, ll, heightAt, opts) < 0) break;
      }
      out.lift = Math.min(lift, opts.maxLift);
    }
    out.fraction = clamp(keep / length, 0, 1);
    out.x = target.x + dx * out.fraction;
    out.y = target.y + dy * out.fraction + out.lift;
    out.z = target.z + dz * out.fraction;
  }
  const floor = groundAt(heightAt, out.x, out.z) + opts.groundClearance;
  if (out.y < floor) { out.lift += floor - out.y; out.y = floor; }
  return out;
}

/**
 * Half-life of the release (camera easing back out once the hill no longer blocks), s. The
 * pull-in is instant — seeing through a hill for even a frame is worse than a cut — and the
 * release eases so the camera does not breathe in and out on a bumpy ridge.
 */
export const CLEARANCE_RELEASE_HALF_LIFE = 0.25;

/**
 * Smooth a clearance quantity: a TIGHTER response (fraction going down, or lift going up —
 * `tighter` true) is applied at once; a relaxation eases with `halfLife` (s). dt in s.
 */
export function smoothClearance(current: number, target: number, tighter: boolean, dt: number, halfLife = CLEARANCE_RELEASE_HALF_LIFE): number {
  if (tighter) return target;
  return damp(current, target, lambdaFromHalfLife(halfLife), dt);
}

/**
 * The stateful third-person clearance: one per camera. `apply` moves `cam` IN PLACE to the
 * smoothed cleared position (instant pull-in / rise, eased release). Allocation-free per call.
 */
export class CameraClearance {
  /** Smoothed kept share of the character->camera distance, (0, 1]. */
  fraction = 1;
  /** Smoothed lift, m. */
  lift = 0;
  /** The last raw (unsmoothed) answer. */
  readonly raw: ClearanceResult = createClearanceResult();
  /** Tuning (an explicit field, not a constructor parameter property: see Occluders.ts OccluderRecord). */
  readonly options: ClearanceOptions;

  constructor(options: ClearanceOptions = DEFAULT_CLEARANCE) {
    this.options = options;
  }

  /** Clear `cam` (mutated) toward `target` over `heightAt`; dt in s. Returns whether ground blocked. */
  apply(cam: Vec3Like, target: Vec3Like, heightAt: HeightSampler, dt: number): boolean {
    const r = cameraClearance(cam, target, heightAt, this.raw, this.options);
    this.fraction = smoothClearance(this.fraction, r.fraction, r.fraction <= this.fraction, dt);
    this.lift = smoothClearance(this.lift, r.lift, r.lift >= this.lift, dt);
    cam.x = target.x + (cam.x - target.x) * this.fraction;
    cam.y = target.y + (cam.y - target.y) * this.fraction + this.lift;
    cam.z = target.z + (cam.z - target.z) * this.fraction;
    const floor = groundAt(heightAt, cam.x, cam.z) + this.options.groundClearance;
    if (cam.y < floor) cam.y = floor;
    return r.blocked;
  }

  /** Forget the smoothing (new match, camera cut). */
  reset(): void { this.fraction = 1; this.lift = 0; }
}

// ---------------------------------------------------------------------------------------------
// Legacy 2D wall fade (superseded by src/graphics/occlusion/Occluders.ts)
// ---------------------------------------------------------------------------------------------

/**
 * The opacity an occluder should fade to, from its distance along the
 * camera-to-character segment. The closer it sits to the character (the more it
 * blocks the view), the more transparent it gets; objects near the camera stay
 * opaque because they frame rather than hide the subject.
 *
 *   alpha = clamp( (d - dMin) / (dMax - dMin), minAlpha, 1 )
 *
 * where d is the occluder's distance measured BACK from the character, dMin the
 * radius of the full-transparency cutout around the character, and dMax the
 * distance at which the object is far enough from the character to keep solid.
 */
export function occlusionAlpha(dFromCharacter: number, dMin = 1.5, dMax = 6, minAlpha = 0.12): number {
  if (dMax <= dMin) return minAlpha;
  const t = (dFromCharacter - dMin) / (dMax - dMin);
  return clamp(t, minAlpha, 1);
}

/**
 * Whether a sphere (an occluder at `cx,cz` with radius `r`) blocks the segment
 * from the camera `(x0,z0)` to the character `(x1,z1)`, projected onto the
 * ground plane. Returns the occluder's distance back from the character when it
 * blocks, or null when it does not.
 */
export function blockDistance(
  x0: number, z0: number,
  x1: number, z1: number,
  cx: number, cz: number, r: number,
): number | null {
  const dx = x1 - x0, dz = z1 - z0;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-9) return null;
  // Project the occluder centre onto the camera->character segment.
  const t = clamp(((cx - x0) * dx + (cz - z0) * dz) / len2, 0, 1);
  const px = x0 + t * dx, pz = z0 + t * dz;
  const distToLine = Math.hypot(cx - px, cz - pz);
  if (distToLine > r) return null; // outside the corridor: not blocking
  // Distance back from the character along the segment.
  return Math.hypot(cx - x1, cz - z1);
}
