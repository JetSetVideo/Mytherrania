// QA matrix: serves dist/ in-process (no external server needed), drives headless
// Chrome through a grid of world times × places × camera angles, captures PNGs and
// a JSON manifest of engine snapshots so reviewers can compare picture vs state.
//   deno run -A tools/qa-matrix.ts [outDir]
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";
import { moonPositions, solarPosition } from "../src/graphics/Environment.ts";

// Search the calendar for a night when both moons are well up and close enough to share one frame.
function twoMoonNight(): { day: number; hour: number; sepDeg: number } {
  let best = { day: 283, hour: 1, sepDeg: 999 };
  for (let day = 283; day < 343; day++) for (let h = 0; h < 24; h += 0.25) {
    if (solarPosition(day, h, 12).elevation * 57.3 > -12) continue;
    const [a, b] = moonPositions(h, day);
    if (a.dir[1] < 0.25 || b.dir[1] < 0.25) continue;
    const sep = Math.acos(Math.min(1, a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1] + a.dir[2] * b.dir[2])) * 57.3;
    if (sep < best.sepDeg) best = { day, hour: h, sepDeg: sep };
  }
  return best;
}

const OUT = Deno.args[0] ?? "artifacts/qa-v4";
await Deno.mkdir(OUT, { recursive: true });
const server = Deno.serve({ hostname: "127.0.0.1", port: 8790, onListen() {} }, (r) => serveAsset(r));
const base = "http://127.0.0.1:8790/";

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

type View = { hour?: number; dayOfYear?: number; place?: number; camera?: string; firstPerson?: boolean; freeze?: boolean; skyAim?: "sun" | "moon" | "moons" | null };
const manifest: Record<string, unknown>[] = [];
const debug = (v: View) => page.evaluate((o) => {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).__MYTHERRANIA__.engine.debugView(o);
}, v);
// deno-lint-ignore no-explicit-any
const snap = () => page.evaluate(() => (globalThis as any).__MYTHERRANIA__.snapshot());
async function shot(name: string, note: string) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 15000 });
  manifest.push({ name, note, snapshot: await snap() });
  console.log(`  ${name}  — ${note}`);
}

try {
  await page.goto(base, { waitUntil: "load" });
  await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__MYTHERRANIA__, null, { timeout: 15000 });

  // 1. Title screen at four times of day (menu overlay over the live sky).
  for (const [h, tag] of [[12, "noon"], [18.3, "dusk"], [23, "night"]] as const) {
    await debug({ hour: h, dayOfYear: 283, place: 0 });
    await shot(`01-title-${tag}`, `title screen, ${h}h, Sunspire Steppe`);
  }

  // 2. Start a player fight, freeze the simulation, sweep time × place × camera.
  await page.click('[data-action="start"]');
  await page.waitForTimeout(300);
  await page.click('[data-action="begin"]');
  await page.waitForTimeout(600);
  await debug({ freeze: true, camera: "third", firstPerson: false });
  await shot("02-fight-start-third", "fight start: camera must be behind the player, facing the opponent");

  const times: [number, string][] = [[6.4, "dawn"], [9.5, "morning"], [12.5, "noon"], [17.9, "dusk"], [22.5, "night"]];
  for (const [h, tag] of times) {
    await debug({ hour: h, dayOfYear: 283, place: 0, camera: "third" });
    await shot(`03-time-${tag}`, `third-person, ${h}h, Sunspire Steppe (lat 12)`);
  }
  await debug({ hour: 16, dayOfYear: 283, place: 0, camera: "third", skyAim: "sun" } as View);
  await shot("03-sky-sun-16h", "camera aimed at the sun, 16h (sun disc + halo)");
  const tm = twoMoonNight();
  await debug({ hour: tm.hour, dayOfYear: tm.day, place: 0, camera: "third", skyAim: "moons" } as View);
  await shot("03-sky-two-moons", `both moons in frame: day ${tm.day} ${tm.hour}h, separation ${tm.sepDeg.toFixed(1)}°`);
  await debug({ hour: 13, dayOfYear: 283, place: 3, camera: "third", skyAim: "sun" } as View);
  await shot("03-sky-frostford-clouds", "Frostford cloudiness 0.65, aimed at the sun: heavy cloud");
  await debug({ hour: 13, dayOfYear: 283, place: 0, camera: "third", skyAim: "sun" } as View);
  await shot("03-sky-sunspire-clouds", "Sunspire cloudiness 0.25, aimed at the sun: lighter cloud (compare)");
  await debug({ skyAim: null } as View);
  // Shadow series: the sun climbs from 6° to 66°, so the cast shadow must shorten.
  for (const [h, tag] of [[6.6, "elev06"], [7.2, "elev15"], [9.0, "elev38"], [12.5, "elev66"]] as const) {
    await debug({ hour: h, dayOfYear: 283, place: 0, camera: "isometric", skyAim: null } as View);
    await shot(`03-shadow-${tag}`, `isometric at ${h}h — shadow length should shrink as the sun rises`);
  }
  await debug({ camera: "third" } as View);
  for (const [pi, tag] of [[1, "greywall"], [3, "frostford"]] as const) {
    await debug({ hour: 12.5, dayOfYear: 355, place: pi, camera: "third" });
    await shot(`04-place-${tag}-december-noon`, `third-person, 12.5h, day 355, place ${tag}`);
  }
  for (const cam of ["close", "isometric", "birds-eye"]) {
    await debug({ hour: 15, dayOfYear: 283, place: 2, camera: cam });
    await shot(`05-camera-${cam}`, `${cam} camera, 15h, Verdant Hills`);
  }
  await debug({ camera: "third", firstPerson: true, hour: 15 });
  await shot("06-first-person", "first-person view, 15h");
  await debug({ firstPerson: false });

  // 3. Spectate AI-vs-AI to completion so History has a real record.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await debug({ freeze: false });
  await page.click('[data-action="spectate"]');
  await page.waitForTimeout(300);
  await debug({ hour: 14, camera: "isometric" });
  await shot("07a-spectate-start", "AI vs AI, menu hidden; rings green (calm) or orange (closing in)");
  // Poll for a frame where someone is attacking/hit → red rings.
  const t0 = Date.now();
  let gotRed = false;
  while (Date.now() - t0 < 75000) {
    const s = await snap();
    if (s.winner) break;
    const d = Math.hypot(s.player.x - s.opponent.x, s.player.z - s.opponent.z);
    if (!gotRed && d < 2.4 && (s.player.pose === "attack" || s.opponent.pose === "attack" || s.player.pose === "hit" || s.opponent.pose === "hit")) {
      await page.screenshot({ path: `${OUT}/07b-spectate-clash.png` });
      manifest.push({ name: "07b-spectate-clash", note: "AI clash: at least one ring red (attack/hit)", snapshot: s });
      console.log("  07b-spectate-clash");
      gotRed = true;
    }
    await page.waitForTimeout(120);
  }
  await shot("08-victory", "victory screen after spectate match");
  await page.click('[data-screen="victory"] [data-action="menu"]').catch(() => {});
  await page.waitForTimeout(300);
  await page.click('[data-action="digest"]');
  await shot("09-history", "History page after at least one recorded match");

  // 4. Responsive: the History page at mobile and large widths.
  for (const [w, h, tag] of [[390, 844, "mobile"], [820, 1180, "tablet"], [1920, 1080, "large"]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await shot(`10-history-${tag}`, `History page at ${w}×${h}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.querySelector(".table-scroll")?.scrollIntoView({ block: "start" }));
  await shot("10-history-mobile-matches", "mobile: matches table scrolled into view (must scroll inside its box)");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  manifest.push({ name: "check-mobile-overflow", horizontalOverflow: overflow });
} finally {
  await Deno.writeTextFile(`${OUT}/manifest.json`, JSON.stringify({ errors, shots: manifest }, null, 2));
  console.log(`errors: ${errors.length}`, errors.slice(0, 5));
  await browser.close();
  await server.shutdown();
}
