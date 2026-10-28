// Weapon-grip stance solver: the pitch/roll the blade should hold for the
// current technique, and how the hand closes around the handle.
//
// The user wants the blade up the +z axis at rest, levelled onto the forward
// vector for a thrust, lifted near-vertical for a high guard, and rolled onto
// the swing plane for a slash — with the palm and fist tracking the handle.
// This module computes the target grip angles from the technique and the swing
// phase; the Skeleton owns an instance, and the Humanoid rig reads it through
// setGrip() every frame.
//
// Pure module: no Three.js, no DOM. Angles in radians.

export type GripStance = "rest" | "thrust" | "guard" | "swing-h" | "swing-v" | "swing-d";

export interface GripPose {
  /** Rotation about the hand's local x: negative lays the blade up. */
  pitch: number;
  /** Rotation about the hand's local z: the guard/swing plane. */
  roll: number;
  /** How closed the fist is, 0 (open palm) .. 1 (tight grip). */
  fist: number;
}

/** Rest: blade up the +z axis with a slight forward cant, fingers curled. */
export const REST_GRIP: GripPose = { pitch: -0.35, roll: 0, fist: 0.85 };
/** Thrust: blade level with the forward vector (horizontal), fist tight. */
export const THRUST_GRIP: GripPose = { pitch: -1.5, roll: 0, fist: 1.0 };
/** Guard: blade near-vertical (80-90 deg to the ground), edge out, fist tight. */
export const GUARD_GRIP: GripPose = { pitch: -0.12, roll: Math.PI / 2, fist: 1.0 };
/** Horizontal slash: blade laid onto the horizontal swing plane. */
export const SWING_H_GRIP: GripPose = { pitch: -1.35, roll: Math.PI / 2, fist: 1.0 };
/** Vertical chop: blade in the vertical plane overhead. */
export const SWING_V_GRIP: GripPose = { pitch: -0.5, roll: 0, fist: 1.0 };
/** Diagonal cut: between the two, rolled halfway. */
export const SWING_D_GRIP: GripPose = { pitch: -0.9, roll: Math.PI / 4, fist: 1.0 };

const POSES: Record<GripStance, GripPose> = {
  rest: REST_GRIP,
  thrust: THRUST_GRIP,
  guard: GUARD_GRIP,
  "swing-h": SWING_H_GRIP,
  "swing-v": SWING_V_GRIP,
  "swing-d": SWING_D_GRIP,
};

/** The current grip, eased toward the stance's target so the blade does not snap. */
export class GripSolver {
  #pose: GripPose = { ...REST_GRIP };
  #target: GripPose = { ...REST_GRIP };

  /** Set the stance the grip should move to. */
  setStance(stance: GripStance): void {
    this.#target = { ...POSES[stance] };
  }

  /** Ease the current grip toward the target and return it. Call once per frame. */
  update(dt: number): GripPose {
    const k = 1 - Math.exp(-16 * dt);
    this.#pose.pitch += (this.#target.pitch - this.#pose.pitch) * k;
    this.#pose.roll += (this.#target.roll - this.#pose.roll) * k;
    this.#pose.fist += (this.#target.fist - this.#pose.fist) * k;
    return this.#pose;
  }

  pose(): GripPose { return this.#pose; }
}

/**
 * Pick the grip stance for a technique. A defense skill guards; a power skill
 * with a thrust payload thrusts; everything else swings on one of the three arc
 * planes, chosen from the swing phase so consecutive attacks alternate direction
 * the way the user asked ("some technics change the swing direction").
 */
export function stanceForTechnique(kind: "dash" | "power" | "defense", thrust: boolean, swingIndex: number): GripStance {
  if (kind === "defense") return "guard";
  if (thrust) return "thrust";
  const planes: GripStance[] = ["swing-h", "swing-d", "swing-v"];
  return planes[((swingIndex % planes.length) + planes.length) % planes.length];
}
