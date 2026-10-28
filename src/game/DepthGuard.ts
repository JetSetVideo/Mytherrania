// DepthGuard: the skin-penetration invariant — the rule that a limb's SKIN can never end
// up inside the torso, enforced BEFORE the pose is ever drawn.
//
// Why this exists: the rig is a tree of independently animated pivots (Skeleton.ts), so
// nothing in the geometry itself knows that an arm belongs to a chest. An animation can
// drive a limb straight through the torso and the lofted surfaces will happily draw skin
// inside skin. The owner's rule is absolute — "the vertices of the body of the skin should
// never be inside the body ... the system should be able to validate that is not possible
// before even it happens. No animation should allow that from any angle."
//
// This module is that validator. It is a PRE-FLIGHT gate, not a repair pass: it is handed
// the vertices a pose WOULD produce, before the world matrices are built, and it returns a
// verdict. It never fixes anything after the fact — a penetrating pose is rejected, not
// patched.
//
// The whole system runs on ONE number, `surfaceGap`: the SIGNED distance from a point to a
// capsule's surface — positive outside, negative inside, zero exactly on the surface. A
// pose is safe iff every skin vertex has a non-negative gap to the torso. Everything else
// here (the report, the pre-flight gate, the angle budget) is built on that single number.
//
// Pure module: no Three.js, no DOM. Vertices are plain {x,y,z} objects, so the guard can
// run headless in a test or on the render thread without importing the graphics stack.

import { type JointId } from "./BodyGraph.ts";
import { partShape, raceSilhouette } from "./BodyProfile.ts";
import { effectiveLimits } from "./PartHierarchy.ts";

/** A point or direction in body-local space. Plain data — never a Three.js Vector3. */
export type Vec3 = { x: number; y: number; z: number };

/**
 * A body part approximated as a capsule along its bone: the axis runs from `a` to `b` (the
 * part's base and tip), and `radius` is the part's SURFACE radius. The torso is one of
 * these; so is any other part we want to guard a neighbour against.
 */
export type Capsule = { a: Vec3; b: Vec3; radius: number };

/**
 * The verdict of a vertex sweep. `worst` is the most negative gap found — the DEEPEST
 * intrusion (it is a large positive number when the whole sample clears the torso, and a
 * finite 0 when there was nothing usable to test). `count` is how many points landed
 * strictly inside. `firstAt` is the first such point, kept so a caller can log where.
 */
export type PenetrationReport = { worst: number; count: number; firstAt: Vec3 | null; safe: boolean };

// ---------------------------------------------------------------------------------
// totality helpers — every entry point funnels its numbers through these, so no input
// (undefined, NaN, Infinity) can ever propagate out as NaN
// ---------------------------------------------------------------------------------

/** A finite number or `fallback`. */
function finite(x: number | undefined, fallback: number): number {
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}

/** Clamp into [lo, hi]; assumes lo <= hi. */
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** A Vec3 with every component made finite (non-finite -> 0). */
function v3(v: Vec3 | undefined): Vec3 {
  return { x: finite(v?.x, 0), y: finite(v?.y, 0), z: finite(v?.z, 0) };
}

/** True only when all three components are real finite numbers. */
function isFiniteVec(v: Vec3 | undefined): v is Vec3 {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

// ---------------------------------------------------------------------------------
// 1. surfaceGap — the number the whole system runs on
// ---------------------------------------------------------------------------------

/**
 * The SIGNED distance from `point` to the capsule's surface:
 *   positive outside, negative inside, 0 exactly on the surface.
 *
 * Exact, and defined for every capsule including the degenerate one. It is the
 * point-to-SEGMENT distance minus the radius:
 *
 *   t   = clamp( ((p-a)·(b-a)) / |b-a|² , 0, 1 )     the foot of the perpendicular
 *   q   = a + t·(b-a)                                 nearest point on the axis
 *   gap = |p - q| - radius
 *
 * Degenerate case a == b: |b-a|² is 0, so the axis collapses to a single point and the
 * gap is the plain point-to-centre distance minus the radius — a sphere. That is handled
 * by the guard clause below (t = 0), not by a branch chain.
 *
 * Total: a non-finite point or capsule is read as its finite fallback, so the result is
 * always a real number.
 */
export function surfaceGap(point: Vec3, capsule: Capsule): number {
  const p = v3(point);
  const a = v3(capsule?.a);
  const b = v3(capsule?.b);
  const radius = Math.max(0, finite(capsule?.radius, 0));

  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const abLen2 = abx * abx + aby * aby + abz * abz;

  // Degenerate capsule (zero-length axis): the nearest axis point is `a` itself.
  const t = abLen2 > 0 ? clamp((apx * abx + apy * aby + apz * abz) / abLen2, 0, 1) : 0;
  const qx = a.x + t * abx, qy = a.y + t * aby, qz = a.z + t * abz;
  const dx = p.x - qx, dy = p.y - qy, dz = p.z - qz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - radius;
}

// ---------------------------------------------------------------------------------
// 2. guardVertices — the sweep that says whether a set of skin points penetrates
// ---------------------------------------------------------------------------------

/**
 * Sweep a set of skin vertices against the torso capsule and report the worst intrusion.
 *
 * `worst` is the minimum gap over all usable points (the deepest intrusion), `count` how
 * many sit strictly inside, `firstAt` the first of those, and `safe` is `worst >= margin`
 * (margin defaults to 0 — on-surface counts as safe). Non-finite points are SKIPPED, never
 * counted and never propagated; a sample with no usable points reports a finite 0.
 */
export function guardVertices(points: Vec3[], torso: Capsule, margin = 0): PenetrationReport {
  const m = finite(margin, 0);
  let worst = Number.POSITIVE_INFINITY;
  let count = 0;
  let firstAt: Vec3 | null = null;

  for (const raw of points ?? []) {
    if (!isFiniteVec(raw)) continue;
    const gap = surfaceGap(raw, torso);
    if (gap < worst) worst = gap;
    if (gap < 0) {
      count++;
      if (firstAt === null) firstAt = { x: raw.x, y: raw.y, z: raw.z };
    }
  }

  // Nothing usable to test: no intrusion, and the gap must still be a real number.
  if (!Number.isFinite(worst)) worst = 0;
  return { worst, count, firstAt, safe: worst >= m };
}

// ---------------------------------------------------------------------------------
// 3. angleBudget — the skin-distance-to-angle equation
// ---------------------------------------------------------------------------------

/**
 * THE EQUATION. The largest joint excursion, in radians, that keeps a limb's SKIN outside
 * the torso — derived from the capsule geometry, not guessed.
 *
 * DERIVATION
 * ----------
 * The torso is a capsule of surface radius Rt; its axis is a line. The limb is a capsule
 * of surface radius rl and length L, pivoting at a joint J that sits ON the torso surface,
 * a perpendicular distance Rt from the axis. Write theta for the joint's excursion from
 * the pose that points the limb straight out, away from the axis.
 *
 * The point of the limb that can reach the torso is its TIP (the near-joint region
 * overlaps the torso by design — that overlap is the `seat` in BodyGraph.ts, and it is
 * what makes the limb emerge FROM the body instead of butting against it — so the guard is
 * on the tip, which is the part a large excursion can drive into the torso).
 *
 * Out-of-plane sweeps are the worst case, and that is what sets the bound. Swinging the
 * limb in the plane that contains the torso axis and J makes the tip's distance to the axis
 * vary as |Rt + L·cos(theta)|, which reaches zero once L >= Rt. Swinging it in the plane
 * PERPENDICULAR to that (the tip sweeps a circle of radius L about J, at distance Rt from
 * the axis) keeps the tip's distance to the axis at
 *
 *     d(theta) = sqrt( Rt² + L² + 2·Rt·L·cos(theta) )
 *
 * — the law of cosines on the triangle (axis-origin, J, tip): legs Rt and L, included angle
 * (pi - theta). This is the honest, non-degenerate distance, and it is strictly LARGER than
 * the in-plane value for the same theta, so it is the constraint that must hold for every
 * angle: d(theta) >= Rt + rl (the tip's skin clears the torso's skin).
 *
 * Solving for cos(theta):
 *     Rt² + L² + 2 Rt L cos(theta) >= (Rt + rl)²
 *     cos(theta) >= ( 2·Rt·rl + rl² - L² ) / ( 2·Rt·L )
 *
 * so the budget is theta_max = acos( (2·Rt·rl + rl² - L²) / (2·Rt·L) ).
 *
 * Dimensional sanity: the argument is dimensionless (metres² over metres²), and the three
 * monotonicities the geometry demands all fall out of it:
 *   - a LONGER limb (bigger L) lowers the argument, raising theta_max  -> tolerates MORE;
 *   - a FATTER torso (bigger Rt) raises the argument, lowering theta_max -> tolerates LESS;
 *   - a FATTER limb (bigger rl) raises the argument, lowering theta_max -> tolerates LESS.
 * (The Rt monotonicity holds for the real case L > rl; a limb shorter than its own radius
 * is degenerate and not a body.)
 *
 * The result is the interval [-theta_max, +theta_max] around the neutral pose, then
 * INTERSECTED with the joint's own limits from `effectiveLimits` — so the geometric budget
 * can only ever TIGHTEN a joint, never loosen it past its own stop. `limiting` names which
 * of torsoRadius / limbRadius / limbLength governs the budget at these numbers (the one a
 * small relative change moves theta_max most).
 *
 * Total: every input is made finite first; a missing torsoRadius falls back to the race's
 * own chest radius, so `race` is a live input and no argument can yield NaN.
 */
export function angleBudget(
  joint: JointId,
  race: string,
  torsoRadius: number,
  limbRadius: number,
  limbLength: number,
): { min: number; max: number; limiting: string } {
  const Rt = Math.max(0, finite(torsoRadius, raceTorsoRadius(race)));
  const rl = Math.max(0, finite(limbRadius, 0));
  const L = Math.max(0, finite(limbLength, 0));

  const thetaMax = budgetAngleRaw(Rt, rl, L);

  // Geometric budget: symmetric about the neutral pose.
  const limits = effectiveLimits(joint, {});
  let lo = Math.max(-thetaMax, limits.min);
  let hi = Math.min(thetaMax, limits.max);
  // If the geometric budget excludes the joint's whole range, collapse to the admissible
  // point nearest the neutral pose rather than emit an empty (min > max) interval.
  if (lo > hi) {
    const p = clamp(0, limits.min, limits.max);
    lo = p;
    hi = p;
  }
  return { min: lo, max: hi, limiting: bindingConstraint(Rt, rl, L) };
}

/** The raw theta_max, with no clamping to joint limits. Degenerate axes read as "locked". */
function budgetAngleRaw(Rt: number, rl: number, L: number): number {
  const denom = 2 * Rt * L;
  const cosMax = denom > 0 ? clamp((2 * Rt * rl + rl * rl - L * L) / denom, -1, 1) : 1;
  return Math.acos(cosMax);
}

/** The race's torso (chest) surface radius, used as the fallback when torsoRadius is absent. */
function raceTorsoRadius(race: string): number {
  const sil = raceSilhouette(typeof race === "string" ? race : "human", null);
  return Math.max(0, finite(partShape("chest", sil).root, 0));
}

/** Which parameter a small relative change moves theta_max most — the binding constraint. */
function bindingConstraint(Rt: number, rl: number, L: number): string {
  const base = budgetAngleRaw(Rt, rl, L);
  const rel = (p: number): number => Math.max(Math.abs(p), 1e-6) * 1e-3;
  const table: [string, number][] = [
    ["torsoRadius", Math.abs(budgetAngleRaw(Rt + rel(Rt), rl, L) - base)],
    ["limbRadius", Math.abs(budgetAngleRaw(Rt, rl + rel(rl), L) - base)],
    ["limbLength", Math.abs(budgetAngleRaw(Rt, rl, L + rel(L)) - base)],
  ];
  let best: [string, number] = ["torsoRadius", -1];
  for (const row of table) best = row[1] > best[1] ? row : best;
  return best[0];
}

// ---------------------------------------------------------------------------------
// 4. validatePose — the pre-flight gate
// ---------------------------------------------------------------------------------

/**
 * The pre-flight gate. Given the joint angles of a pose and a `sample` callback that
 * returns the skin vertices a joint would produce at an angle, it runs `guardVertices`
 * for every posed joint and reports each one whose pose would penetrate the torso.
 *
 * `sample` is the caller's bridge to the mesh: it knows how to turn (joint, angle) into the
 * limb's skin points. `validatePose` owns the invariant, not the geometry. The torso capsule
 * is derived from the race (its chest shape), so the caller only names the race; the sampled
 * points must be in the same body-local frame (origin at the torso base, +y up the spine).
 *
 * A pose is safe iff no joint's sample penetrates. Runs BEFORE world matrices are built, so
 * a bad pose is rejected, never rendered.
 */
export function validatePose(
  joints: Partial<Record<JointId, number>>,
  race: string,
  sample: (joint: JointId, angle: number) => Vec3[],
): { safe: boolean; violations: { joint: JointId; angle: number; worst: number }[] } {
  const torso = torsoCapsule(race);
  const violations: { joint: JointId; angle: number; worst: number }[] = [];

  for (const [key, value] of Object.entries(joints ?? {})) {
    const joint = key as JointId;
    const angle = finite(value as number, 0);
    const points = sample(joint, angle);
    const report = guardVertices(Array.isArray(points) ? points : [], torso);
    if (!report.safe) violations.push({ joint, angle, worst: report.worst });
  }
  return { safe: violations.length === 0, violations };
}

/** The torso as a capsule, built from the race's chest shape along its bone. */
function torsoCapsule(race: string): Capsule {
  const sil = raceSilhouette(typeof race === "string" ? race : "human", null);
  const chest = partShape("chest", sil);
  return { a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: chest.length, z: 0 }, radius: chest.root };
}
