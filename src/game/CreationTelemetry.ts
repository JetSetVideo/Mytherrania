// Character-creation telemetry: the structured JSON event sent to the backend
// analytics pipeline when a player finalizes a character. It carries the full
// parameter set — race, sub-species, birth sign, profile id, and the initial
// primary + secondary stat blocks — so meta-distribution and player-preference
// analytics can be computed server-side.
//
// Pure module: builds and validates the payload. The Engine ships it via sendBeacon
// (or a queued console fallback when no backend is present); tests inspect the shape.

import type { ClassName } from "./Stats.ts";
import type { SecondaryStat } from "./SecondaryStats.ts";
import { combineSecondary } from "./SecondaryStats.ts";

export const TELEMETRY_ENDPOINT = "/api/telemetry/character-creation";

/** The character-creation event payload. */
export interface CharacterCreationEvent {
  /** Event schema version, for backend evolution. */
  v: 1;
  event: "character-creation";
  /** ISO timestamp. */
  at: string;
  /** The creating player's id. */
  playerId: string;
  /** Chosen parameters. */
  className: ClassName;
  race: string;
  subrace: string | null;
  birthsign: string | null;
  /** Initial primary allocation (the six core stats). */
  primary: Record<string, number>;
  /** The combined secondary deltas (crit/haste/mastery/resists/versatility). */
  secondary: Record<SecondaryStat, number>;
}

/** Build the event from the creator's choices. */
export function characterCreationEvent(input: {
  playerId: string;
  className: ClassName;
  race: string;
  subrace: string | null;
  birthsign: string | null;
  primary: Record<string, number>;
  at?: string;
}): CharacterCreationEvent {
  return {
    v: 1,
    event: "character-creation",
    at: input.at ?? new Date().toISOString(),
    playerId: input.playerId,
    className: input.className,
    race: input.race,
    subrace: input.subrace,
    birthsign: input.birthsign,
    primary: { ...input.primary },
    secondary: combineSecondary(input.subrace, input.birthsign),
  };
}

/** Validate a payload before sending: every required field present and typed. */
export function isValidEvent(e: CharacterCreationEvent): boolean {
  return e.v === 1
    && e.event === "character-creation"
    && typeof e.playerId === "string" && e.playerId.length > 0
    && typeof e.race === "string" && e.race.length > 0
    && typeof e.className === "string" && e.className.length > 0
    && typeof e.primary === "object" && e.primary !== null
    && typeof e.secondary === "object" && e.secondary !== null;
}

/**
 * A telemetry sink: the Engine ships events through here. The browser
 * implementation uses navigator.sendBeacon (non-blocking, survives page unload);
 * tests capture the payload instead.
 */
export interface TelemetrySink {
  send(endpoint: string, payload: CharacterCreationEvent): void;
}

/** Queue-and-send sink for the browser: beacon, else keep a small local queue. */
export function beaconSink(): TelemetrySink {
  const queue: CharacterCreationEvent[] = [];
  return {
    send(endpoint, payload) {
      const nav = (globalThis as { navigator?: { sendBeacon?: (url: string, data: string) => boolean } }).navigator;
      const ok = nav?.sendBeacon?.(endpoint, JSON.stringify(payload)) ?? false;
      if (!ok) {
        queue.push(payload);
        if (queue.length > 50) queue.shift();
      }
    },
  };
}
