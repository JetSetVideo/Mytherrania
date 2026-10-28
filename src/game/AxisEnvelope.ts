// The axis/trig envelope tree: a tree of nodes and branches giving the exact minimum
// and maximum of sin, cos and tan for every axis at every level of the body's joint
// hierarchy, so the bounds can be injected into equations that feed other equations.
//
// Why this exists: AnimTensor.ts already bounds the per-CLASS animation envelope — the
// min/max sin/cos/tan a skill's move sweeps a tracked joint through, sampled from the
// pose curve. This module is the JOINT/AXIS version: it is structural and exact rather
// than per-class and sampled. It answers "for joint J on axis A, across every pose its
// whole ancestor chain can reach, what are the exact sin/cos/tan extremes?" — the tree
// shape comes from the coupling hierarchy (JOINT_PARENT), the numbers from the joint's
// coupled range, and the trig extremes are computed analytically (not sampled), with an
// honest unbounded result wherever a tan asymptote falls inside the travel.
//
// The owner asked for "minimum and maximum values for the cosinus and the sinus and the
// tangent of XYZ for all the body parts", driven by "trees with branches and nodes that
// you expand", with bounds that depend on the RACE and SUBRACE and the body's
// proportions, and with the min/max injected into equations that feed other equations.
//
// THE ENGINE SHOULD CALL axisTree() FIRST: it returns the roots, and expand(root) then
// flattens each root parents-before-children so a caller can inject every node's bounds
// in dependency order (a child's equation reads its parent's already-injected bound).
//
// Pure module: no Three.js, no DOM, zero runtime dependencies.

import { BODY_LINKS, type JointId } from "./BodyGraph.ts";
import { effectiveLimits } from "./PartHierarchy.ts";
import { RACE_SILHOUETTE, raceSilhouette, type RaceSilhouette } from "./BodyProfile.ts";

// ---------------------------------------------------------------------------------
// public shapes
// ---------------------------------------------------------------------------------

/** The three rotation axes a joint bound is expressed on. */
export type Axis = "x" | "y" | "z";

/** A closed interval: the smallest and largest value the quantity reaches. */
export type TrigBounds = { min: number; max: number };

/**
 * One node of the envelope tree: a joint on one axis, with the exact sin/cos/tan extremes
 * over its whole coupled travel, its children (the joints below it in the coupling chain)
 * and its distance from the root.
 */
export type TrigNode = {
  joint: JointId;
  axis: Axis;
  sin: TrigBounds;
  cos: TrigBounds;
  tan: TrigBounds;
  children: TrigNode[];
  depth: number;
};

// ---------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------

const HALF_PI = Math.PI / 2;
const EPS = 1e-9;

/** A NaN reads as `fallback`; infinities are preserved (they are meaningful for tan). */
function finiteOr(x: number, fallback: number): number {
  return Number.isFinite(x) ? x : fallback;
}

/** Multiply a bound by a positive scale; a NaN bound collapses to 0, ±Inf survives. */
function scaled(x: number, k: number): number {
  return Number.isNaN(x) ? 0 : x * k;
}

/** The race's reach multiplier: a wider, longer-limbed body sweeps a larger envelope. */
function proportionScale(s: RaceSilhouette): number {
  return Math.max(1e-9, finiteOr(s.width, 1) * finiteOr(s.limbLength, 1));
}

/** Every angle of the form `phase + k*period` inside [a, b]. */
function criticals(a: number, b: number, period: number, phase: number): number[] {
  const out: number[] = [];
  if (!(b >= a)) return out;
  const kLo = Math.ceil((a - phase) / period);
  const kHi = Math.floor((b - phase) / period);
  // A pathologically long interval contains every extremum anyway; bail to the endpoints.
  if (kHi - kLo > 100000) return [a, b];
  for (let k = kLo; k <= kHi; k++) out.push(phase + k * period);
  return out;
}

// ---------------------------------------------------------------------------------
// trigBounds — the exact min/max of sin, cos and tan over a closed angle interval
// ---------------------------------------------------------------------------------

/**
 * The EXACT extremes of sin, cos and tan over the closed interval [angleMin, angleMax],
 * in radians. Not sampled:
 *   - sin reaches its extremes at the interval endpoints and at every critical point
 *     pi/2 + k*pi that falls inside;
 *   - cos at the endpoints and at every k*pi inside;
 *   - tan is monotone on each branch, so its extremes are the endpoints UNLESS the
 *     interval straddles an asymptote at pi/2 + k*pi, in which case the range is honestly
 *     unbounded (-Infinity .. +Infinity) rather than a lie.
 * A reversed interval is normalised, and a non-finite endpoint reads as 0, so no input
 * yields NaN.
 */
export function trigBounds(angleMin: number, angleMax: number): { sin: TrigBounds; cos: TrigBounds; tan: TrigBounds } {
  let a = finiteOr(angleMin, 0);
  let b = finiteOr(angleMax, 0);
  if (a > b) {
    const t = a;
    a = b;
    b = t;
  }

  let sMin = Number.POSITIVE_INFINITY, sMax = Number.NEGATIVE_INFINITY;
  for (const x of [a, b, ...criticals(a, b, Math.PI, HALF_PI)]) {
    const v = Math.sin(x);
    if (v < sMin) sMin = v;
    if (v > sMax) sMax = v;
  }

  let cMin = Number.POSITIVE_INFINITY, cMax = Number.NEGATIVE_INFINITY;
  for (const x of [a, b, ...criticals(a, b, Math.PI, 0)]) {
    const v = Math.cos(x);
    if (v < cMin) cMin = v;
    if (v > cMax) cMax = v;
  }

  const asymptotes = criticals(a, b, Math.PI, HALF_PI);
  const straddles = asymptotes.some((x) => x > a + EPS && x < b - EPS);
  const atAsymptote = (x: number) => Math.abs(Math.cos(x)) < EPS;
  let tMin = Number.POSITIVE_INFINITY, tMax = Number.NEGATIVE_INFINITY;
  if (straddles) {
    tMin = Number.NEGATIVE_INFINITY;
    tMax = Number.POSITIVE_INFINITY;
  } else {
    if (atAsymptote(a)) tMin = Number.NEGATIVE_INFINITY;
    else {
      const v = Math.tan(a);
      if (v < tMin) tMin = v;
      if (v > tMax) tMax = v;
    }
    if (atAsymptote(b)) tMax = Number.POSITIVE_INFINITY;
    else {
      const v = Math.tan(b);
      if (v < tMin) tMin = v;
      if (v > tMax) tMax = v;
    }
    if (tMin === Number.POSITIVE_INFINITY) tMin = Number.NEGATIVE_INFINITY;
  }

  return { sin: { min: sMin, max: sMax }, cos: { min: cMin, max: cMax }, tan: { min: tMin, max: tMax } };
}

// ---------------------------------------------------------------------------------
// the coupling chain, recovered from the coupling table
// ---------------------------------------------------------------------------------

// The joint ids, read off the topology rather than retyped.
const JOINTS: JointId[] = [...new Set(BODY_LINKS.map((l) => l.joint))];

// Values that drive every joint past its rest centre. jointDisplacement() clamps, so any
// magnitude beyond a joint's half-range reads as "fully travelled"; -3 and +3 cover all.
const PROBE = [-3, -1.5, 0, 1.5, 3];

function widthOf(joint: JointId, chain: Partial<Record<JointId, number>> = {}): number {
  const lim = effectiveLimits(joint, chain);
  return lim.max - lim.min;
}

/**
 * Does joint `k` narrow joint `j`? effectiveLimits() walks UP JOINT_PARENT from j, so it
 * only consults j's true ancestors; a joint that narrows j is therefore an ancestor of j
 * whose coupling is non-zero. This is how the parent chain is recovered WITHOUT retyping
 * it — JOINT_PARENT is not exported, so we read the structure back out of the coupling
 * behaviour it drives, and the tree can never disagree with the table.
 */
function narrows(k: JointId, j: JointId): boolean {
  const base = widthOf(j);
  return PROBE.some((v) => {
    const chain = { [k]: v } as Partial<Record<JointId, number>>;
    return widthOf(j, chain) < base - EPS;
  });
}

const ANCESTOR_CACHE: Partial<Record<JointId, JointId[]>> = {};

/** Every strict ancestor of `j` that actually narrows it, nearest first is not guaranteed. */
function ancestorsOf(j: JointId): JointId[] {
  const cached = ANCESTOR_CACHE[j];
  if (cached) return cached;
  const found = JOINTS.filter((k) => k !== j && narrows(k, j));
  ANCESTOR_CACHE[j] = found;
  return found;
}

/**
 * The direct parent of `j`: the one ancestor that is itself an ancestor of every other
 * ancestor (the nearest joint on the chain). Null for a top-level joint — one whose
 * JOINT_PARENT is null — which is exactly the root of the tree.
 */
function parentOf(j: JointId): JointId | null {
  const ancestors = ancestorsOf(j);
  if (ancestors.length === 0) return null;
  let parent: JointId | null = null;
  for (const a of ancestors) {
    const aboveAll = ancestors.every((o) => o === a || ancestorsOf(a).includes(o));
    if (aboveAll) parent = a;
  }
  return parent;
}

const CHILDREN: Partial<Record<JointId, JointId[]>> = {};
for (const j of JOINTS) {
  const p = parentOf(j);
  if (p !== null) (CHILDREN[p] ??= []).push(j);
}

/**
 * A joint's COUPLED range: the UNION of effectiveLimits(joint, ancestorPose) over every
 * ancestor angle in its own range, plus the neutral pose. This union is the substance of
 * the tree — a node's bounds are the true extremes reachable anywhere in its parent's
 * travel, not just at the neutral pose. Because effectiveLimits(joint, {}) is the widest
 * case (every ancestor at rest), the union resolves to that neutral range; the loop still
 * walks each ancestor's own endpoints and midpoint so the result is derived, not assumed.
 */
function unionRange(joint: JointId): TrigBounds {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  const consider = (chain: Partial<Record<JointId, number>>) => {
    const lim = effectiveLimits(joint, chain);
    if (lim.min < lo) lo = lim.min;
    if (lim.max > hi) hi = lim.max;
  };
  consider({});
  for (const a of ancestorsOf(joint)) {
    const r = effectiveLimits(a, {});
    for (const v of [r.min, (r.min + r.max) / 2, r.max]) {
      const chain = { [a]: v } as Partial<Record<JointId, number>>;
      consider(chain);
    }
  }
  return { min: finiteOr(lo, 0), max: finiteOr(hi, 0) };
}

// ---------------------------------------------------------------------------------
// the tree
// ---------------------------------------------------------------------------------

const AXES: Axis[] = ["x", "y", "z"];

function buildNode(joint: JointId, axis: Axis, depth: number, k: number): TrigNode {
  const range = unionRange(joint);
  const trig = trigBounds(range.min, range.max);
  const children = (CHILDREN[joint] ?? []).map((c) => buildNode(c, axis, depth + 1, k));
  return {
    joint,
    axis,
    depth,
    sin: { min: scaled(trig.sin.min, k), max: scaled(trig.sin.max, k) },
    cos: { min: scaled(trig.cos.min, k), max: scaled(trig.cos.max, k) },
    tan: { min: scaled(trig.tan.min, k), max: scaled(trig.tan.max, k) },
    children,
  };
}

/**
 * THE TREE. One root node per top-level joint (the joints whose JOINT_PARENT is null) per
 * axis, each carrying its children as the chain below it — shoulder -> elbow -> wrist,
 * hip -> knee -> ankle, waist -> ribcage -> neckJoint. `depth` is the distance from the
 * root (the top-level joint is 0). The bounds at each node come from that joint's coupled
 * range for the race, scaled by the race's reach so a dwarf and an elf differ. There is a
 * single top-level joint (the waist), so the returned array holds three roots, one per axis.
 */
export function axisTree(race: string, subrace: string | null = null): TrigNode[] {
  const k = proportionScale(raceSilhouette(race, subrace));
  const roots = JOINTS.filter((j) => parentOf(j) === null);
  return AXES.flatMap((axis) => roots.map((r) => buildNode(r, axis, 0, k)));
}

/**
 * Flatten the tree below `node` to a list, PARENTS BEFORE CHILDREN (pre-order), so a
 * caller can inject bounds in dependency order. Total: a null node yields an empty list.
 */
export function expand(node: TrigNode | null | undefined): TrigNode[] {
  if (!node) return [];
  const out: TrigNode[] = [];
  const walk = (n: TrigNode) => {
    out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(node);
  return out;
}

/**
 * The sin bounds of one joint on one axis for a race, so a caller can inject a single
 * value without walking the tree. Matches the node in axisTree() exactly; an unknown
 * joint/axis reads as the closed point {0, 0}.
 */
export function boundsFor(joint: JointId, axis: Axis, race: string, subrace: string | null = null): TrigBounds {
  for (const root of axisTree(race, subrace)) {
    for (const n of expand(root)) {
      if (n.joint === joint && n.axis === axis) return n.sin;
    }
  }
  return { min: 0, max: 0 };
}

/**
 * Scale a bound pair by the race's proportions (width · limbLength from RACE_SILHOUETTE).
 * Physically this is a REACH multiplier: a joint's angular envelope times the race's lever
 * arm. The same joint therefore yields different numbers for a dwarf (short, wide limbs)
 * and an elf (long, thin limbs). Monotone: a larger scale widens the interval. Total: a
 * NaN bound collapses to 0 and ±Infinity survives, so no input yields NaN.
 */
export function raceScaled(bounds: TrigBounds, race: string): TrigBounds {
  const k = proportionScale(RACE_SILHOUETTE[race] ?? RACE_SILHOUETTE.human);
  return { min: scaled(bounds.min, k), max: scaled(bounds.max, k) };
}
