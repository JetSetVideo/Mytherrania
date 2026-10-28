// Instant-battle corpus generator: thousands of fights fought with NO rendering,
// across a sampled parameter space, each feeding the neural models' digest.
//
// The user asked for "instant battles that don't need to be fought visually":
// this module runs the same duel model the balance harness uses, extended with
// the varied win conditions (WinConditions.ts) and a per-side Telemetry, then
// returns one CorpusRecord per fight with every parameter and the folded stats.
// tools/battle-corpus.ts calls runCorpus() and writes the records to disk; the
// engine never imports this module — it is offline training data.
//
// Pure module: no Three.js, no DOM.

import { attackDamage, CLASSES, createStats, type ClassName } from "../game/Stats.ts";
import { applyRaceBonus, RACES } from "../game/Races.ts";
import { bodyFromStats, physicsMultiplier } from "../game/Physics.ts";
import { HARNESS_CLOSING_SPEED, randomSource } from "./ArenaHarness.ts";
import { evaluateWin, rollWinCondition, suddenDeathArmed, type WinCondition, type WinParams } from "../game/WinConditions.ts";
import { fold, type Stats } from "../game/AiStats.ts";
import { makeIdentity } from "../game/Identity.ts";

/** The dimensions a match-up is sampled over — the axes of the multidimensional space. */
export interface MatchupAxis {
  classA: ClassName;
  classB: ClassName;
  raceA: string;
  raceB: string;
  arenaSize: number;      // m across, 2..320
  winCondition: WinCondition;
  winParams: WinParams;
}

/** One simulated fight, fully described. */
export interface CorpusRecord {
  axis: MatchupAxis;
  winner: 0 | 1 | null;
  reason: string;
  duration: number;        // hostile seconds
  exchanges: number;
  dealtA: Stats;
  dealtB: Stats;
  /** Distances run by each side (a proxy for the live engine's telemetry). */
  distanceA: number;
  distanceB: number;
  /** Where this fight sits in the sampled space (0..1 on each axis, for plotting). */
  coords: number[];
}

/** Bounds the corpus samples over — the "opposite extremes" of each axis. */
export const CORPUS_BOUNDS = {
  arenaSize: [2, 320] as [number, number],
  exchangesCap: 600,
};

export interface CorpusOptions {
  seed: number;
  fights: number;
  /** Probability weight shifts over the run: early fights favour KO, later ones
   *  force the rarer conditions so the corpus covers them. */
  exploreBias: number; // 0..1
}

const clamp = (v: number, [lo, hi]: [number, number]) => Math.max(lo, Math.min(hi, v));

/** Normalise an axis to a 0..1 coordinate per dimension (for multidimensional plotting). */
export function axisCoords(axis: MatchupAxis): number[] {
  return [
    CLASSES.indexOf(axis.classA) / (CLASSES.length - 1),
    CLASSES.indexOf(axis.classB) / (CLASSES.length - 1),
    RACES.findIndex((r) => r.id === axis.raceA) / Math.max(1, RACES.length - 1),
    RACES.findIndex((r) => r.id === axis.raceB) / Math.max(1, RACES.length - 1),
    (axis.arenaSize - CORPUS_BOUNDS.arenaSize[0]) / (CORPUS_BOUNDS.arenaSize[1] - CORPUS_BOUNDS.arenaSize[0]),
    ["ko", "sudden-death", "endurance", "domination"].indexOf(axis.winCondition.kind) / 3,
  ];
}

/**
 * Sample a match-up. The rng drives everything; `explore` (0..1) shifts the win
 * condition away from plain KO toward the rarer endings, so the corpus is not
 * 50% one ending.
 */
export function sampleMatchup(rng: () => number, explore: number): MatchupAxis {
  const classA = CLASSES[Math.floor(rng() * CLASSES.length)];
  let classB = CLASSES[Math.floor(rng() * CLASSES.length)];
  if (classB === classA) classB = CLASSES[(CLASSES.indexOf(classA) + 1) % CLASSES.length];
  const raceA = RACES[Math.floor(rng() * RACES.length)].id;
  const raceB = RACES[Math.floor(rng() * RACES.length)].id;
  const arenaSize = clamp(2 + rng() * 318, CORPUS_BOUNDS.arenaSize);

  // Win condition: KO stays the floor, but `explore` pushes mass onto the rest.
  const { cond, params } = rollWinCondition(rng);
  let winCondition = cond;
  if (rng() < explore) {
    const rare: WinCondition[] = [
      { kind: "sudden-death", label: "sudden death" },
      { kind: "endurance", label: "endurance" },
      { kind: "domination", label: "domination" },
    ];
    winCondition = rare[Math.floor(rng() * rare.length)];
  }
  return { classA, classB, raceA, raceB, arenaSize, winCondition, winParams: params };
}

/**
 * Simulate one fight (no rendering) and return its record. Death always ends a
 * fight; the rolled win condition adds its own ending on top. Sudden-death ends
 * on the first exchange after its deadline.
 */
export function simulateBattle(axis: MatchupAxis, rng: () => number): CorpusRecord {
  const baseA = applyRaceBonus(createStats(axis.classA), axis.raceA, null);
  const baseB = applyRaceBonus(createStats(axis.classB), axis.raceB, null);
  const physA = physicsMultiplier(bodyFromStats(baseA), bodyFromStats(baseB), HARNESS_CLOSING_SPEED);
  const physB = physicsMultiplier(bodyFromStats(baseB), bodyFromStats(baseA), HARNESS_CLOSING_SPEED);

  let hpA = baseA.maxHealth, hpB = baseB.maxHealth;
  let tA = baseA.attackInterval, tB = baseB.attackInterval;
  const dealtA: number[] = [], dealtB: number[] = [];
  const randA = rng, randB = rng;
  const interval = Math.min(baseA.attackInterval, baseB.attackInterval);
  let hostile = 0;

  for (let t = 0; t < CORPUS_BOUNDS.exchangesCap; t++) {
    const aGo = tA <= tB + 0.0005, bGo = tB <= tA + 0.0005;
    if (aGo) tA += baseA.attackInterval;
    if (bGo) tB += baseB.attackInterval;

    let hitA = 0, hitB = 0;
    if (aGo) { hitA = attackDamage(baseA, baseB, randA(), randA()) * physA; hpB -= hitA; dealtA.push(hitA); }
    if (bGo) { hitB = attackDamage(baseB, baseA, randB(), randB()) * physB; hpA -= hitB; dealtB.push(hitB); }
    hostile += interval;

    // Sudden-death: after the deadline, the first landed hit ends it.
    if (axis.winCondition.kind === "sudden-death" && suddenDeathArmed(axis.winParams, hostile) && (hitA > 0 || hitB > 0)) {
      const winner = hitA > 0 ? 0 : 1;
      return record(axis, winner, "sudden-death", hostile, dealtA, dealtB);
    }

    const verdict = evaluateWin(axis.winCondition, axis.winParams, {
      hostileTime: hostile, hpA, hpB, maxHpA: baseA.maxHealth, maxHpB: baseB.maxHealth,
      dealtA: dealtA.reduce((a, b) => a + b, 0), dealtB: dealtB.reduce((a, b) => a + b, 0),
    });
    if (verdict.over) return record(axis, verdict.winner, verdict.reason, hostile, dealtA, dealtB);
  }
  // Cap reached: decide by remaining HP so the corpus has no unresolved fights.
  const winner = hpA === hpB ? null : hpA > hpB ? 0 : 1;
  return record(axis, winner, "timeout", hostile, dealtA, dealtB);
}

function record(axis: MatchupAxis, winner: 0 | 1 | null, reason: string, duration: number, dealtA: number[], dealtB: number[]): CorpusRecord {
  return {
    axis,
    winner,
    reason,
    duration,
    exchanges: dealtA.length + dealtB.length,
    dealtA: fold(dealtA),
    dealtB: fold(dealtB),
    distanceA: dealtA.length * 0.5, // proxy: each attack is a step toward the enemy
    distanceB: dealtB.length * 0.5,
    coords: axisCoords(axis),
  };
}

/** Run `fights` instant battles and return every record. */
export function runCorpus(opts: CorpusOptions): CorpusRecord[] {
  const rng = randomSource(opts.seed);
  const out: CorpusRecord[] = [];
  for (let i = 0; i < opts.fights; i++) {
    // Explore ramps over the run: later fights sample the rarer conditions harder.
    const explore = clamp(opts.exploreBias * (i / Math.max(1, opts.fights - 1)), [0, 1]);
    const axis = sampleMatchup(rng, explore);
    out.push(simulateBattle(axis, rng));
  }
  return out;
}

/** Identity for a simulated side (so the corpus names its fighters). */
export function fighterTag(axis: MatchupAxis, side: 0 | 1, seed: number): string {
  return makeIdentity(seed ^ (side === 0 ? 0x1111 : 0x2222)).full + ` (${side === 0 ? axis.classA : axis.classB})`;
}
