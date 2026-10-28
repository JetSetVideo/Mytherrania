// The body-shape model: the equations, the race profiles and the loft builder.
// These pin the properties the overhaul is supposed to guarantee — organic sections,
// no right angles, races that read differently from every side.
import { bulge, blendGain, constraint, eccentricity, lobeGain, maxCorner, pinch, sectionGain, superellipse, taper, withinConstraint } from "../src/game/ShapeEquations.ts";
import { BODY_PARTS, BODY_STATES, constraintList, partShape, RACE_SILHOUETTE, raceConstraintScale, raceSilhouette, randomSilhouette, silhouetteScore, SILHOUETTE_TOP, STATE_JOINT_SCALE } from "../src/game/BodyProfile.ts";
import { blendStations, sectionRing, type LoftStation } from "../src/graphics/Loft.ts";
import { partExtent, stationsFor } from "../src/graphics/BodySurface.ts";
import { defaultHumanoid } from "../src/game/Skeleton.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

const RACES = ["human", "elf", "dwarf", "ork"];

// ---------------------------------------------------------------- equations

Deno.test("superellipse stays organic: never a corner, never wider than its axes", () => {
  for (const n of [1.75, 2, 2.45]) {
    const pts: { x: number; z: number }[] = [];
    for (let i = 0; i < 48; i++) pts.push(superellipse((i / 48) * Math.PI * 2, 0.3, 0.2, n));
    for (const p of pts) {
      assert(Math.abs(p.x) <= 0.3 + 1e-9 && Math.abs(p.z) <= 0.2 + 1e-9, "inside the axes");
    }
    // No right angles anywhere on the ring.
    assert(maxCorner(pts) < 0.35, `n=${n} must not corner (got ${maxCorner(pts)})`);
  }
});

Deno.test("taper, bulge and pinch behave as their equations say", () => {
  assert(Math.abs(taper(0, 1, 0.5, 1) - 1) < 1e-9, "taper starts at root");
  assert(Math.abs(taper(1, 1, 0.5, 1) - 0.5) < 1e-9, "taper ends at tip");
  assert(bulge(0.3, 0.3, 0.2, 0.5) > bulge(0.9, 0.3, 0.2, 0.5), "bulge peaks at its centre");
  assert(Math.abs(pinch(0.5, 0.5, 0.2, 0.3) - 0.7) < 1e-9, "pinch bites hardest at its centre");
  assert(pinch(0, 0.5, 0.2, 0.3) > 0.99, "pinch leaves the ends alone");
});

Deno.test("lobes add only where they face, and a negative lobe carves", () => {
  const lobes = [{ angle: 0, amp: 0.3, sharp: 2 }, { angle: Math.PI, amp: -0.2, sharp: 3 }];
  assert(lobeGain(0, lobes) > 0.29, "the front lobe fattens the front");
  assert(Math.abs(lobeGain(Math.PI / 2, lobes)) < 1e-9, "nothing faces the side");
  assert(lobeGain(Math.PI, lobes) < 0, "the back lobe carves a groove");
});

Deno.test("sectionGain multiplies its operators together (taper x pinch x lobes)", () => {
  const g = sectionGain(0.5, 0, [1, 0.5, 1], [[0.5, 0.2, 0.25]], [0.5, 0.2, 0.4], [{ angle: 0, amp: 0.5, sharp: 1 }]);
  // taper(0.5)=0.75, +bulge 0.25 => 1.0, pinch 0.6 => 0.6, lobes x1.5 => 0.9
  assert(Math.abs(g - 0.9) < 1e-6, `expected 0.9, got ${g}`);
});

Deno.test("blendGain is a smoothstep: exact at both ends, no overshoot inside", () => {
  assert(blendGain(0, 3, 7) === 3 && blendGain(1, 3, 7) === 7, "hits both sections");
  assert(blendGain(0.5, 3, 7) === 5, "midpoint");
  for (let u = 0; u <= 1; u += 0.05) {
    const v = blendGain(u, 3, 7);
    assert(v >= 3 - 1e-9 && v <= 7 + 1e-9, "never overshoots");
  }
});

Deno.test("constraints scale a joint's range and reject angles outside it", () => {
  const c = constraint(0, { min: -1, max: 1 }, 0.5, 1);
  assert(Math.abs(c.min + 0.5) < 1e-9 && Math.abs(c.max - 0.5) < 1e-9, "half the range");
  assert(withinConstraint(0.4, c) && !withinConstraint(0.6, c), "inside vs outside");
});

// ---------------------------------------------------------------- profiles

Deno.test("the brief's proportions hold: dwarf smallest, elf thinnest, ork heaviest", () => {
  const h = RACE_SILHOUETTE;
  assert(h.dwarf.height < h.human.height && h.dwarf.height < h.elf.height && h.dwarf.height < h.ork.height, "dwarf shortest");
  assert(h.elf.width < h.human.width && h.elf.width < h.dwarf.width && h.elf.width < h.ork.width, "elf thinnest");
  assert(h.ork.width > h.human.width && h.ork.muscle > h.human.muscle, "ork heaviest");
});

Deno.test("every part is completely specified, with an organic section exponent", () => {
  for (const p of BODY_PARTS) {
    const sh = partShape(p, RACE_SILHOUETTE.human);
    assert(sh.length > 0 && sh.root > 0, `${p} has a size`);
    assert(sh.depth > 0.3 && sh.depth < 2, `${p} depth is sane`);
    assert(sh.cap >= 0 && sh.cap <= 1, `${p} cap is a fraction`);
    assert(sh.lobes.length > 0, `${p} has at least one lobe`);
  }
  for (const r of RACES) {
    const n = RACE_SILHOUETTE[r].sectionN;
    assert(n >= 1.75 && n <= 2.45, `${r} section stays organic (got ${n})`);
  }
});

Deno.test("the state x joint table is COMPLETE and a braced state is narrower than a stand", () => {
  const joints = [...defaultHumanoid().limits().keys()];
  for (const st of BODY_STATES) {
    for (const j of joints) {
      assert(typeof STATE_JOINT_SCALE[st][j] === "number", `${st}/${j} must be listed`);
    }
  }
  // The joints a braced state must actually restrict. The ankle and toe stay free:
  // a block plants the feet, it does not lift them.
  const braced: (keyof typeof STATE_JOINT_SCALE.idle)[] = ["spine", "abdomen", "neck", "shoulderL", "shoulderR", "elbowL", "elbowR", "hipL", "hipR"];
  for (const j of braced) {
    assert(STATE_JOINT_SCALE.ko[j] < STATE_JOINT_SCALE.idle[j], `ko must brace ${j}`);
    assert(STATE_JOINT_SCALE.block[j] < STATE_JOINT_SCALE.idle[j], `block must brace ${j}`);
  }
});

Deno.test("constraintList resolves every joint for a state, and a heavy race travels less", () => {
  const limits = defaultHumanoid().limits();
  const idle = constraintList("idle", RACE_SILHOUETTE.human, limits);
  assert(idle.length === limits.size, "every joint is resolved");
  for (const c of idle) assert(c.min <= c.max && Number.isFinite(c.scale), `${c.joint} is a real range`);
  assert(raceConstraintScale(RACE_SILHOUETTE.elf) > raceConstraintScale(RACE_SILHOUETTE.dwarf), "the elf articulates more than the dwarf");
});

Deno.test("random silhouettes stay inside their race's band and still score well", () => {
  let seed = 7;
  const rng = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 200; i++) {
    const s = randomSilhouette(rng, "dwarf", "forge");
    for (const k of Object.keys(s) as (keyof typeof s)[]) {
      assert(s[k] <= SILHOUETTE_TOP[k] + 1e-9, `${k} is capped by the top value`);
      assert(s[k] > 0, `${k} stays positive`);
    }
    // A generated dwarf must still be a dwarf: near the race's own numbers.
    assert(Math.abs(s.height - RACE_SILHOUETTE.dwarf.height) < 0.09 * RACE_SILHOUETTE.dwarf.height * 1.5, "height stays in the band");
    assert(silhouetteScore(s) > 0.35, `a rolled body must still read (got ${silhouetteScore(s)})`);
  }
});

Deno.test("sub-species nudge a race without replacing it", () => {
  const base = raceSilhouette("elf", null);
  const high = raceSilhouette("elf", "high");
  assert(high.height !== base.height && high.width === base.width, "the tweak only moves what it names");
});

// ---------------------------------------------------------------- lofts

Deno.test("a lofted section has no right angles and is not a circle", () => {
  // A right angle is π/2 ≈ 1.571 rad. The bound is 0.6 rad (~34°): comfortably organic,
  // and it would catch any primitive sneaking back into the section.
  const MAX_TURN = 0.6;
  for (const p of BODY_PARTS) {
    const st = stationsFor(p, RACE_SILHOUETTE.human)[5];
    const ring = sectionRing(st, 22);
    assert(maxCorner(ring) < MAX_TURN, `${p} section must not corner (got ${maxCorner(ring)})`);
    const ecc = eccentricity(st.radius, st.radius * st.depth, st.lobes);
    assert(ecc > 0, `${p} must not be a plain circle`);
  }
});

Deno.test("blendStations carries one section into another monotonically", () => {
  const a: LoftStation = { t: 0, radius: 0.1, depth: 0.9, n: 2.1, lobes: [{ angle: 0, amp: 0.2, sharp: 2 }] };
  const b: LoftStation = { t: 1, radius: 0.05, depth: 0.6, n: 2.3, lobes: [{ angle: 0, amp: 0.05, sharp: 3 }] };
  const mid = blendStations(a, b, 5);
  assert(mid.length === 4, "count-1 intermediates");
  for (let i = 1; i < mid.length; i++) {
    assert(mid[i].radius < mid[i - 1].radius, "radius decreases monotonically");
    assert(mid[i].depth < mid[i - 1].depth, "depth decreases monotonically");
  }
  assert(mid[0].radius < a.radius && mid[mid.length - 1].radius > b.radius, "strictly between the two");
});

Deno.test("cross-race extents: the elf is the narrowest body and the ork the widest", () => {
  const width = (r: string) => {
    const s = RACE_SILHOUETTE[r];
    return BODY_PARTS.reduce((w, p) => Math.max(w, partExtent(p, s).width), 0);
  };
  const elf = width("elf"), human = width("human"), ork = width("ork");
  assert(elf < human, `elf (${elf.toFixed(3)}) must be narrower than human (${human.toFixed(3)})`);
  assert(ork > human, `ork (${ork.toFixed(3)}) must be wider than human (${human.toFixed(3)})`);
});
