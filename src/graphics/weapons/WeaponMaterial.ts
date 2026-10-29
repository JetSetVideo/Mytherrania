// Weapon cel material: the SAME banded lighting as CelShader.ts (same light uniforms object,
// same band thresholds, rim and specular), but the base colour and the specular strength come
// from vertex attributes (aColor, aSpecular). That lets a whole weapon — steel blade, leather
// grip, brass guard — be ONE geometry drawn in one call, plus one call for the ink outline.
// The outline is the CelShader inverted hull, pushed along `outlineNormal` (welded normals),
// so it stays closed across the hard edges of a bevelled blade.

// @deno-types="@types/three"
import * as THREE from "three";
import { CEL_LIGHT_GLSL, celUniforms } from "../shaders/CelShader.ts";

/** Ink colour of every cel outline in the game (CelShader.ts). */
export const INK_COLOR = "#172128";
/**
 * Weapon ink width in view space, m, at and beyond INK_REF_DISTANCE. Bodies use 0.035
 * (CelShader); a blade is only 20-60 mm wide, so 35 mm of ink on each side would triple its
 * silhouette. 0.02 keeps the line visibly the same family while the blade still reads as a blade.
 */
export const WEAPON_OUTLINE_WIDTH = 0.02;
/**
 * Closer than this (m, view depth) the ink keeps a constant SCREEN width instead of a constant
 * world width: w = outlineWidth * min(1, depth / INK_REF_DISTANCE). At the 7 m gameplay distance
 * nothing changes (~1.8 px at 577 px / 50 deg); in a 1-3 m close-up the ink no longer swells to
 * 2 cm a side, which turned a 2 cm rapier blade into a blunt 6 cm dark bar.
 */
export const INK_REF_DISTANCE = 7;

const vertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSpecular;
  uniform vec3 lightDirection;
  varying vec3 viewNormal;
  varying vec3 viewLight;
  varying vec3 viewPos;
  varying vec3 vColor;
  varying float vSpecular;
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
    vColor = aColor;
    vSpecular = aSpecular;
    gl_Position = projectionMatrix * mv;
  }
`;

// Bands, shadow, hemisphere ambient, rim and specular: the shared CelShader chunk.
const fragment = /* glsl */ `
  #include <packing>
  ${CEL_LIGHT_GLSL}
  varying vec3 viewNormal;
  varying vec3 viewLight;
  varying vec3 viewPos;
  varying vec3 vColor;
  varying float vSpecular;
  varying vec3 vWorld;
  varying vec3 vWorldN;
  void main() {
    vec3 c = celShade(vColor, normalize(viewNormal), normalize(viewLight), viewPos, vWorld, vWorldN, vSpecular);
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const outlineVertex = /* glsl */ `
  attribute vec3 outlineNormal;
  uniform float outlineWidth;
  uniform float inkDistance;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * outlineNormal);
    viewPosition.xyz += n * outlineWidth * clamp(-viewPosition.z / inkDistance, 0.0, 1.0);
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

/** Cel surface material driven by vertex colour + vertex specular (shares celLighting). */
export function createWeaponCelMaterial(): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: celUniforms({}),
    vertexShader: vertex,
    fragmentShader: fragment,
    side: THREE.FrontSide,
  });
  m.name = "weapon-cel";
  return m;
}

/** Inverted-hull ink outline pushed along the welded outline normals (depth-capped, see INK_REF_DISTANCE). */
export function createWeaponOutlineMaterial(width = WEAPON_OUTLINE_WIDTH): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      inkColor: { value: new THREE.Color(INK_COLOR) },
      outlineWidth: { value: width },
      inkDistance: { value: INK_REF_DISTANCE },
    },
    vertexShader: outlineVertex,
    fragmentShader: outlineFragment,
    side: THREE.BackSide,
  });
  m.name = "weapon-outline";
  return m;
}
