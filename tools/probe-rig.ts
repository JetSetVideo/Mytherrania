// deno-lint-ignore-file no-explicit-any
// Measure the built rig per race: world bounding box, height, pivot positions and mesh
// count. Numbers, not impressions — so a silhouette claim can be checked.
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";
import { BODY_PARTS, BODY_STATES, constraintList, RACE_SILHOUETTE } from "../src/game/BodyProfile.ts";
import { partExtent } from "../src/graphics/BodySurface.ts";
import { withinConstraint } from "../src/game/ShapeEquations.ts";
import { defaultHumanoid } from "../src/game/Skeleton.ts";

const PORT = 8818;
const server = Deno.serve({ hostname: "127.0.0.1", port: PORT, onListen() {} }, (r) => serveAsset(r));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await b.newPage({ viewport: { width: 800, height: 800 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e)));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 15000 });
await page.click('[data-action="start"]');
await page.waitForTimeout(1200);

for (const race of ["human", "dwarf", "elf", "ork"] as const) {
  await page.evaluate((r) => (globalThis as any).__MYTHERRANIA__.engine.debugSetModel({ race: r, subrace: null, className: "Warrior" }), race);
  await page.waitForTimeout(700);
  await page.evaluate(() => (globalThis as any).__MYTHERRANIA__.engine.debugView({ pose: "idle" }));
  const info = await page.evaluate(() => (globalThis as any).__MYTHERRANIA__.engine.debugRigInfo());
  const p = info.pivots;
  console.log(
    `${race.padEnd(6)} height=${info.height} y[${info.min[1]}..${info.max[1]}] width=${(info.max[0] - info.min[0]).toFixed(3)} ` +
      `meshes=${info.meshes} spine=${JSON.stringify(p.spine)} head=${JSON.stringify(p.head)} kneeL=${JSON.stringify(p.kneeL)} ankleL=${JSON.stringify(p.ankleL)}`,
  );
}
await b.close(); server.shutdown();

// ---- Silhouette extents and the complete state x joint constraint lists. Pure model,
// so it needs no browser: this is the same data the rig builds from.
console.log("\n=== part extents per race (metres) ===");
for (const race of Object.keys(RACE_SILHOUETTE)) {
  const s = RACE_SILHOUETTE[race];
  const row = BODY_PARTS.map((p) => {
    const e = partExtent(p, s);
    return `${p}:${e.width.toFixed(2)}x${e.depth.toFixed(2)}`;
  });
  console.log(`${race.padEnd(6)} ${row.join("  ")}`);
}

const limits = defaultHumanoid().limits();
console.log("\n=== constraint list: joints per state (min..max rad, scale) ===");
for (const state of BODY_STATES) {
  const list = constraintList(state, RACE_SILHOUETTE.human, limits);
  const ok = list.every((c) => withinConstraint(c.rest, c) && c.min <= c.max);
  console.log(`${state.padEnd(8)} joints=${String(list.length).padStart(2)} allValid=${ok}`);
}

