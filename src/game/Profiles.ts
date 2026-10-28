// Player profiles: a persistent Player_ID with its saved character state,
// keybindings and play telemetry. Selecting a profile loads all three so the
// engine, the menu and the analytics pipeline share one identity.
//
// Pure module: no Three.js, no DOM. Persistence is injected (the Engine passes a
// localStorage-backed store; tests pass an in-memory one).

import type { ClassName } from "./Stats.ts";

/** Rebindable actions and the key codes mapped to them. */
export interface Keybindings {
  forward: string;
  back: string;
  left: string;
  right: string;
  attack: string;
  dash: string;
  power: string;
  defense: string;
}

export const DEFAULT_KEYBINDINGS: Keybindings = {
  forward: "KeyW", back: "KeyS", left: "KeyA", right: "KeyD",
  attack: "Space", dash: "Digit1", power: "Digit2", defense: "Digit3",
};

/** Aggregated play telemetry for the profile's analytics. */
export interface ProfileTelemetry {
  matches: number;
  wins: number;
  losses: number;
  /** Total damage dealt across all matches. */
  damageDealt: number;
  /** Favourite class by games played. */
  favouriteClass: ClassName | null;
}

export interface Profile {
  /** Stable player id, e.g. "PL-9F3A21". */
  playerId: string;
  /** Display name. */
  name: string;
  /** Saved character state. */
  className: ClassName;
  race: string;
  subrace: string | null;
  birthsign: string | null;
  keybindings: Keybindings;
  telemetry: ProfileTelemetry;
  /** When the profile was created (ISO). */
  createdAt: string;
}

/** Deterministic 32-bit hash so a profile id is reproducible from a seed. */
function hash32(n: number): number {
  let x = n >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Create a fresh profile with a unique id derived from the seed. */
export function createProfile(seed: number, name: string, className: ClassName): Profile {
  const h = hash32(seed);
  return {
    playerId: `PL-${h.toString(16).toUpperCase().padStart(6, "0").slice(-6)}`,
    name,
    className,
    race: "human",
    subrace: null,
    birthsign: null,
    keybindings: { ...DEFAULT_KEYBINDINGS },
    telemetry: { matches: 0, wins: 0, losses: 0, damageDealt: 0, favouriteClass: null },
    createdAt: new Date().toISOString(),
  };
}

/** A key-value store the profile repository persists through (localStorage-shaped). */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const PROFILES_KEY = "mytherrania-profiles-v1";

/** Load and save the profile list, and track the active one. */
export class ProfileRepo {
  #store: Store;
  #profiles: Profile[];
  #activeId: string | null = null;

  constructor(store: Store) {
    this.#store = store;
    this.#profiles = this.#load();
  }

  #load(): Profile[] {
    try {
      const raw = this.#store.getItem(PROFILES_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data.filter((p) => p && typeof p.playerId === "string") : [];
    } catch {
      return [];
    }
  }

  #save(): void {
    this.#store.setItem(PROFILES_KEY, JSON.stringify(this.#profiles));
  }

  list(): Profile[] { return [...this.#profiles]; }
  active(): Profile | null { return this.#profiles.find((p) => p.playerId === this.#activeId) ?? null; }

  /** Add a profile and make it active. */
  add(profile: Profile): void {
    this.#profiles = this.#profiles.filter((p) => p.playerId !== profile.playerId);
    this.#profiles.push(profile);
    this.#activeId = profile.playerId;
    this.#save();
  }

  /** Select the active profile by id; returns it (or null if unknown). */
  select(playerId: string): Profile | null {
    const p = this.#profiles.find((x) => x.playerId === playerId) ?? null;
    if (p) this.#activeId = p.playerId;
    return p;
  }

  /** Update a profile's saved fields and persist. */
  update(playerId: string, patch: Partial<Profile>): void {
    const i = this.#profiles.findIndex((p) => p.playerId === playerId);
    if (i < 0) return;
    this.#profiles[i] = { ...this.#profiles[i], ...patch, playerId };
    this.#save();
  }

  /** Record a match result against a profile's telemetry. */
  recordMatch(playerId: string, won: boolean, damageDealt: number, className: ClassName): void {
    const p = this.#profiles.find((x) => x.playerId === playerId);
    if (!p) return;
    p.telemetry.matches++;
    if (won) p.telemetry.wins++; else p.telemetry.losses++;
    p.telemetry.damageDealt += Math.round(damageDealt);
    p.telemetry.favouriteClass = className; // simplified: the class they just played
    this.#save();
  }
}
