// Wave Y (lane P): the POTENTIAL of a pool — the ceiling a fighter can still recover to THIS match.
//
// Contract C-POT (docs/wave-y/BRIEF.md). Each pool (health | mana | stamina) is read as
//   { max, potential, current }   with   0 <= current <= potential <= max.
// `max` is the sheet (Stats / Resources); `current` is what the fighter has now (Fighter.hp,
// ResourcePool.current); `potential` is new: regeneration and every heal refill `current` only up
// to `potential`, and `potential` FALLS through three channels:
//
//   1. WOUNDS (health)   a share of every blow taken:
//        loss = WOUND_SHARE · damage · woundFactor
//        woundFactor = clamp(1 + WOUND_STRENGTH_PER_POINT · (attacker.strength − 5)
//                              − WOUND_GUARD_PER_POINT · ((vitality + resilience)/2 − 5), WOUND_FACTOR_CLAMP)
//      so a strong enemy wounds deeper and a sturdy body (vitality, resilience) shrugs more off.
//   2. ENEMY EFFECTS     while a status is on the fighter (Status.ts), a per-second drain of
//      the mana / stamina potential (STATUS_DRAIN, a share of max per second).
//   3. FATIGUE (mana, stamina) from SPENDING. Every spend is recorded; over a rolling window:
//        amount    spent in the last FATIGUE_WINDOW s, as a share of max   (free up to FREE_AMOUNT)
//        rate      spent in the last RATE_WINDOW s ÷ RATE_WINDOW, share/s   (free up to FREE_RATE)
//        frequency spends in the last FATIGUE_WINDOW s                       (free up to FREE_COUNT)
//        overload  = Σ max(0, x − free) / free   over the three measures (0 = sustainable pace)
//        loss      = min(cost, cost · FATIGUE_SHARE · overload / resist)
//      resist(stamina) = clamp(1 + RESIST_PER_POINT.stamina · (vitality − 5)) · endurance (race affinity)
//      resist(mana)    = clamp(1 + RESIST_PER_POINT.mana · (focus − 5))
//      so vitality / a race's endurance soften stamina fatigue and focus softens mana fatigue.
//
// The potential RECOVERS slowly (rest): once a pool has not been spent from / damaged / drained for
// REST_DELAY s, it climbs REST_RATE[pool] · max per second, never above max. It never falls below
// POTENTIAL_FLOOR[pool] · max (and the floor of mana/stamina sits above Resources' exhaustion wake
// fraction, so an exhausted fighter can always wake up).
//
// Pure module: no THREE, no DOM, no Math.random, no clock — time advances only through
// tickPotential(dt). The state is a small mutable record (like Status.ts) so the engine and the
// headless MatchSim (both call these SAME functions) pay no allocation per tick.

import type { StatusName } from "./Status.ts";
import type { ResourcePool, ResourceState } from "./Resources.ts";
import { raceAffinity } from "./Races.ts";

export type PoolKind = "health" | "mana" | "stamina";
export const POOL_KINDS: readonly PoolKind[] = ["health", "mana", "stamina"];
export type SpendKind = "mana" | "stamina";

/** One pool as the HUD, the AI and debugPools() read it. */
export interface PoolLevel {
  max: number;
  potential: number;
  current: number;
}

// ─── The law's constants (every number of the law is here) ─────────────────────────────────────

/** Share of the damage taken that becomes a wound (lost health potential) at a neutral matchup. */
export const WOUND_SHARE = 0.2;
/** Wound factor gained per attacker strength point above 5 (runtime scale, Stats PRIMARY). */
export const WOUND_STRENGTH_PER_POINT = 0.04;
/** Wound factor removed per point of the defender's mean (vitality, resilience) above 5. */
export const WOUND_GUARD_PER_POINT = 0.03;
export const WOUND_FACTOR_CLAMP: readonly [number, number] = [0.5, 1.6];

/** Long fatigue window (amount, frequency), s. */
export const FATIGUE_WINDOW = 8;
/** Short window for the burst rate, s. */
export const RATE_WINDOW = 2;
/** Spend that is free (no fatigue) inside the long window, share of max. */
export const FREE_AMOUNT = 0.4;
/** Burst rate that is free, share of max per second over RATE_WINDOW. */
export const FREE_RATE = 0.15;
/** Spends that are free inside the long window. */
export const FREE_COUNT = 3;
/** Share of an over-paced spend that is lost from the potential at overload 1. */
export const FATIGUE_SHARE = 0.5;
/** Fatigue resistance gained per point of the pool's resistance attribute above 5. */
export const RESIST_PER_POINT: Readonly<Record<SpendKind, number>> = { stamina: 0.04, mana: 0.05 };
export const RESIST_CLAMP: readonly [number, number] = [0.6, 1.8];

/** Per-second drain of mana / stamina potential (share of max) while an enemy status holds. */
export const STATUS_DRAIN: Readonly<Partial<Record<StatusName, Partial<Record<SpendKind, number>>>>> = {
  stunned: { stamina: 0.01, mana: 0.01 },
  hypnotised: { mana: 0.02 },
  controlled: { mana: 0.02 },
  burning: { stamina: 0.012 },
  poisoned: { stamina: 0.015 },
  chilled: { stamina: 0.015 },
  slowed: { stamina: 0.01 },
};

/** Seconds of no spend / damage / drain before a pool's potential starts to recover. */
export const REST_DELAY = 3;
/** Recovery once rested, share of max per second. */
export const REST_RATE: Readonly<Record<PoolKind, number>> = { health: 0.002, mana: 0.006, stamina: 0.008 };
/** The potential never falls below this share of max. */
export const POTENTIAL_FLOOR: Readonly<Record<PoolKind, number>> = { health: 0.25, mana: 0.4, stamina: 0.4 };

// ─── State ────────────────────────────────────────────────────────────────────────────────────

/** What softens the losses: the fighter's attributes (runtime CombatStats scale) and race endurance. */
export interface PotentialTraits {
  vitality: number;
  resilience: number;
  focus: number;
  /** Races.raceAffinity(race, subrace).endurance (1 = neutral). */
  endurance: number;
}

interface SpendEvent { t: number; amount: number }

/** Per-channel tallies of potential lost (QA, docs, AI). */
export interface LossTally { wound: number; status: number; fatigue: number; recovered: number }

export interface PotentialState {
  /** Seconds since the state was created (advanced by tickPotential only). */
  t: number;
  max: Record<PoolKind, number>;
  potential: Record<PoolKind, number>;
  traits: PotentialTraits;
  spends: Record<SpendKind, SpendEvent[]>;
  /** Time of the last loss-causing event per pool (spend, damage, drain). */
  lastStress: Record<PoolKind, number>;
  lost: Record<PoolKind, LossTally>;
}

const fin = (v: number, d = 0) => (Number.isFinite(v) ? v : d);
const nonNeg = (v: number) => Math.max(0, fin(v));
const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, fin(v, 1)));

/** A fresh state: every potential at its max. */
export function createPotential(max: Record<PoolKind, number>, traits: Partial<PotentialTraits> = {}): PotentialState {
  const m = { health: nonNeg(max.health), mana: nonNeg(max.mana), stamina: nonNeg(max.stamina) };
  const tally = (): LossTally => ({ wound: 0, status: 0, fatigue: 0, recovered: 0 });
  return {
    t: 0,
    max: m,
    potential: { ...m },
    traits: {
      vitality: fin(traits.vitality ?? 5, 5), resilience: fin(traits.resilience ?? 5, 5),
      focus: fin(traits.focus ?? 5, 5), endurance: Math.max(0.25, fin(traits.endurance ?? 1, 1)),
    },
    spends: { mana: [], stamina: [] },
    lastStress: { health: -Infinity, mana: -Infinity, stamina: -Infinity },
    lost: { health: tally(), mana: tally(), stamina: tally() },
  };
}

function floorOf(s: PotentialState, k: PoolKind): number {
  return s.max[k] * POTENTIAL_FLOOR[k];
}

/** Lower a pool's potential by `amount` (never below the floor); returns what was actually lost. */
function lower(s: PotentialState, k: PoolKind, amount: number): number {
  const a = nonNeg(amount);
  if (a <= 0) return 0;
  const next = Math.max(floorOf(s, k), s.potential[k] - a);
  const lost = Math.max(0, s.potential[k] - next);
  s.potential[k] = Math.min(s.potential[k], next);
  s.lastStress[k] = s.t;
  return lost;
}

// ─── Channel 1: wounds ────────────────────────────────────────────────────────────────────────

/** The wound factor for a blow (attacker strength vs the defender's vitality/resilience). */
export function woundFactor(traits: Pick<PotentialTraits, "vitality" | "resilience">, attackerStrength = 5): number {
  const guard = (fin(traits.vitality, 5) + fin(traits.resilience, 5)) / 2 - 5;
  return clamp(1 + WOUND_STRENGTH_PER_POINT * (fin(attackerStrength, 5) - 5) - WOUND_GUARD_PER_POINT * guard, WOUND_FACTOR_CLAMP);
}

/** A blow of `damage` HP landed: lower the health potential by its wound share. Returns the loss. */
export function woundPotential(s: PotentialState, damage: number, attackerStrength = 5): number {
  const lost = lower(s, "health", WOUND_SHARE * nonNeg(damage) * woundFactor(s.traits, attackerStrength));
  s.lost.health.wound += lost;
  // Any damage also resets the health rest clock, even when the floor ate the whole loss.
  if (nonNeg(damage) > 0) s.lastStress.health = s.t;
  return lost;
}

// ─── Channel 2: enemy effects ─────────────────────────────────────────────────────────────────

/** Drain mana / stamina potential for `dt` s under the given active statuses. Returns total loss. */
export function statusDrain(s: PotentialState, statuses: readonly StatusName[], dt: number): number {
  const step = nonNeg(dt);
  if (step <= 0 || statuses.length === 0) return 0;
  let total = 0;
  for (const name of statuses) {
    const d = STATUS_DRAIN[name];
    if (!d) continue;
    for (const k of ["mana", "stamina"] as const) {
      const rate = d[k] ?? 0;
      if (rate <= 0) continue;
      const lost = lower(s, k, rate * s.max[k] * step);
      s.lost[k].status += lost;
      total += lost;
    }
  }
  return total;
}

// ─── Channel 3: fatigue ───────────────────────────────────────────────────────────────────────

/** How a pool's spending looks right now (the three measures and their overload). */
export interface FatigueReading {
  /** Spend in the long window, share of max. */
  amount: number;
  /** Spend in the short window ÷ RATE_WINDOW, share of max per s. */
  rate: number;
  /** Spends in the long window. */
  count: number;
  /** Σ max(0, x − free)/free over the three (0 = a sustainable pace). */
  overload: number;
  /** The pool's fatigue resistance (1 = neutral). */
  resist: number;
}

/** Fatigue resistance of a pool from the traits (vitality × endurance for stamina, focus for mana). */
export function fatigueResist(traits: PotentialTraits, k: SpendKind): number {
  if (k === "stamina") return clamp(1 + RESIST_PER_POINT.stamina * (traits.vitality - 5), RESIST_CLAMP) * Math.max(0.25, traits.endurance);
  return clamp(1 + RESIST_PER_POINT.mana * (traits.focus - 5), RESIST_CLAMP);
}

/** The fatigue reading of pool `k`, optionally as if `extra` were spent now (pure: no mutation). */
export function fatigueReading(s: PotentialState, k: SpendKind, extra = 0): FatigueReading {
  const max = Math.max(1e-9, s.max[k]);
  let amount = 0, burst = 0, count = 0;
  for (const e of s.spends[k]) {
    const age = s.t - e.t;
    if (age > FATIGUE_WINDOW) continue;
    amount += e.amount; count++;
    if (age <= RATE_WINDOW) burst += e.amount;
  }
  const x = nonNeg(extra);
  if (x > 0) { amount += x; burst += x; count++; }
  const a = amount / max, r = burst / max / RATE_WINDOW;
  const over = (v: number, free: number) => Math.max(0, v - free) / free;
  return { amount: a, rate: r, count, overload: over(a, FREE_AMOUNT) + over(r, FREE_RATE) + over(count, FREE_COUNT), resist: fatigueResist(s.traits, k) };
}

/** The potential a spend of `cost` WOULD cost now (pure; the AI's look-ahead). */
export function fatigueLossFor(s: PotentialState, k: SpendKind, cost: number): number {
  const c = nonNeg(cost);
  if (c <= 0) return 0;
  const r = fatigueReading(s, k, c);
  const raw = Math.min(c, (c * FATIGUE_SHARE * r.overload) / r.resist);
  return Math.max(0, Math.min(raw, s.potential[k] - floorOf(s, k)));
}

/** Record a spend of `cost` from pool `k`: fatigue lowers the potential when over pace. Returns the loss. */
export function recordSpend(s: PotentialState, k: SpendKind, cost: number): number {
  const c = nonNeg(cost);
  if (c <= 0) return 0;
  const loss = fatigueLossFor(s, k, c);
  s.spends[k].push({ t: s.t, amount: c });
  s.lastStress[k] = s.t;
  const lost = lower(s, k, loss);
  s.lost[k].fatigue += lost;
  return lost;
}

// ─── Time ─────────────────────────────────────────────────────────────────────────────────────

/** Advance `dt` s: forget spends older than the window, and let rested pools recover toward max. */
export function tickPotential(s: PotentialState, dt: number): void {
  const step = nonNeg(dt);
  s.t += step;
  for (const k of ["mana", "stamina"] as const) {
    const ev = s.spends[k];
    let drop = 0;
    while (drop < ev.length && s.t - ev[drop].t > FATIGUE_WINDOW) drop++;
    if (drop > 0) ev.splice(0, drop);
  }
  for (const k of POOL_KINDS) {
    if (s.potential[k] >= s.max[k] || s.t - s.lastStress[k] < REST_DELAY) continue;
    const next = Math.min(s.max[k], s.potential[k] + REST_RATE[k] * s.max[k] * step);
    s.lost[k].recovered += next - s.potential[k];
    s.potential[k] = next;
  }
}

/** Change a pool's max (a level-up, a QA override): the potential keeps its share of max. */
export function setMax(s: PotentialState, k: PoolKind, max: number): void {
  const m = nonNeg(max);
  const share = s.max[k] > 0 ? s.potential[k] / s.max[k] : 1;
  s.max[k] = m;
  s.potential[k] = Math.max(m * POTENTIAL_FLOOR[k], Math.min(m, share * m));
}

// ─── Reading and enforcing the invariant ──────────────────────────────────────────────────────

/** The ceiling `current` may be refilled to (health heals, mana / stamina regen and grants). */
export function capOf(s: PotentialState, k: PoolKind): number {
  return Math.max(0, Math.min(s.max[k], s.potential[k]));
}

/** `current` clamped into [0, potential] — what every heal / regen result passes through. */
export function capCurrent(s: PotentialState, k: PoolKind, current: number): number {
  return Math.max(0, Math.min(capOf(s, k), fin(current)));
}

/** One pool's {max, potential, current} with the invariant enforced on the reading. */
export function poolLevel(s: PotentialState, k: PoolKind, current: number): PoolLevel {
  const max = nonNeg(s.max[k]);
  const potential = Math.max(0, Math.min(max, fin(s.potential[k], max)));
  return { max, potential, current: Math.max(0, Math.min(potential, fin(current))) };
}

/** All three pools for a fighter whose health is `hp` and whose resource state is `res`. */
export function poolLevels(s: PotentialState, hp: number, res: Pick<ResourceState, "mana" | "stamina"> | null | undefined): Record<PoolKind, PoolLevel> {
  return {
    health: poolLevel(s, "health", hp),
    mana: poolLevel(s, "mana", res?.mana.current ?? 0),
    stamina: poolLevel(s, "stamina", res?.stamina.current ?? 0),
  };
}

/**
 * Write the mana / stamina potentials into a ResourceState (ResourcePool.potential, which
 * Resources.regenResources / grantResource honour) and clamp each current under its potential.
 * Returns a new state; the input is untouched.
 */
export function withPotentials(res: ResourceState, s: PotentialState): ResourceState {
  const pool = (p: ResourcePool, k: SpendKind): ResourcePool => {
    const cap = Math.min(nonNeg(p.max), capOf(s, k));
    return { ...p, potential: cap, current: Math.max(0, Math.min(cap, fin(p.current))) };
  };
  return { ...res, mana: pool(res.mana, "mana"), stamina: pool(res.stamina, "stamina") };
}

/** Share of each potential still available (potential / max, 1 = untouched). */
export function potentialShare(s: PotentialState, k: PoolKind): number {
  return s.max[k] > 0 ? Math.max(0, Math.min(1, s.potential[k] / s.max[k])) : 1;
}

// ─── One constructor for the engine and the headless sim ──────────────────────────────────────

/** The traits a fighter's potential reads: its vitality / resilience / focus and its race endurance. */
export function traitsOf(
  stats: { vitality?: number; resilience?: number; focus?: number },
  race?: string | null,
  subrace?: string | null,
): PotentialTraits {
  return {
    vitality: fin(stats.vitality ?? 5, 5), resilience: fin(stats.resilience ?? 5, 5), focus: fin(stats.focus ?? 5, 5),
    endurance: raceAffinity(race ?? "human", subrace ?? null).endurance,
  };
}

/** A fighter's potential at the bell: every potential at the pool's max (Engine and MatchSim). */
export function fighterPotential(
  maxHealth: number,
  res: Pick<ResourceState, "mana" | "stamina">,
  stats: { vitality?: number; resilience?: number; focus?: number },
  race?: string | null,
  subrace?: string | null,
): PotentialState {
  return createPotential({ health: maxHealth, mana: res.mana.max, stamina: res.stamina.max }, traitsOf(stats, race, subrace));
}

/** The statuses that drain potential, from a list of active status names (dedupe-free, ordered). */
export function drainingStatuses(names: readonly StatusName[]): StatusName[] {
  return names.filter((n) => STATUS_DRAIN[n] !== undefined);
}
