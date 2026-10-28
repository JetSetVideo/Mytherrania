import { evaluateWin, rollWinCondition, suddenDeathArmed, WIN_PARAM_BOUNDS, type FightState } from "../src/game/WinConditions.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }

let s = 123456789;
const rng = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };

function state(over: Partial<FightState> = {}): FightState {
  return { hostileTime: 0, hpA: 100, hpB: 100, maxHpA: 100, maxHpB: 100, dealtA: 0, dealtB: 0, ...over };
}

Deno.test("death always wins, for either fighter, and a double KO is a draw", () => {
  const { cond, params } = rollWinCondition(rng);
  assert(evaluateWin(cond, params, state({ hpB: 0 })).winner === 0, "A wins when B dies");
  assert(evaluateWin(cond, params, state({ hpA: 0 })).winner === 1, "B wins when A dies");
  assert(evaluateWin(cond, params, state({ hpA: 0, hpB: 0 })).winner === null, "mutual death is a draw");
});

Deno.test("rolled params sit inside their declared bounds and are reproducible", () => {
  s = 42;
  const a = rollWinCondition(rng);
  s = 42;
  const b = rollWinCondition(rng);
  assert(a.cond.kind === b.cond.kind, "same seed, same condition");
  assert(a.params.suddenDeathAfter >= WIN_PARAM_BOUNDS.suddenDeathAfter[0], "suddenDeathAfter in bounds");
  assert(a.params.enduranceLimit <= WIN_PARAM_BOUNDS.enduranceLimit[1], "enduranceLimit in bounds");
});

Deno.test("the roll produces a spread of conditions, not one ending", () => {
  const kinds = new Set<string>();
  for (let i = 0; i < 200; i++) kinds.add(rollWinCondition(rng).cond.kind);
  assert(kinds.has("ko"), "ko present");
  assert(kinds.size >= 3, `expected variety across 200 rolls, saw ${[...kinds].join(",")}`);
});

Deno.test("endurance resolves at the bell to the healthier fighter", () => {
  const { params } = rollWinCondition(rng);
  const cond = { kind: "endurance" as const, label: "t" };
  const notYet = evaluateWin(cond, params, state({ hostileTime: params.enduranceLimit - 1, hpA: 90, hpB: 40 }));
  assert(!notYet.over, "before the bell nobody wins");
  const at = evaluateWin(cond, params, state({ hostileTime: params.enduranceLimit + 1, hpA: 90, hpB: 40 }));
  assert(at.over && at.winner === 0 && at.reason === "endurance", "healthier fighter wins at the bell");
});

Deno.test("domination triggers when one side out-damages by the ratio", () => {
  const { params } = rollWinCondition(rng);
  const cond = { kind: "domination" as const, label: "t" };
  const v = evaluateWin(cond, params, state({ dealtA: params.dominationRatio * 100, dealtB: 100 }));
  assert(v.over && v.winner === 0 && v.reason === "domination", "A dominates");
  const even = evaluateWin(cond, params, state({ dealtA: 100, dealtB: 100 }));
  assert(!even.over, "even damage is not domination");
});

Deno.test("sudden death arms only after its deadline", () => {
  const { params } = rollWinCondition(rng);
  assert(!suddenDeathArmed(params, params.suddenDeathAfter - 0.5), "not armed before");
  assert(suddenDeathArmed(params, params.suddenDeathAfter + 0.5), "armed after");
});
