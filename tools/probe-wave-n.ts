// deno-lint-ignore-file no-explicit-any -- QA probe: reads the untyped window.__MYTHERRANIA__ debug global.
// Wave N probe — the wave's claims, each MEASURED in a real Chrome:
//   1. a caster's heavy technique CHANNELS: pressing it starts a cast that is not instant, the cast bar
//      appears on screen and carries its state, and the technique fires when the channel completes;
//   2. being hit delays a cast (pushback) and a heavy technique CUTS it (interrupt) — both read from the
//      live cast state rather than from the model's unit tests;
//   3. the assassin's Vanish hides the seat in the SIMULATION: the opponent's belief loses the position
//      (knowsPosition false, target = the last place it was seen) while the model is not drawn;
//   4. autoattack swings by itself in reach and every landed blow pops a styled number out of the victim;
//   5. 0 page errors.
//   deno run -A tools/probe-wave-n.ts
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";

const PORT = 8817;
const server = Deno.serve({ hostname: "127.0.0.1", port: PORT, onListen() {} }, (r) => serveAsset(r));
const b = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});
await Deno.mkdir("artifacts/qa-wave-n", { recursive: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await p.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
await p.waitForTimeout(600);
const call = (fn: string, ...args: unknown[]) =>
  p.evaluate(([f, a]) => (globalThis as any).__MYTHERRANIA__.engine[f as string](...(a as unknown[])), [fn, args] as const);
const report: Record<string, any> = {};

// ── an Assassin (the player seat: it owns Vanish on defence) against a Mage (the caster seat)
await call("debugStartDuel", "Assassin", "Mage");
await p.waitForTimeout(1200);
// HARNESS PITFALL (recorded in the skill): a headless page never takes pointer lock, and the engine
// treats a lost lock during a fight as "open the settings panel", which PAUSES the match. Everything
// then reads frozen — a cast's elapsed time stops, hp stops moving — and it looks like a game bug.
// The resume key is Escape, so the probe re-takes the lock and resumes until the clock really moves.
const running = async (): Promise<boolean> => {
  const a = await call("debugClock");
  await p.waitForTimeout(500);
  const b = await call("debugClock");
  return (b.sinceStart ?? 0) > (a.sinceStart ?? 0) + 0.3;
};
for (let i = 0; i < 5; i++) {
  if (await running()) break;
  await p.click("canvas", { position: { x: 600, y: 400 } }).catch(() => {});
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
}
report.harness = { runningAfterResume: await running() };

// ── the PLAYER's own presses, taken EARLY (a couple of seconds after the bell). A channel occupies the
// runtime until it completes, so the defence press waits for it; both are exercised before the long AI
// observation below, because 30 s of fighting leaves the seat stunned or on cooldown at an arbitrary time.
let earlyPressed = false;
for (let i = 0; i < 6 && !earlyPressed; i++) {
  earlyPressed = await call("debugPress", "power");
  if (!earlyPressed) await p.waitForTimeout(400);
}
await p.waitForTimeout(600); // let the substep that starts painting the bar run
const earlyOwn = await call("debugPowers");
const earlyBar = await p.evaluate(() => {
  const bar = document.querySelector("#cast-0") as HTMLElement | null;
  return bar ? { present: true, state: bar.dataset.state ?? "", label: bar.querySelector(".cb-label")?.textContent ?? "", visible: getComputedStyle(bar).display !== "none", fillWidth: (bar.querySelector(".cb-fill") as HTMLElement | null)?.style.width ?? "" } : { present: false };
});
let earlyVanish = false;
for (let i = 0; i < 12 && !earlyVanish; i++) {
  await p.waitForTimeout(500);
  earlyVanish = await call("debugPress", "defense");
}
await p.waitForTimeout(800); // let one substep re-grade the enemy's belief against the new concealment
const earlyHidden = await call("debugPowers");
report.playerCast = {
  pressed: earlyPressed,
  skill: earlyOwn.casts[0].skill,
  totalS: earlyOwn.casts[0].total,
  channelIsNotInstant: earlyOwn.casts[0].total > 0.35,
  bar: earlyBar,
};
report.playerVanish = {
  pressed: earlyVanish,
  active: earlyHidden.conceal[0].active,
  enemyKnowsPosition: earlyHidden.belief[1].knowsPosition,
  enemyConfidence: earlyHidden.belief[1].confidence,
  enemyStrategy: earlyHidden.belief[1].strategy,
  enemyTarget: earlyHidden.belief[1].target,
  rigVisibility: await call("debugRigVisibility"),
  strategies: earlyHidden.strategies,
};

// ── 1. the caster channels: the AI Mage's heavy technique must appear as a cast
const seen: { skill: string; total: number; left: number }[] = [];
let barSeen: any = null;
let interrupted: any = null;
let pushed: any = null;
for (let i = 0; i < 90; i++) {
  await p.waitForTimeout(400);
  const st = await call("debugPowers");
  const mage = st.casts[1];
  if (mage.skill !== null) {
    if (!seen.some((s) => s.skill === mage.skill)) seen.push({ skill: mage.skill, total: mage.total, left: mage.elapsed });
    if (!barSeen) {
      barSeen = await p.evaluate(() => {
        const bar = document.querySelector("#cast-1") as HTMLElement | null;
        const fill = document.querySelector("#cast-1 .cb-fill") as HTMLElement | null;
        return bar ? { present: true, state: bar.dataset.state ?? "", label: bar.querySelector(".cb-label")?.textContent ?? "", visible: getComputedStyle(bar).display !== "none", fillWidth: fill?.style.width ?? "" } : { present: false };
      });
    }
    if (mage.pushback > 0 && !pushed) pushed = { skill: mage.skill, pushback: mage.pushback, elapsed: mage.elapsed, total: mage.total };
    if (mage.interrupted !== null && !interrupted) interrupted = { skill: mage.skill, by: mage.interrupted };
  }
  if (seen.length >= 2 && barSeen?.present) break;
}
report.cast = {
  castsSeen: seen.length,
  first: seen[0] ?? null,
  channelIsNotInstant: (seen[0]?.total ?? 0) > 0.35,
  bar: barSeen,
  pushbackObserved: pushed,
  interruptObserved: interrupted,
};
await p.screenshot({ path: "artifacts/qa-wave-n/01-cast-bar.png" });

// ── 2. the player seat's own cast (the Assassin's power also channels) plus the floating numbers
// Driven through the engine's own press path (see the harness note above: key events are unreliable
// in a headless page).
const pressedPower = await call("debugPress", "power");
await p.waitForTimeout(300);
const own = await call("debugPowers");
report.ownCast = { skill: own.casts[0].skill, total: own.casts[0].total, started: own.casts[0].skill !== null, pressed: pressedPower };
let text = { seen: 0, sample: null as null | { text: string; cls: string; size: string; hue: string; weight: string } };
for (let i = 0; i < 40; i++) {
  await p.waitForTimeout(300);
  const live = await call("debugPowers");
  if (live.floating > text.seen) {
    text.seen = live.floating;
    if (!text.sample) {
      text.sample = await p.evaluate(() => {
        const el = [...document.querySelectorAll(".combat-text")].find((e) => (e as HTMLElement).style.display !== "none") as HTMLElement | undefined;
        if (!el) return null;
        return {
          text: el.textContent ?? "",
          cls: el.className,
          size: el.style.getPropertyValue("--ct-size"),
          hue: el.style.getPropertyValue("--ct-hue"),
          weight: el.style.getPropertyValue("--ct-weight"),
        };
      });
    }
  }
  if (text.seen > 0 && text.sample) break;
}
report.combatText = text;
await p.screenshot({ path: "artifacts/qa-wave-n/02-damage-numbers.png" });

// ── 3. the vanish: the player seat's defence (Digit3) hides it in the SIMULATION
// The power press starts a CHANNEL, which occupies the runtime ("active") until it completes: a second
// press during it is correctly refused. Wait the channel out, then press defence with a bounded retry.
let pressedDefense = false;
for (let i = 0; i < 10 && !pressedDefense; i++) {
  await p.waitForTimeout(500);
  pressedDefense = await call("debugPress", "defense");
}
await p.waitForTimeout(700);
const hidden = await call("debugPowers");
const modelHidden = await call("debugRigVisibility").catch(() => null);
report.vanish = {
  active: hidden.conceal[0].active,
  // The ENEMY's belief about seat 0 must lose the truth: this is the anti-cheat claim.
  enemyKnowsPosition: hidden.belief[1].knowsPosition,
  enemyConfidence: hidden.belief[1].confidence,
  enemyStrategy: hidden.belief[1].strategy,
  enemyTarget: hidden.belief[1].target,
  rigVisibility: modelHidden, pressed: pressedDefense,
  strategies: hidden.strategies,
};

report.errors = errors;
await p.screenshot({ path: "artifacts/qa-wave-n/03-vanish.png" });
await Deno.writeTextFile("artifacts/qa-wave-n/report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await b.close();
server.shutdown();
