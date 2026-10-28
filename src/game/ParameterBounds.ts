/**
 * ParameterBounds — the single declared bound for every tunable number in the game.
 *
 * Pure module: no Three.js, no DOM, zero runtime dependencies.
 *
 * This registry is the one source of truth for tunable ranges. The engine calls
 * `clampToBound(id, value)` whenever a value enters the simulation from config,
 * a debug UI, or the network, and `outOfBounds(id, value)` / `validateAll(values)`
 * for validation and test harnesses. Nothing else in the game should hard-code a
 * range for a parameter that lives here.
 */

export type BoundCategory =
  | "stats"
  | "physics"
  | "skills"
  | "senses"
  | "arena"
  | "resources"
  | "pickups"
  | "ranking"
  | "balance"
  | "body"
  | "ui";

export interface Bound {
  readonly id: string;
  readonly category: BoundCategory;
  readonly min: number;
  readonly max: number;
  readonly unit: string;
  readonly note: string;
}

export interface Violation {
  readonly id: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
}

export const BOUNDS: readonly Bound[] = [
  // ---- stats ------------------------------------------------------------
  { id: "health_scale", category: "stats", min: 1000, max: 1000, unit: "hp", note: "Base health units at level 1." },
  { id: "damage_scale", category: "stats", min: 100, max: 100, unit: "dmg", note: "Base damage units for the reference strike." },
  { id: "primary_attribute", category: "stats", min: 1, max: 10, unit: "points", note: "Per-character primary attribute. Ceiling is the real one: the highest primary any class is given is the Mage's intelligence 10 (src/game/Stats.ts PRIMARY)." },
  { id: "crit_chance", category: "stats", min: 0.03, max: 0.15, unit: "ratio", note: "Probability a hit crits." },
  { id: "crit_multiplier", category: "stats", min: 1.5, max: 3.0, unit: "x", note: "Damage multiplier on a critical hit." },
  { id: "attack_power", category: "stats", min: 0, max: 500, unit: "dmg", note: "Offensive stat contribution." },
  { id: "defense", category: "stats", min: 0, max: 500, unit: "armor", note: "Defensive stat contribution." },
  { id: "level", category: "stats", min: 1, max: 99, unit: "level", note: "Character level range." },
  { id: "xp_per_level", category: "stats", min: 100, max: 50000, unit: "xp", note: "Experience required for one level." },
  { id: "health_regen", category: "stats", min: 0, max: 50, unit: "hp/s", note: "Passive health regeneration rate." },

  // ---- physics ----------------------------------------------------------
  { id: "stun_duration", category: "physics", min: 0.05, max: 0.20, unit: "s", note: "Duration of a hit-stun window." },
  { id: "truce_duration", category: "physics", min: 6, max: 6, unit: "s", note: "Post-combat truce before aggro resumes." },
  { id: "gravity", category: "physics", min: -30, max: 0, unit: "m/s^2", note: "World gravity along the down axis." },
  { id: "max_speed", category: "physics", min: 0.5, max: 25, unit: "m/s", note: "Top locomotion speed." },
  { id: "knockback_force", category: "physics", min: 0, max: 1000, unit: "N", note: "Impulse applied on impact." },
  { id: "friction", category: "physics", min: 0, max: 1, unit: "ratio", note: "Ground friction coefficient." },
  { id: "mass", category: "physics", min: 1, max: 500, unit: "kg", note: "Rigid-body mass." },

  // ---- skills -----------------------------------------------------------
  { id: "skill_cooldown", category: "skills", min: 0, max: 120, unit: "s", note: "Time between skill activations." },
  { id: "skill_cost", category: "skills", min: 0, max: 200, unit: "resource", note: "Resource cost to cast a skill." },
  { id: "skill_rank", category: "skills", min: 1, max: 10, unit: "rank", note: "Skill upgrade rank range." },
  { id: "cast_time", category: "skills", min: 0, max: 10, unit: "s", note: "Wind-up before a skill resolves." },
  { id: "skill_range", category: "skills", min: 0, max: 60, unit: "m", note: "Maximum skill reach." },
  { id: "skill_power", category: "skills", min: 0, max: 10, unit: "x", note: "Skill damage/heal scaling factor." },
  { id: "skill_charge", category: "skills", min: 0, max: 5, unit: "s", note: "Hold time to fully charge a skill." },

  // ---- senses -----------------------------------------------------------
  { id: "sight", category: "senses", min: 42, max: 42, unit: "m", note: "Vision radius used by perception." },
  { id: "hearing", category: "senses", min: 26, max: 26, unit: "m", note: "Auditory detection radius." },
  { id: "touch", category: "senses", min: 1.1, max: 1.1, unit: "m", note: "Contact detection radius." },
  { id: "scent", category: "senses", min: 18, max: 18, unit: "m", note: "Olfactory tracking radius." },
  { id: "magnetism", category: "senses", min: 30, max: 30, unit: "m", note: "Magnetic/awareness field radius." },

  // ---- arena ------------------------------------------------------------
  { id: "arena_size", category: "arena", min: 2, max: 320, unit: "m", note: "Arena edge length." },
  { id: "wall_chance", category: "arena", min: 0, max: 1, unit: "ratio", note: "Probability a cell edge spawns a wall." },
  { id: "wall_resistance", category: "arena", min: 100, max: 20000, unit: "hp", note: "Wall hit points before it breaks." },
  { id: "obstacle_count", category: "arena", min: 0, max: 500, unit: "count", note: "Number of obstacles placed." },
  { id: "spawn_radius", category: "arena", min: 0, max: 160, unit: "m", note: "Radius within which actors spawn." },

  // ---- resources --------------------------------------------------------
  { id: "stamina_max", category: "resources", min: 10, max: 1000, unit: "points", note: "Maximum stamina pool." },
  { id: "mana_max", category: "resources", min: 0, max: 1000, unit: "points", note: "Maximum mana pool." },
  { id: "resource_regen", category: "resources", min: 0, max: 100, unit: "points/s", note: "Passive resource regeneration." },
  { id: "resource_cost", category: "resources", min: 0, max: 500, unit: "points", note: "Generic per-action resource cost." },
  { id: "stamina_cost_sprint", category: "resources", min: 0, max: 100, unit: "points/s", note: "Stamina drained while sprinting." },

  // ---- pickups ----------------------------------------------------------
  { id: "pickup_radius", category: "pickups", min: 0.1, max: 10, unit: "m", note: "Physical size of a pickup." },
  { id: "pickup_lifetime", category: "pickups", min: 0, max: 300, unit: "s", note: "Time a pickup persists; 0 = forever." },
  { id: "pickup_value", category: "pickups", min: 1, max: 1000, unit: "points", note: "Value granted when collected." },
  { id: "pickup_spawn_rate", category: "pickups", min: 0, max: 100, unit: "per/min", note: "Pickup spawn frequency." },
  { id: "pickup_magnet_radius", category: "pickups", min: 0, max: 30, unit: "m", note: "Radius within which pickups are pulled in." },

  // ---- ranking ----------------------------------------------------------
  { id: "elo_k", category: "ranking", min: 32, max: 32, unit: "k", note: "Elo rating volatility constant." },
  { id: "elo_start", category: "ranking", min: 1000, max: 1000, unit: "elo", note: "Starting rating for a new competitor." },
  { id: "elo_min", category: "ranking", min: 0, max: 0, unit: "elo", note: "Rating floor." },
  { id: "elo_max", category: "ranking", min: 4000, max: 4000, unit: "elo", note: "Rating ceiling." },
  { id: "match_rating_floor", category: "ranking", min: 0, max: 2000, unit: "elo", note: "Minimum rating used when matching." },

  // ---- balance ----------------------------------------------------------
  { id: "balance_weight_feet", category: "balance", min: 0.2, max: 0.2, unit: "weight", note: "Plate weight for the feet region." },
  { id: "balance_weight_pelvis", category: "balance", min: 0.5, max: 0.5, unit: "weight", note: "Plate weight for the pelvis region." },
  { id: "balance_weight_shoulder", category: "balance", min: 0.3, max: 0.3, unit: "weight", note: "Plate weight for the shoulder region." },
  { id: "stance_threshold_stagger", category: "balance", min: 0.7, max: 0.7, unit: "ratio", note: "Load ratio at which the actor staggers." },
  { id: "stance_threshold_kneel", category: "balance", min: 1.15, max: 1.15, unit: "ratio", note: "Load ratio at which the actor kneels." },
  { id: "stance_threshold_fall", category: "balance", min: 1.6, max: 1.6, unit: "ratio", note: "Load ratio at which the actor falls." },
  { id: "section_exponent", category: "balance", min: 1.9, max: 2.45, unit: "exp", note: "Superellipse section exponent. Floor 1.9 is the slimmest real silhouette (the elf's sectionN); ceiling 2.45 is the bloodfang's (src/game/BodyProfile.ts)." },
  { id: "difficulty_scale", category: "balance", min: 0.5, max: 5, unit: "x", note: "Global difficulty multiplier." },
  { id: "damage_variance", category: "balance", min: 0, max: 1, unit: "ratio", note: "Random damage spread around the mean." },

  // ---- body -------------------------------------------------------------
  { id: "spine_vertebrae", category: "body", min: 33, max: 33, unit: "count", note: "Vertebrae in the spine chain." },
  { id: "limb_count", category: "body", min: 2, max: 8, unit: "count", note: "Number of limbs per actor." },
  { id: "body_height", category: "body", min: 0.5, max: 4, unit: "m", note: "Actor height." },
  { id: "body_mass", category: "body", min: 1, max: 500, unit: "kg", note: "Actor mass." },
  { id: "bone_length_scale", category: "body", min: 0.5, max: 2, unit: "x", note: "Global bone length multiplier." },

  // ---- ui ---------------------------------------------------------------
  { id: "frame_budget", category: "ui", min: 16.6, max: 16.6, unit: "ms", note: "Per-frame time budget at 60 fps." },
  { id: "hud_scale", category: "ui", min: 0.5, max: 3, unit: "x", note: "HUD scaling factor." },
  { id: "camera_fov", category: "ui", min: 30, max: 120, unit: "deg", note: "Camera field of view." },
  { id: "camera_distance", category: "ui", min: 1, max: 50, unit: "m", note: "Camera follow distance." },
  { id: "minimap_zoom", category: "ui", min: 0.25, max: 4, unit: "x", note: "Minimap zoom level." },
];

const INDEX: Map<string, Bound> = (() => {
  const m = new Map<string, Bound>();
  for (const b of BOUNDS) m.set(b.id, b);
  return m;
})();

/** Look up a bound by id. Returns null when the id is unknown. */
export function bound(id: string): Bound | null {
  return INDEX.get(id) ?? null;
}

/**
 * Clamp `value` into the declared range for `id`.
 * - Unknown id: the value is returned unchanged (nothing to clamp against).
 * - Non-finite value (NaN / Infinity): falls back to the bound's midpoint.
 * - Finite value: clamped to [min, max].
 */
export function clampToBound(id: string, value: number): number {
  const b = bound(id);
  if (b === null) return value;
  if (!Number.isFinite(value)) return (b.min + b.max) / 2;
  if (value < b.min) return b.min;
  if (value > b.max) return b.max;
  return value;
}

/**
 * True when `value` falls outside the declared range for `id`.
 * Non-finite values are always out of bounds. Unknown ids are never out of bounds.
 */
export function outOfBounds(id: string, value: number): boolean {
  const b = bound(id);
  if (b === null) return false;
  if (!Number.isFinite(value)) return true;
  return value < b.min || value > b.max;
}

/** Every bound in `category`, in declaration order. */
export function boundsByCategory(category: BoundCategory): Bound[] {
  return BOUNDS.filter((b) => b.category === category);
}

/** Total number of declared bounds. */
export function parameterCount(): number {
  return BOUNDS.length;
}

/**
 * Validate a map of id -> value against the registry.
 * Returns one Violation per offending entry, in the order the keys appear.
 * Keys with no matching bound are ignored.
 */
export function validateAll(values: Record<string, number>): Violation[] {
  const violations: Violation[] = [];
  for (const id of Object.keys(values)) {
    const value = values[id];
    if (outOfBounds(id, value)) {
      const b = bound(id)!;
      violations.push({ id, value, min: b.min, max: b.max });
    }
  }
  return violations;
}
