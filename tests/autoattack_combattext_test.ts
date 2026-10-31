// Wave N lane N-E: the autoattack decision and the floating number's style.
// Pure modules — no DOM, no THREE: every claim here is the model's own output.
import {
  advanceAutoAttack,
  autoAttackDue,
  createAutoAttack,
  AUTOATTACK_INTERVAL_MIN_S,
  type AutoAttack,
} from "../src/game/AutoAttack.ts";
import {
  classifyHit,
  combatTextClass,
  combatTextText,
  combatTextVars,
  formatHit,
  HIT_GLYPH_CHAR,
  HIT_LIGHT_MAX,
  HIT_LIGHT_MIN,
  HIT_LIFE_MAX_MS,
  HIT_LIFE_MIN_MS,
  HIT_RISE_MAX_MS,
  HIT_RISE_MIN_MS,
  HIT_SIZE_MAX_PX,
  HIT_SIZE_MIN_PX,
  HIT_WEIGHT_MAX,
  HIT_WEIGHT_MIN,
  hitStyle,
  type HitGlyph,
  type HitStyle,
} from "../src/ui/CombatText.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const base = { damage: 2000, maxHealth: 40000, crit: false, absorbedFrac: 0, element: "fire", weaponHeavy: false, attackerHastePct: 0 };

// ── AutoAttack ────────────────────────────────────────────────────────────────────────────────

Deno.test("autoAttackDue: due once the interval elapsed, in reach and able", () => {
  const a = createAutoAttack(1.0, 0);
  assert(!autoAttackDue(a, { atS: -1, distanceM: 1, reachM: 2, stunned: false, casting: false }), "before the first interval");
  assert(autoAttackDue(a, { atS: 0, distanceM: 1.5, reachM: 2, stunned: false, casting: false }), "due at t=0");
  const b = advanceAutoAttack(a, { atS: 0, intervalS: 1.0 });
  assert(b.nextAtS === 1.0, `nextAtS ${b.nextAtS}`);
  assert(!autoAttackDue(b, { atS: 0.999, distanceM: 1, reachM: 2, stunned: false, casting: false }), "not due before interval");
  assert(autoAttackDue(b, { atS: 1.0, distanceM: 1, reachM: 2, stunned: false, casting: false }), "due exactly at interval");
});

Deno.test("autoAttackDue: refused while stunned or casting", () => {
  const a = createAutoAttack(1.0, 0);
  assert(!autoAttackDue(a, { atS: 5, distanceM: 1, reachM: 2, stunned: true, casting: false }), "stunned");
  assert(!autoAttackDue(a, { atS: 5, distanceM: 1, reachM: 2, stunned: false, casting: true }), "casting");
  assert(autoAttackDue(a, { atS: 5, distanceM: 1, reachM: 2, stunned: false, casting: false }), "free");
});

Deno.test("autoAttackDue: reach boundary is inclusive, out of reach refuses", () => {
  const a = createAutoAttack(1.0, 0);
  assert(autoAttackDue(a, { atS: 5, distanceM: 2, reachM: 2, stunned: false, casting: false }), "exactly at reach");
  assert(!autoAttackDue(a, { atS: 5, distanceM: 2.001, reachM: 2, stunned: false, casting: false }), "past reach");
});

Deno.test("autoAttackDue: NaN clock or reach is refused (never reads as due)", () => {
  const a = createAutoAttack(1.0, 0);
  for (const o of [
    { atS: NaN, distanceM: 1, reachM: 2, stunned: false, casting: false },
    { atS: 5, distanceM: NaN, reachM: 2, stunned: false, casting: false },
    { atS: 5, distanceM: 1, reachM: NaN, stunned: false, casting: false },
  ]) assert(!autoAttackDue(a, o), JSON.stringify(o));
  assert(!autoAttackDue({ ...a, nextAtS: NaN }, { atS: 5, distanceM: 1, reachM: 2, stunned: false, casting: false }), "NaN nextAtS");
});

Deno.test("advanceAutoAttack: next = atS + interval, interval clamped, target preserved", () => {
  const a: AutoAttack = { nextAtS: 0, intervalS: 1, lastTargetId: "foe-1" };
  const b = advanceAutoAttack(a, { atS: 3, intervalS: 1.05 });
  assert(Math.abs(b.nextAtS - 4.05) < 1e-9, `nextAtS ${b.nextAtS}`);
  assert(b.intervalS === 1.05 && b.lastTargetId === "foe-1", "carried");
  const fast = advanceAutoAttack(a, { atS: 0, intervalS: 0 });   // below the 0.2 s floor
  assert(fast.intervalS === AUTOATTACK_INTERVAL_MIN_S, `floor ${fast.intervalS}`);
  const garbage = advanceAutoAttack(a, { atS: 3, intervalS: NaN });
  assert(garbage.intervalS === 1, "keeps last interval on NaN");
  assert(garbage.nextAtS === 4, "next from the kept interval");
});

// ── formatHit ─────────────────────────────────────────────────────────────────────────────────

Deno.test("formatHit: thousands grouped with a space, like the repo's \"47 100\"", () => {
  assert(formatHit(47100) === "47 100", formatHit(47100));
  assert(formatHit(0) === "0", formatHit(0));
  assert(formatHit(120) === "120", formatHit(120));
  assert(formatHit(1000000) === "1 000 000", formatHit(1000000));
  assert(formatHit(-1234) === "-1 234", formatHit(-1234));
  assert(formatHit(NaN) === "0" && formatHit(Infinity) === "0", "non-finite reads 0");
});

// ── hitStyle: classification ──────────────────────────────────────────────────────────────────

Deno.test("hitStyle: the six outcomes classify from the statistics", () => {
  assert(hitStyle({ ...base, crit: true }).glyph === "crit");
  assert(hitStyle({ ...base }).glyph === "hit");
  assert(hitStyle({ ...base, damage: 0, absorbedFrac: 1 }).glyph === "absorbed");
  assert(hitStyle({ ...base, damage: 0 }).glyph === "miss");
  assert(hitStyle({ ...base, damage: 50, maxHealth: 40000 }).glyph === "resisted"); // 0.125 % < 0.5 %
  assert(hitStyle({ ...base, maxHealth: 0 }).glyph === "immune");
  assert(classifyHit({ damage: 0, maxHealth: -5, crit: false, absorbedFrac: 0 }) === "immune");
});

// ── hitStyle: readability without colour ──────────────────────────────────────────────────────

Deno.test("hitStyle: the six outcomes are separable without hue (glyph + boldness + size)", () => {
  const cases: HitStyle[] = [
    hitStyle({ ...base, damage: 20000, crit: true }),                 // crit
    hitStyle({ ...base, damage: 20000 }),                             // hit
    hitStyle({ ...base, damage: 0, absorbedFrac: 1 }),                // absorbed
    hitStyle({ ...base, damage: 50 }),                                // resisted
    hitStyle({ ...base, damage: 0 }),                                 // miss
    hitStyle({ ...base, maxHealth: 0 }),                              // immune
  ];
  const glyphs = new Set(cases.map((s) => s.glyph));
  assert(glyphs.size === 6, `six distinct glyphs, got ${glyphs.size}`);
  // Shapes are distinct characters, and every pair differs in (glyph, or weight and size):
  const chars = new Set(cases.map((s) => HIT_GLYPH_CHAR[s.glyph]));
  assert(chars.size === 6, "six distinct glyph SHAPES");
  for (let i = 0; i < cases.length; i++) for (let j = i + 1; j < cases.length; j++) {
    const a = cases[i], b = cases[j];
    const separable = a.glyph !== b.glyph || a.weight !== b.weight || a.sizePx !== b.sizePx;
    assert(separable, `pair ${i}/${j} not separable without hue`);
  }
});

Deno.test("hitStyle: a crit is bolder, bigger and brighter than the same normal hit", () => {
  const normal = hitStyle({ ...base, damage: 8000 });
  const crit = hitStyle({ ...base, damage: 8000, crit: true });
  assert(crit.weight > normal.weight, `weight ${crit.weight} > ${normal.weight}`);
  assert(crit.sizePx > normal.sizePx, `size ${crit.sizePx} > ${normal.sizePx}`);
  assert(crit.lightness > normal.lightness, `light ${crit.lightness} > ${normal.lightness}`);
  assert(crit.riseMs < normal.riseMs, `rise ${crit.riseMs} < ${normal.riseMs}`);
});

// ── hitStyle: monotone in the hit's size ──────────────────────────────────────────────────────

Deno.test("hitStyle: monotone in the hit's share of the pool (bigger = bigger/brighter/bolder/faster)", () => {
  const pool = 40000;
  let prev: HitStyle | null = null;
  for (const dmg of [500, 2000, 8000, 20000, 60000]) {
    const s = hitStyle({ ...base, damage: dmg, maxHealth: pool });
    if (prev) {
      assert(s.sizePx >= prev.sizePx, `size ${s.sizePx} >= ${prev.sizePx}`);
      assert(s.weight >= prev.weight, `weight ${s.weight} >= ${prev.weight}`);
      assert(s.lightness >= prev.lightness, `light ${s.lightness} >= ${prev.lightness}`);
      assert(s.riseMs <= prev.riseMs, `rise ${s.riseMs} <= ${prev.riseMs}`);
      assert(s.lifeMs >= prev.lifeMs, `life ${s.lifeMs} >= ${prev.lifeMs}`);
    }
    prev = s;
  }
});

Deno.test("hitStyle: a bigger weapon and haste lift the style (bounded)", () => {
  const light = hitStyle({ ...base, damage: 8000, weaponHeavy: false });
  const heavy = hitStyle({ ...base, damage: 8000, weaponHeavy: true });
  assert(heavy.weight > light.weight && heavy.sizePx > light.sizePx, "heavy is bolder and bigger");
  const fresh = hitStyle({ ...base, damage: 8000, attackerHastePct: 0 });
  const hasted = hitStyle({ ...base, damage: 8000, attackerHastePct: 40 });
  assert(hasted.riseMs < fresh.riseMs, `haste rises faster ${hasted.riseMs} < ${fresh.riseMs}`);
});

// ── hitStyle: hue from the element ────────────────────────────────────────────────────────────

Deno.test("hitStyle: hue comes from the element and differs between elements", () => {
  const fire = hitStyle({ ...base, element: "fire" }).hue;
  const shadow = hitStyle({ ...base, element: "shadow" }).hue;
  const poison = hitStyle({ ...base, element: "poison" }).hue;
  assert(fire >= 0 && fire < 360 && shadow >= 0 && shadow < 360, "hue in range");
  assert(Math.abs(fire - shadow) > 20 && Math.abs(fire - poison) > 20, `distinct hues ${fire}/${shadow}/${poison}`);
  assert(shadow > 240 && shadow < 320, `shadow is violet ${shadow}`);
  assert(Number.isFinite(hitStyle({ ...base, element: "nonsense" }).hue), "unknown element still finite");
});

// ── hitStyle: total and bounded over garbage ──────────────────────────────────────────────────

Deno.test("hitStyle: every field finite and bounded for NaN/Infinity/negative/over-pool", () => {
  const inputs = [
    { damage: NaN, maxHealth: 40000 },
    { damage: Infinity, maxHealth: 40000 },
    { damage: -500, maxHealth: 40000 },
    { damage: 1e12, maxHealth: 40000 },   // a hit far larger than the pool
    { damage: 2000, maxHealth: NaN },
    { damage: 2000, maxHealth: -1 },
    { damage: NaN, maxHealth: NaN },
  ];
  for (const it of inputs) {
    const s = hitStyle({ ...base, ...it });
    for (const [k, v] of Object.entries(s)) {
      if (k === "glyph") continue;
      assert(Number.isFinite(v as number), `${k} finite for ${JSON.stringify(it)}`);
    }
    assert(s.sizePx >= HIT_SIZE_MIN_PX && s.sizePx <= HIT_SIZE_MAX_PX, `size ${s.sizePx}`);
    assert(s.weight >= HIT_WEIGHT_MIN && s.weight <= HIT_WEIGHT_MAX, `weight ${s.weight}`);
    assert(s.lightness >= HIT_LIGHT_MIN && s.lightness <= HIT_LIGHT_MAX, `light ${s.lightness}`);
    assert(s.riseMs >= HIT_RISE_MIN_MS && s.riseMs <= HIT_RISE_MAX_MS, `rise ${s.riseMs}`);
    assert(s.lifeMs >= HIT_LIFE_MIN_MS && s.lifeMs <= HIT_LIFE_MAX_MS, `life ${s.lifeMs}`);
    assert(s.hue >= 0 && s.hue < 360, `hue ${s.hue}`);
  }
});

// ── the DOM writer's contract ─────────────────────────────────────────────────────────────────

Deno.test("CombatText: class names, custom properties and text the parent applies", () => {
  const s = hitStyle({ ...base, damage: 8000, crit: true });
  assert(combatTextClass(s) === "combat-text combat-text--crit", combatTextClass(s));
  assert(combatTextClass(hitStyle({ ...base, damage: 0 })) === "combat-text combat-text--miss", "miss class");
  const vars = combatTextVars(s);
  const keys = Object.keys(vars).sort();
  assert(JSON.stringify(keys) === JSON.stringify(["--ct-hue", "--ct-life", "--ct-light", "--ct-rise", "--ct-size", "--ct-weight"]), keys.join(","));
  assert(vars["--ct-size"].endsWith("px") && vars["--ct-rise"].endsWith("ms") && vars["--ct-light"].endsWith("%"), "units carried");
  assert(combatTextText(s, 47100) === "\u2726 47 100", combatTextText(s, 47100));
  assert(combatTextText(hitStyle({ ...base, damage: 0 }), 0) === "\u2715 0", "miss text");
});

// ── the style table across the hit range ──────────────────────────────────────────────────────
// Printed for the report; run with `deno test --allow-read --allow-write=artifacts`.

Deno.test("STYLE TABLE across the hit range", () => {
  const pool = 40000;
  const rows: [string, HitStyle][] = [
    ["small", hitStyle({ ...base, damage: 400, maxHealth: pool })],
    ["average", hitStyle({ ...base, damage: 4000, maxHealth: pool })],
    ["huge", hitStyle({ ...base, damage: 24000, maxHealth: pool })],
    ["crit", hitStyle({ ...base, damage: 12000, maxHealth: pool, crit: true })],
    ["absorbed", hitStyle({ ...base, damage: 0, maxHealth: pool, absorbedFrac: 1 })],
    ["resisted", hitStyle({ ...base, damage: 80, maxHealth: pool })],
    ["miss", hitStyle({ ...base, damage: 0, maxHealth: pool })],
    ["immune", hitStyle({ ...base, damage: 0, maxHealth: 0 })],
  ];
  console.log("outcome   | glyph    | sizePx | weight | hue  | light | riseMs | lifeMs");
  for (const [name, s] of rows) console.log(`${name.padEnd(9)} | ${s.glyph.padEnd(8)} | ${s.sizePx.toFixed(1).padStart(6)} | ${String(s.weight).padStart(6)} | ${s.hue.toFixed(0).padStart(4)} | ${s.lightness.toFixed(3)} | ${s.riseMs.toFixed(0).padStart(6)} | ${s.lifeMs.toFixed(0).padStart(6)}`);
  const glyphs = new Set<HitGlyph>(rows.map(([, s]) => s.glyph));
  assert(glyphs.size === 6, `the table shows all six glyphs (got ${[...glyphs].join(",")})`);
});
