// Lane I-D: Clash maths. Hand-computed geometry for segSegClosest, the speed
// gate / threshold / strength rules for detectClash and the repeat gate.
import { canClash, clashStrength, CLASH_COOLDOWN, detectClash, MAX_CLASH_SPEED, MIN_CLASH_SPEED, segSegClosest } from "../src/combat/Clash.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok {
  if (!ok) throw new Error(m);
}
const EPS = 1e-9;
type P = readonly [number, number, number];

Deno.test("segSegClosest: crossing segments meet at 0, at the crossing point", () => {
  const r = segSegClosest([0, 0, 0], [2, 0, 0], [1, -1, 0], [1, 1, 0]);
  assert(Math.abs(r.d) < EPS, `d ${r.d}`);
  assert(Math.abs(r.at[0] - 1) < EPS && Math.abs(r.at[1]) < EPS && Math.abs(r.at[2]) < EPS, `at ${r.at}`);
});

Deno.test("segSegClosest: parallel offset segments give the offset", () => {
  const r = segSegClosest([0, 1, 0], [2, 1, 0], [0, -1, 0], [2, -1, 0]);
  assert(Math.abs(r.d - 2) < EPS, `d ${r.d}`);
  assert(Math.abs(r.at[1] - 1) < EPS, `at on the first segment ${r.at}`);
});

Deno.test("segSegClosest: perpendicular skew between known points", () => {
  // seg1 along x at y=5; seg2 along z at y=0, x=5. Closest pair (5,5,0)<->(5,0,0).
  const r = segSegClosest([0, 5, 0], [10, 5, 0], [5, 0, -5], [5, 0, 5]);
  assert(Math.abs(r.d - 5) < EPS, `d ${r.d}`);
  assert(Math.abs(r.at[0] - 5) < EPS && Math.abs(r.at[1] - 5) < EPS && Math.abs(r.at[2]) < EPS, `at ${r.at}`);
});

Deno.test("segSegClosest: a zero-length segment is a point, never NaN", () => {
  const r = segSegClosest([1, 1, 1], [1, 1, 1], [0, 0, 0], [2, 0, 0]);
  assert(Number.isFinite(r.d) && Math.abs(r.d - Math.SQRT2) < EPS, `d ${r.d}`);
  assert(r.at[0] === 1 && r.at[1] === 1 && r.at[2] === 1, `at ${r.at}`);
  // Both degenerate.
  const z = segSegClosest([3, 0, 0], [3, 0, 0], [0, 0, 0], [0, 0, 0]);
  assert(Math.abs(z.d - 3) < EPS, `d ${z.d}`);
});

Deno.test("segSegClosest: identical points give 0; reversed order gives the same distance", () => {
  const r = segSegClosest([3, 3, 3], [3, 3, 3], [3, 3, 3], [3, 3, 3]);
  assert(r.d === 0, `d ${r.d}`);
  assert(r.at.every(Number.isFinite), "finite point");
  const a: [P, P, P, P] = [[0, 0, 0], [1, 2, 3], [4, 0, 0], [4, 5, 1]];
  const f = segSegClosest(a[0], a[1], a[2], a[3]);
  const g = segSegClosest(a[2], a[3], a[0], a[1]);
  assert(Math.abs(f.d - g.d) < 1e-12, `symmetric distance ${f.d} vs ${g.d}`);
});

Deno.test("segSegClosest: total over degenerate/coincident/colinear inputs (no NaN)", () => {
  const cases: [P, P, P, P][] = [
    [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
    [[1, 1, 1], [1, 1, 1], [1, 1, 1], [2, 2, 2]],
    [[0, 0, 0], [1, 0, 0], [0, 0, 0], [1, 0, 0]], // overlapping colinear
    [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]], // colinear, apart
    [[-1e6, 5, 0], [1e6, 5, 0], [0, -1e6, 0], [0, 1e6, 0]],
  ];
  for (const [p1, q1, p2, q2] of cases) {
    const r = segSegClosest(p1, q1, p2, q2);
    assert(Number.isFinite(r.d) && r.d >= 0, `d ${r.d}`);
    assert(r.at.every(Number.isFinite), `at ${r.at}`);
  }
});

// --- detectClash -------------------------------------------------------------------------

const blade = (a: P, b: P, speed: number) => ({ a, b, speed });

Deno.test("detectClash: two blades at rest never clash, however close", () => {
  // Overlapping spans, but both idle.
  const a = blade([0, 0, 0], [2, 0, 0], 0);
  const b = blade([1, -1, 0], [1, 1, 0], 0);
  assert(detectClash(a, b, 0.5) === null, "idle blades sparked");
  // One moving is still not enough: BOTH must move.
  const fast = blade([1, -1, 0], [1, 1, 0], 10);
  assert(detectClash(blade([0, 0, 0], [2, 0, 0], 0), fast, 0.5) === null, "one moving blade sparked");
});

Deno.test("detectClash: beyond the threshold is null, within it is a contact", () => {
  const a = blade([0, 0, 0], [2, 0, 0], 8);
  const b = blade([0, 0.6, 0], [2, 0.6, 0], 8); // parallel, closest approach 0.6
  assert(detectClash(a, b, 0.5) === null, "contact beyond the threshold");
  const hit = detectClash(a, b, 0.7);
  assert(hit !== null, "contact within the threshold");
  assert(hit !== null && Math.abs(hit.strength - clashStrength(16)) < EPS, `strength ${hit?.strength}`);
});

Deno.test("detectClash: crossing blades at speed report a contact on both spans, strength in (0,1]", () => {
  const a = blade([0, 0, 0], [2, 0, 0], 6);
  const b = blade([1, -1, 0], [1, 1, 0], 9);
  const hit = detectClash(a, b, 0.05);
  assert(hit !== null, "crossing blades must clash");
  // `at` lies on both segments (the crossing point).
  const onSeg = (p: P, q: P, x: readonly number[]): boolean => {
    const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
    const wx = x[0] - p[0], wy = x[1] - p[1], wz = x[2] - p[2];
    const len2 = dx * dx + dy * dy + dz * dz;
    const s = len2 > 0 ? (wx * dx + wy * dy + wz * dz) / len2 : 0;
    if (s < -EPS || s > 1 + EPS) return false;
    return Math.hypot(wx - dx * s, wy - dy * s, wz - dz * s) < 1e-9;
  };
  assert(hit !== null && onSeg(a.a, a.b, hit.at) && onSeg(b.a, b.b, hit.at), `at ${hit?.at} not on both spans`);
  assert(hit !== null && hit.normal.every(Number.isFinite), "finite normal");
  assert(hit !== null && Math.abs(Math.hypot(hit.normal[0], hit.normal[1], hit.normal[2]) - 1) < 1e-9, "unit normal");
  assert(hit !== null && hit.strength > 0 && hit.strength <= 1, `strength ${hit?.strength}`);
});

Deno.test("detectClash: coincident spans give a finite, stable normal (never NaN)", () => {
  const a = blade([0, 0, 0], [1, 0, 0], 5);
  const b = blade([0, 0, 0], [1, 0, 0], 5);
  const hit = detectClash(a, b, 0.01);
  assert(hit !== null, "coincident moving spans clash");
  assert(hit !== null && hit.normal.every(Number.isFinite) && Math.abs(Math.hypot(...hit.normal) - 1) < 1e-9, "finite unit normal");
});

// --- clashStrength -----------------------------------------------------------------------

Deno.test("clashStrength: 0 at rest, monotone, saturates at 1, always in [0,1]", () => {
  assert(clashStrength(0) === 0, "rest is 0");
  assert(clashStrength(MIN_CLASH_SPEED / 2) === 0, "below the gate is 0");
  assert(clashStrength(MAX_CLASH_SPEED) === 1, "full at max speed");
  assert(clashStrength(MAX_CLASH_SPEED * 10) === 1, "clamped above max speed");
  let prev = -1;
  for (let v = 0; v <= MAX_CLASH_SPEED * 1.5; v += 0.5) {
    const s = clashStrength(v);
    assert(s >= 0 && s <= 1, `out of range at ${v}: ${s}`);
    assert(s >= prev, `not monotone at ${v}`);
    prev = s;
  }
  assert(clashStrength(MAX_CLASH_SPEED, 10, 10) === 1, "degenerate range, at max");
  assert(clashStrength(5, 10, 10) === 0, "degenerate range, below");
});

// --- canClash ----------------------------------------------------------------------------

Deno.test("canClash: the repeat gate honours the cooldown and a never-clashed blade", () => {
  assert(canClash(0, -Infinity) === true, "never clashed -> true");
  assert(canClash(1.0, 1.0) === false, "same instant -> false");
  assert(canClash(1.0 + CLASH_COOLDOWN - 1e-6, 1.0) === false, "just inside the cooldown");
  assert(canClash(1.0 + CLASH_COOLDOWN, 1.0) === true, "exactly at the cooldown");
  assert(canClash(1.0 + CLASH_COOLDOWN * 2, 1.0) === true, "well past the cooldown");
  assert(canClash(0.05, 0, 0.1) === false && canClash(0.1, 0, 0.1) === true, "custom cooldown");
});
