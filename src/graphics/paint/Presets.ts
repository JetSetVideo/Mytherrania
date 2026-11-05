// Wave TEX lane P (art direction): MATERIAL PRESETS — skin per race x sub-race and garments (wool, linen,
// leather, studded leather, metal trim, fur) as complete layered stacks over the channels of contract C-MAT
// (albedo, roughness, height, ao, subsurface), painted the way a tabletop miniature is painted:
//
//   prime     zenithal prime: the figure is lit from above before any colour (the wave-GEN chiaroscuro)
//   basecoat  the flat colour of each material (the v1 recipe stack = the skin; garment slots add their cloth)
//   wash      a thin dark pigment that runs into the recesses = MULTIPLY by the wash colour, masked by CONCAVE
//             curvature (the wave-V groove term and the wave-GEN broad cavity term)
//   layer     the base colour re-applied on the raised planes = NORMAL toward the basecoat, masked by NOT concave
//   edge      the edge highlight = a LIFT (screen in its b + (1-b)·t form) toward a highlight colour, masked by
//             CONVEX curvature OR up-facing (bounded sum: or(a,b) = min(1, a+b))
//   glaze     a transparent colour filter = the non-separable COLOR blend (hue + saturation of the glaze, the
//             luminosity of what is under it) at <= 15 % — it shifts the hue without undoing the values the
//             previous steps built
//   varnish   the final sheen = roughness LERP toward a varnish value (matte / satin / gloss)
//   relief    height: per-vertex (hide plates, studs, fur clumps; heightBlend = soft max) and per-FRAGMENT
//             detail descriptors (pores, weave, grain, hammering, strands) that lane R evaluates in the shader
//   guard     the wave-GEN value guard: no channel ends below (1 − PAINT_MAX_DARK) × the basecoat
//
// THE OLD PATHS ARE LAYERS TOO: `legacyFinish()` is the exact wave-V FormShade + wave-GEN Miniature pass written
// as this layer list (form-wash, form-edge, clamp, weather, wash, prime, edge, guard); `evaluateFinish` with it is
// byte-identical to `applyFormShade` (pinned by TX60). A preset only changes the per-material parameters of the
// same layers and enables the steps the legacy pass had at 0 (layer, glaze, varnish, relief). Every legacy
// arithmetic expression is kept in the same evaluation order, with neutral parameters chosen so the extra factors
// are exact identities in IEEE-754 (x·1, x·(1−0), r + (1 − r)·k with the highlight 1).
//
// Pure module: no THREE, no DOM, deterministic (seeded patterns only).

import { nameSeed } from "../../game/RaceAppearance.ts";
import type { CharacterProfile } from "../../game/Characters.ts";
import { REGIONS, type BodySpec, type MeshData, type PaintLayer, type Region } from "../body/contracts.ts";
import { contrastRatio, hexToHsl, hexToRgb, hslToHex, mixHexSrgb, relativeLuminance, shadeHex, srgbToLinear, tintHex } from "./Blend.ts";
import { CAVITY_DARK, FORM_SHADE_QA, FORM_SKIP, formTerms, RIDGE_LIGHT, vertexRings, WEAR_LIGHT } from "./FormShade.ts";
import { paintVertices } from "./Layers.ts";
import { MINIATURE, miniatureTerms, PAINT_MAX_DARK, type MiniatureTerms } from "./Miniature.ts";
import { meshOcclusion } from "./MeshOcclusion.ts";
import { makeNoise } from "./Noise.ts";
import { buildPatternEnv, makePatternContext, PATTERNS } from "./Patterns.ts";
import { GARMENT_REGIONS, layerSeed, stackFor, type PaintSubject } from "./Recipes.ts";
import { INK_BOUNDS, boundColour } from "./Relevance.ts";
import { COLOR_OPS, type Layer as V2Layer, type LayerGroup, type LayerOverride, type LayerStackV2, SCALAR_OP_IDS, stackFromV1 } from "./LayerStack.ts";
import type { FragmentLayer, MaterialBuffers } from "./Evaluate.ts";
import { blendRgb, colorModeCode, type OperatorId, scalarComposite, scalarOpCode } from "./Operators.ts";
import type { MaskExpr } from "./MaskAlgebra.ts";
import type { NoiseExpr } from "./NoiseAlgebra.ts";

// ── Channels (contract C-MAT names; ranges stated here so the tests can pin them) ─────────────────────────────

/** The per-vertex channels a finish writes (the C-MAT subset the vertex pass stores). */
export const PRESET_CHANNELS = ["albedo", "roughness", "height", "ao", "subsurface"] as const;
export type PresetChannel = typeof PRESET_CHANNELS[number];
/** Valid ranges. height is signed metres of relief, bounded so R's perturbed normal never inverts a cel band. */
export const CHANNEL_RANGE: Readonly<Record<Exclude<PresetChannel, "albedo">, readonly [number, number]>> = {
  roughness: [0.04, 1], height: [-0.004, 0.004], ao: [0, 1], subsurface: [0, 1],
};
/** The renderer's AO on top of a painted wash: a miniature paints its own occlusion, so the AO channel only adds
 * this share of the wash term (the painted wash darkens up to AO_DARK = 0.24 already; doubling it read as soot). */
export const AO_SHARE = 0.12;
/**
 * Wave TEX closing (agent F, QA Z-71 WARN-2): the AO channel also carries GEOMETRIC occlusion between body parts
 * (MeshOcclusion.meshOcclusion: hemisphere rays on the voxelised skin) — the inner arm against the ribs, the armpit,
 * the inner thighs, under the jaw, which the painted wash of the one connected skin does not see. The wash layer's ao
 * write becomes (1 − AO_SHARE·cavity)·(1 − gain·smoothstep(onset, full, occlusion)): open surfaces keep ao = 1 exactly
 * (inside the shader's dead zone), the deepest recess goes down to (1 − AO_SHARE)(1 − gain) = 0.48 of the lit term.
 */
export const OCCLUSION_AO = { gain: 0.45, onset: 0.06, full: 0.6 } as const;
/** The occlusion factor of the ao channel for a vertex occlusion o (1 open … 1 − gain buried). */
export function occlusionAo(o: number): number {
  return 1 - OCCLUSION_AO.gain * smooth01(OCCLUSION_AO.onset, OCCLUSION_AO.full, o);
}
/** The fine edge highlight constants live with the shader contract (MaterialChannels.EDGE_CREST); the edge layer
 * emits the per-vertex crest weight (FinishResult.crest -> presetBuffers masks.crest -> aEdge). */
export { EDGE_CREST } from "../shaders/MaterialChannels.ts";

// ── Miniature workflow steps and operators ───────────────────────────────────────────────────────────────────

export const STEPS = ["prime", "basecoat", "wash", "layer", "edge", "glaze", "varnish", "relief", "weather", "guard"] as const;
export type Step = typeof STEPS[number];

/** Operator vocabulary (names match L's Operators.ts: colour blends, scalar ops, mask algebra). */
export type PresetOperator =
  | "normal" | "multiply" | "screenLift" | "color" | "saturation" | "clamp" | "valueGuard"
  | "replace" | "add" | "lerp" | "heightBlend";

/** A mask expression in the C-MAT mask algebra (descriptive; the evaluator implements exactly these). */
export type PresetMask =
  | { kind: "all" }
  | { kind: "concave"; source: "form" | "cavity" | "max" }
  | { kind: "convex"; source: "form" | "edge" }
  | { kind: "or"; a: PresetMask; b: PresetMask }
  | { kind: "and"; a: PresetMask; b: PresetMask }
  | { kind: "invert"; a: PresetMask }
  | { kind: "upFacing" }
  | { kind: "height"; from: number; to: number }
  | { kind: "garment" }
  | { kind: "pattern"; layer: string };

/** One layer of a finish stack: a miniature step, its operator per channel, its mask and why. */
export interface PresetLayer {
  /** Stable id "<material>.<step>" (U's Layers inspector keys overrides on it). */
  id: string;
  name: string;
  step: Step;
  /** Material id this layer is parameterised for ("*" = every material, e.g. the prime and the guard). */
  material: string;
  enabled: boolean;
  /** 0..1 multiplier on the layer's strength (1 = the art-directed value; the creator's override writes it). */
  opacity: number;
  /** Operator per channel the layer writes. */
  writes: Partial<Record<PresetChannel, PresetOperator>>;
  mask: PresetMask;
  /** Creator operator override per channel (L's COLOR_OPS on albedo, SCALAR_OPS on scalars); absent = the step's own. */
  override?: Partial<Record<PresetChannel, OperatorId>>;
  /** Where the layer is evaluated: per vertex (low frequency) or per fragment (sub-cell detail, lane R). */
  storage: "vertex" | "fragment";
  /** Why this operator and this mask (art direction, one line). */
  why: string;
}

// ── Materials ────────────────────────────────────────────────────────────────────────────────────────────────

export const GARMENT_KINDS = ["wool", "linen", "leather", "studdedLeather", "metalTrim", "fur"] as const;
export type GarmentKind = typeof GARMENT_KINDS[number];
export type MaterialKind = "skin" | "hair" | "legacyCloth" | GarmentKind;

/** A fragment relief descriptor lane R evaluates from bind-pose position (no UVs). */
export interface FragmentDetail {
  kind: "pores" | "weave" | "grain" | "hammered" | "strands" | "plates" | "studs";
  /** Feature period (mm). */
  periodMm: number;
  /** Peak relief (m). */
  amplitude: number;
  octaves: number;
}

/** Per-vertex relief from a v1 pattern's coverage (amplitude in m, combined by heightBlend). */
export interface VertexRelief {
  pattern: "scales" | "spots" | "noise";
  /** Pattern feature size (m) — kept >= 2 vertex spacings (Nyquist), see Recipes.NYQUIST. */
  scale: number;
  amplitude: number;
  params?: Record<string, number>;
  /** Optional colour painted with the relief (studs: metal heads) and its roughness. */
  colour?: string;
  roughness?: number;
}

/**
 * Everything a material's layers read. Neutral values (the legacy ones) are exact identities in the
 * evaluator; every number is a GAIN on the wave-V / wave-GEN magnitude unless said otherwise.
 */
export interface MaterialFinish {
  id: string;
  kind: MaterialKind;
  label: string;
  regions: Region[];
  /** basecoat */
  colour?: string;
  roughness: number;
  subsurface: number;
  /** Constant relief offset (m): a trim plate stands proud of the cloth. */
  heightOffset: number;
  /** wash: pigment colour (sRGB hex; "#000000" = the legacy neutral wash), form-groove and broad-cavity gains, saturation gain. */
  washColour: string;
  formWash: number;
  cavityWash: number;
  washSat: number;
  /** roughness added in the recesses (pigment/grime settles matte). */
  washRough: number;
  /** layer: opacity of the base re-applied on the raised planes (0 = no layer step). */
  layer: number;
  /** edge: FormShade ridge lift (RIDGE_LIGHT skin / WEAR_LIGHT cloth), Miniature edge gain, tint toward the highlight. */
  ridge: number;
  edge: number;
  edgeTint: number;
  /** Highlight colour (sRGB hex; "#ffffff" = legacy). */
  highlight: string;
  /** roughness change on the edges (burnished leather, polished metal: negative). */
  edgeRough: number;
  /** glaze: colour + opacity (0 = none) + where. */
  glaze: { colour: string; opacity: number; mask: "all" | "concave" };
  /** varnish: roughness target and opacity (0 = none). */
  varnish: { roughness: number; opacity: number; name: "none" | "matte" | "satin" | "gloss" };
  /** weather: gain on the wave-GEN garment weathering (0 skin). */
  weather: number;
  relief?: VertexRelief;
  detail?: FragmentDetail;
  /** More fragment descriptors (studded leather: the round stud heads the vertex grid cannot draw). */
  extraDetails?: FragmentDetail[];
  /** Per-region roughness offsets (skin: oily face, calloused palms, glossy nails). */
  regionRough?: Partial<Record<Region, number>>;
  /** Per-region subsurface multipliers (thin skin: ears, lips/face, fingers). */
  regionSubsurface?: Partial<Record<Region, number>>;
  why: Partial<Record<Step | "roughness" | "subsurface", string>>;
}

// ── Skin: race x sub-race ────────────────────────────────────────────────────────────────────────────────────

/** Art-directed skin parameters (the recipe stack stays the basecoat). */
export interface SkinPreset {
  roughness: number;
  subsurface: number;
  /** Pore / grain relief (fragment): amplitude m, period mm. */
  poreAmp: number;
  porePeriodMm: number;
  washColour: string;
  /** Gain on the wash (1 = the wave-GEN strength; a coloured wash darkens less than black, so > 1). */
  wash: number;
  highlight: string;
  /** Edge gain (1 = wave GEN). */
  edge: number;
  glaze: string;
  glazeOpacity: number;
  /** Optional per-vertex hide relief (orks). */
  hide?: number;
  why: { roughness: string; wash: string; glaze: string };
}

/**
 * Skin by ancestry. Roughness 0 = mirror, 1 = chalk. Real skin sits at ~0.35-0.6 in PBR terms
 * (sebum-rich T-zone glossier, palms/soles matte). Justifications are the painter's and the
 * dermatologist's reading of each people's lore, tuned by eye against the cel specular band.
 */
export const SKIN_PRESETS: Record<string, SkinPreset> = {
  human: {
    roughness: 0.5, subsurface: 0.45, poreAmp: 0.00025, porePeriodMm: 2.5, washColour: "#7a4a36", wash: 1.15,
    highlight: "#fff1e0", edge: 1, glaze: "#c06850", glazeOpacity: 0.06,
    why: { roughness: "reference: moderate sebum, satin T-zone, matte limbs", wash: "red-brown flesh shade: blood under the skin warms the shadows", glaze: "faint rose glaze unifies the flush" },
  },
  imperial: {
    roughness: 0.46, subsurface: 0.47, poreAmp: 0.0002, porePeriodMm: 2.5, washColour: "#7a4c34", wash: 1.1,
    highlight: "#fff3dc", edge: 1, glaze: "#c0925a", glazeOpacity: 0.07,
    why: { roughness: "city-bred, sun-sheltered and oiled: a touch glossier than the reference", wash: "warm sepia", glaze: "walnut-gold of the Golden Citadel plaque (THEME imperial base)" },
  },
  nomad: {
    roughness: 0.58, subsurface: 0.4, poreAmp: 0.0003, porePeriodMm: 2.8, washColour: "#6e3e26", wash: 1.2,
    highlight: "#fff0d6", edge: 1.1, glaze: "#b0623a", glazeOpacity: 0.08,
    why: { roughness: "sun- and wind-dried stratum corneum scatters more: matte", wash: "burnt sienna: sun-darkened creases", glaze: "sun-flush sienna; the plain-sky accent stays on the cloth" },
  },
  islander: {
    roughness: 0.44, subsurface: 0.46, poreAmp: 0.00022, porePeriodMm: 2.5, washColour: "#5e4a3e", wash: 1.15,
    highlight: "#f4f6ec", edge: 1, glaze: "#1f6b66", glazeOpacity: 0.05,
    why: { roughness: "salt water and oils: a satin sheen", wash: "cool brown, the shade of driftwood", glaze: "teal stain of the Sapphire Archipelago plaque, at 5 % so skin stays skin" },
  },
  elf: {
    roughness: 0.35, subsurface: 0.6, poreAmp: 0.00012, porePeriodMm: 1.8, washColour: "#8a6a78", wash: 1.1,
    highlight: "#fffaf0", edge: 0.9, glaze: "#d8b8c8", glazeOpacity: 0.06,
    why: { roughness: "satin: fine-grained, nearly poreless skin reflects a tighter, brighter band", wash: "cool mauve: thin translucent skin shows blue-red beneath", glaze: "pale rose-lilac keeps the porcelain read" },
  },
  high: {
    roughness: 0.32, subsurface: 0.62, poreAmp: 0.0001, porePeriodMm: 1.6, washColour: "#8a7058", wash: 1.05,
    highlight: "#fffbe8", edge: 0.9, glaze: "#a87a18", glazeOpacity: 0.07,
    why: { roughness: "star-touched sheen of the scholars: the glossiest skin in the game", wash: "warm ochre-grey", glaze: "gilt accent of the High Elf plaque (THEME high accent)" },
  },
  wood: {
    roughness: 0.4, subsurface: 0.56, poreAmp: 0.00015, porePeriodMm: 2, washColour: "#5e6040", wash: 1.15,
    highlight: "#f6f8e6", edge: 0.95, glaze: "#3f7a2a", glazeOpacity: 0.06,
    why: { roughness: "outdoor elves: satin but less polished than the halls", wash: "olive shade, light through leaves", glaze: "leaf-green ink of the Wood Elf plaque" },
  },
  dark: {
    roughness: 0.3, subsurface: 0.55, poreAmp: 0.0001, porePeriodMm: 1.6, washColour: "#4a3858", wash: 1.2,
    highlight: "#f4eefa", edge: 1, glaze: "#6b3a91", glazeOpacity: 0.09,
    why: { roughness: "waxy, sunless skin of the Obsidian Halls: glossy", wash: "violet-black: matches the violet veins (RecipeData dark.veinHue)", glaze: "violet ink of the Dark Elf plaque" },
  },
  dwarf: {
    roughness: 0.6, subsurface: 0.35, poreAmp: 0.00035, porePeriodMm: 3, washColour: "#6a3426", wash: 1.2,
    highlight: "#ffe8cc", edge: 1.15, glaze: "#b04a30", glazeOpacity: 0.07,
    why: { roughness: "weathered: forge heat and wind thicken and dry the skin", wash: "deep red-brown: ruddy, blood-flushed creases", glaze: "forge-ruddy glaze" },
  },
  mountain: {
    roughness: 0.62, subsurface: 0.34, poreAmp: 0.00035, porePeriodMm: 3, washColour: "#5a4a40", wash: 1.2,
    highlight: "#f2eee4", edge: 1.15, glaze: "#9c7a55", glazeOpacity: 0.06,
    why: { roughness: "stone-grey weathering: matte like the granite of the Iron Reach", wash: "grey-brown granite shade", glaze: "iron-brown vein accent of the Mountain plaque" },
  },
  forge: {
    roughness: 0.66, subsurface: 0.32, poreAmp: 0.0004, porePeriodMm: 3.2, washColour: "#3a2620", wash: 1.3,
    highlight: "#ffe8cc", edge: 1.2, glaze: "#ff7a2e", glazeOpacity: 0.06,
    why: { roughness: "soot-dry and heat-cracked: the most matte dwarf skin", wash: "soot black-brown in every crease", glaze: "ember accent of the Khaz-Barad plaque, faint, like heat on the skin" },
  },
  deep: {
    roughness: 0.5, subsurface: 0.5, poreAmp: 0.00025, porePeriodMm: 2.6, washColour: "#4a5262", wash: 1.1,
    highlight: "#e8f0fa", edge: 1, glaze: "#86acd9", glazeOpacity: 0.06,
    why: { roughness: "pale damp-cave delvers: neither sun-dried nor oiled", wash: "cold slate-blue shade", glaze: "cold-iron blue of the Rootways plaque" },
  },
  ork: {
    roughness: 0.7, subsurface: 0.25, poreAmp: 0.0005, porePeriodMm: 4, washColour: "#2a3a1a", wash: 1.3, hide: 0.0012,
    highlight: "#e6f2c8", edge: 1.2, glaze: "#5a7a30", glazeOpacity: 0.07,
    why: { roughness: "leathery hide with keratin plates: matte", wash: "green-black shade (the tabletop ork recipe: a dark green wash over green skin)", glaze: "deep green unifies the mottle" },
  },
  greenhide: {
    roughness: 0.62, subsurface: 0.28, poreAmp: 0.00045, porePeriodMm: 4, washColour: "#22361a", wash: 1.3, hide: 0.0011,
    highlight: "#e8f4c4", edge: 1.15, glaze: "#9fd06a", glazeOpacity: 0.06,
    why: { roughness: "marsh-wet hide: the glossiest ork", wash: "marsh-mud green", glaze: "fresh-green accent of the Greenhide plaque" },
  },
  ironhide: {
    roughness: 0.74, subsurface: 0.22, poreAmp: 0.0005, porePeriodMm: 4.5, washColour: "#2a1e34", wash: 1.35, hide: 0.0016,
    highlight: "#ece6f2", edge: 1.25, glaze: "#5e3f76", glazeOpacity: 0.1,
    why: { roughness: "armour-like hide over more of the body: the most matte skin", wash: "slag-violet black", glaze: "temper-purple of the Ironhide plaque (THEME light), glazed into the shadows only" },
  },
  bloodfang: {
    roughness: 0.72, subsurface: 0.24, poreAmp: 0.0005, porePeriodMm: 4, washColour: "#3a1e14", wash: 1.3, hide: 0.0012,
    highlight: "#f4e8c8", edge: 1.2, glaze: "#81342a", glazeOpacity: 0.08,
    why: { roughness: "dry steppe hide", wash: "red-brown dried-blood shade", glaze: "dried-blood light of the Bloodfang plaque" },
  },
};

/**
 * Preset edge highlight vs the wave-GEN pass (QA Z-76: with the GEN gain the preset's edge step did not read on the
 * pixels — hi-5 % albedo -3..+1 levels — because the highlight is a tinted light, not white). A painter's edge is the
 * brightest note on a skin plane: skin edge gain x1.6, tint 0.68 toward the highlight, wave-V ridge sheen x1.4. Still
 * under one cel band step: the largest lift is 0.68 x min(1, 0.4 x 1.6 x gain) of the way to the highlight.
 */
export const PRESET_EDGE = { skin: 1.6, tint: 0.68, ridge: 1.4 } as const;

/** Sub-races per race (the presets the completeness test walks). */
export const RACE_SUBRACES: Record<string, readonly string[]> = {
  human: ["imperial", "nomad", "islander"], elf: ["high", "wood", "dark"],
  dwarf: ["mountain", "forge", "deep"], ork: ["greenhide", "ironhide", "bloodfang"],
};

/** The skin preset of (race, sub-race): the sub-race entry when it exists, else the race's. */
export function skinPresetFor(race: string, subrace?: string | null): SkinPreset {
  return (subrace && SKIN_PRESETS[subrace]) || SKIN_PRESETS[race] || SKIN_PRESETS.human;
}

// ── Garment materials ────────────────────────────────────────────────────────────────────────────────────────

/** Natural material colours per race / sub-race (leather, fur, metal), coherent with the THEME plaques. */
export const NATURAL_COLOURS: Record<string, { leather: string; fur: string; metal: string; why: string }> = {
  human: { leather: "#6b4a30", fur: "#6e5a44", metal: "#8a8d90", why: "tanned cowhide, wolf pelt, plain iron" },
  imperial: { leather: "#5a3a22", fur: "#5e4a36", metal: "#b08d57", why: "oxblood leather, brass fittings (gilt walnut plaque)" },
  nomad: { leather: "#8a6a48", fur: "#9a8466", metal: "#8a8d90", why: "sun-bleached rawhide, steppe fox, iron" },
  islander: { leather: "#5e5040", fur: "#7a6a58", metal: "#8a7a52", why: "seal leather, bronze (teal-glazed like verdigris)" },
  elf: { leather: "#6a5a3e", fur: "#c8bca8", metal: "#c9a54a", why: "doe leather, snow fox, gold" },
  high: { leather: "#7a6440", fur: "#d8ccb4", metal: "#c9a54a", why: "pale vellum leather, gilt trim (ivory-gold plaque)" },
  wood: { leather: "#5a5232", fur: "#8a7656", metal: "#8a8a5a", why: "moss-tanned leather, lynx, green bronze" },
  dark: { leather: "#3a2e3a", fur: "#3a3438", metal: "#6e6878", why: "black-violet leather, shadow lynx, blackened silver (violet ink plaque)" },
  dwarf: { leather: "#5a3e2a", fur: "#5a4636", metal: "#7c7a78", why: "thick ox-hide, bear, iron" },
  mountain: { leather: "#5a4434", fur: "#6a5e54", metal: "#7c7a78", why: "goat leather, grey bear, iron (granite plaque)" },
  forge: { leather: "#3e2a1e", fur: "#3e322a", metal: "#4a4442", why: "scorched apron leather, blackened steel (ember-black plaque)" },
  deep: { leather: "#4a4440", fur: "#5a5654", metal: "#8a98aa", why: "cave-lizard leather, cold steel (slate-blue plaque)" },
  ork: { leather: "#4e3e28", fur: "#4e4030", metal: "#6b6d62", why: "crude hide, boar, scrap iron" },
  greenhide: { leather: "#4a4228", fur: "#4e4030", metal: "#6b6d62", why: "marsh-tanned hide, scrap iron" },
  ironhide: { leather: "#3e3040", fur: "#2e2a2e", metal: "#6a5a78", why: "slag-black hide, black boar, temper-purple steel (slag plaque)" },
  bloodfang: { leather: "#5e2e22", fur: "#6e3e2a", metal: "#7a4a34", why: "blood-red hide, red steppe wolf, rusted iron" },
};

export function naturalColoursFor(race: string, subrace?: string | null) {
  return (subrace && NATURAL_COLOURS[subrace]) || NATURAL_COLOURS[race] || NATURAL_COLOURS.human;
}

/** How much of Appearance.body (the palette colour) each garment kind takes (dyed cloth = all of it). */
export const LOOK_SHARE: Record<GarmentKind, number> = { wool: 1, linen: 1, leather: 0.25, studdedLeather: 0.25, metalTrim: 0, fur: 0.15 };

/** Garment finish tables: one row per kind (the colour is filled per character). */
export const GARMENT_FINISH: Record<GarmentKind, Omit<MaterialFinish, "id" | "regions" | "colour" | "kind" | "label"> & { label: string }> = {
  wool: {
    label: "Wool", roughness: 0.92, subsurface: 0, heightOffset: 0,
    washColour: "#3b2a1c", formWash: 1.2, cavityWash: 1.2, washSat: 0.6, washRough: 0.04, layer: 0.45,
    ridge: WEAR_LIGHT, edge: 0.8, edgeTint: 0.4, highlight: "#f4ecdc", edgeRough: 0.02,
    glaze: { colour: "#000000", opacity: 0, mask: "all" }, varnish: { roughness: 0.95, opacity: 0.4, name: "matte" }, weather: 1,
    detail: { kind: "weave", periodMm: 4, amplitude: 0.00035, octaves: 2 },
    why: {
      roughness: "felted fibres scatter everywhere: the most matte cloth", wash: "umber multiply in the folds — dyed wool shades warm",
      layer: "re-lay the dye on the planes so the wash stays in the folds only", edge: "soft, low edge: fibre never holds a sharp highlight",
      varnish: "matte varnish kills any cel specular on cloth", relief: "4 mm twill weave in the fragment pass",
    },
  },
  linen: {
    label: "Linen", roughness: 0.82, subsurface: 0.08, heightOffset: 0,
    washColour: "#6b5e4c", formWash: 1.0, cavityWash: 1.0, washSat: 0.5, washRough: 0.04, layer: 0.5,
    ridge: WEAR_LIGHT, edge: 1.1, edgeTint: 0.55, highlight: "#fffaf0", edgeRough: 0,
    glaze: { colour: "#000000", opacity: 0, mask: "all" }, varnish: { roughness: 0.9, opacity: 0.3, name: "matte" }, weather: 1.2,
    detail: { kind: "weave", periodMm: 1.5, amplitude: 0.00015, octaves: 1 },
    why: {
      roughness: "flat smooth fibre: matte but with a faint sheen", subsurface: "thin cloth lets a little light through", varnish: "matte, a touch less than wool",
      wash: "soft grey-brown: pale cloth shades grey, not black", layer: "half re-lay keeps creases crisp",
      edge: "brighter edge: pale cloth catches light", weather: "light cloth shows grime more (x1.2)", relief: "fine plain weave",
    },
  },
  leather: {
    label: "Leather", roughness: 0.55, subsurface: 0, heightOffset: 0,
    washColour: "#2a1a10", formWash: 1.3, cavityWash: 1.3, washSat: 1.2, washRough: 0.06, layer: 0.35,
    ridge: WEAR_LIGHT, edge: 1.7, edgeTint: 0.6, highlight: "#e8d6bc", edgeRough: -0.1,
    glaze: { colour: "#7a3a1a", opacity: 0.1, mask: "concave" }, varnish: { roughness: 0.5, opacity: 0.35, name: "satin" }, weather: 0.6,
    detail: { kind: "grain", periodMm: 3, amplitude: 0.0002, octaves: 3 },
    why: {
      roughness: "tanned and waxed: semi-gloss", wash: "dark brown pools in seams and folds",
      layer: "a thin re-lay leaves the wash in the scuffs", edge: "scuffed edges go pale and burnished (roughness -0.1)",
      glaze: "red-brown glaze in the shadows: the oxblood depth of old leather", varnish: "satin", relief: "3 mm pebble grain",
    },
  },
  studdedLeather: {
    label: "Studded leather", roughness: 0.55, subsurface: 0, heightOffset: 0,
    washColour: "#2a1a10", formWash: 1.3, cavityWash: 1.3, washSat: 1.2, washRough: 0.06, layer: 0.35,
    ridge: WEAR_LIGHT, edge: 1.7, edgeTint: 0.6, highlight: "#e8d6bc", edgeRough: -0.1,
    glaze: { colour: "#7a3a1a", opacity: 0.1, mask: "concave" }, varnish: { roughness: 0.5, opacity: 0.35, name: "satin" }, weather: 0.6,
    relief: { pattern: "spots", scale: 0.07, amplitude: 0.0025, params: { density: 0.7, size: 0.42, warp: 0 }, roughness: 0.22 },
    detail: { kind: "grain", periodMm: 3, amplitude: 0.0002, octaves: 3 },
    extraDetails: [{ kind: "studs", periodMm: 70, amplitude: 0.0025, octaves: 1 }],
    why: {
      roughness: "leather base; the stud heads are polished metal (0.22)", wash: "dark brown pools around every stud",
      layer: "a thin re-lay leaves the wash around the studs",
      edge: "burnished edges", relief: "7 cm stud grid: per vertex only height + gloss (a 3 cm head on a 2.5 cm grid paints an irregular diamond, so the round metal head is a FRAGMENT 'studs' descriptor for lane R); heightBlend so a stud is never added twice",
      varnish: "satin over the leather; the studs keep their own gloss",
    },
  },
  metalTrim: {
    label: "Metal trim", roughness: 0.25, subsurface: 0, heightOffset: 0.001,
    washColour: "#0e0c0a", formWash: 1.5, cavityWash: 1.5, washSat: 0, washRough: 0.2, layer: 0,
    ridge: WEAR_LIGHT * 1.5, edge: 2.2, edgeTint: 0.8, highlight: "#ffffff", edgeRough: -0.12,
    glaze: { colour: "#000000", opacity: 0, mask: "all" }, varnish: { roughness: 0.2, opacity: 0.3, name: "gloss" }, weather: 0.4,
    detail: { kind: "hammered", periodMm: 8, amplitude: 0.0001, octaves: 2 },
    why: {
      roughness: "bare steel: glossy", wash: "black oil wash in the recesses, grime there goes matte (+0.2)",
      layer: "no re-lay: metal is wash + highlight only (the classic metallic recipe)",
      edge: "bright silver edge, polished by wear (roughness -0.12)", varnish: "gloss", relief: "1 mm proud of the cloth, hammered 8 mm facets",
    },
  },
  fur: {
    label: "Fur", roughness: 0.88, subsurface: 0, heightOffset: 0,
    washColour: "#1e140c", formWash: 1.4, cavityWash: 1.4, washSat: 0.8, washRough: 0.04, layer: 0.2,
    ridge: WEAR_LIGHT, edge: 1.8, edgeTint: 0.5, highlight: "#f0e4d0", edgeRough: 0,
    glaze: { colour: "#000000", opacity: 0, mask: "all" }, varnish: { roughness: 0.95, opacity: 0.5, name: "matte" }, weather: 0.5,
    relief: { pattern: "noise", scale: 0.06, amplitude: 0.002, params: { contrast: 2.5, octaves: 2 } },
    detail: { kind: "strands", periodMm: 2, amplitude: 0.0006, octaves: 2 },
    why: {
      roughness: "hair scatters: matte", wash: "deep brown-black between the clumps", layer: "little re-lay: fur is dark at the roots",
      edge: "dry-brush: the tips catch the light (gain 1.3)", varnish: "matte",
      relief: "6 cm clumps per vertex + 2 mm strands per fragment",
    },
  },
};

// ── Outfits by class ─────────────────────────────────────────────────────────────────────────────────────────

/** A garment slot: a kind on a set of regions. The FIRST slot is the primary (Appearance.body). */
export interface GarmentSlot { slot: string; kind: GarmentKind; regions: Region[] }

/** Class outfits (regions never overlap within an outfit). Unknown class: one wool tunic + breeches. */
export const CLASS_OUTFIT: Record<string, GarmentSlot[]> = {
  default: [{ slot: "torso", kind: "wool", regions: [...GARMENT_REGIONS] }],
  Warrior: [{ slot: "torso", kind: "studdedLeather", regions: ["torso"] }, { slot: "legs", kind: "wool", regions: ["pelvis", "thigh"] }, { slot: "bracers", kind: "metalTrim", regions: ["foreArm"] }],
  Barbarian: [{ slot: "legs", kind: "fur", regions: ["pelvis", "thigh"] }, { slot: "bracers", kind: "leather", regions: ["foreArm"] }],
  Rogue: [{ slot: "torso", kind: "leather", regions: ["torso"] }, { slot: "legs", kind: "wool", regions: ["pelvis", "thigh"] }],
  Assassin: [{ slot: "torso", kind: "leather", regions: ["torso", "pelvis", "thigh"] }, { slot: "bracers", kind: "leather", regions: ["foreArm"] }],
  Mage: [{ slot: "torso", kind: "wool", regions: ["torso", "pelvis", "thigh"] }],
  Necromancer: [{ slot: "torso", kind: "wool", regions: ["torso", "pelvis", "thigh"] }],
  Archer: [{ slot: "torso", kind: "linen", regions: ["torso"] }, { slot: "legs", kind: "leather", regions: ["pelvis", "thigh"] }, { slot: "bracers", kind: "leather", regions: ["foreArm"] }],
  Priest: [{ slot: "torso", kind: "linen", regions: ["torso", "pelvis", "thigh"] }],
};

// ── Legibility at game distance ──────────────────────────────────────────────────────────────────────────────

/**
 * A garment must separate from the skin it sits beside by VALUE at game distance (~8-12 m, where hue mostly
 * survives but small value steps vanish in the cel bands): WCAG-style contrast ratio of the two flat colours in
 * [LEGIBLE.min, LEGIBLE.max]. Below min the figure reads as one blob (the painter's "push the values apart");
 * above max a pale tunic on dark skin flares out of the cel band. Measured on the painted bodies by TX66.
 */
export const LEGIBLE = { min: 1.35, max: 7 } as const;

const lumHex = (hex: string) => { const c = hexToRgb(hex); return relativeLuminance(srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])); };

/** Move `garment`'s HSL lightness (hue/saturation kept) away from `skin` until the contrast ratio is in LEGIBLE. */
export function legibleGarment(garment: string, skin: string): string {
  const ys = lumHex(skin);
  const g = garment;
  const ok = (h: string) => { const r = contrastRatio(lumHex(h), ys); return r >= LEGIBLE.min && r <= LEGIBLE.max; };
  if (ok(g)) return g;
  const c = hexToHsl(g);
  // Push toward the side the garment already leans to (lighter or darker than the skin); try the other side too.
  const dir = lumHex(g) >= ys ? 1 : -1;
  for (let k = 1; k <= 60; k++) {
    for (const d of [dir, -dir]) {
      const h = hslToHex(c.h, c.s, Math.max(0.03, Math.min(0.95, c.l + d * 0.01 * k)));
      if (ok(h)) return h;
    }
  }
  return g;
}

// ── Finish stacks ────────────────────────────────────────────────────────────────────────────────────────────

/** A finish stack: materials, the region -> material map, and the ordered layers. */
export interface FinishStack {
  id: string;
  materials: MaterialFinish[];
  /** REGIONS index -> materials index (or -1: untouched by every finish layer, like hair in the legacy pass). */
  regionMaterial: Int8Array;
  layers: PresetLayer[];
  /** Regions the geometric (curvature) layers skip: FormShade.FORM_SKIP. */
  skip: readonly string[];
  /** true = the exact wave-V + wave-GEN paint (no channel output beyond albedo). */
  legacy: boolean;
}

const SKIN_LEGACY: Omit<MaterialFinish, "id" | "regions" | "kind" | "label"> = {
  roughness: 0.5, subsurface: 0, heightOffset: 0,
  washColour: "#000000", formWash: 1, cavityWash: 1, washSat: 1, washRough: 0, layer: 0,
  ridge: RIDGE_LIGHT, edge: 1, edgeTint: MINIATURE.edgeTint, highlight: "#ffffff", edgeRough: 0,
  glaze: { colour: "#000000", opacity: 0, mask: "all" }, varnish: { roughness: 0.5, opacity: 0, name: "none" }, weather: 0,
  why: {},
};

/** The ordered layer list every finish uses (legacy and presets). `m` = material ids. */
function workflowLayers(materials: MaterialFinish[], legacy: boolean): PresetLayer[] {
  const L: PresetLayer[] = [];
  const per = (step: Step, name: string, writes: PresetLayer["writes"], mask: PresetMask, why: string, enabled: (m: MaterialFinish) => boolean, storage: "vertex" | "fragment" = "vertex") => {
    for (const m of materials) L.push({ id: `${m.id}.${step}${step === "wash" && name.startsWith("form") ? "-form" : ""}${step === "edge" && name.startsWith("form") ? "-form" : ""}`, name, step, material: m.id, enabled: enabled(m), opacity: 1, writes, mask, storage, why: m.why[step] ? `${why} — ${m.why[step]}` : why });
  };
  const concaveForm: PresetMask = { kind: "concave", source: "form" };
  const concaveBroad: PresetMask = { kind: "concave", source: "cavity" };
  const convex: PresetMask = { kind: "or", a: { kind: "convex", source: "edge" }, b: { kind: "and", a: { kind: "upFacing" }, b: { kind: "height", from: 0, to: MINIATURE.chiaroTop } } };
  per("basecoat", "basecoat", legacy ? { albedo: "normal" } : { albedo: "normal", roughness: "replace", height: "replace", subsurface: "replace" }, { kind: "all" },
    "flat colour of the material: the v1 recipe stack (skin) / garment slot colour; roughness and subsurface set here", () => true);
  per("wash", "form wash (wave-V grooves)", { albedo: "multiply" }, concaveForm,
    "MULTIPLY by the wash colour, masked by the fine concave curvature (muscle grooves, joint creases)", (m) => m.formWash > 0);
  per("edge", "form edge (wave-V ridges)", { albedo: "screenLift" }, { kind: "convex", source: "form" },
    "LIFT toward the highlight on bony points (skin sheen) / worn cloth, masked by fine convex curvature", (m) => m.ridge > 0);
  L.push({ id: "*.clamp", name: "clamp 0..1", step: "guard", material: "*", enabled: true, opacity: 1, writes: { albedo: "clamp" }, mask: { kind: "all" }, storage: "vertex", why: "range closure before the miniature pass (wave V)" });
  per("weather", "weathering", { albedo: "normal" }, { kind: "garment" },
    "grime rising from the ground and settling in cavities: desaturate, then NORMAL toward a dull earth (garments only)", (m) => m.weather > 0);
  per("wash", "cavity wash (wave-GEN)", legacy ? { albedo: "multiply" } : { albedo: "multiply", roughness: "add", ao: "multiply" }, concaveBroad,
    "pigment pools (SATURATION up) and MULTIPLIES by the wash colour in the broad cavities; recesses go matte", (m) => m.cavityWash > 0);
  per("layer", "layer", { albedo: "normal" }, { kind: "invert", a: { kind: "concave", source: "max" } },
    "NORMAL toward the basecoat on the raised planes (NOT concave): the wash stays only in the recesses", (m) => m.layer > 0);
  L.push({ id: "*.prime", name: "zenithal prime", step: "prime", material: "*", enabled: true, opacity: 1, writes: { albedo: "multiply" }, mask: { kind: "height", from: 0, to: MINIATURE.chiaroTop },
    storage: "vertex", why: "MULTIPLY by a top-down gradient and an underside shade: the zenithal prime of a miniature (light from above), faded out above the shoulders" });
  per("edge", "edge highlight", legacy ? { albedo: "screenLift" } : { albedo: "screenLift", roughness: "add" }, convex,
    "LIFT (screen) toward the highlight colour, masked by convex fine curvature OR up-facing below the shoulders", (m) => m.edge > 0);
  per("glaze", "glaze", { albedo: "color" }, { kind: "all" },
    "COLOR blend (hue+saturation of the glaze, luminosity kept) at <= 15 %: a transparent filter that unifies without undoing values", (m) => m.glaze.opacity > 0);
  L.push({ id: "*.guard", name: "value guard", step: "guard", material: "*", enabled: true, opacity: 1, writes: { albedo: "valueGuard" }, mask: { kind: "all" }, storage: "vertex",
    why: `no channel below (1 − ${PAINT_MAX_DARK}) × the basecoat, none above 1: paint modulates a cel band, never invents a contour` });
  per("varnish", "varnish", { roughness: "lerp" }, { kind: "all" },
    "roughness LERP toward the varnish (matte/satin/gloss): the last coat sets the sheen", (m) => m.varnish.opacity > 0);
  per("relief", "relief (vertex)", { height: "heightBlend", roughness: "lerp", albedo: "normal" }, { kind: "pattern", layer: "relief" },
    "per-vertex relief from a pattern (hide plates, studs, fur clumps), heightBlend = soft max so features never stack", (m) => !!m.relief);
  per("relief", "relief (fragment)", { height: "add" }, { kind: "all" },
    "sub-cell relief (pores, weave, grain, hammering, strands) evaluated per fragment by lane R from bind-pose position", (m) => !!m.detail, "fragment");
  // Give the fragment relief its own id suffix so ids stay unique.
  for (const l of L) if (l.storage === "fragment") l.id = `${l.material}.relief-fragment`;
  return L;
}

/** The exact wave-V FormShade + wave-GEN Miniature paint as a finish stack. */
export function legacyFinish(garment: readonly string[] = []): FinishStack {
  const cloth = garment.filter((r) => !FORM_SKIP.includes(r));
  const skin: MaterialFinish = { ...SKIN_LEGACY, id: "skin", kind: "skin", label: "Skin (wave V/GEN)", regions: REGIONS.filter((r) => !cloth.includes(r)) as Region[] };
  const mats: MaterialFinish[] = [skin];
  if (cloth.length) mats.push({ ...SKIN_LEGACY, id: "cloth", kind: "legacyCloth", label: "Cloth (wave V/GEN)", ridge: WEAR_LIGHT, weather: 1, regions: [...cloth] as Region[] });
  const rm = new Int8Array(REGIONS.length);
  for (let i = 0; i < REGIONS.length; i++) rm[i] = cloth.includes(REGIONS[i]) ? 1 : 0;
  return { id: "legacy", materials: mats, regionMaterial: rm, layers: workflowLayers(mats, true), skip: FORM_SKIP, legacy: true };
}

/** Options of a preset: the outfit (default: by class), and garment kinds per slot. */
export interface PresetOptions {
  outfit?: GarmentSlot[];
  /** Replace the kind of an outfit slot (e.g. { torso: "linen" }). */
  kinds?: Record<string, GarmentKind>;
}

/** A material preset for a subject: its finish stack plus the v1 basecoat stack and the fragment details. */
export interface MaterialPreset {
  id: string;
  race: string;
  subrace: string | null;
  finish: FinishStack;
  /** The v1 basecoat stack (skin recipe without the legacy garment + the slot basecoats). */
  basecoat: { layers: PaintLayer[] };
  /** Fragment relief per material (lane R): regions + the detail. */
  details: { material: string; regions: Region[]; detail: FragmentDetail }[];
  slots: (GarmentSlot & { colour: string })[];
}

/** The skin colour the recipe paints (its first, opaque layer). */
function recipeSkin(subject: PaintSubject): string { return stackFor({ ...subject, garment: undefined }).layers[0].colour; }

/** The material preset of a subject (deterministic per subject). `subject.garment` = the primary colour; absent = bare. */
export function presetFor(subject: PaintSubject, options: PresetOptions = {}): MaterialPreset {
  const race = subject.race, subrace = subject.subrace ?? null;
  const sp = skinPresetFor(race, subrace), nat = naturalColoursFor(race, subrace);
  const skinHex = recipeSkin(subject);
  const base = stackFor({ ...subject, garment: undefined });
  const outfit = subject.garment
    ? (options.outfit ?? CLASS_OUTFIT[subject.className ?? ""] ?? CLASS_OUTFIT.default).map((s) => ({ ...s, kind: options.kinds?.[s.slot] ?? s.kind, regions: [...s.regions] }))
    : [];
  const slots: (GarmentSlot & { colour: string })[] = [];
  let salt = 900;
  const seedOf = () => layerSeed(subject.seed, ++salt);
  for (const s of outfit) {
    const natural = s.kind === "metalTrim" ? nat.metal : s.kind === "fur" ? nat.fur : s.kind === "wool" || s.kind === "linen" ? subject.garment! : nat.leather;
    let colour = boundColour(mixHexSrgb(natural, subject.garment!, LOOK_SHARE[s.kind]), INK_BOUNDS);
    if (s.kind !== "metalTrim") colour = legibleGarment(colour, skinHex);
    slots.push({ ...s, colour });
    base.layers.push({ name: `garment-${s.slot}`, pattern: "solid", colour, opacity: 1, blend: "normal", scale: 1, seed: seedOf(), regions: [...s.regions] });
    // The material's pattern in the basecoat: weave noise on cloth, grain on leather, strands on fur, brushed metal.
    const tex: Record<GarmentKind, PaintLayer> = {
      wool: { name: `weave-${s.slot}`, pattern: "noise", colour: shadeHex(colour, 0.85), opacity: 0.35, blend: "overlay", scale: 0.04, seed: seedOf(), regions: [...s.regions], params: { contrast: 2, octaves: 2 } },
      linen: { name: `weave-${s.slot}`, pattern: "noise", colour: shadeHex(colour, 0.9), opacity: 0.25, blend: "overlay", scale: 0.05, seed: seedOf(), regions: [...s.regions], params: { contrast: 1.5, octaves: 2 } },
      leather: { name: `grain-${s.slot}`, pattern: "noise", colour: shadeHex(colour, 0.8), opacity: 0.15, blend: "softLight", scale: 0.08, seed: seedOf(), regions: [...s.regions], params: { contrast: 2, octaves: 3 } },
      studdedLeather: { name: `grain-${s.slot}`, pattern: "noise", colour: shadeHex(colour, 0.8), opacity: 0.15, blend: "softLight", scale: 0.08, seed: seedOf(), regions: [...s.regions], params: { contrast: 2, octaves: 3 } },
      metalTrim: { name: `brushed-${s.slot}`, pattern: "noise", colour: tintHex(colour, 0.15), opacity: 0.25, blend: "overlay", scale: 0.05, seed: seedOf(), regions: [...s.regions], params: { contrast: 1.5, octaves: 2 } },
      fur: { name: `strands-${s.slot}`, pattern: "stripes", colour: shadeHex(colour, 0.7), opacity: 0.4, blend: "multiply", scale: 0.05, seed: seedOf(), regions: [...s.regions], params: { angle: Math.PI / 2, width: 0.4, warp: 1.4 } },
    };
    base.layers.push(tex[s.kind]);
  }
  // Materials.
  const covered = new Set(slots.flatMap((s) => s.regions));
  const skinRegions = REGIONS.filter((r) => r !== "hair" && !covered.has(r)) as Region[];
  const skin: MaterialFinish = {
    id: "skin", kind: "skin", label: `Skin (${subrace ?? race})`, regions: skinRegions, colour: skinHex,
    roughness: sp.roughness, subsurface: sp.subsurface, heightOffset: 0,
    washColour: sp.washColour, formWash: sp.wash, cavityWash: sp.wash, washSat: 1, washRough: 0.03, layer: 0.25,
    ridge: RIDGE_LIGHT * PRESET_EDGE.ridge, edge: sp.edge * PRESET_EDGE.skin, edgeTint: PRESET_EDGE.tint, highlight: sp.highlight, edgeRough: -0.03,
    glaze: { colour: sp.glaze, opacity: sp.glazeOpacity, mask: "concave" }, varnish: { roughness: sp.roughness, opacity: 0, name: "none" }, weather: 0,
    relief: sp.hide ? { pattern: "scales", scale: 0.05, amplitude: sp.hide, params: { rimDepth: 0.5 } } : undefined,
    detail: { kind: sp.hide ? "plates" : "pores", periodMm: sp.porePeriodMm, amplitude: sp.poreAmp, octaves: 2 },
    regionRough: { face: -0.08, ear: -0.04, hand: 0.04, sole: 0.15, nail: -0.25, foot: 0.06 },
    regionSubsurface: { ear: 1.4, face: 1.15, hand: 1.1, nail: 0.4, sole: 0.6 },
    why: {
      roughness: sp.why.roughness, wash: sp.why.wash, glaze: sp.why.glaze,
      layer: "a quarter re-lay of the skin tone on the planes (blending, like a wet-blended layer)",
      edge: "highlight toward a warm/cool light of the race, not white", varnish: "skin is not varnished: its sheen is sebum, set at basecoat",
      subsurface: "thin skin (ears, lips, fingers) carries more warmth; scales/hide less",
    },
  };
  const hair: MaterialFinish = {
    ...SKIN_LEGACY, id: "hair", kind: "hair", label: "Hair", regions: ["hair"], roughness: 0.45, subsurface: 0.1,
    formWash: 0, cavityWash: 0, ridge: 0, edge: 0, why: { roughness: "hair cuticles: a soft sheen (the shader's strand pass adds the anisotropy)" },
  };
  const mats: MaterialFinish[] = [skin, hair];
  for (const s of slots) {
    const f = GARMENT_FINISH[s.kind];
    mats.push({ ...f, relief: f.relief ? { ...f.relief } : undefined, extraDetails: f.extraDetails?.map((d) => ({ ...d })), id: `garment.${s.slot}`, kind: s.kind, label: `${f.label} (${s.slot})`, regions: [...s.regions], colour: s.colour });
  }
  const rm = new Int8Array(REGIONS.length).fill(-1);
  mats.forEach((m, k) => { for (const r of m.regions) rm[REGIONS.indexOf(r)] = k; });
  const finish: FinishStack = { id: `preset:${race}/${subrace ?? "-"}`, materials: mats, regionMaterial: rm, layers: workflowLayers(mats, false), skip: FORM_SKIP, legacy: false };
  const details = mats.flatMap((m) => [...(m.detail ? [m.detail] : []), ...(m.extraDetails ?? [])].map((d) => ({ material: m.id, regions: [...m.regions], detail: { ...d } })));
  return { id: finish.id, race, subrace, finish, basecoat: base, details, slots };
}

/** presetFor for a saved character (seed = nameSeed(name)); the garment is Appearance.body. */
export function presetForProfile(profile: CharacterProfile, options: PresetOptions & { vertexSpacing?: number } = {}): MaterialPreset {
  const a = profile.appearance;
  return presetFor({
    race: profile.race, subrace: profile.subrace, className: profile.className, birthsign: profile.birthsign,
    hair: a.hair, accent: a.accent, garment: a.body, height: a.height, vertexSpacing: options.vertexSpacing, sex: a.sex, seed: nameSeed(profile.name),
  }, options);
}

// ── Evaluation ───────────────────────────────────────────────────────────────────────────────────────────────

export interface FinishOptions {
  cell: number;
  /** FormShade.regionGain (seeded trunk knobs). */
  regionGain?: Partial<Record<string, { cavity?: number; ridge?: number }>>;
  strength?: number;
  /** Miniature gain (default FORM_SHADE_QA.miniature). */
  miniature?: number;
  /** v1 basecoat (sRGB array) for the pattern-relief layers (studs paint metal heads): PatternEnv reuse. */
  record?: { formMs?: number; miniatureMs?: number; vertices?: number };
}

/** The channels a finish produces. albedo is LINEAR rgb (3 per vertex), like paintVertices. */
export interface FinishResult {
  albedo: Float32Array;
  roughness?: Float32Array;
  height?: Float32Array;
  ao?: Float32Array;
  subsurface?: Float32Array;
  /** Fine edge highlight weight per vertex (0..1, EDGE_CREST; lane R draws it per fragment). Preset (non-legacy) only. */
  crest?: Float32Array;
}

const toS = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const toL = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const smooth01 = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** W3C compositing Lum / ClipColor / SetLum (non-separable blend modes), sRGB. */
const lumW = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;
function setLum(r: number, g: number, b: number, l: number, out: number[]): void {
  const d = l - lumW(r, g, b);
  r += d; g += d; b += d;
  const L = lumW(r, g, b), n = Math.min(r, g, b), x = Math.max(r, g, b);
  if (n < 0) { const k = L - n; if (k > 1e-12) { r = L + (r - L) * L / k; g = L + (g - L) * L / k; b = L + (b - L) * L / k; } else { r = g = b = L; } }
  if (x > 1) { const k = x - L; if (k > 1e-12) { r = L + (r - L) * (1 - L) / k; g = L + (g - L) * (1 - L) / k; b = L + (b - L) * (1 - L) / k; } else { r = g = b = L; } }
  out[0] = r; out[1] = g; out[2] = b;
}
/** The W3C COLOR blend of top (s) over base (b): SetLum(Cs, Lum(Cb)). */
export function colorBlend(br: number, bg: number, bb: number, sr: number, sg: number, sb: number, out: number[] = [0, 0, 0]): number[] {
  setLum(sr, sg, sb, lumW(br, bg, bb), out);
  return out;
}

/** Operator codes for a creator override on a finish layer (L's vocabulary). */
function overrideCode(l: PresetLayer, ch: PresetChannel): { colour?: number; scalar?: number } | null {
  const op = l.override?.[ch];
  if (!op) return null;
  return ch === "albedo" ? { colour: colorModeCode(op) } : { scalar: scalarOpCode(op) };
}

/**
 * Evaluate a finish stack over a mesh whose basecoat is `rgb` (LINEAR, 3 per vertex; modified in place for the
 * albedo like applyFormShade). LAYER BY LAYER, in `stack.layers` order: each layer runs its operator over the
 * vertices of its material (per-vertex operations are independent, so splitting the fused wave-V/GEN loops into
 * layers keeps every IEEE result: the legacy stack reproduces applyFormShade byte for byte, TX60).
 * A layer with a creator operator override (`override[channel]`, L's COLOR_OPS / SCALAR_OPS) runs that operator
 * instead, on the step's own (top colour, alpha): wash top = 1 − peak·(1 − pigment), edge top = the highlight,
 * layer top = the basecoat, glaze top = the glaze, weather top = the grime, prime top = the zenithal grey.
 */
export function evaluateFinish(mesh: MeshData, rgb: Float32Array, stack: FinishStack, opts: FinishOptions): FinishResult {
  const g = opts.strength ?? 1;
  const n = mesh.positions.length / 3;
  const scalar = !stack.legacy;
  const res: FinishResult = { albedo: rgb };
  if (scalar) {
    res.roughness = new Float32Array(n).fill(0.5); res.height = new Float32Array(n); res.ao = new Float32Array(n).fill(1); res.subsurface = new Float32Array(n);
    res.crest = new Float32Array(n);
  }
  if (g <= 0 && !scalar) return res;
  const t0 = performance.now();
  const adj = vertexRings(mesh);
  const mats = stack.materials, rm = stack.regionMaterial, R = mesh.region;
  const skip = new Uint8Array(REGIONS.length);
  for (const r of stack.skip) skip[REGIONS.indexOf(r as typeof REGIONS[number])] = 1;
  const strength = (l: PresetLayer) => l.enabled ? Math.max(0, Math.min(1, Number.isFinite(l.opacity) ? l.opacity : 0)) : 0;
  const matIndex = new Map(mats.map((m, k) => [m.id, k]));
  const weatherOn = new Set(stack.layers.filter((l) => l.step === "weather" && strength(l) > 0).map((l) => l.material));
  const garment = REGIONS.filter((_, k) => rm[k] >= 0 && mats[rm[k]].weather > 0 && weatherOn.has(mats[rm[k]].id)) as string[];
  const gc = new Float32Array(REGIONS.length).fill(1), gr = new Float32Array(REGIONS.length).fill(1);
  for (const [r, v] of Object.entries(opts.regionGain ?? {})) {
    const i = REGIONS.indexOf(r as typeof REGIONS[number]);
    if (i >= 0 && v) { gc[i] = v.cavity ?? 1; gr[i] = v.ridge ?? 1; }
  }
  const mini = g * (opts.miniature ?? FORM_SHADE_QA.miniature);
  const { cavity, ridge } = formTerms(mesh, { cell: opts.cell }, adj);
  // Material constants, precomputed so a gain of exactly 1 reproduces the legacy constant exactly.
  const mc = mats.map((m) => {
    const w = hexToRgb(m.washColour), h = hexToRgb(m.highlight), z = hexToRgb(m.glaze.colour);
    return {
      formDark: CAVITY_DARK * m.formWash, aoDark: MINIATURE.aoDark * m.cavityWash, aoSat: MINIATURE.aoSat * m.washSat,
      edgeLight: MINIATURE.edgeLight * m.edge, edgeTint: m.edgeTint, w: [1 - w[0], 1 - w[1], 1 - w[2]], h, z,
      weatherMax: MINIATURE.weatherMax * m.weather, weatherFade: MINIATURE.weatherFade * m.weather,
    };
  });
  // Vertex lists: per material (non-skipped) and the skipped vertices per material (glaze only reaches those).
  const verts: number[][] = mats.map(() => []), skipped: number[][] = mats.map(() => []);
  const free: number[] = [];
  for (let i = 0; i < n; i++) {
    const reg = R[i], k = rm[reg];
    if (skip[reg]) { if (k >= 0) skipped[k].push(i); continue; }
    free.push(i);
    if (k >= 0) verts[k].push(i);
  }
  // s0 = sRGB basecoat, S = the working canvas (Float64: the off path stays bit-exact).
  const s0 = new Float64Array(n * 3), S = new Float64Array(n * 3);
  for (let i = 0; i < n * 3; i++) { s0[i] = toS(rgb[i]); S[i] = s0[i]; }
  const touched = new Uint8Array(n);
  for (const i of free) touched[i] = 1;
  const t1 = performance.now();
  const terms: MiniatureTerms | null = mini > 0 || scalar ? miniatureTerms(mesh, adj, { cell: opts.cell, garment }) : null;
  const relief = scalar ? reliefCoverage(mesh, stack) : null;
  // Geometric occlusion (closing, F): cached per mesh object, so a warm rig build pays nothing.
  const occl = scalar ? meshOcclusion(mesh, { adj }) : null;
  const crestNorm = 1 / (MINIATURE.edgeLight * PRESET_EDGE.skin);
  // No crest LINE on hands and feet: toes and knuckles are a few vertices at this cell, and a thresholded line there
  // prints blotches (vision on the closing capture: "triangular patches on the toes"); they keep the vertex highlight.
  let crestGain = 0;
  const crestSkip = new Uint8Array(REGIONS.length);
  for (const r of ["hand", "foot", "sole"]) { const k = REGIONS.indexOf(r as typeof REGIONS[number]); if (k >= 0) crestSkip[k] = 1; }
  const primeLayer = stack.layers.find((l) => l.id === "*.prime");
  const gp = mini * (primeLayer ? strength(primeLayer) : 0);
  const M = MINIATURE, N = mesh.normals, lo = 1 - PAINT_MAX_DARK;
  const tmp = [0, 0, 0];
  const Rg = res.roughness, Hh = res.height, A = res.ao, SS = res.subsurface;
  const [r0, r1] = CHANNEL_RANGE.roughness, [h0, h1] = CHANNEL_RANGE.height;
  // A generic step with an overridden albedo operator: S += (op(S, top) − S)·alpha (L's blendRgb, sRGB).
  const generic = (code: number, i: number, tr: number, tg: number, tb: number, a: number) => {
    if (!(a > 0)) return;
    blendRgb(code, S[i * 3], S[i * 3 + 1], S[i * 3 + 2], tr, tg, tb, tmp, 0);
    for (let q = 0; q < 3; q++) S[i * 3 + q] += (tmp[q] - S[i * 3 + q]) * a;
  };
  const scalarWrite = (arr: Float32Array, i: number, l: PresetLayer, ch: PresetChannel, def: number, value: number, a: number, p0 = 0, lo2 = r0, hi2 = r1) => {
    const ov = overrideCode(l, ch);
    arr[i] = scalarComposite(ov ? ov.scalar! : def, arr[i], value, a, p0, 0, 0, 0, lo2, hi2);
  };
  const ADD = scalarOpCode("add"), LERP = scalarOpCode("lerp"), REPLACE = scalarOpCode("replace"), MULT = scalarOpCode("multiply"), HB = scalarOpCode("heightBlend");
  for (const l of stack.layers) {
    const a0 = strength(l);
    if (a0 <= 0) continue;
    const k = matIndex.get(l.material) ?? -1;
    const m = k >= 0 ? mats[k] : null, c = k >= 0 ? mc[k] : null;
    const ovA = overrideCode(l, "albedo");
    const V = k >= 0 ? verts[k] : free;
    const kind = l.id.endsWith("-form") ? `${l.step}-form` : l.id === "*.clamp" ? "clamp" : l.step === "relief" && l.storage === "fragment" ? "fragment" : l.step;
    switch (kind) {
      case "basecoat": {
        if (!scalar || !m) break;
        for (const i of [...V, ...skipped[k]]) {
          const rn = REGIONS[R[i]];
          scalarWrite(Rg!, i, l, "roughness", REPLACE, m.roughness + (m.regionRough?.[rn] ?? 0), a0);
          scalarWrite(Hh!, i, l, "height", REPLACE, m.heightOffset, a0, 0, h0, h1);
          scalarWrite(SS!, i, l, "subsurface", REPLACE, m.subsurface * (m.regionSubsurface?.[rn] ?? 1), a0, 0, 0, 1);
        }
        break;
      }
      case "wash-form": {
        for (const i of V) {
          const reg = R[i];
          const cav = g * gc[reg] * c!.formDark * cavity[i] * a0;
          if (ovA) { generic(ovA.colour!, i, 1 - c!.formDark * c!.w[0], 1 - c!.formDark * c!.w[1], 1 - c!.formDark * c!.w[2], cav / Math.max(1e-9, c!.formDark)); continue; }
          for (let q = 0; q < 3; q++) S[i * 3 + q] = S[i * 3 + q] * (1 - cav * c!.w[q]);
        }
        break;
      }
      case "edge-form": {
        for (const i of V) {
          const lift = g * gr[R[i]] * m!.ridge * ridge[i] * a0;
          if (ovA) { generic(ovA.colour!, i, c!.h[0], c!.h[1], c!.h[2], lift); continue; }
          for (let q = 0; q < 3; q++) S[i * 3 + q] += (c!.h[q] - S[i * 3 + q]) * lift;
        }
        break;
      }
      case "clamp": for (const i of free) for (let q = 0; q < 3; q++) S[i * 3 + q] = Math.max(0, Math.min(1, S[i * 3 + q])); break;
      case "weather": {
        if (!(mini > 0) || !terms || !(m!.weather > 0)) break;
        for (const i of V) {
          const w = mini * terms.weather[i] * a0;
          if (!(w > 0)) continue;
          if (ovA) { generic(ovA.colour!, i, M.grime[0], M.grime[1], M.grime[2], c!.weatherMax * w); continue; }
          let r = S[i * 3], gg = S[i * 3 + 1], b = S[i * 3 + 2];
          const mm = (r + gg + b) / 3, fade = c!.weatherFade * w, mix = c!.weatherMax * w;
          r += (mm - r) * fade; gg += (mm - gg) * fade; b += (mm - b) * fade;
          r += (M.grime[0] - r) * mix; gg += (M.grime[1] - gg) * mix; b += (M.grime[2] - b) * mix;
          S[i * 3] = r; S[i * 3 + 1] = gg; S[i * 3 + 2] = b;
        }
        break;
      }
      case "wash": {
        if (terms && scalar) {
          for (const i of [...V, ...skipped[k]]) {
            const cv = Math.max(terms.ao[i], skip[R[i]] ? 0 : cavity[i]);
            scalarWrite(Rg!, i, l, "roughness", ADD, m!.washRough, cv * a0);
            scalarWrite(A!, i, l, "ao", MULT, (1 - AO_SHARE * terms.ao[i]) * occlusionAo(occl![i]), a0, 0, 0, 1);
          }
        }
        if (!(mini > 0) || !terms) break;
        for (const i of V) {
          const ao = mini * terms.ao[i] * a0;
          if (!(ao > 0)) continue;
          if (ovA) { generic(ovA.colour!, i, 1 - c!.aoDark * c!.w[0], 1 - c!.aoDark * c!.w[1], 1 - c!.aoDark * c!.w[2], ao); continue; }
          const r = S[i * 3], gg = S[i * 3 + 1], b = S[i * 3 + 2];
          const mm = (r + gg + b) / 3, sat = 1 + c!.aoSat * ao, kd = c!.aoDark * ao;
          S[i * 3] = (mm + (r - mm) * sat) * (1 - kd * c!.w[0]); S[i * 3 + 1] = (mm + (gg - mm) * sat) * (1 - kd * c!.w[1]); S[i * 3 + 2] = (mm + (b - mm) * sat) * (1 - kd * c!.w[2]);
        }
        break;
      }
      case "layer": {
        if (!(mini > 0) || !terms) break;
        for (const i of V) {
          const a = m!.layer * mini * (1 - Math.max(terms.ao[i], cavity[i])) * a0;
          if (!(a > 0)) continue;
          if (ovA) { generic(ovA.colour!, i, s0[i * 3], s0[i * 3 + 1], s0[i * 3 + 2], a); continue; }
          for (let q = 0; q < 3; q++) S[i * 3 + q] += (s0[i * 3 + q] - S[i * 3 + q]) * a;
        }
        break;
      }
      case "prime": {
        if (!(mini > 0) || !terms) break;
        for (const i of free) {
          if (rm[R[i]] < 0) continue;
          const t = terms.height[i];
          const below = 1 - smooth01(M.chiaroTop, M.chiaroTop + M.chiaroFade, t);
          const chiaro = 1 - gp * M.chiaroDark * (1 - smooth01(0, M.chiaroTop, t));
          const zenDark = 1 - gp * below * M.zenithDark * Math.max(0, -N[i * 3 + 1]);
          const dk = chiaro * zenDark;
          if (ovA) { generic(ovA.colour!, i, dk, dk, dk, 1); continue; }
          S[i * 3] *= dk; S[i * 3 + 1] *= dk; S[i * 3 + 2] *= dk;
        }
        break;
      }
      case "edge": {
        if (terms && scalar) {
          for (const i of V) scalarWrite(Rg!, i, l, "roughness", ADD, m!.edgeRough, Math.max(terms.edge[i], ridge[i]) * a0);
        }
        if (!(mini > 0) || !terms) break;
        // The crest LINE's strength follows this edge layer (its opacity, the material's edge gain), for skin only.
        if (m!.kind === "skin" && !ovA) crestGain = Math.max(crestGain, mini * c!.edgeLight * a0 * crestNorm);
        for (const i of V) {
          const t = terms.height[i];
          const below = 1 - smooth01(M.chiaroTop, M.chiaroTop + M.chiaroFade, t);
          const zen = gp > 0 ? gp * below * (M.zenithLight * Math.max(0, N[i * 3 + 1])) * a0 : 0;
          const edge = mini * terms.edge[i] * c!.edgeLight * a0;
          const lift = Math.min(1, edge + zen);
          if (!(lift > 0)) continue;
          const kk = c!.edgeTint * lift;
          if (ovA) { generic(ovA.colour!, i, c!.h[0], c!.h[1], c!.h[2], kk); continue; }
          for (let q = 0; q < 3; q++) S[i * 3 + q] += (c!.h[q] - S[i * 3 + q]) * kk;
        }
        break;
      }
      case "glaze": {
        if (!(mini > 0) || !terms) break;
        const gm = m!.glaze, code = ovA ? ovA.colour! : colorModeCode("color");
        for (const i of V) {
          const a = gm.opacity * a0 * (gm.mask === "concave" ? Math.max(terms.ao[i], cavity[i]) * 0.5 + 0.5 : 1);
          generic(code, i, c!.z[0], c!.z[1], c!.z[2], a);
        }
        // The curvature passes skip the face/ears/nails; the glaze reaches them (one hue family over the whole skin).
        for (const i of skipped[k]) {
          const a = gm.opacity * a0 * (gm.mask === "concave" ? 0.5 : 1);
          if (!(a > 0)) continue;
          generic(code, i, c!.z[0], c!.z[1], c!.z[2], a);
          for (let q = 0; q < 3; q++) S[i * 3 + q] = Math.max(0, Math.min(1, S[i * 3 + q]));
          touched[i] = 1;
        }
        break;
      }
      case "guard": {
        if (!(mini > 0)) break;
        for (const i of free) {
          if (rm[R[i]] < 0) continue;
          for (let q = 0; q < 3; q++) S[i * 3 + q] = Math.max(lo * s0[i * 3 + q], Math.min(1, S[i * 3 + q]));
        }
        break;
      }
      case "varnish": {
        if (!scalar) break;
        for (const i of [...V, ...skipped[k]]) scalarWrite(Rg!, i, l, "roughness", LERP, m!.varnish.roughness, a0, m!.varnish.opacity);
        break;
      }
      case "relief": {
        if (!scalar || !relief || !m!.relief) break;
        const rl = m!.relief, metal = rl.colour ? hexToRgb(rl.colour) : null;
        for (const i of V) {
          const a = relief[i] * a0;
          if (!(a > 0)) continue;
          // heightBlend (L's law): the plate/stud dome wins where it is taller, softly (w = 0.4 mm).
          scalarWrite(Hh!, i, l, "height", HB, rl.amplitude * relief[i], a0, 0.0004, h0, h1);
          if (rl.roughness !== undefined) scalarWrite(Rg!, i, l, "roughness", LERP, rl.roughness, a, 1);
          if (metal) {
            // the stud head: NORMAL toward the metal, lifted a quarter toward white (a tiny convex dome).
            if (ovA) { generic(ovA.colour!, i, metal[0] + (1 - metal[0]) * 0.25, metal[1] + (1 - metal[1]) * 0.25, metal[2] + (1 - metal[2]) * 0.25, a); continue; }
            for (let q = 0; q < 3; q++) S[i * 3 + q] = Math.max(0, Math.min(1, S[i * 3 + q] + (metal[q] + (1 - metal[q]) * 0.25 - S[i * 3 + q]) * a));
          }
        }
        break;
      }
      default: break; // fragment relief: lane R's shader
    }
  }
  for (let i = 0; i < n; i++) {
    if (!touched[i]) continue;
    for (let q = 0; q < 3; q++) rgb[i * 3 + q] = toL(S[i * 3 + q]);
  }
  // The crest LINE (closing, F). The painted edge term smooth(EDGE_ONSET, EDGE_FULL, kappa) almost never fires on the
  // body's own ridges at this cell (collarbone, deltoid, shin: kappa 0.2-0.4; body-skin edge p95 0.10-0.17, the high
  // values were hands and feet), so the line takes the RIDGE RANK of the body skin instead: smoothstep between the
  // p90 and p98 of the skin's fine curvature (hands, feet, face, ears, nails excluded), times the edge layer's gain.
  // Then one 1-ring mean, so a lone high vertex (a star of triangles) does not print a blob and the contour follows the
  // ridge; the shader thresholds it per fragment.
  if (res.crest && terms && crestGain > 0) {
    const sk = mats.findIndex((mm) => mm.kind === "skin");
    const ks: number[] = [];
    if (sk >= 0) for (const i of verts[sk]) if (!crestSkip[R[i]]) ks.push(terms.kappa[i]);
    ks.sort((a, b) => a - b);
    if (ks.length > 20) {
      const k0 = ks[Math.floor(0.9 * (ks.length - 1))], k1 = Math.max(k0 + 1e-6, ks[Math.floor(0.98 * (ks.length - 1))]);
      for (const i of verts[sk]) if (!crestSkip[R[i]]) res.crest[i] = Math.min(1, crestGain * smooth01(k0, k1, terms.kappa[i]));
    }
  }
  if (res.crest) {
    const c0 = res.crest, c1 = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = c0[i]; for (const j of adj[i]) s += c0[j]; c1[i] = s / (adj[i].length + 1); }
    res.crest = c1;
  }
  if (opts.record) { opts.record.formMs = t1 - t0; opts.record.miniatureMs = performance.now() - t1; opts.record.vertices = n; }
  return res;
}

/** Per-vertex coverage (0..1) of each material's relief pattern (0 where the material has none). */
export function reliefCoverage(mesh: MeshData, stack: FinishStack): Float32Array | null {
  const n = mesh.positions.length / 3;
  const any = stack.materials.some((m) => m.relief);
  if (!any) return null;
  const env = buildPatternEnv(mesh);
  const out = new Float32Array(n), sample = { coverage: 0, mix: 0 };
  const P = mesh.positions, N = mesh.normals;
  stack.materials.forEach((m, k) => {
    if (!m.relief) return;
    const seed = layerSeed(nameHash(m.id), 3);
    const layer: PaintLayer = { name: `${m.id}-relief`, pattern: m.relief.pattern, colour: "#ffffff", opacity: 1, blend: "normal", scale: m.relief.scale, seed, params: m.relief.params };
    const ctx = makePatternContext(layer, env, makeNoise(seed));
    const fn = PATTERNS[m.relief.pattern];
    for (let i = 0; i < n; i++) {
      if (stack.regionMaterial[mesh.region[i]] !== k) continue;
      // Ork hide plates follow RecipeData: limbs, torso and shins, never the face/ears.
      if (m.kind === "skin" && !["upperArm", "foreArm", "torso", "hand", "shin", "thigh"].includes(REGIONS[mesh.region[i]])) continue;
      const o = i * 3;
      fn(ctx, P[o], P[o + 1], P[o + 2], N[o], N[o + 1], N[o + 2], mesh.region[i], sample);
      // scales: coverage is the plate, mix the rim (rim sits lower); spots: coverage = the stud; noise: mix = height
      out[i] = m.relief.pattern === "noise" ? sample.mix * sample.coverage : m.relief.pattern === "scales" ? sample.coverage * (1 - 0.5 * sample.mix) : sample.coverage;
    }
  });
  return out;
}

function nameHash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

/** Paint a body with a preset: basecoat (v1 stack) + the finish. Returns the channels (albedo LINEAR). */
export function paintPreset(mesh: MeshData, preset: MaterialPreset, opts: FinishOptions): FinishResult {
  const base = paintVertices(mesh, preset.basecoat);
  return evaluateFinish(mesh, base, preset.finish, opts);
}

/** The subject of a BodySpec + look (what PaintStage paints). */
export function subjectOfSpec(spec: BodySpec, look: { hair?: string; accent?: string; garment?: string }, cell: number): PaintSubject {
  return {
    race: spec.race, subrace: spec.subrace, className: spec.className, birthsign: spec.birthsign ?? null,
    hair: look.hair, accent: look.accent, garment: look.garment || undefined, height: spec.height, vertexSpacing: cell, seed: spec.seed,
    sex: (spec as { sex?: PaintSubject["sex"] }).sex,
  };
}

// ── Tables (for docs/wave-tex/ART.md, generated by code) ─────────────────────────────────────────────────────

/** Rows of the skin preset table (race, sub-race, roughness, subsurface, pores, wash, glaze, why). */
export function skinTable(): string[][] {
  const rows: string[][] = [];
  for (const [race, subs] of Object.entries(RACE_SUBRACES)) {
    for (const s of [race, ...subs]) {
      const p = SKIN_PRESETS[s];
      rows.push([race, s === race ? "(race default)" : s, p.roughness.toFixed(2), p.subsurface.toFixed(2), `${(p.poreAmp * 1000).toFixed(2)} mm @ ${p.porePeriodMm} mm${p.hide ? ` + plates ${(p.hide * 1000).toFixed(1)} mm` : ""}`,
        `\`${p.washColour}\` ×${p.wash}`, `\`${p.glaze}\` ${(p.glazeOpacity * 100).toFixed(0)} %`, p.why.roughness]);
    }
  }
  return rows;
}

/** Rows of the garment table. */
export function garmentTable(): string[][] {
  return GARMENT_KINDS.map((k) => {
    const f = GARMENT_FINISH[k];
    return [f.label, f.roughness.toFixed(2), `${f.varnish.name} ${f.varnish.roughness} @ ${(f.varnish.opacity * 100).toFixed(0)} %`, `\`${f.washColour}\` ×${f.cavityWash}`, f.layer.toFixed(2),
      `×${f.edge} tint ${f.edgeTint} \`${f.highlight}\` rough ${f.edgeRough >= 0 ? "+" : ""}${f.edgeRough}`, f.glaze.opacity > 0 ? `\`${f.glaze.colour}\` ${(f.glaze.opacity * 100).toFixed(0)} %` : "—",
      f.relief ? `${f.relief.pattern} ${(f.relief.amplitude * 1000).toFixed(1)} mm / ${(f.relief.scale * 100).toFixed(0)} cm` : f.heightOffset ? `+${(f.heightOffset * 1000).toFixed(1)} mm` : "—",
      f.detail ? `${f.detail.kind} ${(f.detail.amplitude * 1000).toFixed(2)} mm @ ${f.detail.periodMm} mm` : "—", `×${f.weather}`, f.why.roughness ?? ""];
  });
}


// ── Overrides and the v2 export (lane L's LayerStack) ────────────────────────────────────────────────────────

/**
 * Apply the creator's overrides (lane U, appearance.layerOverrides; L's LayerOverride shape) to a preset's finish.
 * Ids are the finish ids ("skin.wash") or the v2 ids ("p:skin.wash"); unknown ids are ignored; total.
 *   enabled / opacity  exact: opacity multiplies the layer's strength (0 or disabled skips the operator).
 *   blend              per channel, an operator from L's COLOR_OPS (albedo) / SCALAR_OPS (scalars) replaces the
 *                      step's own on its (top, alpha) — see evaluateFinish. Locked (ignored, EDIT_LOCKED): the clamp
 *                      and the value guard (they reference the basecoat, no operator applies), a channel the layer
 *                      does not write, and an op of the wrong kind for the channel.
 *   order              moves the layer to that index in the finish (stable; the others keep their relative order).
 */
export function applyPresetOverrides(preset: MaterialPreset, overrides: readonly LayerOverride[] | undefined): MaterialPreset {
  if (!overrides || overrides.length === 0) return preset;
  const byId = new Map<string, LayerOverride>();
  for (const o of overrides) if (o && typeof o.id === "string") { const id = o.id.startsWith("p:") ? o.id.slice(2) : o.id; byId.set(id, { ...byId.get(id), ...o }); }
  const colour = new Set<string>(COLOR_OPS), scal = new Set<string>(SCALAR_OP_IDS);
  let layers = preset.finish.layers.map((l) => {
    const o = byId.get(l.id);
    if (!o) return l;
    const n: PresetLayer = { ...l };
    if (typeof o.enabled === "boolean") n.enabled = o.enabled;
    if (typeof o.opacity === "number" && Number.isFinite(o.opacity)) n.opacity = Math.max(0, Math.min(1, o.opacity));
    if (o.blend && !EDIT_LOCKED.has(l.id)) {
      for (const [ch, op] of Object.entries(o.blend)) {
        if (!op || !(ch in l.writes)) continue;
        if (ch === "albedo" ? colour.has(op) : scal.has(op)) n.override = { ...(n.override ?? {}), [ch]: op as OperatorId };
      }
    }
    return n;
  });
  const moves = layers.map((l, i) => ({ l, i, o: byId.get(l.id)?.order })).filter((e) => typeof e.o === "number" && Number.isFinite(e.o) && e.o !== e.i);
  if (moves.length) {
    const key = new Map(layers.map((l, i) => [l, i]));
    for (const e of moves) key.set(e.l, e.o! < e.i ? e.o! - 0.5 : e.o! + 0.5);
    layers = layers.map((l, i) => ({ l, i, k: key.get(l)! })).sort((a, b) => a.k - b.k || a.i - b.i).map((e) => e.l);
  }
  return { ...preset, finish: { ...preset.finish, layers } };
}

/** Layer ids whose operator a creator may not change (they reference the basecoat; no L operator applies). */
export const EDIT_LOCKED: ReadonlySet<string> = new Set(["*.clamp", "*.guard"]);

/** For the creator's pickers: the operators the GAME path can really run on a finish layer, per channel it writes. */
export function editableOps(layer: PresetLayer): Partial<Record<PresetChannel, readonly OperatorId[]>> {
  if (EDIT_LOCKED.has(layer.id) || layer.storage === "fragment") return {};
  const out: Partial<Record<PresetChannel, readonly OperatorId[]>> = {};
  for (const ch of Object.keys(layer.writes) as PresetChannel[]) out[ch] = ch === "albedo" ? COLOR_OPS : SCALAR_OP_IDS;
  return out;
}

const V2_FIELD: Record<string, MaskExpr> = {
  concaveForm: { op: "curvature", sign: "concave", lo: 0.03, hi: 0.16 },
  concaveBroad: { op: "ao", lo: MINIATURE.aoOnset, hi: MINIATURE.aoFull },
  convexForm: { op: "curvature", sign: "convex", lo: 0.18, hi: 0.42 },
  convexEdge: { op: "curvature", sign: "convex", lo: MINIATURE.edgeOnset, hi: MINIATURE.edgeFull },
};

function v2Mask(m: PresetMask): MaskExpr | undefined {
  switch (m.kind) {
    case "all": return undefined;
    case "concave": return m.source === "form" ? V2_FIELD.concaveForm : m.source === "cavity" ? V2_FIELD.concaveBroad : { op: "or", a: V2_FIELD.concaveForm, b: V2_FIELD.concaveBroad, mode: "max" };
    case "convex": return m.source === "form" ? V2_FIELD.convexForm : V2_FIELD.convexEdge;
    case "or": return { op: "or", a: v2Mask(m.a) ?? { op: "constant", value: 1 }, b: v2Mask(m.b) ?? { op: "constant", value: 1 }, mode: "sum" };
    case "and": return { op: "and", a: v2Mask(m.a) ?? { op: "constant", value: 1 }, b: v2Mask(m.b) ?? { op: "constant", value: 1 }, mode: "product" };
    case "invert": return { op: "invert", a: v2Mask(m.a) ?? { op: "constant", value: 1 } };
    case "upFacing": return { op: "direction", dir: [0, 1, 0], lo: 0, hi: 1 };
    case "height": return { op: "invert", a: { op: "height", source: "body", lo: m.from, hi: m.to } };
    case "garment": return undefined;
    case "pattern": return undefined;
  }
}

/**
 * The preset as a v2 LayerStack (L's types) — the INSPECTABLE / overridable form for the creator and for
 * L's evaluateStack: group "basecoat" = stackFromV1(the v1 basecoat) + per-material scalar basecoats, then one
 * layer per finish layer (ids "p:<finish id>") with L's operators: wash = multiply (colour = wash pigment,
 * mask = concave curvature / AO), edge = normal toward the highlight (for a white highlight this IS screen with a
 * grey of the mask), layer = normal toward the material colour masked by invert(concave), glaze = color,
 * varnish = roughness lerp, relief = pattern source -> height heightBlend, fragment relief = stage "fragment".
 * The value guard and the clamp have no v2 operator (they reference the basecoat): exported disabled, named so.
 * The game paint is `evaluateFinish` (exact wave-V/GEN arithmetic); this export is its editable description.
 */
export function presetToV2(preset: MaterialPreset): LayerStackV2 {
  const base = stackFromV1(preset.basecoat);
  const mats = new Map(preset.finish.materials.map((m) => [m.id, m]));
  // One scalar basecoat per (material, distinct regional roughness/subsurface) group, so the regional offsets survive.
  const scalarBase: V2Layer[] = preset.finish.materials.flatMap((m) => {
    const groups = new Map<string, Region[]>();
    for (const r of m.regions) {
      const key = `${m.roughness + (m.regionRough?.[r] ?? 0)}|${m.subsurface * (m.regionSubsurface?.[r] ?? 1)}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    return [...groups.entries()].map(([key, regions], gi): V2Layer => {
      const [rough, ss] = key.split("|").map(Number);
      return {
        kind: "layer", id: `p:${m.id}.basecoat-material${gi ? `.${regions.join("-")}` : ""}`, name: `${m.label} — roughness/height/subsurface${gi ? ` (${regions.join(", ")})` : ""}`,
        enabled: true, opacity: 1, regions, source: { kind: "constant", value: 0 },
        writes: [
          { channel: "roughness", op: "replace", value: Math.max(CHANNEL_RANGE.roughness[0], Math.min(1, rough)) },
          { channel: "height", op: "replace", value: m.heightOffset },
          { channel: "subsurface", op: "replace", value: Math.max(0, Math.min(1, ss)) },
        ],
      };
    });
  });
  const group: LayerGroup = { kind: "group", id: "p:basecoat", name: "basecoat", enabled: true, opacity: 1, children: [...base.nodes, ...scalarBase] };
  const nodes: (V2Layer | LayerGroup)[] = [group];
  for (const l of preset.finish.layers) {
    if (l.step === "basecoat") continue;
    const m = mats.get(l.material);
    // Curvature-driven steps skip FORM_SKIP (face, ears, nails, soles, hair) exactly as the evaluator does.
    const geometric = l.step !== "glaze" && l.step !== "varnish" && !(l.step === "relief" && l.storage === "fragment");
    const regions = m ? (geometric ? m.regions.filter((r) => !preset.finish.skip.includes(r)) : [...m.regions]) : REGIONS.filter((r) => !preset.finish.skip.includes(r)) as Region[];
    const id = `p:${l.id}`, common = { kind: "layer" as const, id, name: l.name, enabled: l.enabled, opacity: l.opacity, regions, mask: v2Mask(l.mask) };
    const src = { kind: "constant" as const, value: 1 };
    if (!m) {
      // prime / clamp / guard
      if (l.step === "prime") nodes.push({ ...common, source: { kind: "field", field: "bodyHeight" }, writes: [{ channel: "albedo", op: "multiply", colour: shadeHex("#ffffff", 1 - MINIATURE.chiaroDark), colour2: "#ffffff" }] });
      else nodes.push({ ...common, name: `${l.name} (evaluator-only: references the basecoat)`, enabled: false, source: src, writes: [] });
      continue;
    }
    switch (l.step) {
      case "wash": nodes.push({ ...common, source: src, writes: l.id.endsWith("-form")
        ? [{ channel: "albedo", op: "multiply", colour: mixHexSrgb("#ffffff", m.washColour, CAVITY_DARK * m.formWash) }]
        : [{ channel: "albedo", op: "multiply", colour: mixHexSrgb("#ffffff", m.washColour, MINIATURE.aoDark * m.cavityWash) }, { channel: "roughness", op: "add", value: m.washRough }, { channel: "ao", op: "multiply", value: 1 - AO_SHARE }] }); break;
      case "edge": nodes.push({ ...common, mask: l.id.endsWith("-form") ? common.mask : {
        op: "or", mode: "sum", a: V2_FIELD.convexEdge,
        // the zenithal top light shares the edge lift: up-facing below the shoulders, scaled to zenithLight / edgeLight
        b: { op: "scale", k: MINIATURE.zenithLight / Math.max(1e-6, MINIATURE.edgeLight * m.edge), a: { op: "and", mode: "product", a: { op: "direction", dir: [0, 1, 0], lo: 0, hi: 1 }, b: { op: "invert", a: { op: "height", source: "body", lo: MINIATURE.chiaroTop, hi: MINIATURE.chiaroTop + MINIATURE.chiaroFade } } } },
      }, source: src, writes: [{ channel: "albedo", op: "normal", colour: m.highlight, opacity: l.id.endsWith("-form") ? m.ridge : m.edgeTint * MINIATURE.edgeLight * m.edge }, ...(l.id.endsWith("-form") ? [] : [{ channel: "roughness" as const, op: "add" as const, value: m.edgeRough }])] }); break;
      case "layer": nodes.push({ ...common, source: src, writes: [{ channel: "albedo", op: "normal", colour: m.colour ?? "#808080", opacity: m.layer }] }); break;
      case "glaze": nodes.push({ ...common, source: src, writes: [{ channel: "albedo", op: "color", colour: m.glaze.colour, opacity: m.glaze.opacity }] }); break;
      case "varnish": nodes.push({ ...common, source: src, writes: [{ channel: "roughness", op: "lerp", value: m.varnish.roughness, params: [m.varnish.opacity, 0, 0, 0] }] }); break;
      case "weather": nodes.push({ ...common, source: { kind: "field", field: "cavity" }, writes: [{ channel: "albedo", op: "normal", colour: "#5c5245", opacity: MINIATURE.weatherMax * m.weather }] }); break;
      case "relief":
        if (l.storage === "fragment" && m.detail) {
          [m.detail, ...(m.extraDetails ?? [])].forEach((d, di) => {
            const cellular = d.kind === "pores" || d.kind === "plates" || d.kind === "studs";
            nodes.push({ ...common, id: di ? `${id}.${d.kind}` : id, name: di ? `${l.name}: ${d.kind}` : l.name, stage: "fragment",
              source: { kind: "noise", expr: { op: cellular ? "worley" : "fbm", scale: d.periodMm / 1000, ...(cellular ? {} : { octaves: d.octaves }) } as NoiseExpr },
              writes: [{ channel: "height", op: "add", value: 0, value2: d.amplitude }] });
          });
        } else if (m.relief) {
          nodes.push({ ...common, mask: undefined, source: { kind: "pattern", pattern: m.relief.pattern, scale: m.relief.scale, params: m.relief.params ? { ...m.relief.params } : undefined, seed: layerSeed(nameHash(m.id), 3) },
            // alpha = the pattern coverage; t = its mix: studs a flat dome height, plates lower at the rim, fur clumps by the noise
            writes: [{ channel: "height", op: "heightBlend", value: m.relief.pattern === "noise" ? 0 : m.relief.amplitude, value2: m.relief.pattern === "scales" ? m.relief.amplitude * 0.5 : m.relief.amplitude }, ...(m.relief.roughness !== undefined ? [{ channel: "roughness" as const, op: "lerp" as const, value: m.relief.roughness, params: [1, 0, 0, 0] }] : []),
              ...(m.relief.colour ? [{ channel: "albedo" as const, op: "normal" as const, colour: m.relief.colour }] : [])] });
        }
        break;
    }
  }
  return { version: 2, nodes };
}

/**
 * The preset painted into L's MaterialBuffers shape (what R uploads): albedo (LINEAR 3n), aMaterial (4n: roughness,
 * height, ao, subsurface — Channels.MATERIAL_LAYOUT), written channels, and the fragment layers (the preset's sub-cell
 * relief as L FragmentLayers, ids "p:<material>.relief-fragment"). The vertex paint is `evaluateFinish` — the exact
 * wave-V/GEN arithmetic plus the preset steps — so this, not evaluateStack(presetToV2(..)), is the game path.
 * Marks (lane M) composite ON TOP of these buffers (L's evaluator over a marks-only stack, or R's decals), gated by
 * `masks.skin` (1 on bare skin, 0 under a garment slot): a scar or a tattoo cannot be seen through cloth.
 */
/** The recipe skin basecoat "#rrggbb" (sRGB) of a preset — the colour a scar is relative to (QD Z-61), never Appearance.body. */
export function skinColourOf(preset: MaterialPreset): string {
  return preset.finish.materials.find((m) => m.kind === "skin")?.colour ?? "#808080";
}
/** The bare-skin regions of a preset (the complement of the garment slots, hair excluded): M's coveredRegions source. */
export function skinRegionsOf(preset: MaterialPreset): Region[] {
  return [...(preset.finish.materials.find((m) => m.kind === "skin")?.regions ?? [])];
}
/** (see presetBuffers) */
export function presetBuffers(mesh: MeshData, preset: MaterialPreset, opts: FinishOptions): MaterialBuffers {
  const ch = paintPreset(mesh, preset, opts);
  const n = mesh.positions.length / 3, material = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    material[i * 4] = ch.roughness![i]; material[i * 4 + 1] = ch.height![i]; material[i * 4 + 2] = ch.ao![i]; material[i * 4 + 3] = ch.subsurface![i];
  }
  const fragment: FragmentLayer[] = [];
  for (const node of presetToV2(preset).nodes) {
    if (node.kind === "layer" && node.stage === "fragment" && node.enabled) fragment.push({ id: node.id, name: node.name, source: node.source, writes: node.writes, opacity: node.opacity, path: [] });
  }
  // masks.skin = 1 where the material is bare skin (QD Z-37: marks are hidden under garments, so R gates decals by it).
  const skin = new Float32Array(n), sk = preset.finish.materials.findIndex((m) => m.kind === "skin");
  for (let i = 0; i < n; i++) skin[i] = preset.finish.regionMaterial[mesh.region[i]] === sk ? 1 : 0;
  // masks.crest = the fine edge highlight weight (EDGE_CREST; lane R's aEdge attribute), when the edge layer lifted anything.
  const masks: Record<string, Float32Array> = { skin };
  if (ch.crest && ch.crest.some((v) => v > 0)) masks.crest = ch.crest;
  return { albedo: ch.albedo, material, masks, written: ["albedo", "roughness", "height", "ao", "subsurface"], fragment };
}
