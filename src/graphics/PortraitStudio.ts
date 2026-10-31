// @deno-types="@types/three"
import * as THREE from "three";
import { buildPreviewRig, previewKey } from "./PreviewScene.ts";
import type { CharacterProfile } from "../game/Characters.ts";

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
 * Framing (requirement 6): a HEAD-AND-SHOULDERS shot, not a full body. The rig's origin is the
 * sole plane (model y = 0) and a standing fighter's head sits near y = 1.7 m, so the camera looks
 * at y = 1.58 m (the chin-to-eye band) from 0.82 m away at a 30° field of view: that frames roughly
 * the top 0.45 m of the figure, wide enough for the shoulders and tight enough that the face reads
 * at 48 px. A 0.05 m near plane keeps the nose (≈ 0.75 m from the camera) out of the clip.
 */

/** Default portrait edge length in px (the panel's thumbnail needs ~48 px of face; 256 stays crisp on retina). */
const DEFAULT_SIZE = 256;
/** Floor on the size option: below this a PNG is a smear, so a nonsensical option still renders (requirement 5). */
const MIN_SIZE = 16;

/** Camera framing of a portrait (metres, degrees) — see the module comment. */
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
  readonly domElement: { toDataURL(type?: string): string };
  dispose(): void;
}

export interface PortraitOptions {
  /** Edge length in px (square); default 256, clamped up to at least 16. */
  size?: number;
  /** Test seam: build the offscreen renderer. Defaults to a real THREE.WebGLRenderer. */
  createRenderer?: (size: number) => PortraitRenderer;
}

/** The default offscreen renderer: alpha-transparent so the panel's gradient shows through the corners. */
function defaultRenderer(size: number): PortraitRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size);
  renderer.setClearColor("#172128", 1);
  return renderer;
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
  #size: number;
  #createRenderer: (size: number) => PortraitRenderer;
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
    const asked = options.size ?? DEFAULT_SIZE;
    this.#size = Math.min(4096, Math.max(MIN_SIZE, Math.floor(Number.isFinite(asked) ? asked : DEFAULT_SIZE)));
    this.#createRenderer = options.createRenderer ?? defaultRenderer;
  }

  /** Build the one renderer/scene/camera the first time a real render is needed (requirement 1). */
  #ensure(): { renderer: PortraitRenderer; scene: THREE.Scene; root: THREE.Group; camera: THREE.PerspectiveCamera } {
    if (!this.#renderer || !this.#scene || !this.#root || !this.#camera) {
      this.#renderer = this.#createRenderer(this.#size);
      this.#renderer.setPixelRatio(1);
      this.#renderer.setSize(this.#size, this.#size);
      this.#renderer.setClearColor("#172128", 1);
      this.#scene = new THREE.Scene();
      addPortraitLights(this.#scene);
      this.#root = new THREE.Group();
      this.#scene.add(this.#root);
      this.#camera = new THREE.PerspectiveCamera(PORTRAIT_FOV, 1, 0.05, 20);
      const x = Math.sin(PORTRAIT_YAW) * PORTRAIT_DISTANCE;
      const z = Math.cos(PORTRAIT_YAW) * PORTRAIT_DISTANCE;
      this.#camera.position.set(x, PORTRAIT_HEIGHT, z);
      this.#camera.lookAt(0, PORTRAIT_TARGET_Y, 0);
    }
    return { renderer: this.#renderer, scene: this.#scene, root: this.#root, camera: this.#camera };
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
      renderer.render(scene, camera);
      url = renderer.domElement.toDataURL("image/png");
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

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#renderer?.dispose();
    this.#renderer = null;
    this.#scene = null;
    this.#root = null;
    this.#camera = null;
    this.#cache.clear();
  }
}
