// deno-lint-ignore-file no-explicit-any -- QA probe: reads the untyped window.__MYTHERRANIA__ debug global.
// Wave J (lane J-E) probe — the wiring of wave J's pure modules, MEASURED in a real Chrome:
//   (a) spectated matches on generated arenas (live pipeline: symmetry, wall plan, spawns, digest),
//       each photographed from a high orbit so the low / partial / towered walls and the symmetric
//       layout are visible, plus one HUD shot of the spectator speed control;
//   (b) the snapshot's walls / symmetry / spawns / digest per match;
//   (c) the simulator fidelity check: batch conditions from src/balance/Batch.ts (the corner cells)
//       played in the ENGINE through runConditions at speed "eight", engine records written next to
//       the headless ones, compared per cell (winner agreement, duration ratio);
//   (d) the effective time scale at every speed (simulated / real seconds) and the frame time,
//       with the speed chosen by a real MOUSE click on the HUD button;
//   (e) the strong-beats-weak invariant in the real engine (max vs min, small/large, open/walled).
//
//   deno run -A tools/probe-batch.ts [--phases shots,speed,fidelity,invariant] [--fidelity 16] [--invariant 24]
// Writes artifacts/qa-wave-j/{report.json, engine-records.jsonl, headless-records.jsonl, *.png}.
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";
import { codeHash, runBatch } from "../src/balance/Batch.ts";
import { buildLaneJTArena } from "../src/balance/ArenaJT.ts";
import { WAVE_J_RULES } from "../src/balance/MatchRules.ts";
import { strongSeatOf } from "../src/balance/Summary.ts";
import type { MatchRecord } from "../src/game/arena/contracts.ts";

function arg(name: string, dflt: string): string {
  const i = Deno.args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < Deno.args.length ? Deno.args[i + 1] : dflt;
}
const PHASES = new Set(arg("phases", "shots,speed,fidelity,invariant").split(","));
const N_FIDELITY = Number(arg("fidelity", "16"));
const N_INVARIANT = Number(arg("invariant", "24"));
const OUT = "artifacts/qa-wave-j";
await Deno.mkdir(OUT, { recursive: true });

const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (r) => serveAsset(r));
const PORT = (server.addr as Deno.NetAddr).port;
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors: string[] = [];
const consoleErrors: string[] = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
await page.waitForTimeout(600);

const call = (fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (globalThis as any).__MYTHERRANIA__.engine[f as string](...(a as unknown[])), [fn, args] as const);
const snap = () => page.evaluate(() => (globalThis as any).__MYTHERRANIA__.snapshot());
const report: Record<string, any> = { port: PORT, phases: [...PHASES] };
const log = (...a: unknown[]) => console.log(...a);

// ── (a)+(b) spectated matches on generated arenas, photographed from above ────────────────────────
// Each override fixes the WALL RULES and the SYMMETRY; everything else (shape, terrain, props,
// resistance, rotation) is still rolled by randomArena, so this is the live pipeline end to end.
const SHOTS: { name: string; arena: Record<string, number> }[] = [
  { name: "towers-rot4", arena: { size: 40, shape: 0, wallRule: 7, wallRule2: -1, symmetry: 4, symmetryOrder: 4, objects: 8, wallTowers: 4 } },
  { name: "battlement-mirror", arena: { size: 38, shape: 2, wallRule: 4, wallRule2: -1, symmetry: 1, objects: 6 } },
  { name: "gates-point", arena: { size: 42, shape: 5, wallRule: 5, wallRule2: -1, symmetry: 3, objects: 8, wallGate: 40 } },
  { name: "ruin-mirror2", arena: { size: 44, shape: 0, wallRule: 3, wallRule2: -1, symmetry: 2, objects: 10, wallGap: 0.45 } },
  { name: "low+towers-rot3", arena: { size: 40, shape: 1, wallRule: 1, wallRule2: 7, wallCombine: 1, symmetry: 4, symmetryOrder: 3, objects: 6 } },
  { name: "half-none", arena: { size: 36, shape: 4, wallRule: 6, wallRule2: -1, symmetry: 0, objects: 5, wallArc: 180 } },
];
if (PHASES.has("shots")) {
  report.matches = [];
  report.screenshots = [];
  let first = true;
  for (const s of SHOTS) {
    await call("debugWorld", { nextArena: { walls: 1, ...s.arena } });
    if (first) { await page.click('[data-action="spectate"]'); first = false; }
    else { await page.keyboard.press("KeyR"); }
    await page.waitForTimeout(1500);
    const sn = await snap();
    const size = sn.ring.size as number;
    // High orbit over the player seat (a near top-down look over the whole ring), the fight frozen.
    await call("debugView", { orbit: { yaw: 0.6, pitch: 1.32, dist: size * 1.25 }, freeze: true });
    await page.waitForTimeout(500);
    const file = `${OUT}/arena-${s.name}.png`;
    await page.screenshot({ path: file });
    report.screenshots.push(file);
    await call("debugView", { orbit: null, freeze: false });
    const d = sn.ring.digest;
    const sp = sn.ring.spawns;
    // Symmetry check on the seats: seat 1 is an image of seat 0 (same distance from the centre).
    const r0 = Math.hypot(sp.spawns[0].x, sp.spawns[0].z), r1 = Math.hypot(sp.spawns[1].x, sp.spawns[1].z);
    const m = {
      name: s.name, shape: sn.ring.shape, size, walls: sn.ring.walls, symmetry: sn.ring.symmetry,
      spawns: sp, seatRadii: [+r0.toFixed(3), +r1.toFixed(3)], fair: sp.fair,
      digest: { openFraction: d.openFraction, open: d.open.join(""), wallHeight: d.wallHeight, outsideDrop: d.outsideDrop, ringOutFatal: d.ringOutFatal, props: d.props.length, terrain: d.terrain },
      wallMeshes: sn.ring.meshes["arena-wall"] ?? 0, propsPlaced: sn.ring.props,
    };
    report.matches.push(m);
    log(`shot ${s.name}: ${m.shape} ${size} m · rules ${m.walls?.rules.join("+")} (${m.walls?.combine}) · coverage ${m.walls?.coverage.toFixed(2)} · open segs ${m.walls?.openSegments}/48 · max ${m.walls?.max.toFixed(2)} m · meshes ${m.wallMeshes} · sym ${m.symmetry.kind}/${m.symmetry.order} · seats r ${m.seatRadii} fair ${m.fair}`);
  }
  // The HUD with the speed control, normal camera.
  await page.waitForTimeout(800);
  const hudFile = `${OUT}/hud-speed-control.png`;
  await page.screenshot({ path: hudFile });
  report.screenshots.push(hudFile);
}

// ── (d) the effective speed at every speed, chosen by MOUSE on the HUD buttons ─────────────────────
const SPEED_IDS = ["half", "normal", "double", "quad", "eight"] as const;
if (PHASES.has("speed")) {
  // A large, open-centred arena so the fighters take a while to meet; a 240 s limit.
  await call("debugWorld", { nextArena: { size: 110, walls: 1, wallRule: 2, wallRule2: -1, objects: 4 } });
  await call("debugView", { timeLimit: 240 });
  const inFight = await page.evaluate(() => (globalThis as any).__MYTHERRANIA__.snapshot().phase === "fight");
  if (inFight) await page.keyboard.press("KeyR"); else await page.click('[data-action="spectate"]');
  await page.waitForTimeout(1500);
  report.speeds = [];
  for (const id of SPEED_IDS) {
    let row: any = null;
    for (let attempt = 0; attempt < 4 && !row; attempt++) {
      // Real mouse click on the button (the user plays mouse-only).
      const box = await page.locator(`#hud-speed button[data-speed="${id}"]`).boundingBox();
      if (!box) throw new Error(`speed button ${id} not visible`);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(1200); // settle the meters
      const a = await call("debugSimSpeed");
      const clockA = await call("debugClock");
      await page.waitForTimeout(4000);
      const b = await call("debugSimSpeed");
      const clockB = await call("debugClock");
      const fs = await call("debugFrameStats");
      if (clockB.decided || b.frames < a.frames) {
        await page.keyboard.press("KeyR"); // the match ended inside the window: a new one, measure again
        await page.waitForTimeout(1500);
        continue;
      }
      const simS = b.simS - a.simS, realS = b.realS - a.realS;
      row = {
        id, timeScale: b.timeScale, simS: +simS.toFixed(3), realS: +realS.toFixed(3), effective: +(simS / realS).toFixed(3),
        clockAdvance: +(clockB.sinceStart - clockA.sinceStart).toFixed(2),
        substepsPerFrame: +((b.substepsPerFrame * b.frames - a.substepsPerFrame * a.frames) / Math.max(1, b.frames - a.frames)).toFixed(2),
        cappedFrames: b.cappedFrames - a.cappedFrames, frames: b.frames - a.frames,
        stepMs: b.stepMs, otherMs: b.otherMs, readout: b.readout, buttonPressed: await page.locator(`#hud-speed button[data-speed="${id}"]`).getAttribute("aria-pressed"),
        frameCpu: fs,
      };
    }
    report.speeds.push(row);
    log(`speed ${id}: ${row ? `effective ${row.effective}× (${row.simS} sim s / ${row.realS} real s), ${row.substepsPerFrame} substeps/frame, capped ${row.cappedFrames}/${row.frames}, frame CPU p50 ${row.frameCpu.p50} p95 ${row.frameCpu.p95} ms, readout "${row.readout}"` : "no clean window"}`);
  }
  // Keyboard: ] steps up, [ steps down.
  await page.keyboard.press("BracketLeft");
  const afterDown = (await call("debugSimSpeed")).speed;
  await page.keyboard.press("BracketRight");
  const afterUp = (await call("debugSimSpeed")).speed;
  const persisted = await page.evaluate(() => sessionStorage.getItem("mytherrania-spectate-speed-v1"));
  report.speedKeys = { afterBracketLeft: afterDown, afterBracketRight: afterUp, persisted };
  log(`keys: [ -> ${afterDown}, ] -> ${afterUp}; sessionStorage ${persisted}`);
  await call("debugView", { timeLimit: 180 });
}

// ── (c)+(e) batch conditions played in the engine ─────────────────────────────────────────────────
const hash = await codeHash();
async function playInEngine(records: MatchRecord[], label: string, file: string): Promise<{ headless: MatchRecord; engine: MatchRecord | null; error?: string; speed: any; wallS: number }[]> {
  const out: { headless: MatchRecord; engine: MatchRecord | null; error?: string; speed: any; wallS: number }[] = [];
  const fh = await Deno.open(`${OUT}/${file}`, { write: true, create: true, truncate: true });
  const enc = new TextEncoder();
  for (let i = 0; i < records.length; i++) {
    const h = records[i];
    const cond = structuredClone(h.conditions);
    const t0 = performance.now();
    let engine: MatchRecord | null = null, error: string | undefined;
    try {
      engine = await page.evaluate(([c]) => (globalThis as any).__MYTHERRANIA__.engine.runConditions(c, "eight", { timeoutS: 400 }), [cond] as const);
    } catch (e) { error = String(e).slice(0, 300); }
    const wallS = (performance.now() - t0) / 1000;
    const speed = await call("debugSimSpeed");
    out.push({ headless: h, engine, error, speed, wallS: +wallS.toFixed(1) });
    if (engine) await fh.write(enc.encode(JSON.stringify(engine) + "\n"));
    const ho = h.outcome, eo = engine?.outcome;
    log(`${label} ${i + 1}/${records.length} ${h.conditions.design} ${h.conditions.arena.size.toFixed(1)} m · headless ${ho.winner}/${ho.reason}/${ho.duration}s · engine ${eo ? `${eo.winner}/${eo.reason}/${eo.duration}s` : error} · ${wallS.toFixed(0)} s real, eff ${speed.effective}×`);
  }
  fh.close();
  return out;
}

if (PHASES.has("fidelity")) {
  // The corner cells: max/min pairs × small/large × walled/open — one headless record per cell.
  const headless = runBatch({ matches: N_FIDELITY, seed: 20261031, design: "corner", rules: WAVE_J_RULES, provider: buildLaneJTArena, codeHash: hash });
  await Deno.writeTextFile(`${OUT}/headless-records.jsonl`, headless.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const played = await playInEngine(headless, "fidelity", "engine-records.jsonl");
  const cells: Record<string, any> = {};
  for (const r of played) {
    const k = r.headless.conditions.design;
    const c = cells[k] ??= { n: 0, agree: 0, ratios: [] as number[], headless: [] as string[], engine: [] as string[] };
    c.n++;
    c.headless.push(`${r.headless.outcome.winner}/${r.headless.outcome.reason}/${r.headless.outcome.duration}`);
    if (!r.engine) { c.engine.push(`error`); continue; }
    c.engine.push(`${r.engine.outcome.winner}/${r.engine.outcome.reason}/${r.engine.outcome.duration}`);
    if (r.engine.outcome.winner === r.headless.outcome.winner) c.agree++;
    c.ratios.push(r.engine.outcome.duration / Math.max(1e-6, r.headless.outcome.duration));
  }
  const agree = played.filter((r) => r.engine && r.engine.outcome.winner === r.headless.outcome.winner).length;
  const ok = played.filter((r) => r.engine).length;
  const ratios = played.filter((r) => r.engine).map((r) => r.engine!.outcome.duration / Math.max(1e-6, r.headless.outcome.duration)).sort((a, b) => a - b);
  report.fidelity = {
    n: played.length, played: ok, errors: played.filter((r) => r.error).map((r) => r.error),
    winnerAgreement: ok ? +(agree / ok).toFixed(3) : 0,
    durationRatio: ratios.length ? { min: +ratios[0].toFixed(2), median: +ratios[Math.floor(ratios.length / 2)].toFixed(2), max: +ratios.at(-1)!.toFixed(2) } : null,
    reasons: {
      headless: tally(played.map((r) => r.headless.outcome.reason)),
      engine: tally(played.filter((r) => r.engine).map((r) => r.engine!.outcome.reason)),
    },
    effectiveSpeedAtEight: played.map((r) => r.speed.effective),
    realSecondsPerMatch: played.map((r) => r.wallS),
    cells: Object.fromEntries(Object.entries(cells).map(([k, c]) => [k, { n: c.n, winnerAgree: c.agree, durationRatio: c.ratios.map((v: number) => +v.toFixed(2)), headless: c.headless, engine: c.engine }])),
  };
  log(`fidelity: winner agreement ${agree}/${ok}; duration ratio engine/headless ${JSON.stringify(report.fidelity.durationRatio)}`);
}

if (PHASES.has("invariant")) {
  // Max vs min (level 20, full budget, best gear, strategy full  vs  level 1, no points, worst gear,
  // strategy none), on small/large × open/walled arenas, both seat orders.
  const all = runBatch({ matches: 144, seed: 7, design: "invariant", rules: WAVE_J_RULES, provider: buildLaneJTArena, codeHash: hash });
  const sizes = new Set([3, 8, 25, 120]);
  const walls = new Set(["none", "full", "gates", "low", "towers", "ruin"]);
  const pick = all.filter((r) => {
    const m = /sweep-(\d+)m-(\w+)/.exec(r.conditions.design);
    return m && sizes.has(Number(m[1])) && walls.has(m[2]);
  });
  // Interleave seat orders and cells, then cap.
  const chosen: MatchRecord[] = [];
  const strongA = pick.filter((r) => strongSeatOf(r.conditions.design) === 0), strongB = pick.filter((r) => strongSeatOf(r.conditions.design) === 1);
  for (let i = 0; chosen.length < N_INVARIANT && (i < strongA.length || i < strongB.length); i++) {
    if (i < strongA.length) chosen.push(strongA[i]);
    if (chosen.length < N_INVARIANT && i < strongB.length) chosen.push(strongB[i]);
  }
  await Deno.writeTextFile(`${OUT}/invariant-headless-records.jsonl`, chosen.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const played = await playInEngine(chosen, "invariant", "invariant-engine-records.jsonl");
  const rows = played.map((r) => {
    const strong = strongSeatOf(r.headless.conditions.design)!;
    const e = r.engine?.outcome;
    return {
      design: r.headless.conditions.design, size: r.headless.conditions.arena.size, strongSeat: strong,
      engine: e ? { winner: e.winner, reason: e.reason, duration: e.duration, hpFrac: e.hpFracLeft, hits: e.hits, swings: e.swings, wallHits: e.wallHits } : { error: r.error },
      strongWonEngine: e ? e.winner === strong : null,
      strongWonHeadless: r.headless.outcome.winner === strong, headlessReason: r.headless.outcome.reason,
      maxHp: r.engine ? r.engine.conditions.fighters.map((f) => Math.round(f.stats?.maxHealth ?? 0)) : null,
    };
  });
  const decided = rows.filter((r) => r.strongWonEngine !== null);
  report.invariant = {
    n: rows.length, played: decided.length,
    strongWins: decided.filter((r) => r.strongWonEngine).length,
    strongLosses: decided.filter((r) => r.engine && (r.engine as any).winner !== null && !r.strongWonEngine).length,
    ties: decided.filter((r) => (r.engine as any).winner === null).length,
    byReason: tally(decided.map((r) => `${r.strongWonEngine ? "strong" : (r.engine as any).winner === null ? "tie" : "weak"}:${(r.engine as any).reason}`)),
    headlessStrongWins: rows.filter((r) => r.strongWonHeadless).length,
    rows,
  };
  log(`invariant (engine): strong won ${report.invariant.strongWins}/${decided.length}; ${JSON.stringify(report.invariant.byReason)}`);
}

function tally(xs: string[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const x of xs) t[x] = (t[x] ?? 0) + 1;
  return t;
}

report.pageErrors = pageErrors;
report.consoleErrors = consoleErrors.filter((e) => !/405/.test(e));
report.consoleErrorsKnown405 = consoleErrors.filter((e) => /405/.test(e)).length;
await Deno.writeTextFile(`${OUT}/report.json`, JSON.stringify(report, null, 2) + "\n");
log(`page errors: ${pageErrors.length}; console errors (excluding the known 405): ${report.consoleErrors.length}`);
for (const e of [...pageErrors, ...report.consoleErrors].slice(0, 8)) log(`  ${e.slice(0, 300)}`);
log(`wrote ${OUT}/report.json`);
await browser.close();
await server.shutdown();
