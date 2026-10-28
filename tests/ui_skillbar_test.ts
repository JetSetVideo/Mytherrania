// SkillBar must build its chips once and then patch only what changed. These tests run it on a
// minimal fake DOM (deno-dom is not a dependency) that logs every mutation with its target, so
// "zero writes" and "writes only that chip" are measured, not assumed.
import { cooldownText, SkillBar, type SkillView, sweepFraction } from "../src/ui/SkillBar.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}

// ---------------------------------------------------------------- fake DOM

interface Write { op: string; target: FakeNode }

class FakeDoc {
  writes: Write[] = [];
  documentElement = { clientHeight: 800 };
  log(op: string, target: FakeNode) { this.writes.push({ op, target }); }
  createElement(tag: string): FakeElement { return new FakeElement(this, tag.toUpperCase()); }
  createTextNode(value: string): FakeText { return new FakeText(this, value); }
}

class FakeNode {
  parentNode: FakeElement | null = null;
  childNodes: FakeNode[] = [];
  constructor(readonly ownerDocument: FakeDoc) {}
  get firstChild(): FakeNode | null { return this.childNodes[0] ?? null; }
  appendChild(child: FakeNode): FakeNode {
    this.ownerDocument.log("appendChild", this);
    child.parentNode?.childNodes.splice(child.parentNode.childNodes.indexOf(child), 1);
    child.parentNode = this as unknown as FakeElement;
    this.childNodes.push(child);
    return child;
  }
  removeChild(child: FakeNode): FakeNode {
    this.ownerDocument.log("removeChild", this);
    const i = this.childNodes.indexOf(child);
    if (i < 0) throw new Error("removeChild: not a child");
    this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }
}

class FakeText extends FakeNode {
  #value: string;
  constructor(doc: FakeDoc, value: string) { super(doc); this.#value = value; }
  get nodeValue(): string { return this.#value; }
  set nodeValue(v: string) { this.ownerDocument.log("nodeValue", this); this.#value = v; }
  get textContent(): string { return this.#value; }
}

class FakeClassList {
  #set = new Set<string>();
  constructor(readonly owner: FakeElement) {}
  contains(c: string) { return this.#set.has(c); }
  add(c: string) { this.owner.ownerDocument.log("classList.add", this.owner); this.#set.add(c); }
  remove(c: string) { this.owner.ownerDocument.log("classList.remove", this.owner); this.#set.delete(c); }
  toggle(c: string, force?: boolean): boolean {
    // Every toggle call counts as a write, even a no-op: SkillBar must not call it needlessly.
    this.owner.ownerDocument.log("classList.toggle", this.owner);
    const on = force ?? !this.#set.has(c);
    if (on) this.#set.add(c); else this.#set.delete(c);
    return on;
  }
  setAll(value: string) { this.#set = new Set(value.split(/\s+/).filter(Boolean)); }
  toString() { return [...this.#set].join(" "); }
}

class FakeStyle {
  #props = new Map<string, string>();
  constructor(readonly owner: FakeElement) {}
  setProperty(name: string, value: string) { this.owner.ownerDocument.log("style.setProperty", this.owner); this.#props.set(name, value); }
  removeProperty(name: string) { this.owner.ownerDocument.log("style.removeProperty", this.owner); this.#props.delete(name); return ""; }
  getPropertyValue(name: string) { return this.#props.get(name) ?? ""; }
}

class FakeElement extends FakeNode {
  attributes = new Map<string, string>();
  listeners = new Map<string, ((e: unknown) => void)[]>();
  classList = new FakeClassList(this);
  style = new FakeStyle(this);
  #html = "";
  constructor(doc: FakeDoc, readonly tagName: string) { super(doc); }
  get className() { return this.classList.toString(); }
  set className(v: string) { this.ownerDocument.log("className", this); this.classList.setAll(v); }
  setAttribute(name: string, value: string) { this.ownerDocument.log(`setAttribute:${name}`, this); this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  addEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  /** Fire `type` with a minimal event; returns whether preventDefault/stopPropagation ran. */
  dispatch(type: string) {
    const flags = { prevented: false, stopped: false };
    const event = { preventDefault: () => { flags.prevented = true; }, stopPropagation: () => { flags.stopped = true; } };
    for (const fn of this.listeners.get(type) ?? []) fn(event);
    return flags;
  }
  get innerHTML() { return this.#html; }
  set innerHTML(v: string) { this.ownerDocument.log("innerHTML", this); this.#html = v; this.childNodes = []; }
  set textContent(v: string) { this.ownerDocument.log("textContent", this); this.childNodes = [new FakeText(this.ownerDocument, v)]; }
  get textContent(): string {
    return this.childNodes.map((c) => (c as FakeElement | FakeText).textContent).join("");
  }
  query(cls: string): FakeElement | null {
    for (const c of this.childNodes) {
      if (c instanceof FakeElement) {
        if (c.classList.contains(cls)) return c;
        const deep = c.query(cls);
        if (deep) return deep;
      }
    }
    return null;
  }
  getBoundingClientRect() { return { top: 0, height: 0, left: 0, width: 0, bottom: 0, right: 0 }; }
}

/** True when `node` is `ancestor` or sits inside it. */
function inside(node: FakeNode, ancestor: FakeNode): boolean {
  for (let n: FakeNode | null = node; n; n = n.parentNode) if (n === ancestor) return true;
  return false;
}

function setup(onActivate?: (index: number) => void) {
  const doc = new FakeDoc();
  const container = doc.createElement("div");
  const bar = new SkillBar(container as unknown as HTMLElement, { onActivate });
  return { doc, container, bar };
}

const views = (): SkillView[] => [
  { name: "Ember Lunge", kind: "dash", keyLabel: "1", altKeyLabel: "A", cooldown: 0, cooldownMax: 4, ready: true, active: false },
  { name: "Cinder Smash", kind: "power", keyLabel: "2", altKeyLabel: "E", cooldown: 2.5, cooldownMax: 6, ready: false, active: false },
  { name: "Ash Guard", kind: "defense", keyLabel: "3", altKeyLabel: "F", cooldown: 0, cooldownMax: 8, ready: true, active: false },
];

// ---------------------------------------------------------------- tests

Deno.test("skillbar: the first update builds one chip per skill with key, name, kind, cooldown", () => {
  const { container, bar } = setup();
  bar.update(views());
  assert(bar.size === 3, `size ${bar.size}`);
  assert(container.childNodes.length === 3, "three chips in the container");
  const chip = container.childNodes[1] as FakeElement;
  assert(chip.classList.contains("skill-chip"), "chip class");
  assert(chip.query("skill-key")!.textContent === "2", "digit badge");
  assert(chip.query("skill-alt")!.textContent === "E", "layout alt badge");
  assert(chip.query("skill-name")!.textContent === "Cinder Smash", "name");
  assert(chip.query("skill-kind")!.textContent === "Power", "kind label");
  assert(chip.query("skill-cd")!.textContent === "2.5s", "cooldown text");
  assert(chip.style.getPropertyValue("--cd") === "0.42", `sweep ${chip.style.getPropertyValue("--cd")}`);
  assert(chip.classList.contains("cooling") && !chip.classList.contains("ready"), "cooling state");
  assert(chip.getAttribute("data-kind") === "power", "data-kind");
  assert(chip.query("skill-icon")!.innerHTML.includes("icon-power"), "kind icon drawn when there is no art");
  const first = container.childNodes[0] as FakeElement;
  assert(first.classList.contains("ready") && !first.classList.contains("cooling"), "ready state");
});

Deno.test("skillbar: update() with identical data performs ZERO DOM writes", () => {
  const { doc, bar } = setup();
  bar.update(views());
  doc.writes = [];
  for (let i = 0; i < 1000; i++) bar.update(views());
  assert(doc.writes.length === 0, `expected 0 writes, got ${doc.writes.length}: ${doc.writes.slice(0, 5).map((w) => w.op).join(", ")}`);
});

Deno.test("skillbar: a cooldown change writes only that chip (text + sweep), nothing else", () => {
  const { doc, container, bar } = setup();
  bar.update(views());
  doc.writes = [];
  const next = views();
  next[1].cooldown = 2.0;
  bar.update(next);
  const chip = container.childNodes[1] as FakeElement;
  assert(doc.writes.length > 0, "the change was written");
  for (const w of doc.writes) assert(inside(w.target, chip), `write ${w.op} escaped chip 2`);
  const ops = doc.writes.map((w) => w.op).sort();
  assert(JSON.stringify(ops) === JSON.stringify(["nodeValue", "style.setProperty"]), `ops ${ops.join(",")}`);
  assert(chip.query("skill-cd")!.textContent === "2.0s", "new cooldown text");
  assert(chip.style.getPropertyValue("--cd") === "0.33", "new sweep");
});

Deno.test("skillbar: recharging flips the state classes once, then goes quiet", () => {
  const { doc, container, bar } = setup();
  bar.update(views());
  const next = views();
  next[1].cooldown = 0;
  next[1].ready = true;
  doc.writes = [];
  bar.update(next);
  const chip = container.childNodes[1] as FakeElement;
  for (const w of doc.writes) assert(inside(w.target, chip), `write ${w.op} escaped chip 2`);
  assert(chip.classList.contains("ready") && !chip.classList.contains("cooling"), "ready, not cooling");
  assert(chip.query("skill-cd")!.textContent === "", "no cooldown text when ready");
  assert(chip.style.getPropertyValue("--cd") === "0", "sweep empty");
  doc.writes = [];
  bar.update(next);
  assert(doc.writes.length === 0, "second identical update is silent");
});

Deno.test("skillbar: key labels come from the caller (AZERTY A vs QWERTY Q), not hard-coded", () => {
  const { container, bar } = setup();
  const azerty = views();
  bar.update(azerty);
  assert((container.childNodes[0] as FakeElement).query("skill-alt")!.textContent === "A", "AZERTY alt");
  const qwerty = views();
  qwerty[0].altKeyLabel = "Q";
  bar.update(qwerty);
  assert((container.childNodes[0] as FakeElement).query("skill-alt")!.textContent === "Q", "QWERTY alt");
  const none = views();
  none[0].altKeyLabel = undefined;
  bar.update(none);
  const alt = (container.childNodes[0] as FakeElement).query("skill-alt")!;
  assert(alt.textContent === "" && alt.classList.contains("is-empty"), "missing alt label hides the badge");
});

Deno.test("skillbar: art replaces the kind icon, and the chip list grows and shrinks in place", () => {
  const { doc, container, bar } = setup();
  const withArt = views();
  withArt[0].art = "data:image/png;base64,AAAA";
  bar.update(withArt);
  const slot = (container.childNodes[0] as FakeElement).query("skill-icon")!;
  const img = slot.childNodes[0] as FakeElement;
  assert(img.tagName === "IMG" && img.getAttribute("src") === withArt[0].art, "art image drawn");
  const firstChip = container.childNodes[0];
  bar.update(withArt.slice(0, 2));
  const shrunk: number = bar.size;
  assert(shrunk === 2 && container.childNodes.length === 2, "shrinks to two chips");
  assert(container.childNodes[0] === firstChip, "surviving chips are reused, not rebuilt");
  doc.writes = [];
  bar.update(withArt);
  const grown: number = bar.size;
  assert(grown === 3, "grows back to three");
  for (const w of doc.writes) assert(inside(w.target, container), "writes stay in the bar");
});

Deno.test("skillbar: legacy markup in the container is cleared once on first build", () => {
  const { doc, container, bar } = setup();
  container.appendChild(doc.createTextNode("old innerHTML chips"));
  bar.update(views());
  assert(container.childNodes.length === 3, "only the three chips remain");
});

Deno.test("skillbar: cooldown text and sweep helpers", () => {
  assert(cooldownText(0) === "" && cooldownText(-1) === "", "ready shows no text");
  assert(cooldownText(2.345) === "2.3s", cooldownText(2.345));
  assert(sweepFraction(0, 5) === "0", "no cooldown, no sweep");
  assert(sweepFraction(5, 5) === "1", "full sweep");
  assert(sweepFraction(9, 5) === "1", "clamped above");
  assert(sweepFraction(1, 0) === "0", "no max, no sweep (no division by zero)");
  assert(sweepFraction(1, 3) === "0.33", sweepFraction(1, 3));
});

Deno.test("skillbar: with onActivate, pressing a chip fires its slot index (mouse-only play)", () => {
  const fired: number[] = [];
  const { doc, container, bar } = setup((i) => fired.push(i));
  bar.update(views());
  const chip = container.childNodes[2] as FakeElement;
  assert(chip.classList.contains("clickable") && chip.getAttribute("role") === "button", "clickable chip");
  doc.writes = [];
  const flags = chip.dispatch("pointerdown");
  assert(JSON.stringify(fired) === "[2]", `fired ${JSON.stringify(fired)}`);
  assert(flags.prevented && flags.stopped, "the press does not reach the canvas or take focus");
  assert(doc.writes.length === 0, "pressing writes nothing by itself");
});

Deno.test("skillbar: without onActivate the bar is display-only", () => {
  const { container, bar } = setup();
  bar.update(views());
  const chip = container.childNodes[0] as FakeElement;
  assert(!chip.classList.contains("clickable") && chip.getAttribute("role") === null, "not clickable");
  assert((chip.listeners.get("pointerdown") ?? []).length === 0, "no listener");
});
