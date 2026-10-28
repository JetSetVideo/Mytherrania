// Facial morph loop: how the eyebrows, eyelids and mouth deform through the
// combat animation states, so a fighter's face reacts when it hits and gets hit.
//
// The user wants the face to "loop during the parent animations": each parent
// state (idle, attack, hit, ko) maps to a target face, and the rig eases toward
// it so a landed blow raises the brows and opens the mouth, a taken blow squints
// the eyes and bares the teeth, and a KO slackens everything.
//
// Pure module: no Three.js, no DOM. Values are 0..1 blend weights per feature.

export type FaceState = "idle" | "attack" | "hit" | "ko" | "block";

/** The deform weights for one face: how far each feature is from neutral. */
export interface FacePose {
  /** Eyebrow raise: 0 = neutral, 1 = fully raised (surprise/exertion). */
  browRaise: number;
  /** Eyebrow furrow: 0 = neutral, 1 = fully furrowed (anger/strain). */
  browFurrow: number;
  /** Eyelid openness: 0 = closed, 1 = wide open. */
  eyeOpen: number;
  /** Mouth openness: 0 = closed, 1 = wide (a shout or a gasp). */
  mouthOpen: number;
  /** Mouth corner direction: -1 = grimace/frown, +1 = snarl/smile. */
  mouthCurve: number;
}

/** The neutral face. */
export const NEUTRAL_FACE: FacePose = { browRaise: 0, browFurrow: 0.2, eyeOpen: 0.85, mouthOpen: 0.05, mouthCurve: 0 };

/** The target face per parent animation state. */
export const FACE_BY_STATE: Record<FaceState, FacePose> = {
  idle: NEUTRAL_FACE,
  // Attacking: brows furrowed, eyes focused, mouth slightly open in exertion.
  attack: { browRaise: 0.2, browFurrow: 0.7, eyeOpen: 0.9, mouthOpen: 0.35, mouthCurve: 0.3 },
  // Landing a hit: brows up, eyes wide, mouth open (a shout).
  hit: { browRaise: 0.6, browFurrow: 0.4, eyeOpen: 1.0, mouthOpen: 0.7, mouthCurve: 0.5 },
  // Taking a hit: brows raised and furrowed, eyes squinted, mouth grimaced.
  block: { browRaise: 0.3, browFurrow: 0.8, eyeOpen: 0.4, mouthOpen: 0.4, mouthCurve: -0.7 },
  // KO: everything slack.
  ko: { browRaise: 0, browFurrow: 0, eyeOpen: 0.1, mouthOpen: 0.5, mouthCurve: -0.2 },
};

/** All weights stay within 0..1 except mouthCurve (-1..1). */
export function clampFace(p: FacePose): FacePose {
  const c = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  return {
    browRaise: c(p.browRaise),
    browFurrow: c(p.browFurrow),
    eyeOpen: c(p.eyeOpen),
    mouthOpen: c(p.mouthOpen),
    mouthCurve: c(p.mouthCurve, -1, 1),
  };
}

/**
 * Blend two faces (for a smooth transition between states). `t` in [0,1]: 0 = a,
 * 1 = b. The rig eases the live face toward the state's target each frame.
 */
export function blendFace(a: FacePose, b: FacePose, t: number): FacePose {
  const u = Math.max(0, Math.min(1, t));
  const lerp = (x: number, y: number) => x + (y - x) * u;
  return clampFace({
    browRaise: lerp(a.browRaise, b.browRaise),
    browFurrow: lerp(a.browFurrow, b.browFurrow),
    eyeOpen: lerp(a.eyeOpen, b.eyeOpen),
    mouthOpen: lerp(a.mouthOpen, b.mouthOpen),
    mouthCurve: lerp(a.mouthCurve, b.mouthCurve),
  });
}

/** A live face that eases toward the current state's target, with a decay loop. */
export class FaceMorph {
  #face: FacePose = { ...NEUTRAL_FACE };
  #state: FaceState = "idle";

  /** Set the parent animation state the face should follow. */
  setState(state: FaceState): void { this.#state = state; }
  state(): FaceState { return this.#state; }

  /** Advance toward the state's target and return the live pose. Call per frame. */
  update(dt: number): FacePose {
    const target = FACE_BY_STATE[this.#state];
    const k = 1 - Math.exp(-12 * dt);
    this.#face = blendFace(this.#face, target, k);
    return this.#face;
  }

  face(): FacePose { return this.#face; }
}
