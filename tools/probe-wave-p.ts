// Wave P QA probe: the parent's own claims, measured in a real Chrome.
//
// What this proves (and nothing else — the lanes' geometry laws are unit-tested, not measured here):
//   1. the Creator is ONE page: no tab nav, every panel visible, every group header carrying its
//      summary of CURRENT values (the "global parameter");
//   2. the viewer frames the SHORTEST and the TALLEST character by its own measured height, and the
//      distance follows the stated law;
//   3. turning is MANUAL (a drag moves yaw, nothing turns by itself, pitch is clamped);
//   4. the generation seed of a roll is recorded and shown;
//   5. the shaders still compile (0 broken programs) with the wave's ink/manga changes.
//
// Run: deno run -A tools/probe-wave-p.ts   (writes artifacts/qa-wave-p/probe.json)
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";

const PORT = 8831;
const server = Deno.serve({ hostname: "127.0.0.1", port: PORT, onListen() {} }, (r) => serveAsset(r));
const OUT = "artifacts/qa-wave-p";
await Deno.mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
await page.waitForFunction(() => (globalThis as unknown as { __MYTHERRANIA__?: unknown }).__MYTHERRANIA__ !== undefined, null, { timeout: 30000 });
// Enter the Creator the way a user does (there is no engine-side screen switch).
await page.click('[data-action="start"]').catch(() => {});
await page.waitForTimeout(1200);

// ── 1. one page, no tabs, summaries on the headers ────────────────────────────────
const page1 = await page.evaluate(() => {
  const screen = document.querySelector('[data-screen="select"]') as HTMLElement | null;
  const panels = [...(screen?.querySelectorAll<HTMLElement>("[data-panel]") ?? [])];
  const groups = [...(screen?.querySelectorAll<HTMLElement>(".opt-group") ?? [])];
  const summaries = groups.map((g) => (g.querySelector(".group-summary")?.textContent ?? "").trim());
  return {
    flat: screen?.dataset.flat === "1",
    tabNavs: document.querySelectorAll('[data-tabs]').length,
    panels: panels.length,
    hiddenPanels: panels.filter((p) => p.hidden).length,
    groups: groups.length,
    summariesPresent: summaries.filter((s) => s.length > 0).length,
    summarySample: summaries.filter((s) => s.length > 0).slice(0, 4),
  };
});

// ── 2/3. framing + manual orbit ───────────────────────────────────────────────────
const framingFor = async (race: string, subrace: number) =>
  await page.evaluate(({ race, subrace }) => {
    const api = (globalThis as unknown as {
      __MYTHERRANIA__: { engine: { debugSetProfileRace(r: string, s: number): unknown } };
    }).__MYTHERRANIA__.engine;
    return api.debugSetProfileRace(race, subrace);
  }, { race, subrace });

const shortOne = await framingFor("dwarf", 0);
const tallOne = await framingFor("ork", 0);
const beforeDrag = await page.evaluate(() => (globalThis as unknown as { __MYTHERRANIA__: { engine: { debugCreatorPreview(): { framing: { yaw: number } } } } }).__MYTHERRANIA__.engine.debugCreatorPreview());
await page.waitForTimeout(900); // nothing must turn by itself
const afterIdle = await page.evaluate(() => (globalThis as unknown as { __MYTHERRANIA__: { engine: { debugCreatorPreview(): { framing: { yaw: number } } } } }).__MYTHERRANIA__.engine.debugCreatorPreview());
const afterDrag = await page.evaluate(() => (globalThis as unknown as { __MYTHERRANIA__: { engine: { debugOrbitPreview(dx: number, dy: number): { yaw: number; pitch: number } } } }).__MYTHERRANIA__.engine.debugOrbitPreview(120, 40));
const clamped = await page.evaluate(() => (globalThis as unknown as { __MYTHERRANIA__: { engine: { debugOrbitPreview(dx: number, dy: number): { pitch: number } } } }).__MYTHERRANIA__.engine.debugOrbitPreview(0, -4000));

// ── 4. the seed ───────────────────────────────────────────────────────────────────
await page.evaluate(() => (globalThis as unknown as { __MYTHERRANIA__: { engine: { debugRollCreatorWithSeed(s: number): void } } }).__MYTHERRANIA__.engine.debugRollCreatorWithSeed(20261031));
await page.waitForTimeout(400);
const seed = await page.evaluate(() => {
  const api = (globalThis as unknown as {
    __MYTHERRANIA__: { engine: { debugRollSeed(): { seed: number | null; recorded: number[] } } };
  }).__MYTHERRANIA__.engine;
  return { ...api.debugRollSeed(), text: (document.getElementById("creator-seed")?.textContent ?? "").trim() };
});

// ── 5. shader health ──────────────────────────────────────────────────────────────
const graphics = await page.evaluate(() => {
  const api = (globalThis as unknown as {
    __MYTHERRANIA__: { snapshot(): { graphics?: { programs?: number; brokenPrograms?: string[] } } };
  }).__MYTHERRANIA__;
  return api.snapshot().graphics ?? null;
});

const report = { page1, shortOne, tallOne, idleYaw: [beforeDrag?.framing?.yaw, afterIdle?.framing?.yaw], afterDrag, clamped, seed, graphics, errors };
console.log(JSON.stringify(report, null, 1));
await Deno.writeTextFile(`${OUT}/probe.json`, JSON.stringify(report, null, 1));
await browser.close();
server.shutdown();
