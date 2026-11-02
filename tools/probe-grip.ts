// Grip probe (lane G, wave V): does every weapon sit IN the hand? For each archetype, pins the
// player's plain swing at guard, wind-up apex, contact and mid-recovery, reads the live scene graph
// through Engine.debugGripInfo (hand frame from the anatomy through the forearm bone, weapon frame
// from weaponNode.matrixWorld) and scores it with the pure PalmWeapon.gripMetrics: handle vs finger
// axis (90° = across the palm), handle out of the palm plane, thumb/little-finger side, handle line
// to the palm centre / grip anchor (mm), through-the-fist, striking-end elevation / outward /
// forward, the blade's clearance from the body axis, the off hand's gap to the haft. Checks the
// orientation rules (GripStance.GRIP_RULES) and photographs hand close-ups on contact sheets.
//   deno task build && deno run -A tools/probe-grip.ts [outDir]
//   GRIP_IDS="axe,dagger" to pick archetypes; GRIP_SHOTS=0 skips the photographs; GRIP_RACE=ork:ironhide.
import { chromium } from "playwright";
import { encodeBase64 } from "@std/encoding/base64";
import { serveAsset } from "./serve.ts";
import { ARCHETYPE_IDS, ARCHETYPES } from "../src/game/weapons/Archetypes.ts";
import { type GripMetrics, gripMetrics, type GripSample, type V3t } from "../src/game/PalmWeapon.ts";
import { checkOrientation, GRIP_RULES } from "../src/game/GripStance.ts";

const OUT = Deno.args[0] ?? "artifacts/qa-grip";
await Deno.mkdir(OUT, { recursive: true });
const IDS = (Deno.env.get("GRIP_IDS")?.split(",") ?? [...ARCHETYPE_IDS]) as (typeof ARCHETYPE_IDS)[number][];
const SHOTS = Deno.env.get("GRIP_SHOTS") !== "0";
/** GRIP_RACE="ork:ironhide" (race:subrace) to measure another body; default human:nomad. */
const [RACE, SUBRACE] = (Deno.env.get("GRIP_RACE") ?? "human:nomad").split(":");
const server = Deno.serve({ hostname: "127.0.0.1", port: 8797, onListen() {} }, (r) => serveAsset(r));
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
// deno-lint-ignore no-explicit-any
const eng = (fn: string, arg?: unknown): Promise<any> => page.evaluate(([f, a]) => {
  // deno-lint-ignore no-explicit-any
  const e = (globalThis as any).__MYTHERRANIA__.engine;
  return e[f as string].call(e, a);
}, [fn, arg] as const);

type Beat = "guard" | "windup" | "contact" | "recover";
const BEATS: Beat[] = ["guard", "windup", "contact", "recover"];
interface Row { id: string; beat: Beat; kind: string; reverse: boolean; m: GripMetrics; rule: { ok: boolean; why: string[] }; euler: number[] }
const rows: Row[] = [];
const shots: Record<string, Record<string, string>> = {};

// deno-lint-ignore no-explicit-any
function sampleOf(g: any): GripSample {
  return {
    hand: { palm: g.right.palm, grip: g.right.grip, d: g.right.d, n: g.right.n, w: g.right.w },
    y: g.frame.y, z: g.frame.z, gripOrigin: g.gripOrigin, tipPoint: g.frame.tipPoint,
    pelvis: g.pelvis, chest: g.chest, facing: g.facing, offGrip: g.twoHanded ? (g.left.grip as V3t) : null,
  };
}

try {
  await page.goto("http://127.0.0.1:8797/", { waitUntil: "load" });
  await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__MYTHERRANIA__, null, { timeout: 20000 });
  await page.click('[data-action="start"]');
  await page.waitForTimeout(300);
  await page.click('[data-action="begin"]');
  await page.waitForTimeout(900);
  for (const id of IDS) {
    await eng("debugSetModel", { race: RACE, subrace: SUBRACE ?? null, className: "Warrior", weaponType: id });
    await page.waitForTimeout(700);
    await eng("debugView", { freeze: true, hour: 13, dayOfYear: 200, regime: "clear", clean: true, swingHold: { at: 0 } });
    await page.waitForTimeout(250);
    const info = await eng("debugSwingInfo");
    const ph = info.phases;
    const total = ph.windup + ph.strike + ph.hold + ph.recover + ph.settle;
    const at: Record<Beat, number> = {
      guard: 0, windup: ph.windup * 0.97, contact: ph.contactAt, recover: ph.windup + ph.strike + ph.hold + ph.recover * 0.5,
    };
    shots[id] = {};
    for (const beat of BEATS) {
      await eng("debugView", { freeze: true, clean: true, swingHold: { at: at[beat] / total }, orbit: null });
      await page.waitForTimeout(200);
      const g = await eng("debugGripInfo");
      if (!g) throw new Error(`no grip info for ${id}`);
      if (g.archetype !== id) throw new Error(`asked for ${id}, the rig holds ${g.archetype}`);
      const m = gripMetrics(sampleOf(g));
      const rule = checkOrientation(GRIP_RULES[id], beat, m);
      rows.push({ id, beat, kind: g.kind, reverse: g.reverse, m, rule, euler: g.gripEuler });
      if (SHOTS && (beat === "guard" || beat === "contact")) {
        const fy = Math.atan2(g.facing[0], g.facing[2]);
        for (const [view, yaw, dist, target] of [
          ["front", fy, 3.2, undefined], ["hand-side", fy - Math.PI / 2, 0.75, "hand"], ["hand-front", fy + 0.35, 0.8, "hand"],
        ] as [string, number, number, "hand" | undefined][]) {
          await eng("debugView", { freeze: true, clean: true, swingHold: { at: at[beat] / total }, orbit: { yaw, pitch: 0.15, dist, ...(target ? { target } : {}) } });
          await page.waitForTimeout(350);
          const file = `${OUT}/${id}-${beat}-${view}.png`;
          await page.screenshot({ path: file });
          shots[id][`${beat}-${view}`] = file;
        }
      }
    }
    const r = rows.filter((x) => x.id === id);
    console.log(id.padEnd(10), r.map((x) => `${x.beat}:${x.m.handleToFingers.toFixed(0)}°/${x.m.outOfPalmPlane.toFixed(0)}°${x.m.through ? "" : "!"} el${x.m.elevation.toFixed(0)}${x.rule.ok ? "" : " RULE"}`).join("  "));
  }
  if (SHOTS) {
    // One contact sheet per weapon class: rows = archetypes, columns = guard/contact x front/hand-side/hand-front.
    const cols = ["guard-front", "guard-hand-side", "guard-hand-front", "contact-front", "contact-hand-side", "contact-hand-front"];
    const classes = [...new Set(IDS.map((i) => ARCHETYPES[i].weaponClass))];
    const img = (f: string) => `data:image/png;base64,${encodeBase64(Deno.readFileSync(f))}`;
    for (const cls of classes) {
      const ids = IDS.filter((i) => ARCHETYPES[i].weaponClass === cls);
      const sheet = await browser.newPage({ viewport: { width: 90 + cols.length * 288, height: 28 + ids.length * 180 }, deviceScaleFactor: 1 });
      const head = `<div></div>` + cols.map((c) => `<div>${c}</div>`).join("");
      const body = ids.map((i) => `<div class="l">${i}</div>` + cols.map((c) => shots[i][c] ? `<img src="${img(shots[i][c])}">` : "<div></div>").join("")).join("");
      await sheet.setContent(`<style>body{margin:0;background:#111;color:#eee;font:13px sans-serif}.g{display:grid;grid-template-columns:90px repeat(${cols.length},288px)}.g>div{height:28px;line-height:28px;text-align:center}.g>.l{height:180px;line-height:180px}img{width:288px;height:180px;display:block}</style><div class="g">${head}${body}</div>`);
      await sheet.screenshot({ path: `${OUT}/sheet-${cls}.png` });
      await sheet.close();
    }
  }
} finally {
  // Summary per beat: worst values over the archetypes.
  const by = (b: Beat) => rows.filter((r) => r.beat === b);
  const summary = Object.fromEntries(BEATS.map((b) => {
    const r = by(b);
    return [b, {
      n: r.length,
      through: r.filter((x) => x.m.through).length,
      ruleOk: r.filter((x) => x.rule.ok).length,
      worstAcrossDeg: r.length ? +Math.max(...r.map((x) => Math.abs(90 - x.m.handleToFingers))).toFixed(1) : null,
      worstOutOfPalmDeg: r.length ? +Math.max(...r.map((x) => x.m.outOfPalmPlane)).toFixed(1) : null,
      meanAcrossDeg: r.length ? +(r.reduce((s, x) => s + Math.abs(90 - x.m.handleToFingers), 0) / r.length).toFixed(1) : null,
    }];
  }));
  const report = { race: `${RACE}:${SUBRACE ?? ""}`, errors, summary, rows: rows.map((r) => ({ ...r, m: Object.fromEntries(Object.entries(r.m).map(([k, v]) => [k, typeof v === "number" ? +v.toFixed(2) : v])) })), shots };
  await Deno.writeTextFile(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  console.log("\narchetype  beat     kind    rev  fingers° outPalm° side line→palm(mm) line→anchor(mm) through elev° out  fwd  bodyClear(mm) offGap(mm) rule");
  for (const r of rows) {
    const m = r.m;
    console.log(`${r.id.padEnd(10)} ${r.beat.padEnd(8)} ${r.kind.padEnd(7)} ${r.reverse ? "rev" : "fwd"}  ${m.handleToFingers.toFixed(1).padStart(6)}  ${m.outOfPalmPlane.toFixed(1).padStart(6)}  ${String(m.side).padStart(3)}  ${m.lineToPalmMm.toFixed(1).padStart(8)}  ${m.lineToGripAnchorMm.toFixed(1).padStart(8)}  ${m.through ? "yes" : "NO "}   ${m.elevation.toFixed(0).padStart(4)} ${m.outward.toFixed(2).padStart(5)} ${m.forward.toFixed(2).padStart(5)} ${m.bodyClearMm.toFixed(0).padStart(6)} ${m.offHandGapMm === null ? "   -" : m.offHandGapMm.toFixed(0).padStart(5)}  ${r.rule.ok ? "ok" : "FAIL " + r.rule.why.join(";")}`);
  }
  console.log("\nsummary", JSON.stringify(summary));
  console.log(`errors: ${errors.length}`);
  for (const e of errors.slice(0, 8)) console.log(`  ${e.slice(0, 300)}`);
  await browser.close();
  await server.shutdown();
}
