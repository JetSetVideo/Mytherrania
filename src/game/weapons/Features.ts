// Strike features (W06 -> lane X): the edges, points, heads and shafts of a weapon in WEAPON
// LOCAL space, derived from the same form the mesh is built from. Lane X sweeps each one.
//
// Conventions (contracts.ts StrikeFeature):
//   edge   polyline from base to tip following the blade curve; `facing` = unit mean of the
//          per-point edge normals (+z for the primary edge of a straight blade).
//   point  single point; `facing` = the THRUST AXIS (unit), e.g. +y for a sword tip.
//   head   sphere centre + radius (mace, flail ball, hammer face, maul faces, axe poll, ferrule).
//   shaft  segment (haft / staff), blunt.
// Capsule radii are contact tolerances, not visual sizes.

import type { ArchetypeId, DamageKind, StrikeFeature, V3 } from "../../combat/contracts.ts";
import { ARCHETYPES } from "./Archetypes.ts";
import {
  bladeEdgeNormalAt, bladeHalfWidthAt, bladePointAt, bladeTangentAt, bowLimbPoint, type PhysicalAxes, POINT_FRACTION,
  type WeaponForm,
} from "./Form.ts";

/** Edge capsule radius, m: an edge "touches" within ~1 cm of its line. */
export const EDGE_CAPSULE = 0.01;
/** Point capsule radius, m. */
export const POINT_CAPSULE = 0.008;
/** Polyline points along a curved edge (straight edges need only their two ends). */
export const CURVED_EDGE_POINTS = 7;
/** Back-edge keenness relative to the primary edge (sharpened, but less carefully). */
export const BACK_EDGE_KEENNESS = 0.9;
/** A sabre's false edge covers the last share of the blade, at this keenness. */
export const FALSE_EDGE_SHARE = 0.3;
export const FALSE_EDGE_KEENNESS = 0.75;

const mixOf = (cut: number, thrust: number, blunt: number): Record<DamageKind, number> => {
  const s = cut + thrust + blunt;
  return { cut: cut / s, thrust: thrust / s, blunt: blunt / s };
};
/** An edge cuts in proportion to its keenness; a dull edge bruises. */
const edgeMix = (sharp: number) => mixOf(0.5 + 0.5 * sharp, 0, 0.5 - 0.5 * sharp);
const pointMix = (sharp: number) => mixOf(0, 0.6 + 0.4 * sharp, 0.4 - 0.4 * sharp);
const BLUNT = mixOf(0, 0, 1);

function normalize(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Edge polyline along the blade (arc s0..s1) on the side `side` (+1 edge side, -1 spine side). */
function bladeEdge(form: WeaponForm, s0: number, s1: number, side: 1 | -1, sharp: number): StrikeFeature {
  const curved = Math.abs(form.bladeTurn) > 1e-4;
  const n = curved ? CURVED_EDGE_POINTS : 2;
  const points: V3[] = [];
  const sum: V3 = [0, 0, 0];
  const c: V3 = [0, 0, 0], nr: V3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const s = s0 + (s1 - s0) * (i / (n - 1));
    bladePointAt(form, s, c);
    bladeEdgeNormalAt(form, s, nr);
    const w = bladeHalfWidthAt(form, s);
    points.push([c[0] + nr[0] * w * side, c[1] + nr[1] * w * side, c[2] + nr[2] * w * side]);
    sum[0] += nr[0] * side; sum[1] += nr[1] * side; sum[2] += nr[2] * side;
  }
  return { kind: "edge", points, radius: EDGE_CAPSULE, facing: normalize(sum), sharpness: sharp, mix: edgeMix(sharp) };
}

/** Axe/halberd bit: a vertical edge at depth `depth`, horns swept back by the crescent. */
function bitEdge(centreY: number, height: number, depth: number, crescent: number, sharp: number): StrikeFeature {
  const points: V3[] = [];
  const n = 5;
  // Bearded: the lower horn hangs 60% of the height below the head centre.
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const y = centreY - 0.6 * height + t * height;
    const z = depth - crescent * 0.3 * height * (2 * t - 1) * (2 * t - 1);
    points.push([0, y, z]);
  }
  const sum: V3 = [0, 0, 0];
  for (let i = 1; i < n; i++) {
    const dy = points[i][1] - points[i - 1][1], dz = points[i][2] - points[i - 1][2];
    sum[1] += -dz; sum[2] += dy; // tangent (dy, dz) turned toward +z
  }
  return { kind: "edge", points, radius: EDGE_CAPSULE, facing: normalize(sum), sharpness: sharp, mix: edgeMix(sharp) };
}

const shaftFeature = (y0: number, y1: number, radius: number): StrikeFeature => ({
  kind: "shaft", points: [[0, y0, 0], [0, y1, 0]], radius, sharpness: 0, mix: BLUNT,
});
const headFeature = (c: V3, radius: number, mix: Record<DamageKind, number>): StrikeFeature => ({
  kind: "head", points: [c], radius, sharpness: 0, mix,
});
const pointFeature = (p: V3, axis: V3, sharp: number): StrikeFeature => ({
  kind: "point", points: [p], radius: POINT_CAPSULE, facing: normalize(axis), sharpness: sharp, mix: pointMix(sharp),
});

/** Hammer back spike: length and droop (rad) from the head size and curvature. */
export function hammerSpike(headRadius: number, curvature: number): { length: number; droop: number } {
  return { length: 2.6 * headRadius + 0.02, droop: 0.6 * curvature };
}
/**
 * Halberd geometry shared by the features and the mesh: the axe blade (55% of the head) sits
 * under the top spike (45%); the back fluke leaves the haft at the blade centre and droops.
 */
export function halberdBlade(forward: number, headLength: number): { height: number; centreY: number } {
  const height = 0.55 * headLength;
  return { height, centreY: forward - 0.45 * headLength - height / 2 };
}
export function halberdFluke(forward: number, headLength: number, headRadius: number, shaftRadius: number): { base: V3; tip: V3 } {
  const b = halberdBlade(forward, headLength);
  return { base: [0, b.centreY, -shaftRadius], tip: [0, b.centreY - 0.1 * b.height, -0.6 * headRadius] };
}
/** Axe poll (the blunt back of the head) radius, m: ~0.18 x bit height, within 1.5-5 cm. */
export function axePollRadius(bitHeight: number): number {
  return Math.min(0.05, Math.max(0.015, 0.18 * bitHeight));
}
/** Maul block half-length along z (two striking faces), m: a sledge block is ~1.8x its face. */
export const MAUL_BLOCK_RATIO = 1.8;

/** The striking features of one weapon. */
export function strikeFeatures(id: ArchetypeId, axes: PhysicalAxes, form: WeaponForm): StrikeFeature[] {
  const a = ARCHETYPES[id];
  const s = axes.sharpness, R = axes.headRadius, H = axes.headLength;
  const sr = form.details.shaftRadius;
  const out: StrikeFeature[] = [];
  const tip: V3 = [0, 0, 0], axis: V3 = [0, 0, 0];

  if (a.family === "blade") {
    const Lb = form.bladeLength;
    const edgeEnd = Lb * (1 - POINT_FRACTION * 0.5);
    out.push(bladeEdge(form, 0.03 * Lb, edgeEnd, 1, s));
    if (form.singleEdged) out.push(bladeEdge(form, (1 - FALSE_EDGE_SHARE) * Lb, edgeEnd, -1, s * FALSE_EDGE_KEENNESS));
    else out.push(bladeEdge(form, 0.03 * Lb, edgeEnd, -1, s * BACK_EDGE_KEENNESS));
    out.push(pointFeature(bladePointAt(form, Lb, tip), bladeTangentAt(form, Lb, axis), s));
    return out;
  }
  if (a.head === "scythe") {
    const Lb = form.bladeLength;
    out.push(bladeEdge(form, 0.05 * Lb, 0.95 * Lb, 1, s));
    out.push(pointFeature(bladePointAt(form, Lb, tip), bladeTangentAt(form, Lb, axis), s));
    out.push(shaftFeature(-form.tail, form.shaftTopY, sr));
    return out;
  }
  if (a.head === "leaf") {
    const base = form.forward - H;
    out.push(pointFeature([0, form.forward, 0], [0, 1, 0], s));
    for (const side of [1, -1] as const) {
      const pts: V3[] = [[0, base + 0.1 * H, side * 0.4 * R], [0, base + 0.4 * H, side * R], [0, form.forward - 0.1 * H, side * 0.25 * R]];
      out.push({ kind: "edge", points: pts, radius: EDGE_CAPSULE, facing: [0, 0, side], sharpness: s * 0.9, mix: edgeMix(s * 0.9) });
    }
    out.push(shaftFeature(-form.tail, base, sr));
    return out;
  }
  if (a.head === "halberd") {
    const { height: bladeH, centreY: cy } = halberdBlade(form.forward, H);
    out.push(bitEdge(cy + 0.1 * bladeH, bladeH, R, axes.curvature, s));
    out.push(pointFeature([0, form.forward, 0], [0, 1, 0], s));
    const fluke = halberdFluke(form.forward, H, R, sr);
    out.push(pointFeature(fluke.tip, [0, fluke.tip[1] - fluke.base[1], fluke.tip[2] - fluke.base[2]], s * 0.8));
    out.push(shaftFeature(-form.tail, form.shaftTopY, sr));
    return out;
  }
  if (a.head === "axe") {
    out.push(bitEdge(form.headCentreY, H, R, axes.curvature, s));
    const pollR = axePollRadius(H);
    out.push(headFeature([0, form.headCentreY, -(sr + pollR)], pollR, BLUNT));
    out.push(shaftFeature(-form.tail, form.shaftTopY, sr));
    return out;
  }
  if (a.head === "flanged") {
    out.push(headFeature([0, form.headCentreY, 0], R, mixOf(0.3 * s, 0, 1 - 0.3 * s)));
    out.push(shaftFeature(-form.tail, form.headCentreY - H / 2, sr));
    return out;
  }
  if (a.head === "ball") {
    out.push(headFeature([0, form.headCentreY, 0], R, mixOf(0, 0.15 + 0.3 * s, 0.85 - 0.3 * s)));
    out.push(shaftFeature(-form.tail, form.shaftTopY, sr));
    return out;
  }
  if (a.head === "hammer") {
    const faceZ = sr + 0.035;
    out.push(headFeature([0, form.headCentreY, faceZ], R, BLUNT));
    const spike = hammerSpike(R, axes.curvature);
    const dir: V3 = [0, -Math.sin(spike.droop), -Math.cos(spike.droop)];
    out.push(pointFeature([0, form.headCentreY + dir[1] * spike.length, sr + dir[2] * spike.length], dir, Math.max(0.3, s)));
    out.push(shaftFeature(-form.tail, form.headCentreY - H / 2, sr));
    return out;
  }
  if (a.head === "block") {
    const half = MAUL_BLOCK_RATIO * R;
    out.push(headFeature([0, form.headCentreY, half - R], R, BLUNT));
    out.push(headFeature([0, form.headCentreY, -(half - R)], R, BLUNT));
    out.push(shaftFeature(-form.tail, form.headCentreY - H / 2, sr));
    return out;
  }
  if (a.head === "ferrule") {
    const capR = 1.25 * sr;
    out.push(shaftFeature(-form.tail, form.forward, sr));
    out.push(headFeature([0, form.forward - capR, 0], capR, BLUNT));
    out.push(headFeature([0, -form.tail + capR, 0], capR, BLUNT));
    return out;
  }
  // Bow: the limbs can bash (blunt), riser -> tip along the limb curve.
  const half = axes.length / 2;
  for (const sign of [1, -1] as const) {
    const points = [0, 0.5, 1].map((t) => bowLimbPoint(half, form.braceHeight, axes.curvature, sign, t));
    out.push({ kind: "shaft", points, radius: sr, sharpness: 0, mix: BLUNT });
  }
  return out;
}
