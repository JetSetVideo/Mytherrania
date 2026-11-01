// Stepper: the ‹ value › control (src/ui/Stepper.ts).
//
// Two halves:
//   * the PURE model, exhaustively — index stepping with and without wrap, disabled options,
//     the numeric grid (no float drift, max snapped onto the grid, off-grid values), and
//     garbage everywhere (NaN, empty lists, step 0, min > max);
//   * the DOM behaviour, through a small hand-rolled document shim (the repo has no deno-dom
//     and must not gain one): the component's aria/disabled ends/keys/press-and-hold, and the
//     progressive enhancement — the native <select>/<input> stays the source of truth, a step
//     fires `input` + `change` exactly once, programmatic writes and rebuilt option lists flow
//     back into the stepper, and `upgradeAll` is idempotent.
// What the shim cannot prove (real layout, CSS, real pointer/touch timing, a real
// MutationObserver) is the browser check in docs/ui/stepper.md.
//
// The repo's tests carry a local assert rather than importing jsr:@std/assert.
import {
  autoUpgrade,
  controlLabel,
  decimalsOf,
  formatStepNumber,
  keyAction,
  linkedOutput,
  numberDomain,
  numberModel,
  snapNumber,
  stepEnabled,
  stepIndex,
  stepNumber,
  Stepper,
  STEPPER_EMPTY_TEXT,
  STEPPER_REPEAT_DELAY_MS,
  STEPPER_REPEAT_INTERVAL_MS,
  stepperFor,
  stepperModel,
  type StepperState,
  type StepperTimers,
  stepperView,
  stepState,
  stepStateTo,
  toLabel,
  upgradeAll,
  upgradeNumber,
  upgradeRange,
  upgradeSelect,
} from "../src/ui/Stepper.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

function assertEquals<T>(actual: T, expected: T, message = "not equal"): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: got ${a}, want ${e}`);
}

// ================================================================== pure: enumerated values

Deno.test("stepIndex: no wrap clamps at both ends", () => {
  assertEquals(stepIndex(5, 0, -1), 0);
  assertEquals(stepIndex(5, 4, 1), 4);
  assertEquals(stepIndex(5, 2, 1), 3);
  assertEquals(stepIndex(5, 2, -1), 1);
  assertEquals(stepIndex(5, 2, 99), 4);
  assertEquals(stepIndex(5, 2, -99), 0);
  assertEquals(stepIndex(5, 3, 0), 3);
});

Deno.test("stepIndex: wrap turns over only from the end being left", () => {
  assertEquals(stepIndex(5, 4, 1, true), 0);
  assertEquals(stepIndex(5, 0, -1, true), 4);
  // a big step from the middle stops on the end first, the next one wraps
  assertEquals(stepIndex(5, 2, 10, true), 4);
  assertEquals(stepIndex(5, 4, 10, true), 0);
  assertEquals(stepIndex(5, 2, -10, true), 0);
  assertEquals(stepIndex(5, 0, -10, true), 4);
  // a single item wraps onto itself
  assertEquals(stepIndex(1, 0, 1, true), 0);
  assertEquals(stepIndex(1, 0, -1, true), 0);
});

Deno.test("stepIndex: garbage never throws and stays in range", () => {
  for (const n of [0, -3, NaN, Infinity, -Infinity, 0.5]) {
    assertEquals(stepIndex(n, 0, 1), -1, `n=${n}`);
  }
  assertEquals(stepIndex(3.9, 0, 5), 2); // n floors
  assertEquals(stepIndex(5, NaN, 1), 1); // NaN index -> 0
  assertEquals(stepIndex(5, 99, -1), 3); // above the list -> last, then step
  assertEquals(stepIndex(5, 2, NaN), 2); // NaN delta -> no move
  assertEquals(stepIndex(5, 2, Infinity), 2); // non-finite delta -> no move
  assertEquals(stepIndex(5, 2, 1.9), 3); // truncates
  assertEquals(stepIndex(5, 2, -1.9), 1);
  assertEquals(stepIndex(5, 2.7, 0), 2);
});

Deno.test("stepIndex: -1 is 'nothing selected' (a select with selectedIndex -1)", () => {
  assertEquals(stepIndex(3, -1, 1), 0);
  assertEquals(stepIndex(3, -1, -1), -1);
  assertEquals(stepIndex(3, -1, -1, true), 2);
  assertEquals(stepIndex(3, -7, 0), -1);
  assertEquals(stepIndex(3, -1, 2), 1);
});

Deno.test("stepEnabled over an all-enabled list IS stepIndex (every n, index, delta, wrap)", () => {
  let cases = 0;
  for (let n = 1; n <= 6; n++) {
    const all = new Array(n).fill(true);
    for (let i = -2; i <= n + 1; i++) {
      for (let d = -8; d <= 8; d++) {
        for (const wrap of [false, true]) {
          const a = stepIndex(n, i, d, wrap);
          const b = stepEnabled(all, i, d, wrap);
          assert(a === b, `n=${n} i=${i} d=${d} wrap=${wrap}: stepIndex ${a} vs stepEnabled ${b}`);
          assert(a >= -1 && a < n, `in range: ${a}`);
          cases++;
        }
      }
    }
  }
  assertEquals(cases, 1530); // sum over n=1..6 of (n + 4) indices x 17 deltas x 2 wrap modes
});

Deno.test("stepEnabled: skips disabled options like a native select", () => {
  const e = [true, false, true, false, true];
  assertEquals(stepEnabled(e, 0, 1), 2);
  assertEquals(stepEnabled(e, 2, 1), 4);
  assertEquals(stepEnabled(e, 0, 2), 4);
  assertEquals(stepEnabled(e, 4, 1), 4);
  assertEquals(stepEnabled(e, 4, 1, true), 0);
  assertEquals(stepEnabled(e, 0, -1, true), 4);
  // starting on a disabled placeholder
  assertEquals(stepEnabled(e, 1, 1), 2);
  assertEquals(stepEnabled(e, 1, -1), 0);
  // a disabled first item is never reached by wrap
  assertEquals(stepEnabled([false, true, true], 1, -1, true), 2);
  assertEquals(stepEnabled([false, true, true], 2, 1, true), 1);
  // nothing enabled: nothing moves
  assertEquals(stepEnabled([false, false], 0, 1, true), 0);
  assertEquals(stepEnabled([], 0, 1), -1);
  assertEquals(stepEnabled(null as unknown as boolean[], 0, 1), -1);
});

Deno.test("stepperModel: label, ends and which arrows act", () => {
  const opts = ["Male", { label: "Female", sub: "lighter frame" }, {
    label: "Other",
    disabled: true,
  }];
  const m0 = stepperModel(opts, 0);
  assertEquals(m0.count, 3);
  assertEquals(m0.label, { text: "Male" });
  assert(m0.atStart && !m0.atEnd && !m0.canPrev && m0.canNext, "first item");
  const m1 = stepperModel(opts, 1);
  assertEquals(m1.label, { text: "Female", sub: "lighter frame" });
  assert(!m1.atStart && m1.atEnd, "a disabled last item makes index 1 the end");
  assert(m1.canPrev && !m1.canNext, "no next without wrap");
  const w = stepperModel(opts, 1, true);
  assert(w.canPrev && w.canNext, "wrap: both arrows act");
  const single = stepperModel(["Only"], 0, true);
  assert(!single.canPrev && !single.canNext, "one option: nothing to wrap to");
  assert(single.atStart && single.atEnd, "one option is both ends");
});

Deno.test("stepperModel: garbage resolves to an empty or blank model", () => {
  for (const g of [[], null, undefined, "abc" as unknown as string[]]) {
    const m = stepperModel(g as string[], 0);
    assertEquals(m.count, 0);
    assertEquals(m.index, -1);
    assertEquals(m.label.text, STEPPER_EMPTY_TEXT);
    assert(!m.canPrev && !m.canNext, "empty: no arrows");
  }
  const blank = stepperModel([null as unknown as string, 42 as unknown as string, ""], 1);
  assertEquals(blank.count, 3);
  assertEquals(blank.label.text, STEPPER_EMPTY_TEXT);
  assertEquals(stepperModel(["a", "b"], NaN).index, 0);
  assertEquals(stepperModel(["a", "b"], 50).index, 1);
  const none = stepperModel(["a", "b"], -1);
  assertEquals(none.index, -1);
  assertEquals(none.label.text, STEPPER_EMPTY_TEXT);
  assert(!none.canPrev && none.canNext, "nothing selected: Next picks the first");
});

Deno.test("toLabel: the formatter hook accepts strings, numbers, labels; garbage falls back", () => {
  assertEquals(toLabel("Fire"), { text: "Fire" });
  assertEquals(toLabel(12), { text: "12" });
  assertEquals(toLabel(NaN, "x"), { text: "x" });
  assertEquals(toLabel({ text: "Fire", sub: "sun", icon: "<svg/>" }), {
    text: "Fire",
    sub: "sun",
    icon: "<svg/>",
  });
  assertEquals(toLabel({ text: "Fire", sub: "  " }), { text: "Fire" });
  assertEquals(toLabel({ text: "   " }, "fb"), { text: "fb" });
  assertEquals(toLabel({ nope: 1 }, "fb"), { text: "fb" });
  assertEquals(toLabel(null), { text: STEPPER_EMPTY_TEXT });
  assertEquals(toLabel(undefined, "fb"), { text: "fb" });
});

// ===================================================================== pure: numeric values

Deno.test("stepNumber: no float drift on a decimal grid", () => {
  assertEquals(stepNumber(0.2, 0, 1, 0.1, 1), 0.3); // 0.2 + 0.1 would be 0.30000000000000004
  let v = 0;
  for (let k = 1; k <= 10; k++) {
    v = stepNumber(v, 0, 1, 0.1, 1);
    assert(v === Number((k / 10).toFixed(1)), `step ${k}: ${v}`);
  }
  assertEquals(v, 1);
  for (let k = 9; k >= 0; k--) {
    v = stepNumber(v, 0, 1, 0.1, -1);
    assert(v === Number((k / 10).toFixed(1)), `down ${k}: ${v}`);
  }
  assertEquals(stepNumber(1.75, NaN, NaN, 0.01, 1), 1.76);
  assertEquals(stepNumber(1.75, NaN, NaN, 0.01, -1), 1.74);
  // a long walk stays exact
  let w = 0;
  for (let i = 0; i < 1000; i++) w = stepNumber(w, 0, 100, 0.01, 1);
  assertEquals(w, 10);
});

Deno.test("stepNumber: the grid starts at min, max snaps down onto it", () => {
  assertEquals(stepNumber(0.5, 0.5, 10, 1, 1), 1.5);
  assertEquals(stepNumber(-1, -1, 1, 0.25, 1), -0.75);
  const D = numberDomain(0, 10, 3);
  assertEquals([D.min, D.max, D.kLo, D.kHi], [0, 9, 0, 3]);
  assertEquals(stepNumber(9, 0, 10, 3, 1), 9);
  assertEquals(stepNumber(9, 0, 10, 3, 1, true), 0);
  assertEquals(stepNumber(6, 0, 10, 3, 1), 9);
  assertEquals(numberDomain(0, 0.3, 0.1).max, 0.3); // 0.3 / 0.1 = 2.9999999999999996 still reaches 0.3
});

Deno.test("stepNumber: clamps, and wraps only from the end being left", () => {
  assertEquals(stepNumber(100, 0, 100, 1, 1), 100);
  assertEquals(stepNumber(0, 0, 100, 1, -1), 0);
  assertEquals(stepNumber(100, 0, 100, 1, 1, true), 0);
  assertEquals(stepNumber(0, 0, 100, 1, -1, true), 100);
  assertEquals(stepNumber(95, 0, 100, 1, 10, true), 100); // PageUp from the middle stops on the end
  assertEquals(stepNumber(100, 0, 100, 1, 10, true), 0);
  assertEquals(stepNumber(5, 0, 100, 1, -10, true), 0);
  // wrap needs two closed ends
  assertEquals(stepNumber(100, NaN, 100, 1, 1, true), 100);
  assertEquals(stepNumber(5, 5, 5, 1, 1, true), 5);
  // huge deltas are finite
  assertEquals(stepNumber(5, 0, 100, 1, 1e300), 100);
  assertEquals(stepNumber(5, NaN, NaN, 1, -1e300), 5 - 1e9);
});

Deno.test("stepNumber: off-grid values step to the next grid point in the step's direction", () => {
  assertEquals(stepNumber(0.5, 0, 10, 1, 1), 1);
  assertEquals(stepNumber(0.5, 0, 10, 1, -1), 0);
  assertEquals(stepNumber(0.4, 0, 10, 1, 0), 0);
  assertEquals(stepNumber(0.6, 0, 10, 1, 0), 1);
  assertEquals(stepNumber(2.5, 0, 10, 1, 2), 4);
  assertEquals(snapNumber(7.77, 0, 10, 0.5), 8);
});

Deno.test("stepNumber: garbage — NaN value, outside range, step 0, min > max, open ends", () => {
  assertEquals(stepNumber(NaN, 3, 10, 1, 1), 3); // no value: a step lands on the start
  assertEquals(stepNumber(NaN, NaN, NaN, 1, 1), 0);
  assertEquals(stepNumber(NaN, NaN, -5, 1, 1), -5);
  assertEquals(stepNumber(-50, 0, 10, 1, 1), 0); // outside: lands on the nearest bound
  assertEquals(stepNumber(50, 0, 10, 1, -1), 10);
  for (const s of [0, -1, NaN, Infinity]) assertEquals(stepNumber(2, 0, 10, s, 1), 3, `step ${s}`);
  assertEquals(numberDomain(0, 10, 1e-30).step, 1e-12);
  // min > max: max collapses to min (the HTML rule)
  const D = numberDomain(10, 5, 2);
  assertEquals([D.min, D.max], [10, 10]);
  assertEquals(stepNumber(7, 10, 5, 2, 1), 10);
  assertEquals(stepNumber(5, NaN, NaN, 1, 3), 8);
  assertEquals(stepNumber(-2.5, -Infinity, Infinity, 0.5, -1), -3);
  assertEquals(stepNumber(3, 0, 10, 1, NaN), 3);
  assertEquals(Object.is(stepNumber(-0.1, -1, 1, 0.1, 1), 0), true); // never -0
});

Deno.test("numberModel and formatStepNumber", () => {
  const m = numberModel(0, 0, 9000, 100);
  assert(m.atStart && !m.atEnd && !m.canPrev && m.canNext, "at min");
  const w = numberModel(0, 0, 9000, 100, true);
  assert(w.canPrev && w.canNext, "wrap");
  const open = numberModel(5, NaN, NaN, 1);
  assert(!open.atStart && !open.atEnd && open.canPrev && open.canNext, "open ends");
  const empty = numberModel(NaN, 0, 10, 1);
  assert(
    Number.isNaN(empty.value) && empty.canNext && empty.canPrev,
    "empty: either arrow picks a value",
  );
  assertEquals(formatStepNumber(1.5, 2), "1.50");
  assertEquals(formatStepNumber(0.30000000000000004, 1), "0.3");
  assertEquals(formatStepNumber(NaN, 2), STEPPER_EMPTY_TEXT);
  assertEquals(formatStepNumber(3, NaN), "3");
  assertEquals([
    decimalsOf(0.25),
    decimalsOf(1e-7),
    decimalsOf(100),
    decimalsOf(NaN),
    decimalsOf(1.5e-3),
  ], [2, 7, 0, 0, 4]);
});

Deno.test("keyAction: the keyboard map", () => {
  assertEquals(keyAction("ArrowRight", "list"), { kind: "step", delta: 1 });
  assertEquals(keyAction("ArrowUp", "list"), { kind: "step", delta: 1 });
  assertEquals(keyAction("ArrowLeft", "number"), { kind: "step", delta: -1 });
  assertEquals(keyAction("ArrowDown", "number"), { kind: "step", delta: -1 });
  assertEquals(keyAction("PageUp", "number"), { kind: "step", delta: 10 });
  assertEquals(keyAction("PageDown", "number", 5), { kind: "step", delta: -5 });
  assertEquals(keyAction("PageUp", "list"), null);
  assertEquals(keyAction("Home", "list"), { kind: "start" });
  assertEquals(keyAction("End", "number"), { kind: "end" });
  assertEquals(keyAction("Enter", "list"), null);
  assertEquals(keyAction("Tab", "number"), null);
  assertEquals(keyAction("PageUp", "number", NaN), { kind: "step", delta: 10 });
});

Deno.test("stepperView / stepState / stepStateTo: aria values without a DOM", () => {
  const list: StepperState = {
    kind: "list",
    options: ["a", { label: "b", sub: "bee" }, "c"],
    index: 1,
  };
  const v = stepperView(list);
  assertEquals([v.now, v.min, v.max, v.valueText], [1, 0, 2, "b, bee"]);
  assertEquals(stateValueOf(stepState(list, 1)), 2);
  assertEquals(stateValueOf(stepStateTo(list, "start")), 0);
  assertEquals(stateValueOf(stepStateTo(list, "end")), 2);
  const disabled: StepperState = { ...list, disabled: true };
  assert(!stepperView(disabled).canPrev && !stepperView(disabled).canNext, "disabled: no arrows");
  assertEquals(stateValueOf(stepState(disabled, 1)), 1);
  const num: StepperState = { kind: "number", value: 5, min: NaN, max: NaN, step: 1 };
  const nv = stepperView(num);
  assertEquals([nv.now, nv.min, nv.max, nv.valueText], [5, null, null, "5"]);
  assert(stepStateTo(num, "end") === num, "open end: End does nothing");
  const fmt: StepperState = {
    kind: "number",
    value: 0,
    min: 0,
    max: 9000,
    step: 100,
    format: (x) => (x === 0 ? "random" : `${x} N`),
  };
  assertEquals(stepperView(fmt).valueText, "random");
  assertEquals(stepperView(stepState(fmt, 1)).valueText, "100 N");
  const throwing: StepperState = {
    kind: "number",
    value: 2,
    min: 0,
    max: 9,
    step: 1,
    format: () => {
      throw new Error("x");
    },
  };
  assertEquals(stepperView(throwing).valueText, "2");
  const empty: StepperState = { kind: "number", value: NaN, min: 0, max: 9, step: 1 };
  assertEquals([stepperView(empty).now, stepperView(empty).valueText], [null, STEPPER_EMPTY_TEXT]);
});

function stateValueOf(s: StepperState): number {
  return s.kind === "list" ? s.index : s.value;
}

// ======================================================================= the document shim

type Listener = (ev: FEvent) => void;

class FEvent {
  type: string;
  bubbles: boolean;
  defaultPrevented = false;
  stopped = false;
  target: unknown = null;
  currentTarget: unknown = null;
  key?: string;
  button?: number;
  pointerType?: string;
  deltaY?: number;
  deltaX?: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  constructor(type: string, init: Record<string, unknown> = {}) {
    Object.assign(this, init);
    this.type = type;
    this.bubbles = init.bubbles === true;
  }
  preventDefault(): void {
    this.defaultPrevented = true;
  }
  stopPropagation(): void {
    this.stopped = true;
  }
}

interface MutationRec {
  type: "attributes" | "childList" | "characterData";
  target: FNode;
  attributeName?: string;
}

class Listeners {
  map = new Map<string, Listener[]>();
  add(type: string, fn: Listener): void {
    const l = this.map.get(type) ?? [];
    if (!l.includes(fn)) l.push(fn);
    this.map.set(type, l);
  }
  remove(type: string, fn: Listener): void {
    this.map.set(type, (this.map.get(type) ?? []).filter((f) => f !== fn));
  }
  call(ev: FEvent): void {
    for (const fn of [...(this.map.get(ev.type) ?? [])]) fn(ev);
  }
  count(type: string): number {
    return (this.map.get(type) ?? []).length;
  }
}

abstract class FNode {
  parentNode: FElement | null = null;
  abstract readonly nodeType: number;
  constructor(readonly ownerDocument: FDoc) {}
  abstract get textContent(): string;
}

class FText extends FNode {
  readonly nodeType = 3;
  #data: string;
  constructor(doc: FDoc, data: string) {
    super(doc);
    this.#data = data;
  }
  get textContent(): string {
    return this.#data;
  }
  set textContent(v: string) {
    this.#data = v;
    this.ownerDocument.mutate({ type: "characterData", target: this });
  }
}

class FElement extends FNode {
  readonly nodeType = 1;
  readonly tagName: string;
  childNodes: FNode[] = [];
  attrs = new Map<string, string>();
  listeners = new Listeners();
  html = "";
  constructor(doc: FDoc, tag: string) {
    super(doc);
    this.tagName = tag.toUpperCase();
  }
  getAttribute(n: string): string | null {
    return this.attrs.has(n) ? this.attrs.get(n)! : null;
  }
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, String(v));
    this.ownerDocument.mutate({ type: "attributes", target: this, attributeName: n });
  }
  removeAttribute(n: string): void {
    if (!this.attrs.delete(n)) return;
    this.ownerDocument.mutate({ type: "attributes", target: this, attributeName: n });
  }
  hasAttribute(n: string): boolean {
    return this.attrs.has(n);
  }
  get id(): string {
    return this.getAttribute("id") ?? "";
  }
  get disabled(): boolean {
    return this.hasAttribute("disabled");
  }
  set disabled(v: boolean) {
    if (v) this.setAttribute("disabled", "");
    else this.removeAttribute("disabled");
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    for (const c of [...this.childNodes]) this.removeChild(c);
    if (v !== "") {
      const t = new FText(this.ownerDocument, v);
      t.parentNode = this;
      this.childNodes.push(t);
    }
    this.ownerDocument.mutate({ type: "childList", target: this });
  }
  get innerHTML(): string {
    return this.html;
  }
  set innerHTML(v: string) {
    this.textContent = "";
    this.html = v;
  }
  appendChild<T extends FNode>(c: T): T {
    return this.insertBefore(c, null);
  }
  insertBefore<T extends FNode>(c: T, ref: FNode | null): T {
    c.parentNode?.removeChild(c);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c);
    else this.childNodes.splice(i, 0, c);
    c.parentNode = this;
    this.ownerDocument.mutate({ type: "childList", target: this });
    return c;
  }
  removeChild<T extends FNode>(c: T): T {
    // like a browser: removing the focused element (or its ancestor) drops focus to <body>
    for (let n = this.ownerDocument.activeElement as FElement | null; n; n = n.parentNode) {
      if (n === (c as FNode)) {
        this.ownerDocument.activeElement = this.ownerDocument.body;
        break;
      }
    }
    this.childNodes = this.childNodes.filter((x) => x !== c);
    c.parentNode = null;
    this.ownerDocument.mutate({ type: "childList", target: this });
    return c;
  }
  remove(): void {
    this.parentNode?.removeChild(this);
  }
  get nextSibling(): FNode | null {
    const p = this.parentNode;
    if (!p) return null;
    return p.childNodes[p.childNodes.indexOf(this) + 1] ?? null;
  }
  get children(): FElement[] {
    return this.childNodes.filter((c): c is FElement => c instanceof FElement);
  }
  get isConnected(): boolean {
    if (this === this.ownerDocument.body) return true;
    for (let n = this.parentNode; n; n = n.parentNode) {
      if (n === this.ownerDocument.body) return true;
    }
    return false;
  }
  addEventListener(type: string, fn: Listener): void {
    this.listeners.add(type, fn);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.remove(type, fn);
  }
  dispatchEvent(ev: FEvent): boolean {
    ev.target = this;
    const path: Array<FElement | FDoc> = [this];
    for (let n = this.parentNode; n; n = n.parentNode) path.push(n);
    if (this.isConnected) path.push(this.ownerDocument);
    for (const node of path) {
      ev.currentTarget = node;
      node.listeners.call(ev);
      if (ev.stopped || !ev.bubbles) break;
    }
    return !ev.defaultPrevented;
  }
  focus(): void {
    this.ownerDocument.activeElement = this;
    this.dispatchEvent(new FEvent("focus"));
  }
  querySelectorAll(sel: string): FElement[] {
    const tags = sel.split(",").map((s) => s.trim().toUpperCase());
    const out: FElement[] = [];
    const walk = (e: FElement) => {
      for (const c of e.children) {
        if (tags.includes(c.tagName)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  /** Test helper: the first descendant carrying `cls` in its class attribute. */
  find(cls: string): FElement | null {
    const walk = (e: FElement): FElement | null => {
      for (const c of e.children) {
        if ((c.getAttribute("class") ?? "").split(/\s+/).includes(cls)) return c;
        const r = walk(c);
        if (r) return r;
      }
      return null;
    };
    return walk(this);
  }
}

class FOption extends FElement {
  get value(): string {
    return this.getAttribute("value") ?? this.text;
  }
  get text(): string {
    return this.textContent.replace(/\s+/g, " ").trim();
  }
}

class FSelect extends FElement {
  #sel: number | null = null;
  get options(): FOption[] {
    const out: FOption[] = [];
    const walk = (e: FElement) => {
      for (const c of e.children) {
        if (c instanceof FOption) out.push(c);
        else walk(c);
      }
    };
    walk(this);
    return out;
  }
  get multiple(): boolean {
    return this.hasAttribute("multiple");
  }
  get size(): number {
    return Number(this.getAttribute("size") ?? 0) || 0;
  }
  get selectedIndex(): number {
    const n = this.options.length;
    if (n === 0) return -1;
    if (this.#sel === null) {
      const i = this.options.findIndex((o) => o.hasAttribute("selected"));
      return i >= 0 ? i : 0;
    }
    if (this.#sel >= n) return 0;
    return this.#sel;
  }
  set selectedIndex(i: number) {
    this.#sel = i >= 0 && i < this.options.length ? i : -1;
  }
  get value(): string {
    const i = this.selectedIndex;
    return i >= 0 ? this.options[i].value : "";
  }
  set value(v: string) {
    this.#sel = this.options.findIndex((o) => o.value === String(v));
  }
}

class FInput extends FElement {
  #val: string | null = null;
  get type(): string {
    return (this.getAttribute("type") ?? "text").toLowerCase();
  }
  get value(): string {
    return this.#val ?? this.getAttribute("value") ?? "";
  }
  set value(v: string) {
    this.#val = String(v);
  }
  get valueAsNumber(): number {
    return this.value === "" ? NaN : Number(this.value);
  }
  set valueAsNumber(v: number) {
    this.#val = String(v);
  }
}

class FDoc {
  readonly body: FElement;
  activeElement: FElement | null = null;
  listeners = new Listeners();
  observers = new Set<FakeMO>();
  readonly defaultView: {
    Event: typeof FEvent;
    MutationObserver: new (cb: (r: MutationRec[]) => void) => FakeMO;
  };
  constructor() {
    this.body = new FElement(this, "body");
    this.activeElement = this.body;
    // deno-lint-ignore no-this-alias
    const doc = this;
    this.defaultView = {
      Event: FEvent,
      MutationObserver: class extends FakeMO {
        constructor(cb: (r: MutationRec[]) => void) {
          super(doc, cb);
        }
      },
    };
  }
  createElement(tag: string): FElement {
    const t = tag.toLowerCase();
    if (t === "select") return new FSelect(this, t);
    if (t === "option") return new FOption(this, t);
    if (t === "input") return new FInput(this, t);
    return new FElement(this, t);
  }
  createTextNode(s: string): FText {
    return new FText(this, s);
  }
  querySelectorAll(sel: string): FElement[] {
    return this.body.querySelectorAll(sel);
  }
  addEventListener(type: string, fn: Listener): void {
    this.listeners.add(type, fn);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.remove(type, fn);
  }
  mutate(rec: MutationRec): void {
    for (const mo of this.observers) mo.notify(rec);
  }
}

/** A MutationObserver that, like the real one, delivers records in a microtask. */
class FakeMO {
  regs: Array<{ target: FNode; init: MutationObserverInit }> = [];
  queue: MutationRec[] = [];
  scheduled = false;
  constructor(readonly doc: FDoc, readonly cb: (r: MutationRec[]) => void) {}
  observe(target: FNode, init: MutationObserverInit): void {
    this.regs.push({ target, init });
    this.doc.observers.add(this);
  }
  disconnect(): void {
    this.regs = [];
    this.queue = [];
    this.doc.observers.delete(this);
  }
  notify(rec: MutationRec): void {
    const hit = this.regs.some(({ target, init }) => {
      let inside = rec.target === target;
      if (!inside && init.subtree) {
        for (let n = rec.target.parentNode; n; n = n.parentNode) if (n === target) inside = true;
      }
      if (!inside) return false;
      if (rec.type === "attributes") {
        return !!init.attributes &&
          (!init.attributeFilter || init.attributeFilter.includes(rec.attributeName ?? ""));
      }
      return rec.type === "childList" ? !!init.childList : !!init.characterData;
    });
    if (!hit) return;
    this.queue.push(rec);
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      const q = this.queue;
      this.queue = [];
      if (q.length) this.cb(q);
    });
  }
}

class FakeTimers implements StepperTimers {
  now = 0;
  seq = 0;
  tasks = new Map<number, { at: number; fn: () => void }>();
  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.tasks.set(id, { at: this.now + ms, fn });
    return id;
  };
  clearTimeout = (id: unknown): void => {
    this.tasks.delete(id as number);
  };
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      let best: [number, { at: number; fn: () => void }] | null = null;
      for (const e of this.tasks) if (e[1].at <= end && (!best || e[1].at < best[1].at)) best = e;
      if (!best) break;
      this.tasks.delete(best[0]);
      this.now = best[1].at;
      best[1].fn();
    }
    this.now = end;
  }
}

// ---------------------------------------------------------------------------- shim helpers

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function el(
  doc: FDoc,
  tag: string,
  attrs: Record<string, string> = {},
  ...kids: Array<FNode | string>
): FElement {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const k of kids) e.appendChild(typeof k === "string" ? doc.createTextNode(k) : k);
  return e;
}

function sexField(doc: FDoc): { label: FElement; select: FSelect } {
  const select = el(
    doc,
    "select",
    { id: "creator-sex", title: "Male or female build" },
    el(doc, "option", { value: "male" }, "Male"),
    el(doc, "option", { value: "female", "data-sub": "lighter frame" }, "Female"),
  ) as FSelect;
  const label = el(doc, "label", { class: "field" }, "Sex ", select);
  doc.body.appendChild(label);
  return { label, select };
}

const asDoc = (d: FDoc) => d as unknown as Document;
const asSel = (s: FSelect) => s as unknown as HTMLSelectElement;
const asInput = (s: FInput) => s as unknown as HTMLInputElement;
const real = (s: Stepper) => s.element as unknown as FElement;
const key = (s: Stepper, k: string, extra: Record<string, unknown> = {}) => {
  const ev = new FEvent("keydown", { key: k, bubbles: true, ...extra });
  real(s).dispatchEvent(ev);
  return ev;
};
const prevBtn = (s: Stepper) => real(s).find("stepper-prev")!;
const nextBtn = (s: Stepper) => real(s).find("stepper-next")!;
const click = (b: FElement) => b.dispatchEvent(new FEvent("click", { bubbles: true }));
const shown = (s: Stepper) => real(s).find("stepper-text")!.textContent;

// ============================================================================= DOM: component

Deno.test("Stepper: markup, aria, classes and disabled ends", () => {
  const doc = new FDoc();
  const steps: Array<[number, number, string]> = [];
  const s = new Stepper({ kind: "list", options: ["Short", "Normal", "Long"], index: 0 }, {
    document: asDoc(doc),
    label: "Match length",
    onStep: (v, p, via) => steps.push([v, p, via]),
  });
  doc.body.appendChild(real(s));
  const r = real(s);
  assertEquals(r.getAttribute("class"), "stepper");
  assertEquals(r.getAttribute("role"), "spinbutton");
  assertEquals(r.getAttribute("tabindex"), "0");
  assertEquals(r.getAttribute("aria-label"), "Match length");
  assertEquals(r.children.map((c) => c.getAttribute("class")), [
    "stepper-arrow stepper-prev",
    "stepper-value",
    "stepper-arrow stepper-next",
  ]);
  assertEquals(prevBtn(s).getAttribute("tabindex"), "-1");
  assertEquals(prevBtn(s).getAttribute("type"), "button");
  assert(
    prevBtn(s).innerHTML.includes("<svg") && !prevBtn(s).innerHTML.includes("style="),
    "SVG arrow, no style attribute",
  );
  assert(nextBtn(s).innerHTML.includes("icon-chevron-right"), "right chevron");
  assertEquals([
    r.getAttribute("aria-valuenow"),
    r.getAttribute("aria-valuemin"),
    r.getAttribute("aria-valuemax"),
    r.getAttribute("aria-valuetext"),
  ], ["0", "0", "2", "Short"]);
  assert(r.hasAttribute("data-at-start") && !r.hasAttribute("data-at-end"), "at start");
  assert(
    prevBtn(s).hasAttribute("disabled") && !nextBtn(s).hasAttribute("disabled"),
    "prev disabled at the start",
  );
  click(nextBtn(s));
  click(nextBtn(s));
  assertEquals(s.value, 2);
  assertEquals(shown(s), "Long");
  assert(
    r.hasAttribute("data-at-end") && nextBtn(s).hasAttribute("disabled"),
    "next disabled at the end",
  );
  click(nextBtn(s)); // a click on a disabled end changes nothing (and calls no onStep)
  assertEquals(steps, [[1, 0, "click"], [2, 1, "click"]]);
  assert(
    r.find("stepper-sub")!.hasAttribute("hidden") && r.find("stepper-icon")!.hasAttribute("hidden"),
    "no sub-label, no icon",
  );
});

Deno.test("Stepper: keyboard map, handled keys do not reach the menu, modifiers pass through", () => {
  const doc = new FDoc();
  const s = new Stepper({ kind: "number", value: 50, min: 0, max: 100, step: 5 }, {
    document: asDoc(doc),
  });
  doc.body.appendChild(real(s));
  let menuKeys = 0;
  doc.body.addEventListener("keydown", () => menuKeys++);
  assert(key(s, "ArrowRight").defaultPrevented, "handled");
  assertEquals(s.value, 55);
  key(s, "ArrowUp");
  key(s, "ArrowLeft");
  key(s, "ArrowDown");
  assertEquals(s.value, 50);
  key(s, "PageUp");
  assertEquals(s.value, 100);
  key(s, "PageDown");
  assertEquals(s.value, 50);
  key(s, "Home");
  assertEquals(s.value, 0);
  key(s, "End");
  assertEquals(s.value, 100);
  assertEquals(menuKeys, 0);
  const other = key(s, "Escape");
  assert(!other.defaultPrevented, "unhandled key untouched");
  key(s, "ArrowLeft", { ctrlKey: true });
  assertEquals(s.value, 100);
  assertEquals(menuKeys, 2);
  // open numeric ends: Home/End are not ours
  const open = new Stepper({ kind: "number", value: 1.75, min: NaN, max: NaN, step: 0.01 }, {
    document: asDoc(doc),
  });
  doc.body.appendChild(real(open));
  assert(
    !key(open, "Home").defaultPrevented && open.value === 1.75,
    "Home on an open end is left alone",
  );
});

Deno.test("Stepper: wrap keeps both arrows live; wheel is off by default", () => {
  const doc = new FDoc();
  const s = new Stepper({ kind: "list", options: ["a", "b", "c"], index: 2 }, {
    document: asDoc(doc),
    wrap: true,
  });
  doc.body.appendChild(real(s));
  assert(
    !prevBtn(s).hasAttribute("disabled") && !nextBtn(s).hasAttribute("disabled"),
    "wrap: never disabled",
  );
  click(nextBtn(s));
  assertEquals(s.value, 0);
  real(s).focus();
  const w = new FEvent("wheel", { deltaY: -100, bubbles: true });
  real(s).dispatchEvent(w);
  assertEquals(s.value, 0);
  assert(!w.defaultPrevented, "wheel scrolls the menu by default");
  const wheel = new Stepper({ kind: "list", options: ["a", "b", "c"], index: 0 }, {
    document: asDoc(doc),
    wheel: true,
  });
  doc.body.appendChild(real(wheel));
  real(wheel).dispatchEvent(new FEvent("wheel", { deltaY: -100 }));
  assertEquals(wheel.value, 0); // not focused: the wheel still scrolls
  real(wheel).focus();
  real(wheel).dispatchEvent(new FEvent("wheel", { deltaY: -100 }));
  assertEquals(wheel.value, 1);
});

Deno.test("Stepper: mouse press-and-hold repeats after 350 ms then every 60 ms; the click is not double-counted", () => {
  const doc = new FDoc();
  const timers = new FakeTimers();
  const s = new Stepper({ kind: "number", value: 0, min: 0, max: 100, step: 1 }, {
    document: asDoc(doc),
    timers,
  });
  doc.body.appendChild(real(s));
  const down = new FEvent("pointerdown", { button: 0, pointerType: "mouse", bubbles: true });
  nextBtn(s).dispatchEvent(down);
  assert(down.defaultPrevented, "pointerdown keeps focus off the arrow");
  assert(doc.activeElement === real(s), "focus moves to the spinbutton");
  assertEquals(s.value, 1); // immediate step
  timers.advance(STEPPER_REPEAT_DELAY_MS - 1);
  assertEquals(s.value, 1);
  timers.advance(1);
  assertEquals(s.value, 2);
  timers.advance(STEPPER_REPEAT_INTERVAL_MS * 3);
  assertEquals(s.value, 5);
  nextBtn(s).dispatchEvent(
    new FEvent("pointerup", { button: 0, pointerType: "mouse", bubbles: true }),
  );
  click(nextBtn(s));
  assertEquals(s.value, 5); // the press's own click did not step again
  timers.advance(5000);
  assertEquals(s.value, 5); // repeat stopped
  click(nextBtn(s)); // a later click (keyboard / screen reader) steps
  assertEquals(s.value, 6);
  // a quick mouse click (press, release, click — no repeat) is exactly one step
  nextBtn(s).dispatchEvent(
    new FEvent("pointerdown", { button: 0, pointerType: "mouse", bubbles: true }),
  );
  nextBtn(s).dispatchEvent(
    new FEvent("pointerup", { button: 0, pointerType: "mouse", bubbles: true }),
  );
  click(nextBtn(s));
  assertEquals(s.value, 7);
  // a right/middle button press does nothing
  nextBtn(s).dispatchEvent(
    new FEvent("pointerdown", { button: 2, pointerType: "mouse", bubbles: true }),
  );
  assertEquals(s.value, 7);
});

Deno.test("Stepper: a hold stops at a closed end, on pointerleave, and when the stepper is detached", () => {
  const doc = new FDoc();
  const timers = new FakeTimers();
  const s = new Stepper({ kind: "number", value: 95, min: 0, max: 100, step: 1 }, {
    document: asDoc(doc),
    timers,
  });
  doc.body.appendChild(real(s));
  nextBtn(s).dispatchEvent(new FEvent("pointerdown", { button: 0, pointerType: "mouse" }));
  timers.advance(2000);
  assertEquals(s.value, 100);
  assertEquals(timers.tasks.size, 0);
  assertEquals(doc.listeners.count("pointerup"), 0); // the end released the document listener
  prevBtn(s).dispatchEvent(new FEvent("pointerdown", { button: 0, pointerType: "mouse" }));
  timers.advance(STEPPER_REPEAT_DELAY_MS);
  assertEquals(s.value, 98);
  prevBtn(s).dispatchEvent(new FEvent("pointerleave", {}));
  timers.advance(2000);
  assertEquals(s.value, 98);
  prevBtn(s).dispatchEvent(new FEvent("pointerdown", { button: 0, pointerType: "mouse" }));
  assertEquals(s.value, 97);
  real(s).remove(); // a change listener re-rendered the menu
  timers.advance(2000);
  assertEquals(s.value, 97);
});

Deno.test("Stepper: touch steps on the tap's click, repeats only when held", () => {
  const doc = new FDoc();
  const timers = new FakeTimers();
  const s = new Stepper({ kind: "list", options: ["a", "b", "c", "d", "e", "f"], index: 0 }, {
    document: asDoc(doc),
    timers,
  });
  doc.body.appendChild(real(s));
  nextBtn(s).dispatchEvent(
    new FEvent("pointerdown", { button: 0, pointerType: "touch", bubbles: true }),
  );
  assertEquals(s.value, 0); // a finger landing may be a scroll: no step yet
  nextBtn(s).dispatchEvent(new FEvent("pointercancel", { bubbles: true })); // it was a scroll
  timers.advance(1000);
  assertEquals(s.value, 0);
  nextBtn(s).dispatchEvent(
    new FEvent("pointerdown", { button: 0, pointerType: "touch", bubbles: true }),
  );
  nextBtn(s).dispatchEvent(new FEvent("pointerup", { bubbles: true }));
  click(nextBtn(s));
  assertEquals(s.value, 1); // a tap = one step
  nextBtn(s).dispatchEvent(
    new FEvent("pointerdown", { button: 0, pointerType: "touch", bubbles: true }),
  );
  timers.advance(STEPPER_REPEAT_DELAY_MS + STEPPER_REPEAT_INTERVAL_MS);
  assertEquals(s.value, 3);
  nextBtn(s).dispatchEvent(new FEvent("pointerup", { bubbles: true }));
  click(nextBtn(s));
  assertEquals(s.value, 3); // the held press's click is not counted
});

Deno.test("Stepper: disabled state, set() and destroy()", () => {
  const doc = new FDoc();
  const s = new Stepper({ kind: "list", options: ["a", "b"], index: 0, disabled: true }, {
    document: asDoc(doc),
  });
  doc.body.appendChild(real(s));
  assertEquals([real(s).getAttribute("aria-disabled"), real(s).getAttribute("tabindex")], [
    "true",
    "-1",
  ]);
  assert(
    prevBtn(s).hasAttribute("disabled") && nextBtn(s).hasAttribute("disabled"),
    "both arrows disabled",
  );
  click(nextBtn(s));
  key(s, "ArrowRight");
  assertEquals(s.value, 0);
  s.set({
    kind: "list",
    options: ["a", { label: "b", sub: "bee", icon: "<svg></svg>" }],
    index: 1,
  });
  assertEquals([real(s).getAttribute("aria-disabled"), real(s).getAttribute("tabindex")], [
    null,
    "0",
  ]);
  assertEquals(real(s).find("stepper-sub")!.textContent, "bee");
  assert(!real(s).find("stepper-sub")!.hasAttribute("hidden"), "sub-label shown");
  assertEquals(real(s).find("stepper-icon")!.innerHTML, "<svg></svg>");
  assertEquals(real(s).getAttribute("aria-valuetext"), "b, bee");
  s.destroy();
  s.destroy();
  assert(!real(s).isConnected && s.destroyed, "removed");
  assert(!s.step(1), "a destroyed stepper does nothing");
});

// ============================================================ DOM: progressive enhancement

Deno.test("upgradeSelect: the select stays the source of truth, a step fires input+change once", () => {
  const doc = new FDoc();
  const { label, select } = sexField(doc);
  const seen: string[] = [];
  let changes = 0, inputs = 0, bubbled = 0;
  select.addEventListener("change", () => {
    changes++;
    seen.push(select.value); // existing logic reads select.value inside its handler
  });
  select.addEventListener("input", () => inputs++);
  doc.body.addEventListener("change", () => bubbled++);
  const s = upgradeSelect(asSel(select))!;
  assert(s, "upgraded");
  assertEquals(select.getAttribute("data-stepper"), "1");
  assert(select.hasAttribute("hidden"), "native select hidden");
  assertEquals(select.getAttribute("class"), "stepper-native");
  assert(select.isConnected, "native select kept in the DOM");
  assert(select.nextSibling === real(s), "stepper sits right after the select");
  assert(real(s).parentNode === label, "inside the same label");
  assertEquals(real(s).getAttribute("aria-label"), "Sex");
  assertEquals(real(s).getAttribute("data-stepper-for"), "creator-sex");
  assertEquals(shown(s), "Male");

  click(nextBtn(s));
  assertEquals([select.selectedIndex, select.value], [1, "female"]);
  assertEquals([changes, inputs, bubbled], [1, 1, 1]);
  assertEquals(seen, ["female"]);
  assertEquals(real(s).getAttribute("aria-valuetext"), "Female, lighter frame");
  click(nextBtn(s)); // the end: nothing fires
  assertEquals([changes, inputs], [1, 1]);
  key(s, "ArrowLeft");
  assertEquals([select.value, changes, inputs], ["male", 2, 2]);

  // programmatic writes (no event) flow back immediately
  select.value = "female";
  assertEquals([real(s).getAttribute("aria-valuenow"), shown(s)], ["1", "Female"]);
  select.selectedIndex = 0;
  assertEquals(shown(s), "Male");
  assertEquals(changes, 2); // and they fire nothing
  assert(
    upgradeSelect(asSel(select)) === s && stepperFor(select as unknown as Element) === s,
    "idempotent",
  );
});

Deno.test("upgradeSelect: rebuilt options, disabled options and select.disabled follow via the observer", async () => {
  const doc = new FDoc();
  const select = el(
    doc,
    "select",
    { id: "menu-opponent" },
    el(doc, "option", { value: "a" }, "Ash"),
  ) as FSelect;
  doc.body.appendChild(el(doc, "label", { for: "menu-opponent" }, "Opponent"));
  doc.body.appendChild(select);
  const s = upgradeSelect(asSel(select))!;
  assertEquals(real(s).getAttribute("aria-label"), "Opponent"); // <label for=id>
  assert(nextBtn(s).hasAttribute("disabled"), "one option: no next");
  // the menu rebuilds the option list
  select.textContent = "";
  for (
    const [v, t, dis] of [["a", "Ash", false], ["b", "Birch", true], ["c", "Cedar", false]] as const
  ) {
    const o = el(doc, "option", {
      value: v,
      ...(dis ? { disabled: "" } : {}),
      ...(v === "c" ? { "data-icon": "flame" } : {}),
    }, t);
    select.appendChild(o);
  }
  await tick();
  assertEquals(real(s).getAttribute("aria-valuemax"), "2");
  assert(!nextBtn(s).hasAttribute("disabled"), "next live after the rebuild");
  click(nextBtn(s));
  assertEquals(select.value, "c"); // the disabled option was skipped
  assert(
    real(s).find("stepper-icon")!.innerHTML.includes("icon-flame"),
    "data-icon renders the Icons.ts icon",
  );
  select.disabled = true;
  await tick();
  assertEquals(real(s).getAttribute("aria-disabled"), "true");
  click(prevBtn(s));
  assertEquals(select.value, "c");
  // an empty select
  select.textContent = "";
  select.disabled = false;
  await tick();
  assertEquals([shown(s), real(s).getAttribute("aria-valuenow")], [STEPPER_EMPTY_TEXT, null]);
  // a multiple select is left native
  const multi = el(doc, "select", { multiple: "" }) as FSelect;
  doc.body.appendChild(multi);
  assertEquals(upgradeSelect(asSel(multi)), null);
});

Deno.test("upgradeSelect: a change listener that re-sets the value wins; destroy restores the select", () => {
  const doc = new FDoc();
  const { select } = sexField(doc);
  let refuse = true;
  select.addEventListener("change", () => {
    if (refuse && select.value === "female") select.selectedIndex = 0; // existing logic refuses the choice
  });
  const s = upgradeSelect(asSel(select), { intercept: false })!;
  click(nextBtn(s));
  assertEquals([select.value, s.value, shown(s)], ["male", 0, "Male"]);
  // without interception, a programmatic write is picked up by the select's own change event
  refuse = false;
  select.selectedIndex = 1;
  assertEquals(shown(s), "Male"); // stale until an event or sync()
  select.dispatchEvent(new FEvent("change", { bubbles: true }));
  assertEquals(shown(s), "Female");
  select.value = "male";
  select.dispatchEvent(new FEvent("input", { bubbles: true }));
  assertEquals(shown(s), "Male");
  select.selectedIndex = 1;
  s.sync();
  assertEquals(shown(s), "Female");
  select.selectedIndex = 0;
  s.sync();
  assertEquals(shown(s), "Male");
  s.destroy();
  assert(
    !select.hasAttribute("hidden") && !select.hasAttribute("class") &&
      !select.hasAttribute("data-stepper"),
    "restored",
  );
  assertEquals(stepperFor(select as unknown as Element), undefined);
  assert(!Object.prototype.hasOwnProperty.call(select, "value"), "no own accessor left behind");
});

Deno.test("upgradeRange: min/max/step, the linked <output> is mirrored and hidden", async () => {
  const doc = new FDoc();
  const out = el(doc, "output", { id: "arena-res-out" }, "random");
  const input = el(doc, "input", {
    id: "arena-res",
    type: "range",
    min: "0",
    max: "9000",
    step: "100",
    value: "0",
  }) as FInput;
  doc.body.appendChild(el(doc, "label", {}, "Wall resistance ", out, input));
  let changes = 0;
  input.addEventListener("input", () => {
    out.textContent = input.value === "0" ? "random" : `${input.value} N`; // the page's own listener
  });
  input.addEventListener("change", () => changes++);
  assert(
    linkedOutput(input as unknown as Element) === (out as unknown as HTMLOutputElement),
    "output in the same label",
  );
  const s = upgradeRange(asInput(input))!;
  assertEquals(real(s).getAttribute("aria-label"), "Wall resistance");
  assert(out.hasAttribute("hidden"), "output hidden: the stepper shows its text");
  assertEquals([
    shown(s),
    real(s).getAttribute("aria-valuemin"),
    real(s).getAttribute("aria-valuemax"),
  ], ["random", "0", "9000"]);
  click(nextBtn(s));
  assertEquals([input.value, shown(s), changes], ["100", "100 N", 1]);
  key(s, "PageUp");
  assertEquals([input.value, shown(s), changes], ["1100", "1100 N", 2]);
  key(s, "End");
  assertEquals([input.value, changes], ["9000", 3]);
  assert(nextBtn(s).hasAttribute("disabled"), "max end");
  // code elsewhere rewrites the output text: the observer picks it up
  out.textContent = "9000 N (max)";
  await tick();
  assertEquals(shown(s), "9000 N (max)");
  // the input's own max changes
  input.setAttribute("max", "10000");
  await tick();
  assert(!nextBtn(s).hasAttribute("disabled"), "a raised max reopens the end");
  s.destroy();
  assert(!out.hasAttribute("hidden"), "destroy shows the output again");
});

Deno.test("upgradeRange: defaults 0..100, step=any, a formatter wins over the output", () => {
  const doc = new FDoc();
  const input = el(doc, "input", {
    type: "range",
    step: "any",
    value: "50",
    "aria-label": "Volume",
  }) as FInput;
  doc.body.appendChild(input);
  const s = upgradeRange(asInput(input), { format: (v) => `${v}%` })!;
  assertEquals([
    real(s).getAttribute("aria-valuemin"),
    real(s).getAttribute("aria-valuemax"),
    shown(s),
  ], ["0", "100", "50%"]);
  assertEquals(real(s).getAttribute("aria-label"), "Volume");
  click(nextBtn(s));
  assertEquals(input.value, "51");
  const notRange = el(doc, "input", { type: "number" }) as FInput;
  assertEquals(upgradeRange(asInput(notRange)), null);
});

Deno.test("upgradeNumber: open ends, decimals, programmatic writes", () => {
  const doc = new FDoc();
  const input = el(doc, "input", {
    id: "creator-height",
    type: "number",
    step: "0.01",
    value: "1.75",
  }) as FInput;
  const label = el(doc, "label", { class: "field" }, "Height ", input, " m");
  doc.body.appendChild(label);
  let changes = 0;
  input.addEventListener("change", () => changes++);
  const s = upgradeNumber(asInput(input))!;
  assertEquals(controlLabel(input as unknown as Element), "Height"); // text BEFORE the control
  assertEquals([real(s).getAttribute("aria-valuemin"), real(s).getAttribute("aria-valuemax")], [
    null,
    null,
  ]);
  assertEquals(shown(s), "1.75");
  click(nextBtn(s));
  assertEquals([input.value, shown(s), changes], ["1.76", "1.76", 1]);
  key(s, "PageDown");
  assertEquals([input.value, changes], ["1.66", 2]);
  input.value = "2";
  assertEquals(shown(s), "2.00");
  input.valueAsNumber = 1.5;
  assertEquals(real(s).getAttribute("aria-valuenow"), "1.5");
  // an empty number input shows the empty mark; a step lands on the start
  const empty = el(doc, "input", { type: "number", min: "1", max: "999" }) as FInput;
  doc.body.appendChild(empty);
  const e = upgradeNumber(asInput(empty))!;
  assertEquals(shown(e), STEPPER_EMPTY_TEXT);
  click(nextBtn(e));
  assertEquals(empty.value, "1");
});

Deno.test("upgradeAll: upgrades each element once, honours skip and data-stepper=off", () => {
  const doc = new FDoc();
  const root = el(doc, "div", {});
  doc.body.appendChild(root);
  const add = () => {
    root.appendChild(el(doc, "select", {}, el(doc, "option", {}, "A"), el(doc, "option", {}, "B")));
    root.appendChild(el(doc, "input", { type: "range", min: "0", max: "10", value: "5" }));
    root.appendChild(el(doc, "input", { type: "number", value: "3" }));
    root.appendChild(el(doc, "input", { type: "text", value: "name" }));
    root.appendChild(el(doc, "select", { "data-stepper": "off" }, el(doc, "option", {}, "X")));
    root.appendChild(el(doc, "select", { id: "keep-native" }, el(doc, "option", {}, "Y")));
  };
  add();
  const skip = (e: Element) => e.id === "keep-native";
  const first = upgradeAll(root as unknown as ParentNode, { skip });
  assertEquals(first.length, 3);
  assertEquals(
    root.querySelectorAll("div").filter((d) => d.getAttribute("class") === "stepper").length,
    3,
  );
  assertEquals(upgradeAll(root as unknown as ParentNode, { skip }).length, 0); // idempotent
  add(); // a re-render added a second set
  const third = upgradeAll(root as unknown as ParentNode, { skip, numbers: false });
  assertEquals(third.length, 2);
  assertEquals(upgradeAll(root as unknown as ParentNode, { skip }).length, 1); // the number input left native last time
  assertEquals(
    root.querySelectorAll("div").filter((d) => d.getAttribute("class") === "stepper").length,
    6,
  );
  // per-element options and data-stepper-wrap
  const r2 = el(doc, "div", {});
  doc.body.appendChild(r2);
  const sel = el(
    doc,
    "select",
    { id: "w", "data-stepper-wrap": "" },
    el(doc, "option", {}, "A"),
    el(doc, "option", {}, "B"),
  ) as FSelect;
  r2.appendChild(sel);
  const [w] = upgradeAll(r2 as unknown as ParentNode, {
    optionsFor: (e) => (e.id === "w" ? { size: "compact" } : undefined),
  });
  assertEquals(real(w).getAttribute("class"), "stepper stepper-compact");
  click(nextBtn(w));
  click(nextBtn(w));
  assertEquals(sel.selectedIndex, 0); // wrapped
  // after destroy an element can be upgraded again
  w.destroy();
  assertEquals(upgradeAll(r2 as unknown as ParentNode).length, 1);
});

Deno.test("focus: the hidden native control forwards focus; a re-render hands focus back", () => {
  const doc = new FDoc();
  const root = el(doc, "div", {});
  doc.body.appendChild(root);
  const build = () => {
    root.textContent = ""; // the menu re-renders the screen
    const select = el(
      doc,
      "select",
      { id: "match-length" },
      el(doc, "option", {}, "Short"),
      el(doc, "option", {}, "Long"),
    ) as FSelect;
    root.appendChild(el(doc, "label", {}, "Match length", select));
    return select;
  };
  const first = build();
  const [s1] = upgradeAll(root as unknown as ParentNode);
  first.focus(); // e.g. a focus trap's order[i].focus()
  assert(doc.activeElement === real(s1), "focus forwarded to the stepper");
  // a change listener rebuilds the screen: focus falls to <body> ...
  first.addEventListener("change", () => {
    build();
    upgradeAll(root as unknown as ParentNode);
  });
  key(s1, "ArrowRight");
  const sel2 = root.querySelectorAll("select")[0];
  const s2 = stepperFor(sel2 as unknown as Element)!;
  assert(s2 && s2 !== s1, "a new stepper for the new select");
  assert(doc.activeElement === real(s2), "... and the new stepper for the same id gets it back");
  // not stolen when focus is elsewhere
  const other = el(doc, "button", {});
  doc.body.appendChild(other);
  other.focus();
  build();
  upgradeAll(root as unknown as ParentNode);
  assert(doc.activeElement === other, "focus elsewhere is left alone");
  assert(Object.prototype.hasOwnProperty.call(sel2, "focus"), "forwarding installed");
  s2.destroy();
  assert(
    !Object.prototype.hasOwnProperty.call(sel2, "focus"),
    "destroy removes the focus forwarding",
  );
});

Deno.test("autoUpgrade: every re-render is upgraded after the observer's microtask; stop() ends it", async () => {
  const doc = new FDoc();
  const root = el(doc, "div", {});
  doc.body.appendChild(root);
  root.appendChild(el(doc, "select", { id: "a" }, el(doc, "option", {}, "A")));
  const stop = autoUpgrade(root as unknown as Element);
  const count = () =>
    root.querySelectorAll("div").filter((d) =>
      (d.getAttribute("class") ?? "").startsWith("stepper")
    ).length;
  assertEquals(count(), 1); // synchronous first pass
  root.textContent = "";
  root.appendChild(
    el(doc, "label", {}, "B", el(doc, "select", { id: "b" }, el(doc, "option", {}, "B"))),
  );
  root.appendChild(el(doc, "input", { type: "range", value: "3" }));
  assertEquals(count(), 0);
  await tick();
  assertEquals(count(), 2);
  stop();
  root.appendChild(el(doc, "select", {}, el(doc, "option", {}, "C")));
  await tick();
  assertEquals(count(), 2);
});
