import { chromium } from "playwright";
import { installProbe } from "./browser-probe.ts";

const base = "http://127.0.0.1:8788";
await Deno.mkdir("artifacts/cameras", { recursive: true });
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

const results: { mode: string; path: string; snapshot: { camera: string } }[] = [];
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("canvas") !== null);
  await page.waitForTimeout(800);

  for (const mode of ["close", "third", "isometric", "birds-eye"]) {
    await page.evaluate((m) => {
      const dlg = document.getElementById("settings-dialog")!;
      const sel = dlg.querySelector("#sel-camera") as HTMLSelectElement;
      sel.value = m;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }, mode);
    await page.waitForTimeout(500);
    const path = `artifacts/cameras/${mode}.png`;
    await page.screenshot({ path });
    const snapshot = await page.evaluate(() => {
      const diag = (globalThis as unknown as { __MYTHERRANIA__: { snapshot(): unknown } }).__MYTHERRANIA__;
      return JSON.stringify(diag.snapshot());
    });
    results.push({ mode, path, snapshot: JSON.parse(snapshot) as { camera: string } });
    console.log(`captured ${mode} -> ${path}`);
  }

  const report = {
    timestamp: new Date().toISOString(),
    modes: results.map(r => ({ mode: r.mode, path: r.path, camera: r.snapshot.camera })),
    errors,
  };
  await Deno.writeTextFile("artifacts/cameras/report.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) Deno.exitCode = 1;
} finally {
  await browser.close();
}