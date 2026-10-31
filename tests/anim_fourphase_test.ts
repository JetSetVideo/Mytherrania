// Lane M: the four-phase motion — wind-up (counter-move) -> sharp hit (peak speed AT the contact)
// -> hit hold -> heavy recovery (small damped overshoot) -> settle — for weapon swings
// (Swing.ts styled section, SwingDriver) and skill curves (AnimationCurve.fourPhaseImpulse,
// Animator), the kinetic-chain order (legs -> pelvis -> chest -> shoulder -> elbow -> blade),
// contact timing, joint limits and frame-rate independence.
import { fourPhaseImpulse, recoveryCurve, strikeProgress, strikeSpeed } from "../src/game/AnimationCurve.ts";
import { armGeometry, GUARD_KEY, newSwingSample, swingDuration, swingWindow, type SwingSample } from "../src/game/anim/Swing.ts";
import { SwingDriver, swingSetupFor } from "../src/combat/SwingDriver.ts";
import { motionStyleFor, weaponMotionFromSpec } from "../src/game/anim/MotionStyle.ts";
import { weaponFromSeed } from "../src/game/weapons/Generate.ts";
import { defaultHumanoid } from "../src/game/Skeleton.ts";
import { JOINT_COUNT, JOINT_INDEX, limitTableFrom } from "../src/game/anim/Rig.ts";
import { Animator } from "../src/game/anim/Animator.ts";
import { legacyLegGeometryFor } from "../src/game/anim/LegacyGeometry.ts";
import { runScenario } from "../src/game/anim/Scenario.ts";
import { ALL_SKILLS } from "../src/game/Skills.ts";
import type { ArchetypeId } from "../src/combat/contracts.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const ARM = armGeometry([-0.18, 1.36, -0.01], [-0.28, 1.07, -0.01], [-0.27, 0.72, 0.08]);
const LIM = limitTableFrom(defaultHumanoid().limits());
const KIND: Record<string, "slash" | "chop" | "thrust"> = { longsword: "slash", warhammer: "chop", spear: "thrust" };
const FRESH = { hpFrac: 1, staminaFrac: 1, manaFrac: 1, exhausted: false };

function driver(id: ArchetypeId, race = "human", live = FRESH) {
  const spec = weaponFromSeed(id, 7), setup = swingSetupFor(spec, ARM), d = new SwingDriver(setup, LIM);
  const st = motionStyleFor({ race, subrace: null, seed: 3, body: { legLength: 0.85, height: 1.75, weight: 75 }, weapon: weaponMotionFromSpec(spec, KIND[id]), stats: { strength: 8, reflex: 6 } });
  st.setLiveImmediate(live);
  d.setStyle(st);
  return { d, setup, st };
}

/**
 * Sample a styled swing at `hz` from the press to its end: per frame the sample and the leg drive.
 * The default cooldown is generous (the phases get the time the style asks for); the report
 * measures the real, tight engine cooldowns (anim-report recoverOverStrike).
 */
function play(d: SwingDriver, hz: number, cooldown = 3) {
  d.begin(d.setup.sweet + 0.2, cooldown);
  const frames: (SwingSample & { t: number; legs: number })[] = [];
  let t = 0;
  frames.push({ ...d.sample, t, legs: d.legDrive() });
  while (d.active) { d.advance(1 / hz); t += 1 / hz; frames.push({ ...d.sample, t, legs: d.legDrive() }); }
  return frames;
}

Deno.test("strike profile: peak speed exactly at the contact, the contact pose reached at the contact time", () => {
  for (const c of [0.35, 0.5, 0.65, 0.8]) {
    assert(Math.abs(strikeProgress(c, c) - c) < 1e-12 && strikeProgress(0, c) === 0 && Math.abs(strikeProgress(1, c) - 1) < 1e-12, `ends/contact at c=${c}`);
    let best = 0, at = 0;
    for (let i = 1; i < 2000; i++) { const v = strikeSpeed(i / 2000, c); if (v > best) { best = v; at = i / 2000; } }
    assert(Math.abs(at - c) < 1e-3 && Math.abs(best - 2) < 1e-4, `peak ${best} at ${at}, contact ${c}`);
    // Accelerating INTO the hit: speed rises monotonically up to the contact.
    for (let i = 1; i < 100; i++) assert(strikeSpeed(c * i / 100, c) >= strikeSpeed(c * (i - 1) / 100, c), "accelerates into the contact");
  }
});

Deno.test("recovery curve: overshoots by A, damps (−0.3 A), settles exactly; C1 (zero speed at every turn)", () => {
  const A = 0.08;
  let mx = 0, mnAfter = Infinity;
  for (let i = 0; i <= 1000; i++) { const v = recoveryCurve(i / 1000, A); mx = Math.max(mx, v); if (i > 750) mnAfter = Math.min(mnAfter, v); }
  assert(Math.abs(mx - (1 + A)) < 1e-9 && Math.abs(mnAfter - (1 - 0.3 * A)) < 1e-6, `overshoot ${mx}, rebound ${mnAfter}`);
  assert(recoveryCurve(0, A) === 0 && recoveryCurve(1, A) === 1, "ends");
  for (const v of [0, 0.75, 0.9, 1]) {
    const e = 1e-6, s = (recoveryCurve(Math.min(1, v + e), A) - recoveryCurve(Math.max(0, v - e), A)) / (2 * e);
    assert(Math.abs(s) < 1e-3, `speed ${s} at the turn ${v}`);
  }
});

Deno.test("skill envelope: counter-move first (opposite sign), 1 exactly at the hit frame, hold, small damped overshoot, settle at rest", () => {
  const pr = { anticipation: 0.14, anticipationShare: 0.3, hold: 0.08, overshoot: 0.06, settle: 0.1 };
  const p = 0.4;
  let minBefore = 0;
  for (let i = 1; i < 400; i++) { const t = p * i / 400; minBefore = Math.min(minBefore, fourPhaseImpulse(t, p, pr)); }
  assert(Math.abs(minBefore + 0.14) < 1e-3, `counter-move ${minBefore}`);
  assert(Math.abs(fourPhaseImpulse(p, p, pr) - 1) < 1e-9 && Math.abs(fourPhaseImpulse(p + 0.05, p, pr) - 1) < 1e-9, "1 at the hit and through the hold");
  // Just before the hit the envelope is still rising fast (accelerating into it).
  const dv = (fourPhaseImpulse(p - 1e-4, p, pr) - fourPhaseImpulse(p - 2e-4, p, pr)) / 1e-4;
  const dvEarly = (fourPhaseImpulse(0.6 * p, p, pr) - fourPhaseImpulse(0.6 * p - 1e-4, p, pr)) / 1e-4;
  assert(dv > dvEarly && dv > 0, `speed at the hit ${dv} > earlier ${dvEarly}`);
  let under = 0;
  for (let i = 0; i <= 400; i++) under = Math.min(under, fourPhaseImpulse(p + 0.08 + (1 - p - 0.08) * i / 400, p, pr));
  assert(under < -0.03 && under > -0.08, `recovery overshoot below rest ${under}`);
  assert(fourPhaseImpulse(0.95, p, pr) === 0 && fourPhaseImpulse(1, p, pr) === 0, "settled at rest");
});

for (const id of ["longsword", "warhammer", "spear"] as ArchetypeId[]) {
  Deno.test(`${id} (${KIND[id]}): four phases — counter-move, peak speed at the contact, hold, small damped overshoot, settle`, () => {
    const { d } = driver(id);
    const F = play(d, 600);
    const tm = d.phaseTimes(), w1 = tm.windup, s1 = w1 + tm.strike, h1 = s1 + tm.hold, r1 = h1 + tm.recover;
    // Wind-up moves the weapon shoulder OPPOSITE to the strike.
    const at = (t: number) => F[Math.min(F.length - 1, Math.round(t * 600))];
    const windupMove = at(w1).shoulder - at(0).shoulder, strikeMove = at(s1).shoulder - at(w1).shoulder;
    assert(windupMove * strikeMove < 0 && Math.abs(windupMove) > 0.3, `anticipation ${windupMove} vs strike ${strikeMove}`);
    // Peak BLADE speed (the weapon, chain depth 5) inside the strike, at the contact (±10 % of the strike).
    let peak = 0, peakT = 0;
    for (let i = 1; i < F.length; i++) {
      // hand-path thrusts: the hand (shoulder + elbow) drives the point; arcs: the blade angle.
      const v = KIND[id] === "thrust" ? Math.hypot(F[i].shoulder - F[i - 1].shoulder, F[i].elbow - F[i - 1].elbow) : Math.abs(F[i].blade - F[i - 1].blade);
      if (v > peak) { peak = v; peakT = F[i].t; }
    }
    assert(peakT > w1 && peakT < s1, `peak speed at ${peakT.toFixed(3)} outside the strike [${w1.toFixed(3)}, ${s1.toFixed(3)}]`);
    assert(Math.abs(peakT - tm.contactAt) <= 0.1 * tm.strike + 2 / 600, `peak at ${peakT.toFixed(3)}, contact ${tm.contactAt.toFixed(3)}`);
    // The strike window (damage) contains the contact.
    const win = swingWindow(d.player.timing, d.setup.shape.windowLead);
    assert(win.start <= tm.contactAt && win.end >= tm.contactAt, "window spans the contact");
    // Hold: the blade rests (its lead is 0) through the hit hold.
    assert(tm.hold >= 0.03, `hold ${tm.hold}`);
    for (let t = s1 + 0.002; t < h1 - 0.002; t += 0.002) assert(Math.abs(at(t).blade - at(s1 + 0.001).blade) < 1e-6, "blade holds");
    // Recovery: passes guard by a SMALL amount (≤ 16 % of the travel), then settles exactly on guard.
    const travel = at(h1).shoulder - GUARD_KEY.shoulder;
    let past = 0;
    for (let t = h1; t <= r1; t += 0.002) past = Math.max(past, -(at(t).shoulder - GUARD_KEY.shoulder) * Math.sign(travel));
    if (Math.abs(travel) > 0.05) assert(past > 0 && past <= 0.16 * Math.abs(travel) + 1e-9, `overshoot ${past} of travel ${travel}`);
    assert(Math.abs(at(r1 + 0.001).shoulder - GUARD_KEY.shoulder) < 0.02 && tm.settle >= 0.03, "settled at guard");
    assert(Math.abs(F[F.length - 1].shoulder - GUARD_KEY.shoulder) < 1e-6 && F[F.length - 1].weight < 0.05, "ends at guard, weight out");
  });
}

Deno.test("kinetic chain: legs, then pelvis twist, chest, shoulder, elbow, blade (peak-speed times in the strike)", () => {
  for (const id of ["longsword", "warhammer"] as ArchetypeId[]) {
    const { d } = driver(id);
    const F = play(d, 1000), tm = d.phaseTimes();
    const peakTime = (k: "twist" | "lean" | "shoulder" | "elbow" | "blade" | "legs") => {
      let best = 0, at = 0;
      for (let i = 1; i < F.length; i++) {
        // The strike (each DOF's own, led by up to 5 chain levels), not the wind-up.
        if (F[i].t < tm.windup - 5 * 0.03 || F[i].t > tm.windup + tm.strike + 0.02) continue;
        const v = Math.abs(F[i][k] - F[i - 1][k]);
        if (v > best) { best = v; at = F[i].t; }
      }
      return at;
    };
    const legsPeak = F.reduce((b, f) => (f.legs > b.v ? { v: f.legs, t: f.t } : b), { v: -1, t: 0 }).t;
    const T = { twist: peakTime("twist"), lean: peakTime("lean"), shoulder: peakTime("shoulder"), elbow: peakTime("elbow"), blade: peakTime("blade") };
    console.log(`${id}: legs max ${legsPeak.toFixed(3)} twist ${T.twist.toFixed(3)} lean ${T.lean.toFixed(3)} shoulder ${T.shoulder.toFixed(3)} elbow ${T.elbow.toFixed(3)} blade ${T.blade.toFixed(3)} contact ${tm.contactAt.toFixed(3)}`);
    assert(legsPeak < T.twist && T.twist < T.lean && T.lean < T.shoulder && T.shoulder < T.elbow && T.elbow <= T.blade + 1e-9, `${id}: chain order broken`);
    assert(legsPeak < tm.contactAt, "the legs are fully driven before the contact");
  }
});

Deno.test("styled swings: heavier weapon winds up longer; exhausted recovers slower than fresh; ork winds up deeper than elf", () => {
  const free = 3; // a generous cooldown: the timings are the style's own
  const t = (id: ArchetypeId, race = "human", live = FRESH) => { const { d } = driver(id, race, live); d.begin(d.setup.sweet, free); return { tm: d.phaseTimes(), pr: d.player.profile! }; };
  assert(t("warhammer").tm.windup > t("longsword").tm.windup, "warhammer wind-up longer than the longsword's");
  const tired = t("longsword", "human", { hpFrac: 1, staminaFrac: 0.02, manaFrac: 1, exhausted: true });
  assert(tired.tm.recover > 1.2 * t("longsword").tm.recover && tired.tm.settle > t("longsword").tm.settle, "exhausted: slower recovery and settle");
  const depth = (race: string) => { const p = t("longsword", race).pr; return Math.abs(p.windup.shoulder - p.contactKey.shoulder) + Math.abs(p.windup.lean - p.contactKey.lean); };
  assert(depth("ork") > depth("elf") + 0.05, `ork wind-up ${depth("ork")} vs elf ${depth("elf")}`);
  // Under the real (tight) cooldown a FRESH swing's BLOW (wind-up + strike + hold) still fits
  // COOLDOWN_SHARE of it; the recovery is an interruptible tail and may run past.
  const { d } = driver("longsword");
  d.begin(d.setup.sweet, 0.75);
  const tm = d.player.timing;
  assert(tm.windup + tm.strike + (tm.hold ?? 0) <= 0.9 * 0.75 + 1e-9, "fresh blow fits the cooldown");
  assert(swingDuration(tm) > tm.windup + tm.strike + (tm.hold ?? 0), "recovery + settle follow");
});

Deno.test("chained press: a press in the recovery starts from the current pose (no snap), outside it is refused", () => {
  const { d } = driver("warhammer");
  d.begin(d.setup.sweet, 0.9);
  const tm = d.player.timing, blow = tm.windup + tm.strike + (tm.hold ?? 0);
  // Not chainable during the blow.
  let t = 0;
  while (t < blow - 0.05) { d.advance(1 / 60); t += 1 / 60; }
  assert(!d.recovering(), "still in the blow");
  // Into the recovery (40 % through), then press again.
  while (t < blow + 0.4 * tm.recover) { d.advance(1 / 60); t += 1 / 60; }
  assert(d.recovering(), "recovering");
  const before = { ...d.sample }, legBefore = d.legDrive();
  d.begin(d.setup.sweet, 0.9);
  for (const k of ["shoulder", "elbow", "blade", "lean", "twist"] as const) {
    assert(Math.abs(d.sample[k] - before[k]) < 1e-6, `${k} continues from the recovery pose (${before[k]} -> ${d.sample[k]})`);
  }
  assert(Math.abs(d.sample.weight - before.weight) < 1e-6, "blend weight continues");
  assert(Math.abs(d.legDrive() - legBefore) < 1e-6, "leg drive continues");
  // And the chained swing then moves smoothly (no frame jumps over 0.2 rad).
  let prev = { ...d.sample }, worst = 0;
  for (let i = 0; i < 90; i++) {
    d.advance(1 / 60);
    for (const k of ["shoulder", "elbow", "blade", "lean"] as const) worst = Math.max(worst, Math.abs(d.sample[k] - prev[k]));
    prev = { ...d.sample };
  }
  assert(worst < 0.2, `largest per-frame step of the chained swing ${worst.toFixed(3)} rad`);
});

Deno.test("styled swing poses stay inside the joint limits; no style = today's swing exactly", () => {
  const pose = new Float64Array(JOINT_COUNT);
  for (const id of ["longsword", "warhammer", "spear"] as ArchetypeId[]) {
    for (const race of ["human", "elf", "dwarf", "ork"]) {
      const { d } = driver(id, race);
      d.begin(d.setup.sweet, 1);
      while (d.active) {
        d.advance(1 / 120);
        const p = d.attackPose();
        if (p) { pose.set(p); for (let j = 0; j < JOINT_COUNT; j++) assert(pose[j] >= LIM.min[j] - 1e-9 && pose[j] <= LIM.max[j] + 1e-9, `${id}/${race} joint ${j}`); }
      }
    }
  }
  const spec = weaponFromSeed("longsword", 7), a = new SwingDriver(swingSetupFor(spec, ARM), LIM), b = new SwingDriver(swingSetupFor(spec, ARM), LIM);
  b.setStyle(null);
  a.begin(1.5, 1); b.begin(1.5, 1);
  for (let i = 0; i < 60; i++) { a.advance(1 / 60); b.advance(1 / 60); assert(a.sample.shoulder === b.sample.shoulder && a.legDrive() === 0, "unstyled = today's swing, no leg drive"); }
  const s = newSwingSample();
  assert(s.weight === 0, "fresh sample");
});

Deno.test("styled swing through the Animator: frame-rate independent (30 / 60 / 144 Hz), no limit violations, feet planted", () => {
  const geom = legacyLegGeometryFor("human", null, 1.75, 75);
  const finals: Float64Array[] = [];
  for (const hz of [30, 60, 144]) {
    const { d, st } = driver("longsword");
    const an = new Animator(geom, LIM);
    an.setStyle(st);
    const r = runScenario(an, [{ duration: 0.5, speed: 0, engaged: true }, { duration: 1.5, speed: 0, engaged: true, swing: { driver: d, distance: d.setup.sweet + 0.2, cooldown: 1 } }], { hz, accel: 54 });
    assert(r.limitViolations === 0, `${hz} Hz: limit violations`);
    for (const s of r.drift) assert(s < 0.005, `${hz} Hz: planted foot slid ${(1000 * s).toFixed(1)} mm`);
    assert(r.soleMin > -0.001, `${hz} Hz: sole ${(1000 * r.soleMin).toFixed(1)} mm under the floor`);
    finals.push(r.finalAngles);
  }
  for (let j = 0; j < JOINT_COUNT; j++) {
    assert(Math.abs(finals[0][j] - finals[1][j]) < 0.02 && Math.abs(finals[1][j] - finals[2][j]) < 0.02, `joint ${j}: ${finals[0][j]} / ${finals[1][j]} / ${finals[2][j]}`);
  }
});

Deno.test("styled skill curves: the weapon shoulder still peaks on hitAt; legs lead the arm; the limiter never clips them", () => {
  const geom = legacyLegGeometryFor("human", null, 1.75, 75);
  for (const skill of ALL_SKILLS.filter((s) => s.kind === "power").slice(0, 4)) {
    const an = new Animator(geom, LIM), st = motionStyleFor({ race: "ork", seed: 9 });
    st.setLiveImmediate(FRESH);
    an.setStyle(st);
    const anim = skill.animation, hz = 240, n = Math.round(anim.duration * hz);
    const sh: number[] = [];
    const limited0 = an.blender.speedLimited;
    an.reset(0, 0, 0);
    for (let k = 0; k <= n + 20; k++) {
      const out = an.update(1 / hz, {
        x: 0, z: 0, yaw: 0, speed: 0, moveDirLocal: 0, turnRate: 0, grounded: true, hit: false, attack: false, block: false, ko: false,
        skill: k <= n ? anim : null, skillProgress: Math.min(1, k / n), groundHeight: () => 0,
      });
      sh.push(out.angles[JOINT_INDEX.shoulderR]);
    }
    const tr = anim.tracks.find((x) => x.joint === "shoulderR")!;
    // The hit frame shows the strike: the weapon shoulder at hitAt is within 6 % of the swing's
    // travel of its extreme (the envelope is 1 from hitAt through the hold; the wobble rides on it),
    // and the extreme is not reached BEFORE the hit (no early peak).
    const sgn = Math.sign(tr.amplitude);
    let best = -Infinity, at = 0, lo = Infinity, hi = -Infinity;
    for (let k = 0; k <= n; k++) { const v = sgn * sh[k]; if (v > best) { best = v; at = k / n; } lo = Math.min(lo, sh[k]); hi = Math.max(hi, sh[k]); }
    const atHit = sgn * sh[Math.round(anim.hitAt * n)];
    assert(best - atHit <= 0.06 * (hi - lo), `${skill.id}: shoulder at hitAt ${atHit.toFixed(3)} vs extreme ${best.toFixed(3)} (travel ${(hi - lo).toFixed(3)})`);
    assert(at >= anim.hitAt - 0.02, `${skill.id}: extreme at ${at.toFixed(3)} before hitAt ${anim.hitAt}`);
    assert(an.blender.speedLimited - limited0 === 0, `${skill.id}: limiter clipped ${an.blender.speedLimited - limited0} joint-frames`);
  }
});
