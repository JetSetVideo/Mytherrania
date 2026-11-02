// Lane J-C: the impact answer. A strike must SHOW what it hit —
//   * anticipation: the wind-up cocks with the weapon's heft (a hammer longer than a dagger) and
//     the whole blow still fits the class attack interval;
//   * impact hold: a blow that lands at speed holds its pose longer than a graze, bounded, and the
//     hold never moves the STRIKE (so the attack rate is unchanged);
//   * recoil/settle: a heavy strike settles slower than a whiff — continuous at both ends, monotone
//     in impact;
// plus the three named attacks that now read the impact (Rogue Shadowstep, Barbarian Skullsplitter,
// Mage Arcane Nova), the per-joint clamp share (< 25 %, measured PER JOINT — a past pass missed a
// sign error because it averaged over the whole skill), and a finite / NaN-free sweep.
import {
  anticipationSeconds, COOLDOWN_SHARE, GUARD_KEY, HOLD_MAX, HOLD_MIN, impactHold, impactSettle, newSwingProfile,
  STRIKE_MIN, STRIKE_MAX, styledKeyAt, styledSwingTiming,
} from "../src/game/anim/Swing.ts";
import { fourPhaseImpulse, jointAngle, recoveryCurve, styledTrackOffset } from "../src/game/AnimationCurve.ts";
import { ALL_SKILLS, type Skill } from "../src/game/Skills.ts";
import { motionStyleFor, type StyleCoeffs, weaponMotionFromSpec, type WeaponMotion } from "../src/game/anim/MotionStyle.ts";
import { weaponFromSeed } from "../src/game/weapons/Generate.ts";
import { defaultHumanoid } from "../src/game/Skeleton.ts";
import { JOINT_INDEX, limitTableFrom } from "../src/game/anim/Rig.ts";
import { Animator } from "../src/game/anim/Animator.ts";
import { legacyLegGeometryFor } from "../src/game/anim/LegacyGeometry.ts";
import { CLASSES } from "../src/game/Stats.ts";
import { createFighter } from "../src/game/Fighter.ts";
import type { ArchetypeId } from "../src/combat/contracts.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }
const DEG = 180 / Math.PI;
const FRESH = { hpFrac: 1, staminaFrac: 1, manaFrac: 1, exhausted: false };
const LIM = limitTableFrom(defaultHumanoid().limits());
const CLAMP_EPS = 1e-6;
/** Impact values the swing is swept over (0 = a whiff, 1 = a full-speed heavy blow). */
const IMPACTS = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
/** The four-phase profile a styled skill track uses (AnimationCurve.FourPhaseProfile). */
const PR4 = { anticipation: 0.14, anticipationShare: 0.3, hold: 0.08, overshoot: 0.06, settle: 0.1 };

/** WEAPON kind per archetype (the swing tests' fixtures). */
const KIND: Record<string, "slash" | "chop" | "thrust"> = { dagger: "thrust", longsword: "slash", warhammer: "chop" };

function styleOf(id: ArchetypeId, over: Partial<Parameters<typeof motionStyleFor>[0]> = {}) {
  const s = motionStyleFor({
    race: "human", subrace: null, seed: 5, body: { legLength: 0.85, height: 1.75, weight: 72 },
    weapon: weaponMotionFromSpec(weaponFromSeed(id, 7), KIND[id] ?? "slash"),
    stats: { strength: 7, reflex: 7, vitality: 7, resilience: 7, focus: 7, intelligence: 7 }, ...over,
  });
  s.setLiveImmediate(FRESH);
  return s;
}

/** The five phase scales only (styledSwingTiming's PhaseScales). */
const scales = (e: StyleCoeffs) => ({ windupTime: e.windupTime, strikeTime: e.strikeTime, recoverTime: e.recoverTime, holdTime: e.holdTime, settleTime: e.settleTime });
/** A styled timing with every optional argument at its default except the impact. */
const timingFor = (strike: number, cooldown: number, sc: ReturnType<typeof scales>, impact: number) =>
  styledSwingTiming(strike, cooldown, sc, 0, 0, WINDUP_MIN_ARG, RECOVER_MIN_ARG, true, impact);
const WINDUP_MIN_ARG = 0.08, RECOVER_MIN_ARG = 0.1;
/** The blow (wind-up + strike + hold) of a timing, s. */
const blow = (t: { windup: number; strike: number; hold?: number }) => t.windup + t.strike + (t.hold ?? 0);

Deno.test("anticipation: the wind-up cocks longer with the weapon's heft, and every class interval still fits", () => {
  const dagger = styleOf("dagger"), longsword = styleOf("longsword"), hammer = styleOf("warhammer");
  assert(hammer.eff.windupTime > longsword.eff.windupTime && longsword.eff.windupTime > dagger.eff.windupTime,
    `windupTime dagger ${dagger.eff.windupTime.toFixed(3)} / longsword ${longsword.eff.windupTime.toFixed(3)} / hammer ${hammer.eff.windupTime.toFixed(3)}`);
  // The wind-up duration follows the heft (anticipationSeconds), monotone in the weapon's inertia.
  const windups: number[] = [];
  for (const inertia of [0.005, 0.02, 0.1, 0.3, 1, 3, 10]) {
    const w: WeaponMotion = { mass: 1, length: 1, grip: 0.2, hands: 1, kind: "slash", balance: 0.3, inertia };
    windups.push(anticipationSeconds(0.2, styleOf("dagger", { weapon: w }).eff.windupTime));
  }
  for (let i = 1; i < windups.length; i++) assert(windups[i] >= windups[i - 1] - 1e-12, `wind-up not monotone: ${windups[i - 1]} -> ${windups[i]}`);
  assert(windups[windups.length - 1] > windups[0] + 0.05, `heavier inertia winds up longer: ${windups[0]} -> ${windups[windups.length - 1]}`);
  // My MotionStyle term: the COUNTER-MOVE also deepens with the weapon's heft.
  assert(hammer.eff.anticipation > dagger.eff.anticipation + 0.02,
    `anticipation dagger ${dagger.eff.anticipation.toFixed(3)} vs hammer ${hammer.eff.anticipation.toFixed(3)}`);
  // Every class's attack interval: with the heaviest weapon's scales the blow still fits its budget.
  const intervals = CLASSES.map((c) => createFighter(c, "x", 0, 0, 0.5, "human", null).stats.attackInterval);
  for (const cooldown of intervals) {
    for (const st of [dagger, longsword, hammer]) {
      for (const impact of IMPACTS) {
        const t = timingFor(0.2, cooldown, scales(st.eff), impact);
        assert(t.strike >= STRIKE_MIN - 1e-12 && t.strike <= STRIKE_MAX + 1e-12, `strike ${t.strike} out of range`);
        assert(blow(t) <= COOLDOWN_SHARE * cooldown + 1e-9,
          `blow ${blow(t).toFixed(3)} s over the budget ${(COOLDOWN_SHARE * cooldown).toFixed(3)} (cooldown ${cooldown})`);
      }
    }
  }
  assert(new Set(intervals).size >= 2 && intervals.every((v) => v >= 0.85 && v <= 1.35), `class intervals ${intervals.join(",")}`);
});

Deno.test("impact hold: monotone in impact, bounded, and it NEVER moves the strike (the attack rate is the weapon's)", () => {
  let prev = -Infinity;
  for (const i of IMPACTS) {
    const h = impactHold(0.07, i);
    assert(Number.isFinite(h) && h >= HOLD_MIN - 1e-12 && h <= HOLD_MAX + 1e-12, `hold ${h} out of [${HOLD_MIN}, ${HOLD_MAX}]`);
    assert(h >= prev - 1e-12, `hold not monotone at impact ${i}: ${prev} -> ${h}`);
    prev = h;
  }
  assert(Math.abs(impactHold(0.07, 0) - 0.07) < 1e-12, "impact 0 = the base hold");
  assert(impactHold(0.07, 1) > 0.07 * 1.5, `a solid blow holds ${impactHold(0.07, 1).toFixed(3)} (base 0.07)`);
  assert(Math.abs(impactHold(1e6, 1) - HOLD_MAX) < 1e-12 && Math.abs(impactHold(0.07, Number.NaN) - 0.07) < 1e-12, "bounded / non-finite safe");
  // The hold does not change the attack rate: the STRIKE (the weapon's own speed) is identical for
  // every impact, and the blow stays inside COOLDOWN_SHARE of the cooldown (the squeeze absorbs it).
  const sc = scales(styleOf("longsword").eff);
  const strikes = IMPACTS.map((i) => timingFor(0.2, 1, sc, i).strike);
  for (const s of strikes) assert(Math.abs(s - strikes[0]) < 1e-12, `strike moved with impact: ${strikes.join(",")}`);
  for (const cooldown of [0.5, 0.85, 1.0, 1.35]) {
    for (const i of IMPACTS) {
      const t = timingFor(0.2, cooldown, sc, i);
      assert(blow(t) <= COOLDOWN_SHARE * cooldown + 1e-9, `impact ${i}: blow ${blow(t)} over ${COOLDOWN_SHARE * cooldown}`);
    }
  }
  // With room to spare the hold really is longer for a solid blow than for a whiff.
  const hard = timingFor(0.2, 10, sc, 1), graze = timingFor(0.2, 10, sc, 0);
  assert((hard.hold ?? 0) > (graze.hold ?? 0) + 1e-9, `hold ${graze.hold} -> ${hard.hold}`);
});

Deno.test("recoil: settles slower with impact, continuous at both ends (the curve is C1, only its duration scales)", () => {
  let prev = -Infinity;
  for (const i of IMPACTS) {
    const rec = impactSettle(0.12, i);
    assert(Number.isFinite(rec) && rec >= 0.12 - 1e-12 && Number.isFinite(impactSettle(0.08, i)), "settle finite / floored");
    assert(rec >= prev - 1e-12, `recovery not monotone at impact ${i}`);
    prev = rec;
  }
  assert(impactSettle(0.12, 0) === 0.12 && impactSettle(0.12, 1) > 1.5 * 0.12, "whiff fast, heavy slower");
  assert(impactSettle(0.12, Number.NaN) === 0.12 && impactSettle(Number.NaN, 1) === 0, "non-finite safe");
  // The recovery CURVE is untouched (C1 at both ends): the impact only scales the phase durations.
  for (const A of [0, 0.06, 0.16]) {
    assert(recoveryCurve(0, A) === 0 && recoveryCurve(1, A) === 1, "recovery ends exactly");
    for (const v of [0, 1]) {
      const e = 1e-6, s = (recoveryCurve(Math.min(1, v + e), A) - recoveryCurve(Math.max(0, v - e), A)) / (2 * e);
      assert(Math.abs(s) < 1e-3, `recovery speed ${s} at the turn ${v}`);
    }
  }
  // Sampling the whole styled swing at two impacts: the pose never pops (bounded per-step jump) and
  // it is continuous across the hold -> recovery seam and back to guard.
  for (const impact of [0, 1]) {
    const pr = newSwingProfile();
    Object.assign(pr.guard, GUARD_KEY);
    Object.assign(pr.windup, { shoulder: -2.2, elbow: -1.2, blade: 0.2, roll: 0.2, lean: -0.1, twist: -0.2 });
    Object.assign(pr.contactKey, { shoulder: -1.3, elbow: -0.4, blade: 1.2, roll: 0, lean: 0.05, twist: 0 });
    Object.assign(pr.strike, { shoulder: -0.6, elbow: -0.05, blade: 2.3, roll: -0.3, lean: 0.3, twist: 0.15 });
    pr.contact = 0.5; pr.overshoot = 0.06;
    const t = timingFor(0.2, 10, scales(styleOf("longsword").eff), impact);
    const h1 = t.windup + t.strike + (t.hold ?? 0);
    const a = { ...GUARD_KEY }, b = { ...GUARD_KEY };
    styledKeyAt(t, pr, h1 - 1e-5, a); styledKeyAt(t, pr, h1 + 1e-5, b);
    for (const k of ["shoulder", "elbow", "blade", "lean", "twist", "roll"] as const) {
      assert(Math.abs(a[k] - b[k]) < 1e-3, `pop at the hold -> recovery seam: ${k} ${a[k]} -> ${b[k]}`);
    }
    const end = t.windup + t.strike + (t.hold ?? 0) + t.recover + (t.settle ?? 0);
    const cur = { ...GUARD_KEY };
    styledKeyAt(t, pr, 0, cur);
    let worst = 0;
    for (let c = 1 / 480; c <= end + 1 / 480; c += 1 / 480) {
      styledKeyAt(t, pr, c, a);
      for (const k of ["shoulder", "elbow", "blade", "lean", "twist", "roll"] as const) worst = Math.max(worst, Math.abs(a[k] - cur[k]));
      Object.assign(cur, a);
    }
    assert(worst < 0.25, `impact ${impact}: largest per-frame step ${worst.toFixed(3)} rad`);
    styledKeyAt(t, pr, end, a);
    assert(Math.abs(a.shoulder - GUARD_KEY.shoulder) < 1e-6, "ends at guard");
  }
});

/** Prime joint of each improved attack: the arc it must clear (deg) and the reason it changed. */
const IMPROVED: { id: string; joint: keyof typeof JOINT_INDEX; minDeg: number; why: string }[] = [
  { id: "rogue-shadowstep", joint: "shoulderR", minDeg: 40, why: "a dash cut, not a drift" },
  { id: "barbarian-skullsplitter", joint: "shoulderR", minDeg: 74, why: "a power strike drives through the target" },
  { id: "mage-arcane-nova", joint: "shoulderR", minDeg: 74, why: "a power strike snaps the staff out" },
];

Deno.test("shadowstep / skullsplitter / arcane-nova: each prime joint moves a real arc, peak on the hit frame", () => {
  const geom = legacyLegGeometryFor("human", null, 1.75, 75);
  for (const { id, joint, minDeg, why } of IMPROVED) {
    const skill: Skill = ALL_SKILLS.find((s) => s.id === id)!;
    const tr = skill.animation.tracks.find((t) => t.joint === joint)!;
    const travelDeg = Math.abs(tr.amplitude) * DEG;
    assert(travelDeg >= minDeg, `${id} (${why}): ${joint} travels ${travelDeg.toFixed(1)}° < ${minDeg}°`);
    assert(Math.abs(tr.peak - skill.animation.hitAt) < 1e-9, `${id}: track peak ${tr.peak} != hitAt ${skill.animation.hitAt}`);
    // The envelope is 1 exactly at the hit frame and its maximum there (the peak reads on the hit).
    const p = tr.peak;
    assert(Math.abs(fourPhaseImpulse(p, p, PR4) - 1) < 1e-12, `${id}: envelope 1 at the hit`);
    let maxAt = 0, best = -Infinity;
    for (let i = 0; i <= 2000; i++) { const v = fourPhaseImpulse(i / 2000, p, PR4); if (v > best) { best = v; maxAt = i / 2000; } }
    assert(best <= 1 + 1e-12 && Math.abs(maxAt - p) < 1e-3, `${id}: envelope peak ${best} at ${maxAt}, hit ${p}`);
    // Realized on the Animator (the runtime path): the prime joint clears the arc, its extreme is
    // not before the hit frame, and the limiter does not fight it.
    const an = new Animator(geom, LIM);
    an.setStyle(styleOf("longsword"));
    an.reset(0, 0, 0);
    const hz = 480, n = Math.round(skill.animation.duration * hz), idx = JOINT_INDEX[joint];
    const sgn = Math.sign(tr.amplitude);
    let lo = Infinity, hi = -Infinity, extreme = -Infinity, at = 0;
    const l0 = an.blender.speedLimited;
    for (let k = 0; k <= n; k++) {
      const out = an.update(1 / hz, {
        x: 0, z: 0, yaw: 0, speed: 0, moveDirLocal: 0, turnRate: 0, grounded: true, hit: false, attack: false, block: false, ko: false,
        skill: skill.animation, skillProgress: k / n, groundHeight: () => 0,
      });
      const v = out.angles[idx];
      lo = Math.min(lo, v); hi = Math.max(hi, v);
      if (sgn * v > extreme) { extreme = sgn * v; at = k / n; }
    }
    const limited = an.blender.speedLimited - l0;
    const realized = (hi - lo) * DEG;
    assert(realized >= minDeg, `${id}: realized ${joint} travel ${realized.toFixed(1)}° < ${minDeg}°`);
    assert(at >= skill.animation.hitAt - 0.02, `${id}: extreme at ${at.toFixed(3)} before hitAt ${skill.animation.hitAt}`);
    // The limiter must not fight the strike: none for the power blows, a rounding-level share for
    // the fast dash (its 11 clipped joint-frames are pre-existing, unchanged by this lane).
    const share = limited / ((n + 1) * 16);
    assert(share < 0.005, `${id}: the speed limiter clipped ${limited} joint-frames (${(share * 100).toFixed(2)} %)`);
    console.log(`  ${id}: ${joint} ${Math.abs(tr.amplitude).toFixed(3)} rad = ${travelDeg.toFixed(1)}° (realized ${realized.toFixed(1)}°), envelope peak at ${p}, extreme at progress ${at.toFixed(3)}, limiter ${limited} joint-frames`);
  }
});

Deno.test("clamp share stays under 25 % PER JOINT for every skill (unstyled and four-phase), and no joint is driven twice", () => {
  const N = 200;
  let worst = { id: "-", joint: "-", share: 0 };
  for (const skill of ALL_SKILLS) {
    const seen = new Set<string>();
    for (const tr of skill.animation.tracks) {
      assert(!seen.has(tr.joint), `${skill.id}: joint ${tr.joint} driven by two tracks (the later shadows the first)`);
      seen.add(tr.joint);
      const j = JOINT_INDEX[tr.joint], rest = LIM.rest[j], lo = LIM.min[j], hi = LIM.max[j];
      let hit = 0;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        // Unstyled (impulse) and styled (four-phase) envelopes: the joint must not sit pinned.
        const v0 = jointAngle(tr, t, rest, lo, hi);
        const v1 = Math.max(lo, Math.min(hi, rest + styledTrackOffset(tr, t, PR4)));
        for (const v of [v0, v1]) if (Math.abs(v - lo) < CLAMP_EPS || Math.abs(v - hi) < CLAMP_EPS) hit++;
      }
      const share = hit / (2 * (N + 1));
      if (share > worst.share) worst = { id: skill.id, joint: tr.joint, share };
      assert(share < 0.25, `${skill.id} ${tr.joint}: pinned ${(share * 100).toFixed(1)} % of the animation`);
    }
  }
  console.log(`  worst per-joint clamp share: ${worst.id} ${worst.joint} ${(worst.share * 100).toFixed(1)} %`);
});

Deno.test("the whole set is finite and NaN-free (skills, timings, impact helpers)", () => {
  for (const skill of ALL_SKILLS) {
    const a = skill.animation;
    for (const [k, v] of Object.entries({ duration: a.duration, hitAt: a.hitAt, lunge: a.lunge, hop: a.hop, effectIntensity: a.effectIntensity })) {
      assert(Number.isFinite(v), `${skill.id}: ${k} = ${v}`);
    }
    assert(a.duration > 0 && a.hitAt > 0 && a.hitAt < 1, `${skill.id}: duration / hitAt`);
    for (const tr of a.tracks) {
      assert(Number.isFinite(tr.amplitude) && Number.isFinite(tr.peak) && tr.peak > 0 && tr.peak < 1, `${skill.id} ${tr.joint}: amplitude / peak`);
      for (let i = 0; i <= 50; i++) {
        assert(Number.isFinite(styledTrackOffset(tr, i / 50, PR4)), `${skill.id} ${tr.joint}: non-finite offset`);
      }
    }
  }
  const sc = scales(styleOf("warhammer").eff);
  for (const strike of [Number.NaN, -1, 0, 0.2, 5, Infinity]) {
    for (const cd of [Number.NaN, 0, 0.2, 0.85, 10, Infinity]) {
      const t = timingFor(strike, cd, sc, 0.5);
      for (const v of [t.windup, t.strike, t.recover, t.hold ?? 0, t.settle ?? 0]) assert(Number.isFinite(v), `timing ${v} for strike ${strike} cd ${cd}`);
      assert(t.strike >= STRIKE_MIN - 1e-12 && t.strike <= STRIKE_MAX + 1e-12, `strike ${t.strike} out of range`);
    }
  }
  for (const odd of [Number.NaN, Infinity, -Infinity, -5, 2]) {
    assert(Number.isFinite(impactHold(0.07, odd)) && Number.isFinite(impactSettle(0.12, odd)) && Number.isFinite(anticipationSeconds(0.2, odd)), `impact helper non-finite at ${odd}`);
  }
});
