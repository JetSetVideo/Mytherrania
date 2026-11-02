// Wave Y (lane P): the measurement runner for docs/wave-y/POOLS.md.
//
//   deno run -A src/balance/pools-study.ts [--matches 6000] [--aware 3000] [--out artifacts/wave-y-P-balance.json]
//
// before = MatchSim with `potentials: false` (byte-identical to HEAD on 300 matches, see POOLS.md),
// after  = the potential law on, every brain pool-aware (the shipped default);
// aware  = one seat aware, the other the previous brain, both ways round (PotentialStudy.awareStudy),
//          plus the two decisions alone (press only, conserve only).

import { awareStudy, classStudy } from "./PotentialStudy.ts";

function arg(name: string, dflt: string): string {
  const i = Deno.args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < Deno.args.length ? Deno.args[i + 1] : dflt;
}

const matches = Number(arg("matches", "6000")) | 0;
const awareN = Number(arg("aware", "3000")) | 0;
const out = arg("out", "artifacts/wave-y-P-balance.json");
const seed = 4242;
const t0 = performance.now();
const before = classStudy("before (potentials off)", matches, seed, { potentials: false });
console.log(`before done ${((performance.now() - t0) / 1000).toFixed(0)} s`);
const after = classStudy("after (potentials on, pool-aware AI)", matches, seed, {});
console.log(`after done ${((performance.now() - t0) / 1000).toFixed(0)} s`);
const aware = awareStudy(awareN, 777);
const pressOnly = awareStudy(awareN, 777, { press: true, conserve: false });
const conserveOnly = awareStudy(awareN, 777, { press: false, conserve: true });
const noop = awareStudy(Math.min(awareN, 1000), 777, { press: false, conserve: false });
console.log(`aware done ${((performance.now() - t0) / 1000).toFixed(0)} s`);
const report = { generatedBy: "src/balance/pools-study.ts", design: "random", before, after, aware, pressOnly, conserveOnly, noopControl: noop };
await Deno.writeTextFile(out, JSON.stringify(report, null, 2) + "\n");
console.log(`wrote ${out}`);
