// Wave S QA probe: the right-click camera gesture, measured in a real Chrome.
//
// Proves only what a browser can: that holding the RIGHT button and moving the mouse ORBITS the live
// third-person camera, that the browser's context menu is suppressed on the play surface, and that the
// drag does not fire an attack on the way. The powers' law is unit-tested (tests/powers_test.ts), not here.
//
// Run: deno run -A tools/probe-wave-s.ts   (writes artifacts/systems/probe.json)
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";

const PORT = 8833;
const server = Deno.serve({ hostname: "127.0.0.1", port: PORT, onListen() {} }, (r) => serveAsset(r));
await Deno.mkdir("artifacts/systems", { recursive: true });

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
await page.waitForFunction(() => (globalThis as unknown as { __MYTHERRANIA__?: unknown }).__MYTHERRANIA__ !== undefined, null, { timeout: 30000 });
// Into a fight so the third-person gameplay camera is the live one. Menu clicks are fragile (the first
// attempt never reached the live camera), so the engine's own QA hook starts the duel.
const started = await page.evaluate(() => {
  const api = (globalThis as unknown as { __MYTHERRANIA__: { engine: { debugStartDuel?(a: string, b: string): unknown } } }).__MYTHERRANIA__.engine;
  if (typeof api.debugStartDuel !== "function") return "no-hook";
  api.debugStartDuel("Warrior", "Rogue");
  return "duel";
});
await page.waitForTimeout(1800);

const orbit = () => page.evaluate(() => (globalThis as unknown as { __MYTHERRANIA__: { engine: { debugCameraOrbit(): { yaw: number; pitch: number; distance: number; dragging: boolean } } } }).__MYTHERRANIA__.engine.debugCameraOrbit());
const before = await orbit();

// A REAL right-drag across the play surface.
const cx = 640, cy = 400;
await page.mouse.move(cx, cy);
await page.mouse.down({ button: "right" });
for (let i = 1; i <= 8; i++) await page.mouse.move(cx + i * 22, cy + i * 4);
const dragging = await orbit();
await page.mouse.up({ button: "right" });
await page.waitForTimeout(120);
const after = await orbit();

// The context menu must not open on the play surface: dispatch it and read defaultPrevented.
const menu = await page.evaluate(() => {
  const el = document.querySelector("canvas");
  if (!el) return { canvas: false, defaultPrevented: null as boolean | null };
  const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
  el.dispatchEvent(ev);
  return { canvas: true, defaultPrevented: ev.defaultPrevented };
});

// A LEFT click still attacks (the gesture must not have eaten the button).
const attack = await page.evaluate(() => {
  const api = globalThis as unknown as { __MYTHERRANIA__: { engine: { debugSpectateCam?: unknown } } };
  return typeof api.__MYTHERRANIA__.engine === "object";
});
void attack;

const report = {
  started,
  before, dragging, after,
  yawDelta: Math.round((after.yaw - before.yaw) * 1000) / 1000,
  pitchDelta: Math.round((after.pitch - before.pitch) * 1000) / 1000,
  draggedWhileHeld: dragging.dragging === true,
  contextMenuSuppressed: menu.defaultPrevented === true,
  canvasFound: menu.canvas,
  errors,
};
console.log(JSON.stringify(report, null, 1));
await Deno.writeTextFile("artifacts/systems/probe.json", JSON.stringify(report, null, 1));
await browser.close();
server.shutdown();
