# Lane F — Minimap (R06) handoff

The user's ask: *"the minimap is not good enough and needs to improve drastically to show better."*
Lane F replaces `Engine.#drawMinimap` (132 px canvas: fog cells sampled every 4 px, the outline, two
dots) with a self-contained renderer: hillshaded + hypsometric-tinted terrain with derived contours,
walls, one silhouette per prop kind, soft fog, coloured pickups/items, oriented fighter arrows, a
vision cone, a fading "last seen" rival ghost, hit pings, an optional A* path, north marker, scale bar,
explored %, rival distance, three view modes (click to cycle), HiDPI.

No shared file was edited. The Engine patch and the CSS are below for the parent / lane G.

## Files created

| File | Role | Chars |
|---|---|---|
| `src/ui/Minimap.ts` | `Minimap` class: `setWorld` (bake once), `draw` (per tick), `ping`, modes, HiDPI, click | 31 946 |
| `src/ui/minimap/MapMath.ts` | Pure maths: projection, orientation, edge clamp, zoom, nice numbers, contours, hillshade, tint, fades | 17 067 |
| `src/ui/minimap/Relief.ts` | Pure: `TerrainSampler` contract, `samplerFromGrid` (lane E adapter), `flatTerrain`, `bakeRelief` | 12 250 |
| `src/ui/minimap/Glyphs.ts` | Prop silhouettes, pickup/item markers, arrows, palette | 9 684 |
| `src/ui/minimap/Overlays.ts` | North marker, scale bar, corner text (cached strings) | 5 306 |
| `src/ui/minimap/Canvas.ts` | Minimal canvas contract (`MapContext2D`, `MapCanvas`), default OffscreenCanvas factory | 2 753 |
| `tests/minimap_math_test.ts` | 15 tests (incl. a lane E contract test on a real generated heightfield) | 14 766 |
| `tests/minimap_render_test.ts` | 8 tests against a recording fake 2-D context | 13 349 |

Imports used: `src/core/MathCore.ts` (`clamp, clamp01, lerp, damp, lambdaFromHalfLife, lerpAngle`),
`src/game/ArenaConfig.ts` (`objectSize`, type `ArenaObject`), `src/game/FogOfWar.ts`
(`exploredFraction`, type `FogGrid`). No THREE, no network, no inline styles.

## Conventions (R10)

- **world**: x = east, z = south, metres; **north = −z** (same as `Senses.bearing`).
- **map**: backing-store pixels (CSS px × devicePixelRatio), x right, y down.
- **bearing**: radians clockwise from north. A bearing b points along world (sin b, −cos b).
- **canvas angle**: radians from +x toward +y (what `ctx.rotate`/`arc` use).
- Projection: `p = centre_px + ppm · R(θ) · (world − centre)`, R clockwise; player-up uses θ = −heading,
  so `canvasAngleOf(frame, heading) = heading + θ − π/2 = −π/2` (straight up). Tested.

## Exports (exact signatures)

### `src/ui/Minimap.ts`
```ts
export type MinimapMode = "overview" | "follow" | "heading";
export const MINIMAP_MODES: readonly MinimapMode[];            // click order
export interface GroundPoint { x: number; z: number }
export interface MinimapFighter { x: number; z: number; facingX: number; facingZ: number }
export interface MinimapPickupLike { x: number; z: number; def: { id: string; kind: string } }  // PowerUps.Pickup fits
export interface MinimapItemLike { x: number; z: number; kind: string }                          // Items.Item fits
export type MinimapProp = Pick<ArenaObject, "x" | "z" | "rotation" | "scale"> & { kind: string }; // ArenaObject fits
export interface MinimapWorld {
  terrain?: TerrainSampler | null; outline: readonly GroundPoint[]; walled: boolean;
  props: readonly MinimapProp[]; size: number;
}
export interface MinimapView {
  time: number; self: MinimapFighter; headingX: number; headingZ: number; sightRange: number;
  rival: MinimapFighter | null; rivalVisible: boolean; fog: FogGrid | null;
  pickups: readonly MinimapPickupLike[]; items: readonly MinimapItemLike[]; path: readonly GroundPoint[] | null;
}
export function createMinimapView(): MinimapView;               // allocate once, mutate per tick
export type PingKind = "taken" | "dealt";
export interface MinimapOptions {
  cssSizePx: number; devicePixelRatio: number; mode: MinimapMode; createCanvas: CanvasFactory;
  clickToCycle: boolean; bakeSupersample: number; minBakePx: number; maxBakePx: number; maxReliefPx: number;
  followViewFactor: number; focusHalfAngle: number; ghostLifeSeconds: number; ghostFloorAlpha: number;
  pingLifeSeconds: number; transitionHalfLife: number; relief: Partial<ReliefOptions>;
}
export const DEFAULT_MINIMAP_OPTIONS: Omit<MinimapOptions, "createCanvas" | "devicePixelRatio">;
  // cssSizePx 200, mode "overview", bakeSupersample 3, bake 256..1024 px, relief ≤ 512 px,
  // followViewFactor 1.6, focusHalfAngle 50°, ghost 12 s → α 0.2, ping 1.2 s, transition half-life 0.09 s
export interface MinimapDrawStats {
  draws: number; pickupsDrawn: number; itemsDrawn: number; selfDrawn: boolean;
  rival: "visible" | "ghost" | "none"; rivalOffMap: boolean; pingsDrawn: number; pathPoints: number; scaleBarMetres: number;
}
export class Minimap {
  constructor(canvas: MinimapHostCanvas, opts?: Partial<MinimapOptions>);
  get mode(): MinimapMode; get bakeCount(): number; get relief(): ReliefSummary | null;
  get stats(): Readonly<MinimapDrawStats>; get frame(): Readonly<MapFrame>;
  setMode(mode: MinimapMode): void;
  cycleMode(): MinimapMode;
  resize(cssPx?: number, dpr?: number): void;   // no args: re-read clientWidth (fallback cssSizePx)
  dispose(): void;
  ping(x: number, z: number, kind: PingKind, time: number): void;
  setWorld(world: MinimapWorld): void;           // ONCE per match
  draw(view: MinimapView): void;                 // per tick
}
```

### `src/ui/minimap/MapMath.ts` (pure)
```ts
export interface MapPoint { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }
export interface RGB { r: number; g: number; b: number }
export type MapOrientation = "north-up" | "player-up";
export interface MapFrame { widthPx; heightPx; centreX; centreZ; pixelsPerMetre; rotation; cos; sin: number }
export function createFrame(): MapFrame;
export function setFrame(frame: MapFrame, widthPx: number, heightPx: number, centreX: number, centreZ: number, pixelsPerMetre: number, rotation: number): MapFrame;
export function headingOf(dirX: number, dirZ: number): number;                       // bearing in [0, 2π); 0 for (0,0)
export function rotationFor(orientation: MapOrientation, heading: number): number;    // north-up 0, player-up −heading
export function worldToMap(frame: MapFrame, x: number, z: number, out: MapPoint): MapPoint;
export function mapToWorld(frame: MapFrame, px: number, py: number, out: MapPoint): MapPoint; // out.y = world z
export function canvasAngleOf(frame: MapFrame, bearing: number): number;
export interface EdgeMarker { x: number; y: number; offMap: boolean; angle: number }
export function createEdgeMarker(): EdgeMarker;
export function clampToEdge(frame: MapFrame, px: number, py: number, insetPx: number, out: EdgeMarker): EdgeMarker;
export function fitPixelsPerMetre(mapPx: number, worldRadius: number, paddingFraction: number): number;
export function followPixelsPerMetre(mapPx: number, sightRange: number, viewFactor: number, minPixelsPerMetre: number): number;
export const NICE_MANTISSAS: readonly number[];                                       // [1, 2, 5]
export function niceFloor(x: number): number;
export function isNiceNumber(x: number): boolean;
export function scaleBarMetres(pixelsPerMetre: number, maxBarPx: number): number;
export const CONTOUR_TARGET_MIN = 6; export const CONTOUR_TARGET_MAX = 10;
export function contourLevelCount(minH: number, maxH: number, interval: number): number;
export function contourInterval(minH: number, maxH: number, targetMin?: number, targetMax?: number): number;
export const DEFAULT_LIGHT_AZIMUTH: number;  // 315° (NW)
export const DEFAULT_LIGHT_ALTITUDE: number; // 45°
export const DEFAULT_AMBIENT = 0.35;
export function lightDirection(azimuth: number, altitude: number, out?: Vec3): Vec3;
export function hillshade(nx: number, ny: number, nz: number, light: Vec3, ambient?: number): number;
export function normalFromHeights(hWest: number, hEast: number, hNorth: number, hSouth: number, spacing: number, verticalExaggeration: number, out: Vec3): Vec3;
export interface TintStop { at: number; r: number; g: number; b: number }
export const HYPSOMETRIC_RAMP: readonly TintStop[];
export function hypsometricTint(t: number, out: RGB, ramp?: readonly TintStop[]): RGB;
export function ghostAlpha(ageSeconds: number, lifeSeconds: number, floor: number): number;
export function pingProgress(ageSeconds: number, lifeSeconds: number): number;
export function easeOutQuad(t: number): number;
```

### `src/ui/minimap/Relief.ts` (pure)
```ts
export interface TerrainBounds { minX: number; minZ: number; maxX: number; maxZ: number }
export const FEATURE_NONE = 0; export const FEATURE_HOLE = 1; export const FEATURE_CLIFF = 2;   // = lane E's TerrainFeatures values
export interface TerrainSampler {
  heightAt(x: number, z: number): number;
  normalAt?(x: number, z: number, out: Vec3): Vec3;
  featureAt?(x: number, z: number): number;          // FEATURE_CLIFF | FEATURE_HOLE bitmask
  bounds: TerrainBounds;
}
export interface HeightGridLike { cols: number; rows: number; cell: number; originX: number; originZ: number; heights: Float32Array; featureMask?: Uint8Array }
export interface FeatureBits { cliff: number; hole: number }
export function samplerFromGrid(grid: HeightGridLike, bits?: FeatureBits): TerrainSampler;   // bilinear, edge-clamped; default bits = lane E's (hole 1, cliff 2)
export function flatTerrain(bounds: TerrainBounds, height?: number): TerrainSampler;
export interface ReliefOptions { lightAzimuth; lightAltitude; ambient; verticalExaggeration; reliefContrast; contourInterval; indexContourEvery; contourDarken; indexContourDarken; flatTint: number }
export const DEFAULT_RELIEF: ReliefOptions;   // z-factor 3, contrast gain 1.8, contours 30 % / index 50 % darker
export interface ReliefSummary { minHeight: number; maxHeight: number; contourInterval: number; contourLines: number; featurePixels: number }
export function bakeRelief(terrain: TerrainSampler, originX: number, originZ: number, metresPerPixel: number, widthPx: number, heightPx: number, rgba: Uint8ClampedArray, heights: Float32Array, options?: Partial<ReliefOptions>): ReliefSummary;
```

### `src/ui/minimap/Canvas.ts`, `Glyphs.ts`, `Overlays.ts`
```ts
export type MapContext2D = Pick<CanvasRenderingContext2D, /* the 32 members the minimap uses */>;
export interface MapCanvas { width: number; height: number; getContext(contextId: "2d"): MapContext2D | null }
export interface MinimapHostCanvas extends MapCanvas { clientWidth?; addEventListener?; removeEventListener?; setAttribute? }
export type CanvasFactory = (width: number, height: number) => MapCanvas;
export const defaultCanvasFactory: CanvasFactory;            // OffscreenCanvas, else detached <canvas>
export function asImageSource(layer: MapCanvas): CanvasImageSource;

export const MAP_COLOURS: { background; ink; outline; wall; wallShadow; edgeUnwalled; outsideDim; self; rival; path; text; textDim; rivalText; north; pingTaken; pingDealt: string };
export type MarkerShape = "circle" | "diamond" | "coin" | "square" | "flag";
export interface MarkerStyle { shape: MarkerShape; fill: string }
export const PICKUP_STYLES, ITEM_STYLES, KIND_STYLES: Readonly<Record<string, MarkerStyle>>; export const UNKNOWN_STYLE: MarkerStyle;
export const PROP_COLOURS: Readonly<Record<string, { fill: string; stroke: string }>>;
export function hash01(x: number, z: number, i: number): number;
export function drawPropGlyph(ctx: MapContext2D, kind: string, r: number, lineWidth: number, seedX: number, seedZ: number): void;
export function drawMarker(ctx: MapContext2D, style: MarkerStyle, x: number, y: number, r: number, lineWidth: number): void;
export function drawArrow(ctx: MapContext2D, x: number, y: number, angle: number, size: number, fill: string, lineWidth: number): void;
export function drawEdgeArrow(ctx: MapContext2D, x: number, y: number, angle: number, size: number, fill: string, lineWidth: number): void;

export const OVERLAY_LAYOUT: { padding: 6; northInset: 13; northDisc: 7.5; scaleBarMaxFraction: 0.3; scaleTick: 3 };
export interface OverlayInput { fog: FogGrid | null; modeLabel: string; selfX: number; selfZ: number; rivalX: number; rivalZ: number }
export class MapOverlays { scaleBarMetres: number; draw(ctx: MapContext2D, f: MapFrame, input: OverlayInput, font: string, boldFont: string, u: number): void }
export function shadowText(ctx: MapContext2D, s: string, x: number, y: number, colour: string, u: number): void;
```

Shared-maths candidates for the parent (MathCore?): `niceFloor`/`isNiceNumber` (1-2-5 nice numbers) and
`hillshade`/`lightDirection` are generic; they live in MapMath for now.

## What it draws (layer order, per `draw`)

1. Background, then the **static layer** (one `drawImage` under the frame transform). Baked once by
   `setWorld`: relief (hillshade × hypsometric tint, NW sun 45°, z-factor 3; contours at a derived
   1/2/5×10ⁿ interval, every 5th an index contour 2 px wide; cliffs dark rust, holes near-black blue),
   outside-the-ring dimmed, the wall (stone line; dashed coral when unwalled), props: pillar = disc with
   cap highlight, rock = irregular 7-gon (stable per position), tree = 6-lobe crown + trunk, crate =
   square with cross brace, ramp = triangle pointing local +x, platform = rectangle with inset rim,
   arch = two posts + semicircle span, gliderPad = ring + chevron. Props are never smaller than 2.4 CSS px.
2. **Fog**: one pixel per fog cell (alpha only, rgb fixed), upscaled bilinearly → soft edges.
   Unseen α 205/255, remembered α 95/255, visible clear; beyond the grid = unseen.
3. **Ring edge redrawn above the fog** every tick (the arena's shape is always readable).
4. **Path** (dashed gold polyline from self through `view.path`, destination dot).
5. **Pickups/items**: only where the fog cell is seen; remembered ones at 55 % opacity.
   Health pink, mana blue, stamina green (circles); rage/ward/swift/focus diamonds; coins gold discs;
   chest square, shrine diamond, banner flag.
6. **Hit pings**: expanding ring (ease-out), red = taken, gold = dealt, fade over 1.2 s; clamped to the rim when off-map.
7. **Rival**: red arrow along its facing when visible; else a dashed ghost circle at the last-seen
   point with an age label (`6s`), fading linearly to α 0.2 over 12 s. Off-map → red edge arrow.
8. **Self**: faint full sight circle + bright ±50° focus wedge (one unit-space gradient, reused) and a
   parchment arrow along its facing. Off-map (overview only) → edge arrow.
9. **Overlays**: N in a dark disc at the rim where bearing 0 meets it (orbits in heading-up), scale bar
   (largest nice length ≤ 30 % of the width, dark under-stroke), `NN% seen` (top-left), mode
   `MAP / FOLLOW / HEAD-UP` (top-right), `rival N m` (bottom-right).

**Modes** (click cycles; transitions are damped, half-life 0.09 s): `overview` = whole ring north-up;
`follow` = north-up centred on self, zoom derived from sight range (`ppm = (mapPx/2)/(1.6·sight)`,
never below the overview zoom); `heading` = follow + rotated so `headingX/Z` (the camera's ground
forward; falls back to facing) is up.

**Allocation**: `draw` allocates nothing in steady state (reused frame/point/edge/stats/overlay-input;
index loops; one gradient made in the constructor). Strings are rebuilt only when the integer shown
changes. The fog `ImageData` and layer are allocated once per grid size; the static/relief layers once per `setWorld`.

## Engine.ts integration patch (anchors are exact text in the current tree; line numbers drift)

**1. Imports.** Add next to the other `../ui/` imports:
```ts
import { createMinimapView, Minimap } from "../ui/Minimap.ts";
```
In the FogOfWar import, **remove `isSeen`** (its only use was the old `#drawMinimap`; `noUnusedLocals` would fail):
```ts
// before: import { clearVisible, createFog, exploredFraction, fogAscii, isSeen, isVisible, reveal, visibleFraction, type FogGrid } from "../game/FogOfWar.ts";
import { clearVisible, createFog, exploredFraction, fogAscii, isVisible, reveal, visibleFraction, type FogGrid } from "../game/FogOfWar.ts";
```

**2. Constant** (next to `const PICKUP_COUNT = 6;`):
```ts
/** Minimap redraw rate, Hz: smooth arrows and pings; a draw measured ≈ 0.1 ms median in Chrome (lane F). */
const MINIMAP_HZ = 20;
```

**3. Fields** (next to `#hudTimer = 0;`):
```ts
  /** The HUD minimap (lane F): static layer baked once per match, composited at MINIMAP_HZ. */
  #minimap: Minimap | null = null;
  readonly #minimapView = createMinimapView();
  readonly #minimapDir = new THREE.Vector3();
  #minimapTimer = 0;
```

**4. `#buildHUD`** — replace the canvas line
```html
      <canvas id="hud-minimap" width="132" height="132" aria-label="Minimap: your explored ground"></canvas>
```
with (the Minimap sizes the backing store itself):
```html
      <canvas id="hud-minimap" aria-label="Minimap"></canvas>
```
and directly after `document.body.appendChild(this.#hud);` add:
```ts
    this.#minimap = new Minimap(document.getElementById("hud-minimap") as HTMLCanvasElement);
```

**5. Window resize** — first line inside `globalThis.addEventListener("resize", () => {`:
```ts
      this.#minimap?.resize(); // CSS breakpoints change the map size; backing store = css × devicePixelRatio
```

**6. Bake once per match** — in the match-start method (the one that calls `this.#buildArena();`), after
```ts
    document.getElementById("hud-status")!.textContent = "Fight!";
    this.#hud.style.display = "block";
```
add (after `display = "block"` so `clientWidth` is the real CSS size):
```ts
    // Minimap: size from the visible layout, then bake the static layer ONCE for this arena.
    this.#minimap?.resize();
    this.#minimap?.setWorld({
      outline: outline(this.#arena, 128),
      walled: this.#arenaState.walled,
      props: this.#arenaState.props,
      size: this.#arena.size,
      // Lane E's Heightfield plugs in directly (its featureMask bits equal ours; tested):
      terrain: this.#terrainField ? samplerFromGrid(this.#terrainField) : null,
    });
    this.#minimapTimer = 0;
```
`#terrainField` is the field lane E's Engine patch introduces (lane-E.md). Add
`import { samplerFromGrid } from "../ui/minimap/Relief.ts";` when you apply it. Before lane E's patch
lands, pass `terrain: null` instead and you get the flat-floor fallback.

**7. Tick** — replace
```ts
    if (this.#hudTimer <= 0 && this.#phase === "fight") { this.#hudTimer = 0.25; this.#updateHUD(); this.#drawMinimap(); }
```
with
```ts
    if (this.#hudTimer <= 0 && this.#phase === "fight") { this.#hudTimer = 0.25; this.#updateHUD(); this.#updateCompass(); }
    this.#minimapTimer -= dt;
    if (this.#minimapTimer <= 0 && this.#phase === "fight") { this.#minimapTimer = 1 / MINIMAP_HZ; this.#drawMinimap(); }
```

**8. Replace the whole `#drawMinimap()` method** (doc comment included) with:
```ts
  /**
   * The personal minimap (lane F, src/ui/Minimap.ts). Fills the reused view from the
   * HUD fighter's state; the Minimap composites it over the static layer baked at
   * match start. Allocates nothing.
   *   self/rival facing — the rig yaw: rotation.y = atan2(dx, dz) ⇒ facing = (sin y, cos y)
   *   heading           — the active camera's ground forward ("up" in heading-up mode);
   *                       a top-down camera has none, so (0, 0) falls back to the facing
   *   sightRange        — adapted sight, clipped to the fog reveal's 60 m
   *   rivalVisible      — the rival's cell is visible in this fighter's fog
   */
  #drawMinimap() {
    const mm = this.#minimap;
    const self = this.#spectate ? this.#opponent : this.#player;
    const other = self === this.#player ? this.#opponent : this.#player;
    const fog = this.#fog.get(self);
    if (!mm || !fog) return;
    const v = this.#minimapView;
    v.time = performance.now() / 1000;
    const yawSelf = this.#rigs.get(self)?.group.rotation.y ?? 0;
    const yawOther = this.#rigs.get(other)?.group.rotation.y ?? 0;
    v.self.x = self.body.x;
    v.self.z = self.body.z;
    v.self.facingX = Math.sin(yawSelf);
    v.self.facingZ = Math.cos(yawSelf);
    const rival = v.rival!;
    rival.x = other.body.x;
    rival.z = other.body.z;
    rival.facingX = Math.sin(yawOther);
    rival.facingZ = Math.cos(yawOther);
    const dir = this.#cameras[this.#activeCamera].getWorldDirection(this.#minimapDir);
    const groundForward = Math.hypot(dir.x, dir.z) > 0.1;
    v.headingX = groundForward ? dir.x : 0;
    v.headingZ = groundForward ? dir.z : 0;
    v.sightRange = Math.min(this.#senseRanges.get(self)?.sight ?? SENSE_BASE.sight, 60);
    v.rivalVisible = isVisible(fog, other.body.x, other.body.z);
    v.fog = fog;
    v.pickups = this.#pickups;
    v.items = this.#items;
    v.path = null; // lane E: A* waypoints for `self` once pathfinding lands
    mm.draw(v);
  }

  /** Magnetism: the compass bearing to the other fighter (0° = north = −z), at the HUD rate. */
  #updateCompass() {
    const self = this.#spectate ? this.#opponent : this.#player;
    const other = self === this.#player ? this.#opponent : this.#player;
    const fog = this.#fog.get(self);
    const compass = document.getElementById("hud-compass");
    if (!compass || !fog) return;
    const deg = bearing(other.body.x - self.body.x, other.body.z - self.body.z);
    compass.textContent = `Rival ${compassPoint(deg)} · ${Math.round(Math.hypot(other.body.x - self.body.x, other.body.z - self.body.z))} m · explored ${Math.round(exploredFraction(fog) * 100)}%`;
  }
```

**9. Hit pings** — in `#resolveHit(attacker, defender, skill?)`, after
`this.#hits.set(attacker, (this.#hits.get(attacker) ?? 0) + 1);` add:
```ts
    // Minimap ping for the HUD fighter: red when it was hit, gold when it landed one.
    const hudFighter = this.#spectate ? this.#opponent : this.#player;
    if (defender === hudFighter || attacker === hudFighter) {
      this.#minimap?.ping(defender.body.x, defender.body.z, defender === hudFighter ? "taken" : "dealt", performance.now() / 1000);
    }
```

**10. (Optional) QA manifest** — next to the "World systems" block of the debug state:
```ts
      minimap: this.#minimap ? { ...this.#minimap.stats, mode: this.#minimap.mode, bakes: this.#minimap.bakeCount, relief: this.#minimap.relief } : null,
```

**11. (Optional, parent / R14) keyboard toggle.** While the pointer is locked the cursor cannot click
the map. A layout-aware letter would work: in the `keydown` handler, before `else this.#input.press(e.code);`:
```ts
      else if (e.key.toLowerCase() === "m" && !e.repeat) { e.preventDefault(); this.#minimap?.cycleMode(); }
```
(`e.key` is the typed letter, so it is "m" on QWERTY `KeyM` and on AZERTY `Semicolon`.) Not added by
lane F because the input layer is the parent's.

## CSS for lane G (`styles.css`)

Replace the current `#hud-minimap{…image-rendering:pixelated}` rule with the block below. The canvas
must accept clicks although `#hud` has `pointer-events:none`. Drop `image-rendering:pixelated`:
the backing store is now CSS size × devicePixelRatio, so no upscaling happens, and pixelated
sampling would only alias the soft fog and relief.

```css
/* Minimap (lane F). Backing store = CSS size × devicePixelRatio, set by Minimap.resize(). */
:root{--minimap-size:200px}
#hud-minimap{display:block;margin-top:6px;width:var(--minimap-size);height:var(--minimap-size);
  border:2px solid #b9c9c8;border-radius:8px;background:#0b1014;box-shadow:0 2px 10px rgba(0,0,0,.55);
  pointer-events:auto;cursor:pointer;touch-action:manipulation}
#hud-minimap:hover{border-color:#dfaa55}
#hud-minimap:focus-visible{outline:3px solid #ef7455;outline-offset:2px}
/* Phones (375 px class): the 132 px floor the HUD column had before. */
@media(max-width:767px){:root{--minimap-size:132px}}
/* Tablets / small laptops (768 px class). */
@media(min-width:768px) and (max-width:1439px){:root{--minimap-size:184px}}
/* Large desktops (1440 px class and up). */
@media(min-width:1440px){:root{--minimap-size:220px}}
/* Short landscape phones: keep the map from eating the vertical space. */
@media(max-height:480px){:root{--minimap-size:120px}}
```
Position: it stays in the `#hud` column, top-left, under `#hud-world`, with `#hud-compass` under it.
If lane G moves the HUD around (R09 moves the skills to the bottom), the minimap needs no change:
it reads its CSS size on `resize()`.

## Commands run (real output)

```
$ deno check src/ui/Minimap.ts src/ui/minimap/*.ts tests/minimap_math_test.ts tests/minimap_render_test.ts
check exit=0
$ deno lint src/ui/Minimap.ts src/ui/minimap/ tests/minimap_math_test.ts tests/minimap_render_test.ts
Checked 8 files
$ deno test --allow-read tests/minimap_math_test.ts tests/minimap_render_test.ts
running 14 tests from ./tests/minimap_math_test.ts
projection: world → map → world round-trips in both orientations ... ok (7ms)
projection: north-up puts north (−z) straight up and east to the right ... ok (73µs)
headingOf agrees with Senses.bearing and names the four cardinal points ... ok (242µs)
player-up: the player's facing points straight up for every heading ... ok (319µs)
edge clamp: on-map points pass through, off-map points sit on the inset rim along the same ray ... ok (609µs)
zoom: overview fits the ring; follow zoom derives from sight range and never zooms out past overview ... ok (73µs)
nice numbers: niceFloor returns 1/2/5×10^n ≤ x, and the next nice number is > x ... ok (616µs)
scale bar: a nice number of metres that fits the allowed width and is at least 40 % of it ... ok (182µs)
contours: interval is nice; ≥80 % of 5000 random ranges give 6-10 lines, none outside 4-11 ... ok (4ms)
hillshade: brightest when the surface faces the light, ambient when it faces away ... ok (634µs)
hypsometric tint: endpoints are the ramp's ends; input is clamped ... ok (82µs)
fading: ghost alpha holds at its floor; pings expire ... ok (40µs)
relief bake: a NW-facing slope is brighter than a SE-facing one; contours appear; flat has none ... ok (4ms)
samplerFromGrid: bilinear is exact on a plane, clamps outside, maps feature bits ... ok (363µs)
running 8 tests from ./tests/minimap_render_test.ts
HiDPI: backing store = css size × devicePixelRatio ... ok (25ms)
static layer is baked ONCE across 100 draw() calls ... ok (29ms)
a marker is drawn for each pickup, each item and both fighters ... ok (20ms)
player-up: the self arrow is drawn pointing straight up ... ok (23ms)
rival: a ghost that fades when unseen; an edge arrow when off-map ... ok (23ms)
hit pings expand and expire; path and scale bar are drawn ... ok (14ms)
a click cycles overview → follow → heading → overview and updates the accessible name ... ok (14ms)
steady state: every draw issues the same number of canvas calls (bounded work per tick) ... ok (16ms)

ok | 22 passed | 0 failed (222ms)
```

Run again after aligning with lane E (adds the 15th math test):
```
lane E contract: feature bits match, and a real generated heightfield adapts and bakes ...
lane E field 121x121 @0.5 m: 227 flagged nodes; relief -2.52..5.21 m, interval 1 m, 8 lines, 249 feature px
lane E contract: feature bits match, and a real generated heightfield adapts and bakes ... ok (67ms)
ok | 23 passed | 0 failed (288ms)
```

**The Engine patch was applied to a scratch copy and type-checked.** I copied `src/` and
`deno.json` to `~/.hermes/cache/scratch/engine_check/` and applied items 1–9 with a script
(`apply_engine_patch.py`, which requires each anchor to match exactly once). Every anchor matched the
current tree. Then:
```
$ deno check src/engine/Engine.ts        # patched scratch copy
Check src/engine/Engine.ts
patched-engine check exit=0
$ deno check src/engine/Engine.ts        # real project, unpatched baseline
Check src/engine/Engine.ts
baseline exit=0
```

**The tests can fail.** I checked that with temporary mutations, each reverted afterwards (`cmp` confirmed the files match their originals):
- Fog no longer hides unseen drops → `a marker is drawn for each pickup…` FAILED ("unseen drops are hidden").
- `canvasAngleOf` ignores the frame rotation → both player-up tests FAILED (2 failed / 20 passed).
- `setWorld` re-run inside `draw` → `static layer is baked ONCE…` FAILED ("bakeCount 101"), plus 2 others.

**Browser check.** I bundled a scratch harness (`deno bundle` into `~/.hermes/cache/scratch`; not the
project build, no server, port 8788 untouched) and opened it via `file://` in headless Chrome 145:
- Panels: overview + fog, follow + ghost, heading-up, flat hexagon, unwalled oval, 132 px phone. All
  backing stores came out at 2× (440/440/440/400/320/264).
- Timing at 220 CSS px and DPR 2, with hills and a live fog: `setWorld` bake **34.7 ms** (once per match).
  Over 300 `draw` calls: median **0.1 ms**, p95 **0.3 ms**, max **1.1 ms**. This is JS submit time only;
  `performance.now()` on `file://` has about 0.1 ms resolution.
  Relief of the harness hills: −1.46..4.09 m → interval 1 m, 6 contour lines.
- Pixel measurements on the fog panel: the wall line is bright (luminance 223) at every 15° step
  around the rim, except at the top where the N marker sits on it. The focus cone is visible: luminance
  183 ahead vs 105 to the side at half the sight radius. A vision-model read had said "the wall is
  hidden in fog" and "no cone". The measurements show both claims were wrong.
- A first render found a real bug, now fixed and covered by a test: an explicit
  `opts.devicePixelRatio` was overridden by the live `globalThis.devicePixelRatio` on the next
  `draw`, which halved the backing store.
- Changes made after looking at the renders: unseen fog α 235→205 and remembered α 125→95 (mean
  luminance of the fog panel 36→45); the ring edge is redrawn above the fog; relief contrast gain 1.8
  and z-factor 3; contours 30 %/50 % darker with 2 px index lines; cliff tint now differs from
  holes; health orbs are pink (they used to read as the rival's red); the cone is stronger; the N sits
  on a dark disc; the fighter arrows are 7.5 CSS px with a 1.7 px dark outline.
- **Lane E's real terrain.** I rendered `generateArenaTerrain(…)` through `samplerFromGrid` (no bit
  mapping) in overview, fog and heading-up modes. Measured from `mm.relief`: −1.71..3.01 m gives a
  0.5 m interval with 10 contour lines (circle ring), and −2.35..2.78 m gives 0.5 m with 10 lines
  (hexagon ring). Holes and cliffs cover 6739 and 5317 relief pixels. A vision read saw relief,
  contours, holes/cliffs, wall, props, pickups and both arrows in every panel. Its main remaining
  complaint was that the white self arrow and cone have low contrast on light-green ground; the
  arrow tweak above addresses part of that, and the result has not been re-inspected.

## Not done / not verified

- **Not integrated in the running game** (Engine.ts is the parent's). Nothing here has been seen
  inside the actual HUD, over the 3D scene, or at real 375/768/1440 viewports. The CSS is untested.
- **The 6–10 contour target is not guaranteed.** Consecutive 1/2/5 numbers are up to 2.5× apart, and
  a 6–10 window spans only 1.67×. Measured over 5000 random ranges (0.5 m–5 km): **84 % land in 6–10**
  and all land in 4–11. Ranges near 22–30×10ⁿ m get 4 or 12 lines. A strict guarantee would need the
  mantissa set {1, 2, 2.5, 5}, or a finer one.
- **Lane E coupling is confirmed against its code.** Node (i, j) sits at `originX + i·cell` (lane-E.md and
  `Heightfield.ts`). My feature bits now match lane E's values (hole 1, cliff 2; ramp 4 is ignored).
  `tests/minimap_math_test.ts` enforces this and adapts a real generated field node by node, so a
  change on either side breaks the test. Lane E's own handoff still says to pass the bits
  explicitly; that still works, and is no longer needed.
- **The path (R12) is not wired.** `view.path` accepts any `{x, z}[]`. Engine passes `null` until lane E's A* exists.
- **Ramp direction.** The glyph points along the prop's local +x after `rotate(−rotation)`. Nobody has
  checked whether +x is "up-slope" on the 3D ramp mesh.
- No keyboard toggle (see patch item 11). No wheel zoom.

## Risks / open issues

- **Fog grid smaller than the ring (existing Engine behaviour).** `createFog(min(60, #ringHalf()+2), …)`
  uses `#ringHalf()`, which is the **minimum** radius over 16 bearings. On triangle, oval or diamond
  rings the corners lie outside the fog grid, so they are never revealed. The minimap draws them as
  unseen; the old one did too. Fix in Engine: size the fog from the max outline radius.
- `getWorldDirection` on the birds-eye orthographic camera gives no ground forward. The patch guards
  this with `hypot > 0.1`, and heading-up then follows the facing.
- `MINIMAP_HZ = 20` is a choice, not a measurement of need. Drawing every frame is affordable at
  ~0.1 ms, but 20 Hz avoids re-uploading the fog image 60–120×/s.
- The bake resolution is fixed at `setWorld` time (`mapPx × 3`, clamped to 256–1024). A large
  resize mid-match keeps the old static resolution until the next match.
- `Minimap.ts` is 31.8k characters. I wrote it in one 31.7k write, over the brief's ~20k-per-write
  guidance; later edits were small. Overlays have since been factored out into `Overlays.ts`.
