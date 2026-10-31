// Wave J (lane J-B): the batch CLI.
//
//   deno run -A tools/batch.ts --matches 2000 --seed 1 --design all --out artifacts/batch
//     [--rules wave-j|engine] [--arena jt|fallback] [--dt 0.0333]
//
// Writes <out>/records.jsonl (one MatchRecord per line: full MatchConditions + MatchOutcome),
// <out>/summary.json (ColumnStats per design cell and per gradient axis, the invariant check) and
// <out>/summary.md (the same as tables), and prints the invariant result. Exit code 1 when the
// strong-beats-weak invariant fails.

import { codeHash, runBatch } from "../src/balance/Batch.ts";
import { summarize, summaryMarkdown } from "../src/balance/Summary.ts";
import { ENGINE_RULES, WAVE_J_RULES } from "../src/balance/MatchRules.ts";
import { buildFallbackArena } from "../src/balance/ArenaFixtures.ts";
import { buildLaneJTArena } from "../src/balance/ArenaJT.ts";
import type { DesignKind } from "../src/balance/Gradient.ts";

function arg(name: string, dflt: string): string {
  const i = Deno.args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < Deno.args.length ? Deno.args[i + 1] : dflt;
}

const matches = Math.max(1, Number(arg("matches", "2000")) | 0);
const seed = Number(arg("seed", "1")) >>> 0;
const design = arg("design", "all") as DesignKind;
const out = arg("out", "artifacts/batch");
const rulesName = arg("rules", "wave-j");
const rules = rulesName === "engine" ? ENGINE_RULES : WAVE_J_RULES;
const arenaName = arg("arena", "jt");
const provider = arenaName === "fallback" ? buildFallbackArena : buildLaneJTArena;
const dt = Number(arg("dt", String(1 / 30)));
if (!["all", "extreme", "corner", "grid", "random", "invariant"].includes(design)) throw new Error(`unknown --design ${design}`);

await Deno.mkdir(out, { recursive: true });
const hash = await codeHash();
const t0 = performance.now();
const file = await Deno.open(`${out}/records.jsonl`, { write: true, create: true, truncate: true });
const enc = new TextEncoder();
const lines: string[] = [];
const records = runBatch({
  matches, seed, design, rules, provider, codeHash: hash, sim: { dt },
  onRecord: (r) => { lines.push(JSON.stringify(r)); },
});
await file.write(enc.encode(lines.join("\n") + "\n"));
file.close();
const ms = performance.now() - t0;
const summary = { rules: rulesName, arena: arenaName, seed, design, ...summarize(records) };
await Deno.writeTextFile(`${out}/summary.json`, JSON.stringify(summary, null, 2) + "\n");
await Deno.writeTextFile(`${out}/summary.md`, summaryMarkdown(summary, `Batch summary — rules ${rulesName}, arena ${arenaName}, seed ${seed}, design ${design}`));
const inv = summary.invariant;
console.log(`batch: ${records.length} matches in ${(ms / 1000).toFixed(1)} s (${Math.round(records.length / (ms / 60000))} / min) · rules ${rulesName} · arena ${arenaName} · code ${hash.slice(0, 12)}`);
console.log(`reasons: ${Object.entries(summary.reasons).map(([k, v]) => `${k} ${v}`).join(", ")}`);
console.log(`invariant (strong beats weak): ${inv.pass ? "PASS" : "FAIL"} ${inv.strongWins}/${inv.n} (${(inv.rate * 100).toFixed(2)} %) · ${Object.entries(inv.byReason).map(([k, v]) => `${k} ${v}`).join(", ")}`);
for (const f of inv.failures.slice(0, 5)) console.log(`  counter-example seed ${f.seed} ${f.design} ${f.reason}: strong ${f.strong} vs weak ${f.weak} (${f.duration} s)`);
console.log(`wrote ${out}/records.jsonl, summary.json, summary.md`);
if (!inv.pass && inv.n > 0) Deno.exit(1);
