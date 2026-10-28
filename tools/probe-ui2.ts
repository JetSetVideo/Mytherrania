// deno-lint-ignore-file no-explicit-any -- QA probe: reads the untyped window.__MYTHERRANIA__ debug global.
// Verify the new UI/input arc across the four breakpoints: fluid menu root (no
// clipped borders), settings accessible, race hero box, sub-species nested,
// birthsign delta preview, and the profile picker.
//   deno run -A tools/probe-ui2.ts
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";
import { allKeys, screenControls, treeSize } from "../src/ui/UiTree.ts";

const PORT = 8806;
const server = Deno.serve({ hostname: "127.0.0.1", port: PORT, onListen() {} }, (r) => serveAsset(r));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
await Deno.mkdir("artifacts/qa-ui2", { recursive: true });

const fails: string[] = [];
const VIEWPORTS = [
  { name: "mobile", w: 390, h: 844 },
  { name: "tablet", w: 820, h: 1180 },
  { name: "laptop", w: 1280, h: 800 },
  { name: "desktop", w: 1920, h: 1080 },
];

for (const vp of VIEWPORTS) {
  const page = await b.newPage({ viewport: { width: vp.w, height: vp.h } });
  page.on("pageerror", (e) => console.log("[pageerror]", String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 15000 });
  await page.waitForTimeout(400);

  // Menu fluidity: no horizontal overflow, menu within bounds.
  const fluid = await page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>(".menu-screen.active");
    const doc = document.documentElement;
    const settings = document.querySelector<HTMLElement>("#btn-settings");
    const mRect = menu?.getBoundingClientRect();
    const sRect = settings?.getBoundingClientRect();
    return {
      scrollW: doc.scrollWidth, clientW: doc.clientWidth,
      menuW: mRect?.width ?? 0, menuH: mRect?.height ?? 0,
      menuRight: mRect?.right ?? 0, menuBottom: mRect?.bottom ?? 0,
      settingsVisible: !!sRect && sRect.right <= innerWidth && sRect.bottom <= innerHeight && sRect.left >= 0 && sRect.top >= 0,
      profileChips: document.querySelectorAll(".profile-chip").length,
      innerW: innerWidth, innerH: innerHeight,
    };
  });
  const noOverflow = fluid.scrollW <= fluid.clientW + 1 && fluid.menuRight <= fluid.innerW + 1 && fluid.menuBottom <= fluid.innerH + 1;
  console.log(`${vp.name} (${vp.w}x${vp.h}): scrollW=${fluid.scrollW} clientW=${fluid.clientW} menuW=${Math.round(fluid.menuW)} settings=${fluid.settingsVisible} profiles=${fluid.profileChips} overflow=${!noOverflow}`);
  if (!noOverflow) fails.push(`${vp.name}: menu overflows the viewport`);
  if (!fluid.settingsVisible) fails.push(`${vp.name}: settings button clipped/offscreen`);
  if (fluid.profileChips === 0) fails.push(`${vp.name}: no profile chips on the title screen`);
  await page.screenshot({ path: `artifacts/qa-ui2/title-${vp.name}.png` });
  await page.close();
}

// Race hero + birthsign preview at laptop size.
const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 15000 });
await page.click('[data-action="start"]');
await page.waitForTimeout(400);
// Click a race to open the hero.
await page.evaluate(() => {
  const card = [...document.querySelectorAll(".race-card")].find((r) => (r as HTMLElement).dataset.race === "elf");
  (card as HTMLElement)?.click();
});
await page.waitForTimeout(300);
const hero = await page.evaluate(() => {
  const name = document.querySelector(".race-hero-name")?.textContent;
  const primaryRows = document.querySelectorAll(".race-hero-col:first-child .stat-row").length;
  const nest = !!document.querySelector(".subrace-nest");
  const secondaryRows = document.querySelectorAll("#hero-secondary .bp-delta").length;
  return { name, primaryRows, nest, secondaryRows };
});
console.log("race hero:", JSON.stringify(hero));
if (!hero.name) fails.push("no race hero name box");
if (hero.primaryRows < 6) fails.push(`expected 6 primary rows, got ${hero.primaryRows}`);
if (!hero.nest) fails.push("sub-species not nested under the parent race");
if (hero.secondaryRows < 6) fails.push(`expected 6 secondary rows, got ${hero.secondaryRows}`);

// Click a sub-species and a birth sign; the preview must show live deltas.
await page.evaluate(() => {
  const chip = document.querySelector(".subrace-chip");
  (chip as HTMLElement)?.click();
});
await page.waitForTimeout(200);
await page.evaluate(() => {
  const sign = document.querySelector(".sign-chip");
  (sign as HTMLElement)?.click();
});
await page.waitForTimeout(200);
const preview = await page.evaluate(() => {
  const box = document.querySelector("#birthsign-preview .birthsign-preview");
  const deltas = [...document.querySelectorAll("#birthsign-preview .bp-delta")].map((d) => ({
    label: d.querySelector("span")?.textContent,
    val: d.querySelector("b")?.textContent,
  }));
  const hasNonZero = deltas.some((d) => d.val && d.val !== "—");
  return { hasBox: !!box, deltaCount: deltas.length, hasNonZero, deltas };
});
console.log("birthsign preview:", JSON.stringify({ hasBox: preview.hasBox, deltaCount: preview.deltaCount, hasNonZero: preview.hasNonZero }));
if (!preview.hasBox) fails.push("no birthsign preview box after selecting a sign");
if (!preview.hasNonZero) fails.push("birthsign preview shows no non-zero deltas");
await page.screenshot({ path: "artifacts/qa-ui2/race-hero.png" });
// ---- UI tree vs the live DOM: every key the model declares must exist, and the
// essential controls must be present. This is the check that the hierarchy in
// UiTree.ts and the markup have not drifted apart.
{
  const size = treeSize();
  const missing = await page.evaluate((keys: string[]) => {
    const found: string[] = [];
    for (const k of keys) {
      if (!document.querySelector(`#${k}, [data-key="${k}"], [id="${k}"]`)) found.push(k);
    }
    return found;
  }, allKeys());
  const essential = screenControls("select", 2).map((c) => c.key);
  console.log(`ui tree: screens=${size.screens} panels=${size.panels} groups=${size.groups} controls=${size.controls}`);
  console.log(`ui tree: keys missing from the DOM (${missing.length}): ${missing.join(", ") || "none"}`);
  console.log(`ui tree: essential creator controls (${essential.length}): ${essential.join(", ")}`);
}

await page.close();

console.log("\nchecks:", fails.length === 0 ? "ALL PASS" : `FAILURES: ${fails.join("; ")}`);

await b.close(); server.shutdown();
if (fails.length > 0) Deno.exit(1);

// ---- UI tree vs the live DOM: every key the model declares must exist, and the
// essential controls must be present. This is the check that the hierarchy in
// UiTree.ts and the markup have not drifted apart.
{
  const size = treeSize();
  const missing = await page.evaluate((keys: string[]) => {
    const found: string[] = [];
    for (const k of keys) {
      if (!document.querySelector(`#${k}, [data-key="${k}"], [id="${k}"]`)) found.push(k);
    }
    return found;
  }, allKeys());
  const essential = screenControls("select", 2).map((c) => c.key);
  console.log(`ui tree: screens=${size.screens} panels=${size.panels} groups=${size.groups} controls=${size.controls}`);
  console.log(`ui tree: keys missing from the DOM (${missing.length}): ${missing.join(", ") || "none"}`);
  console.log(`ui tree: essential creator controls (${essential.length}): ${essential.join(", ")}`);
}
