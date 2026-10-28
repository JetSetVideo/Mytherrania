import { HAIR_COLORS, HAIR_LENGTH_M, mixHex, nameSeed, raceBuild, RACE_BUILDS, seededPick, SKIN_TONES, SUBRACE_TWEAKS } from "../src/game/RaceAppearance.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }

Deno.test("the four races have distinct builds", () => {
  const h = raceBuild("human", null), e = raceBuild("elf", null), d = raceBuild("dwarf", null), o = raceBuild("ork", null);
  assert(e.heightMul > h.heightMul, "elves taller than humans");
  assert(d.heightMul < h.heightMul, "dwarves shorter than humans");
  assert(o.weightMul > d.weightMul && d.weightMul > h.weightMul, "orks heaviest, then dwarves");
  assert(o.underbite > 0, "orks have an underbite");
  assert(d.underbite < o.underbite, "dwarf underbite is smaller than ork");
  assert(h.underbite === 0 && e.underbite === 0, "humans and elves have no underbite");
});

Deno.test("orks have the underbite (lower teeth further than top)", () => {
  for (const [race, build] of Object.entries(RACE_BUILDS)) {
    if (race === "ork") assert(build.underbite >= 0.3, "ork underbite is pronounced");
    else assert(build.underbite < 0.3, `${race} underbite is small or none`);
  }
});

Deno.test("elves have the longest hair, dwarves and some humans beards", () => {
  assert(raceBuild("elf", null).hairLength === "verylong", "elves very long hair");
  assert(HAIR_LENGTH_M[raceBuild("elf", null).hairLength] > HAIR_LENGTH_M[raceBuild("human", null).hairLength], "elf hair longer than human");
  assert(raceBuild("dwarf", null).beard, "dwarves have beards");
  assert(raceBuild("human", null).beard, "some humans have beards");
  assert(!raceBuild("elf", null).beard, "elves are beardless");
});

Deno.test("sub-species tweaks layer onto the race build", () => {
  const high = raceBuild("elf", "high");
  assert(high.heightMul > raceBuild("elf", null).heightMul, "high elf taller tweak");
  assert(raceBuild("ork", "bloodfang").underbite > raceBuild("ork", null).underbite, "bloodfang deepens the underbite");
  // Every tweak maps to a known race build key set.
  for (const [id, t] of Object.entries(SUBRACE_TWEAKS)) {
    assert(Object.keys(t).length > 0, `subrace ${id} has a tweak`);
  }
});

Deno.test("hair and skin palettes are expanded and valid hex colours", () => {
  assert(HAIR_COLORS.length >= 10, "expanded hair colours");
  assert(SKIN_TONES.length >= 10, "expanded skin tones");
  for (const c of [...HAIR_COLORS, ...SKIN_TONES]) assert(/^#[0-9a-f]{6}$/i.test(c), `valid hex ${c}`);
});

Deno.test("seededPick is deterministic and within range", () => {
  const styles = ["a", "b", "c", "d"];
  assert(seededPick(styles, 42) === seededPick(styles, 42), "reproducible");
  assert(styles.includes(seededPick(styles, 42)), "in range");
  // Different seeds spread across the list.
  const seen = new Set([...Array(40)].map((_, i) => seededPick(styles, i)));
  assert(seen.size > 1, "spreads across the list");
});

Deno.test("mixHex blends endpoints and clamps, and nameSeed is stable", () => {
  assert(mixHex("#000000", "#ffffff", 0) === "#000000", "t=0 is the first colour");
  assert(mixHex("#000000", "#ffffff", 1) === "#ffffff", "t=1 is the second colour");
  assert(mixHex("#000000", "#ffffff", 0.5) === "#808080", "t=0.5 is the midpoint");
  assert(mixHex("#000000", "#ffffff", -5) === "#000000", "clamped below");
  assert(mixHex("#000000", "#ffffff", 9) === "#ffffff", "clamped above");
  assert(nameSeed("Halric") === nameSeed("Halric"), "same name, same seed");
  assert(nameSeed("Halric") !== nameSeed("Tova"), "different names differ");
});
