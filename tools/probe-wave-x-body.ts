// deno-lint-ignore-file no-explicit-any -- QA probe.
// Wave X lane B: the Creator's 3D viewer — pedestal of ONE radius, camera distance from that radius,
// a contact shadow under the feet, the key light from straight above; every race x sex shot front,
// three-quarter and side.
//
//   BUILD_OUT=dist-body deno task build && deno run -A tools/probe-wave-x-body.ts [distDir] [outDir] [tag]
//
// Works on a pre-wave build too (the "before" shots): without the lane-B QA hook it can only switch
// race (Engine.debugSetProfileRace), so a before run shoots the male only and reports no pedestal.
import { chromium, type Page } from "playwright";
import { serveAsset } from "./serve.ts";

const DIST = Deno.args[0] ?? "dist-body";
const OUT = Deno.args[1] ?? "artifacts/qa-wave-x/body";
const TAG = Deno.args[2] ?? "after";
await Deno.mkdir(OUT, { recursive: true });
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (r) => serveAsset(r, DIST));
const PORT = (server.addr as Deno.NetAddr).port;
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});
const errors: string[] = [];
const page: Page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(10000);
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
await page.waitForTimeout(600);
await page.click('[data-action="start"]');
await page.waitForTimeout(600);
// The generator (+ New) shows the Creator's preview canvas.
const newTab = await page.$('[data-hero-tab="new"]');
if (newTab) { await newTab.click(); await page.waitForTimeout(700); }
await page.waitForFunction(() => {
  const c = document.getElementById("creator-preview") as HTMLElement | null;
  return !!c && c.offsetParent !== null;
}, null, { timeout: 10000 }).catch(() => {});
const canvasVisible = await page.evaluate(() => { const c = document.getElementById("creator-preview") as HTMLElement | null; return !!c && c.offsetParent !== null; });

const RACES = (Deno.env.get("PROBE_RACES")?.split(",") ?? ["human", "elf", "dwarf", "ork"]) as readonly string[];
const hasHook = await page.evaluate(() => !!(globalThis as any).__MYTHERRANIA_PREVIEW__);
const SEXES = hasHook ? ["male", "female"] as const : ["male"] as const;
const VIEWS: [string, number][] = [["front", 0], ["three-quarter", 0.7], ["side", Math.PI / 2]];

/** Set the preview's profile (race + sex) through the QA hook, or the race only on a pre-wave build. */
async function show(race: string, sex: string): Promise<void> {
  await page.evaluate(([race, sex]) => {
    const g = globalThis as any;
    const pv = g.__MYTHERRANIA_PREVIEW__;
    if (pv) {
      const p = pv.profile;
      pv.setProfile({ ...p, name: `Probe ${race}`, race, subrace: null, appearance: { ...p.appearance, sex, height: p.appearance.height, weight: p.appearance.weight } });
    } else g.__MYTHERRANIA__.engine.debugSetProfileRace(race, null);
  }, [race, sex]);
  await page.waitForTimeout(350);
}
/** Turn the figure to an absolute yaw (rad) via the same orbit() a drag calls. */
async function yawTo(target: number): Promise<any> {
  return await page.evaluate((target) => {
    const e = (globalThis as any).__MYTHERRANIA__.engine;
    const f = e.debugCreatorPreview().framing;
    const dx = ((target - f.yaw) / 0.6) * 100;
    return e.debugOrbitPreview(dx, ((f.pitch - 0.12) / 0.6) * 100);
  }, target);
}

const rows: any[] = [];
for (const race of RACES) {
  for (const sex of SEXES) {
    await show(race, sex);
    for (const [view, yaw] of VIEWS) {
      const framing = await yawTo(yaw);
      await page.waitForTimeout(150);
      const file = `${OUT}/${TAG}-${race}-${sex}-${view}.png`;
      const el = await page.$("#creator-preview");
      if (el) await el.screenshot({ path: file });
      // In-page: the pedestal/camera facts and the darkness under the feet (canvas pixels read back
      // through a 2D copy: the preview context has no preserveDrawingBuffer, so render first then copy).
      // In-page: the pedestal/camera facts and the darkness under the feet (canvas pixels read back
      // through a 2D copy right after a render: the preview context has no preserveDrawingBuffer).
      // Three lighting variants: both shadows, cast shadow only, nothing — so each part is evidenced.
      const m = await page.evaluate(() => {
        const g = globalThis as any;
        const pv = g.__MYTHERRANIA_PREVIEW__;
        const canvas = document.getElementById("creator-preview") as HTMLCanvasElement;
        const read = (cast: boolean, contact: boolean) => {
          if (pv.debugLighting) pv.debugLighting({ cast, contact });
          const probe = pv.debugShadowProbe();
          const c2 = document.createElement("canvas");
          c2.width = canvas.width; c2.height = canvas.height;
          const ctx = c2.getContext("2d")!;
          ctx.drawImage(canvas, 0, 0);
          const sx = c2.width / canvas.clientWidth, sy = c2.height / canvas.clientHeight;
          const lum = (p: number[]) => {
            const d = ctx.getImageData(Math.max(0, Math.min(c2.width - 1, Math.round(p[0] * sx))), Math.max(0, Math.min(c2.height - 1, Math.round(p[1] * sy))), 1, 1).data;
            return (0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]) * (d[3] / 255);
          };
          const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
          const near = mean(probe.near.map(lum)), rim = mean(probe.rim.map(lum));
          return { coverage: probe.shadowCoverage, nearLum: Math.round(near * 10) / 10, rimLum: Math.round(rim * 10) / 10, ratio: Math.round((near / Math.max(1e-6, rim)) * 1000) / 1000, nNear: probe.near.length, nRim: probe.rim.length };
        };
        let shadow: any = null;
        if (pv && canvas && pv.debugShadowProbe) {
          const both = read(true, true), castOnly = read(true, false), none = read(false, false);
          read(true, true);
          shadow = { ...both, castOnlyRatio: castOnly.ratio, noShadowRatio: none.ratio };
        }
        return { pedestal: pv?.pedestal ? pv.pedestal() : null, shadow };
      });
      rows.push({ race, sex, view, framing, ...m, shot: file });
      console.log(JSON.stringify({ race, sex, view, framing, pedestal: m.pedestal, shadow: m.shadow }));
    }
  }
}
// Close-ups (after builds only): the trunk front and the shoulder, for the abs/deltoid/bulge/skin detail.
if (hasHook) {
  for (const race of RACES) {
    for (const sex of SEXES) {
      await show(race, sex);
      for (const [view, yaw] of [["torso-front", 0], ["torso-3q", 0.6]] as [string, number][]) {
        await yawTo(yaw);
        await page.evaluate(() => {
          const pv = (globalThis as any).__MYTHERRANIA_PREVIEW__;
          const h = pv.framing().heightM;
          pv.debugCamera(Math.max(0.9, h * 0.55), 0.48 * h);
        });
        await page.waitForTimeout(120);
        const el = await page.$("#creator-preview");
        if (el) await el.screenshot({ path: `${OUT}/${TAG}-${race}-${sex}-${view}.png` });
        // Item 6 before/after on the SAME frame: the sub-grid detail switched off, then back on.
        if (view === "torso-front") {
          await page.evaluate(() => (globalThis as any).__MYTHERRANIA_PREVIEW__.debugDetail(false));
          if (el) await el.screenshot({ path: `${OUT}/${TAG}-${race}-${sex}-${view}-nodetail.png` });
          await page.evaluate(() => (globalThis as any).__MYTHERRANIA_PREVIEW__.debugDetail(true));
        }
      }
    }
  }
}
// Cost of the detail + the shadow pass: mean draw time with the detail on vs off (same rig, same frame).
let timing: any = null;
if (hasHook) {
  await show("ork", "male");
  timing = await page.evaluate(() => {
    const pv = (globalThis as any).__MYTHERRANIA_PREVIEW__;
    pv.debugDetail(false); const off = pv.debugRenderMs(40);
    pv.debugDetail(true); const on = pv.debugRenderMs(40);
    return { detailOffMs: off, detailOnMs: on, canvas: [pv.framing ? (document.getElementById("creator-preview") as HTMLCanvasElement).width : 0, (document.getElementById("creator-preview") as HTMLCanvasElement).height] };
  });
  console.log("timing", JSON.stringify(timing));
}
const radii = [...new Set(rows.map((r) => r.pedestal?.radiusM ?? null))];
const dists = [...new Set(rows.map((r) => r.framing?.distanceM ?? null))];
const shadowOk = rows.filter((r) => r.shadow && r.shadow.ratio < 0.8).length;
const report = {
  tag: TAG, dist: DIST, canvasVisible, hook: hasHook, shots: rows.length,
  pedestalRadii: radii, cameraDistances: dists,
  pedestalEqual: radii.length === 1 && radii[0] !== null, cameraEqual: dists.length === 1 && dists[0] !== null,
  shadowUnderFeet: `${shadowOk}/${rows.length} views darker beside the feet than at the rim (ratio < 0.8)`,
  timing,
  pageErrors: errors.length, errors: errors.slice(0, 5), rows,
};
await Deno.writeTextFile(`${OUT}/report-${TAG}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
await browser.close();
await server.shutdown();
