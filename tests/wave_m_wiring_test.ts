// Wave M wiring: the parent's own glue, tested.
//
// The five lanes proved their modules in isolation; these tests prove the JOINTS the parent added —
// the per-seat projection the report is built from, the report's own invariants on real telemetry,
// and the two wires (the engine feeding the accumulator and the reading page's batch button) whose
// absence is invisible in a unit test but obvious in the game.
import { assert } from "jsr:@std/assert@1";
import { CIRCLING_M, createTelemetry, STRIKING_M, telemetryForSeat, telemetrySummary } from "../src/game/FightTelemetry.ts";
import { buildReport, REPORT_BYTE_CAP, STRATEGY_IDS } from "../src/game/MatchReport.ts";
import { batchPlan, batchProgress, batchSummary, BATCH_SIZES } from "../src/ui/BatchPanel.ts";
import { runBatch } from "../src/balance/Batch.ts";

Deno.test("M wiring: the seat projection keeps one seat's numbers and the shared spatial ones", () => {
  const acc = createTelemetry();
  // Two seconds of walking apart, one hit by seat 0 on seat 1, then a quiet second.
  for (let i = 0; i < 60; i++) acc.step(1 / 30, 3);
  acc.hit(0, 500, 0, "Longsword");
  for (let i = 0; i < 30; i++) acc.step(1 / 30, 8);
  acc.jump(1, 0.4);
  const match = telemetrySummary(acc);
  const zero = telemetryForSeat(match, 0);
  const one = telemetryForSeat(match, 1);
  assert(zero.durationS === match.durationS && one.durationS === match.durationS, "duration is shared");
  assert(zero.distance.mean === match.distance.mean, "the distance statistics are shared");
  assert(zero.bands.circling === match.bands.circling, "the bands are shared");
  assert(zero.objects.taken === match.objects.taken, "the object events are shared");
  // Per-seat: seat 0 dealt the hit, seat 1 jumped.
  assert(zero.damageDealt[0].count === 1 && zero.damageDealt[1].count === 1, "a seat's own pair is that seat, twice");
  assert(zero.damageDealt[0].total === 500, "seat 0's own view carries the hit it landed");
  assert(one.damageDealt[0].total === 0, "seat 1's own view carries no dealt damage (it landed nothing)");
  assert(one.damageTaken[0].total === 500, "and seat 1's own view carries what it took");
  assert(one.jumps[0].count === 1 && zero.jumps[0].count === 0, "the jump belongs to seat 1");
  assert(zero.damageByWeapon["Longsword"] !== undefined, "the per-weapon table is shared");
  // Band edges are the module's own constants, so the wiring cannot drift from the metric.
  assert(STRIKING_M < CIRCLING_M, "the band edges are ordered");
});

Deno.test("M wiring: the engine's report is compact, private and drawn from real strategy ids", () => {
  const acc = createTelemetry();
  for (let i = 0; i < 300; i++) {
    acc.step(1 / 30, i % 40 < 20 ? 1.1 : 9);
    if (i % 45 === 0) acc.hit(1, 800, i % 90 === 0 ? 200 : 0, i % 2 ? "Skullsplitter" : "Warhammer");
  }
  const t = telemetrySummary(acc);
  const report = buildReport({
    id: "RPT-1",
    createdAt: "2026-10-31T00:00:00.000Z",
    telemetry: [telemetryForSeat(t, 0), telemetryForSeat(t, 1)],
    opponentIndex: 1,
    // Exactly the weighting the engine uses: measured signals, not a flat prior.
    probableStrategies: [
      { id: "attack", weight: t.damageDealt[1].count + t.bands.contact * 0.5 },
      { id: "advance", weight: t.engagement.closingS + t.dryStreak[1].maxS * 0.5 },
      { id: "wait", weight: t.quietS * 0.5 },
      { id: "made-up", weight: 99 },
    ],
    habits: { openingMove: "Warhammer", averageApproachS: 1.5, retreatThreshold: 0.42, favouredBand: "striking" },
    outcome: "ko",
  });
  const bytes = new TextEncoder().encode(JSON.stringify(report)).length;
  assert(bytes < REPORT_BYTE_CAP, `the report fits its cap (${bytes} < ${REPORT_BYTE_CAP})`);
  assert(!/style=|name|position/i.test(JSON.stringify(report)), "no name, no raw position in the payload");
  assert(report.opponent.probableStrategies.every((s) => STRATEGY_IDS.includes(s.id)), "every claimed strategy is a real tree leaf");
  assert(!report.opponent.probableStrategies.some((s) => s.id === "made-up"), "and an impossible one is dropped, not kept");
  const sum = report.opponent.probableStrategies.reduce((a, s) => a + s.weight, 0);
  assert(Math.abs(sum - 1) < 1e-9, `the strategies are a distribution (${sum})`);
  assert(report.telemetry[1].damageDealt[0].count > 0, "the enemy's own damage is in the payload");
});

Deno.test("M wiring: the reading page's batch plan, progress and summary agree with a real run", () => {
  for (const size of BATCH_SIZES) {
    const plan = batchPlan(size, 20261031);
    assert(plan.matches === size && plan.jobs.length === size, `${size}: one job per match`);
    assert(plan.estimatedS > 0 && Number.isFinite(plan.estimatedS), `${size}: an estimate exists`);
    const mid = batchProgress(Math.floor(size / 2), size, plan.estimatedS);
    assert(mid.fraction > 0 && mid.fraction < 1 && mid.done + (size - mid.done) === size, `${size}: half done reads as half`);
  }
  const records = runBatch({ matches: 10, seed: 20261031, design: "all" });
  const summary = batchSummary(records);
  assert(summary.matches === 10, "ten matches summarised");
  const keys = Object.keys(summary.variables);
  assert(keys.length >= 6, `the summary covers several variables (${keys.length})`);
  for (const [k, v] of Object.entries(summary.variables)) {
    assert(Number.isFinite(v.min) && Number.isFinite(v.max) && v.min <= v.mean + 1e-9 && v.mean <= v.max + 1e-9, `${k}: min <= mean <= max`);
    assert(Number.isFinite(v.median) && Number.isFinite(v.p10) && Number.isFinite(v.p90), `${k}: the percentiles are real`);
  }
  assert(Object.values(summary.reasons).reduce((a, b) => a + b, 0) === 10, "every match has an ending");
});

Deno.test("M wiring: the engine feeds the accumulator, the AI view and the batch button (text pin)", async () => {
  const engine = await Deno.readTextFile(new URL("../src/engine/Engine.ts", import.meta.url));
  const menu = await Deno.readTextFile(new URL("../src/ui/Menu.ts", import.meta.url));
  const css = await Deno.readTextFile(new URL("../styles.css", import.meta.url));
  // The feed: a fresh accumulator per match, a distance sample per substep, and a reset on a landing.
  assert(engine.includes("this.#fightTelemetry = createTelemetry();"), "a fresh accumulator per match");
  assert(engine.includes("this.#fightTelemetry?.step(dt, pairDistance)"), "one distance sample per substep");
  assert(engine.includes("this.#fightTelemetry?.hit("), "landed hits reach the accumulator");
  assert(engine.includes("this.#fightTelemetry?.jump("), "completed hops count as jumps");
  assert(engine.includes("quietS: this.#quietS,"), "the AI view carries the quiet time (lane M-B's hook)");
  assert(engine.includes("buildReport({") && engine.includes("telemetryForSeat(t, 0)"), "the report is assembled in the engine");
  assert(engine.includes("onBatch:"), "the menu's batch hook is wired");
  // The button: a size picker, a run action, a progress track and a summary, none of it inline-styled.
  assert(menu.includes('data-action="run-batch"') && menu.includes("data-batch-size="), "the batch button and sizes exist");
  assert(menu.includes("batchPlan(") === false, "the menu does not plan the batch itself (the engine does)");
  assert(css.includes(".batch-fill") && css.includes(".batch-btn.selected"), "the batch styles exist");
  assert(!/style="[^"]*width/.test(menu), "no inline width attribute in the menu markup (the CSP blocks those)");
});
