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
import { CEL_LIGHT_GLSL, celLighting, celUniforms, createCelSurface, SPECULAR_METAL } from "./shaders/CelShader.ts";
import { BODY_DETAIL_GAIN } from "./shaders/CelSkinned.ts";

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
 * Wave X lane B — the PEDESTAL and the framing law. Every fighter stands on the SAME stone base (one
 * radius for every race) and the camera's distance derives from that radius and the field of view, NOT
 * from the model's height, so a 1.35 m dwarf and a 2.2 m ork stand on the same base at the same framing
 * (the dwarf reads small, the ork large: their real relative size).
 *
 *   frameTop    = PEDESTAL_FRAME_PER_RADIUS · R          (the tallest standing fighter + raised blade)
 *   frameBottom = −(PEDESTAL_HEIGHT + PEDESTAL_FOOT_MARGIN_PER_RADIUS · R)
 *   targetY     = (frameTop + frameBottom) / 2
 *   distance    = max( (frameTop − frameBottom)/2 / tan(fovY/2),          the vertical law
 *                      PEDESTAL_SIDE_PER_RADIUS · R / (tan(fovY/2) · aspect) )  the base's width fits a narrow canvas
 *
 * The ONE exception (clip rule): a model whose measured bounding-box top is above frameTop would be cut
 * off, so for it — and only for it — frameTop becomes its own top and the distance grows by the same law.
 * Every default roll of the four races fits under frameTop (measured by tools/probe-wave-x-body.ts), so
 * the distance is equal across races; a tweaked giant is framed by height rather than cropped.
 */
export const PEDESTAL_RADIUS = 0.6;
/** Plinth height (m): the model's soles stand on its top face at y = 0. */
export const PEDESTAL_HEIGHT = 0.12;
export const PEDESTAL_FRAME_PER_RADIUS = 4.2;
export const PEDESTAL_FOOT_MARGIN_PER_RADIUS = 0.15;
export const PEDESTAL_SIDE_PER_RADIUS = 1.2;
const CAM_FOV = 38;
const CAM_YAW = 0.55;
/** Pitch clamp, radians: never below the horizon floor, never straight down. */
const CAM_PITCH_MIN = -0.45;
const CAM_PITCH_MAX = 1.15;

/** The viewer's framing for a model of measured height `modelTopM` on a canvas of `aspect` (w/h). Pure. */
export function previewFraming(modelTopM: number, aspect = 360 / 440, fovDeg = CAM_FOV, R = PEDESTAL_RADIUS): { distance: number; targetY: number; clipped: boolean } {
  const t = Math.tan(((fovDeg / 2) * Math.PI) / 180);
  const top0 = PEDESTAL_FRAME_PER_RADIUS * R;
  const clipped = modelTopM > top0;
  const top = clipped ? modelTopM : top0;
  const bottom = -(PEDESTAL_HEIGHT + PEDESTAL_FOOT_MARGIN_PER_RADIUS * R);
  const vertical = (top - bottom) / 2 / t;
  const side = (PEDESTAL_SIDE_PER_RADIUS * R) / (t * Math.max(0.2, aspect));
  return { distance: Math.max(vertical, side), targetY: (top + bottom) / 2, clipped };
}

/**
 * Wave X lane B — the viewer's light: the KEY from straight above (a little in front, so the face is
 * not a black mask), a LOW fill. Written into the shared cel uniforms only for the preview's own draw
 * and restored right after (the arena's sun owns them the rest of the frame).
 */
export const PREVIEW_KEY_DIR: [number, number, number] = [0.05, 1, 0.2];
export const PREVIEW_KEY_COLOUR: [number, number, number] = [1.3, 1.22, 1.08];
export const PREVIEW_FILL: [number, number, number] = [0.24, 0.23, 0.22];
/** Contact shadow painted on the pedestal under the feet: darkening at the centre and its gaussian radius (m). */
export const CONTACT_SHADOW = { strength: 0.7, sigma: 0.3 } as const;
/** Shadow-map edge (px) and the light camera's half extent (m) — covers the base and the tallest model. */
const SHADOW_SIZE = 1024;
const SHADOW_HALF = 1.5;

/** Scene lights for the non-cel materials (the cel bodies read the uniforms above). */
function addLights(scene: THREE.Scene): void {
  const ambient = new THREE.AmbientLight("#e8dcc8", 0.35);
  const key = new THREE.DirectionalLight("#fff3cf", 1.4);
  key.position.set(...PREVIEW_KEY_DIR);
  scene.add(ambient, key);
}

/**
 * The pedestal's top-face stone, RGBA8 (n x n, row 0 = top): a worn flagstone — a warm grey with
 * hewn-block mottling, two chiselled rings and a fine grain. Pure and deterministic (a hashed lattice, no random draw),
 * so a test can pin it. Values stay mid-dark: the base must never out-shine the fighter.
 */
export function pedestalStonePixels(n = 128): Uint8Array {
  const out = new Uint8Array(n * n * 4);
  const hash = (x: number, y: number) => { let h = (x * 374761393 + y * 668265263) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const vnoise = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n * 2 - 1, v = (j + 0.5) / n * 2 - 1, r = Math.hypot(u, v);
      const block = vnoise(u * 3 + 11, v * 3 + 7), grain = vnoise(u * 40, v * 40), fine = hash(i, j);
      let k = 0.34 + 0.12 * block + 0.08 * grain + 0.04 * fine;
      // Chiselled rings (a dark groove with a pale lip) at 0.62 and 0.9 of the radius.
      for (const ring of [0.62, 0.9]) { const d = (r - ring) / 0.018; k *= 1 - 0.38 * Math.exp(-d * d); k += 0.05 * Math.exp(-((d + 1.6) ** 2)); }
      const o = (j * n + i) * 4;
      out[o] = Math.round(255 * Math.min(1, k * 1.04)); out[o + 1] = Math.round(255 * Math.min(1, k * 0.98)); out[o + 2] = Math.round(255 * Math.min(1, k * 0.9)); out[o + 3] = 255;
    }
  }
  return out;
}

/** The stone's cel material: the shared lighting (key, fill, the received shadow) x the stone texture x the contact blob. */
function stoneMaterial(tex: THREE.Texture, tint: THREE.ColorRepresentation, top: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: celUniforms({
      baseColor: { value: new THREE.Color(tint) }, uSpecular: { value: 0 }, uStone: { value: tex },
      uContact: { value: new THREE.Vector2(top ? CONTACT_SHADOW.strength : 0, CONTACT_SHADOW.sigma) },
    }),
    vertexShader: /* glsl */ `
      uniform vec3 lightDirection;
      varying vec3 viewNormal; varying vec3 viewLight; varying vec3 viewPos; varying vec3 vWorld; varying vec3 vWorldN; varying vec2 vUv;
      void main() {
        vUv = uv;
        viewNormal = normalize(normalMatrix * normal);
        viewLight = normalize((viewMatrix * vec4(lightDirection, 0.0)).xyz);
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz; vWorldN = normalize(mat3(modelMatrix) * normal);
        vec4 mv = viewMatrix * world; viewPos = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      #include <packing>
      uniform vec3 baseColor; uniform float uSpecular; uniform sampler2D uStone; uniform vec2 uContact;
      ${CEL_LIGHT_GLSL}
      varying vec3 viewNormal; varying vec3 viewLight; varying vec3 viewPos; varying vec3 vWorld; varying vec3 vWorldN; varying vec2 vUv;
      void main() {
        vec3 stone = texture2D(uStone, vUv).rgb;
        vec3 c = celShade(baseColor * stone, normalize(viewNormal), normalize(viewLight), viewPos, vWorld, vWorldN, uSpecular);
        float r = length(vWorld.xz) / max(1e-3, uContact.y);
        c *= 1.0 - uContact.x * exp(-r * r);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** The pedestal: a stone plinth (top at y = 0) on a wider footing, with a forged-iron band round its lip. */
export function buildPedestal(R = PEDESTAL_RADIUS): THREE.Group {
  const g = new THREE.Group();
  g.name = "preview-pedestal";
  const n = 128, tex = new THREE.DataTexture(pedestalStonePixels(n), n, n, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  const topH = PEDESTAL_HEIGHT * 0.6, footH = PEDESTAL_HEIGHT - topH;
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.02, topH, 64, 1, false), stoneMaterial(tex, "#d9cfc0", false));
  plinth.position.y = -topH / 2;
  // The top face: a disc whose uv spans the stone texture (the cylinder's cap uv does too, but a
  // separate disc lets the contact shadow live on the walking surface only).
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 96), stoneMaterial(tex, "#e6dccb", true));
  disc.name = "pedestal-top";
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.0005;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.1, R * 1.14, footH, 64), stoneMaterial(tex, "#a79d8f", false));
  foot.position.y = -topH - footH / 2;
  const band = createCelSurface(new THREE.TorusGeometry(R * 1.005, 0.016, 8, 96), "#4a4642", SPECULAR_METAL);
  band.name = "pedestal-iron-band";
  band.rotation.x = Math.PI / 2;
  band.position.y = -0.012;
  const footBand = createCelSurface(new THREE.TorusGeometry(R * 1.105, 0.012, 8, 96), "#3a3633", SPECULAR_METAL);
  footBand.rotation.x = Math.PI / 2;
  footBand.position.y = -topH - 0.006;
  g.add(plinth, foot, disc, band, footBand);
  for (const m of [plinth, foot, disc]) m.userData.pedestalStone = true;
  return g;
}

/**
 * The build key of a profile: everything `buildPreviewRig` reads (or `setProfile` skips a rebuild
 * on). Extracted so the live turntable AND the offscreen studio cache on the exact same string —
 * a thumbnail may not drift from the figure it thumbnails. Lengths are quantised to 4 dp (a
 * hundredth of a millimetre), the resolution the rig actually renders at.
 */
export function previewKey(profile: CharacterProfile): string {
  // Wave X lane B: the sex (and the age) change the built body, so they are part of the key — a sex
  // toggle in the Creator now rebuilds the model at once instead of keeping the previous body.
  const a = profile.appearance;
  return `${profile.name}|${profile.race}|${profile.subrace ?? ""}|${profile.className}|${profile.weaponType ?? ""}|${a.height.toFixed(4)}|${a.weight.toFixed(4)}|${a.hair ?? ""}|${profile.birthsign ?? ""}|${a.sex ?? ""}|${a.age ?? ""}|${a.silhouette ? JSON.stringify(a.silhouette) : ""}|${a.eyes ?? ""}|${a.beard ? 1 : 0}${a.moustache ? 1 : 0}`;
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
    // Wave X: a hand-tweaked (or rolled) silhouette wins over the name-seeded one, as in the arena.
    silhouette: profile.appearance.silhouette ?? randomSilhouette(seededRng(seed ^ 0x2545f491), profile.race, profile.subrace),
  };
  const weaponGen = fighter.weaponSpec ? toGeneratedWeapon(fighter.weaponSpec) : generateClassWeapon(fighter.className);
  const rig = buildSkinnedHumanoid(weaponGen, app, skills[0].element, {
    race: profile.race, subrace: profile.subrace, className: fighter.className,
    height: app.height, weight: app.weight, seed, birthsign: profile.birthsign,
    // Wave X lane B: the sex rides onto the body spec (it was dropped here, so the Creator always showed
    // the neutral male body whatever the sex control said).
    sex: app.sex ?? null,
    // Wave X: the Creator's explicit (rolled/tweaked) silhouette shapes the rendered body.
    silhouette: profile.appearance.silhouette ?? null,
  }, { garment: profile.appearance.body, weaponSpec: fighter.weaponSpec });
  return { rig, fighter };
}

export class PreviewScene {
  #canvas: HTMLCanvasElement;
  #renderer: THREE.WebGLRenderer;
  #scene: THREE.Scene;
  #camera: THREE.PerspectiveCamera;
  #root: THREE.Group;
  #pedestal: THREE.Group;
  #rig: (HumanoidRig & SkinnedExtras) | null = null;
  #fighter = createFighter("Warrior", "Preview", 0, 0, 0.5, "human", null);
  #profile: CharacterProfile | null = null;
  /** Manual orbit (wave P): the user turns the figure; it never rotates by itself. */
  #yaw = CAM_YAW;
  #pitch = 0.18;
  /** The framing distance and look-at height (wave X: from PEDESTAL_RADIUS, see previewFraming). */
  #distance = previewFraming(0).distance;
  #targetY = previewFraming(0).targetY;
  #clipped = false;
  /** QA switches (wave X): the cast shadow map and the painted contact blob, for an on/off measurement. */
  #cast = true;
  #contact = true;
  /** The character's measured height, metres — public evidence for the framing claim. */
  #heightM = 1.8;
  #clock = 0;
  #disposed = false;
  /** The name+race the current rig was built for, so `setProfile` can skip a rebuild. */
  #built = "";
  // The preview's own key-light shadow (wave X): a depth pass from straight above into an RGBA-packed map.
  #shadowTarget: THREE.WebGLRenderTarget;
  #shadowCam: THREE.OrthographicCamera;
  #shadowMatrix = new THREE.Matrix4();
  // Back faces only, with a slope-scaled offset: a surface never compares against its own depth (no acne
  // bands where the overhead key grazes the vertical trunk), while the body still shades the base.
  #depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.BackSide, polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2 });
  #light = { dir: new THREE.Vector3(...PREVIEW_KEY_DIR).normalize(), colour: new THREE.Color(...PREVIEW_KEY_COLOUR), fill: new THREE.Color(...PREVIEW_FILL), sky: new THREE.Color(1.05, 1.0, 0.94), ground: new THREE.Color(0.75, 0.66, 0.56) };

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    this.#renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.#renderer.setClearColor(0x000000, 0);
    this.#renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio ?? 1));
    this.#scene = new THREE.Scene();
    addLights(this.#scene);
    // Wave X lane B: the pedestal (one radius for every race) replaces the old dark disc.
    this.#pedestal = buildPedestal();
    this.#scene.add(this.#pedestal);
    this.#root = new THREE.Group();
    this.#scene.add(this.#root);
    this.#camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 20);
    this.#shadowTarget = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, { depthBuffer: true });
    this.#shadowCam = new THREE.OrthographicCamera(-SHADOW_HALF, SHADOW_HALF, SHADOW_HALF, -SHADOW_HALF, 0.1, 12);
    const d = this.#light.dir;
    this.#shadowCam.position.set(d.x * 6, 1 + d.y * 6, d.z * 6);
    this.#shadowCam.lookAt(0, 1, 0);
    this.#shadowCam.updateMatrixWorld(true);
    this.#shadowCam.updateProjectionMatrix();
    this.#shadowMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(this.#shadowCam.projectionMatrix).multiply(this.#shadowCam.matrixWorldInverse);
    this.#placeCamera();
    this.resize();
    // QA hook (not game behaviour): tools/probe-wave-x-body.ts drives the live preview through it.
    (globalThis as unknown as { __MYTHERRANIA_PREVIEW__?: PreviewScene }).__MYTHERRANIA_PREVIEW__ = this;
  }

  /** Place the camera from the CURRENT yaw/pitch/distance (called on a rebuild and on every drag). */
  #placeCamera(): void {
    const horiz = Math.cos(this.#pitch) * this.#distance;
    const y = this.#targetY + Math.sin(this.#pitch) * this.#distance;
    this.#camera.position.set(Math.sin(this.#yaw) * horiz, Math.max(0.25, y), Math.cos(this.#yaw) * horiz);
    this.#camera.lookAt(0, this.#targetY, 0);
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

  /** Wave X: frame by the PEDESTAL (previewFraming); the model's height only matters if it would clip. */
  #fitCamera(): void {
    if (this.#rig) {
      const box = new THREE.Box3().setFromObject(this.#rig.group);
      this.#heightM = Math.max(0.5, box.max.y - Math.min(0, box.min.y));
    }
    const f = previewFraming(this.#rig ? this.#heightM : 0, this.#camera.aspect);
    this.#distance = f.distance;
    this.#targetY = f.targetY;
    this.#clipped = f.clipped;
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
    if (this.#camera.aspect !== w / h) {
      this.#camera.aspect = w / h;
      this.#camera.updateProjectionMatrix();
      this.#fitCamera(); // a narrow canvas may need the base's width rule
    }
  }

  /** Rebuild the rig for `profile`. A re-roll of the same name+race DOES rebuild (the seed drives it). */
  setProfile(profile: CharacterProfile): void {
    if (this.#disposed) return;
    this.#profile = profile;
    const key = previewKey(profile);
    if (key === this.#built) return;
    this.#built = key;
    this.#clearRig();
    const { rig, fighter } = buildPreviewRig(profile);
    this.#fighter = fighter;
    this.#rig = rig;
    this.#root.add(rig.group);
    this.#clock = 0;
    // Wave X: the camera frames the PEDESTAL, so every race stands at the same framing (see previewFraming).
    this.#fitCamera();
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
    // Wave X: the preview's own lighting in the SHARED cel uniforms, for this draw only.
    const L = celLighting;
    const saved = {
      dir: L.lightDirection.value, col: L.lightColor.value, amb: L.ambientColor.value, sky: L.uSkyTint.value, gnd: L.uGroundTint.value,
      map: L.uShadowMap.value, mat: L.uShadowMatrix.value, on: L.uShadowOn.value, texel: L.uShadowTexel.value,
    };
    try {
      L.lightDirection.value = this.#light.dir; L.lightColor.value = this.#light.colour; L.ambientColor.value = this.#light.fill;
      L.uSkyTint.value = this.#light.sky; L.uGroundTint.value = this.#light.ground;
      // The depth pass from the key light (everything but the base itself casts).
      L.uShadowOn.value = 0;
      this.#pedestal.traverse((o) => {
        const u = ((o as THREE.Mesh).material as THREE.ShaderMaterial | undefined)?.uniforms?.uContact;
        if (u) u.value.x = this.#contact && o.name === "pedestal-top" ? CONTACT_SHADOW.strength : 0;
      });
      this.#pedestal.visible = false;
      this.#scene.overrideMaterial = this.#depthMat;
      const prevClear = this.#renderer.getClearAlpha(), prevColour = new THREE.Color();
      this.#renderer.getClearColor(prevColour);
      this.#renderer.setRenderTarget(this.#shadowTarget);
      this.#renderer.setClearColor(0xffffff, 1);
      this.#renderer.clear();
      if (this.#cast) this.#renderer.render(this.#scene, this.#shadowCam);
      this.#renderer.setRenderTarget(null);
      this.#renderer.setClearColor(prevColour, prevClear);
      this.#scene.overrideMaterial = null;
      this.#pedestal.visible = true;
      L.uShadowMap.value = this.#shadowTarget.texture; L.uShadowMatrix.value = this.#shadowMatrix; L.uShadowOn.value = this.#cast ? 1 : 0; L.uShadowTexel.value = 1 / SHADOW_SIZE;
      this.#renderer.render(this.#scene, this.#camera);
    } finally {
      this.#scene.overrideMaterial = null;
      this.#pedestal.visible = true;
      L.lightDirection.value = saved.dir; L.lightColor.value = saved.col; L.ambientColor.value = saved.amb; L.uSkyTint.value = saved.sky; L.uGroundTint.value = saved.gnd;
      L.uShadowMap.value = saved.map; L.uShadowMatrix.value = saved.mat; L.uShadowOn.value = saved.on; L.uShadowTexel.value = saved.texel;
    }
  }

  /** Wave P/X evidence: the framing the camera chose (distance from the pedestal radius; `clipped` = the height rule fired). */
  framing(): { heightM: number; distanceM: number; yaw: number; pitch: number; targetY: number; pedestalRadiusM: number; clipped: boolean } {
    const r = (v: number) => Math.round(v * 1000) / 1000;
    return { heightM: r(this.#heightM), distanceM: r(this.#distance), yaw: r(this.#yaw), pitch: r(this.#pitch), targetY: r(this.#targetY), pedestalRadiusM: PEDESTAL_RADIUS, clipped: this.#clipped };
  }

  /** QA (wave X): the pedestal as built — its measured radius (from the geometry) and height. */
  pedestal(): { radiusM: number; heightM: number; topY: number } {
    const top = this.#pedestal.getObjectByName("pedestal-top") as THREE.Mesh | undefined;
    top?.geometry.computeBoundingSphere();
    return { radiusM: Math.round((top?.geometry.boundingSphere?.radius ?? 0) * 1000) / 1000, heightM: PEDESTAL_HEIGHT, topY: 0 };
  }

  /**
   * QA (wave X): screen points (css px) on the pedestal top that the camera actually SEES (a ray from the
   * camera hits the top disc first, not a leg or a foot): a ring beside the feet (r 0.16-0.32 m) and the
   * rim (r 0.5 m) — the probe reads the canvas there to prove the contact shadow.
   */
  debugShadowProbe(): { near: [number, number][]; rim: [number, number][]; shadowMap: boolean; shadowCoverage: number } {
    this.#scene.updateMatrixWorld(true);
    const top = this.#pedestal.getObjectByName("pedestal-top")!;
    const ray = new THREE.Raycaster();
    const seen = (x: number, z: number): [number, number] | null => {
      const p = new THREE.Vector3(x, 0.0005, z);
      const dir = p.clone().sub(this.#camera.position).normalize();
      ray.set(this.#camera.position, dir);
      const hit = ray.intersectObjects([this.#root, top], true)[0];
      if (!hit || hit.object !== top || hit.point.distanceTo(p) > 0.01) return null;
      const v = p.clone().project(this.#camera);
      return [(v.x * 0.5 + 0.5) * this.#canvas.clientWidth, (-v.y * 0.5 + 0.5) * this.#canvas.clientHeight];
    };
    const ring = (radii: number[]) => {
      const out: [number, number][] = [];
      for (const r of radii) for (let k = 0; k < 32; k++) { const a = (k / 32) * Math.PI * 2, q = seen(r * Math.cos(a), r * Math.sin(a)); if (q) out.push(q); }
      return out;
    };
    // The shadow map's coverage: the share of its texels nearer than the far plane (something cast there).
    const buf = new Uint8Array(SHADOW_SIZE * SHADOW_SIZE * 4);
    this.#renderer.readRenderTargetPixels(this.#shadowTarget, 0, 0, SHADOW_SIZE, SHADOW_SIZE, buf);
    let covered = 0;
    for (let i = 0; i < buf.length; i += 4) if (buf[i] < 250 || buf[i + 1] < 250 || buf[i + 2] < 250) covered++;
    return { near: ring([0.16, 0.2, 0.24, 0.28, 0.32]), rim: ring([0.5]), shadowMap: covered > 0, shadowCoverage: Math.round((covered / (SHADOW_SIZE * SHADOW_SIZE)) * 10000) / 10000 } as ReturnType<PreviewScene["debugShadowProbe"]>;
  }

  /** QA (wave X): switch the cast shadow / the contact blob off and on (measurement only). */
  debugLighting(o: { cast?: boolean; contact?: boolean }): void {
    if (o.cast !== undefined) this.#cast = o.cast;
    if (o.contact !== undefined) this.#contact = o.contact;
    this.#render(0);
  }

  /** QA (wave X): the sub-grid surface detail on/off on the current rig (before/after shots of item 6). */
  debugDetail(on: boolean): void {
    const mat = (this.#rig?.skin as THREE.Mesh | undefined)?.material as THREE.ShaderMaterial | undefined;
    const g = mat?.uniforms?.uDetailGain;
    if (g) g.value.set(on ? BODY_DETAIL_GAIN.abs : 0, on ? BODY_DETAIL_GAIN.skin : 0, on ? BODY_DETAIL_GAIN.cloth : 0, on ? BODY_DETAIL_GAIN.albedo : 0);
    this.#render(0);
  }

  /**
   * QA (wave X): mean wall time (ms) of `frames` full preview draws (shadow pass + main pass), each
   * followed by a 1-pixel read-back so the GPU work is inside the measurement.
   */
  debugRenderMs(frames = 30): number {
    const px = new Uint8Array(4), gl = this.#renderer.getContext();
    this.#render(0);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) { this.#render(1 / 60); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    return Math.round(((performance.now() - t0) / frames) * 1000) / 1000;
  }

  /** QA (wave X): a close-up for detail shots — distance and look-at height override until the next rebuild. */
  debugCamera(distance: number, targetY: number): void {
    this.#distance = distance;
    this.#targetY = targetY;
    this.#placeCamera();
    this.#render(0);
  }

  /** The profile last shown (QA hook: a probe re-shows it with another race/sex). */
  get profile(): CharacterProfile | null {
    return this.#profile;
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
    this.#shadowTarget.dispose();
    this.#depthMat.dispose();
    this.#renderer.dispose();
    const g = globalThis as unknown as { __MYTHERRANIA_PREVIEW__?: PreviewScene };
    if (g.__MYTHERRANIA_PREVIEW__ === this) delete g.__MYTHERRANIA_PREVIEW__;
  }
}
