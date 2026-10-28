// Camera-occlusion fade: how transparent a blocking object should become so the
// viewed character is never hidden behind a wall between it and the camera.
//
// The user wants objects between the third-person camera and the character to go
// transparent in the radial area around the character. This module computes the
// target opacity from the geometry; the Engine raycasts, finds the blockers, and
// applies the alpha to their materials.
//
// Pure module: no Three.js, no DOM.

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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
