// Tests for the equation registry: the formulas are well-formed data, the lookups
// are consistent, and every variable a formula reads is (or is reported as) a
// declared bound.
import {
  equation,
  equationsByCategory,
  equationsTouching,
  equationCount,
  EQUATIONS,
  inputsOf,
  unknownInputs,
} from "../src/game/EquationRegistry.ts";
import { bound } from "../src/game/ParameterBounds.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(String(message)); }

Deno.test("equation ids are unique", () => {
  const seen = new Set<string>();
  for (const e of EQUATIONS) {
    assert(!seen.has(e.id), `duplicate equation id ${e.id}`);
    seen.add(e.id);
  }
  assert(seen.size === EQUATIONS.length, "every id is distinct");
});

Deno.test("every equation names a category and a non-empty expression", () => {
  for (const e of EQUATIONS) {
    assert(typeof e.category === "string" && e.category.length > 0, `${e.id} has a category`);
    assert(typeof e.expression === "string" && e.expression.trim().length > 0, `${e.id} has an expression`);
    assert(typeof e.output === "string" && e.output.length > 0, `${e.id} names an output`);
    assert(typeof e.note === "string" && e.note.length > 0, `${e.id} carries a note`);
  }
});

Deno.test("every equation has at least one input", () => {
  for (const e of EQUATIONS) {
    assert(Array.isArray(e.inputs), `${e.id} has an inputs array`);
    assert(e.inputs.length >= 1, `${e.id} reads at least one parameter`);
    for (const id of e.inputs) assert(typeof id === "string" && id.length > 0, `${e.id} input ids are non-empty strings`);
  }
});

Deno.test("inputsOf is non-empty for every equation", () => {
  for (const e of EQUATIONS) {
    assert(inputsOf(e.id).length >= 1, `inputsOf(${e.id}) is non-empty`);
  }
});

Deno.test("inputsOf returns a copy, not the registry's own array", () => {
  const a = inputsOf("health");
  a.push("MUTATED");
  assert(!inputsOf("health").includes("MUTATED"), "mutating the returned array does not touch the registry");
});

Deno.test("equationsTouching is the inverse of inputsOf", () => {
  for (const e of EQUATIONS) {
    for (const id of e.inputs) {
      assert(equationsTouching(id).some((t) => t.id === e.id), `equationsTouching(${id}) includes ${e.id}`);
    }
  }
  // ...and the other direction: everything reported as touching a parameter names it.
  const params = new Set(EQUATIONS.flatMap((e) => e.inputs));
  for (const p of params) {
    for (const e of equationsTouching(p)) assert(e.inputs.includes(p), `${e.id} reported for ${p} must read it`);
  }
});

Deno.test("equationCount matches the array length", () => {
  assert(equationCount() === EQUATIONS.length, "count equals the array length");
  assert(equationCount() >= 24, `at least 24 equations, got ${equationCount()}`);
});

Deno.test("a known id returns its exact expression", () => {
  const e = equation("health");
  assert(e, "health exists");
  assert(e.expression === "clamp(33 + 1.7*VIT + 0.55*STR, 34, 58) * HEALTH_SCALE", `exact health expression, got ${e.expression}`);
  const crit = equation("crit");
  assert(crit, "crit exists");
  assert(crit.expression === "clamp(REF*0.008 / (RES*0.010 + 0.1), 0.03, 0.15)", "exact crit expression");
  const elo = equation("eloExpected");
  assert(elo, "eloExpected exists");
  assert(elo.expression === "1 / (1 + 10^((rb - ra)/400))", "exact Elo expected expression");
});

Deno.test("an unknown id returns null", () => {
  assert(equation("does-not-exist") === null, "unknown id is null");
  assert(equation("") === null, "empty id is null");
});

Deno.test("equationsByCategory returns only that category", () => {
  const combat = equationsByCategory("combat");
  assert(combat.length > 0, "combat has formulas");
  for (const e of combat) assert(e.category === "combat", `${e.id} is combat`);
});

Deno.test("equationsByCategory partitions every equation exactly once", () => {
  const cats = ["combat", "physics", "animation", "ai", "perception", "environment", "presentation"] as const;
  const total = cats.reduce((n, c) => n + equationsByCategory(c).length, 0);
  assert(total === EQUATIONS.length, `categories cover all ${EQUATIONS.length} equations, got ${total}`);
});

Deno.test("equationsByCategory of an unknown category is empty", () => {
  assert(equationsByCategory("nonsense" as never).length === 0, "unknown category yields no formulas");
});

Deno.test("inputsOf of an unknown id is empty", () => {
  assert(inputsOf("does-not-exist").length === 0, "unknown id has no inputs");
});

Deno.test("equationsTouching of an unknown parameter is empty", () => {
  assert(equationsTouching("does-not-exist").length === 0, "no formula reads an unknown parameter");
});

Deno.test("unknownInputs are genuinely unbounded and exclude the scale constants", () => {
  const missing = unknownInputs();
  assert(Array.isArray(missing), "returns an array");
  const allInputs = new Set(EQUATIONS.flatMap((e) => e.inputs));
  for (const id of missing) {
    assert(allInputs.has(id), `${id} must be read by some equation`);
    assert(id !== "HEALTH_SCALE" && id !== "DAMAGE_SCALE", "scale constants are treated as declared");
    assert(!bound(id), `${id} is reported missing so it must have no declared bound`);
  }
});

Deno.test("the registry covers the required combat, physics and animation formulas", () => {
  const required = [
    "health", "crit", "damage", "stun", "physicsMultiplier", "density", "toughness", "impulse",
    "eloExpected", "mmr", "eloUpsetDelta", "balanceSway", "stanceInstability", "moveStep",
    "gripRestPitch", "taper", "muscleBulge", "waistPinch", "superellipse", "blendSmoothstep",
    "senseRange", "luminosity", "regen", "buffMultiplier", "occlusionAlpha",
  ];
  for (const id of required) assert(equation(id) !== null, `registry is missing ${id}`);
});
