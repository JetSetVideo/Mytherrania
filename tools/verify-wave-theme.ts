// deno-lint-ignore-file no-explicit-any -- QA verifier: reads the page DOM and untyped debug globals.
// Wave THEME, agent Q: an INDEPENDENT verifier of lanes T (identity theme) and V (viewer controls + axis gizmo).
// It does not reuse the lanes' probes. Real Chrome, six viewports (320x568, 390x844, 820x1180, 1280x800,
// 1920x1080, 844x390 landscape phone).
//
//   BUILD_OUT=dist-qtheme deno task build
//   deno run -A tools/verify-wave-theme.ts --dist dist-qtheme --tree . --tag <tag>   [--vps 1280,390] [--only theme|viewer]
//   deno run -A tools/verify-wave-theme.ts --doc        (docs/wave-theme/VERIFY.md from the JSON reports + vision.json)
//
// Output: artifacts/wave-theme/verify/<tag>/report.json, crops, contact sheets (sheet-races*.png).
//
// THEME (lane T), per viewport, on the + New plate (`.stage-plate`, `#creator-float`), driven by the + New controls
// (JS click on .subrace-chip / tr.pick-row[data-class|data-weapon|data-birthsign], which works inside closed groups):
//   plaque      the first element from `.hero-name` up to the plate with a non-`none` background-image; its computed
//               background stack per race (colours stripped -> "structure": must differ between the 4 races) and its
//               median PIXEL colour with the text hidden (Lab dE76 between sub-races of one race: min must be >= 10).
//   chips       `.hero-tag[data-tag=class|sign|weapon]` computed background-image/colour/border/colour: one signature
//               per id; distinct count must reach the number of distinct themes Theme.ts itself assigns.
//   contrast    text colour vs the median pixel under the box with the glyphs hidden (>= 4.5).
//   relation    `[data-relation]` values shown on the plate for Archer + bow (must read "synchronous" and equal
//               Theme.relation) and for a pair Theme.relation calls "opposite" (must read "opposite").
//   fit         overflow past the viewport, leaf text clipped, text < 11 px, plate children outside the plate,
//               the plaque title's glyph-bbox centre vs its content-box centre (|dx| <= 3 px when text-align:center).
// VIEWER (lane V), per viewport, on `#creator-preview`:
//   cursor      computed cursor of elementFromPoint at the chest (world (0, 0.62 h, 0) projected with Q's own camera)
//               must be grab; drag (mouse, touch on touch contexts) must change yaw (> 0.1 rad).
//   zoom        CDP mouseWheel (deltaY -240) and ctrl+wheel (pinch, deltaY -60) at a shoulder point: distance must fall;
//               the fixed point of the zoom is ESTIMATED from the before/after canvas pixels (scale + centre search) and
//               must lie within 14 css px of the cursor, and closer than the canvas centre hypothesis; the page's
//               scroll (window + scrollable ancestors) must not move. A wheel off the model must scroll the page
//               (when the page can scroll at all; else "n/a").
//   reset       dblclick on the model returns yaw/pitch/distance to the load-time view (+-0.02).
//   pinch       touch contexts: two-finger CDP spread -> distance falls.
//   gizmo       debugGizmo()/DOM `[class*=gizmo]`: centre in the viewer's top-right quadrant; X red, Y yellow, Z green
//               classified from screenshot pixels at each axis end; labels X/Y/Z; clicking each end snaps the camera
//               onto that axis (|dir . axis| > 0.95), one sign convention for all ends.
//   errors      page errors + console errors (incl. CSP) = 0.
// @deno-types="@types/three"
import * as THREE from "three";
import { chromium, type BrowserContext, type Page } from "playwright";
import { encodeBase64 } from "@std/encoding/base64";
import { serveAsset } from "./serve.ts";

const args = Deno.args;
const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const ROOT = "artifacts/wave-theme/verify";

if (args.includes("--doc")) {
  await writeDoc();
  Deno.exit(0);
}

const DIST = opt("--dist", "dist-qtheme");
const TREE = Deno.realPathSync(opt("--tree", "."));
const TAG = opt("--tag", "run");
const ONLY = opt("--only", "all");
const OUT = `${ROOT}/${TAG}`;
await Deno.mkdir(OUT, { recursive: true });
const ALL_VPS: [string, number, number][] = [["320", 320, 568], ["390", 390, 844], ["820", 820, 1180], ["1280", 1280, 800], ["1920", 1920, 1080], ["844x390", 844, 390]];
const VSEL = opt("--vps", "").split(",").filter(Boolean);
const VIEWPORTS = ALL_VPS.filter(([n]) => VSEL.length === 0 || VSEL.includes(n));

// ── the tree's own data (feature-detected: HEAD has no Theme.ts) ─────────────────────────────────────────────
const races: any = await import(`file://${TREE}/src/game/Races.ts`);
const stats: any = await import(`file://${TREE}/src/game/Stats.ts`);
const signs: any = await import(`file://${TREE}/src/game/Birthsight.ts`);
const arch: any = await import(`file://${TREE}/src/game/weapons/Archetypes.ts`);
const theme: any = await import(`file://${TREE}/src/ui/Theme.ts`).catch(() => null);
const RACE_SUBS: [string, string[]][] = races.RACES.map((r: any) => [r.id, (r.subspecies ?? r.subraces).map((s: any) => s.id)]);
const CLASS_IDS: string[] = [...stats.CLASSES];
const SIGN_IDS: string[] = signs.BIRTHSIGNS.map((s: any) => s.id);
const WEAPON_IDS: string[] = [...arch.ARCHETYPE_IDS];
const themeKey = (o: unknown) => JSON.stringify(o);
const expectDistinct = {
  class: theme?.classTheme ? new Set(CLASS_IDS.map((c) => themeKey(theme.classTheme(c)))).size : CLASS_IDS.length,
  sign: theme?.signTheme ? new Set(SIGN_IDS.map((c) => themeKey(theme.signTheme(c)))).size : SIGN_IDS.length,
  weapon: theme?.weaponTheme ? new Set(WEAPON_IDS.map((c) => themeKey(theme.weaponTheme(c)))).size : WEAPON_IDS.length,
};
// An "opposite" pair from T's own function (class x weapon), Archer first.
let oppositePair: [string, string] = ["Mage", "greataxe"];
if (theme?.relation) {
  outer: for (const c of ["Archer", ...CLASS_IDS]) for (const w of WEAPON_IDS) if (theme.relation("class-weapon", c, w) === "opposite") { oppositePair = [c, w]; break outer; }
}
const relFn = (a: string, b: string) => theme?.relation ? theme.relation("class-weapon", a, b) : null;

// ── colour helpers ───────────────────────────────────────────────────────────────────────────────────────────
const parseRgb = (s: string): number[] | null => { const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(s); return m ? [+m[1], +m[2], +m[3]] : null; };
const lin = (x: number) => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const relLum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const contrast = (a: number[], b: number[]) => { const la = relLum(a), lb = relLum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
function lab(c: number[]): number[] {
  const [r, g, b] = c.map(lin);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, y = 0.2126 * r + 0.7152 * g + 0.0722 * b, z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const dE = (a: number[], b: number[]) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
function hue(c: number[]): { h: number; s: number; v: number } {
  const [r, g, b] = c.map((x) => x / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: mx ? d / mx : 0, v: mx };
}
const hueName = (h: number) => (h < 22 || h >= 335) ? "red" : (h >= 38 && h < 72) ? "yellow" : (h >= 78 && h < 170) ? "green" : (h >= 170 && h < 260) ? "blue" : "other";
const r1 = (v: number) => Math.round(v * 10) / 10, r2 = (v: number) => Math.round(v * 100) / 100, r3 = (v: number) => Math.round(v * 1000) / 1000;
const structure = (bg: string) => bg.replace(/rgba?\([^)]*\)/g, "C").replace(/#[0-9a-f]{3,8}/gi, "C").replace(/\s+/g, " ");

// ── server + browser ─────────────────────────────────────────────────────────────────────────────────────────
const server = Deno.serve({ hostname: "127.0.0.1", port: Number(opt("--port", "8841")), onListen() {} }, (r) => serveAsset(r, DIST));
const PORT = (server.addr as Deno.NetAddr).port;
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });

const checks: { lane: "T" | "V"; vp: string; id: string; pass: boolean | null; value: unknown; need: string }[] = [];
const check = (lane: "T" | "V", vp: string, id: string, pass: boolean | null, value: unknown, need: string) => { checks.push({ lane, vp, id, pass, value, need }); };
const errors: string[] = [];
const report: any = { tag: TAG, dist: DIST, tree: TREE, generated: new Date().toISOString(), themeModule: !!theme, expectDistinct, oppositePair, relationModel: { archerBow: relFn("Archer", "bow"), opposite: relFn(...oppositePair) }, viewports: {} };

/** Decode a PNG in the page (data: URL is CSP-legal) and return RGBA + size. */
async function decodePng(page: Page, png: Uint8Array): Promise<{ w: number; h: number; d: number[] }> {
  return await page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d")!; g.drawImage(img, 0, 0);
    return { w: c.width, h: c.height, d: Array.from(g.getImageData(0, 0, c.width, c.height).data) };
  }, encodeBase64(new Uint8Array(png)));
}
/** Median (by luminance) colour of a page region; `hide` elements are made visibility:hidden during the shot. */
async function medianUnder(page: Page, box: { x: number; y: number; w: number; h: number }, hideSel: string[]): Promise<number[] | null> {
  const vp = page.viewportSize()!;
  const x = Math.max(0, box.x), y = Math.max(0, box.y), w = Math.min(box.w, vp.width - x), h = Math.min(box.h, vp.height - y);
  if (w < 2 || h < 2) return null;
  await page.evaluate((s) => { for (const sel of s) document.querySelectorAll<HTMLElement>(sel).forEach((e) => { e.dataset.qHide = e.style.visibility; e.style.visibility = "hidden"; }); }, hideSel);
  const png = new Uint8Array(await page.screenshot({ clip: { x, y, width: w, height: h } }));
  await page.evaluate((s) => { for (const sel of s) document.querySelectorAll<HTMLElement>(sel).forEach((e) => { e.style.visibility = e.dataset.qHide ?? ""; delete e.dataset.qHide; }); }, hideSel);
  const im = await decodePng(page, png);
  const px: number[][] = [];
  for (let k = 0; k < im.d.length; k += 4) px.push([im.d[k], im.d[k + 1], im.d[k + 2]]);
  px.sort((a, b) => relLum(a) - relLum(b));
  return px[px.length >> 1];
}

async function openCreator(ctx: BrowserContext, vp: string): Promise<Page> {
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(`${TAG} ${vp}: pageerror ${String(e).slice(0, 200)}`));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP ${e.violatedDirective}: ${(e.target as Element)?.outerHTML?.slice(0, 100) ?? "?"}`)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${TAG} ${vp}: console ${m.text().slice(0, 200)}`); });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => (document.querySelector('[data-action="start"]') as HTMLElement).click());
  await page.waitForTimeout(600);
  await page.evaluate(() => (document.querySelector('[data-hero-tab="new"]') as HTMLElement | null)?.click());
  await page.waitForFunction(() => !!(globalThis as any).__MYTHERRANIA_PREVIEW__?.builtKey, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  return page;
}

// ── THEME ────────────────────────────────────────────────────────────────────────────────────────────────────
const readPlate = () => {
  const plate = document.querySelector(".stage-plate") as HTMLElement | null;
  const name = document.querySelector("#creator-float .hero-name") as HTMLElement | null;
  if (!plate || !name) return null;
  let plaque: HTMLElement | null = document.querySelector("#creator-float .th-plaque") ?? name;
  while (plaque && plaque !== plate.parentElement && !plaque.classList.contains("th-plaque")) {
    const cs = getComputedStyle(plaque);
    if (cs.backgroundImage !== "none" || (cs.backgroundColor !== "rgba(0, 0, 0, 0)" && plaque !== plate)) break;
    plaque = plaque.parentElement;
  }
  const vars: Record<string, string> = {};
  for (let e: HTMLElement | null = name; e; e = e.parentElement) {
    for (const k of Array.from(e.style)) if (k.startsWith("--th-") && !(k in vars)) vars[k] = e.style.getPropertyValue(k).trim();
    const cs = getComputedStyle(e);
    for (let i = 0; i < cs.length; i++) { const k = cs[i]; if (k.startsWith("--th-") && !(k in vars)) vars[k] = cs.getPropertyValue(k).trim(); }
  }
  const box = (e: Element) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const sty = (e: Element) => { const s = getComputedStyle(e); return { bgImage: s.backgroundImage, bgColor: s.backgroundColor, border: s.borderTopColor + " " + s.borderImageSource, color: s.color, shadow: s.boxShadow }; };
  const data = (e: Element) => Object.fromEntries(Array.from((e as HTMLElement).attributes).filter((a) => a.name.startsWith("data-")).map((a) => [a.name, a.value]));
  const chips: Record<string, any> = {};
  for (const c of document.querySelectorAll("#creator-float .hero-tag")) {
    const k = (c as HTMLElement).dataset.tag!;
    chips[k] = { style: sty(c), box: box(c), data: data(c), text: (c.textContent ?? "").trim(), textColor: getComputedStyle((c.querySelector("span") ?? c) as Element).color };
  }
  const rel = [...plate.parentElement!.querySelectorAll("[data-relation]")].filter((e) => (e as HTMLElement).getBoundingClientRect().width > 0)
    .map((e) => ({ el: e.tagName.toLowerCase() + "." + [...e.classList].join("."), tag: (e as HTMLElement).dataset.tag ?? null, value: (e as HTMLElement).dataset.relation, text: (e.textContent ?? "").trim().slice(0, 40) }));
  return {
    plaque: plaque ? { el: plaque.tagName.toLowerCase() + "." + [...plaque.classList].join("."), id: plaque.id, style: sty(plaque), box: box(plaque), data: data(plaque) } : null,
    name: { text: name.textContent, box: box(name), color: getComputedStyle(name).color, align: getComputedStyle(name).textAlign, font: getComputedStyle(name).fontSize },
    chips, vars, rel, plateData: data(plate), floatData: data(document.getElementById("creator-float")!),
  };
};
/** Title meter: glyph bbox centre vs the content-box centre. */
const titleMeter = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)].filter((e) => e.getBoundingClientRect().width > 0).map((e) => {
  const r = document.createRange(); r.selectNodeContents(e);
  const rects = [...r.getClientRects()].filter((q) => q.width > 0);
  const cs = getComputedStyle(e), b = e.getBoundingClientRect();
  const l = b.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), rt = b.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
  const gl = Math.min(...rects.map((q) => q.left)), gr = Math.max(...rects.map((q) => q.right));
  return { sel, text: (e.textContent ?? "").trim().slice(0, 24), align: cs.textAlign, dx: Math.round(((gl + gr) / 2 - (l + rt) / 2) * 10) / 10, overflowPx: Math.round(Math.max(0, gr - rt, l - gl)) };
});
const auditPage = () => {
  const vw = innerWidth;
  const visible = (e: Element) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05; };
  const label = (e: Element) => { const h = e as HTMLElement; return `${e.tagName.toLowerCase()}${h.id ? "#" + h.id : ""}${h.classList.length ? "." + [...h.classList].slice(0, 2).join(".") : ""}`; };
  const overflow: string[] = [], clipped: string[] = [], tiny: string[] = [], outside: string[] = [];
  const scope = document.querySelector('.menu-screen.active') ?? document.body;
  for (const e of scope.querySelectorAll("*")) {
    if (!visible(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.right > vw + 2 || r.left < -2) overflow.push(`${label(e)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    const h = e as HTMLElement, s = getComputedStyle(h);
    if (h.childElementCount === 0 && (h.textContent ?? "").trim().length > 1) {
      if (h.scrollWidth > h.clientWidth + 2 && s.overflow !== "visible" && h.clientWidth > 0) clipped.push(`${label(e)} "${h.textContent!.trim().slice(0, 30)}"`);
      if (parseFloat(s.fontSize) < 11) tiny.push(`${label(e)} ${s.fontSize}`);
    }
  }
  const plate = document.querySelector(".stage-plate");
  if (plate) {
    const pr = plate.getBoundingClientRect();
    for (const c of document.querySelectorAll("#creator-float *, #creator-float")) {
      if (!visible(c)) continue;
      const r = c.getBoundingClientRect();
      if (r.left < pr.left - 1 || r.right > pr.right + 1 || r.top < pr.top - 1 || r.bottom > pr.bottom + 1) outside.push(label(c));
    }
  }
  return { overflowN: overflow.length, overflow: overflow.slice(0, 5), clippedN: clipped.length, clipped: clipped.slice(0, 5), tinyN: tiny.length, tiny: tiny.slice(0, 5), outsideN: outside.length, outside: outside.slice(0, 5) };
};

async function pick(page: Page, sel: string) {
  const ok = await page.evaluate((s) => { const e = document.querySelector(s) as HTMLElement | null; if (!e) return false; e.click(); return true; }, sel);
  await page.waitForTimeout(220);
  return ok;
}

async function themeRun(page: Page, vp: string, r: any) {
  const big = vp === "1280";
  await page.evaluate(() => document.querySelector(".stage-plate")?.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(150);
  // 1. race x sub-race: plaque structure + pixel palette.
  const sub: any[] = [];
  for (const [race, subs] of RACE_SUBS) for (const s of subs) {
    const ok = await pick(page, `.subrace-chip[data-race="${race}"][data-subrace="${s}"]`);
    await page.evaluate(() => document.querySelector(".stage-plate")?.scrollIntoView({ block: "center" }));
    const p: any = await page.evaluate(readPlate);
    if (!p?.plaque) { sub.push({ race, subrace: s, ok, plaque: null }); continue; }
    const med = await medianUnder(page, p.plaque.box, ["#creator-float .hero-name", "#creator-float .hero-tags", "#creator-float .hero-record"]);
    const nameBack = await medianUnder(page, p.name.box, ["#creator-float .hero-name"]);
    const nc = parseRgb(p.name.color);
    if (big) await page.screenshot({ path: `${OUT}/plaque-${race}-${s}.png`, clip: { x: Math.max(0, p.plaque.box.x), y: Math.max(0, p.plaque.box.y), width: Math.max(4, Math.min(p.plaque.box.w, page.viewportSize()!.width - Math.max(0, p.plaque.box.x))), height: Math.max(4, p.plaque.box.h) } }).catch(() => {});
    sub.push({ race, subrace: s, ok, plaqueEl: p.plaque.el, bg: p.plaque.style.bgImage.slice(0, 400), bgColor: p.plaque.style.bgColor, structure: structure(p.plaque.style.bgImage).slice(0, 300), median: med, nameContrast: nc && nameBack ? r2(contrast(nc, nameBack)) : null, vars: Object.keys(p.vars).length, varSample: Object.fromEntries(Object.entries(p.vars).slice(0, 6)), plaqueData: p.plaque.data, rel: p.rel });
  }
  r.subraces = sub;
  const raceStruct = new Map<string, Set<string>>();
  for (const x of sub) if (x.structure) (raceStruct.get(x.race) ?? raceStruct.set(x.race, new Set()).get(x.race)!).add(x.structure);
  const structsPerRace = [...raceStruct.entries()].map(([race, s]) => ({ race, s: [...s].sort().join("|") }));
  const distinctRaceStructs = new Set(structsPerRace.map((x) => x.s)).size;
  r.raceStructures = { distinct: distinctRaceStructs, perRace: Object.fromEntries(structsPerRace.map((x) => [x.race, x.s.slice(0, 160)])) };
  check("T", vp, "race plaque background stacks differ (4 races)", distinctRaceStructs === 4, `${distinctRaceStructs}/4 distinct structures`, "4/4");
  const within: any[] = [];
  for (const [race] of RACE_SUBS) {
    const xs = sub.filter((x) => x.race === race && x.median);
    let mn = Infinity, pair = "";
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) { const d = dE(xs[i].median, xs[j].median); if (d < mn) { mn = d; pair = `${xs[i].subrace}/${xs[j].subrace}`; } }
    within.push({ race, minDE: r1(mn), pair, medians: Object.fromEntries(xs.map((x) => [x.subrace, `rgb(${x.median.join(",")})`])) });
  }
  r.subracePalette = within;
  const minWithin = Math.min(...within.map((w) => w.minDE));
  check("T", vp, "sub-race plaque palettes distinct (min dE76 on pixels within a race)", minWithin >= 10, `min ${r1(minWithin)} (${within.map((w) => `${w.race} ${w.minDE} ${w.pair}`).join("; ")})`, ">= 10");
  const nameCs = sub.map((x) => x.nameContrast).filter((v) => v !== null);
  check("T", vp, "plaque name contrast on pixels", nameCs.length > 0 && Math.min(...nameCs) >= 4.5, `min ${Math.min(...nameCs)} over ${nameCs.length}`, ">= 4.5");
  // Orks purple: some ork sub-race median hue in 255..320.
  const purple = sub.filter((x) => x.race === "ork" && x.median).map((x) => ({ s: x.subrace, h: Math.round(hue(x.median).h), sat: r2(hue(x.median).s) }));
  r.orkHues = purple;
  check("T", vp, "an ork palette is purple (median hue 255-330, sat >= 0.15)", purple.some((p) => p.h >= 255 && p.h <= 330 && p.sat >= 0.15), JSON.stringify(purple), "one ork sub-race");

  // 2. chips: class / sign / weapon.
  await pick(page, `.subrace-chip[data-race="human"][data-subrace="imperial"]`);
  const chipRun = async (kind: string, ids: string[], selFor: (id: string) => string) => {
    const rows: any[] = [];
    for (const id of ids) {
      await pick(page, selFor(id));
      const p: any = await page.evaluate(readPlate);
      const c = p?.chips?.[kind];
      if (!c) { rows.push({ id, chip: null }); continue; }
      const back = await medianUnder(page, c.box, [`#creator-float .hero-tag[data-tag="${kind}"] > *`]);
      const tc = parseRgb(c.textColor);
      rows.push({ id, text: c.text, sig: JSON.stringify(c.style), data: c.data, contrast: tc && back ? r2(contrast(tc, back)) : null, back });
    }
    const distinct = new Set(rows.filter((x) => x.sig).map((x) => x.sig)).size;
    const cs = rows.map((x) => x.contrast).filter((v) => v !== null) as number[];
    return { rows, distinct, minContrast: cs.length ? Math.min(...cs) : null };
  };
  const cl = await chipRun("class", CLASS_IDS, (id) => `tr.pick-row[data-class="${id}"]`);
  const sg = await chipRun("sign", SIGN_IDS, (id) => `tr.pick-row[data-birthsign="${id}"]`);
  await pick(page, `tr.pick-row[data-class="Warrior"]`);
  const wp = await chipRun("weapon", WEAPON_IDS, (id) => `tr.pick-row[data-weapon="${id}"]`);
  r.chips = { class: cl, sign: sg, weapon: wp };
  for (const [k, v, n] of [["class", cl, expectDistinct.class], ["sign", sg, expectDistinct.sign], ["weapon", wp, expectDistinct.weapon]] as const) {
    check("T", vp, `${k} chip computed style distinct per theme id`, v.distinct >= n && n > 1, `${v.distinct} distinct / ${n} themes (${v.rows.length} ids)`, `>= ${n}`);
    check("T", vp, `${k} chip contrast on pixels`, v.minContrast !== null && v.minContrast >= 4.5, `min ${v.minContrast}`, ">= 4.5");
  }
  // 3. relation shown.
  await pick(page, `tr.pick-row[data-class="Archer"]`);
  await pick(page, `tr.pick-row[data-weapon="bow"]`);
  const relA: any = await page.evaluate(readPlate);
  await pick(page, `tr.pick-row[data-class="${oppositePair[0]}"]`);
  await pick(page, `tr.pick-row[data-weapon="${oppositePair[1]}"]`);
  const relB: any = await page.evaluate(readPlate);
  const vals = (p: any) => [...new Set((p?.rel ?? []).map((x: any) => x.value))];
  r.relation = { archerBow: { shown: vals(relA), els: relA?.rel?.slice(0, 4), model: relFn("Archer", "bow") }, opposite: { pair: oppositePair, shown: vals(relB), els: relB?.rel?.slice(0, 4), model: relFn(...oppositePair) } };
  const onTag = (p: any, tag: string) => (p?.rel ?? []).find((x: any) => x.tag === tag)?.value ?? null;
  check("T", vp, "weapon chip relation Archer+bow = synchronous (= Theme.relation)", onTag(relA, "weapon") === "synchronous" && relFn("Archer", "bow") === "synchronous", `weapon chip ${onTag(relA, "weapon")}, model ${relFn("Archer", "bow")}`, "synchronous");
  check("T", vp, `weapon chip relation ${oppositePair.join("+")} = opposite`, onTag(relB, "weapon") === "opposite" && relFn(...oppositePair) === "opposite", `weapon chip ${onTag(relB, "weapon")}, model ${relFn(...oppositePair)}`, "opposite");
  if (theme?.relation) {
    const lastSign = SIGN_IDS[SIGN_IDS.length - 1];
    const wantClass = theme.relation("race-class", "human", "Archer"), wantSign = theme.relation("class-sign", "Archer", lastSign);
    check("T", vp, "class chip = relation(race-class, human, Archer); sign chip = relation(class-sign, Archer, sign)", onTag(relA, "class") === wantClass && onTag(relA, "sign") === wantSign, `class chip ${onTag(relA, "class")} (model ${wantClass}), sign chip ${onTag(relA, "sign")} (model ${wantSign} for ${lastSign})`, "equal");
  }
  // 4. fit + titles.
  await pick(page, `tr.pick-row[data-class="Archer"]`);
  await pick(page, `tr.pick-row[data-weapon="bow"]`);
  await page.evaluate(() => document.querySelector(".stage-plate")?.scrollIntoView({ block: "center" }));
  r.audit = await page.evaluate(auditPage);
  r.titles = await page.evaluate(titleMeter, "#creator-float .hero-name");
  const titleWorst = Math.max(0, ...r.titles.filter((t: any) => t.align === "center").map((t: any) => Math.abs(t.dx)));
  check("T", vp, "no overflow / clipped / tiny text / outside plate", r.audit.overflowN + r.audit.clippedN + r.audit.tinyN + r.audit.outsideN === 0, `ovf ${r.audit.overflowN} clip ${r.audit.clippedN} tiny ${r.audit.tinyN} outside ${r.audit.outsideN} ${[...r.audit.overflow, ...r.audit.clipped, ...r.audit.tiny, ...r.audit.outside].slice(0, 3).join(" ")}`, "0");
  check("T", vp, "plaque title centred (glyph bbox vs content box)", r.titles.length > 0 && r.titles.every((t: any) => t.align === "center") && titleWorst <= 3 && r.titles.every((t: any) => t.overflowPx === 0), r.titles.map((t: any) => `${t.align} dx ${t.dx} ovf ${t.overflowPx}`).join("; "), "center, |dx| <= 3, ovf 0");
  await page.locator(".stage-plate").screenshot({ path: `${OUT}/plate-${vp}.png` }).catch(() => {});
}

// ── VIEWER ───────────────────────────────────────────────────────────────────────────────────────────────────
const dvRead = () => {
  const pv = (globalThis as any).__MYTHERRANIA_PREVIEW__;
  const f = pv.framing();
  const v = typeof pv.debugView === "function" ? pv.debugView() : null;
  const c = document.getElementById("creator-preview")!.getBoundingClientRect();
  return { hasDebugView: !!v, yaw: v?.yaw ?? f.yaw, pitch: v?.pitch ?? f.pitch, distance: v?.distance ?? f.distanceM, target: v?.target ?? [0, f.targetY, 0], position: v?.position ?? null, fov: v?.fov ?? 38, heightM: f.heightM, raw: v, canvas: { x: c.left, y: c.top, w: c.width, h: c.height } };
};
type DV = ReturnType<typeof dvRead>;
function camOf(v: DV): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(v.fov, v.canvas.w / v.canvas.h, 0.05, 50);
  const t = new THREE.Vector3(...(Array.isArray(v.target) ? v.target : [v.target.x, v.target.y, v.target.z]) as [number, number, number]);
  if (v.position) cam.position.set(...(Array.isArray(v.position) ? v.position : [v.position.x, v.position.y, v.position.z]) as [number, number, number]);
  else { const h = Math.cos(v.pitch) * v.distance; cam.position.set(t.x + Math.sin(v.yaw) * h, Math.max(0.25, t.y + Math.sin(v.pitch) * v.distance), t.z + Math.cos(v.yaw) * h); }
  cam.lookAt(t); cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
  return cam;
}
const toPage = (v: DV, p: THREE.Vector3): [number, number] => { const q = p.clone().project(camOf(v)); return [v.canvas.x + (q.x * 0.5 + 0.5) * v.canvas.w, v.canvas.y + (-q.y * 0.5 + 0.5) * v.canvas.h]; };
const camDir = (v: DV): THREE.Vector3 => { const c = camOf(v); const t = new THREE.Vector3(...(Array.isArray(v.target) ? v.target : [v.target.x, v.target.y, v.target.z]) as [number, number, number]); return c.position.clone().sub(t).normalize(); };
const dv = (page: Page) => page.evaluate(dvRead) as Promise<DV>;
const scrollState = () => {
  const c = document.getElementById("creator-preview")!;
  let s = Math.round(scrollY), room = document.scrollingElement!.scrollHeight - innerHeight;
  for (let e = c.parentElement; e; e = e.parentElement) {
    const o = getComputedStyle(e).overflowY;
    if ((o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight + 1) { s += Math.round(e.scrollTop); room += e.scrollHeight - e.clientHeight; }
  }
  return { sum: s, room };
};
/** Grey canvas image right after a render, downsampled to ~2 css px per sample. */
const grab = () => {
  const pv = (globalThis as any).__MYTHERRANIA_PREVIEW__;
  const c = document.getElementById("creator-preview") as HTMLCanvasElement;
  pv.render(0);
  const k = 2 * (c.width / c.clientWidth);
  const w = Math.floor(c.width / k), h = Math.floor(c.height / k);
  const o = document.createElement("canvas"); o.width = w; o.height = h;
  const g = o.getContext("2d")!; g.drawImage(c, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, out: number[] = new Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return { w, h, g: out, css: 2 };
};
type Img = { w: number; h: number; g: number[]; css: number };
/** Estimate the zoom's fixed point: B(p) ~ A(f + (p - f)/s) over a window around the cursor. */
function fixedPoint(A: Img, B: Img, cur: [number, number], sGuess: number, R = 30) {
  const at = (im: Img, x: number, y: number) => { if (x < 0 || y < 0 || x >= im.w - 1 || y >= im.h - 1) return NaN; const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = y0 * im.w + x0; return im.g[i] * (1 - fx) * (1 - fy) + im.g[i + 1] * fx * (1 - fy) + im.g[i + im.w] * (1 - fx) * fy + im.g[i + im.w + 1] * fx * fy; };
  const cx = cur[0] / A.css, cy = cur[1] / A.css;
  const err = (fx: number, fy: number, s: number) => { let e = 0, n = 0; for (let y = cy - R; y <= cy + R; y += 1) for (let x = cx - R; x <= cx + R; x += 1) { const b = at(B, x, y), a = at(A, fx + (x - fx) / s, fy + (y - fy) / s); if (!isNaN(a) && !isNaN(b)) { e += Math.abs(a - b); n++; } } return n > 50 ? e / n : Infinity; };
  let best = { fx: cx, fy: cy, s: sGuess, e: Infinity };
  for (const s of [0.8, 0.9, 0.95, 1, 1.05, 1.1, 1.2].map((m) => 1 + (sGuess - 1) * m)) for (let dy = -24; dy <= 24; dy += 2) for (let dx = -24; dx <= 24; dx += 2) { const e = err(cx + dx, cy + dy, s); if (e < best.e) best = { fx: cx + dx, fy: cy + dy, s, e }; }
  for (let dy = -2; dy <= 2; dy += 0.5) for (let dx = -2; dx <= 2; dx += 0.5) { const e = err(best.fx + dx, best.fy + dy, best.s); if (e < best.e) best = { ...best, fx: best.fx + dx, fy: best.fy + dy, e }; }
  const centre = err(A.w / 2, A.h / 2, best.s), atCursor = err(cx, cy, best.s), noMove = err(cx, cy, 1);
  return { offsetPx: r1(Math.hypot(best.fx - cx, best.fy - cy) * A.css), scale: r3(best.s), err: r2(best.e), errAtCursor: r2(atCursor), errCentreHyp: r2(centre), errNoZoom: r2(noMove) };
}
async function wheel(page: Page, x: number, y: number, deltaY: number, ctrl: boolean) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY, modifiers: ctrl ? 2 : 0 });
  await page.waitForTimeout(450);
  await cdp.detach();
}

async function viewerRun(page: Page, vp: string, r: any, touch: boolean) {
  let tm = Date.now();
  r.viewerSteps = {};
  const mark = (k: string) => { r.viewerSteps[k] = Date.now() - tm; tm = Date.now(); };
  await page.evaluate(() => document.getElementById("creator-preview")!.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  const v0 = await dv(page);
  r.view0 = { ...v0, raw: undefined, hasDebugView: v0.hasDebugView };
  check("V", vp, "debugView() exposed", v0.hasDebugView, v0.hasDebugView ? Object.keys(v0.raw).join(",") : "missing", "present");
  const chest = () => dv(page).then((v) => toPage(v, new THREE.Vector3(0, 0.62 * v.heightM, 0)));
  const shoulder = () => dv(page).then((v) => toPage(v, new THREE.Vector3(0.1, 0.78 * v.heightM, 0.05)));
  // off-model point: on the canvas itself, away from the centre column and the top corners.
  const off = await page.evaluate(() => {
    const c = document.getElementById("creator-preview")!, b = c.getBoundingClientRect();
    for (const fy of [0.5, 0.4, 0.6, 0.3, 0.7]) for (const fx of [0.1, 0.9, 0.15, 0.85, 0.2, 0.8]) {
      const x = b.left + fx * b.width, y = b.top + fy * b.height, e = document.elementFromPoint(x, y);
      if (e && (e === c || (c.parentElement!.contains(e) && !e.closest("button,a,input,select,[role]")))) return [x, y];
    }
    return null;
  });
  // cursor
  const [cx, cy] = await chest();
  await page.mouse.move(cx, cy); await page.waitForTimeout(200);
  const cursorOn = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y)!; return { el: e.tagName.toLowerCase() + "." + [...e.classList].join("."), cursor: getComputedStyle(e).cursor }; }, [cx, cy]);
  let cursorOff: any = null;
  if (off) { await page.mouse.move(off[0], off[1]); await page.waitForTimeout(200); cursorOff = await page.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)!).cursor, off); }
  r.cursor = { on: cursorOn, off: cursorOff, chest: [r1(cx), r1(cy)], offPoint: off };
  check("V", vp, "cursor over the model = grab", /grab/.test(cursorOn.cursor), `${cursorOn.cursor} on ${cursorOn.el} (off-model: ${cursorOff})`, "grab");
  mark("cursor");
  // mouse drag -> yaw
  const a = await dv(page);
  await page.mouse.move(cx, cy); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx + 12 * i, cy + (i % 2));
  await page.mouse.up(); await page.waitForTimeout(150);
  const b = await dv(page);
  r.drag = { dyaw: r3(b.yaw - a.yaw), dpitch: r3(b.pitch - a.pitch) };
  check("V", vp, "mouse drag 120 px changes yaw", Math.abs(b.yaw - a.yaw) > 0.1, `dyaw ${r3(b.yaw - a.yaw)} rad`, "> 0.1");
  // vertical drag: limited pitch
  await page.mouse.move(cx, cy); await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(cx, cy - 60 * i);
  await page.mouse.up(); await page.waitForTimeout(150);
  const bp = await dv(page);
  r.pitchLimit = r3(bp.pitch);
  check("V", vp, "pitch limited on a 720 px vertical drag", Math.abs(bp.pitch) < 1.45, `pitch ${r3(bp.pitch)} rad`, "|pitch| < 1.45");
  await page.mouse.dblclick(cx, cy); await page.waitForTimeout(400);
  mark("drags");
  // wheel + ctrl-wheel over the model: distance down, fixed point near cursor, page still
  for (const [label, delta, ctrl] of [["wheel", -240, false], ["ctrl+wheel (pinch)", -60, true]] as const) {
    await page.evaluate(() => document.getElementById("creator-preview")!.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(200);
    const [sx, sy] = await shoulder();
    const s0 = await page.evaluate(scrollState), d0 = await dv(page);
    const picked = await page.evaluate(([x, y]) => { const pv = (globalThis as any).__MYTHERRANIA_PREVIEW__; return typeof pv.debugPick === "function" ? pv.debugPick(x, y) : null; }, [sx, sy]) as number[] | null;
    const camAgree = await page.evaluate((p) => { const pv = (globalThis as any).__MYTHERRANIA_PREVIEW__; return typeof pv.debugProject === "function" ? pv.debugProject(p) : null; }, [0, 0.62 * d0.heightM, 0]) as number[] | null;
    const mine = toPage(d0, new THREE.Vector3(0, 0.62 * d0.heightM, 0));
    const A = await page.evaluate(grab) as Img;
    await wheel(page, sx, sy, delta, ctrl);
    const B = await page.evaluate(grab) as Img;
    const s1 = await page.evaluate(scrollState), d1 = await dv(page);
    const cur: [number, number] = [sx - d1.canvas.x, sy - d1.canvas.y];
    const fp = d1.distance < d0.distance ? fixedPoint(A, B, cur, Math.min(2.2, d0.distance / d1.distance)) : null;
    // projection check: the point on the cursor ray at the model-axis depth, before vs after
    const c0 = camOf(d0), ndc = new THREE.Vector3((cur[0] / d0.canvas.w) * 2 - 1, -(cur[1] / d0.canvas.h) * 2 + 1, 0.5).unproject(c0);
    const dir = ndc.sub(c0.position).normalize(), depth = c0.position.clone().negate().dot(c0.getWorldDirection(new THREE.Vector3()));
    const P = c0.position.clone().add(dir.multiplyScalar(depth / Math.max(1e-6, dir.dot(c0.getWorldDirection(new THREE.Vector3())))));
    const pp = toPage(d1, picked ? new THREE.Vector3(picked[0], picked[1], picked[2]) : P);
    const projDrift = r1(Math.hypot(pp[0] - sx, pp[1] - sy));
    const row = { distance: [r3(d0.distance), r3(d1.distance)], scrollBefore: s0.sum, scrollAfter: s1.sum, fixedPoint: fp, projDriftPx: projDrift, projPoint: picked ? "debugPick hit" : "axis-depth point on the cursor ray", qCameraVsDebugProjectPx: camAgree ? r1(Math.hypot(camAgree[0] - mine[0], camAgree[1] - mine[1])) : null, raw1: d1.raw ? Object.fromEntries(Object.entries(d1.raw).slice(0, 8)) : null };
    r[label] = row;
    check("V", vp, `${label} over model zooms in`, d1.distance < d0.distance - 1e-3, `distance ${r3(d0.distance)} -> ${r3(d1.distance)}`, "falls");
    check("V", vp, `${label} keeps the point under the cursor (pixel fixed-point)`, !!fp && fp.offsetPx <= 14 && fp.errAtCursor < fp.errCentreHyp, fp ? `offset ${fp.offsetPx} px, err ${fp.errAtCursor} at cursor vs ${fp.errCentreHyp} centre-zoom (scale ${fp.scale})` : "no zoom", "<= 14 px and beats centre");
    check("V", vp, `${label} keeps the point under the cursor (projection with Q's camera)`, d1.distance < d0.distance - 1e-3 && projDrift <= 14, d1.distance < d0.distance - 1e-3 ? `${projDrift} px` : "no zoom", "<= 14");
    if (label === "wheel") check("V", vp, "Q's camera (from debugView position/target/fov) agrees with debugProject", row.qCameraVsDebugProjectPx !== null && row.qCameraVsDebugProjectPx <= 2, `${row.qCameraVsDebugProjectPx} px`, "<= 2");
    check("V", vp, `${label} over model does not scroll the page`, s0.sum <= 0 ? null : s1.sum === s0.sum, s0.sum <= 0 ? `page cannot scroll up (scroll ${s0.sum})` : `scroll ${s0.sum} -> ${s1.sum}`, "unchanged");
    await page.mouse.dblclick(sx, sy); await page.waitForTimeout(400);
  }
  mark("wheels");
  // zoom OUT over the model (deltaY +): the page has room downward even at scroll 0 (820 px).
  {
    await page.evaluate(() => document.getElementById("creator-preview")!.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(300);
    const [sx, sy] = await shoulder();
    const s0 = await page.evaluate(scrollState), d0 = await dv(page);
    await wheel(page, sx, sy, 120, false);
    const s1 = await page.evaluate(scrollState), d1 = await dv(page);
    r.wheelOut = { scroll: [s0.sum, s1.sum], room: s0.room, distance: [r3(d0.distance), r3(d1.distance)] };
    check("V", vp, "wheel zoom-out over model: distance grows, page does not scroll", s0.room - s0.sum <= 0 ? null : s1.sum === s0.sum && d1.distance > d0.distance + 1e-3, `scroll ${s0.sum} -> ${s1.sum} (room ${s0.room}), distance ${r3(d0.distance)} -> ${r3(d1.distance)}`, "scroll unchanged, distance up");
    await page.mouse.dblclick(sx, sy); await page.waitForTimeout(400);
  }
  // wheel off the model: page scrolls (if it can)
  await page.evaluate(() => document.getElementById("creator-preview")!.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(200);
  const so = await page.evaluate(scrollState);
  if (off) {
    const dOff0 = await dv(page);
    await wheel(page, off[0], off[1], 160, false);
    const so1 = await page.evaluate(scrollState), dOff1 = await dv(page);
    r.wheelOff = { scroll: [so.sum, so1.sum], room: so.room, distance: [r3(dOff0.distance), r3(dOff1.distance)] };
    check("V", vp, "wheel off the model scrolls the page", so.room - so.sum <= 0 ? null : so1.sum !== so.sum, so.room - so.sum <= 0 ? `page cannot scroll down (room ${so.room}, at ${so.sum})` : `scroll ${so.sum} -> ${so1.sum}, distance ${r3(dOff0.distance)} -> ${r3(dOff1.distance)}`, "changes");
  }
  // touch
  mark("wheelOff");
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    await page.evaluate(() => document.getElementById("creator-preview")!.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(200);
    const [tx, ty] = await chest();
    const t0 = await dv(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: tx, y: ty }] });
    for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: tx + 10 * i, y: ty }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(200);
    const t1 = await dv(page);
    const [px, py] = await chest();
    const ss0 = await page.evaluate(scrollState);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: px - 25, y: py, id: 1 }, { x: px + 25, y: py, id: 2 }] });
    for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: px - 25 - 6 * i, y: py, id: 1 }, { x: px + 25 + 6 * i, y: py, id: 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(250);
    const t2 = await dv(page), ss1 = await page.evaluate(scrollState);
    await cdp.detach();
    r.touch = { dyaw: r3(t1.yaw - t0.yaw), distance: [r3(t1.distance), r3(t2.distance)], scroll: [ss0.sum, ss1.sum] };
    check("V", vp, "touch one-finger drag rotates", Math.abs(t1.yaw - t0.yaw) > 0.1, `dyaw ${r3(t1.yaw - t0.yaw)}`, "> 0.1");
    check("V", vp, "touch two-finger pinch zooms", t2.distance < t1.distance - 1e-3, `distance ${r3(t1.distance)} -> ${r3(t2.distance)}`, "falls");
  }
  // dblclick reset
  mark("touch");
  {
    const [x, y] = await chest();
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(x + 15 * i, y - 4 * i);
    await page.mouse.up();
    await wheel(page, x, y, -200, false);
    const moved = await dv(page);
    const [x2, y2] = await chest();
    await page.mouse.dblclick(x2, y2); await page.waitForTimeout(600);
    const back = await dv(page);
    const dy = Math.abs(back.yaw - v0.yaw), dp = Math.abs(back.pitch - v0.pitch), dd = Math.abs(back.distance - v0.distance);
    r.reset = { moved: [r3(moved.yaw), r3(moved.pitch), r3(moved.distance)], back: [r3(back.yaw), r3(back.pitch), r3(back.distance)], initial: [r3(v0.yaw), r3(v0.pitch), r3(v0.distance)] };
    check("V", vp, "dblclick resets the view", dy < 0.02 && dp < 0.02 && dd < 0.02 && (Math.abs(moved.yaw - v0.yaw) > 0.05 || Math.abs(moved.distance - v0.distance) > 0.05), `moved ${r.reset.moved} -> ${r.reset.back} (initial ${r.reset.initial})`, "back within 0.02");
  }
  // gizmo
  mark("reset");
  await page.evaluate(() => document.getElementById("creator-preview")!.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(250);
  const gz = await page.evaluate(() => {
    const pv = (globalThis as any).__MYTHERRANIA_PREVIEW__;
    const g = typeof pv.debugGizmo === "function" ? pv.debugGizmo() : null;
    const el = document.querySelector('[class*="gizmo"]') as HTMLElement | null;
    const c = document.getElementById("creator-preview")!.getBoundingClientRect();
    const er = el?.getBoundingClientRect();
    return { g, dom: el ? { cls: el.className, tag: el.tagName, rect: { x: er!.left, y: er!.top, w: er!.width, h: er!.height }, text: (el.textContent ?? "").replace(/\s+/g, "") } : null, canvas: { x: c.left, y: c.top, w: c.width, h: c.height } };
  });
  r.gizmo = { debug: gz.g, dom: gz.dom };
  check("V", vp, "debugGizmo() exposed", !!gz.g, gz.g ? Object.keys(gz.g).join(",") : "missing", "present");
  // rect: prefer DOM, else debugGizmo rect (page coords if it says so; canvas coords otherwise)
  let rect = gz.dom?.rect ?? null;
  if (!rect && gz.g?.rect) { const q = gz.g.rect; rect = q.space === "page" ? q : { x: gz.canvas.x + q.x, y: gz.canvas.y + q.y, w: q.w, h: q.h }; }
  const ends: Record<string, [number, number]> = {};
  const endsFrom = (g: any, canvas: any) => {
    const o: Record<string, [number, number]> = {};
    if (g?.endsById) { for (const [k, e] of Object.entries(g.endsById) as [string, any][]) o[k.toLowerCase()] = [e.x, e.y]; return o; }
    if (Array.isArray(g?.ends) && typeof g.ends[0]?.clientX === "number") { for (const e of g.ends) o[String(e.id).toLowerCase()] = [e.clientX, e.clientY]; return o; }
    const src = g?.ends ?? g?.axes ?? null;
    if (!src) return o;
    const list = Array.isArray(src) ? src.map((e: any) => [e.id ?? e.axis ?? e.name, e]) : Object.entries(src);
    for (const [k, e] of list as [string, any][]) {
      const x = e.x ?? e.screen?.[0] ?? e[0], y = e.y ?? e.screen?.[1] ?? e[1];
      if (typeof x !== "number") continue;
      o[String(k).toLowerCase()] = g.space === "page" || e.space === "page" ? [x, y] : [canvas.x + x, canvas.y + y];
    }
    return o;
  };
  Object.assign(ends, endsFrom(gz.g, gz.canvas));
  if (rect) {
    const mx = rect.x + rect.w / 2, my = rect.y + rect.h / 2, c = gz.canvas;
    const inTR = mx > c.x + c.w / 2 && my < c.y + c.h / 2;
    r.gizmo.rect = rect; r.gizmo.centreFrac = [r2((mx - c.x) / c.w), r2((my - c.y) / c.h)];
    const overlap = await page.evaluate((g) => {
      let a = 0; const hit: string[] = [];
      for (const e of document.querySelectorAll(".equip-slot, .hero-plate-corner, #creator-float .th-plaque, #creator-float .hero-tag")) {
        const q = e.getBoundingClientRect(); if (q.width === 0) continue;
        const w = Math.max(0, Math.min(q.right, g.x + g.w) - Math.max(q.left, g.x)), h = Math.max(0, Math.min(q.bottom, g.y + g.h) - Math.max(q.top, g.y));
        if (w * h > 0) { a += w * h; hit.push((e as HTMLElement).className.split(" ")[0]); }
      }
      let gap = Infinity;
      for (const e of document.querySelectorAll(".equip-slot")) {
        const q = e.getBoundingClientRect(); if (q.width === 0) continue;
        const dx = Math.max(0, q.left - (g.x + g.w), g.x - q.right), dy = Math.max(0, q.top - (g.y + g.h), g.y - q.bottom);
        gap = Math.min(gap, Math.hypot(dx, dy));
      }
      return { area: Math.round(a), hit, socketGap: Math.round(gap * 10) / 10 };
    }, rect);
    r.gizmo.overlap = overlap;
    const hits = await page.evaluate((e) => {
      const g = document.querySelector('[class*="gizmo"]');
      const out: Record<string, string> = {};
      for (const [k, p] of Object.entries(e) as [string, number[]][]) { const el = document.elementFromPoint(p[0], p[1]); out[k] = el === g ? "gizmo" : el ? el.tagName.toLowerCase() + "." + [...el.classList].slice(0, 2).join(".") : "none"; }
      const nav = document.querySelector(".menu-screen.active .screen-nav")?.getBoundingClientRect();
      return { out, nav: nav ? [Math.round(nav.top), Math.round(nav.bottom)] : null };
    }, ends);
    r.gizmo.hitTest = hits;
    const blocked = Object.entries(hits.out).filter(([, v]) => v !== "gizmo");
    check("V", vp, "every gizmo end is on top (elementFromPoint, viewer scrolled to centre)", Object.keys(ends).length > 0 && blocked.length === 0, blocked.length ? `${blocked.length}/${Object.keys(ends).length} covered by ${[...new Set(blocked.map(([, v]) => v))].join(",")} (nav y ${hits.nav})` : `${Object.keys(ends).length}/${Object.keys(ends).length} on top`, "all on top");
    check("V", vp, "gizmo overlaps no socket / LV badge / plaque / chip", overlap.area === 0, `${overlap.area} px2 ${overlap.hit.join(",")}`, "0 px2");
    check("V", vp, "gizmo clearance to the nearest .equip-slot (T's Z-13 ask)", overlap.socketGap >= 6, `${overlap.socketGap} px`, ">= 6 px");
    check("V", vp, "gizmo in the viewer's top-right quadrant", inTR, `centre at ${r.gizmo.centreFrac} of the canvas, ${Math.round(rect.w)}x${Math.round(rect.h)} px`, "x > 0.5, y < 0.5");
    // colours at the ends (or the whole crop)
    const vpS = page.viewportSize()!;
    const cx0 = Math.max(0, rect.x - 4), cy0 = Math.max(0, rect.y - 4), cw = Math.min(rect.w + 8, vpS.width - cx0), ch = Math.min(rect.h + 8, vpS.height - cy0);
    const png = new Uint8Array(await page.screenshot({ clip: { x: cx0, y: cy0, width: cw, height: ch } }));
    await Deno.writeFile(`${OUT}/gizmo-${vp}.png`, png);
    const im = await decodePng(page, png);
    const sx = im.w / cw;
    const colourAt = (x: number, y: number) => {
      let best: { h: number; s: number; v: number; c: number[] } | null = null;
      for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
        const px = Math.round((x - cx0) * sx) + dx, py = Math.round((y - cy0) * sx) + dy;
        if (px < 0 || py < 0 || px >= im.w || py >= im.h) continue;
        const k = (py * im.w + px) * 4, c = [im.d[k], im.d[k + 1], im.d[k + 2]], hh = hue(c);
        if (!best || hh.s * hh.v > best.s * best.v) best = { ...hh, c };
      }
      return best;
    };
    const cols: Record<string, any> = {};
    for (const [k, p] of Object.entries(ends)) { const c = colourAt(p[0], p[1]); cols[k] = c ? { hue: Math.round(c.h), sat: r2(c.s), name: hueName(c.h), rgb: c.c } : null; }
    const bins: Record<string, number> = { red: 0, yellow: 0, green: 0, blue: 0, other: 0 };
    for (let k = 0; k < im.d.length; k += 4) { const hh = hue([im.d[k], im.d[k + 1], im.d[k + 2]]); if (hh.s > 0.45 && hh.v > 0.35) bins[hueName(hh.h)]++; }
    r.gizmo.colours = cols; r.gizmo.hueBins = bins;
    const want: Record<string, string> = { x: "red", y: "yellow", z: "green" };
    const posEnds = ["x", "y", "z"].map((a) => cols[`+${a}`] ?? cols[a] ?? null);
    const endsOk = posEnds.every((c, i) => c && c.name === want["xyz"[i]]);
    check("V", vp, "gizmo axis colours on pixels: X red, Y yellow, Z green", Object.keys(ends).length ? endsOk : (bins.red > 15 && bins.yellow > 15 && bins.green > 15), Object.keys(ends).length ? posEnds.map((c, i) => `${"XYZ"[i]} ${c ? `${c.name} h${c.hue}` : "?"}`).join(", ") : `bins ${JSON.stringify(bins)}`, "red/yellow/green");
    const lb = gz.g?.labels ?? null;
    const labels = lb ? ["+X", "+Y", "+Z"].map((k) => lb[k] ?? lb[k.slice(1)] ?? lb[k.toLowerCase()] ?? "").join(" ") : gz.dom?.text ?? "";
    check("V", vp, "gizmo labels X, Y, Z (declared by debugGizmo / DOM; pixels: see vision)", /X/i.test(labels) && /Y/i.test(labels) && /Z/i.test(labels), labels.slice(0, 60) || "none found (canvas-drawn? see vision)", "X Y Z");
  } else check("V", vp, "gizmo in the viewer's top-right quadrant", false, "no gizmo element / rect", "present");
  // clicks
  mark("gizmo");
  const snaps: any[] = [];
  for (const key of ["+x", "-x", "+y", "-y", "+z", "-z", "x", "y", "z"]) {
    if (!(key in ends)) continue;
    // From the home view each time: after a snap along X both X ends project onto the gizmo centre.
    await page.mouse.dblclick(...(await chest())); await page.waitForTimeout(450);
    const g2 = await page.evaluate(() => { const pv = (globalThis as any).__MYTHERRANIA_PREVIEW__; return pv.debugGizmo ? pv.debugGizmo() : null; });
    const e2 = endsFrom(g2, gz.canvas)[key] ?? ends[key];
    await page.mouse.click(e2[0], e2[1]); await page.waitForTimeout(700);
    const v = await dv(page);
    const d = camDir(v), ax = new THREE.Vector3(key.endsWith("x") ? 1 : 0, key.endsWith("y") ? 1 : 0, key.endsWith("z") ? 1 : 0);
    const sign = key.startsWith("-") ? -1 : 1, dot = d.dot(ax) * sign;
    snaps.push({ key, at: e2.map(r1), dir: [r3(d.x), r3(d.y), r3(d.z)], dotSigned: r3(dot), yaw: r3(v.yaw), pitch: r3(v.pitch) });
  }
  r.gizmo.snaps = snaps;
  const conv = snaps.length ? Math.sign(snaps[0].dotSigned) : 0;
  check("V", vp, "clicking each axis end snaps onto that axis", snaps.length >= 3 && snaps.every((s) => Math.abs(s.dotSigned) > 0.95 && Math.sign(s.dotSigned) === conv), snaps.length ? snaps.map((s) => `${s.key}:${s.dotSigned}`).join(" ") : "no clickable ends", "|dot| > 0.95, one convention");
  await page.mouse.dblclick(...(await chest())); await page.waitForTimeout(300);
  await page.locator(".stage-plate").screenshot({ path: `${OUT}/viewer-${vp}.png` }).catch(() => {});
}

for (const [vp, w, h] of VIEWPORTS) {
  const touch = w <= 844;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: false });
  const r: any = { touch };
  report.viewports[vp] = r;
  const e0 = errors.length;
  try {
    const page = await openCreator(ctx, vp);
    const tt = Date.now();
    if (ONLY !== "viewer") await themeRun(page, vp, r).catch((e) => { r.themeError = String(e).slice(0, 300); check("T", vp, "theme run completed", false, r.themeError, "no exception"); });
    r.themeMs = Date.now() - tt;
    const tv = Date.now();
    if (ONLY !== "theme") await viewerRun(page, vp, r, touch).catch((e) => { r.viewerError = String(e).slice(0, 300); check("V", vp, "viewer run completed", false, r.viewerError, "no exception"); });
    r.viewerMs = Date.now() - tv;
  } catch (e) { r.error = String(e).slice(0, 300); }
  r.pageErrors = errors.slice(e0);
  const lane = (ONLY === "viewer" ? "V" : "T") as "T" | "V";
  check(lane, vp, "0 page/console errors", r.pageErrors.length === 0, `${r.pageErrors.length} ${r.pageErrors.slice(0, 2).join(" | ")}`, "0");
  await ctx.close();
  const mine = checks.filter((c) => c.vp === vp);
  console.log(`${vp} (theme ${r.themeMs} ms, viewer ${r.viewerMs} ms)`);
  console.log(`${vp}: ${mine.filter((c) => c.pass === true).length} pass / ${mine.filter((c) => c.pass === false).length} fail / ${mine.filter((c) => c.pass === null).length} n/a`);
  for (const c of mine.filter((c) => c.pass === false)) console.log(`  FAIL [${c.lane}] ${c.id}: ${String(c.value).slice(0, 160)}`);
}

// contact sheets (1280 crops): labelled, swapped labels, all sub-races
if (ONLY !== "viewer") {
  const tiles: { race: string; sub: string; file: string }[] = [];
  for (const [race, subs] of RACE_SUBS) for (const s of subs) { const f = `${OUT}/plaque-${race}-${s}.png`; try { await Deno.stat(f); tiles.push({ race, sub: s, file: f }); } catch { /* not at 1280 */ } }
  if (tiles.length) {
    const pg = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
    const firstOf = RACE_SUBS.map(([race]) => tiles.find((t) => t.race === race)!).filter(Boolean);
    const label = (t: { race: string }) => ({ human: "Human", elf: "Elf", dwarf: "Dwarf", ork: "Orc" } as Record<string, string>)[t.race];
    const sheet = async (items: { file: string; caption: string }[], path: string, cols: number) => {
      const imgs = await Promise.all(items.map(async (t) => `data:image/png;base64,${encodeBase64(await Deno.readFile(t.file))}`));
      await pg.setContent(`<body style="margin:0;background:#202020;font:20px sans-serif;color:#fff"><div id="g" style="display:grid;grid-template-columns:repeat(${cols},auto);gap:14px;padding:14px;width:max-content">${items.map((t, i) => `<figure style="margin:0"><figcaption style="padding:4px 0">${t.caption}</figcaption><img src="${imgs[i]}" style="display:block;max-width:420px"></figure>`).join("")}</div></body>`);
      await pg.locator("#g").screenshot({ path });
    };
    await sheet(firstOf.map((t) => ({ file: t.file, caption: label(t) })), `${OUT}/sheet-races.png`, 2);
    const rot = firstOf.map((_, i) => firstOf[(i + 1) % firstOf.length]);
    await sheet(firstOf.map((t, i) => ({ file: t.file, caption: label(rot[i]) })), `${OUT}/sheet-races-swapped.png`, 2);
    await sheet(firstOf.map((t, i) => ({ file: t.file, caption: `Tile ${i + 1}` })), `${OUT}/sheet-races-unlabelled.png`, 2);
    await sheet(tiles.map((t) => ({ file: t.file, caption: `${label(t)} / ${t.sub}` })), `${OUT}/sheet-subraces.png`, 3);
    report.sheets = { order: firstOf.map((t) => `${t.race}/${t.sub}`), swappedLabels: rot.map(label) };
    await pg.close();
  }
}

report.checks = checks;
report.errors = errors;
const sum = (lane: string) => { const c = checks.filter((x) => x.lane === lane); return { pass: c.filter((x) => x.pass === true).length, fail: c.filter((x) => x.pass === false).length, na: c.filter((x) => x.pass === null).length }; };
report.summary = { T: sum("T"), V: sum("V"), pageErrors: errors.length };
await Deno.writeTextFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summary));
await browser.close();
await server.shutdown();

// ── doc mode ─────────────────────────────────────────────────────────────────────────────────────────────────
async function writeDoc() {
  const runs: any[] = [];
  for await (const d of Deno.readDir(ROOT)) {
    if (!d.isDirectory) continue;
    try { runs.push(JSON.parse(await Deno.readTextFile(`${ROOT}/${d.name}/report.json`))); } catch { /* no report */ }
  }
  runs.sort((a, b) => a.generated.localeCompare(b.generated));
  const vision = await Deno.readTextFile(`${ROOT}/vision.json`).then(JSON.parse).catch(() => []);
  const L: string[] = ["# Wave THEME — Q verification log", "",
    "Generated by `deno run -A tools/verify-wave-theme.ts --doc` from `artifacts/wave-theme/verify/*/report.json` and `vision.json`.",
    "Every number below is copied by code from those files. Method: header of `tools/verify-wave-theme.ts`.", "",
    "## Runs", "", "| tag | generated | dist | Theme.ts | T pass/fail/n.a. | V pass/fail/n.a. | page errors |", "|---|---|---|---|---|---|---|"];
  for (const r of runs) L.push(`| ${r.tag} | ${r.generated} | ${r.dist} | ${r.themeModule ? "yes" : "no"} | ${r.summary.T.pass}/${r.summary.T.fail}/${r.summary.T.na} | ${r.summary.V.pass}/${r.summary.V.fail}/${r.summary.V.na} | ${r.summary.pageErrors} |`);
  for (const r of runs) {
    L.push("", `## ${r.tag}`, "", `Relation model: Archer+bow = ${r.relationModel?.archerBow}, ${r.oppositePair?.join("+")} = ${r.relationModel?.opposite}. Distinct themes expected: ${JSON.stringify(r.expectDistinct)}.`, "");
    const vps = [...new Set(r.checks.map((c: any) => c.vp))] as string[];
    const ids = [...new Set(r.checks.map((c: any) => `${c.lane}|${c.id}`))] as string[];
    L.push(`| lane | check | need | ${vps.join(" | ")} |`, `|---|---|---|${vps.map(() => "---").join("|")}|`);
    for (const k of ids) {
      const [lane, id] = k.split("|");
      const cells = vps.map((vp) => { const c = r.checks.find((x: any) => x.vp === vp && x.lane === lane && x.id === id); if (!c) return ""; const v = String(c.value).replace(/\|/g, "/").slice(0, 90); return `${c.pass === true ? "PASS" : c.pass === false ? "**FAIL**" : "n/a"} ${v}`; });
      const need = r.checks.find((x: any) => x.lane === lane && x.id === id)?.need ?? "";
      L.push(`| ${lane} | ${id} | ${need} | ${cells.join(" | ")} |`);
    }
  }
  if (vision.length) {
    L.push("", "## Vision judgements (paired with pixel measurements and a control question)", "", "| run | sheet | question | answer (verbatim, trimmed) | verdict |", "|---|---|---|---|---|");
    for (const v of vision) L.push(`| ${v.run} | ${v.sheet} | ${v.question.replace(/\|/g, "/")} | ${String(v.answer).replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 400)} | ${v.verdict} |`);
  }
  const suite = await Deno.readTextFile(`${ROOT}/full-suite.log`).catch(() => "");
  const last = suite.split("\n").filter((l) => /^(ok|FAILED) \|/.test(l)).at(-1);
  if (last) L.push("", "## Full suite", "", "`NO_COLOR=1 deno task test > artifacts/wave-theme/verify/full-suite.log` (final tree, after both lanes' r2):", "", "```", last, "```");
  const extra = await Deno.readTextFile(`${ROOT}/notes.md`).catch(() => "");
  if (extra) L.push("", extra.trim());
  await Deno.writeTextFile("docs/wave-theme/VERIFY.md", L.join("\n") + "\n");
  console.log(`VERIFY.md: ${runs.length} runs, ${vision.length} vision rows`);
}
