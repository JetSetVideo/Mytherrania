// Lane C (R04): the per-fighter Animator end to end — limits, continuity, planted feet, slopes,
// frame-rate independence, skill layering.
import { ALL_SKILLS } from "../src/game/Skills.ts";
import { defaultHumanoid } from "../src/game/Skeleton.ts";
import { trackOffset } from "../src/game/AnimationCurve.ts";
import { Animator } from "../src/game/anim/Animator.ts";
import { DEFAULT_GAIT } from "../src/game/anim/Gait.ts";
import { legacyLegGeometryFor } from "../src/game/anim/LegacyGeometry.ts";
import { JOINT_COUNT, JOINT_INDEX, limitTableFrom } from "../src/game/anim/Rig.ts";
import { derivedSpeedBound, runScenario, type ScenarioResult, type ScenarioSegment } from "../src/game/anim/Scenario.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const GEOM = legacyLegGeometryFor("human", null, 1.75, 75);
const LIM = limitTableFrom(defaultHumanoid().limits());
const RANGES = Array.from({ length: JOINT_COUNT }, (_, j) => LIM.max[j] - LIM.min[j]);
/** Derived bound on joint speed (rad/s): fastest gait sweep vs fastest skill curve. */
const OMEGA = derivedSpeedBound(RANGES, DEFAULT_GAIT.minSwingTime, ALL_SKILLS.map((s) => s.animation));
const ACCEL = 6.5 / 0.12; // engine PLAYER_WALK: topSpeed / riseTime (m/s²)
const TAN15 = Math.tan(15 * Math.PI / 180);
const make = () => new Animator(GEOM, LIM);

/** Common assertions: limits, continuity, planting. */
function checkRun(name: string, r: ScenarioResult, hz: number, opts: { maxLimitedShare?: number } = {}): void {
  assert(r.limitViolations === 0, `${name}: ${r.limitViolations} joint-limit violations`);
  let worst = 0;
  for (let j = 0; j < JOINT_COUNT; j++) worst = Math.max(worst, r.maxStep[j]);
  assert(worst <= OMEGA / hz + 1e-9, `${name}: max per-frame step ${worst} > bound ${OMEGA / hz}`);
  const share = r.speedLimited / (r.frames * JOINT_COUNT);
  assert(share <= (opts.maxLimitedShare ?? 0), `${name}: speed limiter engaged on ${r.speedLimited} joint-frames`);
  for (const d of r.drift) assert(d < 0.02, `${name}: a planted foot slid ${d} m in one stance`);
  for (const e of r.soleError) assert(e < 0.01, `${name}: planted sole ${e} m off the ground`);
  assert(r.drift.length >= 4, `${name}: steps were taken (${r.drift.length})`);
  const coverage = r.honestPlantedFrames / Math.max(1, r.gaitPlantedFrames);
  assert(coverage >= 0.95, `${name}: only ${coverage} of gait-planted frames are honestly planted`);
}

const lungeSkill = ALL_SKILLS.find((s) => s.animation.lunge > 1 && s.animation.tracks.some((t) => t.joint.startsWith("hip")))!;

Deno.test("walk -> run -> stop -> attack -> hit at game speeds: within limits, no pops, feet planted", () => {
  const SEQ: ScenarioSegment[] = [
    { duration: 0.5, speed: 0 }, { duration: 2, speed: 2.1 }, { duration: 2, speed: 4.2 },
    { duration: 1, speed: 0, engaged: true }, { duration: 0.5, speed: 0, attack: true, engaged: true },
    { duration: 0.35, speed: 0, hit: true, engaged: true }, { duration: 1, speed: 0 },
  ];
  // At 60 Hz the motion stays under the bound by itself (limiter never engages); at 144 Hz the
  // finer sampling resolves brief peaks, allowed on at most 0.1% of joint-frames.
  checkRun("game speeds @60", runScenario(make(), SEQ, { hz: 60, accel: ACCEL }), 60);
  checkRun("game speeds @144", runScenario(make(), SEQ, { hz: 144, accel: ACCEL }), 144, { maxLimitedShare: 0.001 });
});

Deno.test("player top speed 6.5 m/s + skills: bound holds, limiter engages on < 0.5% of joint-frames", () => {
  const SEQ: ScenarioSegment[] = [
    { duration: 0.5, speed: 0 }, { duration: 1.5, speed: 2.1 }, { duration: 2, speed: 6.5 },
    { duration: 1, speed: 0, engaged: true },
    { duration: lungeSkill.animation.duration + 0.4, speed: 0, engaged: true, skill: lungeSkill.animation },
    { duration: 0.5, speed: 0, attack: true }, { duration: 0.35, speed: 0, hit: true }, { duration: 1, speed: 0 },
  ];
  checkRun("sprint @60", runScenario(make(), SEQ, { hz: 60, accel: ACCEL }), 60, { maxLimitedShare: 0.005 });
});

Deno.test("skill curves never need the speed limiter (their peak rate is under the animator's bound)", () => {
  const an = make();
  const skillOnly = derivedSpeedBound([], 1e9, ALL_SKILLS.map((s) => s.animation));
  assert(skillOnly <= an.blender.maxJointSpeed, `skill peak ${skillOnly} rad/s > limit ${an.blender.maxJointSpeed}`);
});

Deno.test("feet reach the ground within 1 cm during stance on ±15° slopes and across a cross-fall", () => {
  const WALK: ScenarioSegment[] = [{ duration: 0.5, speed: 0 }, { duration: 4, speed: 2.1 }, { duration: 1, speed: 0 }];
  for (const [name, ground] of [
    ["uphill", (_x: number, z: number) => TAN15 * z],
    ["downhill", (_x: number, z: number) => -TAN15 * z],
    ["cross-fall", (x: number, _z: number) => TAN15 * x],
  ] as const) {
    checkRun(name, runScenario(make(), WALK, { hz: 60, accel: ACCEL, ground }), 60, { maxLimitedShare: 0.001 });
  }
});

Deno.test("frame-rate independence: 60 Hz and 144 Hz give the same pose after 1 s", () => {
  const ONE: ScenarioSegment[] = [{ duration: 0.4, speed: 1.4 }, { duration: 0.6, speed: 1.4, attack: true }];
  const a = runScenario(make(), ONE, { hz: 60, accel: ACCEL }).finalAngles;
  const b = runScenario(make(), ONE, { hz: 144, accel: ACCEL }).finalAngles;
  let worst = 0;
  for (let j = 0; j < JOINT_COUNT; j++) worst = Math.max(worst, Math.abs(a[j] - b[j]));
  assert(worst < 0.02, `max |θ60 - θ144| = ${worst} rad`);
});

Deno.test("standing: knees flexed, root lowered, both soles planted; output object reused (no per-frame allocation)", () => {
  const an = make();
  const flat = () => 0;
  an.reset(0, 0, 0);
  const inp = {
    x: 0, z: 0, yaw: 0, rootY: 0.6, speed: 0, moveDirLocal: 0, turnRate: 0, grounded: true, hit: false,
    attack: false, block: false, ko: false, skill: null, skillProgress: 0, groundHeight: flat,
  };
  const first = an.update(1 / 60, inp);
  let out = first;
  for (let k = 0; k < 60; k++) out = an.update(1 / 60, inp);
  assert(out === first && out.angles === first.angles, "same output object every frame");
  assert(out.footPlant.left && out.footPlant.right, "both planted");
  assert(out.rootOffsetY < 0, "root lowered to bend the knees");
  assert(out.angles[JOINT_INDEX.kneeL] < -0.2 && out.angles[JOINT_INDEX.kneeR] < -0.2, "knees flexed (Skeleton sign)");
});

Deno.test("a skill drives the upper body from its curve; a leg skill takes the legs (feet not claimed planted)", () => {
  const an = make();
  const anim = lungeSkill.animation;
  an.reset(0, 0, 0);
  const t = anim.hitAt; // the strike frame
  let out = an.output;
  const steps = Math.round(anim.duration * t * 60);
  for (let k = 0; k <= steps; k++) {
    out = an.update(1 / 60, {
      x: 0, z: 0, yaw: 0, speed: 0, moveDirLocal: 0, turnRate: 0, grounded: true, hit: false, attack: true,
      block: false, ko: false, skill: anim, skillProgress: k / 60 / anim.duration, groundHeight: () => 0,
    });
  }
  const tr = anim.tracks.find((x) => x.joint === "shoulderR")!;
  const j = JOINT_INDEX.shoulderR;
  const curve = Math.max(LIM.min[j], Math.min(LIM.max[j], LIM.rest[j] + trackOffset(tr, steps / 60 / anim.duration)));
  assert(Math.abs(out.angles[j] - curve) < 0.05, `shoulderR ${out.angles[j]} follows the curve ${curve}`);
  assert(!out.footPlant.left && !out.footPlant.right, "the skill owns the legs: not claimed planted");
});
