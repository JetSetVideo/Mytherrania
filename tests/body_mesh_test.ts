// Lane A: the polygoniser makes closed, consistently wound meshes; the checker can FAIL; and
// every race, light and heavy, generates ONE watertight skin with its soles flat on y = 0.
import genes from "../artifacts/design/race-genes.json" with { type: "json" };
import { REGIONS, type BrushKind, type MeshData, type SdfNode, type VolumeOp } from "../src/graphics/body/contracts.ts";
import { compileSdf, BONE_IDS, fieldToFunction } from "../src/graphics/body/Sdf.ts";
import { polygonize, polygonizeField } from "../src/graphics/body/Polygonize.ts";
import { meshStats, signedVolume, windingConflicts } from "../src/graphics/body/MeshStats.ts";
import { generateBody } from "../src/graphics/body/BodyMesh.ts";
import { anatomyFor, BONE_PARENT } from "../src/graphics/body/Anatomy.ts";
import { TRIANGLE_TARGET } from "../src/graphics/body/Proportions.ts";
import { bodyField } from "../src/graphics/body/BodyMesh.ts";
import { defaultHumanoid, type JointName } from "../src/game/Skeleton.ts";
import { SUBRACE_SILHOUETTE } from "../src/game/BodyProfile.ts";

function assert(ok: boolean, msg = "assertion failed"): void { if (!ok) throw new Error(msg); }

/**
 * Triangle budget per body: the anatomy aims its cell at TRIANGLE_TARGET (9 000) from a
 * measured sign-change count; the budget allows a third more for the estimate's error.
 */
const TRIANGLE_BUDGET = Math.round(TRIANGLE_TARGET * 4 / 3); // 12 000

const mk = (pos: number[], idx: number[]): MeshData => ({
  positions: new Float32Array(pos), normals: new Float32Array(pos.length), indices: new Uint32Array(idx), region: new Uint8Array(pos.length / 3),
});
const TET = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
const TET_IDX = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];

Deno.test("meshStats can FAIL: open, two-piece and non-manifold meshes are reported", () => {
  const closed = meshStats(mk(TET, TET_IDX));
  assert(closed.boundaryEdges === 0 && closed.nonManifoldEdges === 0 && closed.components === 1, `closed tetra ${JSON.stringify(closed)}`);
  const open = meshStats(mk(TET, TET_IDX.slice(0, 9))); // one face removed
  assert(open.boundaryEdges === 3, `open tetra boundaryEdges ${open.boundaryEdges}`);
  const two = meshStats(mk([...TET, ...TET.map((v, i) => (i % 3 === 0 ? v + 5 : v))], [...TET_IDX, ...TET_IDX.map((i) => i + 4)]));
  assert(two.components === 2 && two.boundaryEdges === 0, `two tetras: ${JSON.stringify(two)}`);
  const fin = meshStats(mk([...TET, 0.5, -1, 0.5], [...TET_IDX, 0, 1, 4])); // a third face on edge 0-1
  assert(fin.nonManifoldEdges === 1, `fin nonManifoldEdges ${fin.nonManifoldEdges}`);
  assert(windingConflicts(mk(TET, [0, 1, 2, 0, 1, 3, 0, 3, 2, 1, 2, 3])) > 0, "a flipped face is a winding conflict");
});

Deno.test("a polygonised sphere is closed, outward-wound, and has the right volume", () => {
  const node: SdfNode = { type: "primitive", primitive: { id: "s", kind: "sphere", a: [0, 0, 0], r: 0.2, bone: "spine", region: "torso" } };
  const mesh = polygonize(fieldToFunction(compileSdf(node)), { min: [-0.3, -0.3, -0.3], max: [0.3, 0.3, 0.3] }, 0.02);
  const s = meshStats(mesh);
  assert(s.boundaryEdges === 0 && s.nonManifoldEdges === 0 && s.components === 1, JSON.stringify(s));
  assert(windingConflicts(mesh) === 0, "consistent winding");
  const v = signedVolume(mesh), exact = 4 / 3 * Math.PI * 0.2 ** 3;
  assert(v > 0 && Math.abs(v - exact) / exact < 0.03, `volume ${v} vs ${exact}`);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const dot = mesh.normals[i] * mesh.positions[i] + mesh.normals[i + 1] * mesh.positions[i + 1] + mesh.normals[i + 2] * mesh.positions[i + 2];
    assert(dot > 0, `normal ${i / 3} points inward`);
    assert(Math.abs(Math.hypot(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]) - 0.2) < 0.01, "vertex off the surface");
  }
});

Deno.test("ambiguous faces: two spheres kissing diagonally are non-manifold raw, manifold resolved", () => {
  // Spheres centred at ±(R/√2, R/√2, 0) touch at the origin; grid corners at (±c/2, ±c/2)
  // give the checkerboard face (inside on one diagonal, outside on the other).
  const R = 0.1, c = 0.02, o = R / Math.SQRT2;
  const node: SdfNode = { type: "op", op: "union", k: 0, children: [
    { type: "primitive", primitive: { id: "a", kind: "sphere", a: [o, o, 0], r: R, bone: "spine", region: "torso" } },
    { type: "primitive", primitive: { id: "b", kind: "sphere", a: [-o, -o, 0], r: R, bone: "spine", region: "torso" } },
  ] };
  const f = compileSdf(node);
  const bounds = { min: [-0.2 - c / 2, -0.2 - c / 2, -0.12 - c / 2] as [number, number, number], max: [0.2, 0.2, 0.12] as [number, number, number] };
  const raw = meshStats(polygonizeField(f, bounds, c, { resolveAmbiguity: false }));
  assert(raw.nonManifoldEdges > 0, `the raw grid should show the defect (got ${raw.nonManifoldEdges})`);
  const fixed = meshStats(polygonizeField(f, bounds, c));
  assert(fixed.nonManifoldEdges === 0 && fixed.boundaryEdges === 0 && fixed.components === 1, JSON.stringify(fixed));
});

Deno.test("narrow-band sampling produces the SAME mesh as sampling every corner", () => {
  const plan = anatomyFor({ race: "human", subrace: null, className: "Warrior", height: 1.7, weight: 70, seed: 3 });
  const f = bodyField(plan);
  const a = polygonizeField(f, plan.bounds, plan.cell, { narrowBand: true });
  const b = polygonizeField(f, plan.bounds, plan.cell, { narrowBand: false });
  assert(a.indices.length === b.indices.length && a.positions.length === b.positions.length, "sizes differ");
  for (let i = 0; i < a.indices.length; i++) assert(a.indices[i] === b.indices[i], `index ${i}`);
  for (let i = 0; i < a.positions.length; i++) assert(a.positions[i] === b.positions[i], `position ${i}`);
});

const RACES = Object.keys(genes.races);
/** Light and heavy: BMI 17 and 34 (kg/m²) at each race's typical height. */
const BUILDS: [string, number][] = [["light", 17], ["heavy", 34]];
const TYPICAL_HEIGHT: Record<string, number> = { human: 1.7, elf: 1.77, dwarf: 1.39, ork: 1.9 };

function checkBody(label: string, race: string, subrace: string | null, height: number, weight: number): void {
  const b = generateBody({ race, subrace, className: "Warrior", height, weight, seed: 11 });
  const s = b.stats, c = b.plan.cell;
  const tag = `${label} ${JSON.stringify(s)} cell ${c.toFixed(4)}`;
  assert(s.boundaryEdges === 0, `boundary edges: ${tag}`);
  assert(s.nonManifoldEdges === 0, `non-manifold edges: ${tag}`);
  assert(s.components === 1, `components: ${tag}`);
  assert(Math.abs(s.minY) <= c / 2, `soles not on the ground: ${tag}`);
  assert(s.maxY > height - 2 * c && s.maxY < height + c, `crown not at the height: ${tag}`);
  assert(s.triangles <= TRIANGLE_BUDGET, `over the triangle budget ${TRIANGLE_BUDGET}: ${tag}`);
  assert(windingConflicts(b.mesh) === 0 && signedVolume(b.mesh) > 0, `winding: ${tag}`);
  // Flat soles: per foot, many vertices on y = 0 spread along the foot (not a point).
  for (const side of [1, -1]) {
    const zs: number[] = [];
    for (let v = 0; v < b.mesh.positions.length / 3; v++) {
      const x = b.mesh.positions[v * 3], y = b.mesh.positions[v * 3 + 1];
      if (Math.sign(x) === side && Math.abs(y) < 0.1 * c) zs.push(b.mesh.positions[v * 3 + 2]);
    }
    const span = zs.length ? Math.max(...zs) - Math.min(...zs) : 0;
    assert(zs.length >= 5, `${label}: only ${zs.length} sole vertices on y=0 (side ${side})`);
    assert(span >= 0.35 * b.plan.proportions.foot, `${label}: sole contact spans ${span.toFixed(3)} m of a ${b.plan.proportions.foot.toFixed(3)} m foot`);
  }
  // Region labels are REGIONS indices and the sole region exists on the ground.
  let sole = 0;
  for (let v = 0; v < b.mesh.region.length; v++) {
    assert(b.mesh.region[v] < REGIONS.length, "region index out of range");
    if (REGIONS[b.mesh.region[v]] === "sole") sole++;
  }
  assert(sole > 0, `${label}: no vertex labelled sole`);
}

for (const race of RACES) {
  for (const [build, bmi] of BUILDS) {
    const height = TYPICAL_HEIGHT[race] ?? 1.7;
    const weight = Math.round(bmi * height * height);
    Deno.test(`${race} ${build} (${height} m, ${weight} kg): one closed skin, soles flat on y = 0, within budget`, () => {
      checkBody(`${race}/${build}`, race, null, height, weight);
    });
  }
}

Deno.test("every sub-race builds a whole skin at a mid weight", () => {
  const raceOf: Record<string, string> = {
    imperial: "human", nomad: "human", islander: "human", high: "elf", wood: "elf", dark: "elf",
    mountain: "dwarf", forge: "dwarf", deep: "dwarf", greenhide: "ork", ironhide: "ork", bloodfang: "ork",
  };
  for (const sub of Object.keys(SUBRACE_SILHOUETTE)) {
    const race = raceOf[sub] ?? "human";
    const h = TYPICAL_HEIGHT[race];
    checkBody(`${race}/${sub}`, race, sub, h, Math.round(24 * h * h));
  }
});

function collectOps(n: SdfNode, out: Set<VolumeOp>): Set<VolumeOp> {
  if (n.type === "op") { out.add(n.op); for (const c of n.children) collectOps(c, out); }
  return out;
}

Deno.test("anatomy uses the volume operators and EVERY brush kind, each with a purpose", () => {
  const plan = anatomyFor({ race: "ork", subrace: null, className: "Barbarian", height: 1.9, weight: 110, seed: 5 });
  const ops = collectOps(plan.root, new Set());
  for (const op of ["smoothUnion", "subtract", "intersect", "smoothSubtract", "smoothIntersect"] as VolumeOp[]) assert(ops.has(op), `op ${op} unused`);
  const kinds = new Set(plan.strokes.map((s) => s.kind));
  const all: BrushKind[] = ["inflate", "deflate", "dig", "pushPull", "pinch", "crease", "flatten", "smooth", "twist", "bend"];
  for (const k of all) assert(kinds.has(k), `brush ${k} unused`);
  for (const s of plan.strokes) assert(s.purpose.length > 3 && s.radius > 0, `stroke ${s.kind} lacks a purpose/radius`);
});

Deno.test("bones: root + one per Skeleton joint, Humanoid's tree, Skeleton axes, heads inside the bounds", () => {
  const plan = anatomyFor({ race: "elf", subrace: "wood", className: "Archer", height: 1.68, weight: 60, seed: 9 });
  const sk = defaultHumanoid();
  assert(plan.bones.length === sk.jointNames().length + 1, `bone count ${plan.bones.length}`);
  plan.bones.forEach((b, i) => {
    assert(b.id === BONE_IDS[i], `bone order ${b.id}`);
    assert(b.parent === BONE_PARENT[b.id], `parent of ${b.id}`);
    if (b.id !== "root") assert(b.axis === sk.joint(b.id as JointName).axis, `axis of ${b.id}`);
    for (let k = 0; k < 3; k++) assert(b.head[k] >= plan.bounds.min[k] && b.head[k] <= plan.bounds.max[k], `${b.id} head outside bounds`);
  });
  // +x is the character's LEFT: every L bone sits at x > 0.
  for (const b of plan.bones) if (b.id.endsWith("L")) assert(b.head[0] > 0, `${b.id} not on the left (+x)`);
});

Deno.test("proportions are derived: 7.5 heads for a human, races ordered by their genes", () => {
  const P = (race: string, h: number, w: number) => anatomyFor({ race, subrace: null, className: "Warrior", height: h, weight: w, seed: 1 }).proportions;
  const human = P("human", 1.7, 70), dwarf = P("dwarf", 1.7, 70), elf = P("elf", 1.7, 70), ork = P("ork", 1.7, 70);
  assert(Math.abs(human.headsTall - 7.5) < 1e-9 && Math.abs(human.head - 1.7 / 7.5) < 1e-9, `human head ${human.head}`);
  assert(dwarf.headsTall < human.headsTall && elf.headsTall > human.headsTall, "head size ordering");
  assert(dwarf.y.hipJoint < human.y.hipJoint && elf.y.hipJoint > human.y.hipJoint, "leg length ordering at equal height");
  assert(ork.halfWidth.chest > human.halfWidth.chest && elf.halfWidth.chest < human.halfWidth.chest, "width ordering");
  const light = P("human", 1.7, 50), heavy = P("human", 1.7, 100);
  assert(heavy.girth > light.girth && heavy.halfDepth.belly > light.halfDepth.belly, "weight drives girth");
});
