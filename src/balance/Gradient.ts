// Wave J (lane J-B): the batch's DESIGN — which matches to run so the results say what happens at
// the extremes and in between.
//
//   extreme  every numeric attribute of both fighters and the arena drawn independently at its MIN
//            or its MAX (a coin per attribute), categorical attributes uniform;
//   corner   the named corner cases: max-vs-max, min-vs-min, max-vs-min, min-vs-max, each on the
//            SMALLEST and the LARGEST arena, walled (full) and open (no wall);
//   grid     gradient lines: ONE axis stepped min -> max in GRID_STEPS steps, every other numeric
//            attribute at its median; a fighter axis is stepped on seat A only (seat B stays median),
//            so the line reads as "what does this attribute buy";
//   random   every numeric attribute uniform in [0, 1].
// Every design point is in normalised 0..1 knobs; `toConditions` turns one into MatchConditions.
//
// Pure module: no THREE, no DOM, no Math.random.

import { NO_SYMMETRY, WALL_RULE_KINDS, type FighterSpec, type MatchConditions, type StrategyLevel, type WallRuleKind } from "../game/arena/contracts.ts";
import { makeArena, snapSymmetryRotation, type ArenaConfig } from "../game/ArenaConfig.ts";
import { BIRTHSIGNS } from "../game/Birthsight.ts";
import { RACES, type StatName } from "../game/Races.ts";
import { budgetForLevel, PER_STAT_CAP } from "../game/SpectateGen.ts";
import { BATCH_VARIABLES, STAT_NAMES, valueAt, VARIABLE_BY_ID, type VariableDef } from "./Variables.ts";
import { CLASSES, type ClassName } from "../game/Stats.ts";
import { ARCHETYPE_IDS } from "../game/weapons/Archetypes.ts";
import { MAX_LEVEL, MIN_LEVEL } from "../game/SpectateGen.ts";
import { ANCESTRIES, leanAllocation } from "./FighterBuild.ts";
import type { ArenaProvider } from "./ArenaFixtures.ts";
import { randomSource } from "./ArenaHarness.ts";

/** Numeric knobs of one fighter, each 0..1. */
export interface FighterKnobs { level: number; stats: number; gear: number; strategy: number; ai: number }
/** Numeric knobs of the arena, each 0..1. */
export interface ArenaKnobs { size: number; walls: number; props: number }
/** Categorical draws (indices into the tables below), fixed per design point. */
export interface Categorical { ancestry: [number, number]; cls: [number, number]; weapon: [number, number]; ground: number; shape: number }

export interface DesignPoint {
  design: string;
  a: FighterKnobs;
  b: FighterKnobs;
  arena: ArenaKnobs;
  cat: Categorical;
  gradient?: Record<string, number>;
  seed: number;
  /** Explicit wall rule (the invariant sweep covers every kind); absent = wallOf(arena.walls). */
  wall?: WallRuleKind;
  /**
   * Per-VARIABLE overrides (designs "vars-extreme" / "vars-grid"), normalised 0..1 positions keyed
   * by Variables.ts id: "arena.<key>", or "A.fighter.<field>" / "B.fighter.<field>" per seat.
   */
  over?: Record<string, number>;
}

export const FIGHTER_AXES: readonly (keyof FighterKnobs)[] = ["level", "stats", "gear", "strategy", "ai"];
export const ARENA_AXES: readonly (keyof ArenaKnobs)[] = ["size", "walls", "props"];
export const GRID_STEPS = 5;
/** Arena span: 2 m (the contract's closet) to 320 m, log scale (median 0.5 = 25.3 m). */
export const SIZE_MIN = 2, SIZE_MAX = 320;
/** Wall kinds in order of how much of the rim they hold (walls knob 0 -> 1). */
export const WALL_LADDER: readonly WallRuleKind[] = ["none", "low", "ruin", "gates", "full"];
/** Base wall height the plans scale, m (above WALL_BLOCK_HEIGHT; the contract's typical band). */
export const WALL_BASE = 1.2;
/** Props at the props knob = 1. */
export const PROPS_MAX = 14;

export const MAX_KNOBS: Readonly<FighterKnobs> = { level: 1, stats: 1, gear: 1, strategy: 1, ai: 1 };
export const MIN_KNOBS: Readonly<FighterKnobs> = { level: 0, stats: 0, gear: 0, strategy: 0, ai: 0 };
export const MID_KNOBS: Readonly<FighterKnobs> = { level: 0.5, stats: 0.5, gear: 0.5, strategy: 0.5, ai: 0.5 };

const clamp01 = (v: number) => Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;

export function strategyOf(k: number): StrategyLevel { return k < 1 / 3 ? "none" : k < 2 / 3 ? "basic" : "full"; }
export function levelOf(k: number): number { return Math.round(MIN_LEVEL + clamp01(k) * (MAX_LEVEL - MIN_LEVEL)); }
export function sizeOf(k: number): number { return SIZE_MIN * (SIZE_MAX / SIZE_MIN) ** clamp01(k); }
export function wallOf(k: number): WallRuleKind { return WALL_LADDER[Math.min(WALL_LADDER.length - 1, Math.round(clamp01(k) * (WALL_LADDER.length - 1)))]; }

/** Weapon choice table: the class default ("") and every archetype. */
export const WEAPONS: readonly string[] = ["", ...ARCHETYPE_IDS];

function categorical(rng: () => number): Categorical {
  const i = (n: number) => Math.min(n - 1, Math.floor(rng() * n));
  return {
    ancestry: [i(ANCESTRIES.length), i(ANCESTRIES.length)],
    cls: [i(CLASSES.length), i(CLASSES.length)],
    weapon: [i(WEAPONS.length), i(WEAPONS.length)],
    ground: i(4),
    shape: i(8),
  };
}

const coin = (rng: () => number) => (rng() < 0.5 ? 0 : 1);
const knobsFrom = (f: () => number): FighterKnobs => ({ level: f(), stats: f(), gear: f(), strategy: f(), ai: f() });

/** The named corner cases (fighter pair × arena size × walled/open) in a fixed order. */
export const CORNERS: readonly { name: string; a: FighterKnobs; b: FighterKnobs }[] = [
  { name: "max-vs-max", a: MAX_KNOBS, b: MAX_KNOBS },
  { name: "min-vs-min", a: MIN_KNOBS, b: MIN_KNOBS },
  { name: "max-vs-min", a: MAX_KNOBS, b: MIN_KNOBS },
  { name: "min-vs-max", a: MIN_KNOBS, b: MAX_KNOBS },
];
export const CORNER_ARENAS: readonly { name: string; arena: ArenaKnobs }[] = [
  { name: "small-open", arena: { size: 0, walls: 0, props: 0 } },
  { name: "small-walled", arena: { size: 0, walls: 1, props: 0 } },
  { name: "large-open", arena: { size: 1, walls: 0, props: 0 } },
  { name: "large-walled", arena: { size: 1, walls: 1, props: 0 } },
];

export type DesignKind = "all" | "extreme" | "corner" | "grid" | "random" | "invariant" | "vars" | "vars-extreme" | "vars-grid";

/** Arena sizes the invariant sweep visits, m (the contract's 2 m closet to its 320 m field). */
export const SWEEP_SIZES: readonly number[] = [2, 3, 5, 8, 14, 25, 60, 120, 320];
const sizeKnob = (m: number) => Math.log(m / SIZE_MIN) / Math.log(SIZE_MAX / SIZE_MIN);

/**
 * `n` design points for a design kind, deterministic from `seed`. "all" splits the budget
 * 30 % corner / 25 % extreme / 30 % grid / 15 % random. Grid lines cycle through every axis and
 * step; corners cycle through every (pair × arena) cell, so even a small n covers each cell.
 */
export function designPoints(kind: DesignKind, n: number, seed: number): DesignPoint[] {
  const total = Math.max(0, Math.floor(n));
  if (kind === "vars") {
    const e = Math.round(total * 0.5);
    return [...designPoints("vars-extreme", e, seed ^ 0x5005), ...designPoints("vars-grid", total - e, seed ^ 0x6006)];
  }
  if (kind === "vars-extreme" || kind === "vars-grid") return varsPoints(kind, total, seed);
  if (kind === "all") {
    const c = Math.round(total * 0.3), e = Math.round(total * 0.25), g = Math.round(total * 0.3);
    return [
      ...designPoints("corner", c, seed ^ 0x1001),
      ...designPoints("extreme", e, seed ^ 0x2002),
      ...designPoints("grid", g, seed ^ 0x3003),
      ...designPoints("random", Math.max(0, total - c - e - g), seed ^ 0x4004),
    ];
  }
  const rng = randomSource(seed >>> 0);
  const out: DesignPoint[] = [];
  const axes = [...FIGHTER_AXES.map((a) => `A.${a}`), ...ARENA_AXES.map((a) => `arena.${a}`)];
  for (let i = 0; i < total; i++) {
    const pseed = Math.floor(rng() * 0x7fffffff);
    const cat = categorical(rng);
    if (kind === "invariant") {
      // Strong vs weak on every (size × wall rule) cell, seats alternating, ground/shape/props drawn.
      const size = SWEEP_SIZES[i % SWEEP_SIZES.length];
      const wall = WALL_RULE_KINDS[Math.floor(i / SWEEP_SIZES.length) % WALL_RULE_KINDS.length];
      const strongA = Math.floor(i / (SWEEP_SIZES.length * WALL_RULE_KINDS.length)) % 2 === 0;
      out.push({
        design: `corner:${strongA ? "max-vs-min" : "min-vs-max"}|sweep-${size}m-${wall}`,
        a: { ...(strongA ? MAX_KNOBS : MIN_KNOBS) }, b: { ...(strongA ? MIN_KNOBS : MAX_KNOBS) },
        arena: { size: sizeKnob(size), walls: wall === "none" ? 0 : 1, props: rng() < 0.5 ? 0 : 1 }, cat, seed: pseed, wall,
      });
    } else if (kind === "corner") {
      const c = CORNERS[i % CORNERS.length], ar = CORNER_ARENAS[Math.floor(i / CORNERS.length) % CORNER_ARENAS.length];
      out.push({ design: `corner:${c.name}|${ar.name}`, a: { ...c.a }, b: { ...c.b }, arena: { ...ar.arena }, cat, seed: pseed });
    } else if (kind === "extreme") {
      const f = () => coin(rng);
      out.push({ design: "extreme:random", a: knobsFrom(f), b: knobsFrom(f), arena: { size: f(), walls: f(), props: f() }, cat, seed: pseed });
    } else if (kind === "grid") {
      const axis = axes[i % axes.length];
      const step = Math.floor(i / axes.length) % GRID_STEPS;
      const pos = step / (GRID_STEPS - 1);
      const a = { ...MID_KNOBS }, arena: ArenaKnobs = { size: 0.5, walls: 0.5, props: 0.5 };
      const [scope, name] = axis.split(".");
      if (scope === "A") (a as Record<string, number>)[name] = pos;
      else (arena as unknown as Record<string, number>)[name] = pos;
      out.push({ design: `grid:${axis}`, a, b: { ...MID_KNOBS }, arena, cat, gradient: { [axis]: pos }, seed: pseed });
    } else {
      const f = () => rng();
      out.push({ design: "random", a: knobsFrom(f), b: knobsFrom(f), arena: { size: f(), walls: f(), props: f() }, cat, seed: pseed });
    }
  }
  return out;
}

/** A design point's fighter as a contract FighterSpec (`over`: the point's per-variable overrides). */
export function fighterSpecOf(k: FighterKnobs, cat: Categorical, seat: 0 | 1, seed: number, over?: Record<string, number>): FighterSpec {
  const pre = seat === 0 ? "A.fighter." : "B.fighter.";
  const o = (field: string): number | undefined => over?.[pre + field];
  const at = (field: string, u: number) => valueAt(VARIABLE_BY_ID.get(`fighter.${field}`)!, u);
  let anc = ANCESTRIES[cat.ancestry[seat]];
  if (o("ancestry") !== undefined) anc = ANCESTRIES[at("ancestry", o("ancestry")!)];
  else if (o("race") !== undefined) {
    // A race step keeps the point's sub-race SLOT (0..2) inside the chosen race.
    const race = RACES[at("race", o("race")!)];
    const slot = RACES.find((r) => r.id === anc.race)!.subspecies.findIndex((s) => s.id === anc.subrace);
    anc = { race: race.id, subrace: race.subspecies[Math.max(0, slot) % race.subspecies.length].id };
  }
  const className: ClassName = o("class") !== undefined ? CLASSES[at("class", o("class")!)] : CLASSES[cat.cls[seat]];
  const level = o("level") !== undefined ? at("level", o("level")!) : levelOf(k.level);
  const weapon = o("weapon") !== undefined ? WEAPONS[at("weapon", o("weapon")!)] : WEAPONS[cat.weapon[seat]];
  const signIdx = o("birthsign") !== undefined ? at("birthsign", o("birthsign")!) : 0;
  const strategy = o("strategy") !== undefined ? (["none", "basic", "full"] as const)[at("strategy", o("strategy")!)] : strategyOf(k.strategy);
  const stats: Partial<Record<StatName, number>> = {};
  for (const s of STAT_NAMES) if (o(`stat.${s}`) !== undefined) stats[s] = o(`stat.${s}`)!;
  return {
    name: `${seat === 0 ? "A" : "B"}-${className}-${anc.race}`,
    race: anc.race,
    subrace: anc.subrace,
    className,
    birthsign: signIdx > 0 ? BIRTHSIGNS[signIdx - 1].id : null,
    level,
    allocated: Object.keys(stats).length > 0 ? legalAllocation(className, level, k.stats, stats) : leanAllocation(className, level, k.stats),
    weapon: { type: weapon, seed: (seed ^ (seat === 0 ? 0x5bd1e995 : 0x1b873593)) >>> 0, quality: o("gear") !== undefined ? clamp01(o("gear")!) : clamp01(k.gear) },
    strategy,
    aiLevel: o("aiLevel") !== undefined ? clamp01(o("aiLevel")!) : clamp01(k.ai),
  };
}

/**
 * A per-attribute allocation that stays LEGAL: each overridden attribute asks for u · PER_STAT_CAP
 * points, the others keep the lean spend of the `fraction` knob, and the whole is scaled down to
 * the level's budget when it would exceed it (so "strength at max" on a level-1 fighter is the
 * level-1 budget poured into strength, not 60 points it could never have).
 */
export function legalAllocation(className: ClassName, level: number, fraction: number, wanted: Partial<Record<StatName, number>>): Record<StatName, number> {
  const base = leanAllocation(className, level, fraction);
  const want: Record<StatName, number> = { ...base };
  for (const s of STAT_NAMES) if (wanted[s] !== undefined) want[s] = Math.round(clamp01(wanted[s]!) * PER_STAT_CAP);
  const budget = budgetForLevel(level);
  const sum = STAT_NAMES.reduce((t, s) => t + want[s], 0);
  if (sum <= budget) return want;
  // Scale to the budget, then hand the rounding remainder to the largest asks.
  const k = budget / sum, out = {} as Record<StatName, number>;
  let used = 0;
  for (const s of STAT_NAMES) { out[s] = Math.floor(want[s] * k); used += out[s]; }
  const order = [...STAT_NAMES].sort((a, b) => want[b] - want[a]);
  for (let i = 0; used < budget && i < order.length * 4; i++) {
    const s = order[i % order.length];
    if (want[s] > out[s] && out[s] < PER_STAT_CAP) { out[s]++; used++; }
  }
  return out;
}

/** Normalised position of an enum value index (0..n−1 -> 0..1). */
const enumU = (v: VariableDef, idx: number) => (v.max > v.min ? (idx) / (v.max - v.min) : 0);

/**
 * vars-extreme: EVERY batch variable (Variables.BATCH_VARIABLES: each sim-read arena variable once,
 * each fighter variable per seat) independently at its min or its max (a coin each); enums take a
 * uniform value (an enum has no "max"). gradient = the whole override map, so Summary.effects can
 * split every record by every variable.
 * vars-grid: ONE variable stepped min -> max (GRID_STEPS positions; enums every value), everything
 * else at its middle; fighter variables on seat A only.
 */
function varsPoints(kind: "vars-extreme" | "vars-grid", n: number, seed: number): DesignPoint[] {
  const rng = randomSource(seed >>> 0);
  const out: DesignPoint[] = [];
  const mid: ArenaKnobs = { size: 0.5, walls: 0.5, props: 0.5 };
  if (kind === "vars-extreme") {
    for (let i = 0; i < n; i++) {
      const pseed = Math.floor(rng() * 0x7fffffff), cat = categorical(rng), over: Record<string, number> = {};
      for (const v of BATCH_VARIABLES) {
        const keys = v.perSeat ? [`A.${v.id}`, `B.${v.id}`] : [v.id];
        for (const key of keys) over[key] = v.kind === "enum" ? enumU(v, Math.min(v.max - v.min, Math.floor(rng() * (v.max - v.min + 1)))) : coin(rng);
      }
      out.push({ design: "vars-extreme", a: { ...MID_KNOBS }, b: { ...MID_KNOBS }, arena: { ...mid }, cat, seed: pseed, over, gradient: { ...over } });
    }
    return out;
  }
  // Every (variable, step) cell in order, cycled until n points.
  const cells: { key: string; u: number }[] = [];
  for (const v of BATCH_VARIABLES) {
    const key = v.perSeat ? `A.${v.id}` : v.id;
    const steps = v.kind === "enum" ? v.max - v.min + 1 : v.kind === "bool" ? 2 : GRID_STEPS;
    for (let s = 0; s < steps; s++) cells.push({ key, u: steps > 1 ? s / (steps - 1) : 0 });
  }
  for (let i = 0; i < n; i++) {
    const pseed = Math.floor(rng() * 0x7fffffff), cat = categorical(rng), c = cells[i % cells.length];
    out.push({ design: `vars-grid:${c.key}`, a: { ...MID_KNOBS }, b: { ...MID_KNOBS }, arena: { ...mid }, cat, seed: pseed, over: { [c.key]: c.u }, gradient: { [c.key]: c.u } });
  }
  return out;
}

/** Number of cells one full vars-grid sweep has (each batch variable × its steps). */
export function varsGridCells(): number {
  return BATCH_VARIABLES.reduce((t, v) => t + (v.kind === "enum" ? v.max - v.min + 1 : v.kind === "bool" ? 2 : GRID_STEPS), 0);
}

/** The ArenaConfig of a design point (flat, symmetric-start, solid outside ground 1 m below). */
export function arenaConfigOf(p: DesignPoint): ArenaConfig {
  const wall = p.wall ?? wallOf(p.arena.walls);
  // Per-variable arena overrides (vars designs) go on top; the outline is then re-aligned to its
  // symmetry (ArenaConfig.snapSymmetryRotation, as randomArena does after its own overrides).
  const ov: Partial<ArenaConfig> = {};
  for (const [key, u] of Object.entries(p.over ?? {})) {
    if (!key.startsWith("arena.")) continue;
    const v = VARIABLE_BY_ID.get(key);
    if (v) (ov as Record<string, number>)[key.slice(6)] = valueAt(v, u);
  }
  return snapSymmetryRotation(makeArena({
    size: sizeOf(p.arena.size),
    walls: wall === "none" ? 0 : 1,
    wallHeight: WALL_BASE,
    shape: p.cat.shape,
    aspect: 1,
    rotation: 0,
    ground: p.cat.ground,
    objects: Math.round(clamp01(p.arena.props) * PROPS_MAX),
    objectSpread: 0.75,
    outsideGround: 1,
    outsideCollision: 1,
    outsideHeight: -1,
    roamSeconds: 6,
    ...ov,
  }));
}

/** The wall rule a point builds: the arena.wallRule override when the point has one, else the ladder. */
export function wallRuleOf(p: DesignPoint, cfg: ArenaConfig): WallRuleKind {
  if (p.over && "arena.wallRule" in p.over) return cfg.walls >= 1 ? WALL_RULE_KINDS[Math.max(0, Math.min(WALL_RULE_KINDS.length - 1, Math.round(cfg.wallRule)))] : "none";
  if (p.over && "arena.walls" in p.over && cfg.walls < 1) return "none";
  return p.wall ?? wallOf(p.arena.walls);
}

/** Full MatchConditions for a design point (the record's "conditions"). */
export function toConditions(p: DesignPoint, provider: ArenaProvider, codeHash: string): MatchConditions {
  const arena = arenaConfigOf(p);
  const built = provider(arena, wallRuleOf(p, arena), arena.wallHeight, p.seed);
  return {
    version: 1,
    seed: p.seed,
    codeHash,
    simulator: "headless",
    arena,
    walls: built.walls,
    symmetry: built.symmetry ?? NO_SYMMETRY,
    digest: built.digest,
    fighters: [fighterSpecOf(p.a, p.cat, 0, p.seed, p.over), fighterSpecOf(p.b, p.cat, 1, p.seed, p.over)],
    timeScale: 1,
    design: p.design,
    ...(p.gradient ? { gradient: p.gradient } : {}),
  };
}
