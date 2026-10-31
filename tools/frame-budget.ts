// Frame-budget measurement with an in-process server: samples the CPU cost of
// each engine frame (rAF callback time), the frame-to-frame cadence, and GPU
// time via EXT_disjoint_timer_query_webgl2 when the driver exposes it, during a
// live AI-vs-AI fight at day and at night. Wave I (lane I-E) adds a SPECTATOR
// sample with the free spectator camera and the new clash/effects work switched
// on when the build exposes them. Writes artifacts/frame-budget.json.
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";
import { summarise } from "../src/game/FrameBudget.ts";

/** The 60 FPS frame budget every sample is measured against, in milliseconds. */
const BUDGET_MS = 16.6;

const server = Deno.serve({ hostname: "127.0.0.1", port: 8791, onListen() {} }, (r) => serveAsset(r));
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
  // Wrap rAF: time each callback (CPU work per frame) and the interval between frames. When the
  // driver exposes EXT_disjoint_timer_query_webgl2 on the engine's OWN WebGL2 context, also time
  // the GPU work of each callback by bracketing it with a TIME_ELAPSED query (the pattern used by
  // tools/browser-probe.ts). gpuSupported records whether the timer was available at all.
  const state = {
    cpu: [] as number[],
    gap: [] as number[],
    gpu: [] as number[],
    gpuSupported: false,
    renderer: "unknown",
  };
  let last = 0;
  let gl: WebGL2RenderingContext | null = null;
  let ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  const pending: WebGLQuery[] = [];
  // Capture the context the moment the engine asks for one (canvas overloads cannot forward an
  // arbitrary overload, but the runtime arguments are unchanged).
  const nativeContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
    const result = Reflect.apply(nativeContext, this, args);
    if (args[0] === "webgl2" && result) {
      gl = result as WebGL2RenderingContext;
      ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
      state.gpuSupported = !!ext;
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      state.renderer = debug
        ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : String(gl.getParameter(gl.RENDERER));
    }
    return result;
  } as typeof nativeContext;
  const raf = globalThis.requestAnimationFrame.bind(globalThis);
  const push = (a: number[], v: number) => {
    if (a.length < 4800) a.push(v);
  };
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
    raf((t) => {
      if (last) push(state.gap, t - last);
      last = t;
      if (gl && ext) {
        if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
          for (const q of pending) gl.deleteQuery(q);
          pending.length = 0;
        } else {
          while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
            const q = pending.shift()!;
            push(state.gpu, gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
            gl.deleteQuery(q);
          }
        }
      }
      const query = gl && ext && pending.length < 8 ? gl.createQuery() : null;
      if (query) gl!.beginQuery(ext!.TIME_ELAPSED_EXT, query);
      const s = performance.now();
      try {
        cb(t);
      } finally {
        push(state.cpu, performance.now() - s);
        if (query) {
          gl!.endQuery(ext!.TIME_ELAPSED_EXT);
          pending.push(query);
        }
      }
    });
  (globalThis as Record<string, unknown>).__frames = state;
});
await page.goto("http://127.0.0.1:8791/", { waitUntil: "load" });
await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__MYTHERRANIA__);
await page.click('[data-action="spectate"]');

type Summary = { n: number; mean: number; p50: number; p95: number; p99: number; max: number };
const round3 = (s: Summary): Summary => ({
  n: s.n,
  mean: +s.mean.toFixed(3),
  p50: +s.p50.toFixed(3),
  p95: +s.p95.toFixed(3),
  p99: +s.p99.toFixed(3),
  max: +s.max.toFixed(3),
});
// Reuse the governor module's arithmetic (no fourth copy of quantile/summarize).
const stats = (a: number[]): Summary => round3(summarise(a));
/** Headroom left against the 60 FPS budget at the p99 frame; negative means a miss. */
const headroomMsP99 = (a: number[]) => +(BUDGET_MS - summarise(a).p99).toFixed(3);

interface Sample {
  cpuMs: Summary;
  frameGapMs: Summary;
  gpuMs: Summary | null;
  cpuHeadroomMsP99: number;
  polygons: number;
  phase: string;
  freeCamera?: boolean;
  effects?: boolean;
}
const result: { day?: Sample; night?: Sample; spectate?: Sample; environment?: unknown } = {};
const lines: string[] = [];

for (const [tag, hour] of [["day", 12], ["night", 23]] as const) {
  await page.evaluate((h) => {
    // deno-lint-ignore no-explicit-any
    const g = globalThis as Record<string, any>;
    g.__MYTHERRANIA__.engine.debugView({ hour: h });
    g.__frames.cpu.length = 0;
    g.__frames.gap.length = 0;
    g.__frames.gpu.length = 0;
  }, hour);
  await page.waitForTimeout(4000);
  // deno-lint-ignore no-explicit-any
  const f = await page.evaluate(() => (globalThis as any).__frames);
  // deno-lint-ignore no-explicit-any
  const snap = await page.evaluate(() => (globalThis as any).__MYTHERRANIA__.snapshot());
  const sample: Sample = {
    cpuMs: stats(f.cpu),
    frameGapMs: stats(f.gap),
    gpuMs: f.gpu.length ? stats(f.gpu) : null,
    cpuHeadroomMsP99: headroomMsP99(f.cpu),
    polygons: snap.polygons,
    phase: snap.world.dayPhase,
  };
  result[tag] = sample;
  lines.push(
    `[${tag}] cpuMs p50/p95/p99/max ${sample.cpuMs.p50}/${sample.cpuMs.p95}/${sample.cpuMs.p99}/${sample.cpuMs.max} ms, headroom ${sample.cpuHeadroomMsP99} ms of ${BUDGET_MS}, cadence p50 ${sample.frameGapMs.p50} ms, gpu ${sample.gpuMs ? `p95 ${sample.gpuMs.p95} ms` : "unavailable"}`,
  );
}

// ------------------------------------------------------------------ Wave I spectator sample
// The match is already AI vs AI (the spectate click above); this sample additionally asks the
// build to switch on the FREE spectator camera and the new clash/effects work. Those hooks belong
// to other Wave I lanes and to the parent's wiring, so each is called ONLY if present — the tool
// keeps working before they merge, and records exactly what it managed to enable.
const spectateFlags = await page.evaluate(() => {
  const g = globalThis as Record<string, unknown>;
  const eng = (g.__MYTHERRANIA__ as { engine?: Record<string, unknown> } | undefined)?.engine ?? {};
  const on = (names: string[]) => {
    for (const n of names) {
      const fn = eng[n];
      if (typeof fn === "function") {
        // Called with the engine as `this`: these debug hooks are class methods, and an extracted
        // method loses its private fields (Wave-K run: `debugSpectateCam` threw reading `#q`).
        (fn as (this: unknown, v: unknown) => void).call(eng, true);
        return true;
      }
    }
    return false;
  };
  const clear = (g.__frames as { cpu: number[]; gap: number[]; gpu: number[] } | undefined);
  if (clear) {
    clear.cpu.length = 0;
    clear.gap.length = 0;
    clear.gpu.length = 0;
  }
  return {
    freeCamera: on(["debugFreeCamera", "debugSpectatorCamera", "debugSpectateCam"]),
    effects: on(["debugEffects", "debugSpectatorEffects", "debugSparks"]),
  };
});
await page.waitForTimeout(4000);
// deno-lint-ignore no-explicit-any
const sf = await page.evaluate(() => (globalThis as any).__frames);
// deno-lint-ignore no-explicit-any
const ssnap = await page.evaluate(() => (globalThis as any).__MYTHERRANIA__.snapshot());
result.spectate = {
  cpuMs: stats(sf.cpu),
  frameGapMs: stats(sf.gap),
  gpuMs: sf.gpu.length ? stats(sf.gpu) : null,
  cpuHeadroomMsP99: headroomMsP99(sf.cpu),
  polygons: ssnap.polygons,
  phase: ssnap.world.dayPhase,
  freeCamera: spectateFlags.freeCamera,
  effects: spectateFlags.effects,
};
lines.push(
  `[spectate] cpuMs p50/p95/p99/max ${result.spectate.cpuMs.p50}/${result.spectate.cpuMs.p95}/${result.spectate.cpuMs.p99}/${result.spectate.cpuMs.max} ms, headroom ${result.spectate.cpuHeadroomMsP99} ms of ${BUDGET_MS}, cadence p50 ${result.spectate.frameGapMs.p50} ms, gpu ${result.spectate.gpuMs ? `p95 ${result.spectate.gpuMs.p95} ms` : "unavailable"}, freeCamera ${spectateFlags.freeCamera}, effects ${spectateFlags.effects}`,
);

// deno-lint-ignore no-explicit-any
const glInfo = await page.evaluate(() => (globalThis as any).__frames);
result.environment = {
  browser: browser.version(),
  headless: true,
  viewport: "1440x900",
  budgetMs: BUDGET_MS,
  gpuTimer: {
    available: !!glInfo.gpuSupported,
    renderer: glInfo.renderer,
    note: glInfo.gpuSupported
      ? "EXT_disjoint_timer_query_webgl2 exposed; gpuMs is the per-frame TIME_ELAPSED result"
      : "EXT_disjoint_timer_query_webgl2 NOT exposed by this driver/build; gpuMs is null",
  },
  note:
    "headless lab sample; frameGap reflects headless vsync throttling, cpuMs is the engine's own per-frame cost; cpuHeadroomMsP99 = 16.6 - p99 cpuMs (negative = budget missed)",
};
await Deno.writeTextFile("artifacts/frame-budget.json", JSON.stringify(result, null, 2));
console.log(lines.join("\n"));
console.log(
  `GPU timer available: ${!!glInfo.gpuSupported}${
    glInfo.gpuSupported ? ` (${glInfo.renderer})` : " (EXT_disjoint_timer_query_webgl2 not exposed by the driver)"
  }`,
);
console.log(JSON.stringify(result, null, 2));
await browser.close();
await server.shutdown();
