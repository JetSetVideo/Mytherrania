// Lane A: exact SDF primitives, rotation, every volume operator, region/bone ownership.
// Local assertion helpers (the suite takes no network dependency).
function assert(ok: boolean, msg = "assertion failed"): void { if (!ok) throw new Error(msg); }
function assertEquals<T>(a: T, b: T, msg = ""): void { if (a !== b) throw new Error(`${msg} expected ${String(b)}, got ${String(a)}`); }
function assertAlmostEquals(a: number, b: number, eps = 1e-9, msg = ""): void {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${msg} expected ${b} ± ${eps}, got ${a}`);
}
import { REGIONS, type Primitive, type SdfNode, type VolumeOp } from "../src/graphics/body/contracts.ts";
import {
  boneIndex, combine, evaluate, nodeBounds, primitiveDistance, regionIndex,
  sdCapsule, sdEllipsoid, sdRoundBox, sdRoundCone, sdSphere, sdTorus, smax, smin,
} from "../src/graphics/body/Sdf.ts";

const prim = (p: Partial<Primitive> & Pick<Primitive, "kind">): Primitive => ({
  id: p.kind, a: [0, 0, 0], r: 0.1, bone: "spine", region: "torso", ...p,
});
const leaf = (p: Primitive): SdfNode => ({ type: "primitive", primitive: p });

Deno.test("sphere is exact: inside negative, surface zero, outside the true distance", () => {
  assertAlmostEquals(sdSphere(0, 0, 0, 0.5), -0.5, 1e-12);
  assertAlmostEquals(sdSphere(0.5, 0, 0, 0.5), 0, 1e-12);
  assertAlmostEquals(sdSphere(0, 3, 4, 1), 4, 1e-12);
});

Deno.test("ellipsoid bound: zero on the surface along every axis, sign correct, sphere case exact", () => {
  const [rx, ry, rz] = [0.3, 0.2, 0.1];
  assertAlmostEquals(sdEllipsoid(rx, 0, 0, rx, ry, rz), 0, 1e-12);
  assertAlmostEquals(sdEllipsoid(0, ry, 0, rx, ry, rz), 0, 1e-12);
  assertAlmostEquals(sdEllipsoid(0, 0, -rz, rx, ry, rz), 0, 1e-12);
  assert(sdEllipsoid(0.1, 0.05, 0.02, rx, ry, rz) < 0);
  assert(sdEllipsoid(0.4, 0, 0, rx, ry, rz) > 0);
  assertAlmostEquals(sdEllipsoid(0.7, 0, 0, 0.5, 0.5, 0.5), 0.2, 1e-12);
  assertAlmostEquals(sdEllipsoid(0, 0, 0, rx, ry, rz), -0.1, 1e-12);
});

Deno.test("capsule is exact on the axis, on the side and past the caps", () => {
  assertAlmostEquals(sdCapsule(0.3, 0.5, 0, 0, 0, 0, 0, 1, 0, 0.1), 0.2, 1e-12);
  assertAlmostEquals(sdCapsule(0, 1.5, 0, 0, 0, 0, 0, 1, 0, 0.1), 0.4, 1e-12);
  assertAlmostEquals(sdCapsule(0, -0.2, 0, 0, 0, 0, 0, 1, 0, 0.1), 0.1, 1e-12);
});

Deno.test("round cone: matches its end spheres at the caps and the tangent line in between", () => {
  // r1 = 0.2 at the origin, r2 = 0.1 at y = 1.
  assertAlmostEquals(sdRoundCone(0, -0.5, 0, 0, 0, 0, 0, 1, 0, 0.2, 0.1), 0.3, 1e-9);
  assertAlmostEquals(sdRoundCone(0, 1.5, 0, 0, 0, 0, 0, 1, 0, 0.2, 0.1), 0.4, 1e-9);
  // Equal radii degenerate to a capsule.
  assertAlmostEquals(sdRoundCone(0.5, 0.5, 0, 0, 0, 0, 0, 1, 0, 0.1, 0.1), 0.4, 1e-9);
  // One sphere swallowing the other: the larger sphere.
  assertAlmostEquals(sdRoundCone(1, 0, 0, 0, 0, 0, 0, 0.05, 0, 0.5, 0.1), 0.5, 1e-9);
  // Side distance: the tangent line of a cone with slope (r1 − r2)/L; check a surface point.
  const L = 1, r1 = 0.2, r2 = 0.1, sinA = (r1 - r2) / L, cosA = Math.sqrt(1 - sinA * sinA);
  // The tangent point on sphere 1 lies at angle: n = (cosA, sinA) from the axis.
  assertAlmostEquals(sdRoundCone(r1 * cosA, r1 * sinA, 0, 0, 0, 0, 0, L, 0, r1, r2), 0, 1e-9);
});

Deno.test("round box: outer half-extents are the surface, corners rounded by r", () => {
  assertAlmostEquals(sdRoundBox(0.5, 0, 0, 0.5, 0.3, 0.2, 0.05), 0, 1e-12);
  assertAlmostEquals(sdRoundBox(0, 0.4, 0, 0.5, 0.3, 0.2, 0.05), 0.1, 1e-12);
  assertAlmostEquals(sdRoundBox(0, 0, 0, 0.5, 0.3, 0.2, 0.05), -0.2, 1e-12);
  // The corner sits r·(√3 − 1) inside the sharp corner.
  const c = sdRoundBox(0.5, 0.3, 0.2, 0.5, 0.3, 0.2, 0.05);
  assertAlmostEquals(c, 0.05 * (Math.sqrt(3) - 1), 1e-12);
});

Deno.test("torus: zero on the tube, minus the minor radius on the core circle", () => {
  assertAlmostEquals(sdTorus(0.5, 0, 0, 0.4, 0.1), 0, 1e-12);
  assertAlmostEquals(sdTorus(0, 0, 0.4, 0.4, 0.1), -0.1, 1e-12);
  assertAlmostEquals(sdTorus(0, 0, 0, 0.4, 0.1), 0.3, 1e-12);
});

Deno.test("rotation turns a primitive about its anchor (XYZ Euler, three.js convention)", () => {
  // A capsule along +y, rotated -90° about z, points along +x.
  const p = prim({ kind: "capsule", a: [1, 0, 0], b: [1, 1, 0], r: 0.1, rot: [0, 0, -Math.PI / 2] });
  assertAlmostEquals(primitiveDistance(p, [2, 0, 0]), -0.1, 1e-9);
  assertAlmostEquals(primitiveDistance(p, [1, 1, 0]), 0.9, 1e-9);
  // An ellipsoid long in x, rotated 90° about y, is long in z.
  const e = prim({ kind: "ellipsoid", size: [0.3, 0.1, 0.1], rot: [0, Math.PI / 2, 0] });
  assertAlmostEquals(primitiveDistance(e, [0, 0, 0.3]), 0, 1e-9);
  assert(primitiveDistance(e, [0.3, 0, 0]) > 0.15);
  // Torus rotated 90° about x lies in the xy plane.
  const t = prim({ kind: "torus", r: 0.4, r2: 0.1, rot: [Math.PI / 2, 0, 0] });
  assertAlmostEquals(primitiveDistance(t, [0, 0.5, 0]), 0, 1e-9);
  // roundBox rotated 90° about z swaps its x and y extents.
  const b = prim({ kind: "roundBox", size: [0.5, 0.2, 0.2], r: 0.02, rot: [0, 0, Math.PI / 2] });
  assertAlmostEquals(primitiveDistance(b, [0, 0.5, 0]), 0, 1e-9);
});

Deno.test("smooth min/max: equal to min/max outside the blend, deeper by k/4 at a tie", () => {
  assertEquals(smin(0.3, 0.1, 0.1), 0.1);
  assertAlmostEquals(smin(0.2, 0.2, 0.1), 0.2 - 0.025, 1e-12);
  assertAlmostEquals(smax(0.2, 0.2, 0.1), 0.2 + 0.025, 1e-12);
  assertEquals(smin(0.3, 0.1, 0), 0.1);
});

Deno.test("every volume operator obeys its definition", () => {
  const a = 0.05, b = -0.02, k = 0.1;
  const expect: Record<VolumeOp, number> = {
    union: Math.min(a, b),
    subtract: Math.max(a, -b),
    intersect: Math.max(a, b),
    smoothUnion: smin(a, b, k),
    smoothSubtract: smax(a, -b, k),
    smoothIntersect: smax(a, b, k),
  };
  for (const [op, v] of Object.entries(expect)) assertAlmostEquals(combine(op as VolumeOp, a, b, k), v, 1e-12, op);
  // Smooth union fills the crease between two spheres: the mid point between two touching
  // spheres is OUTSIDE the plain union but INSIDE the smooth union.
  const s1 = leaf(prim({ kind: "sphere", a: [-0.1, 0, 0], r: 0.1, region: "thigh", bone: "hipL" }));
  const s2 = leaf(prim({ kind: "sphere", a: [0.1, 0, 0], r: 0.1, region: "shin", bone: "kneeL" }));
  const mid: [number, number, number] = [0, 0.06, 0];
  assert(evaluate({ type: "op", op: "union", k: 0, children: [s1, s2] }, mid).d > 0);
  assert(evaluate({ type: "op", op: "smoothUnion", k: 0.08, children: [s1, s2] }, mid).d < 0);
});

Deno.test("region and bone: union picks the nearer child, a cutter keeps the left bone", () => {
  const thigh = leaf(prim({ kind: "sphere", a: [-0.1, 0, 0], r: 0.1, region: "thigh", bone: "hipL" }));
  const shin = leaf(prim({ kind: "sphere", a: [0.1, 0, 0], r: 0.1, region: "shin", bone: "kneeL" }));
  const u: SdfNode = { type: "op", op: "smoothUnion", k: 0.05, children: [thigh, shin] };
  const left = evaluate(u, [-0.15, 0, 0]);
  assertEquals(REGIONS[left.region], "thigh");
  assertEquals(left.bone, boneIndex("hipL"));
  const right = evaluate(u, [0.17, 0, 0]);
  assertEquals(REGIONS[right.region], "shin");
  assertEquals(right.bone, boneIndex("kneeL"));
  // Subtract: the socket wall takes the cutter's region but the head's bone.
  const head = leaf(prim({ kind: "sphere", r: 0.1, region: "head", bone: "head" }));
  const socket = leaf(prim({ kind: "sphere", a: [0, 0, 0.1], r: 0.04, region: "face", bone: "root" }));
  const carved: SdfNode = { type: "op", op: "subtract", k: 0, children: [head, socket] };
  const wall = evaluate(carved, [0, 0, 0.06]);
  assertAlmostEquals(wall.d, 0, 1e-12);
  assertEquals(wall.region, regionIndex("face"));
  assertEquals(wall.bone, boneIndex("head"));
  // Inside the socket the point is now outside the solid.
  assert(evaluate(carved, [0, 0, 0.08]).d > 0);
  // Intersect with a half-space box: the cut floor reads "sole", bone stays the foot's.
  const foot = leaf(prim({ kind: "sphere", a: [0, 0.02, 0], r: 0.05, region: "foot", bone: "ankleL" }));
  const ground = leaf(prim({ kind: "roundBox", a: [0, 1, 0], size: [1, 1, 1], r: 0.001, region: "sole", bone: "root" }));
  const cut = evaluate({ type: "op", op: "intersect", k: 0, children: [foot, ground] }, [0, 0, 0]);
  assertAlmostEquals(cut.d, 0, 1e-12);
  assertEquals(REGIONS[cut.region], "sole");
  assertEquals(cut.bone, boneIndex("ankleL"));
});

Deno.test("culling in a union never changes the value (bounding spheres are conservative)", () => {
  const kids: SdfNode[] = [];
  for (let i = 0; i < 12; i++) {
    kids.push(leaf(prim({ kind: i % 2 ? "ellipsoid" : "capsule", a: [i * 0.07, 0, 0], b: [i * 0.07, 0.2, 0.05], size: [0.05, 0.08, 0.03], r: 0.04 })));
  }
  const node: SdfNode = { type: "op", op: "smoothUnion", k: 0.03, children: kids };
  // Brute force with combine() and no culling.
  const brute = (x: number, y: number, z: number): number => {
    let d = evaluate(kids[0], [x, y, z]).d;
    for (let i = 1; i < kids.length; i++) d = smin(d, evaluate(kids[i], [x, y, z]).d, 0.03);
    return d;
  };
  for (let i = 0; i < 300; i++) {
    const p: [number, number, number] = [Math.sin(i * 1.3) * 0.6 + 0.4, Math.cos(i * 0.7) * 0.4, Math.sin(i * 2.1) * 0.3];
    assertAlmostEquals(evaluate(node, p).d, brute(...p), 1e-9);
  }
  const b = nodeBounds(node);
  assert(b.min[0] < -0.04 && b.max[0] > 0.77 + 0.04);
});
