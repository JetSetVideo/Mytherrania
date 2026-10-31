/**
 * SpectatorCamera — the persistent spectator-camera maths (Wave I, lane I-A).
 *
 * WHY this module exists: the gameplay third-person camera eases its mouse-orbit
 * offset back to zero on every idle frame (`#orbitYaw *= Math.exp(-1.8 * dt)`), so an
 * angle the viewer sets slips away as soon as they stop dragging. In spectator mode the
 * viewer OWNS the angle: nothing here decays, nothing depends on dt or on a drag state,
 * so the value that comes back is exactly the value that was put in. That is the whole
 * point of the module — `orbitCamera(s, 0, 0, …)` must be a no-op.
 *
 * Pure maths: no THREE.js, no DOM, no Math.random, so the parent can wire it into
 * `Engine.#updateCamera` without this file knowing anything about the scene.
 *
 * Vocabulary (matches docs/GLOSSARY.md §K — world up is +y, facing yaw 0 faces +z):
 *   yaw / pitch  orbit angles in radians. yaw turns the camera around the target in the
 *                horizontal plane; pitch raises it. pitch 0 is level with the target.
 *   dist         orbit radius in metres = the magnitude of the spherical offset.
 *   height       an extra lift added to the camera's y only (kept at 0 in the presets so
 *                the offset's distance from the target stays exactly `dist`).
 *   mode         who the CALLER anchors the look-at target to: "free" = the midpoint of
 *                the two fighters, "follow-a"/"follow-b" = seat 0 / seat 1. This module
 *                never needs to know which seat is where; it only carries the label.
 */
import { clamp, wrapAngle } from "../core/MathCore.ts";

/** How the caller anchors the camera: free (midpoint) or locked to one fighter's seat. */
export type SpectateCamMode = "free" | "follow-a" | "follow-b";

/** A complete spectator-camera state. Always treat these as immutable values. */
export interface SpectateCamState {
  mode: SpectateCamMode;
  yaw: number;
  pitch: number;
  dist: number;
  height: number;
}

/**
 * The reachable range, with reasons:
 * - pitch [-0.25, 1.55] rad: a little below the horizon keeps a genuine low angle
 *   possible; 1.55 (~89°) approaches a plan view without the up-vector flipping at the
 *   vertical. The camera is never buried in the ground.
 * - dist [2.5, 40] m: 2.5 m keeps a close duel legible without clipping into the
 *   fighters; 40 m frames the whole arena from a wide/broadcast vantage.
 * `yaw` is deliberately NOT bounded here: it is wrapped into [-π, π] by orbitCamera.
 */
export const SPECTATE_CAM_BOUNDS: { pitch: readonly [number, number]; dist: readonly [number, number] } = {
  pitch: [-0.25, 1.55],
  dist: [2.5, 40],
};

/** The starting state: free, behind the midpoint, a slight downward tilt. */
export const SPECTATE_CAM_DEFAULTS: SpectateCamState = {
  mode: "free",
  yaw: 0,
  pitch: 0.35,
  dist: 9,
  height: 0,
};

/**
 * The four named vantages the UI offers. Each `id` is stable (safe as an option value or
 * a stored key); `label` is for humans. All four are inside SPECTATE_CAM_BOUNDS and keep
 * `height` at 0 so a preset's camera sits exactly `dist` metres from the target.
 */
export const CAMERA_PRESETS: readonly { id: string; label: string; state: SpectateCamState }[] = Object.freeze([
  // A duel/close vantage: a low, slightly-angled near view of the two fighters.
  { id: "duel", label: "Duel", state: { mode: "free", yaw: 0.6, pitch: 0.28, dist: 5.5, height: 0 } },
  // A broadcast/wide vantage: pulled far back and up, the whole ring in frame.
  { id: "broadcast", label: "Broadcast", state: { mode: "free", yaw: -0.9, pitch: 0.5, dist: 22, height: 0 } },
  // A top-down vantage: a near-vertical plan view of the arena.
  { id: "topdown", label: "Top-down", state: { mode: "free", yaw: 0, pitch: 1.5, dist: 30, height: 0 } },
  // A low-angle vantage: almost level with the ground, looking across the fighters.
  { id: "lowangle", label: "Low angle", state: { mode: "free", yaw: 1.2, pitch: 0.06, dist: 8, height: 0 } },
]);

/** Wrapped into [-π, π]. An already-in-range value is returned UNCHANGED bit-for-bit, so an
 *  angle the viewer set is exactly the angle that comes back (MathCore.wrapAngle re-rounds
 *  in-range values and would break that identity). */
function wrapToPi(a: number): number {
  return a >= -Math.PI && a <= Math.PI ? a : wrapAngle(a);
}

/**
 * Pure orbit. `dx`/`dy` are already in radians (the caller applies its pixel->radian
 * sensitivity). `yaw` is WRAPPED into [-π, π] — never clamped to a dead end, so turning
 * past ±180° keeps going round — and `pitch` is clamped into SPECTATE_CAM_BOUNDS.pitch.
 *
 * It NEVER decays and never depends on `dt` or on any drag state: `orbitCamera(s, 0, 0, …)`
 * returns exactly `s`, which is the behaviour the viewer asked for.
 */
export function orbitCamera(
  s: SpectateCamState,
  dx: number,
  dy: number,
  sens: { yaw: number; pitch: number },
): SpectateCamState {
  return {
    mode: s.mode,
    yaw: wrapToPi(s.yaw + dx * sens.yaw),
    pitch: clamp(s.pitch + dy * sens.pitch, SPECTATE_CAM_BOUNDS.pitch[0], SPECTATE_CAM_BOUNDS.pitch[1]),
    dist: s.dist,
    height: s.height,
  };
}

/**
 * The distance multiplier of ONE zoom step. Multiplicative (steps > 0 pulls the camera
 * back, steps < 0 moves it in), so zoom feels the same near and far and is independent of
 * any rate — 15% of the current radius per step.
 */
export const ZOOM_STEP_RATIO = 1.15;

/** Multiplicative zoom by `steps` notches, clamped into SPECTATE_CAM_BOUNDS.dist. */
export function zoomCamera(s: SpectateCamState, steps: number): SpectateCamState {
  const d = s.dist * Math.pow(ZOOM_STEP_RATIO, steps);
  return {
    mode: s.mode,
    yaw: s.yaw,
    pitch: s.pitch,
    dist: clamp(d, SPECTATE_CAM_BOUNDS.dist[0], SPECTATE_CAM_BOUNDS.dist[1]),
    height: s.height,
  };
}

/** The cycle order used by {@link cycleMode}. */
const MODE_CYCLE: readonly SpectateCamMode[] = ["free", "follow-a", "follow-b"];

/** free -> follow-a -> follow-b -> free. An unknown mode restarts the cycle at "free". */
export function cycleMode(s: SpectateCamState): SpectateCamState {
  const next = MODE_CYCLE[(MODE_CYCLE.indexOf(s.mode) + 1) % MODE_CYCLE.length];
  return { mode: next ?? "free", yaw: s.yaw, pitch: s.pitch, dist: s.dist, height: s.height };
}

/**
 * Lock the camera to a seat (a click on a fighter), KEEPING the user's yaw/pitch/dist —
 * only the mode changes, so the angle the viewer set survives the focus.
 */
export function focusSeat(s: SpectateCamState, seat: 0 | 1): SpectateCamState {
  return { mode: seat === 0 ? "follow-a" : "follow-b", yaw: s.yaw, pitch: s.pitch, dist: s.dist, height: s.height };
}

/**
 * The camera pose for a state and a look-at target:
 *   position = target + (sin(yaw)·cos(pitch), sin(pitch), cos(yaw)·cos(pitch)) · dist, + height on y
 *   look     = target
 * With `height` 0 the position is exactly `dist` metres from the target, and for pitch >= 0
 * and height >= 0 the camera is never below the target's height.
 */
export function cameraPose(
  s: SpectateCamState,
  target: readonly [number, number, number],
): { position: [number, number, number]; look: [number, number, number] } {
  const cp = Math.cos(s.pitch);
  return {
    position: [
      target[0] + Math.sin(s.yaw) * cp * s.dist,
      target[1] + Math.sin(s.pitch) * s.dist + s.height,
      target[2] + Math.cos(s.yaw) * cp * s.dist,
    ],
    look: [target[0], target[1], target[2]],
  };
}

/** True for a plain object (not null, not an array). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A finite number from untrusted input, else the fallback (NaN/Infinity can never leak). */
function finiteOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** The stored form of a state: one flat JSON object. */
export function encodeSpectateCam(s: SpectateCamState): string {
  return JSON.stringify({ mode: s.mode, yaw: s.yaw, pitch: s.pitch, dist: s.dist, height: s.height });
}

/**
 * Decode a stored state. Total and never-throwing: an absent, empty, corrupt or non-object
 * string yields SPECTATE_CAM_DEFAULTS; an unknown mode falls back to the default mode; an
 * out-of-range pitch/dist is CLAMPED; a non-finite number falls back to its default. No
 * field is ever NaN.
 */
export function decodeSpectateCam(raw: string | null): SpectateCamState {
  if (!raw) return { ...SPECTATE_CAM_DEFAULTS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...SPECTATE_CAM_DEFAULTS };
  }
  if (!isRecord(parsed)) return { ...SPECTATE_CAM_DEFAULTS };
  const d = SPECTATE_CAM_DEFAULTS;
  const b = SPECTATE_CAM_BOUNDS;
  const mode = parsed.mode === "free" || parsed.mode === "follow-a" || parsed.mode === "follow-b" ? parsed.mode : d.mode;
  return {
    mode,
    yaw: wrapToPi(finiteOr(parsed.yaw, d.yaw)),
    pitch: clamp(finiteOr(parsed.pitch, d.pitch), b.pitch[0], b.pitch[1]),
    dist: clamp(finiteOr(parsed.dist, d.dist), b.dist[0], b.dist[1]),
    height: finiteOr(parsed.height, d.height),
  };
}
