// TerrainPaint: vertex colours for the arena terrain (lane E2: R07, R15), composited by
// lane B's paintVertices from a PaintStack DERIVED from the terrain's own parameters.
//
// Zones. paintVertices masks layers by the per-vertex `region` byte; on terrain that byte
// carries a PAINT ZONE (TERRAIN_ZONES), and REGIONS[zone] is only its mask label:
//   0..3   ordinary ring ground by gameplay material (Terrain.ts materialAt: stone, wood,
//          sand, ice) - exactly where the speed / slip changes, so the bands MUST read
//   4..7   ramps on stone / wood / sand / ice (material kept, wear added)
//   8 hole floor, 9 hole rim (ordinary nodes next to a hole), 10 cliff face,
//   11 skirt and seam walls, 12 outside ground (place tint), 13 outside ramps
//
// Stack, bottom-up (pattern kind / blend):
//   coats       solid / normal       one bounded coat per zone (MATERIAL_PAINT, PLACE_GROUND)
//   detail      scales / normal      stone paving, slab = 3 cells
//               stripes / normal     wood planks, period 4 cells
//               stripes / multiply   sand ripples, opacity 2 (1 - sand.speed)
//               veins / screen       ice cracks, opacity 1 - stone.stop / ice.stop
//               spots / multiply     outside tufts and stones, 3 cells
//   mottle      noise / overlay      all ground, 4 cells (breaks the vertex-colour flatness)
//   wear        solid / screen + stripes (angle 0 = CONTOURS of height) / multiply: ramp
//               treads every rampSlopeTan * 2 cells of rise (one tread per ~2 cells of run)
//   rock        noise / multiply     cliff-face grain
//   contours    stripes (angle 0) / multiply   one darker band per stepHeight of rise (strata:
//               the bands a fighter crosses count the steps climbed; flat ground shows none)
//   hypsometry  gradient(height) / softLight   cool low -> warm high, window = the ring's
//               own p20..p80 heights (the Pareto cut points)
//   slope rock  gradient(up) / multiply        darker, greyer where the slope passes the
//               feature budget tan(maxSlope) g, full at the body climb limit maxClimbTan
// then the CAVITY bake (not a paint layer, a light-like term): colour *= 1 - d clamp(L / Lref, -1, 1)
// with L the Laplacian of the height (1/m, > 0 in dips) and Lref = 2 pi rollSlope / rollWavelength
// (the curvature of the band's own rolling ground): dips up to 20% darker, crests up to 20% lighter;
// and last the RELEVANCE bound (boundVertexColours, TERRAIN_VERTEX_BOUNDS): no neon, no black, no white.
// Nyquist: every pattern scale is >= 2 cells, and the stack is painted on the heightfield's NODES
// (isotropic, one cell) and sampled bilinearly by the mesh, so the radial ring mesh (much finer
// around than along a radius near the centre) cannot smear patterns into a sunburst.
//
// Pure module: no Three.js, no DOM.
import type { MeshData, PaintLayer, PaintStack } from "./body/contracts.ts";
import { REGIONS } from "./body/contracts.ts";
import { hexToLinear, linearToSrgb, shadeHex, srgbToLinear } from "./paint/Blend.ts";
import { paintVertices } from "./paint/Layers.ts";
import type { PatternEnv } from "./paint/Patterns.ts";
import { boundColour, type ColourBounds } from "./paint/Relevance.ts";
import { materialAt, surfaceFor, type GroundMaterial } from "../game/Terrain.ts";
import { FEATURE_CLIFF, FEATURE_HOLE, FEATURE_RAMP, nearestNode, normalAt, type ArenaOutline, type Heightfield } from "../world/Heightfield.ts";
import type { OutsideSurface } from "../world/OutsideSurface.ts";
import { PARETO_TOP_FRACTION, PARETO_TOP_SHARE } from "../world/TerrainRules.ts";
import type { RingSurface } from "../world/RingSurface.ts";

/** Paint zone codes (the `region` byte of the painted MeshData). */
export const TERRAIN_ZONES = {
  stone: 0, wood: 1, sand: 2, ice: 3, rampStone: 4, rampWood: 5, rampSand: 6, rampIce: 7,
  hole: 8, rim: 9, cliff: 10, skirt: 11, outside: 12, outsideRamp: 13,
} as const;
const MATERIALS: readonly GroundMaterial[] = ["stone", "wood", "sand", "ice"];

/** Coats: chroma (sRGB max - min) 0.03..0.42 and luminance 0.03..0.62 -> no neon, no blown-out white, no colourless mud. */
export const TERRAIN_COAT_BOUNDS: ColourBounds = { chroma: [0.03, 0.42], luminance: [0.03, 0.62] };
/**
 * Every painted terrain vertex after compositing and the cavity bake: chroma <= 0.45 (lane B's
 * INK ceiling: no neon), linear luminance 0.025..0.65 (a hole floor stays a visible dark
 * brown, L* ~17; an ice crest never blows out to white under the noon sun x 1.6, L* ~84).
 */
export const TERRAIN_VERTEX_BOUNDS: ColourBounds = { chroma: [0, 0.45], luminance: [0.025, 0.65] };

/** Coat and detail colours of each gameplay material (sRGB), each with its reason. */
export const MATERIAL_PAINT: Record<GroundMaterial, { coat: string; light: string; dark: string; why: string }> = {
  stone: { coat: "#878e94", light: "#a3a9ae", dark: "#5c6268", why: "cool blue-grey slabs: the neutral, full-grip reference ground" },
  wood: { coat: "#7d4e2d", light: "#93623d", dark: "#5f3b22", why: "dark red-brown boards: grip like stone, turns a little slower" },
  sand: { coat: "#d6b46e", light: "#e6cc95", dark: "#b9985c", why: "bright ochre: the slow ground (speed 0.7) reads warm and soft" },
  ice: { coat: "#9fcfe4", light: "#e6f5fc", dark: "#79aac2", why: "pale cyan: the slippery rim (stop x2.2) reads cold" },
};
/** Feature and structure coats (sRGB). */
export const FEATURE_PAINT = {
  hole: "#4a3c2f", rim: "#5b4b3b", cliff: "#6f675f", rock: "#958d85", skirt: "#6e5a47", wear: "#c2b49a", tread: "#7a705f",
  low: "#3a4762", high: "#f2ddb0", mottleDark: "#5c5c5c", mottleLight: "#a8a8a8", contour: "#8a8178",
} as const;
/** Outside ground by PLACES id (sRGB), darker and more saturated than the valley tint the engine uses far away. */
export const PLACE_GROUND: Record<string, string> = {
  sunspire: "#9a8256", greywall: "#6b7465", verdant: "#5b7b42", frostford: "#b6c2c9",
};

/** Options for the terrain painters. */
export interface TerrainPaintOptions {
  /** Radius of the material bands, m (the engine's #ringHalf: smallest outline radius over 16 bearings). Default: that, from the outline. */
  ringHalf?: number;
  /** PLACES id for the outside tint. Default "sunspire". */
  place?: string;
  /** Bake the cavity (Laplacian) shading. Default true. */
  cavity?: boolean;
}

/** A painted surface. */
export interface TerrainPaintResult {
  /** LINEAR rgb per vertex (the surface's own colour array, overwritten). */
  colors: Float32Array;
  /** Paint zone per vertex. */
  zones: Uint8Array;
  stack: PaintStack;
}

/** The engine's ring half-width: smallest outline radius over 16 bearings (Engine.#ringHalf). */
export function ringHalfOf(outline: ArenaOutline): number {
  let r = Infinity;
  for (let i = 0; i < 16; i++) r = Math.min(r, outline.radiusAt((i / 16) * Math.PI * 2));
  return r;
}

const label = (...zones: number[]) => zones.map((z) => REGIONS[z]);
const coat = (hex: string) => boundColour(hex, TERRAIN_COAT_BOUNDS);

/** The derived terrain PaintStack (see the header for every layer and its equation). */
export function terrainPaintStack(field: Heightfield, place = "sunspire"): PaintStack {
  const r = field.rules, c = r.cell, d = PARETO_TOP_FRACTION, g = PARETO_TOP_SHARE, Z = TERRAIN_ZONES;
  const seed = (field.seed >>> 0) || 1;
  const layers: PaintLayer[] = [];
  const add = (l: Omit<PaintLayer, "seed"> & { seed?: number }) => layers.push({ seed: (seed + layers.length * 7919) >>> 0, ...l });
  const outsideCoat = coat(PLACE_GROUND[place] ?? PLACE_GROUND.sunspire);
  const all = label(Z.stone, Z.wood, Z.sand, Z.ice, Z.rampStone, Z.rampWood, Z.rampSand, Z.rampIce, Z.hole, Z.rim, Z.cliff, Z.outside, Z.outsideRamp);
  // coats
  MATERIALS.forEach((m, k) => add({ name: `coat-${m}`, pattern: "solid", colour: coat(MATERIAL_PAINT[m].coat), opacity: 1, blend: "normal", scale: 1, regions: label(k, Z.rampStone + k) }));
  add({ name: "coat-hole", pattern: "solid", colour: coat(FEATURE_PAINT.hole), opacity: 1, blend: "normal", scale: 1, regions: label(Z.hole) });
  add({ name: "coat-rim", pattern: "solid", colour: coat(FEATURE_PAINT.rim), opacity: 1, blend: "normal", scale: 1, regions: label(Z.rim) });
  add({ name: "coat-cliff", pattern: "solid", colour: coat(FEATURE_PAINT.cliff), opacity: 1, blend: "normal", scale: 1, regions: label(Z.cliff) });
  add({ name: "coat-skirt", pattern: "solid", colour: coat(FEATURE_PAINT.skirt), opacity: 1, blend: "normal", scale: 1, regions: label(Z.skirt) });
  add({ name: "coat-outside", pattern: "solid", colour: outsideCoat, opacity: 1, blend: "normal", scale: 1, regions: label(Z.outside, Z.outsideRamp) });
  // material detail, opacities from the gameplay surface where it has a meaning
  const stone = surfaceFor("stone"), sand = surfaceFor("sand"), ice = surfaceFor("ice");
  add({ name: "stone-paving", pattern: "scales", colour: MATERIAL_PAINT.stone.light, colour2: MATERIAL_PAINT.stone.dark, opacity: 0.55, blend: "normal", scale: 3 * c, regions: label(Z.stone, Z.rampStone), params: { jitter: 0.35, rim: 0.22, rimDepth: 0.6 } });
  add({ name: "wood-planks", pattern: "stripes", colour: MATERIAL_PAINT.wood.light, colour2: MATERIAL_PAINT.wood.dark, opacity: 0.6, blend: "normal", scale: 4 * c, regions: label(Z.wood, Z.rampWood), params: { angle: Math.PI / 2, width: 0.5, sharpness: 0.55, warp: 0.12, octaves: 2 } });
  add({ name: "sand-ripples", pattern: "stripes", colour: MATERIAL_PAINT.sand.dark, opacity: Math.min(1, 2 * (1 - sand.speed)), blend: "multiply", scale: 3 * c, regions: label(Z.sand, Z.rampSand), params: { angle: Math.PI / 2, width: 0.45, sharpness: 0.3, warp: 0.9, octaves: 2 } });
  add({ name: "ice-cracks", pattern: "veins", colour: MATERIAL_PAINT.ice.light, opacity: 1 - stone.stop / ice.stop, blend: "screen", scale: 6 * c, regions: label(Z.ice, Z.rampIce), params: { threshold: 0.68, sharpness: 1.4, warp: 0.5, octaves: 3 } });
  add({ name: "outside-tufts", pattern: "spots", colour: shadeHex(outsideCoat, 0.72), opacity: 0.5, blend: "multiply", scale: 3 * c, regions: label(Z.outside), params: { density: 0.45, size: 0.38, softness: 0.5 } });
  // mottle over every ground zone
  add({ name: "mottle", pattern: "noise", colour: FEATURE_PAINT.mottleDark, colour2: FEATURE_PAINT.mottleLight, opacity: 0.4, blend: "overlay", scale: 4 * c, regions: all, params: { octaves: 3, contrast: 1.3 } });
  // ramp wear: lighter, with contour treads (stripes at angle 0 band by HEIGHT)
  add({ name: "ramp-wear", pattern: "solid", colour: FEATURE_PAINT.wear, opacity: d + d / 2, blend: "screen", scale: 1, regions: label(Z.rampStone, Z.rampWood, Z.rampSand, Z.rampIce, Z.outsideRamp) });
  add({ name: "ramp-treads", pattern: "stripes", colour: FEATURE_PAINT.tread, opacity: 0.5, blend: "multiply", scale: r.rampSlopeTan * 2 * c, regions: label(Z.rampStone, Z.rampWood, Z.rampSand, Z.rampIce, Z.outsideRamp), params: { angle: 0, width: 0.35, sharpness: 0.5, warp: 0, octaves: 1 } });
  add({ name: "cliff-grain", pattern: "noise", colour: FEATURE_PAINT.rock, opacity: 0.5, blend: "multiply", scale: 2 * c, regions: label(Z.cliff), params: { octaves: 2, contrast: 1.6 } });
  // step contours: stripes at angle 0 band by HEIGHT, one dark band per stepHeight of rise, so the
  // number of bands a fighter crosses is the number of steps climbed (flat ground shows none).
  add({ name: "step-contours", pattern: "stripes", colour: FEATURE_PAINT.contour, opacity: d + d / 2, blend: "multiply", scale: r.base.stepHeight, regions: all, params: { angle: 0, width: 0.5, sharpness: 0.35, warp: 0, octaves: 1 } });
  // hypsometry over the ring's p20..p80 (the env built by paintZones maps that window to t = 0..1)
  add({ name: "hypsometry", pattern: "gradient", colour: FEATURE_PAINT.low, colour2: FEATURE_PAINT.high, opacity: 0.55, blend: "softLight", scale: 1, regions: all, params: { axis: 0, from: 0, to: 1, power: 1, invert: 0, fill: 1 } });
  // slope rock: t = 0.5 + 0.5 ny; full at the climb limit, none below the feature budget
  const tAt = (tan: number) => 0.5 + 0.5 / Math.hypot(1, tan);
  add({ name: "slope-rock", pattern: "gradient", colour: FEATURE_PAINT.rock, opacity: g, blend: "multiply", scale: 1, regions: all, params: { axis: 1, from: tAt(r.maxClimbTan), to: tAt(r.maxSlopeTan * g), power: 1, invert: 1, fill: 0 } });
  return { layers };
}

/** 1 when an 8-neighbour of node n is a hole node. */
function besideHole(f: Heightfield, n: number): boolean {
  const i = n % f.cols, j = (n - i) / f.cols;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < f.cols && b < f.rows && f.featureMask[b * f.cols + a] === FEATURE_HOLE) return true;
    }
  }
  return false;
}

/** Vertex role: what a vertex is a part of. */
export const ROLE_FLOOR = 0, ROLE_WALL = 1, ROLE_OUTSIDE = 2;

/** Paint zone of a vertex at world (x, z) with `role` (ROLE_*). */
export function terrainZoneAt(field: Heightfield, x: number, z: number, role: number, ringHalf: number): number {
  const Z = TERRAIN_ZONES;
  if (role === ROLE_WALL) return Z.skirt;
  const n = nearestNode(field, x, z), m = field.featureMask[n];
  if (m === FEATURE_HOLE) return Z.hole;
  if (m === FEATURE_CLIFF) return Z.cliff;
  if (role === ROLE_OUTSIDE) return m === FEATURE_RAMP ? Z.outsideRamp : besideHole(field, n) ? Z.rim : Z.outside;
  const mat = MATERIALS.indexOf(materialAt(x, z, ringHalf));
  if (m === FEATURE_RAMP) return Z.rampStone + mat;
  return besideHole(field, n) ? Z.rim : mat;
}

/**
 * Pull every LINEAR rgb vertex colour inside `bounds`, keeping its hue: chroma first (lerp
 * the sRGB channels toward the grey of the same luminance by cHi / C), then luminance
 * (scale the linear channels by yLo / Y or yHi / Y, channels capped at 1). In place.
 */
export function boundVertexColours(colors: Float32Array, count: number, bounds: ColourBounds = TERRAIN_VERTEX_BOUNDS): void {
  const [, cHi] = bounds.chroma, [yLo, yHi] = bounds.luminance;
  for (let v = 0; v < count; v++) {
    const o = v * 3;
    let r = colors[o], g = colors[o + 1], b = colors[o + 2];
    let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sr = linearToSrgb(r), sg = linearToSrgb(g), sb = linearToSrgb(b);
    const chroma = Math.max(sr, sg, sb) - Math.min(sr, sg, sb);
    if (chroma > cHi) {
      const grey = linearToSrgb(y), k = cHi / chroma;
      r = srgbToLinear(grey + (sr - grey) * k); g = srgbToLinear(grey + (sg - grey) * k); b = srgbToLinear(grey + (sb - grey) * k);
      y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    const k = y > yHi ? yHi / y : y < yLo ? (y > 1e-6 ? yLo / y : 0) : 1;
    if (k === 0) { r = g = b = yLo; } else if (k !== 1) { r = Math.min(1, r * k); g = Math.min(1, g * k); b = Math.min(1, b * k); }
    colors[o] = r; colors[o + 1] = g; colors[o + 2] = b;
  }
}

/** A painted copy of the heightfield grid: LINEAR rgb per node (cavity baked). */
export interface PaintedGrid {
  colors: Float32Array;
  zones: Uint8Array;
  stack: PaintStack;
}

/**
 * Paint the heightfield's NODES (not the mesh vertices) with the derived stack as `role`
 * (ROLE_FLOOR: gameplay materials everywhere; ROLE_OUTSIDE: outside ground everywhere), then
 * bake the cavity. Why nodes: the radial ring mesh samples ~10x finer around than along a
 * radius near the centre, so patterns painted per vertex smear into a radial "sunburst";
 * the grid is isotropic at one cell, the resolution every rule of the field already uses,
 * and the mesh then samples it bilinearly (sampleGridColour).
 */
export function paintTerrainGrid(field: Heightfield, role: number, options: TerrainPaintOptions, ringHalf: number): PaintedGrid {
  const count = field.cols * field.rows;
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), zones = new Uint8Array(count);
  const n = { x: 0, y: 1, z: 0 };
  for (let j = 0; j < field.rows; j++) {
    for (let i = 0; i < field.cols; i++) {
      const v = j * field.cols + i, x = field.originX + i * field.cell, z = field.originZ + j * field.cell;
      positions[v * 3] = x; positions[v * 3 + 1] = field.heights[v]; positions[v * 3 + 2] = z;
      normalAt(field, x, z, n);
      normals[v * 3] = n.x; normals[v * 3 + 1] = n.y; normals[v * 3 + 2] = n.z;
      zones[v] = terrainZoneAt(field, x, z, role, ringHalf);
    }
  }
  const stack = terrainPaintStack(field, options.place);
  const ring = field.stats.ring?.heights ?? field.stats.heights;
  const lo = ring.p20, hi = Math.max(ring.p80, ring.p20 + 1e-3), far = 1e3;
  const env: PatternEnv = {
    min: [-far, lo, -far], max: [far, hi, far], core: [0, (lo + hi) / 2, 0], maxCoreDistance: far,
    anchors: new Float64Array(REGIONS.length * 2 * 3),
  };
  const mesh: MeshData = { positions, normals, indices: new Uint32Array(0), region: zones };
  const colors = paintVertices(mesh, stack, { env });
  if (options.cavity !== false) {
    const { cols, rows, cell } = field, h = field.heights, d = PARETO_TOP_FRACTION;
    const lRef = (2 * Math.PI * field.rules.rollSlope) / Math.max(cell, field.rules.rollWavelength);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const v = j * cols + i, at = (a: number, b: number) => h[Math.min(rows - 1, Math.max(0, b)) * cols + Math.min(cols - 1, Math.max(0, a))];
        const lap = (at(i + 1, j) + at(i - 1, j) + at(i, j + 1) + at(i, j - 1) - 4 * h[v]) / (cell * cell);
        const k = 1 - d * Math.max(-1, Math.min(1, lap / lRef));
        for (let ch = 0; ch < 3; ch++) colors[v * 3 + ch] = Math.min(1, colors[v * 3 + ch] * k);
      }
    }
  }
  return { colors, zones, stack };
}

/**
 * Zone-aware bilinear sample of a painted grid's colour at world (x, z) into out[o .. o + 2]
 * (clamped to the grid): of the four surrounding nodes only those painted as `zone` count
 * (weights renormalised), so a material band edge stays as sharp as the mesh draws it
 * instead of blurring over a cell; plain bilinear when none of the four is in `zone`.
 */
export function sampleGridColour(field: Heightfield, grid: PaintedGrid, x: number, z: number, zone: number, out: Float32Array, o: number): void {
  const fx = Math.min(field.cols - 1, Math.max(0, (x - field.originX) / field.cell));
  const fz = Math.min(field.rows - 1, Math.max(0, (z - field.originZ) / field.cell));
  const i = Math.min(field.cols - 2, Math.floor(fx)), j = Math.min(field.rows - 2, Math.floor(fz));
  const tx = fx - i, tz = fz - j, n = j * field.cols + i, c = grid.colors, Z = grid.zones;
  const nodes = [n, n + 1, n + field.cols, n + field.cols + 1];
  const w = [(1 - tx) * (1 - tz), tx * (1 - tz), (1 - tx) * tz, tx * tz];
  let sum = 0;
  for (let k = 0; k < 4; k++) if (Z[nodes[k]] === zone) sum += w[k];
  const exact = sum > 1e-6;
  out[o] = out[o + 1] = out[o + 2] = 0;
  for (let k = 0; k < 4; k++) {
    const wk = exact ? (Z[nodes[k]] === zone ? w[k] / sum : 0) : w[k];
    for (let ch = 0; ch < 3; ch++) out[o + ch] += wk * c[nodes[k] * 3 + ch];
  }
}

/**
 * Colour `count` vertices: floor/outside vertices sample `grid`, wall vertices take the
 * skirt coat (the lower edge one d darker: contact shade); zones are recomputed per vertex
 * (the gameplay-exact labels the metrics use). Then the relevance bound.
 */
function colourVertices(
  field: Heightfield, grid: PaintedGrid, positions: Float32Array, roles: Uint8Array, count: number, out: Float32Array, ringHalf: number,
  wallBottom: (v: number) => boolean,
): TerrainPaintResult {
  const zones = new Uint8Array(count);
  const wall = hexToLinear(coat(FEATURE_PAINT.skirt)), d = PARETO_TOP_FRACTION;
  for (let v = 0; v < count; v++) {
    const x = positions[v * 3], z = positions[v * 3 + 2];
    zones[v] = terrainZoneAt(field, x, z, roles[v], ringHalf);
    if (roles[v] === ROLE_WALL) {
      const k = wallBottom(v) ? 1 - d : 1;
      out[v * 3] = wall[0] * k; out[v * 3 + 1] = wall[1] * k; out[v * 3 + 2] = wall[2] * k;
    } else sampleGridColour(field, grid, x, z, zones[v], out, v * 3);
  }
  boundVertexColours(out, count);
  return { colors: out, zones, stack: grid.stack };
}

/** Paint a RingSurface in place (floor + skirt): its `colors` array is overwritten (LINEAR rgb). */
export function paintTerrainSurface(field: Heightfield, outline: ArenaOutline, surface: RingSurface, options: TerrainPaintOptions = {}): TerrainPaintResult {
  const ringHalf = options.ringHalf ?? ringHalfOf(outline);
  const floorVerts = 1 + surface.layout.rings * surface.layout.segments, S = surface.layout.segments;
  const roles = new Uint8Array(surface.vertexCount);
  roles.fill(ROLE_WALL, floorVerts);
  const grid = paintTerrainGrid(field, ROLE_FLOOR, options, ringHalf);
  return colourVertices(field, grid, surface.positions, roles, surface.vertexCount, surface.colors, ringHalf, (v) => v >= floorVerts + S);
}

/** Paint an OutsideSurface in place (field rows + apron as outside ground, the seam as wall). */
export function paintOutsideSurface(field: Heightfield, outline: ArenaOutline, surface: OutsideSurface, options: TerrainPaintOptions = {}): TerrainPaintResult {
  const ringHalf = options.ringHalf ?? ringHalfOf(outline);
  const S = surface.layout.segments, seamStart = (surface.layout.bands + 2) * S;
  const roles = new Uint8Array(surface.vertexCount);
  roles.fill(ROLE_OUTSIDE, 0, seamStart);
  roles.fill(ROLE_WALL, seamStart);
  const grid = paintTerrainGrid(field, ROLE_OUTSIDE, options, ringHalf);
  const res = colourVertices(field, grid, surface.positions, roles, surface.vertexCount, surface.colors, ringHalf, () => false);
  fadeToHorizon(res.colors, S, surface.layout.bands);
  return res;
}

/**
 * Fade the outside's patterns out toward the horizon: row K and the apron take the mean
 * colour of row K, and row K - 1 goes half-way (smoothstep over the last two rows). The
 * long apron triangles then carry one colour instead of stretching each vertex's pattern
 * into a radial streak 80 m long.
 */
function fadeToHorizon(colors: Float32Array, S: number, K: number): void {
  const mean = [0, 0, 0];
  for (let j = 0; j < S; j++) for (let c = 0; c < 3; c++) mean[c] += colors[(K * S + j) * 3 + c] / S;
  for (let k = Math.max(0, K - 1); k <= K + 1; k++) {
    const t = k >= K ? 1 : 0.5;
    for (let j = 0; j < S; j++) for (let c = 0; c < 3; c++) { const i = (k * S + j) * 3 + c; colors[i] += (mean[c] - colors[i]) * t; }
  }
}
