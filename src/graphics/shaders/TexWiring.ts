// Wave TEX (lane R): the GAME wiring of the layered materials onto a skinned body — the one call site that turns
// a profile's appearance into the skin's channels (owner R by Z-18/Z-27):
//
//   preset   P's material preset for the body (Presets.presetFor(subjectOfSpec)) + the creator's overrides
//            (appearance.layerOverrides, ids "p:<material>.<step>", Presets.applyPresetOverrides), evaluated by
//            P's game path presetBuffers -> albedo (LINEAR, replaces the v1 paint), aMaterial, masks.skin.
//   marks    M's marks (appearance.marks, or the generated defaults when unset: MarkLibrary.marksForProfile with
//            seed = spec.seed = nameSeed(profile.name) in the Creator) -> resolveMarks on the body's own region
//            frames -> marksToDecals with the body's OWN skin colour and roughness -> FragmentDecal[] (<= 16).
//   skin     decals are hidden under garments: the skin mask (preset masks.skin, else the v1 garment regions)
//            rides in aSurface.x, which the decal pass reads.
//
// TEX_DEFAULTS switches what an appearance WITHOUT explicit marks / overrides gets (the generated marks and the
// preset finish). Explicit empty marks ({ scars: [], tattoos: [] }) and no overrides with both switches off give
// neutral channels: the pre-TEX pixels (RENDER.md).
import type { BodySpec, MeshData } from "../body/contracts.ts";
import type { Appearance } from "../../game/Characters.ts";
import { type MarkSet, marksForProfile, marksToDecals, resolveMarks } from "../paint/marks/MarkLibrary.ts";
import { type FaceAnchorsLike, regionFrames } from "../paint/marks/Placement.ts";
import { applyPresetOverrides, presetBuffers, presetFor, skinRegionsOf, subjectOfSpec } from "../paint/Presets.ts";
import { MARK_REGIONS } from "../paint/marks/Placement.ts";
import { GARMENT_REGIONS } from "../paint/Recipes.ts";
import { type Region, REGIONS } from "../body/contracts.ts";
import type { LayerOverride } from "../paint/LayerStack.ts";
import { type FragmentDecal, packDetails, type RegionDetail } from "./MaterialChannels.ts";
import type { MaterialInput } from "./MaterialRender.ts";

/** What appearances without explicit marks / overrides get. Mutable (QA, the parent's rollout switch). */
export const TEX_DEFAULTS = {
  /** Draw M's generated marks when appearance.marks is unset (the C-MARK contract: unset = generated). */
  generatedMarks: true,
  /** Paint the body with P's preset finish (roughness by ancestry, wash, edge, glaze, varnish) instead of the v1 paint. */
  preset: true,
};

/** What the wiring decided, for QA / the capture HUD (rig.material.stack). */
export interface TexStackInfo {
  /** "preset:<id>" when P's finish painted the body, "v1" when the legacy paint stayed. */
  paint: string;
  /** Finish layer ids in order with enabled/opacity after overrides (empty for v1). */
  layers: { id: string; enabled: boolean; opacity: number }[];
  /** Overrides applied (ids). */
  overrides: string[];
  /** "explicit" | "generated" | "none". */
  marksSource: "explicit" | "generated" | "none";
  /** Mark ids drawn as decals, and the ids dropped by the 16-decal budget. */
  marks: string[];
  dropped: string[];
  /** P's fragment relief details "<material>:<kind>" (drawn by the shader). */
  details?: string[];
  /** Build cost of the wiring (ms). */
  ms: { preset: number; marks: number };
}

/** The wiring result: the material input of the skin, the albedo that replaces the v1 paint (or null), the skin mask. */
export interface TexBuild {
  input: MaterialInput;
  albedo: Float32Array | null;
  /** 1 = bare skin per vertex (null = keep the v1 garment regions). */
  skin: Float32Array | null;
  info: TexStackInfo;
}

const hexToSrgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.78, 0.6, 0.5];
  const v = parseInt(m[1], 16);
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
};

/**
 * The channels of a body. Returns null when nothing applies (no preset, no marks): the caller keeps the v1 paint
 * and neutral channels. `garment` = the palette colour painted as the garment; `regionGain` = FormShade's seeded
 * trunk knobs (the same the v1 paint used).
 */
export function texMaterialFor(
  mesh: MeshData, spec: BodySpec, appearance: Appearance, cell: number, garment: string | undefined,
  regionGain?: Partial<Record<string, { cavity?: number; ridge?: number }>>,
  face?: FaceAnchorsLike | null,
): TexBuild | null {
  const overrides = ((appearance as { layerOverrides?: LayerOverride[] }).layerOverrides ?? []).filter((o) => o && typeof o.id === "string");
  const explicitMarks = appearance.marks ?? null;
  const usePreset = TEX_DEFAULTS.preset || overrides.length > 0;
  const useMarks = !!explicitMarks || TEX_DEFAULTS.generatedMarks;
  if (!usePreset && !useMarks) return null;
  const n = mesh.positions.length / 3;
  const info: TexStackInfo = { paint: "v1", layers: [], overrides: overrides.map((o) => o.id), marksSource: "none", marks: [], dropped: [], ms: { preset: 0, marks: 0 } };
  let albedo: Float32Array | null = null, skin: Float32Array | null = null, material: Float32Array | undefined;
  let skinRough = 0.5;
  let skinSrgb = hexToSrgb(appearance.body);
  let covered: Region[] = garment ? [...GARMENT_REGIONS] : [];
  let details: MaterialInput["details"];
  let edge: Float32Array | undefined;
  if (usePreset) {
    const t0 = performance.now();
    const subject = subjectOfSpec(spec, { hair: appearance.hair, accent: appearance.accent, garment }, cell);
    const preset = applyPresetOverrides(presetFor(subject), overrides);
    const buf = presetBuffers(mesh, preset, { cell, regionGain });
    albedo = buf.albedo;
    material = buf.material;
    skin = buf.masks.skin ?? null;
    edge = buf.masks.crest; // P's fine edge highlight weight (closing, F): aEdge, drawn per fragment
    info.paint = preset.id.startsWith("preset:") ? preset.id : `preset:${preset.id}`;
    info.layers = preset.finish.layers.map((l) => ({ id: l.id, enabled: l.enabled, opacity: l.opacity }));
    // The skin's own mean roughness (M composes scar sheen as skin roughness x stage scale).
    let sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) if (!skin || skin[i] > 0.5) { sum += material[i * 4]; cnt++; }
    if (cnt) skinRough = sum / cnt;
    // The skin a scar sits on = the preset's painted skin (mean albedo over bare skin, linear -> sRGB; M Z-63).
    const acc = [0, 0, 0];
    let k = 0;
    for (let i = 0; i < n; i++) if (skin && skin[i] > 0.5) { acc[0] += albedo[i * 3]; acc[1] += albedo[i * 3 + 1]; acc[2] += albedo[i * 3 + 2]; k++; }
    if (k) skinSrgb = acc.map((c) => { const x = c / k; return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; }) as [number, number, number];
    const bare = new Set<string>(skinRegionsOf(preset));
    covered = MARK_REGIONS.filter((r) => !bare.has(r));
    // P's fragment relief per material (pores, weave, grain, hammered, strands, plates, studs).
    const packedDetails = packDetails(preset.details as readonly RegionDetail[], mesh.region, REGIONS);
    if (packedDetails.materials.length) details = { weights: packedDetails.weights, slots: packedDetails.slots };
    info.details = preset.details.map((d) => `${d.material}:${d.detail.kind}`);
    info.ms.preset = performance.now() - t0;
  }
  let decals: FragmentDecal[] = [];
  if (useMarks) {
    const t0 = performance.now();
    const set: MarkSet = marksForProfile({
      race: spec.race, subrace: spec.subrace, className: spec.className, birthsign: spec.birthsign ?? null,
      appearance: { marks: explicitMarks, age: appearance.age, height: spec.height },
    }, spec.seed);
    info.marksSource = explicitMarks ? "explicit" : set.scars.length + set.tattoos.length ? "generated" : "none";
    if (set.scars.length + set.tattoos.length > 0) {
      // The body's OWN face (eyes, mouth from plan.face) so face marks keep off the real features (M Z-80, QD Z-84).
      const frames = regionFrames(mesh, { face: face ?? null, race: spec.race });
      const res = resolveMarks(set, { race: spec.race, subrace: spec.subrace, frames, coveredRegions: covered });
      // skinAlbedo: a scar is composed over the PAINTED skin around it (closing, F: a mature scar must read paler than its
      // own surroundings, not than the body's mean skin).
      const out = marksToDecals(res, { mesh, skinSrgb, skinRoughness: skinRough, ...(albedo ? { skinAlbedo: albedo } : {}) });
      decals = out.decals;
      info.marks = out.decals.map((d) => d.id);
      info.dropped = out.dropped;
    }
    info.ms.marks = performance.now() - t0;
  }
  return { input: { aMaterial: material, decals, details, ...(edge ? { edge } : {}) }, albedo, skin, info };
}
