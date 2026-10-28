# Lane E — Terrain rules, heightfield, mesh, pathfinding (R07, R08, R12)

Status: **built and tested in isolation; NOT integrated** (Engine.ts / ArenaPhysics.ts are shared —
the exact patch is in §4). 34/34 lane tests pass, `deno check` and `deno lint` are clean on every lane
file, and a 100-seed report was run (§5). Nothing was built or served; port 8788 was not touched.

## 1. Files (all new)

| File | Role | Pure? |
|------|------|-------|
| `src/world/TerrainRules.ts` | Base parameters as data + every derived rule with its equation; Pareto solvers | yes |
| `src/world/HeightOps.ts` | value noise / fBm, target-band normalisation, slope relaxation (Lipschitz envelopes), slope stats | yes |
| `src/world/TerrainFeatures.ts` | Pareto bumps/dips, cliffs, holes, ramps (stamping + placement), feature codes | yes |
| `src/world/Heightfield.ts` | `generateHeightfield` pipeline, stats, `heightAt`/`normalAt`/`slopeAt`, flat field | yes |
| `src/world/PathFinder.ts` | A* (typed-array binary heap), string pulling, Catmull-Rom, steering | yes |
| `src/world/RingSurface.ts` | Floor mesh clipped to the ring outline as typed arrays + exact floor sampler | yes |
| `src/world/TerrainGround.ts` | `settleOnFloor`: step-up / cliff-blocking / falling for physics | yes |
| `src/graphics/TerrainMesh.ts` | THREE wrapper: BufferGeometry + Lambert vertex-colour material, in-place rebuild | THREE |
| `tests/world_rules_test.ts` (8), `world_heightfield_test.ts` (10), `world_path_test.ts` (8), `world_mesh_test.ts` (3), `world_ground_test.ts` (5) | 34 tests | |
| `/Users/macmax/.hermes/cache/scratch/laneE/report.ts` | 100-seed report (outside the repo) | |

New shared-math candidates for MathCore (parent decides): `cappedParetoStratumMean`,
`expectedCappedTopShare`, `solveParetoAlpha`, `solveCapRatio`, `stratifiedParetoSample`,
`remapToTargetBand`.

## 2. Public data layout (Lane F reads this directly)

```
Heightfield { cols, rows, cell, originX, originZ,
              heights: Float32Array, featureMask: Uint8Array, zone: Uint8Array, ringNorm: Float32Array,
              features: TerrainFeature[], rules: TerrainRules, seed, stats: HeightfieldStats }
node (i, j): world x = originX + i*cell, z = originZ + j*cell; index = j*cols + i (row-major, i along +x).
heights: metres, y up, datum 0 = the ring's median ground. Grid is centred on the arena origin.
featureMask: 0 none, 1 HOLE, 2 CLIFF, 4 RAMP  (distinct bits, exactly one per flagged node)
zone: 0 fight (rNorm <= sqrt(0.2)), 1 ring band (<= 1), 2 outside.  ringNorm = dist / ringRadiusAt(angle).
```

**Lane F compatibility (verified):** `samplerFromGrid(field, { cliff: FEATURE_CLIFF, hole: FEATURE_HOLE })`
maps hole→hole, cliff→cliff, ramp→none. Pass the bits explicitly: Lane F's default `{cliff: 1, hole: 2}`
swaps them. (Ramp was changed from 3 to 4 so bit tests never read a ramp as both.)

## 3. Exports (exact signatures)

**TerrainRules.ts**
```ts
export const PARETO_TOP_FRACTION = 0.2;                 // d
export const PARETO_TOP_SHARE = 1 - PARETO_TOP_FRACTION; // g
export const PROFILE_PEAK_SLOPE = 1.5;                  // max d/dt smoothstep
export interface TerrainBase { cellSize; arenaRadius; maxSlopeDeg; stepHeight; persistence; outsideMarginFraction; maxGridAxis: number }
export interface BaseParamSpec { min; max; def: number; unit: string; note: string }
export const TERRAIN_BASE_SPECS: Record<keyof TerrainBase, BaseParamSpec>;
export const TERRAIN_BASE_DEFAULTS: TerrainBase;      // 0.5 m, 6 m, 30°, 0.35 m, 0.5, 0.5, 128
export interface DeliberateCounts { holes: number; cliffs: number; ramps: number }
export interface TerrainRules { base; domainHalf; cell; gridAxis; maxSlopeTan; maxNeighbourDelta; maxDiagonalDelta; maxClimbTan;
  fightZoneFraction; outsideBlendWidth; fightRelief; outsideRelief; ringRelief; targetBand; baseWavelength; octaves;
  octaveGains: number[]; featureMinRadius; featureMaxRadius; featureCount; featureSlopeUse; featureCapRatio; featureAlpha;
  featureExpectedShare; holeDepth; cliffHeight; holeRadiusMin; holeRadiusMax; rampSlopeTan; rampHalfWidth; cliffSlopeWidth;
  holeExitRun; deliberateBandArea; deliberate: DeliberateCounts; relaxMaxIterations; relaxSlack; slopePenalty; downhillFactor }
export interface RuleEquation { key: string; value: number; unit: string; equation: string }
export function cappedParetoStratumMean(a: number, b: number, alpha: number, cap: number): number
export function expectedCappedTopShare(alpha: number, capRatio: number, n: number, topFraction = PARETO_TOP_FRACTION): number
export interface AlphaSolution { alpha; share; peakShare; peakAlpha: number; reachable: boolean }
export function solveParetoAlpha(targetShare: number, capRatio: number, n: number, topFraction = PARETO_TOP_FRACTION): AlphaSolution
export function solveCapRatio(targetShare: number, n: number, topFraction = PARETO_TOP_FRACTION): number
export function stratifiedParetoSample(rng: () => number, n: number, xm: number, alpha: number, capRatio: number, jitter = PARETO_TOP_FRACTION): Float64Array
export function clampTerrainBase(over: Partial<TerrainBase> = {}): TerrainBase
export function deriveTerrainRules(over: Partial<TerrainBase> = {}): TerrainRules
export function describeTerrainRules(r: TerrainRules): RuleEquation[]
```
**HeightOps.ts**
```ts
export const FORWARD_DI: readonly number[]; export const FORWARD_DJ: readonly number[];
export function hash01(ix: number, iz: number, salt: number): number
export function valueNoise2(x: number, z: number, salt: number): number
export interface FbmOctaves { gains; frequencies: Float64Array; offsetX; offsetZ: Float64Array; salts: Int32Array }
export function makeFbmOctaves(gains: readonly number[], baseWavelength: number, rng: () => number): FbmOctaves
export function fbm2(o: FbmOctaves, x: number, z: number): number
export function remapToTargetBand(values: Float64Array | Float32Array, p20: number, p80: number, band: number): void
export interface RelaxReport { iterations: number; converged: boolean; residual: number; corrections: number }
export function relaxSlopes(h: Float64Array, mask: Uint8Array, cols: number, rows: number, axisLimit: number, diagLimit: number, maxIterations: number, slack: number): RelaxReport
export type PairFilter = "unflagged" | "flagged";
export function maxSlopeExcess(h: ArrayLike<number>, mask: Uint8Array, cols: number, rows: number, axisLimit: number, diagLimit: number, filter: PairFilter): number
export function slopePairs(h: ArrayLike<number>, mask: Uint8Array, cols: number, rows: number, cell: number, filter: PairFilter): Float64Array
```
**TerrainFeatures.ts** (FEATURE_*, `rNormAt`, `ArenaOutline`, `TerrainFeature*` are re-exported by Heightfield.ts)
```ts
export const FEATURE_NONE = 0, FEATURE_HOLE = 1, FEATURE_CLIFF = 2, FEATURE_RAMP = 4;
export interface ArenaOutline { radiusAt(angle: number): number }
export function rNormAt(outline: ArenaOutline, x: number, z: number): number
export type TerrainFeatureKind = "bump" | "dip" | "hole" | "cliff" | "ramp";
export interface TerrainFeature { kind; x; z; radius; amplitude; relative; dirX; dirZ }
export interface WorkGrid { cols; rows; cell; originX; originZ; h: Float64Array; mask: Uint8Array }
export function sampleWork(g: WorkGrid, x: number, z: number): number
export function stampParetoBumps(g: WorkGrid, rules: TerrainRules, reliefAt: (x: number, z: number) => number, rng: () => number): TerrainFeature[]
export interface DeliberateResult { features: TerrainFeature[]; placed: DeliberateCounts }
export function stampDeliberate(g: WorkGrid, rules: TerrainRules, outline: ArenaOutline, counts: DeliberateCounts, rng: () => number): DeliberateResult
```
**Heightfield.ts**
```ts
export const ZONE_FIGHT = 0, ZONE_RING = 1, ZONE_OUTSIDE = 2;
export interface HeightfieldStats { base; heights; normalised; slope: Summary; baseBandBeforeRemap; measuredBand; measuredBandOrdinary;
  targetBand; slopeLimitTan; flaggedMaxSlope; slopeResidual: number; relaxFirst; relaxSecond: RelaxReport;
  features: { count; raised; dug; shareDrawn; shareMetres; shareVolume; alpha; expectedShare };
  zones: { fightStdev; ringStdev; outsideStdev }; deliberate: { requested; placed: DeliberateCounts; flaggedNodes }; millis: number }
export interface Heightfield { /* §2 */ }
export interface GenerateOptions { deliberate?: Partial<DeliberateCounts> }
export function reliefAtNorm(rules: TerrainRules, rNorm: number): number
export function outlineFromArena(cfg: ArenaConfig): ArenaOutline
export function circleOutline(radius: number): ArenaOutline
export function outlineMaxRadius(outline: ArenaOutline, samples = 64): number
export function generateHeightfield(seed: number, rules: TerrainRules, outline: ArenaOutline, options: GenerateOptions = {}): Heightfield
export function flatHeightfield(rules: TerrainRules, outline: ArenaOutline): Heightfield
export function generateArenaTerrain(seed: number, cfg: ArenaConfig, over: Partial<TerrainBase> = {}, options: GenerateOptions = {}): Heightfield
export function heightAt(f: Heightfield, x: number, z: number): number                 // bilinear, clamped, allocation-free
export interface Vec3Out { x: number; y: number; z: number }
export function normalAt(f: Heightfield, x: number, z: number, out: Vec3Out = { x: 0, y: 1, z: 0 }): Vec3Out
export function slopeAt(f: Heightfield, x: number, z: number): number
export function nearestNode(f: Heightfield, x: number, z: number): number
export function nodeX(f: Heightfield, i: number): number
export function nodeZ(f: Heightfield, j: number): number
```
**PathFinder.ts**
```ts
export interface Obstacle { x: number; z: number; radius: number }
export interface PathPoint { x: number; z: number; y: number }
export interface PathOptions { agentRadius?: number; inside?: (x: number, z: number) => boolean; snapNodes?: number; maxExpanded?: number }
export interface PathResult { points: PathPoint[]; length: number; expanded: number; gridPath: number[]; gridLength: number }
export function obstaclesFromProps(props: readonly ArenaObject[]): Obstacle[]
export class GridPathFinder {
  readonly field: Heightfield; readonly walkable: Uint8Array;
  constructor(field: Heightfield, obstacles: readonly Obstacle[] = [], options: PathOptions = {})
  setObstacles(obstacles: readonly Obstacle[], options: PathOptions = {}): void
  edgeAllowed(a: number, b: number): boolean
  lineWalkable(ax: number, az: number, bx: number, bz: number): boolean
  find(from: { x: number; z: number }, to: { x: number; z: number }, options: PathOptions = {}): PathResult | null
  stringPull(points: PathPoint[]): PathPoint[]
  smooth(points: PathPoint[], samplesPerSpan = 6): PathPoint[]          // centripetal Catmull-Rom, falls back to straight spans
}
export function polylineLength(points: readonly PathPoint[]): number
export function findPath(field: Heightfield, from: { x: number; z: number }, to: { x: number; z: number }, obstacles: readonly Obstacle[] = [], options: PathOptions = {}): PathResult | null
export interface PathCursor { index: number }
export interface Steer { dirX: number; dirZ: number; done: boolean }
export function steerAlongPath(points: readonly PathPoint[], cursor: PathCursor, x: number, z: number, arriveRadius: number, out: Steer): Steer
```
**RingSurface.ts / TerrainGround.ts / TerrainMesh.ts**
```ts
export const GROUND_COLOURS: Record<GroundMaterial, [number, number, number]>; export const SKIRT_COLOUR; export const FLOOR_THICKNESS = 0.6;
export interface RingLayout { rings: number; segments: number }
export interface RingSurface { layout; positions; normals; colors: Float32Array; indices: Uint32Array; vertexCount; floorTriangles; skirtTriangles; triangleCount: number; rimRadius: Float32Array; skirtBottomY: number }
export interface RingSurfaceOptions { layout?: Partial<RingLayout>; ringHalf?: number; skirtBottomY?: number }
export function ringLayoutFor(field: Heightfield, outline: ArenaOutline): RingLayout
export function buildRingSurface(field: Heightfield, outline: ArenaOutline, options: RingSurfaceOptions = {}, reuse?: RingSurface): RingSurface
export function surfaceHeightAt(s: RingSurface, x: number, z: number): number          // drawn triangles; NaN outside the ring
export function makeFloorSampler(s: RingSurface, field: Heightfield, outsideBaseY: number, outsideFollowsTerrain = false): (x: number, z: number) => number
export interface FloorBody { x; y; z; vx; vy; vz; radius: number }
export interface FloorContact { grounded: boolean; blocked: boolean; floorY: number }
export function settleOnFloor(b: FloorBody, prevX: number, prevZ: number, floorAt: (x: number, z: number) => number, stepHeight: number, maxClimbTan: number, out?: FloorContact): FloorContact
// src/graphics/TerrainMesh.ts
export interface TerrainMeshBuild { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>; surface: RingSurface; triangleCount: number; floorHeightAt: (x: number, z: number) => number }
export interface TerrainMeshOptions extends RingSurfaceOptions { outsideBaseY?: number; outsideFollowsTerrain?: boolean }
export function writeSurfaceToGeometry(geometry: THREE.BufferGeometry, surface: RingSurface): THREE.BufferGeometry
export function buildTerrainMesh(field: Heightfield, outline: ArenaOutline, options: TerrainMeshOptions = {}, reuse?: TerrainMeshBuild): TerrainMeshBuild
```

## 4. Integration patch (parent applies; anchors are text, line numbers drift)

### 4a. `src/physics/ArenaPhysics.ts` — bodies stand on the terrain

```ts
// imports (top)
import { settleOnFloor, type FloorContact } from "../world/TerrainGround.ts";

// ArenaState: add three optional fields (absent = today's flat floor, so every existing test keeps passing)
  /** Terrain floor height at (x, z), m (TerrainMeshBuild.floorHeightAt). */
  floorAt?: (x: number, z: number) => number;
  /** TerrainRules.base.stepHeight and TerrainRules.maxClimbTan. */
  stepHeight?: number;
  maxClimbTan?: number;

// module scope, after ARENA_GRAVITY
const FLOOR_CONTACT: FloorContact = { grounded: false, blocked: false, floorY: 0 }; // reused, no per-frame allocation

// stepArenaBody — REPLACE the block anchored at
//   const onRing = insideRing(cfg, b.x, b.z);
//   if (onRing && b.y < b.radius && b.y > -b.radius * 2) { b.y = b.radius; b.vy = 0; }
// WITH
  const onRing = insideRing(cfg, b.x, b.z);
  if (st.floorAt && onRing) {
    // prev = last frame's position (walking/AI already moved x/z): a cliff face undoes the move.
    const px = prev ? prev.x : b.x - b.vx * dt, pz = prev ? prev.z : b.z - b.vz * dt;
    settleOnFloor(b, px, pz, st.floorAt, st.stepHeight ?? 0.35, st.maxClimbTan ?? Infinity, FLOOR_CONTACT);
  } else if (onRing && b.y < b.radius && b.y > -b.radius * 2) {
    b.y = b.radius;
    b.vy = 0;
  }
// wall test: `b.y < cfg.wallHeight`  ->  `b.y < (st.floorAt ? st.floorAt(b.x * 0.98, b.z * 0.98) : 0) + cfg.wallHeight`
// outside branch: unchanged (floorAt returns cfg.outsideHeight outside the ring unless outsideFollowsTerrain).
```
The `b.y > -2r` guard is not needed on terrain: a body walking into a hole falls onto the drawn hole floor; a
body walking into a cliff face from below is blocked by `settleOnFloor` (tests/world_ground_test.ts).

### 4b. `src/engine/Engine.ts`

```ts
// imports
import { FEATURE_CLIFF, FEATURE_HOLE, generateArenaTerrain, heightAt, outlineFromArena, type Heightfield } from "../world/Heightfield.ts";
import { GridPathFinder, obstaclesFromProps, steerAlongPath, type PathCursor, type PathPoint, type Steer } from "../world/PathFinder.ts";
import { buildTerrainMesh, type TerrainMeshBuild } from "../graphics/TerrainMesh.ts";

// fields (next to #arenaState)
  #terrainField: Heightfield | null = null;
  #terrainMesh: TerrainMeshBuild | undefined;      // reused across matches (arrays rebuilt in place)
  #pathFinder: GridPathFinder | null = null;
  #aiPath: { points: PathPoint[]; cursor: PathCursor; goalX: number; goalZ: number; age: number } | null = null;
  #aiSteer: Steer = { dirX: 0, dirZ: 0, done: true };
  #aiHeadingOut = { x: 0, z: 0 };

// match start — AFTER the block anchored at `props: placeObjects(cfg, arenaRng),\n    };`
    this.#terrainField = generateArenaTerrain(Math.floor(arenaRng() * 0x7fffffff), cfg);
    this.#aiPath = null;
    for (const p of this.#arenaState.props) p.y = heightAt(this.#terrainField, p.x, p.z); // physics compares b.y with p.y + h
```

`#buildArena` — REPLACE the block from `// Floor: a shape from the outline, extruded 0.6 m down.` through `g.add(floor);` with:
```ts
    const field = this.#terrainField;
    if (field) {
      // Floor: the rule-driven terrain clipped to the ring outline (one draw call; triangleCount for the R13 budget).
      this.#terrainMesh = buildTerrainMesh(field, outlineFromArena(cfg),
        { outsideBaseY: cfg.outsideGround >= 1 ? cfg.outsideHeight : NaN }, this.#terrainMesh);
      g.add(this.#terrainMesh.mesh);
      this.#arenaState.floorAt = this.#terrainMesh.floorHeightAt;
      this.#arenaState.stepHeight = field.rules.base.stepHeight;
      this.#arenaState.maxClimbTan = field.rules.maxClimbTan;
      this.#pathFinder = new GridPathFinder(field, obstaclesFromProps(this.#arenaState.props),
        { agentRadius: PLAYER_RADIUS, inside: (x, z) => edgeDistance(cfg, x, z) > PLAYER_RADIUS });
    } else { /* keep the existing ExtrudeGeometry floor block here unchanged */ }
    const floorY = (x: number, z: number) => (this.#terrainMesh && field ? this.#terrainMesh.floorHeightAt(x, z) : 0);
```
Then in the same method:
- walls: compute `rimLo/rimHi` = min/max of `floorY(p.x * 0.98, p.z * 0.98)` over `pts`; build each segment as
  `new THREE.BoxGeometry(len + 0.05, cfg.wallHeight + (rimHi - rimLo), 0.35)` and set its y to
  `rimLo + (cfg.wallHeight + rimHi - rimLo) / 2` (no gap under the wall where the rim dips).
- props: `m.position.set(p.x, (s.h * p.scale) / 2, p.z)` → `m.position.set(p.x, p.y + (s.h * p.scale) / 2, p.z)`.
- `#spawnPickups`: `marker.position.set(p.x, 0.5, p.z)` →
  `marker.position.set(p.x, (this.#arenaState.floorAt ? this.#arenaState.floorAt(p.x, p.z) : 0) + 0.5, p.z)`.

`#rebuildTerrain` — after `this.#scene.add(g);` add `if (this.#terrainField) return;` (the decorative "hills"
spheres and the "river" boxes would float over / cut through the real terrain).

AI path following — new method next to `#roam`:
```ts
  /**
   * Unit heading for `f` toward (tx, tz): straight when the straight line is walkable,
   * otherwise along an A* path that is re-planned when the target drifts 2 cells or after
   * the time to walk 2 cells (2 cell / AI_MOVE_SPEED). Reuses one output object.
   */
  #aiHeading(f: Fighter, tx: number, tz: number, dt: number): { x: number; z: number } {
    const out = this.#aiHeadingOut, pf = this.#pathFinder;
    const dx = tx - f.body.x, dz = tz - f.body.z, d = Math.hypot(dx, dz) || 1;
    out.x = dx / d; out.z = dz / d;
    if (!pf || pf.lineWalkable(f.body.x, f.body.z, tx, tz)) { this.#aiPath = null; return out; }
    const cell = pf.field.cell, path = this.#aiPath;
    if (!path || (path.age += dt) > (2 * cell) / AI_MOVE_SPEED || Math.hypot(path.goalX - tx, path.goalZ - tz) > 2 * cell) {
      const found = pf.find({ x: f.body.x, z: f.body.z }, { x: tx, z: tz });
      this.#aiPath = found ? { points: found.points, cursor: { index: 1 }, goalX: tx, goalZ: tz, age: 0 } : null;
    }
    if (!this.#aiPath) return out;
    const s = steerAlongPath(this.#aiPath.points, this.#aiPath.cursor, f.body.x, f.body.z, cell / 2, this.#aiSteer);
    if (!s.done) { out.x = s.dirX; out.z = s.dirZ; }
    return out;
  }
```
In `#opponentAct`:
- after `const dist = Math.hypot(dx, dz) || 1;` add `const heading = this.#aiHeading(o, p.body.x, p.body.z, dt);`
  and in `executeAction(action, { dirX: dx / dist, dirZ: dz / dist, ...` use `dirX: heading.x, dirZ: heading.z`
  (`executeAction` builds approach/retreat/strafe from dirX/dirZ, so all moves follow the path; `distance` stays the
  straight distance for reach checks).
- hunting branch (`const hx = last.x - o.body.x, ...`): move with `const h = this.#aiHeading(o, last.x, last.z, dt);
  o.body.x += h.x * speed * dt; o.body.z += h.z * speed * dt;` (keep the `hd > 0.5` test).
- the coin branch can do the same with `coin.x, coin.z`.

Minimap (Lane F): `samplerFromGrid(this.#terrainField, { cliff: FEATURE_CLIFF, hole: FEATURE_HOLE })`.

## 5. Commands run and their real output

All from `/Users/macmax/Desktop/Mytherrania` with `NO_COLOR=1`.

```
$ deno check src/world/*.ts src/graphics/TerrainMesh.ts tests/world_rules_test.ts tests/world_heightfield_test.ts tests/world_path_test.ts tests/world_mesh_test.ts tests/world_ground_test.ts
Check src/world/HeightOps.ts
Check src/world/Heightfield.ts
Check src/world/PathFinder.ts
Check src/world/RingSurface.ts
Check src/world/TerrainFeatures.ts
Check src/world/TerrainGround.ts
Check src/world/TerrainRules.ts
Check src/graphics/TerrainMesh.ts
Check tests/world_rules_test.ts
Check tests/world_heightfield_test.ts
Check tests/world_path_test.ts
Check tests/world_mesh_test.ts
Check tests/world_ground_test.ts
(exit 0)
```

```
$ deno test --allow-read tests/world_rules_test.ts tests/world_heightfield_test.ts tests/world_path_test.ts tests/world_mesh_test.ts tests/world_ground_test.ts
running 8 tests from ./tests/world_rules_test.ts
the 80/20 constants agree: the top 20% of a Pareto(alpha_80/20) holds 80% ... ok (8ms)
every derived rule follows its equation from the base parameters ... ok (109ms)
signs: a steeper limit allows larger neighbour deltas, a taller step a taller fight relief ... ok (4ms)
the Pareto shape is re-solved under the cap so the expected top share is exactly g ... ok (18ms)
stratified Pareto samples hold ~80% in their top 20% for every seed and size ... ok (17ms)
base parameters are clamped to their declared ranges; NaN falls back to the default ... ok (64µs)
describeTerrainRules lists every derived value with a finite value and an equation ... ok (1ms)
remapToTargetBand pins min, max and the p20/p80 band ... ok (2ms)
running 10 tests from ./tests/world_heightfield_test.ts
50 seeds: every UNFLAGGED neighbour pair respects the slope limit ... ok (84ms)
50 seeds: flagged holes and cliffs DO exceed the limit (the exception exists) ... ok (4ms)
ramps are planar and walkable among themselves; holes and cliffs stay out of the fight zone ... ok (2ms)
50 seeds: normalised base heights cover [0, 1] with the target p80 - p20 band ... ok (128µs)
50 seeds: the measured Pareto share of feature amplitudes is 0.8 +- 0.08 ... ok (115µs)
50 seeds: the fight zone is flatter than the ring band and the outskirts ... ok (89µs)
same seed -> identical field; different seed -> different field ... ok (4ms)
every ring shape: the slope rule holds and features are flagged ... ok (78ms)
heightAt interpolates the nodes; normalAt is a unit up-facing vector ... ok (1ms)
relaxSlopes: limits a spike symmetrically, keeps flagged nodes, leaves a legal field untouched ... ok (167µs)
running 8 tests from ./tests/world_path_test.ts
A* goes AROUND an obstacle; string pulling keeps a few vertices and is never longer ... ok (5ms)
a steep wall is crossed only through its gap ... ok (3ms)
unreachable goals return null (enclosed goal, start in a sealed pen, goal in a deep hole) ... ok (3ms)
50 generated arenas: A* finds a path IFF one exists, and every path is legal and only shortened ... ok (111ms)
Catmull-Rom smoothing passes through the vertices and never leaves walkable ground ... ok (1ms)
steerAlongPath walks an agent to the goal; findPath caches one finder per field ... ok (1ms)
hole exits: a fighter at the bottom of a hole finds a path out over its ramp ... ok (53ms)
generateArenaTerrain + props: the default arena is pathable centre to rim ... ok (3ms)
running 3 tests from ./tests/world_mesh_test.ts
every ring shape: triangle count = S(2R + 1), floor faces up, skirt faces out ... ok (46ms)
the floor sampler returns the DRAWN triangles: exact at vertices, NaN outside the ring ... ok (4ms)
TerrainMesh: one geometry, rebuilt in place, floorHeightAt inside and outside ... ok (8ms)
running 5 tests from ./tests/world_ground_test.ts
a small ledge is stepped onto; resting bodies stay grounded ... ok (360µs)
a cliff face is a wall from below: the move is undone and horizontal speed cancelled ... ok (52µs)
walking off a cliff top or into a hole falls instead of snapping down ... ok (56µs)
on generated terrain: a walker heading into a cliff face is stopped and never sinks ... ok (70ms)
on generated terrain: ordinary ground and ramps never block a walker ... ok (69ms)
ok | 34 passed | 0 failed (872ms)
```

```
$ deno lint src/world/ src/graphics/TerrainMesh.ts tests/world_*_test.ts (the five lane files)
Checked 13 files
```

```
$ deno run --allow-read /Users/macmax/.hermes/cache/scratch/laneE/report.ts
=== arena size 12 m (radius 6 m), grid 37x37 @ 0.500 m, 21 Pareto features ===
  domainHalf             =         9 m           arenaRadius * (1 + outsideMarginFraction)
  cell                   =       0.5 m           max(cellSize, 2 domainHalf / (maxGridAxis - 1))
  gridAxis               =        37 nodes       ceil(2 domainHalf / cell) + 1
  maxSlopeTan            =    0.5774             tan(maxSlopeDeg)
  maxNeighbourDelta      =    0.2887 m           cell * tan(maxSlope)
  maxDiagonalDelta       =    0.4082 m           cell * sqrt2 * tan(maxSlope)
  maxClimbTan            =    0.7217             tan(maxSlope) / g: body climb limit on the mesh
  fightZoneFraction      =    0.4472 rNorm       sqrt(d): central 20% of the ring area
  outsideBlendWidth      =       0.4 rNorm       outsideMarginFraction * g
  fightRelief            =      0.35 m           stepHeight
  outsideRelief          =    1.3856 m           max(fightRelief, arenaRadius * outsideMarginFraction * tan(maxSlope) * g)
  ringRelief             =    0.6964 m           sqrt(fightRelief * outsideRelief)
  targetBand             =       0.2 0..1        1 - g: target p80 - p20 of normalised base heights
  baseWavelength         =         6 m           arenaRadius
  octaves                =         3             floor(log2(baseWavelength / (2 cell))) + 1
  featureMinRadius       =         1 m           2 cell
  featureMaxRadius       =         6 m           arenaRadius
  featureCount           =        21             max(ceil(2/d), round(domainArea * d / (pi featureMinRadius^2)))
  featureSlopeUse        =       0.8             g
  featureCapRatio        =       256 x           smallest 2^k whose capped Pareto reaches g + d(1-g)
  featureAlpha           =    0.8511             solve E[topShare_d] = g under the cap (-> 1.161 uncapped)
  featureExpectedShare   =       0.8             E[topShare_d] at featureAlpha
  holeDepth              =      1.75 m           max(stepHeight, maxNeighbourDelta) / d
  cliffHeight            =      1.75 m           max(stepHeight, maxNeighbourDelta) / d
  holeRadiusMax          =       1.2 m           max(featureMinRadius, arenaRadius * d)
  rampSlopeTan           =    0.4619             tan(maxSlope) * g
  rampHalfWidth          =    1.2071 m           cell (1 + sqrt2): walkable corridor >= 2 nodes at any heading
  cliffSlopeWidth        =    2.8416 m           1.5 (cliffHeight / 2) / (tan(maxSlope) g)
  holeExitRun            =    3.7889 m           holeDepth / rampSlopeTan
  deliberateBandArea     =  199.0513 m^2         pi R^2 ((1 + outsideMarginFraction g)^2 - fightZoneFraction^2)
  holes = cliffs         =         1             max(1, floor(d bandArea / (pi (cliffFootprint^2 + holeFootprint^2))))
  ramps                  =         2             holes + cliffs
  relaxMaxIterations     =        37 sweep pairs gridAxis
  slopePenalty           =    1.7321             1 / tan(maxSlope)
  downhillFactor         =      0.25             d / g
  mesh: 12 rings x 96 segments = 2400 triangles (2208 floor + 192 skirt), 1345 vertices
  --- over 100 seeds ---
  height spread (m)                  min     1.927  max     3.463  mean     2.857  median     2.911
  height stdev (m)                   min     0.197  max     0.376  mean     0.311  median     0.317
  normalised p80-p20 (all)           min     0.059  max     0.118  mean     0.086  median     0.084
  normalised p80-p20 (unflagged)     min     0.077  max     0.200  mean     0.131  median     0.131
  base p80-p20 after remap           min     0.200  max     0.201  mean     0.200  median     0.200
  base p80-p20 before remap          min     0.189  max     0.495  mean     0.350  median     0.356
  max unflagged slope (tan)          min     0.499  max     0.577  mean     0.569  median     0.577
  mean unflagged slope (tan)         min     0.061  max     0.098  mean     0.077  median     0.079
  p80 unflagged slope (tan)          min     0.089  max     0.157  mean     0.122  median     0.123
  slope residual (m, <=0 ok)         min    -0.047  max    -0.000  mean    -0.005  median    -0.000
  max flagged slope (tan)            min     3.408  max     5.139  mean     3.885  median     3.819
  relax pass 1 sweep pairs           min     1.000  max     2.000  mean     1.370  median     1.000
  relax pass 2 sweep pairs           min     1.000  max     2.000  mean     1.590  median     2.000
  nodes repaired pass 1 (%)          min     0.000  max     1.607  mean     0.187  median     0.000
  feature share drawn (top 20%)      min     0.785  max     0.813  mean     0.801  median     0.801
  feature share metres               min     0.653  max     0.885  mean     0.799  median     0.813
  feature share volume               min     0.653  max     0.967  mean     0.857  median     0.890
  fight-zone stdev (m)               min     0.009  max     0.098  mean     0.036  median     0.036
  ring-band stdev (m)                min     0.056  max     0.460  mean     0.240  median     0.239
  outside stdev (m)                  min     0.222  max     0.453  mean     0.337  median     0.343
  generation time (ms)               min      1.18  max     11.31  mean      1.53  median      1.34
  walk mask build (ms)               min      0.11  max      1.49  mean      0.19  median      0.13
  walkable nodes in ring (%)         min    17.162  max    69.565  mean    48.716  median    49.428
  A* expanded nodes                  min     1.000  max   216.000  mean    24.484  median    16.000
  A* + string pull time (ms)         min      0.00  max      0.88  mean      0.03  median      0.02
  path vertices after pulling        min     1.000  max    12.000  mean     2.778  median     2.000
  grid nodes before pulling          min     1.000  max    44.000  mean    10.136  median     9.000
  pulled / grid length               min     0.805  max     1.000  mean     0.956  median     0.953
  relaxation converged (both passes): 100/100
  holes placed 89/100, cliffs placed 100/100
  A* queries with a path: 919/1000 (the rest: endpoints in different walkable components)

=== arena size 40 m (radius 20 m), grid 121x121 @ 0.500 m, 229 Pareto features ===
  domainHalf             =        30 m           arenaRadius * (1 + outsideMarginFraction)
  cell                   =       0.5 m           max(cellSize, 2 domainHalf / (maxGridAxis - 1))
  gridAxis               =       121 nodes       ceil(2 domainHalf / cell) + 1
  maxSlopeTan            =    0.5774             tan(maxSlopeDeg)
  maxNeighbourDelta      =    0.2887 m           cell * tan(maxSlope)
  maxDiagonalDelta       =    0.4082 m           cell * sqrt2 * tan(maxSlope)
  maxClimbTan            =    0.7217             tan(maxSlope) / g: body climb limit on the mesh
  fightZoneFraction      =    0.4472 rNorm       sqrt(d): central 20% of the ring area
  outsideBlendWidth      =       0.4 rNorm       outsideMarginFraction * g
  fightRelief            =      0.35 m           stepHeight
  outsideRelief          =    4.6188 m           max(fightRelief, arenaRadius * outsideMarginFraction * tan(maxSlope) * g)
  ringRelief             =    1.2714 m           sqrt(fightRelief * outsideRelief)
  targetBand             =       0.2 0..1        1 - g: target p80 - p20 of normalised base heights
  baseWavelength         =        20 m           arenaRadius
  octaves                =         5             floor(log2(baseWavelength / (2 cell))) + 1
  featureMinRadius       =         1 m           2 cell
  featureMaxRadius       =        20 m           arenaRadius
  featureCount           =       229             max(ceil(2/d), round(domainArea * d / (pi featureMinRadius^2)))
  featureSlopeUse        =       0.8             g
  featureCapRatio        =       256 x           smallest 2^k whose capped Pareto reaches g + d(1-g)
  featureAlpha           =    0.8737             solve E[topShare_d] = g under the cap (-> 1.161 uncapped)
  featureExpectedShare   =       0.8             E[topShare_d] at featureAlpha
  holeDepth              =      1.75 m           max(stepHeight, maxNeighbourDelta) / d
  cliffHeight            =      1.75 m           max(stepHeight, maxNeighbourDelta) / d
  holeRadiusMax          =         4 m           max(featureMinRadius, arenaRadius * d)
  rampSlopeTan           =    0.4619             tan(maxSlope) * g
  rampHalfWidth          =    1.2071 m           cell (1 + sqrt2): walkable corridor >= 2 nodes at any heading
  cliffSlopeWidth        =    2.8416 m           1.5 (cliffHeight / 2) / (tan(maxSlope) g)
  holeExitRun            =    3.7889 m           holeDepth / rampSlopeTan
  deliberateBandArea     = 2211.6812 m^2         pi R^2 ((1 + outsideMarginFraction g)^2 - fightZoneFraction^2)
  holes = cliffs         =         2             max(1, floor(d bandArea / (pi (cliffFootprint^2 + holeFootprint^2))))
  ramps                  =         4             holes + cliffs
  relaxMaxIterations     =       121 sweep pairs gridAxis
  slopePenalty           =    1.7321             1 / tan(maxSlope)
  downhillFactor         =      0.25             d / g
  mesh: 40 rings x 264 segments = 21384 triangles (20856 floor + 528 skirt), 11089 vertices
  --- over 100 seeds ---
  height spread (m)                  min     3.849  max    10.849  mean     6.857  median     6.654
  height stdev (m)                   min     0.488  max     1.322  mean     0.824  median     0.800
  normalised p80-p20 (all)           min     0.051  max     0.151  mean     0.098  median     0.097
  normalised p80-p20 (unflagged)     min     0.050  max     0.150  mean     0.095  median     0.093
  base p80-p20 after remap           min     0.200  max     0.200  mean     0.200  median     0.200
  base p80-p20 before remap          min     0.191  max     0.470  mean     0.332  median     0.338
  max unflagged slope (tan)          min     0.577  max     0.577  mean     0.577  median     0.577
  mean unflagged slope (tan)         min     0.076  max     0.129  mean     0.098  median     0.097
  p80 unflagged slope (tan)          min     0.118  max     0.239  mean     0.165  median     0.165
  slope residual (m, <=0 ok)         min    -0.000  max    -0.000  mean    -0.000  median    -0.000
  max flagged slope (tan)            min     3.599  max     7.606  mean     4.657  median     4.367
  relax pass 1 sweep pairs           min     2.000  max     2.000  mean     2.000  median     2.000
  relax pass 2 sweep pairs           min     1.000  max     3.000  mean     1.700  median     2.000
  nodes repaired pass 1 (%)          min     0.669  max    16.816  mean     6.025  median     5.396
  feature share drawn (top 20%)      min     0.793  max     0.803  mean     0.799  median     0.799
  feature share metres               min     0.730  max     0.868  mean     0.820  median     0.824
  feature share volume               min     0.923  max     0.999  mean     0.992  median     0.996
  fight-zone stdev (m)               min     0.009  max     0.067  mean     0.035  median     0.037
  ring-band stdev (m)                min     0.123  max     0.452  mean     0.255  median     0.243
  outside stdev (m)                  min     0.573  max     1.610  mean     0.991  median     0.970
  generation time (ms)               min     14.72  max     16.70  mean     15.68  median     15.70
  walk mask build (ms)               min      2.35  max      4.30  mean      2.62  median      2.58
  walkable nodes in ring (%)         min    76.860  max    85.976  mean    81.746  median    81.997
  A* expanded nodes                  min     1.000  max  2455.000  mean   226.220  median   172.000
  A* + string pull time (ms)         min      0.00  max      1.80  mean      0.37  median      0.31
  path vertices after pulling        min     1.000  max    11.000  mean     3.119  median     3.000
  grid nodes before pulling          min     1.000  max    74.000  mean    34.616  median    35.000
  pulled / grid length               min     0.920  max     1.000  mean     0.952  median     0.950
  relaxation converged (both passes): 100/100
  holes placed 200/200, cliffs placed 200/200
  A* queries with a path: 997/1000 (the rest: endpoints in different walkable components)
```

## 6. Not done / not verified / risks

- **Not integrated, not seen in a browser.** Engine/ArenaPhysics untouched (shared files). No visual check of the
  mesh, colours or AI walking; only the pure + THREE-geometry tests and the report.
- **Most deliberate features fall outside the 12 m ring.** Measured over 100 seeds: 24 of 2,330 cliff nodes and
  151 of 812 hole nodes lie inside the ring (`ringNorm < 1`); the rest are in the outside band. The engine's outside
  ground is a flat plane and TerrainMesh draws only the ring floor + skirt, so those features exist in the field
  (minimap, A*) but are not drawn or physical outside. Options: (a) add an outside annulus mesh
  (≈ segments × 2 × ceil(margin / cell) triangles, ~1.2k for 12 m) and pass `outsideFollowsTerrain: true`; or
  (b) narrow the placement band to the ring (`outerBand` in `stampDeliberate`) — but a 1.75 m hole and a 2.8 m-wide
  cliff profile hardly fit beside a 2.7 m fight zone in a 6 m ring. Larger arenas (40 m) place them in the ring.
- **Mesh vs field near features.** The radial mesh spreads a one-cell cliff jump over one triangle (~74° slope, not
  vertical); `|mesh − bilinear field|` reaches ~0.5 m right at faces. Physics uses the mesh (`floorHeightAt`),
  A*/minimap use the grid. Vertical faces would need extra vertices along flagged edges.
- **Final height band is narrower than the target.** The 0.2 target governs the base noise (measured 0.200 every
  seed); the finished field reads p80 − p20 ≈ 0.09–0.10 because the fight zone is held to one step and the
  1.75 m holes/cliffs stretch min/max. Reported in stats, not forced.
- **Gentle features are tiny.** Holding 80/20 under a cap needs a 256× amplitude range (solved), so the gentlest
  Pareto features are ~1/256 of the local relief (millimetres in the fight zone). By design of the law, not a bug.
- **Props dominate pathing in small rings.** In the 12 m arena the walkable share of the ring is 17–70 % (mean 49 %),
  mostly from prop circles inflated by agent radius + half a cell diagonal; terrain blocks ~4 %.
- **Placement can fail**: holes were placed in 89/100 seeds at 12 m (200/200 at 40 m); counts are reported in
  `stats.deliberate.placed` vs `requested`.
- **Costs** (measured, M1, single runs): `deriveTerrainRules` 1.1 ms (6 m) / 10.6 ms (20 m) — the Pareto solvers
  scan alpha; call once per arena. `generateHeightfield` 1.5 ms mean (37²) / 15.7 ms (121²).
  `buildRingSurface` 0.34 ms / 1.86 ms. Walk mask 0.19 / 2.6 ms. A* + string pulling ≤ 1.8 ms worst case.
  `findPath()` rebuilds the walk mask every call — the engine should hold a `GridPathFinder` (as in 4b).
- A* ignores moving bodies (the other fighter) and breached walls; obstacles are static circles.
- `TerrainRules` default `stepHeight` 0.35 m and `maxSlopeDeg` 30° are my choices (documented in
  `TERRAIN_BASE_SPECS`); Lane C's foot IK should read the same values.
