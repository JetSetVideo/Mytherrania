// RibbonTrail / WeaponTrail / ChargeFx build headless in Deno: three's geometry
// and ShaderMaterial classes need no WebGL context (lane D, R05).

// @deno-types="@types/three"
import * as THREE from "three";
import { RibbonTrail } from "../src/graphics/fx/Trail.ts";
import { BladeSampler, WeaponTrail } from "../src/graphics/fx/WeaponTrail.ts";
import { ChargeFx, defaultChargeShape } from "../src/graphics/fx/ChargeFx.ts";
import { RingDecal, ShieldArc } from "../src/graphics/fx/Decals.ts";
import { trailPalette } from "../src/graphics/fx/FxRecipes.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test("RibbonTrail geometry builds headless with in-place attributes and a culling sphere", () => {
  const trail = new RibbonTrail({ capacity: 16, lifetime: 0.4, colours: trailPalette("arcane"), minSpawnDistance: 0.01 });
  const scene = new THREE.Scene();
  scene.add(trail.object);
  const pos = trail.geometry.getAttribute("position") as THREE.BufferAttribute;
  assert(pos.array === trail.buffer.positions, "the position attribute wraps the buffer's array (no copy)");
  assert(trail.update(0) === 0 && !trail.object.visible, "empty trail is hidden");
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i < 12; i++) {
    const ang = i * 0.3;
    a.set(Math.cos(ang) * 0.3, 1, Math.sin(ang) * 0.3);
    b.set(Math.cos(ang) * 1.2, 1, Math.sin(ang) * 1.2);
    trail.push(a, b, i / 60);
  }
  const verts = trail.update(11 / 60);
  const rows = trail.buffer.rows;
  assert(verts === rows * 2 && rows >= 12, `rows ${rows} (12 samples + Catmull-Rom inserts)`);
  assert(trail.geometry.drawRange.count === (rows - 1) * 6, "draw range = 6 indices per row gap");
  assert(trail.object.visible && trail.drawCalls === 2, "visible: outer + core = 2 draw calls");
  assert(trail.triangleCount === (rows - 1) * 2, "2 triangles per row gap per layer");
  const sphere = trail.geometry.boundingSphere!;
  const p = new THREE.Vector3();
  for (let v = 0; v < verts; v++) {
    p.fromBufferAttribute(pos, v);
    assert(p.distanceTo(sphere.center) <= sphere.radius + 1e-4, `vertex ${v} inside the culling sphere`);
  }
  const [outer, core] = trail.object.children as THREE.Mesh[];
  const om = outer.material as THREE.ShaderMaterial, cm = core.material as THREE.ShaderMaterial;
  assert(outer.geometry === core.geometry, "both layers share one geometry");
  assert(om.blending === THREE.NormalBlending && cm.blending === THREE.AdditiveBlending, "normal outer + additive core");
  assert(!om.depthWrite && !cm.depthWrite, "depthWrite off");
  assert(om.uniforms === cm.uniforms, "one uniforms object drives both layers");
  const before = (om.uniforms.uEdge.value as THREE.Color).getHex();
  trail.setColours(trailPalette("poison"));
  assert((om.uniforms.uEdge.value as THREE.Color).getHex() !== before, "setColours recolours in place");
  // Everything older than the lifetime: hidden again.
  assert(trail.update(5) === 0 && !trail.object.visible, "fully faded trail hides itself");
  trail.dispose();
  assert(trail.object.parent === null, "dispose detaches");
});

Deno.test("WeaponTrail emits on a fast swing, not on a slow drift, and when armed", () => {
  const w = new WeaponTrail(trailPalette("fire"));
  const node = new THREE.Object3D();
  const root = new THREE.Group();
  root.add(node);
  const sampler = new BladeSampler(node, { base: 0.4, tip: 1.2 });
  const base = new THREE.Vector3(), tip = new THREE.Vector3();
  // Slow drift: 0.2 rad/s -> tip ~0.24 m/s, far below SWING_SPEED.
  let now = 0;
  for (let i = 0; i < 60; i++, now += 1 / 60) {
    node.rotation.x = -0.2 * now;
    sampler.sample(base, tip);
    w.feed(base, tip, now);
    w.update(now);
  }
  assert(w.trail.buffer.pointCount === 0, `a slow drift leaves no trail (points ${w.trail.buffer.pointCount})`);
  // Fast swing: 12 rad/s -> tip ~14 m/s.
  for (let i = 0; i < 15; i++, now += 1 / 60) {
    node.rotation.x = -0.2 - 12 * (i / 60);
    sampler.sample(base, tip);
    w.feed(base, tip, now);
    w.update(now);
  }
  assert(w.tipSpeed > 4 && w.trail.buffer.rows >= 2, `a fast swing draws (speed ${w.tipSpeed.toFixed(1)} m/s)`);
  assert(Math.abs(tip.length() - 1.2) < 1e-6, "the sampler places the tip 1.2 m out along the weapon's +y");
  // Armed: emits even while still.
  w.clear();
  w.arm(now + 1, 0.3, 0.9);
  for (let i = 0; i < 10; i++, now += 1 / 60) {
    sampler.sample(base, tip);
    w.feed(base, tip, now);
  }
  assert(w.armed(now) && w.trail.buffer.pointCount >= 1, "armed trail records even without speed");
  w.dispose();
});

Deno.test("ChargeFx bare API: begin(origin, target, element, duration) -> update -> end", () => {
  const fx = new ChargeFx(trailPalette("wind"), defaultChargeShape(0.5));
  const scene = new THREE.Scene();
  scene.add(fx.object);
  const origin = new THREE.Vector3(0, 0.6, 0), target = new THREE.Vector3(0, 0.6, 3);
  fx.begin(origin, target, "holy", 0.5); // `now` taken from the first update
  assert(fx.active, "active after begin");
  assert(fx.palette.edge === trailPalette("holy").edge, "begin re-colours to the skill element");
  const pos = new THREE.Vector3();
  let t = 0;
  for (; t <= 0.5; t += 1 / 60) {
    pos.lerpVectors(origin, target, Math.min(1, t / 0.35));
    fx.update(100 + t, pos, 0.1 * Math.sin(Math.PI * t / 0.5));
  }
  fx.end(100 + t);
  assert(fx.telegraphFill === 1, "telegraph full by the end of the dash");
  assert(fx.ghostsSpawned >= 3 && fx.ghostsSpawned <= 5, `3-5 ghosts, got ${fx.ghostsSpawned}`);
  const mid = fx.cost();
  assert(mid.drawCalls > 0, "layers still visible right after the dash");
  for (let k = 0; k < 240; k++) fx.update(100 + t + k / 60, target, 0);
  assert(!fx.active && fx.cost().drawCalls === 0, "everything faded within 4 s");
  // Re-begin on the same instance (pool reuse) works.
  fx.begin(target, origin, "wind", 0.5, 200);
  fx.update(200.1, target, 0);
  assert(fx.active, "reusable");
  fx.dispose();
});

Deno.test("RingDecal expands to its radius and ShieldArc rises and lowers", () => {
  const ring = new RingDecal(trailPalette("fury"));
  ring.fire({ x: 1, y: 0, z: 2 }, 1.5, 0.5, 0);
  assert(ring.active && ring.drawCalls === 2, "ring visible: 2 draw calls");
  ring.update(0.49);
  assert((ring.uniforms.uRing.value as number) > 0.8, "ring near full radius at the end");
  ring.update(0.5);
  assert(!ring.active, "ring hides itself when done");
  const shield = new ShieldArc(trailPalette("arcane"));
  shield.raise(0.8, 1.8, 0.7, 0, 0.3);
  shield.update(0.15, { x: 0, y: 0, z: 0 }, 0);
  const half = shield.uniforms.uOpacity.value as number;
  shield.update(0.3, { x: 0, y: 0, z: 0 }, 0);
  assert(half > 0 && half < 0.7 && Math.abs((shield.uniforms.uOpacity.value as number) - 0.7) < 1e-9, "rises to its opacity");
  shield.lower(1, 0.2);
  shield.update(1.25, { x: 0, y: 0, z: 0 }, 0);
  assert(!shield.active, "lowered shield hides after its fall time");
  ring.dispose();
  shield.dispose();
});
