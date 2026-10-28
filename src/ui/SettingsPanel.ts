/**
 * SettingsPanel — the in-fight settings dialog and its icon-only gear button (W02, W03).
 *
 * Vocabulary:
 * - **settings**: the player's persistent options ({@link GameSettings}), stored in
 *   localStorage under ONE versioned key ({@link SETTINGS_STORAGE_KEY}). Loading validates
 *   every field against {@link SETTINGS_SCHEMA}: unknown keys are dropped, enum values outside
 *   their list and wrong types fall back to the default, numbers are clamped into range and
 *   snapped to their step, and a different schema version loads the defaults.
 * - **open / paused**: opening the panel mid-fight is a pause (the engine stops the simulation
 *   in `onOpen`); closing it is a resume (`onResume`). Esc backs out one level at a time:
 *   the give-up confirmation, then the panel itself.
 * - **give up (forfeit)**: ends the fight with the rival as the winner. It needs a confirm
 *   step ("Give up this fight? Your rival wins." Yes / No).
 *
 * The module-level helpers are pure (no DOM) so the engine and the tests can use them. The
 * class builds its DOM with createElement only (no innerHTML except the static icon SVG), so
 * it runs on a minimal fake DOM in Deno. CSP: no style attributes; state is classes and
 * attributes only.
 */
import { icon, type IconName } from "./Icons.ts";

// ------------------------------------------------------------------------------ model (pure)

/** A keyboard layout the game can label keys for (same strings as input/KeyboardLayout's `Layout`). */
export type KeyboardLayoutName = "azerty" | "qwerty" | "qwertz";
/** Layout used for key labels: "auto" follows the detector; any other value overrides it. */
export type LayoutChoice = "auto" | KeyboardLayoutName;
/** The player-selectable gameplay cameras (the engine's QA "axis" camera is not offered). */
export type CameraChoice = "close" | "third" | "isometric" | "birds-eye";
/** Minimap view (same strings as Minimap's `MinimapMode`). */
export type MinimapChoice = "overview" | "follow" | "heading";
/** Skill-effect intensity: scales the trail/effect density exponent (see {@link effectsDensityScale}). */
export type EffectsLevel = "low" | "normal" | "high";
/** Render quality: picks the render pixel budget (see {@link pixelBudgetFor}). */
export type QualityChoice = "auto" | "high" | "low";

/** Every persistent option. Units are given per field. */
export interface GameSettings {
  /** Key-label layout: "auto" = detected; otherwise a forced layout. Bindings stay physical. */
  layout: LayoutChoice;
  /** Mouse-look multiplier (dimensionless; 1 = the engine's base 0.003 rad per pixel). */
  mouseSensitivity: number;
  /** True: moving the mouse up tilts the camera down (flight-stick convention). */
  invertY: boolean;
  /** Gameplay camera. */
  camera: CameraChoice;
  /** First-person view (the V key toggles the same flag). */
  firstPerson: boolean;
  /** Vertical field of view of the third-person camera, degrees. */
  fov: number;
  /** Minimap view (clicking the map or M cycles the same value). */
  minimap: MinimapChoice;
  /** Skill-effect intensity. */
  effects: EffectsLevel;
  /** Show the control legend at the bottom of the screen. */
  showHints: boolean;
  /** Render quality (pixel budget). */
  quality: QualityChoice;
  /** Master volume, 0 (mute) .. 1 (full). */
  volume: number;
}

/** One field of the schema: an enum, a bounded number or a boolean, each with its default. */
export type SettingRule =
  | { readonly kind: "enum"; readonly values: readonly string[]; readonly def: string }
  | { readonly kind: "number"; readonly min: number; readonly max: number; readonly step: number; readonly def: number }
  | { readonly kind: "bool"; readonly def: boolean };

/** Storage key of the settings record (one key, versioned payload `{ v, settings }`). */
export const SETTINGS_STORAGE_KEY = "mytherrania.settings";
/** Schema version. Bump it when a field changes meaning; older records then load the defaults. */
export const SETTINGS_VERSION = 1;

/**
 * The engine's base mouse-look rate, radians of orbit per pixel of mouse travel
 * (Engine third-person camera: `orbitYaw -= dx * 0.003`). Sensitivity multiplies it.
 */
export const BASE_LOOK_RADIANS_PER_PIXEL = 0.003;
/** The close camera keeps today's +10 degree wider view than the third-person one (60 vs 50). */
export const CLOSE_CAMERA_FOV_OFFSET = 10;

/**
 * Validation rules for every field. Ranges, with reasons:
 * - mouseSensitivity 0.25..3 (step 0.05): a quarter to three times the base 0.003 rad/px,
 *   i.e. 1.3 to 16 cm of a 1000 dpi mouse per half-turn.
 * - fov 40..90 degrees (step 1): narrower than 40 hides the rival at duelling range; wider
 *   than 90 distorts the edges of a 16:9 frame. Default 50 = the camera's built-in value.
 * - volume 0..1 (step 0.05): linear gain; default 0.75 = the engine's built-in value.
 */
export const SETTINGS_SCHEMA: Readonly<Record<keyof GameSettings, SettingRule>> = {
  layout: { kind: "enum", values: ["auto", "azerty", "qwerty", "qwertz"], def: "auto" },
  mouseSensitivity: { kind: "number", min: 0.25, max: 3, step: 0.05, def: 1 },
  invertY: { kind: "bool", def: false },
  camera: { kind: "enum", values: ["third", "close", "isometric", "birds-eye"], def: "third" },
  firstPerson: { kind: "bool", def: false },
  fov: { kind: "number", min: 40, max: 90, step: 1, def: 50 },
  minimap: { kind: "enum", values: ["overview", "follow", "heading"], def: "overview" },
  effects: { kind: "enum", values: ["low", "normal", "high"], def: "normal" },
  showHints: { kind: "bool", def: true },
  quality: { kind: "enum", values: ["auto", "high", "low"], def: "auto" },
  volume: { kind: "number", min: 0, max: 1, step: 0.05, def: 0.75 },
};

/** Field names in display order. */
export const SETTING_KEYS = Object.keys(SETTINGS_SCHEMA) as (keyof GameSettings)[];

/** The defaults, read off the schema. */
export const DEFAULT_SETTINGS: Readonly<GameSettings> = Object.freeze(
  Object.fromEntries(SETTING_KEYS.map((k) => [k, SETTINGS_SCHEMA[k].def])) as unknown as GameSettings,
);

/** Decimals of a step (0.05 -> 2), so snapped values print and compare exactly. */
function stepDecimals(step: number): number {
  const s = String(step);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

/**
 * Clamp `value` into [min, max] and snap it to the nearest step counted from min:
 *   v' = min + round((clamp(v) - min) / step) * step, rounded to the step's decimals.
 */
export function clampToRule(value: number, rule: { min: number; max: number; step: number }): number {
  const c = Math.min(rule.max, Math.max(rule.min, value));
  const snapped = rule.min + Math.round((c - rule.min) / rule.step) * rule.step;
  return Number(Math.min(rule.max, snapped).toFixed(stepDecimals(rule.step)));
}

/** True for a plain object (not null, not an array). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate an untrusted settings object (from storage or a caller) into a complete
 * {@link GameSettings}: unknown keys dropped; wrong types and unknown enum values -> default;
 * finite numbers clamped and snapped (non-finite -> default). Never throws.
 */
export function sanitizeSettings(raw: unknown): GameSettings {
  const src = isRecord(raw) ? raw : {};
  const out: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const rule = SETTINGS_SCHEMA[key];
    const v = src[key];
    if (rule.kind === "enum") out[key] = typeof v === "string" && rule.values.includes(v) ? v : rule.def;
    else if (rule.kind === "bool") out[key] = typeof v === "boolean" ? v : rule.def;
    else out[key] = typeof v === "number" && Number.isFinite(v) ? clampToRule(v, rule) : rule.def;
  }
  return out as unknown as GameSettings;
}

/**
 * Read a stored record (the JSON text under {@link SETTINGS_STORAGE_KEY}). Missing text,
 * broken JSON, or a version other than {@link SETTINGS_VERSION} -> the defaults.
 */
export function parseStoredSettings(text: string | null | undefined): GameSettings {
  if (!text) return { ...DEFAULT_SETTINGS };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { ...DEFAULT_SETTINGS }; }
  if (!isRecord(parsed) || parsed.v !== SETTINGS_VERSION) return { ...DEFAULT_SETTINGS };
  return sanitizeSettings(parsed.settings);
}

/** The stored form: `{"v":1,"settings":{...}}` (sanitized first). */
export function serializeSettings(s: GameSettings): string {
  return JSON.stringify({ v: SETTINGS_VERSION, settings: sanitizeSettings(s) });
}

/** The two methods of `Storage` the panel uses (localStorage, or a fake in tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Load from `storage` (never throws: a blocked storage reads as the defaults). */
export function loadSettings(storage: StorageLike | null): GameSettings {
  if (!storage) return { ...DEFAULT_SETTINGS };
  try { return parseStoredSettings(storage.getItem(SETTINGS_STORAGE_KEY)); } catch { return { ...DEFAULT_SETTINGS }; }
}

/** Save to `storage`; returns false when storage is missing or refuses (quota, private mode). */
export function saveSettings(storage: StorageLike | null, s: GameSettings): boolean {
  if (!storage) return false;
  try { storage.setItem(SETTINGS_STORAGE_KEY, serializeSettings(s)); return true; } catch { return false; }
}

/**
 * Render pixel budgets, in device pixels (the engine caps devicePixelRatio so that
 * cssW x cssH x ratio^2 <= budget; perf review R13 measured ~0.31 ms GPU per megapixel on an
 * M1 Pro, ~2x on a base M1):
 * - auto = 4 Mpx: the engine's own budget (keeps a 4K screen near a laptop's cost).
 * - high = 3840 x 2160 = 8 294 400 px: a full 4K frame (~2.6 ms on an M1 Pro).
 * - low  = 1280 x  720 =   921 600 px: a 720p frame (~0.3 ms), for a base M1 on battery.
 */
export const PIXEL_BUDGETS: Readonly<Record<QualityChoice, number>> = {
  auto: 4_000_000,
  high: 3840 * 2160,
  low: 1280 * 720,
};

/** Pixel budget (device pixels) for a quality choice. */
export function pixelBudgetFor(q: QualityChoice): number {
  return PIXEL_BUDGETS[q];
}

/**
 * Multiplier on the effect density exponent k (FxShaders' FX_DENSITY: a' = 1 - (1 - a)^k).
 * At a mid-opacity texel a = 0.5: low k x 0.6 -> a' = 0.34 (about two-thirds of normal);
 * high k x 1.5 -> a' = 0.65 (about 30% denser).
 */
export const EFFECTS_DENSITY_SCALE: Readonly<Record<EffectsLevel, number>> = { low: 0.6, normal: 1, high: 1.5 };

/** Density multiplier for an effects level. */
export function effectsDensityScale(level: EffectsLevel): number {
  return EFFECTS_DENSITY_SCALE[level];
}

/** Vertical field of view (degrees) of a perspective camera mode under `s`. */
export function fovFor(mode: "close" | "third", s: Pick<GameSettings, "fov">): number {
  return mode === "close" ? s.fov + CLOSE_CAMERA_FOV_OFFSET : s.fov;
}

/**
 * Mouse-look rates in radians per pixel: yaw = base x sensitivity; pitch is the same,
 * negated when `invertY` is on. The engine multiplies the mouse deltas by these.
 */
export function lookRates(s: Pick<GameSettings, "mouseSensitivity" | "invertY">): { yaw: number; pitch: number } {
  const r = BASE_LOOK_RADIANS_PER_PIXEL * s.mouseSensitivity;
  return { yaw: r, pitch: s.invertY ? -r : r };
}

/** The key-label layout to use: the forced one, or the detected one under "auto". */
export function effectiveLayout(choice: LayoutChoice, detected: KeyboardLayoutName): KeyboardLayoutName {
  return choice === "auto" ? detected : choice;
}

/** Upper-case display name of a layout ("azerty" -> "AZERTY"). */
export const layoutName = (l: KeyboardLayoutName): string => l.toUpperCase();

/**
 * Esc presses ignored right after the panel opens, ms. One physical Esc can reach the page
 * twice: as the browser releasing pointer lock (the engine opens the panel on
 * `pointerlockchange`) and, in some browsers, as a keydown a frame or two later (< 50 ms).
 * Without a grace that second copy would close the panel at once. 250 ms is still far below a
 * deliberate second press (reading the dialog, then pressing again).
 */
export const ESCAPE_GRACE_MS = 250;

/** The give-up confirmation question (W02). */
export const GIVE_UP_QUESTION = "Give up this fight? Your rival wins.";

// ------------------------------------------------------------------------------ the panel

/** What the panel asks of its owner. Every callback runs AFTER the panel updated itself. */
export interface SettingsCallbacks {
  /** The panel closed by Resume, the X, or Esc: resume the fight. */
  onResume(): void;
  /** Give up was confirmed: end the match, the rival wins (endReason "forfeit"). */
  onGiveUp(): void;
  /** Restart the fight with the same fighters. */
  onRestart(): void;
  /** Leave the fight for the title menu. */
  onMainMenu(): void;
  /** A setting changed (already validated and saved). Receives a copy. */
  onChange(settings: GameSettings): void;
  /** The panel opened (gear click, Esc, or pointer-lock loss): pause the fight. */
  onOpen?(): void;
}

/** Construction options (tests inject storage; the engine passes the detected layout). */
export interface SettingsPanelOptions {
  /** Where settings persist; default `globalThis.localStorage`; `null` = no persistence. */
  storage?: StorageLike | null;
  /** Layout the detector currently reports (shown as "Auto (detected: …)"). */
  detectedLayout?: KeyboardLayoutName;
  /** Where the gear goes (e.g. the HUD, so it shows only with it); default `container`. */
  gearContainer?: HTMLElement;
  /** Milliseconds clock for the Esc grace; default `performance.now` (tests inject one). */
  now?: () => number;
}

/**
 * Where the panel was opened from: the title/menu screens (settings only), the player's own
 * fight (everything, Give up included), or a spectated AI fight (no Give up: nobody to forfeit).
 */
export type PanelContext = "menu" | "fight" | "spectate";

/** Which focus group a control belongs to: the main panel, or the give-up confirmation. */
type FocusGroup = "main" | "confirm";

/** The default storage, or null when the page may not use it. */
function defaultStorage(): StorageLike | null {
  try { return (globalThis as { localStorage?: StorageLike }).localStorage ?? null; } catch { return null; }
}

/**
 * The gear button + modal settings dialog.
 *
 * DOM (ids are stable for QA tools): `#btn-settings` (icon only, aria-label "Settings",
 * title "Settings (Esc)"), `#settings-backdrop`, `#settings-dialog` (role dialog, aria-modal)
 * with sections Game (`#btn-resume`, `#btn-giveup` + `#settings-confirm` with
 * `#btn-giveup-yes` / `#btn-giveup-no`, `#btn-restart`, `#btn-main-menu`), Controls
 * (`#sel-layout`, `#rng-sensitivity`, `#chk-invert-y`), Camera (`#sel-camera`,
 * `#chk-first-person`, `#rng-fov`), Display (`#sel-minimap`, `#sel-effects`, `#chk-hints`,
 * `#sel-quality`) and Audio (`#rng-volume`).
 *
 * Modal while open: a backdrop blocks the canvas and HUD, Tab cycles inside the dialog (only
 * inside the confirmation while it shows), and keydowns inside the dialog do not reach the
 * game. Settings are NOT pushed through `onChange` at construction: read `settings` once and
 * apply it yourself.
 */
export class SettingsPanel {
  /** The icon-only gear button. */
  readonly button: HTMLButtonElement;
  /** The modal dialog. */
  readonly dialog: HTMLElement;
  /** The full-screen click shield behind the dialog. */
  readonly backdrop: HTMLElement;

  #doc: Document;
  #cb: SettingsCallbacks;
  #storage: StorageLike | null;
  #settings: GameSettings;
  #detected: KeyboardLayoutName;
  #open = false;
  #confirming = false;
  #context: PanelContext = "menu";
  #returnFocus: Element | null = null;
  #now: () => number;
  /** `#now()` when the panel last opened (for {@link ESCAPE_GRACE_MS}). */
  #openedAt = -Infinity;
  /** Focusable controls in tab order, with their focus group. */
  #focusables: { el: HTMLElement; group: FocusGroup }[] = [];
  /** Per-setting writers that push the current value into the control. */
  #syncers: (() => void)[] = [];
  #title!: HTMLElement;
  #confirmBox!: HTMLElement;
  #autoOption!: HTMLOptionElement;
  #btnResume!: HTMLButtonElement;
  #resumeLabel!: HTMLElement;
  #btnGiveUp!: HTMLButtonElement;
  #btnRestart!: HTMLButtonElement;
  #btnMenu!: HTMLButtonElement;
  #btnNo!: HTMLButtonElement;

  constructor(container: HTMLElement, callbacks: SettingsCallbacks, options: SettingsPanelOptions = {}) {
    this.#doc = container.ownerDocument;
    this.#cb = callbacks;
    this.#storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.#settings = loadSettings(this.#storage);
    this.#detected = options.detectedLayout ?? "qwerty";
    this.#now = options.now ?? (() => globalThis.performance?.now() ?? Date.now());

    // Gear: icon only, still a real button (focusable, Enter/Space, hover, screen-reader name).
    const btn = this.#el("button", "hud-gear") as HTMLButtonElement;
    btn.id = "btn-settings";
    btn.type = "button";
    btn.setAttribute("aria-label", "Settings");
    btn.setAttribute("title", "Settings (Esc)");
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-controls", "settings-dialog");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = icon("gear", "gear-icon");
    btn.addEventListener("click", (e) => {
      // A mouse click must not leave focus on the gear: Space would re-press it mid-fight.
      if ((e as MouseEvent).detail > 0) btn.blur?.();
      this.toggle();
    });
    this.button = btn;

    const backdrop = this.#el("div", "settings-backdrop");
    backdrop.id = "settings-backdrop";
    backdrop.hidden = true;
    // Keep focus inside the dialog when the shield is clicked (Esc keeps working).
    backdrop.addEventListener("mousedown", (e) => e.preventDefault());
    this.backdrop = backdrop;

    const dlg = this.#el("div", "settings-dialog");
    dlg.id = "settings-dialog";
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");
    dlg.setAttribute("aria-labelledby", "settings-title");
    dlg.hidden = true;
    dlg.addEventListener("keydown", (e) => this.#onKey(e as KeyboardEvent));
    this.dialog = dlg;
    this.#buildDialog(dlg);

    (options.gearContainer ?? container).appendChild(btn);
    container.appendChild(backdrop);
    container.appendChild(dlg);
    this.#syncAll();
    this.setContext("menu");
  }

  /** True while the dialog shows. */
  get isOpen(): boolean { return this.#open; }
  /** True while the give-up confirmation shows. */
  get isConfirming(): boolean { return this.#confirming; }
  /** Where the panel was opened from (see {@link PanelContext}). */
  get context(): PanelContext { return this.#context; }
  /** A copy of the current settings. */
  get settings(): GameSettings { return { ...this.#settings }; }

  /** Show the dialog (no-op when open) and call `onOpen`. Focus moves to Resume. */
  open(): void {
    if (this.#open) return;
    this.#open = true;
    this.#openedAt = this.#now();
    this.#returnFocus = this.#doc.activeElement;
    this.#setShown(true);
    this.#cb.onOpen?.();
    this.#btnResume.focus?.();
  }

  /** Close = resume: hide the dialog (no-op when closed) and call `onResume`. */
  close(): void {
    if (!this.#open) return;
    this.#hide();
    this.#cb.onResume();
  }

  /** Open when closed, close (resume) when open. */
  toggle(): void {
    if (this.#open) this.close(); else this.open();
  }

  /**
   * Esc, one level at a time: the confirmation -> cancelled; the panel -> closed (resume).
   * An Esc within {@link ESCAPE_GRACE_MS} of opening is the press that opened it: swallowed.
   * Returns false when the panel is closed, so the caller can open it or go Back instead.
   */
  handleEscape(): boolean {
    if (!this.#open) return false;
    if (this.#now() - this.#openedAt < ESCAPE_GRACE_MS) return true;
    if (this.#confirming) this.cancelGiveUp(); else this.close();
    return true;
  }

  /** Give up, step 1: show "Give up this fight? Your rival wins." (only in a fight). */
  requestGiveUp(): void {
    if (!this.#open || this.#context !== "fight" || this.#confirming) return;
    this.#confirming = true;
    this.#confirmBox.hidden = false;
    this.#setActionsDisabled(true);
    // "No" takes focus: Enter on a stray key press never forfeits.
    this.#btnNo.focus?.();
  }

  /** Give up, step 2 (Yes): close without resuming and call `onGiveUp`. Needs step 1. */
  confirmGiveUp(): void {
    if (!this.#confirming) return;
    this.#hide();
    this.#cb.onGiveUp();
  }

  /** Give up, No: hide the confirmation and return focus to the Give up button. */
  cancelGiveUp(): void {
    if (!this.#confirming) return;
    this.#endConfirm();
    this.#btnGiveUp.focus?.();
  }

  /**
   * Set where the panel is used. "fight": titled "Paused", every action enabled. "spectate":
   * "Paused", Give up disabled. "menu": "Settings", Resume reads "Close", and Give up,
   * Restart and Main menu are disabled (there is no fight to leave).
   */
  setContext(context: PanelContext): void {
    this.#context = context;
    this.#title.textContent = context === "menu" ? "Settings" : "Paused";
    this.#resumeLabel.textContent = context === "menu" ? "Close" : "Resume";
    if (context !== "fight" && this.#confirming) this.#endConfirm();
    this.#setActionsDisabled(this.#confirming);
  }

  /** The layout the detector reports, shown in the "Auto (detected: …)" option. */
  setDetectedLayout(layout: KeyboardLayoutName): void {
    this.#detected = layout;
    this.#autoOption.textContent = `Auto (detected: ${layoutName(layout)})`;
  }

  /**
   * Change settings from outside the dialog (V toggles first-person, M cycles the minimap):
   * validated, saved, pushed into the controls, then `onChange`. Equal values do nothing.
   */
  update(patch: Partial<GameSettings>): void {
    const next = sanitizeSettings({ ...this.#settings, ...patch });
    if (SETTING_KEYS.every((k) => next[k] === this.#settings[k])) return;
    this.#settings = next;
    saveSettings(this.#storage, next);
    this.#syncAll();
    this.#cb.onChange({ ...next });
  }

  // ---------------------------------------------------------------- internals

  #el(tag: string, cls = "", text = ""): HTMLElement {
    const el = this.#doc.createElement(tag);
    if (cls) el.className = cls;
    if (text) el.textContent = text;
    return el;
  }

  #focusable<T extends HTMLElement>(el: T, group: FocusGroup = "main"): T {
    this.#focusables.push({ el, group });
    return el;
  }

  #button(id: string, label: string, iconName: IconName | null, cls: string, onClick: () => void, group: FocusGroup = "main"): HTMLButtonElement {
    const b = this.#el("button", `settings-btn ${cls}`.trim()) as HTMLButtonElement;
    b.id = id;
    b.type = "button";
    if (iconName) {
      const ic = this.#el("span", "settings-btn-icon");
      ic.innerHTML = icon(iconName);
      b.appendChild(ic);
    }
    b.appendChild(this.#el("span", "settings-btn-label", label));
    b.addEventListener("click", onClick);
    return this.#focusable(b, group);
  }

  #section(parent: HTMLElement, id: string, heading: string): HTMLElement {
    const s = this.#el("section", "settings-section");
    s.setAttribute("data-section", id);
    s.setAttribute("aria-labelledby", `settings-h-${id}`);
    const h = this.#el("h3", "settings-section-head", heading);
    h.id = `settings-h-${id}`;
    s.appendChild(h);
    parent.appendChild(s);
    return s;
  }

  /** A labelled row: `<label class="settings-row"><span>Label</span>{control}{output?}</label>`. */
  #row(parent: HTMLElement, label: string, control: HTMLElement, output?: HTMLElement): void {
    const row = this.#el("label", "settings-row");
    row.appendChild(this.#el("span", "settings-label", label));
    row.appendChild(control);
    if (output) row.appendChild(output);
    parent.appendChild(row);
  }

  #select<K extends keyof GameSettings>(parent: HTMLElement, id: string, label: string, key: K, options: [string, string][]): HTMLSelectElement {
    const sel = this.#focusable(this.#el("select") as HTMLSelectElement);
    sel.id = id;
    for (const [value, text] of options) {
      const o = this.#el("option", "", text) as HTMLOptionElement;
      o.value = value;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => this.update({ [key]: sel.value } as Partial<GameSettings>));
    this.#syncers.push(() => { sel.value = String(this.#settings[key]); });
    this.#row(parent, label, sel);
    return sel;
  }

  #range<K extends keyof GameSettings>(parent: HTMLElement, id: string, label: string, key: K, format: (v: number) => string): void {
    const rule = SETTINGS_SCHEMA[key];
    if (rule.kind !== "number") throw new Error(`#range: ${String(key)} is not a number setting`);
    const input = this.#focusable(this.#el("input") as HTMLInputElement);
    input.id = id;
    input.type = "range";
    input.min = String(rule.min);
    input.max = String(rule.max);
    input.step = String(rule.step);
    const out = this.#el("output", "settings-value");
    out.setAttribute("for", id);
    input.addEventListener("input", () => this.update({ [key]: Number(input.value) } as Partial<GameSettings>));
    this.#syncers.push(() => {
      const v = this.#settings[key] as number;
      input.value = String(v);
      out.textContent = format(v);
    });
    this.#row(parent, label, input, out);
  }

  #check<K extends keyof GameSettings>(parent: HTMLElement, id: string, label: string, key: K): void {
    const input = this.#focusable(this.#el("input") as HTMLInputElement);
    input.id = id;
    input.type = "checkbox";
    input.addEventListener("change", () => this.update({ [key]: input.checked } as Partial<GameSettings>));
    this.#syncers.push(() => { input.checked = this.#settings[key] as boolean; });
    this.#row(parent, label, input);
  }

  #buildDialog(dlg: HTMLElement): void {
    const head = this.#el("header", "settings-head");
    this.#title = this.#el("h2", "settings-title", "Settings");
    this.#title.id = "settings-title";
    head.appendChild(this.#title);
    const x = this.#el("button", "settings-x") as HTMLButtonElement;
    x.id = "btn-close-settings";
    x.type = "button";
    x.setAttribute("aria-label", "Resume (Esc)");
    x.setAttribute("title", "Resume (Esc)");
    x.innerHTML = icon("close");
    x.addEventListener("click", () => this.close());
    head.appendChild(this.#focusable(x));
    dlg.appendChild(head);

    // Game: the fight actions. Give up asks first; the question shows BELOW the row, so a
    // double-click on Give up lands on the (disabled) Give up again, never on Yes.
    const game = this.#section(dlg, "game", "Game");
    const actions = this.#el("div", "settings-actions");
    this.#btnResume = this.#button("btn-resume", "Resume", "play", "is-primary", () => this.close());
    this.#resumeLabel = this.#btnResume.lastChild as HTMLElement;
    this.#btnGiveUp = this.#button("btn-giveup", "Give up", "flag", "is-danger", () => this.requestGiveUp());
    this.#btnRestart = this.#button("btn-restart", "Restart", "restart", "", () => { this.#hide(); this.#cb.onRestart(); });
    this.#btnMenu = this.#button("btn-main-menu", "Main menu", "home", "", () => { this.#hide(); this.#cb.onMainMenu(); });
    for (const b of [this.#btnResume, this.#btnGiveUp, this.#btnRestart, this.#btnMenu]) actions.appendChild(b);
    game.appendChild(actions);
    const confirm = this.#el("div", "settings-confirm");
    confirm.id = "settings-confirm";
    confirm.setAttribute("role", "alertdialog");
    confirm.setAttribute("aria-labelledby", "settings-confirm-text");
    confirm.hidden = true;
    const q = this.#el("p", "settings-confirm-text", GIVE_UP_QUESTION);
    q.id = "settings-confirm-text";
    confirm.appendChild(q);
    const answers = this.#el("div", "settings-confirm-actions");
    this.#btnNo = this.#button("btn-giveup-no", "No, keep fighting", null, "", () => this.cancelGiveUp(), "confirm");
    answers.appendChild(this.#btnNo);
    answers.appendChild(this.#button("btn-giveup-yes", "Yes, give up", "flag", "is-danger", () => this.confirmGiveUp(), "confirm"));
    confirm.appendChild(answers);
    game.appendChild(confirm);
    this.#confirmBox = confirm;

    const grid = this.#el("div", "settings-grid");
    dlg.appendChild(grid);

    const controls = this.#section(grid, "controls", "Controls");
    const layoutSel = this.#select(controls, "sel-layout", "Keyboard layout", "layout", [
      ["auto", "Auto"], ["azerty", "AZERTY"], ["qwerty", "QWERTY"], ["qwertz", "QWERTZ"],
    ]);
    this.#autoOption = layoutSel.firstChild as HTMLOptionElement;
    this.setDetectedLayout(this.#detected);
    this.#range(controls, "rng-sensitivity", "Mouse sensitivity", "mouseSensitivity", (v) => `${v.toFixed(2)}×`);
    this.#check(controls, "chk-invert-y", "Invert vertical look", "invertY");

    const camera = this.#section(grid, "camera", "Camera");
    this.#select(camera, "sel-camera", "Camera", "camera", [
      ["third", "Third person"], ["close", "Close"], ["isometric", "Isometric"], ["birds-eye", "Bird's-eye"],
    ]);
    this.#check(camera, "chk-first-person", "First-person view (V)", "firstPerson");
    this.#range(camera, "rng-fov", "Field of view", "fov", (v) => `${Math.round(v)}°`);

    const display = this.#section(grid, "display", "Display");
    this.#select(display, "sel-minimap", "Minimap view (M)", "minimap", [
      ["overview", "Whole arena"], ["follow", "Follow me"], ["heading", "My heading up"],
    ]);
    this.#select(display, "sel-effects", "Effects", "effects", [["low", "Low"], ["normal", "Normal"], ["high", "High"]]);
    this.#check(display, "chk-hints", "Show control hints", "showHints");
    this.#select(display, "sel-quality", "Quality", "quality", [
      ["auto", "Auto (4 Mpx)"], ["high", "High (4K)"], ["low", "Low (720p)"],
    ]);

    const audio = this.#section(grid, "audio", "Audio");
    this.#range(audio, "rng-volume", "Master volume", "volume", (v) => `${Math.round(v * 100)}%`);
  }

  #syncAll(): void {
    for (const s of this.#syncers) s();
  }

  #setShown(shown: boolean): void {
    this.dialog.hidden = !shown;
    this.backdrop.hidden = !shown;
    this.dialog.classList.toggle("open", shown);
    this.button.setAttribute("aria-expanded", String(shown));
    this.button.classList.toggle("is-active", shown);
  }

  /** Hide without a callback; restore focus to where it was before opening. */
  #hide(): void {
    if (this.#confirming) this.#endConfirm();
    this.#open = false;
    this.#setShown(false);
    const back = this.#returnFocus as HTMLElement | null;
    this.#returnFocus = null;
    if (back && back !== this.button && typeof back.focus === "function") back.focus();
  }

  #endConfirm(): void {
    this.#confirming = false;
    this.#confirmBox.hidden = true;
    this.#setActionsDisabled(false);
  }

  /** While confirming every action is disabled; the context disables what has no meaning. */
  #setActionsDisabled(confirming: boolean): void {
    const ctx = this.#context;
    this.#btnResume.disabled = confirming;
    this.#btnGiveUp.disabled = confirming || ctx !== "fight";
    this.#btnRestart.disabled = confirming || ctx === "menu";
    this.#btnMenu.disabled = confirming || ctx === "menu";
  }

  /** The controls Tab may visit now: the confirmation's while it shows, else the panel's. */
  focusOrder(): HTMLElement[] {
    const group: FocusGroup = this.#confirming ? "confirm" : "main";
    return this.#focusables
      .filter((f) => f.group === group && !(f.el as HTMLButtonElement).disabled)
      .map((f) => f.el);
  }

  #onKey(e: KeyboardEvent): void {
    // Keys typed inside the dialog never reach the game's key handler (Space = attack, …).
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      this.handleEscape();
      return;
    }
    if (e.key !== "Tab") return;
    const order = this.focusOrder();
    if (!order.length) return;
    // The keydown's target is the focused control; fall back to activeElement.
    let at = order.indexOf(e.target as HTMLElement);
    if (at < 0) at = order.indexOf(this.#doc.activeElement as HTMLElement);
    const next = e.shiftKey ? (at <= 0 ? order.length - 1 : at - 1) : (at < 0 || at >= order.length - 1 ? 0 : at + 1);
    e.preventDefault();
    order[next].focus?.();
  }
}
