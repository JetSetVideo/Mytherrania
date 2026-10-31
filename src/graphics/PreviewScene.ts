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

/** Camera framing of a standing fighter: 3/4 front-left, whole body, slight down-tilt. */
const CAM_DISTANCE = 2.35;
const CAM_HEIGHT = 1.28;
const CAM_YAW = 0.55;
const CAM_TARGET_Y = 0.95;
const CAM_FOV = 38;

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
  #spin = 0;
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
      new THREE.MeshBasicMaterial({ color: "#172128", transparent: true, opacity: 0.55 }),
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

  #placeCamera(): void {
    const x = Math.sin(CAM_YAW) * CAM_DISTANCE;
    const z = Math.cos(CAM_YAW) * CAM_DISTANCE;
    this.#camera.position.set(x, CAM_HEIGHT, z);
    this.#camera.lookAt(0, CAM_TARGET_Y, 0);
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
    this.#spin = 0;
    this.#clock = 0;
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
    this.#spin += step * PREVIEW_SPIN_RAD_S;
    this.#clock += step;
    if (this.#rig) {
      this.#root.rotation.y = this.#spin;
      // The rig's own rest pose advanced in time: the skeleton's update() is where the
      // breathe/blink time lives, so a still frame would show a frozen statue.
      this.#fighter.skeleton.update(step * PREVIEW_IDLE_HZ);
      this.#rig.update(this.#fighter.skeleton, step);
    }
    this.#renderer.render(this.#scene, this.#camera);
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
