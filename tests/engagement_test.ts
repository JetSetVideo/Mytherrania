// Wave M (lane M-B): the engagement intent — its contract, its self-limiting pull and its wiring
// into the decision tree. The stand-off bound is measured THROUGH lane M-A's FightTelemetry
// (standoffMaxS = the longest stretch with no hit while the pair is beyond CIRCLING_M).
import { decide, defaultTree, type CombatView } from "../src/game/DecisionTree.ts";
import {
  BAND_MARGIN,
  CIRCLING_M,
  CONTACT_M,
  engagement,
  type EngagementInput,
  type EngagementIntent,
  intentRank,
  pullToClose,
  QUIET_CLOSE_S,
  STRIKING_M,
} from "../src/game/Engagement.ts";
import { createTelemetry, telemetrySummary } from "../src/game/FightTelemetry.ts";

function assert(ok: unknown, msg: string): asserts ok { if (!ok) throw new Error(msg); }

function input(over: Partial<EngagementInput> = {}): EngagementInput {
  return {
    distance: 8, selfReach: 1.8, quietS: 0, selfReady: true, enemyAttacking: false,
    selfHpRatio: 1, enemyHpRatio: 1, stance: "neutral", ...over,
  };
}
function view(over: Partial<CombatView> = {}): CombatView {
  return {
    distance: 8, selfReach: 1.8, enemyReach: 1.8, selfHpRatio: 1, enemyHpRatio: 1,
    nearEdge: false, ready: true, enemyAttacking: 0, selfDamagePercent: 0, enemyDamagePercent: 0,
    roundTime: 0, ...over,
  };
}

Deno.test("M-B E1: pullToClose is bounded, monotone and saturates at QUIET_CLOSE_S", () => {
  assert(pullToClose(0) === 0, "no quiet -> no pull");
  assert(pullToClose(QUIET_CLOSE_S) === 1, "QUIET_CLOSE_S -> full pull");
  assert(pullToClose(QUIET_CLOSE_S * 10) === 1, "bounded above");
  assert(pullToClose(-5) === 0 && pullToClose(NaN) === 0, "coerced, never NaN");
  let prev = -1;
  for (let q = 0; q <= 6; q += 0.25) {
    const p = pullToClose(q);
    assert(p >= 0 && p <= 1, `pull in [0,1] at ${q}: ${p}`);
    assert(p >= prev, `pull non-decreasing at ${q}: ${p} < ${prev}`);
    prev = p;
  }
});

Deno.test("M-B E2: inside the striking band the intent is never 'approach' (never walk past it)", () => {
  const band = 1.8 * BAND_MARGIN;
  for (const d of [0, CONTACT_M, 1.5, band - 1e-6, band]) {
    const e = engagement(input({ distance: d }));
    assert(e.inBand && e.intent !== "approach", `in band at ${d} m: ${e.intent}`);
  }
  // Just outside the band, a live fighter closes.
  assert(engagement(input({ distance: band + 0.01 })).intent === "approach", "just out of band -> approach");
});

Deno.test("M-B E3: the in-band intents answer readiness and the enemy's blow", () => {
  const inBand = { distance: 1.0 }; // reach 1.8 -> band 2.07
  assert(engagement(input({ ...inBand, selfReady: true })).intent === "hold", "ready in band -> hold (swing)");
  assert(engagement(input({ ...inBand, selfReady: false, enemyAttacking: true })).intent === "circle", "their blow coming -> circle");
  assert(engagement(input({ ...inBand, selfReady: false, enemyAttacking: false, stance: "aggressive" })).intent === "hold", "aggressive idle -> hold");
  assert(engagement(input({ ...inBand, selfReady: false, enemyAttacking: false, stance: "neutral" })).intent === "bait", "neutral idle -> bait");
});

Deno.test("M-B E4: a stand-off is self-limiting — approach within QUIET_CLOSE_S, monotone intent", () => {
  // A losing, defensive fighter out of band slips away while the fight is alive...
  const losing = { distance: 8, selfHpRatio: 0.1, enemyHpRatio: 0.9, stance: "defensive" } as const;
  assert(engagement(input({ ...losing, quietS: 0 })).intent === "disengage", "losing slip at quiet 0");
  assert(engagement(input({ ...losing, quietS: QUIET_CLOSE_S - 1e-9 })).intent === "disengage", "still slips until the pull saturates");
  // ...but the pull overrides the slip exactly when the quiet saturates.
  assert(engagement(input({ ...losing, quietS: QUIET_CLOSE_S })).intent === "approach", "quiet saturates -> approach");
  // A healthy fighter closes immediately (the stand-off's own cure).
  assert(engagement(input({ distance: 8, quietS: 0 })).intent === "approach", "healthy out of band -> approach at once");
  // Intent rank is non-decreasing in quietS over the whole sweep.
  let prev = -1;
  for (let q = 0; q <= QUIET_CLOSE_S * 2; q += 0.1) {
    const r = intentRank(engagement(input({ ...losing, quietS: q })).intent);
    assert(r >= prev, `intent rank fell at quiet ${q.toFixed(2)}: ${r} < ${prev}`);
    prev = r;
  }
  // Bounded time: approach no later than QUIET_CLOSE_S, for every stance / health.
  for (const stance of ["aggressive", "neutral", "defensive"] as const) {
    for (const hp of [0.05, 0.5, 0.95]) {
      const at = engagement(input({ distance: 8, selfHpRatio: hp, enemyHpRatio: 0.5, stance, quietS: QUIET_CLOSE_S })).intent;
      assert(at === "approach", `${stance}/${hp}: expected approach at QUIET_CLOSE_S, got ${at}`);
    }
  }
});

Deno.test("M-B E5: engagement is deterministic and total (never NaN)", () => {
  const a = engagement(input({ distance: 9, quietS: 1.2, stance: "defensive", selfHpRatio: 0.2, enemyHpRatio: 0.8 }));
  const b = engagement(input({ distance: 9, quietS: 1.2, stance: "defensive", selfHpRatio: 0.2, enemyHpRatio: 0.8 }));
  assert(JSON.stringify(a) === JSON.stringify(b), "same input -> same engagement");
  const broken = engagement(input({ distance: NaN, selfReach: NaN, quietS: NaN, selfHpRatio: NaN, enemyHpRatio: NaN }));
  assert(broken.intent !== undefined && Number.isFinite(broken.pull), "broken input still yields a finite intent");
  assert(engagement(input({ distance: -4 })).inBand, "a negative distance reads as in-band (hold it)");
});

Deno.test("M-B E6: the decision tree acts on the intent (wiring)", () => {
  const tree = defaultTree();
  // Near the edge with the enemy far beyond the band: the hook turns the old 'retreat' into 'advance'.
  assert(decide(tree, view({ nearEdge: true, distance: 24, ready: true })) === "advance", "stand-off near edge -> advance");
  // Inside the band near the edge the pre-Wave-M survival logic is untouched (retreat).
  assert(decide(tree, view({ nearEdge: true, distance: 2 })) === "retreat", "in-band near edge stays retreat");
  // The hook is only on the near-edge branch: away from the edge nothing changed.
  assert(decide(tree, view({ nearEdge: false, distance: 5, ready: true })) === "advance", "away from edge: advance as before");
  // A present quiet stretch is honoured: a losing defensive fighter out of band still turns in at saturation.
  assert(decide(tree, view({ nearEdge: true, distance: 24, selfHpRatio: 0.1, enemyHpRatio: 0.9, stance: "defensive", quietS: 0 })) === "retreat", "losing + quiet 0: slip (survival logic)");
  assert(decide(tree, view({ nearEdge: true, distance: 24, selfHpRatio: 0.1, enemyHpRatio: 0.9, stance: "defensive", quietS: QUIET_CLOSE_S })) === "advance", "losing + quiet saturated: turn in");
});

Deno.test("M-B E7: over a scripted 60 s stand-off the produced standoffMaxS (through M-A) is bounded", () => {
  // Two scripted fighters start 24 m apart (beyond CIRCLING_M) and never land a hit; each steers
  // by the engagement intent. The measured standoffMaxS must stay well under the 60 s horizon.
  const MOVE = 4.2, dt = 1 / 30;
  function run(over: Partial<EngagementInput>): number {
    const acc = createTelemetry();
    let dist = 24;
    let quiet = 0;
    for (let t = 0; t < 60; t += dt) {
      const e = engagement(input({ ...over, distance: dist, quietS: quiet }));
      if (e.intent === "approach") dist = Math.max(0, dist - 2 * MOVE * dt);
      else if (e.intent === "disengage") dist += 2 * MOVE * dt;
      quiet += dt;
      acc.step(dt, dist);
    }
    return telemetrySummary(acc).engagement.standoffMaxS;
  }
  const healthy = run({});
  const losing = run({ selfHpRatio: 0.1, enemyHpRatio: 0.9, stance: "defensive" });
  assert(healthy <= QUIET_CLOSE_S + 0.1, `healthy stand-off ${healthy.toFixed(2)} s`);
  // Worst case: the losing fighter slips for QUIET_CLOSE_S then closes; still bounded well under 60.
  assert(losing > healthy && losing <= QUIET_CLOSE_S + (24 + 2 * MOVE * QUIET_CLOSE_S - CIRCLING_M) / (2 * MOVE) + 0.1, `losing stand-off ${losing.toFixed(2)} s bounded`);
  assert(losing <= 15, `losing stand-off ${losing.toFixed(2)} s < 15`);
});

Deno.test("M-B E8: STRIKING_M is the tree's band edge and CONTACT_M < STRIKING_M < CIRCLING_M", () => {
  assert(CONTACT_M < STRIKING_M && STRIKING_M < CIRCLING_M, "band edges are ordered");
  const intents: EngagementIntent[] = ["approach", "hold", "circle", "disengage", "bait"];
  assert(intents.every((i) => Number.isFinite(intentRank(i))), "every intent has a rank");
});
