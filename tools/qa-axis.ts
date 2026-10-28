// Axis QA: photographs each class straight down the X, Y and Z axes with an
// orthographic camera, so the model's proportions can be judged without
// perspective distortion. Also measures the model's bounding box on each axis so
// the manifest carries numbers, not just pictures.
//   deno run -A tools/qa-axis.ts [outDir]
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";
import { CLASSES } from "../src/game/Stats.ts";

const OUT = Deno.args[0] ?? "artifacts/qa-axis";
await Deno.mkdir(OUT, { recursive: true });
const server = Deno.serve({ hostname: "127.0.0.1", port: 8795, onListen() {} }, (r) => serveAsset(r));
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

type Myth = { engine: { debugView(o: unknown): void; modelBounds(): unknown } };
type Win = { __MYTHERRANIA__?: Myth };

async function debug(o: Record<string, unknown>) {
  await page.evaluate((opts) => {
    const w = globalThis as unknown as Win;
    w.__MYTHERRANIA__?.engine.debugView(opts);
  }, o);
}

const shots: { name: string; axis: string; cls: string; bbox: unknown; note: string }[] = [];

try {
  for (const cls of CLASSES) {
    // Fresh page per class so the creator's class choice is clean.
    await page.goto("http://127.0.0.1:8795/", { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await page.click('[data-action="start"]');
    await page.waitForTimeout(250);
    const sel = await page.$("#creator-class");
    if (sel) { await sel.selectOption(cls); await page.waitForTimeout(150); }
    await page.click('[data-action="begin"]');
    await page.waitForTimeout(600);

    for (const axis of ["x", "y", "z"] as const) {
      await debug({ hour: 13, camera: "axis", axis, freeze: true, firstPerson: false });
      await page.waitForTimeout(320);
      const name = `axis-${cls.toLowerCase()}-${axis}`;
      await page.screenshot({ path: `${OUT}/${name}.png` });
      // Measure the player's model bounding box in world space, straight from the
      // scene graph, so the picture has numbers beside it.
      const bbox = await page.evaluate(() => {
        const w = globalThis as unknown as Win;
        return w.__MYTHERRANIA__?.engine.modelBounds() ?? null;
      });
      shots.push({ name, axis, cls, bbox, note: `orthographic, looking along ${axis.toUpperCase()}` });
    }
  }
} finally {
  await browser.close();
  server.shutdown();
}

await Deno.writeTextFile(
  `${OUT}/manifest.json`,
  JSON.stringify({ shots, errors, note: "X/Y/Z axis views: orthographic, no perspective" }, null, 2),
);
console.log(`axis shots: ${shots.length}`);
for (const s of shots.slice(0, 6)) console.log(" ", s.name, JSON.stringify(s.bbox));
console.log("errors:", errors.length, errors.slice(0, 3));
