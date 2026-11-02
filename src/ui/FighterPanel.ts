// One HUD panel per fighter (the player and every opponent of the match): who it is (name, race ·
// sub-race · class · level), and three resource bars. Each bar is a squared channel — a bright
// NOMINAL fill (the value now, cut into equal squares) over a dark POTENTIAL fill (the most the
// pool can reach now) — with the numbers drawn INSIDE the bar (value / max · share), so a fighter
// reads their pools at a glance without leaving the fiction:
//   life     red      over dark red
//   mana     blue     over dark blue
//   stamina  green    over dark green   (EXHAUSTED tag while the pool is locked out)
// Built once; every update patches widths, classes and text in place, and only when the shown value
// changed (no innerHTML per tick). Widths go through CSSOM (element.style.width), never an inline
// style="" attribute — the server CSP (style-src 'self') blocks those and once blanked the History
// bars. The pure model (barModel / barLabel / barSegments) is unit-tested in Deno.

/** One bar's input: the value now, the most it can reach now, and its full capacity. */
export interface BarInput {
  nominal: number;
  potential: number;
  max: number;
}

/** What a bar draws: fill fractions of the track (0..1) and the text shown inside the bar. */
export interface BarModel {
  /** Bright fill = nominal / max. */
  nominal: number;
  /** Dark fill = potential / max (never below the nominal fill). */
  potential: number;
  /** The numbers inside the bar: "value / max · pct%" (see barLabel). */
  text: string;
}

/**
 * Segments per bar. 12 divides by 2, 3, 4 and 6, so the half, quarter and third marks fall
 * exactly on a square boundary (10 would leave thirds and quarters without a division). At the
 * HUD's narrowest track (~150 px on a 375 px phone) each square still spans ~12 px, so the ticks
 * read as squares rather than a mush.
 */
export const BAR_SEGMENTS = 12;

const finiteNonNeg = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

/** Group the digits in threes with a space ("3 200"), matching the brief's own example. */
function groupThousands(n: number): string {
  const s = String(Math.round(n));
  let out = "";
  for (let i = 0; i < s.length; i++) {
    out += s[i];
    const fromEnd = s.length - i;
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += " ";
  }
  return out;
}

/**
 * The numbers a bar shows INSIDE it: the value now, the capacity, and the share of it
 * ("3 200 / 5 000 · 64%"). Total over any input: a non-finite or negative value reads as 0, a
 * value above the capacity is clamped to it (the fill can never pass the track's edge, so the
 * text must not read past 100 %), and an empty pool (max <= 0) reads "0 / 0 · 0%".
 */
export function barLabel(value: number, max: number): string {
  const cap = finiteNonNeg(max);
  if (cap <= 0) return "0 / 0 · 0%";
  const now = Math.min(finiteNonNeg(value), cap);
  const pct = Math.round((now / cap) * 100);
  return `${groupThousands(now)} / ${groupThousands(cap)} · ${pct}%`;
}

/** Total over any input (NaN, negative, nominal > potential > max): fractions in [0, 1], ordered. */
export function barModel(b: BarInput): BarModel {
  const max = finiteNonNeg(b.max);
  if (max <= 0) return { nominal: 0, potential: 0, text: barLabel(0, 0) };
  const nom = Math.min(finiteNonNeg(b.nominal), max);
  const pot = Math.min(Math.max(finiteNonNeg(b.potential), nom), max);
  return { nominal: nom / max, potential: pot / max, text: barLabel(nom, max) };
}

/** A bar cut into squares: how full each one is, and which ones are completely full. */
export interface BarSegments {
  /** Fill fraction 0..1 of each square, left to right. */
  fills: number[];
  /** true where a square's fill reaches its FAR edge — the square reads as full. */
  full: boolean[];
}

/**
 * Cut a bar into `segments` equal squares. Square i covers the fraction [i/n, (i+1)/n) of the
 * track; its fill is the fraction OF THAT SQUARE the bar's fill covers, so the fills average to
 * the bar's fill value, sum to fill × n, and the LAST (partial) square is exact. A square is
 * "full" when the fill reaches its far edge, i.e. its fill fraction is 1 — that is what paints
 * the square solid. `segments` is floored and clamped to >= 1, so a nonsense count still yields
 * one square.
 */
export function barSegments(model: BarModel, segments: number): BarSegments {
  const n = Math.max(1, Math.floor(Number.isFinite(segments) ? segments : 1));
  const w = 1 / n;
  const fill = Math.min(Math.max(model.nominal, 0), 1);
  const fills: number[] = [];
  const full: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const f = Math.min(Math.max((fill - i * w) / w, 0), 1);
    fills.push(f);
    full.push(f >= 1 - 1e-9);
  }
  return { fills, full };
}

export type BarKind = "life" | "mana" | "stamina";
export const BAR_KINDS: readonly BarKind[] = ["life", "mana", "stamina"];
const BAR_LABEL: Record<BarKind, string> = { life: "HP", mana: "MP", stamina: "SP" };

/** Everything a panel shows for one fighter. */
export interface FighterPanelData {
  who: string;
  name: string;
  race: string;
  subrace: string | null;
  className: string;
  level: number;
  knockbackPercent: number;
  life: BarInput;
  mana: BarInput;
  stamina: BarInput;
  exhausted: boolean;
  /** Status line (burning, chilled...) or "". */
  status: string;
  /** Side: the player's panel is warm, opponents' cool. */
  side: "player" | "opponent";
  /** Wave FALL: the fighter's fall phase (Fall.ts); "falling" / "down" / "rising" show the DOWN chip. */
  fall?: string;
}

/** Wave FALL: the DOWN chip's text for a fall phase ("" = hidden). */
export function fallChip(phase: string | undefined): string {
  return phase === "falling" || phase === "down" || phase === "rising" ? "DOWN" : "";
}

/** "Human · Nomad · Warrior · Lv 3" (the sub-race left out when none was chosen). */
export function identityLine(d: Pick<FighterPanelData, "race" | "subrace" | "className" | "level">): string {
  return [d.race, d.subrace, d.className, `Lv ${Math.max(1, Math.round(finiteNonNeg(d.level) || 1))}`].filter(Boolean).join(" · ");
}

interface BarEls {
  row: HTMLElement;
  track: HTMLElement;
  pot: HTMLElement;
  text: HTMLElement;
  /** One bright fill per square, and the square cell that holds it (for the is-full class). */
  fills: HTMLElement[];
  cells: HTMLElement[];
  last: string;
}

export class FighterPanel {
  readonly root: HTMLDivElement;
  readonly #head: HTMLDivElement;
  readonly #ident: HTMLDivElement;
  readonly #status: HTMLDivElement;
  readonly #bars: Record<BarKind, BarEls>;
  readonly #exhaust: HTMLSpanElement;
  readonly #down: HTMLSpanElement;
  #lastHead = "";
  #lastIdent = "";
  #lastStatus = "";

  constructor(parent: HTMLElement, id: string) {
    const el = (tag: string, cls: string, p: HTMLElement) => {
      const e = document.createElement(tag);
      e.className = cls;
      p.appendChild(e);
      return e;
    };
    this.root = el("div", "fighter-panel", parent) as HTMLDivElement;
    this.root.id = id;
    this.#head = el("div", "fp-head", this.root) as HTMLDivElement;
    this.#ident = el("div", "fp-ident", this.root) as HTMLDivElement;
    const mk = (kind: BarKind): BarEls => {
      const row = el("div", `fp-row fp-${kind}`, this.root);
      el("span", "fp-label", row).textContent = BAR_LABEL[kind];
      const track = el("div", "fp-track", row);
      track.setAttribute("role", "meter");
      track.setAttribute("aria-label", kind);
      // The dark potential fill sits behind the squares; the bright fills live INSIDE the cells.
      const pot = el("div", "fp-pot", track);
      const segs = el("div", "fp-segs", track);
      const fills: HTMLElement[] = [], cells: HTMLElement[] = [];
      for (let i = 0; i < BAR_SEGMENTS; i++) {
        const cell = el("i", "fp-seg", segs);
        fills.push(el("b", "fp-seg-fill", cell));
        cells.push(cell);
      }
      const text = el("span", "fp-text", track);
      return { row, track, pot, text, fills, cells, last: "" };
    };
    this.#bars = { life: mk("life"), mana: mk("mana"), stamina: mk("stamina") };
    this.#exhaust = el("span", "fp-exhausted", this.#bars.stamina.row) as HTMLSpanElement;
    this.#exhaust.textContent = "EXHAUSTED";
    this.#exhaust.style.display = "none";
    this.#status = el("div", "fp-status", this.root) as HTMLDivElement;
    // Wave FALL: the DOWN chip sits in the head row (styled by .fp-down; CSSOM only, CSP style-src 'self').
    this.#down = el("span", "fp-down", this.#head) as HTMLSpanElement;
    this.#down.textContent = "DOWN";
    this.#down.style.display = "none";
  }

  update(d: FighterPanelData): void {
    this.root.dataset.side = d.side;
    const head = `${d.who} — ${d.name}  ·  knockback ${Math.round(finiteNonNeg(d.knockbackPercent))}%`;
    if (head !== this.#lastHead) {
      // The head's text node is the first child; the DOWN chip after it survives the update.
      this.#lastHead = head;
      const first = this.#head.firstChild;
      if (first && first.nodeType === 3) first.nodeValue = head;
      else this.#head.insertBefore(document.createTextNode(head), this.#head.firstChild);
    }
    const chip = fallChip(d.fall);
    this.#down.style.display = chip ? "" : "none";
    this.root.dataset.fall = d.fall ?? "stand";
    const ident = identityLine(d);
    if (ident !== this.#lastIdent) this.#ident.textContent = this.#lastIdent = ident;
    for (const k of BAR_KINDS) {
      const m = barModel(d[k]), b = this.#bars[k];
      const key = `${m.nominal.toFixed(4)}|${m.potential.toFixed(4)}|${m.text}`;
      if (key === b.last) continue;
      b.last = key;
      b.pot.style.width = `${(m.potential * 100).toFixed(2)}%`;
      const seg = barSegments(m, BAR_SEGMENTS);
      for (let i = 0; i < b.fills.length; i++) {
        b.fills[i].style.width = `${(seg.fills[i] * 100).toFixed(2)}%`;
        b.cells[i].classList.toggle("is-full", seg.full[i]);
      }
      b.text.textContent = m.text;
      b.track.setAttribute("aria-valuenow", String(Math.round(finiteNonNeg(d[k].nominal))));
      b.track.setAttribute("aria-valuemax", String(Math.round(finiteNonNeg(d[k].max))));
      b.track.setAttribute("aria-valuetext", m.text);
    }
    this.#exhaust.style.display = d.exhausted ? "" : "none";
    if (d.status !== this.#lastStatus) this.#status.textContent = this.#lastStatus = d.status;
  }

  /** Plain text of the panel (for logs and probes). */
  text(): string {
    return `${this.#lastHead} | ${this.#lastIdent} | ${BAR_KINDS.map((k) => `${BAR_LABEL[k]} ${this.#bars[k].text.textContent}`).join(" | ")}`;
  }
}
