// Wave M, lane M-E: the end-of-match report payload and the update review gate.
//
// Covers: the report carries both fighters' telemetry and the opponent model
// (behaviour + a real strategy distribution); the privacy claim is ASSERTED
// (no name, no personal id, no raw coordinate array, and a byte cap); and the
// review gate takes accept / defer / refuse, keeps a deferred update queued with
// its reason, and lets auto mode apply only what its policy allows — recording
// why in every case. Pure fixtures: fixed numbers, no randomness, no clock.
import {
  applyVerdict,
  autoVerdict,
  buildReport,
  encodedBytes,
  emptyQueue,
  isPersonalData,
  mergeQueues,
  REPORT_BYTE_CAP,
  REPORT_SCHEMA,
  STRATEGY_IDS,
  treeStrategyIds,
  type AutoPolicy,
  type FightTelemetry,
  type HitStat,
  type MatchReport,
  type QueuedUpdate,
} from "../src/game/MatchReport.ts";
import { defaultTree, edgeAwareTree } from "../src/game/DecisionTree.ts";

function assert(ok: unknown, msg: string): asserts ok { if (!ok) throw new Error(msg); }
function assertThrows(fn: () => unknown, msg: string): void {
  let threw = false;
  try { fn(); } catch { threw = true; }
  assert(threw, msg);
}

/** A HitStat with a derived mean (0 when empty): the M-A shape. */
function hs(count: number, total: number, max: number): HitStat {
  return { count, total, max, mean: count > 0 ? total / count : 0 };
}

/** A complete telemetry for a match of `durationS` seconds, all numbers fixed. */
function telemetry(durationS: number): FightTelemetry {
  return {
    durationS,
    dryStreak: [
      { count: 3, totalS: 40, meanS: 40 / 3, maxS: 22, minS: 6 },
      { count: 2, totalS: 31, meanS: 15.5, maxS: 19, minS: 12 },
    ],
    mutualDryS: 18,
    quietS: 25,
    quietMaxS: 9,
    distance: { mean: 2.4, median: 2.1, min: 0.8, max: 9.5, p10: 1.1, p90: 5.2 },
    bands: { contact: 12, striking: 60, circling: 82, apart: 26 },
    engagement: { closingS: 30, contactS: 12, standoffMaxS: 9 },
    jumps: [hs(4, 6.2, 1.9), hs(2, 3.1, 1.7)],
    damageDealt: [hs(7, 210, 48), hs(5, 160, 40)],
    damageTaken: [hs(5, 160, 40), hs(7, 210, 48)],
    damageAbsorbed: [hs(3, 55, 24), hs(4, 70, 30)],
    damageByWeapon: { sword: hs(6, 180, 45), dagger: hs(1, 30, 30) },
    objects: { taken: 2, destroyed: 1, defended: 3, attacked: 5 },
    evolution: [{ level: 1, statDelta: 0 }, { level: 2, statDelta: 2 }],
  };
}

/** A queued update with the fields under test. */
function update(id: string, kind: string, confidence: number): QueuedUpdate {
  return { id, reportId: "RPT-001", kind, confidence, reason: `digested from report RPT-001 (${kind})` };
}

const FIXED_DURATION_S = 180;

Deno.test("M-E 1: the report carries both fighters' telemetry, the opponent model and a round-trippable tree", () => {
  const t0 = telemetry(FIXED_DURATION_S);
  const t1 = telemetry(FIXED_DURATION_S);
  const report = buildReport({
    id: "RPT-001",
    createdAt: "2026-10-31T12:00:00Z",
    telemetry: [t0, t1],
    opponentIndex: 1,
    probableStrategies: [{ id: "attack", weight: 0.6 }, { id: "advance", weight: 0.3 }, { id: "block", weight: 0.1 }],
    habits: { openingMove: "advance", averageApproachS: 1.8, retreatThreshold: 0.3, favouredBand: "striking" },
    outcome: "ko",
    tree: { node: "N-7", depth: 3 },
  });
  assert(report.schema === REPORT_SCHEMA, "schema version");
  assert(report.id === "RPT-001" && report.createdAt === "2026-10-31T12:00:00Z", "id and timestamp passed through");
  assert(report.telemetry[0] === t0 && report.telemetry[1] === t1, "both fighters' telemetry present in order");
  assert(report.opponent.behavior === t1, "the opponent model points at the ENEMY's side (index 1)");
  assert(report.outcome === "ko", "outcome carried");
  assert(report.tree?.node === "N-7" && report.tree?.depth === 3, "branch-tree provenance carried");
  const back = JSON.parse(JSON.stringify(report)) as MatchReport;
  assert(JSON.stringify(back) === JSON.stringify(report), "lossless JSON round trip");
  // A report without a tree omits the field entirely.
  const lean = buildReport({
    id: "RPT-002",
    createdAt: "2026-10-31T12:00:01Z",
    telemetry: [t0, t1],
    opponentIndex: 1,
    probableStrategies: [],
    habits: report.opponent.habits,
    outcome: "time-limit",
  });
  assert(!("tree" in lean), "no tree field when none is given");
});

Deno.test("M-E 2: probableStrategies is a ranked distribution over ids that really exist in the decision tree", () => {
  // The real leaves, walked from the shipped trees (never a hand-copied list).
  const ids = treeStrategyIds(defaultTree());
  assert(ids.length > 0 && ids.every((id) => STRATEGY_IDS.includes(id)), `STRATEGY_IDS covers defaultTree leaves: ${STRATEGY_IDS.join(",")}`);
  assert(treeStrategyIds(edgeAwareTree()).every((id) => STRATEGY_IDS.includes(id)), "STRATEGY_IDS covers edgeAwareTree leaves too");

  const report = buildReport({
    id: "RPT-003",
    createdAt: "2026-10-31T12:00:02Z",
    telemetry: [telemetry(FIXED_DURATION_S), telemetry(FIXED_DURATION_S)],
    opponentIndex: 0,
    // A real id, a duplicate, a NEGATIVE weight, and a strategy that does not exist.
    probableStrategies: [
      { id: "attack", weight: 4 },
      { id: "attack", weight: 1 },
      { id: "advance", weight: 2 },
      { id: "retreat", weight: -9 },
      { id: "teleport", weight: 5 },
    ],
    habits: { openingMove: "attack", averageApproachS: 1.2, retreatThreshold: 0.4, favouredBand: "contact" },
    outcome: "ring-out",
  });
  const ps = report.opponent.probableStrategies;
  assert(ps.every((s) => STRATEGY_IDS.includes(s.id)), "every kept id exists in the tree");
  assert(!ps.some((s) => s.id === "teleport"), "an id that cannot happen is dropped");
  assert(ps.every((s) => s.weight >= 0), "no negative weights");
  const sum = ps.reduce((a, s) => a + s.weight, 0);
  assert(Math.abs(sum - 1) < 1e-9, `weights are a distribution (sum ${sum})`);
  assert(ps.length === 2 && ps[0].id === "attack" && Math.abs(ps[0].weight - 2 / 3) < 1e-9, `ranked and de-duplicated: ${JSON.stringify(ps)}`);
  assert(ps[0].weight >= ps[1].weight, "ranked descending");
});

Deno.test("M-E 3: privacy — no name, no personal id, no raw coordinate array; size capped", () => {
  const report = buildReport({
    id: "RPT-009",
    createdAt: "2026-10-31T12:00:09Z",
    telemetry: [telemetry(FIXED_DURATION_S), telemetry(FIXED_DURATION_S)],
    opponentIndex: 1,
    probableStrategies: [{ id: "attack", weight: 1 }],
    habits: { openingMove: "advance", averageApproachS: 1.5, retreatThreshold: 0.3, favouredBand: "striking" },
    outcome: "ko",
    tree: { node: "N-7", depth: 3 },
  });
  const json = JSON.stringify(report);
  // No fighter name and no human-readable name field anywhere in the payload.
  assert(!/name/i.test(json), "no name of any kind in the payload");
  // No id of a person / player / account / email.
  assert(!/"(player|playerName|userId|personalId|email|account|accountId|ip|deviceId)"/i.test(json), "no personal id field");
  assert(!json.includes("MY-7F3A21"), "no fighter identity id leaked");
  // No raw coordinate array: no array of four or more numbers (a position sample).
  assert(!/\[\s*-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?){3,}\s*\]/.test(json), "no raw coordinate array");
  // The module's own claim, enforced (it walks the payload and would throw).
  assert(isPersonalData(report) === false, "isPersonalData reports the payload clean");
  // The measured wire size for the fixed 180 s match must fit the cap.
  const bytes = encodedBytes(report);
  assert(bytes <= REPORT_BYTE_CAP, `${bytes} bytes exceeds the cap ${REPORT_BYTE_CAP}`);

  // The claim is a real guard: a planted personal field or coordinate array throws.
  assertThrows(() => isPersonalData({ ...report, name: "Aldric" } as unknown as MatchReport), "a name field breaks the claim");
  assertThrows(() => isPersonalData({ ...report, path: [[0, 0], [1, 1], [2, 2]] } as unknown as MatchReport), "a coordinate array breaks the claim");
  console.log(`M-E report bytes (fixed ${FIXED_DURATION_S}s match): ${bytes} / cap ${REPORT_BYTE_CAP}`);
});

Deno.test("M-E 4: the gate takes accept / defer / refuse; a deferred update stays queued with its reason", () => {
  const accepted = update("U-1", "policy-weights", 0.9);
  const deferred = update("U-2", "tree-thresholds", 0.5);
  const refused = update("U-3", "balance", 0.2);

  let q = emptyQueue();
  q = mergeQueues(q, applyVerdict(accepted, "accept", "review"));
  q = mergeQueues(q, applyVerdict(deferred, "defer", "review"));
  q = mergeQueues(q, applyVerdict(refused, "refuse", "review"));

  assert(q.accepted.length === 1 && q.accepted[0].id === "U-1", "accept files the update as accepted");
  assert(q.deferred.length === 1 && q.refused.length === 1, "defer and refuse file their own buckets");
  // The deferred update is STILL QUEUED and keeps its own reason.
  const back = q.deferred[0];
  assert(back.id === "U-2" && back.verdict === "defer", "deferred update is the one queued, marked defer");
  assert(back.reason === deferred.reason, "deferred update keeps its reason");
  assert(typeof back.decisionReason === "string" && back.decisionReason.startsWith("review:"), "the WHY is recorded for review");
  assert(q.refused[0].verdict === "refuse" && q.refused[0].decisionReason?.startsWith("review:"), "refusal records why");
  console.log("M-E queue after accept/defer/refuse:", JSON.stringify({
    accepted: q.accepted.map((u) => ({ id: u.id, verdict: u.verdict, why: u.decisionReason })),
    deferred: q.deferred.map((u) => ({ id: u.id, verdict: u.verdict, reason: u.reason, why: u.decisionReason })),
    refused: q.refused.map((u) => ({ id: u.id, verdict: u.verdict, why: u.decisionReason })),
  }));
});

Deno.test("M-E 5: auto mode applies only what its policy allows and records why", () => {
  const policy: AutoPolicy = { acceptAt: 0.7, refuseBelow: 0.3, allowedKinds: ["policy-weights", "tree-thresholds"] };
  const updates: QueuedUpdate[] = [
    update("A-1", "policy-weights", 0.9),   // allowed + high          -> accept
    update("A-2", "balance", 0.95),         // high but NOT allowed    -> refuse
    update("A-3", "policy-weights", 0.5),   // allowed, mid band       -> defer
    update("A-4", "tree-thresholds", 0.1),  // allowed, below floor    -> refuse
  ];
  let q = emptyQueue();
  const raw: { id: string; v: string }[] = [];
  for (const u of updates) {
    const v = autoVerdict(u, policy);
    raw.push({ id: u.id, v });
    q = mergeQueues(q, applyVerdict(u, v, "auto"));
  }
  assert(raw.map((r) => r.v).join(",") === "accept,refuse,defer,refuse", `auto verdicts: ${JSON.stringify(raw)}`);
  assert(q.accepted.length === 1 && q.accepted[0].id === "A-1", "auto applied exactly the one the policy allowed");
  assert(q.accepted.every((u) => policy.allowedKinds!.includes(u.kind)), "auto never applies a disallowed kind");
  assert(q.deferred.length === 1 && q.deferred[0].id === "A-3", "the mid band is deferred, not applied");
  assert(q.refused.length === 2, "the two the policy rejects are refused");
  assert([...q.accepted, ...q.deferred, ...q.refused].every((u) => u.decisionReason?.startsWith("auto:")), "auto records WHY for every decision");
  console.log("M-E auto-mode queue:", JSON.stringify({
    accepted: q.accepted.map((u) => ({ id: u.id, kind: u.kind, why: u.decisionReason })),
    deferred: q.deferred.map((u) => ({ id: u.id, kind: u.kind, why: u.decisionReason })),
    refused: q.refused.map((u) => ({ id: u.id, kind: u.kind, why: u.decisionReason })),
  }));
});
