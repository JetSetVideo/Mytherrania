// deno-lint-ignore-file no-explicit-any -- QA probe: reads the untyped window.__MYTHERRANIA__ debug global.
// Wave U: audit EVERY screen of the UI at five viewports. For each (screen × viewport): a screenshot,
// and a measured audit of the visible DOM — the component tree (screen > panel > group > control,
// with each control's parent and grandparent), the value controls used (select / range / number /
// stepper), elements overflowing the viewport, clipped text, tap targets under 32 px and text under
// 11 px. Then one contact sheet per screen with all viewports side by side.
//   deno task build && deno run -A tools/probe-ui-all.ts [outDir]
import { chromium, type Page } from "playwright";
import { encodeBase64 } from "@std/encoding/base64";
import { serveAsset } from "./serve.ts";

const OUT = Deno.args[0] ?? "artifacts/qa-ui-all";
await Deno.mkdir(OUT, { recursive: true });
const VIEWPORTS: [string, number, number][] = (Deno.env.get("UI_VPS") ?? "small,phone,phone-land,tablet,laptop,desktop,wide").split(",").map((n) => ({
  small: ["small", 320, 568], phone: ["phone", 390, 844], "phone-land": ["phone-land", 844, 390], tablet: ["tablet", 820, 1180],
  laptop: ["laptop", 1280, 800], desktop: ["desktop", 1920, 1080], wide: ["wide", 2560, 1440],
} as Record<string, [string, number, number]>)[n]).filter(Boolean);
const ONLY = (Deno.env.get("UI_SCREENS") ?? "").split(",").filter(Boolean);
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (r) => serveAsset(r));
const PORT = (server.addr as Deno.NetAddr).port;
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});

/** The measured audit of what is visible now. */
async function audit(page: Page) {
  return await page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const visible = (e: Element) => {
      const r = e.getBoundingClientRect(), s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
    };
    const label = (e: Element) => {
      const h = e as HTMLElement;
      const id = h.id ? `#${h.id}` : "";
      const cls = h.classList.length ? "." + [...h.classList].slice(0, 2).join(".") : "";
      const data = h.dataset?.panel ? `[panel=${h.dataset.panel}]` : h.dataset?.screen ? `[screen=${h.dataset.screen}]` : "";
      return `${e.tagName.toLowerCase()}${id}${cls}${data}`;
    };
    const controls = [...document.querySelectorAll("button, select, input, textarea, [role=slider], [role=spinbutton], .stepper, a[href]")].filter(visible);
    const kinds: Record<string, number> = {};
    const small: string[] = [], tree: string[] = [];
    for (const c of controls) {
      const k = c.tagName === "INPUT" ? `input:${(c as HTMLInputElement).type}` : c.classList.contains("stepper") ? "stepper" : c.tagName.toLowerCase();
      kinds[k] = (kinds[k] ?? 0) + 1;
      const r = c.getBoundingClientRect();
      if ((r.width < 32 || r.height < 32) && c.tagName !== "A" && !(c as HTMLInputElement).type?.match?.(/hidden/)) small.push(`${label(c)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      const p = c.parentElement, g = p?.parentElement;
      tree.push(`${g ? label(g) : "-"} > ${p ? label(p) : "-"} > ${label(c)} "${(c.textContent ?? (c as HTMLInputElement).value ?? "").trim().slice(0, 24)}"`);
    }
    const overflow: string[] = [], clipped: string[] = [], tinyText: string[] = [];
    for (const e of document.querySelectorAll("body *")) {
      if (!visible(e)) continue;
      const r = e.getBoundingClientRect();
      if (r.right > vw + 2 || r.left < -2) overflow.push(`${label(e)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
      const h = e as HTMLElement;
      const s = getComputedStyle(h);
      if (h.childElementCount === 0 && (h.textContent ?? "").trim().length > 1) {
        if (h.scrollWidth > h.clientWidth + 2 && s.overflow !== "visible" && h.clientWidth > 0) clipped.push(`${label(e)} "${h.textContent!.trim().slice(0, 30)}"`);
        if (parseFloat(s.fontSize) < 11) tinyText.push(`${label(e)} ${s.fontSize} "${h.textContent!.trim().slice(0, 20)}"`);
      }
    }
    // Structure: panels and groups of the visible screen.
    const screen = [...document.querySelectorAll(".menu-screen")].find(visible) as HTMLElement | undefined;
    const panels = screen ? [...screen.querySelectorAll("[data-panel], .ui-panel, section, details")].filter(visible).map(label) : [];
    // Wave W: how much of the window the visible screen (or dialog) uses.
    const box = (document.querySelector("#settings-dialog:not([hidden])") as HTMLElement | null) ?? screen ?? null;
    const br = box?.getBoundingClientRect();
    const widthUse = br ? +(br.width / vw).toFixed(3) : null;
    // Wave W: the hierarchy by depth — the median font size per level (0 screen title, 1 panel head,
    // 2 group head, 3 control text, 4 hint), and whether it falls monotonically.
    const LEVELS: [number, string][] = [
      [0, ".menu-screen.active h2, .menu-screen.active .menu-title, #settings-dialog:not([hidden]) h2, .settings-title"],
      [1, ".menu-screen.active .panel-head, #settings-dialog:not([hidden]) .settings-section h3, #settings-dialog:not([hidden]) .settings-section-title, .menu-screen.active .profiles-title"],
      [2, ".menu-screen.active .opt-head .opt-label, .menu-screen.active .sheet-col-head, .menu-screen.active .hero-tab strong, .menu-screen.active .group-head"],
      [3, ".menu-screen.active .menu-btn .btn-label, .menu-screen.active .sheet-row-label, .menu-screen.active .stepper-text, #settings-dialog:not([hidden]) .settings-row > span:first-child, .menu-screen.active .field"],
      [4, ".menu-screen.active .opt-hint, .menu-screen.active .panel-hint, .menu-screen.active .screen-hint, .menu-screen.active .btn-note, .menu-screen.active .sheet-meta, .menu-screen.active small"],
    ];
    const levelPx: Record<number, number | null> = {};
    for (const [lv, sel] of LEVELS) {
      const sizes = [...document.querySelectorAll(sel)].filter(visible).map((e) => parseFloat(getComputedStyle(e).fontSize)).sort((a, b) => a - b);
      levelPx[lv] = sizes.length ? sizes[sizes.length >> 1] : null;
    }
    const seq = [0, 1, 2, 3, 4].map((l) => levelPx[l]).filter((v): v is number => v !== null);
    const monotone = seq.every((v, i) => i === 0 || v <= seq[i - 1] + 0.01);
    // Visible text volume (characters) inside the screen/dialog.
    const textChars = box ? (box.innerText ?? "").replace(/\s+/g, " ").length : 0;
    // Icons next to text: icon height / the label's font size, and the vertical centre offset.
    const iconFit: number[] = [], iconOff: number[] = [];
    for (const ic of [...document.querySelectorAll(".menu-screen.active svg.icon, #settings-dialog:not([hidden]) svg.icon")].filter(visible)) {
      const host = ic.parentElement!; const fs = parseFloat(getComputedStyle(host).fontSize);
      const ir = ic.getBoundingClientRect(); const lab = [...host.childNodes].find((n) => n !== ic && (n.textContent ?? "").trim().length > 0) as Element | Text | undefined;
      if (!lab) continue;
      const range = document.createRange(); range.selectNodeContents(lab); const lr = range.getBoundingClientRect();
      if (lr.height === 0) continue;
      iconFit.push(+(ir.height / fs).toFixed(2)); iconOff.push(+Math.abs((ir.top + ir.height / 2) - (lr.top + lr.height / 2)).toFixed(1));
    }
    const docH = document.documentElement.scrollHeight, scrollers = [...document.querySelectorAll("*")].filter((e) => {
      const s = getComputedStyle(e); return visible(e) && /(auto|scroll)/.test(s.overflowY) && (e as HTMLElement).scrollHeight > (e as HTMLElement).clientHeight + 4;
    }).map((e) => `${label(e)} ${(e as HTMLElement).scrollHeight}/${(e as HTMLElement).clientHeight}`);
    return {
      viewport: [vw, vh], screen: screen?.dataset.screen ?? null, controls: controls.length, kinds,
      smallTargets: small.length, smallSample: small.slice(0, 12), overflow: overflow.slice(0, 12), overflowN: overflow.length,
      clipped: clipped.slice(0, 12), clippedN: clipped.length, tinyText: tinyText.slice(0, 12), tinyTextN: tinyText.length,
      panels: panels.slice(0, 30), scrollers: scrollers.slice(0, 8), docHeight: docH, tree: tree.slice(0, 80),
      widthUse, levelPx, monotone, textChars, iconFit, iconOffMax: iconOff.length ? Math.max(...iconOff) : null,
    };
  });
}

type Shot = { screen: string; vp: string; file: string; audit: any };
const shots: Shot[] = [];
const errors: string[] = [];

async function capture(page: Page, screen: string, vp: string) {
  await page.waitForTimeout(500);
  const file = `${OUT}/${screen}-${vp}.png`;
  await page.screenshot({ path: file });
  const a = await audit(page);
  shots.push({ screen, vp, file, audit: a });
  const lv = [0, 1, 2, 3, 4].map((l) => a.levelPx[l] ?? "-").join("/");
  console.log(`${screen.padEnd(11)} ${vp.padEnd(10)} width ${a.widthUse ?? "-"} levels ${lv} ${a.monotone ? "mono" : "NOT-MONO"} text ${a.textChars} icon ${a.iconFit.length ? Math.min(...a.iconFit) + "-" + Math.max(...a.iconFit) : "-"} off ${a.iconOffMax ?? "-"} | small ${a.smallTargets} overflow ${a.overflowN} clipped ${a.clippedN} tiny ${a.tinyTextN}`);
}

const want = (s: string) => ONLY.length === 0 || ONLY.includes(s);
const call = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (globalThis as any).__MYTHERRANIA__.engine[f as string](...(a as unknown[])), [fn, args] as const);

for (const [vp, w, h] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => errors.push(`${vp}: ${String(e)}`));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
  await page.waitForTimeout(700);
  if (want("title")) await capture(page, "title", vp);
  if (want("settings")) {
    await page.click('[data-action="settings"]');
    await capture(page, "settings", vp);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  if (want("history")) {
    await page.click('[data-action="digest"]');
    await capture(page, "history", vp);
    await page.click('[data-screen="digest"] [data-action="back"]').catch(() => page.keyboard.press("Escape"));
    await page.waitForTimeout(300);
  }
  await page.click('[data-action="start"]');
  await page.waitForTimeout(900);
  if (want("creator")) {
    await capture(page, "creator", vp);
    // The creator scrolls on small screens: capture its lower half too.
    await page.evaluate(() => { const s = document.querySelector('[data-screen="select"]') as HTMLElement; s?.scrollTo?.(0, s.scrollHeight); (document.scrollingElement as HTMLElement).scrollTo(0, 99999); });
    await capture(page, "creator-end", vp);
  }
  if (want("fight") || want("victory") || want("sheet")) {
    await page.click('[data-action="begin"]').catch(() => {});
    await page.waitForTimeout(1600);
    if (want("fight")) await capture(page, "fight", vp);
    if (want("pause")) { await page.keyboard.press("Escape"); await capture(page, "pause", vp); await page.keyboard.press("Escape"); }
    if (want("victory") || want("sheet")) {
      await call(page, "debugWorld", { pools: { hp: 0 } });
      await page.waitForTimeout(3500);
      if (want("victory")) await capture(page, "victory", vp);
      if (want("sheet")) {
        const ok = await page.click('[data-screen="victory"] [data-action="sheet"]', { timeout: 2000 }).then(() => true).catch(() => false);
        if (ok) await capture(page, "sheet", vp);
      }
    }
  }
  await page.close();
}

// Contact sheets: one per screen, every viewport side by side (scaled to a common height).
const screens = [...new Set(shots.map((s) => s.screen))];
const sheetPage = await browser.newPage({ viewport: { width: 2400, height: 700 }, deviceScaleFactor: 1 });
for (const sc of screens) {
  const row = shots.filter((s) => s.screen === sc);
  const imgs = row.map((s) => `<figure><img src="data:image/png;base64,${encodeBase64(Deno.readFileSync(s.file))}"><figcaption>${s.vp} ${s.audit.viewport.join("×")}</figcaption></figure>`).join("");
  await sheetPage.setContent(`<style>body{margin:0;background:#111;color:#ddd;font:13px sans-serif;display:flex;gap:8px;align-items:flex-start;padding:6px}figure{margin:0}img{height:640px;display:block}figcaption{text-align:center}</style>${imgs}`);
  await sheetPage.screenshot({ path: `${OUT}/sheet-${sc}.png`, fullPage: true });
}
await Deno.writeTextFile(`${OUT}/audit.json`, JSON.stringify({ errors, shots: shots.map((s) => ({ screen: s.screen, vp: s.vp, file: s.file, ...s.audit })) }, null, 1));
console.log(`page errors: ${errors.length}${errors.length ? " — " + errors.slice(0, 3).join(" | ") : ""}`);
console.log(`wrote ${shots.length} screenshots, ${screens.length} contact sheets, ${OUT}/audit.json`);
await browser.close();
await server.shutdown();
