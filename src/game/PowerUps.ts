// Map pickup and power-up system for Mytherrania.
//
// Pure module: no Three.js, no DOM, no runtime dependencies.
//
// Engine entry points (this is the whole public surface):
//   rollPickup(rng)                          -> PickupDef   weighted spawn roll
//   spawnPickups(rng, count, radius)         -> Pickup[]    place drops in a ring
//   pickupAt(pickups, x, z, fighterRadius)   -> Pickup|null nearest drop in reach
//   applyPickup(fighterBuffs, def, now)      -> ActiveBuff[] resolve stack rule
//   tickBuffs(buffs, now)                    -> ActiveBuff[] drop expired buffs
//   buffMultiplier(buffs, id)                -> number      combined multiplier
//
// Time is measured in seconds. `now` is a monotonically increasing clock value.

export type PickupKind = "resource" | "buff" | "coin";
export type StackRule = "refresh" | "stack" | "replace";

/** A spawnable pickup definition (data table row). */
export interface PickupDef {
  id: string;
  label: string;
  kind: PickupKind;
  /** Effect magnitude: heal amount, multiplier, or coin count. */
  value: number;
  /** Buff lifetime in seconds; 0 means instant (no lingering buff). */
  duration: number;
  /** Interaction radius in meters. */
  radius: number;
  /** Relative spawn probability (not a percentage; normalized at roll time). */
  weight: number;
  /** How a repeat pickup of the same id merges with an existing buff. */
  stack: StackRule;
}

/** A placed pickup in the world (XZ plane). */
export interface Pickup {
  def: PickupDef;
  x: number;
  z: number;
}

/** A live buff carried by a fighter. */
export interface ActiveBuff {
  id: string;
  value: number;
  expiresAt: number;
}

/** Deterministic-friendly source of uniform floats in [0, 1). */
export type Rng = () => number;

/** The full pickup table. Weights are relative and summed at roll time. */
export const PICKUP_KINDS: readonly PickupDef[] = [
  { id: "health_orb", label: "Health Orb", kind: "resource", value: 30, duration: 0, radius: 1.2, weight: 30, stack: "refresh" },
  { id: "mana_orb", label: "Mana Orb", kind: "resource", value: 25, duration: 0, radius: 1.2, weight: 28, stack: "refresh" },
  { id: "stamina_draught", label: "Stamina Draught", kind: "resource", value: 40, duration: 0, radius: 1.2, weight: 22, stack: "refresh" },
  { id: "rage", label: "Rage", kind: "buff", value: 1.25, duration: 12, radius: 1.5, weight: 8, stack: "stack" },
  { id: "ward", label: "Ward", kind: "buff", value: 0.75, duration: 12, radius: 1.5, weight: 8, stack: "refresh" },
  { id: "swift", label: "Swift", kind: "buff", value: 1.3, duration: 10, radius: 1.5, weight: 8, stack: "refresh" },
  { id: "focus", label: "Focus", kind: "buff", value: 1.2, duration: 15, radius: 1.5, weight: 6, stack: "replace" },
  { id: "coin", label: "Coin", kind: "coin", value: 1, duration: 0, radius: 1.0, weight: 40, stack: "stack" },
];

// ---- weighted roll ---------------------------------------------------------

const TOTAL_WEIGHT = PICKUP_KINDS.reduce((sum, d) => sum + d.weight, 0);

/** Weighted pick from PICKUP_KINDS. Always returns a table row. */
export function rollPickup(rng: Rng): PickupDef {
  let r = rng() * TOTAL_WEIGHT;
  for (const def of PICKUP_KINDS) {
    r -= def.weight;
    if (r < 0) return def;
  }
  // Only reachable on rng() === 1 (outside the contract); clamp to last row.
  return PICKUP_KINDS[PICKUP_KINDS.length - 1];
}

// ---- placement -------------------------------------------------------------

/** Scatter `count` drops uniformly inside a disc of `radius` meters. */
export function spawnPickups(rng: Rng, count: number, radius: number): Pickup[] {
  const out: Pickup[] = [];
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = radius * Math.sqrt(rng()); // sqrt => uniform area density
    out.push({
      def: rollPickup(rng),
      x: dist * Math.cos(angle),
      z: dist * Math.sin(angle),
    });
  }
  return out;
}

/** Nearest pickup whose combined reach (pickup + fighter radius) contains (x, z). */
export function pickupAt(
  pickups: readonly Pickup[],
  x: number,
  z: number,
  fighterRadius: number,
): Pickup | null {
  let best: Pickup | null = null;
  let bestDist = Infinity;
  for (const p of pickups) {
    const dx = p.x - x;
    const dz = p.z - z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist <= p.def.radius + fighterRadius && dist < bestDist) {
      best = p;
      bestDist = dist;
    }
  }
  return best;
}

// ---- buff stacking ---------------------------------------------------------

/** Merge an existing same-id buff with a freshly collected one. */
type StackResolver = (existing: ActiveBuff, def: PickupDef, now: number) => ActiveBuff;

const STACK_RESOLVERS: Record<StackRule, StackResolver> = {
  // Keep the value, restart the timer.
  refresh: (existing, def, now) => ({
    id: existing.id,
    value: existing.value,
    expiresAt: now + def.duration,
  }),
  // Sum the value, restart the timer.
  stack: (existing, def, now) => ({
    id: existing.id,
    value: existing.value + def.value,
    expiresAt: now + def.duration,
  }),
  // Swap in the new value and timer.
  replace: (existing, def, now) => ({
    id: existing.id,
    value: def.value,
    expiresAt: now + def.duration,
  }),
};

/**
 * Resolve a collected pickup against the fighter's live buffs.
 * Instant pickups (duration <= 0) leave no buff; the caller applies `value` directly.
 */
export function applyPickup(
  fighterBuffs: readonly ActiveBuff[],
  def: PickupDef,
  now: number,
): ActiveBuff[] {
  if (def.duration <= 0) return fighterBuffs.slice();

  const idx = fighterBuffs.findIndex((b) => b.id === def.id);
  if (idx < 0) {
    return [...fighterBuffs, { id: def.id, value: def.value, expiresAt: now + def.duration }];
  }

  const next = fighterBuffs.slice();
  next[idx] = STACK_RESOLVERS[def.stack](next[idx], def, now);
  return next;
}

/** Drop every buff whose timer has elapsed (expiresAt <= now). */
export function tickBuffs(buffs: readonly ActiveBuff[], now: number): ActiveBuff[] {
  return buffs.filter((b) => b.expiresAt > now);
}

/** Combined multiplier for all live buffs with `id`; 1 when none are present. */
export function buffMultiplier(buffs: readonly ActiveBuff[], id: string): number {
  let m = 1;
  for (const b of buffs) {
    if (b.id === id) m *= b.value;
  }
  return m;
}
