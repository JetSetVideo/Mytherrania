// @deno-types="@types/three"
import * as THREE from "three";
import { buildPreviewRig, PEDESTAL_FRAME_PER_RADIUS, PEDESTAL_RADIUS, PORTRAIT_FLOOR_FAR_DIM, previewKey, PreviewStage, type StageRenderer } from "./PreviewScene.ts";
import type { CharacterProfile } from "../game/Characters.ts";
import { backdropPixels, UI_WALNUT_DEEP } from "./PortraitBackdrop.ts";

/**
 * PortraitStudio — the Profiles panel's thumbnail factory (wave O, lane O-A).
 *
 * Why a studio and not `renderPortrait`: the sheet screen wants a picture of EVERY saved profile,
 * and the old path built a WHOLE new `WebGLRenderer` per call. Browsers cap live WebGL contexts
 * (~16), so a twelve-row list would exhaust them and later canvases would silently go black. This
 * class stands ONE offscreen renderer (created lazily, on the first real render) behind a cache
 * keyed by the rig's build key, so twelve rows cost one context and one render each.
 *
 * The rig is built by `buildPreviewRig` — the same function `PreviewScene` runs — so a thumbnail
 * is the fighter the arena builds, not the stale `buildHumanoid` body.
 *
 * Wave Z: the picture is now the hero card's FULL-CARD background — a 3:4 full figure on the viewer's stone plinth
 * and floor, framed by the pedestal law (see portraitFraming); the paragraph below is the wave-O history.
 *
 * Framing (requirement 6, wave O): a HEAD-AND-SHOULDERS shot, not a full body. The rig's origin is the
 * sole plane (model y = 0) and a standing fighter's head sits near y = 1.7 m, so the camera looks
 * at y = 1.58 m (the chin-to-eye band) from 0.82 m away at a 30° field of view: that frames roughly
 * the top 0.45 m of the figure, wide enough for the shoulders and tight enough that the face reads
 * at 48 px. A 0.05 m near plane keeps the nose (≈ 0.75 m from the camera) out of the clip.
 */

/** Edge length in px of an explicit square `size` option's default (kept for callers that ask for a square). */
const DEFAULT_SIZE = 256;
/** Floor on the size option: below this a PNG is a smear, so a nonsensical option still renders (requirement 5). */
const MIN_SIZE = 16;

/**
 * Camera framing of a portrait — see the module comment. Wave P: the DISTANCE and the look-at height are
 * no longer constants; they are derived from the rig's measured height by `#frameToRig` (a fixed 0.82 m
 * stand-off cropped tall characters). What stays constant is the 3/4 angle and the field of view.
 */
const PORTRAIT_DISTANCE = 0.82;
const PORTRAIT_HEIGHT = 1.62;
const PORTRAIT_YAW = 0.35;
const PORTRAIT_TARGET_Y = 1.58;
const PORTRAIT_FOV = 30;

/** The subset of THREE.WebGLRenderer the studio drives, so a test can stand in a fake (no GL under Deno). */
export interface PortraitRenderer {
  setSize(width: number, height: number): void;
  setPixelRatio(ratio: number): void;
  setClearColor(colour: string | number, alpha?: number): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  readonly domElement: { toDataURL(type?: string, quality?: number): string };
  dispose(): void;
}

export interface PortraitOptions {
  /** Edge length in px of a SQUARE portrait (the pre-wave-Z shape), clamped up to at least 16. */
  size?: number;
  /** Wave Z: explicit width/height in px (override `size`); clamped to [16, 4096]. */
  width?: number;
  height?: number;
  /** Wave Z: the image type of the data URL (default "image/jpeg": the card picture is opaque) and its quality. */
  type?: "image/jpeg" | "image/png" | "image/webp";
  quality?: number;
  /** Test seam: build the offscreen renderer. Defaults to a real THREE.WebGLRenderer. */
  createRenderer?: (width: number, height: number) => PortraitRenderer;
}

/**
 * Wave Z (lane G): the hero card shows the portrait as its FULL-CARD background (object-fit: cover in a 3:4 plate,
 * 240-560 CSS px wide — agreed with lane F on the board, Z-6/Z-11). So with no size option the studio renders a
 * 3:4 picture of `PORTRAIT_CARD_CSS_WIDTH` CSS px (lane F's widest plate, Z-11) at the page's device pixel ratio (capped
 * at 2): 560 x 747 at DPR 1, 1120 x 1493 at DPR 2 — never upscaled on the card. Pure.
 */
export const PORTRAIT_ASPECT = 3 / 4;
export const PORTRAIT_CARD_CSS_WIDTH = 560;
export function portraitPixelSize(dpr = 1, cssWidth = PORTRAIT_CARD_CSS_WIDTH, aspect = PORTRAIT_ASPECT): { width: number; height: number } {
  const k = Math.min(2, Math.max(1, Number.isFinite(dpr) ? dpr : 1));
  const width = Math.max(16, Math.min(4096, Math.round((cssWidth * k) / 4) * 4));
  return { width, height: Math.max(16, Math.min(4096, Math.round(width / aspect))) };
}

/**
 * Wave Z: the portrait's composition — the SAME constant framing rule as the Creator's viewer (frame top =
 * PEDESTAL_FRAME_PER_RADIUS x PEDESTAL_RADIUS, the tallest standing fighter + raised blade; a taller model frames by
 * its own top), solved for a camera pitched `pitch` down so that the frame top lands at `topFrac` of the image
 * height (a 2.2 m ork's head stays below ~18 %, the LV badge's corner band) and the soles (y = 0, the plinth top) at
 * `soleFrac` (the bottom 30 % stays plinth + floor for the floating name and tags). For a point on the axis at height y seen from horizontal distance D and
 * height cy, NDC height n satisfies D(sin p - n t cos p) + (y - cy)(cos p + n t sin p) = 0, t = tan(fov/2):
 * two such equations (frame top, soles) give D and cy. Pure numbers.
 */
export const PORTRAIT_FRAME = { fovDeg: 30, pitch: 0.1, yaw: 0.35, topFrac: 0.1, soleFrac: 0.7 } as const;
export function portraitFraming(modelTopM = 0, aspect = PORTRAIT_ASPECT): { distance: number; cameraY: number; targetY: number; frameTop: number; clipped: boolean; halfWidthAtAxis: number } {
  const { fovDeg, pitch: p, topFrac, soleFrac } = PORTRAIT_FRAME;
  const t = Math.tan(((fovDeg / 2) * Math.PI) / 180);
  const top0 = PEDESTAL_FRAME_PER_RADIUS * PEDESTAL_RADIUS, clipped = modelTopM > top0, top = clipped ? modelTopM : top0;
  const n1 = 1 - 2 * topFrac, n2 = 1 - 2 * soleFrac;
  const a = (n: number) => Math.sin(p) - n * t * Math.cos(p), b = (n: number) => Math.cos(p) + n * t * Math.sin(p);
  const D = (-top * b(n1)) / (a(n1) - (a(n2) * b(n1)) / b(n2));
  const cy = (D * a(n2)) / b(n2);
  // Depth of the axis point at the camera's own height band, for the horizontal half extent (the pedestal must fit).
  return { distance: D, cameraY: cy, targetY: cy - D * Math.tan(p), frameTop: top, clipped, halfWidthAtAxis: D / Math.cos(p) * t * aspect };
}

/** Wave Z: the portrait camera for a rig (its measured top only matters above the frame top). */
export function portraitCamera(rig: THREE.Object3D, aspect = PORTRAIT_ASPECT): THREE.PerspectiveCamera {
  const box = new THREE.Box3().setFromObject(rig);
  const f = portraitFraming(box.isEmpty() ? 0 : box.max.y, aspect);
  const cam = new THREE.PerspectiveCamera(PORTRAIT_FRAME.fovDeg, aspect, 0.05, 40);
  cam.position.set(Math.sin(PORTRAIT_FRAME.yaw) * f.distance, f.cameraY, Math.cos(PORTRAIT_FRAME.yaw) * f.distance);
  cam.lookAt(0, f.targetY, 0);
  cam.updateMatrixWorld(true);
  return cam;
}

/** The default offscreen renderer (the backdrop texture covers the frame; the clear colour is its corner walnut). */
function defaultRenderer(width: number, height: number): PortraitRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height);
  renderer.setClearColor(PORTRAIT_CLEAR, 1);
  return renderer;
}

/**
 * Wave W (lane H): the portrait's clear colour and backdrop. It was #172128 — a cold blue-grey (RGB 23,
 * 33, 40) under every hero card, clashing with the walnut/gold UI. Now the deep walnut of the UI, and the
 * scene background is PortraitBackdrop's warm vignette (leather centre, walnut edges, a faint gold glow).
 */
export const PORTRAIT_CLEAR = UI_WALNUT_DEEP;
/** Backdrop texture edge (px): a smooth gradient needs few texels (bilinear filtering does the rest). */
export const BACKDROP_TEXELS = 64;
/** The portrait's backdrop as a texture (rows uploaded bottom-up: GL's v = 0 is the bottom). */
export function backdropTexture(n = BACKDROP_TEXELS): THREE.DataTexture {
  const top = backdropPixels(n, n), data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) data.set(top.subarray((n - 1 - y) * n * 4, (n - y) * n * 4), y * n * 4);
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** The same three-light pedestal `PreviewScene` uses, so a thumbnail matches the live preview. */
function addPortraitLights(scene: THREE.Scene): void {
  const ambient = new THREE.AmbientLight("#e8dcc8", 0.9);
  const key = new THREE.DirectionalLight("#fff3cf", 1.2);
  key.position.set(1, 2, 2);
  const rim = new THREE.DirectionalLight("#dfaa55", 0.5);
  rim.position.set(-1, 0.5, -0.5);
  scene.add(ambient, key, rim);
}

export class PortraitStudio {
  #width: number;
  #height: number;
  #type: string;
  #quality: number;
  #stage: PreviewStage | null = null;
  #lastMs = 0;
  #createRenderer: (width: number, height: number) => PortraitRenderer;
  #renderer: PortraitRenderer | null = null;
  #scene: THREE.Scene | null = null;
  #root: THREE.Group | null = null;
  #camera: THREE.PerspectiveCamera | null = null;
  #disposed = false;
  #renders = 0;
  #cacheHits = 0;
  /** A PNG data URL per build key. An empty string is cached too: a profile that cannot render must not re-throw. */
  readonly #cache = new Map<string, string>();

  constructor(options: PortraitOptions = {}) {
    // A zero/negative/huge option must survive: floor it (so nothing divides by zero) and cap it
    // to a sane texture edge so a hostile option cannot ask for a 1e9-px framebuffer.
    const edge = (asked: number | undefined, d: number) => Math.min(4096, Math.max(MIN_SIZE, Math.floor(Number.isFinite(asked) ? asked! : d)));
    if (options.width !== undefined || options.height !== undefined) {
      // Wave Z: an explicit rectangle (a missing side follows the card's 3:4).
      this.#width = edge(options.width ?? (options.height ?? 0) * PORTRAIT_ASPECT, DEFAULT_SIZE);
      this.#height = edge(options.height ?? this.#width / PORTRAIT_ASPECT, DEFAULT_SIZE);
    } else if (options.size !== undefined) {
      // Pre-wave-Z callers: a square of `size`.
      this.#width = this.#height = edge(options.size, DEFAULT_SIZE);
    } else {
      // Wave Z default: the full-card 3:4 background at the page's device pixel ratio.
      const px = portraitPixelSize((globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1);
      this.#width = px.width; this.#height = px.height;
    }
    this.#type = options.type ?? "image/jpeg";
    this.#quality = Math.max(0.5, Math.min(1, options.quality ?? 0.9));
    this.#createRenderer = options.createRenderer ?? defaultRenderer;
  }

  /** Build the one renderer/scene/camera the first time a real render is needed (requirement 1). */
  #ensure(): { renderer: PortraitRenderer; scene: THREE.Scene; root: THREE.Group; camera: THREE.PerspectiveCamera } {
    if (!this.#renderer || !this.#scene || !this.#root || !this.#camera) {
      this.#renderer = this.#createRenderer(this.#width, this.#height);
      this.#renderer.setPixelRatio(1);
      this.#renderer.setSize(this.#width, this.#height);
      this.#renderer.setClearColor(PORTRAIT_CLEAR, 1);
      this.#scene = new THREE.Scene();
      this.#scene.background = backdropTexture();
      addPortraitLights(this.#scene);
      // Wave Z: the Creator viewer's stage (stone plinth on a flagstone floor, the overhead key's soft shadow, the
      // face fill) — the card picture is lit and grounded exactly like the turntable.
      this.#stage = new PreviewStage();
      this.#stage.floorFarDim = PORTRAIT_FLOOR_FAR_DIM; // the card's name/tags band sits on this floor
      this.#scene.add(this.#stage.group);
      this.#root = new THREE.Group();
      this.#scene.add(this.#root);
      this.#camera = new THREE.PerspectiveCamera(PORTRAIT_FOV, this.#width / this.#height, 0.05, 40);
      // Wave P: the framing distance is a PLACEHOLDER here — #frameToRig() derives it from the
      // character's own measured height on every render, so a 2 m ork and a 1.35 m dwarf both fit.
      const x = Math.sin(PORTRAIT_YAW) * PORTRAIT_DISTANCE;
      const z = Math.cos(PORTRAIT_YAW) * PORTRAIT_DISTANCE;
      this.#camera.position.set(x, PORTRAIT_HEIGHT, z);
      this.#camera.lookAt(0, PORTRAIT_TARGET_Y, 0);
    }
    return { renderer: this.#renderer, scene: this.#scene, root: this.#root, camera: this.#camera };
  }

  /**
   * Wave P: frame the CURRENT rig. The last wave's studio used a fixed 0.82 m stand-off, which cropped
   * tall characters exactly as the user described. Same law as the Creator's viewer:
   *
   *   distance = (measuredHeight / 2 + margin) / tan(fovY / 2)
   *
   * with the height taken from the rig's own bounding box and clamped into a stated band.
   */
  #frameToRig(rig: THREE.Object3D, camera: THREE.PerspectiveCamera): void {
    // Wave Z: the shared portraitCamera law (see portraitFraming), copied onto the studio's own camera.
    const c = portraitCamera(rig, this.#width / this.#height);
    camera.fov = c.fov; camera.aspect = c.aspect; camera.near = c.near; camera.far = c.far;
    camera.position.copy(c.position); camera.quaternion.copy(c.quaternion);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  }

  /** A PNG data URL of `profile`, cached by its build key. One renderer, every profile. */
  portraitOf(profile: CharacterProfile): string {
    if (this.#disposed) return "";
    const key = previewKey(profile);
    const hit = this.#cache.get(key);
    if (hit !== undefined) {
      this.#cacheHits++;
      return hit;
    }
    let url = "";
    try {
      const { renderer, scene, root, camera } = this.#ensure();
      const { rig, fighter } = buildPreviewRig(profile);
      // Tag the render root with the key the studio is drawing: QA (and the test's fake renderer)
      // can read which profile a frame belongs to without a second channel.
      root.userData.portraitKey = key;
      root.add(rig.group);
      // Settle the rest pose so the shot is the idle frame, not a bind-pose statue (dt = 0 s).
      rig.update(fighter.skeleton, 0);
      // Wave Z: the pedestal framing law (constant distance; a model above the frame top frames by its own top).
      this.#frameToRig(rig.group, camera);
      const t0 = performance.now();
      this.#stage!.draw(renderer as unknown as StageRenderer, scene, camera);
      url = renderer.domElement.toDataURL(this.#type, this.#quality);
      this.#lastMs = performance.now() - t0;
      root.remove(rig.group);
    } catch {
      // No GL context (headless/Deno), a hostile profile, or a driver failure: an empty thumbnail,
      // never a thrown error that would take the whole panel down (requirement 5).
      url = "";
    }
    this.#renders++;
    this.#cache.set(key, url);
    return url;
  }

  /** Forget one profile (its appearance changed) or everything. */
  forget(key: string): void {
    this.#cache.delete(key);
  }

  clear(): void {
    this.#cache.clear();
  }

  stats(): { renders: number; cacheHits: number; cached: number } {
    return { renders: this.#renders, cacheHits: this.#cacheHits, cached: this.#cache.size };
  }

  /** QA (wave Z): the output size and the last draw + encode time (ms; the rig build is not in it). */
  debugInfo(): { width: number; height: number; type: string; lastDrawMs: number } {
    return { width: this.#width, height: this.#height, type: this.#type, lastDrawMs: Math.round(this.#lastMs * 10) / 10 };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#renderer?.dispose();
    this.#stage?.dispose();
    this.#stage = null;
    this.#renderer = null;
    this.#scene = null;
    this.#root = null;
    this.#camera = null;
    this.#cache.clear();
  }
}
