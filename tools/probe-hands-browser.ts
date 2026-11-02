// Hand probe, browser half (wave W, lane H): real-Chrome close-ups of the weapon hand at the guard.
//   deno task build && deno run -A tools/probe-hands-browser.ts [--dist <dir>] [--tag after] [--ids axe,dagger,longsword,spear] [--race human:nomad]
// For each weapon: debugSetModel → guard (swingHold 0) → orbit the hand (lane G's `target: "hand"`) from
// the side, the front (palm) and the back of the hand. Copies tools/probe-grip.ts's harness (lane G's
// file is shared/read-only for this lane). Writes artifacts/wave-w/lane-H/browser-<tag>/<race>-<id>-<view>.png
// and a sheet per race; prints page errors.
import { chromium } from "playwright";
import { encodeBase64 } from "@std/encoding/base64";
import { serveAsset } from "./serve.ts";

export async function browserHands(out: string): Promise<void> {
  const args = Deno.args;
  const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const dist = opt("--dist", "dist"), tag = opt("--tag", "after");
  const ids = opt("--ids", "axe,dagger,longsword,spear").split(",");
  const races = opt("--race", "human:nomad,ork:ironhide,elf:high,dwarf:mountain").split(",");
  const dir = `${out}/browser-${tag}`;
  await Deno.mkdir(dir, { recursive: true });
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (r) => serveAsset(r, dist));
  const port = (server.addr as Deno.NetAddr).port;
  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true, args: ["--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // deno-lint-ignore no-explicit-any
  const eng = (fn: string, arg?: unknown): Promise<any> => page.evaluate(([f, a]) => {
    // deno-lint-ignore no-explicit-any
    const e = (globalThis as any).__MYTHERRANIA__.engine;
    return e[f as string].call(e, a);
  }, [fn, arg] as const);
  const shots: Record<string, string[]> = {};
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__MYTHERRANIA__, null, { timeout: 20000 });
    await page.click('[data-action="start"]').catch(() => {});
    await page.waitForTimeout(300);
    await page.click('[data-action="begin"]').catch(() => {});
    await page.waitForTimeout(900);
    for (const rs of races) {
      const [race, sub] = rs.split(":");
      shots[race] = [];
      for (const id of ids) {
        await eng("debugSetModel", { race, subrace: sub ?? null, className: "Warrior", weaponType: id });
        await page.waitForTimeout(700);
        await eng("debugView", { freeze: true, hour: 13, dayOfYear: 200, regime: "clear", clean: true, swingHold: { at: 0 } });
        await page.waitForTimeout(250);
        const g = await eng("debugGripInfo");
        const fy = g ? Math.atan2(g.facing[0], g.facing[2]) : 0;
        // The back view stands further off: closer, the camera sits inside the fighter's own torso.
        const near = Number(opt("--dist-cam", "0.42"));
        for (const [view, yaw, pitch, dist] of [["side", fy - Math.PI / 2, 0.15, near], ["front", fy + 0.35, 0.1, near], ["back", fy + Math.PI - 0.5, 0.35, 0.75]] as [string, number, number, number][]) {
          await eng("debugView", { freeze: true, clean: true, swingHold: { at: 0 }, orbit: { yaw, pitch, dist, target: "hand" } });
          await page.waitForTimeout(350);
          const file = `${dir}/${race}-${id}-${view}.png`;
          await page.screenshot({ path: file });
          shots[race].push(file);
        }
        console.log(`${race} ${id}: shot`);
      }
      // Sheet: rows = weapons, columns = side / front / back.
      const img = (f: string) => `data:image/png;base64,${encodeBase64(Deno.readFileSync(f))}`;
      const sheet = await browser.newPage({ viewport: { width: 3 * 280 + 90, height: ids.length * 210 }, deviceScaleFactor: 1 });
      const rows = ids.map((id, k) => `<div class="l">${id}</div>` + shots[race].slice(k * 3, k * 3 + 3).map((f) => `<img src="${img(f)}">`).join("")).join("");
      await sheet.setContent(`<style>body{margin:0;background:#111;color:#eee;font:13px sans-serif}.g{display:grid;grid-template-columns:90px repeat(3,280px)}.l{line-height:210px;text-align:center}img{width:280px;height:210px;display:block}</style><div class="g">${rows}</div>`);
      await sheet.screenshot({ path: `${dir}/sheet-${race}.png` });
      await sheet.close();
    }
  } finally {
    console.log(`page errors: ${errors.length}${errors.length ? " " + errors.slice(0, 3).join(" | ") : ""}`);
    await browser.close();
    await server.shutdown();
  }
}

/** BEFORE | AFTER side by side per race: <out>/compare-<race>.png (needs both browser-* runs). */
export async function compareSheets(out: string): Promise<void> {
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  for await (const e of Deno.readDir(`${out}/browser-after`)) {
    if (!e.name.startsWith("sheet-")) continue;
    const race = e.name.slice(6, -4);
    const img = (f: string) => `data:image/png;base64,${encodeBase64(Deno.readFileSync(f))}`;
    const page = await browser.newPage({ viewport: { width: 2 * 930 + 30, height: 4 * 210 + 40 }, deviceScaleFactor: 1 });
    await page.setContent(`<style>body{margin:0;background:#111;color:#eee;font:15px sans-serif;display:flex;gap:30px}div{text-align:center}img{display:block;width:930px}</style><div>BEFORE (wave V mitten)<img src="${img(`${out}/browser-before/${e.name}`)}"></div><div>AFTER (fingers)<img src="${img(`${out}/browser-after/${e.name}`)}"></div>`);
    await page.screenshot({ path: `${out}/compare-${race}.png`, fullPage: true });
    await page.close();
  }
  await browser.close();
}

if (import.meta.main) {
  if (Deno.args.includes("--compare")) await compareSheets("artifacts/wave-w/lane-H");
  else await browserHands("artifacts/wave-w/lane-H");
}
