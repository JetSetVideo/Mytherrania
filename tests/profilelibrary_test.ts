// tests/profilelibrary_test.ts — lane O-B: the profile library (list, migrate, create, manage).
//
// What is proven here:
//   1. MIGRATION: a stored Profile (no appearance) becomes a real CharacterProfile with a look
//      resolved deterministically from its name/race/sub-species/calling; a stored appearance WINS;
//   2. DETERMINISM: the same record always yields the same look (two calls agree, byte-for-byte);
//   3. the random roll reuses Wave L's rollProfile (same rng seed -> the same fighter is saved);
//   4. ids stay UNIQUE over 100 rolls (the printed collision count is 0);
//   5. the library never empties (deleting the last profile is refused), a rename trims/refuses
//      empty/never changes the id, a duplicate is a new id with the source's look;
//   6. the module is pure (no Math.random, no DOM, no localStorage).
//
// Repeatable rolls reuse MathCore.rng32 (a seeded Mulberry32). The repo is built over an in-memory
// Store (never localStorage), exactly as tests/profiles_test.ts does.

import {
  appearanceFor,
  createFromCharacter,
  createRandomProfile,
  deleteProfile,
  duplicateProfile,
  libraryEntries,
  librarySummary,
  renameProfile,
  setActive,
} from "../src/game/ProfileLibrary.ts";
import { createProfile, ProfileRepo, type Store } from "../src/game/Profiles.ts";
import type { CharacterProfile } from "../src/game/Characters.ts";
import { rng32 } from "../src/core/MathCore.ts";
import { rollProfile } from "../src/ui/CreatorRoll.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}

/** An in-memory Store (profiles_test.ts pattern): nothing touches localStorage. */
function memStore(): Store & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

/** Recursively sort object keys so two structurally-equal values stringify identically. */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) out[k] = canon(o[k]);
    return out;
  }
  return v;
}

/** Canonical deep equality, order-independent. */
function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

const ISO = "2026-10-31T12:00:00.000Z";

/** A deliberately built fighter, with a look the migration must NOT repaint. */
const BUILT: CharacterProfile = {
  name: "Ser Vail",
  race: "human",
  subrace: "imperial",
  className: "Warrior",
  appearance: { body: "#123456", accent: "#654321", height: 1.9, weight: 101, hair: "#abcdef", beard: true, moustache: false, eyes: "#112233" },
  palette: "Ember",
  birthsign: "mountain",
  level: 4,
  allocated: {},
};

Deno.test("migration: a legacy stored profile becomes a real character with a resolved look", () => {
  const repo = new ProfileRepo(memStore());
  const p = createProfile(11, "Hollow", "Mage");
  repo.add(p);

  const entries = libraryEntries(repo);
  assert(entries.length === 1, "one entry");
  const e = entries[0];
  // The stored record is passed through untouched...
  assert(e.profile.playerId === p.playerId, "the record is the stored one");
  // ...and a CHARACTER is derived: appearance present, ancestry copied, level defaulted to 1.
  assert(typeof e.character.appearance.body === "string", "the appearance has a body colour");
  assert(e.character.race === "human" && e.character.className === "Mage", "ancestry + calling carried");
  assert(e.character.level === 1, "a legacy record has no level, so 1");
  // Telemetry is surfaced as the entry's own fields.
  assert(e.level === 1 && e.matches === 0 && e.wins === 0 && e.losses === 0, "level + record surfaced");
  // Two members of one race still differ (distinct names -> distinct looks).
  const other = createProfile(12, "Ember", "Mage");
  const a1 = libraryEntries(repo)[0].character.appearance;
  const a2 = appearanceFor(other);
  assert(!eq(a1, a2), "two records must not resolve to the same look");
});

Deno.test("determinism: the same record always yields the same look", () => {
  const repo = new ProfileRepo(memStore());
  const p = createProfile(7, "Bramble", "Rogue");
  repo.add(p);
  // appearanceFor is a pure function of the record.
  assert(eq(appearanceFor(p), appearanceFor(p)), "appearanceFor drifted");
  // And the whole library view is stable across calls (byte-for-byte), so nothing re-rolls.
  const first = libraryEntries(repo);
  const second = libraryEntries(repo);
  assert(eq(first.map((e) => e.character), second.map((e) => e.character)), "the migrated look drifted between reads");
  assert(eq(first[0].character.appearance, appearanceFor(p)), "the migrated appearance must equal appearanceFor");
});

Deno.test("precedence: a stored appearance is never overwritten (and survives a rename)", () => {
  const repo = new ProfileRepo(memStore());
  const saved = createFromCharacter(repo, BUILT, "Ser Vail", ISO);
  assert(eq(saved.character.appearance, BUILT.appearance), "the built look must be stored as-is");
  assert(saved.character.palette === "Ember" && saved.character.level === 4, "palette + level stored");
  assert(saved.level === 4, "the entry reports the character's level");
  // A rename changes ONLY the name; the stored look is untouched.
  assert(renameProfile(repo, saved.profile.playerId, "Ser Vail the Bold"), "rename accepted");
  const after = libraryEntries(repo)[0];
  assert(after.profile.name === "Ser Vail the Bold", "the name changed");
  assert(eq(after.character.appearance, BUILT.appearance), "the stored appearance must NOT be repainted by the rename");
  // A migrated (legacy) profile, by contrast, resolves from the record and is stable.
  const legacy = createProfile(99, "Legacy", "Priest");
  repo.add(legacy);
  const legacyEntry = libraryEntries(repo).find((e) => e.profile.playerId === legacy.playerId)!;
  assert(eq(legacyEntry.character.appearance, appearanceFor(legacy)), "legacy resolves deterministically");
});

Deno.test("the random roll reuses rollProfile (same seed -> the same fighter is saved)", () => {
  const repo = new ProfileRepo(memStore());
  const seed = 0x5eed;
  const entry = createRandomProfile(repo, rng32(seed), ISO);
  const expected = rollProfile(rng32(seed)).profile;
  // The saved character IS the rolled one (the roll reuses Wave L, it is not re-implemented here).
  assert(eq(entry.character, expected), "the stored character must equal rollProfile's");
  assert(entry.profile.name === expected.name, "the name is the rolled name");
  assert(repo.active()!.playerId === entry.profile.playerId, "a fresh roll becomes active");
  // It carries no Math.random-derived wobble: a second identical call over a fresh repo agrees.
  const repo2 = new ProfileRepo(memStore());
  const entry2 = createRandomProfile(repo2, rng32(seed), ISO);
  assert(eq(entry.character, entry2.character), "the same seed yields the same saved fighter");
});

Deno.test("ids stay unique: 100 rolls in a row never collide (collision count 0)", () => {
  const repo = new ProfileRepo(memStore());
  const ids = new Set<string>();
  let collisions = 0;
  for (let i = 0; i < 100; i++) {
    const e = createRandomProfile(repo, rng32(0x1_0000 + i), ISO);
    if (ids.has(e.profile.playerId)) collisions++;
    ids.add(e.profile.playerId);
  }
  console.log(`collision count over 100 rolled ids: ${collisions}`);
  assert(ids.size === 100, `expected 100 unique ids, got ${ids.size}`);
  assert(collisions === 0, `expected 0 collisions, got ${collisions}`);
  assert(libraryEntries(repo).length === 100, "100 profiles in the library");
});

Deno.test("the library never empties: deleting the last profile is refused", () => {
  const repo = new ProfileRepo(memStore());
  const a = createRandomProfile(repo, rng32(1), ISO).profile;
  assert(deleteProfile(repo, a.playerId) === false, "the last profile cannot be deleted");
  assert(librarySummary(repo).count === 1, "the library still holds one profile");

  const b = createRandomProfile(repo, rng32(2), ISO).profile;
  const c = createRandomProfile(repo, rng32(3), ISO).profile;
  assert(deleteProfile(repo, b.playerId) === true, "a non-last profile can be deleted");
  assert(libraryEntries(repo).every((e) => e.profile.playerId !== b.playerId), "the deleted row is gone");
  assert(deleteProfile(repo, c.playerId) === true, "delete down to one");
  assert(deleteProfile(repo, a.playerId) === false, "the very last profile is still refused");
  assert(deleteProfile(repo, "PL-000000") === false, "an unknown id is refused");
  assert(librarySummary(repo).count === 1, "one profile remains");
});

Deno.test("rename trims, refuses an empty name, and never changes the id", () => {
  const repo = new ProfileRepo(memStore());
  const p = createRandomProfile(repo, rng32(4), ISO).profile;
  assert(renameProfile(repo, p.playerId, "   New Name   "), "rename accepted");
  const after = repo.list().find((x) => x.playerId === p.playerId)!;
  assert(after.name === "New Name", "trimmed");
  assert(after.playerId === p.playerId, "id unchanged");
  assert(renameProfile(repo, p.playerId, "   ") === false, "empty (after trim) refused");
  assert(renameProfile(repo, "PL-000000", "Nope") === false, "unknown id refused");
});

Deno.test("duplicate: a new id that keeps the source's look", () => {
  const repo = new ProfileRepo(memStore());
  const src = createRandomProfile(repo, rng32(5), ISO);
  const copy = duplicateProfile(repo, src.profile.playerId, ISO);
  assert(copy !== null, "duplicate returned an entry");
  assert(copy!.profile.playerId !== src.profile.playerId, "the copy has a new id");
  assert(eq(copy!.character.appearance, src.character.appearance), "the copy keeps the resolved look");
  assert(librarySummary(repo).count === 2, "the copy is in the library");
  assert(duplicateProfile(repo, "PL-000000", ISO) === null, "unknown id -> null");
});

Deno.test("setActive selects a live profile; false for an unknown/removed one", () => {
  const repo = new ProfileRepo(memStore());
  const a = createRandomProfile(repo, rng32(6), ISO).profile;
  const b = createRandomProfile(repo, rng32(7), ISO).profile;
  assert(repo.active()!.playerId === b.playerId, "the latest is active");
  assert(setActive(repo, a.playerId) === true, "setActive accepted");
  assert(repo.active()!.playerId === a.playerId, "active switched");
  assert(setActive(repo, "PL-000000") === false, "unknown id refused");
});

// The required evidence print: roll x3, rename, duplicate, delete, setActive — the whole library.
Deno.test("printed library after roll x3, rename, duplicate, delete and setActive", () => {
  const repo = new ProfileRepo(memStore());
  const names = ["Ash", "Bramble", "Cinder"];
  for (let i = 0; i < 3; i++) {
    const e = createRandomProfile(repo, rng32(0xbeef + i), ISO);
    renameProfile(repo, e.profile.playerId, names[i]); // stable names for a readable print
  }
  const ids = libraryEntries(repo).map((e) => e.profile.playerId);
  renameProfile(repo, ids[0], "Ash the Renamed");
  duplicateProfile(repo, ids[1], ISO);
  // Delete the third roll, then make the first row active again.
  deleteProfile(repo, ids[2]);
  setActive(repo, ids[0]);

  const summary = librarySummary(repo);
  for (const e of libraryEntries(repo)) {
    console.log(
      `${e.profile.playerId}  ${e.profile.name.padEnd(18)} ` +
        `${e.character.race}/${e.character.subrace}  ${e.character.className.padEnd(11)} ` +
        `lv${e.level}  ${e.matches}\u200aW\u00b7${e.losses}L  body=${e.character.appearance.body} h=${e.character.appearance.height.toFixed(2)}m`,
    );
  }
  console.log(`summary: ${JSON.stringify(summary)}`);
  assert(summary.count === 3, `expected 3 rows, got ${summary.count}`);
  assert(summary.names[0] === "Ash the Renamed", "the active row is first");
  assert(summary.activeId === ids[0], "the active id is the one set");
});

Deno.test("ProfileLibrary.ts is pure: no Math.random and no DOM", () => {
  const here = new URL("../", import.meta.url);
  const src = Deno.readTextFileSync(new URL("src/game/ProfileLibrary.ts", here));
  assert(!src.includes("Math.random("), "ProfileLibrary.ts calls Math.random");
  for (const dom of ["document.", "window.", "localStorage"]) {
    assert(!src.includes(dom), `ProfileLibrary.ts touches ${dom}`);
  }
});
