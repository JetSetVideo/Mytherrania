import { chromium } from "playwright";
import { installProbe } from "./browser-probe.ts";

const base = "http://127.0.0.1:8788";
await Deno.mkdir("artifacts/fight", { recursive: true });
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await context.addInitScript(installProbe);

const frames: { t: number; snapshot: Record<string, unknown> }[] = [];
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("canvas") !== null);
  await page.waitForTimeout(600);

  // Drive the player toward the opponent and attack repeatedly to force a knockout/ring-out.
  const snapshot = () => page.evaluate(() => {
    const d = (globalThis as unknown as { __MYTHERRANIA__: { snapshot(): Record<string, unknown> } }).__MYTHERRANIA__;
    return d.snapshot();
  });

  await page.keyboard.down("KeyD");
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(120);
    await page.keyboard.press("Space");
    if (i % 10 === 0) frames.push({ t: i, snapshot: await snapshot() });
  }
  await page.keyboard.up("KeyD");
  await page.waitForTimeout(800);
  frames.push({ t: 40, snapshot: await snapshot() });

  await page.screenshot({ path: "artifacts/fight/end.png" });
  const probe = await page.evaluate(() => Reflect.get(globalThis, "__PROBE__"));

  const report = {
    timestamp: new Date().toISOString(),
    frames,
    winner: frames.at(-1)?.snapshot.winner,
    cpuMean: probe.cpu.reduce((a: number, b: number) => a + b, 0) / Math.max(probe.cpu.length, 1),
    gpuMean: probe.gpu.reduce((a: number, b: number) => a + b, 0) / Math.max(probe.gpu.length, 1),
    errors,
    bodyText: await page.locator("body").innerText(),
  };
  await Deno.writeTextFile("artifacts/fight/report.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) Deno.exitCode = 1;
} finally {
  await browser.close();
}