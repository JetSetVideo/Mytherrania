// Lane H-E gate: the spectator generator's invariants, determinism and spread.
// Run: deno test --allow-read --allow-write=artifacts tests/spectategen_test.ts

import {
  ARENA_SIZE_MAX,
  ARENA_SIZE_MIN,
  budgetForLevel,
  generateSpectateCard,
  levelForBudget,
  MAX_LEVEL,
  MIN_LEVEL,
  PER_STAT_CAP,
  spendBudget,
  techniquesFor,
} from "../src/game/SpectateGen.ts";
import { CLASSES, type ClassName } from "../src/game/Stats.ts";
import { SKILLS_BY_CLASS } from "../src/game/Skills.ts";
import type { StatName } from "../src/game/Races.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}

/** A seeded rng for the tests (mulberry32, matching the module's discipline). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATS: StatName[] = ["vitality", "resilience", "willpower", "reflex", "strength", "intelligence"];

// ---------------------------------------------------------------------------
// budgetForLevel / levelForBudget: the inverse pair.
// ---------------------------------------------------------------------------

Deno.test("level <-> budget round-trips exactly for every integer level 1..20", () => {
  for (let l = 1; l <= 20; l++) {
    const b = budgetForLevel(l);
    assert(Number.isFinite(b), `budget for level ${l} is finite`);
    assert(levelForBudget(b) === l, `round trip level ${l}: got ${levelForBudget(b)}`);
  }
});

Deno.test("budget grows with level; level 1 is small, level 20 is the maximum", () => {
  assert(budgetForLevel(1) < budgetForLevel(20), "level 1 budget is below level 20");
  for (let l = 1; l < 20; l++) {
    assert(budgetForLevel(l + 1) > budgetForLevel(l), `budget is strictly increasing at ${l}`);
  }
  assert(budgetForLevel(20) === Math.max(...Array.from({ length: 20 }, (_, i) => budgetForLevel(i + 1))), "level 20 is the max budget");
});

Deno.test("budgetForLevel and levelForBudget clamp and never return NaN", () => {
  assert(budgetForLevel(-5) === budgetForLevel(MIN_LEVEL), "level below range clamps to 1");
  assert(budgetForLevel(999) === budgetForLevel(MAX_LEVEL), "level above range clamps to 20");
  assert(budgetForLevel(NaN) === budgetForLevel(MIN_LEVEL), "NaN level falls back to 1");
  assert(budgetForLevel(Infinity) === budgetForLevel(MAX_LEVEL), "Infinity level clamps to 20");
  assert(levelForBudget(-1e9) === MIN_LEVEL, "budget below the band clamps to level 1");
  assert(levelForBudget(1e12) === MAX_LEVEL, "budget above the band clamps to level 20");
  assert(levelForBudget(NaN) === MIN_LEVEL, "NaN budget falls back to level 1");
  assert(Number.isFinite(levelForBudget(Infinity)), "Infinity budget still returns a finite level");
});

Deno.test("level/budget round-trip sweep over the whole band with fractional noise", () => {
  for (let l = 1; l <= 20; l++) {
    const mid = budgetForLevel(l) + 0.4; // still resolves to level l
    assert(levelForBudget(mid) === l, `a budget just past level ${l}'s grid point stays on ${l}`);
  }
});

// ---------------------------------------------------------------------------
// spendBudget invariants.
// ---------------------------------------------------------------------------

const FULL_CAP = STATS.length * PER_STAT_CAP;
function sum(spent: Record<StatName, number>): number {
  return STATS.reduce((a, s) => a + spent[s], 0);
}

Deno.test("spendBudget never goes negative and sums to the budget minus the unspendable remainder", () => {
  for (const budget of [0, 1, 12, 50, 126, 200, FULL_CAP, FULL_CAP + 1]) {
    const s = spendBudget(budget, "Warrior", seeded(budget + 7));
    for (const k of STATS) assert(s[k] >= 0, `${k} non-negative at budget ${budget}`);
    assert(sum(s) === Math.min(budget, FULL_CAP), `sum equals min(budget, 6*cap) at ${budget}`);
  }
});

Deno.test("a budget under the total cap is spent in full (remainder 0, step 1)", () => {
  for (const budget of [0, 1, 2, 12, 126]) {
    const s = spendBudget(budget, "Assassin", seeded(budget * 3 + 1));
    assert(sum(s) === budget, `budget ${budget} is spent exactly`);
  }
});

Deno.test("a budget of 0 gives all zeros", () => {
  const s = spendBudget(0, "Mage", seeded(1));
  for (const k of STATS) assert(s[k] === 0, `${k} is 0`);
  assert(sum(s) === 0, "sum is 0");
});

Deno.test("a huge 10 000 budget respects the per-stat cap", () => {
  const s = spendBudget(10000, "Priest", seeded(42));
  for (const k of STATS) assert(s[k] === PER_STAT_CAP, `${k} is pinned at the cap ${PER_STAT_CAP}`);
  assert(sum(s) === FULL_CAP, "every stat at cap, overflow left unspent");
});

Deno.test("the same seed and role twice gives an identical allocation", () => {
  for (const role of CLASSES) {
    for (const seed of [1, 99, 12345]) {
      const a = spendBudget(80, role, seeded(seed));
      const b = spendBudget(80, role, seeded(seed));
      assert(JSON.stringify(a) === JSON.stringify(b), `${role}/${seed} reproduces`);
    }
  }
});

Deno.test("200 seeds over the classes give a non-degenerate spread: every stat is largest for some seed", () => {
  const largest = new Set<StatName>();
  for (let i = 0; i < 200; i++) {
    const role: ClassName = CLASSES[i % CLASSES.length];
    const s = spendBudget(budgetForLevel(1 + (i * 7) % 20), role, seeded(i + 1));
    let max = -1;
    let argmax: StatName | null = null;
    let ties = 0;
    for (const k of STATS) {
      if (s[k] > max) {
        max = s[k];
        argmax = k;
        ties = 1;
      } else if (s[k] === max) {
        ties++;
      }
    }
    if (ties === 1 && argmax) largest.add(argmax);
  }
  for (const k of STATS) assert(largest.has(k), `some seed has ${k} as the strict largest`);
});

Deno.test("spending is monotone in the budget: a larger budget never takes points away", () => {
  for (const role of CLASSES) {
    const small = spendBudget(20, role, seeded(5));
    const big = spendBudget(126, role, seeded(5));
    for (const k of STATS) assert(big[k] >= small[k], `${role}: ${k} does not shrink with a bigger budget`);
  }
});

// ---------------------------------------------------------------------------
// techniquesFor.
// ---------------------------------------------------------------------------

Deno.test("techniquesFor always returns 3..6 ids and always includes the class's three", () => {
  for (const role of CLASSES) {
    const base = SKILLS_BY_CLASS[role].map((s) => s.id);
    for (const budget of [0, 12, 60, 200, 10000]) {
      const spent = spendBudget(budget, role, seeded(budget + 3));
      const list = techniquesFor(spent, role);
      assert(list.length >= 3 && list.length <= 6, `${role}/${budget}: length ${list.length} in [3,6]`);
      for (const id of base) assert(list.includes(id), `${role}: keeps its own skill ${id}`);
    }
  }
});

Deno.test("techniquesFor is deterministic for the same spent map", () => {
  const spent = spendBudget(90, "Archer", seeded(11));
  const a = techniquesFor(spent, "Archer");
  const b = techniquesFor(spent, "Archer");
  assert(JSON.stringify(a) === JSON.stringify(b), "same spent -> same list");
});

Deno.test("stats drive the unlocked extras: reflex -> mobility, strength -> power", () => {
  const reflexHeavy: Record<StatName, number> = { vitality: 0, resilience: 0, willpower: 0, reflex: 30, strength: 0, intelligence: 0 };
  assert(techniquesFor(reflexHeavy, "Mage").includes("rogue-shadowstep"), "reflex unlocks the mobility dash");
  const strengthHeavy: Record<StatName, number> = { vitality: 0, resilience: 0, willpower: 0, reflex: 0, strength: 30, intelligence: 0 };
  assert(techniquesFor(strengthHeavy, "Mage").includes("barbarian-skullsplitter"), "strength unlocks the power strike");
  const intHeavy: Record<StatName, number> = { vitality: 0, resilience: 0, willpower: 0, reflex: 0, strength: 0, intelligence: 30 };
  assert(techniquesFor(intHeavy, "Warrior").includes("mage-arcane-nova"), "intelligence unlocks the arcane power");
});

Deno.test("a bigger budget unlocks at least as many techniques (monotonicity)", () => {
  for (const role of CLASSES) {
    for (const seed of [1, 2, 3, 400]) {
      const small = techniquesFor(spendBudget(12, role, seeded(seed)), role);
      const big = techniquesFor(spendBudget(126, role, seeded(seed)), role);
      assert(big.length >= small.length, `${role}/${seed}: ${big.length} >= ${small.length}`);
    }
  }
});

Deno.test("an unknown class falls back to a sane default rather than throwing", () => {
  const spent: Record<StatName, number> = { vitality: 5, resilience: 5, willpower: 5, reflex: 5, strength: 5, intelligence: 5 };
  const list = techniquesFor(spent, "Wizard");
  assert(list.length >= 3 && list.length <= 6, `unknown class length ${list.length} in [3,6]`);
  for (const id of list) assert(typeof id === "string" && id.length > 0, "ids are non-empty strings");
  // NaN inside the spent map must not throw either.
  const nanSpent: Record<StatName, number> = { vitality: NaN, resilience: 0, willpower: 0, reflex: 0, strength: 0, intelligence: 0 };
  assert(techniquesFor(nanSpent, "Nope").length >= 3, "NaN spent map still yields >= 3");
});

// ---------------------------------------------------------------------------
// generateSpectateCard.
// ---------------------------------------------------------------------------

Deno.test("one seed gives one card: the generator is deterministic", () => {
  for (const seed of [0, 1, 12345, 987654321]) {
    const a = generateSpectateCard(seed);
    const b = generateSpectateCard(seed);
    assert(JSON.stringify(a) === JSON.stringify(b), `seed ${seed} reproduces`);
  }
});

Deno.test("200 seeds give >= 20 distinct level pairs and >= 10 distinct arena sizes", () => {
  const pairs = new Set<string>();
  const arenas = new Set<number>();
  for (let i = 0; i < 200; i++) {
    const c = generateSpectateCard(i);
    pairs.add(`${c.levelA}-${c.levelB}`);
    arenas.add(c.arenaSize);
  }
  assert(pairs.size >= 20, `distinct level pairs = ${pairs.size}, want >= 20`);
  assert(arenas.size >= 10, `distinct arena sizes = ${arenas.size}, want >= 10`);
});

Deno.test("every field is finite and in range for 1 000 seeds", () => {
  for (let i = 0; i < 1000; i++) {
    const c = generateSpectateCard(i * 2654435761);
    for (const [k, v] of Object.entries(c)) {
      if (k === "generationId") continue;
      assert(typeof v === "number" && Number.isFinite(v), `field ${k} finite at seed ${i}`);
    }
    assert(c.levelA >= 1 && c.levelA <= 20, `levelA in range (${c.levelA})`);
    assert(c.levelB >= 1 && c.levelB <= 20, `levelB in range (${c.levelB})`);
    assert(c.arenaSize >= ARENA_SIZE_MIN && c.arenaSize <= ARENA_SIZE_MAX, `arena in [14,120] (${c.arenaSize})`);
    assert(c.budgetA === budgetForLevel(c.levelA), "budgetA is the level's budget");
    assert(c.budgetB === budgetForLevel(c.levelB), "budgetB is the level's budget");
    assert(/^GEN-[0-9A-F]{6}$/.test(c.generationId), `generationId shape (${c.generationId})`);
  }
});

Deno.test("opts.levelMin/levelMax clamp into 1..20 and both levels stay inside the band", () => {
  for (let i = 0; i < 200; i++) {
    const c = generateSpectateCard(i, { levelMin: 5, levelMax: 8 });
    assert(c.levelA >= 5 && c.levelA <= 8, `levelA inside 5..8 (${c.levelA})`);
    assert(c.levelB >= 5 && c.levelB <= 8, `levelB inside 5..8 (${c.levelB})`);
  }
  const swapped = generateSpectateCard(3, { levelMin: 15, levelMax: 4 }); // swapped ends still work
  assert(swapped.levelA >= 4 && swapped.levelA <= 15, "swapped band still yields a level in range");
});
