// Wave J (J-B) — the segmented statistics bars. Two things are proven here with no DOM:
//   1. the PURE bar model (barLabel / barModel / barSegments) is total over every hostile input
//      (0, value == max, value > max, max == 0, NaN, a 1 px-wide bar) and its label format holds;
//   2. the square + inside-number hooks still exist in FighterPanel.ts and styles.css, so a silent
//      removal of the divisions or the in-bar numbers fails this test.
import { BAR_SEGMENTS, barLabel, barModel, barSegments } from "../src/ui/FighterPanel.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok {
  if (!ok) throw new Error(m);
}

// ---- barLabel: value / max · share % ---------------------------------------------------------

Deno.test("barLabel: the 'value / max · pct%' format", () => {
  assert(barLabel(300, 1000) === "300 / 1 000 · 30%", barLabel(300, 1000));
  assert(barLabel(3200, 5000) === "3 200 / 5 000 · 64%", barLabel(3200, 5000));
  assert(barLabel(0, 1000) === "0 / 1 000 · 0%", barLabel(0, 1000));
  assert(barLabel(1000, 1000) === "1 000 / 1 000 · 100%", barLabel(1000, 1000));
});

Deno.test("barLabel: value above max is clamped (never reads past 100 %)", () => {
  assert(barLabel(2000, 1000) === "1 000 / 1 000 · 100%", barLabel(2000, 1000));
  assert(!barLabel(99999, 10).includes("9"), barLabel(99999, 10));
});

Deno.test("barLabel: max == 0 and NaN never leak NaN/Infinity", () => {
  assert(barLabel(0, 0) === "0 / 0 · 0%", barLabel(0, 0));
  assert(barLabel(5, 0) === "0 / 0 · 0%", barLabel(5, 0));
  assert(barLabel(NaN, 500) === "0 / 500 · 0%", barLabel(NaN, 500));
  assert(barLabel(500, NaN) === "0 / 0 · 0%", barLabel(500, NaN));
  assert(barLabel(NaN, NaN) === "0 / 0 · 0%", barLabel(NaN, NaN));
  for (const [v, mx] of [[NaN, NaN], [Infinity, Infinity], [-4, 100], [50, -9], [Infinity, 100]] as const) {
    const t = barLabel(v, mx);
    assert(!t.includes("NaN") && !t.includes("Infinity"), `leak: ${t}`);
  }
});

// ---- barModel.text now carries the numbers ---------------------------------------------------

Deno.test("barModel.text is barLabel(nominal, max) for every edge", () => {
  assert(barModel({ nominal: 300, potential: 800, max: 1000 }).text === "300 / 1 000 · 30%", "30%");
  assert(barModel({ nominal: 0, potential: 800, max: 1000 }).text === "0 / 1 000 · 0%", "zero");
  assert(barModel({ nominal: 1000, potential: 1000, max: 1000 }).text === "1 000 / 1 000 · 100%", "full");
  assert(barModel({ nominal: 5000, potential: 5000, max: 1000 }).text === "1 000 / 1 000 · 100%", "over");
  assert(barModel({ nominal: 7, potential: 9, max: 0 }).text === "0 / 0 · 0%", "empty pool");
  assert(barModel({ nominal: NaN, potential: NaN, max: NaN }).text === "0 / 0 · 0%", "NaN");
});

// ---- barSegments: the squares ----------------------------------------------------------------

Deno.test(`barSegments: ${BAR_SEGMENTS} squares of an empty, half and full bar`, () => {
  const seg = (nominal: number, max = 1000) => barSegments(barModel({ nominal, potential: nominal, max }), BAR_SEGMENTS);
  const empty = seg(0);
  assert(empty.fills.length === BAR_SEGMENTS && empty.full.length === BAR_SEGMENTS, "one entry per square");
  assert(empty.fills.every((f) => f === 0) && empty.full.every((f) => !f), "an empty bar fills nothing");
  const half = seg(500);
  const cuts = BAR_SEGMENTS / 2;
  assert(half.fills.slice(0, cuts).every((f) => f === 1), "left half full");
  assert(half.fills.slice(cuts).every((f) => f === 0), "right half empty");
  assert(half.full.slice(0, cuts).every(Boolean) && half.full.slice(cuts).every((f) => !f), "exactly the left half reads full");
  const full = seg(1000);
  assert(full.fills.every((f) => f === 1) && full.full.every(Boolean), "a full bar is all full");
});

Deno.test("barSegments: the LAST square is exact (a partial edge) and the fills sum to the bar", () => {
  const w = 1 / BAR_SEGMENTS;
  const model = barModel({ nominal: 1000 * (1.5 * w), potential: 1000 * (1.5 * w), max: 1000 });
  const s = barSegments(model, BAR_SEGMENTS);
  assert(s.fills[0] === 1, "first square full");
  assert(Math.abs(s.fills[1] - 0.5) < 1e-9, `second square half: ${s.fills[1]}`);
  assert(s.fills[2] === 0, "third square empty");
  assert(s.full[0] === true && s.full[1] === false, "the partial square is NOT full");
  const sum = s.fills.reduce((a, b) => a + b, 0);
  assert(Math.abs(sum / BAR_SEGMENTS - model.nominal) < 1e-9, `fills average to the fill: ${sum / BAR_SEGMENTS} vs ${model.nominal}`);
});

Deno.test("barSegments: a square is full only when the fill reaches its FAR edge", () => {
  const w = 1 / BAR_SEGMENTS;
  const at = (fill: number) => barSegments({ nominal: fill, potential: fill, text: "" }, BAR_SEGMENTS);
  // Exactly on a boundary: the k-th square's far edge is full, and the NEXT one is empty.
  const onEdge = at(3 * w);
  assert(onEdge.full.slice(0, 3).every(Boolean), "three squares full on the edge");
  assert(onEdge.full[3] === false && onEdge.fills[3] === 0, "the next square is not");
  // One hair under the edge: the square is NOT full.
  const under = at(3 * w - 1e-6);
  assert(under.full[2] === false, "just under the edge is not full");
});

Deno.test("barSegments: total for a nonsense segment count and for a 1 px-wide bar", () => {
  for (const n of [0, -3, NaN, Infinity, 1.9]) {
    const s = barSegments({ nominal: 0.5, potential: 0.5, text: "" }, n);
    const want = n === 1.9 ? 1 : (Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1);
    assert(s.fills.length === want, `n=${n} -> ${s.fills.length} squares`);
    assert(s.fills.every((f) => f >= 0 && f <= 1), "fractions stay in [0, 1]");
  }
  // A bar 1 px wide still models 12 finite squares (the DOM only clips them, never overflows).
  const thin = barSegments(barModel({ nominal: 0.5, potential: 0.5, max: 1 }), BAR_SEGMENTS);
  assert(thin.fills.length === BAR_SEGMENTS && thin.fills.every(Number.isFinite), "1 px bar is finite");
});

// ---- the DOM/source hooks (a silent removal must fail) ----------------------------------------

Deno.test("FighterPanel.ts and styles.css still carry the square + inside-number hooks", () => {
  const here = new URL("../", import.meta.url);
  const panel = Deno.readTextFileSync(new URL("src/ui/FighterPanel.ts", here));
  const css = Deno.readTextFileSync(new URL("styles.css", here));
  for (const hook of ["fp-segs", "fp-seg-fill", "is-full", "barSegments", "BAR_SEGMENTS"]) {
    assert(panel.includes(hook), `FighterPanel.ts is missing the hook "${hook}"`);
  }
  // The panel must never write an inline style attribute (the server CSP blocks it); CSSOM
  // property writes (element.style.width) are the allowed path and are not `.setAttribute("style"`.
  assert(!panel.includes('.setAttribute("style"') && !panel.includes(".setAttribute('style'"), "FighterPanel.ts writes an inline style attribute");
  for (const hook of [".fp-segs", ".fp-seg", ".fp-seg-fill", ".fp-text", ".inspect-bar-segs", ".inspect-bar-seg-fill", ".inspect-bar-text"]) {
    assert(css.includes(hook), `styles.css is missing the hook "${hook}"`);
  }
});
