// Ground ring decal (impact / arrival / bracing pulse) and the shield shimmer
// arc. Both are two-layer (normal outer + additive core) meshes sharing one
// geometry and one uniforms object, built once and re-fired from a pool slot —
// firing allocates nothing.
//
// Cost when visible: RingDecal 2 draw calls x 2 triangles; ShieldArc 2 draw
// calls x 2 * SHIELD_SEGMENTS triangles.

// @deno-types="@types/three"
import * as THREE from "three";
import { clamp01, lerp } from "../../core/MathCore.ts";
import { easeOutCubic, envelope, type TrailPalette } from "./FxRecipes.ts";
import type { Vec3Like } from "./TrailBuffer.ts";
import {
  applyPalette,
  createFxUniforms,
  createLayerMeshes,
  createLayerPair,
  DECAL_VERTEX,
  type FxUniforms,
  type LayerPair,
  RING_CORE_FRAGMENT,
  RING_OUTER_FRAGMENT,
  SHIELD_CORE_FRAGMENT,
  SHIELD_OUTER_FRAGMENT,
  SHIELD_VERTEX,
} from "./FxShaders.ts";

/**
 * Lift of every ground decal above the floor (m): 1.5 cm clears depth-buffer
 * z-fighting at the 0.1 m near plane without visibly floating; polygon offset
 * covers the rest.
 */
export const DECAL_LIFT = 0.015;
/** Ring radius in quad units at the start / end of the expansion (the quad spans -1..1; 0.87 leaves room for the soft band). */
const RING_START = 0.12;
const RING_END = 0.87;
/** Band width in quad units at the start / end: thick when fresh, thin as it spreads. */
const RING_WIDTH_START = 0.2;
const RING_WIDTH_END = 0.06;
/** Share of the ring's life over which it fades out (the last 45%). */
const RING_FADE_SHARE = 0.45;

/** Push a decal material toward the camera in depth so it wins against the floor it lies on. */
export function asDecal(pair: LayerPair): void {
  for (const m of [pair.outer, pair.core]) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
  }
}

/** Expanding ring on the ground. Fire it, then call update(now) every frame. */
export class RingDecal {
  /** Positioned at the ring centre; lies on the local xz plane. */
  readonly object = new THREE.Group();
  readonly uniforms: FxUniforms;
  readonly #geometry = new THREE.BufferGeometry();
  readonly #pair: LayerPair;
  #start = -Infinity;
  #duration = 0;

  constructor(palette: TrailPalette) {
    // A 2-triangle quad on xz; aUv = (x, z) in -1..1 so the shader measures radius directly.
    const pos = new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]);
    const uv = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
    this.#geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.#geometry.setAttribute("aUv", new THREE.BufferAttribute(uv, 2));
    this.#geometry.setIndex([0, 2, 1, 0, 3, 2]);
    this.#geometry.computeBoundingSphere();
    this.uniforms = createFxUniforms(palette, { uRing: { value: RING_START }, uWidth: { value: RING_WIDTH_START } });
    this.#pair = createLayerPair(DECAL_VERTEX, RING_OUTER_FRAGMENT, RING_CORE_FRAGMENT, this.uniforms);
    asDecal(this.#pair);
    this.object.add(...createLayerMeshes(this.#geometry, this.#pair));
    this.object.name = "fx-ring";
    this.object.visible = false;
  }

  /** True while the ring is expanding or fading. */
  get active(): boolean {
    return this.object.visible;
  }

  /** Draw calls this frame (0 when hidden). */
  get drawCalls(): number {
    return this.object.visible ? 2 : 0;
  }

  /** Triangles per layer when visible. */
  readonly triangleCount = 2;

  /**
   * Start a ring centred on ground point `at` (m), growing to `radius` metres over
   * `duration` seconds from `now`, with colour gain `brightness`.
   */
  fire(at: Vec3Like, radius: number, duration: number, now: number, brightness = 1): void {
    this.object.position.set(at.x, at.y + DECAL_LIFT, at.z);
    // The quad's -1..1 maps to metres so the ring ends exactly at `radius`.
    this.object.scale.setScalar(Math.max(0.01, radius / RING_END));
    this.#start = now;
    this.#duration = Math.max(0.05, duration);
    this.uniforms.uBrightness.value = brightness;
    this.object.visible = true;
    this.update(now);
  }

  /** Advance the expansion; hides itself when finished. */
  update(now: number): void {
    if (!this.object.visible) return;
    const k = (now - this.#start) / this.#duration;
    if (k >= 1) {
      this.object.visible = false;
      return;
    }
    const grow = easeOutCubic(k);
    this.uniforms.uRing.value = lerp(RING_START, RING_END, grow);
    this.uniforms.uWidth.value = lerp(RING_WIDTH_START, RING_WIDTH_END, grow);
    this.uniforms.uOpacity.value = 1 - clamp01((k - (1 - RING_FADE_SHARE)) / RING_FADE_SHARE);
    this.uniforms.uTime.value = now;
  }

  /** Re-colour in place. */
  setColours(palette: TrailPalette): void {
    applyPalette(this.uniforms, palette);
  }

  /** Hide immediately. */
  stop(): void {
    this.object.visible = false;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.#geometry.dispose();
    this.#pair.outer.dispose();
    this.#pair.core.dispose();
  }
}

/** Radial segments of the shield arc: 18 over 140 deg = 7.8 deg each, round enough for the fresnel rim. */
export const SHIELD_SEGMENTS = 18;
/** Angular width of the arc in radians (140 deg): covers the front without hiding the fighter's flanks. */
export const SHIELD_ARC = (140 * Math.PI) / 180;

/** Shimmering partial cylinder in front of a fighter (defense recipe). */
export class ShieldArc {
  /** Positioned at the fighter's ground point and yawed to face the opponent (local +z = forward). */
  readonly object = new THREE.Group();
  readonly uniforms: FxUniforms;
  readonly #geometry: THREE.CylinderGeometry;
  readonly #pair: LayerPair;
  #start = -Infinity;
  #rise = 0;
  #stop = Infinity;
  #fall = 0;
  #opacity = 0;

  constructor(palette: TrailPalette) {
    // Unit open cylinder segment centred on +z (three: x = r sin θ, z = r cos θ),
    // bottom at y = 0 so scale.y is the shield height above the soles.
    this.#geometry = new THREE.CylinderGeometry(1, 1, 1, SHIELD_SEGMENTS, 1, true, -SHIELD_ARC / 2, SHIELD_ARC);
    this.#geometry.translate(0, 0.5, 0);
    this.uniforms = createFxUniforms(palette);
    this.#pair = createLayerPair(SHIELD_VERTEX, SHIELD_OUTER_FRAGMENT, SHIELD_CORE_FRAGMENT, this.uniforms);
    this.object.add(...createLayerMeshes(this.#geometry, this.#pair));
    this.object.name = "fx-shield";
    this.object.visible = false;
  }

  /** Triangles per layer when visible. */
  readonly triangleCount = SHIELD_SEGMENTS * 2;

  get active(): boolean {
    return this.object.visible;
  }

  get drawCalls(): number {
    return this.object.visible ? 2 : 0;
  }

  /**
   * Raise the shield: `radius` (m) from the body axis, `height` (m) tall, peak
   * `opacity` 0..1, reaching full strength `rise` seconds after `now`.
   */
  raise(radius: number, height: number, opacity: number, now: number, rise: number, brightness = 1): void {
    this.object.scale.set(radius, height, radius);
    this.#opacity = opacity;
    this.#start = now;
    this.#rise = rise;
    this.#stop = Infinity;
    this.#fall = 0;
    this.uniforms.uBrightness.value = brightness;
    this.object.visible = true;
  }

  /** Start fading out over `fall` seconds from `now`. Idempotent while already lowering. */
  lower(now: number, fall: number): void {
    if (!this.object.visible || this.#stop !== Infinity) return;
    this.#stop = now;
    this.#fall = fall;
  }

  /** Follow the fighter: `ground` = point under the body (m), `yaw` = facing (rad, rig.group.rotation.y). */
  update(now: number, ground: Vec3Like, yaw: number): void {
    if (!this.object.visible) return;
    const env = envelope(now, this.#start, this.#rise, this.#stop, this.#fall);
    if (this.#stop !== Infinity && now >= this.#stop + this.#fall) {
      this.object.visible = false;
      return;
    }
    this.object.position.set(ground.x, ground.y, ground.z);
    this.object.rotation.y = yaw;
    this.uniforms.uOpacity.value = env * this.#opacity;
    this.uniforms.uTime.value = now;
  }

  setColours(palette: TrailPalette): void {
    applyPalette(this.uniforms, palette);
  }

  stop(): void {
    this.object.visible = false;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.#geometry.dispose();
    this.#pair.outer.dispose();
    this.#pair.core.dispose();
  }
}
