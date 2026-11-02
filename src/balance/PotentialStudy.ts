// Wave Y (lane P): the measurement behind docs/wave-y/POOLS.md — what the potential law does to the
// headless MatchSim (class win shares, fight length, how much potential a match takes) and what the
// pool-aware AI is worth against the previous brain. Pure over runBatch / simulateMatch; the runner is
// src/balance/pools-study.ts (writes artifacts/wave-y-P-*.json).

import type { MatchRecord } from "../game/arena/contracts.ts";
import { runBatch } from "./Batch.ts";
import type { SimOptions } from "./MatchSim.ts";
import { POOL_KINDS, type PoolKind } from "../game/Potential.ts";
import { truceSeconds } from "../game/Disposition.ts";

export const STUDY_CLASSES = ["Barbarian", "Warrior", "Rogue", "Assassin", "Mage", "Necromancer", "Archer", "Priest"] as const;

/** Summary of one batch. Shares are of decisive, non-mirror appearances. */
export interface StudySummary {
  label: string;
  matches: number;
  seed: number;
  decisive: number;
  reasons: Record<string, number>;
  classWinShare: Record<string, number>;
  meanAbsDev: number;
  /** Median duration of decisive matches, s (includes the truce, as wave X reported it). */
  medianDuration: number;
  /** The same minus the truce: the hostile duel. */
  medianDuelSeconds: number;
  /** Mean end-of-match potential share (potential / max) per pool, over every seat. */
  endPotential: Record<PoolKind, number>;
  /** Mean potential lost per seat per channel, as a share of max. */
  lostShare: Record<PoolKind, { wound: number; status: number; fatigue: number; recovered: number }>;
}

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Run `matches` random-design matches and summarise them. */
export function classStudy(label: string, matches: number, seed: number, sim: Omit<SimOptions, "rules" | "onFinish"> = {}): StudySummary {
  const endPot: Record<PoolKind, number[]> = { health: [], mana: [], stamina: [] };
  const lost: StudySummary["lostShare"] = {
    health: { wound: 0, status: 0, fatigue: 0, recovered: 0 },
    mana: { wound: 0, status: 0, fatigue: 0, recovered: 0 },
    stamina: { wound: 0, status: 0, fatigue: 0, recovered: 0 },
  };
  let seats = 0;
  const records: MatchRecord[] = runBatch({
    matches, seed, design: "random",
    sim: {
      ...sim,
      onFinish: (ss) => {
        for (const s of ss) {
          seats++;
          for (const k of POOL_KINDS) {
            const max = s.pot.max[k] || 1;
            endPot[k].push(s.pot.potential[k] / max);
            for (const c of ["wound", "status", "fatigue", "recovered"] as const) lost[k][c] += s.pot.lost[k][c] / max;
          }
        }
      },
    },
  });
  const wins: Record<string, number> = {}, apps: Record<string, number> = {};
  const reasons: Record<string, number> = {};
  const durs: number[] = [];
  let decisive = 0;
  for (const r of records) {
    const o = r.outcome;
    reasons[o.reason] = (reasons[o.reason] ?? 0) + 1;
    if (o.winner === null) continue;
    decisive++;
    durs.push(o.duration);
    const [a, b] = r.conditions.fighters;
    if (a.className === b.className) continue;
    for (let s = 0; s < 2; s++) {
      const c = r.conditions.fighters[s].className;
      apps[c] = (apps[c] ?? 0) + 1;
      if (o.winner === s) wins[c] = (wins[c] ?? 0) + 1;
    }
  }
  const classWinShare: Record<string, number> = {};
  for (const c of STUDY_CLASSES) classWinShare[c] = r4((wins[c] ?? 0) / Math.max(1, apps[c] ?? 0));
  const mad = STUDY_CLASSES.reduce((t, c) => t + Math.abs(classWinShare[c] - 0.5), 0) / STUDY_CLASSES.length;
  const md = median(durs);
  const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1;
  const per = (v: number) => r4(v / Math.max(1, seats));
  return {
    label, matches, seed, decisive, reasons, classWinShare, meanAbsDev: r4(mad),
    medianDuration: Math.round(md * 100) / 100, medianDuelSeconds: Math.round((md - truceSeconds()) * 100) / 100,
    endPotential: { health: r4(mean(endPot.health)), mana: r4(mean(endPot.mana)), stamina: r4(mean(endPot.stamina)) },
    lostShare: {
      health: { wound: per(lost.health.wound), status: per(lost.health.status), fatigue: per(lost.health.fatigue), recovered: per(lost.health.recovered) },
      mana: { wound: per(lost.mana.wound), status: per(lost.mana.status), fatigue: per(lost.mana.fatigue), recovered: per(lost.mana.recovered) },
      stamina: { wound: per(lost.stamina.wound), status: per(lost.stamina.status), fatigue: per(lost.stamina.fatigue), recovered: per(lost.stamina.recovered) },
    },
  };
}

/** The pool-aware AI against the previous brain: one aware seat, alternated so seat bias cancels. */
export interface AwareStudy {
  matches: number;
  seed: number;
  /** Matches (over both passes) where both seats consult a brain (strategy basic/full). */
  counted: number;
  decisive: number;
  awareWins: number;
  /** awareWins / decisive and its standard error. */
  awareWinRate: number;
  se: number;
  byStrategy: Record<string, { decisive: number; awareWins: number; rate: number }>;
}

export function awareStudy(matches: number, seed: number, parts?: { press: boolean; conserve: boolean }): AwareStudy {
  // Two passes over the SAME design points: pass A makes seat 0 aware, pass B seat 1 — so every
  // matchup is played both ways and the seat order cancels.
  const passA = runBatch({ matches, seed, design: "random", sim: { poolAware: [true, false], poolAwareParts: parts } });
  const passB = runBatch({ matches, seed, design: "random", sim: { poolAware: [false, true], poolAwareParts: parts } });
  let counted = 0, decisive = 0, awareWins = 0;
  const byStrategy: AwareStudy["byStrategy"] = {};
  const tally = (recs: MatchRecord[], awareSeat: 0 | 1) => {
    for (const r of recs) {
      // Only matchups where BOTH seats consult a brain: then every design point is counted in both
      // passes and a no-op awareness scores exactly 0.5 (counting one-brain matchups biased the
      // estimate toward the stronger strategy: measured 0.529 with every aware decision switched off).
      const strat = r.conditions.fighters[awareSeat].strategy, other = r.conditions.fighters[1 - awareSeat].strategy;
      if (strat === "none" || other === "none") continue;
      counted++;
      const w = r.outcome.winner;
      if (w === null) continue;
      decisive++;
      const won = w === awareSeat ? 1 : 0;
      awareWins += won;
      const b = byStrategy[`${strat}-vs-${other}`] ??= { decisive: 0, awareWins: 0, rate: 0 };
      b.decisive++; b.awareWins += won;
    }
  };
  tally(passA, 0);
  tally(passB, 1);
  for (const b of Object.values(byStrategy)) b.rate = r4(b.awareWins / Math.max(1, b.decisive));
  const p = awareWins / Math.max(1, decisive);
  return { matches, seed, counted, decisive, awareWins, awareWinRate: r4(p), se: r4(Math.sqrt(p * (1 - p) / Math.max(1, decisive))), byStrategy };
}
