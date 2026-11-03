// deno-lint-ignore-file no-explicit-any -- QA probe: reads the page DOM and the untyped debug global.
// Wave THEME (lane T): identity-driven materials, palettes, patterns and relations on the Fighters page, in real
// Chrome. Screenshots every race x sub-race NAME PLAQUE, every class / sign / weapon CHIP, typical vs atypical
// pairs (relation ring + pip), one saved hero card per race; measures text contrast on PIXELS (glyphs hidden,
// median colour), computed styles (material / palette differ as specified), CSP violations and page errors, and
// the wave Z layout invariants (overflow, clipped text, text < 11 px, LV badge, Roll, name/tags inside the plate)
// at 320 / 390 / 820 / 1280 / 1920 / 2560 / 844x390. Ends with a contact sheet.
//
//   BUILD_OUT=dist-theme deno task build && deno run -A tools/probe-wave-theme.ts
//   env: UI_DIST (default dist-theme), OUT (default artifacts/qa-wave-theme/theme), VPS (e.g. "320,1280")
import { chromium, type Page } from "playwright";
import { encodeBase64 } from "@std/encoding/base64";
import { serveAsset } from "./serve.ts";
import { RACES } from "../src/game/Races.ts";
import { CLASSES } from "../src/game/Stats.ts";
import { BIRTHSIGNS } from "../src/game/Birthsight.ts";
import { ARCHETYPE_IDS } from "../src/game/weapons/Archetypes.ts";
import { relation } from "../src/ui/Theme.ts";

const DIST = Deno.env.get("UI_DIST") ?? "dist-theme";
const OUT = Deno.env.get("OUT") ?? "artifacts/qa-wave-theme/theme";
await Deno.mkdir(OUT, { recursive: true });
for await (const e of Deno.readDir(OUT)) if (e.name.endsWith(".png")) await Deno.remove(`${OUT}/${e.name}`);
const ALL: [string, number, number][] = [["320", 320, 568], ["390", 390, 844], ["820", 820, 1180], ["1280", 1280, 800], ["1920", 1920, 1080], ["2560", 2560, 1440], ["844x390", 844, 390]];
const ONLY = (Deno.env.get("VPS") ?? "").split(",").filter(Boolean);
const VIEWPORTS = ALL.filter(([n]) => ONLY.length === 0 || ONLY.includes(n));
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (r) => serveAsset(r, DIST));
const PORT = (server.addr as Deno.NetAddr).port;
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});
const errors: string[] = [];
const csp: string[] = [];

async function open(page: Page, tag: string) {
  page.on("pageerror", (e) => errors.push(`${tag}: ${String(e)}`));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP ${e.violatedDirective}: ${e.blockedURI} ${(e.target as Element)?.outerHTML?.slice(0, 80) ?? ""}`)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (m.text().startsWith("CSP ") || /Content Security Policy/.test(m.text())) csp.push(`${tag}: ${m.text()}`);
    else errors.push(`${tag} console: ${m.text()}`);
  });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  await page.click('[data-action="start"]');
  await page.waitForTimeout(700);
}
const clickJs = (page: Page, sel: string) => page.evaluate((s) => { const e = document.querySelector(s) as HTMLElement | null; if (!e) throw new Error(`missing ${s}`); e.click(); }, sel);
/** The sticky action bar floats over the plate's foot when it sits at the window's bottom: hide it for captures. */
const hideBar = (page: Page, on: boolean) => page.evaluate((v) => document.querySelectorAll<HTMLElement>(".screen-actions").forEach((e) => { e.style.visibility = v ? "hidden" : ""; }), on);

/** Text contrast against the real pixels behind each element (template: tools/probe-wave-z-fighters.ts). */
async function pixelContrast(page: Page, sel: string): Promise<{ ratio: number; colour: string; back: string } | null> {
  const info = await page.evaluate((s) => {
    const e = document.querySelector(s) as HTMLElement | null;
    if (!e || e.getBoundingClientRect().height === 0) return null;
    e.scrollIntoView({ block: "center" });
    const r = e.getBoundingClientRect();
    const colour = getComputedStyle(e).color;
    const all = [e, ...e.querySelectorAll<HTMLElement>("*")];
    all.forEach((k) => { (k as any).__c = k.style.color; (k as any).__t = k.style.textShadow; k.style.color = "transparent"; k.style.textShadow = "none"; });
    return { x: r.left, y: r.top, w: r.width, h: r.height, colour, vw: innerWidth, vh: innerHeight };
  }, sel);
  if (!info) return null;
  // The label's own box (a span: no icon, no pip), inset 1 px.
  const png = await page.screenshot({ clip: { x: Math.max(0, info.x + 1), y: info.y + 1, width: Math.max(2, Math.min(info.w - 2, info.vw - info.x - 1)), height: Math.max(2, info.h - 2) } });
  await page.evaluate((s) => {
    const e = document.querySelector(s) as HTMLElement;
    [e, ...e.querySelectorAll<HTMLElement>("*")].forEach((k) => { k.style.color = (k as any).__c ?? ""; k.style.textShadow = (k as any).__t ?? ""; });
  }, sel);
  return await page.evaluate(async ([data, col]) => {
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
    return { ratio: +((Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05)).toFixed(2), colour: col, back: `rgb(${d[kb]}, ${d[kb + 1]}, ${d[kb + 2]})` };
  }, [encodeBase64(new Uint8Array(png)), info.colour] as const);
}

/** A padded element screenshot (the scroll's rolled ends and the plaque's shadow stick out of its box). */
async function shot(page: Page, sel: string, path: string, pad = 8) {
  const r = await page.evaluate((s) => { const e = document.querySelector(s) as HTMLElement; e.scrollIntoView({ block: "center" }); const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, vw: innerWidth }; }, sel);
  const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad);
  await page.screenshot({ path, clip: { x, y, width: Math.min(r.w + pad * 2, r.vw - x), height: r.h + pad * 2 } });
}

const computed = (page: Page, sel: string) => page.evaluate((s) => {
  const e = document.querySelector(s) as HTMLElement | null;
  if (!e) return null;
  const cs = getComputedStyle(e);
  const img = cs.backgroundImage;
  let h = 0; for (let i = 0; i < img.length; i++) h = (h * 31 + img.charCodeAt(i)) | 0;
  return { color: cs.color, bg: cs.backgroundColor, layers: (img.match(/gradient\(|url\(/g) ?? []).length, svgTiles: (img.match(/url\("data:image\/svg/g) ?? []).length, imgHash: h, border: `${cs.borderTopStyle} ${cs.borderTopColor}`, relation: e.dataset.relation ?? null };
}, sel);

const report: any = { dist: DIST, generated: new Date().toISOString(), plaques: [], chips: { class: [], sign: [], weapon: [] }, pairs: [], heroes: [], layout: {} };

// ── 1. Materials, palettes, patterns, pairs (1280 x 900 at 2x) ──────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await open(page, "theme");
  await clickJs(page, '[data-hero-tab="new"]');
  await page.waitForTimeout(700);
  await hideBar(page, true);
  for (const r of RACES) for (const s of r.subspecies) {
    await clickJs(page, `.subrace-chip[data-race="${r.id}"][data-subrace="${s.id}"]`);
    await page.waitForTimeout(350);
    await hideBar(page, true);
    const mat = await page.evaluate(() => (document.querySelector(".stage-plate") as HTMLElement).dataset.thMaterial);
    const file = `plaque-${r.id}-${s.id}.png`;
    await shot(page, ".stage-plate .th-plaque", `${OUT}/${file}`, 14);
    const tagsFile = `tags-${r.id}-${s.id}.png`;
    await shot(page, ".stage-plate .hero-float", `${OUT}/${tagsFile}`, 6);
    report.plaques.push({
      race: r.id, subrace: s.id, material: mat, file, tagsFile,
      plaque: await computed(page, ".stage-plate .th-plaque"), subraceChip: await computed(page, '.stage-plate .hero-tag[data-tag="subrace"]'),
      contrastName: await pixelContrast(page, ".stage-plate .th-plaque > .hero-name"),
      contrastRace: await pixelContrast(page, '.stage-plate .hero-tag[data-tag="race"] > span'),
      contrastSub: await pixelContrast(page, '.stage-plate .hero-tag[data-tag="subrace"] > span'),
    });
  }
  // Classes (the human imperial plate as the stage), signs, weapons — each chip on its own.
  await clickJs(page, '.subrace-chip[data-race="human"][data-subrace="imperial"]');
  for (const c of CLASSES) {
    await clickJs(page, `#class-table .pick-row[data-class="${c}"]`); await page.waitForTimeout(250); await hideBar(page, true);
    const file = `chip-class-${c}.png`;
    await shot(page, '.stage-plate .hero-tag[data-tag="class"]', `${OUT}/${file}`, 4);
    report.chips.class.push({ id: c, file, style: await computed(page, '.stage-plate .hero-tag[data-tag="class"]'), contrast: await pixelContrast(page, '.stage-plate .hero-tag[data-tag="class"] > span') });
  }
  await clickJs(page, `#class-table .pick-row[data-class="Archer"]`); await page.waitForTimeout(250);
  for (const s of BIRTHSIGNS) {
    await clickJs(page, `#birthsign-table .pick-row[data-birthsign="${s.id}"]`); await page.waitForTimeout(250); await hideBar(page, true);
    const file = `chip-sign-${s.id}.png`;
    await shot(page, '.stage-plate .hero-tag[data-tag="sign"]', `${OUT}/${file}`, 4);
    report.chips.sign.push({ id: s.id, file, style: await computed(page, '.stage-plate .hero-tag[data-tag="sign"]'), contrast: await pixelContrast(page, '.stage-plate .hero-tag[data-tag="sign"] > span'), expected: relation("class-sign", "Archer", s.id) });
  }
  for (const w of ARCHETYPE_IDS) {
    await clickJs(page, `#weapon-table .pick-row[data-weapon="${w}"]`); await page.waitForTimeout(250); await hideBar(page, true);
    const file = `chip-weapon-${w}.png`;
    await shot(page, '.stage-plate .hero-tag[data-tag="weapon"]', `${OUT}/${file}`, 4);
    report.chips.weapon.push({
      id: w, file, style: await computed(page, '.stage-plate .hero-tag[data-tag="weapon"]'), socket: await computed(page, ".stage-plate .equip-slot-weapon"),
      contrast: await pixelContrast(page, '.stage-plate .hero-tag[data-tag="weapon"] > span'), expected: relation("class-weapon", "Archer", w),
      rowRelation: await page.evaluate((id) => (document.querySelector(`#weapon-table .pick-row[data-weapon="${id}"]`) as HTMLElement).dataset.relation, w),
    });
  }
  // Typical vs atypical pairs: the tags block + the weapon socket.
  const PAIRS: [string, string, string, string, string][] = [
    ["elf", "wood", "Archer", "bow", "serpent"], ["elf", "wood", "Archer", "dagger", "storm"], ["elf", "wood", "Archer", "maul", "flame"],
    ["ork", "bloodfang", "Barbarian", "greataxe", "flame"], ["ork", "ironhide", "Mage", "maul", "mountain"],
    ["dwarf", "forge", "Warrior", "longsword", "mountain"], ["dwarf", "deep", "Priest", "warhammer", "moon"], ["human", "nomad", "Necromancer", "bow", "flame"],
  ];
  for (const [race, sub, cls, weapon, sign] of PAIRS) {
    await clickJs(page, `.subrace-chip[data-race="${race}"][data-subrace="${sub}"]`); await page.waitForTimeout(250);
    await clickJs(page, `#class-table .pick-row[data-class="${cls}"]`); await page.waitForTimeout(250);
    await clickJs(page, `#weapon-table .pick-row[data-weapon="${weapon}"]`); await page.waitForTimeout(250);
    await clickJs(page, `#birthsign-table .pick-row[data-birthsign="${sign}"]`); await page.waitForTimeout(300);
    await hideBar(page, true);
    const file = `pair-${race}-${cls}-${weapon}-${sign}.png`;
    await shot(page, ".stage-plate .hero-plate-foot", `${OUT}/${file}`, 2);
    const seen = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll<HTMLElement>(".stage-plate .hero-tag[data-relation]")].map((t) => [t.dataset.tag, { rel: t.dataset.relation, border: getComputedStyle(t).borderTopStyle, ring: getComputedStyle(t).borderTopColor, pip: getComputedStyle(t, "::after").backgroundImage !== "none" ? getComputedStyle(t, "::after").backgroundImage.slice(0, 60) : getComputedStyle(t, "::after").backgroundColor, pipTransform: getComputedStyle(t, "::after").transform, title: t.title }])));
    const socket = await computed(page, ".stage-plate .equip-slot-weapon");
    report.pairs.push({
      race, sub, cls, weapon, sign, file, seen, socketBorder: socket?.border,
      expected: { class: relation("race-class", race, cls), sign: relation("class-sign", cls, sign), weapon: relation("class-weapon", cls, weapon) },
    });
  }
  await shot(page, "#weapon-table", `${OUT}/list-weapons-necromancer.png`, 2).catch(() => {});
  // Saved hero cards: one per race (the hero card applies the same theme on .hero-card).
  for (const [race, sub] of [["ork", "ironhide"], ["elf", "high"], ["human", "islander"], ["dwarf", "mountain"]]) {
    await clickJs(page, '[data-hero-tab="new"]'); await page.waitForTimeout(400);
    await clickJs(page, `.subrace-chip[data-race="${race}"][data-subrace="${sub}"]`); await page.waitForTimeout(300);
    await clickJs(page, '#weapon-table .pick-row[data-weapon=""]'); await page.waitForTimeout(200);
    await hideBar(page, false);
    await clickJs(page, '[data-action="save-profile"]'); await page.waitForTimeout(1500);
    await hideBar(page, true);
    const file = `hero-${race}-${sub}.png`;
    const ok = await page.evaluate(() => !!document.querySelector(".hero-card[data-th-material] .th-plaque"));
    if (ok) await shot(page, ".hero-card .hero-plate", `${OUT}/${file}`, 2);
    report.heroes.push({
      race, sub, file: ok ? file : null, material: await page.evaluate(() => (document.querySelector(".hero-card") as HTMLElement | null)?.dataset.thMaterial ?? null),
      contrastName: ok ? await pixelContrast(page, ".hero-card .th-plaque > .hero-name") : null,
      tabs: await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".hero-tab[data-th-material]")].map((t) => t.dataset.thMaterial)),
    });
  }
  await ctx.close();
}

// ── 2. Layout invariants per viewport (wave Z meters: overflow / clipped / tiny / inside / badge / Roll) ──
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
  return { overflow: overflow.length, clipped: clipped.length, tiny: tiny.length, samples: [...overflow, ...clipped, ...tiny].slice(0, 6) };
};
const plateInside = (sel: string) => {
  const plate = document.querySelector(sel) as HTMLElement | null;
  if (!plate) return null;
  const p = plate.getBoundingClientRect(), s = getComputedStyle(plate);
  const inner = { l: p.left + parseFloat(s.borderLeftWidth), t: p.top + parseFloat(s.borderTopWidth), r: p.right - parseFloat(s.borderRightWidth), b: p.bottom - parseFloat(s.borderBottomWidth) };
  const els = [...plate.querySelectorAll<HTMLElement>(".th-plaque, .hero-name, .hero-tag, .lv-badge")];
  const out = els.filter((e) => { const r = e.getBoundingClientRect(); return r.left < inner.l - 0.5 || r.right > inner.r + 0.5 || r.top < inner.t - 0.5 || r.bottom > inner.b + 0.5; }).map((e) => e.className);
  // The scroll's rolled ends (pseudo-elements) stick out of the plaque box by .3em: measure them from the plaque box.
  const pq = plate.querySelector<HTMLElement>(".th-plaque");
  let rolls = true;
  if (pq && plate.dataset.thMaterial === "scroll") { const r = pq.getBoundingClientRect(), em = parseFloat(getComputedStyle(pq).fontSize); rolls = r.left - 0.3 * em >= inner.l && r.right + 0.3 * em <= inner.r && r.top - 0.34 * em >= inner.t; }
  const badge = plate.querySelector(".lv-badge")?.getBoundingClientRect(), name = plate.querySelector(".hero-name")?.getBoundingClientRect();
  const overlap = badge && name ? Math.max(0, Math.min(badge.right, name.right) - Math.max(badge.left, name.left)) * Math.max(0, Math.min(badge.bottom, name.bottom) - Math.max(badge.top, name.top)) : 0;
  const pr = pq?.getBoundingClientRect();
  return { outside: out, rollsInside: rolls, badge: !!badge, badgeNameOverlap: Math.round(overlap), material: plate.dataset.thMaterial ?? null, plaqueCentred: pr ? Math.abs((pr.left + pr.right) / 2 - (inner.l + inner.r) / 2) <= 1.5 : null };
};
for (const [vp, w, h] of VIEWPORTS) {
  const touch = w <= 820;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: w <= 390 });
  const page = await ctx.newPage();
  await open(page, vp);
  const r: any = {};
  // A scroll (elf) hero: the tallest plaque (rolled ends) and the longest names.
  await clickJs(page, '[data-hero-tab="new"]'); await page.waitForTimeout(500);
  await clickJs(page, '.subrace-chip[data-race="elf"][data-subrace="dark"]'); await page.waitForTimeout(400);
  await clickJs(page, `#class-table .pick-row[data-class="Necromancer"]`); await page.waitForTimeout(300);
  r.newAudit = await page.evaluate(auditPage);
  r.newPlate = await page.evaluate(plateInside, ".stage-plate");
  await clickJs(page, '[data-action="save-profile"]'); await page.waitForTimeout(1500);
  await page.evaluate(() => { const s = document.querySelector('[data-screen="select"]') as HTMLElement; s.scrollTop = 0; scrollTo(0, 0); });
  r.heroAudit = await page.evaluate(auditPage);
  r.heroPlate = await page.evaluate(plateInside, ".hero-card .hero-plate");
  r.roll = await page.evaluate(() => { const b = document.querySelector("[data-hero-reroll]") as HTMLElement | null; return b ? { label: b.textContent?.trim(), h: Math.round(b.getBoundingClientRect().height) } : null; });
  r.heroContrast = { name: await pixelContrast(page, ".hero-card .th-plaque > .hero-name"), tag: await pixelContrast(page, '.hero-card .hero-tag[data-tag="class"] > span') };
  await hideBar(page, true);
  await page.locator(".hero-card .hero-plate").screenshot({ path: `${OUT}/layout-hero-${vp}.png` }).catch(() => {});
  report.layout[vp] = r;
  await ctx.close();
}

// ── 3. Contact sheet ───────────────────────────────────────────────────────────────────────────
{
  const files = [...report.plaques.map((p: any) => [p.file, `${p.race}/${p.subrace} · ${p.material}`]), ...report.plaques.map((p: any) => [p.tagsFile, `${p.race}/${p.subrace} chips`]),
    ...report.chips.class.map((c: any) => [c.file, `class ${c.id}`]), ...report.chips.sign.map((c: any) => [c.file, `sign ${c.id} (Archer: ${c.expected})`]),
    ...report.chips.weapon.map((c: any) => [c.file, `weapon ${c.id} (Archer: ${c.expected})`]), ...report.pairs.map((p: any) => [p.file, `${p.cls}+${p.weapon}+${p.sign}: ${p.expected.weapon}/${p.expected.sign}`]),
    ...report.heroes.filter((h: any) => h.file).map((h: any) => [h.file, `hero card ${h.race}/${h.sub}`])];
  const cells: string[] = [];
  for (const [f, cap] of files) {
    const b64 = encodeBase64(await Deno.readFile(`${OUT}/${f}`));
    cells.push(`<figure><img src="data:image/png;base64,${b64}"><figcaption>${cap}</figcaption></figure>`);
  }
  const ctx = await browser.newContext({ viewport: { width: 1800, height: 1000 } });
  const page = await ctx.newPage();
  await page.setContent(`<style>body{margin:0;padding:12px;background:#120d09;color:#e8dcc0;font:12px sans-serif;display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start}
    figure{margin:0;padding:6px;background:#1d1610;border:1px solid #3a2c1c}img{display:block;max-width:420px;max-height:300px}figcaption{margin-top:4px}</style>${cells.join("")}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/contact-sheet.png`, fullPage: true });
  await ctx.close();
}

// ── Summary ────────────────────────────────────────────────────────────────────────────────────
const minOf = (xs: (number | null | undefined)[]) => Math.min(...xs.filter((x): x is number => typeof x === "number"));
const plaqueMin = minOf(report.plaques.map((p: any) => p.contrastName?.ratio));
const chipMin = minOf([...report.plaques.flatMap((p: any) => [p.contrastRace?.ratio, p.contrastSub?.ratio]), ...["class", "sign", "weapon"].flatMap((k) => report.chips[k].map((c: any) => c.contrast?.ratio))]);
const heroMin = minOf(report.heroes.map((h: any) => h.contrastName?.ratio));
const pairOk = report.pairs.filter((p: any) => p.seen.class?.rel === p.expected.class && p.seen.sign?.rel === p.expected.sign && p.seen.weapon?.rel === p.expected.weapon).length;
const distinct = (xs: any[]) => new Set(xs).size;
report.summary = {
  plaques: report.plaques.length, materials: Object.fromEntries(RACES.map((r) => [r.id, [...new Set(report.plaques.filter((p: any) => p.race === r.id).map((p: any) => p.material))].join()])),
  plaqueStylesDistinct: distinct(report.plaques.map((p: any) => p.plaque.imgHash)), subraceChipBgDistinct: distinct(report.plaques.map((p: any) => p.subraceChip.bg)),
  classChipsDistinct: distinct(report.chips.class.map((c: any) => c.style.imgHash)), signChipsDistinct: distinct(report.chips.sign.map((c: any) => c.style.imgHash)), weaponChipsDistinct: distinct(report.chips.weapon.map((c: any) => c.style.imgHash)),
  weaponRelationsMatch: report.chips.weapon.filter((c: any) => c.style.relation === c.expected && c.rowRelation === c.expected).length + "/" + report.chips.weapon.length,
  signRelationsMatch: report.chips.sign.filter((c: any) => c.style.relation === c.expected).length + "/" + report.chips.sign.length,
  pairsMatch: `${pairOk}/${report.pairs.length}`, archerBow: report.pairs[0]?.seen.weapon,
  contrastMin: { plaqueName: plaqueMin, chips: chipMin, heroName: heroMin },
  heroes: report.heroes.map((h: any) => `${h.race}:${h.material}`),
  layout: Object.fromEntries(Object.entries(report.layout).map(([vp, r]: [string, any]) => [vp, `new ${r.newAudit.overflow}/${r.newAudit.clipped}/${r.newAudit.tiny} inside:${r.newPlate.outside.length === 0 && r.newPlate.rollsInside} · hero ${r.heroAudit.overflow}/${r.heroAudit.clipped}/${r.heroAudit.tiny} inside:${r.heroPlate?.outside.length === 0 && r.heroPlate?.rollsInside} badge:${r.heroPlate?.badge} overlap:${r.heroPlate?.badgeNameOverlap} centred:${r.heroPlate?.plaqueCentred} roll:${r.roll?.label}/${r.roll?.h} · contrast name ${r.heroContrast.name?.ratio} tag ${r.heroContrast.tag?.ratio}`])),
  cspViolations: csp.length, pageErrors: errors.length,
};
report.csp = csp.slice(0, 10); report.errors = errors.slice(0, 10);
await Deno.writeTextFile(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.summary, null, 1));
await browser.close();
await server.shutdown();
