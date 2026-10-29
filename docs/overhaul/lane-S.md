# Lane S — Surroundings (V04): water, magma, clouds, tree tops, meadow/hills, void

Status: built, tested (20/20), GLSL compiled and rendered on a real WebGL2 context, the Engine patch
applied to a scratch copy, type-checked, and run in the live game. No commit. Engine.ts and
TerrainMesh.ts are NOT edited; the patch is `docs/overhaul/lane-S-engine-patch.py` (+ `lane-S-engine.diff`).

## Files

| File | What |
|---|---|
| `src/world/biomes/contracts.ts` (parent's, **optional fields only**) | `BiomeSpec` + `place?`, `variant?`, `windAngle?`, `outsideGround?` |
| `src/world/biomes/Waves.ts` | Gerstner train shared by physics and GPU: derivation, phases, forward map, inversion, uniform packing, `WAVE_GLSL` |
| `src/world/biomes/BiomeTables.ts` | media table, place → biome table, constants (kill depths, fog far, slope limit), value-noise fBm |
| `src/world/biomes/Biomes.ts` | `chooseBiome`, `createSurroundings`, `fieldNearRadius`, canopy crown placement |
| `src/graphics/biomes/BiomePalette.ts` | linear-RGB palettes per biome/variant (land base = TerrainPaint.PLACE_GROUND) |
| `src/graphics/biomes/BiomeShaders.ts` | GLSL: shared lighting/noise chunk, liquid vertex (WAVE_GLSL), water, magma, ground, rock, grass, blobs, trunks, clouds, carpet, abyss |
| `src/graphics/biomes/BiomeGeometry.ts` | polar grids, ring-base solids, tufts, trunks, instancing, triangle counting |
| `src/graphics/biomes/BiomeParts.ts` | per-biome builders (liquid, land, clouds, canopy, void) |
| `src/graphics/biomes/SurroundingsMesh.ts` | `buildSurroundingsMesh` + `update()` + stats |
| `tests/biomes_choose_test.ts`, `tests/biomes_surface_test.ts`, `tests/biomes_mesh_test.ts` | 20 tests |
| `docs/overhaul/lane-S-engine-patch.py`, `docs/overhaul/lane-S-engine.diff` | integration (script = source of truth; diff = what it produces at a7fc002) |

## Exports (exact signatures)

```ts
// src/world/biomes/Biomes.ts
export function chooseBiome(cfg: ArenaConfig, place: string, rng: () => number): BiomeSpec;
export function createSurroundings(spec: BiomeSpec, field: Heightfield | null, ringRadius: number, options: SurroundingsOptions = {}): BiomeSurroundings;
export function fieldNearRadius(field: Heightfield, ringRadius: number): number;
export function isBiomeSurroundings(s: Surroundings): s is BiomeSurroundings;
export interface NearGround { radius: number; floorAt: (x: number, z: number) => number; edgeY: number }
export interface SurroundingsOptions { near?: Partial<NearGround> }
export interface BiomeSurroundings extends Surroundings {
  ringRadius: number; waves: WaveTrain | null; crowns: Float32Array; crownCount: number;
  crownZone: readonly [number, number]; carpetY: number; groundY: number; nearRadius: number; edgeY: number;
  cloudLayers: number[]; segments: number;
}
// constants: PIT_RANGE, WATER_DROP, MAGMA_DROP, CLOUD_DROP, CANOPY_DROP, CANOPY_GROUND, FOREST_DEPTH_SOLID, HILLS_RELIEF,
// MEADOW_RELIEF, CANOPY_DENSITY, MAGMA_BASE, MAGMA_WIND_GAIN, SHAPE_LOW, SHAPE_RANGE, SHAPE_SLOPE_SHARE, WAVE_RESOLVED_RADII,
// MAGMA_SPEED_SCALE, MAGMA_STEEPNESS_SCALE, CROWN_STRIDE, CROWN_SQUASH, MAX_CROWNS, CROWN_ZONE_RADII, CROWN_ZONE_MIN, CARPET_DROP

// src/world/biomes/Waves.ts
export function deriveWaves(agitation: number, windAngle: number, seed: number, options: WaveOptions = {}): WaveTrain;
export function minResolvableWavelength(radius: number, segments: number): number;
export function wavePhasesAt(train: WaveTrain, t: number, out?: Float64Array | Float32Array): Float64Array | Float32Array;
export function gerstnerAt(train: WaveTrain, x0: number, z0: number, phases: ArrayLike<number>, out?: GerstnerSample): GerstnerSample;
export function waveHeightAt(train: WaveTrain, x: number, z: number, t: number): number;   // allocation-free
export function packWaveUniforms(train: WaveTrain, outA?: Float32Array, outB?: Float32Array): { a: Float32Array; b: Float32Array };
export function evaluatePackedWaves(a: Float32Array, b: Float32Array, phases: ArrayLike<number>, x0: number, z0: number): GerstnerSample;
export function glslSmoothstep(e0: number, e1: number, x: number): number;
export const WAVE_GLSL: string;  // vec4 gerstner(vec2 p0, out vec3 waveNormal) on uWaveA[4], uWaveB[4], uWavePhase
// interfaces Wave, WaveTrain, WaveOptions, GerstnerSample; constants WAVE_GRAVITY, WAVE_COUNT, STORM_WIND, BREAKING_STEEPNESS,
// STORM_STEEPNESS_FRACTION, SPECTRUM_RATIO, DIRECTIONAL_SPREAD, VERTICES_PER_WAVELENGTH, FADE_START_FRACTION, INVERT_ITERATIONS

// src/world/biomes/BiomeTables.ts
export const MEDIA: Readonly<Record<Medium, MediumEffect>>;  export const MEDIUMS: readonly Medium[];
export const BIOME_CHOICES: Readonly<Record<string, { fall: readonly BiomeOption[]; solid: readonly BiomeOption[] }>>;
export function pickWeighted(options: readonly BiomeOption[], u: number): BiomeOption;
export function hash2(ix: number, iz: number, seed: number): number;
export function valueNoise2(x: number, z: number, seed: number): number;
export function fbmSigned(x: number, z: number, seed: number, octaves?: number): number;
export function fbmMaxGradient(octaves?: number): number;  export function fbmGradientEstimate(): number;
// constants BODY_GRAVITY, FALL_LOST_SECONDS, FALL_LOST_DEPTH, WATER_LOST_DEPTH, MAGMA_LOST_DEPTH, GROUND_LOST_MARGIN, WIND_FOR_STORM,
// FOG_FAR, SURROUNDINGS_EXTENT, MAX_HILL_SLOPE, SURROUND_SEGMENTS, CLOUD_DRIFT_ANGLE, BIOME_MEDIUM, DEFAULT_CHOICES, RELIEF_OCTAVES, ...

// src/graphics/biomes/SurroundingsMesh.ts
export function buildSurroundingsMesh(surroundings: Surroundings, opts: SurroundingsMeshOptions = {}): SurroundingsMesh;
export interface SurroundingsMeshOptions { rimRadiusAt?: (angle: number) => number; rimBottomY?: number; innerRadius?: number; ringRadius?: number; detail?: number; apronTuck?: number }
export interface SurroundingsMesh {
  group: THREE.Group; surroundings: BiomeSurroundings; stats: SurroundingsMeshStats;
  update(t: number, sunDir: { x: number; y: number; z: number }, ambient: RgbInput, light?: SurroundingsLight): void;
  dispose(): void;
}
export interface SurroundingsLight { sunColor?: RgbInput; zenith?: RgbInput; horizon?: RgbInput }
export type RgbInput = readonly [number, number, number] | { r: number; g: number; b: number };
export function createSharedUniforms(windAngle: number): SharedUniforms;
export function measureGroup(group: THREE.Object3D): SurroundingsMeshStats;
export { APRON_TUCK };  export const SURROUNDINGS_DRAW_BUDGET = 6, SURROUNDINGS_TRIANGLE_BUDGET = 30000, SHADER_TIME_WRAP = 3600;
```
(BiomeGeometry/BiomeParts/BiomePalette/BiomeShaders exports are internal building blocks; listed in the files above.)

## What it does

**chooseBiome** (place × outsideGround, one rng draw order, deterministic):

| place | outsideGround 0 (fall into) | outsideGround 1 (solid, scenery beyond) |
|---|---|---|
| sunspire | magma/basalt 0.75, void 0.25 | hills/dry 0.65, meadow/dry 0.35 |
| greywall | water/moat 0.6, clouds/grey(storm if cloud>0.6) 0.4 | hills/heath 0.6, meadow/heath 0.4 |
| verdant | water/lake 0.45, canopy 0.55 | meadow 0.4, hills 0.3, canopy (forest beyond the field) 0.3 |
| frostford | water/icy 0.5, clouds/cold(storm) 0.5 | hills/snow 0.6, meadow/snow 0.4 |

Derived: `windNorm = clamp01(wind / 0.6)`; water `agitation = clamp01(windNorm · lerp(0.8, 1.2, cloud))` (wind 0 = still);
magma `0.25 + 0.5 windNorm`; others `windNorm` (grass/crown sway). Drops scale with `pitDepth` (clamped 4..40):
water −(0.35..0.6)·pit ∈ [2.5, 12] m, magma −(0.45..0.7)·pit ∈ [3.5, 14], clouds −(0.8..1.2)·pit ∈ [6, 30],
canopy crowns −(0.25..0.45)·pit ∈ [2, 10] with the floor 1.6·pit ∈ [14, 48] below; solid: `min(0, outsideHeight)`.
Hills relief `size/2 · (0.25..0.5)` ∈ [6, 30] m, meadow ∈ [1, 6] m; canopy density `lerp(0.55, 0.85, cloud) ± 0.05`.

**Waves** (Waves.ts header has the full derivation): U = 7 m/s · a; λ₀ = max(λmin, 2πU²/g) (phase speed = wind);
λᵢ = λ₀·0.62ⁱ; total steepness S = a · 0.7 · π/7 shared equally (Phillips saturation); Aᵢ = (S/4)/kᵢ; **ωᵢ = √(g kᵢ)**
(magma ×0.25, steepness ×0.35); λmin = 4 vertices at 2.5 ring radii; each wave fades where the polar mesh can no longer
resolve it (fade radii are part of the shared function). Physics inverts the horizontal displacement by fixed-point
iteration (contraction ≤ ΣkA ≤ 0.31). Phases are computed on the CPU in double precision and uploaded each frame
(no float32 time drift on the GPU).

**Media** (MEDIA, per contract): water drag 2 /s, buoyancy 0.9 (sink 1.2 m/s), hazard 0; magma 4, 1.1, **2**; canopy 1.5, 0, 0.25;
cloud 0.15, 0, 0; ground/void 0. killPlaneY: water surface − maxElevation − 8 m; magma −4 m; clouds/void surface − 48 m
(2 s of free fall at g 24); canopy floor − 20 m; land edge − 0.35 relief − 20 m.

**Meshes** (build once; per frame `update()` writes uniforms only — no geometry rebuild, no allocation):
water/magma = Gerstner polar grid (128 bearings, exponential rings, coarse beyond the last wave's fade) + rock column whose
waterline (1.06 rim) carries the shore foam; water: depth tint by shore distance, ripples (visual-only cat's paws, still
water included), fresnel sky + mirrored cloud reflection, sun glint, crest foam from the Gerstner Jacobian, shore lap + bands,
ice floes (icy); magma: domain-warped flowing noise, dark crust plates with glowing cracks/pools (colour, not additive),
column glow. Land: relief grid continuing lane E2's outside from its last row (no step), grass tufts (instanced,
vertex-shader sway, 14 m band + sparse tail, slope-filtered), shrubs/boulders. Clouds: billowed opaque sea (vertex
displacement), translucent wisps, soft-edged cumulus heads, floating-island cone under the ring. Canopy: 200 instanced
lumpy crowns + trunks, dark forest floor, crown carpet to the horizon, giant trunk (fall) or cliff (solid). Void: abyss bowl
(horizon → near-black within ~1.5°, faint motes), floating island, floating rock islets. Every surface reaches 900 m
(fog far 700 m): no visible edge.

## Draw calls / triangles (real test output, worst over sizes 34/120 m × circle/triangle/diamond)

| biome | draws | triangles | parts |
|---|---|---|---|
| water (lake/icy/moat) | 2 | 18,944 | surface 18,176, column 768 |
| magma | 2 | 18,944 | surface 18,176, column 768 |
| clouds | 4 | 19,744 | sea 10,368, wisps 2,816, puffs 5,600, island 960 |
| canopy (fall) | 5 | 25,148 | crowns 14,560, trunks 1,820, floor 2,432, carpet 5,568, trunk 768 |
| canopy (solid) | 5 | 26,576 | crowns 16,000, trunks 2,000, floor 2,432, carpet 5,568, cliff 576 |
| void | 3 | 4,320 | abyss 480, island 960, islets 2,880 |
| meadow lush / dry | 3 | 23,616 / 20,096 | land 9,216, grass 8,800 / 5,280, shrubs 5,600 |
| hills heath / snow | 3 | 21,856 / 17,016 | land 9,216, grass 7,040 / 2,200, shrubs 5,600 |

All ≤ 6 draws and ≤ 30k triangles (asserted). Live game (patched scratch bundle) reported 2–5 draws, 2,160–26,512 tris.

## Integration patch (exact): `python3 docs/overhaul/lane-S-engine-patch.py <repo-root>`

9 Engine hunks + 2 TerrainMesh hunks, anchor-exact, refuses on a missing/ambiguous anchor:
1. imports `chooseBiome, createSurroundings, fieldNearRadius, BiomeSurroundings` and `APRON_TUCK, buildSurroundingsMesh, SurroundingsLight, SurroundingsMesh`;
2. fields `#surroundings`, `#surroundingsMesh`, scratch `#surAmbient/#surSun/#surLight`;
3. `#buildArena`: `outsideFarRadius: outsideOn ? fieldNearRadius(field, this.#ringMaxRadius()) + 0.05 : undefined` (lane E2's flat apron stops at the field edge);
4. new `#ringMaxRadius()` and `#buildSurroundings()` (chooseBiome seeded from `field.seed`, createSurroundings with the drawn outside as `near`, buildSurroundingsMesh with `rimRadiusAt`, `rimBottomY = skirtBottomY`, `innerRadius = outside outerRadius`, `apronTuck` only if the TerrainMesh hunk is absent; hides `void-plane`/lowland);
5. `#startFight`: `this.#buildSurroundings()` right after `#setWorldTime(...)` (the place is only known there);
6. `#loop` after `#applyEnvironment()`: `update(this.#skyTime, sunLight.position, ambient.color×intensity, {sunColor: sun.color×intensity, zenith, horizon})`;
7. `debugView({clean})`: void-plane stays hidden while surroundings exist; surroundings hidden for clean captures;
8. `debugView({place})` during a fight rebuilds the surroundings for the new place (QA);
9. snapshot `ring.surroundings = {kind, variant, agitation, surfaceDrop, killPlaneY, drawCalls, triangles}`.
TerrainMesh: `outsideFarRadius?: number` option forwarded as `farRadius` to `buildTerrainOutside`.

**For lane R / the parent:** physics reads `this.#surroundings` (a `Surroundings`): `surfaceAt(x, z, this.#skyTime)` — the
same clock the shader animates with — `mediumAt`, `drag`, `buoyancy`, `hazardDps`, `killPlaneY`. Lane R's patch has two
`null /* lane S: this.#surroundings */` placeholders: replace both with `this.#surroundings`. Its `checkRingOut(..., { time:
this.#elapsed })` uses `#elapsed` as the surface clock: pass `#skyTime` for the surface query (else the ring-out "touches the
liquid" test sees waves up to ±0.9 m off the drawn ones; lane R's ragdoll world already uses `#skyTime`). Within
`nearRadius` (solid outside) `surfaceAt` returns the drawn floor (the engine passes `floorHeightAt`); beyond it,
`floorHeightAt` returns lane E2's flat `farY`, so ragdolls past the field edge should use `surfaceAt`.

## Commands and real output

- `deno check src/world/biomes/*.ts src/graphics/biomes/*.ts tests/biomes_*_test.ts` → `Checked 12 files` (clean).
- `deno lint src/world/biomes src/graphics/biomes tests/biomes_choose_test.ts tests/biomes_surface_test.ts tests/biomes_mesh_test.ts` → `Checked 12 files` (clean).
- `deno test --allow-read --allow-write=/Users/macmax/.hermes/cache/scratch tests/biomes_choose_test.ts tests/biomes_surface_test.ts tests/biomes_mesh_test.ts` → `ok | 20 passed | 0 failed (2s)`. Logged values:
  waves `agitation 0: maxElevation 0.000 m, RMS 0.000` … `agitation 1: maxElevation 0.909 m, RMS 0.328 m, peak lambda 31.38 m, sum kA 0.314`;
  `worst |surfaceAt - vertex height| = 0.001 mm over 400 displaced vertices (storm)`; `worst float32-uniform deviation 0.015 mm`;
  `canopy samples: 1400 crown hits, 600 gaps (density 0.7)`; `hills relief 14 m: worst sampled slope 27.8 deg (limit 35)`.
- **GPU (real WebGL2, Chrome via file:// bundle `scratch/laneS/harness.ts`)**: all 15 shader programs `runnable`, 0 console
  errors; `WAVE_GLSL` evaluated on the GPU into a float target at 256 rest points vs `surfaceAt` at the displaced points:
  worst **0.090 mm** (`worstVsPhysicsMetres 9.01e-05`, storm, t = 1234.567 s).
- **Patch**: applied to a scratch copy of the tree → `deno check --frozen main.ts` clean, `deno lint` clean; also applied
  AFTER lane R's `lane-R-engine.patch.py` (32 hunks) with R's 2 placeholders replaced → `deno check main.ts` clean.
- **Live game** (patched scratch copy bundled to `scratch/laneS/game/`, spectate, `debugWorld({nextArena})` + R restarts +
  `debugView({place})`): 12 matches produced canopy-lush, clouds-storm, magma-basalt, water-icy, void-abyss, water-moat,
  meadow-lush, hills-dry, hills-heath (+ clouds-cold later); void-plane hidden; 2–5 draws.

## Blind identification (vision_analyze, question never names the options)

Harness renders, gameplay-height camera (pitch 0.32 rad, 9 m behind a capsule 6 m from the rim, 40 m ring):

| biome | round 1 (in-game ring paint) | final, plain-stone ring control |
|---|---|---|
| water calm | water ✓ | "a vast blue ocean" ✓ |
| water storm | ocean ✓ | "the ocean … rippling" ✓ |
| water icy | water with floating patches ✓ | "water … scattered pale patches" ✓ |
| magma | lava field ✓ | "a vast lava field … glowing orange through dark, cracked crust" ✓ |
| clouds | ✗ "frozen sea / ice field" | "a white cloudscape … translucent clouds" ✓ (after 3 fixes) |
| canopy | ~ "river valley, hills dotted with trees" | ~ "low-poly forest … rolling green hills, trees" |
| meadow | ~ "water" (+ grassy hills) | "grassy, rolling landscape with bushes" ✓ |
| hills (dry) | (degenerate output) | "sandy desert plain, sparse grass, rocks" ✓ (dry variant) |
| void | (degenerate output) ✗ | "a dark void … featureless black expanse" ✓ |

Final plain-ring control: **7/9 named correctly, 2 partial (canopy → "forest/hills"), 0 wrong.** Live game (real ring
paint + HUD), before the last cloud/void tweak: water ×2 ✓, meadow ✓, dry hills ✓ ("grassy plain with dirt"), heath ✓,
magma ✓ (lava), canopy ~ ("moat bordered by rounded green bushes"), clouds ✗ ("water"), void ✗ ("sky with a dark band").
The re-capture of the live clouds/void after the fix timed out in the browser tool (not verified live).

## Open issues / risks

- **The ring's ice rim band reads as water.** Lane E's paint makes the outer ring band ice (`MATERIAL_PAINT.ice`, pale cyan,
  by design: "the slippery rim reads cold"). Measured: pixel-identical with my surroundings hidden. Vision called it a
  "water strip/moat/river" in most in-game frames; it confounds water/cloud reads and may confuse players. Lane E's call.
- Canopy reads as "forest / bushes on hills", not unmistakably "tree tops seen from above"; clouds only read correctly
  after the last tweak and only verified in the harness, not in the live game.
- Contract inconsistency: `Medium "magma"` says "slow sink" but `buoyancy` says ~1.1 (floats). I kept 1.1 (floats at the crust).
- Without the TerrainMesh hunk, solid-outside biomes sit under lane E2's 4R+40 m flat apron (hills only poke through beyond it;
  `apronTuck` avoids z-fighting).
- Visual review is stills only (motion: wave travel, grass sway, cloud drift not judged by eye). Frame time not measured on a
  device; fragment cost scales with pixels (water/magma ~3 noise fBm + 6 value-noise taps per pixel).
- Shader noise clock wraps hourly (`SHADER_TIME_WRAP`): a one-frame pattern pop per hour; wave phases never wrap.
- Hills are gentle by construction (worst measured 27.8° vs the 35° scenery limit).
- Not done: splash/burn/branch-crash VFX on impact (lane R events → lane D fx), sound, night-specific looks (moonlit water
  uses the same uniforms; not reviewed).
