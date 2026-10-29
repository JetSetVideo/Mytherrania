// GLSL of the post pipeline (wave G: G02 SSAO, G03 GI, G04 ray tracing, G05 ink edges, G10 cloud
// shadows). Every pass works from the SCENE DEPTH TEXTURE alone (no normal pre-pass): view-space
// positions are unprojected from depth and normals are rebuilt from the neighbouring depths, so
// shader-displaced geometry (Gerstner water, wind-blown grass, skinned bodies) is seen exactly as
// drawn and no material needs a second render.
//
// Conventions: `uProj` / `uProjInv` are the camera's projection and its inverse (works for
// perspective AND orthographic cameras); depth 1.0 is the cleared far plane (the sky dome does not
// write depth). The scene target's ALPHA carries a reflectivity mask: opaque materials write 1,
// reflective water writes < 1 (mask = 1 - alpha).
import { CLOUD_GLSL } from "../sky/CloudField.ts";

export const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** Shared helpers: view position from depth, projection, normal rebuild, interleaved noise. */
const COMMON = /* glsl */ `
uniform sampler2D tDepth;
uniform mat4 uProj;
uniform mat4 uProjInv;
uniform vec2 uDepthTexel;
uniform float uOrtho;
varying vec2 vUv;
float rawDepth(vec2 uv) { return texture2D(tDepth, uv).x; }
vec3 viewPosD(vec2 uv, float d) { vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w; }
vec3 viewPos(vec2 uv) { return viewPosD(uv, rawDepth(uv)); }
vec2 projectUv(vec3 p) { vec4 c = uProj * vec4(p, 1.0); return c.xy / c.w * 0.5 + 0.5; }
// Normal from depth: per axis take the neighbour with the smaller depth step, so silhouettes do
// not smear a wrong normal across the edge.
vec3 rebuildNormal(vec2 uv, vec3 p) {
  vec3 pr = viewPos(uv + vec2(uDepthTexel.x, 0.0)), pl = viewPos(uv - vec2(uDepthTexel.x, 0.0));
  vec3 pu = viewPos(uv + vec2(0.0, uDepthTexel.y)), pd = viewPos(uv - vec2(0.0, uDepthTexel.y));
  vec3 dx = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
  vec3 dy = abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd;
  return normalize(cross(dx, dy));
}
float ign(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }
`;

/**
 * Effects pass (reduced resolution): ambient occlusion (Alchemy estimator), one-bounce screen-space
 * GI sharing the AO taps, and ray-marched contact shadows toward the key light.
 * Output: rgb = indirect bounce radiance, a = visibility (AO x contact shadow on the direct share).
 * Defines: AO_SAMPLES (>= 1), USE_GI (0|1), CONTACT_STEPS (0 = off).
 */
export const EFFECTS_FRAGMENT = /* glsl */ `
${COMMON}
uniform sampler2D tScene;
uniform vec3 uLightView;
uniform float uRadius;
uniform float uAoIntensity;
uniform float uDirect;
uniform float uContactLength;
uniform float uFrame;
void main() {
  float d = rawDepth(vUv);
  if (d >= 0.999999) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec3 p = viewPosD(vUv, d);
  vec3 n = rebuildNormal(vUv, p);
  float noise = ign(gl_FragCoord.xy + uFrame * 5.588238);
  float depthScale = uOrtho > 0.5 ? 1.0 : 1.0 / max(-p.z, 0.05);
  vec2 rUv = 0.5 * uRadius * vec2(uProj[0][0], uProj[1][1]) * depthScale;
  float occ = 0.0;
  vec3 gi = vec3(0.0);
  float giW = 0.0;
  for (int i = 0; i < AO_SAMPLES; i++) {
    float fi = float(i);
    float ang = (fi + noise) * 2.39996323 + noise * 6.2831853;
    float rr = sqrt((fi + 0.5) / float(AO_SAMPLES)) * (0.35 + 0.65 * fract(noise + fi * 0.618));
    vec2 suv = vUv + vec2(cos(ang), sin(ang)) * rr * rUv;
    if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) continue;
    float sd = rawDepth(suv);
    if (sd >= 0.999999) continue;
    vec3 v = viewPosD(suv, sd) - p;
    float vv = dot(v, v);
    float vn = dot(v, n);
    float fall = max(0.0, 1.0 - vv / (uRadius * uRadius));
    occ += max(0.0, vn - 0.002 * max(-p.z, 1.0)) / (vv + 0.003) * fall;
    #if USE_GI
      float cosT = max(0.0, vn * inversesqrt(vv + 1e-5));
      gi += texture2D(tScene, suv).rgb * cosT * fall;
      giW += fall;
    #endif
  }
  float ao = clamp(1.0 - 2.0 * uAoIntensity * uRadius * occ / float(AO_SAMPLES) * 0.25, 0.0, 1.0);
  ao = ao * ao;
  float cs = 1.0;
  #if CONTACT_STEPS > 0
    if (dot(n, uLightView) > 0.05) {
      float stepLen = uContactLength / float(CONTACT_STEPS);
      vec3 rp = p + n * 0.015 * max(-p.z, 1.0) * 0.1;
      for (int k = 0; k < CONTACT_STEPS; k++) {
        rp += uLightView * stepLen * (0.75 + 0.5 * noise);
        vec2 ruv = projectUv(rp);
        if (ruv.x < 0.0 || ruv.y < 0.0 || ruv.x > 1.0 || ruv.y > 1.0) break;
        float sd = rawDepth(ruv);
        if (sd >= 0.999999) continue;
        float dz = viewPosD(ruv, sd).z - rp.z;
        if (dz > 0.01 + 0.002 * max(-p.z, 1.0) && dz < 0.45) { cs = 0.0; break; }
      }
    }
  #endif
  float vis = ao * mix(1.0, cs, uDirect);
  gl_FragColor = vec4(giW > 0.0 ? gi / max(giW, 1.0) : vec3(0.0), vis);
}
`;

/** Depth-aware separable blur of the effects buffer (7 taps along uDir). */
export const BLUR_FRAGMENT = /* glsl */ `
${COMMON}
uniform sampler2D tInput;
uniform vec2 uDir;
float linZ(vec2 uv) { return -viewPos(uv).z; }
void main() {
  float zc = linZ(vUv);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = -3; i <= 3; i++) {
    vec2 uv = vUv + uDir * float(i);
    float z = linZ(uv);
    float w = exp(-float(i * i) / 8.0) * exp(-abs(z - zc) / (0.03 * zc + 0.05));
    acc += texture2D(tInput, uv) * w;
    wsum += w;
  }
  gl_FragColor = acc / max(wsum, 1e-4);
}
`;

/**
 * Screen-space ray-traced reflections. A pixel reflects when the scene alpha says so (water) or
 * when it is wet, upward-facing ground (render.wetness). The reflected ray is marched in view space
 * with a growing step, refined by bisection on the first crossing; a miss falls back to the sky
 * gradient. Output: rgb = reflected colour, a = reflection weight (mask x Fresnel x confidence).
 * Define: SSR_STEPS.
 */
export const SSR_FRAGMENT = /* glsl */ `
${COMMON}
uniform sampler2D tScene;
uniform vec3 uViewUp;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform float uWetness;
uniform float uMaxDistance;
void main() {
  float d = rawDepth(vUv);
  if (d >= 0.999999) { gl_FragColor = vec4(0.0); return; }
  float mask = clamp(1.0 - texture2D(tScene, vUv).a, 0.0, 1.0);
  vec3 p = viewPosD(vUv, d);
  vec3 n = rebuildNormal(vUv, p);
  float up = dot(n, uViewUp);
  mask = max(mask, uWetness * smoothstep(0.8, 0.97, up) * 0.55);
  if (mask < 0.01) { gl_FragColor = vec4(0.0); return; }
  vec3 vdir = uOrtho > 0.5 ? vec3(0.0, 0.0, -1.0) : normalize(p);
  vec3 r = normalize(reflect(vdir, n));
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-vdir, n), 0.0), 5.0);
  float stepLen = uMaxDistance / float(SSR_STEPS) * 0.35;
  vec3 rp = p + n * 0.02;
  vec3 prev = rp;
  bool hit = false;
  vec2 huv = vec2(0.0);
  float travelled = 0.0;
  for (int i = 0; i < SSR_STEPS; i++) {
    prev = rp;
    rp += r * stepLen;
    travelled += stepLen;
    stepLen *= 1.08;
    if (rp.z > -0.05 && uOrtho < 0.5) break;
    vec2 uv = projectUv(rp);
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) break;
    float sd = rawDepth(uv);
    if (sd >= 0.999999) continue;
    float dz = viewPosD(uv, sd).z - rp.z;
    if (dz > 0.0 && dz < max(0.25, stepLen * 2.5)) {
      vec3 a = prev, b = rp;
      for (int j = 0; j < 5; j++) {
        vec3 m = 0.5 * (a + b);
        vec2 muv = projectUv(m);
        float mz = viewPos(muv).z - m.z;
        if (mz > 0.0) b = m; else a = m;
      }
      huv = projectUv(b);
      hit = true;
      break;
    }
  }
  float ry = dot(r, uViewUp);
  vec3 sky = mix(uHorizon, uZenith, clamp(ry * 1.6, 0.0, 1.0));
  vec3 col = sky;
  // A miss keeps most of the surface's own shading (water already mirrors the sky and its clouds).
  float conf = 0.0;
  if (hit) {
    vec2 e = smoothstep(0.0, 0.08, huv) * (1.0 - smoothstep(0.92, 1.0, huv));
    conf = e.x * e.y * (1.0 - smoothstep(0.6, 1.0, travelled / uMaxDistance));
    col = mix(sky, texture2D(tScene, huv).rgb, conf);
  }
  gl_FragColor = vec4(col, mask * mix(0.2, 1.0, fres) * mix(0.2, 1.0, conf));
}
`;

/**
 * Composite to the canvas: effects (AO/GI/contact shadows), reflections, cloud shadows, ink edges,
 * grading (exposure, saturation), rain streaks, lightning, then three's tone mapping + output
 * colour space, then a 1/255 dither. Defines: USE_EFFECTS, USE_SSR, USE_INK, CLOUD_OCTAVES.
 */
export const COMPOSITE_FRAGMENT = /* glsl */ `
${COMMON}
uniform sampler2D tScene;
uniform sampler2D tEffects;
uniform sampler2D tSSR;
uniform vec4 uClouds[16];
uniform mat4 uViewInv;
uniform vec3 uSunWorld;
uniform float uCloudShadow;
uniform float uCloudAtOrigin;
uniform float uDirect;
uniform float uGi;
uniform vec3 uInkColor;
uniform float uInk;
uniform float uInkScale;
uniform float uExposure;
uniform float uSaturation;
uniform float uRain;
uniform float uLightning;
uniform float uTime;
uniform vec2 uResolution;
${CLOUD_GLSL}
float edgeZ(vec2 uv) { return -viewPos(uv).z; }
float cloudShadowAt(vec3 world) {
  if (uSunWorld.y <= 0.02) return 0.0;
  float s = 1.0;
  for (int l = 0; l < 2; l++) {
    vec2 uv = cloudSkyUv(l, uSunWorld) + world.xz * (l == 0 ? 1.5 : 2.4) / 120.0;
    s *= 1.0 - cloudPlaneDensity(l, uv) * min(1.0, uClouds[l * 4].w * 1.4);
  }
  return 1.0 - s;
}
void main() {
  vec4 sc = texture2D(tScene, vUv);
  vec3 col = sc.rgb;
  float d = rawDepth(vUv);
  bool sky = d >= 0.999999;
  if (!sky) {
    vec3 p = viewPosD(vUv, d);
    #if USE_EFFECTS
      vec4 fx = texture2D(tEffects, vUv);
      vec3 tint = col / (max(max(col.r, col.g), col.b) + 0.06);
      col = col * fx.a + fx.rgb * tint * uGi;
    #endif
    if (uCloudShadow > 0.0) {
      vec3 world = (uViewInv * vec4(p, 1.0)).xyz;
      float k = uCloudShadow * 0.85;
      float rel = (1.0 - k * cloudShadowAt(world)) / max(0.3, 1.0 - k * uCloudAtOrigin);
      col *= mix(1.0, clamp(rel, 0.25, 1.6), uDirect);
    }
    #if USE_SSR
      vec4 rf = texture2D(tSSR, vUv);
      col = mix(col, rf.rgb, clamp(rf.a, 0.0, 1.0));
    #endif
  }
  #if USE_INK
    // Ink: silhouettes (relative depth gap) and creases (second derivative of 1/z, zero on planes).
    vec2 o = uDepthTexel * uInkScale;
    float zc = edgeZ(vUv), zl = edgeZ(vUv - vec2(o.x, 0.0)), zr = edgeZ(vUv + vec2(o.x, 0.0));
    float zd = edgeZ(vUv - vec2(0.0, o.y)), zu = edgeZ(vUv + vec2(0.0, o.y));
    float zmin = min(zc, min(min(zl, zr), min(zd, zu)));
    float gap = max(max(abs(zl - zc), abs(zr - zc)), max(abs(zu - zc), abs(zd - zc))) / max(zmin, 0.1);
    float ic = 1.0 / max(zc, 1e-3);
    float crease = uOrtho > 0.5
      ? (abs(zl + zr - 2.0 * zc) + abs(zu + zd - 2.0 * zc)) / max(zc, 0.1)
      : (abs(1.0 / max(zl, 1e-3) + 1.0 / max(zr, 1e-3) - 2.0 * ic) + abs(1.0 / max(zu, 1e-3) + 1.0 / max(zd, 1e-3) - 2.0 * ic)) / ic;
    float edge = max(smoothstep(0.035, 0.09, gap), smoothstep(0.02, 0.05, crease) * 0.7);
    edge *= 1.0 - smoothstep(35.0, 110.0, zmin);
    col = mix(col, uInkColor * (0.35 + 0.65 * col), clamp(edge * uInk, 0.0, 1.0));
  #endif
  // Rain: thin slanted streaks falling in screen space (two parallax layers).
  if (uRain > 0.01) {
    vec2 px = vUv * uResolution / max(uResolution.y, 1.0);
    for (int l = 0; l < 2; l++) {
      float s = l == 0 ? 90.0 : 150.0;
      vec2 q = vec2(px.x * s + px.y * s * 0.18, px.y * s * 0.06 + uTime * (l == 0 ? 2.6 : 3.4));
      float colId = floor(q.x);
      float h = cHash(vec2(colId, float(l) * 17.0));
      float drop = fract(q.y + h * 7.0);
      float streak = smoothstep(0.82, 0.98, drop) * (1.0 - smoothstep(0.08, 0.3, abs(fract(q.x) - 0.5)));
      col = mix(col, vec3(0.75, 0.8, 0.88), streak * uRain * (l == 0 ? 0.22 : 0.14) * step(0.45, h));
    }
  }
  col += vec3(0.75, 0.82, 1.0) * uLightning * 0.35;
  col *= uExposure;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(l), col, uSaturation), 0.0);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
}
`;
