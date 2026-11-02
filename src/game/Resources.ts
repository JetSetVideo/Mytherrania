// Mana and stamina: the two spendable pools a fighter draws on. Mana pays for
// casted powers, stamina for physical ones, and stamina can be emptied into an
// EXHAUSTED state that only lifts once it has regenerated past a wake fraction.
//
// Pure module: no Three.js, no DOM. Every entry point is total — bad input is
// sanitised to a finite, non-negative number, so a pool can never become NaN or
// negative, and regen is frame-rate independent (scaled by dt).

import type { CombatStats } from "./Stats.ts";
import { raceAffinity } from "./Races.ts";

export type ResourceKind = "mana" | "stamina";

/** One spendable pool. `regenPerSecond` is carried here so regen needs no stat lookup. */
export interface ResourcePool {
  current: number;
  max: number;
  regenPerSecond: number;
  /**
   * Wave Y (C-POT): the ceiling regen and grants may refill `current` to this match
   * (Potential.withPotentials writes it). Absent = `max`, so every pre-Wave-Y caller is unchanged.
   */
  potential?: number;
}

/** The refill ceiling of a pool: its potential when set (never above max), else its max. */
export function refillCap(pool: ResourcePool): number {
  const max = finite(pool.max);
  return pool.potential === undefined ? max : Math.min(max, finite(pool.potential));
}

export interface ResourceState {
  mana: ResourcePool;
  stamina: ResourcePool;
  /** Set when stamina empties; cleared once stamina climbs back above the wake fraction. */
  exhausted: boolean;
}

/**
 * How each pool is shaped. Both maxima are LINEAR AND INCREASING in a primary
 * attribute, so one point of the governing stat always buys more resource:
 *   mana    <- intelligence
 *   stamina <- vitality
 * Regen is per second; `regenResources` applies it against dt.
 *
 * Wave J: regeneration is no longer one flat number. It is computed from the fighter:
 *   manaRegen    = 1.2 · manaFlow(race, sub-race) · f(focus)  · gear
 *   staminaRegen = 5.0 · endurance(race, sub-race) · f(resilience) · gear
 *   f(s) = clamp(1 + 0.03 · (s − 5), 0.7, 1.6)       gear = 1 + 0.1 · quality (0..1)
 * Class and level enter through the primaries (focus, resilience) the stats carry. Mana was
 * 3 /s flat: a 20-mana power every 6.7 s from regen alone, a full low-INT pool back in 16 s, so a
 * caster never ran dry inside a 180 s match. At 1.2 /s a human warrior (FOC 5, max 72) refills
 * from empty in 60 s — one third of the match limit — and a power costs ~17 s of regen.
 */
const RESOURCE_TABLE: Record<ResourceKind, {
  stat: keyof CombatStats;
  base: number;
  perPoint: number;
  regenPerSecond: number;
  /** The primary that scales regen (the pool's "recovery" stat). */
  regenStat: keyof CombatStats;
}> = {
  mana: { stat: "intelligence", base: 40, perPoint: 8, regenPerSecond: 1.2, regenStat: "focus" },
  stamina: { stat: "vitality", base: 50, perPoint: 6, regenPerSecond: 5, regenStat: "resilience" },
};

/** Mana regen per second before Wave J (flat, every fighter): kept for the before/after tables. */
export const LEGACY_MANA_REGEN = 3;
/** Regen gained per point of the recovery stat above/below 5, and its clamp. */
export const REGEN_PER_POINT = 0.03;
export const REGEN_STAT_CLAMP: readonly [number, number] = [0.7, 1.6];
/** Regen bonus of the best gear (quality 1); quality 0 adds nothing. */
export const GEAR_REGEN_BONUS = 0.1;

/** Who the pools belong to: ancestry and gear. Absent = a human with no gear bonus. */
export interface ResourceContext {
  race?: string | null;
  subrace?: string | null;
  /** Gear quality 0..1. */
  gear?: number;
}

/** The pool maxima and regen rates a fighter gets (the numbers createResources uses). */
export interface ResourceRates {
  manaMax: number;
  manaRegen: number;
  staminaMax: number;
  staminaRegen: number;
}

function recovery(stat: number): number {
  const v = Number.isFinite(stat) ? stat : 5;
  return Math.max(REGEN_STAT_CLAMP[0], Math.min(REGEN_STAT_CLAMP[1], 1 + REGEN_PER_POINT * (v - 5)));
}

/** Pool maxima and regen for a stat block and its owner (pure, total). */
export function resourceRates(stats: CombatStats, ctx: ResourceContext = {}): ResourceRates {
  const aff = raceAffinity(ctx.race ?? "human", ctx.subrace ?? null);
  const q = Number.isFinite(ctx.gear) ? Math.max(0, Math.min(1, ctx.gear!)) : 0;
  const gear = 1 + GEAR_REGEN_BONUS * q;
  const regen = (kind: ResourceKind, flow: number) =>
    RESOURCE_TABLE[kind].regenPerSecond * flow * recovery(stats[RESOURCE_TABLE[kind].regenStat]) * gear;
  return {
    manaMax: resourceMax("mana", stats),
    manaRegen: regen("mana", aff.manaFlow),
    staminaMax: resourceMax("stamina", stats),
    staminaRegen: regen("stamina", aff.endurance),
  };
}

/** Stamina regen multiplier while exhausted (heavy, but non-zero — you do recover). */
export const EXHAUST_REGEN_MUL = 0.35;
/** Fraction of max stamina that must be regained before exhaustion lifts. */
export const EXHAUST_RECOVER_FRACTION = 0.25;

/** Coerce any input to a finite, non-negative number. */
function finite(v: number): number {
  return Number.isFinite(v) ? Math.max(0, v) : 0;
}

/** The maximum of a pool for a stat block — linear and increasing in its stat. */
function resourceMax(kind: ResourceKind, stats: CombatStats): number {
  const spec = RESOURCE_TABLE[kind];
  return spec.base + finite(stats[spec.stat]) * spec.perPoint;
}

/**
 * Build a full resource state from a combat-stat block and (Wave J) its owner: race, sub-race
 * and gear set the regen rates (resourceRates). Without a context the fighter reads as a human
 * with no gear bonus, so an un-wired caller still gets the lowered mana regen.
 */
export function createResources(stats: CombatStats, ctx: ResourceContext = {}): ResourceState {
  const r = resourceRates(stats, ctx);
  return {
    mana: { current: r.manaMax, max: r.manaMax, regenPerSecond: r.manaRegen },
    stamina: { current: r.staminaMax, max: r.staminaMax, regenPerSecond: r.staminaRegen },
    exhausted: false,
  };
}

/**
 * Recompute the exhaustion flag from the stamina pool. Exhaustion is entered the
 * moment stamina reaches 0 and only lifted once stamina has regenerated up to
 * EXHAUST_RECOVER_FRACTION of the maximum — so a single tick at the floor does
 * not instantly clear it.
 */
function withExhaustion(state: ResourceState): ResourceState {
  const { current, max } = state.stamina;
  const woke = state.exhausted && current >= max * EXHAUST_RECOVER_FRACTION;
  return { ...state, exhausted: current <= 0 || (state.exhausted && !woke) };
}

/** Regenerate both pools over `dt` seconds, clamped into [0, max]. Pure. */
export function regenResources(state: ResourceState, dt: number): ResourceState {
  const step = finite(dt);
  const regen = (pool: ResourcePool, kind: ResourceKind): ResourcePool => {
    const mul = kind === "stamina" && state.exhausted ? EXHAUST_REGEN_MUL : 1;
    const grown = finite(pool.current) + finite(pool.regenPerSecond) * mul * step;
    // Wave Y: regen fills only up to the potential (and never pulls a current above it down here:
    // Potential.withPotentials owns that clamp).
    const cap = Math.max(refillCap(pool), Math.min(finite(pool.max), finite(pool.current)));
    return { ...pool, current: Math.min(cap, Math.max(0, grown)) };
  };
  return withExhaustion({
    ...state,
    mana: regen(state.mana, "mana"),
    stamina: regen(state.stamina, "stamina"),
  });
}

/**
 * Grant `amount` of `kind` to a pool, clamped at its maximum — the inverse of `trySpend`
 * and the entry point an instant pickup needs. Without this the module could only spend
 * and regenerate over time, so "a mana orb restores 25 mana now" was inexpressible.
 *
 * Negative and non-finite amounts are treated as zero, so a grant can never drain a pool.
 * Granting stamina runs the exhaustion rule, so a draught that refills past the wake
 * fraction also lifts exhaustion.
 */
export function grantResource(state: ResourceState, kind: ResourceKind, amount: number): ResourceState {
  const pool = state[kind];
  const filled: ResourcePool = {
    ...pool,
    current: Math.min(Math.max(refillCap(pool), Math.min(finite(pool.max), finite(pool.current))), finite(pool.current) + finite(amount)),
  };
  return withExhaustion(kind === "mana" ? { ...state, mana: filled } : { ...state, stamina: filled });
}

/**
 * Try to spend `cost` of `kind`. Returns the updated state on success, or `null`
 * when the power is refused (cost exceeds the pool, or the cost is not a finite
 * number). A zero-cost power always succeeds; a negative cost is clamped to zero
 * so it can never refund.
 */
export function trySpend(state: ResourceState, kind: ResourceKind, cost: number): ResourceState | null {
  const pool = state[kind];
  const amount = Number.isFinite(cost) ? Math.max(0, cost) : Number.NaN;
  if (Number.isNaN(amount) || amount > pool.current) return null;
  const spent: ResourcePool = { ...pool, current: Math.max(0, finite(pool.current) - amount) };
  return withExhaustion(kind === "mana" ? { ...state, mana: spent } : { ...state, stamina: spent });
}
