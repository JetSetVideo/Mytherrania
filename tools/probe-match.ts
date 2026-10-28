// deno-lint-ignore-file no-explicit-any -- QA probe: reads the untyped window.__MYTHERRANIA__ debug global.
// Live-match probe: run whole AI-vs-AI fights in real Chrome and record how each ENDS,
// what the arena was, whether walls were hit or broken, which statuses fired, whether
// the skeleton moved under physics, and whether ragdolls/coins were rendered.
//   deno run -A tools/probe-match.ts [matches=4] [maxSeconds=240]
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";

const MATCHES = Number(Deno.args[0] ?? 4);
const MAX_S = Number(Deno.args[1] ?? 240);
const server = Deno.serve({ hostname: "127.0.0.1", port: 8801, onListen() {} }, (r) => serveAsset(r));
const b = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto("http://127.0.0.1:8801/", { waitUntil: "networkidle" });
await p.waitForTimeout(400);
const snap = () => p.evaluate(() => (globalThis as any).__MYTHERRANIA__.snapshot());

const results: Record<string, unknown>[] = [];
for (let m = 0; m < MATCHES; m++) {
  // Spectate: two AIs fight. Every match draws a fresh random arena.
  await p.click('[data-action="spectate"]').catch(() => {});
  await p.waitForTimeout(500);
  const s0 = await snap();
  const t0 = Date.now();
  let maxSpineKick = 0, ragdollSeen = false, coinSeen = false, ringOutFrames = 0, last = s0;
  while ((Date.now() - t0) / 1000 < MAX_S) {
    await p.waitForTimeout(500);
    last = await snap();
    if (last.world2?.player?.ragdoll || last.world2?.opponent?.ragdoll) ragdollSeen = true;
    if ((last.world2?.items ?? []).length > 0) coinSeen = true;
    if (last.player?.ringedOut || last.opponent?.ringedOut) ringOutFrames++;
    maxSpineKick = Math.max(maxSpineKick, Math.abs(last.kick?.player ?? 0), Math.abs(last.kick?.opponent ?? 0));
    if (last.winner) break;
  }
  const r = {
    match: m + 1,
    ring: { shape: s0.ring.shape, size: s0.ring.size, walled: s0.ring.walled, wallResistance: s0.ring.wallResistance, wallHeight: s0.ring.wallHeight, outsideGround: s0.ring.outsideGround, props: s0.ring.props },
    endedBy: !last.winner ? "STILL RUNNING" : last.endReason === "ko" && last.loserHp <= 0 ? "death" : `OTHER(${last.endReason}, loserHp=${last.loserHp})`,
    seconds: last.winner ? +((Date.now() - t0) / 1000).toFixed(1) : MAX_S,
    hpEnd: [Math.round(last.player.hp), Math.round(last.opponent.hp)],
    hpMax: [Math.round(last.player.stats.maxHealth), Math.round(last.opponent.stats.maxHealth)],
    classes: [last.player.className, last.opponent.className],
    wallHits: last.ring.wallHits, wallIntegrity: last.ring.wallIntegrity,
    statusesApplied: last.ring.statusesApplied,
    ragdollSeen, coinSeen, ringOutFrames, maxSpineKick: +maxSpineKick.toFixed(3),
 closingSpeeds: last.ring.closingSpeeds ?? [],
    meshes: ((sceneNames: Record<string, number>) => ({ wall: sceneNames["arena-wall"] ?? 0, floor: sceneNames["arena-floor"] ?? 0, outside: sceneNames["arena-outside"] ?? 0, props: Object.entries(sceneNames).filter(([k]) => k.startsWith("prop-")).reduce((a, [, v]) => a + v, 0), coin: sceneNames["coin"] ?? 0, ragdoll: sceneNames["ragdoll"] ?? 0 }))(s0.ring.meshes),
  };
  console.log(JSON.stringify(r));
  results.push(r);
  // Back to the menu for the next match.
  await p.click('[data-action="menu"]').catch(() => {});
  await p.waitForTimeout(300);
}
const deaths = results.filter((r) => r.endedBy === "death").length;
console.log(`SUMMARY: ${deaths}/${results.length} matches ended by death; non-death endings: ${results.filter((r) => r.endedBy !== "death" && r.endedBy !== "STILL RUNNING").length}; unfinished: ${results.filter((r) => r.endedBy === "STILL RUNNING").length}; page errors: ${errors.length}`, errors.slice(0, 3));
await Deno.mkdir("artifacts/qa-match", { recursive: true });
await Deno.writeTextFile("artifacts/qa-match/probe-match.json", JSON.stringify({ results, errors }, null, 2));
await b.close();
server.shutdown();
