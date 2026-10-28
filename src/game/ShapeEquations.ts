// Shape equations: the maths that turns a race's proportions into the cross-section of
// a body part at any height.
//
// Everything here is a CONTINUOUS function of (t, θ) — t along the part, θ around it —
// so the surfaces are smooth and neighbouring vertices never meet at a right angle.
// There are no primitives in this model: a section is a superellipse (an organic oval,
// never a circle and never a square) modulated by directional muscle lobes, then
// tapered and pinched along the part's length.
//
// Pure module: no Three.js, no DOM.

/** A directional bulge on a cross-section: where it points, how strong, how tight. */
export interface Lobe {
  /** Angle around the section, radians. 0 = forward (+z), π/2 = the body's left. */
  angle: number;
  /** Peak gain added to the base radius (0.1 = +10%). */
  amp: number;
  /** How tight the lobe is; higher = a narrower ridge. */
  sharp: number;
}

/**
 * Radial gain from a set of lobes. Each lobe only ADDS where it faces (a half-cosine
 * raised to its sharpness), so a pectoral lobe fattens the chest without denting the
 * back. Returns 0 when no lobe faces θ, so the base section is untouched.
 */
export function lobeGain(theta: number, lobes: Lobe[]): number {
  let gain = 0;
  for (const l of lobes) {
    const c = Math.cos(theta - l.angle);
    if (c > 0) gain += l.amp * Math.pow(c, l.sharp);
  }
  return gain;
}

/**
 * Superellipse cross-section: |x/a|^n + |z/b|^n = 1, sampled at angle θ.
 *
 * n = 2 is an ellipse, n > 2 squares off the corners, n < 2 pinches them into a
 * diamond. The body model keeps n in [1.75, 2.45] — enough asymmetry to read as a
 * torso rather than a tube, never enough to produce a corner.
 */
export function superellipse(theta: number, a: number, b: number, n: number): { x: number; z: number } {
  const ct = Math.cos(theta), st = Math.sin(theta);
  const e = 2 / n;
  return {
    x: a * Math.sign(ct) * Math.pow(Math.abs(ct), e),
    z: b * Math.sign(st) * Math.pow(Math.abs(st), e),
  };
}

/**
 * Taper along a part: `root` at the base, easing to `tip` at the far end. `bias` < 1
 * keeps the part full for longer (a thigh), > 1 drains it early (a forearm).
 */
export function taper(t: number, root: number, tip: number, bias: number): number {
  return tip + (root - tip) * Math.pow(1 - Math.max(0, Math.min(1, t)), bias);
}

/** A muscle bulge centred at `c`, width `w`, peaking at `amp` (a Gaussian). */
export function bulge(t: number, c: number, w: number, amp: number): number {
  const d = (t - c) / w;
  return amp * Math.exp(-d * d);
}

/** A waist pinch: narrows the section around `c` by `depth` (0..1). */
export function pinch(t: number, c: number, w: number, depth: number): number {
  const d = (t - c) / w;
  return 1 - depth * Math.exp(-d * d);
}

/**
 * The full radial multiplier at (t, θ) for a part: its taper, its bulges along the
 * length, its waist pinch and its directional lobes, multiplied together.
 *
 *   r(t, θ) = taper(t) · (1 + Σ bulge(t)) · pinch(t) · (1 + lobeGain(θ))
 */
export function sectionGain(
  t: number,
  theta: number,
  taperArgs: [number, number, number],
  bulges: [number, number, number][],
  pinchArgs: [number, number, number] | null,
  lobes: Lobe[],
): number {
  let g = taper(t, ...taperArgs);
  for (const b of bulges) g += bulge(t, ...b);
  if (pinchArgs) g *= pinch(t, ...pinchArgs);
  return g * (1 + lobeGain(theta, lobes));
}

/**
 * Blend between two sections' gains, so a CONNECTOR (hand into forearm, neck into
 * skull) is a smooth interpolation rather than a joint between two shapes.
 * `u` = 0 at the first section, 1 at the second; the smoothstep keeps the tangents
 * matched at both ends, so no crease forms.
 */
export function blendGain(u: number, a: number, b: number): number {
  const k = Math.max(0, Math.min(1, u));
  const s = k * k * (3 - 2 * k);
  return a * (1 - s) + b * s;
}

/**
 * How far a part's section is from circular, 0..1. Used to keep generated silhouettes
 * organic: a part whose sections collapse toward a circle loses the race's character.
 */
export function eccentricity(a: number, b: number, lobes: Lobe[]): number {
  const ratio = Math.abs(a - b) / Math.max(1e-6, a + b);
  const lobeMass = lobes.reduce((s, l) => s + l.amp, 0) / (1 + lobes.reduce((s, l) => s + l.amp, 0));
  return Math.min(1, ratio * 2 + lobeMass * 0.5);
}

/**
 * An angular constraint for one joint: the resting angle plus the swing allowed each
 * way, scaled by the state and the race. A braced state narrows the range; a heavy
 * race narrows it further, because mass resists articulation.
 */
export function constraint(
  rest: number,
  range: { min: number; max: number },
  stateScale: number,
  raceScale: number,
): { min: number; max: number } {
  const k = Math.max(0.05, stateScale * raceScale);
  return { min: rest + (range.min - rest) * k, max: rest + (range.max - rest) * k };
}

/** True when a joint angle is inside its constraint (used by the deform check). */
export function withinConstraint(angle: number, c: { min: number; max: number }, slack = 1e-6): boolean {
  return angle >= c.min - slack && angle <= c.max + slack;
}

/**
 * The sharpest turn in a ring of sampled section points, in radians: 0 means the ring
 * is perfectly smooth, π/2 means two edges meet at a RIGHT ANGLE. A surface built from
 * primitives corners hard; this is the check that the lofted body does not.
 */
export function maxCorner(points: { x: number; z: number }[]): number {
  const n = points.length;
  if (n < 3) return 0;
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const p = points[(i - 1 + n) % n], q = points[i], r = points[(i + 1) % n];
    const ax = q.x - p.x, az = q.z - p.z;
    const bx = r.x - q.x, bz = r.z - q.z;
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    if (la < 1e-9 || lb < 1e-9) continue;
    const cosTurn = (ax * bx + az * bz) / (la * lb);
    // Straight-through gives cos 1 → turn 0; a right angle gives cos 0 → turn π/2.
    worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, cosTurn))));
  }
  return worst;
}
