// deno-lint-ignore-file no-explicit-any -- QA probe: reads the page DOM and the untyped debug globals.
// Wave GEN (lane U): the Creator's generator UI in real Chrome — the STAGE SCRUBBER (seven stages, each drawn
// in the viewer, each with its ms + metrics), DRAG HANDLES (a horizontal drag on a stepper value scrubs it,
// mouse on desktop widths, a real touch drag on phone/tablet widths, clamped by Constraints.ts's
// neighbour-dependent rules), and the 0..1000 STAT VIEW (a what-if rebuilds the model; latency measured).
//
//   BUILD_OUT=dist-ui deno task build && deno run -A tools/probe-wave-gen-ui.ts
//   env: UI_DIST (default dist-ui), OUT (default artifacts/qa-wave-gen/ui), VPS (e.g. "390,1280")
//
// Click path (every viewport): title -> Fighters (start) -> "+ New" tab -> the stage buttons under the viewer
// (1 Skeleton ... 7 Paint); the "Override by hand" fields (Race group) -> drag a value well sideways; the
// "Generator stats" rows beside the viewer -> drag Strength -> the model rebuilds -> Reset.
import { chromium } from "playwright";
import { bandFor, bodyState, raceBmi, BMI_BAND } from "../src/ui/Constraints.ts";
import { GEN_STAGE_IDS } from "../src/ui/GenStages.ts";
import { serveAsset } from "./serve.ts";

const DIST = Deno.env.get("UI_DIST") ?? "dist-ui";
const OUT = Deno.env.get("OUT") ?? "artifacts/qa-wave-gen/ui";
await Deno.mkdir(OUT, { recursive: true });
const ALL: [string, number, number][] = [["320", 320, 568], ["390", 390, 844], ["820", 820, 1180], ["1280", 1280, 800], ["1920", 1920, 1080], ["2560", 2560, 1440]];
const ONLY = (Deno.env.get("VPS") ?? "").split(",").filter(Boolean);
const VIEWPORTS = ALL.filter(([n]) => ONLY.length === 0 || ONLY.includes(n));

const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (r) => serveAsset(r, DIST));
const PORT = (server.addr as Deno.NetAddr).port;
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});

/** In-page: a hash of the WebGL canvas drawn right after a render (no preserveDrawingBuffer needed). */
const canvasHash = () => {
  const pv = (globalThis as any).__MYTHERRANIA_PREVIEW__;
  const c = document.getElementById("creator-preview") as HTMLCanvasElement;
  pv.render(0);
  const o = document.createElement("canvas");
  o.width = c.width; o.height = c.height;
  const g = o.getContext("2d")!;
  g.drawImage(c, 0, 0);
  const d = g.getImageData(0, 0, o.width, o.height).data;
  let h = 2166136261 >>> 0, lit = 0;
  for (let i = 0; i < d.length; i += 16) { h = Math.imul(h ^ d[i], 16777619) >>> 0; h = Math.imul(h ^ d[i + 1], 16777619) >>> 0; h = Math.imul(h ^ d[i + 2], 16777619) >>> 0; if (d[i + 3] > 0) lit++; }
  return { hash: h.toString(16), lit, w: o.width, h: o.height };
};

/** The page audit (tools/probe-ui-all.ts rules): overflow past the viewport, clipped text, text < 11 px. */
const auditPage = () => {
  const vw = innerWidth;
  const visible = (e: Element) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05; };
  const label = (e: Element) => { const h = e as HTMLElement; return `${e.tagName.toLowerCase()}${h.id ? "#" + h.id : ""}${h.classList.length ? "." + [...h.classList].slice(0, 2).join(".") : ""}`; };
  const overflow: string[] = [], clipped: string[] = [], tiny: string[] = [];
  for (const e of document.querySelectorAll("body *")) {
    if (!visible(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.right > vw + 2 || r.left < -2) overflow.push(`${label(e)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    const h = e as HTMLElement, s = getComputedStyle(h);
    if (h.childElementCount === 0 && (h.textContent ?? "").trim().length > 1) {
      if (h.scrollWidth > h.clientWidth + 2 && s.overflow !== "visible" && h.clientWidth > 0) clipped.push(`${label(e)} "${h.textContent!.trim().slice(0, 30)}"`);
      if (parseFloat(s.fontSize) < 11) tiny.push(`${label(e)} ${s.fontSize}`);
    }
  }
  // The generator's own widgets: every child inside its container (nothing cut by an ancestor).
  const inside: string[] = [];
  for (const sel of [".gen-stage-seg", ".gen-stage-readout", ".gen-stats"]) {
    for (const box of document.querySelectorAll(sel)) {
      if (!visible(box)) continue;
      const br = box.getBoundingClientRect();
      for (const c of box.querySelectorAll("*")) {
        if (!visible(c)) continue;
        const r = c.getBoundingClientRect();
        if (r.left < br.left - 1 || r.right > br.right + 1 || r.top < br.top - 1 || r.bottom > br.bottom + 1) inside.push(`${label(c)} outside ${sel}`);
      }
    }
  }
  const btns = [...document.querySelectorAll<HTMLElement>(".gen-stage-btn")].filter(visible).map((b) => b.getBoundingClientRect());
  return {
    overflowN: overflow.length, overflow: overflow.slice(0, 6), clippedN: clipped.length, clipped: clipped.slice(0, 6), tinyN: tiny.length, tiny: tiny.slice(0, 6),
    outsideN: inside.length, outside: inside.slice(0, 6),
    stageButtons: btns.length, stageRows: new Set(btns.map((b) => Math.round(b.top))).size, minButton: btns.length ? Math.round(Math.min(...btns.map((b) => Math.min(b.width, b.height)))) : 0,
    segWidth: Math.round(document.querySelector(".gen-stage-seg")?.getBoundingClientRect().width ?? 0),
  };
};

const report: any = { dist: DIST, generated: new Date().toISOString(), viewports: {} };
const errors: string[] = [];

for (const [vp, w, h] of VIEWPORTS) {
  const touch = w <= 820;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: w <= 390 });
  const page = await ctx.newPage();
  const r: any = { touch };
  report.viewports[vp] = r;
  page.on("pageerror", (e) => errors.push(`${vp}: ${String(e)}`));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP ${e.violatedDirective}: ${(e.target as Element)?.outerHTML?.slice(0, 120) ?? "?"}`)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${vp} [${r.step ?? "load"}] console: ${m.text()}`); });
  const press = async (sel: string) => { r.step = sel; const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); await (touch ? l.tap() : l.click()); };
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  await press('[data-action="start"]');
  await page.waitForTimeout(600);
  if (await page.locator('[data-hero-tab="new"]').count()) { await press('[data-hero-tab="new"]'); await page.waitForTimeout(900); }
  await page.waitForFunction(() => !!(globalThis as any).__MYTHERRANIA_PREVIEW__?.builtKey, null, { timeout: 20000 });

  // ── 1. the stage scrubber: click each stage, wait for its view, hash the canvas, read the readout ─────────
  const stages: any[] = [];
  for (const id of GEN_STAGE_IDS) {
    const t0 = Date.now();
    await press(`.gen-stage-btn[data-gen-stage="${id}"]`);
    await page.waitForFunction((s) => {
      const c = document.getElementById("creator-preview") as HTMLCanvasElement;
      const ro = document.getElementById("gen-stage-readout") as HTMLElement;
      if (s === "paint") return c.dataset.genStageShown === "paint" && ro.dataset.stage === "paint";
      return c.dataset.genStageShown === s && c.dataset.genStageState === "ready" && ro.dataset.stage === s && ro.dataset.state === "ready";
    }, id, { timeout: 30000 });
    const wallMs = Date.now() - t0;
    const hash = await page.evaluate(canvasHash);
    const info = await page.evaluate(() => (globalThis as any).__MYTHERRANIA_PREVIEW__.debugGenStage());
    const readout = await page.evaluate(() => {
      const ro = document.getElementById("gen-stage-readout")!;
      return {
        title: ro.querySelector(".gen-readout-title")?.textContent ?? null, ms: ro.querySelector(".gen-readout-ms")?.textContent ?? null,
        metrics: [...ro.querySelectorAll(".gen-metric")].map((m) => `${m.querySelector("dt")?.textContent}=${m.querySelector("dd")?.textContent}`),
        checked: document.querySelector('.gen-stage-btn[aria-checked="true"]')?.getAttribute("data-gen-stage"),
      };
    });
    stages.push({ id, wallMs, hash: hash.hash, lit: hash.lit, objects: info.objects, stagedMs: info.stagedMs, viewMs: info.viewMs, readout });
    await page.locator(".preview-stage").screenshot({ path: `${OUT}/stage-${id}-${vp}.png` });
  }
  r.stages = stages;
  r.stageHashesDistinct = new Set(stages.map((s) => s.hash)).size;
  r.everyStageMetrics = stages.every((s) => s.readout.ms && s.readout.metrics.length > 0);
  // Keyboard: arrows move the radio choice.
  await page.locator('.gen-stage-btn[data-gen-stage="paint"]').focus();
  await page.keyboard.press("ArrowLeft");
  r.keyboardStage = await page.evaluate(() => document.querySelector('.gen-stage-btn[aria-checked="true"]')?.getAttribute("data-gen-stage"));
  await press('.gen-stage-btn[data-gen-stage="paint"]');
  await page.waitForTimeout(200);

  // ── 2. drag handles on the override fields (open the Race group that holds them) ────────────────────────
  await page.evaluate(() => { const f = document.getElementById("override-fields"); const d = f?.closest("details"); if (d) d.open = true; });
  await page.waitForTimeout(200);
  const cdp = touch ? await ctx.newCDPSession(page) : null;
  const drag = async (inputId: string, dx: number) => {
    const well = page.locator(`[data-stepper-for="${inputId}"] .stepper-value`).first();
    await well.scrollIntoViewIfNeeded();
    const b = (await well.boundingBox())!;
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    const before = await page.evaluate((id) => (document.getElementById(id) as HTMLInputElement).value, inputId);
    const n = 14;
    if (cdp) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let i = 1; i <= n; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (dx * i) / n, y: y + (i % 2) }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await page.mouse.move(x, y); await page.mouse.down();
      for (let i = 1; i <= n; i++) await page.mouse.move(x + (dx * i) / n, y);
      await page.mouse.up();
    }
    await page.waitForTimeout(120);
    const after = await page.evaluate((id) => { const e = document.getElementById(id) as HTMLInputElement; return { value: e.value, min: e.min, max: e.max }; }, inputId);
    const m = await page.evaluate(() => { const mn = (globalThis as any).__MYTHERRANIA_MENU__; return { edit: mn.lastBodyEdit, scrub: mn.scrubLog.at(-1) ?? null }; });
    return { input: inputId, dx, before: Number(before), after: Number(after.value), min: Number(after.min), max: Number(after.max), changed: Number(before) !== Number(after.value), within: Number(after.value) >= Number(after.min) - 1e-9 && Number(after.value) <= Number(after.max) + 1e-9, edit: m.edit, scrub: m.scrub };
  };
  const body = () => page.evaluate(() => { const mn = (globalThis as any).__MYTHERRANIA_MENU__; const p = (globalThis as any).__MYTHERRANIA_PREVIEW__.profile; return { race: p.race, subrace: p.subrace, sex: p.appearance.sex ?? null, height: p.appearance.height, weight: p.appearance.weight, silhouette: p.appearance.silhouette ?? null, menuStage: mn.genStage }; });
  const drags: any[] = [];
  const hash0 = await page.evaluate(canvasHash);
  const rebuilds0 = await page.evaluate(() => Number((document.getElementById("creator-preview") as HTMLElement).dataset.previewRebuilds ?? 0));
  drags.push(await drag("creator-height", 90));
  await page.waitForTimeout(250);
  const hash1 = await page.evaluate(canvasHash);
  r.dragChangesModel = hash0.hash !== hash1.hash;
  r.dragRebuilds = (await page.evaluate(() => Number((document.getElementById("creator-preview") as HTMLElement).dataset.previewRebuilds ?? 0))) - rebuilds0;
  // Weight hard left: must stop at the BMI band of the CURRENT height (a neighbour-dependent limit).
  drags.push(await drag("creator-weight", -600));
  const b1 = await body();
  const st1 = bodyState({ ...b1, silhouette: b1.silhouette });
  const bmi = b1.weight / (b1.height * b1.height), bmiLo = BMI_BAND[0] * raceBmi(b1.race, b1.subrace);
  r.weightAtBmi = { height: b1.height, weight: b1.weight, bmi: +bmi.toFixed(3), bmiMin: +bmiLo.toFixed(3), atOrAbove: bmi >= bmiLo - 1e-6, band: bandFor(st1, "weight"), clampedBy: drags.at(-1).edit?.clampedBy ?? null };
  // Height hard right: the weight SETTLES into the taller body's BMI band.
  drags.push(await drag("creator-height", 600));
  const b2 = await body();
  r.heightSettlesWeight = { height: b2.height, weight: b2.weight, settled: drags.at(-1).edit?.settled ?? [], bmi: +(b2.weight / (b2.height * b2.height)).toFixed(3), bmiMin: +(BMI_BAND[0] * raceBmi(b2.race, b2.subrace)).toFixed(3) };
  // Hips hard left then waist hard left (a pinch-free waist): the waist may not be wider than the hips.
  drags.push(await drag("creator-sil-hip", -600));
  drags.push(await drag("creator-sil-waist", -600));
  const b3 = await body();
  const st3 = bodyState({ ...b3, silhouette: b3.silhouette });
  r.waistHips = { silhouette: { hip: b3.silhouette?.hip, waist: b3.silhouette?.waist }, waistBand: bandFor(st3, "waist"), lastEdit: drags.at(-1).edit };
  // Keyboard still works on a stepper (focus the height stepper, ArrowLeft).
  const hb = await page.evaluate(() => (document.getElementById("creator-height") as HTMLInputElement).value);
  await page.locator('[data-stepper-for="creator-height"]').first().focus();
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(80);
  r.keyboardStep = { before: Number(hb), after: Number(await page.evaluate(() => (document.getElementById("creator-height") as HTMLInputElement).value)) };
  r.drags = drags;
  r.dragsAllWithin = drags.every((d) => d.within);
  r.dragsChanged = drags.filter((d) => d.changed).length;
  await page.locator("#override-fields").screenshot({ path: `${OUT}/drag-${vp}.png` }).catch(() => {});

  // ── 3. the 0..1000 stat view: drag Strength -> preview-only rebuild (latency), Reset ────────────────────────
  const s0 = await page.evaluate(canvasHash);
  const reb0 = await page.evaluate(() => (globalThis as any).__MYTHERRANIA_PREVIEW__.debugGenStage().rebuild);
  const tS = Date.now();
  const sd = await drag("gen-stat-strength", 60);
  await page.waitForFunction((n) => (globalThis as any).__MYTHERRANIA_PREVIEW__.debugGenStage().rebuild.rebuilds > n, reb0.rebuilds, { timeout: 15000 });
  const wallToRebuilt = Date.now() - tS;
  const s1 = await page.evaluate(canvasHash);
  const g1 = await page.evaluate(() => ({ dbg: (globalThis as any).__MYTHERRANIA_PREVIEW__.debugGenStage(), menu: (globalThis as any).__MYTHERRANIA_MENU__.genStats, attr: (document.getElementById("creator-preview") as HTMLElement).dataset.genStats, fill: (document.querySelector('[data-gen-fill="strength"]') as HTMLElement).style.width, reset: !(document.querySelector("[data-gen-stats-reset]") as HTMLElement).hidden }));
  // Five what-if rebuilds via the stepper's next arrow: PreviewScene's own build+draw time each.
  const lat: number[] = [];
  for (let i = 0; i < 5; i++) {
    const n0 = await page.evaluate(() => (globalThis as any).__MYTHERRANIA_PREVIEW__.debugGenStage().rebuild.rebuilds);
    await press('[data-stepper-for="gen-stat-strength"] .stepper-next');
    await page.waitForFunction((n) => (globalThis as any).__MYTHERRANIA_PREVIEW__.debugGenStage().rebuild.rebuilds > n, n0, { timeout: 15000 });
    lat.push(await page.evaluate(() => (globalThis as any).__MYTHERRANIA_PREVIEW__.debugGenStage().rebuild.lastMs));
  }
  await press("[data-gen-stats-reset]");
  await page.waitForTimeout(300);
  const s2 = await page.evaluate(canvasHash);
  const g2 = await page.evaluate(() => ({ attr: (document.getElementById("creator-preview") as HTMLElement).dataset.genStats, menu: (globalThis as any).__MYTHERRANIA_MENU__.genStats }));
  const sortedLat = lat.slice().sort((a, b) => a - b);
  r.statView = {
    drag: sd, base: g1.menu.base, whatIf: g1.menu.whatIf, specStats: g1.dbg.stats, canvasAttr: g1.attr, strengthFill: g1.fill, resetShown: g1.reset,
    modelChanged: s0.hash !== s1.hash, wallMsToRebuilt: wallToRebuilt, rebuildMs: lat.map((x) => +x.toFixed(1)), rebuildMedianMs: +sortedLat[2].toFixed(1), rebuildMaxMs: +sortedLat[4].toFixed(1),
    resetRestores: s2.hash === s0.hash, afterReset: { attr: g2.attr, whatIf: g2.menu.whatIf },
  };
  await page.locator(".preview-stats").screenshot({ path: `${OUT}/stats-${vp}.png` }).catch(() => {});

  // ── 4. fit: the page audit with the generator open ─────────────────────────────────────────────────────
  await page.evaluate(() => { const s = document.querySelector('[data-screen="select"]') as HTMLElement; s.scrollTop = 0; scrollTo(0, 0); });
  r.audit = await page.evaluate(auditPage);
  await page.screenshot({ path: `${OUT}/creator-${vp}.png`, fullPage: false });
  await page.locator(".menu-screen.active").screenshot({ path: `${OUT}/creator-full-${vp}.png` }).catch(() => {});
  await ctx.close();
  console.log(`${vp}: stages distinct ${r.stageHashesDistinct}/7 metrics ${r.everyStageMetrics} kb ${r.keyboardStage} | drags changed ${r.dragsChanged}/${drags.length} within ${r.dragsAllWithin} model ${r.dragChangesModel} | bmi ${JSON.stringify(r.weightAtBmi.atOrAbove)} settle ${JSON.stringify(r.heightSettlesWeight.settled)} | stat model ${r.statView.modelChanged} reset ${r.statView.resetRestores} rebuild median ${r.statView.rebuildMedianMs} ms | audit ovf ${r.audit.overflowN} clip ${r.audit.clippedN} tiny ${r.audit.tinyN} outside ${r.audit.outsideN} rows ${r.audit.stageRows} btn ${r.audit.minButton}`);
}

report.errors = errors;
report.pageErrors = errors.length;
await Deno.writeTextFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(`page errors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log("  " + e);
await browser.close();
await server.shutdown();
