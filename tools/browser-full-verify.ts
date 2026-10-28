// Full verification: frame budget + menu flow + fight + digest + sheet
import { chromium } from "playwright";
import { installProbe } from "./browser-probe.ts";

const base = "http://127.0.0.1:8788";
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await ctx.addInitScript(installProbe);

interface FighterSnap { race: string; subrace: string | null; hp: number; damagePercent: number; weapon: string; eliminated: boolean; pose: string }
interface Snapshot { phase: string; arena: string; firstPerson: boolean; elapsed: number; polygons: number; winner: string | null; camera: string; player: FighterSnap; opponent: FighterSnap }
type SnapResult = Snapshot | null;
const snap = (): Promise<SnapResult> => page.evaluate(() => {
  const d = (globalThis as Record<string, unknown>).__MYTHERRANIA__ as { snapshot?: () => unknown } | undefined;
  return (d?.snapshot?.() ?? null) as SnapResult;
});

const results: Record<string, unknown> = {};

try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!document.querySelector("canvas"), { timeout: 10000 });
  await page.waitForTimeout(500);

  // Title screen
  const titleBtn = await page.$('[data-action="start"]');
  if (!titleBtn) throw new Error("Start button not found");
  await titleBtn.click();
  await page.waitForTimeout(300);

  // Select Ork race
  const orkCard = await page.$('[data-race="ork"]');
  if (orkCard) await orkCard.click();
  await page.waitForTimeout(200);

  // Select Ironhide subrace
  const ironBtn = await page.$('[data-subrace="ironhide"]');
  if (ironBtn) await ironBtn.click();
  await page.waitForTimeout(200);

  // Select Flame birthsign
  const flameBtn = await page.$('[data-sign="flame"]');
  if (flameBtn) await flameBtn.click();
  await page.waitForTimeout(200);

  // Enter the ring
  const beginBtn = await page.$('[data-action="begin"]');
  if (!beginBtn) throw new Error("Begin button not found");
  await beginBtn.click();
  await page.waitForTimeout(500);

  // Fight loop: move toward opponent and attack
  const s1 = await snap();
  results.preFight = { player: s1?.player?.race, opponent: s1?.opponent?.race };

  // Move forward (KeyW) and attack (Space) for ~5 seconds
  await page.keyboard.down("KeyW");
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Space");
    await page.waitForTimeout(200);
    const s = await snap();
    if (s?.winner) break;
  }
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(500);

  const s2 = await snap();
  results.postFight = {
    winner: s2?.winner,
    playerHp: s2?.player?.hp,
    opponentHp: s2?.opponent?.hp,
    elapsed: s2?.elapsed,
  };

  // Toggle first-person
  await page.keyboard.press("KeyV");
  await page.waitForTimeout(200);
  const s3 = await snap();
  results.firstPerson = s3?.firstPerson;

  // Get frame budget
  const budget = await page.evaluate(() => {
    const p = (globalThis as Record<string, unknown>).__PROBE__ as { cpuSamples?: number[]; gpuSamples?: number[] } | undefined;
    if (!p) return null;
    const cpu = p.cpuSamples as number[];
    const gpu = p.gpuSamples as number[];
    if (!cpu.length || !gpu.length) return null;
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    return {
      cpu: { samples: cpu.length, mean: Math.round(mean(cpu) * 1000) / 1000 },
      gpu: { samples: gpu.length, mean: Math.round(mean(gpu) * 1000) / 1000 },
    };
  });
  results.frameBudget = budget;
  results.budgetPass = (budget?.cpu?.mean ?? 99) < 16.6 && (budget?.gpu?.mean ?? 99) < 16.6;

  // Check for digest data (fight must have stored something)
  const digestBtn = await page.$('[data-action="digest"]');
  if (digestBtn) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await digestBtn.click();
    await page.waitForTimeout(400);
    const digestText = await page.textContent("#digest-body");
    results.digestPopulated = (digestText ?? "").includes("fight");
  }

  // Sheet
  const sheetBtn = await page.$('[data-action="sheet"]');
  results.sheetAvailable = !!sheetBtn;

} finally {
  results.errors = errors;
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}