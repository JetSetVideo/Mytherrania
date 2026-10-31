// Wave J (lane J-B): race resource ordering, the lowered mana regen, and the level/gear inputs.
import { RACES, raceAffinity, applyRaceBonus } from "../src/game/Races.ts";
import { applySecondary } from "../src/game/SecondaryStats.ts";
import { applyLevel, CLASSES, createStats, LEVEL_CAP, levelScale, type ClassName, type CombatStats } from "../src/game/Stats.ts";
import { createResources, LEGACY_MANA_REGEN, resourceRates } from "../src/game/Resources.ts";
import { MAX_LEVEL } from "../src/game/SpectateGen.ts";
import { buildFighter, leanAllocation } from "../src/balance/FighterBuild.ts";
import { WAVE_J_RULES } from "../src/balance/MatchRules.ts";
import type { FighterSpec } from "../src/game/arena/contracts.ts";

function assert(ok: unknown, msg: string): asserts ok { if (!ok) throw new Error(msg); }

/** Race means over the three sub-races, at one class / level / gear (the brief's "for the race"). */
function raceMeans(cls: ClassName, level: number, statFraction: number, gear: number) {
  const out: Record<string, { mana: number; stamina: number; hp: number; manaMax: number }> = {};
  for (const r of RACES) {
    const acc = { mana: 0, stamina: 0, hp: 0, manaMax: 0 };
    for (const sub of r.subspecies) {
      const spec: FighterSpec = {
        name: "t", race: r.id, subrace: sub.id, className: cls, birthsign: null, level,
        allocated: leanAllocation(cls, level, statFraction), weapon: { type: "", seed: 1, quality: gear },
        strategy: "none", aiLevel: 0,
      };
      const b = buildFighter(spec, WAVE_J_RULES);
      acc.mana += b.resources.mana.regenPerSecond / 3;
      acc.stamina += b.resources.stamina.regenPerSecond / 3;
      acc.hp += b.stats.maxHealth / 3;
      acc.manaMax += b.resources.mana.max / 3;
    }
    out[r.id] = acc;
  }
  return out;
}

const ORDER = {
  mana: ["elf", "human", "ork", "dwarf"],
  stamina: ["dwarf", "ork", "human", "elf"],
  hp: ["ork", "dwarf", "human", "elf"],
} as const;

Deno.test("J-B R1: race orderings hold for every class, at level 1/no stats/worn gear and level 20/max stats/best gear", () => {
  for (const cls of CLASSES) {
    for (const [level, frac, gear] of [[1, 0, 0], [20, 1, 1], [10, 0.5, 0.5]] as const) {
      const m = raceMeans(cls, level, frac, gear);
      for (const [key, order] of Object.entries(ORDER) as [keyof typeof ORDER, readonly string[]][]) {
        for (let i = 0; i + 1 < order.length; i++) {
          const a = m[order[i]][key], b = m[order[i + 1]][key];
          assert(a > b, `${cls} L${level} ${key}: ${order[i]} ${a.toFixed(3)} must exceed ${order[i + 1]} ${b.toFixed(3)}`);
        }
      }
    }
  }
});

Deno.test("J-B R2: the ordering comes from race physiology, and sub-races still move individuals", () => {
  // Human is the neutral physiology; an unknown race reads as human.
  const h = raceAffinity("human", null), u = raceAffinity("nope", "nope");
  assert(h.health === 1 && h.manaFlow === 1 && h.endurance === 1, "human physiology is neutral");
  assert(u.health === 1 && u.manaFlow === 1 && u.endurance === 1, "unknown ancestry is neutral");
  for (const r of RACES) {
    const regens = new Set(r.subspecies.map((s) => {
      const st = applySecondary(applyRaceBonus(createStats("Warrior"), r.id, s.id), s.id, null);
      return resourceRates(st, { race: r.id, subrace: s.id }).manaRegen.toFixed(4);
    }));
    assert(regens.size >= 2, `${r.id}: sub-races must not all share one mana regen (${[...regens]})`);
  }
  // Gear moves an individual too.
  const st = createStats("Mage");
  assert(resourceRates(st, { gear: 1 }).manaRegen > resourceRates(st, { gear: 0 }).manaRegen, "better gear regenerates faster");
});

Deno.test("J-B R3: mana regen is below the legacy 3/s for every build and refills from empty in 30–165 s (1/6 to 11/12 of the 180 s limit)", () => {
  let lo = Infinity, hi = -Infinity;
  for (const r of RACES) for (const s of r.subspecies) for (const cls of CLASSES) for (const gear of [0, 1]) {
    const stats = applySecondary(applyRaceBonus(createStats(cls), r.id, s.id), s.id, null);
    const res = createResources(stats, { race: r.id, subrace: s.id, gear });
    assert(res.mana.regenPerSecond < LEGACY_MANA_REGEN, `${r.id}/${s.id} ${cls}: ${res.mana.regenPerSecond} /s must be under the legacy ${LEGACY_MANA_REGEN}`);
    const refill = res.mana.max / res.mana.regenPerSecond;
    lo = Math.min(lo, refill); hi = Math.max(hi, refill);
    assert(refill >= 30 && refill <= 165, `${r.id}/${s.id} ${cls} gear ${gear}: refill ${refill.toFixed(0)} s outside 30–165 s`);
  }
  assert(hi > lo, "refill times differ across builds");
  // The documented anchor: a human Warrior (WIL 5 after the human +1) at 1.2 /s.
  const w = createResources(applyRaceBonus(createStats("Warrior"), "human", null), { race: "human" });
  assert(Math.abs(w.mana.regenPerSecond - 1.2) < 1e-9, `human warrior regen ${w.mana.regenPerSecond}`);
});

Deno.test("J-B R4: a level grows health and power 3 %/level, clamped to the spectator level cap", () => {
  assert(LEVEL_CAP === MAX_LEVEL, "Stats.LEVEL_CAP mirrors SpectateGen.MAX_LEVEL");
  assert(levelScale(1) === 1 && Math.abs(levelScale(20) - 1.57) < 1e-12, "1 -> 1.00, 20 -> 1.57");
  assert(levelScale(99) === levelScale(20) && levelScale(-5) === 1 && levelScale(NaN) === 1, "clamped and total");
  const base: CombatStats = createStats("Rogue");
  const l1 = applyLevel(base, 1), l20 = applyLevel(base, 20);
  assert(l1.maxHealth === base.maxHealth && l1.attackPower === base.attackPower, "level 1 is the identity");
  assert(l20.maxHealth > base.maxHealth * 1.5 && l20.attackPower > base.attackPower * 1.5, "level 20 is much stronger");
  assert(l20.attackInterval === base.attackInterval && l20.armor === base.armor, "only the pools scale");
});
