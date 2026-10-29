// Wave G graphics probe: serves dist/ in-process, drives Metal-backed headless Chrome through the
// graphics presets, resolutions and (when the climate is live) weather regimes; records the GPU
// renderer string, shader-compile health, pipeline configuration, a synced render benchmark per
// preset and a screenshot per case, plus a JSON manifest.
//   deno task build && deno run -A tools/probe-graphics.ts [outDir]
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";

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
  await eng("debugView", { freeze: true, camera: "third", firstPerson: false, hour: 16, dayOfYear: 200, regime: "fair" });

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
  if (want("weather")) {
    await eng("debugView", { settings: { graphics: "high", resolution: "1080p", ssao: "auto", gi: "auto", rayTracing: "auto" } });
    for (const regime of ["clear", "fair", "overcast", "building", "lull", "storm", "clearing"]) {
      await eng("debugView", { regime, freeze: false, hour: 15, dayOfYear: 200 });
      await page.waitForTimeout(1500);
      await eng("debugView", { freeze: true });
      await shot(`weather-${regime}`, `regime ${regime} pinned, 15h day 200`);
    }
    await eng("debugView", { regime: null });
  }
  if (want("times")) {
    for (const [h, tag] of [[5.6, "dawn"], [7.2, "golden-morning"], [12.5, "noon"], [18.4, "golden-evening"], [19.6, "dusk"], [23.5, "night"]] as const) {
      await eng("debugView", { hour: h, dayOfYear: 200, regime: "fair", freeze: false });
      await page.waitForTimeout(800);
      await eng("debugView", { freeze: true });
      await shot(`time-${tag}`, `${h}h day 200, fair`);
    }
    await eng("debugView", { hour: 23.5, dayOfYear: 200, regime: "clear", skyAim: "moons", freeze: true });
    await shot("sky-moons", "camera aimed between the moons, 23.5h, clear");
    await eng("debugView", { hour: 16, dayOfYear: 200, regime: "storm", skyAim: "sun", freeze: true });
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
