// Wave H / lane H-D: the match time limit, the tie verdict, the stat-gap record
// and the generation block. Every rule the frozen BRIEF 1.4 states is asserted
// here against the pure modules — no engine, no DOM. Pure: seeded rng only.

import {
  effectiveDuration,
  MATCH_TIME_LIMIT_MAX_S,
  MATCH_TIME_LIMIT_S,
  resolveTimeLimit,
  scaledMaxHealth,
  stepTime,
} from "../src/game/MatchControl.ts";
import {
  evaluateWin,
  rollWinCondition,
  timeLimitVerdict,
  type FightState,
  type WinCondition,
  type WinConditionKind,
  type WinParams,
} from "../src/game/WinConditions.ts";
import {
  generationId,
  highlights,
  parseHistory,
  statGapOf,
  summarize,
  type FighterRecord,
  type MatchRecord,
  type StatGap,
  type WinReason,
} from "../src/game/MatchHistory.ts";
import { rng32 } from "../src/core/MathCore.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}

const PRIMARY_KEYS = ["vitality", "resilience", "willpower", "reflex", "strength", "intelligence"] as const;

type Stats = FighterRecord["stats"];

function statBlock(over: Partial<Stats> = {}): Stats {
  return {
    vitality: 10, resilience: 10, willpower: 10, reflex: 10, strength: 10, intelligence: 10,
    maxHealth: 45000, attackPower: 1000, armor: 4, ...over,
  };
}

function fighter(name: string, over: Partial<Stats> = {}, extra: Partial<FighterRecord> = {}): FighterRecord {
  return {
    name, race: "human", subrace: null, className: "Warrior", weapon: "Longsword", level: 1,
    controller: "decision-tree", stats: statBlock(over), dealt: 0, hits: 0, hpLeft: 0, ...extra,
  };
}

const zeroGap = (distance: number): StatGap => ({
  raw: { vitality: 0, resilience: 0, willpower: 0, reflex: 0, strength: 0, intelligence: 0 },
  z: {}, distance, damageShare: 0, dominance: 0,
});

/** A hand-built MatchRecord: only the fields highlights() and summarize() read. */
function rec(id: number, winner: 0 | 1 | null, duration: number, distance: number, opts: { reason?: WinReason; tie?: boolean } = {}): MatchRecord {
  return {
    id, at: "2026-10-31T00:00:00Z", hour: 12, phase: "day", place: "Sunspire Steppe", arena: "ring",
    reason: opts.reason ?? "ko", duration, firstStrike: null, winner,
    fighters: [fighter("A"), fighter("B")],
    limitS: 180, tie: opts.tie ?? false, statGap: zeroGap(distance), margin: distance,
    generation: { seed: 0, id: "GEN-LEGACY", arena: "ring", budget: 0, techniques: [], ancestry: ["human", "human"] },
  };
}

function state(over: Partial<FightState> = {}): FightState {
  return { hostileTime: 0, hpA: 100, hpB: 100, maxHpA: 100, maxHpB: 100, dealtA: 0, dealtB: 0, ...over };
}

const PARAMS: WinParams = { suddenDeathAfter: 30, enduranceLimit: 60, dominationRatio: 3 };
const KO: WinCondition = { kind: "ko", label: "ko" };

// ---- MatchControl: the limit itself -----------------------------------------

Deno.test("resolveTimeLimit defaults to 180 and is never NaN", () => {
  assert(MATCH_TIME_LIMIT_S === 180, "the brief's 3 minutes");
  assert(MATCH_TIME_LIMIT_MAX_S === 240, "the brief's 4-minute ceiling");
  assert(resolveTimeLimit() === 180, "no argument -> 180");
  assert(resolveTimeLimit(undefined) === 180, "undefined -> 180");
  assert(Number.isNaN(NaN), "sanity: NaN is NaN");
  assert(resolveTimeLimit(NaN) === 180, "NaN -> 180, not NaN");
  assert(resolveTimeLimit(Infinity) === 180, "Infinity -> 180");
  assert(resolveTimeLimit(-Infinity) === 180, "-Infinity -> 180");
});

Deno.test("resolveTimeLimit clamps a real number into [30, 240]", () => {
  assert(resolveTimeLimit(0) === 30, "0 clamps up to 30");
  assert(resolveTimeLimit(-5) === 30, "-5 clamps up to 30");
  assert(resolveTimeLimit(10000) === 240, "10000 clamps down to 240");
  assert(resolveTimeLimit(250) === 240, "250 clamps down to 240");
  assert(resolveTimeLimit(240) === 240, "240 stays");
  assert(resolveTimeLimit(30) === 30, "30 stays");
  assert(resolveTimeLimit(100) === 100, "in-range is untouched");
  assert(resolveTimeLimit(120.5) === 120.5, "fractional in-range is untouched");
});

Deno.test("the pre-existing MatchControl exports are untouched", () => {
  assert(scaledMaxHealth(100, "short") === 50, "scaledMaxHealth still halves at short");
  assert(stepTime(0.01, "double") === 0.02, "stepTime still scales by speed");
  assert(effectiveDuration(120, "double") === 60, "effectiveDuration still halves the watch time");
});

// ---- WinConditions: the tie verdict and the clock rule -----------------------

Deno.test("timeLimitVerdict is a tie at or after the limit, live before it", () => {
  const before = timeLimitVerdict(180, 179.9);
  assert(before.over === false && before.winner === null && before.reason === "time-limit", "before the cap is live");
  const at = timeLimitVerdict(180, 180);
  assert(at.over === true && at.winner === null && at.reason === "time-limit", "at the cap is a tie");
  const after = timeLimitVerdict(180, 200);
  assert(after.over === true && after.winner === null && after.reason === "time-limit", "past the cap is a tie");
});

Deno.test("KO beats the clock, at 1 s and at 500 s of hostility", () => {
  for (const t of [1, 500]) {
    const aWins = evaluateWin(KO, PARAMS, state({ hostileTime: t, hpB: 0 }), 180);
    assert(aWins.over && aWins.winner === 0 && aWins.reason === "ko", `B dead at ${t}s -> A wins by ko`);
    const bWins = evaluateWin(KO, PARAMS, state({ hostileTime: t, hpA: 0 }), 180);
    assert(bWins.over && bWins.winner === 1 && bWins.reason === "ko", `A dead at ${t}s -> B wins by ko`);
    const draw = evaluateWin(KO, PARAMS, state({ hostileTime: t, hpA: 0, hpB: 0 }), 180);
    assert(draw.over && draw.winner === null && draw.reason === "ko", `double KO at ${t}s is a ko draw`);
  }
});

Deno.test("the clock outranks endurance and domination, which fire before it", () => {
  const endurance: WinCondition = { kind: "endurance", label: "e" };
  const endParams: WinParams = { ...PARAMS, enduranceLimit: 120 };
  const live = evaluateWin(endurance, endParams, state({ hostileTime: 130, hpA: 90, hpB: 40 }), 180);
  assert(live.over && live.winner === 0 && live.reason === "endurance", "endurance fires before the cap");
  const capped = evaluateWin(endurance, endParams, state({ hostileTime: 200, hpA: 90, hpB: 40 }), 180);
  assert(capped.over && capped.winner === null && capped.reason === "time-limit", "the clock overrides endurance");

  const domination: WinCondition = { kind: "domination", label: "d" };
  const domLive = evaluateWin(domination, PARAMS, state({ hostileTime: 10, dealtA: 300, dealtB: 100 }), 180);
  assert(domLive.over && domLive.winner === 0 && domLive.reason === "domination", "domination fires before the cap");
  const domCapped = evaluateWin(domination, PARAMS, state({ hostileTime: 200, dealtA: 300, dealtB: 100 }), 180);
  assert(domCapped.over && domCapped.winner === null && domCapped.reason === "time-limit", "the clock overrides domination");
});

Deno.test("evaluateWin defaults to the 180 s cap when no limit is passed", () => {
  const v = evaluateWin(KO, PARAMS, state({ hostileTime: 181 }), undefined);
  assert(v.over && v.winner === null && v.reason === "time-limit", "omitting the limit still applies the default cap");
});

Deno.test("rollWinCondition keeps its four proportions and never rolls time-limit", () => {
  const rng = rng32(0xc0ffee);
  const counts: Record<string, number> = { ko: 0, "sudden-death": 0, endurance: 0, domination: 0, "time-limit": 0, "first-blood": 0 };
  const N = 100000;
  for (let i = 0; i < N; i++) counts[rollWinCondition(rng).cond.kind]++;
  assert(counts["time-limit"] === 0, "time-limit is a rule, not rolled");
  assert(counts["first-blood"] === 0, "first-blood is still never rolled");
  const frac = (k: WinConditionKind) => counts[k] / N;
  assert(Math.abs(frac("ko") - 0.5) < 0.01, `ko ~50% (saw ${(frac("ko") * 100).toFixed(2)}%)`);
  assert(Math.abs(frac("sudden-death") - 0.2) < 0.01, `sudden-death ~20% (saw ${(frac("sudden-death") * 100).toFixed(2)}%)`);
  assert(Math.abs(frac("endurance") - 0.15) < 0.01, `endurance ~15% (saw ${(frac("endurance") * 100).toFixed(2)}%)`);
  assert(Math.abs(frac("domination") - 0.15) < 0.01, `domination ~15% (saw ${(frac("domination") * 100).toFixed(2)}%)`);
});

// ---- MatchHistory: the stat gap ---------------------------------------------

Deno.test("a mirror match has a zero gap, zero distance and zero dominance", () => {
  const g = statGapOf(fighter("A"), fighter("B"), 500, 500);
  assert(g.distance === 0, "distance 0 on a mirror");
  assert(g.damageShare === 0, "even damage -> share 0");
  assert(g.dominance === 0, "a coin flip has no dominance");
  for (const k of PRIMARY_KEYS) assert(g.raw[k] === 0 && g.z[k] === 0, `raw/z ${k} is 0`);
});

Deno.test("the gap grows when reflex, strength and vitality differ", () => {
  const a = fighter("A");
  const b = fighter("B", { reflex: 20, strength: 20, vitality: 20 });
  const g = statGapOf(a, b, 0, 0);
  assert(g.distance > 0, "distance grows with a real split");
  assert(g.raw.reflex === 10 && g.raw.strength === 10 && g.raw.vitality === 10, "raw is fighter 1 minus fighter 0");
  assert(g.z.reflex > 0 && g.z.strength > 0 && g.z.vitality > 0, "z grows with the raw gap");
  const small = statGapOf(a, fighter("C", { reflex: 11 }), 0, 0);
  assert(g.distance > small.distance, "a wider split is further apart");
});

Deno.test("a 0-damage pair gives damageShare 0, and extreme inputs stay bounded", () => {
  const a = fighter("A");
  assert(statGapOf(a, fighter("B"), 0, 0).damageShare === 0, "both zero -> share 0");
  assert(statGapOf(a, fighter("B"), 0, 500).damageShare === 1, "one-sided damage -> share 1");
  assert(statGapOf(a, fighter("B"), 500, 0).damageShare === 1, "one-sided the other way -> share 1");

  const huge = statGapOf(a, fighter("B", { strength: 1e308 }), Number.MAX_VALUE, Number.MAX_VALUE);
  for (const k of PRIMARY_KEYS) assert(Number.isFinite(huge.raw[k]) && Number.isFinite(huge.z[k]), `huge ${k} finite`);
  assert(Number.isFinite(huge.distance) && huge.dominance >= 0 && huge.dominance <= 1, "huge stays bounded");

  const hugeNeg = statGapOf(a, fighter("B", { strength: -1e308 }), -Number.MAX_VALUE, Number.MAX_VALUE);
  assert(Number.isFinite(hugeNeg.distance) && hugeNeg.dominance >= 0 && hugeNeg.dominance <= 1, "huge negative stays bounded");
});

Deno.test("statGap is total: never NaN, dominance in [0,1] over 5000 random pairs", () => {
  const rng = rng32(0xbadc_0de);
  const mk = () => fighter("F", {
    vitality: Math.round(rng() * 200 - 50),
    resilience: Math.round(rng() * 200 - 50),
    willpower: Math.round(rng() * 200 - 50),
    reflex: Math.round(rng() * 200 - 50),
    strength: Math.round(rng() * 200 - 50),
    intelligence: Math.round(rng() * 200 - 50),
  });
  for (let i = 0; i < 5000; i++) {
    const g = statGapOf(mk(), mk(), rng() * 100000, rng() * 100000);
    for (const k of PRIMARY_KEYS) {
      assert(Number.isFinite(g.raw[k]), `raw ${k} finite @${i}`);
      assert(Number.isFinite(g.z[k]), `z ${k} finite @${i}`);
    }
    assert(Number.isFinite(g.distance), `distance finite @${i}`);
    assert(Number.isFinite(g.damageShare) && g.damageShare >= 0 && g.damageShare <= 1, `share in [0,1] @${i}`);
    assert(Number.isFinite(g.dominance) && g.dominance >= 0 && g.dominance <= 1, `dominance in [0,1] @${i} was ${g.dominance}`);
  }
});

// ---- MatchHistory: the generation id ----------------------------------------

Deno.test("generationId is stable, well-formed and barely collides over 4000 seeds", () => {
  assert(generationId(1234) === generationId(1234), "two calls with the same seed agree");
  assert(generationId(0) === generationId(0), "seed 0 stable");
  assert(/^GEN-[0-9A-F]{6}$/.test(generationId(0)), `seed 0 well-formed: ${generationId(0)}`);
  assert(/^GEN-[0-9A-F]{6}$/.test(generationId(999999)), `seed 999999 well-formed: ${generationId(999999)}`);
  assert(/^GEN-[0-9A-F]{6}$/.test(generationId(NaN)), "NaN seed is still well-formed");
  const seen = new Set<string>();
  for (let s = 0; s < 4000; s++) seen.add(generationId(s));
  assert(seen.size >= 3900, `expected >= 3900 distinct ids over 4000 sequential seeds, got ${seen.size}`);
});

// ---- MatchHistory: highlights ------------------------------------------------

Deno.test("highlights picks the right rows and counts ties/timeouts", () => {
  const list = [
    rec(1, 0, 30, 1),                                   // decided
    rec(2, 1, 12, 5),                                   // fastest DECIDED
    rec(3, null, 180, 2, { reason: "time-limit", tie: true }), // the one tie + timeout
    rec(4, 0, 200, 9),                                  // widest gap
    rec(5, null, 5, 3),                                 // a DRAWN match with the lowest duration: not the fastest
    rec(6, 1, 18, 0.5),
  ];
  const h = highlights(list);
  assert(h.fastest?.id === 2, `fastest decided is id 2 (got ${h.fastest?.id})`);
  assert(h.widestGap?.id === 4, `widest gap is id 4 (got ${h.widestGap?.id})`);
  assert(h.tieCount === 1, `one tie (got ${h.tieCount})`);
  assert(h.timeoutCount === 1, `one timeout (got ${h.timeoutCount})`);
});

Deno.test("highlights returns nulls and zero counts for an empty list", () => {
  const h = highlights([]);
  assert(h.fastest === null, "no fastest");
  assert(h.widestGap === null, "no widest");
  assert(h.tieCount === 0 && h.timeoutCount === 0, "no ties or timeouts");
});

Deno.test("highlights ignores an undecided match when no decided one exists", () => {
  const h = highlights([rec(1, null, 5, 2), rec(2, null, 8, 4)]);
  assert(h.fastest === null, "no decided match -> null fastest");
  assert(h.widestGap?.id === 2, "widest still found among draws");
});

// ---- MatchHistory: back-compat -----------------------------------------------

/** A literal record exactly as it was written BEFORE Wave H: no statGap/generation/limitS/tie. */
const OLD_FORMAT = JSON.stringify([
  {
    id: 7, at: "2026-01-01T10:00:00Z", hour: 10, phase: "dawn", place: "Old Field", arena: "ring",
    reason: "ko", duration: 42, firstStrike: "Old A", winner: 0,
    fighters: [
      { name: "Old A", race: "human", subrace: null, className: "Warrior", weapon: "Longsword", level: 3, controller: "human", stats: { vitality: 10, resilience: 10, willpower: 10, reflex: 10, strength: 10, intelligence: 10, maxHealth: 45000, attackPower: 1000, armor: 4 }, dealt: 500, hits: 4, hpLeft: 0 },
      { name: "Old B", race: "elf", subrace: "high", className: "Rogue", weapon: "Dagger", level: 3, controller: "decision-tree", stats: { vitality: 8, resilience: 12, willpower: 9, reflex: 14, strength: 7, intelligence: 13, maxHealth: 40000, attackPower: 900, armor: 3 }, dealt: 100, hits: 1, hpLeft: 30000 },
    ],
  },
]);

Deno.test("parseHistory fills a pre-Wave-H record with the Wave-H defaults", () => {
  const list = parseHistory(OLD_FORMAT);
  assert(list.length === 1, "the old record still loads");
  const r = list[0];
  assert(r.limitS === 180, `limitS defaults to 180 (got ${r.limitS})`);
  assert(r.tie === false, `tie defaults to false (got ${r.tie})`);
  assert(r.generation?.id === "GEN-LEGACY", `generation id is GEN-LEGACY (got ${r.generation?.id})`);
  assert(r.margin === 0, `margin defaults to 0 (got ${r.margin})`);
  const g = r.statGap;
  assert(g !== undefined, "statGap is present");
  assert(g.distance === 0 && g.damageShare === 0 && g.dominance === 0, "the gap is all zero");
  for (const k of PRIMARY_KEYS) assert(g.raw[k] === 0 && g.z[k] === 0, `zero gap ${k}`);
  assert(r.generation?.ancestry[0] === "human" && r.generation?.ancestry[1] === "elf/high", "generation ancestry labels race/subrace");
  assert(r.fighters[0].ancestry === "human" && r.fighters[1].ancestry === "elf/high", "fighter ancestry labels filled");
  assert(r.fighters[0].generationSeed === 0 && r.fighters[1].generationSeed === 0, "fighter generationSeed defaults to 0");
});

Deno.test("parseHistory still tolerates corrupt storage and non-array payloads", () => {
  assert(parseHistory("{oops").length === 0, "corrupt JSON -> []");
  assert(parseHistory(null).length === 0, "null -> []");
  assert(parseHistory(JSON.stringify({ not: "an array" })).length === 0, "object -> []");
  assert(parseHistory(JSON.stringify([{ bad: 1 }, JSON.parse(OLD_FORMAT)[0]])).length === 1, "records without two fighters are dropped");
});

Deno.test("summarize keeps its shape and gains ties/timeouts", () => {
  const list = [rec(1, 0, 30, 1), rec(2, null, 180, 2, { reason: "time-limit", tie: true })];
  const s = summarize(list);
  assert(s.matches === 2, "match count unchanged");
  assert(typeof s.duration.mean === "number" && typeof s.duration.sd === "number", "duration stats intact");
  assert(Array.isArray(s.byRace) && Array.isArray(s.byClass) && Array.isArray(s.byWeapon) && Array.isArray(s.byController), "rate tables intact");
  assert(s.reasons["ko"] === 1 && s.reasons["time-limit"] === 1, "reason counts intact and extended");
  assert(typeof s.firstStrikeWinRate.rate === "number", "first-strike rate intact");
  assert(s.ties === 1 && s.timeouts === 1, "the new tie/timeout counts are correct");
  const legacy = summarize(parseHistory(OLD_FORMAT));
  assert(legacy.matches === 1 && legacy.ties === 0 && legacy.timeouts === 0, "a legacy record counts as neither a tie nor a timeout");
});
