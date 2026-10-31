// deno-lint-ignore-file no-explicit-any -- QA probe: reads the untyped window.__MYTHERRANIA__ debug global.
// Wave M probe — the wave's claims, each MEASURED in a real Chrome:
//   1. the frontend accumulates the fight's telemetry LIVE (dry streaks, distances, bands, damage) and
//      stops when the bell rings: one accumulator per match, fed per substep;
//   2. at the bell ONE report is assembled — compact, under its byte cap, carrying both seats' telemetry
//      and an opponent model whose probable strategies are real decision-tree ids;
//   3. the reading page's one-click batch runs the SIMULATOR (no rendering) and prints min/p10/median/
//      mean/p90/max per variable, with the ending distribution — the timeout share is the number the
//      user's complaint is about;
//   4. the batch does not freeze the game: the frame loop keeps its cadence while it runs.
//   deno run -A tools/probe-wave-m.ts
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";

const PORT = 8815;
const server = Deno.serve({ hostname: "127.0.0.1", port: PORT, onListen() {} }, (r) => serveAsset(r));
const b = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});
await Deno.mkdir("artifacts/qa-wave-m", { recursive: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await p.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
await p.waitForTimeout(700);

const call = (fn: string, ...args: unknown[]) =>
  p.evaluate(([f, a]) => (globalThis as any).__MYTHERRANIA__.engine[f as string](...(a as unknown[])), [fn, args] as const);
const report: Record<string, any> = {};

// ── 1. a live match, with a short bell so the telemetry can be read at the end of it
await call("debugView", { timeLimit: 8 });
await p.click('[data-action="spectate"]');
await p.waitForTimeout(1200);
const live = await call("debugFightTelemetry");
await p.waitForTimeout(2500);
const live2 = await call("debugFightTelemetry");
report.live = {
  live: live.live,
  quietAtStart: live.quietS,
  quietLater: live2.quietS,
  durationS: live2.summary?.durationS ?? null,
  distanceMean: live2.summary?.distance.mean ?? null,
  distanceMedian: live2.summary?.distance.median ?? null,
  bands: live2.summary?.bands ?? null,
  standoffMaxS: live2.summary?.engagement.standoffMaxS ?? null,
  dryMaxS: live2.summary?.dryStreak.map((s: any) => s.maxS) ?? null,
  // The accumulator is fed per substep: the distance statistics must be populated, not zeros.
  accumulated: (live2.summary?.durationS ?? 0) > 0 && (live2.summary?.distance.mean ?? 0) > 0,
};

// ── 2. the bell: one report, assembled once. A spectate match's bell is a HOSTILE clock (30 s by
// default, and the truce does not count), so wait for the clock to decide before reading the report —
// polling for a fixed number of seconds measures the timeout, not the report.
let decided = false;
for (let i = 0; i < 200 && !decided; i++) {
  await p.waitForTimeout(500);
  const clock = await call("debugClock");
  decided = clock.decided === true;
}
let reportAfter: any = null;
for (let i = 0; i < 40 && reportAfter === null; i++) {
  await p.waitForTimeout(250);
  reportAfter = await call("debugMatchReport");
}
report.bell = { decided, waitedS: null };
const bytes = reportAfter ? new TextEncoder().encode(JSON.stringify(reportAfter)).length : 0;
report.report = reportAfter === null ? { assembled: false } : {
  assembled: true,
  bytes,
  schema: reportAfter.schema,
  outcome: reportAfter.outcome,
  telemetrySeats: reportAfter.telemetry.length,
  seatDurations: reportAfter.telemetry.map((t: any) => t.durationS),
  strategies: reportAfter.opponent.probableStrategies.map((s: any) => s.id),
  strategyWeightsSum: Math.round(reportAfter.opponent.probableStrategies.reduce((a: number, s: any) => a + s.weight, 0) * 1e6) / 1e6,
  habits: reportAfter.opponent.habits,
  // Privacy, read off the wire: no name, no coordinate array.
  containsNoWords: !/Aldric|Vail|MY-|"name"/.test(JSON.stringify(reportAfter)),
};
await p.screenshot({ path: "artifacts/qa-wave-m/01-report-bell.png" });

// ── 3. the reading page's one-click batch (the reading page = History)
await p.click('[data-action="menu"]').catch(() => {});
await p.waitForTimeout(400);
await call("debugView", { timeLimit: null });
await p.click('[data-action="digest"]').catch(() => p.evaluate(() => (document.querySelector('[data-action="digest"]') as HTMLElement)?.click()));
await p.waitForTimeout(900);
const bar = await p.evaluate(() => {
  const sizes = [...document.querySelectorAll("[data-batch-size]")].map((x) => Number((x as HTMLElement).dataset.batchSize));
  const run = document.querySelector('[data-action="run-batch"]') as HTMLElement | null;
  return { sizes, runPresent: !!run, runLabel: run?.textContent?.trim() ?? "" };
});
// 100 matches, and a frame-cadence sample taken WHILE it runs: the simulator must not freeze the page.
await p.evaluate(() => (document.querySelector('[data-batch-size="100"]') as HTMLElement)?.click());
const framesDuringBatch: number[] = [];
const sampleFrames = p.evaluate(async () => {
  const t: number[] = [];
  await new Promise<void>((done) => {
    let n = 0;
    const step = () => {
      const a = performance.now();
      requestAnimationFrame(() => { t.push(performance.now() - a); if (++n < 40) step(); else done(); });
    };
    step();
  });
  return t;
});
await p.click('[data-action="run-batch"]');
const midProgress = await p.evaluate(async () => {
  // Read the progress a few times while the batch is running.
  const out: string[] = [];
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 60));
    const el = document.querySelector("#batch-status");
    if (el) out.push(el.textContent ?? "");
  }
  return out;
});
framesDuringBatch.push(...(await sampleFrames));
let summary: any = null;
for (let i = 0; i < 80 && summary === null; i++) {
  await p.waitForTimeout(250);
  summary = await p.evaluate(() => (globalThis as any).__MYTHERRANIA__.engine.debugBatch());
}
framesDuringBatch.sort((a, b) => a - b);
report.batch = {
  bar,
  progressReadings: midProgress,
  frameMsDuringBatch: { p50: Math.round(framesDuringBatch[Math.floor(framesDuringBatch.length * 0.5)] * 100) / 100, p90: Math.round(framesDuringBatch[Math.floor(framesDuringBatch.length * 0.9)] * 100) / 100, n: framesDuringBatch.length },
  matches: summary?.matches ?? null,
  variables: summary ? Object.keys(summary.variables) : [],
  endings: summary?.reasons ?? null,
  // The timeout share is the number the user's complaint is about.
  timeoutShare: summary ? Math.round(100 * (Object.entries(summary.reasons).filter(([k]) => /limit|timeout|tie|^time$/i.test(k)).reduce((a, [, n]: any) => a + n, 0) / Math.max(1, summary.matches))) : null,
  // A couple of variables with their whole spread, so the summary is visibly a summary.
  sample: summary ? Object.fromEntries(Object.entries(summary.variables).slice(0, 5).map(([k, v]: any) => [k, { min: v.min, p10: v.p10, median: v.median, mean: v.mean, p90: v.p90, max: v.max }])) : null,
};
await p.screenshot({ path: "artifacts/qa-wave-m/02-batch-summary.png" });

report.errors = errors;
await p.screenshot({ path: "artifacts/qa-wave-m/03-final.png" });
await Deno.writeTextFile("artifacts/qa-wave-m/report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await b.close();
server.shutdown();
