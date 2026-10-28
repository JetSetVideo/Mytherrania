// deno-lint-ignore-file no-explicit-any
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";
const server = Deno.serve({ hostname: "127.0.0.1", port: 8814, onListen() {} }, (r) => serveAsset(r));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await b.newPage({ viewport: { width: 800, height: 800 } });
await page.goto("http://127.0.0.1:8814/index.html", { waitUntil: "load" });
await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 15000 });
await page.click('[data-action="start"]');
await page.waitForTimeout(1200);
for (const [race, sub] of [["elf", "high"], ["dwarf", "forge"], ["ork", "bloodfang"]] as const) {
  await page.evaluate(([r, s]) => (globalThis as any).__MYTHERRANIA__.engine.debugSetModel({ race: r, subrace: s, className: "Mage" }), [race, sub]);
  await page.waitForTimeout(700);
  const dbg = await page.evaluate(() => {
    const eng = (globalThis as any).__MYTHERRANIA__.engine as any;
    // Reach into the player's rig group and count the hair/ear/tusk meshes by name traversal.
    const s = (globalThis as any).__MYTHERRANIA__.snapshot();
    const pp = eng.playerProfile ?? {};
    return { profileRace: pp.race, profileSub: pp.subrace, snapRace: s.player.race, snapSub: s.player.subrace };
  });
  console.log(`${race}/${sub}:`, JSON.stringify(dbg));
}
await b.close(); server.shutdown();
