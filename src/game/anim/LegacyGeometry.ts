// Legacy rig measurements from the pure body modules (lane C, R04).
//
// Pure module: reproduces, without Three.js, the numbers buildHumanoid (src/graphics/Humanoid.ts)
// derives for its legs, so the animator, the tests and the report can use the REAL proportions
// of a race before the rig is built. The equations are copied from buildHumanoid:
//   footDrop    = rootRadius(foot) · depth(foot) + 0.04          (local units)
//   legDrop     = 0.14 + 0.22 + thigh + shin + footDrop           spine pivot -> sole
//   crownRise   = 0.36 + 0.24 + head / 2
//   heightScale = height / (legDrop + crownRise)                  group scale
//   spineY      = legDrop - BODY_RADIUS / heightScale             BODY_RADIUS = 0.6
//   hipX        = (sil.hip - seat(thigh)) · weight / 70
// rootRadius(foot) is station 0 of BodySurface.stationsFor: root · (taper(0) + Σ bulge(0)) · pinch(0).

import { partShape, type RaceSilhouette, raceSilhouette } from "../BodyProfile.ts";
import { socketFor } from "../BodyGraph.ts";
import { bulge, pinch, taper } from "../ShapeEquations.ts";
import { legacyLegGeometry, type LegGeometry } from "./Rig.ts";

/** Height of the legacy rig origin above the ground (Humanoid BODY_RADIUS), m. */
export const LEGACY_BODY_RADIUS = 0.6;

/** Station-0 radius of a part (BodySurface.stationsFor(part, s)[0].radius), local units. */
function rootRadius(part: "foot", s: RaceSilhouette): number {
  const sh = partShape(part, s);
  let g = taper(0, ...sh.taper);
  for (const b of sh.bulges) g += bulge(0, ...b);
  if (sh.pinch) g *= pinch(0, ...sh.pinch);
  return sh.root * g;
}

/**
 * Leg geometry of the legacy pivot rig for a race / sub-race at a standing `height` (m, crown
 * to sole) and body `weight` (kg) — the same numbers buildHumanoid computes. Pass the exact
 * `silhouette` the rig was built with (Appearance.silhouette: the engine rolls a random one per
 * fighter); without it the race's base silhouette is used.
 */
export function legacyLegGeometryFor(
  race: string, subrace: string | null, height: number, weight: number, silhouette?: RaceSilhouette,
): LegGeometry {
  const sil = silhouette ?? raceSilhouette(race, subrace);
  const thigh = partShape("thigh", sil).length;
  const shin = partShape("shin", sil).length;
  const head = partShape("head", sil).length;
  const footDrop = rootRadius("foot", sil) * partShape("foot", sil).depth + 0.04;
  const legDrop = 0.14 + 0.22 + thigh + shin + footDrop;
  const crownRise = 0.36 + 0.24 + head / 2;
  const heightScale = height / (legDrop + crownRise);
  const spineY = legDrop - LEGACY_BODY_RADIUS / heightScale;
  const seat = socketFor("thigh")?.seat ?? 0;
  const hipX = (sil.hip - seat) * (weight / 70);
  return legacyLegGeometry({ heightScale, spineY, thigh, shin, footDrop, hipX });
}
