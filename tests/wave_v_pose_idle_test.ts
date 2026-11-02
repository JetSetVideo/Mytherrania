// Wave V lane P: IDLE — heels and balls on the ground while the rival sways (the facing hold), a
// breathing torso (period, amplitude, fade), the idle weight shift, frame-rate independence.
// Pure: the Animator driven by Scenario (the engine's frame order) on a legacy leg geometry, plus
// the real skinned rig through tools/anim-report.ts measureIdle.
import { Animator } from "../src/game/anim/Animator.ts";
import { runScenario, type ScenarioSegment } from "../src/game/anim/Scenario.ts";
import { legacyLegGeometryFor } from "../src/game/anim/LegacyGeometry.ts";
import { JOINT_INDEX, limitTableFrom, type Side } from "../src/game/anim/Rig.ts";
import { footWorld, newFootWorld } from "../src/game/anim/Measure.ts";
import { type LiveState, motionStyleFor } from "../src/game/anim/MotionStyle.ts";
import { defaultHumanoid } from "../src/game/Skeleton.ts";
import { buildBody, measureIdle } from "../tools/anim-report.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const LIM = limitTableFrom(defaultHumanoid().limits());
const GEOM = legacyLegGeometryFor("human", null, 1.75, 75);
const FRESH: LiveState = { hpFrac: 1, staminaFrac: 1, manaFrac: 1, exhausted: false };
const TIRED: LiveState = { hpFrac: 0.8, staminaFrac: 0.03, manaFrac: 0.5, exhausted: true };
const DEG = 180 / Math.PI;

interface IdleRun {
  heelMax: number; ballMax: number; pitchMax: number; slide: number; soleMin: number;
  spine: number[]; breath: number[]; sway: number[]; yawOff: number[]; heelEnd: number;
}

/** Stand `seconds` (guard engaged) with the rival's direction = yawFn(t); measure every frame after 1 s. */
function idle(opts: { hz?: number; seconds?: number; yawFn?: (t: number) => number; hold?: boolean; live?: LiveState; segs?: ScenarioSegment[] } = {}): IdleRun {
  const hz = opts.hz ?? 60, an = new Animator(GEOM, LIM), st = motionStyleFor({ race: "human", seed: 3 });
  st.setLiveImmediate(opts.live ?? FRESH);
  an.setStyle(st);
  const fw = newFootWorld();
  const r: IdleRun = { heelMax: 0, ballMax: 0, pitchMax: 0, slide: 0, soleMin: 0, spine: [], breath: [], sway: [], yawOff: [], heelEnd: 0 };
  const total = opts.seconds ?? 10;
  const res = runScenario(an, opts.segs ?? [{ duration: total, speed: 0, engaged: true }], {
    hz, accel: 54, holdFacing: opts.hold ?? true, yawOffset: opts.yawFn,
    onFrame: (t, out, pl) => {
      r.spine.push(out.angles[JOINT_INDEX.spine]); r.breath.push(out.breath); r.sway.push(out.idleSway); r.yawOff.push(out.yawOffset);
      if (t < 1) return;
      for (let i = 0 as Side; i < 2; i = (i + 1) as Side) {
        footWorld(GEOM, out.angles, i, pl, fw, out.hipRoll[i], out.ankleRoll[i]);
        r.heelMax = Math.max(r.heelMax, Math.abs(fw.heelY)); r.ballMax = Math.max(r.ballMax, Math.abs(fw.ballY));
        r.pitchMax = Math.max(r.pitchMax, Math.abs(fw.pitch));
        if (t > total - 0.5) r.heelEnd = Math.max(r.heelEnd, Math.abs(fw.heelY));
      }
    },
  });
  r.slide = Math.max(0, ...res.drift); r.soleMin = res.soleMin;
  return r;
}

const SWAY = (t: number) => 0.06 * Math.sin(2 * Math.PI * t / 5); // a rival swaying ±3.4° over 5 s

Deno.test("idle: with the rival swaying, heels AND balls stay on the ground (facing hold), sole pitch ~0, no slide", () => {
  for (const live of [FRESH, TIRED]) {
    const r = idle({ yawFn: SWAY, live });
    console.log(`facing hold (${live.exhausted ? "tired" : "fresh"}): heel ${(r.heelMax * 1000).toFixed(2)} mm, ball ${(r.ballMax * 1000).toFixed(2)} mm, pitch ${(r.pitchMax * DEG).toFixed(3)}°, slide ${(r.slide * 1000).toFixed(2)} mm`);
    assert(r.heelMax < 0.005 && r.ballMax < 0.005, `heel ${r.heelMax} / ball ${r.ballMax} m off the ground`);
    assert(r.pitchMax * DEG < 0.5, `sole pitch ${(r.pitchMax * DEG).toFixed(2)}°`);
    assert(r.slide < 0.001, `planted foot slid ${(r.slide * 1000).toFixed(2)} mm`);
    assert(r.soleMin > -0.001, `a sole ${(r.soleMin * 1000).toFixed(2)} mm under the floor`);
  }
  // The cause, pinned: a caller that does NOT honour the yaw offset (today's engine) pivots the
  // planted feet onto their balls as the rig turns to follow the rival (lane M's ball pivot).
  const before = idle({ yawFn: SWAY, hold: false });
  console.log(`without the hold: heel ${(before.heelMax * 1000).toFixed(1)} mm, pitch ${(before.pitchMax * DEG).toFixed(2)}°`);
  assert(before.heelMax > 0.015 && before.pitchMax * DEG > 5, "the unpatched path should still show the heel lift it measured");
});

Deno.test("idle: past the slack the body re-faces with a step; the held offset returns to ~0 and the heels end flat", () => {
  // The rival walks around: the facing turns 0.4 rad over 1 s (from t = 1 s), then stays.
  const turn = (t: number) => (t < 1 ? 0 : Math.min(0.4, 0.4 * (t - 1)));
  const r = idle({ yawFn: turn, seconds: 6 });
  const maxOff = Math.max(...r.yawOff.map(Math.abs)), endOff = Math.abs(r.yawOff[r.yawOff.length - 1]);
  console.log(`re-face: max |offset| ${maxOff.toFixed(3)} rad, end ${endOff.toFixed(4)} rad, heels at the end ${(r.heelEnd * 1000).toFixed(2)} mm`);
  assert(maxOff < 0.1 + 0.05, `the held heading lagged ${maxOff.toFixed(3)} rad (slack 0.1)`);
  assert(endOff < 0.01, `the heading never caught up: ${endOff.toFixed(4)} rad`);
  assert(r.heelEnd < 0.005, `heels ${(r.heelEnd * 1000).toFixed(2)} mm up after the re-face`);
});

/** Mean period (s) of a signal from its upward mean crossings. */
function period(xs: number[], hz: number): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length, ups: number[] = [];
  for (let k = 1; k < xs.length; k++) if (xs[k - 1] < m && xs[k] >= m) ups.push(k / hz);
  return (ups[ups.length - 1] - ups[0]) / (ups.length - 1);
}

Deno.test("breathing: 3.5-5 s fresh, faster when tired; the chest pitches a fraction of a degree; frame-rate independent", () => {
  const f = idle({ seconds: 14 }), t = idle({ seconds: 14, live: TIRED });
  const pf = period(f.spine.slice(60), 60), pt = period(t.spine.slice(60), 60);
  const ptp = (xs: number[]) => (Math.max(...xs) - Math.min(...xs)) * DEG;
  const af = ptp(f.spine.slice(120)), at = ptp(t.spine.slice(120));
  console.log(`breath period fresh ${pf.toFixed(2)} s, tired ${pt.toFixed(2)} s; chest pitch peak-to-peak fresh ${af.toFixed(2)}°, tired ${at.toFixed(2)}°`);
  assert(pf >= 3.5 && pf <= 5, `fresh period ${pf}`);
  assert(pt < pf && pt >= 1.6, `tired period ${pt}`);
  assert(af > 0.4 && af < 1.6, `fresh chest pitch peak-to-peak ${af}° (amplitude: a fraction of a degree)`);
  assert(at > af && at < 4, `tired chest ${at}°`);
  // Frame-rate independence: the breath and the sway at t = 6 s agree at 30 / 60 / 144 Hz.
  const at6 = (hz: number) => { const r = idle({ hz, seconds: 6.5 }); const k = Math.round(6 * hz); return [r.breath[k], r.sway[k]]; };
  const [a, b, c] = [at6(30), at6(60), at6(144)];
  assert(Math.abs(a[0] - b[0]) < 0.03 && Math.abs(b[0] - c[0]) < 0.03, `breath ${a[0]} / ${b[0]} / ${c[0]}`);
  assert(Math.abs(a[1] - b[1]) < 3e-4 && Math.abs(b[1] - c[1]) < 3e-4, `sway ${a[1]} / ${b[1]} / ${c[1]}`);
});

Deno.test("idle weight shift: the pelvis drifts 1-2 cm over a seeded 6-9 s period with the feet locked", () => {
  const an = new Animator(GEOM, LIM), st = motionStyleFor({ race: "human", seed: 3 });
  an.setStyle(st);
  assert(an.idleSwayPeriod >= 6 && an.idleSwayPeriod <= 9, `period ${an.idleSwayPeriod}`);
  const r = idle({ seconds: 20 });
  const sw = r.sway.slice(60 * 4);
  const ptp = (Math.max(...sw) - Math.min(...sw)) * 1000;
  console.log(`idle sway: period ${an.idleSwayPeriod.toFixed(2)} s, pelvis peak-to-peak ${ptp.toFixed(1)} mm, slide ${(r.slide * 1000).toFixed(2)} mm`);
  assert(ptp >= 10 && ptp <= 20, `sway ${ptp.toFixed(1)} mm`);
  assert(r.slide < 0.001, `slide ${(r.slide * 1000).toFixed(2)} mm`);
  // Two fighters do not sway in step (seeded).
  const other = new Animator(GEOM, LIM);
  other.setStyle(motionStyleFor({ race: "human", seed: 4 }));
  assert(Math.abs(other.idleSwayPeriod - an.idleSwayPeriod) > 1e-3, "seeded periods");
});

Deno.test("breathing and the weight shift fade while moving and while striking", () => {
  const segs: ScenarioSegment[] = [{ duration: 4, speed: 0, engaged: true }, { duration: 3, speed: 2.1, engaged: true }, { duration: 3, speed: 0, engaged: true, attack: true }];
  const r = idle({ seconds: 10, segs });
  const hz = 60, win = (a: number, b: number, xs: number[]) => xs.slice(Math.round(a * hz), Math.round(b * hz));
  const idleB = Math.max(...win(1, 4, r.breath).map(Math.abs)), walkB = Math.max(...win(6, 7, r.breath).map(Math.abs));
  const strikeB = Math.max(...win(9, 10, r.breath).map(Math.abs));
  const walkS = Math.max(...win(6, 7, r.sway).map(Math.abs)), strikeS = Math.max(...win(9.5, 10, r.sway).map(Math.abs));
  console.log(`breath |weight×wave| idle ${idleB.toFixed(2)}, walking ${walkB.toFixed(3)}, striking ${strikeB.toFixed(3)}; sway walking ${(walkS * 1000).toFixed(2)} mm, striking ${(strikeS * 1000).toFixed(2)} mm`);
  assert(idleB > 0.8, `idle breath ${idleB}`);
  assert(walkB < 0.1 * idleB, `breath while walking ${walkB}`);
  assert(strikeB < 0.35 * idleB, `breath while striking ${strikeB}`);
  assert(walkS < 0.001 && strikeS < 0.002, `sway while moving ${walkS} / striking ${strikeS} m`);
});

Deno.test("real rigs: standing 10 s with the rival swaying, both heels and balls within 5 mm, pitch ~0 (human, dwarf; fresh and tired)", () => {
  for (const [race, sub] of [["human", "imperial"], ["dwarf", "mountain"]] as const) {
    const body = buildBody(race, sub, "longsword", "female");
    for (const live of ["fresh", "exhausted"]) {
      const c = measureIdle(body, live, "guard-track");
      console.log(`${race}/${sub} female ${live}: heel ${c.heelMaxMm.toFixed(2)} mm, ball ${c.ballMaxMm.toFixed(2)} mm, pitch ${c.pitchMaxDeg.toFixed(3)}°, slide ${c.slideMaxMm.toFixed(2)} mm, breath ${c.breathPeriodS.toFixed(2)} s / ${c.spinePtpDeg.toFixed(2)}°, sway ${c.swayPtpMm.toFixed(1)} mm`);
      assert(c.heelMaxMm < 5 && c.ballMaxMm < 5, `${race} ${live}: heel ${c.heelMaxMm} / ball ${c.ballMaxMm} mm`);
      assert(c.pitchMaxDeg < 0.5 && c.heelUpShare === 0, `${race} ${live}: pitch ${c.pitchMaxDeg}°`);
      assert(c.slideMaxMm < 1 && c.floorMinMm > -1, `${race} ${live}: slide ${c.slideMaxMm} mm, floor ${c.floorMinMm} mm`);
    }
  }
});
