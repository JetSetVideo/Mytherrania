// Loft: build a body surface by sweeping a cross-section along an axis.
//
// There are no primitives here. A part is a list of STATIONS, each carrying its own
// radius, depth, section exponent and muscle lobes; the builder samples a superellipse
// at every station, stitches consecutive rings into triangles, and DOME-caps the ends
// so nothing ends in a flat disc (a flat cap is a ring of right angles).
//
// The result is one continuous surface per part, with UVs, so a texture maps onto it
// and a connector can blend two parts into each other.

// @deno-types="@types/three"
import * as THREE from "three";
import { blendGain, lobeGain, superellipse, type Lobe } from "../game/ShapeEquations.ts";

/** One cross-section along a part. */
export interface LoftStation {
  /** Position along the part, 0 at the root, 1 at the far end. */
  t: number;
  /** Radius of the section, metres. */
  radius: number;
  /** Depth/width ratio: < 1 flattens the section front-to-back. */
  depth: number;
  /** Superellipse exponent; 2 is an oval, higher squares it off. */
  n: number;
  /** Directional muscle lobes on this section. */
  lobes: Lobe[];
  /** Section centre offset in the section plane, metres (a curved part). */
  offsetX?: number;
  offsetZ?: number;
}

export interface LoftOptions {
  stations: LoftStation[];
  /** Points sampled around the section. More = smoother. */
  sides: number;
  /** Rings used to dome each end. A flat cap would be a ring of right angles. */
  capRings: number;
  /** How far the dome bulges past the end, as a fraction of the end radius. */
  capDepth: number;
}

/** Sample one section into a ring of points, in the section plane. */
export function sectionRing(st: LoftStation, sides: number): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i < sides; i++) {
    const theta = (i / sides) * Math.PI * 2;
    const r = st.radius * (1 + lobeGain(theta, st.lobes));
    const p = superellipse(theta, r, r * st.depth, st.n);
    pts.push({ x: p.x + (st.offsetX ?? 0), z: p.z + (st.offsetZ ?? 0) });
  }
  return pts;
}

/**
 * Blend two stations into a chain of intermediates, so a CONNECTOR between two parts
 * (forearm into hand, neck into skull) is a smooth continuation rather than two shapes
 * butted together. Lobes are interpolated by angle so a muscle fades rather than pops.
 */
export function blendStations(a: LoftStation, b: LoftStation, count: number): LoftStation[] {
  const out: LoftStation[] = [];
  for (let i = 1; i < count; i++) {
    const u = i / count;
    // blendGain is the smoothstep: matched tangents at both ends, so the connector
    // leaves and joins its neighbours without a crease.
    const s = blendGain(u, 0, 1);
    const lobes: Lobe[] = a.lobes.map((l) => {
      const match = b.lobes.find((m) => Math.abs(m.angle - l.angle) < 1e-6);
      return { angle: l.angle, amp: l.amp * (1 - s) + (match?.amp ?? 0) * s, sharp: l.sharp * (1 - s) + (match?.sharp ?? l.sharp) * s };
    });
    for (const m of b.lobes) {
      if (!a.lobes.some((l) => Math.abs(l.angle - m.angle) < 1e-6)) {
        lobes.push({ angle: m.angle, amp: m.amp * s, sharp: m.sharp });
      }
    }
    out.push({
      t: a.t * (1 - s) + b.t * s,
      radius: a.radius * (1 - s) + b.radius * s,
      depth: a.depth * (1 - s) + b.depth * s,
      n: a.n * (1 - s) + b.n * s,
      lobes,
      offsetX: (a.offsetX ?? 0) * (1 - s) + (b.offsetX ?? 0) * s,
      offsetZ: (a.offsetZ ?? 0) * (1 - s) + (b.offsetZ ?? 0) * s,
    });
  }
  return out;
}

/**
 * Build the surface. Vertices run station-major, so the UV is (θ/2π, arc length) and a
 * texture wraps the part the way a skin does.
 *
 * `height` is the part's length in metres; stations are placed at `t * height`.
 */
export function loftGeometry(o: LoftOptions, height: number): THREE.BufferGeometry {
  const { stations, sides, capRings, capDepth } = o;
  const rings: { y: number; pts: { x: number; z: number }[] }[] = [];

  // Root dome: rings before the first station, sweeping a quarter circle so the
  // surface leaves the root along its tangent instead of turning a right angle.
  const first = stations[0];
  for (let k = capRings; k >= 1; k--) {
    const a = (k / (capRings + 1)) * (Math.PI / 2);
    rings.push({
      y: (first.t * height) - Math.sin(a) * first.radius * capDepth,
      pts: sectionRing({ ...first, radius: first.radius * Math.cos(a) }, sides),
    });
  }
  for (const st of stations) rings.push({ y: st.t * height, pts: sectionRing(st, sides) });
  const last = stations[stations.length - 1];
  for (let k = 1; k <= capRings; k++) {
    const a = (k / (capRings + 1)) * (Math.PI / 2);
    rings.push({
      y: (last.t * height) + Math.sin(a) * last.radius * capDepth,
      pts: sectionRing({ ...last, radius: last.radius * Math.cos(a) }, sides),
    });
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringCount = rings.length;
  for (let r = 0; r < ringCount; r++) {
    const v = r / (ringCount - 1);
    for (let i = 0; i < sides; i++) {
      positions.push(rings[r].pts[i].x, rings[r].y, rings[r].pts[i].z);
      uvs.push(i / sides, v);
    }
  }
  for (let r = 0; r < ringCount - 1; r++) {
    for (let i = 0; i < sides; i++) {
      const a = r * sides + i;
      const b = r * sides + ((i + 1) % sides);
      const c = (r + 1) * sides + i;
      const d = (r + 1) * sides + ((i + 1) % sides);
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Build a connector: a short loft that carries part A's end section into part B's root
 * section. This is the "connection form" between two parts — a hand into a forearm, a
 * neck into a skull — so the join is a surface, not a seam.
 */
export function connectorGeometry(
  a: LoftStation,
  b: LoftStation,
  height: number,
  sides = 18,
  capRings = 2,
): THREE.BufferGeometry {
  const mid = blendStations({ ...a, t: 0 }, { ...b, t: 1 }, 4);
  return loftGeometry({ stations: mid, sides, capRings, capDepth: 0.12 }, height);
}
