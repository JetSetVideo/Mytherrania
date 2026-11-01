// Wave J2: the input-variable inventory (src/balance/Variables.ts) and the per-variable batch
// designs (Gradient vars-extreme / vars-grid), the effect estimator and the record's clock.
import { DEAD_ARENA_KEYS, BATCH_VARIABLES, SIM_ARENA_KEYS, STAT_NAMES, valueAt, VARIABLES, VARIABLE_BY_ID } from "../src/balance/Variables.ts";
import { arenaConfigOf, designPoints, fighterSpecOf, legalAllocation, varsGridCells } from "../src/balance/Gradient.ts";
import { runBatch } from "../src/balance/Batch.ts";
import { buildLaneJTArena } from "../src/balance/ArenaJT.ts";
import { variableEffects, zCritical } from "../src/balance/Summary.ts";
import { PARAMS } from "../src/game/ArenaConfig.ts";
import { budgetForLevel, PER_STAT_CAP } from "../src/game/SpectateGen.ts";
import { resolveTimeLimit } from "../src/game/MatchControl.ts";
import { truceSeconds } from "../src/game/Disposition.ts";
import { CLASSES } from "../src/game/Stats.ts";
import type { MatchRecord } from "../src/game/arena/contracts.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

async function sources(paths: string[]): Promise<string> {
  const out: string[] = [];
  for (const p of paths) {
    for await (const e of Deno.readDir(p)) {
      if (e.isFile && e.name.endsWith(".ts")) out.push(await Deno.readTextFile(`${p}/${e.name}`));
    }
  }
  return out.join("\n");
}
/** ArenaConfig.ts without the PARAMS declaration lines and without the random roll (which WRITES keys). */
async function arenaConfigReaders(): Promise<string> {
  const t = await Deno.readTextFile("src/game/ArenaConfig.ts");
  const noParams = t.split("\n").filter((l) => !l.includes('key: "')).join("\n");
  const cut = noParams.indexOf("export function randomArena");
  return cut > 0 ? noParams.slice(0, cut) : noParams;
}
const readsKey = (src: string, key: string) => new RegExp(`\\.${key}\\b`).test(src);

Deno.test("inventory: every arena param, the six stats, identity, rules and tunables; ids unique, ranges sane", () => {
  const ids = VARIABLES.map((v) => v.id);
  assert(new Set(ids).size === ids.length, "unique ids");
  assert(VARIABLES.filter((v) => v.scope === "arena").length === PARAMS.length, "one arena variable per PARAMS key");
  for (const s of STAT_NAMES) assert(VARIABLE_BY_ID.has(`fighter.stat.${s}`), `stat ${s}`);
  for (const f of ["level", "gear", "strategy", "aiLevel", "race", "ancestry", "class", "weapon", "birthsign"]) assert(VARIABLE_BY_ID.has(`fighter.${f}`), f);
  assert(VARIABLES.some((v) => v.scope === "rules") && VARIABLES.some((v) => v.scope === "tunable") && VARIABLES.some((v) => v.scope === "clock"), "scopes");
  for (const v of VARIABLES) {
    assert(Number.isFinite(v.min) && Number.isFinite(v.max) && v.max >= v.min, `${v.id} range`);
    if (v.kind === "enum" && v.values) assert(v.values.length === v.max - v.min + 1, `${v.id}: ${v.values.length} labels for ${v.min}..${v.max}`);
    for (const u of [0, 0.5, 1, NaN, -3]) assert(Number.isFinite(valueAt(v, u)), `${v.id} valueAt`);
  }
  assert(VARIABLE_BY_ID.get("fighter.class")!.values!.length === CLASSES.length, "every class");
});

Deno.test("inventory: the sim flags match the sources (declared readers exist; dead keys have no reader; the clock is not read from the config)", async () => {
  const sim = (await sources(["src/balance", "src/game/arena"])).replace(/^.*key: ".*$/gm, "") + (await arenaConfigReaders());
  for (const key of SIM_ARENA_KEYS) assert(readsKey(sim, key), `declared sim-read key ${key} has no reader`);
  const everything = await sources(["src/engine", "src/physics", "src/graphics", "src/ui", "src/world", "src/game", "src/game/arena", "src/balance", "src/combat"]);
  const noDecl = everything.split("\n").filter((l) => !l.includes('key: "') && !l.includes("DEAD_ARENA_KEYS") && !/^\s*"[a-zA-Z]+",/.test(l)).join("\n");
  const cfgFree = (await arenaConfigReaders());
  for (const key of DEAD_ARENA_KEYS) {
    const re = new RegExp(`(cfg|arena|config|c|st\\.cfg|#arena)\\.${key}\\b`);
    assert(!re.test(noDecl) && !re.test(cfgFree), `${key} is declared dead but something reads it`);
  }
  // MatchSim takes the clock from MatchControl / Disposition, never from the arena config.
  const matchSim = await Deno.readTextFile("src/balance/MatchSim.ts");
  assert(!/cfg\.(timeLimit|roamSeconds)\b/.test(matchSim), "MatchSim reads the config's clock (update the inventory)");
});

Deno.test("vars-extreme: every batch variable is set on every point (per seat for fighter variables), at an extreme or a valid enum value", () => {
  const pts = designPoints("vars-extreme", 40, 3);
  for (const p of pts) {
    for (const v of BATCH_VARIABLES) {
      for (const key of v.perSeat ? [`A.${v.id}`, `B.${v.id}`] : [v.id]) {
        const u = p.over![key];
        assert(u !== undefined, `${key} missing`);
        if (v.kind !== "enum") assert(u === 0 || u === 1, `${key} not at an extreme: ${u}`);
      }
    }
  }
  // Both extremes occur for every non-enum variable over 40 points.
  for (const v of BATCH_VARIABLES.filter((x) => x.kind !== "enum")) {
    const key = v.perSeat ? `A.${v.id}` : v.id;
    const seen = new Set(pts.map((p) => p.over![key]));
    assert(seen.has(0) && seen.has(1), `${key} both extremes`);
  }
});

Deno.test("vars-grid: one variable per point, every (variable, step) cell visited once per sweep", () => {
  const n = varsGridCells();
  const pts = designPoints("vars-grid", n, 5);
  const cells = new Set(pts.map((p) => `${p.design}@${Object.values(p.over!)[0]}`));
  assert(cells.size === n, `${cells.size} distinct cells of ${n}`);
  for (const p of pts) assert(Object.keys(p.over!).length === 1, "one override per point");
  assert(n >= BATCH_VARIABLES.length * 2, "each variable has >= 2 steps");
});

Deno.test("legal allocation: per-attribute extremes never exceed the level budget or the per-stat cap", () => {
  for (const level of [1, 5, 10, 20]) for (const cls of CLASSES) {
    const all = legalAllocation(cls, level, 0.5, Object.fromEntries(STAT_NAMES.map((s) => [s, 1])));
    const sum = STAT_NAMES.reduce((t, s) => t + all[s], 0);
    assert(sum <= budgetForLevel(level), `L${level} ${cls}: ${sum} > ${budgetForLevel(level)}`);
    for (const s of STAT_NAMES) assert(all[s] >= 0 && all[s] <= PER_STAT_CAP, `${s} ${all[s]}`);
    const one = legalAllocation(cls, level, 0, { strength: 1 });
    assert(one.strength >= Math.min(PER_STAT_CAP, budgetForLevel(level)) - 1, `strength at max takes the budget: ${one.strength}`);
    const none = legalAllocation(cls, level, 0.5, { strength: 0 });
    assert(none.strength === 0, "strength at min is 0");
  }
});

Deno.test("overrides reach the conditions: arena keys, birthsign, class, strategy", () => {
  const [p] = designPoints("vars-extreme", 1, 9);
  p.over!["arena.size"] = 0;
  p.over!["arena.ceiling"] = 1;
  p.over!["A.fighter.birthsign"] = 1;
  p.over!["A.fighter.strategy"] = 0;
  p.over!["B.fighter.strategy"] = 1;
  const cfg = arenaConfigOf(p);
  assert(cfg.size === VARIABLE_BY_ID.get("arena.size")!.min, `size ${cfg.size}`);
  assert(cfg.ceiling === VARIABLE_BY_ID.get("arena.ceiling")!.max, `ceiling ${cfg.ceiling}`);
  const a = fighterSpecOf(p.a, p.cat, 0, p.seed, p.over), b = fighterSpecOf(p.b, p.cat, 1, p.seed, p.over);
  assert(a.birthsign !== null, "birthsign set (it was always null before)");
  assert(a.strategy === "none" && b.strategy === "full", `${a.strategy} / ${b.strategy}`);
});

Deno.test("the record states the clock the simulator played, not the config's defaults", () => {
  const recs = runBatch({ matches: 3, seed: 2, design: "vars-extreme", provider: buildLaneJTArena, sim: { dt: 1 / 20 } });
  for (const r of recs) {
    assert(r.conditions.arena.timeLimit === resolveTimeLimit(undefined), `timeLimit ${r.conditions.arena.timeLimit}`);
    assert(r.conditions.arena.roamSeconds === truceSeconds(), `truce ${r.conditions.arena.roamSeconds}`);
    assert(r.outcome.duration <= truceSeconds() + resolveTimeLimit(undefined) + 1, "the match fits the stated clock");
  }
});

Deno.test("variable effects: the main effect, its standard error and a Bonferroni significance flag", () => {
  const mk = (winner: 0 | 1, u: number, noise: number): MatchRecord => ({
    conditions: { design: "vars-extreme", gradient: { "A.fighter.level": u, "arena.wind": noise } } as unknown as MatchRecord["conditions"],
    outcome: { winner, reason: "ko", duration: 30, hpLeft: [1, 0], hpFracLeft: [0.5, 0], damageDealt: [1, 1], hits: [1, 1], swings: [1, 1], wallHits: [0, 0], edgeTime: [0, 0] },
  });
  const recs: MatchRecord[] = [];
  for (let i = 0; i < 400; i++) recs.push(mk(i % 10 < 8 ? 0 : 1, 1, i % 2), mk(i % 10 < 2 ? 0 : 1, 0, (i >> 1) % 2));
  const eff = variableEffects(recs);
  const lv = eff.find((e) => e.key === "A.fighter.level")!, wind = eff.find((e) => e.key === "arena.wind")!;
  assert(Math.abs(lv.dWinA - 0.6) < 1e-9 && lv.significant, `level effect ${lv.dWinA} z ${lv.z}`);
  assert(!wind.significant, `a balanced nuisance variable is noise (z ${wind.z})`);
  assert(Math.abs(zCritical(0.05) - 1.95996) < 1e-4, `z(0.05) ${zCritical(0.05)}`);
});
