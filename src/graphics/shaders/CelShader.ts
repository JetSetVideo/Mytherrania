// @deno-types="@types/three"
import * as THREE from "three";

// Cel shading (G05, G10). Every cel surface — rigid parts here, skinned bodies (CelSkinned.ts) and
// weapons (WeaponMaterial.ts) — shades through ONE GLSL function, CEL_LIGHT_GLSL, on ONE shared set
// of uniforms (celLighting), so a single write per frame relights every character:
//
//   shadow   the key light's shadow map, sampled with a 3x3 PCF and a normal offset, then pushed
//            through the bands like any other light loss (a cast shadow is one band, never a smear).
//   bands    light = max(n.l, 0) x shadow, quantised at CEL_BAND_EDGES with anti-aliased steps
//            (width = fwidth(light)), weights CEL_BAND_WEIGHTS — the same 0.62 total the old two
//            hard steps gave, so the palette's brightness is unchanged.
//   ambient  hemisphere: mix(groundTint, skyTint, n_world.y * 0.5 + 0.5) x ambientColor x 1.15 —
//            surfaces facing the sky pick up its hue, undersides the ground bounce (a cheap GI term).
//   rim      a crisp back-rim band (1 - n_view.z beyond 0.62), stronger when the light is behind.
//   specular metal only: a hard highlight band plus 15% of the smooth lobe (reads as steel, not plastic).

/** Band thresholds on the lit fraction and their weights (sum 0.62, as before). */
export const CEL_BAND_EDGES = [0.12, 0.5] as const;
export const CEL_BAND_WEIGHTS = [0.3, 0.32] as const;

/** Shared lighting chunk: uniforms + celShade(). Needs `#include <packing>` before it. */
export const CEL_LIGHT_GLSL = /* glsl */ `
uniform vec3 lightColor;
uniform vec3 ambientColor;
uniform vec3 uSkyTint;
uniform vec3 uGroundTint;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowOn;
uniform float uShadowTexel;
float celShadow(vec3 world, vec3 worldN) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 sc = uShadowMatrix * vec4(world + worldN * 0.035, 1.0);
  sc.xyz /= sc.w;
  if (sc.x < 0.0 || sc.y < 0.0 || sc.x > 1.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
  float z = sc.z - 0.0012;
  float s = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    s += step(z, unpackRGBAToDepth(texture2D(uShadowMap, sc.xy + vec2(float(x), float(y)) * uShadowTexel * 1.25)));
  }
  return s / 9.0;
}
// n, l in VIEW space; world/worldN for the shadow lookup and the hemisphere.
vec3 celShade(vec3 base, vec3 n, vec3 l, vec3 viewPos, vec3 world, vec3 worldN, float specular) {
  float ndl = max(dot(n, l), 0.0);
  float sh = celShadow(world, normalize(worldN));
  float light = ndl * mix(0.08, 1.0, sh);
  float w = max(fwidth(light) * 0.75, 0.004);
  float band = ${CEL_BAND_WEIGHTS[0].toFixed(2)} * smoothstep(${CEL_BAND_EDGES[0].toFixed(2)} - w, ${CEL_BAND_EDGES[0].toFixed(2)} + w, light)
             + ${CEL_BAND_WEIGHTS[1].toFixed(2)} * smoothstep(${CEL_BAND_EDGES[1].toFixed(2)} - w, ${CEL_BAND_EDGES[1].toFixed(2)} + w, light);
  float hemi = clamp(normalize(worldN).y * 0.5 + 0.5, 0.0, 1.0);
  vec3 amb = ambientColor * 1.15 * mix(uGroundTint, uSkyTint, hemi);
  float rimEdge = 1.0 - max(n.z, 0.0);
  float rw = max(fwidth(rimEdge), 0.01);
  float rim = smoothstep(0.62 - rw, 0.62 + rw, rimEdge) * 0.2 * (0.55 + 0.45 * clamp(-l.z + 0.3, 0.0, 1.0));
  vec3 view = normalize(-viewPos);
  float spec = 0.0;
  if (specular > 0.0) {
    float s = pow(max(dot(reflect(-l, n), view), 0.0), 22.0);
    spec = (smoothstep(0.42, 0.52, s) * 0.85 + s * 0.15) * specular * sh;
  }
  return base * (amb + lightColor * band + rim * (lightColor * mix(0.4, 1.0, sh) + ambientColor)) + lightColor * spec;
}
`;

const celVertex = /* glsl */ `
  uniform vec3 lightDirection;
  varying vec3 viewNormal;
  varying vec3 viewLight;
  varying vec3 viewPos;
  varying vec3 vWorld;
  varying vec3 vWorldN;
  void main() {
    viewNormal = normalize(normalMatrix * normal);
    viewLight = normalize((viewMatrix * vec4(lightDirection, 0.0)).xyz);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vWorldN = normalize(mat3(modelMatrix) * normal);
    vec4 mv = viewMatrix * world;
    viewPos = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const celFragment = /* glsl */ `
  #include <packing>
  uniform vec3 baseColor;
  uniform float uSpecular;
  ${CEL_LIGHT_GLSL}
  varying vec3 viewNormal;
  varying vec3 viewLight;
  varying vec3 viewPos;
  varying vec3 vWorld;
  varying vec3 vWorldN;
  void main() {
    vec3 c = celShade(baseColor, normalize(viewNormal), normalize(viewLight), viewPos, vWorld, vWorldN, uSpecular);
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const outlineVertex = /* glsl */ `
  uniform float outlineWidth;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vec3 viewNormal = normalize(normalMatrix * normal);
    viewPosition.xyz += viewNormal * outlineWidth;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const outlineFragment = /* glsl */ `
  uniform vec3 inkColor;
  void main() {
    gl_FragColor = vec4(inkColor, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Lighting shared by every cel surface (parent → children). The Engine writes the
 * current sun/moon direction, colour, ambient, hemisphere tints and the key light's shadow map
 * here once per frame; all cel materials reference these same uniform objects.
 */
export const celLighting = {
  lightDirection: { value: new THREE.Vector3(-0.45, 1, 0.65).normalize() },
  lightColor: { value: new THREE.Color(1, 1, 1) },
  ambientColor: { value: new THREE.Color(0.38, 0.38, 0.38) },
  /** Hemisphere tints (mean ~1): sky-facing and ground-facing ambient hue. */
  uSkyTint: { value: new THREE.Color(1, 1, 1) },
  uGroundTint: { value: new THREE.Color(1, 1, 1) },
  /** The key light's shadow map (RGBA-packed depth), its world->shadow-uv matrix, on/off, texel. */
  uShadowMap: { value: null as THREE.Texture | null },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uShadowOn: { value: 0 },
  uShadowTexel: { value: 1 / 2048 },
};

/** The uniform record every cel surface material starts from (shared objects, never copies). */
export function celUniforms(extra: Record<string, THREE.IUniform>): Record<string, THREE.IUniform> {
  return { ...celLighting, ...extra };
}

/** How shiny a surface is. Metal gets a specular highlight; flesh and cloth do not. */
export const SPECULAR_METAL = 0.85;

function surfaceMaterial(color: THREE.ColorRepresentation, specular: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: celUniforms({ baseColor: { value: new THREE.Color(color) }, uSpecular: { value: specular } }),
    vertexShader: celVertex,
    fragmentShader: celFragment,
    side: THREE.FrontSide,
  });
}

/**
 * Static cel surface and inverted hull. Geometry is borrowed, never cloned.
 * Dispose each returned mesh's material and dispose the shared geometry once.
 * Normals and the world-space light are both transformed into view space.
 */
export function createCelMesh(
  geometry: THREE.BufferGeometry,
  color: THREE.ColorRepresentation,
  specular = 0,
): THREE.Group {
  const surface = new THREE.Mesh(geometry, surfaceMaterial(color, specular));
  surface.name = "cel-surface";
  const outline = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
    uniforms: {
      inkColor: { value: new THREE.Color("#172128") },
      outlineWidth: { value: 0.035 },
    },
    vertexShader: outlineVertex,
    fragmentShader: outlineFragment,
    side: THREE.BackSide,
  }));
  outline.name = "cel-outline";
  const group = new THREE.Group();
  group.add(surface, outline);
  return group;
}

/**
 * A cel surface with **no ink outline**. Use it for filler geometry that fuses two
 * outlined parts into one continuous body: the fillers draw no line of their own, so
 * the seam between the parts disappears instead of showing a doubled outline.
 */
export function createCelSurface(
  geometry: THREE.BufferGeometry,
  color: THREE.ColorRepresentation,
  specular = 0,
): THREE.Mesh {
  const surface = new THREE.Mesh(geometry, surfaceMaterial(color, specular));
  surface.name = "cel-surface";
  return surface;
}
