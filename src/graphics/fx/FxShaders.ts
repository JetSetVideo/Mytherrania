// GLSL + material factories for every lane-D effect layer.
//
// Daylight rule (learned the hard way on this project): an additive-only effect
// is invisible on a bright sky, and a pale core mixed in hard washes every
// element to the same white. So each effect draws as a PAIR of materials over
// ONE geometry:
//   outer  NormalBlending, the saturated element `edge` colour — reads in daylight;
//   core   AdditiveBlending, mostly `edge` again, mixed toward the pale `core`
//          only at the hottest sliver (pow(heat, 2.2) * 0.55) — reads in shadow.
// Both share one uniforms object, so a colour / brightness change is one write.
// depthWrite is off everywhere (transparent layers must not occlude each other).

// @deno-types="@types/three"
import * as THREE from "three";
import type { TrailPalette } from "./FxRecipes.ts";

/** Uniforms every lane-D material carries. Colours are THREE.Color (linear), the rest floats. */
export interface FxUniforms {
  [name: string]: THREE.IUniform;
  /** Saturated element colour (outer layer). */
  uEdge: THREE.IUniform<THREE.Color>;
  /** Element trail tint. */
  uBody: THREE.IUniform<THREE.Color>;
  /** Hot pale centre, used only at the hottest sliver. */
  uCore: THREE.IUniform<THREE.Color>;
  /** Colour gain, <= 1 by design (FxIntensity.brightness). */
  uBrightness: THREE.IUniform<number>;
  /** Overall layer opacity 0..1 (fades whole effects in and out). */
  uOpacity: THREE.IUniform<number>;
  /** Effect clock in seconds (animates streaks / shimmer). */
  uTime: THREE.IUniform<number>;
  /** Outer-layer density exponent k (shared by every effect; see FX_DENSITY). */
  uDensity: THREE.IUniform<number>;
}

/**
 * ONE uniform object shared by every effect material, so the engine sets the daylight
 * density with a single write. Outer-layer opacity is thickened as
 *   a' = 1 - (1 - a)^k        (k >= 1; 0 stays 0, 1 stays 1, faint parts get denser)
 * because a normal-blended translucent layer vanishes against a bright sunlit floor
 * while the additive core carries it at night (vision review at noon: dash 2/10,
 * shield arc 2/10 with k = 1).
 */
export const FX_DENSITY: THREE.IUniform<number> = { value: 1 };

/**
 * Density exponent for a scene luminosity in [0, 1] (Environment.luminosity):
 *   k = 1 + DENSITY_DAYLIGHT_GAIN * lum   ->  night (lum ~0.04) ~1.1, noon (lum 1) 3.5.
 */
export const DENSITY_DAYLIGHT_GAIN = 2.5;
export function fxDensityForLuminosity(lum: number): number {
  return 1 + DENSITY_DAYLIGHT_GAIN * Math.max(0, Math.min(1, lum));
}

/** Fresh uniforms for a palette. Allocates: call at construction only. */
export function createFxUniforms(palette: TrailPalette, extra: Record<string, THREE.IUniform> = {}): FxUniforms {
  return {
    uEdge: { value: new THREE.Color(palette.edge) },
    uBody: { value: new THREE.Color(palette.body) },
    uCore: { value: new THREE.Color(palette.core) },
    uBrightness: { value: 1 },
    uOpacity: { value: 1 },
    uTime: { value: 0 },
    uDensity: FX_DENSITY,
    ...extra,
  };
}

/** Re-colour in place (no allocation): `Color.set` parses the hex into the existing objects. */
export function applyPalette(u: FxUniforms, palette: TrailPalette): void {
  u.uEdge.value.set(palette.edge);
  u.uBody.value.set(palette.body);
  u.uCore.value.set(palette.core);
}

/** The outer (normal-blend) + core (additive) material pair over shared uniforms. */
export interface LayerPair {
  outer: THREE.ShaderMaterial;
  core: THREE.ShaderMaterial;
}

/** Build a two-layer material pair. `side` defaults to DoubleSide (ribbons and decals are seen from both faces). */
export function createLayerPair(
  vertexShader: string,
  outerFragment: string,
  coreFragment: string,
  uniforms: FxUniforms,
  side: THREE.Side = THREE.DoubleSide,
): LayerPair {
  const common = { uniforms, vertexShader, transparent: true, depthWrite: false, depthTest: true, side };
  return {
    outer: new THREE.ShaderMaterial({ ...common, fragmentShader: outerFragment, blending: THREE.NormalBlending }),
    core: new THREE.ShaderMaterial({ ...common, fragmentShader: coreFragment, blending: THREE.AdditiveBlending }),
  };
}

/** Two meshes over one geometry: outer drawn first, additive core on top. 2 draw calls when visible. */
export function createLayerMeshes(geometry: THREE.BufferGeometry, pair: LayerPair): [THREE.Mesh, THREE.Mesh] {
  const outer = new THREE.Mesh(geometry, pair.outer);
  const core = new THREE.Mesh(geometry, pair.core);
  outer.renderOrder = 10;
  core.renderOrder = 11;
  return [outer, core];
}

const HEADER = /* glsl */ `
  uniform vec3 uEdge;
  uniform vec3 uBody;
  uniform vec3 uCore;
  uniform float uBrightness;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uDensity;
  // Daylight density: a' = 1 - (1 - a)^k (see FX_DENSITY).
  float fxDensity(float a) { return 1.0 - pow(1.0 - clamp(a, 0.0, 1.0), max(uDensity, 1.0)); }
  float fxHash(vec2 p) { return fract(sin(p.x * 127.1 + p.y * 311.7) * 43758.5453); }
  float fxNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = fxHash(i), b = fxHash(i + vec2(1.0, 0.0)), c = fxHash(i + vec2(0.0, 1.0)), d = fxHash(i + vec2(1.0, 1.0));
    return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
  }
  // Hot colour: the element edge, nudged toward the pale core only at the hottest sliver.
  vec3 fxHot(float heat) { return mix(uEdge, uCore, clamp(pow(heat, 2.2) * 0.55, 0.0, 1.0)); }
`;

const OUTRO = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

// ---------------------------------------------------------------------------
// Ribbon (weapon + body trails). Positions are WORLD space (mesh at identity).
//   aAlpha  per-vertex age fade (TrailBuffer.alphas)
//   aAlong  0 at the head row, 1 at the tail
//   aSide   0 on edge 0 (base / hip), 1 on edge 1 (tip / shoulder)
//   uProfile 0 = leading-edge profile (brightest at the tip: weapons),
//            1 = symmetric profile (brightest mid-ribbon: bodies)
// ---------------------------------------------------------------------------
export const RIBBON_VERTEX = /* glsl */ `
  attribute float aAlpha;
  attribute float aAlong;
  attribute float aSide;
  varying float vAlpha;
  varying float vAlong;
  varying float vSide;
  void main() {
    vAlpha = aAlpha;
    vAlong = aAlong;
    vSide = aSide;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RIBBON_COMMON = /* glsl */ `
  uniform float uProfile;
  varying float vAlpha;
  varying float vAlong;
  varying float vSide;
  // 0..1 weight across the ribbon (see uProfile).
  float across() {
    float lead = smoothstep(0.0, 0.3, vSide) * (0.55 + 0.45 * vSide);
    float mid = 1.0 - abs(2.0 * vSide - 1.0);
    return mix(lead, smoothstep(0.0, 0.6, mid), uProfile);
  }
`;

export const RIBBON_OUTER_FRAGMENT = HEADER + RIBBON_COMMON + /* glsl */ `
  void main() {
    float streak = 0.72 + 0.28 * fxNoise(vec2(vAlong * 16.0 - uTime * 5.0, vSide * 4.0));
    float a = vAlpha * across() * streak * uOpacity;
    if (a < 0.01) discard;
    vec3 col = mix(uEdge, uBody, 0.35 * (1.0 - vAlong)) * (0.75 + 0.35 * uBrightness);
    gl_FragColor = vec4(col, clamp(fxDensity(a * 0.85), 0.0, 1.0));
  ` + OUTRO + `}
`;

export const RIBBON_CORE_FRAGMENT = HEADER + RIBBON_COMMON + /* glsl */ `
  void main() {
    float heat = vAlpha * pow(across(), 2.0) * (1.0 - 0.7 * vAlong) * uOpacity;
    if (heat < 0.01) discard;
    gl_FragColor = vec4(fxHot(heat) * heat * uBrightness * 0.9, 1.0);
  ` + OUTRO + `}
`;

// ---------------------------------------------------------------------------
// Ground decals (telegraph arrow, impact ring). Local geometry on the xz plane.
//   aUv.x  telegraph: 0 at the origin .. 1 at the landing point
//   aUv.y  telegraph: -1 .. 1 across the strip
//   uFill  0..1 share of the path already filled (wind-up progress)
//   uChevrons  chevrons along the strip (= length / chevron spacing)
// ---------------------------------------------------------------------------
export const DECAL_VERTEX = /* glsl */ `
  attribute vec2 aUv;
  varying vec2 vUv;
  void main() {
    vUv = aUv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TELEGRAPH_COMMON = /* glsl */ `
  uniform float uFill;
  uniform float uChevrons;
  varying vec2 vUv;
  float border() { float e = 1.0 - abs(vUv.y); return smoothstep(0.0, 0.12, e) * (1.0 - smoothstep(0.22, 0.42, e)); }
  float filled() { return 1.0 - smoothstep(uFill - 0.015, uFill, vUv.x); }
  float chevron() {
    float c = fract(vUv.x * uChevrons - abs(vUv.y) * 0.45 - uTime * 1.6);
    return smoothstep(0.0, 0.08, c) * (1.0 - smoothstep(0.32, 0.45, c));
  }
  float front() { return (1.0 - smoothstep(0.0, 0.035, abs(vUv.x - uFill))) * step(0.001, uFill); }
`;

export const TELEGRAPH_OUTER_FRAGMENT = HEADER + TELEGRAPH_COMMON + /* glsl */ `
  void main() {
    float f = filled();
    float a = (0.45 * border() + f * (0.28 + 0.32 * chevron()) + 0.5 * front()) * uOpacity;
    if (a < 0.01) discard;
    vec3 col = mix(uEdge * 0.8, uEdge, f) * (0.75 + 0.35 * uBrightness);
    gl_FragColor = vec4(col, clamp(fxDensity(a), 0.0, 0.9));
  ` + OUTRO + `}
`;

export const TELEGRAPH_CORE_FRAGMENT = HEADER + TELEGRAPH_COMMON + /* glsl */ `
  void main() {
    float centre = 1.0 - smoothstep(0.0, 0.35, abs(vUv.y));
    float heat = (front() + filled() * centre * 0.45 * chevron()) * uOpacity;
    if (heat < 0.01) discard;
    gl_FragColor = vec4(fxHot(heat) * heat * uBrightness * 0.8, 1.0);
  ` + OUTRO + `}
`;

/** Ring decal: a quad spanning aUv -1..1; the ring sits at radius uRing (same units) with band width uWidth. */
const RING_COMMON = /* glsl */ `
  uniform float uRing;
  uniform float uWidth;
  varying vec2 vUv;
  float band(float w) { return 1.0 - smoothstep(w * 0.5, w, abs(length(vUv) - uRing)); }
`;

export const RING_OUTER_FRAGMENT = HEADER + RING_COMMON + /* glsl */ `
  void main() {
    float r = length(vUv);
    float disc = (1.0 - smoothstep(0.0, uRing, r)) * 0.18;
    float a = (band(uWidth) + disc) * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uEdge * (0.75 + 0.35 * uBrightness), clamp(fxDensity(a), 0.0, 0.9));
  ` + OUTRO + `}
`;

export const RING_CORE_FRAGMENT = HEADER + RING_COMMON + /* glsl */ `
  void main() {
    float heat = band(uWidth * 0.45) * uOpacity;
    if (heat < 0.01) discard;
    gl_FragColor = vec4(fxHot(heat) * heat * uBrightness * 0.85, 1.0);
  ` + OUTRO + `}
`;

// ---------------------------------------------------------------------------
// Shield shimmer arc: an open partial cylinder in front of the body.
// ---------------------------------------------------------------------------
export const SHIELD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  void main() {
    vUv = uv;
    vNormalV = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const SHIELD_COMMON = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  float shieldMask() {
    float sides = smoothstep(0.0, 0.14, vUv.x) * (1.0 - smoothstep(0.86, 1.0, vUv.x));
    float height = smoothstep(0.0, 0.1, vUv.y) * (1.0 - smoothstep(0.8, 1.0, vUv.y));
    return sides * height;
  }
  float fresnel() { return pow(1.0 - abs(dot(normalize(vNormalV), normalize(-vViewPos))), 2.0); }
  float shimmer() {
    float n = fxNoise(vec2(vUv.x * 14.0, vUv.y * 9.0 - uTime * 1.8));
    float bands = 0.5 + 0.5 * sin((vUv.y * 22.0 - uTime * 6.0) + n * 3.0);
    return 0.55 + 0.45 * bands;
  }
`;

export const SHIELD_OUTER_FRAGMENT = HEADER + SHIELD_COMMON + /* glsl */ `
  void main() {
    float a = shieldMask() * (0.22 + 0.78 * fresnel()) * shimmer() * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(uEdge, uBody, 0.3) * (0.75 + 0.35 * uBrightness), clamp(fxDensity(a), 0.0, 0.85));
  ` + OUTRO + `}
`;

export const SHIELD_CORE_FRAGMENT = HEADER + SHIELD_COMMON + /* glsl */ `
  void main() {
    float heat = shieldMask() * pow(fresnel(), 2.0) * shimmer() * uOpacity;
    if (heat < 0.01) discard;
    gl_FragColor = vec4(fxHot(heat) * heat * uBrightness * 0.8, 1.0);
  ` + OUTRO + `}
`;

// ---------------------------------------------------------------------------
// Afterimage ghosts: one InstancedMesh of unit quads, CYLINDRICAL billboards
// (they turn about world +y to face the camera, so they stay upright). Each
// instance matrix holds the ghost's ground point (translation) and its
// (width, height) as the x/y scale. The silhouette is a signed-distance
// humanoid in height-normalised coordinates: hip 0.53, shoulder 0.82, head 0.93.
//   aGhost  per-instance opacity 0..1 (0 = slot unused)
// ---------------------------------------------------------------------------
export const GHOST_VERTEX = /* glsl */ `
  attribute float aGhost;
  varying vec2 vUv;
  varying float vGhost;
  void main() {
    vUv = uv;
    vGhost = aGhost;
    mat4 inst = mat4(1.0);
    #ifdef USE_INSTANCING
      inst = instanceMatrix;
    #endif
    vec3 ground = (modelMatrix * inst * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec2 size = vec2(length(inst[0].xyz), length(inst[1].xyz));
    vec3 toCam = cameraPosition - ground;
    vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-5, 0.0, 0.0));
    vec3 world = ground + right * position.x * size.x + vec3(0.0, (position.y + 0.5) * size.y, 0.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const GHOST_COMMON = /* glsl */ `
  uniform float uAspect; // quad width / height
  varying vec2 vUv;
  varying float vGhost;
  float capsule(vec2 p, vec2 a, vec2 b, float r) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
  }
  float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
  // Signed distance (in body heights) to a standing humanoid; x mirrored.
  float body() {
    vec2 p = vec2(abs(vUv.x - 0.5) * uAspect, vUv.y);
    float d = length(p - vec2(0.0, 0.925)) - 0.065;                        // head
    d = smin(d, capsule(p, vec2(0.0, 0.56), vec2(0.0, 0.77), 0.085), 0.04);  // torso
    d = smin(d, capsule(p, vec2(0.11, 0.79), vec2(0.15, 0.50), 0.034), 0.03); // arm
    d = smin(d, capsule(p, vec2(0.055, 0.52), vec2(0.06, 0.04), 0.046), 0.03); // leg
    return d;
  }
`;

export const GHOST_FRAGMENT = HEADER + GHOST_COMMON + /* glsl */ `
  void main() {
    float d = body();
    float fill = 1.0 - smoothstep(-0.004, 0.006, d);
    float halo = (1.0 - smoothstep(0.0, 0.05, d)) * 0.35;
    float rim = (1.0 - smoothstep(0.0, 0.012, abs(d + 0.008)));
    float a = (fill * 0.55 + halo) * vGhost * uOpacity;
    if (a < 0.01) discard;
    vec3 col = mix(uBody, uEdge, 0.55 + 0.45 * rim) * (0.75 + 0.35 * uBrightness);
    gl_FragColor = vec4(col, clamp(fxDensity(a), 0.0, 0.8));
  ` + OUTRO + `}
`;

// ---------------------------------------------------------------------------
// Speed lines: quads sliding backward past the body along the travel axis
// (the object's local +z), turned about that axis to face the camera.
//   aCorner (along -0.5..0.5, side -1..1); aAnchor = local offset; aSeed = phase.
//   uSpan = metres a streak travels front -> back; uLength / uWidth in metres;
//   uRate = streak passes per second.
// ---------------------------------------------------------------------------
export const SPEEDLINE_VERTEX = /* glsl */ `
  attribute vec2 aCorner;
  attribute vec3 aAnchor;
  attribute float aSeed;
  uniform float uTime;
  uniform float uSpan;
  uniform float uLength;
  uniform float uWidth;
  uniform float uRate;
  varying float vFade;
  varying float vAlong;
  void main() {
    float phase = fract(aSeed + uTime * uRate);
    vec3 local = aAnchor + vec3(0.0, 0.0, (0.5 - phase) * uSpan + aCorner.x * uLength);
    vec3 axis = normalize((modelMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
    vec4 world = modelMatrix * vec4(local, 1.0);
    vec3 side = cross(axis, normalize(cameraPosition - world.xyz));
    float sl = length(side);
    side = sl > 1e-4 ? side / sl : vec3(0.0, 1.0, 0.0);
    world.xyz += side * aCorner.y * uWidth;
    vFade = sin(3.14159265 * phase);
    vAlong = aCorner.x + 0.5;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const SPEEDLINE_FRAGMENT = HEADER + /* glsl */ `
  varying float vFade;
  varying float vAlong;
  void main() {
    // Bright head (front of the streak, vAlong -> 1), thin fading tail.
    float a = vFade * smoothstep(0.0, 0.9, vAlong) * uOpacity * 0.75;
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(uEdge, uBody, 0.25) * (0.75 + 0.35 * uBrightness), fxDensity(a));
  ` + OUTRO + `}
`;
