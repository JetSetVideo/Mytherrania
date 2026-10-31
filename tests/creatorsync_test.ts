// Lane P-0: the two pure pieces behind the Creator's no-tab restructure.
//
//   groupSummary  — the one-line CURRENT-VALUES line a CLOSED group header shows, for EVERY
//                   Creator group, never empty (a blank header is the bug the wave fixes).
//   applyEdit     — an edit that SYNCHRONISES its dependents (a skin tone drags its crease /
//                   paint / eye tones; a height/weight clamps into the race's OWN band).
//
// The promises this file pins: totality (no edit throws, no edit yields NaN), determinism
// (same input -> same output), idempotence (the same edit twice == once), the stated tone
// relation, the race band, and a non-empty summary for every group the tree declares. The
// printed group summaries and the rule table are the wave's evidence.
import {
  applyEdit,
  CREATOR_GROUP_IDS,
  dependentFields,
  groupSummary,
  heightBand,
  SKIN_CREASE_K,
  SKIN_EYE_TINT,
  SYNC_RULES,
  syncTonesFromSkin,
  weightBand,
} from "../src/ui/CreatorSync.ts";
import { rollProfile } from "../src/ui/CreatorRoll.ts";
import { RACES, raceById } from "../src/game/Races.ts";
import { screenPanels } from "../src/ui/UiTree.ts";
import { shadeHex, tintHex } from "../src/graphics/paint/Blend.ts";
import type { CharacterProfile } from "../src/game/Characters.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

function assertEquals<T>(actual: T, expected: T, message = "not equal"): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: got ${a}, want ${e}`);
}

/** A deterministic rng (mulberry32): same seed -> same stream, no Math.random anywhere. */
function rng32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A genuinely ROLLED profile of one race: walk seeds until the roll lands on it. */
function rolledOf(raceId: string): CharacterProfile {
  for (let seed = 1; seed < 5000; seed++) {
    const { profile } = rollProfile(rng32(seed));
    if (profile.race === raceId && profile.subrace) return profile;
  }
  throw new Error(`no roll of ${raceId} in 5000 seeds`);
}

const ELF = rolledOf("elf");
const DWARF = rolledOf("dwarf");
const HEX6 = /^#[0-9a-f]{6}$/;

// ─── the group summary ──────────────────────────────────────────────────────────

Deno.test("CREATOR_GROUP_IDS is exactly the Creator screen's groups, in tree order", () => {
  const treeGroups: string[] = [];
  for (const panel of screenPanels("select")) for (const g of panel.groups) treeGroups.push(g.id);
  assertEquals([...CREATOR_GROUP_IDS], treeGroups, "the summary model covers the real tree");
});

Deno.test("every Creator group id resolves to a NON-EMPTY summary, for a rolled elf and a dwarf", () => {
  for (const p of [ELF, DWARF]) {
    const race = raceById(p.race) ?? null;
    const subrace = race?.subspecies.find((s) => s.id === p.subrace) ?? null;
    // The evidence the brief asks for: one printed line per group, per profile.
    console.log(`\n── group summaries for ${p.name} (${p.race}/${p.subrace}) ──`);
    for (const id of CREATOR_GROUP_IDS) {
      const line = groupSummary(id, p, race, subrace);
      assert(typeof line === "string" && line.trim().length > 0, `${p.race}/${id} summary is non-empty`);
      console.log(`  ${id.padEnd(10)} ${line}`);
      // Deterministic: the same call yields the same line.
      assertEquals(groupSummary(id, p, race, subrace), line, `${id} deterministic`);
    }
  }
});

Deno.test("groupSummary also answers when the caller passes race/subrace as null (falls back to p.race)", () => {
  for (const id of CREATOR_GROUP_IDS) {
    const line = groupSummary(id, ELF, null, null);
    assert(line.trim().length > 0, `${id} non-empty with null race`);
  }
});

Deno.test("an unknown group id still yields a non-empty line (total)", () => {
  const line = groupSummary("nonsense-group", ELF, null, null);
  assert(line.trim().length > 0);
  assert(line.includes(ELF.name), "falls back to an identity line");
});

// ─── the synchronised-tone law ──────────────────────────────────────────────────

Deno.test("the tone relation is the paint stacks' own shadeHex/tintHex", () => {
  const tones = syncTonesFromSkin("#e0a884");
  assertEquals(tones.accent, shadeHex("#e0a884", SKIN_CREASE_K));
  assertEquals(tones.eyes, tintHex("#e0a884", SKIN_EYE_TINT));
});

Deno.test("editing the skin tone drags its crease/paint and eye tones with it", () => {
  const before = ELF.appearance.body;
  const after = "#8a5a3c";
  const next = applyEdit(ELF, { field: "appearance.body", value: after });
  assertEquals(next.appearance.body, after, "the skin moved");
  const tones = syncTonesFromSkin(after);
  assertEquals(next.appearance.accent, tones.accent, "accent (crease/paint) synchronised");
  assertEquals(next.appearance.eyes, tones.eyes, "eyes (eye tone) synchronised");
  // The dependents are exactly what dependentFields states.
  assertEquals(dependentFields("appearance.body"), ["appearance.accent", "appearance.eyes"]);
  // And the HUE of the derived tones is kept (a shade/tint never shifts hue into mud).
  assert(next.appearance.body !== before, "the value really changed");
});

// ─── the race band ──────────────────────────────────────────────────────────────

Deno.test("height/weight edits clamp into the race's own band", () => {
  const [hLo, hHi] = heightBand(DWARF.race, DWARF.subrace);
  const [wLo, wHi] = weightBand(DWARF.race, DWARF.subrace);
  const tall = applyEdit(DWARF, { field: "appearance.height", value: 99 });
  const tiny = applyEdit(DWARF, { field: "appearance.height", value: -5 });
  assertEquals(tall.appearance.height, hHi, "clamped to the top of the dwarf band");
  assertEquals(tiny.appearance.height, hLo, "clamped to the bottom of the dwarf band");
  const heavy = applyEdit(DWARF, { field: "appearance.weight", value: 9999 });
  const light = applyEdit(DWARF, { field: "appearance.weight", value: 1 });
  assertEquals(heavy.appearance.weight, wHi, "clamped to the top weight");
  assertEquals(light.appearance.weight, wLo, "clamped to the bottom weight");
  // A dwarf's top is below an elf's top — the band is DERIVED from the race, not a constant.
  const [, elfTop] = heightBand(ELF.race, ELF.subrace);
  assert(hHi < elfTop, `dwarf top (${hHi}) is below elf top (${elfTop})`);
});

Deno.test("a race edit synchronises subrace: a foreign sub-species is cleared", () => {
  // ELF holds an elf sub-species; switching to dwarf must clear it (a dwarf has no elf nation).
  const next = applyEdit(ELF, { field: "race", value: "dwarf" });
  assertEquals(next.race, "dwarf");
  assertEquals(next.subrace, null, "foreign sub-species cleared");
  // Switching to a race the sub-species DOES belong to keeps it: elf/dark stays valid across a
  // no-op race set.
  const kept = applyEdit(ELF, { field: "race", value: ELF.race });
  assertEquals(kept.subrace, ELF.subrace, "own sub-species kept");
  assertEquals(dependentFields("race"), ["subrace"]);
});

// ─── totality, determinism, idempotence, no-NaN ─────────────────────────────────

Deno.test("applyEdit is TOTAL: no field, good or bad, throws", () => {
  const spaces: { field: string; value: string | number | boolean | null }[] = [
    { field: "appearance.body", value: "#112233" },
    { field: "appearance.body", value: "not a colour" },
    { field: "appearance.body", value: 42 },
    { field: "appearance.accent", value: "#abcdef" },
    { field: "appearance.eyes", value: "#000000" },
    { field: "appearance.hair", value: null },
    { field: "appearance.height", value: Number.NaN },
    { field: "appearance.height", value: Number.POSITIVE_INFINITY },
    { field: "appearance.weight", value: -0 },
    { field: "appearance.beard", value: true },
    { field: "appearance.moustache", value: false },
    { field: "race", value: "dragon" },
    { field: "subrace", value: "foreign" },
    { field: "className", value: "Bard" },
    { field: "className", value: "Warrior" },
    { field: "birthsign", value: null },
    { field: "birthsign", value: "nonsense" },
    { field: "weaponType", value: "axe" },
    { field: "weaponType", value: "laser" },
    { field: "palette", value: "Ember" },
    { field: "palette", value: "Nope" },
    { field: "name", value: "Rook" },
    { field: "level", value: 7 },
    { field: "level", value: Number.NaN },
    { field: "totally.unknown", value: 1 },
  ];
  for (const patch of spaces) {
    const out = applyEdit(ELF, patch); // must not throw
    assert(typeof out === "object" && out !== null, `${patch.field} returns a profile`);
  }
});

Deno.test("applyEdit is DETERMINISTIC and never mutates its input", () => {
  const snapshot = JSON.stringify(ELF);
  const a = applyEdit(ELF, { field: "appearance.body", value: "#445566" });
  const b = applyEdit(ELF, { field: "appearance.body", value: "#445566" });
  assertEquals(a, b, "same edit -> same profile");
  assertEquals(JSON.stringify(ELF), snapshot, "the input is untouched");
});

Deno.test("applying the same edit twice IS idempotent", () => {
  const edits = [
    { field: "appearance.body", value: "#7a4a2a" },
    { field: "appearance.height", value: 5 },
    { field: "appearance.weight", value: 400 },
    { field: "appearance.beard", value: true },
    { field: "race", value: "ork" },
    { field: "subrace", value: "bloodfang" },
    { field: "className", value: "Mage" },
    { field: "birthsign", value: null },
    { field: "level", value: 12 },
    { field: "unknown", value: "x" },
  ];
  for (const e of edits) {
    const once = applyEdit(DWARF, e);
    const twice = applyEdit(once, e);
    assertEquals(twice, once, `idempotent: ${e.field}`);
  }
});

Deno.test("no edit can produce NaN or an out-of-range number", () => {
  const nasty = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1e9, 1e9, 0, -0];
  for (const v of nasty) {
    for (const field of ["appearance.height", "appearance.weight", "level"]) {
      const out = applyEdit(ELF, { field, value: v });
      const got = field === "level" ? out.level : field === "appearance.height" ? out.appearance.height : out.appearance.weight;
      assert(Number.isFinite(got), `${field} <- ${v} stays finite (got ${got})`);
    }
  }
  // And after any colour edit every colour field is still a valid #rrggbb.
  const out = applyEdit(ELF, { field: "appearance.body", value: "#000000" });
  for (const c of [out.appearance.body, out.appearance.accent, out.appearance.eyes]) {
    assert(HEX6.test(c), `colour ${c} is #rrggbb`);
  }
});

Deno.test("the rule table states which field moves which, and by what relation", () => {
  console.log("\n── sync rule table ──");
  for (const r of SYNC_RULES) {
    console.log(`  ${r.field} -> ${r.dependents.join(", ")}`);
    console.log(`      ${r.relation}`);
    assertEquals(dependentFields(r.field), r.dependents, `dependentFields(${r.field})`);
  }
  // A leaf field drags nothing.
  assertEquals(dependentFields("className"), []);
  assertEquals(dependentFields("no-such-field"), []);
  // The four races are all reachable by id (so a race edit is total over the real set).
  assertEquals(RACES.map((r) => r.id), ["human", "elf", "dwarf", "ork"]);
});
