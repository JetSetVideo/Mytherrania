// Lane I-D: the bounded blade-clash spark pool. A FIXED pool of point-sparks
// with ONE shared geometry buffer written in place every frame — a burst
// allocates nothing, spawns at most SPARKS_PER_BURST sparks, and the whole pool
// is TWO meshes over that ONE geometry (outer normal-blend + additive core), the
// house daylight rule (FxShaders.ts): an additive-only effect is invisible on a
// bright sky, so a spark needs the saturated normal-blend outer layer to read in
// daylight. 2 draw calls when live. Everything on the ONE monotonic game clock
// the caller passes as `now` (seconds); positions are world space (m); the root
// group sits at identity.
//
// Cost: worst case maxSparks * 2 triangles PER LAYER (default 96 * 2 = 192), i.e.
// 2 draw calls. No per-spark mesh, no allocation after construction.

// @deno-types="@types/three"
import * as THREE from "three";
import { clamp01 } from "../../core/MathCore.ts";
import { applyPalette, createFxUniforms, createLayerMeshes, createLayerPair, type FxUniforms } from "./FxShaders.ts";
import type { TrailPalette } from "./FxRecipes.ts";

/** Pool size when the caller says nothing: 8 full bursts in flight at once. */
export const DEFAULT_MAX_SPARKS = 96;
/** Sparks one burst tries to spawn (before setScale thins it): a readable flash, not a cloud. */
export const SPARKS_PER_BURST = 12;
/** Shortest / longest single-spark lifetime (s): both well under 0.5 s, so a burst clears fast. */
export const SPARK_LIFE_MIN = 0.25;
export const SPARK_LIFE_MAX = 0.4;
/** Downward acceleration on a spark (m/s²): ~earth gravity, a shade damped as sparks are light. */
export const SPARK_GRAVITY = 9.0;
/** Launch speed (m/s) at zero / full clash strength: the burst plays out within a metre or two. */
export const SPARK_SPEED_MIN = 1.6;
export const SPARK_SPEED_MAX = 5.5;
/** Half-width of a spark billboard (m): ~2 cm reads as a fleck at spectator range. */
export const SPARK_HALF_SIZE = 0.02;
/** Seed used when the caller gives none. */
export const DEFAULT_SPARK_SEED = 0x5a17c0de;
/** Fixed spark palette (the class has no re-colour API): warm gold edge, near-white core. */
const SPARK_PALETTE: TrailPalette = { edge: "#ffcf6e", body: "#ffb347", core: "#fff4d6" };

const TAU = Math.PI * 2;
/** Shared billboard quad corner order: (-1,-1) (1,-1) (1,1) (-1,1). */
const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];

/** Options for a spark pool. */
export interface ClashSparksOptions {
  /** Fixed pool size. Default DEFAULT_MAX_SPARKS (96). */
  maxSparks?: number;
  /** Seed for the deterministic per-burst directions. Default DEFAULT_SPARK_SEED. */
  seed?: number;
}

// Billboards each spark in view space (positions are world space; the group is at
// identity), offset by its own half-size along the view x/y axes.
const SPARK_VERTEX = /* glsl */ `
  attribute vec2 aCorner;
  attribute float aAlpha;
  attribute float aSize;
  varying float vAlpha;
  varying vec2 vCorner;
  void main() {
    vAlpha = aAlpha;
    vCorner = aCorner;
    vec4 mv = viewMatrix * vec4(position, 1.0);
    mv.xy += aCorner * aSize;
    gl_Position = projectionMatrix * mv;
  }
`;

const SPARK_FRAGMENT_HEAD = /* glsl */ `
  uniform vec3 uEdge;
  uniform vec3 uCore;
  uniform float uBrightness;
  uniform float uOpacity;
  uniform float uDensity;
  varying float vAlpha;
  varying vec2 vCorner;
`;

const SPARK_OUTER_FRAGMENT = SPARK_FRAGMENT_HEAD + /* glsl */ `
  void main() {
    float r = length(vCorner);
    float a = (1.0 - smoothstep(0.35, 1.0, r)) * vAlpha * uOpacity;
    if (a < 0.01) discard;
    vec3 col = mix(uEdge, uCore, 0.35) * (0.85 + 0.5 * uBrightness);
    float dens = 1.0 - pow(1.0 - clamp(a, 0.0, 1.0), max(uDensity, 1.0));
    gl_FragColor = vec4(col, clamp(dens, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const SPARK_CORE_FRAGMENT = SPARK_FRAGMENT_HEAD + /* glsl */ `
  void main() {
    float heat = (1.0 - smoothstep(0.0, 0.7, length(vCorner))) * vAlpha * uOpacity;
    if (heat < 0.01) discard;
    vec3 hot = mix(uEdge, uCore, pow(clamp(heat, 0.0, 1.0), 1.6) * 0.8);
    gl_FragColor = vec4(hot * heat * uBrightness, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * A fixed pool of clash sparks (module comment). Add `object` to the scene once,
 * call burst() on a clash and update() every frame.
 */
export class ClashSparks {
  /** Root holding the two layers; positioned at identity (spark points are world space). */
  readonly object = new THREE.Group();
  readonly #max: number;
  readonly #seed: number;
  readonly #uniforms: FxUniforms;
  readonly #geometry = new THREE.BufferGeometry();
  readonly #position: Float32Array;
  readonly #alpha: Float32Array;
  readonly #size: Float32Array;
  readonly #positionAttr: THREE.BufferAttribute;
  readonly #alphaAttr: THREE.BufferAttribute;
  readonly #sizeAttr: THREE.BufferAttribute;
  readonly #materials: THREE.ShaderMaterial[] = [];

  // Per-spark state, packed in [0, live).
  readonly #spx: Float32Array;
  readonly #spy: Float32Array;
  readonly #spz: Float32Array;
  readonly #svx: Float32Array;
  readonly #svy: Float32Array;
  readonly #svz: Float32Array;
  readonly #birth: Float64Array;
  readonly #life: Float64Array;
  readonly #baseSize: Float32Array;
  #live = 0;
  #spawned = 0;
  #dropped = 0;
  #scale = 1;
  #burstCount = 0;
  #rngState = 0;

  constructor(parent: THREE.Object3D, opts: ClashSparksOptions = {}) {
    const max = Math.max(1, Math.floor(opts.maxSparks ?? DEFAULT_MAX_SPARKS));
    this.#max = max;
    this.#seed = (opts.seed ?? DEFAULT_SPARK_SEED) >>> 0;
    this.object.name = "fx-clash-sparks";

    const verts = max * 4;
    this.#position = new Float32Array(verts * 3);
    this.#alpha = new Float32Array(verts);
    this.#size = new Float32Array(verts);
    this.#spx = new Float32Array(max);
    this.#spy = new Float32Array(max);
    this.#spz = new Float32Array(max);
    this.#svx = new Float32Array(max);
    this.#svy = new Float32Array(max);
    this.#svz = new Float32Array(max);
    this.#birth = new Float64Array(max);
    this.#life = new Float64Array(max);
    this.#baseSize = new Float32Array(max);

    // Static corner + index buffers (written once, never again).
    const corner = new Float32Array(verts * 2);
    const index = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      const v = i * 4;
      for (let c = 0; c < 4; c++) {
        corner[(v + c) * 2] = CORNERS[c * 2];
        corner[(v + c) * 2 + 1] = CORNERS[c * 2 + 1];
      }
      index[i * 6] = v;
      index[i * 6 + 1] = v + 1;
      index[i * 6 + 2] = v + 2;
      index[i * 6 + 3] = v;
      index[i * 6 + 4] = v + 2;
      index[i * 6 + 5] = v + 3;
    }
    this.#positionAttr = new THREE.BufferAttribute(this.#position, 3).setUsage(THREE.DynamicDrawUsage);
    this.#alphaAttr = new THREE.BufferAttribute(this.#alpha, 1).setUsage(THREE.DynamicDrawUsage);
    this.#sizeAttr = new THREE.BufferAttribute(this.#size, 1).setUsage(THREE.DynamicDrawUsage);
    this.#geometry.setAttribute("position", this.#positionAttr);
    this.#geometry.setAttribute("aCorner", new THREE.BufferAttribute(corner, 2));
    this.#geometry.setAttribute("aAlpha", this.#alphaAttr);
    this.#geometry.setAttribute("aSize", this.#sizeAttr);
    this.#geometry.setIndex(new THREE.BufferAttribute(index, 1));
    // Points are placed by the shader and move every frame: skip culling.
    this.#geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.#geometry.setDrawRange(0, 0);

    this.#uniforms = createFxUniforms(SPARK_PALETTE);
    const pair = createLayerPair(SPARK_VERTEX, SPARK_OUTER_FRAGMENT, SPARK_CORE_FRAGMENT, this.#uniforms);
    this.#materials.push(pair.outer, pair.core);
    const meshes = createLayerMeshes(this.#geometry, pair);
    for (const m of meshes) m.frustumCulled = false;
    this.object.add(...meshes);
    this.object.visible = false;
    parent.add(this.object);
  }

  /** Sparks alive right now (never above the pool size). */
  get liveCount(): number {
    return this.#live;
  }

  /** Sparks actually spawned over this instance's life. */
  get spawned(): number {
    return this.#spawned;
  }

  /** Sparks refused by a burst (pool full, or thinned out by setScale) over this instance's life. */
  get dropped(): number {
    return this.#dropped;
  }

  /** Triangles one layer draws with the pool full (both layers draw it: 2 draw calls). */
  get triangleCount(): number {
    return this.#max * 2;
  }

  /**
   * 0..1 effect scale: a burst spawns round(SPARKS_PER_BURST * scale) sparks and
   * counts the rest as dropped; 0 makes every burst spawn nothing. Lets the
   * caller's effects governor thin the burst without touching this class.
   */
  setScale(scale: number): void {
    this.#scale = clamp01(scale);
  }

  /**
   * Fire a burst at world point `at` (m) with clash `strength` (0..1) at time
   * `now` (s). Directions are a cone around `normal` (default +y), seeded
   * deterministically from the seed and a per-burst counter, so the same seed
   * reproduces the same directions. Refuses (counting dropped sparks) when the
   * pool is full or the scale is 0.
   */
  burst(at: readonly [number, number, number], strength: number, now: number, normal?: readonly [number, number, number]): void {
    const attempts = SPARKS_PER_BURST;
    const want = this.#scale > 0 ? Math.min(attempts, Math.round(attempts * this.#scale)) : 0;

    // Unit cone axis (default straight up).
    let nx = 0, ny = 1, nz = 0;
    if (normal) {
      const l = Math.hypot(normal[0], normal[1], normal[2]);
      if (l > 1e-9) {
        nx = normal[0] / l;
        ny = normal[1] / l;
        nz = normal[2] / l;
      }
    }
    // Two tangents spanning the plane perpendicular to the axis.
    const hx = Math.abs(ny) < 0.9 ? 0 : 1, hy = Math.abs(ny) < 0.9 ? 1 : 0;
    let t1x = ny * 0 - nz * hy, t1y = nz * hx - nx * 0, t1z = nx * hy - ny * hx;
    let t1l = Math.hypot(t1x, t1y, t1z);
    if (t1l < 1e-9) {
      t1x = 1;
      t1y = 0;
      t1z = 0;
      t1l = 1;
    }
    t1x /= t1l;
    t1y /= t1l;
    t1z /= t1l;
    const t2x = ny * t1z - nz * t1y, t2y = nz * t1x - nx * t1z, t2z = nx * t1y - ny * t1x;

    // Deterministic per-burst rng stream (inline mulberry32 — same algorithm as
    // core/MathCore.rng32 — so a burst allocates no closure).
    this.#rngState = (this.#seed ^ Math.imul(this.#burstCount, 0x9e3779b1)) >>> 0;
    this.#burstCount++;

    const s = clamp01(strength);
    const ax = Number.isFinite(at[0]) ? at[0] : 0;
    const ay = Number.isFinite(at[1]) ? at[1] : 0;
    const az = Number.isFinite(at[2]) ? at[2] : 0;
    let spawn = 0;
    for (let k = 0; k < want; k++) {
      const i = this.#live;
      if (i >= this.#max) break; // pool full: the remainder count as dropped
      const r1 = this.#rand(), r2 = this.#rand(), r3 = this.#rand(), r4 = this.#rand(), r5 = this.#rand();
      const cosT = 0.35 + 0.65 * r2; // 0.35..1: biased along the axis
      const sinT = Math.sqrt(1 - cosT * cosT);
      const phi = r1 * TAU;
      const a1 = sinT * Math.cos(phi), a2 = sinT * Math.sin(phi);
      let dx = nx * cosT + t1x * a1 + t2x * a2;
      let dy = ny * cosT + t1y * a1 + t2y * a2;
      let dz = nz * cosT + t1z * a1 + t2z * a2;
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl;
      dy /= dl;
      dz /= dl;
      const speed = (SPARK_SPEED_MIN + (SPARK_SPEED_MAX - SPARK_SPEED_MIN) * r3) * (0.5 + 0.5 * s);
      this.#spx[i] = ax + dx * 0.01;
      this.#spy[i] = ay + dy * 0.01;
      this.#spz[i] = az + dz * 0.01;
      this.#svx[i] = dx * speed;
      this.#svy[i] = dy * speed;
      this.#svz[i] = dz * speed;
      this.#birth[i] = now;
      this.#life[i] = SPARK_LIFE_MIN + (SPARK_LIFE_MAX - SPARK_LIFE_MIN) * r4;
      this.#baseSize[i] = SPARK_HALF_SIZE * (0.7 + 0.6 * s) * (0.8 + 0.4 * r5);
      this.#live++;
      spawn++;
    }
    this.#spawned += spawn;
    this.#dropped += attempts - spawn;
  }

  /**
   * Advance every spark to time `now` (s) with the frame's `dt` (s), then rewrite
   * the vertex buffer in place: positions under SPARK_GRAVITY, a fade and a
   * shrink, and a spark returns to the pool the frame its life ends.
   */
  update(now: number, dt: number): void {
    const step = dt > 0 ? dt : 0;
    let i = 0;
    while (i < this.#live) {
      const age = now - this.#birth[i];
      if (!(age >= 0) || age >= this.#life[i]) { // !(age >= 0) also catches NaN
        this.#swapRemove(i, this.#live - 1);
        this.#live--;
        continue; // re-examine the spark swapped into slot i
      }
      this.#svy[i] -= SPARK_GRAVITY * step;
      this.#spx[i] += this.#svx[i] * step;
      this.#spy[i] += this.#svy[i] * step;
      this.#spz[i] += this.#svz[i] * step;
      i++;
    }

    const pos = this.#position, alpha = this.#alpha, size = this.#size;
    for (let k = 0; k < this.#live; k++) {
      const u = clamp01((now - this.#birth[k]) / this.#life[k]); // 0 fresh .. 1 dead
      const a = 1 - u * u;
      const sz = this.#baseSize[k] * (1 - 0.55 * u);
      const x = this.#spx[k], y = this.#spy[k], z = this.#spz[k];
      const o3 = k * 12, o1 = k * 4;
      for (let v = 0; v < 4; v++) {
        pos[o3 + v * 3] = x;
        pos[o3 + v * 3 + 1] = y;
        pos[o3 + v * 3 + 2] = z;
        alpha[o1 + v] = a;
        size[o1 + v] = sz;
      }
    }
    this.#positionAttr.needsUpdate = true;
    this.#alphaAttr.needsUpdate = true;
    this.#sizeAttr.needsUpdate = true;
    this.#geometry.setDrawRange(0, this.#live * 6);
    this.object.visible = this.#live > 0;
    this.#uniforms.uTime.value = now;
  }

  /** Empty the live pool (spawned / dropped keep counting for this instance). */
  clear(): void {
    this.#live = 0;
    this.#geometry.setDrawRange(0, 0);
    this.object.visible = false;
  }

  /** Re-colour both layers in place (not part of the frozen API, but cheap). */
  setColours(palette: TrailPalette): void {
    applyPalette(this.#uniforms, palette);
  }

  /** Test/debug: this spark's current velocity (m/s), or null when out of range. */
  velocityOf(i: number): [number, number, number] | null {
    if (i < 0 || i >= this.#live) return null;
    return [this.#svx[i], this.#svy[i], this.#svz[i]];
  }

  /** Test/debug: this spark's current world position (m), or null when out of range. */
  positionOf(i: number): [number, number, number] | null {
    if (i < 0 || i >= this.#live) return null;
    return [this.#spx[i], this.#spy[i], this.#spz[i]];
  }

  /** Move the last live spark into slot `to` (swap-remove), keeping the pool packed. */
  #swapRemove(to: number, from: number): void {
    if (to === from) return;
    this.#spx[to] = this.#spx[from];
    this.#spy[to] = this.#spy[from];
    this.#spz[to] = this.#spz[from];
    this.#svx[to] = this.#svx[from];
    this.#svy[to] = this.#svy[from];
    this.#svz[to] = this.#svz[from];
    this.#birth[to] = this.#birth[from];
    this.#life[to] = this.#life[from];
    this.#baseSize[to] = this.#baseSize[from];
  }

  /** Inline mulberry32 step (core/MathCore.rng32's algorithm); no closure, no allocation. */
  #rand(): number {
    const a = this.#rngState = (this.#rngState + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Free every GPU resource and detach the root. */
  dispose(): void {
    this.object.removeFromParent();
    this.#geometry.dispose();
    for (const m of this.#materials) m.dispose();
  }
}
