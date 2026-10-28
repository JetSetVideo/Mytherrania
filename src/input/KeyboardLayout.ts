// Keyboard layout detection and key labelling.
//
// Gameplay binds keys by PHYSICAL POSITION (KeyboardEvent.code), so the same four keys
// under the left hand move the player on every layout: QWERTY "WASD", AZERTY "ZQSD",
// QWERTZ "WASD". What changes per layout is only the LABEL printed on those keys, which
// is what the HUD must show. This module works out the layout and names keys for it.
//
// Evidence, strongest first:
//   1. A real key press: `code` says where the key is, `key` says what it types. Code
//      KeyQ typing "a" can only be AZERTY; code KeyY typing "z" can only be QWERTZ.
//   2. The Keyboard Map API (`navigator.keyboard.getLayoutMap()`, Chromium only; Safari
//      and Firefox do not implement it).
//   3. The UI language (`navigator.language`): fr / fr-BE -> AZERTY, de / de-CH / cs -> QWERTZ.
//      A guess only: a French speaker may well type on QWERTY. Overridden by 1 or 2.
// Pure module apart from `detectFromBrowser`, which reads navigator defensively.

/** The layout families that change the movement/skill key labels. */
export type Layout = "qwerty" | "azerty" | "qwertz";

/** How sure the detector is: a typed key beats the OS map, which beats the language guess. */
export type Evidence = "default" | "language" | "layoutMap" | "keypress";

const EVIDENCE_RANK: Record<Evidence, number> = { default: 0, language: 1, layoutMap: 2, keypress: 3 };

/**
 * The letter each layout prints on a physical code, for the codes whose letters differ
 * between QWERTY, AZERTY and QWERTZ. Codes not listed print the same letter on all three.
 */
const LETTERS: Record<Layout, Record<string, string>> = {
  qwerty: { KeyQ: "Q", KeyW: "W", KeyA: "A", KeyZ: "Z", KeyY: "Y", KeyM: "M", Semicolon: ";" },
  azerty: { KeyQ: "A", KeyW: "Z", KeyA: "Q", KeyZ: "W", KeyY: "Y", KeyM: ",", Semicolon: "M" },
  qwertz: { KeyQ: "Q", KeyW: "W", KeyA: "A", KeyZ: "Y", KeyY: "Z", KeyM: "M", Semicolon: "Ö" },
};

/**
 * The layout a single key press proves, or null when that press is the same on every
 * layout (e.g. KeyD types "d" everywhere). `key` is KeyboardEvent.key, case-insensitive.
 */
export function layoutFromKeypress(code: string, key: string): Layout | null {
  const typed = key.toLowerCase();
  if (typed.length !== 1) return null; // "Shift", "Enter", dead keys…
  for (const layout of ["azerty", "qwertz", "qwerty"] as const) {
    const letter = LETTERS[layout][code];
    if (letter === undefined) continue;
    // A code whose letter is identical on two layouts cannot distinguish them.
    const ambiguous = (["azerty", "qwertz", "qwerty"] as const).some((other) =>
      other !== layout && LETTERS[other][code]?.toLowerCase() === typed
    );
    if (letter.toLowerCase() === typed && !ambiguous) return layout;
  }
  return null;
}

/** Layout implied by a Keyboard Map (code -> printed character), or null when inconclusive. */
export function layoutFromMap(map: { get(code: string): string | undefined }): Layout | null {
  for (const code of ["KeyQ", "KeyW", "KeyY", "KeyZ"]) {
    const printed = map.get(code);
    if (printed) {
      const layout = layoutFromKeypress(code, printed);
      if (layout) return layout;
    }
  }
  return null;
}

/** Best guess from a BCP-47 language tag. Belgian and French French default to AZERTY. */
export function layoutFromLanguage(lang: string | undefined): Layout {
  const tag = (lang ?? "").toLowerCase();
  if (/^fr(-(fr|be|lu|mc))?$/.test(tag) || tag === "fr") return "azerty";
  if (/^(de|cs|sk|hu|sl|hr)(-|$)/.test(tag) && tag !== "de-ch-qwerty") return "qwertz";
  return "qwerty";
}

/** The printed label of a physical key on `layout` ("KeyW" -> "Z" on AZERTY). */
export function keyLabel(code: string, layout: Layout): string {
  const letter = LETTERS[layout][code];
  if (letter) return letter;
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return code.slice(6);
  const named: Record<string, string> = {
    Space: "Space", Escape: "Esc", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  };
  return named[code] ?? code;
}

/** The four movement keys as the player sees them: "ZQSD" on AZERTY, "WASD" elsewhere. */
export function movementLabel(layout: Layout): string {
  return ["KeyW", "KeyA", "KeyS", "KeyD"].map((c) => keyLabel(c, layout)).join("");
}

/**
 * Tracks the most credible layout seen so far. A weaker kind of evidence never overrides
 * a stronger one, so a QWERTY guess from the language cannot undo an AZERTY key press.
 * `onChange` fires only when the layout actually changes (so labels re-render once).
 */
export class LayoutDetector {
  layout: Layout = "qwerty";
  evidence: Evidence = "default";
  #listeners: ((layout: Layout) => void)[] = [];

  /** Offer evidence; returns true when it changed the layout. */
  offer(layout: Layout | null, evidence: Evidence): boolean {
    if (!layout || EVIDENCE_RANK[evidence] < EVIDENCE_RANK[this.evidence]) return false;
    const changed = layout !== this.layout;
    this.layout = layout;
    this.evidence = evidence;
    if (changed) for (const fn of this.#listeners) fn(layout);
    return changed;
  }

  /** Feed a keydown; cheap enough to call on every key press. */
  observe(code: string, key: string): boolean {
    return this.offer(layoutFromKeypress(code, key), "keypress");
  }

  onChange(fn: (layout: Layout) => void): void {
    this.#listeners.push(fn);
  }
}

/**
 * Seed a detector from the browser: the language guess immediately, then the Keyboard
 * Map when the browser has one (async; Chromium only). Never throws.
 */
export function detectFromBrowser(detector: LayoutDetector): void {
  const nav = (globalThis as {
    navigator?: { language?: string; keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } };
  }).navigator;
  detector.offer(layoutFromLanguage(nav?.language), "language");
  const getMap = nav?.keyboard?.getLayoutMap;
  if (typeof getMap === "function") {
    getMap.call(nav!.keyboard).then((map) => detector.offer(layoutFromMap(map), "layoutMap")).catch(() => {});
  }
}
