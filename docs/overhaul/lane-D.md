# Lane D — Trails & FX (R05) handoff

Request: "add effects like trails when they're charging, from the beginning area until it's at
the target, and apply that to all the code". Delivered as a pooled effect system where every
skill gets an effect: the skill's KIND picks the recipe, and the skill's own parameters
(lunge speed, damage, knockback, armour, timing) set how big, long and bright each layer is.

## Files (all new, lane-owned)

| File | Role | THREE? |
|------|------|--------|
| `src/graphics/fx/TrailBuffer.ts` | Ring buffer of ribbon samples → strip vertices, alpha fade, spawn-distance rule, Catmull-Rom subdivision | no (pure) |
| `src/graphics/fx/FxRecipes.ts` | kind → recipe, roster-normalised intensities, body landmarks, blade span, palettes, `envelope`, `easeOutCubic` | no (pure) |
| `src/graphics/fx/FxShaders.ts` | GLSL + two-layer material factory (normal outer + additive core, shared uniforms) | yes |
| `src/graphics/fx/Trail.ts` | `RibbonTrail`: in-place BufferGeometry, two meshes, culling sphere | yes |
| `src/graphics/fx/WeaponTrail.ts` | `BladeSampler` (weapon node → world base/tip) + `WeaponTrail` (swing detection, skill arming) | yes |
| `src/graphics/fx/Decals.ts` | `RingDecal` (impact/arrival/brace ring), `ShieldArc` (defense shimmer) | yes |
| `src/graphics/fx/ChargeFx.ts` | Dash: floor telegraph (fills over the wind-up), body trail, 3-5 ghosts, speed lines, arrival ring | yes |
| `src/graphics/fx/FxDirector.ts` | The one engine-facing object: per-fighter pool, recipes, per-frame update, cost | yes |
| `tests/fx_trailbuffer_test.ts` | 7 tests (pure buffer) | |
| `tests/fx_trail_test.ts` | 4 tests (RibbonTrail/WeaponTrail/ChargeFx/decals, headless three) | |
| `tests/fx_director_test.ts` | 7 tests (recipes, intensities, director over all 24 skills, cost budget) | |

No shared file was edited.

## Recipes (FxRecipes.FX_RECIPES)

| Kind | Recipe | Layers |
|------|--------|--------|
| dash | charge | telegraph, bodyTrail, afterimages, speedLines, weaponTrail, impactRing (on arrival) |
| power | strike | weaponTrail, impactRing (hit frame, under the defender) |
| defense | ward | shieldArc, impactRing (bracing pulse at the caster's feet) |

Basic attacks need no call: the weapon trail emits whenever the blade tip exceeds `SWING_SPEED`
(4 m/s, with 50 % hysteresis), lifetime `BASIC_SWING_LIFETIME` 0.18 s.

Derivations (all in `fxIntensity`, documented per field): `travelTime = arrivalFraction(anim) *
duration` (read off `lungeAt`, 98 % of travel); `windUp = strikeTime = hitAt * duration` (the
telegraph reaches the landing point on the hit frame); `trailLifetime = max(travelTime,
strikeTime) * (1 + lerp(0.5, 1, glowN))` (so the whole start→target ribbon is still visible at
arrival); `ghostCount = round(lerp(3, 5, speedN))`; `speedLineCount = round(lerp(4, 10,
speedN))`; widths in shoulder breadths (0.259 H); ring radius per kind from knockbackN / damageN /
armourN; `brightness = lerp(0.55, 1, max(glowN, damageN))` (≤ 1: hue stays dominant). `xN` =
min-max normalisation over the whole roster (`ROSTER_RANGES`, computed once at module load).

## Exports (exact signatures)

### TrailBuffer.ts (pure)
```ts
export interface Vec3Like { x: number; y: number; z: number }
export interface TrailBufferOptions { capacity: number; lifetime: number; minSpawnDistance?: number;
  radiansPerSubdivision?: number; maxSubdivisions?: number; maxRows?: number; taper?: number;
  taperPivot?: number; widthScale?: number }
export const DEFAULT_MIN_SPAWN_DISTANCE = 0.02;            // m
export const DEFAULT_RADIANS_PER_SUBDIVISION = Math.PI / 24; // 7.5°
export const DEFAULT_MAX_SUBDIVISIONS = 6;
export function fadeAlpha(age: number, lifetime: number): number            // 1 - smoothstep(0, lifetime, age)
export function subdivisionCount(turn: number, radiansPerSubdivision: number, maxSubdivisions: number): number
export function angleBetween(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number
export function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number
export function stripIndices(maxRows: number): Uint16Array | Uint32Array
export class TrailBuffer {
  constructor(options: TrailBufferOptions)
  readonly capacity: number; readonly maxRows: number; lifetime: number; minSpawnDistance: number;
  radiansPerSubdivision: number; maxSubdivisions: number; taper: number; taperPivot: number; widthScale: number;
  readonly positions: Float32Array; readonly alphas: Float32Array; readonly along: Float32Array;
  readonly bounds: Float32Array; rows: number;
  get count(): number; get vertexCount(): number; get pointCount(): number
  clear(): void
  push(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, time: number): boolean
  pushEdges(edge0: Vec3Like, edge1: Vec3Like, time: number): boolean
  sampleAt(i: number, out: Float32Array | Float64Array | number[]): number
  expire(now: number): void
  build(now: number): number   // returns vertex count (2 per row)
}
```

### FxRecipes.ts (pure)
```ts
export type FxLayer = "telegraph" | "bodyTrail" | "afterimages" | "speedLines" | "weaponTrail" | "impactRing" | "shieldArc";
export interface FxRecipe { name: "charge" | "strike" | "ward"; layers: readonly FxLayer[] }
export const FX_RECIPES: Readonly<Record<SkillKind, FxRecipe>>;
export function recipeForKind(kind: SkillKind): FxRecipe          // throws for an unknown kind
export function hasLayer(recipe: FxRecipe, layer: FxLayer): boolean
export const ARRIVAL_SHARE, GHOST_COUNT_MIN, GHOST_COUNT_MAX, SPEED_LINES_MIN, SPEED_LINES_MAX,
  AFTERGLOW_MIN, AFTERGLOW_MAX, GHOST_LIFETIME_SHARE, WEAPON_TRAIL_SHARE_MIN, WEAPON_TRAIL_SHARE_MAX,
  BRIGHTNESS_MIN, BRIGHTNESS_MAX, MIN_TRAIL_BASE_SHARE, HIP_HEIGHT_SHARE, SHOULDER_HEIGHT_SHARE,
  SHOULDER_BREADTH_SHARE: number;
export interface BodyLandmarks { hip: number; shoulder: number; shoulderBreadth: number }
export function bodyLandmarks(height: number): BodyLandmarks
export function arrivalFraction(anim: SkillAnimation): number
export interface SkillMetrics { speed: number; damage: number; knockback: number; armour: number; glow: number; duration: number }
export function skillMetrics(skill: Skill): SkillMetrics
export interface MetricRange { min: number; max: number }
export type RosterRanges = Record<keyof SkillMetrics, MetricRange>;
export function rosterRanges(skills?: readonly Skill[]): RosterRanges
export const ROSTER_RANGES: RosterRanges;
export function normalised(v: number, range: MetricRange): number
export interface FxIntensity { recipe; element; speedN; damageN; knockbackN; armourN; glowN; brightness;
  travel; travelTime; strikeTime; windUp; trailLifetime; weaponTrailLifetime; ghostCount; ghostLifetime;
  speedLineCount; telegraphWidth; ringRadius; ringDuration; shieldOpacity; shieldRadius }
export function fxIntensity(skill: Skill, height?: number, ranges?: RosterRanges): FxIntensity
export function easeOutCubic(t: number): number
export function envelope(now: number, start: number, rise: number, stop: number, fall: number): number
export interface TrailPalette { edge: string; body: string; core: string }
export function trailPalette(element: Element): TrailPalette      // ELEMENTS edge / trail / core
export interface BladeSpan { base: number; tip: number }
export function bladeSpan(parts: readonly WeaponPart[]): BladeSpan
```
New shared-math candidates for MathCore (parent decides): `easeOutCubic`, `envelope`, `catmullRom`, `angleBetween`.

### FxShaders.ts
```ts
export interface FxUniforms { uEdge; uBody; uCore; uBrightness; uOpacity; uTime; [name: string]: THREE.IUniform }
export function createFxUniforms(palette: TrailPalette, extra?: Record<string, THREE.IUniform>): FxUniforms
export function applyPalette(u: FxUniforms, palette: TrailPalette): void
export interface LayerPair { outer: THREE.ShaderMaterial; core: THREE.ShaderMaterial }
export function createLayerPair(vertexShader: string, outerFragment: string, coreFragment: string, uniforms: FxUniforms, side?: THREE.Side): LayerPair
export function createLayerMeshes(geometry: THREE.BufferGeometry, pair: LayerPair): [THREE.Mesh, THREE.Mesh]
export const RIBBON_VERTEX, RIBBON_OUTER_FRAGMENT, RIBBON_CORE_FRAGMENT, DECAL_VERTEX,
  TELEGRAPH_OUTER_FRAGMENT, TELEGRAPH_CORE_FRAGMENT, RING_OUTER_FRAGMENT, RING_CORE_FRAGMENT,
  SHIELD_VERTEX, SHIELD_OUTER_FRAGMENT, SHIELD_CORE_FRAGMENT, GHOST_VERTEX, GHOST_FRAGMENT,
  SPEEDLINE_VERTEX, SPEEDLINE_FRAGMENT: string;
```

### Trail.ts
```ts
export interface RibbonTrailOptions extends Omit<TrailBufferOptions, "widthScale"> { width?: number; colours: TrailPalette; profile?: number }
export class RibbonTrail {
  constructor(options: RibbonTrailOptions)
  readonly object: THREE.Group; readonly buffer: TrailBuffer; readonly geometry: THREE.BufferGeometry;
  readonly uniforms: FxUniforms; readonly materials: LayerPair;
  get lifetime(): number; set lifetime(seconds: number)
  get triangleCount(): number; get drawCalls(): number
  push(a: Vec3Like, b: Vec3Like, now: number): boolean
  update(now: number): number
  setColours(colours: TrailPalette): void
  setIntensity(brightness: number, opacity?: number): void
  clear(): void; dispose(): void
}
```

### WeaponTrail.ts
```ts
export const SWING_SPEED = 4, SWING_RELEASE_SHARE = 0.5, BASIC_SWING_LIFETIME = 0.18,
  WEAPON_TRAIL_CAPACITY = 24, WEAPON_TRAIL_SPAWN = 0.015;
export class BladeSampler { constructor(node: THREE.Object3D | null, span: BladeSpan); node; span;
  sample(base: THREE.Vector3, tip: THREE.Vector3): boolean }
export class WeaponTrail { constructor(palette: TrailPalette); readonly trail: RibbonTrail; swingSpeed; basicLifetime; tipSpeed;
  get object(): THREE.Object3D
  arm(until: number, lifetime: number, brightness: number): void; disarm(): void; armed(now: number): boolean
  feed(base: Vec3Like, tip: Vec3Like, now: number): void; update(now: number): void
  setColours(palette: TrailPalette): void; clear(): void; dispose(): void }
```

### Decals.ts
```ts
export const DECAL_LIFT = 0.015; export const SHIELD_SEGMENTS = 18; export const SHIELD_ARC: number; // 140°
export function asDecal(pair: LayerPair): void
export class RingDecal { constructor(palette: TrailPalette); readonly object; readonly uniforms; readonly triangleCount = 2;
  get active(): boolean; get drawCalls(): number
  fire(at: Vec3Like, radius: number, duration: number, now: number, brightness?: number): void
  update(now: number): void; setColours(palette: TrailPalette): void; stop(): void; dispose(): void }
export class ShieldArc { constructor(palette: TrailPalette); readonly object; readonly uniforms; readonly triangleCount: number;
  get active(): boolean; get drawCalls(): number
  raise(radius: number, height: number, opacity: number, now: number, rise: number, brightness?: number): void
  lower(now: number, fall: number): void
  update(now: number, ground: Vec3Like, yaw: number): void
  setColours(palette: TrailPalette): void; stop(): void; dispose(): void }
```

### ChargeFx.ts
```ts
export { BladeSampler, WeaponTrail } from "./WeaponTrail.ts";
export const BODY_CENTRE_HEIGHT = 0.6, TELEGRAPH_SEGMENTS = 12, MAX_GHOSTS = 5, MAX_SPEED_LINES = 10;
export interface ChargeShape { intensity: FxIntensity; duration: number; bodyHeight: number; centreHeight: number }
export function defaultChargeShape(duration: number, bodyHeight?: number): ChargeShape
export class ChargeFx {
  constructor(palette: TrailPalette, shape?: ChargeShape)
  readonly object: THREE.Group; readonly bodyTrail: RibbonTrail; readonly ring: RingDecal;
  get active(): boolean; get telegraphFill(): number; get ghostsSpawned(): number; get palette(): TrailPalette
  setColours(palette: TrailPalette): void
  begin(origin: Vec3Like, target: Vec3Like, element: Element, duration: number, now?: number, shape?: ChargeShape): void
  update(now: number, currentPos: Vec3Like, hop?: number): void
  end(now?: number): void
  stop(): void
  cost(): { drawCalls: number; triangles: number }
  dispose(): void
}
```

### FxDirector.ts
```ts
export const FOLLOW_THROUGH_SHARE = 0.25, SHIELD_HEIGHT_SHARE = 1.05, DEFAULT_MAX_FIGHTERS = 2;
export interface FxFighterSetup { element: Element; height?: number; centreHeight?: number;
  weaponNode?: THREE.Object3D | null; weaponParts?: readonly WeaponPart[] }
export interface FxCost { drawCalls: number; triangles: number; activeFighters: number }
export class FxDirector<K extends object = object> {
  constructor(parent: THREE.Object3D | null, options?: { maxFighters?: number })
  readonly root: THREE.Group
  get capacity(): number; has(key: K): boolean
  chargeOf(key: K): ChargeFx | null; weaponTrailOf(key: K): WeaponTrail | null
  attach(key: K, setup: FxFighterSetup): void          // once per match; throws when the pool is full
  detach(key: K): void; clearAll(): void
  setWeapon(key: K, node: THREE.Object3D | null, parts: readonly WeaponPart[]): void
  beginSkill(key: K, skill: Skill, origin: Vec3Like, aim: Vec3Like, now: number, travelScale?: number): FxIntensity | null
  impact(key: K, now: number, at?: Vec3Like): void      // optional; auto-fires at strikeTime otherwise
  endSkill(key: K, now: number): void                    // idempotent, safe to call every idle frame
  feedBlade(key: K, base: Vec3Like, tip: Vec3Like, now: number): void   // only without weaponNode
  update(key: K, now: number, bodyCentre: Vec3Like, yaw: number, hop?: number): void
  cost(): FxCost                                         // debug/budget, allocates the result
  dispose(): void
}
```

## Integration patch (parent pastes; anchors are exact text, line numbers drift)

Clock: use the existing game clock `this.#skyTime` (advanced by `dt` only when not frozen) as `now`.

### 1. `src/graphics/Humanoid.ts` — expose the weapon node (needed for weapon trails)
In `export interface HumanoidRig {`, after `triangleCount: number;`:
```ts
  /** Root of the weapon mesh: local +y is the weapon axis, the grip sits at y = 0. */
  weaponNode: THREE.Object3D;
```
In the returned object, after `triangleCount: triCount,`:
```ts
    weaponNode: weaponMesh.group,
```
(Without this patch, pass `weaponNode: null` — skills still get telegraph / body trail / ghosts /
rings / shield, but no blade ribbons; or call `fx.feedBlade(f, base, tip, now)` yourself.)

### 2. `src/engine/Engine.ts`
Import (next to the other graphics imports):
```ts
import { FxDirector } from "../graphics/fx/FxDirector.ts";
```
Field (after `#rigs = new Map<Fighter, HumanoidRig>();`):
```ts
  /** Lane D: trails, telegraphs, ghosts, rings and shields for every skill (R05). */
  #fx = new FxDirector<Fighter>(null);
```
Constructor, after `this.#scene.add(this.#sky.mesh, this.#ambient, this.#moonLight);`:
```ts
    this.#scene.add(this.#fx.root); // root stays at the identity transform (world-space trails)
```
`#spawnMeshes()`, after `this.#rigs.clear();`:
```ts
    this.#fx.clearAll();
```
and replace `const rig = buildHumanoid(generateClassWeapon(f.className), app, element);` with:
```ts
      const weaponGen = generateClassWeapon(f.className);
      const rig = buildHumanoid(weaponGen, app, element);
```
then after `this.#rigs.set(f, rig);`:
```ts
      this.#fx.attach(f, { element, height: app.height, weaponNode: rig.weaponNode, weaponParts: weaponGen.parts });
```
`#useSkill`, after `this.#skillFired.set(f, false);` (the one inside #useSkill, before `this.#audio.playSkill`):
```ts
    // Lane D: telegraph from here to the landing point, trails, ghosts, rings or shield.
    {
      const other = f === this.#player ? this.#opponent : this.#player;
      this.#fx.beginSkill(f, skill, f.body, other.body, this.#skyTime, movementMul(rt));
    }
```
`#skillTick`, inside `if (!anim) {`, after `rig?.setEffect(0, this.#skyTime);`:
```ts
      this.#fx.endSkill(f, this.#skyTime);
```
`#skillTick`, after `this.#skillFired.set(f, true);`:
```ts
      this.#fx.impact(f, this.#skyTime, skill.kind === "power" ? other.body : undefined);
```
Rig loop (`for (const [f, rig] of this.#rigs)`), after `rig.group.rotation.z = balTilt * 0.6;`:
```ts
      // Lane D: sample the blade (weaponNode) and advance every effect for this fighter.
      this.#fx.update(f, this.#skyTime, f.body, rig.group.rotation.y, hop);
```
(`hop` is the const declared a few lines above: `const hop = anim ? hopAt(...) : 0;`. `f.body` is
the physics centre WITHOUT the hop — floor decals use it; trails/ghosts add `hop`.)

Optional budget readout: wherever `polygons:` is summed from the rigs, add `fx: this.#fx.cost()`.

World points needed: blade BASE and TIP in world space every frame. With the Humanoid patch the
director gets them itself: `weaponNode.updateWorldMatrix(true, false)` then
`(0, bladeSpan.base, 0)` and `(0, bladeSpan.tip, 0)` through `weaponNode.matrixWorld` (`rig.group`
scale included). `bladeSpan(weaponGen.parts)` = min/max of the blade/head parts along +y, base
pushed out to ≥ 35 % of the tip so the ribbon never sweeps the fist.

## Commands run (real output)

```
$ deno check src/graphics/fx/*.ts tests/fx_*_test.ts
Check src/graphics/fx/ChargeFx.ts … Check tests/fx_trailbuffer_test.ts   (11 files, no errors)

$ deno lint src/graphics/fx tests/fx_trailbuffer_test.ts tests/fx_director_test.ts tests/fx_trail_test.ts
Checked 11 files

$ deno test --allow-read tests/fx_trailbuffer_test.ts tests/fx_trail_test.ts tests/fx_director_test.ts
running 7 tests from ./tests/fx_trailbuffer_test.ts   (7 ok)
running 4 tests from ./tests/fx_trail_test.ts         (4 ok)
running 7 tests from ./tests/fx_director_test.ts      (7 ok)
dash     peak draw calls 10  peak triangles  224  (barbarian-charge)
power    peak draw calls  4  peak triangles  172  (assassin-execution)
defense  peak draw calls  6  peak triangles  156  (barbarian-ironhide)
ok | 18 passed | 0 failed (179ms)
```
Test coverage of the brief: ring wraps in order; alpha 1 at the newest sample, 0 at lifetime;
no spawn below the distance threshold (live head still drawn); subdivision count grows with
curvature (5°/20°/45° per sample); vertex count never exceeds capacity (clip + 2000-step fuzz,
bounds contain every vertex); Catmull-Rom tip stays within 1 cm of a 40°/sample arc; every skill
kind (and all 24 skills) maps to a recipe and draws, then fades to 0 draw calls; the pool never
grows over 24 skill uses; telegraph is ≥ 97 % full at the hit frame; ghosts = derived count;
RibbonTrail/ChargeFx/decals build headless.

## Cost per active effect (per fighter)

| Layer | Draw calls | Triangles (per layer × layers) |
|-------|-----------|--------------------------------|
| Weapon trail | 2 | 2·(rows−1) × 2; rows ≤ 175 by construction |
| Body trail | 2 | 2·(rows−1) × 2; rows ≤ 231 by construction |
| Telegraph | 2 | 28 × 2 |
| Ghosts (instanced) | 1 | 2 per ghost (≤ 10) |
| Speed lines | 1 | 2 per line (≤ 20) |
| Impact ring | 2 | 2 × 2 |
| Shield arc | 2 | 36 × 2 |

Measured peaks above (one fighter, all its layers): dash 10 calls / 224 tris, power 4 / 172,
defense 6 / 156. Idle effects are `visible = false` (0 calls). Fragment cost: everything is
small transparent geometry except the telegraph and ring decals (screen area of a few m² of
floor) — overdraw is the real GPU cost, not triangles.

## NOT done / not verified

- **GLSL not compiled in a browser.** `deno check` cannot see GLSL and I stayed inside the
  allowed commands (no bundle, no browser). Recipe for the parent: bundle a scratch harness that
  constructs `FxDirector`, runs one dash + power + defense, renders once with a WebGLRenderer,
  then read `renderer.info.programs[i].diagnostics` (`runnable === false` = error).
- **Not seen on screen.** Daylight visibility, hue dominance (no white wash) and ghost silhouette
  readability are designed per the project pitfalls (normal outer + additive core, core mix
  `pow(heat, 2.2) * 0.55`, gains ≤ 1) but not captured. Check by eye naming the expected colour.
- **Zero-allocation per frame is by construction, not measured.** Remaining allocations:
  first use of each skill per match (FxIntensity cache), element changes (palette object),
  `cost()` (debug only).
- First-person / axis views: effects stay visible when the engine hides a rig; hide
  `fx.root` or skip `update` for that fighter if they obstruct the camera.
- Ghosts are camera-facing (world-up) SDF billboards of a generic standing humanoid, not posed
  clones; from a top-down camera they read thin.
- The telegraph is a straight-line prediction (origin → origin + unit(aim) · lunge ·
  movementMul); the engine re-aims at the moving opponent each frame, so a strafing target makes
  the body curve off the arrow.

## Risks

- `#skyTime` must stay monotonic; if a QA hook ever rewinds it, trails will expire instantly
  (ages become negative → alpha 1, then everything drops when time catches up). Harmless.
- Pool size 2 (`DEFAULT_MAX_FIGHTERS`); if the arena ever spawns more fighters, pass
  `new FxDirector(null, { maxFighters: n })` — `attach` throws loudly rather than drawing nothing.
- Humanoid patch touches the shared rig interface; lane A's body rework must keep `weaponNode`.
