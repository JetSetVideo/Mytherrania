// @deno-types="@types/three"
import * as THREE from "three";

const celVertex = /* glsl */ `
  uniform vec3 lightDirection;
  varying vec3 viewNormal;
  varying vec3 viewLight;
  varying vec3 viewPos;
  void main() {
    viewNormal = normalize(normalMatrix * normal);
    viewLight = normalize((viewMatrix * vec4(lightDirection, 0.0)).xyz);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    viewPos = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const celFragment = /* glsl */ `
  uniform vec3 baseColor;
  uniform vec3 lightColor;
  uniform vec3 ambientColor;
  uniform float uSpecular;
  varying vec3 viewNormal;
  varying vec3 viewLight;
  varying vec3 viewPos;
  void main() {
    vec3 n = normalize(viewNormal);
    vec3 l = normalize(viewLight);
    float diffuse = max(dot(n, l), 0.0);
    float band = 0.27 * step(0.25, diffuse) + 0.35 * step(0.65, diffuse);
    // Rim light keeps silhouettes readable at night and against a bright sky.
    float rim = pow(1.0 - max(n.z, 0.0), 3.0) * 0.25;
    // Specular: metal only (uSpecular 0 on flesh and cloth). Without it a blade
    // under a warm dawn sun just reads as an orange slab rather than steel.
    vec3 view = normalize(-viewPos);
    float spec = uSpecular > 0.0
      ? pow(max(dot(reflect(-l, n), view), 0.0), 22.0) * uSpecular
      : 0.0;
    vec3 lit = ambientColor * 1.15 + lightColor * band + rim * (lightColor + ambientColor);
    gl_FragColor = vec4(baseColor * lit + lightColor * spec, 1.0);
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
 * current sun/moon direction, colour and ambient here once per frame from the
 * EnvironmentState; all cel materials reference these same uniform objects.
 */
export const celLighting = {
  lightDirection: { value: new THREE.Vector3(-0.45, 1, 0.65).normalize() },
  lightColor: { value: new THREE.Color(1, 1, 1) },
  ambientColor: { value: new THREE.Color(0.38, 0.38, 0.38) },
};

/** How shiny a surface is. Metal gets a specular highlight; flesh and cloth do not. */
export const SPECULAR_METAL = 0.85;

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
  const surface = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
    uniforms: {
      baseColor: { value: new THREE.Color(color) },
      lightDirection: celLighting.lightDirection,
      lightColor: celLighting.lightColor,
      ambientColor: celLighting.ambientColor,
      uSpecular: { value: specular },
    },
    vertexShader: celVertex,
    fragmentShader: celFragment,
    side: THREE.FrontSide,
  }));
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
  const surface = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
    uniforms: {
      baseColor: { value: new THREE.Color(color) },
      lightDirection: celLighting.lightDirection,
      lightColor: celLighting.lightColor,
      ambientColor: celLighting.ambientColor,
      uSpecular: { value: specular },
    },
    vertexShader: celVertex,
    fragmentShader: celFragment,
    side: THREE.FrontSide,
  }));
  surface.name = "cel-surface";
  return surface;
}
