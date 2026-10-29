// TextureRecipes: named procedural materials as NoiseAlgebra trees, one per RGBA channel.
// Baked by BakeTexture.ts into tileable RGBA arrays (the parent wraps them in DataTextures).
// Pure data + tiny builders: no Three.js, no DOM.
//
// Channel convention (every recipe documents its own meaning in `channels`):
//   R  albedo variation (0 = darkest palette stop, 1 = brightest) — what bakePreview ramps.
//   G  a secondary pattern or mask (cracks, mortar, pebbles, sparkle ...).
//   B  cel / height detail (bump, bevel, ripple height).
//   A  roughness (0 glossy .. 1 matte) or a mask, stated per recipe.
// Units: a recipe tile spans `tile` coordinate units (default 8). A source `scale` s gives
// round(tile / s) features across the tile.
// Between them the recipes use EVERY NoiseAlgebra source and operator (asserted by a test).

import type { NoiseExpr } from "../paint/NoiseAlgebra.ts";
import type { SpreadTarget } from "../paint/Spread.ts";

export type TextureChannel = "r" | "g" | "b" | "a";
export const TEXTURE_CHANNELS: readonly TextureChannel[] = ["r", "g", "b", "a"];

export interface TextureRecipe {
  id: string;
  /** One line: what the material is for. */
  purpose: string;
  /** What each channel means for this recipe. */
  channels: Readonly<Record<TextureChannel, string>>;
  /** The expression per channel. Same seed for all four: sources with equal salts correlate. */
  expr: Readonly<Record<TextureChannel, NoiseExpr>>;
  /** 2..4 sRGB "#rrggbb" stops, dark to light, for bakePreview. */
  palette: readonly string[];
  /** Cel bands in the preview (quantize count). */
  celLevels: number;
  /** Value spread per channel after baking; null = keep as authored (masks stay binary). */
  targetSpread: Readonly<Record<TextureChannel, SpreadTarget | null>>;
  /** Channels spread by histogram equalisation (CDF) instead of the linear p20/p80 map. */
  equalize?: readonly TextureChannel[];
  /** Coordinate units per tile (the compile period). Default 8. */
  tile?: number;
}

// ---------------------------------------------------------------------------------------
// Builders (keep the recipe trees readable).

type Base = "value" | "gradient" | "simplex";
const k = (value: number): NoiseExpr => ({ op: "constant", value });
const fbm = (scale: number, base: Base = "gradient", octaves = 4, seedSalt?: number): NoiseExpr =>
  ({ op: "fbm", base, scale, octaves, seedSalt });
const ridged = (scale: number, base: Base = "gradient", octaves = 3, seedSalt?: number): NoiseExpr =>
  ({ op: "ridged", base, scale, octaves, seedSalt });
const billow = (scale: number, base: Base = "simplex", octaves = 3, seedSalt?: number): NoiseExpr =>
  ({ op: "billow", base, scale, octaves, seedSalt });
const turb = (scale: number, base: Base = "gradient", octaves = 3, seedSalt?: number): NoiseExpr =>
  ({ op: "turbulence", base, scale, octaves, seedSalt });
const worley = (scale: number, feature: "f1" | "f2" | "f2MinusF1" | "cellId", seedSalt?: number, jitter = 0.9): NoiseExpr =>
  ({ op: "worley", scale, feature, jitter, seedSalt });
const spots = (scale: number, radius: number, density: number, softness = 0.08, seedSalt?: number): NoiseExpr =>
  ({ op: "spots", scale, radius, density, softness, jitter: 0.8, seedSalt });
const stripes = (axis: "x" | "y" | "z", scale: number, sharpness = 0): NoiseExpr => ({ op: "stripes", axis, scale, sharpness });
const add = (a: NoiseExpr, b: NoiseExpr): NoiseExpr => ({ op: "add", a, b });
const mul = (a: NoiseExpr, b: NoiseExpr): NoiseExpr => ({ op: "mul", a, b });
const sub = (a: NoiseExpr, b: NoiseExpr): NoiseExpr => ({ op: "sub", a, b });
const oneMinus = (a: NoiseExpr): NoiseExpr => ({ op: "oneMinus", a });
const sstep = (a: NoiseExpr, e0: number, e1: number): NoiseExpr => ({ op: "smoothstep", a, e0, e1 });
/** lo + (hi - lo) * a: a [0,1] signal placed into a narrower band. */
const band = (a: NoiseExpr, lo: number, hi: number): NoiseExpr => add(k(lo), mul(k(hi - lo), a));

/** Default value spread for continuous channels: central 60% over 0.3..0.7. */
const MID: SpreadTarget = { p20: 0.3, p80: 0.7 };
const TAU = 2 * Math.PI;

// Shared sub-trees (identical salts in two channels give the same noise -> correlated channels).
const stoneCells = (f: "f1" | "f2MinusF1") => worley(2, f, 7);
const cobbleEdge = worley(1.2, "f2MinusF1", 11);
const sandRipple: NoiseExpr = {
  op: "warp", amount: 0.6, by: fbm(4, "simplex", 2, 21),
  a: { op: "rotate", angle: 0.35, a: stripes("x", 1, 0.3) },
};
const barkFurrows: NoiseExpr = { op: "warp", amount: 0.8, by: fbm(2, "gradient", 3, 41), a: stripes("x", 0.7, 0.7) };
const barkLichen = sstep(fbm(2.5, "value", 3, 42), 0.55, 0.7);
const woodRings: NoiseExpr = { op: "warp", amount: 0.4, by: fbm(2, "gradient", 3, 51), a: stripes("z", 0.15, 0.2) };
const woodBoards: NoiseExpr = {
  op: "quantize", levels: 4,
  a: { op: "mod", a: mul({ op: "coordinate", axis: "z", cell: 2 }, k(2)), b: k(1) },
};
const metalSwirl = mul(
  band({ op: "sin", a: mul({ op: "coordinate", axis: "angle", cell: 4 }, k(TAU * 8)) }, 0, 1),
  oneMinus(sstep({ op: "coordinate", axis: "radial", cell: 4 }, 1.2, 1.8)),
);
const clothWeave: NoiseExpr = {
  op: "max",
  a: mul(stripes("x", 0.25, 0.5), { op: "checker", scale: 0.25 }),
  b: mul(stripes("z", 0.25, 0.5), oneMinus({ op: "checker", scale: 0.25 })),
};
const leatherPores = oneMinus(worley(0.5, "f1", 61));
const leatherCreases = ridged(1.2, "simplex", 3, 62);
const lavaGlow: NoiseExpr = { op: "exp", a: { op: "neg", a: mul(k(12), worley(1.6, "f2MinusF1", 71)) } };
const mossClumps = spots(0.6, 0.35, 0.6, 0.15, 81);
const cloudBody: NoiseExpr = {
  op: "smoothUnion", k: 0.3,
  a: billow(2, "simplex", 4, 91),
  b: oneMinus(worley(1.5, "f1", 92)),
};

/** Every material recipe, in a fixed order. */
export const TEXTURE_RECIPES: readonly TextureRecipe[] = [
  {
    id: "stone",
    purpose: "Rough natural rock faces: cliffs, boulders, pillars.",
    channels: { r: "albedo mottling over cell shading", g: "crack mask (1 = crack)", b: "cell bevel height", a: "roughness" },
    expr: {
      r: { op: "overlay", a: fbm(2, "simplex", 4), b: oneMinus(stoneCells("f1")) },
      g: { op: "threshold", a: ridged(3, "gradient", 3, 8), level: 0.82, softness: 0.04 },
      b: { op: "remap", a: stoneCells("f2MinusF1"), inLo: 0, inHi: 0.6, outLo: 0, outHi: 1 },
      a: { op: "contrast", a: { op: "value", scale: 1 }, amount: 1.4 },
    },
    palette: ["#4a4744", "#7a756d", "#a9a297"],
    celLevels: 4,
    targetSpread: { r: MID, g: null, b: MID, a: { p20: 0.6, p80: 0.85 } },
  },
  {
    id: "cobble",
    purpose: "Cobblestone paving: rounded stones in mortar.",
    channels: { r: "per-stone tint mixed with mottling", g: "mortar mask (1 = mortar)", b: "domed stone height", a: "roughness (mortar rougher)" },
    expr: {
      r: { op: "mix", a: fbm(1.5, "value", 3), b: worley(1.2, "cellId", 11), t: k(0.6) },
      g: oneMinus(sstep(cobbleEdge, 0.04, 0.14)),
      b: { op: "sqrt", a: { op: "saturate", a: mul(cobbleEdge, k(3)) } },
      a: { op: "max", a: mul(k(0.55), { op: "gradient", scale: 0.7 }), b: oneMinus(sstep(cobbleEdge, 0.04, 0.14)) },
    },
    palette: ["#3d3a37", "#6b655c", "#958c7e"],
    celLevels: 4,
    targetSpread: { r: MID, g: null, b: MID, a: { p20: 0.55, p80: 0.9 } },
  },
  {
    id: "sand",
    purpose: "Wind-rippled sand: beaches and dunes.",
    channels: { r: "ripple shading + grain", g: "shell/grit mask", b: "ripple height", a: "roughness" },
    expr: {
      r: add(mul(sandRipple, k(0.7)), mul({ op: "value", scale: 0.15 }, k(0.3))),
      g: { op: "step", a: spots(0.35, 0.25, 0.35, 0.05, 22), edge: 0.5 },
      b: { op: "pow", a: sandRipple, b: k(1.5) },
      a: add(k(0.75), mul(sub({ op: "value", scale: 0.5 }, k(0.5)), k(0.2))),
    },
    palette: ["#b89b6a", "#d8c08e", "#efdcae"],
    celLevels: 3,
    targetSpread: { r: MID, g: null, b: MID, a: { p20: 0.7, p80: 0.85 } },
  },
  {
    id: "grass",
    purpose: "Meadow ground cover seen from above.",
    channels: { r: "clump brightness", g: "blade streak mask", b: "cel height bands", a: "roughness" },
    expr: {
      r: { op: "screen", a: billow(2, "simplex", 4), b: mul(turb(0.6, "gradient", 3), k(0.5)) },
      g: {
        op: "gain", amount: 0.7,
        a: { op: "scale", factor: 0.5, a: { op: "warp", amount: 0.25, by: { op: "gradient", scale: 1 }, a: stripes("x", 0.4, 0.5) } },
      },
      b: { op: "quantize", a: fbm(1, "simplex", 3), levels: 4 },
      a: { op: "softLight", a: k(0.7), b: { op: "value", scale: 0.3 } },
    },
    palette: ["#2f5a22", "#4f8a34", "#86b94a"],
    celLevels: 4,
    targetSpread: { r: MID, g: MID, b: MID, a: { p20: 0.6, p80: 0.8 } },
  },
  {
    id: "dirt",
    purpose: "Bare earth paths and field soil with pebbles.",
    channels: { r: "soil mottling", g: "pebble mask", b: "height (pebbles raised)", a: "roughness (pebbles smoother)" },
    expr: {
      r: { op: "colorBurn", a: fbm(2, "gradient", 5), b: band({ op: "simplex", scale: 0.7 }, 0.55, 1) },
      g: spots(0.8, 0.3, 0.45, 0.1, 31),
      b: { op: "smoothUnion", a: fbm(2, "gradient", 3, 32), b: spots(0.8, 0.3, 0.45, 0.1, 31), k: 0.2 },
      a: add(band(fbm(1, "value", 3), 0.7, 1), { op: "neg", a: mul(spots(0.8, 0.3, 0.45, 0.1, 31), k(0.35)) }),
    },
    palette: ["#3b2a1d", "#5e4430", "#86664a"],
    celLevels: 4,
    targetSpread: { r: MID, g: null, b: MID, a: { p20: 0.6, p80: 0.9 } },
  },
  {
    id: "snow",
    purpose: "Fresh snow fields with drifts and sparkle.",
    channels: { r: "brightness (biased high)", g: "sparkle mask", b: "drift height", a: "roughness (low)" },
    expr: {
      r: { op: "bias", a: fbm(3, "value", 4), amount: 0.7 },
      g: { op: "step", a: worley(0.12, "cellId", 101), edge: 0.94 },
      b: { op: "exp", a: mul(k(-2), ridged(4, "simplex", 3)) },
      a: { op: "clamp", a: add(k(0.25), mul(fbm(2, "gradient", 3), k(0.3))), lo: 0.2, hi: 0.5 },
    },
    palette: ["#b9c7d6", "#e2eaf2", "#ffffff"],
    celLevels: 3,
    targetSpread: { r: { p20: 0.55, p80: 0.85 }, g: null, b: MID, a: { p20: 0.25, p80: 0.4 } },
  },
  {
    id: "ice",
    purpose: "Frozen lakes and glacier faces.",
    channels: { r: "depth tint variation", g: "crack mask", b: "frost height", a: "roughness (glossy)" },
    expr: {
      r: { op: "difference", a: fbm(3, "simplex", 4), b: mul(k(0.5), { op: "translate", a: fbm(3, "simplex", 4), offset: [2.3, 0, 1.7] }) },
      g: { op: "subtract", a: k(1), b: { op: "threshold", a: worley(1.5, "f2MinusF1", 111), level: 0.04, softness: 0.02 } },
      b: { op: "exclusion", a: { op: "gradient", scale: 2 }, b: billow(1, "value", 3) },
      a: { op: "clamp", a: add(k(0.35), mul(k(0.1), { op: "log", a: fbm(2, "gradient", 3) })), lo: 0, hi: 1 },
    },
    palette: ["#5b8fb0", "#9cc6dd", "#e3f4fb"],
    celLevels: 3,
    targetSpread: { r: MID, g: null, b: MID, a: { p20: 0.1, p80: 0.3 } },
    equalize: ["r"],
  },
  {
    id: "bark",
    purpose: "Tree trunk bark with vertical furrows and lichen.",
    channels: { r: "furrow shading x ridges", g: "lichen mask", b: "furrow height", a: "roughness (lichen raises it)" },
    expr: {
      r: { op: "multiply", a: barkFurrows, b: band(ridged(1.5, "gradient", 3), 0.4, 1) },
      g: barkLichen,
      b: { op: "div", a: add(barkFurrows, ridged(1.5, "gradient", 3)), b: k(2) },
      a: { op: "union", a: band(turb(1, "gradient", 3), 0.55, 0.8), b: barkLichen },
    },
    palette: ["#2a1e15", "#4b3626", "#6f5640"],
    celLevels: 4,
    targetSpread: { r: MID, g: null, b: MID, a: { p20: 0.65, p80: 0.9 } },
  },
  {
    id: "woodPlanks",
    purpose: "Plank floors, crates and doors.",
    channels: { r: "grain rings x per-board tone", g: "knot mask", b: "cel grain height", a: "roughness" },
    expr: {
      r: mul(band(woodRings, 0.55, 1), band(woodBoards, 0.75, 1)),
      g: spots(1.5, 0.18, 0.3, 0.05, 52),
      b: { op: "quantize", a: woodRings, levels: 3 },
      a: { op: "tile", period: 4, a: band({ op: "gradient", scale: 0.5 }, 0.5, 0.8) },
    },
    palette: ["#5a3a1e", "#8a5d33", "#b8844f"],
    celLevels: 4,
    targetSpread: { r: MID, g: null, b: MID, a: { p20: 0.5, p80: 0.7 } },
  },
  {
    id: "metal",
    purpose: "Worked metal: plates, armour, spun bosses.",
    channels: { r: "brushed tone with spun sunburst", g: "scratch mask", b: "hammered height", a: "roughness (low)" },
    expr: {
      r: { op: "colorDodge", a: fbm(1, "simplex", 3), b: mul(k(0.4), metalSwirl) },
      g: { op: "step", a: { op: "rotate", angle: 0.5, a: ridged(1, "gradient", 2) }, edge: 0.93 },
      b: band({ op: "cos", a: mul(k(14), fbm(2, "gradient", 3)) }, 0.5, 1),
      a: { op: "remap", a: turb(1.5, "value", 3), inLo: 0, inHi: 0.6, outLo: 0.15, outHi: 0.45 },
    },
    palette: ["#4c535a", "#8d969e", "#d5dce2"],
    celLevels: 5,
    targetSpread: { r: MID, g: null, b: MID, a: { p20: 0.2, p80: 0.4 } },
  },
  {
    id: "cloth",
    purpose: "Woven fabric: banners, tents, tunics.",
    channels: { r: "weave x dye variation", g: "thread-gap mask", b: "weave height", a: "roughness (matte)" },
    expr: {
      r: { op: "multiply", a: clothWeave, b: band(fbm(2, "gradient", 3), 0.6, 1) },
      g: { op: "min", a: stripes("x", 0.25, 0.5), b: stripes("z", 0.25, 0.5) },
      b: { op: "intersect", a: clothWeave, b: k(0.8) },
      a: add(k(0.8), mul(k(0.15), { op: "value", scale: 0.5 })),
    },
    palette: ["#5a2830", "#8c3c48", "#b8606c"],
    celLevels: 3,
    targetSpread: { r: MID, g: MID, b: MID, a: { p20: 0.75, p80: 0.9 } },
  },
  {
    id: "leather",
    purpose: "Tanned hide: straps, saddles, armour padding.",
    channels: { r: "pore grain x mottling", g: "crease mask", b: "pores minus creases (height)", a: "roughness variation" },
    expr: {
      r: { op: "smoothIntersect", a: leatherPores, b: fbm(2, "simplex", 3), k: 0.15 },
      g: { op: "threshold", a: leatherCreases, level: 0.85, softness: 0.03 },
      b: { op: "smoothSubtract", a: leatherPores, b: leatherCreases, k: 0.1 },
      a: mul(k(2), { op: "abs", a: sub(fbm(1, "gradient", 3), k(0.5)) }),
    },
    palette: ["#3a2216", "#6a3f26", "#946040"],
    celLevels: 4,
    targetSpread: { r: MID, g: null, b: MID, a: { p20: 0.45, p80: 0.75 } },
  },
  {
    id: "lava",
    purpose: "Cooling lava crust with glowing seams.",
    channels: { r: "glow + turbulent crust", g: "emissive mask", b: "crust height", a: "roughness (seams smooth)" },
    expr: {
      r: add(mul(k(0.6), lavaGlow), mul(k(0.4), turb(2, "simplex", 4))),
      g: { op: "saturate", a: sub(lavaGlow, mul(k(0.5), billow(1.5, "gradient", 3))) },
      b: { op: "div", a: k(0.5), b: add(k(0.5), lavaGlow) },
      a: { op: "subtract", a: k(0.9), b: lavaGlow },
    },
    palette: ["#1a0f0c", "#7a1d08", "#e2560f", "#ffd25a"],
    celLevels: 5,
    targetSpread: { r: MID, g: null, b: MID, a: { p20: 0.5, p80: 0.85 } },
    equalize: ["r"],
  },
  {
    id: "moss",
    purpose: "Moss carpets on stone and logs.",
    channels: { r: "clump brightness", g: "coverage mask", b: "clump height", a: "roughness" },
    expr: {
      r: { op: "smoothUnion", a: fbm(1.5, "value", 4), b: mossClumps, k: 0.25 },
      g: sstep({ op: "warp", amount: 0.5, a: { op: "simplex", scale: 3 } }, 0.45, 0.6),
      b: { op: "max", a: mossClumps, b: mul(k(0.6), fbm(1, "gradient", 3)) },
      a: add(k(0.7), mul(k(0.25), billow(1, "gradient", 3))),
    },
    palette: ["#24381a", "#3f6128", "#6e9a3c"],
    celLevels: 4,
    targetSpread: { r: MID, g: null, b: MID, a: { p20: 0.7, p80: 0.9 } },
  },
  {
    id: "cloudPuff",
    purpose: "Cel cloud sprites and puffy cloud-layer detail.",
    channels: { r: "puff brightness", g: "puff edge mask", b: "puff thickness", a: "opacity mask" },
    expr: {
      r: cloudBody,
      g: sstep(cloudBody, 0.3, 0.5),
      b: { op: "sqrt", a: { op: "saturate", a: sub(k(1.2), worley(1.5, "f2", 92)) } },
      a: { op: "saturate", a: mul(k(1.5), cloudBody) },
    },
    palette: ["#8f9db5", "#cfd9e8", "#ffffff"],
    celLevels: 3,
    targetSpread: { r: MID, g: null, b: MID, a: { p20: 0.35, p80: 0.95 } },
  },
];

/** A recipe by id (throws on an unknown id so a typo fails loudly). */
export function textureRecipe(id: string): TextureRecipe {
  const r = TEXTURE_RECIPES.find((x) => x.id === id);
  if (!r) throw new Error(`textureRecipe: unknown id ${id}`);
  return r;
}
