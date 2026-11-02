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

import type { ArchetypeId } from "../combat/contracts.ts";
import type { GripMetrics, WristBand } from "./PalmWeapon.ts";

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

// ---------------------------------------------------------------------------------------------
// Lane G (wave V): how each weapon is CARRIED, as data. The user: "axes or lances always have the
// blade pointing toward the top / outward from the body; only daggers can be held with the blade
// going down." The striking end (blade, head, point) of every archetype points up and/or outward at
// guard — never at the ground, never into its holder — and only a dagger whose profile prefers the
// reverse grip carries it blade-down. A bow is held by the riser with its limbs vertical and the
// string toward the archer. The wrist band (PalmWeapon.WristBand) is how far the handle may turn
// inside the closed hand (radial: blade back toward the elbow; ulnar: toward the finger line).
// ---------------------------------------------------------------------------------------------


/** How the striking end is carried at guard. */
export type CarryRule = "up-out" | "reverse-down" | "upright-bow";

export interface GripRule {
  carry: CarryRule;
  /** May this weapon be held blade-down (reverse "ice-pick" grip)? Only daggers. */
  reverseAllowed: boolean;
  /** Wrist range of the hand around this weapon's handle at the carry, rad (PalmWeapon.gripEuler clamps to it). */
  band: WristBand;
  /** Wrist range at the strike (the snap), rad. */
  strikeBand: WristBand;
  /** Guard: the striking end at least this many degrees above the horizontal (up-out) ... */
  minGuardElevation: number;
  /** ... or, for a weapon carried point-forward (spears), at least this forward share with the end above −10°. */
  forwardCarry: number;
  /** Swing keys: the blade segment keeps at least this horizontal distance (mm) from its holder's body axis. */
  minBodyClearMm: number;
}

/**
 * The carry grip (guard, wind-up start, recovery end): the haft across the palm, wrist radial 0.35
 * rad (20°), ulnar 0.75 rad (43°: ~30° of ulnar deviation plus the oblique lie of a power grip),
 * forearm twist ±0.35. The handle stays ≥ 47° from the finger axis.
 */
export const HAMMER_BAND: WristBand = { radial: 0.35, ulnar: 0.75, roll: 0.35 };
/**
 * The strike's wrist SNAP (SwingDriver.wristSnap opens it from the late wind-up through the strike
 * and closes it over the first half of the recovery): ulnar 1.05 rad, the handle ≥ 30° from the
 * fingers, lying diagonally in the closed fist (heel of the palm to between the thumb and index).
 * Without it the swing keys' forearm-level thrusts held a spear point 43° up (sweet distance
 * 1.93 -> 0.81 m) and a chop's head never passed the hand (the human target was missed at engage).
 */
export const SNAP_BAND: WristBand = { radial: 0.35, ulnar: 1.05, roll: 0.35 };

const UP_OUT: GripRule = { carry: "up-out", reverseAllowed: false, band: HAMMER_BAND, strikeBand: SNAP_BAND, minGuardElevation: 20, forwardCarry: 0.7, minBodyClearMm: 110 };

/** The carry rule of every archetype. */
export const GRIP_RULES: Record<ArchetypeId, GripRule> = {
  dagger: { ...UP_OUT, carry: "reverse-down", reverseAllowed: true },
  shortsword: UP_OUT, sabre: UP_OUT, rapier: UP_OUT, longsword: UP_OUT, greatsword: UP_OUT,
  spear: UP_OUT, halberd: UP_OUT, scythe: UP_OUT, staff: UP_OUT,
  axe: UP_OUT, greataxe: UP_OUT, mace: UP_OUT, flail: UP_OUT, warhammer: UP_OUT, maul: UP_OUT,
  // A bow is pushed, not swung: no snap, the riser stays upright in the fist.
  bow: { ...UP_OUT, carry: "upright-bow", strikeBand: HAMMER_BAND, minGuardElevation: 70 },
};

/** The rule of a weapon's archetype (an unknown id carries up-out). */
export function gripRuleOf(archetype: string | undefined | null): GripRule {
  return (archetype && (GRIP_RULES as Record<string, GripRule>)[archetype]) || UP_OUT;
}

/**
 * Check one measured grip (PalmWeapon.gripMetrics) against the carry rule at a swing beat. Every
 * beat: the handle passes through the fist, across the fingers within the beat's wrist band; a forward grip leaves the thumb side and only a
 * reverse-allowed weapon may leave the little-finger side. Guard: the carry. Other beats: never
 * into the holder (blade clearance, and no forward-grip end pointing down-and-back).
 */
export function checkOrientation(rule: GripRule, beat: "guard" | "windup" | "contact" | "recover", m: GripMetrics): { ok: boolean; why: string[] } {
  const why: string[] = [];
  if (!m.through) why.push("handle not through the fist");
  // Across the fingers: within the beat's wrist band (guard: the carry; otherwise the snap may be open), +1° measuring slack.
  const band = beat === "guard" ? rule.band : rule.strikeBand, deg = 180 / Math.PI;
  if (m.handleToFingers < 90 - band.ulnar * deg - 1) why.push(`handle along the fingers (${m.handleToFingers.toFixed(0)}° < ${(90 - band.ulnar * deg).toFixed(0)}°)`);
  if (m.side < 0 && !rule.reverseAllowed) why.push("blade out of the little-finger side");
  if (beat === "guard") {
    if (rule.carry === "up-out" && !(m.elevation >= rule.minGuardElevation || (m.elevation >= -10 && m.forward >= rule.forwardCarry))) why.push(`guard end not up/out (elev ${m.elevation.toFixed(0)}°)`);
    if (rule.carry === "reverse-down" && m.elevation > -30) why.push(`reverse dagger not blade-down (elev ${m.elevation.toFixed(0)}°)`);
    if (rule.carry === "upright-bow") {
      if (m.elevation < rule.minGuardElevation) why.push(`bow limbs not vertical (elev ${m.elevation.toFixed(0)}°)`);
      if (m.edgeForward < 0) why.push("bow string away from the archer");
    }
  } else if (rule.carry !== "reverse-down" && m.elevation < -30 && m.forward < -0.2) why.push(`end points down and back (elev ${m.elevation.toFixed(0)}°)`);
  if (m.bodyClearMm < rule.minBodyClearMm) why.push(`blade ${m.bodyClearMm.toFixed(0)} mm from the body axis`);
  return { ok: why.length === 0, why };
}
