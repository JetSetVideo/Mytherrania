// Contract between lane A (body generation) and lane B (paint layers), and between the
// body pipeline and the engine. Written by the parent BEFORE the lanes start; lanes code
// against these types. New fields must be OPTIONAL so every consumer keeps compiling.
//
// Coordinate frame (BIND POSE, model space): metres, +y up, +z forward (the way the
// character faces), +x the character's LEFT. The soles rest on y = 0 in the bind pose.
//
// Producer signatures (lane A implements these; lane B and the engine call them):
//
//   // src/graphics/body/Sdf.ts
//   export function evaluate(node: SdfNode, p: Vec3): SdfSample;
//   // src/graphics/body/Polygonize.ts
//   export function polygonize(field: (p: Vec3) => SdfSample, bounds: Bounds, cell: number): MeshData;
//   // src/graphics/body/MeshStats.ts
//   export function meshStats(mesh: MeshData): MeshStats;
//   // src/graphics/body/SkinWeights.ts
//   export function computeSkinWeights(mesh: MeshData, bones: BoneSegment[], maxInfluences?: number): SkinData;
//   // src/graphics/body/Anatomy.ts
//   export function anatomyFor(spec: BodySpec): AnatomyPlan;
//   // src/graphics/body/SkinnedHumanoid.ts  (implements the existing HumanoidRig interface)
//   export function buildSkinnedHumanoid(weapon, appearance, element, spec?: BodySpec): HumanoidRig & SkinnedExtras;
//
// Lane B implements:
//
//   // src/graphics/paint/Layers.ts
//   export function paintVertices(mesh: MeshData, stack: PaintStack): Float32Array; // RGB per vertex, 0..1

import type { JointName } from "../../game/Skeleton.ts";

/** A point or direction in metres (bind-pose model space). */
export type Vec3 = [number, number, number];

/** Axis-aligned box in model space. */
export interface Bounds { min: Vec3; max: Vec3 }

/**
 * Anatomical region of the skin, used for paint masks and per-region material.
 * The index into REGIONS is what MeshData.region stores per vertex.
 */
export const REGIONS = [
  "torso", "pelvis", "neck", "head", "face", "ear", "upperArm", "foreArm", "hand",
  "thigh", "shin", "foot", "sole", "hair", "nail",
] as const;
export type Region = typeof REGIONS[number];

/** A bone a primitive follows, or the root (pelvis frame). */
export type BoneId = JointName | "root";

/** Signed-distance primitive kinds. Every distance is exact or a conservative bound. */
export type PrimitiveKind = "sphere" | "ellipsoid" | "capsule" | "roundCone" | "roundBox" | "torus";

/**
 * One anatomical volume. `a` is the centre (sphere, ellipsoid, roundBox, torus) or the
 * segment start (capsule, roundCone); `b` the segment end. `r` is the radius (sphere,
 * capsule), the start radius (roundCone), the corner radius (roundBox) or the major
 * radius (torus); `r2` the end radius (roundCone) or the minor radius (torus).
 * `size` holds ellipsoid radii or roundBox half-extents; `rot` is an XYZ Euler (rad).
 */
export interface Primitive {
  id: string;
  kind: PrimitiveKind;
  a: Vec3;
  b?: Vec3;
  r: number;
  r2?: number;
  size?: Vec3;
  rot?: Vec3;
  bone: BoneId;
  region: Region;
}

/**
 * Volume (CSG) operators. The smooth variants blend over a width `k` metres (polynomial
 * smooth-min), which is what makes one continuous skin instead of intersecting tubes.
 * union = min(a, b); subtract = max(a, -b); intersect = max(a, b).
 */
export type VolumeOp = "union" | "subtract" | "intersect" | "smoothUnion" | "smoothSubtract" | "smoothIntersect";

/** An SDF scene graph: primitives combined left-to-right by n-ary volume operators. */
export type SdfNode =
  | { type: "primitive"; primitive: Primitive }
  | { type: "op"; op: VolumeOp; k: number; children: SdfNode[] };

/**
 * Sculpt brushes, applied to the field (or, for `smooth`, to the mesh) after the
 * volumes. Every brush has a centre, a radius of influence (metres) with a smooth
 * falloff to 0 at the edge, and a signed strength (metres of displacement at the
 * centre). `axis` is the push direction / crease line / twist axis where relevant.
 */
export type BrushKind =
  | "inflate"   // grow the surface outward along its normal
  | "deflate"   // shrink inward along the normal
  | "dig"       // carve a cavity (smooth subtract of a sphere)
  | "pushPull"  // move the surface along `axis`
  | "pinch"     // pull the surface toward the brush centre (sharpens a ridge)
  | "crease"    // cut a narrow groove along `axis`
  | "flatten"   // press onto the plane through `centre` with normal `axis`
  | "smooth"    // relax the mesh (Laplacian) inside the radius
  | "twist"     // rotate about `axis` proportionally to distance along it
  | "bend";     // bend about `axis`
export interface BrushStroke {
  kind: BrushKind;
  centre: Vec3;
  radius: number;
  strength: number;
  axis?: Vec3;
  /** Why this stroke exists, in anatomy words ("kneecap", "clavicle notch"). */
  purpose: string;
}

/** What the field returns at a point: signed distance (negative inside) and the dominant region/bone. */
export interface SdfSample { d: number; region: number; bone: number }

/** An indexed triangle mesh produced by the polygoniser. */
export interface MeshData {
  positions: Float32Array;   // xyz per vertex
  normals: Float32Array;     // unit xyz per vertex
  indices: Uint32Array;      // 3 per triangle, counter-clockwise seen from outside
  region: Uint8Array;        // index into REGIONS per vertex
  bone?: Uint8Array;         // dominant bone index per vertex (into AnatomyPlan.bones)
}

/** Topology facts that prove the skin is whole (R03): 0 boundary edges, 1 component. */
export interface MeshStats {
  vertices: number;
  triangles: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  components: number;
  minY: number;
  maxY: number;
}

/** A bone as a segment in bind pose, used for skin weights and for building THREE.Bone. */
export interface BoneSegment {
  id: BoneId;
  parent: BoneId | null;
  head: Vec3;   // the joint (pivot) position
  tail: Vec3;   // where the bone ends (the child joint, or a tip)
  /** Rotation axis the Skeleton drives for this joint. */
  axis: "x" | "y" | "z";
}

/** Linear-blend-skinning attributes: up to 4 influences per vertex, weights sum to 1. */
export interface SkinData { skinIndex: Uint16Array; skinWeight: Float32Array }

/** Who the body is for. Everything else in the plan is DERIVED from these. */
export interface BodySpec {
  race: string;
  subrace: string | null;
  className: string;
  /** Standing height in metres (crown to sole). */
  height: number;
  /** Body mass in kg; drives girth through BMI-like ratios. */
  weight: number;
  seed: number;
  /** Birth sign id (e.g. "serpent"); drives the paint recipe's warpaint/tattoo. Optional. */
  birthsign?: string | null;
}

/** The full generated body: volumes, brushes, bones and the box to polygonise. */
export interface AnatomyPlan {
  root: SdfNode;
  strokes: BrushStroke[];
  bones: BoneSegment[];
  bounds: Bounds;
  /** Grid cell size in metres the plan was designed for (detail vs triangle budget). */
  cell: number;
}

/** Paint layer blend modes (Photoshop semantics, per channel, 0..1). */
export type BlendMode = "normal" | "multiply" | "screen" | "overlay" | "softLight" | "add";

/** Procedural patterns a layer can draw. */
export type PatternKind =
  | "solid" | "noise" | "stripes" | "spots" | "scales" | "freckles" | "gradient" | "warpaint" | "veins" | "tattoo";

/** One paint layer: a pattern, its colour(s), where it applies (mask) and how it blends. */
export interface PaintLayer {
  name: string;
  pattern: PatternKind;
  colour: string;          // "#rrggbb"
  colour2?: string;        // second colour for two-tone patterns
  opacity: number;         // 0..1
  blend: BlendMode;
  scale: number;           // pattern feature size in metres
  regions?: Region[];      // mask: only these regions (all when absent)
  /** Pattern parameters (density, sharpness, angle, …), documented by the pattern. */
  params?: Record<string, number>;
  seed?: number;
}

/** An ordered stack, bottom first. */
export interface PaintStack { layers: PaintLayer[] }
