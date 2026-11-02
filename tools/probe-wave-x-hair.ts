// deno-lint-ignore-file no-explicit-any -- QA probe.
// Wave X lane H probe: the grown hair in real Chrome.
//   1. BUILD_OUT=dist-hair deno task build (the game bundle with the new hair) + a QA bundle of
//      src/graphics/body/HairQaPage.ts (head close-ups through the game's own preview build path);
//   2. serve dist-hair on its own port (8817) with the game's CSP;
//   3. screenshot every race x sex at a young and an elder age (front + back) into
//      artifacts/qa-wave-x/hair/, record hair and rig triangle counts;
//   4. open the real game (index.html) and its Creator so the live bundle runs the new hair too;
//   5. 0 page errors (console errors are reported separately).
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";

const OUT_DIR = "dist-hair";
const SHOTS = "artifacts/qa-wave-x/hair";
const PORT = 8817;
await Deno.mkdir(SHOTS, { recursive: true });

async function run(cmd: string[], env: Record<string, string> = {}): Promise<void> {
  const r = await new Deno.Command(cmd[0], { args: cmd.slice(1), env, stdout: "inherit", stderr: "inherit" }).output();
  if (!r.success) throw new Error(`${cmd.join(" ")} failed (${r.code})`);
}
await run([Deno.execPath(), "task", "build"], { BUILD_OUT: OUT_DIR });
await run([Deno.execPath(), "bundle", "--platform=browser", "--format=esm", "--minify", `--output=${OUT_DIR}/hairqa.js`, "src/graphics/body/HairQaPage.ts"]);
await Deno.writeTextFile(`${OUT_DIR}/hairqa.html`,
  `<!doctype html><html><head><meta charset="utf-8"><title>hair QA</title></head><body><canvas id="c" width="640" height="640"></canvas><script type="module" src="hairqa.js"></script></body></html>`);

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const server = Deno.serve({ hostname: "127.0.0.1", port: PORT, onListen() {} }, async (req) => {
  const path = new URL(req.url).pathname;
  if (path === "/hairqa.html" || path === "/hairqa.js") {
    const body = await Deno.readFile(`${OUT_DIR}${path}`);
    return new Response(body, { headers: { "Content-Type": path.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": CSP } });
  }
  return serveAsset(req, OUT_DIR);
});

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const pageErrors: string[] = [], consoleErrors: string[] = [];
const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/hairqa.html`, { waitUntil: "load" });
await page.waitForFunction(() => (globalThis as any).__HAIRQA__, null, { timeout: 20000 });

const ANC: [string, string | null][] = [["human", null], ["elf", null], ["dwarf", null], ["ork", null], ["human", "nomad"], ["elf", "wood"], ["dwarf", "mountain"]];
const rows: any[] = [];
for (const [race, subrace] of ANC) {
  for (const sex of ["male", "female"] as const) {
    for (const age of ["young", "elder"] as const) {
      for (const view of (age === "elder" && sex === "male" ? ["front", "back", "side", "detail"] : ["front", "back", "side"]) as ("front" | "back" | "side" | "detail")[]) {
        const name = `Hairqa ${race} ${subrace ?? ""} ${sex}`;
        const r = await page.evaluate((a) => (globalThis as any).__HAIRQA__.show(a), { race, subrace, sex, age, name, view });
        const file = `${SHOTS}/${race}${subrace ? "-" + subrace : ""}-${sex}-${age}-${view}.png`;
        await (await page.$("#c"))!.screenshot({ path: file });
        rows.push({ ...r, race, subrace, sex, view, file, ageYears: r.age, age });
      }
    }
  }
}

// The real game bundle: the title, then the Creator (its live preview builds the new hair).
const game = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
game.on("pageerror", (e) => pageErrors.push(`game: ${String(e)}`));
game.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`game: ${m.text()}`); });
await game.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
await game.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
await game.click('[data-action="start"]').catch(() => {});
await game.waitForTimeout(1500);
for (const race of ["dwarf", "elf"]) {
  await game.evaluate((r) => { ([...document.querySelectorAll(".race-card")].find((x) => (x as HTMLElement).dataset.race === r) as HTMLElement)?.click(); }, race);
  await game.waitForTimeout(1200);
  await game.screenshot({ path: `${SHOTS}/game-creator-${race}.png` });
}

const front = rows.filter((r) => r.view === "front");
const report = {
  shots: rows.length + 2,
  pageErrors, consoleErrors,
  maxHairTris: Math.max(...rows.map((r) => r.hairTris)),
  maxRigTris: Math.max(...rows.map((r) => r.rigTris)),
  table: front.map((r) => ({
    who: `${r.race}${r.subrace ? "/" + r.subrace : ""} ${r.sex} ${r.age}`, years: r.ageYears, style: r.hair?.style, tier: r.hair?.tier, braids: r.hair?.braids,
    follicles: r.hair?.follicles, clumps: r.hair?.clumps, grey: r.hair?.grey, recession: r.hair?.recession, minClearanceMm: r.hair ? +(r.hair.minClearance * 1000).toFixed(2) : null,
    hairTris: r.hairTris, rigTris: r.rigTris, meshes: r.meshes,
  })),
};
await Deno.writeTextFile(`${SHOTS}/report.json`, JSON.stringify({ ...report, rows }, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
await server.shutdown();
if (pageErrors.length > 0) Deno.exit(1);
