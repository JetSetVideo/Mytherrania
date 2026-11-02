// Portrait background probe (wave W, lane H): is the hero card's figure on a background that fits the
// medieval UI, or on the old cold blue-grey? Real Chrome, real clicks (the wave-V Fighters path):
// start → + New → dice → Save → the hero tab's card. Reads the card's portrait PNG (the PortraitStudio
// data URL) back through a 2D canvas and reports its corner and edge-centre pixels (RGB), and the
// creator preview's corners (a screenshot of the element: the canvas is transparent, so this is what
// the player actually sees there).
//   deno task build && deno run -A tools/probe-portrait.ts [--dist <dir>] [--tag after]
import { chromium } from "playwright";
import { encodeBase64 } from "@std/encoding/base64";
import { serveAsset } from "./serve.ts";

const args = Deno.args;
const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const dist = opt("--dist", "dist"), tag = opt("--tag", "after");
const OUT = `artifacts/wave-w/lane-H/portrait-${tag}`;
await Deno.mkdir(OUT, { recursive: true });
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (r) => serveAsset(r, dist));
const port = (server.addr as Deno.NetAddr).port;
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
/** Pixels of a PNG/data URL at fractional positions, decoded in the page. */
const sample = (src: string) => page.evaluate(async (s) => {
  const img = new Image();
  img.src = s;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0);
  const at = (fx: number, fy: number) => Array.from(g.getImageData(Math.min(c.width - 1, Math.round(fx * (c.width - 1))), Math.min(c.height - 1, Math.round(fy * (c.height - 1))), 1, 1).data.slice(0, 3));
  return { w: c.width, h: c.height, tl: at(0.01, 0.01), tr: at(0.99, 0.01), bl: at(0.01, 0.99), br: at(0.99, 0.99), top: at(0.5, 0.01), left: at(0.01, 0.5) };
}, src);
const report: Record<string, unknown> = { tag, dist };
try {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__MYTHERRANIA__, null, { timeout: 20000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__MYTHERRANIA__, null, { timeout: 20000 });
  await page.click('[data-action="start"]'); await page.waitForTimeout(800);
  await page.click('[data-hero-tab="new"]').catch(() => {}); await page.waitForTimeout(600);
  // The creator preview (transparent canvas over its panel): what the player sees at its corners.
  const prev = await page.$("#creator-preview");
  if (prev) {
    const shot = await prev.screenshot();
    await Deno.writeFile(`${OUT}/creator-preview.png`, shot);
    report.creatorPreview = await sample(`data:image/png;base64,${encodeBase64(shot)}`);
  }
  await page.click('.stage-tools [data-action="dice"]').catch(() => {}); await page.waitForTimeout(600);
  await page.click('[data-action="save-profile"]'); await page.waitForTimeout(1200);
  const src = await page.evaluate(() => (document.querySelector("img.hero-portrait") as HTMLImageElement | null)?.src ?? "");
  if (src.startsWith("data:image/png")) {
    report.heroPortrait = await sample(src);
    await Deno.writeFile(`${OUT}/hero-portrait.png`, Uint8Array.from(atob(src.split(",")[1]), (c) => c.charCodeAt(0)));
  } else report.heroPortrait = "no portrait img on the hero card";
  const card = await page.$(".hero-card");
  if (card) await card.screenshot({ path: `${OUT}/hero-card.png` });
  await page.screenshot({ path: `${OUT}/page.png` });
} finally {
  report.errors = errors;
  await Deno.writeTextFile(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report));
  await browser.close();
  await server.shutdown();
}
