export type EventKind = "first-strike" | "hit" | "ring-out" | "ko" | "block" | "decision";

export interface CombatEvent {
  time: number;        // seconds since match start (WHEN)
  kind: EventKind;     // WHAT
  from?: string;       // attacker (FROM)
  to?: string;         // target (TO)
  x?: number; z?: number; // ring coords (WHERE)
  damage?: number;
  weapon?: string;
  action?: string;
  reason?: string;     // WHY
}

export interface CombatDigest {
  firstStrike?: CombatEvent;
  totalHits: number;
  totalDamage: number;
  ringOuts: number;
  kos: number;
  decisions: Record<string, number>;
  events: CombatEvent[];
}

// Append-only per-match combat history. Feeds the neural-network trainer and
// the post-match statistics.
export class CombatLog {
  #events: CombatEvent[] = [];
  #started = 0;

  start(now = 0): void {
    this.#events = [];
    this.#started = now;
  }

  record(ev: Omit<CombatEvent, "time">, now: number): void {
    const time = now - this.#started;
    const kind = ev.kind === "hit" && !this.#events.some((e) => e.kind === "first-strike")
      ? "first-strike"
      : ev.kind;
    this.#events.push({ ...ev, kind, time });
  }

  digest(): CombatDigest {
    let totalHits = 0, totalDamage = 0, ringOuts = 0, kos = 0;
    let firstStrike: CombatEvent | undefined;
    const decisions: Record<string, number> = {};
    for (const e of this.#events) {
      if (e.kind === "first-strike" && !firstStrike) firstStrike = e;
      if (e.kind === "hit" || e.kind === "first-strike") { totalHits++; totalDamage += e.damage ?? 0; }
      if (e.kind === "ring-out") ringOuts++;
      if (e.kind === "ko") kos++;
      if (e.kind === "decision" && e.action) decisions[e.action] = (decisions[e.action] ?? 0) + 1;
    }
    return { firstStrike, totalHits, totalDamage, ringOuts, kos, decisions, events: this.#events };
  }

  toJSON(): string { return JSON.stringify(this.#events); }
}
