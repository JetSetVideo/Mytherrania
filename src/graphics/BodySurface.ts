// Body surface: turns a race's proportions into the actual geometry of each part.
//
// This is the layer between the numbers (game/BodyProfile.ts) and the rig
// (graphics/Humanoid.ts): it samples the shape equations into loft stations, builds the
// surface, and carries the material properties (specular, absorption) that make flesh
// read as flesh and a blade read as metal.
//
// No primitives: every part is a lofted sweep (graphics/Loft.ts).

// @deno-types="@types/three"
import * as THREE from "three";
import { partShape, type BodyPartName, type RaceSilhouette } from "../game/BodyProfile.ts";
import { bulge, eccentricity, maxCorner, pinch, sectionGain, taper } from "../game/ShapeEquations.ts";
import { loftGeometry, sectionRing, type LoftStation } from "./Loft.ts";

/** Samples taken along a part when building its stations. */
export const PART_SAMPLES = 11;
/** Points sampled around a section. */
export const PART_SIDES = 22;

/**
 * The stations of one part: the taper, the muscle bulges and the waist pinch sampled
 * along the length. The directional lobes ride on each station so the ring builder
 * applies them per angle.
 */
/** The parts whose SIDE profile the angular-plane ask is about. */
const TORSO_PARTS: ReadonlySet<BodyPartName> = new Set<BodyPartName>(["chest", "abdomen", "pelvis", "pectorals", "scapulae"]);

export function stationsFor(part: BodyPartName, s: RaceSilhouette, samples = PART_SAMPLES): LoftStation[] {
  const sh = partShape(part, s);
  const out: LoftStation[] = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    let g = taper(t, ...sh.taper);
    for (const b of sh.bulges) g += bulge(t, ...b);
    if (sh.pinch) g *= pinch(t, ...sh.pinch);
    // Torso parts take the angular-side-plane exponent; the limbs, hands and feet keep the race's base
    // exponent (see RaceSilhouette.sectionNBase): the angular change must not move a contact surface.
    const torso = TORSO_PARTS.has(part);
    out.push({ t, radius: sh.root * g, depth: sh.depth, n: torso ? s.sectionN : (s.sectionNBase ?? s.sectionN), lobes: sh.lobes });
  }
  return out;
}

/** The built surface of one part, plus the data a rig or a QA pass needs. */
export interface PartSurface {
  part: BodyPartName;
  geometry: THREE.BufferGeometry;
  /** Length along the part, metres. */
  height: number;
  /** Root radius, metres. */
  rootRadius: number;
  /** Tip radius, metres. */
  tipRadius: number;
  /** Worst corner in any section: 0 is smooth, π/2 would be a right angle. */
  worstCorner: number;
  /** How far the sections are from circular, 0..1. */
  eccentricity: number;
}

/** Build one part's surface from a silhouette. */
export function buildPart(part: BodyPartName, s: RaceSilhouette): PartSurface {
  const sh = partShape(part, s);
  const stations = stationsFor(part, s);
  const geometry = loftGeometry(
    { stations, sides: PART_SIDES, capRings: 3, capDepth: sh.cap },
    sh.length,
  );
  let worstCorner = 0;
  for (const st of stations) worstCorner = Math.max(worstCorner, maxCorner(sectionRing(st, PART_SIDES)));
  return {
    part,
    geometry,
    height: sh.length,
    rootRadius: stations[0].radius,
    tipRadius: stations[stations.length - 1].radius,
    worstCorner,
    eccentricity: eccentricity(stations[0].radius, stations[0].radius * sh.depth, sh.lobes),
  };
}

/** A sampled point on a part's surface, for silhouette comparison. */
export interface SurfaceSample {
  part: BodyPartName;
  t: number;
  theta: number;
  /** Radius from the part's axis, metres. */
  r: number;
}

/**
 * Sample a part's surface as (t, θ) → radius using the FULL radial equation (taper,
 * bulges, pinch and lobes together). This is what the silhouette checks read: the same
 * numbers the geometry is built from.
 */
export function sampleSurface(part: BodyPartName, s: RaceSilhouette, tSamples = 9, thSamples = 16): SurfaceSample[] {
  const sh = partShape(part, s);
  const out: SurfaceSample[] = [];
  for (let i = 0; i < tSamples; i++) {
    const t = i / (tSamples - 1);
    for (let k = 0; k < thSamples; k++) {
      const theta = (k / thSamples) * Math.PI * 2;
      const r = sh.root * sectionGain(t, theta, sh.taper, sh.bulges, sh.pinch, sh.lobes);
      out.push({ part, t, theta, r });
    }
  }
  return out;
}

/** The widest and deepest extent of a part, for cross-race silhouette comparison. */
export function partExtent(part: BodyPartName, s: RaceSilhouette): { width: number; depth: number } {
  const samples = sampleSurface(part, s);
  let width = 0, depth = 0;
  for (const p of samples) {
    width = Math.max(width, Math.abs(Math.cos(p.theta) * p.r));
    depth = Math.max(depth, Math.abs(Math.sin(p.theta) * p.r));
  }
  return { width, depth };
}

/**
 * Material properties for a part. `specular` drives the cel shader's highlight (metal
 * only), `absorb` how much the surface swallows light before the ink band (skin and
 * cloth absorb; a blade does not), and `rough` how tight the highlight is.
 */
export interface SurfaceMaterial {
  specular: number;
  absorb: number;
  rough: number;
}

/** Per-part material properties. Complete: every part has an entry. */
export const PART_MATERIALS: Record<BodyPartName, SurfaceMaterial> = {
  chest: { specular: 0, absorb: 0.34, rough: 1 },
  // The two plate groups sit slightly proud of the ribcage and catch a little more light,
  // so they read as raised muscle over the torso rather than a painted-on stripe.
  pectorals: { specular: 0.08, absorb: 0.3, rough: 1 },
  scapulae: { specular: 0.06, absorb: 0.32, rough: 1 },
  abdomen: { specular: 0, absorb: 0.36, rough: 1 },
  pelvis: { specular: 0, absorb: 0.34, rough: 1 },
  neck: { specular: 0, absorb: 0.3, rough: 1 },
  head: { specular: 0.05, absorb: 0.26, rough: 1 },
  upperArm: { specular: 0, absorb: 0.34, rough: 1 },
  foreArm: { specular: 0, absorb: 0.33, rough: 1 },
  hand: { specular: 0, absorb: 0.32, rough: 1 },
  thigh: { specular: 0, absorb: 0.35, rough: 1 },
  shin: { specular: 0, absorb: 0.34, rough: 1 },
  foot: { specular: 0, absorb: 0.38, rough: 1 },
};

/** The material for a part, darkened by the race's tint so races differ in tone. */
export function partMaterial(part: BodyPartName): SurfaceMaterial {
  return PART_MATERIALS[part];
}
