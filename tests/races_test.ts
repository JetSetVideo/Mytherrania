import { RACES, raceBonus, computeRaceStats, raceById, raceCombatDelta, applyRaceBonus } from "../src/game/Races.ts";
import { CLASSES, createStats, DAMAGE_SCALE, HEALTH_SCALE } from "../src/game/Stats.ts";

function assert(ok: unknown, msg: string): asserts ok { if (!ok) throw new Error(msg); }

Deno.test("four base races defined", () => {
  assert(RACES.length === 4, "four base races");
  assert(RACES[0].id === "human", "first race is human");
  assert(RACES[3].id === "ork", "last race is ork");
  assert(raceById("elf")!.name === "Elf", "lookup works");
});

Deno.test("every race has three subspecies", () => {
  for (const r of RACES) assert(r.subspecies.length === 3, `${r.id} has 3 subspecies`);
});

Deno.test("human is balanced with +1 all mods", () => {
  const h = raceById("human")!;
  for (const k of ["vitality","resilience","focus","reflex","strength","intelligence", "agility"])
    assert((h.mods as Record<string,number>)[k] === 1, `human ${k} mod is 1`);
});

Deno.test("ork has correct stat modifiers", () => {
  const o = raceById("ork")!;
  assert(o.mods.vitality === 3, "ork vitality +3");
  assert(o.mods.strength === 3, "ork strength +3");
  assert(o.mods.intelligence === -2, "ork intelligence -2");
});

Deno.test("subrace tweaks stack with race mods", () => {
  const o = raceById("ork")!;
  const ironhide = o.subspecies.find(s => s.id === "ironhide")!;
  const b = raceBonus(o, ironhide);
  assert(b.vitality === 3, "ironhide vitality = ork base 3");
  assert(b.strength === 4, "ironhide strength = ork 3 + ironhide 1");
  assert(b.resilience === 2, "ironhide resilience = ironhide +2");
  assert(b.intelligence === -4, "ironhide int = -2 + -2");
});

Deno.test("elf wood subrace doubles strength penalty", () => {
  const wood = raceById("elf")!.subspecies.find(s => s.id === "wood")!;
  const bw = raceBonus(raceById("elf")!, wood);
  assert(bw.strength === -2, "wood elf strength = elf -1 + wood -1 = -2");
});

Deno.test("stat ranges are well-ordered", () => {
  for (const r of RACES) {
    const s = computeRaceStats(r, null);
    for (const stat of ["vitality","resilience","focus","reflex","strength","intelligence", "agility"]) {
      const v = (s as unknown as Record<string, {min:number,max:number,avg:number,median:number}>)[stat];
      assert(v.min > 0, `${r.id} ${stat} min positive`);
      assert(v.max >= v.min, `${r.id} ${stat} max>=min`);
      assert(v.avg >= v.min && v.avg <= v.max, `${r.id} ${stat} avg within bounds`);
      assert(v.median >= v.min && v.median <= v.max, `${r.id} ${stat} median within bounds`);
    }
  }
});

Deno.test("race deltas are additive and reflex makes you faster", () => {
  const base = createStats("Warrior");
  const ork = applyRaceBonus(base, "ork", "ironhide");
  // A delta must ADD to the class base, never replace it.
  assert(ork.maxHealth > base.maxHealth, `ork HP ${ork.maxHealth} must exceed base ${base.maxHealth}`);
  assert(ork.attackPower >= base.attackPower, "ork hits at least as hard");
  assert(ork.armor > base.armor, "ironhide adds armor");
  const woodElf = applyRaceBonus(base, "elf", "wood");
  assert(woodElf.attackInterval < base.attackInterval, `wood elf must be FASTER: ${woodElf.attackInterval} < ${base.attackInterval}`);
  assert(woodElf.reflex > base.reflex, "reflex delta applies");
  // Inverse: a negative delta lowers the stat.
  const dwarf = applyRaceBonus(base, "dwarf", null);
  assert(dwarf.reflex < base.reflex, "dwarf is slower to react");
  // Every race stays inside the clamp window so no race can break the arena. The
  // window is expressed through the same scale constants the class stats use, so it
  // cannot silently drift back to the old absolutes when the scale changes.
  for (const r of RACES) for (const sub of [null, r.subspecies[0].id]) {
    const s = applyRaceBonus(base, r.id, sub);
    assert(s.maxHealth >= 30 * HEALTH_SCALE && s.maxHealth <= 60 * HEALTH_SCALE, `${r.id} HP clamp (${s.maxHealth})`);
    assert(s.attackPower >= 5 * DAMAGE_SCALE && s.attackPower <= 14 * DAMAGE_SCALE, `${r.id} power clamp (${s.attackPower})`);
    assert(s.attackInterval >= 0.5 && s.attackInterval <= 1.5, `${r.id} interval clamp`);
  }
  // The delta function must not leak absolute class values: a race adds a few
  // percent of the pool (in the same HEALTH_SCALE units), never a whole stat line.
  const humanDelta = raceCombatDelta("human", null).maxHealth!;
  assert(humanDelta > 0 && humanDelta <= base.maxHealth * 0.1, `human delta ${humanDelta} should be a small share of ${base.maxHealth}`);
});

Deno.test("a race or birthsign delta is in HEALTH_SCALE units — it actually moves the pool", () => {
  // Regression: deltas were unscaled (+2 HP on a ~48 750 HP pool), so race choice
  // changed nothing but crit and birthsigns were never applied at all.
  const base = createStats("Warrior");
  const ork = applyRaceBonus(base, "ork", null);
  assert(ork.maxHealth - base.maxHealth >= 2 * HEALTH_SCALE, `ork must add thousands of HP, added ${ork.maxHealth - base.maxHealth}`);
  const mountain = applyRaceBonus(base, "human", null, "mountain");
  const plain = applyRaceBonus(base, "human", null);
  assert(mountain.resilience === plain.resilience + 3, "The Mountain adds +3 resilience");
  assert(mountain.armor > plain.armor, "and that resilience becomes armour");
});
Deno.test("a race bonus never squashes the scaled health pool back to the old band", () => {
  // Regression: applyRaceBonus clamped to the pre-scaling absolutes (30..60 HP,
  // 5..14 damage), so every fighter silently dropped to 60 HP the moment a race was
  // applied — while the unit tests on createStats alone still passed.
  const races = ["human", "elf", "dwarf", "ork"];
  const subs = [null, "imperial", "wood", "hill", "high"];
  for (const cls of CLASSES) {
    const base = createStats(cls);
    for (const r of races) {
      for (const sub of subs) {
        const out = applyRaceBonus(base, r, sub);
        // Health must stay within the same order of magnitude as the class base.
        assert(
          out.maxHealth >= base.maxHealth * 0.5 && out.maxHealth <= base.maxHealth * 1.6,
          `${cls}/${r}/${sub}: health ${out.maxHealth} left the band around ${base.maxHealth}`,
        );
        assert(out.attackPower > 20, `${cls}/${r}/${sub}: damage ${out.attackPower} looks like the old band`);
        // And the derived stats must still differ between classes.
        assert(out.armor >= 1 && out.armor <= 8, `${cls}/${r}/${sub}: armor ${out.armor} out of range`);
      }
    }
  }
  // Different classes must not collapse to the same health.
  const hp = new Set(CLASSES.map((c) => applyRaceBonus(createStats(c), "human", null).maxHealth));
  assert(hp.size >= 6, `race-modified health collapsed to ${hp.size} distinct values`);
});
