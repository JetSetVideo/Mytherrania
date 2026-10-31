// Lane N-C: perception — what one seat may believe about a concealed other.
//
// Covers: the belief carries the truth only when the other is in sight; while concealed it
// carries the LAST KNOWN position (or nothing once the memory lapses) and NEVER the true
// position; confidence decays with age and re-acquires on reveal; the probable strategy is a
// behavioural id (lane N-B) that maps down to a decision the shipped tree can actually take;
// and the module is total under NaN. Pure fixtures: fixed positions and times, no randomness,
// no clock.

import { STRATEGY_IDS } from "../src/game/MatchReport.ts";
import { STRATEGY_IDS_ALL, STRATEGY_LEAVES } from "../src/game/Strategies.ts";
import {
  beliefTarget,
  CONFIDENCE_START,
  CONCEALED_STRATEGY,
  isStrategyId,
  perceive,
  VISIBLE_STRATEGY,
  type Belief,
} from "../src/game/Perception.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok {
  if (!ok) throw new Error(m);
}

Deno.test("perceive: in sight is the truth — position, age 0, confidence 1", () => {
  const b = perceive({
    viewer: { x: 0, z: 0 },
    other: { x: 12, z: -4 },
    otherConcealed: false,
    lastKnown: { x: 1, z: 1 }, // stale memory is ignored while the enemy is visible
    sinceLastSeenS: 9,
    memoryS: 8,
  });
  assert(b.knowsPosition, "sees the other");
  assert(b.lastKnown !== null && b.lastKnown.x === 12 && b.lastKnown.z === -4, "true position");
  assert(b.ageS === 0, "age resets on sight");
  assert(b.confidence01 === 1, "certain");
  assert(b.probableStrategy === VISIBLE_STRATEGY, "visible read");
});

Deno.test("perceive: concealed belief NEVER carries the true position", () => {
  const other = { x: 50, z: 50 };
  const memory = { x: 10, z: 10 };
  const b = perceive({
    viewer: { x: 0, z: 0 },
    other,
    otherConcealed: true,
    lastKnown: memory,
    sinceLastSeenS: 1,
    memoryS: 8,
  });
  assert(!b.knowsPosition, "cannot claim to know the position while concealed");
  assert(b.lastKnown !== null, "still has the last known place");
  // THE ASSERTION THIS LANE EXISTS FOR: the true position is absent.
  assert(b.lastKnown!.x !== other.x || b.lastKnown!.z !== other.z, "belief != true position");
  assert(b.lastKnown!.x === memory.x && b.lastKnown!.z === memory.z, "belief is the memory");
  // The whole serialized belief must not contain the true coordinates anywhere.
  assert(!JSON.stringify(b).includes(`${other.x}`), "true x absent from the whole belief");
  assert(!JSON.stringify(b).includes(`${other.z}`), "true z absent from the whole belief");
  assert(b.probableStrategy === CONCEALED_STRATEGY, "the vanish reads as a strategy");
  assert(b.probableStrategy === "hide", "that read is \"hide\"");
});

Deno.test("perceive: confidence decays monotonically with age", () => {
  const base = {
    viewer: { x: 0, z: 0 },
    other: { x: 50, z: 50 },
    otherConcealed: true,
    lastKnown: { x: 1, z: 1 },
    memoryS: 8,
  } as const;
  let prev = Number.POSITIVE_INFINITY;
  const series: number[] = [];
  for (const since of [0, 2, 4, 6, 8]) {
    const b = perceive({ ...base, sinceLastSeenS: since });
    series.push(b.confidence01);
    assert(b.confidence01 <= prev, `confidence must not rise with age (at ${since}s)`);
    prev = b.confidence01;
  }
  assert(series[0] === CONFIDENCE_START, "fresh vanish starts at CONFIDENCE_START");
  assert(series[series.length - 1] === 0, "confidence bottoms out at the memory horizon");
});

Deno.test("perceive: memory lapses to null at the horizon", () => {
  const b = perceive({
    viewer: { x: 0, z: 0 },
    other: { x: 5, z: 5 },
    otherConcealed: true,
    lastKnown: { x: 2, z: 2 },
    sinceLastSeenS: 8,
    memoryS: 8,
  });
  assert(b.lastKnown === null, "forgotten at the horizon");
  assert(b.ageS === 8, "age clamped to the horizon");
  assert(beliefTarget(b) === null, "no target once forgotten");
});

Deno.test("perceive: re-acquires on reveal", () => {
  const other = { x: 7, z: 9 };
  let b: Belief = perceive({
    viewer: { x: 0, z: 0 }, other, otherConcealed: true,
    lastKnown: { x: 1, z: 1 }, sinceLastSeenS: 4, memoryS: 8,
  });
  assert(!b.knowsPosition && b.confidence01 < 1, "concealed: unsure");
  b = perceive({
    viewer: { x: 0, z: 0 }, other, otherConcealed: false,
    lastKnown: { x: 1, z: 1 }, sinceLastSeenS: 4, memoryS: 8,
  });
  assert(b.knowsPosition && b.confidence01 === 1, "revealed: certain again");
  assert(beliefTarget(b)!.x === 7 && beliefTarget(b)!.z === 9, "target is the true position");
});

Deno.test("perceive: total under NaN — a bad number cannot poison the belief", () => {
  const b = perceive({
    viewer: { x: 0, z: 0 }, other: { x: Number.NaN, z: Number.NaN }, otherConcealed: true,
    lastKnown: { x: 3, z: 3 }, sinceLastSeenS: Number.NaN, memoryS: Number.NaN,
  });
  assert(b.ageS === 0, "NaN age folds to 0");
  assert(Number.isFinite(b.confidence01) && b.confidence01 === CONFIDENCE_START, "NaN memoryS refused to 1 → full confidence at age 0");
  assert(b.lastKnown !== null && b.lastKnown.x === 3 && b.lastKnown.z === 3, "memory survives; true (NaN) position never enters");
});

Deno.test("perception vocabulary: the read is a real behaviour that maps to a real tree leaf", () => {
  for (const id of [VISIBLE_STRATEGY, CONCEALED_STRATEGY]) {
    assert(isStrategyId(id), `${id} must be a shared behavioural strategy`);
    assert((STRATEGY_IDS_ALL as readonly string[]).includes(id), `${id} must be in N-B's STRATEGY_IDS_ALL`);
    // "a belief must name a decision the tree can actually take": every leaf the behaviour
    // prefers must be a leaf a shipped tree really emits (Wave M's STRATEGY_IDS).
    const leaves = STRATEGY_LEAVES[id];
    assert(leaves.length > 0, `${id} must prefer at least one leaf`);
    for (const leaf of leaves) assert(STRATEGY_IDS.includes(leaf), `${id} -> leaf ${leaf} must be a real tree decision`);
  }
  assert(CONCEALED_STRATEGY === "hide" && STRATEGY_LEAVES.hide.includes("retreat"), "hide -> retreat");
  assert(!isStrategyId("retreat"), "a tree leaf is not a behavioural strategy id");
});
