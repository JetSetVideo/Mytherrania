// Tests for graphics/Stitch.ts — the seam welder: boundary rings, cap-closure removal,
// and the merge of two proximal rims into one surface.

// @deno-types="@types/three"
import * as THREE from "three";
import { loftGeometry, type LoftStation } from "../src/graphics/Loft.ts";
import { endRing, pairByProximity, planSeam, weldSeam } from "../src/graphics/Stitch.ts";

function assert(ok: unknown, message?: string): asserts ok {
  if (!ok) throw new Error(message ?? "assertion failed");
}

const SIDES = 12;

/** Six evenly spaced stations of one radius: a straight tube. */
function ringStations(count: number, radius: number): LoftStation[] {
  const out: LoftStation[] = [];
  for (let i = 0; i < count; i++) out.push({ t: i / (count - 1), radius, depth: 1, n: 2, lobes: [] });
  return out;
}

/** A real loft, domed at both ends, running y = 0 .. height. */
function loft(height: number): THREE.BufferGeometry {
  return loftGeometry({ stations: ringStations(6, 0.1), sides: SIDES, capRings: 3, capDepth: 0.2 }, height);
}

function positions(geo: THREE.BufferGeometry): THREE.Vector3[] {
  const pos = geo.getAttribute("position");
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) out.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
  return out;
}

function vertexCount(geo: THREE.BufferGeometry): number {
  return geo.getAttribute("position").count;
}

function triangleAreas(geo: THREE.BufferGeometry): number[] {
  const pos = geo.getAttribute("position");
  const areas: number[] = [];
  for (let t = 0; t + 2 < pos.count; t += 3) {
    const a = new THREE.Vector3(pos.getX(t), pos.getY(t), pos.getZ(t));
    const b = new THREE.Vector3(pos.getX(t + 1), pos.getY(t + 1), pos.getZ(t + 1));
    const c = new THREE.Vector3(pos.getX(t + 2), pos.getY(t + 2), pos.getZ(t + 2));
    areas.push(b.sub(a).cross(c.sub(a)).length() * 0.5);
  }
  return areas;
}

/** Two lofts placed end-to-end with a 0.01 m rim gap: a weldable joint. */
function joint(): { a: THREE.BufferGeometry; b: THREE.BufferGeometry } {
  return { a: loft(0.5), b: loft(0.5).translate(0, 0.51, 0) };
}

Deno.test("endRing returns the boundary ring, sides vertices, no apex", () => {
  const a = loft(0.5);
  assert(endRing(a, "last").length === SIDES, `last ring: ${endRing(a, "last").length} != ${SIDES}`);
  assert(endRing(a, "first").length === SIDES, `first ring: ${endRing(a, "first").length} != ${SIDES}`);
});

Deno.test("planSeam welds two lofts placed end-to-end", () => {
  const { a, b } = joint();
  const { report, pairs } = planSeam(a, "last", b, "first");
  assert(report.welded, report.reason);
  assert(pairs.length > 0, "expected pairs");
});

Deno.test("weldSeam drops the cap closure and merges the rims", () => {
  const { a, b } = joint();
  const before = vertexCount(a.toNonIndexed()) + vertexCount(b.toNonIndexed());
  const { geometry, report } = weldSeam(a, "last", b, "first");
  assert(report.welded, report.reason);
  assert(!geometry.index, "output must be non-indexed");
  assert(vertexCount(geometry) < before, `expected fewer vertices: ${vertexCount(geometry)} < ${before}`);
  const areas = triangleAreas(geometry);
  assert(areas.length > 0, "expected triangles");
  assert(areas.every((s) => s > 1e-10), "no output triangle may be degenerate");
});

Deno.test("no output vertex sits on a dropped cap position", () => {
  const { a, b } = joint();
  const dropped = [...positions(a).filter((v) => v.y > 0.5 + 1e-6), ...positions(b).filter((v) => v.y < 0.51 - 1e-6)];
  assert(dropped.length > 0, "expected cap vertices to drop");
  const { geometry } = weldSeam(a, "last", b, "first");
  const hits = positions(geometry).filter((v) => dropped.some((d) => d.distanceTo(v) < 1e-6));
  assert(hits.length === 0, `${hits.length} output vertices reference a dropped cap vertex`);
});

Deno.test("far lofts are refused and left untouched", () => {
  const a = loft(0.5);
  const b = loft(0.5).translate(0, 2, 0);
  const { geometry, report } = weldSeam(a, "last", b, "first");
  assert(!report.welded, "expected refusal");
  assert(geometry.getAttribute("position").count === vertexCount(a.toNonIndexed()) + vertexCount(b.toNonIndexed()), "output must be the concatenation");
  const source = new Set([...positions(a), ...positions(b)].map((v) => `${v.x.toFixed(6)},${v.y.toFixed(6)},${v.z.toFixed(6)}`));
  const moved = positions(geometry).filter((v) => !source.has(`${v.x.toFixed(6)},${v.y.toFixed(6)},${v.z.toFixed(6)}`));
  assert(moved.length === 0, `${moved.length} vertices moved on a refused seam`);
});

Deno.test("pairByProximity is deterministic and one-to-one", () => {
  const { a, b } = joint();
  const ra = endRing(a, "last");
  const rb = endRing(b, "first");
  const p1 = pairByProximity(ra, rb);
  const p2 = pairByProximity(ra, rb);
  assert(JSON.stringify(p1) === JSON.stringify(p2), "not deterministic");
  const bis = p1.map((p) => p.bi);
  assert(new Set(bis).size === bis.length, "a b index was reused");
  for (let i = 1; i < p1.length; i++) {
    const prev = p1[i - 1];
    const cur = p1[i];
    assert(prev.distance < cur.distance || (prev.distance === cur.distance && prev.ai <= cur.ai), "not sorted by distance then ai");
  }
});
