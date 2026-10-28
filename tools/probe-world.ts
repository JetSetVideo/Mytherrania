// Probe: are the world systems (senses, fog of war, statuses, ragdoll, items) actually
// LIVE in the running game, not just unit-tested? Samples the snapshot over a match.
//   deno run -A tools/probe-world.ts
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";

const server = Deno.serve({ hostname: "127.0.0.1", port: 8800, onListen() {} }, (r) => serveAsset(r));
const b = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto("http://127.0.0.1:8800/", { waitUntil: "networkidle" });
await p.waitForTimeout(400);
await p.click('[data-action="start"]');
await p.waitForTimeout(250);
await p.click('[data-action="begin"]');

type W = { explored: number; visible: number; senses: Record<string, number> | null; statuses: string; ragdoll: boolean; coins: number; distractedSeconds: number; body: { massKg: number } };
// deno-lint-ignore no-explicit-any
const snap = () => p.evaluate(() => (globalThis as any).__MYTHERRANIA__.snapshot());

const rows: Record<string, unknown>[] = [];
let maxExplored = 0, sawStatus = false, sawRagdoll = false, sawItem = false, sawSenses = false;
for (let t = 1; t <= 24; t++) {
  await p.waitForTimeout(1000);
  const s = await snap();
  const w = s.world2 as { player: W; opponent: W; items: { landed: boolean }[] };
  maxExplored = Math.max(maxExplored, w.player.explored, w.opponent.explored);
  if (w.player.statuses || w.opponent.statuses) sawStatus = true;
  if (w.player.ragdoll || w.opponent.ragdoll) sawRagdoll = true;
  if (w.items.length > 0 || w.player.coins + w.opponent.coins > 0) sawItem = true;
  if (w.player.senses && w.player.senses.sight > 0) sawSenses = true;
  rows.push({ t, disp: s.truce.disposition, explored: w.player.explored, items: w.items.length, coins: w.player.coins + w.opponent.coins, status: w.player.statuses || w.opponent.statuses || "-", ragdoll: w.player.ragdoll || w.opponent.ragdoll, hp: [Math.round(s.player.hp), Math.round(s.opponent.hp)] });
  if (t % 4 === 0) console.log(JSON.stringify(rows[rows.length - 1]));
}
const last = await snap();
// Rare events are forced once so their code paths are proven, not just their absence.
// deno-lint-ignore no-explicit-any
await p.evaluate(() => (globalThis as any).__MYTHERRANIA__.engine.debugWorld({ ragdoll: true, coin: true }));
let forcedRagdoll = false, forcedItemSeen = false, forcedItemLanded = false, coinsAfter = 0;
for (let k = 0; k < 40; k++) {
  await p.waitForTimeout(100);
  const s = await snap();
  if (s.world2.opponent.ragdoll) forcedRagdoll = true;
  if (s.world2.items.length > 0) forcedItemSeen = true;
  if (s.world2.items.some((i: { landed: boolean }) => i.landed)) forcedItemLanded = true;
  coinsAfter = s.world2.player.coins + s.world2.opponent.coins;
}
const settled = !(await snap()).world2.opponent.ragdoll;
console.log(`FORCED: ragdoll appeared=${forcedRagdoll} settled-and-cleared=${settled} | coin spawned=${forcedItemSeen} landed=${forcedItemLanded} collected-total=${coinsAfter}`);
console.log("senses(player):", JSON.stringify(last.world2.player.senses));
console.log("mass kg (player/opponent):", last.world2.player.body.massKg, "/", last.world2.opponent.body.massKg);
console.log(`LIVE: senses=${sawSenses} fog(maxExplored=${maxExplored.toFixed(3)})=${maxExplored > 0} statuses=${sawStatus} ragdoll=${sawRagdoll} items=${sawItem}`);
console.log("winner:", last.winner ?? "-", "endReason:", last.endReason ?? "-", "errors:", errors.length, errors.slice(0, 3));
await Deno.mkdir("artifacts/qa-world", { recursive: true });
await Deno.writeTextFile("artifacts/qa-world/probe-world.json", JSON.stringify({ rows, maxExplored, sawSenses, sawStatus, sawRagdoll, sawItem, errors, final: { senses: last.world2.player.senses, mass: [last.world2.player.body.massKg, last.world2.opponent.body.massKg] } }, null, 2));
await b.close();
server.shutdown();
