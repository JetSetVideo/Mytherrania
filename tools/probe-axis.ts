// deno-lint-ignore-file no-explicit-any -- QA probe: reads the untyped window.__MYTHERRANIA__ debug global.
// Probe: does the axis camera actually become active, and where is it?
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";
const server = Deno.serve({ hostname: "127.0.0.1", port: 8796, onListen() {} }, (r) => serveAsset(r));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.goto("http://127.0.0.1:8796/", { waitUntil: "networkidle" });
await p.waitForTimeout(400);
await p.click('[data-action="start"]'); await p.waitForTimeout(250);
await p.click('[data-action="begin"]'); await p.waitForTimeout(600);
await p.evaluate(() => {
  const m = (globalThis as any).__MYTHERRANIA__;
  m.engine.debugView({ hour: 13, camera: "axis", axis: "x", freeze: true, firstPerson: false });
});
await p.waitForTimeout(500);
for (const ax of ["x", "y", "z"] as const) {
  await p.evaluate((a) => (globalThis as any).__MYTHERRANIA__.engine.debugView({ hour: 13, camera: "axis", axis: a, freeze: true, firstPerson: false }), ax);
  await p.waitForTimeout(350);
  const s = await p.evaluate(() => {
    const snap = (globalThis as any).__MYTHERRANIA__.snapshot();
    return { cam: snap.camera, player: { x: snap.player.x, y: snap.player.y, z: snap.player.z, hp: snap.player.hp, max: snap.player.stats.maxHealth }, arena: snap.arena };
  });
  console.log(ax, JSON.stringify(s));
}
await b.close(); server.shutdown();
