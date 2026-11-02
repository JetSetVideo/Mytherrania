// deno-lint-ignore-file no-explicit-any -- QA probe.
// Wave Y lane A: the Creator preview's idle — which way the weapon points and where the knees sit.
// Shots per weapon (side view: the blade's forward/backward lean reads in profile) and per race (front
// view, close on the legs: the knees out of the hip-ankle line).
//
//   BUILD_OUT=dist-pose deno task build && deno run -A tools/probe-wave-y-pose.ts [distDir] [outDir] [tag]
//   deno run -A tools/probe-wave-y-pose.ts --rig [outJson]       the rig numbers (no browser): blade direction per
//                                                                archetype x pose x race, knees, slides, KO settling
//   deno run -A tools/probe-wave-y-pose.ts --doc before.json after.json   prints the POSE.md tables from two --rig runs
//
// "before" = the same probe on a build of HEAD (git archive HEAD | tar -x -C <scratch>; BUILD_OUT there).
// The numbers behind the shots come from the same buildPreviewRig path in Deno: tests/wave_y_pose_fixture.ts.
import { chromium, type Page } from "playwright";
import { serveAsset } from "./serve.ts";
import { ARCHETYPE_IDS } from "../src/game/weapons/Archetypes.ts";
import { benchY, driveEngine, meanKnee, type PoseKind, previewSample, worstBlade } from "../tests/wave_y_pose_fixture.ts";
import { RagdollDriver } from "../src/physics/ragdoll/RigBinding.ts";
import { flatGroundWorld } from "../src/physics/ragdoll/RagdollWorld.ts";
import type { FighterCondition } from "../src/physics/ragdoll/MuscleTone.ts";
import { hitboxesFromPlan } from "../src/combat/Hitboxes.ts";
import { rng32 } from "../src/core/MathCore.ts";
import type { ArchetypeId } from "../src/combat/contracts.ts";

type EnginePose = Exclude<PoseKind, "preview">;
const RIG_POSES: PoseKind[] = ["idle", "guard", "block", "walk", "preview"];
const RACES = ["human", "elf", "dwarf", "ork"];
const SUBSET: ArchetypeId[] = ["longsword", "axe", "mace", "spear", "staff", "scythe", "bow", "dagger"];

function rigReport() {
  const blades: { race: string; id: string; pose: string; fwd: number; elev: number; out: number; tipZmm: number }[] = [];
  const legs: { race: string; pose: string; kneeL: number; kneeR: number; slideMm: number; tiltDeg: number }[] = [];
  for (const race of RACES) {
    for (const id of race === "human" ? ARCHETYPE_IDS : SUBSET) {
      for (const pose of RIG_POSES) {
        if (pose === "preview") {
          const p = previewSample(id, race);
          blades.push({ race, id, pose, fwd: p.blade.fwd, elev: p.blade.elev, out: p.blade.out, tipZmm: p.blade.tipZmm });
          if (id === "longsword") legs.push({ race, pose, kneeL: p.knee.kneeOutMm[0], kneeR: p.knee.kneeOutMm[1], slideMm: 0, tiltDeg: 0 });
          continue;
        }
        const s = driveEngine(benchY(id, race), pose as EnginePose, pose === "walk" ? 3 : 2.2, pose === "walk" ? 1.5 : 0.4);
        const w = worstBlade(s);
        blades.push({ race, id, pose, fwd: w.fwd, elev: w.elev, out: w.out, tipZmm: w.tipZmm });
        if (id === "longsword") {
          const k = meanKnee(s);
          legs.push({ race, pose, kneeL: k[0], kneeR: k[1], slideMm: Math.max(...s.map((x) => x.slideMm)), tiltDeg: Math.max(...s.map((x) => x.soleTiltDeg)) });
        }
      }
    }
    // The classic (spec-less) class weapon in the preview.
    const c = previewSample(undefined, race);
    blades.push({ race, id: "classic", pose: "preview", fwd: c.blade.fwd, elev: c.blade.elev, out: c.blade.out, tipZmm: c.blade.tipZmm });
  }
  // KO from the engine's idle pose: does the ragdoll settle as often with the knee-out as without?
  const fresh: FighterCondition = { hpFraction: 1, staminaFraction: 1, damagePercent: 0, strength: 5, statuses: [] };
  const ko: { race: string; kneeOut: number; settled: number; throws: number; meanS: number; over3s: number }[] = [];
  for (const race of ["human", "ork"]) {
    const b = benchY("longsword", race);
    driveEngine(b, "idle", 1.5, 0.05);
    const drv = new RagdollDriver(b.rig, hitboxesFromPlan(b.rig.plan, { mass: 70 }), b.sk.limits(), 24);
    for (const k of [b.sk.legRoll.kneeOut?.[0] ?? 0, 0]) {
      const ats: number[] = [];
      for (const cond of [fresh, { ...fresh, hpFraction: 0 }]) {
        const rnd = rng32(9);
        for (let i = 0; i < 25; i++) {
          drv.stop();
          if (b.sk.legRoll.kneeOut) b.sk.legRoll.kneeOut[0] = b.sk.legRoll.kneeOut[1] = k;
          b.rig.update(b.sk, 0);
          b.rig.group.position.set(0, 0.5 + rnd(), 0); b.rig.group.rotation.set(0, rnd() * 6.28, 0); b.rig.group.updateMatrixWorld(true);
          drv.start({ condition: cond, velocity: [(rnd() * 2 - 1) * 3, 2 * rnd(), (rnd() * 2 - 1) * 3] });
          const w = flatGroundWorld(0);
          let at = -1;
          for (let f = 0; f < 600 && at < 0; f++) if (drv.update(1 / 60, w).settled) at = (f + 1) / 60;
          ats.push(at);
        }
      }
      const ok = ats.filter((x) => x > 0);
      ko.push({ race, kneeOut: k, settled: ok.length, throws: ats.length, meanS: ok.reduce((a, x) => a + x, 0) / Math.max(1, ok.length), over3s: ats.filter((x) => x < 0 || x > 3).length });
    }
  }
  return { blades, legs, ko };
}

type RigRep = ReturnType<typeof rigReport>;
/** Markdown tables (before vs after) from two --rig runs. */
function docTables(a: RigRep, b: RigRep): string {
  const f2 = (x: number) => x.toFixed(2), f0 = (x: number) => x.toFixed(0);
  const key = (r: { race: string; id?: string; pose: string }) => `${r.race}|${r.id ?? ""}|${r.pose}`;
  const A = new Map(a.blades.map((r) => [key(r), r]));
  const out: string[] = [];
  out.push("### Blade direction, human, every archetype (worst frame; fwd = forward share of grip->tip, elev in deg)\n");
  out.push(`| archetype | ${RIG_POSES.map((p) => `${p} before`).join(" | ")} | ${RIG_POSES.map((p) => `${p} after`).join(" | ")} |`);
  out.push(`|---|${RIG_POSES.map(() => "---").join("|")}|${RIG_POSES.map(() => "---").join("|")}|`);
  const ids = [...new Set(b.blades.filter((r) => r.race === "human").map((r) => r.id))];
  for (const id of ids) {
    const cell = (r: RigRep["blades"][number] | undefined) => r ? `${f2(r.fwd)} / ${f0(r.elev)}°` : "-";
    const bef = RIG_POSES.map((p) => cell(A.get(`human|${id}|${p}`)));
    const aft = RIG_POSES.map((p) => cell(b.blades.find((r) => r.race === "human" && r.id === id && r.pose === p)));
    out.push(`| ${id} | ${bef.join(" | ")} | ${aft.join(" | ")} |`);
  }
  out.push("\n### Other races (sword, axe, mace, spear, staff, scythe, bow, dagger): the most backward non-dagger frame per pose\n");
  out.push("| race | pose | worst fwd before (archetype) | worst fwd after (archetype) | dagger elev after |");
  out.push("|---|---|---|---|---|");
  for (const race of RACES) {
    for (const pose of RIG_POSES) {
      const pick = (rep: RigRep) => rep.blades.filter((r) => r.race === race && r.pose === pose && r.id !== "dagger" && r.id !== "bow").reduce((m, r) => (!m || r.fwd < m.fwd ? r : m), null as RigRep["blades"][number] | null);
      const pb = pick(a), pa = pick(b), dg = b.blades.find((r) => r.race === race && r.pose === pose && r.id === "dagger");
      out.push(`| ${race} | ${pose} | ${pb ? `${f2(pb.fwd)} (${pb.id})` : "-"} | ${pa ? `${f2(pa.fwd)} (${pa.id})` : "-"} | ${dg ? `${f0(dg.elev)}°` : "-"} |`);
    }
  }
  out.push("\n### Knees: lateral offset from the hip-ankle line, mm (+ = outward), longsword stance; planted-ball slide and sole tilt\n");
  out.push("| race | pose | knee L before | knee R before | knee L after | knee R after | slide before mm | slide after mm | sole tilt before ° | after ° |");
  out.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of b.legs) {
    const o = a.legs.find((x) => x.race === r.race && x.pose === r.pose);
    out.push(`| ${r.race} | ${r.pose} | ${o ? o.kneeL.toFixed(1) : "-"} | ${o ? o.kneeR.toFixed(1) : "-"} | ${r.kneeL.toFixed(1)} | ${r.kneeR.toFixed(1)} | ${o ? o.slideMm.toFixed(2) : "-"} | ${r.slideMm.toFixed(2)} | ${o ? o.tiltDeg.toFixed(2) : "-"} | ${r.tiltDeg.toFixed(2)} |`);
  }
  out.push("\n### KO from the engine idle pose (after build): ragdoll settling with vs without the knee-out (25 fresh + 25 limp throws, 10 s cap)\n");
  out.push("| race | knee-out share | settled | mean settle s | not settled in 3 s |");
  out.push("|---|---|---|---|---|");
  for (const k of b.ko) out.push(`| ${k.race} | ${k.kneeOut} | ${k.settled}/${k.throws} | ${k.meanS.toFixed(2)} | ${k.over3s} |`);
  return out.join("\n");
}

if (Deno.args[0] === "--rig") {
  const rep = rigReport();
  const file = Deno.args[1] ?? "artifacts/qa-wave-y/pose/rig-after.json";
  await Deno.writeTextFile(file, JSON.stringify(rep, null, 1));
  console.log(`wrote ${file}: ${rep.blades.length} blade rows, ${rep.legs.length} leg rows, ${rep.ko.length} KO rows`);
  Deno.exit(0);
}
if (Deno.args[0] === "--doc") {
  console.log(docTables(JSON.parse(await Deno.readTextFile(Deno.args[1])), JSON.parse(await Deno.readTextFile(Deno.args[2]))));
  Deno.exit(0);
}


const DIST = Deno.args[0] ?? "dist-pose";
const OUT = Deno.args[1] ?? "artifacts/qa-wave-y/pose";
const TAG = Deno.args[2] ?? "after";
await Deno.mkdir(OUT, { recursive: true });
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (r) => serveAsset(r, DIST));
const PORT = (server.addr as Deno.NetAddr).port;
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});
const errors: string[] = [];
const page: Page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(10000);
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
await page.waitForTimeout(600);
await page.click('[data-action="start"]');
await page.waitForTimeout(600);
const newTab = await page.$('[data-hero-tab="new"]');
if (newTab) { await newTab.click(); await page.waitForTimeout(700); }
await page.waitForFunction(() => !!(globalThis as any).__MYTHERRANIA_PREVIEW__, null, { timeout: 10000 }).catch(() => {});
const hasHook = await page.evaluate(() => !!(globalThis as any).__MYTHERRANIA_PREVIEW__);
if (!hasHook) throw new Error("no __MYTHERRANIA_PREVIEW__ hook: the Creator preview did not open");

/** Show a profile (race, weapon) and turn the figure to an absolute yaw; `legs` frames the legs. */
async function shot(file: string, race: string, weaponType: string, yaw: number, legs = false): Promise<void> {
  await page.evaluate(([race, weaponType, yaw, legs]) => {
    const pv = (globalThis as any).__MYTHERRANIA_PREVIEW__;
    const p = pv.profile;
    pv.setProfile({ ...p, name: "Aldric Vey", race, subrace: null, className: "Warrior", weaponType, appearance: { ...p.appearance, sex: "male" } });
    const f = pv.framing();
    pv.orbit(((yaw as number - f.yaw) / 0.6) * 100, ((f.pitch - 0.12) / 0.6) * 100);
    const h = pv.framing().heightM;
    if (legs) pv.debugCamera(Math.max(1.0, h * 0.75), 0.3 * h);
    pv.render(0.016);
  }, [race, weaponType, yaw, legs] as const);
  await page.waitForTimeout(250);
  const el = await page.$("#creator-preview");
  if (!el) throw new Error("no #creator-preview canvas");
  await el.screenshot({ path: file });
}

const WEAPONS = (Deno.env.get("PROBE_WEAPONS")?.split(",") ?? ["longsword", "axe", "mace", "spear", "staff", "scythe", "dagger", "bow"]);
const shots: string[] = [];
// The figure faces +z; the camera at yaw π/2 sits on the figure's LEFT (+x): in the side shots it faces SCREEN LEFT.
for (const w of WEAPONS) {
  for (const [view, yaw] of [["side", Math.PI / 2], ["3q", 0.6]] as [string, number][]) {
    const file = `${OUT}/${TAG}-weapon-${w}-${view}.png`;
    await shot(file, "human", w, yaw);
    shots.push(file);
  }
}
for (const race of ["human", "elf", "dwarf", "ork"]) {
  const file = `${OUT}/${TAG}-knees-${race}-front.png`;
  await shot(file, race, "longsword", 0, true);
  shots.push(file);
}
const report = { tag: TAG, dist: DIST, shots, errors };
await Deno.writeTextFile(`${OUT}/${TAG}-probe.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
await server.shutdown();
Deno.exit(0); // a lingering keep-alive connection can hold the server open
