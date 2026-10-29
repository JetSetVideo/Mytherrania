// Wave G graphics probe: serves dist/ in-process, drives Metal-backed headless Chrome through the
// graphics presets, resolutions and (when the climate is live) weather regimes; records the GPU
// renderer string, shader-compile health, pipeline configuration, a synced render benchmark per
// preset and a screenshot per case, plus a JSON manifest.
//   deno task build && deno run -A tools/probe-graphics.ts [outDir]
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";
import { createClimate } from "../src/world/climate/Climate.ts";
import { PLACES, solarPosition } from "../src/graphics/Environment.ts";

/** Hour (day 200) when the sun crosses `elevDeg` (rising before noon, setting after), for a latitude. */
function hourAtElevation(lat: number, elevDeg: number, rising: boolean): number {
  let best = 12, err = 1e9;
  for (let h = rising ? 0 : 12; h < (rising ? 12 : 24); h += 0.02) {
    const e = solarPosition(200, h, lat).elevation * 57.2958;
    if (Math.abs(e - elevDeg) < err) { err = Math.abs(e - elevDeg); best = h; }
  }
  return Math.round(best * 100) / 100;
}

/** A night when both moons are high and close enough to share one frame (searched on the climate model). */
function twoMoonNight(placeIdx: number, year: number): { day: number; hour: number; sepDeg: number } {
  const pl = PLACES[placeIdx];
  const c = createClimate({ placeId: pl.id, latitude: pl.latitude, seed: 1, year, dayOfYear: 200, hour: 0, dayLengthSeconds: 0 });
  let best = { day: 200, hour: 0, sepDeg: 999 };
  for (let day = 200; day < 260; day++) for (let h = 0; h < 24; h += 0.25) {
    if (solarPosition(day, h, pl.latitude).elevation * 57.3 > -10) continue;
    c.setClock(day, h, year);
    const [a, b] = c.step(0.001).moons;
    if (a.dir[1] < 0.3 || b.dir[1] < 0.3 || a.illumination < 0.3) continue;
    const sep = Math.acos(Math.min(1, a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1] + a.dir[2] * b.dir[2])) * 57.3;
    // Both in one frame but clearly apart (8..35 deg): two discs, not one.
    if (sep >= 8 && sep <= 35 && Math.abs(sep - 18) < Math.abs(best.sepDeg - 18)) best = { day, hour: h, sepDeg: sep };
  }
  return best;
}

const OUT = Deno.args[0] ?? "artifacts/qa-graphics";
await Deno.mkdir(OUT, { recursive: true });
const server = Deno.serve({ hostname: "127.0.0.1", port: 8791, onListen() {} }, (r) => serveAsset(r));
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`); });
// deno-lint-ignore no-explicit-any
const eng = (fn: string, arg?: unknown) => page.evaluate(([f, a]) => (globalThis as any).__MYTHERRANIA__.engine[f as string](a), [fn, arg] as const);
// deno-lint-ignore no-explicit-any
const snap = () => page.evaluate(() => (globalThis as any).__MYTHERRANIA__.snapshot());
const manifest: Record<string, unknown>[] = [];
const only = (Deno.env.get("PROBE_ONLY") ?? "").split(",").filter(Boolean);
const want = (group: string) => only.length === 0 || only.includes(group);

async function shot(name: string, note: string, bench = false) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 20000 });
  const s = await snap();
  const b = bench ? await eng("benchRender", 20) : null;
  manifest.push({ name, note, bench: b, graphics: s.graphics, climate: s.climate });
  const ev = s.climate?.events;
  if (ev) console.log(`    events ${ev.active.join(",") || "-"} ${JSON.stringify(ev.intensity)}`);
  const g = s.graphics;
  console.log(`  ${name.padEnd(34)} ${g.pipeline.outputWidth}x${g.pipeline.outputHeight} scene ${g.pipeline.sceneWidth}x${g.pipeline.sceneHeight} passes ${g.pipeline.passes} draws ${g.drawCalls} tris ${g.triangles}${b ? ` bench ${b.msPerFrame} ms` : ""}${g.brokenPrograms.length ? ` BROKEN ${g.brokenPrograms.length}` : ""}`);
  for (const bp of g.brokenPrograms) console.log(`    ! ${bp}`);
}

try {
  await page.goto("http://127.0.0.1:8791/", { waitUntil: "load" });
  await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__MYTHERRANIA__, null, { timeout: 20000 });
  const gpu = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
  });
  console.log(`GPU: ${gpu}`);
  await page.click('[data-action="start"]');
  await page.waitForTimeout(300);
  await page.click('[data-action="begin"]');
  await page.waitForTimeout(900);
  // The fight stays frozen at its opening pose for every shot; the climate keeps running (climateLive).
  // Pin the place (Verdant Hills, lat 34) so runs are comparable.
  await eng("debugView", { freeze: true, climateLive: true, camera: "third", firstPerson: false, hour: 16, dayOfYear: 200, regime: "fair", place: 2 });

  if (want("presets")) {
    for (const preset of ["low", "medium", "high", "ultra"]) {
      await eng("debugView", { settings: { graphics: preset, resolution: "1080p", ssao: "auto", gi: "auto", rayTracing: "auto" }, freeze: true });
      await shot(`preset-${preset}`, `graphics preset ${preset} at 1080p, 16h, fair`, true);
    }
  }
  if (want("resolutions")) {
    for (const res of ["480p", "720p", "1440p", "2160p"]) {
      await eng("debugView", { settings: { graphics: "high", resolution: res }, freeze: true });
      await shot(`res-${res}`, `high preset at ${res}`, true);
    }
  }
  if (want("effects")) {
    await eng("debugView", { settings: { graphics: "high", resolution: "1080p" }, freeze: true });
    for (const [tag, patch] of [["no-post", { ssao: "off", gi: "off", rayTracing: "off" }], ["ssao-only", { ssao: "on", gi: "off", rayTracing: "off" }], ["gi-only", { ssao: "off", gi: "on", rayTracing: "off" }], ["rt-only", { ssao: "off", gi: "off", rayTracing: "on" }], ["all", { ssao: "on", gi: "on", rayTracing: "on" }]] as const) {
      await eng("debugView", { settings: patch, freeze: true });
      await shot(`fx-${tag}`, `high, 1080p, effects ${tag}`, true);
    }
  }
  if (want("ab")) {
    // A/B of the far field: the same storm frame drawn without the post pipeline (low) and with it (high).
    for (const [regime, preset] of [["fair", "low"], ["fair", "high"], ["storm", "low"], ["storm", "high"]] as const) {
      await eng("debugView", { settings: { graphics: preset, resolution: "1080p" }, regime, hour: 15, dayOfYear: 200 });
      await page.waitForTimeout(2500);
      await shot(`ab-${regime}-${preset}`, `${regime} drawn with the ${preset} preset (A/B)`);
    }
    await eng("debugView", { settings: { graphics: "high" } });
  }
  if (want("weather")) {
    await eng("debugView", { settings: { graphics: "high", resolution: "1080p", ssao: "auto", gi: "auto", rayTracing: "auto" } });
    for (const regime of ["clear", "fair", "overcast", "building", "lull", "storm", "clearing"]) {
      await eng("debugView", { regime, hour: 15, dayOfYear: 200 });
      await page.waitForTimeout(2500);
      await shot(`weather-${regime}`, `regime ${regime} pinned, 15h day 200`);
    }
    await eng("debugView", { regime: null });
  }
  if (want("events")) {
    // Each situational event staged by patching the event scorer's inputs on top of a pinned sky
    // (the climate keeps running underneath), held ~6 s so the envelopes reach full intensity.
    await eng("debugView", { settings: { graphics: "high", resolution: "1080p", ssao: "auto", gi: "auto", rayTracing: "auto" } });
    const stages: [string, Record<string, unknown>, Record<string, unknown>][] = [
      ["rainbow", { hour: hourAtElevation(34, 12, false), dayOfYear: 200, regime: "clearing", skyAim: "antisun" }, { rain: 0.3, sunCloud: 0 }],
      ["halo", { hour: hourAtElevation(34, 28, false), dayOfYear: 200, regime: "fair", skyAim: "sun" }, { highCover: 0.75, highDensity: 0.3, cloudCover: 0.5, sunCloud: 0.1 }],
      ["frost", { hour: 7.5, dayOfYear: 20, regime: "clear" }, { frozen: 1, dewDeposition: 0.4, sunElevDeg: 3 }],
      ["snowfall", { hour: 13, dayOfYear: 20, regime: "overcast" }, { snow: 0.7, windMs: 9, gustMs: 16 }],
      ["heat-shimmer", { hour: 14, dayOfYear: 200, regime: "clear" }, { temperatureC: 39, relativeHumidity: 0.2, windMs: 1, cloudCover: 0 }],
      ["thunderstorm", { hour: 15, dayOfYear: 200, regime: "storm" }, {}],
      ["lull", { hour: 15, dayOfYear: 200, regime: "lull" }, {}],
      ["fog-bank", { hour: 8, dayOfYear: 300, regime: "overcast" }, { fog: 0.85 }],
    ];
    for (const [tag, view, patch] of stages) {
      await eng("debugView", { ...view, eventPatch: patch });
      await page.waitForTimeout(2500);
      // debugView's skyAim is not sticky: pass it again with the settle call.
      await eng("debugView", { eventsSettle: 40, skyAim: view.skyAim ?? null });
      await shot(`event-${tag}`, `event ${tag}: ${JSON.stringify(view)} patch ${JSON.stringify(patch)}`);
    }
    await eng("debugView", { eventPatch: null, skyAim: null, regime: null });
  }
  if (want("times")) {
    const sp = await snap();
    const lat = PLACES.find((p) => p.name === sp.world?.place)?.latitude ?? 34;
    const times: [number, string][] = [
      [hourAtElevation(lat, -4, true), "dawn"], [hourAtElevation(lat, 6, true), "golden-morning"], [12.5, "noon"],
      [hourAtElevation(lat, 8, false), "golden-evening"], [hourAtElevation(lat, -3, false), "dusk"], [23.5, "night"],
    ];
    for (const [h, tag] of times) {
      await eng("debugView", { hour: h, dayOfYear: 200, regime: "fair" });
      await page.waitForTimeout(1200);
      await shot(`time-${tag}`, `${h}h day 200, fair`);
    }
    const s0 = await snap();
    const placeIdx = Math.max(0, PLACES.findIndex((p) => p.name === s0.world?.place));
    const tm = twoMoonNight(placeIdx, new Date().getFullYear());
    await eng("debugView", { hour: tm.hour, dayOfYear: tm.day, regime: "clear", skyAim: "moons" });
    await page.waitForTimeout(1200);
    await shot("sky-moons", `camera between the moons: day ${tm.day} ${tm.hour}h, separation ${tm.sepDeg.toFixed(1)} deg, clear`);
    await eng("debugView", { hour: 16, dayOfYear: 200, regime: "storm", skyAim: "sun" });
    await page.waitForTimeout(2500);
    await shot("sky-storm-sun", "camera at the sun, storm");
    await eng("debugView", { skyAim: null, regime: null });
  }
} finally {
  await Deno.writeTextFile(`${OUT}/manifest.json`, JSON.stringify({ errors, manifest }, null, 1));
  console.log(`errors: ${errors.length}`);
  for (const e of errors.slice(0, 12)) console.log(`  ${e.slice(0, 300)}`);
  await browser.close();
  await server.shutdown();
}
