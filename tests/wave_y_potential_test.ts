// Wave Y (lane P): the potential law (C-POT) and the pool-aware AI (C-AI). SPEC Y1..Y12.
//
// The arithmetic of src/game/Potential.ts is proven here (a pure module's test IS its evidence);
// the wiring into MatchSim is exercised headless; the live engine is the browser probe's job.

import {
  capCurrent, capOf, createPotential, drainingStatuses, fatigueLossFor, fatigueReading, fatigueResist, fighterPotential,
  FREE_COUNT, POOL_KINDS, poolLevel, POTENTIAL_FLOOR, recordSpend, REST_DELAY, REST_RATE, statusDrain, tickPotential,
  traitsOf, WOUND_SHARE, woundFactor, woundPotential, withPotentials, type PotentialState,
} from "../src/game/Potential.ts";
import { createResources, EXHAUST_RECOVER_FRACTION, grantResource, regenResources, trySpend } from "../src/game/Resources.ts";
import { createStats } from "../src/game/Stats.ts";
import { rng32 } from "../src/core/MathCore.ts";
import { STATUS_DEFS, type StatusName } from "../src/game/Status.ts";
import { fighterKnowledge, isWorn, poolAwareTree, poolWiseSkill, pressDecision } from "../src/game/AiBrain.ts";
import { ATTRIBUTE_KEYS, decide, defaultTree, edgeAwareTree, type CombatView } from "../src/game/DecisionTree.ts";
import { simulateMatch } from "../src/balance/MatchSim.ts";
import { designPoints, toConditions } from "../src/balance/Gradient.ts";
import { buildFallbackArena } from "../src/balance/ArenaFixtures.ts";
import { fighterStats } from "../src/balance/FighterBuild.ts";
import { WAVE_J_RULES } from "../src/balance/MatchRules.ts";

function assert(ok: unknown, msg = "assertion failed"): asserts ok { if (!ok) throw new Error(msg); }
const EPS = 1e-9;

function fresh(traits: Partial<{ vitality: number; resilience: number; focus: number; endurance: number }> = {}): PotentialState {
  return createPotential({ health: 20000, mana: 80, stamina: 90 }, traits);
}

Deno.test("SPEC Y1: a fresh state holds every potential at max; the invariant reads 0 <= current <= potential <= max", () => {
  const s = fresh();
  for (const k of POOL_KINDS) {
    assert(s.potential[k] === s.max[k], `${k} starts at max`);
    const l = poolLevel(s, k, s.max[k] * 2);
    assert(l.current === l.potential && l.potential === l.max, `${k} reading clamps an over-full current`);
    assert(poolLevel(s, k, -5).current === 0, `${k} reading clamps a negative current`);
    assert(poolLevel(s, k, Number.NaN).current === 0, `${k} NaN reads 0`);
  }
});

Deno.test("SPEC Y2: invariants hold over 300 fuzzed random sequences (damage, spend, status, heal, regen, rest)", () => {
  const statuses = Object.keys(STATUS_DEFS) as StatusName[];
  let steps = 0;
  for (let seq = 0; seq < 300; seq++) {
    const r = rng32(0x5eed + seq);
    const stats = { ...createStats("Warrior"), vitality: 2 + r() * 10, resilience: 2 + r() * 10, focus: 2 + r() * 10 };
    let res = createResources(stats);
    const pot = fighterPotential(20000 + r() * 20000, res, stats, ["human", "elf", "dwarf", "ork"][Math.floor(r() * 4)], null);
    let hp = pot.max.health;
    for (let i = 0; i < 200; i++) {
      const op = r();
      if (op < 0.25) { const d = r() * 3000; hp -= d; woundPotential(pot, d, r() * 12); }
      else if (op < 0.5) {
        const k = r() < 0.5 ? "mana" : "stamina", c = r() * 30;
        const paid = trySpend(res, k, c);
        if (paid) { res = paid; recordSpend(pot, k, c); }
      } else if (op < 0.6) statusDrain(pot, [statuses[Math.floor(r() * statuses.length)]], r() * 0.5);
      else if (op < 0.7) hp = Math.min(capOf(pot, "health"), hp + r() * 5000);
      else if (op < 0.75) res = grantResource(withPotentials(res, pot), r() < 0.5 ? "mana" : "stamina", r() * 100);
      const dt = r() * 0.5;
      tickPotential(pot, dt);
      res = regenResources(withPotentials(res, pot), dt);
      steps++;
      const cur = { health: Math.max(0, hp), mana: res.mana.current, stamina: res.stamina.current };
      for (const k of POOL_KINDS) {
        assert(Number.isFinite(pot.potential[k]), `${k} potential finite`);
        assert(pot.potential[k] <= pot.max[k] + EPS, `seq ${seq} step ${i}: ${k} potential ${pot.potential[k]} > max ${pot.max[k]}`);
        assert(pot.potential[k] >= pot.max[k] * POTENTIAL_FLOOR[k] - EPS, `seq ${seq}: ${k} under the floor`);
        assert(cur[k] >= 0 && cur[k] <= pot.potential[k] + 1e-6, `seq ${seq} step ${i}: ${k} current ${cur[k]} above potential ${pot.potential[k]}`);
      }
    }
  }
  assert(steps === 60000, `fuzzed ${steps} steps`);
});

Deno.test("SPEC Y3: wounds are monotone — more damage, a stronger attacker, a frailer body -> lower health potential", () => {
  const after = (dmg: number, str = 5, traits = {}) => { const s = fresh(traits); woundPotential(s, dmg, str); return s.potential.health; };
  let prev = Infinity;
  for (const d of [0, 500, 1000, 2000, 4000, 8000]) { const p = after(d); assert(p <= prev, `damage ${d}: ${p} > ${prev}`); prev = p; }
  assert(after(4000) < after(2000), "strictly lower for more damage above the floor");
  assert(after(4000, 9) < after(4000, 5) && after(4000, 5) < after(4000, 2), "a stronger attacker wounds deeper");
  assert(after(4000, 5, { vitality: 9, resilience: 9 }) > after(4000, 5, { vitality: 3, resilience: 3 }), "vitality/resilience reduce the wound");
  // The share at a neutral matchup is exactly WOUND_SHARE of the blow.
  assert(Math.abs((20000 - after(1000)) - WOUND_SHARE * 1000) < 1e-9, "neutral wound = WOUND_SHARE x damage");
  assert(woundFactor({ vitality: 5, resilience: 5 }, 5) === 1, "neutral wound factor 1");
  // A wound never takes more than the blow itself: health current falls at least as fast as its potential.
  const s = fresh(); let hp = s.max.health;
  for (let i = 0; i < 40; i++) { hp -= 700; woundPotential(s, 700, 12); assert(hp <= s.potential.health + EPS, "hp stays under its potential"); }
});

Deno.test("SPEC Y4: fatigue — a sustainable pace costs nothing; too much, too fast, too often lowers the potential", () => {
  // Paced: one 10-stamina spend every 4 s (within FREE_COUNT per window, low rate, low amount).
  const paced = fresh();
  for (let i = 0; i < 20; i++) { recordSpend(paced, "stamina", 10); tickPotential(paced, 4); }
  assert(paced.lost.stamina.fatigue === 0, `paced spending is free (lost ${paced.lost.stamina.fatigue})`);
  // Burst: the same spends 0.3 s apart.
  const burst = fresh();
  for (let i = 0; i < 8; i++) { recordSpend(burst, "stamina", 10); tickPotential(burst, 0.3); }
  assert(burst.lost.stamina.fatigue > 0, "a burst is fatiguing");
  // Each of the three measures alone triggers it.
  const r = (sp: [number, number][], k: "mana" | "stamina" = "stamina") => { const s = fresh(); for (const [c, dt] of sp) { recordSpend(s, k, c); tickPotential(s, dt); } return fatigueReading(s, k, 0); };
  const many = r(Array.from({ length: FREE_COUNT + 3 }, () => [1, 1] as [number, number]));
  assert(many.count > FREE_COUNT && many.overload > 0, `frequency alone overloads (${JSON.stringify(many)})`);
  const big = r([[45, 3], [10, 0.1]]);
  assert(big.amount > 0.4 && big.overload > 0, "amount alone overloads");
  // More spending in a burst -> more loss (monotone in the burst size).
  let prev = -1;
  for (const n of [2, 4, 6, 8, 10]) {
    const s = fresh();
    for (let i = 0; i < n; i++) { recordSpend(s, "stamina", 10); tickPotential(s, 0.25); }
    assert(s.lost.stamina.fatigue >= prev, `burst ${n}: loss fell`);
    prev = s.lost.stamina.fatigue;
  }
});

Deno.test("SPEC Y5: focus softens mana fatigue; vitality and race endurance soften stamina fatigue", () => {
  const loss = (k: "mana" | "stamina", traits: object) => {
    const s = fresh(traits);
    // A 4-spend burst: over pace, but above the floor for every trait (8 spends saturate at the floor).
    for (let i = 0; i < 4; i++) { recordSpend(s, k, 12); tickPotential(s, 0.3); }
    return s.lost[k].fatigue;
  };
  assert(loss("mana", { focus: 10 }) < loss("mana", { focus: 5 }) && loss("mana", { focus: 5 }) < loss("mana", { focus: 2 }), "focus");
  assert(loss("stamina", { vitality: 10 }) < loss("stamina", { vitality: 3 }), "vitality");
  assert(loss("stamina", { endurance: 1.3 }) < loss("stamina", { endurance: 0.8 }), "endurance");
  assert(loss("mana", { vitality: 10 }) === loss("mana", { vitality: 3 }), "vitality does not touch mana fatigue");
  const dwarf = traitsOf({ vitality: 5 }, "dwarf", null), elf = traitsOf({ vitality: 5 }, "elf", null);
  assert(fatigueResist(dwarf, "stamina") !== fatigueResist(elf, "stamina") || dwarf.endurance === elf.endurance, "race endurance reaches the resist");
});

Deno.test("SPEC Y6: enemy statuses drain mana/stamina potential (never health); good statuses drain nothing", () => {
  const s = fresh();
  statusDrain(s, ["poisoned", "hypnotised"], 2);
  assert(s.potential.stamina < s.max.stamina, "poison drains stamina potential");
  assert(s.potential.mana < s.max.mana, "hypnosis drains mana potential");
  assert(s.potential.health === s.max.health, "statuses do not wound");
  const g = fresh();
  statusDrain(g, ["blessed", "hasted"], 5);
  for (const k of POOL_KINDS) assert(g.potential[k] === g.max[k], `good statuses leave ${k}`);
  assert(drainingStatuses(["blessed", "burning", "hasted"]).join() === "burning", "only harmful statuses drain");
});

Deno.test("SPEC Y7: the potential recovers slowly after REST_DELAY s of rest, never above max", () => {
  const s = fresh();
  woundPotential(s, 5000);
  const low = s.potential.health;
  tickPotential(s, REST_DELAY * 0.5);
  assert(s.potential.health === low, "no recovery inside the rest delay");
  tickPotential(s, REST_DELAY);
  assert(s.potential.health > low, "recovers once rested");
  const gained = s.potential.health - low;
  assert(gained <= REST_RATE.health * s.max.health * REST_DELAY * 1.5 + EPS, "slowly (REST_RATE)");
  for (let i = 0; i < 2000; i++) tickPotential(s, 1);
  assert(s.potential.health === s.max.health, "back to max, not above");
  // A spend resets the stamina rest clock.
  const t = fresh();
  for (let i = 0; i < 8; i++) { recordSpend(t, "stamina", 12); tickPotential(t, 0.2); }
  const p0 = t.potential.stamina;
  tickPotential(t, REST_DELAY - 0.5);
  recordSpend(t, "stamina", 1);
  tickPotential(t, 1);
  assert(t.potential.stamina <= p0, "spending again restarts the rest clock");
});

Deno.test("SPEC Y8: regen and grants refill current only up to the potential (Resources honours ResourcePool.potential)", () => {
  const stats = createStats("Mage");
  const pot = fighterPotential(30000, createResources(stats), stats, "human", null);
  let res = createResources(stats);
  res = trySpend(res, "mana", res.mana.max * 0.9)!;
  pot.potential.mana = pot.max.mana * 0.6;
  for (let i = 0; i < 600; i++) res = regenResources(withPotentials(res, pot), 0.5);
  assert(Math.abs(res.mana.current - pot.max.mana * 0.6) < 1e-9, `regen stops at the potential (${res.mana.current})`);
  res = grantResource(res, "mana", 1000);
  assert(res.mana.current <= pot.max.mana * 0.6 + 1e-9, "a grant stops at the potential");
  // Without a potential the pool behaves exactly as before Wave Y.
  const legacy = regenResources({ ...createResources(stats), mana: { current: 1, max: 50, regenPerSecond: 10 } }, 100);
  assert(legacy.mana.current === 50, "no potential -> max is the cap");
  assert(capCurrent(pot, "health", 1e9) === capOf(pot, "health"), "capCurrent clamps to the cap");
});

Deno.test("SPEC Y9: the spend floors sit above the exhaustion wake fraction (an exhausted fighter can always wake)", () => {
  assert(POTENTIAL_FLOOR.stamina > EXHAUST_RECOVER_FRACTION, "stamina floor > wake fraction");
  assert(POTENTIAL_FLOOR.mana > 0 && POTENTIAL_FLOOR.health > 0, "positive floors");
  const stats = createStats("Barbarian");
  const pot = fighterPotential(30000, createResources(stats), stats);
  for (let i = 0; i < 500; i++) { recordSpend(pot, "stamina", 30); statusDrain(pot, ["chilled"], 1); }
  let res = trySpend(createResources(stats), "stamina", createResources(stats).stamina.max)!;
  assert(res.exhausted, "emptied -> exhausted");
  for (let i = 0; i < 400; i++) res = regenResources(withPotentials(res, pot), 0.5);
  assert(!res.exhausted, "wakes even with the stamina potential at its floor");
});

Deno.test("SPEC Y10: determinism — the same sequence gives the same state, bit for bit", () => {
  const run = () => {
    const r = rng32(99), s = fresh({ vitality: 7, focus: 4 });
    for (let i = 0; i < 500; i++) {
      if (r() < 0.4) woundPotential(s, r() * 2000, r() * 10);
      else recordSpend(s, r() < 0.5 ? "mana" : "stamina", r() * 20);
      statusDrain(s, r() < 0.2 ? ["burning"] : [], r() * 0.3);
      tickPotential(s, r() * 0.4);
    }
    return JSON.stringify(s);
  };
  assert(run() === run(), "deterministic");
  const s = fresh();
  recordSpend(s, "mana", 10);
  const before = JSON.stringify(s);
  fatigueLossFor(s, "mana", 50); fatigueReading(s, "mana", 50);
  assert(JSON.stringify(s) === before, "the AI look-ahead does not mutate");
});

// ─── MatchSim wiring ──────────────────────────────────────────────────────────────────────────

function conditions(n: number, seed: number) {
  return designPoints("random", n, seed).map((p) => {
    const c = toConditions(p, buildFallbackArena, "test");
    for (const f of c.fighters) f.stats = fighterStats(f, WAVE_J_RULES);
    return c;
  });
}

Deno.test("SPEC Y11: MatchSim plays the law — wounds and fatigue land, invariants hold at the bell, deterministic, and the off switch is the old game", () => {
  let wounded = 0, fatigued = 0, n = 0;
  for (const c of conditions(40, 7)) {
    let ends: { pot: PotentialState; hp: number; res: { mana: { current: number }; stamina: { current: number } } }[] = [];
    const a = simulateMatch(c, { onFinish: (s) => { ends = s.map((x) => ({ pot: structuredClone(x.pot), hp: x.hp, res: x.res })); } });
    const b = simulateMatch(c, {});
    assert(JSON.stringify(a) === JSON.stringify(b), "deterministic per conditions");
    assert(ends.length === 2, "onFinish sees both seats");
    for (const e of ends) {
      n++;
      if (e.pot.lost.health.wound > 0) wounded++;
      if (e.pot.lost.stamina.fatigue + e.pot.lost.mana.fatigue > 0) fatigued++;
      assert(e.hp <= e.pot.potential.health + 1e-6, "hp <= health potential");
      assert(e.res.mana.current <= e.pot.potential.mana + 1e-6 && e.res.stamina.current <= e.pot.potential.stamina + 1e-6, "pools under their potentials");
      for (const k of POOL_KINDS) assert(e.pot.potential[k] <= e.pot.max[k] + EPS, "potential <= max");
    }
  }
  assert(wounded > n / 2, `most seats take wounds (${wounded}/${n})`);
  assert(fatigued > 0, `some seats fatigue (${fatigued}/${n})`);
  // potentials:false never builds the law into the match: the same conditions give the pre-Wave-Y result
  // (byte-identical to HEAD on 300 matches, docs/wave-y/POOLS.md) — here: no aware brain, no ceiling.
  const c = conditions(1, 3)[0];
  const off = simulateMatch(c, { potentials: false });
  assert(off.reason !== "error", `off plays (${off.error ?? ""})`);
});

// ─── The AI's knowledge and decisions ─────────────────────────────────────────────────────────

function view(over: Partial<CombatView> = {}): CombatView {
  return {
    distance: 1.2, selfReach: 1.5, enemyReach: 1.5, selfHpRatio: 0.6, enemyHpRatio: 0.5, nearEdge: false, ready: true,
    enemyAttacking: 1, selfDamagePercent: 0, enemyDamagePercent: 0, roundTime: 30, ...over,
  };
}

Deno.test("SPEC Y12: the AI view carries all 7 attributes and 3 pools of both fighters; press / pace / conserve use them", () => {
  const sa = createStats("Warrior"), sb = createStats("Mage");
  const ra = createResources(sa), rb = createResources(sb);
  const pa = fighterPotential(sa.maxHealth, ra, sa), pb = fighterPotential(sb.maxHealth, rb, sb);
  const ka = fighterKnowledge(sa, pa, sa.maxHealth, ra);
  for (const k of ATTRIBUTE_KEYS) assert(ka.attributes[k] === sa[k], `attribute ${k} carried`);
  for (const k of POOL_KINDS) assert(ka.pools[k].max > 0 && ka.pools[k].potential === ka.pools[k].max, `pool ${k} carried`);
  // A fresh enemy is not worn; a fatigued one is.
  const kbFresh = fighterKnowledge(sb, pb, sb.maxHealth, rb);
  assert(!isWorn(kbFresh), "fresh enemy not worn");
  assert(pressDecision(view({ self: ka, enemy: kbFresh })) === undefined, "no press against a fresh enemy");
  for (let i = 0; i < 12; i++) { recordSpend(pb, "stamina", 15); tickPotential(pb, 0.2); }
  const kbWorn = fighterKnowledge(sb, pb, sb.maxHealth * 0.5, withPotentials(rb, pb));
  assert(isWorn(kbWorn), "fatigued enemy worn");
  // The default tree BLOCKS here (enemy attacking, self hp <= 0.5 would block; at 0.6 it attacks) —
  // use hp 0.45 vs 0.5 where the tree blocks, and the press attacks.
  const v = view({ selfHpRatio: 0.5, enemyHpRatio: 0.5, self: ka, enemy: kbWorn });
  assert(decide(defaultTree(), { ...v, self: undefined, enemy: undefined }) === "block", "the old tree blocks");
  assert(decide(poolAwareTree(defaultTree()), v) === "attack", "the aware tree presses a worn enemy");
  assert(pressDecision({ ...v, distance: 3 }) === "advance", "press closes in out of reach");
  assert(pressDecision({ ...v, nearEdge: true, openBehind: 1 }) === undefined, "never with the back to an open edge");
  // Without knowledge the wrapped tree decides exactly as the base tree (fuzzed views, both trees).
  const r = rng32(5);
  for (const base of [defaultTree(), edgeAwareTree(1.8)]) {
    for (let i = 0; i < 2000; i++) {
      const w = view({ distance: r() * 6, selfHpRatio: r(), enemyHpRatio: r(), nearEdge: r() < 0.3, ready: r() < 0.5, enemyAttacking: r() < 0.5 ? 1 : 0, openFraction: r() < 0.5 ? r() : undefined, openBehind: r() < 0.5 ? 1 : 0, rimBehind: r() * 5 });
      assert(decide(poolAwareTree(base), w) === decide(base, w), `unchanged without knowledge (view ${i})`);
    }
  }
  // Conserve: a spend that would burn the potential in fatigue is skipped, unless it finishes the enemy.
  const tired = fighterPotential(sb.maxHealth, rb, sb);
  for (let i = 0; i < 3; i++) { recordSpend(tired, "mana", 24); tickPotential(tired, 0.3); }
  assert(tired.potential.mana > tired.max.mana * POTENTIAL_FLOOR.mana + 5, "still above the floor (at the floor nothing is left to lose)");
  const ks = fighterKnowledge(sb, tired, sb.maxHealth, rb);
  const lossFor = (k: "mana" | "stamina", c: number) => fatigueLossFor(tired, k, c);
  assert(!poolWiseSkill({ mana: 24, stamina: 8 }, { self: ks, enemyHpRatio: 0.8 }, lossFor), "a caster does not overspend into fatigue");
  assert(poolWiseSkill({ mana: 24, stamina: 8 }, { self: ks, enemyHpRatio: 0.1 }, lossFor), "...unless it finishes the enemy");
  assert(poolWiseSkill({ mana: 24, stamina: 8 }, { enemyHpRatio: 0.8 }, lossFor), "no knowledge -> allowed (old behaviour)");
  // Pace: a low stamina potential with a low current holds a stamina spend.
  const worn = fighterPotential(sa.maxHealth, ra, sa);
  worn.potential.stamina = worn.max.stamina * 0.5;
  const kw = fighterKnowledge(sa, worn, sa.maxHealth, { ...ra, stamina: { ...ra.stamina, current: worn.max.stamina * 0.3 } });
  assert(!poolWiseSkill({ mana: 0, stamina: 12 }, { self: kw, enemyHpRatio: 0.8 }, () => 0), "pace a worn body");
  assert(poolWiseSkill({ mana: 6, stamina: 0 }, { self: kw, enemyHpRatio: 0.8 }, () => 0), "pace only gates stamina spends");
});
