// Lane J-A (Wave J): impact-driven damage and smaller pools. Pins the four claims the brief
// demands, all MEASURED: the physics impact response (>= 2.2x full speed vs still, >= 0.45x floor),
// the health/power rescale with the DPS x eHP invariant kept, a shorter chunky duel (median
// 25-55 s, hits-to-kill DROPS, damage p80/p20 >= 1.9), and the geometric Impact path's monotone,
// bounded response to impact. Numbers printed so the report can quote them.
import {
  attackDamage, CLASSES, createStats, DAMAGE_SCALE, FIGHT_LENGTH, HEALTH_SCALE, powerIndex, TARGET_POWER_INDEX,
  type ClassName, type CombatStats,
} from "../src/game/Stats.ts";
import {
  bodyFromStats, CLOSING_BASE, CLOSING_GAIN, CLOSING_SAT, physicsMultiplier, PHYSICS_MUL_MAX, PHYSICS_MUL_MIN,
} from "../src/game/Physics.ts";
import { HARNESS_CLOSING_SPEED, randomSource } from "../src/balance/ArenaHarness.ts";
import { applyRaceBonus } from "../src/game/Races.ts";
import { applySecondary } from "../src/game/SecondaryStats.ts";
import { resolveImpact } from "../src/combat/Impact.ts";
import type { Contact, HitZone, ImpactInput, V3 } from "../src/combat/contracts.ts";
import { capsule, PROFILES, warhammer } from "./combat_fixtures.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

// ---------------------------------------------------------------- 1. physics impact response

/** The arena's representative closing speed is 1 m/s, so a heavy body's full-speed blow is |v|>=2. */
Deno.test("J-A impact: a full-speed heavy blow is >= 2.2x the same blow standing still, floor >= 0.45x", () => {
  const heavy = bodyFromStats(createStats("Barbarian"));
  const light = bodyFromStats(createStats("Mage"));
  const still = physicsMultiplier(heavy, heavy, 0);
  const full = physicsMultiplier(heavy, heavy, 2);
  const ratio = full / still;
  console.log(`  heavy->heavy: still ${still.toFixed(3)}, full ${full.toFixed(3)}, ratio ${ratio.toFixed(3)}`);
  assert(ratio >= 2.2, `full-speed heavy blow only ${ratio.toFixed(3)}x a standing one`);
  // A graze (a light body barely moving into a heavy one) keeps at least 0.45x a nominal blow.
  const graze = physicsMultiplier(light, heavy, 0);
  const nominal = physicsMultiplier(heavy, heavy, HARNESS_CLOSING_SPEED);
  console.log(`  graze (light->heavy at rest) ${graze.toFixed(3)}, vs nominal ${nominal.toFixed(3)} -> ${(graze / nominal).toFixed(3)}x; floor PHYSICS_MUL_MIN ${PHYSICS_MUL_MIN}`);
  assert(graze / nominal >= 0.45, `graze ${(graze / nominal).toFixed(3)}x below the 0.45 floor`);
  assert(PHYSICS_MUL_MIN >= 0.45, "the multiplier floor itself must be >= 0.45x");
});

Deno.test("J-A physics: bounded in [0.5, 2.2], monotone in speed and mass, saturating at |v| = 2", () => {
  assert(PHYSICS_MUL_MIN === 0.5 && PHYSICS_MUL_MAX === 2.2, `bounds ${PHYSICS_MUL_MIN}, ${PHYSICS_MUL_MAX}`);
  assert(CLOSING_GAIN > 0.15 && CLOSING_BASE === 0.85 && CLOSING_SAT === 2, "the closing term is steeper than 0.85 + 0.15*min(2,|v|)");
  for (const a of CLASSES) for (const d of CLASSES) {
    const A = bodyFromStats(createStats(a)), D = bodyFromStats(createStats(d));
    let prev = -Infinity;
    for (const v of [0, 0.5, 1, 2, 5, 10]) {
      const m = physicsMultiplier(A, D, v);
      assert(m >= PHYSICS_MUL_MIN && m <= PHYSICS_MUL_MAX, `${a}->${d} v=${v}: ${m} escaped the band`);
      assert(m >= prev - 1e-12, `${a}->${d}: moving must not weaken a blow (v=${v})`);
      prev = m;
    }
    assert(Math.abs(physicsMultiplier(A, D, 9) - physicsMultiplier(A, D, 2)) < 1e-9, `${a}->${d}: closing term must saturate at 2`);
  }
  // More mass, same defender and speed, is never less multiplier.
  const def = bodyFromStats(createStats("Rogue"));
  let prev = -Infinity;
  for (const str of [1, 2, 4, 6, 8, 10]) {
    const atk = bodyFromStats({ strength: str, vitality: 5, resilience: 5, reflex: 5, armor: 3 });
    const m = physicsMultiplier(atk, def, 1);
    assert(m >= prev - 1e-12, `heavy should not hit softer (str ${str})`);
    prev = m;
  }
  console.log(`  closing gain ${CLOSING_GAIN} (> 0.15), closing(1 m/s) ${(CLOSING_BASE + CLOSING_GAIN).toFixed(3)}`);
});

// ---------------------------------------------------------------- 2. smaller pools, invariant kept

Deno.test("J-A stats: HEALTH_SCALE 500, DAMAGE_SCALE = HEALTH_SCALE / FIGHT_LENGTH, DPS x eHP parity kept", () => {
  assert(HEALTH_SCALE === 500, `HEALTH_SCALE ${HEALTH_SCALE}`);
  assert(FIGHT_LENGTH === 10, `FIGHT_LENGTH ${FIGHT_LENGTH}`);
  assert(Math.abs(DAMAGE_SCALE - HEALTH_SCALE / FIGHT_LENGTH) < 1e-12, "DAMAGE_SCALE must stay derived");
  // The solve equalises DPS x effectiveHP (= powerIndex) across classes: the target product is
  // TARGET_POWER_INDEX x POWER_SCALE, and POWER_SCALE = HEALTH_SCALE * DAMAGE_SCALE.
  const target = TARGET_POWER_INDEX * HEALTH_SCALE * DAMAGE_SCALE;
  const idx = CLASSES.map((c) => powerIndex(createStats(c)));
  const sorted = [...idx].sort((x, y) => x - y);
  const median = (sorted[3] + sorted[4]) / 2;
  for (let i = 0; i < CLASSES.length; i++) {
    const r = idx[i] / median;
    console.log(`  ${CLASSES[i].padEnd(12)} HP ${createStats(CLASSES[i]).maxHealth.toFixed(0).padStart(5)} pow ${createStats(CLASSES[i]).attackPower.toFixed(0).padStart(4)} DPSxeHP ${(idx[i] / 1e6).toFixed(2)}M (${r.toFixed(3)}x median, target ${(target / 1e6).toFixed(2)}M)`);
    assert(r >= 0.75 && r <= 1.25, `${CLASSES[i]} DPSxeHP ${(r * 100).toFixed(0)}% of the field: solve parity broken`);
  }
  // The pool is half the pre-Wave-J size and the power numbers came down with it.
  assert(createStats("Barbarian").maxHealth < 30000, "pools must be ~half (Barbarian < 30k)");
  assert(createStats("Necromancer").attackPower < 700, "attack power numbers must come down");
});

// ---------------------------------------------------------------- 3. the duel: shorter, chunkier

const FIGHTS_PER_PAIR = 1200;
/** Race + ancestry applied, exactly as the arena harness and tools/balance-report.ts run it. */
function raceMod(cn: ClassName): CombatStats {
  return applySecondary(applyRaceBonus(createStats(cn), "human", null), "imperial", "mountain");
}
interface SimResult { outcome: number; duration: number; hitsToKill: number }
function simulate(a: CombatStats, b: CombatStats, randA: () => number, randB: () => number, dmgs: number[]): SimResult {
  let aHp = a.maxHealth, bHp = b.maxHealth, aT = a.attackInterval, bT = b.attackInterval;
  const physA = physicsMultiplier(bodyFromStats(a), bodyFromStats(b), HARNESS_CLOSING_SPEED);
  const physB = physicsMultiplier(bodyFromStats(b), bodyFromStats(a), HARNESS_CLOSING_SPEED);
  let hitsA = 0, hitsB = 0;
  for (let t = 0; t < 600; t++) {
    const aGo = aT <= bT + 0.0005, bGo = bT <= aT + 0.0005;
    const eventT = Math.min(aGo ? aT : Infinity, bGo ? bT : Infinity);
    if (aGo) aT += a.attackInterval;
    if (bGo) bT += b.attackInterval;
    let aD = false, bD = false;
    if (aGo) { const d = attackDamage(a, b, randA(), randA()) * physA; dmgs.push(d); hitsA++; bHp -= d; if (bHp <= 0) bD = true; }
    if (bGo) { const d = attackDamage(b, a, randB(), randB()) * physB; dmgs.push(d); hitsB++; aHp -= d; if (aHp <= 0) aD = true; }
    if (aD && bD) return { outcome: 0.5, duration: eventT, hitsToKill: (hitsA + hitsB) / 2 };
    if (bD) return { outcome: 1, duration: eventT, hitsToKill: hitsA };
    if (aD) return { outcome: 0, duration: eventT, hitsToKill: hitsB };
  }
  throw new Error("simulate: fight exceeded 600 exchanges");
}
/** Recorded pre-Wave-J harness baseline (seed 20261009, 4000 fights/pair), for the DROP check. */
const BASELINE_MEDIAN_SECONDS = 51.8, BASELINE_HITS_TO_KILL = 51.3;
function pct(arr: number[], q: number): number {
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

Deno.test("J-A duel: median decisive duel 25-55 s, hits-to-kill DROPS, damage p80/p20 >= 1.9", () => {
  const pairs: [ClassName, ClassName][] = [];
  for (let i = 0; i < CLASSES.length; i++) for (let j = i + 1; j < CLASSES.length; j++) pairs.push([CLASSES[i], CLASSES[j]]);
  const durations: number[] = [], htk: number[] = [], dmgs: number[] = [];
  for (let p = 0; p < pairs.length; p++) {
    const rA = randomSource((20261009 ^ (p * 0x9e3779b9)) >>> 0), rB = randomSource((20261009 ^ ((p + 1) * 0x85ebca6b)) >>> 0);
    const a = raceMod(pairs[p][0]), b = raceMod(pairs[p][1]);
    for (let f = 0; f < FIGHTS_PER_PAIR; f++) {
      const s = simulate(a, b, rA, rB, dmgs);
      if (s.outcome !== 0.5) { durations.push(s.duration); htk.push(s.hitsToKill); }
    }
  }
  const medDur = pct(durations, 0.5), meanHtk = htk.reduce((x, y) => x + y, 0) / htk.length;
  const p20 = pct(dmgs, 0.2), p50 = pct(dmgs, 0.5), p80 = pct(dmgs, 0.8);
  console.log(`  median duel ${medDur.toFixed(1)} s (baseline ${BASELINE_MEDIAN_SECONDS}); mean hits-to-kill ${meanHtk.toFixed(1)} (baseline ${BASELINE_HITS_TO_KILL}); damage p20 ${p20.toFixed(1)} p50 ${p50.toFixed(1)} p80 ${p80.toFixed(1)} ratio ${(p80 / p20).toFixed(2)}`);
  assert(medDur >= 25 && medDur <= 55, `median duel ${medDur.toFixed(1)} s outside 25-55`);
  assert(medDur < BASELINE_MEDIAN_SECONDS, "the duel must get shorter than the baseline");
  assert(meanHtk < BASELINE_HITS_TO_KILL, `hits-to-kill ${meanHtk.toFixed(1)} did not drop below ${BASELINE_HITS_TO_KILL}`);
  assert(p80 / p20 >= 1.9, `damage p80/p20 ${(p80 / p20).toFixed(2)} below 1.9`);
});

// ---------------------------------------------------------------- 4. the geometric Impact path

const sure = () => { const seq = [0, 0.5, 0.99]; let i = 0; return () => seq[i++ % 3]; };
function contactOn(zone: HitZone, velocity: V3, feature: Contact["feature"], local: V3): Contact {
  return {
    hitbox: capsule([0, 1.2, 0.5], [0, 1.5, 0.5], 0.12, zone), feature, point: [0, 1.3, 0.38], normal: [0, 0, -1],
    velocity, t: 0.5, edgeAlignment: 1, thrustAlignment: 0, local,
  };
}
/** A square two-handed war-hammer head blow on the chest at closing speed `vn` from `mass` kg. */
function hammerDamage(vn: number, mass = 80): number {
  const input: ImpactInput = {
    contact: contactOn("chest", [0, 0, vn], "head", [0, 0.78, 0.03]),
    weapon: warhammer(), profile: PROFILES.heavy, handsUsed: 2,
    attacker: { mass, strength: 6, attackPower: 10, velocity: [0, 0, 0] },
    defender: { mass: 80, armour: 0, blocking: false, balance: 0.5, velocity: [0, 0, 0] },
    rng: sure(),
  };
  return resolveImpact(input).damage;
}

Deno.test("J-A impact path: damage rises with closing speed and mass, bounded, and heavy-vs-slow >= 2.2x", () => {
  const speeds = [2, 4, 6, 8, 10, 12, 14];
  const dmg = speeds.map((v) => hammerDamage(v));
  console.log(`  war-hammer square blow, damage by v_n: ${speeds.map((v, i) => `${v}:${dmg[i].toFixed(1)}`).join(" ")}`);
  for (let i = 1; i < dmg.length; i++) assert(dmg[i] >= dmg[i - 1] - 1e-9, `damage must be monotone in speed (v=${speeds[i]})`);
  const ratio = dmg[dmg.length - 1] / hammerDamage(3);
  console.log(`  full (14 m/s) / slow (3 m/s) = ${ratio.toFixed(2)}`);
  assert(ratio >= 2.2, `a full-speed blow is only ${ratio.toFixed(2)}x a slow one`);
  // Mass is monotone too: the same square blow from a heavier body hits at least as hard.
  let prev = -Infinity;
  for (const m of [50, 70, 90, 120, 150]) { const d = hammerDamage(10, m); assert(d >= prev - 1e-9, `heavier body must not hit softer (${m} kg)`); prev = d; }
  // Bounded and finite for degenerate input.
  for (const v of [0, 1e3, NaN, Infinity]) { const d = hammerDamage(Number.isFinite(v) ? (v as number) : NaN); assert(Number.isFinite(d) && d >= 0, `damage ${d} not finite/positive`); }
});
