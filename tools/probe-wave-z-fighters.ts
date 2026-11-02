// deno-lint-ignore-file no-explicit-any -- QA probe: reads the page DOM and the untyped debug global.
// Wave Z (lane F): the Fighters page — the hero card as a full-bleed picture (portrait cover, LV tier
// badge top-left, name + tags floating on a scrim), "Roll" in purple stone, the panel head gone, the
// stat sheet (C-SHEET) placed in the hero card and the + New column, and the whole page fitting every
// width: 320/390/820/1280/1920/2560 and a landscape phone 844x390. Real Chrome, real clicks/taps.
//
//   BUILD_OUT=dist-fighters deno task build && deno run -A tools/probe-wave-z-fighters.ts
//   env: UI_DIST (default dist-fighters), OUT (default artifacts/qa-wave-z/fighters), VPS (e.g. "320,1280")
//
// Measured per viewport and per mode (hero card / + New): overflow (any visible element past the
// viewport's left/right), clipped text (leaf text wider than its own box with overflow != visible),
// text under 11 px, overlap of the floating name/tags with the LV badge, the plate's aspect and the
// portrait/canvas covering it, the Roll button (label, purple stone, icon/font ratio, padding, size),
// title centring (|content centre − box centre| <= 1 px), text contrast on PIXELS (glyphs + shadows
// hidden, median colour of the box) and the five LV tiers on the plate.
import { chromium, type Page } from "playwright";
import { encodeBase64 } from "@std/encoding/base64";
import { serveAsset } from "./serve.ts";

const DIST = Deno.env.get("UI_DIST") ?? "dist-fighters";
const OUT = Deno.env.get("OUT") ?? "artifacts/qa-wave-z/fighters";
await Deno.mkdir(OUT, { recursive: true });
const ALL: [string, number, number][] = [["320", 320, 568], ["390", 390, 844], ["820", 820, 1180], ["1280", 1280, 800], ["1920", 1920, 1080], ["2560", 2560, 1440], ["844x390", 844, 390]];
const ONLY = (Deno.env.get("VPS") ?? "").split(",").filter(Boolean);
const VIEWPORTS = ALL.filter(([n]) => ONLY.length === 0 || ONLY.includes(n));
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (r) => serveAsset(r, DIST));
const PORT = (server.addr as Deno.NetAddr).port;
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});

const TITLE_SELECTORS = [
  ".menu-screen.active .screen-head h2", ".menu-screen.active .panel-head", ".menu-screen.active .sheet-col-head",
  ".menu-screen.active .group-head", ".menu-screen.active .zs-group-title", ".menu-screen.active .equip-picker-title",
];

/** In-page: |content-bbox centre − box centre| per visible title (template: tools/probe-wave-y-ui.ts). */
const measureTitles = (sels: string[]) => {
  const vis = (e: Element) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const rows: { sel: string; text: string; dx: number; dy: number }[] = [];
  for (const sel of sels) {
    for (const t of ([...document.querySelectorAll(sel)] as HTMLElement[]).filter(vis)) {
      const tr = t.getBoundingClientRect();
      let l = Infinity, r = -Infinity, top = Infinity, b = -Infinity;
      const add = (rc: DOMRect) => { if (rc.width <= 0 || rc.height <= 0) return; l = Math.min(l, rc.left); r = Math.max(r, rc.right); top = Math.min(top, rc.top); b = Math.max(b, rc.bottom); };
      const walk = (node: Node) => {
        for (const c of node.childNodes) {
          if (c.nodeType === 3) {
            if (!(c.textContent ?? "").trim()) continue;
            const rg = document.createRange(); rg.selectNodeContents(c);
            for (const rc of rg.getClientRects()) add(rc);
          } else if (c.nodeType === 1) {
            const el = c as HTMLElement;
            if (!vis(el)) continue;
            const s = getComputedStyle(el);
            if (s.position === "absolute" || s.position === "fixed") continue;
            const tag = el.tagName.toLowerCase();
            const painted = s.backgroundImage !== "none" || !/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor) || parseFloat(s.borderTopWidth) > 0;
            if (tag === "svg" || tag === "img" || el.childNodes.length === 0 || painted) add(el.getBoundingClientRect());
            else walk(el);
          }
        }
      };
      walk(t);
      if (!Number.isFinite(l)) continue;
      const s = getComputedStyle(t);
      const bl = parseFloat(s.borderLeftWidth), br = parseFloat(s.borderRightWidth), bt = parseFloat(s.borderTopWidth), bb = parseFloat(s.borderBottomWidth);
      const pl = parseFloat(s.paddingLeft), pr = parseFloat(s.paddingRight), pt = parseFloat(s.paddingTop), pb = parseFloat(s.paddingBottom);
      const cx = tr.left + bl + pl + (tr.width - bl - br - pl - pr) / 2, cy = tr.top + bt + pt + (tr.height - bt - bb - pt - pb) / 2;
      rows.push({ sel, text: (t.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 26), dx: +(((l + r) / 2) - cx).toFixed(2), dy: +(((top + b) / 2) - cy).toFixed(2) });
    }
  }
  const worst = rows.slice().sort((a, b) => Math.max(Math.abs(b.dx), Math.abs(b.dy)) - Math.max(Math.abs(a.dx), Math.abs(a.dy)))[0] ?? null;
  return { n: rows.length, maxDx: Math.max(0, ...rows.map((r) => Math.abs(r.dx))), maxDy: Math.max(0, ...rows.map((r) => Math.abs(r.dy))), within1: rows.filter((r) => Math.abs(r.dx) <= 1 && Math.abs(r.dy) <= 1).length, worst };
};

/** The page audit (same rules as tools/probe-ui-all.ts): overflow, clipped text, text under 11 px, small targets. */
const auditPage = () => {
  const vw = innerWidth;
  const visible = (e: Element) => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };
  const label = (e: Element) => { const h = e as HTMLElement; return `${e.tagName.toLowerCase()}${h.id ? "#" + h.id : ""}${h.classList.length ? "." + [...h.classList].slice(0, 2).join(".") : ""}`; };
  const overflow: string[] = [], clipped: string[] = [], tiny: string[] = [], small: string[] = [];
  for (const e of document.querySelectorAll("body *")) {
    if (!visible(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.right > vw + 2 || r.left < -2) overflow.push(`${label(e)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    const h = e as HTMLElement, s = getComputedStyle(h);
    if (h.childElementCount === 0 && (h.textContent ?? "").trim().length > 1) {
      if (h.scrollWidth > h.clientWidth + 2 && s.overflow !== "visible" && h.clientWidth > 0) clipped.push(`${label(e)} "${h.textContent!.trim().slice(0, 30)}"`);
      if (parseFloat(s.fontSize) < 11) tiny.push(`${label(e)} ${s.fontSize} "${h.textContent!.trim().slice(0, 20)}"`);
    }
  }
  for (const c of document.querySelectorAll(".menu-screen.active button, .menu-screen.active input, .menu-screen.active select")) {
    if (!visible(c)) continue;
    const r = c.getBoundingClientRect();
    if (r.width < 32 || r.height < 32) small.push(`${label(c)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return { overflowN: overflow.length, overflow: overflow.slice(0, 8), clippedN: clipped.length, clipped: clipped.slice(0, 8), tinyN: tiny.length, tiny: tiny.slice(0, 8), smallN: small.length, small: small.slice(0, 8) };
};

/** The plate geometry: aspect, picture coverage, the badge vs the floating name/tags (overlap area must be 0). */
const plateGeometry = (plateSel: string) => {
  const plate = document.querySelector(plateSel) as HTMLElement | null;
  if (!plate || plate.getBoundingClientRect().height === 0) return { present: false };
  const pr = plate.getBoundingClientRect(), ps = getComputedStyle(plate);
  const inner = { l: pr.left + parseFloat(ps.borderLeftWidth), t: pr.top + parseFloat(ps.borderTopWidth), r: pr.right - parseFloat(ps.borderRightWidth), b: pr.bottom - parseFloat(ps.borderBottomWidth) };
  const rect = (sel: string) => { const e = plate.querySelector(sel) as HTMLElement | null; return e ? e.getBoundingClientRect() : null; };
  const pic = rect(".hero-portrait, .preview-canvas");
  const badge = rect(".lv-badge"), name = rect(".hero-name"), tags = rect(".hero-tags"), foot = rect(".hero-plate-foot");
  const overlap = (a: DOMRect | null, b: DOMRect | null) => !a || !b ? 0 : Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const tagEls = [...plate.querySelectorAll<HTMLElement>(".hero-tag")];
  const sockets = [...plate.querySelectorAll<HTMLElement>(".equip-slot")].map((s) => s.getBoundingClientRect());
  const insidePlate = (r: DOMRect | null) => !r || (r.width === 0 && r.height === 0) || (r.left >= inner.l - 0.5 && r.right <= inner.r + 0.5 && r.top >= inner.t - 0.5 && r.bottom <= inner.b + 0.5);
  const img = plate.querySelector("img.hero-portrait") as HTMLImageElement | null;
  return {
    present: true,
    plate: { w: Math.round(pr.width), h: Math.round(pr.height), aspectHW: +(pr.height / pr.width).toFixed(3) },
    picture: pic ? { coversPlate: Math.abs(pic.left - inner.l) <= 1 && Math.abs(pic.top - inner.t) <= 1 && Math.abs(pic.right - inner.r) <= 1 && Math.abs(pic.bottom - inner.b) <= 1, w: Math.round(pic.width), h: Math.round(pic.height) } : null,
    image: img ? { natural: [img.naturalWidth, img.naturalHeight], fit: getComputedStyle(img).objectFit, position: getComputedStyle(img).objectPosition, src: img.src.slice(0, 22) } : null,
    badge: badge ? { x: Math.round(badge.left - inner.l), y: Math.round(badge.top - inner.t), w: Math.round(badge.width), h: Math.round(badge.height), tier: (plate.querySelector(".lv-badge") as HTMLElement).dataset.tier, text: plate.querySelector(".lv-badge")!.textContent } : null,
    badgeTopLeft: !!badge && badge.left - inner.l < pr.width * 0.25 && badge.top - inner.t < pr.height * 0.15,
    overlapBadgeName: Math.round(overlap(badge, name)), overlapBadgeTags: Math.round(overlap(badge, tags)), overlapBadgeFoot: Math.round(overlap(badge, foot)),
    overlapSocketsFoot: Math.round(sockets.reduce((a, s) => a + overlap(s, foot), 0)),
    overlapSocketsBadge: Math.round(sockets.reduce((a, s) => a + overlap(s, badge), 0)),
    nameAndTagsInside: insidePlate(name) && insidePlate(tags) && insidePlate(badge) && insidePlate(rect(".equip-caption")) && insidePlate(rect(".hero-record")),
    // The foot never climbs over the badge: the space left between the badge's bottom and the foot's first text.
    badgeToNamePx: badge && name ? Math.round(name.top - badge.bottom) : null,
    tags: tagEls.map((t) => `${t.dataset.tag}:${t.textContent}`),
    // + New: the armour column hugs the plate's LEFT edge, the weapon/gear column its RIGHT edge (the figure between).
    socketSides: sockets.length ? {
      leftGap: Math.round(Math.max(...[...plate.querySelectorAll(".equip-col-left .equip-slot")].map((s) => s.getBoundingClientRect().left - inner.l))),
      rightGap: Math.round(Math.max(...[...plate.querySelectorAll(".equip-col-right .equip-slot")].map((s) => inner.r - s.getBoundingClientRect().right))),
      middlePx: Math.round(Math.min(...[...plate.querySelectorAll(".equip-col-right .equip-slot")].map((s) => s.getBoundingClientRect().left)) - Math.max(...[...plate.querySelectorAll(".equip-col-left .equip-slot")].map((s) => s.getBoundingClientRect().right))),
    } : null,
    minSocket: sockets.length ? Math.round(Math.min(...sockets.map((s) => Math.min(s.width, s.height)))) : null,
  };
};

/** In-page: the words of `sel`'s text nodes whose glyph rects span two line tops (a mid-word break). */
const midWordBreaks = (sel: string) => {
  const bad: string[] = [];
  for (const el of document.querySelectorAll(sel)) {
    if ((el as HTMLElement).getBoundingClientRect().height === 0) continue;
    for (const tn of el.childNodes) {
      if (tn.nodeType !== 3) continue;
      const text = tn.textContent ?? ""; let i = 0;
      for (const word of text.split(/(\s+)/)) {
        if (word.trim()) {
          const rg = document.createRange(); rg.setStart(tn, i); rg.setEnd(tn, i + word.length);
          const tops = new Set([...rg.getClientRects()].map((r) => Math.round(r.top)));
          if (tops.size > 1) bad.push(word);
        }
        i += word.length;
      }
    }
  }
  return bad;
};

/** The Roll button: label, purple stone, icon size vs the label's font, padding, target size. */
const rollGeometry = () => {
  const b = document.querySelector("[data-hero-reroll]") as HTMLElement | null;
  if (!b) return { present: false };
  const r = b.getBoundingClientRect(), s = getComputedStyle(b);
  const ic = b.querySelector("svg")!.getBoundingClientRect(), lab = b.querySelector("span")!;
  const fs = parseFloat(getComputedStyle(lab).fontSize);
  return {
    present: true, label: (b.textContent ?? "").trim(), action: b.dataset.profileId ? "reroll (data-hero-reroll)" : null,
    w: Math.round(r.width), h: Math.round(r.height), iconPx: +ic.height.toFixed(1), fontPx: fs, iconToFont: +(ic.height / fs).toFixed(2),
    padding: s.padding, purple: /rgb\(109, 82, 148\)|rgb\(77, 56, 108\)/.test(s.backgroundImage), stone: (s.backgroundImage.match(/gradient\(/g) ?? []).length,
  };
};

/** Text contrast against the real pixels behind each element (template: tools/probe-wave-y-ui.ts). */
async function pixelContrast(page: Page, selectors: Record<string, string>, max = 4) {
  const out: Record<string, { n: number; min: number | null; colour?: string; back?: string }> = {};
  for (const [name, sel] of Object.entries(selectors)) {
    const n = await page.evaluate(([s, m]) => {
      const els = ([...document.querySelectorAll(s as string)] as HTMLElement[]).filter((e) => e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== "hidden" && getComputedStyle(e).display !== "none").slice(0, m as number);
      document.querySelectorAll("[data-probe-c]").forEach((e) => e.removeAttribute("data-probe-c"));
      els.forEach((e, i) => e.setAttribute("data-probe-c", String(i)));
      return els.length;
    }, [sel, max] as const);
    let min: number | null = null, colour = "", back = "";
    for (let i = 0; i < n; i++) {
      const s = `[data-probe-c="${i}"]`;
      const info = await page.evaluate((sl) => {
        const e = document.querySelector(sl) as HTMLElement;
        e.scrollIntoView({ block: "center" });
        const r = e.getBoundingClientRect();
        const colour = getComputedStyle(e).color;
        (e as any).__c = e.style.color; e.style.color = "transparent"; e.style.textShadow = "none";
        e.querySelectorAll<HTMLElement>("*").forEach((k) => { (k as any).__c = k.style.color; k.style.color = "transparent"; k.style.textShadow = "none"; });
        return { x: r.left, y: r.top, w: r.width, h: r.height, colour, vw: innerWidth, vh: innerHeight };
      }, s);
      const restore = () => page.evaluate((sl) => {
        const e = document.querySelector(sl) as HTMLElement;
        e.style.color = (e as any).__c ?? ""; e.style.textShadow = "";
        e.querySelectorAll<HTMLElement>("*").forEach((k) => { k.style.color = (k as any).__c ?? ""; k.style.textShadow = ""; });
      }, s);
      if (info.w < 2 || info.h < 2 || info.y < 0 || info.y + info.h > info.vh) { await restore(); continue; }
      const png = await page.screenshot({ clip: { x: Math.max(0, info.x), y: info.y, width: Math.min(info.w, info.vw - Math.max(0, info.x)), height: info.h } });
      await restore();
      const res = await page.evaluate(async ([data, col]) => {
        const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
        const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
        const g = cv.getContext("2d")!; g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, cv.width, cv.height).data;
        const lin = (x: number) => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
        const lums: [number, number][] = [];
        for (let k = 0; k < d.length; k += 4) lums.push([0.2126 * lin(d[k]) + 0.7152 * lin(d[k + 1]) + 0.0722 * lin(d[k + 2]), k]);
        lums.sort((a, b) => a[0] - b[0]);
        const [lb, kb] = lums[lums.length >> 1];
        const m = /([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(col)!;
        const lt = 0.2126 * lin(+m[1]) + 0.7152 * lin(+m[2]) + 0.0722 * lin(+m[3]);
        return { ratio: (Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05), back: `rgb(${d[kb]}, ${d[kb + 1]}, ${d[kb + 2]})` };
      }, [encodeBase64(new Uint8Array(png)), info.colour] as const);
      if (min === null || res.ratio < min) { min = +res.ratio.toFixed(2); colour = info.colour; back = res.back; }
    }
    out[name] = { n, min, colour, back };
  }
  return out;
}

const errors: string[] = [];
const report: any = { dist: DIST, generated: new Date().toISOString(), viewports: {} };

for (const [vp, w, h] of VIEWPORTS) {
  const touch = w <= 820;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: w <= 390 });
  const page = await ctx.newPage();
  const r: any = {};
  page.on("pageerror", (e) => errors.push(`${vp}: ${String(e)}`));
  // A CSP violation names its element (the browser's own console line does not).
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP ${e.violatedDirective}: ${(e.target as Element)?.outerHTML?.slice(0, 120) ?? "?"}`)));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Applying inline style violates")) errors.push(`${vp} [${r.step ?? "load"}] console: ${m.text()}`); });
  const press = async (sel: string) => { r.step = sel; const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); await (touch ? l.tap() : l.click()); };
  report.viewports[vp] = r;
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
  await page.waitForTimeout(500);

  // Title -> Fighters; then two more heroes from the generator (+ New -> dice -> Save as profile), so
  // the tab strip holds three heroes and "+ New".
  await press('[data-action="start"]');
  await page.waitForTimeout(700);
  for (let k = 0; k < 2; k++) {
    await press('[data-hero-tab="new"]');
    await page.waitForTimeout(300);
    await press('.ui-panel-preview [data-action="dice"]');
    await page.waitForTimeout(300);
    await press('[data-action="save-profile"]');
    await page.waitForTimeout(700);
  }
  await press("#hero-tabs .hero-tab:not(.hero-tab-new)");
  await page.waitForTimeout(900);
  await page.evaluate(() => { const s = document.querySelector('[data-screen="select"]') as HTMLElement; s.scrollTop = 0; scrollTo(0, 0); });

  // ── Hero card ──────────────────────────────────────────────────────────────────────────────
  r.hero = {
    mode: await page.evaluate(() => (document.querySelector('[data-screen="select"]') as HTMLElement).dataset.mode),
    tabs: await page.evaluate(() => document.querySelectorAll("#hero-tabs .hero-tab").length),
    // Text wraps only between words: a word whose glyph rects span two line tops = a mid-word break
    // (tab names, the floating name and tags, the stat labels).
    tabMidWordBreaks: await page.evaluate(midWordBreaks, "#hero-tabs .hero-tab strong"),
    textMidWordBreaks: await page.evaluate(midWordBreaks, ".hero-card .hero-name, .hero-card .hero-tag span, .hero-sheet .zs-label, .hero-sheet .zs-value, .hero-actionbar span"),
    tabBadges: await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("#hero-tabs .lv-badge")].map((b) => `${b.textContent}:${b.dataset.tier}`)),
    panelHead: await page.evaluate(() => ({
      rosterHead: !!document.querySelector(".ui-panel-roster > .panel-head"),
      chosenHeroText: [...document.querySelectorAll(".menu-screen.active *")].some((e) => e.childElementCount === 0 && /Chosen hero|Figure, record, statistics/.test(e.textContent ?? "") && (e as HTMLElement).offsetParent !== null),
    })),
    rerollLabelGone: await page.evaluate(() => !/Reroll hero/.test(document.querySelector(".menu-screen.active")!.textContent ?? "")),
    plate: await page.evaluate(plateGeometry, ".hero-card .hero-plate"),
    roll: await page.evaluate(rollGeometry),
    sheet: await page.evaluate(() => ({
      groups: [...document.querySelectorAll(".hero-sheet .zs-group")].map((g) => (g as HTMLElement).dataset.group),
      rows: document.querySelectorAll(".hero-sheet .zs-row").length,
      // paintTones colours each (+/-) through CSSOM (style.color); anything else inline would be a CSP leak.
      inlineStyle: [...document.querySelectorAll<HTMLElement>(".hero-sheet [style]")].filter((e) => e.style.length > 0 && [...e.style].some((k) => k !== "color")).length,
      toned: [...document.querySelectorAll<HTMLElement>(".hero-sheet .zs-delta")].filter((d) => d.style.color !== "").length,
      sample: [...document.querySelectorAll(".hero-sheet .zs-row")].slice(0, 3).map((x) => x.textContent),
    })),
    audit: await page.evaluate(auditPage),
    titles: await page.evaluate(measureTitles, TITLE_SELECTORS),
  };
  await page.screenshot({ path: `${OUT}/hero-${vp}.png` });
  await page.locator(".hero-card").screenshot({ path: `${OUT}/hero-card-${vp}.png` });
  await page.locator(".menu-screen.active").screenshot({ path: `${OUT}/hero-full-${vp}.png` }).catch(() => {});
  r.hero.contrast = await pixelContrast(page, {
    "hero name": ".hero-card .hero-name", "tags": ".hero-card .hero-tag", "record": ".hero-card .hero-record",
    "LV number": ".hero-card .lv-num", "LV label": ".hero-card .lv-label", "Roll": "[data-hero-reroll] .hero-roll-label",
    "action bar": ".hero-actionbar .profile-action:not(.hero-roll)", "sheet title": ".hero-sheet .zs-group-title",
    "sheet label": ".hero-sheet .zs-label", "sheet value": ".hero-sheet .zs-value", "sheet delta": ".hero-sheet .zs-delta",
    "tab name": "#hero-tabs .hero-tab strong", "tab LV": "#hero-tabs .lv-num",
  }, 6);
  // The five metals on the plate itself (a specimen row of badges in the badge's own corner).
  r.hero.tiers = await page.evaluate(() => {
    const corner = document.querySelector(".hero-card .hero-plate-corner") as HTMLElement;
    const keep = corner.innerHTML.replace(/ style="[^"]*"/g, "");
    (corner as any).__keep = keep;
    corner.classList.add("probe-tiers");
    corner.style.flexDirection = "column"; corner.style.gap = "4px"; corner.style.alignItems = "flex-start";
    corner.innerHTML = [1, 5, 9, 13, 17].map((n) => keep.replace(/data-tier="[a-z]+"/, `data-tier="${["bronze", "copper", "silver", "gold", "platinum"][(n - 1) / 4]}"`).replace(/>\d+<\/span><\/span>$/, `>${n}</span></span>`)).join("");
    return [...corner.querySelectorAll<HTMLElement>(".lv-badge")].map((b) => b.dataset.tier);
  });
  await page.locator(".hero-card .hero-plate").screenshot({ path: `${OUT}/tiers-${vp}.png` });
  const tierC: Record<string, any> = {};
  for (const [i, t] of ["bronze", "copper", "silver", "gold", "platinum"].entries()) {
    const c = await pixelContrast(page, { num: `.hero-card .hero-plate-corner .lv-badge:nth-child(${i + 1}) .lv-num`, label: `.hero-card .hero-plate-corner .lv-badge:nth-child(${i + 1}) .lv-label` }, 1);
    tierC[t] = { num: c.num.min, label: c.label.min, rim: await page.evaluate((k) => getComputedStyle(document.querySelector(`.hero-card .hero-plate-corner .lv-badge:nth-child(${k})`)!).backgroundImage.split("gradient(").length - 1, i + 1) };
  }
  r.hero.tierContrast = tierC;
  await page.evaluate(() => { const c = document.querySelector(".hero-card .hero-plate-corner") as HTMLElement; c.innerHTML = (c as any).__keep; c.removeAttribute("style"); });

  // Roll -> Undo (one click each; the action id is still "reroll").
  const name0 = await page.evaluate(() => document.querySelector(".hero-card .hero-name")?.textContent);
  await press("[data-hero-reroll]");
  await page.waitForTimeout(800);
  const name1 = await page.evaluate(() => document.querySelector(".hero-card .hero-name")?.textContent);
  const undo = await page.evaluate(() => !!document.querySelector("[data-hero-undo]"));
  r.hero.afterRoll = { plate: await page.evaluate(plateGeometry, ".hero-card .hero-plate"), audit: await page.evaluate(auditPage) };
  await page.locator(".hero-card").screenshot({ path: `${OUT}/hero-rolled-${vp}.png` });
  if (undo) { await press("[data-hero-undo]"); await page.waitForTimeout(800); }
  const name2 = await page.evaluate(() => document.querySelector(".hero-card .hero-name")?.textContent);
  r.hero.rollUndo = { before: name0, afterRoll: name1, changed: name0 !== name1, undoOffered: undo, afterUndo: name2, restored: name2 === name0 };

  // ── + New (the generator) ─────────────────────────────────────────────────────────────────
  await press('[data-hero-tab="new"]');
  await page.waitForTimeout(1200);
  await page.evaluate(() => { const s = document.querySelector('[data-screen="select"]') as HTMLElement; s.scrollTop = 0; scrollTo(0, 0); });
  r.creator = {
    plate: await page.evaluate(plateGeometry, ".stage-plate"),
    sheet: await page.evaluate(() => ({
      groups: [...document.querySelectorAll("#creator-sheet .zs-group")].map((g) => (g as HTMLElement).dataset.group),
      rows: document.querySelectorAll("#creator-sheet .zs-row").length,
      inlineStyle: [...document.querySelectorAll<HTMLElement>("#creator-sheet [style]")].filter((e) => e.style.length > 0 && [...e.style].some((k) => k !== "color")).length,
      toned: [...document.querySelectorAll<HTMLElement>("#creator-sheet .zs-delta")].filter((d) => d.style.color !== "").length,
    })),
    textMidWordBreaks: await page.evaluate(midWordBreaks, ".stage-plate .hero-name, .stage-plate .hero-tag span, #creator-sheet .zs-label, #creator-sheet .zs-value, .equip-slot-name"),
    // With the plate scrolled to the window's top: the share of points on the canvas's lower half (the
    // feet + plinth band, inside the free middle between the socket columns) that are not covered by
    // anything (elementFromPoint hits the canvas or the floating foot, which is pointer-events:none, i.e. the canvas).
    feetBandVisible: await page.evaluate(() => {
      const plate = document.querySelector(".stage-plate") as HTMLElement;
      plate.scrollIntoView({ block: "start" });
      const c = document.querySelector("#creator-preview") as HTMLElement, cr = c.getBoundingClientRect();
      const L = Math.max(...[...plate.querySelectorAll(".equip-col-left .equip-slot")].map((s) => s.getBoundingClientRect().right));
      const R = Math.min(...[...plate.querySelectorAll(".equip-col-right .equip-slot")].map((s) => s.getBoundingClientRect().left));
      let ok = 0, n = 0; const hits: Record<string, number> = {};
      for (let fy = 0.55; fy <= 0.8; fy += 0.05) for (let fx = 0.1; fx <= 0.9; fx += 0.2) {
        const x = L + (R - L) * fx, y = cr.top + cr.height * fy; n++;
        if (y < 0 || y >= innerHeight) { hits["off-window"] = (hits["off-window"] ?? 0) + 1; continue; }
        const e = document.elementFromPoint(x, y) as HTMLElement | null;
        const k = e ? (e.id ? "#" + e.id : e.tagName.toLowerCase() + "." + (e.classList[0] ?? "")) : "none";
        hits[k] = (hits[k] ?? 0) + 1;
        if (e === c) ok++;
      }
      return { visible: ok, of: n, hits };
    }),
    plateFitsWindow: await page.evaluate(() => { const r = document.querySelector(".stage-plate")!.getBoundingClientRect(); return { h: Math.round(r.height), vh: innerHeight, fits: r.height <= innerHeight }; }),
    canvasDrawn: await page.evaluate(() => { const c = document.querySelector("#creator-preview") as HTMLCanvasElement; return { css: [Math.round(c.clientWidth), Math.round(c.clientHeight)], buffer: [c.width, c.height] }; }),
    audit: await page.evaluate(auditPage),
  };
  await page.locator(".preview-stage").screenshot({ path: `${OUT}/stage-${vp}.png` });
  await page.screenshot({ path: `${OUT}/new-${vp}.png` });
  r.creator.contrast = await pixelContrast(page, {
    "name": ".stage-plate .hero-name", "tags": ".stage-plate .hero-tag", "LV number": ".stage-plate .lv-num", "caption": "#equip-caption",
    "socket names": ".stage-plate .equip-slot-name", "sheet label": "#creator-sheet .zs-label", "sheet value": "#creator-sheet .zs-value",
  }, 6);
  // Everything open: the generator's groups (the longest page) must still fit.
  await page.evaluate(() => document.querySelectorAll<HTMLDetailsElement>('[data-screen="select"] details.opt-group').forEach((d) => { d.open = true; }));
  await page.waitForTimeout(300);
  r.creator.auditOpen = await page.evaluate(auditPage);
  r.creator.titles = await page.evaluate(measureTitles, TITLE_SELECTORS);
  // A socket's picker over the plate.
  await press('[data-equip-slot="weapon"]');
  await page.waitForTimeout(200);
  r.creator.picker = await page.evaluate(() => {
    const p = document.querySelector("#equip-picker") as HTMLElement, s = document.querySelector(".stage-plate")!.getBoundingClientRect(), pr = p.getBoundingClientRect();
    return { open: !p.hidden, coversPlate: Math.abs(pr.width - s.width) < 8 && Math.abs(pr.height - s.height) < 8, items: p.querySelectorAll("[data-equip-item]").length };
  });
  await page.locator(".preview-stage").screenshot({ path: `${OUT}/picker-${vp}.png` });
  await press("[data-equip-close]");
  await ctx.close();
}

report.errors = errors;
await Deno.writeTextFile(`${OUT}/report.json`, JSON.stringify(report, null, 1));

// The summary table (generated from the report).
const ok = (b: boolean) => b ? "ok" : "FAIL";
const minC = (c: Record<string, { min: number | null }>) => Math.min(...Object.values(c).map((x) => x.min ?? 99));
const lines = ["| vp | mode | overflow | clipped | tiny<11px | inside plate | badge∩name/tags px² | plate h/w | picture covers | Roll (label · h · icon/font · purple) | titles ≤1px | min contrast |", "|---|---|---|---|---|---|---|---|---|---|---|---|"];
for (const [vp, r] of Object.entries(report.viewports) as [string, any][]) {
  const H = r.hero, C = r.creator;
  lines.push(`| ${vp} | hero | ${H.audit.overflowN} | ${H.audit.clippedN} | ${H.audit.tinyN} | ${H.plate.nameAndTagsInside} | ${H.plate.overlapBadgeName}/${H.plate.overlapBadgeTags} | ${H.plate.plate?.aspectHW} | ${H.plate.picture?.coversPlate} | ${H.roll.label} · ${H.roll.h} · ${H.roll.iconToFont} · ${H.roll.purple} | ${H.titles.within1}/${H.titles.n} | ${minC(H.contrast).toFixed(2)} |`);
  lines.push(`| ${vp} | + New | ${C.audit.overflowN}/${C.auditOpen.overflowN} | ${C.audit.clippedN}/${C.auditOpen.clippedN} | ${C.audit.tinyN}/${C.auditOpen.tinyN} | ${C.plate.nameAndTagsInside} | ${C.plate.overlapBadgeName}/${C.plate.overlapBadgeTags} | ${C.plate.plate?.aspectHW} | ${C.plate.picture?.coversPlate} | — | ${C.titles.within1}/${C.titles.n} | ${minC(C.contrast).toFixed(2)} |`);
}
const table = lines.join("\n");
await Deno.writeTextFile(`${OUT}/summary.md`, table + "\n");
console.log(table);
for (const [vp, r] of Object.entries(report.viewports) as [string, any][]) {
  console.log(`${vp} tiers ${JSON.stringify(r.hero.tierContrast)}`);
  console.log(`${vp} hero ${ok(!r.hero.panelHead.rosterHead && !r.hero.panelHead.chosenHeroText)} head-gone · roll/undo ${JSON.stringify(r.hero.rollUndo)} · sheet ${r.hero.sheet.groups.length} groups ${r.hero.sheet.rows} rows toned ${r.hero.sheet.toned} inline-style ${r.hero.sheet.inlineStyle} · tabs ${r.hero.tabs} ${JSON.stringify(r.hero.tabBadges)} mid-word breaks ${JSON.stringify(r.hero.tabMidWordBreaks)} ${JSON.stringify(r.hero.textMidWordBreaks)}`);
  console.log(`${vp} new plate fits window ${JSON.stringify(r.creator.plateFitsWindow)} feet band visible ${JSON.stringify(r.creator.feetBandVisible)} mid-word ${JSON.stringify(r.creator.textMidWordBreaks)} · sheet ${r.creator.sheet.groups.length} groups ${r.creator.sheet.rows} rows · canvas ${JSON.stringify(r.creator.canvasDrawn)} · picker ${JSON.stringify(r.creator.picker)} · sockets>=${r.creator.plate.minSocket} sides ${JSON.stringify(r.creator.plate.socketSides)} sockets∩foot ${r.creator.plate.overlapSocketsFoot} sockets∩badge ${r.creator.plate.overlapSocketsBadge}`);
  for (const [k, a] of [["hero", r.hero.audit], ["new", r.creator.audit], ["new-open", r.creator.auditOpen]] as const) {
    if (a.overflowN || a.clippedN || a.tinyN) console.log(`${vp} ${k} audit ${JSON.stringify({ o: a.overflow, c: a.clipped, t: a.tiny })}`);
  }
}
console.log(`page errors: ${errors.length}${errors.length ? " — " + errors.slice(0, 4).join(" | ") : ""}`);
console.log(`report: ${OUT}/report.json · ${OUT}/summary.md`);
await browser.close();
await server.shutdown();
