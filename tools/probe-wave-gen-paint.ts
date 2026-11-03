// deno-lint-ignore-file no-explicit-any -- QA probe.
// Wave GEN lane S probe: the miniature paint pass and intelligence -> hair, in real Chrome.
//   1. BUILD_OUT=dist-paint deno task build + a QA bundle of src/graphics/paint/MiniatureQaPage.ts
//      (characters built through the Creator's own buildPreviewRig path, drawn on the game's PreviewStage);
//   2. serve dist-paint on its own port (8823) with the game's CSP;
//   3. before/after shots of 4 races x 2 sexes (front, back, torso close-up) — "before" = the same bundle with
//      FORM_SHADE_QA.miniature = 0 — plus head shots at intelligence 0 / 500 / 1000 (young and elder);
//   4. per shot: figure luminance mean/std, upper vs lower figure luminance, build ms and draw ms (30 draws);
//   5. open the real game (index.html) and count page errors.
// Writes artifacts/qa-wave-gen/paint/report.json and prints a summary.
//   deno run -A tools/probe-wave-gen-paint.ts
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";

const OUT_DIR = "dist-paint";
const SHOTS = "artifacts/qa-wave-gen/paint";
const PORT = 8823;
await Deno.mkdir(SHOTS, { recursive: true });

async function run(cmd: string[], env: Record<string, string> = {}): Promise<void> {
  const r = await new Deno.Command(cmd[0], { args: cmd.slice(1), env, stdout: "inherit", stderr: "inherit" }).output();
  if (!r.success) throw new Error(`${cmd.join(" ")} failed (${r.code})`);
}
if (!Deno.env.get("SKIP_BUILD")) await run([Deno.execPath(), "task", "build"], { BUILD_OUT: OUT_DIR });
await run([Deno.execPath(), "bundle", "--platform=browser", "--format=esm", "--minify", `--output=${OUT_DIR}/paintqa.js`, "src/graphics/paint/MiniatureQaPage.ts"]);
await Deno.writeTextFile(`${OUT_DIR}/paintqa.html`,
  `<!doctype html><html><head><meta charset="utf-8"><title>paint QA</title></head><body><canvas id="c" width="560" height="760"></canvas><script type="module" src="paintqa.js"></script></body></html>`);

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const server = Deno.serve({ hostname: "127.0.0.1", port: PORT, onListen() {} }, async (req) => {
  const path = new URL(req.url).pathname;
  if (path === "/paintqa.html" || path === "/paintqa.js") {
    const body = await Deno.readFile(`${OUT_DIR}${path}`);
    return new Response(body, { headers: { "Content-Type": path.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": CSP } });
  }
  return serveAsset(req, OUT_DIR);
});

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const pageErrors: string[] = [], consoleErrors: string[] = [];
const page = await browser.newPage({ viewport: { width: 600, height: 800 } });
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/paintqa.html`, { waitUntil: "load" });
await page.waitForFunction(() => (globalThis as any).__PAINTQA__, null, { timeout: 20000 });

const rows: any[] = [];
async function shot(args: Record<string, unknown>, file: string) {
  const r = await page.evaluate((a) => (globalThis as any).__PAINTQA__.show(a), args);
  const all = await page.evaluate(() => (globalThis as any).__PAINTQA__.figureStats(0, 0, 1, 1));
  const upper = await page.evaluate(() => (globalThis as any).__PAINTQA__.figureStats(0, 0, 1, 0.45));
  const lower = await page.evaluate(() => (globalThis as any).__PAINTQA__.figureStats(0, 0.55, 1, 1));
  await (await page.$("#c"))!.screenshot({ path: `${SHOTS}/${file}` });
  const row = { ...args, file, buildMs: r.buildMs, frameMs: r.frameMs, tris: r.tris, hair: r.hair, mean: all.mean, std: all.std, upper: upper.mean, lower: lower.mean };
  rows.push(row);
  return row;
}

for (const race of ["human", "elf", "dwarf", "ork"]) {
  for (const sex of ["male", "female"]) {
    for (const view of ["front", "back", "torso"]) {
      for (const miniature of [0, 1]) await shot({ race, sex, view, miniature }, `${race}-${sex}-${view}-${miniature ? "after" : "before"}.png`);
    }
  }
}
for (const race of ["human", "elf", "dwarf"]) {
  for (const elder of [false, true]) {
    for (const intelligence of [0, 500, 1000]) {
      await shot({ race, sex: "male", view: "head", miniature: 1, intelligence, elder, name: `Sage ${race}` }, `int-${race}-${elder ? "elder" : "young"}-${intelligence}.png`);
    }
  }
}

// The real game bundle runs with the pass too.
const game = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const gameErrors: string[] = [];
game.on("pageerror", (e) => gameErrors.push(String(e)));
await game.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
await game.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
await game.waitForTimeout(1500);
await game.screenshot({ path: `${SHOTS}/game-title.png` });
await browser.close();
await server.shutdown();

// Pair before/after.
const pairs: any[] = [];
for (const r of rows.filter((x) => x.miniature === 1 && x.view !== "head")) {
  const b = rows.find((x) => x.miniature === 0 && x.race === r.race && x.sex === r.sex && x.view === r.view)!;
  pairs.push({ race: r.race, sex: r.sex, view: r.view, stdBefore: b.std, stdAfter: r.std, upperLowerBefore: b.upper / b.lower, upperLowerAfter: r.upper / r.lower, frameMsBefore: b.frameMs, frameMsAfter: r.frameMs, buildMsBefore: b.buildMs, buildMsAfter: r.buildMs });
}
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const summary = {
  shots: rows.length + 1, pageErrors: pageErrors.length + gameErrors.length, consoleErrors,
  meanStdBefore: mean(pairs.map((p) => p.stdBefore)), meanStdAfter: mean(pairs.map((p) => p.stdAfter)),
  meanUpperLowerBefore: mean(pairs.map((p) => p.upperLowerBefore)), meanUpperLowerAfter: mean(pairs.map((p) => p.upperLowerAfter)),
  meanFrameMsBefore: mean(pairs.map((p) => p.frameMsBefore)), meanFrameMsAfter: mean(pairs.map((p) => p.frameMsAfter)),
  meanBuildMsBefore: mean(pairs.map((p) => p.buildMsBefore)), meanBuildMsAfter: mean(pairs.map((p) => p.buildMsAfter)),
  hairByIntelligence: rows.filter((r) => r.view === "head").map((r) => ({ race: r.race, elder: r.elder, intelligence: r.intelligence, file: r.file, hair: r.hair, tris: r.tris })),
};
await Deno.writeTextFile(`${SHOTS}/report.json`, JSON.stringify({ summary, pairs, rows, pageErrors, gameErrors }, null, 2));
console.log(JSON.stringify(summary, null, 2));
