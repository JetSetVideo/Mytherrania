// @deno-types="@types/three"
import * as THREE from "three";
import type { EnvironmentState } from "./Environment.ts";
import type { MoonState, Vec3 } from "../world/climate/contracts.ts";
import { CLOUD_GLSL } from "./sky/CloudField.ts";

// Procedural sky dome (G11 skybox, G13 moons, G14 clouds). Driven by EnvironmentState (sun, sky
// colours) plus the climate frame (moons, cloud layers, rain, lightning):
//   gradient   horizon -> zenith on 1 - exp(-k h), k falling with turbidity (hazy skies keep a
//              wide pale band); a Mie halo around the sun whose width grows with turbidity.
//   sun        limb-darkened disc I = 1 - 0.6 (1 - sqrt(1 - r^2)), veiled (never erased) by cloud.
//   moons      two lit spheres: the terminator is drawn from each moon's PHASE (light vector
//              L = (sin phi, 0, -cos phi) in the disc frame, phi = 2 pi phase), two cel bands, maria
//              from noise, earthshine on the dark side, coloured by the moon's sky colour (redder
//              near the horizon, from the climate model), with a halo.
//   clouds     four layers (CloudField): high -> mid -> low planes, then the towering cumulonimbus
//              wall; each is CEL-SHADED: light = thickness toward the sun, quantised into the
//              type's bands with anti-aliased steps, a silver lining near the sun, a soft ink rim.
//   weather    rain greys and veils the horizon; lightning lights the clouds near the strike and
//              draws a jagged bolt; stars fade under cloud.

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
  uniform vec3 uZenith, uHorizon, uSunDir, uSunColor;
  uniform float uTime, uStars, uSunVis, uTurbidity, uRain, uFog, uLightning;
  uniform vec3 uLightningDir;
  uniform vec3 uMoonDir[2];
  uniform vec3 uMoonColor[2];
  uniform vec4 uMoonParam[2]; // phase angle (rad), angular radius (rad), brightness, illumination
  uniform vec4 uClouds[16];
  // Situational events (WorldEvents): rainbow, 22-deg halo around uHaloDir, star boost, moon glow.
  uniform float uRainbow, uHalo, uStarBoost, uMoonGlow;
  uniform vec3 uHaloDir;
  varying vec3 vDir;
  ${CLOUD_GLSL}

  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  // Spectral ramp, t = 0 violet .. 1 red (a cel-friendly 6-hue approximation of the visible band).
  vec3 spectrum(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 c = clamp(vec3(abs(t * 6.0 - 4.5) - 1.0, 2.0 - abs(t * 6.0 - 3.0), 2.0 - abs(t * 6.0 - 1.5)), 0.0, 1.0);
    return mix(c, vec3(0.6, 0.2, 1.0), smoothstep(0.12, 0.0, t));
  }
  // Rainbow around the antisolar point A = -sunDir: primary bow at 40.6..42.4 deg (violet inside,
  // red outside), secondary at 50.4..53.5 deg with the order reversed and ~40 % as bright; the sky
  // INSIDE the primary is brighter (Alexander's band outside is darker). Theta in radians.
  vec3 rainbow(vec3 d, float h) {
    float th = acos(clamp(dot(d, -uSunDir), -1.0, 1.0));
    float p = (th - 0.7086) / (0.7400 - 0.7086);
    float s = (th - 0.8796) / (0.9337 - 0.8796);
    float pw = smoothstep(-0.15, 0.1, p) * (1.0 - smoothstep(0.9, 1.15, p));
    float sw = smoothstep(-0.15, 0.1, s) * (1.0 - smoothstep(0.9, 1.15, s));
    vec3 c = spectrum(p) * pw + spectrum(1.0 - s) * sw * 0.4;
    c += vec3(0.08) * (1.0 - smoothstep(0.66, 0.72, th));            // bright inside the bow
    c -= vec3(0.05) * smoothstep(0.74, 0.76, th) * (1.0 - smoothstep(0.86, 0.88, th)); // Alexander's dark band
    return c * smoothstep(0.0, 0.06, h);
  }

  // One moon: returns premultiplied colour in rgb and coverage in a.
  vec4 moon(vec3 d, vec3 m, vec3 tint, vec4 prm, float seed) {
    float r = prm.y;
    vec3 right = normalize(cross(m, abs(m.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, m);
    vec3 o = d - m * dot(d, m);
    float x = dot(o, right) / r, y = dot(o, up) / r;
    float r2 = x * x + y * y;
    float facing = step(0.0, dot(d, m));
    float aa = 2.5 * fwidth(sqrt(r2)) + 1e-4;
    float cover = (1.0 - smoothstep(1.0 - aa, 1.0, sqrt(r2))) * facing * step(-0.03, m.y);
    if (cover <= 0.0) return vec4(0.0);
    float z = sqrt(max(0.0, 1.0 - r2));
    vec3 L = vec3(sin(prm.x), 0.0, -cos(prm.x));
    float ndl = dot(vec3(x, y, z), L);
    float lit = smoothstep(-0.04, 0.04, ndl) * (0.78 + 0.22 * smoothstep(0.35, 0.45, ndl));
    float maria = smoothstep(0.52, 0.66, cNoise(vec2(x, y) * 2.3 + seed));
    float albedo = 0.92 - 0.28 * maria;
    // Kept below 1 so tone mapping does not bleach the moon's own hue (amber Vesh stays amber).
    vec3 sat = max(mix(vec3(lum(tint)), tint, 1.7), 0.0);
    vec3 c = sat * albedo * (lit * (0.62 + 0.25 * prm.z) + 0.035);
    return vec4(c * cover, cover);
  }

  vec3 celCloud(float dens, float toward, float bands, vec4 A, vec3 d, float cs) {
    // light: denser toward the sun = more self-shadow; thick types darken overall. The self-shadow
    // term fades as the sky closes over (no direct sun to cast it) and storm bases (darkness) sink.
    float direct = uSunVis * (1.0 - 0.8 * A.z);
    float l = clamp(0.66 + (dens - toward) * 2.4 * direct - A.w * 0.3 * dens - 0.45 * A.z, 0.0, 1.0);
    float fb = l * bands;
    float lq = (floor(fb) + smoothstep(0.42, 0.58, fract(fb))) / bands;
    float day = uSunVis;
    vec3 moonLit = (uMoonColor[0] * uMoonParam[0].z + uMoonColor[1] * uMoonParam[1].z) * 0.35;
    vec3 lit = mix(moonLit + uZenith * 0.6 + 0.02, uSunColor * 1.02 + uHorizon * 0.12, day);
    vec3 shade = mix(uZenith * 0.75 + uHorizon * 0.25, vec3(lum(uHorizon)) * 0.9, 0.35) * mix(0.55, 0.75, day);
    shade *= 1.0 - 0.72 * A.z;
    lit *= 1.0 - 0.62 * A.z;
    vec3 c = mix(shade, lit, lq);
    c += uSunColor * pow(cs, 14.0) * (1.0 - smoothstep(0.1, 0.6, dens)) * 0.75 * day;
    float flash = uLightning * (0.25 + 0.75 * pow(max(dot(d, uLightningDir), 0.0), 8.0));
    c += vec3(0.82, 0.86, 1.0) * flash * 1.6;
    return c;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float hz = max(h, 0.0);
    float turb = clamp((uTurbidity - 1.0) / 9.0, 0.0, 1.0);
    float k = mix(4.2, 1.6, turb);
    vec3 col = mix(uHorizon, uZenith, 1.0 - exp(-hz * k));
    col = mix(col, uHorizon * 0.85, smoothstep(0.0, -0.25, h));
    float cs = max(dot(d, uSunDir), 0.0);
    float mieW = mix(10.0, 3.0, turb);
    col += uSunColor * (pow(cs, mieW) * mix(0.12, 0.3, turb) + pow(cs, 64.0) * 0.22) * uSunVis;

    // Stars.
    vec2 sg = vec2(atan(d.z, d.x) * 120.0, d.y * 120.0);
    vec2 sc = floor(sg);
    vec2 sf = fract(sg) - 0.5 - (vec2(cHash(sc + 7.0), cHash(sc + 13.0)) - 0.5) * 0.6;
    float sr = 0.06 + 0.1 * cHash(sc + 21.0);
    float star = step(0.985, cHash(sc)) * (1.0 - smoothstep(sr * 0.4, sr, length(sf))) * smoothstep(0.0, 0.15, h);
    star *= 0.6 + 0.4 * sin(uTime * 2.0 + cHash(sc + 3.1) * 40.0);
    col += vec3(star) * uStars * (1.0 + 0.9 * uStarBoost);

    // Sun disc, limb-darkened.
    float sunR = 0.022;
    float sd = length(d - uSunDir) / sunR;
    float disc = (1.0 - smoothstep(0.92, 1.0, sd)) * step(0.0, dot(d, uSunDir));
    float limb = 1.0 - 0.6 * (1.0 - sqrt(max(0.0, 1.0 - min(sd, 1.0) * min(sd, 1.0))));
    vec3 sunDisc = mix(uSunColor, vec3(1.0, 0.97, 0.88), 0.6) * 2.4 * limb;
    col = mix(col, sunDisc, disc * uSunVis);

    // Moons and their halos (behind the clouds).
    for (int i = 0; i < 2; i++) {
      vec3 m = uMoonDir[i];
      vec4 prm = uMoonParam[i];
      col += uMoonColor[i] * pow(max(dot(d, m), 0.0), 900.0 * (0.02 / max(prm.y, 0.004)) / (1.0 + 2.0 * uMoonGlow)) * (0.12 + 0.2 * uMoonGlow) * prm.w * step(-0.03, m.y);
      vec4 mc = moon(d, m, uMoonColor[i], prm, float(i) * 13.7);
      col = col * (1.0 - mc.a) + mc.rgb;
    }

    // Lightning bolt: a jagged line from the storm's base down to the horizon at the strike azimuth.
    if (uLightning > 0.25) {
      vec3 L = normalize(vec3(uLightningDir.x, 0.0, uLightningDir.z));
      vec3 side = normalize(cross(L, vec3(0.0, 1.0, 0.0)));
      float x = dot(d, side);
      float y = h;
      float top = max(uLightningDir.y, 0.05);
      float seed = floor(uTime * 7.0);
      float path = (cNoise(vec2(y * 9.0, seed)) - 0.5) * 0.08 + (cNoise(vec2(y * 37.0, seed + 3.0)) - 0.5) * 0.02;
      float inBand = step(0.0, y) * (1.0 - smoothstep(top - 0.01, top, y)) * step(0.0, dot(d, L));
      float bolt = exp(-abs(x - path) / 0.0022) * inBand;
      col += vec3(0.9, 0.93, 1.0) * bolt * uLightning * 3.0;
    }

    // Clouds: high -> mid -> low planes, then the towering wall in front.
    if (h > -0.02) {
      float fade = smoothstep(0.0, 0.05, h);
      for (int l = 2; l >= 0; l--) {
        vec4 A = uClouds[l * 4];
        vec4 T = uClouds[l * 4 + 3];
        if (T.w < 0.5) continue;
        vec2 uv = cloudSkyUv(l, d);
        float dens = cloudPlaneDensity(l, uv);
        if (dens < 0.002) continue;
        float toward = cloudPlaneDensity(l, uv + normalize(uSunDir.xz + 1e-4) * 0.07);
        vec3 cc = celCloud(dens, toward, T.y, A, d, cs);
        // Ink rim on the cloud's OUTER edge only (where sky shows through), and only on heaped types;
        // full-cover sheets draw none, so an overcast deck never turns into a mosaic of outlines.
        float edge = dens / max(A.y, 0.01);
        float rim = smoothstep(0.08, 0.16, edge) * (1.0 - smoothstep(0.18, 0.3, edge));
        rim *= smoothstep(0.3, 0.7, uClouds[l * 4 + 2].y) * (1.0 - smoothstep(0.55, 0.85, A.x));
        cc = mix(cc, cc * 0.7, rim * 0.6);
        float alpha = clamp(dens * mix(0.8, 1.15, A.w), 0.0, 1.0) * fade;
        col = mix(col, cc, alpha);
        col = mix(col, sunDisc, disc * uSunVis * (1.0 - min(1.0, A.w * 1.4 * dens)) * alpha * 0.85);
      }
      vec4 TA = uClouds[12];
      if (uClouds[15].w > 0.5) {
        float dens = cloudToweringDensity(d);
        if (dens > 0.002) {
          float toward = cloudToweringDensity(normalize(d + uSunDir * 0.06));
          vec3 cc = celCloud(dens, toward, uClouds[15].y, TA, d, cs);
          // Vertical development: a near-black rain base, lit flanks, a bright anvil top.
          float top = mix(0.18, 0.55, TA.x);
          cc *= mix(0.4, 1.15, smoothstep(0.0, top, h));
          float edge = dens / max(TA.y, 0.01);
          float rim = smoothstep(0.08, 0.16, edge) * (1.0 - smoothstep(0.18, 0.3, edge));
          cc = mix(cc, cc * 0.65, rim * 0.5);
          col = mix(col, cc, clamp(dens * 1.1, 0.0, 1.0));
        }
      }
    }

    // Events drawn in front of the cloud deck (light phenomena happen in the rain / ice in front).
    // The bow both adds its spectrum and tints the sky behind it (a readable cel bow, not a ghost).
    if (uRainbow > 0.001) {
      vec3 rb = rainbow(d, h) * uRainbow;
      col = col * (1.0 + 0.9 * rb) + rb * 0.22;
    }
    if (uHalo > 0.001) {
      float ha = acos(clamp(dot(d, uHaloDir), -1.0, 1.0));
      // Ice-crystal minimum deviation: sharp red inner edge at 21.6 deg, white body fading out to ~24 deg,
      // and the sky INSIDE the ring darker (no light is refracted below the minimum deviation).
      float vis = uHalo * step(0.0, uHaloDir.y + 0.05);
      float inner = exp(-pow((ha - 0.3770) / 0.0045, 2.0));
      float body = smoothstep(0.372, 0.381, ha) * exp(-max(ha - 0.381, 0.0) / 0.022);
      col *= 1.0 - 0.12 * vis * (1.0 - smoothstep(0.30, 0.375, ha)) * smoothstep(0.02, 0.06, ha);
      col += (vec3(0.95, 0.42, 0.18) * inner * 0.5 + vec3(0.92, 0.95, 1.0) * body * 0.4) * vis;
    }
    // Weather veils: rain greys the sky and thickens the horizon; fog lifts the horizon colour.
    col = mix(col, vec3(lum(col)) * 0.75, uRain * 0.55);
    col = mix(col, mix(uHorizon, vec3(lum(uHorizon)), 0.4) * 0.8, uRain * (1.0 - smoothstep(0.0, 0.3, h)) * 0.6);
    col = mix(col, uHorizon, uFog * (1.0 - smoothstep(-0.05, 0.35, h)) * 0.8);
    col += vec3(0.6, 0.66, 0.8) * uLightning * 0.18;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Climate-side inputs of the sky (all optional: a missing climate keeps the clear default). */
/** Event-driven sky layers (WorldEvents effects), all 0..1. */
export interface SkyEvents {
  rainbow: number;
  halo: number;
  haloDir: Vec3;
  stars: number;
  moonGlow: number;
}

export interface SkyInputs {
  /** CloudField.packCloudLayers output (64 floats). */
  clouds: Float32Array;
  moons: readonly MoonState[];
  turbidity: number;
  rain: number;
  fog: number;
  lightning: number;
  lightningDir: Vec3;
  events?: SkyEvents;
}

/**
 * Moons are drawn larger than their angular size (Ilun 0.6 deg, Vesh 0.32 deg): at a 50 deg field of
 * view a 0.6 deg disc is ~12 px across, too small to read a phase. x2.4 -> ~30 px / ~16 px radius.
 */
export const MOON_DISPLAY_SCALE = 2.4;

export interface SkyRig {
  mesh: THREE.Mesh;
  apply(env: EnvironmentState, time: number, inputs?: SkyInputs): void;
  /** Rebuild the dome for a new polygon budget / octave count (quality change). */
  setDetail(segments: number, octaves: number): void;
}

export interface SkyOptions { radius?: number; segments?: number; octaves?: number }

function skyMaterial(uniforms: Record<string, THREE.IUniform>, octaves: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms, vertexShader: vertex, fragmentShader: fragment, side: THREE.BackSide, depthWrite: false,
    defines: { CLOUD_OCTAVES: Math.max(2, Math.min(5, Math.round(octaves))) },
  });
}

export function createSky(opts: SkyOptions = {}): SkyRig {
  const radius = opts.radius ?? 90;
  const uniforms: Record<string, THREE.IUniform> = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunColor: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uTime: { value: 0 },
    uStars: { value: 0 },
    uSunVis: { value: 1 },
    uTurbidity: { value: 2.5 },
    uRain: { value: 0 },
    uFog: { value: 0 },
    uLightning: { value: 0 },
    uLightningDir: { value: new THREE.Vector3(1, 0.2, 0).normalize() },
    uMoonDir: { value: [new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -1, 0)] },
    uMoonColor: { value: [new THREE.Color(0.86, 0.9, 1), new THREE.Color(1, 0.82, 0.66)] },
    uMoonParam: { value: [new THREE.Vector4(Math.PI, 0.03, 0.5, 1), new THREE.Vector4(Math.PI, 0.02, 0.3, 1)] },
    uClouds: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) },
    uRainbow: { value: 0 },
    uHalo: { value: 0 },
    uHaloDir: { value: new THREE.Vector3(0, 1, 0) },
    uStarBoost: { value: 0 },
    uMoonGlow: { value: 0 },
  };
  const segments = opts.segments ?? 64;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, Math.max(12, segments >> 1)), skyMaterial(uniforms, opts.octaves ?? 4));
  mesh.name = "sky";
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  let detail = `${segments}/${opts.octaves ?? 4}`;
  return {
    mesh,
    setDetail(seg, oct) {
      const key = `${seg}/${oct}`;
      if (key === detail) return;
      detail = key;
      mesh.geometry.dispose();
      mesh.geometry = new THREE.SphereGeometry(radius, seg, Math.max(12, seg >> 1));
      (mesh.material as THREE.Material).dispose();
      mesh.material = skyMaterial(uniforms, oct);
    },
    apply(env, time, inputs) {
      (uniforms.uZenith.value as THREE.Color).setRGB(...env.zenith);
      (uniforms.uHorizon.value as THREE.Color).setRGB(...env.horizon);
      (uniforms.uSunColor.value as THREE.Color).setRGB(...env.sunColor);
      (uniforms.uSunDir.value as THREE.Vector3).set(...env.sun.dir);
      uniforms.uTime.value = time % 3600;
      uniforms.uSunVis.value = Math.max(0, Math.min(1, env.sun.dir[1] * 6 + 0.3));
      const dirs = uniforms.uMoonDir.value as THREE.Vector3[];
      const cols = uniforms.uMoonColor.value as THREE.Color[];
      const prms = uniforms.uMoonParam.value as THREE.Vector4[];
      if (inputs) {
        const cv = uniforms.uClouds.value as THREE.Vector4[];
        for (let i = 0; i < 16; i++) cv[i].fromArray(inputs.clouds, i * 4);
        uniforms.uTurbidity.value = inputs.turbidity;
        uniforms.uRain.value = inputs.rain;
        uniforms.uFog.value = inputs.fog;
        uniforms.uLightning.value = inputs.lightning;
        const ev = inputs.events;
        uniforms.uRainbow.value = ev?.rainbow ?? 0;
        uniforms.uHalo.value = ev?.halo ?? 0;
        if (ev) (uniforms.uHaloDir.value as THREE.Vector3).set(...ev.haloDir);
        uniforms.uStarBoost.value = ev?.stars ?? 0;
        uniforms.uMoonGlow.value = ev?.moonGlow ?? 0;
        (uniforms.uLightningDir.value as THREE.Vector3).set(...inputs.lightningDir);
        let cover = 0;
        for (let l = 0; l < 4; l++) cover = 1 - (1 - cover) * (1 - inputs.clouds[l * 16] * inputs.clouds[l * 16 + 1] * 0.8);
        uniforms.uStars.value = env.starAlpha * (1 - 0.85 * cover);
        for (let i = 0; i < 2; i++) {
          const m = inputs.moons[i];
          if (!m) continue;
          dirs[i].set(...m.dir);
          cols[i].setRGB(...m.skyColor);
          prms[i].set(2 * Math.PI * m.phase, m.angularRadius * MOON_DISPLAY_SCALE, m.brightness, m.illumination);
        }
      } else {
        uniforms.uStars.value = env.starAlpha;
        dirs[0].set(...env.moons[0].dir);
        dirs[1].set(...env.moons[1].dir);
      }
    },
  };
}
