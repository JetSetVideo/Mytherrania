// Stepper: a  ‹ value ›  control — change a value with LEFT / RIGHT, never a dropdown.
//
// The player asked for values that are changed by stepping left and right. This module is
// that control, in three layers:
//
//   1. A PURE model (no DOM): `stepIndex` / `stepEnabled` / `stepperModel` for enumerated
//      values, `stepNumber` / `numberDomain` / `numberModel` for numeric ranges, plus the
//      key map (`keyAction`) and the aria view (`stepperView`). Total over garbage: NaN,
//      empty option lists, a step of 0, min > max all resolve to something sane, never throw.
//   2. A DOM component, `class Stepper`:  [‹] [value + sub-label] [›]  as one
//      `role="spinbutton"` tab stop with keyboard, press-and-hold auto-repeat and
//      disabled ends. Built with createElement/setAttribute only: the page CSP is
//      `style-src 'self'`, so no `style="..."` anywhere (the arrow SVGs carry presentation
//      ATTRIBUTES, which the CSP allows — same rule as Icons.ts).
//   3. PROGRESSIVE ENHANCEMENT: `upgradeSelect` / `upgradeRange` / `upgradeNumber` /
//      `upgradeAll` hide an existing <select>/<input> and put a Stepper beside it. The
//      native element stays in the DOM as the SOURCE OF TRUTH: every existing listener and
//      every `el.value` read keeps working, because a step writes the native element and
//      dispatches `input` + `change` exactly as a user choice would.
//
// No THREE, no Math.random. Browser globals are only reached through the element's own
// `ownerDocument` / `defaultView`, so the tests drive it with a hand-rolled document shim.

import { icon, ICON_GRID, ICON_NAMES, ICON_STROKE_WIDTH, type IconName } from "./Icons.ts";

// ------------------------------------------------------------------------------ constants

/** Text shown when there is no value (empty <select>, empty number input). */
export const STEPPER_EMPTY_TEXT = "\u2014";
/** Press-and-hold: first repeat after this many ms ... */
export const STEPPER_REPEAT_DELAY_MS = 350;
/** ... then one step every this many ms. */
export const STEPPER_REPEAT_INTERVAL_MS = 60;
/** PageUp / PageDown on a numeric stepper move this many steps. */
export const STEPPER_PAGE_STEPS = 10;
/** Decimal places a numeric value is rounded to at most (kills 0.1 + 0.2 drift). */
export const STEPPER_MAX_DECIMALS = 12;
/** The smallest step honoured; a smaller positive step is raised to this. */
export const STEPPER_MIN_STEP = 1e-12;
/** The attribute that marks an upgraded native element (`"1"`), or opts one out (`"off"`). */
export const STEPPER_MARK = "data-stepper";
/** Class added to the hidden native element (the CSS block hides it with !important). */
export const STEPPER_NATIVE_CLASS = "stepper-native";

/** The largest |delta| a single step honours (keeps index arithmetic finite). */
const MAX_DELTA = 1e9;
/** Grid tolerance, in steps: a value within this of a grid point is ON the grid. */
const GRID_EPS = 1e-7;

// ------------------------------------------------------------------------- pure: labels

/** What the value well shows: the main text, an optional small sub-label and icon markup. */
export interface StepperLabel {
  readonly text: string;
  readonly sub?: string;
  /** Trusted inline-SVG markup (e.g. from Icons.ts `icon()`); never user text. */
  readonly icon?: string;
}

/** One enumerated choice. */
export interface StepperOption {
  readonly label: string;
  readonly sub?: string;
  readonly icon?: string;
  /** A disabled (or hidden) option is skipped by every step, like a native <select>. */
  readonly disabled?: boolean;
}

/** An option may be given as a bare string. */
export type StepperOptionInput = string | StepperOption;

/** The label formatter hook: a value to a string or a full label. Garbage falls back. */
export type StepperFormat = (value: number) => string | StepperLabel | null | undefined;

/**
 * Normalise anything a formatter may return into a label. A string (non-blank), a finite
 * number, or an object with a string `text` are honoured; everything else is `fallback`.
 */
export function toLabel(x: unknown, fallback: string = STEPPER_EMPTY_TEXT): StepperLabel {
  if (typeof x === "string") return { text: x.trim() === "" ? fallback : x };
  if (typeof x === "number") return { text: Number.isFinite(x) ? String(x) : fallback };
  if (x !== null && typeof x === "object") {
    const o = x as { text?: unknown; sub?: unknown; icon?: unknown };
    if (typeof o.text === "string") {
      const label: { text: string; sub?: string; icon?: string } = {
        text: o.text.trim() === "" ? fallback : o.text,
      };
      if (typeof o.sub === "string" && o.sub.trim() !== "") label.sub = o.sub;
      if (typeof o.icon === "string" && o.icon !== "") label.icon = o.icon;
      return label;
    }
  }
  return { text: fallback };
}

/** Normalise one option entry; garbage becomes an (enabled) blank option. */
export function normalizeOption(x: unknown): StepperOption {
  if (typeof x === "string") return { label: x };
  if (x !== null && typeof x === "object") {
    const o = x as { label?: unknown; sub?: unknown; icon?: unknown; disabled?: unknown };
    const out: { label: string; sub?: string; icon?: string; disabled?: boolean } = {
      label: typeof o.label === "string" ? o.label : "",
    };
    if (typeof o.sub === "string") out.sub = o.sub;
    if (typeof o.icon === "string") out.icon = o.icon;
    if (o.disabled === true) out.disabled = true;
    return out;
  }
  return { label: "" };
}

// ----------------------------------------------------------------- pure: enumerated values

function truncDelta(delta: number): number {
  if (!Number.isFinite(delta)) return 0;
  return Math.max(-MAX_DELTA, Math.min(MAX_DELTA, Math.trunc(delta)));
}

/**
 * Step an index in a list of `n` items by `delta`.
 *
 * - `n` not a finite number >= 1 -> -1 (there is no valid index).
 * - `index` NaN -> 0; above the list -> the last item; below 0 -> -1, meaning "nothing
 *   selected" (a <select> whose selectedIndex is -1): +1 from there is the first item.
 * - `delta` NaN -> no move; fractional deltas truncate.
 * - Without `wrap` the result clamps to [0, n-1]. With `wrap`, a step that would leave the
 *   list wraps ONLY when it starts on the end it leaves: a big step (PageUp) from the middle
 *   stops on the end first, so a hold never skips past the last item silently.
 */
export function stepIndex(n: number, index: number, delta: number, wrap = false): number {
  const count = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 0;
  if (count === 0) return -1;
  const last = count - 1;
  const i = Number.isNaN(index) ? 0 : Math.max(-1, Math.min(last, Math.trunc(index)));
  const d = truncDelta(delta);
  if (d === 0) return i;
  const target = i + d;
  if (target >= 0 && target <= last) return target;
  if (target > last) return wrap && i === last ? 0 : last;
  // target < 0
  if (i === -1) return wrap ? last : -1;
  return wrap && i === 0 ? last : 0;
}

function nextEnabled(enabled: readonly boolean[], from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < enabled.length; i += dir) if (enabled[i]) return i;
  return -1;
}

/**
 * `stepIndex` over a list where some items are disabled (skipped, like a native select's
 * disabled options). Same garbage and wrap rules; if no other item is enabled the index
 * does not move. Starting ON a disabled item (a disabled placeholder) is allowed.
 */
export function stepEnabled(
  enabled: readonly boolean[],
  index: number,
  delta: number,
  wrap = false,
): number {
  const n = Array.isArray(enabled) ? enabled.length : 0;
  if (n === 0) return -1;
  const start = Number.isNaN(index) ? 0 : Math.max(-1, Math.min(n - 1, Math.trunc(index)));
  const d = truncDelta(delta);
  if (d === 0) return start;
  const dir: 1 | -1 = d > 0 ? 1 : -1;
  const moves = Math.min(Math.abs(d), n);
  let cur = start;
  for (let k = 0; k < moves; k++) {
    const nxt = nextEnabled(enabled, cur, dir);
    if (nxt === -1) {
      if (wrap && k === 0) {
        const w = nextEnabled(enabled, dir > 0 ? -1 : n, dir);
        if (w !== -1) cur = w;
      }
      break;
    }
    cur = nxt;
  }
  return cur;
}

/** The state of an enumerated stepper, ready to render. */
export interface StepperListModel {
  readonly count: number;
  /** -1 when the list is empty or nothing is selected. */
  readonly index: number;
  readonly label: StepperLabel;
  readonly atStart: boolean;
  readonly atEnd: boolean;
  readonly canPrev: boolean;
  readonly canNext: boolean;
}

/** The model of an enumerated stepper: which item, its label, and which arrows can act. */
export function stepperModel(
  options: readonly StepperOptionInput[] | null | undefined,
  index: number,
  wrap = false,
): StepperListModel {
  const opts = Array.isArray(options) ? options.map(normalizeOption) : [];
  const n = opts.length;
  if (n === 0) {
    return {
      count: 0,
      index: -1,
      label: { text: STEPPER_EMPTY_TEXT },
      atStart: true,
      atEnd: true,
      canPrev: false,
      canNext: false,
    };
  }
  const enabled = opts.map((o) => !o.disabled);
  const i = Number.isNaN(index) ? 0 : Math.max(-1, Math.min(n - 1, Math.trunc(index)));
  const atStart = nextEnabled(enabled, i, -1) === -1;
  const atEnd = nextEnabled(enabled, i, 1) === -1;
  const other = enabled.some((e, j) => e && j !== i);
  const o = i >= 0 ? opts[i] : null;
  const label = o
    ? toLabel({ text: o.label, sub: o.sub, icon: o.icon })
    : { text: STEPPER_EMPTY_TEXT };
  return {
    count: n,
    index: i,
    label,
    atStart,
    atEnd,
    canPrev: !atStart || (wrap && other),
    canNext: !atEnd || (wrap && other),
  };
}

// --------------------------------------------------------------------- pure: numeric values

/** Decimal places in a number's shortest representation (1e-7 -> 7, 0.25 -> 2). */
export function decimalsOf(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const s = String(Math.abs(x));
  const [mantissa, exp] = s.split("e");
  const frac = mantissa.split(".")[1]?.length ?? 0;
  const e = exp === undefined ? 0 : Number(exp);
  return Math.max(0, Math.min(STEPPER_MAX_DECIMALS, frac - e));
}

function roundTo(x: number, decimals: number): number {
  const r = Number(x.toFixed(decimals));
  return r === 0 ? 0 : r; // no -0
}

/**
 * A numeric range resolved against garbage: the grid starts at `min` (0 when min is open),
 * `max` snaps DOWN onto the grid (like <input type=range>), and `kLo..kHi` are the grid
 * indices of the ends (infinite for an open end).
 */
export interface NumberDomain {
  /** The lowest reachable value (-Infinity when open). */
  readonly min: number;
  /** The highest reachable value (on the grid; +Infinity when open). */
  readonly max: number;
  readonly step: number;
  readonly origin: number;
  readonly kLo: number;
  readonly kHi: number;
  readonly decimals: number;
}

/**
 * Resolve min/max/step. NaN / non-finite min or max -> open end; min > max -> max collapses
 * to min (the HTML rule); step not a finite positive number -> 1 (the HTML default);
 * a positive step below {@link STEPPER_MIN_STEP} -> that minimum.
 */
export function numberDomain(min: number, max: number, step: number): NumberDomain {
  const lo = Number.isFinite(min) ? min : -Infinity;
  let hi = Number.isFinite(max) ? max : Infinity;
  if (lo > hi) hi = lo;
  const s = Number.isFinite(step) && step > 0 ? Math.max(step, STEPPER_MIN_STEP) : 1;
  const origin = Number.isFinite(lo) ? lo : 0;
  const decimals = Math.min(STEPPER_MAX_DECIMALS, Math.max(decimalsOf(s), decimalsOf(origin)));
  const kLo = Number.isFinite(lo) ? 0 : -Infinity;
  let kHi = Number.isFinite(hi) ? Math.floor((hi - origin) / s + 1e-9) : Infinity;
  if (kHi < kLo) kHi = kLo;
  const at = (k: number) => roundTo(origin + k * s, decimals);
  return {
    min: Number.isFinite(kLo) ? at(kLo) : -Infinity,
    max: Number.isFinite(kHi) ? at(kHi) : Infinity,
    step: s,
    origin,
    kLo,
    kHi,
    decimals,
  };
}

function gridValue(D: NumberDomain, k: number): number {
  return roundTo(D.origin + k * D.step, D.decimals);
}

/** Where a garbage (NaN) value starts: min if it is closed, else 0 clamped into the range. */
function startValue(D: NumberDomain): number {
  if (Number.isFinite(D.min)) return D.min;
  return Math.min(D.max, 0);
}

/**
 * Step a number by `delta` steps on the grid `min + k * step`, with no float drift.
 *
 * - The result is always ON the grid and inside [min, max] (max snapped down onto the grid).
 * - `delta` 0 snaps (round to the nearest grid point) and clamps.
 * - An off-grid value steps to the NEXT grid point in the step's direction
 *   (0.5 by +1 on a step-1 grid is 1, by -1 is 0), like HTML `stepUp()`.
 * - A NaN value, or a value outside [min, max], lands on the start / nearest bound
 *   whatever the delta: a step from "no value" or "out of range" is a step INTO the range.
 * - `wrap` (only when both ends are closed) wraps only from the end being left, exactly
 *   like {@link stepIndex}; otherwise the value clamps.
 */
export function stepNumber(
  value: number,
  min: number,
  max: number,
  step: number,
  delta: number,
  wrap = false,
): number {
  const D = numberDomain(min, max, step);
  if (Number.isNaN(value)) return startValue(D);
  if (value < D.min) return D.min;
  if (value > D.max) return D.max;
  const d = truncDelta(delta);
  const t = (value - D.origin) / D.step;
  const kr = Math.round(t);
  const onGrid = Math.abs(t - kr) < GRID_EPS;
  let k = onGrid || d === 0 ? kr : d > 0 ? Math.floor(t) : Math.ceil(t);
  if (k < D.kLo) k = D.kLo;
  if (k > D.kHi) k = D.kHi;
  if (d === 0) return gridValue(D, k);
  const target = k + d;
  if (target >= D.kLo && target <= D.kHi) return gridValue(D, target);
  const bounded = Number.isFinite(D.kLo) && Number.isFinite(D.kHi) && D.kHi > D.kLo;
  if (target > D.kHi) return gridValue(D, wrap && bounded && k === D.kHi ? D.kLo : D.kHi);
  return gridValue(D, wrap && bounded && k === D.kLo ? D.kHi : D.kLo);
}

/** Snap + clamp a value onto the grid (a zero step). */
export function snapNumber(value: number, min: number, max: number, step: number): number {
  return stepNumber(value, min, max, step, 0);
}

/** The state of a numeric stepper, ready to render. */
export interface StepperNumberModel {
  /** The snapped, clamped value; NaN when the source holds no value. */
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly decimals: number;
  readonly atStart: boolean;
  readonly atEnd: boolean;
  readonly canPrev: boolean;
  readonly canNext: boolean;
}

/** The model of a numeric stepper. A NaN value stays NaN (shown as "—"); both arrows act. */
export function numberModel(
  value: number,
  min: number,
  max: number,
  step: number,
  wrap = false,
): StepperNumberModel {
  const D = numberDomain(min, max, step);
  const empty = Number.isNaN(value);
  const v = empty ? NaN : stepNumber(value, min, max, step, 0);
  const single = D.kHi === D.kLo;
  const bounded = Number.isFinite(D.kLo) && Number.isFinite(D.kHi) && !single;
  const atStart = !empty && Number.isFinite(D.min) && v <= D.min;
  const atEnd = !empty && Number.isFinite(D.max) && v >= D.max;
  return {
    value: v,
    min: D.min,
    max: D.max,
    step: D.step,
    decimals: D.decimals,
    atStart,
    atEnd,
    canPrev: empty ? !single : !atStart || (wrap && bounded),
    canNext: empty ? !single : !atEnd || (wrap && bounded),
  };
}

/** The default numeric label: the value with exactly the grid's decimal places. */
export function formatStepNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return STEPPER_EMPTY_TEXT;
  const d = Number.isFinite(decimals)
    ? Math.max(0, Math.min(STEPPER_MAX_DECIMALS, Math.trunc(decimals)))
    : 0;
  return roundTo(value, d).toFixed(d);
}

// ------------------------------------------------------------------- pure: keys and view

/** What a key does to a stepper. */
export type StepperKeyAction =
  | { readonly kind: "step"; readonly delta: number }
  | { readonly kind: "start" }
  | { readonly kind: "end" };

/**
 * The keyboard map. Left/Down = -1, Right/Up = +1, Home/End = first/last, and on a NUMERIC
 * stepper PageDown/PageUp = -/+ `pageSteps` (default 10). Anything else -> null (the key is
 * left alone so menu shortcuts and Tab keep working).
 */
export function keyAction(
  key: string,
  kind: "list" | "number",
  pageSteps: number = STEPPER_PAGE_STEPS,
): StepperKeyAction | null {
  const page = Number.isFinite(pageSteps) && pageSteps >= 1
    ? Math.trunc(pageSteps)
    : STEPPER_PAGE_STEPS;
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return { kind: "step", delta: 1 };
    case "ArrowLeft":
    case "ArrowDown":
      return { kind: "step", delta: -1 };
    case "PageUp":
      return kind === "number" ? { kind: "step", delta: page } : null;
    case "PageDown":
      return kind === "number" ? { kind: "step", delta: -page } : null;
    case "Home":
      return { kind: "start" };
    case "End":
      return { kind: "end" };
    default:
      return null;
  }
}

/** What a stepper shows: an enumerated list or a numeric range (+ disabled). */
export type StepperState =
  | {
    readonly kind: "list";
    readonly options: readonly StepperOptionInput[];
    readonly index: number;
    readonly disabled?: boolean;
  }
  | {
    readonly kind: "number";
    readonly value: number;
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly disabled?: boolean;
    /** Label hook; the default prints the value with the grid's decimals. */
    readonly format?: StepperFormat;
  };

/** Everything the DOM needs, computed purely (aria + data attributes + label). */
export interface StepperView {
  readonly kind: "list" | "number";
  /** aria-valuenow (null -> attribute removed). */
  readonly now: number | null;
  readonly min: number | null;
  readonly max: number | null;
  /** aria-valuetext: the label, plus ", sub" when there is a sub-label. */
  readonly valueText: string;
  readonly label: StepperLabel;
  readonly atStart: boolean;
  readonly atEnd: boolean;
  readonly canPrev: boolean;
  readonly canNext: boolean;
  readonly disabled: boolean;
}

function valueTextOf(label: StepperLabel): string {
  return label.sub ? `${label.text}, ${label.sub}` : label.text;
}

/** The view of a state. A disabled stepper keeps its value but neither arrow can act. */
export function stepperView(state: StepperState, wrap = false): StepperView {
  const disabled = state.disabled === true;
  if (state.kind === "list") {
    const m = stepperModel(state.options, state.index, wrap);
    return {
      kind: "list",
      now: m.index >= 0 ? m.index : null,
      min: m.count > 0 ? 0 : null,
      max: m.count > 0 ? m.count - 1 : null,
      valueText: valueTextOf(m.label),
      label: m.label,
      atStart: m.atStart,
      atEnd: m.atEnd,
      canPrev: m.canPrev && !disabled,
      canNext: m.canNext && !disabled,
      disabled,
    };
  }
  const m = numberModel(state.value, state.min, state.max, state.step, wrap);
  const fallback = formatStepNumber(m.value, m.decimals);
  let label: StepperLabel;
  if (Number.isNaN(m.value)) label = { text: STEPPER_EMPTY_TEXT };
  else {
    let raw: unknown = undefined;
    try {
      raw = state.format ? state.format(m.value) : undefined;
    } catch {
      raw = undefined; // a throwing formatter must not blank the control
    }
    label = raw === undefined ? { text: fallback } : toLabel(raw, fallback);
  }
  return {
    kind: "number",
    now: Number.isNaN(m.value) ? null : m.value,
    min: Number.isFinite(m.min) ? m.min : null,
    max: Number.isFinite(m.max) ? m.max : null,
    valueText: valueTextOf(label),
    label,
    atStart: m.atStart,
    atEnd: m.atEnd,
    canPrev: m.canPrev && !disabled,
    canNext: m.canNext && !disabled,
    disabled,
  };
}

/** The raw value of a state: the list index or the number (NaN when empty). */
export function stateValue(state: StepperState): number {
  return state.kind === "list" ? state.index : state.value;
}

/** A state stepped by `delta` (pure; a disabled state does not move). */
export function stepState(state: StepperState, delta: number, wrap = false): StepperState {
  if (state.disabled) return state;
  if (state.kind === "list") {
    const enabled = (Array.isArray(state.options) ? state.options : []).map((o) =>
      !normalizeOption(o).disabled
    );
    return { ...state, index: stepEnabled(enabled, state.index, delta, wrap) };
  }
  return {
    ...state,
    value: stepNumber(state.value, state.min, state.max, state.step, delta, wrap),
  };
}

/** A state moved to its first / last reachable value (unchanged when that end is open). */
export function stepStateTo(state: StepperState, edge: "start" | "end"): StepperState {
  if (state.disabled) return state;
  if (state.kind === "list") {
    const enabled = (Array.isArray(state.options) ? state.options : []).map((o) =>
      !normalizeOption(o).disabled
    );
    const i = edge === "start"
      ? nextEnabled(enabled, -1, 1)
      : nextEnabled(enabled, enabled.length, -1);
    return i === -1 ? state : { ...state, index: i };
  }
  const D = numberDomain(state.min, state.max, state.step);
  const v = edge === "start" ? D.min : D.max;
  return Number.isFinite(v) ? { ...state, value: v } : state;
}

// --------------------------------------------------------------------------- DOM component

/** How a step was made (passed to `onStep`). */
export type StepVia = "pointer" | "repeat" | "click" | "key" | "wheel" | "api";

/** Injectable timers (tests drive press-and-hold with a fake clock). */
export interface StepperTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const DEFAULT_TIMERS: StepperTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as number),
};

/** Options shared by the component and every upgrader. */
export interface StepperCommonOptions {
  /** Wrap from the last value to the first (and back). Default false: the end arrow disables. */
  wrap?: boolean;
  /** Mouse wheel steps the value while the stepper has focus. Default false (menus scroll). */
  wheel?: boolean;
  /** "compact" = 34 px tall (hit areas still 44 px); default "normal" = 44 px. */
  size?: "normal" | "compact";
  /** PageUp/PageDown steps on numeric steppers. Default 10. */
  pageSteps?: number;
  repeatDelayMs?: number;
  repeatIntervalMs?: number;
  timers?: StepperTimers;
}

/** Options of the component itself. */
export interface StepperOptions extends StepperCommonOptions {
  /** The document to build in (default: the global one). */
  document?: Document;
  /** Accessible name (aria-label) of the spinbutton. */
  label?: string;
  /** Space-separated ids for aria-labelledby (wins over `label` for screen readers). */
  labelledBy?: string;
  /** Space-separated ids for aria-describedby. */
  describedBy?: string;
  /** aria-labels of the arrows; defaults "Previous"/"Next" (list) or "Decrease"/"Increase". */
  prevLabel?: string;
  nextLabel?: string;
  /** Called after every user step that CHANGED the value. */
  onStep?: (value: number, previous: number, via: StepVia) => void;
  /** The source of truth `sync()` re-reads (upgraders pass the native element's state). */
  read?: () => StepperState;
}

function arrowSvg(dir: "prev" | "next"): string {
  if (dir === "prev") return icon("chevron-left", "stepper-chevron");
  // The right chevron is the left one mirrored about x = 12 (Icons.ts has no right twin);
  // same attributes as icon(), so `.icon` styling applies to both.
  return `<svg class="icon icon-chevron-right stepper-chevron" xmlns="http://www.w3.org/2000/svg"` +
    ` viewBox="0 0 ${ICON_GRID} ${ICON_GRID}" width="20" height="20" fill="none" stroke="currentColor"` +
    ` stroke-width="${ICON_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"` +
    ` aria-hidden="true" focusable="false"><path d="M9 5.5 15.5 12 9 18.5"/></svg>`;
}

function setOrRemove(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function flag(el: Element, name: string, on: boolean): void {
  setOrRemove(el, name, on ? "" : null);
}

/**
 * The ‹ value › control.
 *
 * DOM: `<div class="stepper" role="spinbutton" tabindex="0">` holding
 * `button.stepper-arrow.stepper-prev`, `span.stepper-value` (`.stepper-icon`,
 * `.stepper-text`, `.stepper-sub`) and `button.stepper-arrow.stepper-next`. The group is the
 * single tab stop; the arrows are `tabindex="-1"` (pointer and screen-reader activation).
 * `data-at-start` / `data-at-end` / `data-disabled` / `data-kind` are set for styling.
 */
export class Stepper {
  /** The root `.stepper` element; insert it wherever you like. */
  readonly element: HTMLElement;
  readonly #doc: Document;
  readonly #prev: HTMLButtonElement;
  readonly #next: HTMLButtonElement;
  readonly #icon: HTMLElement;
  readonly #text: HTMLElement;
  readonly #sub: HTMLElement;
  readonly #opts: StepperOptions;
  readonly #timers: StepperTimers;
  #state: StepperState;
  #iconHtml = "";
  #holdTimer: unknown = null;
  #holdDir: 0 | 1 | -1 = 0;
  #pointerStepped = false;
  #releaseTimer: unknown = null;
  #docListening = false;
  #destroyed = false;
  readonly #cleanups: Array<() => void> = [];

  constructor(state: StepperState, options: StepperOptions = {}) {
    this.#opts = options;
    this.#state = state;
    this.#timers = options.timers ?? DEFAULT_TIMERS;
    const doc = options.document ?? globalThis.document;
    this.#doc = doc;

    const root = doc.createElement("div");
    root.setAttribute("class", options.size === "compact" ? "stepper stepper-compact" : "stepper");
    root.setAttribute("role", "spinbutton");
    root.setAttribute("tabindex", "0");
    root.setAttribute("data-kind", state.kind);
    if (options.label) root.setAttribute("aria-label", options.label);
    if (options.labelledBy) root.setAttribute("aria-labelledby", options.labelledBy);
    if (options.describedBy) root.setAttribute("aria-describedby", options.describedBy);

    const named = (base: string) => (options.label ? `${base}: ${options.label}` : base);
    const prev = doc.createElement("button");
    prev.setAttribute("type", "button");
    prev.setAttribute("class", "stepper-arrow stepper-prev");
    prev.setAttribute("tabindex", "-1");
    prev.setAttribute(
      "aria-label",
      options.prevLabel ?? named(state.kind === "number" ? "Decrease" : "Previous"),
    );
    prev.innerHTML = arrowSvg("prev");

    const value = doc.createElement("span");
    value.setAttribute("class", "stepper-value");
    value.setAttribute("aria-hidden", "true"); // the spinbutton's aria-valuetext says it once
    const iconEl = doc.createElement("span");
    iconEl.setAttribute("class", "stepper-icon");
    iconEl.setAttribute("hidden", "");
    const text = doc.createElement("span");
    text.setAttribute("class", "stepper-text");
    const sub = doc.createElement("span");
    sub.setAttribute("class", "stepper-sub");
    sub.setAttribute("hidden", "");
    value.appendChild(iconEl);
    value.appendChild(text);
    value.appendChild(sub);

    const next = doc.createElement("button");
    next.setAttribute("type", "button");
    next.setAttribute("class", "stepper-arrow stepper-next");
    next.setAttribute("tabindex", "-1");
    next.setAttribute(
      "aria-label",
      options.nextLabel ?? named(state.kind === "number" ? "Increase" : "Next"),
    );
    next.innerHTML = arrowSvg("next");

    root.appendChild(prev);
    root.appendChild(value);
    root.appendChild(next);

    this.element = root;
    this.#prev = prev;
    this.#next = next;
    this.#icon = iconEl;
    this.#text = text;
    this.#sub = sub;

    root.addEventListener("keydown", this.#onKey);
    for (const [btn, dir] of [[prev, -1], [next, 1]] as const) {
      btn.addEventListener("pointerdown", (ev: PointerEvent) => this.#press(dir, ev));
      btn.addEventListener("pointerleave", this.#release);
      btn.addEventListener("pointercancel", this.#cancel);
      btn.addEventListener("click", () => this.#click(dir));
    }
    if (options.wheel) root.addEventListener("wheel", this.#onWheel, { passive: false });
    this.#render();
  }

  /** The current raw value: the list index, or the number (NaN when empty). */
  get value(): number {
    return stateValue(this.#state);
  }

  /** The current state (read-only snapshot). */
  get state(): StepperState {
    return this.#state;
  }

  /** The pure view the DOM currently shows. */
  get view(): StepperView {
    return stepperView(this.#state, this.#opts.wrap === true);
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  /** Replace the state (no `onStep`: this is the program talking, not the player). */
  set(state: StepperState): void {
    if (this.#destroyed) return;
    this.#state = state;
    this.#render();
  }

  /** Re-read the source of truth (`options.read`) and re-render. A no-op without one. */
  sync(): void {
    if (this.#destroyed || !this.#opts.read) return;
    this.#state = this.#opts.read();
    this.#render();
  }

  /** Step by `delta` as the player would. Returns whether the value changed. */
  step(delta: number, via: StepVia = "api"): boolean {
    if (this.#destroyed) return false;
    return this.#commit(stepState(this.#state, delta, this.#opts.wrap === true), via);
  }

  /** Jump to the first / last value as the player would (Home / End). */
  stepTo(edge: "start" | "end", via: StepVia = "api"): boolean {
    if (this.#destroyed) return false;
    return this.#commit(stepStateTo(this.#state, edge), via);
  }

  /** Register a teardown run by `destroy()` (the upgraders restore the native element). */
  onDestroy(fn: () => void): void {
    this.#cleanups.push(fn);
  }

  /** Stop timers, run teardowns and remove the element. Idempotent. */
  destroy(): void {
    if (this.#destroyed) return;
    this.#stopHold();
    if (this.#releaseTimer !== null) this.#timers.clearTimeout(this.#releaseTimer);
    this.#releaseTimer = null;
    this.#destroyed = true;
    for (const fn of this.#cleanups.splice(0)) {
      try {
        fn();
      } catch { /* a teardown must not block the others */ }
    }
    this.element.parentNode?.removeChild(this.element);
  }

  #commit(next: StepperState, via: StepVia): boolean {
    const prev = stateValue(this.#state);
    const value = stateValue(next);
    if (Object.is(prev, value) || (Number.isNaN(prev) && Number.isNaN(value))) return false;
    this.#state = next;
    this.#render();
    this.#opts.onStep?.(value, prev, via);
    return true;
  }

  #render(): void {
    const v = stepperView(this.#state, this.#opts.wrap === true);
    const r = this.element;
    setOrRemove(r, "data-kind", v.kind);
    setOrRemove(r, "aria-valuenow", v.now === null ? null : String(v.now));
    setOrRemove(r, "aria-valuemin", v.min === null ? null : String(v.min));
    setOrRemove(r, "aria-valuemax", v.max === null ? null : String(v.max));
    setOrRemove(r, "aria-valuetext", v.valueText);
    setOrRemove(r, "aria-disabled", v.disabled ? "true" : null);
    setOrRemove(r, "tabindex", v.disabled ? "-1" : "0");
    flag(r, "data-disabled", v.disabled);
    flag(r, "data-at-start", v.atStart);
    flag(r, "data-at-end", v.atEnd);
    flag(this.#prev, "disabled", !v.canPrev);
    flag(this.#next, "disabled", !v.canNext);
    if (this.#text.textContent !== v.label.text) this.#text.textContent = v.label.text;
    const sub = v.label.sub ?? "";
    if (this.#sub.textContent !== sub) this.#sub.textContent = sub;
    flag(this.#sub, "hidden", sub === "");
    const iconHtml = v.label.icon ?? "";
    if (iconHtml !== this.#iconHtml) {
      this.#iconHtml = iconHtml;
      this.#icon.innerHTML = iconHtml;
    }
    flag(this.#icon, "hidden", iconHtml === "");
  }

  #focus(): void {
    try {
      this.element.focus({ preventScroll: true });
    } catch { /* focus is a nicety */ }
  }

  readonly #onKey = (ev: KeyboardEvent): void => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const action = keyAction(ev.key, this.#state.kind, this.#opts.pageSteps);
    if (!action || this.#state.disabled) return;
    if (action.kind !== "step") {
      // Home/End on an open numeric end is not ours: leave the key alone.
      const moved = stepStateTo(this.#state, action.kind);
      if (moved === this.#state) return;
    }
    ev.preventDefault();
    ev.stopPropagation(); // a handled arrow must not also drive a menu/game key handler
    if (action.kind === "step") this.step(action.delta, "key");
    else this.stepTo(action.kind, "key");
  };

  readonly #onWheel = (ev: WheelEvent): void => {
    if (this.#state.disabled || this.#doc.activeElement !== this.element) return;
    const d = ev.deltaY !== 0 ? -ev.deltaY : ev.deltaX;
    if (!d) return;
    ev.preventDefault();
    this.step(d > 0 ? 1 : -1, "wheel");
  };

  #press(dir: 1 | -1, ev: PointerEvent): void {
    if (typeof ev.button === "number" && ev.button !== 0) return;
    if (this.#state.disabled) return;
    ev.preventDefault?.(); // keep focus off the tabindex=-1 arrow ...
    this.#focus(); // ... and on the spinbutton, so the keyboard keeps working
    this.#stopHold();
    if (this.#releaseTimer !== null) this.#timers.clearTimeout(this.#releaseTimer);
    this.#releaseTimer = null;
    this.#pointerStepped = false;
    this.#holdDir = dir;
    this.#listenDoc(true);
    const touchLike = ev.pointerType === "touch" || ev.pointerType === "pen";
    if (touchLike) {
      // A finger that lands on an arrow may be starting a scroll: the tap's own click
      // steps once; only a press still held after the delay starts repeating.
      this.#holdTimer = this.#timers.setTimeout(this.#tick, this.#delay());
      return;
    }
    this.#pointerStepped = true; // the click that follows this press must not step again
    if (!this.step(dir, "pointer")) {
      this.#stopHold();
      return;
    }
    this.#holdTimer = this.#timers.setTimeout(this.#tick, this.#delay());
  }

  #delay(): number {
    const d = this.#opts.repeatDelayMs;
    return typeof d === "number" && d >= 0 ? d : STEPPER_REPEAT_DELAY_MS;
  }

  #interval(): number {
    const d = this.#opts.repeatIntervalMs;
    return typeof d === "number" && d > 0 ? d : STEPPER_REPEAT_INTERVAL_MS;
  }

  readonly #tick = (): void => {
    this.#holdTimer = null;
    const dir = this.#holdDir;
    // A step can re-render the whole menu (a change listener): a detached stepper stops.
    if (dir === 0 || this.#destroyed || this.element.isConnected === false) {
      this.#stopHold();
      return;
    }
    this.#pointerStepped = true;
    if (!this.step(dir, "repeat")) {
      this.#stopHold();
      return;
    }
    this.#holdTimer = this.#timers.setTimeout(this.#tick, this.#interval());
  };

  readonly #release = (): void => {
    if (this.#holdDir === 0 && this.#holdTimer === null) return;
    this.#stopHold();
    if (this.#pointerStepped) {
      // The click of this press arrives right after pointerup (later on touch); it was
      // already counted. Forget the press if no click ever comes.
      if (this.#releaseTimer !== null) this.#timers.clearTimeout(this.#releaseTimer);
      this.#releaseTimer = this.#timers.setTimeout(() => {
        this.#releaseTimer = null;
        this.#pointerStepped = false;
      }, 500);
    }
  };

  readonly #cancel = (): void => {
    this.#release();
  };

  #click(dir: 1 | -1): void {
    if (this.#pointerStepped) {
      this.#pointerStepped = false;
      if (this.#releaseTimer !== null) this.#timers.clearTimeout(this.#releaseTimer);
      this.#releaseTimer = null;
      return;
    }
    this.step(dir, "click"); // a tap, or a screen reader / keyboard activation
  }

  #listenDoc(on: boolean): void {
    if (on === this.#docListening) return;
    this.#docListening = on;
    if (on) {
      this.#doc.addEventListener("pointerup", this.#release);
      this.#doc.addEventListener("pointercancel", this.#cancel);
    } else {
      this.#doc.removeEventListener("pointerup", this.#release);
      this.#doc.removeEventListener("pointercancel", this.#cancel);
    }
  }

  #stopHold(): void {
    if (this.#holdTimer !== null) this.#timers.clearTimeout(this.#holdTimer);
    this.#holdTimer = null;
    this.#holdDir = 0;
    this.#listenDoc(false);
  }
}

// ------------------------------------------------------------------ progressive enhancement

const UPGRADED = new WeakMap<Element, Stepper>();

/** The last upgraded stepper that had focus, by its native element's id (focus hand-back). */
let lastFocus: { id: string; element: HTMLElement } | null = null;

/** The stepper an upgraded native element is shown through, if any. */
export function stepperFor(el: Element): Stepper | undefined {
  return UPGRADED.get(el);
}

/** Options for `upgradeSelect`. */
export interface SelectUpgradeOptions extends StepperCommonOptions {
  /** Override the accessible name (default: the element's <label> text). */
  label?: string;
  /**
   * Label of each option (default: its text, `data-sub` as the sub-label and `data-icon`
   * naming an Icons.ts icon).
   */
  format?: (option: HTMLOptionElement, index: number) => string | StepperLabel;
  /** Make `select.value = x` / `select.selectedIndex = i` re-render the stepper. Default true. */
  intercept?: boolean;
}

/** Options for `upgradeRange` / `upgradeNumber`. */
export interface InputUpgradeOptions extends StepperCommonOptions {
  label?: string;
  /** Label of a value (default: the linked <output>'s text, else the value with grid decimals). */
  format?: (value: number, input: HTMLInputElement) => string | StepperLabel;
  /** The <output> mirrored as the label (default: auto — `<output for=id>` or one in the same <label>). */
  output?: HTMLOutputElement | null;
  /** Hide the mirrored <output> (default true: the stepper shows its text). */
  hideOutput?: boolean;
  intercept?: boolean;
}

/** Options for `upgradeAll`. */
export interface UpgradeAllOptions extends StepperCommonOptions {
  selects?: boolean;
  ranges?: boolean;
  numbers?: boolean;
  /** Return true to leave an element native. `data-stepper="off"` is always skipped. */
  skip?: (el: Element) => boolean;
  /** Per-element option overrides (e.g. a formatter for one id). */
  optionsFor?: (el: Element) => SelectUpgradeOptions | InputUpgradeOptions | undefined;
}

const LABEL_SKIP_TAGS = new Set([
  "SELECT",
  "INPUT",
  "OUTPUT",
  "TEXTAREA",
  "BUTTON",
  "OPTION",
  "SVG",
]);

function enclosingLabel(el: Element): Element | null {
  const labels = (el as unknown as { labels?: ArrayLike<Element> | null }).labels;
  if (labels && labels.length > 0) return labels[0];
  for (let p = el.parentNode; p; p = p.parentNode) {
    if ((p as Element).tagName === "LABEL") return p as Element;
  }
  if (el.id) {
    for (const l of Array.from(el.ownerDocument.querySelectorAll("label"))) {
      if (l.getAttribute("for") === el.id) return l;
    }
  }
  return null;
}

/** Text of a label, skipping controls; `stopAt` collects only the text BEFORE that control. */
function labelText(
  node: Node,
  stopAt: Element | null,
  out: { text: string; stopped: boolean },
): void {
  for (const c of Array.from(node.childNodes)) {
    if (out.stopped) return;
    if (c === stopAt) {
      out.stopped = true;
      return;
    }
    if (c.nodeType === 3) out.text += c.textContent ?? "";
    else if (c.nodeType === 1) {
      const e = c as Element;
      if (LABEL_SKIP_TAGS.has(e.tagName.toUpperCase())) continue;
      if ((e.getAttribute("class") ?? "").split(/\s+/).includes("stepper")) continue;
      labelText(e, stopAt, out);
    }
  }
}

/** The accessible name a native control would have: aria-label, else its <label> text. */
export function controlLabel(el: Element): string {
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return aria;
  const lab = enclosingLabel(el);
  if (lab) {
    const before = { text: "", stopped: false };
    labelText(lab, el, before);
    const t = before.text.replace(/\s+/g, " ").trim();
    if (t) return t;
    const all = { text: "", stopped: false };
    labelText(lab, null, all);
    const a = all.text.replace(/\s+/g, " ").trim();
    if (a) return a;
  }
  return el.getAttribute("title")?.trim() ?? "";
}

function eventCtor(doc: Document): typeof Event {
  const view = doc.defaultView as unknown as { Event?: typeof Event } | null;
  return view?.Event ?? globalThis.Event;
}

function observerCtor(doc: Document): typeof MutationObserver | undefined {
  const view = doc.defaultView as unknown as { MutationObserver?: typeof MutationObserver } | null;
  return view?.MutationObserver ??
    (globalThis as unknown as { MutationObserver?: typeof MutationObserver }).MutationObserver;
}

/** Dispatch `input` then `change`, bubbling — what a native control fires on a user choice. */
function fireUserChange(el: Element): void {
  const E = eventCtor(el.ownerDocument);
  el.dispatchEvent(new E("input", { bubbles: true }));
  el.dispatchEvent(new E("change", { bubbles: true }));
}

/** Hide an element while keeping it in the DOM; returns the restore. */
function hideNative(el: Element): () => void {
  const hadHidden = el.hasAttribute("hidden");
  const cls = el.getAttribute("class");
  el.setAttribute("hidden", "");
  const classes = (cls ?? "").split(/\s+/).filter(Boolean);
  if (!classes.includes(STEPPER_NATIVE_CLASS)) {
    el.setAttribute("class", [...classes, STEPPER_NATIVE_CLASS].join(" "));
  }
  return () => {
    if (!hadHidden) el.removeAttribute("hidden");
    if (cls === null) el.removeAttribute("class");
    else el.setAttribute("class", cls);
  };
}

/**
 * Wrap the prototype's `value`-like accessors on ONE element so a programmatic write also
 * re-renders the stepper (`select.value = "x"` fires no event). Reads and writes still go to
 * the native accessor. Returns the undo (deletes the own properties).
 */
function interceptProps(el: Element, names: readonly string[], after: () => void): () => void {
  const done: string[] = [];
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(el, name)) continue;
    let proto: object | null = Object.getPrototypeOf(el);
    let desc: PropertyDescriptor | undefined;
    while (proto && !(desc = Object.getOwnPropertyDescriptor(proto, name))) {
      proto = Object.getPrototypeOf(proto);
    }
    if (!desc || !desc.get || !desc.set) continue;
    const { get, set } = desc;
    try {
      Object.defineProperty(el, name, {
        configurable: true,
        enumerable: desc.enumerable ?? false,
        get: () => get.call(el),
        set: (v: unknown) => {
          set.call(el, v);
          after();
        },
      });
      done.push(name);
    } catch { /* a non-extensible element simply keeps change-event syncing */ }
  }
  return () => {
    for (const n of done) delete (el as unknown as Record<string, unknown>)[n];
  };
}

function wantsWrap(el: Element, opts: StepperCommonOptions): boolean {
  return el.hasAttribute("data-stepper-wrap") || opts.wrap === true;
}

function mountBeside(
  source: Element,
  stepper: Stepper,
  intercept: boolean,
  props: readonly string[],
): void {
  const sync = () => stepper.sync();
  source.parentNode?.insertBefore(stepper.element, source.nextSibling);
  const restore = hideNative(source);
  source.setAttribute(STEPPER_MARK, "1");
  if (source.id) stepper.element.setAttribute("data-stepper-for", source.id);
  UPGRADED.set(source, stepper);

  source.addEventListener("change", sync);
  source.addEventListener("input", sync);
  const undoIntercept = intercept ? interceptProps(source, props, sync) : () => {};

  // Code that focuses the (hidden) native control — a focus trap, a "jump to field" — lands on
  // the stepper instead. Remember the last focused stepper by its source id, so a re-render
  // that rebuilds the control can hand focus back (see upgradeAll).
  const forwardFocus = (o?: FocusOptions) => stepper.element.focus(o);
  let undoFocus = () => {};
  try {
    Object.defineProperty(source, "focus", {
      configurable: true,
      writable: true,
      value: forwardFocus,
    });
    undoFocus = () => {
      delete (source as unknown as Record<string, unknown>).focus;
    };
  } catch { /* keep the native focus */ }
  const id = source.id;
  const onFocus = () => {
    if (id) lastFocus = { id, element: stepper.element };
  };
  stepper.element.addEventListener("focus", onFocus);

  // form.reset() changes the value without an event: re-read after it settles.
  const form = (source as unknown as { form?: HTMLFormElement | null }).form ?? null;
  const onReset = () => {
    globalThis.setTimeout(sync, 0);
  };
  form?.addEventListener("reset", onReset);

  stepper.onDestroy(() => {
    source.removeEventListener("change", sync);
    source.removeEventListener("input", sync);
    form?.removeEventListener("reset", onReset);
    undoIntercept();
    undoFocus();
    stepper.element.removeEventListener("focus", onFocus);
    restore();
    source.removeAttribute(STEPPER_MARK);
    UPGRADED.delete(source);
  });
}

function observe(target: Node, init: MutationObserverInit, stepper: Stepper): void {
  const MO = observerCtor(target.ownerDocument ?? (target as Document));
  if (!MO) return;
  const mo = new MO(() => stepper.sync());
  mo.observe(target, init);
  stepper.onDestroy(() => mo.disconnect());
}

/** Label of one <option>: its text, `data-sub` and `data-icon` (an Icons.ts name). */
function optionLabel(o: HTMLOptionElement): StepperOption {
  const iconName = o.getAttribute("data-icon");
  const out: { label: string; sub?: string; icon?: string; disabled?: boolean } = {
    label: (o.text ?? o.textContent ?? "").replace(/\s+/g, " ").trim(),
  };
  const sub = o.getAttribute("data-sub");
  if (sub) out.sub = sub;
  if (iconName && (ICON_NAMES as readonly string[]).includes(iconName)) {
    out.icon = icon(iconName as IconName, "stepper-option-icon");
  }
  if (o.disabled || o.hasAttribute("hidden")) out.disabled = true;
  return out;
}

/**
 * Show a <select> as a stepper. The select stays in the DOM, hidden, and remains the source
 * of truth: a step sets `select.selectedIndex` and dispatches `input` + `change` (bubbling);
 * the stepper follows the select's own `change`/`input`, programmatic `value` /
 * `selectedIndex` writes, and option-list / `disabled` mutations. A `multiple` or `size > 1`
 * select is left alone (returns null). Calling it twice returns the same stepper.
 */
export function upgradeSelect(
  select: HTMLSelectElement,
  opts: SelectUpgradeOptions = {},
): Stepper | null {
  const existing = UPGRADED.get(select);
  if (existing && !existing.destroyed) return existing;
  if (select.multiple || (select.size ?? 0) > 1) return null;
  const read = (): StepperState => {
    const options: StepperOption[] = [];
    const list = Array.from(select.options ?? []);
    list.forEach((o, i) => {
      const base = optionLabel(o);
      if (!opts.format) {
        options.push(base);
        return;
      }
      let custom: unknown;
      try {
        custom = opts.format(o, i);
      } catch {
        custom = undefined;
      }
      const l = toLabel(custom, base.label || STEPPER_EMPTY_TEXT);
      options.push({ label: l.text, sub: l.sub, icon: l.icon, disabled: base.disabled });
    });
    return { kind: "list", options, index: select.selectedIndex, disabled: select.disabled };
  };
  const stepper: Stepper = new Stepper(read(), {
    ...opts,
    wrap: wantsWrap(select, opts),
    document: select.ownerDocument,
    label: opts.label ?? controlLabel(select),
    describedBy: select.getAttribute("aria-describedby") ?? undefined,
    read,
    onStep: (value) => {
      select.selectedIndex = value;
      fireUserChange(select);
      stepper.sync();
    },
  });
  mountBeside(select, stepper, opts.intercept !== false, ["value", "selectedIndex"]);
  observe(select, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["disabled", "selected", "hidden", "label", "data-sub", "data-icon"],
  }, stepper);
  return stepper;
}

/** The <output> that displays an input's value: `<output for="id">`, else one in its <label>. */
export function linkedOutput(input: Element): HTMLOutputElement | null {
  const doc = input.ownerDocument;
  if (input.id) {
    for (const o of Array.from(doc.querySelectorAll("output"))) {
      const f = o.getAttribute("for");
      if (f && f.split(/\s+/).includes(input.id)) return o as HTMLOutputElement;
    }
  }
  const lab = enclosingLabel(input);
  const inLabel = lab ? lab.querySelectorAll("output")[0] : undefined;
  return (inLabel as HTMLOutputElement | undefined) ?? null;
}

function upgradeInput(
  input: HTMLInputElement,
  kind: "range" | "number",
  opts: InputUpgradeOptions,
): Stepper | null {
  const existing = UPGRADED.get(input);
  if (existing && !existing.destroyed) return existing;
  if ((input.type ?? "").toLowerCase() !== kind) return null;
  const output = opts.output === undefined ? linkedOutput(input) : opts.output;
  const num = (
    s: string | null | undefined,
  ) => (s === null || s === undefined || s.trim() === "" ? NaN : Number(s));
  const read = (): StepperState => {
    let min = num(input.getAttribute("min"));
    let max = num(input.getAttribute("max"));
    if (kind === "range") {
      // <input type=range> defaults to 0..100
      if (!Number.isFinite(min)) min = 0;
      if (!Number.isFinite(max)) max = 100;
    }
    const stepAttr = (input.getAttribute("step") ?? "").trim().toLowerCase();
    let step = num(stepAttr);
    if (stepAttr === "any") {
      step = Number.isFinite(min) && Number.isFinite(max) && max > min ? (max - min) / 100 : 1;
    }
    const value = num(input.value);
    const format: StepperFormat = (v) => {
      if (opts.format) return opts.format(v, input);
      const shown = output?.textContent?.replace(/\s+/g, " ").trim();
      return shown ? shown : undefined;
    };
    return { kind: "number", value, min, max, step, disabled: input.disabled, format };
  };
  const stepper: Stepper = new Stepper(read(), {
    ...opts,
    wrap: wantsWrap(input, opts),
    document: input.ownerDocument,
    label: opts.label ?? controlLabel(input),
    describedBy: input.getAttribute("aria-describedby") ?? undefined,
    read,
    onStep: (value) => {
      input.value = String(value);
      fireUserChange(input);
      stepper.sync(); // the page's own input listener has just rewritten the <output>
    },
  });
  mountBeside(input, stepper, opts.intercept !== false, ["value", "valueAsNumber"]);
  observe(
    input,
    { attributes: true, attributeFilter: ["min", "max", "step", "disabled", "value"] },
    stepper,
  );
  if (output) {
    if (opts.hideOutput !== false) stepper.onDestroy(hideNative(output));
    observe(output, { childList: true, characterData: true, subtree: true }, stepper);
  }
  return stepper;
}

/** Show an `<input type="range">` as a stepper (min/max/step from its attributes; `step="any"` = 1/100 of the span). */
export function upgradeRange(
  input: HTMLInputElement,
  opts: InputUpgradeOptions = {},
): Stepper | null {
  return upgradeInput(input, "range", opts);
}

/** Show an `<input type="number">` as a stepper (absent min/max = open ends; Home/End then do nothing). */
export function upgradeNumber(
  input: HTMLInputElement,
  opts: InputUpgradeOptions = {},
): Stepper | null {
  return upgradeInput(input, "number", opts);
}

/**
 * Upgrade every <select> / range / number input under `root` that is not upgraded yet.
 * Idempotent: an element already carrying `data-stepper="1"` (or `="off"`) is skipped, so
 * call it after EVERY render and only the new elements are upgraded. Returns the steppers
 * created by THIS call.
 */
export function upgradeAll(root: ParentNode, opts: UpgradeAllOptions = {}): Stepper[] {
  const created: Stepper[] = [];
  // A root without querySelectorAll (a unit test's minimal fake DOM) has nothing to upgrade.
  if (typeof (root as Partial<ParentNode>)?.querySelectorAll !== "function") return created;
  const { selects = true, ranges = true, numbers = true, skip, optionsFor, ...common } = opts;
  for (const el of Array.from(root.querySelectorAll("select, input"))) {
    const mark = el.getAttribute(STEPPER_MARK);
    if (mark === "1" || mark === "off") continue;
    const live = UPGRADED.get(el);
    if (live && !live.destroyed) continue;
    if (skip?.(el)) continue;
    const own = { ...common, ...(optionsFor?.(el) ?? {}) };
    let s: Stepper | null = null;
    const tag = el.tagName.toUpperCase();
    if (tag === "SELECT") {
      if (selects) s = upgradeSelect(el as HTMLSelectElement, own as SelectUpgradeOptions);
    } else if (tag === "INPUT") {
      const type = ((el as HTMLInputElement).type ?? "").toLowerCase();
      if (type === "range" && ranges) {
        s = upgradeRange(el as HTMLInputElement, own as InputUpgradeOptions);
      } else if (type === "number" && numbers) {
        s = upgradeNumber(el as HTMLInputElement, own as InputUpgradeOptions);
      }
    }
    if (s) {
      created.push(s);
      restoreFocus(el, s);
    }
  }
  return created;
}

/**
 * A re-render replaced the focused stepper (its change listener rebuilt the screen): focus the
 * new stepper for the same id, but only if focus really was lost (it sits on <body> or nowhere).
 */
function restoreFocus(source: Element, stepper: Stepper): void {
  const last = lastFocus;
  if (!last || !source.id || last.id !== source.id || last.element === stepper.element) return;
  if (last.element.isConnected !== false) return;
  const doc = source.ownerDocument;
  const active = doc.activeElement;
  if (active && active !== doc.body) return;
  try {
    stepper.element.focus({ preventScroll: true });
  } catch { /* focus is a nicety */ }
}

function insideStepper(node: Node | null, root: Node): boolean {
  for (let n: Node | null = node; n && n !== root; n = n.parentNode) {
    if (
      n.nodeType === 1 &&
      ((n as Element).getAttribute("class") ?? "").split(/\s+/).includes("stepper")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * `upgradeAll(root)` now AND after every DOM change under `root` (a MutationObserver on the
 * subtree's child lists; changes inside a stepper are ignored). Observer callbacks run before
 * the next paint, so a re-rendered screen never shows its native dropdowns. Returns the stop.
 * Without a MutationObserver (old engines, tests) it upgrades once.
 */
export function autoUpgrade(root: Element | Document, opts: UpgradeAllOptions = {}): () => void {
  upgradeAll(root, opts);
  const doc = (root as Element).ownerDocument ?? (root as Document);
  const MO = observerCtor(doc);
  if (!MO) return () => {};
  const mo = new MO((records) => {
    if (records.some((r) => r.type === "childList" && !insideStepper(r.target, root))) {
      upgradeAll(root, opts);
    }
  });
  mo.observe(root, { childList: true, subtree: true });
  return () => mo.disconnect();
}
