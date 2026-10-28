// MeshKit: a tiny triangle builder for weapon meshes. Everything is emitted into ONE
// non-indexed BufferGeometry (position, normal, aColor, aSpecular, outlineNormal) so a weapon
// draws in two calls (cel surface + inverted-hull outline) whatever its part count.
//
//   normal         face normal (flat facets) or averaged inside a smooth group.
//   outlineNormal  normal averaged over EVERY triangle sharing a position, so the inverted hull
//                  stays closed across hard edges (a hull pushed along split normals cracks).
//   aColor         linear RGB (THREE.Color from hex, the same conversion CelShader applies).
//   aSpecular      0 for wood/leather, SPECULAR_METAL for metal.

// @deno-types="@types/three"
import * as THREE from "three";
import type { V3 } from "../../combat/contracts.ts";

/** A section ring: its points, its centre (for orienting faces outward) and its colours. */
export interface Ring {
  pts: V3[];
  centre: V3;
  /** One colour for the ring, or one per point. */
  colors: THREE.Color | THREE.Color[];
}

/** Options of a tube: how to close each end and whether facets are smoothed. */
export interface TubeOptions {
  /** true = flat fan cap, a V3 = cone to that apex, false/undefined = open. */
  start?: boolean | V3;
  end?: boolean | V3;
  /** Average normals inside this tube (round shafts); flat facets otherwise (blades). */
  smooth?: boolean;
  /** Apex colour (defaults to the ring's first colour). */
  apexColor?: THREE.Color;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Accumulates triangles; build() turns them into one BufferGeometry. */
export class MeshKit {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly spec: number[] = [];
  /** Smooth-group id per vertex (-1 = flat). */
  readonly group: number[] = [];
  #nextGroup = 0;
  #specular = 0;

  /** Specular strength applied to the triangles emitted next. */
  setSpecular(s: number): this {
    this.#specular = s;
    return this;
  }

  get triangleCount(): number {
    return this.pos.length / 9;
  }

  /** One triangle, flipped if needed so its normal points away from `inside`. */
  tri(a: V3, b: V3, c: V3, ca: THREE.Color, cb: THREE.Color, cc: THREE.Color, inside: V3 | null, group = -1): void {
    let p1 = b, p2 = c, c1 = cb, c2 = cc;
    if (inside) {
      const n = cross(sub(b, a), sub(c, a));
      const centroid: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      if (dot(n, sub(centroid, inside)) < 0) { p1 = c; p2 = b; c1 = cc; c2 = cb; }
    }
    for (const [p, col] of [[a, ca], [p1, c1], [p2, c2]] as const) {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(col.r, col.g, col.b);
      this.spec.push(this.#specular);
      this.group.push(group);
    }
  }

  /** Connect consecutive rings (equal point counts) into a closed tube, with optional end caps. */
  tube(rings: Ring[], opts: TubeOptions = {}): void {
    const g = opts.smooth ? this.#nextGroup++ : -1;
    const colorAt = (r: Ring, i: number) => Array.isArray(r.colors) ? r.colors[i] : r.colors;
    for (let k = 0; k + 1 < rings.length; k++) {
      const A = rings[k], B = rings[k + 1], n = A.pts.length;
      const mid: V3 = [(A.centre[0] + B.centre[0]) / 2, (A.centre[1] + B.centre[1]) / 2, (A.centre[2] + B.centre[2]) / 2];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        this.tri(A.pts[i], B.pts[i], B.pts[j], colorAt(A, i), colorAt(B, i), colorAt(B, j), mid, g);
        this.tri(A.pts[i], B.pts[j], A.pts[j], colorAt(A, i), colorAt(B, j), colorAt(A, j), mid, g);
      }
    }
    const cap = (ring: Ring, other: Ring, how: boolean | V3 | undefined, otherHow: boolean | V3 | undefined) => {
      if (!how) return;
      const n = ring.pts.length;
      const apex: V3 = how === true ? ring.centre : how;
      // A flat cap faces away from the rest of the tube: the other ring, or (single-ring
      // tube, e.g. a spike) the apex at the other end.
      const away = other !== ring ? other.centre : Array.isArray(otherHow) ? otherHow : ring.centre;
      const inside = how === true ? away : ring.centre;
      const ac = opts.apexColor ?? colorAt(ring, 0);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        this.tri(apex, ring.pts[i], ring.pts[j], ac, colorAt(ring, i), colorAt(ring, j), inside, how === true ? -1 : g);
      }
    };
    if (rings.length > 0) {
      cap(rings[0], rings[Math.min(1, rings.length - 1)], opts.start, opts.end);
      cap(rings[rings.length - 1], rings[Math.max(0, rings.length - 2)], opts.end, opts.start);
    }
  }

  /** A ring of `n` points on a circle/ellipse around `centre` in the plane (u, v). */
  static circle(centre: V3, u: V3, v: V3, ru: number, rv: number, n: number, phase = 0): V3[] {
    const out: V3[] = [];
    for (let i = 0; i < n; i++) {
      const a = phase + (i / n) * Math.PI * 2;
      const cu = Math.cos(a) * ru, sv = Math.sin(a) * rv;
      out.push([centre[0] + u[0] * cu + v[0] * sv, centre[1] + u[1] * cu + v[1] * sv, centre[2] + u[2] * cu + v[2] * sv]);
    }
    return out;
  }

  /** Points given as (a, b) section coordinates placed at centre + a u + b v. */
  static section(centre: V3, u: V3, v: V3, ab: ReadonlyArray<readonly [number, number]>): V3[] {
    return ab.map(([a, b]) => [centre[0] + u[0] * a + v[0] * b, centre[1] + u[1] * a + v[1] * b, centre[2] + u[2] * a + v[2] * b]);
  }

  /** Build the geometry: flat or group-smoothed normals, plus welded outline normals. */
  build(): THREE.BufferGeometry {
    const n = this.pos.length / 3;
    const normals = new Float32Array(n * 3);
    const outline = new Float32Array(n * 3);
    const key = (i: number) =>
      `${Math.round(this.pos[i * 3] * 1e4)},${Math.round(this.pos[i * 3 + 1] * 1e4)},${Math.round(this.pos[i * 3 + 2] * 1e4)}`;
    const smoothSum = new Map<string, V3>();
    const weldSum = new Map<string, V3>();
    const face: V3[] = [];
    for (let t = 0; t < n / 3; t++) {
      const i = t * 9;
      const a: V3 = [this.pos[i], this.pos[i + 1], this.pos[i + 2]];
      const b: V3 = [this.pos[i + 3], this.pos[i + 4], this.pos[i + 5]];
      const c: V3 = [this.pos[i + 6], this.pos[i + 7], this.pos[i + 8]];
      const fn = cross(sub(b, a), sub(c, a)); // area-weighted
      face.push(fn);
      for (let k = 0; k < 3; k++) {
        const v = t * 3 + k, kk = key(v);
        const w = weldSum.get(kk) ?? [0, 0, 0];
        w[0] += fn[0]; w[1] += fn[1]; w[2] += fn[2];
        weldSum.set(kk, w);
        if (this.group[v] >= 0) {
          const sk = `${this.group[v]}|${kk}`;
          const s = smoothSum.get(sk) ?? [0, 0, 0];
          s[0] += fn[0]; s[1] += fn[1]; s[2] += fn[2];
          smoothSum.set(sk, s);
        }
      }
    }
    const put = (arr: Float32Array, v: number, x: V3) => {
      const l = Math.hypot(x[0], x[1], x[2]) || 1;
      arr[v * 3] = x[0] / l; arr[v * 3 + 1] = x[1] / l; arr[v * 3 + 2] = x[2] / l;
    };
    for (let v = 0; v < n; v++) {
      const kk = key(v);
      put(normals, v, this.group[v] >= 0 ? smoothSum.get(`${this.group[v]}|${kk}`)! : face[Math.floor(v / 3)]);
      put(outline, v, weldSum.get(kk)!);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geo.setAttribute("outlineNormal", new THREE.BufferAttribute(outline, 3));
    geo.setAttribute("aColor", new THREE.Float32BufferAttribute(this.col, 3));
    geo.setAttribute("aSpecular", new THREE.Float32BufferAttribute(this.spec, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }
}
