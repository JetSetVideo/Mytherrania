// Wave N, lane N-D — the cast system and its bar. Proven here with no DOM and no engine:
//   1. castSeconds is MONOTONE in the power's base, FALLS with willpower and haste, and is clamped
//      into [CAST_MIN_S, CAST_MAX_S] — with a printed table across the casters and weights;
//   2. pushbackSeconds is bounded and MONOTONE in damage share and in the angle the hit came from
//      (from behind pushes more) — with a printed damage-share x angle grid;
//   3. tickCast advances, completes, refuses a NaN/negative dt, and is total at elapsed 0 and past
//      the cast; interrupt ends a cast at once and names who did it; the bar view is total;
//   4. the bar's source carries the class hooks and writes NO inline style attribute (the CSP rule).
import {
  addPushback,
  beginCast,
  castBarView,
  castSeconds,
  castSpec,
  interrupt,
  PUSH_CAP_S,
  PUSH_MAX_S,
  pushbackSeconds,
  tickCast,
  totalCastSeconds,
} from "../src/game/Cast.ts";
import { createStats, type ClassName } from "../src/game/Stats.ts";
import { skillsForClass, type Skill } from "../src/game/Skills.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok {
  if (!ok) throw new Error(m);
}

/** The class's power skill (the one that channels). */
function powerSkill(c: ClassName): Skill {
  const s = skillsForClass(c).find((k) => k.kind === "power");
  if (!s) throw new Error(`no power skill for ${c}`);
  return s;
}

// ─── castSeconds: monotone, falling with willpower/haste, bounded ─────────────────────────────

Deno.test("castSeconds: clamped into [CAST_MIN_S, CAST_MAX_S] and monotone in base", () => {
  let prev = -Infinity;
  for (let base = -2; base <= 6; base += 0.1) {
    const s = castSeconds({ base, willpower: 5, hastePct: 20, element: "arcane", heavy: true });
    assert(Number.isFinite(s) && s >= 0.35 && s <= 3.2, `in band: base=${base} -> ${s}`);
    assert(s >= prev - 1e-12, `non-decreasing: base=${base}`);
    prev = s;
  }
  // Strictly rising and to the floor/ceiling with the extremes.
  assert(castSeconds({ base: 0, willpower: 0, hastePct: 0, element: "fury", heavy: false }) === 0.35, "floor");
  assert(castSeconds({ base: 99, willpower: 0, hastePct: 0, element: "arcane", heavy: true }) === 3.2, "ceiling");
});

Deno.test("castSeconds: a NaN or non-positive base falls back to the floor, never NaN", () => {
  for (const base of [NaN, Infinity, -1, 0]) {
    const s = castSeconds({ base, willpower: 4, hastePct: 0, element: "fire", heavy: false });
    assert(Number.isFinite(s) && s >= 0.35, `finite: base=${base} -> ${s}`);
  }
});

Deno.test("castSeconds: strictly FALLS with willpower and with haste", () => {
  const at = (willpower: number, hastePct: number) => castSeconds({ base: 2.1, willpower, hastePct, element: "arcane", heavy: true });
  assert(at(0, 0) > at(4, 0) && at(4, 0) > at(9, 0), `willpower: ${at(0, 0)} ${at(4, 0)} ${at(9, 0)}`);
  assert(at(8, 0) > at(8, 15) && at(8, 15) > at(8, 40), `haste: ${at(8, 0)} ${at(8, 15)} ${at(8, 40)}`);
  // No finite willpower/haste can reach zero — the channel stays positive.
  assert(at(1000, 1000) > 0, "never zero");
});

Deno.test("castSeconds: the element and the heavy flag move the channel", () => {
  const arcane = castSeconds({ base: 2, willpower: 0, hastePct: 0, element: "arcane", heavy: false });
  const fury = castSeconds({ base: 2, willpower: 0, hastePct: 0, element: "fury", heavy: false });
  assert(arcane > fury, `arcane heavier than fury: ${arcane} vs ${fury}`);
  assert(castSeconds({ base: 2, willpower: 0, hastePct: 0, element: "arcane", heavy: true }) > arcane, "heavy longer than light");
  assert(castSeconds({ base: 2, willpower: 0, hastePct: 0, element: "mystery", heavy: false }) === arcane / 1.15, "unknown element is neutral");
});

// ─── pushbackSeconds: bounded, monotone in damage share and in angle ──────────────────────────

Deno.test("pushbackSeconds: bounded to [0, PUSH_MAX_S] for every input", () => {
  for (const damageFracOfMax of [NaN, -1, 0, 0.3, 1, 5, Infinity]) {
    for (const angleDeg of [NaN, -30, 0, 90, 180, 400]) {
      for (const stamina of [NaN, -2, 0, 6, 12, 100]) {
        for (const heavy of [true, false]) {
          const p = pushbackSeconds({ damageFracOfMax, angleDeg, stamina, heavy });
          assert(Number.isFinite(p) && p >= 0 && p <= PUSH_MAX_S, `bounded: ${p} from ${JSON.stringify([damageFracOfMax, angleDeg, stamina, heavy])}`);
        }
      }
    }
  }
});

Deno.test("pushbackSeconds: monotone up in damage share and in the angle it came from", () => {
  let prevD = -Infinity;
  for (let d = 0; d <= 1.0001; d += 0.05) {
    const p = pushbackSeconds({ damageFracOfMax: d, angleDeg: 90, stamina: 6, heavy: false });
    assert(p >= prevD - 1e-12, `damage monotone at ${d}`);
    prevD = p;
  }
  let prevA = -Infinity;
  for (let a = 0; a <= 180; a += 10) {
    const p = pushbackSeconds({ damageFracOfMax: 0.5, angleDeg: a, stamina: 6, heavy: false });
    assert(p >= prevA - 1e-12, `angle monotone at ${a}`);
    prevA = p;
  }
  // A hit from BEHIND pushes back more than one square from the front, and a heavy weapon more
  // than a light one, on the same blow.
  const front = pushbackSeconds({ damageFracOfMax: 0.5, angleDeg: 0, stamina: 6, heavy: false });
  const back = pushbackSeconds({ damageFracOfMax: 0.5, angleDeg: 180, stamina: 6, heavy: false });
  assert(back > front, `behind > front: ${back} vs ${front}`);
  const light = pushbackSeconds({ damageFracOfMax: 0.5, angleDeg: 90, stamina: 6, heavy: false });
  const heavy = pushbackSeconds({ damageFracOfMax: 0.5, angleDeg: 90, stamina: 6, heavy: true });
  assert(heavy > light, `heavy > light: ${heavy} vs ${light}`);
});

// ─── the state machine: advance, complete, refuse, interrupt ──────────────────────────────────

const SPEC = castSpec({ skillId: "mage-arcane-nova", base: 2.1, willpower: 8, hastePct: 0, element: "arcane", heavy: true });

Deno.test("tickCast: advances, completes at seconds + pushback, and freezes once ended", () => {
  let s = beginCast(SPEC);
  assert(s.elapsedS === 0 && !s.done && s.interruptedBy === null, "fresh");
  const half = s.spec.seconds / 2;
  s = tickCast(s, half);
  assert(Math.abs(s.elapsedS - half) < 1e-12 && !s.done, `mid: ${s.elapsedS}`);
  s = tickCast(s, half);
  assert(s.done && s.elapsedS >= totalCastSeconds(s), "done at the total");
  const after = tickCast(s, 5);
  assert(after.elapsedS === s.elapsedS, "an ended cast does not advance");
});

Deno.test("tickCast: a NaN / Infinity / negative dt is REFUSED (state untouched)", () => {
  const s = tickCast(beginCast(SPEC), 0.4);
  for (const bad of [NaN, Infinity, -Infinity, -0.5]) {
    const r = tickCast(s, bad);
    assert(r.elapsedS === s.elapsedS && r.done === s.done, `refused dt=${bad}: elapsed ${r.elapsedS}`);
  }
});

Deno.test("tickCast: exhaustion — elapsed 0, and elapsed far beyond the cast", () => {
  const zero = tickCast(beginCast(SPEC), 0);
  assert(zero.elapsedS === 0 && !zero.done, "elapsed 0 stays at 0");
  const far = tickCast(beginCast(SPEC), 1000);
  assert(far.done && far.elapsedS === 1000, `past the cast is done: ${far.elapsedS}`);
  assert(castBarView(far).fraction === 1, "bar reads full when done");
});

Deno.test("pushback extends the cast: elapsed must reach seconds + pushback", () => {
  let s = beginCast(SPEC);
  s = addPushback(s, 0.6);
  assert(Math.abs(totalCastSeconds(s) - (SPEC.seconds + 0.6)) < 1e-12, "total grows by the pushback");
  s = tickCast(s, SPEC.seconds);
  assert(!s.done, "not done at the nominal seconds once pushed back");
  s = tickCast(s, 0.6);
  assert(s.done, "done once the pushback is paid");
});

Deno.test("interrupt: ends the cast at once, names who did it, and is not a done", () => {
  let s = tickCast(beginCast(SPEC), 0.2);
  s = interrupt(s, "rogue-venom-strike");
  assert(s.interruptedBy === "rogue-venom-strike" && !s.done, `interruptedBy=${s.interruptedBy}`);
  assert(tickCast(s, 5).elapsedS === s.elapsedS, "an interrupted cast does not advance");
  assert(interrupt(s, "again") === s, "idempotent");
  assert(castBarView(s).state === "interrupted", "bar reads interrupted");
});

Deno.test("addPushback: bounded by PUSH_CAP_S over repeated hits", () => {
  let s = beginCast(SPEC);
  for (let i = 0; i < 50; i++) s = addPushback(s, 0.5);
  assert(s.pushbackS === PUSH_CAP_S, `capped at PUSH_CAP_S: ${s.pushbackS}`);
  assert(tickCast(s, SPEC.seconds + s.pushbackS).done, "still completable after the cap");
  assert(addPushback(s, NaN).pushbackS === s.pushbackS, "a NaN amount is ignored");
});

// ─── the bar view model: total over every state ───────────────────────────────────────────────

Deno.test("castBarView: total, states and fractions", () => {
  const v0 = castBarView(beginCast(SPEC));
  assert(v0.fraction === 0 && v0.pushbackFraction === 0 && v0.state === "cast", JSON.stringify(v0));
  assert(v0.label.includes("mage-arcane-nova") && v0.label.includes("s"), v0.label);
  const mid = castBarView(tickCast(beginCast(SPEC), SPEC.seconds / 4));
  assert(Math.abs(mid.fraction - 0.25) < 1e-9, `quarter: ${mid.fraction}`);
  const pushed = castBarView(addPushback(tickCast(beginCast(SPEC), 0.5), 0.5));
  assert(pushed.pushbackFraction > 0 && pushed.pushbackFraction < 1, `pushback share: ${pushed.pushbackFraction}`);
  assert(castBarView(tickCast(beginCast(SPEC), 9)).state === "done", "done");
  // Nothing leaks: a garbage state still yields finite, in-range numbers.
  const garbage = castBarView({ spec: { skillId: "?", seconds: NaN, interruptible: true, breakOnMove: false }, elapsedS: NaN, pushbackS: -5, done: false, interruptedBy: null });
  assert(Number.isFinite(garbage.fraction) && garbage.fraction >= 0 && garbage.fraction <= 1, "finite fraction");
  assert(Number.isFinite(garbage.pushbackFraction) && garbage.pushbackFraction >= 0, "finite pushback share");
});

// ─── the DOM layer's source hooks (a silent removal must fail) ─────────────────────────────────

Deno.test("CastBar.ts carries the class hooks and writes NO inline style attribute", () => {
  const here = new URL("../", import.meta.url);
  const src = Deno.readTextFileSync(new URL("src/ui/CastBar.ts", here));
  for (const hook of ["cast-bar", "cb-label", "cb-track", "cb-pushback", "cb-fill", "CAST_BAR_CLASSES"]) {
    assert(src.includes(hook), `CastBar.ts is missing the hook "${hook}"`);
  }
  assert(!src.includes('.setAttribute("style"') && !src.includes(".setAttribute('style'"), "CastBar.ts writes an inline style attribute");
  assert(src.includes("style.width"), "the bar fills through CSSOM (element.style.width)");
});

// ─── printed evidence tables (the lanes' evidence is a tool's literal output) ──────────────────

Deno.test("PRINT: cast seconds across the casters and weights", () => {
  const classes: ClassName[] = ["Mage", "Necromancer", "Priest", "Warrior", "Barbarian", "Rogue", "Assassin", "Archer"];
  const rows: string[] = [];
  for (const c of classes) {
    const skill = powerSkill(c);
    const st = createStats(c);
    const heavy = c === "Mage" || c === "Necromancer" || c === "Priest";
    const spec = castSpec({ skillId: skill.id, base: 2.1, willpower: st.willpower, hastePct: 0, element: skill.element, heavy });
    rows.push(
      `${c.padEnd(12)} ${skill.id.padEnd(24)} ${skill.element.padEnd(9)} heavy=${String(heavy).padEnd(5)} ` +
        `will=${String(st.willpower).padStart(2)} haste=0   -> ${spec.seconds.toFixed(3)} s`,
    );
  }
  // A mage's heavy spell, with and without haste, to show haste shortens the channel.
  const mage = createStats("Mage");
  for (const hastePct of [0, 20, 50]) {
    const spec = castSpec({ skillId: "mage-arcane-nova", base: 2.1, willpower: mage.willpower, hastePct, element: "arcane", heavy: true });
    rows.push(`${"Mage*".padEnd(12)} ${"mage-arcane-nova".padEnd(24)} ${"arcane".padEnd(9)} heavy=true  will=${String(mage.willpower).padStart(2)} haste=${String(hastePct).padStart(2)}   -> ${spec.seconds.toFixed(3)} s`);
  }
  console.log("\nCAST SECONDS (base 2.1, power kind)\n" + rows.join("\n"));
});

Deno.test("PRINT: pushback seconds across damage share x angle (heavy weapon, stamina 8)", () => {
  const angles = [0, 45, 90, 135, 180];
  const header = "dmg\\ang " + angles.map((a) => String(a).padStart(7)).join(" ");
  const lines: string[] = [];
  for (let d = 0; d <= 1.0001; d += 0.25) {
    const cells = angles.map((a) => pushbackSeconds({ damageFracOfMax: d, angleDeg: a, stamina: 8, heavy: true }).toFixed(4).padStart(7));
    lines.push(d.toFixed(2).padStart(7) + " " + cells.join(" "));
  }
  console.log(`\nPUSHBACK SECONDS (heavy, stamina 8)  cap/one-hit=${PUSH_MAX_S}s  cap/cast=${PUSH_CAP_S}s\n${header}\n${lines.join("\n")}`);
});
