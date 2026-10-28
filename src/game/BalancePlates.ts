// Three-level balance-plate model: a fighter's balance is measured on three
// plates — the feet on the ground, the pelvis (hip tilt), and the shoulders —
// plus a knee force-plate. Their composite is the centre of pressure the body
// tries to hold over the ground plate's support polygon. When the composite
// tilts past a threshold the fighter changes stance: it staggers, drops to its
// knees, or falls.
//
// This drives the balancing the user described: the ground plate's perimeter
// grows as the feet spread (a wider stance is harder to tip), the main balance
// point lowers toward the ground as the stance widens, and the knee plate
// absorbs force so the body can recover onto a kneel instead of a full fall.
//
// Pure module: no Three.js, no DOM. Distances in metres, angles in radians.

/** The stance the body is in, from most to least stable. */
export type Stance = "standing" | "staggered" | "kneeling" | "fallen";

export interface PlateInput {
  /** Ground plate: half the distance between the feet (stance width / 2). */
  footSpread: number;
  /** Angle of the floor under the feet (rad): on a slope the plate tilts. */
  groundSlope: number;
  /** Pelvis plate: the hip tilt away from vertical (rad). */
  pelvisTilt: number;
  /** Shoulder plate: the shoulder-line tilt away from horizontal (rad). */
  shoulderTilt: number;
  /** Mass above each plate (kg): used to weight the composite. */
  mass: number;
}

/** A force on the knee plate (a hit that drives the body down). */
export interface KneeForce {
  /** Downward impulse (N·s). */
  impulse: number;
  /** Direction, -1..1 (lateral). */
  side: number;
}

/** Per-plate radii: the support polygon each plate offers. */
export const PLATE_RADIUS = { feet: 0.18, pelvis: 0.14, shoulder: 0.16 } as const;
/** Height of each plate above the ground plate (m). */
export const PLATE_HEIGHT = { feet: 0, pelvis: 0.95, shoulder: 1.45 } as const;

/** How far the composite may lean before each stance change (fraction of support radius). */
export const STANCE_THRESHOLD = { stagger: 0.7, kneel: 1.15, fall: 1.6 } as const;

/**
 * The support radius of the ground plate: the base radius plus the extra
 * stability from spreading the feet, reduced on a slope. A wider stance is
 * harder to tip; standing on a tilt makes it easier.
 */
export function supportRadius(input: PlateInput): number {
  const spread = Math.max(0, input.footSpread);
  const slopePenalty = Math.abs(Math.tan(input.groundSlope)) * 0.5;
  return PLATE_RADIUS.feet + spread * 0.8 - slopePenalty;
}

/**
 * The composite balance point: the mass-weighted centre of pressure across the
 * three plates, as a lateral offset from the centre of the ground plate (m) and
 * the height of that point above the ground (m). The pelvis and shoulder tilts
 * push it sideways in proportion to their height; a wider stance lowers it.
 */
/**
 * The composite balance point: the mass-weighted centre of pressure across the
 * three plates, as a lateral offset from the centre of the ground plate (m) and
 * the height of that point above the ground (m). The pelvis and shoulder tilts
 * push it sideways in proportion to their height; a wider stance lowers it. The
 * feet stay planted, so the ground slope does not itself create offset — it only
 * shrinks the support polygon (see supportRadius), which is what tips the body.
 */
export function balancePoint(input: PlateInput): { offset: number; height: number } {
  const wFeet = input.mass * 0.2;
  const wPelvis = input.mass * 0.5;
  const wShoulder = input.mass * 0.3;
  const total = wFeet + wPelvis + wShoulder;
  // Lateral offset: the pelvis and shoulder contribute their tilt * their height.
  const offset = (
    wPelvis * Math.tan(input.pelvisTilt) * PLATE_HEIGHT.pelvis +
    wShoulder * Math.tan(input.shoulderTilt) * PLATE_HEIGHT.shoulder
  ) / total;
  // Height: a wider stance drops the balance point toward the ground.
  const height = (wPelvis * PLATE_HEIGHT.pelvis + wShoulder * PLATE_HEIGHT.shoulder) / total
    - Math.min(0.3, input.footSpread * 0.4);
  return { offset, height };
}

/**
 * The stability margin: how far inside the support polygon the balance point
 * sits, as a fraction of the support radius. >1 means the point is past the
 * edge (the body must change stance).
 */
export function instability(input: PlateInput): number {
  const r = supportRadius(input);
  if (r <= 1e-6) return Infinity;
  return Math.abs(balancePoint(input).offset) / r;
}

/** Decide the stance from the instability and any knee force. */
export function stanceFor(input: PlateInput, knee?: KneeForce): Stance {
  let level = instability(input);
  // A knee force adds downward+lateral load, pushing the body toward a kneel/fall.
  if (knee) level += (knee.impulse / 400) * (0.5 + 0.5 * Math.abs(knee.side));
  if (level >= STANCE_THRESHOLD.fall) return "fallen";
  if (level >= STANCE_THRESHOLD.kneel) return "kneeling";
  if (level >= STANCE_THRESHOLD.stagger) return "staggered";
  return "standing";
}

/**
 * A balance rig: tracks the three plates over time and reports the current
 * stance and the composite balance point. The Engine updates the plates from
 * the skeleton each frame and reads the stance to pick the animation.
 */
export class BalanceRig {
  #input: PlateInput = { footSpread: 0.24, groundSlope: 0, pelvisTilt: 0, shoulderTilt: 0, mass: 75 };
  #knee: KneeForce | undefined;
  #stance: Stance = "standing";

  setPlates(input: Partial<PlateInput>): void {
    this.#input = { ...this.#input, ...input };
  }

  /** A hit lands on the knee plate. */
  strikeKnee(force: KneeForce): void {
    this.#knee = force;
  }

  /** Advance one frame: recompute the stance and clear a one-frame knee impulse. */
  update(_dt: number): { stance: Stance; point: { offset: number; height: number }; instability: number } {
    this.#stance = stanceFor(this.#input, this.#knee);
    const point = balancePoint(this.#input);
    const level = instability(this.#input);
    this.#knee = undefined; // a knee strike is a one-frame impulse
    return { stance: this.#stance, point, instability: level };
  }

  stance(): Stance { return this.#stance; }
}
