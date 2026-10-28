// Mana and stamina: the two spendable pools a fighter draws on. Mana pays for
// casted powers, stamina for physical ones, and stamina can be emptied into an
// EXHAUSTED state that only lifts once it has regenerated past a wake fraction.
//
// Pure module: no Three.js, no DOM. Every entry point is total — bad input is
// sanitised to a finite, non-negative number, so a pool can never become NaN or
// negative, and regen is frame-rate independent (scaled by dt).

import type { CombatStats } from "./Stats.ts";

export type ResourceKind = "mana" | "stamina";

/** One spendable pool. `regenPerSecond` is carried here so regen needs no stat lookup. */
export interface ResourcePool {
  current: number;
  max: number;
  regenPerSecond: number;
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
 */
const RESOURCE_TABLE: Record<ResourceKind, {
  stat: keyof CombatStats;
  base: number;
  perPoint: number;
  regenPerSecond: number;
}> = {
  mana: { stat: "intelligence", base: 40, perPoint: 8, regenPerSecond: 3 },
  stamina: { stat: "vitality", base: 50, perPoint: 6, regenPerSecond: 5 },
};

const RESOURCE_KINDS: ResourceKind[] = ["mana", "stamina"];

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

/** Build a full resource state from a combat-stat block. */
export function createResources(stats: CombatStats): ResourceState {
  const pools = Object.fromEntries(
    RESOURCE_KINDS.map((kind) => {
      const max = resourceMax(kind, stats);
      return [kind, { current: max, max, regenPerSecond: RESOURCE_TABLE[kind].regenPerSecond }];
    }),
  ) as Record<ResourceKind, ResourcePool>;
  return { mana: pools.mana, stamina: pools.stamina, exhausted: false };
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
    return { ...pool, current: Math.min(finite(pool.max), Math.max(0, grown)) };
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
    current: Math.min(finite(pool.max), finite(pool.current) + finite(amount)),
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
