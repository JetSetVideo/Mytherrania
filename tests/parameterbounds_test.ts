import {
  BOUNDS,
  BoundCategory,
  bound,
  boundsByCategory,
  clampToBound,
  outOfBounds,
  parameterCount,
  validateAll,
} from "../src/game/ParameterBounds.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

const CATEGORIES: BoundCategory[] = [
  "stats",
  "physics",
  "skills",
  "senses",
  "arena",
  "resources",
  "pickups",
  "ranking",
  "balance",
  "body",
  "ui",
];

Deno.test("every id is unique", () => {
  const seen = new Set<string>();
  for (const b of BOUNDS) {
    assert(!seen.has(b.id), `duplicate bound id: ${b.id}`);
    seen.add(b.id);
  }
  assert(seen.size === BOUNDS.length);
});

Deno.test("min <= max for every bound", () => {
  for (const b of BOUNDS) {
    assert(b.min <= b.max, `min>max for ${b.id}: ${b.min} > ${b.max}`);
  }
});

Deno.test("every declared category has at least one bound", () => {
  for (const c of CATEGORIES) {
    const list = boundsByCategory(c);
    assert(list.length >= 1, `category ${c} has no bounds`);
    for (const b of list) assert(b.category === c, `wrong category on ${b.id}`);
  }
});

Deno.test("registry covers at least 45 parameters", () => {
  assert(parameterCount() >= 45, `only ${parameterCount()} parameters`);
  assert(parameterCount() === BOUNDS.length);
});

Deno.test("bound() returns the matching Bound or null", () => {
  const b = bound("health_scale");
  assert(b !== null);
  assert(b!.id === "health_scale");
  assert(bound("does_not_exist") === null);
});

Deno.test("clampToBound respects both ends", () => {
  const b = bound("primary_attribute")!;
  assert(clampToBound("primary_attribute", b.min - 100) === b.min);
  assert(clampToBound("primary_attribute", b.max + 100) === b.max);
  assert(clampToBound("primary_attribute", b.min) === b.min);
  assert(clampToBound("primary_attribute", b.max) === b.max);
  assert(clampToBound("primary_attribute", (b.min + b.max) / 2) === (b.min + b.max) / 2);
});

Deno.test("clampToBound handles NaN and Infinity via midpoint", () => {
  for (const b of BOUNDS) {
    const mid = (b.min + b.max) / 2;
    assert(clampToBound(b.id, NaN) === mid, `NaN fallback wrong for ${b.id}`);
    assert(clampToBound(b.id, Infinity) === mid, `Infinity fallback wrong for ${b.id}`);
    assert(clampToBound(b.id, -Infinity) === mid, `-Infinity fallback wrong for ${b.id}`);
  }
});

Deno.test("clampToBound leaves unknown ids unchanged", () => {
  assert(clampToBound("nope", 12345) === 12345);
  assert(Number.isNaN(clampToBound("nope", NaN)));
});

Deno.test("outOfBounds agrees with clampToBound", () => {
  const samples = [-1e9, -1, 0, 0.05, 0.7, 1.1, 6, 16.6, 42, 100, 1000, 20000, 1e9];
  for (const b of BOUNDS) {
    const probes = [b.min, b.max, b.min - 1, b.max + 1, ...samples];
    for (const v of probes) {
      const clamped = clampToBound(b.id, v);
      assert(
        outOfBounds(b.id, v) === (clamped !== v),
        `disagreement for ${b.id} at ${v}`,
      );
    }
  }
});

Deno.test("outOfBounds flags non-finite values and ignores unknown ids", () => {
  assert(outOfBounds("health_scale", NaN) === true);
  assert(outOfBounds("health_scale", Infinity) === true);
  assert(outOfBounds("unknown_id", 5) === false);
});

Deno.test("known values are present and correct", () => {
  const check = (id: string, min: number, max: number) => {
    const b = bound(id);
    assert(b !== null, `missing bound ${id}`);
    assert(b!.min === min, `${id} min ${b!.min} != ${min}`);
    assert(b!.max === max, `${id} max ${b!.max} != ${max}`);
  };
  check("health_scale", 1000, 1000);
  check("damage_scale", 100, 100);
  check("primary_attribute", 1, 10);
  check("crit_chance", 0.03, 0.15);
  check("stun_duration", 0.05, 0.20);
  check("truce_duration", 6, 6);
  check("sight", 42, 42);
  check("hearing", 26, 26);
  check("touch", 1.1, 1.1);
  check("scent", 18, 18);
  check("magnetism", 30, 30);
  check("arena_size", 2, 320);
  check("wall_chance", 0, 1);
  check("wall_resistance", 100, 20000);
  check("elo_k", 32, 32);
  check("elo_start", 1000, 1000);
  check("balance_weight_feet", 0.2, 0.2);
  check("balance_weight_pelvis", 0.5, 0.5);
  check("balance_weight_shoulder", 0.3, 0.3);
  check("stance_threshold_stagger", 0.7, 0.7);
  check("stance_threshold_kneel", 1.15, 1.15);
  check("stance_threshold_fall", 1.6, 1.6);
  check("spine_vertebrae", 33, 33);
  check("section_exponent", 1.9, 2.45);
  check("frame_budget", 16.6, 16.6);
});

Deno.test("validateAll reports exactly the violating ids", () => {
  const values: Record<string, number> = {
    primary_attribute: 10, // in range
    crit_chance: 0.5, // above max
    sight: 1, // below min
    frame_budget: 16.6, // in range (min == max)
    health_scale: 1000, // in range
    elo_k: 100, // above max
  };
  const violations = validateAll(values);
  const ids = violations.map((v) => v.id).sort();
  assert(ids.length === 3, `expected 3 violations, got ${ids.length}`);
  assert(ids.join(",") === "crit_chance,elo_k,sight", ids.join(","));
  for (const v of violations) {
    const b = bound(v.id)!;
    assert(v.min === b.min && v.max === b.max);
    assert(v.value === values[v.id]);
  }
});

Deno.test("validateAll returns empty when all values are in range", () => {
  const violations = validateAll({
    primary_attribute: 1,
    crit_chance: 0.15,
    stun_duration: 0.05,
    arena_size: 320,
  });
  assert(violations.length === 0, `unexpected violations: ${violations.length}`);
});

Deno.test("validateAll ignores unknown ids and flags non-finite", () => {
  const violations = validateAll({ unknown_id: 999, health_scale: NaN });
  assert(violations.length === 1, `expected 1 violation, got ${violations.length}`);
  assert(violations[0].id === "health_scale");
  assert(Number.isNaN(violations[0].value));
});

Deno.test("boundsByCategory returns only that category", () => {
  const senses = boundsByCategory("senses");
  assert(senses.length === 5);
  for (const b of senses) assert(b.category === "senses");
  const ids = senses.map((b) => b.id).sort().join(",");
  assert(ids === "hearing,magnetism,scent,sight,touch", ids);
});

Deno.test("boundsByCategory returns empty array for a category with no bounds", () => {
  // All real categories are populated, so probe the filter with a bogus cast.
  const none = boundsByCategory("nonexistent" as BoundCategory);
  assert(Array.isArray(none) && none.length === 0);
});
