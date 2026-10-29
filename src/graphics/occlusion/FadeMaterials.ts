// Fade variants of materials for camera occlusion (lane O, V01).
//
// A FADE VARIANT is a second material made from a source material ONCE, the first time its mesh
// has to fade, and swapped onto the mesh only while it fades. The source material is never
// mutated, so materials shared with non-occluding objects are untouched, and the opaque program
// of the source keeps drawing everything that is not fading.
//
// Two styles:
// - "alpha" (built-in materials: Lambert/Standard/Basic on props, walls, hills): a clone with
//   transparent = true, depthWrite = false, opacity = source.opacity * alpha. Because the clone is
//   transparent from its first compile, three.js never bakes `#define OPAQUE` into it. (Toggling
//   `transparent` on ONE material does not recompile it: WebGLRenderer.setProgram only rebuilds on
//   material.version, so a material first drawn opaque keeps `diffuseColor.a = 1.0` forever — the
//   reason the old wall fade could stay solid.)
// - "dither" (cel ShaderMaterials of bodies and weapons, and every material of a fighter/weapon
//   occluder): a screen-door 4x4 ordered (Bayer) discard injected before the fragment shader's
//   body. It stays in the OPAQUE pass with depthWrite on, needs no sorting, keeps self-occlusion of
//   the one-mesh skinned body correct, and the inverted-hull outline discards the SAME pixels as
//   the surface (same pattern, same opacity), so the ink fades in lockstep with the skin. See
//   docs/overhaul/lane-O.md for the alpha-vs-dither comparison.
//
// No edit of CelShader.ts / CelSkinned.ts / WeaponMaterial.ts is needed: the dither variant is a
// clone whose fragment source gets the discard injected, and whose uniforms are the SOURCE's
// uniform objects (shared by reference: lighting, base colour and outline width stay live).

// @deno-types="@types/three"
import * as THREE from "three";

/** How a variant hides: blended alpha (sorted, transparent pass) or a screen-door discard. */
export type FadeStyle = "alpha" | "dither";

/** Name of the opacity uniform the dither variants read, in [0, 1]. */
export const OCCLUSION_OPACITY_UNIFORM = "uOcclusionOpacity";

/**
 * GLSL declarations injected before `void main()`: the opacity uniform and the 4x4 Bayer
 * threshold (mirror of Corridor.bayer4Threshold):
 *   M2(x, y) = 2x + 3y - 4xy,  M4 = 4 * M2(p mod 2) + M2(floor(p / 2)),  threshold = (M4 + 0.5) / 16.
 */
export const OCCLUSION_DITHER_GLSL = /* glsl */ `
uniform float ${OCCLUSION_OPACITY_UNIFORM};
float occlusionBayer4(vec2 fragCoord) {
  vec2 p = mod(floor(fragCoord), 4.0);
  vec2 lo = mod(p, 2.0);
  vec2 hi = floor(p * 0.5);
  float inner = 2.0 * lo.x + 3.0 * lo.y - 4.0 * lo.x * lo.y;
  float outer = 2.0 * hi.x + 3.0 * hi.y - 4.0 * hi.x * hi.y;
  return (4.0 * inner + outer + 0.5) / 16.0;
}
`;

/** The statement injected as the first line of `main()`: drop the pixels above the opacity. */
export const OCCLUSION_DITHER_DISCARD = /* glsl */ `
  if (${OCCLUSION_OPACITY_UNIFORM} < occlusionBayer4(gl_FragCoord.xy)) discard;
`;

const MAIN_RE = /void\s+main\s*\(\s*(?:void\s*)?\)\s*\{/;

/**
 * The fragment shader with the dither declarations before `void main()` and the discard as the
 * first statement of main. Returns null when no `void main() {` is found (the material then
 * cannot fade and is left alone). Idempotent: an already-injected shader is returned unchanged.
 */
export function injectOcclusionDither(fragmentShader: string): string | null {
  if (fragmentShader.includes("occlusionBayer4(")) return fragmentShader;
  const m = MAIN_RE.exec(fragmentShader);
  if (!m) return null;
  const at = m.index, end = at + m[0].length;
  return fragmentShader.slice(0, at) + OCCLUSION_DITHER_GLSL + fragmentShader.slice(at, end) +
    OCCLUSION_DITHER_DISCARD + fragmentShader.slice(end);
}

/** The fade level a variant reads (an object, so no double crosses a call: see Corridor.ts). */
export interface FadeLevel {
  /** Opacity in [0, 1]. */
  readonly opacity: number;
}

/** A material's fade variant: swapped onto the mesh while it fades. */
export interface FadeVariant {
  /** The material to put on the mesh while fading. */
  readonly material: THREE.Material;
  /** The material it was made from (never mutated). */
  readonly source: THREE.Material;
  readonly style: FadeStyle;
  /** Apply `level.opacity` in [0, 1] (alpha: source.opacity * opacity; dither: the uniform). No allocation. */
  setOpacity(level: FadeLevel): void;
  /** Re-copy the source's look (colour, maps, side) before a swap-in. Called at transitions only. */
  syncFromSource(): void;
  /** Free the variant (its GPU program reference). The source is not touched. */
  dispose(): void;
}

/** Every material this module created, so a variant is never mistaken for a source. */
const VARIANTS = new WeakSet<THREE.Material>();

/** Whether `m` is a fade variant made by createFadeVariant. */
export function isFadeVariant(m: THREE.Material): boolean {
  return VARIANTS.has(m);
}

/**
 * Whether a material is excluded from fading: additive/custom-blended FX, soft transparent
 * decals (transparent with depthWrite off: auras, contact shadows, trails) and invisible ones.
 */
export function isUnfadeable(m: THREE.Material): boolean {
  return !m.visible || m.blending !== THREE.NormalBlending || (m.transparent && !m.depthWrite);
}

/** A ShaderMaterial (or RawShaderMaterial): its alpha is whatever its shader writes. */
function isShaderMaterial(m: THREE.Material): m is THREE.ShaderMaterial {
  return (m as THREE.ShaderMaterial).isShaderMaterial === true;
}

/**
 * Make the fade variant of `source` in `style`. A ShaderMaterial always gets the dither variant
 * (its shader writes alpha 1, so blending could not fade it). Returns null when the material
 * cannot be faded (no `void main()` to inject into). Allocates: call once per source and mesh.
 */
export function createFadeVariant(source: THREE.Material, style: FadeStyle): FadeVariant | null {
  if (isShaderMaterial(source)) return createShaderDitherVariant(source);
  return style === "dither" ? createBuiltinDitherVariant(source) : createAlphaVariant(source);
}

function createAlphaVariant(source: THREE.Material): FadeVariant {
  const material = source.clone();
  const prepare = () => {
    material.transparent = true;  // compiled transparent from the start: no OPAQUE define
    material.depthWrite = false;  // see-through: never hide what is behind it from the depth test
    material.name = `${source.name}+occlusion-alpha`;
  };
  prepare();
  VARIANTS.add(material);
  return {
    material, source, style: "alpha",
    setOpacity(level: FadeLevel) { material.opacity = source.opacity * level.opacity; },
    syncFromSource() { material.copy(source); prepare(); },
    dispose() { VARIANTS.delete(material); material.dispose(); },
  };
}

function createBuiltinDitherVariant(source: THREE.Material): FadeVariant {
  const material = source.clone();
  const uniform = { value: 1 };
  const sourceHook = source.onBeforeCompile;
  const sourceKey = source.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    sourceHook.call(material, shader, renderer);
    shader.uniforms[OCCLUSION_OPACITY_UNIFORM] = uniform;
    const injected = injectOcclusionDither(shader.fragmentShader);
    if (injected) shader.fragmentShader = injected;
  };
  // A distinct program from the source's (same parameters, different fragment source).
  material.customProgramCacheKey = () => `${sourceKey}|occlusion-dither`;
  material.name = `${source.name}+occlusion-dither`;
  VARIANTS.add(material);
  return {
    material, source, style: "dither",
    setOpacity(level: FadeLevel) { uniform.value = level.opacity; },
    syncFromSource() { material.copy(source); material.name = `${source.name}+occlusion-dither`; },
    dispose() { VARIANTS.delete(material); material.dispose(); },
  };
}

function createShaderDitherVariant(source: THREE.ShaderMaterial): FadeVariant | null {
  const fragmentShader = injectOcclusionDither(source.fragmentShader);
  if (fragmentShader === null) return null;
  const material = source.clone();
  const uniform = { value: 1 };
  let sharedFrom: Record<string, THREE.IUniform> | null = null;
  const share = () => {
    // Share the source's uniform OBJECTS (clone() deep-copied them): the Engine's per-frame
    // lighting writes and any colour change on the source stay visible on the variant.
    if (sharedFrom !== source.uniforms) {
      material.uniforms = { ...source.uniforms, [OCCLUSION_OPACITY_UNIFORM]: uniform };
      sharedFrom = source.uniforms;
    }
    material.defines = source.defines;
    material.side = source.side;
    material.vertexColors = source.vertexColors;
  };
  material.fragmentShader = fragmentShader;
  material.name = `${source.name}+occlusion-dither`;
  share();
  VARIANTS.add(material);
  return {
    material, source, style: "dither",
    setOpacity(level: FadeLevel) { uniform.value = level.opacity; },
    syncFromSource() { share(); },
    dispose() { VARIANTS.delete(material); material.dispose(); },
  };
}
