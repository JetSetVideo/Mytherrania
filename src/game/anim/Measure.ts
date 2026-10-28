// Measurement helpers for the animator (lane C, R04): world-space foot points from the joint
// angles exactly as the rig renders them, stance drift tracking and per-frame velocity stats.
// Pure module (no Three.js, no DOM). Used by the tests and the numeric report; the engine can
// use footWorld() for footprints / dust / trails at the soles.

import { type LegFK3, legFK3, type LegGeometry, newLegFK3, type Side } from "./Rig.ts";

/** Where and how the rig origin is placed this frame (what the engine writes into rig.group). */
export interface RigPlacement {
  /** World position of the rig origin BEFORE the lateral offset, m. */
  x: number;
  y: number;
  z: number;
  /** rig.group.rotation.y, rad. */
  yaw: number;
  /** rig.group.rotation.z, rad (total roll: gait sway + external balance tilt). */
  roll: number;
  /** Shift along the rig's local x, m (AnimatorOutput.rootOffsetLateral). */
  lateral: number;
}

/** World positions of the sole points of one foot, m. */
export interface FootWorld {
  ballX: number; ballY: number; ballZ: number;
  heelX: number; heelY: number; heelZ: number;
  /** Toe-down pitch of the sole in the rig frame, rad. */
  pitch: number;
}

/** A zeroed FootWorld to reuse. */
export function newFootWorld(): FootWorld {
  return { ballX: 0, ballY: 0, ballZ: 0, heelX: 0, heelY: 0, heelZ: 0, pitch: 0 };
}

const FK: LegFK3 = newLegFK3();

/** Local rig point (lx, ly, lz) -> world, through roll (Rz) then lateral shift then yaw (Ry). */
function toWorld(r: RigPlacement, lx: number, ly: number, lz: number, out: Float64Array): void {
  const cr = Math.cos(r.roll), sr = Math.sin(r.roll);
  const x1 = lx * cr - ly * sr + r.lateral, y1 = lx * sr + ly * cr;
  const cy = Math.cos(r.yaw), sy = Math.sin(r.yaw);
  out[0] = r.x + x1 * cy + lz * sy;
  out[1] = r.y + y1;
  out[2] = r.z - x1 * sy + lz * cy;
}

const W = new Float64Array(3);

/**
 * World sole points of leg `side` for joint `angles` (JOINT_ORDER), the leg's hip abduction and
 * ankle counter-roll (AnimatorOutput.hipRoll / ankleRoll) and a rig placement — the full 3D chain
 * the rig renders (Rig.legFK3).
 */
export function footWorld(
  g: LegGeometry, angles: Float64Array, side: Side, r: RigPlacement, out: FootWorld, hipRoll = 0, ankleRoll = 0,
): FootWorld {
  legFK3(g, angles, side, hipRoll, ankleRoll, FK);
  toWorld(r, FK.ball[0], FK.ball[1], FK.ball[2], W);
  out.ballX = W[0]; out.ballY = W[1]; out.ballZ = W[2];
  toWorld(r, FK.heel[0], FK.heel[1], FK.heel[2], W);
  out.heelX = W[0]; out.heelY = W[1]; out.heelZ = W[2];
  out.pitch = Math.atan2(FK.heel[1] - FK.ball[1], FK.ball[2] - FK.heel[2]);
  return out;
}

/**
 * Tracks how far a planted foot SLIDES on the ground plane (x/z) during each stance, contact by
 * contact: the ball is anchored on the first stance frame it touches the ground (|y - ground| <
 * `contactTolerance`), the heel likewise, and each point's drift is its largest x/z distance
 * from its own anchor while it is still touching. A foot that rolls onto its ball (heel up) or
 * its heel (toes up) is therefore not counted as sliding, but a contact point that moves while
 * loaded is. Step drift = max(ball drift, heel drift). Stances shorter than `minFrames` are ignored.
 */
export class DriftTracker {
  /** Per stance: max(ball, heel) slide, m. */
  readonly perStep: number[] = [];
  /** Per stance: the ball's slide alone (the pivot when turning on the spot), m. */
  readonly perStepBall: number[] = [];
  #active = false;
  #frames = 0;
  readonly #anchor = new Float64Array(4); // ball x, z, heel x, z
  readonly #anchored = [false, false];
  readonly #max = new Float64Array(2);
  constructor(readonly minFrames = 3, readonly contactTolerance = 0.005) {}

  /** Feed one frame: planted flag, the sole points (world) and the ground height under each. */
  sample(planted: boolean, f: FootWorld, groundAtBall: number, groundAtHeel: number): void {
    if (!planted) { if (this.#active) this.#close(); return; }
    if (!this.#active) {
      this.#active = true; this.#frames = 0;
      this.#anchored[0] = this.#anchored[1] = false;
      this.#max[0] = this.#max[1] = 0;
    }
    this.#frames++;
    this.#point(0, f.ballX, f.ballZ, Math.abs(f.ballY - groundAtBall) < this.contactTolerance);
    this.#point(1, f.heelX, f.heelZ, Math.abs(f.heelY - groundAtHeel) < this.contactTolerance);
  }

  #point(k: 0 | 1, x: number, z: number, touching: boolean): void {
    if (!touching) return;
    if (!this.#anchored[k]) { this.#anchored[k] = true; this.#anchor[2 * k] = x; this.#anchor[2 * k + 1] = z; return; }
    this.#max[k] = Math.max(this.#max[k], Math.hypot(x - this.#anchor[2 * k], z - this.#anchor[2 * k + 1]));
  }

  /** Close an open stance (end of the run). */
  flush(): void { if (this.#active) this.#close(); }

  #close(): void {
    if (this.#frames >= this.minFrames) {
      this.perStep.push(Math.max(this.#max[0], this.#max[1]));
      this.perStepBall.push(this.#max[0]);
    }
    this.#active = false;
  }
}
