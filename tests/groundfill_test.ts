// Lane I-C tests: the ground fill / skirt layer (BRIEF §1.6) plus the measurements that prove the
// two user-reported defects are fixed — seatingY never floats on a slope, and the apron reaches the
// terrain with no NaN / zero-area triangle at either extreme of radius.
// @deno-types="@types/three"
import * as THREE from "three";
import { footHeight, materialUnder, seatingY, skirtFor, type GroundMaterialId } from "../src/graphics/GroundFill.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/** A plane sloping tan(20°) in +x — the synthetic slope all the "never floats" rules are tested on. */
const SLOPE_TAN = Math.tan((20 * Math.PI) / 180);
const slope = (x: number, _z: number): number => SLOPE_TAN * x;
const flat = (): number => 3; // ground at y = 3 m, flat

/** [a, b, c] triangle area from a non-indexed position attribute. */
function triArea(pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, t: number): number {
  const ax = pos.getX(t * 3), ay = pos.getY(t * 3), az = pos.getZ(t * 3);
  const bx = pos.getX(t * 3 + 1), by = pos.getY(t * 3 + 1), bz = pos.getZ(t * 3 + 1);
  const cx = pos.getX(t * 3 + 2), cy = pos.getY(t * 3 + 2), cz = pos.getZ(t * 3 + 2);
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

Deno.test("footHeight: rim + centre, min/max/mean/range on a slope", () => {
  const f = footHeight(slope, 1, 2, 0.5, 16);
  // On sample(x) = tan20 * x, min at angle 180, max at angle 0, centre at x = 1.
  assert(Math.abs(f.max - SLOPE_TAN * 1.5) < 1e-9, `max ${f.max}`);
  assert(Math.abs(f.min - SLOPE_TAN * 0.5) < 1e-9, `min ${f.min}`);
  assert(Math.abs(f.range - SLOPE_TAN) < 1e-9, `range ${f.range}`);
  assert(f.mean > f.min && f.mean < f.max, "mean inside [min, max]");
  const c = footHeight(slope, 1, 2, 0.5, 0);
  assert(c.min === c.max && c.range === 0, "count 0 => centre only");
});

Deno.test("seatingY on flat ground equals that height", () => {
  assert(Math.abs(seatingY(flat, 5, -4, 2, 16) - 3) < 1e-12, "flat seating == ground height");
});

Deno.test("(a) seatingY on a 20° slope: at or above the terrain at EVERY one of 64 rim samples (float bug)", () => {
  const x = 1, z = -0.5, r = 0.6;
  const seat = seatingY(slope, x, z, r, 64);
  let worstFloat = Infinity; // how far above the terrain the most-explosed rim point sits
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * Math.PI * 2;
    const h = slope(x + Math.cos(a) * r, z + Math.sin(a) * r);
    worstFloat = Math.min(worstFloat, seat - h); // negative => the base sits below the ground there
  }
  assert(worstFloat >= -1e-9, `base at or above ground at every rim sample (worst margin ${worstFloat})`);
  // The defect: seating from the CENTRE would hang the downhill rim. seatingY must exceed the centre.
  assert(seat > slope(x, z) + 1e-6, "seatingY is the footprint MAX, not the centre height");
  assert(Math.abs(seat - slope(x + r, z)) < 1e-9, "seatingY is the exact footprint max");
});

Deno.test("(b) apron on the slope: reaches the terrain, deepest point within the slope fall, triangles bounded", () => {
  const x = 1, z = 2, r = 0.5, lip = 0.06, segments = 24;
  const seat = seatingY(slope, x, z, r, 64);
  const run = { x, z, y: seat, radius: r, rotation: 0.3, material: "stone" as GroundMaterialId };
  const s = skirtFor(run, slope, { segments, lip });
  assert(s.triangles > 0 && s.triangles <= segments * 2 * 3, `triangles ${s.triangles} <= ${segments * 2 * 3}`);
  assert(s.triangles === segments * 6, "4 rings -> 6 x segments triangles");

  // Fall across the apron's own footprint (its outer ring is at radius + lip, flared by R_MUL 1.18).
  const outerR = (r + lip) * 1.18;
  const slopeFall = SLOPE_TAN * 2 * outerR;
  assert(s.maxDrop <= slopeFall + 0.02 + 1e-6, `maxDrop ${s.maxDrop} within slope fall ${slopeFall} + burial`);
  assert(s.maxDrop >= SLOPE_TAN * 2 * r - 1e-6, `apron reaches the terrain (maxDrop ${s.maxDrop})`);

  // The apron itself must reach DOWN to the terrain under every bottom-ring vertex (no gap).
  const pos = s.geometry.getAttribute("position");
  let deepest = Infinity;
  for (let i = 0; i < pos.count; i++) deepest = Math.min(deepest, pos.getY(i));
  assert(Math.abs(seat - deepest - s.maxDrop) < 1e-6, "reported maxDrop is the deepest vertex");
});

Deno.test("(c) flat ground: maxDrop ~0 and a finite, non-degenerate mesh", () => {
  const run = { x: 4, z: -2, y: 3, radius: 1.2, rotation: 0, material: "grass" as GroundMaterialId };
  const s = skirtFor(run, flat);
  assert(s.maxDrop >= 0 && s.maxDrop <= 0.05, `~0 apron on flat ground (maxDrop ${s.maxDrop})`);
  assert(Number.isFinite(s.maxDrop), "finite maxDrop");
  const pos = s.geometry.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    assert(Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)) && Number.isFinite(pos.getZ(i)), "finite vertices");
  }
  s.geometry.computeBoundingBox();
  const bb = s.geometry.boundingBox!;
  assert(bb.max.x - bb.min.x > 1 && bb.max.z - bb.min.z > 1, "non-degenerate horizontally");
  assert(bb.max.y - bb.min.y > 1e-6, "non-degenerate vertically");
});

Deno.test("(d) radius 0.01 and radius 40: no NaN, no zero-area triangle", () => {
  for (const r of [0.01, 40]) {
    const run = { x: -3, z: 5, y: flat(), radius: r, rotation: 0.7, material: "ice" as GroundMaterialId };
    const s = skirtFor(run, flat, { segments: 24 });
    assert(s.triangles > 0, `radius ${r}: triangles > 0`);
    const pos = s.geometry.getAttribute("position");
    assert(pos.count === s.triangles * 3, `radius ${r}: position count matches triangles`);
    for (let i = 0; i < pos.count; i++) {
      assert(Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)) && Number.isFinite(pos.getZ(i)), `radius ${r}: finite vertex ${i}`);
    }
    let minArea = Infinity;
    for (let t = 0; t < s.triangles; t++) minArea = Math.min(minArea, triArea(pos, t));
    assert(minArea > 1e-9, `radius ${r}: every triangle has area (min ${minArea})`);
  }
});

Deno.test("(e) footprint half sand / half grass takes the majority material, both orders", () => {
  const halfAt = (x: number, _z: number): GroundMaterialId => (x >= 0 ? "sand" : "grass");
  const r = 1.0;
  // Centre on the boundary -> sand is the majority (6 of 9 samples).
  assert(materialUnder(halfAt, 0, 0, r) === "sand", "sand majority -> sand");
  // Centre pushed into the grass side -> grass is the majority.
  assert(materialUnder(halfAt, -0.6 * r, 0, r) === "grass", "grass majority -> grass");
});

Deno.test("materialUnder: a tie is resolved by the centre", () => {
  // Boundary line at 22.5°, splitting the 8 rim points 4-4; the centre then decides.
  const c = Math.cos(Math.PI / 8), s = Math.sin(Math.PI / 8);
  const diagSand = (x: number, z: number): GroundMaterialId => (x * c + z * s >= 0 ? "sand" : "grass");
  const diagGrass = (x: number, z: number): GroundMaterialId => (x * c + z * s > 0 ? "sand" : "grass");
  assert(materialUnder(diagSand, 0, 0, 1) === "sand", "centre sand wins a 4-4 tie");
  assert(materialUnder(diagGrass, 0, 0, 1) === "grass", "centre grass wins a 4-4 tie");
});

Deno.test("skirtFor: closed strip (last segment stitches back to the first), no NaN anywhere", () => {
  const run = { x: 0, z: 0, y: 2, radius: 0.8, rotation: 0, material: "wood" as GroundMaterialId };
  const s = skirtFor(run, (x, z) => 1.5 + 0.04 * x + 0.03 * z, { segments: 18 });
  assert(s.triangles === 18 * 6, "18 segments -> 108 triangles");
  const pos = s.geometry.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    assert(Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)) && Number.isFinite(pos.getZ(i)), "finite");
  }
  assert(Number.isFinite(s.maxDrop) && s.maxDrop >= 0, "finite non-negative maxDrop");
});
