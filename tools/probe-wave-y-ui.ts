// deno-lint-ignore-file no-explicit-any -- QA probe: reads the page DOM and the untyped debug global.
// Wave Y (lane U): the hero reroll + Undo, the level medallion, the hero bar's verbs pushed right,
// titles centred on both axes, the metal/stone token system (and its legibility on pixels), the HUD
// pool-bar look, the nine equipment sockets around the viewer and the weapon icon picker — in real
// Chrome at 390 / 820 / 1280 / 1920, driven by real mouse clicks (taps on the touch viewports).
//
//   BUILD_OUT=dist-ui deno task build && deno run -A tools/probe-wave-y-ui.ts
//   env: UI_DIST (default dist-ui), OUT (default artifacts/qa-wave-y/ui)
import { chromium, type Page } from "playwright";
import { encodeBase64 } from "@std/encoding/base64";
import { serveAsset } from "./serve.ts";

const DIST = Deno.env.get("UI_DIST") ?? "dist-ui";
const OUT = Deno.env.get("OUT") ?? "artifacts/qa-wave-y/ui";
/** MODE=titles: only the title-centring meter (runs against an OLD build for the "before" column). */
const MODE = Deno.env.get("MODE") ?? "full";
const FULL = MODE === "full";
await Deno.mkdir(OUT, { recursive: true });
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (r) => serveAsset(r, DIST));
const PORT = (server.addr as Deno.NetAddr).port;
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});

/** Titles that must sit centred on both axes in their own box. */
const TITLE_SELECTORS = [
  ".menu-screen.active .screen-head h2", ".menu-screen.active > h2", ".menu-screen.active .panel-head",
  ".menu-screen.active .sheet-col-head", ".menu-screen.active .group-head", ".menu-screen.active .skills-head",
  ".menu-screen.active .digest-subhead", ".menu-screen.active .equip-picker-title", "#settings-dialog:not([hidden]) .settings-section h3",
  ".menu-screen.active .steel-sign", ".menu-screen.active .menu-title", "#settings-dialog:not([hidden]) h2", "#settings-dialog:not([hidden]) .settings-title",
];

/** In-page: |content-bbox centre − box centre| per visible title (content = glyph rects + drawn leaves). */
const measureTitles = (sels: string[]) => {
  const vis = (e: Element) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const rows: { sel: string; text: string; dx: number; dy: number }[] = [];
  for (const sel of sels) {
    for (const t of ([...document.querySelectorAll(sel)] as HTMLElement[]).filter(vis)) {
      const tr = t.getBoundingClientRect();
      // The box = the title's own content box (inside its border and padding is where it is centred;
      // the padding is symmetric by construction, so the border box gives the same centre).
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
  return { n: rows.length, maxDx: Math.max(0, ...rows.map((r) => Math.abs(r.dx))), maxDy: Math.max(0, ...rows.map((r) => Math.abs(r.dy))), within1: rows.filter((r) => Math.abs(r.dx) <= 1 && Math.abs(r.dy) <= 1).length, worst, rows };
};

/** Text contrast against the real pixels behind each element (glyphs hidden, box screenshotted, median colour). */
async function pixelContrast(page: Page, selectors: Record<string, string>) {
  const out: Record<string, { n: number; min: number | null; colour?: string; back?: string }> = {};
  for (const [name, sel] of Object.entries(selectors)) {
    const n = await page.evaluate((s) => {
      const els = ([...document.querySelectorAll(s)] as HTMLElement[]).filter((e) => e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== "hidden").slice(0, 4);
      document.querySelectorAll("[data-probe-c]").forEach((e) => e.removeAttribute("data-probe-c"));
      els.forEach((e, i) => e.setAttribute("data-probe-c", String(i)));
      return els.length;
    }, sel);
    let min: number | null = null, colour = "", back = "";
    for (let i = 0; i < n; i++) {
      const s = `[data-probe-c="${i}"]`;
      const info = await page.evaluate((sl) => {
        const e = document.querySelector(sl) as HTMLElement;
        e.scrollIntoView({ block: "center" });
        const r = e.getBoundingClientRect();
        const colour = getComputedStyle(e).color;
        // Hide only the glyphs (the text colour), keep the element's own painted face.
        (e as any).__c = e.style.color; e.style.color = "transparent";
        e.querySelectorAll<HTMLElement>("*").forEach((k) => { (k as any).__c = k.style.color; k.style.color = "transparent"; });
        return { x: r.left, y: r.top, w: r.width, h: r.height, colour, vw: innerWidth, vh: innerHeight, shadow: getComputedStyle(e).textShadow };
      }, s);
      // Text shadows still paint with color transparent? No — a shadow keeps its own colour; hide them too.
      await page.evaluate((sl) => { const e = document.querySelector(sl) as HTMLElement; e.style.textShadow = "none"; e.querySelectorAll<HTMLElement>("*").forEach((k) => { k.style.textShadow = "none"; }); }, s);
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

async function canvasHash(page: Page): Promise<string> {
  const loc = page.locator("#creator-preview");
  await loc.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const png = await loc.screenshot();
  const h = await crypto.subtle.digest("SHA-1", new Uint8Array(png));
  return [...new Uint8Array(h)].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const errors: string[] = [];
const report: any = { dist: DIST, viewports: {} };
const VIEWPORTS: [string, number, number][] = [["390", 390, 844], ["820", 820, 1180], ["1280", 1280, 800], ["1920", 1920, 1080]];

for (const [vp, w, h] of VIEWPORTS) {
  const touch = w <= 820;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: w <= 390 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${vp}: ${String(e)}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${vp} console: ${m.text()}`); });
  // A real pointer: scroll the target into view, then click/tap its centre.
  const press = async (sel: string) => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); await (touch ? l.tap() : l.click()); };
  const r: any = {};
  report.viewports[vp] = r;

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
  await page.waitForTimeout(600);

  // Tokens at this width (computed by the browser from the clamp()/calc() equations).
  r.tokens = await page.evaluate(() => {
    const probe = document.createElement("div"); document.body.appendChild(probe);
    const px = (v: string) => { probe.style.width = `var(${v})`; return +parseFloat(getComputedStyle(probe).width).toFixed(2); };
    const out = { t3: px("--t3"), t4: px("--t4"), frameW: px("--frame-w"), frameWLg: px("--frame-w-lg"), bevel: px("--bevel"), radiusPlate: px("--radius-plate"), socket: px("--socket") };
    probe.remove();
    const cs = getComputedStyle(document.documentElement);
    return { ...out, metals: ["--metal-steel", "--metal-bronze", "--metal-copper", "--stone"].map((k) => [k, cs.getPropertyValue(k).split("gradient(").length - 1]) };
  });
  r.titleScreen = await page.evaluate(measureTitles, TITLE_SELECTORS);

  // ── The Fighters page, hero tab ──────────────────────────────────────────────────────────────
  await press('[data-action="start"]');
  await page.waitForTimeout(700);
  r.titlesHero = await page.evaluate(measureTitles, TITLE_SELECTORS);
  if (FULL) await page.screenshot({ path: `${OUT}/hero-${vp}.png` });
  if (FULL) {
  r.heroBar = await page.evaluate(() => {
    const bar = document.querySelector(".hero-bar") as HTMLElement | null;
    if (!bar) return { present: false };
    const br = bar.getBoundingClientRect(), s = getComputedStyle(bar);
    const inner = br.right - parseFloat(s.borderRightWidth) - parseFloat(s.paddingRight);
    const btn = (sel: string) => bar.querySelector(sel) as HTMLElement | null;
    const verbs = ["[data-hero-reroll]", '[data-profile-action="duplicate"]', '[data-profile-action="rename"]', '[data-profile-action="load"]'].map(btn);
    const rects = verbs.map((v) => v?.getBoundingClientRect() ?? null);
    const rightmost = Math.max(...rects.filter(Boolean).map((x) => x!.right));
    const name = bar.querySelector(".sheet-name")!.getBoundingClientRect();
    const badge = bar.querySelector(".level-badge") as HTMLElement | null;
    const bdr = badge?.getBoundingClientRect();
    const tabBadges = [...document.querySelectorAll("#hero-tabs .hero-tab:not(.hero-tab-new)")].map((t) => !!t.querySelector(".level-badge"));
    return {
      present: true,
      verbsInBar: verbs.map((v) => !!v), deleteOutsideBar: !bar.querySelector('[data-profile-action="delete"]') && !!document.querySelector('.hero-card [data-profile-action="delete"]'),
      rightGapPx: +(inner - rightmost).toFixed(1),
      verbsRightOfName: rects.every((x) => !x || x.left >= name.left),
      badge: badge ? { level: badge.dataset.level, w: Math.round(bdr!.width), h: Math.round(bdr!.height), gapToNamePx: Math.round(name.left - bdr!.right), sameRow: Math.abs((bdr!.top + bdr!.bottom) / 2 - (name.top + name.bottom) / 2) < bdr!.height, round: getComputedStyle(badge).borderRadius } : null,
      tabsWithBadge: tabBadges.filter(Boolean).length, tabs: tabBadges.length,
    };
  });
  // Contrast of the new chrome on its pixels.
  r.contrastHero = await pixelContrast(page, {
    "hero name": ".hero-bar .sheet-name", "hero meta": ".hero-bar .sheet-meta", "bar verbs": ".hero-bar .profile-action",
    "level medallion": ".hero-bar .level-badge-num", "tab medallion": "#hero-tabs .level-badge-num", "screen title": ".menu-screen.active .screen-head h2",
    "panel head": ".menu-screen.active .panel-head", "primary (stone)": '.menu-screen.active [data-action="begin"] .btn-label',
  });

  // 1. The reroll: one click, the hero changes (name in a new phonology, level kept), Undo brings it back.
  const heroState = () => page.evaluate(() => ({
    name: document.querySelector(".hero-bar .sheet-name")?.textContent ?? null,
    meta: document.querySelector(".hero-bar .sheet-meta")?.textContent ?? null,
    level: (document.querySelector(".hero-bar .level-badge") as HTMLElement | null)?.dataset.level ?? null,
    undo: !!document.querySelector("[data-hero-undo]"),
    tab: document.querySelector("#hero-tabs .hero-tab.is-on strong")?.textContent ?? null,
    // What the repo really holds (localStorage), not what the card shows.
    stored: (() => { try { return (JSON.parse(localStorage.getItem("mytherrania-profiles-v1") ?? "[]") as any[]).filter((p: any) => !p.removed).map((p: any) => p.name); } catch { return null; } })(),
  }));
  const h0 = await heroState();
  await press("[data-hero-reroll]");
  await page.waitForTimeout(700);
  const h1 = await heroState();
  await page.screenshot({ path: `${OUT}/hero-rerolled-${vp}.png` });
  let h2: any = null;
  if (h1.undo) { await press("[data-hero-undo]"); await page.waitForTimeout(700); h2 = await heroState(); }
  r.reroll = { before: h0, after: h1, afterUndo: h2, changed: h0.name !== h1.name, levelKept: h0.level === h1.level, undoOffered: h1.undo, undoRestored: h2 ? h2.name === h0.name : null,
    persisted: !!h1.name && JSON.stringify(h1.stored ?? []).includes(JSON.stringify(h1.name)), undoPersisted: !!h2 && JSON.stringify(h2.stored ?? []).includes(JSON.stringify(h0.name)) && !JSON.stringify(h2.stored ?? []).includes(JSON.stringify(h1.name)) };
  }

  // ── The generator: equipment sockets and the weapon picker ────────────────────────────────────
  await press('[data-hero-tab="new"]');
  await page.waitForTimeout(700);
  await page.evaluate(() => document.querySelectorAll<HTMLDetailsElement>('[data-screen="select"] details.opt-group').forEach((d) => { d.open = true; }));
  await page.waitForTimeout(300);
  r.titlesCreator = await page.evaluate(measureTitles, TITLE_SELECTORS);
  if (FULL) {
  r.ring = await page.evaluate(() => {
    const c = document.querySelector("#creator-preview")!.getBoundingClientRect();
    const slots = [...document.querySelectorAll<HTMLElement>("[data-equip-slot]")];
    const left = slots.filter((s) => s.closest(".equip-col-left")), right = slots.filter((s) => s.closest(".equip-col-right"));
    const rs = (l: HTMLElement[]) => l.map((s) => s.getBoundingClientRect());
    return {
      slots: slots.map((s) => s.dataset.equipSlot), leftN: left.length, rightN: right.length,
      leftOfCanvas: rs(left).every((x) => x.right <= c.left + 1), rightOfCanvas: rs(right).every((x) => x.left >= c.right - 1),
      minSlotPx: Math.round(Math.min(...rs(slots).map((x) => Math.min(x.width, x.height)))),
      canvas: { w: Math.round(c.width), h: Math.round(c.height) },
      weaponIcon: document.querySelector('[data-equip-slot="weapon"] svg')?.getAttribute("class") ?? null,
      caption: document.querySelector("#equip-caption")?.textContent ?? null,
    };
  });
  await page.locator(".preview-stage").screenshot({ path: `${OUT}/stage-${vp}.png` });

  // 7. Every armour socket opens its list (3 greyed "coming" pieces each); a greyed piece cannot be chosen.
  const sockets: Record<string, any> = {};
  for (const slot of ["helmet", "armor", "gloves", "belt", "legs", "offhand", "cape", "boots"]) {
    await press(`[data-equip-slot="${slot}"]`);
    await page.waitForTimeout(120);
    sockets[slot] = await page.evaluate(() => {
      const p = document.querySelector("#equip-picker") as HTMLElement;
      const items = [...p.querySelectorAll<HTMLButtonElement>("[data-equip-item]")];
      return { open: !p.hidden, slot: p.dataset.slot, items: items.length, disabled: items.filter((i) => i.disabled).length, title: p.querySelector(".equip-picker-title")?.textContent };
    });
    if (slot === "armor") await page.locator("#equip-picker").screenshot({ path: `${OUT}/picker-armor-${vp}.png` });
    // A forced click on a greyed piece: nothing is stored, the list stays open.
    await page.locator("#equip-picker [data-equip-item]").first().click({ force: true, trial: false }).catch(() => {});
    sockets[slot].stillOpenAfterGreyClick = await page.evaluate(() => !(document.querySelector("#equip-picker") as HTMLElement).hidden);
    await press("[data-equip-close]");
    await page.waitForTimeout(80);
    sockets[slot].closed = await page.evaluate(() => (document.querySelector("#equip-picker") as HTMLElement).hidden);
  }
  r.sockets = sockets;
  r.titlesPicker = null;

  // 8. The weapon socket: icon grid -> choose a different archetype -> weaponType, table, icon, caption, 3D model.
  const before = await page.evaluate(() => ({
    table: (document.querySelector('#weapon-table .pick-row[data-selected="true"]') as HTMLElement | null)?.dataset.weapon ?? null,
    icon: document.querySelector('[data-equip-slot="weapon"] svg')?.getAttribute("class") ?? null,
    caption: document.querySelector("#equip-caption")?.textContent ?? null,
    builds: Number((document.querySelector("#creator-preview") as HTMLElement).dataset.previewRefreshes ?? 0),
  }));
  const hash0 = await canvasHash(page);
  await press('[data-equip-slot="weapon"]');
  await page.waitForTimeout(150);
  r.weaponGrid = await page.evaluate(() => {
    const items = [...document.querySelectorAll<HTMLElement>("#equip-picker [data-equip-item]")];
    return { tiles: items.length, withIcon: items.filter((i) => i.querySelector("svg.icon-weapon")).length, enabled: items.filter((i) => !(i as HTMLButtonElement).disabled).length, ids: items.map((i) => i.dataset.equipItem) };
  });
  r.titlesPicker = await page.evaluate(measureTitles, [".equip-picker-title"]);
  await page.locator("#equip-picker").screenshot({ path: `${OUT}/picker-weapon-${vp}.png` });
  const target = before.icon?.includes("maul") ? "rapier" : "maul";
  await press(`#equip-picker [data-equip-item="${target}"]`);
  await page.waitForTimeout(500);
  const hash1 = await canvasHash(page);
  const after = await page.evaluate(() => ({
    table: (document.querySelector('#weapon-table .pick-row[data-selected="true"]') as HTMLElement | null)?.dataset.weapon ?? null,
    icon: document.querySelector('[data-equip-slot="weapon"] svg')?.getAttribute("class") ?? null,
    caption: document.querySelector("#equip-caption")?.textContent ?? null,
    builds: Number((document.querySelector("#creator-preview") as HTMLElement).dataset.previewRefreshes ?? 0),
    pickerClosed: (document.querySelector("#equip-picker") as HTMLElement).hidden,
    sheetWeapon: [...document.querySelectorAll("#creator-sheet .sheet-meta")].map((e) => e.textContent).join(" | "),
  }));
  r.weapon = { target, before, after, tableFollows: after.table === target, iconFollows: !!after.icon?.includes(`icon-weapon-${target}`), previewRebuilt: after.builds > before.builds, canvasChanged: hash0 !== hash1, hashes: [hash0, hash1] };
  // And back to the class default through the same grid.
  await press('[data-equip-slot="weapon"]');
  await page.waitForTimeout(120);
  await press('#equip-picker [data-equip-item=""]');
  await page.waitForTimeout(400);
  r.weapon.backToDefault = await page.evaluate(() => ({ table: (document.querySelector('#weapon-table .pick-row[data-selected="true"]') as HTMLElement | null)?.dataset.weapon ?? null, caption: document.querySelector("#equip-caption")?.textContent ?? null }));
  await page.locator(".preview-stage").screenshot({ path: `${OUT}/stage-after-${vp}.png` });
  r.contrastCreator = await pixelContrast(page, {
    "socket names": ".equip-slot-name", "caption": "#equip-caption", "sheet col head": ".menu-screen.active .sheet-col-head",
    "group head": ".menu-screen.active .group-head", "dice (stone)": ".stage-tools .dice-label",
  });
  await press('[data-equip-slot="weapon"]');
  await page.waitForTimeout(120);
  r.contrastPicker = await pixelContrast(page, { "weapon names": "#equip-picker .equip-item-name", "picker title": ".equip-picker-title" });
  await press("[data-equip-close]");
  await page.screenshot({ path: `${OUT}/creator-${vp}.png` });

  // 6/C-HUD. The pool-bar look on a specimen built with lane P's class contract (P owns the live DOM).
  r.pools = await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "probe-pools";
    Object.assign(host.style, { position: "fixed", left: "10px", top: "10px", width: "300px", zIndex: "999", display: "grid", gap: "6px", padding: "8px", background: "#1b1410" });
    for (const [pool, cur, pot] of [["health", .45, .8], ["mana", .3, .55], ["stamina", .7, .7]] as const) {
      const bar = document.createElement("div"); bar.className = "pool-bar"; bar.dataset.pool = pool;
      const p = document.createElement("div"); p.className = "pool-potential"; p.style.width = `${pot * 100}%`;
      const c = document.createElement("div"); c.className = "pool-current"; c.style.width = `${cur * 100}%`;
      const l = document.createElement("div"); l.className = "pool-lost"; l.style.width = `${(1 - pot) * 100}%`;
      const t = document.createElement("span"); t.className = "pool-text"; t.textContent = `${Math.round(cur * 100)} / ${Math.round(pot * 100)} / 100`;
      bar.append(p, c, l, t); host.appendChild(bar);
    }
    document.body.appendChild(host);
    const bar = host.querySelector(".pool-bar") as HTMLElement, lost = host.querySelector(".pool-lost") as HTMLElement;
    const br = bar.getBoundingClientRect(), lr = lost.getBoundingClientRect(), pr = host.querySelector(".pool-potential")!.getBoundingClientRect();
    return {
      frameW: getComputedStyle(bar).borderTopWidth, metalFrame: getComputedStyle(bar).backgroundImage.split("gradient(").length - 1,
      lostHatched: getComputedStyle(lost).backgroundImage.startsWith("repeating-linear-gradient"),
      lostFromPotentialToMax: Math.abs(lr.left - pr.right) <= 1.5 && Math.abs(lr.right - (br.right - parseFloat(getComputedStyle(bar).borderRightWidth))) <= 1.5,
    };
  });
  await page.locator("#probe-pools").screenshot({ path: `${OUT}/pools-${vp}.png` });
  await page.evaluate(() => document.querySelector("#probe-pools")?.remove());
  }

  // Titles on the History and Settings screens too.
  await page.evaluate(() => (globalThis as any).__MYTHERRANIA__?.engine && (document.querySelector('[data-action="back"]') as HTMLElement | null)?.click());
  await page.waitForTimeout(300);
  await page.evaluate(() => (document.querySelector('[data-action="digest"]') as HTMLElement | null)?.click());
  await page.waitForTimeout(500);
  r.titlesHistory = await page.evaluate(measureTitles, TITLE_SELECTORS);
  // And the Settings dialog (from the title's Settings button).
  await page.evaluate(() => (document.querySelector('[data-action="back"]') as HTMLElement | null)?.click());
  await page.waitForTimeout(300);
  await page.evaluate(() => (document.querySelector('[data-action="settings"]') as HTMLElement | null)?.click());
  await page.waitForTimeout(500);
  r.titlesSettings = await page.evaluate(measureTitles, TITLE_SELECTORS);
  await ctx.close();
}

report.errors = errors;
await Deno.writeTextFile(`${OUT}/report${FULL ? "" : "-" + MODE}.json`, JSON.stringify(report, null, 1));
for (const [vp, r] of Object.entries(report.viewports) as [string, any][]) {
  const t = (x: any) => x ? `${x.within1}/${x.n} max ${x.maxDx}/${x.maxDy}${x.worst && (Math.abs(x.worst.dx) > 1 || Math.abs(x.worst.dy) > 1) ? ` worst "${x.worst.text}" ${x.worst.dx}/${x.worst.dy}` : ""}` : "-";
  console.log(`${vp} tokens ${JSON.stringify(r.tokens)}`);
  console.log(`${vp} titles: title ${t(r.titleScreen)} | hero ${t(r.titlesHero)} | creator ${t(r.titlesCreator)} | picker ${t(r.titlesPicker)} | history ${t(r.titlesHistory)} | settings ${t(r.titlesSettings)}`);
  if (!FULL) continue;
  console.log(`${vp} heroBar ${JSON.stringify(r.heroBar)}`);
  console.log(`${vp} reroll ${JSON.stringify({ changed: r.reroll.changed, levelKept: r.reroll.levelKept, undo: r.reroll.undoOffered, restored: r.reroll.undoRestored, persisted: r.reroll.persisted, undoPersisted: r.reroll.undoPersisted, names: [r.reroll.before.name, r.reroll.after.name, r.reroll.afterUndo?.name] })}`);
  console.log(`${vp} ring ${JSON.stringify(r.ring)}`);
  console.log(`${vp} sockets ${JSON.stringify(Object.fromEntries(Object.entries(r.sockets).map(([k, v]: any) => [k, `${v.items}/${v.disabled} open=${v.open} grey-click-open=${v.stillOpenAfterGreyClick} closed=${v.closed}`])))}`);
  console.log(`${vp} weaponGrid ${JSON.stringify({ tiles: r.weaponGrid.tiles, withIcon: r.weaponGrid.withIcon, enabled: r.weaponGrid.enabled })} weapon ${JSON.stringify({ target: r.weapon.target, table: [r.weapon.before.table, r.weapon.after.table], icon: r.weapon.iconFollows, rebuilt: r.weapon.previewRebuilt, canvas: r.weapon.canvasChanged, caption: r.weapon.after.caption, back: r.weapon.backToDefault })}`);
  console.log(`${vp} contrast ${JSON.stringify({ ...r.contrastHero, ...r.contrastCreator, ...r.contrastPicker }, (k, v) => (k === "colour" || k === "back") ? undefined : v)}`);
  console.log(`${vp} pools ${JSON.stringify(r.pools)}`);
}
console.log(`page errors: ${errors.length}${errors.length ? " — " + errors.slice(0, 4).join(" | ") : ""}`);
await browser.close();
await server.shutdown();
