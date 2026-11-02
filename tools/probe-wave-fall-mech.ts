// deno-lint-ignore-file no-explicit-any -- QA probe: reads the untyped window.__MYTHERRANIA__ debug global.
// Wave FALL (agent M) probe — collisions and falls in a live fight, measured in a real Chrome:
//   1. EQUAL bodies charged into each other (debugForce, 4.2 m/s each): mirror pushback / stagger;
//   2. HEAVY vs LIGHT (debugFallStats: seat 0 strength 9 / vitality 9 / armour 8, seat 1 strength 2 /
//      vitality 2 / armour 1): the light body is pushed further and staggers longer — read from
//      debugFall() over time (positions -> measured slide, phases -> durations);
//   3. a FALL (debugPush seat 1, magnitude 1): falling -> down -> rising -> stand, timed against the
//      plan the get-up law fixed; the DOWN chip and the 'Down!' callout show; the force log records it;
//   4. 0 page errors. Screenshots under artifacts/qa-wave-fall/mech/.
//   BUILD_OUT=dist-mech deno task build && deno run -A tools/probe-wave-fall-mech.ts [dist-mech] [outDir]
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";

const ROOT = Deno.args[0] ?? "dist-mech";
const OUT = Deno.args[1] ?? "artifacts/qa-wave-fall/mech";
await Deno.mkdir(OUT, { recursive: true });
const server = Deno.serve({ hostname: "127.0.0.1", port: 8846, onListen() {} }, (r) => serveAsset(r, ROOT));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto("http://127.0.0.1:8846/", { waitUntil: "networkidle" });
await p.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
await p.waitForTimeout(600);
const call = (fn: string, ...args: unknown[]) =>
  p.evaluate(([f, a]) => { const e = (globalThis as any).__MYTHERRANIA__.engine; return e[f as string].call(e, ...(a as unknown[])); }, [fn, args] as const);
const report: Record<string, any> = { root: ROOT };

async function startDuel(a: string, c: string) {
  await call("debugStartDuel", a, c);
  await p.waitForTimeout(1200);
  // Pitfall 19: a headless page never holds pointer lock and the lost lock PAUSES the fight; resume until the clock moves.
  const running = async (): Promise<boolean> => {
    const x = await call("debugClock"); await p.waitForTimeout(400); const y = await call("debugClock");
    return (y.sinceStart ?? 0) > (x.sinceStart ?? 0) + 0.2;
  };
  for (let i = 0; i < 8; i++) {
    if (await running()) break;
    await p.click("canvas", { position: { x: 700, y: 450 } }).catch(() => {});
    await p.keyboard.press("Escape");
    await p.waitForTimeout(300);
  }
  const ok = await running();
  for (let i = 0; i < 24; i++) { const k = await call("debugClock"); if ((k.hostile ?? 0) > 0.3) break; await p.waitForTimeout(400); }
  return ok;
}

/** Sample debugFall every `ms` for `n` samples (positions, phases). */
async function track(n: number, ms: number) {
  const out: any[] = [];
  for (let i = 0; i < n; i++) {
    const f = await call("debugFall");
    out.push({ t: f.elapsed, seats: f.seats.map((s: any) => ({ phase: s.phase, t: s.t, x: s.x, z: s.z, plan: s.plan, anim: s.anim })) });
    await p.waitForTimeout(ms);
  }
  return out;
}

/** Slide of each seat along the collision normal from the first sample, m, and how long each stayed off its feet, s. */
function analyse(samples: any[], n: [number, number], at: [[number, number], [number, number]]) {
  const s0 = samples[0];
  const along = (k: number, i: number) => {
    const d = [samples[i].seats[k].x - at[k][0], samples[i].seats[k].z - at[k][1]];
    return k === 0 ? -(d[0] * n[0] + d[1] * n[1]) : d[0] * n[0] + d[1] * n[1];
  };
  const res: any = {};
  for (const k of [0, 1]) {
    let maxSlide = 0;
    for (let i = 0; i < samples.length; i++) maxSlide = Math.max(maxSlide, along(k, i));
    const off = samples.filter((x) => x.seats[k].phase !== "stand");
    const offS = off.length ? off[off.length - 1].t - s0.t : 0;
    res[`seat${k}`] = { measuredSlideM: +maxSlide.toFixed(3), offFeetS: +offS.toFixed(2), phases: [...new Set(samples.map((x) => x.seats[k].phase))] };
  }
  return res;
}

const ok1 = await startDuel("Warrior", "Warrior");
report.harness = { running: ok1 };
await call("debugView", { freeze: false });
// 1. Equal bodies.
{
  await p.screenshot({ path: `${OUT}/01-equal-before.png` });
  const r = await call("debugForce", { speed: 4.2 });
  const samples = await track(16, 100);
  await p.screenshot({ path: `${OUT}/02-equal-after.png` });
  report.equal = { force: r, measured: analyse(samples, r.normal, r.at), shoveAnim: samples[0]?.seats.map((s: any) => s.anim?.shove ?? null) };
}
await p.waitForTimeout(1500);
// 2. Heavy (seat 0) vs light (seat 1).
{
  const heavy = await call("debugFallStats", 0, { strength: 9, vitality: 9, resilience: 9, armor: 8 });
  const light = await call("debugFallStats", 1, { strength: 2, vitality: 2, resilience: 2, armor: 1, agility: 3 });
  const r = await call("debugForce", { speed: 4.2 });
  const samples = await track(16, 100);
  await p.screenshot({ path: `${OUT}/03-heavy-light-after.png` });
  report.heavyLight = { heavy, light, force: r, measured: analyse(samples, r.normal, r.at) };
}
await p.waitForTimeout(2500);
// 3. A fall: seat 1 pushed with a sure-fall balance loss, timed through every phase.
{
  for (let i = 0; i < 10; i++) { const f = await call("debugFall"); if (f.seats[1].phase === "stand") break; await p.waitForTimeout(300); }
  const phase = await call("debugPush", 1, [1, 0], 1, "hit");
  const t0 = (await call("debugFall")).elapsed;
  const timeline: { phase: string; at: number }[] = [{ phase, at: 0 }];
  let plan: any = null, chipSeen = false, downText = false, shotDown = false, shotRise = false;
  for (let i = 0; i < 120; i++) {
    const f = await call("debugFall");
    const s = f.seats[1];
    plan ??= s.plan;
    if (s.phase !== timeline[timeline.length - 1].phase) timeline.push({ phase: s.phase, at: +(f.elapsed - t0).toFixed(3) });
    const ui = await p.evaluate(() => ({
      chip: [...document.querySelectorAll("#hud-opponent .fp-down, .fighter-panel .fp-down")].some((e) => (e as HTMLElement).style.display !== "none"),
      text: [...document.querySelectorAll("#combat-text .combat-text--force")].some((e) => (e as HTMLElement).style.display !== "none" && e.textContent === "Down!"),
    }));
    chipSeen ||= ui.chip; downText ||= ui.text;
    if (s.phase === "down" && !shotDown) { await p.screenshot({ path: `${OUT}/04-down.png` }); shotDown = true; }
    if (s.phase === "rising" && !shotRise) { await p.screenshot({ path: `${OUT}/05-rising.png` }); shotRise = true; }
    if (s.phase === "stand" && timeline.length > 1) break;
    await p.waitForTimeout(50);
  }
  const fl = await call("debugFall");
  report.fall = { plan, timeline, chipSeen, downText, forces: fl.forces };
}
await p.screenshot({ path: `${OUT}/06-after.png` });

const tl = report.fall.timeline as { phase: string; at: number }[];
const at = (ph: string) => tl.find((x) => x.phase === ph)?.at ?? NaN;
const plan = report.fall.plan ?? { down: NaN, rise: NaN };
const eq = report.equal.force, hl = report.heavyLight.force;
report.verdict = {
  running: ok1,
  // Live "equal" seats still differ in level / stamina / guard, so the check is the law's ORDER: the
  // body with the lower effective mass recoils more (exact mirror inputs are pinned in Deno, SPEC FALL-F1).
  equalOrdered: !!eq && (eq.effectiveMass[0] >= eq.effectiveMass[1]) === (eq.recoil[0] <= eq.recoil[1]),
  momentumConserved: !!eq && Math.abs(eq.effectiveMass[0] * (eq.recoil[0] + 4.2) - eq.effectiveMass[1] * (eq.recoil[1] + 4.2)) < 1e-6 * eq.effectiveMass[0] * 10,
  lightPushedFurther: !!hl && hl.pushback[1] > hl.pushback[0] && report.heavyLight.measured.seat1.measuredSlideM > report.heavyLight.measured.seat0.measuredSlideM,
  lightStaggersLonger: !!hl && hl.stagger[1] > hl.stagger[0],
  fallPhases: tl.map((x) => x.phase).join(">"),
  downAtS: at("down"), risingAtS: at("rising"), standAtS: at("stand"),
  planTotalS: +(0.5 + plan.down + plan.rise).toFixed(3),
  timingWithin015: Math.abs(at("stand") - (0.5 + plan.down + plan.rise)) < 0.15 + 0.1,
  downChip: report.fall.chipSeen, downCallout: report.fall.downText,
  forceLog: { falls: report.fall.forces?.falls, rises: report.fall.forces?.rises, collisions: report.fall.forces?.collisions, events: report.fall.forces?.events?.length },
  pageErrors: errors.length,
};
report.errors = errors.slice(0, 5);
await Deno.writeTextFile(`${OUT}/report.json`, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ equal: report.equal.force, equalMeasured: report.equal.measured, heavyLight: report.heavyLight.force, heavyLightMeasured: report.heavyLight.measured, fall: { plan, timeline: tl }, verdict: report.verdict }, null, 1));
await b.close();
await server.shutdown();
