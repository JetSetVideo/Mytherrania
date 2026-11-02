// deno-lint-ignore-file no-explicit-any -- QA probe: reads the untyped debug globals.
// Wave FALL lane A probe: the fall / lying / get-up and shove animations in real Chrome.
//   1. BUILD_OUT=dist-anim deno task build (the game) + a QA bundle of src/game/anim/FallQaPage.ts
//      (the game's own rig + Skeleton + Animator, placed with the engine wiring, scripted inputs);
//   2. serve dist-anim on its own port (8851) with the game's CSP;
//   3. screenshot strips (one cell per phase) for every script x body into artifacts/qa-wave-fall/anim/,
//      with the skin's floor clearance at each cell;
//   4. LIVE: start a duel, debugPush the opponent (M's hook) and capture the fight frames + debugFall;
//   5. 0 page errors. Report: artifacts/qa-wave-fall/anim/report.json (printed).
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";

const OUT_DIR = Deno.env.get("BUILD_OUT") || "dist-anim";
const SHOTS = "artifacts/qa-wave-fall/anim";
const PORT = Number(Deno.env.get("PORT") ?? 8851);
await Deno.mkdir(SHOTS, { recursive: true });
for (const e of Deno.readDirSync(SHOTS)) if (e.name.startsWith("live-")) Deno.removeSync(`${SHOTS}/${e.name}`);

async function run(cmd: string[], env: Record<string, string> = {}): Promise<void> {
  const r = await new Deno.Command(cmd[0], { args: cmd.slice(1), env, stdout: "inherit", stderr: "inherit" }).output();
  if (!r.success) throw new Error(`${cmd.join(" ")} failed (${r.code})`);
}
await run([Deno.execPath(), "task", "build"], { BUILD_OUT: OUT_DIR });
await run([Deno.execPath(), "bundle", "--platform=browser", "--format=esm", "--minify", `--output=${OUT_DIR}/fallqa.js`, "src/game/anim/FallQaPage.ts"]);
await Deno.writeTextFile(`${OUT_DIR}/fallqa.html`,
  `<!doctype html><html><head><meta charset="utf-8"><title>fall QA</title></head><body><canvas id="c" width="480" height="420"></canvas><script type="module" src="fallqa.js"></script></body></html>`);

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const server = Deno.serve({ hostname: "127.0.0.1", port: PORT, onListen() {} }, async (req) => {
  const path = new URL(req.url).pathname;
  if (path === "/fallqa.html" || path === "/fallqa.js") {
    const body = await Deno.readFile(`${OUT_DIR}${path}`);
    return new Response(body, { headers: { "Content-Type": path.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": CSP } });
  }
  return serveAsset(req, OUT_DIR);
});

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const pageErrors: string[] = [];
const report: Record<string, any> = { strips: [] as any[], live: null };

// ---- 1. Strips on the QA stage. ----
{
  const page = await browser.newPage({ viewport: { width: 600, height: 500 } });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/fallqa.html`, { waitUntil: "load" });
  await page.waitForFunction(() => (globalThis as any).__FALLQA__, null, { timeout: 20000 });
  // Cell times: fall = stand, stagger, falling x2, down, rising x4, after; shove = stand, brace, impact, recoil x3, after.
  const RISE = 1.3;
  const fallAt = [0.45, 0.75, 1.1, 1.3, 1.9, 2.15 + RISE * 0.15, 2.15 + RISE * 0.4, 2.15 + RISE * 0.62, 2.15 + RISE * 0.8, 2.15 + RISE + 0.6];
  const shoveAt = [0.45, 0.6, 0.66, 0.8, 0.95, 1.15, 1.9];
  const reactAt = [0.45, 0.7, 0.9, 1.1, 1.3, 2.0];
  const jobs: [string, string, number[], "side" | "front"][] = [];
  for (const body of ["human", "humanF", "elf", "dwarf", "ork"]) for (const s of ["back", "front", "side"]) jobs.push([body, s, fallAt, s === "side" ? "front" : "side"]);
  for (const body of ["human", "dwarf", "ork"]) {
    jobs.push([body, "shove", shoveAt, "side"]);
    jobs.push([body, "stagger", reactAt, "side"]);
    jobs.push([body, "stumble", reactAt, "side"]);
  }
  for (const [body, s, at, view] of jobs) {
    const r = await page.evaluate(([b, n, rise, a, v]) => (globalThis as any).__FALLQA__.run(b, n, rise, a, v), [body, s, RISE, at, view] as const);
    const file = `${SHOTS}/${s}-${body}.png`;
    await Deno.writeFile(file, Uint8Array.from(atob(r.strip.split(",")[1]), (c) => c.charCodeAt(0)));
    const down = r.samples.filter((x: any) => x.phase === "down").map((x: any) => x.skin);
    report.strips.push({ body, script: s, file, cells: r.samples.map((x: any) => ({ tag: x.tag, t01: +x.t01.toFixed(2), skinMm: +(x.skin * 1000).toFixed(1) })), downSkinMm: down.map((v: number) => +(v * 1000).toFixed(1)) });
  }
  await page.close();
}

// ---- 2. LIVE fight (needs M's engine hooks: debugStartDuel / debugPush / debugFall). ----
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  p.on("pageerror", (e) => pageErrors.push(String(e)));
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await p.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
  await p.waitForTimeout(600);
  const call = (fn: string, ...args: unknown[]) =>
    p.evaluate(([f, a]) => { const e = (globalThis as any).__MYTHERRANIA__.engine; return typeof e[f as string] === "function" ? e[f as string].call(e, ...(a as unknown[])) : { missing: f }; }, [fn, args] as const);
  const hooks = await p.evaluate(() => ["debugStartDuel", "debugPush", "debugFall"].filter((f) => typeof (globalThis as any).__MYTHERRANIA__.engine[f] === "function"));
  if (hooks.length === 3) {
    await call("debugStartDuel", "Warrior", "Warrior");
    await p.waitForTimeout(1200);
    for (let i = 0; i < 8; i++) {
      const x = await call("debugClock"); await p.waitForTimeout(400); const y = await call("debugClock");
      if ((y.sinceStart ?? 0) > (x.sinceStart ?? 0) + 0.2) break;
      await p.click("canvas", { position: { x: 640, y: 400 } }).catch(() => {});
      await p.keyboard.press("Escape");
      await p.waitForTimeout(300);
    }
    await p.waitForTimeout(1500);
    const push = await call("debugPush", 1, [1, 0], 1, "hit");
    const frames: any[] = [];
    const t0 = Date.now();
    for (let k = 0; k < 14; k++) {
      const f = await call("debugFall");
      const s = f.seats?.[1] ?? {};
      const file = `${SHOTS}/live-${String(k).padStart(2, "0")}-${s.phase ?? "?"}.png`;
      await p.screenshot({ path: file });
      frames.push({ ms: Date.now() - t0, phase: s.phase, t: s.t, anim: s.anim ?? null, file });
      await p.waitForTimeout(220);
    }
    report.live = { push, frames };
  } else {
    report.live = { skipped: `engine hooks missing: ${["debugStartDuel", "debugPush", "debugFall"].filter((h) => !hooks.includes(h)).join(", ")}` };
  }
  await p.close();
}

report.pageErrors = pageErrors;
await browser.close();
await server.shutdown();
await Deno.writeTextFile(`${SHOTS}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({
  strips: report.strips.map((s: any) => `${s.script}-${s.body}: down skin mm ${JSON.stringify(s.downSkinMm)} cells ${s.cells.length}`),
  live: report.live?.skipped ?? report.live?.frames?.map((f: any) => f.phase).join(" "),
  pageErrors: pageErrors.length,
}, null, 1));
