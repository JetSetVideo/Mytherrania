// Balance report: mirror matchups, per-class field average, and the full pair
// matrix, so a "48-52%" claim can be checked against what it actually means.
//   deno run --allow-read tools/balance-report.ts [fightsPerPair]
import { runArena } from "../src/balance/ArenaHarness.ts";
import { CLASSES, createStats, powerIndex, type ClassName } from "../src/game/Stats.ts";

const FIGHTS = Number(Deno.args[0] ?? 4000);
const SEED = 20261009;

console.log("class combat stats (after race bonus, human):");
for (const c of CLASSES) {
  const s = createStats(c);
  console.log(" ", c.padEnd(12), "HP", s.maxHealth.toFixed(1).padStart(5),
    "pow", s.attackPower.toFixed(2).padStart(5), "itv", s.attackInterval.toFixed(3),
    "arm", s.armor.toFixed(2), "index", powerIndex(s).toFixed(0));
}

const r = runArena(SEED, FIGHTS, "human");
const share = {} as Record<ClassName, { w: number; n: number }>;
for (const c of CLASSES) share[c] = { w: 0, n: 0 };
for (const pr of r.pairResults) {
  share[pr.a].w += pr.p; share[pr.a].n++;
  share[pr.b].w += 1 - pr.p; share[pr.b].n++;
}
console.log("\nper-class mean win share across the other seven classes:");
for (const c of CLASSES) console.log(" ", c.padEnd(12), ((share[c].w / share[c].n) * 100).toFixed(1) + "%");

// Mirror matchups: the spec's "two bots of identical level and gear tier".
// The harness only runs DISTINCT pairs, so a mirror is measured directly here.
console.log("\nmirror matchups (identical class, identical stats):");
import { attackDamage } from "../src/game/Stats.ts";
import { randomSource } from "../src/balance/ArenaHarness.ts";
function mirror(s: ReturnType<typeof createStats>, seed: number, n: number) {
  const ra = randomSource(seed), rb = randomSource(seed ^ 0x9e3779b9);
  let aWins = 0, draws = 0;
  for (let i = 0; i < n; i++) {
    let aHp = s.maxHealth, bHp = s.maxHealth, aT = s.attackInterval, bT = s.attackInterval;
    let out = -1;
    for (let t = 0; t < 600; t++) {
      const aGo = aT <= bT + 0.0005, bGo = bT <= aT + 0.0005;
      if (aGo) aT += s.attackInterval;
      if (bGo) bT += s.attackInterval;
      let aD = false, bD = false;
      if (aGo) { bHp -= attackDamage(s, s, ra(), ra()); if (bHp <= 0) bD = true; }
      if (bGo) { aHp -= attackDamage(s, s, rb(), rb()); if (aHp <= 0) aD = true; }
      if (aD && bD) { out = 0.5; break; }
      if (bD) { out = 1; break; }
      if (aD) { out = 0; break; }
    }
    if (out === 0.5) draws++;
    else if (out === 1) aWins++;
  }
  return { rate: aWins / (n - draws), draws, n };
}
for (const c of CLASSES) {
  const m = mirror(createStats(c), SEED, FIGHTS);
  console.log(" ", c.padEnd(12), (m.rate * 100).toFixed(1) + "%", "(draws", m.draws + "/" + m.n + ")");
}

console.log("\nfull pair matrix (row beats column, decisive-only):");
console.log("            " + CLASSES.map((c) => c.slice(0, 6).padStart(8)).join(""));
const grid: Record<string, Record<string, number>> = {};
for (const pr of r.pairResults) {
  (grid[pr.a] ??= {})[pr.b] = pr.p;
  (grid[pr.b] ??= {})[pr.a] = 1 - pr.p;
}
for (const a of CLASSES) {
  console.log(a.slice(0, 11).padEnd(12) + CLASSES.map((b) => a === b ? "   --" : ((grid[a][b] * 100).toFixed(0) + "%").padStart(8)).join(""));
}
console.log(`\nbalanced pairs: ${r.balanced}/${r.total}  (48-52% band, decisive-only, seed ${SEED}, ${FIGHTS} fights/pair)`);
