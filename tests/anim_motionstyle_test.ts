// Lane M: MotionStyle — clamping, continuity, race / subrace / weapon / stat / live ordering, and
// how DIFFERENT two styles are (measured, not claimed).
import {
  COEFF_KEYS, type LiveState, motionStyleFor, type MotionStyleInput, NEUTRAL, SAFE, styleDistance, styleVector, weaponMotionFromLegacy,
  weaponMotionFromSpec,
} from "../src/game/anim/MotionStyle.ts";
import { weaponFromSeed } from "../src/game/weapons/Generate.ts";
import { weaponForClass } from "../src/game/Weapon.ts";
import { RACES } from "../src/game/Races.ts";
import { createFighter } from "../src/game/Fighter.ts";
import { rng32 } from "../src/core/MathCore.ts";
import type { ArchetypeId } from "../src/combat/contracts.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const FRESH: LiveState = { hpFrac: 1, staminaFrac: 1, manaFrac: 1, exhausted: false };
const TIRED: LiveState = { hpFrac: 1, staminaFrac: 0.02, manaFrac: 1, exhausted: true };
const HURT: LiveState = { hpFrac: 0.1, staminaFrac: 1, manaFrac: 1, exhausted: false };
const sword = (id: ArchetypeId = "longsword") => weaponMotionFromSpec(weaponFromSeed(id, 7), id === "warhammer" || id === "maul" ? "chop" : id === "spear" ? "thrust" : "slash");
const base = (over: Partial<MotionStyleInput> = {}): MotionStyleInput => ({
  race: "human", subrace: null, seed: 1, body: { legLength: 0.85, height: 1.75, weight: 72 }, weapon: sword(),
  stats: { strength: 7, reflex: 7, vitality: 7, resilience: 7, focus: 7, intelligence: 7 }, ...over,
});
function inSafe(name: string, s: ReturnType<typeof motionStyleFor>): void {
  for (const k of COEFF_KEYS) {
    const v = s.eff[k], [lo, hi] = SAFE[k];
    assert(Number.isFinite(v) && v >= lo - 1e-12 && v <= hi + 1e-12, `${name}: ${k} = ${v} outside [${lo}, ${hi}]`);
  }
  for (const a of [s.jointAmp, s.jointJitter, s.swingAmp]) for (const v of a) assert(Number.isFinite(v), `${name}: non-finite jitter`);
}

Deno.test("style: random and extreme inputs give a finite style inside the safe ranges", () => {
  const r = rng32(42);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const wild = [Number.NaN, Infinity, -Infinity, -1e9, 1e9, 0, -5];
  for (let i = 0; i < 400; i++) {
    const w = (v: number) => (r() < 0.2 ? pick(wild) : v);
    const s = motionStyleFor({
      race: pick(["human", "elf", "dwarf", "ork", "goblin", ""]), subrace: pick(["imperial", "wood", "forge", "bloodfang", null, "??"]),
      seed: w(Math.floor(r() * 1e9)),
      body: { legLength: w(0.4 + r()), height: w(1 + r()), weight: w(30 + 150 * r()) },
      weapon: { mass: w(0.1 + 6 * r()), length: w(0.2 + 2.5 * r()), grip: w(r()), hands: w(1 + r()), kind: pick(["slash", "chop", "thrust"] as const), balance: w(r()), inertia: w(2 * r()) },
      stats: { strength: w(20 * r()), reflex: w(20 * r()), vitality: w(20 * r()), resilience: w(20 * r()), focus: w(20 * r()), intelligence: w(20 * r()) },
    });
    inSafe(`random ${i}`, s);
    s.setLiveImmediate({ hpFrac: w(r()), staminaFrac: w(r()), manaFrac: w(r()), exhausted: r() < 0.5, damagePercent: w(400 * r()) });
    inSafe(`random live ${i}`, s);
    for (let k = 0; k < 30; k++) s.step(w(1 / 60));
    inSafe(`random stepped ${i}`, s);
  }
});

Deno.test("style: live sweeps are continuous (no coefficient jumps), and a sudden hp drop is smoothed per frame", () => {
  const s = motionStyleFor(base());
  for (const field of ["hpFrac", "staminaFrac", "manaFrac", "damagePercent"] as const) {
    const prev = new Map<string, number>();
    const N = 2000;
    for (let i = 0; i <= N; i++) {
      const x = i / N;
      s.setLiveImmediate({ ...FRESH, [field]: field === "damagePercent" ? 300 * x : 1 - x });
      for (const k of COEFF_KEYS) {
        const [lo, hi] = SAFE[k], v = s.eff[k];
        if (prev.has(k)) assert(Math.abs(v - prev.get(k)!) <= 0.01 * (hi - lo), `${field} sweep: ${k} jumps ${Math.abs(v - prev.get(k)!)} at ${x}`);
        prev.set(k, v);
      }
    }
  }
  // A blow takes 70 % of the health in one frame: the style eases into it (≤ 6 % of a range per 60 Hz frame).
  s.setLiveImmediate(FRESH);
  const before = { ...s.eff };
  s.setLive({ ...FRESH, hpFrac: 0.3 });
  s.step(1 / 60);
  for (const k of COEFF_KEYS) { const [lo, hi] = SAFE[k]; assert(Math.abs(s.eff[k] - before[k]) <= 0.06 * (hi - lo), `hit: ${k} jumped`); }
  for (let i = 0; i < 120; i++) s.step(1 / 60);
  assert(s.eff.hunch > before.hunch + 0.05, "after 2 s the injured fighter is hunched");
  // The exhausted FLAG is smoothed too.
  s.setLiveImmediate({ ...FRESH, staminaFrac: 0.2 });
  const r0 = s.eff.recoverTime;
  s.setLive({ ...FRESH, staminaFrac: 0.2, exhausted: true });
  s.step(1 / 60);
  assert(Math.abs(s.eff.recoverTime - r0) < 0.02, `exhaustion flag pops recovery by ${s.eff.recoverTime - r0}`);
});

Deno.test("style: live smoothing is frame-rate independent (30 / 60 / 144 Hz agree after 1 s)", () => {
  const out: number[] = [];
  for (const hz of [30, 60, 144]) {
    const s = motionStyleFor(base());
    s.setLive(TIRED);
    for (let i = 0; i < hz; i++) s.step(1 / hz);
    out.push(s.eff.recoverTime);
  }
  assert(Math.abs(out[0] - out[1]) < 1e-9 && Math.abs(out[1] - out[2]) < 1e-9, `recoverTime ${out.join(" / ")}`);
});

Deno.test("style: race temperaments order as designed (ork deeper wind-up than elf, dwarf low and short, elf quick and long)", () => {
  const st = (race: string) => { const s = motionStyleFor(base({ race })); s.setLiveImmediate(FRESH); return s.eff; };
  const human = st("human"), elf = st("elf"), dwarf = st("dwarf"), ork = st("ork");
  assert(ork.windupDepth > human.windupDepth && human.windupDepth > elf.windupDepth, "wind-up depth: ork > human > elf");
  assert(ork.overshoot > human.overshoot && elf.overshoot < human.overshoot, "overshoot: ork most, elf least");
  assert(ork.sway > human.sway && ork.armSwing > human.armSwing, "ork swagger");
  assert(dwarf.crouch < human.crouch && dwarf.strideScale < human.strideScale, "dwarf low, short stride");
  assert(dwarf.recoverTime > human.recoverTime, "dwarf heavy recovery");
  assert(elf.strikeTime < human.strikeTime && elf.strideScale > human.strideScale && elf.chainLag < human.chainLag, "elf quick, long");
});

Deno.test("style: every subrace is a small twist of its race, two seeds never coincide", () => {
  for (const race of RACES) {
    const vs = race.subspecies.map((sub) => { const s = motionStyleFor(base({ race: race.id, subrace: sub.id })); s.setLiveImmediate(FRESH); return styleVector(s); });
    const raceOnly = (() => { const s = motionStyleFor(base({ race: race.id })); s.setLiveImmediate(FRESH); return styleVector(s); })();
    for (let i = 0; i < vs.length; i++) {
      const d = styleDistance(vs[i], raceOnly);
      assert(d > 0.002 && d < 0.1, `${race.id}/${race.subspecies[i].id}: distance to its race ${d}`);
      for (let j = i + 1; j < vs.length; j++) assert(styleDistance(vs[i], vs[j]) > 0.002, `${race.id}: subraces ${i}, ${j} identical`);
    }
  }
  const a = motionStyleFor(base({ seed: 1 })), b = motionStyleFor(base({ seed: 2 }));
  const d = styleDistance(styleVector(a), styleVector(b));
  assert(d > 0 && d < 0.05, `two seeds: ${d}`);
  let jd = 0;
  for (let j = 0; j < a.jointAmp.length; j++) jd = Math.max(jd, Math.abs(a.jointAmp[j] - b.jointAmp[j]));
  assert(jd > 0.005 && jd <= 0.06 + 1e-9, `per-joint amplitude differs by ${jd}`);
});

Deno.test("style: weapon heft, handle and kind; stats; legacy fallback", () => {
  const w = (id: ArchetypeId) => { const s = motionStyleFor(base({ weapon: sword(id) })); s.setLiveImmediate(FRESH); return s.eff; };
  const dagger = w("dagger"), longsword = w("longsword"), hammer = w("warhammer");
  assert(hammer.windupTime > longsword.windupTime && longsword.windupTime > dagger.windupTime, "heavier weapon -> longer wind-up");
  assert(hammer.overshoot > dagger.overshoot && hammer.legDrive > dagger.legDrive, "heavier weapon -> more overshoot, more legs");
  const strong = motionStyleFor(base({ stats: { ...base().stats, strength: 14 } })), weak = motionStyleFor(base({ stats: { ...base().stats, strength: 2 } }));
  assert(strong.eff.windupDepth > weak.eff.windupDepth && strong.eff.followThrough > weak.eff.followThrough, "strength: deeper, longer");
  const quick = motionStyleFor(base({ stats: { ...base().stats, reflex: 14 } })), slow = motionStyleFor(base({ stats: { ...base().stats, reflex: 2 } }));
  assert(quick.eff.strikeTime < slow.eff.strikeTime && quick.eff.chainLag < slow.eff.chainLag, "reflex: snappier strike, tighter chain");
  const lw = weaponMotionFromLegacy(weaponForClass("Barbarian"), "chop");
  assert(lw.mass > 1 && lw.hands === 2 && Number.isFinite(lw.inertia!), "legacy greataxe maps to a heavy two-hander");
  inSafe("legacy", motionStyleFor(base({ weapon: lw })));
});

Deno.test("style: live states — exhausted recovers slower, guards lower and breathes harder; low hp hunches and tucks", () => {
  const s = motionStyleFor(base());
  s.setLiveImmediate(FRESH); const f = { ...s.eff };
  s.setLiveImmediate(TIRED); const t = { ...s.eff };
  s.setLiveImmediate(HURT); const h = { ...s.eff };
  assert(t.recoverTime > f.recoverTime * 1.2 && t.windupTime > f.windupTime && t.settleTime > f.settleTime, "exhausted: slower phases");
  assert(t.guardDrop > f.guardDrop + 0.15 && t.breathAmp > 1.8 * f.breathAmp && t.breathRate > f.breathRate && t.strideScale < f.strideScale, "exhausted: low guard, heavy breathing, short stride");
  assert(h.hunch > f.hunch + 0.1 && h.guardTuck > f.guardTuck + 0.15 && h.guardDrop < f.guardDrop, "low hp: hunched, protective guard");
  assert(s.swingOverrun() > 0, "hurt fighters' swings may outlast the cooldown");
  s.setLiveImmediate(FRESH);
  assert(s.swingOverrun() < 1e-6, "a fresh fighter's swing never outlasts its cooldown share");
});

Deno.test("style: race differences measured on the real stat blocks (Fighter.createFighter)", () => {
  const vec = (race: string, sub: string | null) => {
    const stats = createFighter("Warrior", "x", 0, 0, 0.5, race, sub).stats;
    const s = motionStyleFor(base({ race, subrace: sub, stats })); s.setLiveImmediate(FRESH); return styleVector(s);
  };
  const h = vec("human", "imperial"), e = vec("elf", "high"), d = vec("dwarf", "mountain"), o = vec("ork", "ironhide");
  const pairs = [styleDistance(h, e), styleDistance(h, d), styleDistance(h, o), styleDistance(e, d), styleDistance(e, o), styleDistance(d, o)];
  console.log(`race style distances h-e ${pairs[0].toFixed(3)} h-d ${pairs[1].toFixed(3)} h-o ${pairs[2].toFixed(3)} e-d ${pairs[3].toFixed(3)} e-o ${pairs[4].toFixed(3)} d-o ${pairs[5].toFixed(3)}`);
  // "Slightly different": every race pair differs visibly (> 5 % RMS) but stays within ~40 %.
  for (const p of pairs) assert(p > 0.05 && p < 0.45, `race pair distance ${p}`);
  assert(NEUTRAL.holdTime > 0 && NEUTRAL.settleTime > 0, "neutral holds exist");
});
