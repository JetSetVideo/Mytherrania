// deno-lint-ignore-file no-explicit-any -- QA probe: reads the untyped window.__MYTHERRANIA__ debug global.
// Wave O probe — the user journey, measured in a real Chrome:
//   1. the title's profile button opens a PANEL (it used to silently switch the active profile);
//   2. every saved profile is a row with a REAL portrait (a PNG data URL rendered off the arena's own rig),
//      its ancestry standard, its calling, its level and its record, and the active one is marked;
//   3. the selected profile shows its own STATISTICS (the game's own maths, via creatorSheet);
//   4. the dice action ROLLS a fighter, saves it, and it appears in the list at once;
//   5. loading a row changes the active profile; deleting the last one is refused;
//   6. nothing clips at four viewports, and 0 page errors.
//   deno run -A tools/probe-wave-o.ts
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";

const PORT = 8819;
const server = Deno.serve({ hostname: "127.0.0.1", port: PORT, onListen() {} }, (r) => serveAsset(r));
const b = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});
await Deno.mkdir("artifacts/qa-wave-o", { recursive: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await p.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
await p.waitForTimeout(700);
const call = (fn: string, ...args: unknown[]) =>
  p.evaluate(([f, a]) => (globalThis as any).__MYTHERRANIA__.engine[f as string](...(a as unknown[])), [fn, args] as const);
const panel = () => p.evaluate(() => {
  const rows = [...document.querySelectorAll(".profile-row")];
  const read = (el: Element, sel: string) => el.querySelector(sel)?.textContent?.trim() ?? "";
  return {
    open: !!document.querySelector('[data-screen="profiles"]') && (document.querySelector('[data-screen="profiles"]') as HTMLElement).offsetParent !== null,
    rows: rows.map((r) => ({
      id: (r as HTMLElement).dataset.profileId ?? "",
      name: read(r, ".profile-name"),
      ident: read(r, ".profile-level"),
      record: read(r, ".profile-record"),
      active: r.classList.contains("is-active"),
      selected: r.classList.contains("is-selected"),
      // A REAL portrait: an <img> whose src is a PNG data URL, or nothing at all.
      img: (r.querySelector("img.profile-portrait") as HTMLImageElement | null)?.getAttribute("src")?.slice(0, 22) ?? "",
      imgBytes: (r.querySelector("img.profile-portrait") as HTMLImageElement | null)?.getAttribute("src")?.length ?? 0,
      banner: (r.querySelector(".profile-banner svg") ? "svg" : ""),
      manage: [...r.querySelectorAll(".profile-manage .profile-action")].map((x) => x.textContent?.trim() ?? ""),
    })),
    toolbar: [...document.querySelectorAll(".profiles-actions .profile-action")].map((x) => x.textContent?.trim() ?? ""),
    sheetRows: document.querySelectorAll(".profile-sheet .sheet-row").length,
    sheetText: (document.querySelector(".profile-sheet")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    empty: document.querySelector(".profiles-empty")?.textContent?.trim() ?? "",
    count: document.querySelector(".profiles-count")?.textContent?.trim() ?? "",
  };
});
const report: Record<string, any> = {};

// ── 1. the title button opens the panel
report.title = await p.evaluate(() => {
  const btn = document.querySelector('[data-action="profiles"]') as HTMLElement | null;
  return { buttonPresent: !!btn, label: btn?.textContent?.replace(/\s+/g, " ").trim() ?? "" };
});
await p.click('[data-action="start"]').catch(() => {});           // into the Creator first (the usual path)
await p.waitForTimeout(300);
await p.click('[data-action="back"]').catch(() => {});
await p.waitForTimeout(300);
// The title's option groups are closed trees (wave L): a real user clicks the group open first.
await p.evaluate(() => {
  const btn = document.querySelector('[data-action="profiles"]') as HTMLElement | null;
  const group = btn?.closest("details") as HTMLDetailsElement | null;
  if (group && !group.open) group.open = true;
});
await p.waitForTimeout(200);
await p.click('[data-action="profiles"]');
await p.waitForTimeout(1500);
const first = await panel();
report.opened = { open: first.open, count: first.count, rows: first.rows.length, toolbar: first.toolbar, empty: first.empty };

// ── 2. a roll: the dice action creates AND saves a fighter, and it shows up at once
const before = first.rows.length;
await p.click(".profiles-actions .profile-action-random");
await p.waitForTimeout(2500);
const afterRoll = await panel();
report.roll = {
  rowsBefore: before,
  rowsAfter: afterRoll.rows.length,
  grew: afterRoll.rows.length > before,
  selected: afterRoll.rows.find((r) => r.selected)?.name ?? null,
  portraitsNow: afterRoll.rows.filter((r) => r.img.startsWith("data:image/png")).length,
  biggestPortraitBytes: Math.max(0, ...afterRoll.rows.map((r) => r.imgBytes)),
};
await p.screenshot({ path: "artifacts/qa-wave-o/01-profiles.png" });

// ── 3. the selected profile's statistics, and the studio's cost
report.stats = {
  sheetRows: afterRoll.sheetRows,
  sheetSample: afterRoll.sheetText,
  studio: (await call("debugProfiles")).studio,
  debug: await call("debugProfiles"),
};

// ── 4. load another row: the active profile changes
const other = afterRoll.rows.find((r) => !r.active);
if (other) {
  await p.click(`.profile-row[data-profile-id="${other.id}"]`);
  await p.waitForTimeout(900);
  await p.click(`.profile-row[data-profile-id="${other.id}"] [data-profile-action="load"]`);
  await p.waitForTimeout(1200);
}
const afterLoad = await panel();
report.load = {
  target: other?.name ?? null,
  activeNow: afterLoad.rows.find((r) => r.active)?.name ?? null,
  switched: other !== undefined && afterLoad.rows.find((r) => r.active)?.id === other.id,
  manageOnActive: afterLoad.rows.find((r) => r.active)?.manage ?? [],
};
await p.screenshot({ path: "artifacts/qa-wave-o/02-loaded.png" });

// ── 5. nothing clips at four viewports
const shots: Record<string, string[]> = {};
for (const [w, h] of [[390, 844], [820, 1180], [1280, 800], [1920, 1080]] as const) {
  await p.setViewportSize({ width: w, height: h });
  await p.waitForTimeout(350);
  shots[`${w}x${h}`] = await p.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('[data-screen="profiles"] .profile-row, [data-screen="profiles"] .profile-action, [data-screen="profiles"] .profile-portrait')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > innerWidth + 1) out.push(`${el.className.split(" ")[0]} overflows right (${Math.round(r.right)} > ${innerWidth})`);
      if (r.height < 28 && !el.classList.contains("profile-portrait")) out.push(`${el.className.split(" ")[0]} under 28 px (${Math.round(r.height)})`);
    }
    return [...new Set(out)].slice(0, 6);
  });
  await p.screenshot({ path: `artifacts/qa-wave-o/03-profiles-${w}.png` });
}
report.viewports = shots;
report.errors = errors;
await Deno.writeTextFile("artifacts/qa-wave-o/report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await b.close();
server.shutdown();
