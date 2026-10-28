// deno-lint-ignore-file no-explicit-any
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";
const server = Deno.serve({ hostname: "127.0.0.1", port: 8811, onListen() {} }, (r) => serveAsset(r));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await b.newPage({ viewport: { width: 800, height: 800 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e)));
await page.goto("http://127.0.0.1:8811/index.html", { waitUntil: "load" });
await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 15000 });
await Deno.mkdir("artifacts/qa-models", { recursive: true });

await page.click('[data-action="start"]');
await page.waitForTimeout(1200);

const RACES = [
  { id: "human", sub: "imperial", cls: "Warrior" },
  { id: "elf", sub: "high", cls: "Mage" },
  { id: "dwarf", sub: "forge", cls: "Warrior" },
  { id: "ork", sub: "bloodfang", cls: "Barbarian" },
] as const;

for (const race of RACES) {
  await page.evaluate((r) => (globalThis as any).__MYTHERRANIA__.engine.debugSetModel({ race: r.id, subrace: r.sub, className: r.cls }), race);
  await page.waitForTimeout(1000);
  await page.evaluate(() => (globalThis as any).__MYTHERRANIA__.engine.debugView({ freeze: true, hour: 12 }));
  // Angles are CHARACTER-RELATIVE: the player faces +X (toward the opponent), so
  // "front" is the +X side and "back" is the -X side. World-relative yaw would shoot
  // the side of the head and miss the hair fall entirely.
  const angles: [string, number][] = [["front", Math.PI / 2], ["side", Math.PI], ["back", -Math.PI / 2]];
  for (const [name, yaw] of angles) {
    await page.evaluate((v) => (globalThis as any).__MYTHERRANIA__.engine.debugView({ clean: true, pose: "idle", orbit: { yaw: v, pitch: 0.1, dist: 4.6 } }), yaw);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `artifacts/qa-models/${race.id}-${name}.png` });
  }
  console.log(`${race.id}: captured front/side/back`);
}
console.log("wrote artifacts/qa-models/*.png");
await b.close(); server.shutdown();
