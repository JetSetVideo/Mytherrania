// Toon Lambert (G05, G06): turns three's MeshLambertMaterial — terrain, props, walls — into a cel
// surface that still uses three's own lights, shadow maps and fog. Two patches via onBeforeCompile:
//
//   bands    the direct diffuse is re-quantised: t = lum(directDiffuse) / lum(albedo x key / pi) is
//            the lit fraction (n.l x shadow); t' = sum_i w_i smoothstep(e_i +- fwidth) on TOON_EDGES,
//            and directDiffuse *= t' / t. Cast shadows land as one clean band, like the bodies.
//   detail   optional triplanar procedural texture (lane N recipes baked to a tileable RGBA
//            DataTexture): R modulates albedo around 1 (strength), G adds a secondary pattern tint,
//            B posterises with the bands; sampled in WORLD metres (scale = metres per tile) and
//            blended by |n|^4 so slopes take the side projections.
// The material keeps its program cache key distinct per option set (customProgramCacheKey).
// @deno-types="@types/three"
import * as THREE from "three";

/** Band edges on the lit fraction and the light each band adds (sums to 1 at full light). */
export const TOON_EDGES = [0.08, 0.38, 0.72] as const;
export const TOON_WEIGHTS = [0.42, 0.33, 0.25] as const;

/**
 * Luminance of the key light (colour x intensity) the bands are normalised by, shared by every
 * toon material; the engine writes it once per frame.
 */
export const toonLighting = {
  uToonKey: { value: 1 },
  /** 0..1 frost / settled snow on up-facing surfaces (WorldEvents frost, WorldVars snowCover). */
  uFrost: { value: 0 },
};

export interface ToonOptions {
  /** Tileable RGBA detail texture (lane N bake). */
  detail?: THREE.Texture | null;
  /** World metres per texture tile. */
  detailScale?: number;
  /** 0..1 how strongly R modulates the albedo. */
  detailStrength?: number;
  /** Tint applied where the G channel is high (moss on stone, dry grass on dirt …). */
  detailTint?: THREE.ColorRepresentation;
}

const VERTEX_DECL = /* glsl */ `
varying vec3 vToonWorld;
varying vec3 vToonNormal;
`;
const VERTEX_BODY = /* glsl */ `
vToonWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vToonNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

function fragmentDecl(detail: boolean): string {
  return /* glsl */ `
uniform float uToonKey;
uniform float uFrost;
float frostHash(vec2 i) { return fract(sin(dot(i, vec2(12.9898, 78.233))) * 43758.5453); }
float frostNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(frostHash(i), frostHash(i + vec2(1.0, 0.0)), f.x), mix(frostHash(i + vec2(0.0, 1.0)), frostHash(i + 1.0), f.x), f.y);
}
varying vec3 vToonWorld;
varying vec3 vToonNormal;
${detail ? `
uniform sampler2D uDetail;
uniform float uDetailScale;
uniform float uDetailStrength;
uniform vec3 uDetailTint;
vec4 toonTriplanar(vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= max(w.x + w.y + w.z, 1e-4);
  vec2 s = vec2(1.0 / uDetailScale);
  return texture2D(uDetail, p.zy * s) * w.x + texture2D(uDetail, p.xz * s) * w.y + texture2D(uDetail, p.xy * s) * w.z;
}` : ""}
float toonBands(float t) {
  float w = max(fwidth(t) * 0.75, 0.004);
  return ${TOON_WEIGHTS[0].toFixed(2)} * smoothstep(${TOON_EDGES[0].toFixed(2)} - w, ${TOON_EDGES[0].toFixed(2)} + w, t)
       + ${TOON_WEIGHTS[1].toFixed(2)} * smoothstep(${TOON_EDGES[1].toFixed(2)} - w, ${TOON_EDGES[1].toFixed(2)} + w, t)
       + ${TOON_WEIGHTS[2].toFixed(2)} * smoothstep(${TOON_EDGES[2].toFixed(2)} - w, ${TOON_EDGES[2].toFixed(2)} + w, t);
}
`;
}

const DETAIL_ALBEDO = /* glsl */ `
{
  vec4 dt = toonTriplanar(vToonWorld, normalize(vToonNormal));
  float shade = 1.0 + (dt.r - 0.5) * 2.0 * uDetailStrength;
  shade = floor(shade * 6.0 + 0.5) / 6.0 * 0.6 + shade * 0.4;
  diffuseColor.rgb *= shade;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uDetailTint * 1.6, smoothstep(0.55, 0.8, dt.g) * uDetailStrength * 0.6);
}
`;

/** Frost / settled snow: up-facing surfaces whiten, a noisy edge on slopes (cel-stepped). */
const FROST_ALBEDO = /* glsl */ `
if (uFrost > 0.001) {
  float up = smoothstep(0.35, 0.8, normalize(vToonNormal).y);
  // Two octaves of smooth value noise (blobby drifts, no square cells), cel-stepped with a thin AA edge.
  vec2 p = vToonWorld.xz;
  float n = 0.65 * frostNoise(p * 0.9) + 0.35 * frostNoise(p * 3.7 + 17.0);
  float th = 1.0 - uFrost * up;
  float cover = smoothstep(th - 0.03, th + 0.03, n * (0.55 + 0.45 * up) + 0.25 * up);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.96), cover * 0.85);
}
`;

const BAND_DIRECT = /* glsl */ `
{
  float alb = max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
  float t = dot(reflectedLight.directDiffuse, vec3(0.2126, 0.7152, 0.0722)) / (alb * max(uToonKey, 1e-3) * RECIPROCAL_PI);
  float tq = toonBands(clamp(t, 0.0, 1.2));
  reflectedLight.directDiffuse *= t > 1e-4 ? tq / t : 0.0;
}
`;

/** Make `material` a toon Lambert (idempotent per material). Returns it for chaining. */
export function toonify(material: THREE.MeshLambertMaterial, opts: ToonOptions = {}): THREE.MeshLambertMaterial {
  const detail = opts.detail ?? null;
  const uniforms: Record<string, THREE.IUniform> = { uToonKey: toonLighting.uToonKey, uFrost: toonLighting.uFrost };
  if (detail) {
    uniforms.uDetail = { value: detail };
    uniforms.uDetailScale = { value: opts.detailScale ?? 4 };
    uniforms.uDetailStrength = { value: opts.detailStrength ?? 0.35 };
    uniforms.uDetailTint = { value: new THREE.Color(opts.detailTint ?? "#7fa05a") };
  }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_DECL}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${VERTEX_BODY}`);
    let fs = shader.fragmentShader.replace("#include <common>", `#include <common>\n${fragmentDecl(!!detail)}`);
    fs = fs.replace("#include <color_fragment>", `#include <color_fragment>\n${detail ? DETAIL_ALBEDO : ""}\n${FROST_ALBEDO}`);
    fs = fs.replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n${BAND_DIRECT}`);
    shader.fragmentShader = fs;
  };
  material.customProgramCacheKey = () => `toon-lambert|${detail ? "detail" : "plain"}`;
  material.needsUpdate = true;
  return material;
}
