// Wave J lane J-T: map symmetry (src/game/arena/symmetry.ts) and start zones (src/game/arena/spawns.ts).
import { insideRing, makeArena, objectSize, placeObjects, randomArena, ringSymmetry, type ArenaConfig } from "../src/game/ArenaConfig.ts";
import { seededRng } from "../src/game/Items.ts";
import { generateArenaTerrain, heightAt, slopeAt } from "../src/world/Heightfield.ts";
import type { SymmetrySpec } from "../src/game/arena/contracts.ts";
import {
  applyOp, applyOpYaw, heightfieldAsymmetry, ringAsymmetry, symmetrizeHeightfield, symmetrizeObjects, symmetryFitsRing, symmetryFor,
  symmetryImages, symmetryOps, uniqueImages, ZONE_PROP_CLEARANCE,
} from "../src/game/arena/symmetry.ts";
import { minRingRadius, propIntrusion, spawnPlan, SPAWN_MAX_RISE, SPAWN_MAX_SLOPE } from "../src/game/arena/spawns.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}
const near = (a: { x: number; z: number }, b: { x: number; z: number }, eps = 1e-6) => Math.hypot(a.x - b.x, a.z - b.z) < eps;
const S = (kind: SymmetrySpec["kind"], order: number, axisDeg: number): SymmetrySpec => ({ kind, order, axisDeg });

Deno.test("symmetry images: group sizes, involutions, closure, and points on an axis", () => {
  const cases: [SymmetrySpec, number][] = [[S("none", 1, 0), 1], [S("mirror", 1, 30), 2], [S("mirror2", 2, 15), 4], [S("point", 2, 0), 2], [S("rotational", 3, 0), 3], [S("rotational", 5, 0), 5], [S("rotational", 6, 0), 6]];
  for (const [sym, size] of cases) {
    const ops = symmetryOps(sym);
    assert(ops.length === size, `${sym.kind}/${sym.order}: ${ops.length} elements`);
    const imgs = symmetryImages(sym, 3, 1);
    assert(near(imgs[0], { x: 3, z: 1 }), "identity first");
    for (const p of imgs) assert(Math.abs(Math.hypot(p.x, p.z) - Math.hypot(3, 1)) < 1e-9, "isometries keep the distance to the centre");
    // Closure: an image of an image is an image.
    for (const a of ops) for (const p of imgs) { const q = applyOp(a, p.x, p.z); assert(imgs.some((r) => near(r, q)), `${sym.kind}: not closed`); }
  }
  // A mirror is an involution and fixes its axis.
  const m = symmetryOps(S("mirror", 1, 30))[1];
  const p = applyOp(m, ...([2, -1] as const)), back = applyOp(m, p.x, p.z);
  assert(near(back, { x: 2, z: -1 }), "M·M = I");
  const onAxis = { x: 4 * Math.cos(Math.PI / 6), z: 4 * Math.sin(Math.PI / 6) };
  assert(uniqueImages(S("mirror", 1, 30), onAxis.x, onAxis.z).length === 1, "a point on the axis is its own image");
  assert(near(applyOp(symmetryOps(S("point", 2, 0))[1], 2, 5), { x: -2, z: -5 }), "point symmetry is (x, z) -> (-x, -z)");
  // Yaw transforms with the facing vector: a fighter facing the axis faces it in the mirror too.
  const yaw = Math.atan2(1, 0); // facing +x
  const my = applyOpYaw(symmetryOps(S("mirror", 1, 90))[1], yaw); // mirror across the z axis: +x -> -x
  assert(Math.abs(Math.sin(my) + 1) < 1e-9 && Math.abs(Math.cos(my)) < 1e-9, `mirrored yaw ${my}`);
});

Deno.test("the outline must agree with the symmetry: symmetryFor degrades what does not fit", () => {
  const tri = makeArena({ shape: 1, rotation: 0 }), sq = makeArena({ shape: 2, rotation: 0 }), hex = makeArena({ shape: 4, rotation: 0 });
  const pent = makeArena({ shape: 3, rotation: 0 }), oct = makeArena({ shape: 5, rotation: 0 }), oval = makeArena({ shape: 6, aspect: 1.6, rotation: 0 });
  const kindOf = (cfg: ArenaConfig, over: Partial<ArenaConfig>) => { const s = symmetryFor({ ...cfg, ...over }); return `${s.kind}${s.kind === "rotational" ? s.order : ""}`; };
  assert(kindOf(tri, { symmetry: 3 }) === "mirror", "a triangle has no point symmetry");
  assert(kindOf(tri, { symmetry: 4, symmetryOrder: 3 }) === "rotational3", "a triangle admits order 3");
  assert(kindOf(sq, { symmetry: 4, symmetryOrder: 3 }) === "mirror", "a square does not admit order 3");
  assert(kindOf(hex, { symmetry: 4, symmetryOrder: 6 }) === "rotational6", "a hexagon admits order 6");
  assert(kindOf(hex, { symmetry: 4, symmetryOrder: 4 }) === "point", "hexagon + order 4 -> gcd 2 -> point");
  assert(kindOf(oct, { symmetry: 4, symmetryOrder: 4 }) === "rotational4", "an octagon admits order 4");
  assert(kindOf(pent, { symmetry: 2 }) === "mirror", "a pentagon has no perpendicular axes");
  assert(kindOf(oval, { symmetry: 4, symmetryOrder: 3 }) === "mirror", "a stretched oval only has order 2");
  assert(kindOf(oval, { symmetry: 2 }) === "mirror2", "an oval has two perpendicular axes");
  // A mirror axis is snapped onto one of the outline's own axes.
  const s = symmetryFor({ ...pent, symmetry: 1, symmetryAxis: 20 });
  assert(ringSymmetry(pent).axesDeg.some((a) => Math.abs(a - s.axisDeg) < 1e-9), `axis ${s.axisDeg} is a pentagon axis`);
  assert(ringAsymmetry(pent, s) < 1e-9, "and the pentagon is symmetric about it");
  // Every random arena rolls a symmetry its outline admits: no degradation, a symmetric ring.
  const counts: Record<string, number> = {};
  for (let seed = 0; seed < 2000; seed++) {
    const cfg = randomArena(seededRng(seed));
    const rolled = ["none", "mirror", "mirror2", "point", "rotational"][cfg.symmetry];
    const sym = symmetryFor(cfg);
    assert(sym.kind === rolled, `seed ${seed}: rolled ${rolled}, got ${sym.kind}`);
    assert(sym.kind !== "rotational" || sym.order === cfg.symmetryOrder, `seed ${seed}: order changed`);
    assert(symmetryFitsRing(ringSymmetry(cfg), sym), `seed ${seed}: ${sym.kind} does not fit the outline`);
    const err = ringAsymmetry(cfg, sym);
    assert(err < 1e-6 * Math.max(1, cfg.size), `seed ${seed}: ${sym.kind}/${sym.order} on shape ${cfg.shape}: ring asymmetry ${err}`);
    const key = sym.kind + (sym.kind === "rotational" ? sym.order : "");
    counts[key] = (counts[key] ?? 0) + 1;
  }
  console.log("  symmetry rolls over 2000 arenas:", JSON.stringify(counts));
  assert(counts.none > 700 && counts.none < 900, "none ~40%");
  for (const k of ["mirror", "mirror2", "point", "rotational3", "rotational4", "rotational5", "rotational6"]) assert((counts[k] ?? 0) > 30, `${k} is reachable`);
});

Deno.test("symmetrized props: every image present, inside the ring, no overlaps, clear of the start zones", () => {
  let orbits = 0;
  for (let seed = 0; seed < 300; seed++) {
    const cfg = randomArena(seededRng(seed), { size: 40, objects: 12 });
    const sym = symmetryFor(cfg);
    const plan = spawnPlan(cfg, sym, null);
    const props = symmetrizeObjects(placeObjects(cfg, seededRng(seed + 1)), sym, cfg, plan.zones);
    for (const o of props) {
      assert(insideRing(cfg, o.x, o.z), `seed ${seed}: prop outside the ring`);
      for (const p of symmetryImages(sym, o.x, o.z)) assert(props.some((q) => q.kind === o.kind && near(q, p, 1e-6)), `seed ${seed} ${sym.kind}: missing image of a ${o.kind}`);
      for (const z of plan.zones) assert(Math.hypot(z.x - o.x, z.z - o.z) >= z.r + objectSize(o.kind).r * o.scale + ZONE_PROP_CLEARANCE - 1e-9, `seed ${seed}: prop in a start zone`);
    }
    for (let i = 0; i < props.length; i++) for (let j = i + 1; j < props.length; j++) {
      const a = props[i], b = props[j];
      assert(Math.hypot(a.x - b.x, a.z - b.z) >= (objectSize(a.kind).r * a.scale + objectSize(b.kind).r * b.scale) * 1.15 - 1e-9, `seed ${seed}: props ${i}/${j} overlap`);
    }
    if (sym.kind !== "none" && props.length) orbits++;
  }
  assert(orbits > 100, `symmetric prop sets checked: ${orbits}`);
  // A prop near a mirror axis is moved ONTO the axis (one prop, not two overlapping ones).
  const cfg = makeArena({ size: 30, shape: 0 });
  const out = symmetrizeObjects([{ kind: "pillar", x: 6, z: 0.2, y: 0, rotation: 0, scale: 1, solid: true }], S("mirror", 1, 0), cfg);
  assert(out.length === 1 && Math.abs(out[0].z) < 1e-12, `snapped onto the axis: ${JSON.stringify(out)}`);
});

Deno.test("symmetrized heightfield: a new field, symmetric up to grid sampling (max asymmetry measured)", () => {
  const cfg = makeArena({ size: 34, shape: 0 });
  const field = generateArenaTerrain(7, cfg);
  const before = Float32Array.from(field.heights);
  const rows: string[] = [];
  for (const sym of [S("mirror", 1, 30), S("mirror", 1, 0), S("mirror2", 2, 0), S("point", 2, 0), S("rotational", 3, 0), S("rotational", 4, 0), S("rotational", 5, 0), S("rotational", 6, 15)]) {
    const raw = heightfieldAsymmetry(field, sym);
    const out = symmetrizeHeightfield(field, sym);
    const e = heightfieldAsymmetry(out, sym);
    rows.push(`${sym.kind}${sym.order}@${sym.axisDeg}: before max ${raw.max.toFixed(3)} rms ${raw.rms.toFixed(3)} -> after max ${e.max.toFixed(4)} p99 ${e.p99.toFixed(4)} rms ${e.rms.toFixed(4)}`);
    assert(out !== field && out.heights !== field.heights, "a new field");
    assert(raw.rms > 0.1, "the source field is not symmetric (the test means something)");
    assert(e.rms < 0.02 && e.p99 < 0.06 && e.max < 0.15, `${sym.kind}/${sym.order}: residual asymmetry ${JSON.stringify(e)}`);
    // Node-preserving groups are exact.
    if ((sym.kind === "point" || sym.kind === "mirror2" || (sym.kind === "rotational" && sym.order === 4) || (sym.kind === "mirror" && sym.axisDeg === 0))) assert(e.max < 1e-5, `${sym.kind}: exact on the grid (${e.max})`);
    assert(out.heights.every((h) => Number.isFinite(h)), "finite heights");
  }
  console.log("  " + rows.join("\n  "));
  assert(field.heights.every((h, k) => h === before[k]), "the source field is not mutated");
});

Deno.test("spawns: inside their zones, zones inside the ring and apart, facing each other", () => {
  for (let seed = 0; seed < 400; seed++) {
    const cfg = randomArena(seededRng(seed));
    const sym = symmetryFor(cfg);
    const plan = spawnPlan(cfg, sym, null);
    assert(plan.spawns.length === 2 && plan.zones.length === 2, "two seats");
    const rMin = minRingRadius(cfg);
    plan.spawns.forEach((s, k) => {
      const z = plan.zones[k];
      assert(Math.hypot(s.x - z.x, s.z - z.z) <= z.r + 1e-9, `seed ${seed}: spawn ${k} outside its zone`);
      assert(Math.hypot(z.x, z.z) + z.r <= rMin + 1e-9, `seed ${seed}: zone ${k} leaves the ring`);
      const o = plan.spawns[1 - k];
      const want = Math.atan2(o.x - s.x, o.z - s.z);
      assert(Math.abs(Math.atan2(Math.sin(s.yaw - want), Math.cos(s.yaw - want))) < 1e-9, `seed ${seed}: seat ${k} does not face the other`);
    });
    const [a, b] = plan.zones;
    assert(Math.hypot(a.x - b.x, a.z - b.z) >= a.r + b.r - 1e-9, `seed ${seed}: zones overlap`);
    assert(plan.fair === (sym.kind !== "none"), `seed ${seed}: fair flag`);
    if (plan.fair) {
      // Seat 1 is an image of seat 0.
      const imgs = symmetryImages(sym, plan.spawns[0].x, plan.spawns[0].z);
      assert(imgs.some((p) => near(p, plan.spawns[1])), `seed ${seed} ${sym.kind}: seat 1 is not an image of seat 0`);
    }
  }
  // Opposite sides on point / even rotational / mirror maps.
  for (const sym of [S("point", 2, 30), S("rotational", 4, 0), S("mirror", 1, 45), S("mirror2", 2, 0)]) {
    const p = spawnPlan(makeArena({ size: 40 }), sym, null).spawns;
    assert(Math.abs(p[0].x + p[1].x) < 1e-9 && Math.abs(p[0].z + p[1].z) < 1e-9, `${sym.kind}: opposite seats`);
  }
  // More fighters on a rotational map: every seat an image, all distinct.
  const four = spawnPlan(makeArena({ size: 40 }), S("rotational", 6, 0), null, 4);
  assert(four.fair && four.spawns.length === 4, "4 seats on a 6-fold map are fair");
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert(!near(four.spawns[i], four.spawns[j], 0.1), "distinct seats");
});

Deno.test("spawns on generated terrain: flat, level with each other (fair maps), never inside a prop", () => {
  let fairChecked = 0;
  for (let seed = 0; seed < 12; seed++) {
    const cfg = randomArena(seededRng(seed * 7 + 3), { size: 34 });
    const sym = symmetryFor(cfg);
    const nominal = spawnPlan(cfg, sym, null);
    // The engine levels pads under the nominal spots, then symmetrizes the field, then re-plans.
    const raw = generateArenaTerrain(seed + 100, cfg, {}, { fairSpots: nominal.spawns.map((s) => ({ x: s.x, z: s.z })) });
    const field = symmetrizeHeightfield(raw, sym);
    const props = symmetrizeObjects(placeObjects(cfg, seededRng(seed)), sym, cfg, nominal.zones);
    const plan = spawnPlan(cfg, sym, field, 2, props);
    const h = plan.spawns.map((s) => heightAt(field, s.x, s.z));
    assert(Math.abs(h[0] - h[1]) <= SPAWN_MAX_RISE + 1e-6, `seed ${seed}: one seat ${Math.abs(h[0] - h[1]).toFixed(3)} m above the other`);
    for (const s of plan.spawns) {
      assert(propIntrusion(props, s.x, s.z) <= 0, `seed ${seed}: spawn inside a prop`);
      assert(slopeAt(field, s.x, s.z) <= SPAWN_MAX_SLOPE, `seed ${seed}: spawn on a slope ${slopeAt(field, s.x, s.z).toFixed(3)}`);
    }
    if (plan.fair) fairChecked++;
  }
  assert(fairChecked >= 4, `fair terrain maps checked: ${fairChecked}`);
});

Deno.test("symmetry: overrides merged after the roll still give exactly symmetric walls (axis snapped to the segment lattice)", async () => {
  const { randomArena } = await import("../src/game/ArenaConfig.ts");
  const { seededRng } = await import("../src/game/Items.ts");
  const { symmetryFor, symmetryImages } = await import("../src/game/arena/symmetry.ts");
  const { wallPlanFor } = await import("../src/game/arena/walls.ts");
  let checked = 0, worst = 0;
  for (let s = 0; s < 1500; s++) {
    // The override (as a menu choice / batch condition / QA nextArena does) replaces the rolled symmetry.
    const cfg = randomArena(seededRng(s), { walls: 1, symmetry: 1 + (s % 4), symmetryOrder: 3 + (s % 4) });
    const sym = symmetryFor(cfg);
    if (sym.kind === "none" || (sym.kind === "rotational" && 48 % sym.order !== 0)) continue;
    const plan = wallPlanFor(cfg, s * 7919, sym);
    for (const sg of plan.segments) {
      const mid = (sg.a0 + sg.a1) / 2;
      for (const { x, z } of symmetryImages(sym, Math.cos(mid), Math.sin(mid))) {
        const t = ((Math.atan2(z, x) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const img = plan.segments.find((q) => t >= q.a0 - 1e-9 && t < q.a1 + 1e-9)!;
        worst = Math.max(worst, Math.abs(img.height - sg.height));
      }
    }
    checked++;
  }
  if (checked < 800) throw new Error(`only ${checked} symmetric plans checked`);
  if (worst > 1e-9) throw new Error(`wall plan asymmetry ${worst} m (before the fix: up to 3.0 m on off-lattice mirror axes)`);
});
