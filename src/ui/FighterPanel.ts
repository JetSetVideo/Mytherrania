// One HUD panel per fighter (the player and every opponent of the match): who it is (name, race ·
// sub-race · class · level), and three resource bars, each a bright NOMINAL fill (the value now)
// over a dark POTENTIAL fill (the most the pool can reach now), with "nominal / potential" text:
//   life     red      over dark red
//   mana     blue     over dark blue
//   stamina  green    over dark green   (EXHAUSTED tag while the pool is locked out)
// Built once; every update patches widths and text in place, and only when the shown value
// changed (no innerHTML per tick). The pure model (barModel) is unit-tested in Deno.

/** One bar's input: the value now, the most it can reach now, and its full capacity. */
export interface BarInput {
  nominal: number;
  potential: number;
  max: number;
}

/** What a bar draws: fill fractions of the track (0..1) and the text. */
export interface BarModel {
  /** Bright fill = nominal / max. */
  nominal: number;
  /** Dark fill = potential / max (never below the nominal fill). */
  potential: number;
  text: string;
}

const finiteNonNeg = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

/** Total over any input (NaN, negative, nominal > potential > max): fractions in [0, 1], ordered. */
export function barModel(b: BarInput): BarModel {
  const max = finiteNonNeg(b.max);
  const nom = Math.min(finiteNonNeg(b.nominal), max || Infinity);
  const pot = Math.min(Math.max(finiteNonNeg(b.potential), nom), max || Infinity);
  if (max <= 0) return { nominal: 0, potential: 0, text: "0 / 0" };
  return { nominal: nom / max, potential: pot / max, text: `${Math.round(nom)} / ${Math.round(pot)}` };
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
}

/** "Human · Nomad · Warrior · Lv 3" (the sub-race left out when none was chosen). */
export function identityLine(d: Pick<FighterPanelData, "race" | "subrace" | "className" | "level">): string {
  return [d.race, d.subrace, d.className, `Lv ${Math.max(1, Math.round(finiteNonNeg(d.level) || 1))}`].filter(Boolean).join(" · ");
}

interface BarEls { root: HTMLElement; pot: HTMLElement; nom: HTMLElement; text: HTMLElement; last: string }

export class FighterPanel {
  readonly root: HTMLDivElement;
  readonly #head: HTMLDivElement;
  readonly #ident: HTMLDivElement;
  readonly #status: HTMLDivElement;
  readonly #bars: Record<BarKind, BarEls>;
  readonly #exhaust: HTMLSpanElement;
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
      const pot = el("div", "fp-pot", track), nom = el("div", "fp-nom", track);
      const text = el("span", "fp-text", row);
      return { root: track, pot, nom, text, last: "" };
    };
    this.#bars = { life: mk("life"), mana: mk("mana"), stamina: mk("stamina") };
    this.#exhaust = el("span", "fp-exhausted", this.#bars.stamina.text.parentElement!) as HTMLSpanElement;
    this.#exhaust.textContent = "EXHAUSTED";
    this.#exhaust.style.display = "none";
    this.#status = el("div", "fp-status", this.root) as HTMLDivElement;
  }

  update(d: FighterPanelData): void {
    this.root.dataset.side = d.side;
    const head = `${d.who} — ${d.name}  ·  knockback ${Math.round(finiteNonNeg(d.knockbackPercent))}%`;
    if (head !== this.#lastHead) this.#head.textContent = this.#lastHead = head;
    const ident = identityLine(d);
    if (ident !== this.#lastIdent) this.#ident.textContent = this.#lastIdent = ident;
    for (const k of BAR_KINDS) {
      const m = barModel(d[k]), b = this.#bars[k];
      const key = `${m.nominal.toFixed(4)}|${m.potential.toFixed(4)}|${m.text}`;
      if (key === b.last) continue;
      b.last = key;
      b.nom.style.width = `${(m.nominal * 100).toFixed(2)}%`;
      b.pot.style.width = `${(m.potential * 100).toFixed(2)}%`;
      b.text.textContent = m.text;
      b.root.setAttribute("aria-valuenow", String(Math.round(finiteNonNeg(d[k].nominal))));
      b.root.setAttribute("aria-valuemax", String(Math.round(finiteNonNeg(d[k].max))));
    }
    this.#exhaust.style.display = d.exhausted ? "" : "none";
    if (d.status !== this.#lastStatus) this.#status.textContent = this.#lastStatus = d.status;
  }

  /** Plain text of the panel (for logs and probes). */
  text(): string {
    return `${this.#lastHead} | ${this.#lastIdent} | ${BAR_KINDS.map((k) => `${BAR_LABEL[k]} ${this.#bars[k].text.textContent}`).join(" | ")}`;
  }
}
