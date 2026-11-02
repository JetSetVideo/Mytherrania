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
import { CEL_BAND_EDGES, CEL_BAND_WEIGHTS, CEL_LIGHT_GLSL, celLighting, celUniforms, createCelSurface } from "./shaders/CelShader.ts";
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

/**
 * The viewer's framing for a model of measured height `modelTopM` on a canvas of `aspect` (w/h). Pure.
 * Wave Z: `footReserve` (0..0.4, default 0 = the wave-X framing exactly) is the share of the canvas height a caller's
 * DOM overlay covers at the BOTTOM (lane F floats the name/tags band over the + New plate): the frame grows downward so
 * the plinth and its shadow sit above that band. Still a function of R, the fov and the layout — never of the model —
 * so every race keeps one distance.
 */
export function previewFraming(modelTopM: number, aspect = 360 / 440, fovDeg = CAM_FOV, R = PEDESTAL_RADIUS, footReserve = 0): { distance: number; targetY: number; clipped: boolean } {
  const t = Math.tan(((fovDeg / 2) * Math.PI) / 180);
  const top0 = PEDESTAL_FRAME_PER_RADIUS * R;
  const clipped = modelTopM > top0;
  const top = clipped ? modelTopM : top0;
  const reserve = Math.max(0, Math.min(0.4, Number.isFinite(footReserve) ? footReserve : 0));
  const bottom0 = -(PEDESTAL_HEIGHT + PEDESTAL_FOOT_MARGIN_PER_RADIUS * R);
  const bottom = top - (top - bottom0) / (1 - reserve);
  const vertical = (top - bottom) / 2 / t;
  const side = (PEDESTAL_SIDE_PER_RADIUS * R) / (t * Math.max(0.2, aspect));
  return { distance: Math.max(vertical, side), targetY: (top + bottom) / 2, clipped };
}

/**
 * Wave X lane B — the viewer's light: the KEY from straight above (a little in front, so the face is
 * not a black mask), a LOW fill. Written into the shared cel uniforms only for the preview's own draw
 * and restored right after (the arena's sun owns them the rest of the frame).
 *
 * Wave Z lane G: the key is MORE vertical (elevation 80.8 deg, was 76.3) and a soft warm FACE FILL rides with
 * the camera (12 deg above the horizon, from the viewer's side, unbanded — CelShader `uFillDir/uFillColor`), so a
 * face in the overhead key's shade band still reads; the stone has a separate soft (PCSS-style) shadow lookup.
 */
export const PREVIEW_KEY_DIR: [number, number, number] = [0.03, 1, 0.16];
export const PREVIEW_KEY_COLOUR: [number, number, number] = [1.3, 1.22, 1.08];
export const PREVIEW_FILL: [number, number, number] = [0.24, 0.23, 0.22];
/** Wave Z: the camera-side face fill — elevation above the horizon (deg) and its warm colour (linear). */
export const PREVIEW_FACE_FILL = { elevationDeg: 12, colour: [0.44, 0.35, 0.25] as [number, number, number] } as const;
/** Contact shadow painted on the pedestal under the feet: darkening at the centre and its gaussian radius (m). */
export const CONTACT_SHADOW = { strength: 0.7, sigma: 0.3 } as const;
/** Shadow-map edge (px) and the light camera's half extent (m) — covers the base and the tallest model. */
export const SHADOW_SIZE = 1024;
export const SHADOW_HALF = 1.5;
/** The shadow camera's near/far planes (m) and its distance from the look-at point along the key. */
export const SHADOW_NEAR = 0.1;
export const SHADOW_FAR = 12;
const SHADOW_BACKOFF = 6;
/** Wave Z: penumbra growth of the stone's soft shadow, metres of blur per metre between blocker and stone (~2.6 deg sun). */
export const SHADOW_PENUMBRA_PER_M = 0.045;
/** Wave Z: the stone floor around the plinth — its radius, and where it fades into the backdrop (m). */
export const FLOOR_RADIUS = 3.4;
export const FLOOR_FADE: [number, number] = [1.5, 3.3];
/** Wave Z: the floor's brightness at its fade edge (x the lit stone): the viewer's, and the portrait's darker one (its
 * bottom 30 % carries the hero card's floating name and tags). */
export const FLOOR_FAR_DIM = 0.45;
export const PORTRAIT_FLOOR_FAR_DIM = 0.22;
/** Wave Z: the worn, rounded top edge of the plinth (m) and the flagstone texture's world period (m). */
export const PLINTH_BEVEL = 0.022;
export const FLOOR_TILE_M = 1.6;
/** Wave Z: the plinth's iron bands — a dull forged iron (SPECULAR_METAL x ~0.2). */
export const IRON_SPECULAR = 0.18;
const WALL_TILE_M = 0.5;

/** The key light as a unit vector (world). Pure. */
export function previewLightVector(): [number, number, number] {
  const [x, y, z] = PREVIEW_KEY_DIR, n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
}

/** The face fill's world direction for a camera at (camX, camZ): from the viewer's side, `elevationDeg` up. Pure. */
export function faceFillDir(camX: number, camZ: number): [number, number, number] {
  const e = (PREVIEW_FACE_FILL.elevationDeg * Math.PI) / 180, h = Math.hypot(camX, camZ) || 1;
  return [(camX / h) * Math.cos(e), Math.sin(e), (camZ / h) * Math.cos(e)];
}

/**
 * The key light's orthographic shadow camera: placed SHADOW_BACKOFF m back along the key from (0, 1, 0), looking
 * at it, half extent SHADOW_HALF. Pure numbers (a test builds the camera and checks the pedestal and the tallest
 * framed model project inside the map).
 */
export function shadowFrame(dir: readonly number[] = previewLightVector()): { position: [number, number, number]; target: [number, number, number]; half: number; near: number; far: number } {
  return { position: [dir[0] * SHADOW_BACKOFF, 1 + dir[1] * SHADOW_BACKOFF, dir[2] * SHADOW_BACKOFF], target: [0, 1, 0], half: SHADOW_HALF, near: SHADOW_NEAR, far: SHADOW_FAR };
}

/** Scene lights for the non-cel materials (the cel bodies read the uniforms above). */
function addLights(scene: THREE.Scene): void {
  const ambient = new THREE.AmbientLight("#e8dcc8", 0.35);
  const key = new THREE.DirectionalLight("#fff3cf", 1.4);
  key.position.set(...PREVIEW_KEY_DIR);
  scene.add(ambient, key);
}

// --- procedural stone (pure, deterministic: a hashed lattice, no random draw) ------------------------------
const hash2 = (x: number, y: number) => { let h = (x * 374761393 + y * 668265263) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
/** Value noise; with `period` > 0 the lattice wraps (a tileable texture). */
function vnoise(x: number, y: number, period = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const w = (v: number) => (period > 0 ? ((v % period) + period) % period : v);
  const a = hash2(w(xi), w(yi)), b = hash2(w(xi + 1), w(yi)), c = hash2(w(xi), w(yi + 1)), d = hash2(w(xi + 1), w(yi + 1));
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const sstep = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/**
 * The pedestal's top-face stone, RGBA8 (n x n, row 0 = top): a worn flagstone — a warm grey with hewn-block
 * mottling, two chiselled rings, a fine grain, hairline cracks, a foot-polished centre and a chipped, paler rim.
 * Wave Z: the ALPHA channel is the surface HEIGHT (255 = proud stone, low = grooves, cracks, chips) — the stone
 * shader bumps the normal from it and darkens the hollows. Pure and deterministic, so a test can pin it. Colour
 * values stay mid-dark: the base must never out-shine the fighter.
 */
export function pedestalStonePixels(n = 256): Uint8Array {
  const out = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n * 2 - 1, v = (j + 0.5) / n * 2 - 1, r = Math.hypot(u, v);
      const block = vnoise(u * 3 + 11, v * 3 + 7), grain = vnoise(u * 40, v * 40), fine = hash2(i, j);
      let k = 0.34 + 0.12 * block + 0.08 * grain + 0.04 * fine;
      let h = 0.72 + 0.12 * vnoise(u * 9 + 3, v * 9 + 1) + 0.06 * grain;
      // Chiselled rings (a dark groove with a pale lip) at 0.62 and 0.9 of the radius.
      for (const ring of [0.62, 0.9]) { const d = (r - ring) / 0.018; const g = Math.exp(-d * d); k *= 1 - 0.38 * g; k += 0.05 * Math.exp(-((d + 1.6) ** 2)); h -= 0.45 * g; }
      // Hairline cracks: the zero set of a noise field, only where a second, slower field allows one.
      const cr = 1 - Math.abs(vnoise(u * 4.5 + 5, v * 4.5 + 9) * 2 - 1), crack = sstep(0.955, 0.995, cr) * sstep(0.45, 0.6, vnoise(u * 1.7 + 2, v * 1.7 + 4));
      k *= 1 - 0.35 * crack; h -= 0.5 * crack;
      // Foot-polished centre (slightly paler, smoother) and a worn, chipped rim (paler fresh stone, lower).
      const polish = 1 - sstep(0.2, 0.55, r);
      k += 0.025 * polish; h += 0.04 * polish;
      const chip = sstep(0.93, 0.99, r) * sstep(0.35, 0.75, vnoise(Math.atan2(v, u) * 7 + 13, r * 4));
      k += 0.05 * chip; h -= 0.35 * chip;
      const o = (j * n + i) * 4;
      out[o] = Math.round(255 * Math.min(1, k * 1.04)); out[o + 1] = Math.round(255 * Math.min(1, k * 0.98)); out[o + 2] = Math.round(255 * Math.min(1, k * 0.9));
      out[o + 3] = Math.round(255 * Math.max(0, Math.min(1, h)));
    }
  }
  return out;
}

/**
 * Wave Z: the FLOOR's flagstones, RGBA8 (n x n, TILEABLE: the slab lattice and every noise wrap the texture's
 * period), one tile = FLOOR_TILE_M metres: irregular hewn slabs (a jittered 5 x 5 Voronoi — no grid reads through),
 * each slab its own grey-brown and its own slight tilt, a grain, scattered pits; the mortar between them sunk and
 * dark. Alpha = height, as on the plinth. Pure and deterministic.
 */
export function floorStonePixels(n = 256): Uint8Array {
  const out = new Uint8Array(n * n * 4), C = 5, P = 8;
  const wrap = (v: number) => ((v % C) + C) % C;
  const feat = (cx: number, cy: number): [number, number] => [cx + 0.12 + 0.76 * hash2(wrap(cx), wrap(cy) + 40), cy + 0.12 + 0.76 * hash2(wrap(cx) + 70, wrap(cy))];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const fx = (i + 0.5) / n, fy = (j + 0.5) / n, px = fx * C, py = fy * C, ix = Math.floor(px), iy = Math.floor(py);
      let d1 = 9, d2 = 9, best: [number, number] = [0, 0], bf: [number, number] = [0, 0];
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const f = feat(ix + ox, iy + oy), d = Math.hypot(px - f[0], py - f[1]);
        if (d < d1) { d2 = d1; d1 = d; best = [wrap(ix + ox), wrap(iy + oy)]; bf = f; } else if (d < d2) d2 = d;
      }
      const joint = (d2 - d1) / 2; // distance to the slab's edge, in cell units (~0.32 m)
      const id = hash2(best[0] + 3, best[1] + 5), tilt = hash2(best[0] + 11, best[1] + 13) * Math.PI * 2;
      const grain = vnoise(fx * P * 4, fy * P * 4, P * 4), mott = vnoise(fx * P, fy * P, P), fine = hash2(i, j + 7);
      let k = 0.27 + 0.11 * id + 0.07 * mott + 0.05 * grain + 0.03 * fine;
      let h = 0.68 + 0.12 * mott + 0.07 * grain + 0.09 * ((px - bf[0]) * Math.cos(tilt) + (py - bf[1]) * Math.sin(tilt));
      const edge = sstep(0.015, 0.07, joint); // 0 in the mortar, 1 on the slab; the lip between is a worn bevel
      h = h * (0.2 + 0.8 * edge); k *= 0.5 + 0.5 * edge;
      const pit = sstep(0.82, 0.9, vnoise(fx * P * 6 + 1, fy * P * 6 + 2, P * 6)); h -= 0.22 * pit; k *= 1 - 0.18 * pit;
      const warm = 0.04 * (hash2(best[0] + 9, best[1] + 1) - 0.5);
      const o = (j * n + i) * 4;
      out[o] = Math.round(255 * Math.min(1, k * (1.04 + warm))); out[o + 1] = Math.round(255 * Math.min(1, k * 0.97)); out[o + 2] = Math.round(255 * Math.min(1, k * (0.88 - warm)));
      out[o + 3] = Math.round(255 * Math.max(0, Math.min(1, h)));
    }
  }
  return out;
}

function stoneTexture(px: Uint8Array, n: number, repeat: boolean): THREE.DataTexture {
  const tex = new THREE.DataTexture(px, n, n, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** How a stone mesh maps its texture: the top disc by its uv, the floor by world x/z, walls around + up. */
type StoneMapping = "disc" | "floor" | "wall";
interface StoneOptions { mapping: StoneMapping; contact?: boolean; repeatU?: number; period?: number; fade?: [number, number]; footAO?: number; bump?: number }

/**
 * Wave Z: the stone's shader. Not celShade (whose shadow is a hard 3x3 pushed through the bands): the stone keeps
 * cel BANDS for the normal but takes the cast shadow SOFT — a PCSS-style lookup (12-tap blocker search, then a
 * 16-tap rotated spiral whose radius grows with the blocker's height above the stone, SHADOW_PENUMBRA_PER_M), so
 * the feet cast crisp contact and the head a wide soft edge. The height (texture alpha) bumps the normal (screen-
 * space derivatives) and, since a bump only moves band edges under cel bands, also modulates the albedo by the
 * lambert change and darkens the hollows (skill pitfall 27).
 */
function stoneMaterial(tex: THREE.Texture, tint: THREE.ColorRepresentation, o: StoneOptions): THREE.ShaderMaterial {
  const mode = o.mapping === "disc" ? 0 : o.mapping === "floor" ? 1 : 2;
  const mat = new THREE.ShaderMaterial({
    uniforms: celUniforms({
      baseColor: { value: new THREE.Color(tint) }, uSpecular: { value: 0 }, uStone: { value: tex },
      uContact: { value: new THREE.Vector2(o.contact ? CONTACT_SHADOW.strength : 0, CONTACT_SHADOW.sigma) },
      uMap: { value: new THREE.Vector3(mode, o.period ?? FLOOR_TILE_M, o.repeatU ?? 1) },
      uFade: { value: new THREE.Vector2(o.fade?.[0] ?? 0, o.fade?.[1] ?? 0) },
      uFootAO: { value: o.footAO ?? 0 },
      uFarDim: { value: FLOOR_FAR_DIM },
      uBump: { value: o.bump ?? 0.006 },
      uShadowGeom: { value: new THREE.Vector3(2 * SHADOW_HALF, SHADOW_FAR - SHADOW_NEAR, SHADOW_PENUMBRA_PER_M) },
    }),
    transparent: !!o.fade,
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
      uniform vec3 uMap; uniform vec2 uFade; uniform float uFootAO; uniform float uFarDim; uniform float uBump; uniform vec3 uShadowGeom;
      ${CEL_LIGHT_GLSL}
      varying vec3 viewNormal; varying vec3 viewLight; varying vec3 viewPos; varying vec3 vWorld; varying vec3 vWorldN; varying vec2 vUv;
      float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float stoneShadow(vec3 world) {
        if (uShadowOn < 0.5) return 1.0;
        vec4 sc = uShadowMatrix * vec4(world, 1.0);
        sc.xyz /= sc.w;
        if (sc.x < 0.0 || sc.y < 0.0 || sc.x > 1.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
        float zr = sc.z - 0.0006;
        float rot = hash12(gl_FragCoord.xy) * 6.2832;
        float search = 0.12 / uShadowGeom.x;
        float bsum = 0.0, bn = 0.0;
        for (int i = 0; i < 12; i++) {
          float fi = float(i), a = fi * 2.39996 + rot, rr = sqrt((fi + 0.5) / 12.0);
          float d = unpackRGBAToDepth(texture2D(uShadowMap, sc.xy + vec2(cos(a), sin(a)) * rr * search));
          if (d < zr) { bsum += d; bn += 1.0; }
        }
        if (bn < 0.5) return 1.0;
        float gapM = (zr - bsum / bn) * uShadowGeom.y;
        float pen = clamp(gapM * uShadowGeom.z + 0.003, 0.003, 0.06) / uShadowGeom.x;
        float lit = 0.0;
        for (int i = 0; i < 16; i++) {
          float fi = float(i), a = fi * 2.39996 + rot, rr = sqrt((fi + 0.5) / 16.0);
          lit += step(zr, unpackRGBAToDepth(texture2D(uShadowMap, sc.xy + vec2(cos(a), sin(a)) * rr * pen)));
        }
        return lit / 16.0;
      }
      vec3 bumpNormal(vec3 n, vec3 pos, float h, float k) {
        vec3 dpx = dFdx(pos), dpy = dFdy(pos);
        float dhx = dFdx(h) * k, dhy = dFdy(h) * k;
        vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
        float det = dot(dpx, r1);
        vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
        return normalize(abs(det) * n - grad);
      }
      void main() {
        vec3 wn = normalize(vWorldN);
        vec2 st = uMap.x < 0.5 ? vUv
          : (uMap.x < 1.5 || wn.y > 0.7) ? vWorld.xz / uMap.y
          : vec2(vUv.x * uMap.z, vWorld.y / uMap.y);
        vec4 stone = texture2D(uStone, st);
        vec3 n = normalize(viewNormal), l = normalize(viewLight);
        // Fade the bump where a pixel spans many texels (the far floor), or its derivatives shimmer.
        float lod = length(fwidth(st)) * 256.0;
        vec3 nb = bumpNormal(n, viewPos, stone.a, uBump / (1.0 + 0.3 * lod * lod));
        float ndl0 = max(dot(n, l), 0.0), ndl = max(dot(nb, l), 0.0);
        float w = max(fwidth(ndl) * 0.75, 0.004);
        float band = ${CEL_BAND_WEIGHTS[0].toFixed(2)} * smoothstep(${CEL_BAND_EDGES[0].toFixed(2)} - w, ${CEL_BAND_EDGES[0].toFixed(2)} + w, ndl)
                   + ${CEL_BAND_WEIGHTS[1].toFixed(2)} * smoothstep(${CEL_BAND_EDGES[1].toFixed(2)} - w, ${CEL_BAND_EDGES[1].toFixed(2)} + w, ndl);
        vec3 albedo = baseColor * stone.rgb * clamp(1.0 + 2.4 * (ndl - ndl0), 0.55, 1.45) * mix(0.62, 1.0, stone.a);
        float sh = stoneShadow(vWorld + wn * 0.004);
        float hemi = clamp(wn.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 amb = ambientColor * 1.15 * mix(uGroundTint, uSkyTint, hemi);
        // In the umbra the key is gone entirely (as celShade's bands do) and the low fill is half blocked by the legs.
        vec3 c = albedo * (amb + lightColor * band * sh + uFillColor * max(dot(wn, uFillDir), 0.0) * mix(0.45, 1.0, sh));
        float r = length(vWorld.xz);
        float cr = r / max(1e-3, uContact.y);
        c *= 1.0 - uContact.x * exp(-cr * cr);
        if (uFootAO > 0.0) { float d = max(0.0, r - uFootAO) / 0.09; c *= 1.0 - 0.5 * exp(-d * d); }
        float alpha = 1.0;
        if (uFade.y > 0.0) { alpha = 1.0 - smoothstep(uFade.x, uFade.y, r); c *= mix(1.0, uFarDim, smoothstep(0.8, uFade.y, r)); }
        gl_FragColor = vec4(c, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return mat;
}

/**
 * The pedestal: a stone plinth (top at y = 0) on a wider footing, with a forged-iron band round its lip.
 * Wave Z: the plinth's top edge is ROUNDED and worn (a lathe profile, PLINTH_BEVEL) with chips knocked out of
 * it, the walls and footing are coursed flagstone, and every stone face is bumped from its height texture.
 */
export function buildPedestal(R = PEDESTAL_RADIUS): THREE.Group {
  const g = new THREE.Group();
  g.name = "preview-pedestal";
  const n = 256, top = stoneTexture(pedestalStonePixels(n), n, false), flag = stoneTexture(floorStonePixels(n), n, true);
  const topH = PEDESTAL_HEIGHT * 0.6, footH = PEDESTAL_HEIGHT - topH, b = PLINTH_BEVEL;
  // The plinth's profile (r, y), top inner edge -> rounded worn lip -> slightly battered wall.
  const prof: THREE.Vector2[] = [];
  for (let k = 0; k <= 6; k++) { const a = (k / 6) * (Math.PI / 2); prof.push(new THREE.Vector2(R - b + b * Math.sin(a), -b + b * Math.cos(a))); }
  prof.push(new THREE.Vector2(R * 1.02, -topH));
  prof.reverse(); // bottom -> top: LatheGeometry winds outward for rising profiles
  const lathe = new THREE.LatheGeometry(prof, 96);
  // Chips: knock the lip in where a slow noise along the rim says so (only the rounded part moves).
  const pos = lathe.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (y < -b * 1.05) continue;
    const ang = Math.atan2(z, x), wear = sstep(0.55, 0.85, vnoise((ang + Math.PI) * 6, 3.7, 0) * 0.6 + vnoise((ang + Math.PI) * 17, 9.1, 0) * 0.4);
    const k = 1 - (0.012 * wear * (1 + y / b * 0.4)) / R;
    pos.setXYZ(i, x * k, y - 0.004 * wear * (1 + y / b), z * k);
  }
  lathe.computeVertexNormals();
  // Walls: the same slabs at WALL_TILE_M (cells ~0.1 m, ashlar-sized for a 7 cm wall), a whole number of repeats round.
  const repeatU = Math.max(1, Math.round((2 * Math.PI * R) / WALL_TILE_M));
  const plinth = new THREE.Mesh(lathe, stoneMaterial(flag, "#d2c8b8", { mapping: "wall", repeatU, period: WALL_TILE_M }));
  plinth.name = "pedestal-plinth";
  // The top face: a disc (inside the worn lip) whose uv spans the stone texture; the contact shadow lives here only.
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R - b, 96), stoneMaterial(top, "#e6dccb", { mapping: "disc", contact: true }));
  disc.name = "pedestal-top";
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.0005;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.1, R * 1.14, footH, 64), stoneMaterial(flag, "#a79d8f", { mapping: "wall", repeatU: Math.round(repeatU * 1.1), period: WALL_TILE_M }));
  foot.name = "pedestal-foot";
  foot.position.y = -topH - footH / 2;
  // Wave Z: forged iron, dull: a low specular (the full SPECULAR_METAL band clipped to pure white streaks seen from the
  // portrait's low camera — lane F's pixel count, board Z-31).
  const band = createCelSurface(new THREE.TorusGeometry(R * 1.02, 0.014, 8, 96), "#4a4642", IRON_SPECULAR);
  band.name = "pedestal-iron-band";
  band.rotation.x = Math.PI / 2;
  band.position.y = -topH * 0.62;
  const footBand = createCelSurface(new THREE.TorusGeometry(R * 1.105, 0.012, 8, 96), "#3a3633", IRON_SPECULAR);
  footBand.rotation.x = Math.PI / 2;
  footBand.position.y = -topH - 0.006;
  g.add(plinth, foot, disc, band, footBand);
  for (const m of [plinth, foot, disc]) m.userData.pedestalStone = true;
  return g;
}

/** Wave Z: the flagstone FLOOR the plinth stands on (y = −PEDESTAL_HEIGHT), fading into the backdrop by FLOOR_FADE. */
export function buildFloor(R = PEDESTAL_RADIUS): THREE.Mesh {
  const n = 256, tex = stoneTexture(floorStonePixels(n), n, true);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(FLOOR_RADIUS, 96), stoneMaterial(tex, "#b9ae9e", { mapping: "floor", fade: FLOOR_FADE, footAO: R * 1.14, bump: 0.008 }));
  floor.name = "preview-floor";
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -PEDESTAL_HEIGHT;
  floor.renderOrder = -1;
  return floor;
}

/** The part of a renderer the stage drives; the shadow pass runs only when the render-target calls exist (a test fake has none). */
export interface StageRenderer {
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  setRenderTarget?: (t: THREE.WebGLRenderTarget | null) => void;
  setClearColor?: (c: THREE.ColorRepresentation, a?: number) => void;
  getClearColor?: (target: THREE.Color) => THREE.Color;
  getClearAlpha?: () => number;
  clear?: () => void;
}

/**
 * Wave Z: the viewer's STAGE — pedestal + floor + the overhead key's shadow pass + the light written into the
 * shared cel uniforms for one draw (restored in `finally`). One implementation for the live Creator preview and
 * the hero portrait, so the card picture is lit exactly like the turntable.
 */
export class PreviewStage {
  readonly group = new THREE.Group();
  readonly pedestal: THREE.Group;
  readonly floor: THREE.Mesh;
  /** QA switches (wave X): the cast shadow map and the painted contact blob, for an on/off measurement. */
  cast = true;
  contact = true;
  /** The floor's brightness at its fade edge (FLOOR_FAR_DIM; the portrait sets PORTRAIT_FLOOR_FAR_DIM). */
  floorFarDim = FLOOR_FAR_DIM;
  #target: THREE.WebGLRenderTarget;
  #cam: THREE.OrthographicCamera;
  #matrix = new THREE.Matrix4();
  // Back faces only, with a slope-scaled offset: a surface never compares against its own depth (no acne
  // bands where the overhead key grazes the vertical trunk), while the body still shades the base.
  #depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.BackSide, polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2 });
  #light = { dir: new THREE.Vector3(...previewLightVector()), colour: new THREE.Color(...PREVIEW_KEY_COLOUR), fill: new THREE.Color(...PREVIEW_FILL), sky: new THREE.Color(1.05, 1.0, 0.94), ground: new THREE.Color(0.78, 0.66, 0.54), faceDir: new THREE.Vector3(0, 0, 1), faceColour: new THREE.Color(...PREVIEW_FACE_FILL.colour) };

  constructor() {
    this.group.name = "preview-stage";
    this.pedestal = buildPedestal();
    this.floor = buildFloor();
    this.group.add(this.floor, this.pedestal);
    this.#target = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, { depthBuffer: true });
    const f = shadowFrame();
    this.#cam = new THREE.OrthographicCamera(-f.half, f.half, f.half, -f.half, f.near, f.far);
    this.#cam.position.set(...f.position);
    this.#cam.lookAt(...f.target);
    this.#cam.updateMatrixWorld(true);
    this.#cam.updateProjectionMatrix();
    this.#matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(this.#cam.projectionMatrix).multiply(this.#cam.matrixWorldInverse);
  }

  get lightDir(): THREE.Vector3 { return this.#light.dir; }
  get shadowTarget(): THREE.WebGLRenderTarget { return this.#target; }

  /** Shadow pass (if the renderer can), then the main pass from `camera`, with the viewer's light; uniforms restored after. */
  draw(renderer: StageRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    const L = celLighting;
    const saved = {
      dir: L.lightDirection.value, col: L.lightColor.value, amb: L.ambientColor.value, sky: L.uSkyTint.value, gnd: L.uGroundTint.value,
      map: L.uShadowMap.value, mat: L.uShadowMatrix.value, on: L.uShadowOn.value, texel: L.uShadowTexel.value,
      fd: L.uFillDir.value, fc: L.uFillColor.value,
    };
    let bg: THREE.Scene["background"] | undefined = undefined;
    try {
      L.lightDirection.value = this.#light.dir; L.lightColor.value = this.#light.colour; L.ambientColor.value = this.#light.fill;
      L.uSkyTint.value = this.#light.sky; L.uGroundTint.value = this.#light.ground;
      this.#light.faceDir.set(...faceFillDir(camera.position.x, camera.position.z));
      L.uFillDir.value = this.#light.faceDir; L.uFillColor.value = this.#light.faceColour;
      const top = this.pedestal.getObjectByName("pedestal-top") as THREE.Mesh | undefined;
      const u = (top?.material as THREE.ShaderMaterial | undefined)?.uniforms?.uContact;
      if (u) u.value.x = this.contact ? CONTACT_SHADOW.strength : 0;
      const fd = (this.floor.material as THREE.ShaderMaterial).uniforms?.uFarDim;
      if (fd) fd.value = this.floorFarDim;
      L.uShadowOn.value = 0;
      const canShadow = !!(renderer.setRenderTarget && renderer.setClearColor && renderer.getClearColor && renderer.getClearAlpha && renderer.clear);
      if (canShadow) {
        // The depth pass from the key light (everything but the stage itself casts).
        this.group.visible = false;
        // A painted scene.background (the portrait's walnut texture) would be drawn INTO the depth map as colours
        // and read back as blockers everywhere: hide it for the depth pass.
        bg = scene.background;
        scene.background = null;
        scene.overrideMaterial = this.#depthMat;
        const prevAlpha = renderer.getClearAlpha!(), prevColour = renderer.getClearColor!(new THREE.Color());
        renderer.setRenderTarget!(this.#target);
        renderer.setClearColor!(0xffffff, 1);
        renderer.clear!();
        if (this.cast) renderer.render(scene, this.#cam);
        renderer.setRenderTarget!(null);
        renderer.setClearColor!(prevColour, prevAlpha);
        scene.overrideMaterial = null;
        scene.background = bg;
        bg = undefined;
        this.group.visible = true;
        L.uShadowMap.value = this.#target.texture; L.uShadowMatrix.value = this.#matrix; L.uShadowOn.value = this.cast ? 1 : 0; L.uShadowTexel.value = 1 / SHADOW_SIZE;
      }
      renderer.render(scene, camera);
    } finally {
      scene.overrideMaterial = null;
      if (bg !== undefined) scene.background = bg;
      this.group.visible = true;
      L.lightDirection.value = saved.dir; L.lightColor.value = saved.col; L.ambientColor.value = saved.amb; L.uSkyTint.value = saved.sky; L.uGroundTint.value = saved.gnd;
      L.uShadowMap.value = saved.map; L.uShadowMatrix.value = saved.mat; L.uShadowOn.value = saved.on; L.uShadowTexel.value = saved.texel;
      L.uFillDir.value = saved.fd; L.uFillColor.value = saved.fc;
    }
  }

  dispose(): void {
    this.#target.dispose();
    this.#depthMat.dispose();
  }
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
  }, { garment: profile.appearance.body, weaponSpec: fighter.weaponSpec, restPose: true }); // wave Y: carry + knees out on its own
  return { rig, fighter };
}

export class PreviewScene {
  #canvas: HTMLCanvasElement;
  #renderer: THREE.WebGLRenderer;
  #scene: THREE.Scene;
  #camera: THREE.PerspectiveCamera;
  #root: THREE.Group;
  #stage: PreviewStage;
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
  /** Wave Z: the bottom share of the canvas a DOM overlay covers (see #measureFootReserve). */
  #footReserve = 0;
  #reserveRead = 0;
  #reserveTick = 0;
  /** The character's measured height, metres — public evidence for the framing claim. */
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
    // Wave X lane B: the pedestal (one radius for every race); wave Z: on a flagstone floor, one stage shared with the portrait.
    this.#stage = new PreviewStage();
    this.#scene.add(this.#stage.group);
    this.#root = new THREE.Group();
    this.#scene.add(this.#root);
    this.#camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 20);
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
    const f = previewFraming(this.#rig ? this.#heightM : 0, this.#camera.aspect, CAM_FOV, PEDESTAL_RADIUS, this.#footReserve);
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
    // Wave Z: the layout may float a band over the canvas bottom (lane F's name/tags); the frame grows so the plinth
    // and its shadow stay above it. Reads only (no DOM write), re-measured every 20 calls (resize runs per frame).
    if (this.#reserveTick++ % 20 === 0) this.#reserveRead = this.#measureFootReserve();
    const reserve = this.#reserveRead;
    if (this.#camera.aspect !== w / h || reserve !== this.#footReserve) {
      this.#footReserve = reserve;
      this.#camera.aspect = w / h;
      this.#camera.updateProjectionMatrix();
      this.#fitCamera(); // a narrow canvas may need the base's width rule
    }
  }

  /**
   * Wave Z: how much of the canvas bottom a floating DOM band covers, 0..0.4. An explicit `data-foot-reserve` on the
   * canvas wins; otherwise lane F's + New plate band (`.stage-plate .hero-plate-foot`, LAYOUT.md) is measured: the share
   * of the canvas height below the band's top. Geometry reads only; 0 when there is no DOM (tests) or no band.
   */
  #measureFootReserve(): number {
    const c = this.#canvas as HTMLCanvasElement & { dataset?: DOMStringMap; closest?: (s: string) => Element | null; getBoundingClientRect?: () => DOMRect };
    const clamp = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(0.4, v)) : 0);
    const explicit = c.dataset?.footReserve;
    if (explicit !== undefined && explicit !== "") return clamp(Number(explicit));
    const foot = c.closest?.(".stage-plate")?.querySelector(".hero-plate-foot");
    if (!foot || !c.getBoundingClientRect) return 0;
    const cr = c.getBoundingClientRect(), fr = foot.getBoundingClientRect();
    if (cr.height < 1 || fr.height < 1) return 0;
    return clamp((cr.bottom - Math.max(cr.top, fr.top)) / cr.height);
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
    // Wave X: the preview's own lighting in the SHARED cel uniforms, for this draw only (wave Z: PreviewStage).
    this.#stage.draw(this.#renderer, this.#scene, this.#camera);
  }

  /** Wave P/X evidence: the framing the camera chose (distance from the pedestal radius; `clipped` = the height rule fired). */
  framing(): { heightM: number; distanceM: number; yaw: number; pitch: number; targetY: number; pedestalRadiusM: number; clipped: boolean; footReserve: number } {
    const r = (v: number) => Math.round(v * 1000) / 1000;
    return { heightM: r(this.#heightM), distanceM: r(this.#distance), yaw: r(this.#yaw), pitch: r(this.#pitch), targetY: r(this.#targetY), pedestalRadiusM: PEDESTAL_RADIUS, clipped: this.#clipped, footReserve: this.#footReserve };
  }

  /** QA (wave X): the pedestal as built — its measured radius (from the geometry) and height. */
  pedestal(): { radiusM: number; heightM: number; topY: number } {
    // Wave Z: the walking disc sits inside the worn lip, so the radius is the PLINTH's measured outer edge at its top.
    const plinth = this.#stage.pedestal.getObjectByName("pedestal-plinth") as THREE.Mesh | undefined;
    plinth?.geometry.computeBoundingBox();
    const bb = plinth?.geometry.boundingBox;
    return { radiusM: bb ? Math.round(Math.min(bb.max.x, bb.max.z) * 1000) / 1000 : 0, heightM: PEDESTAL_HEIGHT, topY: bb ? Math.round(bb.max.y * 1000) / 1000 : 0 };
  }

  /**
   * QA (wave X): screen points (css px) on the pedestal top that the camera actually SEES (a ray from the
   * camera hits the top disc first, not a leg or a foot): a ring beside the feet (r 0.16-0.32 m) and the
   * rim (r 0.5 m) — the probe reads the canvas there to prove the contact shadow.
   */
  debugShadowProbe(): { near: [number, number][]; rim: [number, number][]; shadowMap: boolean; shadowCoverage: number } {
    this.#scene.updateMatrixWorld(true);
    const top = this.#stage.pedestal.getObjectByName("pedestal-top")!;
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
    this.#renderer.readRenderTargetPixels(this.#stage.shadowTarget, 0, 0, SHADOW_SIZE, SHADOW_SIZE, buf);
    let covered = 0;
    for (let i = 0; i < buf.length; i += 4) if (buf[i] < 250 || buf[i + 1] < 250 || buf[i + 2] < 250) covered++;
    return { near: ring([0.16, 0.2, 0.24, 0.28, 0.32]), rim: ring([0.5]), shadowMap: covered > 0, shadowCoverage: Math.round((covered / (SHADOW_SIZE * SHADOW_SIZE)) * 10000) / 10000 } as ReturnType<PreviewScene["debugShadowProbe"]>;
  }

  /** QA (wave X): switch the cast shadow / the contact blob off and on (measurement only). */
  debugLighting(o: { cast?: boolean; contact?: boolean }): void {
    if (o.cast !== undefined) this.#stage.cast = o.cast;
    if (o.contact !== undefined) this.#stage.contact = o.contact;
    this.#render(0);
  }

  /** QA (wave Z): the key light's world direction as the preview writes it (the probe reads the shadow's expected side). */
  debugLightVector(): [number, number, number] {
    const d = this.#stage.lightDir;
    return [d.x, d.y, d.z];
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
    this.#stage.dispose();
    this.#renderer.dispose();
    const g = globalThis as unknown as { __MYTHERRANIA_PREVIEW__?: PreviewScene };
    if (g.__MYTHERRANIA_PREVIEW__ === this) delete g.__MYTHERRANIA_PREVIEW__;
  }
}
