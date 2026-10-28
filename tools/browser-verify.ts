import { chromium } from "playwright";
import { installProbe } from "./browser-probe.ts";
import { assessBudget } from "./budget.ts";

const base = "http://127.0.0.1:8788";
await Deno.mkdir("artifacts/screenshots", { recursive: true });
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const externalRequests: string[] = [];
const failures: string[] = [];
const consoleErrors: string[] = [];
const requests: string[] = [];
await context.route("**/*", async (route) => {
  const url = route.request().url();
  requests.push(url);
  if (!url.startsWith(`${base}/`)) {
    externalRequests.push(url);
    await route.abort();
  } else await route.continue();
});
await context.addInitScript(installProbe);
const page = await context.newPage();
page.on("pageerror", (error) => consoleErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on(
  "requestfailed",
  (request) => failures.push(`${request.url()}: ${request.failure()?.errorText}`),
);
page.on("response", (response) => {
  if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
});
function summary(values: number[]) {
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    samples: sorted.length,
    mean: sorted.reduce((a, b) => a + b, 0) / Math.max(sorted.length, 1),
    p95: sorted[Math.floor(sorted.length * .95)] ?? null,
    max: sorted.at(-1) ?? null,
    overBudget: sorted.filter((n) => n > 16.6).length,
  };
}
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("canvas") !== null);
  await page.waitForTimeout(2500);
  // Exclude shader compilation/warmup; instrumentation overhead remains included.
  await page.evaluate(() => Reflect.get(globalThis, "__RESET_PROBE__")());
  await page.waitForFunction(
    () => Reflect.get(globalThis, "__PROBE__").cpu.length >= 600,
    undefined,
    { timeout: 30000, polling: 100 },
  );
  const probe = await page.evaluate(() => Reflect.get(globalThis, "__PROBE__"));
  const captures: { path: string; width: number; height: number; state: string }[] = [];
  for (const [width, height] of [[1440, 900], [768, 1024], [375, 812]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(350);
    const path = `artifacts/screenshots/root-${width}.png`;
    await page.screenshot({ path });
    captures.push({ path, width, height, state: "root" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) failures.push(`Horizontal overflow at ${width}`);
  }
  const sourceHashes: Record<string, string> = {};
  for (const file of ["dist/app.js", "dist/index.html", "dist/styles.css"]) {
    const digest = await crypto.subtle.digest("SHA-256", await Deno.readFile(file));
    sourceHashes[file] = [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  }
  const report = {
    timestamp: new Date().toISOString(),
    profile: {
      browser: await browser.version(),
      renderer: probe.renderer,
      viewport: "1440x900 DPR1",
      load: "warm after 2.5s, 600 callbacks",
      network: "only localhost allowed",
    },
    sourceHashes,
    frameBudget: assessBudget(probe.cpu, probe.gpu, probe.gpuSupported),
    cpuCallbackMs: summary(probe.cpu),
    gpuMs: summary(probe.gpu),
    rafIntervalMs: summary(probe.raf),
    gpuSupported: probe.gpuSupported,
    gpuDisjointEvents: probe.disjoint,
    lcpMs: probe.lcpMs,
    cls: probe.cls,
    captures,
    requests: [...new Set(requests)],
    externalRequests,
    failures,
    consoleErrors,
    uncaught: probe.errors,
    bodyText: await page.locator("body").innerText(),
    limits:
      "Warm idle-root lab only. CPU callback includes update and submission, not GPU completion. rAF cadence separate; GPU timer measures actual commands. No allocation or exhaustive path-coverage claim.",
  };
  await Deno.writeTextFile("artifacts/browser.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (
    !report.frameBudget.pass || failures.length || consoleErrors.length ||
    externalRequests.length || probe.errors.length
  ) {
    Deno.exitCode = 1;
  }
} finally {
  await browser.close();
}
