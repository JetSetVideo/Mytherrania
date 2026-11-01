// Lane S-A: five archetype-true powers for every class, each derived through ONE cost law.
//
// The user's ask: "for all the classes create five powers that respect the classes archetypes …
// the mage can cast fireballs and do a force cone … they must be related to the weapons the
// statistics of the characters … the duration and power is depending on all the factors". So this
// test proves, with tool output and no promises:
//   1. every class owns exactly five powers, each declaring its shape and its two scale inputs;
//   2. every power's amplitude / cast / mana / cooldown / duration EQUALS what PowerCost derives
//      from the caster's own statistics and the equipped weapon — and MOVES when either changes,
//      so a hard-coded amplitude FAILS (the inverse control);
//   3. every shape and every element is used at least once (a printed coverage table);
//   4. the combo table names only real powers, and the exclusion table really denies each class a
//      shape (a printed combo table and exclusion table) — "not all classes have everything";
//   5. SKILL_RESOURCE_COST is single-sourced (the engine's copy is the SAME object as the law's);
//   6. every power's animation is a real four-plus-joint pose whose wind-up length is its cast time.
import {
  ALL_POWERS,
  ELEMENTS,
  POWERS_BY_CLASS,
  powersForClass,
  type Element,
  type Power,
} from "../src/game/Skills.ts";
import { CLASSES, createStats, type ClassName, type CombatStats } from "../src/game/Stats.ts";
import { weaponForClass, type Weapon } from "../src/game/Weapon.ts";
import {
  ATTRIBUTES,
  castSecondsOf,
  cooldownSecondsOf,
  derivePower,
  durationSecondsOf,
  manaCostOf,
  POWER_SHAPES,
  powerOf,
  SKILL_RESOURCE_COST,
  type PowerShape,
} from "../src/game/PowerCost.ts";
import { COMBOS, comboBonus, EXCLUSIONS, shapeAllowedFor } from "../src/game/ComboTable.ts";
import { SKILL_RESOURCE_COST as ENGINE_SKILL_RESOURCE_COST } from "../src/engine/Engine.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }
const near = (a: number, b: number, eps = 1e-12) => Math.abs(a - b) <= eps;
/** The class's own loadout — the exact inputs every power was built from. */
const loadout = (c: ClassName): { stats: CombatStats; weapon: Weapon } =>
  ({ stats: createStats(c), weapon: weaponForClass(c) });

/** Does a power's stat block equal what the law derives for these stats and weapon? */
function derivationMatches(p: Power, stats: CombatStats, weapon: Weapon): boolean {
  const d = derivePower({ shape: p.shape, element: p.element, scale: p.scale, stats, weapon });
  return near(p.amplitude, d.amplitude) &&
    near(p.castSeconds, d.castSeconds) &&
    p.manaCost === d.manaCost &&
    near(p.cooldownSeconds, d.cooldownSeconds) &&
    near(p.durationSeconds, d.durationSeconds) &&
    near(p.payload.damageMul, d.amplitude);
}

// ─── 1. the roster: five powers per class ────────────────────────────────────────────────────────

Deno.test("every class owns exactly five powers, ids and names unique, each declaring a real shape", () => {
  assert(ALL_POWERS.length === CLASSES.length * 5, `expected ${CLASSES.length * 5} powers, got ${ALL_POWERS.length}`);
  for (const c of CLASSES) {
    const list = powersForClass(c);
    assert(list.length === 5, `${c} has ${list.length} powers, expected 5`);
    for (const p of list) {
      assert(p.className === c, `${p.id} is filed under ${p.className}, not ${c}`);
      assert(POWER_SHAPES.includes(p.shape), `${p.id} has an unknown shape ${p.shape}`);
      assert(ATTRIBUTES.includes(p.scale.attribute), `${p.id} scales from an unknown attribute ${p.scale.attribute}`);
      assert(p.name.trim().length > 2 && p.blurb.trim().length > 20, `${p.id} needs a name and a description`);
      assert(ELEMENTS[p.element] !== undefined, `${p.id} has an unknown element ${p.element}`);
    }
  }
  const ids = ALL_POWERS.map((p) => p.id);
  assert(new Set(ids).size === ids.length, "duplicate power id");
  const names = ALL_POWERS.map((p) => p.name);
  assert(new Set(names).size === names.length, "duplicate power name");
  // The roster is fully indexed by class.
  assert(CLASSES.every((c) => POWERS_BY_CLASS[c].length === 5), "POWERS_BY_CLASS is missing a class");
});

// ─── 2. the one law: derived, not typed — and a hard-coded amplitude FAILS ────────────────────────

Deno.test("every power's numbers are DERIVED from the caster's statistics and the equipped weapon", () => {
  for (const p of ALL_POWERS) {
    const { stats, weapon } = loadout(p.className);
    const d = derivePower({ shape: p.shape, element: p.element, scale: p.scale, stats, weapon });
    // Each field equals the matching granular law, and the composed derivePower.
    assert(near(p.amplitude, powerOf({ shape: p.shape, element: p.element, attributeValue: stats[p.scale.attribute], weapon: p.scale.weapon, weaponValue: weapon[p.scale.weapon] })),
      `${p.id}: amplitude is not powerOf(...)`);
    assert(near(p.castSeconds, castSecondsOf({ shape: p.shape, element: p.element, willpower: stats.willpower, hastePct: 0 })), `${p.id}: cast not castSecondsOf(...)`);
    assert(p.manaCost === manaCostOf({ shape: p.shape, element: p.element, intelligence: stats.intelligence }), `${p.id}: mana not manaCostOf(...)`);
    assert(near(p.cooldownSeconds, cooldownSecondsOf({ shape: p.shape, reflex: stats.reflex })), `${p.id}: cooldown not cooldownSecondsOf(...)`);
    assert(near(p.durationSeconds, durationSecondsOf({ shape: p.shape, willpower: stats.willpower })), `${p.id}: duration not durationSecondsOf(...)`);
    assert(derivationMatches(p, stats, weapon), `${p.id}: does not match derivePower`);
    assert(near(p.amplitude, d.amplitude) && near(p.cooldownSeconds, d.cooldownSeconds), `${p.id}: composed derivation drifted`);
  }
});

Deno.test("INVERSE: a power with a HARD-CODED amplitude fails the derivation check", () => {
  const p = ALL_POWERS[0];
  const { stats, weapon } = loadout(p.className);
  assert(derivationMatches(p, stats, weapon), "the honest power must pass");
  // Forge a power whose numbers were typed by hand (a hard-coded amplitude and cost).
  const hardCoded: Power = { ...p, amplitude: 42, castSeconds: 99, manaCost: 999, cooldownSeconds: 999, payload: { ...p.payload, damageMul: 42 } };
  assert(!derivationMatches(hardCoded, stats, weapon), "a hard-coded amplitude must FAIL the derivation check");
  assert(!near(hardCoded.amplitude, derivePower({ shape: p.shape, element: p.element, scale: p.scale, stats, weapon }).amplitude), "and it differs from the derived value");
});

Deno.test("a power's numbers CHANGE when the caster's attributes or weapon change", () => {
  for (const p of ALL_POWERS) {
    const { stats, weapon } = loadout(p.className);
    const base = derivePower({ shape: p.shape, element: p.element, scale: p.scale, stats, weapon });
    // A HIGHER scaling attribute lifts the amplitude.
    const stronger = derivePower({ shape: p.shape, element: p.element, scale: p.scale, stats: { ...stats, [p.scale.attribute]: stats[p.scale.attribute] + 3 }, weapon });
    assert(stronger.amplitude > base.amplitude, `${p.id}: raising ${p.scale.attribute} did not raise the amplitude`);
    // A HEAVIER scaling weapon input lifts it too (every weapon input is monotone up).
    const heavier = derivePower({ shape: p.shape, element: p.element, scale: p.scale, stats, weapon: { ...weapon, [p.scale.weapon]: weapon[p.scale.weapon] * 1.5 } });
    assert(heavier.amplitude > base.amplitude, `${p.id}: raising weapon.${p.scale.weapon} did not raise the amplitude`);
    // An UNRELATED attribute is ignored — proof the power reads ONLY its declared attribute.
    const other = ATTRIBUTES.find((a) => a !== p.scale.attribute)!;
    const shifted = derivePower({ shape: p.shape, element: p.element, scale: p.scale, stats: { ...stats, [other]: stats[other] + 5 }, weapon });
    assert(near(shifted.amplitude, base.amplitude), `${p.id}: amplitude moved with the unrelated attribute ${other}`);
  }
  // The other three laws move too, on a representative power.
  const p = ALL_POWERS.find((x) => x.shape === "aura")!;
  const { stats, weapon } = loadout(p.className);
  const d0 = derivePower({ shape: p.shape, element: p.element, scale: p.scale, stats, weapon });
  const smarter = derivePower({ shape: p.shape, element: p.element, scale: p.scale, stats: { ...stats, intelligence: stats.intelligence + 6 }, weapon });
  assert(smarter.manaCost < d0.manaCost, `${p.id}: intelligence did not lower the mana cost`);
  const quicker = derivePower({ shape: p.shape, element: p.element, scale: p.scale, stats: { ...stats, reflex: stats.reflex + 6 }, weapon });
  assert(quicker.cooldownSeconds < d0.cooldownSeconds, `${p.id}: reflex did not shorten the cooldown`);
  const hasty = derivePower({ shape: p.shape, element: p.element, scale: p.scale, stats, weapon, hastePct: 20 });
  assert(hasty.castSeconds < d0.castSeconds, `${p.id}: haste did not shorten the channel`);
});

// ─── 3. animations: real poses, wind-up = cast time ───────────────────────────────────────────────

Deno.test("every power animates a real pose whose strike lands where its wind-up ends", () => {
  for (const p of ALL_POWERS) {
    const a = p.animation;
    for (const [k, v] of Object.entries({ duration: a.duration, hitAt: a.hitAt, lunge: a.lunge, hop: a.hop, effectIntensity: a.effectIntensity, windupFraction: a.windupFraction ?? NaN })) {
      assert(Number.isFinite(v), `${p.id}: animation.${k} = ${v}`);
    }
    assert(a.hitAt > 0 && a.hitAt < 1, `${p.id}: hitAt ${a.hitAt} outside (0,1)`);
    assert(a.tracks.length >= 4, `${p.id}: animates only ${a.tracks.length} joints`);
    // The wind-up length IS the cast time: hitAt = castSeconds / duration.
    assert(near(a.hitAt, p.castSeconds / a.duration), `${p.id}: hitAt is not castSeconds / duration`);
    assert(near(a.windupFraction ?? NaN, a.hitAt), `${p.id}: windupFraction != hitAt`);
    assert(a.shape === p.shape, `${p.id}: animation shape ${a.shape} != power shape ${p.shape}`);
    // The weapon arm peaks on the strike, and no joint is driven twice.
    const seen = new Set<string>();
    for (const t of a.tracks) {
      assert(!seen.has(t.joint), `${p.id}: joint ${t.joint} driven by two tracks`);
      seen.add(t.joint);
    }
    const arm = a.tracks.find((t) => t.joint === "shoulderR");
    assert(arm !== undefined && near(arm.peak, a.hitAt), `${p.id}: shoulderR does not peak on the hit frame`);
  }
});

// ─── 4. combos and exclusions ─────────────────────────────────────────────────────────────────────

Deno.test("every combo names two real powers and pays a bonus; every exclusion really denies a shape", () => {
  const ids = new Set(ALL_POWERS.map((p) => p.id));
  for (const c of COMBOS) {
    assert(ids.has(c.from), `combo from ${c.from} is not a real power`);
    assert(ids.has(c.then), `combo then ${c.then} is not a real power`);
    assert(c.from !== c.then, `combo ${c.from} -> itself`);
    assert(c.damageMul >= 1 && c.castMul > 0 && c.castMul <= 1, `combo ${c.from}->${c.then} bonus out of range`);
    assert(comboBonus(c.from, c.then) === c, `comboBonus does not return the stated combo ${c.from}->${c.then}`);
  }
  // Each class repeats one shape and therefore lacks another — "not all classes have everything".
  for (const c of CLASSES) {
    const shapes = powersForClass(c).map((p) => p.shape);
    assert(new Set(shapes).size === 4, `${c} does not repeat exactly one shape (uses ${new Set(shapes).size})`);
    const missing = POWER_SHAPES.filter((s) => !shapes.includes(s));
    assert(missing.length === 1, `${c} is missing ${missing.length} shapes`);
    assert(!shapeAllowedFor(c, missing[0]), `${c} is allowed the shape it is meant to lack: ${missing[0]}`);
    assert(EXCLUSIONS.some((e) => e.className === c && e.shape === missing[0]), `${c} lacks ${missing[0]} but no exclusion says so`);
    assert(powersForClass(c).every((p) => shapeAllowedFor(c, p.shape)), `${c} owns a forbidden shape`);
  }
});

// ─── 5. the resource table is single-sourced ──────────────────────────────────────────────────────

Deno.test("SKILL_RESOURCE_COST is ONE object: the engine re-exports the law's own table", () => {
  assert(ENGINE_SKILL_RESOURCE_COST === SKILL_RESOURCE_COST, "the engine's table is a SEPARATE object (not single-sourced)");
  assert(SKILL_RESOURCE_COST.dash.mana === 0, "a dash is a stamina move: no mana");
  assert(SKILL_RESOURCE_COST.power.mana === 24 && SKILL_RESOURCE_COST.defense.mana === 6, "Wave J mana values drifted");
  assert(SKILL_RESOURCE_COST.power.mana > SKILL_RESOURCE_COST.defense.mana, "a power must cost more mana than a guard");
});

// ─── 6. printed evidence tables ───────────────────────────────────────────────────────────────────

Deno.test("PRINT: the power table (class, power, shape, element, cast s, duration s, mana, cooldown s, scales from)", () => {
  const rows: string[] = [];
  for (const c of CLASSES) {
    for (const p of powersForClass(c)) {
      rows.push(
        `${c.padEnd(12)} ${p.id.padEnd(25)} ${p.shape.padEnd(11)} ${p.element.padEnd(9)} ` +
        `cast=${p.castSeconds.toFixed(2)}s dur=${p.durationSeconds.toFixed(2)}s mana=${String(p.manaCost).padStart(2)} cd=${p.cooldownSeconds.toFixed(2)}s ` +
        `amp=${p.amplitude.toFixed(3)} <- ${p.scale.attribute}/${p.scale.weapon}`,
      );
    }
  }
  console.log(`\nPOWER TABLE — ${CLASSES.length} classes x 5 powers = ${ALL_POWERS.length} powers\n${rows.join("\n")}`);
});

Deno.test("PRINT: coverage — every shape and every element is used at least once", () => {
  const shapeCount = new Map<PowerShape, number>(POWER_SHAPES.map((s) => [s, 0]));
  const elemCount = new Map<Element, number>();
  for (const p of ALL_POWERS) {
    shapeCount.set(p.shape, (shapeCount.get(p.shape) ?? 0) + 1);
    elemCount.set(p.element, (elemCount.get(p.element) ?? 0) + 1);
  }
  for (const s of POWER_SHAPES) assert((shapeCount.get(s) ?? 0) >= 1, `shape ${s} is never used`);
  const allElements = Object.keys(ELEMENTS) as Element[];
  for (const e of allElements) assert((elemCount.get(e) ?? 0) >= 1, `element ${e} is never used`);
  const shapeRows = POWER_SHAPES.map((s) => `${s.padEnd(11)} ${String(shapeCount.get(s)).padStart(2)}`).join("   ");
  const elemRows = allElements.map((e) => `${e.padEnd(9)} ${String(elemCount.get(e) ?? 0).padStart(2)}`).join("   ");
  const comboSets = new Set(COMBOS.map((c) => `${c.from}->${c.then}`));
  console.log(`\nCOVERAGE\n  shapes:   ${shapeRows}\n  elements: ${elemRows}\n  combos:   ${COMBOS.length} entries, ${comboSets.size} distinct`);
});

Deno.test("PRINT: the combo table and the exclusion table", () => {
  const combos = COMBOS.map((c) =>
    `${c.from.padEnd(26)} -> ${c.then.padEnd(26)} dmg x${c.damageMul.toFixed(2)}  cast x${c.castMul.toFixed(2)}  ${c.why}`).join("\n");
  const excluded = EXCLUSIONS.map((e) => `${e.className.padEnd(12)} lacks ${e.shape.padEnd(11)} — ${e.why}`).join("\n");
  console.log(`\nCOMBO TABLE\n${combos}\n\nEXCLUSION TABLE\n${excluded}`);
});
