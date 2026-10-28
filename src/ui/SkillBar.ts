/**
 * SkillBar — the in-fight row of skill chips (powers), built once and then patched.
 *
 * Vocabulary:
 * - **chip**: one skill's tile: an icon (the skill art when there is one, else the kind's line
 *   icon), a key badge (the digit plus the layout's alternative key), the name, the kind, the
 *   cooldown text and a **sweep** (a shade that covers the chip in proportion to the cooldown
 *   left and drains downward as it recharges).
 * - **cooldown** (s): time left before the skill can fire again; 0 means recharged.
 * - **cooldownMax** (s): the skill's full cooldown; the sweep fraction is cooldown / cooldownMax.
 * - **ready**: the skill can fire now. **active**: the skill is executing now.
 * - **DOM write**: any mutation of the document (text, attribute, class, CSS property, child).
 *
 * Cost model: the first `update` builds the chips; every later call compares each field with
 * the value it last wrote and writes only the difference, so an `update` with unchanged data
 * performs zero DOM writes, and a cooldown tick writes only the ticking chip's cooldown text and
 * its `--cd` property. Nothing uses `innerHTML` per tick (the icon slot is re-drawn only when the
 * kind or the art changes). CSP-safe: dynamic values go through `style.setProperty("--cd", v)`.
 */
import { skillKindIcon } from "./Icons.ts";

/** One skill as the bar should show it. All times in seconds. */
export interface SkillView {
  /** Display name, e.g. "Ember Lunge". */
  name: string;
  /** Skill kind: "dash" | "power" | "defense" (unknown kinds draw the power icon). */
  kind: string;
  /** Primary key label, layout-independent: "1", "2", "3". */
  keyLabel: string;
  /** Alternative key label from the detected keyboard layout ("A"/"E"/"F" on AZERTY, "Q"/"E"/"F" on QWERTY); "" or absent hides it. */
  altKeyLabel?: string;
  /** Seconds of cooldown left (0 = recharged). */
  cooldown: number;
  /** The skill's full cooldown in seconds (> 0); used to normalise the sweep. */
  cooldownMax: number;
  /** True when the skill can fire now. */
  ready: boolean;
  /** True while the skill executes. */
  active: boolean;
  /** Optional art image URL (data: URLs are allowed by the CSP's img-src). */
  art?: string;
}

/**
 * Sweep resolution: the `--cd` fraction is rounded to 1 / SWEEP_STEPS, so a 4 Hz HUD tick on a
 * 6 s cooldown still writes (6 s x 4 Hz = 24 distinct values < 100 steps) but sub-step jitter
 * does not. 100 steps is finer than a chip's ~50 px height can show.
 */
export const SWEEP_STEPS = 100;

/** Cooldown text: one decimal of a second, e.g. "2.4s"; "" when recharged. */
export function cooldownText(cooldown: number): string {
  return cooldown > 0 ? `${cooldown.toFixed(1)}s` : "";
}

/**
 * Sweep fraction in [0, 1] = cooldown / cooldownMax, clamped and quantised to 1 / SWEEP_STEPS;
 * returned as the string written to `--cd` so equal fractions compare equal.
 */
export function sweepFraction(cooldown: number, cooldownMax: number): string {
  if (!(cooldownMax > 0) || !(cooldown > 0)) return "0";
  const f = Math.min(1, cooldown / cooldownMax);
  return String(Math.round(f * SWEEP_STEPS) / SWEEP_STEPS);
}

/** Human label for a kind: "dash" -> "Dash". */
function kindLabel(kind: string): string {
  return kind ? kind[0].toUpperCase() + kind.slice(1) : "";
}

/** The DOM handles of one chip plus the values last written to it. */
interface Chip {
  el: HTMLElement;
  iconSlot: HTMLElement;
  key: Text;
  altBadge: HTMLElement;
  alt: Text;
  name: Text;
  kind: Text;
  cd: Text;
  // Last written values (undefined = never written).
  last: {
    name?: string; kind?: string; art?: string; key?: string; alt?: string;
    cdText?: string; sweep?: string; ready?: boolean; active?: boolean; cooling?: boolean;
  };
}

/** Construction options for {@link SkillBar}. */
export interface SkillBarOptions {
  /**
   * Called with the chip's index (0-based skill slot) when the player presses a chip with the
   * mouse/finger. When given, chips become clickable (class `clickable`, role `button`) so the
   * skills are usable without a keyboard; omit it for a display-only bar.
   */
  onActivate?: (index: number) => void;
}

/** Builds and patches the skill chips inside `container` (the HUD's `#hud-skills`). */
export class SkillBar {
  readonly #container: HTMLElement;
  readonly #doc: Document;
  readonly #onActivate: ((index: number) => void) | null;
  readonly #chips: Chip[] = [];
  #dockObserver: ResizeObserver | null = null;
  #dockReserve = "";

  /**
   * `container` receives the chips (it keeps its own id/classes). Any legacy children it still
   * holds are removed once, at the first non-empty update.
   */
  constructor(container: HTMLElement, options: SkillBarOptions = {}) {
    this.#container = container;
    this.#doc = container.ownerDocument;
    this.#onActivate = options.onActivate ?? null;
  }

  /** Number of chips currently built. */
  get size(): number { return this.#chips.length; }

  /**
   * Show `skills`, writing only what changed since the last call. Chips are created when the
   * list grows and removed when it shrinks; otherwise the same elements are reused.
   */
  update(skills: readonly SkillView[]): void {
    if (this.#chips.length === 0 && skills.length > 0 && this.#container.firstChild) {
      // First build over a container that still holds legacy markup: clear it once.
      while (this.#container.firstChild) this.#container.removeChild(this.#container.firstChild);
    }
    while (this.#chips.length < skills.length) this.#chips.push(this.#buildChip(this.#chips.length));
    while (this.#chips.length > skills.length) {
      const chip = this.#chips.pop()!;
      this.#container.removeChild(chip.el);
    }
    for (let i = 0; i < skills.length; i++) this.#patch(this.#chips[i], skills[i]);
  }

  /**
   * Keep the bar docked just above `anchor` (the controls hint line `#hints`), whose height
   * changes with the viewport width and the keyboard-layout text. Writes the reserved distance
   * from the viewport bottom, in px, to the container's `--skillbar-bottom` property:
   *   reserve = viewportHeight - anchorTop + gapPx.
   * A hidden anchor (zero height) leaves the stylesheet's default in force.
   */
  dockAbove(anchor: HTMLElement, gapPx = 8): void {
    const measure = () => {
      const rect = anchor.getBoundingClientRect();
      const viewport = globalThis.innerHeight || this.#doc.documentElement.clientHeight;
      const reserve = rect.height > 0 && viewport > 0 ? `${Math.round(viewport - rect.top + gapPx)}px` : "";
      if (reserve === this.#dockReserve) return;
      this.#dockReserve = reserve;
      if (reserve) this.#container.style.setProperty("--skillbar-bottom", reserve);
      else this.#container.style.removeProperty("--skillbar-bottom");
    };
    this.#dockObserver?.disconnect();
    const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (RO) {
      this.#dockObserver = new RO(measure);
      this.#dockObserver.observe(anchor);
    }
    measure();
  }

  /** Stop observing the dock anchor (the chips stay). */
  dispose(): void {
    this.#dockObserver?.disconnect();
    this.#dockObserver = null;
  }

  #el(tag: string, cls: string, parent: Node): HTMLElement {
    const el = this.#doc.createElement(tag);
    el.className = cls;
    parent.appendChild(el);
    return el;
  }

  #text(parent: Node): Text {
    const t = this.#doc.createTextNode("");
    parent.appendChild(t);
    return t;
  }

  /** Create the chip for skill slot `index` (once) and append it to the container. */
  #buildChip(index: number): Chip {
    const el = this.#doc.createElement("div");
    el.className = this.#onActivate ? "skill-chip clickable" : "skill-chip";
    const onActivate = this.#onActivate;
    if (onActivate) {
      el.setAttribute("role", "button");
      // pointerdown (not click): fires on the press like the keyboard binding does, and
      // preventDefault keeps focus and text selection off the chip.
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onActivate(index);
      });
    }
    this.#el("span", "skill-sweep", el).setAttribute("aria-hidden", "true");
    const iconSlot = this.#el("span", "skill-icon", el);
    const keys = this.#el("span", "skill-keys", el);
    const key = this.#text(this.#el("b", "skill-key", keys));
    const altBadge = this.#el("b", "skill-alt", keys);
    const alt = this.#text(altBadge);
    const text = this.#el("span", "skill-text", el);
    const name = this.#text(this.#el("span", "skill-name", text));
    const kind = this.#text(this.#el("span", "skill-kind", text));
    const cd = this.#text(this.#el("span", "skill-cd", el));
    this.#container.appendChild(el);
    return { el, iconSlot, key, altBadge, alt, name, kind, cd, last: {} };
  }

  /** Write the fields of `v` that differ from what `chip` last showed. */
  #patch(chip: Chip, v: SkillView): void {
    const last = chip.last;
    if (last.name !== v.name) {
      chip.name.nodeValue = v.name;
      chip.el.setAttribute("title", v.name); // full name on hover when the chip truncates it
      last.name = v.name;
    }
    const art = v.art ?? "";
    if (last.kind !== v.kind) {
      chip.kind.nodeValue = kindLabel(v.kind);
      chip.el.setAttribute("data-kind", v.kind);
    }
    if (last.kind !== v.kind || last.art !== art) {
      this.#drawIcon(chip, v.kind, art, v.name);
      last.kind = v.kind;
      last.art = art;
    }
    if (last.key !== v.keyLabel) {
      chip.key.nodeValue = v.keyLabel;
      last.key = v.keyLabel;
    }
    const altLabel = v.altKeyLabel ?? "";
    if (last.alt !== altLabel) {
      chip.alt.nodeValue = altLabel;
      chip.altBadge.classList.toggle("is-empty", altLabel === "");
      last.alt = altLabel;
    }
    const cdText = cooldownText(v.cooldown);
    if (last.cdText !== cdText) {
      chip.cd.nodeValue = cdText;
      last.cdText = cdText;
    }
    const sweep = sweepFraction(v.cooldown, v.cooldownMax);
    if (last.sweep !== sweep) {
      chip.el.style.setProperty("--cd", sweep);
      last.sweep = sweep;
    }
    const cooling = v.cooldown > 0;
    if (last.cooling !== cooling) {
      chip.el.classList.toggle("cooling", cooling);
      last.cooling = cooling;
    }
    if (last.ready !== v.ready) {
      chip.el.classList.toggle("ready", v.ready);
      last.ready = v.ready;
    }
    if (last.active !== v.active) {
      chip.el.classList.toggle("active", v.active);
      last.active = v.active;
    }
  }

  /** Fill the icon slot: the art image when given, else the kind's white line icon. */
  #drawIcon(chip: Chip, kind: string, art: string, name: string): void {
    const slot = chip.iconSlot;
    while (slot.firstChild) slot.removeChild(slot.firstChild);
    if (art) {
      const img = this.#doc.createElement("img");
      img.className = "skill-art";
      img.setAttribute("alt", name);
      img.setAttribute("src", art);
      slot.appendChild(img);
    } else {
      slot.innerHTML = skillKindIcon(kind);
    }
  }
}
