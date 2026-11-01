// deno-lint-ignore-file no-explicit-any -- QA probe: reads the untyped window.__MYTHERRANIA__ debug global.
// Wave R, lane R-C probe — the merge and the override, measured in a real Chrome:
//   1. the title carries EXACTLY ONE entry (the ≡ Profiles and ⚔ Fight buttons merged), in the modes
//      group, and no `data-action="profiles"` button survives;
//   2. that one click opens the roster AND the generator on ONE screen (no standalone profiles screen;
//      #profiles-body lives inside the Creator's screen, with the generator's panels beside it);
//   3. a hand-override applied by a REAL CLICK changes the profile — a race picked by clicking its card
//      moves the race, and the dependent sub-species follows (wave P's open item);
//   4. a roll AFTER the override re-rolls the fighter (the dice is present among the fields);
//   5. the save/discard decision is explicit — Discard throws the hand-edits away, Save files the roll;
//   6. nothing clips at 390 / 820 / 1280 / 1920 px;
//   7. 0 page errors.
//
// Which elements are driven by a REAL click vs. opened for the test, stated honestly:
//   - the entry button, a race card, a dice, Discard and Save are all clicked with page.click();
//   - the title's modes group and the Creator's Race group are native <details> trees — the probe
//     clicks their <summary> to open them when they are closed (exactly what a user does).
//
// Run: deno run -A tools/probe-wave-r.ts   (writes artifacts/qa-wave-r/probe.json)
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";

const PORT = 8833;
const server = Deno.serve({ hostname: "127.0.0.1", port: PORT, onListen() {} }, (r) => serveAsset(r));
const OUT = "artifacts/qa-wave-r";
await Deno.mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__ !== undefined, null, { timeout: 30000 });
await page.waitForTimeout(900);

const report: Record<string, any> = {};

/** The Creator's on-screen state, read from the DOM (no engine hook is added for the probe). */
const creator = () => page.evaluate(() => {
  const selected = document.querySelector('[data-screen="select"] .race-box.selected') as HTMLElement | null;
  return {
    activeScreen: (document.querySelector(".menu-screen.active") as HTMLElement | null)?.dataset.screen ?? null,
    titleVisible: (document.querySelector('[data-screen="title"]') as HTMLElement | null)?.offsetParent !== null,
    name: (document.querySelector("#creator-name") as HTMLInputElement | null)?.value ?? "",
    raceBox: selected?.getAttribute("data-race-box") ?? "",
    subraceChip: document.querySelector('[data-screen="select"] .subrace-chip.selected')?.getAttribute("data-subrace") ?? "",
    subraceSummary: (document.querySelector('details[data-group="select/ancestry/subrace"] .group-summary')?.textContent ?? "").trim(),
    raceSummary: (document.querySelector('details[data-group="select/ancestry/race"] .group-summary')?.textContent ?? "").trim(),
    sheetMeta: (document.querySelector("#creator-sheet .sheet-meta")?.textContent ?? "").replace(/\s+/g, " ").trim(),
    seedText: (document.querySelector("#creator-seed")?.textContent ?? "").replace(/\s+/g, " ").trim(),
    rosterRows: document.querySelectorAll('[data-screen="select"] .profile-row').length,
  };
});

/** A real page.click by CSS selector, swallowing "not found" so the report shows what could not run. */
const click = async (sel: string) => { try { await page.click(sel, { timeout: 4000 }); return true; } catch { return false; } };

// ── 1. EXACTLY ONE entry on the title ─────────────────────────────────────────────────────────────
report.entry = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll('[data-screen="title"] button[data-action="start"]')] as HTMLButtonElement[];
  return {
    entryButtons: buttons.length,
    entryLabel: buttons[0]?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    profilesButtonsOnTitle: document.querySelectorAll('[data-screen="title"] [data-action="profiles"]').length,
    profilesButtonsAnywhere: document.querySelectorAll('[data-action="profiles"]').length,
    entryElement: buttons[0]?.tagName ?? null,
    entryGroup: buttons[0]?.closest("details")?.getAttribute("data-group") ?? null,
    entryVisible: buttons[0]?.offsetParent !== null,
  };
});

// Open the modes group (native <details>) if it is closed, the way a user would, then click the ONE entry.
const modesOpen = await page.evaluate(() => (document.querySelector('details[data-group="title/start/modes"]') as HTMLDetailsElement | null)?.open ?? false);
if (!modesOpen) { await click('details[data-group="title/start/modes"] > summary.opt-head'); await page.waitForTimeout(200); }
report.entryOpenedByClick = await click('[data-action="start"]');
await page.waitForTimeout(1400);

// ── 2. the roster and the generator on ONE screen ─────────────────────────────────────────────────
report.screen = await page.evaluate(() => {
  const select = document.querySelector('[data-screen="select"]') as HTMLElement | null;
  const body = document.getElementById("profiles-body");
  const rosterPanel = select?.querySelector('[data-panel="roster"]') as HTMLElement | null;
  return {
    activeScreen: (document.querySelector(".menu-screen.active") as HTMLElement | null)?.dataset.screen ?? null,
    standaloneProfilesScreenExists: !!document.querySelector('[data-screen="profiles"]'),
    rosterBodyInsideSelect: !!select && !!body && select.contains(body),
    rosterPanelPresent: !!rosterPanel,
    rosterPanelVisible: (rosterPanel?.getBoundingClientRect().height ?? 0) > 0,
    generatorPanelsInSelect: select?.querySelectorAll("[data-panel]").length ?? 0,
    generatorGroupsInSelect: select?.querySelectorAll("details.opt-group").length ?? 0,
  };
});
// Make sure the roster shows at least one saved fighter (a fresh library may be empty): its own "Roll".
report.rosterBeforeRoll = await page.evaluate(() => ({
  rows: document.querySelectorAll('[data-screen="select"] .profile-row').length,
  hasRandomAction: !!document.querySelector('[data-screen="select"] .profiles-actions .profile-action-random'),
}));
if (report.rosterBeforeRoll.rows === 0) {
  report.rosterRollClicked = await click('[data-screen="select"] .profiles-actions .profile-action-random');
  await page.waitForTimeout(2600);
}
report.roster = await page.evaluate(() => {
  const first = document.querySelector('[data-screen="select"] .profile-row') as HTMLElement | null;
  return {
    rows: document.querySelectorAll('[data-screen="select"] .profile-row').length,
    count: (document.querySelector('[data-screen="select"] .profiles-count')?.textContent ?? "").trim(),
    portraitIsPngData: !!document.querySelector('[data-screen="select"] .profile-row img.profile-portrait')?.getAttribute("src")?.startsWith("data:image/png"),
    firstRowVisible: (first?.getBoundingClientRect().height ?? 0) > 0,
  };
});

// A roll first, so the Discard decision (which re-rolls the recorded seed) has something to discard.
// The preview panel's dice is always visible (the Race group's own dice is inside a closed tree).
const DICE = '[data-panel="preview"] .dice-btn';
report.rollFirstClickLanded = await click(DICE);
await page.waitForTimeout(900);
const rolled = await creator();
report.rollFirst = { name: rolled.name, race: rolled.raceBox, seedText: rolled.seedText };

// ── 3. a hand-override by a REAL CLICK: the race changed by hand, dependents following ────────────
const RACE_IDS = ["human", "elf", "dwarf", "ork"];
const before = await creator();
const targetRace = RACE_IDS.find((r) => r !== before.raceBox) ?? "dwarf";
// The Race group is a closed tree: open it with a real click on its summary.
const raceOpen = await page.evaluate(() => (document.querySelector('details[data-group="select/ancestry/race"]') as HTMLDetailsElement | null)?.open ?? false);
if (!raceOpen) { await click('details[data-group="select/ancestry/race"] > summary.opt-head'); await page.waitForTimeout(200); }
report.overrideClickLanded = await click(`[data-screen="select"] .race-box[data-race-box="${targetRace}"] .race-toggle`);
await page.waitForTimeout(500);
const after = await creator();
report.override = {
  targetRace,
  before: { race: before.raceBox, subrace: before.subraceChip, subraceSummary: before.subraceSummary, sheetMeta: before.sheetMeta, raceSummary: before.raceSummary },
  after: { race: after.raceBox, subrace: after.subraceChip, subraceSummary: after.subraceSummary, sheetMeta: after.sheetMeta, raceSummary: after.raceSummary },
  raceChanged: before.raceBox !== after.raceBox && after.raceBox === targetRace,
  // The dependent sub-species followed: the chip, the sheet and the (now live) header all moved.
  dependentSubraceFollowed: before.subraceChip !== after.subraceChip,
  dependentInSheetMeta: before.sheetMeta.split(" · ")[1] !== after.sheetMeta.split(" · ")[1],
  headerSummaryLive: before.subraceSummary !== after.subraceSummary,
  sheetReflects: after.sheetMeta !== before.sheetMeta,
};

// ── 4. a roll AFTER the override ──────────────────────────────────────────────────────────────────
report.rollAfterOverrideClickLanded = await click(DICE);
await page.waitForTimeout(900);
const afterRoll = await creator();
report.rollAfterOverride = {
  nameBefore: after.name, nameAfter: afterRoll.name, nameChanged: after.name !== afterRoll.name,
  raceAfterRoll: afterRoll.raceBox, seedText: afterRoll.seedText,
};

// ── 5. the save/discard decision made explicit ────────────────────────────────────────────────────
// Override the race again, so there is a hand-edit on top of the recorded roll to Discard.
const preDiscard = await creator();
const discardTarget = RACE_IDS.find((r) => r !== preDiscard.raceBox) ?? "elf";
report.discardOverrideLanded = await click(`[data-screen="select"] .race-box[data-race-box="${discardTarget}"] .race-toggle`);
await page.waitForTimeout(400);
const overridden = await creator();
report.discardClickLanded = await click('[data-action="discard"]');
await page.waitForTimeout(900);
const discarded = await creator();
report.discard = {
  overrideTargetRace: discardTarget,
  raceAfterOverride: overridden.raceBox,
  raceAfterDiscard: discarded.raceBox,
  nameAfterDiscard: discarded.name,
  reverted: overridden.raceBox === discardTarget && discarded.raceBox !== discardTarget,
};
// Save the (re-rolled) fighter into the library: a new roster row appears on the same screen.
const rowsBeforeSave = await page.evaluate(() => document.querySelectorAll('[data-screen="select"] .profile-row').length);
report.saveClickLanded = await click('[data-action="save-profile"]');
await page.waitForTimeout(1600);
const rowsAfterSave = await page.evaluate(() => document.querySelectorAll('[data-screen="select"] .profile-row').length);
report.save = { rowsBefore: rowsBeforeSave, rowsAfter: rowsAfterSave, grew: rowsAfterSave > rowsBeforeSave };
await page.screenshot({ path: `${OUT}/00-merged-override.png` });

// ── 6. nothing clips at four viewports ────────────────────────────────────────────────────────────
const viewports: Record<string, unknown> = {};
for (const [w, h] of [[390, 844], [820, 1180], [1280, 800], [1920, 1080]] as const) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(350);
  viewports[`${w}x${h}`] = await page.evaluate(() => {
    const out: string[] = [];
    const scope = document.querySelector('[data-screen="select"]') as HTMLElement | null;
    if (!scope) return { overflow: ["no Creator screen"], rosterBesideGenerator: null };
    const sels = ".override-fields input, .override-fields select, .override-fields .dice-btn, .profile-row, .profile-action, .profile-portrait, .profiles-list, .profile-sheet, .sheet-cols, .sheet-col, .ui-panel-roster, .ui-panel-preview, .menu-btn, .race-card";
    for (const el of scope.querySelectorAll<HTMLElement>(sels)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > innerWidth + 1) out.push(`${el.className.split(" ")[0]} overflows right (${Math.round(r.right)} > ${innerWidth})`);
      if (r.left < -1) out.push(`${el.className.split(" ")[0]} overflows left (${Math.round(r.left)})`);
    }
    // Is the roster on the SAME row as a generator panel (truly beside it), or a full-width row above?
    const roster = scope.querySelector('[data-panel="roster"]') as HTMLElement | null;
    const gen = scope.querySelector('[data-panel="ancestry"]') as HTMLElement | null;
    let beside: boolean | null = null;
    let geom: Record<string, unknown> | null = null;
    if (roster && gen) {
      const a = roster.getBoundingClientRect(), b = gen.getBoundingClientRect();
      // "Beside" = the roster shares a ROW with any other panel on the screen (the preview spans all
      // columns and is excluded), so the roster sits next to the generator, not only above it.
      const layout = [...scope.children].map((el) => {
        const h = el as HTMLElement;
        const r = h.getBoundingClientRect();
        return { panel: h.dataset.panel ?? h.className.split(" ")[0], top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width) };
      });
      const rowMates = layout.filter((l) => l.panel !== "roster" && l.panel !== "preview" && Math.abs((l.top as number) - Math.round(a.top)) < 24);
      beside = rowMates.some((l) => (l.left as number) >= Math.round(a.right) - 1 || Math.round(a.left) >= (l.left as number) + (l.width as number) - 1);
      geom = {
        rosterGridColumn: getComputedStyle(roster).gridColumn,
        rosterWidth: Math.round(a.width), rosterTop: Math.round(a.top),
        ancestryWidth: Math.round(b.width), rowMates: rowMates.map((l) => l.panel),
        layout,
      };
    }
    return { overflow: [...new Set(out)].slice(0, 8), rosterBesideGenerator: beside, geom };
  });
  await page.screenshot({ path: `${OUT}/${w}.png` });
}
report.viewports = viewports;
report.errors = errors;

await Deno.writeTextFile(`${OUT}/probe.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
server.shutdown();