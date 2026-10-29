// GLSL for the biome surroundings (lane S). Every material shares the COMMON chunk: one set of
// lighting uniforms (written once per frame by SurroundingsMesh.update) and a cheap value noise.
// Lighting matches three's MeshLambertMaterial (r155+ units): albedo (ambient + sun max(n.l, 0)) / pi,
// where uAmbient = AmbientLight colour x intensity and uSunColor = DirectionalLight colour x intensity,
// so the surroundings sit in the same light as lane E2's Lambert terrain. Fog: three's fog chunks
// (material.fog = true), so everything fades into Engine.#aerialFog's horizon colour.
import { WAVE_GLSL } from "../../world/biomes/Waves.ts";

/** Entries of the rim-radius uniform array (the ring outline sampled by bearing). */
export const RIM_SAMPLES = 64;

/** Shared uniforms + noise + Lambert. */
export const COMMON_GLSL = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec2 uWindDir;
float bHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float bNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = bHash(i), b = bHash(i + vec2(1.0, 0.0)), c = bHash(i + vec2(0.0, 1.0)), d = bHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float bFbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * bNoise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return v / 0.875;
}
vec3 bLambert(vec3 albedo, vec3 n) { return albedo * (uAmbient + uSunColor * max(dot(n, uSunDir), 0.0)) * 0.31830989; }
`;

/** Rim lookup: the ring outline radius at the bearing of p (linear between RIM_SAMPLES entries). */
const RIM_GLSL = /* glsl */ `
uniform float uRimRadius[${RIM_SAMPLES}];
float rimAt(vec2 p) {
  float a = fract(atan(p.y, p.x) / 6.2831853) * ${RIM_SAMPLES}.0;
  int i = int(floor(a));
  int j = i + 1;
  if (j >= ${RIM_SAMPLES}) j = 0;
  return mix(uRimRadius[i], uRimRadius[j], fract(a));
}
`;

const FRAG_END = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
`;

/** Plain world-space vertex shader with normals (terrain, rock, floors). */
export const LIT_VERTEX = /* glsl */ `
${COMMON_GLSL}
attribute vec3 color;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vColor;
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vColor = color;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/** Liquid surface (water and magma): rest grid displaced by the shared Gerstner train. */
export const LIQUID_VERTEX = /* glsl */ `
${COMMON_GLSL}
${WAVE_GLSL}
uniform float uSurfaceY;
varying vec3 vWorld;
varying vec3 vN;
varying float vJac;
varying vec2 vRest;
#include <fog_pars_vertex>
void main() {
  vec2 p0 = position.xz;
  vec3 n;
  vec4 g = gerstner(p0, n);
  vec3 world = vec3(p0.x + g.x, uSurfaceY + g.y, p0.y + g.z);
  vWorld = world; vN = n; vJac = g.w; vRest = p0;
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/** Water: depth tint, ripples, fresnel sky reflection, sun glint, crest + shore foam, optional ice floes. */
export const WATER_FRAGMENT = /* glsl */ `
${COMMON_GLSL}
${RIM_GLSL}
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform float uAgitation;
uniform float uIce;
varying vec3 vWorld;
varying vec3 vN;
varying float vJac;
varying vec2 vRest;
#include <fog_pars_fragment>
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float t = uTime;
  vec2 rp = vWorld.xz * 0.8 - uWindDir * t * 0.9;
  float e = 0.2;
  float h0 = bNoise(rp), hx = bNoise(rp + vec2(e, 0.0)), hz = bNoise(rp + vec2(0.0, e));
  vec2 rq = vWorld.xz * 2.1 + vec2(-uWindDir.y, uWindDir.x) * t * 0.5;
  float g0 = bNoise(rq), gx = bNoise(rq + vec2(e, 0.0)), gz = bNoise(rq + vec2(0.0, e));
  // Visual-only chop (the physics surface is the Gerstner train): even still water keeps faint cat's paws.
  float paws = 0.6 + 0.4 * bNoise(vWorld.xz * 0.05 + uWindDir * t * 0.05);
  float ripple = (0.05 + 0.2 * uAgitation) * paws;
  vec3 N = normalize(vN + vec3(-(hx - h0) - 0.5 * (gx - g0), 0.0, -(hz - h0) - 0.5 * (gz - g0)) * (ripple / e));
  float shore = length(vRest) - rimAt(vRest);
  vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 24.0, shore));
  float ndv = max(dot(N, V), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.35, R.y));
  // Mirror the sky's clouds (a cheap fBm on the reflected ray's plane), so calm water reads as water.
  float cloud = bFbm(R.xz / max(R.y, 0.04) * 1.2 + uWindDir * t * 0.01);
  sky = mix(sky, (uAmbient + uSunColor) * 0.3, smoothstep(0.55, 0.8, cloud) * 0.55 * smoothstep(0.0, 0.08, R.y));
  vec3 col = mix(bLambert(body, vec3(0.0, 1.0, 0.0)), sky, fresnel);
  float glint = pow(max(dot(R, uSunDir), 0.0), mix(500.0, 90.0, uAgitation));
  col += uSunColor * glint * 0.5;
  float breakup = bFbm(vWorld.xz * 0.6 + uWindDir * t * 0.25);
  float crest = smoothstep(0.93, 0.74, vJac);
  float lap = 1.0 - smoothstep(0.0, 0.8 + 2.2 * uAgitation, shore);
  float bands = smoothstep(0.62, 0.95, 0.5 + 0.5 * sin(shore * 2.2 - t * 1.7 + breakup * 5.0))
    * (1.0 - smoothstep(0.0, 2.5 + 6.0 * uAgitation, shore)) * (0.2 + 0.8 * uAgitation);
  float foam = clamp(max(crest, max(lap, bands)) * smoothstep(0.3, 0.62, breakup + 0.3 * lap), 0.0, 1.0);
  col = mix(col, bLambert(uFoam, vec3(0.0, 1.0, 0.0)), foam);
  // Reflectivity mask for the post pipeline's ray-marched reflections: alpha = 1 - mask.
  float reflMask = 0.7 * (1.0 - foam);
  if (uIce > 0.5) {
    float floe = smoothstep(0.6, 0.64, bFbm(vWorld.xz * 0.05 + vec2(3.1, 7.7))) * smoothstep(2.0, 6.0, shore);
    vec3 ice = bLambert(vec3(0.72, 0.84, 0.92), normalize(vN + vec3(0.0, 2.0, 0.0)));
    col = mix(col, ice, floe);
    reflMask *= 1.0 - floe;
  }
  gl_FragColor = vec4(col, 1.0 - reflMask);
  ${FRAG_END}
}
`;

/** Magma: dark crust plates drifting on glowing melt; the glow is a colour, not additive, so it reads in daylight. */
export const MAGMA_FRAGMENT = /* glsl */ `
${COMMON_GLSL}
${RIM_GLSL}
uniform vec3 uCrust;
uniform vec3 uLava;
uniform vec3 uHot;
varying vec3 vWorld;
varying vec3 vN;
varying float vJac;
varying vec2 vRest;
#include <fog_pars_fragment>
void main() {
  vec2 p = vWorld.xz;
  vec2 flow = uWindDir * uTime * 0.35;
  vec2 q = vec2(bFbm(p * 0.045 + flow * 0.02), bFbm(p * 0.045 + vec2(5.2, 1.3) - flow * 0.015));
  float n = bFbm(p * 0.08 + q * 2.2 + flow * 0.05);
  float cells = bFbm(p * 0.14 + q * 1.4 - flow * 0.03);
  float crack = 1.0 - smoothstep(0.012, 0.06, abs(cells - 0.5));
  float pool = smoothstep(0.6, 0.72, n);
  float shore = length(vRest) - rimAt(vRest);
  float shoreHeat = 1.0 - smoothstep(0.0, 2.5, shore);
  float pulse = 0.78 + 0.22 * sin(uTime * 1.3 + n * 9.0);
  float heat = clamp(max(max(crack * 0.95, pool), shoreHeat * 0.85) * pulse + smoothstep(0.97, 0.88, vJac) * 0.4, 0.0, 1.0);
  vec3 crust = bLambert(uCrust * (0.6 + 0.8 * n), vN) + uLava * 0.18 * (1.0 - smoothstep(0.0, 0.12, abs(cells - 0.5)));
  vec3 lava = mix(uLava, uHot, heat * heat) * (0.75 + 0.5 * heat);
  vec3 col = mix(crust, lava, smoothstep(0.12, 0.55, heat));
  gl_FragColor = vec4(col, 1.0);
  ${FRAG_END}
}
`;

/** Far ground (meadow / hills): two-scale colour variation, rock on steep slopes. */
export const GROUND_FRAGMENT = /* glsl */ `
${COMMON_GLSL}
uniform vec3 uBase;
uniform vec3 uAlt;
uniform vec3 uRock;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vColor;
#include <fog_pars_fragment>
void main() {
  vec3 N = normalize(vN);
  float macro = bFbm(vWorld.xz * 0.018);
  float micro = bNoise(vWorld.xz * 0.4);
  vec3 albedo = mix(uBase, uAlt, smoothstep(0.4, 0.75, macro)) * (0.85 + 0.3 * micro);
  albedo = mix(albedo, uRock * (0.8 + 0.4 * micro), smoothstep(0.86, 0.7, N.y));
  gl_FragColor = vec4(bLambert(albedo * vColor, N), 1.0);
  ${FRAG_END}
}
`;

/** Rock column / floating island / trunk / cliff: vertex-coloured Lambert plus an optional magma glow from below. */
export const ROCK_FRAGMENT = /* glsl */ `
${COMMON_GLSL}
uniform vec3 uGlowColor;
uniform float uGlowY;
uniform float uGlow;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vColor;
#include <fog_pars_fragment>
void main() {
  vec3 N = normalize(vN);
  float grain = bNoise(vec2(atan(vWorld.z, vWorld.x) * 40.0, vWorld.y * 1.5));
  vec3 col = bLambert(vColor * (0.8 + 0.4 * grain), N);
  col += uGlowColor * uGlow * exp(-max(vWorld.y - uGlowY, 0.0) / 2.5);
  gl_FragColor = vec4(col, 1.0);
  ${FRAG_END}
}
`;

/** Grass tufts: instanced blades swaying downwind (vertex shader only; no CPU rebuild). */
export const GRASS_VERTEX = /* glsl */ `
${COMMON_GLSL}
uniform float uWind;
attribute vec4 aOffset;
varying float vH;
varying float vTint;
#include <fog_pars_vertex>
void main() {
  float h = position.y;
  float rot = bHash(aOffset.xz) * 6.2831853;
  float c = cos(rot), s = sin(rot);
  vec3 p = vec3(c * position.x - s * position.z, position.y, s * position.x + c * position.z) * aOffset.w;
  float phase = dot(aOffset.xz, uWindDir) * 0.35 - uTime * (1.6 + 1.6 * uWind);
  float sway = (0.06 + 0.4 * uWind) * h * h * aOffset.w * (0.65 + 0.35 * sin(phase) + 0.2 * sin(phase * 2.7 + 1.3));
  p.xz += uWindDir * sway;
  p.y -= 0.5 * sway * sway / max(aOffset.w, 0.01);
  vH = h;
  vTint = bHash(aOffset.zx + 3.1);
  vec4 mvPosition = viewMatrix * vec4(aOffset.xyz + p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const GRASS_FRAGMENT = /* glsl */ `
${COMMON_GLSL}
uniform vec3 uGrassBase;
uniform vec3 uGrassTip;
varying float vH;
varying float vTint;
#include <fog_pars_fragment>
void main() {
  vec3 albedo = mix(uGrassBase, uGrassTip, vH) * (0.75 + 0.5 * vTint);
  vec3 col = bLambert(albedo, vec3(0.0, 1.0, 0.0)) * (0.55 + 0.45 * vH);
  gl_FragColor = vec4(col, 1.0);
  ${FRAG_END}
}
`;

/** Instanced lumpy blobs: tree crowns, cloud puffs, shrubs, boulders, debris. aBlob = (x, z, radius, topY). */
export const BLOB_VERTEX = /* glsl */ `
${COMMON_GLSL}
uniform float uSquash;
uniform float uLump;
uniform float uSway;
attribute vec4 aBlob;
varying vec3 vWorld;
varying vec3 vN;
varying float vLocalY;
varying float vTint;
#include <fog_pars_vertex>
void main() {
  vec3 p = normalize(position);
  float lump = 1.0 + uLump * ((bNoise(p.xz * 2.5 + aBlob.xy * 0.37) - 0.5) + 0.5 * (bNoise(p.xy * 4.0 + aBlob.yx * 0.21) - 0.5));
  float r = aBlob.z;
  vec3 centre = vec3(aBlob.x, aBlob.w - r * uSquash, aBlob.y);
  vec3 world = centre + vec3(p.x * r, p.y * r * uSquash, p.z * r) * lump;
  world.xz += uWindDir * uSway * r * max(p.y, 0.0) * sin(uTime * 0.9 + aBlob.x * 0.13 + aBlob.y * 0.07);
  vWorld = world;
  vN = normalize(p * vec3(1.0, 1.0 / max(uSquash, 0.05), 1.0));
  vLocalY = p.y;
  vTint = bHash(aBlob.xy * 0.71);
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/** Blob shading: wrap lighting (soft volumes), darker underside, per-instance tint between two colours. */
export const BLOB_FRAGMENT = /* glsl */ `
${COMMON_GLSL}
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uWrap;
uniform float uUnderside;
uniform float uSoftEdge;
varying vec3 vWorld;
varying vec3 vN;
varying float vLocalY;
varying float vTint;
#include <fog_pars_fragment>
void main() {
  vec3 N = normalize(vN);
  float speck = bNoise(vWorld.xz * 0.9 + vWorld.y * 0.7);
  vec3 albedo = mix(uColorA, uColorB, clamp(vTint * 0.6 + 0.4 * speck, 0.0, 1.0));
  albedo *= mix(1.0 - uUnderside, 1.0, smoothstep(-0.6, 0.7, vLocalY));
  float ndl = max((dot(N, uSunDir) + uWrap) / (1.0 + uWrap), 0.0);
  vec3 col = albedo * (uAmbient + uSunColor * ndl) * 0.31830989;
  // Soft silhouettes (cloud puffs): fade where the surface turns away from the viewer.
  float facing = abs(dot(N, normalize(cameraPosition - vWorld)));
  float alpha = uSoftEdge > 0.0 ? smoothstep(0.0, uSoftEdge, facing) : 1.0;
  gl_FragColor = vec4(col, alpha);
  ${FRAG_END}
}
`;

/** Tree trunks: instanced open cylinders from the forest floor up to each crown. */
export const TRUNK_VERTEX = /* glsl */ `
${COMMON_GLSL}
uniform float uGroundY;
uniform float uSquash;
attribute vec4 aBlob;
varying vec3 vWorld;
varying vec3 vN;
varying float vLocalY;
varying float vTint;
#include <fog_pars_vertex>
void main() {
  float top = aBlob.w - aBlob.z * uSquash;
  float radius = 0.09 * aBlob.z * (1.25 - 0.4 * position.y);
  vec3 world = vec3(aBlob.x + position.x * radius, mix(uGroundY, top, position.y), aBlob.y + position.z * radius);
  vWorld = world;
  vN = normalize(vec3(position.x, 0.0, position.z));
  vLocalY = position.y * 2.0 - 1.0;
  vTint = bHash(aBlob.xy);
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/**
 * Cloud sea floor: the rest grid lifted into billows by a drifting fBm height (uBillow m, fading
 * out past 150 m where the grid is coarse), normals from the same function. Visual only: clouds
 * carry no physics (surfaceAt is NaN), so the CPU never needs this height.
 */
export const CLOUD_VERTEX = /* glsl */ `
${COMMON_GLSL}
attribute vec3 color;
uniform float uBillow;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vColor;
#include <fog_pars_vertex>
float cloudHeight(vec2 xz) {
  vec2 p = xz * 0.022 - uWindDir * uTime * 0.012;
  return max((bFbm(p) - 0.45) * 2.0, -0.3);
}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  float lift = uBillow * (1.0 - smoothstep(150.0, 300.0, length(w.xz)));
  float e = 1.5;
  float h = cloudHeight(w.xz);
  float hx = cloudHeight(w.xz + vec2(e, 0.0));
  float hz = cloudHeight(w.xz + vec2(0.0, e));
  w.y += lift * h;
  vN = normalize(vec3(-(hx - h) * lift / e, 1.0, -(hz - h) * lift / e));
  vWorld = w.xyz;
  vColor = color;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/** Cloud sea: billowed opaque floor (white heads, blue-grey shade) or a translucent drifting wisp layer. */
export const CLOUD_FRAGMENT = /* glsl */ `
${COMMON_GLSL}
uniform vec3 uLit;
uniform vec3 uShade;
uniform float uCover;
uniform float uTop;
uniform float uOpaque;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vColor;
#include <fog_pars_fragment>
void main() {
  vec3 N = normalize(vN);
  vec2 p = vWorld.xz * 0.016 - uWindDir * uTime * 0.012;
  float fine = bNoise(p * 5.0 - uWindDir * uTime * 0.03);
  vec3 light = (uAmbient + uSunColor * 0.85) * 0.31830989 * 1.15;
  vec3 col;
  float alpha = 1.0;
  if (uOpaque > 0.5) {
    float wrapL = clamp((dot(N, uSunDir) + 0.6) / 1.6, 0.0, 1.0);
    float head = smoothstep(uTop - 4.0, uTop + 0.5, vWorld.y);
    col = mix(uShade, uLit, clamp(0.3 + 0.5 * wrapL + 0.35 * head + 0.1 * (fine - 0.5), 0.0, 1.0)) * light;
  } else {
    float n = bFbm(p + vec2(3.7, 1.9));
    float d = smoothstep(1.0 - uCover - 0.12, 1.0 - uCover + 0.22, 0.85 * n + 0.15 * fine);
    alpha = smoothstep(0.0, 0.7, d) * 0.75;
    col = mix(uShade, uLit, 0.6 + 0.4 * d) * light;
  }
  gl_FragColor = vec4(col, alpha);
  ${FRAG_END}
}
`;

/** Canopy carpet beyond the instanced crowns: crown domes faked by a noise height and its gradient. */
export const CARPET_FRAGMENT = /* glsl */ `
${COMMON_GLSL}
uniform vec3 uColorA;
uniform vec3 uColorB;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vColor;
#include <fog_pars_fragment>
void main() {
  vec2 p = vWorld.xz / 7.0;
  float e = 0.08;
  float h0 = bNoise(p), hx = bNoise(p + vec2(e, 0.0)), hz = bNoise(p + vec2(0.0, e));
  vec3 N = normalize(vec3(-(hx - h0) / e * 1.6, 1.0, -(hz - h0) / e * 1.6));
  vec3 albedo = mix(uColorA, uColorB, clamp(0.25 + 0.75 * h0 * bNoise(p * 0.21 + 4.0) * 1.4, 0.0, 1.0));
  albedo *= 0.3 + 0.7 * smoothstep(0.25, 0.75, h0);
  gl_FragColor = vec4(bLambert(albedo, N), 1.0);
  ${FRAG_END}
}
`;

/** The abyss under a void arena: horizon colour at the rim fading to near-black at the nadir (no fog). */
export const ABYSS_FRAGMENT = /* glsl */ `
${COMMON_GLSL}
uniform vec3 uNadir;
uniform vec3 uCentre;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vColor;
void main() {
  vec3 d = normalize(vWorld - uCentre);
  float down = clamp(-d.y, 0.0, 1.0);
  // Darkness closes in a few degrees below the horizon; faint motes twinkle in the deep.
  vec3 col = mix(uHorizon, uNadir, smoothstep(0.0, 0.025, down));
  vec2 cell = floor(vec2(atan(d.z, d.x) * 90.0, down * 160.0));
  float mote = step(0.992, bHash(cell)) * smoothstep(0.15, 0.5, down) * (0.6 + 0.4 * sin(uTime * 2.0 + bHash(cell + 7.0) * 30.0));
  col += vec3(0.55, 0.5, 0.8) * mote * 0.5;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
