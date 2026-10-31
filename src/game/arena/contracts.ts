// Wave J contract: arena walls by combined rules, symmetric maps and spawns, the arena digest the
// AI reads, and the full-condition match record the batch "back end" writes. FROZEN for the lanes
// (J-T terrain, J-B balance/batch): code against these types; the parent owns this file.
// Pure: types and constants only (no THREE, no DOM, no Math.random).
import type { ArenaConfig } from "../ArenaConfig.ts";
import type { ClassName, CombatStats } from "../Stats.ts";

// ─── Walls ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Wall rules. A plan COMBINES 1..3 rules (weights sum to 1) into one height per perimeter angle:
 *   none        no wall: an open edge (ring-out possible)
 *   low         a knee-high curb, ~0.3..0.9 m (stops walking, not a hard knockback)
 *   full        a continuous wall at the plan's base height
 *   ruin        broken: heights from 1D noise along the rim, with gaps where it falls below a cut
 *   battlement  alternating high merlons and low crenels (period in segments)
 *   gates       a full wall with openings centred on the symmetry axes / spawn axis
 *   half        walls on one side only (an arc of `span` rad, centred at `centre`)
 *   towers      low wall with a few tall towers (pillars) at regular angles
 */
export type WallRuleKind = "none" | "low" | "full" | "ruin" | "battlement" | "gates" | "half" | "towers";
export const WALL_RULE_KINDS: readonly WallRuleKind[] = ["none", "low", "full", "ruin", "battlement", "gates", "half", "towers"];

export interface WallRule {
  kind: WallRuleKind;
  /** Share of this rule in the combination, 0..1 (a plan's weights sum to 1). */
  weight: number;
  /** Rule parameters (each rule documents the ones it reads; unknown keys are ignored). */
  params: Record<string, number>;
}

/** How several rules combine into one height per angle. */
export type WallCombine = "blend" | "max" | "min" | "sectors";

/** One perimeter segment (angles in rad, CCW from +x, in [0, 2π)). height 0 = an opening. */
export interface WallSegment {
  a0: number;
  a1: number;
  /** Height above the rim at this segment, m (0 = no wall here). */
  height: number;
  /** Momentum the segment absorbs before breaching, N·s. */
  resistance: number;
  /** Restitution 0..1. */
  bounce: number;
}

export interface WallPlan {
  rules: WallRule[];
  combine: WallCombine;
  /** Base height the rules scale, m (drastically lower than the old 1.4..6 m: typically 0.4..1.6). */
  baseHeight: number;
  /** Segments covering the whole perimeter in order (a gap is a segment with height 0). */
  segments: WallSegment[];
  /** Fraction of the perimeter with a wall of at least WALL_BLOCK_HEIGHT. */
  coverage: number;
  meanHeight: number;
  maxHeight: number;
}

/** A wall below this height does not stop a knocked-back body (it trips over): the ring-out line. */
export const WALL_BLOCK_HEIGHT = 0.6;
/** Number of segments a plan uses (the engine builds one mesh + one collision span per segment). */
export const WALL_SEGMENTS = 48;

// ─── Symmetry and spawns ──────────────────────────────────────────────────────────────────────

/**
 * Map symmetry (applied to the terrain heightfield, props, walls and spawns alike):
 *   none        asymmetric
 *   mirror      reflection across one axis through the centre at `axisDeg`
 *   mirror2     reflection across two perpendicular axes (axisDeg and axisDeg + 90)
 *   point       point (central) symmetry: (x, z) -> (−x, −z)  (= rotational order 2)
 *   rotational  rotation by 360/order degrees, order 3..6
 */
export type SymmetryKind = "none" | "mirror" | "mirror2" | "point" | "rotational";
export interface SymmetrySpec { kind: SymmetryKind; order: number; axisDeg: number }
export const NO_SYMMETRY: SymmetrySpec = { kind: "none", order: 1, axisDeg: 0 };

export interface Spawn { x: number; z: number; yaw: number }
export interface SpawnPlan {
  /** One per fighter seat (index = seat). Symmetric maps place them as images of each other. */
  spawns: Spawn[];
  /** Start AREAS (each seat's zone: centre + radius, m); a spawn lies inside its zone. */
  zones: { x: number; z: number; r: number }[];
  /** True when every spawn is the symmetry image of seat 0 (a fair start). */
  fair: boolean;
}

// ─── What the AI knows about the arena ────────────────────────────────────────────────────────

/** Directions the digest samples the rim in (k · 2π / DIGEST_DIRS from +x, CCW). */
export const DIGEST_DIRS = 32;

export interface PropDigest { x: number; z: number; r: number; h: number; solid: boolean }

/**
 * The arena as the AI (live tree, headless sim, neural policy) sees it. Everything the generator
 * decided that changes a fight: where the edge is, how high the wall is there, whether a knocked
 * body would leave the ring there, how far it falls, the obstacles, the ground and the symmetry.
 */
export interface ArenaDigest {
  size: number;
  shape: string;
  /** Distance centre -> rim per direction, m. */
  rim: number[];
  /** Wall height per direction, m (0 = open edge). */
  wallHeight: number[];
  /** 1 where a knocked-back body leaves the ring in that direction (no wall ≥ WALL_BLOCK_HEIGHT). */
  open: number[];
  /** Fraction of directions open (0 = fully walled, 1 = no wall at all). */
  openFraction: number;
  /** Drop beyond the rim, m (pit depth or the outside ground's fall; 0 = flush). */
  outsideDrop: number;
  /** A ring-out is fatal (void / deep pit) rather than a fall onto outside ground. */
  ringOutFatal: boolean;
  ceiling: number;
  props: PropDigest[];
  /** Terrain relief on the ring: min / max / mean height (m) and mean slope (rad). */
  terrain: { min: number; max: number; mean: number; slope: number };
  ground: number;
  friction: number;
  wind: number;
  symmetry: SymmetrySpec;
  spawns: SpawnPlan;
}

// ─── The full-condition record the batch back end writes ──────────────────────────────────────

/** How much strategy a fighter plays with. none = stands and swings; basic = the tree; full = tree + edge play + skills. */
export type StrategyLevel = "none" | "basic" | "full";

export interface FighterSpec {
  name: string;
  race: string;
  subrace: string | null;
  className: ClassName;
  birthsign: string | null;
  level: number;
  /** Primary-stat points allocated on top of the class/race base (StatName -> points). */
  allocated: Record<string, number>;
  /** Weapon: archetype id or "random", plus the generation seed and a 0..1 quality (gear tier). */
  weapon: { type: string; seed: number; quality: number };
  strategy: StrategyLevel;
  /** AI decision quality 0..1 (ArenaConfig.aiLevel per fighter). */
  aiLevel: number;
  /** The combat stats actually used, after race + subrace + birthsign + secondary + level + gear. */
  stats?: CombatStats;
}

export interface MatchConditions {
  /** Schema version of this record. */
  version: 1;
  seed: number;
  /** sha256 of the simulation sources (ties every result to the code that produced it). */
  codeHash: string;
  /** Which simulator: the headless back end or the real engine in a browser (spectator batch). */
  simulator: "headless" | "engine";
  arena: ArenaConfig;
  walls: WallPlan;
  symmetry: SymmetrySpec;
  digest: ArenaDigest;
  fighters: [FighterSpec, FighterSpec];
  /** Simulated seconds per real second (spectator speed-up). */
  timeScale: number;
  /** Where in the batch's design this match sits (e.g. "extreme:max-vs-min", "grid:level", "random"). */
  design: string;
  /** For gradient designs: the 0..1 position of each varied axis. */
  gradient?: Record<string, number>;
}

export type EndReason = "ko" | "ringout" | "time" | "draw" | "error";

export interface MatchOutcome {
  /** Seat index of the winner, or null for a draw / tie at the time limit. */
  winner: 0 | 1 | null;
  reason: EndReason;
  /** Simulated seconds. */
  duration: number;
  hpLeft: [number, number];
  hpFracLeft: [number, number];
  damageDealt: [number, number];
  hits: [number, number];
  swings: [number, number];
  wallHits: [number, number];
  edgeTime: [number, number];
  error?: string;
}

export interface MatchRecord {
  conditions: MatchConditions;
  outcome: MatchOutcome;
}

/** Summary of a numeric column over a batch. */
export interface ColumnStats { n: number; min: number; max: number; mean: number; median: number; p10: number; p90: number }
