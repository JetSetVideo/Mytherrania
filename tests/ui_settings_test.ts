// SettingsPanel (W02/W03): schema validation of stored settings, the give-up confirm step and
// the open/close/toggle state machine. The panel runs on a minimal fake DOM written here
// (deno-dom is not a dependency): elements record attributes, classes, listeners and focus,
// and events bubble up the parent chain to a fake document so key isolation is measured.
import {
  clampToRule, DEFAULT_SETTINGS, effectiveLayout, ESCAPE_GRACE_MS, effectsDensityScale, fovFor, GIVE_UP_QUESTION, loadSettings,
  lookRates, parseStoredSettings, pixelBudgetFor, sanitizeSettings, saveSettings, serializeSettings, SETTING_KEYS,
  SETTINGS_SCHEMA, SETTINGS_STORAGE_KEY, SETTINGS_VERSION, type GameSettings, SettingsPanel, type StorageLike,
} from "../src/ui/SettingsPanel.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
function eq<T>(actual: T, expected: T, message = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message} expected ${e}, got ${a}`);
}

// ---------------------------------------------------------------- fake DOM

interface FakeEvent {
  type: string; key?: string; shiftKey?: boolean; detail?: number; target: FakeEl;
  defaultPrevented: boolean; stopped: boolean;
  preventDefault(): void; stopPropagation(): void;
}
type Listener = (e: FakeEvent) => void;

class FakeDoc {
  activeElement: FakeEl | null = null;
  docListeners: Record<string, Listener[]> = {};
  createElement(tag: string): FakeEl { return new FakeEl(this, tag.toUpperCase()); }
  addEventListener(type: string, fn: Listener) { (this.docListeners[type] ??= []).push(fn); }
}

class FakeClassList {
  set = new Set<string>();
  add(c: string) { this.set.add(c); }
  remove(c: string) { this.set.delete(c); }
  contains(c: string) { return this.set.has(c); }
  toggle(c: string, force?: boolean) {
    const on = force ?? !this.set.has(c);
    if (on) this.set.add(c); else this.set.delete(c);
    return on;
  }
}

class FakeEl {
  id = ""; type = ""; value = ""; checked = false; min = ""; max = ""; step = "";
  disabled = false; hidden = false; textContent = ""; innerHTML = "";
  childNodes: FakeEl[] = [];
  parentNode: FakeEl | null = null;
  classList = new FakeClassList();
  attrs: Record<string, string> = {};
  listeners: Record<string, Listener[]> = {};
  constructor(readonly ownerDocument: FakeDoc, readonly tagName: string) {}
  set className(v: string) { this.classList.set = new Set(v.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classList.set].join(" "); }
  get firstChild(): FakeEl | null { return this.childNodes[0] ?? null; }
  get lastChild(): FakeEl | null { return this.childNodes.at(-1) ?? null; }
  appendChild(c: FakeEl) { c.parentNode = this; this.childNodes.push(c); return c; }
  setAttribute(k: string, v: string) { this.attrs[k] = String(v); }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  addEventListener(type: string, fn: Listener) { (this.listeners[type] ??= []).push(fn); }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
}

/** Dispatch with bubbling: target -> ancestors -> document, unless stopPropagation(). */
function fire(target: FakeEl, type: string, init: Partial<FakeEvent> = {}): FakeEvent {
  const e: FakeEvent = {
    type, target, defaultPrevented: false, stopped: false, ...init,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
  };
  for (let n: FakeEl | null = target; n && !e.stopped; n = n.parentNode) for (const fn of n.listeners[type] ?? []) fn(e);
  if (!e.stopped) for (const fn of target.ownerDocument.docListeners[type] ?? []) fn(e);
  return e;
}
const click = (el: FakeEl) => { if (!el.disabled) fire(el, "click", { detail: 1 }); };

function byId(root: FakeEl, id: string): FakeEl {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.id === id) return n;
    stack.push(...n.childNodes);
  }
  throw new Error(`#${id} not found`);
}

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  writes = 0;
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.writes++; this.data.set(k, v); }
}

function harness(opts: { stored?: unknown; context?: "menu" | "fight" | "spectate" } = {}) {
  const doc = new FakeDoc();
  const container = doc.createElement("div");
  const storage = new MemoryStorage();
  if (opts.stored !== undefined) storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(opts.stored));
  storage.writes = 0;
  const calls: string[] = [];
  const changes: GameSettings[] = [];
  // A manual clock: each read advances 1 s, so every Esc lands outside the open grace unless
  // a test freezes it (clock.step = 0) to model the duplicate pointer-lock Esc.
  const clock = { t: 0, step: 1000 };
  const panel = new SettingsPanel(container as unknown as HTMLElement, {
    onResume: () => calls.push("resume"),
    onGiveUp: () => calls.push("giveup"),
    onRestart: () => calls.push("restart"),
    onMainMenu: () => calls.push("menu"),
    onOpen: () => calls.push("open"),
    onChange: (s) => { calls.push("change"); changes.push(s); },
  }, { storage, detectedLayout: "azerty", now: () => (clock.t += clock.step) });
  panel.setContext(opts.context ?? "fight");
  return { doc, container, storage, calls, changes, panel, clock, $: (id: string) => byId(container, id) };
}

// ---------------------------------------------------------------- schema

Deno.test("settings schema: unknown keys dropped, wrong types and enums -> default", () => {
  const s = sanitizeSettings({
    layout: "dvorak", camera: "axis", minimap: "follow", effects: 3, quality: "high",
    invertY: "yes", showHints: false, firstPerson: 1,
    evil: "<img onerror=alert(1)>", __proto__: { polluted: true },
  });
  eq(Object.keys(s).sort(), [...SETTING_KEYS].sort(), "only schema keys:");
  eq(s.layout, "auto"); eq(s.camera, "third"); eq(s.minimap, "follow"); eq(s.effects, "normal");
  eq(s.quality, "high"); eq(s.invertY, false); eq(s.showHints, false); eq(s.firstPerson, false);
  assert(!("evil" in s) && !("polluted" in s), "unknown key survived");
  eq(sanitizeSettings(null), { ...DEFAULT_SETTINGS }, "null ->");
  eq(sanitizeSettings([1, 2]), { ...DEFAULT_SETTINGS }, "array ->");
});

Deno.test("settings schema: out-of-range numbers clamp and snap; non-finite -> default", () => {
  const s = sanitizeSettings({ mouseSensitivity: 99, fov: 3, volume: -0.4 });
  eq(s.mouseSensitivity, 3); eq(s.fov, 40); eq(s.volume, 0);
  const t = sanitizeSettings({ mouseSensitivity: 1.234, fov: 67.6, volume: 0.333 });
  eq(t.mouseSensitivity, 1.25, "snapped to 0.05:"); eq(t.fov, 68); eq(t.volume, 0.35);
  const u = sanitizeSettings({ mouseSensitivity: NaN, fov: Infinity, volume: "0.5" });
  eq(u.mouseSensitivity, 1); eq(u.fov, 50); eq(u.volume, 0.75);
  // Every default sits inside its own rule.
  for (const k of SETTING_KEYS) {
    const r = SETTINGS_SCHEMA[k];
    if (r.kind === "number") eq(clampToRule(r.def, r), r.def, `${k} default:`);
  }
});

Deno.test("settings storage: version mismatch, broken JSON or nothing -> defaults; round trip", () => {
  eq(parseStoredSettings(null), { ...DEFAULT_SETTINGS });
  eq(parseStoredSettings("{not json"), { ...DEFAULT_SETTINGS });
  eq(parseStoredSettings(JSON.stringify({ v: SETTINGS_VERSION + 1, settings: { fov: 70 } })), { ...DEFAULT_SETTINGS });
  eq(parseStoredSettings(JSON.stringify({ fov: 70 })), { ...DEFAULT_SETTINGS }, "unversioned ->");
  const mine: GameSettings = { ...DEFAULT_SETTINGS, layout: "azerty", fov: 72, volume: 0.4, effects: "high" };
  const text = serializeSettings(mine);
  eq(JSON.parse(text).v, SETTINGS_VERSION);
  eq(parseStoredSettings(text), mine);
  // A storage that throws reads as the defaults and refuses the save, without throwing.
  const broken: StorageLike = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("QuotaExceeded"); } };
  eq(loadSettings(broken), { ...DEFAULT_SETTINGS });
  eq(saveSettings(broken, mine), false);
  eq(loadSettings(null), { ...DEFAULT_SETTINGS });
});

Deno.test("settings helpers: pixel budget, effect density, FOV, look rates, layout", () => {
  eq(pixelBudgetFor("auto"), 4_000_000);
  eq(pixelBudgetFor("high"), 3840 * 2160);
  eq(pixelBudgetFor("low"), 1280 * 720);
  assert(effectsDensityScale("low") < effectsDensityScale("normal") && effectsDensityScale("normal") < effectsDensityScale("high"));
  eq(effectsDensityScale("normal"), 1);
  eq(fovFor("third", { fov: 50 }), 50);
  eq(fovFor("close", { fov: 50 }), 60, "close keeps +10:");
  eq(lookRates({ mouseSensitivity: 1, invertY: false }), { yaw: 0.003, pitch: 0.003 });
  eq(lookRates({ mouseSensitivity: 2, invertY: true }), { yaw: 0.006, pitch: -0.006 });
  eq(effectiveLayout("auto", "azerty"), "azerty");
  eq(effectiveLayout("qwerty", "azerty"), "qwerty");
});

// ---------------------------------------------------------------- panel

Deno.test("panel: gear is icon-only but named; open/close/toggle drive state and callbacks", () => {
  const h = harness();
  const gear = h.$("btn-settings");
  eq(gear.getAttribute("aria-label"), "Settings");
  eq(gear.getAttribute("title"), "Settings (Esc)");
  eq(gear.textContent, "", "no visible text:");
  assert(gear.innerHTML.includes("icon-gear"), "gear icon missing");
  assert(!h.panel.isOpen && h.$("settings-dialog").hidden && h.$("settings-backdrop").hidden, "starts closed");

  click(gear);
  assert(h.panel.isOpen, "gear click opens");
  eq(gear.getAttribute("aria-expanded"), "true");
  assert(!h.$("settings-dialog").hidden && !h.$("settings-backdrop").hidden, "dialog + backdrop shown");
  eq(h.doc.activeElement?.id, "btn-resume", "focus on Resume:");
  eq(h.$("settings-title").textContent, "Paused");

  h.panel.open(); // already open: no second onOpen
  click(gear);    // toggle closes = resume
  assert(!h.panel.isOpen, "second gear click closes");
  h.panel.toggle(); h.panel.toggle();
  h.panel.close(); // already closed: no callback
  eq(h.calls, ["open", "resume", "open", "resume"]);
});

Deno.test("panel: give up needs a confirm; Yes forfeits once without resuming", () => {
  const h = harness();
  h.panel.open();
  click(h.$("btn-giveup"));
  eq(h.calls, ["open"], "Give up alone must not forfeit:");
  assert(h.panel.isConfirming && !h.$("settings-confirm").hidden, "confirm shows");
  eq(h.$("settings-confirm-text").textContent, GIVE_UP_QUESTION);
  eq(h.doc.activeElement?.id, "btn-giveup-no", "No takes focus:");
  // A double-click lands on the disabled Give up again, never on Yes.
  assert(h.$("btn-giveup").disabled && h.$("btn-resume").disabled, "actions disabled while confirming");
  click(h.$("btn-giveup"));
  eq(h.calls, ["open"]);

  click(h.$("btn-giveup-yes"));
  eq(h.calls, ["open", "giveup"], "Yes forfeits, no resume:");
  assert(!h.panel.isOpen && !h.panel.isConfirming, "closed after forfeit");
  h.panel.confirmGiveUp(); // no pending request: nothing
  eq(h.calls, ["open", "giveup"]);
});

Deno.test("panel: No and Esc back out one level; Esc on the panel resumes", () => {
  const h = harness();
  h.panel.open();
  click(h.$("btn-giveup"));
  click(h.$("btn-giveup-no"));
  assert(h.panel.isOpen && !h.panel.isConfirming, "No: panel stays, confirm gone");
  assert(!h.$("btn-giveup").disabled, "actions re-enabled");
  eq(h.doc.activeElement?.id, "btn-giveup", "focus back on Give up:");

  click(h.$("btn-giveup"));
  const esc1 = fire(h.$("btn-giveup-no"), "keydown", { key: "Escape" });
  assert(esc1.stopped, "Esc inside the dialog must not reach the game");
  assert(h.panel.isOpen && !h.panel.isConfirming, "first Esc cancels the confirm only");
  fire(h.$("btn-resume"), "keydown", { key: "Escape" });
  assert(!h.panel.isOpen, "second Esc closes");
  eq(h.calls, ["open", "resume"]);
  eq(h.panel.handleEscape(), false, "closed panel leaves Esc to the caller:");
});

Deno.test("panel: the Esc that opened the panel (pointer-lock release) does not close it", () => {
  const h = harness();
  h.clock.step = 0;              // frozen clock: the keydown arrives in the same instant
  h.panel.open();
  h.clock.t += ESCAPE_GRACE_MS - 1;
  eq(h.panel.handleEscape(), true, "swallowed:");
  assert(h.panel.isOpen, "a duplicate Esc inside the grace must not resume");
  h.clock.t += 2;
  h.panel.handleEscape();
  assert(!h.panel.isOpen, "a later Esc resumes");
  eq(h.calls, ["open", "resume"]);
});

Deno.test("panel: from the menu only settings + Close; spectating has no Give up", () => {
  const h = harness({ context: "menu" });
  h.panel.open();
  eq(h.$("settings-title").textContent, "Settings");
  eq(h.$("btn-resume").lastChild!.textContent, "Close");
  assert(h.$("btn-giveup").disabled && h.$("btn-restart").disabled && h.$("btn-main-menu").disabled, "fight actions disabled");
  h.panel.requestGiveUp();
  assert(!h.panel.isConfirming, "no confirm outside a fight");
  click(h.$("btn-main-menu"));
  eq(h.calls, ["open"], "disabled buttons are inert:");

  const v = harness({ context: "spectate" });
  v.panel.open();
  eq(v.$("settings-title").textContent, "Paused");
  assert(v.$("btn-giveup").disabled && !v.$("btn-restart").disabled && !v.$("btn-main-menu").disabled, "spectate: no Give up only");
  click(v.$("btn-main-menu"));
  eq(v.calls, ["open", "menu"]);
  assert(!v.panel.isOpen);
  // Switching context mid-confirm drops the confirmation.
  const w = harness();
  w.panel.open(); click(w.$("btn-giveup"));
  w.panel.setContext("spectate");
  assert(!w.panel.isConfirming && w.$("settings-confirm").hidden, "confirm dropped");
});

Deno.test("panel: Restart and Main menu close without resuming", () => {
  const h = harness();
  h.panel.open(); click(h.$("btn-restart"));
  h.panel.open(); click(h.$("btn-main-menu"));
  eq(h.calls, ["open", "restart", "open", "menu"]);
});

Deno.test("panel: controls validate, save under the versioned key and report onChange", () => {
  const h = harness({ stored: { v: SETTINGS_VERSION, settings: { fov: 65, volume: 7, junk: 1 } } });
  eq(h.panel.settings.fov, 65, "loaded:");
  eq(h.panel.settings.volume, 1, "loaded value clamped:");
  eq(h.$("rng-fov").value, "65", "control shows the loaded value:");
  eq(h.$("sel-layout").firstChild!.textContent, "Auto (detected: AZERTY)");

  const sel = h.$("sel-camera");
  sel.value = "isometric";
  fire(sel, "change");
  eq(h.changes.at(-1)!.camera, "isometric");
  const rng = h.$("rng-sensitivity");
  rng.value = "12";
  fire(rng, "input");
  eq(h.changes.at(-1)!.mouseSensitivity, 3, "range clamps:");
  eq(rng.value, "3", "control re-synced to the clamped value:");
  const chk = h.$("chk-invert-y");
  chk.checked = true;
  fire(chk, "change");
  eq(h.changes.at(-1)!.invertY, true);
  const stored = JSON.parse(h.storage.getItem(SETTINGS_STORAGE_KEY)!);
  eq(stored.v, SETTINGS_VERSION);
  eq(Object.keys(stored.settings).sort(), [...SETTING_KEYS].sort(), "no junk saved:");
  eq(stored.settings.camera, "isometric");

  // update(): equal values do nothing; a real change saves and reports once.
  const writes = h.storage.writes, n = h.changes.length;
  h.panel.update({ camera: "isometric" });
  eq([h.storage.writes, h.changes.length], [writes, n], "no-op update:");
  h.panel.update({ minimap: "heading" });
  eq(h.$("sel-minimap").value, "heading");
  eq(h.changes.length, n + 1);
  h.panel.setDetectedLayout("qwertz");
  eq(h.$("sel-layout").firstChild!.textContent, "Auto (detected: QWERTZ)");
});

Deno.test("panel: Tab is trapped inside the dialog (and inside the confirm while it shows)", () => {
  const h = harness();
  h.panel.open();
  const order = h.panel.focusOrder();
  assert(order.length >= 10, `expected the X, 4 actions and the settings controls, got ${order.length}`);
  eq(order[0].id, "btn-close-settings");
  (order.at(-1) as unknown as FakeEl).focus();
  fire(h.doc.activeElement!, "keydown", { key: "Tab" });
  eq(h.doc.activeElement!.id, order[0].id, "Tab from the last wraps to the first:");
  fire(h.doc.activeElement!, "keydown", { key: "Tab", shiftKey: true });
  eq(h.doc.activeElement!.id, order.at(-1)!.id, "Shift+Tab from the first wraps to the last:");

  click(h.$("btn-giveup"));
  eq(h.panel.focusOrder().map((e) => e.id), ["btn-giveup-no", "btn-giveup-yes"]);
  h.$("btn-giveup-yes").focus();
  fire(h.$("btn-giveup-yes"), "keydown", { key: "Tab" });
  eq(h.doc.activeElement!.id, "btn-giveup-no");
  // Game keys typed in the dialog never reach the document (Space would attack).
  let leaked = 0;
  h.doc.addEventListener("keydown", () => leaked++);
  fire(h.$("btn-giveup-no"), "keydown", { key: " " });
  eq(leaked, 0);
});
