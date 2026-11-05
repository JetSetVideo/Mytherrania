// Wave TEX (lane R): runtime API of the material channels on a built rig or a cel material — channel debug
// views, live decal updates (no rebuild), the neutral aMaterial attribute and the geometry wiring.
// @deno-types="@types/three"
import * as THREE from "three";
import {
  channelViewCode, type ChannelView, DEAD_ZONE, DECAL_KINDS, DECAL_VEC4, DETAIL_ATTRIBUTE, EDGE_ATTRIBUTE, DETAIL_MATERIALS, DETAIL_PER_MATERIAL, EMISSIVE_ATTRIBUTE, type FragmentDecal, MATERIAL_ATTRIBUTE,
  MATERIAL_NEUTRAL, type PackedDecals, packDecals,
} from "./MaterialChannels.ts";
import { glyphAtlasTexture } from "../textures/GlyphAtlas.ts";

/** What a caller hands the body builder (SkinnedHumanoidOptions.material). Arrays are per skin vertex. */
export interface MaterialInput {
  /** 4 floats per vertex (roughness, height m, ao, subsurface); default neutral (0.5, 0, 1, 0). */
  aMaterial?: Float32Array;
  /** 3 floats per vertex, linear RGB. Absent = no emissive attribute (and no USE_WAVE_TEX_EMISSIVE). */
  aEmissive?: Float32Array;
  /** Fragment decals (scars, tattoos), bind-pose frame; at most DECAL_MAX are drawn. */
  decals?: readonly FragmentDecal[];
  /** Material relief details (MaterialChannels.packDetails): per-vertex one-hot weights (4n) + the slot block. */
  details?: { weights: Float32Array; slots: Float32Array };
  /** Fine edge-highlight weight (n floats, 0..1; P's presetBuffers masks.crest). Absent = no aEdge attribute (no USE_WAVE_TEX_EDGE). */
  edge?: Float32Array;
}

/** A neutral aMaterial array for `vertexCount` vertices. */
export function neutralMaterial(vertexCount: number): Float32Array {
  const out = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) out.set(MATERIAL_NEUTRAL, i * 4);
  return out;
}

/** True when every vertex of an aMaterial array is inside the shader's neutral dead zones. */
export function isNeutralMaterial(mat: Float32Array): boolean {
  for (let i = 0; i < mat.length; i += 4) {
    if (!(Math.abs(mat[i] - 0.5) < DEAD_ZONE.roughness) || mat[i + 1] !== 0 || !(mat[i + 2] > DEAD_ZONE.ao) || !(mat[i + 3] < DEAD_ZONE.subsurface)) return false;
  }
  return true;
}

/**
 * Put the material attributes on a skin geometry (validated: a wrong length falls back to neutral rather
 * than reading out of bounds). Returns whether an emissive attribute was attached and whether the vertex
 * channels are all neutral (then the shader keeps the pre-TEX lighting statement: USE_WAVE_TEX_LIT off).
 */
export function attachMaterialAttributes(geometry: THREE.BufferGeometry, vertexCount: number, input: MaterialInput | null): { emissive: boolean; neutral: boolean; details: boolean; edge: boolean } {
  const given = input?.aMaterial && input.aMaterial.length === vertexCount * 4 ? input.aMaterial : null;
  const mat = given ?? neutralMaterial(vertexCount);
  geometry.setAttribute(MATERIAL_ATTRIBUTE, new THREE.Float32BufferAttribute(mat, 4));
  const em = input?.aEmissive && input.aEmissive.length === vertexCount * 3 ? input.aEmissive : null;
  if (em) geometry.setAttribute(EMISSIVE_ATTRIBUTE, new THREE.Float32BufferAttribute(em, 3));
  const det = input?.details && input.details.weights.length === vertexCount * 4 && input.details.slots.length === DETAIL_MATERIALS * DETAIL_PER_MATERIAL * 4 ? input.details : null;
  if (det) geometry.setAttribute(DETAIL_ATTRIBUTE, new THREE.Float32BufferAttribute(det.weights, 4));
  const edge = input?.edge && input.edge.length === vertexCount && input.edge.some((v) => v > 0) ? input.edge : null;
  if (edge) geometry.setAttribute(EDGE_ATTRIBUTE, new THREE.Float32BufferAttribute(edge, 1));
  return { emissive: !!em, neutral: !em && !det && !edge && (!given || isNeutralMaterial(given)), details: !!det, edge: !!edge };
}

type MaterialHost = THREE.Material | THREE.Mesh | { skin: THREE.Mesh } | null | undefined;

function materialOf(target: MaterialHost): THREE.ShaderMaterial | null {
  if (!target) return null;
  const m = (target as { skin?: THREE.Mesh }).skin?.material ?? (target as THREE.Mesh).material ?? target;
  const mat = Array.isArray(m) ? m[0] : m;
  return mat && (mat as THREE.ShaderMaterial).uniforms?.uChannelView ? mat as THREE.ShaderMaterial : null;
}

/**
 * Select a channel debug view ("final" | "albedo" | "roughness" | "height" | "normal" | "ao" | "marks") on a
 * rig (`rig.skin`), a mesh or a material. A uniform write: no recompile. False when the target has no material
 * channels (e.g. a non-body cel surface).
 */
export function setChannelView(target: MaterialHost, view: ChannelView | string): boolean {
  const mat = materialOf(target);
  if (!mat) return false;
  mat.uniforms.uChannelView.value = channelViewCode(view);
  return true;
}

/** The view currently selected on a target ("final" when none). */
export function channelViewOf(target: MaterialHost): number {
  return materialOf(target)?.uniforms.uChannelView.value ?? 0;
}

/**
 * Replace the decal list of a rig / mesh / material LIVE: packs into the existing uniform array (in place, so
 * fade variants sharing the uniform objects follow) and binds the glyph atlas when a glyph kind is present.
 * Returns the packing record (dropped indices), or null when the target has no material channels.
 */
export function setDecals(target: MaterialHost, decals: readonly FragmentDecal[]): PackedDecals | null {
  const mat = materialOf(target);
  if (!mat) return null;
  const packed = packDecals(decals);
  (mat.uniforms.uDecals.value as Float32Array).set(packed.data);
  mat.uniforms.uDecalCount.value = packed.count;
  mat.uniforms.uDecalRelief.value = packed.anyHeight ? 1 : 0;
  const glyphIdx = [DECAL_KINDS.indexOf("glyph"), DECAL_KINDS.indexOf("dots"), DECAL_KINDS.indexOf("band")];
  let glyphs = false;
  for (let i = 0; i < packed.count; i++) if (glyphIdx.includes(packed.data[i * DECAL_VEC4 * 4 + 16])) glyphs = true;
  if (glyphs && !mat.uniforms.uGlyphAtlas.value) mat.uniforms.uGlyphAtlas.value = glyphAtlasTexture();
  // The lit material path (decals, relief, the new lighting terms) compiles only when something is off-neutral:
  // neutral vertex channels + no decal keep the pre-TEX statement (bit-exact pixels). Toggling recompiles once.
  const lit = packed.count > 0 || mat.userData.wtVertexNeutral === false;
  if (lit !== "USE_WAVE_TEX_LIT" in mat.defines) {
    if (lit) mat.defines.USE_WAVE_TEX_LIT = "";
    else delete mat.defines.USE_WAVE_TEX_LIT;
    mat.needsUpdate = true;
  }
  return packed;
}
