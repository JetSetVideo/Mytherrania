// deno-lint-ignore-file no-explicit-any -- QA verifier: reads the page DOM, untyped debug globals and lane modules loaded by path.
// Wave Z — agent V's INDEPENDENT verifier of the Fighters page (lanes F layout, S statistics, G viewer).
// It does not reuse any lane probe: its own server, its own seeded heroes, its own meters.
//
//   BUILD_OUT=dist-verify deno task build
//   deno run -A tools/verify-wave-z.ts measure <label> [distDir]   # browser + Deno recompute -> artifacts/wave-z/verify/<label>/
//   deno run -A tools/verify-wave-z.ts doc                         # docs/wave-z/VERIFY.md from the JSON
//
// Meters (each a number from code, judged by `judge()` below):
//   layout   horizontal overflow, clipped/spilled text, overlapping interactive boxes, min font, touch targets
//   head     the removed panel head "Figure, record, statistics" is absent
//   roll     label "Roll", purple-ish stone (median hue of the painted face, glyphs hidden), icon size, padding
//   lv       "LV" + number, badge in the card's top-left, data-tier per level band, 5 distinct pixel colours
//   overlay  the name and the tags lie inside the picture box; pixel contrast (glyphs hidden) >= 4.5
//   stats    every attribute row has a (+n)/(−n)/(0) delta; derived row count; DOM == derivedSheet(character);
//            >= 5 random rows recomputed from the underlying game functions (not DerivedSheet)
//   viewer   floor under the feet, shadow (feet ring vs rim luminance; cast/contact on vs off), key light from above
import { chromium, type Page } from "playwright";
import { encodeBase64 } from "@std/encoding/base64";
import { serveAsset } from "./serve.ts";
import { ProfileRepo, type Store } from "../src/game/Profiles.ts";
import { createRandomProfile, libraryEntries } from "../src/game/ProfileLibrary.ts";
import { rng32 } from "../src/core/MathCore.ts";
import { createFighter } from "../src/game/Fighter.ts";
import { startingStats } from "../src/game/Leveling.ts";
import { raceAffinity, RACES, statDelta } from "../src/game/Races.ts";
import { applyLevel, attackDamage, CLASSES, createStats, criticalChance, DAMAGE_SCALE, HEALTH_SCALE } from "../src/game/Stats.ts";
import { weaponForClass } from "../src/game/Weapon.ts";
import { BASELINE_INTERVAL } from "../src/game/weapons/Profile.ts";
import { createResources } from "../src/game/Resources.ts";
import { fatigueResist, traitsOf, woundFactor } from "../src/game/Potential.ts";
import { agilityOf, dashMul, dodgeDivisor, effectiveAgility, moveSpeedMul, turnRateMul } from "../src/game/Agility.ts";
import { bodyFromStats, density, totalMass, toughness } from "../src/game/Physics.ts";
import { CAST_BASE_BY_KIND, castSeconds } from "../src/game/Cast.ts";
import { castFocus } from "../src/game/PowerCost.ts";
import { powerTailSeconds, skillsForClass } from "../src/game/Skills.ts";

const ROOT = "artifacts/wave-z/verify";
const mode = Deno.args[0] ?? "measure";

// ── Seeded heroes: one per tier boundary, the selected one (newest) at level 20 ─────────────────────
/** Levels seeded: both ends of every band (1-4 bronze, 5-8 copper, 9-12 silver, 13-16 gold, 17-20 platinum). */
export const SEED_LEVELS = [20, 1, 4, 5, 8, 9, 12, 13, 16, 17];
export const EXPECTED_TIER = (lv: number) => lv <= 4 ? "bronze" : lv <= 8 ? "copper" : lv <= 12 ? "silver" : lv <= 16 ? "gold" : "platinum";

class MemStore implements Store {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

/** The stored JSON (what localStorage holds) for the seeded heroes; newest first = SEED_LEVELS order. */
export function seededProfilesJson(): string {
  const store = new MemStore();
  const repo = new ProfileRepo(store);
  const rng = rng32(20261102);
  SEED_LEVELS.forEach((_, i) => createRandomProfile(repo, rng, new Date(Date.UTC(2026, 10, 2, 12, 0, 0) - i * 60000).toISOString()));
  const list = JSON.parse(store.getItem("mytherrania-profiles-v1")!) as any[];
  // Same order as created: index i is the i-th created (createdAt descending = SEED_LEVELS order).
  list.forEach((p, i) => { p.level = SEED_LEVELS[i]; });
  return JSON.stringify(list);
}

/** The characters the page will show, through the game's own library path. */
function seededEntries(json: string) {
  const store = new MemStore();
  store.setItem("mytherrania-profiles-v1", json);
  return libraryEntries(new ProfileRepo(store));
}

// ── In-page meters ──────────────────────────────────────────────────────────────────────────────────
const layoutMeter = () => {
  const scr = document.querySelector(".menu-screen.active") as HTMLElement | null;
  const vis = (e: Element) => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && +s.opacity > 0.05;
  };
  const docOverflow = document.documentElement.scrollWidth - innerWidth;
  const scrOverflow = scr ? scr.scrollWidth - scr.clientWidth : 0;
  // Elements wider than the viewport's right edge (that are not inside a horizontal scroller).
  const inScroller = (e: Element) => { for (let p = e.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === "auto" || o === "scroll") && p !== scr) return true; } return false; };
  const all = scr ? ([...scr.querySelectorAll("*")] as HTMLElement[]).filter(vis) : [];
  const offRight = all.filter((e) => !inScroller(e) && e.getBoundingClientRect().right > innerWidth + 1 && !e.closest("svg"))
    .map((e) => `${e.tagName.toLowerCase()}.${String((e.className as any)?.baseVal ?? e.className).split(" ")[0]} r=${Math.round(e.getBoundingClientRect().right)}`).slice(0, 8);
  // Text boxes: elements with their own non-blank text node, not inline.
  const textEls = all.filter((e) => [...e.childNodes].some((c) => c.nodeType === 3 && (c.textContent ?? "").trim()) && !e.closest("svg"));
  const clipped: string[] = [];
  const truncated: string[] = [];
  let minFont = Infinity, minFontAt = "";
  for (const e of textEls) {
    const s = getComputedStyle(e);
    const fs = parseFloat(s.fontSize);
    if (fs < minFont) { minFont = fs; minFontAt = `${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]} "${(e.textContent ?? "").trim().slice(0, 20)}"`; }
    if (s.display === "inline") continue;
    const w = e.scrollWidth - e.clientWidth, h = (s.overflowY === "hidden" || s.overflow === "hidden" || s.webkitLineClamp !== "none") ? e.scrollHeight - e.clientHeight : 0;
    const ell = s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none";
    if ((w > 1 || h > 2) && ell) { truncated.push(`${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]} "${(e.textContent ?? "").trim().slice(0, 24)}" sw${e.scrollWidth}/cw${e.clientWidth}`); continue; }
    if (w > 1 || h > 2) clipped.push(`${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]} "${(e.textContent ?? "").trim().slice(0, 24)}" sw${e.scrollWidth}/cw${e.clientWidth} sh${e.scrollHeight}/ch${e.clientHeight} ov=${s.overflow}`);
  }
  // Interactive + identity boxes that must not overlap each other.
  const card = document.querySelector("#profiles-body .hero-card") ?? document.querySelector("#profiles-body");
  const boxes = (scr ? ([...scr.querySelectorAll("button, [role=tab], a[href], input, select, summary, .lv-badge, .level-badge, .zv-tag, .hero-tag, .sheet-name")] as HTMLElement[]) : [])
    .filter(vis).filter((e) => { const r = e.getBoundingClientRect(); return r.bottom > -2000 && r.width > 1 && r.height > 1; });
  const overlaps: string[] = [];
  let stickyOverlaps = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      // A real overlap: both painted (no transparent ancestor) and one of them is on top at the overlap's centre.
      const shown = (e: Element) => { for (let p: Element | null = e; p; p = p.parentElement) { const st = getComputedStyle(p); if (+st.opacity < 0.05 || st.visibility === "hidden") return false; } return true; };
      if (!(ix > 1 && iy > 1)) continue;
      let qa = ra, qb = rb;
      let cy = (Math.max(qa.top, qb.top) + Math.min(qa.bottom, qb.bottom)) / 2;
      if (cy < 0 || cy > innerHeight) { a.scrollIntoView({ block: "center" }); qa = a.getBoundingClientRect(); qb = b.getBoundingClientRect(); cy = (Math.max(qa.top, qb.top) + Math.min(qa.bottom, qb.bottom)) / 2; }
      const cx = (Math.max(qa.left, qb.left) + Math.min(qa.right, qb.right)) / 2;
      const t = document.elementFromPoint(cx, cy);
      const topHit = !!t && (a.contains(t) || b.contains(t));
      // A fixed/sticky bar (the action bar) passing over scrolled content is not a layout overlap.
      const pinned = (e: Element) => { for (let p: Element | null = e; p && p !== scr; p = p.parentElement) { const ps = getComputedStyle(p).position; if (ps === "fixed" || ps === "sticky") return true; } return false; };
      if (pinned(a) !== pinned(b)) { stickyOverlaps++; continue; }
      if (ix > 1 && iy > 1 && shown(a) && shown(b) && topHit) {
        // Hidden behind something else (e.g. a closed overlay)? Only count when both are hit-testable at the overlap centre.
        overlaps.push(`${a.tagName.toLowerCase()}.${String(a.className).split(" ")[0]}"${(a.textContent ?? "").trim().slice(0, 12)}" x ${b.tagName.toLowerCase()}.${String(b.className).split(" ")[0]}"${(b.textContent ?? "").trim().slice(0, 12)}" ${ix.toFixed(0)}x${iy.toFixed(0)}`);
      }
    }
  }
  const targets = (scr ? ([...scr.querySelectorAll("button, [role=tab], a[href], input, select, summary")] as HTMLElement[]) : []).filter(vis)
    .filter((e) => !(e as HTMLButtonElement).disabled || true)
    .map((e) => { const r = e.getBoundingClientRect(); return { t: `${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]} "${(e.textContent ?? e.getAttribute("aria-label") ?? "").trim().slice(0, 14)}"`, w: Math.round(r.width), h: Math.round(r.height) }; });
  const small24 = targets.filter((t) => Math.min(t.w, t.h) < 24).map((t) => `${t.t} ${t.w}x${t.h}`);
  const small44 = targets.filter((t) => Math.min(t.w, t.h) < 44).length;
  const bodyText = document.body.innerText;
  // Words broken mid-word across lines (a long name wrapping as "Stepperun|ners").
  const wordBreaks: string[] = [];
  for (const e of textEls) {
    for (const c of e.childNodes) {
      if (c.nodeType !== 3) continue;
      const txt = c.textContent ?? "";
      for (const m of txt.matchAll(/[^\s\-\u2010-\u2015\u00b7\/]{4,}/g)) {
        const rg = document.createRange(); rg.setStart(c, m.index!); rg.setEnd(c, m.index! + m[0].length);
        const tops = new Set([...rg.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top)));
        if (tops.size > 1) wordBreaks.push(`"${m[0].slice(0, 24)}" in ${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]}`);
      }
    }
  }
  // Scrolled to the end (every scroller), no leaf text may stay UNDER a bar pinned over the viewport bottom:
  // a leaf whose centre hit-tests to the bar is occluded content.
  const scrollers = [document.scrollingElement as HTMLElement, ...all.filter((e) => { const o = getComputedStyle(e).overflowY; return (o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight + 2; })];
  if (scr) scrollers.push(scr);
  for (const sc of scrollers) if (sc) sc.scrollTop = sc.scrollHeight;
  const pinnedBars = all.filter((e) => { const ps = getComputedStyle(e).position; const r = e.getBoundingClientRect(); return (ps === "fixed" || ps === "sticky") && r.bottom >= innerHeight - 2 && r.top > innerHeight * 0.5; });
  const occluded: string[] = [];
  if (pinnedBars.length) {
    const barTop = Math.min(...pinnedBars.map((e) => e.getBoundingClientRect().top));
    for (const e of all) {
      if (pinnedBars.some((b) => b.contains(e)) || e.children.length || !(e.textContent ?? "").trim()) continue;
      const r = e.getBoundingClientRect();
      if (r.bottom <= barTop || r.top >= innerHeight) continue;
      const t = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, r.top + r.height / 2));
      if (t && pinnedBars.some((b) => b.contains(t))) occluded.push(`${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]} "${(e.textContent ?? "").trim().slice(0, 18)}"`);
    }
  }
  const bottomHidden = occluded.length;
  for (const sc of scrollers) if (sc) sc.scrollTop = 0;
  if (scr) scr.scrollTop = 0;
  scrollTo(0, 0);
  return {
    docOverflow, scrOverflow, offRight, textEls: textEls.length, clipped, truncated, minFont: Number.isFinite(minFont) ? minFont : null, minFontAt,
    overlaps, stickyOverlaps, wordBreaks, bottomHidden, occluded: occluded.slice(0, 6), nBoxes: boxes.length, targets: targets.length, small24, small44,
    headPresent: /Figure, record, statistics/.test(bodyText), chosenHeroHead: /Chosen hero/.test(bodyText), hasCard: !!card,
  };
};

/** Median colour stats of a page region (css px clip), computed on the screenshot's pixels. */
async function regionStats(page: Page, clip: { x: number; y: number; width: number; height: number }) {
  const vp = page.viewportSize()!;
  const x = Math.max(0, clip.x), y = Math.max(0, clip.y);
  const c = { x, y, width: Math.max(1, Math.min(clip.width - (x - clip.x), vp.width - x)), height: Math.max(1, Math.min(clip.height - (y - clip.y), vp.height - y)) };
  const png = await page.screenshot({ clip: c });
  return await page.evaluate(async (data) => {
    const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
    const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext("2d")!; g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const px: { l: number; r: number; g: number; b: number; h: number; s: number }[] = [];
    for (let k = 0; k < d.length; k += 4) {
      const r = d[k], gg = d[k + 1], b = d[k + 2];
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), dd = mx - mn;
      let h = 0;
      if (dd > 0) h = mx === r ? ((gg - b) / dd) % 6 : mx === gg ? (b - r) / dd + 2 : (r - gg) / dd + 4;
      px.push({ l: 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b), r, g: gg, b, h: (h * 60 + 360) % 360, s: mx ? dd / mx : 0 });
    }
    const med = (a: number[]) => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
    // Hue median over saturated pixels only (grey pixels have no hue), circular-safe enough for 0..360 bands used here.
    const sat = px.filter((p) => p.s > 0.08);
    return { w: cv.width, h: cv.height, n: px.length, lum: med(px.map((p) => p.l)), rgb: [med(px.map((p) => p.r)), med(px.map((p) => p.g)), med(px.map((p) => p.b))], hue: sat.length ? med(sat.map((p) => p.h)) : null, sat: med(px.map((p) => p.s)), satShare: sat.length / px.length, lums: px.map((p) => p.l) };
  }, encodeBase64(new Uint8Array(png)));
}

/** Text contrast on the pixels behind the element: glyphs hidden (keepShadow: text-shadow kept as part of the background). */
async function textContrast(page: Page, sel: string, keepShadow: boolean) {
  const info = await page.evaluate(([s, ks]) => {
    const e = document.querySelector(s as string) as HTMLElement | null;
    if (!e) return null;
    e.scrollIntoView({ block: "center" });
    const r = e.getBoundingClientRect();
    const colour = getComputedStyle(e).color;
    const els = [e, ...e.querySelectorAll<HTMLElement>("*")];
    for (const k of els) { (k as any).__vc = k.style.color; (k as any).__vs = k.style.textShadow; k.style.color = "transparent"; if (!ks) k.style.textShadow = "none"; }
    return { x: r.left, y: r.top, w: r.width, h: r.height, colour };
  }, [sel, keepShadow] as const);
  if (!info) return null;
  const st = await regionStats(page, { x: info.x, y: info.y, width: info.w, height: info.h });
  await page.evaluate((s) => {
    const e = document.querySelector(s) as HTMLElement;
    for (const k of [e, ...e.querySelectorAll<HTMLElement>("*")]) { k.style.color = (k as any).__vc ?? ""; k.style.textShadow = (k as any).__vs ?? ""; }
  }, sel);
  const m = /([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(info.colour)!;
  const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lt = 0.2126 * lin(+m[1]) + 0.7152 * lin(+m[2]) + 0.0722 * lin(+m[3]);
  const cr = (lb: number) => (Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05);
  const per = st.lums.map(cr).sort((a: number, b: number) => a - b);
  return { median: +cr(st.lum).toFixed(2), p10: +per[Math.floor(per.length * 0.1)].toFixed(2), colour: info.colour, back: `rgb(${st.rgb.join(",")})` };
}

/** Everything about the selected hero card (Fighters page, hero tab). */
const cardMeter = () => {
  const body = document.querySelector("#profiles-body") as HTMLElement | null;
  const card = (body?.querySelector(".hero-card") ?? body) as HTMLElement | null;
  if (!card) return { present: false };
  const R = (e: Element | null) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; };
  const vis = (e: Element) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  // The picture: the largest visible img/canvas in the card.
  const pics = ([...card.querySelectorAll("img, canvas")] as HTMLElement[]).filter(vis).sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return rb.width * rb.height - ra.width * ra.height; });
  const pic = pics[0] ?? null;
  const plate = pic?.parentElement ?? null;
  const tabId = (document.querySelector("#hero-tabs .is-on") as HTMLElement | null)?.dataset.heroTab ?? null;
  // Name: deepest element whose text is exactly the hero's name (the selected tab's <strong>).
  const heroName = (document.querySelector("#hero-tabs .is-on strong") as HTMLElement | null)?.textContent?.trim() ?? "";
  const nameEls = ([...card.querySelectorAll("*")] as HTMLElement[]).filter((e) => vis(e) && (e.textContent ?? "").trim() === heroName && ![...e.children].some((c) => (c.textContent ?? "").trim() === heroName));
  const nameEl = nameEls[0] ?? null;
  nameEl?.setAttribute("data-vz-name", "");
  // Badge.
  const badge = (card.querySelector(".lv-badge") ?? card.querySelector(".level-badge")) as HTMLElement | null;
  badge?.setAttribute("data-vz-badge", "");
  const lvLabel = badge?.querySelector(".lv-label") ?? null, lvNum = badge?.querySelector(".lv-num") ?? badge?.querySelector(".level-badge-num") ?? null;
  // Roll button.
  const roll = (body?.querySelector("[data-hero-reroll]") ?? [...(body?.querySelectorAll("button") ?? [])].find((b) => /^(Roll|Reroll hero)$/.test((b.textContent ?? "").trim())) ?? null) as HTMLElement | null;
  roll?.setAttribute("data-vz-roll", "");
  const rs = roll ? getComputedStyle(roll) : null;
  const icon = roll?.querySelector("svg") ?? null;
  // Stat rows (C-SHEET).
  const rows = ([...card.querySelectorAll(".zs-row")] as HTMLElement[]).map((r) => ({
    key: r.dataset.key ?? "", group: r.dataset.group ?? "", label: r.querySelector(".zs-label")?.textContent?.trim() ?? "",
    value: r.querySelector(".zs-value")?.textContent?.trim() ?? "", delta: r.querySelector(".zs-delta")?.textContent?.trim() ?? "",
    tone: (r.querySelector(".zs-delta") as HTMLElement | null)?.dataset.tone ?? null, colour: r.querySelector(".zs-delta") ? getComputedStyle(r.querySelector(".zs-delta")!).color : null,
    visible: vis(r),
  }));
  return {
    present: true, tabId, heroName, card: R(card), pic: R(pic), picTag: pic?.tagName.toLowerCase() ?? null, plate: R(plate), plateClass: plate ? String(plate.className) : null,
    name: R(nameEl), nameTag: nameEl ? `${nameEl.tagName.toLowerCase()}.${nameEl.className}` : null,
    badge: badge ? { ...R(badge)!, tier: badge.dataset.tier ?? null, cls: badge.className, text: (badge.textContent ?? "").replace(/\s+/g, " ").trim(), label: lvLabel?.textContent?.trim() ?? null, num: lvNum?.textContent?.trim() ?? null, labelBox: R(lvLabel), numBox: R(lvNum) } : null,
    roll: roll ? { ...R(roll)!, label: (roll.textContent ?? "").trim(), padding: [rs!.paddingTop, rs!.paddingRight, rs!.paddingBottom, rs!.paddingLeft].map(parseFloat), margin: [rs!.marginTop, rs!.marginRight, rs!.marginBottom, rs!.marginLeft].map(parseFloat), cls: roll.className, bgImage: rs!.backgroundImage.slice(0, 160), icon: R(icon) } : null,
    rows,
  };
};

/** Tag candidates over the picture: leaf texts in the card naming the race / class / sign (not stat rows, not buttons). */
const tagMeter = (words: string[]) => {
  const card = (document.querySelector("#profiles-body .hero-card") ?? document.querySelector("#profiles-body")) as HTMLElement | null;
  if (!card) return [];
  document.querySelectorAll("[data-vz-tag]").forEach((e) => e.removeAttribute("data-vz-tag"));
  const vis = (e: Element) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const out: any[] = [];
  let i = 0;
  for (const e of [...card.querySelectorAll<HTMLElement>("*")]) {
    if (!vis(e) || e.closest(".zs-row, button, .zs-group, svg, [data-vz-name]")) continue;
    const own = [...e.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent ?? "").join(" ").trim();
    if (!own) continue;
    const lw = own.toLowerCase();
    if (!words.some((w) => w && lw.includes(w.toLowerCase()))) continue;
    e.setAttribute("data-vz-tag", String(i));
    const r = e.getBoundingClientRect();
    out.push({ i, text: own.slice(0, 40), x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom, cls: String(e.className) });
    i++;
  }
  return out;
};

const inside = (a: any, b: any, tol = 1) => !!a && !!b && a.x >= b.x - tol && a.y >= b.y - tol && a.r <= b.r + tol && a.b <= b.b + tol;

// ── The browser run ─────────────────────────────────────────────────────────────────────────────────
const VIEWPORTS: [string, number, number][] = [["320", 320, 640], ["390", 390, 844], ["820", 820, 1180], ["1280", 1280, 800], ["1920", 1920, 1080], ["2560", 2560, 1440], ["844x390", 844, 390]];
const PHONE = new Set(["320", "390", "844x390"]);

async function measure(label: string, dist: string) {
  const OUT = `${ROOT}/${label}`;
  await Deno.mkdir(OUT, { recursive: true });
  const json = seededProfilesJson();
  const entries = seededEntries(json);
  const byId = Object.fromEntries(entries.map((e) => [e.profile.playerId, e]));
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (r) => serveAsset(r, dist));
  const PORT = (server.addr as Deno.NetAddr).port;
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
  const errors: string[] = [];
  const report: any = { label, dist, at: new Date().toISOString(), seeded: entries.map((e) => ({ id: e.profile.playerId, name: e.character.name, level: e.level, race: e.character.race, sub: e.character.subrace, cls: e.character.className })), vp: {} };
  for (const [vp, w, h] of VIEWPORTS) {
    const touch = PHONE.has(vp) || w <= 820;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: vp === "320" || vp === "390" });
    await ctx.addInitScript((j) => { if (!sessionStorage.getItem("vz-seeded")) { localStorage.clear(); localStorage.setItem("mytherrania-profiles-v1", j); sessionStorage.setItem("vz-seeded", "1"); } }, json);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${vp}: ${String(e)}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${vp} console: ${m.text().slice(0, 200)}`); });
    const r: any = {};
    report.vp[vp] = r;
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
    await page.waitForTimeout(500);
    const t0 = Date.now();
    await page.evaluate(() => (document.querySelector('[data-action="start"]') as HTMLElement).click());
    await page.waitForFunction(() => !!document.querySelector("#profiles-body img, #profiles-body .hero-card"), null, { timeout: 120000 });
    r.openMs = Date.now() - t0;
    await page.waitForTimeout(800);
    // ── Hero tab ──
    r.hero = { layout: await page.evaluate(layoutMeter), card: await page.evaluate(cardMeter) };
    await page.screenshot({ path: `${OUT}/hero-${vp}.png` });
    await page.screenshot({ path: `${OUT}/hero-${vp}-full.png`, fullPage: true });
    const c = r.hero.card;
    const ent = c.tabId ? byId[c.tabId] : null;
    r.hero.entry = ent ? { id: ent.profile.playerId, level: ent.level, name: ent.character.name } : null;
    if (c.present) {
      // Overlay: name + tags inside the picture; contrast on the pixels.
      const words = ent ? [ent.character.className, ent.character.race, ent.character.subrace ?? "", ent.character.birthsign ?? ""].filter((x) => x && x.length > 2) : [];
      const tags = await page.evaluate(tagMeter, words);
      r.hero.overlay = {
        picCoversPlate: c.pic && c.plate ? +((c.pic.w * c.pic.h) / (c.plate.w * c.plate.h)).toFixed(3) : null,
        picVsCard: c.pic && c.card ? +((c.pic.w * c.pic.h) / (c.card.w * c.card.h)).toFixed(3) : null,
        nameInside: inside(c.name, c.pic), tags: tags.map((t: any) => ({ text: t.text, cls: t.cls, inside: inside(t, c.pic) })),
        tagsInside: tags.length ? tags.filter((t: any) => inside(t, c.pic)).length : 0, nTags: tags.length,
        contrast: {} as Record<string, any>,
      };
      if (c.name) {
        r.hero.overlay.contrast.name = { eff: await textContrast(page, "[data-vz-name]", true), bare: await textContrast(page, "[data-vz-name]", false) };
      }
      for (const t of tags.slice(0, 4)) {
        r.hero.overlay.contrast[`tag${t.i}:${t.text.slice(0, 16)}`] = { eff: await textContrast(page, `[data-vz-tag="${t.i}"]`, true), bare: await textContrast(page, `[data-vz-tag="${t.i}"]`, false) };
      }
      // Roll: purple face (glyphs + icon hidden), icon box.
      if (c.roll) {
        await page.evaluate(() => { const b = document.querySelector("[data-vz-roll]") as HTMLElement; b.scrollIntoView({ block: "center" }); for (const k of [b, ...b.querySelectorAll<HTMLElement>("*")]) { (k as any).__vv = k.style.visibility; } b.querySelectorAll<HTMLElement>("*").forEach((k) => { k.style.visibility = "hidden"; }); b.style.color = "transparent"; b.style.textShadow = "none"; });
        const rr = await page.evaluate(() => { const x = document.querySelector("[data-vz-roll]")!.getBoundingClientRect(); return { x: x.left, y: x.top, w: x.width, h: x.height }; });
        // Inset 3 px so the frame/border does not dominate.
        const st = await regionStats(page, { x: rr.x + 3, y: rr.y + 3, width: rr.w - 6, height: rr.h - 6 });
        r.hero.rollFace = { hue: st.hue, sat: +st.sat.toFixed(3), satShare: +st.satShare.toFixed(3), rgb: st.rgb };
        await page.evaluate(() => { const b = document.querySelector("[data-vz-roll]") as HTMLElement; b.querySelectorAll<HTMLElement>("*").forEach((k) => { k.style.visibility = (k as any).__vv ?? ""; }); b.style.color = ""; b.style.textShadow = ""; });
        await page.locator("[data-vz-roll]").screenshot({ path: `${OUT}/roll-${vp}.png` }).catch(() => {});
      }
      if (c.badge) {
        await page.locator("[data-vz-badge]").screenshot({ path: `${OUT}/badge-${vp}.png` }).catch(() => {});
      }
    }
    // Level tiers: every seeded hero, at 1280 only (one click per tab).
    if (vp === "1280") {
      const tiers: any[] = [];
      for (const e of entries) {
        const tab = page.locator(`[data-hero-tab="${e.profile.playerId}"]`).first();
        if (!(await tab.count())) { tiers.push({ level: e.level, missingTab: true }); continue; }
        await page.evaluate((id) => (document.querySelector(`[data-hero-tab="${id}"]`) as HTMLElement).click(), e.profile.playerId);
        await page.waitForTimeout(600);
        const cm: any = await page.evaluate(cardMeter);
        let face: any = null;
        if (cm.badge) {
          await page.evaluate(() => { const b = document.querySelector("[data-vz-badge]") as HTMLElement; b.scrollIntoView({ block: "center" }); b.querySelectorAll<HTMLElement>("*").forEach((k) => { k.style.visibility = "hidden"; }); b.style.color = "transparent"; });
          const bb = await page.evaluate(() => { const x = document.querySelector("[data-vz-badge]")!.getBoundingClientRect(); return { x: x.left, y: x.top, w: x.width, h: x.height }; });
          const st = await regionStats(page, { x: bb.x + 2, y: bb.y + 2, width: bb.w - 4, height: bb.h - 4 });
          face = { rgb: st.rgb, hue: st.hue, sat: +st.sat.toFixed(3), lum: +st.lum.toFixed(3) };
          await page.evaluate(() => { const b = document.querySelector("[data-vz-badge]") as HTMLElement; b.querySelectorAll<HTMLElement>("*").forEach((k) => { k.style.visibility = ""; }); b.style.color = ""; });
          await page.locator("[data-vz-badge]").screenshot({ path: `${OUT}/tier-lv${e.level}.png` }).catch(() => {});
        }
        tiers.push({ level: e.level, expected: EXPECTED_TIER(e.level), tier: cm.badge?.tier ?? null, num: cm.badge?.num ?? null, label: cm.badge?.label ?? null, text: cm.badge?.text ?? null, face });
      }
      r.tiers = tiers;
      // Back to the first hero.
      await page.evaluate((id) => (document.querySelector(`[data-hero-tab="${id}"]`) as HTMLElement).click(), entries[0].profile.playerId);
      await page.waitForTimeout(400);
    }
    // ── + New (the generator) ──
    const nw = page.locator('[data-hero-tab="new"]').first();
    if (await nw.count()) {
      await page.evaluate(() => (document.querySelector('[data-hero-tab="new"]') as HTMLElement).click());
      await page.waitForTimeout(2000);
      r.gen = { layout: await page.evaluate(layoutMeter) };
      await page.screenshot({ path: `${OUT}/new-${vp}.png` });
      // Viewer: the Creator preview.
      r.gen.viewer = await viewerMeter(page);
      await page.locator("#creator-preview").screenshot({ path: `${OUT}/viewer-${vp}.png` }).catch(() => {});
      // G is judged on a NORMALISED box (3:4, fully on screen) so lane F's stage layout cannot hide or fake the floor.
      await page.evaluate(() => {
        const cv = document.querySelector("#creator-preview") as HTMLElement | null;
        const plate = (cv?.closest(".stage-plate") ?? cv?.parentElement) as HTMLElement | null;
        if (!cv || !plate) return;
        const w = Math.min(plate.getBoundingClientRect().width, innerHeight * 0.9 * 0.75);
        Object.assign(plate.style, { width: `${w}px`, height: `${w * 4 / 3}px`, maxHeight: "none", minHeight: "0", flex: "none", alignSelf: "flex-start" });
      });
      await page.waitForTimeout(700);
      r.gen.viewerNorm = await viewerMeter(page);
      await page.locator("#creator-preview").screenshot({ path: `${OUT}/viewer-norm-${vp}.png` }).catch(() => {});
    }
    await ctx.close();
  }
  report.errors = errors;
  await browser.close();
  await server.shutdown();
  // Deno side: the sheet recompute (needs the selected hero at 1280).
  report.stats = await statsCheck(report, entries);
  await Deno.writeTextFile(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  const claims = judge(report);
  await Deno.writeTextFile(`${OUT}/claims.json`, JSON.stringify(claims, null, 1));
  for (const cl of claims) console.log(`${cl.result.padEnd(4)} ${cl.lane} ${cl.id.padEnd(22)} ${cl.evidence}`);
  console.log(`page errors: ${errors.length}${errors.length ? " — " + errors.slice(0, 3).join(" | ") : ""}`);
}

async function viewerMeter(page: Page) {
  const has = await page.evaluate(() => !!(globalThis as any).__MYTHERRANIA_PREVIEW__);
  if (!has) return { hook: false };
  await page.evaluate(() => document.querySelector("#creator-preview")?.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
  const probe: any = await page.evaluate(() => {
    const pv = (globalThis as any).__MYTHERRANIA_PREVIEW__;
    const cv = document.querySelector("#creator-preview") as HTMLCanvasElement;
    const r = cv.getBoundingClientRect();
    const sp = typeof pv.debugShadowProbe === "function" ? pv.debugShadowProbe() : null;
    return { canvas: { x: r.left, y: r.top, w: r.width, h: r.height }, sp, ped: typeof pv.pedestal === "function" ? pv.pedestal() : null };
  });
  if (!probe.sp) return { hook: true, shadowProbe: false, ...probe };
  // Probe points and the pixels are read back to back (the figure turns), three samples, medians.
  const med = (a: number[]) => { const q = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return q.length ? q[q.length >> 1] : null; };
  const sample = async () => {
    // Only points where the canvas itself is on top (a sticky bar or a socket over the plinth is not the floor).
    const sp: any = await page.evaluate(() => {
      const raw = (globalThis as any).__MYTHERRANIA_PREVIEW__.debugShadowProbe();
      const cv = document.querySelector("#creator-preview") as HTMLCanvasElement, r = cv.getBoundingClientRect();
      const seen = (pts: [number, number][]) => pts.filter(([x, y]) => document.elementFromPoint(r.left + x, r.top + y) === cv);
      return { near: seen(raw.near), rim: seen(raw.rim) };
    });
    const st = await regionStats(page, { x: probe.canvas.x, y: probe.canvas.y, width: probe.canvas.w, height: probe.canvas.h });
    const ox = Math.max(0, probe.canvas.x) - probe.canvas.x, oy = Math.max(0, probe.canvas.y) - probe.canvas.y;
    const at = (pts: [number, number][]) => med(pts.map(([x, y]) => { const X = Math.round(x - ox), Y = Math.round(y - oy); return X >= 0 && Y >= 0 && X < st.w && Y < st.h ? st.lums[Y * st.w + X] : NaN; }));
    return { near: at(sp.near), rim: at(sp.rim), nN: sp.near.length, nR: sp.rim.length };
  };
  const lumAt = async () => {
    const ss = [await sample(), await sample(), await sample()];
    return { nN: Math.min(...ss.map((x) => x.nN)), nR: Math.min(...ss.map((x) => x.nR)), near: med(ss.map((x) => x.near ?? NaN)), rim: med(ss.map((x) => x.rim ?? NaN)), ratio: med(ss.map((x) => x.near !== null && x.rim ? x.near / x.rim : NaN)) };
  };
  await page.evaluate(() => (globalThis as any).__MYTHERRANIA_PREVIEW__.debugLighting?.({ cast: true, contact: true }));
  const on = await lumAt();
  await page.evaluate(() => (globalThis as any).__MYTHERRANIA_PREVIEW__.debugLighting?.({ cast: false, contact: false }));
  const off = await lumAt();
  await page.evaluate(() => (globalThis as any).__MYTHERRANIA_PREVIEW__.debugLighting?.({ cast: true, contact: true }));
  return {
    hook: true, shadowProbe: true, canvas: probe.canvas, nearPts: on.nN, rimPts: on.nR, shadowMap: probe.sp.shadowMap, coverage: probe.sp.shadowCoverage, ped: probe.ped,
    nearOn: on.near, rimOn: on.rim, nearOff: off.near, rimOff: off.rim,
    feetVsRim: on.ratio !== null ? +on.ratio.toFixed(3) : null, feetVsRimOff: off.ratio !== null ? +off.ratio.toFixed(3) : null, onVsOff: on.near && off.near ? +(on.near / off.near).toFixed(3) : null,
  };
}

// ── Statistics: DOM vs derivedSheet, and independent recompute of random rows ─────────────────────────
async function statsCheck(report: any, entries: any[]) {
  const out: any = { available: false };
  const spec = new URL("../src/game/DerivedSheet.ts", import.meta.url).href;
  let mod: any;
  try { mod = await import(spec); } catch (e) { out.error = String(e).slice(0, 200); return out; }
  if (typeof mod.derivedSheet !== "function") { out.error = "no derivedSheet export"; return out; }
  out.available = true;
  const r = report.vp["1280"]?.hero;
  const id = r?.card?.tabId;
  const ent = entries.find((e) => e.profile.playerId === id);
  if (!ent) { out.error = `selected hero ${id} not in the seeded set`; return out; }
  const sheet = mod.derivedSheet(ent.character);
  out.attributes = sheet.attributes.length;
  out.derived = sheet.derived.length;
  const domRows: any[] = r.card.rows ?? [];
  out.domRows = domRows.length;
  out.domRowsVisible = domRows.filter((x) => x.visible).length;
  const all = [...sheet.attributes.map((x: any) => ({ ...x, kind: "attr" })), ...sheet.derived.map((x: any) => ({ ...x, kind: "derived" }))];
  // Digits may be grouped in threes with a space ("(+3 369)", STATS.md formatNumber).
  const fmt = /^\((?:\+\d{1,3}(?:[ \u00a0]\d{3})*(?:\.\d{1,2})?|\u2212\d{1,3}(?:[ \u00a0]\d{3})*(?:\.\d{1,2})?|0)\)$/;
  out.mismatch = [] as string[];
  out.badDelta = [] as string[];
  out.missing = [] as string[];
  for (const row of all) {
    const d = domRows.find((x) => x.key === row.key);
    if (!d) { out.missing.push(row.key); continue; }
    if (d.value.replace(/\s+/g, " ") !== `${row.display}${row.unit && !String(row.display).includes(row.unit) ? "" : ""}`.replace(/\s+/g, " ") && !d.value.startsWith(String(row.display))) out.mismatch.push(`${row.key}: dom "${d.value}" vs sheet "${row.display}"`);
    if (d.delta !== row.deltaDisplay) out.mismatch.push(`${row.key}: dom delta "${d.delta}" vs sheet "${row.deltaDisplay}"`);
    if (!fmt.test(d.delta)) out.badDelta.push(`${row.key}: "${d.delta}"`);
    // delta = value - reference, sign agrees with the display.
    // The sign at the DISPLAYED precision (−0.01 shown with 1 dp is "(0)").
    const dp = (/\.(\d+)\)$/.exec(row.deltaDisplay)?.[1].length) ?? (/\.(\d+)/.exec(row.display)?.[1].length ?? 0);
    const shown = Math.round(row.delta * 10 ** dp) / 10 ** dp;
    const sign = shown > 0 ? "+" : shown < 0 ? "\u2212" : "0";
    if (!(sign === "0" ? /^\((0|[+\u2212]0(\.0+)?)\)$/.test(row.deltaDisplay) : row.deltaDisplay.startsWith(`(${sign}`))) out.badDelta.push(`${row.key}: delta ${row.delta} vs "${row.deltaDisplay}"`);
  }
  out.attrWithDelta = sheet.attributes.filter((a: any) => fmt.test(domRows.find((x) => x.key === a.key)?.delta ?? "")).length;
  // Independent recompute (filled once DerivedSheet's references are read; see RECOMPUTE).
  out.recompute = await recompute(ent.character, all);
  out.sample = all.slice(0, 60).map((x: any) => `${x.kind}:${x.key}=${x.display}${x.deltaDisplay}`);
  return out;
}

/**
 * Independent recompute of random rows from the underlying game functions (NOT DerivedSheet). Keys -> a
 * function of the character returning [value, reference]. Filled from the game modules by key once
 * DerivedSheet's row keys are known; rows without a recipe are skipped (not counted).
 */
async function recompute(character: any, rows: any[]) {
  const recipes = await RECIPES();
  const keys = rows.map((r) => r.key).filter((k) => recipes[k]);
  const rng = rng32(7 + rows.length);
  const pick: string[] = [];
  while (pick.length < Math.min(8, keys.length)) { const k = keys[Math.floor(rng() * keys.length)]; if (!pick.includes(k)) pick.push(k); }
  const res: any[] = [];
  for (const k of pick) {
    const row = rows.find((r) => r.key === k);
    const [v, ref] = await recipes[k](character);
    const tolV = Math.max(1e-6, Math.abs(v) * 1e-6);
    res.push({ key: k, sheet: row.value, mine: v, sheetDelta: row.delta, mineDelta: v - ref, ok: Math.abs(row.value - v) <= tolV && Math.abs(row.delta - (v - ref)) <= Math.max(1e-6, Math.abs(v - ref) * 1e-6) });
  }
  return { recipes: Object.keys(recipes).length, picked: res.length, ok: res.filter((x) => x.ok).length, rows: res };
}

/** Per row key: [value, reference] from the underlying game modules (loaded by path so `deno check` never depends on lane files). */
async function RECIPES(): Promise<Record<string, (c: any) => Promise<[number, number]>>> {
  // V's own fight block: the ENGINE's constructor (Fighter.createFighter) + V's copy of Engine.#applyTweaks
  // (read from Engine.ts, not from DerivedSheet) + Stats.applyLevel — the order of Engine.#startFight.
  const block = (p: any) => {
    const f = createFighter(p.className, p.name ?? "", 0, 0, 0.5, p.race ?? "human", p.subrace ?? null, p.weaponType, p.birthsign ?? null);
    const s: any = { ...f.stats };
    const base = startingStats(p.className, p.race, p.subrace ?? null).allocated as Record<string, number>;
    const cur: Record<string, number> = {};
    let any = false;
    for (const k of Object.keys(base)) { const v = p.allocated?.[k]; cur[k] = typeof v === "number" && Number.isFinite(v) ? v : base[k]; if (cur[k] !== base[k]) any = true; }
    if (any) {
      const now: any = statDelta(cur as any), was: any = statDelta(base as any);
      for (const k of Object.keys(now)) if (typeof now[k] === "number" && typeof was[k] === "number") s[k] = (s[k] ?? 0) + (now[k] - was[k]);
      const kh = raceAffinity(p.race, p.subrace ?? null).health;
      s.maxHealth = Math.max(30 * HEALTH_SCALE * kh, Math.min(60 * HEALTH_SCALE * kh, s.maxHealth));
      s.attackPower = Math.max(5 * DAMAGE_SCALE, Math.min(14 * DAMAGE_SCALE, s.attackPower));
      s.armor = Math.max(1, Math.min(8, s.armor));
      s.attackInterval = Math.max(0.5, Math.min(1.5, s.attackInterval));
    }
    // Control (VZ_MUTATE=1): ignore the level — the recompute must then DISAGREE on levelled rows.
    return { s: applyLevel(s, Deno.env.get("VZ_MUTATE") ? 1 : p.level ?? 1) as any, f };
  };
  const engineSrc = await Deno.readTextFile(new URL("../src/engine/Engine.ts", import.meta.url));
  const casters = new Set([...(/CASTER_CLASSES[^=]*=\s*new Set\(\[([^\]]*)\]/.exec(engineSrc)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  // The reference set as S documents it (STATS.md): every class x race, level 1, no sub-race/sign/tweak, class weapon type.
  const refs = CLASSES.flatMap((c) => RACES.map((r) => ({ name: "Reference", race: r.id, subrace: null, className: c, birthsign: null, level: 1, allocated: {}, weaponType: weaponForClass(c).type })));
  const refBlocks = refs.map((p) => ({ p, ...block(p) }));
  const foe: any = {};
  for (const b of refBlocks) for (const [k, v] of Object.entries(b.s)) if (typeof v === "number") foe[k] = (foe[k] ?? 0) + v / refBlocks.length;
  type B = { p: any; s: any; f: any };
  const tempo = (b: B) => b.f.weaponProfile ? b.f.weaponProfile.cooldown / BASELINE_INTERVAL : 1;
  const traits = (b: B) => traitsOf(b.s, b.p.race, b.p.subrace ?? null);
  const res = (b: B) => createResources(b.s, { race: b.p.race, subrace: b.p.subrace ?? null });
  const V: Record<string, (b: B) => number> = {
    maxHealth: (b) => b.s.maxHealth, attackPower: (b) => b.s.attackPower, armor: (b) => b.s.armor, attackInterval: (b) => b.s.attackInterval,
    swingInterval: (b) => b.s.attackInterval * tempo(b), attacksPerSecond: (b) => 1 / (b.s.attackInterval * tempo(b)),
    maxMana: (b) => res(b).mana.max, maxStamina: (b) => res(b).stamina.max, manaRegen: (b) => res(b).mana.regenPerSecond, staminaRegen: (b) => res(b).stamina.regenPerSecond,
    hit: (b) => attackDamage(b.s, foe, 0.5, 0.5), hitTaken: (b) => attackDamage(foe, b.s, 0.5, 0.5),
    critChance: (b) => 100 * criticalChance(b.s.reflex, foe.resilience), critTaken: (b) => 100 * criticalChance(foe.reflex, b.s.resilience),
    woundDealt: (b) => 100 * woundFactor({ vitality: 5, resilience: 5 }, b.s.strength), woundTaken: (b) => 100 * woundFactor(traits(b), 5),
    staminaFatigue: (b) => 100 * fatigueResist(traits(b), "stamina"), manaFatigue: (b) => 100 * fatigueResist(traits(b), "mana"),
    dodge: (b) => 100 * (1 - 1 / dodgeDivisor(b.s)), effectiveAgility: (b) => effectiveAgility(b.s), moveSpeed: (b) => 100 * moveSpeedMul(b.s), turnRate: (b) => 100 * turnRateMul(b.s),
    dash: (b) => 100 * dashMul(b.s), animSpeed: (b) => 100 * agilityOf(b.s).animSpeed, recovery: (b) => 100 * agilityOf(b.s).recovery,
    castTime: (b) => castSeconds({ base: CAST_BASE_BY_KIND.power, focus: castFocus({ focus: b.s.focus ?? 6, intelligence: b.s.intelligence }), hastePct: 0, element: "", heavy: casters.has(b.p.className) }),
    powerTail: (b) => powerTailSeconds(b.s), cooldown: (b) => { const k = skillsForClass(b.p.className); return k.reduce((a, x) => a + x.cooldown, 0) / k.length; },
    mass: (b) => totalMass(bodyFromStats(b.s)), density: (b) => density(bodyFromStats(b.s)), toughness: (b) => toughness(bodyFromStats(b.s)),
    reach: (b) => b.f.weaponProfile?.reach ?? b.f.weapon.reach,
  };
  const out: Record<string, (c: any) => Promise<[number, number]>> = {};
  for (const [k, fn] of Object.entries(V)) {
    let ref: number | null = null;
    out[k] = (c: any) => {
      ref ??= refBlocks.reduce((a, b) => a + fn(b), 0) / refBlocks.length;
      return Promise.resolve([fn({ p: c, ...block(c) }), ref]);
    };
  }
  // Attributes: Leveling class sheet + (fight block − createStats(class)); delta = fight block − createStats(class).
  for (const k of ["vitality", "resilience", "focus", "reflex", "strength", "intelligence", "agility"]) {
    out[k] = (c: any) => {
      const s = block(c).s, cls: any = createStats(c.className);
      const sheet = (startingStats(c.className, "", null).allocated as any)[k];
      const d = (s[k] ?? 0) - (cls[k] ?? 0);
      return Promise.resolve([sheet + d, sheet]);
    };
  }
  return out;
}

// ── Judgement: claims with literal numbers ─────────────────────────────────────────────────────────
interface Claim { id: string; lane: "F" | "S" | "G"; claim: string; method: string; result: "PASS" | "FAIL" | "N/A"; evidence: string }

export function judge(rep: any): Claim[] {
  const C: Claim[] = [];
  const add = (id: string, lane: Claim["lane"], claim: string, method: string, ok: boolean | null, evidence: string) => C.push({ id, lane, claim, method, result: ok === null ? "N/A" : ok ? "PASS" : "FAIL", evidence });
  const vps = Object.keys(rep.vp);
  const per = (f: (v: any, vp: string) => string | null) => vps.map((vp) => f(rep.vp[vp], vp)).filter(Boolean) as string[];
  // Layout (F).
  const ov = per((v, vp) => { const a = v.hero?.layout, b = v.gen?.layout; const n = Math.max(a?.docOverflow ?? 0, b?.docOverflow ?? 0); return n > 0 ? `${vp}:+${n}px` : null; });
  add("Z-layout-overflow", "F", "no horizontal overflow at any width", "documentElement.scrollWidth - innerWidth, hero + New tabs, 7 viewports", ov.length === 0, ov.length ? ov.join(" ") : "0 px at all 7 viewports");
  const cl = per((v, vp) => { const n = (v.hero?.layout.clipped.length ?? 0) + (v.gen?.layout.clipped.length ?? 0); return n ? `${vp}:${n} [${[...(v.hero?.layout.clipped ?? []), ...(v.gen?.layout.clipped ?? [])].slice(0, 2).join("; ")}]` : null; });
  add("Z-layout-clip", "F", "no clipped/spilled text", "text boxes with scrollWidth > clientWidth+1 (or hidden-overflow height)", cl.length === 0, cl.length ? cl.join(" | ") : "0 clipped boxes at all 7 viewports");
  const lp = per((v, vp) => { const n = (v.hero?.layout.overlaps.length ?? 0) + (v.gen?.layout.overlaps.length ?? 0); return n ? `${vp}:${n} [${[...(v.hero?.layout.overlaps ?? []), ...(v.gen?.layout.overlaps ?? [])].slice(0, 2).join("; ")}]` : null; });
  add("Z-layout-overlap", "F", "interactive boxes / badges / name never overlap", "pairwise bbox intersection (>1x1 px) of buttons, tabs, inputs, LV badge, name", lp.length === 0, lp.length ? lp.join(" | ") : "0 overlapping pairs at all 7 viewports");
  const fonts = vps.map((vp) => Math.min(rep.vp[vp].hero?.layout.minFont ?? 99, rep.vp[vp].gen?.layout.minFont ?? 99));
  const wb = per((v, vp) => { const l = [...(v.hero?.layout.wordBreaks ?? []), ...(v.gen?.layout.wordBreaks ?? [])]; return l.length ? `${vp}:${l.length} [${[...new Set(l)].slice(0, 3).join("; ")}]` : null; });
  if (vps.some((vp) => rep.vp[vp].hero?.layout.wordBreaks)) add("Z-layout-wordbreak", "F", "no word broken mid-word across lines", "Range.getClientRects of every word >= 4 letters: more than one line top", wb.length === 0, wb.length ? wb.join(" | ") : "0 broken words at all 7 viewports");
  const bh = per((v, vp) => { const n = (v.hero?.layout.bottomHidden ?? 0) + (v.gen?.layout.bottomHidden ?? 0); return n > 0 ? `${vp}:${n} [${[...(v.hero?.layout.occluded ?? []), ...(v.gen?.layout.occluded ?? [])].slice(0, 2).join("; ")}]` : null; });
  if (vps.some((vp) => rep.vp[vp].hero?.layout.bottomHidden !== undefined)) add("Z-layout-bottom", "F", "scrolled to the end, no content stays under the pinned action bar", "every scroller at its end: leaf texts whose centre hit-tests to a fixed/sticky bar at the viewport bottom", bh.length === 0, bh.length ? bh.join(" ") : "last content clears the bar at all 7 viewports");
  const minF = Math.min(...fonts);
  add("Z-layout-font", "F", "min font size >= 11 px", "min computed font-size of visible text boxes", minF >= 11, vps.map((vp, i) => `${vp}:${fonts[i]}`).join(" "));
  const tt = per((v, vp) => PHONE.has(vp) ? `${vp}:<24=${(v.hero?.layout.small24.length ?? 0) + (v.gen?.layout.small24.length ?? 0)} <44=${(v.hero?.layout.small44 ?? 0) + (v.gen?.layout.small44 ?? 0)}${(v.hero?.layout.small24.length ?? 0) + (v.gen?.layout.small24.length ?? 0) ? ` [${[...(v.hero?.layout.small24 ?? []), ...(v.gen?.layout.small24 ?? [])].slice(0, 3).join("; ")}]` : ""}` : null);
  const t24 = vps.filter((vp) => PHONE.has(vp)).reduce((s, vp) => s + (rep.vp[vp].hero?.layout.small24.length ?? 0) + (rep.vp[vp].gen?.layout.small24.length ?? 0), 0);
  add("Z-layout-touch", "F", "touch targets >= 24 px on phones (WCAG 2.5.8); <44 counted", "min(w,h) of buttons/tabs/inputs at 320, 390, 844x390", t24 === 0, tt.join(" | "));
  const head = per((v, vp) => v.hero?.layout.headPresent ? vp : null);
  add("Z-head-removed", "F", "'Chosen hero — Figure, record, statistics' head deleted", "document.body.innerText search", head.length === 0, head.length ? `present at ${head.join(",")}` : "absent at all 7 viewports");
  // Roll (F).
  const rolls = vps.map((vp) => [vp, rep.vp[vp].hero?.card?.roll, rep.vp[vp].hero?.rollFace] as const);
  const lab = rolls.filter(([, r]) => r?.label !== "Roll").map(([vp, r]) => `${vp}:"${r?.label ?? "none"}"`);
  add("Z-roll-label", "F", "button reads 'Roll'", "textContent of [data-hero-reroll]", lab.length === 0, lab.length ? lab.join(" ") : "\"Roll\" at all 7 viewports");
  const purple = rolls.map(([vp, , f]) => `${vp}:h${f?.hue === null || f?.hue === undefined ? "-" : Math.round(f.hue)}/s${f?.sat ?? "-"}`);
  const isPurple = (f: any) => f && f.hue !== null && f.hue >= 250 && f.hue <= 335 && f.satShare >= 0.3;
  add("Z-roll-purple", "F", "Roll is purple stone", "median hue of saturated face pixels (glyphs hidden, 3 px inset) in 250..335 and >=30% saturated pixels", rolls.every(([, , f]) => isPurple(f)), purple.join(" "));
  const base = rep.baseline?.vp;
  if (base) {
    const icon = rolls.map(([vp, r]) => { const b = base[vp]?.hero?.card?.roll?.icon, a = r?.icon; return [vp, b ? b.w * b.h : null, a ? a.w * a.h : null] as const; });
    add("Z-roll-icon", "F", "bigger icon than before", "svg bbox area vs baseline (HEAD ef4fdf4)", icon.every(([, b, a]) => b !== null && a !== null && a > b), icon.map(([vp, b, a]) => `${vp}:${b === null ? "-" : Math.round(b)}->${a === null ? "-" : Math.round(a)}px²`).join(" "));
    const pad = rolls.map(([vp, r]) => { const b = base[vp]?.hero?.card?.roll; const s = (x: any) => x ? x.padding.reduce((p: number, q: number) => p + q, 0) + x.margin.reduce((p: number, q: number) => p + Math.abs(q), 0) : null; return [vp, s(b), s(r)] as const; });
    add("Z-roll-padding", "F", "smaller padding+margin than before", "sum of computed padding + |margin| vs baseline", pad.every(([, b, a]) => b !== null && a !== null && a < b), pad.map(([vp, b, a]) => `${vp}:${b ?? "-"}->${a ?? "-"}px`).join(" "));
  }
  // LV badge (F).
  const bd = vps.map((vp) => [vp, rep.vp[vp].hero?.card] as const);
  const lvText = bd.filter(([, c]) => !(c?.badge && c.badge.label === "LV" && /^\d+$/.test(c.badge.num ?? "") && c.badge.numBox && c.badge.labelBox && c.badge.numBox.x >= c.badge.labelBox.r - 1));
  add("Z-lv-text", "F", "badge reads 'LV' with the number to its right", ".lv-label text 'LV', .lv-num digits, num.left >= label.right", lvText.length === 0, lvText.length ? lvText.map(([vp, c]) => `${vp}:${c?.badge ? `"${c.badge.text}" label=${c.badge.label}` : "no badge"}`).join(" ") : bd.map(([vp, c]) => `${vp}:"${c.badge.text}"`).slice(0, 2).join(" ") + " ... all 7");
  const tl = bd.map(([vp, c]) => {
    const b = c?.badge, ref = c?.pic ?? c?.card;
    if (!b || !ref) return [vp, false, "no badge/picture"] as const;
    const dx = b.x - ref.x, dy = b.y - ref.y;
    const ok = dx >= -2 && dy >= -2 && b.x + b.w / 2 < ref.x + ref.w * 0.35 && b.y + b.h / 2 < ref.y + ref.h * 0.2;
    return [vp, ok, `${vp}:dx${Math.round(dx)} dy${Math.round(dy)} in ${Math.round(ref.w)}x${Math.round(ref.h)}`] as const;
  });
  add("Z-lv-topleft", "F", "badge in the top-left corner of the card picture", "badge left/top >= picture left/top and centre within the left 35% / top 20% of the picture", tl.every(([, ok]) => ok), tl.map(([, , s]) => s).join(" "));
  const tiers = rep.vp["1280"]?.tiers ?? [];
  const tierBad = tiers.filter((t: any) => t.tier !== t.expected || String(t.num) !== String(t.level));
  add("Z-lv-tier", "F", "tier per level band (1-4 bronze .. 17-20 platinum)", "click each of 10 seeded heroes (levels 1,4,5,8,9,12,13,16,17,20) at 1280; data-tier + number", tiers.length === 10 && tierBad.length === 0, tiers.map((t: any) => `${t.level}:${t.tier ?? "-"}`).join(" "));
  const faces: Record<string, number[]> = {};
  for (const t of tiers) if (t.face && t.expected) faces[t.expected] ??= t.face.rgb;
  const names = Object.keys(faces);
  let minDist = Infinity;
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) { const a = faces[names[i]], b = faces[names[j]]; minDist = Math.min(minDist, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])); }
  add("Z-lv-colours", "F", "the 5 metals look different on pixels", "median RGB of each tier's badge face (glyphs hidden); min pairwise RGB distance >= 20", names.length === 5 && minDist >= 20, `${names.map((n) => `${n}(${faces[n].join(",")})`).join(" ")} minDist ${Number.isFinite(minDist) ? minDist.toFixed(1) : "-"}`);
  // Overlay (F).
  const ovl = bd.map(([vp]) => [vp, rep.vp[vp].hero?.overlay] as const);
  add("Z-pic-full", "F", "picture fills the card plate", "img area / its plate (parent) area >= 0.95; img vs whole card reported", ovl.every(([, o]) => (o?.picCoversPlate ?? 0) >= 0.95), ovl.map(([vp, o]) => `${vp}:${o?.picCoversPlate ?? "-"}/${o?.picVsCard ?? "-"}`).join(" "));
  add("Z-overlay-inside", "F", "name and tags float over the picture", "name bbox and every race/class/sign tag bbox inside the picture bbox", ovl.every(([, o]) => o?.nameInside && o.nTags > 0 && o.tagsInside === o.nTags), ovl.map(([vp, o]) => `${vp}:name ${o?.nameInside ? "in" : "OUT"} tags ${o?.tagsInside ?? 0}/${o?.nTags ?? 0}`).join(" "));
  const con = ovl.map(([vp, o]) => { const cs = Object.entries(o?.contrast ?? {}) as [string, any][]; const worst = cs.reduce((m, [, x]) => Math.min(m, x?.eff?.median ?? 0), cs.length ? Infinity : 0); const p10 = cs.reduce((m, [, x]) => Math.min(m, x?.eff?.p10 ?? 0), cs.length ? Infinity : 0); const bare = cs.reduce((m, [, x]) => Math.min(m, x?.bare?.median ?? 0), cs.length ? Infinity : 0); return [vp, worst, p10, bare] as const; });
  add("Z-overlay-contrast", "F", "name/tags legible on the picture (>= 4.5)", "pixel contrast vs the median backdrop pixel, glyphs hidden (text-shadow kept) >= 4.5; p10 = worst-decile pixel and bare = shadow also hidden (both info)", con.every(([, m]) => m >= 4.5), con.map(([vp, m, p, b]) => `${vp}:med ${m.toFixed(2)} p10 ${p.toFixed(2)} bare ${b.toFixed(2)}`).join(" "));
  // Stats (S + F wiring).
  const st = rep.stats ?? {};
  if (!st.available) add("Z-stats-sheet", "S", "derivedSheet exists", "dynamic import of src/game/DerivedSheet.ts", false, st.error ?? "unavailable");
  else {
    add("Z-stats-attr-delta", "S", "every attribute shows (+n)/(−n)/(0)", "DOM .zs-delta of each sheet.attributes key matches the format", st.attrWithDelta === st.attributes && st.attributes >= 7, `${st.attrWithDelta}/${st.attributes} attributes`);
    add("Z-stats-count", "S", "many derived statistics, each with a delta", "sheet.derived length and DOM rows", st.derived >= 20 && st.badDelta.length === 0, `derived ${st.derived}, DOM rows ${st.domRows} (visible ${st.domRowsVisible}), bad deltas ${st.badDelta.length}${st.badDelta.length ? " [" + st.badDelta.slice(0, 3).join("; ") + "]" : ""}`);
    add("Z-stats-wiring", "F", "the card shows exactly derivedSheet(hero)", "every sheet row's display/deltaDisplay == DOM text (1280, level-20 hero)", st.missing.length === 0 && st.mismatch.length === 0, `missing ${st.missing.length}${st.missing.length ? " [" + st.missing.slice(0, 4).join(",") + "]" : ""}, mismatches ${st.mismatch.length}${st.mismatch.length ? " [" + st.mismatch.slice(0, 2).join("; ") + "]" : ""}`);
    const rc = st.recompute ?? {};
    add("Z-stats-recompute", "S", "values = the game's own functions", ">= 5 random rows recomputed in Deno from the underlying game functions (value and delta)", (rc.picked ?? 0) >= 5 && rc.ok === rc.picked, `${rc.ok ?? 0}/${rc.picked ?? 0} rows agree (recipes ${rc.recipes ?? 0})${(rc.rows ?? []).filter((x: any) => !x.ok).map((x: any) => ` ${x.key}: sheet ${x.sheet}/${x.sheetDelta} mine ${x.mine}/${x.mineDelta}`).join(";")}`);
  }
  // Viewer (G).
  const st3 = vps.map((vp) => [vp, rep.vp[vp].gen?.viewer?.canvas, VIEWPORTS.find((x) => x[0] === vp)![2]] as const).filter(([, c]) => c);
  if (st3.length) add("Z-stage-fit", "F", "+ New stage plate fits the viewport height", "#creator-preview canvas box h <= viewport height (h/w reported; F aims at >= 3:4)", st3.every(([, c, vh]) => c.h <= vh), st3.map(([vp, c, vh]) => `${vp}:${Math.round(c.w)}x${Math.round(c.h)} (h/w ${(c.h / c.w).toFixed(2)}, vh ${vh})`).join(" "));
  const asLaid = vps.map((vp) => [vp, rep.vp[vp].gen?.viewer] as const).filter(([, v]) => v?.shadowProbe);
  if (asLaid.length) add("Z-stage-floor", "F", "+ New: the plinth and the feet are not hidden by the page", "as laid out: >= 8 feet-ring and >= 8 rim points where the canvas is on top (elementFromPoint)", asLaid.every(([, v]) => (v.nearPts ?? 0) >= 8 && (v.rimPts ?? 0) >= 8), asLaid.map(([vp, v]) => `${vp}:${v.nearPts ?? 0}/${v.rimPts ?? 0}`).join(" "));
  // Widths where even the normalised box has the plinth under page chrome (F's pinned bar) are excluded from G's verdict, and listed.
  const vwAll = vps.map((vp) => [vp, rep.vp[vp].gen?.viewerNorm ?? rep.vp[vp].gen?.viewer] as const).filter(([, v]) => v);
  const vw = vwAll.filter(([, v]) => (v.nearPts ?? 0) >= 8);
  const excl = vwAll.filter(([, v]) => (v.nearPts ?? 0) < 8).map(([vp]) => vp);
  const exNote = excl.length ? ` | excluded (plinth under page chrome, F): ${excl.join(",")}` : "";
  add("Z-view-shadow", "G", "shadow under the feet", "Creator preview (box normalised to 3:4 on screen): median luminance on the feet ring (r 0.16-0.32 m) / rim (r 0.5 m) <= 0.85 and lighting on/off <= 0.9", vw.length > 0 && vw.every(([, v]) => v.feetVsRim !== null && v.feetVsRim <= 0.85 && v.onVsOff !== null && v.onVsOff <= 0.9), vw.map(([vp, v]) => `${vp}:feet/rim ${v.feetVsRim ?? "-"} on/off ${v.onVsOff ?? "-"}`).join(" ") + exNote);
  add("Z-view-floor", "G", "a floor under the figure", "pedestal/floor present: >= 8 rim points (r 0.5 m) seen by the camera AND on top in the page, pedestal() radius", vw.length > 0 && vw.every(([, v]) => (v.rimPts ?? 0) >= 8), vw.map(([vp, v]) => `${vp}:rim ${v.rimPts ?? "-"} r=${v.ped?.radiusM ?? "-"}`).join(" ") + exNote);
  if (rep.light) add("Z-view-top-light", "G", "key light from straight above", "angle of PREVIEW_KEY_DIR (and portrait key) from vertical <= 15°", rep.light.every((l: any) => l.deg <= 15), rep.light.map((l: any) => `${l.name}:${l.deg.toFixed(1)}°`).join(" "));
  add("Z-page-errors", "F", "no page errors", "pageerror + console.error across all runs", (rep.errors ?? []).length === 0, `${(rep.errors ?? []).length}${(rep.errors ?? []).length ? " — " + rep.errors.slice(0, 2).join(" | ") : ""}`);
  return C;
}

// ── VERIFY.md ────────────────────────────────────────────────────────────────────────────────────────
async function doc() {
  const read = async (p: string) => { try { return JSON.parse(await Deno.readTextFile(p)); } catch { return null; } };
  const log = (await read(`${ROOT}/log.json`)) ?? { runs: [], posts: [] };
  let latest: any = null;
  let finalClaims: Claim[] = [];
  for (const r of [...log.runs].reverse()) { const c = await read(`${ROOT}/${r.label}/claims.json`); if (c && r.label !== "baseline") { latest = r; finalClaims = c; break; } }
  const baseClaims: Claim[] = (await read(`${ROOT}/baseline/claims.json`)) ?? [];
  const postFor = (lane: string) => log.posts.filter((p: any) => p.lane === lane).map((p: any) => `${p.id} ${p.type}`).join(", ") || "—";
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const lines: string[] = [];
  lines.push("# Wave Z — independent verification (agent V)", "");
  lines.push("Generated by `deno run -A tools/verify-wave-z.ts doc` from `artifacts/wave-z/verify/*/claims.json` — do not edit by hand.", "");
  lines.push(`Verifier: \`tools/verify-wave-z.ts\` (own server on a random port, own seeded heroes: 10 random profiles at levels ${SEED_LEVELS.join(", ")}; the selected hero is level 20). Viewports: ${VIEWPORTS.map(([n, w, h]) => `${n}(${w}x${h})`).join(", ")}. Screenshots: \`artifacts/wave-z/verify/<run>/\`.`, "");
  lines.push(`Latest run: **${latest?.label ?? "none"}** (${latest?.at ?? ""}) — gate: ${latest?.gate ?? "—"}`, "");
  lines.push("| claim | lane | method | result | evidence | board id |", "|---|---|---|---|---|---|");
  for (const c of finalClaims) lines.push(`| ${esc(c.claim)} | ${c.lane} | ${esc(c.method)} | **${c.result}** | ${esc(c.evidence)} | ${postFor(c.lane)} |`);
  lines.push("", "## Baseline (HEAD ef4fdf4, before the lanes) vs latest", "", "| check | baseline | latest |", "|---|---|---|");
  for (const c of finalClaims) { const b = baseClaims.find((x) => x.id === c.id); lines.push(`| ${c.id} | ${b ? `${b.result}: ${esc(b.evidence)}` : "—"} | ${c.result}: ${esc(c.evidence)} |`); }
  lines.push("", "## Open FAILs", "");
  const open = finalClaims.filter((c) => c.result === "FAIL");
  if (!open.length) lines.push("None.");
  for (const c of open) lines.push(`- **${c.lane} ${c.id}** — ${c.claim}: ${c.evidence}`);
  lines.push("", "## Runs and board posts", "", "| run | at | lanes | gate | PASS/FAIL/N/A |", "|---|---|---|---|---|");
  for (const r of log.runs) lines.push(`| ${r.label} | ${r.at} | ${r.lanes ?? ""} | ${esc(r.gate ?? "")} | ${r.tally ?? ""} |`);
  lines.push("", "| board id | to | type | message |", "|---|---|---|---|");
  for (const p of log.posts) lines.push(`| ${p.id} | ${p.lane} | ${p.type} | ${esc(p.msg)} |`);
  if (log.suite) lines.push("", `## Full suite`, "", "```", log.suite, "```");
  if (log.notes?.length) lines.push("", "## Notes on assertion semantics", "", ...log.notes.map((n: string) => `- ${n}`));
  await Deno.writeTextFile("docs/wave-z/VERIFY.md", lines.join("\n") + "\n");
  console.log(`VERIFY.md: ${finalClaims.length} claims, ${open.length} open FAILs`);
}

// ── Light direction (G): angle from vertical of the preview key and any exported portrait key ─────────
async function lightCheck() {
  const out: { name: string; deg: number }[] = [];
  const ang = (v: number[]) => (Math.acos(v[1] / Math.hypot(v[0], v[1], v[2])) * 180) / Math.PI;
  for (const [file, names] of [["../src/graphics/PreviewScene.ts", ["PREVIEW_KEY_DIR"]], ["../src/graphics/PortraitStudio.ts", ["PORTRAIT_KEY_DIR", "KEY_DIR"]]] as const) {
    try {
      const m: any = await import(new URL(file, import.meta.url).href);
      for (const n of names) if (Array.isArray(m[n]) && m[n].length === 3) out.push({ name: n, deg: ang(m[n]) });
    } catch { /* module not importable in Deno */ }
  }
  return out;
}

if (import.meta.main) {
  if (mode === "measure") {
    const label = Deno.args[1] ?? "run";
    const dist = Deno.args[2] ?? "dist-verify";
    await measure(label, dist);
    // Attach the baseline + light check and re-judge.
    const rep = JSON.parse(await Deno.readTextFile(`${ROOT}/${label}/report.json`));
    if (label !== "baseline") { try { rep.baseline = JSON.parse(await Deno.readTextFile(`${ROOT}/baseline/report.json`)); } catch { /* none */ } }
    rep.light = await lightCheck();
    const claims = judge(rep);
    delete rep.baseline;
    await Deno.writeTextFile(`${ROOT}/${label}/report.json`, JSON.stringify(rep, null, 1));
    await Deno.writeTextFile(`${ROOT}/${label}/claims.json`, JSON.stringify(claims, null, 1));
    console.log("── judged with baseline + light ──");
    for (const cl of claims) console.log(`${cl.result.padEnd(4)} ${cl.lane} ${cl.id.padEnd(20)} ${cl.evidence.slice(0, 400)}`);
  } else if (mode === "rejudge") {
    // Re-run the Deno-side checks and the judgement on a stored browser report (assertion fixes only).
    const label = Deno.args[1];
    const rep = JSON.parse(await Deno.readTextFile(`${ROOT}/${label}/report.json`));
    rep.stats = await statsCheck(rep, seededEntries(seededProfilesJson()));
    await Deno.writeTextFile(`${ROOT}/${label}/report.json`, JSON.stringify(rep, null, 1));
    try { rep.baseline = JSON.parse(await Deno.readTextFile(`${ROOT}/baseline/report.json`)); } catch { /* none */ }
    rep.light = rep.light ?? await lightCheck();
    const claims = judge(rep);
    await Deno.writeTextFile(`${ROOT}/${label}/claims.json`, JSON.stringify(claims, null, 1));
    for (const cl of claims) console.log(`${cl.result.padEnd(4)} ${cl.lane} ${cl.id.padEnd(20)} ${cl.evidence.slice(0, 400)}`);
  } else if (mode === "doc") {
    await doc();
  } else if (mode === "stats") {
    // Every seeded hero x every recipe row: derivedSheet (S) vs V's recompute from the engine's own constructor.
    const mod: any = await import(new URL("../src/game/DerivedSheet.ts", import.meta.url).href);
    const recipes = await RECIPES();
    const bad: string[] = [];
    let n = 0;
    for (const e of seededEntries(seededProfilesJson())) {
      const sh = mod.derivedSheet(e.character);
      for (const row of [...sh.attributes, ...sh.derived]) {
        const r = recipes[row.key];
        if (!r) { bad.push(`${e.character.name}: no recipe for ${row.key}`); continue; }
        const [v, ref] = await r(e.character);
        n++;
        const okV = Math.abs(v - row.value) <= Math.max(1e-6, Math.abs(v) * 1e-6), okD = Math.abs((v - ref) - row.delta) <= Math.max(1e-6, Math.abs(v - ref) * 1e-6);
        if (!okV || !okD) bad.push(`${e.character.name} L${e.level} ${row.key}: sheet ${row.value}/${row.delta} V ${v}/${v - ref}`);
      }
    }
    console.log(`stats recompute: ${n} rows checked over ${SEED_LEVELS.length} heroes, ${bad.length} disagreements`);
    for (const b of bad.slice(0, 30)) console.log("  " + b);
    // C-SHEET renderer contract on every seeded hero: rows, groups, delta spans, format, no inline style.
    const ss: any = await import(new URL("../src/ui/StatSheet.ts", import.meta.url).href);
    const fmt = /^\((?:\+[\d\u00a0 ]+(?:\.\d{1,2})?|\u2212[\d\u00a0 ]+(?:\.\d{1,2})?|0)\)$/;
    const issues: string[] = [];
    let rowsSeen = 0, derivedMin = Infinity, attrMin = Infinity;
    for (const e of seededEntries(seededProfilesJson())) {
      const sh = mod.derivedSheet(e.character);
      derivedMin = Math.min(derivedMin, sh.derived.length); attrMin = Math.min(attrMin, sh.attributes.length);
      for (const compact of [false, true]) {
        const html: string = ss.statSheetHtml(sh, { compact });
        if (/\sstyle=/.test(html)) issues.push(`${e.character.name}: inline style=`);
        const rows = [...html.matchAll(/<div class="zs-row"[^>]*data-key="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g)];
        rowsSeen += rows.length;
        if (rows.length !== sh.attributes.length + sh.derived.length) issues.push(`${e.character.name}: ${rows.length} rows vs ${sh.attributes.length + sh.derived.length}`);
        for (const [, key, inner] of rows) {
          const d = /<span class="zs-delta"([^>]*)>([^<]*)<\/span>/.exec(inner);
          if (!d) { issues.push(`${key}: no .zs-delta`); continue; }
          if (!/data-tone="/.test(d[1])) issues.push(`${key}: delta without data-tone`);
          if (!fmt.test(d[2].replace(/&#8722;|&minus;/g, "\u2212"))) issues.push(`${key}: delta "${d[2]}"`);
          if (!/class="zs-label"/.test(inner) || !/class="zs-value"/.test(inner)) issues.push(`${key}: label/value span missing`);
        }
        const groups = [...html.matchAll(/<section class="zs-group[^"]*"[^>]*data-group="([^"]+)"/g)].map((m) => m[1]);
        if (groups.length < 6) issues.push(`${e.character.name}: ${groups.length} groups`);
      }
    }
    console.log(`StatSheet: ${rowsSeen} rendered rows (2 modes x ${SEED_LEVELS.length} heroes), attributes >= ${attrMin}, derived >= ${derivedMin}, ${issues.length} contract issues`);
    for (const b of issues.slice(0, 20)) console.log("  " + b);
    await Deno.writeTextFile(`${ROOT}/stats-${Deno.args[1] ?? "run"}.json`, JSON.stringify({ rows: n, disagreements: bad, rendered: rowsSeen, attrMin, derivedMin, issues }, null, 1));
  }
}
