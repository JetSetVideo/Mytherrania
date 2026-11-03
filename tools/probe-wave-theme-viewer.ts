// deno-lint-ignore-file no-explicit-any -- QA probe: reads the page DOM and the untyped debug globals.
// Wave THEME lane V: the Creator viewer's interactions in real Chrome — hover cursor, mouse drag rotate, wheel and
// Mac-pinch (ctrl+wheel) zoom toward the cursor (the model point under the cursor must stay within 2 px), the page
// NOT scrolling while zooming over the model but scrolling elsewhere, double-click reset, touch one-finger rotate and
// two-finger pinch (CDP Input.dispatchTouchEvent), and the axis gizmo (top-right, X red / Y yellow / Z green, each
// end click snaps the view). 0 page errors.
//
//   BUILD_OUT=dist-viewer deno task build && deno run -A tools/probe-wave-theme-viewer.ts
//   env: VIEWER_DIST (default dist-viewer), OUT (default artifacts/qa-wave-theme/viewer), VPS (e.g. "390,1280";
//   default all: 320, 390 and 844x390 as touch phones, 1280 and 1920 with a mouse)
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";

const DIST = Deno.env.get("VIEWER_DIST") ?? "dist-viewer";
const OUT = Deno.env.get("OUT") ?? "artifacts/qa-wave-theme/viewer";
await Deno.mkdir(OUT, { recursive: true });
const ALL: [string, number, number, boolean][] = [["320", 320, 568, true], ["390", 390, 844, true], ["844x390", 844, 390, true], ["1280", 1280, 800, false], ["1920", 1920, 1080, false]];
const ONLY = (Deno.env.get("VPS") ?? "").split(",").filter(Boolean);
const VIEWPORTS = ALL.filter(([n]) => ONLY.length === 0 || ONLY.includes(n));
const TOL_PX = 2;

const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (r) => serveAsset(r, DIST));
const PORT = (server.addr as Deno.NetAddr).port;
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});

const report: any = { tolerancePx: TOL_PX, viewports: {} };
const errors: string[] = [];
const failures: string[] = [];
const check = (vp: string, ok: boolean, what: string) => { if (!ok) failures.push(`${vp}: ${what}`); return ok; };
const r3 = (v: number) => Math.round(v * 1000) / 1000;

for (const [vp, w, h, touch] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const R: any = { touch };
  report.viewports[vp] = R;
  page.on("pageerror", (e) => errors.push(`${vp}: ${String(e)}`));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP ${e.violatedDirective}`)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${vp} console: ${m.text()}`); });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  const press = async (sel: string) => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); await (touch ? l.tap() : l.click()); };
  await press('[data-action="start"]');
  await page.waitForTimeout(600);
  if (await page.locator('[data-hero-tab="new"]').count()) { await press('[data-hero-tab="new"]'); await page.waitForTimeout(900); }
  await page.waitForFunction(() => !!(globalThis as any).__MYTHERRANIA_PREVIEW__?.builtKey && !!(globalThis as any).__MYTHERRANIA_PREVIEW__.debugGizmo?.(), null, { timeout: 20000 });
  await page.locator("#creator-preview").scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  // In-page helpers: the scroll position of the window AND of the canvas's scrolling ancestor.
  await page.evaluate(() => {
    const g = globalThis as any;
    g.__vq = {
      pv: () => g.__MYTHERRANIA_PREVIEW__,
      scroller: () => { let e: HTMLElement | null = document.getElementById("creator-preview"); while (e && e !== document.body) { const s = getComputedStyle(e); if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 2) return e; e = e.parentElement; } return null; },
      scroll: () => { const s = g.__vq.scroller(); return { win: Math.round(scrollY), box: s ? Math.round(s.scrollTop) : 0, boxSel: s ? `${s.tagName}.${[...s.classList].join(".")}` : "window" }; },
      // A point over the model: scan the canvas for a pick hit closest to the canvas centre that the canvas itself receives.
      modelPoint: () => {
        const c = document.getElementById("creator-preview")!, r = c.getBoundingClientRect(), pv = g.__MYTHERRANIA_PREVIEW__;
        let best: any = null;
        for (let iy = 2; iy < 30; iy++) for (let ix = 2; ix < 18; ix++) {
          const x = r.left + (ix / 20) * r.width, y = r.top + (iy / 32) * r.height;
          if (y < 0 || y > innerHeight || document.elementFromPoint(x, y) !== c) continue;
          const hit = pv.debugPick(x, y); if (!hit) continue;
          const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height * 0.42));
          if (!best || d < best.d) best = { x, y, hit, d };
        }
        return best;
      },
      offModelPoint: () => {
        const c = document.getElementById("creator-preview")!, r = c.getBoundingClientRect(), pv = g.__MYTHERRANIA_PREVIEW__;
        for (let iy = 4; iy < 28; iy++) for (const fx of [0.5, 0.42, 0.58, 0.35, 0.65, 0.3, 0.7]) {
          const x = r.left + fx * r.width, y = r.top + (iy / 32) * r.height;
          if (y < 0 || y > innerHeight || document.elementFromPoint(x, y) !== c) continue;
          if (!pv.debugPick(x, y)) return { x, y };
        }
        return null;
      },
    };
  });
  const view = () => page.evaluate(() => (globalThis as any).__vq.pv().debugView());
  const wheel = async (x: number, y: number, deltaY: number, ctrl: boolean) => {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY, modifiers: ctrl ? 2 : 0 });
  };
  const reset = async () => { await page.evaluate(() => (globalThis as any).__vq.pv().resetView()); await page.waitForTimeout(60); };

  // ── 1. hover cursor ────────────────────────────────────────────────────────────────────────────────────────
  const mp = await page.evaluate(() => (globalThis as any).__vq.modelPoint());
  const off = await page.evaluate(() => (globalThis as any).__vq.offModelPoint());
  R.modelPoint = mp && { x: Math.round(mp.x), y: Math.round(mp.y), hit: mp.hit.map(r3) };
  R.offModelPoint = off && { x: Math.round(off.x), y: Math.round(off.y) };
  check(vp, !!mp && !!off, "found a model point and an off-model canvas point");
  if (!touch) {
    await page.mouse.move(off.x, off.y); await page.waitForTimeout(120);
    const cOff = await page.evaluate(() => ({ s: getComputedStyle(document.getElementById("creator-preview")!).cursor, v: (globalThis as any).__vq.pv().debugView().cursor }));
    await page.mouse.move(mp.x, mp.y, { steps: 3 }); await page.waitForTimeout(150);
    const cOn = await page.evaluate(() => ({ s: getComputedStyle(document.getElementById("creator-preview")!).cursor, v: (globalThis as any).__vq.pv().debugView().cursor }));
    R.hover = { off: cOff, on: cOn };
    check(vp, cOn.s === "grab" && cOff.s !== "grab", `hover cursor grab over the model (${cOn.s}) and not off it (${cOff.s})`);

    // ── 2. mouse drag rotates ────────────────────────────────────────────────────────────────────────────────
    await reset();
    const v0 = await view();
    await page.mouse.move(mp.x, mp.y); await page.mouse.down();
    await page.mouse.move(mp.x + 60, mp.y + 20, { steps: 4 });
    const mid = await page.evaluate(() => getComputedStyle(document.getElementById("creator-preview")!).cursor);
    await page.mouse.move(mp.x + 120, mp.y + 40, { steps: 4 });
    await page.mouse.up();
    const v1 = await view();
    R.drag = { dx: 120, dy: 40, yaw0: r3(v0.yaw), yaw1: r3(v1.yaw), dYaw: r3(v1.yaw - v0.yaw), dPitch: r3(v1.pitch - v0.pitch), expected: { dYaw: 0.72, dPitch: -0.24 }, cursorWhileDragging: mid, drags: v1.stats.drags };
    check(vp, Math.abs(v1.yaw - v0.yaw - 0.72) < 0.02 && Math.abs(v1.pitch - v0.pitch + 0.24) < 0.02, `drag 120,40 px -> dYaw ${r3(v1.yaw - v0.yaw)} dPitch ${r3(v1.pitch - v0.pitch)} (single orbit, engine listener suppressed)`);
    check(vp, mid === "grabbing", `cursor while dragging = grabbing (${mid})`);
    // pitch clamp: a huge vertical drag stops at the band
    await page.mouse.move(mp.x, mp.y); await page.mouse.down(); await page.mouse.move(mp.x, mp.y + 900, { steps: 6 }); await page.mouse.up();
    const vClamp = await view();
    R.pitchClampLow = r3(vClamp.pitch);
    check(vp, vClamp.pitch >= vClamp.limits.pitchMin - 1e-9, `pitch clamped low (${r3(vClamp.pitch)})`);
  }

  // ── 3. wheel / pinch zoom over the model keeps the hit point under the cursor; the page does not scroll ─────────
  const zoomRun = async (ctrl: boolean, delta: number, n: number) => {
    await reset();
    await page.waitForTimeout(300); // past any wheel latch
    const p = await page.evaluate(() => (globalThis as any).__vq.modelPoint());
    const s0 = await page.evaluate(() => (globalThis as any).__vq.scroll());
    const d0 = (await view()).distance;
    const drift: number[] = [];
    for (let i = 0; i < n; i++) {
      const hit = await page.evaluate(([x, y]) => (globalThis as any).__vq.pv().debugPick(x, y), [p.x, p.y]);
      await wheel(p.x, p.y, delta, ctrl);
      await page.waitForTimeout(40);
      if (hit) { const q = await page.evaluate((hh) => (globalThis as any).__vq.pv().debugProject(hh), hit); drift.push(Math.hypot(q[0] - p.x, q[1] - p.y)); }
    }
    await page.waitForTimeout(150);
    const s1 = await page.evaluate(() => (globalThis as any).__vq.scroll());
    const v = await view();
    return { ctrl, delta, steps: n, distance0: r3(d0), distance1: r3(v.distance), maxDriftPx: r3(Math.max(0, ...drift)), drift: drift.map(r3), scroll0: s0, scroll1: s1, wheelZooms: v.stats.wheelZooms, target: v.target.map(r3) };
  };
  R.wheelZoom = await zoomRun(false, -120, 6);
  check(vp, R.wheelZoom.distance1 < R.wheelZoom.distance0 * 0.6, `wheel zoom in ${R.wheelZoom.distance0} -> ${R.wheelZoom.distance1}`);
  check(vp, R.wheelZoom.maxDriftPx <= TOL_PX, `wheel zoom drift ${R.wheelZoom.maxDriftPx} px`);
  check(vp, R.wheelZoom.scroll0.win === R.wheelZoom.scroll1.win && R.wheelZoom.scroll0.box === R.wheelZoom.scroll1.box, `page did not scroll while zooming (${JSON.stringify(R.wheelZoom.scroll0)} -> ${JSON.stringify(R.wheelZoom.scroll1)})`);
  R.pinchZoom = await zoomRun(true, -8, 8);
  check(vp, R.pinchZoom.distance1 < R.pinchZoom.distance0 * 0.7, `ctrl+wheel (Mac pinch) zoom ${R.pinchZoom.distance0} -> ${R.pinchZoom.distance1}`);
  check(vp, R.pinchZoom.maxDriftPx <= TOL_PX, `pinch zoom drift ${R.pinchZoom.maxDriftPx} px`);
  check(vp, R.pinchZoom.scroll0.win === R.pinchZoom.scroll1.win && R.pinchZoom.scroll0.box === R.pinchZoom.scroll1.box, "page did not scroll while pinching");
  // zoom out to the clamp
  await reset(); await page.waitForTimeout(300);
  for (let i = 0; i < 20; i++) { await wheel(mp.x, mp.y, 400, false); await page.waitForTimeout(10); }
  const vOut = await view();
  R.zoomOutClamp = { distance: r3(vOut.distance), max: r3(vOut.limits.distMax) };
  check(vp, Math.abs(vOut.distance - vOut.limits.distMax) < 1e-6, `zoom out stops at distMax (${R.zoomOutClamp.distance} vs ${R.zoomOutClamp.max})`);
  await page.screenshot({ path: `${OUT}/zoom-out-${vp}.png` });

  // ── 4. wheel OFF the model scrolls the page and does not zoom ─────────────────────────────────────────────────────
  await reset(); await page.waitForTimeout(300);
  const offRun = async (pt: { x: number; y: number }, label: string) => {
    await page.evaluate(() => { const s = (globalThis as any).__vq.scroller(); if (s) s.scrollTop = Math.max(0, s.scrollTop - 1) ; });
    await page.waitForTimeout(300);
    const s0 = await page.evaluate(() => (globalThis as any).__vq.scroll());
    const d0 = (await view()).distance;
    await wheel(pt.x, pt.y, 120, false);
    await page.waitForTimeout(350);
    const s1 = await page.evaluate(() => (globalThis as any).__vq.scroll());
    const d1 = (await view()).distance;
    return { label, at: [Math.round(pt.x), Math.round(pt.y)], scroll0: s0, scroll1: s1, scrolled: s1.win !== s0.win || s1.box !== s0.box, distance0: r3(d0), distance1: r3(d1) };
  };
  const offNow = await page.evaluate(() => (globalThis as any).__vq.offModelPoint());
  R.offCanvasWheel = offNow ? await offRun(offNow, "canvas, off the model") : null;
  const pagePt = await page.evaluate(() => { const r = document.getElementById("creator-preview")!.getBoundingClientRect(); const x = Math.min(innerWidth - 4, r.right + 10) > r.right ? r.right + 6 : 4; return { x, y: Math.min(innerHeight - 10, r.top + r.height / 2) }; });
  R.pageWheel = await offRun(pagePt, "page beside the viewer");
  if (R.offCanvasWheel) check(vp, R.offCanvasWheel.scrolled && R.offCanvasWheel.distance0 === R.offCanvasWheel.distance1, `wheel on the canvas off the model scrolls the page (${JSON.stringify(R.offCanvasWheel.scroll0)} -> ${JSON.stringify(R.offCanvasWheel.scroll1)}) and does not zoom`);
  check(vp, R.pageWheel.distance0 === R.pageWheel.distance1, "wheel beside the viewer does not zoom");
  await page.locator("#creator-preview").scrollIntoViewIfNeeded(); await page.waitForTimeout(400);

  // ── 5. double-click resets ────────────────────────────────────────────────────────────────────────────────────
  const mp2 = await page.evaluate(() => (globalThis as any).__vq.modelPoint());
  await wheel(mp2.x, mp2.y, -240, false); await page.waitForTimeout(60);
  await page.evaluate(() => (globalThis as any).__vq.pv().orbit(80, 30));
  const before = await view();
  if (touch) await page.evaluate(([x, y]) => document.getElementById("creator-preview")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: x, clientY: y })), [mp2.x, mp2.y]);
  else await page.mouse.dblclick(mp2.x, mp2.y);
  await page.waitForTimeout(80);
  const after = await view();
  const homeOk = Math.abs(after.yaw - after.home.yaw) < 1e-9 && Math.abs(after.pitch - after.home.pitch) < 1e-9 && Math.abs(after.distance - after.home.distance) < 1e-9 && after.target.every((t: number, i: number) => Math.abs(t - after.home.target[i]) < 1e-9);
  R.dblclick = { before: { yaw: r3(before.yaw), distance: r3(before.distance) }, after: { yaw: r3(after.yaw), pitch: r3(after.pitch), distance: r3(after.distance), target: after.target.map(r3) }, home: homeOk };
  check(vp, homeOk && before.distance !== after.distance, "double-click returns to the home view");
  await page.screenshot({ path: `${OUT}/home-${vp}.png` });

  // ── 6. touch: one-finger rotate, two-finger pinch (CDP) ───────────────────────────────────────────────────────
  if (touch) {
    const tp = await page.evaluate(() => (globalThis as any).__vq.modelPoint());
    const tv0 = await view();
    const s0 = await page.evaluate(() => (globalThis as any).__vq.scroll());
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: tp.x, y: tp.y, id: 1 }] });
    for (let i = 1; i <= 8; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: tp.x + i * 12.5, y: tp.y, id: 1 }] }); await page.waitForTimeout(16); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(120);
    const tv1 = await view();
    const s1 = await page.evaluate(() => (globalThis as any).__vq.scroll());
    R.touchDrag = { dx: 100, dYaw: r3(tv1.yaw - tv0.yaw), expected: 0.6, scroll0: s0, scroll1: s1 };
    check(vp, Math.abs(tv1.yaw - tv0.yaw - 0.6) < 0.03, `one-finger drag 100 px -> dYaw ${R.touchDrag.dYaw}`);
    await reset(); await page.waitForTimeout(200);
    const mid = await page.evaluate(() => (globalThis as any).__vq.modelPoint());
    const hit = await page.evaluate(([x, y]) => (globalThis as any).__vq.pv().debugPick(x, y), [mid.x, mid.y]);
    const pd0 = (await view()).distance;
    const ps0 = await page.evaluate(() => (globalThis as any).__vq.scroll());
    const pts = (s: number) => [{ x: mid.x - s / 2, y: mid.y, id: 1 }, { x: mid.x + s / 2, y: mid.y, id: 2 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(40) });
    for (let s = 50; s <= 140; s += 10) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(s) }); await page.waitForTimeout(16); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(150);
    const pv1 = await view();
    const ps1 = await page.evaluate(() => (globalThis as any).__vq.scroll());
    const q = hit ? await page.evaluate((hh) => (globalThis as any).__vq.pv().debugProject(hh), hit) : null;
    R.touchPinch = { spread: [40, 140], distance0: r3(pd0), distance1: r3(pv1.distance), expectedRatio: r3(40 / 140), ratio: r3(pv1.distance / pd0), driftPx: q ? r3(Math.hypot(q[0] - mid.x, q[1] - mid.y)) : null, pinchSteps: pv1.stats.pinchSteps, scroll0: ps0, scroll1: ps1, yawChange: r3(pv1.yaw - tv1.yaw) };
    check(vp, pv1.distance < pd0 * 0.5, `two-finger pinch zooms in (${R.touchPinch.distance0} -> ${R.touchPinch.distance1})`);
    check(vp, R.touchPinch.driftPx !== null && R.touchPinch.driftPx <= TOL_PX, `pinch midpoint drift ${R.touchPinch.driftPx} px`);
    check(vp, ps0.win === ps1.win && ps0.box === ps1.box, "the page did not scroll during the pinch");
    await page.screenshot({ path: `${OUT}/touch-pinch-${vp}.png` });
  }

  // ── 7. the gizmo: top-right, colours, each end snaps ───────────────────────────────────────────────────────
  // (a sticky header can cover a plate scrolled to the top edge: bring the gizmo to the middle of the screen first)
  await page.locator(".viewer-gizmo").evaluate((e) => e.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  await reset();
  const gz = await page.evaluate(() => {
    const pv = (globalThis as any).__vq.pv(), g = pv.debugGizmo();
    const c = document.getElementById("creator-preview")!.getBoundingClientRect();
    const el = document.querySelector(".viewer-gizmo") as HTMLElement;
    // Overlap: any visible element of the plate (other than the viewer, the gizmo and their ancestors) intersecting the gizmo rect.
    const gr = el.getBoundingClientRect();
    const plate = el.closest(".stage-plate") ?? el.parentElement!;
    const overlaps: string[] = [];
    for (const e of plate.querySelectorAll("*")) {
      if (e === el || e.contains(el) || e.id === "creator-preview") continue;
      const r = e.getBoundingClientRect(), s = getComputedStyle(e);
      if (r.width < 1 || r.height < 1 || s.visibility === "hidden" || s.display === "none" || Number(s.opacity) < 0.05) continue;
      if (r.left < gr.right - 1 && r.right > gr.left + 1 && r.top < gr.bottom - 1 && r.bottom > gr.top + 1) overlaps.push(`${e.tagName.toLowerCase()}.${[...e.classList].join(".")}`);
    }
    let slotOverlapPx2 = 0, slotGapPx = Infinity;
    for (const e of document.querySelectorAll(".equip-slot")) {
      const r = e.getBoundingClientRect();
      if (r.width < 1) continue;
      slotOverlapPx2 += Math.max(0, Math.min(r.right, gr.right) - Math.max(r.left, gr.left)) * Math.max(0, Math.min(r.bottom, gr.bottom) - Math.max(r.top, gr.top));
      const gx = Math.max(0, r.left - gr.right, gr.left - r.right), gy = Math.max(0, r.top - gr.bottom, gr.top - r.bottom);
      slotGapPx = Math.min(slotGapPx, Math.hypot(gx, gy));
    }
    // Every axis end must be the top element at its centre (a sticky nav must not cover it).
    const endsCovered = Object.entries(g.endsById).filter(([, v]: any) => document.elementFromPoint(v.x, v.y) !== el).map(([k, v]: any) => { const t = document.elementFromPoint(v.x, v.y); return `${k}:${t ? t.tagName.toLowerCase() + "." + [...t.classList].join(".") : "none"}`; });
    const topEl = document.elementFromPoint(gr.left + gr.width / 2, gr.top + gr.height / 2);
    return { rect: g.rect, canvas: { left: c.left, top: c.top, right: c.right, bottom: c.bottom }, fromRight: c.right - gr.right, fromTop: gr.top - c.top, colours: Object.fromEntries(Object.entries(g.endsById).map(([k, v]: any) => [k, v.colour])), overlaps, slotOverlapPx2: Math.round(slotOverlapPx2), slotGapPx: Math.round(slotGapPx * 10) / 10, endsCovered, onTop: topEl === el };
  });
  R.gizmo = gz;
  check(vp, gz.fromRight >= 0 && gz.fromRight <= 0.25 * (gz.canvas.right - gz.canvas.left) && gz.fromTop >= 0 && gz.fromTop <= 16, `gizmo in the viewer's top-right (right ${r3(gz.fromRight)}, top ${r3(gz.fromTop)})`);
  check(vp, gz.onTop && gz.endsCovered.length === 0, `the gizmo is the top element at its centre and at every end (${gz.endsCovered.join(", ")})`);
  check(vp, gz.slotGapPx >= 6, `gizmo keeps >= 6 px from every socket (${gz.slotGapPx} px)`);
  check(vp, gz.overlaps.length === 0 && gz.slotOverlapPx2 === 0, `nothing overlaps the gizmo (${gz.overlaps.join(", ")}; slots ${gz.slotOverlapPx2} px²)`);
  await page.locator(".viewer-gizmo").screenshot({ path: `${OUT}/gizmo-home-${vp}.png` });
  const snaps: any = {};
  const EXPECT: Record<string, number[]> = { "+X": [-1, 0, 0], "-X": [1, 0, 0], "+Y": [0, -1, 0], "-Y": [0, 1, 0], "+Z": [0, 0, -1], "-Z": [0, 0, 1] };
  for (const id of ["+X", "-X", "+Y", "-Y", "+Z", "-Z"]) {
    await reset();
    // In the home view every end is distinct; if another end lies in front of this one, turn the view first.
    let end = await page.evaluate((a) => { const g = (globalThis as any).__vq.pv().debugGizmo(); return g.endsById[a]; }, id);
    const front = await page.evaluate((a) => { const g = (globalThis as any).__vq.pv().debugGizmo(); const e = g.endsById[a]; let best: any = null; for (const o of [...g.ends].reverse()) { const d = Math.hypot(o.clientX - e.x, o.clientY - e.y); if (d <= o.r + 3 && (!best || d < best.d - 1e-9)) best = { id: o.id, d }; } return best?.id ?? null; }, id);
    let turned = false;
    if (front !== id) { await page.evaluate(() => (globalThis as any).__vq.pv().orbit(40, -40)); turned = true; end = await page.evaluate((a) => (globalThis as any).__vq.pv().debugGizmo().endsById[a], id); }
    if (touch) await page.touchscreen.tap(end.x, end.y); else await page.mouse.click(end.x, end.y);
    await page.waitForTimeout(80);
    const v = await view();
    const dot = v.dir[0] * EXPECT[id][0] + v.dir[1] * EXPECT[id][1] + v.dir[2] * EXPECT[id][2];
    snaps[id] = { clicked: [Math.round(end.x), Math.round(end.y)], turned, dir: v.dir.map(r3), dot: r3(dot) };
    check(vp, dot > 0.999, `gizmo ${id} snaps the view (dir ${v.dir.map(r3)}, dot ${r3(dot)})`);
    if (id === "+Y" || id === "+X") { await page.screenshot({ path: `${OUT}/snap-${id[1]}-${vp}.png` }); await page.locator(".viewer-gizmo").screenshot({ path: `${OUT}/gizmo-snap${id[1]}-${vp}.png` }); }
  }
  R.snaps = snaps;
  // Scroll so the viewer's top passes under the sticky nav: the gizmo must stay uncovered (it moves below the nav).
  const navCase = await page.evaluate(async () => {
    const c = document.getElementById("creator-preview")!, nav = document.querySelector(".menu-screen.active .screen-nav") as HTMLElement | null;
    const sc = (globalThis as any).__vq.scroller();
    if (!nav || !sc || !/sticky|fixed/.test(getComputedStyle(nav).position)) return null;
    if (c.getBoundingClientRect().height < 200) return null;
    const nb = nav.getBoundingClientRect().bottom;
    sc.scrollTop += c.getBoundingClientRect().top - nb + 30; // canvas top 30 px under the nav's bottom
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 120));
    const g = (globalThis as any).__vq.pv().debugGizmo(), el = document.querySelector(".viewer-gizmo");
    const covered = Object.entries(g.endsById).filter(([, v]: any) => document.elementFromPoint(v.x, v.y) !== el).map(([k]) => k);
    return { navBottom: Math.round(nav.getBoundingClientRect().bottom), canvasTop: Math.round(c.getBoundingClientRect().top), gizmoTop: Math.round(g.rect.top), covered };
  });
  R.stickyNav = navCase;
  if (navCase) check(vp, navCase.covered.length === 0 && navCase.gizmoTop >= navCase.navBottom, `gizmo stays below the sticky nav (${JSON.stringify(navCase)})`);
  // after a +Y snap, an orbit drag moves back toward the band without a jump
  await page.evaluate(() => (globalThis as any).__vq.pv().snapView("+Y"));
  const sy = await view();
  await page.evaluate(() => (globalThis as any).__vq.pv().orbit(0, 10));
  const sy2 = await view();
  R.softClampAfterSnap = { pitch0: r3(sy.pitch), pitchAfterDrag10px: r3(sy2.pitch) };
  check(vp, Math.abs(sy2.pitch - (sy.pitch - 0.06)) < 1e-6, "after a +Y snap a small drag moves 0.06 rad, no jump to the clamp");
  await reset();
  const stats = (await view()).stats;
  R.pickMs = { last: r3(stats.lastPickMs), max: r3(stats.maxPickMs) };
  await page.locator(".stage-plate").first().screenshot({ path: `${OUT}/plate-${vp}.png` });
  await ctx.close();
}

report.pageErrors = errors;
report.failures = failures;
report.ok = failures.length === 0 && errors.length === 0;
await Deno.writeTextFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
await browser.close();
await server.shutdown();
Deno.exit(report.ok ? 0 : 1);
