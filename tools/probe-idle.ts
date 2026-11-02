// Wave V lane P: IDLE probe — heels on the ground, the breathing torso, the idle weight shift, seen in
// the real game. For each race: start a fight, let the AI move, FREEZE the world (the animator keeps
// posing every frame, so a frozen fighter settles into its idle stance and breathes), then
//   1. sample the rig's pivots (debugRigInfo) at 10 Hz for SAMPLE_S seconds: per foot the ankle and
//      the ball (toe pivot) height above the floor and the sole pitch against the bind pose, the
//      chest (spine pivot) height (breathing), the pelvis sideways drift (weight shift);
//   2. photograph front / right / back / left and two low foot close-ups with the orbit camera on a
//      clean stage, and lay them out on one contact sheet per race;
//   3. the bind foot (ankle pivot over the ball pivot, flat sole) comes from the race's own plan
//      (anatomyFor: bone positions scale with stature, so the ankle->ball ANGLE is height-free).
// Repeated FREEZES times per race (the AI's moment differs), so a lifted heel cannot hide.
//   deno task build && deno run -A tools/probe-idle.ts [outDir]
//   IDLE_RACES="human:nomad,ork:ironhide"  IDLE_FREEZES=3  IDLE_SAMPLE_S=5
// The heel height is ESTIMATED from pivots (no heel bone): heel = ball rise + span·sin(pitch), with
// span = 1.35 × the ankle-to-ball horizontal distance (the heel sits ~0.35 of it behind the ankle)
// and the ball rise against the bind ball height scaled to the live foot. tools/anim-report.ts
// --idle has the exact FK numbers; this probe proves the WIRING in the real game.
import { chromium } from "playwright";
import { encodeBase64 } from "@std/encoding/base64";
import { serveAsset } from "./serve.ts";
import { anatomyFor } from "../src/graphics/body/Anatomy.ts";

const OUT = Deno.args[0] ?? "artifacts/qa-idle";
await Deno.mkdir(OUT, { recursive: true });
// Port 0: the OS picks a free port (a random fixed range collided with a port already in use).
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (r) => serveAsset(r));
const PORT = (server.addr as Deno.NetAddr).port;
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
// deno-lint-ignore no-explicit-any
const eng = (fn: string, ...args: unknown[]): Promise<any> =>
  page.evaluate(([f, a]) => {
    // deno-lint-ignore no-explicit-any
    const e = (globalThis as any).__MYTHERRANIA__.engine;
    return e[f as string].apply(e, a as unknown[]); // `this` = the engine (private fields)
  }, [fn, args] as const);

const RACES = (Deno.env.get("IDLE_RACES") ?? "human:nomad,elf:wood,dwarf:mountain,ork:ironhide").split(",").map((s) => s.split(":") as [string, string]);
const FREEZES = Number(Deno.env.get("IDLE_FREEZES") ?? "3");
const SAMPLE_S = Number(Deno.env.get("IDLE_SAMPLE_S") ?? "5");
/** Seconds of LIVE play sampled per race: the player seat has no input (it stands, idle) while the
 *  opponent's AI roams, so the player's rig keeps turning to face it — the case that lifted heels. */
const LIVE_S = Number(Deno.env.get("IDLE_LIVE_S") ?? "8");
const SHOTS: [string, { yaw: number; pitch: number; dist: number }][] = [
  ["front", { yaw: 0, pitch: 0.12, dist: 3.2 }], ["right", { yaw: Math.PI / 2, pitch: 0.12, dist: 3.2 }],
  ["back", { yaw: Math.PI, pitch: 0.12, dist: 3.2 }], ["left", { yaw: -Math.PI / 2, pitch: 0.12, dist: 3.2 }],
  ["feet-side", { yaw: Math.PI / 2, pitch: -0.25, dist: 1.7 }], ["feet-front", { yaw: 0.35, pitch: -0.25, dist: 1.7 }],
];
type V3 = [number, number, number];
interface Sample { t: number; piv: Record<string, V3>; floor: number }
const report: Record<string, unknown>[] = [];

const ptp = (xs: number[]) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
  await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__MYTHERRANIA__, null, { timeout: 20000 });
  await page.click('[data-action="start"]').catch(() => {});
  await page.waitForTimeout(300);
  await page.click('[data-action="begin"]').catch(() => {});
  await page.waitForTimeout(900);
  for (const [race, subrace] of RACES) {
    await eng("debugSetModel", { race, subrace, className: "Warrior" });
    await page.waitForTimeout(800);
    // LIVE window: resume (a headless page never takes pointer lock, and a lost lock PAUSES the fight:
    // Escape until the match clock really advances), then sample the standing player's feet.
    await eng("debugView", { freeze: false, clean: false });
    for (let tries = 0; tries < 4; tries++) {
      const c0 = (await eng("debugClock")).sinceStart;
      await page.waitForTimeout(400);
      if ((await eng("debugClock")).sinceStart > c0) break;
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
    const live: Sample[] = [];
    {
      const c0 = (await eng("debugClock")).sinceStart;
      const t0 = Date.now();
      while (Date.now() - t0 < LIVE_S * 1000) {
        const info = await eng("debugRigInfo");
        const hip = info.pivots.hipL;
        const fl = await eng("debugFloorAt", hip[0], hip[2]);
        live.push({ t: (Date.now() - t0) / 1000, piv: info.pivots, floor: fl?.floor ?? fl?.field ?? 0 });
        await page.waitForTimeout(100);
      }
      const c1 = (await eng("debugClock")).sinceStart;
      console.log(`  live window: match clock ${c0.toFixed(2)} -> ${c1.toFixed(2)} s (${live.length} samples)`);
    }
    const runs: Sample[][] = [];
    for (let k = 0; k < FREEZES; k++) {
      await eng("debugView", { freeze: false });
      await page.waitForTimeout(900 + 700 * k);
      await eng("debugView", { freeze: true, hour: 13, dayOfYear: 200, regime: "clear", clean: true });
      await page.waitForTimeout(2500); // the frozen fighter settles into its idle stance
      const samples: Sample[] = [];
      const t0 = Date.now();
      while (Date.now() - t0 < SAMPLE_S * 1000) {
        const info = await eng("debugRigInfo");
        const hip = info.pivots.hipL ?? info.pivots.spine;
        const fl = await eng("debugFloorAt", hip[0], hip[2]);
        samples.push({ t: (Date.now() - t0) / 1000, piv: info.pivots, floor: fl?.floor ?? fl?.field ?? 0 });
        await page.waitForTimeout(100);
      }
      runs.push(samples);
      if (k === 0) {
        for (const [name, orbit] of SHOTS) {
          await eng("debugView", { freeze: true, clean: true, orbit });
          await page.waitForTimeout(450);
          await page.screenshot({ path: `${OUT}/${race}-${name}.png` });
        }
        await eng("debugView", { freeze: true, clean: true, orbit: null });
      }
    }
    // Bind foot from the race's plan: ankle (ankleL head) over the ball (ankleL tail), sole at y = 0.
    const plan = anatomyFor({ race, subrace, className: "Warrior", height: 1.75, weight: 75, seed: 7 } as never); // bones: identical with or without the symmetry step
    const bA = plan.bones.find((b) => b.id === "ankleL")!;
    const bH = Math.hypot(bA.tail[0] - bA.head[0], bA.tail[2] - bA.head[2]), bDy = bA.head[1] - bA.tail[1];
    const bindAngle = Math.atan2(bDy, bH), bindBallH = bA.tail[1];
    const perFoot = (["L", "R"] as const).map(() => ({ bindAngle, bindBallH, bindLen: Math.hypot(bH, bDy) }));
    const footStats = (rs: Sample[][]) => (["L", "R"] as const).map((s, i) => {
      const b = perFoot[i];
      const heel: number[] = [], ball: number[] = [], pitch: number[] = [];
      for (const run of rs) for (const sm of run) {
        const A = sm.piv[`ankle${s}`], T = sm.piv[`toe${s}`];
        const hz = Math.hypot(T[0] - A[0], T[2] - A[2]), len = Math.hypot(hz, A[1] - T[1]);
        const th = Math.atan2(A[1] - T[1], hz) - b.bindAngle; // + = heel up (toe-down)
        const ballRise = (T[1] - sm.floor) - b.bindBallH * len / b.bindLen; // bind ball height at the live foot's scale
        // A foot off the ground (a step) is not a stance sample: only feet whose ball is down count.
        if (ballRise > 0.01) continue;
        pitch.push(th * 180 / Math.PI);
        ball.push(ballRise * 1000);
        heel.push((ballRise + 1.35 * hz * Math.sin(th)) * 1000);
      }
      const n = Math.max(1, heel.length);
      return { side: s, heelMaxMm: Math.max(0, ...heel.map(Math.abs)), heelMeanMm: heel.reduce((a, x) => a + x, 0) / n, ballMaxMm: Math.max(0, ...ball.map(Math.abs)), pitchMaxDeg: Math.max(0, ...pitch.map(Math.abs)), pitchMeanDeg: pitch.reduce((a, x) => a + x, 0) / n, framesHeelUp: heel.filter((h) => h > 5).length, frames: heel.length };
    });
    const stats = footStats(runs);
    // Live: only samples where the player stood (pelvis moved < 1 cm since the previous sample).
    const standing: Sample[] = live.filter((sm, k) => {
      if (k === 0) return false;
      const a = live[k - 1].piv, b = sm.piv;
      return Math.hypot((a.hipL[0] + a.hipR[0]) / 2 - (b.hipL[0] + b.hipR[0]) / 2, (a.hipL[2] + a.hipR[2]) / 2 - (b.hipL[2] + b.hipR[2]) / 2) < 0.01;
    });
    const liveStats = footStats([standing]);
    // Breathing (chest pivot height) and the weight shift (pelvis sideways), per run, peak-to-peak.
    // The spine pivot does not move when the chest pitches about it: the NECK pivot (top of the
    // chest) carries the breath, the pelvis rise included.
    const chest = runs.map((r) => ptp(r.map((s) => s.piv.neck[1])) * 1000);
    const sway = runs.map((r) => {
      const xs = r.map((s) => (s.piv.hipL[0] + s.piv.hipR[0]) / 2), zs = r.map((s) => (s.piv.hipL[2] + s.piv.hipR[2]) / 2);
      return Math.hypot(ptp(xs), ptp(zs)) * 1000;
    });
    if (Deno.env.get("IDLE_DEBUG")) {
      const sm = runs[0][0];
      console.log("DEBUG live", JSON.stringify({ ankleL: sm.piv.ankleL, toeL: sm.piv.toeL, floor: sm.floor, names: Object.keys(sm.piv).join(",") }));
      console.log("DEBUG bind", JSON.stringify(perFoot[0]));
    }
    const row = { race, subrace, freezes: FREEZES, sampleS: SAMPLE_S, feet: stats, live: { seconds: LIVE_S, samples: live.length, standing: standing.length, feet: liveStats }, neckPtpMm: chest, pelvisSwayPtpMm: sway, bind: perFoot[0] };
    report.push(row);
    console.log(`${race}/${subrace} LIVE (standing ${standing.length}/${live.length}): heel max L ${liveStats[0].heelMaxMm.toFixed(1)} R ${liveStats[1].heelMaxMm.toFixed(1)} mm, mean L ${liveStats[0].heelMeanMm.toFixed(1)} R ${liveStats[1].heelMeanMm.toFixed(1)}, pitch max ${Math.max(liveStats[0].pitchMaxDeg, liveStats[1].pitchMaxDeg).toFixed(2)} deg, heel>5mm ${liveStats[0].framesHeelUp + liveStats[1].framesHeelUp}/${liveStats[0].frames + liveStats[1].frames}`);
    console.log(`${race}/${subrace} FROZEN: heel max L ${stats[0].heelMaxMm.toFixed(1)} R ${stats[1].heelMaxMm.toFixed(1)} mm, pitch max L ${stats[0].pitchMaxDeg.toFixed(2)} R ${stats[1].pitchMaxDeg.toFixed(2)} deg, heel>5mm frames ${stats[0].framesHeelUp + stats[1].framesHeelUp}/${stats[0].frames + stats[1].frames}; neck ptp ${chest.map((c) => c.toFixed(1)).join("/")} mm; pelvis sway ptp ${sway.map((c) => c.toFixed(1)).join("/")} mm`);
    // Contact sheet.
    const sheet = await browser.newPage({ viewport: { width: 3 * 360, height: 2 * 225 + 28 }, deviceScaleFactor: 1 });
    const img = (f: string) => `data:image/png;base64,${encodeBase64(Deno.readFileSync(f))}`;
    const cells = SHOTS.map(([n]) => `<figure><img src="${img(`${OUT}/${race}-${n}.png`)}"><figcaption>${n}</figcaption></figure>`).join("");
    await sheet.setContent(`<style>body{margin:0;background:#111;color:#eee;font:13px sans-serif}.g{display:grid;grid-template-columns:repeat(3,360px)}figure{margin:0;position:relative}img{width:360px;height:225px;display:block}figcaption{position:absolute;left:6px;top:4px}</style><div style="height:28px;line-height:28px;padding-left:6px">${race}/${subrace} idle — heel max L ${stats[0].heelMaxMm.toFixed(1)} R ${stats[1].heelMaxMm.toFixed(1)} mm, pitch max ${Math.max(stats[0].pitchMaxDeg, stats[1].pitchMaxDeg).toFixed(2)}°</div><div class="g">${cells}</div>`);
    await sheet.screenshot({ path: `${OUT}/sheet-${race}.png` });
    await sheet.close();
  }
} finally {
  await Deno.writeTextFile(`${OUT}/report.json`, JSON.stringify({ errors, report }, null, 1));
  console.log(`errors: ${errors.length}`);
  for (const e of errors.slice(0, 8)) console.log(`  ${e.slice(0, 300)}`);
  await browser.close();
  await server.shutdown();
}
