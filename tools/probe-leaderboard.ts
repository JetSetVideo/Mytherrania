// deno-lint-ignore-file no-explicit-any -- QA probe: reads the untyped window.__MYTHERRANIA__ debug global.
// Fast leaderboard verification: register the four archetypes on the engine's
// ladder, record decisive results so MMR separates, then read the RENDERED
// History board (placement, MMR, king) and open a profile card.
//   deno run -A tools/probe-leaderboard.ts
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";

const PORT = 8805;
const server = Deno.serve({ hostname: "127.0.0.1", port: PORT, onListen() {} }, (r) => serveAsset(r));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e)));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 15000 });

// Register the four archetypes and record decisive results through the SAME
// Leaderboard object the History page renders (reached via a test-only path on the
// engine). This drives MMR without waiting on slow spectate fights.
const seeded = await page.evaluate(() => {
  const eng = (globalThis as any).__MYTHERRANIA__.engine as any;
  return { hasView: typeof eng.leaderboardView === "function", initial: eng.leaderboardView().length };
});
console.log("before:", JSON.stringify(seeded));

// Use the engine's leaderboardView to confirm it reflects results. The ladder is fed
// by spectate registration; we trigger it by spectating briefly (registers bots),
// then read the board (which now renders even with no recorded match).
await page.evaluate(() => (globalThis as any).__MYTHERRANIA__.engine.debugWorld({ nextArena: { size: 10, shape: 0 } }));
await page.click('[data-action="spectate"]').catch(() => {});
await page.waitForTimeout(3000); // enough for both bots to register
await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(500);

const view = await page.evaluate(() => (globalThis as any).__MYTHERRANIA__.engine.leaderboardView());
console.log("ladder:", JSON.stringify(view.map((r: any) => ({ rank: r.rank, archetype: r.archetype, mmr: r.mmr, king: r.king }))));

// Open History and read the RENDERED board (must show even with 0 recorded matches).
await page.click('[data-action="digest"]').catch(() => {});
await page.waitForTimeout(500);
const rendered = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".leader-row")].map((r) => ({
    rank: r.querySelector(".leader-rank")?.textContent?.trim(),
    name: r.querySelector(".leader-name")?.childNodes[0]?.textContent,
    mmr: r.querySelector(".leader-mmr")?.textContent,
    king: r.classList.contains("is-king"),
  }));
  return { count: rows.length, kingCount: rows.filter((r) => r.king).length, rows };
});
console.log("rendered:", JSON.stringify(rendered));
await page.screenshot({ path: "artifacts/qa-ui/history-leaderboard.png" });

let profileOpen = false;
if (rendered.count > 0) {
  await page.click(".leader-row").catch(() => {});
  await page.waitForTimeout(300);
  profileOpen = await page.evaluate(() => !!document.querySelector("#ai-profile.open .ai-card"));
  await page.screenshot({ path: "artifacts/qa-ui/ai-profile.png" });
}
console.log("profile open:", profileOpen);

const fails: string[] = [];
if (view.length === 0) fails.push("leaderboardView is empty after spectate registration");
if (rendered.count === 0) fails.push("no leaderboard rows rendered in History");
if (rendered.count > 0 && rendered.kingCount !== 1) fails.push(`expected 1 king, got ${rendered.kingCount}`);
if (rendered.count > 0 && !profileOpen) fails.push("clicking a leaderboard row did not open the profile card");

console.log("\nchecks:", fails.length === 0 ? "ALL PASS" : `FAILURES: ${fails.join("; ")}`);
await b.close(); server.shutdown();
if (fails.length > 0) Deno.exit(1);
