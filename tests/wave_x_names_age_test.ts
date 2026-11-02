import { familyName, generateName, givenName, PHONOLOGY, phonologyFor } from "../src/game/NameGen.ts";
import { ageBounds, greyFraction, lifeStage, rollAge } from "../src/game/Age.ts";
import { seededRng } from "../src/game/Items.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const SUBS: Record<string, string[]> = {
  human: ["imperial", "nomad", "islander"], elf: ["high", "wood", "dark"],
  dwarf: ["mountain", "forge", "deep"], ork: ["greenhide", "ironhide", "bloodfang"],
};

Deno.test("SPEC X1: every sub-race has its own phonology and the same seed gives the same name", () => {
  for (const [race, subs] of Object.entries(SUBS)) for (const sub of subs) {
    assert(PHONOLOGY[sub], `${sub} has a phonology`);
    const a = generateName(seededRng(7), race, sub, "female");
    const b = generateName(seededRng(7), race, sub, "female");
    assert(a === b && a.length >= 3, `${race}/${sub}: ${a} vs ${b}`);
  }
  assert(phonologyFor("nope", null) === PHONOLOGY.imperial, "unknown falls back to Imperial");
  assert(phonologyFor("dwarf", null) === PHONOLOGY.mountain, "race without sub-race speaks its first");
});

Deno.test("SPEC X1: names are well formed (capitalised, no tripled letter, no stray apostrophe)", () => {
  for (const [race, subs] of Object.entries(SUBS)) for (const sub of subs) for (let s = 0; s < 200; s++) {
    const rng = seededRng(s * 13 + 1);
    const n = givenName(rng, race, sub, s % 2 ? "male" : "female");
    assert(/^[A-Z]/.test(n), `${sub}: capitalised ${n}`);
    assert(!/(.)\1\1/.test(n), `${sub}: tripled letter in ${n}`);
    assert(!/^'|'$/.test(n), `${sub}: apostrophe at an edge in ${n}`);
    assert(n.length <= 16, `${sub}: ${n} too long`);
  }
});

Deno.test("SPEC X1: sub-races are distinguishable — few name collisions across ancestries", () => {
  const sets = new Map<string, Set<string>>();
  for (const subs of Object.values(SUBS)) for (const sub of subs) {
    const set = new Set<string>();
    const race = Object.entries(SUBS).find(([, v]) => v.includes(sub))![0];
    for (let s = 0; s < 300; s++) set.add(givenName(seededRng(s + 1), race, sub, "male"));
    sets.set(sub, set);
    assert(set.size >= 60, `${sub}: only ${set.size} distinct names in 300 draws`);
  }
  const keys = [...sets.keys()];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const A = sets.get(keys[i])!, B = sets.get(keys[j])!;
    const shared = [...A].filter((x) => B.has(x)).length;
    assert(shared / Math.min(A.size, B.size) < 0.05, `${keys[i]} vs ${keys[j]} share ${shared}`);
  }
});

Deno.test("family names follow the ancestry's custom", () => {
  const r = seededRng(3);
  assert(familyName(r, "elf", "high").startsWith("of House "), "an elf house");
  const ork = Array.from({ length: 40 }, (_, s) => generateName(seededRng(s), "ork", "greenhide", "male"));
  assert(ork.some((n) => n.includes(" of the ")) && ork.some((n) => !n.includes(" ")), "orks: sometimes a war-band, sometimes just a name");
});

Deno.test("SPEC X2: age is relative to the race's lifespan; elders grey, elves late and silver", () => {
  assert(lifeStage("human", 70) === "elder" && lifeStage("elf", 70) === "young", "70 years is old for a human only");
  assert(greyFraction("human", 25) === 0, "no grey at 25");
  assert(greyFraction("human", 75) > 0.6, "a human elder is mostly grey");
  assert(greyFraction("elf", 600) < greyFraction("human", 75), "elves silver less");
  assert(greyFraction("ork", Number.NaN) === 0, "non-finite age reads as a young adult");
  for (const race of Object.keys(SUBS)) {
    const { min, max } = ageBounds(race);
    const rng = seededRng(11);
    let elders = 0;
    for (let i = 0; i < 400; i++) {
      const a = rollAge(rng, race);
      assert(a >= min && a <= max, `${race}: ${a} in [${min},${max}]`);
      if (lifeStage(race, a) === "elder") elders++;
    }
    assert(elders > 20 && elders < 90, `${race}: elders ${elders}/400`);
  }
});
