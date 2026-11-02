// deno-lint-ignore-file no-explicit-any -- QA probe: reads the page DOM and the untyped debug global.
// Wave X (lane U): the value tones, the forged-steel sign, Agility + Focus everywhere, the
// roll / reroll / tweak Creator with a live 3D model, and tile centring — measured in real Chrome.
//
//   BUILD_OUT=dist-ui deno task build && deno run -A tools/probe-wave-x-ui.ts
//   env: UI_DIST (default dist-ui), OUT (default artifacts/qa-wave-x/ui),
//        MODE=centring (only the tile-centring meter — runs against an OLD build for "before")
import { chromium, type Page } from "playwright";
import { encodeBase64 } from "@std/encoding/base64";
import { serveAsset } from "./serve.ts";
import { phonologyFor } from "../src/game/NameGen.ts";
import { ageBounds } from "../src/game/Age.ts";
import { RACES } from "../src/game/Races.ts";

const DIST = Deno.env.get("UI_DIST") ?? "dist-ui";
const OUT = Deno.env.get("OUT") ?? "artifacts/qa-wave-x/ui";
const MODE = Deno.env.get("MODE") ?? "full";
await Deno.mkdir(OUT, { recursive: true });
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (r) => serveAsset(r, DIST));
const PORT = (server.addr as Deno.NetAddr).port;
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});

/** Tiles whose content is MEANT to be centred (the fix target), and tiles laid out on purpose otherwise. */
const TILE_SELECTORS: Record<string, string> = {
  "sub-race chips": ".subrace-chip",
  "sign chips": ".sign-chip",
  "hero tabs": "#hero-tabs .hero-tab",
  "palette chips": ".palette-chip",
  "preset buttons": ".preset-row .menu-btn",
  "reroll dice": ".reroll-btn",
  "dice": ".dice-btn",
  "profile chips": ".profile-chip",
  "steel sign": ".steel-sign",
  "stepper value": ".stepper-value",
  "title mode buttons": ".title-modes-row .menu-btn",
  "skill chips": "#class-skills .skill-top",
  "race tiles (banner|text|chevron)": "#ancestry-list .race-toggle",
  "class tiles (table rows)": "#class-table .pick-row",
  "stat tiles (sheet columns)": "#creator-sheet .sheet-col",
};

/** In-page: content bbox centre vs tile centre for every visible tile of each selector. */
const measureCentring = (sels: Record<string, string>) => {
  const out: Record<string, { n: number; maxDx: number; maxDy: number; worst: string }> = {};
  const vis = (e: Element) => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  for (const [name, sel] of Object.entries(sels)) {
    const tiles = ([...document.querySelectorAll(sel)] as HTMLElement[]).filter(vis);
    let maxDx = 0, maxDy = 0, worst = "", n = 0;
    for (const t of tiles) {
      const tr = t.getBoundingClientRect();
      let l = Infinity, r = -Infinity, top = Infinity, b = -Infinity;
      const add = (rc: DOMRect) => {
        if (rc.width <= 0 || rc.height <= 0) return;
        l = Math.min(l, rc.left); r = Math.max(r, rc.right); top = Math.min(top, rc.top); b = Math.max(b, rc.bottom);
      };
      // Content = the text glyph boxes and the drawn leaves (svg, img, swatches) — never a stretched wrapper.
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
            if (s.position === "absolute" || s.position === "fixed") continue; // rivets, badges: decoration
            const tag = el.tagName.toLowerCase();
            // A child that paints its own face (a background or a border: a badge, a "+" disc) is
            // content as a whole box; a bare wrapper is not — descend to its glyphs.
            const painted = (s.backgroundImage !== "none" || !/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor) || parseFloat(s.borderTopWidth) > 0) && el !== t;
            if (tag === "svg" || tag === "img" || tag === "canvas" || el.childNodes.length === 0 || painted) add(el.getBoundingClientRect());
            else walk(el);
          }
        }
      };
      walk(t);
      if (!Number.isFinite(l)) {
        // A tile with no inner content (a palette swatch): its own painted face is the content.
        continue;
      }
      n++;
      const dx = ((l + r) / 2) - (tr.left + tr.width / 2);
      const dy = ((top + b) / 2) - (tr.top + tr.height / 2);
      if (Math.abs(dx) > maxDx) { maxDx = Math.abs(dx); worst = `"${(t.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 22)}" dx ${dx.toFixed(1)} dy ${dy.toFixed(1)}`; }
      if (Math.abs(dy) > maxDy) maxDy = Math.abs(dy);
    }
    out[name] = { n, maxDx: +maxDx.toFixed(1), maxDy: +maxDy.toFixed(1), worst };
  }
  return out;
};

/** In-page: every toned number, its colour, its background and the contrast between them. */
const measureTones = () => {
  const parse = (c: string): [number, number, number, number] | null => {
    const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?/.exec(c);
    return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
  };
  const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; };
  const els = ([...document.querySelectorAll("[data-tone]")] as HTMLElement[]).filter(vis);
  let pos = 0, neg = 0, neutral = 0;
  for (const el of els) {
    const c = parse(getComputedStyle(el).color);
    if (!c) continue;
    if (c[1] > c[0] + 30) pos++; else if (c[0] > c[1] + 30) neg++; else neutral++;
  }
  const parchment = els.filter((e) => e.closest(".stepper")).length;
  // Unpainted = a [data-tone] element still wearing a stylesheet colour instead of toneFor's.
  const unpainted = els.filter((e) => !e.style.color).length;
  return { toned: els.length, pos, neg, neutral, parchment, unpainted };
};

/**
 * Contrast against the PIXELS really behind each toned number: hide the glyphs, screenshot the
 * element's box, decode the PNG in the page (an <img> from a data: URL, which the CSP allows), take
 * the median colour, and compare with the computed text colour (WCAG ratio).
 */
async function pixelContrast(page: Page, limit = 48) {
  const ids: number[] = await page.evaluate((lim) => {
    const els = ([...document.querySelectorAll("[data-tone]")] as HTMLElement[]).filter((e) => e.getBoundingClientRect().height > 0);
    // Spread the sample over the kinds (sheet, deltas, race detail, modifiers, parchment wells).
    const pick: HTMLElement[] = [];
    const kinds = new Map<string, HTMLElement[]>();
    for (const e of els) { const k = e.className || e.tagName; (kinds.get(k) ?? kinds.set(k, []).get(k)!).push(e); }
    while (pick.length < lim && [...kinds.values()].some((l) => l.length)) for (const l of kinds.values()) { const e = l.shift(); if (e) pick.push(e); }
    pick.forEach((e, i) => e.setAttribute("data-probe-tone", String(i)));
    return pick.map((_, i) => i);
  }, limit);
  const rows: { kind: string; text: string; colour: string; back: string; ratio: number; surface: string }[] = [];
  for (const i of ids) {
    const sel = `[data-probe-tone="${i}"]`;
    const info = await page.evaluate((sl) => {
      const e = document.querySelector(sl) as HTMLElement;
      e.scrollIntoView({ block: "center" });
      const r = e.getBoundingClientRect();
      const colour = getComputedStyle(e).color;
      e.style.visibility = "hidden";
      return { x: r.left, y: r.top, w: r.width, h: r.height, colour, kind: e.className || e.tagName, text: (e.textContent ?? "").trim().slice(0, 12), surface: e.closest(".stepper") ? "parchment" : "dark", vw: innerWidth, vh: innerHeight };
    }, sel);
    if (info.w < 2 || info.h < 2 || info.y < 0 || info.y + info.h > info.vh) { await page.evaluate((sl) => { (document.querySelector(sl) as HTMLElement).style.visibility = ""; }, sel); continue; }
    const png = await page.screenshot({ clip: { x: Math.max(0, info.x), y: info.y, width: Math.min(info.w, info.vw - info.x), height: info.h } });
    const b64 = encodeBase64(new Uint8Array(png));
    const res = await page.evaluate(async ([sl, data, colour]) => {
      (document.querySelector(sl) as HTMLElement).style.visibility = "";
      const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
      const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
      const g = cv.getContext("2d")!; g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      const lums: number[] = [], cols: number[][] = [];
      const lin = (x: number) => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      for (let k = 0; k < d.length; k += 4) { cols.push([d[k], d[k + 1], d[k + 2]]); lums.push(0.2126 * lin(d[k]) + 0.7152 * lin(d[k + 1]) + 0.0722 * lin(d[k + 2])); }
      const order = lums.map((l, k) => [l, k]).sort((a, b) => a[0] - b[0]);
      const [lb, kb] = order[order.length >> 1];
      const m = /([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(colour)!;
      const lt = 0.2126 * lin(+m[1]) + 0.7152 * lin(+m[2]) + 0.0722 * lin(+m[3]);
      const c = cols[kb];
      return { ratio: (Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05), back: `rgb(${c[0]}, ${c[1]}, ${c[2]})` };
    }, [sel, b64, info.colour] as const);
    rows.push({ kind: info.kind, text: info.text, colour: info.colour, back: res.back, ratio: +res.ratio.toFixed(2), surface: info.surface });
  }
  const ratios = rows.map((r) => r.ratio).sort((a, b) => a - b);
  const worst = rows.slice().sort((a, b) => a.ratio - b.ratio).slice(0, 3);
  return {
    sampled: rows.length, min: ratios[0] ?? null, median: ratios[ratios.length >> 1] ?? null,
    atLeast45: rows.filter((r) => r.ratio >= 4.5).length, atLeast3: rows.filter((r) => r.ratio >= 3).length,
    parchmentSampled: rows.filter((r) => r.surface === "parchment").length,
    parchmentMin: Math.min(...rows.filter((r) => r.surface === "parchment").map((r) => r.ratio), 99),
    worst,
  };
}

/** A hash of the preview canvas's pixels (did the 3D model visibly change?). */
async function canvasHash(page: Page): Promise<string> {
  const loc = page.locator("#creator-preview");
  await loc.scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  const png = await loc.screenshot();
  const h = await crypto.subtle.digest("SHA-1", new Uint8Array(png));
  return [...new Uint8Array(h)].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const errors: string[] = [];
const report: any = { dist: DIST, mode: MODE, viewports: {} };

async function openGenerator(page: Page) {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.click('[data-action="start"]');
  await page.waitForTimeout(600);
}

const state = (page: Page) => page.evaluate(() => {
  const q = (s: string) => document.querySelector(s) as HTMLElement | null;
  const sheetRow = (label: string) => [...document.querySelectorAll("#creator-sheet .sheet-row")].find((r) => r.querySelector(".sheet-row-label")?.textContent === label)?.querySelector(".sheet-row-value")?.textContent ?? null;
  const canvas = q("#creator-preview");
  const raceBox = document.querySelector("[data-race-box].selected") as HTMLElement | null;
  return {
    name: (q("#creator-name") as HTMLInputElement | null)?.value ?? null,
    race: raceBox?.dataset.raceBox ?? null,
    subrace: (document.querySelector(".subrace-chip.selected") as HTMLElement | null)?.dataset.subrace ?? null,
    signRace: q("#creator-steel-sign [data-sign-race]")?.textContent ?? null,
    signSub: q("#creator-steel-sign [data-sign-sub]")?.textContent ?? null,
    strength: sheetRow("Strength"), maxHealth: sheetRow("Max Health"), attackPower: sheetRow("Attack Power"),
    points: q("#creator-points")?.dataset.left ?? null,
    builds: Number(canvas?.dataset.previewRefreshes ?? 0), previewMs: Number(canvas?.dataset.previewMs ?? NaN),
    height: (q("#creator-height") as HTMLInputElement | null)?.value ?? null,
    age: (q("#creator-age") as HTMLInputElement | null)?.value ?? null,
    ageMin: (q("#creator-age") as HTMLInputElement | null)?.min ?? null,
    ageMax: (q("#creator-age") as HTMLInputElement | null)?.max ?? null,
  };
});

const VIEWPORTS: [string, number, number][] = [["390", 390, 844], ["820", 820, 1180], ["1280", 1280, 800], ["1920", 1920, 1080]];
for (const [vp, w, h] of VIEWPORTS) {
  const touch = w <= 820;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: w <= 390 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${vp}: ${String(e)}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${vp} console: ${m.text()}`); });
  const press = (sel: string) => touch ? page.tap(sel) : page.click(sel);
  const r: any = {};
  report.viewports[vp] = r;
  await openGenerator(page);
  // The hero tab first (the hero card's sign), then the generator.
  r.heroCard = await page.evaluate(() => {
    const sign = document.querySelector(".hero-card .steel-sign")?.getBoundingClientRect();
    const fig = document.querySelector(".hero-card .hero-portrait")?.getBoundingClientRect();
    return { sign: !!sign, signAbovePortrait: !!sign && !!fig && sign.bottom <= fig.top + 1, text: document.querySelector(".hero-card .steel-sign")?.textContent ?? null };
  });
  if (MODE === "full") await page.screenshot({ path: `${OUT}/hero-${vp}.png` });
  await press('[data-hero-tab="new"]');
  await page.waitForTimeout(500);
  // Open every Creator group so all tiles can be measured.
  await page.evaluate(() => document.querySelectorAll<HTMLDetailsElement>('[data-screen="select"] details.opt-group').forEach((d) => { d.open = true; }));
  await page.waitForTimeout(400);
  r.centring = await page.evaluate(measureCentring, TILE_SELECTORS);
  if (MODE !== "full") { await ctx.close(); continue; }

  await page.locator(".ui-panel-preview").screenshot({ path: `${OUT}/preview-${vp}.png` });
  await page.screenshot({ path: `${OUT}/creator-${vp}.png`, fullPage: true });

  // 1. Tones: green and red numbers on screen, legible against the pixels behind them.
  r.tones = await page.evaluate(measureTones);
  // A tweak first, so the parchment wells carry a non-zero tone too.
  await page.evaluate(() => { const e = document.querySelector("#creator-attr-agility") as HTMLInputElement; e.value = String(Number(e.value) + 2); e.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.evaluate(() => { const e = document.querySelector("#creator-attr-intelligence") as HTMLInputElement; e.value = String(Number(e.value) - 2); e.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForTimeout(150);
  r.tonesAfterTweak = await page.evaluate(measureTones);
  r.contrast = await pixelContrast(page);

  // 2. The sign sits at the top of the viewer box and names the race + sub-race.
  r.sign = await page.evaluate(() => {
    const s = document.querySelector("#creator-steel-sign") as HTMLElement | null;
    const c = document.querySelector("#creator-preview") as HTMLElement | null;
    const stage = document.querySelector(".preview-stage") as HTMLElement | null;
    if (!s || !c || !stage) return { present: false };
    const sr = s.getBoundingClientRect(), cr = c.getBoundingClientRect(), st = stage.getBoundingClientRect();
    return { present: true, above: sr.bottom <= cr.top + 1, topGapPx: +(sr.top - st.top).toFixed(1), firstChild: stage.firstElementChild === s, widthPx: Math.round(sr.width), rivets: s.querySelectorAll(".steel-rivet").length };
  });

  // 3. Agility + Focus rows everywhere they belong; no Willpower left.
  r.attributes = await page.evaluate(() => {
    const vis = (e: Element | null) => !!e && (e as HTMLElement).getBoundingClientRect().height > 0;
    const labels = [...document.querySelectorAll("#creator-sheet .sheet-row-label")].map((e) => e.textContent);
    const raceRows = [...document.querySelectorAll("#race-detail .stat-row span")].map((e) => e.textContent);
    const ctl = document.querySelector("#creator-attr-agility");
    const stepper = ctl?.nextElementSibling ?? ctl?.parentElement?.querySelector(".stepper") ?? null;
    const text = document.body.innerText;
    return {
      sheetAgility: labels.includes("Agility"), sheetFocus: labels.includes("Focus"), sheetPrimaries: labels.slice(0, 7),
      raceDetailAgility: raceRows.includes("Agility"), raceDetailFocus: raceRows.includes("Focus"),
      agilityStepperVisible: vis(stepper), focusStepperVisible: vis(document.querySelector("#creator-attr-focus")?.parentElement?.querySelector(".stepper") ?? null),
      willpower: /willpower|\bWIL\b/i.test(text),
    };
  });

  // 4. Reroll ONE part: the name changes; an ancestry reroll moves the race and the name follows its phonology.
  const s0 = await state(page);
  await press('#override-fields [data-reroll="name"], .tweak-name [data-reroll="name"]').catch(() => press('[data-reroll="name"]'));
  await page.waitForTimeout(150);
  const s1 = await state(page);
  const phon: { race: string | null; sub: string | null; name: string | null; ok: boolean }[] = [];
  for (let i = 0; i < 4; i++) {
    await page.locator('#override-fields [data-reroll="ancestry"]').first().scrollIntoViewIfNeeded();
    await press('#override-fields [data-reroll="ancestry"]');
    await page.waitForTimeout(150);
    const s = await state(page);
    const onsets = phonologyFor(s.race, s.subrace).onsets.map((o) => o.toLowerCase());
    const given = (s.name ?? "").toLowerCase();
    phon.push({ race: s.race, sub: s.subrace, name: s.name, ok: onsets.some((o) => given.startsWith(o)) && s.signRace === RACES.find((x) => x.id === s.race)?.name });
  }
  const ab = ageBounds(phon.at(-1)?.race ?? "human");
  const sA = await state(page);
  r.reroll = {
    nameBefore: s0.name, nameAfter: s1.name, nameChanged: s0.name !== s1.name && !!s1.name, raceKeptOnNameReroll: s0.race === s1.race,
    ancestry: phon, phonologyFollows: phon.every((p) => p.ok),
    ageBand: { ui: [Number(sA.ageMin), Number(sA.ageMax)], ageBounds: [ab.min, ab.max] },
    ageBandMatches: Number(sA.ageMin) === ab.min && Number(sA.ageMax) === ab.max,
  };

  // 5. Tweak a stat: the sheet and the derived numbers move at once, the pool shrinks.
  const b0 = await state(page);
  const strNext = page.locator("#creator-attr-strength").locator("xpath=..").locator(".stepper-next");
  await strNext.scrollIntoViewIfNeeded();
  // Two points: statDelta floors strength / 2, so one point may not move a derived number.
  await (touch ? strNext.tap() : strNext.click());
  await page.waitForTimeout(80);
  await (touch ? strNext.tap() : strNext.click());
  await page.waitForTimeout(120);
  const b1 = await state(page);
  r.tweak = { strength: [b0.strength, b1.strength], maxHealth: [b0.maxHealth, b1.maxHealth], attackPower: [b0.attackPower, b1.attackPower], pointsLeft: [b0.points, b1.points],
    sheetMoved: b0.strength !== b1.strength, derivedMoved: b0.maxHealth !== b1.maxHealth || b0.attackPower !== b1.attackPower, poolShrank: Number(b1.points) < Number(b0.points), previewRefreshes: [b0.builds, b1.builds] };

  // 6. Preview latency: a height step -> the model rebuilt (measured in-page from pointerdown to the
  // build counter moving), plus the menu's own measure (edit -> rebuilt + drawn).
  const lat: number[] = [], own: number[] = [];
  for (let i = 0; i < 5; i++) {
    const hNext = page.locator("#creator-height").locator("xpath=..").locator(i % 2 ? ".stepper-prev" : ".stepper-next");
    await hNext.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      const c = document.querySelector("#creator-preview") as HTMLElement;
      const w = globalThis as any;
      w.__latT0 = null; w.__latT1 = null;
      const start = c.dataset.previewRefreshes;
      document.addEventListener("pointerdown", () => { w.__latT0 = performance.now(); }, { once: true, capture: true });
      const mo = new MutationObserver(() => { if (c.dataset.previewRefreshes !== start && w.__latT1 === null) { w.__latT1 = performance.now(); mo.disconnect(); } });
      mo.observe(c, { attributes: true });
    });
    await (touch ? hNext.tap() : hNext.click());
    await page.waitForTimeout(200);
    const m = await page.evaluate(() => { const w = globalThis as any; return { d: w.__latT1 !== null && w.__latT0 !== null ? w.__latT1 - w.__latT0 : null, own: Number((document.querySelector("#creator-preview") as HTMLElement).dataset.previewMs) }; });
    if (m.d !== null) lat.push(+m.d.toFixed(1));
    own.push(m.own);
  }
  const sorted = [...lat].sort((a, b) => a - b);
  r.previewLatency = { pointerToRebuildMs: lat, median: sorted[sorted.length >> 1] ?? null, max: sorted.at(-1) ?? null, menuMeasuredMs: own };

  // 6b. Which edits VISIBLY change the 3D model (canvas pixels before/after one step).
  const visible: Record<string, boolean> = {};
  const stepOnce = async (id: string, dir: "next" | "prev" = "next") => {
    const l = page.locator(`#${id}`).locator("xpath=..").locator(`.stepper-${dir}`);
    await l.scrollIntoViewIfNeeded();
    await (touch ? l.tap() : l.click());
    await page.waitForTimeout(250);
  };
  for (const [label, id, dir] of [["height", "creator-height", "prev"], ["weight", "creator-weight", "next"], ["sex", "creator-sex", "next"], ["age (+3 y)", "creator-age", "next"], ["silhouette width", "creator-sil-width", "next"], ["strength", "creator-attr-strength", "next"]] as const) {
    const h0 = await canvasHash(page);
    await stepOnce(id, dir);
    if (label.startsWith("age")) { await stepOnce(id, dir); await stepOnce(id, dir); }
    const h1 = await canvasHash(page);
    visible[label] = h0 !== h1;
  }
  r.modelChangesOn = visible;
  r.waitMs = await page.evaluate(() => Number((document.querySelector("#creator-preview") as HTMLElement).dataset.previewWaitMs));

  // 7. Silhouette + age steppers exist; an age step stays inside the band.
  const ag = page.locator("#creator-age").locator("xpath=..").locator(".stepper-next");
  await ag.scrollIntoViewIfNeeded();
  for (let i = 0; i < 3; i++) await (touch ? ag.tap() : ag.click());
  const sAge = await state(page);
  r.age = { value: Number(sAge.age), band: [Number(sAge.ageMin), Number(sAge.ageMax)], inside: Number(sAge.age) >= Number(sAge.ageMin) && Number(sAge.age) <= Number(sAge.ageMax) };
  r.silhouetteSteppers = await page.evaluate(() => document.querySelectorAll(".override-silhouette .stepper").length);

  // 8. A full roll (the big dice) rebuilds everything.
  const before = await state(page);
  await press('.stage-tools [data-action="dice"]');
  await page.waitForTimeout(300);
  const after = await state(page);
  r.fullRoll = { nameChanged: before.name !== after.name, builds: [before.builds, after.builds] };

  await page.locator("#override-fields").scrollIntoViewIfNeeded();
  await page.locator("#override-fields").screenshot({ path: `${OUT}/override-${vp}.png` });
  await page.locator(".ui-panel-preview").screenshot({ path: `${OUT}/preview-after-${vp}.png` });
  await ctx.close();
}

report.errors = errors;
await Deno.writeTextFile(`${OUT}/report${MODE === "full" ? "" : "-" + MODE}.json`, JSON.stringify(report, null, 1));
for (const [vp, r] of Object.entries(report.viewports) as [string, any][]) {
  const worst = Object.entries(r.centring as Record<string, any>).map(([k, v]) => `${k} ${v.maxDx}/${v.maxDy}(n${v.n})`).join("; ");
  console.log(`${vp} centring dx/dy max: ${worst}`);
  if (MODE !== "full") continue;
  console.log(`${vp} tones ${JSON.stringify(r.tones)} after tweak ${JSON.stringify(r.tonesAfterTweak)}`);
  console.log(`${vp} contrast (pixels) ${JSON.stringify(r.contrast)}`);
  console.log(`${vp} model changes on ${JSON.stringify(r.modelChangesOn)} rAF wait ${r.waitMs} ms`);
  console.log(`${vp} sign ${JSON.stringify(r.sign)} hero ${JSON.stringify(r.heroCard)}`);
  console.log(`${vp} attributes ${JSON.stringify(r.attributes)}`);
  console.log(`${vp} reroll name ${r.reroll.nameBefore} -> ${r.reroll.nameAfter} changed=${r.reroll.nameChanged} phonology=${r.reroll.phonologyFollows} ${JSON.stringify(r.reroll.ancestry)} age band ok=${r.reroll.ageBandMatches}`);
  console.log(`${vp} tweak ${JSON.stringify(r.tweak)}`);
  console.log(`${vp} preview latency ${JSON.stringify(r.previewLatency)} age ${JSON.stringify(r.age)} silhouette steppers ${r.silhouetteSteppers} full roll ${JSON.stringify(r.fullRoll)}`);
}
console.log(`page errors: ${errors.length}${errors.length ? " — " + errors.slice(0, 4).join(" | ") : ""}`);
await browser.close();
await server.shutdown();
