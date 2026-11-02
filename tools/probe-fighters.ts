// deno-lint-ignore-file no-explicit-any -- QA probe.
// Wave V: the Fighters page click path — Fighters (hero tab) → + New (generator) → Save (a new hero
// tab, selected) → another hero tab → back to the title → a hero chip opens that hero's tab.
//   deno task build && deno run -A tools/probe-fighters.ts [outDir]
import { chromium, type Page } from "playwright";
import { serveAsset } from "./serve.ts";

const OUT = Deno.args[0] ?? "artifacts/qa-fighters";
await Deno.mkdir(OUT, { recursive: true });
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (r) => serveAsset(r));
const PORT = (server.addr as Deno.NetAddr).port;
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal"] });
const errors: string[] = [];
const state = (p: Page) => p.evaluate(() => {
  const scr = document.querySelector('[data-screen="select"]') as HTMLElement;
  const tabs = [...document.querySelectorAll("#hero-tabs .hero-tab")].map((t) => `${(t as HTMLElement).dataset.heroTab === "new" ? "+New" : (t.querySelector("strong")?.textContent ?? "?")}${t.classList.contains("is-on") ? "*" : ""}`);
  const vis = (sel: string) => { const e = document.querySelector(sel) as HTMLElement | null; return !!e && e.offsetParent !== null; };
  return {
    active: scr?.classList.contains("active"), mode: scr?.dataset.mode, tabs,
    heroCard: vis(".hero-card"), generator: vis('[data-panel="ancestry"]'), preview: vis(".ui-panel-preview"),
    begin: (document.querySelector('[data-action="begin"] .btn-label') as HTMLElement)?.textContent,
    heroName: document.querySelector(".hero-card .sheet-name")?.textContent ?? null,
  };
});
for (const [vp, w, h] of [["laptop", 1280, 800], ["phone", 390, 844]] as const) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  p.setDefaultTimeout(8000);
  p.on("pageerror", (e) => errors.push(`${vp}: ${e}`));
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await p.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(700);
  await p.click('[data-action="start"]'); await p.waitForTimeout(700);
  console.log(vp, "1 fighters:", JSON.stringify(await state(p))); await p.screenshot({ path: `${OUT}/${vp}-1-hero.png` });
  await p.click('[data-hero-tab="new"]'); await p.waitForTimeout(500);
  console.log(vp, "2 + new:", JSON.stringify(await state(p))); await p.screenshot({ path: `${OUT}/${vp}-2-new.png` });
  await p.click('.stage-tools [data-action="dice"]'); await p.waitForTimeout(600);
  await p.click('[data-action="save-profile"]'); await p.waitForTimeout(800);
  console.log(vp, "3 saved:", JSON.stringify(await state(p))); await p.screenshot({ path: `${OUT}/${vp}-3-saved.png` });
  await p.click('#hero-tabs .hero-tab >> nth=0'); await p.waitForTimeout(600);
  console.log(vp, "4 first tab:", JSON.stringify(await state(p))); await p.screenshot({ path: `${OUT}/${vp}-4-first.png` });
  await p.click('[data-screen="select"] [data-action="back"]'); await p.waitForTimeout(500);
  const chips = await p.evaluate(() => [...document.querySelectorAll(".profile-chip")].map((c) => c.textContent));
  await p.click(".profile-chip >> nth=-1"); await p.waitForTimeout(700);
  console.log(vp, "5 chip", JSON.stringify(chips), "->", JSON.stringify(await state(p))); await p.screenshot({ path: `${OUT}/${vp}-5-chip.png` });
  // 6. Enter the ring on the OTHER hero's tab: the match's player must be that hero.
  await p.click('#hero-tabs .hero-tab:not(.is-on):not(.hero-tab-new) >> nth=0'); await p.waitForTimeout(600);
  const want = await p.evaluate(() => ({ name: document.querySelector(".hero-card .sheet-name")?.textContent ?? "", meta: document.querySelector(".hero-card .sheet-meta")?.textContent ?? "" }));
  await p.click('[data-action="begin"]'); await p.waitForTimeout(1500);
  const got = await p.evaluate(() => { const s = (globalThis as any).__MYTHERRANIA__.snapshot().player; return { race: s?.race ?? "", className: s?.className ?? "" }; });
  const hud = await p.evaluate(() => document.querySelector("#hud-player")?.textContent ?? "");
  const ok = want.meta.toLowerCase().includes(got.race.toLowerCase()) && want.meta.includes(got.className) && hud.includes(want.name);
  console.log(vp, "6 enter the ring as", JSON.stringify(want), "-> match player", JSON.stringify(got), "HUD", JSON.stringify(hud.slice(0, 60)), ok ? "OK" : "MISMATCH");
  await p.close();
}
console.log(`page errors: ${errors.length} ${errors.slice(0, 3).join(" | ")}`);
await browser.close();
await server.shutdown();
