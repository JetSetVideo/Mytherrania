// Match history: typed records of every resolved duel (who, when, where, how,
// with which stats and which AI, who won, how long) plus the statistics the
// History page and tools/history-report.ts compute from them. Pure: no DOM.

export type Controller = "human" | "decision-tree";
/** How a match ended. "ringout" (V03) = ejected from the arena and eliminated; "ring-out" is the legacy spelling in old records. */
export type WinReason = "ko" | "ring-out" | "ringout" | "timed" | "koth" | "forfeit";

export interface FighterRecord {
  name: string;
  race: string;
  subrace: string | null;
  className: string;
  weapon: string;
  level: number;
  controller: Controller;
  stats: { vitality: number; resilience: number; willpower: number; reflex: number; strength: number; intelligence: number; maxHealth: number; attackPower: number; armor: number };
  dealt: number;     // damage dealt
  hits: number;      // successful hits landed
  hpLeft: number;
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
}

export const HISTORY_KEY = "mytherrania-history-v2";
export const HISTORY_CAP = 500;

export function parseHistory(raw: string | null): MatchRecord[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.filter((r) => r && Array.isArray(r.fighters) && r.fighters.length === 2) : [];
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
  };
}
