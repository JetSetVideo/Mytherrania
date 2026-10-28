// The Ancestry accordion's pure state (W01): one box expanded at a time, a sub-species selects
// its race, and the header merges "Race · Sub-species". Runs against the game's real RACES too.
import {
  ancestryView, headerLabel, initialAncestry, mergedName, nextHeaderIndex, selectSubrace, toggleRace,
  type AncestryRace,
} from "../src/ui/AncestryState.ts";
import { RACES } from "../src/game/Races.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
function eq<T>(actual: T, expected: T, message = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message} expected ${e}, got ${a}`);
}

const RACE_FIXTURE: AncestryRace[] = [
  { id: "human", name: "Human", subspecies: [{ id: "imperial", name: "Imperial" }, { id: "nomad", name: "Nomad" }] },
  { id: "elf", name: "Elf", subspecies: [{ id: "high", name: "High Elf" }, { id: "wood", name: "Wood Elf" }] },
  { id: "dwarf", name: "Dwarf", subspecies: [{ id: "mountain", name: "Mountain" }, { id: "deep", name: "Deep" }] },
];

const expandedCount = (s: ReturnType<typeof initialAncestry>) =>
  ancestryView(s, RACE_FIXTURE).filter((b) => b.expanded).length;

Deno.test("ancestry: the selected race starts expanded with its own sub-species", () => {
  const s = initialAncestry(RACE_FIXTURE, "elf", "wood");
  eq(s, { expanded: "elf", race: "elf", subrace: "wood" });
  // A sub-species from another race falls back to the race's first; an unknown race to the first race.
  eq(initialAncestry(RACE_FIXTURE, "elf", "imperial"), { expanded: "elf", race: "elf", subrace: "high" });
  eq(initialAncestry(RACE_FIXTURE, "orc", null), { expanded: "human", race: "human", subrace: "imperial" });
});

Deno.test("ancestry: one box expanded at a time, through any click sequence", () => {
  let s = initialAncestry(RACE_FIXTURE, "human", "imperial");
  const clicks = ["elf", "dwarf", "dwarf", "human", "elf", "elf", "elf", "human"];
  for (const id of clicks) {
    s = toggleRace(s, id, RACE_FIXTURE);
    assert(expandedCount(s) <= 1, `after clicking ${id}: ${expandedCount(s)} boxes expanded`);
  }
  // Clicking the expanded header collapses it; the selection is kept.
  s = toggleRace(initialAncestry(RACE_FIXTURE, "dwarf", "deep"), "dwarf", RACE_FIXTURE);
  eq(s, { expanded: null, race: "dwarf", subrace: "deep" }, "collapse keeps the selection:");
  // Re-expanding the selected race keeps its sub-species.
  eq(toggleRace(s, "dwarf", RACE_FIXTURE), { expanded: "dwarf", race: "dwarf", subrace: "deep" });
  // Unknown ids change nothing.
  eq(toggleRace(s, "orc", RACE_FIXTURE), s);
});

Deno.test("ancestry: expanding another race selects it with its first sub-species", () => {
  const s = toggleRace(initialAncestry(RACE_FIXTURE, "human", "nomad"), "elf", RACE_FIXTURE);
  eq(s, { expanded: "elf", race: "elf", subrace: "high" });
});

Deno.test("ancestry: selecting a sub-species selects its race (and only real pairs)", () => {
  // From Human, pick Elf's Wood Elf directly: the race follows.
  let s = initialAncestry(RACE_FIXTURE, "human", "imperial");
  s = selectSubrace(s, "elf", "wood", RACE_FIXTURE);
  eq(s, { expanded: "elf", race: "elf", subrace: "wood" });
  const view = ancestryView(s, RACE_FIXTURE);
  // Exactly one box and one chip are highlighted, and the chip sits in the highlighted box.
  eq(view.filter((b) => b.selected).map((b) => b.raceId), ["elf"]);
  const chips = view.flatMap((b) => b.chips.filter((c) => c.selected).map((c) => `${b.raceId}/${c.id}`));
  eq(chips, ["elf/wood"]);
  // A sub-species of another race is rejected: no cross-race pairs.
  eq(selectSubrace(s, "elf", "imperial", RACE_FIXTURE), s);
});

Deno.test("ancestry: header label merges race and sub-species without repeating the race", () => {
  eq(mergedName("Human", "Imperial"), "Human · Imperial");
  eq(mergedName("Elf", "High Elf"), "High Elf");
  eq(mergedName("Elf", "Elfhame"), "Elf · Elfhame", "a word match only:");
  eq(mergedName("Dwarf", null), "Dwarf");
  const s = initialAncestry(RACE_FIXTURE, "dwarf", "mountain");
  eq(headerLabel(s, "dwarf", RACE_FIXTURE), "Dwarf · Mountain");
  eq(headerLabel(s, "human", RACE_FIXTURE), "Human", "an unselected box shows the bare race:");
});

Deno.test("ancestry: arrow keys rove the headers and wrap; other keys are ignored", () => {
  eq(nextHeaderIndex(0, "ArrowDown", 4), 1);
  eq(nextHeaderIndex(3, "ArrowDown", 4), 0);
  eq(nextHeaderIndex(0, "ArrowUp", 4), 3);
  eq(nextHeaderIndex(2, "ArrowRight", 4), 3);
  eq(nextHeaderIndex(2, "ArrowLeft", 4), 1);
  eq(nextHeaderIndex(2, "Home", 4), 0);
  eq(nextHeaderIndex(0, "End", 4), 3);
  eq(nextHeaderIndex(1, "Enter", 4), null);
  eq(nextHeaderIndex(0, "ArrowDown", 0), null);
});

Deno.test("ancestry: the game's real races all build a valid accordion", () => {
  for (const race of RACES) {
    assert(race.subspecies.length > 0, `${race.id} has no sub-species`);
    let s = initialAncestry(RACES, race.id, null);
    eq(s.race, race.id);
    for (const sub of race.subspecies) {
      s = selectSubrace(s, race.id, sub.id, RACES);
      const label = headerLabel(s, race.id, RACES);
      assert(label.includes(sub.name), `${race.id}/${sub.id}: label "${label}" lacks the sub-species`);
      assert(ancestryView(s, RACES).filter((b) => b.expanded).length === 1, `${race.id}/${sub.id}: not one box open`);
    }
  }
});
