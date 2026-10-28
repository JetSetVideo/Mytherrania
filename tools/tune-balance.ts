// Empirical balance calibration for the eight archetypes.
//
// Step 1 solves each class's damage so every archetype starts with the same
// DPS x effective-HP product (see deriveCombatStats in src/game/Stats.ts).
// That gets the field close but not to parity, because crit rates, damage
// variance and mutual kills still differ per archetype.
// Step 2 therefore closes the loop on the ARENA itself: measure each class's
// mean win share across its seven pairs, nudge that class's damage toward 50%,
// and repeat until the win matrix sits inside the 48-52% band. The result is
// written as a per-class calibration table in src/game/Stats.ts.
//
//   deno run -A tools/tune-balance.ts [rounds] [fights-per-pair]
import { runArena } from "../src/balance/ArenaHarness.ts";
import { CLASSES, DAMAGE_SCALE, POWER_CALIBRATION, type ClassName } from "../src/game/Stats.ts";

const ROUNDS = Number(Deno.args[0] ?? 25);
const FIGHTS = Number(Deno.args[1] ?? 3000);
const SEEDS = [20261009, 777, 31337];
const STEP = 0.03;      // how hard to pull a class toward 50%. Win share is nearly a
                        // step function of damage (~60 hits/kill averages the variance
                        // away), so 0.22 overshot and oscillated: +-2% damage swung the
                        // Barbarian between 63% and 34%.
const MAX_ADJ = 0.6;    // never move a class's damage more than ±60%

/** Mean absolute distance of the class shares from 50%: smooth, unlike a pair count. */
function deviation(shares: Record<ClassName, number>): number {
  return CLASSES.reduce((s, c) => s + Math.abs(shares[c] - 0.5), 0) / CLASSES.length;
}

/** Override a class's attack power and re-run the arena, reporting win shares. */
function measure(adj: Record<ClassName, number>) {
  let balanced = 0, total = 0;
  const share = {} as Record<ClassName, { w: number; n: number }>;
  for (const c of CLASSES) share[c] = { w: 0, n: 0 };
  for (const seed of SEEDS) {
    const r = runArena(seed, FIGHTS, "human", (_c, base) => {
      const s = { ...base };
      // `base` already carries the calibration that was in Stats.ts when this module was
      // IMPORTED; rewriting the file below does not re-import it. Divide that out so
      // `adj` is fitted against the uncalibrated solve and written as an absolute value.
      // (Without this the tuner fitted offsets on top of the old ones, then saved them as
      // if absolute: it reported 0.07% deviation while the real game sat at 70/34%.)
      const uncal = s.attackPower / (1 + (POWER_CALIBRATION[_c] ?? 0));
      // The damage band is in SCALED units (5..14 x DAMAGE_SCALE). Clamping to the raw
      // 5..14 here pinned every class to 14 damage after the x1000 health change, so the
      // tuner measured a game where nobody could die inside the tick cap.
      s.attackPower = Math.max(5 * DAMAGE_SCALE, Math.min(14 * DAMAGE_SCALE, uncal * (1 + adj[_c])));
      return s;
    });
    balanced += r.balanced; total += r.total;
    for (const pr of r.pairResults) {
      share[pr.a].w += pr.p; share[pr.a].n++;
      share[pr.b].w += 1 - pr.p; share[pr.b].n++;
    }
  }
  const shares = {} as Record<ClassName, number>;
  for (const c of CLASSES) shares[c] = share[c].w / share[c].n;
  return { balanced, total, shares };
}

if (import.meta.main) {
  // Reset any previous calibration first: the loop measures the solved base, so
  // starting from a non-zero table would compound the previous fit.
  const reset = Deno.readTextFileSync("src/game/Stats.ts").replace(
    /(export const POWER_CALIBRATION: Record<ClassName, number> = \{[\s\S]*?\n\};)/,
    "export const POWER_CALIBRATION: Record<ClassName, number> = {\n" +
      CLASSES.map((c) => `  ${c}: 0,`).join("\n") + "\n};",
  );
  Deno.writeTextFileSync("src/game/Stats.ts", reset);
  const adj = {} as Record<ClassName, number>;
  for (const c of CLASSES) adj[c] = 0;
  let cur = measure(adj);
  let best = { balanced: cur.balanced, total: cur.total, dev: deviation(cur.shares), adj: { ...adj } };
  console.log(`round 0: balanced ${cur.balanced}/${cur.total}  mean |share-50%| ${(best.dev * 100).toFixed(2)}%`);
  for (let round = 1; round <= ROUNDS; round++) {
    // Correct from the LATEST measurement (using a stale snapshot diverges).
    for (const c of CLASSES) {
      const dev = 0.5 - cur.shares[c];
      adj[c] = Math.max(-MAX_ADJ, Math.min(MAX_ADJ, adj[c] + dev * STEP));
    }
    cur = measure(adj);
    console.log(`round ${String(round).padStart(2)}: balanced ${cur.balanced}/${cur.total}  dev ${(deviation(cur.shares) * 100).toFixed(2)}%  ` +
      CLASSES.map((c) => `${c.slice(0, 5)} ${(cur.shares[c] * 100).toFixed(0)}%`).join(" "));
    const dev = deviation(cur.shares);
    if (dev < best.dev) best = { balanced: cur.balanced, total: cur.total, dev, adj: { ...adj } };
    if (cur.balanced === cur.total) break;
  }
  const shares = cur.shares;
  const table = CLASSES.map((c) => `  ${c}: ${best.adj[c].toFixed(4)},`).join("\n");
  console.log(`\nfinal: balanced ${best.balanced}/${best.total}`);
  console.log(`calibration (multiplier offsets):\n${table}`);
  const src = Deno.readTextFileSync("src/game/Stats.ts");
  const block = `// Per-class damage calibration fitted by tools/tune-balance.ts against the\n// arena harness (3 seeds x ${FIGHTS} fights/pair). Applied on top of the solved\n// power so each archetype's win rate against the field lands near 50%.\nexport const POWER_CALIBRATION: Record<ClassName, number> = {\n${table}\n};\n`;
  const next = src.includes("export const POWER_CALIBRATION")
    ? src.replace(/\/\/ Per-class damage calibration[\s\S]*?\n\};\n/, block)
    : src.replace("const PRESETS:", block + "\nconst PRESETS:");
  Deno.writeTextFileSync("src/game/Stats.ts", next);
  Deno.writeTextFileSync("artifacts/tune.json", JSON.stringify({ adj: best.adj, balanced: best.balanced, total: best.total, shares, fights: FIGHTS, seeds: SEEDS }, null, 2));
  console.log("wrote POWER_CALIBRATION into src/game/Stats.ts and artifacts/tune.json");
}
