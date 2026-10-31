// Wave N (lane N-B): the strategy vocabulary — its decision-leaf mapping, its deterministic chooser,
// its in-band plans and the switch that stops a losing seat stalling forever.
//
// The two scripted contexts below are the lane's evidence pair: one seat AHEAD on health with little
// time left, one BEHIND. The plans they produce are printed per strategy at the end.
import { STRATEGY_IDS } from "../src/game/MatchReport.ts";
import {
  chooseStrategy,
  FLEE_M,
  LOSS_MARGIN,
  MAX_ENGAGE_M,
  MAX_KEEP_AWAY_M,
  MAX_STALL_PULL_S,
  MIN_ENGAGE_M,
  MIN_KEEP_AWAY_M,
  NO_HIDE_S,
  planFor,
  stallAllowed,
  STRATEGY_IDS_ALL,
  STRATEGY_LEAVES,
  strategyAdvice,
  type AdviceContext,
  type StrategyContext,
  type StrategyId,
} from "../src/game/Strategies.ts";

function assert(ok: unknown, msg: string): asserts ok {
  if (!ok) throw new Error(msg);
}

// Seat ahead on health, little time left: the "push the temporality" case.
const AHEAD: StrategyContext = { hpFracSelf: 0.7, hpFracFoe: 0.3, timeLeftS: 20, timeLimitS: 180, classId: "Archer" };
// Seat behind on health, same clock: the case that must NEVER be allowed to stall forever.
const BEHIND: StrategyContext = { hpFracSelf: 0.2, hpFracFoe: 0.6, timeLeftS: 20, timeLimitS: 180, classId: "Warrior" };

Deno.test("N-B 1: every behavioural strategy maps only to real decision leaves (STRATEGY_IDS)", () => {
  for (const id of STRATEGY_IDS_ALL) {
    const leaves = STRATEGY_LEAVES[id];
    assert(leaves.length > 0, `${id} names at least one leaf`);
    for (const leaf of leaves) {
      assert(STRATEGY_IDS.includes(leaf), `${id} -> "${leaf}" is a real tree leaf (STRATEGY_IDS = ${STRATEGY_IDS.join(", ")})`);
    }
  }
  // The behavioural vocabulary is strictly higher: its own ids are NOT tree leaves.
  for (const id of STRATEGY_IDS_ALL) {
    assert(!STRATEGY_IDS.includes(id), `behavioural id "${id}" is not itself a decision leaf`);
  }
});

Deno.test("N-B 2: the chooser is deterministic, and reads the two scripted contexts", () => {
  for (let i = 0; i < 100; i++) {
    assert(chooseStrategy(AHEAD) === chooseStrategy(AHEAD), "same ahead context -> same id");
    assert(chooseStrategy(BEHIND) === chooseStrategy(BEHIND), "same behind context -> same id");
  }
  const ahead = chooseStrategy(AHEAD);
  assert(ahead === "stall" || ahead === "kite", `ahead seat pushes the clock (chose ${ahead})`);
  assert(chooseStrategy(BEHIND) === "brawl", `behind seat pursues (chose ${chooseStrategy(BEHIND)})`);
  // planFor is likewise a pure function of its inputs.
  for (const id of STRATEGY_IDS_ALL) {
    assert(JSON.stringify(planFor(id, AHEAD)) === JSON.stringify(planFor(id, AHEAD)), `planFor(${id}) deterministic`);
  }
});

Deno.test("N-B 3: every strategy yields a finite, in-band plan in both contexts", () => {
  for (const ctx of [AHEAD, BEHIND]) {
    for (const id of STRATEGY_IDS_ALL) {
      const p = planFor(id, ctx);
      assert(p.id === id, `${id} plan carries its own id`);
      assert(Number.isFinite(p.keepAwayM) && p.keepAwayM >= MIN_KEEP_AWAY_M && p.keepAwayM <= MAX_KEEP_AWAY_M, `${id} keepAwayM in band`);
      assert(Number.isFinite(p.engageBelowM) && p.engageBelowM >= MIN_ENGAGE_M && p.engageBelowM <= MAX_ENGAGE_M, `${id} engageBelowM in band`);
      assert(Number.isFinite(p.retreatBelowHp) && p.retreatBelowHp >= 0 && p.retreatBelowHp <= 1, `${id} retreatBelowHp in [0,1]`);
      assert(Number.isFinite(p.hideAfterS) && p.hideAfterS >= 0 && p.hideAfterS <= NO_HIDE_S, `${id} hideAfterS finite`);
      assert(Number.isFinite(p.stallPullS) && p.stallPullS >= 0 && p.stallPullS <= MAX_STALL_PULL_S, `${id} stallPullS bounded`);
      assert(typeof p.reason === "string" && p.reason.length > 0, `${id} plan states a reason`);
    }
  }
});

Deno.test("N-B 4: the losing seat's stall is bounded — it switches OFF", () => {
  // The switch condition itself.
  assert(stallAllowed(BEHIND) === false, "a seat behind by more than LOSS_MARGIN may not stall");
  assert(stallAllowed(AHEAD) === true, "an ahead seat may stall");
  // A losing seat that ASKS for a stall gets a plan whose pull is 0 (the stall is off) and says so.
  const p = planFor("stall", BEHIND);
  assert(p.stallPullS === 0, "losing seat stall pull is forced to 0");
  assert(p.reason.includes("switched OFF") || p.reason.includes("regain the lead"), `reason states the switch: ${p.reason}`);
  // And the chooser can never hand a losing seat the stall id, across a range of deficits.
  let sawStall = false;
  for (let gap = LOSS_MARGIN + 0.01; gap <= 0.3; gap += 0.02) {
    const ctx: StrategyContext = { hpFracSelf: 0.7, hpFracFoe: 0.7 + gap, timeLeftS: 5, timeLimitS: 180, classId: "Archer" };
    assert(!stallAllowed(ctx), `behind by ${gap.toFixed(2)} -> stall not allowed`);
    if (chooseStrategy(ctx) === "stall") sawStall = true;
  }
  assert(!sawStall, "no behind-on-health context is ever given the stall strategy");
});

Deno.test('N-B 5: "push the temporality" is expressible in the plan reason', () => {
  const stall = planFor("stall", AHEAD);
  assert(stall.stallPullS > 0, "ahead stall drags the clock");
  assert(stall.reason.includes("push the clock"), `stall reason names the clock push: ${stall.reason}`);
  const kite = planFor("kite", AHEAD);
  assert(kite.stallPullS > 0 && kite.reason.includes("push the clock"), `kite also pushes the clock: ${kite.reason}`);
});

Deno.test("N-B 6: strategyAdvice is total, deterministic and gives a finite flee point", () => {
  const moves = new Set(["close", "hold", "flee"]);
  const base: AdviceContext = { ...AHEAD, distanceM: 3, selfPos: { x: 0, z: 0 }, foePos: { x: 3, z: 0 } };
  for (const id of STRATEGY_IDS_ALL) {
    const a = strategyAdvice(id, base);
    const b = strategyAdvice(id, base);
    assert(JSON.stringify(a) === JSON.stringify(b), `${id} advice deterministic`);
    assert(moves.has(a.move), `${id} move is one of close/hold/flee`);
    assert(typeof a.useSkill === "boolean", `${id} useSkill is a boolean`);
    if (a.move === "flee" && a.fleeTo) {
      assert(Number.isFinite(a.fleeTo.x) && Number.isFinite(a.fleeTo.z), `${id} fleeTo finite`);
      // A flee point moves AWAY from the foe: it is further from the foe than self was.
      const before = Math.hypot(base.selfPos!.x - base.foePos!.x, base.selfPos!.z - base.foePos!.z);
      const after = Math.hypot(a.fleeTo.x - base.foePos!.x, a.fleeTo.z - base.foePos!.z);
      assert(after > before, `${id} flees away from the foe`);
      assert(Math.abs(after - (before + FLEE_M)) < 1e-6, `${id} flee step is FLEE_M longer`);
    }
  }
  // A hurt seat under its retreat threshold always flees.
  const hurt = strategyAdvice("brawl", { ...AHEAD, hpFracSelf: 0.05, distanceM: 1 });
  assert(hurt.move === "flee", "a nearly-dead brawler flees despite the brawl plan");
});

Deno.test("N-B 7: print a plan per strategy for the two scripted contexts (evidence)", () => {
  const line = (label: string, ctx: StrategyContext) => {
    console.log(`\n== ${label} (self ${ctx.hpFracSelf}, foe ${ctx.hpFracFoe}, ${ctx.timeLeftS}/${ctx.timeLimitS}s, ${ctx.classId}) -> chooseStrategy = ${chooseStrategy(ctx)}`);
    for (const id of STRATEGY_IDS_ALL) {
      const p = planFor(id, ctx);
      console.log(
        `  ${id.padEnd(5)} keepAway ${p.keepAwayM.toFixed(1)}m engage<=${p.engageBelowM.toFixed(1)}m break<${(p.retreatBelowHp * 100).toFixed(0)}% hide@${p.hideAfterS < NO_HIDE_S ? p.hideAfterS.toFixed(1) + "s" : "never"} stallPull ${p.stallPullS.toFixed(1)}s | ${p.reason}`,
      );
    }
  };
  line("AHEAD, little time", AHEAD);
  line("BEHIND", BEHIND);
  assert(true, "printed");
});

// Keep the type import exercised without a value use (the compiler still checks it).
const _typed: StrategyId = "brawl";
assert(_typed === "brawl", "StrategyId type is usable");
