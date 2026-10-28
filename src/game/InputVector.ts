// High-responsiveness input: an analog movement vector polled at frame rate from
// keyboard AND controller, with APM-driven turn tightening, resolved into the
// local camera coordinate space.
//
// The user wants movement decoupled from animation cycles and tied to a polled
// analog vector (mouse + controller stick), with high APM giving a tighter turn
// radius and finer micro-adjustments. This module computes the movement vector
// in camera space and the responsiveness scalar; the Engine applies it to the body.
//
// Pure module: no Three.js, no DOM. Vectors are unit-length in the ground plane.

export interface Vec2 { x: number; z: number }

/** Raw analog state for one frame: keyboard axes plus an optional gamepad stick. */
export interface InputVector {
  /** Keyboard axis, -1..1 each (already combined: right - left, down - up). */
  keyX: number;
  keyZ: number;
  /** Gamepad left stick, -1..1 each, or null when no controller is active. */
  padX: number | null;
  padZ: number | null;
}

/**
 * The merged analog vector. The controller stick wins when it is pushed past the
 * dead zone (it is genuinely analog); the keyboard is the fallback. Result is
 * clamped to the unit circle so diagonal input is not faster.
 */
export function analogVector(iv: InputVector, deadZone = 0.18): Vec2 {
  let x = iv.keyX, z = iv.keyZ;
  if (iv.padX !== null && iv.padZ !== null && Math.hypot(iv.padX, iv.padZ) > deadZone) {
    x = iv.padX;
    z = iv.padZ;
  }
  const len = Math.hypot(x, z);
  if (len <= 1) return { x, z };
  return { x: x / len, z: z / len };
}

/**
 * Rotate a movement vector into camera space. `camYaw` is the camera's yaw about
 * the up axis (rad). The input's -z is "forward" (away from the camera), so the
 * vector rotates by the camera's facing:
 *   world = R(yaw) · input
 */
export function toCameraSpace(input: Vec2, camYaw: number): Vec2 {
  const c = Math.cos(camYaw), s = Math.sin(camYaw);
  return { x: input.x * c - input.z * s, z: input.x * s + input.z * c };
}

/**
 * Actions-per-minute tracker: a sliding window of recent action timestamps. High
 * APM means the player is actively micro-adjusting, so the turn radius tightens.
 */
export class ApmTracker {
  #times: number[] = [];
  /** Window in seconds over which APM is measured. */
  static readonly WINDOW = 10;

  /** Record an action at time t (s). */
  action(t: number): void {
    this.#times.push(t);
    this.prune(t);
  }

  /** Drop events older than the window. */
  prune(now: number): void {
    const cutoff = now - ApmTracker.WINDOW;
    while (this.#times.length && this.#times[0] < cutoff) this.#times.shift();
  }

  /** Actions per minute over the sliding window. */
  apm(now: number): number {
    this.prune(now);
    return (this.#times.length / ApmTracker.WINDOW) * 60;
  }
}

/**
 * Turn-radius scalar from APM: 1.0 at rest, shrinking toward MIN as APM climbs,
 * so a fast player turns on the spot and a slow player turns wide.
 *   scale = 1 - (1 - MIN) * (1 - e^(-apm / SOFTEN))
 */
export const TURN_MIN = 0.45;
export const TURN_SOFTEN = 60;

export function turnScale(apm: number): number {
  const t = 1 - Math.exp(-Math.max(0, apm) / TURN_SOFTEN);
  return 1 - (1 - TURN_MIN) * t;
}

/**
 * The movement step for one frame: the camera-space analog vector scaled by speed
 * and the APM turn tightening. `speed` is m/s, `dt` the frame delta.
 */
export function movementStep(iv: InputVector, camYaw: number, speed: number, dt: number, apm: number): Vec2 {
  const local = analogVector(iv);
  const world = toCameraSpace(local, camYaw);
  const scale = turnScale(apm) * speed * dt;
  return { x: world.x * scale, z: world.z * scale };
}
