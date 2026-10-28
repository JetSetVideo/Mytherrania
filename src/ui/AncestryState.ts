/**
 * AncestryState — the pure state of the Ancestry accordion (W01). No DOM, no THREE.
 *
 * Vocabulary:
 * - **race box**: one box per race in the creator's Ancestry panel. Its header names the race;
 *   its body holds that race's sub-species chips. The race and its sub-species live in ONE box.
 * - **expanded**: the race box whose body is open (at most one at a time; `null` = all closed).
 *   Expanding is a VIEW state; it never changes what the fighter is.
 * - **selected**: the race and sub-species the fighter will be built with. The selected box and
 *   its selected chip share one accent highlight.
 * - **merged label**: the header text of the selected box once a sub-species is chosen,
 *   "Race · Sub-species" (e.g. "Human · Imperial"). When the sub-species name already names the
 *   race ("High Elf" under "Elf") the sub-species name alone is shown, never "Elf · High Elf".
 *
 * Rules (tested in tests/ui_ancestry_test.ts):
 * 1. One box expanded at a time: expanding a box collapses every other box.
 * 2. Clicking a collapsed race header expands it AND selects that race. If the race changes,
 *    the sub-species falls back to the race's first sub-species (the creator always builds a
 *    complete fighter, as before W01). Clicking the expanded header collapses it; the
 *    selection stays.
 * 3. Selecting a sub-species selects its race and keeps that race's box expanded.
 */

/** The slice of a race definition the accordion needs (structurally matches `RaceDef`). */
export interface AncestryRace {
  readonly id: string;
  readonly name: string;
  readonly subspecies: readonly { readonly id: string; readonly name: string }[];
}

/** The accordion's state: which box is open, and which race + sub-species are chosen. */
export interface AncestryState {
  /** Id of the expanded race box, or null when every box is collapsed. */
  readonly expanded: string | null;
  /** Id of the selected race. */
  readonly race: string;
  /** Id of the selected sub-species (always one of `race`'s), or null for none. */
  readonly subrace: string | null;
}

/** View model of one sub-species chip. */
export interface SubraceChipView {
  readonly id: string;
  readonly name: string;
  /** True when this chip is the fighter's sub-species (its race is then selected too). */
  readonly selected: boolean;
}

/** View model of one race box: everything the DOM needs to draw it. */
export interface RaceBoxView {
  readonly raceId: string;
  /** Header text: the merged "Race · Sub-species" for the selected box, else the race name. */
  readonly label: string;
  readonly expanded: boolean;
  readonly selected: boolean;
  readonly chips: readonly SubraceChipView[];
}

/** Separator of the merged header label (a middle dot with spaces, as in the sheet). */
export const MERGE_SEPARATOR = " · ";

const findRace = (races: readonly AncestryRace[], id: string) => races.find((r) => r.id === id);

/**
 * The starting state for a fighter of race `race` and sub-species `subrace`. An unknown race
 * falls back to the first race; a sub-species that is not the race's own falls back to the
 * race's first. The selected race's box starts expanded, so its sub-species are visible.
 */
export function initialAncestry(races: readonly AncestryRace[], race: string, subrace: string | null): AncestryState {
  const r = findRace(races, race) ?? races[0];
  if (!r) return { expanded: null, race, subrace };
  const own = r.subspecies.some((s) => s.id === subrace);
  return { expanded: r.id, race: r.id, subrace: own ? subrace : r.subspecies[0]?.id ?? null };
}

/**
 * Click (or Enter / Space) on race `raceId`'s header. Expanded -> collapse (selection kept).
 * Collapsed -> expand it alone and select the race; a race change resets the sub-species to
 * the race's first. Unknown ids leave the state unchanged.
 */
export function toggleRace(state: AncestryState, raceId: string, races: readonly AncestryRace[]): AncestryState {
  const r = findRace(races, raceId);
  if (!r) return state;
  if (state.expanded === raceId) return { ...state, expanded: null };
  if (state.race === raceId) return { ...state, expanded: raceId };
  return { expanded: raceId, race: raceId, subrace: r.subspecies[0]?.id ?? null };
}

/**
 * Click on sub-species `subraceId` of race `raceId`: both become the selection and that box
 * stays expanded. A sub-species that does not belong to the race leaves the state unchanged.
 */
export function selectSubrace(
  state: AncestryState, raceId: string, subraceId: string, races: readonly AncestryRace[],
): AncestryState {
  const r = findRace(races, raceId);
  if (!r || !r.subspecies.some((s) => s.id === subraceId)) return state;
  return { expanded: raceId, race: raceId, subrace: subraceId };
}

/**
 * Merge a race name and a sub-species name into one label: "Human · Imperial". When the
 * sub-species name already contains the race name as a whole word ("High Elf", race "Elf"),
 * the sub-species name alone is returned. A missing sub-species returns the race name.
 */
export function mergedName(raceName: string, subraceName: string | null | undefined): string {
  if (!subraceName) return raceName;
  const word = new RegExp(`(^|\\s)${raceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "i");
  return word.test(subraceName) ? subraceName : `${raceName}${MERGE_SEPARATOR}${subraceName}`;
}

/** The header label of race `raceId` under `state` (merged only for the selected race). */
export function headerLabel(state: AncestryState, raceId: string, races: readonly AncestryRace[]): string {
  const r = findRace(races, raceId);
  if (!r) return raceId;
  if (state.race !== raceId) return r.name;
  return mergedName(r.name, r.subspecies.find((s) => s.id === state.subrace)?.name ?? null);
}

/** One view model per race, in `races` order. */
export function ancestryView(state: AncestryState, races: readonly AncestryRace[]): RaceBoxView[] {
  return races.map((r) => ({
    raceId: r.id,
    label: headerLabel(state, r.id, races),
    expanded: state.expanded === r.id,
    selected: state.race === r.id,
    chips: r.subspecies.map((s) => ({ id: s.id, name: s.name, selected: state.race === r.id && state.subrace === s.id })),
  }));
}

/**
 * Roving focus among the race headers (WAI-ARIA accordion pattern): ArrowDown / ArrowRight
 * move to the next header, ArrowUp / ArrowLeft to the previous (both wrap), Home / End to
 * the first / last. Returns the new index, or null when `key` is not a navigation key or
 * there are no headers.
 */
export function nextHeaderIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown": case "ArrowRight": return (current + 1) % count;
    case "ArrowUp": case "ArrowLeft": return (current - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}
