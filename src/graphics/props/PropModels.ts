// Prop models (G08 polygons): the arena's pillars, rocks, trees, crates, ramps, platforms, arches
// and glider pads as shaped, vertex-coloured meshes instead of bare primitives. Every model fits
// inside its collider (ArenaConfig OBJECT_SIZES: radius r, height h — the cylinder/box physics
// already uses), is centred on y = 0 (the engine lifts it by h/2) and scales its tessellation with
// the quality's polygonDetail (d: 0.6 low .. 2 ultra):
//   pillar   lathe profile: plinth, entasis shaft (radius r(1 - 0.12 t^2)), echinus + abacus capital;
//            radial segments 6 + 10 d
//   rock     icosphere (subdivision 1 + round(d)) displaced by seeded fBm (+-28 % radius), squashed
//            to h, flat-shaded facets; moss tint where the facet faces up (n.y > 0.55)
//   tree     tapered trunk + three stacked, jittered canopy cones (radial 5 + 4 d), bark/leaf colours
//   crate    rounded box with plank bands (vertex colour by height) and darker corner posts
//   ramp / platform   rounded slabs: lit top, darker sides
//   arch     standing gate: a slab whose top is a semicircle (extruded shape, curve segments 6 + 8 d)
//   gliderPad  bevelled disc with a bright rim ring
// Colours are sRGB hex in, linear vertex colours out (three converts the material colour itself, so
// vertex colours must already be linear).
// @deno-types="@types/three"
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { fbm3, makeNoise } from "../paint/Noise.ts";

export type PropKind = "pillar" | "ramp" | "platform" | "crate" | "rock" | "arch" | "tree" | "gliderPad";

const lin = (hex: string) => new THREE.Color(hex); // THREE.Color(hex) stores LINEAR rgb (ColorManagement on)
/** Non-indexed copy only when indexed (flat per-face colours need unshared vertices). */
const flat = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);

/** Paint every vertex of `g` with `f(x, y, z, nx, ny, nz) -> Color` (linear). Converts to non-indexed first when asked. */
function paint(g: THREE.BufferGeometry, f: (x: number, y: number, z: number, ny: number) => THREE.Color): THREE.BufferGeometry {
  const pos = g.getAttribute("position"), nor = g.getAttribute("normal");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = f(pos.getX(i), pos.getY(i), pos.getZ(i), nor ? nor.getY(i) : 0);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = parts.map(flat);
  for (const p of list) for (const name of Object.keys(p.attributes)) if (!["position", "normal", "color"].includes(name)) p.deleteAttribute(name);
  const m = mergeGeometries(list, false);
  if (!m) throw new Error("PropModels: mergeGeometries returned null");
  return m;
}

function pillar(r: number, h: number, d: number, hex: string): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const y0 = -h / 2;
  const plinth = 0.08 * h, cap = 0.1 * h;
  pts.push(new THREE.Vector2(0, y0), new THREE.Vector2(r * 1.0, y0), new THREE.Vector2(r * 1.0, y0 + plinth * 0.6), new THREE.Vector2(r * 0.86, y0 + plinth));
  const shaft = h - plinth - cap;
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pts.push(new THREE.Vector2(r * 0.82 * (1 - 0.12 * t * t), y0 + plinth + shaft * t));
  }
  const top = y0 + plinth + shaft;
  pts.push(new THREE.Vector2(r * 0.92, top + cap * 0.45), new THREE.Vector2(r * 1.0, top + cap * 0.55), new THREE.Vector2(r * 1.0, h / 2), new THREE.Vector2(0, h / 2));
  const g = new THREE.LatheGeometry(pts, Math.round(6 + 10 * d));
  g.computeVertexNormals();
  const base = lin(hex), dark = base.clone().multiplyScalar(0.72);
  return paint(flat(g), (_x, y) => (y < y0 + plinth || y > top ? dark : base.clone().multiplyScalar(0.92 + 0.08 * ((y - y0) / h))));
}

function rock(r: number, h: number, d: number, hex: string, seed: number): THREE.BufferGeometry {
  const noise = makeNoise(seed);
  const g = new THREE.IcosahedronGeometry(1, 1 + Math.round(d));
  const pos = g.getAttribute("position");
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm3(noise, v.x * 1.6 + 3, v.y * 1.6, v.z * 1.6, 3);
    const k = 1 + 0.28 * n;
    pos.setXYZ(i, v.x * r * k, v.y * (h / 2) * k * 1.05, v.z * r * k);
  }
  g.computeVertexNormals();
  const stone = lin(hex), moss = lin("#5f7a3a");
  return paint(g, (x, _y, z, ny) => {
    const n = fbm3(noise, x * 2.1, 0.3, z * 2.1, 2);
    const c = stone.clone().multiplyScalar(0.86 + 0.28 * (n * 0.5 + 0.5));
    return ny > 0.55 ? c.lerp(moss, Math.min(1, (ny - 0.55) * 2.6) * 0.75) : c;
  });
}

function tree(r: number, h: number, d: number, hex: string, seed: number): THREE.BufferGeometry {
  const rnd = (i: number) => {
    const s = Math.sin((seed + i * 97.13) * 12.9898) * 43758.5453;
    return s - Math.floor(s);
  };
  const seg = Math.round(5 + 4 * d);
  const trunkH = h * 0.42;
  const trunk = new THREE.CylinderGeometry(r * 0.13, r * 0.2, trunkH, Math.max(5, seg - 1));
  trunk.translate(0, -h / 2 + trunkH / 2, 0);
  const bark = lin("#6b4a2e");
  paint(trunk, () => bark);
  const parts: THREE.BufferGeometry[] = [trunk];
  const leaf = lin(hex), leafLight = leaf.clone().lerp(lin("#b9d27a"), 0.35);
  for (let i = 0; i < 3; i++) {
    const t = i / 2;
    const cr = r * (1.0 - 0.28 * t) * (0.92 + 0.16 * rnd(i));
    const ch = h * (0.42 - 0.06 * t);
    const cone = new THREE.ConeGeometry(cr, ch, seg, 1);
    cone.rotateY(rnd(i + 5) * Math.PI);
    cone.translate((rnd(i + 9) - 0.5) * r * 0.12, -h / 2 + trunkH * 0.75 + i * h * 0.2 + ch / 2, (rnd(i + 13) - 0.5) * r * 0.12);
    paint(cone, (_x, y, _z, ny) => (ny > 0.3 ? leafLight : leaf).clone().multiplyScalar(0.8 + 0.25 * ((y + h / 2) / h)));
    parts.push(cone);
  }
  const g = merge(parts);
  g.computeVertexNormals();
  return g;
}

function slab(w: number, h: number, dep: number, d: number, top: string, side: string, bands = 0): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(w, h, dep, Math.max(1, Math.round(1 + d)), Math.min(w, h, dep) * 0.08);
  const t = lin(top), s = lin(side);
  return paint(flat(g), (x, y, z, ny) => {
    if (ny > 0.7) return t;
    const c = s.clone();
    if (bands > 0) {
      const b = Math.floor(((y + h / 2) / h) * bands);
      c.multiplyScalar(b % 2 === 0 ? 1 : 0.86);
      const corner = Math.abs(Math.abs(x) - w / 2) < w * 0.12 && Math.abs(Math.abs(z) - dep / 2) < dep * 0.12;
      if (corner) c.multiplyScalar(0.7);
    }
    return c;
  });
}

function arch(r: number, h: number, d: number, hex: string): THREE.BufferGeometry {
  const w = r * 1.6, rad = w / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -h / 2);
  shape.lineTo(w / 2, -h / 2);
  shape.lineTo(w / 2, h / 2 - rad);
  shape.absarc(0, h / 2 - rad, rad, 0, Math.PI, false);
  shape.lineTo(-w / 2, -h / 2);
  const g = new THREE.ExtrudeGeometry(shape, { depth: r * 0.7, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 1, curveSegments: Math.round(6 + 8 * d) });
  g.translate(0, 0, -r * 0.35);
  g.computeVertexNormals();
  const c = lin(hex), dark = c.clone().multiplyScalar(0.75);
  return paint(flat(g), (_x, y) => (y > h / 2 - rad ? c : dark.clone().lerp(c, (y + h / 2) / (h - rad))));
}

function pad(r: number, h: number, d: number, hex: string): THREE.BufferGeometry {
  const seg = Math.round(16 + 16 * d);
  const disc = new THREE.CylinderGeometry(r * 0.96, r, h, seg);
  const ring = new THREE.TorusGeometry(r * 0.8, h * 0.35, 6, seg);
  ring.rotateX(Math.PI / 2);
  ring.translate(0, h / 2, 0);
  const c = lin(hex), hot = lin("#ffd08a");
  paint(disc, (_x, _y, _z, ny) => (ny > 0.5 ? c : c.clone().multiplyScalar(0.7)));
  paint(ring, () => hot);
  const g = merge([disc, ring]);
  g.computeVertexNormals();
  return g;
}

/** Build the geometry of one prop (vertex-coloured, centred on y = 0, inside its collider). */
export function propGeometry(kind: PropKind, size: { r: number; h: number }, scale: number, detail: number, hex: string, seed: number): THREE.BufferGeometry {
  const r = size.r * scale, h = size.h * scale, d = Math.max(0.3, Math.min(3, detail));
  switch (kind) {
    case "pillar": return pillar(r, h, d, hex);
    case "rock": return rock(r, h, d, hex, seed);
    case "tree": return tree(r, h, d, hex, seed);
    case "crate": return slab(r * 2, h, r * 2, d, "#b98d58", hex, 4);
    case "ramp": return slab(r * 2, h, r * 2, d, "#c19a6b", hex);
    case "platform": return slab(r * 2, h, r * 2, d, "#a39074", hex);
    case "arch": return arch(r, h, d, hex);
    case "gliderPad": return pad(r, h, d, hex);
  }
}

/** Triangles of a geometry (indexed or not). */
export function triangleCount(g: THREE.BufferGeometry): number {
  return g.index ? g.index.count / 3 : g.getAttribute("position").count / 3;
}
