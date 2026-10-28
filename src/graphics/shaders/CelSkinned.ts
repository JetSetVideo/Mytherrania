// Cel shading for SKINNED meshes (lane A, R03): the same look as CelShader.ts (two light
// bands, rim, metal-only specular, #172128 ink hull of 0.035 m), but the vertex stage runs
// three.js's skinning chunks so a THREE.SkinnedMesh deforms with its bones. three.js turns
// USE_SKINNING on by itself for a SkinnedMesh (WebGLPrograms: `skinning: object.isSkinnedMesh`)
// and declares skinIndex/skinWeight; the shader only has to include the chunks.
//
// Vertex colours (lane B's paintVertices: LINEAR RGB per vertex, attribute `color`) multiply
// the base colour when the material is built with `vertexColors: true`: three.js then emits
// `#define USE_COLOR` and declares `attribute vec3 color;` itself (WebGLProgram, non-raw
// ShaderMaterial prefix), so the shader never redeclares it and reads it only under
// #ifdef USE_COLOR into the varying vPaint (1 when unpainted). Painted skin uses a WHITE base
// colour so the paint carries the colour — the same 4 edits lane B specifies for CelShader.ts.

// @deno-types="@types/three"
import * as THREE from "three";
import { celLighting } from "./CelShader.ts";

/** Ink colour and hull width of the outline, identical to CelShader.createCelMesh. */
export const CEL_INK = "#172128";
export const CEL_OUTLINE_WIDTH = 0.035;

const skinnedCelVertex = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  uniform vec3 lightDirection;
  varying vec3 viewNormal;
  varying vec3 viewLight;
  varying vec3 viewPos;
  varying vec3 vPaint;
  void main() {
    #ifdef USE_COLOR
      vPaint = color;      // linear RGB from paintVertices; skinning never touches it
    #else
      vPaint = vec3(1.0);
    #endif
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    viewNormal = normalize(normalMatrix * objectNormal);
    viewLight = normalize((viewMatrix * vec4(lightDirection, 0.0)).xyz);
    vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
    viewPos = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

// Same bands as CelShader.celFragment: 0.27·step(0.25, n·l) + 0.35·step(0.65, n·l), rim
// (1 − n_z)³·0.25, Phong specular ^22 only when uSpecular > 0.
const skinnedCelFragment = /* glsl */ `
  uniform vec3 baseColor;
  uniform vec3 lightColor;
  uniform vec3 ambientColor;
  uniform float uSpecular;
  varying vec3 viewNormal;
  varying vec3 viewLight;
  varying vec3 viewPos;
  varying vec3 vPaint;
  void main() {
    vec3 n = normalize(viewNormal);
    vec3 l = normalize(viewLight);
    float diffuse = max(dot(n, l), 0.0);
    float band = 0.27 * step(0.25, diffuse) + 0.35 * step(0.65, diffuse);
    float rim = pow(1.0 - max(n.z, 0.0), 3.0) * 0.25;
    vec3 view = normalize(-viewPos);
    float spec = uSpecular > 0.0 ? pow(max(dot(reflect(-l, n), view), 0.0), 22.0) * uSpecular : 0.0;
    vec3 lit = ambientColor * 1.15 + lightColor * band + rim * (lightColor + ambientColor);
    gl_FragColor = vec4(baseColor * vPaint * lit + lightColor * spec, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Inverted hull: push the SKINNED position out along the SKINNED normal in view space.
const skinnedOutlineVertex = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  uniform float outlineWidth;
  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    vec4 viewPosition = modelViewMatrix * vec4(transformed, 1.0);
    vec3 n = normalize(normalMatrix * objectNormal);
    viewPosition.xyz += n * outlineWidth;
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

/** Options of the skinned cel materials. */
export interface CelSkinnedOptions {
  /** Metal-only specular strength (0 for flesh/cloth, CelShader.SPECULAR_METAL for metal). */
  specular?: number;
  /**
   * Multiply the base colour by the geometry's `color` attribute (painted skin). Defaults
   * to `geometry.hasAttribute("color")` in createCelSkinnedMesh.
   */
  vertexColors?: boolean;
  /** Hull width in metres (default CEL_OUTLINE_WIDTH). */
  outlineWidth?: number;
}

/** The cel surface material for a SkinnedMesh (uniforms shared with CelShader's lighting). */
export function createCelSkinnedSurfaceMaterial(color: THREE.ColorRepresentation, opts: CelSkinnedOptions = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      baseColor: { value: new THREE.Color(color) },
      lightDirection: celLighting.lightDirection,
      lightColor: celLighting.lightColor,
      ambientColor: celLighting.ambientColor,
      uSpecular: { value: opts.specular ?? 0 },
    },
    vertexShader: skinnedCelVertex,
    fragmentShader: skinnedCelFragment,
    side: THREE.FrontSide,
    vertexColors: opts.vertexColors ?? false,
  });
}

/** The inverted-hull outline material for a SkinnedMesh. */
export function createCelSkinnedOutlineMaterial(opts: CelSkinnedOptions = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      inkColor: { value: new THREE.Color(CEL_INK) },
      outlineWidth: { value: opts.outlineWidth ?? CEL_OUTLINE_WIDTH },
    },
    vertexShader: skinnedOutlineVertex,
    fragmentShader: outlineFragment,
    side: THREE.BackSide,
  });
}

/** A skinned cel body: the surface and its hull share one geometry and one THREE.Skeleton. */
export interface CelSkinnedMesh {
  group: THREE.Group;
  surface: THREE.SkinnedMesh;
  outline: THREE.SkinnedMesh;
}

/**
 * Build the cel surface + ink hull as two SkinnedMeshes over `geometry` (which must carry
 * skinIndex/skinWeight), both bound to `skeleton` with the identity bind matrix (the
 * geometry is authored in the skeleton root's space). When the geometry carries a `color`
 * attribute the surface is painted (white base × vertex colour); `color` is used otherwise. The meshes skip frustum culling: the
 * bind-pose bounding sphere does not follow the bones.
 */
export function createCelSkinnedMesh(
  geometry: THREE.BufferGeometry,
  skeleton: THREE.Skeleton,
  color: THREE.ColorRepresentation,
  opts: CelSkinnedOptions = {},
): CelSkinnedMesh {
  const painted = opts.vertexColors ?? geometry.hasAttribute("color");
  // Painted skin: white base so the paint carries the colour; unpainted: the palette colour.
  const surface = new THREE.SkinnedMesh(geometry, createCelSkinnedSurfaceMaterial(painted ? "#ffffff" : color, { ...opts, vertexColors: painted }));
  surface.name = "cel-surface";
  const outline = new THREE.SkinnedMesh(geometry, createCelSkinnedOutlineMaterial(opts));
  outline.name = "cel-outline";
  for (const m of [surface, outline]) {
    m.frustumCulled = false;
    m.bind(skeleton, new THREE.Matrix4());
  }
  const group = new THREE.Group();
  group.name = "cel-skinned";
  group.add(surface, outline);
  return { group, surface, outline };
}

/** The GLSL sources, exported so a test can assert the skinning chunks are present. */
export const CEL_SKINNED_SHADERS = {
  surfaceVertex: skinnedCelVertex,
  surfaceFragment: skinnedCelFragment,
  outlineVertex: skinnedOutlineVertex,
  outlineFragment,
} as const;
