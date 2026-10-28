// Minimap mathematics — pure: no DOM, no THREE. Every function here is unit-tested
// in tests/minimap_math_test.ts.
//
// Coordinate systems (vocabulary used by the whole minimap):
//   world  — the arena ground plane. x = east (metres), z = south (metres).
//            NORTH is −z, the Senses.bearing convention (0° = north = −z).
//   map    — the minimap canvas, in BACKING-STORE pixels (css px × devicePixelRatio).
//            x = right, y = down; (0, 0) is the top-left corner.
//   bearing — an angle on the ground in radians, measured CLOCKWISE from north.
//            A bearing b points along the world direction (sin b, −cos b).
//   canvas angle — an angle in map pixels, measured from +x toward +y (the
//            angle CanvasRenderingContext2D.rotate and arc use; clockwise on screen).
import { clamp, clamp01, lerp } from "../../core/MathCore.ts";

/** A mutable 2-D point. As a map point: pixels (x right, y down). As a world point: x = east, y = z (south), metres. */
export interface MapPoint {
  x: number;
  y: number;
}

/** A mutable 3-vector (world: x east, y up, z south). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A mutable colour, channels 0..255. */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * How the map is oriented.
 *   north-up  — world north is always at the top of the map (no rotation).
 *   player-up — the map rotates so the player's heading points straight up.
 */
export type MapOrientation = "north-up" | "player-up";

/**
 * Everything needed to project world ground coordinates to map pixels:
 *
 *   d = (x − centreX, z − centreZ)                       world offset, metres
 *   s = R(rotation) · d                                  rotated offset, metres
 *   p = (widthPx / 2, heightPx / 2) + pixelsPerMetre · s map pixels
 *
 * where R(θ) = [[cos θ, −sin θ], [sin θ, cos θ]] is a CLOCKWISE screen rotation
 * (y points down). `cos`/`sin` cache the rotation so projection costs no trig.
 */
export interface MapFrame {
  /** Map width in backing-store pixels. */
  widthPx: number;
  /** Map height in backing-store pixels. */
  heightPx: number;
  /** World x (metres, east) drawn at the map centre. */
  centreX: number;
  /** World z (metres, south) drawn at the map centre. */
  centreZ: number;
  /** Zoom: map pixels per world metre (px/m). */
  pixelsPerMetre: number;
  /** Clockwise screen rotation applied to world offsets, radians. 0 = north-up. */
  rotation: number;
  /** cos(rotation), cached. */
  cos: number;
  /** sin(rotation), cached. */
  sin: number;
}

/** A fresh identity frame (1×1 px, 1 px/m, north-up). Allocate once, then `setFrame` every tick. */
export function createFrame(): MapFrame {
  return { widthPx: 1, heightPx: 1, centreX: 0, centreZ: 0, pixelsPerMetre: 1, rotation: 0, cos: 1, sin: 0 };
}

/** Overwrite every field of `frame` (no allocation) and return it. */
export function setFrame(
  frame: MapFrame,
  widthPx: number,
  heightPx: number,
  centreX: number,
  centreZ: number,
  pixelsPerMetre: number,
  rotation: number,
): MapFrame {
  frame.widthPx = widthPx;
  frame.heightPx = heightPx;
  frame.centreX = centreX;
  frame.centreZ = centreZ;
  frame.pixelsPerMetre = pixelsPerMetre;
  frame.rotation = rotation;
  frame.cos = Math.cos(rotation);
  frame.sin = Math.sin(rotation);
  return frame;
}

/**
 * The bearing (radians, clockwise from north = −z, in [0, 2π)) of a ground
 * direction (dirX east, dirZ south). The zero vector has no heading: returns 0 (north).
 *   bearing = atan2(dirX, −dirZ)
 */
export function headingOf(dirX: number, dirZ: number): number {
  if (dirX === 0 && dirZ === 0) return 0;
  const b = Math.atan2(dirX, -dirZ);
  return b < 0 ? b + Math.PI * 2 : b;
}

/**
 * The frame rotation for an orientation: north-up → 0; player-up → −heading,
 * which turns the heading bearing onto the map's "up" (bearing 0).
 */
export function rotationFor(orientation: MapOrientation, heading: number): number {
  return orientation === "player-up" ? -heading : 0;
}

/** Project a world ground point (x east, z south; metres) to map pixels, written into `out`. */
export function worldToMap(frame: MapFrame, x: number, z: number, out: MapPoint): MapPoint {
  const dx = x - frame.centreX, dz = z - frame.centreZ;
  out.x = frame.widthPx / 2 + (dx * frame.cos - dz * frame.sin) * frame.pixelsPerMetre;
  out.y = frame.heightPx / 2 + (dx * frame.sin + dz * frame.cos) * frame.pixelsPerMetre;
  return out;
}

/** Inverse of `worldToMap`: map pixels → world ground point (out.x = x east, out.y = z south; metres). */
export function mapToWorld(frame: MapFrame, px: number, py: number, out: MapPoint): MapPoint {
  const sx = (px - frame.widthPx / 2) / frame.pixelsPerMetre;
  const sy = (py - frame.heightPx / 2) / frame.pixelsPerMetre;
  // R(θ)ᵀ = R(−θ): undo the clockwise rotation.
  out.x = frame.centreX + sx * frame.cos + sy * frame.sin;
  out.y = frame.centreZ - sx * frame.sin + sy * frame.cos;
  return out;
}

/**
 * The canvas angle at which a world bearing appears on the map.
 * A bearing b points along world (sin b, −cos b); after the frame's rotation θ it
 * points along screen (sin(b+θ), −cos(b+θ)) = (cos φ, sin φ) with φ = b + θ − π/2.
 * In player-up mode θ = −heading, so the heading itself maps to φ = −π/2 (straight up).
 */
export function canvasAngleOf(frame: MapFrame, bearing: number): number {
  return bearing + frame.rotation - Math.PI / 2;
}

/**
 * A marker clamped to the visible map. `offMap` is true when the target lies
 * outside the inset rectangle; then (x, y) is where the ray from the map centre
 * to the target crosses that rectangle, and `angle` (canvas angle) points from
 * the centre toward the target — draw an edge arrow there.
 */
export interface EdgeMarker {
  x: number;
  y: number;
  offMap: boolean;
  /** Canvas angle from the map centre toward the target, radians. */
  angle: number;
}

/** A fresh EdgeMarker for reuse as an out-parameter. */
export function createEdgeMarker(): EdgeMarker {
  return { x: 0, y: 0, offMap: false, angle: 0 };
}

/**
 * Clamp a projected point (px, py) to the map rectangle shrunk by `insetPx` on
 * every side (so an edge arrow stays fully visible).
 *   d = p − c;  t = min(halfW / |dx|, halfH / |dy|);  edge = c + d · t   (t < 1 ⇔ off-map)
 */
export function clampToEdge(frame: MapFrame, px: number, py: number, insetPx: number, out: EdgeMarker): EdgeMarker {
  const cx = frame.widthPx / 2, cy = frame.heightPx / 2;
  const halfW = Math.max(0, cx - insetPx), halfH = Math.max(0, cy - insetPx);
  const dx = px - cx, dy = py - cy;
  out.angle = Math.atan2(dy, dx);
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (adx <= halfW && ady <= halfH) {
    out.x = px;
    out.y = py;
    out.offMap = false;
    return out;
  }
  const t = Math.min(adx > 0 ? halfW / adx : Infinity, ady > 0 ? halfH / ady : Infinity);
  out.x = cx + dx * t;
  out.y = cy + dy * t;
  out.offMap = true;
  return out;
}

/**
 * Zoom that fits a disc of `worldRadius` metres inside the map, leaving
 * `paddingFraction` of the half-size free for the frame and overlays:
 *   ppm = (mapPx / 2) · (1 − padding) / worldRadius     [px/m]
 */
export function fitPixelsPerMetre(mapPx: number, worldRadius: number, paddingFraction: number): number {
  return ((mapPx / 2) * (1 - clamp01(paddingFraction))) / Math.max(1e-3, worldRadius);
}

/**
 * Follow-mode zoom DERIVED from the fighter's sight range: the map half-size
 * shows `viewFactor` sight radii, so the vision cone always fills 1/viewFactor of
 * the map radius whatever the sense range. Never zooms out past `minPixelsPerMetre`
 * (the overview zoom), so following is always at least as close as the overview.
 *   ppm = max(minPpm, (mapPx / 2) / (sightRange · viewFactor))
 */
export function followPixelsPerMetre(mapPx: number, sightRange: number, viewFactor: number, minPixelsPerMetre: number): number {
  return Math.max(minPixelsPerMetre, mapPx / 2 / Math.max(0.5, sightRange * viewFactor));
}

// ---------------------------------------------------------------------------
// Nice numbers: 1, 2 or 5 × 10^n (the round values maps use for scale bars and
// contour intervals because they add up and halve cleanly in a reader's head).
// ---------------------------------------------------------------------------

/** The mantissas of a nice number, ascending. */
export const NICE_MANTISSAS: readonly number[] = [1, 2, 5];

/** Relative tolerance for float noise when splitting x into mantissa × 10^n. */
const NICE_EPS = 1e-9;

/** The largest nice number (1/2/5 × 10^n) that is ≤ x. Requires x > 0; returns 0 otherwise. */
export function niceFloor(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 0;
  const exponent = Math.floor(Math.log10(x) + NICE_EPS);
  const power = 10 ** exponent;
  const mantissa = (x / power) * (1 + NICE_EPS);
  const m = mantissa >= 10 ? 10 : mantissa >= 5 ? 5 : mantissa >= 2 ? 2 : 1;
  return m * power;
}

/** True when x is (within float noise) 1, 2 or 5 × 10^n. */
export function isNiceNumber(x: number): boolean {
  if (!(x > 0) || !Number.isFinite(x)) return false;
  const exponent = Math.floor(Math.log10(x) + NICE_EPS);
  const mantissa = x / 10 ** exponent;
  return [1, 2, 5, 10].some((m) => Math.abs(mantissa - m) < 1e-6 * m);
}

/**
 * Scale-bar length in metres: the largest nice number whose drawn length fits in
 * `maxBarPx` pixels at the current zoom.  metres = niceFloor(maxBarPx / ppm).
 */
export function scaleBarMetres(pixelsPerMetre: number, maxBarPx: number): number {
  return niceFloor(maxBarPx / Math.max(1e-6, pixelsPerMetre));
}

// ---------------------------------------------------------------------------
// Contours: lines of equal height at every multiple of an interval.
// ---------------------------------------------------------------------------

/** The contour-line count the interval picker aims for (inclusive bounds). */
export const CONTOUR_TARGET_MIN = 6;
export const CONTOUR_TARGET_MAX = 10;

/**
 * How many contour lines appear between two heights: the multiples k·interval
 * strictly inside (minH, maxH). A line exactly at the lowest or highest point
 * is a single dot, so it is not counted.
 */
export function contourLevelCount(minH: number, maxH: number, interval: number): number {
  if (!(interval > 0) || !(maxH > minH)) return 0;
  const first = Math.floor(minH / interval) + 1;
  const last = Math.ceil(maxH / interval) - 1;
  return Math.max(0, last - first + 1);
}

/**
 * The contour interval DERIVED from the height range: the nice number
 * (1/2/5 × 10^n metres) whose line count is closest to the target window
 * [targetMin, targetMax]; ties go to the count nearest the window's middle, then
 * to the LARGER interval (fewer, cleaner lines). Returns 0 when the range is flat
 * (no contours).
 *
 * Honest bound: consecutive nice numbers are up to 2.5× apart, so some ranges
 * (e.g. 22–30 × 10^n m) have no 1/2/5 interval inside 6–10; the picker then
 * lands one or two lines outside the window (measured in the tests).
 */
export function contourInterval(minH: number, maxH: number, targetMin = CONTOUR_TARGET_MIN, targetMax = CONTOUR_TARGET_MAX): number {
  const range = maxH - minH;
  if (!(range > 1e-6) || !Number.isFinite(range)) return 0;
  const middle = (targetMin + targetMax) / 2;
  const topExponent = Math.floor(Math.log10(range));
  let best = 0, bestMiss = Infinity, bestOffCentre = Infinity;
  // Candidates from range/1000 to range: three decades below the range covers any window ≤ 1000 lines.
  for (let e = topExponent - 3; e <= topExponent; e++) {
    for (const m of NICE_MANTISSAS) {
      const interval = m * 10 ** e;
      const n = contourLevelCount(minH, maxH, interval);
      const miss = n < targetMin ? targetMin - n : n > targetMax ? n - targetMax : 0;
      const offCentre = Math.abs(n - middle);
      // Candidates ascend, so ">=" on a full tie keeps the larger interval.
      if (miss < bestMiss || (miss === bestMiss && offCentre <= bestOffCentre)) {
        best = interval;
        bestMiss = miss;
        bestOffCentre = offCentre;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Relief: hillshade and hypsometric tint.
// ---------------------------------------------------------------------------

/** Light azimuth, radians clockwise from north: 315° = north-west, the cartographic convention (relief then reads as raised, not inverted). */
export const DEFAULT_LIGHT_AZIMUTH = (315 * Math.PI) / 180;
/** Light altitude above the horizon, radians: 45°, the standard hillshade sun. */
export const DEFAULT_LIGHT_ALTITUDE = (45 * Math.PI) / 180;
/** Ambient term: the brightness of a slope facing directly away from the light, 0..1. */
export const DEFAULT_AMBIENT = 0.35;

/**
 * Unit vector pointing TOWARD the light (world x east, y up, z south):
 *   (sin az · cos alt,  sin alt,  −cos az · cos alt)
 */
export function lightDirection(azimuth: number, altitude: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const horizontal = Math.cos(altitude);
  out.x = Math.sin(azimuth) * horizontal;
  out.y = Math.sin(altitude);
  out.z = -Math.cos(azimuth) * horizontal;
  return out;
}

/**
 * Hillshade intensity of a surface with unit normal n under unit light l:
 *   I = ambient + (1 − ambient) · max(0, n · l)          (Lambert + ambient, 0..1)
 * Brightest (I = 1) when the slope faces the light; `ambient` when it faces away.
 */
export function hillshade(nx: number, ny: number, nz: number, light: Vec3, ambient = DEFAULT_AMBIENT): number {
  const lambert = Math.max(0, nx * light.x + ny * light.y + nz * light.z);
  const a = clamp01(ambient);
  return a + (1 - a) * lambert;
}

/**
 * The surface normal from four neighbouring heights (central differences),
 * written into `out` and normalised:
 *   ∂h/∂x = (hEast − hWest) / (2·spacing),  ∂h/∂z = (hSouth − hNorth) / (2·spacing)
 *   n = normalise(−k·∂h/∂x, 1, −k·∂h/∂z)
 * `verticalExaggeration` k > 1 steepens gentle relief so it stays legible on a
 * small map (a standard cartographic z-factor). Heights and spacing in metres.
 */
export function normalFromHeights(
  hWest: number, hEast: number, hNorth: number, hSouth: number,
  spacing: number, verticalExaggeration: number, out: Vec3,
): Vec3 {
  const twoS = 2 * Math.max(1e-6, spacing);
  const nx = (-verticalExaggeration * (hEast - hWest)) / twoS;
  const nz = (-verticalExaggeration * (hSouth - hNorth)) / twoS;
  const inv = 1 / Math.hypot(nx, 1, nz);
  out.x = nx * inv;
  out.y = inv;
  out.z = nz * inv;
  return out;
}

/** One stop of a colour ramp: at normalised height `at` (0..1), colour (r, g, b) 0..255. */
export interface TintStop {
  at: number;
  r: number;
  g: number;
  b: number;
}

/**
 * Hypsometric tint ramp (low → high): moss basin, grass, olive, ochre, stone,
 * pale crest. Tuned to sit under the HUD palette (#172128 dark, #dfaa55 gold).
 */
export const HYPSOMETRIC_RAMP: readonly TintStop[] = [
  { at: 0.0, r: 46, g: 74, b: 60 },
  { at: 0.3, r: 77, g: 107, b: 69 },
  { at: 0.55, r: 122, g: 122, b: 78 },
  { at: 0.75, r: 142, g: 111, b: 74 },
  { at: 0.9, r: 168, g: 155, b: 134 },
  { at: 1.0, r: 216, g: 210, b: 196 },
];

/**
 * Colour of normalised height t (0 = lowest, 1 = highest) on a ramp, by linear
 * interpolation between the two surrounding stops; t is clamped to [0, 1].
 */
export function hypsometricTint(t: number, out: RGB, ramp: readonly TintStop[] = HYPSOMETRIC_RAMP): RGB {
  const u = clamp01(t);
  let i = 1;
  while (i < ramp.length - 1 && ramp[i].at < u) i++;
  const a = ramp[i - 1], b = ramp[i];
  const span = b.at - a.at;
  const k = span > 0 ? clamp01((u - a.at) / span) : 0;
  out.r = lerp(a.r, b.r, k);
  out.g = lerp(a.g, b.g, k);
  out.b = lerp(a.b, b.b, k);
  return out;
}

// ---------------------------------------------------------------------------
// Time-fading markers.
// ---------------------------------------------------------------------------

/**
 * Opacity of a "last seen" ghost of age `ageSeconds`: fades linearly from 1 to
 * `floor` over `lifeSeconds`, then holds at `floor` (the memory never vanishes,
 * it only grows uncertain).   α = max(floor, 1 − age / life)
 */
export function ghostAlpha(ageSeconds: number, lifeSeconds: number, floor: number): number {
  return Math.max(floor, 1 - Math.max(0, ageSeconds) / Math.max(1e-3, lifeSeconds));
}

/**
 * Progress of a hit ping, 0 at birth to 1 at death; −1 once expired (or not born).
 *   t = age / life
 */
export function pingProgress(ageSeconds: number, lifeSeconds: number): number {
  if (ageSeconds < 0 || ageSeconds >= lifeSeconds) return -1;
  return ageSeconds / lifeSeconds;
}

/** Ease-out (quadratic) for expanding rings: fast start, gentle stop. 1 − (1 − t)² */
export function easeOutQuad(t: number): number {
  const u = clamp(t, 0, 1);
  return 1 - (1 - u) * (1 - u);
}
