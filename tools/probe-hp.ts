// deno-lint-ignore-file no-explicit-any -- QA probe: reads the untyped window.__MYTHERRANIA__ debug global.
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";
const server = Deno.serve({ hostname: "127.0.0.1", port: 8797, onListen() {} }, (r) => serveAsset(r));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.goto("http://127.0.0.1:8797/", { waitUntil: "networkidle" });
await p.waitForTimeout(400);
await p.click('[data-action="start"]'); await p.waitForTimeout(250);
await p.click('[data-action="begin"]'); await p.waitForTimeout(700);
const out = await p.evaluate(() => {
  const snap = (globalThis as any).__MYTHERRANIA__.snapshot();
  return { player: snap.player, camera: snap.camera, hpText: document.querySelector("#hud")?.textContent?.slice(0, 160) };
});
console.log(JSON.stringify(out, null, 1));
await b.close(); server.shutdown();
