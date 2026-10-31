// The cast bar for the HUD: a DOM layer over Cast.ts's pure view model (Wave N, lane N-D).
//
// WHY this file exists: a channel needs a readable bar — how far the cast has got, how much of it
// is pushback delay, and whether it ended (done) or was cut (interrupted). The MODEL lives in
// src/game/Cast.ts (castBarView, unit-tested in Deno); this file only paints it, following
// src/ui/FighterPanel.ts's house style: build the elements once, then patch widths, the state
// attribute and the label in place, and only when the shown values changed (no innerHTML per tick).
//
// Widths go through CSSOM (element.style.width), NEVER an inline style="" attribute — the page runs
// under `style-src 'self'` (CSP), which blocks style attributes and once blanked the History bars.
// The bar sets nothing through setAttribute("style"): only element.style.* and class/data.

import { castBarView, type CastState } from "../game/Cast.ts";

/**
 * Every class name the bar writes, so the parent's stylesheet and its screenshots can target them:
 *   .cast-bar            the root (carries data-state="cast" | "interrupted" | "done")
 *   .cb-label            the text (the power's id and nominal channel length)
 *   .cb-track            the rail (role="progressbar" — the aria host)
 *   .cb-pushback         the delay segment behind the fill (red, leading share of the track)
 *   .cb-fill             the progress fill (grows left to right)
 */
export const CAST_BAR_CLASSES = {
  root: "cast-bar",
  label: "cb-label",
  track: "cb-track",
  pushback: "cb-pushback",
  fill: "cb-fill",
} as const;

function make(tag: string, cls: string, parent: HTMLElement): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

export class CastBar {
  readonly root: HTMLDivElement;
  readonly #label: HTMLSpanElement;
  readonly #track: HTMLDivElement;
  readonly #pushback: HTMLDivElement;
  readonly #fill: HTMLDivElement;
  /** Last rendered key, so an unchanged frame writes nothing. */
  #last = "";

  constructor(parent: HTMLElement, id = "cast-bar") {
    this.root = make("div", CAST_BAR_CLASSES.root, parent) as HTMLDivElement;
    this.root.id = id;
    this.#label = make("span", CAST_BAR_CLASSES.label, this.root) as HTMLSpanElement;
    this.#track = make("div", CAST_BAR_CLASSES.track, this.root) as HTMLDivElement;
    this.#track.setAttribute("role", "progressbar");
    this.#track.setAttribute("aria-label", "cast");
    // The delay segment sits behind the fill: the part of the track the cast has been pushed back by.
    this.#pushback = make("div", CAST_BAR_CLASSES.pushback, this.#track) as HTMLDivElement;
    this.#fill = make("div", CAST_BAR_CLASSES.fill, this.#track) as HTMLDivElement;
    this.#apply(castBarView({ spec: { skillId: "", seconds: 1, interruptible: true, breakOnMove: false }, elapsedS: 0, pushbackS: 0, done: false, interruptedBy: null }));
  }

  /** Paint one frame of `s`. No-op when nothing the bar shows changed. */
  update(s: CastState): void {
    const v = castBarView(s);
    const key = `${v.state}|${v.fraction.toFixed(4)}|${v.pushbackFraction.toFixed(4)}|${v.label}`;
    if (key === this.#last) return;
    this.#last = key;
    this.#apply(v);
  }

  #apply(v: ReturnType<typeof castBarView>): void {
    this.root.dataset.state = v.state;
    this.#label.textContent = v.label;
    this.#fill.style.width = `${(v.fraction * 100).toFixed(2)}%`;
    this.#pushback.style.width = `${(v.pushbackFraction * 100).toFixed(2)}%`;
    this.#track.setAttribute("aria-valuenow", String(Math.round(v.fraction * 100)));
    this.#track.setAttribute("aria-valuetext", `${v.label} (${v.state})`);
  }

  /** Plain text of the bar (for logs and probes). */
  text(): string {
    return `${this.#label.textContent} [${this.root.dataset.state ?? "cast"}]`;
  }
}
