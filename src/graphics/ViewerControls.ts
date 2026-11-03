/**
 * Wave THEME lane V — the Creator viewer's camera math (contract C-VIEW). PURE: no THREE.js, no DOM, no clock,
 * no randomness, so every rule below is a unit test (tests/wave_theme_viewer_test.ts, SPEC TH20-TH39).
 *
 * The camera is an ORBIT around a look-at `target`:
 *
 *   position = target + distance · (sin(yaw)·cos(pitch), sin(pitch), cos(yaw)·cos(pitch))
 *
 * (yaw 0 = the camera on +Z looking toward −Z; yaw π/2 = on +X; pitch > 0 = above the target), looking at the
 * target with world up +Y, vertical field of view `fovDeg`, canvas aspect w/h.
 *
 * - `orbit(state, dx, dy)` turns by pointer DELTAS in px (0.6 rad per 100 px, the wave-P sensitivity): yaw
 *   free, pitch clamped to [pitchMin, pitchMax] and to the camera floor (the camera never dips under `floorY`).
 *   The clamp is SOFT for a view that is already outside it (after an axis snap to ±Y): it never jumps back, it
 *   only refuses to move further out.
 * - `zoomAt(state, factor, ndcX, ndcY, hit?)` is a HOMOTHETY centred on the point under the cursor (the
 *   raycast hit, or the point of the cursor ray at the target's depth): camera AND target move toward it by the
 *   same ratio, the orientation is unchanged, so that point projects to the SAME pixel — exactly, while the
 *   distance clamp does not bind (the factor is clamped first, so a clamped zoom is still a homothety) and the
 *   target box does not bind (then the point may drift; the tests measure how far).
 * - `snapTo(state, axis)` puts the camera ON the named axis side, looking back along it at the target
 *   ("+X" = the view from +X: the camera at target + d·X̂, looking toward −X). ±Y use pitch ±(π/2 − SNAP_POLE_EPS)
 *   and yaw 0 so `lookAt` with up +Y stays defined.
 * - `reset(home)` returns the home view (the framing law's distance/target, the wave-P yaw/pitch).
 */

export type Vec3 = [number, number, number];
export type AxisId = "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";
export const AXIS_IDS: readonly AxisId[] = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"];

export interface ViewState {
  yaw: number;
  pitch: number;
  distance: number;
  target: Vec3;
}

export interface ViewLimits {
  /** Orbit pitch band, radians. */
  pitchMin: number;
  pitchMax: number;
  /** Camera distance band, metres. */
  distMin: number;
  distMax: number;
  /** The camera's position never goes below this height (m) while orbiting/zooming (snaps may). */
  floorY: number;
  /** The look-at target stays inside this box (m): [min, max] per axis. */
  targetMin: Vec3;
  targetMax: Vec3;
  /** Vertical field of view, degrees, and the canvas aspect (w/h) — needed to cast the cursor ray. */
  fovDeg: number;
  aspect: number;
}

/** Orbit sensitivity: radians per 100 px of pointer travel (wave P's value — tools/probe-wave-x-body.ts relies on it). */
export const ORBIT_RAD_PER_100PX = 0.6;
/** Snap to ±Y stops this short of the pole so lookAt(up = +Y) keeps a defined roll. */
export const SNAP_POLE_EPS = 1e-3;
/** Wheel gains: zoom factor = exp(deltaY_px · gain). Mouse wheel / two-finger scroll vs Mac pinch (ctrl+wheel). */
export const WHEEL_GAIN = 0.0015;
export const PINCH_GAIN = 0.01;
/** A DOM_DELTA_LINE wheel step in px, a DOM_DELTA_PAGE step in px. */
export const WHEEL_LINE_PX = 16;
export const WHEEL_PAGE_PX = 400;
/** One wheel event never zooms by more than this ratio either way (a flung trackpad stays controllable). */
export const ZOOM_STEP_MAX = 1.5;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const finite = (v: number, d: number) => (Number.isFinite(v) ? v : d);

/** Wrap an angle into (−π, π]. */
export function wrapAngle(a: number): number {
  const t = 2 * Math.PI;
  let r = ((a % t) + t) % t;
  if (r > Math.PI) r -= t;
  return r;
}

/** Unit vector from the target to the camera for (yaw, pitch). */
export function orbitDir(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return [Math.sin(yaw) * c, Math.sin(pitch), Math.cos(yaw) * c];
}

/** The camera's world position for a state. */
export function cameraPosition(s: ViewState): Vec3 {
  const d = orbitDir(s.yaw, s.pitch);
  return [s.target[0] + d[0] * s.distance, s.target[1] + d[1] * s.distance, s.target[2] + d[2] * s.distance];
}

/** Camera basis: forward (camera -> target), right, up (orthonormal, right-handed like THREE's lookAt). */
export function cameraBasis(s: ViewState): { fwd: Vec3; right: Vec3; up: Vec3 } {
  const d = orbitDir(s.yaw, s.pitch);
  const fwd: Vec3 = [-d[0], -d[1], -d[2]];
  // right = fwd × worldUp, normalised (worldUp = +Y); defined because |pitch| < π/2.
  let rx = -fwd[2], rz = fwd[0];
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl; rz /= rl;
  const right: Vec3 = [rx, 0, rz];
  // up = right × fwd
  const up: Vec3 = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];
  return { fwd, right, up };
}

/** Project a world point to NDC (x right, y up, both in [−1, 1] inside the frame) — the same law as THREE's camera. */
export function projectNdc(s: ViewState, lim: Pick<ViewLimits, "fovDeg" | "aspect">, p: Vec3): [number, number] {
  const c = cameraPosition(s), { fwd, right, up } = cameraBasis(s);
  const v: Vec3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const z = v[0] * fwd[0] + v[1] * fwd[1] + v[2] * fwd[2];
  const t = Math.tan((lim.fovDeg * Math.PI) / 360);
  const x = (v[0] * right[0] + v[1] * right[1] + v[2] * right[2]) / (z * t * lim.aspect);
  const y = (v[0] * up[0] + v[1] * up[1] + v[2] * up[2]) / (z * t);
  return [x, y];
}

/** The point of the cursor ray at NDC (x, y) whose depth along the view axis equals the target's (`distance`). */
export function cursorPointAtTargetDepth(s: ViewState, lim: Pick<ViewLimits, "fovDeg" | "aspect">, ndcX: number, ndcY: number): Vec3 {
  const c = cameraPosition(s), { fwd, right, up } = cameraBasis(s);
  const t = Math.tan((lim.fovDeg * Math.PI) / 360);
  const kx = ndcX * t * lim.aspect, ky = ndcY * t, d = s.distance;
  return [0, 1, 2].map((i) => c[i] + d * (fwd[i] + right[i] * kx + up[i] * ky)) as Vec3;
}

/** The lowest pitch whose camera stays at or above `floorY` for this target height and distance. */
function floorPitch(s: ViewState, lim: ViewLimits): number {
  const r = (lim.floorY - s.target[1]) / Math.max(1e-6, s.distance);
  return r <= -1 ? -Math.PI / 2 : r >= 1 ? Math.PI / 2 : Math.asin(r);
}

/**
 * Clamp a state into the limits: finite numbers, yaw wrapped, distance in [distMin, distMax], target in its box,
 * pitch in [max(pitchMin, floor pitch), pitchMax]. Total: any garbage in -> a valid state out.
 */
export function clampState(s: ViewState, lim: ViewLimits, home?: ViewState): ViewState {
  const h = home ?? { yaw: 0, pitch: 0, distance: (lim.distMin + lim.distMax) / 2, target: [0, 0, 0] as Vec3 };
  const target = [0, 1, 2].map((i) => clamp(finite(s.target?.[i] ?? NaN, h.target[i]), lim.targetMin[i], lim.targetMax[i])) as Vec3;
  const distance = clamp(finite(s.distance, h.distance), lim.distMin, lim.distMax);
  const out: ViewState = { yaw: wrapAngle(finite(s.yaw, h.yaw)), pitch: finite(s.pitch, h.pitch), distance, target };
  const lo = Math.max(lim.pitchMin, floorPitch(out, lim));
  out.pitch = clamp(out.pitch, Math.min(lo, lim.pitchMax), lim.pitchMax);
  return out;
}

/** Turn by pointer deltas (px). Soft pitch clamp: a view already outside the band may only move back toward it. */
export function orbit(s: ViewState, dx: number, dy: number, lim: ViewLimits): ViewState {
  const k = ORBIT_RAD_PER_100PX / 100;
  const yaw = wrapAngle(s.yaw + finite(dx, 0) * k);
  const lo0 = Math.max(lim.pitchMin, floorPitch(s, lim));
  const lo = Math.min(lo0, s.pitch), hi = Math.max(lim.pitchMax, s.pitch);
  const pitch = clamp(s.pitch - finite(dy, 0) * k, Math.min(lo, hi), hi);
  return { yaw, pitch, distance: s.distance, target: [...s.target] as Vec3 };
}

/**
 * Zoom by `factor` (< 1 = closer) about the point under the cursor at NDC (ndcX, ndcY): `hit` (the raycast hit on
 * the model) when given, else the cursor ray's point at the target's depth. The factor is clamped so the distance
 * stays in its band (and per-call to [1/ZOOM_STEP_MAX, ZOOM_STEP_MAX]); the new target is then clamped to its box.
 */
export function zoomAt(s: ViewState, factor: number, ndcX: number, ndcY: number, lim: ViewLimits, hit?: Vec3 | null): ViewState {
  let f = clamp(finite(factor, 1), 1 / ZOOM_STEP_MAX, ZOOM_STEP_MAX);
  const d1 = clamp(s.distance * f, lim.distMin, lim.distMax);
  f = d1 / s.distance;
  if (f === 1) return { ...s, target: [...s.target] as Vec3 };
  const h: Vec3 = hit && hit.every(Number.isFinite) ? hit : cursorPointAtTargetDepth(s, lim, clamp(finite(ndcX, 0), -1, 1), clamp(finite(ndcY, 0), -1, 1));
  const target = [0, 1, 2].map((i) => clamp(h[i] + (s.target[i] - h[i]) * f, lim.targetMin[i], lim.targetMax[i])) as Vec3;
  return { yaw: s.yaw, pitch: s.pitch, distance: d1, target };
}

/** Wheel event -> zoom factor. Mac pinch arrives as ctrl+wheel with small deltas: a larger gain. Pure. */
export function wheelFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  const px = finite(deltaY, 0) * (deltaMode === 1 ? WHEEL_LINE_PX : deltaMode === 2 ? WHEEL_PAGE_PX : 1);
  return clamp(Math.exp(px * (ctrlKey ? PINCH_GAIN : WHEEL_GAIN)), 1 / ZOOM_STEP_MAX, ZOOM_STEP_MAX);
}

/** Two-finger touch pinch: the zoom factor from the finger spread before/after (spread grows -> closer). */
export function pinchFactor(prevSpreadPx: number, spreadPx: number): number {
  if (!(prevSpreadPx > 0) || !(spreadPx > 0)) return 1;
  return clamp(prevSpreadPx / spreadPx, 1 / ZOOM_STEP_MAX, ZOOM_STEP_MAX);
}

/** Look along an axis: the camera on that axis's side of the target (see the module comment). Distance kept. */
export function snapTo(s: ViewState, axis: AxisId): ViewState {
  const pole = Math.PI / 2 - SNAP_POLE_EPS;
  const target = [...s.target] as Vec3;
  switch (axis) {
    case "+X": return { yaw: Math.PI / 2, pitch: 0, distance: s.distance, target };
    case "-X": return { yaw: -Math.PI / 2, pitch: 0, distance: s.distance, target };
    case "+Z": return { yaw: 0, pitch: 0, distance: s.distance, target };
    case "-Z": return { yaw: Math.PI, pitch: 0, distance: s.distance, target };
    case "+Y": return { yaw: 0, pitch: pole, distance: s.distance, target };
    case "-Y": return { yaw: 0, pitch: -pole, distance: s.distance, target };
  }
}

/** The home view (a fresh copy, so a caller cannot mutate the home). */
export function reset(home: ViewState): ViewState {
  return { yaw: home.yaw, pitch: home.pitch, distance: home.distance, target: [...home.target] as Vec3 };
}

/** The unit view direction (camera -> target) — what an axis snap is checked against. */
export function viewDirection(s: ViewState): Vec3 {
  return cameraBasis(s).fwd;
}

/**
 * The axis gizmo's 2D layout: each world axis end (±X, ±Y, ±Z) rotated into the camera frame -> a screen offset
 * (x right, y DOWN, in units of the gizmo radius) and a depth (> 0 = toward the viewer). Pure; AxisGizmo draws it.
 */
export function gizmoAxes(s: ViewState): { id: AxisId; x: number; y: number; depth: number }[] {
  const { fwd, right, up } = cameraBasis(s);
  const unit: Record<AxisId, Vec3> = { "+X": [1, 0, 0], "-X": [-1, 0, 0], "+Y": [0, 1, 0], "-Y": [0, -1, 0], "+Z": [0, 0, 1], "-Z": [0, 0, -1] };
  return AXIS_IDS.map((id) => {
    const a = unit[id];
    const dot = (b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    return { id, x: dot(right), y: -dot(up), depth: -dot(fwd) };
  });
}
