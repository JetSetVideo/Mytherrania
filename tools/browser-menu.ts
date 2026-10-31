import { chromium } from "playwright";
import { installProbe } from "./browser-probe.ts";

const base = "http://127.0.0.1:8788";
await Deno.mkdir("artifacts/menu", { recursive: true });
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

try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("canvas") !== null);
  await page.waitForTimeout(600);

  const title = await page.locator(".menu-screen[data-screen='title']").isVisible();
  await page.screenshot({ path: "artifacts/menu/title.png" });

  await page.click('[data-action="start"]');
  await page.waitForTimeout(300);
  const creatorVisible = await page.locator(".menu-screen[data-screen='select']").isVisible();
  const paletteCount = await page.locator(".palette-chip").count();
  await page.screenshot({ path: "artifacts/menu/creator.png" });

  // Random generate a character, then pick a class and an NPC opponent
  // Wave L renamed the roll button: the Random button became the purple rocky dice button.
  await page.click('[data-action="dice"]');
  await page.waitForTimeout(200);
  await page.selectOption("#creator-class", "Assassin");
  await page.selectOption("#menu-opponent", { label: "Nyra (Assassin)" });
  await page.click('[data-action="begin"]');
  await page.waitForTimeout(1000);

  const snap = await page.evaluate(() => {
    const d = (globalThis as unknown as { __MYTHERRANIA__: { snapshot(): Record<string, unknown> } }).__MYTHERRANIA__;
    return d.snapshot();
  });
  await page.screenshot({ path: "artifacts/menu/fight.png" });

  console.log(JSON.stringify({ title, creatorVisible, paletteCount, snapshot: snap, errors }, null, 2));
  if (errors.length || !title || !creatorVisible) Deno.exitCode = 1;
} finally {
  await browser.close();
}