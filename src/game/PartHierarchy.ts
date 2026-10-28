// The body's constraint hierarchy: the rule that a part's limits are NOT free, but
// DERIVED from its parent's.
//
// Why this exists: the shape equations (ShapeEquations.ts) and the body profile
// (BodyProfile.ts) give every part a shape, but each part's numbers are declared in
// isolation. That is how a generator rolls a child whose radius is larger than the
// socket it must emerge from, and the joint step — the seam the eye reads as a
// detached limb — comes back. This module makes the ranges HIERARCHICAL: a child's
// absolute range is a function of the parent's chosen value, so a body that is valid
// at the root is valid everywhere down the chain.
//
// Three structures, all derived rather than retyped so they can never disagree with
// the topology they describe:
//   - PART_TREE          — every part as a node with parent, side and depth, built
//                          from BODY_LINKS.
//   - PART_SHAPE_RANGES  — the absolute {min,max,base} of each part's shape
//                          parameters, each naming the parent parameter it scales with.
//   - JOINT_CONSTRAINTS  — each joint's {joint,axis,min,max} plus the coupling table
//                          that narrows a joint as its parent joint travels.
//
// The engine calls resolveRange() first: fix the root, then resolve each part from its
// parent's values downward. validateChain() rejects an out-of-range silhouette and
// randomWithin() draws a value that can never be out of range.
//
// Pure module: no Three.js, no DOM, zero runtime dependencies.

import { BODY_LINKS, BODY_ROOT, type BodyLink, type BodySide, type JointId } from "./BodyGraph.ts";
import { BODY_PARTS, BODY_PART_SHAPES, type BodyPartName, type BodyPartShape } from "./BodyProfile.ts";

// ---------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------

/** A finite number or `fallback`. The single totality guard every entry point uses. */
function finite(x: number | undefined, fallback: number): number {
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}

// ---------------------------------------------------------------------------------
// 1. PART_TREE — derived from BODY_LINKS
// ---------------------------------------------------------------------------------

/** One part in the hierarchy: where it hangs, which side, how deep below the root. */
export interface PartNode {
  part: BodyPartName;
  /** The part it is seated into, or null for the root. */
  parent: BodyPartName | null;
  /**
   * Which side of the body the part lives on. Mirrored parts (arms, legs) are recorded
   * ONCE, on their representative (left) link: the range and joint logic below is
   * side-independent, so left and right resolve identically.
   */
  side: BodySide;
  /** Distance from the root, in links. The root is 0. */
  depth: number;
}

/** Pick the link that seats a part: a centre link wins, else the first (left). */
function seatLink(links: BodyLink[]): Map<BodyPartName, BodyLink> {
  const out = new Map<BodyPartName, BodyLink>();
  for (const link of links) {
    const held = out.get(link.to);
    const better = !held || (held.side !== "centre" && link.side === "centre");
    if (better) out.set(link.to, link);
  }
  return out;
}

function buildTree(): Record<BodyPartName, PartNode> {
  const seats = seatLink(BODY_LINKS);
  const depthOf = (part: BodyPartName): number => {
    const link = seats.get(part);
    if (!link || part === BODY_ROOT) return 0;
    return 1 + depthOf(link.from);
  };
  const tree = {} as Record<BodyPartName, PartNode>;
  for (const part of BODY_PARTS) {
    const link = seats.get(part);
    const isRoot = part === BODY_ROOT || link === undefined;
    tree[part] = {
      part,
      parent: isRoot ? null : link.from,
      side: isRoot ? "centre" : link.side,
      depth: depthOf(part),
    };
  }
  return tree;
}

/** Every part as a node: parent, side and depth, derived from BODY_LINKS. */
export const PART_TREE: Record<BodyPartName, PartNode> = buildTree();

// ---------------------------------------------------------------------------------
// 2. PART_SHAPE_RANGES — the absolute {min,max,base} per shape parameter
// ---------------------------------------------------------------------------------

/** The shape parameters a part owns. These are the knobs the silhouette is rolled from. */
export type ShapeParam = "length" | "rootRadius" | "taper" | "bulge" | "pinch" | "lobe" | "depth";

/** The parameters in a fixed order, so every table iterates the same way. */
const SHAPE_PARAMS: readonly ShapeParam[] = ["length", "rootRadius", "taper", "bulge", "pinch", "lobe", "depth"];

/** Each parameter's absolute {base,min,max} plus the parent parameter it scales with. */
export type PartShapeRange = Record<ShapeParam, {
  base: number;
  min: number;
  max: number;
  /** The parent parameter this one scales with, or null at the root. */
  inherits: ShapeParam | null;
}>;

/** How much a parameter may vary around its baseline, as a fraction of the base. */
const PARAM_SPREAD: Record<ShapeParam, number> = {
  length: 0.18, rootRadius: 0.22, taper: 0.30, bulge: 0.40, pinch: 0.45, lobe: 0.40, depth: 0.15,
};

/** Which parent parameter each parameter scales with. Child limits follow the parent. */
const PARAM_INHERITS: Record<ShapeParam, ShapeParam> = {
  length: "length", rootRadius: "rootRadius", taper: "taper",
  bulge: "bulge", pinch: "pinch", lobe: "lobe", depth: "depth",
};

/** The absolute base of each parameter, read off the part's declared shape. */
const PARAM_BASE: Record<ShapeParam, (s: BodyPartShape) => number> = {
  length: (s) => s.length,
  rootRadius: (s) => s.root,
  taper: (s) => s.taper[2],
  bulge: (s) => s.bulges.reduce((m, b) => Math.max(m, b[2]), 0),
  pinch: (s) => (s.pinch ? s.pinch[2] : 0),
  lobe: (s) => s.lobes.reduce((m, l) => Math.max(m, Math.abs(l.amp)), 0),
  depth: (s) => s.depth,
};

/**
 * The fraction of the parent's value that a child's parameter may not exceed. Only the
 * socket radius is hard-capped: a child whose root radius outgrows the parent's leaves a
 * step at the joint, which is exactly the detached limb this module prevents. Every other
 * parameter is bounded only by its proportional scale.
 */
const SOCKET_CAP: Record<ShapeParam, number> = {
  length: Number.POSITIVE_INFINITY, rootRadius: 0.7, taper: Number.POSITIVE_INFINITY,
  bulge: Number.POSITIVE_INFINITY, pinch: Number.POSITIVE_INFINITY,
  lobe: Number.POSITIVE_INFINITY, depth: Number.POSITIVE_INFINITY,
};

function buildRanges(): Record<BodyPartName, PartShapeRange> {
  const out = {} as Record<BodyPartName, PartShapeRange>;
  for (const part of BODY_PARTS) {
    const shape = BODY_PART_SHAPES[part];
    const rooted = PART_TREE[part].parent !== null;
    const rec = {} as PartShapeRange;
    for (const param of SHAPE_PARAMS) {
      const base = PARAM_BASE[param](shape);
      const spread = PARAM_SPREAD[param];
      rec[param] = {
        base,
        min: Math.max(0, base * (1 - spread)),
        max: base * (1 + spread),
        inherits: rooted ? PARAM_INHERITS[param] : null,
      };
    }
    out[part] = rec;
  }
  return out;
}

const PART_SHAPE_RANGES: Record<BodyPartName, PartShapeRange> = buildRanges();

/** The resolved {min,max} of every parameter after the parent has been fixed. */
export type ResolvedRanges = Record<ShapeParam, { min: number; max: number }>;

/**
 * The child's ACTUAL {min,max} once the parent is fixed.
 *
 * A parameter whose `inherits` names a parent parameter scales with the parent's chosen
 * value: shrink the parent and the child's range shrinks with it. The socket radius is
 * additionally capped at SOCKET_CAP · parentRadius, so a child can never outgrow the
 * socket it must emerge from. The root has no parent, so its range is intrinsic.
 *
 * Total: a missing or non-finite parent value is treated as the parent's base, so no
 * input can produce NaN.
 */
export function resolveRange(
  part: BodyPartName,
  parentValues: Partial<Record<ShapeParam, number>> = {},
): ResolvedRanges {
  const parent = PART_TREE[part].parent;
  const range = PART_SHAPE_RANGES[part];
  const parentRange = parent ? PART_SHAPE_RANGES[parent] : null;
  const out = {} as ResolvedRanges;
  for (const param of SHAPE_PARAMS) {
    const spec = range[param];
    const inherited = spec.inherits !== null && parentRange !== null;
    const parentValue = finite(inherited ? parentValues[spec.inherits as ShapeParam] : undefined, Number.NaN);
    const parentBase = inherited ? parentRange![spec.inherits as ShapeParam].base : 0;
    const scale = Number.isFinite(parentValue) && parentBase > 0 ? parentValue / parentBase : 1;
    const cap = Number.isFinite(parentValue) ? SOCKET_CAP[param] * parentValue : Number.POSITIVE_INFINITY;
    const hi = Math.min(spec.max * scale, cap);
    const lo = Math.min(spec.min * scale, hi);
    const min = Math.max(0, finite(lo, 0));
    out[param] = { min, max: Math.max(min, finite(hi, min)) };
  }
  return out;
}

// ---------------------------------------------------------------------------------
// 3. JOINT_CONSTRAINTS — per-joint limits plus the coupling table
// ---------------------------------------------------------------------------------

/** One joint's base constraint: the axis it travels on and the range it travels through. */
export interface JointConstraint {
  joint: JointId;
  axis: string;
  min: number;
  max: number;
}

const JOINT_CONSTRAINTS: Record<JointId, JointConstraint> = {
  waist: { joint: "waist", axis: "pitch", min: -0.5, max: 0.5 },
  ribcage: { joint: "ribcage", axis: "yaw", min: -0.35, max: 0.35 },
  neckJoint: { joint: "neckJoint", axis: "yaw", min: -0.7, max: 0.7 },
  shoulder: { joint: "shoulder", axis: "pitch", min: -2.0, max: 2.0 },
  elbow: { joint: "elbow", axis: "pitch", min: 0.0, max: 2.4 },
  wrist: { joint: "wrist", axis: "roll", min: -0.8, max: 0.8 },
  hip: { joint: "hip", axis: "pitch", min: -1.2, max: 0.9 },
  knee: { joint: "knee", axis: "pitch", min: 0.0, max: 2.3 },
  ankle: { joint: "ankle", axis: "pitch", min: -0.5, max: 0.5 },
};

/**
 * The joint above each joint. This is what makes the coupling COMPOSE: shoulder -> elbow
 * -> wrist, hip -> knee -> ankle, waist -> ribcage -> neckJoint, and the arms and legs
 * both hang off the spine chain.
 */
const JOINT_PARENT: Record<JointId, JointId | null> = {
  waist: null,
  ribcage: "waist",
  neckJoint: "ribcage",
  shoulder: "ribcage",
  elbow: "shoulder",
  wrist: "elbow",
  hip: "waist",
  knee: "hip",
  ankle: "knee",
};

/**
 * How much a joint's travel narrows its children, per unit of the joint's own normalised
 * displacement. Keyed by the joint that DOES the narrowing: shoulder narrows the elbow,
 * the elbow narrows the wrist, and so on up the chain.
 */
const JOINT_COUPLING: Record<JointId, number> = {
  waist: 0.40, ribcage: 0.45, neckJoint: 0.30,
  shoulder: 0.60, elbow: 0.70, wrist: 0.0,
  hip: 0.65, knee: 0.70, ankle: 0.0,
};

/** How far a joint is from its rest centre, 0..1, clamped. Total for any input. */
function jointDisplacement(joint: JointId, angle: number | undefined): number {
  const base = JOINT_CONSTRAINTS[joint];
  const centre = (base.min + base.max) / 2;
  const half = Math.max(1e-9, (base.max - base.min) / 2);
  const a = finite(angle, centre);
  return Math.max(0, Math.min(1, Math.abs(a - centre) / half));
}

/**
 * The joint's effective {min,max} for the current pose.
 *
 * Walks UP the chain — joint, parent joint, grandparent joint — and narrows the range by
 * every ancestor's coupling. The further a parent has travelled, the tighter the child.
 * Composes across the whole chain: a wrist narrows for both its elbow and its shoulder.
 *
 * Total: a missing or non-finite ancestor angle reads as "at rest", so no input yields NaN.
 */
export function effectiveLimits(
  joint: JointId,
  chainAngles: Partial<Record<JointId, number>> = {},
): { min: number; max: number } {
  const base = JOINT_CONSTRAINTS[joint];
  const centre = (base.min + base.max) / 2;
  let scale = 1;
  let cur: JointId | null = JOINT_PARENT[joint];
  while (cur !== null) {
    scale *= 1 - JOINT_COUPLING[cur] * jointDisplacement(cur, chainAngles[cur]);
    cur = JOINT_PARENT[cur];
  }
  const k = Math.max(0.05, Math.min(1, finite(scale, 1)));
  return { min: centre + (base.min - centre) * k, max: centre + (base.max - centre) * k };
}

// ---------------------------------------------------------------------------------
// 4. validateChain — reject an out-of-range silhouette
// ---------------------------------------------------------------------------------

/** One broken bound: which part, which parameter, the value and the bound it broke. */
export interface Violation {
  part: BodyPartName;
  param: ShapeParam;
  value: number;
  min: number;
  max: number;
}

/** A whole silhouette's chosen values, part by part. Missing parts fall back to base. */
export type SilhouetteValues = Partial<Record<BodyPartName, Partial<Record<ShapeParam, number>>>>;

/**
 * Every bound `part`'s chosen values break, against the range resolved from its parent's
 * values. A generator calls this per part and rejects the silhouette on any violation.
 *
 * Total: a non-finite value is reported (its shown value is coerced to the lower bound),
 * and the reported bounds are always finite.
 */
export function validateChain(part: BodyPartName, values: SilhouetteValues = {}): Violation[] {
  const parent = PART_TREE[part].parent;
  const parentValues = parent ? values[parent] ?? {} : {};
  const resolved = resolveRange(part, parentValues);
  const own = values[part] ?? {};
  const out: Violation[] = [];
  for (const param of SHAPE_PARAMS) {
    const value = own[param];
    if (typeof value !== "number") continue;
    const bound = resolved[param];
    if (Number.isFinite(value) && value >= bound.min && value <= bound.max) continue;
    out.push({ part, param, value: finite(value, bound.min), min: bound.min, max: bound.max });
  }
  return out;
}

// ---------------------------------------------------------------------------------
// 5. randomWithin — draw a value that can never break the silhouette
// ---------------------------------------------------------------------------------

/**
 * A value for every parameter, drawn inside the RESOLVED range for `part` given its
 * parent's values. Because it samples the resolved range rather than the raw base, a
 * random body can never come out with a broken silhouette.
 *
 * Total: a non-finite rng draw reads as the lower bound, so no input yields NaN.
 */
export function randomWithin(
  part: BodyPartName,
  parentValues: Partial<Record<ShapeParam, number>> = {},
  rng: () => number = Math.random,
): Record<ShapeParam, number> {
  const resolved = resolveRange(part, parentValues);
  const out = {} as Record<ShapeParam, number>;
  for (const param of SHAPE_PARAMS) {
    const bound = resolved[param];
    const u = Math.max(0, Math.min(1, finite(rng(), 0)));
    out[param] = bound.min + (bound.max - bound.min) * u;
  }
  return out;
}
