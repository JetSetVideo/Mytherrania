// Parallel arena runner using Deno workers
import { CLASSES, type ClassName } from "../src/game/Stats.ts";

const WORKERS = parseInt(Deno.args[2] || "4");
const SEED = parseInt(Deno.args[0] || "20261009");
const FIGHTS = parseInt(Deno.args[1] || "10000");

const pairs: [ClassName, ClassName][] = [];
for (let i = 0; i < CLASSES.length; i++)
  for (let j = i + 1; j < CLASSES.length; j++)
    pairs.push([CLASSES[i], CLASSES[j]]);

const t0 = performance.now();
const actualWorkers = Math.min(WORKERS, pairs.length);
const chunks: { a: ClassName; b: ClassName; seed: number; fights: number; index: number }[][] =
  Array.from({ length: actualWorkers }, () => []);

for (let p = 0; p < pairs.length; p++) {
  chunks[p % actualWorkers].push({
    a: pairs[p][0], b: pairs[p][1],
    seed: (SEED ^ (p * 0x9e3779b9)) >>> 0,
    fights: FIGHTS, index: p,
  });
}

const workerUrl = new URL("../src/balance/arena-worker.ts", import.meta.url);
const allResults = await Promise.all(chunks.map((chunk) => {
  const w = new Worker(workerUrl, { type: "module" });
  const results: { index: number; wins: number; draws: number; trials: number }[] = [];
  let done = 0;
  const promise = new Promise<typeof results>((resolve) => {
    w.onmessage = (e) => { results.push(e.data); if (++done === chunk.length) { w.terminate(); resolve(results); } };
  });
  for (const task of chunk) w.postMessage(task);
  return promise;
}));

// Aggregate
const flat = allResults.flat().sort((a, b) => a.index - b.index);
function wilson(wins: number, trials: number): [number, number] {
  if (trials === 0) return [NaN, NaN];
  const p = wins/trials, z=1.96, d=1+z*z/trials, c=(p+z*z/(2*trials))/d;
  const m=z*Math.sqrt((p*(1-p)+z*z/(4*trials))/trials)/d;
  let lo=c-m, hi=c+m; if (wins===0) lo=0; if (wins===trials) hi=1;
  return [Math.max(0,lo),Math.min(1,hi)];
}

let balanced = 0;
console.log(`${actualWorkers}-worker arena (${FIGHTS} fights/pair, seed ${SEED}):`);
for (const r of flat) {
  const decisive = r.trials - r.draws;
  const pct = decisive > 0 ? r.wins / decisive : 0.5;
  const ci = wilson(Math.round(r.wins), decisive);
  if (pct >= 0.48 && pct <= 0.52) balanced++;
  const [a, b] = pairs[r.index];
  console.log(`  ${a.padEnd(12)} vs ${b.padEnd(12)} p=${pct.toFixed(3)} draws=${r.draws} ci=[${ci[0].toFixed(3)},${ci[1].toFixed(3)}]`);
}
const elapsed = Math.round(performance.now() - t0);
console.log(`${balanced}/${pairs.length} balanced (${elapsed}ms)`);