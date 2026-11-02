// Wave FALL (agent M): the measurement runner for docs/wave-fall/MECHANICS.md.
//
//   deno run -A src/balance/fall-study.ts [--matches 6000] [--aware 3000] [--out artifacts/wave-fall/mech-balance.json]
//
// before = MatchSim with `falls: false` (byte-identical outcomes to HEAD on 300 matches, MECHANICS.md),
// after  = the Wave FALL rules on, every brain fall-aware (the shipped default);
// aware  = one seat fall-aware vs the previous brain, both ways round (FallStudy.fallAwareStudy), plus
//          the no-op control (aware switched off in both passes: exactly 0.5 by construction).

import { fallAwareStudy, fallStudy } from "./FallStudy.ts";
import * as C from "../game/Collision.ts";
import * as F from "../game/Fall.ts";

function arg(name: string, dflt: string): string {
  const i = Deno.args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < Deno.args.length ? Deno.args[i + 1] : dflt;
}

const matches = Number(arg("matches", "6000")) | 0;
const awareN = Number(arg("aware", "3000")) | 0;
const out = arg("out", "artifacts/wave-fall/mech-balance.json");
const seed = 4242;
const t0 = performance.now();
const before = fallStudy("before (falls off = HEAD rules)", matches, seed, { falls: false });
console.log(`before done ${((performance.now() - t0) / 1000).toFixed(0)} s`);
const after = fallStudy("after (falls on, fall-aware AI)", matches, seed, {});
console.log(`after done ${((performance.now() - t0) / 1000).toFixed(0)} s`);
const aware = fallAwareStudy(awareN, 777, true);
const noop = fallAwareStudy(Math.min(awareN, 1000), 777, false);
console.log(`aware done ${((performance.now() - t0) / 1000).toFixed(0)} s`);
const constants = Object.fromEntries([...Object.entries(C), ...Object.entries(F)].filter(([, v]) => typeof v === "number"));
const report = { generatedBy: "src/balance/fall-study.ts", design: "random", constants, before, after, aware, noopControl: noop };
await Deno.mkdir(out.replace(/\/[^/]*$/, ""), { recursive: true });
await Deno.writeTextFile(out, JSON.stringify(report, null, 2) + "\n");
console.log(`wrote ${out}`);
console.log(JSON.stringify({ before, after, aware, noop }, null, 1));
