// Movement frame: turns the player's key/stick intent into a ground velocity.
//
// Two decisions live here so they are tested once and read the same everywhere:
//   1. DIRECTION is camera-relative: "forward" is where the camera looks, flattened onto
//      the ground; "right" is forward x up. Holding forward always walks away from the
//      camera, whichever camera is active and however the mouse has orbited it.
//   2. SPEED is smoothed, not instant: the velocity eases toward the target with
//      frame-rate independent damping, so starts and stops read as acceleration rather
//      than a teleporting pop, and slippery ground (ice) responds slower.
// Pure module: no THREE, no DOM.

import { damp } from "../core/MathCore.ts";
import type { MoveAxes } from "./Input.ts";

/** A unit vector on the ground plane (y = 0). */
export interface GroundDir { x: number; z: number }

/**
 * The ground-plane forward of a camera whose world look direction is (dx, dy, dz).
 * Falls back to `fallback` when the camera looks (almost) straight down, where the
 * horizontal part of the look vector carries no reliable heading.
 */
export function groundForward(dx: number, dz: number, fallback: GroundDir): GroundDir {
  const len = Math.hypot(dx, dz);
  return len > 1e-4 ? { x: dx / len, z: dz / len } : fallback;
}

/**
 * Intent -> world direction on the ground, with diagonals clamped to unit length so
 * moving diagonally is not ~41% faster. Right = forward x up = (-fz, +fx) in three.js's
 * right-handed, y-up frame.
 */
export function worldDirection(intent: MoveAxes, forward: GroundDir): GroundDir {
  const rightX = -forward.z, rightZ = forward.x;
  let x = forward.x * intent.forward + rightX * intent.strafe;
  let z = forward.z * intent.forward + rightZ * intent.strafe;
  const len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; }
  return { x, z };
}

/**
 * Damping rate (1/s) that closes 95% of a gap in `riseTime` seconds:
 *   1 - e^(-lambda * t95) = 0.95  =>  lambda = ln(20) / t95 ~= 3 / t95.
 */
export function lambdaForRiseTime(riseTime: number): number {
  return Math.log(20) / Math.max(1e-3, riseTime);
}

/** Tunables of the walk, all in SI units. */
export interface MoveTuning {
  /** Top speed on reference ground with no buffs (m/s). */
  topSpeed: number;
  /** Seconds to reach 95% of top speed from rest on reference ground. */
  riseTime: number;
}

/** Per-frame conditions that scale the walk. */
export interface MoveConditions {
  /** Ground speed multiplier (sand < 1, ice > 1). */
  surfaceSpeed: number;
  /** Ground slip: rise time multiplier (ice > 1 = slower to start and stop). */
  surfaceSlip: number;
  /** Buffs/statuses speed multiplier (1 = none). */
  speedMultiplier: number;
  /** Responsiveness multiplier (>= 1 = snappier, e.g. from high APM). */
  responsiveness: number;
  /** False while stunned/controlled: the target speed becomes 0. */
  canMove: boolean;
}

/**
 * Advance a ground velocity (m/s) one frame toward the intent and return it (mutated).
 * target = direction * topSpeed * surfaceSpeed * speedMultiplier
 * lambda = lambdaForRiseTime(riseTime * surfaceSlip) * responsiveness
 */
export function stepVelocity(
  velocity: GroundDir, direction: GroundDir, tuning: MoveTuning, c: MoveConditions, dt: number,
): GroundDir {
  const top = c.canMove ? tuning.topSpeed * c.surfaceSpeed * c.speedMultiplier : 0;
  const lambda = lambdaForRiseTime(tuning.riseTime * Math.max(0.05, c.surfaceSlip)) * Math.max(0.1, c.responsiveness);
  velocity.x = damp(velocity.x, direction.x * top, lambda, dt);
  velocity.z = damp(velocity.z, direction.z * top, lambda, dt);
  // Snap the last millimetre per second so an idle fighter is exactly still (the
  // walk animation keys off speed > 0).
  if (Math.hypot(velocity.x, velocity.z) < 1e-3 && direction.x === 0 && direction.z === 0) {
    velocity.x = 0; velocity.z = 0;
  }
  return velocity;
}
