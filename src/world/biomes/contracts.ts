// Surroundings contract: what lies around and below the arena, shared by the biome
// generator (lane S), the arena physics / ring-out / ragdoll (lane R) and the engine.
// Written by the parent BEFORE the lanes start; new fields must be OPTIONAL.
//
// Frame: world metres, +y up, the ring centred on the origin; time in seconds.
//
// Lane S implements (src/world/biomes/Biomes.ts):
//   export function chooseBiome(cfg: ArenaConfig, place: string, rng: () => number): BiomeSpec;
//   export function createSurroundings(spec: BiomeSpec, field: Heightfield | null, ringRadius: number): Surroundings;
// and the graphics (src/graphics/biomes/**): buildSurroundingsMesh(s: Surroundings, ...) with update(t).
// Lane R consumes Surroundings in physics: a body outside the ring falls until it meets
// `surfaceAt`, and the medium decides what happens (land, splash and sink, burn, crash
// through branches, fall forever).

/** The biomes the user asked for: water (still to wavy), grass/hills, magma, clouds, tree tops. */
export type BiomeKind = "water" | "meadow" | "hills" | "magma" | "clouds" | "canopy" | "void";

/** What a falling body meets below the ring. */
export type Medium =
  | "ground"   // solid: land, take fall damage, stop
  | "water"    // liquid: splash, drag, buoyancy, sink slowly (drowning)
  | "magma"    // liquid that burns: heavy damage over time, slow sink
  | "canopy"   // branches: break the fall in steps (drag), then ground far below
  | "cloud"    // no support: fall forever
  | "void";    // no support: fall forever

/** Parameters the generator rolls (all derived from the arena + place + seed). */
export interface BiomeSpec {
  kind: BiomeKind;
  seed: number;
  /** Height of the outside surface relative to the ring floor at the rim, m (negative = below). */
  surfaceDrop: number;
  /** Water/magma: 0 still .. 1 storm. Waves' amplitude, length and speed derive from it. */
  agitation?: number;
  /** Hills/meadow: relief amplitude, m. */
  relief?: number;
  /** Canopy: tree-top density 0..1 and the ground depth under the canopy, m. */
  density?: number;
  groundDepth?: number;
  /** Radius out to which the surroundings are modelled and drawn, m. */
  extent: number;
}

/** The live surroundings: queried by physics every frame, drawn by graphics. */
export interface Surroundings {
  spec: BiomeSpec;
  /** Surface height at (x, z, t) — waves move with t. NaN where there is nothing (void, cloud). */
  surfaceAt(x: number, z: number, t: number): number;
  /** The medium found at (x, z) when a body reaches the surface there. */
  mediumAt(x: number, z: number): Medium;
  /** Linear drag per second inside the medium (water ~2, magma ~4, canopy ~1.5, ground/void 0). */
  drag(medium: Medium): number;
  /** Buoyancy as a fraction of gravity inside the medium (water ~0.9, magma ~1.1, others 0). */
  buoyancy(medium: Medium): number;
  /** Damage per second (in class-attack-power units) while immersed (magma high, water 0). */
  hazardDps(medium: Medium): number;
  /** Below this world y a body is lost for good (void/cloud fall-through), m. */
  killPlaneY: number;
}

/**
 * Ring-out rule (lane R): a body whose centre leaves the ring outline and drops more than
 * RING_OUT_DROP below the rim (or touches a liquid/void surface) is ELIMINATED: the match
 * ends with the other fighter as the winner, reason "ringout", and the eliminated body
 * enters its ragdoll state (it keeps falling under physics until it settles or passes the
 * kill plane). Walls stop bodies that were inside and are low enough; a breached wall or a
 * body thrown over the wall top can ring out.
 */
export interface RingOutEvent {
  fighter: "player" | "opponent";
  medium: Medium;
  /** Where and how fast the body left the ring. */
  x: number; z: number; speed: number;
  time: number;
}
