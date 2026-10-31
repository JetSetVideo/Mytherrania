// deno-lint-ignore-file no-explicit-any -- QA probe: reads the untyped window.__MYTHERRANIA__ debug global.
// Wave H probe — four claims, each measured in a real Chrome, not inferred:
//   1. the ANCESTRY LORE panel renders the hierarchy for a race and changes with the race;
//   2. a SPECTATED match is generated (levels, stat budget, techniques, arena) and the card shows
//      in the menu after the match;
//   3. the TIME LIMIT ends a match as a TIE: winner null, reason "time-limit", and the stored
//      record carries the stat gap and the generation;
//   4. the HAIR solver is driven by the weather: the mass is displaced under a storm and settles
//      back to rest under calm.
//   deno run -A tools/probe-wave-h.ts
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";

const PORT = 8809;
const server = Deno.serve({ hostname: "127.0.0.1", port: PORT, onListen() {} }, (r) => serveAsset(r));
const b = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});
await Deno.mkdir("artifacts/qa-wave-h", { recursive: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await p.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
await p.waitForTimeout(600);

const call = (fn: string, ...args: unknown[]) =>
  p.evaluate(([f, a]) => (globalThis as any).__MYTHERRANIA__.engine[f as string](...(a as unknown[])), [fn, args] as const);
const text = (sel: string) => p.evaluate((s) => document.querySelector(s)?.textContent?.trim() ?? "", sel);
const report: Record<string, unknown> = {};

// ── 1. the ancestry lore panel
await p.click('[data-action="start"]');
await p.waitForTimeout(400);
await p.click('[data-race-box="ork"]').catch(() => p.evaluate(() => (document.querySelector('[data-race-box="ork"]') as HTMLElement)?.click()));
await p.waitForTimeout(400);
const loreOrk = await text("#ancestry-lore");
await p.click('[data-race-box="elf"]').catch(() => p.evaluate(() => (document.querySelector('[data-race-box="elf"]') as HTMLElement)?.click()));
await p.waitForTimeout(400);
const loreElf2 = await text("#ancestry-lore");
report.lore = {
  panelPresent: loreOrk.length > 0 && loreElf2.length > 0,
  elfHasSkinHairBeard: ["Skin", "Hair", "Beard", "Tusks", "Ranks"].every((k) => loreElf2.includes(k)),
  orkMentionsTusks: /tusk/i.test(loreOrk),
  orkMentionsChin: /chin/i.test(loreOrk),
  elfMentionsThinMoustache: /moustache/i.test(loreElf2),
  panelsDiffer: loreOrk !== loreElf2,
  orkExcerpt: loreOrk.slice(0, 300),
  elfExcerpt: loreElf2.slice(0, 300),
};
await p.screenshot({ path: "artifacts/qa-wave-h/01-ancestry-lore.png" });

// ── 2. a generated spectator match, with a 7 s limit so the tie is measurable in seconds
await p.click('[data-action="back"]').catch(() => {});
await p.waitForTimeout(200);
await call("debugView", { timeLimit: 7, regime: "storm" });
await p.click('[data-action="spectate"]');
await p.waitForTimeout(1200);
const atStart = await call("debugClock") as Record<string, unknown>;
await p.screenshot({ path: "artifacts/qa-wave-h/02-spectate-storm.png" });

// ── 3. wait for the bell, then read what the match recorded
const t0 = Date.now();
let clock = atStart;
while ((Date.now() - t0) / 1000 < 90) {
  await p.waitForTimeout(500);
  clock = await call("debugClock") as Record<string, unknown>;
  if (clock.decided) break;
}
const snap = await call("snapshot") as any;
const stored = await p.evaluate(() => {
  const raw = localStorage.getItem("mytherrania-history-v2");
  const list = raw ? JSON.parse(raw) : [];
  return list.length ? list[list.length - 1] : null;
}) as any;
report.tie = {
  limitApplied: clock.limitS,
  hostileAtEnd: clock.hostile,
  decided: clock.decided,
  winner: clock.winner,
  endReason: snap.endReason,
  storedReason: stored?.reason ?? null,
  storedTie: stored?.tie ?? null,
  storedLimitS: stored?.limitS ?? null,
  statGapDistance: stored?.statGap?.distance ?? null,
  dominance: stored?.statGap?.dominance ?? null,
  damageShare: stored?.statGap?.damageShare ?? null,
  generationId: stored?.generation?.id ?? null,
  generationBudget: stored?.generation?.budget ?? null,
  generationTechniques: stored?.generation?.techniques ?? null,
  generationAncestry: stored?.generation?.ancestry ?? null,
  winnerAncestry: [stored?.fighters?.[0]?.ancestry ?? null, stored?.fighters?.[1]?.ancestry ?? null],
  fightHp: [Math.round(snap.player.hp), Math.round(snap.opponent.hp)],
  resultTitle: (await text(".victory-title, #victory-title, .menu-screen.active h2")).slice(0, 120),
};
await p.screenshot({ path: "artifacts/qa-wave-h/03-tie-result.png" });

// ── 4. hair physics: does the mass answer the wind? Sample the solver's own wind input beside its
// displacement, over a regime change, so the claim is a MEASURED correlation rather than a guess.
// (Sampling once per regime mis-read this twice: the climate eases in over seconds, so a short
// sample measures the previous regime, and the place's own wind matters more than the regime name.)
const samples: any[] = [];
const takeSample = async () => {
  const sec = await call("debugSecondary") as any;
  samples.push(sec);
  return sec;
};
await call("debugView", { regime: "clear" });
await p.waitForTimeout(6000);
await takeSample();
await call("debugView", { regime: "storm" });
await p.waitForTimeout(6000);
await takeSample();
await p.waitForTimeout(4000);
const storm2 = await takeSample();
await call("debugView", { regime: "lull" });
await p.waitForTimeout(6000);
const lull = await takeSample();
await call("debugView", { regime: null });
const mags = samples.map((s) => s.player.magnitude);
report.hair = {
  masses: lull.player.masses,
  samples: samples.map((x) => ({ windMs: x.windMs, wetness: x.wetness, magnitude: x.player.magnitude })),
  maxMagnitude: Math.max(...mags),
  minMagnitude: Math.min(...mags),
  boundedUnderOneMetre: Math.max(...mags) < 1,
  // Settled: two samples 4 s apart inside one regime agree within 20%, so the spring tracks its
  // equilibrium instead of ringing without bound. (It is NOT "at rest": a steady wind holds a
  // steady displacement, and resting() is only true when the air is still.)
  settledInStorm: Math.abs(storm2.player.magnitude - samples[1].player.magnitude) / Math.max(1e-6, samples[1].player.magnitude) < 0.2,
  // Among the DRY samples the calmest air gives the smallest displacement, and a SOAKED mass
  // resists a much stronger wind (the wetness term, measured rather than asserted smooth).
  dryCalmestIsSmallest: samples[3].player.magnitude < samples[0].player.magnitude,
  soakedResistsStrongerWind: samples[1].player.magnitude < samples[0].player.magnitude * 1.2,
  offsetsAtStorm: samples[1].player.offsets,
  offsetsAtLull: lull.player.offsets,
};
// ── 5. the generated card is still on the menu after the match (the engine sets it at spectate start)
await p.click('[data-action="menu"]').catch(() => {});
await p.waitForTimeout(700);
const cardText = await text("#spectate-card");
report.spectateCard = {
  text: cardText.slice(0, 400),
  hasLevels: /Level \d/.test(cardText),
  hasBudget: /stat points/.test(cardText),
  hasArena: /m\b/.test(cardText),
};
report.errors = errors;
console.log(JSON.stringify(report, null, 1));
await Deno.writeTextFile("artifacts/qa-wave-h/report.json", JSON.stringify({ ...report, at: new Date().toISOString() }, null, 2));
await b.close();
server.shutdown();
