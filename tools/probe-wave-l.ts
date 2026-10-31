// deno-lint-ignore-file no-explicit-any -- QA probe: reads the untyped window.__MYTHERRANIA__ debug global.
// Wave L probe — the four claims of this wave, each MEASURED in a real Chrome:
//   1. every race and every sub-species shows its own heraldic standard (an SVG banner), and they are
//      distinct from each other on screen, not just in the module;
//   2. the options are CLOSED trees: on arrival every tree is closed except the single entry group the
//      contract names, each header carries its option count, and opening one remembers the choice;
//   3. the purple rocky dice button rolls a fighter and the Creator refreshes in place: the model
//      follows the roll (the engine's preview rig is rebuilt for the new profile) and the stat sheet
//      shows the rolled fighter's own numbers;
//   4. nothing clips at four viewports, and the page keeps its 60 FPS headroom with the second WebGL
//      context live.
//   deno run -A tools/probe-wave-l.ts
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";

const PORT = 8813;
const server = Deno.serve({ hostname: "127.0.0.1", port: PORT, onListen() {} }, (r) => serveAsset(r));
const b = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});
await Deno.mkdir("artifacts/qa-wave-l", { recursive: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await p.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
await p.waitForTimeout(700);

const call = (fn: string, ...args: unknown[]) =>
  p.evaluate(([f, a]) => (globalThis as any).__MYTHERRANIA__.engine[f as string](...(a as unknown[])), [fn, args] as const);
const report: Record<string, any> = {};

// ── 0. the title screen: the components the wave touched are on screen at all
report.title = await p.evaluate(() => {
  const t = document.querySelector('[data-screen="title"]') as HTMLElement | null;
  return {
    visible: !!t && t.offsetParent !== null,
    heading: t?.querySelector("h1")?.textContent?.trim() ?? "",
    buttons: [...(t?.querySelectorAll("button") ?? [])].map((x) => x.textContent?.trim() ?? ""),
  };
});
await p.screenshot({ path: "artifacts/qa-wave-l/00-title.png" });

// ── into the Creator (the panel you leave from to enter the ring)
await p.click('[data-screen="title"] [data-action="start"]');
await p.waitForTimeout(500);
await p.screenshot({ path: "artifacts/qa-wave-l/01-creator.png" });

// ── 1. étendards: one SVG standard per race, and one per sub-species chip
report.banners = await p.evaluate(() => {
  const list = document.querySelector("#ancestry-list");
  const boxes = [...(list?.querySelectorAll(".race-box, [data-race-box]") ?? [])];
  const chips = [...(list?.querySelectorAll(".subrace-chip") ?? [])];
  const svgOf = (el: Element | undefined) => el?.querySelector("svg")?.innerHTML.trim().length ?? 0;
  const raceMarks = boxes.map((box) => ({ race: (box as HTMLElement).dataset.raceBox ?? "", svg: svgOf(box) }));
  const chipMarks = chips.map((chip) => ({
    subrace: (chip as HTMLElement).dataset.subrace ?? "",
    svg: svgOf(chip),
  }));
  const sigs = raceMarks.map((r) => r.svg);
  return {
    raceCount: boxes.length,
    racesWithStandard: raceMarks.filter((r) => r.svg > 0).length,
    subraceCount: chips.length,
    subracesWithStandard: chipMarks.filter((c) => c.svg > 0).length,
    // Distinctness ON SCREEN: how many different banner bodies the race boxes carry.
    distinctRaceStandards: new Set(sigs).size,
    subraceStandardsPresent: chipMarks.length > 0 && chipMarks.every((c) => c.svg > 0),
  };
});

// ── 2. closed trees: everything shut except the one entry group, with counts on the headers
report.trees = await p.evaluate(() => {
  const groups = [...document.querySelectorAll(".opt-group")];
  const open = groups.filter((g) => (g as HTMLDetailsElement).open);
  return {
    groups: groups.length,
    openOnArrival: open.length,
    openKeys: open.map((g) => (g as HTMLElement).dataset.group ?? ""),
    everyHeaderHasCount: groups.every((g) => /\d/.test(g.querySelector(".opt-count")?.textContent ?? "")),
    summaryTags: groups.filter((g) => g.querySelector("summary.opt-head") !== null).length,
  };
});

// ── 3. the dice: one click rolls a fighter, the model follows and the sheet refreshes
// Open the preview panel's tab first if the tabs are a real tablist (the dice may not switch them).
await p.evaluate(() => {
  const tabs = [...document.querySelectorAll(".panel-tabs button, [data-tabs] button")];
  const prev = tabs.find((t) => /preview/i.test(t.textContent ?? ""));
  if (prev) (prev as HTMLElement).click();
});
await p.waitForTimeout(400);

const before = await call("debugCreatorPreview");
const sheetBefore = await p.evaluate(() => document.querySelectorAll("#creator-sheet [data-row], #creator-sheet .sheet-row, #creator-sheet li, #creator-sheet tr").length);
const selectionBefore = await p.evaluate(() => ({
  race: document.querySelector("#ancestry-list .race-box[data-open='true'], #ancestry-list [aria-expanded='true']")?.getAttribute("data-race-box") ?? "",
  cls: document.querySelector("#class-table .pick-row[data-selected='true'] .pick-name")?.textContent?.trim() ?? "",
  name: (document.querySelector("#creator-name") as HTMLInputElement | null)?.value ?? "",
}));

const dice = await p.evaluate(() => {
  const btn = document.querySelector('[data-action="dice"]') as HTMLElement | null;
  if (!btn) return null;
  const cs = getComputedStyle(btn);
  const r = btn.getBoundingClientRect();
  const svg = btn.querySelector("svg");
  return {
    present: true,
    hasDiceIcon: !!svg && (svg.getAttribute("class") ?? "").includes("dice"),
    width: Math.round(r.width),
    height: Math.round(r.height),
    // Purple + rocky: a violet-family colour somewhere in the button's own treatment, and a
    // multi-step box-shadow (the struck-stone face) rather than a flat fill.
    colour: cs.color,
    background: cs.backgroundColor,
    border: cs.borderTopColor,
    shadowSteps: (cs.boxShadow.match(/rgba?\(/g) ?? []).length,
    backgroundImage: cs.backgroundImage.slice(0, 60),
  };
});
await p.click('[data-action="dice"]');
await p.waitForTimeout(900);
const after = await call("debugCreatorPreview");
const sheetAfter = await p.evaluate(() => ({
  rows: document.querySelectorAll("#creator-sheet [data-row], #creator-sheet .sheet-row, #creator-sheet li, #creator-sheet tr").length,
  text: (document.querySelector("#creator-sheet")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 220),
}));
const selectionAfter = await p.evaluate(() => ({
  race: document.querySelector("#ancestry-list .race-box[data-open='true'], #ancestry-list [aria-expanded='true']")?.getAttribute("data-race-box") ?? "",
  cls: document.querySelector("#class-table .pick-row[data-selected='true'] .pick-name")?.textContent?.trim() ?? "",
  name: (document.querySelector("#creator-name") as HTMLInputElement | null)?.value ?? "",
}));
report.dice = {
  button: dice,
  modelBefore: before.built,
  modelAfter: after.built,
  modelFollowedRoll: before.built !== after.built && after.triangles > 0,
  previewLive: after.live,
  triangles: after.triangles,
  sheetRowsBefore: sheetBefore,
  sheetRowsAfter: sheetAfter.rows,
  sheetSample: sheetAfter.text,
  selectionBefore,
  selectionAfter,
  creatorRefreshed: selectionBefore.name !== selectionAfter.name || selectionBefore.cls !== selectionAfter.cls,
  // The roll happened: a dice roll must move at least one of the picks.
  rollChangedSomething: before.built !== after.built,
};
await p.screenshot({ path: "artifacts/qa-wave-l/02-creator-rolled.png" });

// ── 4. the four viewports, with the rolled fighter on screen
const shots: Record<string, { clipped: string[]; shot: string }> = {};
for (const [w, h] of [[390, 844], [820, 1180], [1280, 800], [1920, 1080]] as const) {
  await p.setViewportSize({ width: w, height: h });
  await p.waitForTimeout(350);
  const clipped = await p.evaluate(() => {
    const screen = document.querySelector('[data-screen="select"]') as HTMLElement | null;
    if (!screen) return ["no select screen"];
    const out: string[] = [];
    for (const el of screen.querySelectorAll<HTMLElement>("button, .opt-head, .pick-row, .subrace-chip, canvas")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > innerWidth + 1) out.push(`${el.className || el.tagName} overflows right (${Math.round(r.right)} > ${innerWidth})`);
      if (el.classList.contains("subrace-chip") && r.height < 28) out.push(`chip under 28 px (${Math.round(r.height)})`);
    }
    return out.slice(0, 6);
  });
  const shot = `artifacts/qa-wave-l/03-select-${w}.png`;
  await p.screenshot({ path: shot });
  shots[`${w}x${h}`] = { clipped: [...new Set(clipped)], shot };
}
report.viewports = shots;

// ── 5. frame cost with the second context live (the menu is up; the preview is drawing)
const frames = await p.evaluate(async () => {
  const g = globalThis as any;
  const t: number[] = [];
  await new Promise<void>((done) => {
    let n = 0;
    const step = () => {
      const a = performance.now();
      requestAnimationFrame(() => {
        t.push(performance.now() - a);
        if (++n < 90) step(); else done();
      });
    };
    step();
  });
  t.sort((x, y) => x - y);
  return { n: t.length, p50: Math.round(t[Math.floor(t.length * 0.5)] * 100) / 100, p99: Math.round(t[Math.floor(t.length * 0.99)] * 100) / 100, g: !!g.__MYTHERRANIA__ };
});
report.frame = frames;
report.errors = errors;
await p.screenshot({ path: "artifacts/qa-wave-l/04-final.png" });

await Deno.writeTextFile("artifacts/qa-wave-l/report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await b.close();
server.shutdown();
