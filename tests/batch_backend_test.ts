// Wave J (lane J-B): the batch back end — design generation, ColumnStats on a known column, the
// summary tables, the invariant check, and full-condition MatchRecord JSON round trips.
import { codeHash, runBatch } from "../src/balance/Batch.ts";
import { columnStats, invariantCheck, summarize, summaryMarkdown } from "../src/balance/Summary.ts";
import { designPoints, GRID_STEPS, SIZE_MAX, SIZE_MIN, sizeOf } from "../src/balance/Gradient.ts";
import { buildFallbackArena } from "../src/balance/ArenaFixtures.ts";
import { DIGEST_DIRS, WALL_SEGMENTS, type MatchRecord } from "../src/game/arena/contracts.ts";

function assert(ok: unknown, msg: string): asserts ok { if (!ok) throw new Error(msg); }

Deno.test("J-B B1: ColumnStats on a known column (1..10), an empty column and non-finite values", () => {
  const s = columnStats([10, 3, 1, 7, 2, 9, 4, 8, 6, 5]);
  assert(s.n === 10 && s.min === 1 && s.max === 10 && s.mean === 5.5 && s.median === 5.5, JSON.stringify(s));
  assert(Math.abs(s.p10 - 1.9) < 1e-9 && Math.abs(s.p90 - 9.1) < 1e-9, `p10/p90 ${s.p10}/${s.p90}`);
  const odd = columnStats([3, 1, 2]);
  assert(odd.median === 2 && odd.mean === 2, "odd count median");
  const e = columnStats([]);
  assert(e.n === 0 && e.min === 0 && e.max === 0 && e.mean === 0, "empty column");
  const nan = columnStats([1, NaN, Infinity, 3]);
  assert(nan.n === 2 && nan.mean === 2, "non-finite values are dropped");
});

Deno.test("J-B B2: designs — extremes are 0/1 per attribute, grid lines step one axis, corners cover every cell", () => {
  const ex = designPoints("extreme", 200, 3);
  for (const p of ex) for (const v of [...Object.values(p.a), ...Object.values(p.b), ...Object.values(p.arena)]) assert(v === 0 || v === 1, `extreme knob ${v}`);
  // The coin is per attribute: both values appear on every axis.
  for (const k of ["level", "stats", "gear", "strategy", "ai"] as const) assert(new Set(ex.map((p) => p.a[k])).size === 2, `axis ${k} mixes min and max`);
  const grid = designPoints("grid", 8 * GRID_STEPS * 2, 4);
  for (const p of grid) {
    const [axis, pos] = Object.entries(p.gradient!)[0];
    assert([0, 0.25, 0.5, 0.75, 1].includes(pos), `grid position ${pos}`);
    const [scope, name] = axis.split(".");
    const knobs = scope === "A" ? p.a as unknown as Record<string, number> : p.arena as unknown as Record<string, number>;
    assert(knobs[name] === pos, `${axis} stepped`);
    for (const [k, v] of Object.entries(p.b)) assert(v === 0.5, `seat B ${k} stays median`);
  }
  const corners = new Set(designPoints("corner", 16, 5).map((p) => p.design));
  assert(corners.size === 16, `4 pairs × 4 arenas, got ${corners.size}`);
  const all = designPoints("all", 100, 6);
  assert(all.length === 100, "all = exactly n points");
  assert(Math.abs(sizeOf(0) - SIZE_MIN) < 1e-9 && Math.abs(sizeOf(1) - SIZE_MAX) < 1e-9, "size knob spans the contract's 2–320 m");
});

Deno.test("J-B B3: a MatchRecord carries every contract field and survives a JSON round trip", async () => {
  const hash = await codeHash();
  assert(/^[0-9a-f]{64}$/.test(hash) && hash === await codeHash(), "sha256 hex, deterministic");
  const recs = runBatch({ matches: 30, seed: 8, design: "all", provider: buildFallbackArena, codeHash: hash });
  for (const r of recs) {
    const back = JSON.parse(JSON.stringify(r)) as MatchRecord;
    assert(JSON.stringify(back) === JSON.stringify(r), "round trip is lossless");
    const c = back.conditions;
    assert(c.version === 1 && c.codeHash === hash && c.simulator === "headless" && c.timeScale === 1 && typeof c.design === "string", "header fields");
    assert(Number.isInteger(c.seed) && typeof c.arena.size === "number" && typeof c.arena.wallResistance === "number", "seed and arena config");
    assert(c.walls.segments.length === WALL_SEGMENTS && Array.isArray(c.walls.rules) && typeof c.walls.coverage === "number", "wall plan");
    const d = c.digest;
    for (const k of ["rim", "wallHeight", "open"] as const) assert(d[k].length === DIGEST_DIRS, `digest.${k}`);
    assert(typeof d.openFraction === "number" && typeof d.ringOutFatal === "boolean" && Array.isArray(d.props) && d.spawns.spawns.length === 2, "digest fields");
    assert(c.symmetry && typeof c.symmetry.kind === "string", "symmetry");
    for (const f of c.fighters) {
      assert(f.race && f.className && Number.isInteger(f.level) && typeof f.allocated === "object", "fighter identity");
      assert(typeof f.weapon.seed === "number" && f.weapon.quality >= 0 && f.weapon.quality <= 1, "weapon");
      assert(["none", "basic", "full"].includes(f.strategy) && f.aiLevel >= 0 && f.aiLevel <= 1, "strategy");
      assert(f.stats && f.stats.maxHealth > 0 && f.stats.attackPower > 0, "the stats actually used");
    }
    if (c.design.startsWith("grid:")) assert(c.gradient && Object.keys(c.gradient).length === 1, "grid records carry their position");
    const o = back.outcome;
    for (const k of ["hpLeft", "hpFracLeft", "damageDealt", "hits", "swings", "wallHits", "edgeTime"] as const) assert(o[k].length === 2, `outcome.${k}`);
    assert(typeof o.duration === "number" && typeof o.reason === "string" && "winner" in o, "outcome header");
  }
});

Deno.test("J-B B4: summaries — per cell, per axis, the invariant counter and the Markdown tables", () => {
  const recs = runBatch({ matches: 120, seed: 12, design: "all", provider: buildFallbackArena, codeHash: "h" });
  const s = summarize(recs);
  assert(s.matches === 120 && Object.values(s.reasons).reduce((a, b) => a + b, 0) === 120, "every match counted once");
  const cellN = Object.values(s.cells).reduce((a, t) => a + t.winA.n, 0);
  assert(cellN === 120, `cells partition the batch (${cellN})`);
  assert(Object.keys(s.axes).length > 0 && Object.values(s.axes).every((st) => Object.keys(st).every((p) => ["0.00", "0.25", "0.50", "0.75", "1.00"].includes(p))), "axis positions");
  // The invariant counter: a hand-made pair of records.
  const fake = (design: string, winner: 0 | 1 | null): MatchRecord => ({ ...recs[0], conditions: { ...recs[0].conditions, design }, outcome: { ...recs[0].outcome, winner } });
  const inv = invariantCheck([fake("corner:max-vs-min|x", 0), fake("corner:min-vs-max|x", 1), fake("corner:min-vs-max|x", 0), fake("random", 1)]);
  assert(inv.n === 3 && inv.strongWins === 2 && !inv.pass && inv.failures.length === 1, JSON.stringify(inv));
  const md = summaryMarkdown(s);
  assert(md.includes("| cell |") && md.includes("## Per gradient axis") && md.includes("Invariant"), "markdown tables");
});
