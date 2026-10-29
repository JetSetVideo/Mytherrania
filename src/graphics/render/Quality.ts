// Render quality model (wave G: G01 resolution, G02 SSAO, G03 GI, G04 ray tracing, G08 polygons,
// G09 optimisation, G10 shadows). Pure: no THREE, no DOM — the engine and the settings panel
// read these tables, the tests pin them.
//
// Vocabulary:
//   output resolution   the drawing-buffer size of the canvas (what the composite pass writes).
//                       A preset names its HEIGHT; the width follows the window's aspect, so a
//                       21:9 window at "1080p" renders 2520 x 1080, never a stretched 16:9 frame.
//   render scale        the 3D scene's internal resolution as a fraction of the output (dynamic
//                       resolution moves it between DYNRES_MIN_SCALE and 1 to hold the frame budget).
//   preset              one name (low / medium / high / ultra) that sets every effect knob at once.

/** Output resolution choices. "auto" = the device's own pixels under the pixel budget. */
export const RESOLUTIONS = ["auto", "480p", "720p", "900p", "1080p", "1440p", "1800p", "2160p"] as const;
export type ResolutionChoice = typeof RESOLUTIONS[number];

/** Height in device pixels of each fixed preset (16:9 names: 854x480 … 3840x2160 "4K UHD"). */
export const RESOLUTION_HEIGHT: Readonly<Record<Exclude<ResolutionChoice, "auto">, number>> = {
  "480p": 480, "720p": 720, "900p": 900, "1080p": 1080, "1440p": 1440, "1800p": 1800, "2160p": 2160,
};

/** Human labels for the settings menu (16:9 width shown for reference). */
export const RESOLUTION_LABEL: Readonly<Record<ResolutionChoice, string>> = {
  auto: "Auto (screen)",
  "480p": "854 × 480",
  "720p": "1280 × 720 (HD)",
  "900p": "1600 × 900",
  "1080p": "1920 × 1080 (Full HD)",
  "1440p": "2560 × 1440 (QHD)",
  "1800p": "3200 × 1800",
  "2160p": "3840 × 2160 (4K UHD)",
};

/** Bounds of the canvas pixel ratio (css px -> device px). 4 lets a 1080-css-px window render 4K. */
export const PIXEL_RATIO_MIN = 0.25;
export const PIXEL_RATIO_MAX = 4;

/**
 * Canvas pixel ratio for a window of cssW x cssH:
 *   fixed preset:  ratio = presetHeight / cssH            (the output is exactly that many rows)
 *   auto:          ratio = min(dpr, 2, sqrt(budget / (cssW cssH))), floor 1
 * both clamped to [PIXEL_RATIO_MIN, PIXEL_RATIO_MAX].
 */
export function outputPixelRatio(choice: ResolutionChoice, cssW: number, cssH: number, dpr: number, budget: number): number {
  const h = Math.max(1, cssH), w = Math.max(1, cssW);
  const r = choice === "auto"
    ? Math.max(1, Math.min(dpr || 1, 2, Math.sqrt(budget / (w * h))))
    : RESOLUTION_HEIGHT[choice] / h;
  return Math.max(PIXEL_RATIO_MIN, Math.min(PIXEL_RATIO_MAX, r));
}


/** Graphics presets. */
export const GRAPHICS_PRESETS = ["low", "medium", "high", "ultra"] as const;
export type GraphicsPreset = typeof GRAPHICS_PRESETS[number];

/** Every knob a preset sets. */
export interface RenderQuality {
  /** Run the post pipeline at all (low draws straight to the canvas: the cheapest path). */
  post: boolean;
  /** MSAA samples of the scene target (0 = off). */
  msaa: number;
  /** Shadow map edge, texels. */
  shadowMapSize: number;
  /** Screen-space ambient occlusion samples per pixel (0 = off). */
  aoSamples: number;
  /** Screen-space one-bounce GI on/off (shares the AO samples). */
  gi: boolean;
  /** Ray-marched contact-shadow steps (0 = off). */
  contactSteps: number;
  /** Ray-marched reflection steps (0 = off). */
  ssrSteps: number;
  /** Effects buffer scale relative to the scene (0.5 = half resolution). */
  effectsScale: number;
  /** Screen-space ink edges on every surface. */
  inkEdges: boolean;
  /** Sky fbm octaves per cloud layer (2..5). */
  skyOctaves: number;
  /** Sky dome segments (width; height = half). */
  skySegments: number;
  /** Polygon detail multiplier for generated props (1 = baseline). */
  polygonDetail: number;
  /** Dynamic resolution: lower the render scale when frames run long. */
  dynamicResolution: boolean;
}

/**
 * The presets. Cost model (perf review R13: ~0.31 ms GPU per megapixel per simple pass on an M1
 * Pro): AO+GI at half resolution with N samples costs ~N/8 of a full-res pass; SSR ~steps/24;
 * shadows scale with map area (4096^2 is 16x 1024^2 in fill, but the caster count is small).
 */
export const RENDER_PRESETS: Readonly<Record<GraphicsPreset, RenderQuality>> = {
  low: {
    post: false, msaa: 0, shadowMapSize: 1024, aoSamples: 0, gi: false, contactSteps: 0, ssrSteps: 0,
    effectsScale: 0.5, inkEdges: false, skyOctaves: 2, skySegments: 32, polygonDetail: 0.6, dynamicResolution: true,
  },
  medium: {
    post: true, msaa: 0, shadowMapSize: 2048, aoSamples: 6, gi: false, contactSteps: 8, ssrSteps: 0,
    effectsScale: 0.5, inkEdges: true, skyOctaves: 3, skySegments: 48, polygonDetail: 1, dynamicResolution: true,
  },
  high: {
    post: true, msaa: 4, shadowMapSize: 2048, aoSamples: 8, gi: true, contactSteps: 12, ssrSteps: 24,
    effectsScale: 0.5, inkEdges: true, skyOctaves: 4, skySegments: 64, polygonDetail: 1.5, dynamicResolution: false,
  },
  ultra: {
    post: true, msaa: 4, shadowMapSize: 4096, aoSamples: 12, gi: true, contactSteps: 16, ssrSteps: 40,
    effectsScale: 0.75, inkEdges: true, skyOctaves: 5, skySegments: 96, polygonDetail: 2, dynamicResolution: false,
  },
};

/** Per-effect player overrides (settings): "auto" follows the preset. */
export type EffectToggle = "auto" | "on" | "off";

export interface QualityOverrides {
  ssao?: EffectToggle;
  gi?: EffectToggle;
  rayTracing?: EffectToggle;
}

/**
 * Resolve a preset + overrides into the live knobs. Turning an effect ON on a preset that lacks
 * it uses the high preset's value (the post pipeline switches on with it); OFF zeroes it.
 */
export function resolveQuality(preset: GraphicsPreset, o: QualityOverrides = {}): RenderQuality {
  const q: RenderQuality = { ...RENDER_PRESETS[preset] };
  const hi = RENDER_PRESETS.high;
  if (o.ssao === "on" && q.aoSamples === 0) q.aoSamples = hi.aoSamples;
  if (o.ssao === "off") q.aoSamples = 0;
  if (o.gi === "on") { q.gi = true; if (q.aoSamples === 0) q.aoSamples = hi.aoSamples; }
  if (o.gi === "off") q.gi = false;
  if (o.rayTracing === "on") {
    if (q.ssrSteps === 0) q.ssrSteps = hi.ssrSteps;
    if (q.contactSteps === 0) q.contactSteps = hi.contactSteps;
  }
  if (o.rayTracing === "off") { q.ssrSteps = 0; q.contactSteps = 0; }
  if (q.aoSamples > 0 || q.gi || q.ssrSteps > 0 || q.contactSteps > 0) q.post = true;
  return q;
}

// ------------------------------------------------------------------ dynamic resolution (G09)

/** Smallest render scale the controller may choose (half the rows: a quarter of the pixels). */
export const DYNRES_MIN_SCALE = 0.5;
/** Frame-time target, ms (60 Hz with ~1.3 ms of slack for the browser). */
export const DYNRES_TARGET_MS = 15.3;
/** Change the scale only after this many seconds of evidence (no oscillation). */
export const DYNRES_SETTLE_S = 0.75;
/** Scale step per adjustment. */
export const DYNRES_STEP = 0.08;

export interface DynResState { scale: number; avgMs: number; since: number }

export function createDynRes(): DynResState { return { scale: 1, avgMs: DYNRES_TARGET_MS, since: 0 }; }

/**
 * One frame of the controller. avgMs is an exponential moving average (half-life ~0.3 s):
 *   avg += (ms - avg) * (1 - exp(-dt * ln2 / 0.3))
 * After DYNRES_SETTLE_S: avg > 1.12 target -> scale -= step; avg < 0.75 target -> scale += step.
 * GPU cost ~ pixels ~ scale^2, so one step changes the cost by ~15%.
 */
export function stepDynRes(s: DynResState, frameMs: number, dt: number): DynResState {
  if (!(frameMs > 0) || !(dt > 0)) return s;
  const k = 1 - Math.exp((-dt * Math.LN2) / 0.3);
  s.avgMs += (Math.min(frameMs, 100) - s.avgMs) * k;
  s.since += dt;
  if (s.since < DYNRES_SETTLE_S) return s;
  if (s.avgMs > DYNRES_TARGET_MS * 1.12 && s.scale > DYNRES_MIN_SCALE) {
    s.scale = Math.max(DYNRES_MIN_SCALE, s.scale - DYNRES_STEP);
    s.since = 0;
  } else if (s.avgMs < DYNRES_TARGET_MS * 0.75 && s.scale < 1) {
    s.scale = Math.min(1, s.scale + DYNRES_STEP);
    s.since = 0;
  }
  return s;
}
