// Wave X lane L: the INFLUENCE graph is true in code. Every edge of src/game/Influence.ts is
// perturbed in the REAL functions and its `to` must move with its `sign` (SPEC X20..X23).
import { ATTRIBUTE_NODES, INFLUENCES } from "../src/game/Influence.ts";
import { BASE, delta, probe, spend } from "./wave_x_influence_fixture.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

Deno.test("SPEC X20: every INFLUENCES edge is true in code — perturbing `from` moves `to` with `sign`", () => {
  const bad: string[] = [];
  for (const e of INFLUENCES) {
    const d = delta(e);
    const ok = Number.isFinite(d) && Math.sign(d) === e.sign && Math.abs(d) > 1e-9;
    console.log(`  ${ok ? "ok " : "BAD"} ${e.dir.padEnd(4)} ${e.from.padEnd(22)} -> ${e.to.padEnd(32)} ${e.sign > 0 ? "+" : "-"}  measured ${d.toPrecision(4)}`);
    if (!ok) bad.push(`${e.from} -> ${e.to} (sign ${e.sign}, measured ${d})`);
  }
  assert(bad.length === 0, `edges false in code:\n${bad.join("\n")}`);
});

Deno.test("SPEC X21: every attribute has an UP edge; agility reaches animations AND techniques AND movement", () => {
  for (const a of ATTRIBUTE_NODES) assert(INFLUENCES.some((e) => e.dir === "up" && e.from === a), `${a} has no up edge`);
  const agi = INFLUENCES.filter((e) => e.from === "agility" && e.dir === "up").map((e) => e.to);
  assert(agi.some((t) => t.startsWith("anim.")), "agility -> animation");
  assert(agi.some((t) => t.startsWith("technique.") || t.startsWith("cast.")), "agility -> technique");
  assert(agi.includes("moveSpeed") && agi.includes("dashDistance") && agi.includes("damageTaken"), "agility -> movement, dash, dodge");
});

Deno.test("SPEC X22: the graph has all three directions, the brief's two side trade-offs, and well-formed edges", () => {
  for (const d of ["up", "down", "side"] as const) assert(INFLUENCES.some((e) => e.dir === d), `no ${d} edge`);
  assert(INFLUENCES.some((e) => e.dir === "side" && e.from === "strength" && e.to === "agility.effective" && e.sign === -1), "strength vs agility");
  assert(INFLUENCES.some((e) => e.dir === "side" && e.from === "intelligence" && e.to === "focus.cast"), "intelligence -> focus (casting)");
  assert(INFLUENCES.some((e) => e.dir === "side" && e.from === "focus" && e.to === "intelligence.mana"), "focus -> intelligence (mana)");
  for (const k of ["race:", "subrace:", "class:", "birthsign:", "level"]) assert(INFLUENCES.some((e) => e.dir === "down" && e.from.startsWith(k)), `no down edge from ${k}`);
  const seen = new Set<string>();
  for (const e of INFLUENCES) {
    assert(e.weight > 0 && e.weight <= 1 && e.why.length > 3, `${e.from} -> ${e.to}: weight/why`);
    const key = `${e.from}|${e.to}`;
    assert(!seen.has(key), `duplicate edge ${key}`);
    seen.add(key);
  }
});

Deno.test("SPEC X23: Focus still drives cast time, power duration and mana regen (the renamed attribute kept its job)", () => {
  const f = (k: number) => spend(BASE, "focus", k);
  assert(probe("technique.castSeconds")(f(4)) < probe("technique.castSeconds")(BASE), "cast time");
  assert(probe("cast.channel")(f(4)) < probe("cast.channel")(BASE), "live cast bar");
  assert(probe("technique.duration")(f(4)) > probe("technique.duration")(BASE), "duration");
  assert(probe("manaRegen")(f(4)) > probe("manaRegen")(BASE), "mana regen");
});
