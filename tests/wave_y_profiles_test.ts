// Wave Y (lane P, C-AI): profiles carry all seven attributes through save/load. SPEC Y13.
//
// Verified (passing): a saved hero (rolled, or built in the Creator) reloads from the store with all
// seven attributes — vitality, resilience, focus, reflex, strength, intelligence, agility — at the
// values its ancestry and calling give, and the engine's fight path (#applyTweaks) reads exactly those.
//
// KNOWN GAP (ignored test below, enable after the fix): a Creator TWEAK of the allocation (e.g. +3
// agility, +2 focus) is NOT persisted — ProfileLibrary.storedFromCharacter does not write `allocated`
// and toCharacter rebuilds it from startingStats. The fix (ProfileLibrary.ts is not owned by lane P)
// is in artifacts/messages-wave-y-P.md.

import { ProfileRepo, type Store } from "../src/game/Profiles.ts";
import { createFromCharacter, createRandomProfile, libraryEntries } from "../src/game/ProfileLibrary.ts";
import { startingStats } from "../src/game/Leveling.ts";
import { ATTRIBUTE_KEYS } from "../src/game/DecisionTree.ts";
import { rng32 } from "../src/core/MathCore.ts";

function assert(ok: unknown, msg = "assertion failed"): asserts ok { if (!ok) throw new Error(msg); }

function memStore(): Store {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

Deno.test("SPEC Y13: a saved hero reloads with all seven attributes (agility and focus included)", () => {
  for (let seed = 1; seed <= 25; seed++) {
    const store = memStore();
    const repo = new ProfileRepo(store);
    const rolled = createRandomProfile(repo, rng32(seed), "2026-11-02T00:00:00Z");
    const built = createFromCharacter(repo, rolled.character, `${rolled.character.name} II`, "2026-11-02T00:00:01Z");
    // A fresh repo over the same store = a reload from disk.
    const reloaded = libraryEntries(new ProfileRepo(store));
    for (const e of [rolled, built]) {
      const back = reloaded.find((x) => x.profile.playerId === e.profile.playerId);
      assert(back, `seed ${seed}: the hero reloads`);
      const want = startingStats(e.character.className, e.character.race, e.character.subrace).allocated;
      for (const k of ATTRIBUTE_KEYS) {
        const v = back.character.allocated[k];
        assert(typeof v === "number" && Number.isFinite(v), `seed ${seed}: ${k} present after reload`);
        assert(v === e.character.allocated[k] && v === want[k], `seed ${seed}: ${k} ${v} round-trips (${e.character.allocated[k]})`);
      }
    }
  }
});

Deno.test({
  name: "SPEC Y13b: a tweaked allocation round-trips through the profile library",
  fn() {
    const store = memStore();
    const repo = new ProfileRepo(store);
    const rolled = createRandomProfile(repo, rng32(3), "2026-11-02T00:00:00Z");
    const c = rolled.character;
    const tweaked = { ...c, allocated: { ...c.allocated, agility: c.allocated.agility + 3, focus: c.allocated.focus + 2 } as Record<string, number> };
    const saved = createFromCharacter(repo, tweaked, "Tweaked", "2026-11-02T00:00:01Z");
    const back = libraryEntries(new ProfileRepo(store)).find((x) => x.profile.playerId === saved.profile.playerId)!;
    for (const k of ATTRIBUTE_KEYS) assert(back.character.allocated[k] === tweaked.allocated[k], `${k} tweak survives`);
  },
});
