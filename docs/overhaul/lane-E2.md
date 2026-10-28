# Lane E2 — Terrain readability (R07, R08, R13, R15)

Status: **built and tested in isolation; NOT integrated** (Engine.ts / ArenaPhysics.ts are shared: exact patch in §4).
`deno check` and `deno lint` are clean on every lane file; **50/50 world tests pass** (the 34 lane E tests
unchanged + 16 new). Lane B's 4 paint test files (29 tests) still pass (paint/** untouched). Nothing was built or served; port 8788 untouched; no commit.

What changed, in one paragraph: the generator now gives the ring band real relief (rolling ground solved to a
target RMS slope + Pareto mounds/hollows) while a **fair set** (a fair centre sized from reach + body, and the two
duel spawn pads) is untouched; one in-ring **terrace or shallow hole** sized to the ring is stamped whenever none is
visible; a field-following **outside annulus** replaces the flat grey plane (and the floor sampler returns it);
**TerrainPaint** paints a derived lane-B PaintStack (7 PatternKinds, 5 BlendModes) on the heightfield grid plus a
Laplacian cavity bake and a relevance clamp.

## 1. Files

| File | New / modified | Role |
|---|---|---|
| `src/world/RingRelief.ts` | new, pure | fair set (centre + spawn pads), pad levelling, cone-bounded rolling ground, band mounds, visibility counters |
| `src/world/OutsideSurface.ts` | new, pure | outside annulus mesh (typed arrays), drawn-outside sampler, terrain floor sampler, triangle budget |
| `src/world/TerrainReadability.ts` | new, pure | headless metrics: noon sun, area weights, weighted p20/p80, Lambert stats, linear-RGB→Lab, ΔE76, zone contrast |
| `src/graphics/TerrainPaint.ts` | new, pure (no THREE) | derived terrain PaintStack, zones, grid painting, cavity bake, vertex colour bounds |
| `src/graphics/TerrainOutside.ts` | new, THREE | outside mesh wrapper (one geometry, in-place rebuild) |
| `src/world/TerrainRules.ts` | modified | +2 base params (`fighterReach`, `bodyRadius`), +18 derived ring rules, each in `describeTerrainRules` |
| `src/world/TerrainFeatures.ts` | modified | `stampDeliberate` takes a `DeliberateSpec` (outside set reproduced draw for draw), `taken`, `keepClear`; kinds `mound`/`hollow` |
| `src/world/Heightfield.ts` | modified | pipeline stages 3b/5b, `GenerateOptions.ringRelief/ringFeature/fairSpots`, `stats.ring` |
| `src/world/RingSurface.ts` | modified | option `skirtBottomAt` (skirt meets a drawn outside exactly) |
| `src/graphics/TerrainMesh.ts` | modified | options `outside`, `paint`, `outsideTriangleBudget`; build gains `outside`, `ringTriangles` (defaults unchanged) |
| `tests/world_ring_test.ts` (6), `tests/world_outside_test.ts` (5), `tests/world_readability_test.ts` (5) | new | 16 tests |
| scratch: `/Users/macmax/.hermes/cache/scratch/laneE2/{report.ts, raster.ts, probe_fair.ts, before/}` | outside repo | 100-seed report, software rasteriser, HEAD snapshot of `src/` for "before" |

## 2. The rules (R08: derived, with equations)

d = 0.2, g = 0.8, R = arenaRadius, c = cell. New base parameters: `fighterReach` = 1.9 m (mean of Weapon.ts TYPE_BASE
reaches 13/7 = 1.86 × mean build multiplier 1.02), `bodyRadius` = 0.5 m (Engine PLAYER_RADIUS).

| Rule | Equation | 12 m arena |
|---|---|---|
| fairRadius | min(fighterReach/2 + bodyRadius, R·fightZoneFraction) (fightZoneFraction = √d = 0.447: the central 20% of area) — two fighters trading blows at full reach across the centre both stand on it | 1.45 m |
| fairPadRadius | bodyRadius + c (body + the one-cell look-ahead of settleOnFloor) | 1.0 m |
| fair spots | Engine spawns: s = min(2.5, 0.4·ringHalf), player (−s, 0), opponent (s, s) (`duelSpawnPoints`; or `options.fairSpots`) | (−2.4,0), (2.4,2.4) |
| fairBlend | 1.5·stepHeight / (tan(maxSlope)·g) | 1.14 m |
| bandWidth / rollWavelength | R − fairRadius | 4.55 m |
| rollSlope (target RMS slope of the band) | tan(maxSlope)/2 | 0.289 |
| rolling cone | added = c(e)·tanh(k(n − median)/c(e)), c(e) = (tan(maxSlope) − rollSlope)·e, e = distance to the fair set; k solved so RMS |∇added| over free in-ring nodes = rollSlope (3 fixed-point steps) | — |
| bandFeatureCount | max(ceil(2/d), round(d·π(R² − fairRadius²)/(π·featureMinRadius²))) | 10 |
| bandFeatureMaxRadius / Amplitude | max(featureMinRadius, bandWidth/2) / that·tan(maxSlope)·g/1.5 | 2.28 m / 0.70 m |
| bandFeatureCapRatio, Alpha | solved like the field's Pareto (n = bandFeatureCount) | — |
| ringFeatureBand | R(1 − fightZoneFraction) (room between the fight zone, where holes/cliffs are banned, and the rim) | 3.32 m |
| ringFeatureRise (terrace rise = shallow-hole depth) | clamp(g²·ringFeatureBand·tan(maxSlope)/1.5, max(stepHeight, maxNeighbourDelta)/g, holeDepth) | 0.82 m (16 m: 1.09, 40 m: 1.75) |
| ringCliffSlopeWidth | 1.5·(rise/2)/(tan·g) | 1.33 m |
| ringHoleRadiusMax / ringHoleExitRun | max(featureMinRadius, ringFeatureBand·d) / ringFeatureRise / rampSlopeTan | 1.0 m / 1.77 m |

Pipeline (Heightfield.ts): base → bumps → ×relief → **3b** (own RNG stream `seed ^ RING_STREAM_SALT`, so all
original draws are unchanged): level pads to the fair datum (median of the fair centre), rolling ground, band mounds
(whole disc ≥ r + c off the fair set) → relax → outside deliberate set (pads are `keepClear`: tested against each
stamp's own geometry, a pad-only rejection does not use an attempt) → **5b** if < 4 hole/cliff nodes are inside the
ring: one terrace (no causeway, so its whole face stays visible; reachable round its tapered ends) or one shallow hole
(+ exit ramp), `ringDeliberateSpec` (125 attempts, overlap tested against the flagged mask) → relax. `ringRelief: false,
ringFeature: false` reproduces the lane E field bit for bit.

## 3. Exports (exact signatures)

**RingRelief.ts**
```ts
export const RING_STREAM_SALT = 0x5eed_e2;
export interface FairSpot { x: number; z: number }
export function duelSpawnPoints(outline: ArenaOutline): FairSpot[]
export function fairDistance(rules: TerrainRules, spots: readonly FairSpot[], x: number, z: number): number
export function freedomAt(rules: TerrainRules, x: number, z: number, spots: readonly FairSpot[] = []): number
export interface PadReport { datum: number; blends: number[] }
export function stampFairPads(g: WorkGrid, rules: TerrainRules, spots: readonly FairSpot[]): PadReport
export interface RollReport { amplitude: number; rawRmsSlope: number; swing: number; coneSlope: number; rmsSlope: number }
export function stampRingRoll(g: WorkGrid, rules: TerrainRules, rng: () => number, spots: readonly FairSpot[] = [], ringNorm?: Float32Array): RollReport
export const ROLL_GAIN_STEPS = 3;
export function stampBandMounds(g: WorkGrid, rules: TerrainRules, outline: ArenaOutline, rng: () => number, spots: readonly FairSpot[] = []): TerrainFeature[]
export function bandMoundShare(features: readonly TerrainFeature[]): number
export function flaggedInsideRing(mask: Uint8Array, ringNorm: Float32Array): number
export function minVisibleNodes(rules: TerrainRules): number
```
**OutsideSurface.ts**
```ts
export const TERRAIN_TRIANGLE_BUDGET = 6000;
export const OUTSIDE_COLOUR: [number, number, number];          // the old #8d8a83 plane, linear
export interface OutsideLayout { segments: number; bands: number; outerRadius: number; farRadius: number }
export interface OutsideSurface { layout; positions; normals; colors: Float32Array; indices: Uint32Array; vertexCount; fieldTriangles;
  apronTriangles; seamTriangles; triangleCount: number; rimRadius: Float32Array; baseY: number; farY: number }
export interface OutsideOptions { baseY?: number; triangleBudget?: number; farRadius?: number }
export function outsideLayoutFor(field: Heightfield, ring: RingSurface, options: OutsideOptions = {}): OutsideLayout
export function buildOutsideSurface(field: Heightfield, _outline: ArenaOutline, ring: RingSurface, options: OutsideOptions = {}, reuse?: OutsideSurface): OutsideSurface
export function outsideHeightAt(o: OutsideSurface, x: number, z: number): number          // drawn triangles; NaN inside the rim / past the apron
export function makeTerrainFloorSampler(ring: RingSurface, outside: OutsideSurface, field: Heightfield, outline: ArenaOutline): (x: number, z: number) => number
```
Layout: rows k = 0..K follow the field (row 0 on the ring's rim vertices), row K+1 = far apron (farRadius = max(outerRadius + c,
4R + 40), 4R + 40 being the old plane's half-width; y = farY = the median height of row K), plus an inward seam row. Triangles
2S(K + 2); outerRadius = max(maxRim + c, fieldHalf − c); K = clamp(ceil((outerRadius − maxRim)/c), 1, floor(budget/2S) − 2),
budget = max(6S, 6000 − ring triangles). 12 m: S = 96, K = 5 → 1344.

**TerrainReadability.ts**
```ts
export function sunDirection(hour: number, dayOfYear: number, place: Place): [number, number, number]
export function noonSuns(dayOfYear: number): { place: string; dir: [number, number, number]; elevationDeg: number }[]
export function vertexAreaWeights(positions: ArrayLike<number>, indices: ArrayLike<number>, triangleCount: number, vertexCount: number): Float64Array
export interface WeightedSpread { p20: number; p80: number; spread: number; mean: number }
export function weightedSpread(values: ArrayLike<number>, count: number, weights?: ArrayLike<number>): WeightedSpread
export interface LambertStats { intensity: Float64Array; perVertex: WeightedSpread; perArea: WeightedSpread }
export function lambertStats(normals: ArrayLike<number>, count: number, sun: readonly [number, number, number], areaWeights?: ArrayLike<number>): LambertStats
export interface Lab { L: number; a: number; b: number }
export function linearRgbToLab(r: number, g: number, b: number, out: Lab = { L: 0, a: 0, b: 0 }): Lab
export function deltaE76(p: Lab, q: Lab): number
export interface ZoneContrast { meanLab: (Lab | undefined)[]; pairs: { a: number; b: number; deltaE: number }[]; minDeltaE: number; meanDeltaE: number }
export function zoneContrast(colors: ArrayLike<number>, zoneOf: ArrayLike<number>, count: number, zoneCount: number, pairs: readonly (readonly [number, number])[], weights?: ArrayLike<number>): ZoneContrast
```
**TerrainPaint.ts**
```ts
export const TERRAIN_ZONES = { stone: 0, wood: 1, sand: 2, ice: 3, rampStone: 4, rampWood: 5, rampSand: 6, rampIce: 7,
  hole: 8, rim: 9, cliff: 10, skirt: 11, outside: 12, outsideRamp: 13 } as const;   // REGIONS[zone] is only a mask label
export const TERRAIN_COAT_BOUNDS: ColourBounds;    // chroma 0.03..0.42, Y 0.03..0.62
export const TERRAIN_VERTEX_BOUNDS: ColourBounds;  // chroma <= 0.45, Y 0.025..0.65
export const MATERIAL_PAINT: Record<GroundMaterial, { coat: string; light: string; dark: string; why: string }>;
export const FEATURE_PAINT: { hole; rim; cliff; rock; skirt; wear; tread; low; high; mottleDark; mottleLight; contour: string };
export const PLACE_GROUND: Record<string, string>;  // sunspire, greywall, verdant, frostford
export interface TerrainPaintOptions { ringHalf?: number; place?: string; cavity?: boolean }
export interface TerrainPaintResult { colors: Float32Array; zones: Uint8Array; stack: PaintStack }
export function ringHalfOf(outline: ArenaOutline): number
export function terrainPaintStack(field: Heightfield, place = "sunspire"): PaintStack
export const ROLE_FLOOR = 0, ROLE_WALL = 1, ROLE_OUTSIDE = 2;
export function terrainZoneAt(field: Heightfield, x: number, z: number, role: number, ringHalf: number): number
export function boundVertexColours(colors: Float32Array, count: number, bounds: ColourBounds = TERRAIN_VERTEX_BOUNDS): void
export interface PaintedGrid { colors: Float32Array; zones: Uint8Array; stack: PaintStack }
export function paintTerrainGrid(field: Heightfield, role: number, options: TerrainPaintOptions, ringHalf: number): PaintedGrid
export function sampleGridColour(field: Heightfield, grid: PaintedGrid, x: number, z: number, zone: number, out: Float32Array, o: number): void
export function paintTerrainSurface(field: Heightfield, outline: ArenaOutline, surface: RingSurface, options: TerrainPaintOptions = {}): TerrainPaintResult
export function paintOutsideSurface(field: Heightfield, outline: ArenaOutline, surface: OutsideSurface, options: TerrainPaintOptions = {}): TerrainPaintResult
```
Stack (bottom-up): coats `solid/normal` per zone → stone paving `scales/normal` (3c) → wood planks `stripes/normal` (4c)
→ sand ripples `stripes/multiply`, opacity 2(1 − sand.speed) = 0.6 → ice cracks `veins/screen`, opacity 1 − stone.stop/ice.stop
= 0.68 → outside tufts `spots/multiply` → mottle `noise/overlay` (4c) → ramp wear `solid/screen` + treads `stripes`(angle 0 =
height bands every rampSlopeTan·2c of rise)`/multiply` → cliff grain `noise/multiply` → step contours `stripes`(one band per
stepHeight of rise)`/multiply` → hypsometry `gradient(height)/softLight` over the ring's p20..p80 → slope rock
`gradient(up)/multiply`, none below tan·g, full at maxClimbTan. Then cavity: colour × (1 − d·clamp(∇²h / Lref, −1, 1)),
Lref = 2π·rollSlope/rollWavelength (dips ≤ 20% darker, crests ≤ 20% lighter), then `boundVertexColours`.
**Painted on the heightfield nodes** and sampled zone-aware-bilinearly by the mesh: per-vertex painting smeared every pattern
into a radial "sunburst" on the radial ring mesh (seen in a render). Kinds used: solid, scales, stripes, veins, spots, noise,
gradient (7); blends: normal, multiply, screen, overlay, softLight (5).

**TerrainOutside.ts**
```ts
export interface TerrainOutsideBuild { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>; surface: OutsideSurface; triangleCount: number }
export interface TerrainOutsideOptions extends OutsideOptions { paint?: TerrainPaintOptions | false }
export interface MeshArrays { positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint32Array }
export function writeArraysToGeometry(geometry: THREE.BufferGeometry, arrays: MeshArrays): THREE.BufferGeometry
export function buildTerrainOutside(field: Heightfield, outline: ArenaOutline, ring: RingSurface, options: TerrainOutsideOptions = {}, reuse?: TerrainOutsideBuild): TerrainOutsideBuild
```
**Changed signatures in lane E files**
```ts
// TerrainRules.ts: TerrainBase += fighterReach, bodyRadius; TerrainRules += fairRadius, fairPadRadius, fairBlend, bandWidth, rollSlope,
//   rollWavelength, rollOctaves, bandFeatureCount, bandFeatureMaxRadius, bandFeatureMaxAmplitude, bandFeatureCapRatio, bandFeatureAlpha,
//   ringFeatureBand, ringFeatureRise, ringCliffSlopeWidth, ringHoleRadiusMax, ringHoleExitRun
// TerrainFeatures.ts
export type TerrainFeatureKind = "bump" | "dip" | "mound" | "hollow" | "hole" | "cliff" | "ramp";
export interface Footprint { x: number; z: number; r: number }
export interface DeliberateSpec { cliffHeight; cliffSlopeWidth; holeDepth; holeRadiusMin; holeRadiusMax; holeExitRun; bandInner; bandOuter; insideMax; attempts: number; avoid: "footprints" | "mask" }
export interface DeliberateResult { features: TerrainFeature[]; placed: DeliberateCounts; taken: Footprint[] }
export function defaultDeliberateSpec(rules: TerrainRules): DeliberateSpec
export function ringDeliberateSpec(rules: TerrainRules): DeliberateSpec
export function stampDeliberate(g: WorkGrid, rules: TerrainRules, outline: ArenaOutline, counts: DeliberateCounts, rng: () => number,
  spec: DeliberateSpec = defaultDeliberateSpec(rules), taken: Footprint[] = [], keepClear: readonly Footprint[] = []): DeliberateResult
// Heightfield.ts
export interface GenerateOptions { deliberate?: Partial<DeliberateCounts>; ringRelief?: boolean; ringFeature?: boolean; fairSpots?: readonly FairSpot[] }
export interface RingStats { heights: Summary; band; fairRelief; datum: number; spots: FairSpot[]; spotSpread; bandSlopeRms: number;
  roll: RollReport | null; mounds; moundShare; insideBefore; insideAfter: number; feature: "terrace" | "hole" | "existing" | "none" | "off" }
// HeightfieldStats += ring: RingStats
// RingSurface.ts: RingSurfaceOptions += skirtBottomAt?: (x: number, z: number) => number
// TerrainMesh.ts
export interface TerrainMeshBuild { mesh; surface: RingSurface; triangleCount: number; ringTriangles: number; outside: TerrainOutsideBuild | null; floorHeightAt: (x: number, z: number) => number }
export interface TerrainMeshOptions extends RingSurfaceOptions { outsideBaseY?: number; outsideFollowsTerrain?: boolean; outside?: boolean;
  outsideTriangleBudget?: number; paint?: TerrainPaintOptions | false }
```
Shared-math candidates for MathCore: `weightedSpread`, `linearRgbToLab`, `deltaE76` (TerrainReadability.ts).

## 4. Integration patch (anchors are text; line numbers drift)

Nothing is needed for item 1: the engine's existing `generateArenaTerrain(seed, cfg)` call already gets the ring relief,
the in-ring feature and the levelled duel spawns (defaults).

### 4a. `src/engine/Engine.ts` — `#buildArena`

(i)+(ii)+(iii) REPLACE
```ts
      this.#terrainMesh = buildTerrainMesh(field, outlineFromArena(cfg),
        { outsideBaseY: cfg.outsideGround >= 1 ? cfg.outsideHeight : NaN }, this.#terrainMesh);
```
WITH
```ts
      const outsideOn = cfg.outsideGround >= 1;
      // #arenaType is rolled in #startFight before #buildArena; the place tints the outside ground.
      const placeId = PLACES[(["ring", "walls", "hills", "river"] as ArenaType[]).indexOf(this.#arenaType)]?.id ?? PLACES[0].id;
      this.#terrainMesh = buildTerrainMesh(field, outlineFromArena(cfg), {
        outsideBaseY: outsideOn ? cfg.outsideHeight : NaN,
        outside: outsideOn,                                     // (i) field-following outside, a CHILD of the floor mesh
        outsideFollowsTerrain: outsideOn,                       // (iii) floorHeightAt returns the drawn outside
        paint: { ringHalf: this.#ringHalf(), place: placeId },  // (ii) TerrainPaint colours (ring + outside)
      }, this.#terrainMesh);
      this.#arenaState.outsideFollowsTerrain = outsideOn;      // needs the ArenaState field of 4b
```
(i) In the same method REPLACE the anchor `    if (cfg.outsideGround >= 1) {` (the block commented
`// Outside ground: a solid concrete plane when the arena has one.`) WITH `    if (cfg.outsideGround >= 1 && !field) {`
(the flat plane stays only for the flat fallback; the outside mesh keeps the name `arena-outside`, so
`tools/probe-match.ts` still counts it).
Optional (exact spawns instead of the mirrored formula): in `#startFight`, move `const half = this.#ringHalf();
const spawn = Math.min(2.5, half * 0.4);` above the `generateArenaTerrain(...)` line and pass
`{}, this.#spectate ? {} : { fairSpots: [{ x: -spawn, z: 0 }, { x: spawn, z: spawn }] }` as its 3rd/4th arguments.
Snapshot: `triangles: this.#terrainMesh?.triangleCount` now includes the outside; add `ringTriangles: this.#terrainMesh?.ringTriangles ?? null` if wanted.

### 4b. `src/physics/ArenaPhysics.ts` — physics stands on the drawn outside
```ts
// ArenaState: add
  /** The outside ground follows the terrain (TerrainMeshOptions.outsideFollowsTerrain): floorAt is valid outside the ring. */
  outsideFollowsTerrain?: boolean;
// stepArenaBody: REPLACE the block anchored at
//   if (!onRing && cfg.outsideGround >= 1 && cfg.outsideCollision >= 1) {
//     const floor = cfg.outsideHeight + b.radius;
// WITH
  if (!onRing && cfg.outsideGround >= 1 && cfg.outsideCollision >= 1) {
    if (st.floorAt && st.outsideFollowsTerrain) {
      // Drawn outside: holes are fallen into, outside cliff faces block like the ring's.
      const px = prev ? prev.x : b.x - b.vx * dt, pz = prev ? prev.z : b.z - b.vz * dt;
      const falling = b.vy;
      const c = settleOnFloor(b, px, pz, st.floorAt, st.stepHeight ?? 0.35, st.maxClimbTan ?? Infinity, FLOOR_CONTACT);
      if (c.grounded && falling < -0.5) landedOutside = -falling;
    } else {
      const floor = cfg.outsideHeight + b.radius;
      if (b.y < floor) {
        if (b.vy < -0.5) landedOutside = -b.vy;
        b.y = floor;
        b.vy = 0;
      }
    }
  }
```
(`prev`, `dt`, `FLOOR_CONTACT`, `settleOnFloor` are already in scope from the lane E patch.) Absent flag = today's flat behaviour.

## 5. Before / after (real outputs)

"Before" = the HEAD snapshot (`git archive HEAD src`, commit 0e2b1f4) run by the same script; 100 seeds
(1000 + 7919k), circle arenas from `makeArena({ size })`; noon of day 301 (2026-10-28) from `environmentAt(12, 301, place)`.
Commands: `deno run --allow-read --allow-write=/Users/macmax/.hermes/cache/scratch …/laneE2/report.ts before 100` and `… after 100`
(outputs `report-before.txt`, `report-after.txt` in the scratch dir).

| Metric (mean over 100 seeds unless noted) | 12 m before | 12 m after | 16 m before | 16 m after |
|---|---|---|---|---|
| in-ring height p20 (m) | −0.064 | −0.282 | −0.066 | −0.389 |
| in-ring height p80 (m) | 0.047 | 0.196 | 0.051 | 0.316 |
| in-ring p80 − p20 (m) (median) | 0.111 (0.109) | 0.478 (0.462) | 0.117 (0.114) | 0.705 (0.686) |
| seeds with a visible hole/cliff inside (≥ 4 nodes) | 19/100 | **100/100** | 63/100 | **100/100** |
| seeds with any flagged node inside (ramps count) | 99/100 | 100/100 | 99/100 | 100/100 |
| hole / cliff / ramp nodes inside (sum) | 151 / 24 / 2356 | 388 / 738 / 2989 | 521 / 343 / 2923 | 614 / 834 / 3600 |
| in-ring stamp: terrace / hole / already visible | — | 46 / 43 / 11 | — | 23 / 15 / 62 |
| fair-centre relief max−min (mean / max, m) | — | 0.087 / 0.189 | — | 0.072 / 0.152 |
| spawn height difference (mean / max, m) | 0.081 / 0.657 | 0.000 / 0.000 | 0.057 / 0.156 | 0.000 / 0.000 |
| band RMS slope (unflagged, in ring, beyond fair blend) | — | 0.210 | — | 0.212 |
| max unflagged slope (limit 0.577) | 0.565 | 0.577 | 0.574 | 0.577 |
| **N·L p80−p20 per AREA, median**: sunspire (sun 63.9°) | 0.032 | **0.154** | 0.029 | **0.164** |
| greywall (27.9°) / verdant (41.9°) / frostford (12.9°) | 0.063 / 0.052 / 0.068 | 0.293 / 0.247 / 0.325 | 0.057 / 0.048 / 0.062 | 0.310 / 0.264 / 0.336 |
| N·L p80−p20 per VERTEX, median: sunspire / greywall / verdant / frostford | 0.024 / 0.047 / 0.040 / 0.052 | 0.118 / 0.227 / 0.194 / 0.249 | 0.021 / 0.042 / 0.035 / 0.046 | 0.128 / 0.246 / 0.209 / 0.270 |
| ΔE76 weakest adjacent material pair (min / mean over seeds) | 15.3 / 16.8 | **19.9 / 27.2** | 15.4 / 16.8 | **23.0 / 28.4** |
| ΔE76 mean of the 3 adjacent pairs (mean) | 23.7 | 38.0 | 23.7 | 38.8 |
| triangles ring + outside | 2400 + 0 | 2400 + 1344 = **3744** | 3960 + 0 | 3960 + 1920 = **5880** |

Targets: per-area N·L spread ≥ 0.15 — met at every place (Sunspire, the hardest, median 0.154 / 0.164; its min seed is
0.120 / 0.112). Per-VERTEX spread at Sunspire is 0.118 / 0.128: the ring mesh has 12 vertex rings at uniform radial steps,
each with 96 vertices, so vertex density per area falls as 1/r and per-vertex statistics over-weight the level centre;
per-area is what the camera sees. ΔE ≥ 12 met on
every seed. ≤ 6k triangles met at both live sizes (budget-driven K).

Software rasteriser (`raster.ts <seed> <size> <place> <view>`, 640×400, z-buffer, per-pixel Lambert with the engine's
sun ×1.6 and ambient ×1.6, /π like three's Lambert, NO shadows, NO near-plane clipping; ring-pixel luma = sRGB luminance of
pixels whose xz lies inside the ring radius, skirt included). Arg parsing fixed after the parent's note (a zsh `$args` loop
had passed one space-joined argument → `seed NaN`; the script now splits arguments on whitespace and throws on a non-integer
seed); every number below is from the re-run with explicit arguments, file names checked:

| Render | luma p80−p20 before → after | luma sd before → after | PNGs (scratch/laneE2/) |
|---|---|---|---|
| seed 1000, 12 m, sunspire, gameplay camera | 0.109 → 0.264 | 0.058 → 0.139 | before-/after-1000-12-sunspire-game.png |
| seed 8919, 12 m, verdant, gameplay camera | 0.099 → 0.193 | 0.052 → 0.109 | before-/after-8919-12-verdant-game.png |
| seed 1000, 12 m, sunspire, 3/4 view | 0.127 → 0.374 | 0.153 → 0.176 | before-/after-1000-12-sunspire-34.png |
| seed 8919, 12 m, verdant, 3/4 view | 0.116 → 0.275 | 0.138 → 0.135 | before-/after-8919-12-verdant-34.png |
| seed 16838, 16 m, greywall, 3/4 view | 0.118 → 0.233 | 0.098 → 0.113 | before-/after-16838-16-greywall-34.png |

## 6. Commands run (real output, from the project root, NO_COLOR=1)

```
$ deno check src/world/*.ts src/graphics/TerrainMesh.ts src/graphics/TerrainOutside.ts src/graphics/TerrainPaint.ts tests/world_*_test.ts
(exit 0, only "Check …" lines)
$ deno test --allow-read tests/world_*_test.ts
ok | 50 passed | 0 failed (6s)
$ deno lint src/world/ src/graphics/TerrainMesh.ts src/graphics/TerrainOutside.ts src/graphics/TerrainPaint.ts tests/world_*_test.ts
Checked 21 files
$ deno test --allow-read tests/paint_noise_test.ts tests/paint_blend_test.ts tests/paint_layers_test.ts tests/paint_recipes_test.ts
ok | 29 passed | 0 failed (1s)
```
Timing (`deno eval`, Apple M1 Pro, mean of 10 after a warm-up). generateArenaTerrain before (HEAD snapshot) → after, same
run: 12 m 2.22 → 3.30 ms, 16 m 4.23 → 5.68 ms, 40 m 26.32 → 37.35 ms. A separate run: ring + outside surfaces 0.54 / 0.73 /
2.11 ms and paint ring + outside 4.89 / 6.89 / 38.83 ms at 12 / 16 / 40 m. All once per match, not per frame.

## 7. Open issues / not verified / risks

- **Not integrated, not seen in the real renderer.** The engine has shadows, fog, tone mapping and higher resolution; the
  scratch rasteriser has none, so its luma spreads are a proxy only. The gameplay camera gains least (luma spread 0.193–0.264
  vs 0.233–0.374 from the 3/4 view): it looks at the level fair centre at a shallow angle. A browser vision pass after 4a is
  the real check.
- **More relief = more walking on slopes.** Band RMS slope ≈ 0.21 (≈ 12°), max at the 30° limit. Lane E's walker/A*/ramp
  tests still pass (`ordinary ground never blocks a walker`), but AI pacing on hills is not play-tested.
- **Spawn pads mirror an Engine formula** (`duelSpawnPoints`); if the engine changes its spawns, pass `fairSpots` (4a optional).
  Spectate mode spawns at random spots that are not levelled.
- **Seeds with an outside-set hole dropped** 92 → 87 of 100 at 12 m (first 50 seeds: 48 → 48; 16 m: 100 → 100), because
  spawn pads are kept clear; the in-ring stamp is not counted there and more than compensates inside the ring.
- **Height-banded stripes alias on steep ground**: step contours repeat every stepHeight of rise (1.2 m of run at the band's
  RMS slope) but under 2 cells of run above slope 0.35; ramp treads are fine (fixed 0.46 slope).
- **Paint cost scales with the grid**: 39 ms at 40 m (two 121² grid paints). Fine once per match; cache if rebuilt often.
- **ΔE is measured on albedo**, not lit pixels; very bright noon light can still compress sand vs ice on screen.
- `TerrainMesh` defaults are unchanged (no paint, no outside) so the engine looks exactly like today until 4a is applied.
- `deno task check` / the whole test suite were not run (other lanes in flight); only my files and lane B's paint tests.
