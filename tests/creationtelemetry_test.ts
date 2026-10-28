import { characterCreationEvent, isValidEvent, TELEMETRY_ENDPOINT, type CharacterCreationEvent } from "../src/game/CreationTelemetry.ts";
import { combineSecondary } from "../src/game/SecondaryStats.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }

const base = {
  playerId: "PL-ABC123", className: "Mage" as const, race: "elf",
  subrace: "wood", birthsign: "moon", primary: { vitality: 7, reflex: 15, intelligence: 17 },
  at: "2026-10-10T00:00:00.000Z",
};

Deno.test("the event carries every creation parameter and the schema version", () => {
  const e = characterCreationEvent(base);
  assert(e.v === 1 && e.event === "character-creation", "schema");
  assert(e.playerId === "PL-ABC123", "profile id");
  assert(e.race === "elf" && e.subrace === "wood" && e.birthsign === "moon", "race/sub/birthsign");
  assert(e.className === "Mage", "class");
  assert(e.primary.intelligence === 17, "primary allocation");
});

Deno.test("the secondary block is the combined sub-species + birth-sign deltas", () => {
  const e = characterCreationEvent(base);
  const expected = combineSecondary("wood", "moon");
  for (const k of Object.keys(expected) as (keyof typeof expected)[]) {
    assert(Math.abs(e.secondary[k] - expected[k]) < 1e-9, `secondary.${k} matches combineSecondary`);
  }
});

Deno.test("a null sub-species or birth sign yields zero deltas for that layer", () => {
  const e = characterCreationEvent({ ...base, subrace: null, birthsign: null });
  for (const v of Object.values(e.secondary)) assert(v === 0, "no layers, no deltas");
});

Deno.test("isValidEvent accepts a well-formed payload and rejects malformed ones", () => {
  assert(isValidEvent(characterCreationEvent(base)), "valid");
  const bad = characterCreationEvent(base);
  (bad as { playerId: string }).playerId = "";
  assert(!isValidEvent(bad), "empty player id rejected");
  const noPrimary = { ...characterCreationEvent(base), primary: null } as unknown as CharacterCreationEvent;
  assert(!isValidEvent(noPrimary), "missing primary rejected");
});

Deno.test("the endpoint constant is the analytics route", () => {
  assert(TELEMETRY_ENDPOINT === "/api/telemetry/character-creation", "endpoint path");
  // The event serializes to JSON cleanly (what sendBeacon sends).
  const json = JSON.stringify(characterCreationEvent(base));
  const parsed = JSON.parse(json);
  assert(parsed.event === "character-creation", "round-trips through JSON");
});
