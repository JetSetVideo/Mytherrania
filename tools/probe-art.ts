// Verifies the generated skill artwork actually renders: reports the data-URL
// length per skill icon and captures the HUD skill bar.
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";
const server = Deno.serve({ hostname: "127.0.0.1", port: 8796, onListen() {} }, (r) => serveAsset(r));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.goto("http://127.0.0.1:8796/", { waitUntil: "load" });
await p.waitForFunction(() => !!(globalThis as Record<string, unknown>).__MYTHERRANIA__);
await p.click('[data-action="start"]'); await p.waitForTimeout(200);
await p.click('[data-action="begin"]'); await p.waitForTimeout(700);
await p.evaluate(() => {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).__MYTHERRANIA__.engine.debugView({ hour: 14, camera: "third", orbit: { yaw: 0.6, pitch: 0.25, dist: 3.6 } });
});
await p.waitForTimeout(300);
const info = await p.evaluate(() => {
  const imgs = [...document.querySelectorAll<HTMLImageElement>(".skill-art")];
  return {
    count: imgs.length,
    lengths: imgs.map((i) => i.src.length),
    loaded: imgs.map((i) => i.complete && i.naturalWidth > 0),
    names: [...document.querySelectorAll(".skill-chip")].map((c) => c.textContent?.replace(/\s+/g, " ").trim()),
  };
});
console.log(JSON.stringify(info, null, 2));
await Deno.mkdir("artifacts/qa-skills", { recursive: true });
await p.screenshot({ path: "artifacts/qa-skills/hud-skill-art.png", clip: { x: 0, y: 0, width: 420, height: 230 } });
await b.close(); await server.shutdown();
