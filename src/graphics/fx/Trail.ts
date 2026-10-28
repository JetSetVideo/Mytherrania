// RibbonTrail: the THREE wrapper around a TrailBuffer. One BufferGeometry with
// preallocated attributes rewritten in place each frame (setDrawRange shows only
// the live rows), drawn by TWO meshes sharing it: a normal-blended outer layer
// (daylight) and an additive hot core (shadow). Positions are WORLD space, so
// the trail's root object must stay at the identity transform — add `object`
// directly to the scene (or to an untransformed group).
//
// Cost per active trail: 2 draw calls, 2 * (rows - 1) triangles per layer, at
// most 2 * (maxRows - 1). Frustum culling uses a bounding sphere rebuilt from
// the TrailBuffer's bounds every update (no allocation).

// @deno-types="@types/three"
import * as THREE from "three";
import { stripIndices, TrailBuffer, type TrailBufferOptions, type Vec3Like } from "./TrailBuffer.ts";
import type { TrailPalette } from "./FxRecipes.ts";
import {
  applyPalette,
  createFxUniforms,
  createLayerMeshes,
  createLayerPair,
  type FxUniforms,
  type LayerPair,
  RIBBON_CORE_FRAGMENT,
  RIBBON_OUTER_FRAGMENT,
  RIBBON_VERTEX,
} from "./FxShaders.ts";

/** Construction options. Times in seconds, distances in metres. */
export interface RibbonTrailOptions extends Omit<TrailBufferOptions, "widthScale"> {
  /** Spread multiplier of each row about its taper pivot (1 = the exact pushed edges). Default 1. */
  width?: number;
  /** Element palette (FxRecipes.trailPalette). */
  colours: TrailPalette;
  /** 0 = brightest along edge 1 (weapons: the tip leads), 1 = brightest mid-ribbon (bodies). Default 0. */
  profile?: number;
}

/** A world-space ribbon trail with a two-layer element shader. */
export class RibbonTrail {
  /** Add this to the scene. Holds the outer and core meshes. */
  readonly object = new THREE.Group();
  readonly buffer: TrailBuffer;
  readonly geometry = new THREE.BufferGeometry();
  readonly uniforms: FxUniforms;
  readonly materials: LayerPair;
  readonly #outer: THREE.Mesh;
  readonly #core: THREE.Mesh;
  readonly #position: THREE.BufferAttribute;
  readonly #alpha: THREE.BufferAttribute;
  readonly #along: THREE.BufferAttribute;

  constructor(options: RibbonTrailOptions) {
    this.buffer = new TrailBuffer({ ...options, widthScale: options.width ?? 1 });
    const maxVerts = this.buffer.maxRows * 2;
    // The attributes WRAP the buffer's own output arrays: build() writes straight
    // into what the GPU uploads, so there is no per-frame copy.
    this.#position = new THREE.BufferAttribute(this.buffer.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.#alpha = new THREE.BufferAttribute(this.buffer.alphas, 1).setUsage(THREE.DynamicDrawUsage);
    this.#along = new THREE.BufferAttribute(this.buffer.along, 1).setUsage(THREE.DynamicDrawUsage);
    const side = new Float32Array(maxVerts);
    for (let v = 0; v < maxVerts; v++) side[v] = v & 1; // even = edge 0, odd = edge 1
    this.geometry.setAttribute("position", this.#position);
    this.geometry.setAttribute("aAlpha", this.#alpha);
    this.geometry.setAttribute("aAlong", this.#along);
    this.geometry.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
    this.geometry.setIndex(new THREE.BufferAttribute(stripIndices(this.buffer.maxRows), 1));
    this.geometry.setDrawRange(0, 0);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
    this.geometry.boundingBox = new THREE.Box3();

    this.uniforms = createFxUniforms(options.colours, { uProfile: { value: options.profile ?? 0 } });
    this.materials = createLayerPair(RIBBON_VERTEX, RIBBON_OUTER_FRAGMENT, RIBBON_CORE_FRAGMENT, this.uniforms);
    [this.#outer, this.#core] = createLayerMeshes(this.geometry, this.materials);
    this.object.add(this.#outer, this.#core);
    this.object.name = "fx-ribbon-trail";
    // World-space vertices: the root must never move.
    this.object.matrixAutoUpdate = false;
    this.object.visible = false;
  }

  /** Seconds a sample stays visible (alpha reaches 0 at this age). */
  get lifetime(): number {
    return this.buffer.lifetime;
  }
  set lifetime(seconds: number) {
    this.buffer.lifetime = seconds;
  }

  /** Triangles drawn per layer by the last update (multiply by 2 for both layers). */
  get triangleCount(): number {
    return Math.max(0, this.buffer.rows - 1) * 2;
  }

  /** Draw calls this trail costs this frame (0 when hidden). */
  get drawCalls(): number {
    return this.object.visible ? 2 : 0;
  }

  /** Record the ribbon edges `a` (edge 0) and `b` (edge 1) at time `now` (s). Returns true when stored. */
  push(a: Vec3Like, b: Vec3Like, now: number): boolean {
    return this.buffer.pushEdges(a, b, now);
  }

  /**
   * Rebuild the strip at time `now` (s): expire, write vertices in place, set the
   * draw range and bounding sphere, and hide the meshes when nothing is left.
   * Returns the vertex count.
   */
  update(now: number): number {
    const verts = this.buffer.build(now);
    const rows = this.buffer.rows;
    this.uniforms.uTime.value = now;
    this.geometry.setDrawRange(0, Math.max(0, rows - 1) * 6);
    this.object.visible = rows >= 2;
    if (rows < 2) return 0;
    // Full re-upload of three small arrays (<= 2 * maxRows * 3 floats, ~4 KB for a
    // weapon trail). addUpdateRange would upload less but allocates a {start, count}
    // record per call, and this path must not allocate.
    this.#position.needsUpdate = true;
    this.#alpha.needsUpdate = true;
    this.#along.needsUpdate = true;
    const b = this.buffer.bounds;
    const box = this.geometry.boundingBox!;
    box.min.set(b[0], b[1], b[2]);
    box.max.set(b[3], b[4], b[5]);
    const sphere = this.geometry.boundingSphere!;
    box.getCenter(sphere.center);
    sphere.radius = 0.5 * Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
    return verts;
  }

  /** Re-colour both layers (no allocation). */
  setColours(colours: TrailPalette): void {
    applyPalette(this.uniforms, colours);
  }

  /** Colour gain (FxIntensity.brightness) and overall opacity 0..1. */
  setIntensity(brightness: number, opacity = 1): void {
    this.uniforms.uBrightness.value = brightness;
    this.uniforms.uOpacity.value = opacity;
  }

  /** Drop every sample; the trail vanishes on the next update. */
  clear(): void {
    this.buffer.clear();
    this.geometry.setDrawRange(0, 0);
    this.object.visible = false;
  }

  /** Release GPU resources and detach from the parent. */
  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    this.materials.outer.dispose();
    this.materials.core.dispose();
  }
}
