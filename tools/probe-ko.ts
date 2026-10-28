// deno-lint-ignore-file no-explicit-any -- QA probe: reads the untyped window.__MYTHERRANIA__ debug global.
// Verify: only death ends a fight, and ring-outs return the body instead of ending it.
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";
const server = Deno.serve({ hostname: "127.0.0.1", port: 8799, onListen() {} }, (r) => serveAsset(r));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.goto("http://127.0.0.1:8799/", { waitUntil: "networkidle" });
await p.waitForTimeout(400);
await p.click('[data-action="start"]'); await p.waitForTimeout(250);
await p.click('[data-action="begin"]'); await p.waitForTimeout(600);
const snap = () => p.evaluate(() => { const s = (globalThis as any).__MYTHERRANIA__.snapshot(); return s; });
const s0 = await snap();
console.log("winCondition:", s0.winCondition, "| arena:", s0.arena);
// Sample for 20 s: watch for a non-ko end and for ring-outs returning.
let nonKo = 0, ringed = 0, samples = 0;
for (let i = 0; i < 20; i++) {
  await p.waitForTimeout(1000);
  const s = await snap();
  samples++;
  if (s.winner && !(s.endReason === "ko" && s.loserHp <= 0)) nonKo++;
  if (s.player.ringedOut || s.opponent.ringedOut) ringed++;
  if (i % 5 === 4) console.log(`t=${i + 1}s hp=${Math.round(s.player.hp)}/${Math.round(s.opponent.hp)} winner=${s.winner ?? "-"} reason=${s.endReason ?? "-"} ringedOut=${s.player.ringedOut || s.opponent.ringedOut}`);
}
console.log(`samples=${samples} non-ko endings=${nonKo} frames-with-ringout=${ringed}`);
await b.close(); server.shutdown();
