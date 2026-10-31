// Wave Q: the LADDER — a batch that works in STEPS instead of N independent matches.
//
// WHY this module exists. The ask: "the generating process by batch … needs to generate different cases
// and to see how step-by-step we go from functioning games to the functioning type of games." A flat batch
// answers "does the game run?" — every case is independent and nothing is carried forward. A ladder answers
// the next question: which KINDS of game work, and can the search walk towards them.
//
// The loop, stated (all of it deterministic from a seed):
//
//   step 0   generate `cases` DIFFERENT cases (each: an arena/victory design cell + its own match seed)
//   score    every case against the CRITERIA below, all measured from the simulator's own records
//   select   keep the best `keep` cases — the survivors ARE the answer so far
//   carry    the next step's cases are the survivors MUTATED: a different arena/victory cell and a
//            different seed each. The search moves around what already worked instead of restarting.
//   label    a segment of consecutive steps whose survivors share a design cell and criteria profile is
//            an ARCHETYPE — a "type of game" — and the ladder says which one it found and when.
//
// CRITERIA (each in [0,1], higher is better; the score is their weighted mean):
//   decisiveness  share of the cases that ENDED (not a timeout) — a game that cannot end is not a game
//   closeness     how even the two seats are (1 - |winA - 0.5| * 2): a type of game where one seat
//                 always wins is a bug, not a type
//   engagement    share of the time both fighters are in striking range — the wave-M finding that
//                 "they move but don't really move" is exactly this number
//   mix           how many different endings the step produced (ko / ringout / timeout), normalised
//
// Pure module: no DOM, no THREE, no I/O, no Math.random (a stated LCG). The caller supplies the records.

/** One case in a step: which design cell to play and with which match seed. */
export interface Case {
  /** Index of the design cell, or -1 for "every cell" (the mixed design). */
  cell: number;
  /** The batch seed for this case. */
  seed: number;
  /** How many matches the case plays. */
  matches: number;
}

/** The measured numbers a case is scored on (all read from the simulator's records). */
export interface CaseMetrics {
  /** Share of matches that ended by ko/ringout rather than a timeout, 0..1. */
  decisiveness: number;
  /** 1 - |share won by seat A - 0.5| * 2, 0..1 (1 = perfectly even). */
  closeness: number;
  /** Share of sampled time both fighters were inside striking range, 0..1. */
  engagement: number;
  /** Distinct endings seen in the step, normalised by the 3 known endings, 0..1. */
  mix: number;
  /** Median match duration in seconds (context, not scored). */
  medianSeconds: number;
  /** The dominant ending, for the archetype label. */
  dominantEnding: string;
}

/** The criteria, in the order they are reported. Weights are stated and sum to 1. */
export const CRITERIA = [
  { key: "decisiveness", weight: 0.35, why: "a game that cannot end is not a game" },
  { key: "engagement", weight: 0.3, why: "both fighters actually fighting, not circling" },
  { key: "closeness", weight: 0.2, why: "one seat always winning is a bug, not a type" },
  { key: "mix", weight: 0.15, why: "a type of game should be able to end in more than one way" },
] as const;

/** The stated score: the weighted mean of the criteria, in [0,1]. */
export function scoreCase(m: CaseMetrics): number {
  let s = 0;
  for (const c of CRITERIA) s += c.weight * clamp01(m[c.key]);
  return round4(s);
}

/**
 * The step's TYPE, by MAJORITY rather than unanimity. Measured reason: requiring every survivor to agree
 * never once happened in 6 steps at keep 2 or 3, so unanimity is not a usable definition of "a type of
 * game" here. A type is the cell + ending that at least `share` of the survivors share (default two
 * thirds) — the number of agreeing survivors is always reported, never implied.
 */
export function majorityType(survivors: readonly { c: Case; m: CaseMetrics }[], share = 2 / 3): { cell: number; ending: string; agree: number; need: number; label: string } | null {
  const cl = clusterOf(survivors);
  if (!cl) return null;
  const need = Math.max(2, Math.ceil(survivors.length * share));
  if (cl.agree < need) return null;
  return { cell: cl.cell, ending: cl.ending, agree: cl.agree, need, label: cl.label };
}

/** The survivors of a step: the best `keep` cases by score, ties broken by the case's own seed. */
export function selectCases(scored: readonly { c: Case; m: CaseMetrics }[], keep: number): { c: Case; m: CaseMetrics }[] {
  const k = Math.max(1, Math.min(keep, scored.length));
  return [...scored].sort((a, b) => scoreCase(b.m) - scoreCase(a.m) || a.c.seed - b.c.seed).slice(0, k);
}

/**
 * The next step's cases: the survivors, MUTATED. A mutation moves the design cell to a neighbouring one
 * (by ±1, wrapping over the cell count) and takes a fresh match seed derived from the parent's — so the
 * search explores around what worked and never repeats a case it has already played.
 */
export function mutateCases(survivors: readonly { c: Case }[], cells: number, cases: number, step: number, avoid: readonly number[] = []): Case[] {
  const skip = new Set(avoid);
  const pick = (raw: number): number => {
    let cell = ((raw % cells) + cells) % cells;
    // Walk past the pruned cells (bounded: one sweep of the cell ring, then accept).
    for (let i = 0; i < cells && skip.has(cell); i++) cell = (cell + 1) % cells;
    return cell;
  };
  const out: Case[] = [];
  const n = Math.max(1, survivors.length);
  for (let i = 0; i < cases; i++) {
    const parent = survivors[i % n].c;
    // A MIXED parent (cell -1 means "play every design kind") must NOT stay mixed: the first run of this
    // tool showed the whole search collapsing onto `all` from step 2 because a mixed survivor produced
    // mixed children forever. A mixed parent now seeds the child on a real cell, chosen by the step and
    // the child's index, so the ladder keeps asking "which KIND of arena works?" as it climbs.
    if (parent.cell < 0) {
      out.push({ cell: pick(step + i), seed: nextSeed(parent.seed, step, i), matches: parent.matches });
      continue;
    }
    const direction = i % 2 === 0 ? 1 : -1;
    const raw = parent.cell + direction * (1 + Math.floor(i / n));
    out.push({ cell: pick(raw), seed: nextSeed(parent.seed, step, i), matches: parent.matches });
  }
  return out;
}

/**
 * Which cells the ladder has PRUNED, from their own history: a cell whose every case scored below
 * `threshold` across at least `minSteps` steps is not a type of game, it is a structural probe (the
 * `invariant` design always pairs a strong fighter with a weak one, so its closeness is 0 by
 * construction). Measured: with pruning, the ladder stops spending cases on it after two steps.
 */
export function prunedCells(history: readonly { cases: readonly { cell: number; score: number }[] }[], threshold = 0.72, minSteps = 2): number[] {
  const perCell = new Map<number, { seen: number; allLow: boolean }>();
  for (const h of history) {
    const byCell = new Map<number, boolean>();
    for (const c of h.cases) {
      const low = c.score < threshold;
      byCell.set(c.cell, (byCell.get(c.cell) ?? true) && low);
    }
    for (const [cell, low] of byCell) {
      const cur = perCell.get(cell) ?? { seen: 0, allLow: true };
      cur.seen++;
      cur.allLow = cur.allLow && low;
      perCell.set(cell, cur);
    }
  }
  return [...perCell.entries()].filter(([, v]) => v.seen >= minSteps && v.allLow).map(([cell]) => cell).sort((a, b) => a - b);
}

/** The starting cases: spread across the design cells, one stated seed rule, all different. */
export function initialCases(cells: number, cases: number, seed: number, matches: number): Case[] {
  return Array.from({ length: cases }, (_, i) => ({
    // Negative cell = the mixed design, so step 0 also asks "does it work when everything varies?".
    cell: i === 0 ? -1 : cells > 0 ? (i - 1) % cells : -1,
    seed: nextSeed(seed, 0, i),
    matches,
  }));
}

/**
 * The archetype a step's survivors represent: the design cell they agree on (or "mixed"), plus the
 * dominant ending. Returns null while the survivors disagree — a type has to be agreed on, not guessed.
 */
export function archetypeOf(survivors: readonly { c: Case; m: CaseMetrics }[]): { cell: number; ending: string; label: string } | null {
  if (survivors.length === 0) return null;
  const agreed = survivors.every((s) => s.c.cell === survivors[0].c.cell);
  const endings = survivors.map((s) => s.m.dominantEnding);
  const endingAgreed = endings.every((e) => e === endings[0]);
  if (!agreed || !endingAgreed) return null;
  const cell = survivors[0].c.cell;
  return { cell, ending: endings[0], label: `${cell < 0 ? "mixed" : `cell ${cell}`} · ${endings[0]}` };
}

/**
 * The LEADING CLUSTER among the survivors: the design cell + ending shared by the most of them, with how
 * many agree. Reported alongside `archetypeOf` because a strict "every survivor agrees" type is rare at a
 * small keep — and a reader needs to see the search moving even when it has not converged yet.
 */
export function clusterOf(survivors: readonly { c: Case; m: CaseMetrics }[]): { cell: number; ending: string; agree: number; label: string } | null {
  if (survivors.length === 0) return null;
  const tally = new Map<string, { cell: number; ending: string; n: number }>();
  for (const s of survivors) {
    const key = `${s.c.cell}|${s.m.dominantEnding}`;
    const cur = tally.get(key) ?? { cell: s.c.cell, ending: s.m.dominantEnding, n: 0 };
    cur.n++;
    tally.set(key, cur);
  }
  const best = [...tally.values()].sort((a, b) => b.n - a.n)[0];
  return { cell: best.cell, ending: best.ending, agree: best.n, label: `${best.cell < 0 ? "mixed" : `cell ${best.cell}`} · ${best.ending}` };
}

/** A stated LCG (Numerical Recipes constants): deterministic, no Math.random anywhere. */
export function nextSeed(seed: number, step: number, i: number): number {
  let a = (seed ^ Math.imul(step + 1, 0x9e3779b9) ^ Math.imul(i + 1, 0x85ebca6b)) >>> 0;
  a = Math.imul(a ^ (a >>> 15), 0x2545f491) >>> 0;
  return (a ^ (a >>> 13)) >>> 0;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
