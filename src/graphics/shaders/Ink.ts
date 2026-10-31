// Ink / manga-shading law (Wave P, lane P-A). PURE: no DOM, no THREE, no I/O — every number the
// cel shaders use for the ink mark and the manga ramp is DEFINED here and, in the shader files,
// copied into uniforms (INK_UNIFORM_DEFAULTS) rather than re-typed into GLSL. The GLSL in
// INK_GLSL mirrors these functions line-for-line and takes the constants as uniforms, so this
// module is the single source of the law (a fix here moves the shader).
//
// The outline is an inverted hull: the ink is drawn by inflating a BackSide copy of the geometry
// along its view normal. Making it "subtle and variable" therefore means making the EXTRUSION a
// per-vertex quantity, not a constant: width = 0 collapses the hull onto the surface and the mark
// disappears; width = max paints a full silhouette edge. Because the width must change with the
// camera (and the camera moves without the geometry changing), the law has to run per-vertex on the
// GPU — CelShader/CelSkinned call these equations with the constants passed as uniforms.

/** The ink mark's strength for one surface point: 1 = full mark, 0 = none. */
export interface InkStrengthInput {
  /** View-space dot(lightDir, surfaceNormal): cos of the angle between the surface and the key light, in [-1, 1]. */
  lightDotN: number;
  /** View-space dot(surfaceNormal, cameraDir): cos of the angle between the surface and the camera, in [-1, 1]. 0 = silhouette edge. */
  viewDotN: number;
  /** Camera-space distance of the point in METRES (length of the view-space position). */
  depth: number;
  /** True on face geometry: a flat open surface keeps far less ink than the body silhouette. */
  isFace: boolean;
  /** Per-material ink multiplier in [0, 1] (0 mutes the outline for this mesh entirely). */
  materialInk: number;
}

/** Angular powers on the clamped cosines: how fast the mark fades as a surface turns to light / camera. */
export const INK_VIEW_POW = 1.5;
export const INK_LIGHT_POW = 1.0;
/** A face whose normal points toward the camera (viewDotN above this cosine) is a flat open surface:
 *  it keeps only INK_FACE_KEEP of the mark, so a front-on face draws almost no outline. */
export const FACE_SUPPRESS_VIEW = 0.5;
export const INK_FACE_KEEP = 0.12;
/** Depth fade (aerial perspective): the mark keeps INK_DEPTH_MIN of its strength at INK_DEPTH_FAR m. */
export const INK_DEPTH_NEAR = 0;
export const INK_DEPTH_FAR = 24;
export const INK_DEPTH_MIN = 0.7;
/** Width in view units (metres): the old fixed 0.035 m hull is now only the DEFAULT base width, and
 *  no mark may exceed INK_MAX_WIDTH m. A FAR surface draws INK_FAR_SCALE x its width (thinner ink). */
export const INK_BASE_WIDTH = 0.035;
export const INK_MAX_WIDTH = 0.05;
export const INK_FAR_SCALE = 0.55;
/** Manga ramp: a few FLAT bands, the shade tone of the darkest band, and the wrap (Guilty-Gear
 *  style) that lifts the hard terminator into the shadow so back-lit edges keep a lit rim. */
export const MANGA_BANDS = 3;
export const MANGA_SHADE = 0.7;
export const MANGA_WRAP = 0.35;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * The ink mark's strength, in [0, 1].
 *
 * Equation (all cosines clamped to [0, 1] first):
 *   facing  = viewDotN^INK_VIEW_POW · lightDotN^INK_LIGHT_POW   // 1 only when the surface turns to BOTH
 *   s       = 1 - facing                                          // silhouette / turned-from-light → 1
 *   if isFace and viewDotN > FACE_SUPPRESS_VIEW:  s *= INK_FACE_KEEP
 *   s      *= mix(1, INK_DEPTH_MIN, depthFade)
 *   return clamp(s · materialInk, 0, 1)
 *
 * WHY: a surface facing the light AND the camera is a lit close-up and reads as an open, full
 * surface — it is barely marked. A silhouette edge (viewDotN → 0) or a surface turned away from
 * the light (lightDotN → 0) is where the drawing's line belongs, so it is fully marked.
 */
export function inkStrength(o: InkStrengthInput): number {
  const view = clamp01(o.viewDotN);
  const light = clamp01(o.lightDotN);
  const facing = Math.pow(view, INK_VIEW_POW) * Math.pow(light, INK_LIGHT_POW);
  let s = 1 - facing;
  if (o.isFace && view > FACE_SUPPRESS_VIEW) s *= INK_FACE_KEEP;
  const span = Math.max(INK_DEPTH_FAR - INK_DEPTH_NEAR, 1e-6);
  const depthFade = clamp01((o.depth - INK_DEPTH_NEAR) / span);
  s *= mix(1, INK_DEPTH_MIN, depthFade);
  return clamp01(s * clamp01(o.materialInk));
}

/** The mark's width in view units at that point (0 when suppressed). */
export interface InkWidthInput {
  strength: number;
  baseWidth: number;
  farFade: boolean;
}

/**
 * The hull extrusion for one vertex, in view units (metres).
 *
 * Equation:  w = clamp(strength, 0, 1) · baseWidth;  if farFade: w *= INK_FAR_SCALE;  return min(w, INK_MAX_WIDTH).
 *
 * WHY bounded: the inverted hull must never outrun the geometry it wraps, so the width is capped
 * at INK_MAX_WIDTH regardless of what a caller passes as `baseWidth`.
 */
export function inkWidth(o: InkWidthInput): number {
  let w = clamp01(o.strength) * Math.max(o.baseWidth, 0);
  if (o.farFade) w *= INK_FAR_SCALE;
  return Math.min(w, INK_MAX_WIDTH);
}

/** The band edges + shade tone for a manga ramp: a stated equation, few bands, a hard terminator. */
export interface MangaRampInput {
  /** View-space dot(surfaceNormal, lightDir), in [-1, 1]. */
  lightDotN: number;
  /** Number of flat bands (floored, clamped to ≥ 1). */
  bands: number;
  /** The shade tone of the darkest band, in [0, 1] — the "shade" the user sees inside a terminator. */
  shadeTone: number;
  /** Wrap amount ≥ 0: the terminator is lifted this far into the shadow (Guilty Gear / DBZ look). */
  wrap: number;
}

export interface MangaRamp {
  /** Flat band index in [0, bands - 1]. */
  band: number;
  /** Shade tone multiplier for this band, in [shadeTone, 1] (never exceeds 1). */
  shade: number;
  /** The band's lower edge in wrapped-light space — the hard step the terminator sits on. */
  terminator: number;
}

/**
 * The manga ramp.
 *
 * Equation:
 *   lift  = clamp((lightDotN + wrap) / (1 + wrap), 0, 1)   // wrap lifts the terminator into the shadow
 *   band  = min(floor(lift · bands), bands - 1)             // a hard step: the terminator is a band edge
 *   level = bands > 1 ? band / (bands - 1) : 1
 *   shade = clamp(mix(shadeTone, 1, level), 0, 1)           // band 0 = the shade tone, top band = full surface
 *   terminator = band / bands
 *
 * WHY: the user's "textures have shades and they have full surfaces" is exactly a small number of
 * flat tones: the lit side is a FULL (unmodulated) surface and the far side is flat bands of the
 * shade tone, separated by a hard terminator rather than a gradient.
 */
export function mangaRamp(o: MangaRampInput): MangaRamp {
  const bands = Math.max(1, Math.floor(o.bands));
  const wrap = Math.max(0, o.wrap);
  const lift = clamp01((o.lightDotN + wrap) / (1 + wrap));
  const band = Math.min(bands - 1, Math.max(0, Math.floor(lift * bands)));
  const level = bands > 1 ? band / (bands - 1) : 1;
  const terminator = band / bands;
  return { band, shade: clamp01(mix(o.shadeTone, 1, level)), terminator };
}

/**
 * Default values of the ink/manga constant uniforms. Ink.ts owns these numbers; the shader files
 * copy them into `IUniform` objects (so this module stays THREE-free and pure). `uIsFace` and
 * `uMaterialInk` are per-mesh and therefore deliberately absent here.
 */
export const INK_UNIFORM_DEFAULTS: Readonly<Record<string, number>> = {
  uInkViewPow: INK_VIEW_POW,
  uInkLightPow: INK_LIGHT_POW,
  uFaceSuppressView: FACE_SUPPRESS_VIEW,
  uInkFaceKeep: INK_FACE_KEEP,
  uInkDepthNear: INK_DEPTH_NEAR,
  uInkDepthFar: INK_DEPTH_FAR,
  uInkDepthMin: INK_DEPTH_MIN,
  uInkMaxWidth: INK_MAX_WIDTH,
  uInkFarScale: INK_FAR_SCALE,
  uMangaBands: MANGA_BANDS,
  uMangaShade: MANGA_SHADE,
  uMangaWrap: MANGA_WRAP,
};

/**
 * The GLSL twin of the functions above. It declares the constant uniforms (values come from
 * INK_UNIFORM_DEFAULTS) and mirrors inkStrength / inkWidth / mangaRamp. `isFace` and `materialInk`
 * are parameters, not uniforms, so the fragment shader (which never runs the ink path) is not made
 * to declare them. Included by BOTH the outline vertex shaders (ink) and the cel fragment shader
 * (mangaRamp).
 */
export const INK_GLSL = /* glsl */ `
uniform float uInkViewPow;
uniform float uInkLightPow;
uniform float uFaceSuppressView;
uniform float uInkFaceKeep;
uniform float uInkDepthNear;
uniform float uInkDepthFar;
uniform float uInkDepthMin;
uniform float uInkMaxWidth;
uniform float uInkFarScale;
uniform float uMangaBands;
uniform float uMangaShade;
uniform float uMangaWrap;

// Mirrors Ink.inkStrength. nView/lightView are view-space unit normals; viewPos is the view-space position.
float inkStrength(vec3 nView, vec3 lightView, vec3 viewPos, float isFace, float materialInk) {
  float view = clamp(dot(nView, normalize(-viewPos)), 0.0, 1.0);
  float light = clamp(dot(nView, lightView), 0.0, 1.0);
  float facing = pow(view, uInkViewPow) * pow(light, uInkLightPow);
  float s = 1.0 - facing;
  if (isFace > 0.5 && view > uFaceSuppressView) s *= uInkFaceKeep;
  float df = clamp((length(viewPos) - uInkDepthNear) / max(uInkDepthFar - uInkDepthNear, 1e-6), 0.0, 1.0);
  s *= mix(1.0, uInkDepthMin, df);
  return clamp(s * clamp(materialInk, 0.0, 1.0), 0.0, 1.0);
}

// Mirrors Ink.inkWidth: bounded by uInkMaxWidth, far surfaces thinner.
float inkWidth(float strength, float baseWidth, float farFade) {
  float w = clamp(strength, 0.0, 1.0) * max(baseWidth, 0.0);
  w *= mix(1.0, uInkFarScale, step(0.5, farFade));
  return min(w, uInkMaxWidth);
}

// Mirrors Ink.mangaRamp: few flat bands, a hard terminator, a shade tone, and a wrap.
// Returns (band index, shade tone multiplier, terminator edge).
vec3 mangaRamp(float lightDotN) {
  float lift = clamp((lightDotN + uMangaWrap) / (1.0 + uMangaWrap), 0.0, 1.0);
  float band = min(floor(lift * uMangaBands), uMangaBands - 1.0);
  float level = uMangaBands > 1.0 ? band / (uMangaBands - 1.0) : 1.0;
  float shade = clamp(mix(uMangaShade, 1.0, level), 0.0, 1.0);
  return vec3(band, shade, band / uMangaBands);
}
`;
