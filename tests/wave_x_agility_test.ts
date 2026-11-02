// Wave X lane L: AGILITY bound to animations, swing timing, movement, dodge, dashes, techniques and
// casts; the foot turn-out; the Focus semantics; and the class-balance band after the binding.
// SPEC X10..X19 (lane L's range X10-X29; X20+ live in tests/wave_x_influence_test.ts).
import {
  AGILITY_GAIN, AGILITY_NEUTRAL, agilityFactors, agilityOf, dashMul, dodgeDivisor, effectiveAgility, MASS_REF, moveSpeedMul,
  sheetAgility, SHEET_OFFSET, turnRateMul,
} from "../src/game/Agility.ts";
import { attackDamage, CLASSES, createStats, type CombatStats } from "../src/game/Stats.ts";
import { startingStats } from "../src/game/Leveling.ts";
import { motionStyleFor, weaponMotionFromSpec } from "../src/game/anim/MotionStyle.ts";
import { armGeometry } from "../src/game/anim/Swing.ts";
import { SwingDriver, swingSetupFor } from "../src/combat/SwingDriver.ts";
import { weaponFromSeed } from "../src/game/weapons/Generate.ts";
import { defaultHumanoid } from "../src/game/Skeleton.ts";
import { legFK3, limitTableFrom, newLegFK3, type Side } from "../src/game/anim/Rig.ts";
import { Animator } from "../src/game/anim/Animator.ts";
import { legacyLegGeometryFor } from "../src/game/anim/LegacyGeometry.ts";
import { runScenario, type ScenarioSegment } from "../src/game/anim/Scenario.ts";
import { measuredToeOut, TOE_OUT_DEG } from "../src/game/anim/FootTurnout.ts";
import { pushbackSeconds } from "../src/game/Cast.ts";
import { AGILITY_POWERS, ALL_POWERS, powerTailSeconds } from "../src/game/Skills.ts";
import { runArena } from "../src/balance/ArenaHarness.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }
const DEG = 180 / Math.PI;
const KEYS = Object.keys(AGILITY_GAIN) as (keyof ReturnType<typeof agilityFactors>)[];

// ─── X10: the factor law ────────────────────────────────────────────────────────────────────────

Deno.test("SPEC X10: agilityFactors is 1.0 at agility 10, monotone, clamped (animSpeed in [0.85, 1.2])", () => {
  const n = agilityFactors(AGILITY_NEUTRAL);
  for (const k of KEYS) assert(n[k] === 1, `${k} at 10 = ${n[k]}`);
  let prev = agilityFactors(-50);
  for (let a = -50; a <= 80; a += 0.5) {
    const f = agilityFactors(a);
    for (const k of KEYS) {
      assert(f[k] >= prev[k] - 1e-12, `${k} not monotone at ${a}`);
      assert(f[k] >= AGILITY_GAIN[k].lo - 1e-12 && f[k] <= AGILITY_GAIN[k].hi + 1e-12, `${k} out of band at ${a}`);
    }
    prev = f;
  }
  assert(agilityFactors(-1e9).animSpeed === 0.85 && agilityFactors(1e9).animSpeed === 1.2, "animSpeed clamp [0.85, 1.2]");
  const nan = agilityFactors(Number.NaN);
  for (const k of KEYS) assert(nan[k] === 1, `NaN agility is neutral (${k})`);
  assert(agilityFactors(15).animSpeed > 1 && agilityFactors(5).animSpeed < 1, "strictly moves around the neutral point");
});

Deno.test("PRINT: agilityFactors at sheet agility 5 / 10 / 15 / 20", () => {
  console.log(`  agility | ${KEYS.map((k) => k.padStart(9)).join(" ")}`);
  for (const a of [5, 10, 15, 20]) {
    const f = agilityFactors(a);
    console.log(`  ${String(a).padStart(7)} | ${KEYS.map((k) => f[k].toFixed(3).padStart(9)).join(" ")}`);
  }
});

// ─── X11: the scale ─────────────────────────────────────────────────────────────────────────────

Deno.test("SPEC X11: runtime CombatStats.agility + SHEET_OFFSET lands on the Leveling sheet (|diff| <= 1 per class)", () => {
  for (const c of CLASSES) {
    const runtime = createStats(c).agility;
    const sheet = startingStats(c, "none", null).allocated.agility; // unknown race: no race mod
    const d = sheetAgility(runtime) - sheet;
    console.log(`  ${c.padEnd(12)} runtime ${runtime}  sheet ${sheet}  runtime+${SHEET_OFFSET} ${sheetAgility(runtime)}  diff ${d}`);
    assert(Math.abs(d) <= 1, `${c}: sheet ${sheet} vs runtime ${runtime} + ${SHEET_OFFSET}`);
  }
  // A missing agility is neutral; the mass drag is zero at the reference body.
  assert(effectiveAgility({}) === AGILITY_NEUTRAL, "empty block = neutral");
  assert(sheetAgility(undefined) === AGILITY_NEUTRAL, "missing runtime agility = neutral");
  assert(MASS_REF > 60 && MASS_REF < 80, "reference body mass");
});

// ─── X12: animation and the real swing ─────────────────────────────────────────────────────────

const ARM = armGeometry([-0.18, 1.36, -0.01], [-0.28, 1.07, -0.01], [-0.27, 0.72, 0.08]);
const LIM = limitTableFrom(defaultHumanoid().limits());
const FRESH = { hpFrac: 1, staminaFrac: 1, manaFrac: 1, exhausted: false };
const MID = { vitality: 5, resilience: 5, focus: 5, reflex: 5, strength: 5, intelligence: 5 };

function styled(stats: Partial<CombatStats>) {
  const spec = weaponFromSeed("longsword", 7), setup = swingSetupFor(spec, ARM), d = new SwingDriver(setup, LIM);
  const st = motionStyleFor({ race: "human", subrace: null, seed: 3, body: { legLength: 0.85, height: 1.75, weight: 75 }, weapon: weaponMotionFromSpec(spec, "slash"), stats });
  st.setLiveImmediate(FRESH);
  d.setStyle(st);
  d.begin(d.setup.sweet + 0.2, 3);
  return { t: d.phaseTimes(), st };
}

Deno.test("SPEC X12: agility speeds the wind-up and recovery and trims overshoot — through the REAL SwingDriver; reflex keeps the strike", () => {
  const slow = styled({ ...MID, agility: 0 }), mid = styled({ ...MID, agility: 4 }), fast = styled({ ...MID, agility: 12 });
  for (const [k, a, b] of [["windup", slow.t.windup, fast.t.windup], ["recover", slow.t.recover, fast.t.recover]] as const) {
    assert(b < a, `${k}: agile ${b.toFixed(3)} s not shorter than slow ${a.toFixed(3)} s`);
  }
  assert(mid.t.windup < slow.t.windup && fast.t.windup < mid.t.windup, "wind-up monotone in agility");
  assert(fast.st.base.overshoot < slow.st.base.overshoot, "agility trims overshoot");
  // Agility is BODY speed, not reaction: the strike phase and the chain lag do not move with it.
  assert(Math.abs(fast.st.base.strikeTime - slow.st.base.strikeTime) < 1e-12, "strikeTime is reflex's");
  assert(Math.abs(fast.st.base.chainLag - slow.st.base.chainLag) < 1e-12, "chainLag is reflex's");
  const quick = styled({ ...MID, reflex: 12, agility: 4 });
  assert(quick.st.base.strikeTime < mid.st.base.strikeTime, "reflex shortens the strike");
  console.log(`  swing windup / recover, s: agility 0 ${slow.t.windup.toFixed(3)} / ${slow.t.recover.toFixed(3)}  agility 4 ${mid.t.windup.toFixed(3)} / ${mid.t.recover.toFixed(3)}  agility 12 ${fast.t.windup.toFixed(3)} / ${fast.t.recover.toFixed(3)}`);
});

// ─── X13: movement, dodge, dashes, casts, techniques ───────────────────────────────────────────

Deno.test("SPEC X13: agility reaches move speed, turn rate, dash distance, the graze, a cast's pushback and every agility power", () => {
  const base = createStats("Warrior");
  const nimble = { ...base, agility: base.agility + 8 };
  assert(moveSpeedMul(nimble) > moveSpeedMul(base), "move speed");
  assert(turnRateMul(nimble) > turnRateMul(base), "turn rate");
  assert(dashMul(nimble) > dashMul(base), "dash distance");
  assert(dodgeDivisor(nimble) > dodgeDivisor(base), "dodge divisor");
  const ref = createStats("Barbarian");
  assert(attackDamage(ref, nimble, 0.99, 0.5) < attackDamage(ref, base, 0.99, 0.5), "the graze lowers damage taken");
  const push = (s: CombatStats) => pushbackSeconds({ damageFracOfMax: 0.2, angleDeg: 90, stamina: 6, heavy: false, agility: effectiveAgility(s) });
  assert(push(nimble) < push(base), "an agile caster's channel is shoved less");
  assert(pushbackSeconds({ damageFracOfMax: 0.2, angleDeg: 90, stamina: 6, heavy: false }) === pushbackSeconds({ damageFracOfMax: 0.2, angleDeg: 90, stamina: 6, heavy: false, agility: AGILITY_NEUTRAL }), "absent agility = neutral");
  assert(powerTailSeconds(nimble) < powerTailSeconds(base), "a power's recovery tail");
  // The mobility / evasion powers declare agility, and they exist.
  for (const id of AGILITY_POWERS) {
    const p = ALL_POWERS.find((x) => x.id === id);
    assert(p && p.scale.attribute === "agility", `${id} scales on agility`);
  }
  // The heavy body drags agility down (the strength vs agility side edge).
  assert(effectiveAgility({ ...base, strength: base.strength + 6 }) < effectiveAgility(base), "mass drag");
  console.log(`  Warrior: eff agility ${effectiveAgility(base).toFixed(2)} -> ${effectiveAgility(nimble).toFixed(2)}; move ${moveSpeedMul(base).toFixed(3)} -> ${moveSpeedMul(nimble).toFixed(3)}; dodge ÷ ${dodgeDivisor(base).toFixed(3)} -> ${dodgeDivisor(nimble).toFixed(3)}`);
  for (const c of CLASSES) {
    const s = createStats(c), f = agilityOf(s);
    console.log(`  ${c.padEnd(12)} agi ${s.agility}  eff ${effectiveAgility(s).toFixed(2)}  anim ${f.animSpeed.toFixed(3)} move ${f.moveSpeed.toFixed(3)} dodge ${f.dodge.toFixed(3)} rec ${f.recovery.toFixed(3)} turn ${f.turnRate.toFixed(3)} dash ${f.dash.toFixed(3)}`);
  }
});

// ─── X14: class balance band after the binding ─────────────────────────────────────────────────

Deno.test("SPEC X14: after the agility binding every class's arena share (human, 3 seeds x 600 fights/pair) stays in [0.45, 0.55]", () => {
  const share: Record<string, { w: number; n: number }> = {};
  for (const c of CLASSES) share[c] = { w: 0, n: 0 };
  for (const seed of [20261009, 777, 31337]) {
    for (const pr of runArena(seed, 600, "human").pairResults) {
      share[pr.a].w += pr.p; share[pr.a].n++;
      share[pr.b].w += 1 - pr.p; share[pr.b].n++;
    }
  }
  for (const c of CLASSES) {
    const s = share[c].w / share[c].n;
    console.log(`  ${c.padEnd(12)} ${(s * 100).toFixed(1)}%`);
    assert(s >= 0.45 && s <= 0.55, `${c} at ${(s * 100).toFixed(1)}%`);
  }
});

// ─── X15: feet turned out ──────────────────────────────────────────────────────────────────────

const GEOM = legacyLegGeometryFor("human", null, 1.75, 75);

function stand(segs: ScenarioSegment[], toeOut: boolean) {
  const an = new Animator(GEOM, LIM), st = motionStyleFor({ race: "human", seed: 3 });
  st.setLiveImmediate(FRESH);
  an.setStyle(st);
  if (!toeOut) an.output.toeOut.fill(0);
  const fk = newLegFK3();
  const angle: number[][] = [[], []];
  const res = runScenario(an, segs, {
    hz: 60, accel: 54, holdFacing: true,
    onFrame: (t, out) => {
      if (t < 1) return;
      for (let i = 0 as Side; i < 2; i = (i + 1) as Side) {
        legFK3(GEOM, out.angles, i, out.hipRoll[i], out.ankleRoll[i], fk, out.toeOut[i]);
        angle[i].push(measuredToeOut(GEOM.hipLateral[i], fk.heel, fk.toe) * DEG);
      }
    },
  });
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  return { L: mean(angle[0]), R: mean(angle[1]), slide: Math.max(0, ...res.drift), soleMin: res.soleMin };
}

const IDLE: ScenarioSegment[] = [{ duration: 4, speed: 0 }];
const GUARD: ScenarioSegment[] = [{ duration: 4, speed: 0, engaged: true }];
const WALK: ScenarioSegment[] = [{ duration: 0.4, speed: 0 }, { duration: 3, speed: 2.1 }];

Deno.test("SPEC X15: idle and guard feet turn OUT 8-12 deg each, mirrored; before (toe-out 0) they pointed straight; no extra slide", () => {
  for (const [name, segs] of [["idle", IDLE], ["guard", GUARD], ["walk", WALK]] as const) {
    const after = stand(segs as ScenarioSegment[], true), before = stand(segs as ScenarioSegment[], false);
    console.log(`  ${name.padEnd(5)} toe-out L/R before ${before.L.toFixed(2)}/${before.R.toFixed(2)} deg -> after ${after.L.toFixed(2)}/${after.R.toFixed(2)} deg; slide ${(before.slide * 1000).toFixed(1)} -> ${(after.slide * 1000).toFixed(1)} mm; soleMin ${(after.soleMin * 1000).toFixed(1)} mm`);
    assert(Math.abs(before.L) < 0.5 && Math.abs(before.R) < 0.5, `${name}: the pre-wave-X foot pointed straight`);
    if (name !== "walk") {
      for (const v of [after.L, after.R]) assert(v >= 8 && v <= 12, `${name}: toe-out ${v.toFixed(2)} deg outside 8-12`);
    } else {
      for (const v of [after.L, after.R]) assert(v > 4, `${name}: the walking foot keeps a turn-out (${v.toFixed(2)})`);
    }
    // Mirrored: the yaw is about each foot's own (level) up axis, so the stance's stagger does not leak in.
    assert(Math.abs(after.L - after.R) < 0.5, `${name}: mirrored (L ${after.L.toFixed(2)} vs R ${after.R.toFixed(2)})`);
    assert(after.slide <= before.slide + 0.002, `${name}: the turn-out adds slide (${after.slide} vs ${before.slide})`);
  }
  assert(TOE_OUT_DEG >= 8 && TOE_OUT_DEG <= 12, "the default turn-out sits in the brief's band");
  // An undriven skeleton (preview, pinned pose) stands turned out too.
  const sk = defaultHumanoid();
  assert(Math.abs(sk.legRoll.toeOut[0] * DEG - TOE_OUT_DEG) < 1e-9 && sk.legRoll.toeOut[0] === sk.legRoll.toeOut[1], "Skeleton rest toe-out");
});

// ─── X16: Focus (formerly the other word) everywhere ───────────────────────────────────────────

Deno.test("SPEC X16: no source, test or tool still says the old attribute name (migration comments excepted)", async () => {
  const banned = new RegExp(["will", "power"].join(""), "i");
  const hits: string[] = [];
  async function walk(dir: string) {
    for await (const e of Deno.readDir(dir)) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory) await walk(p);
      else if (/\.(ts|js|html|css)$/.test(e.name)) {
        const lines = (await Deno.readTextFile(p)).split("\n");
        // Exempt: migration notes, and probes that CHECK for its absence (a regex `.test(` / "no … left").
        lines.forEach((l, i) => { if (banned.test(l) && !/migrat|renamed|formerly|legacy|\.test\(|\bno\b.*\bleft\b/i.test(l)) hits.push(`${p}:${i + 1}`); });
      }
    }
  }
  for (const d of ["src", "tests", "tools"]) await walk(d);
  assert(hits.length === 0, `old attribute name still present:\n${hits.join("\n")}`);
});
