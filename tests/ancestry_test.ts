// The ancestry hierarchy: completeness of the 16 nodes, the strict 1..4 race ranking, the
// ordering facts the look depends on, and the seeded hair mass. Reads the same data the rig does.
import {
  ANCESTRY,
  ancestryOf,
  compareAncestry,
  hairMassKg,
  METRICS,
  RACE_IDS,
  rankOf,
  STATURES,
  type AncestryNode,
} from "../src/game/Ancestry.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

const RACES = ["human", "elf", "dwarf", "ork"] as const;
const SUBRACES = [
  "imperial", "nomad", "islander",
  "high", "wood", "dark",
  "mountain", "forge", "deep",
  "greenhide", "ironhide", "bloodfang",
] as const;

const hexCh = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
const rgb = (hex: string) => [hexCh(hex, 0), hexCh(hex, 1), hexCh(hex, 2)] as const;
/** Perceptual luminance of a #rrggbb, 0..255. */
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

Deno.test("(a) ANCESTRY holds 16 nodes: 4 race nodes + 12 subrace nodes", () => {
  assert(Object.keys(ANCESTRY).length === 16, `expected 16 nodes, got ${Object.keys(ANCESTRY).length}`);
  assert(RACE_IDS.join(",") === RACES.join(","), "the module's race walk order matches the test's");
  for (const r of RACES) {
    const n = ANCESTRY[r];
    assert(!!n, `missing race node ${r}`);
    assert(n.parent === null && n.race === r, `${r} must be a root race node`);
  }
  for (const s of SUBRACES) {
    const n = ANCESTRY[s];
    assert(!!n, `missing subrace node ${s}`);
    assert(n.parent !== null && (RACES as readonly string[]).includes(n.race), `${s} must name a parent race`);
  }
});

Deno.test("(b) every node ranks all 13 metrics and carries all 8 spec blocks, finite", () => {
  for (const [id, n] of Object.entries(ANCESTRY)) {
    for (const m of METRICS) {
      const r = n.ranks[m];
      assert(Number.isInteger(r) && r >= 1 && r <= 4, `${id}.ranks.${m} = ${r} must be 1..4`);
    }
    const nums: number[] = [
      n.skin.creaseStrength,
      n.hair.curl, n.hair.density, n.hair.baldChance,
      n.brow.length, n.brow.thickness, n.brow.prominence, n.brow.tipPastFace,
      n.beard.coverage, n.beard.lengthMul,
      n.tusk.protrusion,
      n.ears.lengthMul, n.ears.pointed, n.ears.droop,
      n.skull.massMul, n.skull.browRidge, n.skull.jawWidth,
      n.hairPhysics.massKg, n.hairPhysics.stiffness, n.hairPhysics.damp, n.hairPhysics.windGain,
    ];
    for (const v of nums) assert(Number.isFinite(v), `${id} has a non-finite spec number (${v})`);
    assert(typeof n.skin.base === "string" && n.skin.range.length >= 3, `${id} skin range too short`);
    assert(n.hair.colors.length >= 3 && n.hair.colors.length <= 6, `${id} hair colours out of 3..6`);
    assert(n.hair.styles.length > 0, `${id} needs at least one hair style`);
    assert(n.lore.length > 0, `${id} needs lore`);
  }
});

Deno.test("(c) the four race nodes hold ranks 1..4 exactly once for every metric", () => {
  for (const m of METRICS) {
    const ranks = RACES.map((r) => ANCESTRY[r].ranks[m]);
    assert(
      new Set(ranks).size === 4 && ranks.every((r) => r >= 1 && r <= 4),
      `metric ${m} has ranks ${ranks}, not a strict 1..4 ordering`,
    );
  }
});

Deno.test("(d) the ordering facts: height, breadth, mass, beard, brow, baldness, tusks, ears, skull", () => {
  const own = (id: string) => ANCESTRY[id];
  // Height: elf tallest, ork, human, dwarf shortest.
  assert(own("elf").ranks.height === 1 && own("dwarf").ranks.height === 4, "elf 1 / dwarf 4 in height");
  assert(own("ork").ranks.height === 2 && own("human").ranks.height === 3, "ork 2 / human 3 in height");
  // Shoulders: dwarf widest, elf narrowest.
  assert(own("dwarf").ranks.shoulderWidth === 1 && own("elf").ranks.shoulderWidth === 4, "dwarf widest, elf narrowest");
  // Torso mass: dwarf heaviest.
  assert(own("dwarf").ranks.torsoMass === 1, "dwarf carries the most torso mass");
  // Beard contract.
  assert(own("human").beard.allowed === true, "humans may grow a beard");
  assert(own("dwarf").beard.required === true, "dwarves always grow a beard");
  assert(own("ork").beard.mode === "chin", "orks grow chin-only");
  assert(own("elf").beard.mode === "moustache-thin" && own("elf").beard.allowed === true && own("elf").beard.required === false,
    "elves: a thin moustache at most, never required");
  // Brows.
  assert(own("dwarf").ranks.browProminence === 1 && own("ork").ranks.browProminence === 4, "dwarf biggest brows, ork shortest");
  const elfTip = own("elf").brow.tipPastFace;
  for (const r of RACES) {
    if (r === "elf") continue;
    assert(elfTip > own(r).brow.tipPastFace, `elf brow tips must run past the face more than ${r}'s`);
  }
  // Baldness.
  assert(own("elf").hair.baldChance === 0, "no bald elves");
  const orkBald = own("ork").hair.baldChance;
  for (const r of RACES) {
    if (r === "ork") continue;
    assert(orkBald > own(r).hair.baldChance, `orks must be balder than ${r}s`);
  }
  // Tusks.
  assert(own("ork").tusk.count === 2 && own("ork").tusk.direction === "up" && own("ork").ranks.tuskProtrusion === 1,
    "orks carry two upward tusks, the most protrusion");
  // Ears.
  const elfPoint = own("elf").ears.pointed;
  for (const r of RACES) {
    if (r === "elf") continue;
    assert(elfPoint > own(r).ears.pointed, `elf ears must be more pointed than ${r}'s`);
  }
  // Skull: dwarf and ork both heavier-skulled than human and elf.
  for (const big of ["dwarf", "ork"] as const) {
    assert(own(big).skull.massMul > own("human").skull.massMul, `${big} skull heavier than human`);
    assert(own(big).skull.massMul > own("elf").skull.massMul, `${big} skull heavier than elf`);
  }
});

Deno.test("(e) skin: the elf crease is the most blue-shifted, and the ranges read as the brief says", () => {
  const blueness = (hex: string) => rgb(hex)[2] - rgb(hex)[0];
  const elfB = blueness(ANCESTRY.elf.skin.crease);
  for (const r of RACES) {
    if (r === "elf") continue;
    assert(elfB > blueness(ANCESTRY[r].skin.crease), `elf crease must be bluer than ${r}'s`);
  }
  const zones = ANCESTRY.elf.skin.zones;
  assert(zones.includes("under-eye") && zones.includes("cheek-fold"), "elf creases read under the eye and cheek");

  // Ork skin: at least one purple and at least two greens.
  const isGreen = (h: string) => { const [r, g, b] = rgb(h); return g > r && g > b; };
  const isPurple = (h: string) => { const [r, g, b] = rgb(h); return b > g && r > g; };
  const ork = ANCESTRY.ork.skin.range;
  assert(ork.some(isPurple), "ork hide holds a purple");
  assert(ork.filter(isGreen).length >= 2, "ork hide holds at least two greens");

  // Human skin: reddish-brown through to pale.
  const human = ANCESTRY.human.skin.range;
  const [r0, g0, b0] = rgb(human[0]);
  assert(r0 > g0 && g0 > b0, `human's first tone must be reddish-brown, got ${human[0]}`);
  assert(lum(human[human.length - 1]) > 180, "human's range must reach pale");
});

Deno.test("(f) hair colours: elf blue-green to ginger, human dark to blond", () => {
  const elf = ANCESTRY.elf.hair.colors;
  const isBlueGreen = (h: string) => { const [r, g, b] = rgb(h); return b > r && g > r; };
  const isGinger = (h: string) => { const [r, g, b] = rgb(h); return r > g && g > b && r > 120 && b < 100; };
  assert(elf.some(isBlueGreen), "elf hair holds a blue-green");
  assert(elf.some(isGinger), "elf hair holds a ginger/copper");

  const human = ANCESTRY.human.hair.colors;
  const lums = human.map(lum);
  assert(Math.min(...lums) < 60, "human hair reaches dark");
  assert(Math.max(...lums) > 150, "human hair reaches blond");
});

Deno.test("(g) ancestryOf merges the subrace over its race and never throws", () => {
  const high = ancestryOf("elf", "high");
  assert(high.name === ANCESTRY.high.name, "the subrace name wins");
  assert(high.id === "high" && high.race === "elf", "merged node keeps the subrace identity");
  assert(high.hair.length === ANCESTRY.high.hair.length, "merged fields come from the subrace");
  assert(high.skull.massMul === ANCESTRY.high.skull.massMul, "and every spec block is merged");

  const plain = ancestryOf("elf", null);
  assert(plain.id === "elf" && plain.name === ANCESTRY.elf.name, "a null subrace returns the race node");

  const fallback = ancestryOf("elf", "nope");
  assert(fallback.id === "elf", "an unknown subrace falls back to the race node");
  // A subrace from ANOTHER race must not be borrowed either.
  assert(ancestryOf("elf", "mountain").id === "elf", "a foreign subrace falls back too");
});

Deno.test("(h) rankOf returns the four races most-first with no duplicate ranks", () => {
  for (const m of METRICS) {
    const rows = rankOf(m);
    assert(rows.length === 4, `${m}: 4 races`);
    assert(new Set(rows.map((r) => r.rank)).size === 4, `${m}: ranks are unique`);
    for (let i = 1; i < rows.length; i++) assert(rows[i].rank > rows[i - 1].rank, `${m}: ordered by rank`);
  }
  const h = rankOf("height").map((r) => r.id);
  assert(h.join(",") === "elf,ork,human,dwarf", `height order most-first should be elf,ork,human,dwarf, got ${h.join(",")}`);
});

Deno.test("(i) compareAncestry signs a minus b on the race ordering", () => {
  const e = compareAncestry("elf", "dwarf");
  assert(e.height === 1, `elf is taller than dwarf (${e.height})`);
  assert(e.shoulderWidth === -1, `elf is narrower than dwarf (${e.shoulderWidth})`);
  const d = compareAncestry("dwarf", "elf");
  assert(d.height === -1 && d.shoulderWidth === 1, "the comparison reverses with the arguments");
  assert(compareAncestry("human", "human").height === 0, "a race against itself is 0");
});

Deno.test("(j) hairMassKg is monotone in length and curl, seed-stable and never NaN", () => {
  const mass = (race: string, sub: string | null, seed = 1234) => hairMassKg(race, sub, seed);

  // Length order across the race defaults: elf > human > ork > dwarf.
  const elf = mass("elf", null), human = mass("human", null), ork = mass("ork", null), dwarf = mass("dwarf", null);
  assert(elf > human && human > ork && ork > dwarf,
    `expected elf > human > ork > dwarf, got ${elf.toFixed(4)} ${human.toFixed(4)} ${ork.toFixed(4)} ${dwarf.toFixed(4)}`);

  // A longer-haired subrace carries more than a shorter one of the same race (verylong > long).
  assert(mass("elf", "high") > mass("elf", "dark"), "high (verylong) > dark (long)");

  // Curl adds mass at the same length (both medium humans): nomad curly, imperial straight.
  assert(mass("human", "nomad") > mass("human", "imperial"), "curlier nomad outweighs straighter imperial");

  // Seed-stable: the same seed reproduces the value exactly.
  assert(mass("elf", "high", 7) === mass("elf", "high", 7), "same seed, same mass");
  assert(mass("elf", "high", 7) !== mass("elf", "high", 8), "a different seed jitters the mass");

  // Never NaN for any of the 16 nodes x 50 seeds.
  for (const id of Object.keys(ANCESTRY)) {
    for (let s = 0; s < 50; s++) {
      const v = hairMassKg(id, null, s * 7919 + 1);
      assert(Number.isFinite(v) && v >= 0, `${id} seed ${s}: ${v}`);
    }
  }

  // The programme constant the JSON is quoted at: the massKg field rides the length ladder.
  const ladder: Record<AncestryNode["hair"]["length"], number> = {
    bald: 0, short: 0.05, medium: 0.15, long: 0.40, verylong: 0.70,
  };
  for (const [, n] of Object.entries(ANCESTRY)) {
    assert(Math.abs(n.hairPhysics.massKg - ladder[n.hair.length]) < 1e-9,
      `${n.id} massKg ${n.hairPhysics.massKg} must match its ${n.hair.length} tier`);
  }
  assert(STATURES.dwarf < STATURES.ork, "the dwarf's smaller stature is what keeps its hair lighter than an ork's");
});

Deno.test("subrace rank rule: copy the parent, shift at most two metrics by +/-1 within [1,4]", () => {
  for (const [id, n] of Object.entries(ANCESTRY)) {
    if (n.parent === null) continue;
    const base = ANCESTRY[n.race].ranks;
    const moved = METRICS.filter((m) => n.ranks[m] !== base[m]);
    assert(moved.length <= 2, `${id} shifted ${moved.length} metrics (max 2): ${moved.join(",")}`);
    for (const m of moved) {
      assert(Math.abs(n.ranks[m] - base[m]) === 1, `${id}.${m} must move by exactly 1`);
      assert(n.ranks[m] >= 1 && n.ranks[m] <= 4, `${id}.${m} must stay in 1..4`);
    }
  }
});
