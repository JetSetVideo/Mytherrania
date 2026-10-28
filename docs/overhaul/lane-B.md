# Lane B — Paint (R15: texture layers, patterns, blend modes)

Status: **done and green on lane B's own files**. 9 modules under `src/graphics/paint/`, 4 test files,
29/29 tests pass, `deno check` and `deno lint` clean. Nothing outside lane B's folders was edited.

## What it does

`paintVertices(mesh, stack)` gives one RGB colour per vertex by compositing a stack of paint layers
from the bottom up: a pattern, a region mask, a blend mode and an opacity per layer. Everything is
evaluated in bind-pose model space (metres), so no UVs are needed. `stackFor(subject)` builds
the stack from race, subrace, class, birth sign, hair, accent and seed. Nine named **PaintTraits**
per race (`mottle, counterShade, ruddiness, translucency, freckling, hide, warpaint, markings, lift`),
plus subrace deltas and a seeded jitter, drive every opacity, size and colour (R08). Every colour
is pulled inside stated chroma/luminance bounds, so no recipe gives neon or muddy skin.

Compositing happens in **sRGB** (that is where the Photoshop blend formulas are defined), and the output
is converted to **LINEAR** at the end (the default), because three.js expects linear values in a `color`
attribute. A solid coat lands exactly on `new THREE.Color(hex)`, and a test checks this.

## Files (all new)

| File | Role |
|---|---|
| `src/graphics/paint/Noise.ts` | Seeded 3D gradient noise (Perlin 2002), value noise, fBm, ridged multifractal, Worley F1/F2 (with hex-row option), domain warp, integer cell hash. Permutation table from `rng32(seed)`. |
| `src/graphics/paint/Patterns.ts` | The 10 `PatternKind`s as `(ctx, p, n, region, out) -> {coverage, mix}`. Each pattern has its equation and parameters in a doc comment, and `PATTERN_DEFAULTS` holds its defaults. `buildPatternEnv` (bounds, torso core, per-region/per-side anchors). |
| `src/graphics/paint/Symbols.ts` | 13 tattoo glyphs as polylines: one per birth sign (ring, peaks, flame, crescent, bolt, serpent) plus class marks (star, sun, eye, arrow, sword, fang, claw). `symbolDistance` uses a segment SDF over one flat precompiled array. |
| `src/graphics/paint/Blend.ts` | The 6 blend modes (Photoshop formulas), composite, sRGB↔linear (IEC 61966-2-1), hex/HSL, luminance, WCAG contrast, `shadeHex`/`tintHex` (chroma-safe darken/lighten). |
| `src/graphics/paint/Layers.ts` | `paintVertices` + `PaintOptions` + `regionMask`. |
| `src/graphics/paint/Relevance.ts` | The colour bounds, `boundColour` (keeps the hue), `relevanceReport` (area-weighted), `vertexAreas`. |
| `src/graphics/paint/RecipeData.ts` | `RACE_TRAITS`, `SUBRACE_PAINT`, `MARKING_STYLE`, `SIGN_PAINT`, `CLASS_PAINT` (pure data, each entry says why). |
| `src/graphics/paint/Recipes.ts` | `stackFor`, `subjectFromProfile`, `skinToneFor`, `traitsFor`, `inkOn`, `layerSeed`, and the named base constants. |
| `src/graphics/paint/Mannequin.ts` | A coarse ellipsoid humanoid `MeshData` with all 15 regions (Drillis & Contini stature fractions), so paint can be tested and previewed without lane A. |
| `tests/paint_noise_test.ts`, `tests/paint_blend_test.ts`, `tests/paint_layers_test.ts`, `tests/paint_recipes_test.ts` | 7 + 6 + 8 + 8 tests. |

## Exports (exact signatures)

**Layers.ts**
```ts
export interface PaintOptions { space?: "linear" | "srgb"; background?: string; out?: Float32Array; env?: PatternEnv }
export function regionMask(layer: PaintLayer): Uint8Array
export function paintVertices(mesh: MeshData, stack: PaintStack, options: PaintOptions = {}): Float32Array
```
This matches the contract (`paintVertices(mesh, stack): Float32Array`). `options` is optional:
`out` reuses a buffer (no allocation), `env` caches the per-mesh facts across repaints, and `space: "srgb"` returns display-encoded values.

**Recipes.ts**
```ts
export interface PaintSubject { race: string; subrace?: string | null; className?: string; birthsign?: string | null;
  hair?: string; accent?: string; garment?: string; height?: number; vertexSpacing?: number; seed: number }
export const DEFAULT_VERTEX_SPACING = 0.025; NYQUIST = 2; BASE_STATURE = 1.75; TRAIT_JITTER = 0.2;
  VISIBLE_TRAIT = 0.08; INK_SEPARATION = 0.22; TONE_NEIGHBOURS = 3; TONE_VARIATION = 0.5;
export const FEATURE_SIZE: { mottle, freckle, vein, scale, spot, stripe, warpaint, tattoo, hairStrand, sheen } // fractions of stature
export function layerSeed(seed: number, salt: number): number
export function skinToneFor(race: string, subrace: string | null | undefined, lift: number, rnd: () => number): string
export function traitsFor(race: string, subrace: string | null | undefined, rnd: () => number): PaintTraits
export function inkOn(skin: string, hue: number, sat: number, light: number): string
export function stackFor(subject: PaintSubject): PaintStack
export function subjectFromProfile(profile: CharacterProfile, options: { garment?: boolean; vertexSpacing?: number } = {}): PaintSubject
export type { PaintTraits }
```

**Patterns.ts**
```ts
export const PATTERN_KINDS: readonly PatternKind[]
export const REGION_INDEX: Readonly<Record<Region, number>>
export const PAIRED_REGIONS: readonly Region[]
export const LANDMARK_HEIGHT = { chin: 0.870, shoulder: 0.818, chest: 0.720 }
export const GRADIENT_AXES = ["height", "up", "front", "extremity", "side"] as const
export const WARPAINT_MOTIFS = ["bars", "chevron", "zigzag", "rings", "bolt", "split"] as const
export const TATTOO_PROJECTIONS = ["front", "side", "back", "top"] as const
export const PATTERN_DEFAULTS: Readonly<Record<PatternKind, Readonly<Record<string, number>>>>
export interface PatternEnv { min: Vec3; max: Vec3; core: Vec3; maxCoreDistance: number; anchors: Float64Array }
export interface PatternSample { coverage: number; mix: number }
export interface PatternContext { kind; noise: NoiseField; invScale: number; params: Record<string, number>; env: PatternEnv; cell: CellSample; warp: WarpOut }
export type PatternFn = (ctx: PatternContext, px: number, py: number, pz: number, nx: number, ny: number, nz: number, region: number, out: PatternSample) => PatternSample
export function sideOf(env: PatternEnv, x: number): number
export function buildPatternEnv(mesh: MeshData): PatternEnv
export function resolveParams(kind: PatternKind, params?: Record<string, number>): Record<string, number>
export function makePatternContext(layer: PaintLayer, env: PatternEnv, noise?: NoiseField): PatternContext
export const solid, noise, stripes, spots, scales, freckles, gradient, warpaint, veins, tattoo: PatternFn
export const PATTERNS: Readonly<Record<PatternKind, PatternFn>>
export function samplePattern(ctx, px, py, pz, nx, ny, nz, region, out): PatternSample
```
Pattern parameters (lattice units = metres / `layer.scale`):
- **noise**: `octaves, contrast, bias, warp`
- **stripes**: `angle, width, warp, sharpness, octaves`
- **spots**: `density, size, sizeJitter, jitter, softness, warp`
- **scales**: `jitter, rim, rimDepth, stretch` (√3/2 = hex rows)
- **freckles**: `density, size, faceBoost, shoulderBoost, armBoost, exposure`
- **gradient**: `axis, from, to, power, invert, fill`
- **warpaint**: `motif, bands, width, angle, edge, mirror, warp, offset, slope`
- **veins**: `octaves, threshold, sharpness, warp`
- **tattoo**: `symbol, project, offsetX, offsetY, stroke, facing, mirror`

**Noise.ts**
```ts
export const PERM_SIZE = 256
export interface NoiseField { seed: number; perm: Uint8Array; offsets: Float64Array }
export function makeNoise(seed: number): NoiseField
export function hashCell(seed: number, ix: number, iy: number, iz: number, salt = 0): number
export function hash01(seed: number, ix: number, iy: number, iz: number, salt = 0): number
export function gradientNoise3(f: NoiseField, x: number, y: number, z: number): number
export function valueNoise3(f: NoiseField, x: number, y: number, z: number): number
export function fbm3(f: NoiseField, x: number, y: number, z: number, octaves = 4, lacunarity = 2, gain = 0.5): number
export function ridged3(f: NoiseField, x: number, y: number, z: number, octaves = 3, lacunarity = 2, gain = 0.5): number
export interface CellSample { f1: number; f2: number; cellId: number }
export function makeCellSample(): CellSample
export function worley3(f: NoiseField, x: number, y: number, z: number, jitter: number, out: CellSample, stretchY = 1): CellSample
export interface WarpOut { x: number; y: number; z: number }
export function warp3(f: NoiseField, x: number, y: number, z: number, amplitude: number, out: WarpOut, octaves = 2): WarpOut
```

**Blend.ts**
```ts
export const BLEND_MODES: readonly BlendMode[]
export function blendCode(mode: BlendMode): number
export function blendChannelCode(code: number, b: number, s: number): number
export function blendChannel(mode: BlendMode, base: number, top: number): number
export function compositeChannel(mode: BlendMode, base: number, top: number, alpha: number): number
export function srgbToLinear(c: number): number
export function linearToSrgb(c: number): number
export type Rgb = [number, number, number]
export function hexToRgb(hex: string, out: Rgb = [0, 0, 0]): Rgb
export function rgbToHex(r: number, g: number, b: number): string
export function hexToLinear(hex: string, out: Rgb = [0, 0, 0]): Rgb
export function relativeLuminance(rLin: number, gLin: number, bLin: number): number
export function contrastRatio(y1: number, y2: number): number
export interface Hsl { h: number; s: number; l: number }
export function rgbToHsl(r: number, g: number, b: number, out?: Hsl): Hsl
export function hslToRgb(h: number, s: number, l: number, out?: Rgb): Rgb
export function hexToHsl(hex: string): Hsl
export function hslToHex(h: number, s: number, l: number): string
export function shiftHsl(hex: string, dHue: number, satMul: number, dLight: number): string
export function shadeHex(hex: string, k: number): string
export function tintHex(hex: string, k: number): string
export function mixHexSrgb(a: string, b: string, t: number): string
```

**Relevance.ts**
```ts
export interface ColourBounds { chroma: [number, number]; luminance: [number, number] }
export const SKIN_BOUNDS = { chroma: [0.08, 0.40], luminance: [0.14, 0.62] }        // base skin coat
export const INK_BOUNDS = { chroma: [0, 0.45], luminance: [0.012, 0.62] }           // pigments, inks, garment
export const HAIR_BOUNDS = { chroma: [0, 0.45], luminance: [0.012, 0.70] }
export const VERTEX_BOUNDS = { chroma: [0, 0.55], luminance: [0.008, 0.80] }        // every painted vertex
export const SKIN_MEDIAN_BOUNDS = { chroma: [0.08, 0.46], luminance: [0.12, 0.70] } // area-weighted median skin
export const SKIN_SPREAD = { min: 1.02, max: 3.0 }                                  // WCAG ratio p10..p90 skin Y
export function chromaOf(r: number, g: number, b: number): number
export function luminanceOfSrgb(r: number, g: number, b: number): number
export function measureHex(hex: string): { chroma: number; luminance: number }
export function boundColour(hex: string, bounds: ColourBounds): string
export function insideBounds(hex: string, bounds: ColourBounds, tolerance = 0.004): boolean
export interface RelevanceReport { vertices; maxChroma; minLuminance; maxLuminance; skinMedianChroma; skinMedianLuminance; skinSpread; violations: string[] }
export function vertexAreas(mesh: MeshData): Float64Array
export function relevanceReport(mesh: MeshData, colours: Float32Array, space: "linear" | "srgb" = "linear", excludeRegions: number[] = []): RelevanceReport
```
Chroma is the sRGB `max - min`, and luminance is the Rec. 709 Y of the linear colour. HSL saturation is not used
as a bound because it inflates on pale colours (#f0d0a8 has S 0.71 but C 0.28). Where the numbers come
from: the game's own SKIN_TONES and race tints span C 0.09–0.44 and Y 0.25–0.67, and the cel shader multiplies colour by up to about 1.06 plus rim,
so Y > 0.8 blows out to white.

**Symbols.ts**: `TATTOO_SYMBOLS` (13 names), `type TattooSymbol`, `SYMBOL_COUNT`, `symbolIndex(name): number`,
`symbolDistance(symbol: number, u: number, v: number): number`.
**Mannequin.ts**: `STATURE` (Drillis & Contini fractions), `mannequinMesh(height = 1.8, segments = 32): MeshData`.
**RecipeData.ts**: `PaintTraits`, `RACE_TRAITS`, `MarkingStyle`, `MARKING_STYLE`, `SUBRACE_PAINT`, `SignPaint`, `SIGN_PAINT`, `ClassPaint`, `CLASS_PAINT`.

## Recipe summary (what each race gets)

Every stack starts with `skin` (an opaque solid coat), then adds layers when the trait is ≥ 0.08, in this order:
`mottling` (noise) → `countershade` (gradient, axis up, softLight neutral greys, `fill: 1`) → `flush`
(gradient, axis extremity, on face/ear/hand/foot) → `freckles` (multiply) → `veins` (multiply) + `sheen`
(noise, screen) → `hide` (scales) → `markings` (spots/stripes) → `soles`, `nails` → `hair` + `hair-strands`
(stripes) → birth-sign mark → class accent → optional `garment`.

- **human**: mottling, countershading, mild flush and freckles, and a sign tattoo on the left upper arm. Islanders cross into warpaint.
- **elf**: base +0.04 L, veins and sheen (translucency 0.6), faint dapple, sign tattoo. Wood elves get forest spots; dark elves get violet veins (hue 0.78); high elves get extra sheen.
- **dwarf**: ruddiness 0.8 (flush on face, ears and hands) and freckling 0.65. Mountain dwarves mottle more; forge dwarves get soot spots on forearms and hands; deep dwarves are pale, with veins and no flush.
- **ork**: mottle 0.75, countershade 0.55, hide scales on the arms, darker hide stripes, and warpaint (0.9) on face and both arms. Ironhide orks get scales on torso, hands and shins too. Greenhide get camouflage bands, bloodfang red-brown stripes.
- **Birth sign**: picks the glyph and warpaint motif plus a pigment. serpent = green zigzag, mountain = ochre bars, flame = red-ochre chevrons, moon = silver rings, storm = woad bolt, void = black-violet split face.
- **Class accent**: Barbarian arm war-stripes, Warrior pale scars (veins), Rogue charcoal eye mask, Assassin fang (forearm),
  Mage pentagram in the accent colour (forearm), Necromancer dark veins, Archer forearm bands, Priest sun on the chest.

All 10 PatternKinds and 5 of the 6 blend modes are used by recipes. `add` is left for FX and emissive runes,
because on skin it pushes toward white.

## Wiring (for the parent and lane A)

### 1. Paint the skinned body (lane A's `SkinnedHumanoid.ts`, or the engine)
```ts
import { paintVertices } from "../paint/Layers.ts";
import { stackFor, subjectFromProfile } from "../paint/Recipes.ts";

// `mesh` = the polygonised MeshData in BIND pose (before skinning), `plan.cell` = its grid cell.
const stack = stackFor({
  race: appearance.race ?? "human", subrace: appearance.subrace ?? null,
  className: spec.className, birthsign,            // birthsign: see open issue 1
  hair: appearance.hair, accent: appearance.accent, height: spec.height,
  vertexSpacing: plan.cell, seed: spec.seed,
});
// or, from a saved character: stackFor(subjectFromProfile(profile, { garment: true, vertexSpacing: plan.cell }))
const colours = paintVertices(mesh, stack);         // LINEAR RGB, 3 floats per vertex
geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
// material: vertexColors: true and baseColor white (the paint carries the colour)
```

### 2. Cel material reads vertex colours (exact change)
three@0.180 `WebGLProgram.js` (non-raw ShaderMaterial prefix) emits `#define USE_COLOR` and
`attribute vec3 color;` when `material.vertexColors === true` (checked at lines 629 and 717–719). So the
shaders must not redeclare `color`. Use it under `#ifdef USE_COLOR`.

**`src/graphics/shaders/CelShader.ts`** (parent's file; lane A's `CelSkinned.ts` needs the same 4 edits):

Anchor `celVertex`, after `varying vec3 viewPos;`, add:
```glsl
  varying vec3 vPaint;
```
In `celVertex` `main()`, after `viewPos = mv.xyz;`, add:
```glsl
    #ifdef USE_COLOR
      vPaint = color;      // linear RGB from paintVertices
    #else
      vPaint = vec3(1.0);
    #endif
```
Anchor `celFragment`, after `varying vec3 viewPos;`, add `varying vec3 vPaint;`, then replace
```glsl
    gl_FragColor = vec4(baseColor * lit + lightColor * spec, 1.0);
```
with
```glsl
    gl_FragColor = vec4(baseColor * vPaint * lit + lightColor * spec, 1.0);
```
In both `createCelMesh` and `createCelSurface`, add to the `new THREE.ShaderMaterial({ ... })` options:
```ts
    vertexColors: geometry.hasAttribute("color"),
```
and pass `color = "#ffffff"` for painted geometry, so `baseColor` acts as a neutral tint. Unpainted meshes are
unchanged (`vPaint = 1`). The outline material needs nothing. The skinned variant: `color` is a per-vertex
attribute and is not touched by skinning, so it goes into the vertex shader exactly as above, next to
`#include <skinning_vertex>`.

### 3. Beyond bodies
For terrain or weapons, give `region` all zeros and leave the layers' `regions` unset. Patterns run in
metres in model space. The terrain-grid test shows spots landing on a region-less mesh.

## Commands run (real output)

```
$ deno check src/graphics/paint/*.ts tests/paint_*_test.ts
Check src/graphics/paint/Blend.ts … Check tests/paint_recipes_test.ts     (13 files)
exit=0

$ deno test --allow-read tests/paint_noise_test.ts tests/paint_blend_test.ts tests/paint_layers_test.ts tests/paint_recipes_test.ts
running 7 tests from ./tests/paint_noise_test.ts … ok
running 6 tests from ./tests/paint_blend_test.ts … ok
running 8 tests from ./tests/paint_layers_test.ts … ok
running 8 tests from ./tests/paint_recipes_test.ts
…
recipes: race x subrace x birth sign x class stay relevant: vertex C <= 0.55, Y 0.008..0.8; skin median C 0.08..0.46, Y 0.12..0.7; spread 1.02..3 ... ok (1s)
recipes: saved characters paint, with the palette as an optional garment ... ok (31ms)
ok | 29 passed | 0 failed (1s)

$ deno lint src/graphics/paint/ tests/paint_noise_test.ts tests/paint_blend_test.ts tests/paint_layers_test.ts tests/paint_recipes_test.ts
Checked 13 files
```
Mutation checks (temporary edits, reverted, confirmed with `grep -c MUTANT` = 0):
- Turning off the region mask in `paintVertices` fails `layers: a region-masked layer leaves every other region untouched` (`non-face vertex 0 (hair) untouched`).
- Removing `boundColour` from the skin tone and the garment fails 3 recipe tests: SKIN_BOUNDS, the relevance matrix, and the garment.

Timing (`deno run` scratch probe, mannequin with 10 098 vertices, average of 10 runs): human 12 layers 10.4 ms,
elf 13 layers 11.0 ms, dwarf 12 layers 9.5 ms, ork 13 layers 8.4 ms, which is about 1 µs per vertex for the whole stack.
This is a one-off cost when a body is generated, not per frame.

Compatibility probe against **lane A's in-progress `polygonize`** (read-only import: a capsule plus a head, smooth
union, cell 0.025): `lane A polygonize verts 2140 tris 4276 … paint ms 12.8 len ok true`, violations `[]`.

## Not done / not verified / risks

1. **The birth sign does not reach the body builder.** `BodySpec` and `Appearance` have no `birthsign`. Either add
   an optional `birthsign?: string | null` to `BodySpec` (a contract change for the parent), or have the engine build the
   stack with `subjectFromProfile(profile)` and pass the `PaintStack` (or the colour array) into `buildSkinnedHumanoid`.
2. **Not seen in a browser.** No render or screenshot was made (no build or server, per the rules). Under the cel bands the patterns are
   tuned to be subtle (skin spread is 1.05–1.9 on the matrix), and might need a stronger look once seen.
3. **Vertex colours cap the detail.** Features smaller than about 2× the polygoniser cell alias, so recipes clamp
   every patterned scale to `NYQUIST × vertexSpacing` (default 0.025 m, so 5 cm). Freckles and tattoo strokes are therefore
   coarse. For crisp tattoos, bake `paintVertices` logic into a texture or run the patterns in a fragment shader later.
4. **Region quality depends on lane A.** Warpaint and tattoo anchors are region centroids, computed per side for paired regions.
   If lane A labels the face or arms differently (for example, the face spans the whole head), marks will shift. Tune with `offsetX`/`offsetY`/`offset`.
5. **The palette colour (`Appearance.body`) is no longer skin.** It is only painted as an optional `garment` (torso/pelvis/thigh,
   bounded). The arena currently tells the two fighters apart by `body` colour, so the parent should pass
   `{ garment: true }` or keep another identity cue.
6. `Patterns.ts` is about 20.7k characters, just over the ~20k guideline, but cohesive (one pattern per export).
7. Shared helpers the parent may want to move into MathCore: none required. `hashCell`/`hash01` (Noise.ts) and
   `srgbToLinear`/`linearToSrgb` (Blend.ts) are general-purpose.
