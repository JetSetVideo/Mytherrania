// AI ranking: an MMR (Elo) ladder over the named AI combatants, with four
// archetypes whose personalities differ, a ranked king at the top, and the
// placement a leaderboard shows in the History page.
//
// Pure module: no Three.js, no DOM. The Engine records each result here; the
// Menu reads the leaderboard.

import type { Identity } from "./Identity.ts";

/** The four AI archetypes, each with a distinct fighting personality. */
export type Archetype = "berserker" | "tactician" | "duelist" | "sentinel";

export interface ArchetypeDef {
  id: Archetype;
  name: string;
  /** Short description shown on the profile page. */
  style: string;
  /** Personality seeds the AiBrain adapts from. */
  engageRange: number;
  cowardice: number;
  aggression: number;
  neuralTrust: number;
}

export const ARCHETYPES: Record<Archetype, ArchetypeDef> = {
  berserker: { id: "berserker", name: "Berserker", style: "closes hard and swings often; fades if the first rush fails", engageRange: 2.4, cowardice: 0.15, aggression: 0.65, neuralTrust: 0.3 },
  tactician: { id: "tactician", name: "Tactician", style: "fights at the edge of reach and punishes mistakes", engageRange: 1.8, cowardice: 0.45, aggression: 0.3, neuralTrust: 0.6 },
  duelist:   { id: "duelist",   name: "Duelist",   style: "balanced, adapts fastest to the opponent", engageRange: 1.7, cowardice: 0.3, aggression: 0.45, neuralTrust: 0.8 },
  sentinel:  { id: "sentinel",  name: "Sentinel",  style: "holds ground, blocks, and counter-attacks", engageRange: 1.3, cowardice: 0.55, aggression: 0.2, neuralTrust: 0.4 },
};

export const ARCHETYPE_LIST: ArchetypeDef[] = [ARCHETYPES.berserker, ARCHETYPES.tactician, ARCHETYPES.duelist, ARCHETYPES.sentinel];

/** One ranked AI: identity, archetype, and its MMR record. */
export interface RankedAi {
  identity: Identity;
  archetype: Archetype;
  mmr: number;
  wins: number;
  losses: number;
  /** Peak MMR ever reached. */
  peak: number;
}

export const START_MMR = 1000;
/** Elo K-factor: how much one match moves the rating. */
export const K_FACTOR = 32;

/** Expected score of A against B (the Elo logistic). */
export function expectedScore(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

/** New rating after a result: score 1 (win), 0.5 (draw), 0 (loss). */
export function mmrAfter(rating: number, opponent: number, score: number, k = K_FACTOR): number {
  return rating + k * (score - expectedScore(rating, opponent));
}

/** A persistent ladder of ranked AIs, keyed by identity id. */
export class Leaderboard {
  #entries = new Map<string, RankedAi>();

  /** Register an AI (idempotent): a fresh entry starts at START_MMR. */
  register(identity: Identity, archetype: Archetype): RankedAi {
    const existing = this.#entries.get(identity.id);
    if (existing) return existing;
    const entry: RankedAi = { identity, archetype, mmr: START_MMR, wins: 0, losses: 0, peak: START_MMR };
    this.#entries.set(identity.id, entry);
    return entry;
  }

  /** Record a result between two registered AIs and update both MMRs. */
  recordMatch(aId: string, bId: string, winner: 0 | 1 | null): void {
    const a = this.#entries.get(aId), b = this.#entries.get(bId);
    if (!a || !b) return;
    const scoreA = winner === null ? 0.5 : winner === 0 ? 1 : 0;
    const aNew = mmrAfter(a.mmr, b.mmr, scoreA);
    const bNew = mmrAfter(b.mmr, a.mmr, 1 - scoreA);
    a.mmr = Math.round(aNew * 10) / 10;
    b.mmr = Math.round(bNew * 10) / 10;
    a.peak = Math.max(a.peak, a.mmr);
    b.peak = Math.max(b.peak, b.mmr);
    if (winner === 0) { a.wins++; b.losses++; }
    else if (winner === 1) { b.wins++; a.losses++; }
  }

  get(id: string): RankedAi | undefined { return this.#entries.get(id); }

  /** The ladder, highest MMR first. Rank 1 is the king. */
  ranked(): RankedAi[] {
    return [...this.#entries.values()].sort((x, y) => y.mmr - x.mmr || y.wins - x.wins || x.identity.id.localeCompare(y.identity.id));
  }

  /** The current king (highest MMR), or null on an empty ladder. */
  king(): RankedAi | null {
    const r = this.ranked();
    return r.length ? r[0] : null;
  }

  /** 1-based placement of an id on the ladder, or 0 if unranked. */
  placement(id: string): number {
    const i = this.ranked().findIndex((e) => e.identity.id === id);
    return i < 0 ? 0 : i + 1;
  }

  /** Win rate in [0,1], 0.5 before any match. */
  winRate(id: string): number {
    const e = this.#entries.get(id);
    if (!e) return 0.5;
    const n = e.wins + e.losses;
    return n === 0 ? 0.5 : e.wins / n;
  }
}
