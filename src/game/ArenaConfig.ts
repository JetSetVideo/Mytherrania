// The arena parameter model.
//
// Everything about a match's space is a named parameter with a documented range,
// grouped into forge-style categories (Space, Ground, Phases, Population, Items,
// Hazards, Atmosphere) so the arena generator can be driven from data rather than
// from branches in the engine. Halo's forge is the reference for the shape of the
// grouping: a small set of top-level categories, each holding objects and values
// that can be placed and tuned independently.
//
// Pure module: no Three.js, no DOM.

/** Top-level forge categories. */
export type ArenaCategory =
  | "space" | "ground" | "phases" | "population" | "items" | "hazards" | "atmosphere";

export interface ParamSpec {
  key: string;
  category: ArenaCategory;
  min: number;
  max: number;
  /** Value used when the parameter is not specified. */
  def: number;
  /** Human-readable units, for the UI and the manifest. */
  unit: string;
  /** Why the range is what it is — surfaced in the docs and the manifest. */
  note: string;
}

/**
 * The complete parameter list. `size` runs from a 2 m^2 closet to a 40 m field,
 * which is the range the brief asks for.
 */
export const PARAMS: ParamSpec[] = [
  // --- space -------------------------------------------------------------
  { key: "size", category: "space", min: 2, max: 320, def: 12, unit: "m", note: "across the playable field: a 2 m closet to a 320 m field" },
  { key: "walls", category: "space", min: 0, max: 1, def: 1, unit: "bool", note: "solid perimeter that blocks movement and bounces bodies" },
  { key: "wallChance", category: "space", min: 0, max: 1, def: 0.9, unit: "0..1", note: "how often a generated arena has walls at all; the brief asks for 90%" },
  { key: "wallResistance", category: "space", min: 100, max: 20000, def: 2200, unit: "N s", note: "momentum a wall absorbs before it is breached; heavy fast bodies break through" },
  { key: "wallHeight", category: "space", min: 0.4, max: 14, def: 0.9, unit: "m", note: "BASE height of the perimeter wall (the wall plan's baseHeight, src/game/arena/walls.ts): the rules scale it per segment; wave J lowered the random roll from 1.4..6 m to mostly 0.4..1.6 m" },
  { key: "wallBounce", category: "space", min: 0, max: 1, def: 0.3, unit: "0..1", note: "restitution of the wall material; 0 deadens, 1 is a trampoline" },
  { key: "ceiling", category: "space", min: 0, max: 30, def: 0, unit: "m", note: "0 = open sky; >0 caps the field and traps thrown bodies" },
  { key: "pitDepth", category: "space", min: 0, max: 40, def: 10, unit: "m", note: "how far below the rim a ringed-out body falls before landing" },
  { key: "rimHeight", category: "space", min: 0, max: 4, def: 0.6, unit: "m", note: "lip around the platform; higher lip means a harder ring-out" },
  // --- ground ------------------------------------------------------------
  { key: "ground", category: "ground", min: 0, max: 3, def: 0, unit: "enum", note: "0 stone, 1 sand, 2 ice, 3 wood" },
  { key: "groundBlend", category: "ground", min: 0, max: 1, def: 0.4, unit: "0..1", note: "how much the rim material differs from the centre" },
  { key: "walkable", category: "ground", min: 0, max: 1, def: 1, unit: "bool", note: "the field is a surface bodies stand on, not a void" },
  { key: "slope", category: "ground", min: 0, max: 1, def: 0, unit: "0..1", note: "radial tilt; 0 is flat, 1 is a cone" },
  { key: "platforms", category: "ground", min: 0, max: 12, def: 0, unit: "count", note: "raised blocks to stand on and fall from" },
  // --- phases ------------------------------------------------------------
  { key: "roamSeconds", category: "phases", min: 0, max: 120, def: 6, unit: "s", note: "the opening truce: friendly for the first half, neutral for the second; no attacks" },
  { key: "aggression", category: "phases", min: 0, max: 1, def: 0, unit: "0..1", note: "agitation at t=0; the roam phase ends when this reaches 1" },
  { key: "aggressionRate", category: "phases", min: 0, max: 1, def: 1, unit: "per s", note: "how fast agitation climbs; at 1/roamSeconds the phase ends on time" },
  { key: "timeLimit", category: "phases", min: 0, max: 600, def: 90, unit: "s", note: "0 = no limit" },
  { key: "suddenDeath", category: "phases", min: 0, max: 1, def: 0, unit: "bool", note: "after the limit, damage escalates until someone falls" },
  // --- population --------------------------------------------------------
  { key: "fighters", category: "population", min: 2, max: 8, def: 2, unit: "count", note: "two is a duel; more is a brawl" },
  { key: "aiLevel", category: "population", min: 0, max: 1, def: 0.6, unit: "0..1", note: "reaction speed and decision quality of the bots" },
  { key: "senses", category: "population", min: 0, max: 5, def: 5, unit: "count", note: "how many of the five senses are enabled (0 = omniscient)" },
  { key: "helmet", category: "population", min: 0, max: 1, def: 0, unit: "0..1", note: "0 bare head, 1 full helm: muffles hearing, narrows sight" },
  // --- items -------------------------------------------------------------
  { key: "itemRate", category: "items", min: 0, max: 10, def: 1, unit: "per min", note: "how often an attractor drops" },
  { key: "coinSize", category: "items", min: 0.2, max: 3, def: 1, unit: "m", note: "coin diameter; the brief asks for a big coin" },
  { key: "coinPop", category: "items", min: 0, max: 12, def: 4, unit: "m", note: "height the coin pops to before it falls" },
  { key: "coinGravity", category: "items", min: 0, max: 40, def: 18, unit: "m/s^2", note: "how fast the coin comes back down" },
  { key: "coinGreed", category: "items", min: 0, max: 1, def: 0.35, unit: "0..1", note: "chance a fighter breaks off a fight to chase a coin" },
  // --- hazards -----------------------------------------------------------
  { key: "hazardRate", category: "hazards", min: 0, max: 10, def: 0, unit: "per min", note: "environmental events per minute" },
  { key: "wind", category: "hazards", min: 0, max: 1, def: 0.2, unit: "0..1", note: "steady push, and it bends projectile flight" },
  { key: "friction", category: "hazards", min: 0, max: 2, def: 1, unit: "x", note: "scales surface grip: 0 is frictionless, 2 is glue" },
  // --- atmosphere --------------------------------------------------------
  { key: "hour", category: "atmosphere", min: 0, max: 24, def: 12, unit: "h", note: "world clock; drives sun, moons, shadow length" },
  { key: "cloud", category: "atmosphere", min: 0, max: 1, def: 0.35, unit: "0..1", note: "cloud cover; dims shadows and desaturates light" },
  { key: "place", category: "atmosphere", min: 0, max: 3, def: 0, unit: "enum", note: "which of the island paths this fight is on" },
  // --- shape & terrain ---------------------------------------------------
  { key: "shape", category: "space", min: 0, max: 7, def: 0, unit: "enum", note: "ring outline: circle, triangle, square, pentagon, hexagon, octagon, oval, diamond" },
  { key: "aspect", category: "space", min: 0.4, max: 2.5, def: 1, unit: "x", note: "stretch on the z axis; 1 is regular, 2 is a long oval" },
  { key: "rotation", category: "space", min: 0, max: 360, def: 0, unit: "deg", note: "spin of the ring outline, so a triangle need not point north" },
  // --- outside ground ----------------------------------------------------
  { key: "outsideGround", category: "ground", min: 0, max: 1, def: 1, unit: "bool", note: "solid ground beyond the ring instead of a void to fall into" },
  { key: "outsideCollision", category: "ground", min: 0, max: 1, def: 1, unit: "bool", note: "bodies collide with that ground rather than sinking through it" },
  { key: "outsideHeight", category: "ground", min: -20, max: 20, def: -1, unit: "m", note: "how far the outside ground sits below the ring; 0 is flush" },
  { key: "outsideFriction", category: "ground", min: 0, max: 2, def: 0.9, unit: "x", note: "grip on the outside ground; lower means it slides" },
  // --- glider ------------------------------------------------------------
  { key: "glider", category: "space", min: 0, max: 1, def: 0, unit: "bool", note: "fighters carry a glider and can glide from height" },
  { key: "glideSpeed", category: "space", min: 2, max: 30, def: 9, unit: "m/s", note: "forward speed while gliding" },
  { key: "glideSink", category: "space", min: 0.2, max: 12, def: 2.4, unit: "m/s", note: "how fast a glide loses height" },
  { key: "updraft", category: "space", min: 0, max: 20, def: 4, unit: "m/s", note: "lift available in an updraft column" },
  { key: "glideFuel", category: "space", min: 0, max: 30, def: 6, unit: "s", note: "how long a glide can be held" },
  { key: "gliderPads", category: "ground", min: 0, max: 8, def: 0, unit: "count", note: "launch pads placed on the ring" },
  // --- objects -----------------------------------------------------------
  { key: "objects", category: "ground", min: 0, max: 40, def: 0, unit: "count", note: "props scattered on the ring: pillars, ramps, crates, rocks, arches" },
  { key: "objectSpread", category: "ground", min: 0, max: 1, def: 0.75, unit: "0..1", note: "how far out the props are placed; 0 hugs the centre" },
  // --- wall rules (wave J, src/game/arena/walls.ts) -----------------------
  { key: "wallRule", category: "space", min: 0, max: 7, def: 2, unit: "enum", note: "primary wall rule: 0 none, 1 low, 2 full, 3 ruin, 4 battlement, 5 gates, 6 half, 7 towers (WALL_RULE_KINDS order)" },
  { key: "wallRule2", category: "space", min: -1, max: 7, def: -1, unit: "enum", note: "second rule combined with the first (same enum); -1 = no second rule" },
  { key: "wallRule3", category: "space", min: -1, max: 7, def: -1, unit: "enum", note: "third rule (same enum); -1 = none; ignored when wallRule2 is -1" },
  { key: "wallMix", category: "space", min: 0, max: 0.9, def: 0.4, unit: "0..1", note: "weight of the secondary rules (split evenly between them); the primary keeps 1 - mix" },
  { key: "wallCombine", category: "space", min: 0, max: 3, def: 0, unit: "enum", note: "how rules combine per angle: 0 blend (weighted mean), 1 max, 2 min, 3 sectors (each rule owns an arc sized by its weight)" },
  { key: "wallTall", category: "space", min: 0.6, max: 3.5, def: 2.4, unit: "m", note: "peak height of the tall parts (towers, merlons); 3.5 m is the tallest wall any rule builds" },
  { key: "wallLow", category: "space", min: 0.3, max: 0.9, def: 0.45, unit: "m", note: "height of the knee-high curb (low rule, crenels, the wall between towers); under 0.6 m a knocked body trips over it" },
  { key: "wallGap", category: "space", min: 0, max: 0.9, def: 0.35, unit: "0..1", note: "ruin rule: the noise cut, i.e. roughly the share of the rim that has fallen" },
  { key: "wallGate", category: "space", min: 15, max: 120, def: 30, unit: "deg", note: "gates rule: angular width of each opening (15 deg = two segments, so a 32-ray digest always sees it)" },
  { key: "wallPeriod", category: "space", min: 4, max: 12, def: 6, unit: "segments", note: "battlement rule: merlon + crenel period, snapped to a divisor of the 48 segments (4, 6, 8, 12)" },
  { key: "wallTowers", category: "space", min: 2, max: 12, def: 4, unit: "count", note: "towers rule: number of tall towers spaced evenly round the rim" },
  { key: "wallArc", category: "space", min: 30, max: 300, def: 180, unit: "deg", note: "half rule: span of the walled arc" },
  { key: "wallArcCentre", category: "space", min: -180, max: 180, def: 0, unit: "deg", note: "half rule: centre of the walled arc relative to the gate direction (perpendicular to the spawn line)" },
  // --- symmetry and start zones (wave J, src/game/arena/symmetry.ts, spawns.ts) ---
  { key: "symmetry", category: "space", min: 0, max: 4, def: 0, unit: "enum", note: "map symmetry: 0 none, 1 mirror (one axis), 2 mirror2 (two perpendicular axes), 3 point (central), 4 rotational" },
  { key: "symmetryOrder", category: "space", min: 1, max: 6, def: 1, unit: "count", note: "rotational order: 3..6 for rotational maps (1 none/mirror, 2 mirror2/point)" },
  { key: "symmetryAxis", category: "space", min: 0, max: 180, def: 0, unit: "deg", note: "mirror axis bearing (CCW from +x); the phase of the pattern for point/rotational maps; snapped to the outline's own axes" },
  { key: "spawnAngle", category: "population", min: 0, max: 360, def: 180, unit: "deg", note: "bearing of seat 0's start zone on an asymmetric map (180 = -x, the engine's old player spot); symmetric maps derive it from the axis" },
  { key: "spawnDistance", category: "population", min: 1, max: 30, def: 2.5, unit: "m", note: "start zone centre's distance from the arena centre, capped at 0.4 x the smallest ring radius" },
  { key: "spawnZone", category: "population", min: 0.5, max: 6, def: 1.5, unit: "m", note: "radius of each seat's start area; capped at 0.25 x the smallest ring radius" },
];

export const PARAM_BY_KEY: Record<string, ParamSpec> = Object.fromEntries(PARAMS.map((p) => [p.key, p]));

/** Clamp one value into its declared range. Unknown keys pass through untouched. */
export function clampParam(key: string, value: number): number {
  const spec = PARAM_BY_KEY[key];
  if (!spec) return value;
  return Math.max(spec.min, Math.min(spec.max, value));
}

export interface ArenaConfig {
  size: number; walls: number; wallChance: number; wallResistance: number; wallHeight: number; wallBounce: number;
  ceiling: number; pitDepth: number; rimHeight: number;
  ground: number; groundBlend: number; walkable: number; slope: number; platforms: number;
  roamSeconds: number; aggression: number; aggressionRate: number; timeLimit: number; suddenDeath: number;
  fighters: number; aiLevel: number; senses: number; helmet: number;
  itemRate: number; coinSize: number; coinPop: number; coinGravity: number; coinGreed: number;
  hazardRate: number; wind: number; friction: number;
  hour: number; cloud: number; place: number;
  // Shape, terrain and movement
  shape: number; aspect: number; rotation: number;
  outsideGround: number; outsideCollision: number; outsideHeight: number; outsideFriction: number;
  glider: number; glideSpeed: number; glideSink: number; updraft: number; glideFuel: number; gliderPads: number;
  objects: number; objectSpread: number;
  // Wall rules (wave J)
  wallRule: number; wallRule2: number; wallRule3: number; wallMix: number; wallCombine: number;
  wallTall: number; wallLow: number; wallGap: number; wallGate: number; wallPeriod: number; wallTowers: number;
  wallArc: number; wallArcCentre: number;
  // Symmetry and start zones (wave J)
  symmetry: number; symmetryOrder: number; symmetryAxis: number;
  spawnAngle: number; spawnDistance: number; spawnZone: number;
}

export const DEFAULT_ARENA: ArenaConfig = Object.fromEntries(
  PARAMS.map((p) => [p.key, p.def]),
) as unknown as ArenaConfig;

/** Half-width of the field in metres (the parameter is the full span). */
export function halfSize(cfg: ArenaConfig): number {
  return cfg.size / 2;
}

/** Fill a config from a partial, clamping everything into range. */
export function makeArena(over: Partial<ArenaConfig> = {}): ArenaConfig {
  const cfg = { ...DEFAULT_ARENA };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    (cfg as unknown as Record<string, number>)[k] = clampParam(k, v);
  }
  return cfg;
}

// ---------------------------------------------------------------------------
// Ring shape: the ring is not always a circle.
// ---------------------------------------------------------------------------

export type RingShape = "circle" | "triangle" | "square" | "pentagon" | "hexagon" | "octagon" | "oval" | "diamond";

/** Index order matches the `shape` parameter's enum range. */
export const RING_SHAPES: RingShape[] = ["circle", "triangle", "square", "pentagon", "hexagon", "octagon", "oval", "diamond"];

const SHAPE_SIDES: Record<RingShape, number> = {
  circle: 0, triangle: 3, square: 4, pentagon: 5, hexagon: 6, octagon: 8, oval: 0, diamond: 4,
};

export function shapeOf(cfg: ArenaConfig): RingShape {
  // Clamp to a valid index and never let a non-finite shape through: a NaN or
  // out-of-range index falls back to a circle rather than producing an undefined
  // shape and a NaN radius downstream (which would corrupt a body's position).
  const idx = Number.isFinite(cfg.shape) ? Math.round(cfg.shape) : 0;
  return RING_SHAPES[Math.max(0, Math.min(RING_SHAPES.length - 1, idx))];
}

/**
 * Distance from the centre to the ring's edge, in a direction. Regular polygons use
 * the apothem/cosine form, the oval uses the polar ellipse, the diamond the
 * L1 (taxicab) form. `aspect` stretches the z axis and `rotation` spins the whole
 * outline.
 */
export function ringRadiusAt(cfg: ArenaConfig, angle: number): number {
  const half = halfSize(cfg);
  const az = half * cfg.aspect;
  const th = angle + (cfg.rotation * Math.PI) / 180;
  const shape = shapeOf(cfg);
  switch (shape) {
    case "circle":
      return half;
    case "oval": {
      const c = Math.cos(th), s = Math.sin(th);
      return 1 / Math.hypot(c / half, s / az);
    }
    case "diamond": {
      const c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th));
      return 1 / (c / half + s / az);
    }
    default: {
      const n = SHAPE_SIDES[shape];
      // Apothem from the smaller radius, so a stretched polygon still fits inside.
      const apothem = Math.min(half, az) * Math.cos(Math.PI / n);
      const seg = (Math.PI * 2) / n;
      const a = ((th % seg) + seg) % seg;
      return apothem / Math.cos(a - seg / 2);
    }
  }
}

/**
 * The outline's OWN symmetry group (wave J): the rotations and mirror axes that map the ring
 * onto itself. A map symmetry must be a subgroup of this, or the props/walls/terrain would be
 * symmetric while the edge they sit on is not.
 *   circle (and an oval/diamond of aspect 1 that is a circle/square): continuous / D4
 *   regular n-gon: rotations by 360/n, mirror axes at k·180/n − rotation (vertices and edge midpoints)
 *   oval, diamond (aspect ≠ 1): rotation order 2, axes at −rotation and −rotation + 90
 * `axesDeg` are bearings in [0, 180) (CCW from +x). `rotOrder` 0 means continuous (any order).
 */
export interface RingSymmetry { rotOrder: number; axesDeg: number[]; continuous: boolean }

export function ringSymmetry(cfg: ArenaConfig): RingSymmetry {
  const shape = shapeOf(cfg);
  const norm = (d: number) => ((d % 180) + 180) % 180;
  const rot = Number.isFinite(cfg.rotation) ? cfg.rotation : 0;
  const unit = Math.abs(cfg.aspect - 1) < 1e-9;
  if (shape === "circle" || (shape === "oval" && unit)) return { rotOrder: 0, axesDeg: [], continuous: true };
  let n: number;
  if (shape === "oval") n = 2;
  else if (shape === "diamond") n = unit ? 4 : 2;
  else n = SHAPE_SIDES[shape];
  // An n-gon has n axes every 180/n deg; the D2 shapes have 2 axes (0 and 90), the square-diamond 4.
  const axes: number[] = [];
  const count = shape === "oval" || shape === "diamond" ? (unit ? 4 : 2) : n;
  for (let k = 0; k < count; k++) axes.push(norm((k * 180) / count - rot));
  return { rotOrder: n, axesDeg: axes, continuous: false };
}

/** Is a world point inside the ring outline? */
export function insideRing(cfg: ArenaConfig, x: number, z: number): boolean {
  const dist = Math.hypot(x, z);
  if (dist < 1e-6) return true;
  return dist <= ringRadiusAt(cfg, Math.atan2(z, x));
}

/**
 * The wall parameters a body collides with. Whether a wall EXISTS is decided once,
 * by randomArena (walls = 1 in wallChance = 90% of arenas, else 0); the engine reads
 * cfg.walls. Resistance is what makes heavy fast bodies interesting: a light fighter
 * rebounds off it, a juggernaut can breach it.
 */
export function wallFor(cfg: ArenaConfig) {
  return {
    resistance: cfg.wallResistance,
    height: cfg.wallHeight,
    restitution: cfg.wallBounce,
  };
}

// ---------------------------------------------------------------------------
// Objects placed on the ring.
// ---------------------------------------------------------------------------

export type ObjectKind = "pillar" | "ramp" | "platform" | "crate" | "rock" | "arch" | "tree" | "gliderPad";

export interface ArenaObject {
  kind: ObjectKind;
  x: number; z: number;
  /** Height above the ring floor. */
  y: number;
  rotation: number;
  scale: number;
  /** Solid objects block movement; decorative ones do not. */
  solid: boolean;
}

const OBJECT_SIZES: Record<ObjectKind, { h: number; r: number; solid: boolean }> = {
  pillar:    { h: 3.2, r: 0.45, solid: true },
  ramp:      { h: 0.9, r: 1.6, solid: true },
  platform:  { h: 1.4, r: 1.8, solid: true },
  crate:     { h: 0.8, r: 0.5, solid: true },
  rock:      { h: 0.9, r: 0.8, solid: true },
  arch:      { h: 3.6, r: 1.9, solid: true },
  tree:      { h: 3.0, r: 0.7, solid: true },
  gliderPad: { h: 0.2, r: 1.1, solid: false },
};

export function objectSize(kind: ObjectKind) {
  return OBJECT_SIZES[kind];
}

/**
 * Scatter props inside the ring. Keeps clear of the centre spawn lane and of each
 * other, so nothing spawns inside a fighter or inside another prop.
 */
export function placeObjects(cfg: ArenaConfig, rng: () => number): ArenaObject[] {
  const out: ArenaObject[] = [];
  const kinds: ObjectKind[] = ["pillar", "ramp", "platform", "crate", "rock", "arch", "tree"];
  const pads = Math.round(cfg.gliderPads);
  const count = Math.round(cfg.objects);
  const centreClear = 2.2;

  const tryPlace = (kind: ObjectKind): boolean => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const angle = rng() * Math.PI * 2;
      // Bias toward the rim as objectSpread rises.
      const t = 0.25 + 0.7 * cfg.objectSpread * rng();
      const r = ringRadiusAt(cfg, angle) * t;
      if (r < centreClear) continue;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const size = OBJECT_SIZES[kind];
      const clash = out.some((o) => {
        const os = OBJECT_SIZES[o.kind];
        return Math.hypot(o.x - x, o.z - z) < (size.r + os.r) * 1.15;
      });
      if (clash) continue;
      out.push({
        kind, x, z, y: 0, rotation: rng() * Math.PI * 2, scale: 0.8 + rng() * 0.5, solid: size.solid,
      });
      return true;
    }
    return false;
  };

  for (let i = 0; i < count; i++) tryPlace(kinds[Math.floor(rng() * kinds.length) % kinds.length]);
  for (let i = 0; i < pads; i++) tryPlace("gliderPad");
  return out;
}

/**
 * A deterministic pseudo-random arena. `rng` returns 0..1; pass a seeded one for
 * reproducible generation. Named presets are blended in so "random" still lands on
 * playable spaces rather than absurd corners of the parameter space.
 */
/** Half a wall segment, deg (360 / 48 / 2): mirror axes on this lattice map the 48 wall segments onto themselves. */
export const SYMMETRY_LATTICE_DEG = 3.75;

/**
 * A symmetric arena's outline must have one of its own mirror axes ON the wall-segment lattice, or
 * the 48 wall segments cannot be mirrored onto each other (measured: 28 % of off-lattice mirror
 * plans were asymmetric by up to 3 m). rollWaveJ aligns it, but an override merged after the roll
 * (a menu choice, a batch condition, a QA nextArena) undoes that — so snap here, after the merge:
 * rotate the outline by at most half a lattice step (≤ 1.875°) so the axis at −rotation is on it.
 */
export function snapSymmetryRotation(cfg: ArenaConfig): ArenaConfig {
  if (!(cfg.symmetry >= 1) || shapeOf(cfg) === "circle") return cfg;
  const rot = Number.isFinite(cfg.rotation) ? cfg.rotation : 0;
  const L = SYMMETRY_LATTICE_DEG;
  const r = ((rot % L) + L) % L;
  const snapped = r <= L / 2 ? rot - r : rot + (L - r);
  return { ...cfg, rotation: ((snapped % 360) + 360) % 360 };
}

export function randomArena(rng: () => number, over: Partial<ArenaConfig> = {}): ArenaConfig {
  const pick = (a: number, b: number) => a + rng() * (b - a);
  const roll = rng();
  // 90% of generated arenas have a perimeter wall (wallChance), rolled exactly once.
  const walled = rng() < DEFAULT_ARENA.wallChance;
  const preset: Partial<ArenaConfig> = roll < 0.3
    // closet: tiny, walled, no room to run
    ? { size: pick(2, 5), walls: 1, ceiling: pick(2.5, 4), platforms: 0, itemRate: 4, coinSize: 0.4, wind: 0 }
    // pit: a narrow ledge over a long drop
    : roll < 0.65
    ? { size: pick(6, 14), walls: 0, pitDepth: pick(14, 40), rimHeight: 0.2, wind: pick(0, 0.3) }
    // field: the standard arena, possibly with platforms
    : { size: pick(14, 120), walls: 1, ceiling: 0, platforms: Math.round(pick(0, 8)), wind: pick(0, 0.6) };
  const kind: "closet" | "pit" | "field" = roll < 0.3 ? "closet" : roll < 0.65 ? "pit" : "field";
  const base: Partial<ArenaConfig> = {
    ...preset,
    hour: pick(0, 24),
    cloud: pick(0, 1),
    place: Math.floor(pick(0, 4)) % 4,
    ground: Math.floor(pick(0, 4)) % 4,
    // The truce is fixed at the brief's 6 s (3 friendly + 3 neutral); not randomised.
    roamSeconds: 6,
    coinPop: pick(2, 8),
    coinGreed: pick(0.1, 0.6),
    // Shape variety: every outline is reachable, and a third of arenas are stretched.
    shape: Math.floor(pick(0, RING_SHAPES.length)) % RING_SHAPES.length,
    aspect: rng() < 0.66 ? 1 : pick(0.5, 2.2),
    rotation: pick(0, 360),
    // Solid ground outside is the default; a quarter of arenas keep the void.
    outsideGround: rng() < 0.75 ? 1 : 0,
    outsideCollision: 1,
    outsideHeight: pick(-6, 0),
    // Gliders in about half the arenas, with pads to launch from.
    glider: rng() < 0.5 ? 1 : 0,
    gliderPads: rng() < 0.5 ? Math.round(pick(1, 4)) : 0,
    // Props scale with the size of the field.
    objects: Math.round(pick(0, 14)),
    objectSpread: pick(0.4, 1),
    // Walls: 90% of arenas, with resistance spread across a wide band so some walls
    // stop a juggernaut and others let it through.
    walls: walled ? 1 : 0,
    wallChance: 0.9,
    wallResistance: pick(900, 9000),
    // The old wallHeight draw (1.4..6 m) is consumed and discarded so wallBounce keeps its
    // value per seed; the height now comes from rollWaveJ (wallHeight = the plan's base).
    wallBounce: (rng(), pick(0.1, 0.55)),
  };
  // Wave J: drastically lower, rule-combined walls, a symmetry roll and start zones. They draw
  // from their OWN stream (one draw from this one, after every legacy draw), so every legacy
  // value above keeps its per-seed value.
  const wave = rollWaveJ(waveJStream(rng), kind, { shape: base.shape!, aspect: base.aspect!, rotation: base.rotation! });
  return snapSymmetryRotation(makeArena({ ...base, ...wave, ...over }));
}

/** A child stream for the wave J rolls: one draw from the parent, then an independent generator. */
function waveJStream(rng: () => number): () => number {
  let a = (Math.floor(rng() * 4294967296) ^ 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rule index draws (WALL_RULE_KINDS order: none low full ruin battlement gates half towers). */
const RULE_WEIGHTS_FIELD = [0.1, 0.19, 0.1, 0.15, 0.1, 0.12, 0.08, 0.16];
/** Pits are ledges over a drop: their rims are mostly open or curbed. */
const RULE_WEIGHTS_PIT = [0.26, 0.23, 0.02, 0.2, 0.04, 0.12, 0.07, 0.06];

function weighted(rng: () => number, w: readonly number[]): number {
  const total = w.reduce((a, b) => a + b, 0);
  let u = rng() * total;
  for (let i = 0; i < w.length; i++) { u -= w[i]; if (u < 0) return i; }
  return w.length - 1;
}

/** Shapes whose outline admits each symmetry (circle always does). */
const SYMMETRY_SHAPES: Record<string, number[]> = {
  mirror: [0, 1, 2, 3, 4, 5, 6, 7],
  mirror2: [0, 2, 4, 5, 6, 7],
  point: [0, 2, 4, 5, 6, 7],
  r3: [0, 1, 4],
  r4: [0, 2, 5],
  r5: [0, 3],
  r6: [0, 4],
};

/**
 * The wave J part of a random arena:
 *   walls  base height 0.4 + 1.2·u^1.5 m (median ≈ 0.82 m; closets 0.8..1.6 m, always a full wall);
 *          1 rule 45%, 2 rules 40%, 3 rules 15%; combine blend 30 / max 25 / min 20 / sectors 25%
 *          (15 / 45 / 10 / 30% when a rule is towers or battlement, so their tall parts survive);
 *          tall parts (towers, merlons) 1.6..3.5 m, curb 0.3..0.9 m.
 *   symmetry  none 40%, mirror 20%, mirror2 10%, point 15%, rotational 15% (order 3..6 uniform).
 *          The outline is made compatible: an incompatible shape is replaced by a compatible
 *          one, the mirror axis is snapped to the 3.75° segment lattice and the outline rotated so
 *          one of its own axes lies on it (aspect forced to 1 for rotational orders above 2).
 *   spawns    seat 0 bearing uniform, start-zone distance 2.5..5 m, zone radius 1..2.5 m.
 */
function rollWaveJ(rng: () => number, kind: "closet" | "pit" | "field", outline: { shape: number; aspect: number; rotation: number }): Partial<ArenaConfig> {
  const pick = (a: number, b: number) => a + rng() * (b - a);
  const out: Partial<ArenaConfig> = {};
  // ---- walls
  if (kind === "closet") {
    Object.assign(out, { wallHeight: pick(0.8, 1.6), wallRule: 2, wallRule2: -1, wallRule3: -1, wallMix: 0, wallCombine: 0 });
  } else {
    const w = kind === "pit" ? RULE_WEIGHTS_PIT : RULE_WEIGHTS_FIELD;
    const nRules = rng() < 0.45 ? 1 : rng() < 0.727 ? 2 : 3;
    out.wallHeight = 0.4 + 1.2 * Math.pow(rng(), 1.5);
    out.wallRule = weighted(rng, w);
    out.wallRule2 = nRules >= 2 ? weighted(rng, w) : -1;
    out.wallRule3 = nRules >= 3 ? weighted(rng, w) : -1;
    out.wallMix = pick(0.2, 0.6);
    // Tall parts (towers 7, battlement 4) survive a max or a sector, not a blend or a min: a plan
    // holding one combines max/sectors more often so the occasional tall part is really there.
    const tallRule = [out.wallRule, out.wallRule2, out.wallRule3].some((k) => k === 4 || k === 7);
    out.wallCombine = weighted(rng, tallRule ? [0.15, 0.45, 0.1, 0.3] : [0.3, 0.25, 0.2, 0.25]);
  }
  out.wallTall = pick(1.6, 3.5);
  out.wallLow = pick(0.3, 0.9);
  out.wallGap = pick(0.15, 0.7);
  out.wallGate = pick(15, 60);
  out.wallPeriod = [4, 6, 8, 12][Math.floor(rng() * 4) % 4];
  out.wallTowers = 2 + Math.floor(rng() * 7);
  out.wallArc = pick(90, 270);
  out.wallArcCentre = pick(-180, 180);
  // ---- symmetry
  const s = weighted(rng, [0.4, 0.2, 0.1, 0.15, 0.15]);
  const order = s === 4 ? 3 + Math.floor(rng() * 4) % 4 : s === 2 || s === 3 ? 2 : 1;
  const axisStep = 3.75; // half a wall segment (360 / 48 / 2): reflections then map segments onto segments
  const axis = (Math.floor(rng() * 48) % 48) * axisStep;
  let { shape, aspect, rotation } = outline;
  if (s > 0) {
    const key = s === 1 ? "mirror" : s === 2 ? "mirror2" : s === 3 ? "point" : `r${order}`;
    const ok = SYMMETRY_SHAPES[key];
    if (!ok.includes(shape)) shape = ok[Math.floor(rng() * ok.length) % ok.length];
    // Rotational orders above 2 need a regular outline: an oval/diamond only has order 2.
    if (s === 4) aspect = 1;
    // Put one of the outline's own axes on the map axis (axes sit at k·180/n − rotation).
    if (shape !== 0) rotation = ((-axis % 360) + 360) % 360;
  }
  Object.assign(out, { shape, aspect, rotation, symmetry: s, symmetryOrder: order, symmetryAxis: axis });
  // ---- start zones
  out.spawnAngle = pick(0, 360);
  out.spawnDistance = pick(2.5, 5);
  out.spawnZone = pick(1, 2.5);
  return out;
}
