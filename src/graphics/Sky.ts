// @deno-types="@types/three"
import * as THREE from "three";
import type { EnvironmentState } from "./Environment.ts";

// Procedural sky dome driven entirely by EnvironmentState: Rayleigh-style
// zenith/horizon gradient, Mie glow around the sun, a sun disc, two moon discs,
// a hashed star field fading with the night factor and fbm clouds that drift
// with the place's wind and are tinted by the current sun colour. The fbm is
// the same function as Environment.cloudDensity, so the CPU-side sun occlusion
// (which dims the DirectionalLight) matches what the player sees.

const vertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    p.z = p.w * 0.99999; // just inside the far plane for perspective and orthographic cameras
    gl_Position = p;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uZenith, uHorizon, uSunDir, uSunColor, uMoon1, uMoon2;
  uniform float uTime, uStars, uCover, uWind, uSunVis;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(p.x * 127.1 + p.y * 311.7) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
  }
  float fbm(vec2 p) {
    float v = 0.0, amp = 0.5;
    for (int i = 0; i < 4; i++) { v += amp * vnoise(p); p *= 2.03; amp *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    // Gradient: exponential falloff from horizon to zenith; below the horizon a darker haze.
    float t = 1.0 - exp(-max(h, 0.0) * 3.2);
    vec3 col = mix(uHorizon, uZenith, t);
    col = mix(col, uHorizon * 0.9, smoothstep(0.0, -0.25, h));

    // Sun: Mie forward-scatter halo + hard disc.
    float cs = max(dot(d, uSunDir), 0.0);
    // Halo kept below white so the disc edge stays visible.
    col += uSunColor * (pow(cs, 6.0) * 0.18 + pow(cs, 60.0) * 0.22) * uSunVis;
    float disc = smoothstep(0.99955, 0.99970, cs);
    col = mix(col, vec3(1.0, 0.97, 0.86) * 2.2, disc * uSunVis);

    // Two moons: pale discs, the second smaller and warmer.
    float m1 = smoothstep(0.9975, 0.9980, dot(d, uMoon1)) * step(-0.02, uMoon1.y);
    float m2 = smoothstep(0.9986, 0.9990, dot(d, uMoon2)) * step(-0.02, uMoon2.y);
    col += vec3(0.5, 0.55, 0.7) * pow(max(dot(d, uMoon1), 0.0), 300.0) * 0.25 * uStars;
    col = mix(col, vec3(0.86, 0.90, 1.0), m1 * (0.35 + 0.65 * uStars));
    col = mix(col, vec3(1.0, 0.82, 0.66), m2 * (0.35 + 0.65 * uStars));

    // Stars: hashed cells on a direction grid, twinkling, only above the horizon.
    vec2 sg = vec2(atan(d.z, d.x) * 120.0, d.y * 120.0);
    vec2 sc = floor(sg);
    vec2 sf = fract(sg) - 0.5 - (vec2(hash(sc + 7.0), hash(sc + 13.0)) - 0.5) * 0.6;
    float sr = 0.06 + 0.1 * hash(sc + 21.0);
    float star = step(0.985, hash(sc)) * (1.0 - smoothstep(sr * 0.4, sr, length(sf))) * smoothstep(0.0, 0.15, h);
    star *= 0.6 + 0.4 * sin(uTime * 2.0 + hash(sc + 3.1) * 40.0);
    col += vec3(star) * uStars;

    // Clouds (same projection as Environment.cloudDensity).
    if (h > 0.02) {
      float k = 1.0 / (h + 0.15);
      float n = fbm(vec2(d.x * k * 2.2 + uTime * uWind, d.z * k * 2.2 + uTime * uWind * 0.6));
      float lo = 0.62 - 0.35 * uCover;
      float c = smoothstep(lo, lo + 0.22, n);
      // Lit by the sun colour by day, by the zenith colour at night; silver lining near the sun.
      vec3 lit = mix(uZenith * 1.4 + 0.05, uSunColor * 0.95 + uHorizon * 0.15, uSunVis);
      vec3 cloudCol = lit * (0.72 + 0.22 * n) + uSunColor * pow(cs, 24.0) * 0.28 * uSunVis;
      col = mix(col, cloudCol, c * smoothstep(0.02, 0.06, h) * 0.95);
      // Sun disc punches through thin cloud (attenuated, never erased): a veiled but sharp edge.
      col = mix(col, vec3(1.0, 0.97, 0.86) * 2.0, disc * uSunVis * (1.0 - 0.7 * c));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface SkyRig {
  mesh: THREE.Mesh;
  apply(env: EnvironmentState, time: number): void;
}

export function createSky(radius = 90): SkyRig {
  const uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunColor: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoon1: { value: new THREE.Vector3(0, -1, 0) },
    uMoon2: { value: new THREE.Vector3(0, -1, 0) },
    uTime: { value: 0 },
    uStars: { value: 0 },
    uCover: { value: 0.4 },
    uWind: { value: 0.01 },
    uSunVis: { value: 1 },
  };
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 48, 24),
    new THREE.ShaderMaterial({ uniforms, vertexShader: vertex, fragmentShader: fragment, side: THREE.BackSide, depthWrite: false }),
  );
  mesh.name = "sky";
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return {
    mesh,
    apply(env, time) {
      uniforms.uZenith.value.setRGB(...env.zenith);
      uniforms.uHorizon.value.setRGB(...env.horizon);
      uniforms.uSunColor.value.setRGB(...env.sunColor);
      uniforms.uSunDir.value.set(...env.sun.dir);
      uniforms.uMoon1.value.set(...env.moons[0].dir);
      uniforms.uMoon2.value.set(...env.moons[1].dir);
      uniforms.uTime.value = time;
      uniforms.uStars.value = env.starAlpha;
      uniforms.uCover.value = env.cloudCover;
      uniforms.uWind.value = env.place.wind;
      uniforms.uSunVis.value = Math.max(0, Math.min(1, env.sun.dir[1] * 6 + 0.3));
    },
  };
}
