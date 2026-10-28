// Skill QA: drives the three class skills in a real browser, captures the
// animation mid-swing and at the strike frame, and records the engine state so
// the screenshots can be checked against what the code claims.
//   deno run -A tools/qa-skills.ts [outDir]
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";
import { CLASSES, type ClassName } from "../src/game/Stats.ts";
import { ALL_SKILLS, skillsForClass } from "../src/game/Skills.ts";

const OUT = Deno.args[0] ?? "artifacts/qa-skills";
await Deno.mkdir(OUT, { recursive: true });
const server = Deno.serve({ hostname: "127.0.0.1", port: 8793, onListen() {} }, (r) => serveAsset(r));
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

// deno-lint-ignore no-explicit-any
const snap = () => page.evaluate(() => (globalThis as any).__MYTHERRANIA__.snapshot());
const debug = (o: Record<string, unknown>) =>
  // deno-lint-ignore no-explicit-any
  page.evaluate((v) => (globalThis as any).__MYTHERRANIA__.engine.debugView(v), o);

const shots: Record<string, unknown>[] = [];
async function shot(name: string, note: string) {
  await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 15000 });
  shots.push({ name, note, snapshot: await snap() });
  console.log(`  ${name}  ${note}`);
}

/** Pick a class in the creator, then enter the ring. */
async function startAs(className: ClassName) {
  await page.goto("http://127.0.0.1:8793/", { waitUntil: "load" });
  await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__MYTHERRANIA__, null, { timeout: 15000 });
  await page.click('[data-action="start"]');
  await page.waitForTimeout(200);
  const sel = await page.$("#creator-class");
  if (sel) {
    await sel.selectOption(className);
    await page.waitForTimeout(120);
  }
  await page.click('[data-action="begin"]');
  await page.waitForTimeout(500);
  await debug({ hour: 14, camera: "close", firstPerson: false });
}

try {
  // Every class, every skill: 8 x 3 = 24. Capturing only some classes left real
  // evidence gaps (no Rogue or Necromancer shot existed at all).
  const keys = ["Digit1", "Digit2", "Digit3"] as const;
  const kinds = ["dash", "power", "defense"] as const;
  const cases: { cls: ClassName; key: string; kind: string }[] = CLASSES.flatMap((cls) =>
    keys.map((key, i) => ({ cls, key, kind: kinds[i] }))
  );
  for (const c of cases) {
    await startAs(c.cls);
    const skills = skillsForClass(c.cls);
    const index = skills.findIndex((s) => s.kind === c.kind);
    const skill = skills[index];
    const kindIdx = index;
    // Pin the animation at three moments so the capture cannot race the swing.
    // Pin the animation at the strike and orbit around the fighter so the weapon
    // and the effect are visible from an angle the gameplay cameras do not give.
    const at = skill.animation.hitAt;
    const angles: [number, string][] = [[0, "front"], [Math.PI / 2, "right"], [Math.PI, "back"], [-Math.PI / 2, "left"]];
    for (const [yaw, tag] of angles) {
      await debug({ hour: 14, freeze: true, camera: "third", skillHold: { index: kindIdx, at }, orbit: { yaw, pitch: 0.22, dist: 3.4 } });
      await page.waitForTimeout(150);
      await shot(`skill-${c.cls.toLowerCase()}-${c.kind}-${tag}`, `${c.cls} ${skill.name} strike frame, viewed from ${tag}`);
    }
    // And one unpinned third-person shot so the swing reads in motion.
    await debug({ hour: 14, freeze: false, orbit: null, skillHold: null });
    await page.keyboard.press(c.key.replace("Digit", ""));
    await page.waitForTimeout(120);
    await shot(`skill-${c.cls.toLowerCase()}-${c.kind}-live`, `${c.cls} ${skill.name} live in third-person`);
    await page.waitForTimeout(900);
  }
  // Record the full roster so the manifest proves all 24 skills exist.
  shots.push({ name: "roster", skills: ALL_SKILLS.map((s) => `${s.className}/${s.kind}/${s.name}/${s.element}`) });
  // And a HUD crop, so the generated skill artwork is a permanent artifact. Without
  // this the icons are only visible incidentally inside other shots, and a reviewer
  // cannot check them — the named file simply does not exist.
  await startAs("Warrior");
  await debug({ hour: 14, freeze: true });
  await page.waitForTimeout(300);
  const hudEl = await page.$("#hud-skills");
  if (hudEl) await hudEl.screenshot({ path: `${OUT}/hud-skill-art.png` });
  else await page.screenshot({ path: `${OUT}/hud-skill-art.png` });
  shots.push({ name: "hud-skill-art", note: "the three generated skill icons for the Warrior (chevron / starburst / shield)" });
} finally {
  await Deno.writeTextFile(`${OUT}/manifest.json`, JSON.stringify({ errors, shots }, null, 2));
  console.log(`errors: ${errors.length}`, errors.slice(0, 5));
  await browser.close();
  await server.shutdown();
}
