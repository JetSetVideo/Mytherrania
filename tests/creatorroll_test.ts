// tests/creatorroll_test.ts — lane L-B: the character generator's roll and its stat sheet.
//
// What is proven here:
//   1. a roll is LEGAL (class from CLASSES, sub-species belongs to its race, weapon is the class's
//      own weapon, birthsign from BIRTHSIGNS);
//   2. the roll is DETERMINISTIC (same seed sequence -> identical profile AND identical seed);
//   3. the roll is DIVERSE (over 200 rolls from a fixed seed sequence, all 4 races and >= 6 of the
//      8 classes appear);
//   4. the sheet is the FIGHT's maths — rows are compared against the source functions directly
//      (createStats / applyRaceBonus / applySecondary / applyLevel / attackDamage / secondaryPreview);
//   5. the module is pure (no Math.random, no DOM).
//
// Repeatable rolls reuse MathCore.rng32 (a seeded Mulberry32) and the test asserts two runs agree.

import { creatorSheet, rollProfile } from "../src/ui/CreatorRoll.ts";
import { BIRTHSIGNS } from "../src/game/Birthsight.ts";
import { rng32 } from "../src/core/MathCore.ts";
import { applyRaceBonus, RACES, raceById } from "../src/game/Races.ts";
import { applySecondary, secondaryPreview } from "../src/game/SecondaryStats.ts";
import { applyLevel, attackDamage, CLASSES, createStats } from "../src/game/Stats.ts";
import { weaponForClass } from "../src/game/Weapon.ts";
import { startingStats } from "../src/game/Leveling.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}

/** The test's own copy of the display grouping, so a row is checked against the format, not itself. */
function group(n: number): string {
  const v = Number.isFinite(n) ? Math.round(n) : 0;
  const d = String(Math.abs(v));
  let out = "";
  for (let i = 0; i < d.length; i++) {
    if (i > 0 && (d.length - i) % 3 === 0) out += " ";
    out += d[i];
  }
  return v < 0 ? `-${out}` : out;
}

Deno.test("a rolled fighter is legal: class, sub-species, weapon and birthsign", () => {
  const raceIds = new Set(RACES.map((r) => r.id));
  const signIds = new Set(BIRTHSIGNS.map((s) => s.id));
  // 200 rolls: every axis must hold for every one, not just the first.
  for (let i = 0; i < 200; i++) {
    const { profile } = rollProfile(rng32(0x5eed + i));
    assert(CLASSES.includes(profile.className), `class ${profile.className} is not in CLASSES`);
    const race = raceById(profile.race);
    assert(race !== undefined, `unknown race ${profile.race}`);
    assert(raceIds.has(profile.race), `race ${profile.race} not in RACES`);
    // The sub-species must belong to the rolled race, checked against RACES itself.
    assert(profile.subrace !== null, "a legal roll always picks a sub-species");
    const subs = race.subspecies.map((s) => s.id);
    assert(subs.includes(profile.subrace), `sub-species ${profile.subrace} does not belong to ${profile.race}`);
    assert(signIds.has(profile.birthsign ?? ""), `birthsign ${profile.birthsign} not in BIRTHSIGNS`);
    // The weapon is the class's own weapon — legal by construction.
    assert(profile.weaponType === weaponForClass(profile.className).type, "weapon is not the class's weapon");
    assert(profile.appearance.race === profile.race && profile.appearance.subrace === profile.subrace, "the model's ancestry must match the profile's");
  }
});

Deno.test("the same seed yields the same profile and the same seed (two runs agree)", () => {
  const a = rollProfile(rng32(20261031));
  const b = rollProfile(rng32(20261031));
  assert(a.seed === b.seed, `seed drifted: ${a.seed} vs ${b.seed}`);
  assert(JSON.stringify(a.profile) === JSON.stringify(b.profile), "the same seed produced a different profile");
  // A different seed must (in practice) differ somewhere, so the check is not vacuous.
  const c = rollProfile(rng32(20261032));
  assert(JSON.stringify(a.profile) !== JSON.stringify(c.profile), "two different seeds produced the same profile");
});

Deno.test("diversity: over 200 rolls, all 4 races and at least 6 of the 8 classes appear", () => {
  const races = new Set<string>();
  const classes = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const { profile } = rollProfile(rng32(1_000_000 + i));
    races.add(profile.race);
    classes.add(profile.className);
  }
  assert(races.size === 4, `only ${races.size}/4 races appeared: ${[...races].join(",")}`);
  assert(classes.size >= 6, `only ${classes.size}/8 classes appeared: ${[...classes].join(",")}`);
});

Deno.test("the sheet's numbers come from the source functions (two+ rows compared directly)", () => {
  const { profile } = rollProfile(rng32(0xabcdef));
  const sheet = creatorSheet(profile);
  // Recompute the pipeline here with the REAL imports, exactly as creatorSheet does.
  const raced = applyRaceBonus(createStats(profile.className), profile.race, profile.subrace, profile.birthsign);
  const stats = applyLevel(applySecondary(raced, profile.subrace, profile.birthsign), profile.level ?? 1);

  const row = (rows: { label: string; value: string }[], label: string) => {
    const r = rows.find((x) => x.label === label);
    assert(r !== undefined, `missing sheet row ${label}`);
    return r.value;
  };

  // Derived rows vs createStats/applyRaceBonus/applySecondary/applyLevel.
  assert(row(sheet.derived, "Max Health") === group(stats.maxHealth), `Max Health ${row(sheet.derived, "Max Health")} vs ${group(stats.maxHealth)}`);
  assert(row(sheet.derived, "Attack Power") === group(stats.attackPower), `Attack Power ${row(sheet.derived, "Attack Power")} vs ${group(stats.attackPower)}`);
  assert(row(sheet.derived, "Attack Interval") === `${stats.attackInterval.toFixed(2)} s`, "Attack Interval");
  assert(row(sheet.derived, "Armour") === stats.armor.toFixed(1), `Armour ${row(sheet.derived, "Armour")} vs ${stats.armor.toFixed(1)}`);

  // Primary rows: Wave Z shows the SHEET-scale attribute (DerivedSheet: class sheet + the modifier the
  // fight applies, fightStats[attr] − createStats(class)[attr]) — the scale the tweak inputs edit —
  // instead of the 1-10 runtime primary. Recomputed here from the source functions.
  const cls = createStats(profile.className);
  const classSheet = startingStats(profile.className, "", null).allocated;
  for (const k of ["reflex", "vitality"] as const) {
    const want = classSheet[k] + (stats[k] - cls[k]);
    const label = k === "reflex" ? "Reflex" : "Vitality";
    assert(Math.abs(Number(row(sheet.primary, label).replace("\u2212", "-")) - want) < 0.01, `${label} ${row(sheet.primary, label)} vs ${want}`);
  }

  // Secondary rows vs SecondaryStats.secondaryPreview directly.
  const preview = secondaryPreview(profile.subrace, profile.birthsign);
  for (const p of preview) assert(row(sheet.secondary, p.label) === p.text, `secondary ${p.label}`);

  // The Attack Power hint uses attackDamage against an even foe (the class baseline).
  const evenFoe = createStats(profile.className);
  const hint = sheet.derived.find((x) => x.label === "Attack Power")?.hint ?? "";
  assert(hint.includes(group(attackDamage(stats, evenFoe, 0.5, 0.5))), `hint ${hint} must carry the source damage`);

  // The header labels come from the data sources, not from the profile's raw ids.
  assert(sheet.raceLabel === raceById(profile.race)?.name, "raceLabel");
  assert(sheet.weaponLabel === weaponForClass(profile.className).name, "weaponLabel");
});

Deno.test("the sheet never hard-codes the pool size (it reads the scaled health)", () => {
  // Every class's max health is the HEALTH_SCALE-scaled pool, far above the pre-scaling 30–60.
  for (const c of CLASSES) {
    const { profile } = rollProfile(rng32(0xdead00 + CLASSES.indexOf(c)));
    profile.className = c;
    const sheet = creatorSheet(profile);
    const hp = Number(sheet.derived[0].value.replace(/ /g, ""));
    assert(hp > 10_000, `class ${c} health ${hp} looks un-scaled`);
  }
});

Deno.test("grouping: a five-digit pool reads like the stat bars' \"47 100\"", () => {
  assert(group(47100) === "47 100", group(47100));
  assert(group(1234567) === "1 234 567", group(1234567));
  assert(group(999) === "999", group(999));
});

Deno.test("CreatorRoll.ts is pure: no Math.random and no DOM", () => {
  const here = new URL("../", import.meta.url);
  const src = Deno.readTextFileSync(new URL("src/ui/CreatorRoll.ts", here));
  assert(!src.includes("Math.random("), "CreatorRoll.ts calls Math.random");
  for (const dom of ["document.", "window.", "localStorage"]) {
    assert(!src.includes(dom), `CreatorRoll.ts touches ${dom}`);
  }
});
