// Match history: typed records of every resolved duel (who, when, where, how,
// with which stats and which AI, who won, how long) plus the statistics the
// History page and tools/history-report.ts compute from them. Pure: no DOM.

import { clamp01 } from "../core/MathCore.ts";
import { MATCH_TIME_LIMIT_S } from "./MatchControl.ts";
import type { ForceSummary } from "./FightTelemetry.ts";

export type Controller = "human" | "decision-tree";
/** How a match ended. "ringout" (V03) = ejected from the arena and eliminated; "ring-out" is the legacy spelling in old records. "time-limit" = the clock called a tie. */
export type WinReason = "ko" | "ring-out" | "ringout" | "timed" | "koth" | "forfeit" | "time-limit";

export interface FighterRecord {
  name: string;
  race: string;
  subrace: string | null;
  className: string;
  weapon: string;
  level: number;
  controller: Controller;
  stats: { vitality: number; resilience: number; focus: number; reflex: number; strength: number; intelligence: number; agility?: number; maxHealth: number; attackPower: number; armor: number };
  dealt: number;     // damage dealt (the opponent's maxHealth - hp, per the glossary)
  hits: number;      // successful hits landed
  hpLeft: number;
  /** "race/subrace" label (subrace omitted when null). Absent on pre-Wave-H records. */
  ancestry?: string;
  /** The match's generation seed. Absent on pre-Wave-H records. */
  generationSeed?: number;
}

/**
 * The stat difference between the two fighters at the end of a fight: the raw
 * per-stat gap, the same gap in pooled standard deviations, the scalar distance
 * between the two builds, the damage share, and a bounded dominance composite.
 * Every field is finite for any input — a missing/NaN stat is treated as 0 and a
 * zero denominator yields 0, never NaN/Infinity, so nothing can poison the corpus.
 */
export interface StatGap {
  /** Per-stat difference (fighter 1 minus fighter 0), in each stat's own units. */
  /** Wave X: `agility` is absent on pre-agility records. */
  raw: { vitality: number; resilience: number; focus: number; reflex: number; strength: number; intelligence: number; agility?: number };
  /** Per-stat difference in pooled standard deviations (0 anywhere both are equal). */
  z: Record<string, number>;
  /** Euclidean length of `z` — THE scalar "how far apart were these two builds". */
  distance: number;
  /** |dealt0 - dealt1| / max(1, dealt0 + dealt1): 0 even, 1 one-sided. */
  damageShare: number;
  /** 0..1 composite dominance of the winner (0 = a coin flip, 1 = a rout). */
  dominance: number;
}

/**
 * The generation a match was built from: the seed, its stable short id, the
 * arena shape, the stat budget spent, the techniques the stats unlocked, and the
 * two fighters' ancestry labels. Fed to the trainers so play can be learned from.
 */
export interface GenerationBlock {
  seed: number;                // the match's generation seed
  id: string;                  // stable short id, e.g. "GEN-4F2A19"
  arena: string;               // the generated arena's name/shape
  budget: number;              // the stat point budget the generator spent
  techniques: string[];        // the technique ids the stats unlocked
  ancestry: [string, string];  // "race/subrace" per fighter
}

export interface MatchRecord {
  id: number;
  at: string;        // ISO timestamp (when)
  hour: number;      // in-world hour used for the sky (when)
  phase: string;     // night/dawn/day/dusk
  place: string;     // named location (where)
  arena: string;     // arena layout (where)
  reason: WinReason; // how
  duration: number;  // seconds
  firstStrike: string | null;
  winner: 0 | 1 | null; // index into fighters; null on a draw
  fighters: [FighterRecord, FighterRecord];
  /** The time limit this match ran under. Absent on pre-Wave-H records (read as 180). */
  limitS?: number;
  /** True when the clock ended the fight as a tie. Absent on pre-Wave-H records (read as false). */
  tie?: boolean;
  /** The end-of-fight stat gap. Absent on pre-Wave-H records (read as a zero gap). */
  statGap?: StatGap;
  /** The generation block. Absent on pre-Wave-H records (read as "GEN-LEGACY"). */
  generation?: GenerationBlock;
  /** statGap.dominance, hoisted for the UI so a menu row need not dig. */
  margin?: number;
  /**
   * Wave FALL (C-LOG): the match's collisions / falls / rises. Absent on pre-Wave-FALL records. The
   * events are capped at HISTORY_FORCE_EVENTS here (500 records live in localStorage); the full log
   * rides in the MatchReport / debugFall.
   */
  forces?: ForceSummary;
}

/** Wave FALL: force events kept per history record. */
export const HISTORY_FORCE_EVENTS = 12;

export const HISTORY_KEY = "mytherrania-history-v2";
export const HISTORY_CAP = 500;

/** The six primary stats, in menu order: the only ones the stat gap compares. */
const PRIMARY_STATS = ["vitality", "resilience", "focus", "reflex", "strength", "intelligence", "agility"] as const;
type PrimaryStat = (typeof PRIMARY_STATS)[number];

/** Floor (stat points) on the pooled SD, so a flat build never divides by 0. */
const PRIMARY_STAT_SD_FLOOR = 0.5;

/** The z-distance counted as "a full build apart" in the dominance curve. */
const DOMINANCE_DISTANCE_K = 3;

/** A statistic value that is finite, else 0: a missing/NaN stat must not poison the gap. */
function num(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Finite difference (x - y), or 0 on overflow — a raw gap must never be ±Infinity. */
function diff(x: number, y: number): number {
  const d = num(x) - num(y);
  return Number.isFinite(d) ? d : 0;
}

/** Division that is total: a zero, negative or non-finite denominator yields 0, never NaN/Infinity. */
function safeDiv(numerator: number, denominator: number): number {
  return denominator > 0 && Number.isFinite(denominator) ? num(numerator) / denominator : 0;
}

/** Sample variance of a fighter's six primaries (0 when they are all equal). */
function varianceOf(stats: FighterRecord["stats"]): number {
  // Wave X: a pre-agility record has no `agility`; only the primaries it carries count.
  const vals = PRIMARY_STATS.filter((k) => stats[k] !== undefined).map((k) => num(stats[k]));
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return vals.reduce((a, v) => a + (v - mean) ** 2, 0) / (vals.length - 1);
}

/** "race/subrace" with the subrace omitted when null: the label the menus show. */
function ancestryLabel(f: FighterRecord): string {
  return f.subrace ? `${f.race}/${f.subrace}` : f.race;
}

/** The all-zero StatGap a pre-Wave-H record is read with. */
function zeroStatGap(): StatGap {
  return {
    raw: { vitality: 0, resilience: 0, focus: 0, reflex: 0, strength: 0, intelligence: 0, agility: 0 },
    z: { vitality: 0, resilience: 0, focus: 0, reflex: 0, strength: 0, intelligence: 0, agility: 0 },
    distance: 0,
    damageShare: 0,
    dominance: 0,
  };
}

/**
 * The stat difference between two fighters at the end of a fight.
 *
 * `raw[k]` is fighter 1 minus fighter 0 in each stat's own units. `z[k]` scales
 * that gap by the POOLED standard deviation of the two fighters' six primaries:
 *   poolSd = sqrt( (varA + varB) / 2 ),  floored at PRIMARY_STAT_SD_FLOOR
 * so a mirror match is z = 0 on every stat and a real build split is finite
 * (never a 0/0 or an Infinity). `distance` is the Euclidean length of z.
 *
 * `damageShare = |dealtA - dealtB| / max(1, dealtA + dealtB)`, 0 for an even or
 * empty fight. `dominance = clamp01( 0.5 * distance/(distance + K) + 0.5 *
 * damageShare )` with K = DOMINANCE_DISTANCE_K: distance/(distance+K) maps
 * [0,∞) → [0,1), so the composite is bounded in [0,1] for every input including
 * a double-KO and a both-sides-zero-damage tie.
 */
export function statGapOf(a: FighterRecord, b: FighterRecord, dealtA: number, dealtB: number): StatGap {
  const sa = a.stats, sb = b.stats;
  const raw = {
    vitality: diff(sb.vitality, sa.vitality),
    resilience: diff(sb.resilience, sa.resilience),
    focus: diff(sb.focus, sa.focus),
    reflex: diff(sb.reflex, sa.reflex),
    strength: diff(sb.strength, sa.strength),
    intelligence: diff(sb.intelligence, sa.intelligence),
    agility: diff(sb.agility ?? 0, sa.agility ?? 0),
  } satisfies Record<PrimaryStat, number>;

  const poolSd = Math.max(PRIMARY_STAT_SD_FLOOR, Math.sqrt((varianceOf(sa) + varianceOf(sb)) / 2));

  const z: Record<string, number> = {};
  let sq = 0;
  for (const k of PRIMARY_STATS) {
    const zk = safeDiv(raw[k], poolSd);
    z[k] = zk;
    sq += zk * zk;
  }
  const distance = Number.isFinite(Math.sqrt(sq)) ? Math.sqrt(sq) : 0;

  const totalDealt = num(dealtA) + num(dealtB);
  const damageShare = totalDealt > 0 ? Math.min(1, Math.abs(num(dealtA) - num(dealtB)) / Math.max(1, totalDealt)) : 0;

  const distance01 = Number.isFinite(distance) ? distance / (distance + DOMINANCE_DISTANCE_K) : 1;
  const dominance = clamp01(0.5 * distance01 + 0.5 * damageShare);

  return { raw, z, distance, damageShare, dominance };
}

/**
 * A stable short generation id from a seed alone: "GEN-" + six uppercase hex
 * digits. A splitmix-style avalanche scatters sequential seeds across the 24-bit
 * space so nearby seeds do not collide. Non-finite input reads as seed 0.
 */
export function generationId(seed: number): string {
  let h = Number.isFinite(seed) ? Math.trunc(seed) : 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return "GEN-" + (h & 0xffffff).toString(16).toUpperCase().padStart(6, "0");
}

/**
 * History highlights the menu shows: the fastest DECIDED match (lowest duration
 * among winner !== null), the widest stat gap (highest statGap.distance), the
 * number of ties and the number of time-limit timeouts. An empty list gives
 * nulls and zero counts.
 */
export function highlights(list: MatchRecord[]): {
  fastest: MatchRecord | null;
  widestGap: MatchRecord | null;
  tieCount: number;
  timeoutCount: number;
} {
  let fastest: MatchRecord | null = null;
  let widestGap: MatchRecord | null = null;
  let widest = -Infinity;
  let tieCount = 0;
  let timeoutCount = 0;
  for (const r of list) {
    if (r.tie === true) tieCount++;
    if (r.reason === "time-limit") timeoutCount++;
    if (r.winner !== null && (fastest === null || r.duration < fastest.duration)) fastest = r;
    const d = r.statGap?.distance ?? 0;
    if (widestGap === null || d > widest) {
      widestGap = r;
      widest = d;
    }
  }
  return { fastest, widestGap, tieCount, timeoutCount };
}

/**
 * Fill a parsed record with the Wave-H defaults so a player's existing 500-match
 * history still loads: no statGap → a zero gap, no generation → "GEN-LEGACY",
 * no limitS → 180, no tie → false, no margin → 0, and fighters gain an ancestry
 * label (from race/subrace) and a generation seed of 0.
 */
function normalizeRecord(r: Record<string, unknown>): MatchRecord {
  const fighters = (r.fighters as FighterRecord[]).map((f) => ({
    ...f,
    ancestry: f.ancestry ?? ancestryLabel(f),
    generationSeed: typeof f.generationSeed === "number" && Number.isFinite(f.generationSeed) ? f.generationSeed : 0,
  })) as [FighterRecord, FighterRecord];
  const statGap = (r.statGap as StatGap | undefined) ?? zeroStatGap();
  const limitS = typeof r.limitS === "number" && Number.isFinite(r.limitS) ? r.limitS : MATCH_TIME_LIMIT_S;
  const generation = (r.generation as GenerationBlock | undefined) ?? {
    seed: 0,
    id: "GEN-LEGACY",
    arena: typeof r.arena === "string" ? r.arena : "",
    budget: 0,
    techniques: [],
    ancestry: [ancestryLabel(fighters[0]), ancestryLabel(fighters[1])] as [string, string],
  };
  return {
    ...(r as unknown as MatchRecord),
    fighters,
    limitS,
    tie: r.tie === true,
    statGap,
    generation,
    margin: typeof r.margin === "number" && Number.isFinite(r.margin) ? r.margin : statGap.dominance,
  };
}

export function parseHistory(raw: string | null): MatchRecord[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter((r) => r && Array.isArray(r.fighters) && r.fighters.length === 2)
      .map((r) => normalizeRecord(r as Record<string, unknown>));
  } catch {
    return [];
  }
}

export function appendRecord(list: MatchRecord[], rec: MatchRecord): MatchRecord[] {
  const next = [...list, rec];
  return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next;
}

export interface Rate { key: string; wins: number; games: number; rate: number; lo: number; hi: number }

/** Wilson score interval (95%): honest uncertainty for small samples. */
export function wilson(wins: number, n: number, z = 1.96): { rate: number; lo: number; hi: number } {
  if (n === 0) return { rate: 0, lo: 0, hi: 0 };
  const p = wins / n;
  const den = 1 + z * z / n;
  const centre = (p + z * z / (2 * n)) / den;
  const half = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / den;
  return { rate: p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

export function describe(values: number[]): { n: number; mean: number; median: number; sd: number; min: number; max: number } {
  const n = values.length;
  if (!n) return { n: 0, mean: 0, median: 0, sd: 0, min: 0, max: 0 };
  const s = [...values].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  const sd = n > 1 ? Math.sqrt(s.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, median, sd, min: s[0], max: s[n - 1] };
}

/** Every fighter appearance counts once: a win for the winner, a game for both. */
function rateBy(list: MatchRecord[], keyOf: (f: FighterRecord, r: MatchRecord) => string): Rate[] {
  const acc = new Map<string, { wins: number; games: number }>();
  for (const r of list) {
    r.fighters.forEach((f, i) => {
      const k = keyOf(f, r);
      const a = acc.get(k) ?? { wins: 0, games: 0 };
      a.games++;
      if (r.winner === i) a.wins++;
      acc.set(k, a);
    });
  }
  return [...acc.entries()]
    .map(([key, a]) => ({ key, ...a, ...wilson(a.wins, a.games) }))
    .sort((a, b) => b.games - a.games || a.key.localeCompare(b.key));
}

export interface HistorySummary {
  matches: number;
  duration: ReturnType<typeof describe>;
  firstStrikeWinRate: { rate: number; lo: number; hi: number; n: number };
  byRace: Rate[];
  byClass: Rate[];
  byWeapon: Rate[];
  byController: Rate[];
  reasons: Record<string, number>;
  byPhase: Record<string, number>;
  byPlace: Record<string, number>;
  /** Matches the clock called a tie (Wave H). */
  ties: number;
  /** Matches ended by the time limit (reason "time-limit", Wave H). */
  timeouts: number;
}

export function summarize(list: MatchRecord[]): HistorySummary {
  const fsGames = list.filter((r) => r.firstStrike);
  const fsWins = fsGames.filter((r) => r.winner !== null && r.fighters[r.winner].name === r.firstStrike).length;
  const count = (k: (r: MatchRecord) => string) => list.reduce<Record<string, number>>((o, r) => { o[k(r)] = (o[k(r)] ?? 0) + 1; return o; }, {});
  return {
    matches: list.length,
    duration: describe(list.map((r) => r.duration)),
    firstStrikeWinRate: { ...wilson(fsWins, fsGames.length), n: fsGames.length },
    byRace: rateBy(list, (f) => f.race),
    byClass: rateBy(list, (f) => f.className),
    byWeapon: rateBy(list, (f) => f.weapon),
    byController: rateBy(list, (f) => f.controller),
    reasons: count((r) => r.reason),
    byPhase: count((r) => r.phase),
    byPlace: count((r) => r.place),
    ties: list.reduce((n, r) => n + (r.tie === true ? 1 : 0), 0),
    timeouts: list.reduce((n, r) => n + (r.reason === "time-limit" ? 1 : 0), 0),
  };
}
