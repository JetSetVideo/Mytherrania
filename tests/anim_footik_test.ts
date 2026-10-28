// Lane C (R04): two-bone foot IK — reach, pelvis drop, sole parallel to the ground, abduction.
import {
  ankleFromBall, newLegSolution, newTwoBoneResult, pelvisDropFor, respectHipLimit, sampleGround, smoothMax, smoothMin,
  solveLeg, solveLegInPelvis, solveTwoBone, type TwoBoneChain,
} from "../src/game/anim/FootIK.ts";
import { JOINT_COUNT, JOINT_INDEX, legFK, legFK3, newLegFK, newLegFK3 } from "../src/game/anim/Rig.ts";
import { legacyLegGeometryFor } from "../src/game/anim/LegacyGeometry.ts";

function near(a: number, b: number, eps: number, m = ""): void {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${m} expected ~${b}, got ${a} (eps ${eps})`);
}
function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const CHAIN: TwoBoneChain = { upper: 0.45, lower: 0.42, reachMargin: 1e-4, softness: 0 };
const MM = 1e-3;

Deno.test("solveTwoBone hits reachable targets within 1 mm, knee bends forward only", () => {
  const r = newTwoBoneResult();
  for (const [ty, tz] of [[-0.8, 0.1], [-0.6, -0.3], [-0.5, 0.45], [-0.3, 0.2], [-0.86, 0]]) {
    solveTwoBone(0, 0, ty, tz, CHAIN, r);
    assert(r.reachable, `target ${ty},${tz} should be reachable`);
    near(Math.hypot(r.endY - ty, r.endZ - tz), 0, MM, `miss for ${ty},${tz}`);
    assert(r.kneeFlex <= 0, "Skeleton knee angle is <= 0");
    // The knee juts FORWARD of the hip->ankle line (human knee): its z exceeds the line's z there.
    const kz = CHAIN.upper * Math.sin(r.upperPitch), ky = -CHAIN.upper * Math.cos(r.upperPitch);
    // Signed offset along the line's forward normal n = (z: -dy, y: dz): >= 0 means forward.
    assert(kz * -ty + ky * tz >= -1e-12, `knee behind the line for ${ty},${tz}`);
    near(r.pelvisDrop, 0, 1e-12, "no drop for a reachable target");
  }
});

Deno.test("solveTwoBone clamps reach to [|t-s|+ε, t+s-ε] and reports the pelvis drop for an unreachable target", () => {
  const r = newTwoBoneResult();
  solveTwoBone(0, 0, -1.2, 0.3, CHAIN, r);
  assert(!r.reachable, "1.24 m is beyond 0.87 m of leg");
  near(r.reach, CHAIN.upper + CHAIN.lower - CHAIN.reachMargin, 1e-9, "reach clamped to t+s-ε");
  assert(r.pelvisDrop > 0, "a drop is required");
  // Lowering the hip by the reported drop makes the same target reachable and hit within 1 mm.
  solveTwoBone(-r.pelvisDrop, 0, -1.2, 0.3, CHAIN, r);
  near(Math.hypot(r.endY + 1.2, r.endZ - 0.3), 0, MM, "after the drop");
  // Too close: clamped to |t - s| + ε, never NaN.
  solveTwoBone(0, 0, -0.001, 0, CHAIN, r);
  assert(Number.isFinite(r.upperPitch) && Number.isFinite(r.kneeFlex), "finite at the inner limit");
  near(r.reach, Math.abs(CHAIN.upper - CHAIN.lower) + 1e-4, 1e-9, "inner clamp");
  // pelvisDropFor never asks the pelvis to rise.
  assert(pelvisDropFor(0, 0, -0.2, 0, 0.8) === 0, "no negative drop");
});

Deno.test("smoothMin is exact outside its band and never above either input", () => {
  near(smoothMin(0.2, 1, 0.1), 0.2, 1e-12);
  near(smoothMin(3, 1, 0.1), 1, 1e-12);
  for (let a = 0.8; a <= 1.2; a += 0.01) assert(smoothMin(a, 1, 0.1) <= Math.min(a, 1) + 1e-12, "below both");
  near(smoothMax(0.2, 1, 0.1), 1, 1e-12);
});

Deno.test("solveLeg keeps the sole parallel to flat ground and on a 15° slope, ball within 1 mm", () => {
  const g = legacyLegGeometryFor("human", null, 1.75, 75);
  const chain: TwoBoneChain = { upper: g.thigh, lower: g.shin, reachMargin: 1e-4, softness: 0 };
  const sol = newLegSolution(), fk = newLegFK(), angles = new Float64Array(JOINT_COUNT);
  for (const slopeDeg of [0, 15, -15]) {
    const slope = slopeDeg * Math.PI / 180;
    for (const ballZ of [-0.1, 0.05, 0.2]) {
      const hip = new Float64Array(2);
      // hip from the trunk at zero pitch
      const hy = g.trunk[0].y + g.trunk[1].y + g.hipOffset.y;
      hip[0] = hy; hip[1] = 0;
      const ballY = hy - 0.62 + Math.tan(slope) * ballZ;
      solveLeg(hip[0], hip[1], 0, ballY, ballZ, -slope, slope, g, chain, sol);
      angles[JOINT_INDEX.hipL] = sol.hip; angles[JOINT_INDEX.kneeL] = sol.knee;
      angles[JOINT_INDEX.ankleL] = sol.ankle; angles[JOINT_INDEX.toeL] = sol.toe;
      legFK(g, angles, 0, fk);
      near(Math.hypot(fk.ballY - ballY, fk.ballZ - ballZ), 0, MM, `ball miss slope ${slopeDeg} z ${ballZ}`);
      near(fk.footPitch, -slope, 1e-9, "sole parallel to the ground");
      near(fk.footPitch + sol.toe, -slope, 1e-9, "toes flat on the ground");
      assert(sol.knee <= 0, "knee flexes forward only");
    }
  }
});

Deno.test("ankleFromBall: a level foot puts the ankle soleOffset above and ballForward behind the ball", () => {
  const out = new Float64Array(2);
  ankleFromBall(0, 0, 0, 0.07, 0.15, out);
  near(out[0], 0.07, 1e-12); near(out[1], -0.15, 1e-12);
  ankleFromBall(0, 0, 0.4, 0.07, 0.15, out); // push-off: heel up about the ball
  assert(out[0] > 0.07, "toe-down roll lifts the ankle");
});

Deno.test("solveLegInPelvis reaches a foot BESIDE the hip with abduction (3D FK within 1 mm)", () => {
  const g = legacyLegGeometryFor("human", null, 1.75, 75);
  const chain: TwoBoneChain = { upper: g.thigh, lower: g.shin, reachMargin: 1e-4, softness: 0 };
  const sol = newLegSolution(), fk = newLegFK3(), angles = new Float64Array(JOINT_COUNT);
  const hipY = g.trunk[0].y + g.trunk[1].y + g.hipOffset.y;
  for (const [dx, dz] of [[0.12, 0.05], [-0.08, -0.1], [0, 0.15]]) {
    const dy = -0.6;
    solveLegInPelvis(dx, dy, dz, 0, 0, 0, chain, -0.6, 0.6, sol);
    angles[JOINT_INDEX.hipR] = sol.hip; angles[JOINT_INDEX.kneeR] = sol.knee; angles[JOINT_INDEX.ankleR] = sol.ankle;
    legFK3(g, angles, 1, sol.roll, -sol.roll, fk);
    near(fk.ankle[0] - g.hipLateral[1], dx, MM, "lateral");
    near(fk.ankle[1] - hipY, dy, MM, "vertical");
    near(fk.ankle[2] - g.hipOffset.z, dz, MM, "forward");
    near(sol.residual, 0, MM, "residual");
  }
});

Deno.test("sampleGround measures a 15° plane's pitch along the probe direction", () => {
  const t = Math.tan(15 * Math.PI / 180);
  const g = { height: 0, slopePitch: 0 };
  sampleGround((_x, z) => t * z, 1, 2, 0, 1, 0.1, g);
  near(g.slopePitch, 15 * Math.PI / 180, 1e-9); near(g.height, 2 * t, 1e-12);
  sampleGround((_x, z) => t * z, 1, 2, 1, 0, 0.1, g); // across the fall line: level
  near(g.slopePitch, 0, 1e-12);
});

// ---- lane C2 -------------------------------------------------------------------------------------

Deno.test("respectHipLimit: a clamped hip keeps the ankle at the target height (never below it)", () => {
  const ik = newTwoBoneResult();
  const lim = { hipMin: -1.2, hipMax: 0.5, kneeMin: -2.4, kneeMax: 0 };
  // Targets that need more than 0.5 rad of thigh flexion: far ahead, and close in front of the hip.
  for (const [ty, tz] of [[-0.55, 0.55], [-0.35, 0.3], [-0.7, 0.35]]) {
    solveTwoBone(0, 0, ty, tz, CHAIN, ik);
    assert(ik.upperPitch > lim.hipMax, `target (${ty}, ${tz}) needs the limit`);
    assert(respectHipLimit(ty, tz, CHAIN, lim, ik), "limit reported");
    near(ik.upperPitch, lim.hipMax, 1e-12, "thigh clamped");
    assert(ik.endY >= ty - MM, `ankle ${ik.endY.toFixed(4)} below target ${ty}`);
    assert(ik.kneeFlex <= 0 && ik.kneeFlex >= lim.kneeMin, "knee inside its window");
    // FK of the returned pitches lands where the result says.
    near(ik.endY, -CHAIN.upper * Math.cos(ik.upperPitch) - CHAIN.lower * Math.cos(ik.lowerPitch), 1e-12, "FK y");
  }
  // Inside the window nothing changes.
  solveTwoBone(0, 0, -0.8, 0.1, CHAIN, ik);
  const before = ik.upperPitch;
  assert(!respectHipLimit(-0.8, 0.1, CHAIN, lim, ik) && ik.upperPitch === before, "untouched inside the window");
});

Deno.test("solveLegInPelvis: a clamped abduction keeps the ankle at the target HEIGHT; the miss is lateral", () => {
  const g = legacyLegGeometryFor("human", null, 1.75, 75);
  const chain: TwoBoneChain = { upper: g.thigh, lower: g.shin, reachMargin: 1e-4, softness: 0 };
  const sol = newLegSolution(), fk = newLegFK3(), angles = new Float64Array(JOINT_COUNT);
  const hipY = g.trunk[0].y + g.trunk[1].y + g.hipOffset.y;
  const dx = 0.4, dy = -0.6, dz = 0.05; // needs atan(0.4/0.6) = 0.59 rad, allowed 0.3
  solveLegInPelvis(dx, dy, dz, 0, 0, 0, chain, -0.3, 0.3, sol);
  near(sol.roll, 0.3, 1e-12, "roll clamped");
  angles[JOINT_INDEX.hipR] = sol.hip; angles[JOINT_INDEX.kneeR] = sol.knee; angles[JOINT_INDEX.ankleR] = sol.ankle;
  legFK3(g, angles, 1, sol.roll, -sol.roll, fk);
  near(fk.ankle[1] - hipY, dy, MM, "height kept");
  near(sol.residual, Math.abs(dx + dy * Math.tan(0.3)), MM, "residual = lateral miss");
  // A bind-pose abduction (rest roll) is added under the solved roll: the rig receives roll - rest.
  solveLegInPelvis(0.1, -0.6, 0, 0, 0, 0, chain, -0.6, 0.6, sol, undefined, undefined, 0.1);
  near(sol.roll, Math.atan2(0.1, 0.6) - 0.1, 1e-12, "roll relative to the bind abduction");
});
