// Wave FALL (agent M): the measurement behind docs/wave-fall/MECHANICS.md — what collisions, falls and
// the downed penalties do to the headless MatchSim (end reasons, duel length, class shares, falls per
// match, down time, damage taken while down) and what the fall-aware AI is worth against the previous
// brain. Pure over runBatch; the runner is src/balance/fall-study.ts (writes artifacts/wave-fall/mech-balance.json).

import type { MatchRecord } from "../game/arena/contracts.ts";
import { runBatch } from "./Batch.ts";
import type { SimEvent, SimOptions } from "./MatchSim.ts";
import { truceSeconds } from "../game/Disposition.ts";
import { STUDY_CLASSES } from "./PotentialStudy.ts";

export interface FallSummary {
  label: string;
  matches: number;
  seed: number;
  decisive: number;
  reasons: Record<string, number>;
  ringOutShare: number;
  koShare: number;
  classWinShare: Record<string, number>;
  meanAbsDev: number;
  /** Median decisive duration incl. the truce, and the hostile duel alone, s. */
  medianDuration: number;
  medianDuelSeconds: number;
  /** Per match (both seats together): collisions, staggers, stumbles, falls; mean seconds downed per fall. */
  collisionsPerMatch: number;
  staggersPerMatch: number;
  stumblesPerMatch: number;
  fallsPerMatch: number;
  meanDownS: number;
  /** Share of all damage dealt that landed on a downed body. */
  damageWhileDownShare: number;
  /** Falls by cause (share of all falls). */
  causes: Record<string, number>;
}

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Summarise a batch's records (shares of decisive non-mirror appearances, as PotentialStudy.classStudy). */
export function summariseFalls(label: string, seed: number, records: readonly MatchRecord[]): FallSummary {
  const wins: Record<string, number> = {}, apps: Record<string, number> = {}, reasons: Record<string, number> = {};
  const durs: number[] = [];
  let decisive = 0, col = 0, stg = 0, stm = 0, fal = 0, down = 0, dmgDown = 0, dmg = 0;
  const causes: Record<string, number> = {};
  for (const r of records) {
    const o = r.outcome;
    reasons[o.reason] = (reasons[o.reason] ?? 0) + 1;
    dmg += o.damageDealt[0] + o.damageDealt[1];
    const f = o.forces;
    if (f) {
      col += f.collisions[0]; stg += f.staggers[0] + f.staggers[1]; stm += f.stumbles[0] + f.stumbles[1]; fal += f.falls[0] + f.falls[1];
      down += f.downS[0] + f.downS[1]; dmgDown += f.damageWhileDown[0] + f.damageWhileDown[1];
      for (const [k, v] of Object.entries(f.causes)) causes[k] = (causes[k] ?? 0) + v;
    }
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
  const n = Math.max(1, records.length);
  const md = median(durs);
  const causeShare: Record<string, number> = {};
  for (const [k, v] of Object.entries(causes)) causeShare[k] = r4(v / Math.max(1, fal));
  return {
    label, matches: records.length, seed, decisive, reasons,
    ringOutShare: r4((reasons.ringout ?? 0) / n), koShare: r4((reasons.ko ?? 0) / n),
    classWinShare, meanAbsDev: r4(STUDY_CLASSES.reduce((t, c) => t + Math.abs(classWinShare[c] - 0.5), 0) / STUDY_CLASSES.length),
    medianDuration: Math.round(md * 100) / 100, medianDuelSeconds: Math.round((md - truceSeconds()) * 100) / 100,
    collisionsPerMatch: r4(col / n), staggersPerMatch: r4(stg / n), stumblesPerMatch: r4(stm / n), fallsPerMatch: r4(fal / n),
    meanDownS: r4(down / Math.max(1, fal)), damageWhileDownShare: r4(dmgDown / Math.max(1e-9, dmg)), causes: causeShare,
  };
}

/** Run `matches` random-design matches with `sim` and summarise them. */
export function fallStudy(label: string, matches: number, seed: number, sim: Omit<SimOptions, "rules"> = {}): FallSummary {
  return summariseFalls(label, seed, runBatch({ matches, seed, design: "random", sim }));
}

/** The fall-aware AI against the previous brain (both seats on the Wave FALL rules). */
export interface FallAwareStudy {
  matches: number;
  seed: number;
  counted: number;
  decisive: number;
  awareWins: number;
  awareWinRate: number;
  se: number;
  /** Hits per second the aware / unaware seat landed while the enemy was DOWNED vs STANDING. */
  hitRate: { aware: { downed: number; standing: number }; unaware: { downed: number; standing: number } };
}

/**
 * Two passes over the SAME design points (pass A: seat 0 fall-aware, pass B: seat 1), counting only
 * matchups where both seats consult a brain (skill pitfall 30). `aware` false in both passes is the no-op
 * control: it must read exactly 0.5.
 */
export function fallAwareStudy(matches: number, seed: number, aware = true): FallAwareStudy {
  let counted = 0, decisive = 0, awareWins = 0;
  const hr = { aware: { dh: 0, sh: 0, dt: 0, st: 0 }, unaware: { dh: 0, sh: 0, dt: 0, st: 0 } };
  for (const awareSeat of [0, 1] as const) {
    const flags: [boolean, boolean] = awareSeat === 0 ? [aware, false] : [false, aware];
    const records: MatchRecord[] = [];
    // Per match: hits by each seat on a downed / standing enemy, and the seconds each enemy was downed.
    const perMatch: { hits: [[number, number], [number, number]] }[] = [];
    let cur = { hits: [[0, 0], [0, 0]] as [[number, number], [number, number]] };
    runBatch({
      matches, seed, design: "random",
      sim: {
        fallAware: flags,
        trace: (e: SimEvent) => {
          if (e.kind !== "hit") return;
          const downed = e.phase === "down" || e.phase === "rising";
          cur.hits[e.seat][downed ? 0 : 1]++;
        },
      },
      onRecord: (r) => { records.push(r); perMatch.push(cur); cur = { hits: [[0, 0], [0, 0]] }; },
    });
    records.forEach((r, i) => {
      const strat = r.conditions.fighters[awareSeat].strategy, other = r.conditions.fighters[1 - awareSeat].strategy;
      if (strat === "none" || other === "none") return;
      counted++;
      const o = r.outcome, f = o.forces;
      const hostile = Math.max(0, o.duration - truceSeconds());
      for (const seat of [0, 1] as const) {
        const enemy = 1 - seat, bucket = seat === awareSeat ? hr.aware : hr.unaware;
        const downS = f ? f.downS[enemy] : 0;
        bucket.dh += perMatch[i].hits[seat][0]; bucket.sh += perMatch[i].hits[seat][1];
        bucket.dt += downS; bucket.st += Math.max(0, hostile - downS);
      }
      if (o.winner === null) return;
      decisive++;
      if (o.winner === awareSeat) awareWins++;
    });
  }
  const p = awareWins / Math.max(1, decisive);
  const rate = (h: number, t: number) => r4(h / Math.max(1e-9, t));
  return {
    matches, seed, counted, decisive, awareWins, awareWinRate: r4(p), se: r4(Math.sqrt(p * (1 - p) / Math.max(1, decisive))),
    hitRate: {
      aware: { downed: rate(hr.aware.dh, hr.aware.dt), standing: rate(hr.aware.sh, hr.aware.st) },
      unaware: { downed: rate(hr.unaware.dh, hr.unaware.dt), standing: rate(hr.unaware.sh, hr.unaware.st) },
    },
  };
}
