// Spectator / generative match generator (lane H-E, Wave H).
//
// A spectator match is AI vs AI, so neither fighter is authored by a player: the
// generator invents BOTH from ONE seed — a level each, the stat-point budget each
// level is worth, how that budget is spent across the six primaries under a role
// bias, the techniques the spent stats unlock, and the arena size. It is pure and
// total, so replaying the seed replays the whole card, and the parent can log it
// into the match record's GenerationBlock (BRIEF 1.4).
//
// The user's spoken brief, decoded: "random levels ... define the statistics with
// the maximum point load and techniques being influenced by those statistics" —
// i.e. level -> budget -> per-stat spend -> techniques, all from one seed.
//
// Pure module: no THREE.js, no DOM, no global state, no Math.random. The
// determinism discipline (mix32 + mulberry32) is copied from TrainingRuns.ts.

import type { ClassName } from "./Stats.ts";
import type { StatName } from "./Races.ts";
import { SKILLS_BY_CLASS } from "./Skills.ts";
import { generationId } from "./MatchHistory.ts";

/** The six primaries, in canonical order. Used everywhere a stable order is needed. */
const STATS: readonly StatName[] = [
  "vitality",
  "resilience",
  "willpower",
  "reflex",
  "strength",
  "intelligence",
];

// ---------------------------------------------------------------------------
// Level <-> budget. A linear, integer grid so budgetForLevel and levelForBudget
// are an exact inverse pair (the round trip the UI shows).
// ---------------------------------------------------------------------------

/** Level 1 is worth this many stat points: enough to shift a starting fighter. */
export const LEVEL1_BUDGET = 12;
/**
 * Points a level adds over level 1. `Leveling.ts` carries no point-per-level rule
 * (its derived-stats/levelUp path was removed; it only holds the level-1 sheet),
 * so there is no second rule to reuse — this is the single point budget source.
 */
export const POINTS_PER_LEVEL = 6;
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 20;

/**
 * Per-stat cap: no allocation may put more than this into one primary. Stated so
 * a 10 000 budget cannot overflow a stat box (it caps at 6 * PER_STAT_CAP).
 */
export const PER_STAT_CAP = 60;

/** Arena size band, matching the repo's field preset (ArenaConfig.ts: pick(14,120)). */
export const ARENA_SIZE_MIN = 14;
export const ARENA_SIZE_MAX = 120;

/**
 * Clamp a level into [1, 20]. A non-finite level clamps to the range end it is
 * past (Infinity -> 20, -Infinity -> 1); only NaN has no side and falls to 1.
 * Never returns NaN.
 */
function clampLevel(level: number): number {
  if (Number.isNaN(level)) return MIN_LEVEL;
  return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(level)));
}

/** The point budget a level is worth. Level 1 = LEVEL1_BUDGET, level 20 = the max. */
export function budgetForLevel(level: number): number {
  return LEVEL1_BUDGET + (clampLevel(level) - 1) * POINTS_PER_LEVEL;
}

/** The level a budget implies: the exact inverse of budgetForLevel within the grid. */
export function levelForBudget(budget: number): number {
  const maxBudget = budgetForLevel(MAX_LEVEL);
  const minBudget = budgetForLevel(MIN_LEVEL);
  if (Number.isNaN(budget)) return MIN_LEVEL;
  const b = Math.max(minBudget, Math.min(maxBudget, budget));
  return Math.round((b - LEVEL1_BUDGET) / POINTS_PER_LEVEL) + 1;
}

// ---------------------------------------------------------------------------
// Deterministic hashing (copied from TrainingRuns.ts — same discipline).
// ---------------------------------------------------------------------------

/** Integer avalanche mix (Murmur3-style finalizer); maps any int to a uint32. */
function mix32(x: number): number {
  let h = x >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h >>> 0;
}

/** Small, fast seeded generator (mulberry32): a uint32 seed -> a stream in [0,1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Budget spending, biased by role.
// ---------------------------------------------------------------------------

/** A leaned stat draws this many times a neutral one, per point. */
const LEAN_WEIGHT = 3;
const NEUTRAL_WEIGHT = 1;
/** Per-point jitter on the weights: enough variance for variety, never enough to
 *  let a neutral stat out-draw a leaned one (leaned min 2.55 > neutral max 1.45). */
const JITTER_LO = 0.85;
const JITTER_SPAN = 0.3;

/** Which primaries each class leans on (mirrors PRIMARY in Stats.ts). */
const LEAN: Record<ClassName, readonly StatName[]> = {
  Barbarian: ["vitality", "strength"],
  Warrior: ["vitality", "strength"],
  Rogue: ["reflex"],
  Assassin: ["reflex"],
  Mage: ["intelligence", "willpower"],
  Necromancer: ["intelligence", "willpower"],
  Archer: ["reflex", "resilience"],
  Priest: ["willpower", "resilience"],
};

/**
 * Spend `budget` points across the six primaries, biased by `role`, using `rng`
 * for the draw. The indivisible step is 1 point, so — unless the per-stat cap
 * binds — the spent points sum EXACTLY to the budget (remainder 0 < 1). A budget
 * past 6 * PER_STAT_CAP leaves the overflow unspent, with every stat at the cap.
 *
 * Monotone by construction: for one rng stream, a larger budget only appends
 * points to the same fixed sequence, so no stat's total ever goes down.
 */
export function spendBudget(
  budget: number,
  role: ClassName,
  rng: () => number,
): Record<StatName, number> {
  const b = Number.isFinite(budget) ? Math.max(0, Math.floor(budget)) : 0;
  // Cap the work and the total: the allocator can never place more than 6 caps.
  const n = Math.min(b, STATS.length * PER_STAT_CAP);
  const lean = LEAN[role] ?? [];
  const weights = STATS.map((s) => (lean.includes(s) ? LEAN_WEIGHT : NEUTRAL_WEIGHT));
  const counts = STATS.map(() => 0);

  for (let p = 0; p < n; p++) {
    // Jitter the weights every point so the ordering varies seed to seed while the
    // role bias stays dominant.
    let total = 0;
    const w = weights.map((base) => {
      const x = base * (JITTER_LO + JITTER_SPAN * rng());
      total += x;
      return x;
    });
    const r = rng() * total;
    let acc = 0;
    let pick = STATS.length - 1;
    for (let i = 0; i < STATS.length; i++) {
      acc += w[i];
      if (r < acc) {
        pick = i;
        break;
      }
    }
    // A capped stat cannot take the point; move deterministically to the first
    // uncapped one. This is what keeps a 10 000 budget inside the per-stat cap
    // while still summing to min(budget, 6 * cap).
    if (counts[pick] >= PER_STAT_CAP) {
      pick = counts.findIndex((c) => c < PER_STAT_CAP);
      if (pick < 0) break; // every stat capped: the overflow stays unspent
    }
    counts[pick]++;
  }

  const spent = {} as Record<StatName, number>;
  for (let i = 0; i < STATS.length; i++) spent[STATS[i]] = counts[i];
  return spent;
}

// ---------------------------------------------------------------------------
// Techniques the stats unlock.
// ---------------------------------------------------------------------------

/**
 * Points a primary must carry before it unlocks its signature technique. A single
 * documented threshold (step 1) keeps the mapping deterministic and the unlocked
 * set monotone in the budget.
 */
export const TECH_THRESHOLD = 3;

/**
 * The technique each primary unlocks when spent heavily. A reflex-spent fighter
 * gets a mobility dash, a strength-spent one the power strike, and so on — all
 * REAL ids from Skills.ts. The table is total over the six primaries, so the same
 * spent map always yields the same list.
 */
const SIGNATURE: Record<StatName, string> = {
  reflex: "rogue-shadowstep", // mobility
  strength: "barbarian-skullsplitter", // power
  intelligence: "mage-arcane-nova", // arcane power
  willpower: "priest-smite", // holy
  vitality: "warrior-bulwark", // sustain
  resilience: "necro-bone-armor", // defense
};

/**
 * The class's own three skill ids, or a sane default for an unknown class.
 * A generated fighter must ALWAYS be able to use its class moves, so an unknown
 * class falls back to the Warrior's three skills rather than throwing.
 */
function baseSkills(className: string): string[] {
  const known = SKILLS_BY_CLASS[className as ClassName];
  if (known && known.length === 3) return known.map((s) => s.id);
  return ["warrior-dash", "warrior-crushing-blow", "warrior-bulwark"];
}

/**
 * The techniques a spent stat block unlocks: the class's own three skills, plus
 * the signature technique of every primary that reached TECH_THRESHOLD, ranked by
 * how much was spent (ties break by canonical stat order), deduped and capped at
 * six. Always 3..6 ids; never throws.
 */
export function techniquesFor(spent: Record<StatName, number>, className: string): string[] {
  const unlocked: { stat: StatName; value: number }[] = [];
  for (const s of STATS) {
    const v = spent[s] ?? 0;
    if (Number.isFinite(v) && v >= TECH_THRESHOLD) unlocked.push({ stat: s, value: v });
  }
  // Array.prototype.sort is stable, so equal values keep the canonical stat order.
  unlocked.sort((a, b) => b.value - a.value);

  const out = baseSkills(className);
  for (const u of unlocked) {
    if (out.length >= 6) break;
    const id = SIGNATURE[u.stat];
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The card.
// ---------------------------------------------------------------------------

/** One fighter's generation row: the level, the budget, the spend and the skills. */
export interface SpecRow {
  level: number; // 1..20
  budget: number; // stat points the generator may spend
  spent: Record<StatName, number>;
  techniques: string[]; // technique ids unlocked by the spent stats
  arenaSize: number; // m
  seed: number;
}

/** The whole generated match: two levels, two budgets, one arena, one id. */
export interface SpectateCard {
  seed: number;
  levelA: number;
  levelB: number;
  budgetA: number;
  budgetB: number;
  arenaSize: number;
  generationId: string;
}

// The generation id is lane H-D's MatchHistory.generationId (BRIEF 1.4): a stable
// "GEN-" + 6 hex digit id from the seed alone. Imported, not re-implemented, so
// the card's id matches the match record's id byte for byte.

/** Draw an integer level in [lo, hi] inclusive. Assumes lo <= hi. */
function drawLevel(lo: number, hi: number, rng: () => number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/**
 * One seed -> one card. Both levels are drawn inside the (clamped) level band and
 * are allowed to differ; the arena size is drawn from the field band; the budgets
 * come from levelForBudget's inverse pair; the id is the generation id.
 */
export function generateSpectateCard(
  seed: number,
  opts: { levelMin?: number; levelMax?: number } = {},
): SpectateCard {
  const a = clampLevel(opts.levelMin ?? MIN_LEVEL);
  const b = clampLevel(opts.levelMax ?? MAX_LEVEL);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);

  const rng = mulberry32(mix32(seed >>> 0));
  const levelA = drawLevel(lo, hi, rng);
  const levelB = drawLevel(lo, hi, rng);
  const arenaSize = ARENA_SIZE_MIN + rng() * (ARENA_SIZE_MAX - ARENA_SIZE_MIN);

  return {
    seed,
    levelA,
    levelB,
    budgetA: budgetForLevel(levelA),
    budgetB: budgetForLevel(levelB),
    arenaSize,
    generationId: generationId(seed),
  };
}
