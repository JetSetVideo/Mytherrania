// Wave J (lane J-B): the headless match simulator — determinism, totality, the strong-beats-weak
// invariant over every arena design, and monotonicity of the gradient axes.
import { simulateMatch, type SimEvent } from "../src/balance/MatchSim.ts";
import { designPoints, toConditions, MAX_KNOBS, MIN_KNOBS, type DesignPoint } from "../src/balance/Gradient.ts";
import { buildFallbackArena } from "../src/balance/ArenaFixtures.ts";
import { ENGINE_RULES, WAVE_J_RULES } from "../src/balance/MatchRules.ts";
import { invariantCheck } from "../src/balance/Summary.ts";
import { runBatch } from "../src/balance/Batch.ts";
import { WALL_RULE_KINDS } from "../src/game/arena/contracts.ts";
import { resolveTimeLimit } from "../src/game/MatchControl.ts";
import { truceSeconds } from "../src/game/Disposition.ts";

function assert(ok: unknown, msg: string): asserts ok { if (!ok) throw new Error(msg); }

Deno.test("J-B S1: a match is deterministic per seed (outcome and the full event trace)", () => {
  const pts = designPoints("all", 24, 5);
  for (const p of pts) {
    const c = toConditions(p, buildFallbackArena, "test");
    const a: SimEvent[] = [], b: SimEvent[] = [];
    const o1 = simulateMatch(c, { trace: (e) => a.push(e) });
    const o2 = simulateMatch(structuredClone(c), { trace: (e) => b.push(e) });
    assert(JSON.stringify(o1) === JSON.stringify(o2), `${p.design} seed ${p.seed}: outcome differs between runs`);
    assert(JSON.stringify(a) === JSON.stringify(b), `${p.design} seed ${p.seed}: trace differs between runs`);
  }
});

Deno.test("J-B S2: totality — every match ends, nothing is NaN, both rule sets", () => {
  const limit = truceSeconds() + resolveTimeLimit() + 0.1;
  for (const rules of [ENGINE_RULES, WAVE_J_RULES]) {
    const recs = runBatch({ matches: 240, seed: 9, design: "all", rules, provider: buildFallbackArena });
    for (const r of recs) {
      const o = r.outcome;
      assert(o.reason !== "error", `error outcome: ${o.error}`);
      assert(["ko", "ringout", "time", "draw"].includes(o.reason), `reason ${o.reason}`);
      assert(o.duration > 0 && o.duration <= limit, `duration ${o.duration} outside (0, ${limit}]`);
      const nums = [...o.hpLeft, ...o.hpFracLeft, ...o.damageDealt, ...o.hits, ...o.swings, ...o.wallHits, ...o.edgeTime, o.duration];
      assert(nums.every((v) => Number.isFinite(v) && v >= 0), `non-finite or negative outcome field in ${JSON.stringify(o)}`);
      assert(o.hpFracLeft.every((v) => v <= 1), "hp fraction ≤ 1");
      assert(o.winner === null || o.winner === 0 || o.winner === 1, "winner is a seat or null");
      if (o.reason === "ko") assert(o.winner !== null && o.hpLeft[o.winner] > 0, "a KO winner is standing");
    }
  }
});

/**
 * THE INVARIANT. strong = level 20, the whole level budget allocated along the class lean (max
 * stats), gear quality 1, strategy "full", aiLevel 1; weak = level 1, nothing allocated, gear
 * quality 0, strategy "none", aiLevel 0. Race, sub-race, class and weapon archetype are drawn at
 * random per fighter; seats alternate. Arenas: 2, 3, 5, 8, 14, 25, 60, 120 and 320 m × every wall
 * rule (none = an open pit, low curb, ruin, battlement, gates, half, towers, full) × random ground,
 * shape and props (none or 14).
 */
Deno.test("J-B S3: THE INVARIANT — the strong fighter beats the weak one in 100 % of matches on every arena design", () => {
  let n = 0;
  const cells = new Set<string>();
  for (const seed of [21, 22, 23]) {
    const recs = runBatch({ matches: 144 * 4, seed, design: "invariant", rules: WAVE_J_RULES, provider: buildFallbackArena });
    const inv = invariantCheck(recs);
    for (const r of recs) cells.add(r.conditions.design.split("|")[1]);
    n += inv.n;
    assert(inv.pass, `seed ${seed}: strong won ${inv.strongWins}/${inv.n}; first failures ${JSON.stringify(inv.failures.slice(0, 3))}`);
  }
  assert(n === 3 * 576, `ran ${n} strong-vs-weak matches`);
  assert(cells.size === 9 * WALL_RULE_KINDS.length, `covered ${cells.size} size × wall cells`);
});

Deno.test("J-B S4: monotonicity — raising one of A's attributes never lowers A's win rate beyond noise", () => {
  // A's axis at its min vs its max, every other numeric knob at the median, seat B median; the
  // same categorical draws and seeds on both sides, so the pair differs in that axis only.
  for (const axis of ["level", "stats", "gear", "strategy"] as const) {
    let lo = 0, hi = 0;
    const base = designPoints("random", 120, 31 + axis.length);
    for (const p of base) {
      const mk = (v: number): DesignPoint => ({ ...p, design: `mono:${axis}`, a: { ...p.a, level: 0.5, stats: 0.5, gear: 0.5, strategy: 0.5, ai: 0.5, [axis]: v }, b: { level: 0.5, stats: 0.5, gear: 0.5, strategy: 0.5, ai: 0.5 }, arena: { size: 0.5, walls: 0.5, props: 0.5 } });
      const score = (o: { winner: 0 | 1 | null }) => (o.winner === 0 ? 1 : o.winner === 1 ? 0 : 0.5);
      lo += score(simulateMatch(toConditions(mk(0), buildFallbackArena, "t"), { rules: WAVE_J_RULES }));
      hi += score(simulateMatch(toConditions(mk(1), buildFallbackArena, "t"), { rules: WAVE_J_RULES }));
    }
    lo /= base.length; hi /= base.length;
    assert(hi >= lo - 0.05, `${axis}: A's win rate fell from ${lo.toFixed(3)} (min) to ${hi.toFixed(3)} (max)`);
    assert(hi > lo, `${axis}: the max side must actually win more (${lo.toFixed(3)} -> ${hi.toFixed(3)})`);
  }
  // The extremes are what the corner names say.
  assert(Object.values(MAX_KNOBS).every((v) => v === 1) && Object.values(MIN_KNOBS).every((v) => v === 0), "corner knobs");
});
