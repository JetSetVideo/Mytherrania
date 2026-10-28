// deno-lint-ignore-file no-explicit-any -- QA probe: reads the untyped window.__MYTHERRANIA__ debug global.
// Verify the new UI: selection-screen tables + class skills, and the History
// leaderboard with clickable AI profiles.
//   deno run -A tools/probe-ui.ts
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";

const PORT = 8803;
const server = Deno.serve({ hostname: "127.0.0.1", port: PORT, onListen() {} }, (r) => serveAsset(r));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e)));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 15000 });

await Deno.mkdir("artifacts/qa-ui", { recursive: true });

// 1. Selection screen: open it and check the class/weapon tables + skills.
await page.click('[data-action="start"]');
await page.waitForTimeout(400);
const sel = await page.evaluate(() => {
  const rows = document.querySelectorAll("#class-table .pick-row").length;
  const wrows = document.querySelectorAll("#weapon-table .pick-row").length;
  const skillCards = document.querySelectorAll("#class-skills .skill-card").length;
  const skillNames = [...document.querySelectorAll("#class-skills .skill-name")].map((e) => e.textContent);
  const noSelect = !document.querySelector("#creator-class") && !document.querySelector("#creator-weapon");
  return { rows, wrows, skillCards, skillNames, noSelect };
});
console.log("selection:", JSON.stringify(sel));
await page.screenshot({ path: "artifacts/qa-ui/select-table.png" });
// Click a different class to confirm the skills change.
await page.evaluate(() => {
  const row = [...document.querySelectorAll("#class-table .pick-row")].find((r) => (r as HTMLElement).dataset.class === "Mage");
  (row as HTMLElement)?.click();
});
await page.waitForTimeout(300);
const mageSkills = await page.evaluate(() => [...document.querySelectorAll("#class-skills .skill-name")].map((e) => e.textContent));
console.log("mage skills:", JSON.stringify(mageSkills));
await page.screenshot({ path: "artifacts/qa-ui/select-mage.png" });

// 2. History leaderboard: spectate a couple of fights to seed the ladder, then read it.
const fight = async () => {
  await page.evaluate(() => (globalThis as any).__MYTHERRANIA__.engine.debugWorld({ nextArena: { size: 14, shape: 0 } }));
  await page.click('[data-action="spectate"]').catch(() => {});
  // wait for a winner (or timeout)
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000);
    const w = await page.evaluate(() => (globalThis as any).__MYTHERRANIA__.snapshot().winner);
    if (w) return w;
  }
  return null;
};
const w1 = await fight();
console.log("fight 1 winner:", w1);
// Back to menu, fight again to move MMR.
await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(400);
const w2 = await fight();
console.log("fight 2 winner:", w2);

// Open History and read the leaderboard.
await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(400);
await page.click('[data-action="digest"]').catch(() => {});
await page.waitForTimeout(500);
const board = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".leader-row")].map((r) => ({
    rank: r.querySelector(".leader-rank")?.textContent,
    name: r.querySelector(".leader-name")?.childNodes[0]?.textContent,
    mmr: r.querySelector(".leader-mmr")?.textContent,
    king: r.classList.contains("is-king"),
  }));
  return { count: rows.length, rows, kingCount: rows.filter((r) => r.king).length };
});
console.log("leaderboard:", JSON.stringify(board));
await page.screenshot({ path: "artifacts/qa-ui/history-leaderboard.png" });

// Click the first AI to open its profile card.
if (board.count > 0) {
  await page.click(".leader-row").catch(() => {});
  await page.waitForTimeout(300);
  const profile = await page.evaluate(() => {
    const card = document.querySelector("#ai-profile.open .ai-card");
    return card ? { name: card.querySelector(".ai-name")?.textContent, open: true } : { open: false };
  });
  console.log("profile card:", JSON.stringify(profile));
  await page.screenshot({ path: "artifacts/qa-ui/ai-profile.png" });
}

// Assertions.
const fails: string[] = [];
if (sel.rows < 8) fails.push(`class table should have 8 rows, got ${sel.rows}`);
if (sel.wrows < 7) fails.push(`weapon table should have rows, got ${sel.wrows}`);
if (sel.skillCards !== 3) fails.push(`expected 3 skill cards, got ${sel.skillCards}`);
if (!sel.noSelect) fails.push("class/weapon dropdowns still present");
if (JSON.stringify(mageSkills) === JSON.stringify(sel.skillNames)) fails.push("skills did not change when class changed");
if (board.count === 0) fails.push("leaderboard is empty after spectate fights");
if (board.count > 0 && board.kingCount !== 1) fails.push(`expected exactly 1 king, got ${board.kingCount}`);

console.log("\nchecks:", fails.length === 0 ? "ALL PASS" : `FAILURES: ${fails.join("; ")}`);
await b.close(); server.shutdown();
if (fails.length > 0) Deno.exit(1);
