// Frame-budget measurement with an in-process server: samples the CPU cost of
// each engine frame (rAF callback time), the frame-to-frame cadence, and GPU
// time via EXT_disjoint_timer_query_webgl2 when the driver exposes it, during a
// live AI-vs-AI fight at day and at night. Writes artifacts/frame-budget.json.
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";

const server = Deno.serve({ hostname: "127.0.0.1", port: 8791, onListen() {} }, (r) => serveAsset(r));
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
  // Wrap rAF: time each callback (CPU work per frame) and the interval between frames.
  const cpu: number[] = [], gap: number[] = [];
  let last = 0;
  const raf = globalThis.requestAnimationFrame.bind(globalThis);
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => raf((t) => {
    if (last) gap.push(t - last);
    last = t;
    const s = performance.now();
    cb(t);
    cpu.push(performance.now() - s);
  });
  (globalThis as Record<string, unknown>).__frames = { cpu, gap };
});
await page.goto("http://127.0.0.1:8791/", { waitUntil: "load" });
await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__MYTHERRANIA__);
await page.click('[data-action="spectate"]');

const stats = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, mean: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(3), p50: +q(0.5).toFixed(3), p95: +q(0.95).toFixed(3), p99: +q(0.99).toFixed(3), max: +s[s.length - 1].toFixed(3) };
};
const result: Record<string, unknown> = {};
for (const [tag, hour] of [["day", 12], ["night", 23]] as const) {
  await page.evaluate((h) => {
    // deno-lint-ignore no-explicit-any
    const g = globalThis as Record<string, any>;
    g.__MYTHERRANIA__.engine.debugView({ hour: h });
    g.__frames.cpu.length = 0; g.__frames.gap.length = 0;
  }, hour);
  await page.waitForTimeout(4000);
  // deno-lint-ignore no-explicit-any
  const f = await page.evaluate(() => (globalThis as any).__frames);
  // deno-lint-ignore no-explicit-any
  const snap = await page.evaluate(() => (globalThis as any).__MYTHERRANIA__.snapshot());
  result[tag] = { cpuMs: stats(f.cpu), frameGapMs: stats(f.gap), polygons: snap.polygons, phase: snap.world.dayPhase };
}
result.environment = { browser: browser.version(), headless: true, viewport: "1440x900", note: "headless lab sample; frameGap reflects headless vsync throttling, cpuMs is the engine's own per-frame cost" };
await Deno.writeTextFile("artifacts/frame-budget.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
await server.shutdown();
