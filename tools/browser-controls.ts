import { chromium } from "playwright";
import { installProbe } from "./browser-probe.ts";

const base = "http://127.0.0.1:8788";
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await context.addInitScript(installProbe);

const snap = () => page.evaluate(() => {
  const d = (globalThis as unknown as { __MYTHERRANIA__: { snapshot(): Record<string, unknown> } }).__MYTHERRANIA__;
  return d.snapshot() as Record<string, unknown>;
});

try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("canvas") !== null);
  await page.waitForTimeout(400);
  await page.click('[data-action="start"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="begin"]');
  await page.waitForTimeout(600);

  const before = await snap();
  const px = (before.player as { x: number }).x;

  // Move left with KeyA for ~1 second
  await page.keyboard.down("KeyA");
  await page.waitForTimeout(900);
  await page.keyboard.up("KeyA");
  await page.waitForTimeout(200);
  const afterMove = await snap();
  const movedX = (afterMove.player as { x: number }).x;

  // Toggle first-person with KeyV
  await page.keyboard.press("KeyV");
  await page.waitForTimeout(200);
  const afterV = await snap();

  console.log(JSON.stringify({
    startX: px, afterMoveX: movedX, moved: movedX !== px,
    firstPersonBefore: before.firstPerson, firstPersonAfter: afterV.firstPerson,
    polygons: afterV.polygons, errors,
  }, null, 2));
  if (errors.length || movedX === px || !afterV.firstPerson) Deno.exitCode = 1;
} finally {
  await browser.close();
}