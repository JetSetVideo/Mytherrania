// Animation probe (step 3 of the loop: look at it from every side). For each race, pins the
// player's plain swing at six beats of its five-phase timeline (guard, wind-up apex, contact, hit
// hold, recovery, settle) and photographs each from four sides (front, right, back, left) with the
// orbit camera on a clean stage; then lays the 24 frames out on ONE contact sheet per race
// (rows = sides, columns = beats) by screenshotting an HTML grid in the same browser.
//   deno task build && deno run -A tools/probe-anim.ts [outDir]
//   ANIM_RACES="human:nomad,ork:ironhide" to pick races; ANIM_POOLS="0.2,0.3,0.05" (hp, mana,
//   stamina fractions; stamina < 0.1 also sets exhausted) to photograph a tired/hurt fighter.
import { chromium } from "playwright";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { serveAsset } from "./serve.ts";

const OUT = Deno.args[0] ?? "artifacts/qa-anim";
await Deno.mkdir(OUT, { recursive: true });
const server = Deno.serve({ hostname: "127.0.0.1", port: 8792, onListen() {} }, (r) => serveAsset(r));
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
// deno-lint-ignore no-explicit-any
const eng = (fn: string, arg?: unknown) => page.evaluate(([f, a]) => (globalThis as any).__MYTHERRANIA__.engine[f as string](a), [fn, arg] as const);

const RACES = (Deno.env.get("ANIM_RACES") ?? "human:nomad,elf:wood,dwarf:mountain,ork:ironhide").split(",").map((s) => s.split(":") as [string, string]);
const POOLS = Deno.env.get("ANIM_POOLS")?.split(",").map(Number);
/** ANIM_WEAPON=warhammer (any archetype id) to photograph that weapon's swing. */
const WEAPON = Deno.env.get("ANIM_WEAPON");
const SIDES: [string, number][] = [["front", 0], ["right", Math.PI / 2], ["back", Math.PI], ["left", -Math.PI / 2]];
const report: Record<string, unknown>[] = [];
const tag = (POOLS ? `-hp${POOLS[0]}` : "") + (WEAPON ? `-${WEAPON}` : "");

try {
  await page.goto("http://127.0.0.1:8792/", { waitUntil: "load" });
  await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__MYTHERRANIA__, null, { timeout: 20000 });
  await page.click('[data-action="start"]');
  await page.waitForTimeout(300);
  await page.click('[data-action="begin"]');
  await page.waitForTimeout(900);
  for (const [race, subrace] of RACES) {
    await eng("debugSetModel", { race, subrace, className: "Warrior", ...(WEAPON ? { weaponType: WEAPON } : {}) });
    await page.waitForTimeout(800);
    if (POOLS) {
      await eng("debugWorld", { pools: { hp: POOLS[0], mana: POOLS[1], stamina: POOLS[2], exhausted: POOLS[2] < 0.1 } });
      await page.waitForTimeout(2500); // the live style eases toward the new pools
    }
    await eng("debugView", { freeze: true, hour: 13, dayOfYear: 200, regime: "clear", clean: true, swingHold: { at: 0 } });
    // deno-lint-ignore no-explicit-any
    const info: any = await eng("debugSwingInfo");
    const ph = info.phases;
    const total = ph.windup + ph.strike + ph.hold + ph.recover + ph.settle;
    const beats: [string, number][] = [
      ["guard", 0], ["wind-up", ph.windup * 0.97], ["contact", ph.contactAt], ["hold", ph.windup + ph.strike + ph.hold * 0.6],
      ["recovery", ph.windup + ph.strike + ph.hold + ph.recover * 0.5], ["settle", total * 0.985],
    ];
    const cells: { side: string; beat: string; file: string }[] = [];
    for (const [side, yaw] of SIDES) {
      for (const [beat, t] of beats) {
        await eng("debugView", { freeze: true, clean: true, swingHold: { at: t / total }, orbit: { yaw, pitch: 0.18, dist: 3.4 } });
        await page.waitForTimeout(450);
        const file = `${OUT}/${race}${tag}-${side}-${beat}.png`;
        await page.screenshot({ path: file });
        cells.push({ side, beat, file });
      }
    }
    const sheet = await browser.newPage({ viewport: { width: 6 * 360, height: 4 * 225 + 28 }, deviceScaleFactor: 1 });
    const img = (f: string) => `data:image/png;base64,${encodeBase64(Deno.readFileSync(f))}`;
    const head = beats.map(([b, t]) => `<div>${b} ${t.toFixed(2)}s</div>`).join("");
    const rows = SIDES.map(([s]) => cells.filter((c) => c.side === s).map((c) => `<img src="${img(c.file)}">`).join("")).join("");
    await sheet.setContent(`<style>body{margin:0;background:#111;color:#eee;font:14px sans-serif}.h{display:grid;grid-template-columns:repeat(6,360px);height:28px;line-height:28px;text-align:center}.g{display:grid;grid-template-columns:repeat(6,360px)}img{width:360px;height:225px;display:block}</style><div class="h">${head}</div><div class="g">${rows}</div>`);
    await sheet.screenshot({ path: `${OUT}/sheet-${race}${tag}.png` });
    await sheet.close();
    report.push({ race, subrace, pools: POOLS ?? null, weapon: info.weapon, kind: info.kind, phases: ph });
    console.log(`${race}/${subrace}${tag} ${info.weapon} (${info.kind}): windup ${ph.windup.toFixed(3)} strike ${ph.strike.toFixed(3)} hold ${ph.hold.toFixed(3)} recover ${ph.recover.toFixed(3)} settle ${ph.settle.toFixed(3)} contact ${ph.contactAt.toFixed(3)} -> sheet-${race}${tag}.png`);
  }
} finally {
  await Deno.writeTextFile(`${OUT}/report${tag}.json`, JSON.stringify({ errors, report }, null, 1));
  console.log(`errors: ${errors.length}`);
  for (const e of errors.slice(0, 8)) console.log(`  ${e.slice(0, 300)}`);
  await browser.close();
  await server.shutdown();
}
