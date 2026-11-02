// @deno-types="@types/three"
import * as THREE from "three";
import { buildSkinnedHumanoid, type SkinnedExtras } from "./body/SkinnedHumanoid.ts";
import { createFighter } from "../game/Fighter.ts";
import { skillsForClass } from "../game/Skills.ts";
import { generateClassWeapon } from "../game/WeaponGen.ts";
import { toGeneratedWeapon } from "../game/weapons/Adapter.ts";
import { HAIR_COLORS, mixHex, nameSeed, raceBuild, seededPick, SKIN_TONES } from "../game/RaceAppearance.ts";
import { randomSilhouette } from "../game/BodyProfile.ts";
import { seededRng } from "../game/Items.ts";
import type { CharacterProfile } from "../game/Characters.ts";
import type { Appearance } from "../game/Characters.ts";
import type { HumanoidRig } from "./Humanoid.ts";
import type { Fighter } from "../game/Fighter.ts";
import { UI_WALNUT_DEEP } from "./PortraitBackdrop.ts";

/**
 * PreviewScene — the live 3D portrait the Character Creator shows (wave L).
 *
 * Why a second renderer and a second rig: the Creator must show the fighter the
 * match will actually build, and the only way to promise that is to run the SAME
 * build path the arena runs (`raceBuild` → seeded hair/skin/silhouette →
 * `buildSkinnedHumanoid`), not a look-alike. `renderPortrait`
 * (graphics/Portrait.ts) predates the skinned rig and still calls `buildHumanoid`,
 * so its picture is of a body the game no longer renders; this module is the
 * replacement, and it is a live turntable instead of a one-shot PNG.
 *
 * Cost: one WebGL context and one rig, drawn only while the Creator's preview
 * panel is on screen (the caller decides; see `Engine.#updateCreatorPreview`).
 * At 360 x 440 with ~2 k triangles this is far below the frame budget the wave
 * before measured (spectate p99 2.7 ms of a 16.6 ms budget).
 *
 * CSP note: nothing here writes markup, so `style-src 'self'` does not apply; the
 * canvas is sized by its own width/height attributes and the CSS box.
 */

/** Turntable speed, rad/s: slow enough to read the face, fast enough to show the back. */
export const PREVIEW_SPIN_RAD_S = 0.45;
/** Idle breathe rate, rad/s of the skeleton clock — the rig's own rest pose, advanced in time. */
export const PREVIEW_IDLE_HZ = 0.5;

/**
 * Camera framing. Wave P: the distance is DERIVED from the character's own height, never a constant —
 * a 2.2 m ork and a 1.35 m dwarf must both fit the panel. The law:
 *
 *   visibleHalfHeight = tan(fovY/2) * distance   ->   distance = (halfHeight + marginM) / tan(fovY/2)
 *
 * with halfHeight measured from the rig's own bounding box and the vertical FOV (degrees -> radians).
 * The camera looks at 55 % of the character's height, which keeps the head in the upper third at any
 * stature, and a floor of CAM_DISTANCE_MIN_M keeps a tiny character from being pressed against the lens.
 */
const CAM_FOV = 38;
const CAM_MARGIN_M = 0.22;
const CAM_DISTANCE_MIN_M = 1.5;
const CAM_DISTANCE_MAX_M = 6.0;
/** Where the camera looks, as a fraction of the character's height (0 = feet, 1 = crown). */
const CAM_TARGET_FRAC = 0.55;
const CAM_YAW = 0.55;
/** Pitch clamp, radians: never below the horizon floor, never straight down. */
const CAM_PITCH_MIN = -0.45;
const CAM_PITCH_MAX = 1.15;

/** The lit-pedestal look: the same three lights `Portrait.ts` used, so the family resemblance holds. */
function addLights(scene: THREE.Scene): void {
  const ambient = new THREE.AmbientLight("#e8dcc8", 0.85);
  const key = new THREE.DirectionalLight("#fff3cf", 1.15);
  key.position.set(1, 2, 2);
  const rim = new THREE.DirectionalLight("#dfaa55", 0.55);
  rim.position.set(-1, 0.5, -0.5);
  scene.add(ambient, key, rim);
}

/**
 * The build key of a profile: everything `buildPreviewRig` reads (or `setProfile` skips a rebuild
 * on). Extracted so the live turntable AND the offscreen studio cache on the exact same string —
 * a thumbnail may not drift from the figure it thumbnails. Lengths are quantised to 4 dp (a
 * hundredth of a millimetre), the resolution the rig actually renders at.
 */
export function previewKey(profile: CharacterProfile): string {
  return `${profile.name}|${profile.race}|${profile.subrace ?? ""}|${profile.className}|${profile.weaponType ?? ""}|${profile.appearance.height.toFixed(4)}|${profile.appearance.weight.toFixed(4)}|${profile.appearance.hair ?? ""}|${profile.birthsign ?? ""}`;
}

/**
 * Build the preview rig a profile renders as — ONE place, shared by the live preview and the
 * studio. Runs the SAME path the arena runs (`raceBuild` → seeded hair/skin/silhouette →
 * `buildSkinnedHumanoid` with `{garment, weaponSpec}`), so a thumbnail cannot drift from the
 * figure the match builds. Pure geometry: no GL context, no DOM — the caller gives it a renderer.
 */
export function buildPreviewRig(profile: CharacterProfile): { rig: HumanoidRig & SkinnedExtras; fighter: Fighter } {
  const fighter = createFighter(profile.className, profile.name, 0, 0, 0.5, profile.race, profile.subrace, profile.weaponType);
  const skills = skillsForClass(fighter.className);
  const build = raceBuild(profile.race, profile.subrace);
  const seed = nameSeed(profile.name);
  const app: Appearance = {
    ...profile.appearance,
    race: profile.race,
    subrace: profile.subrace,
    hair: profile.appearance.hair ?? seededPick(HAIR_COLORS, seed),
    body: mixHex(build.tint, seededPick(SKIN_TONES, seed >>> 5), 0.4),
    silhouette: randomSilhouette(seededRng(seed ^ 0x2545f491), profile.race, profile.subrace),
  };
  const weaponGen = fighter.weaponSpec ? toGeneratedWeapon(fighter.weaponSpec) : generateClassWeapon(fighter.className);
  const rig = buildSkinnedHumanoid(weaponGen, app, skills[0].element, {
    race: profile.race, subrace: profile.subrace, className: fighter.className,
    height: app.height, weight: app.weight, seed, birthsign: profile.birthsign,
  }, { garment: profile.appearance.body, weaponSpec: fighter.weaponSpec });
  return { rig, fighter };
}

export class PreviewScene {
  #canvas: HTMLCanvasElement;
  #renderer: THREE.WebGLRenderer;
  #scene: THREE.Scene;
  #camera: THREE.PerspectiveCamera;
  #root: THREE.Group;
  #rig: (HumanoidRig & SkinnedExtras) | null = null;
  #fighter = createFighter("Warrior", "Preview", 0, 0, 0.5, "human", null);
  /** Manual orbit (wave P): the user turns the figure; it never rotates by itself. */
  #yaw = CAM_YAW;
  #pitch = 0.18;
  /** The current framing distance, derived from the character's height on every rebuild. */
  #distance: number = CAM_DISTANCE_MIN_M;
  /** The character's measured height, metres — public evidence for the wave's framing claim. */
  #heightM = 1.8;
  #clock = 0;
  #disposed = false;
  /** The name+race the current rig was built for, so `setProfile` can skip a rebuild. */
  #built = "";

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    this.#renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.#renderer.setClearColor(0x000000, 0);
    this.#renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio ?? 1));
    this.#scene = new THREE.Scene();
    addLights(this.#scene);
    // A dark disc under the boots so the model is not floating in the panel's gradient.
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.75, 40),
      // Wave W (lane H): the UI's deep walnut, not the old cold #172128 (blue-grey under a warm panel).
      new THREE.MeshBasicMaterial({ color: UI_WALNUT_DEEP, transparent: true, opacity: 0.55 }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.001;
    this.#scene.add(disc);
    this.#root = new THREE.Group();
    this.#scene.add(this.#root);
    this.#camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 14);
    this.#placeCamera();
    this.resize();
  }

  /** Place the camera from the CURRENT yaw/pitch/distance (called on a rebuild and on every drag). */
  #placeCamera(): void {
    const horiz = Math.cos(this.#pitch) * this.#distance;
    const y = CAM_TARGET_FRAC * this.#heightM + Math.sin(this.#pitch) * this.#distance;
    this.#camera.position.set(Math.sin(this.#yaw) * horiz, Math.max(0.25, y), Math.cos(this.#yaw) * horiz);
    this.#camera.lookAt(0, CAM_TARGET_FRAC * this.#heightM, 0);
  }

  /**
   * Turn the figure. `dx`/`dy` are pointer DELTAS in px; the sensitivity is stated per 100 px so a
   * mouse, a finger and a gamepad stick (which the engine maps to px deltas) all feel the same.
   */
  orbit(dx: number, dy: number): void {
    if (this.#disposed) return;
    const k = 0.6; // radians per 100 px
    this.#yaw += (dx / 100) * k;
    this.#pitch = Math.max(CAM_PITCH_MIN, Math.min(CAM_PITCH_MAX, this.#pitch - (dy / 100) * k));
    this.#placeCamera();
    this.#render(0);
  }

  /** The long axis of the character's own bounding box, metres (measured, not assumed). */
  #fitCameraToRig(): void {
    if (!this.#rig) return;
    const box = new THREE.Box3().setFromObject(this.#rig.group);
    const height = Math.max(0.5, box.max.y - box.min.y);
    this.#heightM = height;
    const halfFov = ((CAM_FOV / 2) * Math.PI) / 180;
    const wanted = (height / 2 + CAM_MARGIN_M) / Math.tan(halfFov);
    this.#distance = Math.max(CAM_DISTANCE_MIN_M, Math.min(CAM_DISTANCE_MAX_M, wanted));
    this.#placeCamera();
  }

  /** Match the drawing buffer to the CSS box (a resize is a no-op when it already matches). */
  resize(): void {
    if (this.#disposed) return;
    const w = Math.max(64, this.#canvas.clientWidth || this.#canvas.width || 360);
    const h = Math.max(64, this.#canvas.clientHeight || this.#canvas.height || 440);
    const dpr = this.#renderer.getPixelRatio();
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (this.#canvas.width !== bw || this.#canvas.height !== bh) this.#renderer.setSize(w, h, false);
    this.#camera.aspect = w / h;
    this.#camera.updateProjectionMatrix();
  }

  /** Rebuild the rig for `profile`. A re-roll of the same name+race DOES rebuild (the seed drives it). */
  setProfile(profile: CharacterProfile): void {
    if (this.#disposed) return;
    const key = previewKey(profile);
    if (key === this.#built) return;
    this.#built = key;
    this.#clearRig();
    const { rig, fighter } = buildPreviewRig(profile);
    this.#fighter = fighter;
    this.#rig = rig;
    this.#root.add(rig.group);
    this.#clock = 0;
    // Wave P: the camera frames THIS character (its own measured height), and the turntable is gone —
    // the user turns the figure, so a rebuild must not silently start spinning it again.
    this.#fitCameraToRig();
    this.#render(0);
  }

  #clearRig(): void {
    if (!this.#rig) return;
    this.#root.remove(this.#rig.group);
    // Three.js does not dispose a rig's geometries/materials; the Creator can re-roll
    // many times in one session, so the shared caches (body mesh, skin) are left to
    // their own reuse and only the per-rig group is dropped.
    this.#rig = null;
  }

  /** Advance the turntable and the idle clock, then draw. `dt` is in seconds. */
  render(dt: number): void {
    this.#render(dt);
  }

  #render(dt: number): void {
    if (this.#disposed) return;
    const step = Math.min(0.1, Math.max(0, dt));
    this.#clock += step;
    if (this.#rig) {
      // The rig's own rest pose advanced in time: the skeleton's update() is where the
      // breathe/blink time lives, so a still frame would show a frozen statue.
      this.#fighter.skeleton.update(step * PREVIEW_IDLE_HZ);
      this.#rig.update(this.#fighter.skeleton, step);
    }
    this.#renderer.render(this.#scene, this.#camera);
  }

  /** Wave P evidence: the framing the camera chose for the current character. */
  framing(): { heightM: number; distanceM: number; yaw: number; pitch: number } {
    return { heightM: Math.round(this.#heightM * 1000) / 1000, distanceM: Math.round(this.#distance * 1000) / 1000, yaw: Math.round(this.#yaw * 1000) / 1000, pitch: Math.round(this.#pitch * 1000) / 1000 };
  }

  /** Triangle count of the current rig, for the wave's evidence (0 when nothing is built). */
  get triangleCount(): number {
    return this.#rig?.triangleCount ?? 0;
  }

  /** The name the current rig was built for (QA: proves the preview followed the roll). */
  get builtKey(): string {
    return this.#built;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#clearRig();
    this.#renderer.dispose();
  }
}
