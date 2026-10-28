// Attractor items: things that appear in the arena and pull attention.
//
// The headline case from the brief is the coin: it pops up out of the ground,
// falls back, and if it lands near two fighters they may both break off and race
// for it instead of finishing the duel. That is modelled as a *distraction* roll —
// it is deliberately uncommon, and it only fires when the coin is inside the
// fighter's attention volume.
//
// Pure module: no Three.js, no DOM.

import { SENSE_NAMES, senseReaches, type SenseGear } from "./Senses.ts";

export type ItemKind = "coin" | "chest" | "shrine" | "banner";

export interface ItemDef {
  kind: ItemKind;
  /** Display name. */
  name: string;
  /** Colour of the body. */
  color: string;
  /** Radius in metres at size 1 (scaled by the arena's coinSize). */
  radius: number;
  /** Height in metres — coins are deliberately very flat cylinders. */
  height: number;
  /** How strongly it pulls attention, 0..1. */
  pull: number;
  /** Senses that can notice it. */
  sensedBy: string[];
}

export const ITEM_DEFS: Record<ItemKind, ItemDef> = {
  coin:   { kind: "coin",   name: "Coin",   color: "#e8c44a", radius: 1.0, height: 0.08, pull: 0.9, sensedBy: ["sight", "hearing", "magnetism"] },
  chest:  { kind: "chest",  name: "Chest",  color: "#8a5a2b", radius: 0.7, height: 0.6,  pull: 0.7, sensedBy: ["sight", "scent"] },
  shrine: { kind: "shrine", name: "Shrine", color: "#7fb6c9", radius: 0.9, height: 1.4,  pull: 0.6, sensedBy: ["sight", "magnetism"] },
  banner: { kind: "banner", name: "Banner", color: "#b8443a", radius: 0.4, height: 2.0,  pull: 0.3, sensedBy: ["sight"] },
};

export interface Item {
  id: number;
  kind: ItemKind;
  x: number; y: number; z: number;
  /** Vertical velocity, so a popped coin falls. */
  vy: number;
  /** True once it has settled on the ground. */
  landed: boolean;
  /** Counts down while a fighter is running for it. */
  claimedBy: number | null;
  /** Seconds since spawn, for the pickup animation. */
  age: number;
}

export interface SpawnOptions {
  kind?: ItemKind;
  pop?: number;
  gravity?: number;
}

/** Spawn an item at (x, z), popping up to `pop` metres and falling at `gravity`. */
export function spawnItem(id: number, x: number, z: number, groundY: number, opts: SpawnOptions = {}): Item {
  const kind = opts.kind ?? "coin";
  const def = ITEM_DEFS[kind];
  const pop = opts.pop ?? 4;
  // Coins pop out of the ground; the rest are simply placed.
  const y = kind === "coin" ? groundY + Math.max(0.05, pop) : groundY + def.height / 2;
  return {
    id, kind, x, y, z,
    vy: 0,
    landed: kind !== "coin",
    claimedBy: null,
    age: 0,
  };
}

/** Integrate one item's fall. Returns true when it lands this tick. */
export function tickItem(it: Item, dt: number, groundY: number, gravity: number): boolean {
  it.age += dt;
  if (it.landed) return false;
  it.vy -= gravity * dt;
  it.y += it.vy * dt;
  if (it.y <= groundY) {
    it.y = groundY;
    it.vy = 0;
    it.landed = true;
    return true;
  }
  return false;
}

/** World radius of an item, scaled by the arena's coinSize parameter. */
export function itemRadius(it: Item, coinSize: number): number {
  return ITEM_DEFS[it.kind].radius * (it.kind === "coin" ? coinSize : 1);
}

/**
 * Is this item inside the fighter's attention volume? Uses the sense ranges and
 * the lens shape, so a fighter looking away can miss a coin behind them unless
 * they hear it land.
 */
export function itemNoticed(
  it: Item,
  fx: number, fy: number, fz: number,
  facing: { x: number; z: number },
  agitation: number,
  gear: SenseGear,
  enabled: string[] = SENSE_NAMES,
): boolean {
  const dx = it.x - fx, dy = it.y - fy, dz = it.z - fz;
  const def = ITEM_DEFS[it.kind];
  return def.sensedBy.some(
    (s) => enabled.includes(s) && senseReaches(s as never, dx, dy, dz, facing, agitation, gear),
  );
}

export interface DistractionInput {
  item: Item;
  /** Distance from the fighter to the item. */
  distance: number;
  /** Is the item currently inside the fighter's attention volume? */
  noticed: boolean;
  /** The arena's coinGreed parameter, 0..1. */
  greed: number;
  /** Is the fighter currently in a fight (mid-swing or closing)? */
  fighting: boolean;
  /** Is the fighter already chasing something? */
  busy: boolean;
  /** Deterministic roll in 0..1. */
  roll: number;
}

export interface DistractionDecision {
  chase: boolean;
  reason: string;
}

/**
 * Should the fighter abandon what it is doing and go for the item?
 *
 * Deliberately rare, as the brief asks: a fighter that is not fighting ignores
 * items unless it is idle, and even a fighting one only breaks off on a low roll
 * weighted by greed and how close the item is.
 */
export function decideDistraction(i: DistractionInput): DistractionDecision {
  if (i.busy) return { chase: false, reason: "already chasing something" };
  if (!i.noticed) return { chase: false, reason: "not sensed" };
  if (i.item.claimedBy !== null) return { chase: false, reason: "already claimed" };
  if (i.item.kind !== "coin") return { chase: false, reason: "not worth a detour" };

  const pull = ITEM_DEFS[i.item.kind].pull;
  // Closer items pull harder: 1 at contact, falling off over 12 m.
  const proximity = Math.max(0, 1 - i.distance / 12);
  let chance = i.greed * pull * proximity;
  // Breaking off a live fight is a much bigger decision than wandering over.
  if (i.fighting) chance *= 0.35;
  else chance = Math.min(1, chance * 2.2);
  return i.roll < chance
    ? { chase: true, reason: `coin at ${i.distance.toFixed(1)}m, greed ${i.greed.toFixed(2)}` }
    : { chase: false, reason: `ignored (p=${chance.toFixed(2)}, roll=${i.roll.toFixed(2)})` };
}

/** A deterministic LCG so arena item spawns are reproducible from a seed. */
export function seededRng(seed: number): () => number {
  // The seed is HASHED first. A plain LCG gives strongly correlated FIRST outputs for
  // sequential seeds (0,1,2,... all land in the same tenth of the range), so any
  // single-sample decision — "does this arena have walls?" — is biased by the seed
  // itself rather than by the parameter.
  let s = (seed >>> 0) || 1;
  s = Math.imul(s ^ (s >>> 16), 0x7feb352d);
  s = Math.imul(s ^ (s >>> 15), 0x846ca68b);
  s = (s ^ (s >>> 16)) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
