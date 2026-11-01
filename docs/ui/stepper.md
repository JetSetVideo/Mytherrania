# Stepper — the ‹ value › control

The player asked to change values with **left / right** instead of dropdowns. `src/ui/Stepper.ts`
gives every `<select>`, `<input type="range">` and `<input type="number">` a
**‹ value ›** stepper, and leaves the native element in the DOM, hidden, as the **source of
truth**. Existing logic keeps working unchanged: `select.value` reads, `change`/`input` listeners
and programmatic `el.value = x` writes all behave as before.

Files: `src/ui/Stepper.ts` (module), `tests/stepper_test.ts` (33 tests), `docs/ui/stepper.css`
(the CSS block to paste into `styles.css`), this note.

## Integration (the parent's lines)

1. **CSS**: paste `docs/ui/stepper.css` at the end of `styles.css`, and set the theme on `:root`
   (or the menu container). The block has fallbacks for all of them:

   ```css
   :root { --ui-metal: #8e949b; --ui-ink: #2a2017; --ui-parchment: #e9dcbd; --ui-accent: #d9a441; }
   ```

2. **Menu.ts**: one call, once the root exists. It upgrades now and after every re-render
   (a MutationObserver on the root; its callback runs before the next paint, so a rebuilt screen
   never shows a native dropdown):

   ```ts
   import { autoUpgrade } from "./Stepper.ts";
   // in the constructor / mount, after this.#root is created:
   autoUpgrade(this.#root);
   ```

   To keep a control native: put `data-stepper="off"` on it in the HTML string, or pass
   `autoUpgrade(this.#root, { skip: (el) => el.id === "creator-attr-strength" })`.
   If you prefer explicit calls, `upgradeAll(root)` after each `innerHTML =` does the same
   (idempotent: only new elements are upgraded).

3. **SettingsPanel.ts**: the same call on the dialog, plus ONE line in the Tab focus trap,
   because the trap lists the native controls, which are now hidden:

   ```ts
   import { autoUpgrade, stepperFor } from "./Stepper.ts";
   autoUpgrade(dlg);                       // after the dialog's rows are built
   // focusOrder():
   return this.#focusables
     .filter((f) => f.group === group && !(f.el as HTMLButtonElement).disabled)
     .map((f) => stepperFor(f.el)?.element ?? f.el);   // <- the added line
   ```

   (Without that line `order[i].focus()` still lands on the stepper — the hidden element
   forwards `focus()` — but `order.indexOf(e.target)` would not find it, so Tab would jump to
   the first control.)

4. Optional per-element hints in the HTML strings, no code needed:
   `data-stepper-wrap` (wrap last -> first), `data-sub="…"` on an `<option>` (small sub-label),
   `data-icon="flame"` on an `<option>` (an Icons.ts icon name, shown in the well).

## API

```ts
// --- pure model (no DOM) ---
stepIndex(n, index, delta, wrap = false): number          // -1 when n < 1; index -1 = "none selected"
stepEnabled(enabled: boolean[], index, delta, wrap): number // skips disabled options
stepperModel(options, index, wrap = false): { count, index, label, atStart, atEnd, canPrev, canNext }
stepNumber(value, min, max, step, delta, wrap = false): number // on the grid min + k*step, no drift
snapNumber(value, min, max, step): number
numberDomain(min, max, step) / numberModel(value, min, max, step, wrap)
toLabel(x, fallback)                     // the formatter hook's normaliser: string | number | {text, sub?, icon?}
keyAction(key, kind, pageSteps = 10)     // the keyboard map, as data
stepperView(state, wrap) / stepState(state, delta, wrap) / stepStateTo(state, "start" | "end")

// --- component ---
new Stepper(state: StepperState, options?: StepperOptions)
  state:   { kind: "list", options: (string | {label, sub?, icon?, disabled?})[], index, disabled? }
         | { kind: "number", value, min, max, step, disabled?, format?: (v) => string | StepperLabel }
  options: { label, labelledBy, describedBy, wrap, wheel, size: "normal" | "compact", pageSteps,
             onStep(value, previous, via), read(): StepperState, repeatDelayMs, repeatIntervalMs,
             timers, document, prevLabel, nextLabel }
  .element  .value  .state  .view  .set(state)  .sync()  .step(delta)  .stepTo(edge)  .destroy()

// --- progressive enhancement ---
upgradeSelect(select, { label?, format?(option, i), wrap?, wheel?, size?, intercept? }): Stepper | null
upgradeRange(input, { label?, format?(value, input), output?, hideOutput?, ... }): Stepper | null
upgradeNumber(input, { ...same }): Stepper | null
upgradeAll(root, { selects, ranges, numbers, skip(el), optionsFor(el), ...common }): Stepper[]  // new ones only
autoUpgrade(root, sameOptions): () => void   // upgradeAll now + after every DOM change; returns stop
stepperFor(nativeEl): Stepper | undefined
controlLabel(el) / linkedOutput(input)
```

Garbage rules (all tested): NaN index -> 0; NaN delta -> no move; empty list -> index -1, label
"—", both arrows off; step 0/NaN/negative -> 1 (the HTML default); `min > max` -> max collapses to
min (the HTML rule); NaN or open `min`/`max` -> open end (no aria-valuemin/max, Home/End do
nothing); `max` snaps DOWN onto the grid (0..10 step 3 ends at 9); an off-grid value steps to the
next grid point in the step's direction (0.5 +1 -> 1); a NaN value or a value outside the range
lands on the start / nearest bound; results round to the grid's decimals (0.2 + 0.1 = 0.3).
**Wrap turns over only from the end being left**: PageUp from 95 on 0..100 stops at 100; the next
PageUp wraps to 0. A hold therefore never skips silently past the last value.

## What a step does

On an upgraded element, one step (click, key, hold tick, wheel):

1. writes the native element — `select.selectedIndex = i` / `input.value = String(v)`;
2. dispatches `input` then `change`, both `{ bubbles: true }`, on the native element — exactly
   what a user choice fires, so `el.addEventListener("change", …)` and delegated listeners on an
   ancestor run unchanged, and `el.value` inside them is already the new value;
3. re-reads the native element (`sync()`), so a listener that refuses or rewrites the value, or
   rewrites the linked `<output>`, is what the stepper shows.

Exactly one `input` and one `change` per step; none at a closed end. A press-and-hold fires one
pair per repeat step (a native slider fires `change` only on release; here each step is final).

The stepper follows the native element:
- its own `change` / `input` events;
- programmatic `el.value = …` / `select.selectedIndex = …` / `input.valueAsNumber = …` (the
  upgrader wraps those accessors on that one element instance; reads and writes still go to the
  native accessor; opt out with `intercept: false` and call `stepperFor(el)?.sync()`);
- option-list rebuilds, `disabled`, `min`/`max`/`step` changes (MutationObserver);
- the linked `<output>`'s text (`<output for=id>` or an `<output>` in the same `<label>`), which
  becomes the label and is hidden (`hideOutput: false` keeps it);
- `form.reset()`.

Labels: `<option>` text (+ `data-sub`, `data-icon`), else `format`, else the `<output>` text,
else the number with the grid's decimals. The accessible name is the native element's
`aria-label`, else the text of its `<label>` BEFORE the control ("Height" from
`Height <input> m`), else `title`. `aria-describedby` is copied.

## Keyboard and pointer

| Input | Effect |
|---|---|
| ArrowRight / ArrowUp | +1 |
| ArrowLeft / ArrowDown | -1 |
| PageUp / PageDown | ±10 steps (numbers only; lists ignore them) |
| Home / End | first / last enabled value (ignored on an open numeric end) |
| Alt/Ctrl/Meta + any key | ignored (browser shortcuts pass) |
| Tab | not handled: the whole stepper is ONE tab stop (`role="spinbutton"`, arrows `tabindex=-1`) |
| Mouse press on an arrow | one step at once; held: repeat after 350 ms, then every 60 ms |
| Touch tap on an arrow | one step (on the tap's click, so starting a scroll on an arrow changes nothing) |
| Touch hold | repeat after 350 ms, then every 60 ms; a scroll (`pointercancel`) cancels |
| Wheel | off by default (menus scroll); `wheel: true` steps only while the stepper has focus |

Handled keys get `preventDefault()` + `stopPropagation()`, so a game/menu key handler never also
sees a consumed arrow. Escape, Tab and Enter are never consumed. A hold stops on release,
`pointerleave`, `pointercancel`, a closed end, or when the stepper leaves the DOM.

DOM (classes for styling): `.stepper[role=spinbutton][data-kind][data-at-start][data-at-end][data-disabled]`
> `button.stepper-arrow.stepper-prev` + `span.stepper-value` (`.stepper-icon`, `.stepper-text`,
`.stepper-sub`) + `button.stepper-arrow.stepper-next`; `.stepper-compact` for 34 px. The native
element gets `hidden`, class `stepper-native` and `data-stepper="1"`; the stepper gets
`data-stepper-for="<id>"`. aria: `aria-valuenow/min/max` (min/max omitted on open ends),
`aria-valuetext` = label (+ ", sub"), `aria-disabled`.

Focus: calling `focus()` on the hidden native element focuses its stepper. When a step's change
listener re-renders the screen, `upgradeAll`/`autoUpgrade` gives focus back to the new stepper
for the same `id` — only if focus fell to `<body>`.

## Known limits (honest)

- **Number inputs lose typing.** `creator-attr-*` (1..999) are reachable by holding (16 steps/s)
  and PageUp (×10), but not by typing 750. If typing matters there, keep them native
  (`numbers: false`, or `skip`, or `data-stepper="off"`).
- **A hold that re-renders the screen stops after one step**: the old stepper is gone; the new
  one gets focus back, not the press. Controls whose `change` rebuilds the screen step once per
  press (keys and repeated clicks still work).
- **Up/Down are consumed** (spinbutton convention); a menu-level Up/Down row navigation would not
  see them while a stepper is focused.
- The stepper shows the value snapped onto the grid; an off-grid native value is not rewritten
  until the player steps.
- A `multiple` or `size > 1` select is left native (`upgradeSelect` returns null).

## Evidence

**Unit** (`deno test tests/stepper_test.ts`): 33 passed — the pure model exhaustively
(stepIndex vs stepEnabled on 1 530 cases, wrap/no-wrap ends, grid snapping, garbage) and the DOM
behaviour through a hand-rolled document shim (no deno-dom): aria, disabled ends, keys,
press-and-hold with fake timers (mouse and touch), upgradeSelect two-way sync with exactly one
`input` + `change` per step, rebuilt options via a microtask MutationObserver fake, range +
`<output>`, number with open ends, `upgradeAll` idempotence, focus forwarding and hand-back,
`autoUpgrade`. Mutation check: breaking the change dispatch, the click de-duplication, the grid
rounding, the prototype interception, the change/input re-sync, the disabled-arrow flag, the
observer callback, the wrap rule or the output hiding each fails at least one test.

**Real Chrome, isolated** (a scratch fixture: Stepper.ts bundled alone, served by
`tools/serve.ts` `serveAsset` under the game's CSP, this CSS, Playwright + Chrome headless; not
the game build): 6 steppers, native elements `display: none`, a text input untouched; a real
mouse click on Sex › gave `value "female"`, `change 1`, `input 1`, valuetext
`"Female, lighter frame"`, focus on the spinbutton, › disabled at the end; `select.value = "male"`
on a REAL `HTMLSelectElement` re-rendered at once (`aria-valuenow "0"`); ArrowRight -> `"female"`;
`innerHTML` option rebuild -> `aria-valuemax "2"` next frame; the disabled Moon option skipped,
`data-icon` rendered; a 1000 ms mouse hold on the range -> `12` (1 + 11 repeats, as 350/60 ms
predicts), label `"12 m"` from the page's own `<output>` listener; step 0.05 -> `0.85` / `"85%"`;
step 0.01 -> `1.76`; arrows 44 px wide; steppers 44 px tall (compact 34 px, its 30 px caps hit
4 px above and 3 px below — the 44 px hit area works); at 320 px wide `scrollWidth 320`, rightmost
stepper edge 304; a full `innerHTML` re-render re-upgraded by the next frame (0 -> 6);
`securitypolicyviolation` events: none. One console error: a 404 — the fixture page has no
favicon and `serveAsset` serves only its five paths (not checked further).

## Browser check for the parent (after integration + `deno task build`)

In a probe (`tools/probe-*.ts` pattern), on the menu:

```ts
const r = await page.evaluate(() => {
  const natives = [...document.querySelectorAll("select, input[type=range], input[type=number]")];
  return {
    visibleNatives: natives.filter((e) => getComputedStyle(e).display !== "none" && !e.closest("[hidden]")).map((e) => e.id),
    steppers: document.querySelectorAll(".stepper").length,
    narrowArrows: [...document.querySelectorAll(".stepper-arrow")].filter((a) => a.getBoundingClientRect().width < 44).length,
  };
});
// expect visibleNatives = [] (or only the ones you skipped), narrowArrows = 0,
// zero console errors ("Refused to apply inline style" would mean a style= attribute somewhere).
// Then click `.stepper[data-stepper-for="creator-sex"] .stepper-next` and assert the creator
// preview/sheet updates exactly as picking "Female" in the old dropdown did.
```
