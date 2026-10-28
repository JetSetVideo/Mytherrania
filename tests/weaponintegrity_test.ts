import {
  canPass,
  CANNOT_PASS_THROUGH,
  connectionBetween,
  integrity,
  WEAPON_CHAIN,
  type PartSocket,
  type WeaponPartId,
} from "../src/game/WeaponIntegrity.ts";

function assert(ok: boolean, message = "assertion failed"): void {
  if (!ok) throw new Error(message);
}

/** A socket on the weapon's +y axis at height `y`, offering section `radius`. */
const sock = (part: WeaponPartId, y: number, radius: number): PartSocket => ({
  part,
  position: { x: 0, y, z: 0 },
  normal: { x: 0, y: 1, z: 0 },
  radius,
});

/** A well-formed hilt → tip chain: every joint within gap and radius tolerance. */
function aligned(): PartSocket[] {
  return [
    sock("pommel", -0.01, 0.025),
    sock("grip", 0, 0.0225),
    sock("guard", 0.01, 0.03),
    sock("blade", 0.02, 0.025),
  ];
}

Deno.test("a well-formed chain is a valid, whole weapon", () => {
  const r = integrity(aligned());
  assert(r.state === "valid", "aligned chain is valid");
  assert(r.brokenAt.length === 0, "nothing is broken");
  assert(r.connections.every((c) => c.legal), "every joint is legal");
});

Deno.test("a missing blade is broken and named", () => {
  const r = integrity(aligned().filter((s) => s.part !== "blade"));
  assert(r.state === "broken", "a weapon without its blade is broken");
  assert(r.brokenAt.includes("blade"), "brokenAt names the missing blade");
});

Deno.test("a misaligned guard is broken and named", () => {
  const parts = aligned();
  parts[2] = sock("guard", 0.2, 0.03); // shoved 0.2 m off the grip
  const r = integrity(parts);
  assert(r.state === "broken", "a guard off its seat breaks the weapon");
  assert(r.brokenAt.includes("guard"), "brokenAt names the misaligned guard");
});

Deno.test("the gap boundary: just inside maxGap is legal, just outside is not", () => {
  const grip = sock("grip", 0, 0.02);
  const inside = connectionBetween(grip, sock("guard", 0.019, 0.02));
  const at = connectionBetween(grip, sock("guard", 0.02, 0.02));
  const outside = connectionBetween(grip, sock("guard", 0.021, 0.02));
  assert(inside.legal, "a gap just inside maxGap is legal");
  assert(at.legal, "a gap exactly at maxGap is legal");
  assert(!outside.legal, "a gap just outside maxGap is refused");
  assert(outside.reason.includes("maxGap"), "the refusal explains the gap");
});

Deno.test("the radius-delta boundary: just inside is legal, just outside is not", () => {
  const grip = sock("grip", 0, 0.5);
  const guard = sock("guard", 0, 1.0); // relative delta = 0.5 exactly
  const at = connectionBetween(grip, guard, 0.02, 0.5);
  const tight = connectionBetween(grip, guard, 0.02, 0.4999);
  const loose = connectionBetween(grip, guard, 0.02, 0.5001);
  assert(at.legal, "a delta exactly at maxRadiusDelta is legal");
  assert(!tight.legal, "a delta just above the tolerance is refused");
  assert(loose.legal, "a delta inside the tolerance is legal");
  assert(tight.reason.includes("radius delta"), "the refusal explains the radius");
});

Deno.test("canPass is true only for chain neighbours", () => {
  assert(!canPass("pommel", "blade"), "a pommel cannot pass through the blade");
  assert(!canPass("blade", "pommel"), "forbidden the other way too");
  assert(!canPass("guard", "guard"), "a part cannot join itself");
  assert(!canPass("pommel", "pommel"), "a part cannot join itself");
  for (const [x, y] of WEAPON_CHAIN) {
    assert(canPass(x, y), `${x} joins ${y}`);
    assert(canPass(y, x), `${y} joins ${x}`);
  }
  for (const [x, y] of CANNOT_PASS_THROUGH) {
    assert(!canPass(x, y), `${x} must not pass through ${y}`);
    assert(!canPass(y, x), `${y} must not pass through ${x}`);
  }
});

Deno.test("a non-finite socket is refused, never a NaN in gap", () => {
  const bad: PartSocket = { part: "guard", position: { x: NaN, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, radius: 0.03 };
  const c = connectionBetween(sock("grip", 0, 0.02), bad);
  assert(!c.legal, "an invalid socket is refused");
  assert(!Number.isNaN(c.gap), "gap is not NaN");
  assert(!Number.isNaN(c.radiusDelta), "radiusDelta is not NaN");

  const badRadius: PartSocket = { part: "guard", position: { x: 0, y: 0.01, z: 0 }, normal: { x: 0, y: 1, z: 0 }, radius: Infinity };
  const cr = connectionBetween(sock("grip", 0, 0.02), badRadius);
  assert(!cr.legal && !Number.isNaN(cr.gap), "a non-finite radius is refused without a NaN gap");

  const r = integrity([...aligned().filter((s) => s.part !== "guard"), bad]);
  assert(r.state === "broken", "a weapon with a NaN socket is broken");
  assert(r.connections.every((c2) => !Number.isNaN(c2.gap) && !Number.isNaN(c2.radiusDelta)), "no NaN leaks into the report");
});

Deno.test("there is one connection per consecutive chain pair, in order", () => {
  const r = integrity(aligned());
  assert(r.connections.length === WEAPON_CHAIN.length, "one connection per chain pair");
  WEAPON_CHAIN.forEach(([x, y], i) => {
    const c = r.connections[i];
    assert(c.a === x && c.b === y, `connection ${i} is ${x}-${y}`);
  });
});

Deno.test("the forbidden pairs are exactly the non-adjacent pairs", () => {
  assert(CANNOT_PASS_THROUGH.length === 3, "three non-adjacent pairs");
  const key = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  const adjacent = new Set(WEAPON_CHAIN.map(([x, y]) => key(x, y)));
  for (const [x, y] of CANNOT_PASS_THROUGH) {
    assert(!adjacent.has(key(x, y)), `${x}-${y} is not a chain adjacency`);
  }
});
