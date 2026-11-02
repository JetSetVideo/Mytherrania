// deno-lint-ignore-file no-explicit-any -- QA probe: reads the untyped window.__MYTHERRANIA__ debug global.
// Wave Y (lane P) probe — the pool POTENTIAL in a live fight, measured in a real Chrome:
//   1. debugPools() reports both seats' {max, potential, current} x 3 and the invariant holds;
//   2. the HUD's three-layer bars (.pool-bar > .pool-potential / .pool-current / .pool-lost) exist for both
//      fighters and their widths match debugPools();
//   3. after hits land and the player spends fast (debugPress), the health potential (wounds) and the
//      stamina / mana potentials (fatigue) are lower and the bars' .pool-lost regions grew;
//   4. 0 page errors, 0 CSP violations.
//   BUILD_OUT=dist-pools deno task build && deno run -A tools/probe-wave-y-pools.ts [dist-pools] [outDir]
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";

const ROOT = Deno.args[0] ?? "dist-pools";
const OUT = Deno.args[1] ?? "artifacts/qa-wave-y/pools";
await Deno.mkdir(OUT, { recursive: true });
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (r) => serveAsset(r, ROOT));
const PORT = (server.addr as Deno.NetAddr).port;
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [], csp: string[] = [];
p.on("pageerror", (e) => errors.push(String(e)));
p.on("console", (m) => { if (m.type() === "error" && /Content Security Policy|Refused to apply inline style/i.test(m.text())) csp.push(m.text()); });
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await p.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
await p.waitForTimeout(600);
const call = (fn: string, ...args: unknown[]) =>
  p.evaluate(([f, a]) => { const e = (globalThis as any).__MYTHERRANIA__.engine; return e[f as string].call(e, ...(a as unknown[])); }, [fn, args] as const);
const report: Record<string, any> = { root: ROOT };

await call("debugStartDuel", "Mage", "Barbarian");
await p.waitForTimeout(1200);
// Pitfall 19: a headless page never holds pointer lock, the lost lock PAUSES the fight; resume until the clock moves.
const running = async (): Promise<boolean> => {
  const a = await call("debugClock"); await p.waitForTimeout(500); const c = await call("debugClock");
  return (c.sinceStart ?? 0) > (a.sinceStart ?? 0) + 0.3;
};
for (let i = 0; i < 6; i++) {
  if (await running()) break;
  await p.click("canvas", { position: { x: 700, y: 450 } }).catch(() => {});
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
}
report.harness = { runningAfterResume: await running() };

const bars = () => p.evaluate(() => [...document.querySelectorAll(".pool-bar")].map((el) => {
  const e = el as HTMLElement, w = (c: string) => (e.querySelector(c) as HTMLElement | null)?.style;
  return {
    seat: e.dataset.seat, pool: e.dataset.pool, max: +(e.dataset.max ?? 0), potential: +(e.dataset.potential ?? 0), current: +(e.dataset.current ?? 0),
    potentialW: w(".pool-potential")?.width, currentW: w(".pool-current")?.width, lostLeft: w(".pool-lost")?.left, lostW: w(".pool-lost")?.width,
    text: e.querySelector(".pool-text")?.textContent ?? "", inPanel: !!e.closest(".fighter-panel"), rendered: e.getBoundingClientRect().height > 0,
    inlineStyleAttr: e.getAttribute("style") ?? "",
  };
}));
const shoot = async (tag: string) => {
  await p.screenshot({ path: `${OUT}/${tag}-full.png` });
  for (const id of ["hud-player", "hud-opponent"]) await p.locator(`#${id}`).screenshot({ path: `${OUT}/${tag}-${id}.png` }).catch((e) => errors.push(`shot ${id}: ${e}`));
};
// Wait for the truce to lift, then read the "before".
for (let i = 0; i < 20; i++) { const c = await call("debugClock"); if ((c.hostile ?? 0) > 0.5) break; await p.waitForTimeout(500); }
await p.waitForTimeout(400);
report.before = { pools: await call("debugPools"), bars: await bars(), clock: await call("debugClock") };
await shoot("before");

// The player seat is idle (no input): the Barbarian AI lands blows on it. Meanwhile the player SPENDS
// fast — dash / defence / power presses back to back — to raise stamina and mana fatigue.
const presses: Record<string, number> = { dash: 0, defense: 0, power: 0 };
for (let i = 0; i < 40; i++) {
  for (const k of ["dash", "defense", "power"] as const) if (await call("debugPress", k)) presses[k]++;
  await p.waitForTimeout(350);
  const c = await call("debugClock");
  if (c.decided) break;
}
report.presses = presses;
await p.waitForTimeout(300);
report.after = { pools: await call("debugPools"), bars: await bars(), clock: await call("debugClock") };
await shoot("after");

// Verdicts — every number from the page.
const seatPools = (r: any, s: number) => r.pools[s].pools;
const B0 = seatPools(report.before, 0), A0 = seatPools(report.after, 0);
const widthsMatch = (snap: any) => snap.bars.every((x: any) => {
  const pl = snap.pools[+x.seat].pools[x.pool];
  const pf = pl.max > 0 ? pl.potential / pl.max * 100 : 0, cf = pl.max > 0 ? pl.current / pl.max * 100 : 0;
  // The HUD paints at 4 Hz while the sim runs on: the potential moves slowly (tight band), the current
  // can move a blow's worth between the paint and this read (loose band). The layers must agree exactly.
  const pw = parseFloat(x.potentialW), cw = parseFloat(x.currentW);
  return Math.abs(pw - pf) < 2 && Math.abs(cw - cf) < 15 && cw <= pw + 1e-6 &&
    Math.abs(parseFloat(x.lostLeft) - pw) < 0.02 && Math.abs(parseFloat(x.lostW) - (100 - pw)) < 0.02;
});
report.verdict = {
  barsFor6Pools: report.after.bars.length === 6 && report.after.bars.every((x: any) => x.inPanel && x.rendered),
  invariantBefore: report.before.pools.every((s: any) => s.invariant),
  invariantAfter: report.after.pools.every((s: any) => s.invariant),
  healthPotentialFell: A0.health.potential < B0.health.potential,
  staminaOrManaPotentialFell: A0.stamina.potential < B0.stamina.potential || A0.mana.potential < B0.mana.potential,
  lostRegionGrew: report.after.bars.filter((x: any) => x.seat === "0").some((x: any) => parseFloat(x.lostW) > 0.5),
  barWidthsMatchPools: widthsMatch(report.after) && widthsMatch(report.before),
  noInlineStyleOnBar: report.after.bars.every((x: any) => x.inlineStyleAttr === ""),
  pageErrors: errors.length, cspErrors: csp.length,
};
report.errors = errors.slice(0, 5);
report.csp = csp.slice(0, 5);
await Deno.writeTextFile(`${OUT}/report.json`, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ harness: report.harness, presses, before: B0, after: A0, lostAfter: report.after.pools[0].lost, verdict: report.verdict }, null, 1));
await b.close();
await server.shutdown();
