import { chromium } from "playwright";
import { installProbe } from "./browser-probe.ts";

const base = "http://127.0.0.1:8788";
await Deno.mkdir("artifacts/fight", { recursive: true });
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await context.addInitScript(installProbe);

try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("canvas") !== null);
  // Set isometric camera for a clear overview of the ring
  await page.evaluate(() => {
    const dlg = document.getElementById("settings-dialog")!;
    const sel = dlg.querySelector("#sel-camera") as HTMLSelectElement;
    sel.value = "isometric";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "artifacts/fight/ring-overview.png" });

  // Also capture birds-eye
  await page.evaluate(() => {
    const dlg = document.getElementById("settings-dialog")!;
    const sel = dlg.querySelector("#sel-camera") as HTMLSelectElement;
    sel.value = "birds-eye";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "artifacts/fight/ring-birds-eye.png" });

  const snap = await page.evaluate(() => {
    const d = (globalThis as unknown as { __MYTHERRANIA__: { snapshot(): Record<string, unknown> } }).__MYTHERRANIA__;
    return d.snapshot();
  });
  console.log(JSON.stringify(snap, null, 2));
} finally {
  await browser.close();
}