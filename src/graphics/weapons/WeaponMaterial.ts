// Weapon cel material: the SAME banded lighting as CelShader.ts (same light uniforms object,
// same band thresholds, rim and specular), but the base colour and the specular strength come
// from vertex attributes (aColor, aSpecular). That lets a whole weapon — steel blade, leather
// grip, brass guard — be ONE geometry drawn in one call, plus one call for the ink outline.
// The outline is the CelShader inverted hull, pushed along `outlineNormal` (welded normals),
// so it stays closed across the hard edges of a bevelled blade.

// @deno-types="@types/three"
import * as THREE from "three";
import { celLighting } from "../shaders/CelShader.ts";

/** Ink colour of every cel outline in the game (CelShader.ts). */
export const INK_COLOR = "#172128";
/**
 * Weapon ink width in view space, m. Bodies use 0.035 (CelShader); a blade is only 25-60 mm
 * wide, so 35 mm of ink on each side would triple its silhouette. 0.02 keeps the line visibly
 * the same family while the blade still reads as a blade.
 */
export const WEAPON_OUTLINE_WIDTH = 0.02;

const vertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSpecular;
  uniform vec3 lightDirection;
  varying vec3 viewNormal;
  varying vec3 viewLight;
  varying vec3 viewPos;
  varying vec3 vColor;
  varying float vSpecular;
  void main() {
    viewNormal = normalize(normalMatrix * normal);
    viewLight = normalize((viewMatrix * vec4(lightDirection, 0.0)).xyz);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    viewPos = mv.xyz;
    vColor = aColor;
    vSpecular = aSpecular;
    gl_Position = projectionMatrix * mv;
  }
`;

// Bands, rim and specular are copied from CelShader.ts (keep them in step).
const fragment = /* glsl */ `
  uniform vec3 lightColor;
  uniform vec3 ambientColor;
  varying vec3 viewNormal;
  varying vec3 viewLight;
  varying vec3 viewPos;
  varying vec3 vColor;
  varying float vSpecular;
  void main() {
    vec3 n = normalize(viewNormal);
    vec3 l = normalize(viewLight);
    float diffuse = max(dot(n, l), 0.0);
    float band = 0.27 * step(0.25, diffuse) + 0.35 * step(0.65, diffuse);
    float rim = pow(1.0 - max(n.z, 0.0), 3.0) * 0.25;
    vec3 view = normalize(-viewPos);
    float spec = vSpecular > 0.0 ? pow(max(dot(reflect(-l, n), view), 0.0), 22.0) * vSpecular : 0.0;
    vec3 lit = ambientColor * 1.15 + lightColor * band + rim * (lightColor + ambientColor);
    gl_FragColor = vec4(vColor * lit + lightColor * spec, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const outlineVertex = /* glsl */ `
  attribute vec3 outlineNormal;
  uniform float outlineWidth;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * outlineNormal);
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

/** Cel surface material driven by vertex colour + vertex specular (shares celLighting). */
export function createWeaponCelMaterial(): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      lightDirection: celLighting.lightDirection,
      lightColor: celLighting.lightColor,
      ambientColor: celLighting.ambientColor,
    },
    vertexShader: vertex,
    fragmentShader: fragment,
    side: THREE.FrontSide,
  });
  m.name = "weapon-cel";
  return m;
}

/** Inverted-hull ink outline pushed along the welded outline normals. */
export function createWeaponOutlineMaterial(width = WEAPON_OUTLINE_WIDTH): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      inkColor: { value: new THREE.Color(INK_COLOR) },
      outlineWidth: { value: width },
    },
    vertexShader: outlineVertex,
    fragmentShader: outlineFragment,
    side: THREE.BackSide,
  });
  m.name = "weapon-outline";
  return m;
}
