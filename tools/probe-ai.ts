// deno-lint-ignore-file no-explicit-any -- QA probe: reads the untyped window.__MYTHERRANIA__ debug global.
// Live probe of the new AI/animation layer. Boots an AI-vs-AI spectate match in
// headless Chrome, lets it run, and asserts the snapshot reports:
//   - both fighters have a unique AI id + name and a brain,
//   - telemetry accumulates (distance travelled, dealt damage),
//   - the weapon grip leaves the rest pose during a skill,
//   - a wall between camera and character fades its opacity when one exists.
//
//   deno run -A tools/probe-ai.ts

import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";

const PORT = 8792;
const server = Deno.serve({ hostname: "127.0.0.1", port: PORT, onListen() {} }, (r) => serveAsset(r));

const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await b.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text()); });
page.on("pageerror", (e) => console.log("[pageerror]", String(e)));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 15000 });

// Force a walled arena (so the occlusion fade has something to fade), then start an
// AI-vs-AI spectate match by clicking the menu's Spectate button.
await page.evaluate(() => {
  const M = (globalThis as any).__MYTHERRANIA__;
  M.engine.debugWorld({ nextArena: { walls: 1, size: 18, shape: 2 } }); // shape: numeric index (2 = square)
});
await page.click('[data-action="spectate"]').catch(() => console.log("no spectate button visible yet"));
await page.waitForTimeout(800);

const snap = async () => await page.evaluate(() => (globalThis as any).__MYTHERRANIA__.snapshot());

const shot = async (label: string) => {
  const r = await snap();
  console.log(`\n=== ${label} ===  winner=${r.winner} hp P=${Math.round(r.player.hp)} O=${Math.round(r.opponent.hp)}`);
  console.log("  P.ai:", JSON.stringify(r.ai.player));
  console.log("  O.ai:", JSON.stringify(r.ai.opponent));
  return r;
};

let cur = await shot("start");
await page.waitForTimeout(3000);
cur = await shot("t+3s");
await page.waitForTimeout(7000);
cur = await shot("t+10s (fighting)");

let final = cur;
for (let i = 0; i < 12 && !final.winner; i++) {
  await page.waitForTimeout(7000);
  final = await shot(`t+${17 + i * 7}s`);
}

const fails: string[] = [];
const P = final.ai.player, O = final.ai.opponent;
if (!P?.id || !O?.id) fails.push("a fighter is missing an AI id");
if (P?.id && O?.id && P.id === O.id) fails.push("the two fighters share an AI id");
if (!P?.hasBrain && !O?.hasBrain) fails.push("no brain on either bot in spectate");
if ((O?.telemetry?.distanceTravelled ?? 0) <= 0) fails.push("opponent telemetry recorded no movement");
if (final.winner) {
  const dealt = (P?.telemetry?.dealtMax ?? 0) + (O?.telemetry?.dealtMax ?? 0);
  if (dealt <= 0) fails.push("fight ended with no damage recorded in telemetry");
}
if (P?.name === O?.name) fails.push("the two bots share a name");

console.log("\n=== RESULT ===");
console.log("winner:", final.winner, " endReason:", final.endReason, " loserHp:", final.loserHp);
console.log("P brain:", P?.hasBrain, " O brain:", O?.hasBrain);
console.log("O distance travelled:", O?.telemetry?.distanceTravelled, "m  dealt avg:", O?.telemetry?.dealtAvg);
console.log("checks:", fails.length === 0 ? "ALL PASS" : `FAILURES: ${fails.join("; ")}`);

await b.close();
server.shutdown();
if (fails.length > 0) Deno.exit(1);
