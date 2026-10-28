// Animation tensor bounds: the maximum and minimum each class's three powers
// reach on the sin/cos/tan axes, so the animation envelope is inspectable and
// bounded rather than free-form. Each power sweeps a tracked joint through a
// sinusoidal arc; this module computes the exact min/max angle, angular velocity
// and the cos/sin/tan extrema over the move, per joint, per class power.
//
// The user asked for "maximum and minimum cos sin tan tensor values for all the
// classes powers". The tensor here is the per-joint rotation state over the move:
// its angle (the sin/cos phase) and the derived tan slope at each sample. The
// bounds feed the QA envelope and the shader intensity (a bigger swing flares more).
//
// Pure module: no Three.js, no DOM. Angles in radians, time normalised 0..1.

import { poseAt } from "./AnimationCurve.ts";
import { skillsForClass, type Skill } from "./Skills.ts";
import { defaultHumanoid, type JointName, type Skeleton } from "./Skeleton.ts";
import { CLASSES, type ClassName } from "./Stats.ts";

/** The extrema of one joint over a power's animation. */
export interface JointBounds {
  joint: JointName;
  minAngle: number;
  maxAngle: number;
  /** Peak |angular velocity| (rad/s) over the move. */
  maxVel: number;
  /** cos/sin/tan extrema of the angle across the move. */
  minCos: number; maxCos: number;
  minSin: number; maxSin: number;
  minTan: number; maxTan: number;
  /** Total absolute travel (rad) — the sweep the user watches. */
  travel: number;
}

/** The full tensor for one power: every animated joint's bounds. */
export interface PowerTensor {
  className: ClassName;
  skill: string;
  kind: string;
  duration: number;
  joints: JointBounds[];
  /** The largest travel of any joint (the move's overall sweep). */
  maxTravel: number;
  /** The joint that moves the most. */
  primeJoint: JointName | null;
}

const SAMPLES = 48;

/** Compute the joint bounds for one skill's animation against the default skeleton. */
export function powerTensor(className: ClassName, skill: Skill): PowerTensor {
  const sk: Skeleton = defaultHumanoid();
  const limits = sk.limits();
  const acc = new Map<JointName, { angles: number[]; times: number[] }>();
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const pose = poseAt(skill.animation, t, limits);
    for (const [joint, angle] of pose) {
      if (!acc.has(joint)) acc.set(joint, { angles: [], times: [] });
      acc.get(joint)!.angles.push(angle);
      acc.get(joint)!.times.push(t * skill.animation.duration);
    }
  }
  const joints: JointBounds[] = [];
  for (const [joint, { angles, times }] of acc) {
    const min = Math.min(...angles), max = Math.max(...angles);
    const vels = angles.slice(1).map((a, i) => Math.abs((a - angles[i]) / Math.max(1e-6, times[i + 1] - times[i])));
    const cos = angles.map(Math.cos), sin = angles.map(Math.sin), tan = angles.map((a) => Math.tan(Math.max(-1.5, Math.min(1.5, a))));
    joints.push({
      joint,
      minAngle: min, maxAngle: max,
      maxVel: vels.length ? Math.max(...vels) : 0,
      minCos: Math.min(...cos), maxCos: Math.max(...cos),
      minSin: Math.min(...sin), maxSin: Math.max(...sin),
      minTan: Math.min(...tan), maxTan: Math.max(...tan),
      travel: max - min,
    });
  }
  const prime = joints.reduce<JointBounds | null>((best, j) => (best === null || j.travel > best.travel ? j : best), null);
  return {
    className,
    skill: skill.name,
    kind: skill.kind,
    duration: skill.animation.duration,
    joints,
    maxTravel: prime?.travel ?? 0,
    primeJoint: prime?.joint ?? null,
  };
}

/** The tensor for all three powers of one class. */
export function classTensors(className: ClassName): PowerTensor[] {
  return skillsForClass(className).map((s) => powerTensor(className, s));
}

/** The tensor for every class's every power (the full QA envelope). */
export function allTensors(): PowerTensor[] {
  return CLASSES.flatMap((c) => classTensors(c));
}
