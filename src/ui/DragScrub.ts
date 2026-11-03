// DragScrub (Wave GEN, lane U): DRAG HANDLES on every number — a horizontal drag on a stepper's value
// well scrubs the number (mouse, pen and touch through Pointer Events), the arrows and the keyboard keep
// working, and the legal band is whatever the control's owner enforces (the Creator routes every number
// through Constraints.ts, so a drag stops at a neighbour-dependent limit, e.g. the waist at the hips).
//
// How a drag writes: it sets the HIDDEN native <input type=number> (the stepper's source of truth) to
// the scrubbed value clamped to the input's own min/max, and dispatches `input` — the exact path a
// stepper press takes — so the owner's listener clamps, writes back the legal value, and the stepper
// re-reads it. Nothing else knows a drag happened.
//
// Gesture rules (pure, tested): the drag starts after SCRUB_THRESHOLD_PX of horizontal travel that
// dominates the vertical travel (a vertical swipe on a phone still scrolls the page: the well has
// `touch-action: pan-y` in styles.css); then every `pxPerStep` px is one step, Shift = SCRUB_FINE x finer;
// a whole band spans about SCRUB_SPAN_PX. A click without travel stays a click (no value change).

export const SCRUB_THRESHOLD_PX = 4;
/** A finger needs a longer travel before a drag counts (it jitters more than a mouse). */
export const SCRUB_THRESHOLD_TOUCH_PX = 8;
/** About how many px the whole band spans. */
export const SCRUB_SPAN_PX = 260;
/** px per step: never finer than 3 (unhittable), never coarser than 16 (a 1-point attribute). */
export const SCRUB_MIN_PX_PER_STEP = 3;
export const SCRUB_MAX_PX_PER_STEP = 16;
/** Shift-drag divides the speed by this. */
export const SCRUB_FINE = 4;
/** Class on <html> while a drag runs (cursor + no text selection, styles.css). */
export const SCRUB_ACTIVE_CLASS = "is-scrubbing";

/** px per step for a band. */
export function pxPerStep(min: number, max: number, step: number): number {
  const s = step > 0 && Number.isFinite(step) ? step : 1;
  const steps = Number.isFinite(max - min) && max > min ? (max - min) / s : 100;
  return Math.max(SCRUB_MIN_PX_PER_STEP, Math.min(SCRUB_MAX_PX_PER_STEP, SCRUB_SPAN_PX / Math.max(1, steps)));
}

/** Decimals of a step (0.01 -> 2), for writing the value back without float noise. */
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const s = String(step);
  if (s.includes("e-")) return Number(s.split("e-")[1]);
  return s.includes(".") ? s.split(".")[1].length : 0;
}

/**
 * The value a drag of `dx` px gives: start + whole steps (the grid runs from `start`, so a drag never
 * snaps the value sideways), clamped to [min, max]. `fine` slows it by SCRUB_FINE.
 */
export function scrubTarget(start: number, dx: number, o: { min: number; max: number; step: number; fine?: boolean; px?: number }): number {
  const step = o.step > 0 && Number.isFinite(o.step) ? o.step : 1;
  const px = (o.px ?? pxPerStep(o.min, o.max, step)) * (o.fine ? SCRUB_FINE : 1);
  const n = Math.trunc(dx / px);
  const lo = Number.isFinite(o.min) ? o.min : -Infinity, hi = Number.isFinite(o.max) ? o.max : Infinity;
  let v = start + n * step;
  v = Math.max(lo, Math.min(hi, v));
  const d = stepDecimals(step);
  return Number(v.toFixed(Math.min(12, Math.max(d, stepDecimals(start)))));
}

/** Whether a gesture with this travel has become a horizontal drag. */
export function isScrubGesture(dx: number, dy: number, pointerType: string): boolean {
  const t = pointerType === "touch" ? SCRUB_THRESHOLD_TOUCH_PX : SCRUB_THRESHOLD_PX;
  return Math.abs(dx) >= t && Math.abs(dx) > Math.abs(dy) * 1.2;
}

/** QA log: every scrub's input id, start, last value and the number of writes. */
export interface ScrubRecord { id: string; start: number; value: number; writes: number; pointerType: string }

/**
 * Attach drag-to-scrub to every stepper value well under `root` (delegated: survives re-renders and
 * steppers built later). `filter(input)` picks the inputs (default: every number input). Returns detach.
 */
export function attachDragScrub(root: HTMLElement, filter: (input: HTMLInputElement) => boolean = () => true, log?: (r: ScrubRecord) => void): () => void {
  const doc = root.ownerDocument;
  let active: { pid: number; x0: number; y0: number; input: HTMLInputElement; start: number; scrubbing: boolean; well: HTMLElement; type: string; writes: number; last: number } | null = null;

  const inputOf = (well: Element): HTMLInputElement | null => {
    const host = well.closest("[data-stepper-for]");
    const id = host?.getAttribute("data-stepper-for");
    const el = id ? doc.getElementById(id) : null;
    return el instanceof HTMLInputElement && el.type === "number" && !el.disabled && filter(el) ? el : null;
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || active) return;
    const well = (e.target as Element | null)?.closest?.<HTMLElement>(".stepper-value");
    if (!well || !root.contains(well)) return;
    const input = inputOf(well);
    if (!input) return;
    const start = Number(input.value);
    if (!Number.isFinite(start)) return;
    active = { pid: e.pointerId, x0: e.clientX, y0: e.clientY, input, start, scrubbing: false, well, type: e.pointerType || "mouse", writes: 0, last: start };
  };

  const onMove = (e: PointerEvent) => {
    if (!active || e.pointerId !== active.pid) return;
    const dx = e.clientX - active.x0, dy = e.clientY - active.y0;
    if (!active.scrubbing) {
      if (!isScrubGesture(dx, dy, active.type)) {
        // A mostly vertical travel past the threshold is a scroll: let it go.
        if (Math.abs(dy) > SCRUB_THRESHOLD_TOUCH_PX * 2) active = null;
        return;
      }
      active.scrubbing = true;
      try { active.well.setPointerCapture(active.pid); } catch { /* capture is a nicety */ }
      doc.documentElement.classList.add(SCRUB_ACTIVE_CLASS);
      active.well.closest("[data-stepper-for]")?.setAttribute("data-scrubbing", "true");
    }
    e.preventDefault();
    const inp = active.input;
    const min = inp.min === "" ? -Infinity : Number(inp.min), max = inp.max === "" ? Infinity : Number(inp.max);
    const step = inp.step === "" || inp.step === "any" ? 1 : Number(inp.step);
    const v = scrubTarget(active.start, dx, { min, max, step, fine: e.shiftKey });
    if (v !== Number(inp.value)) {
      inp.value = String(v);
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      active.writes++;
    }
    active.last = Number(inp.value);
  };

  const end = (e: PointerEvent) => {
    if (!active || e.pointerId !== active.pid) return;
    const a = active;
    active = null;
    if (!a.scrubbing) return;
    doc.documentElement.classList.remove(SCRUB_ACTIVE_CLASS);
    a.well.closest("[data-stepper-for]")?.removeAttribute("data-scrubbing");
    try { a.well.releasePointerCapture(a.pid); } catch { /* already released */ }
    a.input.dispatchEvent(new Event("change", { bubbles: true }));
    log?.({ id: a.input.id, start: a.start, value: Number(a.input.value), writes: a.writes, pointerType: a.type });
    // The click that follows a drag must not do anything on the well.
    const swallow = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
    a.well.addEventListener("click", swallow, { capture: true, once: true });
    globalThis.setTimeout(() => a.well.removeEventListener("click", swallow, { capture: true }), 0);
  };

  root.addEventListener("pointerdown", onDown);
  doc.addEventListener("pointermove", onMove, { passive: false });
  doc.addEventListener("pointerup", end);
  doc.addEventListener("pointercancel", end);
  return () => {
    root.removeEventListener("pointerdown", onDown);
    doc.removeEventListener("pointermove", onMove);
    doc.removeEventListener("pointerup", end);
    doc.removeEventListener("pointercancel", end);
  };
}
