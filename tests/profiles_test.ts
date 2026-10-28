import { createProfile, DEFAULT_KEYBINDINGS, ProfileRepo, PROFILES_KEY, type Store } from "../src/game/Profiles.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }

function memStore(): Store & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
  };
}

Deno.test("a fresh profile has a stable id, default keybindings and empty telemetry", () => {
  const p = createProfile(7, "Aldric", "Warrior");
  assert(p.playerId.startsWith("PL-"), "id prefix");
  assert(p.keybindings.forward === DEFAULT_KEYBINDINGS.forward, "default keybindings");
  assert(p.telemetry.matches === 0, "empty telemetry");
  // Same seed -> same id; different seed -> different id.
  assert(createProfile(7, "X", "Mage").playerId === p.playerId, "id reproducible from seed");
  assert(createProfile(8, "X", "Mage").playerId !== p.playerId, "distinct seeds, distinct ids");
});

Deno.test("the repo adds, selects and persists profiles", () => {
  const store = memStore();
  const repo = new ProfileRepo(store);
  repo.add(createProfile(1, "One", "Warrior"));
  repo.add(createProfile(2, "Two", "Mage"));
  assert(repo.list().length === 2, "two profiles");
  assert(repo.active()!.name === "Two", "the newest is active");
  const sel = repo.select(repo.list()[0].playerId);
  assert(sel!.name === "One" && repo.active()!.name === "One", "select changes the active profile");
  // Persisted: a fresh repo over the same store loads them back.
  const repo2 = new ProfileRepo(store);
  assert(repo2.list().length === 2, "profiles survive a reload");
  assert(store.data.has(PROFILES_KEY), "written to the store");
});

Deno.test("update patches a profile's saved character state", () => {
  const store = memStore();
  const repo = new ProfileRepo(store);
  const p = createProfile(3, "Three", "Rogue");
  repo.add(p);
  repo.update(p.playerId, { race: "elf", subrace: "wood", birthsign: "moon" });
  const after = repo.active()!;
  assert(after.race === "elf" && after.subrace === "wood" && after.birthsign === "moon", "state saved");
  assert(after.playerId === p.playerId, "the id cannot be overwritten");
});

Deno.test("recordMatch accumulates wins, losses, damage and favourite class", () => {
  const store = memStore();
  const repo = new ProfileRepo(store);
  const p = createProfile(4, "Four", "Priest");
  repo.add(p);
  repo.recordMatch(p.playerId, true, 1500, "Priest");
  repo.recordMatch(p.playerId, false, 900, "Priest");
  const t = repo.active()!.telemetry;
  assert(t.matches === 2 && t.wins === 1 && t.losses === 1, "record counted");
  assert(t.damageDealt === 2400, "damage summed");
  assert(t.favouriteClass === "Priest", "favourite class tracked");
});

Deno.test("a corrupt store loads as empty rather than throwing", () => {
  const store = memStore();
  store.setItem(PROFILES_KEY, "not json{{{");
  const repo = new ProfileRepo(store);
  assert(repo.list().length === 0 && repo.active() === null, "corrupt -> empty");
});
