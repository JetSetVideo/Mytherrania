// A/B probe for the weapon effect: renders the same pose with the effect forced
// off and forced on, then reports how many pixels actually changed.
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";
const server = Deno.serve({ hostname: "127.0.0.1", port: 8795, onListen() {} }, (r) => serveAsset(r));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const p = await b.newPage({ viewport: { width: 900, height: 600 } });
await p.goto("http://127.0.0.1:8795/", { waitUntil: "load" });
await p.waitForFunction(() => !!(globalThis as Record<string, unknown>).__MYTHERRANIA__);
await p.click('[data-action="start"]'); await p.waitForTimeout(200);
await p.click('[data-action="begin"]'); await p.waitForTimeout(600);
await Deno.mkdir("artifacts/fx-probe", { recursive: true });
for (const [fx, tag] of [[0, "off"], [0.9, "on"]] as const) {
  await p.evaluate((v) => {
    // deno-lint-ignore no-explicit-any
    (globalThis as any).__MYTHERRANIA__.engine.debugView({ hour: 14, camera: "close", freeze: true, skillHold: { index: 1, at: 0.38 }, fxOverride: v });
  }, fx);
  await p.waitForTimeout(200);
  await p.screenshot({ path: `artifacts/fx-probe/${tag}.png` });
}
await b.close(); await server.shutdown();
console.log("wrote artifacts/fx-probe/off.png and on.png");
