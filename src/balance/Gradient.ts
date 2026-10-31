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
import { makeArena, type ArenaConfig } from "../game/ArenaConfig.ts";
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

export type DesignKind = "all" | "extreme" | "corner" | "grid" | "random" | "invariant";

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

/** A design point's fighter as a contract FighterSpec. */
export function fighterSpecOf(k: FighterKnobs, cat: Categorical, seat: 0 | 1, seed: number): FighterSpec {
  const anc = ANCESTRIES[cat.ancestry[seat]];
  const className: ClassName = CLASSES[cat.cls[seat]];
  const level = levelOf(k.level);
  return {
    name: `${seat === 0 ? "A" : "B"}-${className}-${anc.race}`,
    race: anc.race,
    subrace: anc.subrace,
    className,
    birthsign: null,
    level,
    allocated: leanAllocation(className, level, k.stats),
    weapon: { type: WEAPONS[cat.weapon[seat]], seed: (seed ^ (seat === 0 ? 0x5bd1e995 : 0x1b873593)) >>> 0, quality: clamp01(k.gear) },
    strategy: strategyOf(k.strategy),
    aiLevel: clamp01(k.ai),
  };
}

/** The ArenaConfig of a design point (flat, symmetric-start, solid outside ground 1 m below). */
export function arenaConfigOf(p: DesignPoint): ArenaConfig {
  const wall = p.wall ?? wallOf(p.arena.walls);
  return makeArena({
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
  });
}

/** Full MatchConditions for a design point (the record's "conditions"). */
export function toConditions(p: DesignPoint, provider: ArenaProvider, codeHash: string): MatchConditions {
  const arena = arenaConfigOf(p);
  const built = provider(arena, p.wall ?? wallOf(p.arena.walls), WALL_BASE, p.seed);
  return {
    version: 1,
    seed: p.seed,
    codeHash,
    simulator: "headless",
    arena,
    walls: built.walls,
    symmetry: built.symmetry ?? NO_SYMMETRY,
    digest: built.digest,
    fighters: [fighterSpecOf(p.a, p.cat, 0, p.seed), fighterSpecOf(p.b, p.cat, 1, p.seed)],
    timeScale: 1,
    design: p.design,
    ...(p.gradient ? { gradient: p.gradient } : {}),
  };
}
