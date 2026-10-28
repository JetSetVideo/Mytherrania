import { BIRTHSIGN_SECONDARY, combineSecondary, formatDelta, SECONDARY_STATS, secondaryPreview, SUBRACE_SECONDARY } from "../src/game/SecondaryStats.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }

Deno.test("every sub-species and birth sign maps to known secondary stats", () => {
  for (const [id, mods] of Object.entries(SUBRACE_SECONDARY)) {
    for (const k of Object.keys(mods)) assert(SECONDARY_STATS.includes(k as never), `subrace ${id} has unknown stat ${k}`);
  }
  for (const [id, mods] of Object.entries(BIRTHSIGN_SECONDARY)) {
    for (const k of Object.keys(mods)) assert(SECONDARY_STATS.includes(k as never), `birthsign ${id} has unknown stat ${k}`);
  }
});

Deno.test("combineSecondary adds the sub-species and birth-sign layers", () => {
  const c = combineSecondary("imperial", "storm");
  // imperial: versatility +0.02, mastery +0.02; storm: crit +0.02, haste +0.02.
  assert(Math.abs(c.versatility - 0.02) < 1e-9, "versatility from imperial");
  assert(Math.abs(c.mastery - 0.02) < 1e-9, "mastery from imperial");
  assert(Math.abs(c.crit - 0.02) < 1e-9, "crit from storm");
  assert(Math.abs(c.haste - 0.02) < 1e-9, "haste from storm");
  assert(c.physResist === 0 && c.magicResist === 0, "untouched stats are zero");
});

Deno.test("combineSecondary is additive across the two layers", () => {
  // wood elf gives haste +0.02, crit +0.02; serpent gives crit +0.02, haste +0.01.
  const c = combineSecondary("wood", "serpent");
  assert(Math.abs(c.crit - 0.04) < 1e-9, `crit should stack to 4%, got ${c.crit}`);
  assert(Math.abs(c.haste - 0.03) < 1e-9, `haste should stack to 3%, got ${c.haste}`);
});

Deno.test("absent layers contribute nothing and every stat is present", () => {
  const none = combineSecondary(null, null);
  for (const s of SECONDARY_STATS) assert(none[s] === 0, `${s} zero with no layers`);
  const onlySub = combineSecondary("mountain", null);
  assert(onlySub.physResist > 0 && onlySub.crit === 0, "only the sub-species layer applies");
});

Deno.test("formatDelta renders +5%, -2%, and — for zero", () => {
  assert(formatDelta(0.05) === "+5%", "positive");
  assert(formatDelta(-0.02) === "-2%", "negative");
  assert(formatDelta(0) === "—", "zero is a dash");
  assert(formatDelta(0.035) === "+3.5%", "one decimal");
});

Deno.test("secondaryPreview returns one labelled row per secondary stat", () => {
  const rows = secondaryPreview("ironhide", "void");
  assert(rows.length === SECONDARY_STATS.length, "a row per stat");
  for (const r of rows) {
    assert(r.label.length > 0, "labelled");
    assert(typeof r.text === "string", "formatted");
  }
  // ironhide: physResist +0.03, versatility +0.02, crit +0.01; void: magicResist +0.03, versatility +0.01.
  const phys = rows.find((r) => r.stat === "physResist")!;
  assert(phys.text === "+3%", `physResist row, got ${phys.text}`);
  const vers = rows.find((r) => r.stat === "versatility")!;
  assert(vers.text === "+3%", `versatility stacks to +3%, got ${vers.text}`);
});
