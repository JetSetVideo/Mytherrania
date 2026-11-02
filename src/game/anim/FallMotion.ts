// Wave FALL (lane A): keyframed fall / lying / get-up motion and the shove / stagger / stumble
// reaction targets, for the Animator (C-ANIM in docs/wave-fall/BRIEF.md).
//
// Pure module: no Three.js, no DOM. Angles in radians (Skeleton convention, Rig.ts header),
// quaternions [x, y, z, w] in the rig's HEADING frame (y up, z forward, x the rig's +x).
//
// Why keyframes and not the ragdoll (docs/wave-fall/ANIMATION.md): a fall here is a game state with
// a known duration (M's Fall.ts) that must end in a get-up; the ragdoll is a one-way handover
// (RagdollDriver owns the bones, ring-out / KO). Keys + whole-body grounding (Rig.bodySpheres) +
// contact anchoring give a deterministic, measurable motion whose timing is M's t01.
//
// Keys are authored in WORLD-INTENT angles (the tilt of each body segment from the vertical in the
// body's sagittal plane) and converted to joints by `intent()`:
//   chest τc, pelvis τp, head τh: forward tilt of an UP-pointing segment (+ = forward)
//   thigh ψt, shin ψs, upper arm ψa, forearm ψf: forward swing of a DOWN-hanging segment
//   foot Θ: toe-down pitch of the sole; P: whole-body pitch (the rig's root tilt about x).
//   spine = τc − P,  abdomen = τp − τc,  hip = ψt + τp,  knee = ψs − ψt,  ankle = Θ + ψs,
//   shoulder = −ψa − τc,  elbow = ψa − ψf,  neck = head = (τh − τc) / 2.
// Every hanging bone's rig rotation R gives ψ = −R, and everything below the spine pivot hangs off
// it (Rig.ts trunk chain), which is where these sums come from.

import { clamp, smoothstep } from "../../core/MathCore.ts";
import { JOINT_COUNT, JOINT_INDEX, type JointLimitTable } from "./Rig.ts";

/** Fall phase (structurally identical to M's Fall.ts FallPhase). */
export type AnimFallPhase = "stand" | "stagger" | "stumble" | "falling" | "down" | "rising";
/** Which side of the body lands. */
export type AnimFallPose = "back" | "front" | "side";

/** AnimatorInput.fall (C-ANIM). `dir` = world xz unit vector the body travels / falls toward. */
export interface AnimFallInput {
  phase: AnimFallPhase;
  /** Progress of the phase, 0..1 (M's timing law). */
  t01: number;
  dir: [number, number];
  pose: AnimFallPose;
}

/** AnimatorInput.shove (C-ANIM). `dir` = world xz unit vector THIS fighter is pushed toward. */
export interface AnimShoveInput {
  phase: "brace" | "impact" | "recoil";
  t01: number;
  dir: [number, number];
  /** 0..1 strength of the exchange (scales lean, compression and recoil). */
  magnitude01: number;
}

/** Contact points the anchoring keeps in place while loaded. */
export const CONTACT = { footL: 0, footR: 1, kneeL: 2, kneeR: 3, handL: 4, handR: 5, pelvis: 6 } as const;
export const CONTACT_COUNT = 7;

/** One key: joint angles, root tilt (quaternion, heading frame), contact loads, time 0..1. */
export interface FallKey {
  t: number;
  angles: Float64Array;
  q: Float64Array;
  contact: Float64Array;
  /** Heading turn (rad) folded into q; constant from the roll-over on (the rig is baked to it). */
  yawAdd: number;
}

/** World-intent spec of a key (see the file header). [L, R] pairs. */
export interface IntentSpec {
  P?: number; turn?: number; roll?: number; yawAdd?: number;
  chest: number; pelvis: number; head?: number;
  thigh: [number, number]; shin: [number, number]; foot?: [number, number]; toe?: [number, number];
  arm: [number, number]; fore: [number, number];
  contact?: Partial<Record<keyof typeof CONTACT, number>>;
}

const J = JOINT_INDEX;

/** Quaternion product a·b into out. */
export function qmul(a: ArrayLike<number>, b: ArrayLike<number>, out: Float64Array): Float64Array {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/** Rotation about a principal axis (0 x, 1 y, 2 z). */
export function qaxis(axis: 0 | 1 | 2, a: number, out: Float64Array = new Float64Array(4)): Float64Array {
  out[0] = out[1] = out[2] = 0; out[axis] = Math.sin(a / 2); out[3] = Math.cos(a / 2);
  return out;
}

/** Shortest-path slerp into out (inputs may alias out only as `a`). */
export function qslerp(a: ArrayLike<number>, b: ArrayLike<number>, t: number, out: Float64Array): Float64Array {
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let d = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (d < 0) { d = -d; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let k0: number, k1: number;
  if (d > 0.9995) { k0 = 1 - t; k1 = t; } else {
    const th = Math.acos(clamp(d, -1, 1)), s = Math.sin(th);
    k0 = Math.sin((1 - t) * th) / s; k1 = Math.sin(t * th) / s;
  }
  const x = k0 * a[0] + k1 * bx, y = k0 * a[1] + k1 * by, z = k0 * a[2] + k1 * bz, w = k0 * a[3] + k1 * bw;
  const n = Math.hypot(x, y, z, w) || 1;
  out[0] = x / n; out[1] = y / n; out[2] = z / n; out[3] = w / n;
  return out;
}

/** Rotate vector (x, y, z) by unit quaternion q into out[0..2]. */
export function qrot(q: ArrayLike<number>, x: number, y: number, z: number, out: Float64Array): Float64Array {
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out[0] = x + qw * tx + qy * tz - qz * ty;
  out[1] = y + qw * ty + qz * tx - qx * tz;
  out[2] = z + qw * tz + qx * ty - qy * tx;
  return out;
}

const QA = new Float64Array(4), QB = new Float64Array(4), QC = new Float64Array(4);

/** Build a key from a world-intent spec. */
export function intent(t: number, s: IntentSpec): FallKey {
  const a = new Float64Array(JOINT_COUNT);
  const P = s.P ?? 0, head = s.head ?? s.chest;
  a[J.spine] = s.chest - P;
  a[J.abdomen] = s.pelvis - s.chest;
  a[J.neck] = a[J.head] = 0.5 * (head - s.chest);
  const foot = s.foot ?? [0, 0], toe = s.toe ?? [0, 0];
  const legs = [[J.hipL, J.kneeL, J.ankleL, J.toeL], [J.hipR, J.kneeR, J.ankleR, J.toeR]];
  const arms = [[J.shoulderL, J.elbowL], [J.shoulderR, J.elbowR]];
  for (let i = 0; i < 2; i++) {
    a[legs[i][0]] = s.thigh[i] + s.pelvis;
    a[legs[i][1]] = s.shin[i] - s.thigh[i];
    a[legs[i][2]] = foot[i] + s.shin[i];
    a[legs[i][3]] = toe[i];
    a[arms[i][0]] = -s.arm[i] - s.chest;
    a[arms[i][1]] = s.arm[i] - s.fore[i];
  }
  // q = Ry(yawAdd)·Rx(P)·Ry(turn)·Rz(roll)
  const q = new Float64Array(4);
  qmul(qaxis(1, s.yawAdd ?? 0, QA), qaxis(0, P, QB), QC);
  qmul(QC, qaxis(1, s.turn ?? 0, QA), QB);
  qmul(QB, qaxis(2, s.roll ?? 0, QA), q);
  const c = new Float64Array(CONTACT_COUNT);
  for (const [k, v] of Object.entries(s.contact ?? {})) c[CONTACT[k as keyof typeof CONTACT]] = v as number;
  return { t, angles: a, q, contact: c, yawAdd: s.yawAdd ?? 0 };
}

/** Copy of a key at a new time (and optionally new contacts). */
export function retime(k: FallKey, t: number, contact?: Partial<Record<keyof typeof CONTACT, number>>): FallKey {
  const c = Float64Array.from(k.contact);
  if (contact) { c.fill(0); for (const [n, v] of Object.entries(contact)) c[CONTACT[n as keyof typeof CONTACT]] = v as number; }
  return { t, angles: Float64Array.from(k.angles), q: Float64Array.from(k.q), contact: c, yawAdd: k.yawAdd };
}

const HALF_PI = Math.PI / 2;

// ---- Lying poses (the end of `falling`, all of `down`, the start of `rising`). ----

/** On the back: everything nearly straight, knees a little up, arms along the body. */
export const LIE_BACK: IntentSpec = {
  P: -HALF_PI, chest: -HALF_PI + 0.02, pelvis: -HALF_PI + 0.04, head: -HALF_PI - 0.15,
  // Left leg long, right knee up (foot flat-ish on the floor), right forearm over the belly.
  thigh: [HALF_PI - 0.04, 1.95], shin: [HALF_PI - 0.08, 1.15], foot: [-1.3, -0.55],
  arm: [HALF_PI - 0.05, HALF_PI - 0.2], fore: [HALF_PI - 0.02, HALF_PI + 0.35],
  contact: { pelvis: 1 },
};
/** On the front: legs straight back, arms along the body, head lifted off the floor. */
export const LIE_FRONT: IntentSpec = {
  P: HALF_PI, chest: HALF_PI - 0.03, pelvis: HALF_PI - 0.05, head: HALF_PI - 0.6,
  // Shins rise a little toward the plantar-flexed feet (the toes rest on the floor, not in it).
  thigh: [-HALF_PI + 0.08, -HALF_PI + 0.14], shin: [-1.92, -1.97], foot: [2.5, 2.55],
  arm: [-1.62, -1.6], fore: [-1.62, -1.58],
  contact: { pelvis: 1 },
};
/** On the side (roll set per side by sideSpec): a loose recovery curl. */
export const LIE_SIDE: IntentSpec = {
  P: 0, chest: 0.3, pelvis: 0.15, head: 0.4,
  thigh: [0.75, 0.45], shin: [-0.15, -0.35], foot: [0.1, 0.2],
  arm: [0.95, 0.65], fore: [1.9, 1.5],
  contact: { pelvis: 1 },
};

// ---- Falling keys (snapshot first, then these, then the lying pose). ----

const FALL_BACK: IntentSpec[] = [
  // Legs = the guard stand's legs + the same bend on both sides (the snapshot's stance rides on top).
  { P: -0.28, chest: -0.05, pelvis: -0.3, head: 0.18, thigh: [0.6, 0.35], shin: [-0.35, -0.55], foot: [0, 0],
    arm: [0.95, 0.75], fore: [1.5, 1.25], contact: { footL: 1, footR: 1 } },
  { P: -0.95, chest: -0.6, pelvis: -0.95, head: -0.25, thigh: [1.45, 1.3], shin: [0.95, 0.7], foot: [-0.4, -0.2],
    arm: [0.55, 0.35], fore: [1.1, 0.95], contact: { footL: 0.6, footR: 0.6 } },
];
const FALL_FRONT: IntentSpec[] = [
  { P: 0.32, chest: 0.5, pelvis: 0.38, head: 0.15, thigh: [0.15, -0.1], shin: [-0.3, -0.5], foot: [0.1, 0.1],
    arm: [1.35, 1.25], fore: [1.6, 1.5], contact: { footL: 1, footR: 1 } },
  { P: 0.95, chest: 1.1, pelvis: 0.95, head: 0.55, thigh: [-0.05, 0.05], shin: [-1.8, -1.75], foot: [1.5, 1.5],
    toe: [-0.7, -0.7], arm: [0.8, 0.7], fore: [0.85, 0.75], contact: { kneeL: 1, kneeR: 1 } },
];
const FALL_SIDE: IntentSpec[] = [
  { P: 0, roll: 0.3, chest: 0.12, pelvis: 0.02, head: 0.2, thigh: [0.55, 0.3], shin: [-0.45, -0.65], foot: [0, 0],
    arm: [0.9, 0.6], fore: [1.5, 1.2], contact: { footL: 1, footR: 1 } },
  { P: 0, roll: 0.95, chest: 0.25, pelvis: 0.1, head: 0.35, thigh: [0.75, 0.6], shin: [-0.5, -0.55], foot: [0.1, 0.1],
    arm: [0.95, 0.7], fore: [1.7, 1.4], contact: { footL: 0.4, footR: 0.4, kneeL: 0.5, pelvis: 0.3 } },
];

/** The side spec with the roll sign of the side that lands (s = +1: lands on the rig's +x side). */
function sideSpec(base: IntentSpec, s: number, rollScale = 1): IntentSpec {
  const roll = (base.roll ?? HALF_PI) * rollScale;
  return { ...base, roll: -s * roll };
}

// ---- Get-up: every pose rolls to the front, then prone -> push -> hands & knees -> kneel -> stand. ----

const RISE_FRONT: IntentSpec[] = [
  // Propped on the forearms (sphinx): upper arms near vertical, forearms flat ahead, hips down.
  { P: 0.9, chest: 1.0, pelvis: 1.45, head: 0.75, thigh: [-1.5, -1.45], shin: [-1.92, -1.97], foot: [2.5, 2.55],
    toe: [-0.3, -0.3], arm: [-0.1, -0.1], fore: [1.65, 1.65], contact: { pelvis: 0.6, kneeL: 1, kneeR: 1, handL: 1, handR: 1 } },
  // Hands and knees: shins rise from the knee to the tucked toes.
  { P: 0.62, chest: 0.98, pelvis: 0.92, head: 0.55, thigh: [-0.02, 0.04], shin: [-1.82, -1.8], foot: [1.5, 1.5],
    toe: [-0.7, -0.7], arm: [0.25, 0.25], fore: [0.3, 0.3], contact: { kneeL: 1, kneeR: 1, handL: 1, handR: 1 } },
  // Left foot forward, right knee down, hands lifting.
  { P: 0.22, chest: 0.55, pelvis: 0.38, head: 0.3, thigh: [1.5, -0.12], shin: [0.08, -1.82], foot: [0, 1.5],
    toe: [0, -0.7], arm: [0.7, 0.55], fore: [1.1, 0.9], contact: { footL: 1, kneeR: 1 } },
  // Rise over the left foot; the right leg pushes off its toes.
  { P: 0.08, chest: 0.35, pelvis: 0.28, head: 0.12, thigh: [0.62, -0.42], shin: [-0.05, -1.05], foot: [0, 1.05],
    toe: [0, -0.5], arm: [0.8, 0.7], fore: [1.5, 1.2], contact: { footL: 1 } },
  // Guard: feet planted (right foot stepped up), arms in guard (Poses.GUARD_POSE).
  { P: 0, chest: 0.12, pelvis: 0.18, head: 0, thigh: [0.25, -0.1], shin: [-0.1, -0.32], foot: [0, 0],
    arm: [0.73, 0.88], fore: [2.43, 1.39], contact: { footL: 1, footR: 1 } },
];

/** Built key sequences (cached per pose / side). */
export interface FallSequences {
  falling: FallKey[]; // without the snapshot (prepended by the animator)
  lie: FallKey;
  rising: FallKey[];
  /** Rising t01 at which the guard key is reached (the hand-off to the gait starts there). */
  guardAt: number;
  /** Heading turn of the get-up (the roll-over onto the front), rad. */
  yawAdd: number;
  /** Rising t01 window (forearms -> hands-and-knees) in which the body turns to face the rival. */
  turnFrom: number;
  turnUntil: number;
  /** Rising t01 from which the legs adduct to the gait's stance width (feet under the hips). */
  standFrom: number;
}

/**
 * The keys of a fall on `pose`; `side` = +1 when the body lands on its +x side (side falls), and
 * the roll-over direction for a back fall. Rising keys start at the lying pose and end in guard.
 */
export function fallSequences(pose: AnimFallPose, side: number): FallSequences {
  const s = side >= 0 ? 1 : -1;
  let fallSpecs: IntentSpec[], lie: IntentSpec, pre: IntentSpec[], yawAdd = 0;
  if (pose === "back") {
    fallSpecs = FALL_BACK; lie = LIE_BACK;
    // Roll over toward side s onto the front: Rx(−π/2)·Ry(turn), turn 0 -> s·π/2 -> s·π
    // (= Ry(s·π)·Rx(π/2): the front pose with the heading turned by π).
    yawAdd = s * Math.PI;
    pre = [
      { ...LIE_BACK, turn: s * 0.5 * Math.PI, thigh: [1.2, 1.35], shin: [0.7, 1.2], foot: [-0.6, -0.8], arm: [1.2, 1.0], fore: [1.6, 1.2],
        chest: -HALF_PI + 0.15, pelvis: -HALF_PI + 0.1, head: -HALF_PI + 0.45, contact: { pelvis: 1 } },
      { ...LIE_FRONT, yawAdd, contact: { pelvis: 1, kneeL: 0.5, kneeR: 0.5 } },
    ];
  } else if (pose === "side") {
    fallSpecs = FALL_SIDE.map((f) => sideSpec(f, s, 1));
    lie = sideSpec({ ...LIE_SIDE, roll: HALF_PI }, s);
    // Roll from the side onto the front: Rz(−s·π/2) -> Ry(s·π/2)·Rx(π/2) (a quarter turn about the long axis).
    yawAdd = s * HALF_PI;
    pre = [{ ...LIE_FRONT, yawAdd, contact: { pelvis: 1, kneeL: 0.5, kneeR: 0.5 } }];
  } else {
    fallSpecs = FALL_FRONT; lie = LIE_FRONT; pre = [];
  }
  const lieKey = intent(1, lie);
  const falling = [...fallSpecs.map((f, i) => intent(i === 0 ? 0.35 : 0.68, f)), retime(lieKey, 1)];
  // Timeline: the roll-over takes 0.12 per pre key; the front get-up the rest (its keys at frontT).
  const preShare = 0.12 * pre.length;
  const frontT = [0.12, 0.33, 0.55, 0.72, 0.86];
  const rising: FallKey[] = [retime(lieKey, 0)];
  pre.forEach((p, i) => rising.push(intent(0.12 * (i + 1), p)));
  RISE_FRONT.forEach((r, i) => rising.push(intent(preShare + (1 - preShare) * frontT[i], { ...r, yawAdd })));
  const guardAt = rising[rising.length - 1].t;
  rising.push(retime(rising[rising.length - 1], 1));
  const at = (i: number) => preShare + (1 - preShare) * frontT[i];
  // The turn to face the rival runs from the end of the roll-over to hands-and-knees: done before a
  // foot loads (a turning root would swing a planted sole about its anchor).
  return { falling, lie: lieKey, rising, guardAt, yawAdd, turnFrom: preShare, turnUntil: at(1), standFrom: at(3) };
}

/**
 * Evaluate a key track at t (0..1): joints by a monotone-safe cubic Hermite through the keys
 * (Catmull-Rom tangents on non-uniform times, zero at both ends), the tilt by slerp on an eased
 * parameter, contacts by an eased linear blend. Writes into the out arrays.
 */
export function evalKeys(keys: readonly FallKey[], t: number, angles: Float64Array, q: Float64Array, contact: Float64Array): number {
  const n = keys.length;
  const x = clamp(t, keys[0].t, keys[n - 1].t);
  let i = 0;
  while (i < n - 2 && x > keys[i + 1].t) i++;
  const k0 = keys[i], k1 = keys[i + 1];
  const span = Math.max(1e-6, k1.t - k0.t), u = clamp((x - k0.t) / span, 0, 1);
  const kp = keys[Math.max(0, i - 1)], kn = keys[Math.min(n - 1, i + 2)];
  const h00 = 2 * u * u * u - 3 * u * u + 1, h10 = u * u * u - 2 * u * u + u, h01 = -2 * u * u * u + 3 * u * u, h11 = u * u * u - u * u;
  for (let j = 0; j < JOINT_COUNT; j++) {
    const p0 = k0.angles[j], p1 = k1.angles[j];
    // Tangent (per unit time) at each end: zero at the first / last key and at a local extremum.
    const m0 = i === 0 ? 0 : tangent(kp.angles[j], p0, p1, k0.t - kp.t, span);
    const m1 = i + 1 === n - 1 ? 0 : tangent(p0, p1, kn.angles[j], span, kn.t - k1.t);
    angles[j] = h00 * p0 + h10 * m0 * span + h01 * p1 + h11 * m1 * span;
  }
  qslerp(k0.q, k1.q, smoothstep(0, 1, u), q);
  // A contact LOADS at the end of a segment (the part has arrived) and UNLOADS at its start (it
  // lifts first, then travels): a load that ramped over the whole segment latched a foot mid-swing.
  const on = smoothstep(0.75, 1, u), off = smoothstep(0, 0.25, u);
  for (let c = 0; c < CONTACT_COUNT; c++) {
    const a = k0.contact[c], b = k1.contact[c];
    contact[c] = a + (b - a) * (b > a ? on : off);
  }
  return i;
}

/** Catmull-Rom tangent through (a, b, c) with segment times (ta, tb); 0 at an extremum (no overshoot). */
function tangent(a: number, b: number, c: number, ta: number, tb: number): number {
  const d0 = (b - a) / Math.max(1e-6, ta), d1 = (c - b) / Math.max(1e-6, tb);
  if (d0 * d1 <= 0) return 0;
  // Harmonic mean (Fritsch-Carlson style) keeps the segment monotone.
  return 2 / (1 / d0 + 1 / d1);
}

/**
 * Joint limits for the fall / get-up poses: the base table widened where a lying or kneeling body
 * needs it — the trunk and knees to the KO pose's window (Skeleton.defaultHumanoid "ko" limits) and
 * the hip flexion to 1.9 rad (a kneeling lunge's front thigh; the standing window 1.2 is a game
 * choice for the gait, anatomical hip flexion with a bent knee is ~2.1 rad).
 */
export function wideLimits(lim: JointLimitTable): JointLimitTable {
  const w: JointLimitTable = { min: Float64Array.from(lim.min), max: Float64Array.from(lim.max), rest: Float64Array.from(lim.rest) };
  const set = (j: number, lo: number, hi: number) => { w.min[j] = Math.min(w.min[j], lo); w.max[j] = Math.max(w.max[j], hi); };
  set(J.spine, -1.5, 0.8); set(J.abdomen, -1.3, 0.6); set(J.neck, -1.2, 0.5);
  set(J.kneeL, -2.6, 0); set(J.kneeR, -2.6, 0); set(J.hipL, -1.2, 1.9); set(J.hipR, -1.2, 1.9);
  return w;
}

/** The widened windows as a Skeleton limit map (Skeleton.drive(..., wide)). */
export const WIDE_JOINT_LIMITS: Readonly<Record<string, { min: number; max: number }>> = {
  spine: { min: -1.5, max: 0.8 }, abdomen: { min: -1.3, max: 0.6 }, neck: { min: -1.2, max: 0.5 },
  kneeL: { min: -2.6, max: 0 }, kneeR: { min: -2.6, max: 0 }, hipL: { min: -1.2, max: 1.9 }, hipR: { min: -1.2, max: 1.9 },
};

// ---- Standing reactions: shove (brace / impact / recoil), stagger, stumble. ----

/** Reaction targets the animator layers on the gait (all 0 = no reaction). */
export interface ReactTargets {
  /** Chest lean (rad, + forward) and root roll (rad, + tips the head toward the rig's −x). */
  lean: number;
  roll: number;
  /** Pelvis drop as a share of the leg length (the IK bends the knees, the feet stay planted). */
  crouch: number;
  /** Additive offsets: shoulders, elbows [L, R], neck. */
  shoulder: [number, number];
  elbow: [number, number];
  neck: number;
}

/** Zeroed targets. */
export function newReact(): ReactTargets {
  return { lean: 0, roll: 0, crouch: 0, shoulder: [0, 0], elbow: [0, 0], neck: 0 };
}

/**
 * Reaction targets for this frame. `df`/`dl` = the push direction in the rig frame (forward and
 * lateral +x components of dir), `time` the animator clock (flail oscillation).
 */
export function reactTargets(
  shove: AnimShoveInput | null | undefined, fall: AnimFallInput | null | undefined,
  df: number, dl: number, sdf: number, sdl: number, time: number, out: ReactTargets,
): ReactTargets {
  out.lean = out.roll = out.crouch = out.neck = 0;
  out.shoulder[0] = out.shoulder[1] = out.elbow[0] = out.elbow[1] = 0;
  if (shove) {
    const m = clamp(shove.magnitude01, 0, 1), t = clamp(shove.t01, 0, 1), g = 0.5 + 0.5 * m;
    if (shove.phase === "brace") {
      // Lean INTO the rival (against the push), arms and weapon forward, a little lower.
      const e = smoothstep(0, 0.6, t);
      out.lean += -sdf * 0.24 * g * e; out.roll += sdl * 0.1 * g * e; out.crouch += 0.035 * g * e;
      out.shoulder[0] += -0.35 * e; out.shoulder[1] += -0.3 * e; out.elbow[0] += 0.5 * e; out.elbow[1] += 0.25 * e;
      out.neck += 0.08 * e;
    } else if (shove.phase === "impact") {
      // Compression: deeper crouch, arms fold, head dips — a brief squash.
      const e = Math.sin(Math.PI * t);
      out.lean += -sdf * 0.24 * g + -sdf * 0.06 * g * e; out.roll += sdl * 0.1 * g;
      out.crouch += 0.035 * g + 0.04 * g * e;
      out.shoulder[0] += -0.35; out.shoulder[1] += -0.3; out.elbow[0] += 0.5 - 0.35 * e; out.elbow[1] += 0.25 - 0.3 * e;
      out.neck += 0.08 + 0.1 * e;
    } else {
      // Recoil: the torso snaps back along the push and settles; arms swing up for balance.
      const snap = Math.sin(Math.PI * Math.min(1, t * 1.6)) * (1 - smoothstep(0.7, 1, t));
      const rest = (1 - smoothstep(0, 0.35, t)); // the brace/impact lean releasing
      out.lean += sdf * 0.32 * g * snap + -sdf * 0.24 * g * rest; out.roll += -sdl * 0.16 * g * snap + sdl * 0.1 * g * rest;
      out.crouch += 0.03 * g * (snap + rest);
      out.shoulder[0] += -0.55 * snap - 0.35 * rest; out.shoulder[1] += -0.4 * snap - 0.3 * rest;
      out.elbow[0] += 0.3 * snap + 0.5 * rest; out.elbow[1] += 0.2 * snap + 0.25 * rest;
      out.neck += -0.12 * g * snap * Math.sign(sdf || 1);
    }
  }
  if (fall && (fall.phase === "stagger" || fall.phase === "stumble")) {
    const t = clamp(fall.t01, 0, 1), env = smoothstep(0, 0.15, t) * (1 - smoothstep(0.75, 1, t));
    if (fall.phase === "stagger") {
      // Arms flail (alternating), trunk carried along the push, a bent-knee balance crouch.
      const w = 2 * Math.PI * 2.6 * time;
      out.lean += df * 0.22 * env; out.roll += -dl * 0.14 * env; out.crouch += 0.045 * env;
      out.shoulder[0] += (-0.7 + 0.45 * Math.sin(w)) * env; out.shoulder[1] += (-0.7 - 0.45 * Math.sin(w)) * env;
      out.elbow[0] += (0.4 - 0.3 * Math.cos(w)) * env; out.elbow[1] += (0.25 + 0.3 * Math.cos(w)) * env;
      out.neck += -0.1 * df * env;
    } else {
      // Stumble: a foot catches, the body pitches along dir, arms reach forward-down, head up.
      const pitch = Math.sin(Math.PI * Math.min(1, t * 1.3));
      out.lean += df * 0.42 * env * (0.5 + 0.5 * pitch); out.roll += -dl * 0.2 * env; out.crouch += 0.075 * env;
      out.shoulder[0] += -0.95 * env; out.shoulder[1] += -0.75 * env; out.elbow[0] += 0.9 * env; out.elbow[1] += 0.3 * env;
      out.neck += -0.22 * env * (df >= 0 ? 1 : 0.3);
    }
  }
  return out;
}
