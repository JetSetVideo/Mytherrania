// @deno-types="@types/three"
import * as THREE from "three";
import { ELEMENTS, type Element } from "../../game/Skills.ts";
import type { GeneratedWeapon } from "../../game/WeaponGen.ts";

// Elemental weapon effect. An additive shell is drawn slightly larger than the
// blade and a noise-driven flame/energy pattern runs along it. The strength comes
// from AnimationCurve.effectStrength, which scales with the fraction of the
// target's health the strike removed — a graze barely flickers, a huge hit roars.

const vertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPos;
  uniform float uStrength;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vPos = position;
    // The shell swells outward as the effect intensifies.
    vec3 p = position * (1.0 + 1.15 * uStrength);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uCore;
  uniform vec3 uEdge;
  uniform float uStrength;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPos;

  float hash(vec2 p) { return fract(sin(p.x * 127.1 + p.y * 311.7) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
  }

  void main() {
    // Flame licks upward along the blade, faster and taller as the effect grows.
    float speed = 1.4 + 2.6 * uStrength;
    float n = noise(vec2(vUv.x * 7.0, vUv.y * 4.0 - uTime * speed));
    n += 0.5 * noise(vec2(vUv.x * 14.0 + 3.1, vUv.y * 8.0 - uTime * speed * 1.7));
    n /= 1.5;
    // Stronger at the tip (vUv.y -> 1) and on the rim, so the blade edge glows.
    float tip = smoothstep(0.15, 1.0, vUv.y);
    float rim = pow(1.0 - abs(vNormal.z), 1.5);
    float flame = n * (0.45 + 0.55 * tip) * (0.6 + 0.4 * rim);
    // Two layers: a broad aura (alpha blend) plus a hot core (additive), so the
    // effect reads on a bright sky as well as in shadow.
    float aura = clamp((flame * 0.55 + 0.45) * uStrength, 0.0, 1.0);
    float core = clamp(pow(flame, 1.6) * uStrength * 2.2, 0.0, 1.0);
    if (aura < 0.02) discard;
    // Keep the ELEMENT hue dominant. Only the hottest sliver goes near-white, and the
    // output is not multiplied so hard that it clips: a x2.5 gain on a bright sky
    // saturated every element to the same white flame.
    vec3 col = mix(uEdge, uCore, clamp(pow(flame, 2.2) * 0.55, 0.0, 1.0));
    col += uEdge * core * 0.7;
    col += uCore * pow(core, 4.0) * 0.5;
    gl_FragColor = vec4(col * (0.85 + 0.55 * uStrength), aura);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface EffectShell {
  group: THREE.Group;
  set(strength: number, time: number): void;
}

/**
 * The shell reuses the weapon's blade/head bounding volume as a few enlarged
 * quads so the effect reads from any angle without a second geometry pass.
 */
export function createEffectShell(weapon: GeneratedWeapon, element: Element): EffectShell {
  const style = ELEMENTS[element];
  const group = new THREE.Group();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uCore: { value: new THREE.Color(style.core) },
      uEdge: { value: new THREE.Color(style.edge) },
      uStrength: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });

  // Cover the STRIKING parts only: blade and head. Wrapping the limbs as well
  // turned a bow into a glowing slab — the aura hid the very shape it should
  // highlight.
  // A bow gets no shell: its riser is small, so an aura around it renders as a
  // translucent bubble that hides the very silhouette it should highlight. A bow's
  // elemental effect belongs on the projectile, not the limbs.
  const striking = weapon.parts.filter((p) => p.kind === "blade" || p.kind === "head");
  const use = weapon.params.type === "bow"
    ? []
    : (striking.length > 0 ? striking : weapon.parts.filter((p) => p.kind !== "limb" && p.kind !== "string"));
  for (const p of use) {
    // A visibly larger shell than the blade: an aura, not a skin.
    const geo = new THREE.CylinderGeometry(p.w * 1.7 + 0.05, p.w * 1.7 + 0.05, p.h * 1.18, 10, 1, true);
    const shell = new THREE.Mesh(geo, material);
    shell.position.set(0, p.y, p.bend || 0);
    group.add(shell);
  }
  group.visible = false;
  return {
    group,
    set(strength, time) {
      material.uniforms.uStrength.value = strength;
      material.uniforms.uTime.value = time;
      group.visible = strength > 0.02;
    },
  };
}
