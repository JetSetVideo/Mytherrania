// Wave U: the menu restructure's contracts, pinned at the source level (the menus need a real DOM;
// the browser audit is tools/probe-ui-all.ts).
function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const css = await Deno.readTextFile(new URL("../styles.css", import.meta.url));
const menu = await Deno.readTextFile(new URL("../src/ui/Menu.ts", import.meta.url));
const settings = await Deno.readTextFile(new URL("../src/ui/SettingsPanel.ts", import.meta.url));

Deno.test("wave U: an inactive flat screen is hidden (the Creator used to render beside every screen)", () => {
  assert(css.includes('.menu-screen[data-flat="1"]:not(.active){display:none}'), "the :not(.active) rule");
});

Deno.test("wave U: every menu and the settings dialog upgrade their dropdowns / sliders / numbers to steppers", () => {
  assert(/autoUpgrade\(this\.#root\)/.test(menu), "Menu calls autoUpgrade on its root");
  assert(/autoUpgrade\(dlg\)/.test(settings), "SettingsPanel calls autoUpgrade on its dialog");
  assert(/stepperFor\(f\.el\)\?\.element \?\? f\.el/.test(settings), "the Tab trap walks the steppers, not the hidden natives");
  for (const cls of [".stepper", ".stepper-prev", ".stepper-next", ".stepper-value", ".stepper-native"]) assert(css.includes(cls), `styles.css styles ${cls}`);
});

Deno.test("wave U: the sex override reads appearance.sex (it read a missing top-level field and reverted every change)", () => {
  assert(menu.includes("sex.value = this.#player.appearance.sex"), "sync reads appearance.sex");
  assert(!menu.includes("as unknown as { sex?: string }).sex"), "the old read is gone");
});

Deno.test("wave U: the creator's statistics sit beside the model; the look tools sit under it", () => {
  const preview = menu.slice(menu.indexOf("#previewPanelHtml(): string"), menu.indexOf("#overrideFieldsHtml(): string"));
  const stage = preview.indexOf('class="preview-stage"'), tools = preview.indexOf('class="stage-tools"'), stats = preview.indexOf('class="preview-stats"'), sheet = preview.indexOf('id="creator-sheet"');
  assert(stage >= 0 && tools > stage && stats > tools && sheet > stats, "stage > tools, then the stats column holding the sheet");
  assert(/\.ui-panel-preview \.preview-grid\{grid-template-columns:minmax\(/.test(css), "two columns: model | statistics");
});

Deno.test("wave U: one glyph family — no emoji left on the menu buttons", () => {
  for (const e of ["⚔ Fighters", "📋 History", "👁 Spectate", "📋 Sheet", "📜 History"]) assert(!menu.includes(e), `emoji button "${e}" replaced by a line icon`);
});
