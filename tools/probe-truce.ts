// deno-lint-ignore-file no-explicit-any -- QA probe: reads the untyped window.__MYTHERRANIA__ debug global.
// Verify the 6-second truce in a real browser: sample the disposition clock and
// prove no damage is dealt before it lifts.
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";
const server = Deno.serve({ hostname: "127.0.0.1", port: 8798, onListen() {} }, (r) => serveAsset(r));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.goto("http://127.0.0.1:8798/", { waitUntil: "networkidle" });
await p.waitForTimeout(400);
await p.click('[data-action="start"]'); await p.waitForTimeout(250);
await p.click('[data-action="begin"]');
const snap = () => p.evaluate(() => { const s = (globalThis as any).__MYTHERRANIA__.snapshot(); return { t: s.truce, hp: [Math.round(s.player.hp), Math.round(s.opponent.hp)], ids: s.identities.map((i: any) => i.id + " " + i.full) }; });
for (const wait of [500, 1200, 1500, 2500, 1500]) {
  await p.waitForTimeout(wait);
  const s = await snap();
  console.log(`t=${s.t.sinceStart.toFixed(1)}s`, s.t.disposition.padEnd(8), "canAttack=" + s.t.canAttack, "remaining=" + s.t.remaining, "hp=" + s.hp.join("/"));
}
console.log("identities:", (await snap()).ids.join(" | "));
await b.close(); server.shutdown();
