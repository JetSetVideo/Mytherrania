import { dampedSin, effectStrength, hopAt, impulse, jointAngle, lungeAt, trackOffset } from "../src/game/AnimationCurve.ts";
import { ALL_SKILLS, skillsForClass, type JointTrack } from "../src/game/Skills.ts";
import { defaultHumanoid } from "../src/game/Skeleton.ts";
import { CLASSES } from "../src/game/Stats.ts";
import type { JointName } from "../src/game/Skeleton.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

Deno.test("impulse: zero at both ends, exactly one at the peak, monotonic either side", () => {
  assert(impulse(0, 0.4) === 0, "starts at rest");
  assert(impulse(1, 0.4) === 0, "returns to rest");
  assert(impulse(-0.2, 0.4) === 0 && impulse(1.5, 0.4) === 0, "clamped outside [0,1]");
  assert(near(impulse(0.4, 0.4), 1), `peak should be 1, got ${impulse(0.4, 0.4)}`);
  // Monotonic rise then fall: the curve has exactly one maximum.
  let prev = -1;
  for (let t = 0.01; t < 0.4; t += 0.01) { const v = impulse(t, 0.4); assert(v > prev, `not rising at ${t}`); prev = v; }
  prev = 2;
  for (let t = 0.41; t < 1; t += 0.01) { const v = impulse(t, 0.4); assert(v < prev, `not falling at ${t}`); prev = v; }
});

Deno.test("impulse: the peak always sits where it was asked for", () => {
  for (const p of [0.15, 0.25, 0.34, 0.5, 0.7]) {
    let bestT = 0, bestV = -1;
    for (let t = 0; t <= 1; t += 0.001) { const v = impulse(t, p); if (v > bestV) { bestV = v; bestT = t; } }
    assert(near(bestV, 1, 1e-3), `peak value ${bestV} for p=${p}`);
    assert(Math.abs(bestT - p) < 0.01, `peak found at ${bestT}, asked for ${p}`);
  }
});

Deno.test("impulse is continuous at the peak, and deliberately asymmetric (fast strike, slower recovery)", () => {
  // The two halves are sine (rise) and cosine (fall). They must MEET at the peak...
  const p = 0.4;
  assert(near(impulse(p - 1e-7, p), 1, 1e-5) && near(impulse(p + 1e-7, p), 1, 1e-5), "discontinuous at the peak");
  // ...but they are NOT mirror images: the strike lands fast and the recovery is longer.
  let riseArea = 0, fallArea = 0;
  for (let t = 0; t < p; t += 0.001) riseArea += impulse(t, p) * 0.001;
  for (let t = p; t < 1; t += 0.001) fallArea += impulse(t, p) * 0.001;
  assert(riseArea < fallArea, `rise ${riseArea.toFixed(3)} should be briefer than fall ${fallArea.toFixed(3)}`);
});

Deno.test("dampedSin decays: bounded by its exponential envelope, and its peaks shrink", () => {
  // |dampedSin| can never exceed the decaying envelope e^(-k t).
  for (let t = 0; t < 1; t += 0.01) {
    assert(Math.abs(dampedSin(t, 3, 0, 6)) <= Math.exp(-6 * t) + 1e-12, `exceeded its envelope at ${t}`);
  }
  // Successive peaks of the oscillation are strictly smaller.
  const peakIn = (from: number, to: number) => {
    let best = 0;
    for (let t = from; t < to; t += 0.0005) best = Math.max(best, Math.abs(dampedSin(t, 3, 0, 6)));
    return best;
  };
  const first = peakIn(0, 1 / 6), second = peakIn(1 / 6, 3 / 6), third = peakIn(3 / 6, 5 / 6);
  assert(first > second && second > third, `peaks must shrink: ${first}, ${second}, ${third}`);
  assert(dampedSin(0, 3, 0, 6) === 0 && dampedSin(1, 3, 0, 6) === 0, "silent at both ends");
});

Deno.test("jointAngle clamps into the joint's own limits, however large the amplitude", () => {
  const tr: JointTrack = { joint: "shoulderR", amplitude: 99, peak: 0.4 };
  assert(jointAngle(tr, 0.4, 0, -2.4, 0.6) === 0.6, "must clamp to max");
  const down: JointTrack = { joint: "shoulderR", amplitude: -99, peak: 0.4 };
  assert(jointAngle(down, 0.4, 0, -2.4, 0.6) === -2.4, "must clamp to min");
  // At rest the angle is the rest value.
  assert(jointAngle(tr, 0, 0.13, -2.4, 0.6) === 0.13, "rest at t=0");
  assert(jointAngle(tr, 1, 0.13, -2.4, 0.6) === 0.13, "rest at t=1");
});

Deno.test("no skill drives the same joint twice, and every joint stays in its limits", () => {
  // Duplicate tracks silently shadow each other (the last one wins), which hid a
  // real bug: the spine was animated twice in one stance.
  for (const s of ALL_SKILLS) {
    const seen = new Set<JointName>();
    for (const tr of s.animation.tracks) {
      assert(!seen.has(tr.joint), `${s.id} drives ${tr.joint} twice`);
      seen.add(tr.joint);
    }
  }
});

Deno.test("every skill's tracks stay inside the skeleton's real joint limits", () => {
  const limits = realLimits();
  for (const cls of CLASSES) {
    for (const skill of skillsForClass(cls)) {
      for (const tr of skill.animation.tracks) {
        const lim = limits.get(tr.joint)!;
        // Per-joint, not aggregate: a joint pinned for 80% of the swing is a bug
        // that an average across all tracks would hide.
        let pinned = 0, samples = 0;
        for (let t = 0; t <= 1.0001; t += 0.01) {
          const raw = jointAngle(tr, t, lim.rest, -Infinity, Infinity);
          const clamped = jointAngle(tr, t, lim.rest, lim.min, lim.max);
          samples++;
          if (Math.abs(raw - clamped) > 1e-9) pinned++;
          assert(clamped >= lim.min - 1e-9 && clamped <= lim.max + 1e-9, `${skill.id} ${tr.joint} escaped its limits`);
        }
        assert(pinned / samples < 0.2, `${skill.id} pins ${tr.joint} on ${(100 * pinned / samples).toFixed(0)}% of the swing`);
      }
    }
  }
});

Deno.test("the weapon arm really swings: it must cover a useful part of its range", () => {
  const limits = realLimits();
  for (const cls of CLASSES) {
    for (const skill of skillsForClass(cls)) {
      const arm = skill.animation.tracks.find((t) => t.joint === "shoulderR")!;
      const lim = limits.get("shoulderR")!;
      let lo = Infinity, hi = -Infinity;
      for (let t = 0; t <= 1.0001; t += 0.005) {
        const a = jointAngle(arm, t, lim.rest, lim.min, lim.max);
        lo = Math.min(lo, a); hi = Math.max(hi, a);
      }
      const travel = hi - lo;
      // Absolute angular travel, not a fraction of the arm's (very wide) range: a
      // swing under ~40 degrees reads as no swing at all, and a power strike must
      // be a genuinely big motion.
      const need = skill.kind === "power" ? 1.3 : 0.7;
      assert(travel > need, `${skill.id} moves the weapon arm only ${(travel * 57.3).toFixed(0)} deg, needs > ${(need * 57.3).toFixed(0)}`);
      // And it must reach the strike, not just drift. The secondary wobble nudges the
      // exact maximum, so require the strike frame to be within 10% of full travel.
      const atHit = jointAngle(arm, skill.animation.hitAt, lim.rest, lim.min, lim.max);
      const extreme = Math.abs(lo) > Math.abs(hi) ? lo : hi;
      assert(Math.abs(atHit - extreme) < 0.1 * travel, `${skill.id} peaks the weapon arm away from its hit frame`);
    }
  }
});

function realLimits(): Map<JointName, { rest: number; min: number; max: number }> {
  return defaultHumanoid().limits();
}

Deno.test("lunge and hop leave the ground and return: start and end at rest", () => {
  const dash = skillsForClass("Warrior").find((s) => s.kind === "dash")!;
  assert(lungeAt(dash.animation, 0) === 0, "lunge starts at 0");
  assert(near(lungeAt(dash.animation, 1), dash.animation.lunge, 1e-9), "lunge holds the ground gained");
  assert(lungeAt(dash.animation, 0.5) > 0, "lunge moves forward");
  assert(near(hopAt(dash.animation, 0), 0) && near(hopAt(dash.animation, 1), 0), "hop starts and ends grounded");
  assert(hopAt(dash.animation, 0.5) > 0, "hop leaves the ground");
  const defense = skillsForClass("Warrior").find((s) => s.kind === "defense")!;
  assert(lungeAt(defense.animation, 0.5) === 0 && hopAt(defense.animation, 0.5) === 0, "defence holds position");
});

Deno.test("effect strength scales with the share of health removed, and peaks on the strike", () => {
  const power = skillsForClass("Warrior").find((s) => s.kind === "power")!;
  const hit = power.animation.hitAt;
  const graze = effectStrength(power.animation, hit, 0.02);
  const solid = effectStrength(power.animation, hit, 0.5);
  const huge = effectStrength(power.animation, hit, 1);
  assert(graze < solid && solid < huge, `effect must grow with damage: ${graze}, ${solid}, ${huge}`);
  // Off the strike the effect is weak: it flares, it does not stay lit.
  assert(effectStrength(power.animation, 0.95, 1) < huge * 0.5, "effect must fade after the strike");
  assert(effectStrength(power.animation, 0, 1) === 0, "no effect before the animation starts");
  assert(effectStrength(power.animation, hit, 5) <= 1.6, "effect stays bounded even with a silly damage fraction");
});

Deno.test("the skeleton reports the hit frame exactly once, on the frame that crosses hitAt", () => {
  // The engine resolves a skill's strike via Skeleton.consumeSkillHit, not a pure helper.
  const power = skillsForClass("Warrior").find((s) => s.kind === "power")!;
  const sk = defaultHumanoid();
  sk.playSkill(power.animation);
  const dt = power.animation.duration / 100;
  let fired = 0, firstAt = -1;
  for (let i = 0; i < 100; i++) {
    sk.update(dt);
    if (sk.consumeSkillHit()) { fired++; if (firstAt < 0) firstAt = sk.skillProgress() ?? 1; }
  }
  assert(fired === 1, `the strike must resolve exactly once, fired ${fired}`);
  assert(firstAt >= power.animation.hitAt && firstAt < power.animation.hitAt + 0.02, `fired at ${firstAt}, hitAt ${power.animation.hitAt}`);
});

Deno.test("trackOffset at the peak equals the amplitude", () => {
  assert(trackOffset({ joint: "spine", amplitude: 0.5, peak: 0.5 }, 0.5) === 0.5);
});

Deno.test("a skill owns the pose: the reported pose says so and cannot be clobbered", () => {
  const sk = defaultHumanoid();
  const power = skillsForClass("Warrior").find((s) => s.kind === "power")!;
  // Read through a widening helper so the type guard below does not narrow the
  // field for the rest of the test.
  const poseOf = (): string => sk.pose;
  assert(poseOf() === "idle", "starts idle");
  sk.playSkill(power.animation);
  assert(poseOf() === "skill", `playing a skill must report pose "skill", got "${poseOf()}"`);
  // The engine calls setPose every frame from the movement state; that must not
  // overwrite the skill's ownership of the joints.
  sk.setPose("walk");
  assert(poseOf() === "skill", `setPose clobbered the skill pose: "${poseOf()}"`);
  sk.update(power.animation.duration + 0.01);
  assert(poseOf() === "idle", `pose must return to idle after the skill, got "${poseOf()}"`);
  sk.setPose("walk");
  assert(poseOf() === "walk", "normal poses work again once the skill ends");
});

Deno.test("a pinned skill holds its progress and fires its strike exactly once", () => {
  const sk = defaultHumanoid();
  const power = skillsForClass("Warrior").find((s) => s.kind === "power")!;
  sk.playSkill(power.animation, power.animation.hitAt);
  for (let i = 0; i < 30; i++) sk.update(0.05);
  assert(sk.skillProgress() === power.animation.hitAt, "a pinned skill must not advance");
  assert(sk.consumeSkillHit(), "the held strike should be ready to fire");
  assert(!sk.consumeSkillHit(), "and must fire only once");
});
