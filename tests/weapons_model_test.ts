// Lane W (W06): the weapon mesh. Builds headless (three's geometry/material classes need no
// WebGL), stays within the triangle budget in two draw calls, faces outward, and the strike
// features lane X collides with lie ON the mesh. Also the adapters: the legacy GeneratedWeapon
// still builds through WeaponMesh/FxRecipes, and the legacy Weapon struct is valid.

// @deno-types="@types/three"
import * as THREE from "three";
import type { V3 } from "../src/combat/contracts.ts";
import { ARCHETYPE_IDS } from "../src/game/weapons/Archetypes.ts";
import { weaponFromSeed } from "../src/game/weapons/Generate.ts";
import { toGeneratedWeapon, toLegacyWeapon } from "../src/game/weapons/Adapter.ts";
import { bladeSpan } from "../src/graphics/fx/FxRecipes.ts";
import { buildWeaponMesh } from "../src/graphics/WeaponMesh.ts";
import {
  buildWeaponGeometry, buildWeaponModel, strikeFeatureLines, WEAPON_TRIANGLE_BUDGET,
} from "../src/graphics/weapons/WeaponModel.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok {
  if (!ok) throw new Error(m);
}
const SEEDS = 60;
const seedOf = (i: number) => (i * 2246822519) >>> 0;

/** Closest distance from p to triangle abc (Ericson, Real-Time Collision Detection 5.1.5). */
function pointTriangleDistance(p: V3, a: V3, b: V3, c: V3): number {
  const sub = (u: V3, v: V3): V3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u: V3, v: V3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const at = (q: V3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return at(a);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return at(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return at([a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]); }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return at(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return at([a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return at([b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]);
  }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return at([a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]);
}

function meshDistance(geo: THREE.BufferGeometry, p: V3): number {
  const pos = geo.getAttribute("position").array as Float32Array;
  let best = Infinity;
  for (let i = 0; i < pos.length; i += 9) {
    best = Math.min(best, pointTriangleDistance(p,
      [pos[i], pos[i + 1], pos[i + 2]], [pos[i + 3], pos[i + 4], pos[i + 5]], [pos[i + 6], pos[i + 7], pos[i + 8]]));
  }
  return best;
}

Deno.test("model: every archetype builds headless within the triangle budget (2 draw calls)", () => {
  const rows: string[] = [];
  for (const id of ARCHETYPE_IDS) {
    let lo = Infinity, hi = 0;
    for (let i = 1; i <= SEEDS; i++) {
      const w = weaponFromSeed(id, seedOf(i));
      const m = buildWeaponModel(w);
      lo = Math.min(lo, m.triangleCount); hi = Math.max(hi, m.triangleCount);
      assert(m.triangleCount <= WEAPON_TRIANGLE_BUDGET, `${w.name}: ${m.triangleCount} tris`);
      const meshes = m.group.children.filter((c) => (c as THREE.Mesh).isMesh);
      assert(meshes.length === 2 && m.drawCalls === 2, `${id}: surface + outline only`);
      assert(m.surface.geometry === m.outline.geometry, `${id}: one shared geometry`);
      const pos = m.geometry.getAttribute("position");
      assert(pos.count === m.triangleCount * 3, `${id}: non-indexed triangle list`);
      for (const name of ["normal", "outlineNormal", "aColor", "aSpecular"]) {
        const attr = m.geometry.getAttribute(name);
        assert(attr && attr.count === pos.count, `${id}: attribute ${name}`);
        for (const v of attr.array as Float32Array) assert(Number.isFinite(v), `${id}: ${name} finite`);
      }
      m.dispose();
    }
    rows.push(`${id} | ${lo} | ${hi}`);
  }
  console.log("archetype | min tris | max tris  (60 seeds each, budget " + WEAPON_TRIANGLE_BUDGET + ")\n" + rows.join("\n"));
});

Deno.test("model: faces point outward (positive enclosed volume) and outline normals are unit", () => {
  for (const id of ARCHETYPE_IDS) {
    const { geometry } = buildWeaponGeometry(weaponFromSeed(id, 3));
    const p = geometry.getAttribute("position").array as Float32Array;
    let vol = 0;
    for (let i = 0; i < p.length; i += 9) {
      vol += (p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) +
        p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6])) / 6;
    }
    assert(vol > 0, `${id}: signed volume ${vol} must be positive (outward faces)`);
    const n = geometry.getAttribute("outlineNormal").array as Float32Array;
    for (let i = 0; i < n.length; i += 3) assert(Math.abs(Math.hypot(n[i], n[i + 1], n[i + 2]) - 1) < 1e-4, `${id}: unit outline normal`);
  }
});

Deno.test("model: strike features lie on the mesh (collision shape = picture)", () => {
  for (const id of ARCHETYPE_IDS) {
    for (const seed of [1, 2, 3]) {
      const w = weaponFromSeed(id, seed);
      const { geometry } = buildWeaponGeometry(w);
      for (const f of w.features) {
        for (const p of f.points) {
          const d = meshDistance(geometry, p);
          // Edges/points sit on the surface; heads/shafts are centres inside their volume.
          const tol = f.kind === "edge" || f.kind === "point" ? 0.02 : f.radius + 0.02;
          assert(d <= tol, `${id} seed ${seed}: ${f.kind} point [${p.map((v) => v.toFixed(3))}] is ${d.toFixed(3)} m from the mesh (tol ${tol.toFixed(3)})`);
        }
      }
    }
  }
});

Deno.test("model: debug lines and the optional effect shell", () => {
  const w = weaponFromSeed("warhammer", 9);
  const lines = strikeFeatureLines(w);
  const heads = w.features.filter((f) => f.kind === "head").length;
  assert(lines.children.length === w.features.length + 2 * heads, "one line per feature, three circles per head");
  for (const c of lines.children) assert((c as THREE.Line).isLine, "children are THREE.Line");
  const m = buildWeaponModel(w, { element: "fire" });
  assert(m.group.children.length === 3, "surface + outline + effect shell");
  m.setEffect(1, 0.5);
  m.dispose();
});

Deno.test("adapters: legacy GeneratedWeapon builds through WeaponMesh/FxRecipes; legacy Weapon is valid", () => {
  for (const id of ARCHETYPE_IDS) {
    const w = weaponFromSeed(id, 11);
    const g = toGeneratedWeapon(w);
    assert(g.name === w.name && g.parts.length > 0, `${id}: parts`);
    for (const p of g.parts) {
      assert(p.w > 0 && p.h > 0 && p.d > 0 && Number.isFinite(p.y) && Number.isFinite(p.bend), `${id}: part ${p.kind} dims`);
    }
    const span = bladeSpan(g.parts);
    assert(span.tip > span.base && span.tip > 0, `${id}: trail span ${span.base}..${span.tip}`);
    const mesh = buildWeaponMesh(g, "holy");
    assert(mesh.triangleCount > 0, `${id}: legacy mesh builds`);
    const l = toLegacyWeapon(w);
    assert(["axe", "sword", "dagger", "staff", "scythe", "bow", "mace"].includes(l.type), `${id}: legacy type`);
    assert(l.weight >= 1 && l.weight <= 10 && l.balance >= 0 && l.balance <= 1, `${id}: legacy scales`);
    assert(l.reach > 0.5 && l.cooldown > 0 && l.knockback > 0 && l.damage > 0, `${id}: legacy numbers`);
    assert(l.grip && Number.isFinite(l.grip.scale), `${id}: legacy grip`);
    if (id === "bow") assert(l.reach <= 2.8 + 1e-9, "bow: legacy reach capped");
  }
});
