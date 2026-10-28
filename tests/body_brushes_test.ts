// Lane A: every sculpt brush changes the field (or mesh) where it should and leaves every
// point outside its radius bit-identical.
import type { BrushKind, BrushStroke, SdfNode, SdfSample, Vec3 } from "../src/graphics/body/contracts.ts";
import { compileSdf, type BodyField } from "../src/graphics/body/Sdf.ts";
import {
  applyFieldBrush, applyFieldBrushes, applyMeshBrushes, brushWeight, FIELD_BRUSHES, MESH_BRUSHES, smoothMesh,
} from "../src/graphics/body/Brushes.ts";
import { polygonizeField } from "../src/graphics/body/Polygonize.ts";
import { meshStats } from "../src/graphics/body/MeshStats.ts";

function assert(ok: boolean, msg = "assertion failed"): void { if (!ok) throw new Error(msg); }

const ALL_KINDS: BrushKind[] = ["inflate", "deflate", "dig", "pushPull", "pinch", "crease", "flatten", "smooth", "twist", "bend"];
const sphere: SdfNode = { type: "primitive", primitive: { id: "ball", kind: "sphere", a: [0, 0, 0], r: 0.3, bone: "spine", region: "torso" } };
const box: SdfNode = { type: "primitive", primitive: { id: "box", kind: "roundBox", a: [0, 0, 0], size: [0.2, 0.3, 0.1], r: 0.02, bone: "spine", region: "torso" } };
const S = (): SdfSample => ({ d: 0, region: 0, bone: 0 });
const d = (f: BodyField, p: Vec3): number => f.sample(p[0], p[1], p[2], S()).d;

/** Deterministic points spread over a 1 m cube around the origin. */
function cloud(n: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) out.push([Math.sin(i * 12.9898) * 0.5, Math.sin(i * 78.233) * 0.5, Math.sin(i * 37.719) * 0.5]);
  return out;
}

/** A regular grid of points strictly inside the ball (c, R), `n` per axis. */
function ball(c: Vec3, R: number, n = 15): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
    const p: Vec3 = [c[0] + R * (2 * i / (n - 1) - 1), c[1] + R * (2 * j / (n - 1) - 1), c[2] + R * (2 * k / (n - 1) - 1)];
    if (Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) < R * 0.98) out.push(p);
  }
  return out;
}

/** Every point at |p − c| ≥ R returns the SAME distance, region and bone as the base field. */
function assertUntouchedOutside(base: BodyField, brushed: BodyField, st: BrushStroke): number {
  let checked = 0;
  for (const p of cloud(4000)) {
    if (Math.hypot(p[0] - st.centre[0], p[1] - st.centre[1], p[2] - st.centre[2]) < st.radius) continue;
    const a = base.sample(p[0], p[1], p[2], S()), b = brushed.sample(p[0], p[1], p[2], S());
    assert(a.d === b.d && a.region === b.region && a.bone === b.bone, `${st.kind} changed an outside point ${p}: ${a.d} -> ${b.d}`);
    checked++;
  }
  assert(checked > 1000, `${st.kind}: too few outside points checked (${checked})`);
  return checked;
}

Deno.test("brush kinds are partitioned into field and mesh domains and cover every BrushKind", () => {
  const covered = new Set([...FIELD_BRUSHES, ...MESH_BRUSHES]);
  for (const k of ALL_KINDS) assert(covered.has(k), `brush ${k} has no implementation domain`);
  assert(covered.size === ALL_KINDS.length, "a brush is listed twice");
  let threw = false;
  try { applyFieldBrush(compileSdf(sphere), { kind: "smooth", centre: [0, 0, 0], radius: 1, strength: 0.1, purpose: "t" }); } catch { threw = true; }
  assert(threw, "smooth must refuse the field domain");
});

Deno.test("falloff: 1 at the centre, 0 at and beyond the radius, monotone between", () => {
  const st: BrushStroke = { kind: "inflate", centre: [0, 0, 0], radius: 0.2, strength: 0.01, purpose: "t" };
  assert(brushWeight(st, 0, 0, 0) === 1, "centre weight");
  assert(brushWeight(st, 0.2, 0, 0) === 0 && brushWeight(st, 0.5, 0, 0) === 0, "edge weight");
  let prev = 1;
  for (let r = 0.01; r < 0.2; r += 0.01) { const w = brushWeight(st, r, 0, 0); assert(w <= prev && w > 0, `monotone at ${r}`); prev = w; }
});

Deno.test("inflate / deflate move the surface by exactly the strength at the centre", () => {
  const base = compileSdf(sphere);
  const top: Vec3 = [0, 0.3, 0];
  for (const [kind, sign] of [["inflate", -1], ["deflate", 1]] as const) {
    const st: BrushStroke = { kind, centre: top, radius: 0.15, strength: 0.03, purpose: kind };
    const f = applyFieldBrush(base, st);
    assert(Math.abs(d(f, top) - (d(base, top) + sign * 0.03)) < 1e-12, `${kind} at the centre`);
    // A point just outside the old surface is inside after inflating (outside after deflating).
    const probe: Vec3 = kind === "inflate" ? [0, 0.315, 0] : [0, 0.285, 0];
    assert(kind === "inflate" ? d(f, probe) < 0 : d(f, probe) > 0, `${kind} moved the surface`);
    assertUntouchedOutside(base, f, st);
  }
});

Deno.test("dig carves a cavity at the centre, pushPull translates the surface along its axis", () => {
  const base = compileSdf(sphere);
  const dig: BrushStroke = { kind: "dig", centre: [0, 0.3, 0], radius: 0.15, strength: 0.03, purpose: "notch" };
  const fd = applyFieldBrush(base, dig);
  assert(d(base, [0, 0.285, 0]) < 0 && d(fd, [0, 0.285, 0]) > 0, "dig hollowed a point just under the surface");
  assert(d(fd, [0, 0.3, 0]) > 0, "dig opened the centre");
  assertUntouchedOutside(base, fd, dig);
  const push: BrushStroke = { kind: "pushPull", centre: [0, 0.3, 0], radius: 0.15, strength: 0.03, axis: [0, 1, 0], purpose: "brow" };
  const fp = applyFieldBrush(base, push);
  assert(d(base, [0, 0.315, 0]) > 0 && d(fp, [0, 0.315, 0]) < 0, "pushPull raised the surface along +y");
  const pull = applyFieldBrush(base, { ...push, strength: -0.03 });
  assert(d(pull, [0, 0.285, 0]) > 0, "a negative pushPull lowers it");
  assertUntouchedOutside(base, fp, push);
});

Deno.test("pinch pulls the surface toward its centre", () => {
  const base = compileSdf(sphere);
  const st: BrushStroke = { kind: "pinch", centre: [0, 0.36, 0], radius: 0.15, strength: 0.05, purpose: "tendon" };
  const f = applyFieldBrush(base, st);
  assert(d(base, [0, 0.31, 0]) > 0 && d(f, [0, 0.31, 0]) < 0, "the top moved up toward the centre above it");
  assertUntouchedOutside(base, f, st);
});

Deno.test("crease cuts a narrow groove along its axis", () => {
  const base = compileSdf(sphere);
  const st: BrushStroke = { kind: "crease", centre: [0.3, 0, 0], radius: 0.15, strength: 0.02, axis: [0, 1, 0], purpose: "spine" };
  const f = applyFieldBrush(base, st);
  assert(Math.abs(d(f, [0.3, 0, 0]) - 0.02) < 1e-12, "groove depth at the line equals the strength");
  assert(d(f, [0.29, 0.05, 0]) > d(base, [0.29, 0.05, 0]), "groove continues along the axis");
  // Beyond the groove half-width (0.3·R = 0.045 m) across the axis the surface is unchanged.
  const across: Vec3 = [0.3 * Math.cos(0.2), 0, 0.3 * Math.sin(0.2)];
  assert(Math.abs(d(f, across) - d(base, across)) < 1e-12, "crease is narrow");
  assertUntouchedOutside(base, f, st);
});

Deno.test("flatten presses material on the +axis side onto the plane, at most |s| deep", () => {
  const base = compileSdf(sphere);
  const st: BrushStroke = { kind: "flatten", centre: [0, 0.28, 0], radius: 0.15, strength: 0.05, axis: [0, 1, 0], purpose: "sole" };
  const f = applyFieldBrush(base, st);
  assert(d(base, [0, 0.29, 0]) < 0 && d(f, [0, 0.29, 0]) > 0, "material above the plane removed");
  assert(d(f, [0, 0.27, 0]) < 0, "material below the plane kept");
  const shallow = applyFieldBrush(base, { ...st, strength: 0.005 });
  assert(d(shallow, [0, 0.299, 0]) - d(base, [0, 0.299, 0]) <= 0.005 + 1e-12, "the press is capped at |s|");
  assertUntouchedOutside(base, f, st);
});

Deno.test("twist and bend rotate the domain inside the radius (bend only on its lever side)", () => {
  const base = compileSdf(box);
  const tw: BrushStroke = { kind: "twist", centre: [0, 0.15, 0], radius: 0.2, strength: 0.08, axis: [0, 1, 0], purpose: "pronation" };
  const ft = applyFieldBrush(base, tw);
  let changed = 0;
  for (const p of ball(tw.centre, tw.radius)) if (Math.abs(d(ft, p) - d(base, p)) > 1e-4) changed++;
  assert(changed > 20, `twist changed only ${changed} inside points`);
  assertUntouchedOutside(base, ft, tw);
  const bend: BrushStroke = { kind: "bend", centre: [0, 0.3, 0], radius: 0.2, strength: -0.06, axis: [1, 0, 0], purpose: "toe spring" };
  const fb = applyFieldBrush(base, bend);
  let ahead = 0, behind = 0;
  for (const p of ball(bend.centre, bend.radius)) {
    const delta = Math.abs(d(fb, p) - d(base, p));
    if (p[2] > 0.02 && delta > 1e-5) ahead++;
    if (p[2] <= 0 && delta > 0) behind++;
  }
  assert(ahead > 10, `bend changed only ${ahead} points on its lever side`);
  assert(behind === 0, `bend touched ${behind} points behind its lever`);
  assertUntouchedOutside(base, fb, bend);
});

Deno.test("smooth relaxes mesh vertices inside its radius only, within its displacement cap", () => {
  const field = compileSdf(box);
  const mesh = polygonizeField(field, { min: [-0.3, -0.4, -0.2], max: [0.3, 0.4, 0.2] }, 0.02);
  const before = mesh.positions.slice();
  const st: BrushStroke = { kind: "smooth", centre: [0.2, 0.3, 0.1], radius: 0.12, strength: 0.01, purpose: "corner" };
  const moved = smoothMesh(mesh, st);
  assert(moved > 5, `smooth reached only ${moved} vertices`);
  let outside = 0, shifted = 0;
  for (let v = 0; v < before.length / 3; v++) {
    const p: Vec3 = [before[v * 3], before[v * 3 + 1], before[v * 3 + 2]];
    const delta = Math.hypot(mesh.positions[v * 3] - p[0], mesh.positions[v * 3 + 1] - p[1], mesh.positions[v * 3 + 2] - p[2]);
    const w = brushWeight(st, ...p);
    if (w === 0) { outside++; assert(delta === 0, `vertex ${v} outside the radius moved by ${delta}`); }
    else { assert(delta <= st.strength * w + 1e-6, `vertex ${v} moved ${delta} > cap ${st.strength * w}`); if (delta > 1e-5) shifted++; }
  }
  assert(outside > 100 && shifted > 3, `outside ${outside}, shifted ${shifted}`);
  const s = meshStats(mesh);
  assert(s.boundaryEdges === 0 && s.components === 1, "smoothing never changes topology");
  // applyMeshBrushes runs only the mesh-domain strokes.
  const again = applyMeshBrushes(mesh, [st, { kind: "inflate", centre: [0, 0, 0], radius: 1, strength: 1, purpose: "ignored" }]);
  assert(again === moved, "applyMeshBrushes applies smooth strokes only");
});

Deno.test("applyFieldBrushes chains in order and skips mesh strokes", () => {
  const base = compileSdf(sphere);
  const strokes: BrushStroke[] = [
    { kind: "inflate", centre: [0, 0.3, 0], radius: 0.1, strength: 0.02, purpose: "a" },
    { kind: "smooth", centre: [0, 0.3, 0], radius: 0.1, strength: 0.02, purpose: "mesh only" },
    { kind: "deflate", centre: [0, 0.3, 0], radius: 0.1, strength: 0.02, purpose: "b" },
  ];
  const f = applyFieldBrushes(base, strokes);
  assert(Math.abs(d(f, [0, 0.3, 0]) - d(base, [0, 0.3, 0])) < 1e-12, "inflate then deflate cancel at the centre");
});
