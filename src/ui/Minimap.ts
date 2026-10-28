// The in-match minimap (R06). A self-contained renderer: it knows nothing about the
// Engine, only the plain data it is handed.
//
//   setWorld(world)  — ONCE per match: bakes the static layer (hillshaded, tinted
//                      terrain with contours; outside-ring dimming; walls; props)
//                      into an offscreen canvas.
//   draw(view)       — every tick: composites static layer → fog → path → pickups →
//                      hit pings → rival → self (vision cone + arrow) → overlays
//                      (north, scale bar, explored %, rival distance, mode).
//   ping(x, z, kind, time) — a hit ring that expands and fades.
//   click on the canvas — cycles overview → follow → heading-up.
//
// Units: world metres (x east, z south, north = −z), seconds, radians; map pixels
// are backing-store pixels (css px × devicePixelRatio). See minimap/MapMath.ts.
import { clamp, damp, lambdaFromHalfLife, lerp, lerpAngle } from "../core/MathCore.ts";
import { objectSize, type ArenaObject } from "../game/ArenaConfig.ts";
import type { FogGrid } from "../game/FogOfWar.ts";
import { asImageSource, defaultCanvasFactory, type CanvasFactory, type MapCanvas, type MapContext2D, type MinimapHostCanvas } from "./minimap/Canvas.ts";
import { drawEdgeArrow, drawMarker, drawPropGlyph, drawToken, ITEM_STYLES, KIND_STYLES, MAP_COLOURS, PICKUP_STYLES, UNKNOWN_STYLE } from "./minimap/Glyphs.ts";
import {
  canvasAngleOf, clampToEdge, createEdgeMarker, createFrame, easeOutQuad, fitPixelsPerMetre, followPixelsPerMetre, ghostAlpha,
  headingOf, type MapFrame, type MapPoint, pingProgress, rotationFor, setFrame, worldToMap,
} from "./minimap/MapMath.ts";
import { MapOverlays, type OverlayInput } from "./minimap/Overlays.ts";
import { bakeRelief, flatTerrain, type ReliefOptions, type ReliefSummary, type TerrainSampler } from "./minimap/Relief.ts";

/** View modes, in click order: whole arena north-up; zoomed north-up on the player; zoomed and rotated so the player's heading is up. */
export type MinimapMode = "overview" | "follow" | "heading";
export const MINIMAP_MODES: readonly MinimapMode[] = ["overview", "follow", "heading"];
const MODE_LABEL: Record<MinimapMode, string> = { overview: "MAP", follow: "FOLLOW", heading: "HEAD-UP" };

/** A ground point, metres. */
export interface GroundPoint { x: number; z: number }
/** A fighter on the map: position and the ground direction its body faces (any length). */
export interface MinimapFighter { x: number; z: number; facingX: number; facingZ: number }
/** A PowerUps.Pickup-shaped drop (structural: the Engine's `#pickups` array passes as-is). */
export interface MinimapPickupLike { x: number; z: number; def: { id: string; kind: string } }
/** An Items.Item-shaped drop (structural: the Engine's `#items` array passes as-is). */
export interface MinimapItemLike { x: number; z: number; kind: string }
/** A prop on the ring (ArenaConfig.ArenaObject-shaped; `rotation` is THREE rotation.y, radians). */
export type MinimapProp = Pick<ArenaObject, "x" | "z" | "rotation" | "scale"> & { kind: string };

/** What is static for a whole match. */
export interface MinimapWorld {
  /** Heightfield sampler; null/undefined = flat floor (today's arena). */
  terrain?: TerrainSampler | null;
  /** The ring outline, world points (ArenaPhysics.outline(cfg, n)). Centred on the origin. */
  outline: readonly GroundPoint[];
  /** True when the perimeter wall exists (ArenaState.walled). */
  walled: boolean;
  props: readonly MinimapProp[];
  /** ArenaConfig.size, metres across; bounds the map extent together with the outline. */
  size: number;
}

/** What changes per tick. Build once with createMinimapView() and mutate it — no per-tick allocation. */
export interface MinimapView {
  /** Monotonic clock, seconds (the same clock passed to ping()). */
  time: number;
  /** The fighter whose map this is. */
  self: MinimapFighter;
  /** "Up" on the heading-up map (e.g. the camera's ground forward). (0, 0) = use self.facing. */
  headingX: number;
  headingZ: number;
  /** Radius of self's sight, metres (Senses adapted range): sizes the vision cone and the follow zoom. */
  sightRange: number;
  /** The other fighter, or null. */
  rival: MinimapFighter | null;
  /** Can self see the rival right now (fog isVisible at the rival)? Otherwise a fading "last seen" ghost is shown. */
  rivalVisible: boolean;
  /** self's fog of war; null = no fog (everything revealed). */
  fog: FogGrid | null;
  pickups: readonly MinimapPickupLike[];
  items: readonly MinimapItemLike[];
  /** Planned route (e.g. A* waypoints), drawn from self through each point; null = none. */
  path: readonly GroundPoint[] | null;
}

/** A blank view object to reuse every tick. */
export function createMinimapView(): MinimapView {
  return {
    time: 0, self: { x: 0, z: 0, facingX: 0, facingZ: -1 }, headingX: 0, headingZ: 0, sightRange: 12,
    rival: { x: 0, z: 0, facingX: 0, facingZ: 1 }, rivalVisible: false, fog: null, pickups: [], items: [], path: null,
  };
}

/** Kind of hit ping: "taken" = self was hit (red), "dealt" = self hit someone (gold). */
export type PingKind = "taken" | "dealt";

/** Tunables. Every length is derived from these named bases (R08). */
export interface MinimapOptions {
  /** CSS size of the square map, px, used until layout reports one. */
  cssSizePx: number;
  /** Backing-store scale; default globalThis.devicePixelRatio (re-read every draw). */
  devicePixelRatio: number;
  mode: MinimapMode;
  createCanvas: CanvasFactory;
  /** Click on the map cycles the mode. */
  clickToCycle: boolean;
  /** Static layer pixels per map pixel: ≈ the deepest follow magnification, so zoomed walls stay crisp. */
  bakeSupersample: number;
  minBakePx: number;
  maxBakePx: number;
  /** Relief is shaded at most at this resolution, then smoothly upscaled (shading is soft, so this costs nothing visible). */
  maxReliefPx: number;
  /** Follow zoom shows this many sight radii from the centre to the edge. */
  followViewFactor: number;
  /** Half-width of the bright focus wedge inside the sight circle, radians (±50°: the attentive field). */
  focusHalfAngle: number;
  /** Seconds for the rival's ghost to fade to `ghostFloorAlpha`. */
  ghostLifeSeconds: number;
  ghostFloorAlpha: number;
  /** Seconds a hit ping lives. */
  pingLifeSeconds: number;
  /** Half-life of mode transitions (zoom/centre/rotation blends), seconds. */
  transitionHalfLife: number;
  relief: Partial<ReliefOptions>;
}

export const DEFAULT_MINIMAP_OPTIONS: Omit<MinimapOptions, "createCanvas" | "devicePixelRatio"> = {
  cssSizePx: 200,
  mode: "overview",
  clickToCycle: true,
  bakeSupersample: 3,
  minBakePx: 256,
  maxBakePx: 1024,
  maxReliefPx: 512,
  followViewFactor: 1.6,
  focusHalfAngle: (50 * Math.PI) / 180,
  ghostLifeSeconds: 12,
  ghostFloorAlpha: 0.2,
  pingLifeSeconds: 1.2,
  transitionHalfLife: 0.09,
  relief: {},
};

/** Per-draw counters (one reused object), for tests and the QA manifest. */
export interface MinimapDrawStats {
  draws: number;
  pickupsDrawn: number;
  itemsDrawn: number;
  selfDrawn: boolean;
  rival: "visible" | "ghost" | "none";
  rivalOffMap: boolean;
  pingsDrawn: number;
  pathPoints: number;
  scaleBarMetres: number;
}

// Layout in CSS px (multiplied by dpr at draw time). Each is a legibility choice at a 132–220 px map.
const FONT_CSS_PX = 10;
const EDGE_INSET_CSS_PX = 7;
/** Fighter arrow half-length; the largest glyph, so the two fighters dominate the map's visual hierarchy. */
const ARROW_CSS_PX = 7.5;
/**
 * The sight wedge never covers more than this fraction of the map width. In a small ring
 * the sight range exceeds the whole map, and a full-size translucent wedge washed out
 * every marker (vision review: clarity 5/10); capped, it still shows the facing.
 */
const CONE_MAX_MAP_FRACTION = 0.3;
const MARKER_CSS_PX = 3.6;
const MIN_PROP_CSS_PX = 2.4;
const WALL_CSS_PX = 2.2;
/** Overview leaves 4 % of the half-size free so the wall line is not clipped. */
const OVERVIEW_PADDING = 0.04;
/** The square world extent is the ring's radius plus 8 %: room for the wall stroke and the outside strip. */
const EXTENT_MARGIN = 0.08;
/** Fog colour (rgb) and opacities: never seen ≈ black, remembered = dimmed, visible = clear. */
const FOG_RGB = [8, 12, 16] as const;
/** Unseen keeps ~20 % of the terrain showing (the arena's shape is known, its contents are not); remembered keeps ~63 %. */
const FOG_ALPHA_UNSEEN = 205;
const FOG_ALPHA_SEEN = 95;
/** The same unseen opacity as a CSS colour, for the area beyond the fog grid. */
const FOG_UNSEEN_CSS = `rgba(${FOG_RGB[0]},${FOG_RGB[1]},${FOG_RGB[2]},${(FOG_ALPHA_UNSEEN / 255).toFixed(3)})`;
/** Remembered (not currently visible) pickups are drawn at this opacity. */
const REMEMBERED_ALPHA = 0.55;
/** Ring-buffer size for pings: a few hits per second × a 1.2 s life. */
const PING_CAPACITY = 8;
const FONT_FAMILY = "'Palatino Linotype',Palatino,Georgia,serif";

export class Minimap {
  readonly #canvas: MinimapHostCanvas;
  readonly #ctx: MapContext2D | null;
  readonly #opts: MinimapOptions;
  #mode: MinimapMode;
  #dpr = 1;
  /** True when opts.devicePixelRatio was given: then the live ratio is not followed. */
  readonly #dprPinned: boolean;
  #font = "";
  #boldFont = "";
  // Static layer (world-space, north-up), baked once per setWorld.
  #static: MapCanvas | null = null;
  #extent = 1;
  #ringRadius = 1;
  #bakePpm = 1;
  #bakeCount = 0;
  #relief: ReliefSummary | null = null;
  #reliefScratch: Float32Array | null = null;
  // Fog layer: one pixel per fog cell, alpha only; rebuilt when the grid size changes.
  #fogLayer: MapCanvas | null = null;
  #fogImage: ImageData | null = null;
  // Smoothed mode blends.
  #followBlend = 0;
  #headingBlend = 0;
  #lastTime = -1;
  // Rival memory.
  #ghostX = 0;
  #ghostZ = 0;
  #ghostTime = -1;
  // Hit pings ring buffer.
  readonly #pingX = new Float64Array(PING_CAPACITY);
  readonly #pingZ = new Float64Array(PING_CAPACITY);
  readonly #pingT = new Float64Array(PING_CAPACITY).fill(-Infinity);
  readonly #pingKind = new Uint8Array(PING_CAPACITY);
  #pingNext = 0;
  // Reused scratch.
  readonly #frame: MapFrame = createFrame();
  readonly #pt: MapPoint = { x: 0, y: 0 };
  readonly #edge = createEdgeMarker();
  readonly #dashPath: number[] = [4, 3];
  readonly #noDash: number[] = [];
  readonly #cone: CanvasGradient | null;
  // Overlays (north, scale bar, corner text) and their reused input.
  readonly #overlays = new MapOverlays();
  readonly #overlayInput: OverlayInput = { fog: null, modeLabel: "", selfX: 0, selfZ: 0, rivalX: NaN, rivalZ: NaN };
  // The ring outline (x0, z0, x1, z1, …), redrawn above the fog every tick so the arena's shape always reads.
  #outlineXZ = new Float64Array(0);
  #walled = false;
  // Cached ghost-age label (rebuilt only when the whole seconds change).
  #ghostAgeShown = -1;
  #ghostAgeText = "";
  readonly #stats: MinimapDrawStats = {
    draws: 0, pickupsDrawn: 0, itemsDrawn: 0, selfDrawn: false, rival: "none", rivalOffMap: false, pingsDrawn: 0, pathPoints: 0, scaleBarMetres: 0,
  };
  readonly #onClick = (ev: Event): void => {
    ev.stopPropagation();
    this.cycleMode();
  };

  constructor(canvas: MinimapHostCanvas, opts: Partial<MinimapOptions> = {}) {
    const g = globalThis as { devicePixelRatio?: number };
    this.#opts = {
      ...DEFAULT_MINIMAP_OPTIONS,
      createCanvas: defaultCanvasFactory,
      devicePixelRatio: g.devicePixelRatio || 1,
      ...opts,
    };
    this.#dprPinned = opts.devicePixelRatio !== undefined;
    this.#canvas = canvas;
    this.#ctx = canvas.getContext("2d");
    this.#mode = this.#opts.mode;
    // The cone gradient lives in a unit-radius local space, so ONE gradient serves every draw (translate/rotate/scale place it).
    this.#cone = this.#ctx ? this.#ctx.createRadialGradient(0, 0, 0, 0, 0, 1) : null;
    if (this.#cone) {
      this.#cone.addColorStop(0, "rgba(255,243,207,0.42)");
      this.#cone.addColorStop(0.7, "rgba(255,243,207,0.14)");
      this.#cone.addColorStop(1, "rgba(255,243,207,0)");
    }
    this.resize(this.#opts.cssSizePx, this.#opts.devicePixelRatio);
    if (this.#opts.clickToCycle) canvas.addEventListener?.("click", this.#onClick);
    this.#label();
  }

  /** Current mode. */
  get mode(): MinimapMode { return this.#mode; }
  /** How many times the static layer has been baked (once per setWorld). */
  get bakeCount(): number { return this.#bakeCount; }
  /** What the last bake measured (height range, contour interval, line count). */
  get relief(): ReliefSummary | null { return this.#relief; }
  /** Counters from the last draw (one reused object). */
  get stats(): Readonly<MinimapDrawStats> { return this.#stats; }
  /** The projection used by the last draw. */
  get frame(): Readonly<MapFrame> { return this.#frame; }

  /** Switch to a mode (transitions are smoothed). */
  setMode(mode: MinimapMode): void {
    this.#mode = mode;
    this.#label();
  }

  /** Advance to the next mode in MINIMAP_MODES order; returns it. */
  cycleMode(): MinimapMode {
    this.setMode(MINIMAP_MODES[(MINIMAP_MODES.indexOf(this.#mode) + 1) % MINIMAP_MODES.length]);
    return this.#mode;
  }

  /**
   * Size the backing store: width = height = round(cssPx · dpr). Call when the CSS
   * size changes (a media query) or with no arguments to re-read clientWidth.
   */
  resize(cssPx?: number, dpr?: number): void {
    const css = cssPx ?? (this.#canvas.clientWidth || this.#opts.cssSizePx);
    this.#dpr = dpr ?? this.#dpr;
    const px = Math.max(16, Math.round(css * this.#dpr));
    if (this.#canvas.width !== px) this.#canvas.width = px;
    if (this.#canvas.height !== px) this.#canvas.height = px;
    this.#font = `${Math.round(FONT_CSS_PX * this.#dpr)}px ${FONT_FAMILY}`;
    this.#boldFont = `bold ${Math.round((FONT_CSS_PX + 1) * this.#dpr)}px ${FONT_FAMILY}`;
  }

  /** Remove the click listener. */
  dispose(): void {
    this.#canvas.removeEventListener?.("click", this.#onClick);
  }

  /** Record a hit at world (x, z): an expanding ring that fades over pingLifeSeconds. `time` uses the view clock. */
  ping(x: number, z: number, kind: PingKind, time: number): void {
    const i = this.#pingNext;
    this.#pingX[i] = x;
    this.#pingZ[i] = z;
    this.#pingT[i] = time;
    this.#pingKind[i] = kind === "taken" ? 1 : 0;
    this.#pingNext = (i + 1) % PING_CAPACITY;
  }

  /**
   * Bake the static layer for a match. Extent E = max(ring radius, size/2)·(1 + 8 %);
   * the layer covers world [−E, E]² at bakePpm = bakePx / 2E px/m, where
   * bakePx = clamp(mapPx · bakeSupersample, minBakePx, maxBakePx).
   * Also clears the rival ghost and pings (a new match knows nothing yet).
   */
  setWorld(world: MinimapWorld): void {
    let ring = 0;
    for (let i = 0; i < world.outline.length; i++) ring = Math.max(ring, Math.hypot(world.outline[i].x, world.outline[i].z));
    this.#ringRadius = Math.max(1, ring || world.size / 2);
    if (this.#outlineXZ.length !== world.outline.length * 2) this.#outlineXZ = new Float64Array(world.outline.length * 2);
    for (let i = 0; i < world.outline.length; i++) {
      this.#outlineXZ[2 * i] = world.outline[i].x;
      this.#outlineXZ[2 * i + 1] = world.outline[i].z;
    }
    this.#walled = world.walled;
    const E = Math.max(this.#ringRadius, world.size / 2) * (1 + EXTENT_MARGIN);
    this.#extent = E;
    const o = this.#opts;
    const mapPx = this.#canvas.width;
    const bakePx = Math.round(clamp(mapPx * o.bakeSupersample, o.minBakePx, o.maxBakePx));
    this.#bakePpm = bakePx / (2 * E);
    if (!this.#static || this.#static.width !== bakePx) this.#static = o.createCanvas(bakePx, bakePx);
    const sctx = this.#static.getContext("2d");
    this.#ghostTime = -1;
    this.#pingT.fill(-Infinity);
    this.#lastTime = -1;
    if (!sctx) return;
    // 1. Relief: shaded at ≤ maxReliefPx, upscaled with smoothing.
    const reliefPx = Math.min(bakePx, o.maxReliefPx);
    const reliefLayer = o.createCanvas(reliefPx, reliefPx);
    const rctx = reliefLayer.getContext("2d");
    if (rctx) {
      const img = rctx.createImageData(reliefPx, reliefPx);
      if (!this.#reliefScratch || this.#reliefScratch.length !== reliefPx * reliefPx) this.#reliefScratch = new Float32Array(reliefPx * reliefPx);
      const terrain = world.terrain ?? flatTerrain({ minX: -E, minZ: -E, maxX: E, maxZ: E });
      this.#relief = bakeRelief(terrain, -E, -E, (2 * E) / reliefPx, reliefPx, reliefPx, img.data, this.#reliefScratch, o.relief);
      rctx.putImageData(img, 0, 0);
    }
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.fillStyle = MAP_COLOURS.background;
    sctx.fillRect(0, 0, bakePx, bakePx);
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(asImageSource(reliefLayer), 0, 0, bakePx, bakePx);
    // Static px per display px at overview zoom ≈ bakePx / mapPx: converts CSS sizes into layer pixels.
    const unit = (this.#dpr * bakePx) / Math.max(1, mapPx);
    const k = this.#bakePpm;
    // 2. Outside the ring: dimmed (even-odd: whole layer minus the ring polygon).
    sctx.beginPath();
    sctx.rect(0, 0, bakePx, bakePx);
    this.#tracePolygon(sctx, world.outline, E, k);
    sctx.fillStyle = MAP_COLOURS.outsideDim;
    sctx.fill("evenodd");
    // 3. The perimeter: a solid stone wall, or a dashed coral ring-out edge.
    sctx.lineJoin = "round";
    if (world.walled) {
      sctx.beginPath();
      this.#tracePolygon(sctx, world.outline, E, k);
      sctx.strokeStyle = MAP_COLOURS.wallShadow;
      sctx.lineWidth = WALL_CSS_PX * unit * 1.9;
      sctx.stroke();
      sctx.strokeStyle = MAP_COLOURS.wall;
      sctx.lineWidth = WALL_CSS_PX * unit;
      sctx.stroke();
    } else {
      sctx.beginPath();
      this.#tracePolygon(sctx, world.outline, E, k);
      sctx.setLineDash([5 * unit, 3.5 * unit]);
      sctx.strokeStyle = MAP_COLOURS.edgeUnwalled;
      sctx.lineWidth = WALL_CSS_PX * unit * 0.8;
      sctx.stroke();
      sctx.setLineDash(this.#noDash);
    }
    // 4. Props, each in its own rotated local frame (canvas angle = −THREE rotation.y: y points south on the map).
    for (let i = 0; i < world.props.length; i++) {
      const p = world.props[i];
      const size = objectSize(p.kind as ArenaObject["kind"]) as { r: number } | undefined;
      const r = Math.max(MIN_PROP_CSS_PX * unit, (size?.r ?? 0.6) * p.scale * k);
      sctx.save();
      sctx.translate((p.x + E) * k, (p.z + E) * k);
      sctx.rotate(-p.rotation);
      drawPropGlyph(sctx, p.kind, r, Math.max(1, 0.8 * unit), p.x, p.z);
      sctx.restore();
    }
    this.#bakeCount++;
  }

  /** Composite one frame. Allocation-free apart from overlay strings when the number they show changes. */
  draw(view: MinimapView): void {
    const ctx = this.#ctx;
    if (!ctx) return;
    // Follow the live devicePixelRatio (window moved to another screen, browser zoom) unless the caller pinned it.
    const g = globalThis as { devicePixelRatio?: number };
    if (!this.#dprPinned && g.devicePixelRatio && g.devicePixelRatio !== this.#dpr) this.resize(undefined, g.devicePixelRatio);
    const W = this.#canvas.width, H = this.#canvas.height, size = Math.min(W, H), u = this.#dpr;
    const st = this.#stats;
    st.draws++;
    st.pickupsDrawn = st.itemsDrawn = st.pingsDrawn = st.pathPoints = 0;
    st.selfDrawn = st.rivalOffMap = false;
    st.rival = "none";
    // --- Frame: blend overview ↔ follow (centre + log-zoom) and north-up ↔ heading-up (rotation).
    const dt = this.#lastTime < 0 ? -1 : clamp(view.time - this.#lastTime, 0, 0.5);
    this.#lastTime = view.time;
    const followTarget = this.#mode === "overview" ? 0 : 1, headingTarget = this.#mode === "heading" ? 1 : 0;
    if (dt < 0) {
      this.#followBlend = followTarget;
      this.#headingBlend = headingTarget;
    } else {
      const lambda = lambdaFromHalfLife(this.#opts.transitionHalfLife);
      this.#followBlend = damp(this.#followBlend, followTarget, lambda, dt);
      this.#headingBlend = damp(this.#headingBlend, headingTarget, lambda, dt);
      if (Math.abs(this.#followBlend - followTarget) < 1e-3) this.#followBlend = followTarget;
      if (Math.abs(this.#headingBlend - headingTarget) < 1e-3) this.#headingBlend = headingTarget;
    }
    const self = view.self;
    const overviewPpm = fitPixelsPerMetre(size, this.#ringRadius, OVERVIEW_PADDING);
    const followPpm = followPixelsPerMetre(size, view.sightRange, this.#opts.followViewFactor, overviewPpm);
    const ppm = Math.exp(lerp(Math.log(overviewPpm), Math.log(followPpm), this.#followBlend));
    const up = view.headingX !== 0 || view.headingZ !== 0 ? headingOf(view.headingX, view.headingZ) : headingOf(self.facingX, self.facingZ);
    const rot = lerpAngle(0, rotationFor("player-up", up), this.#headingBlend);
    const f = setFrame(this.#frame, W, H, self.x * this.#followBlend, self.z * this.#followBlend, ppm, rot);
    // --- Background + static layer.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = MAP_COLOURS.background;
    ctx.fillRect(0, 0, W, H);
    if (this.#static) {
      const E = this.#extent, k = this.#bakePpm;
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(rot);
      ctx.scale(ppm / k, ppm / k);
      ctx.translate(-(f.centreX + E) * k, -(f.centreZ + E) * k);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(asImageSource(this.#static), 0, 0);
      ctx.restore();
    }
    if (view.fog) this.#drawFog(ctx, view.fog, f);
    this.#drawRing(ctx, f, u);
    this.#drawPath(ctx, view, f, u);
    this.#drawDrops(ctx, view, f, u);
    this.#drawPings(ctx, view.time, f, u);
    this.#drawRival(ctx, view, f, u);
    this.#drawSelf(ctx, view, f, u);
    const oi = this.#overlayInput;
    oi.fog = view.fog;
    oi.modeLabel = MODE_LABEL[this.#mode];
    oi.selfX = self.x;
    oi.selfZ = self.z;
    oi.rivalX = view.rival ? view.rival.x : NaN;
    oi.rivalZ = view.rival ? view.rival.z : NaN;
    this.#overlays.draw(ctx, f, oi, this.#font, this.#boldFont, u);
    st.scaleBarMetres = this.#overlays.scaleBarMetres;
  }

  /** The ring edge above the fog: a solid stone line when walled, a dashed coral ring-out edge when not. */
  #drawRing(ctx: MapContext2D, f: MapFrame, u: number): void {
    const xz = this.#outlineXZ, pt = this.#pt;
    if (xz.length < 6) return;
    ctx.beginPath();
    for (let i = 0; i < xz.length; i += 2) {
      worldToMap(f, xz[i], xz[i + 1], pt);
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.lineJoin = "round";
    if (this.#walled) {
      ctx.strokeStyle = MAP_COLOURS.wallShadow;
      ctx.lineWidth = WALL_CSS_PX * 1.6 * u;
      ctx.stroke();
      ctx.strokeStyle = MAP_COLOURS.wall;
      ctx.lineWidth = WALL_CSS_PX * 0.75 * u;
      ctx.stroke();
    } else {
      this.#dashPath[0] = 5 * u;
      this.#dashPath[1] = 3.5 * u;
      ctx.setLineDash(this.#dashPath);
      ctx.strokeStyle = MAP_COLOURS.edgeUnwalled;
      ctx.lineWidth = WALL_CSS_PX * 0.8 * u;
      ctx.stroke();
      ctx.setLineDash(this.#noDash);
    }
  }

  // ---------------------------------------------------------------- layers

  #drawFog(ctx: MapContext2D, fog: FogGrid, f: MapFrame): void {
    if (!this.#fogLayer || !this.#fogImage || this.#fogLayer.width !== fog.cols || this.#fogLayer.height !== fog.rows) {
      this.#fogLayer = this.#opts.createCanvas(fog.cols, fog.rows);
      const fctx0 = this.#fogLayer.getContext("2d");
      this.#fogImage = fctx0 ? fctx0.createImageData(fog.cols, fog.rows) : null;
      if (this.#fogImage) {
        const d = this.#fogImage.data;
        for (let p = 0; p < d.length; p += 4) { d[p] = FOG_RGB[0]; d[p + 1] = FOG_RGB[1]; d[p + 2] = FOG_RGB[2]; }
      }
    }
    const fctx = this.#fogLayer.getContext("2d");
    const img = this.#fogImage;
    if (!fctx || !img) return;
    const d = img.data, n = fog.cols * fog.rows;
    for (let i = 0; i < n; i++) d[i * 4 + 3] = fog.visible[i] ? 0 : fog.seen[i] ? FOG_ALPHA_SEEN : FOG_ALPHA_UNSEEN;
    fctx.putImageData(img, 0, 0);
    // One fog pixel = one cell; bilinear upscaling softens every edge across one cell.
    const s = f.pixelsPerMetre * fog.cell;
    ctx.save();
    ctx.translate(f.widthPx / 2, f.heightPx / 2);
    ctx.rotate(f.rotation);
    ctx.scale(s, s);
    ctx.translate(-(f.centreX + fog.half) / fog.cell, -(f.centreZ + fog.half) / fog.cell);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(asImageSource(this.#fogLayer), 0, 0);
    // Beyond the grid nothing was ever seen: cover it (even-odd: big square minus the grid).
    const big = (f.widthPx + f.heightPx) / s + fog.cols + fog.rows;
    ctx.beginPath();
    ctx.rect(-big, -big, fog.cols + 2 * big, fog.rows + 2 * big);
    ctx.rect(0, 0, fog.cols, fog.rows);
    ctx.fillStyle = FOG_UNSEEN_CSS;
    ctx.fill("evenodd");
    ctx.restore();
  }

  #drawPath(ctx: MapContext2D, view: MinimapView, f: MapFrame, u: number): void {
    const path = view.path;
    if (!path || path.length === 0) return;
    const pt = this.#pt;
    ctx.beginPath();
    worldToMap(f, view.self.x, view.self.z, pt);
    ctx.moveTo(pt.x, pt.y);
    for (let i = 0; i < path.length; i++) {
      worldToMap(f, path[i].x, path[i].z, pt);
      ctx.lineTo(pt.x, pt.y);
    }
    this.#dashPath[0] = 4 * u;
    this.#dashPath[1] = 3 * u;
    ctx.setLineDash(this.#dashPath);
    ctx.strokeStyle = MAP_COLOURS.path;
    ctx.lineWidth = 1.6 * u;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.setLineDash(this.#noDash);
    // Destination dot.
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 2.2 * u, 0, Math.PI * 2);
    ctx.fillStyle = MAP_COLOURS.path;
    ctx.fill();
    this.#stats.pathPoints = path.length;
  }

  #drawDrops(ctx: MapContext2D, view: MinimapView, f: MapFrame, u: number): void {
    const pt = this.#pt, r = MARKER_CSS_PX * u, lw = 1.1 * u, fog = view.fog;
    for (let i = 0; i < view.pickups.length; i++) {
      const p = view.pickups[i];
      const known = Minimap.#fogState(fog, p.x, p.z);
      if (known === 0) continue;
      worldToMap(f, p.x, p.z, pt);
      if (pt.x < -r || pt.y < -r || pt.x > f.widthPx + r || pt.y > f.heightPx + r) continue;
      ctx.globalAlpha = known === 2 ? 1 : REMEMBERED_ALPHA;
      drawMarker(ctx, PICKUP_STYLES[p.def.id] ?? KIND_STYLES[p.def.kind] ?? UNKNOWN_STYLE, pt.x, pt.y, r, lw);
      this.#stats.pickupsDrawn++;
    }
    for (let i = 0; i < view.items.length; i++) {
      const it = view.items[i];
      const known = Minimap.#fogState(fog, it.x, it.z);
      if (known === 0) continue;
      worldToMap(f, it.x, it.z, pt);
      if (pt.x < -r || pt.y < -r || pt.x > f.widthPx + r || pt.y > f.heightPx + r) continue;
      ctx.globalAlpha = known === 2 ? 1 : REMEMBERED_ALPHA;
      drawMarker(ctx, ITEM_STYLES[it.kind] ?? UNKNOWN_STYLE, pt.x, pt.y, r * 0.85, lw);
      this.#stats.itemsDrawn++;
    }
    ctx.globalAlpha = 1;
  }

  #drawPings(ctx: MapContext2D, time: number, f: MapFrame, u: number): void {
    const life = this.#opts.pingLifeSeconds, pt = this.#pt, e = this.#edge;
    for (let i = 0; i < PING_CAPACITY; i++) {
      const t = pingProgress(time - this.#pingT[i], life);
      if (t < 0) continue;
      worldToMap(f, this.#pingX[i], this.#pingZ[i], pt);
      clampToEdge(f, pt.x, pt.y, EDGE_INSET_CSS_PX * u, e);
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = this.#pingKind[i] ? MAP_COLOURS.pingTaken : MAP_COLOURS.pingDealt;
      ctx.lineWidth = 1.8 * u;
      ctx.beginPath();
      ctx.arc(e.x, e.y, lerp(2, 13, easeOutQuad(t)) * u, 0, Math.PI * 2);
      ctx.stroke();
      this.#stats.pingsDrawn++;
    }
    ctx.globalAlpha = 1;
  }

  #drawRival(ctx: MapContext2D, view: MinimapView, f: MapFrame, u: number): void {
    const rival = view.rival, pt = this.#pt, e = this.#edge, st = this.#stats;
    if (rival && view.rivalVisible) {
      this.#ghostX = rival.x;
      this.#ghostZ = rival.z;
      this.#ghostTime = view.time;
      worldToMap(f, rival.x, rival.z, pt);
      clampToEdge(f, pt.x, pt.y, EDGE_INSET_CSS_PX * u, e);
      st.rival = "visible";
      st.rivalOffMap = e.offMap;
      if (e.offMap) drawEdgeArrow(ctx, e.x, e.y, e.angle, 5 * u, MAP_COLOURS.rival, u);
      else drawToken(ctx, pt.x, pt.y, canvasAngleOf(f, headingOf(rival.facingX, rival.facingZ)), ARROW_CSS_PX * u, MAP_COLOURS.rival, 1.7 * u);
      return;
    }
    if (this.#ghostTime < 0) return;
    const age = Math.max(0, view.time - this.#ghostTime);
    worldToMap(f, this.#ghostX, this.#ghostZ, pt);
    clampToEdge(f, pt.x, pt.y, EDGE_INSET_CSS_PX * u, e);
    st.rival = "ghost";
    st.rivalOffMap = e.offMap;
    ctx.globalAlpha = ghostAlpha(age, this.#opts.ghostLifeSeconds, this.#opts.ghostFloorAlpha);
    if (e.offMap) drawEdgeArrow(ctx, e.x, e.y, e.angle, 4.5 * u, MAP_COLOURS.rival, u);
    else {
      this.#dashPath[0] = 2 * u;
      this.#dashPath[1] = 2 * u;
      ctx.setLineDash(this.#dashPath);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4.5 * u, 0, Math.PI * 2);
      ctx.strokeStyle = MAP_COLOURS.rival;
      ctx.lineWidth = 1.4 * u;
      ctx.stroke();
      ctx.setLineDash(this.#noDash);
      const secs = Math.floor(age);
      if (secs !== this.#ghostAgeShown) { this.#ghostAgeShown = secs; this.#ghostAgeText = `${secs}s`; }
      ctx.font = this.#font;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = MAP_COLOURS.rivalText;
      ctx.fillText(this.#ghostAgeText, pt.x + 6.5 * u, pt.y);
    }
    ctx.globalAlpha = 1;
  }

  #drawSelf(ctx: MapContext2D, view: MinimapView, f: MapFrame, u: number): void {
    const self = view.self, pt = this.#pt, e = this.#edge;
    worldToMap(f, self.x, self.z, pt);
    clampToEdge(f, pt.x, pt.y, EDGE_INSET_CSS_PX * u, e);
    this.#stats.selfDrawn = true;
    if (e.offMap) {
      drawEdgeArrow(ctx, e.x, e.y, e.angle, 5 * u, MAP_COLOURS.self, u);
      return;
    }
    const facing = canvasAngleOf(f, headingOf(self.facingX, self.facingZ));
    const rPx = Math.max(1, Math.min(view.sightRange * f.pixelsPerMetre, CONE_MAX_MAP_FRACTION * f.widthPx));
    if (this.#cone) {
      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.rotate(facing);
      ctx.scale(rPx, rPx);
      // Faint full sight circle (the fog reveal is all-round) + bright focus wedge ahead.
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,243,207,0.35)";
      ctx.lineWidth = u / rPx;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 1, -this.#opts.focusHalfAngle, this.#opts.focusHalfAngle);
      ctx.closePath();
      ctx.fillStyle = this.#cone;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,243,207,0.45)";
      ctx.stroke();
      ctx.restore();
    }
    drawToken(ctx, pt.x, pt.y, facing, ARROW_CSS_PX * u, MAP_COLOURS.self, 1.7 * u);
  }

  // ---------------------------------------------------------------- helpers

  /** Append the closed outline polygon in static-layer pixels: p = (world + E)·k. */
  #tracePolygon(ctx: MapContext2D, outline: readonly GroundPoint[], E: number, k: number): void {
    for (let i = 0; i < outline.length; i++) {
      const x = (outline[i].x + E) * k, y = (outline[i].z + E) * k;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /** 0 = never seen, 1 = remembered, 2 = visible now. No fog = everything visible. */
  static #fogState(fog: FogGrid | null, x: number, z: number): 0 | 1 | 2 {
    if (!fog) return 2;
    const cx = Math.floor((x + fog.half) / fog.cell), cz = Math.floor((z + fog.half) / fog.cell);
    if (cx < 0 || cz < 0 || cx >= fog.cols || cz >= fog.rows) return 0;
    const i = cz * fog.cols + cx;
    return fog.visible[i] ? 2 : fog.seen[i] ? 1 : 0;
  }

  /** Keep the accessible name in step with the mode (screen readers; the title tooltip for the mouse). */
  #label(): void {
    const next = MINIMAP_MODES[(MINIMAP_MODES.indexOf(this.#mode) + 1) % MINIMAP_MODES.length];
    const text = `Minimap, ${MODE_LABEL[this.#mode].toLowerCase()} view. Click for ${MODE_LABEL[next].toLowerCase()}.`;
    this.#canvas.setAttribute?.("aria-label", text);
    this.#canvas.setAttribute?.("title", text);
  }
}
