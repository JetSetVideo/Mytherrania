// Lane C (R04): the layered pose blender — springs crossfade, masks, additive layers, limits,
// frame-rate independence, the angular speed limit.
import { MASK_FULL, MASK_LOWER, MASK_UPPER, PoseBlender } from "../src/game/anim/PoseBlend.ts";
import { JOINT_COUNT, JOINT_INDEX, limitTableFrom } from "../src/game/anim/Rig.ts";
import { defaultHumanoid } from "../src/game/Skeleton.ts";

function near(a: number, b: number, eps: number, m = ""): void {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${m} expected ~${b}, got ${a} (eps ${eps})`);
}
function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const LIM = limitTableFrom(defaultHumanoid().limits());
const SH = JOINT_INDEX.shoulderR, HIP = JOINT_INDEX.hipL, SPINE = JOINT_INDEX.spine;

function makeBlender(pop = 0.05) {
  const b = new PoseBlender(LIM, pop);
  b.addLayer({ name: "base", mode: "override", mask: MASK_FULL, smoothTime: 0 });
  const upper = b.addLayer({ name: "upper", mode: "override", mask: MASK_UPPER, smoothTime: 0.1 });
  const add = b.addLayer({ name: "add", mode: "additive", mask: MASK_FULL, smoothTime: 0.1 });
  b.values(upper)[SH] = -1.5;
  b.values(upper)[HIP] = 0.9; // masked out: upper layer must not touch the hip
  b.values(add)[SPINE] = 0.2;
  return { b, upper, add };
}

Deno.test("layer weights crossfade through a critically damped spring (no snap, no overshoot)", () => {
  const { b, upper } = makeBlender();
  b.setTarget(upper, 1);
  b.stepWeights(1 / 60);
  assert(b.weight(upper) > 0 && b.weight(upper) < 0.2, `first frame weight ${b.weight(upper)} must not snap`);
  let prev = b.weight(upper);
  for (let k = 0; k < 120; k++) {
    b.stepWeights(1 / 60);
    assert(b.weight(upper) >= prev - 1e-12 && b.weight(upper) <= 1, "monotone, never above 1");
    prev = b.weight(upper);
  }
  near(b.weight(upper), 1, 1e-3, "settles");
});

Deno.test("masks and modes: override lerps only masked joints, additive adds offsets, result within limits", () => {
  const { b, upper, add } = makeBlender();
  b.setWeightImmediate(upper, 0.5);
  b.setWeightImmediate(add, 1);
  near(b.blendJoint(SH), 0.5 * -1.5, 1e-12, "half-way override");
  near(b.blendJoint(HIP), LIM.rest[HIP], 1e-12, "masked-out joint untouched");
  near(b.blendJoint(SPINE), LIM.rest[SPINE] + 0.2, 1e-12, "additive offset");
  b.values(add)[SPINE] = 5; // absurd offset: clamped to the joint limit
  near(b.blendJoint(SPINE), LIM.max[SPINE], 1e-12, "clamped");
  near(b.baseAuthority(SH), 0.5, 1e-12, "base keeps half the shoulder");
  near(b.baseAuthority(HIP), 1, 1e-12, "base owns the hip");
  assert(MASK_LOWER[HIP] === 1 && MASK_UPPER[HIP] === 0, "mask tables");
});

function run(hz: number): Float64Array {
  const { b, upper, add } = makeBlender();
  const out = new Float64Array(JOINT_COUNT);
  const dt = 1 / hz;
  for (let f = 0; f < hz; f++) { // exactly 1 s
    // Switch times 0.25 s and 0.5 s are whole frames at BOTH rates (15/60 = 36/144), so the only
    // difference left is how each rate integrates the springs.
    b.setTarget(upper, f >= hz / 4 ? 1 : 0);
    b.setTarget(add, f >= hz / 2 ? 1 : 0);
    b.values(0)[JOINT_INDEX.kneeL] = f >= hz / 4 ? -1.2 : -0.3; // a base-layer step through the pop guard
    b.stepWeights(dt);
    b.evaluate(dt, out);
  }
  return out;
}

Deno.test("blending is frame-rate independent: 60 Hz and 144 Hz agree after 1 s", () => {
  const a = run(60), c = run(144);
  let worst = 0;
  for (let j = 0; j < JOINT_COUNT; j++) worst = Math.max(worst, Math.abs(a[j] - c[j]));
  assert(worst < 2e-3, `max |θ60 - θ144| = ${worst} rad`);
});

Deno.test("the angular speed limit bounds every per-frame step", () => {
  const { b } = makeBlender(0);
  b.maxJointSpeed = 6; // rad/s
  const out = new Float64Array(JOINT_COUNT);
  b.evaluate(1 / 60, out);
  b.values(0)[SH] = -2.0; // a 2 rad jump requested in one frame
  b.evaluate(1 / 60, out);
  near(out[SH], LIM.rest[SH] - 6 / 60, 1e-12, "shortened to maxJointSpeed·dt");
  assert(b.speedLimited === 1, "counted");
});
