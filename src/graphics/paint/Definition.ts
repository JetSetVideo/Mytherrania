// Definition pass (lane P-C): the PAINTED follow-on to the sculpted muscle. A build's muscle
// term (Proportions.buildMuscleTerm) drives dark creases that read as the pectoral separation,
// the abdominal segments (transverse banding plus the centre linea alba) and the deltoid/biceps
// and quadriceps folds — the user's "textures being like painted and you can augment a bit the
// definition of them". A fat build keeps the creases but softens them.
//
// Pure module: no THREE, no DOM. Deterministic from (muscle, fat, skin, seed), and every layer
// is a normal PaintLayer so the existing compositor paints it with no new machinery.

import type { PaintLayer, PatternKind, Region } from "../body/contracts.ts";
import { shadeHex } from "./Blend.ts";

/**
 * Feature sizes as fractions of stature (m at 1.75 m), floored by the mesh's Nyquist limit so a
 * crease spans at least two vertices and survives the polygoniser's grid.
 */
export const DEFINITION_FEATURE = {
  abs: 0.045,     // transverse abdominal segment period (the rectus sections)
  linea: 0.05,    // the vertical centre groove between the two rectus sheets
  pec: 0.04,      // the sternal separation down the chest
  deltoid: 0.03,  // deltoid / biceps / triceps folds on the arms
  quad: 0.035,    // quadriceps / hamstring folds on the legs
} as const;

/** Muscle term above 1 -> crease strength: 0 at muscle 1.0, 0.30 at muscle 1.5 (clamped to 1). */
export const DEFINITION_GAIN = 0.6;
/** Below this strength the creases peak under ~2% opacity: invisible under cel bands, so skipped. */
export const DEFINITION_FLOOR = 0.02;
/** Fat softens the creases: softness = 1 / (SOFT_BASE + SOFT_SLOPE·fat). fat 1 -> 1.0, 1.34 -> 0.83. */
export const DEFINITION_SOFT_BASE = 0.6;
export const DEFINITION_SOFT_SLOPE = 0.4;

/** Everything the definition pass reads. */
export interface DefinitionInput {
  /** The build's muscle term (Proportions.muscle; > 1 = more defined). */
  muscle: number;
  /** The build's fat term (BuildRow.fat; > 1 softens the creases). */
  fat: number;
  /** Base skin tone the crease shade is derived from (never a hand-typed colour). */
  skin: string;
  /** Feature-size floor (m) = NYQUIST × vertex spacing, so a crease survives the grid. */
  minFeature: number;
  /** Stature (m) the feature sizes scale with, so a dwarf and an ork get proportionate creases. */
  height: number;
  /** Seed, so the creases are stable for one character. */
  seed: number;
}

/** One crease layer: the skin darkened by `shadeK`, multiplied in at `opacity`. */
function crease(
  name: string, pattern: PatternKind, skin: string, shadeK: number, opacity: number,
  scale: number, seed: number, regions: Region[], params: Record<string, number>,
): PaintLayer {
  return {
    name, pattern, colour: shadeHex(skin, shadeK), opacity: Math.max(1e-4, Math.min(0.6, opacity)),
    blend: "multiply", scale, seed: seed >>> 0, regions, params,
  };
}

/**
 * The definition layers for a body (bottom-first). Empty when the muscle term is at or below
 * DEFINITION_FLOOR's strength (a build with no added muscle), so a fit-with-no-muscle stack gains
 * nothing. The transverse abs layer is the muscle term's clearest tell; the arm/leg folds follow.
 */
export function definitionLayers(a: DefinitionInput): PaintLayer[] {
  const strength = Math.max(0, Math.min(1, (a.muscle - 1) * DEFINITION_GAIN));
  if (strength < DEFINITION_FLOOR) return [];
  const soft = 1 / (DEFINITION_SOFT_BASE + DEFINITION_SOFT_SLOPE * a.fat);
  const op = strength * soft;
  const size = (frac: number) => Math.max(a.minFeature, frac * a.height);
  const salt = (a.seed ^ 0x5bd1e995) >>> 0;
  return [
    // Abdominal segments: horizontal bands across the belly (the rectus abdominis sections).
    crease("def-abs", "stripes", a.skin, 0.70, 0.55 * op, size(DEFINITION_FEATURE.abs), salt,
      ["torso"], { angle: 0, width: 0.5, warp: 0.12, sharpness: 0.7, octaves: 2 }),
    // Linea alba: the vertical centre groove between the two rectus sheets.
    crease("def-linea", "stripes", a.skin, 0.66, 0.5 * op, size(DEFINITION_FEATURE.linea), salt ^ 0x11,
      ["torso"], { angle: Math.PI / 2, width: 0.28, warp: 0.1, sharpness: 0.8, octaves: 2 }),
    // Pectoral separation: the sternal groove down the middle of the chest.
    crease("def-pec", "stripes", a.skin, 0.62, 0.45 * op, size(DEFINITION_FEATURE.pec), salt ^ 0x22,
      ["torso", "neck"], { angle: Math.PI / 2, width: 0.22, warp: 0.08, sharpness: 0.85, octaves: 2 }),
    // Deltoid / biceps / triceps folds on the arms.
    crease("def-arm", "veins", a.skin, 0.72, 0.5 * op, size(DEFINITION_FEATURE.deltoid), salt ^ 0x33,
      ["upperArm", "foreArm"], { octaves: 3, threshold: 0.74, sharpness: 2, warp: 0.5 }),
    // Quadriceps / hamstring folds on the legs.
    crease("def-leg", "veins", a.skin, 0.72, 0.5 * op, size(DEFINITION_FEATURE.quad), salt ^ 0x44,
      ["thigh", "shin"], { octaves: 3, threshold: 0.74, sharpness: 2, warp: 0.5 }),
  ];
}
